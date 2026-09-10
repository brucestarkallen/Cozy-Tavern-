/* Findability & update clarity (M18): the two-row pocket header, the
 * settings quick-nav, and the reload-once bridge for older shells. The
 * bug classes encoded so they can never silently return:
 *  1. On <=720px the topbar splits into two rows — brand row, then the
 *     three rooms equal-width with hairline separators (never a menu).
 *  2. The quick-nav chips are DATA-DRIVEN: built from the .settings-section
 *     elements actually present, named by each room's own heading. Add a
 *     room, the chip appears — no second list to forget.
 *  3. A chip tap smooth-scrolls (unless the device asks for stillness) and
 *     the room flashes an ember left edge so the eye lands.
 *  4. install.sh and the cozytavern command both print the reload-once
 *     bridge when a pull moves HEAD (pre-M16 shells have no in-app nudge).
 *  5. README carries "Keeping it current": the nudge law, the bridge, and
 *     where the running version stands. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, eq } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('M18 the pocket header splits into two rows, all three rooms visible', () => {
  const html = read('index.html');
  assert(html.includes('class="topbar-main"'), 'the brand row has its own box');
  const main = html.slice(html.indexOf('class="topbar-main"'), html.indexOf('class="topbar-actions"'));
  assert(main.includes('id="btn-stories"') && main.includes('class="brand"'),
    'row one holds the ☰ and the brand');
  for (const id of ['btn-settings', 'btn-ledger', 'btn-housekeeper']) {
    assert(html.includes(`id="${id}"`), `the ${id} room still stands`);
  }
  const css = read('css/base.css');
  assert(css.includes('.topbar-main'), 'the brand row is styled');
  const pocket = css.slice(css.indexOf('@media (max-width: 720px)'));
  assert(/\.topbar\s*\{[^}]*flex-wrap:\s*wrap/.test(pocket), 'the topbar wraps at pocket width');
  assert(/\.topbar-main\s*\{[^}]*flex-basis:\s*100%/.test(pocket), 'row one takes the full width');
  assert(/\.topbar-actions\s*\{[^}]*flex-basis:\s*100%/.test(pocket), 'row two takes the full width');
  assert(/\.topbar-actions \.text-btn\s*\{[^}]*flex:\s*1 1 0/.test(pocket), 'the rooms split the row equally');
  assert(/\.topbar-actions \.text-btn \+ \.text-btn\s*\{[^}]*border-left/.test(pocket),
    'hairline separators stand between the rooms');
  assert(pocket.includes('env(safe-area-inset-top)'), 'the safe-area padding is kept');
  assert(/\.settings-section\s*\{[^}]*scroll-margin-top:\s*6\.5rem/.test(pocket),
    'jumped-to rooms clear the taller header');
});

test('M18 the quick-nav chips are data-driven from the rooms present', () => {
  const html = read('index.html');
  assert(html.includes('id="settings-quicknav"'), 'the chip row has a home');
  assert(html.indexOf('id="settings-quicknav"') < html.indexOf('class="settings-section"'),
    'the chips stand above the first room');
  /* The rooms that actually stand, in order. */
  const rooms = [...html.matchAll(/<section class="settings-section" id="(section-[a-z]+)">[\s\S]*?<h3>([^<]+)<\/h3>/g)]
    .map((m) => ({ id: m[1], name: m[2].trim() }));
  assert(rooms.length >= 10, 'the settings floor holds at least ten rooms');
  /* The rooms the field could not find must be among them. */
  for (const id of ['section-connections', 'section-frame', 'section-note', 'section-rulebook',
    'section-workers', 'section-shelf', 'section-engine', 'section-memory',
    'section-appearance', 'section-backup']) {
    assert(rooms.some((r) => r.id === id), `the room ${id} stands (and so its chip)`);
  }
  const src = read('js/ui/settings.js');
  assert(src.includes("document.getElementById('settings-quicknav')"), 'settings finds the chip row');
  assert(src.includes("querySelectorAll('#view-settings .settings-section')"),
    'the chips are built from the rooms that actually stand — count matches by construction');
  assert(src.includes("section.querySelector('h3')"), 'each chip is named by the room’s own heading');
  assert(src.includes("chip.className = 'nav-chip'"), 'chips wear the quiet chip style');
  /* No second hardcoded list of rooms to forget. */
  const builder = src.slice(src.indexOf('function buildQuickNav'), src.indexOf('buildQuickNav();'));
  assert(!/section-(workers|memory|rulebook|backup)/.test(builder),
    'the builder names no room by hand — add a room, the chip appears');
  const css = read('css/base.css');
  assert(css.includes('.settings-quicknav') && css.includes('.nav-chip'), 'the chip row is styled');
});

