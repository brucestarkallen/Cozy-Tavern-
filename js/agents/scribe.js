import { LEDGER_READER_RULES, SCENE_ENDING_TASK, workerPeopleContext, workerProfileSources, retainPeopleFailures } from './ledgercontext.js';
import { db } from '../store.js';
import { auditSources } from './auditsources.js';
import { findCanonKey, findFact } from '../engine/canon.js';
/* Cozy Tavern — agents/scribe.js
 * The scribe (M12). After each finished turn — background only, riding the
 * worker channel behind the extractor — the scribe reads the turn pair
 * (what the writer wrote, what the storyteller answered) and proposes
 * sparse JSON deltas for the character ledger (engine/people.js): who each
 * person is, where they are, how things stand, and which loose ends stay
 * open.
 *
 * The scribe only PROPOSES; the merge code in people.js is the law: names
 * resolve against the known cast (bounded Levenshtein), a note meant for
 * "you" lands on the main character's record, the main character's core
 * and arc are never written, and one person's words are never copied into
 * another's entry.
 *
 * Unlike the never-throw workers, scribeTurn THROWS on transport failure
 * (it rides agents/queue.js, which retries with backoff and keeps the chat
 * path safe — the queue is the boundary that never throws). A response
 * that asks for patience (Retry-After on a 429/503) is honored: the error
 * carries retryAfterMs for the queue's backoff (M28: providers/wire.js).
 */

import { balancedCandidates, parseLenient } from './jsonutil.js';
import { isHere, nameOnPage, samePersonName } from '../engine/names.js'; /* M398/M412; M414: named by the one answer */
import { lookKey } from '../engine/canon.js';
import { wholePage, writerText, BRIEF_ROOM, CAST_ROOM } from '../engine/whole.js'; /* M259: the page read to its end; M283: the writer's own, to the room */
import { loadState, saveState, notify, ledgerTurn } from '../engine/state.js'; /* M753: one write of the ledger at a time */
import { mcKey, findPersonKey, thinsCore, isMc } from '../engine/people.js';
import { applyMutations, placeholderIn } from '../engine/apply.js'; /* M72: the scribe writes through the journal */
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { LOOSE_ANSWERED_MEANS } from './herewords.js'; /* M679: what answers a loose end — one definition */
import { askWithFetch, fetchLaw, viewBudget, roomChars, leashFor, windowOfPages } from './lookup.js';
import { renderWholeLedger } from '../engine/whole.js'; /* M28: the one wire path for workers */
import { exactNameIn, quotedSource, WRITER_FACTS } from '../engine/evidence.js';
import { retryAfterMs } from '../providers/wire.js'; /* M28: moved to the wire; re-exported for the harness contract */
import { contextOf } from '../providers/room.js';
export { retryAfterMs };

/* M259: was 600 — a busy page's notes ran past it, and the cut answer was
 * read as "nothing shifted". Thinking is off on the wire (M28). */
const MAX_TOKENS = 2400;
export const scribeBudget = connection => contextOf(connection) >= 32000 ? 6000 : MAX_TOKENS;

/* ---------- the prompt (human-voiced, kept in the code) ---------- */

