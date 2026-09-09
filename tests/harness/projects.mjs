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

test('M16 the update nudge is wired (updatefound + controllerchange)', () => {
  const src = read('js/app.js');
  assert(src.includes("registration.addEventListener('updatefound'"), 'updatefound is wired');
  assert(src.includes("navigator.serviceWorker.addEventListener('controllerchange'"), 'controllerchange is wired');
  assert(src.includes("worker.state === 'installed' && navigator.serviceWorker.controller"),
    'the nudge only speaks when an old controller holds the room');
  assert(src.includes('A new coat is on the tavern — tap to refresh.'), 'the warm words');
  assert(/let reloading = false;[\s\S]{0,300}reloading = true;\s*location\.reload\(\)/.test(src),
    'the reload-once guard stands');
  assert(src.includes('hadController'), 'a first visit settles in without a reload');
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
  assert(src.includes('newShelfPick'), 'a new tale may begin on a shelf');
  const html = read('index.html');
  assert(html.includes('id="new-story-shelf"') && html.includes('id="btn-new-shelf"'),
    'the sidebar forms exist');
  const settings = read('js/ui/settings.js');
  assert(settings.includes('story-shelf') && html.includes('The shelf it sits on'),
    'story settings carries the shelf picker');
  const css = read('css/chat.css');
  assert(css.includes('.shelf-toggle') && css.includes('.shelf-stories'), 'the shelf styling lives');
});
