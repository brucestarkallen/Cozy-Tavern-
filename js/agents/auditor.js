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
 * Runs after every page by default (Settings: auditEvery, in turns; auditOn) and by
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
import { applyMutations, RETIRED_EXAMPLE_NAMES } from '../engine/apply.js';
import { renderOffscreen } from '../engine/offscreen.js';
import { renderCanon } from '../engine/canon.js';
import { renderThreads, renderKnowledge, renderFactions } from '../engine/world.js';
import { mcName } from '../engine/duels.js';
import { explicitStandings, readStatedStandings, samePersonLoose, isLabel } from './founder.js'; /* M49/M50: the writer's digits, read the way the brief is shaped */
import { loadMemory, wholeRecord } from './memory.js'; /* M51: the whole record, not the summarizer's tail */
import { pageText } from '../assemble/stack.js';

const MAX_TOKENS = 6000;
export const DEFAULT_AUDIT_EVERY = 1; /* turns — M94: every page, as Summaryception's continuity auditor runs on every line */
export const AUDIT_PAGES = 10;        /* the latest pages the auditor reads in full */

const VOCABULARY = [
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30}',
  'place.set {"type":"place.set","name":"the chapel"}',
  'presence.enter {"type":"presence.enter","name":"NAME","position":"by the fire"} / presence.leave {"type":"presence.leave","name":"NAME"} / presence.update {"type":"presence.update","name":"NAME","position":"at the window"}',
  'mc.set {"type":"mc.set","name":"MAIN CHARACTER"} — only when the ledger has no main character',
  'mode.snapshot {"type":"mode.snapshot","flags":["socialField"]} — the moods that hold at the end of the latest page, all of them; anything not named is cleared',
  'body.injure {"type":"body.injure","name":"NAME","what":"…","sev":1-3} / body.heal {"type":"body.heal","name":"NAME","what":"…"}',
  'rel.shift {"type":"rel.shift","name":"OTHER NAME","axis":"p|r|s","delta":-20..20,"cause":"the on-page beat"} / rel.set {"type":"rel.set","name":"…","p":..,"r":..,"s":..,"cause":"the brief says"}',
  'offscreen.set {"type":"offscreen.set","name":"NAME","location":"…","activity":"…","agenda":"…","stance":"toward|seeking|tense|busy|waiting","etaMinutes":25} / offscreen.clear {"type":"offscreen.clear","name":"NAME"}',
  'canon.lock {"type":"canon.lock","name":"NAME","key":"hair","value":"black"} / canon.unlock {"type":"canon.unlock","name":"NAME","key":"hair"}',
  'thread.set {"type":"thread.set","title":"…","owner":"…","heat":"hot|cold","next":"…"} / thread.close {"type":"thread.close","title":"…"}',
  'knowledge.add {"type":"knowledge.add","name":"OTHER NAME","fact":"…"}',
  'faction.set {"type":"faction.set","name":"…","stance":"…","agenda":"…","move":"…"}',
  'people.set {"type":"people.set","name":"NAME","field":"core|state|arc","text":"…"} — the main character\'s core and arc are never written',
  'people.forget {"type":"people.forget","name":"NAME","cause":"…"} — ONLY for a person who was never the story\'s (a name no page, no brief and no cast note ever held); erases their page, seat, standing, knowledge and locks for good',
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
    '  - THE MOOD: do the moods on the board still hold at the end of the latest page? "In transit"',
    '    after he stepped out of the car, "a social field" in an emptied room, "combat" after the fight',
    '    ended — a stale mood wakes the wrong rules. Restate the board with mode.snapshot.',
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
    '    canon is written from the real record (a public figure\'s mother is her real mother, by name). Fix the page',
    '    (people.set with the corrected field), never invent past what the brief and the pages say.',
    '  - THE CANON: does anything locked contradict the brief? Unlock and relock it right.',
    '  - THE BODIES AND THE STANDINGS: a wound the pages show healed still open; a standing that',
    '    contradicts the brief\'s established relationship (rel.set with the cause "the brief says").',
    '    AXIS LOCK: a standing exists only TOWARD THE MAIN CHARACTER. The ONLY standing you may zero',
    '    is one whose own history line says it was written for a feeling toward SOMEONE ELSE (a crush',
    '    on the sister, an ex\'s possessiveness toward her) — rel.set p:0 r:0 s:0 with the cause',
    '    "the standing was for <other person>, not <main character>", and move the feeling into that',
    '    person\'s page as words. NEVER zero a standing because you do not see the bond yourself: a',
    '    childhood friend, a sister, a lover the brief or the pages name has a bond; a standing the',
    '    pages moved was earned on the page. THE OTHER WAY IS YOUR JOB: a standing at ZERO (or',
    '    missing) for a person the brief or the pages establish as bonded to the main character —',
    '    a childhood friend, a devoted sister, a lover — is an error; RESTORE it with rel.set at the',
    '    level the brief\'s words warrant (cause: "the brief says …"). Lowering is what you may not do',
    '    on judgment; raising a wrongly-zeroed standing is a correction you can prove.',
    '  - THE THREADS: a thread the pages show resolved still hot (thread.close); a live agenda the',
    '    pages show and the ledger lacks (thread.set).',
    '  - WHO KNOWS WHAT: a present person who plainly witnessed something on the latest pages with no',
    '    knowledge line for it (knowledge.add).',
    '',
    'Be exact and be conservative: only what the brief states or the pages show, never what would be',
    'nice. If the ledger is true to the story, say so with an empty list — that is a good answer.',
    '',
    'THE BRIEF WINS: when the PAGES themselves contradict the brief — a wrong name, a wrong relation, a',
    'wrong role, a person somewhere the brief says they cannot be, a fact the brief settles written the',
    'other way — that page was an error, not canon (the writer\'s own law). Report it with "pages": true',
    'and a "fix" that states, in one plain sentence, what the page should read instead — the brief\'s',
    'truth, exactly; and lock that truth in the ledger with the vocabulary (canon.lock, people.set, or',
    'rel.set with the cause "the brief says …"). The house then mends the pages by the smallest edit and',
    'writes a correction into the record; you never rewrite a page yourself.',
    'THE PAGES SETTLE A BRIEF AT ODDS WITH ITSELF: when the brief says two things about one fact,',
    'the version the pages have already established is the story\'s — lock it (canon.lock, or people.set,',
    'with the cause "the brief says both; the pages settled it") and say so in "what"; if the pages have',
    'not touched that fact yet there is nothing to report — the storyteller will settle it the first time',
    'it comes up, and the ledger will hold what the page wrote. Nothing is reported as unfixable: every',
    'issue you list carries either mutations or a pages fix.',
    '',
    'Answer with JSON ONLY, exactly this shape:',
    '{"issues":[{"what":"the ledger says X; the pages say Y","fix":"what should be true","pages":false,"mutations":[ ... ]}]}',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    'Names keep the spelling the ledger and the pages use. No commentary, no fences: the JSON only.',
    'PLACEHOLDERS: NAME, OTHER NAME, NEW NAME, NAME SURNAME and MAIN CHARACTER in the examples above are placeholders, never people — never write them; write only the names the ledger, the brief and the pages use.',
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
        /* M90: the pages are wrong and the brief wins — the house mends them */
        pages: i.pages === true,
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
  const prompt = buildAuditorMessages({ state, brief, castNotes, record: wholeRecord(mem), pages });
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
  /* M48: the auditor may not take a standing away on judgment. A rel.set
   * that lowers a standing is refused when that standing has ANY on-page
   * history (a cause the extractor wrote from a page) or when the person is
   * named in the brief or the cast notes (the founder's bond stands). Only
   * a standing with no page behind it and no place in the brief — the
   * Caleb case, a feeling for someone else — may be zeroed. */
  const material = (String(brief || '') + '\n' + String(castNotes || '')).toLowerCase();
  const keptStandings = [];
  const guarded = [];
  for (const m of read.issues.flatMap((i) => i.mutations)) {
    if (m && (m.type === 'rel.set' || m.type === 'rel.shift') && typeof m.name === 'string') {
      const key = Object.keys(fresh.relationships || {}).find((k) => k.trim().toLowerCase() === m.name.trim().toLowerCase());
      const rel = key ? fresh.relationships[key] : null;
      const lowering = m.type === 'rel.shift' ? Number(m.delta) < 0
        : rel ? ['p', 'r', 's'].some((ax) => Number.isFinite(m[ax]) && m[ax] < (rel[ax] || 0)) : false;
      if (rel && lowering) {
        const earned = Array.isArray(rel.history) && rel.history.some((h) => h && typeof h.cause === 'string' && !/^the brief\b|^set\b|^the founder\b/i.test(h.cause.trim()));
        const inBrief = material.includes(m.name.trim().toLowerCase());
        if (earned || inBrief) {
          keptStandings.push({ mutation: m, why: (earned ? 'the standing was earned on the pages' : 'the brief names ' + m.name) + ' — the auditor may not take it away' });
          continue;
        }
      }
    }
    guarded.push(m);
  }
  /* M57: passers-through retire in code — no bond, no seat, no thread, no
   * lock, not present, and thirty turns since their page last moved. */
  guarded.push(...peopleHousekeeping(fresh));
  /* M95: the house's own example names, echoed into a ledger by a worker of an
   * older coat, are swept out unless the brief or the cast notes name them. */
  guarded.push(...exampleLeakHousekeeping(fresh, brief, castNotes));
  /* M103: seats have a life, in code — a passer-through the world agent kept
   * seated (a cab driver with "one clean fare") is cleared and retired the
   * moment the story stops carrying them; the pool is capped. */
  guarded.push(...seatHousekeeping(fresh, { brief, castNotes, pages: all.map((m) => ({ role: m.role, text: pageText(m) })) }));
  /* M50: the standings, kept clean in code — no judgment anywhere here. */
  const mcKnown = mcName(fresh) !== 'the player' ? mcName(fresh) : '';
  const statedByModel = await readStatedStandings({ connection, brief, castNotes, mc: mcKnown, signal });
  guarded.push(...standingsHousekeeping(fresh, brief, castNotes, mcKnown, statedByModel));
  const { state: next, applied, rejected: rejectedByApplier } = applyMutations(fresh, guarded);
  const rejected = [...rejectedByApplier, ...keptStandings];
  const report = { at: Date.now(), turn: Number.isFinite(next.turn) ? next.turn : 0, issues: read.issues.map((i) => ({ what: i.what, fix: i.fix, pages: i.pages === true, fixable: i.mutations.length > 0 || (i.pages === true && Boolean(i.fix)) })) };
  const out = { ...next, audit: report };
  if (stale && stale()) return null;
  await saveState(storyId, out);
  notify(storyId);
  return { applied, rejected, issues: read.issues, note: 'ok', raw };
}

