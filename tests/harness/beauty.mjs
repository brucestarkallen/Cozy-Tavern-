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
import { VERSION } from '../../js/version.js';
import { updatePage, serviceWorkerScope } from './updatesim.mjs';

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
    ['../../js/ui/drawer.js', 'Rebuild the whole record from the first page?'],
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
test('M200: a rebuild keeps the reader’s place, and a new coat is never held up by one file', async () => {
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

  /* M720 (a87d357) re-made the update: the install asks for every shell file afresh (cache: 'reload'), and the looking
   * moved from app.js into js/updates.js. These lines read both sources and stopped matching though the coat still went
   * on as M200 meant; the worker and the page are RUN now (updatesim.mjs), with one shell file that will not come. */
  const scope = await serviceWorkerScope({ unreachable: ['css/base.css'] });
  try {
    const installed = scope.install();
    assert(scope.log[0] === 'skipWaiting' && scope.log[1] === 'open', 'the takeover happens BEFORE the cache is filled, never chained after it: ' + scope.log.slice(0, 3).join(', '));
    await installed; /* a rejected install is a coat that never takes over */
    assert(!scope.log.includes('addAll'), 'the shell is not filled all-or-nothing');
    assert(scope.added.length > 100 && new Set(scope.added.map((a) => a.url)).size === scope.added.length, 'file by file, each once: ' + scope.added.length);
    assert(scope.added.some((a) => a.url === 'css/base.css') && scope.added.some((a) => a.url === 'js/app.js') && scope.added.some((a) => a.url === 'index.html'),
      'a file that will not come is simply not cached — and the install still finished');
    assert(scope.added.every((a) => a.cache === 'reload'), 'each file asked for afresh, never the HTTP cache’s old copy (M720)');
    const took = scope.log.filter((x) => x === 'skipWaiting').length;
    scope.message({ kind: 'takeOver' });
    eq(scope.log.filter((x) => x === 'skipWaiting').length, took + 1, 'and a waiting coat takes over when the room asks');
    eq(JSON.stringify(scope.message({ kind: 'appVersion' })), JSON.stringify([{ version: VERSION }]), 'and tells the room which coat it serves (M720)');
  } finally { scope.close(); }

  const page = await updatePage();
  try {
    eq(page.timeouts.filter((t) => [2000, 6000, 15000, 30000].includes(t.ms)).map((t) => t.ms).join(','), '2000,6000,15000,30000',
      'the look is retried while the server is restarting');
    const looked = page.looks;
    page.registration.waiting = { told: [], postMessage(m) { this.told.push(m); } };
    for (const ms of [2000, 6000, 15000, 30000]) await page.runTimers(ms);
    eq(page.looks, looked + 4, 'each retry looks again');
    assert(page.registration.waiting.told.length >= 1 && page.registration.waiting.told.every((m) => m && m.kind === 'takeOver'), 'and a stuck coat is woken');
  } finally { page.close(); }
});

/* M203: every manual action handed its work to the background chain and then
 * said nothing, or one toast that vanished. A two-hundred-page rebuild is
 * minutes of silence — the writer was left scrolling to guess whether it had
 * finished, stalled, or died. */
