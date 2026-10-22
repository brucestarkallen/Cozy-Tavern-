import { ledgerRepairInputKey, ledgerRepairStateKey, ledgerVerificationRows, verificationReceiptMatches,reusableAuditCheckpoint,saveAuditCheckpoint,auditCheckpointStart,matchingAuditSourceCheckpoint,answeredPages,carriedApprovals,verificationSourcesOf } from './auditprogress.js';
import { fingerprint36 } from '../engine/fingerprint.js';
import { LEDGER_READER_RULES, SCENE_ENDING_TASK, sceneEndingFields } from './ledgercontext.js';
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
import { seatForPerson, sameLooseEnd, roleOwnersNamed, roleWordOf, looseEndOn, looseEndPages } from '../engine/people.js'; /* M398; M679: a loose end matched by sense, as the applier matches it */
import { isHere, nameOnPage, samePersonName, oneMeaning, foldName, nameCore, sameOwnedDescriptor, isDescriptorName } from '../engine/names.js'; /* M398/M413; M414: named by the one answer; M679 */
import { shownOnPage, personBookKey, groundTheTellingStandsOn, narrationOf } from '../engine/apply.js'; /* M446: named as themself, never by a family name another shares; M449: the standing the applier will write */
import { findRelationship } from '../engine/relationships.js';
import { db } from '../store.js';
import { callWorker, workerRoom } from './call.js'; /* M752: workerRoom, the room a request leaves as the transport measures it */
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify, headerMutations, headerDress } from '../engine/state.js'; /* M679: his header's dress */
import { applyMutations, RETIRED_EXAMPLE_NAMES , storyTurn, findPresent, clearsThatArrive, scenePartOf, showsDeparture, goneAtTheEnd, quotedGoing, restatedPresence, toldOnPage, mcWalksOff, findThingKey, pageEnding, walkInFromPage, deathToldOf, comesInAtTheEnd } from '../engine/apply.js'; /* M444; M446: the departure reader, and who is gone at a page's end */
import { findSeat, isDeadSeat } from '../engine/offscreen.js';
import { findThread, onTheWay } from '../engine/world.js'; /* M681 (W5): an approach that lapsed is nobody on the way */
/* M240: it was told to catch a healed wound and never shown the wounds.
 * M259: and it was shown the storyteller's TRIMMED copy of everything else —
 * six standings, five threads, four things a person knows, no ground at all.
 * It reads the whole ledger now (engine/whole.js). */
import { renderWholeLedger, wholePage, PAGE_CAP, knowledgeRoomFor } from '../engine/whole.js';
import { askWithFetch, fetchLaw, roomChars, viewBudget, leashFor, LOOK_RESERVE } from './lookup.js'; /* M259: it looks for what it was not shown */
import { messageIndexLine, refOf } from './housekeeper.js';
import { asideAt, asideLabel } from '../commands.js'; /* M674: which pages are out of character, and how a request says so */
import { mcName, mcAliases, explicitMcPersona, groundedMcPersona, sourcePersonaMutations } from '../engine/duels.js';
import { isMc, namedInText, findPersonKey, sourceIdentityTargetKey, sourceIdentityTargetChoices, formerNameOwner } from '../engine/people.js'; /* M277: the main character holds no standing; M304: one matcher for "the writer's material names them" */
import { explicitStandings, readStatedStandings, validateStatedStandings, samePersonLoose, isLabel, statedDigits } from './founder.js'; /* M49/M50: the writer's digits, read the way the brief is shaped */
import { visiblePages, loadMemory, wholeRecord, recordWithPages } from './memory.js'; /* M51: the whole record, not the summarizer's tail */
import { pageText } from '../assemble/stack.js';
import { exactNameIn, quotedSource, WRITER_FACTS } from '../engine/evidence.js';
import { auditSources, reviewAuditSources, missingSourcePeople, missingSourceIdentityFacts, sourceFactScope, sourceIdentityNeeded, sourcePersonKey, peopleSourceIndex, SOURCE_IDENTITY_DECISION_GUIDANCE } from './auditsources.js';
import { reconcileAppearance,reconcileIdentity,sourceAppearanceFacts,sourceIdentityFacts } from './appearanceinventory.js';
import { lookKey } from '../engine/canon.js';
import { auditEvidenceBook,auditEvidencePassages } from './auditevidence.js';

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
  'people.reclassify {"type":"people.reclassify","name":"exact erroneous People name","kind":"place","cause":"why the original establishes a place rather than a person"} — kind place, organization, object or group. Use ONLY after judging the originals and determining this record is not an individual character. Its misplaced records are archived reversibly and its current source extraction is corrected. Do not rename a place into a prince merely because his title contains it. Save physical facts on their actual subject separately. Manual records and the player remain protected.',
  'source.resolve {"type":"source.resolve","sourceId":"original source section id","name":"exact extracted label","to":"person target only for an existing or newly created individual","kind":"person","scope":"local only for a supported source local individual","cause":"source evidence"}.'+SOURCE_IDENTITY_DECISION_GUIDANCE,
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30} — to the latest header line\'s own hour, or when the latest STORY page has none',
  'place.set {"type":"place.set","name":"the chapel"} — to the latest header line\'s own place, or when the latest STORY page has none',
  'presence.enter {"type":"presence.enter","name":"NAME","shown":"exact newest-page words establishing their presence","position":"their latest position, if shown"} / presence.update {"type":"presence.update","name":"NAME","position":"their latest position, in the page\'s own words","attire":"their latest attire, if shown","shown":"exact newest-page words establishing the corrected field"} / presence.leave {"type":"presence.leave","name":"NAME","shown":"the page\'s own words that show them going, copied exactly","to":"where the pages show them going, said so it stands on its own — upstairs in the Wells house — and left out only when the pages show no sign of where"}',
  'mc.set {"type":"mc.set","name":"MAIN CHARACTER"} — only when the ledger has no main character',
  'mc.alias {"type":"mc.alias","name":"PERSONA","shown":"the writer\'s exact explicit identity quote"} — register an explicitly established own persona of the MC, preserving their name and judgments. This clears the false separate Elsewhere seat and prevents World from seating that persona again. Never infer identity from similar names, roles or actions.',
  'body.injure {"type":"body.injure","name":"NAME","what":"…","sev":1-3} / body.heal {"type":"body.heal","name":"NAME","what":"…"}',
  '(no standing is in this vocabulary — rel.set, rel.shift and rel.clear are never yours: a beat is the page reader\'s, and the brief\'s explicit starting digits are restored by the house, from the standings list when you are asked for it)', /* M689: the code refuses every auditor rel.* */
  'offscreen.set {"type":"offscreen.set","name":"NAME","location":"…","activity":"…","agenda":"…","stance":"toward|seeking|tense|busy|waiting","etaMinutes":25} / offscreen.clear {"type":"offscreen.clear","name":"NAME","shown":"exact presence quote, or the writer\'s explicit MC persona identity quote"} (a clear only for someone in the scene now, or a false separate seat for the MC\'s own persona; anyone else keeps their whereabouts: a person the story keeps is always somewhere)',
  'thing.set {"type":"thing.set","name":"THE THING","where":"where it stands now","owner":"WHOSE"} / thing.clear {"type":"thing.clear","name":"THE THING","cause":"…"} (a vehicle, weapon or object the pages put somewhere — the Things list is what exists; correct where it stands when the pages say otherwise)',
  'canon.lock {"type":"canon.lock","name":"NAME","key":"hair","value":"black"} / canon.unlock {"type":"canon.unlock","name":"NAME","key":"hair"}',
  'thread.set {"type":"thread.set","title":"…","owner":"…","heat":"hot|cold","next":"…"} / thread.close {"type":"thread.close","title":"…"}',
  'knowledge.add {"type":"knowledge.add","name":"OTHER NAME","fact":"…"} / knowledge.forget {"type":"knowledge.forget","name":"NAME","fact":"the wrong line, as written"} — forget ONLY a line the pages contradict, and add the right one beside it',
  'faction.set {"type":"faction.set","name":"…","stance":"…","agenda":"…","move":"…"} / faction.clear {"type":"faction.clear","name":"…"} (one the pages ended)',
  'people.set {"type":"people.set","name":"NAME","field":"core|state|arc","text":"…"} — player core may record explicit original writer biography; never invent player nature or arc',
  'people.note {"type":"people.note","name":"NAME","field":"unthread","text":"the loose end as it stands"} \u2014 closes ONE finished loose end (field "thread" opens one); matched by sense, so word it close to how it reads',
  'Evidence-backed repairs: people.note field core|arc|thread, people.set field state|arc, and mode.snapshot flags are allowed with "shown": an exact source quote. Text must be supported by that quote. A state repair uses that person\'s latest own account on the newest scene; a mood repair uses the newest scene ending. Correct what the source established, never invent a new simulation.',
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
    '  - THE BODIES: a wound the pages show healed still open.',
    '  - THE STANDINGS are not yours to write: never rel.set, rel.shift or rel.clear, and never report a standing\'s numbers as a',
    '    finding. AXIS LOCK: standings describe feelings TOWARD THE MAIN CHARACTER only. The page reader starts and moves',
    '    bonds; the house restores the brief\'s explicit starting digits, axis by axis, only before earned changes, from the',
    '    standings list when you are asked for it. Never zero a real bond, never reset page-earned changes to the brief\'s',
    '    starting numbers, never choose replacement scores, never invent scores from a bond description. A feeling toward',
    '    someone else belongs as words on that person\'s page (people.note, field arc), never as a number.',
    '    Historical guidance for understanding bonds: the levels: friend P 25–45, close friend/family P 50–70, hatred',
    '    P −50…−80; crush R 25–45, in love R 55–75, devoted R 75–90. Romantic love is R, never P alone.',
    '    An axis the pages earned, even if now zero, stays earned.',
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
    'THE MAIN CHARACTER belongs to the writer. You may record explicitly written identity and biography',
    'in core from their original brief, cast notes or writer pages. Preserve existing writer facts. Never invent their nature or arc. Unknown biography is not a missing fact.',
    'Report only a concrete error or omission. Successful checks are not findings; if nothing is wrong, return an empty issues list.',
    'Continue the unfinished required checks. Already completed unchanged records retain their source-backed receipts; do not rewrite their valid biographies to manufacture another correction. All still-required entries are supplied together.',
    '',
    'THE MOMENT IS NOT YOURS TO INVENT: posture, position, dress, the mood board, what a hand is doing, a sip taken, a knee on the',
    'vinyl, clothing of the moment, an absent person\'s activity this hour, a thread\'s next small',
    'step, a character page\'s "now" line. The extractor, the world agent and the scribe rewrite',
    'those after EVERY page and have ALREADY read the latest one: the ledger you read is the scene as that page',
    'ENDS. Where its start differs (he walked off, the room emptied) the end is the present. Do not independently simulate',
    'another outcome. You MAY correct a field these readers got wrong when an exact shown quote establishes the correction.',
    'For a now use that person\'s latest established evidence on the newest scene; for mood use the newest scene ending. Never restore an earlier changed moment. Yours is what LASTS and what is WRONG: the wrong name, age, kin, origin, role; a person',
    'present who left pages ago or absent who is plainly here; a wound healed still open;',
    'a thread the pages closed still hot or a live agenda missing; a witnessed fact',
    'with no knowledge line; the clock or the ground wrong on a page with no header line; a duplicate.',
    'Report every supported discrepancy you find. There is no target count of findings; a large damaged ledger may need many repairs.',
    'For factual repairs use the original sources. EvidenceId from supplied references or an exact shown quote is useful optional provenance. Fetch missing context. Never reconstruct a quotation from memory or an old proposal. Explain the contradiction in what and the intended result in fix. Read later evidence before restoring an old fact. Do not change valid worker judgments of feelings, motives or simulation. Relationship numbers are reconciled separately from explicit starting digits and earned history; do not choose replacement scores.',
    'An arrival quote remains presence evidence after a later seated pose. For posture and attire use their latest own account, not a later incidental mention by someone else. Include shown on offscreen.clear as well.',
    'The MC\'s explicitly established own persona is the MC, not another person away from the scene. Clear a false separate elsewhere seat with the writer\'s exact identity quote. Never guess a persona from a similar name or from an intention to impersonate someone.',
    'A duplicate identity or duplicate seat is repaired with people.rename from an actual duplicate People record to the established name, retaining the records. A contextual description in source extraction is instead resolved locally with identities or source.resolve; never give every girl, stranger or captain in the whole story the same global alias. A presence.update does not merge two people. When a role record is the named person already here, merge it before clearing seats; offscreen.clear must not leave an independent tracked person nowhere. Do not treat an unchanged location stated with extra detail as proof that the existing location is wrong.',
    'A source-review quotation is evidence, not automatically a complete identity. For EVERY People record verify completeness as well as truth: recover established rank, family, background, enduring nature and preferences missing from core. An event sentence does not replace additional established identity facts; if none exist, unknown biography is legitimate. Review lasting physical details separately, restoring missing hair, eyes, build and scars with canon.lock. Use the original source index to fetch earlier pages and the brief, even for people elsewhere. Preserve valid existing facts and judgments; do not rewrite correct records merely for style. Reconcile descriptors with named identities before making another person.',
    'Only propose a repair for a factual difference. Rewording an equivalent position is not a correction. Recheck inherited findings against the newest page before repeating them. A quote from earlier in the same page does not overrule that person reaching a different position later in that page.',
    'Follow each person through the entire newest scene. Their last established position continues while others act;',
    'a long final paragraph about the duel does not remove quiet gallery spectators or erase their latest posture.',
    'A later departure, death, changed position or scene move still wins. Never restore an earlier moment over it.',
    '',
    'THE BRIEF WINS: when the PAGES themselves contradict the brief — a wrong name, a wrong relation, a',
    'wrong role, a person somewhere the brief says they cannot be, a fact the brief settles written the',
    'other way — that page was an error, not canon (the writer\'s own law). Report it with "pages": true',
    'and a "fix" that states, in one plain sentence, what the page should read instead — the brief\'s',
    'truth, exactly; and lock that truth in the ledger with the vocabulary (canon.lock or people.set, with',
    'the cause "the brief says …"; a bond\'s numbers are the house\'s to restore from the brief\'s digits). The house then mends that page by the smallest edit; you',
    'never rewrite a page yourself.',
    'THE PAGES SETTLE A BRIEF AT ODDS WITH ITSELF: when the brief says two things about one fact,',
    'the version the pages have already established is the story\'s — lock it (canon.lock, or people.set,',
    'with the cause "the brief says both; the pages settled it") and say so in "what"; if the pages have',
    'not touched that fact yet there is nothing to report — the storyteller will settle it the first time',
    'it comes up, and the ledger will hold what the page wrote. Nothing is reported as unfixable: every',
    'issue you list carries either mutations or a pages fix.',
    '',
    'Each mutation must correct a fact supported by the original story. You may include evidenceId or an exact shown quote as provenance. For current position, select the last established movement or resting position of that person across the completed story pages. A quiet spectator remains present unless later events establish departure or a scene move. Read beyond an earlier retreat: reaching the wall later means at the wall. Do not treat an opening header, an earlier move or an inherited complaint as the ending.',
    'Answer with JSON ONLY, exactly this shape:',
    '{"issues":[{"what":"the ledger says X; the pages say Y","fix":"what should be true","pages":false,"mutations":[ ... ]}],"checks":[]}',
    'When REQUIRED CURRENT LEDGER CHECKS are supplied, a completed whole-review verdict under review approves them together. You may alternatively give explicit entry checks. The app owns snapshot fingerprints. An empty issues list alone is not a completed review.',
    'Review every historical repair target against the ACTUAL current ledger and source pages. Report its id in resolved with shown and why when the ledger already satisfies it or the finding was mistaken. Repair remaining real errors. Historical refusal text is not evidence that the current ledger is still wrong.',
    'To withdraw a PREVIOUS UNRESOLVED ITEM because it was mistaken, return repairs:[{id:"the provided finding id",status:"correct",evidenceId:"the supplied original source reference",why:"why it is already correct or mistaken"}]. A fetched exact shown quote may replace evidenceId. An empty issues list alone does not close unfinished work. A real remaining error has status repair and working mutations; do not put a still-needed correction into resolved.',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    'A PLAYER page states what the main character ATTEMPTS; only the STORY page after it makes it so.',
    'A PLAYER page may directly establish names, ranks, family and biography. These do not require the',
    'STORY reply to repeat them. For attempted actions, read the completed turn in order: an attempt is',
    'not a guaranteed result, and a later departure or correction wins. Never turn a question into a fact.',
    'Names keep the spelling the ledger and the pages use. No commentary, no fences: the JSON only.',
    'Identity repairs are semantic decisions. An established role label may remain canonical when its People core and the literal source explicitly identify the named person. A role or title that more than one established person holds identifies none of them by itself: merge such a record only into the individual the originals single out, otherwise keep both records and leave that identity open. For mc.alias, the quoted original writer statement or completed narration must explicitly establish the known main character and that persona as one person; cooccurrence is insufficient. Read declarative shorthand and lists as well as ordinary sentences. The code checks provenance and named parties, not one preferred wording. These decisions are reviewed in the final provisional identity checklist.',
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
  const whole = renderWholeLedger(state, { knowledgeRoom: Number.isFinite(room) && room > 0 ? knowledgeRoomFor(room) : 0, material: (Array.isArray(pages) ? pages : []).map((p) => String((p && p.text) || '')).join('\n'), fetchable: true }) || 'Nothing is written in the ledger yet.'; /* M664: fitted to the auditor's room; M752: the seats its pages bear on */
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
    ...(state?.audit?.unresolved?.length ? ['HISTORICAL REPAIR CHECKLIST. The actual saved targets are supplied alongside the old allegations. For EACH id, either return a supported correction or put the id in resolved with shown and why. Already-present people are not missing. Equivalent descriptions are correct. A historical rejected proposal is not the desired truth:', JSON.stringify(auditRepairChecklist(state.audit.unresolved, state))] : []),
    ...(state?.audit?.pending?.length ? ['OTHER OUTSTANDING WORK:', ...state.audit.pending.filter(p => !(state.audit.unresolved || []).some(i => pendingOf(p, i.what)))] : []),
    'FINAL SCENE REVIEW: trace the newest story page chronologically. Its header describes the opening; a later arrival or movement sets the current position. Compare each person with the actual presence list, not the old allegations. A contact with a wall later in a retreat is at the wall. Do not substitute a temporary action for a stable People identity or replace valid feelings or earned scores.',
  ].join('\n');
  return { system: withFictionFrame(law({ mc }) + LEDGER_READER_RULES), user };
}

