/* Cozy Tavern — agents/memory.js
 * The memory keeper. M34: the Summaryception principle, ported whole.
 *
 * Before M34 the keeper folded twenty pages at a time into a ~150-word
 * prose note, and only once the thread ran twenty pages PAST the verbatim
 * window. That is a retelling, not a record: a promise in chapter one
 * survived only if the note happened to keep it, and the storyteller was
 * handed "the newest three notes", not the story so far.
 *
 * Summaryception's law, which the writer battle-tested across long tales:
 *   - As pages leave the verbatim window, every small batch becomes ONE
 *     dense line recording only what is NEW against the record so far —
 *     the player's decisions first, then each named character's actions
 *     (never collapsed into "others"), new facts, plans and conditional
 *     promises, self-declarations, who knows what, a temporal prefix,
 *     [Correction] tags, stats bundled last; explicit actors; no pronouns.
 *   - "(no new state)" is an honest answer: the pages are covered, no line.
 *   - Layers: when a layer holds more than NOTES_PER_LAYER lines, the oldest
 *     two are merged into one line on the next layer with the SAME prompt
 *     (the two lines are the passage; the higher layers are the record), and
 *     a shrink guard refuses a merge that lost too much, asking once more.
 *   - The record rides whole, oldest to newest, under "Our story so far …
 *     This is established canon; don't contradict it." — not a sample of it.
 *   - The detail auditor (M12, itself a port of Summaryception's) still runs
 *     on every new line: NONE or one DETAIL line, stored on the node.
 *
 * The store shape is unchanged so nothing else in the house moves:
 *   memory:<storyId> = {window, nodes:[{id, span:[from,to], text, level,
 *                        at, detail?, empty?}]}
 * A node with empty:true covers its pages and says nothing (no new state).
 * Coverage (stack.js windowPlan) reads spans, so covered pages leave the
 * verbatim window whether or not they earned a line.
 *
 * Background only (the latency law): the keeper runs after the stream, in
 * the workers' queue, never on the send path. A transport failure throws to
 * the queue (which retries and says so); a quiet answer leaves the pages
 * for next time.
 */

import { db } from '../store.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { callWorker as sharedCall } from './call.js'; /* M28: the one wire path for workers */
import { loadState } from '../engine/state.js';
import { mcName } from '../engine/duels.js';

const KEY_PREFIX = 'memory:';
const MAX_TOKENS = 1600; /* one dense line, or one merged line; thinking is off on the wire (M28) */

/* The laws of the ledger. */
export const DEFAULT_WINDOW = 30;      /* pages kept word for word */
export const WINDOW_MIN = 10;
export const WINDOW_MAX = 100;
export const DEFAULT_BATCH = 6;        /* pages folded into one line (3 exchanges — Summaryception's turnsPerSummary) */
export const BATCH_MIN = 2;
export const BATCH_MAX = 20;
export const BATCHES_PER_RUN = 3;      /* catch-up pace: at most this many lines per finished page */
export const NOTES_PER_LAYER = 100;    /* a layer past this promotes its oldest two */
export const NOTES_PER_PROMOTION = 2;
export const MAX_LAYERS = 9;
export const SHRINK_FLOOR = 0.4;       /* a merge shorter than this share of its sources is asked again */
export const SLOT_BUDGET = 30000;      /* chars: the record rides whole; trimmed from the oldest only when it truly overflows */
export const CONTEXT_CAP = 14000;      /* chars of the record shown to the summarizer as prior context (newest end) */
/* kept names — the M6/M12 contract published them */
export const OVERFLOW = 0;
export const L2_TRIGGER = NOTES_PER_LAYER;
export const L2_BATCH = NOTES_PER_PROMOTION;
export const SLOT_NODES = Infinity;

export const RECORD_HEADER = 'Our story so far, oldest to newest. This is established canon; don\'t contradict it.';

/* ---------- the store (settings namespaced, so backups carry it) ---------- */

export async function loadMemory(storyId) {
  const fresh = { window: DEFAULT_WINDOW, nodes: [] };
  if (!storyId) return fresh;
  const saved = await db.settings.get(KEY_PREFIX + storyId);
  if (!saved || typeof saved !== 'object') return fresh;
  const nodes = (Array.isArray(saved.nodes) ? saved.nodes : [])
    .filter((n) => n && typeof n === 'object' && Array.isArray(n.span) && (n.empty === true || (typeof n.text === 'string' && n.text.trim())))
    .map((n) => ({
      ...n,
      id: typeof n.id === 'string' ? n.id : 'node-' + Math.random().toString(36).slice(2, 10),
      span: n.span.length === 2 ? [Number(n.span[0]) || 0, Number(n.span[1]) || 0] : [0, 0],
      text: typeof n.text === 'string' ? n.text : '',
      level: Number.isFinite(n.level) && n.level >= 1 ? Math.min(MAX_LAYERS, Math.round(n.level)) : 1,
      at: Number.isFinite(n.at) ? n.at : 0,
      empty: n.empty === true,
      /* M90: a [Correction] the house wrote (the brief wins over the pages) —
       * covers no page (span [-1,-1]), never folded, never verified, read last */
      correction: n.correction === true,
    }));
  return {
    ...saved,
    window: Number.isFinite(saved.window) ? saved.window : DEFAULT_WINDOW,
    nodes,
  };
}

export async function saveMemory(storyId, mem) {
  if (!storyId || !mem || typeof mem !== 'object') return;
  await db.settings.set(KEY_PREFIX + storyId, mem);
}

/* The sliders' words: honest numbers inside their fences. */
export function cleanWindow(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_WINDOW;
  return Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, n));
}

export function cleanBatch(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_BATCH;
  return Math.min(BATCH_MAX, Math.max(BATCH_MIN, n));
}

/* ---------- slot 7: "What remains" — the record, oldest to newest ---------- */

export function orderedLines(mem) {
  return (mem && Array.isArray(mem.nodes) ? mem.nodes : [])
    .filter((n) => n && !n.empty && typeof n.text === 'string' && n.text.trim())
    .sort((a, b) => {
      /* M90: a correction supersedes what came before it — it reads LAST */
      if (Boolean(a.correction) !== Boolean(b.correction)) return a.correction ? 1 : -1;
      if (a.correction && b.correction) return (a.at || 0) - (b.at || 0);
      return (a.span[0] - b.span[0]) || (b.level - a.level) || ((a.at || 0) - (b.at || 0));
    });
}

/* M90: write a [Correction] into the record — the house's own line when the
 * brief and the pages disagreed and the brief won (Canon Definition). Pure:
 * a fresh memory out. A correction saying the same thing twice is one line. */
export const CORRECTIONS_MAX = 12;
export function addCorrection(mem, text) {
  const words = String(text || '').trim().replace(/\s+/g, ' ');
  if (!words) return mem;
  const line = /^\[Correction\]/i.test(words) ? words : '[Correction] ' + words;
  const nodes = (mem && Array.isArray(mem.nodes) ? mem.nodes : []).map((n) => ({ ...n }));
  if (nodes.some((n) => n.correction && n.text.trim().toLowerCase() === line.toLowerCase())) return { ...mem, nodes };
  nodes.push({ id: nodeId(), span: [-1, -1], text: line.slice(0, 600), level: 1, at: Date.now(), correction: true });
  /* the oldest corrections go when there are too many — the pages have long carried the truth by then */
  const corrections = nodes.filter((n) => n.correction).sort((a, b) => (a.at || 0) - (b.at || 0));
  const drop = new Set(corrections.slice(0, Math.max(0, corrections.length - CORRECTIONS_MAX)).map((n) => n.id));
  return { ...mem, nodes: nodes.filter((n) => !drop.has(n.id)) };
}

function lineWords(node) {
  let text = '- ' + node.text.trim();
  /* M12: the detail the auditor caught rides with its line, beneath it. */
  if (typeof node.detail === 'string' && node.detail.trim()) {
    text += '\n  • Detail worth keeping: ' + node.detail.trim();
  }
  return text;
}

/* The whole record under its header. '' when nothing is remembered yet, so
 * the slot can be omitted. Over budget, the OLDEST lines are let go first —
 * with a line saying so — never the newest. */
export function renderMemory(mem) {
  const lines = orderedLines(mem).map(lineWords);
  if (!lines.length) return '';
  const kept = lines.slice();
  let dropped = 0;
  const body = () => kept.join('\n');
  while (kept.length > 1 && (RECORD_HEADER.length + 1 + body().length) > SLOT_BUDGET) { kept.shift(); dropped += 1; }
  const head = dropped ? RECORD_HEADER + '\n(' + dropped + ' earlier ' + (dropped === 1 ? 'line' : 'lines') + ' rest beyond the budget.)' : RECORD_HEADER;
  return head + '\n' + body();
}

/* The record as the summarizer is shown it: plain lines, newest end kept
 * within CONTEXT_CAP. `minLevel` lets a promotion see only the layers above
 * the one it is merging. */