/* M57: who has passed through. A person retires when ALL hold: not present;
 * no nonzero standing; no seat among the absent; no loose end on their page;
 * nothing locked true of them; not the main character; and their page has
 * not moved for RETIRE_AFTER turns. Woken by any page or entrance. */
export const RETIRE_AFTER = 30;
export function peopleHousekeeping(state) {
  const out = [];
  const chars = state.characters && typeof state.characters === 'object' ? state.characters : {};
  const turn = Number.isFinite(state.turn) ? state.turn : 0;
  const mc = mcName(state) !== 'the player' ? mcName(state) : '';
  const lower = (x) => String(x || '').trim().toLowerCase();
  const present = new Set((state.present || []).map((p) => lower(p && p.name)));
  const seated = new Set(Object.keys(state.offscreen || {}).map(lower));
  const locked = new Set(Object.keys(state.canon || {}).map(lower));
  const rels = state.relationships || {};
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || c.retired) continue;
    const k = lower(name);
    if (mc && samePersonLoose(name, mc)) continue;
    if (present.has(k) || seated.has(k) || locked.has(k)) continue;
    if (Array.isArray(c.threads) && c.threads.length) continue;
    const relKey = Object.keys(rels).find((r) => samePersonLoose(r, name));
    const rel = relKey ? rels[relKey] : null;
    if (rel && ((rel.p || 0) || (rel.r || 0) || (rel.s || 0))) continue;
    const last = Number.isFinite(c.updatedAtTurn) ? c.updatedAtTurn : 0;
    if (turn - last < RETIRE_AFTER) continue;
    out.push({ type: 'people.retire', name, cause: 'no bond, no seat, no thread, and ' + (turn - last) + ' turns since their page last moved' });
  }
  return out;
}

