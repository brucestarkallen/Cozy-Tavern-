/* Cozy Tavern — agents/world.js
 * M29: the world agent — the sandbox.
 *
 * Every worker before this one RECORDED: the extractor wrote down what the
 * page said, the scribe kept the people true, the keeper folded old pages.
 * None of them moved the world. Aurora left the station three turns ago and
 * stayed on the platform forever, because nothing ever asked where she is
 * NOW. In the old 45k-token preset the storyteller did that work in its
 * own head each turn (Living World, ACW, TWB, The World Advances, The Clock
 * Governs Availability) — against a transcript full of its own stale
 * watchlists. That is the drift the writer felt after 90k tokens.
 *
 * The world agent takes that work off the page. After each finished page
 * it reads the ledger and the page, then advances the world by the clock:
 * where the absent are right now and what they want; who is moving toward
 * the main character and when they arrive; what has ripened out of sight
 * and whom it reached; what each present person witnessed; whether a
 * faction moved; who must now exist. It writes all of that into the ledger
 * through the closed vocabulary (validated, logged, undoable like any
 * other change), and it leaves a short BRIEF for the storyteller — what
 * could reach this scene next turn and when, what ripened, and at most one
 * window into the world beyond. The storyteller gets a specific world and
 * keeps only the beat and the last look for itself.
 *
 *   worldTurn({connection, storyId, userText, assistantText, brief,
 *              castNotes, signal, stale})
 *     -> {applied, rejected, brief} | null when there was nothing to read
 *
 * Laws:
 *   - Runs AFTER the extractor (the page's own truth lands first), off the
 *     send path, through the workers' queue. Never on the critical path.
 *   - May write only the world beyond: offscreen.*, thread.*, knowledge.add,
 *     faction.set, people.set. It never touches the clock, the ground, who
 *     is present, bodies or standings — those are the page's to move.
 *   - Throws on transport failure (the queue retries); a garbled answer is
 *     an empty read, said out loud on the workers line.
 *   - Effort is the worker's setting (worldEffort, default 'off'): a cheap
 *     non-reasoning model does this well when the law is this explicit.
 */

import { db } from '../store.js';
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify, renderStateFacts } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { renderOffscreen } from '../engine/offscreen.js';
import { renderClock } from '../engine/clock.js';
import { mcName } from '../engine/duels.js';
import { renderThreads, renderKnowledge, renderFactions, normalizeBrief, STANCES } from '../engine/world.js';

const MAX_TOKENS = 6000; /* M37: room for a long founding even if a house thinks a little anyway */
export const WORLD_SHOWN_MAX = 6;

/* The only doors the world agent may open. Anything else it proposes is
 * dropped before the applier sees it (and counted, so the workers line can
 * say "and 2 it may not touch"). */
export const WORLD_TYPES = new Set([
  'offscreen.set', 'offscreen.clear', 'thread.set', 'thread.close', 'knowledge.add', 'faction.set', 'people.set',
]);

const VOCABULARY = [
  'offscreen.set {"type":"offscreen.set","name":"Aurora","location":"the 6:10 train, two stops out","activity":"reading his letter again","agenda":"confront him about it tonight","stance":"toward","etaMinutes":25} — where an ABSENT named person is RIGHT NOW at the hour on the clock, what they are doing, what they want next; stance is one of ' + STANCES.join(', ') + ' (toward = moving toward the main character, seeking = searching for them, tense = unresolved tension with them, busy = taken up with someone else, waiting = holding, want still nameable); etaMinutes = minutes until they reach the main character, ONLY when stance is toward or seeking',
  'offscreen.clear {"type":"offscreen.clear","name":"Aurora"} — when an elsewhere note no longer holds (she has arrived and the page shows it, or the thread is closed)',
  'thread.set {"type":"thread.set","title":"Aurora and the letter","owner":"Aurora","heat":"hot","next":"corner him before Liara leaves"} — a live agenda pushing toward the main character; heat hot|cold; next = what the owner will DO',
  'thread.close {"type":"thread.close","title":"Aurora and the letter"} — when it is resolved for good',
  'knowledge.add {"type":"knowledge.add","name":"Liara","fact":"saw Jovan leave the letter unread"} — one thing one person witnessed or was told, from THIS page; never what they might guess',
  'faction.set {"type":"faction.set","name":"the studio","stance":"quietly furious","agenda":"bury the story before Monday","move":"sent a lawyer to the hotel"} — a faction moves only on cause; move = what it just did',
  'people.set {"type":"people.set","name":"Dmitri Volkov","field":"core","text":"Jovan\'s manager; forty, sleepless, keeps three phones; loyal to the money first"} — ONLY for a NEW named person the world needs (a role that must be filled), their one-line core; then seat them with offscreen.set',
].join('\n');

