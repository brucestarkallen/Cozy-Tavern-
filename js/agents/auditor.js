/* Cozy Tavern — agents/auditor.js
 * M41: the auditor — the one reader who sees the whole ledger at once and
 * holds it against the story as written, the writer's brief, and the
 * record. The other readers each mind one thing (a page, a record line);
 * the auditor minds the LEDGER: the hour against the latest header, who is
 * marked here against who is on the page, the seats of the absent against
 * where the pages last put them, the character pages against the brief
 * and the real record, the canon against the brief, the threads against
 * what has resolved. What it finds wrong, it sets right through the same
 * closed vocabulary as every other change — validated, logged, take-back-
 * able — and what it cannot fix, it says.
 *
 * Runs every few turns (Settings: auditEvery, in turns; auditOn) and by
 * hand from the drawer ("Audit the ledger"). Off the send path, in the
 * workers' queue, last in the chain. Throws on transport; a garbled answer
 * is said out loud.
 *
 *   auditLedger({connection, storyId, brief, castNotes, signal, stale})
 *     -> {applied, rejected, issues, note} | null
 */

import { db } from '../store.js';
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify, renderStateFacts } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { renderOffscreen } from '../engine/offscreen.js';
import { renderCanon } from '../engine/canon.js';
import { renderThreads, renderKnowledge, renderFactions } from '../engine/world.js';
import { mcName } from '../engine/duels.js';
import { loadMemory, recordFor } from './memory.js';
import { pageText } from '../assemble/stack.js';

const MAX_TOKENS = 6000;
export const DEFAULT_AUDIT_EVERY = 3; /* turns */
export const AUDIT_PAGES = 10;        /* the latest pages the auditor reads in full */

const VOCABULARY = [
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30}',
  'place.set {"type":"place.set","name":"the chapel"}',
  'presence.enter {"type":"presence.enter","name":"Mira","position":"by the fire"} / presence.leave {"type":"presence.leave","name":"Mira"} / presence.update {"type":"presence.update","name":"Mira","position":"at the window"}',
  'mc.set {"type":"mc.set","name":"Jovan"} — only when the ledger has no main character',
  'mode.set / mode.clear {"type":"mode.set","flag":"combat|intimate|travel|socialField|isolation|group"}',
  'body.injure {"type":"body.injure","name":"Mara","what":"…","sev":1-3} / body.heal {"type":"body.heal","name":"Mara","what":"…"}',
  'rel.shift {"type":"rel.shift","name":"Samantha","axis":"p|r|s","delta":-20..20,"cause":"the on-page beat"} / rel.set {"type":"rel.set","name":"…","p":..,"r":..,"s":..,"cause":"the brief says"}',
  'offscreen.set {"type":"offscreen.set","name":"Aurora","location":"…","activity":"…","agenda":"…","stance":"toward|seeking|tense|busy|waiting","etaMinutes":25} / offscreen.clear {"type":"offscreen.clear","name":"Aurora"}',
  'canon.lock {"type":"canon.lock","name":"Mira","key":"hair","value":"black"} / canon.unlock {"type":"canon.unlock","name":"Mira","key":"hair"}',
  'thread.set {"type":"thread.set","title":"…","owner":"…","heat":"hot|cold","next":"…"} / thread.close {"type":"thread.close","title":"…"}',
  'knowledge.add {"type":"knowledge.add","name":"Liara","fact":"…"}',
  'faction.set {"type":"faction.set","name":"…","stance":"…","agenda":"…","move":"…"}',
  'people.set {"type":"people.set","name":"Kris Jenner","field":"core|state|arc","text":"…"} — the main character\'s core and arc are never written',
].join('\n');

