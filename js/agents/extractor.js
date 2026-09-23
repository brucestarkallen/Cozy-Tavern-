/* Cozy Tavern — agents/extractor.js
 * The extractor: a quiet background worker that reads each finished page —
 * what the writer wrote and what the storyteller answered — and proposes
 * scene-state mutations in the closed v1 vocabulary. It runs AFTER the
 * stream completes, never on the critical path, and it never throws into
 * the chat path: any failure, any garbled answer, resolves {mutations:[]}.
 *
 * Contract (SPEC.md M3, extended by M4):
 *   extractTurn({connection, state, userText, assistantText, signal})
 *     -> {mutations:[...]} | {mutations:[]} on any failure
 *
 * M4 widened the vocabulary (v2): the body ledger, the standings between
 * people, and the off-screen world. The conservatism law is restated in the
 * prompt — only what the prose explicitly shows; injuries only when the blow
 * lands on-page; feelings shift only from on-page acts; never invent
 * off-screen activity for characters the prose doesn't mention.
 *
 * M28: the call rides agents/call.js — the same providers the storyteller
 * uses, thinking explicitly OFF per house, temperature 0 — and the tolerant
 * parser reads the answer. (Before M28 this file carried its own two
 * fetches that never disabled thinking; on a reasoning model the budget
 * went to thought and the ledger starved.) The extractor also knows who the
 * main character is now, and founds a young ledger instead of asking
 * "what changed?" of a page that is the whole world so far.
 *
 * Also living here: the in-flight tracker. chat.js notes each piece of
 * background work it fires; the send path awaits pendingWork(storyId, 5000)
 * before assembling the next request, so state is consistent without prose
 * ever waiting on the workers (the latency law, SPEC.md M3). M6 widened the
 * chain (extractor → memory keeper → continuity check): noteWork tracks
 * every link, and pendingWork gives EACH link its own hard five seconds —
 * first overrun, the send simply proceeds with last-good state (the chain
 * is ordered, so a late link means the later links can't land in time).
 * The M3 names (noteExtraction / pendingExtraction) remain as aliases —
 * they were the published contract. */

import { writerText, BRIEF_ROOM, CAST_ROOM } from '../engine/whole.js'; /* M283 */
import { nameOnPage } from '../engine/names.js'; /* M402: silence is not leaving; M414: named by the one answer */
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { callWorker } from './call.js'; /* M28: the one wire path for workers */

import { renderWholeLedger, wholePage } from '../engine/whole.js'; /* M259: the whole ledger, and the page read to its end */
import { askWithFetch, fetchLaw, windowOfPages, roomChars, viewBudget, leashFor } from './lookup.js'; /* M259/M261: it may look; the story so far, whole */
import { mcName } from '../engine/duels.js';

/* M28: the answer is JSON only and thinking is OFF on the wire (call.js),
 * so the budget is the answer's — 1200 tokens holds a long founding read
 * with room to spare. (M26's 2000 was a bandage over thinking models
 * spending the budget on thought; the wire now tells them not to.) */
const MAX_TOKENS = 2400; /* M37: room for a long founding even if a house thinks a little anyway */

/* ---------- the in-flight tracker (the send path's courtesy wait) ---------- */

const inFlight = new Map(); // storyId -> Promise[]

/* Note a piece of background work just fired. The promise's own fate is
 * swallowed here — the tracker only cares when it settles. */
export function noteWork(storyId, promise) {
  if (!storyId || !promise || typeof promise.then !== 'function') return;
  let list = inFlight.get(storyId);
  if (!list) { list = []; inFlight.set(storyId, list); }
  list.push(promise);
  const settle = () => {
    const at = list.indexOf(promise);
    if (at !== -1) list.splice(at, 1);
    if (!list.length && inFlight.get(storyId) === list) inFlight.delete(storyId);
  };
  promise.then(settle, settle);
}

/* Await each piece of background work in flight for this story, in order —
 * each gets its own hard timeout; on the first overrun we stop waiting and
 * go on with last-good state. Never rejects. Resolves true when everything
 * settled in time, false when nothing was pending or something overran. */
export async function pendingWork(storyId, timeoutMs = 5000) {
  let any = false;
  for (;;) {
    const list = inFlight.get(storyId);
    if (!list || !list.length) return any;
    any = true;
    const promise = list[0];
    let timer = null;
    const done = await Promise.race([
      promise.then(() => 'settled', () => 'settled'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); }),
    ]);
    clearTimeout(timer);
    if (done === 'timeout') return false;
  }
}