/* Exported for the harness. */
export function parseAuditorAnswer(raw) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    const candidates = balancedCandidates(text, 5);
    let parsed = null;
    for (const c of candidates) {
      const p = parseLenient(c);
      if (p && (p.review || Array.isArray(p.issues) || Array.isArray(p.repairs) || Array.isArray(p.profiles) || Array.isArray(p.checks))) { parsed = p; break; }
    }
    if (!parsed) return { issues: [], note: 'unusable' };
    const legacyResolved = Array.isArray(parsed.resolved) ? parsed.resolved : [];
    const repairs = [...(Array.isArray(parsed.repairs) ? parsed.repairs : []), ...legacyResolved.filter(r => r?.mutations?.length || (r?.status && r.status !== 'correct'))].filter(r => r && typeof r.id === 'string');
    // A sourced profile repair is a direct write request, not a complaint that
    // depends on the model remembering a second operation representation.
    const profiles = (Array.isArray(parsed.profiles) ? parsed.profiles : []).filter(p => p && typeof p.name === 'string').map(p => ({
      what:'Recover the established profile of '+p.name, fix:'Restore missing source facts while retaining valid traits.',
      targets:[{id:'characters:'+p.name}],
      mutations:[...['core','state'].filter(field => (p[field]?.text || (field === 'core' && p.open === true))).map(field => ({type:'people.set',name:p.name,field,append:field === 'core',text:p[field]?.text,evidenceId:p[field]?.evidenceId,shown:p[field]?.shown,...(field === 'core' && p.open === true && !p[field]?.text ? {open:true} : {})})),
        ...(Array.isArray(p.facts) ? p.facts : []).filter(f => f?.key && f?.value).map(f => ({type:'canon.lock',name:p.name,key:f.key,value:f.value,evidenceId:f.evidenceId,shown:f.shown}))],
    })).filter(p => p.mutations.length);
    const checkFacts=(parsed.checks || []).filter(c=>c.id?.startsWith('characters:') && ['correct','repair'].includes(c.status) && c.why?.trim()).map(c=>({
      what:'Save the source appearance reviewed for '+c.id.slice(11),targets:[{id:c.id}],
      mutations:(Array.isArray(c.physicalFacts)?c.physicalFacts:[]).filter(f=>f.key && f.value).map(f=>({type:'canon.lock',name:c.id.slice(11),key:f.key,value:f.value,evidenceId:f.evidenceId,shown:f.shown})),
    })).filter(i=>i.mutations.length);
    const identities = (Array.isArray(parsed.identities) ? parsed.identities : []).filter(p=>p && typeof p.sourceId==='string' && typeof p.name==='string').map(p=>({
      what:'Resolve '+p.name+' in its original source',mutations:[{type:'source.resolve',sourceId:p.sourceId,name:p.name,to:p.to,kind:p.kind || 'person',scope:p.scope,cause:p.why}]
    }));
    const issueRows = [...(Array.isArray(parsed.issues) ? parsed.issues : []), ...profiles,...checkFacts,...identities, ...repairs.filter(r => r.status !== 'correct' || r.mutations?.length).map(r => ({...r, findingId:r.id, what:r.what || r.why || r.id, fix:r.fix || r.why}))];
    const issues = issueRows
      .filter((i) => i && typeof i === 'object' && typeof i.what === 'string' && i.what.trim() && i.resolved !== true)
      .map((i) => ({
        what: i.what.trim().slice(0, 4000), /* M267: whole — it was cut at 300, mid-word */
        ...(i.findingId ? {findingId:i.findingId} : {}),
        ...(i.status ? {repairStatus:i.status} : {}),
        fix: typeof i.fix === 'string' ? i.fix.trim().slice(0, 4000) : '',
        ...(typeof i.shown === 'string' && i.shown.trim() ? { shown: i.shown.trim() } : {}),
        ...(typeof i.evidenceId === 'string' ? {evidenceId:i.evidenceId} : {}),
        ...(Array.isArray(i.targets) ? {targets:i.targets.filter(t => t && typeof t.id === 'string').map(t => ({id:t.id}))} : {}),
        /* M90: the pages are wrong and the brief wins — the house mends them */
        /* M654: a yes as a model writes it — "pages":"true" was no yes, and a fault that lives on the pages (a fix, no
         * change to the ledger) was then dropped as "no finding" */
        pages: i.pages === true || i.pages === 1 || (typeof i.pages === 'string' && /^\s*(?:true|yes|y|1)\s*$/i.test(i.pages)),
        mutations: Array.isArray(i.mutations) ? i.mutations.filter((m) => m && typeof m === 'object' && typeof m.type === 'string') : [],
      }));
    const resolvedItems = [...legacyResolved.filter(r => !r?.mutations?.length && (!r?.status || r.status === 'correct')), ...repairs.filter(r => r.status === 'correct' && !r.mutations?.length), ...issueRows.filter(i => i?.resolved === true && !i.mutations?.length).map(i => ({id:i.id, what:i.what, shown:i.shown, evidenceId:i.evidenceId, why:i.why || i.fix}))];
    const resolved = resolvedItems.filter((r) => r && (typeof r.what === 'string' || typeof r.id === 'string') && (typeof r.shown === 'string' || typeof r.evidenceId === 'string') && typeof r.why === 'string' && r.why.trim()).map((r) => ({ what: String(r.what || '').trim(), id: r.id, shown: r.shown, evidenceId:r.evidenceId, why: r.why.trim() }));
    return { issues, resolved, ...(Array.isArray(parsed.scene)?{scene:parsed.scene}:{}), ...(parsed.review && typeof parsed.review==='object'?{review:parsed.review}:{}), ...(Array.isArray(parsed.standings)?{standings:parsed.standings}:{}), checks: Array.isArray(parsed.checks) ? parsed.checks.filter(c => c && typeof c.id === 'string') : [], note: 'ok' };
  } catch (err) {
    return { issues: [], note: 'unusable' };
  }
}

/* M708: the one completion turn completes the SAME review; its prompt keeps "the sources and decisions already in this
 * conversation". Decisions the completed reply gave stay part of the review unless the completion restates them (the same
 * finding, issue, profile, identity, check or scene person); a completion that only adds the missing verdict cannot drop
 * them, and an unusable completion leaves the completed reply as the answer. Exported for the harness. */
export function completedAuditorReply(first, completion, { fieldOf = null } = {}) {
  const object = (text) => {
    const cleaned = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    for (const c of balancedCandidates(cleaned, 5)) {
      const p = parseLenient(c);
      if (p && (p.review || Array.isArray(p.issues) || Array.isArray(p.repairs) || Array.isArray(p.profiles) || Array.isArray(p.checks))) return p;
    }
    return null;
  };
  const a = object(first), b = object(completion);
  if (!a) return String(completion || '');
  if (!b) return JSON.stringify(a);
  /* M752: a field the completion writes (fieldOf: one person's one look) is its decision on that field, so the completed
   * reply's writes to that same field give way, in every form a reply writes one: issues and repairs, profiles' facts,
   * checks' physical facts. Two values for one field are what a completion is asked to settle (M708); kept beside its
   * choice, the contradiction outlived its own settlement and both values were written. */
  if (typeof fieldOf === 'function') {
    const settled = new Set(parseAuditorAnswer(JSON.stringify(b)).issues.flatMap((i) => i.mutations).map((m) => fieldOf(m)).filter(Boolean));
    const kept = (m) => !settled.has(fieldOf(m));
    if (settled.size) {
      for (const field of ['issues', 'repairs', 'resolved']) if (Array.isArray(a[field])) a[field] = a[field].flatMap((i) => {
        if (!Array.isArray(i?.mutations) || !i.mutations.length) return [i];
        const left = i.mutations.filter((m) => !m || typeof m !== 'object' || kept(m));
        return left.length ? [{ ...i, mutations: left }] : [];
      });
      if (Array.isArray(a.profiles)) a.profiles = a.profiles.map((p) => Array.isArray(p?.facts)
        ? { ...p, facts: p.facts.filter((f) => kept({ type: 'canon.lock', name: p.name, key: f?.key })) } : p);
      if (Array.isArray(a.checks)) a.checks = a.checks.map((c) => Array.isArray(c?.physicalFacts) && typeof c.id === 'string' && c.id.startsWith('characters:')
        ? { ...c, physicalFacts: c.physicalFacts.filter((f) => kept({ type: 'canon.lock', name: c.id.slice(11), key: f?.key })) } : c);
    }
  }
  const merged = { ...a, ...b };
  const keys = { issues: (i) => i?.findingId || i?.id || String(i?.what || '').trim(), repairs: (r) => r?.id, resolved: (r) => r?.id || String(r?.what || '').trim(),
    profiles: (p) => p?.name, identities: (p) => JSON.stringify([p?.sourceId, p?.name]), checks: (c) => c?.id, scene: (s) => s?.name };
  for (const [field, key] of Object.entries(keys)) {
    const later = Array.isArray(b[field]) ? b[field] : [];
    const restated = new Set(later.map(key));
    const kept = (Array.isArray(a[field]) ? a[field] : []).filter((x) => !restated.has(key(x)));
    if (kept.length || later.length) merged[field] = [...kept, ...later];
  }
  return JSON.stringify(merged);
}

// M710: the auditor's own ending read is usable work, not another certificate.
// Compare its actual final values and route corrections through normal writes.
// Older issues/checks-only providers remain compatible; no new approval gate.
export function reconcileAuditScene(read,state) {
  const byName=new Map();
  const same=(a,b)=>String(a || '').trim().replace(/\s+/g,' ').toLowerCase()===String(b || '').trim().replace(/\s+/g,' ').toLowerCase();
  for (const entry of read.scene || []) {
    if (!entry || typeof entry.name!=='string') continue;
    const name=isMc(state,entry.name)?mcName(state):entry.name;
    const index=findPresent(state,name,{strict:true});
    if (index<0) continue; // Arrivals/departures retain their explicit operations.
    const current=state.present[index];
    const end=sceneEndingFields(entry);
    const fields=Object.fromEntries(['position','attire'].filter(f=>end[f]).map(f=>[f,end[f]]));
    if (!Object.keys(fields).length) continue;
    const previous=byName.get(current.name);
    // M712: the final auditor judges equivalence. A correct scene reading is
    // scratchbook work, not a repair merely because its wording differs.
    // Omitted flags retain compatibility with earlier direct-write replies.
    // A confirmed ending still outranks a contradicting update for that person.
    const repair=entry.repair!==false;
    if (previous?.repair && !repair) continue;
    byName.set(current.name,{name:current.name,fields:{...(previous?.repair===repair?previous.fields:{}),...fields},repair,
      shown:end.shown,evidenceId:end.evidenceId,current});
  }
  const decisions=[...byName.values()];
  const issues=(read.issues || []).map(issue=>({...issue,mutations:(issue.mutations || []).map(m=>{
    if (m.type!=='presence.update') return m;
    const ending=decisions.find(d=>samePersonName(d.name,m.name) || (isMc(state,d.name) && isMc(state,m.name)));
    if (!ending) return m;
    const kept={...m};
    // An update agreeing with a confirmed (repair:false) ending is still the reviewer's own write.
    for (const [f,v] of Object.entries(ending.fields)) if (ending.repair || !same(kept[f],v)) delete kept[f];
    return kept;
  }).filter(m=>m.type!=='presence.update' || m.position!==undefined || m.attire!==undefined)}))
    /* only a finding this ending read emptied goes; one that never carried a change is still a finding (M685: kept until settled) */
    .filter((i,at)=>i.mutations.length || i.pages || !(read.issues[at].mutations || []).length);
  for (const d of decisions) {
    if (!d.repair) continue;
    const changed=Object.fromEntries(Object.entries(d.fields).filter(([f,v])=>!same(d.current[f],v)));
    if (!Object.keys(changed).length) continue;
    issues.push({what:'The completed scene puts '+d.name+' in a different physical state than their saved presence.',
      fix:'Keep their final established position and attire.',targets:[{id:'presence:'+d.name}],
      mutations:[{type:'presence.update',name:d.name,...changed,shown:d.shown,...(d.evidenceId?{evidenceId:d.evidenceId}:{})}]});
  }
  return {...read,issues};
}

/* The contract. */
/* M110: the pages up to the last STORY page — a trailing writer's page is an attempt, not a fact. M752: one cut for the
 * auditor and every check of its saved verification (auditprogress.js answeredPages) */