/* M95: a name that exists only because a worker echoed the house's example
 * (an older coat's prompts named a real family as the "real record" example)
 * is not a person of the story: their seat, standing, knowledge, lock and page
 * are let go — unless the writer's brief or cast notes name them, in which
 * case they are the story's and stand. */
export function exampleLeakHousekeeping(state, brief = '', castNotes = '') {
  const out = [];
  const material = (String(brief || '') + '\n' + String(castNotes || '')).toLowerCase();
  const leaked = (name) => RETIRED_EXAMPLE_NAMES.includes(String(name || '').trim().toLowerCase()) && !material.includes(String(name || '').trim().toLowerCase());
  const names = new Set();
  for (const name of Object.keys(state.characters || {})) if (leaked(name)) names.add(name);
  for (const name of Object.keys(state.offscreen || {})) if (leaked(name)) names.add(name);
  for (const name of Object.keys(state.relationships || {})) if (leaked(name)) names.add(name);
  for (const name of Object.keys(state.canon || {})) if (leaked(name)) names.add(name);
  for (const p of (state.present || [])) if (p && leaked(p.name)) names.add(p.name);
  /* M96: forgotten for good, not tombstoned — a name that was never the story's leaves no trace */
  for (const name of names) out.push({ type: 'people.forget', name, cause: 'an example name from the house\'s own instructions, never the story\'s' });
  return out;
}

