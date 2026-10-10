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

import { HERE_MEANS, KNOWING_MEANS, LOOSE_ANSWERED_MEANS } from './herewords.js'; /* M554; M677: what goes into who knows what — the reader's own rule; M679: what answers a loose end — one definition */
import { writerText, BRIEF_ROOM, CAST_ROOM, nearNames, leanPage, LEAN_STEPS } from '../engine/whole.js'; /* M283; M288: the lean steps */
import { samePlace, seatAtScene, handSetClockSince } from '../engine/apply.js'; /* M403; M681: a seat at the scene's own place */
import { seatForPerson, sameLooseEnd } from '../engine/people.js'; /* M398; M679: a loose end matched by sense, as the applier matches it */
import { isHere, nameOnPage, samePersonName, oneMeaning } from '../engine/names.js'; /* M398/M413; M414: named by the one answer; M679 */
import { shownOnPage, personBookKey, groundTheTellingStandsOn, narrationOf } from '../engine/apply.js'; /* M446: named as themself, never by a family name another shares; M449: the standing the applier will write */
import { findRelationship } from '../engine/relationships.js';
import { db } from '../store.js';
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify, headerMutations, headerDress } from '../engine/state.js'; /* M679: his header's dress */
import { applyMutations, RETIRED_EXAMPLE_NAMES , storyTurn, findPresent, clearsThatArrive, scenePartOf, showsDeparture, goneAtTheEnd, quotedGoing, restatedPresence, toldOnPage, mcWalksOff, findThingKey, pageEnding, walkInFromPage, deathToldOf } from '../engine/apply.js'; /* M444; M446: the departure reader, and who is gone at a page's end */
import { findSeat, isDeadSeat } from '../engine/offscreen.js';
import { findThread, onTheWay } from '../engine/world.js'; /* M681 (W5): an approach that lapsed is nobody on the way */
/* M240: it was told to catch a healed wound and never shown the wounds.
 * M259: and it was shown the storyteller's TRIMMED copy of everything else —
 * six standings, five threads, four things a person knows, no ground at all.
 * It reads the whole ledger now (engine/whole.js). */
import { renderWholeLedger, wholePage, PAGE_CAP, knowledgeRoomFor } from '../engine/whole.js';
import { askWithFetch, fetchLaw, roomChars, viewBudget, leashFor } from './lookup.js'; /* M259: it looks for what it was not shown */
import { messageIndexLine, refOf } from './housekeeper.js';
import { asideAt, asideLabel } from '../commands.js'; /* M674: which pages are out of character, and how a request says so */
import { mcName } from '../engine/duels.js';
import { isMc, namedInText, findPersonKey } from '../engine/people.js'; /* M277: the main character holds no standing; M304: one matcher for "the writer's material names them" */
import { explicitStandings, readStatedStandings, samePersonLoose, isLabel } from './founder.js'; /* M49/M50: the writer's digits, read the way the brief is shaped */
import { loadMemory, wholeRecord, recordWithPages } from './memory.js'; /* M51: the whole record, not the summarizer's tail */
import { pageText } from '../assemble/stack.js';
import { exactNameIn, quotedSource, WRITER_FACTS } from '../engine/evidence.js';
import { auditSources, reviewAuditSources, missingSourcePeople, missingLedgerPeople } from './auditsources.js';

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
  'people.rename {"type":"people.rename","from":"wrong name","to":"established name","cause":"source of correction","shown":"exact identity quote if the names differ entirely"} — correct or merge one identity, keeping all its records. NEVER delete and recreate it. Correct its title with people.set core.',
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30} — to the latest header line\'s own hour, or when the latest STORY page has none',
  'place.set {"type":"place.set","name":"the chapel"} — to the latest header line\'s own place, or when the latest STORY page has none',
  'presence.enter {"type":"presence.enter","name":"NAME","shown":"the page\'s own words that show them here, copied exactly — needed when the telling does not use their name"} / presence.update {"type":"presence.update","name":"NAME","position":"where in the room the newest page shows them, in its own words","attire":"what the newest page shows them wearing, in its own words"} / presence.leave {"type":"presence.leave","name":"NAME","shown":"the page\'s own words that show them going, copied exactly","to":"where the pages show them going, said so it stands on its own — upstairs in the Wells house — and left out only when the pages show no sign of where"}', /* M643: whoever takes someone out of the scene says where they went; M644: and by which words of the page */
  'mc.set {"type":"mc.set","name":"MAIN CHARACTER"} — only when the ledger has no main character',
  'body.injure {"type":"body.injure","name":"NAME","what":"…","sev":1-3} / body.heal {"type":"body.heal","name":"NAME","what":"…"}',
  'rel.set {"type":"rel.set","name":"…","p":..,"r":..,"s":..,"cause":"the brief says"} — only to restore a standing that is wrongly zero, or to zero one written for someone else',
  '  (never to start or move a standing from a page — a beat is the page reader\'s, and the brief\'s digits are restored by the house; never one for the main character;',
  '  never one the brief sets toward someone else — the cause says what the brief sets toward the main character)',
  'offscreen.set {"type":"offscreen.set","name":"NAME","location":"…","activity":"…","agenda":"…","stance":"toward|seeking|tense|busy|waiting","etaMinutes":25} / offscreen.clear {"type":"offscreen.clear","name":"NAME"} (a clear only for someone in the scene now — anyone else gets offscreen.set with where they are: a person the story keeps is always somewhere)',
  'thing.set {"type":"thing.set","name":"THE THING","where":"where it stands now","owner":"WHOSE"} / thing.clear {"type":"thing.clear","name":"THE THING","cause":"…"} (a vehicle, weapon or object the pages put somewhere — the Things list is what exists; correct where it stands when the pages say otherwise)',
  'canon.lock {"type":"canon.lock","name":"NAME","key":"hair","value":"black"} / canon.unlock {"type":"canon.unlock","name":"NAME","key":"hair"}',
  'thread.set {"type":"thread.set","title":"…","owner":"…","heat":"hot|cold","next":"…"} / thread.close {"type":"thread.close","title":"…"}',
  'knowledge.add {"type":"knowledge.add","name":"OTHER NAME","fact":"…"} / knowledge.forget {"type":"knowledge.forget","name":"NAME","fact":"the wrong line, as written"} — forget ONLY a line the pages contradict, and add the right one beside it',
  'faction.set {"type":"faction.set","name":"…","stance":"…","agenda":"…","move":"…"} / faction.clear {"type":"faction.clear","name":"…"} (one the pages ended)',
  'people.set {"type":"people.set","name":"NAME","field":"core|state|arc","text":"…"} — the main character\'s core and arc are never written',
  'people.note {"type":"people.note","name":"NAME","field":"unthread","text":"the loose end as it stands"} \u2014 closes ONE finished loose end (field "thread" opens one); matched by sense, so word it close to how it reads',
  'Evidence-backed repairs: people.note field core|arc|thread, people.set field state|arc, and mode.snapshot flags are allowed with "shown": an exact source quote. Text must be supported by that quote; a state or mood repair must use the newest scene ending. Correct what the source established, never invent a new simulation.',
  'people.forget {"type":"people.forget","name":"NAME","cause":"…"} — ONLY for a person who was never the story\'s (a name no page, no brief and no cast note ever held); erases their page, seat, standing, knowledge and locks for good',
].join('\n');

