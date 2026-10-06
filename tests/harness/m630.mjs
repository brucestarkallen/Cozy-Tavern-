/* M630 — his: "1. add bulk change pages to another project; 2. add a giant project to store multiple projects inside".
 * Laws RUN the store's giant projects and read back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';

test('M630-1 GIANT PROJECTS HOLD SHELVES — made, named, renamed; a shelf stands in one by its giantId; taking one down leaves its shelves standing and every tale where it was', async () => {
  const g = await db.giants.create({ name: 'Bleach runs' });
  assert((await db.giants.list()).some((x) => x.id === g.id && x.name === 'Bleach runs'), 'made and listed');
  eq((await db.giants.rename(g.id, 'Bleach, every run')).name, 'Bleach, every run', 'renamed');
  const a = await db.projects.create({ name: 'Run one' });
  const b = await db.projects.create({ name: 'Run two' });
  await db.projects.update(a.id, { giantId: g.id });
  await db.projects.update(b.id, { giantId: g.id });
  const t = await db.stories.create({ title: 'Kara at the gate', projectId: a.id });
  eq((await db.projects.list()).filter((p) => p.giantId === g.id).length, 2, 'two shelves in it');
  eq(await db.giants.remove(g.id), true, 'taken down');
  assert(!(await db.giants.list()).some((x) => x.id === g.id), 'gone from the list');
  const after = await db.projects.list();
  assert(after.some((p) => p.id === a.id && !p.giantId) && after.some((p) => p.id === b.id && !p.giantId), 'its shelves stand on their own, both still there');
  eq((await db.stories.get(t.id)).projectId, a.id, 'and the tale is still on its shelf');
  eq(await db.giants.remove('no-such'), false, 'taking down one that is not there changes nothing');
});
