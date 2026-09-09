/* Cozy Tavern — agents/memory.js
 * The memory keeper. Long stories can't carry every page forever, so once
 * the thread runs well past the verbatim window, the keeper quietly
 * compresses the oldest pages into layered summary nodes (Summaryception-
 * style): level-1 nodes hold stretches of pages, and when enough of those
 * gather, the oldest few fold into a level-2 node that remembers them all.
 * Slot 7 of the stack — "What remains" — hands the newest nodes back to the
 * storyteller, so an old promise kept in chapter one still casts its shadow.
 *
 * Background only (the latency law): the keeper runs AFTER the stream
 * completes and AFTER the extractor, never before, and it never throws into
 * the chat path — any failure simply leaves the store as it was.
 *
 * Contract (SPEC.md M6):
 *   maybeSummarize({connection, storyId, signal})  — threshold-gated,
 *     never throws
 *   store key memory:<storyId> =
 *     {window:30, nodes:[{id, span:[fromIdx,toIdx], text, level, at}]}
 *
 * The rules of the house:
 *   - Verbatim window default 30 messages (Settings slider, 10–100).
 *   - When history exceeds window+20, the oldest messages beyond the window
 *     compress into a level-1 node (~150 words, faithful, no invention).
 *   - When more than 6 level-1 nodes exist, the oldest 3 compress into a
 *     level-2 node.
 *   - Slot 7 = the newest 3 node texts (level descending), budget 3200
 *     chars; omitted when no nodes.
 *
 * The window and the on/off switch live in Settings ("How much the story
 * remembers") as app-wide keys — memoryWindow, memoryKeeper — so the store
 * stays per-story payload only, and backups carry both.
 */

import { db } from '../store.js';

const KEY_PREFIX = 'memory:';
const MAX_TOKENS = 400;
const TEMPERATURE = 0;

/* The laws of layering (SPEC.md M6). */
export const DEFAULT_WINDOW = 30;
export const WINDOW_MIN = 10;
export const WINDOW_MAX = 100;
export const OVERFLOW = 20;         // history must exceed window + this
export const L2_TRIGGER = 6;        // more than this many level-1 nodes…
export const L2_BATCH = 3;          // …folds the oldest this many into level 2
export const SLOT_BUDGET = 3200;    // chars for slot 7, "What remains"
export const SLOT_NODES = 3;        // newest this many node texts ride slot 7

/* ---------- the store (settings namespaced, so backups carry it) ---------- */

export async function loadMemory(storyId) {
  const fresh = { window: DEFAULT_WINDOW, nodes: [] };
  if (!storyId) return fresh;
  const saved = await db.settings.get(KEY_PREFIX + storyId);
  if (!saved || typeof saved !== 'object') return fresh;
  const nodes = (Array.isArray(saved.nodes) ? saved.nodes : [])
    .filter((n) => n && typeof n === 'object' && typeof n.text === 'string' && n.text.trim())
    .map((n) => ({
      ...n,
      id: typeof n.id === 'string' ? n.id : 'node-' + Math.random().toString(36).slice(2, 10),
      span: Array.isArray(n.span) && n.span.length === 2 ? [Number(n.span[0]) || 0, Number(n.span[1]) || 0] : [0, 0],
      text: n.text,
      level: n.level === 2 ? 2 : 1,
      at: Number.isFinite(n.at) ? n.at : 0,
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

/* The slider's word: an honest number inside its fence. */
export function cleanWindow(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_WINDOW;
  return Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, n));
}

/* ---------- slot 7: "What remains" ---------- */

/* The newest three node texts, level descending (the widest memories
 * first), held to the slot's budget. '' when nothing has been remembered
 * yet, so the slot can be omitted from the receipt entirely. */
export function renderMemory(mem) {
  if (!mem || !Array.isArray(mem.nodes) || !mem.nodes.length) return '';
  const chosen = mem.nodes
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .sort((a, b) => (b.level - a.level) || ((b.at || 0) - (a.at || 0)))
    .slice(0, SLOT_NODES);
  let out = '';
  for (const node of chosen) {
    let text = node.text.trim();
    /* A single memory longer than the whole budget is trimmed to fit; a
     * later one that no longer fits is simply left at home this turn. */
    if (!out && text.length > SLOT_BUDGET) {
      text = text.slice(0, SLOT_BUDGET - 1).trimEnd() + '…';
    }
    const candidate = out ? out + '\n\n' + text : text;
    if (candidate.length > SLOT_BUDGET) break;
    out = candidate;
  }
  return out;
}

/* ---------- the prompt (human-voiced, kept in the code) ---------- */

const SYSTEM_PROMPT = [
  'You keep the memory of a slow, warm story told between two writers. Pages that',
  'have scrolled past the reading window come to you, and you fold them into a',
  'short note the storyteller will read later to remember what has already',
  'happened.',
  '',
  'Write about 150 words, plain and faithful. Keep what a future page might lean',
  'on: names, and how they’re spelled; what was promised, owed, hurt, or healed;',
  'where people went; what was decided true. Never invent, never embellish, never',
  'editorialize — if it wasn’t on the pages, it isn’t in the note. Write in the',
  'past tense, in the third person, as a record — not a retelling.',
  '',
  'No headings, no bullets, no commentary: the note only.',
].join('\n');

/* Exported for the harness. */
export function buildMemoryMessages(pages) {
  const body = (Array.isArray(pages) ? pages : [])
    .map((p) => (p && p.role === 'assistant' ? 'The storyteller wrote:\n' : 'The writer wrote:\n')
      + String(p && p.text || '').slice(0, 2000))
    .join('\n\n---\n\n');
  const user = [
    'Here are the pages to fold into memory:',
    '"""',
    body.slice(0, 16000),
    '"""',
    '',
    'Fold them into one note of about 150 words.',
  ].join('\n');
  return { system: SYSTEM_PROMPT, user };
}

/* The level-2 fold: three older notes become one. */
export function buildFoldMessages(nodes) {
  const body = (Array.isArray(nodes) ? nodes : [])
    .map((n, i) => 'Note ' + (i + 1) + ':\n' + String(n && n.text || '').slice(0, 4000))
    .join('\n\n---\n\n');
  const user = [
    'These earlier memory notes, oldest first, should become one note of about',
    '150 words — keeping what still matters, letting the small things rest:',
    '"""',
    body.slice(0, 16000),
    '"""',
    '',
    'Fold them together. The note only.',
  ].join('\n');
  return { system: SYSTEM_PROMPT, user };
}

/* ---------- the provider calls (non-streaming, small, cold) ---------- */

async function callAnthropic(connection, prompt, signal) {
  const base = (connection.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': connection.apiKey || '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: connection.model || 'claude-sonnet-4-5',
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    }),
  });
  if (!res.ok) return '';
  const body = await res.json();
  const piece = body && Array.isArray(body.content)
    ? body.content.find((b) => b && b.type === 'text' && typeof b.text === 'string')
    : null;
  return piece ? piece.text : '';
}

