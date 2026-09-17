/* M301: the kept thinking's rows belong to their tale; the one display order. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { byName } from '../../js/providers/order.js';

test('M301-1: byName reads A to Z — case and accents ignored, numbers in number order, ties as they were made — and never touches the list it was handed', () => {
  const rows = [
    { id: 'a', label: 'zephyr 10', createdAt: 1 },
    { id: 'b', label: 'Alpha', createdAt: 2 },
    { id: 'c', label: 'zephyr 9', createdAt: 3 },
    { id: 'd', label: 'émile', createdAt: 4 },
    { id: 'e', label: 'beta', createdAt: 5 },
    { id: 'f', label: 'ALPHA', createdAt: 6 },
    { id: 'g', label: '', createdAt: 7 },
    { id: 'h', createdAt: 8 },
  ];
  const before = rows.map((r) => r.id).join('');
  const out = byName(rows);
  eq(out.map((r) => r.id).join(''), 'ghbfedca', 'the nameless first, then Alpha (made first) before ALPHA, beta, émile, zephyr 9, zephyr 10');
  eq(rows.map((r) => r.id).join(''), before, 'the list handed in is as it was — the resolvers’ "first one made" still is');
  eq(byName(null).length, 0, 'nothing in, nothing out');
  eq(byName([{ id: 'x', name: 'b' }, { id: 'y', name: 'A' }], (r) => r.name).map((r) => r.id).join(''), 'yx', 'any name will do');
});

test('M301-2: db.connections.list() stays in the order they were made — the resolvers’ fallback does not move with a name', async () => {
  const z = await db.connections.add({ label: 'zzz first made', type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'm', createdAt: 10 });
  const a = await db.connections.add({ label: 'aaa made later', type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'm', createdAt: 20 });
  const mine = (await db.connections.list()).filter((c) => c.id === z.id || c.id === a.id);
  eq(mine.map((c) => c.label).join(' | '), 'zzz first made | aaa made later');
  await db.connections.remove(z.id); await db.connections.remove(a.id);
});

test('M301-3: a kept thinking is its tale’s own row — it rides the tale’s book, never the house’s, goes with the tale, and an orphan is swept', async () => {
  const tale = await db.stories.create({ title: 'a tale with a cut thought' });
  await db.settings.set('cutThinking:' + tale.id, { text: 'it was weighing the room', why: 'stopped', ts: 1 });
  await db.settings.set('hkCut:' + tale.id, { text: 'the housekeeper was weighing it', ts: 1, storyId: tale.id });
  await db.settings.set('cutThinking:a-tale-long-gone', { text: 'orphan', ts: 1 });
  await db.settings.set('hkCut:a-tale-long-gone', { text: 'orphan', ts: 1 });
  await db.settings.set('hkDraft:a-tale-long-gone', 'an orphaned question');

  const book = JSON.parse(await db.exportStory(tale.id));
  const bookKeys = book.settings.map((r) => r.key);
  assert(bookKeys.includes('cutThinking:' + tale.id) && bookKeys.includes('hkCut:' + tale.id), 'both ride the tale’s book: ' + bookKeys.join(', '));
  const houseKeys = JSON.parse(await db.exportHouse()).settings.map((r) => r.key);
  for (const k of ['cutThinking:' + tale.id, 'hkCut:' + tale.id, 'cutThinking:a-tale-long-gone', 'hkCut:a-tale-long-gone', 'hkDraft:a-tale-long-gone']) {
    assert(!houseKeys.includes(k), 'never the house book: ' + k);
  }
  await db.sweepOrphans();
  let keys = await db.settings.keys();
  assert(!keys.includes('cutThinking:a-tale-long-gone') && !keys.includes('hkCut:a-tale-long-gone') && !keys.includes('hkDraft:a-tale-long-gone'), 'the orphans are swept');
  assert(keys.includes('cutThinking:' + tale.id) && keys.includes('hkCut:' + tale.id), 'a living tale’s stand');
  await db.stories.remove(tale.id);
  keys = await db.settings.keys();
  assert(!keys.includes('cutThinking:' + tale.id) && !keys.includes('hkCut:' + tale.id), 'and they go with the tale');
});