export function recordFor(mem, minLevel = 1) {
  /* M216: THE DETAIL RIDES WITH ITS LINE HERE TOO. Only the storyteller's
   * copy (renderMemory) carried it — so the keeper writing the NEXT line
   * could not see that the line before it had been corrected, and would
   * write the wrong fact again; the auditor checking the ledger against the
   * record could not see it; the mender could not; the housekeeper could
   * not. The one place a correction and a battle plan live was invisible to
   * every worker that needed them. */
  const lines = orderedLines(mem).filter((n) => n.level >= minLevel).map(lineWords);
  let text = lines.join('\n');
  if (text.length > CONTEXT_CAP) text = text.slice(text.length - CONTEXT_CAP);
  return text;
}

/* M51: the WHOLE record, oldest to newest — what a reader of the whole story
 * (the auditor, the rebuild, the mender) should see. Trimmed from the
 * oldest only when it truly overflows the slot budget, exactly as the
 * storyteller's copy is. */
export function wholeRecord(mem) {
  /* M216: with the detail, for the same reason — this is what the auditor,
   * the rebuild, the mender and the housekeeper read. */
  const lines = orderedLines(mem).map(lineWords).filter(Boolean);
  let kept = lines.slice();
  while (kept.length > 1 && kept.join('\n').length > SLOT_BUDGET) kept.shift();
  return kept.join('\n');
}

/* ---------- the prompt: Summaryception's, verbatim in substance ---------- */

export const SUMMARIZER_SYSTEM = 'You are a precise narrative-state tracker for an ongoing fiction. Output one line of short phrases — no preamble, no commentary, no markdown. Record only what the passage states. Never infer, never guess. Out-of-character material inside the passage (parenthetical notes, analysis or verification blocks before/after the scene) counts as part of the record when it establishes background facts not already in prior context; OOC framing or words like "Confirmed" do not make a fact established.';

export const SUMMARIZER_USER = [
  '<player_name>{{player_name}}</player_name>',
  '<prior_context>{{context_str}}</prior_context>',
  '<passage>{{story_txt}}</passage>',
  '',
  'Write ONE line recording only what is NEW in <passage> relative to <prior_context>.',
  '',
  'HARD EXCLUSIONS — do not record:',
  '- Anything already stated in <prior_context>, even indirectly. If a fact, location, relationship, spec, stat, or character trait appears in <prior_context>, it is ESTABLISHED. Never restate it.',
  '- CRITICAL: If <prior_context> already references an event, arrival, match, deployment, or location that <passage> now depicts in full scene form, treat the scene itself as established. Record ONLY the specific new details the prior reference did not contain.',
  '- Atmosphere, weather, particulate haze, lighting, crowd noise, body language without narrative consequence.',
  '- Repeated reactions ("X froze," "Y watched") unless they trigger a new action.',
  '- Ongoing states (repeated locations, reactor levels, recurring postures) — state these ONCE, then never again.',
  '',
  'RECORD (in priority order):',
  '1. {{player_name}}\'s decisions, declarations, and actions.',
  '2. Other named characters\' actions that change state, advance plot, or reveal information. In social or group scenes, each named character who approaches, addresses, or acts toward {{player_name}} or the focal character is a SEPARATE record — never collapse multiple participants into "others" or a single summary. Capture who did what, individually.',
  '3. New facts: identities, numbers, titles, troop counts, match results, tactical details, scale shifts (crowd size, social attraction, popularity, odds, distances). FIRST APPEARANCES: when a named character, creature, or notable location or object enters the record for the FIRST time (nothing about them in <prior_context>), their defining description is mandatory canon — physical appearance and distinguishing features (hair, build, bearing, voice, markings), age or role markers, signature clothing or items. A description not captured at introduction is unrecoverable later, so it is never the phrase cut to fit the limit — cut atmosphere or repeated reactions instead. When multiple characters contribute personal knowledge about a previously unmentioned character or entity, treat the combined profile as high-priority canon — preserve the character\'s identity, key achievements, and each contributor\'s unique connection to them.',
  '4. Plans and strategy: the problem, the proposed solution, who proposed it. Include stated intentions, conditional promises, and "if-then" commitments.',
  '5. Character self-declarations and diagnostic reads: when a named character explicitly states their own motivation, principle, boundary, self-assessment, method, capability, or knowledge source in dialogue — OR delivers a strategic assessment of another character\'s transformation, capability, or position — record the substance (paraphrased, not quoted).',
  '6. Information asymmetries: when the text explicitly flags that one character knows or witnessed something another character doesn\'t know they know, record who saw/knows what.',
  '7. Time AND place: if the passage states a specific day, date, month, season, or time-of-day transition (morning/afternoon/evening/night, Day 4, Tuesday, Mar 15, late March, etc.), you MUST prefix the ENTIRE line with the earliest such marker in compact form. If the passage also names WHERE the scene stands \u2014 a room, a house, a street, a town, a ship, a field \u2014 name it in the same prefix after a dividing dot, in the shortest form that is unmistakable: \"[Sept 1, 08:24 \u00b7 the Wells kitchen] {{player_name}} did X;...\". Where a scene MOVES, the prefix names where it BEGINS and the move itself is recorded as a phrase. A prefix is a PREFIX ONLY \u2014 neither the time nor the place is by itself a reason to generate content. Give whichever of the two the passage states; omit the prefix entirely only when it states neither.',
  '8. Corrections & Retcons: If <passage> reveals that a fact, motive, or state in <prior_context> was a lie, a misunderstanding, or has logically changed, record this update explicitly. Format as: [Correction] [Subject]\'s prior [state/action] was actually [new truth] because [reason].',
  '9. System & Stat Deltas: Extract any changed stats, tags, or UI variables (e.g., P:, R:, S:). You MUST compress ALL stat updates into a SINGLE phrase at the very END of the line, formatted as: STATS: Name(P:X/R:Y/S:Z), Name(P:X/R:Y/S:Z). Do not use multiple phrases for stats. IF NO STAT CHANGED ON THESE PAGES, WRITE NOTHING AT ALL — no STATS phrase, not "STATS: none", not "STATS: unchanged". A line that ends in "STATS: none" is telling the storyteller nothing, on every line, forever.',
  '10. Out-of-character canon: <passage> may include author asides, parentheticals, or OOC notes (often in parentheses, marked as background/context/note, or verification blocks like "Family Logic Confirmed") that state canonical facts — character backstory, family structure, separations/divorces, custody or legal situations, hidden truths, world rules, relationships, or motives. Record their substance as priority-3 facts, even when framed as an instruction to "analyze," "confirm," or "check." OOC framing or words like "Confirmed" do NOT make a fact established — only actual presence in <prior_context> does. Distinguish canonical facts (RECORD them) from pure processing directives such as "keep it short," "stay in character," or "analyze before the header" (IGNORE those).',
  '',
  '',
  'CAUSAL FIDELITY — record WHY, not only WHAT:',
  '- When one recorded event CAUSES or triggers another, keep the link explicit with a connective (→, "so", "which", "because", "triggering", "forcing") — within a phrase or across adjacent phrases. Never split a cause from its effect into two unrelated items. e.g. "Jovan\'s knee shifted the desk → The Glass Season slid into the light → Emilia read it as manufactured evidence" preserves the mechanism; "Jovan moved desk; paperback exposed; Emilia suspicious" loses it.',
  '- Preserve the MANNER of an action when the text marks it: involuntary, reflexive, against the character\'s control, "before judgment caught up," forced, reluctant, deliberate, coldly. The manner is often the whole point — "Emilia corrected the misquote involuntarily, faster than her own judgment" is the record; "Emilia corrected the quote" falsifies her. Never flatten a charged action into a neutral one.',
  '- When a stat delta (P/R/S) has a clear cause in the passage, attach the triggering beat to that character\'s phrase; the number itself still bundles at the end per rule 9. A relationship\'s movement rides with the event that caused it — never a bare number with no reason.',
  '',
  'VERBATIM PRESERVATION — quote exactly when the exact words ARE the fact:',
  'Default is paraphrase (rule 5). Override it with a SHORT exact quotation (in "double quotes", 15 words maximum) ONLY when the precise wording itself carries meaning paraphrase would destroy:',
  '- a line a character will be held to or that becomes a callback: an oath, a promise, a threat, a name spoken, a signature phrase;',
  '- a quotation being corrected, misremembered, or contested — record BOTH the wrong and the right wording verbatim; the discrepancy IS the point;',
  '- an exact phrase from earlier that a character echoes, alters, or throws back.',
  'Keep it minimal: the shortest exact span that preserves the meaning; everything around the quote stays paraphrased.',
  '',
  'ACTOR RULES:',
  '- Every action needs an EXPLICIT actor named in the text. Presence ≠ actorship.',
  '- If no actor is named, write passive voice. Never guess.',
  '- ABSOLUTE PRONOUN BAN: Use character names everywhere. You must replace ALL pronouns (he, him, his, she, her, hers, they, them, their, it) with the specific character\'s name.',
  '- If the passage uses second-person ("you", "your") to refer to the player, replace with {{player_name}}.',
  '- Past events referenced in <passage> belong to whoever the text says performed them.',
  '',
  'FORMAT:',
  '- One line. Short phrases separated by semicolons.',
  '- HARD LIMIT: 15 phrases. For dense scenes with 4+ named participants, 18 phrases maximum. The bundled STATS phrase counts as ONE phrase. If you exceed the limit, cut lowest-priority items first (priority order above) — never cut to fit by dropping high-priority canon or by collapsing distinct named participants together.',
  '- COMPLETENESS OUTRANKS BREVITY. The limit is a ceiling, not a target, and it never licenses dropping a priority-list item: if a draft runs long, cut ONLY atmosphere, connective filler, and repeated reactions. A summary that loses canon to look tidy is a failure; a slightly full line is not. When in doubt whether a detail matters, KEEP it — the auditor can trim, but it cannot restore what was never written.',
  '- If <passage> has nothing new beyond <prior_context>, output exactly: (no new state)',
  '',
  'BEFORE OUTPUTTING, verify: (1) the line starts with a prefix carrying whatever the passage states of TIME and PLACE; (2) no phrase duplicates anything in <prior_context>; (3) NO PRONOUNS remain — all replaced with names; (4) phrase count within limit; (5) every action has an explicit actor or is passive voice; (6) every named character who acted toward {{player_name}} or the focal character is recorded individually, not merged; (7) any canonical facts stated in OOC asides or parentheticals are captured — not skipped as "already confirmed" — while pure processing directives are ignored; (8) TIMELINE LOGIC — new facts do not create unexplained paradoxes with <prior_context>; if a paradox exists, resolve it with a [Correction] tag; (9) ALL stats are bundled into ONE phrase at the end; (10) causal links between events are explicit, not flattened into parallel facts; (11) the manner of any charged or involuntary action is preserved; (12) load-bearing exact wording is quoted (15 words max), not paraphrased away; (13) every FIRST-APPEARING named character, creature, or notable location/object carries their defining description (rule 3). (14) FIGURES ARE EXACT — every age, count, height, distance, time, price and score reads as the passage states it, in the passage’s own form. If the text says Sixteen, the line says sixteen and never seventeen; if it says five-foot-eight, the line does not round it. A figure you cannot point to in <passage> does not belong in the line at all. If any check fails, revise.',
].join('\n');