async function callOpenAI(connection, prompt, signal) {
  const base = (connection.baseUrl || 'https://api.openai.com')
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
  const headers = { 'content-type': 'application/json' };
  if (connection.apiKey) headers.authorization = `Bearer ${connection.apiKey}`;
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: connection.model || 'gpt-4o-mini',
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  if (!res.ok) return '';
  const body = await res.json();
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  const text = choice && choice.message && choice.message.content;
  return typeof text === 'string' ? text : '';
}

async function callWorker(connection, prompt, signal) {
  if (connection.type === 'anthropic') return callAnthropic(connection, prompt, signal);
  if (connection.type === 'openai') return callOpenAI(connection, prompt, signal);
  return '';
}

/* A memory note is plain prose, not JSON — fences and wrapper words are
 * stripped, the rest is trusted after a trim. '' means "nothing usable". */
export function parseMemoryAnswer(raw) {
  try {
    let text = String(raw || '');
    text = text.replace(/```(?:\w+)?/g, '');
    text = text.trim();
    if (text.length < 20) return '';
    if (text.length > 4000) text = text.slice(0, 3999).trimEnd() + '…';
    return text;
  } catch (err) {
    return '';
  }
}

/* ---------- the contract ---------- */

let nodeCounter = 0;
function nodeId() {
  nodeCounter += 1;
  return 'node-' + Date.now().toString(36) + '-' + nodeCounter;
}

/* The threshold gate, exported for the harness: how far the oldest
 * unremembered pages reach (the index one past the last page that must
 * leave the verbatim window), or -1 when nothing needs folding yet.
 * `covered` = one past the last message index any level-1 node already
 * holds. */
export function overflowEnd(historyLength, window, covered) {
  if (!Number.isFinite(historyLength) || historyLength <= window + OVERFLOW) return -1;
  const end = historyLength - window;
  return end > covered ? end : -1;
}

/* Fold what has scrolled past into a node; fold the oldest notes together
 * when too many gather. Runs only after the extractor, only in the
 * background, and NEVER throws into the chat path — every failure leaves
 * the store untouched and resolves quietly. */
export async function maybeSummarize({ connection, storyId, signal } = {}) {
  try {
    if (!connection || typeof connection !== 'object') return null;
    if (!storyId) return null;

    /* The switch and the window are app-wide (Settings → "How much the
     * story remembers"); keeper off means the keeper simply never wakes. */
    const keeperOn = await db.settings.get('memoryKeeper');
    if (keeperOn === false) return null;
    const window = cleanWindow(await db.settings.get('memoryWindow'));

    const history = await db.messages.list(storyId);
    const mem = await loadMemory(storyId);
    mem.window = window;

    /* The level-1 nodes always cover a prefix of the thread, so the next
     * page to fold is one past the deepest any of them reaches. */
    const level1 = mem.nodes.filter((n) => n.level === 1);
    const covered = level1.length
      ? Math.max(...level1.map((n) => n.span[1])) + 1
      : 0;

    let changed = false;

    const end = overflowEnd(history.length, window, covered);
    if (end !== -1) {
      const pages = history.slice(covered, end);
      const raw = await callWorker(connection, buildMemoryMessages(pages), signal);
      const text = parseMemoryAnswer(raw);
      if (!text) return null; // the worker went quiet — leave everything be
      mem.nodes.push({ id: nodeId(), span: [covered, end - 1], text, level: 1, at: Date.now() });
      changed = true;
    }

    /* Layering: more than six level-1 notes → the oldest three fold into
     * one level-2 note that remembers them all. */
    const ones = mem.nodes.filter((n) => n.level === 1)
      .sort((a, b) => (a.span[0] - b.span[0]) || ((a.at || 0) - (b.at || 0)));
    if (ones.length > L2_TRIGGER) {
      const batch = ones.slice(0, L2_BATCH);
      const raw = await callWorker(connection, buildFoldMessages(batch), signal);
      const text = parseMemoryAnswer(raw);
      if (text) {
        const ids = new Set(batch.map((n) => n.id));
        mem.nodes = mem.nodes.filter((n) => !ids.has(n.id));
        mem.nodes.push({
          id: nodeId(),
          span: [batch[0].span[0], batch[batch.length - 1].span[1]],
          text,
          level: 2,
          at: Date.now(),
        });
        changed = true;
      }
      /* A failed fold is fine: the level-1 notes simply stay as they are. */
    }

    if (changed) await saveMemory(storyId, mem);
    return changed ? mem : null;
  } catch (err) {
    return null;
  }
}
