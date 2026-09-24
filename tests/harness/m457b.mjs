/* M457 (canon): each story its own canon settings, one library of wikis for all, and the ledger's people handed to the
 * wiki discovery. Runs the real bridge (the vendored extension loaded) and the real store. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { canonSettings, setCanonSetting, useStorySettings, canonLibrary, addToLibrary, removeFromLibrary, canonSavedWikis } from '../../js/canon/bridge.js';

test('M457-4 EACH STORY ITS OWN CANON SETTINGS — a change in one never reaches another; a story that never looked anything up starts with nowhere to look', async () => {
  await db.settings.set('canonGroundingSettings', { wikis: 'bleach', reportUnverified: true, savedWikis: [] }).catch(() => {});
  const a = await db.stories.create({ title: 'Bleach story' });
  const b = await db.stories.create({ title: 'Another story' });
  const sa = await canonSettings(a.id);
  eq(String(sa.wikis || ''), '', 'nowhere to look until it finds its own');
  await setCanonSetting('reportUnverified', false, a.id);
  await setCanonSetting('wikis', 'bleach', a.id);
  const sb = await canonSettings(b.id);
  eq(sb.reportUnverified !== false, true, 'the other story keeps its own switch');
  eq(String(sb.wikis || ''), '', 'and its own (empty) place to look');
  const back = await canonSettings(a.id);
  eq(back.reportUnverified, false, 'the first story kept its change');
  eq(back.wikis, 'bleach', 'and its own wiki');
});

test('M457-5 ONE LIBRARY FOR EVERY STORY — added, offered, taken out; the wikis a story used join it', async () => {
  await addToLibrary('bleach', 'highschooldxd');
  let lib = await canonLibrary();
  assert(lib.includes('bleach') && lib.includes('highschooldxd'), JSON.stringify(lib));
  eq(JSON.stringify(await canonSavedWikis()), JSON.stringify(lib), 'the story rooms are offered the same list');
  await removeFromLibrary('highschooldxd');
  lib = await canonLibrary();
  assert(!lib.includes('highschooldxd') && lib.includes('bleach'), 'taken out: ' + JSON.stringify(lib));
  const c = await db.stories.create({ title: 'Third' });
  await useStorySettings(c.id);
  await setCanonSetting('savedWikis', ['naruto'], c.id);
  await new Promise((r) => setTimeout(r, 30));
  assert((await canonLibrary()).includes('naruto'), 'a wiki a story used joins the library');
});