/* M103: WHO KEEPS A SEAT — the writer's own ACW law ("ACW tracks hot threads,
 * not cast; cold cast drops to the background pool"), held in code so a
 * generous world agent cannot grow the pool. A seat stands only while the
 * story carries the person: named in the brief or the cast notes; a nonzero
 * standing; owner of an open thread; moving toward or seeking the main
 * character on the clock; named on one of the last SEAT_MENTION_PAGES pages;
 * or seated within the last SEAT_FRESH_TURNS turns. Otherwise the seat is
 * cleared and the page retired at once (they wake if they ever appear
 * again). Above SEAT_CAP seats, the least reachable go first. */
export const SEAT_MENTION_PAGES = 12;
export const SEAT_FRESH_TURNS = 6;
export const SEAT_CAP = 12;
/* What carries a person, in words — '' when nothing does. The drawer reads
 * this beside every character page (M104) so the writer can see the pool
 * the way the house does. */
export function carriedBy(state, name, { brief = '', castNotes = '', pages = [] } = {}) {
  const seats = state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {};
  const turn = Number.isFinite(state.turn) ? state.turn : 0;
  const material = (String(brief || '') + '\n' + String(castNotes || '')).toLowerCase();
  const recent = (Array.isArray(pages) ? pages : []).slice(-SEAT_MENTION_PAGES).map((p) => String((p && p.text) || '').toLowerCase()).join('\n');
  const rels = state.relationships || {};
  const threads = Array.isArray(state.threads) ? state.threads : [];
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  const present = (state.present || []).some((p) => p && String(p.name || '').trim().toLowerCase() === n);
  if (present) return 'in the scene';
  if (material.includes(n)) return 'the brief names them';
  const relKey = Object.keys(rels).find((r) => samePersonLoose(r, name));
  const rel = relKey ? rels[relKey] : null;
  if (rel && ((rel.p || 0) || (rel.r || 0) || (rel.s || 0))) return 'a standing toward the main character';
  if (threads.some((t) => t && typeof t === 'object' && t.owner && samePersonLoose(t.owner, name))) return 'an open thread';
  const seatKey = Object.keys(seats).find((k) => samePersonLoose(k, name));
  const seat = seatKey ? seats[seatKey] : null;
  if (seat && (seat.stance === 'toward' || seat.stance === 'seeking')) return 'on the way to the main character';
  const first = n.split(/\s+/)[0];
  const mentioned = recent.includes(n) || (first.length >= 3 && new RegExp('(?<![\\p{L}\\p{N}])' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'u').test(recent));
  if (mentioned) return 'named on a recent page';
  if (seat && Number.isFinite(seat.atTurn) && turn - seat.atTurn < SEAT_FRESH_TURNS) return 'seated just now';
  return '';
}