function law({ mc }) {
  return [
    WRITER_FACTS,
    'You are the auditor of the ledger for a story told between two writers. The ledger is the',
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
    '    with where and when that page stands, set them. A header that only REPEATS the ledger\'s ground while the',
    '    page\'s own telling plainly stands somewhere else (a duel on a courtyard\'s sand under a header naming an',
    '    assembly hall) is an echo of a wrong ledger, not the page\'s word: set the ground to where the telling stands,',
    '    in the words the story used for that place.',
    '  - WHO IS HERE: is everyone the latest page ENDS with IN THE SCENE in the ledger\'s presence, and is everyone marked',
    '    present actually still in the scene? Someone who left pages ago and is still "here" is an',
    '    error; someone who arrived and is not listed is an error; someone "here" whom the pages only show at a distance is an error (seat them where they are). ' + HERE_MEANS,
    '  - THE ABSENT: does each seat match where the pages last put that person? A person the pages',
    '    show in the scene still seated elsewhere is an error (presence.enter — it lets the note go). A named person the pages',
    '    or the brief establish who has no seat and no page is missing (people.set, offscreen.set).',
    '  - THE PEOPLE: does each character page agree with the brief and with the pages? A wrong name,',
    '    a wrong relation, a wrong role is an error. A real person or a character from an established',
    '    canon is written from the real record (a public figure\'s mother is her real mother, by name). Fix the page',
    '    (people.set with the corrected field), never invent past what the brief and the pages say.',
    '  - THE CANON: does anything locked contradict the brief? Unlock and relock it right. A face the series gave that',
    '    the pages have plainly CHANGED in this story (a haircut, a new scar, an eye lost, years gone by) is relocked to',
    '    what the pages now say (canon.lock) — the series is where the story started, and the story wins.',
    '  - THE BODIES AND THE STANDINGS: a wound the pages show healed still open; a standing that',
    '    contradicts the brief\'s established relationship (rel.set with the cause "the brief says").',
    '    AXIS LOCK: standings describe feelings TOWARD THE MAIN CHARACTER only. Zero a wrong-owner standing',
    '    only when its own history proves it was about someone else; preserve that feeling as words on the',
    '    person’s page. Never zero a real bond merely because you cannot see its cause. Never reset page-earned',
    '    changes to the brief’s starting numbers or judge how much a beat should move them.',
    '    Restore a missing or wrongly-zero axis only from an explicit bond in the brief, with a cause quoting',
    '    that bond toward the main character. The levels: friend P 25–45, close friend/family P 50–70, hatred',
    '    P −50…−80; crush R 25–45, in love R 55–75, devoted R 75–90. Romantic love is R, never P alone.',
    '    An axis the pages earned, even if now zero, stays earned. The page reader starts and moves bonds.',
    '  - THE THREADS: a thread the pages show resolved still hot (thread.close); a live agenda the',
    '    pages show and the ledger lacks (thread.set).',
    '  - THE LOOSE ENDS ON A PERSON\'S OWN PAGE (their "Loose ends:" line, which is NOT the same as the story threads',
    '    above): one the pages have plainly ANSWERED — close it with people.note {field:\"unthread\"}, worded as it stands on',
    '    the page; one left open is carried to the storyteller as still hanging. ' + LOOSE_ANSWERED_MEANS, /* M679: what answers one — the reader\'s and the scribe\'s words too */
    '  - WHO KNOWS WHAT: a present person to whom the latest pages put something that belongs there, with no',
    '    knowledge line for it (knowledge.add). ' + KNOWING_MEANS,
    '  - AGENCY AND OWNERSHIP: check who did what, to whom, and with whose object across the sequence.',
    '    An unnamed phone remains its established holder’s until handed over; a repeated call reaches',
    '    that holder, not automatically the main character. Correct misreadings in the relevant ledger',
    '    fields, threads and knowledge (remove the wrong fact and add the right one together). Never',
    '    rewrite the story to match a mistaken ledger; page repair is only for a conflict with the brief.',
    '',
    'Be exact and be conservative: only what the brief states or the pages show, never what would be',
    'nice. If the ledger is true to the story, say so with an empty list — that is a good answer.',
    '',
    'THE MAIN CHARACTER HAS NO CHARACTER PAGE, by design — the writer plays them. Never report it',
    'missing, never write one.',
    'Report only a concrete error or omission. Successful checks are not findings; if nothing is wrong, return an empty issues list.',
    '',
    'THE MOMENT IS NOT YOURS TO INVENT: posture, position, dress, the mood board, what a hand is doing, a sip taken, a knee on the',
    'vinyl, clothing of the moment, an absent person\'s activity this hour, a thread\'s next small',
    'step, a character page\'s "now" line. The extractor, the world agent and the scribe rewrite',
    'those after EVERY page and have ALREADY read the latest one: the ledger you read is the scene as that page',
    'ENDS. Where its start differs (he walked off, the room emptied) the end is the present. Do not independently simulate',
    'another outcome. You MAY correct a field these readers got wrong when an exact shown quote establishes the correction.',
    'For a now or mood use the newest ending, never an older moment. Yours is what LASTS and what is WRONG: the wrong name, age, kin, origin, role; a person',
    'present who left pages ago or absent who is plainly here; a wound healed still open; a standing',
    'wrongly zero; a thread the pages closed still hot or a live agenda missing; a witnessed fact',
    'with no knowledge line; the clock or the ground wrong on a page with no header line; a duplicate.',
    'Report every supported discrepancy you find. There is no target count of findings; a large damaged ledger may need many repairs.',
    '',
    'THE BRIEF WINS: when the PAGES themselves contradict the brief — a wrong name, a wrong relation, a',
    'wrong role, a person somewhere the brief says they cannot be, a fact the brief settles written the',
    'other way — that page was an error, not canon (the writer\'s own law). Report it with "pages": true',
    'and a "fix" that states, in one plain sentence, what the page should read instead — the brief\'s',
    'truth, exactly; and lock that truth in the ledger with the vocabulary (canon.lock, people.set, or',
    'rel.set with the cause "the brief says …"). The house then mends that page by the smallest edit; you',
    'never rewrite a page yourself.',
    'THE PAGES SETTLE A BRIEF AT ODDS WITH ITSELF: when the brief says two things about one fact,',
    'the version the pages have already established is the story\'s — lock it (canon.lock, or people.set,',
    'with the cause "the brief says both; the pages settled it") and say so in "what"; if the pages have',
    'not touched that fact yet there is nothing to report — the storyteller will settle it the first time',
    'it comes up, and the ledger will hold what the page wrote. Nothing is reported as unfixable: every',
    'issue you list carries either mutations or a pages fix.',
    '',
    'Answer with JSON ONLY, exactly this shape:',
    '{"issues":[{"what":"the ledger says X; the pages say Y","fix":"what should be true","pages":false,"mutations":[ ... ]}]}',
    'To withdraw a PREVIOUS UNRESOLVED ITEM because it was mistaken, also return resolved:[{what:"the exact earlier finding",shown:"an exact source quotation disproving it",why:"why the concern was mistaken"}]. An empty issues list alone does not close unfinished work.',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    'A PLAYER page states what the main character ATTEMPTS; only the STORY page after it makes it so.',
    'A PLAYER page may directly establish names, ranks, family and biography. These do not require the',
    'STORY reply to repeat them. For attempted actions, read the completed turn in order: an attempt is',
    'not a guaranteed result, and a later departure or correction wins. Never turn a question into a fact.',
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
    if (p.owns && p.owns.length) bits.push('owns the story threads: ' + p.owns.join('; ') + ' (kept with the threads, never repeated as loose ends)'); /* M398 */
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
function buildAuditorAt({ state, brief = '', castNotes = '', record = '', pages = [], index = [], pageCount = 0, canonRecord = '', room = Infinity, staleBoard = false }, lean = 0) {
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  /* M259: the WHOLE ledger — every standing with its numbers, every thread,
   * every line of who knows what, every seat, lock, wound and faction, and
   * the ground (engine/whole.js). */
  const whole = renderWholeLedger(state, { knowledgeRoom: Number.isFinite(room) && room > 0 ? knowledgeRoomFor(room) : 0 }) || 'Nothing is written in the ledger yet.'; /* M664: fitted to the auditor's room */
  const people = characterPages(state, lean);
  const user = [
    'THE BRIEF (the writer\'s own words):',
    FENCE, writerText(brief, BRIEF_ROOM, 'brief', true) || '(none written)', FENCE, /* M283: to its room, a stated cut past it */
    ...(castNotes && String(castNotes).trim() ? ['WHO IS IN IT (the writer\'s own words):', FENCE, writerText(castNotes, CAST_ROOM, 'cast notes', true), FENCE] : []),
    ...(String(canonRecord || '').trim() ? ['WHAT THE SERIES ITSELF SAYS OF ITS PEOPLE HERE (their real record — the brief outranks it; where the brief is silent, a canon character is this):', FENCE, String(canonRecord).trim(), FENCE] : []), /* M386 */
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
      return label + (p.aside ? asideLabel(p.role) + ': ' : (p.role === 'assistant' ? 'STORY: ' : 'PLAYER: ')) + String(p.text || ''); /* M674 */
    }).join('\n\n'),
    FENCE,
    '',
    ...(Array.isArray(index) && index.length
      ? ['MORE PAGES THE RECORD HAS NOT FOLDED — no room to show them above; fetch any by its number:', ...index, '']
      : []),
    ...(pageCount ? ['The story has ' + pageCount + ' pages; any of them, folded or not, is served whole by its number.', ''] : []),
    'THE LEDGER, ALL OF IT (as the page readers left it — the scene as the latest page ENDS):',
    whole,
    '— the character pages —' + (lean ? ' (shown lean for this reading: the ledger is larger than its room \u2014 the pages of those away are shortened; the ones here are whole; fetch "person: NAME" for any page whole)' : ''), people || '(none)',
    '',
    /* M681 (S13): the one exception to the moment not being its job — a board no reader stated for the latest page */
    ...(staleBoard ? ['THE MOOD BOARD IS STALE: no page reader stated it for the latest STORY page — it is an older page\'s. This once the board is yours: if it is wrong for how the latest page ENDS, write ONE mode.snapshot {"type":"mode.snapshot","flags":[…]} naming every mood that holds then — combat (a fight is on), intimate (sex or intimate touch is on), travel (in transit; NOT once they have arrived), socialField (a crowded public place full of voices), isolation (alone, far from help), group (in company of several); an empty list clears them all. Nothing else of the moment.', ''] : []),
    'Hold the ledger against the brief, the pages and the record. JSON only.',
    ...(state?.audit?.pending?.length ? ['PREVIOUS UNRESOLVED ITEMS: revisit these against the current sources; provide a working repair or explain with evidence why the finding was mistaken.', ...state.audit.pending] : []),
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
        /* M654: a yes as a model writes it — "pages":"true" was no yes, and a fault that lives on the pages (a fix, no
         * change to the ledger) was then dropped as "no finding" */
        pages: i.pages === true || i.pages === 1 || (typeof i.pages === 'string' && /^\s*(?:true|yes|y|1)\s*$/i.test(i.pages)),
        mutations: Array.isArray(i.mutations) ? i.mutations.filter((m) => m && typeof m === 'object' && typeof m.type === 'string') : [],
      }));
    const resolved = (Array.isArray(parsed.resolved) ? parsed.resolved : []).filter((r) => r && typeof r.what === 'string' && typeof r.shown === 'string' && typeof r.why === 'string' && r.why.trim()).map((r) => ({ what: r.what.trim(), shown: r.shown, why: r.why.trim() }));
    return { issues, resolved, note: 'ok' };
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
    shown.unshift({ ordinal: i + 1, ref: refOf(m), role: m.role, text: t, cut: t.length !== text.length, ...(asideAt(all, i) ? { aside: true } : {}) }); /* M674: out of character is said to be */
    left -= t.length + 60;
  }
  return { shown, index };
}

function auditAborted(signal) { if (signal?.aborted) throw signal.reason || new Error('timeout'); }

