/* Beauty pass laws (M14): the bug classes that made the app look dead,
 * encoded so they can never silently return.
 *  1. Every getElementById literal resolves (the boot-crash law).
 *  2. The hearth exists and its chips seed the composer.
 *  3. The ledger drawer can actually open (measurePanel defined & open unhides).
 *  4. Every init* called in app.js is imported; every imported init is called.
 *  5. The welcome tour shows on true first run, then remembers.
 *  6. Frame seeding uses ?? (empty ≠ wiped). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const jsFiles = (dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true })
  .filter((f) => f.endsWith('.js')).map((f) => path.join(dir, String(f)));

test('M14 id-coverage: every getElementById literal exists in HTML or is JS-created', () => {
  const htmlIds = new Set([...read('index.html').matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const dynamicIds = new Set();
  const wanted = new Set();
  for (const rel of [...jsFiles('js'), 'sw.js']) {
    const src = read(rel);
    for (const m of src.matchAll(/getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) wanted.add(m[1]);
    for (const m of src.matchAll(/id="([^"]+)"/g)) dynamicIds.add(m[1]);
    for (const m of src.matchAll(/\.id\s*=\s*['"`]([^'"`]+)['"`]/g)) dynamicIds.add(m[1]);
    for (const m of src.matchAll(/id:\s*['"`]([^'"`]+)['"`]/g)) dynamicIds.add(m[1]);
  }
  const missing = [...wanted].filter((id) => !htmlIds.has(id) && !dynamicIds.has(id));
  assert(missing.length === 0, `getElementById targets with no element anywhere (the boot-crash class): ${missing.join(', ')}`);
});

test('M14 hearth: constants exist and chips seed the composer', () => {
  const src = read('js/ui/chat.js');
  assert(src.includes("export const HEARTH_GREETING"), 'HEARTH_GREETING exported');
  assert(src.includes('export const HEARTH_CHIPS'), 'HEARTH_CHIPS exported');
  assert(src.includes('export function buildHearth'), 'buildHearth exported');
  const chips = [...src.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
  assert(chips.length >= 2 && chips.length <= 4, `2-4 starter chips (found ${chips.length})`);
  assert(/onSeed\?\.\(|onSeed\(/.test(src), 'chips call onSeed');
  assert(src.includes('HEARTH_PICKUP'), 'pickup line exists');
});

test('M14 ledger: measurePanel is defined and open() unhides the drawer', () => {
  const src = read('js/ui/drawer.js');
  assert(/function measurePanel\(/.test(src), 'measurePanel defined (was referenced, never defined)');
  assert(src.includes('drawer.hidden = false') || src.includes('hidden = false'), 'open() unhides the drawer');
});

test('M14 init law: every init* called in app.js is imported, every imported init called', () => {
  const src = read('js/app.js');
  const imported = [...src.matchAll(/import\s*\{\s*(init\w+)\s*\}/g)].map((m) => m[1]);
  const called = [...src.matchAll(/\b(init\w+)\s*\(/g)].map((m) => m[1]);
  const uniqCalled = [...new Set(called)];
  const missingImport = uniqCalled.filter((n) => !imported.includes(n));
  const neverCalled = imported.filter((n) => !uniqCalled.includes(n));
  assert(missingImport.length === 0, `init called without import (boot-crash class): ${missingImport.join(', ')}`);
  assert(neverCalled.length === 0, `init imported but never called: ${neverCalled.join(', ')}`);
});

test('M14 welcome: first run shows the tour, then it remembers', async () => {
  const { welcomeShouldShow, markWelcomeSeen, createTour, TOUR_STEPS, WELCOME_SEEN_KEY } = await import('../../js/ui/welcome.js');
  const { db } = await import('../../js/store.js');
  await db.settings.set(WELCOME_SEEN_KEY, false); // fresh shelf (suite shares one shim)
  eq(await welcomeShouldShow(), true, 'fresh profile should show the tour');
  const tour = createTour();
  eq(tour.index, 0, 'tour starts at step 0');
  assert(TOUR_STEPS.length === 3, 'three steps');
  assert(tour.step() === TOUR_STEPS[0], 'step() returns the first step');
  tour.next(); eq(tour.index, 1); tour.next(); eq(tour.index, 2);
  tour.next(); eq(tour.done, true, 'walking off the end finishes the tour');
  eq(tour.step(), null, 'a finished tour offers no step');
  tour.restart(); eq(tour.index, 0, 'guided tour restarts from the top');
  await markWelcomeSeen();
  eq(await welcomeShouldShow(), false, 'seen flag persists');
});

test('M14 frame seeding: empty is not wiped (?? not ||)', () => {
  const src = read('js/ui/settings.js');
  assert(src.includes('?? STARTER_FRAME'), 'frame seeding uses ?? so a cleared frame stays cleared');
  assert(!/\|\|\s*STARTER_FRAME/.test(src), 'frame seeding must not use || (that would resurrect a cleared frame)');
  eq(undefined ?? 'starter', 'starter');
  eq('' ?? 'starter', '');
});

/* M162: renderHtmlProse recursed with no limit, and renderThread calls
 * msgNode in a bare loop — one page dressed into deep markup would throw and
 * blank the whole room. (The rendering itself is walked in the DOM suite,
 * where there is a document; here the guards are held to account.) */