const SYSTEM_PROMPT = [
  WRITER_FACTS,
  'You keep the character pages of a story told between two writers.',
  'After each page is finished, you update — sparsely, only where something truly',
  'shifted — the ledger that remembers who each person is.',
  '',
  'Answer with JSON ONLY, in exactly this shape:',
  '{"deltas":[ ... ],"facts":[{"name":"NAME","key":"hair","value":"established colour","shown":"exact original source quotation"}],"entities":[{"name":"exact erroneous People name","kind":"place","cause":"why this is not an individual","shown":"original quotation establishing the actual subject"}]}',
  'Before writing profiles or facts, identify their actual subjects. Do not open People pages for a kingdom, city, organization or object merely because its name appears in a title or descriptive sentence. Use entities ONLY to correct existing misclassified People records or source inventory rows, with kind place, organization, object or group and an original quote. This archives misplaced records reversibly; it does not erase a real individual. The animal or personified being explicitly acting as a character is an individual. Place every physical fact on its actual subject, never the homeland in their title. Then enrich the actual person\'s core and lasting facts in this SAME answer, before the final auditor. Empty entities:[] is fine.',
  'facts records missing LASTING physical facts, such as hair, eyes, build and scars, in What\'s true of them. Include these even when no feeling or event changed. Do not put clothing, current posture or momentary expressions there. Fetch earlier original pages when the current People record has lost established identity or appearance. A nonempty core is not necessarily complete. Keep the full existing valid identity when adding missing rank, family, background or nature; a single action is not their core.',
  'If a saved physical fact is actually wrong, correct it here with facts:{name,key,value,shown,replaces:"the exact current wrong value",cause:"why the original sources establish this correction"}. Compare chronology first; do not undo a later real change or conflate alternate faces. Missing facts need no replaces. Manual facts stay with the writer. Different wording of an equivalent value is not an error.',
  '',
  'Each delta is {"name":"NAME","field":"state","text":"…","cause":"the event or established fact that explains this change","shown":"an exact source quote when available"} where field is one of:',
  '  core   — their stable nature: voice, tells, what never really changes.',
  '           Fill missing established identity now, including a nonempty but incomplete core. Keep every valid lasting fact; use as much space as the established profile needs.',
  '  (a "state" that holds who they are in their life — school year, age, role, family, home — is not a',
  '   state: add those facts to their core and write where they are and what they are doing now.)',
  '  state  — where they are and how they are doing, RIGHT NOW. Lead with',
  '           the place. Rewrite it when they move or their condition turns.',
  '           ONLY for people IN THE SCENE. A person who is elsewhere has a',
  '           seat the world agent keeps — that seat is their now; never',
  '           write state for the absent (two writers, two nows, and the',
  '           writer read a contradiction).',
  '  arc    — how they stand with the main character, and WHY it moved.',
  '           Only when something on the page moved it, and name the beat.',
  '  thread — one open loose end ("she still owes the ferryman"). Only what',
  '           the page left genuinely open.',
  '  unthread — a loose end that closed, worded as it was written before.',
  '',
  /* M572 (the audit, read as sent): this rule had been set down in the middle of "arc", so the arc's own last line read as
   * if it belonged to the real record; and it let the scribe "invent where the record is silent" beside every other rule
   * here that says only what the page, the brief or the record shows. */
  'THE REAL RECORD: a real person or a character from an established canon is written from the real record given',
  'below — their true name, family, role and known history — never a made-up version. Where the record is silent or',
  'none is given, only what the page and the brief show: your own memory of a canon is not material.',
  '',
  'A PERSON WITH NO PAGE GETS ONE. Everyone named who acts or speaks on this page (a passer-through excepted —',
  'the law of the desk, below) and',
  'has no page above gets their page now — this is not "sparse", it is the first line of the',
  'ledger that will remember them: a core (who they are — role, nature, voice — only as the page,',
  'the brief or the real record shows it), their state if they are in the scene,',
  'their arc if the page moved how they stand with the main character. Never the main',
  'character\u2019s invented nature. A unique established singular role or ranked sibling gets a page under the exact role when no personal name is given; a generic unnamed crowd extra gets no page. Parenthetical writer introductions are facts; comparison characters are not extra members of the cast.',
  '',
  'CLOSE WHAT THE PAGE ANSWERED. Before you write anything, read the',
  'loose ends already open on each person above and ask of EVERY one: did this',
  'page answer it? A question asked and then answered, an introduction promised',
  'and then made, a photo hunted and then found, a name waited for and then',
  'spoken — close it with unthread, worded as it stands in the ledger. Loose',
  'ends do not expire on their own: one left open is carried to the storyteller',
  'for the rest of the tale as something still hanging, and a page that answers',
  'it is the ONLY thing that closes it. Closing what the page answered matters',
  'as much as opening what it left open — a ledger full of finished business is',
  'a ledger that lies. ' + LOOSE_ANSWERED_MEANS, /* M679: one definition, the reader's and the auditor's */
  '',
  'CHARACTER GRAVITY (the writer’s own law, for every page you keep):',
  '  - STACK: new feelings ADD to old — humiliation + intrigue + fury coexist; cruel + fascinated',
  '    is MORE dangerous, never nicer. A page that replaces a feeling with its opposite is drift.',
  '  - ROUTE: a feeling is written in THIS person’s native language — a sadist’s respect is',
  '    obsession, never warmth; a proud man’s gratitude is gruff; a paranoid reads a debt as a leash.',
  '  - VELOCITY: one scene, one degree. Real change costs several scenes with proportional cause;',
  '    fascination can begin in one fight and cannot complete in one. An arc that jumps is drift.',
  '  - RECALL: before writing anyone’s page, re-read their core and their last state — "ruthless"',
  '    is still ruthless at turn 40.',
  '  - A PERSON IS NOT THEIR CORE: range inside a character is not drift — the stoic tender about',
  '    one thing, the cruel man with a private code, the warm one who goes flat at a specific line.',
  '    Record the contradiction as theirs; never flatten a person to one adjective.',
  '  - DEFEAT IS NOT REDEMPTION: losing does not ennoble. A public defeat stacks humiliation onto the',
  '    core and routes through it — resentment, excuses, face-recovery, softer targets, "he cheated".',
  '    "Honorable in defeat" or "grudgingly impressed" needs a core that says so; otherwise it festers.',
  '  - GOALS PERSIST: a want survives a setback as a change of tactic, never as deletion. A goal dies',
  '    only when motivation, resources and allies are ALL gone.',
  '',
  'The law of the desk:',
  '  - PASSERS-THROUGH GET NO PAGE: a driver, a clerk, a waiter, a guard at a door, a face in a',
  '    crowd — anyone who served a function once, with no name or a throwaway one, no bond with',
  '    the main character and no want of their own — is scene texture, not a person to keep.',
  '    Write them a page only when the story gives them a want, a bond, or a second scene.',
  '  - Only what the prose explicitly shows. When unsure, omit. Most turns',
  '    change nothing: {"deltas":[]} is a good and honest answer.',
  '  - Never write one person’s doings into another’s page.',
  '  - For the main character recover missing core ONLY from the original writer brief, cast notes or writer pages, with shown quoting those original words. Preserve their',
  '    full existing writer biography. Never invent their nature or arc. Notes about "you"',
  '    belong to the main character’s record.',
  '  - Keep changed state and arc concise; complete identity and physical fact coverage takes priority over a sentence count. Names keep the spelling the',
  '    prose uses.',
  '',
  'No commentary, no markdown fences: the JSON object only.',
  'PLACEHOLDERS: NAME, OTHER NAME, NEW NAME, NAME SURNAME and MAIN CHARACTER in the examples above are placeholders, never people — never write them; write only the names the ledger, the brief and the pages use.',
].join('\n');

