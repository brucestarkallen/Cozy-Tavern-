/* Cozy Tavern — agents/editor.js
 * The editor (M10): the standing craft critique. Where the continuity
 * reader notes drift in what HAPPENED, the editor reads HOW the telling is
 * going — one NORTH STAR line and a short numbered list of systemic notes,
 * revised (not rewritten) each time it fires, and diffed against the
 * previous reading so the writer can see what kept and what changed.
 *
 * It fires three ways: by hand (the panel's Critique button), on a cadence
 * (every N turns of the story, when enabled), and on episode end (when the
 * storyteller marks [EPISODE_END] and the editor is on). When enabled and
 * a critique stands, it rides the dynamic tail as its own receipt-named
 * slot — "The editor's eye".
 *
 * Background only; it never throws into the chat path, and a failed
 * reading leaves the standing critique exactly as it was.
 *
 * Store: settings under `editor:<storyId>` =
 *   {enabled, everyN, critique, prev, lastTurn, lastAt}
 * critique = {northStar, notes:[...], at, turn}
 */

import { db } from '../store.js';
import { loadState, renderStateFacts } from '../engine/state.js';
import { pageText } from '../assemble/stack.js';
import { callModel } from './housekeeper.js';

const KEY_PREFIX = 'editor:';
const DEFAULT_EVERY_N = 8;
const RECENT_PAGES = 12;
const PAGE_CAP = 3000;

/* ---------- the state ---------- */

function cleanCritique(c) {
  if (!c || typeof c !== 'object') return null;
  const northStar = typeof c.northStar === 'string' ? c.northStar.trim() : '';
  const notes = (Array.isArray(c.notes) ? c.notes : [])
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean);
  if (!northStar && !notes.length) return null;
  return {
    northStar,
    notes,
    at: Number.isFinite(c.at) ? c.at : 0,
    turn: Number.isFinite(c.turn) ? c.turn : 0,
  };
}

export async function loadEditor(storyId) {
  const fresh = { enabled: false, everyN: DEFAULT_EVERY_N, critique: null, prev: null, lastTurn: 0, lastAt: 0 };
  if (!storyId) return fresh;
  try {
    const saved = await db.settings.get(KEY_PREFIX + storyId);
    if (!saved || typeof saved !== 'object') return fresh;
    return {
      enabled: saved.enabled === true,
      everyN: Number.isFinite(saved.everyN) && saved.everyN >= 1 ? Math.round(saved.everyN) : DEFAULT_EVERY_N,
      critique: cleanCritique(saved.critique),
      prev: cleanCritique(saved.prev),
      lastTurn: Number.isFinite(saved.lastTurn) ? saved.lastTurn : 0,
      lastAt: Number.isFinite(saved.lastAt) ? saved.lastAt : 0,
    };
  } catch (err) {
    return fresh;
  }
}

export async function saveEditor(storyId, patch) {
  if (!storyId) return null;
  const current = await loadEditor(storyId);
  const next = { ...current, ...(patch || {}) };
  await db.settings.set(KEY_PREFIX + storyId, next);
  return next;
}

/* ---------- the critique's shape ---------- */

/* The injection text for the stack ("The editor's eye"). '' unless the
 * editor is on AND a critique stands — the slot is omitted otherwise. */
export function renderEditorNote(e) {
  if (!e || e.enabled !== true) return '';
  const c = cleanCritique(e.critique);
  if (!c) return '';
  const lines = [];
  if (c.northStar) lines.push('NORTH STAR: ' + c.northStar);
  c.notes.forEach((n, i) => lines.push((i + 1) + '. ' + n));
  return lines.join('\n');
}

/* Kept vs changed, note by note, between two readings. Notes match by
 * their normalized words; a reworded note reads as retired + added. */
export function diffCritique(prev, next) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const prevNotes = (prev && Array.isArray(prev.notes) ? prev.notes : []).map(norm);
  const nextNotes = (next && Array.isArray(next.notes) ? next.notes : []);
  const prevSet = new Set(prevNotes);
  const nextSet = new Set(nextNotes.map(norm));
  const kept = nextNotes.filter((n) => prevSet.has(norm(n)));
  const added = nextNotes.filter((n) => !prevSet.has(norm(n)));
  const retired = (prev && Array.isArray(prev.notes) ? prev.notes : [])
    .filter((n) => !nextSet.has(norm(n)));
  const northStarChanged = Boolean(next && next.northStar)
    && norm(prev && prev.northStar) !== norm(next && next.northStar);
  return { kept, added, retired, northStarChanged };
}

/* Parse the editor's answer: a NORTH STAR line plus numbered notes.
 * Tolerant — a reading with no usable shape resolves null and the standing
 * critique stays as it was. */