/* The M3 names, kept: an extraction noted is one link of work; awaiting an
 * extraction is awaiting the chain. */
export function noteExtraction(storyId, promise) {
  noteWork(storyId, promise);
}

export async function pendingExtraction(storyId, timeoutMs = 5000) {
  return pendingWork(storyId, timeoutMs);
}

/* ---------- the prompt (human-voiced, kept in the code) ---------- */

const VOCABULARY = [
  'mc.set {"type":"mc.set","name":"MAIN CHARACTER"} — ONLY when the ledger does not yet know the main character: the one person the writer plays or narrates as their own',
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30} — only when the prose states or clearly fixes the time',
  'place.set {"type":"place.set","name":"the chapel"} — the ground the scene stands on, only when first named or it truly moves',
  'clock.advance {"type":"clock.advance","minutes":30,"reason":"the walk to the chapel"} — when time clearly passes; minutes is a number',
  'presence.enter {"type":"presence.enter","name":"NAME","position":"by the fire","attire":"a travel cloak"} — position and attire only if shown',
  'presence.leave {"type":"presence.leave","name":"OTHER NAME"} — ONLY when the page SHOWS them leaving (walks out, is carried off, vanishes); someone the page does not mention is quiet, not gone, and stays',
  'presence.update {"type":"presence.update","name":"NAME","position":"at the window"} — when someone present moves or changes dress',
  /* M256: WHO KNOWS WHAT, FOR THE PEOPLE IN THE ROOM. knowledge.add appeared
   * NOWHERE in this file. The world agent has it, but the world agent is
   * about the ABSENT — so a thing witnessed by someone standing right there
   * was written down by NOBODY, and the auditor picked it up three turns
   * later, one person at a time, which is what the writer kept seeing in his
   * audit reports ("no knowledge line for Claire Stone, who plainly
   * witnessed…"). The worker READING THE PAGE is the one that should write
   * it. */
  /* M258: AND THE THREADS IT WATCHED RESOLVE. thread.close appeared nowhere
   * in this file either — the world agent has it, and the world agent is
   * about the ABSENT. So a question answered, a plan abandoned, a promise
   * kept ON THIS PAGE could be closed by nobody, and the auditor found three
   * of them at once in the writer's own tale: Chloe's clip abandoned,
   * Aurora's message delivered, Caleb's frame posted — every one still
   * burning in the ledger, read to the storyteller every turn as something
   * still hanging. */
  'thread.close {"type":"thread.close","title":"the title as the ledger holds it"} — a story thread THIS page resolved: the question answered, the plan abandoned, the promise kept, the thing found. Use the title the ledger shows, worded as it stands (each title is quoted on the thread list).',
  'knowledge.add {"type":"knowledge.add","name":"NAME","fact":"that Jovan lived in England"} — when someone in the scene LEARNS something that could matter later: a secret told, a name heard, a lie caught, a thing seen they were not meant to see. Only what THIS page put in front of them, and only where being told, or not told, could change what they do.',
  'mode.snapshot {"type":"mode.snapshot","flags":["travel"]} — THE WHOLE BOARD, EVERY PAGE: every mood that holds at the END of this page, from: combat (a fight is on), intimate (sex or intimate touch is on), travel (in transit — a car, a train, a road; NOT once they have arrived and stepped out), socialField (a crowded public place full of voices), isolation (alone, far from help), group (in company of several). Anything you do not name is cleared. An empty list clears them all.',
  'body.injure {"type":"body.injure","name":"NAME","what":"left forearm fractured","sev":2,"treated":false} — only when a blow lands on-page; sev is 1 (a graze), 2 (a real wound), or 3 (severe); treated only if someone tends it on-page',
  'body.strain {"type":"body.strain","name":"NAME","what":"the long climb"} — weariness short of injury, when the prose shows it',
  'body.heal {"type":"body.heal","name":"NAME","what":"forearm"} — only when the prose says a known hurt has healed',
  'rel.shift {"type":"rel.shift","name":"OTHER NAME","axis":"p","delta":8,"cause":"she bandaged his hand without being asked"} — feelings toward the main character only; axis is p (warmth), r (romantic pull), or s (sensual charge); delta a small number, -20 to +20; cause REQUIRED, quoting the on-page beat that earned it',
  'rel.set {"type":"rel.set","name":"OTHER NAME","p":40,"cause":"the brief says they grew up together"} — rarely: only when the prose itself states where a standing starts, never as a guess',
  'offscreen.set {"type":"offscreen.set","name":"NAME","location":"the chapel","activity":"lighting candles for the dead","agenda":"meaning to warn the abbot"} — only for a named character the prose shows leaving or shows elsewhere; never invent off-screen doings for someone the prose doesn’t mention',
  'offscreen.clear {"type":"offscreen.clear","name":"NAME"} — when the prose says an elsewhere note no longer holds',
].join('\n');

