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

function orderedLines(mem) {
  return (mem && Array.isArray(mem.nodes) ? mem.nodes : [])
    .filter((n) => n && !n.empty && typeof n.text === 'string' && n.text.trim())
    .sort((a, b) => (a.span[0] - b.span[0]) || (b.level - a.level) || ((a.at || 0) - (b.at || 0)));
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
  const lines = orderedLines(mem).filter((n) => n.level >= minLevel).map((n) => n.text.trim());
  let text = lines.join('\n');
  if (text.length > CONTEXT_CAP) text = text.slice(text.length - CONTEXT_CAP);
  return text;
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
  '3. New facts: identities, numbers, titles, troop counts, match results, tactical details, scale shifts (crowd size, social attraction, popularity, odds, distances). When multiple characters contribute personal knowledge about a previously unmentioned character or entity, treat the combined profile as high-priority canon — preserve the character\'s identity, key achievements, and each contributor\'s unique connection to them.',
  '4. Plans and strategy: the problem, the proposed solution, who proposed it. Include stated intentions, conditional promises, and "if-then" commitments.',
  '5. Character self-declarations and diagnostic reads: when a named character explicitly states their own motivation, principle, boundary, self-assessment, method, capability, or knowledge source in dialogue — OR delivers a strategic assessment of another character\'s transformation, capability, or position — record the substance (paraphrased, not quoted).',
  '6. Information asymmetries: when the text explicitly flags that one character knows or witnessed something another character doesn\'t know they know, record who saw/knows what.',
  '7. Temporal markers: if the passage states a specific day, date, month, season, or time-of-day transition (morning/afternoon/evening/night, Day 4, Tuesday, Mar 15, late March, etc.), you MUST prefix the ENTIRE line with the earliest such marker in compact form (e.g., "[Sept 1, 08:24] {{player_name}} did X;..."). A temporal marker is a PREFIX ONLY — it is never by itself a reason to generate content. Omit if no temporal marker appears.',
  '8. Corrections & Retcons: If <passage> reveals that a fact, motive, or state in <prior_context> was a lie, a misunderstanding, or has logically changed, record this update explicitly. Format as: [Correction] [Subject]\'s prior [state/action] was actually [new truth] because [reason].',
  '9. System & Stat Deltas: Extract any changed stats, tags, or UI variables (e.g., P:, R:, S:). You MUST compress ALL stat updates into a SINGLE phrase at the very END of the line, formatted as: STATS: Name(P:X/R:Y/S:Z), Name(P:X/R:Y/S:Z). Do not use multiple phrases for stats.',
  '10. Out-of-character canon: <passage> may include author asides, parentheticals, or OOC notes (often in parentheses, marked as background/context/note, or verification blocks like "Family Logic Confirmed") that state canonical facts — character backstory, family structure, separations/divorces, custody or legal situations, hidden truths, world rules, relationships, or motives. Record their substance as priority-3 facts, even when framed as an instruction to "analyze," "confirm," or "check." OOC framing or words like "Confirmed" do NOT make a fact established — only actual presence in <prior_context> does. Distinguish canonical facts (RECORD them) from pure processing directives such as "keep it short," "stay in character," or "analyze before the header" (IGNORE those).',
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
  '- If <passage> has nothing new beyond <prior_context>, output exactly: (no new state)',
  '',
  'BEFORE OUTPUTTING, verify: (1) the line starts with a temporal prefix if available; (2) no phrase duplicates anything in <prior_context>; (3) NO PRONOUNS remain — all replaced with names; (4) phrase count within limit; (5) every action has an explicit actor or is passive voice; (6) every named character who acted toward {{player_name}} or the focal character is recorded individually, not merged; (7) any canonical facts stated in OOC asides or parentheticals are captured — not skipped as "already confirmed" — while pure processing directives are ignored; (8) TIMELINE LOGIC — new facts do not create unexplained paradoxes with <prior_context>; if a paradox exists, resolve it with a [Correction] tag; (9) ALL stats are bundled into ONE phrase at the end. If any check fails, revise.',
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

async function callKeeper(connection, prompt, signal) {
  const { text } = await sharedCall(connection, {
    system: prompt.system,
    user: prompt.user,
    maxTokens: MAX_TOKENS,
    effort: 'off',
    signal,
  });
  return text;
}

/* One line, read whole. Fences and wrapper words stripped; a line-break
 * inside the answer is folded into a space (one line is the law). Returns
 * '' when nothing usable; '(no new state)' is returned as exactly that. */
export function parseMemoryAnswer(raw) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
    text = text.replace(/```(?:\w+)?/g, '').trim();
    if (!text) return '';
    if (/^\(?\s*no new state\s*\)?\.?$/i.test(text)) return '(no new state)';
    text = text.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (text.length < 10) return '';
    if (text.length > 4000) text = text.slice(0, 3999).trimEnd() + '…';
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
  'If the line already captures everything important, output exactly: NONE',
  'Otherwise output ONE line: DETAIL: <only the missing information, short phrases separated by semicolons>',
].join('\n');

export function buildAuditMessages(sourceText, noteText) {
  const user = [
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
    if (detail.length > 240) detail = detail.slice(0, 239).trimEnd() + '…';
    return detail;
  } catch (err) {
    return '';
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

/* One past the last page any node covers (nodes cover a prefix). */
export function coveredEnd(mem) {
  const nodes = mem && Array.isArray(mem.nodes) ? mem.nodes : [];
  return nodes.length ? Math.max(...nodes.map((n) => n.span[1])) + 1 : 0;
}

/* The next batch to fold: [from, to) or null. Pages beyond the verbatim
 * window that no node covers are due as soon as a whole batch of them has
 * gathered — no hysteresis; the record keeps step with the story. */
export function nextBatch(historyLength, window, covered, batch) {
  const w = cleanWindow(window);
  const b = cleanBatch(batch);
  const due = historyLength - w - covered;
  if (!Number.isFinite(due) || due < b) return null;
  return [covered, covered + b];
}

/* kept for the published contract (M6): the end of the next batch or -1 */
export function overflowEnd(historyLength, window, covered, batch = DEFAULT_BATCH) {
  const nb = nextBatch(historyLength, window, covered, batch);
  return nb ? nb[1] : -1;
}

async function audit(connection, storyId, node, sourceText, signal) {
  try {
    const signature = nodeSignature(node);
    const auditRaw = await callKeeper(connection, buildAuditMessages(sourceText, node.text), signal);
    const detail = parseAuditAnswer(auditRaw);
    if (!detail) return;
    const current = await loadMemory(storyId);
    if (nodeUnmoved(current.nodes, node.id, signature)) {
      const standing = current.nodes.find((n) => n && n.id === node.id);
      standing.detail = detail;
      await saveMemory(storyId, current);
    }
  } catch (err) { /* an auditor that stumbles changes nothing */ }
}

/* Write the lines that are due, then promote any layer that has grown past
 * its size. Returns the memory when something changed, else null. */
export async function maybeSummarize({ connection, storyId, signal } = {}) {
  if (!connection || typeof connection !== 'object') return null;
  if (!storyId) return null;
  const keeperOn = await db.settings.get('memoryKeeper');
  if (keeperOn === false) return null;
  const window = cleanWindow(await db.settings.get('memoryWindow'));
  const batch = cleanBatch(await db.settings.get('memoryBatch'));

  const history = await db.messages.list(storyId);
  let mem = await loadMemory(storyId);
  mem.window = window;
  const state = await loadState(storyId);
  const known = mcName(state);
  const playerName = known && known !== 'the player' ? known : 'the player';

  let changed = false;

  /* 1. the lines that are due, at the catch-up pace */
  for (let n = 0; n < BATCHES_PER_RUN; n += 1) {
    const range = nextBatch(history.length, window, coveredEnd(mem), batch);
    if (!range) break;
    const pages = history.slice(range[0], range[1]);
    const raw = await callKeeper(connection, buildMemoryMessages(pages, { playerName, record: recordFor(mem) }), signal);
    const text = parseMemoryAnswer(raw);
    if (!text) break; /* the worker went quiet — these pages wait for next time */
    const node = text === '(no new state)'
      ? { id: nodeId(), span: [range[0], range[1] - 1], text: '', level: 1, at: Date.now(), empty: true }
      : { id: nodeId(), span: [range[0], range[1] - 1], text, level: 1, at: Date.now() };
    mem.nodes.push(node);
    changed = true;
    await saveMemory(storyId, mem);
    if (!node.empty) await audit(connection, storyId, node, passageOf(pages, playerName), signal);
    mem = await loadMemory(storyId);
    mem.window = window;
  }

  /* 2. promotion: a layer past its size merges its oldest two, up */
  for (let level = 1; level < MAX_LAYERS; level += 1) {
    const layer = mem.nodes.filter((n) => n.level === level && !n.empty)
      .sort((a, b) => (a.span[0] - b.span[0]) || ((a.at || 0) - (b.at || 0)));
    if (layer.length <= NOTES_PER_LAYER) continue;
    const toMerge = layer.slice(0, NOTES_PER_PROMOTION);
    if (toMerge.length < 2) continue;
    const record = recordFor(mem, level + 1);
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
    /* COPY, don't cut: the sources leave only once the merged line stands */
    mem.nodes = mem.nodes.filter((node) => !ids.has(node.id));
    mem.nodes.push(merged);
    changed = true;
    await saveMemory(storyId, mem);
    await audit(connection, storyId, merged, toMerge.map((node) => node.text).join('\n\n'), signal);
    mem = await loadMemory(storyId);
    mem.window = window;
  }

  if (changed) await saveMemory(storyId, mem);
  return changed ? mem : null;
}