function law({ mc, clockWords }) {
  const who = mc
    ? `The main character is ${mc}.`
    : 'The main character\'s name is not yet known; the writer plays the one whose actions they type.';
  return [
    'You keep the world beyond the page for a slow story told between two writers. The storyteller',
    'writes only what stands in front of the main character. You keep everything else alive: where the',
    'absent are, what they want, what is ripening out of sight, who is moving toward the scene and when',
    'they will arrive, who knows what. You never write a word of the story. You write the ledger, and',
    'a short brief for the storyteller.',
    '',
    who,
    clockWords ? `The hour on the clock is ${clockWords}.` : 'The clock is not set; reckon time in turns and plain words.',
    '',
    'Read the ledger, then the page just finished, then ADVANCE THE WORLD BY THE CLOCK:',
    '',
    'THE ABSENT. Every named person not in the scene has a life — including one the page only names in',
    'passing ("my sister Kim would laugh if she saw us"): from that line on, Kim exists; give her a',
    'one-line core with people.set and seat her somewhere with a want. A person referred to only by',
    'RELATION to someone known — "your mother" said to Kendall, "his manager", "her ex" — exists from',
    'that line on exactly the same way: name them and seat them. THE REAL RECORD: when the anchor is a',
    'real person or a character from an established canon (a public figure, a franchise), the relation',
    'is filled from the real record, not invented — Kendall Jenner\'s mother is Kris Jenner; her sisters',
    'are Kim, Khloé, Kourtney and Kylie — and a real person\'s core is drawn from their public record',
    '(role, family, known history and traits). Never rename a real person, never give them a made-up',
    'relative where the record has one; invent only where the record is silent. For each absent person the ledger',
    'or the pages know: where are they RIGHT NOW at this hour, what are they doing, what do they WANT next. An agenda',
    'is a want, never a status — "resting" is not an agenda; if you cannot name the want, leave them',
    'unseated. The clock governs availability: at small hours most people sleep, and whoever is up is up',
    'for a reason. Someone moving toward the main character gets stance "toward" and an ETA; before the',
    'ETA they are on the road, never early. A change from what the ledger says needs a cause — a silent',
    'flip is an error, not variety. Someone the page shows arriving is the extractor\'s to seat; you clear',
    'their elsewhere note.',
    '',
    'THREADS. Two or three hot threads at most — someone\'s agenda pushing toward the main character.',
    'Cold threads sleep until agendas cross again. Name what each thread\'s owner will do NEXT.',
    '',
    'RIPENING. Rumors travel at the speed of people. A deadline closes when the clock says. A plan lands',
    'when its owner is in position. Write down what has ripened THIS turn and whom it has reached —',
    'never what would be dramatic.',
    '',
    'WHO KNOWS WHAT. From the page: what did each present person witness or hear this turn? Add it.',
    'Nobody knows what happened where they were not; a cut-away is a window for the reader, never a',
    'pathway for anyone inside it.',
    '',
    'FACTIONS. A faction moves only on cause. When it moved, write its stance and its move.',
    '',
    'NEW PEOPLE. Roles must be filled — a manager, a bodyguard, a landlord, a mother, a rival. And a',
    'place implies its people: a childhood home implies the neighbor who never moved, the friend from',
    'school still on the street, the sister\'s sister-in-law; a bar implies its regulars; a set implies its',
    'crew. When the world needs someone who must exist, or a place\'s own people have a motive that could',
    'cross the main character\'s presence (she saw the car pull in from her window), name them (a unique',
    'name fitted to the setting), give them a one-line core with people.set, and seat them elsewhere',
    'with a want. At most one new named person per page unless the page itself demands more. Invention',
    'is the job; contradicting what the writer\'s brief states is the only ban.',
    '',
    'THE BRIEF. Then the storyteller\'s word for the next turn, three parts, each short plain sentences:',
    '  pressure — what could reach this scene next turn and when: an arrival on the clock, a runner, an',
    '    interruption, a stranger whose ordinary motive crosses the main character\'s presence (a vendor, a',
    '    fan, a pickpocket). Small, locale-true, at most one such contact per scene and not every scene, and',
    '    NEVER on a timer — only when a cause on the ledger produces it. Empty is a valid and common answer.',
    '  ripe — what ripened and whom it reached, one line each. Empty when nothing did.',
    '  twb — at most ONE window into the world beyond, only when something CHANGED since that thread was',
    '    last shown (the list of windows already opened is below) and it does something (a decision, a',
    '    discovery, a confrontation, a plan). Two absent people who share a place and a stake talk to',
    '    each other — that is a window worth opening, and what each learns goes into knowledge.add.',
    '    {"who","where","changed"}. null is the common answer.',
    '',
    'SYMMETRY. The world bends for no one — no gifts on a timer, no ambushes on a timer. Outcome follows',
    'cause. Be conservative about the page (only what it shows), generous about the world (invent what',
    'must exist). Never move the clock, the ground, who is present, bodies or standings — those are the',
    'page\'s to move, and any such mutation you write is dropped.',
    '',
    'Answer with JSON ONLY, exactly this shape:',
    '{"mutations":[ ... ], "brief":{"pressure":[ ... ],"ripe":[ ... ],"twb":null}}',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    'Names keep the spelling the ledger uses. No commentary, no fences: the JSON object only.',
  ].join('\n');
}