/* M53: the writer's own law of the standings, given to the reader whole — it
 * had one line ("p warmth, r romantic pull, s sensual charge") and nothing
 * about WHEN a standing moves, so it docked R for a playful "don't waste
 * this one" and never moved P through a night of intimacy. */
const STANDINGS_LAW = [
  'THE STANDINGS (rel.shift). Each named person carries three INDEPENDENT axes toward the main',
  'character, -100..+100: P = warmth and trust (friendship, respect, comfort; negative = dislike,',
  'contempt, distrust); R = romantic pull (attachment, longing, wanting MORE of him, jealousy;',
  'negative = romantic aversion, not "wants less commitment"); S = sexual desire (physical want,',
  'tension; negative = repulsion). They move independently: R can climb while P drops, S without R,',
  'P high with the others at zero. A stranger starts at 0/0/0 and moves only by what the page shows.',
  'SCORES MOVE ON REVELATION: a standing moves ONLY when the page reveals something NEW about the main',
  'character or the bond, read through that person\'s own nature — never on the beat\'s pleasantness',
  'and never on your reading of what she "really" thinks. A public defeat can raise R (he didn\'t defer',
  'to me); a gift can drop P (he\'s buying me); a cruel truth can raise P (he didn\'t lie). No revelation,',
  'no movement — flat is the default. Typical ±1–5; a major moment ±10–20.',
  'DISPOSITION NOT MOOD: the standing is the climate, the scene\'s emotion is the weather. Fear FOR him,',
  'worry, grief at his pain, embarrassment on his behalf are SYMPTOMS of warmth — they never subtract.',
  'Only fear OF him, disgust AT him, betrayal BY him lower P. A boundary or a limit she states ("can\'t',
  'see you next weekend", "this is a weekend thing") is a FACT about the bond, not a minus: it lowers R',
  'only if the page shows she wants LESS than she did before; said playfully, or while wanting him',
  'now, it moves nothing — or moves S. Intimacy: S rises with wanting shown; P rises with trust shown',
  '(letting him in, staying after, being unguarded); R rises with attachment shown (wanting more,',
  'longing, jealousy) — each only where the page shows it, none mechanically. Charm from the main',
  'character is not a cause; an NPC who feels handled drops while smiling.',
].join('\n');

/* The standing law of the ledger. M28: it is built per turn now, because two
 * things it says depend on the ledger's age and what it knows — who the
 * main character is, and whether an empty answer is honest. */
