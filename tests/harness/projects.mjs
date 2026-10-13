/* Projects & the update nudge (M16): the shelves a tale can rest on, the
 * version you can see, and the door that tells you the tavern has a new
 * coat. The bug classes encoded so they can never silently return:
 *  1. db.projects CRUD — list in shelf order, create, rename.
 *  2. A story carries projectId; moving it is a plain update; loose is
 *     the absence of a shelf.
 *  3. Taking a shelf down NEVER deletes its tales — they stand loose.
 *  4. shelvesOf groups in interaction-recency order; a bent or unknown
 *     projectId stands loose.
 *  5. The registration wires updatefound + controllerchange (with the
 *     reload-once guard).
 *  6. The version word stands in Settings; the tour names the housekeeper.
 *  7. The sidebar renders the grouping and persists the folded shelves. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db, shelvesOf } from '../../js/store.js';
import { updatePage, copyOfDb } from './updatesim.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('M16 projects: create / rename / list in shelf order', async () => {
  const a = await db.projects.create({ name: 'Ember novels' });
  const b = await db.projects.create({ name: '' }); /* the kind default */
  eq(b.name, 'A new shelf', 'an unnamed shelf gets the kind default');
  const renamed = await db.projects.rename(a.id, 'The ember novels');
  eq(renamed.name, 'The ember novels', 'rename lands');
  const all = await db.projects.list();
  assert(all.length >= 2, 'both shelves listed');
  assert(all[0].createdAt <= all[1].createdAt, 'shelf order is creation order');
  assert(all.some((p) => p.id === a.id && p.name === 'The ember novels'), 'renamed shelf lists');
  const gone = await db.projects.rename('no-such-shelf', 'x');
  eq(gone, undefined, 'renaming a missing shelf is a quiet no-op');
});

test('M16 a story gains a shelf; moving it is a plain update', async () => {
  const shelf = await db.projects.create({ name: 'Move me' });
  const other = await db.projects.create({ name: 'Over here' });
  const story = await db.stories.create({ title: 'A restless tale', projectId: shelf.id });
  eq(story.projectId, shelf.id, 'a tale may begin on a shelf');
  await db.stories.update(story.id, { projectId: other.id });
  eq((await db.stories.get(story.id)).projectId, other.id, 'the move lands');
  await db.stories.update(story.id, { projectId: null });
  eq((await db.stories.get(story.id)).projectId, null, 'loose again');
});

test('M16 taking a shelf down NEVER deletes its tales', async () => {
  const shelf = await db.projects.create({ name: 'Doomed shelf' });
  const one = await db.stories.create({ title: 'Tale one', projectId: shelf.id });
  const two = await db.stories.create({ title: 'Tale two', projectId: shelf.id });
  await db.messages.append(one.id, { role: 'user', text: 'keep these words' });
  const fell = await db.projects.remove(shelf.id);
  eq(fell, true, 'the shelf comes down');
  eq((await db.projects.list()).some((p) => p.id === shelf.id), false, 'the shelf is gone');
  const after1 = await db.stories.get(one.id);
  const after2 = await db.stories.get(two.id);
  assert(after1 && after2, 'both tales survive');
  assert(after1.projectId == null && after2.projectId == null, 'they stand loose now');
  eq((await db.messages.list(one.id)).length, 1, 'the pages survive too');
  eq(await db.projects.remove(shelf.id), false, 'removing twice is a quiet no-op');
});

test('M16 shelvesOf: grouping, recency order, bent ids stand loose', () => {
  const shelves = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }];
  const tales = [
    { id: 's1', projectId: 'p1', updatedAt: 30 }, /* most recent first */
    { id: 's2', projectId: 'p2', updatedAt: 25 },
    { id: 's3', projectId: 'p1', updatedAt: 20 },
    { id: 's4', updatedAt: 15 },                   /* never shelved */
    { id: 's5', projectId: 'bent', updatedAt: 10 } /* a shelf that is gone */
  ];
  const grouped = shelvesOf(tales, shelves);
  eq(grouped.shelves.length, 2, 'both shelves come back');
  eq(grouped.shelves[0].project.id, 'p1', 'shelf order is shelf order');
  eq(grouped.shelves[0].stories.map((s) => s.id).join(','), 's1,s3',
    'a shelf reads in interaction-recency order');
  eq(grouped.shelves[1].stories.map((s) => s.id).join(','), 's2', 'the second shelf');
  eq(grouped.loose.map((s) => s.id).join(','), 's4,s5',
    'unshelved and bent ids both stand loose');
  const empty = shelvesOf(null, null);
  eq(empty.shelves.length, 0, 'no shelves, no crash');
  eq(empty.loose.length, 0, 'no tales, no crash');
});

/* M720 (a87d357, "Make browser updates reconcile versions and wait for safe reload") replaced the nudge — a toast "A new coat
 * is on the tavern — tap to refresh", and a reload on controllerchange behind a hadController latch that, on a page first
 * opened before any worker, never let it reload at all — with js/updates.js: the page asks the worker that controls it
 * which VERSION it serves; another one is an update, and the page reloads ONCE by itself when nothing would be lost, and
 * says why while it waits. This law read app.js's old lines; it runs the coordinator now, in the page of updatesim.mjs. */
