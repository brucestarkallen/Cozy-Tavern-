/* Cozy Tavern — harness law of M752 (followup 8): A SETTING READ WHILE ITS OWN WRITE IS UNDER WAY IS THE NEW VALUE.
 * HIS (15 October 2026): "when I opened a large archive and opened its sub project, it suddenly threw me back to the large
 * archive". His taps write the shelf folds without waiting; a shelf redraw on its way read them from the store's cache in
 * that moment — the value from before his taps — and drew the shelf shut again. Runs the real store (idb-shim). */
import './idb-shim.mjs';
import { test, eq } from './lib.mjs';
import { db } from '../../js/store.js';

test('M752-ST1 A SETTING READ WHILE ITS WRITE IS UNDER WAY IS THE VALUE BEING WRITTEN (the shelf redraw read the folds from before his taps and shut the shelf he had opened): get, getMany, after set, setMany, delete and deleteMany; another key never waits', async () => {
  const K = 'm752-store:shelfCollapsed';
  await db.settings.set(K, { giant: true, shelf: true });          /* both folded, as he left them */
  const open = db.settings.set(K, {});                              /* his taps: both opened, not waited for */
  eq(JSON.stringify(await db.settings.get(K)), '{}', 'a read during the write gets what he just did');
  await open;
  const many = db.settings.setMany([[K, { shelf: true }], [K + ':sort', 'name']]);
  const got = await db.settings.getMany([K, K + ':sort']);
  eq(JSON.stringify(got.get(K)) + ' ' + got.get(K + ':sort'), '{"shelf":true} name', 'getMany during setMany');
  await many;
  const gone = db.settings.delete(K);
  eq(await db.settings.get(K), undefined, 'a read during a delete');
  await gone;
  await db.settings.set(K + ':a', 1); await db.settings.set(K + ':b', 1);
  const goneMany = db.settings.deleteMany([K + ':a', K + ':b']);
  eq(String(await db.settings.get(K + ':a')) + String(await db.settings.get(K + ':b')), 'undefinedundefined', 'a read during deleteMany');
  await goneMany;
  await db.settings.set('m752-store:other', 'kept');
  let landed = false;
  const slow = db.settings.set(K, 'x').then(() => { landed = true; });
  eq(await db.settings.get('m752-store:other'), 'kept', 'another key is read');
  await slow; eq(landed, true, 'fixture: the write landed');
});