function systemPrompt({ mc, founding }) {
  const who = mc
    ? `The main character — the one the writer plays — is ${mc}. Feelings (rel.*) are always toward ${mc}.`
    : 'The ledger does not yet know the main character\'s name. The writer plays or narrates one person as their own — the one whose actions the writer types, the one the story follows. Name them with mc.set (once), and treat rel.* feelings as feelings toward that person.';
  const law = founding
    ? [
      'THE LEDGER IS YOUNG — nothing is written in it yet. Found it from these pages. If the page opens',
      'with a bracketed header line — [Place — Day, Month DD, Year | HH:MM | weather | attire | position] —',
      'that line is the truth for place.set and clock.set (all five numbers are in it), and the attire',
      'and position are the main character\'s (presence.enter with them):',
      '  - place.set for the ground the scene stands on (a booth at McDonald\'s, a chapel, a train car — the place the prose puts them);',
      '  - presence.enter for EVERY person the pages put in the scene, the main character included, with position/attire only if shown;',
      '  - clock.set only if the pages fix a date and hour (never guess a date; if only the hour is known, leave the clock alone);',
      '  - mc.set if the main character is not yet known;',
      '  - mode.set for a mood the pages plainly show (socialField for a crowded public place, intimate, combat, travel, group).',
      'On a young ledger an empty answer is almost always wrong: the scene exists, so someone is somewhere. Write the founding down.',
    ].join('\n')
    : [
      'If the page opens with a bracketed header line — [Place — Day, Month DD, Year | HH:MM | weather |',
      'attire | position] — it is the truth for the hour (clock.set when the date or hour differs from',
      'the ledger), the ground (place.set when it moved), and the main character\'s attire and position.',
      '',
      'BEFORE YOU ANSWER, THE FOUR MOST OFTEN MISSED (M256 — every one of these',
      'was found by the auditor three turns late, in the writer\'s own tale):',
      '  1. THE GROUND MOVED. The ledger holds it on its "The ground:" line. A page',
      '     that opens with a header line has its place written in code; on a page',
      '     with none, if the scene now stands somewhere else — a gate, a kitchen,',
      '     one house further down the lane — place.set.',
      '  2. SOMEONE PRESENT MOVED WITHIN IT. Reaching a gate, a hand on a latch,',
      '     crossing to the window: presence.update. Their old position is a lie',
      '     until you write the new one.',
      '  3. SOMEONE LEARNED SOMETHING. Anyone standing there who heard the answer,',
      '     saw the handshake, caught the lie: knowledge.add, for each of them.',
      '  4. WHAT THE PAGE ANSWERED. A question asked and answered, a promise kept,',
      '     a plan abandoned — thread.close, the title exactly as the ledger quotes it.',
      'THE LEDGER ABOVE IS ALL OF IT — every standing, thread, line of who knows what',
      'and seat. A fact someone already knows, in any words, is not written again.',
      'ONLY THE NEW PAGE IS NEWS: the pages before it are already in the ledger. A beat the',
      'standings\' latest causes already name is already counted.',
      'Be conservative. Write down only what the prose explicitly shows — never what it',
      'merely hints at, never what might be true. Injuries only when the blow lands',
      'on-page; feelings shift only from on-page acts, and every shift needs its cause',
      'in words; never invent off-screen activity for characters the prose doesn\'t',
      'mention; when unsure, omit. Time moves only when the prose says it moved. If',
      'nothing changed, return {"mutations":[]} — an empty list is a good and honest',
      'answer on a settled ledger.',
    ].join('\n');
  return [
    'You keep the ledger for a slow, warm story told between two writers. After each',
    'page is finished, you read it and note — in small, exact changes — what shifted',
    'in the scene: the hour, the ground, who is present, the mood of the room, who',
    'was hurt, how the people involved feel about the main character, and where the',
    'absent have gone.',
    '',
    who,
    '',
    'Answer with JSON ONLY, in exactly this shape:',
    '{"mutations":[ ... ], "resolved":[ ... ]}',
    '"resolved" holds the exact titles of the OPEN THREADS (listed under the page) that THIS page',
    'resolved — the question answered, the plan carried out or abandoned, the promise kept, the thing',
    'found, the decision made. A thread the page only moved is not resolved. [] when none was.',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    STANDINGS_LAW,
    '',
    'THE MOOD IS STATED WHOLE, EVERY PAGE: include one mode.snapshot naming every mood that holds at',
    'the end of this page — a mood you leave out is cleared. A man who has stepped out of the car is',
    'not in transit; a room that emptied is not a social field; a fight that ended is not combat.',
    '',
    law,
    'Names keep the exact spelling the prose uses. No commentary, no markdown fences,',
    'no trailing words: the JSON object only.',
    'A WINDOW IS ELSEWHERE: everything after a line reading *** The World Beyond *** is a cut to',
    'another place — the people in it are NOT in the scene. Never presence.enter them; the world',
    'agent seats them. Only the prose BEFORE the window is the scene.',
    'WHOSE AND WHO (M372): when a line says who called whom, whose phone rang, who gave what to whom, take it',
    'from what the pages before this one established — the phone in her hand is her phone even where a line',
    'only says "the phone"; a call that comes again to the phone she just declined comes to HER, and reaches',
    'someone else only if she hands it over. An ambiguous line is read the way the sequence makes plain, and',
    'never guessed toward the main character.',
    'PLACEHOLDERS: NAME, OTHER NAME, NEW NAME, NAME SURNAME and MAIN CHARACTER in the examples above are placeholders, never people — never write them; write only the names the ledger, the brief and the pages use.',
  ].join('\n');
}