const FENCE = '"""';

function shownWindows(state) {
  const list = Array.isArray(state && state.worldShown) ? state.worldShown : [];
  return list.slice(-WORLD_SHOWN_MAX).map((w) => {
    const bits = [w.who, w.where].filter(Boolean).join(', ');
    return '  - ' + (bits ? bits + ': ' : '') + (w.changed || '') + (Number.isFinite(w.atTurn) ? ' (turn ' + w.atTurn + ')' : '');
  }).join('\n');
}

function characterCores(state) {
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const lines = [];
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object') continue;
    const core = typeof c.core === 'string' ? c.core.trim() : '';
    const st = typeof c.state === 'string' ? c.state.trim() : '';
    if (!core && !st) continue;
    lines.push(name + ' — ' + [core, st ? 'now: ' + st : ''].filter(Boolean).join(' | '));
    if (lines.length >= 20) break;
  }
  return lines.join('\n');
}

/* Exported for the harness: the two messages the worker receives. */
export function buildWorldMessages({ state, userText, assistantText, before = [], brief = '', castNotes = '' }) {
  const clockMinutes = state && state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const clockWords = state && state.clock ? (renderClock(state.clock) || '') : '';
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  const present = Array.isArray(state.present) ? state.present : [];
  const facts = renderStateFacts(state) || 'Nothing is written in the ledger yet.';
  const elsewhereAll = renderOffscreen(state.offscreen, present, clockMinutes, 40);
  const threads = renderThreads(Array.isArray(state.threads) ? state.threads.filter((t) => t && typeof t === 'object' && t.title) : []);
  const knowledge = renderKnowledge(state.knowledge, present);
  const factions = renderFactions(state.factions);
  const cores = characterCores(state);
  const user = [
    'THE LEDGER (the state of the scene):',
    facts,
    '',
    'EVERYONE WRITTEN ELSEWHERE (the absent, as last known — advance each by the clock or leave them):',
    elsewhereAll || 'No one is written elsewhere yet.',
    '',
    'THREADS:',
    threads || 'None open yet.',
    '',
    'WHO KNOWS WHAT (the present):',
    knowledge || 'Nothing written yet.',
    '',
    'FACTIONS:',
    factions || 'None written yet.',
    '',
    'WINDOWS BEYOND THE PAGE ALREADY OPENED (never the same beat twice — a thread with nothing new is not eligible):',
    shownWindows(state) || 'None yet.',
    '',
    ...(cores ? ['THE PEOPLE, AS THE LEDGER KNOWS THEM:', cores, ''] : []),
    ...(brief && String(brief).trim() ? ['WHAT THIS STORY IS ABOUT, in the writer\'s words:', FENCE, String(brief).trim().slice(0, 2000), FENCE, ''] : []),
    ...(castNotes && String(castNotes).trim() ? ['WHO IS IN IT, in the writer\'s words:', FENCE, String(castNotes).trim().slice(0, 2000), FENCE, ''] : []),
    ...(before.length ? ['THE PAGES JUST BEFORE:', FENCE, before.map((b) => (b.role === 'user' ? 'The writer: ' : 'The storyteller: ') + String(b.text || '').slice(0, 1500)).join('\n\n'), FENCE, ''] : []),
    'THE WRITER JUST WROTE:',
    FENCE,
    String(userText || '').slice(0, 3000),
    FENCE,
    '',
    'AND THE STORYTELLER ANSWERED:',
    FENCE,
    String(assistantText || '').slice(0, 8000),
    FENCE,
    '',
    'Advance the world by the clock and write the brief. JSON only.',
  ].join('\n');
  return { system: withFictionFrame(law({ mc, clockWords })), user };
}

