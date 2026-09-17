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

import { writerText, BRIEF_ROOM, CAST_ROOM, nearNames, leanPage, LEAN_STEPS } from '../engine/whole.js'; /* M283; M288: the lean steps */
import { db } from '../store.js';
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify, headerMutations } from '../engine/state.js';
import { applyMutations, RETIRED_EXAMPLE_NAMES , storyTurn, findPresent } from '../engine/apply.js';
import { findSeat } from '../engine/offscreen.js';
import { findThread } from '../engine/world.js';
/* M240: it was told to catch a healed wound and never shown the wounds.
 * M259: and it was shown the storyteller's TRIMMED copy of everything else —
 * six standings, five threads, four things a person knows, no ground at all.
 * It reads the whole ledger now (engine/whole.js). */
import { renderWholeLedger, wholePage, PAGE_CAP } from '../engine/whole.js';
import { askWithFetch, fetchLaw, roomChars, viewBudget, leashFor } from './lookup.js'; /* M259: it looks for what it was not shown */
import { messageIndexLine, refOf } from './housekeeper.js';
import { mcName } from '../engine/duels.js';
import { isMc, namedInText, findPersonKey } from '../engine/people.js'; /* M277: the main character holds no standing; M304: one matcher for "the writer's material names them" */
import { explicitStandings, readStatedStandings, samePersonLoose, isLabel } from './founder.js'; /* M49/M50: the writer's digits, read the way the brief is shaped */
import { loadMemory, wholeRecord, recordWithPages } from './memory.js'; /* M51: the whole record, not the summarizer's tail */
import { pageText } from '../assemble/stack.js';

const MAX_TOKENS = 6000;
export const DEFAULT_AUDIT_EVERY = 1; /* turns — M94: every page, as Summaryception's continuity auditor runs on every line */
export const AUDIT_PAGES = 10;        /* the fewest pages the auditor reads word for word (and the mender's reach) */
/* M259: a page is read to its end (engine/pagecut.js); past this, its middle is
 * shortened and it says how to fetch it whole. */
export const AUDIT_PAGE_CAP = 24000;
/* M261: QUALITY FIRST. Every page the record has not folded is shown whole,
 * into the connection's whole room — the writer's order: the auditor sees
 * all of them. Only what does not fit stands in the index, to be fetched. */
export const AUDIT_VIEW_CHARS = Infinity;
export const AUDIT_RECORD_CAP = 120000; /* the whole record — not the storyteller's 30,000 */
const BRIEF_CAP = 40000;                /* the brief is the first authority; it was cut at 4,000 */
const CAST_CAP = 20000;

const VOCABULARY = [
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30} — to the latest header line\'s own hour, or when the latest STORY page has none',
  'place.set {"type":"place.set","name":"the chapel"} — to the latest header line\'s own place, or when the latest STORY page has none',
  'presence.enter {"type":"presence.enter","name":"NAME"} / presence.leave {"type":"presence.leave","name":"NAME"}',
  'mc.set {"type":"mc.set","name":"MAIN CHARACTER"} — only when the ledger has no main character',
  'body.injure {"type":"body.injure","name":"NAME","what":"…","sev":1-3} / body.heal {"type":"body.heal","name":"NAME","what":"…"}',
  'rel.set {"type":"rel.set","name":"…","p":..,"r":..,"s":..,"cause":"the brief says"} — only to restore a standing that is wrongly zero, or to zero one written for someone else',
  '  (never to start or move a standing from a page — a beat is the page reader\'s, and the brief\'s digits are restored by the house; never one for the main character;',
  '  never one the brief sets toward someone else — the cause says what the brief sets toward the main character)',
  'offscreen.set {"type":"offscreen.set","name":"NAME","location":"…","activity":"…","agenda":"…","stance":"toward|seeking|tense|busy|waiting","etaMinutes":25} / offscreen.clear {"type":"offscreen.clear","name":"NAME"}',
  'canon.lock {"type":"canon.lock","name":"NAME","key":"hair","value":"black"} / canon.unlock {"type":"canon.unlock","name":"NAME","key":"hair"}',
  'thread.set {"type":"thread.set","title":"…","owner":"…","heat":"hot|cold","next":"…"} / thread.close {"type":"thread.close","title":"…"}',
  'knowledge.add {"type":"knowledge.add","name":"OTHER NAME","fact":"…"}',
  'faction.set {"type":"faction.set","name":"…","stance":"…","agenda":"…","move":"…"}',
  'people.set {"type":"people.set","name":"NAME","field":"core|state|arc","text":"…"} — the main character\'s core and arc are never written',
  'people.note {"type":"people.note","name":"NAME","field":"unthread","text":"the loose end as it stands"} \u2014 closes ONE finished loose end (field "thread" opens one); matched by sense, so word it close to how it reads',
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
    'THE LEDGER YOU ARE SHOWN IS ALL OF IT: every standing, every open thread, every line of who',
    'knows what, every seat, every lock. A thing not listed is not in the ledger; a thing listed in',
    'other words is ALREADY in it — never write it again. Name a thread exactly as its title is quoted.',
    'THE PAGES: every page the record has not folded is shown whole when it fits; any that do not',
    'fit stand in an index, and every page of the story, folded or not, can be fetched by its number.',
    '',
    fetchLaw({ when: 'Look before you judge: never report something missing, wrong or unwritten on the strength of a page you were not shown whole — fetch it (or find the words) first. A record line names the pages it covers; fetch them to check the line.' }),
    '',
    'Find every place the ledger disagrees with those truths, and every place it is missing something',
    'the pages plainly established:',
    '  - THE HOUR AND THE GROUND: when the latest STORY page opens with a header line',
    '    [Place — Day, Date | HH:MM | …], that line is the truth for both, and the house writes it into',
    '    the ledger in code; set them only to what that line says, never to anything else. When the',
    '    latest page has NO header line and the ground or the hour on the ledger plainly disagrees',
    '    with where and when that page stands, set them.',
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
    '    on judgment; raising a wrongly-zeroed standing is a correction you can prove. A standing',
    '    the PAGES have moved (its latest causes quote a beat) is never yours to set, up or down, and',
    '    how far a beat moved a standing is the page reader\'s to write, never yours.',
    '  - THE THREADS: a thread the pages show resolved still hot (thread.close); a live agenda the',
    '    pages show and the ledger lacks (thread.set).',
    '  - THE LOOSE ENDS ON A PERSON\'S OWN PAGE (their "Loose ends:" line, which is NOT the same as',
    '    the story threads above): one the pages have plainly ANSWERED and is still written there —',
    '    a question asked and answered, an introduction promised and made, a photo hunted and found,',
    '    a name waited for and spoken. Close it with people.note {field:\"unthread\"}, worded as it stands on the page.',
    '    These do not expire on their own, and one left open is carried to the storyteller as',
    '    something still hanging for the rest of the tale.',
    '  - WHO KNOWS WHAT: a present person who plainly witnessed something on the latest pages with no',
    '    knowledge line for it (knowledge.add).',
    '',
    'Be exact and be conservative: only what the brief states or the pages show, never what would be',
    'nice. If the ledger is true to the story, say so with an empty list — that is a good answer.',
    '',
    'THE MAIN CHARACTER HAS NO CHARACTER PAGE, by design — the writer plays them. Never report it',
    'missing, never write one.',
    'REPORT ONLY WHAT IS WRONG. A check that found nothing wrong is not a finding: never write a',
    'line that says a thread, a lock, a standing or a knowledge line "stands as written" or "is',
    'complete" — say nothing about it. An empty issues list is the best answer there is.',
    '',
    'NOT YOUR JOB — THE MOMENT: posture, position, dress, the mood board, what a hand is doing, a sip taken, a knee on the',
    'vinyl, clothing of the moment, an absent person\'s activity this hour, a thread\'s next small',
    'step, a character page\'s "now" line. The extractor, the world agent and the scribe rewrite',
    'those after EVERY page; the ledger you read describes the moment BEFORE the latest page, and a',
    'page that moves a body is the story moving, not an error. Never report them, never "update"',
    'them. Yours is what LASTS and what is WRONG: the wrong name, age, kin, origin, role; a person',
    'present who left pages ago or absent who is plainly here; a wound healed still open; a standing',
    'wrongly zero; a thread the pages closed still hot or a live agenda missing; a witnessed fact',
    'with no knowledge line; the clock or the ground wrong on a page with no header line; a duplicate.',
    'A reading with two or three findings is usual; a reading with fifteen is a reading of the',
    'moment, and wrong.',
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
    'A PLAYER page states what the main character ATTEMPTS; only the STORY page after it makes it so.',
    'Never write a fact from a PLAYER page alone — where the main character went, what they did — unless a',
    'STORY page rendered it. The pages you are given end on a STORY page for that reason.',
    'Names keep the spelling the ledger and the pages use. No commentary, no fences: the JSON only.',
    'PLACEHOLDERS: NAME, OTHER NAME, NEW NAME, NAME SURNAME and MAIN CHARACTER in the examples above are placeholders, never people — never write them; write only the names the ledger, the brief and the pages use.',
  ].join('\n');
}