function law({ mc }) {
  return [
    'You are the auditor of the ledger for a slow story told between two writers. The ledger is the',
    'house\'s memory of the scene and the world; the other readers each keep one part of it. You read',
    'ALL of it at once and hold it against three truths, in this order of authority:',
    '  1. THE BRIEF — what the writer established: who people are, their names, families, roles, the',
    '     world\'s rules. The brief wins over everything below it.',
    '  2. THE PAGES — what actually happened, as written. The latest page is the present.',
    '  3. THE RECORD — what earlier pages established, oldest to newest; a [Correction] line supersedes.',
    mc ? `The main character is ${mc}.` : 'The main character is not yet named; if the pages make it plain, mc.set names them.',
    '',
    'Find every place the ledger disagrees with those truths, and every place it is missing something',
    'the pages plainly established:',
    '  - THE HOUR AND THE GROUND: does the clock and the place match the latest page\'s header line',
    '    [Place — Day, Date | HH:MM | …] and the scene as written? Set them if not.',
    '  - WHO IS HERE: is everyone on the latest page in the ledger\'s presence, and is everyone marked',
    '    present actually still in the scene? Someone who left pages ago and is still "here" is an',
    '    error; someone who arrived and is not listed is an error.',
    '  - THE ABSENT: does each seat match where the pages last put that person? A person the pages',
    '    show arriving still seated elsewhere is an error (offscreen.clear). A named person the pages',
    '    or the brief establish who has no seat and no page is missing (people.set, offscreen.set).',
    '  - THE PEOPLE: does each character page agree with the brief and with the pages? A wrong name,',
    '    a wrong relation, a wrong role is an error. A real person or a character from an established',
    '    canon is written from the real record (Kendall Jenner\'s mother is Kris Jenner). Fix the page',
    '    (people.set with the corrected field), never invent past what the brief and the pages say.',
    '  - THE CANON: does anything locked contradict the brief? Unlock and relock it right.',
    '  - THE BODIES AND THE STANDINGS: a wound the pages show healed still open; a standing that',
    '    contradicts the brief\'s established relationship (rel.set with the cause "the brief says").',
    '  - THE THREADS: a thread the pages show resolved still hot (thread.close); a live agenda the',
    '    pages show and the ledger lacks (thread.set).',
    '  - WHO KNOWS WHAT: a present person who plainly witnessed something on the latest pages with no',
    '    knowledge line for it (knowledge.add).',
    '',
    'Be exact and be conservative: only what the brief states or the pages show, never what would be',
    'nice. A disagreement you cannot fix with the vocabulary (a contradiction between the brief and',
    'the pages themselves) is reported with an empty mutations list. If the ledger is true to the',
    'story, say so with an empty list — that is a good answer.',
    '',
    'Answer with JSON ONLY, exactly this shape:',
    '{"issues":[{"what":"the ledger says X; the pages say Y","fix":"what should be true","mutations":[ ... ]}]}',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    'Names keep the spelling the ledger and the pages use. No commentary, no fences: the JSON only.',
  ].join('\n');
}

const FENCE = '"""';

function characterPages(state) {
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const lines = [];
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object') continue;
    const bits = [];
    if (c.core) bits.push('core: ' + c.core);
    if (c.state) bits.push('now: ' + c.state);
    if (c.arc) bits.push('arc: ' + c.arc);
    if (Array.isArray(c.threads) && c.threads.length) bits.push('loose ends: ' + c.threads.map((t) => (typeof t === 'string' ? t : t && t.text)).filter(Boolean).join('; '));
    lines.push(name + ' — ' + bits.join(' | '));
  }
  return lines.join('\n');
}

/* Exported for the harness. */
export function buildAuditorMessages({ state, brief = '', castNotes = '', record = '', pages = [] }) {
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  const clockMinutes = state && state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const present = Array.isArray(state.present) ? state.present : [];
  const facts = renderStateFacts(state) || 'Nothing is written in the ledger yet.';
  const seats = renderOffscreen(state.offscreen, present, clockMinutes, 40);
  const canon = state.canon && typeof state.canon === 'object' ? renderCanon(state.canon, Object.keys(state.canon)) : '';
  const threads = renderThreads(Array.isArray(state.threads) ? state.threads.filter((t) => t && typeof t === 'object' && t.title) : []);
  const knowledge = renderKnowledge(state.knowledge, present);
  const factions = renderFactions(state.factions);
  const people = characterPages(state);
  const user = [
    'THE BRIEF (the writer\'s own words):',
    FENCE, String(brief || '').trim().slice(0, 4000) || '(none written)', FENCE,
    ...(castNotes && String(castNotes).trim() ? ['WHO IS IN IT (the writer\'s own words):', FENCE, String(castNotes).trim().slice(0, 3000), FENCE] : []),
    '',
    'THE LEDGER, ALL OF IT:',
    '— the state of the scene —', facts,
    '— every seat of the absent —', seats || '(none)',
    '— the character pages —', people || '(none)',
    '— what is locked true —', canon || '(nothing locked)',
    '— the threads —', threads || '(none)',
    '— who knows what (the present) —', knowledge || '(nothing written)',
    '— the factions —', factions || '(none)',
    '',
    'THE RECORD (oldest to newest):',
    FENCE, String(record || '').trim() || '(nothing recorded yet)', FENCE,
    '',
    'THE LATEST PAGES (the last is the present):',
    FENCE,
    (Array.isArray(pages) ? pages : []).map((p) => (p.role === 'assistant' ? 'STORY: ' : 'PLAYER: ') + String(p.text || '').slice(0, 5000)).join('\n\n'),
    FENCE,
    '',
    'Hold the ledger against the brief, the pages and the record. JSON only.',
  ].join('\n');
  return { system: withFictionFrame(law({ mc })), user };
}

