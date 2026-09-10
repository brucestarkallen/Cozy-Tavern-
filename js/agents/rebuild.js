/* Cozy Tavern — agents/rebuild.js
 * M52: the gradual rebuilder — Summaryception's way. Nothing here ever
 * reads the whole story in one prompt: the past is walked six pages at a
 * time from turn 0, each batch read with the record that covers the pages
 * BEFORE it, and the result folded in before the next batch is read.
 *
 *   rebuildRecord({connection, storyId, onProgress, signal, stale})
 *     The record's lines are backed up (memoryBackup:<storyId>) and let go;
 *     the keeper then folds the pages again, holes-first, batch by batch,
 *     until nothing below the window is uncovered. The verifier and the
 *     detail auditor run on every line as they always do.
 *
 *   rebuildPeople({connection, storyId, brief, castNotes, onProgress, signal, stale})
 *     The character pages and the standings are backed up
 *     (peopleBackup:<storyId>) and let go; the founder's digits are written
 *     as the standings' origin; then every batch of six pages is read in
 *     order with the record-so-far, the pages-so-far and the standings-so-
 *     far as context, and answers with the scribe's deltas (people.set) and
 *     the reader's shifts (rel.shift toward the main character, cause
 *     quoting the beat). Applied through the closed vocabulary — logged,
 *     take-back-able as one sweep.
 *
 *   restoreRecord / restorePeople put the backups back.
 */

import { db } from '../store.js';
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { mcName } from '../engine/duels.js';
import { renderPeopleTiers } from '../engine/people.js';
import { renderRelationships } from '../engine/relationships.js';
import { loadMemory, saveMemory, maybeSummarize, dueRange, cleanWindow, cleanBatch, visiblePages, DEFAULT_BATCH } from './memory.js';
import { pageText } from '../assemble/stack.js';
import { readStatedStandings, samePersonLoose } from './founder.js';

const MAX_TOKENS = 3000;

/* ---------- the record ---------- */

export async function rebuildRecord({ connection, storyId, onProgress, signal, stale } = {}) {
  if (!connection || !storyId) return null;
  const mem = await loadMemory(storyId);
  await db.settings.set('memoryBackup:' + storyId, { at: Date.now(), nodes: mem.nodes });
  await saveMemory(storyId, { ...mem, nodes: [] });
  const history = visiblePages(await db.messages.list(storyId));
  const window = cleanWindow(mem.window || (await db.settings.get('memoryWindow')));
  const batch = cleanBatch(await db.settings.get('memoryBatch'));
  const toFold = Math.max(0, history.length - window);
  let folded = 0;
  let rounds = 0;
  while (rounds < 400) {
    if (stale && stale()) return null;
    const before = (await loadMemory(storyId)).nodes;
    if (!dueRange(history.length, window, before, batch)) break;
    await maybeSummarize({ connection, storyId, signal });
    const after = (await loadMemory(storyId)).nodes;
    if (after.length === before.length) break; /* nothing more could be written */
    folded = after.reduce((n, node) => n + (node.span[1] - node.span[0] + 1), 0);
    rounds += 1;
    if (typeof onProgress === 'function') onProgress({ folded, toFold });
  }
  return { folded, toFold, lines: (await loadMemory(storyId)).nodes.length };
}

export async function restoreRecord(storyId) {
  const backup = await db.settings.get('memoryBackup:' + storyId);
  if (!backup || !Array.isArray(backup.nodes)) return false;
  const mem = await loadMemory(storyId);
  await saveMemory(storyId, { ...mem, nodes: backup.nodes });
  return true;
}

/* ---------- the people ---------- */

const READER_SYSTEM = [
  'You are reading a story\'s past, six pages at a time, to rebuild what the house knows of its people.',
  'You are handed what came before (the record, the pages of the people as they stand, the standings as',
  'they stand) and the next few pages. Answer with what THESE pages change — nothing already written.',
  '',
  'Answer with JSON ONLY: {"deltas":[ ... ],"shifts":[ ... ]}',
  '  deltas — the scribe\'s: {"name":"Rias","field":"core|state|arc","text":"…"} — core is who they are (rarely',
  '           changes), state is how they are now, arc is how they stand with the main character and WHY it',
  '           moved. One per person per field at most; only for people these pages show.',
  '  shifts — the reader\'s: {"name":"Rias","axis":"p|r|s","delta":-20..20,"cause":"the beat, quoting the page"}',
  '           — a standing moves ONLY when these pages reveal something new about the main character or the',
  '           bond, through that person\'s own nature; typical ±1–5, a major moment ±10–20. Only toward the',
  '           main character. No revelation, no shift. Everything else in the story is not yours here.',
  'No commentary, no fences: the JSON only.',
].join('\n');

function recordUpTo(mem, pageIndex) {
  return (mem && Array.isArray(mem.nodes) ? mem.nodes : [])
    .filter((n) => n && Array.isArray(n.span) && n.span[1] < pageIndex)
    .sort((a, b) => a.span[0] - b.span[0])
    .map((n) => n.text.trim())
    .join('\n');
}