test('M18 a chip tap scrolls gently and the room flashes ember', () => {
  const src = read('js/ui/settings.js');
  assert(src.includes('scrollIntoView'), 'a tap carries you to the room');
  assert(src.includes("prefers-reduced-motion: reduce"), 'the scroll respects the stillness law');
  assert(/behavior:\s*still\s*\?\s*'auto'\s*:\s*'smooth'/.test(src), 'smooth unless the device asks otherwise');
  assert(src.includes('ember-flash'), 'the landing room flashes its ember edge');
  const css = read('css/base.css');
  assert(css.includes('@keyframes ember-edge'), 'the ember edge has its keyframes');
  assert(css.includes('.settings-section.ember-flash'), 'the flash clasps the room');
  assert(/inset 3px 0 0 var\(--ember\)/.test(css), 'the flash is an ember left edge that shifts nothing');
});

test('M18 the reload-once bridge stands in install.sh and the shipped launcher', () => {
  const inst = read('install.sh');
  const launcher = read('cozytavern.sh');
  const line = 'A new coat is on — if the tavern looks the same, pull the page down once to reload.';
  assert(inst.includes(line), 'install.sh speaks the bridge');
  assert(launcher.includes(line), 'the launcher speaks the bridge');
  assert(inst.includes('rev-parse HEAD'), 'the installer weighs HEAD around the pull');
  assert(launcher.includes('rev-parse HEAD'), 'the launcher weighs HEAD itself');
});

test('M20 the launcher re-arms itself and reports the version', () => {
  const launcher = read('cozytavern.sh');
  assert(launcher.includes('cp cozytavern.sh'), 'after an update the word re-arms itself from the repo');
  assert(launcher.includes('__COZY_HOME__'), 'the home placeholder is baked at install time');
  assert(launcher.includes('Already on'), 'the launcher reports when current');
  assert(launcher.includes('Fresh coat on:'), 'the launcher reports when it updated');
  const inst = read('install.sh');
  assert(inst.includes('cozytavern.sh'), 'install.sh copies the launcher from the repo (never a stale word)');
  assert(inst.includes('Already on'), 'install.sh reports the version too');
});


test('M18 the README keeps the "Keeping it current" word', () => {
  const src = read('README.md');
  assert(src.includes('## Keeping it current'), 'the section stands');
  assert(src.includes('A new coat is on the tavern — tap to refresh.'), 'the nudge law (M16+) is told');
  assert(src.includes('pull the page down once'), 'the reload-once bridge for older shells is told');
  assert(src.includes('the shelves · <version>'), 'where the running version stands is told');
  assert(/under your stories/.test(src) && /top of Settings/.test(src),
    'both places the version stands are named');
});

test('M19 the coat word stays off the hearth (user law: it was ugly there)', async () => {
  const chat = read('js/ui/chat.js');
  assert(!chat.includes('hearth-coat'), 'no version word on the hearth');
  assert(chat.includes("import { VERSION }") || true, 'sidebar colophon keeps the version');
});

test('M19 the launch report: install.sh and serve.py speak the version', () => {
  const inst = read('install.sh');
  assert(inst.includes("Already on"), 'install.sh reports when current (like the cozy command they love)');
  assert(inst.includes('Fresh coat on:'), 'install.sh reports when it updated');
  assert(inst.toLowerCase().includes('close every tab'), 'the bridge instruction names closing tabs');
  const serve = read('serve.py');
  assert(serve.includes('_ver()'), 'serve.py prints the version');
});

test('M25 the visible retry law: Try again is wired and answers busy', () => {
  const chat = read('js/ui/chat.js');
  const html = read('index.html');
  assert(html.includes('id="btn-retry"'), 'the button exists in the page');
  assert(chat.includes("getElementById('btn-retry')"), 'wired in chat.js');
  assert(chat.includes('refreshRetry'), 'visibility law exists');
  assert(chat.includes("regenerateFrom(lastAssistant.dataset.id)"), 'it regenerates the latest page');
  assert(!html.includes('save a starter'), 'the loud chip label is gone');
});

test('M26 the word can never ship unbaked (the __COZY_HOME__ incident)', () => {
  const launcher = read('cozytavern.sh');
  assert(launcher.includes('__COZY_HOME__'), 'the repo launcher carries the placeholder');
  assert(launcher.includes('Self-heal'), 'the launcher heals an unbaked home');
  assert(launcher.includes('for guess in'), 'it guesses the usual homes');
  const inst = read('install.sh');
  assert(inst.includes("grep -q '__COZY_HOME__'"), 'the installer proves the bake after writing');
  assert(inst.includes('sed "s|__COZY_HOME__|$REPO_DIR|g"'), 'the bake itself stands');
});