export function answeredOnly(list) {
  return answeredPages(list);
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
export function auditView(list, foldedTo, budget = AUDIT_VIEW_CHARS, checkpointStart=0) {
  const all = Array.isArray(list) ? list : [];
  const shown = [];
  const index = [];
  if (!all.length) return { shown, index };
  const from = Number.isFinite(foldedTo) ? foldedTo : 0;
  const start = Math.max(checkpointStart,0, Math.min(from, all.length - AUDIT_PAGES));
  /* no room left means the present page alone — never "no limit" */
  let left = Number.isFinite(budget) ? Math.max(0, budget) : Infinity;
  let full = true;
  let latestStory = true;
  for (let i = all.length - 1; i >= start; i -= 1) {
    const m = all[i];
    const text = pageText(m) + ((m.voices || []).length ? '\nWORLD VOICES AFTER THIS PAGE, offscreen reports rather than main-scene presence:\n' + m.voices.map(v => v.speaker + ': ' + v.content).join('\n') : '');
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

/* M752: SOURCE READINGS A STALE OR STOPPED AUDIT PAID FOR ARE KEPT FOR THE STORY'S NEXT READING. A send mid-scan made the
 * repair loop's reading stale and every batch it had read was thrown away; the scan began again from the first page.
 * They are held here, never written while the reading is stale (a rewind may be writing the ledger at that moment):
 * the next audit reuses each one whose section still has the exact text it was read at (mark, and every quotation,
 * checked again by reviewAuditSources), and its own commit saves them. */
const heldReadings = new Map(); /* storyId -> { sectionId: receipt } */
function holdReadings(storyId, review) {
  if (!review?.fresh?.size) return;
  const held = { ...(heldReadings.get(storyId) || {}) };
  for (const id of review.fresh) if (review.cache[id]) held[id] = review.cache[id];
  heldReadings.set(storyId, held);
}
/* M752: THE SOURCE CACHE IS LAID ONTO THE RECEIPTS AS THEY STAND NOW, never over them. A section read in this run takes its
 * new receipt; a reused one that a journaled write changed while the audit read (his take-back of a source decision
 * from the drawer, an entity correction) keeps that change. The commit wrote every receipt back as it stood at the
 * start: the take-back's log said "taken back" while the decision it took back stood again, approved. */
function currentSourceCache(review, saved, atStart) {
  const out = {};
  for (const [id, receipt] of Object.entries(review.cache)) {
    const now = saved?.[id];
    out[id] = !review.fresh?.has(id) && now?.mark === receipt.mark && atStart.has(id) && JSON.stringify(now) !== atStart.get(id) ? now : receipt;
  }
  return out;
}
function withHeldReadings(storyId, saved, documents) {
  const held = heldReadings.get(storyId);
  const out = { ...(saved || {}) };
  if (held) for (const d of documents) if (held[d.id]?.mark === d.mark && out[d.id]?.mark !== d.mark) out[d.id] = held[d.id];
  return out;
}

export async function auditLedger({ connection, storyId, brief = '', castNotes = '', castNames = [], signal, stale, renew, canonRecord = '', reviewSources = '' } = {}) {
  if (!connection || typeof connection !== 'object' || !storyId) return null;
  /* M752: THE HOUSE'S UPKEEP RUNS ON THE PAGES THE AUDITOR READS TOO (M57 retirement, M95 the house's example names, M103
   * seats, M304 the wake, M320 one seat each). M709 took it out of the verdict's commit, and the chain runs it alone
   * (upkeepOnly) only on a page the auditor does NOT read — so with the auditor reading every page it never ran. It
   * runs first, as its own journaled write with its take-back, so the reading and its verdict see the ledger as kept. */
  try { await ledgerUpkeep({ storyId, brief, castNotes, castNames, stale }); } catch (err) { /* the next reading keeps it */ }
  let state = await loadState(storyId);
  const receiptsAtStart = new Map(Object.entries(state.auditSources || {}).map(([id, receipt]) => [id, JSON.stringify(receipt)])); /* M752 */
  const storyAtStart = await db.stories.get(storyId);
  /* M752: every key this reading saves names the brief and cast notes it READ (its documents), not the story row: the
   * chain hands the auditor the brief its page was sent with, and a brief he saved meanwhile was marked verified unread
   * (and the audit that followed his save was then "retained" with no review at all). */
  const readStory = { brief, castNotes };
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
  const personaRepairs = sourcePersonaMutations(state, documents.filter(d => /^(?:brief|cast|page):/.test(d.id)).map(d => ({text:d.text,narrative:d.label.endsWith(', story')})));
  const personaIssues = personaRepairs.map(m => ({what:m.name+' is an explicitly established own persona of the main character, not a separate absent person.',mutations:[m]}));
  // Preview for every reader, commit through the same source/stale-checked
  // final transaction. This prevents another NPC profile for the same player.
  if (personaRepairs.length) state = applyMutations(state,personaRepairs).state;
  const sourceReview = reviewSources ? await reviewAuditSources({ connection, documents, previous: withHeldReadings(storyId, state.auditSources, documents), state, mode: reviewSources, signal, stale, renew }) : null;
  /* M752: a reading that moved writes nothing; what its source review paid for is held for the next one */
  const abandon = () => { holdReadings(storyId, sourceReview); auditAborted(signal); return null; };
  if (sourceReview?.interrupted || signal?.aborted || stale?.()) return abandon();
  if (sourceReview) state = {...state,auditSources:sourceReview.cache};
  /* M259: EVERY PAGE THE RECORD HAS NOT FOLDED, and the WHOLE record. It read
   * the last ten pages and a record trimmed to the storyteller's 30,000
   * characters — so with a window of twenty or thirty pages, the pages
   * between the record's end and the last ten were read by NOBODY, and a
   * long tale's oldest lines fell off the front. The room is the
   * connection's own. */
  // Size the answer for this ledger instead of forcing 32 entries per run.
  const replyTokens = Math.max(MAX_TOKENS, Math.min(16000, 3000 + (state.audit?.unresolved?.length || 0)*180));
  const room = roomChars(connection, replyTokens);
  const record = recordWithPages(mem, Math.max(20000, Math.min(AUDIT_RECORD_CAP, Math.floor(room * 0.35))));
  const foldedTo = Math.max(0, ...((mem && Array.isArray(mem.nodes)) ? mem.nodes : []).filter((n) => n && Array.isArray(n.span)).map((n) => n.span[1] + 1));
  /* M681 (S13): the board no reader stated for the newest page is the auditor's to restate (boardStale) */
  const toldNow = all.filter((m) => m && m.role === 'assistant');
  const lastTold = [...toldNow].reverse().find((m) => m && !m.ooc);
  const checkpointStart=auditCheckpointStart(state,readStory,documents,all,lastTold);
  const staleBoard = boardStale(state, lastTold ? toldNow.indexOf(lastTold) : null);
  const sourcePeople = sourceReview?.people || documents.flatMap(d => (state.auditSources?.[d.id]?.people || []).map(p => ({...p,source:d.id,label:d.label})));
  const restoredForReading = missingSourcePeople(state, sourcePeople);
  // Recover only a uniquely source-bound legacy complaint. Similar labels on
  // other pages do not establish that two people are the same individual.
  state = {...state,audit:{...state.audit,unresolved:restoreSourceFactFindings(state.audit?.unresolved || [],state,documents)}};
  const checkpoint=reusableAuditCheckpoint(state,readStory,documents);
  const profileIndex = peopleSourceIndex(state, documents, sourcePeople).filter(p=>!checkpoint.entries['characters:'+sourcePersonKey(state,p.name)]);
  if (mcName(state) !== 'the player' && !checkpoint.entries['characters:'+mcName(state)]) profileIndex.push({name:mcName(state),writerOnly:true,
    aliases:mcAliases(state).filter(n => !['you','player','the player'].includes(n)),
    sources:documents.filter(d => /^(?:brief|cast):/.test(d.id) || d.label.endsWith(', writer')).map(d => ({id:d.id,label:d.label}))});
  let readingState = state;
  if (state.audit?.unresolved?.length) {
    const unresolved = compactFindings(state.audit.unresolved, readingState).filter((i) => !(i.mutations?.length && i.mutations.every((m) => mutationSatisfied(readingState, m))));
    const oldWords = state.audit.unresolved.map((i) => i.what);
    const status = (state.audit.pending || []).filter((p) => !oldWords.some((what) => pendingOf(p, what)));
    readingState = { ...readingState, audit: { ...readingState.audit, unresolved, pending: [...status, ...unresolved.map((i) => pendingLine(i.what, i.pendingReason))] } };
  }
  const bare = buildAuditorMessages({ state: readingState, brief, castNotes, record, pages: [], pageCount: all.length, room, canonRecord, staleBoard }); /* M287: the audit's own room */
  const profileLookup = '\nPEOPLE SOURCE INDEX. For every People record compare identity and lasting appearance with these original pages. Fetch missing details; a short core is incomplete only when the originals establish additional missing identity facts. Page N labels are fetchable by N, and brief/cast by their names:\n' + JSON.stringify(profileIndex)
    + '\nPROFILE RECOVERY IS REQUIRED EVEN WHILE REPAIRING OLD FINDINGS. Inspect descriptive original passages across the whole index, not only the first occurrence. Recover established title/rank, family, personality and enduring preferences into core, preserving valid existing traits. Recover lasting hair/eyes/build/scars into canon, even when hair was previously misplaced in Scene attire. Return profiles:[{name,core:{text:"complete enriched identity",evidenceId or shown},state:{text:"correct current now, only if stale",evidenceId or shown},facts:[{key,value,evidenceId or shown}]}] for incomplete records. The app writes these supported fields directly. Omit unchanged fields. Do not merely describe the problem without supplying the repair. If an identity needs several passages, include one exact combined-source quote in shown only when contiguous; otherwise put evidenceId on each supported factual mutation in issues. Never invent a rank or trait.';
  const evidenceBudget = Math.max(2000, Math.min(48000, room * 0.15));
  /* M752: the entries the final review checks are sent lean (leanCheckRows) and never crowd the pages out: they are held
   * at most half of what this reading has left once its other parts are counted; an entry that does not fit waits for
   * the next reading (below), never approved unread. Every row sent whole, beside the whole of a long tale's ledger,
   * outgrew the connection: the transport refused the request before it left and the review "did not finish", for ever. */
  const readingLeft = viewBudget(connection, replyTokens, bare.system.length + bare.user.length + profileLookup.length + evidenceBudget + pageText(lastTold).length);
  const rowsReserve = Math.min(JSON.stringify(leanCheckRows(ledgerVerificationRows(state), bare.user + profileLookup)).length, Math.max(0, Math.floor(readingLeft / 2)));
  const view = auditView(all, Math.max(foldedTo,checkpointStart), Math.min(AUDIT_VIEW_CHARS, readingLeft - rowsReserve),checkpointStart);
  if (!view.shown.length) return null;
  const repairTargets = [...(readingState.audit?.unresolved || []), ...restoredForReading];
  const verificationSource = ledgerRepairInputKey({}, readStory, visiblePages(all));
  const sameReviewedSources = state.audit?.verification?.source === verificationSource || matchingAuditSourceCheckpoint(state,readStory,documents,visiblePages(all));
  /* M752 (followup 22): an unchanged entry the new pages do not name keeps its approval over pages only added
   * (auditprogress.js carriedApprovals) — it was asked again on every page */
  const previousVerification = {...(sameReviewedSources ? {} : carriedApprovals(state,documents)),...checkpoint.entries,...(sameReviewedSources
    ? Object.fromEntries(ledgerVerificationRows(state).filter(row => verificationReceiptMatches(state.audit?.verification?.entries?.[row.id],row))
      .map(row => [row.id,state.audit.verification.entries[row.id]])) : {})};
  const profileTargets = profileIndex.map(p => ({profileReview:true,writerOnly:p.writerOnly,what:'Stable identity and lasting appearance for '+p.name,mutations:p.aliases.map(name => ({name}))}));
  const repairEvidence = auditRepairEvidence([...repairTargets,...profileTargets], documents, evidenceBudget);
  const inventoryEvidence=[...sourceAppearanceFacts(state,documents),...sourceIdentityFacts(state,documents)].map(f=>({evidenceId:f.id,source:f.source,text:f.shown}));
  let evidenceBook=auditEvidenceBook(documents,[...repairEvidence,...inventoryEvidence],state.audit?.evidenceBook,state.journal);
  const registeredEvidence=()=>auditEvidencePassages(documents,evidenceBook);
  const evidenceInstructions = 'SOURCE REFERENCES: select an evidenceId from the original source passages on each mutation and each correct/repair decision. The app supplies that exact passage; do not rewrite it into shown. An unknown id is rejected. For a needed source not listed, fetch it and copy a literal quote as before. A reference proves provenance, not meaning: choose evidence that supports the actual field or identity, read later events, and keep World reports outside the local scene unless an arrival is established.';
  // One combined semantic review. Discovery, repairs and source mappings are
  // returned together, never another fresh full audit of a provisional answer.
  const looked=[];
  let raw='';
  const read={issues:[],resolved:[],note:'ok'};
  let answerProblem='';
  const standingsSource=fingerprint36(JSON.stringify([brief,castNotes,mcName(state)]));
  const standingsCached=state.audit?.statedStandings?.source===standingsSource;
  let statedByModel=standingsCached?state.audit.statedStandings.rows:null;
  const fresh = await loadState(storyId);
  let offered = [...personaIssues,...read.issues];
  const judge = (snapshot, proposals) => judgeAudit({ fresh: snapshot, offered: proposals, all, brief, castNotes, castNames, statedByModel, authoritative:true });
  let result = judge(sourceReview ? {...fresh,auditSources:currentSourceCache(sourceReview,fresh.auditSources,receiptsAtStart)} : fresh, offered);
  // A quoted name is a candidate, not a saved person. The final reader
  // classifies it first; its completed verdict also covers actual new rows
  // created by approved repairs in this same answer.
  const unresolved = (r) => [...r.issues.filter((i) => i.refused?.length || (!i.landed && !(i.pages && i.fix))).map((i) => i.what + (i.refused?.length ? ': ' + i.refused.join('; ') : ': no repair was supplied'))];
  const originalFindings = compactFindings([...(readingState.audit?.unresolved || []), ...restoredForReading, ...unresolvedFindings(result)], result.out);
  const withdrawals = [...(read.resolved || [])];
  let pending = [...unresolved(result), ...(answerProblem ? [answerProblem] : []), ...originalFindings.filter((i) => !findingSettled(i, result, withdrawals, documents)).map((i) => i.what)];
  let followupFailed = false;
  let verificationChecks = [];
  let verificationSnapshot = null;
  let deferredRows = []; /* M752: required entries left for the next reading, open, never approved unread */
  const reviewedSourceFacts = new Map();
  const openSourceFacts = new Map();
  let finalReview = {status:'not completed',requested:0,received:0,replyCharacters:0};
  // Source receipt repair does not require another completed ledger review
  // when its originals and every actual entry still match the saved verdict.
  const retainedReview = sameReviewedSources && state.audit?.finalReview?.status === 'ok'
    && !personaIssues.length && !originalFindings.some(i=>!findingSettled(i,result,withdrawals,documents,{entries:previousVerification})) && !unresolved(result).length
    && !auditReviewRows(result.out,previousVerification).length;
  if (retainedReview) {
    verificationSnapshot = result.out;
    finalReview = {...state.audit.finalReview,requested:0,received:0,calls:0,fetches:0,
      sourceCalls:sourceReview?.calls || 0,retained:true};
  }
  // An empty findings list without a valid saved verdict is not a review.
  if (!stale?.() && !retainedReview) {
    renew?.();
    const follow = buildAuditorMessages({ state: result.out, brief, castNotes, record, pages: view.shown, index: view.index, pageCount: all.length, room, canonRecord, staleBoard });
    verificationSnapshot = result.out;
    const outstandingRows = auditReviewRows(result.out,previousVerification);
    const requestedState=result.out;
    const sourceCandidateMap=new Map();
    for (const issue of originalFindings.filter(i=>i.profileRecovery && i.sourceId && !findingSettled(i,result,withdrawals,documents))) {
      sourceCandidateMap.set(JSON.stringify([issue.sourceId,issue.sourceName || issue.name,Boolean(issue.sourceFacts)]),issue);
    }
    const sourceCandidates=[...sourceCandidateMap.values()];
    const sourceTasks=sourceCandidates.map(i=>({id:auditFindingId(i),sourceId:i.sourceId,name:i.sourceName || i.name,shown:i.shown,
      ...(i.sourceFacts?{sourceFacts:true,facts:i.facts,currentEntries:findingRows(i,result.out),originalPassage:documents.find(d=>d.id===i.sourceId)?.text}:{}),
      speakerIdentity:documents.find(d=>d.id===i.sourceId)?.speakerIdentity}));
    /* M752: THE REQUIRED ENTRIES FIT THE READING, HONESTLY. Each is sent lean (a text the request shows word for word
     * already is marked, not sent twice) and as many as the transport will take beside everything else, leaving the room
     * to look (LOOK_RESERVE); the rest wait for the next reading, open and never approved (verifyLedgerChecks below). */
    const reviewSystem=follow.system+'\nINDEPENDENT FACTUAL REVIEW. Explicit writer facts and manual decisions govern; original evidence is read chronologically, including valid later developments. Preserve durable facts and legitimate worker judgments. You are the final independent consistency reviewer, not an authority over story meaning. Unknown optional biography is not a defect. Judge story meaning and profile completeness yourself using originals. Your explicit completed verdict is the approval. Do not echo a certificate for each source fact or repeat identity/appearance mappings. The FINAL REVIEW CONTRACT below replaces older per-entry output examples. Source IDs and quotations are useful optional provenance, never a second semantic approval. Preserve manual fields, valid worker judgments, earned scores, established identities and every valid alternate face.';
    const beforeRows=follow.user + profileLookup
      + '\nFINAL REVIEW CONTRACT. Review ALL required entries together and their resulting repairs, then return JSON: {"scene":[{"name":"actual person","repair":false,"earlier":"optional completed movement","ending":{"position":"current place and pose","shown":"short original evidence"}}],"issues":[],"review":{"status":"complete","why":"brief verdict explaining actual review","open":[]},"standings":[]}. Derive scene FIRST from the completed narration: include the main character and people whose physical state this page establishes or changes. Put ONLY their final current position and attire in ending. Earlier movement may be recorded in earlier; its original past-tense quotation belongs in ending.shown. Never append an arrival fact to a superseded movement or copy a scene summary into position. A final position may paraphrase the source faithfully. Keep factual history in the story and scratchbook, not in current pose. Unknown clothes are omitted. It is your working ending read, not a second approval certificate. After deriving ending, YOU judge whether the actual saved physical state is wrong or missing a relevant established fact. Mark repair:true only for that factual correction; the app writes it even when issues is empty. Mark repair:false for an already-correct or equivalent state, keeping the ending read in the scratchbook without rewriting the ledger. Changed wording, reordered clothing, shorter descriptions and optional extra narrative detail are not discrepancies. Preserve valid specific details such as a seat count. Correct contradictory movement, not prose style. Quotations may be in ending.shown or the scene entry shown. Use ordinary issue mutations for arrivals, departures, bodies, factual People now corrections and other fields. Issues contain only real discrepancies with working mutations or page concerns. Complete means you reviewed every required entry against originals, including all established identity and physical facts, and the repairs you provide leave them correct. Never say complete if you did not finish. Put genuinely unresolved items in open:[{"id":"required entry id","why":"specific missing fact or evidence"}]. Use status:"open" if the entire reading is unfinished. You may supply detailed checks instead, but identityFacts inCore:true or an explicit complete profile verdict suffices; no second identity/appearance array is required.';
    const afterRows='\nRETAINED SCRATCHBOOK CHECKS, already approved for these unchanged values and sources:\n'+JSON.stringify(Object.keys(previousVerification))
      + '\nHISTORICAL FINDINGS WITH ACTUAL CURRENT RECORDS:\n'+JSON.stringify(auditRepairChecklist(originalFindings,result.out))
      + '\nREQUIRED SOURCE MENTION DECISIONS:\n'+JSON.stringify(sourceTasks)
      + '\nSOURCE FACT DECISIONS. For every sourceFacts task compare its original passage with the bound current People record. Complete approves equivalent wording without a cosmetic write. For a real omission supply additive people.note core or profiles preserving existing facts. Put the task id in review.open if its fact or binding remains uncertain. Completion covers these tasks as well as ledger entries.'
      + '\nSOURCE IDENTITY DECISION CONTRACT.\n'+SOURCE_IDENTITY_DECISION_GUIDANCE
      + '\nENGINE ELIGIBLE PERSON TARGETS for this saved snapshot, including actors and tracked people:\n'+JSON.stringify(sourceIdentityTargetChoices(result.out))
      + '\nFACTIONS ARE GROUP CONTEXT, not person targets:\n'+JSON.stringify(Object.keys(result.out.factions || {}))
      + '\nRECOVERED SOURCE FACTS. These are an extraction index, not authority over the original text. Read originals to resolve misread relations, ambiguous labels and alternate forms. A correct profile can express the same fact in different words. Retain every valid rank, family, personality, background and lasting appearance. Repair actual omissions, never rewrite a correct biography just to match this index. Correct partial hair fields without overwriting another face.'
      + '\nORIGINAL SOURCE REFERENCES:\n'+JSON.stringify(repairEvidence)
      + '\nEvidence IDs or exact shown quotes are optional provenance. If using an ID choose one actually supplied; source fact IDs in the required entries also refer to original quotes. Never invent an ID. If missing needed context, fetch its original page. An unavailable old ID does not mean the source page is missing.'
      + '\nCOMPLETE NEWEST MAIN STORY. Read each person through the ending; an opening header or earlier retreat cannot override a later stopping position:\n'+pageText(lastTold)
      + SCENE_ENDING_TASK
      + (standingsCached?'':'\nReturn standings:[{name,p,r,s}] ONLY for explicit starting digits in the writer brief/cast TOWARD '+mcName(state)+'. P warmth/trust, R romantic pull, S sexual charge. Omit unstated axes; [] when none. Preserve earned history and scores. This extraction is cached.')
      + '\nWhen historical findings are now satisfied or mistaken, their approved current entries close them. Do not reproduce resolved findings or perform cosmetic rewrites. Your completed verdict approves the actual resulting ledger, not merely the truth of its first sentence. Unknown details remain unknown. Return concise JSON.';
    const lean=leanCheckRows(outstandingRows,[follow.user,pageText(lastTold),...repairEvidence.map(e=>e.text)].join('\n'));
    const rowsWords=(carried,deferred)=>'\nIn the required checks a value that reads '+JSON.stringify(SHOWN_ABOVE)+' is that exact text as it stands above (the ledger, the character pages, the pages or the original references): read it there.'
      +(deferred?' This reading carries '+carried+' of the '+outstandingRows.length+' required entries: the ledger is larger than one reading, and the other '+deferred+' wait for the next one. Review and approve only those listed.':'')
      +'\nREQUIRED CURRENT LEDGER CHECKS:\n';
    // Measured as the transport refuses a request (call.js workerRoom: this very body and the answer room it carries), with
    // the explanation at its longest. The room to look stays free whenever the reading leaves it (a fetch round the
    // transport refuses loses the whole reading, every time); a connection too small for that carries what fits in the rest.
    const requestRoom=workerRoom(connection,{maxTokens:replyTokens,slack:0});
    const left=workerRoom(connection,{system:reviewSystem,user:beforeRows+rowsWords(outstandingRows.length,outstandingRows.length)+'[]'+afterRows,maxTokens:replyTokens});
    const reserved=left-Math.ceil(requestRoom*LOOK_RESERVE);
    let rowsRoom=reserved>0 ? reserved : left;
    const picked=new Set();
    lean.forEach((row,at)=>{const size=JSON.stringify(row).length+1; if (size<=rowsRoom) {picked.add(at);rowsRoom-=size;}});
    const verificationRows=outstandingRows.filter((row,at)=>picked.has(at));
    deferredRows=outstandingRows.filter((row,at)=>!picked.has(at));
    finalReview.requested = verificationRows.length;
    if (deferredRows.length) finalReview.deferred = deferredRows.length;
    const checksWords=rowsWords(verificationRows.length,deferredRows.length)+JSON.stringify(lean.filter((row,at)=>picked.has(at)));
    const reviewProblems=text=>{
      const read=parseAuditorAnswer(text);
      const problems=completeFinalAuditReply(read,[...verificationRows,...sourceTasks])?[]:[{why:'Return review:{status:"complete",why:"your completed verdict",open:[]} after reviewing all required entries and source mentions, or explicit entry checks. Use open for real unresolved facts.'}];
      // Finish omitted source decisions in THIS conversation, not another
      // audit loop. This checks that a decision was saved, not its semantics.
      if (read.note==='ok' && sourceCandidates.length) {
        const bound=bindFinalAuditEvidence(read,registeredEvidence(),verificationRows,documents);
        const proposed=judge(requestedState,bound.issues);
        const open=new Set((read.review?.open || []).map(o=>o.id));
        const missing=sourceCandidates.filter(i=>!i.sourceFacts && !open.has(auditFindingId(i)) && !findingSettled(i,proposed,bound.resolved,documents));
        if (missing.length) {
          const missingTasks=sourceTasks.filter(t=>missing.some(i=>auditFindingId(i)===t.id));
          const identityRejections=proposed.rejected.filter(r=>!r.same && r.mutation?.type==='source.resolve');
          problems.push({type:'source_identity',why:'A source identity operation did not save the requested disposition. The previous operation is evidence of a rejected attempt, not the required answer.',
            mentions:missingTasks.map(task=>({
              id:task.id,sourceId:task.sourceId,name:task.name,
              originalPassage:documents.find(d=>d.id===task.sourceId)?.text?.slice(0,1800) || '',
              rejectedOperations:identityRejections.filter(r=>r.mutation.sourceId===task.sourceId && r.mutation.name===task.name)
                .map(r=>({operation:r.mutation,engineReason:r.why})),
            })),
            engineEligibleTargets:sourceIdentityTargetChoices(proposed.out),
            availablePeople:Object.keys(proposed.out.characters || {}),
            groupsForContext:Object.keys(proposed.out.factions || {})});
        }
      }
      if (!standingsCached && !Array.isArray(read.standings)) problems.push({why:'Include standings:[] when no explicit starting digits are stated.'});
      // M708 (M752: restored; M709's one review had dropped it): one field, two values is finished in this conversation
      for (const writes of appearanceConflicts(requestedState,read.issues.flatMap(i=>i.mutations)))
        problems.push({profile:writes[0].name,key:writes[0].key,why:CONFLICT_ASK});
      return problems;
    };
    try {
      let completed=null;
      let reply;
      try {
      reply = await askWithFetch(connection, {
        system: reviewSystem,
        user: beforeRows + checksWords + afterRows,
        maxTokens: replyTokens, signal, renew, leash: leashFor,
        isAnswer:t=>reviewProblems(t).length===0,
        repairAnswer:(t,res)=>{
          const problems=reviewProblems(t);
          const identity=problems.some(p=>p.type==='source_identity')
            ? '\nSOURCE IDENTITY DECISION CONTRACT.\n'+SOURCE_IDENTITY_DECISION_GUIDANCE
              +'\nThe original passage, rejected operation and exact engine reason are supplied by sourceId and name above. engineEligibleTargets is the complete set currently recognized by source.resolve, including tracked actors; availablePeople lists People pages only. groupsForContext supplies faction context, never person targets. Correct only the affected source mentions, retain valid independent decisions, and do not retry a rejected target unless it is now an actual eligible individual. Do not infer scope from why.'
            : '';
          if (problems.length) completed={text:t,finishReason:res?.finishReason};
          return problems.length?'Complete the SAME review with the sources and decisions already in this conversation. Do not restart the audit. Correct these exact unfinished parts: '+JSON.stringify(problems)+identity+'. Return your completed review verdict plus any necessary repairs. Keep valid decisions and preserve every valid face. JSON only.':'';
        },
        source: { storyId, messages: allRaw, memory: mem, story: { brief, castNotes }, state: result.out }, room: Math.min(room, requestRoom), /* M752: what it fetches stays inside what the transport takes */
      });
      } catch (err) {
        // A failed completion turn keeps the reply it was completing; the review stays unfinished.
        if (!completed || signal?.aborted || stale?.()) throw err;
        reply={text:'',finishReason:'',calls:2,rounds:0,formatContinuation:true,completionFailed:true,
          error:String(err?.message || err || 'the provider did not answer').slice(0,300)}; /* M752: its reason travels with it */
      }
      // The completion completes the SAME review: the completed reply's decisions stay unless restated (M708).
      const finish=reply.completionFailed ? completed.finishReason : reply.finishReason;
      const answerText=!completed || completed.finishReason==='length' ? reply.text
        : reply.completionFailed ? completed.text : completedAuditorReply(completed.text,reply.text,{fieldOf:m=>appearanceField(requestedState,m)});
      looked.push(...(reply.looked || []));
      const currentInventoryEvidence=[...sourceAppearanceFacts(result.out,documents),...sourceIdentityFacts(result.out,documents)]
        .map(f=>({evidenceId:f.id,source:f.source,text:f.shown}));
      evidenceBook=auditEvidenceBook(documents,currentInventoryEvidence,evidenceBook);
      const corrected = bindHistoricalFindings(bindFinalAuditEvidence(reconcileAuditScene(parseAuditorAnswer(answerText),requestedState), registeredEvidence(), verificationRows,documents),originalFindings);
      finalReview = {...finalReview,status:finish === 'length' ? 'cut short' : reviewProblems(answerText).length?'incomplete decisions':corrected.note,
        received:finalAuditChecks(corrected,verificationRows).length,approval:corrected.review?'whole required ledger':'entry verdicts',replyCharacters:reply.text.length,finishReason:finish,
        calls:reply.calls || 1,fetches:reply.rounds || 0,formatContinuation:Boolean(reply.formatContinuation),sourceCalls:sourceReview?.calls || 0,
        ...(corrected.scene?{scene:{pageId:lastTold.id,people:corrected.scene}}:{})};
      if (reply.completionFailed) {followupFailed = 'its completion turn failed: ' + reply.error; finalReview = {...finalReview,error:reply.error};}
      if (corrected.note === 'ok' && finish !== 'length') {
        verificationChecks = finalAuditChecks(corrected,verificationRows);
        answerProblem = '';
        if (!standingsCached && Array.isArray(corrected.standings)) statedByModel=validateStatedStandings(corrected.standings,mcName(state));
        const unfinished=new Set(verificationChecks.filter(c=>c.status==='open').map(c=>c.id));
        // An open record holds its own writes; a merge writes both of its records (M697: an open merge is withheld).
        const openRecord=name=>Boolean(name) && unfinished.has('characters:'+(isMc(requestedState,name)?mcName(requestedState):(sourcePersonKey(requestedState,name) || name)));
        // An open verdict on the exact row a write targets holds that write back, whatever the row kind. The rows a
        // write targets are the verification rows its own application changes: the row model this verdict approves.
        const shownRows=unfinished.size?new Map(ledgerVerificationRows(requestedState).map(r=>[r.id,r.print])):null;
        const writesOpenRow=m=>{
          if (!shownRows) return false;
          const {state:after,applied}=applyMutations(requestedState,[{...m,source:'auditor',auditorApproved:true}]);
          if (!applied.length) return false;
          const rows=new Map(ledgerVerificationRows(after).map(r=>[r.id,r.print]));
          return [...new Set([...shownRows.keys(),...rows.keys()])].some(id=>unfinished.has(id) && shownRows.get(id)!==rows.get(id));
        };
        offered=[...personaIssues,...corrected.issues.map(i=>({...i,mutations:i.mutations.filter(m=>
          !(m.type==='people.rename'?[m.from,m.to]:[m.name]).some(openRecord) && !writesOpenRow(m))}))
          /* only a finding the held profiles emptied waits; one that never carried a change stays a finding (M685) */
          .filter((i,at)=>i.mutations.length || i.pages || !corrected.issues[at].mutations.length)];
        // The approval belongs to the snapshot actually shown, plus its own
        // approved repairs. Later writes cannot borrow this final verdict.
        result=judge(requestedState,offered);
        /* M752 (followup 21) — HIS (15 October 2026): "Isn't we already using send them back and if can't debate then it's
         * resolve?? … the groom is listed as an individual by the source reading in Page 122, story; confirm its identity or
         * correct its entity classification: identity or entity classification still needs a working repair". A role the
         * page never names, which the reader keeps open with its reason — or still leaves without a decision once this same
         * conversation has asked again — was owed for good: asked on every pass, holding the audit unfinished until two
         * passes that got nowhere paused it. Such a mention is now kept as a person of that page only (the reader's own
         * "person local to this source": no profile, name, alias or feeling is touched, the original stays its evidence),
         * with the reader's reason or the plain fact that it gave none. Journaled and undone like any source decision; a
         * later change to that page asks again. Only after a whole review — never one cut short or whose second turn failed. */
        const asideResolved=[...withdrawals,...(corrected.resolved || [])];
        const openWhy=new Map((corrected.review?.open || []).map(o=>[o.id,String(o.why || '').trim()]));
        const askedAgain=Boolean(completed) && !reply.completionFailed;
        /* Only a description ("the groom", "the under-steward's boy"), never a name: a named person left unsettled ("Tarn")
         * is someone the story goes on with, and stays owed with the engine's reason (M732) */
        const setAside=sourceCandidates.filter(i=>!i.sourceFacts && isDescriptorName(i.sourceName || i.name)
          && !findingSettled(i,result,asideResolved,documents) && (openWhy.get(auditFindingId(i)) || askedAgain));
        if (setAside.length) {
          offered=[...offered,...setAside.map(i=>{
            const said=openWhy.get(auditFindingId(i));
            const name=i.sourceName || i.name;
            const refused=(result.rejected || []).find(r=>!r.same && r.mutation?.type==='source.resolve' && r.mutation.sourceId===i.sourceId && r.mutation.name===name);
            const tried=refused ? 'The auditor’s answer for this mention'+(refused.mutation.to ? ' (that it is '+refused.mutation.to+')' : '')+' could not be saved — '+String(refused.why || 'refused').replace(/[.\s]+$/u,'')+' — even when asked again in the same review.' : '';
            return {what:'Keep '+name+' as a person of this page only',mutations:[{type:'source.resolve',sourceId:i.sourceId,name,kind:'person',scope:'local',
              cause:(said ? 'The auditor could not tie this mention to anyone the story has named: '+said.replace(/[.\s]+$/u,'')+'.'
                : tried || 'The auditor gave no decision for this mention, even when asked again in the same review.')
                +' Kept as a person of this page only; no one’s page, name or feelings were changed.'}]};
          })];
          result=judge(requestedState,offered);
        }
        if (corrected.review) {
          const before=new Map(ledgerVerificationRows(requestedState).map(r=>[r.id,r]));
          // An explicitly reviewed repair may affect a formerly retained row,
          // plus other rows' scene scope. Approve these exact resulting values
          // in this same review, without a second call just to echo them.
          verificationChecks=finalAuditChecks(corrected,[...verificationRows,...ledgerVerificationRows(result.out)
            .filter(r=>!verificationRows.some(old=>old.id===r.id) && !deferredRows.some(old=>old.id===r.id) && !verificationReceiptMatches(previousVerification[r.id],r))
            .map(r=>before.get(r.id) || r)]);
        }
        // The semantic decision approves the actual resulting profile. A
        // concurrent edit cannot borrow it when the saved state is reloaded.
        /* M756-002: an answer is a verdict whether or not it calls itself complete — its own open entries name what it wants
         * kept, and a review that never reaches "complete" used to leave these facts owed on every pass (a dead end). */
        if (corrected.review) for (const issue of sourceCandidates.filter(i=>i.sourceFacts)) {
          const open=(corrected.review.open || []).find(o=>o.id===auditFindingId(issue));
          /* M756-002 (his "Vanessa is exist… it's supposed not making mistake autonomous and self heal"): the mention is
           * found by the house's own name matching, never by an exact string — a source entry kept as "Vanessa Langley" and
           * a finding naming "Vanessa" found no mention, so no decision could be recorded and the finding was owed forever. */
          const mention=result.out.auditSources?.[issue.sourceId]?.people?.find(p=>p.name===(issue.sourceName || issue.name) || samePersonName(p.name, issue.sourceName || issue.name));
          /* M752 (followup 21): facts the reader keeps open, with its reason, are left as they stand — decided with that
           * reason (her page untouched), never owed on every pass until the automatic audit pauses (the same fault as a
           * description it cannot tie to anyone, above) */
          if (open && mention && !sourceIdentityNeeded(result.out,mention) && String(open.why || '').trim()) {
            reviewedSourceFacts.set(auditFindingId(issue),{scope:sourceFactScope(result.out,{...mention,source:issue.sourceId}),
              why:'Left as it stands — '+String(open.why).trim(),shown:mention.shown,sourceId:issue.sourceId});
            continue;
          }
          /* M756-002: an open entry with no reason is no verdict the house can act on — it named nothing to add and nothing
           * to leave, and owed on every pass it is a dead end that pauses the whole audit. It is decided here, in the
           * reviewer's own words for it, and the finding closes; a review that wants a fact kept open says why (the branch
           * above), and one that wants it written supplies the additive note. */
          if (open) {
            if (mention && !sourceIdentityNeeded(result.out,mention)) reviewedSourceFacts.set(auditFindingId(issue),{
              scope:sourceFactScope(result.out,{...mention,source:issue.sourceId}),
              why:'Left as it stands — the review kept it open without a reason',shown:mention.shown,sourceId:issue.sourceId});
            else openSourceFacts.set(auditFindingId(issue),open.why);
            continue;
          }
          if (mention && !sourceIdentityNeeded(result.out,mention)) reviewedSourceFacts.set(auditFindingId(issue),{
            scope:sourceFactScope(result.out,{...mention,source:issue.sourceId}),why:corrected.review.why,shown:mention.shown,sourceId:issue.sourceId});
        }
        withdrawals.push(...(corrected.resolved || []));
        raw += '\n\nCombined review:\n' + (completed ? completed.text + '\n\nCompletion:\n' : '') + reply.text;
      } else followupFailed = true;
    } catch (err) {
      if (signal?.aborted || stale?.()) return abandon();
      /* M752: the real reason travels with the unfinished review (a request the transport refused for its size said only
       * "did not finish", and nothing ever said why a long tale's ledger stayed amber) */
      followupFailed = String(err?.message || err || 'the provider did not answer').slice(0, 300);
      finalReview = {...finalReview,status:'failed',error:followupFailed};
    }
  }
  verificationChecks=restoreProfileReconciliation(result.out,verificationChecks,
    {...checkpoint.profiles,...(sameReviewedSources?state.audit?.verification?.profiles || {}:{})});
  if (signal?.aborted || stale?.()) return abandon();
  // No result based on replaced, hidden or deleted source pages may land.
  const now = answeredOnly((await db.messages.list(storyId)).filter((m) => !m.hidden));
  const sourceMark = (docs) => docs.map((d) => d.id + ':' + d.mark).join('|');
  const storyNow = await db.stories.get(storyId);
  if ((storyAtStart && !storyNow) || String(storyNow?.brief || '') !== String(storyAtStart?.brief || '') || String(storyNow?.castNotes || '') !== String(storyAtStart?.castNotes || '')) return abandon();
  if (sourceMark(auditSources({ brief, castNotes, messages: now })) !== sourceMark(documents)) return abandon();
  // Re-read after all calls and preserve unrelated writes made while we waited.
  const approvedState = result.out;
  const finalState = await loadState(storyId);
  result = judge(sourceReview ? {...finalState,auditSources:currentSourceCache(sourceReview,finalState.auditSources,receiptsAtStart)} : finalState, offered);
  const openProfiles=new Map(originalFindings.filter(i=>openSourceFacts.has(auditFindingId(i)))
    .flatMap(i=>findingRows(i,result.out).map(row=>[row.id,openSourceFacts.get(auditFindingId(i))])));
  // M709: a complete approval does not certify a rejected mutation. Entries named by a finding of this answer whose
  // repair was refused stay open with the engine's reason, so neither this verdict nor a reused receipt closes it.
  for (const finding of unresolvedFindings(result).filter(f=>f.mutations.length)) for (const row of findingRows(finding,result.out))
    if (!openProfiles.has(row.id)) openProfiles.set(row.id,finding.pendingReason);
  const verification = verifyLedgerChecks({state:result.out, snapshot:verificationSnapshot,
    checks:[...verificationChecks.map(c=>openProfiles.has(c.id)?{...c,status:'open',why:openProfiles.get(c.id)}:c),
      ...deferredRows.filter(r=>!openProfiles.has(r.id)).map(r=>({id:r.id,print:r.print,scope:r.scope,status:'open',why:'not read yet: the ledger is larger than one reading, and this entry waits for the next'}))],
    previous:Object.fromEntries(Object.entries(previousVerification).filter(([id])=>!openProfiles.has(id))),
    documents, source:verificationSource, applied:result.applied,approvedState,authoritative:true});
  verification.sources=verificationSourcesOf(documents); /* M752 (followup 22): what these approvals were given */
  const sourceFactDecisions={...(result.out.audit?.sourceFactDecisions || {})};
  for (const issue of originalFindings.filter(i=>i.sourceFacts)) {
    const decision=withdrawals.find(r=>(r.what===issue.what || r.id===auditFindingId(issue)) && documents.some(d=>d.id===issue.sourceId && auditorSourceQuote(d.text,r.shown)));
    const mention=result.out.auditSources?.[issue.sourceId]?.people?.find(p=>p.name===(issue.sourceName || issue.name));
    const reviewed=reviewedSourceFacts.get(auditFindingId(issue));
    const scope=mention && sourceFactScope(result.out,{...mention,source:issue.sourceId});
    const currentSource=documents.some(d=>d.id===issue.sourceId && d.mark===result.out.auditSources?.[issue.sourceId]?.mark);
    const approvedMention=approvedState.auditSources?.[issue.sourceId]?.people?.find(p=>p.name===(issue.sourceName || issue.name));
    const approvedScope=approvedMention && sourceFactScope(approvedState,{...approvedMention,source:issue.sourceId});
    if (!openSourceFacts.has(auditFindingId(issue)) && mention && currentSource && !sourceIdentityNeeded(result.out,mention) && (reviewed?.scope===scope || (decision && scope===approvedScope) || findingSettled(issue,result,withdrawals,documents,verification))) {
      sourceFactDecisions[scope]=reviewed?.scope===scope ? reviewed : decision
        ? {why:decision.why || decision.what,shown:decision.shown}
        : {why:'The actual People core and original source facts passed factual review.'};
    }
  }
  /* M752: KEPT WHILE THEY CAN BE READ. A source-fact decision is found by its scope, which names the section's current
   * mark and the person's current core: once the page is changed or gone, or the core rewritten, it is never read again
   * unless that exact text and core come back (and then the review is simply asked again). Neither map was ever pruned,
   * and the audit is copied whole into every checkpoint row. The identity history is read by nothing; a section gone
   * takes its entries with it. */
  const liveScopes=new Set(documents.flatMap(d=>(result.out.auditSources?.[d.id]?.people || []).map(p=>String(sourceFactScope(result.out,{...p,source:d.id})))));
  for (const scope of Object.keys(sourceFactDecisions)) if (!liveScopes.has(scope)) delete sourceFactDecisions[scope];
  const identityDispositionHistory=supersededSourceIdentityHistory(
    [...originalFindings,...unresolvedFindings(result)],result.out,result.out.audit?.identityDispositionHistory)
    .filter(entry=>documents.some(d=>d.id===entry.sourceId));
  result.out.audit={...result.out.audit,sourceFactDecisions,identityDispositionHistory};
  /* M756-004: NO DEAD ENDS. A source fact the review has been asked about twice and never decided — no note written, no
   * reason given, no answer at all — is set aside by the house, in a line that says so, and the finding closes. His light
   * could otherwise stay yellow for good over facts nobody had declined and nobody had added; the facts themselves stay
   * where they were read, in the original receipt of their page. */
  const sourceFactAsks = { ...(result.out.audit?.sourceFactAsks || {}) };
  for (const issue of originalFindings.filter(i => i.sourceFacts)) {
    const id = auditFindingId(issue);
    if (findingSettled(issue, result, withdrawals, documents, verification) || openSourceFacts.has(id) || reviewedSourceFacts.has(id)) { delete sourceFactAsks[id]; continue; }
    sourceFactAsks[id] = (sourceFactAsks[id] || 0) + 1;
    if (sourceFactAsks[id] < 2) continue;
    const mention = result.out.auditSources?.[issue.sourceId]?.people?.find(p => p.name === (issue.sourceName || issue.name) || samePersonName(p.name, issue.sourceName || issue.name));
    if (!mention || sourceIdentityNeeded(result.out, mention)) continue;
    const scope = sourceFactScope(result.out, { ...mention, source: issue.sourceId });
    if (!sourceFactDecisions[scope]) sourceFactDecisions[scope] = { why: 'Asked twice and never decided by the review — set aside; its facts stay in the original receipt of their page.' };
  }
  result.out.audit = { ...result.out.audit, sourceFactAsks };
  const outstanding = compactFindings([...originalFindings, ...missingSourcePeople(result.out,documents.flatMap(d=>(result.out.auditSources?.[d.id]?.people || []).map(p=>({...p,source:d.id,label:d.label})))), ...unresolvedFindings(result)].filter((i) => openSourceFacts.has(auditFindingId(i)) || !findingSettled(i, result, withdrawals, documents, verification)), result.out);
  /* M756-003: THE LIGHT SAYS WHY A FACT IS STILL OWED — his "where the fuck it said the context is too big???" The line
   * said only "source-supported profile facts still need reconciliation" for every one of them, so a review that never
   * answered, a review that kept the task open (with its reason) and a review that decided it and wrote it all read the
   * same. Each now names its own case, and the reason the review gave, when it gave one. */
  const sourceFactWhy = (issue, id) => {
    if (issue.pendingReason) return issue.pendingReason;
    const open = String(openSourceFacts.get(id) || '').trim();
    if (open) return 'kept open by the review: ' + open;
    if (reviewedSourceFacts.has(id)) return 'the review left it as it stands (no durable fact to add)';
    return 'no review answer for it — the review did not finish this pass';
  };
  pending = [...new Set([...outstanding.map((i) => pendingLine(i.what, i.sourceFacts ? sourceFactWhy(i, auditFindingId(i)) : (i.pendingReason || 'identity or entity classification still needs a working repair'))), ...(sourceReview?.pending || []), ...(answerProblem ? [answerProblem] : []), ...(followupFailed ? ['the combined ledger review did not finish' + (typeof followupFailed === 'string' ? ': ' + followupFailed : '')] : []), ...(verification.read < verification.total ? [`ledger verification: checked ${verification.read} of ${verification.total} entries; ${verification.pending.slice(0, 2).join('; ')}`] : [])])];
  result.unfinished = pending.length > 0;
  result.pending = pending;
  result.issues = result.issues.filter(i => i.mutations.length || i.pages || !findingSettled(i,result,withdrawals,documents,verification));
  result.out.audit = { ...result.out.audit, pausedInput: null, pauseReason: '', pending, unresolved: outstanding, unfinished: result.unfinished,
    verification,finalReview,evidenceBook,
    ...(Array.isArray(statedByModel)?{statedStandings:{source:standingsSource,rows:statedByModel}}:{}),checkpoint:saveAuditCheckpoint(result.out,readStory,documents,verification),
    ...(sourceReview ? { coverage: { read: sourceReview.read, total: sourceReview.total, failures: sourceReview.failures || [] } } : {}) };
  result.out.audit.verifiedInput = !result.unfinished && result.out.audit.coverage
    && result.out.audit.coverage.read >= result.out.audit.coverage.total
    ? ledgerRepairInputKey(result.out, readStory, visiblePages(now)) : null;
  await saveState(storyId, result.out);
  if (sourceReview) heldReadings.delete(storyId); /* M752: the held readings it could use are in its saved receipts now */
  notify(storyId);
  const { out, ...answer } = result;
  return { ...answer, raw, looked };
}

function repairKey(mutation) {
  const metadata = new Set(['cause', 'shown', 'evidence', 'evidenceId', 'evidenceError', 'source', 'auditReason']);
  return JSON.stringify(Object.fromEntries(Object.keys(mutation).filter((k) => !metadata.has(k)).sort().map((k) => [k, mutation[k]])));
}

function bindHistoricalFindings(read,findings) {
  return {...read,issues:read.issues.map(issue=>{
    const matches=findings.filter(old=>(issue.findingId && auditFindingId(old)===issue.findingId) || old.what===issue.what);
    return matches.length===1 ? {...matches[0],...issue,
      ...Object.fromEntries(['name','sourceId','sourceName','sourceFacts','profileRecovery','facts'].filter(k=>matches[0][k]!==undefined).map(k=>[k,matches[0][k]]))} : issue;
  })};
}

export function restoreSourceFactFindings(findings,state,documents) {
  const candidates=documents.flatMap(d=>d.mark===state.auditSources?.[d.id]?.mark
    ? (state.auditSources[d.id].people || []).flatMap(p=>{
      const key=sourcePersonKey(state,p.name,p.ledgerName,p.identityResolution);
      const facts=p.identityFacts || [];
      return key && facts.length ? [{what:key+' has source identity facts to reconcile: '+facts.map(f=>f.text).join('; '),
        name:key,sourceId:d.id,sourceName:p.name,sourceFacts:true,profileRecovery:true,shown:p.shown,facts,pages:false}] : [];
    }) : []);
  return findings.map(issue=>{
    if (issue.mutations?.length) return issue;
    if (issue.sourceId && state.auditSources?.[issue.sourceId]?.people?.some(p=>p.name===(issue.sourceName || issue.name))) return issue;
    const matches=candidates.filter(c=>c.what===issue.what && (!issue.sourceId || c.sourceId===issue.sourceId));
    return matches.length===1 ? {...issue,...matches[0]} : issue;
  });
}

function unresolvedFindings(result) {
  return result.issues.filter((i) => i.refused?.length || (!i.landed && !(i.pages && i.fix))).map((i) => ({
    what: i.what, fix: i.fix, pages:i.pages,
    ...Object.fromEntries(['name','sourceId','sourceName','sourceFacts','profileRecovery','shown','facts'].filter(k=>i[k]!==undefined).map(k=>[k,i[k]])),
    ...(i.findingId ? {id:i.findingId} : {}), ...(i.targets ? {targets:i.targets} : {}), pendingReason: i.refused?.join('; ') || 'no repair was supplied',
    mutations: result.rejected.filter((r) => i.mutations.includes(r.mutation) && !r.same && !r.standing).map((r) => r.mutation),
  }));
}
/* M752: a pending line says the finding and its reason once — "what: reason". A finding's what ends its sentence with a
 * stop ("Alexia Woman is the wrong name."), and joined as it was it read "…the wrong name.: reason" in the light and the
 * drawer. Lines saved before keep their form: matching a finding to its line reads both. */
export function pendingLine(what, reason) { return String(what || '').replace(/[.\s]+$/u, '') + ': ' + reason; }
export function pendingOf(line, what) {
  const bare = String(what || '').replace(/[.\s]+$/u, '');
  return line === what || line.startsWith(what + ':') || line.startsWith(bare + ':');
}
export function auditFindingId(issue) {
  return issue.id || issue.findingId || 'finding:' + fingerprint36(issue.profileRecovery && issue.sourceId
    ? JSON.stringify([issue.sourceId,issue.sourceName || issue.name,...(issue.sourceFacts?['facts',issue.facts?.map(f=>f.text)]:[])]) : String(issue.what || '').trim());
}
export function auditRepairChecklist(findings, state) {
  return findings.map(i => ({ id: auditFindingId(i), what: i.what, fix: i.fix,
    // The engine's reason an earlier repair did not land; the single combined review is its only way back (M708).
    ...(i.pendingReason ? {pendingReason:i.pendingReason} : {}),
    ...(i.sourceId?{sourceMention:{sourceId:i.sourceId,name:i.sourceName || i.name,shown:i.shown,
      current:state.auditSources?.[i.sourceId]?.people?.find(p=>p.name===(i.sourceName || i.name))}}:{}),
    currentEntries: findingRows(i,state),
    targets: (i.mutations || []).map(m => {
      /* M754: a loose end's page is the one the door closes it on (his own record for his names), and what the reviewer is
       * shown of it is the loose ends written there — the person's "unthread", which no page has, was shown before: never
       * the loose end, so never that it had already been closed */
      const loose = m.type === 'people.note' && /^(?:un)?thread$/i.test(String(m.field || '').trim());
      const pagesOf = loose ? looseEndPages(state, state.characters || {}, m.name) : [];
      const name = pagesOf[0] || findPersonKey(state.characters || {}, m.name || m.from) || m.name || m.from;
      const at = name ? findPresent(state, name, { strict: true }) : -1;
      const {shown,evidence,evidenceId,evidenceError,...proposed} = m;
      const field = loose ? 'threads' : m.field;
      return { proposed, canonicalName: name, current: {
        presence: at < 0 ? null : state.present[at],
        elsewhere: seatForPerson(state, name)?.entry || null,
        ...(m.type.startsWith('people.') ? { person: state.characters?.[name] ? {
          core:state.characters[name].core, aliases:state.characters[name].aliases,
          ...(field && field !== 'core' ? {[field]:loose ? state.characters[name].threads || [] : state.characters[name][field]} : {}),
          ...(pagesOf.length > 1 ? { looseEndsOnTheirOtherPages: Object.fromEntries(pagesOf.slice(1).map((k) => [k, state.characters[k].threads || []])) } : {}),
          manualFields:Object.keys(state.characters[name].hand || {}),
        } : null } : {}),
      } };
    }),
  }));
}

// Retrieve actual source spans proactively when a previous summary quote failed.
// Ranking locates passages; it never validates their meaning or writes a fact.
export function auditRepairEvidence(findings, documents, budget = 18000) {
  const selected = new Map(); let remaining = budget;
  const add = (d,index,start,size) => {
    const text = d.text.slice(start,start+size);
    const evidenceId = 'source:' + fingerprint36(d.id + ':' + start + ':' + text);
    if (selected.has(evidenceId) || remaining < text.length+150) return;
    selected.set(evidenceId,{index,evidenceId,source:d.id,label:d.label,text,excerpt:start>0 || start+size<d.text.length});
    remaining -= text.length+150;
  };
  // Always make the latest main-story ending selectable, including pronoun moves.
  const newest = [...documents].reverse().find(d => d.id.startsWith('page:') && d.label.endsWith(', story'));
  if (newest) {
    const index = documents.indexOf(newest);
    for (let at=0;at<newest.text.length && remaining>1200;at+=850) add(newest,index,at,1000);
  }
  // Every matching source and every occurrence is a retrieval candidate.
  // Earliest three mentions often contain an assignment, not the description.
  // Description cues rank retrieval only; the reader still judges ownership.
  const profiles = findings.filter(i => i.profileReview).map(issue => {
    const names = [...new Set((issue.mutations || []).map(m => m.name).filter(Boolean))];
    const candidates = new Map();
    for (const [index,d] of documents.entries()) {
      if (issue.writerOnly && !/^(?:brief|cast):/.test(d.id) && !d.label.endsWith(', writer')) continue;
      for (const name of names) {
        if (!exactNameIn(d.text,name)) continue;
        const lower = d.text.toLowerCase(), needle = name.toLowerCase();
        for (let at=lower.indexOf(needle);at>=0;at=lower.indexOf(needle,at+needle.length)) {
          const start = Math.max(0,at-350), size = Math.min(1600,d.text.length-start);
          const text = d.text.slice(start,start+size);
          const cues = text.match(/\b(?:hair|eyes|skin|height|build|scar|princess|prince|queen|king|captain|daughter|son|sister|brother|personality|temperament|cautious|craven|coward|bold|proud|shy|likes|loves|prefers|born|raised|family|background|nature|appearance|traits|identity)\b/gi) || [];
          const score = cues.length + (/^(brief|cast):/.test(d.id) || d.label.endsWith(', writer') ? 6 : 0);
          const key = d.id+':'+Math.floor(start/600);
          if (!candidates.has(key) || candidates.get(key).score < score) candidates.set(key,{d,index,start,size,score});
        }
      }
    }
    return [...candidates.values()].sort((a,b) => b.score-a.score || a.index-b.index);
  });
  // Reserve room for concrete repairs, then share profile space fairly instead
  // of allowing the first character to consume every original passage.
  const profileFloor = Math.min(remaining, Math.max(5000,remaining*0.25));
  // Offer at least one factual reference for every indexed person before
  // spending the bank on long descriptions of the first few characters.
  const fairSpan = Math.max(400,Math.min(1200,Math.floor((remaining-profileFloor)/Math.max(1,profiles.length))-150));
  for (const pool of profiles) {
    const candidate = pool[0];
    if (candidate && remaining>profileFloor+fairSpan+150) add(candidate.d,candidate.index,candidate.start,Math.min(candidate.size,fairSpan));
  }
  for (let round=0;profiles.some(pool => pool.length) && remaining>profileFloor+1700;round++) {
    for (const pool of profiles) {
      const candidate = pool.shift();
      if (candidate && remaining>profileFloor+1700) add(candidate.d,candidate.index,candidate.start,candidate.size);
    }
  }
  for (const issue of findings.filter(i => !i.profileReview)) {
    const mutations = issue.mutations || [];
    const names = [...mutations.flatMap(m => [m.name,m.from,m.to]),issue.name].filter(Boolean);
    const quotes = mutations.map(m => m.shown || m.evidence).filter(Boolean);
    const words = [...new Set(foldName(quotes.join(' ') || issue.what).split(' ').filter(w => w.length >= 5 && !['ledger','presence','entry','latest','pages','shows','proposed','source','quotation','person','their','people','already'].includes(w)))];
    const ranked = documents.map((d,index) => {
      const text = foldName(d.text);
      const score = names.filter(n => exactNameIn(d.text,n)).length * 20
        + quotes.filter(q => auditorSourceQuote(d.text,q)).length * 100
        + words.filter(w => (' '+text+' ').includes(' '+w+' ')).length;
      return {d,index,score};
    }).filter(r => r.score > 0).sort((a,b) => b.score-a.score || b.index-a.index).slice(0,3);
    for (const {d,index} of ranked) {
      if (remaining < 500) continue;
      const needle = [...quotes,...names,...words].find(n => d.text.toLowerCase().includes(n.toLowerCase()));
      const at = needle ? d.text.toLowerCase().indexOf(needle.toLowerCase()) : 0;
      const start = Math.max(0,at-250), size = Math.min(1000,remaining-150);
      add(d,index,start,size);
    }
  }
  return [...selected.values()].sort((a,b) => a.index-b.index).map(({index,...row}) => row);
}

export function completeAuditCheckReply(text,rows) {
  const read=parseAuditorAnswer(text);
  return read.note==='ok' && rows.every(row=>{
    const matches=read.checks.filter(c=>c.id===row.id);
    return matches.length===1 && ['correct','repair','open'].includes(matches[0].status) && matches[0].why?.trim();
  });
}

export function completeFinalAuditReply(read,rows) {
  if (read.note!=='ok') return false;
  if (read.review) return ['complete','open'].includes(read.review.status) && Boolean(read.review.why?.trim())
    && Array.isArray(read.review.open) && read.review.open.every(o=>o?.why?.trim() && rows.some(r=>r.id===o.id));
  return rows.every(r=>{
    const matches=(read.checks || []).filter(c=>c.id===r.id);
    return matches.length===1 && ['correct','repair','open'].includes(matches[0].status) && matches[0].why?.trim();
  });
}

export function finalAuditChecks(read,rows) {
  if (!read.review) return read.checks || [];
  const open=new Map((read.review.open || []).map(o=>[o.id,o]));
  return rows.map(r=>({id:r.id,print:r.print,scope:r.scope,finalReview:true,
    status:open.has(r.id) || read.review.status!=='complete'?'open':'correct',
    why:open.get(r.id)?.why || read.review.why}));
}

export function bindFinalAuditEvidence(read,passages,rows,documents) {
  const bound=bindAuditEvidence(read,passages,rows,documents);
  const trace=value=>{
    const {evidenceError,...clean}=value;
    const supplied=passages.find(p=>p.evidenceId===value.evidenceId);
    const refs=supplied?[supplied.source]:documents.filter(d=>/^(?:brief|cast):/.test(d.id)
      || (value.shown && auditorSourceQuote(d.text,value.shown))).map(d=>d.id);
    return {...clean,sourceRefs:refs,...(evidenceError?{evidenceNote:'An old evidence id could not be resolved. The final auditor reviewed the supplied originals.'}:{})};
  };
  return {...bound,issues:bound.issues.map(i=>({...trace(i),mutations:i.mutations.map(trace)})),
    checks:bound.checks.map(c=>({...trace(c),
      ...(Array.isArray(c.physicalFacts)?{physicalFacts:c.physicalFacts.map(trace)}:{}),
      ...(Array.isArray(c.identityFacts)?{identityFacts:c.identityFacts.map(trace)}:{})}))};
}

function finalReviewSources(state,row,documents) {
  const refs=new Set([...(row.value?.appearanceSources || []).flatMap(f=>f.references || [f.source]),
    ...(row.value?.identitySources || []).map(f=>f.source)]);
  for (const [id,receipt] of Object.entries(state.auditSources || {})) if ((receipt.people || []).some(p=>
    samePersonName(p.ledgerName || p.name,row.name) || (isMc(state,row.name) && isMc(state,p.name)))) refs.add(id);
  for (const d of documents) if (/^(?:brief|cast):/.test(d.id)) refs.add(d.id);
  const latest=[...documents].reverse().find(d=>d.label.endsWith(', story'));
  if (latest) refs.add(latest.id);
  return [...refs];
}

export function auditCheckReplyReminder(text,rows) {
  if (completeAuditCheckReply(text,rows)) return '';
  return 'Your answer did not complete the required entry checks. This is a format continuation of the SAME review, not a new audit. Retain the supported repairs you just proposed and return one checks verdict for EVERY following id, with status correct, repair or open, why, and a supplied evidenceId or exact original shown quote. Do not return only issues/profiles or checks:[]. Do not invent old source references. For profile reconciliation also include each required appearance/identity decision. Required ids: '+JSON.stringify(rows.map(r=>r.id))+'. JSON only.';
}

// Check the model's proposed resulting profile in memory before saving it.
// This asks for a complete decision from the SAME auditor, never a second AI
// opinion or a sequence of alternate hair repairs across new audit runs.
/* M708: ONE FIELD, ONE VALUE. Two writes in one answer to one appearance field — one person under any form of the name
 * (the main character under his own, so one face of his persona is his), one look (lookKey: "hair", "hair colour") —
 * with different values are a contradiction, never two repairs: applied in turn, the second overwrote the first and the
 * field ended on whichever came last ("dark" then "blonde" committed blonde, and the verdict certified it). M709 made the
 * review one call and dropped this check with auditReviewProblems; restored (M752): the review is asked once, in the same
 * conversation, to choose; a contradiction still standing is written by neither, and its entry stays open (judgeAudit). */
export const CONFLICT_ASK = 'Conflicting writes for one appearance field. Choose one resulting value preserving all valid faces, or distinct persona fields.';
function appearanceOwner(state, m) {
  const name = String(m?.name || '');
  return isMc(state, name) ? mcName(state) : (sourcePersonKey(state, name) || name);
}
export function appearanceField(state, m) {
  if (!m || typeof m !== 'object' || !/^canon\./.test(String(m.type || ''))) return '';
  return JSON.stringify([appearanceOwner(state, m), lookKey(String(m.key || ''))]);
}
export function appearanceConflicts(state, mutations) {
  const fields = new Map();
  for (const m of mutations || []) {
    const field = appearanceField(state, m);
    if (!field) continue;
    if (!fields.has(field)) fields.set(field, { values: new Set(), writes: [] });
    fields.get(field).values.add(JSON.stringify([m.type, m.value]));
    fields.get(field).writes.push(m);
  }
  return [...fields.values()].filter((f) => f.values.size > 1).map((f) => f.writes);
}

export function auditReviewProblems({text,rows,state,documents,passages,preview}) {
  if (!completeAuditCheckReply(text,rows)) return [{why:'Return one verdict with a reason for every required entry.',ids:rows.map(r=>r.id)}];
  const read=bindAuditEvidence(parseAuditorAnswer(text),passages,rows,documents);
  const problems=[];
  for (const writes of appearanceConflicts(state,read.issues.flatMap(i=>i.mutations)))
    problems.push({profile:appearanceOwner(state,writes[0]),why:CONFLICT_ASK,key:writes[0].key});
  for (const c of read.checks) if (c.id.startsWith('characters:') && c.evidenceError && c.status!=='open')
    problems.push({profile:c.id.slice(11),why:c.evidenceError});
  for (const c of read.checks.filter(c=>c.id.startsWith('characters:') && c.status!=='open')) {
    for (const f of [...(c.physicalFacts || []),...(c.identityFacts || [])]) if (f.evidenceError)
      problems.push({profile:c.id.slice(11),why:f.evidenceError,field:f.key || f.text});
  }
  const proposed=preview(read.issues);
  for (const task of profileReconciliationTasks(proposed,read.checks,documents)) problems.push({profile:task.name,
    why:'Complete source mappings against the resulting saved profile in this answer.',appearance:task.appearance,identity:task.identity,
    savedFacts:task.physicalFacts,core:task.core});
  return problems;
}

/* M752: WHAT THE FINAL REVIEW IS SENT OF EACH REQUIRED ENTRY. Its id, section, name, fingerprints and value — but a long
 * text of the value that the request already shows word for word (the ledger, the character pages, the pages, the
 * original references) is marked instead of being sent a second time. Since M717 a fact's quotation is a whole original
 * passage, and every row whole repeated the whole ledger beside the lean one. The app keeps every fingerprint and the
 * full value it approves; the model reads the text where it stands. */
export const SHOWN_ABOVE = '(shown above, word for word)';
export function leanCheckRows(rows, shown) {
  const text = String(shown || '');
  const lean = (v) => typeof v === 'string' ? (v.length >= 80 && text.includes(v) ? SHOWN_ABOVE : v)
    : Array.isArray(v) ? v.map(lean)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lean(x)])) : v;
  return (rows || []).map((row) => ({ ...row, value: lean(row.value) }));
}