export function parseCritique(raw) {
  try {
    const text = String(raw == null ? '' : raw).replace(/```(?:\w+)?/g, '');
    let northStar = '';
    const notes = [];
    for (const line of text.split('\n')) {
      const star = /^\s*(?:\*\*)?north\s*star(?:\*\*)?\s*[:—–-]\s*(.+?)(?:\*\*)?\s*$/i.exec(line);
      if (star) { northStar = star[1].trim(); continue; }
      const numbered = /^\s*(?:\*\*)?\d+\s*[.)]\s*(?:\*\*)?\s*(.+?)(?:\*\*)?\s*$/.exec(line);
      if (numbered) notes.push(numbered[1].trim());
    }
    if (!northStar && !notes.length) return null;
    return { northStar, notes };
  } catch (err) {
    return null;
  }
}

/* ---------- the reading ---------- */

const EDITOR_SYSTEM = [
  'You are the editor of a slow, warm story told between two writers. You',
  'never touch the words; you read the recent pages and keep a standing craft',
  'critique — the patterns a good second set of eyes would name kindly and',
  'plainly.',
  '',
  'Answer in exactly this shape:',
  'NORTH STAR: one line — the single craft truth this tale most needs now',
  '1. a systemic note — a pattern across pages, never a line edit',
  '2. another, if one is truly there (three to five notes at most; fewer is',
  'better; a note that no longer holds is simply dropped)',
  '',
  'When a previous critique is shown, revise it rather than rewrite it: keep',
  'what still holds word for word, reword what shifted, drop what is mended.',
  'Notes are about HOW the tale is being told — pacing, dialogue, agency,',
  'consequence — never about what happens in it. No preamble, no sign-off.',
].join('\n');

/* Exported for the harness: the two messages any provider flavor gets. */
export function buildEditorMessages({ story, messages, state, prev } = {}) {
  const parts = [];
  parts.push('The story is “' + ((story && story.title) || 'an untitled tale') + '”.');
  const brief = story && typeof story.brief === 'string' ? story.brief.trim() : '';
  if (brief) parts.push('Its brief:\n' + brief);
  const ledger = renderStateFacts(state);
  if (ledger) parts.push('What the ledger says:\n' + ledger);
  const visible = (Array.isArray(messages) ? messages : []).filter((m) => m && !m.hidden);
  const pages = visible.slice(-RECENT_PAGES).map((m) => {
    const speaker = m.role === 'assistant' ? 'THE STORYTELLER' : 'THE WRITER';
    let text = pageText(m);
    if (text.length > PAGE_CAP) text = text.slice(0, PAGE_CAP - 1).trimEnd() + '…';
    return speaker + ':\n' + text;
  }).join('\n\n');
  if (pages) parts.push('The latest pages:\n' + pages);
  if (prev && (prev.northStar || (Array.isArray(prev.notes) && prev.notes.length))) {
    const lines = [];
    if (prev.northStar) lines.push('NORTH STAR: ' + prev.northStar);
    (prev.notes || []).forEach((n, i) => lines.push((i + 1) + '. ' + n));
    parts.push('The critique now standing — revise it, don’t rewrite it:\n' + lines.join('\n'));
  }
  parts.push('Read, and give the standing critique.');
  return { system: EDITOR_SYSTEM, user: parts.join('\n\n') };
}

/* Fire one reading. Never throws; {ok:true, critique, diff} or
 * {ok:false, error}. A failed parse leaves the standing critique be. */
export async function runEditor({ connection, story, storyId, call, signal } = {}) {
  try {
    const caller = typeof call === 'function' ? call : (req) => callModel(connection, req);
    const tale = story || await db.stories.get(storyId);
    const [messages, state, standing] = await Promise.all([
      db.messages.list(storyId),
      loadState(storyId),
      loadEditor(storyId),
    ]);
    const prompt = buildEditorMessages({ story: tale, messages, state, prev: standing.critique });
    const answer = await caller({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: 700,
      signal,
    });
    if (answer && answer.error) return { ok: false, error: answer.error };
    const parsed = parseCritique(answer && answer.text);
    if (!parsed) return { ok: false, error: 'the editor’s reading wouldn’t hold a shape' };
    const critique = {
      northStar: parsed.northStar,
      notes: parsed.notes,
      at: Date.now(),
      turn: Number.isFinite(state.turn) ? state.turn : 0,
    };
    const diff = diffCritique(standing.critique, critique);
    await saveEditor(storyId, {
      prev: standing.critique,
      critique,
      lastTurn: critique.turn,
      lastAt: critique.at,
    });
    return { ok: true, critique, diff };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'the editor stumbled' };
  }
}

/* The gate in front of runEditor. reason: 'manual' (the writer asked —
 * fires even when the editor is off, so the panel can show what it would
 * say), 'cadence' (every N turns, only when enabled), 'episode end' (only
 * when enabled). Returns null when the gate says rest. */
export async function maybeRunEditor({ connection, story, storyId, reason, call, signal } = {}) {
  try {
    const e = await loadEditor(storyId);
    if (reason !== 'manual' && e.enabled !== true) return null;
    if (reason === 'cadence') {
      const state = await loadState(storyId);
      const turn = Number.isFinite(state.turn) ? state.turn : 0;
      if (turn - e.lastTurn < e.everyN) return null;
    }
    return runEditor({ connection, story, storyId, call, signal });
  } catch (err) {
    return null;
  }
}