export function buildReaderMessages({ state, record, pages, mc }) {
  const people = renderPeopleTiers(state, { recentPages: [] }) || '(no pages of the people yet)';
  const standings = renderRelationships(state.relationships) || '(no standings yet)';
  const user = [
    'The main character is ' + (mc || 'the one the writer plays') + '.',
    '',
    'THE RECORD SO FAR (what the pages before these established):',
    record || '(nothing yet — these are the first pages)',
    '',
    'THE PAGES OF THE PEOPLE AS THEY STAND:',
    people,
    '',
    'THE STANDINGS AS THEY STAND (toward ' + (mc || 'the main character') + '):',
    standings,
    '',
    'THE NEXT PAGES:',
    pages.map((p) => (p.role === 'assistant' ? 'STORY: ' : 'PLAYER: ') + String(p.text || '').slice(0, 5000)).join('\n\n'),
    '',
    'What do these pages change? JSON only.',
  ].join('\n');
  return { system: withFictionFrame(READER_SYSTEM), user };
}

export function parseReaderAnswer(raw) {
  try {
    const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    for (const c of balancedCandidates(text, 5)) {
      const p = parseLenient(c);
      if (p && (Array.isArray(p.deltas) || Array.isArray(p.shifts))) {
        return {
          deltas: (Array.isArray(p.deltas) ? p.deltas : []).filter((d) => d && typeof d.name === 'string' && typeof d.field === 'string' && typeof d.text === 'string'),
          shifts: (Array.isArray(p.shifts) ? p.shifts : []).filter((s) => s && typeof s.name === 'string' && ['p', 'r', 's'].includes(s.axis) && Number.isFinite(Number(s.delta)) && typeof s.cause === 'string'),
        };
      }
    }
  } catch (err) { /* nothing usable */ }
  return { deltas: [], shifts: [] };
}

export async function rebuildPeople({ connection, storyId, brief = '', castNotes = '', onProgress, signal, stale } = {}) {
  if (!connection || !storyId) return null;
  const state = await loadState(storyId);
  const mc = mcName(state) !== 'the player' ? mcName(state) : '';
  await db.settings.set('peopleBackup:' + storyId, { at: Date.now(), characters: state.characters, relationships: state.relationships });
  /* let go, in the log, as one sweep */
  const clear = [
    ...Object.keys(state.relationships || {}).map((k) => ({ type: 'rel.clear', name: k, cause: 'rebuilt from the pages by the writer’s hand' })),
  ];
  let { state: s } = applyMutations(state, clear);
  s = { ...s, characters: {} };
  /* the standings' origin: the writer's digits */
  const digits = (await readStatedStandings({ connection, brief, castNotes, mc, signal }))
    .map((st) => ({ type: 'rel.set', name: st.name, p: st.p, r: st.r, s: st.s, cause: 'the brief states (P:' + st.p + ' R:' + st.r + ' S:' + st.s + ') toward ' + (mc || 'the main character') }));
  ({ state: s } = applyMutations(s, digits));
  await saveState(storyId, s);
  notify(storyId);

  const history = visiblePages(await db.messages.list(storyId)).map((m) => ({ role: m.role, text: pageText(m) }));
  const mem = await loadMemory(storyId);
  const batch = DEFAULT_BATCH;
  let read = 0;
  let applied = 0;
  let refused = 0;
  for (let from = 0; from < history.length; from += batch) {
    if (stale && stale()) return null;
    const pages = history.slice(from, from + batch);
    const current = await loadState(storyId);
    const prompt = buildReaderMessages({ state: current, record: recordUpTo(mem, from), pages, mc });
    const { text } = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: MAX_TOKENS, effort: 'off', signal });
    const answer = parseReaderAnswer(text);
    /* a name the ledger already knows wins over the reader's spelling —
     * "Rias" lands on "Rias Wells", never beside her */
    const known = [...Object.keys(current.relationships || {}), ...Object.keys(current.characters || {})];
    const resolve = (name) => known.find((k) => samePersonLoose(k, name)) || name;
    const mutations = [];
    for (const d of answer.deltas) {
      if (mc && samePersonLoose(d.name, mc) && d.field !== 'state') continue; /* the MC's core and arc are the story's */
      mutations.push({ type: 'people.set', name: resolve(d.name), field: d.field, text: d.text });
    }
    for (const sh of answer.shifts) {
      if (mc && samePersonLoose(sh.name, mc)) { refused += 1; continue; }
      mutations.push({ type: 'rel.shift', name: resolve(sh.name), axis: sh.axis, delta: Number(sh.delta), cause: sh.cause });
    }
    if (mutations.length) {
      const fresh = await loadState(storyId);
      const r = applyMutations(fresh, mutations);
      applied += r.applied.length;
      refused += r.rejected.length;
      await saveState(storyId, r.state);
      notify(storyId);
    }
    read = Math.min(history.length, from + batch);
    if (typeof onProgress === 'function') onProgress({ read, total: history.length });
  }
  return { read, total: history.length, applied, refused, digits: digits.length };
}

export async function restorePeople(storyId) {
  const backup = await db.settings.get('peopleBackup:' + storyId);
  if (!backup) return false;
  const state = await loadState(storyId);
  await saveState(storyId, { ...state, characters: backup.characters || {}, relationships: backup.relationships || {} });
  notify(storyId);
  return true;
}

export function rebuildRecordWords(r) {
  if (!r) return 'nothing to rebuild';
  return `rebuilt the record: folded ${r.folded} of ${r.toFold} pages into ${r.lines} ${r.lines === 1 ? 'line' : 'lines'}`;
}
export function rebuildPeopleWords(r) {
  if (!r) return 'nothing to rebuild';
  return `rebuilt the people: read ${r.read} of ${r.total} pages six at a time — ${r.digits} standings from the brief’s digits, ${r.applied} changes from the pages` + (r.refused ? ` (${r.refused} refused)` : '');
}