/* Exported for the harness: the two messages any provider flavor receives. */
export const EXTRACTOR_LOOKS = 2;
export function buildExtractorMessages({ state, userText, assistantText, before = [], founding, brief = '', castNotes = '', record = '', pageNumber = 0, contextBudget = Infinity }) {
  /* founding: passed explicitly by the send path (it already knows), else
   * read off the ledger's own youth. */
  if (typeof founding !== 'boolean') founding = isYoungLedger(state);
  const facts = renderWholeLedger(state) || 'Nothing is written in the ledger yet.'; /* M259 */
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  const onNow = Object.entries((state && state.mode) || {}).filter(([, v]) => v).map(([k]) => k);
  const FENCE = '"""';
  const user = [
    'Here is what the ledger currently says:',
    facts,
    'Moods on the board right now: ' + (onNow.length ? onNow.join(', ') : 'none') + ' — restate the whole board with mode.snapshot.',
    '',
    ...(brief && String(brief).trim()
      ? ['What this story is about, in the writer\'s words:', FENCE, writerText(brief, BRIEF_ROOM, 'brief', true), FENCE, ''] /* M283 */
      : []),
    ...(castNotes && String(castNotes).trim()
      ? ['Who is in it, in the writer\'s words:', FENCE, writerText(castNotes, CAST_ROOM, 'cast notes', true), FENCE, ''] /* M283 */
      : []),
    /* M226: THE STORY BEFORE THE PAGES IT CAN SEE. The extractor writes the
     * ledger from the newest page and the four before it — eight on a deep
     * read — and was NEVER given the record. So on a hundred-page tale
     * everything older than eight pages was invisible to the one worker that
     * decides who is present, where they are, and what is true: it could
     * "discover" a person the story has known for eighty pages, or miss that
     * a thread it sees opening was closed long ago. The folded record is what
     * the storyteller reads in place of those pages; the extractor reads it
     * too now. */
    ...(record && String(record).trim()
      ? ['The story so far, folded — what the pages before these ones hold:', FENCE, String(record).trim(), FENCE, '']
      : []),
    ...(before.length
      ? (() => {
        /* M261: whole, newest first, into the room; the rest by number */
        const w = windowOfPages(before, contextBudget);
        return [
          'The pages just before this one — ALREADY READ. Nothing on them is news and nothing on them is yours to write; they are here so you know who is who, what was promised and where things stand:',
          FENCE, w.shown.join('\n\n') || '(none fit — fetch them by number)', FENCE,
          ...(w.index.length ? ['Earlier pages not shown above (fetch any by its number):', ...w.index] : []),
          '',
        ];
      })()
      : []),
    'The writer just wrote:',
    '"""',
    wholePage(userText, 12000),
    '"""',
    '',
    ...(Number.isInteger(pageNumber) && pageNumber > 0 ? ['(The storyteller\'s page below is page ' + pageNumber + ' of the story; every earlier page can be fetched by its number.)'] : []),
    'And the storyteller answered:',
    '"""',
    wholePage(assistantText),
    '"""',
    '',
    ...(!founding ? openThreadsBlock(state) : []),
    founding ? 'Found the ledger from these pages. JSON only.' : 'What changed, if anything? JSON only.',
  ].join('\n');
  return { system: withFictionFrame(systemPrompt({ mc, founding }) + '\n\n' + fetchLaw({ rounds: EXTRACTOR_LOOKS, when: 'Look only when THIS page leans on something you were not shown — a person, a promise or a place from an earlier page, a name the brief defines further on. Most pages need no look.' })), user, founding, mc };
}

/* M280: THE OPEN THREADS, EACH TO BE DECIDED. Closing a thread the page
 * resolved was item four of a checklist, under "be conservative" — and a
 * thread resolved over a few pages stayed open until the auditor, reading
 * several at once, closed five in one reading. The page reader is handed the
 * open threads by name and answers, in their own slot, which this page
 * resolved. */