export async function auditLedger({ connection, storyId, brief = '', castNotes = '', castNames = [], signal, stale, renew, canonRecord = '', reviewSources = '' } = {}) {
  if (!connection || typeof connection !== 'object' || !storyId) return null;
  const state = await loadState(storyId);
  const storyAtStart = await db.stories.get(storyId);
  const mem = await loadMemory(storyId);
  const allRaw = (await db.messages.list(storyId)).filter((m) => !m.hidden);
  /* M110: a writer's page with no storyteller page after it is an ATTEMPT,
   * not yet true — "I go downstairs" moves nobody until the page renders
   * it. The auditor read the trailing unanswered message as a fact and
   * seated the main character downstairs; the story had not. Answered
   * turns only. */
  const all = answeredOnly(allRaw);
  if (!all.length) return null;
  const documents = auditSources({ brief, castNotes, messages: all });
  const sourceReview = reviewSources ? await reviewAuditSources({ connection, documents, previous: state.auditSources || {}, mode: reviewSources, signal, stale, renew }) : null;
  auditAborted(signal);
  if ((reviewSources && !sourceReview) || stale?.()) return null;
  /* M259: EVERY PAGE THE RECORD HAS NOT FOLDED, and the WHOLE record. It read
   * the last ten pages and a record trimmed to the storyteller's 30,000
   * characters — so with a window of twenty or thirty pages, the pages
   * between the record's end and the last ten were read by NOBODY, and a
   * long tale's oldest lines fell off the front. The room is the
   * connection's own. */
  const room = auditRoomChars(connection);
  const record = recordWithPages(mem, Math.max(20000, Math.min(AUDIT_RECORD_CAP, Math.floor(room * 0.35))));
  const foldedTo = Math.max(0, ...((mem && Array.isArray(mem.nodes)) ? mem.nodes : []).filter((n) => n && Array.isArray(n.span)).map((n) => n.span[1] + 1));
  /* M681 (S13): the board no reader stated for the newest page is the auditor's to restate (boardStale) */
  const toldNow = all.filter((m) => m && m.role === 'assistant');
  const lastTold = [...toldNow].reverse().find((m) => m && !m.ooc);
  const staleBoard = boardStale(state, lastTold ? toldNow.indexOf(lastTold) : null);
  const restoredForReading = missingSourcePeople(state, sourceReview?.people);
  const readingState = restoredForReading.length ? applyMutations(state, restoredForReading.flatMap((i) => i.mutations)).state : state;
  const bare = buildAuditorMessages({ state: readingState, brief, castNotes, record, pages: [], pageCount: all.length, room, canonRecord, staleBoard }); /* M287: the audit's own room */
  const view = auditView(all, foldedTo, Math.min(AUDIT_VIEW_CHARS, viewBudget(connection, MAX_TOKENS, bare.system.length + bare.user.length)));
  if (!view.shown.length) return null;
  const prompt = buildAuditorMessages({ state: readingState, brief, castNotes, record, pages: view.shown, index: view.index, pageCount: all.length, room, canonRecord, staleBoard });
  let read = null;
  let raw = '';
  let user = prompt.user + (restoredForReading.length ? '\n\nIDENTITIES RECOVERED FROM ORIGINAL SOURCES: ' + restoredForReading.map((i) => i.mutations[0].name).join(', ') + '. Their People pages below are being restored from quotations. Check their identity, current presence or absence, and links against the latest completed scene; an old quotation never establishes current presence by itself.' : '');
  const looked = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    /* M259: it may look — any page whole, a search, the whole brief — in the
     * housekeeper's words, served by the housekeeper's server */
    let answer;
    try { answer = await askWithFetch(connection, {
      system: prompt.system, user, maxTokens: MAX_TOKENS, signal, renew,
      leash: leashFor,
      isAnswer: (t) => parseAuditorAnswer(t).note === 'ok',
      source: { storyId, messages: allRaw, memory: mem, story: { brief, castNotes }, state }, /* M288: "person: NAME" */
      room,
      rounds: attempt === 0 ? undefined : 1, /* a second ask looks once at most */
    }); } catch (err) {
      auditAborted(signal);
      if (stale?.()) return null;
      if (!sourceReview) throw err;
      read = { issues: [], note: 'interrupted' };
      break;
    }
    const { text, finishReason, looked: seen } = answer;
    looked.push(...(seen || []));
    raw = text;
    read = parseAuditorAnswer(text);
    if (finishReason === 'length') {
      read.cutShort = true;
      if (read.note === 'unusable') read.note = 'cut short';
    }
    if (read.note === 'ok') break;
    user = prompt.user + '\n\nYour last answer was not a JSON object with an "issues" list. Answer with the JSON object only, and keep it short.';
  }
  let answerProblem = read.cutShort ? 'the auditor ran out of answer space before completing its reading' : read.note !== 'ok' ? 'the auditor did not return a complete usable reading' : '';
  if (read.note !== 'ok' && !sourceReview) return { applied: [], rejected: [], issues: [], note: read.note, raw, looked, unfinished: true, pending: [answerProblem] };
  if (stale && stale()) return null;
  /* M680 (the scene audit): ITS SECOND CALL IS MADE BEFORE IT LOADS WHAT IT WRITES OVER. The brief's digits were asked of the
   * model after the ledger was read and before it was saved — and whatever another writer saved in that minute (the
   * referee's duel, its ruling, a page reader's walk-in) was written over by this copy and lost. */
  if (typeof renew === 'function') renew(); /* a fresh minute for the brief's digits */
  const statedByModel = await readStatedStandings({ connection, brief, castNotes, mc: mcName(state) !== 'the player' ? mcName(state) : '', signal });
  if (stale && stale()) return null;
  const fresh = await loadState(storyId);
  let offered = [...missingSourcePeople(fresh, sourceReview?.people), ...read.issues];
  const judge = (snapshot, proposals) => judgeAudit({ fresh: snapshot, offered: proposals, all, brief, castNotes, castNames, statedByModel });
  let result = judge(fresh, offered);
  const unresolved = (r) => [...missingLedgerPeople(r.out, castNames), ...r.issues.filter((i) => i.refused?.length || (!i.landed && !(i.pages && i.fix))).map((i) => i.what + (i.refused?.length ? ': ' + i.refused.join('; ') : ': no repair was supplied'))];
  const originalFindings = [...(state.audit?.unresolved || []), ...unresolvedFindings(result)];
  const withdrawals = [...(read.resolved || [])];
  let pending = [...unresolved(result), ...(answerProblem ? [answerProblem] : []), ...originalFindings.filter((i) => !findingSettled(i, result, withdrawals, documents)).map((i) => i.what)];
  let followupFailed = false;
  if (pending.length && !stale?.()) {
    renew?.();
    const follow = buildAuditorMessages({ state: result.out, brief, castNotes, record, pages: view.shown, index: view.index, pageCount: all.length, room, canonRecord, staleBoard });
    try {
      const reply = await askWithFetch(connection, {
        system: follow.system,
        user: follow.user + '\n\nREPAIR FOLLOWUP. The first reading has been checked against the actual ledger. These items are still unresolved:\n' + pending.map((p) => '* ' + p).join('\n')
          + '\nRead the evidence and supply a working correction using the allowed operations. A missing character needs people.set field core; a wrong identity needs people.rename, never deletion. Do not repeat an operation that was blocked. Preserve completed corrections. If the concern is disproved, return it with no mutations and a fix explaining the evidence; do not claim an unresolved item was repaired.',
        maxTokens: MAX_TOKENS, signal, renew, leash: leashFor,
        isAnswer: (t) => parseAuditorAnswer(t).note === 'ok',
        source: { storyId, messages: allRaw, memory: mem, story: { brief, castNotes }, state: result.out }, room, rounds: 1,
      });
      looked.push(...(reply.looked || []));
      const corrected = parseAuditorAnswer(reply.text);
      if (corrected.note === 'ok' && reply.finishReason !== 'length') {
        answerProblem = '';
        // Check only this pass's remaining findings, but retain all valid writes
        // from the first pass. Rejected instructions are not replayed blindly.
        const firstWrites = result.applied.map((a) => a.mutation);
        const carry = result.issues.filter((i) => i.landed || (i.pages && i.fix)).map((i) => ({ ...i, mutations: i.mutations.filter((m) => firstWrites.includes(m)) }));
        const represented = new Set(carry.flatMap((i) => i.mutations));
        const extra = firstWrites.filter((m) => !represented.has(m));
        if (extra.length) carry.push({ what: 'Ledger upkeep', mutations: extra, fix: '', pages: false });
        const completed = new Set(firstWrites.map(repairKey));
        const corrections = corrected.issues.flatMap((i) => {
          const mutations = i.mutations.filter((m) => !completed.has(repairKey(m)));
          return i.mutations.length && !mutations.length && !i.pages ? [] : [{ ...i, mutations }];
        });
        offered = [...carry, ...corrections];
        const current = await loadState(storyId);
        result = judge(current, offered);
        withdrawals.push(...(corrected.resolved || []));
        raw += '\n\nRepair followup:\n' + reply.text;
      } else followupFailed = true;
    } catch (err) {
      auditAborted(signal);
      if (stale?.()) return null;
      followupFailed = true;
    }
  }
  auditAborted(signal);
  if (stale?.()) return null;
  // No result based on replaced, hidden or deleted source pages may land.
  const now = answeredOnly((await db.messages.list(storyId)).filter((m) => !m.hidden));
  const sourceMark = (docs) => docs.map((d) => d.id + ':' + d.mark).join('|');
  const storyNow = await db.stories.get(storyId);
  if ((storyAtStart && !storyNow) || String(storyNow?.brief || '') !== String(storyAtStart?.brief || '') || String(storyNow?.castNotes || '') !== String(storyAtStart?.castNotes || '')) return null;
  if (sourceMark(auditSources({ brief, castNotes, messages: now })) !== sourceMark(documents)) return null;
  // Re-read after all calls and preserve unrelated writes made while we waited.
  result = judge(await loadState(storyId), offered);
  const outstanding = [...new Map([...originalFindings, ...unresolvedFindings(result)].filter((i) => !findingSettled(i, result, withdrawals, documents)).map((i) => [i.what, i])).values()];
  pending = [...new Set([...missingLedgerPeople(result.out, castNames), ...outstanding.map((i) => i.what + ': ' + i.pendingReason), ...(sourceReview?.pending || []), ...(answerProblem ? [answerProblem] : []), ...(followupFailed ? ['the repair followup did not finish'] : [])])];
  result.unfinished = pending.length > 0;
  result.pending = pending;
  result.out.audit = { ...result.out.audit, pending, unresolved: outstanding, unfinished: result.unfinished,
    ...(sourceReview ? { coverage: { read: sourceReview.read, total: sourceReview.total } } : {}) };
  if (sourceReview) result.out.auditSources = sourceReview.cache;
  await saveState(storyId, result.out);
  notify(storyId);
  const { out, ...answer } = result;
  return { ...answer, raw, looked };
}

