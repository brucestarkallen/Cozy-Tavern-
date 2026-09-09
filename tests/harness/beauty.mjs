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