test('M162: the HTML walk has a floor, and msgNode catches what it cannot dress', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rich = fs.readFileSync(path.join(here, '../../js/ui/richhtml.js'), 'utf8');
  assert(/const MAX_DEPTH = \d+;/.test(rich), 'the walk knows a maximum depth');
  assert(/function walk\(src, host, depth = 0\)/.test(rich), 'and carries it down');
  assert(/if \(depth > MAX_DEPTH\) \{ appendText\(host, src\.textContent \|\| ''\); return; \}/.test(rich), 'past it the branch renders as its text, which is always readable');
  assert(/walk\(node, el, depth \+ 1\)/.test(rich), 'every step counts');
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');
  const at = chat.indexOf('body.appendChild(renderHtmlProse(shown));');
  assert(at !== -1, 'msgNode still dresses a styled page');
  assert(/try \{\s*$/m.test(chat.slice(at - 220, at)), 'inside a try — one unrenderable page never blanks the room');
  assert(/\} catch \(err\) \{[\s\S]{0,400}renderRich\(part\.text\)/.test(chat.slice(at, at + 900)), 'and falls back to the plain prose');
});

/* M169: nine controls in the house — the new-tale name, the new-shelf name,
 * the picture attach, the four per-story texts, the housekeeper's seed and
 * the welcome's next — carried neither a <label for> nor an aria-label, so a
 * screen reader announced them blank. */
test('M169: every control in the house is named, and no id is used twice', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(here, '../../index.html'), 'utf8');

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  eq(dupes.length, 0, 'no id is used twice: ' + [...new Set(dupes)].join(', '));

  const unnamed = [];
  for (const m of html.matchAll(/<(input|select|textarea|button)\b[^>]*>/g)) {
    const tag = m[0];
    if (/aria-label=|aria-labelledby=|type="hidden"/.test(tag)) continue;
    const id = (tag.match(/id="([^"]+)"/) || [])[1];
    if (id && html.includes('for="' + id + '"')) continue;
    if (tag.startsWith('<button')) {
      const close = html.indexOf('</button>', m.index);
      const inner = html.slice(m.index + tag.length, close).replace(/<[^>]*>/g, '').trim();
      if (inner) continue;
    }
    const before = html.slice(Math.max(0, m.index - 260), m.index);
    if (/<label[^>]*>[^<]*$/.test(before) || /<label[^>]*>(\s|<span[^>]*>[^<]*<\/span>)*$/.test(before)) continue;
    unnamed.push(tag.slice(0, 70));
  }
  eq(unnamed.length, 0, 'every control is named: ' + unnamed.join(' | '));
});