/* Exported for the harness. Thinking spans stripped, fences stripped, up to
 * five balanced candidates tried until one carries a mutations list or a
 * brief. Mutations outside WORLD_TYPES are counted, never applied. */
export function parseWorldAnswer(raw) {
  try {
    let text = String(raw || '');
    text = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    const candidates = balancedCandidates(text, 5);
    let parsed = null;
    for (const c of candidates) {
      const p = parseLenient(c);
      if (p && typeof p === 'object' && (Array.isArray(p.mutations) || (p.brief && typeof p.brief === 'object'))) { parsed = p; break; }
    }
    if (!parsed) return { mutations: [], dropped: 0, brief: null, note: 'unusable' };
    const list = Array.isArray(parsed.mutations) ? parsed.mutations : [];
    let dropped = 0;
    const mutations = [];
    for (const m of list) {
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') { dropped += 1; continue; }
      if (!WORLD_TYPES.has(m.type.trim())) { dropped += 1; continue; }
      mutations.push(m);
    }
    const brief = parsed.brief && typeof parsed.brief === 'object' ? parsed.brief : null;
    return { mutations, dropped, brief, note: mutations.length || brief ? 'ok' : 'empty' };
  } catch (err) {
    return { mutations: [], dropped: 0, brief: null, note: 'unusable' };
  }
}

/* The contract. Resolves null when there was nothing to read; otherwise
 * {applied, rejected, dropped, brief, note}. Throws on transport failure. */