function repairKey(mutation) {
  const metadata = new Set(['cause', 'shown', 'evidence', 'source', 'auditReason']);
  return JSON.stringify(Object.fromEntries(Object.keys(mutation).filter((k) => !metadata.has(k)).sort().map((k) => [k, mutation[k]])));
}

function unresolvedFindings(result) {
  return result.issues.filter((i) => i.refused?.length || (!i.landed && !(i.pages && i.fix))).map((i) => ({
    what: i.what, fix: i.fix, pendingReason: i.refused?.join('; ') || 'no repair was supplied',
    mutations: result.rejected.filter((r) => i.mutations.includes(r.mutation) && !r.same && !r.standing).map((r) => r.mutation),
  }));
}
function findingSettled(issue, result, withdrawals, documents) {
  if (withdrawals.some((r) => r.what === issue.what && documents.some((d) => quotedSource(d.text, r.shown)))) return true;
  const landed = [...result.applied, ...result.rejected.filter((r) => r.same)];
  return issue.mutations?.length > 0 && issue.mutations.every((m) => landed.some((a) => sameRepairTarget(m, a.mutation)));
}

function sameRepairTarget(before, after) {
  if (!before || !after) return false;
  const target = (m) => String(m.name || m.from || m.title || '').trim();
  const a = target(before); const b = target(after);
  if (a || b) { if (!a || !b || !(a === b || samePersonName(a, b))) return false; }
  if (before.type === 'people.forget' && after.type === 'people.rename') return true;
  const type = (m) => m.type === 'people.note' ? 'people.set' : m.type;
  return type(before) === type(after) && String(before.field || before.key || '') === String(after.field || after.key || '');
}

/* Pure rehearsal and commit plan. The same guards validate both the first
 * proposal and the recovery, against the latest saved state each time. */