test('M16 the update nudge is wired (updatefound + controllerchange)', async () => {
  /* a first visit: no worker yet, and the one that comes serves this very version — it settles in */
  let page = await updatePage({ controller: null });
  try {
    page.updates.ready(); page.advance(2500); await page.flush();
    await page.newWorker(page.VERSION);
    eq(page.reloads, 0, 'a first visit settles in without a reload');
    eq(page.notice, '', 'and nothing is said');
  } finally { page.close(); }
  /* an open page, and a new coat found by this page (updatefound): its own statechange brings it, even when the
   * controllerchange was missed (M720's first confirmed fault: a late listener) */
  page = await updatePage();
  try {
    page.updates.ready(); page.advance(2500); await page.flush();
    eq(page.reloads, 0, 'the worker serves this version: nothing to do');
    await page.newWorker('m999-001', { controllerchange: false });
    eq(page.reloads, 1, 'updatefound is wired');
    page.fire('document', 'visibilitychange'); await page.runIntervals(3000);
    eq(page.reloads, 1, 'and the page reloads once, never again for the same coat');
    eq(page.notice, '', 'with nothing in the way, without a word');
  } finally { page.close(); }
  /* a coat this page never saw installing (another tab found it) takes it over: controllerchange alone */
  page = await updatePage();
  try {
    page.updates.ready(); page.advance(2500);
    await page.takenOverBy('m999-001');
    eq(page.reloads, 1, 'controllerchange is wired');
  } finally { page.close(); }
  /* the page speaks only while the update waits on something — the storyteller writing — and goes ahead when it is done */
  page = await updatePage();
  try {
    page.updates.ready(); page.advance(2500);
    page.busy = true;
    await page.takenOverBy('m999-001');
    eq(page.reloads, 0, 'never mid-sentence');
    eq(page.notice, 'Update ready. This page will refresh when writing, forms and background work are safely finished.', 'the warm words');
    page.busy = false;
    await page.runIntervals(3000);
    eq(page.reloads, 1, 'the page was written: the new coat goes on');
  } finally { page.close(); }
  /* the reload-once guard: a reloaded page that still loaded the old coat (the update did not load whole) never loops */
  const session = new Map();
  page = await updatePage({ session });
  try { page.updates.ready(); page.advance(2500); await page.takenOverBy('m999-001'); eq(page.reloads, 1, 'the first reload'); } finally { page.close(); }
  page = await updatePage({ controller: 'm999-001', session });
  try {
    page.updates.ready(); page.advance(2500); await page.flush(); await page.runIntervals(3000);
    eq(page.reloads, 0, 'the reload-once guard stands: one try per coat and tab');
    assert(/did not load completely\. Your work is safe here/.test(page.notice), 'and it says so: ' + page.notice);
  } finally { page.close(); }
  /* and the tavern looks for a new coat on its own (M141): at once, back on the tab, when the network returns, every ten
   * minutes — and it waits for the first page to be ready before any reload */
  page = await updatePage();
  try {
    page.advance(2500);
    await page.takenOverBy('m999-001');
    eq(page.reloads, 0, 'nothing reloads before the house is up');
    const atOpen = page.looks;
    assert(atOpen >= 1, 'it looks as it opens');
    page.updates.ready(); page.advance(2500); await page.flush();
    eq(page.reloads, 1, 'and once it is up, the coat goes on');
  } finally { page.close(); }
  page = await updatePage();
  try {
    const before = page.looks;
    page.fire('document', 'visibilitychange'); await page.flush();
    page.fire('window', 'online'); await page.flush();
    await page.runIntervals(10 * 60 * 1000);
    eq(page.looks, before + 3, 'back on the tab, the network back, the ten-minute round: each looks again');
  } finally { page.close(); }
});

/* A FAILED SAVE IS A WRITE THAT DID NOT LAND — NOT A FILE REFUSED AT THE DOOR. M720 keeps a page open for good once a save
 * fails (its words may live only on the screen), and counted every rejected call as one: "Bring a copy back" with the
 * wrong file — refused before a thing is written ("nothing was touched") — held every update off for the rest of the
 * session and told him "A save failed" (confirmed in Chromium by the audit of the update flow). */