const FENCE = '"""';

/* M287: A LEDGER THAT OUTGROWS THE READING IS SHOWN LEAN, NOT REFUSED. Every
 * page ever written rode whole, the passed-through with the rest — a long tale
 * of many faces took the auditor's prompt past its model's room, and every
 * reading was refused (an amber light for good). level 1: the passed-through
 * by name; 2: arcs and loose ends only for those near the story (here, seated
 * or with a standing); 3: what they are doing now, likewise. */
function characterPages(state, level = 0) {
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const names = nearNames(state);
  const lines = [];
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object') continue;
    const p = leanPage(names, name, c, level);
    if (!p) { lines.push(name + ' (passed through)'); continue; }
    const bits = [];
    if (p.core) bits.push('core: ' + p.core);
    if (p.state) bits.push('now: ' + p.state);
    if (p.arc) bits.push('arc: ' + p.arc);
    if (p.threads.length) bits.push('loose ends: ' + p.threads.join('; '));
    lines.push(name + (c.retired ? ' (passed through — out of the story until a page names them)' : '') + ' — ' + bits.join(' | '));
  }
  return lines.join('\n');
}

/* Exported for the harness. */
export function buildAuditorMessages(args) {
  /* M287: shown lean, a step at a time, while the reading would take more than 60% of its room */
  const room = Number.isFinite(args && args.room) && args.room > 0 ? args.room : Infinity;
  let built = buildAuditorAt(args, 0);
  for (let level = 1; level <= LEAN_STEPS && built.system.length + built.user.length > room * 0.6; level += 1) built = buildAuditorAt(args, level);
  return built;
}
function buildAuditorAt({ state, brief = '', castNotes = '', record = '', pages = [], index = [], pageCount = 0 }, lean = 0) {
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  /* M259: the WHOLE ledger — every standing with its numbers, every thread,
   * every line of who knows what, every seat, lock, wound and faction, and
   * the ground (engine/whole.js). */
  const whole = renderWholeLedger(state) || 'Nothing is written in the ledger yet.';
  const people = characterPages(state, lean);
  const user = [
    'THE BRIEF (the writer\'s own words):',
    FENCE, writerText(brief, BRIEF_ROOM, 'brief', true) || '(none written)', FENCE, /* M283: to its room, a stated cut past it */
    ...(castNotes && String(castNotes).trim() ? ['WHO IS IN IT (the writer\'s own words):', FENCE, writerText(castNotes, CAST_ROOM, 'cast notes', true), FENCE] : []),
    '',
    /* M259: what changes least comes first, the ledger (which changes every
     * page) last — so the house can reuse what it already read of the brief,
     * the record and the older pages instead of reading them all again. */
    'THE RECORD (the folded pages, oldest to newest; each line names the pages it covers):',
    FENCE, String(record || '').trim() || '(nothing recorded yet)', FENCE,
    '',
    'THE PAGES THE RECORD HAS NOT YET FOLDED, word for word (the last is the present):',
    FENCE,
    (Array.isArray(pages) ? pages : []).map((p) => {
      const label = Number.isInteger(p.ordinal)
        ? '[p' + p.ordinal + (p.ref ? ' ' + p.ref : '') + (p.cut ? ' — shortened; fetch "' + p.ordinal + '" for all of it' : '') + '] '
        : '';
      return label + (p.role === 'assistant' ? 'STORY: ' : 'PLAYER: ') + String(p.text || '');
    }).join('\n\n'),
    FENCE,
    '',
    ...(Array.isArray(index) && index.length
      ? ['MORE PAGES THE RECORD HAS NOT FOLDED — no room to show them above; fetch any by its number:', ...index, '']
      : []),
    ...(pageCount ? ['The story has ' + pageCount + ' pages; any of them, folded or not, is served whole by its number.', ''] : []),
    'THE LEDGER, ALL OF IT (as it stood before the latest page):',
    whole,
    '— the character pages —' + (lean ? ' (shown lean for this reading: the ledger is larger than its room \u2014 the pages of those away are shortened; the ones here are whole; fetch "person: NAME" for any page whole)' : ''), people || '(none)',
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
        what: i.what.trim().slice(0, 4000), /* M267: whole — it was cut at 300, mid-word */
        fix: typeof i.fix === 'string' ? i.fix.trim().slice(0, 4000) : '',
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
/* M110: the pages up to the last STORY page — a trailing writer's page is an attempt, not a fact */
export function answeredOnly(list) {
  const arr = Array.isArray(list) ? list : [];
  let cut = arr.length;
  while (cut > 0 && arr[cut - 1] && arr[cut - 1].role === 'user') cut -= 1;
  return arr.slice(0, cut);
}

/* M259: the room the auditor's connection has, in characters (about three a
 * token, less the answer's own budget). A connection with no size set is
 * taken at 128,000 tokens, the smallest house the writer uses. */
/* M259: THE LEASH FOR ONE BIG CALL. A worker's call is cut off after sixty
 * seconds; an auditor that reads the whole ledger, the whole record and every
 * unfolded page can be handed a hundred thousand tokens, and reading them is
 * honest work. A minute, and a second more for every four thousand characters
 * it is handed. */
export function auditLeashMs(prompt) {
  const size = prompt ? String(prompt.system || '').length + String(prompt.user || '').length : 0;
  return 60000 + Math.ceil(size / 4000) * 1000;
}

export function auditRoomChars(connection) {
  return roomChars(connection, MAX_TOKENS); /* M261: one measure of a room, for every reader */
}

/* M259: what the auditor is shown of the pages the record has not folded —
 * the newest whole, into AUDIT_VIEW_CHARS (the latest story page always, to
 * its end); the older ones as index lines it can fetch by number. */
export function auditView(list, foldedTo, budget = AUDIT_VIEW_CHARS) {
  const all = Array.isArray(list) ? list : [];
  const shown = [];
  const index = [];
  if (!all.length) return { shown, index };
  const from = Number.isFinite(foldedTo) ? foldedTo : 0;
  const start = Math.max(0, Math.min(from, all.length - AUDIT_PAGES));
  /* no room left means the present page alone — never "no limit" */
  let left = Number.isFinite(budget) ? Math.max(0, budget) : Infinity;
  let full = true;
  let latestStory = true;
  for (let i = all.length - 1; i >= start; i -= 1) {
    const m = all[i];
    const text = pageText(m);
    const isLatest = latestStory && m.role === 'assistant';
    if (isLatest) latestStory = false;
    const t = wholePage(text, isLatest ? PAGE_CAP : AUDIT_PAGE_CAP);
    if (!isLatest && (!full || t.length + 60 > left)) {
      full = false;
      index.unshift('p' + (i + 1) + ' ' + messageIndexLine(m));
      continue;
    }
    shown.unshift({ ordinal: i + 1, ref: refOf(m), role: m.role, text: t, cut: t.length !== text.length });
    left -= t.length + 60;
  }
  return { shown, index };
}

export async function auditLedger({ connection, storyId, brief = '', castNotes = '', castNames = [], signal, stale, renew } = {}) {
  if (!connection || typeof connection !== 'object' || !storyId) return null;
  const state = await loadState(storyId);
  const mem = await loadMemory(storyId);
  const allRaw = (await db.messages.list(storyId)).filter((m) => !m.hidden);
  /* M110: a writer's page with no storyteller page after it is an ATTEMPT,
   * not yet true — "I go downstairs" moves nobody until the page renders
   * it. The auditor read the trailing unanswered message as a fact and
   * seated the main character downstairs; the story had not. Answered
   * turns only. */
  const all = answeredOnly(allRaw);
  if (!all.length) return null;
  /* M259: EVERY PAGE THE RECORD HAS NOT FOLDED, and the WHOLE record. It read
   * the last ten pages and a record trimmed to the storyteller's 30,000
   * characters — so with a window of twenty or thirty pages, the pages
   * between the record's end and the last ten were read by NOBODY, and a
   * long tale's oldest lines fell off the front. The room is the
   * connection's own. */
  const room = auditRoomChars(connection);
  const record = recordWithPages(mem, Math.max(20000, Math.min(AUDIT_RECORD_CAP, Math.floor(room * 0.35))));
  const foldedTo = Math.max(0, ...((mem && Array.isArray(mem.nodes)) ? mem.nodes : []).filter((n) => n && Array.isArray(n.span)).map((n) => n.span[1] + 1));
  const bare = buildAuditorMessages({ state, brief, castNotes, record, pages: [], pageCount: all.length, room }); /* M287: the audit's own room */
  const view = auditView(all, foldedTo, Math.min(AUDIT_VIEW_CHARS, viewBudget(connection, MAX_TOKENS, bare.system.length + bare.user.length)));
  if (!view.shown.length) return null;
  const prompt = buildAuditorMessages({ state, brief, castNotes, record, pages: view.shown, index: view.index, pageCount: all.length, room });
  let read = null;
  let raw = '';
  let user = prompt.user;
  const looked = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    /* M259: it may look — any page whole, a search, the whole brief — in the
     * housekeeper's words, served by the housekeeper's server */
    const { text, finishReason, looked: seen } = await askWithFetch(connection, {
      system: prompt.system, user, maxTokens: MAX_TOKENS, signal, renew,
      leash: leashFor,
      isAnswer: (t) => parseAuditorAnswer(t).note === 'ok',
      source: { storyId, messages: allRaw, memory: mem, story: { brief, castNotes }, state }, /* M288: "person: NAME" */
      room,
      rounds: attempt === 0 ? undefined : 1, /* a second ask looks once at most */
    });
    looked.push(...(seen || []));
    raw = text;
    read = parseAuditorAnswer(text);
    if (finishReason === 'length' && read.note === 'unusable') read.note = 'cut short';
    if (read.note === 'ok') break;
    user = prompt.user + '\n\nYour last answer was not a JSON object with an "issues" list. Answer with the JSON object only, and keep it short.';
  }
  if (read.note !== 'ok') return { applied: [], rejected: [], issues: [], note: read.note, raw, looked };
  if (stale && stale()) return null;
  const fresh = await loadState(storyId);
  /* M259: the latest STORY page's header line has already written the ground
   * and the hour in code (M128/M131) — the auditor never overrides it. */
  const latestStory = [...all].reverse().find((m) => m && m.role === 'assistant' && !m.ooc);
  const header = latestStory ? headerMutations(pageText(latestStory)) : [];
  read.issues = auditorScope(read.issues, fresh, { header }); /* M128: the moment never lands from an audit */
  /* M267: A CHECK THAT FOUND NOTHING IS NOT A FINDING. The writer counted
   * fourteen "mistakes" in a reading that changed three things: the rest were
   * the auditor listing what it had checked and found right ("the thread
   * stands as written", "the locks match the brief"). Told not to, it did; a
   * line with no change that says so of itself is dropped here. */
  read.issues = read.issues.filter((i) => i.mutations.length || (i.pages && i.fix) || !saysAllIsWell(i));
  /* M48: the auditor may not take a standing away on judgment. A rel.set
   * that lowers a standing is refused when that standing has ANY on-page
   * history (a cause the extractor wrote from a page) or when the person is
   * named in the brief or the cast notes (the founder's bond stands). Only
   * a standing with no page behind it and no place in the brief — the
   * Caleb case, a feeling for someone else — may be zeroed. */
  const material = (String(brief || '') + '\n' + String(castNotes || '')).toLowerCase();
  const keptStandings = [];
  const guarded = [];
  const mcHere = mcName(fresh) !== 'the player' ? mcName(fresh) : '';
  for (const [m, issueWhat] of read.issues.flatMap((i) => i.mutations.map((mu) => [mu, i.what]))) {
    if (m && (m.type === 'rel.set' || m.type === 'rel.shift') && typeof m.name === 'string') {
      const key = Object.keys(fresh.relationships || {}).find((k) => k.trim().toLowerCase() === m.name.trim().toLowerCase());
      const rel = key ? fresh.relationships[key] : null;
      const lowering = m.type === 'rel.shift' ? Number(m.delta) < 0
        : rel ? ['p', 'r', 's'].some((ax) => Number.isFinite(m[ax]) && m[ax] < (rel[ax] || 0)) : false;
      const earned = Boolean(rel) && Array.isArray(rel.history) && rel.history.some((h) => h && typeof h.cause === 'string' && !/^the brief\b|^set\b|^the founder\b/i.test(h.cause.trim()));
      if (rel && lowering) {
        const inBrief = material.includes(m.name.trim().toLowerCase());
        if (earned || inBrief) {
          keptStandings.push({ mutation: m, why: (earned ? 'the standing was earned on the pages' : 'the brief names ' + m.name) + ' — the auditor may not take it away', standing: true });
          continue;
        }
      }
      /* M259: NOR RAISE ONE THE PAGES MOVED. The auditor restores a standing
       * that is wrongly ZERO; one the pages have moved is the page reader's.
       * Shown only the six strongest standings, it took the rest for missing
       * and "restored" them at the brief's level — which, for a standing the
       * pages had brought DOWN, erased what the story had earned. */
      const zero = !rel || (!(rel.p || 0) && !(rel.r || 0) && !(rel.s || 0));
      if (rel && !zero && earned && !lowering) {
        keptStandings.push({ mutation: m, why: 'the pages moved this standing — the auditor restores only a standing that is zero', standing: true });
        continue;
      }
      /* M277: NOR START ONE FROM A PAGE. A standing that is missing or zero
       * was the auditor's to fill with any value on any reason — so it wrote
       * standings "moved by the evening's events" for people who had not met
       * the main character, and one for the main character himself. A beat is
       * the page reader's; the brief's digits are restored by the house
       * (standingsHousekeeping). The auditor restores a zero standing only for
       * someone the brief or the cast notes name, on a reason that quotes them
       * — and may still zero one written for someone else. */
      const setsAny = m.type === 'rel.set' && ['p', 'r', 's'].some((ax) => Number(m[ax]));
      if (zero && setsAny) {
        const named = material.includes(m.name.trim().toLowerCase());
        const cause = String(m.cause || '');
        const quotes = /\b(brief|cast notes?)\b/i.test(cause);
        /* M278: A STANDING IS TOWARD THE MAIN CHARACTER. The brief gave Sophie
         * P:65 toward Emilia, and the auditor wrote it as her standing toward
         * Jovan on a bare "the brief says". A reason that says nothing of the
         * bond, or a reason or finding that says "toward" someone else, starts
         * nothing ("the brief says Mira is his sister" is about him, and may). */
        const bare = /^the (brief|cast notes?)(\s+(says|states|said))?\.?$/i.test(cause.trim());
        const towardOther = [...(cause + ' ' + String(issueWhat || '')).matchAll(/\btowards?\s+([A-Z][\p{L}'’-]+)/gu)]
          .some((x) => !mcHere || !samePersonLoose(x[1], mcHere));
        if (!named || !quotes || bare || towardOther || isMc(fresh, m.name)) {
          keptStandings.push({ mutation: m, why: 'a standing is started by the pages, not by the auditor', standing: true });
          continue;
        }
      }
    }
    guarded.push(m);
  }
  /* M57: passers-through retire in code — no bond, no seat, no thread, no
   * lock, not present, and thirty turns since their page last moved. */
  guarded.push(...wakeHousekeeping(fresh, { brief, castNotes, castNames })); /* M304 */
  guarded.push(...peopleHousekeeping(fresh, brief, castNotes, castNames));
  /* M95: the house's own example names, echoed into a ledger by a worker of an
   * older coat, are swept out unless the brief or the cast notes name them. */
  guarded.push(...exampleLeakHousekeeping(fresh, brief, castNotes));
  /* M103: seats have a life, in code — a passer-through the world agent kept
   * seated (a cab driver with "one clean fare") is cleared and retired the
   * moment the story stops carrying them; the pool is capped. */
  guarded.push(...seatHousekeeping(fresh, { brief, castNotes, castNames, pages: all.map((m) => ({ role: m.role, text: pageText(m) })) }));
  /* M50: the standings, kept clean in code — no judgment anywhere here. */
  const mcKnown = mcName(fresh) !== 'the player' ? mcName(fresh) : '';
  if (typeof renew === 'function') renew(); /* a fresh minute for the brief's digits */
  const statedByModel = await readStatedStandings({ connection, brief, castNotes, mc: mcKnown, signal });
  guarded.push(...standingsHousekeeping(fresh, brief, castNotes, mcKnown, statedByModel));
  const { state: next, applied, rejected: rejectedByApplier } = applyMutations(fresh, guarded);
  const rejected = [...rejectedByApplier.map((r) => (r && r.mutation && /^rel\./.test(r.mutation.type) && /holds no standing/.test(String(r.why || '')) ? { ...r, standing: true } : r)), ...keptStandings];
  /* M277: a standing move the auditor may not make is not a finding for the
   * writer — eleven such lines filled a reading that changed four things */
  const standingRefused = new Set([
    ...keptStandings.map((k) => k.mutation),
    ...rejectedByApplier.filter((r) => r && r.mutation && /^rel\./.test(r.mutation.type) && /holds no standing/.test(String(r.why || ''))).map((r) => r.mutation),
  ]);
  /* M259: THE REPORT SAYS WHAT LANDED. "Set right" meant "it wrote a change",
   * not "the change held": a thread closed under a reworded title was
   * refused, stayed open, and the report still said it was set right — then
   * found it again the next turn. And a finding whose every change the ledger
   * ALREADY held (the scene already stands there, the standing already reads
   * so) was the auditor misreading, not a fix: it is not reported at all. */
  const landedSet = new Set(applied.map((a) => a.mutation));
  const whyOf = new Map();
  for (const r of rejected) if (r && r.mutation) whyOf.set(r.mutation, r);
  const issues = [];
  let leftStandings = 0;
  for (const i of read.issues) {
    const landed = i.mutations.filter((m) => landedSet.has(m)).length;
    const missed = i.mutations.filter((m) => !landedSet.has(m));
    const alreadySo = (m) => Boolean(whyOf.get(m) && whyOf.get(m).same);
    if (!landed && missed.length && missed.every(alreadySo) && !(i.pages && i.fix)) continue;
    /* M277: a finding whose every change was a standing move the auditor may not make is not reported */
    if (!landed && missed.length && missed.every((m) => standingRefused.has(m) || alreadySo(m)) && !(i.pages && i.fix)) { leftStandings += 1; continue; }
    const refused = missed.filter((m) => !alreadySo(m) && !standingRefused.has(m)).map((m) => (whyOf.get(m) && whyOf.get(m).why) || 'it did not hold').slice(0, 3);
    issues.push({ ...i, landed, refused });
  }
  const report = { at: Date.now(), turn: storyTurn(next), leftStandings, issues: issues.map((i) => ({ what: i.what, fix: i.fix, pages: i.pages === true, fixable: i.mutations.length > 0 || (i.pages === true && Boolean(i.fix)), landed: i.landed, refused: i.refused })) };
  const out = { ...next, audit: report };
  if (stale && stale()) return null;
  await saveState(storyId, out);
  notify(storyId);
  return { applied, rejected, issues, note: 'ok', raw, looked, leftStandings };
}

/* M261: THE LEDGER'S UPKEEP DOES NOT WAIT FOR THE AUDITOR. Retiring those who
 * passed through, sweeping the house's own example names, clearing seats
 * nothing carries — all of it is code, and all of it ran only inside an audit.
 * Switch the auditor off, or read every fifth page, and the ledger stopped
 * being kept. This is the same upkeep, alone, for a page the auditor does not
 * read; every change is journaled like any other, with its take-back. */
export async function ledgerUpkeep({ storyId, brief = '', castNotes = '', castNames = [], stale } = {}) {
  if (!storyId) return null;
  const fresh = await loadState(storyId);
  const all = answeredOnly((await db.messages.list(storyId)).filter((m) => !m.hidden));
  const list = [
    ...wakeHousekeeping(fresh, { brief, castNotes, castNames }), /* M304 */
    ...peopleHousekeeping(fresh, brief, castNotes, castNames),
    ...exampleLeakHousekeeping(fresh, brief, castNotes),
    ...seatHousekeeping(fresh, { brief, castNotes, castNames, pages: all.map((m) => ({ role: m.role, text: pageText(m) })) }),
  ];
  if (!list.length) return { applied: [], rejected: [] };
  if (stale && stale()) return null;
  const { state: next, applied, rejected } = applyMutations(fresh, list);
  if (applied.length) {
    await saveState(storyId, next);
    notify(storyId);
  }
  return { applied, rejected };
}

/* M57: who has passed through. A person retires when ALL hold: not present;
 * no nonzero standing; no seat among the absent; no loose end on their page;
 * nothing locked true of them; not the main character; and their page has
 * not moved for RETIRE_AFTER turns. Woken by any page or entrance. */
export const RETIRE_AFTER = 30;
export function peopleHousekeeping(state, brief = '', castNotes = '', castNames = []) {
  const out = [];
  /* M280: THE WRITER'S OWN PEOPLE ARE NEVER RETIRED FOR BEING AWAY. A character
   * added to the brief at page 200 for page 240 had no bond, no seat and no
   * thread yet — and thirty quiet pages later lost the card the storyteller
   * reads. Named in the brief or the cast notes (whole name or first name), a
   * person waits as long as the story needs. */
  const material = (String(brief || '') + '\n' + String(castNotes || '')).toLowerCase();
  const wordIn = (w) => w.length >= 3 && new RegExp('(^|[^\\p{L}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\p{L}]|$)', 'u').test(material);
  const inBrief = (name) => {
    const full = String(name || '').trim().toLowerCase();
    if (!full || !material.trim()) return false;
    return wordIn(full) || wordIn(full.split(/\s+/)[0]);
  };
  const chars = state.characters && typeof state.characters === 'object' ? state.characters : {};
  /* M163: PAGES, like the stamp it is compared against. updatedAtTurn is
   * written in pages told (M162); this read state.turn, the write counter,
   * which runs three to five times faster — so a person last written ten
   * pages ago measured thirty and the auditor RETIRED them: card gone,
   * roster line gone, for a law that says thirty pages. Measured exactly
   * that before this fix. */
  const turn = storyTurn(state);
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
    if (inBrief(name)) continue; /* M280 */
    if ((Array.isArray(castNames) ? castNames : []).some((n) => samePersonLoose(n, name))) continue; /* M304: an invited card is the writer's own person too */
    if (c.hand && typeof c.hand === 'object' && Object.keys(c.hand).length) continue; /* M304: a page the writer wrote on by hand is never let go for being quiet */
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

/* M128: THE AUDITOR'S SCOPE, IN CODE. A cheap model reports the moment
 * whatever the law says. Issues whose mutations are only the moment's — the
 * mood board, a posture or a wardrobe, an absent person's activity on a seat
 * that stands, a character page's "now"/arc/loose-end lines, a thread that
 * exists nudged along — are dropped before anything lands. A character page
 * for the main character is never written (the writer plays them). What
 * stays: presence, standings, locks, wounds, seats made or cleared, threads
 * opened or closed, knowledge, the clock and the ground, forgetting. */
/* M259: THE AUDITOR'S DOORS, as a list of what it MAY open rather than of what
 * it may not. The old list of forbidden types named people.note — so every
 * finished loose end the auditor was told to close (M240/M241) was thrown
 * away here, and an issue whose only change was that close vanished from
 * the report. A closed loose end LASTS: it passes now, and only that field.
 * The page reader's things (a mood, a position, a dress, how far a beat
 * moved a standing, time passing, weariness) and anything no one may write
 * on judgment are dropped. */
export const AUDITOR_TYPES = new Set([
  'clock.set', 'place.set', 'presence.enter', 'presence.leave', 'mc.set',
  'body.injure', 'body.heal', 'rel.set', 'offscreen.set', 'offscreen.clear',
  'canon.lock', 'canon.unlock', 'thread.set', 'thread.close', 'knowledge.add',
  'faction.set', 'people.set', 'people.note', 'people.forget',
]);
/* M279: "stands as the pages moved it", "not the ledger's to zero" — thirteen such lines at turn 77 */
const ALL_IS_WELL = /\b(stands? as written|stands? as the (?:pages|story) (?:have |has )?(?:moved|left|put|set) (?:it|them|her|him)|not (?:the ledger'?s|mine|the auditor'?s) to (?:zero|move|change|touch)|left as written|as the story has it|(?:is|are) (?:live and )?(?:correct|correctly \w+|complete|consistent|accurate|fine)|none is wrongly|nothing (?:is )?(?:wrong|stale|missing)|match(?:es)? the (?:brief|pages)|no canon contradicts|no (?:change|fix) (?:is )?needed)\b/i;
/* M268: "→ no change" and "the moment, not mine to report" were still reported */
const NO_CHANGE_FIX = /^\s*(?:no change|none|nothing(?: to (?:do|change|fix))?|no action|leave it(?: as it is)?|as is|n\/a)\b/i;
const NOT_MINE = /\bnot mine to report\b|\bnot (?:my|the auditor'?s) (?:job|door)\b|\bomits? (?:nothing|no one)\b|\badds? no one\b|\bmatch(?:es)? the header\b/i;
export function saysAllIsWell(issue) {
  const fix = String((issue && issue.fix) || '');
  const what = String((issue && issue.what) || '');
  if (NO_CHANGE_FIX.test(fix)) return true;
  if (NOT_MINE.test(what) && !/\b(?:set|close|add|clear|restore|zero)\b/i.test(fix)) return true;
  return ALL_IS_WELL.test(fix) || (ALL_IS_WELL.test(what) && !/\bbut\b/i.test(what));
}

export function auditorScope(issues, state, { header = [] } = {}) {
  const mc = String((state && state.sheet && state.sheet.playerName) || '').trim().toLowerCase();
  const said = Array.isArray(header) ? header : [];
  /* does the header line agree with this place or hour? null when it is silent */
  const headerAgrees = (m) => {
    const h = said.find((x) => x && x.type === m.type);
    if (!h) return null;
    if (m.type === 'place.set') return String(h.name || '').trim().toLowerCase() === String(m.name || m.place || '').trim().toLowerCase();
    return ['year', 'month', 'day', 'hour', 'minute'].every((k) => Number(h[k]) === Number(m[k]));
  };
  const seats = (state && state.offscreen && typeof state.offscreen === 'object') ? state.offscreen : {};
  const moment = (m) => {
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return true;
    if (!AUDITOR_TYPES.has(m.type)) return true;
    /* the header line is the truth for the ground and the hour (M131): the
     * auditor may bring the ledger TO it, never move it anywhere else */
    if ((m.type === 'place.set' || m.type === 'clock.set') && headerAgrees(m) === false) return true;
    if (m.type === 'people.note') return String(m.field || '').trim().toLowerCase() !== 'unthread';
    /* someone already here who "comes in" is a move — the page reader's */
    if (m.type === 'presence.enter' && Array.isArray(state && state.present) && findPresent(state, m.name) !== -1) return true;
    if (m.type === 'people.set') {
      if (mc && String(m.name || '').trim().toLowerCase() === mc) return true;
      return m.field === 'state' || m.field === 'arc' || m.field === 'threads';
    }
    if (m.type === 'offscreen.set' && typeof m.name === 'string' && findSeat(seats, m.name)) return true;
    if (m.type === 'thread.set' && findThread(state && state.threads, m.title || m.name) !== -1) return true;
    return false;
  };
  const kept = [];
  for (const issue of issues || []) {
    if (!issue || typeof issue !== 'object') continue;
    const muts = Array.isArray(issue.mutations) ? issue.mutations.filter((m) => !moment(m)) : [];
    if (issue.pages && issue.fix) { kept.push({ ...issue, mutations: muts }); continue; }
    if (Array.isArray(issue.mutations) && issue.mutations.length && !muts.length) continue; /* the moment only — dropped whole */
    kept.push({ ...issue, mutations: muts });
  }
  return kept;
}

/* M259: the words a report line is drawn with — "Set right" only when a
 * change LANDED (or the house mends the pages for the brief). A report from
 * before M259 carries no count and reads as it always did. */
export function auditLineWords(i) {
  if (!i || typeof i !== 'object') return { text: '', warn: false };
  const counted = Number.isFinite(i.landed);
  const setRight = counted ? (i.landed > 0 || Boolean(i.pages && i.fix)) : Boolean(i.fixable);
  const refusedAll = counted && !setRight && Array.isArray(i.refused) && i.refused.length > 0;
  /* M93: nothing the auditor sees is left for the writer — a line without a
   * change is a thing seen and let stand, never a chore */
  const text = setRight
    ? 'Set right: ' + i.what + (i.fix ? ' → ' + i.fix : '')
    : refusedAll
      ? 'Seen; its change did not hold (' + i.refused[0] + '): ' + i.what
      : 'Seen, left as the story has it: ' + i.what + (i.fix ? ' → ' + i.fix : '');
  return { text, warn: !setRight };
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
/* M304: A RUNAWAY GUARD, NOT A SIZE A REAL CAST REACHES (M266's law, applied
 * here at last). It was 12 — and a story with twenty people who matter lost
 * eight of their whereabouts to it on every page, the least reachable first,
 * which in a long tale is most of the family. What the STORYTELLER is told
 * of is still ranked by who can reach the scene; what the LEDGER keeps is
 * everyone the story carries. */
export const SEAT_CAP = 40;
/* M304: the writer's own people — named in the brief or the cast notes (by
 * their whole name or the one they are spoken by: the law read
 * material.includes("rias gremory") and a brief that says "Rias" carried no
 * one), or holding an invited cast card. */
function writersOwn(name, material, castNames) {
  if (namedInText(material, name)) return true;
  return (Array.isArray(castNames) ? castNames : []).some((c) => samePersonLoose(c, name));
}
/* What carries a person, in words — '' when nothing does. The drawer reads
 * this beside every character page (M104) so the writer can see the pool
 * the way the house does. */
export function carriedBy(state, name, { brief = '', castNotes = '', pages = [], castNames = [] } = {}) {
  const seats = state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {};
  /* M163: pages, like the seat's own atTurn stamp. */
  const turn = storyTurn(state);
  const material = String(brief || '') + '\n' + String(castNotes || '');
  const recent = (Array.isArray(pages) ? pages : []).slice(-SEAT_MENTION_PAGES).map((p) => String((p && p.text) || '').toLowerCase()).join('\n');
  const rels = state.relationships || {};
  const threads = Array.isArray(state.threads) ? state.threads : [];
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  const present = (state.present || []).some((p) => p && String(p.name || '').trim().toLowerCase() === n);
  if (present) return 'in the scene';
  if (writersOwn(name, material, castNames)) return 'the brief names them';
  const relKey = Object.keys(rels).find((r) => samePersonLoose(r, name));
  const rel = relKey ? rels[relKey] : null;
  if (rel && ((rel.p || 0) || (rel.r || 0) || (rel.s || 0))) return 'a standing toward the main character';
  if (threads.some((t) => t && typeof t === 'object' && t.owner && samePersonLoose(t.owner, name))) return 'an open thread';
  const seatKey = Object.keys(seats).find((k) => samePersonLoose(k, name));
  const seat = seatKey ? seats[seatKey] : null;
  if (seat && (seat.stance === 'toward' || seat.stance === 'seeking')) return 'on the way to the main character';
  /* M304: THE SEAT LAW FORGOT WHAT THE PEOPLE LAW KNOWS. M57 never retires
   * someone with a truth locked about them or a loose end on their page, and
   * M263 keeps what the writer wrote by hand — but this law, which clears a
   * seat AND retires its person at once, asked about none of the three. So a
   * sister with a locked fact and a promise still open, unnamed for twelve
   * pages, lost her whereabouts and her card together. */
  if (Object.keys(state.canon || {}).some((k) => samePersonLoose(k, name) && state.canon[k] && Array.isArray(state.canon[k].facts) && state.canon[k].facts.length)) return 'something locked true of them';
  const pageKey = findPersonKey(state.characters || {}, name);
  const page = pageKey ? state.characters[pageKey] : null;
  if (page && Array.isArray(page.threads) && page.threads.length) return 'a loose end on their page';
  if (page && page.hand && typeof page.hand === 'object' && Object.keys(page.hand).length) return 'the writer’s own hand on their page';
  /* a history with the main character that is still fresh: the scribe wrote how
   * they stand with him (the arc), and their page has moved within the span
   * M57 itself waits before it lets anyone go */
  if (page && !page.retired && typeof page.arc === 'string' && page.arc.trim() && Number.isFinite(page.updatedAtTurn) && turn - page.updatedAtTurn < RETIRE_AFTER) return 'a history with the main character';
  const first = n.split(/\s+/)[0];
  const mentioned = recent.includes(n) || (first.length >= 3 && new RegExp('(?<![\\p{L}\\p{N}])' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'u').test(recent));
  if (mentioned) return 'named on a recent page';
  if (seat && Number.isFinite(seat.atTurn) && turn - seat.atTurn < SEAT_FRESH_TURNS) return 'seated just now';
  return '';
}

export function seatHousekeeping(state, { brief = '', castNotes = '', pages = [], castNames = [] } = {}) {
  const out = [];
  const seats = state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {};
  const names = Object.keys(seats);
  if (!names.length) return out;
  const material = String(brief || '') + '\n' + String(castNotes || '');
  const carried = (name) => carriedBy(state, name, { brief, castNotes, pages, castNames });
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
      if (writersOwn(name, material, castNames)) continue; /* the brief's people are never capped out */
      out.push({ type: 'offscreen.clear', name });
    }
  }
  return out;
}

/* M304: WHOEVER THE STORY STILL CARRIES IS NOT A PASSER-THROUGH. The seat law
 * retired people "at once" on reasons it had forgotten to ask about (above);
 * a story played under it holds people who matter out of the storyteller's
 * sight, where nothing wakes them but an entrance. A retired person a LASTING
 * reason carries — the writer's own material, a standing, an open thread, a
 * locked truth, a loose end, the writer's hand — is brought back. A mention or
 * a fresh seat is not lasting and wakes no one by itself (an entrance or a
 * written page already does). */
const LASTING = new Set(['the brief names them', 'a standing toward the main character', 'an open thread', 'something locked true of them', 'a loose end on their page', 'the writer’s own hand on their page']);
export function wakeHousekeeping(state, { brief = '', castNotes = '', castNames = [] } = {}) {
  const out = [];
  const chars = state.characters && typeof state.characters === 'object' ? state.characters : {};
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || !c.retired || isMc(state, name)) continue;
    const why = carriedBy(state, name, { brief, castNotes, pages: [], castNames });
    if (LASTING.has(why)) out.push({ type: 'people.wake', name, cause: 'the story still carries them — ' + why });
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
  const digits = Array.isArray(stated) ? stated : explicitStandings(String(brief || '') + '\n' + String(castNotes || ''), mc);
  /* M278: A STANDING THE BRIEF NEVER SET TOWARD HIM. An auditor of M277 wrote
   * standings "set — the brief says" for people whose brief lines were toward
   * someone else (Sophie P:65 toward Emilia), and zero ones for bystanders.
   * One whose every cause is such a brief line, none naming the main
   * character, for someone the house's own reading of the brief does not set
   * toward him — and not the writer's own — is let go. A standing the pages
   * moved keeps its page causes and stays. */
  if (mc) {
    for (const k of live) {
      if (gone.has(k)) continue;
      const r = rels[k];
      const hist = r && Array.isArray(r.history) ? r.history : [];
      if (!hist.length || (r && r.hand)) continue;
      const causes = hist.map((h) => String((h && h.cause) || '').trim());
      /* only a BARE "the brief says" (it names no one) or a brief line said to be toward someone
       * else — "the brief says Mira is his sister" is about him and stays */
      const bare = (c) => /^set — the (brief|cast notes?)(\s+(says|states|said))?\.?$/i.test(c);
      const elsewhere = (c) => /^set — the (brief|cast notes?)\b/i.test(c)
        && [...c.matchAll(/\btowards?\s+([A-Z][\p{L}'’-]+)/gu)].some((x) => !samePersonLoose(x[1], mc));
      /* every entry was set by a hand (none is a beat a page earned), and the one that stands now
       * is a bare or elsewhere brief line — an earlier auditor's start beneath it changes nothing */
      const noBeat = causes.every((c) => /^set — /i.test(c));
      const standsOn = causes[causes.length - 1];
      const onlyBrief = noBeat && (bare(standsOn) || elsewhere(standsOn));
      const setByBrief = digits.some((st) => samePersonLoose(st.name, k));
      if (onlyBrief && !setByBrief) {
        out.push({ type: 'rel.clear', name: k, cause: 'a standing the brief does not set toward ' + mc });
        gone.add(k);
      }
    }
  }
  /* the digits are judged against the ledger AS IT WILL STAND after the
   * junk is gone and the duplicates have merged — a merged standing that
   * carries numbers is not "zero" */
  const merged = out.length ? applyMutations(state, out).state.relationships : rels;
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
    'THE BRIEF (the first authority):', Q, writerText(brief, BRIEF_ROOM, 'brief', true) || '(none)' /* M267/M283: whole */, Q,
    'THE CAST NOTES:', Q, writerText(castNotes, CAST_ROOM, 'cast notes', true) || '(none)' /* M274/M283 */, Q,
    'THE RECORD (what the pages established, oldest to newest):', Q, String(record || '') || '(nothing yet)' /* M265: the caller gives it in its room */, Q,
    'THE LATEST PAGES:', Q, (pages || []).map((p) => (p.role === 'assistant' ? 'STORY: ' : 'PLAYER: ') + wholePage(p.text, 12000)).join('\n\n'), Q,
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

export async function rebuildStandings({ connection, storyId, brief = '', castNotes = '', signal, stale, renew } = {}) {
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
  const prompt = buildRebuildMessages({ state: s1, brief, castNotes, record: wholeRecord(mem, Math.floor(roomChars(connection, 4000) * 0.35)), pages, mc }); /* M265: the whole record, in its room */
  if (typeof renew === 'function') renew(auditLeashMs(prompt));
  const { text } = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: 4000, signal });
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

/* M259: what a looking worker looked at, for the workers line */
export function lookedWords(looked) {
  const list = Array.isArray(looked) ? looked : [];
  if (!list.length) return '';
  const pages = list.filter((r) => /^#?[0-9a-f]{3,12}$|^\d+$/i.test(String(r).trim())).length;
  const finds = list.filter((r) => /^find:/i.test(String(r).trim())).map((r) => '“' + String(r).trim().replace(/^find:\s*/i, '') + '”');
  const briefs = list.filter((r) => /^(brief|cast)$/i.test(String(r).trim())).map((r) => (String(r).trim().toLowerCase() === 'brief' ? 'the brief' : 'the cast notes'));
  const bits = [];
  if (pages) bits.push(pages + (pages === 1 ? ' page' : ' pages'));
  if (finds.length) bits.push('searched ' + finds.join(', '));
  if (briefs.length) bits.push([...new Set(briefs)].join(' and '));
  return bits.length ? ' (looked at: ' + bits.join('; ') + ')' : '';
}

export function auditRunWords(result) {
  if (!result) return 'nothing to read';
  if (result.note === 'unusable') return 'its answer could not be used';
  if (result.note === 'cut short') return 'its answer ran out of room';
  const n = result.issues.length;
  const fixed = result.applied.length;
  /* M259: a run whose only changes were the house's own (the brief's digits,
   * a passer-through retired) says what it changed, never "true" */
  if (!n && !fixed) return 'the ledger is true to the story' + lookedWords(result.looked);
  const bits = n ? [`found ${n} ${n === 1 ? 'thing' : 'things'}`] : [];
  if (fixed) bits.push(`set ${fixed} right: ` + result.applied.slice(0, 4).map((a) => a.words.replace(/\.$/, '')).join(' · ') + (fixed > 4 ? ' · …' : ''));
  /* M277: standing moves it may not make, counted — not listed */
  if (result.leftStandings) bits.push(`left ${result.leftStandings} standing ${result.leftStandings === 1 ? 'change' : 'changes'} to the page reader`);
  const briefWins = result.issues.filter((i) => i.pages && i.fix).length;
  if (briefWins) bits.push(`${briefWins} the brief wins — ${result.mendedPages || 0} ${result.mendedPages === 1 ? 'page' : 'pages'} mended, the record corrected`);
  const seen = result.issues.filter((i) => !i.mutations.length && !(i.pages && i.fix)).length;
  if (seen) bits.push(`${seen} seen, nothing to change`);
  const refusedN = result.rejected.filter((r) => !(r && r.same) && !(r && r.standing)).length; /* M259: "already so" is not a refusal; M278: a standing left to the page reader is counted once, below */
  if (refusedN) bits.push(`${refusedN} refused`);
  return bits.join(', ') + lookedWords(result.looked);
}

export async function auditOn(story) {
  if (story && story.audit === false) return false;
  return (await db.settings.get('auditOn')) !== false;
}

export async function auditEvery() {
  const n = Math.round(Number(await db.settings.get('auditEvery')));
  return Number.isFinite(n) && n >= 1 ? Math.min(20, n) : DEFAULT_AUDIT_EVERY;
}