function subst(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split('{{' + k + '}}').join(v);
  return out;
}

/* The passage the summarizer reads: the batch's pages, each with its
 * author, in order. */
export function passageOf(pages, playerName) {
  return (Array.isArray(pages) ? pages : [])
    .filter((p) => p && !p.hidden)
    .map((p) => (p.role === 'assistant' ? 'STORY: ' : 'PLAYER (' + playerName + '): ') + String(p.text || '').slice(0, 6000))
    .join('\n\n');
}

/* Exported for the harness: the messages for one line. `pages` are the
 * batch (user + storyteller pages); `record` the record so far. */
export function buildMemoryMessages(pages, { playerName = 'the player', record = '' } = {}) {
  const user = subst(SUMMARIZER_USER, {
    player_name: playerName,
    context_str: record || '(nothing recorded yet — this is the beginning)',
    story_txt: passageOf(pages, playerName).slice(0, 24000),
  });
  return { system: withFictionFrame(subst(SUMMARIZER_SYSTEM, { player_name: playerName })), user };
}

/* A promotion: the same prompt — the lines to merge are the passage, the
 * layers above are the record. `strict` is the shrink guard's second ask. */
export function buildFoldMessages(nodes, { playerName = 'the player', record = '', strict = false } = {}) {
  const passage = (Array.isArray(nodes) ? nodes : []).map((n) => String(n && n.text || '').trim()).join('\n\n');
  let user = subst(SUMMARIZER_USER, {
    player_name: playerName,
    context_str: record || '(nothing recorded at the layers above)',
    story_txt: passage,
  });
  user += '\n\nThese are two earlier record lines, oldest first, being merged into ONE line of the record. Keep every distinct fact, name, number, plan, promise, correction and stat from both; drop only true repeats and anything <prior_context> already holds. The phrase limit is 18 here.';
  if (strict) user += '\n\nYour last merge dropped too much of its sources. Merge again and KEEP every distinct fact from both lines — cut nothing that is not a repeat.';
  return { system: withFictionFrame(subst(SUMMARIZER_SYSTEM, { player_name: playerName })), user };
}

/* ---------- the call (M28: the one wire path, agents/call.js) ---------- */

/* M246: DID THE WIRE CUT IT? A line the HOUSE cuts ends in an ellipsis and
 * the house knows to ask again (M243). A line the PROVIDER cuts — its token
 * limit reached, finishReason 'length' — simply STOPS: no ellipsis, no full
 * stop, nothing to tell the writer or the house that the end is missing. It
 * was stored as a finished line. The writer noticed it as "a summary ending
 * with nothing at all", which is exactly the shape of it. callKeeper kept
 * only the text and threw the reason away. */
let lastKeeperWasTruncated = false;
export function keeperWasTruncated() { return lastKeeperWasTruncated; }

async function callKeeper(connection, prompt, signal) {
  const { text, finishReason } = await sharedCall(connection, {
    system: prompt.system,
    user: prompt.user,
    maxTokens: MAX_TOKENS,
    signal,
  });
  lastKeeperWasTruncated = String(finishReason || '').toLowerCase() === 'length';
  return text;
}

/* One line, read whole. Fences and wrapper words stripped; a line-break
 * inside the answer is folded into a space (one line is the law). Returns
 * '' when nothing usable; '(no new state)' is returned as exactly that. */
/* M242: DID THE LAST ANSWER HAVE TO BE CUT? The writer had FIVE LINES OF
 * SIXTEEN ending in an ellipsis — a quarter of his record silently missing
 * its tail, and the only way to know was to read every line himself and
 * count characters. A line that overran is not a line; the house must notice
 * and ask again, not store the wreck and hope he looks. */
let lastAnswerWasCut = false;
export function answerWasCut() { return lastAnswerWasCut; }
export function phraseCount(text) {
  return String(text || '').split(/;\s+/).filter((p) => p.trim()).length;
}