/* Exported for the harness. */
export function parseAuditorAnswer(raw) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    const candidates = balancedCandidates(text, 5);
    let parsed = null;
    for (const c of candidates) {
      const p = parseLenient(c);
      if (p && Array.isArray(p.issues)) { parsed = p; break; }
    }
    if (!parsed) return { issues: [], note: 'unusable' };
    const issues = parsed.issues
      .filter((i) => i && typeof i === 'object' && typeof i.what === 'string' && i.what.trim())
      .map((i) => ({
        what: i.what.trim().slice(0, 300),
        fix: typeof i.fix === 'string' ? i.fix.trim().slice(0, 300) : '',
        mutations: Array.isArray(i.mutations) ? i.mutations.filter((m) => m && typeof m === 'object' && typeof m.type === 'string') : [],
      }))
      .slice(0, 20);
    return { issues, note: 'ok' };
  } catch (err) {
    return { issues: [], note: 'unusable' };
  }
}

/* The contract. */
export async function auditLedger({ connection, storyId, brief = '', castNotes = '', signal, stale } = {}) {
  if (!connection || typeof connection !== 'object' || !storyId) return null;
  const state = await loadState(storyId);
  const mem = await loadMemory(storyId);
  const all = (await db.messages.list(storyId)).filter((m) => !m.hidden);
  const pages = all.slice(-AUDIT_PAGES).map((m) => ({ role: m.role, text: pageText(m) }));
  if (!pages.length) return null;
  const prompt = buildAuditorMessages({ state, brief, castNotes, record: recordFor(mem), pages });
  let read = null;
  let raw = '';
  let user = prompt.user;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text, finishReason } = await callWorker(connection, { system: prompt.system, user, maxTokens: MAX_TOKENS, effort: 'off', signal });
    raw = text;
    read = parseAuditorAnswer(text);
    if (finishReason === 'length' && read.note === 'unusable') read.note = 'cut short';
    if (read.note === 'ok') break;
    user = prompt.user + '\n\nYour last answer was not a JSON object with an "issues" list. Answer with the JSON object only, and keep it short.';
  }
  if (read.note !== 'ok') return { applied: [], rejected: [], issues: [], note: read.note, raw };
  if (stale && stale()) return null;
  const fresh = await loadState(storyId);
  const mutations = read.issues.flatMap((i) => i.mutations);
  const { state: next, applied, rejected } = applyMutations(fresh, mutations);
  const report = { at: Date.now(), turn: Number.isFinite(next.turn) ? next.turn : 0, issues: read.issues.map((i) => ({ what: i.what, fix: i.fix, fixable: i.mutations.length > 0 })) };
  const out = { ...next, audit: report };
  if (stale && stale()) return null;
  await saveState(storyId, out);
  notify(storyId);
  return { applied, rejected, issues: read.issues, note: 'ok', raw };
}

export function auditRunWords(result) {
  if (!result) return 'nothing to read';
  if (result.note === 'unusable') return 'its answer could not be used';
  if (result.note === 'cut short') return 'its answer ran out of room';
  const n = result.issues.length;
  if (!n) return 'the ledger is true to the story';
  const fixed = result.applied.length;
  const bits = [`found ${n} ${n === 1 ? 'thing' : 'things'}`];
  if (fixed) bits.push(`set ${fixed} right: ` + result.applied.slice(0, 4).map((a) => a.words.replace(/\.$/, '')).join(' · ') + (fixed > 4 ? ' · …' : ''));
  const unfixable = result.issues.filter((i) => !i.mutations.length).length;
  if (unfixable) bits.push(`${unfixable} only noted`);
  if (result.rejected.length) bits.push(`${result.rejected.length} refused`);
  return bits.join(', ');
}

export async function auditOn(story) {
  if (story && story.audit === false) return false;
  return (await db.settings.get('auditOn')) !== false;
}

export async function auditEvery() {
  const n = Math.round(Number(await db.settings.get('auditEvery')));
  return Number.isFinite(n) && n >= 1 ? Math.min(20, n) : DEFAULT_AUDIT_EVERY;
}