/* Exported for the harness: the two messages any provider flavor receives. */
/* M283: THE SCRIBE WROTE WHO PEOPLE ARE WITHOUT THE BRIEF. Its law says to
 * write only the names "the ledger, the brief and the pages use" — and the
 * brief was never handed to it; nor the cast notes. And it saw the pages it
 * keeps through the storyteller's smallest view (4,800 characters): with the
 * notes kept whole, a few present cards filled it, and the off-scene people
 * this very page names (M227) were shed before it could read them. */
export const SCRIBE_VIEW_TOKENS = 200000;
export function buildScribeMessages({ state, userText, assistantText, brief = '', castNotes = '', canonRecord = '', record = '', pages = [], contextBudget = Infinity, peopleRoom = 60000, documents = null }) {
  /* M227: THE SCRIBE COULD NOT SEE THE LOOSE ENDS IT WAS MEANT TO CLOSE.
   * renderPeopleTiers only gives a full page — Loose ends included — to
   * people on scene, and recalls an OFF-scene person only when these pages
   * name them. This passed an EMPTY page list, so nobody off scene was ever
   * recalled and their open loose ends were invisible. Every thread on
   * anyone not currently in the room therefore stayed open FOREVER, however
   * plainly the page answered it — Alexia's unfinished self-introduction,
   * Aurora's answered question, Ms June's, Vanessa's hunted photo, all of
   * them piling up for the housekeeper to find. The pages of this very turn
   * are what it is reading; they are what decides who is recalled. */
  const material = String(brief || '') + '\n' + String(castNotes || '');
  const ledger = workerPeopleContext(state, { material: material + '\n' + userText + '\n' + assistantText, room: peopleRoom });
  const profileSources = workerProfileSources(state, documents, { material: userText + '\n' + assistantText, room: Math.floor(peopleRoom / 2) });
  /* M294: THE MAIN CHARACTER'S RECORD WAS NEVER SHOWN TO THE SCRIBE. The
   * pages it reads are the storyteller's view (renderPeopleTiers), which
   * leaves the main character out by design — the writer plays them. So the
   * scribe was told to keep their state and loose ends and never once saw
   * what they said: every other page moved with the story and the main
   * character's stood, "Now:" thirty pages old, with nothing to prompt a
   * fresh note. Their record rides here — state and loose ends, as the law
   * allows — so a note that no longer holds is seen and written again. */
  const mcRecord = (() => {
    const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
    const name = mcKey(state);
    if (!name || name === 'the player') return '';
    const key = findPersonKey(chars, name);
    const c = key ? chars[key] : null;
    const lines = [];
    if (c && typeof c.core === 'string' && c.core.trim()) lines.push('Writer biography: ' + c.core.trim());
    if (c && typeof c.state === 'string' && c.state.trim()) lines.push('Now: ' + c.state.trim());
    if (c && Array.isArray(c.threads) && c.threads.length) lines.push('Loose ends: ' + c.threads.join('; '));
    return 'The main character\u2019s record \u2014 ' + (key || name) + ' (record writer facts, current state and loose ends; never invent core or arc):\n'
      + (lines.length ? lines.join('\n') : 'Nothing written yet.');
  })();
  /* M408: EVERYONE HERE HAS A NOW. A now that named a place the scene had left is let go (M405); the one the page shows
   * is the scribe's to write again — and the scribe writes sparsely ("only where something truly shifted"), so Kyōraku
   * and Rukia stood in the courtyard with no now at all. Whoever is here with no now is named, to be written this time. */
  const noNow = (() => {
    const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
    const mc = mcKey(state);
    return (Array.isArray(state && state.present) ? state.present : [])
      .map((p) => (p && p.name ? findPersonKey(chars, p.name) || p.name : '')).filter(Boolean)
      .filter((k) => k !== mc && !(chars[k] && typeof chars[k].state === 'string' && chars[k].state.trim()));
  })();
  /* M514: A PERSON WITH NO PAGE GETS ONE. His word: "the people ledger on #story doesn't fill up by itself — I have to
   * rebuild the people". The scribe was asked only "what shifted?" — on a new tale, with "Nothing is written on the
   * character pages yet", and told to write a core "rarely": the people of the opening got a now at most, or nothing,
   * until "Rebuild the people from the pages". Whoever the ledger knows (here, or standing with the main character) with
   * no page at all is named, to be given one now; noNow keeps the rest. */
  const noPage = (() => {
    const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
    const mc = mcKey(state);
    const known = [
      ...(Array.isArray(state && state.present) ? state.present.map((p) => (p && p.name ? p.name : '')) : []),
      ...Object.keys((state && state.relationships && typeof state.relationships === 'object') ? state.relationships : {}),
      ...Object.keys(state?.offscreen || {}), ...Object.keys(state?.knowledge || {}), ...Object.keys(state?.canon || {}),
      ...Object.keys(chars),
    ].map((n) => String(n || '').trim()).filter(Boolean);
    const out = [];
    for (const n of known) {
      const existing = findPersonKey(chars, n);
      if (existing && String(chars[existing]?.core || '').trim()) continue;
      if (mc && (n === mc || findPersonKey({ [mc]: 1 }, n))) continue;
      if (!out.some((o) => findPersonKey({ [o]: 1 }, n))) out.push(n);
    }
    return out;
  })();
  const noNowWithPage = noNow.filter((n) => !noPage.some((o) => findPersonKey({ [o]: 1 }, n)));
  /* M753: WHAT STAYS THE SAME FROM ONE PAGE TO THE NEXT COMES FIRST — the brief, the cast notes, the series, the record, the
   * pages already read — and what changes every page after it. The names owed a page or a now stood first ("the names first,
   * plainly"), so a request whose list had changed parted from the page before's at its first line, and a provider that
   * keeps what it has read of a request's beginning read the whole story again. They stand right before the page now, as
   * plain as before and nearer the task. */
  const owed = [
    ...(noPage.length ? ['NO CHARACTER PAGE YET: ' + noPage.join(', ') + ' \u2014 record only identity facts the originals establish, with no compulsory biography for a temporary participant, and their state if they are in the scene.', ''] : []), /* the names, plainly */
    ...(noNowWithPage.length ? ['IN THE SCENE WITH NO NOW YET \u2014 for each one this page shows, write their state now (what they are doing this minute, from the page): ' + noNowWithPage.join(', '), ''] : []),
  ];
  const user = [
    ...(String(brief || '').trim() ? ['The writer\u2019s brief \u2014 who these people are; it outranks every page:', '"""', writerText(brief, BRIEF_ROOM, 'brief'), '"""', ''] : []),
    ...(String(castNotes || '').trim() ? ['The writer\u2019s cast notes:', '"""', writerText(castNotes, CAST_ROOM, 'cast notes'), '"""', ''] : []),
    /* M386: "written from the REAL RECORD" — handed to it at last (canon verification on, and someone here is canon) */
    ...(String(canonRecord || '').trim() ? ['What the series itself says of its people in this story — their real record. Keep every page true to it (never a made-up family, role or past), but do not repeat it on the pages: the storyteller already reads it from the series itself on every page they are in, and their faces are kept in the ledger\u2019s truths. A page holds what THIS story has made of them — where they are, what they have done and learned here, how they stand — and names the record only where this story departs from it:', '"""', String(canonRecord).trim(), '"""', ''] : []),
    ...(record ? ['The detailed story record:', record] : []),
    ...(() => { const w = windowOfPages(pages, contextBudget); return [...w.shown, ...(w.index.length ? ['Earlier pages available through lookup:', ...w.index] : [])]; })(),
    'Shared scene, relationships, knowledge and elsewhere state:',
    renderWholeLedger(state, { material: String(userText || '') + '\n' + String(assistantText || ''), fetchable: true }), /* M752: the seats this page bears on */
    'Here is what the character pages currently say:',
    ledger,
    ...(profileSources ? [profileSources] : []),
    ...(mcRecord ? ['', mcRecord] : []),
    '',
    ...owed,
    'The writer just wrote:',
    '"""',
    wholePage(userText, 12000),
    '"""',
    '',
    'And the storyteller answered:',
    '"""',
    wholePage(assistantText),
    '"""',
    '',
    'Recover any missing established identity or physical facts, then record what shifted. Fetch originals when needed; preserve valid existing core facts, state, arcs and standings. JSON only.',
  ].join('\n');
  return { system: withFictionFrame(SYSTEM_PROMPT + LEDGER_READER_RULES + SCENE_ENDING_TASK + fetchLaw()), user };
}