export function auditReviewRows(state,previous={}) {
  const required=ledgerVerificationRows(state).filter(row=>!verificationReceiptMatches(previous[row.id],row));
  const profiles=new Set(required.filter(r=>r.section==='characters' && r.value).map(r=>r.name));
  // Appearance is already inside the complete People snapshot. Its separate
  // canon row receives that same approval, not another model checklist item.
  return required.filter(r=>r.section!=='canon' || !profiles.has(r.name));
}

export function bindAuditEvidence(read, passages, requestedChecks = [], documents=[]) {
  const sources = new Map(passages.map(p => [p.evidenceId,p.text]));
  const requested = new Map(requestedChecks.map(row => [row.id,row]));
  const bind = row => {
    if (!row.evidenceId) return row;
    const shown = sources.get(row.evidenceId) || documents.map(d=>auditorSourceQuote(d.text,row.shown || row.evidence)).find(Boolean);
    const {evidenceError,...clean}=row;
    return {...clean,shown:shown || '',evidence:shown || '',...(shown ? {} : {evidenceError:'the selected source reference was not supplied in this reading'})};
  };
  return {...read,issues:(read.issues || []).map(i => {
    const bound = bind(i);
    return {...bound,mutations:i.mutations.map(m => bind({...m,evidenceId:m.evidenceId || i.evidenceId}))};
  }),resolved:(read.resolved || []).map(bind),checks:(read.checks || []).map(c => {
    const bound = {...bind(c),
      // Fingerprints belong to the caller's exact snapshot, not the model's
      // prose. Bind an omitted echo only to an id actually requested here.
      ...(c.print === undefined && requested.has(c.id) ? {print:requested.get(c.id).print} : {}),
      ...(requested.has(c.id) ? {scope:requested.get(c.id).scope} : {}),
      ...(Array.isArray(c.identityFacts) ? {identityFacts:c.identityFacts.map(bind)} : {}),
      ...(Array.isArray(c.physicalFacts) ? {physicalFacts:c.physicalFacts.map(bind)} : {})};
    if (Array.isArray(c.appearance)) bound.appearance = c.appearance.map(bind);
    if (Array.isArray(c.identity)) bound.identity=c.identity.map(bind);
    if (!c.lastEvidenceId) return bound;
    const passage = passages.find(p => p.evidenceId === c.lastEvidenceId);
    const main = passage?.source?.startsWith('page:') && passage?.label?.endsWith(', story');
    const lastShown=main ? passage.text.replace(/^\s*\[[^\n]*\][ \t]*/, '').trim()
      :documents.filter(d=>d.id.startsWith('page:') && d.label.endsWith(', story')).map(d=>auditorSourceQuote(d.text,c.lastShown)).find(Boolean);
    const {evidenceError,...clean}=bound;
    return {...(lastShown?clean:bound),lastShown:lastShown || '',
      ...(!lastShown ? {evidenceError:'the ending-position reference is not a supplied main-story passage'} : {})};
  })};
}

