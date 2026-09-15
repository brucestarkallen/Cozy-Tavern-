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
test('M248: a run says whether it FINISHED, and the house carries on when it did not', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const status = fs.readFileSync(path.join(here, '../../js/agents/status.js'), 'utf8');
  const queue = fs.readFileSync(path.join(here, '../../js/agents/queue.js'), 'utf8');
  const chat = fs.readFileSync(path.join(here, '../../js/ui/chat.js'), 'utf8');
  const drawer = fs.readFileSync(path.join(here, '../../js/ui/drawer.js'), 'utf8');

  /* the third state: not ok, not merely stumbled — unfinished */
  assert(/unfinished, resume \} = \{\} \) =>|unfinished, resume \} = \{\}\) \{/.test(status) || /unfinished, resume \}/.test(status),
    'a run can be recorded as unfinished');
  assert(/unfinished: unfinished === true,/.test(status), 'and it is stored');
  assert(/resume: unfinished === true && typeof resume === 'string' \? resume : '',/.test(status),
    'with what it would take to finish');
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

  /* the mark the writer reads */
  assert(/const state = !row\.ok \? 'bad' : \(row\.unfinished \? 'part' : 'good'\);/.test(drawer), 'three states, not two');
  assert(/mark\.className = 'run-mark run-mark-' \+ state;/.test(drawer), 'each with its own mark');
  assert(/aria-label/.test(drawer.slice(drawer.indexOf('run-mark'), drawer.indexOf('run-mark') + 400)),
    'and a name for a screen reader, not colour alone');
  assert(/and stopped partway/.test(drawer), 'the words say it too');

  /* the button, for when the house is told not to */
  assert(/fix\.textContent = 'Finish it';/.test(drawer), 'an unfinished run offers to be finished');
  assert(/Carry on from where it stopped\. Nothing already done is redone\./.test(drawer), 'and says what that means');
  assert(/if \(row\.unfinished && row\.resume && ctx\.chat && typeof ctx\.chat\[row\.resume\] === 'function'\)/.test(drawer),
    'offered only where there is something to carry on');

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
  assert(/const readTo = Number\.isInteger\(stateBefore\.page\) \? stateBefore\.page : -1;/.test(chat),
    'how far the ledger has read is taken from state.page');
  assert(/if \(here > readTo \+ 1\) \{/.test(chat), 'and a gap is noticed');
  assert(/const missed = told\[readTo \+ 1\];/.test(chat), 'reaching for the OLDEST unread page, never the newest');
  assert(/older\.page = readTo \+ 1;/.test(chat), 'and the mark advances by exactly one');
  assert(/\} catch \(err\) \{ \/\* the page in hand still gets read \*\/ \}/.test(chat),
    'a catch-up that stumbles never costs the page the writer just wrote');

  /* state.page only advances on a SUCCESSFUL read — that is what makes it an
   * honest mark of the gap */
  const at = chat.indexOf("if (extractFailed) throw new Error('no answer reached us');");
  assert(at !== -1, 'a failed read throws');
  assert(chat.indexOf('fresh.page = k === -1 ? fresh.page : k;') > at,
    'and the page mark is only set AFTER that throw, so a failure never advances it');

  /* the arithmetic, on the writer's own case: four scenes read by nobody */
  const step = (readTo, here) => (here > readTo + 1 ? readTo + 1 : null);
  eq(step(-1, 3), 0, 'nothing read yet, four pages in: it goes back for the first');
  eq(step(0, 3), 1, 'then the second');
  eq(step(2, 3), null, 'and stops when the gap is closed');
  eq(step(3, 3), null, 'and does nothing when there was never one');
});
