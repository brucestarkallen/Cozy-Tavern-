/* M311 — a shelf that lost its row is put back: the tales still know where they stood. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db, shelvesOf, keepWhatWasNeverLetGo } from '../../js/store.js';

test('M311-1 the list of shelves is lost; every tale comes back onto its shelf without one of them being touched', async () => {
  const raven = await db.projects.create({ name: 'Ravenwood' });
  const dxd = await db.projects.create({ name: 'High School DxD' });
  const tales = [];
  for (let i = 0; i < 6; i += 1) tales.push(await db.stories.create({ title: 'Tale ' + i, projectId: i < 3 ? raven.id : i < 5 ? dxd.id : undefined }));
  /* the harness shares one store: only THIS test's tales and shelves are counted */
  const mineIds = new Set(tales.map((t) => t.id));
  const myTales = async () => (await db.stories.list()).filter((s) => mineIds.has(s.id));
  const myShelves = async () => (await db.projects.list()).filter((p) => p.id === raven.id || p.id === dxd.id);
  const before = (await myTales()).map((s) => s.id + ':' + s.projectId + ':' + s.updatedAt).sort().join('|');
  /* the loss, exactly as it happens: the one row goes */
  await db.settings.delete('projects');
  let grouped = shelvesOf(await myTales(), await myShelves());
  eq(grouped.shelves.length, 0); eq(grouped.loose.length, 6, 'fixture: every tale stands loose — the writer’s screen');
  /* the heal, with nothing to go on but the tales themselves */
  const back = (await db.projects.heal({})).filter((p) => p.id === raven.id || p.id === dxd.id);
  eq(back.length, 2, 'two shelves put back');
  eq(back.map((p) => p.id).sort().join(','), [raven.id, dxd.id].sort().join(','), 'under their own ids');
  assert(back.every((p) => /^Recovered shelf \d+$/.test(p.name)), 'named for the writer to rename — once a shelf, never once a tale: ' + back.map((p) => p.name).join(', '));
  grouped = shelvesOf(await myTales(), await myShelves());
  eq(grouped.shelves.map((g) => g.stories.length).sort().join(','), '2,3', 'every tale where it stood');
  eq(grouped.loose.length, 1, 'and the one that was loose is still loose');
  eq((await myTales()).map((s) => s.id + ':' + s.projectId + ':' + s.updatedAt).sort().join('|'), before, 'no tale was written to — not even its date');
  eq((await db.projects.heal({})).length, 0, 'once is enough');
  /* and with the names the device could still find */
  await db.settings.delete('projects');
  const named = (await db.projects.heal({ [raven.id]: { name: 'Ravenwood', createdAt: raven.createdAt }, [dxd.id]: { name: 'High School DxD', createdAt: dxd.createdAt } })).filter((p) => p.id === raven.id || p.id === dxd.id);
  eq(named.map((p) => p.name).sort().join(','), 'High School DxD,Ravenwood', 'the old names come back with them');
  eq((await myShelves()).map((p) => p.name).join(','), 'Ravenwood,High School DxD', 'in the order the shelves were made');
  /* a shelf that still stands is never doubled */
  const again = await db.projects.heal({ [raven.id]: { name: 'Something else' } });
  eq(again.length, 0); eq((await myShelves()).length, 2);
});

test('M311-2 a browser that holds only part of the house cannot take the rest from the device: what it lacks rides its push as the device has it — and what it itself let go is still let go', async () => {
  const house = (settings, connections, stories = []) => JSON.stringify({ namespace: 'cozy-tavern', kind: 'house', settings, connections, stories });
  const device = house(
    [{ key: 'projects', value: [{ id: 'p1', name: 'Ravenwood' }] }, { key: 'cast:abc', value: { name: 'Rias' } }, { key: 'theme', value: 'magma' }, { key: 'modules', value: [{ id: 'm1' }] }, { key: 'state:tale1', value: { big: true } }],
    [{ id: 'c1', label: 'DeepSeek' }, { id: 'c2', label: 'Kimi' }], [{ id: 'tale1' }]);
  /* the crashed browser: it holds the theme and one connection, and nothing else */
  const partial = house([{ key: 'theme', value: 'deep' }], [{ id: 'c1', label: 'DeepSeek' }], [{ id: 'tale1' }]);
  const kept = keepWhatWasNeverLetGo(partial, device, []);
  const out = JSON.parse(kept.json);
  eq(out.settings.map((r) => r.key).sort().join(','), 'cast:abc,modules,projects,theme', 'the shelves, the cast card and the rulebook ride its push — it never let them go');
  eq(out.settings.find((r) => r.key === 'theme').value, 'deep', 'a row it DOES hold is its own to speak for');
  eq(out.connections.map((c) => c.id).sort().join(','), 'c1,c2');
  assert(!out.settings.some((r) => r.key === 'state:tale1'), 'a tale’s row is never the house’s');
  eq(kept.adopt.settings.map((r) => r.key).sort().join(','), 'cast:abc,modules,projects', 'and it takes in what it was missing');
  /* a real letting-go still propagates: this browser deleted the cast card and the Kimi connection */
  const spoke = keepWhatWasNeverLetGo(partial, device, ['cast:abc', 'c2']);
  const said = JSON.parse(spoke.json);
  assert(!said.settings.some((r) => r.key === 'cast:abc') && !said.connections.some((c) => c.id === 'c2'), 'what it let go stays let go');
  assert(said.settings.some((r) => r.key === 'projects'), 'and only that');
  /* nothing on the device, or a copy that will not read: the book goes as it is */
  eq(keepWhatWasNeverLetGo(partial, null, []).json, partial);
  eq(keepWhatWasNeverLetGo(partial, '{not json', []).json, partial);
  /* taken in for real */
  await db.adoptHouseRows(kept.adopt);
  eq(((await db.settings.get('projects')) || []).map((p) => p.name).join(','), 'Ravenwood');
});