/* M175: "Forget for good" erases a person WHOLE — page, seat, standing,
 * knowledge, locks, presence — and it sat one thumb's width from "Bring
 * back" with no question asked, while rebuilding the record (which keeps a
 * backup) asks one. */
test('M175: every destructive tap in the house asks first', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const drawer = fs.readFileSync(path.join(here, '../../js/ui/drawer.js'), 'utf8');
  const at = drawer.indexOf("forget.addEventListener('click'");
  assert(at !== -1, 'the forget button still exists');
  const body = drawer.slice(at, at + 1100);
  assert(/window\.confirm\(/.test(body), 'forgetting a person asks first');
  assert(/people\.forget/.test(body), 'and it is the erasure it guards');
  assert(body.indexOf('window.confirm(') < body.indexOf('people.forget'), 'the question comes before the erasure');

  /* the whole house: an erasure or a rewrite with no take-back asks */
  for (const [file, needle] of [
    ['../../js/ui/settings.js', 'Rewrite every page'],
    ['../../js/ui/settings.js', 'Take the lore shelf down'],
    ['../../js/ui/drawer.js', 'Rebuild the record from the first page'],
  ]) {
    const src = fs.readFileSync(path.join(here, file), 'utf8');
    const i = src.indexOf(needle);
    assert(i !== -1, needle + ' is still there');
    assert(/window\.confirm\(/.test(src.slice(Math.max(0, i - 200), i + 40)), needle + ' asks first');
  }
});

/* M179: the welcome's close carried no generation, so a close followed
 * inside 200ms by a reopen — Settings' own "walk me through it again" does
 * exactly that — let the old timer hide the overlay out from under the fresh
 * one, and the tour vanished the moment it was asked for. The drawer and the
 * receipt sheet both learned this at B8; the welcome had not. */
test('M179: every overlay that closes on a timer carries a generation', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const [file, name] of [['../../js/ui/welcome.js', 'function close('], ['../../js/ui/drawer.js', 'function close('], ['../../js/ui/receiptview.js', 'function closeReceipt(']]) {
    const src = fs.readFileSync(path.join(here, file), 'utf8');
    const at = src.indexOf(name);
    assert(at !== -1, file + ' has a close');
    const body = src.slice(at, at + 700);
    assert(/setTimeout\(/.test(body), file + ': it closes on a timer');
    assert(/generation/.test(body), file + ': and the timer carries a generation');
    assert(/if \(generation !== closeGeneration\) return;/.test(body), file + ': a reopen in between wins');
  }
  /* and the welcome's open stales any close still in flight */
  const w = fs.readFileSync(path.join(here, '../../js/ui/welcome.js'), 'utf8');
  const open = w.slice(w.indexOf('function open('), w.indexOf('function open(') + 260);
  assert(/closeGeneration \+= 1;/.test(open), 'opening stales a close already in flight');
});

/* M199: pressing Audit or Rebuild threw the writer back to the top of the
 * panel — render() empties panelsEl and builds it again — and the button
 * said nothing at all, so there was no way to tell whether the thing they
 * pressed had even started, let alone finished. */