/* ---------- the tolerant parser ---------- */

/* Exported for the harness. Fences stripped, first balanced object parsed,
 * deltas kept only if they're objects with a string name, field and text.
 * Any trouble at all resolves to {deltas:[]}. */
export function parseScribeAnswer(raw) {
  try {
    /* M259: read the way every other worker's answer is read (M26/M31) —
     * thinking stripped, up to five candidates, the lenient repair — and a
     * list the wire cut off keeps every note that arrived whole. It took the
     * FIRST brace and parsed it strictly, so a model that thought out loud
     * first, or ran out of room, was read as "nothing shifted". */
    const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    const keep = (list) => (Array.isArray(list) ? list : []).filter(
      (d) => d && typeof d === 'object'
        && typeof d.name === 'string' && d.name.trim()
        && typeof d.field === 'string' && d.field.trim()
        && typeof d.text === 'string' && d.text.trim()
    );
    for (const c of balancedCandidates(text, 5)) {
      const p = parseLenient(c);
      if (p && Array.isArray(p.deltas)) return { deltas: keep(p.deltas), recoveries:Array.isArray(p.recoveries) ? p.recoveries : [], facts:(Array.isArray(p.facts) ? p.facts : []).filter(f => f && typeof f.name === 'string' && typeof f.key === 'string' && typeof f.value === 'string' && typeof f.shown === 'string'),
        entities:(Array.isArray(p.entities) ? p.entities : []).filter(e=>e && typeof e.name === 'string' && ['place','organization','object','group'].includes(e.kind) && typeof e.shown === 'string' && typeof e.cause === 'string') };
    }
    const at = text.search(/"deltas"\s*:\s*\[/);
    if (at !== -1) {
      const inner = text.slice(text.indexOf('[', at) + 1);
      return { deltas: keep(balancedCandidates(inner, 80).map((c) => parseLenient(c)).filter(Boolean)), cut: true };
    }
    return { deltas: [] };
  } catch (err) {
    return { deltas: [] };
  }
}

/* ---------- the provider calls (non-streaming, small, cold) ---------- */

/* ---------- the contract ---------- */

/* Read one finished turn and write what shifted onto the character pages.
 * Resolves {changes, dropped} (possibly both empty), or null when there was
 * nothing to read. Throws ONLY on transport failure — the queue retries;
 * a garbled answer is just {deltas:[]} and merges into nothing. `stale`
 * (from the queue) is checked before anything is written: a turn whose
 * story was left behind teaches the ledger nothing. */
/* The page the applier wrote lands as "<key> — … was noted"; the key is the
 * ledger's own spelling of the name (the persona redirect, a typo mended). */
function nameFromWords(words, fallback) {
  const at = String(words || '').indexOf(' — ');
  return at > 0 ? words.slice(0, at) : String(fallback || '').trim();
}

export async function scribeTurn({ connection, storyId, userText, assistantText, signal, stale, renew, brief = '', castNotes = '', canonRecord = '', pageAt = null, record = '', pages = [], story = null } = {}) {
  if (!connection || typeof connection !== 'object') return null;
  if (!storyId) return null;
  if (!assistantText || !String(assistantText).trim()) return null;

  const before = await loadState(storyId);
  const documents = auditSources({ brief, castNotes, messages: await db.messages.list(storyId) });
  const originals = documents.map(d => d.text).join('\n');
  const writerOriginals = documents.filter(d => /^(brief|cast):/.test(d.id) || d.label.endsWith(', writer')).map(d => d.text).join('\n');
  const budget = scribeBudget(connection);
  const peopleRoom = Math.max(12000, Math.floor(roomChars(connection, budget) * 0.2));
  const bare = buildScribeMessages({ state: before, userText, assistantText, brief, castNotes, canonRecord, record, documents, peopleRoom });
  const prompt = buildScribeMessages({ state: before, userText, assistantText, brief, castNotes, canonRecord, record, pages,
    documents, peopleRoom, contextBudget: viewBudget(connection, budget, bare.system.length + bare.user.length) });
  const call = (options) => askWithFetch(connection, { ...options, renew, leash: leashFor,
    room: roomChars(connection, budget), source: { storyId, story: story || { brief, castNotes } },
    isAnswer: text => /"deltas"\s*:\s*\[/.test(text) });
  /* M28: the one wire path — thinking off per house, temperature 0; a
   * transport failure throws (with retryAfterMs when the house named a wait)
   * and the queue retries. */
  if (typeof renew === 'function') renew(); /* M259: every call gets its own minute (M213) */
  const first = await call({
    system: prompt.system,
    user: prompt.user,
    maxTokens: budget,
    signal,
  });
  let read = parseScribeAnswer(first.text);
  let note = 'ok';
  /* M259: an answer the wire cut, or one that could not be read, is asked for
   * ONCE more — never taken as "nothing shifted" (M246's law, here too). An
   * honest {"deltas":[]} is not asked again. */
  const honestEmpty = /"deltas"\s*:\s*\[\s*\]/.test(String(first.text || ''));
  /* cut = the wire said so, or the answer itself stops mid-list (a house that
   * never reports a finish reason still cuts) */
  const wasCut = first.finishReason === 'length' || Boolean(read.cut);
  if (wasCut || (!read.deltas.length && !honestEmpty)) {
    try {
      if (typeof renew === 'function') renew();
      const again = await call({
        system: prompt.system,
        user: prompt.user + '\n\n' + (wasCut
          ? 'Your last answer ran out of room before it ended. Answer again, complete and concise, with all necessary identity deltas and physical facts. Preserve the full established cores. JSON only.'
          : 'Your last answer was not a JSON object with a "deltas" list. Answer with the JSON object only.'),
        maxTokens: budget,
        signal,
      });
      const second = parseScribeAnswer(again.text);
      /* M681 (the books audit's B10): whole = an answer at all (a "deltas" list), not cut by the wire, not stopping mid-list */
      const secondWhole = again.finishReason !== 'length' && !second.cut && /"deltas"\s*:\s*\[/.test(String(again.text || ''));
      /* M681 — THE WHOLE ANSWER TO THE RE-ASK IS KEPT (B10, made to happen on m680-001). The re-ask asks for "the changes that
       * matter most, at most twelve" — so its whole answer is often SHORTER than what arrived of the cut one, and it was
       * thrown away for the cut one by that count alone, while the note said "ok". Asked again because the first was cut,
       * a whole answer stands entire; the notes of the cut one that arrived whole and speak of something it does not (a
       * person's field it left out) stand beside it — every note that arrived whole is kept. */
      if (wasCut && secondWhole) {
        const said = new Set(second.deltas.map((d) => d.name.trim().toLowerCase() + '|' + d.field.trim().toLowerCase()));
        read = { deltas: [...second.deltas, ...read.deltas.filter((d) => !said.has(d.name.trim().toLowerCase() + '|' + d.field.trim().toLowerCase()))], facts:[...(second.facts || []),...(read.facts || [])],entities:second.entities || read.entities || [],recoveries:second.recoveries || [] };
      } else if (second.deltas.length > read.deltas.length || (secondWhole && second.deltas.length >= read.deltas.length)) read = second;
      note = secondWhole ? 'ok' : 'cut short';
    } catch (err) {
      if (!read.deltas.length) throw err;
      note = wasCut ? 'cut short' : 'ok';
    }
  }
  const { deltas } = read;

  if (stale && stale()) return null; /* the writer has moved on — discard */

  /* Re-read at write time — the ledger may have been touched by hand while
   * the scribe was reading. M753: inside the ledger's turn — the world agent may be writing beside it */
  const giveBack = await ledgerTurn(storyId);
  try {
  const fresh = await loadState(storyId);
  const entities = (read.entities || []).flatMap(e=>{
    const shown = quotedSource(originals,e.shown);
    return shown && exactNameIn(shown,e.name) ? [{type:'people.reclassify',name:e.name,kind:e.kind,cause:e.cause,shown,evidence:shown,source:'scribe',entityReviewed:true}] : [];
  });
  const excluded = name => entities.some(e=>e.name.trim().toLowerCase() === String(name || '').trim().toLowerCase());
  /* M72: every delta is a journaled write (people.note) — the fold used to
   * lose the scribe's pages because they were merged past the journal. The
   * merge laws are the applier's now (engine/apply.js → mergeDeltas). */
  /* M130: one writer per now — a 'state' line for a person who is elsewhere
   * (seated by the world agent, not present) is dropped; the seat is their now */
  /* M398: here and seated by the one matcher — the scribe's "now" for Rukia Kuchiki, in the scene as "Rukia", was
   * dropped as if she were elsewhere */
  /* M412: ONE WRITER PER NOW, BOTH WAYS. The world agent may write a now only for someone here the page does not show
   * (M401, in code); the scribe's mirror law was only in words. A now the scribe writes for someone here whom neither
   * this page nor his message mentions is theirs to lose to nothing the page said — it is the world agent's, and the
   * scribe's is let go here (the same shape of fault as M411's tidy: a later writer undoing the simulation). */
  const pageWords = String(userText || '') + '\n' + String(assistantText || '');
  const shownOnPage = (name) => nameOnPage(pageWords, name); /* M414: the one answer — never a title or "the" */
  const kept = deltas.filter(d => !(d.field === 'state' && !isHere(fresh, d.name) && !isMc(fresh, d.name)))
    .filter(d => !(d.field === 'state' && !isMc(fresh, d.name) && !shownOnPage(d.name)
      && !(findPersonKey(fresh.characters || {}, d.name) && shownOnPage(findPersonKey(fresh.characters || {}, d.name)))
      && !quotedSource(pageWords, d.shown)));
  /* M648: who someone is, is added to — never thinned (people.js thinsCore) */
  const thinned = [];
  const identityWords = originals + '\n' + canonRecord;
  const sound = kept.filter((d) => {
    if (excluded(d.name)) return false;
    if (!isMc(fresh, d.name) && !placeholderIn({ type: 'people.note', name: d.name }) && !findPersonKey(fresh.characters || {}, d.name) && !exactNameIn(identityWords, d.name)) {
      thinned.push({ delta: { type: 'people.note', ...d }, why: 'the new name is not written in the source; keep its exact spelling' });
      return false;
    }
    const owner = findPersonKey(fresh.characters || {}, d.name);
    const field = ['thread', 'unthread'].includes(d.field) ? 'threads' : d.field;
    if (owner && fresh.characters[owner]?.hand?.[field]) { thinned.push({ delta: d, why: 'the writer explicitly controls this field' }); return false; }
    if (isMc(fresh, d.name) && d.field === 'core' && !quotedSource(writerOriginals, d.shown)) {
      thinned.push({ delta: d, why: 'player biography needs original writer facts' }); return false;
    }
    /* M648, kept under M719's additive notes: an addition to who someone is is a supported fact. A note with no original
     * words behind it that says less than the nature standing ("a girl", a nature turned gentle) is a worker restating
     * them thinner, not an addition — appended, it would sit in their core as drift. Who they are stands as written. */
    if (String(d.field).trim().toLowerCase() === 'core' && owner && !quotedSource(originals, d.shown) && thinsCore(fresh.characters[owner].core, d.text)) {
      thinned.push({ delta: { type: 'people.note', name: d.name, field: 'core', text: d.text }, why: 'who ' + owner + ' is stands as written — a nature is added to, never thinned to “' + String(d.text).trim().slice(0, 60) + '”' });
      return false;
    }
    return true; // Core notes merge additively at the durable write boundary.

  });
  /* M680: its notes are this page's — stamped with the page in hand even when the page reader's call failed (the world audit) */
  const stamped = Number.isInteger(pageAt) && pageAt >= 0 ? { ...fresh, page: pageAt } : fresh;
  const facts = [];
  if (read.facts?.length) {
    for (const fact of read.facts) {
      if (excluded(fact.name)) continue;
      const name = findPersonKey(fresh.characters || {},fact.name) || fact.name;
      const key = findCanonKey(fresh.canon || {},name);
      const held = key && findFact(fresh.canon[key],fact.key)?.entry;
      const quote = quotedSource(originals,fact.shown);
      const manual = [...(fresh.journal || [])].reverse().find(e => e.m?.byHand && /^canon\.(lock|unlock)$/.test(e.m.type)
        && samePersonName(e.m.name, name) && lookKey(e.m.key) === lookKey(fact.key));
      if (manual) continue;
      if (!quote || (!isMc(fresh, fact.name) && !findPersonKey(fresh.characters || {}, fact.name) && !exactNameIn(originals,fact.name))) continue;
      if (held && (held.value.trim().toLowerCase() === fact.value.trim().toLowerCase()
        || fact.replaces !== held.value || !String(fact.cause || '').trim())) continue;
      facts.push({type:'canon.lock',name,key:fact.key,value:fact.value,shown:quote,evidence:quote,source:'scribe',cause:fact.cause || 'People recovered an established physical fact from the original sources'});
    }
  }
  if (stale && stale()) return null;
  const mutations = sound.map(d => {
    const writerCore = isMc(fresh, d.name) && d.field === 'core';
    const quote = quotedSource(writerCore ? writerOriginals : originals, d.shown);
    return { type: writerCore ? 'people.set' : 'people.note', name: d.name, field: d.field, text: d.text,
      source: 'scribe', cause: typeof d.cause === 'string' ? d.cause : '', evidence: quote, shown: quote,
      ...(writerCore ? { writerEstablished: true, append:true } : {}) };
  });
  const { state: next, applied, rejected } = applyMutations(stamped, [...entities,...mutations,...facts]);
  const changes = applied.map((a) => ({ name: nameFromWords(a.words, a.mutation.name), field: a.mutation.field }));
  const dropped = [...rejected.filter(r=>!r.same).map((r) => ({ delta: r.mutation, why: r.why, recoverable:r.recoverable === true })), ...thinned];
  const recovery = retainPeopleFailures(next,documents,dropped,read.recoveries);
  const recoveryChanged = JSON.stringify(recovery) !== JSON.stringify(fresh.peopleRecovery || []);
  if (recoveryChanged) next.peopleRecovery = recovery;
  if (!changes.length && !recoveryChanged) return { changes, dropped, note, pending:recovery, unfinished:note !== 'ok' || recovery.length > 0 };
  if (stale && stale()) return null;
  await saveState(storyId, stamped !== fresh ? { ...next, page: fresh.page } : next); /* M680: the ledger's own stamp is not the scribe's to move */
  giveBack();
  notify(storyId);
  return { changes, dropped, note, pending:recovery, unfinished:note !== 'ok' || recovery.length > 0 };
  } finally { giveBack(); } /* M753: the ledger's turn goes back however the write ends */
}