function judgeAudit({ fresh, offered, all, brief, castNotes, castNames, statedByModel }) {
  const read = { issues: offered.map((i) => ({ ...i, mutations: (i.mutations || []).map((m) => ({ ...m })) })) };
  const scopeRejected = [];
  /* M259: the latest STORY page's header line has already written the ground
   * and the hour in code (M128/M131) — the auditor never overrides it. */
  const latestStory = [...all].reverse().find((m) => m && m.role === 'assistant' && !m.ooc);
  const header = latestStory ? headerMutations(pageText(latestStory), { ground: (fresh.place || {}).name || '' }) : []; /* M627 */
  /* M679: the newest page's own index, counted as the chain stamps what it writes (chat.js: the page in hand among the
   * visible pages) — what its readers wrote on it is the journal's at that index, and nothing at all when they never read it */
  const storyPages = all.filter((m) => m && m.role === 'assistant');
  const newestAt = latestStory ? storyPages.findIndex((m) => m.id === latestStory.id) : -1;
  const latestIndex = latestStory ? all.indexOf(latestStory) : -1;
  const writerPage = latestIndex > 0 && all[latestIndex - 1].role === 'user' && !asideAt(all, latestIndex - 1) ? pageText(all[latestIndex - 1]) : '';
  read.issues = auditorScope(read.issues, fresh, { header, page: latestStory ? pageText(latestStory) : '', writerPage, pageAt: newestAt !== -1 ? newestAt : null, rejected: scopeRejected, evidenceText: [brief, castNotes, ...all.filter((m, i) => !asideAt(all, i)).map(pageText)].join('\n') }); /* validate without silently erasing blocked findings */
  /* M684: completed turns include the writer’s established scene facts. Keep the
   * assistant-page indices, including OOC slots, aligned with journal stamps. */
  const turnScenes = storyPages.map((m) => {
    const at = all.indexOf(m);
    if (m.ooc || asideAt(all, at)) return '';
    const writer = at > 0 && all[at - 1].role === 'user' && !asideAt(all, at - 1) ? pageText(all[at - 1]) : '';
    return scenePartOf(writer) + '\n\n' + scenePartOf(pageText(m));
  });
  {
    const lastTexts = turnScenes.filter(Boolean).slice(-2);
    const storyTexts = turnScenes;
    /* M414: named by the one answer (engine/names.js — never a title or "the"), and a going the NARRATION shows */
    /* M446: the newest page that names them as themself decides, and its LAST such line: gone at its end (goneAtTheEnd) —
     * never a going read off a family name another person shares ("Kuchiki-taichō left" is not Rukia), never one a later
     * line takes back (she came back with the files) */
    const showsGoing = (n) => {
      for (let i = lastTexts.length - 1; i >= 0; i -= 1) {
        if (!scenePartOf(lastTexts[i]).split(/\n+/).some((l) => shownOnPage(fresh, l, n))) continue;
        return goneAtTheEnd(fresh, lastTexts[i], n);
      }
      return false;
    };
    // M684: silence is never a departure. An older missed departure can still
    // be repaired, but only from a page after their most recent arrival.
    const goneSinceArrival = (n) => {
      const arrival = [...(fresh.journal || [])].reverse().find((j) => j?.m?.type === 'presence.enter' && samePersonName(j.m.name, n));
      const since = arrival && Number.isInteger(arrival.p) ? Math.max(0, arrival.p) : 0;
      for (let k = storyTexts.length - 1; k >= since; k--) {
        if (shownOnPage(fresh, narrationOf(scenePartOf(storyTexts[k])), n)) return goneAtTheEnd(fresh, storyTexts[k], n);
      }
      return false;
    };
    /* M598: the newest page ends on HIM going — whoever he walked away from is left behind; the auditor's leave stands, as
     * the page reader's does (M588) */
    const mcNowName = mcName(fresh);
    const mcLeft = Boolean(lastTexts.length && mcNowName && mcNowName !== 'the player' && mcWalksOff(lastTexts[lastTexts.length - 1], mcNowName));
    const kept = [];
    for (const issue of read.issues) {
      if (!issue || !Array.isArray(issue.mutations) || !issue.mutations.length) { kept.push(issue); continue; }
      /* M644: …or it hands over the page's own words for the going, and they hold on one of the last two pages */
      const quoted = (m) => lastTexts.some((t) => quotedGoing(fresh, t, m.name, m.shown));
      /* M680: …or it is a death one of the last two pages tells of them ("to" begins "dead — "): the page goes on naming the
       * body, so no going is ever its last word (apply.js deathToldOf, the page reader's own door) */
      const died = (m) => isDeadSeat({ location: m.to }) && lastTexts.some((t) => deathToldOf(fresh, t, m.name));
      const muts = issue.mutations.filter((m) => {
        if (!(m && m.type === 'presence.leave' && !showsGoing(m.name) && !quoted(m) && !died(m) && !goneSinceArrival(m.name) && !mcLeft)) return true;
        scopeRejected.push({ mutation: m, issue, why: 'no departure after their latest arrival was established; silence does not remove a companion' });
        return false;
      });
      if (!muts.length && !(issue.pages && issue.fix)) continue; /* a finding that was only a refused leave is no finding */
      kept.push({ ...issue, mutations: muts });
    }
    read.issues = kept;
  }
  /* M444: CLEARED IS NEVER NOWHERE — a note it lets go of someone the latest page shows there is her walking in (converted
   * on the finding itself, so the report says what landed) */
  {
    const sceneNow = latestStory ? scenePartOf(pageText(latestStory)) : '';
    if (sceneNow) read.issues = read.issues.map((i) => (i && Array.isArray(i.mutations) && i.mutations.length ? { ...i, mutations: clearsThatArrive(fresh, i.mutations, sceneNow) } : i));
  }
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
  const identitySource = [brief, castNotes, ...all.map(pageText)].join('\n');
  const material = (String(brief || '') + '\n' + String(castNotes || '')).toLowerCase();
  const keptStandings = [];
  const identityRefused = [];
  const guarded = [];
  const mcHere = mcName(fresh) !== 'the player' ? mcName(fresh) : '';
  for (const [m, issueWhat] of read.issues.flatMap((i) => i.mutations.map((mu) => [mu, i.what]))) {
    if (m.sourceRecovery) {
      const key = findPersonKey(fresh.characters || {}, m.name);
      if (key && (String(fresh.characters[key]?.core || '').trim() || fresh.characters[key]?.hand?.core)) {
        identityRefused.push({ mutation: m, why: 'their identity has already been restored', same: true });
        continue;
      }
    }
    m.source = 'auditor';
    m.auditReason = issueWhat;
    const hasLinks = (name) => isHere(fresh, name) || Object.keys(fresh.knowledge || {}).some((n) => samePersonName(n, name))
      || Object.keys(fresh.relationships || {}).some((n) => samePersonName(n, name))
      || (fresh.threads || []).some((t) => samePersonName(t.owner || '', name));
    if (m.type === 'people.forget' && (nameOnPage(identitySource, m.name) || hasLinks(m.name))) {
      identityRefused.push({ mutation: m, why: 'the story establishes this person; correct their name with a rename so their records stay together' });
      continue;
    }
    if (m.type === 'people.rename') {
      const identityQuote = quotedSource(identitySource, m.shown);
      const sameIdentity = samePersonName(m.from || '', m.to || '') || (identityQuote && exactNameIn(identityQuote, m.from) && exactNameIn(identityQuote, m.to));
      if (!exactNameIn(identitySource, m.to) || !sameIdentity || isMc(fresh, m.from)) {
        identityRefused.push({ mutation: m, why: 'a correction needs the exact name established in the story and may not rename the main character automatically' });
        continue;
      }
    }
    if (m && (m.type === 'rel.set' || m.type === 'rel.shift') && typeof m.name === 'string') {
      /* M449: THE GUARD ASKS THE SAME QUESTION THE APPLIER WILL (M164's law). This found the standing by its EXACT name,
       * while the applier finds a person's book under any form of their name (M419): a rel.set for "Rukia" saw no
       * standing, was not "lowering", and zeroed Rukia Kuchiki's earned P:15 — the one thing M48 says the auditor may
       * never do on judgment. */
      const key = personBookKey(fresh, fresh.relationships || {}, m.name, (map, n) => { const f = findRelationship(map, n); return f ? f.key : null; });
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
      /* M599 (the audit — a worker told to do what its door refuses): M588 told the auditor "a lover at P+2 with R at 0 is a
       * wrong standing to restore", and this guard refused it — P had been moved by a page, so the whole standing counted as
       * the pages'. A standing is three axes: an axis the pages never moved and that stands at zero is restored like a zero
       * standing (the brief names the person, the cause quotes it), while every axis the pages moved is left exactly as it
       * stands — never raised, never lowered. */
      const axisEarned = (ax) => Boolean(rel) && Array.isArray(rel.history) && rel.history.some((h) => h && h.axis === ax && typeof h.cause === 'string' && !/^the brief\b|^set\b|^the founder\b/i.test(h.cause.trim()));
      const given = (ax) => m[ax] !== undefined && m[ax] !== null && Number.isFinite(Number(m[ax]));
      /* the axes the pages moved are left out of it (never raised, never lowered) — whatever the auditor wrote for them */
      const restoresZeroAxes = m.type === 'rel.set' && Boolean(rel)
        && ['p', 'r', 's'].some((ax) => given(ax) && Number(m[ax]) > 0 && !(rel[ax] || 0) && !axisEarned(ax));
      if (rel && !zero && earned && !lowering && restoresZeroAxes) {
        const cause = String(m.cause || '');
        const named = material.includes(m.name.trim().toLowerCase());
        const quotes = /\b(brief|cast notes?)\b/i.test(cause);
        const bareCause = /^the (brief|cast notes?)(\s+(says|states|said))?\.?$/i.test(cause.trim());
        if (named && quotes && !bareCause && !isMc(fresh, m.name)) {
          /* only the zero, never-moved axes ride (in place, so the finding's report still knows its own mutation) */
          for (const ax of ['p', 'r', 's']) if (!(given(ax) && !axisEarned(ax) && !(rel[ax] || 0))) delete m[ax];
          guarded.push(m);
          continue;
        }
      }
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
  guarded.push(...seatIdentityHousekeeping(fresh)); /* M320 */
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
  guarded.push(...standingsHousekeeping(fresh, brief, castNotes, mcKnown, statedByModel)); /* M680: the digits were read before the ledger was */
  /* M680: its writes are the newest page's, stamped with its index even when the page reader's call failed */
  const { state: next, applied, rejected: rejectedByApplier } = applyMutations(newestAt !== -1 ? { ...fresh, page: newestAt } : fresh, guarded);
  /* M679: a line of who knows what the ledger ALREADY holds is "already so", not a refusal — his turn-21 reading listed eight
   * "Seen; its change did not hold (Mirelia already knows that)" (M680: marked so at its source, apply.js knowledge.add,
   * for every worker's line) */
  const rejected = [...rejectedByApplier.map((r) => (r && r.mutation && /^rel\./.test(r.mutation.type) && /holds no standing/.test(String(r.why || '')) ? { ...r, standing: true } : r)), ...keptStandings, ...identityRefused, ...scopeRejected];
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
  const reportIssues = read.issues.map((i) => ({ ...i, mutations: [...i.mutations] }));
  for (const r of scopeRejected) {
    let issue = reportIssues.find((i) => i.what === r.issue.what && i.fix === r.issue.fix);
    if (!issue) { issue = { ...r.issue, mutations: [] }; reportIssues.push(issue); }
    if (!issue.mutations.includes(r.mutation)) issue.mutations.push(r.mutation);
  }
  for (const i of reportIssues) {
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
  const out = { ...next, audit: report, ...(newestAt !== -1 ? { page: fresh.page } : {}) }; /* M680: its writes carry the newest page; the ledger's own stamp is not the auditor's to move */
  return { out, applied, rejected, issues, note: 'ok', leftStandings, reportAt: report.at };
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
    ...seatIdentityHousekeeping(fresh), /* M320: first — the rest of the upkeep then sees each person's one seat */
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
  /* M398: here and seated by the one matcher — "Rukia" in the scene is Rukia Kuchiki here; a seat under any form of a name is theirs */
  const presentSet = new Set((state.present || []).map((p) => lower(p && p.name)));
  const present = { has: (k) => presentSet.has(k) || isHere(state, k) };
  const seatedSet = new Set(Object.keys(state.offscreen || {}).map(lower));
  const seated = { has: (k) => seatedSet.has(k) || Boolean(seatForPerson(state, k)) };
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
  'canon.lock', 'canon.unlock', 'thread.set', 'thread.close', 'knowledge.add', 'knowledge.forget', /* M372: a wrong fact can be let go */
  'faction.set', 'faction.clear', 'people.set', 'people.note', 'people.forget', 'people.rename', /* M684: a corrected identity keeps all its books */
  'thing.set', 'thing.clear', /* M604: a thing in the wrong place, or one the pages destroyed */
  'mode.snapshot', /* M681 (S13): the whole board — only when no reader stated it for the newest page (boardStale) */
]);
/* M681 — A MOOD BOARD NO READER STATED FOR THE NEWEST PAGE IS STALE, AND THE AUDITOR RESTATES IT (the scene audit's S13, made to
 * happen on m680-001): the board is the page reader's, stated whole every page (M47) and asked once more when its answer
 * forgot it (M92) — but a reader that forgot it twice, or failed, or never reached the newest page, left the board of an
 * older page standing ("travel" long after they had arrived), and the one reader of the whole ledger was barred from it
 * (M259): the storyteller was handed the wrong moods' rules until some later page's reader happened to state it. The house
 * knows when that is: the page reader marks the page whose board it stated (state.moodAt — even when it changed nothing,
 * which the journal cannot show). When the newest page is not that page, and nothing its readers wrote touched the board,
 * the auditor is told so and its one mode.snapshot lands; otherwise the board stays the reader's alone, as before. */
export function boardStale(state, pageAt) {
  if (!Number.isInteger(pageAt) || !state || !Number.isInteger(state.moodAt) || state.moodAt >= pageAt) return false;
  return !(Array.isArray(state.journal) ? state.journal : []).some((j) => j && j.p === pageAt && j.m && typeof j.m.type === 'string' && j.m.type.startsWith('mode.'));
}
/* M279: "stands as the pages moved it", "not the ledger's to zero" — thirteen such lines at turn 77 */
const ALL_IS_WELL = /\b(stands? as written|stands? as the (?:pages|story) (?:have |has )?(?:moved|left|put|set) (?:it|them|her|him)|not (?:the ledger'?s|mine|the auditor'?s) to (?:zero|move|change|touch)|left as written|as the story has it|(?:is|are) (?:live and )?(?:correct|correctly \w+|complete|consistent|accurate|fine)|none is wrongly|nothing (?:is )?(?:wrong|stale|missing)|match(?:es)? the (?:brief|pages)|no canon contradicts|no (?:change|fix) (?:is )?needed)\b/i;

/* M414's departure reader lives with the engine's other readers of a page now (engine/apply.js) — the page reader asks it too (M446) */
export { showsDeparture };

/* M268: "→ no change" and "the moment, not mine to report" were still reported */
const NO_CHANGE_FIX = /^\s*(?:no change|none|nothing(?: to (?:do|change|fix))?|no action|leave it(?: as it is)?|as is|n\/a)\b/i;
const NOT_MINE = /\bnot mine to report\b|\bnot (?:my|the auditor'?s) (?:job|door)\b|\bomits? (?:nothing|no one)\b|\badds? no one\b|\bmatch(?:es)? the header\b/i;
/* M656 (the ledger audit, part thirteen — the auditor's whole call): AN ISSUE THAT FINDS NOTHING IS NOT AN ISSUE. "No issues
 * found." with no fix and no change was reported as one of the audit's findings (the second reader's twin of it was
 * cured at M649). */
const FINDS_NOTHING = /^(?:none|n\/?a|nil|nothing(?:\s+(?:found|to (?:report|fix|flag|change)|wrong|amiss))?|no\s+(?:issues?|problems?|errors?|drift|contradictions?|inconsistenc(?:y|ies)|findings?|faults?|changes?)(?:\s+(?:were\s+|was\s+)?(?:found|detected|noted|needed|to report))?|(?:the\s+)?ledger\s+(?:is|looks|seems)\s+(?:consistent|correct|sound|in order|accurate|up to date)\b[^.]*|(?:all|everything)\s+(?:is\s+|looks\s+|seems\s+)?(?:consistent|in order|fine|good|correct)\b[^.]*)\.?$/i;
export function saysAllIsWell(issue) {
  const fix = String((issue && issue.fix) || '');
  const what = String((issue && issue.what) || '');
  if (!fix.trim() && FINDS_NOTHING.test(what.trim()) && !/\b(?:but|though|although|except|however|yet)\b/i.test(what)) return true;
  if (NO_CHANGE_FIX.test(fix)) return true;
  if (NOT_MINE.test(what) && !/\b(?:set|close|add|clear|restore|zero)\b/i.test(fix)) return true;
  return ALL_IS_WELL.test(fix) || (ALL_IS_WELL.test(what) && !/\bbut\b/i.test(what));
}

/* M544: A PLACE IN THE ROOM THE PAGE LEFT BEHIND. His auditor saw "the ledger's 'Here now' still describes Jovan Wells as being
 * in the kitchen with the cordless taken out of his hand, but the pages show him upstairs at the door of Rias's room" — and
 * could change nothing: a place in the room is the page reader's to write (M128), so the finding stood as "Seen, left as the
 * story has it" and the storyteller went on reading him in the kitchen. The one safe repair is the auditor's to make: when it
 * reports someone's place in the room as wrong and none of that place's own words are on the newest page, the old place is
 * let go (no new one is written — the page reader writes the new one from the page). */
const PLACE_STOP = new Set(['about', 'after', 'again', 'along', 'around', 'before', 'behind', 'below', 'beside', 'between', 'their', 'there', 'these', 'those', 'under', 'where', 'which', 'while', 'with', 'still', 'other', 'every', 'being']);
function placeWordsOnPage(position, told) {
  const words = String(position || '').toLowerCase().match(/[\p{L}']{5,}/gu) || [];
  const own = words.filter((w) => !PLACE_STOP.has(w));
  if (!own.length) return true; /* nothing to judge by — leave it */
  const text = String(told || '').toLowerCase();
  return own.some((w) => text.includes(w));
}
/* M679 — HIS TWO READINGS (turns 19 and 21): "why my mc at the end of pages already moving on not with Corven but the auditor
 * change stupidly back to with Corven like at the start of the page? Auditor should not cause mistake." The page reader had
 * the room right as the page ENDED — Azrael gone off with the page boy toward the small council room, Corven and Ser
 * Holvard left at the hall; Mirelia left holding her ground "as they walked away" — and the auditor, reading the same page
 * from its START, walked Corven, Ser Holvard and Mirelia back in, put Azrael back "at the hall's threshold beside Corven"
 * and the cloak back over his forearm there. Its law told it the ledger it reads "describes the moment BEFORE the latest
 * page" — but it runs last, after that page's own readers: the ledger it reads is the scene as the page ENDS. And every door
 * asked only "are these words somewhere on the page?": a walk-in stood for anyone shown and not leaving (M535 — his going
 * never asked about), a place or a dress for words from anywhere in it (M661), a thing likewise (M604).
 * THE PRESENT IS THE PAGE'S ENDING, and the auditor keeps every door: what it writes of the scene is held to how the newest
 * page ENDS (pageEnding — its last paragraph, or the last two or three when they are short). A walk-in stands only for
 * someone the ending shows, and never for someone this page's own reader took out (a name in the ending is no proof of
 * company: "Corven let him go" names Corven); a place or a dress only in the ending's own words — and for him, never
 * against his header's place and dress (his as the page ends, M661); a thing's new place, when the page tells of that thing
 * or its reader moved it, only in the ending's words. Everything else — what lasts, what the readers never touched — is
 * the auditor's as it always was. */
export { pageEnding }; /* engine/apply.js — the house's heal of who is here reads it too */
const ENDING_STOP = /^(?:the|and|with|his|her|their|its|still|now|into|onto|from|over|under|near|beside|behind|front|side|back|that|this|has|have|had|was|were|are|for|one|two|out|off|him|she|they|them)$/;
const endingWords = (t) => new Set(String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !ENDING_STOP.test(w)));
/* do these words stand in that text, half of them at least? */
const wordsIn = (words, text) => { const w = [...endingWords(words)]; const t = endingWords(text); return w.length > 0 && w.filter((x) => t.has(x)).length / w.length >= 0.5; };
const journalOfPage = (state, at) => (Array.isArray(state && state.journal) ? state.journal : []).filter((j) => j && j.p === at && j.m && typeof j.m === 'object').map((j) => j.m);
export function auditorScope(issues, state, { header = [], page = '', writerPage = '', pageAt = null, rejected = null, evidenceText = '' } = {}) {
  const restatedOk = new WeakSet(); /* M661: the changes of place and dress the newest page bears out */
  /* M679: the page's ending, what its own readers wrote on it (the journal at its index — nothing when they never read
   * it), and his header's own place and dress */
  const ending = page ? pageEnding(page) : '';
  const endingTold = narrationOf(ending);
  const supported = (m, source, needsText = true) => {
    const quote = quotedSource(source, m.shown);
    return Boolean(quote && (!m.name || exactNameIn(quote, m.name)) && (!needsText || (m.text && exactNameIn(quote, m.text))));
  };
  const sceneTold = page ? narrationOf(scenePartOf(page)) : '';
  const readersWrote = Number.isInteger(pageAt) ? journalOfPage(state, pageAt) : [];
  const movedThisPage = (thing) => readersWrote.some((jm) => jm.type === 'thing.set' && typeof jm.name === 'string' && Boolean(findThingKey({ [jm.name]: true }, String(thing || ''))));
  const samePerson = (a, b) => typeof a === 'string' && typeof b === 'string' && (samePersonName(a, b) || (isMc(state, a) && isMc(state, b)));
  const openedThisPage = (name, text) => readersWrote.some((jm) => jm.type === 'people.note' && /^thread$/i.test(String(jm.field || '').trim()) && samePerson(jm.name, name) && sameLooseEnd(String(jm.text || ''), String(text || '')));
  const his = page ? headerDress(page) : null;
  if (page && Array.isArray(issues)) {
    const told = narrationOf(scenePartOf(page));
    issues = issues.map((issue) => (issue && Array.isArray(issue.mutations) ? { ...issue, mutations: issue.mutations.map((m) => {
      /* M661: THE AUDITOR CAN SET RIGHT WHERE SOMEONE STANDS AND WHAT THEY WEAR — held to the page as the reader is. It saw
       * "the presence list still has Barbara in a heavy coat" and had no change of its own for it (it wrote a "now", which
       * is not its to write): the finding was reported and nothing landed. A presence.update whose words are the newest
       * page's own, and truly other than the ledger has, stands (apply.js restatedPresence). M679: the words of the page's
       * ENDING — and for him, never against his header's own place and dress. */
      if (m && m.type === 'presence.update' && typeof m.name === 'string') {
        const mine = isMc(state, m.name);
        const heldAt = Boolean(mine && his && his.position);
        const heldWears = Boolean(mine && his && his.attire);
        const at = typeof m.position === 'string' && !(heldAt && !wordsIn(m.position, his.position)) ? m.position : '';
        const wears = typeof m.attire === 'string' && !(heldWears && !wordsIn(m.attire, his.attire)) ? m.attire : '';
        /* each field on its own: his place (his dress) in his header's own words stands as the header's does, borne out by
         * the page's telling; any other place or dress stands only in the ending's words */
        const placeFix = at ? restatedPresence(state, [{ name: m.name, at, wears: '' }], [], heldAt ? page : ending)[0] : null;
        const dressFix = wears ? restatedPresence(state, [{ name: m.name, at: '', wears }], [], heldWears ? page : ending)[0] : null;
        if (placeFix || dressFix) {
          const fixed = { type: 'presence.update', name: (placeFix || dressFix).name, ...(placeFix ? { position: placeFix.position } : {}), ...(dressFix ? { attire: dressFix.attire } : {}) };
          restatedOk.add(fixed);
          return fixed;
        }
      }
      if (!(m && m.type === 'presence.update' && typeof m.name === 'string' && typeof m.position === 'string' && m.position.trim())) return m;
      const entry = (Array.isArray(state && state.present) ? state.present : []).find((p) => p && typeof p.name === 'string' && isHere({ present: [p] }, m.name));
      const was = entry && typeof entry.position === 'string' ? entry.position : '';
      return was && !placeWordsOnPage(was, told) ? { type: 'presence.update', name: entry.name, position: '', staleClear: true } : m;
    }) } : issue));
  }
  const headerPlace = ((Array.isArray(header) ? header : []).find((x) => x && x.type === 'place.set') || {}).name || '';
  const mc = String((state && state.sheet && state.sheet.playerName) || '').trim().toLowerCase();
  const said = Array.isArray(header) ? header : [];
  /* does the header line agree with this place or hour? null when it is silent */
  const headerAgrees = (m) => {
    const h = said.find((x) => x && x.type === m.type);
    if (!h) return null;
    if (m.type === 'place.set') return samePlace(String(h.name || ''), String(m.name || m.place || '')); /* M403: one place matcher */
    /* M657 (the ledger audit, part fourteen — the auditor's own refusals): THE HEADER AGREES ON WHAT THE HEADER SAYS. Every
     * field was compared, and a header in his own calendar ("Sunday, Hanami 5, 1001 AG | 09:20") carries an hour and no
     * year, month or day: nothing equals a missing number, so the auditor's clock.set was refused even when it set
     * EXACTLY the header's hour — in such a tale it could never bring the clock to the page. Only the fields the header
     * carries are compared; a date the header does not give is not the auditor's to add. */
    const KEYS = ['year', 'month', 'day', 'hour', 'minute'];
    const has = (o, k) => o[k] !== undefined && o[k] !== null && o[k] !== '' && Number.isFinite(Number(o[k]));
    const carried = KEYS.filter((k) => has(h, k));
    if (!carried.length) return null;
    if (KEYS.some((k) => !has(h, k) && has(m, k))) return false;
    return carried.every((k) => Number(h[k]) === Number(m[k]));
  };
  const seats = (state && state.offscreen && typeof state.offscreen === 'object') ? state.offscreen : {};
  /* M681 — THE AUDITOR MAY PUT A SEATED PERSON WHERE THE NEWEST PAGE HAS THEM (the world audit's W10). M128 dropped every
   * offscreen.set for someone already seated — the moment: an absent person's activity this hour, the world agent's to
   * move by the clock — and M259 kept it. But its own law asks "does each seat match where the pages last put that
   * person?", so a finding like "Rias's seat says the market; the page has her at the bar" was reported and its fix thrown
   * away, every audit, for good. What M128 guarded stays guarded: the SAME place said again (a new activity, a new want, the
   * place reworded) is the moment, and still dropped; and so is any move the newest page does not bear out in its own
   * telling — the world agent's seat walked forward by the clock is never walked back to where an older page left her. A
   * move stands only when the newest page's narration names her and the new place in its own words — and when this page's
   * own readers or the world placed her on it, only in the words of how the page ENDS (M679: never back to its start). */
  const seatTheNewestPageMoves = (m, held) => {
    const to = typeof m.location === 'string' ? m.location.trim() : '';
    const was = held && held.entry && typeof held.entry.location === 'string' ? held.entry.location.trim() : '';
    if (!page || !to || !was) return false;
    if (samePlace(was, to) || wordsIn(was, to) || wordsIn(to, was)) return false; /* the same place: the moment */
    if (!nameOnPage(sceneTold, m.name) && !nameOnPage(sceneTold, held.key)) return false;
    if (!wordsIn(to, sceneTold)) return false;
    const placedThisPage = readersWrote.some((jm) => (jm.type === 'offscreen.set' || jm.type === 'presence.leave') && typeof jm.name === 'string' && (samePersonName(jm.name, m.name) || samePersonName(jm.name, held.key)));
    return !placedThisPage || wordsIn(to, endingTold);
  };
  // A source quote from the answered writer input can establish a missed
  // arrival when a long reply uses only pronouns. Later departures still win.
  const writerArrival = (m) => {
    const writerScene = scenePartOf(writerPage);
    if (!quotedSource(writerScene, m.shown) || walkInFromPage(state, m.name, { page: writerScene, pageAt, shown: m.shown })) return false;
    const turn = writerScene + '\n\n' + scenePartOf(page);
    if (goneAtTheEnd(state, turn, m.name) || mcWalksOff(turn, mcName(state))) return false;
    const ground = state?.place?.name;
    return !headerPlace || !ground || samePlace(headerPlace, ground);
  };
  const moment = (m) => {
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return true;
    if (m.type === 'presence.update') return !(m.staleClear || restatedOk.has(m)); /* M544: the letting-go of a place the page left behind; M661: a place or an outfit the newest page bears out */
    if (!AUDITOR_TYPES.has(m.type)) return true;
    if (m.type === 'mode.snapshot') return !(boardStale(state, pageAt) || supported(m, endingTold, false));
    if (m.type === 'clock.set' && handSetClockSince(state, pageAt)) return true;
    /* the header line is the truth for the ground and the hour (M131): the
     * auditor may bring the ledger TO it, never move it anywhere else */
    const tellingMoves = m.type === 'place.set' && groundTheTellingStandsOn(state, page, m.name || m.place, headerPlace); /* M453 */
    if ((m.type === 'place.set' || m.type === 'clock.set') && headerAgrees(m) === false && !tellingMoves) return true;
    /* M403: THE GROUND IS THE PAGE'S. With the header silent, the auditor moved his whole scene out of the courtyard to
     * "1st Division HQ — outside the assembly hall" on its own reading — and every person in it went "elsewhere". It may
     * bring the ground TO what the latest page's header says; it never moves it on its own. */
    if (m.type === 'place.set' && headerAgrees(m) !== true && !tellingMoves) return true; /* M453: an echoing header does not hold a ground the telling has left */
    /* M679: a loose end written from this very page (by its scribe, its reader, his hand) is not closed on that page's
     * word: the page that says it is why it was written, never its answer (LOOSE_ANSWERED_MEANS) — what answers it comes
     * on a page after, and the readers of that page are asked of it by name */
    if (m.type === 'people.note' && /^unthread$/i.test(String(m.field || '').trim()) && openedThisPage(m.name, m.text)) return true;
    /* M681 (W6, the world audit — made to happen on m680-001): …and a thread opened from this very page is not closed on its
     * word either: the page that opens a want is never its answer (his "Roska hunts the fence" thread, written by the reader,
     * closed by the auditor reading the same page) */
    if (m.type === 'thread.close' && Number.isInteger(pageAt)) {
      const at = findThread(state && state.threads, m.title || m.name);
      const t = at !== -1 ? state.threads[at] : null;
      if (t && Number.isFinite(t.openedTurn) && t.openedTurn === pageAt + 1) return true; /* opened by this page's own readers (storyTurn = page + 1) */
    }
    if (m.type === 'people.note') {
      const field = String(m.field || '').trim().toLowerCase();
      if (field === 'unthread') return false;
      return !(['core', 'arc', 'thread'].includes(field) && supported(m, evidenceText || writerPage + '\n' + page));
    }
    /* someone already here who "comes in" is a move — the page reader's */
    /* M535: THE AUDITOR NEVER WALKS BACK IN SOMEONE THE NEWEST PAGE DOES NOT KEEP. His Bleach meeting broke up: the page
     * reader let the captains go, the world agent wrote where each went (Suì-Fēng out the side door to the 2nd's road,
     * Shinji down the corridor with Rose) — and the auditor, reading the names on the pages, wrote them all back "into the
     * scene" and let their seats go: sixteen in "Who's here" with everyone gone. It may bring someone in only when the
     * newest page shows them there and not leaving at its end; someone seated elsewhere the newest page does not show, or
     * shows going, keeps their seat. */
    /* M679/M680: a walk-in — and a seated person's note let go, which is a walk-in by another door (auditLedger:
     * clearsThatArrive) — is held to the one answer every such door now gives (apply.js walkInFromPage): only someone the
     * page's ending shows, never over this page's own reader's leave or the room it named, never the dead, nobody it ends
     * on going or on HIM walking off ("she held her ground in the column's shadow as they walked away"), nobody the world
     * seats elsewhere when the page moved the scene away from them */
    if (page && (m.type === 'presence.enter' || (m.type === 'offscreen.clear' && !isHere(state, m.name))) && typeof m.name === 'string') {
      if (walkInFromPage(state, m.name, { page, pageAt, shown: m.shown }) && !writerArrival(m)) return true;
    }
    /* M681: …and by its third door — a seat for someone with none, AT the scene's own place, is a walk-in (apply.js
     * offscreen.set, M402). A seated person's seat is the auditor's only as the newest page moves it (below, M681 W10); a
     * seat at the scene answers to the same question as its walk-ins first. The world agent alone seats a quiet person there (its "judged" seat). */
    if (page && m.type === 'offscreen.set' && typeof m.name === 'string' && !isHere(state, m.name) && m.stance !== 'toward' && m.stance !== 'seeking') {
      const ground = state && state.place && typeof state.place.name === 'string' ? state.place.name : '';
      if (ground && seatAtScene(String(m.location || ''), ground) && !isDeadSeat({ location: m.location, activity: m.activity }) && walkInFromPage(state, m.name, { page, pageAt, shown: m.shown })) return true;
    }
    /* M679: a thing's new place, when the page tells of that thing or its reader moved it, is the ending's */
    if (m.type === 'thing.set' && page && typeof m.name === 'string' && typeof m.where === 'string' && m.where.trim()) {
      const named = wordsIn(m.name.replace(/^\s*(?:the|a|an)\s+/i, ''), sceneTold);
      if ((named || movedThisPage(m.name)) && !wordsIn(m.where, endingTold)) return true;
    }
    if (m.type === 'presence.enter' && typeof m.name === 'string' && page) {
      const told = narrationOf(scenePartOf(page));
      if (goneAtTheEnd(state, page, m.name)) return true;
      /* M649: …shown there by name, or by the page's own words the auditor hands over ("his aunt came in" — the telling
       * often does not use the name; the page reader's walk-in has stood on such words since M644) */
      if (findSeat(seats, m.name) && !shownOnPage(state, told, m.name) && toldOnPage(page, m.shown).end === -1 && !writerArrival(m)) return true;
    }
    if (m.type === 'presence.enter' && Array.isArray(state && state.present) && findPresent(state, m.name, { strict: true }) !== -1) return true; /* M444: "already here" asked the way entering asks it — Captain Kuchiki is not Rukia */
    if (m.type === 'people.set') {
      if (mc && String(m.name || '').trim().toLowerCase() === mc) return true;
      const key = findPersonKey(state?.characters || {}, m.name);
      if (key && state.characters[key]?.hand?.[m.field]) return true;
      if (m.field === 'state') return !(isHere(state, m.name) && supported(m, endingTold));
      if (m.field === 'arc') return !supported(m, evidenceText || writerPage + '\n' + page);
      return m.field === 'threads';
    }
    if (m.type === 'offscreen.set' && typeof m.name === 'string' && findSeat(seats, m.name)) return !seatTheNewestPageMoves(m, findSeat(seats, m.name));
    if (m.type === 'thread.set' && findThread(state && state.threads, m.title || m.name) !== -1) return true;
    return false;
  };
  const kept = [];
  for (const issue of issues || []) {
    if (!issue || typeof issue !== 'object') continue;
    const muts = Array.isArray(issue.mutations) ? issue.mutations.filter((m) => {
      if (!moment(m)) return true;
      if (rejected) {
        const same = (m?.type === 'presence.enter' && isHere(state, m.name)) || (m?.type === 'place.set' && samePlace(state?.place?.name || '', m.name || m.place || ''));
        const why = m?.type === 'people.note' && m.field !== 'unthread'
          ? 'supply an exact shown source quote for people.note core, arc or thread; use people.set field core for an identity repair'
          : m?.type === 'people.set' && m.field !== 'core'
            ? 'this changes the current state or arc owned by the page reader; supply a source-backed correction, not a new simulation'
            : !AUDITOR_TYPES.has(m?.type) && m?.type !== 'presence.update'
              ? 'this operation is not in the auditor’s vocabulary: ' + String(m?.type || '(missing type)')
              : 'the proposed ' + String(m?.type || 'change') + ' conflicts with the newest page, its ending, or a fact already established by that page';
        rejected.push({ mutation: m, issue, why: same ? 'already recorded' : why, ...(same ? { same: true } : {}) });
      }
      return false;
    }) : [];
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
  if (counted && i.pages && i.fix) {
    const changed = Number(i.mendedPages) || 0;
    return { text: (changed ? 'Page repair applied: ' : i.landed > 0 ? 'Ledger corrected; page repair pending: ' : 'Page repair pending: ') + i.what + '. Intended correction: ' + i.fix, warn: !changed || Boolean(i.refused?.length) };
  }
  if (counted && i.landed > 0 && Array.isArray(i.refused) && i.refused.length) {
    return { text: 'Partly corrected: ' + i.what + '. Still unresolved: ' + i.refused.join('; '), warn: true };
  }
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
  const present = (state.present || []).some((p) => p && String(p.name || '').trim().toLowerCase() === n) || isHere(state, name); /* M398 */
  if (present) return 'in the scene';
  if (writersOwn(name, material, castNames)) return 'the brief names them';
  const relKey = Object.keys(rels).find((r) => samePersonLoose(r, name));
  const rel = relKey ? rels[relKey] : null;
  if (rel && ((rel.p || 0) || (rel.r || 0) || (rel.s || 0))) return 'a standing toward the main character';
  if (threads.some((t) => t && typeof t === 'object' && t.owner && samePersonLoose(t.owner, name))) return 'an open thread';
  const seatKey = Object.keys(seats).find((k) => samePersonLoose(k, name));
  const seat = seatKey ? seats[seatKey] : null;
  /* M681 (W5): on the way while the approach holds — one three hours past its hour carried a passer-through for ever */
  const clockNow = state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  if (seat && onTheWay(seat, clockNow)) return 'on the way to the main character';
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
    /* M598: retired FIRST, then the seat let go — a person who leaves the story is the one the always-somewhere rule
     * (M588) lets go of; the other way round the clear came first and was refused, and passers-through kept seats */
    const page = state.characters && Object.keys(state.characters).find((k) => samePersonLoose(k, name));
    if (page && !state.characters[page].retired) out.push({ type: 'people.retire', name: page, cause: 'nothing carries them — no bond, no thread, not on the clock, not named for ' + SEAT_MENTION_PAGES + ' pages' });
    out.push({ type: 'offscreen.clear', name });
  }
  /* the cap: the least reachable go first */
  if (kept.length > SEAT_CAP) {
    const clockNow = state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
    const rank = (name) => { const seat = seats[name] || {}; const st = seat.stance; return onTheWay(seat, clockNow) ? (st === 'toward' ? 0 : 1) : st === 'tense' ? 2 : st === 'busy' ? 3 : 4; }; /* M681 (W5): a lapsed approach is no nearer than any seat */
    const at = (name) => (Number.isFinite((seats[name] || {}).atTurn) ? seats[name].atTurn : -1);
    const ordered = kept.slice().sort((a, b) => (rank(b) - rank(a)) || (at(a) - at(b)));
    for (const name of ordered.slice(0, kept.length - SEAT_CAP)) {
      if (writersOwn(name, material, castNames)) continue; /* the brief's people are never capped out */
      out.push({ type: 'offscreen.clear', name });
    }
  }
  return out;
}

/* M320: a seat written under another form of its person's name (before seats were found the way pages are) is
 * put under the name their page stands under — so "elsewhere" and "the people" speak of one person. */
export function seatIdentityHousekeeping(state) {
  const out = [];
  const seats = state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {};
  const chars = state.characters && typeof state.characters === 'object' ? state.characters : {};
  for (const k of Object.keys(seats)) {
    const page = findPersonKey(chars, k);
    if (page && page.trim().toLowerCase() !== k.trim().toLowerCase()) out.push({ type: 'offscreen.rekey', from: k, to: page, cause: 'one person, one name' });
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
      /* M681 — A NAME THAT MEANS TWO PEOPLE IS NOBODY'S TO MERGE (the people audit's P4, made to happen on m680-001): a standing
       * under a bare "Rias" was folded into Rias Wells's while the ledger also kept Rias Gremory — whichever of them the beat
       * was about. Only a shorter name that means ONE person in the whole ledger is folded into the fuller one. */
      if (!oneMeaning(state, drop)) continue;
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
    /* M681 (P4's same fault, found by a search): the brief's "Rias" lands on the one standing it means — never the first of two
     * Riases, and never a new standing under a name that means two people */
    const keys = Object.keys(merged).filter((k) => samePersonLoose(k, st.name));
    const key = keys.length === 1 ? keys[0] : (keys.find((k) => k.trim().toLowerCase() === String(st.name || '').trim().toLowerCase()) || null);
    if (!key && (keys.length > 1 || !oneMeaning(state, st.name))) continue;
    const rel = key ? merged[key] : null;
    /* M681 — A STANDING THE PAGES WORE DOWN TO ZERO IS NOT MISSING (the people audit's P6, made to happen on m680-001): his
     * brief's "P+40" was written back over a standing three betrayals had brought to nothing — the house read zero as never
     * set. Zero stands when a page moved it (a beat in its history that no hand, brief or founder set); the brief's digits
     * are restored only to a standing the pages never touched. */
    const earnedOnPages = Boolean(rel) && Array.isArray(rel.history) && rel.history.some((h) => h && typeof h.cause === 'string' && !/^the brief\b|^set\b|^the founder\b/i.test(h.cause.trim()));
    if (isZero(rel) && (st.p || st.r || st.s) && !earnedOnPages) {
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
    'THE LATEST PAGES:', Q, (pages || []).map((p) => (p.aside ? asideLabel(p.role) + ': ' : (p.role === 'assistant' ? 'STORY: ' : 'PLAYER: ')) + wholePage(p.text, 12000)).join('\n\n'), Q, /* M674 */
    '',
    'THE PEOPLE THE LEDGER KNOWS: ' + (uniq.join(', ') || '(none)'),
    '',
    'For each of these people who has a bond or history with the main character — from the brief, the record,',
    'or the pages — write ONE rel.set with p, r, s and a cause that names the main character and quotes what',
    'earned it. Leave out anyone with no bond. Do not restate a person more than once. Digits the brief states',
    'are already written; you may still move them by what the pages have since shown.',
    /* M588: the same levels the page reader, the founder and the auditor carry — a rebuild that wrote a love at P+2 rebuilt
     * the same fault */
    'THE LEVELS: r (romance) drawn to him 10–25, a crush 25–45, in love 55–75, devoted love 75–90; p (warmth)',
    'acquaintance 5–15, friend 25–45, close friend or family 50–70, trusted with her life 75–90, dislike −15…−35,',
    'hatred −50…−80; s (desire) drawn 15–35, wanting 40–60, burning 60+. Romantic love is r, never p alone.',
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
  const firstShown = Math.max(0, all.length - AUDIT_PAGES);
  const pages = all.slice(firstShown).map((m, i) => ({ role: m.role, text: pageText(m), ...(asideAt(all, firstShown + i) ? { aside: true } : {}) })); /* M674: out of character is said to be */
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
  if (!n && !fixed && !result.unfinished) return 'no discrepancy found in this reading' + lookedWords(result.looked);
  const bits = n ? [`found ${n} ${n === 1 ? 'thing' : 'things'}`] : [];
  if (fixed) bits.push(`set ${fixed} right: ` + result.applied.slice(0, 4).map((a) => a.words.replace(/\.$/, '')).join(' · ') + (fixed > 4 ? ' · …' : ''));
  /* M277: standing moves it may not make, counted — not listed */
  if (result.leftStandings) bits.push(`left ${result.leftStandings} standing ${result.leftStandings === 1 ? 'change' : 'changes'} to the page reader`);
  const briefWins = result.issues.filter((i) => i.pages && i.fix).length;
  if (briefWins) bits.push(`${briefWins} the brief wins — ${result.mendedPages || 0} ${result.mendedPages === 1 ? 'page' : 'pages'} mended, their record lines folded again`); /* M330: no note is written into the record any more */
  const seen = result.issues.filter((i) => !i.mutations.length && !(i.pages && i.fix)).length;
  if (seen) bits.push(`${seen} seen, nothing to change`);
  const refusedN = result.rejected.filter((r) => !(r && r.same) && !(r && r.standing)).length; /* M259: "already so" is not a refusal; M278: a standing left to the page reader is counted once, below */
  if (refusedN) bits.push(`${refusedN} proposed ${refusedN === 1 ? 'change needs' : 'changes need'} a different repair`);
  if (result.pending?.length) bits.push('still checking: ' + result.pending.slice(0, 3).join('; '));
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