function appearanceCheckAnswers(value,c) {
  const explicit=Array.isArray(c.appearance)?c.appearance:[];
  return [...explicit,...(value?.appearanceSources || []).filter(f=>!explicit.some(a=>a.id===f.id)).flatMap(f=>{
    const proof=(Array.isArray(c.physicalFacts)?c.physicalFacts:[]).filter(p=>!p.evidenceError && p.evidenceId===f.id);
    return proof.length===1?[{id:f.id,status:'held',key:proof[0].key,value:proof[0].value,why:c.why}]:[];
  })];
}

export function profileReconciliationTasks(state,checks,documents) {
  const tasks=[];
  for (const row of ledgerVerificationRows(state).filter(r=>r.section==='characters' && r.value)) {
    const candidates=(checks || []).filter(c=>c.id===row.id);
    const c=candidates.length===1?candidates[0]:null;
    // Never manufacture approval for an absent, disputed or unfinished review.
    if (!c || !['correct','repair'].includes(c.status) || !c.why?.trim() || c.evidenceError
      || c.identityReviewed===false || c.appearanceReviewed===false) continue;
    const answers=appearanceCheckAnswers(row.value,c);
    const appearance=(row.value.appearanceSources || []).filter(f=>!reconcileAppearance(state,row.name,[f],answers.filter(a=>a.id===f.id),documents).ok);
    const identity=(row.value.identitySources || []).filter(f=>!reconcileIdentity(state,row.name,[f],(Array.isArray(c.identity)?c.identity:[]).filter(a=>a.id===f.id),documents).ok);
    if (appearance.length || identity.length) tasks.push({id:row.id,name:row.name,core:row.value.core || '',
      physicalFacts:row.value.physicalFacts?.facts || [],hand:row.value.hand || {},
      manualAppearance:(state.journal || []).filter(e=>e.m?.byHand && /^canon\./.test(e.m.type) && samePersonName(e.m.name,row.name)).map(e=>e.m),appearance,identity});
  }
  return tasks;
}

