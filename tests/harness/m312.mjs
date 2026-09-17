/* M312 — the keys and the house book are read without touching every row of every tale. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';

test('M312-1 the house book and the list of keys hold exactly what they held — read by key now, not by loading every checkpoint of every tale', async () => {
  const tale = await db.stories.create({ title: 'a tale with checkpoints' });
  await db.settings.set('snapshots:' + tale.id, [{ id: 't1', snap: { page: 1, filler: 'x'.repeat(50000) } }]);
  await db.settings.set('state:' + tale.id, { page: 1 });
  await db.settings.set('cast:m312card', { id: 'm312card', name: 'Rias Gremory' });
  await db.settings.set('m312-house-setting', { warm: true });
  await db.settings.set('state:ghost-of-a-deleted-tale', { orphan: true });
  const keys = await db.settings.keys();
  for (const k of ['snapshots:' + tale.id, 'state:' + tale.id, 'cast:m312card', 'm312-house-setting']) assert(keys.includes(k), 'the list of keys names ' + k);
  assert(keys.every((k) => typeof k === 'string'), 'names only');
  const house = JSON.parse(await db.exportHouse());
  const names = house.settings.map((r) => r.key);
  assert(names.includes('cast:m312card') && names.includes('m312-house-setting'), 'the house’s own rows ride');
  eq(JSON.stringify(house.settings.find((r) => r.key === 'm312-house-setting').value), '{"warm":true}', 'whole, as written');
  assert(!names.some((k) => k === 'snapshots:' + tale.id || k === 'state:' + tale.id), 'a tale’s rows are never the house’s');
  assert(!names.includes('state:ghost-of-a-deleted-tale'), 'nor an orphan’s (M160)');
  assert(house.stories.some((s) => s.id === tale.id) && Array.isArray(house.connections), 'the shelf and the connections ride as before');
});