test('M720-1 a restore that refused a wrong file wrote nothing — it never holds an update back; a save that really failed does, and says so', async () => {
  const { failWritesWithQuota, clearQuotaFailure } = await import('./idb-shim.mjs');
  const books = () => { const b = copyOfDb(db); b.stories.list = async () => []; return b; };
  let page = await updatePage({ db: books() });
  try {
    page.updates.ready();
    let said = '';
    try { await page.ctx.db.importAll('{"not":"a backup"}'); } catch (err) { said = err.message; }
    assert(/doesn’t read like a Cozy Tavern backup/.test(said), 'the wrong file is refused: ' + said);
    try { await page.ctx.db.importAll(JSON.stringify({ namespace: 'cozytavern.v1', messages: [{ id: 'p1' }] })); } catch (err) { said = err.message; }
    assert(/nothing was touched/.test(said), 'and so is a bent one: ' + said);
    page.advance(2500);
    await page.takenOverBy('m999-001');
    eq(page.reloads, 1, 'nothing was written, nothing can be lost: the update goes ahead — ' + page.notice);
  } finally { page.close(); }
  page = await updatePage({ db: books() });
  try {
    page.updates.ready();
    let said = '';
    failWritesWithQuota(1);
    try { await page.ctx.db.messages.append('m720-1', { role: 'user', text: 'Words the device could not keep.' }); } catch (err) { said = err.message; } finally { clearQuotaFailure(); }
    assert(/The shelf is full/.test(said), 'the device could not keep it: ' + said);
    page.advance(2500);
    await page.takenOverBy('m999-001');
    eq(page.reloads, 0, 'a save that failed holds the page open');
    eq(page.notice, 'Update ready. A save failed, so this page will stay open. Keep your work before refreshing.', 'and says why');
  } finally { page.close(); }
});

/* THE CARET IS NOT A DRAFT. On a desktop the house puts the caret in the composer after every page (focusComposerIfDesktop),
 * and any focused field held the update — so an empty composer kept a desktop page on the old coat for as long as he sat
 * in it. What the composer holds is its words and attachments, and those hold the page (M720: "unsent text, attachments"). */
test('M720-2 an empty composer that merely holds the caret never holds an update back; words or an attachment in it do, until they are sent', async () => {
  let page = await updatePage();
  try {
    page.updates.ready();
    page.focused = page.composer;
    page.advance(2500);
    await page.takenOverBy('m999-001');
    eq(page.reloads, 1, 'an empty composer with the caret in it loses nothing: ' + page.notice);
  } finally { page.close(); }
  page = await updatePage();
  try {
    page.updates.ready();
    page.focused = page.composer;
    page.composer.value = 'Unsent words';
    page.advance(2500);
    await page.takenOverBy('m999-001');
    eq(page.reloads, 0, 'words in it hold the page');
    page.composer.value = '';
    page.attachment = true;
    await page.runIntervals(3000);
    eq(page.reloads, 0, 'and so does an attachment waiting to go');
    page.attachment = false;
    await page.runIntervals(3000);
    eq(page.reloads, 1, 'sent, the update goes ahead, the caret still in the composer');
  } finally { page.close(); }
  /* any other field with the caret in it still holds the page — its words are not read here */
  page = await updatePage();
  try {
    page.updates.ready();
    page.focused = { id: 'hk-input', tagName: 'TEXTAREA', matches: (sel) => /(^|[\s,])textarea\b/.test(sel), getClientRects: () => [{}] };
    page.advance(2500);
    await page.takenOverBy('m999-001');
    eq(page.reloads, 0, 'another field with the caret holds it');
  } finally { page.close(); }
});

test('M16 the version stands in Settings; the tour names the housekeeper', () => {
  const settings = read('js/ui/settings.js');
  assert(settings.includes("import { VERSION } from '../version.js'"), 'settings imports VERSION');
  assert(settings.includes("els.versionLine.textContent = 'the shelves · ' + VERSION"),
    'the header line carries the version');
  const html = read('index.html');
  assert(html.includes('id="settings-version"'), 'the settings version line exists');
  const welcome = read('js/ui/welcome.js');
  assert(welcome.includes('the housekeeper keeps the tale tidy — find it up top'),
    'the last tour step names the housekeeper');
  assert(/m\d+-\d+/.test(read('js/version.js').match(/VERSION = '([^']+)'/)[1]), 'the version follows the house word-pattern');
});

test('M16 the sidebar renders shelves and remembers the folded doors', () => {
  const src = read('js/ui/chat.js');
  assert(src.includes("import { db, shelvesOf } from '../store.js'"), 'chat imports the grouping');
  assert(src.includes("const SHELF_COLLAPSED_KEY = 'shelfCollapsed'"), 'the folded map has a home');
  assert(src.includes('function shelfSection('), 'shelf sections render');
  assert(src.includes('shelf-badge'), 'the page-count badge rides the header');
  assert(src.includes('db.projects.create(') && src.includes('db.projects.rename(')
    && src.includes('db.projects.remove('), 'shelf CRUD is reachable from the sidebar');
  assert(src.includes("Loose tales"), 'the loose section has its warm name');
  /* M662: this line read the source for the new-story form's shelf pick (`newShelfPick`). He asked for that pick to go:
   * "Start a new story" starts a loose tale and the + on a shelf starts one there. That a new tale may begin on a shelf is
   * RUN, not read, in the walk — DOM-241 presses the plus and finds the tale on that shelf. */
  const html = read('index.html');
  assert(html.includes('id="new-story-where"') && html.includes('id="btn-new-shelf"'), /* M662: the form says where the tale starts; it no longer asks (see above) */
    'the sidebar forms exist');
  const settings = read('js/ui/settings.js');
  assert(settings.includes('story-shelf') && html.includes('The shelf it sits on'),
    'story settings carries the shelf picker');
  const css = read('css/chat.css');
  assert(css.includes('.shelf-toggle') && css.includes('.shelf-stories'), 'the shelf styling lives');
});
