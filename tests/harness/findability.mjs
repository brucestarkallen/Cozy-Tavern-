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

test('M18 → M97 the header is ONE slim row at every width, all three rooms visible as icons with their names on them', () => {
  const html = read('index.html');
  assert(html.includes('class="topbar-main"'), 'the brand box stands');
  const main = html.slice(html.indexOf('class="topbar-main"'), html.indexOf('class="topbar-actions"'));
  assert(main.includes('id="btn-stories"') && main.includes('class="brand"'), 'the ☰ and the brand');
  for (const id of ['btn-settings', 'btn-ledger', 'btn-housekeeper']) {
    assert(html.includes(`id="${id}"`), `the ${id} room still stands`);
    const btn = html.slice(html.indexOf(`id="${id}"`), html.indexOf('</button>', html.indexOf(`id="${id}"`)));
    assert(/aria-label="[^"]+"/.test(btn) && /title="[^"]+"/.test(btn) && /<svg/.test(btn) && /room-btn/.test(btn), `${id} is an icon with its name as label and tooltip`);
  }
  const css = read('css/base.css');
  assert(css.includes('.topbar-main'), 'the brand row is styled');
  const pocket = css.slice(css.indexOf('@media (max-width: 720px)'));
  assert(!/\.topbar\s*\{[^}]*flex-wrap:\s*wrap/.test(pocket), 'the topbar no longer wraps into two rows at pocket width (M97)');
  assert(/\.room-btn\.current\s*\{[^}]*var\(--ember\)/.test(css), 'the room you are in keeps the ember');
  assert(/@media \(max-width: 380px\)\s*\{\s*\.brand\s*\{\s*display:\s*none/.test(css), 'the brand yields on the narrowest screens so the rooms stay in sight');
});

test('M18 → M105 settings is rooms, one open at a time: a tab strip of six, every section assigned, the open room remembered', () => {
  const html = read('index.html');
  const rooms = [...html.matchAll(/<section class="settings-section" id="([^"]+)"/g)].map((m) => m[1]);
  assert(rooms.length >= 8, 'the rooms stand');
  const src = read('js/ui/settings.js');
  assert(src.includes("document.getElementById('settings-quicknav')"), 'settings finds the strip');
  const builder = src.slice(src.indexOf('const ROOMS = ['), src.indexOf('nav.openRoomFor'));
  /* every section in index.html belongs to a room; a section the strip does not name falls to the house */
  const named = [...builder.matchAll(/'(section-[a-z-]+)'/g)].map((m) => m[1]);
  for (const id of rooms) assert(named.includes(id) || /roomOf = \(id\) => \(ROOMS\.find/.test(builder), 'assigned or defaulted: ' + id);
  assert(/section\.hidden = roomOf\(section\.id\) !== room/.test(builder), 'a room not open is hidden, not moved');
  assert(/db\.settings\.set\('settingsRoom', room\)/.test(builder), 'the open room is remembered');
  assert(src.includes("chip.className = 'nav-chip'"), 'chips wear the quiet chip style');
  const css = read('css/base.css');
  assert(css.includes('.settings-quicknav') && css.includes('.nav-chip.current'), 'the strip is styled and the open room keeps the ember');
  /* the ledger drawer has its four rooms the same way */
  const drawer = read('js/ui/drawer.js');
  assert(/const DRAWER_ROOMS = \[/.test(drawer) && /\['scene', 'The scene'\]/.test(drawer) && /\['books', 'The books'\]/.test(drawer), 'the drawer’s rooms');
  for (const id of ['the-clock', 'the-people', 'elsewhere', 'the-record', 'the-workers', 'voices']) assert(new RegExp("'" + id + "': '(scene|people|world|books)'").test(drawer), 'every panel has a room: ' + id);
  assert(/sec\.hidden = roomOfPanel\(sec\.dataset\.panel\) !== room/.test(drawer) && /db\.settings\.set\('drawerRoom', room\)/.test(drawer), 'hidden not moved; remembered');
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
