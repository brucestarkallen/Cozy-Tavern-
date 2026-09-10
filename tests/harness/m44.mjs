/* M44 — Summaryception's checkpoint and coverage laws, held against the tavern: visible index space,
 * holes first, deletion slides the record, truncation, edit/swipe holes, no line beside its page,
 * sparse snapshots, the nearest checkpoint. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { dueRange, memoryAfterDeletion, memoryTruncatedAt, memoryWithoutPage, memoryForWindow, visiblePages, coveredSet, maybeSummarize, loadMemory, saveMemory } from '../../js/agents/memory.js';
import { pruneSnapshots, snapshotState, loadSnapshots, restoreNearestSnapshot, loadState, saveState, emptyState, SNAP_DENSE, SNAP_SPARSE_EVERY, SNAP_CAP } from '../../js/engine/state.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

const node = (a, b, text = 'l') => ({ id: 'n' + a, span: [a, b], text, level: 1, at: a });

test('M44-1 the record counts only visible pages; the window law reads the same list', () => {
  const history = [{ id: 'a' }, { id: 'h', hidden: true }, { id: 'b' }];
  eq(visiblePages(history).map((m) => m.id).join(','), 'a,b');
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/visiblePages\(history\)\.length - \(mem/.test(chat), 'the verbatim start is computed over visible pages');
  const mem = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(/const history = visiblePages\(await db\.messages\.list\(storyId\)\);/.test(mem), 'the keeper folds visible pages');
});

test('M44-2 holes first: a deleted or edited page below the window is due before the tail; a hole smaller than a batch folds as it is', () => {
  const nodes = [node(0, 5), node(12, 17)];
  eq(dueRange(60, 30, nodes, 6).join('-'), '6-12', 'the hole 6..11 is due first');
  eq(dueRange(60, 30, [node(0, 5), node(9, 17)], 6).join('-'), '6-9', 'a hole of three folds as three');
  eq(dueRange(60, 30, [node(0, 17)], 6).join('-'), '18-24', 'then the tail');
  eq(dueRange(35, 30, [], 6), null, 'five past the window is not yet a batch');
  eq(dueRange(60, 30, [node(0, 29)], 6), null, 'everything below the window is covered');
  eq([...coveredSet(nodes)].length, 12);
});

test('M44-3 deletion slides the record; truncation lets go of what reached the gone pages; an edit or swipe leaves a hole', () => {
  const mem = { window: 30, nodes: [node(0, 5, 'a'), node(6, 11, 'b'), node(12, 17, 'c')] };
  const d = memoryAfterDeletion(mem, 8);
  eq(d.nodes.map((n) => n.text + n.span.join('-')).join(' '), 'a0-5 c11-16', 'the covering line goes, the later one slides');
  const t = memoryTruncatedAt(mem, 12);
  eq(t.nodes.map((n) => n.text).join(''), 'ab');
  const e = memoryWithoutPage(mem, 3);
  eq(e.nodes.map((n) => n.text).join(''), 'bc');
  const w = memoryForWindow(mem, 12);
  eq(w.nodes.map((n) => n.text).join(''), 'ab', 'a line overlapping the verbatim window does not ride');
});

test('M44-4 end to end: a hole left by an edit is refilled by the keeper before the tail', async () => {
  const storyId = 'm44-hole';
  for (let i = 0; i < 48; i += 1) await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryKeeper', true); await db.settings.set('memoryWindow', 30); await db.settings.set('memoryBatch', 6);
  await saveMemory(storyId, { window: 30, nodes: [node(0, 5, 'first'), node(12, 17, 'third')] });
  const seen = [];
  const house = { fetch: async (url, opts) => {
    const body = JSON.parse(opts.body); const user = body.messages[body.messages.length - 1].content;
    let answer = 'NONE';
    if (/Write ONE line recording/.test(user)) { const m = user.match(/PLAYER \(the player\): page (\d+)/); seen.push(m ? Number(m[1]) : -1); answer = 'line for ' + (m ? m[1] : '?'); }
    else if (/Check for exactly two things/.test(user)) answer = 'NONE';
    const h = thinkingHouse({ answer }); return h.fetch(url, opts);
  } };
  await withHouse(house, () => maybeSummarize({ connection: HOUSES[0].conn, storyId }));
  eq(seen[0], 6, 'the hole was folded first');
  const mem = await loadMemory(storyId);
  assert(mem.nodes.some((n) => n.span[0] === 6 && n.span[1] === 11), 'the hole is covered');
});

test('M44-5 sparse snapshots: the newest stay dense, older ones thin out, a deep rewind lands on the nearest', async () => {
  const list = Array.from({ length: 200 }, (_, i) => ({ id: 'u' + i, snap: { i }, at: i }));
  const pruned = pruneSnapshots(list);
  assert(pruned.length <= SNAP_CAP && pruned.length > SNAP_DENSE);
  assert(pruned.slice(-SNAP_DENSE).every((e, k) => e.id === 'u' + (200 - SNAP_DENSE + k)), 'the newest are dense');
  const olderIds = pruned.slice(0, pruned.length - SNAP_DENSE).map((e) => Number(e.id.slice(1)));
  assert(olderIds.every((v, k) => k === 0 || v - olderIds[k - 1] === SNAP_SPARSE_EVERY), 'older ones every ' + SNAP_SPARSE_EVERY + 'th');
  /* the nearest */
  const storyId = 'm44-near';
  await db.settings.set('snapshots:' + storyId, [{ id: 'u10', snap: { ...emptyState(), place: { name: 'ten' } } }, { id: 'u20', snap: { ...emptyState(), place: { name: 'twenty' } } }]);
  await saveState(storyId, { ...emptyState(), place: { name: 'now' } });
  const order = Array.from({ length: 30 }, (_, i) => 'u' + i);
  const r = await restoreNearestSnapshot(storyId, order, 'u17');
  assert(r && !r.exact, 'nearest, not exact');
  eq((await loadState(storyId)).place.name, 'ten', 'landed on u10, the nearest at or before u17');
  eq((await loadSnapshots(storyId)).length, 1, 'newer snapshots dropped');
  const r2 = await restoreNearestSnapshot(storyId, order, 'u5');
  eq(r2, null, 'nothing earlier — the ledger stays');
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/if \(!r\.exact\) pendingAudit\.add\(story\.id\);/.test(chat), 'an inexact landing asks the auditor');
});

test('M44-6 the house wires the laws: retry truncates the record, delete slides it, swipe and edit leave a hole, the last page’s edit rewinds, an older page’s edit audits', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/memoryTruncatedAt\(await loadMemory\(story\.id\), k\)/.test(chat), 'retry/regenerate truncates');
  assert(/memoryAfterDeletion\(await loadMemory\(story\.id\), k\)/.test(chat), 'delete slides');
  eq((chat.match(/memoryWithoutPage\(await loadMemory\(story\.id\), k\)/g) || []).length, 3, 'swipe-new, swipe-walk, edit leave a hole');
  const edit = chat.slice(chat.indexOf('const isLast = !history.slice'), chat.indexOf('const isLast = !history.slice') + 700);
  assert(/if \(isLast\) \{[\s\S]*rewindTo\(story, history, boundary\.id\)/.test(edit) && /else \{[\s\S]*pendingAudit\.add\(story\.id\)/.test(edit));
  assert(/pendingAudit\.delete\(story\.id\);/.test(chat), 'the auditor honors a pending audit');
});