export async function worldTurn({ connection, storyId, userText, assistantText, before = [], brief = '', castNotes = '', effort = 'off', signal, stale } = {}) {
  if (!connection || typeof connection !== 'object') return null;
  if (!storyId) return null;
  if (!assistantText || !String(assistantText).trim()) return null;

  const state = await loadState(storyId);
  const prompt = buildWorldMessages({ state, userText, assistantText, before, brief, castNotes });
  /* M31: an answer we can't use earns ONE second ask with a sharper word;
   * the raw answer rides out so the drawer can show it. */
  let read = null;
  let raw = '';
  let user = prompt.user;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text, finishReason } = await callWorker(connection, {
      system: prompt.system,
      user,
      maxTokens: MAX_TOKENS,
      effort,
      signal,
    });
    raw = text;
    read = parseWorldAnswer(text);
    if (finishReason === 'length' && read.note === 'unusable') read.note = 'cut short';
    if (read.note !== 'unusable' && read.note !== 'cut short') break;
    user = prompt.user + '\n\nYour last answer was not a JSON object with "mutations" and "brief". Answer with the JSON object only — no words before or after it, and keep it short.';
  }
  if (read.note === 'unusable' || read.note === 'cut short') return { applied: [], rejected: [], dropped: 0, brief: null, note: read.note, raw };
  if (stale && stale()) return null;

  /* Re-read at write time — the ledger may have moved (the extractor's
   * masthead, a hand edit) while the world was being read. */
  const fresh = await loadState(storyId);
  /* M40: everyone the agent seats has a page. A seat without a people.set
   * in the same answer gets a minimal core from the seat itself, so the
   * character ledger never shows two people while "elsewhere" shows three;
   * the scribe enriches it later. */
  const known = new Set(Object.keys(fresh.characters || {}).map((k) => k.trim().toLowerCase()));
  const pagesInAnswer = new Set(read.mutations.filter((m) => m.type === 'people.set' && typeof m.name === 'string').map((m) => m.name.trim().toLowerCase()));
  const withPages = [];
  for (const m of read.mutations) {
    if (m.type === 'offscreen.set' && typeof m.name === 'string' && m.name.trim()) {
      const key = m.name.trim().toLowerCase();
      if (!known.has(key) && !pagesInAnswer.has(key)) {
        const bits = [m.activity, m.agenda ? 'wants ' + m.agenda : '', m.location ? 'at ' + m.location : ''].filter(Boolean);
        withPages.push({ type: 'people.set', name: m.name.trim(), field: 'core', text: (bits.join('; ') || 'seated by the world agent').slice(0, 280) });
        pagesInAnswer.add(key);
      }
    }
    withPages.push(m);
  }
  const { state: next, applied, rejected } = applyMutations(fresh, withPages);
  const turnNow = Number.isFinite(next.turn) ? next.turn : 0;
  const normalized = read.brief ? normalizeBrief(read.brief, turnNow) : null;
  /* M30: a window opened is a window remembered — the agent is shown the
   * last six so "never the same beat twice" is a mechanism, not a wish. */
  const shown = Array.isArray(next.worldShown) ? next.worldShown.slice() : [];
  if (normalized && normalized.twb) shown.push({ ...normalized.twb, atTurn: turnNow });
  const out = { ...next, worldBrief: normalized, worldShown: shown.slice(-WORLD_SHOWN_MAX) };
  if (stale && stale()) return null;
  await saveState(storyId, out);
  notify(storyId);
  return { applied, rejected, dropped: read.dropped, brief: normalized, note: read.note, raw };
}

/* The workers-line words for one run. */
export function worldRunWords(result) {
  if (!result) return 'nothing to read';
  if (result.note === 'unusable') return 'its answer could not be used';
  if (result.note === 'cut short') return 'its answer ran out of room';
  const n = result.applied ? result.applied.length : 0;
  const bits = [];
  bits.push(n ? `moved the world in ${n} ${n === 1 ? 'way' : 'ways'}` : 'the world stood still');
  /* M37: say what moved, not only how much */
  if (n) bits.push(result.applied.slice(0, 4).map((a) => a.words.replace(/\.$/, '')).join(' · ') + (n > 4 ? ' · …' : ''));
  if (result.brief && !result.brief.empty) bits.push('left the world’s word');
  if (result.rejected && result.rejected.length) bits.push(`${result.rejected.length} refused`);
  if (result.dropped) bits.push(`${result.dropped} it may not touch`);
  return bits.join(', ');
}

/* App-wide switch, default ON; a story may say otherwise (story.world). */
export async function worldAgentOn(story) {
  if (story && story.world === false) return false;
  if (story && story.world === true) return true;
  const v = await db.settings.get('worldAgent');
  return v !== false;
}

export async function worldEffort() {
  const v = await db.settings.get('worldEffort');
  return typeof v === 'string' && v ? v : 'off';
}