export function openThreadsBlock(state) {
  const threads = (state && Array.isArray(state.threads) ? state.threads : [])
    .filter((t) => t && typeof t === 'object' && typeof t.title === 'string' && t.title.trim());
  if (!threads.length) return [];
  return [
    'OPEN THREADS — decide each against THIS page; the titles of the ones it resolved go in "resolved":',
    ...threads.map((t, i) => (i + 1) + '. \u201c' + t.title.trim() + '\u201d' + (t.owner ? ' (' + t.owner + ')' : '')
      + (t.next ? ' \u2014 next: ' + String(t.next).trim() : '') + (t.heat === 'cold' ? ' [cold]' : '')),
    '',
  ];
}

/* M28: a ledger is young when it has no ground and nobody in it — the same
 * test the founding read (M27) uses in chat.js. One home for it. */
export function isYoungLedger(state) {
  return !(state && state.place) && !((state && state.present) || []).length;
}

/* ---------- the tolerant parser ---------- */

/* Exported for the harness. Fences stripped, first balanced object parsed,
 * mutations kept only if they're objects with a string type — the rest of
 * the validation is the applier's job (engine/apply.js). Any trouble at all
 * resolves to {mutations:[]}. */
export function parseExtractorAnswer(raw) {
  try {
    /* M26: reasoning models think out loud first — and their thinking often
     * contains braces, which used to steal the first-balanced-object parse
     * and silently starve the ledger. Thinking spans are stripped, then up
     * to five balanced candidates are tried until one holds a mutations list. */
    let text = String(raw || '');
    text = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    const candidates = balancedCandidates(text, 5);
    let parsed = null;
    for (const c of candidates) {
      /* M31: strict, then the repair pass (comments, trailing commas, raw
       * newlines in strings) — a cheap model's usual slips. */
      const p = parseLenient(c);
      if (p && Array.isArray(p.mutations)) { parsed = p; break; }
    }
    if (!parsed && candidates[0]) parsed = parseLenient(candidates[0]);
    if (!parsed) return { mutations: [], note: 'unusable' };
    const list = Array.isArray(parsed.mutations) ? parsed.mutations : [];
    const mutations = list.filter(
      (m) => m && typeof m === 'object' && typeof m.type === 'string' && m.type.trim()
    );
    /* M280: each title the page resolved closes its thread (once) */
    const closing = new Set(mutations.filter((m) => m.type === 'thread.close').map((m) => String(m.title || m.name || '').trim().toLowerCase()));
    for (const title of (Array.isArray(parsed.resolved) ? parsed.resolved : [])) {
      const t = typeof title === 'string' ? title.trim() : (title && typeof title.title === 'string' ? title.title.trim() : '');
      if (!t || closing.has(t.toLowerCase())) continue;
      closing.add(t.toLowerCase());
      mutations.push({ type: 'thread.close', title: t });
    }
    return { mutations, note: mutations.length ? 'ok' : 'empty' };
  } catch (err) {
    return { mutations: [], note: 'unusable' };
  }
}

/* ---------- the contract ---------- */

/* Read one finished turn and propose mutations.
 *
 * M28: transport failures THROW — the workers' queue retries them with
 * backoff (honoring Retry-After) and writes one plain word on the workers
 * line. What never throws: an answer we can't use, which resolves
 * {mutations:[], note:'unusable'} so the drawer can say so. A missing
 * connection or an empty page resolves {mutations:[], failed:true}. */
/* M402: SILENCE IS NOT LEAVING. Kyōraku stood at the rail of the very courtyard the scene was in; a page that did not
 * name him was read as him leaving, and the ledger said "elsewhere — last seen at 10th Division HQ, training
 * courtyard", the scene's own ground. The page reader may take someone out of the scene only when the page (or his
 * message) names them — a departure is written about the person who departs; someone the page never mentions is
 * simply quiet, and stays (the world agent keeps them alive, M401). Held in code, whatever the model answered. */
export function leavesTheyWereShown(mutations, text) {
  /* M414: named by the one answer (engine/names.js nameOnPage) — a title or "the" is not the name, "Ed" is */
  return (Array.isArray(mutations) ? mutations : []).filter((m) => !(m && m.type === 'presence.leave' && !nameOnPage(text, m.name)));
}

export async function extractTurn(args = {}) {
  const read = await extractTurnRead(args);
  if (read && Array.isArray(read.mutations)) read.mutations = leavesTheyWereShown(read.mutations, String(args.userText || '') + '\n' + String(args.assistantText || ''));
  return read;
}