export function seatHousekeeping(state, { brief = '', castNotes = '', pages = [] } = {}) {
  const out = [];
  const seats = state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {};
  const names = Object.keys(seats);
  if (!names.length) return out;
  const material = (String(brief || '') + '\n' + String(castNotes || '')).toLowerCase();
  const carried = (name) => carriedBy(state, name, { brief, castNotes, pages });
  const kept = [];
  for (const name of names) {
    const why = carried(name);
    if (why) { kept.push(name); continue; }
    out.push({ type: 'offscreen.clear', name });
    const page = state.characters && Object.keys(state.characters).find((k) => samePersonLoose(k, name));
    if (page && !state.characters[page].retired) out.push({ type: 'people.retire', name: page, cause: 'nothing carries them — no bond, no thread, not on the clock, not named for ' + SEAT_MENTION_PAGES + ' pages' });
  }
  /* the cap: the least reachable go first */
  if (kept.length > SEAT_CAP) {
    const rank = (name) => { const st = (seats[name] || {}).stance; return st === 'toward' ? 0 : st === 'seeking' ? 1 : st === 'tense' ? 2 : st === 'busy' ? 3 : 4; };
    const at = (name) => (Number.isFinite((seats[name] || {}).atTurn) ? seats[name].atTurn : -1);
    const ordered = kept.slice().sort((a, b) => (rank(b) - rank(a)) || (at(a) - at(b)));
    for (const name of ordered.slice(0, kept.length - SEAT_CAP)) {
      if (material.includes(String(name).trim().toLowerCase())) continue; /* the brief's people are never capped out */
      out.push({ type: 'offscreen.clear', name });
    }
  }
  return out;
}

/* M50: what CODE knows about standings, applied every audit:
 *   1. junk goes — a key that starts with an arrow or a bullet (the M49
 *      parser's leavings), or a standing for the main character himself;
 *   2. duplicates merge — "Rias" and "Rias Wells" are one person: the fuller
 *      name stays, and if it is zero while the shorter carries numbers, the
 *      numbers move over; the shorter is let go;
 *   3. the writer's digits — a standing stated in the brief or the cast
 *      notes toward the main character that is missing or all zero is
 *      restored; one the pages have moved is left alone. */
