/* M352: canon verification's switch could not be found — it was in no room's list, and the rule sent anything unlisted to
 * the LAST room: the glossary. It stands with the referee now, and a section nobody lists shows beside its neighbours. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { SETTINGS_ROOMS, roomForSection } from '../../js/ui/settings.js';

test('M352-1 EVERY SECTION OF SETTINGS IS LISTED IN EXACTLY ONE ROOM — the page itself is the list', () => {
  const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const ids = [...page.matchAll(/<section class="settings-section[^"]*" id="(section-[a-z-]+)"/g)].map((m) => m[1]);
  assert(ids.length > 15 && ids.includes('section-canon'), 'the page has its sections, canon verification among them');
  for (const id of ids) {
    const rooms = SETTINGS_ROOMS.filter(([, , list]) => list.includes(id)).map(([r]) => r);
    eq(rooms.length, 1, id + ' is listed in exactly one room (got: ' + rooms.join(', ') + ')');
  }
  for (const [, , list] of SETTINGS_ROOMS) for (const id of list) assert(ids.includes(id), id + ' is a room’s section and stands on the page');
  eq(roomForSection('section-canon', ids), 'readers', 'canon verification is in The readers, with the referee');
  eq(roomForSection('section-referee', ids), 'readers', 'and the referee is still there');
});

test('M352-2 A SECTION NOBODY LISTED SHOWS BESIDE ITS NEIGHBOURS, NEVER LOST IN THE GLOSSARY', () => {
  const order = ['section-connections', 'section-referee', 'section-new', 'section-memory', 'section-help'];
  eq(roomForSection('section-new', order), 'readers', 'the room of the section after it');
  eq(roomForSection('section-new', ['section-connections', 'section-new']), 'storyteller', 'else the one before it');
  eq(roomForSection('section-new', []), 'help', 'a page with no rooms at all is the only way to the last room');
});
