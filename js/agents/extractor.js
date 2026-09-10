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

import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { callWorker } from './call.js'; /* M28: the one wire path for workers */

import { renderStateFacts } from '../engine/state.js';
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
  'mc.set {"type":"mc.set","name":"Jovan"} — ONLY when the ledger does not yet know the main character: the one person the writer plays or narrates as their own',
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30} — only when the prose states or clearly fixes the time',
  'place.set {"type":"place.set","name":"the chapel"} — the ground the scene stands on, only when first named or it truly moves',
  'clock.advance {"type":"clock.advance","minutes":30,"reason":"the walk to the chapel"} — when time clearly passes; minutes is a number',
  'presence.enter {"type":"presence.enter","name":"Mira","position":"by the fire","attire":"a travel cloak"} — position and attire only if shown',
  'presence.leave {"type":"presence.leave","name":"Samantha"} — when someone clearly leaves the scene',
  'presence.update {"type":"presence.update","name":"Mira","position":"at the window"} — when someone present moves or changes dress',
  'mode.snapshot {"type":"mode.snapshot","flags":["travel"]} — THE WHOLE BOARD, EVERY PAGE: every mood that holds at the END of this page, from: combat (a fight is on), intimate (sex or intimate touch is on), travel (in transit — a car, a train, a road; NOT once they have arrived and stepped out), socialField (a crowded public place full of voices), isolation (alone, far from help), group (in company of several). Anything you do not name is cleared. An empty list clears them all.',
  'body.injure {"type":"body.injure","name":"Mara","what":"left forearm fractured","sev":2,"treated":false} — only when a blow lands on-page; sev is 1 (a graze), 2 (a real wound), or 3 (severe); treated only if someone tends it on-page',
  'body.strain {"type":"body.strain","name":"Mara","what":"the long climb"} — weariness short of injury, when the prose shows it',
  'body.heal {"type":"body.heal","name":"Mara","what":"forearm"} — only when the prose says a known hurt has healed',
  'rel.shift {"type":"rel.shift","name":"Samantha","axis":"p","delta":8,"cause":"she bandaged his hand without being asked"} — feelings toward the main character only; axis is p (warmth), r (romantic pull), or s (sensual charge); delta a small number, -20 to +20; cause REQUIRED, quoting the on-page beat that earned it',
  'rel.set {"type":"rel.set","name":"Samantha","p":40,"cause":"the brief says they grew up together"} — rarely: only when the prose itself states where a standing starts, never as a guess',
  'offscreen.set {"type":"offscreen.set","name":"Mira","location":"the chapel","activity":"lighting candles for the dead","agenda":"meaning to warn the abbot"} — only for a named character the prose shows leaving or shows elsewhere; never invent off-screen doings for someone the prose doesn’t mention',
  'offscreen.clear {"type":"offscreen.clear","name":"Mira"} — when the prose says an elsewhere note no longer holds',
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
    '{"mutations":[ ... ]}',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    'THE MOOD IS STATED WHOLE, EVERY PAGE: include one mode.snapshot naming every mood that holds at',
    'the end of this page — a mood you leave out is cleared. A man who has stepped out of the car is',
    'not in transit; a room that emptied is not a social field; a fight that ended is not combat.',
    '',
    law,
    'Names keep the exact spelling the prose uses. No commentary, no markdown fences,',
    'no trailing words: the JSON object only.',
  ].join('\n');
}

/* Exported for the harness: the two messages any provider flavor receives. */
export function buildExtractorMessages({ state, userText, assistantText, before = [], founding, brief = '', castNotes = '' }) {
  /* founding: passed explicitly by the send path (it already knows), else
   * read off the ledger's own youth. */
  if (typeof founding !== 'boolean') founding = isYoungLedger(state);
  const facts = renderStateFacts(state) || 'Nothing is written in the ledger yet.';
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
      ? ['What this story is about, in the writer\'s words:', FENCE, String(brief).trim().slice(0, 1500), FENCE, '']
      : []),
    ...(castNotes && String(castNotes).trim()
      ? ['Who is in it, in the writer\'s words:', FENCE, String(castNotes).trim().slice(0, 1500), FENCE, '']
      : []),
    ...(before.length
      ? ['The pages just before this one:', FENCE, before.map((b) => (b.role === 'user' ? 'The writer: ' : 'The storyteller: ') + String(b.text || '').slice(0, 2000)).join('\n\n'), FENCE, '']
      : []),
    'The writer just wrote:',
    '"""',
    String(userText || '').slice(0, 4000),
    '"""',
    '',
    'And the storyteller answered:',
    '"""',
    String(assistantText || '').slice(0, 8000),
    '"""',
    '',
    founding ? 'Found the ledger from these pages. JSON only.' : 'What changed, if anything? JSON only.',
  ].join('\n');
  return { system: withFictionFrame(systemPrompt({ mc, founding })), user, founding, mc };
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
export async function extractTurn({ connection, state, userText, assistantText, before = [], founding, brief = '', castNotes = '', signal } = {}) {
  if (!connection || typeof connection !== 'object') return { mutations: [], failed: true };
  if (!assistantText || !String(assistantText).trim()) return { mutations: [], failed: true };
  const young = typeof founding === 'boolean' ? founding : isYoungLedger(state);
  const prompt = buildExtractorMessages({ state, userText, assistantText, before, founding: young, brief, castNotes });
  /* M31: an answer we can't use, or a founding that came back empty, earns
   * ONE second ask with a sharper word — here, not five blind retries in
   * the queue. The raw answer rides out so the drawer can show it. */
  let user = prompt.user;
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text, finishReason } = await callWorker(connection, {
      system: prompt.system,
      user,
      maxTokens: MAX_TOKENS,
      effort: 'off',
      signal,
    });
    const read = parseExtractorAnswer(text);
    read.raw = text;
    if (finishReason === 'length') read.note = read.mutations.length ? read.note : 'cut short';
    last = read;
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
  return last;
}