export function parseMemoryAnswer(raw) {
  lastAnswerWasCut = false;
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
    text = text.replace(/```(?:\w+)?/g, '').trim();
    if (!text) return '';
    if (/^\(?\s*no new state\s*\)?\.?$/i.test(text)) return '(no new state)';
    text = text.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (text.length < 10) return '';
    /* M235: A LINE CUT MID-WORD IS A LINE THAT LIES. The writer's own record
     * ends "...and graded Jo…" — a name severed in half, and everything that
     * followed gone with no sign of what. The cut lands on the last whole
     * phrase now, so the line ends on something that reads. */
    if (text.length > 4000) {
      const room = text.slice(0, 3999);
      const at = Math.max(room.lastIndexOf('; '), room.lastIndexOf('. '));
      text = (at > 2000 ? room.slice(0, at) : room.trimEnd()) + '…';
      lastAnswerWasCut = true;
    }
    /* M235: and a keeper that says "STATS: none" anyway is not obeyed — the
     * phrase is noise the storyteller reads on every line of the record. */
    text = text.replace(/;?\s*STATS:\s*(none|n\/a|nil|unchanged|no changes?)\s*\.?\s*$/i, '').trim();
    return text;
  } catch (err) {
    return '';
  }
}

/* ---------- the detail auditor (M12, a port of Summaryception's) ---------- */

const AUDIT_SYSTEM = [
  'You audit one record line against the pages it was written from. Decide: does the',
  'line omit any important information a storyteller would need and could NOT reconstruct',
  'from the gist alone? Consider exact quantities and counts, named tactics or plans,',
  'specific conditional promises ("if X then Y"), precise capabilities or limits, identity',
  'and title details — including a newly introduced named character\'s defining physical',
  'description from their first appearance — and background canon (backstory, family',
  'structure, hidden truths, world rules, relationships, motives). Pure processing',
  'directives ("keep it short", "stay in character") are NOT information.',
  '',
  '',
  'A WRONG FACT IS NOT A MISSING ONE. If the line states something the pages',
  'contradict — a wrong age, count, height, name, title or time — that is a',
  'FIX, not a detail. Give it as the line\'s own words and the words that',
  'belong there instead. Both must appear exactly: the wrong words in the',
  'line, the right ones in the pages.',
  '',
  'WRITE IT SO IT READS BESIDE THE LINE. The detail sits directly under the',
  'record line and is read with it, by a storyteller in the middle of a scene.',
  'Each phrase must say WHAT the thing is and WHY it matters here — "Vanessa',
  'holds the only photo of the pier fire, and means to trade it" — never a',
  'bare noun, never a label with a colon, never a list of names. If a phrase',
  'would puzzle someone who had just read the line above it, it is the wrong',
  'phrase. Nothing in it should need the pages to make sense.',
  '',
  'NEVER WRITE WHAT IS ALREADY ESTABLISHED. If a fact stands in the record',
  'above this line — a full name, a kinship, a place, an age — it is SETTLED.',
  'Writing it again is not detail, it is noise the storyteller reads every',
  'turn for the rest of the tale. A detail carries only what is NEW on these',
  'pages and missing from this line.',
  '',
  'NEVER RECORD PRESENTATION. Colours, hex values, fonts, line-heights,',
  'borders, pixel sizes, CSS and markup are how a page was DRESSED, not what',
  'happened in the story. A storyteller needs none of it.',
  '',
  'HOW LONG THE DETAIL SHOULD BE. As short as it can be and still complete \u2014',
  'never a word of padding, never a sentence where a phrase will do, never',
  'anything the line already says. But length is judged by NEED, not by a',
  'count: some things cannot be carried in a few words and must not be cut',
  'to look tidy. A battle plan with its bait, its ground and its fallback; a',
  'newly introduced person\'s appearance; a political arrangement and who',
  'owes what to whom; a set of conditional promises \u2014 these earn the room',
  'they need, because a storyteller that half-remembers them writes the',
  'wrong scene. Everything else stays terse.',
  '',
  'Output, in this order, and nothing else:',
  '  FIX: <exact words in the line> -> <exact words from the pages>   (zero or more lines)',
  '  DETAIL: <only the MISSING information, short phrases separated by semicolons>   (at most one line)',
  'If the line is right and complete, output exactly: NONE',
].join('\n');

/* M195: the corrections the audit found, as the line's own words and what
 * belongs there instead. A wrong fact is REPAIRED IN THE LINE; only what the
 * line never said goes to the detail beneath it. Before this the audit was
 * asked one question — "does the line omit anything" — so a model that
 * noticed a wrong age had nowhere to put it but the detail, and the record
 * read "Jovan is seventeen ... Detail worth keeping: Jovan is sixteen, not
 * seventeen". The storyteller was handed both and the writer had to referee. */
export function parseAuditFixes(raw) {
  const out = [];
  const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:\w+)?/g, '');
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^fix\s*:\s*(.+?)\s*(?:->|→|=>)\s*(.+?)\s*$/i);
    if (!m) continue;
    const from = m[1].replace(/^["“”']|["“”']$/g, '').trim();
    const to = m[2].replace(/^["“”']|["“”']$/g, '').trim();
    if (!from || !to || from === to || from.length > 120 || to.length > 120) continue;
    out.push({ from, to });
  }
  return out.slice(0, 6);
}

/* A fix is applied only when it is provably safe: the wrong words really are
 * in the line, and the right words really are in the pages. Anything else is
 * the model rewriting the record, which it may not do. */
export function applyAuditFixes(lineText, fixes, sourceText) {
  let text = String(lineText || '');
  const source = String(sourceText || '');
  const used = [];
  for (const fix of (Array.isArray(fixes) ? fixes : [])) {
    if (!text.includes(fix.from)) continue;
    if (!source.toLowerCase().includes(fix.to.toLowerCase())) continue;
    text = text.split(fix.from).join(fix.to);
    used.push(fix);
  }
  return { text, used };
}

export function buildAuditMessages(sourceText, noteText, priorRecord = '') {
  const user = [
    /* M229: WHAT IS ALREADY ESTABLISHED. The audit was given the pages and
     * the line and NOTHING ELSE — no prior record — so every batch's detail
     * re-established what the story settled long ago: "Jovan's full name is
     * Jovan Wells" written again, and again, and again, eighty pages after
     * anyone could have doubted it. The summariser has had a hard exclusion
     * against restating <prior_context> since the beginning; the audit, which
     * writes beside it, had none. */
    ...(String(priorRecord || '').trim()
      ? ['ALREADY ESTABLISHED — everything the record holds before this line. Never write any of it again:',
        '"""', String(priorRecord).trim().slice(0, 12000), '"""', '']
      : []),
    'The pages the line was written from:',
    '"""',
    String(sourceText || '').slice(0, 12000),
    '"""',
    '',
    'The record line:',
    '"""',
    String(noteText || '').slice(0, 4000),
    '"""',
    '',
    'NONE, or one DETAIL: line.',
  ].join('\n');
  return { system: withFictionFrame(AUDIT_SYSTEM), user };
}

/* '' when the auditor says the line stands; else the detail, capped. */
export function parseAuditAnswer(raw) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:\w+)?/g, '').trim();
    if (!text) return '';
    const firstLine = text.split('\n')[0].trim();
    if (/^none\b/i.test(firstLine)) return '';
    const m = firstLine.match(/^detail\s*:\s*(.+)$/i);
    if (!m) return '';
    let detail = m[1].trim();
    if (!detail) return '';
    /* M193: cut at a word, never inside one. The same slice that gave the
     * writer "I'v…" lives here too, on the model's own answer, before
     * anything is merged. */
    /* M197: THE DETAIL IS JUDGED BY NEED, NOT BY A COUNT. Two hundred and
     * forty characters is fine for "she is left-handed" and hopeless for a
     * battle plan with its bait, its ground and its fallback — and a plan cut
     * in half is worse than no plan, because the storyteller half-remembers
     * it and writes the wrong scene. The discipline lives in the audit's own
     * brief now (terse by default, roomy when the matter earns it); this is
     * only a runaway guard, far enough out that nothing honest meets it. */
    if (detail.length > 1400) {
      const room = detail.slice(0, 1399);
      const at = Math.max(room.lastIndexOf(';'), room.lastIndexOf(' '));
      detail = (at > 700 ? room.slice(0, at) : room).trimEnd().replace(/[,;]$/, '') + '…';
    }
    return detail;
  } catch (err) {
    return '';
  }
}

/* ---------- M35: the verifier (Summaryception's continuity auditor, ported) ----------
 * After a line is written, it is checked against its passage and the record:
 * DRIFT — the line misrepresents a correct passage → the line is rewritten;
 * CONTINUITY — the passage itself contradicts the record → the caller is told
 * (chat.js mends the page by the smallest edit when the reader may). */

export const VERIFY_USER = [
  '<player_name>{{player_name}}</player_name>',
  '<record>{{context_str}}</record>',
  '<passage>{{story_txt}}</passage>',
  '<snippet>{{snippet}}</snippet>',
  '',
  '<snippet> is the compact memory line recorded for <passage>. <record> is what the story has already established elsewhere.',
  '',
  'Check for exactly two things:',
  '1) DRIFT — does <snippet> distort, misattribute, or omit something materially important that IS in <passage>?',
  '2) CONTINUITY — does anything in <passage> or <snippet> CONTRADICT <record> — wrong location/presence, knowledge a character could not have, broken timeline, inconsistent relationship/stat, confused identity?',
  '',
  'Flag ONLY genuine problems, grounded in the text. Ignore style, pacing, and trivial detail. Do not invent.',
  '',
  'For each problem set "where": "snippet" if the SNIPPET is the wrong one (it misrepresents a correct <passage> — fixable by rewriting the snippet), or "source" if <passage> itself is wrong (it contradicts <record> and the snippet only repeats it — needs a page edit, not a snippet rewrite).',
  '',
  'If all consistent, output exactly:',
  'NONE',
  '',
  'Otherwise output ONLY a JSON array, e.g.:',
  '[{"issue":"Snippet says Alexia boarded the train, but the passage says she stayed at the academy","fix":"Alexia stayed at the academy; she did not board the train","kind":"drift","where":"snippet"},{"issue":"The passage itself puts Alexia on the train, but the record establishes she is at the academy and never left","fix":"Alexia is at the academy, not on the train","kind":"continuity","where":"source"}]',
].join('\n');

export const REWRITE_USER = [
  '<snippet>{{snippet}}</snippet>',
  '<correction>{{story_txt}}</correction>',
  '<record>{{context_str}}</record>',
  '',
  'Rewrite <snippet> so it is consistent with <correction>, changing only what is needed and keeping everything else intact. Output only the corrected snippet text.',
].join('\n');

export function buildVerifyMessages({ playerName, record, passage, snippet }) {
  return {
    system: withFictionFrame(subst(SUMMARIZER_SYSTEM, { player_name: playerName })),
    user: subst(VERIFY_USER, { player_name: playerName, context_str: record || '(nothing recorded yet)', story_txt: passage, snippet }),
  };
}

export function buildRewriteMessages({ playerName, record, snippet, correction }) {
  return {
    system: withFictionFrame(subst(SUMMARIZER_SYSTEM, { player_name: playerName })),
    user: subst(REWRITE_USER, { context_str: record || '(nothing recorded yet)', story_txt: correction, snippet }),
  };
}

/* NONE → []; else the issues, kept only when they carry an issue and a where. */
export function parseVerifyAnswer(raw) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '').trim();
    if (!text || /^none\b/i.test(text)) return [];
    const start = text.indexOf('[');
    if (start === -1) return [];
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '[') depth += 1;
      else if (ch === ']') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return [];
    const list = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(list)) return [];
    return list
      .filter((e) => e && typeof e === 'object' && typeof e.issue === 'string' && e.issue.trim())
      .map((e) => ({
        issue: e.issue.trim().slice(0, 300),
        fix: typeof e.fix === 'string' ? e.fix.trim().slice(0, 300) : '',
        kind: e.kind === 'continuity' ? 'continuity' : 'drift',
        where: e.where === 'source' ? 'source' : 'snippet',
      }))
      .slice(0, 6);
  } catch (err) {
    return [];
  }
}

async function verify(connection, storyId, node, passage, record, playerName, signal, onSourceIssue) {
  try {
    const raw = await callKeeper(connection, buildVerifyMessages({ playerName, record, passage, snippet: node.text }), signal);
    const issues = parseVerifyAnswer(raw);
    if (!issues.length) return { rewritten: false, sourceIssues: [] };
    const snippetIssues = issues.filter((i) => i.where === 'snippet');
    const sourceIssues = issues.filter((i) => i.where === 'source');
    let rewritten = false;
    if (snippetIssues.length) {
      const correction = snippetIssues.map((i) => i.fix || i.issue).join('; ');
      const fixedRaw = await callKeeper(connection, buildRewriteMessages({ playerName, record, snippet: node.text, correction }), signal);
      const fixed = parseMemoryAnswer(fixedRaw);
      if (fixed && fixed !== '(no new state)' && fixed !== node.text) {
        const current = await loadMemory(storyId);
        const standing = current.nodes.find((n) => n && n.id === node.id);
        if (standing && standing.text === node.text) {
          standing.text = fixed;
          standing.verified = { at: Date.now(), fixed: correction };
          await saveMemory(storyId, current);
          node.text = fixed;
          rewritten = true;
        }
      }
    }
    if (sourceIssues.length && typeof onSourceIssue === 'function') {
      for (const issue of sourceIssues) {
        try { await onSourceIssue({ issue: issue.issue, fix: issue.fix, span: node.span }); } catch (err) { /* the mend is the caller's; a stumble there is theirs to say */ }
      }
    }
    return { rewritten, sourceIssues };
  } catch (err) {
    return { rewritten: false, sourceIssues: [] };
  }
}

/* The discard-if-moved guard (M12). Exported for the harness. */
export function nodeSignature(node) {
  if (!node || typeof node !== 'object') return '';
  return [node.id, node.span && node.span[0], node.span && node.span[1], node.text].join('|');
}

export function nodeUnmoved(nodes, id, signature) {
  const node = (Array.isArray(nodes) ? nodes : []).find((n) => n && n.id === id);
  return Boolean(node) && nodeSignature(node) === signature;
}

/* ---------- the contract ---------- */

let nodeCounter = 0;
function nodeId() {
  nodeCounter += 1;
  return 'node-' + Date.now().toString(36) + '-' + nodeCounter;
}

/* M44: the record's index space is the VISIBLE pages (hidden "go on"
 * nudges never count) — the same list the window law reads, so a span
 * and the verbatim window always mean the same page. */
export function visiblePages(history) {
  return (Array.isArray(history) ? history : []).filter((m) => m && !m.hidden);
}

/* One past the last page any node covers. */
export function coveredEnd(mem) {
  const nodes = mem && Array.isArray(mem.nodes) ? mem.nodes : [];
  return nodes.length ? Math.max(...nodes.map((n) => n.span[1])) + 1 : 0;
}

/* Every page index some node covers. */
export function coveredSet(nodes) {
  const set = new Set();
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    if (!n || !Array.isArray(n.span)) continue;
    for (let i = n.span[0]; i <= n.span[1]; i += 1) set.add(i);
  }
  return set;
}

/* M44: the next range due, HOLES FIRST — Summaryception's coverage law. A
 * page below the verbatim window that no line covers is due, whether it
 * is the next page after the furthest line or a hole left by a deletion
 * or an edit. The range never crosses into covered pages or the window.
 * Returns [from, to) or null. */
export function dueRange(historyLength, window, nodes, batch) {
  const w = cleanWindow(window);
  const b = cleanBatch(batch);
  const limit = historyLength - w; /* pages at index < limit are past the window */
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const covered = coveredSet(nodes);
  let from = -1;
  for (let i = 0; i < limit; i += 1) { if (!covered.has(i)) { from = i; break; } }
  if (from === -1) return null;
  let to = from;
  while (to < limit && to - from < b && !covered.has(to)) to += 1;
  /* a hole smaller than a batch is folded as it is; a fresh tail waits for a whole batch */
  const holeEndsInCovered = to < limit && covered.has(to);
  if (to - from < b && !holeEndsInCovered) return null;
  return [from, to];
}

/* kept for the published contract (M6/M34) */
export function nextBatch(historyLength, window, covered, batch) {
  const w = cleanWindow(window);
  const b = cleanBatch(batch);
  const due = historyLength - w - covered;
  if (!Number.isFinite(due) || due < b) return null;
  return [covered, covered + b];
}
export function overflowEnd(historyLength, window, covered, batch = DEFAULT_BATCH) {
  const nb = nextBatch(historyLength, window, covered, batch);
  return nb ? nb[1] : -1;
}

/* M44: the record after a visible page at `index` is deleted — lines below
 * it stand, the line covering it is let go (a hole, refilled holes-first),
 * lines above it slide down one. Pure. */
export function memoryAfterDeletion(mem, index) {
  const nodes = (mem && Array.isArray(mem.nodes) ? mem.nodes : []).flatMap((n) => {
    if (!n || !Array.isArray(n.span)) return [];
    if (n.span[1] < index) return [n];
    if (n.span[0] <= index && index <= n.span[1]) return [];
    return [{ ...n, span: [n.span[0] - 1, n.span[1] - 1] }];
  });
  return { ...mem, nodes };
}

/* M44: the record after the pages from visible `index` on are gone (a
 * rewrite-from-here, a retry): every line that reaches that far is let go. */
export function memoryTruncatedAt(mem, index) {
  const nodes = (mem && Array.isArray(mem.nodes) ? mem.nodes : []).filter((n) => n && Array.isArray(n.span) && n.span[1] < index);
  return { ...mem, nodes };
}

/* M44: the record without the line covering visible `index` (an edited or
 * swiped page): a hole, refilled holes-first by the keeper. */
export function memoryWithoutPage(mem, index) {
  const nodes = (mem && Array.isArray(mem.nodes) ? mem.nodes : []).filter((n) => !(n && Array.isArray(n.span) && n.span[0] <= index && index <= n.span[1]));
  return { ...mem, nodes };
}

/* M44: only the lines that speak of pages OUTSIDE the verbatim window ride
 * — a line and the page it summarizes never ride together (Summaryception's
 * branch repair, done at send time, which also covers a widened window). */
export function memoryForWindow(mem, verbatimStart) {
  const nodes = (mem && Array.isArray(mem.nodes) ? mem.nodes : []).filter((n) => n && Array.isArray(n.span) && n.span[1] < verbatimStart);
  return { ...mem, nodes };
}

/* M111: THE HARD TOKENS — what a summary loses most disastrously and what code
 * can check without a model: the NAMES on the pages (people the ledger knows,
 * and any capitalized word that recurs) and the NUMBERS (counts, times, money,
 * distances). A line and its detail that hold none of a name or a number
 * the pages held have lost it; the auditor is asked once more with the list
 * in hand, and whatever it still leaves out is written beneath the line in
 * code. A battle plan keeps its forty men and its three o'clock; a court its
 * titles and its names. */
export function hardTokens(passage, knownNames = []) {
  const text = String(passage || '');
  const names = new Set();
  const known = (Array.isArray(knownNames) ? knownNames : []).map((n) => String(n || '').trim()).filter((n) => n.length >= 2);
  for (const n of known) if (new RegExp('(?<![\\p{L}])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}])', 'u').test(text)) names.add(n);
  const counts = new Map();
  /* M192: A CONTRACTION IS NOT A PERSON. The pattern took any capitalised
   * word of three characters that repeats — so "I'm" and "I'v" (out of
   * "I've") were filed as NAMES, and "Vanessa's" as a second person beside
   * Vanessa. The record's own detail read "also named: Mariner's, Lane,
   * Wells, England, Vanessa's, I'm, Entryway, I'v…" — nonsense the
   * storyteller reads every turn, and every false name also costs a second
   * call to the keeper asking where it went. A possessive folds onto the
   * name it belongs to; a contraction is not a name at all. */
  const CONTRACTION = /['’](m|ve|ll|re|d|t)$/i;
  for (const m of text.matchAll(/(?<![.!?]\s|^|"|\n)\b(\p{Lu}[\p{Ll}'’-]{2,})\b/gmu)) {
    let w = m[1];
    if (/^I['’]/.test(w)) continue;
    if (CONTRACTION.test(w)) continue;
    const bare = w.replace(/['’]s$/i, '');
    if (bare.length >= 3) w = bare;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const STOP = new Set(['The', 'She', 'He', 'They', 'And', 'But', 'Then', 'When', 'His', 'Her', 'Their', 'You', 'Your', 'Not', 'For', 'With', 'That', 'This', 'There', 'What', 'Where', 'Who', 'How', 'Why', 'Yes', 'No', 'Now', 'Still', 'Just', 'Even', 'Only', 'Story', 'Player', 'Detail', 'Fine', 'Okay', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  for (const [w, c] of counts) if (c >= 2 && !STOP.has(w)) names.add(w);
  const numbers = new Set();
  for (const m of text.matchAll(/\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+)(\s*(?:%|am|pm|a\.m\.|p\.m\.|o\'clock|men|soldiers|riders|ships|guards|gold|coins|dollars|euros|yen|minutes|hours|days|weeks|months|years|km|miles|metres|meters|feet|rounds|shots))?\b/gi)) {
    const whole = (m[1] + (m[2] || '')).replace(/\s+/g, ' ').trim();
    if (/^(19|20)\d\d$/.test(m[1]) && !m[2]) continue; /* a year in a header is not a count */
    if (!m[2] && Number(String(m[1]).replace(/[.,]/g, '')) < 10) continue; /* a bare single digit is noise — a line number, a page */
    numbers.add(whole);
  }
  return { names: [...names], numbers: [...numbers] };
}

/* M192: two details, merged without repeating themselves. Clauses are held
 * apart by semicolons; two that read alike once case, spacing and end
 * punctuation are set aside are the same clause. */
/* M208: a bare list of words is not a detail. "also named: Rachel British,
 * American, Reynolds" reads as nonsense beside a summary line, and the
 * storyteller is handed it every turn. A clause that carries no verb and no
 * preposition — just names separated by commas — is refused. */
export function looksLikeTokenDump(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^(also named|figures?|names?)\s*:/i.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length < 4) return false;
  const commas = (t.match(/,/g) || []).length;
  const joiners = (t.match(/\b(is|was|are|were|has|had|said|told|and|of|in|at|to|for|with|from|who|which|that)\b/gi) || []).length;
  /* many commas and almost no English between them */
  return commas >= 3 && joiners <= 1;
}

export function mergeDetail(first, second) {
  const norm = (c) => c.toLowerCase().replace(/[.;,\s]+$/g, '').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  for (const part of [first, second]) {
    for (const clause of String(part || '').split(/\s*;\s*/)) {
      const c = clause.trim().replace(/[.;,]+$/g, '');
      if (!c) continue;
      const key = norm(c);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out.join('; ');
}

export function lossCheck(passage, lineText, detailText, knownNames = []) {
  const { names, numbers } = hardTokens(passage, knownNames);
  const kept = (String(lineText || '') + '\n' + String(detailText || '')).toLowerCase();
  const missingNames = names.filter((n) => !kept.includes(n.toLowerCase()) && !kept.includes(n.toLowerCase().split(' ')[0]));
  const missingNumbers = numbers.filter((n) => !kept.includes(n.toLowerCase().split(' ')[0]));
  return { missingNames, missingNumbers };
}

/* the people the ledger knows — the names the loss check must never let go */
async function knownNamesOf(storyId) {
  try {
    const st = await db.settings.get('state:' + storyId);
    if (!st) return [];
    return [...new Set([
      ...(st.present || []).map((p) => p && p.name), ...Object.keys(st.characters || {}), ...Object.keys(st.offscreen || {}),
      ...Object.keys(st.relationships || {}), ...Object.keys(st.canon || {}), st.sheet && st.sheet.playerName,
    ].filter(Boolean))];
  } catch (err) { return []; }
}

/* M213: the audit makes its OWN keeper calls — one, and up to three when it
 * has to ask again — and none of them renewed the leash. So even with every
 * fold renewing, a batch could spend four calls between renews and the run
 * was cut off mid-rebuild. Every call in this file renews before it goes. */
async function audit(connection, storyId, node, sourceText, signal, knownNames = [], renew) {
  try {
    const signature = nodeSignature(node);
    if (typeof renew === 'function' && !renew()) return;
    /* M229: the lines BEFORE this one — what the story has already settled.
     * Never the lines after it: a detail must not know the future. */
    let priorRecord = '';
    try {
      const held = await loadMemory(storyId);
      const earlier = (held.nodes || []).filter((n) => n && Array.isArray(n.span)
        && Array.isArray(node.span) && n.span[1] < node.span[0]);
      priorRecord = recordFor({ ...held, nodes: earlier });
    } catch (err) { priorRecord = ''; }
    const auditRaw = await callKeeper(connection, buildAuditMessages(sourceText, node.text, priorRecord), signal);
    /* M195: a wrong fact is REPAIRED IN THE LINE; only what the line never
     * said goes to the detail beneath it. */
    const repaired = applyAuditFixes(node.text, parseAuditFixes(auditRaw), sourceText);
    let lineText = repaired.text;
    let detail = parseAuditAnswer(auditRaw);
    /* M111: the hard tokens, checked in code; one sharper ask; the rest written beneath */
    let loss = lossCheck(sourceText, lineText, detail, knownNames);
    if (loss.missingNames.length || loss.missingNumbers.length) {
      const second = buildAuditMessages(sourceText, lineText + (detail ? '\n• Detail worth keeping: ' + detail : ''), priorRecord);
      second.user += '\n\nThese from the pages appear in neither the line nor its detail: ' + [...loss.missingNames.map((n) => 'the name ' + n), ...loss.missingNumbers.map((n) => 'the figure ' + n)].join('; ') + '. Return DETAIL with every one that a storyteller would need, and what each was (who, what count, when).';
      try {
        if (typeof renew === 'function') renew();
        const again = parseAuditAnswer(await callKeeper(connection, second, signal));
        /* M192: merged CLAUSE BY CLAUSE — the second answer only had to
         * differ by a full stop to be appended whole, and the writer's own
         * record showed the same three clauses twice over, which then ate
         * the 480-character room and cut the rest off. */
        detail = mergeDetail(detail, again);
      } catch (err) { /* the code writes the rest */ }
      /* M208: NO TOKEN DUMPS. When the sharper ask still left something out,
       * the code pasted the raw tokens in — and the writer's record read
       * "Detail worth keeping: also named: cardinal, Aurora house next door,
       * also named: Rachel British, American, Reynolds, figures 16, 18".
       * That is not a detail worth keeping. It is a debug list, it is
       * incoherent beside the line it belongs to, half of it is not even a
       * name ("British", "American"), and the storyteller reads it every
       * turn. A detail must be SENTENCES that stand with the line above
       * them. One more ask, for those things written as phrases; and if that
       * does not come back as prose, nothing is written at all — the line
       * losing a name is a smaller harm than the record talking nonsense. */
      loss = lossCheck(sourceText, lineText, detail, knownNames);
      if (loss.missingNames.length || loss.missingNumbers.length) {
        try {
          const missing = [...loss.missingNames.slice(0, 8), ...loss.missingNumbers.slice(0, 8)];
          const third = buildAuditMessages(sourceText, lineText + (detail ? '\n• Detail worth keeping: ' + detail : ''), priorRecord);
          third.user += '\n\nThese appear in the pages and in neither the line nor its detail: ' + missing.join('; ')
            + '.\nWrite DETAIL as SHORT PHRASES that read as English beside the line — who each one is, or what the figure counts, and why it matters. '
            + 'Never a bare list of words. If one of them is not actually a person, a place or a figure that matters, leave it out.';
          if (typeof renew === 'function') renew();
          const last = parseAuditAnswer(await callKeeper(connection, third, signal));
          if (last && !looksLikeTokenDump(last)) detail = mergeDetail(detail, last);
        } catch (err) { /* nothing is written rather than nonsense */ }
      }
    }
    /* M206: JUDGED AFTER EVERYTHING THAT COULD MEND THE LINE, NOT BEFORE.
     * This was read here, ABOVE the overflow rewrite (M196) that also mends
     * the line — so a line rewritten because its addendum overflowed was
     * never saved unless the audit happened to return a FIX as well, and the
     * early return below could drop it entirely. The whole of M196 did
     * nothing, quietly, whenever it was the only thing that had changed. */
    /* M192: when it must be cut, cut at a CLAUSE — the old slice landed
     * mid-word ("I'v…") and left a fragment of nothing. */
    /* M196: A LINE TOO POOR TO ANNOTATE IS REWRITTEN, NOT TRIMMED. The detail
     * is an addendum — 480 characters is right for what a line left out. When
     * the audit finds MORE than that missing, the LINE is the problem, and
     * cutting the addendum to fit throws away exactly the continuity the
     * record exists to hold. The house rewrites that one line from what it
     * missed and keeps the addendum for whatever still will not fit. The
     * writer is never asked to notice this, or to press anything. */
    if (detail.length > 1200) {
      try {
        if (typeof renew === 'function') renew();
        const roomier = await callKeeper(connection, buildRewriteMessages({
          playerName: (await db.settings.get('playerName')) || 'the player',
          record: '',
          snippet: lineText,
          correction: 'The line below left these out, and they matter: ' + detail
            + '\n\nRewrite the line so every one of them is in it. Keep everything the line already says. Same form: one line, short phrases separated by semicolons.',
        }), signal);
        const rewritten = parseMemoryAnswer(roomier);
        if (rewritten && rewritten !== '(no new state)' && rewritten.length > lineText.length / 2) {
          lineText = rewritten;
          repaired.used.push({ from: '(the line)', to: '(rewritten to hold what it had left out)' });
          const after = lossCheck(sourceText, lineText, '', knownNames);
          /* M230: NOT HERE EITHER. M208 took the token dump out of the loss
           * path and left this one, written at M196 — so a line whose
           * addendum overflowed still ended with "also named: Chloe, Caleb
           * Thorne, Wells" pasted under it, on the latest coat, exactly as
           * the writer reported. There is no second place to write a bare
           * list; the rewritten line already holds what those names were
           * doing, and if it does not, nothing is better than nonsense. */
          detail = '';
        }
      } catch (err) { /* the trim below is still the backstop */ }
    }
    if (detail.length > 1400) {
      const room = detail.slice(0, 1399);
      const at = room.lastIndexOf(';');
      detail = (at > 700 ? room.slice(0, at) : room.trimEnd()) + '…';
    }
    const mended = repaired.used.length > 0;
    if (!detail && !mended) return;
    const current = await loadMemory(storyId);
    if (nodeUnmoved(current.nodes, node.id, signature)) {
      const standing = current.nodes.find((n) => n && n.id === node.id);
      if (mended) standing.text = lineText;   /* M195: the line itself is put right */
      if (detail) standing.detail = detail;
      await saveMemory(storyId, current);
    }
  } catch (err) { /* an auditor that stumbles changes nothing */ }
}

/* Write the lines that are due, then promote any layer that has grown past
 * its size. Returns the memory when something changed, else null. */
/* M211: onBatch fires after EVERY batch, not once per run. A run folds three
 * batches (BATCHES_PER_RUN), so a rebuild's banner could only ever move in
 * jumps of eighteen pages — the writer watched it sit at nothing and then
 * leap to "18 of 99". Summaryception counts batches because a batch is the
 * unit of work a writer can actually feel. */
export async function maybeSummarize({ connection, storyId, signal, onSourceIssue, stale, onBatch, renew } = {}) {
  if (!connection || typeof connection !== 'object') return null;
  if (!storyId) return null;
  const gone = () => Boolean(stale && stale());
  const keeperOn = await db.settings.get('memoryKeeper');
  if (keeperOn === false) return null;
  const window = cleanWindow(await db.settings.get('memoryWindow'));
  const batch = cleanBatch(await db.settings.get('memoryBatch'));

  const history = visiblePages(await db.messages.list(storyId));
  let mem = await loadMemory(storyId);
  mem.window = window;
  const state = await loadState(storyId);
  const known = mcName(state);
  const playerName = known && known !== 'the player' ? known : 'the player';

  let changed = false;

  /* 1. the lines that are due, at the catch-up pace */
  for (let n = 0; n < BATCHES_PER_RUN; n += 1) {
    const range = dueRange(history.length, window, mem.nodes, batch);
    if (!range) break;
    /* M213: EVERY CALL GETS ITS OWN MINUTE. M207 renewed the leash once per
     * ROUND — and a round is three batches, three separate asks. Three keeper
     * calls on a slow model pass sixty seconds easily, so the signal aborted
     * mid-run and the rebuild returned nothing at all: the writer saw it stop
     * dead at batch 3 of 16 and read "nothing to rebuild". */
    if (typeof renew === 'function' && !renew()) break;
    const pages = history.slice(range[0], range[1]);
    const raw = await callKeeper(connection, buildMemoryMessages(pages, { playerName, record: recordFor(mem) }), signal);
    let text = parseMemoryAnswer(raw);
    if (!text) break; /* the worker went quiet — these pages wait for next time */
    /* M242: A LINE THAT OVERRAN IS NOT A LINE. It was stored cut — five of the
     * writer's sixteen ended in an ellipsis with their tails gone, and the
     * only way to know was to read each one and count. Asked again, once,
     * with the overrun named; the shorter honest answer wins, and only if
     * that fails too is the cut one kept, because a cut line still beats no
     * line. */
    if (answerWasCut() || keeperWasTruncated() || phraseCount(text) > 20) {
      try {
        if (typeof renew === 'function') renew();
        const tooLong = buildMemoryMessages(pages, { playerName, record: recordFor(mem) });
        tooLong.user += '\n\nYour last answer ran past the limit and had to be CUT, losing its end. '
          + 'It had ' + phraseCount(text) + ' phrases; the hard limit is 15, or 18 for a scene with four or more named people. '
          + 'Write it again WITHIN the limit: keep every high-priority item (the writer\'s decisions, each named person\'s '
          + 'doings, new facts, plans and promises, first appearances, exact wording that IS the fact) and drop the '
          + 'lowest-priority ones. A complete short line beats a long one with its end missing.';
        const again = parseMemoryAnswer(await callKeeper(connection, tooLong, signal));
        if (again && again !== '(no new state)' && !answerWasCut() && !keeperWasTruncated() && phraseCount(again) <= phraseCount(text)) {
          text = again;
        }
      } catch (err) { /* fall through to the split below */ }
    }

    /* M244: AND IF IT OVERRAN AGAIN, THE BATCH IS TOO BIG FOR ONE LINE —
     * so fold FEWER PAGES, not a shorter line. Storing the cut one was
     * accepting the loss: the writer asked, rightly, whether he is meant to
     * shrug at a quarter of his record having its tail missing. He is not.
     * Six pages that will not fit in eighteen phrases are folded as three and
     * three: two complete lines, nothing lost, and the next round picks up
     * the rest. The batch is only halved for THIS fold — the writer's own
     * setting is untouched. */
    if ((answerWasCut() || keeperWasTruncated() || phraseCount(text) > 20) && pages.length > 1) {
      const half = Math.max(1, Math.floor(pages.length / 2));
      try {
        if (typeof renew === 'function') renew();
        const firstHalf = parseMemoryAnswer(await callKeeper(
          connection, buildMemoryMessages(pages.slice(0, half), { playerName, record: recordFor(mem) }), signal,
        ));
        if (firstHalf && firstHalf !== '(no new state)' && !answerWasCut() && !keeperWasTruncated()) {
          text = firstHalf;
          range[1] = range[0] + half;   /* this line covers only what it read */
        }
      } catch (err) { /* the cut line stands only when even half will not come */ }
    }
    const node = text === '(no new state)'
      ? { id: nodeId(), span: [range[0], range[1] - 1], text: '', level: 1, at: Date.now(), empty: true }
      : { id: nodeId(), span: [range[0], range[1] - 1], text, level: 1, at: Date.now() };
    /* M72: THE RECORD IS RE-READ BEFORE IT IS WRITTEN. The call above is slow;
     * while it ran, a hand or a rewind may have moved the record (a hole
     * punched for an edited page, lines let go after a retry, the
     * housekeeper's own edit). Saving the copy loaded before the call put all
     * of that back — a line describing the OLD words returned into a hole
     * that was cut for it. Now the line lands only if the pages it covers
     * are still there and still uncovered; otherwise it is let go and the
     * pages are read again next time. A ledger rewound under the keeper
     * (stale) writes nothing at all. */
    if (gone()) return changed ? mem : null;
    const now = await loadMemory(storyId);
    const nowHistory = visiblePages(await db.messages.list(storyId));
    const stillDue = nowHistory.length >= range[1]
      && pages.every((pg, i) => nowHistory[range[0] + i] && nowHistory[range[0] + i].id === pg.id && String(nowHistory[range[0] + i].text || '') === String(pg.text || ''))
      && !now.nodes.some((n) => n && Array.isArray(n.span) && n.span[0] <= range[1] - 1 && range[0] <= n.span[1]);
    if (!stillDue) break;
    mem = now;
    mem.window = window;
    mem.nodes.push(node);
    changed = true;
      if (typeof onBatch === 'function') onBatch({ span: node.span, pages: node.span[1] - node.span[0] + 1 });
    await saveMemory(storyId, mem);
    if (!node.empty) {
      const passage = passageOf(pages, playerName);
      const recordBefore = recordFor({ nodes: mem.nodes.filter((n) => n.id !== node.id) });
      await verify(connection, storyId, node, passage, recordBefore, playerName, signal, onSourceIssue);
      await audit(connection, storyId, node, passage, signal, await knownNamesOf(storyId), renew);
    }
    mem = await loadMemory(storyId);
    mem.window = window;
  }

  /* 2. promotion: a layer past its size merges its oldest two, up */
  for (let level = 1; level < MAX_LAYERS; level += 1) {
    const layer = mem.nodes.filter((n) => n.level === level && !n.empty && !n.correction)
      .sort((a, b) => (a.span[0] - b.span[0]) || ((a.at || 0) - (b.at || 0)));
    if (layer.length <= NOTES_PER_LAYER) continue;
    const toMerge = layer.slice(0, NOTES_PER_PROMOTION);
    if (toMerge.length < 2) continue;
    const record = recordFor(mem, level + 1);
    if (typeof renew === 'function') renew();
    let raw = await callKeeper(connection, buildFoldMessages(toMerge, { playerName, record }), signal);
    let text = parseMemoryAnswer(raw);
    const sourcesLen = toMerge.reduce((a, node) => a + node.text.length, 0);
    if (text && text !== '(no new state)' && text.length < sourcesLen * SHRINK_FLOOR) {
      /* the shrink guard: once more, stricter; then accept what came */
      raw = await callKeeper(connection, buildFoldMessages(toMerge, { playerName, record, strict: true }), signal);
      const again = parseMemoryAnswer(raw);
      if (again && again !== '(no new state)' && again.length > text.length) text = again;
    }
    if (!text || text === '(no new state)') break; /* a merge of nothing is not a promotion */
    const ids = new Set(toMerge.map((node) => node.id));
    const merged = {
      id: nodeId(),
      span: [toMerge[0].span[0], toMerge[toMerge.length - 1].span[1]],
      text,
      level: level + 1,
      at: Date.now(),
    };
    /* M72: the sources must still stand, unmoved, when the merge lands */
    if (gone()) return changed ? mem : null;
    const now = await loadMemory(storyId);
    if (!toMerge.every((node) => nodeUnmoved(now.nodes, node.id, nodeSignature(node)))) break;
    mem = now;
    mem.window = window;
    /* COPY, don't cut: the sources leave only once the merged line stands */
    mem.nodes = mem.nodes.filter((node) => !ids.has(node.id));
    mem.nodes.push(merged);
    changed = true;
    await saveMemory(storyId, mem);
    await audit(connection, storyId, merged, toMerge.map((node) => node.text).join('\n\n'), signal, await knownNamesOf(storyId), renew);
    mem = await loadMemory(storyId);
    mem.window = window;
  }

  /* M72: the final write is the freshly read record with its window — never
   * a copy from before the calls */
  if (changed) { const now = await loadMemory(storyId); now.window = window; mem = now; await saveMemory(storyId, mem); }
  return changed ? mem : null;
}

/* M216: ONE LINE, AGAIN — Summaryception's per-snippet redo, which this house
 * never had. A single line that came out wrong, or a detail that came out as
 * nonsense, meant rebuilding the WHOLE record: minutes of work that throws
 * away every other line that was perfectly good. This folds that line's own
 * pages again, in place, and leaves everything around it alone.
 *
 * Only a layer-1 line can be redone — a promoted line has no source pages of
 * its own, exactly as Summaryception refuses one. `detailOnly` re-runs just
 * the audit against the line as it stands, for a detail that read as
 * nonsense while the line itself was fine. */
export async function redoLine({ connection, storyId, nodeId, detailOnly = false, signal, renew } = {}) {
  if (!connection || !storyId || !nodeId) return { ok: false, why: 'nothing to redo' };
  let mem = await loadMemory(storyId);
  const node = (mem.nodes || []).find((n) => n && n.id === nodeId);
  if (!node) return { ok: false, why: 'that line is no longer in the record' };
  if (node.level !== 1) return { ok: false, why: 'a promoted line has no pages of its own to read again' };
  if (!Array.isArray(node.span) || node.span[0] < 0) return { ok: false, why: 'that line has no pages behind it' };

  const history = visiblePages(await db.messages.list(storyId));
  const pages = history.slice(node.span[0], node.span[1] + 1);
  if (!pages.length) return { ok: false, why: 'the pages that line was written from are gone' };

  const playerName = (await db.settings.get('playerName')) || 'the player';
  const knownNames = await knownNamesOf(storyId);
  const passage = passageOf(pages, playerName);

  if (!detailOnly) {
    if (typeof renew === 'function') renew();
    /* the lines BEFORE this one are its prior context, exactly as they were
     * when it was first written — never the lines that come after it */
    const before = { ...mem, nodes: (mem.nodes || []).filter((n) => n && Array.isArray(n.span) && n.span[1] < node.span[0]) };
    const raw = await callKeeper(connection, buildMemoryMessages(pages, { playerName, record: recordFor(before) }), signal);
    const text = parseMemoryAnswer(raw);
    if (!text) return { ok: false, why: 'the keeper gave nothing back' };
    mem = await loadMemory(storyId);
    const fresh = (mem.nodes || []).find((n) => n && n.id === nodeId);
    if (!fresh) return { ok: false, why: 'that line moved while the keeper was reading' };
    fresh.text = text === '(no new state)' ? '' : text;
    fresh.empty = text === '(no new state)';
    delete fresh.detail;              /* the old detail described the old line */
    fresh.at = Date.now();
    await saveMemory(storyId, mem);
  }

  /* and the audit again, so the line gets its detail back (or its first one) */
  const current = await loadMemory(storyId);
  const again = (current.nodes || []).find((n) => n && n.id === nodeId);
  if (again && again.text) await audit(connection, storyId, again, passage, signal, knownNames, renew);

  const after = await loadMemory(storyId);
  const done = (after.nodes || []).find((n) => n && n.id === nodeId);
  return { ok: true, text: done ? done.text : '', detail: done ? done.detail || '' : '', pages: pages.length };
}

/* M218: FOLD EVERYTHING THAT IS DUE, NOW — Summaryception's "Force Summarize
 * Now", which this house never had. The keeper folds at most BATCHES_PER_RUN
 * (three) per finished page, so a writer who stopped a run, or turned the
 * keeper on partway through a long tale, was left dozens of batches behind
 * with no way to catch up but playing turn after turn. This folds until
 * nothing is due, reporting every batch, with the same retry ladder a
 * rebuild has — and it NEVER wipes: it only fills the gaps. */
export async function catchUpRecord({ connection, storyId, onProgress, onRetry, signal, stale, renew } = {}) {
  if (!connection || !storyId) return null;
  const mem = await loadMemory(storyId);
  const history = visiblePages(await db.messages.list(storyId));
  const window = cleanWindow(mem.window || (await db.settings.get('memoryWindow')));
  const batch = cleanBatch(await db.settings.get('memoryBatch'));
  if (!dueRange(history.length, window, mem.nodes, batch)) {
    return { ok: true, nothingDue: true, folded: 0, batches: 0 };
  }
  /* M219: COUNT ONLY WHAT IS DUE. This took every covered page, including
   * lines that reach INTO the word-for-word window — pages that were never
   * due — so the total came out short and the banner ran past its own end
   * ("3 of 2"). A writer watching a bar overshoot cannot tell a miscount from
   * a runaway. Only pages PAST the window and not already covered count. */
  const limit = Math.max(0, history.length - window);
  const already = coveredSet(mem.nodes);
  let toFold = 0;
  for (let i = 0; i < limit; i += 1) if (!already.has(i)) toFold += 1;
  const batches = Math.max(1, Math.floor(toFold / batch));
  let doneBatches = 0;
  let folded = 0;
  for (let rounds = 0; rounds < 400; rounds += 1) {
    if (stale && stale()) return { ok: false, why: 'left behind' };
    if (typeof renew === 'function' && !renew()) {
      return { ok: false, stalled: true, folded, batches: doneBatches, why: 'the run was cut short — press it again to carry on' };
    }
    const before = (await loadMemory(storyId)).nodes.length;
    try {
      await maybeSummarize({
        connection, storyId, signal, renew,
        onBatch: ({ pages }) => {
          doneBatches += 1;
          folded += pages;
          if (typeof onProgress === 'function') onProgress({ batch: doneBatches, batches, folded, toFold });
        },
      });
    } catch (err) { /* the ladder below */ }
    let after = (await loadMemory(storyId)).nodes;
    const stillDue = Boolean(dueRange(history.length, window, after, batch));
    if (!stillDue) return { ok: true, folded, batches: doneBatches, lines: after.length };
    if (after.length === before) {
      let recovered = false;
      const pauses = [1500, 4000, 9000, 20000, 45000, 90000];
      for (let a = 0; a < pauses.length; a += 1) {
        if (stale && stale()) return { ok: false, why: 'left behind' };
        if (typeof onRetry === 'function') await onRetry({ ms: pauses[a], attempt: a + 1, of: pauses.length });
        else await new Promise((r) => setTimeout(r, pauses[a]));
        if (typeof renew === 'function' && !renew()) break;
        try {
          await maybeSummarize({ connection, storyId, signal, renew,
            onBatch: ({ pages }) => { doneBatches += 1; folded += pages; if (typeof onProgress === 'function') onProgress({ batch: doneBatches, batches, folded, toFold }); } });
        } catch (err) { /* the next rung */ }
        after = (await loadMemory(storyId)).nodes;
        if (after.length !== before) { recovered = true; break; }
      }
      if (!recovered) {
        return { ok: false, stalled: true, folded, batches: doneBatches,
          why: 'the keeper could not be reached — press it again to carry on' };
      }
    }
  }
  return { ok: true, folded, batches: doneBatches, lines: (await loadMemory(storyId)).nodes.length };
}