async function extractTurnRead({ connection, state, userText, assistantText, before = [], founding, brief = '', castNotes = '', record = '', signal, renew, storyId = '', story = null, pageNumber = 0 } = {}) {
  if (!connection || typeof connection !== 'object') return { mutations: [], failed: true };
  if (!assistantText || !String(assistantText).trim()) return { mutations: [], failed: true };
  const young = typeof founding === 'boolean' ? founding : isYoungLedger(state);
  /* M259: THE RECORD RIDES. chat.js has handed it over since M226; this line
   * dropped it on arrival, so the extractor never once saw it. */
  const bare = buildExtractorMessages({ state, userText, assistantText, before: [], founding: young, brief, castNotes, record, pageNumber });
  const contextBudget = viewBudget(connection, MAX_TOKENS, bare.system.length + bare.user.length);
  const prompt = buildExtractorMessages({ state, userText, assistantText, before, founding: young, brief, castNotes, record, pageNumber, contextBudget });
  /* M31: an answer we can't use, or a founding that came back empty, earns
   * ONE second ask with a sharper word — here, not five blind retries in
   * the queue. The raw answer rides out so the drawer can show it. */
  let user = prompt.user;
  let last = null;
  /* M163: THE BEST READING IS KEPT. The sharper second ask (a missing
   * mode.snapshot, an empty founding, an unusable answer) replaced whatever
   * came first — so a page the extractor had read WELL, and was only asked
   * to add one mood line to, lost its whole reading when that second call
   * stumbled on the wire or came back as prose. The ledger got nothing for
   * that page. Whatever we already understood stands unless the re-ask
   * improves on it. */
  let best = null;
  const better = (a, b) => {
    if (!b) return a;
    if (!a) return b;
    const rank = (r) => (r.note === 'ok' ? 2 : r.note === 'empty' ? 1 : 0);
    if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a;
    return b.mutations.length >= a.mutations.length ? b : a;
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let read;
    try {
      /* M259: every call gets its own minute (M213), and it may look */
      const { text, finishReason } = await askWithFetch(connection, {
        system: prompt.system,
        user,
        maxTokens: MAX_TOKENS,
        signal,
        renew,
        leash: leashFor,
        room: roomChars(connection, MAX_TOKENS),
        rounds: attempt === 0 ? EXTRACTOR_LOOKS : 1,
        isAnswer: (t) => { const r = parseExtractorAnswer(t); return r.note === 'ok' || r.note === 'empty'; },
        source: { storyId, story: story || { brief, castNotes } },
      });
      read = parseExtractorAnswer(text);
      read.raw = text;
      if (finishReason === 'length') read.note = read.mutations.length ? read.note : 'cut short';
    } catch (err) {
      /* M163: a wire that fails on the SECOND ask does not erase the first
       * reading; with nothing yet in hand it still throws, and the queue
       * retries the whole page as it always did. */
      if (best) return best;
      throw err;
    }
    last = read;
    best = better(best, read);
    /* M92: the mood board is owed on EVERY page (mode.snapshot — anything not
     * named is cleared). A page whose answer forgot it leaves yesterday's
     * flags standing — "combat" in a quiet bedroom wakes the wrong rules; the
     * writer saw exactly this on his auditor's report. One sharper ask. */
    if (read.note === 'ok' && attempt === 0 && !read.mutations.some((m) => m && m.type === 'mode.snapshot')) {
      user = prompt.user + '\n\nYour answer named no mode.snapshot. The whole board is owed on every page: add ONE mode.snapshot listing every mood that holds at the END of this page (combat, intimate, travel, socialField, isolation, group — an empty list if none), and keep every other mutation you wrote. JSON only.';
      continue;
    }
    if (read.note === 'ok') return read;
    if (attempt === 0) {
      if (read.note === 'unusable' || read.note === 'cut short') {
        user = prompt.user + '\n\nYour last answer was not a JSON object with a "mutations" list. Answer with the JSON object only — no words before or after it.';
      } else if (read.note === 'empty' && young) {
        user = prompt.user + '\n\nThe ledger is empty and the page has a scene, so an empty list is wrong here. Write the founding: place.set for the ground, presence.enter for every person in the scene (the main character included), mc.set if the main character is not yet known. JSON only.';
      } else {
        return read;
      }
    }
  }
  /* M163: the best of the two, never merely the last. */
  return best || last;
}