test('M199: the ledger panel keeps its place, and every action says what it is doing', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '../../js/ui/drawer.js'), 'utf8');

  /* the place is kept in render itself, so every caller has it */
  const at = src.indexOf('function render() {');
  assert(at !== -1, 'the drawer still has a render');
  const body = src.slice(at, at + 4200);
  assert(/const keptTop = panelsEl\.scrollTop;/.test(body), 'render remembers where the panel stood');
  /* M201: put back once the CONTENT has arrived — a panel's content is
   * filled asynchronously, so two frames later there is nothing to scroll. */
  assert(/if \(panelsEl\.scrollTop !== keptTop\) panelsEl\.scrollTop = keptTop;/.test(body), 'and puts it back');
  assert(/panelsEl\.scrollHeight - panelsEl\.clientHeight < keptTop\) return;/.test(body), 'not before the panel is tall enough to hold it');
  assert(/new Watcher\(restore\)|setInterval\(restore/.test(body), 'and keeps putting it back as the content lands');
  assert(/const byHand = \(\) => \{ settled = true; \};/.test(body), 'unless the writer’s own hand moves it');
  assert(body.indexOf('const keptTop') < body.indexOf("panelsEl.textContent = ''"), 'remembered BEFORE the panel is emptied');

  /* and every action that hands work to the chain reports itself */
  assert(/const whileWorking = \(button, working, done\)/.test(src), 'there is one way to say it');
  assert(/button\.disabled = true;/.test(src), 'a button in flight cannot be pressed twice');
  assert(/button\.textContent = 'It stumbled — try again';/.test(src), 'and says so when it fails');
  assert(/finally \{\s*\n\s*setTimeout\(\(\) => \{ button\.textContent = words; button\.disabled = false; \}/.test(src),
    'then goes back to its own words');
  for (const [label, working] of [
    ['Read the pages again', 'Reading the pages…'],
    ['Audit the ledger', 'Auditing the ledger…'],
    ['Found the world from the brief', 'Founding the world…'],
    ['Rebuild the record from the pages', 'Rebuilding the record…'],
    ['Put the old record back', 'Putting it back…'],
  ]) {
    assert(src.includes(label), label + ' is still there');
    assert(src.includes(working), label + ' says what it is doing: ' + working);
  }
});

/* M200: two ways the writer was thrown out of their own reading.
 *  - every structural rebuild JUMPED, and jumped before the new pages had
 *    laid out, so it landed near the TOP; mending a page, a swipe, a
 *    worker's write-back all threw the reader out of the scene.
 *  - a new coat's takeover was chained after cache.addAll(SHELL), which is
 *    all-or-nothing: one missing file and the old coat served forever. */
test('M200: a rebuild keeps the reader’s place, and a new coat is never held up by one file', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');

  assert(/function markPlace\(\)/.test(chat), 'the thread remembers where the reader was');
  assert(/function returnToPlace\(place\)/.test(chat), 'and puts them back');
  assert(/const place = structural \? markPlace\(\) : null;/.test(chat), 'taken before the thread is emptied');
  assert(/if \(opening \|\| \(!structural && nearBottom\(\)\)\) \{/.test(chat), 'only an opening lands at the latest page');
  assert(/requestAnimationFrame\(\(\) => \{ settle\(\); requestAnimationFrame\(settle\); \}\);/.test(chat),
    'and the place is restored AFTER layout — before it, scrollHeight is the old number and the thread lands at the top');
  /* a mend, a swipe, a write-back, closing the panel: none of them are openings */
  const openings = (chat.match(/renderThread\(\{ structural: true, opening: true \}\)/g) || []).length;
  const rebuilds = (chat.match(/renderThread\(\{ structural: true/g) || []).length;
  assert(openings >= 4 && openings < rebuilds, openings + ' openings of ' + rebuilds + ' rebuilds — the rest keep the place');

  const sw = fs.readFileSync(path.join(here, '../../sw.js'), 'utf8');
  /* the code alone — the comment above it quotes the old call while
   * explaining why it went */
  const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert(/self\.skipWaiting\(\);/.test(install), 'the takeover happens');
  assert(install.indexOf('self.skipWaiting()') < install.indexOf('caches.open'), 'BEFORE the cache is filled, never chained after it');
  assert(!/cache\.addAll\(SHELL\)/.test(install), 'the shell is not filled all-or-nothing');
  assert(/cache\.add\(path\)\.catch\(\(\) => null\)/.test(install), 'a file that will not come is simply not cached');
  assert(/event\.data\.kind === 'takeOver'/.test(sw), 'and a waiting coat takes over when the room asks');

  const app = fs.readFileSync(path.join(here, '../../js/app.js'), 'utf8');
  assert(/for \(const wait of \[2000, 6000, 15000, 30000\]\) setTimeout\(lookForUpdate, wait\);/.test(app),
    'the look is retried while the server is restarting');
  assert(/registration\.waiting\.postMessage\(\{ kind: 'takeOver' \}\)/.test(app), 'and a stuck coat is woken');
});