test('M203: every manual action has a banner, and always finishes it', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');
  const html = fs.readFileSync(path.join(here, '../../index.html'), 'utf8');

  /* the banner exists where the writer is already looking */
  for (const id of ['work-banner', 'work-banner-what', 'work-banner-count', 'work-banner-fill']) {
    assert(html.includes('id="' + id + '"'), 'the banner has its ' + id);
  }
  assert(/role="status" aria-live="polite"/.test(html), 'and a screen reader hears it change');

  /* every manual action begins one */
  const actions = ['rescanLedger', 'foundNow', 'auditNow', 'rebuildRecordNow',
    'rebuildPeopleNow', 'rebuildStandingsNow', 'restoreRecordNow', 'restorePeopleNow'];
  for (const fn of actions) {
    const at = chat.indexOf('async function ' + fn + '(');
    assert(at !== -1, fn + ' exists');
    const body = chat.slice(at, at + 1800);
    assert(/const banner = beginWork\('/.test(body), fn + ' begins a banner');
    assert(/banner\.(done|failed)\(|bannerFollows\(banner/.test(body), fn + ' always finishes it');
    /* and no early return leaves it spinning over nothing */
    const earlyReturns = body.match(/if \(![a-zA-Z]+\) \{[^}]*return false; \}/g) || [];
    for (const line of earlyReturns) {
      assert(/banner\.failed\(/.test(line), fn + ' finishes the banner on an early return: ' + line);
    }
  }

  /* it counts, it says when it stumbles, and two actions cannot fight over it */
  const banner = fs.readFileSync(path.join(here, '../../js/ui/workbanner.js'), 'utf8');
  assert(/' · ' \+ pct \+ '%'/.test(banner), 'it shows a percentage');
  assert(/unit \+ ' ' \+ done \+ ' of ' \+ total/.test(banner), 'and a count of batches');
  assert(/trying again in ' \+ left \+ 's'/.test(banner), 'and counts a retry down');
  assert(/const mine = \+\+token;[\s\S]{0,80}const live = \(\) => mine === token;/.test(banner),
    'a newer piece of work takes the banner and the older one goes quiet');
  assert(/export async function waitVisibly/.test(banner), 'a worker’s own pause can be watched');

  /* the shell must carry it, or an offline open loses the banner entirely */
  const sw = fs.readFileSync(path.join(here, '../../sw.js'), 'utf8');
  assert(sw.includes("'js/ui/workbanner.js'"), 'the shell carries the banner');
});

/* M204: THE BANNER IS FOR THE WRITER'S OWN HAND ONLY. The automatic chain
 * runs after every single page — extractor, world agent, scribe, keeper,
 * second reader, auditor. A banner flashing through all of that while the
 * writer is reading would break the scene every turn, which is the opposite
 * of what it is for. It belongs to the eight buttons and to nothing else. */
test('M204: the automatic chain never raises the banner', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');
  const html = fs.readFileSync(path.join(here, '../../index.html'), 'utf8');

  /* it is raised in exactly the eight places the writer presses */
  /* M218: what matters is not HOW MANY raise it but that the per-turn chain
   * never does — an exact count only breaks when an action is added. */
  const raised = (chat.match(/const banner = beginWork\('/g) || []).length;
  assert(raised >= 9, 'the manual actions raise it (' + raised + ')');

  /* and none of them is the per-turn chain */
  const chainAt = chat.indexOf('function startBackgroundWork(');
  assert(chainAt !== -1, 'the chain is still there');
  const chainEnd = chat.indexOf('\n  async function ', chainAt + 40);
  const chain = chat.slice(chainAt, chainEnd > chainAt ? chainEnd : chainAt + 14000);
  assert(!/beginWork\(/.test(chain), 'the per-turn chain never begins a banner');
  assert(!/banner\./.test(chain), 'nor touches one');

  /* nor the send path */
  const genAt = chat.indexOf('async function generate(');
  const gen = chat.slice(genAt, genAt + 16000);
  assert(!/beginWork\(/.test(gen), 'and neither does the send path');

  /* it lives inside the drawer, so a closed ledger cannot show it at all */
  const drawer = html.slice(html.indexOf('<aside id="drawer"'), html.indexOf('</aside>', html.indexOf('<aside id="drawer"')));
  assert(drawer.includes('id="work-banner"'), 'the banner sits inside the ledger drawer');
  assert(html.indexOf('id="work-banner"') > html.indexOf('<aside id="drawer"'), 'never out over the story');
});

/* M214: three faults in the banner work, all from bulk edits, none caught by
 * lint or by any suite:
 *  - `banner.failed(…)` sat on the line ABOVE `const banner = …` in BOTH
 *    rebuilds, so pressing either with no connection threw a ReferenceError
 *    out of the click instead of saying what was missing. Lint does not flag
 *    a temporal-dead-zone use inside a function body.
 *  - a people rebuild the leash cut off still read "rebuilt the people: read
 *    24 of 118 pages" — a sentence that sounds like success — and its banner
 *    closed with "The people were rebuilt".
 */
test('M214: every action’s banner exists before it is touched, and never claims a stalled run', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');
  const chat = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const actions = ['rescanLedger', 'foundNow', 'auditNow', 'rebuildRecordNow',
    'rebuildPeopleNow', 'rebuildStandingsNow', 'restoreRecordNow', 'restorePeopleNow'];
  for (const fn of actions) {
    const at = chat.indexOf('async function ' + fn + '(');
    assert(at !== -1, fn + ' exists');
    const body = chat.slice(at, at + 2400);
    const decl = body.indexOf('const banner = beginWork');
    assert(decl !== -1, fn + ' opens a banner');
    assert(!/banner\.(failed|done|step|say)\(/.test(body.slice(0, decl)),
      fn + ' never touches the banner before it exists (a dead-zone use lint does not catch)');
  }

  /* both rebuilds check for a run that was cut short */
  const rb = fs.readFileSync(path.join(here, '../../js/agents/rebuild.js'), 'utf8');
  assert(/if \(r\.stalled\) \{[\s\S]{0,160}\$\{r\.folded\} of \$\{r\.toFold\} pages/.test(rb), 'the record’s words say when it stopped');
  assert(/if \(r\.stalled\) return `the rebuild stopped at \$\{r\.read\}/.test(rb), 'and the people’s');
  /* M248: and it now also sets the house carrying on by itself */
  assert(/banner\.failed\('Stopped at ' \+ result\.folded[\s\S]{0,200}maybeFinish\(story\.id, 'rebuildRecordNow'/.test(chat),
    'the record’s banner too, and it asks the house to finish');
  assert(/banner\.failed\('Stopped at ' \+ result\.read[\s\S]{0,200}maybeFinish\(story\.id, 'rebuildPeopleNow'/.test(chat),
    'and the people’s');
});

/* M234: the writer typed 0,3 into the temperature — a decimal point in most
 * of the world — and "Test connection" passed merrily. It passed because
 * NOTHING WAS BEING SENT: the field is <input type="number">, so a browser
 * handed a comma gives back an empty string or something parseFloat reads as
 * 0. His number was silently thrown away and he had no way to know. */
test('M234: a comma is a decimal point, and closing the form keeps your place', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const set = fs.readFileSync(path.join(here, '../../js/ui/settings.js'), 'utf8');
  const html = fs.readFileSync(path.join(here, '../../index.html'), 'utf8');

  assert(/\.replace\(',', '\.'\)/.test(set), 'a comma is read as the point it is');
  /* and the field must be able to HOLD one — a number input cannot */
  for (const id of ['conn-temperature', 'conn-topp']) {
    const m = new RegExp('<input id="' + id + '" type="([a-z]+)"([^>]*)>').exec(html);
    assert(m, id + ' is in the page');
    eq(m[1], 'text', id + ' is not a number input, which silently drops a comma');
    assert(/inputmode="decimal"/.test(m[2]), id + ' still raises a numeric keypad on a phone');
  }
  /* the parse itself */
  const numOrUnset = (v) => { const r = String(v || '').trim().replace(',', '.'); const n = parseFloat(r); return r !== '' && Number.isFinite(n) ? n : undefined; };
  eq(numOrUnset('0,3'), 0.3, 'a comma decimal');
  eq(numOrUnset('0.3'), 0.3, 'a point decimal');
  eq(numOrUnset('0,25'), 0.25);
  eq(numOrUnset(''), undefined, 'empty stays unset — the provider decides');
  eq(numOrUnset('abc'), undefined, 'and words are not numbers');

  /* closing the form collapses a tall panel, so the browser clamps the scroll */
  assert(/const rememberPlace = \(\)/.test(set), 'where the writer was is remembered');
  assert(/const returnToPlace = \(\)/.test(set), 'and given back');
  assert(/row\.scrollIntoView\(\{ block: 'nearest' \}\)/.test(set), 'the connection just edited comes back under the eye');
});

/* M245: two faults the writer photographed on one screen — the same
 * housekeeper dial listed TWICE, and a story called "Actually use this lol —
 * a branch — a branch — a branch — a branch — a branch — a branch — a branch
 * — a branch". */
test('M245: no dial is drawn twice, and a branch of a branch keeps a readable name', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const set = fs.readFileSync(path.join(here, '../../js/ui/settings.js'), 'utf8');
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');

  /* the panel clears once and then AWAITS on every row — two overlapping
   * renders both cleared, both waited, and both appended */
  assert(/let workerRowsGeneration = 0;/.test(set), 'a render knows whether it is the newest');
  assert(/const mine = \+\+workerRowsGeneration;/.test(set), 'and takes its own mark');
  eq((set.match(/if \(mine !== workerRowsGeneration\) return;/g) || []).length, 3,
    'and stops at every point it would otherwise append after an await');
  const at = set.indexOf('const mine = ++workerRowsGeneration;');
  assert(at < set.indexOf("els.workerAssignments.textContent = ''"), 'the mark is taken BEFORE the list is cleared');

  /* the suffix was simply appended, so a branch of a branch grew its own name */
  assert(!/title: story\.title \+ ' — a branch' \}/.test(chat), 'the suffix is never simply appended');
  assert(/replace\(\/\\s\*—\\s\*a branch\(\\s\*\\d\+\)\?\\s\*\$\/i, ''\)/.test(chat), 'the stem is taken first');
  assert(/for \(let n = 2; taken\.has\(title\); n \+= 1\)/.test(chat), 'and the branches are numbered');

  /* the naming itself */
  const stemOf = (t) => String(t || 'a tale').replace(/\s*—\s*a branch(\s*\d+)?\s*$/i, '').trim() || 'a tale';
  const taken = new Set(['Ravenwood']);
  const names = [];
  for (let i = 0; i < 4; i += 1) {
    const stem = stemOf(names.length ? names[names.length - 1] : 'Ravenwood');
    let t = stem + ' — a branch';
    for (let n = 2; taken.has(t); n += 1) t = stem + ' — a branch ' + n;
    taken.add(t); names.push(t);
  }
  eq(names[3], 'Ravenwood — a branch 4', 'four branches deep is still readable: ' + names.join(' / '));
  for (const n of names) assert((n.match(/a branch/g) || []).length === 1, 'and never stacks the suffix: ' + n);
});

/* M248: the writer asked for a mark he can read at a glance — green when a
 * run finished, amber when it did not — because a rebuild that gave up at
 * batch 15 of 16 while he slept looked exactly like one that had finished.
 * And: if it did not finish, the house should carry on by itself, with a
 * button for when he would rather it did not. */
test('M248: a run says whether it FINISHED, and the house carries on when it did not', async () => {
  /* M253: this law READ THE SOURCE and passed while the whole feature was
   * dead — loadWorkerStatus rebuilds each row from a fixed list of fields and
   * did not name the new ones, so `unfinished` came back undefined every
   * time and the amber mark could never appear. It rides the ROUND TRIP now. */
  const { noteWorkerRun, loadWorkerStatus } = await import('../../js/agents/status.js');
  await noteWorkerRun('m253', 'keeper', { ok: true, detail: 'folded 18 of 98', unfinished: true, resume: 'rebuildRecordNow' });
  let row = (await loadWorkerStatus('m253')).keeper;
  eq(row.unfinished, true, 'unfinished survives being written and read back');
  eq(row.resume, 'rebuildRecordNow', 'and so does what it would take to finish');
  await noteWorkerRun('m253', 'keeper', { ok: true, detail: 'folded 98 of 98' });
  row = (await loadWorkerStatus('m253')).keeper;
  eq(row.unfinished, false, 'a run that finishes clears it — green again');
  eq(row.resume, '', 'and leaves no button behind');
  await noteWorkerRun('m253', 'keeper', { ok: false, why: 'could not be reached' });
  row = (await loadWorkerStatus('m253')).keeper;
  eq(row.unfinished, false, 'a stumble is not an unfinished run');
  eq(row.resume, '', 'and offers no ghost Finish it');
  /* the third state is stored only when it is said: a run that names a way on but finished, or says "unfinished" in some
   * other word than true, is green and offers nothing. (These were three lines of status.js read as text; M723 gave the
   * note a `historical` word and the first of them stopped matching though nothing it guarded had changed — the round
   * trip above and here is what holds them.) */
  await noteWorkerRun('m253', 'keeper', { ok: true, detail: 'folded 98 of 98', resume: 'rebuildRecordNow' });
  row = (await loadWorkerStatus('m253')).keeper;
  eq(row.unfinished, false, 'a finished run that names a way on is still finished');
  eq(row.resume, '', 'and it keeps no way on');
  await noteWorkerRun('m253', 'keeper', { ok: true, detail: 'folded 50 of 98', unfinished: 'yes', resume: 'rebuildRecordNow' });
  row = (await loadWorkerStatus('m253')).keeper;
  eq(row.unfinished, false, 'only true is unfinished');
  eq(row.resume, '', 'and nothing else earns a Finish it');
  await noteWorkerRun('m253', 'keeper', { ok: true, detail: 'folded 50 of 98', unfinished: true, resume: { not: 'a name' } });
  row = (await loadWorkerStatus('m253')).keeper;
  eq(row.unfinished, true, 'unfinished');
  eq(row.resume, '', 'but a way on that is not a name is not kept');

  const here = path.dirname(fileURLToPath(import.meta.url));
  const queue = fs.readFileSync(path.join(here, '../../js/agents/queue.js'), 'utf8');
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');
  const drawer = fs.readFileSync(path.join(here, '../../js/ui/drawer.js'), 'utf8');

  assert(/unfinished: Boolean\(value && value\.unfinished\)/.test(queue), 'the queue carries it up from the job');

  /* the three long jobs report it */
  for (const [job, action] of [['rebuildRecordWords', 'rebuildRecordNow'], ['rebuildPeopleWords', 'rebuildPeopleNow']]) {
    const at = chat.indexOf('detail: ' + job + '(result)');
    assert(at !== -1, job + ' still reports');
    const near = chat.slice(at, at + 200);
    assert(/unfinished: Boolean\(result && result\.stalled\)/.test(near), job + ' says whether it finished');
    assert(near.includes("resume: '" + action + "'"), job + ' names how to carry on');
  }
  assert(/resume: 'summarizeNow'/.test(chat), 'and the catch-up too');

  /* the mark the writer reads. M723 (e178e4b): the continuous audit's row may carry its own historical reading, which
   * names its state first (historicalRunStatus — only ever good or part, and only for a run that went well); every other
   * row is read by the three states as before */
  assert(/const state = historical\?\.state \|\| \(!row\.ok \? 'bad' : \(row\.unfinished \? 'part' : 'good'\)\);/.test(drawer), 'three states, not two');
  {
    const { historicalRunStatus } = await import('../../js/agents/status.js');
    eq(historicalRunStatus({ ok: true, unfinished: true }), null, 'a row with no historical reading keeps the three states');
    eq(historicalRunStatus({ ok: false, historical: { open: 2 } }), null, 'a stumble stays a stumble');
    eq(historicalRunStatus({ ok: true, historical: { open: 2, done: 3, folded: 9 } }).state, 'part', 'open corrections are not green');
    eq(historicalRunStatus({ ok: true, unfinished: true, historical: { open: 0, done: 3, folded: 9 } }).state, 'part', 'nor is a reading cut short');
    eq(historicalRunStatus({ ok: true, historical: { open: 0, done: 9, folded: 9 } }).state, 'good', 'all read, nothing open: green');
  }
  assert(/mark\.className = 'run-mark run-mark-' \+ state;/.test(drawer), 'each with its own mark');
  assert(/aria-label/.test(drawer.slice(drawer.indexOf('run-mark'), drawer.indexOf('run-mark') + 400)),
    'and a name for a screen reader, not colour alone');
  assert(/and stopped partway/.test(drawer), 'the words say it too');

  /* the button, for when the house is told not to */
  assert(/fix\.textContent = 'Finish it';/.test(drawer), 'an unfinished run offers to be finished');
  assert(/Carry on from where it stopped\. Nothing already done is redone\./.test(drawer), 'and says what that means');
  /* M686: DOM-M686-6 runs the actual drawer and checks that an unfinished
   * auditor has no Finish it button. Its recovery is automatic. */

  /* and the house doing it itself, on by default */
  assert(/if \(\(await db\.settings\.get\('autoFinish'\)\) === false\) return;/.test(chat), 'ON unless the writer turns it off');
  assert(/if \(tried >= 3\) return;/.test(chat), 'three attempts, never a loop');
  assert(/15000 \* \(tried \+ 1\)/.test(chat), 'backing off between them');
  assert(/if \(ctx\.getActiveStoryId\(\) !== storyId\) return;/.test(chat), 'and never on a story the writer has left');
  assert(/clearFinishCount\(story\.id, 'rebuildRecordNow'\)/.test(chat), 'a run that finishes forgets its attempts');
});

/* M251: THE LEDGER HAD NO WAY BACK. The RECORD walks to its oldest hole on
 * every fold, so an outage costs it nothing. The LEDGER is per-turn: it reads
 * THIS page and no other. So a writer playing four scenes through a broken
 * connection lost every state change in them — who came in, who left, what
 * was locked, what was hurt — with nothing that would ever go back for it,
 * and the record recovering perfectly beside it, which made the loss
 * invisible. */
test('M251: the ledger walks back to its oldest unread page, as the record does', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');

  assert(/THE LEDGER HAD NO WAY BACK/.test(chat), 'the law is written where it acts');
  /* M276: the catch-up reaches the oldest page NO read has reached (oldestUnread), and the
   * mark moves through markPageRead — M259-40 plays the outage through with the writer writing */
  assert(/const k0 = here === -1 \|\| young \? -1 : oldestUnread\(stateBefore, here\);/.test(chat), 'a gap is noticed from the reading mark and the pages read ahead (a founding read covers the pages before it)');
  assert(/if \(k0 !== -1\) await readMissedPage\(story, connection, told\[k0\], k0/.test(chat), 'reaching for the OLDEST unread page, never the newest');
  assert(/markPageRead\(done\.state, k\);/.test(chat), 'and the mark takes it');
  assert(/\} catch \(err\) \{ \/\* the page in hand still gets read \*\/ \}/.test(chat),
    'a catch-up that stumbles never costs the page the writer just wrote');

  /* state.page only advances on a SUCCESSFUL read — that is what makes it an honest mark of the gap. M681: these lines read
   * the chain's source for a literal ("if (extractFailed) throw …") the S2 fix rewrote (a failed reader now lands the
   * header's own writes first); the law is RUN now — walk DOM-277: the reader's wire drops on every try, the page's hour
   * and ground land, and the reading mark stays where it was (readTo 0). */
  assert(/THE MARK IS A CONTIGUOUS PREFIX, NOT THE NEWEST PAGE READ/.test(chat),
    'and it is a prefix, so the gap closes instead of being abandoned');

  /* the arithmetic, on the writer's own case: four scenes read by nobody */
  const step = (readTo, here) => (here > readTo + 1 ? readTo + 1 : null);
  eq(step(-1, 3), 0, 'nothing read yet, four pages in: it goes back for the first');
  eq(step(0, 3), 1, 'then the second');
  eq(step(2, 3), null, 'and stops when the gap is closed');
  eq(step(3, 3), null, 'and does nothing when there was never one');
});

/* M252: the writer pressed Rebuild the people, went looking for the green
 * mark, and found "18 hours ago" at the top of the list — because the line
 * was drawn in a FIXED worker order, so a run from yesterday sat above one
 * from a moment ago and there was no way to tell which end was which. His
 * rebuild was third from the bottom. */
test('M252: the workers’ line is newest first, and an empty answer draws no fold', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const drawer = fs.readFileSync(path.join(here, '../../js/ui/drawer.js'), 'utf8');

  assert(/\.sort\(\(a, b\) => \(Number\(shelf\[b\]\.at\) \|\| 0\) - \(Number\(shelf\[a\]\.at\) \|\| 0\)\);/.test(drawer),
    'the line is sorted by when each worker ran');
  assert(/last run, newest first:/.test(drawer), 'and the heading says which end is which');

  /* the ordering itself, on the writer's own panel */
  const shelf = { eye: { at: 1000 }, extractor: { at: 1000 }, world: { at: 1000 },
    scribe: { at: 9999 }, keeper: { at: 5000 }, auditor: { at: 1000 } };
  const NAMES = ['founder', 'eye', 'extractor', 'world', 'scribe', 'keeper', 'referee',
    'continuity', 'auditor', 'ripple', 'housekeeper', 'director', 'editor'];
  const order = NAMES.filter((n) => shelf[n]).sort((a, b) => (shelf[b].at || 0) - (shelf[a].at || 0));
  eq(order[0], 'scribe', 'the thing that just ran is first: ' + order.join(', '));
  eq(order[1], 'keeper', 'then the next most recent');

  /* a run whose answer was empty drew a "what it said" fold onto an empty box */
  assert(/if \(row\.raw && String\(row\.raw\)\.trim\(\)\.length > 1\) \{/.test(drawer),
    'a fold is only drawn when there is something to read');
});

/* M254: the writer asked for a green light he can trust — "it's absolutely
 * confirmation everything is perfect, I don't need to worry and just continue
 * the story". So green is not "no errors seen lately": a light that lies once
 * is worse than no light. */
test('M254: green means read, folded and waiting on nothing — and a third coat', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');
  const css = fs.readFileSync(path.join(here, '../../css/chat.css'), 'utf8');
  const base = fs.readFileSync(path.join(here, '../../css/base.css'), 'utf8');
  const html = fs.readFileSync(path.join(here, '../../index.html'), 'utf8');

  /* all four conditions, and nothing less */
  /* M255: and a fifth — never green while the house is still reading */
  assert(/const allWell = !busy && !trouble && !partly && !behind && ran > 0 && told > 0;/.test(chat),
    'green needs every condition at once');
  assert(/const busy = runningWorkers\(storyId\)\.length > 0 \|\| queuedCount\(storyId\) > 0;/.test(chat),
    'and knows when the house is still at work');
  assert(/onWorkerChange\(\(\) => \{/.test(chat), 'the light follows the work, not the redraw');
  /* M276: declared beside `behind` so the light can send the reader to the pages it missed */
  /* M510-43: "behind" is any page the reader has not read — counted as the reader counts (a page read ahead of the mark is
   * read); the old line counted such a page unread, and the light showed behind while the reader found nothing */
  /* M752: the count is one function now (engine/state.js unreadPages), shared by the light and the storyteller's request, so
   * the notes say "not read yet" exactly when the light says behind — the light uses it, and it counts as the reader counts */
  assert(/ledgerBehind = told > 0 && unreadPages\(st, pages\) > 0;/.test(chat), 'the ledger must have read every page told');
  {
    const { unreadPages } = await import('../../js/engine/state.js');
    const pagesOf = (n) => Array.from({ length: n }, (_, i) => [{ role: 'user', text: 'move ' + i }, { role: 'assistant', text: 'page ' + i }]).flat();
    const five = pagesOf(5);
    eq(unreadPages({ readTo: 4 }, five), 0, 'every page read: nothing behind');
    eq(unreadPages({ readTo: 1, readAhead: [3] }, five), 2, 'pages 2 and 4 unread; a page read ahead of the mark is read');
    eq(unreadPages({ readTo: 3 }, [...five, { role: 'assistant', text: 'a nudge', hidden: true }]), 1, 'a hidden page is no page');
    eq(unreadPages({ page: 2 }, five), 2, 'an older ledger’s stamp is its mark');
  }
  /* M275: declared beside `behind` so the light can send the keeper to a gap it sees; M745 (c6164d6): a line whose own
   * pages moved or changed under it is a gap too */
  assert(/recordBehind = Boolean\(dueRange\(pages\.length, window, mem\.nodes, batch\) \|\| sourceBindingIssues\(mem\.nodes,pages\)\.length\);/.test(chat),
    'and the record must have nothing due');
  /* M727 (9568e5f): WHAT THE LIGHT SEES, THE HOUSE FILLS — through one inventory (agents/health.js) that hands one owner the
   * work at a time: the record's gap, then the ledger's, then a stumbled worker's own retry, the auditor, the continuous
   * audit. These were two lines here ("if (ledgerBehind && !busy && !trouble) fillLedgerGap"), each held back while a minder
   * had stumbled; M727 sends the gaps first even then — its own law (tests/harness/m722-focused.mjs) routes record and
   * ledger ahead of a failed world worker — and each filler keeps its own wait between tries. Never while anything reads. */
  assert(/routeHealth\(health,\{record:\(\)=>fillRecordGap\(storyId\),ledger:\(\)=>fillLedgerGap\(storyId\),/.test(chat), 'the light hands each gap to its filler');
  /* M752: the inventory's word on the lamp is health.js healthLamp — working, trouble or nothing; it has no green to give,
   * and the light only ever takes 'all-well' away for it (the continuous audit reading alone is not "reading this scene") */
  assert(/if \(over==='working'\) \{btn\.classList\.remove\('all-well'\);/.test(chat) && /else if \(over==='trouble'\) \{\s*btn\.classList\.remove\('all-well'\);/.test(chat), 'and the inventory can take the green away');
  {
    const lampBlock = chat.slice(chat.indexOf('const over=healthLamp(health);'), chat.indexOf('routeHealth(health,{record:'));
    assert(lampBlock.length > 0 && !/classList\.add\('all-well'\)/.test(lampBlock), 'never give it');
    const { healthSnapshot, healthLamp } = await import('../../js/agents/health.js');
    const lamps = [healthSnapshot({ storyId: 'm254' }), healthSnapshot({ storyId: 'm254', ledgerBehind: true }), healthSnapshot({ storyId: 'm254', running: ['extractor'] }),
      healthSnapshot({ storyId: 'm254', running: ['continuous'] }), healthSnapshot({ storyId: 'm254', recordBehind: true, queued: 1 })].map(healthLamp);
    assert(lamps.every((l) => l === null || l === 'working' || l === 'trouble'), 'the inventory has no green to give: ' + lamps.join(','));
    eq(lamps[0], null, 'a clean inventory says nothing over the light');
    eq(lamps[1], 'trouble', 'an unread page takes the green away');
    eq(lamps[2], 'working', 'a reader at the scene is work');
  }
  {
    const { healthSnapshot, routeHealth } = await import('../../js/agents/health.js');
    const sent = (h) => { const went = []; routeHealth(h, { record: () => went.push('record'), ledger: () => went.push('ledger'), 'worker:extractor': () => went.push('extractor') }); return went.join(','); };
    let h = healthSnapshot({ storyId: 'm254', ledgerBehind: true });
    assert(h.status === 'yellow' && !h.clean, 'a page the ledger has not read is not green: ' + h.status);
    eq(sent(h), 'ledger', 'the reader is sent to it');
    eq(sent(healthSnapshot({ storyId: 'm254', ledgerBehind: true, recordBehind: true })), 'record', 'one at a time — the record’s gap first');
    eq(sent(healthSnapshot({ storyId: 'm254', ledgerBehind: true, shelf: { extractor: { ok: false, why: 'unreachable' } } })), 'ledger', 'a stumbled minder no longer holds the gap back (M727)');
    h = healthSnapshot({ storyId: 'm254', ledgerBehind: true, running: ['extractor'] });
    assert(h.status === 'working' && sent(h) === '', 'never while a reader is out');
    eq(sent(healthSnapshot({ storyId: 'm254', ledgerBehind: true, queued: 1 })), '', 'nor while one waits its turn');
    eq(sent(healthSnapshot({ storyId: 'm254', recordBehind: true, otherOwner: true })), '', 'nor while another hand holds the tale, a replay runs or the storyteller writes');
    h = healthSnapshot({ storyId: 'm254' });
    assert(h.status === 'green' && h.clean && sent(h) === '', 'nothing waiting: green, and nobody is sent');
  }
  assert(/catch \(err\) \{ behind = true; \}/.test(chat), 'and if it cannot be checked, it is NOT green');
  /* M694 (90ca6b0): green also needs the auditor's verification of the ledger as it stands now, and its words say so */
  assert(/const allWellNow = allWell && !guards\.length && !repairOwed && !repairPaused && !openAudit && !verificationNeeded;/.test(chat), 'green waits on the current verification');
  assert(/The current ledger is read, folded and audited with no unresolved findings\. Write on\./.test(chat), 'and it says so plainly');

  /* the lamp */
  assert(/\.room-btn\.all-well::after/.test(css), 'green has its own lamp');
  assert(/0 0 12px 3px rgba\(34, 197, 94, 0\.4\)/.test(css), 'lit with a corona, not a flat dot');
  assert(/animation: ledger-lamp/.test(css), 'and the amber one breathes so a glance catches it');
  assert(/prefers-reduced-motion/.test(css), 'unless the writer asked for stillness');
  assert(!/\.room-btn\.all-well[^}]*animation:/.test(css), 'the green one is steady — a light that flickers asks for attention');

  /* the third coat defines EVERY token the others do, or a control falls back
   * to a browser default and looks like a mistake (M168's lesson) */
  const blockOf = (sel) => {
    const at = base.indexOf(sel);
    return at === -1 ? '' : base.slice(at, base.indexOf('}', at));
  };
  const root = blockOf(':root');
  const colourTokens = [...new Set([...root.matchAll(/(--[a-z0-9-]+):\s*#/g)].map((m) => m[1]))];
  assert(colourTokens.length >= 15, 'the house has a full palette (' + colourTokens.length + ')');
  /* M301: EVERY coat, however many there are — the law named the deep alone,
   * so a fourth coat could have shipped half-dressed and passed. (That the
   * house resolves a chosen coat is behaviour, and is held where behaviour
   * can be run: the walk, DOM-42.) */
  const coats = [...new Set([...base.matchAll(/html\[data-theme='([a-z-]+)'\]\s*\{/g)].map((m) => m[1]))];
  assert(coats.includes('deep') && coats.includes('magma') && coats.includes('light'), 'the coats: ' + coats.join(', '));
  for (const coat of coats) {
    const block = blockOf("html[data-theme='" + coat + "'] {");
    assert(block, 'the ' + coat + ' coat exists');
    for (const t of colourTokens) assert(block.includes(t + ':'), 'the ' + coat + ' coat defines ' + t);
    assert(new RegExp('name="theme" value="' + coat + '"').test(html), 'and the writer can choose ' + coat);
  }
});

/* M465: "each value is that coat's --bg in base.css, so the phone's own bar wears the room's ground". M729 (213a376) gave
 * Academy Night a new ground (#0b1320 → #090a0d) and left the bar on the old navy: two tables that must agree, held here
 * (DOM-42 wears every coat and finds each bar a colour of its own; this is that the colour is the room's). */
test('M465 the phone’s own bar wears each coat’s ground: the colour app.js gives the bar is that coat’s --bg', () => {
  const literal = read('js/app.js').match(/const COATS = (\{[\s\S]*?\});/);
  assert(literal, 'the coats and the colours of their bars');
  const bars = Function('return (' + literal[1] + ');')();
  const base = read('css/base.css');
  const blockOf = (sel) => { const at = base.indexOf(sel); return at === -1 ? '' : base.slice(at, base.indexOf('}', at)); };
  assert(Object.keys(bars).length >= 11, 'every coat: ' + Object.keys(bars).join(', '));
  for (const [coat, bar] of Object.entries(bars)) {
    const block = coat === 'dark' ? blockOf(':root') : blockOf("html[data-theme='" + coat + "'] {");
    const ground = (block.match(/--bg:\s*(#[0-9a-fA-F]{6})/) || [])[1];
    assert(ground, 'the ' + coat + ' coat has a ground');
    eq(String(bar).toLowerCase(), ground.toLowerCase(), 'the bar of the ' + coat + ' coat');
  }
});