export function standingsHousekeeping(state, brief, castNotes, mc, stated = null) {
  const out = [];
  const rels = state.relationships && typeof state.relationships === 'object' ? state.relationships : {};
  const keys = Object.keys(rels);
  const isZero = (r) => !r || (!(r.p || 0) && !(r.r || 0) && !(r.s || 0));
  const gone = new Set();
  for (const k of keys) {
    if (/^[\s\-*•→>]/.test(k) || isLabel(k) || (mc && samePersonLoose(k, mc))) {
      out.push({ type: 'rel.clear', name: k, cause: 'not a standing toward ' + (mc || 'the main character') });
      gone.add(k);
    }
  }
  const live = keys.filter((k) => !gone.has(k));
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i]; const b = live[j];
      if (gone.has(a) || gone.has(b) || !samePersonLoose(a, b)) continue;
      const keep = a.length >= b.length ? a : b; const drop = keep === a ? b : a;
      if (isZero(rels[keep]) && !isZero(rels[drop])) {
        out.push({ type: 'rel.set', name: keep, p: rels[drop].p || 0, r: rels[drop].r || 0, s: rels[drop].s || 0, cause: 'the same person as ' + drop + ' — one standing' });
      }
      out.push({ type: 'rel.clear', name: drop, cause: 'the same person as ' + keep });
      gone.add(drop);
    }
  }
  /* the digits are judged against the ledger AS IT WILL STAND after the
   * junk is gone and the duplicates have merged — a merged standing that
   * carries numbers is not "zero" */
  const merged = out.length ? applyMutations(state, out).state.relationships : rels;
  const digits = Array.isArray(stated) ? stated : explicitStandings(String(brief || '') + '\n' + String(castNotes || ''), mc);
  for (const st of digits) {
    const key = Object.keys(merged).find((k) => samePersonLoose(k, st.name));
    const rel = key ? merged[key] : null;
    if (isZero(rel) && (st.p || st.r || st.s)) {
      out.push({ type: 'rel.set', name: key || st.name, p: st.p, r: st.r, s: st.s, cause: 'the brief states (P:' + st.p + ' R:' + st.r + ' S:' + st.s + ') toward ' + (mc || 'the main character') + ' — restored' });
    }
  }
  return out;
}

/* M50: rebuild every standing from the brief, the record and the pages — by
 * the writer's hand only. Every standing is let go (undoable), the
 * writer's digits are written in code, then ONE model pass writes the
 * rest toward the main character with a cause; a cause that does not name
 * the main character is refused. */
export const REBUILD_SYSTEM = 'You rebuild the standings of a story\'s people toward its main character from what is written. Answer with JSON only.';
const Q = '"' + '"' + '"';
export function buildRebuildMessages({ state, brief, castNotes, record, pages, mc }) {
  const people = Object.keys(state.characters || {}).concat(Object.keys(state.offscreen || {}), (state.present || []).map((p) => p && p.name)).filter(Boolean);
  const uniq = [...new Set(people.map((n) => String(n).trim()))].filter((n) => !mc || !samePersonLoose(n, mc));
  const user = [
    'The main character is ' + (mc || 'the one the writer plays') + '. A standing is how one person stands TOWARD THE MAIN CHARACTER on three',
    'independent axes, -100..100: p = platonic warmth/trust, r = romantic pull, s = sexual charge. A stranger',
    'is 0/0/0 and needs no line. Standings exist ONLY toward the main character — feelings between other',
    'people are not standings and must not appear.',
    '',
    'THE BRIEF (the first authority):', Q, String(brief || '').slice(0, 12000) || '(none)', Q,
    'THE CAST NOTES:', Q, String(castNotes || '').slice(0, 6000) || '(none)', Q,
    'THE RECORD (what the pages established, oldest to newest):', Q, String(record || '').slice(0, 14000) || '(nothing yet)', Q,
    'THE LATEST PAGES:', Q, (pages || []).map((p) => (p.role === 'assistant' ? 'STORY: ' : 'PLAYER: ') + String(p.text || '').slice(0, 4000)).join('\n\n'), Q,
    '',
    'THE PEOPLE THE LEDGER KNOWS: ' + (uniq.join(', ') || '(none)'),
    '',
    'For each of these people who has a bond or history with the main character — from the brief, the record,',
    'or the pages — write ONE rel.set with p, r, s and a cause that names the main character and quotes what',
    'earned it. Leave out anyone with no bond. Do not restate a person more than once. Digits the brief states',
    'are already written; you may still move them by what the pages have since shown.',
    '',
    'Answer with JSON ONLY: {"mutations":[{"type":"rel.set","name":"…","p":..,"r":..,"s":..,"cause":"…"}]}',
  ].join('\n');
  return { system: withFictionFrame(REBUILD_SYSTEM), user };
}