export function profileReconciliationPrompt(tasks) {
  return [
    'FOCUSED PROFILE RECONCILIATION. The full ledger review already ran. Its remaining work is these specific source facts. Do not repeat the whole audit.',
    'Return checks, exactly one per supplied characters id. Each check MUST contain status correct, repair or open, why, and an evidenceId from its source facts. Most importantly return appearance and identity arrays, exactly one decision per supplied fact id. These arrays are the task, not optional extra explanation.',
    'Appearance decision: {id,status:"held"|"superseded"|"ended"|"manual"|"open",key:"exact actual saved field",value:"exact actual saved value",why,evidenceId}. Identity decision: {id,status:"held"|"superseded"|"manual"|"open",coreText:"exact saved core excerpt representing this fact",why,evidenceId}. All fact ids are valid evidenceId references to their original quotations below. Meaning may be equivalent even when words or field labels differ. One combined saved field may represent multiple source facts; map each to that field. Preserve all explicitly established faces and distinguish their appearance. Do not overwrite one face with another.',
    'Held means the source fact is truly represented in the actual saved field or core excerpt, not merely that its quotation was read. If missing, supply the repair now: physicalFacts:[{key,value,evidenceId}] on that character check directly saves appearance; profiles:[{name,core:{text:"complete enriched biography preserving all valid existing facts",evidenceId}}] directly saves core. Map the repaired result in appearance/identity in the SAME answer and set the character status repair. A missing personality, rank, background or appearance cannot be called held. An event sentence alone is not a complete identity.',
    'Superseded or ended needs original later replacement/removal evidence, fetch if necessary. Manual needs actual current manual ownership. Never invent identity, personality, chronology or equivalence. Do not alter feelings, earned scores, scene, aliases or story prose. If evidence really is insufficient, return open with the exact reason. JSON only.',
    'REQUIRED PROFILE FACTS WITH ACTUAL SAVED TARGETS:\n'+JSON.stringify(tasks),
  ].join('\n');
}

export function mergeProfileReconciliation(previous,focused,rows) {
  const requested=new Map(rows.map(r=>[r.id,r]));
  return previous.map(c=>{
    const next=focused.filter(f=>f.id===c.id && requested.has(f.id));
    if (next.length!==1) return c;
    const f=next[0];
    const merge=(a,b,key)=>[...(Array.isArray(a)?a:[]).filter(x=>!(Array.isArray(b)?b:[]).some(y=>key(x)===key(y))),...(Array.isArray(b)?b:[])];
    return {...c,...f,print:c.print,scope:c.scope,
      appearance:merge(c.appearance,f.appearance,x=>x.id),identity:merge(c.identity,f.identity,x=>x.id),
      physicalFacts:merge(c.physicalFacts,f.physicalFacts,x=>lookKey(x.key))};
  });
}

export function restoreProfileReconciliation(state,checks,previous={}) {
  const rows=new Map(ledgerVerificationRows(state).map(r=>[r.id,r]));
  return checks.map(c=>{
    const saved=previous?.[c.id],row=rows.get(c.id);
    if (!saved || saved.print!==row?.print || saved.scope!==row.scope) return c;
    const merge=(a,b)=>[...(a || []).filter(x=>!(Array.isArray(b)?b:[]).some(y=>x.id===y.id)),...(Array.isArray(b)?b:[])];
    return {...c,appearance:merge(saved.appearance,c.appearance),identity:merge(saved.identity,c.identity)};
  });
}

export function verifyLedgerChecks({state, snapshot, checks, previous = {}, documents, source, applied = [],approvedState,authoritative=false}) {
  const rows = ledgerVerificationRows(state), old = new Map(ledgerVerificationRows(snapshot || state).map(r => [r.id,r]));
  const approved = new Map(ledgerVerificationRows(approvedState || snapshot || state).map(r => [r.id,r]));
  const entries = {}, profiles={},pending = [];
  const literal = quote => Boolean(quote && documents.some(d => auditorSourceQuote(d.text,quote)));
  const mainLiteral = quote => Boolean(quote && documents.some(d => d.id.startsWith('page:') && d.label.endsWith(', story')
    && auditorSourceQuote(d.text.replace(/^\s*\[[^\n]*\][ \t]*/, ''),quote)));
  const same = (a,b) => String(a || '').trim().replace(/\s+/g,' ').toLowerCase() === String(b || '').trim().replace(/\s+/g,' ').toLowerCase();
  for (const row of rows) {
    if (verificationReceiptMatches(previous[row.id],row)) { entries[row.id] = previous[row.id]; continue; }
    if (authoritative) {
      const cs=(checks || []).filter(c=>c.id===row.id);
      const c=cs.length===1?cs[0]:null;
      const approvedRow=approved.get(row.id),before=old.get(row.id);
      if (c && ['correct','repair'].includes(c.status) && c.why?.trim()
        && c.identityReviewed!==false && c.appearanceReviewed!==false
        && row.print===approvedRow?.print && row.scope===approvedRow?.scope
        && (c.print===before?.print || (!before && c.finalReview===true))) {
        const canonRow=row.section==='characters'?rows.find(r=>r.section==='canon' && r.name===row.name):null;
        entries[row.id]={print:row.print,scope:row.scope,status:row.print===before?.print?'correct':'repair',why:c.why,
          shown:c.shown || '',sourceRefs:[...new Set([...(c.sourceRefs || []),...finalReviewSources(state,row,documents)])],
          ...(row.section==='characters'?{identityReviewed:true,appearanceReviewed:true,reviewedBy:'final auditor',
            ...(canonRow?{canonPrint:canonRow.print,canonScope:canonRow.scope}:{}),physicalFacts:state.canon?.[row.name]?.facts || []}:{}),
          ...(row.section==='presence'?{position:row.value.position,lastShown:c.lastShown || ''}:{})};
        continue;
      }
      if (!c && row.section==='canon' && entries['characters:'+row.name]?.canonPrint===row.print) {
        const profile=entries['characters:'+row.name];
        entries[row.id]={print:row.print,scope:row.scope,status:profile.status,why:'Approved with this exact People appearance snapshot.',sourceRefs:profile.sourceRefs};
        continue;
      }
      pending.push(row.id+': '+(c?.status==='open'?c.why || 'the auditor left this entry open':row.print!==approvedRow?.print || row.scope!==approvedRow?.scope?'changed while the auditor was reading':'the auditor did not approve this entry'));
      continue;
    }
    const candidates = (checks || []).filter(c => c.id === row.id);
    const c = candidates.length === 1 ? candidates[0] : null;
    // Keep completed atom decisions even when another fact on this same
    // character remains open. Only the exact saved profile/context can reuse
    // them; a biography, canon, source or identity change invalidates them.
    if (row.section==='characters' && c && !c.evidenceError && c.print===old.get(row.id)?.print
      && (row.scope===old.get(row.id)?.scope || row.scope===approved.get(row.id)?.scope)) {
      const appearance=appearanceCheckAnswers(row.value,c).filter(a=>{
        const fact=row.value?.appearanceSources?.find(f=>f.id===a.id);
        return fact && reconcileAppearance(state,row.name,[fact],[a],documents).ok;
      });
      const identity=(Array.isArray(c.identity)?c.identity:[]).filter(a=>{
        const fact=row.value?.identitySources?.find(f=>f.id===a.id);
        return fact && reconcileIdentity(state,row.name,[fact],[a],documents).ok;
      });
      if (appearance.length || identity.length) profiles[row.id]={print:row.print,scope:row.scope,appearance,identity};
    }
    // Physical facts added in this final reading were already explicitly
    // checked on their People row. Certify those exact saved locks from that
    // receipt instead of scheduling another batch just to echo a new row id.
    if (!c && row.section === 'canon' && row.value?.facts?.length) {
      const profile = entries['characters:'+row.name];
      if (profile?.canonPrint===row.print && profile?.canonScope===row.scope) {
        entries[row.id]={print:row.print,scope:row.scope,status:profile.status,why:'The exact appearance snapshot was approved with the People record.',shown:profile.shown};
        continue;
      }
      const facts = profile?.physicalFacts || [];
      if (row.value.facts.every(held => facts.some(f => same(f.key,held.key) && same(f.value,held.value)))) {
        entries[row.id] = {print:row.print,scope:row.scope,status:'repair',why:'These exact saved physical facts were checked with the People record.',shown:facts.map(f => f.shown).join('\n')};
        continue;
      }
    }
    let reason = 'no completed entry check';
    if (c && c.print === old.get(row.id)?.print && ['correct','repair'].includes(c.status) && c.why?.trim()) {
      const changed = row.print !== old.get(row.id)?.print;
      const context = row.scope === old.get(row.id)?.scope || row.scope === approved.get(row.id)?.scope;
      // A final approved verdict and its actual supported write are one
      // decision. Whether the model labels the resulting entry correct or
      // repair must not force a second audit of that same saved result.
      const repaired = changed && row.print===approved.get(row.id)?.print && applied.some(a => {
        const m = a.mutation;
        return (row.name === (m.name || m.from || m.title) || row.section === 'scene' || row.section === 'rules') && !a.same;
      });
      // lastEvidenceId already binds literal position evidence. Do not demand
      // the same proof again under a second field and reject an honest answer.
      const position = row.section !== 'presence' || ((same(c.position,row.value.position) || (c.status === 'correct' && !changed && c.positionMatches === true)) && mainLiteral(c.lastShown));
      const identityFacts = Array.isArray(c.identityFacts) ? c.identityFacts : [];
      const physicalFacts = Array.isArray(c.physicalFacts) ? c.physicalFacts : [];
      const appearanceAnswers=appearanceCheckAnswers(row.value,c);
      const appearance = row.section === 'characters' ? reconcileAppearance(state,row.name,row.value?.appearanceSources || [],appearanceAnswers,documents) : {ok:true,facts:[]};
      const identity=row.section==='characters'?reconcileIdentity(state,row.name,row.value?.identitySources || [],c.identity,documents):{ok:true};
      // A correct/repair verdict explicitly means the housekeeper reviewed
      // identity AND appearance. Do not demand duplicate approval flags and
      // a second complete biography in the transport. Supplied detail still
      // has to be valid and present in the actual saved facts.
      const profile = row.section !== 'characters' || row.value == null
        || (identity.ok && appearance.ok && c.identityReviewed !== false && c.appearanceReviewed !== false
          && (c.identityFacts === undefined || (Array.isArray(c.identityFacts) && identityFacts.every(f => f.inCore === true && f.text?.trim() && !f.evidenceError && literal(f.shown))))
          && (c.physicalFacts === undefined || (Array.isArray(c.physicalFacts) && physicalFacts.every(f => !f.evidenceError && literal(f.shown)
            && state.canon?.[row.name]?.facts?.some(held => same(held.key,f.key) && same(held.value,f.value))))));
      const factProof = row.section === 'characters' && profile
        && [...identityFacts,...physicalFacts].some(f => !f.evidenceError && literal(f.shown));
      const proven = row.judgment || row.value == null || literal(c.shown) || factProof || (row.section === 'presence' && mainLiteral(c.lastShown));
      if ((!changed || repaired) && context && proven && position && profile && !c.evidenceError) {
        const canonRow=row.section==='characters'?rows.find(r=>r.section==='canon' && r.name===row.name):null;
        entries[row.id] = {print:row.print,scope:row.scope,status:repaired?'repair':'correct',why:c.why,shown:c.shown || '',...(row.section === 'presence' ? {position:c.position,lastShown:c.lastShown} : {}),...(row.section === 'characters' ? {identityReviewed:true,appearanceReviewed:true,identityFacts,physicalFacts:[...physicalFacts,...appearance.facts],appearance:appearance.answers,identity:c.identity || [],...(canonRow?{canonPrint:canonRow.print,canonScope:canonRow.scope}:{})} : {})};
        continue;
      }
      reason = !context ? 'entry context changed after its check' : !position ? 'last established position has not been reconciled' : !appearance.ok ? appearance.why : !identity.ok?identity.why:!proven ? 'source evidence is missing' : !profile ? 'identity and appearance completeness still need review' : 'entry changed after its check';
    } else if (c) {
      reason = c.print !== old.get(row.id)?.print ? 'check fingerprint does not match the requested entry'
        : !['correct','repair'].includes(c.status) ? 'entry remains open: '+(c.why || 'no supported correction') : 'check has no verdict reason';
    } else if (candidates.length > 1) reason = 'conflicting duplicate entry checks';
    pending.push(row.id + ': ' + reason);
  }
  return {source,ledger:ledgerRepairStateKey(state),entries,profiles,read:Object.keys(entries).length,total:rows.length,pending};
}
export function findingRows(issue, state) {
  const rows = ledgerVerificationRows(state);
  if (issue.sourceFacts) {
    const p=state.auditSources?.[issue.sourceId]?.people?.find(p=>p.name===(issue.sourceName || issue.name));
    const key=p && sourcePersonKey(state,p.name,p.ledgerName,p.identityResolution);
    return rows.filter(row=>row.section==='characters' && row.name===key);
  }
  const requested = new Set((issue.targets || []).map(t => t.id));
  if (requested.size) {
    const actual = new Set();
    for (const id of requested) {
      if (rows.some(row => row.id === id)) {
        actual.add(id);
        if (id.startsWith('characters:') && (issue.mutations || []).some(m=>m.type==='people.set' && ['state','arc','threads'].includes(m.field))) actual.add('characterState:'+id.slice(11));
        continue;
      }
      // Old target ids survive a merge. Review their canonical current record,
      // not the deleted duplicate or its obsolete proposed seat.
      const at = id.indexOf(':'), name = id.slice(at+1), key = sourcePersonKey(state,name);
      if (key) for (const row of rows) if (row.name === key && ['characters','characterState','presence','offscreen','canon','knowledge'].includes(row.section)) actual.add(row.id);
      if (isMc(state,name)) actual.add('rules:sheet');
    }
    return rows.filter(row => actual.has(row.id));
  }
  /* M752: and the people its own writes name. A finding read only for names in its words ("her hair is two colours",
   * "the ledger has the wrong hair for her") had no entries at all: a refused repair's entries were then certified by the
   * same verdict (M709 holds them open by these rows), and the reviewer was shown no current record for it. */
  const written = (issue.mutations || []).flatMap(m => [m?.name, m?.from, m?.to]).filter(n => typeof n === 'string' && n.trim());
  const writes = name => written.some(n => foldName(n) === foldName(name) || sourcePersonKey(state,n) === name || (isMc(state,n) && isMc(state,name)));
  const names = [...new Set([...Object.keys(state.characters || {}), ...Object.keys(state.offscreen || {}), ...(state.present || []).map(p => p.name)])]
    .filter(name => exactNameIn(issue.what || '',name) || writes(name));
  // Legacy allegations had no operation or target. Locate named records,
  // including both Scene and People, rather than passing an empty checklist.
  return rows.filter(row => names.includes(row.name) && ['characters','characterState','presence','offscreen','canon'].includes(row.section));
}

function savedSourceDisposition(state, sourceId, name) {
  const mention=state.auditSources?.[sourceId]?.people?.find(p=>p.name===name);
  const resolution=mention?.identityResolution;
  if (!mention || !resolution?.why || resolution.kind!==mention.kind) return null;
  if (mention.kind==='person') {
    if (resolution.scope==='local') return !resolution.to && !mention.ledgerName
      ? {kind:'person',scope:'local',target:''} : null;
    if (resolution.scope) return null;
    const target=sourceIdentityTargetKey(state,resolution.to || mention.ledgerName);
    const actual=sourcePersonKey(state,mention.name,mention.ledgerName,resolution);
    return target && actual===target && mention.ledgerName===target
      ? {kind:'person',scope:'',target} : null;
  }
  return !resolution.to && !mention.ledgerName ? {kind:mention.kind,scope:'',target:''} : null;
}

function supersededSourceIdentityHistory(findings, state, previous=[]) {
  const additions=[];
  for (const issue of findings || []) for (const mutation of issue.mutations || []) {
    if (mutation.type!=='source.resolve' || mutationSatisfied(state,mutation)) continue;
    const saved=savedSourceDisposition(state,mutation.sourceId,mutation.name);
    if (!saved) continue;
    const id=JSON.stringify([mutation.sourceId,mutation.name,mutation.to || '',mutation.kind || 'person',mutation.scope || '']);
    additions.push({id,findingId:issue.findingId || issue.id || auditFindingId(issue),sourceId:mutation.sourceId,name:mutation.name,
      attemptedTarget:mutation.to || '',attemptedKind:mutation.kind || 'person',attemptedScope:mutation.scope || '',
      rejection:issue.pendingReason || (Array.isArray(issue.refused)?issue.refused.join('; '):'') || 'Superseded by a saved source identity decision.',
      savedTarget:saved.target,savedKind:saved.kind,savedScope:saved.scope,at:Date.now()});
  }
  const byId=new Map();
  for (const entry of [...(Array.isArray(previous)?previous:[]),...additions]) if (entry?.id) byId.set(entry.id,entry);
  return [...byId.values()];
}

/* M752: a source finding asks about ONE mention in ONE original section. When that section is gone, or was read again
 * at its current text and the reading no longer has that mention (his edit, a mend, a re-extraction that names it
 * otherwise), nothing is left to decide: findings come back from the current receipts (missingSourcePeople), never from
 * an obsolete one. Both branches below returned before any withdrawal was weighed, so such a finding could never close:
 * every later audit paid a continuation call for it and the lamp never turned green. It stays open only while its
 * section waits to be read at its new text (no current receipt yet). */
function sourceMentionGone(issue, state, documents) {
  const document = documents.find(d => d.id === issue.sourceId);
  if (!document) return true;
  const receipt = state.auditSources?.[issue.sourceId];
  if (receipt?.mark !== document.mark) return false;
  const label = issue.sourceName || issue.name;
  // A legacy finding without its extracted label names the ledger person it was bound to.
  return !(receipt.people || []).some(p => p.name === label
    || (!issue.sourceName && sourcePersonKey(state,p.name,p.ledgerName,p.identityResolution) === issue.name));
}