export async function rebuildStandings({ connection, storyId, brief = '', castNotes = '', signal, stale } = {}) {
  if (!connection || !storyId) return null;
  const state = await loadState(storyId);
  const mc = mcName(state) !== 'the player' ? mcName(state) : '';
  /* 1. everything goes (undoable) */
  const clear = Object.keys(state.relationships || {}).map((k) => ({ type: 'rel.clear', name: k, cause: 'rebuilt by the writer’s hand' }));
  let { state: s1 } = applyMutations(state, clear);
  /* 2. the writer's digits */
  const digits = (await readStatedStandings({ connection, brief, castNotes, mc, signal }))
    .map((st) => ({ type: 'rel.set', name: st.name, p: st.p, r: st.r, s: st.s, cause: 'the brief states (P:' + st.p + ' R:' + st.r + ' S:' + st.s + ') toward ' + (mc || 'the main character') }));
  ({ state: s1 } = applyMutations(s1, digits));
  await saveState(storyId, s1);
  notify(storyId);
  /* 3. the model, for the rest — toward the main character only */
  const mem = await loadMemory(storyId);
  const all = (await db.messages.list(storyId)).filter((m) => !m.hidden);
  const pages = all.slice(-AUDIT_PAGES).map((m) => ({ role: m.role, text: pageText(m) }));
  const prompt = buildRebuildMessages({ state: s1, brief, castNotes, record: wholeRecord(mem), pages, mc });
  const { text } = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: 4000, effort: 'off', signal });
  const read = parseFounderLike(text);
  if (stale && stale()) return null;
  const guarded = [];
  const refused = [];
  for (const m of read) {
    if (m.type !== 'rel.set' || typeof m.name !== 'string') { refused.push({ mutation: m, why: 'only rel.set is a rebuild' }); continue; }
    if (mc && samePersonLoose(m.name, mc)) { refused.push({ mutation: m, why: 'the main character has no standing toward himself' }); continue; }
    const cause = String(m.cause || '').toLowerCase();
    if (mc && !cause.includes(mc.toLowerCase()) && !/main character/.test(cause)) { refused.push({ mutation: m, why: 'the cause does not name ' + mc }); continue; }
    guarded.push(m);
  }
  const fresh = await loadState(storyId);
  const { state: next, applied, rejected } = applyMutations(fresh, guarded);
  await saveState(storyId, next);
  notify(storyId);
  return { applied, rejected: [...rejected, ...refused], cleared: clear.length, digits: digits.length, raw: text };
}

function parseFounderLike(raw) {
  try {
    const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    for (const c of balancedCandidates(text, 5)) { const p = parseLenient(c); if (p && Array.isArray(p.mutations)) return p.mutations.filter((m) => m && typeof m === 'object'); }
  } catch (err) { /* nothing usable */ }
  return [];
}

export function rebuildRunWords(result) {
  if (!result) return 'nothing to rebuild from';
  return 'rebuilt the standings: let go of ' + result.cleared + ', wrote ' + result.digits + ' from the brief’s digits, ' + result.applied.length + ' from the pages and the record' + (result.rejected.length ? ' (' + result.rejected.length + ' refused)' : '');
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
  const briefWins = result.issues.filter((i) => i.pages && i.fix).length;
  if (briefWins) bits.push(`${briefWins} the brief wins — ${result.mendedPages || 0} ${result.mendedPages === 1 ? 'page' : 'pages'} mended, the record corrected`);
  const seen = result.issues.filter((i) => !i.mutations.length && !(i.pages && i.fix)).length;
  if (seen) bits.push(`${seen} seen, nothing to change`);
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