export function findingSettled(issue, result, withdrawals, documents, verification) {
  const mutations=issue.mutations || [];
  if (mutations.some(m=>m.type==='source.resolve')
    && mutations.every(m=>m.type==='source.resolve'
      ? Boolean(savedSourceDisposition(result.out,m.sourceId,m.name) || mutationSatisfied(result.out,m))
      : mutationSatisfied(result.out,m))) return true;
  if (issue.profileRecovery && issue.sourceId && sourceMentionGone(issue,result.out,documents)) return true;
  if (issue.profileRecovery && issue.sourceId && !issue.sourceFacts) {
    const mention=result.out.auditSources?.[issue.sourceId]?.people?.find(p=>p.name===(issue.sourceName || issue.name));
    if (mention?.kind && mention.kind!=='person') return true;
    const key=mention && sourcePersonKey(result.out,mention.name,mention.ledgerName,mention.identityResolution);
    // A withdrawal without a saved source decision would regenerate the same
    // complaint next turn. Keep the actual binding as the durable result.
    return Boolean(mention && !sourceIdentityNeeded(result.out, mention));
  }
  if (issue.sourceFacts && issue.sourceId) {
    const mention=result.out.auditSources?.[issue.sourceId]?.people?.find(p=>p.name===(issue.sourceName || issue.name));
    if (!mention || !documents.some(d=>d.id===issue.sourceId && d.mark===result.out.auditSources?.[issue.sourceId]?.mark)) return false;
    if (!sourceIdentityNeeded(result.out,mention) && !missingSourceIdentityFacts(result.out,mention).length) return true;
    if (result.out.audit?.sourceFactDecisions?.[sourceFactScope(result.out,{...mention,source:issue.sourceId})]) return true;
    // Specific missing facts can be settled by grounded withdrawal or the actual
    // matching character verification below, not merely a nonempty biography.
  }
  if (issue.profileRecovery && issue.name && result.out.entityCorrections?.[issue.name]
    && !sourcePersonKey(result.out,issue.name)
    && Object.values(result.out.auditSources || {}).flatMap(r=>r.people || []).filter(p=>p.name === issue.name).every(p=>p.kind && p.kind !== 'person')) return true;
  if (issue.profileRecovery && issue.name && !issue.sourceFacts) {
    const key = sourcePersonKey(result.out, issue.name);
    if (key && String(result.out.characters?.[key]?.core || '').trim()) return true;
  }
  if (withdrawals.some(r => (r.what === issue.what || r.id === auditFindingId(issue))
    && documents.some(d => (!issue.sourceId || d.id===issue.sourceId) && auditorSourceQuote(d.text, r.shown)))) return true;
  // M696: the review repairs a historical finding by its id. It closes when that working repair actually landed, even
  // when it uses another operation than the refused proposal saved with it. Source findings keep their own rules.
  if (!issue.pages && !issue.profileRecovery && (result.issues || []).some(i => auditFindingId(i) === auditFindingId(issue)
    && i.mutations?.length && i.landed > 0 && !i.refused?.length)) return true;
  /* M700: completed checks of a finding's actual entries close it — the entries it names as its targets (M702: an obsolete
   * proposal against a merged record is reconciled on the canonical one), or, for an allegation with no operation, the
   * records its words name. A finding that only proposes an operation is answered by that operation: it closes when the
   * repair lands, is already so, or is withdrawn with its source (M685), never because the entries around it were
   * approved while it stood refused. That hung on its wording (findingRows reads names in its words): "Princess Alexia’s
   * promise is missing" was erased by an empty review and "Her promise is missing" was not. Source-fact findings keep their
   * matching character verification. */
  if (!issue.pages && verification && (!mutations.length || issue.targets?.length || issue.sourceFacts)) {
    const rows = findingRows(issue,result.out);
    if (rows.length && rows.every(row => verificationReceiptMatches(verification.entries?.[row.id],row))) return true;
  }
  const landed = [...result.applied, ...result.rejected.filter((r) => r.same)];
  /* A legacy report could save this concrete seat concern without an operation.
   * Close that exact concern only after its actual clear, not other identity facts. */
  if (!issue.mutations?.length) {
    const what = foldName(issue.what);
    return landed.some((a) => a.mutation?.type === 'offscreen.clear' && !seatForPerson(result.out, a.mutation.name)
      && [' is seated among the absent', ' is seated only offscreen'].some((words) => what.startsWith(foldName(a.mutation.name) + words)));
  }
  return issue.mutations?.length > 0 && issue.mutations.every((m) => mutationSatisfied(result.out, m)
    || landed.some((a) => sameRepairTarget(m, a.mutation)));
}

/* M687: wording changes do not create new work. Keep each unresolved target
 * once, and close it when the saved ledger already contains the actual repair. */
function compactFindings(findings, state) {
  const kept = new Map();
  for (const issue of findings) {
    const mutations = issue.mutations || [];
    if (!mutations.length) {
      if (issue.profileRecovery && issue.sourceId) {
        // Replace the legacy unscoped complaint, while keeping every distinct
        // source section of a long page with the same visible label.
        kept.delete('words:'+issue.what);
        kept.set('source:'+JSON.stringify([issue.sourceId,issue.sourceName || issue.name,...(issue.sourceFacts?['facts',issue.facts?.map(f=>f.text)]:[])]),issue);
      } else kept.set('words:' + issue.what, issue);
      continue;
    }
    for (const m of mutations) {
      const name = findPersonKey(state?.characters || {}, m.name || m.from) || m.name || m.from || m.title || '';
      const valueKey = /^(?:knowledge\.|canon\.|thread\.)/.test(m.type) || (m.type === 'people.note' && /thread/.test(m.field || ''))
        ? foldName(m.fact || m.title || m.text || m.key || '') : '';
      const field = m.type === 'presence.update' ? ['position', 'attire'].filter((f) => m[f] !== undefined).join(',') : m.field || m.key || '';
      const key = [m.type, foldName(name), field, valueKey].join('|');
      kept.set(m.type==='source.resolve'?key+'|'+m.sourceId:key, { ...issue, mutations: [m] });
    }
  }
  return [...kept.values()];
}

/* each closing door's own words for "there is nothing of that name left to close" (engine/apply.js) */
const CLOSED_ALREADY = {
  'thread.close': /^no thread called .* is open$/,
  'knowledge.forget': /has nothing written down to let go|^no line of what .* knows answers to/,
  'faction.clear': /^no faction called .* is written$/,
  'canon.unlock': /^nothing is locked true of|^no truth called .* is locked for/,
  'body.heal': /^the ledger knows no such hurt on .* still needing to heal$/,
  'presence.leave': /^no one here answers to /,
  'thing.clear': /^the ledger holds no thing called /,
};
function mutationSatisfied(state, m) {
  if (m.type==='source.resolve') {
    const p=state.auditSources?.[m.sourceId]?.people?.find(p=>p.name===m.name);
    if (m.scope==='local') return Boolean(p?.kind==='person' && p.identityResolution?.scope==='local' && p.identityResolution?.why);
    if (p?.identityResolution?.scope==='local') return false;
    const target=m.to && sourcePersonKey(state,m.to,m.to,{kind:'person',to:m.to});
    return Boolean(p?.identityResolution && p.kind===(m.kind || 'person')
      && (p.kind!=='person' || (target && sourcePersonKey(state,p.name,p.ledgerName,p.identityResolution)===target)));
  }
  const textSame = (wanted, actual) => String(wanted || '').trim() === String(actual || '').trim();
  let at = m.name ? findPresent(state, m.name, { strict: true }) : -1;
  if (at === -1 && m.name) {
    // M752: an old finding follows the page its name was actually merged into, a description too (never a guess).
    const canonical = findPersonKey(state?.characters || {}, m.name) || formerNameOwner(state?.characters || {}, m.name);
    const aliases = canonical ? state.characters[canonical]?.aliases : null;
    if (Array.isArray(aliases) && aliases.some((alias) => foldName(alias) === foldName(m.name))) at = findPresent(state, canonical, { strict: true });
  }
  if (m.type === 'presence.enter') return at !== -1;
  if (m.type === 'presence.update') return at !== -1 && ['position', 'attire'].every((field) => m[field] === undefined || (field === 'attire' && unknownAttire(m[field])) || textSame(m[field], state.present[at][field]));
  if (m.type === 'offscreen.clear') return !seatForPerson(state, m.name);
  if (m.type === 'mc.alias') return isMc(state,m.name);
  const key = findPersonKey(state?.characters || {}, m.name || m.to);
  if (m.type === 'people.set' && key) return m.sourceRecovery ? Boolean(state.characters[key].core?.trim()) : textSame(m.text, state.characters[key][m.field]);
  if (m.type === 'people.rename' && key) {
    /* made when no page bears the old name and it leads to this one: as a source mention resolves — or, for a description
     * ("the marshal"), which a mention no longer resolves to anyone by itself (2201d54), by this page's own record of the
     * merge (formerNameOwner, M752), as an old presence finding follows it above */
    return !Object.keys(state.characters || {}).some((k) => foldName(k) === foldName(m.from))
      && (sourcePersonKey(state, m.from) === key || formerNameOwner(state.characters || {}, m.from) === key);
  }
  /* M754: a loose end to open is so when it is written on a page of theirs; one to close, when none of theirs holds it (nor
   * anything near it — the door refuses those, saying what is written). His finding to close a loose end the duel's own
   * readers had already closed was never so, and every pass asked it again: yellow for good. */
  if (m.type === 'people.note' && /^(?:un)?thread$/i.test(String(m.field || '').trim()) && m.name && m.text) {
    const found = looseEndOn(state, state.characters || {}, m.name, m.text);
    return /^un/i.test(String(m.field).trim()) ? !found.key && !found.near : Boolean(found.key);
  }
  /* …and every other closing door the auditor uses: an old close is so when its door finds nothing left to close — a dry
   * run on a copy, never a write. Something still there, or a name that could be two, is not so. */
  if (CLOSED_ALREADY[m.type]) {
    if (m.type === 'thread.close' && (Array.isArray(state.threads) ? state.threads : []).some((t) => findThread([t], m.title || m.name) === 0)) return false; /* one answers, or two do (findThread gives neither) */
    const tried = applyMutations(state, [m]);
    if (tried.applied.length) return false;
    const answer = tried.rejected[0];
    return Boolean(answer && (answer.same === true || CLOSED_ALREADY[m.type].test(String(answer.why || ''))));
  }
  return false;
}

function sameRepairTarget(before, after) {
  if (!before || !after) return false;
  if (before.type==='source.resolve' && after.type==='source.resolve' && before.sourceId!==after.sourceId) return false;
  const target = (m) => String(m.name || m.from || m.title || '').trim();
  const a = target(before); const b = target(after);
  if (a || b) { if (!a || !b || !(a === b || samePersonName(a, b))) return false; }
  if (before.type === 'people.forget' && ['people.rename','people.reclassify'].includes(after.type)) return true;
  if (before.type === 'presence.update' && after.type === 'presence.update'
    && ['position', 'attire'].some((field) => before[field] !== undefined && !(field === 'attire' && unknownAttire(before[field])) && after[field] === undefined)) return false;
  if (/^(?:knowledge\.|canon\.)/.test(before.type) && foldName(before.fact || before.key || '') !== foldName(after.fact || after.key || '')) return false;
  if (before.type === 'people.note' && /thread/.test(before.field || '') && !sameLooseEnd(before.text || '', after.text || '')) return false;
  const type = (m) => m.type === 'people.note' ? 'people.set' : m.type;
  return type(before) === type(after) && String(before.field || before.key || '') === String(after.field || after.key || '');
}

function unknownAttire(value) { return /^(?:\s*|[-—–]|unknown|unspecified)$/i.test(String(value || '').trim()); }

/* Pure rehearsal and commit plan. The same guards validate both the first
 * proposal and the recovery, against the latest saved state each time. */
function judgeAudit({ fresh, offered, all, brief, castNotes, castNames, statedByModel, authoritative=false }) {
  const read = { issues: offered.map((i) => ({ ...i, mutations: (i.mutations || []).map((m) => ({ ...m })) })) };
  const scopeRejected = [];
  /* M259: the latest STORY page's header line has already written the ground
   * and the hour in code (M128/M131) — the auditor never overrides it. */
  const latestStory = [...all].reverse().find((m) => m && m.role === 'assistant' && !m.ooc);
  /* M679: the newest page's own index, counted as the chain stamps what it writes (chat.js: the page in hand among the
   * visible pages) — what its readers wrote on it is the journal's at that index, and nothing at all when they never read it */
  const storyPages = all.filter((m) => m && m.role === 'assistant');
  const newestAt = latestStory ? storyPages.findIndex((m) => m.id === latestStory.id) : -1;
  read.issues = (authoritative?finalAuditorScope:auditorRepairScope)(read.issues, fresh, {
    pageAt: newestAt, rejected: scopeRejected, sceneSource: pageText(latestStory),
    identitySources: [brief, castNotes, ...all.map(m => m.role === 'user' ? pageText(m) : narrationOf(pageText(m)))].join('\n'),
    writerSources: auditSources({brief,castNotes,messages:all}).filter(d => /^(?:brief|cast):/.test(d.id) || d.label.endsWith(', writer')).map(d => d.text).join('\n'),
    sources: auditSources({brief, castNotes, messages:all}).map(d => d.text).join('\n'),
  });
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
  const identitySource = auditSources({brief, castNotes, messages:all}).map(d => d.text).join('\n');
  const keptStandings = [];
  const identityRefused = [];
  const guarded = [];
  /* M708 (M752): two values for one appearance field still standing after the review's one completion — neither is
   * written (the second would overwrite the first) and the finding stays open with the reason, its entries unverified */
  const contradicted = new Map();
  for (const writes of appearanceConflicts(fresh, read.issues.flatMap((i) => i.mutations))) {
    const said = (w) => w.type === 'canon.lock' ? (String(w.value ?? '').trim() || 'nothing') : String(w.type).slice(6) + (String(w.value ?? '').trim() ? ' ' + String(w.value).trim() : '');
    const values = [...new Set(writes.map(said))].map((v) => '“' + v + '”').join(', ');
    for (const w of writes) contradicted.set(w, 'two different values were proposed for ' + appearanceOwner(fresh, w) + '’s ' + String(w.key || 'appearance') + ' (' + values + '); neither is saved until the review settles on one');
  }
  for (const [m, issueWhat] of read.issues.flatMap((i) => i.mutations.map((mu) => [mu, i.what]))) {
    if (contradicted.has(m)) {
      identityRefused.push({ mutation: m, why: contradicted.get(m) });
      continue;
    }
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
    /* M687: a merge proposed again once it is made is already so — for the final review too. M709 retired the engine's
     * semantic identity gate for the authoritative review and this factual no-op went with it, so a review that proposed
     * the made merge again had it refused ("nothing in the ledger is called Lord Marshal Kelstrum") as a repair still
     * owed: its finding said to need a different repair, its entries held open, the audit never finished (DOM-M687-1). */
    if (m.type === 'people.rename' && mutationSatisfied(fresh, m)) {
      identityRefused.push({ mutation: m, why: 'that identity has already been merged', same: true });
      continue;
    }
    if (!authoritative && m.type === 'people.rename') {
      const identityQuote = auditorSourceQuote(identitySource, m.shown);
      const role = roleWordOf(m.from);
      const owners = role ? roleOwnersNamed({ characters: fresh.characters, knowledge: { evidence: [{ fact: identitySource }] } }, role, null, { titles: true }) : [];
      const roleIdentity = owners.length === 1 && samePersonName(owners[0], m.to);
      const targetKey = findPersonKey(fresh.characters || {},m.to);
      const recordedRole = role && targetKey && exactNameIn(fresh.characters[targetKey].core,role)
        && identityQuote && (exactNameIn(identityQuote,m.from) || exactNameIn(identityQuote,m.to));
      const targetLabel = String(m.to || '').replace(/^(?:the|a|an)\s+/i,'');
      const recordedTargetIdentity = targetKey && targetLabel !== m.to && identityQuote
        && exactNameIn(fresh.characters[targetKey].core,m.from) && exactNameIn(identityQuote,m.from)
        && exactNameIn(fresh.characters[targetKey].core,targetLabel) && exactNameIn(identityQuote,targetLabel);
      const sameIdentity = samePersonName(m.from || '', m.to || '') || roleIdentity || recordedRole || recordedTargetIdentity || (identityQuote && exactNameIn(identityQuote, m.from) && exactNameIn(identityQuote, m.to));
      const ownedIdentity = sameOwnedDescriptor(m.from, m.to) && Boolean(findPersonKey(fresh.characters || {}, m.to)) && identityQuote;
      if ((!exactNameIn(identitySource, m.to) && !ownedIdentity && !recordedTargetIdentity) || (!sameIdentity && !ownedIdentity) || isMc(fresh, m.from)) {
        identityRefused.push({ mutation: m, why: 'a correction needs the exact name established in the story and may not rename the main character automatically' });
        continue;
      }
    }
    if (/^rel\./.test(m.type)) {
      keptStandings.push({ mutation: m, why: 'relationship judgments belong to Scene; explicit starting digits are reconciled separately', standing: true });
      continue;
    }
    guarded.push(m);
  }
  /* M57: passers-through retire in code — no bond, no seat, no thread, no
   * lock, not present, and thirty turns since their page last moved. */
  if (!authoritative) guarded.push(...seatIdentityHousekeeping(fresh)); /* M320 */
  if (!authoritative) guarded.push(...wakeHousekeeping(fresh, { brief, castNotes, castNames })); /* M304 */
  if (!authoritative) guarded.push(...peopleHousekeeping(fresh, brief, castNotes, castNames));
  /* M95: the house's own example names, echoed into a ledger by a worker of an
   * older coat, are swept out unless the brief or the cast notes name them. */
  if (!authoritative) guarded.push(...exampleLeakHousekeeping(fresh, brief, castNotes));
  /* M103: seats have a life, in code — a passer-through the world agent kept
   * seated (a cab driver with "one clean fare") is cleared and retired the
   * moment the story stops carrying them; the pool is capped. */
  if (!authoritative) guarded.push(...seatHousekeeping(fresh, { brief, castNotes, castNames, pages: all.map((m) => ({ role: m.role, text: pageText(m) })) }));
  /* M50: the standings, kept clean in code — no judgment anywhere here. */
  const mcKnown = mcName(fresh) !== 'the player' ? mcName(fresh) : '';
  guarded.push(...standingsHousekeeping(fresh, brief, castNotes, mcKnown, statedByModel)); /* M680: the digits were read before the ledger was */
  /* M680: its writes are the newest page's, stamped with its index even when the page reader's call failed */
  // Bindings consume the resulting People state in rehearsal AND final commit.
  // Preserve all other operation ordering and their existing ownership checks.
  const { state: next, applied, rejected: rejectedByApplier } = applyMutations(newestAt !== -1 ? { ...fresh, page: newestAt } : fresh, [...guarded.filter(m=>m.type!=='source.resolve'),...guarded.filter(m=>m.type==='source.resolve')].filter(m => !manualRepairConflict(fresh, m, newestAt)));
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
    const refused = [...new Set(missed.filter((m) => !alreadySo(m) && !standingRefused.has(m)).map((m) => (whyOf.get(m) && whyOf.get(m).why) || 'it did not hold'))].slice(0, 3); /* M752: one reason once */
    issues.push({ ...i, landed, refused });
  }
  const report = { at: Date.now(), turn: storyTurn(next), leftStandings, issues: issues.map((i) => ({ what: i.what, fix: i.fix, pages: i.pages === true, fixable: i.mutations.length > 0 || (i.pages === true && Boolean(i.fix)), landed: i.landed, refused: i.refused })) };
  const out = { ...next, audit: { ...fresh.audit, ...report }, ...(newestAt !== -1 ? { page: fresh.page } : {}) }; /* M680: its writes carry the newest page; the ledger's own stamp is not the auditor's to move */
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
  const rels = state.relationships || {};
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || c.retired) continue;
    const k = lower(name);
    if (mc && samePersonLoose(name, mc)) continue;
    if (present.has(k) || seated.has(k)) continue;
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
  'clock.set', 'place.set', 'presence.enter', 'presence.leave', 'mc.set', 'mc.alias',
  'body.injure', 'body.heal', 'rel.set', 'offscreen.set', 'offscreen.clear',
  'canon.lock', 'canon.unlock', 'thread.set', 'thread.close', 'knowledge.add', 'knowledge.forget', /* M372: a wrong fact can be let go */
  'faction.set', 'faction.clear', 'people.set', 'people.note', 'people.forget', 'people.rename', 'people.reclassify', 'source.resolve', /* corrections preserve their records */
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
/* M687: the last account of a person can precede the final fight paragraph.
 * Follow that person's last named sentence and its pronoun continuation. */
const sceneQuoteIn = (text, quote) => {
  const tidy = (s) => String(s || '').replace(/[‘’ʼ`]/g, "'").replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();
  const q = tidy(quote);
  return q.length >= 4 && q.length <= 1200 && tidy(text).includes(q);
};
function personTellings(state, page, name, fields = false) {
  if (typeof name !== 'string' || !name.trim()) return [];
  const scene = narrationOf(scenePartOf(page).replace(/^\s*\[[^\n]*\][ \t]*/, ''));
  const sentences = scene.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const names = [...Object.keys(state.characters || {}), ...(state.present || []).map((p) => p.name), ...Object.keys(state.offscreen || {}), mcName(state)].filter((n) => n && !samePersonName(n, name));
  /* Existing lower-case role seats can use a plural label for a single maid.
   * This is field evidence only, and never resolves competing role holders. */
  const role = fields && name === name.toLowerCase() ? (foldName(name).match(/\b(maid|guard|groom|servant|attendant)s\b/) || [])[1] : '';
  const roleRe = role ? new RegExp('\\b' + role + 's?\\b') : null;
  const ownRole = roleRe && !names.some((n) => roleRe.test(foldName(n)));
  const shows = (sentence) => {
    if (ownRole && roleRe.test(foldName(sentence))) return true;
    if (!shownOnPage(state, sentence, name)) return false;
    if (!fields) return true;
    const core = foldName(nameCore(name));
    const text = foldName(sentence); const at = core ? text.indexOf(core) : -1;
    if (at >= 0 && /\b(?:to|toward|towards|beside|with|past|behind|near|at|for|from)\s+$/.test(text.slice(0, at))
      && names.some((n) => shownOnPage(state, sentence.slice(0, sentence.toLowerCase().indexOf(nameCore(name).toLowerCase())), n))) return false;
    return true;
  };
  const tellings = [];
  for (let at = 0; at < sentences.length; at++) {
    if (!shows(sentences[at])) continue;
    const parts = [sentences[at]];
    let through = at;
    for (let i = at + 1; i < sentences.length; i++) {
      if (names.some((n) => shownOnPage(state, sentences[i], n)) || !(shows(sentences[i]) || /^(?:\S+\s+){0,4}?(?:she|he|they|her|his|their)\b/i.test(sentences[i]))) break;
      parts.push(sentences[i]);
      through = i;
    }
    tellings.push(parts);
    at = through;
  }
  return tellings;
}
function currentPersonTelling(parts, shown = '') {
  if (!parts) return '';
  const told = parts.join(' ');
  if (shown && !sceneQuoteIn(told, shown)) return '';
  if (shown && parts.length > 1 && !sceneQuoteIn(parts.at(-1), shown) && !sceneQuoteIn(shown, parts.at(-1))) return '';
  return told;
}
function mcPersonaQuote(state, name, shown, source, reviewed = false) {
  const quote = auditorSourceQuote(source, shown);
  return Boolean(quote && (explicitMcPersona(state,name,quote) || (reviewed && groundedMcPersona(state,name,quote))));
}

/* M689: validate the repair contract, not the model's interpretation of prose.
 * Legacy auditorScope remains exported for old consumers; production uses this path. */
export function manualRepairConflict(state, m, pageAt) {
  if (m.type === 'clock.set' && handSetClockSince(state, pageAt)) return true;
  const key = findPersonKey(state.characters || {}, m.name || m.from || '');
  const person = key ? state.characters[key] : null;
  const field = /^(unthread|thread|threads)$/.test(m.field || '') ? 'threads' : m.field;
  if (/^people\./.test(m.type) && (person?.hand?.[field] || (['people.forget', 'people.rename', 'people.reclassify'].includes(m.type) && Object.keys(person?.hand || {}).length))) return true;
  if (/^rel\./.test(m.type)) {
    const k = personBookKey(state, state.relationships || {}, m.name, (map, n) => findRelationship(map, n)?.key);
    if (k && state.relationships[k]?.hand) return true;
  }
  if (/^canon\./.test(m.type)) {
    const last=[...(state.journal || [])].reverse().find(j=>/^canon\.(?:lock|unlock)$/.test(j.m?.type || '')
      && (samePersonName(j.m.name,m.name) || (isMc(state,j.m.name) && isMc(state,m.name))) && lookKey(j.m.key)===lookKey(m.key));
    if (last?.m?.byHand) return true;
  }
  const last = [...(state.journal || [])].reverse().find(j => j?.m && j.m.type === m.type
    && String(j.m.name || '') === String(m.name || '') && String(j.m.field || j.m.key || '') === String(m.field || m.key || ''));
  return Boolean(last?.m?.byHand && (!Number.isInteger(pageAt) || last.p >= pageAt));
}
export function auditorSourceQuote(source, quote) {
  const exact = quotedSource(source, quote);
  if (exact) return exact;
  const text = String(source || ''), wanted = String(quote || '').trim();
  if (wanted.length < 4) return '';
  const normalized = value => {
    let text = '', positions = [];
    for (let i = 0; i < value.length; i++) {
      let c = value[i];
      if (c === '*' || c === '_' || c === '`') continue;
      if (/[‘’ʼ]/.test(c)) c = "'";
      if (/[“”]/.test(c)) c = '"';
      if (/[—–]/.test(c)) c = '-';
      if (/\s/.test(c)) { if (!text || text.endsWith(' ')) continue; c = ' '; }
      text += c; positions.push(i);
    }
    return {text, positions};
  };
  const q = normalized(wanted).text.trim();
  const src = normalized(text); const index = src.text.indexOf(q);
  if (index < 0 || q.length < 4) return '';
  let start = src.positions[index], end = src.positions[index + q.length - 1] + 1;
  while (start > 0 && /[*_`]/.test(text[start - 1])) start--;
  while (end < text.length && /[*_`]/.test(text[end])) end++;
  return text.slice(start, end);
}

export function auditorRepairScope(issues, state, { sources = '', sceneSource = null, identitySources = sources, writerSources = '', pageAt = null, rejected = [] } = {}) {
  return (issues || []).map(issue => ({ ...issue, mutations: (issue.mutations || []).filter(m => {
    // This permission is established by the source validator, never granted
    // by the provider. The same logged proof survives undo/replay and opening.
    delete m.writerEstablished;
    // M689: every relationship judgment is Scene's — judgeAudit's standing door refuses and counts it (M277), never a finding
    if (/^rel\./.test(m.type)) { delete m.byHand; return true; }
    const writerCore = isMc(state,m.name) && m.type === 'people.set' && m.field === 'core'
      && m.clear !== true && auditorSourceQuote(writerSources,m.shown || m.evidence || issue.shown);
    // A supported persona clear must persist identity, or World recreates it.
    if (m.type === 'offscreen.clear' && !isMc(state,m.name) && mcPersonaQuote(state,m.name,m.shown || issue.shown,identitySources)) m.type = 'mc.alias';
    // Unknown clothes are not a factual correction to the saved clothing.
    if (/^presence\.(update|enter)$/.test(m.type) && m.attire !== undefined && unknownAttire(m.attire)) delete m.attire;
    let why = '';
    if (m.evidenceError) why = m.evidenceError;
    else if (!AUDITOR_TYPES.has(m.type) && m.type !== 'presence.update') why = 'unsupported auditor operation';
    else if (manualRepairConflict(state, m, pageAt)) why = 'the writer explicitly controls this field';
    else if (m.type === 'mc.set' && mcName(state) !== 'the player' && !isMc(state, m.name)) why = 'the main character identity belongs to the writer';
    else if (m.type === 'mc.alias' && !mcPersonaQuote(state,m.name,m.shown || issue.shown,identitySources,true)) why = 'include an original identity quotation grounding the player and their own persona';
    else if (isMc(state, m.name) && /^people\./.test(m.type) && !['state', 'thread', 'unthread'].includes(m.field) && !writerCore) why = 'record the main character biography only from an original writer quotation; never invent their nature or arc';
    else if (!/^rel\./.test(m.type)) {
      const quote = m.shown || m.evidence || issue.shown;
      const supported = auditorSourceQuote(sources, quote);
      if (!supported) why = 'include a source quotation supporting this correction; earlier scene evidence is allowed when the completed pages show it still holds';
      else { m.shown = supported; m.evidence = supported; }

    }
    if (why) { rejected.push({ mutation: m, issue, why }); return false; }
    if (writerCore) m.writerEstablished = true;
    // A provider must never grant itself the writer's manual override.
    delete m.byHand;
    return true;
  }) }));
}

// The final auditor judges chronology, identity and equivalent wording.
// Keep ownership and supported operations, not another prose interpretation
// or a mandatory source-id echo after the model has reviewed originals.
export function finalAuditorScope(issues,state,{writerSources='',pageAt=null,rejected=[]}={}) {
  return (issues || []).map(issue=>({...issue,mutations:(issue.mutations || []).filter(m=>{
    if (m.type === 'people.forget' && ['place','organization','object','group'].includes(m.kind)) m.type='people.reclassify';
    delete m.byHand;
    delete m.writerEstablished;
    delete m.auditorApproved;
    // M689: every relationship judgment is Scene's — judgeAudit's standing door refuses and counts it (M277), never a finding
    if (/^rel\./.test(m.type)) return true;
    let why='';
    if (!AUDITOR_TYPES.has(m.type) && m.type!=='presence.update') why='unsupported ledger operation';
    else if (manualRepairConflict(state,m,pageAt)) why='the writer explicitly controls this field';
    else if (m.type==='people.forget') why='preserve established records; correct identity with a rename';
    else if (m.type==='people.rename' && isMc(state,m.from)) why='the player identity belongs to the writer';
    else if (m.type==='people.reclassify' && isMc(state,m.name)) why='the player identity belongs to the writer';
    else if (isMc(state,m.name) && m.type==='people.set' && m.field==='arc') why='the player arc belongs to the writer';
    else if (isMc(state,m.name) && m.type==='people.set' && m.field==='core' && !writerSources.trim()) why='no original writer biography was supplied';
    if (why) {rejected.push({mutation:m,issue,why});return false;}
    m.source='auditor';m.auditorApproved=true;
    if (isMc(state,m.name) && m.type==='people.set' && m.field==='core') m.writerEstablished=true;
    return true;
  })}));
}

export function auditorScope(issues, state, { header = [], page = '', writerPage = '', pageAt = null, rejected = null, evidenceText = '', writerIdentityText = '' } = {}) {
  const restatedOk = new WeakSet(); /* M661: the changes of place and dress the newest page bears out */
  const refusedFor = new WeakMap();
  const refuse = (m, why) => { refusedFor.set(m, why); return true; };
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
  const accounts = new Map();
  const accountsFor = (name, fields = false) => {
    const key = JSON.stringify([name, fields]);
    if (!accounts.has(key)) accounts.set(key, personTellings(state, page, name, fields));
    return accounts.get(key);
  };
  const personalTelling = (m) => m?.name ? currentPersonTelling(accountsFor(m.name, true).at(-1), m.shown) : '';
  const personalFields = (m, field) => {
    const parts = m?.name ? accountsFor(m.name, true).at(-1) : null;
    if (!currentPersonTelling(parts, m.shown)) return '';
    const last = parts.at(-1);
    const at = findPresent(state, m.name, { strict: true });
    const kept = at !== -1 ? state.present[at]?.[field] : '';
    /* A supplied quote can cover adjacent current details. It cannot replace
     * a later supported saved field with an earlier part of that quote. */
    if (m.shown && kept && wordsIn(kept, last) && !wordsIn(m[field], last)) return '';
    return m.shown || last;
  };
  const currentArrival = (m, why) => {
    if (!['the page’s ending does not show them', 'not in the room this page’s reader named as it ends'].includes(why)) return false;
    const accounts = accountsFor(m.name).map((parts) => parts.join(' '));
    /* Presence persists after an arrival. Its proof need not be the later pose's
     * quotation; posture and dress still use only the latest account below. */
    if (m.shown && !accounts.some((t) => sceneQuoteIn(t, m.shown))) return false;
    const told = accounts.at(-1) || '';
    if (!told || goneAtTheEnd(state, page, m.name) || mcWalksOff(page, mcName(state))) return false;
    if (readersWrote.some((jm) => jm.type === 'presence.leave' && samePersonName(jm.name, m.name) && quotedGoing(state, page, jm.name, jm.shown))) return false;
    const held = seatForPerson(state, m.name);
    if (held && isDeadSeat(held.entry)) return false;
    /* The header's place names the room; its fifth cell is only the main character's pose. */
    const ground = headerMutations(page, { ground: state?.place?.name || '' }).find((hm) => hm.type === 'place.set')?.name || state?.place?.name || '';
    const seatedHere = held && (seatAtScene(held.entry.location, ground) || wordsIn(ground, held.entry.location));
    /* These accounts already name the target. Read their arrival by subject,
     * rather than letting another person's arrival anywhere in a quote count. */
    const arrived = accounts.some((t) => comesInAtTheEnd(state, t, [m.name]));
    const room = Number.isInteger(pageAt) && state?.roomAt?.page === pageAt && Array.isArray(state.roomAt.names) ? state.roomAt.names : [];
    if (held && room.length && !room.some((n) => samePersonName(n, m.name)) && !seatedHere && !arrived) return false;
    /* Without a supplied quote, a named arrival can be recovered directly.
     * A matching old seat alone cannot prove that the person stayed with him. */
    if (!m.shown && !arrived) return false;
    if (why.startsWith('not in the room') && !seatedHere && !arrived) return false;
    if (Number.isInteger(pageAt) && state?.groundWas?.page === pageAt && held && !seatedHere && !arrived) return false;
    return Boolean(arrived || seatedHere || wordsIn(m.position || m.shown || told, told));
  };
  const movedThisPage = (thing) => readersWrote.some((jm) => jm.type === 'thing.set' && typeof jm.name === 'string' && Boolean(findThingKey({ [jm.name]: true }, String(thing || ''))));
  const samePerson = (a, b) => typeof a === 'string' && typeof b === 'string' && (samePersonName(a, b) || (isMc(state, a) && isMc(state, b)));
  const openedThisPage = (name, text) => readersWrote.some((jm) => jm.type === 'people.note' && /^thread$/i.test(String(jm.field || '').trim()) && samePerson(jm.name, name) && sameLooseEnd(String(jm.text || ''), String(text || '')));
  const his = page ? headerDress(page) : null;
  if (page && Array.isArray(issues)) {
    const told = narrationOf(scenePartOf(page));
    issues = issues.map((issue) => (issue && Array.isArray(issue.mutations) ? { ...issue, mutations: issue.mutations.map((m) => {
      /* Models sometimes put the copied quote on the finding, not twice in its
       * mutation. Bind that exact source quote to this target before using it. */
      if (m?.name && !m.shown && /^(?:presence\.(?:enter|update)|offscreen\.clear)$/.test(m.type)) {
        const quotes = [issue.shown, ...[...String(issue.what || '').matchAll(/["“]([^"”]{8,1200})["”]|(?:^|[\s:])'([\s\S]{8,1200}?)'(?=$|[\s.,;])/g)].map((hit) => hit[1] || hit[2])].filter(Boolean);
        const quote = quotes.find((q) => accountsFor(m.name, m.type === 'presence.update').some((parts) => sceneQuoteIn(parts.join(' '), q)) || (m.type === 'offscreen.clear' && mcPersonaQuote(state, m.name, q, writerIdentityText)));
        if (quote) m = { ...m, shown: quote };
      }
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
        const placeFix = at ? restatedPresence(state, [{ name: m.name, at, wears: '' }], [], heldAt ? page : personalFields(m, 'position') || ending)[0] : null;
        const dressFix = wears ? restatedPresence(state, [{ name: m.name, at: '', wears }], [], heldWears ? page : personalFields(m, 'attire') || ending)[0] : null;
        if (placeFix || dressFix) {
          const fixed = { type: 'presence.update', name: (placeFix || dressFix).name, ...(placeFix ? { position: placeFix.position } : {}), ...(dressFix ? { attire: dressFix.attire } : {}), ...(m.shown ? { shown: m.shown } : {}) };
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
    if (m.type === 'presence.update') return m.staleClear || restatedOk.has(m) ? false : refuse(m, 'the proposed position or attire is not supported by this person’s latest account on the newest page');
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
      if (m.type === 'offscreen.clear' && (isMc(state, m.name) || !seatForPerson(state, m.name) || mcPersonaQuote(state, m.name, m.shown, writerIdentityText))) return false;
      const why = walkInFromPage(state, m.name, { page, pageAt, shown: m.shown });
      if (why && !writerArrival(m) && !currentArrival(m, why)) return refuse(m, why + (m.shown ? '; the supplied quote does not establish a current arrival for this person' : '; no current named arrival or matching scene seat establishes their presence'));
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
      if (m.field === 'state') {
        const last = accountsFor(m.name, true).at(-1)?.at(-1) || '';
        const kept = key ? state.characters[key].state : '';
        if (kept && wordsIn(kept, last) && !wordsIn(m.text, last)) return refuse(m, 'the proposed now restores an earlier moment over this person’s later supported state');
        const own = personalTelling(m);
        const sceneState = own && sceneQuoteIn(own, m.shown) && shownOnPage(state, m.shown, m.name) && m.text && exactNameIn(m.shown, m.text);
        return !(isHere(state, m.name) && (supported(m, endingTold) || sceneState));
      }
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
        const why = refusedFor.get(m) || (m?.type === 'people.note' && m.field !== 'unthread'
          ? 'supply an exact shown source quote for people.note core, arc or thread; use people.set field core for an identity repair'
          : m?.type === 'people.set' && m.field !== 'core'
            ? 'this changes the current state or arc owned by the page reader; supply a source-backed correction, not a new simulation'
            : !AUDITOR_TYPES.has(m?.type) && m?.type !== 'presence.update'
              ? 'this operation is not in the auditor’s vocabulary: ' + String(m?.type || '(missing type)')
              : 'the proposed ' + String(m?.type || 'change') + ' conflicts with the newest page, its ending, or a fact already established by that page');
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
 * again). Capacity never removes a meaningful stored seat. */
export const SEAT_MENTION_PAGES = 12;
export const SEAT_FRESH_TURNS = 6;
/* M304: A RUNAWAY GUARD, NOT A SIZE A REAL CAST REACHES (M266's law, applied
 * here at last). It was 12 — and a story with twenty people who matter lost
 * eight of their whereabouts to it on every page, the least reachable first,
 * which in a long tale is most of the family. What the STORYTELLER is told
 * of is still ranked by who can reach the scene; what the LEDGER keeps is
 * everyone the story carries. */
export const SEAT_CAP = Infinity; // Compatibility export: no storage capacity eviction.
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
  if (threads.some((t) => t && typeof t === 'object' && ((t.owner && samePersonLoose(t.owner, name)) || (t.with && samePersonLoose(t.with, name))))) return 'an open thread';
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
  if (String(seat?.agenda || '').trim()) return 'an active world objective';
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
  if (seat && Number.isFinite(seat.firstAtTurn ?? seat.atTurn) && turn - (seat.firstAtTurn ?? seat.atTurn) < SEAT_FRESH_TURNS) return 'seated just now';
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
  // Capacity limits belong to prompt views, never deletion of stored seats.
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
const LASTING = new Set(['the brief names them', 'a standing toward the main character', 'an open thread', 'an active world objective', 'a loose end on their page', 'the writer’s own hand on their page']);
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
        /* mergeFrom: what the pages earned under the shorter name comes along, so the brief's digits never write over it (M689) */
        out.push({ type: 'rel.set', name: keep, p: rels[drop].p || 0, r: rels[drop].r || 0, s: rels[drop].s || 0, mergeFrom: drop, cause: 'the same person as ' + drop + ' — one standing' });
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
    if (rel?.hand) continue;
    const earnedAxis = ax => rel?.earnedAxes?.[ax] || (rel?.history || []).some(h => h && h.axis === ax
      && (Number(h.delta) !== 0 || (h.cause && !/^the brief\b|^set\b|^the founder\b/i.test(h.cause.trim()))));
    const correction = {};
    for (const ax of ['p', 'r', 's']) {
      if (Number.isFinite(st[ax]) && !earnedAxis(ax) && Number(rel?.[ax] || 0) !== st[ax]) correction[ax] = st[ax];
    }
    if (Object.keys(correction).length) out.push({ type: 'rel.set', name: key || st.name, ...correction,
      source: 'auditor', cause: 'the brief states explicit starting digits toward ' + (mc || 'the main character') + '; untouched axes corrected' });

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
    .map((st) => ({ type: 'rel.set', name: st.name, p: st.p, r: st.r, s: st.s, cause: 'the brief states (' + statedDigits(st) + ') toward ' + (mc || 'the main character') })); /* M752: only the stated digits */
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
