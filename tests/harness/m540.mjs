/* Cozy Tavern — harness laws of M540: short names are the same day (his ledger: "Saturday, January 1, 2000 — 11:15" while his
 * page's header said "Mariner's Lane, Ravenwood — Thu, Aug 20, 2026 | 11:15"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { headerMutations } from '../../js/engine/state.js';

const read = (h) => headerMutations(h + '\n\nThe gulls cried.').map((m) => (m.type === 'place.set' ? 'place=' + m.name : m.year ? m.year + '-' + m.month + '-' + m.day + ' ' + m.hour + ':' + m.minute : 'time ' + m.hour + ':' + m.minute + (m.dayWords ? ' (' + m.dayWords + ')' : ''))).join(' | ');

test('M540-1 THE HEADER\'S DATE, IN SHORT NAMES OR LONG: "Thu, Aug 20, 2026", "Sat., Sept. 5", "20 Aug 2026", a date before the place — the day is read; a place that begins like a short weekday or month ("Sun Temple", "Mar Vista Pier") stays a place; a story\'s own calendar is still its own', () => {
  eq(read("[Mariner's Lane, Ravenwood — Thu, Aug 20, 2026 | 11:15 | overcast | jacket | by the railing]"), "place=Mariner's Lane, Ravenwood | 2026-8-20 11:15", 'his header');
  eq(read("[Mariner's Lane, Ravenwood — Thursday, August 20, 2026 | 11:15 | overcast]"), "place=Mariner's Lane, Ravenwood | 2026-8-20 11:15", 'the long names, as before');
  eq(read("[Mariner's Lane — 20 Aug 2026 | 11:15]"), "place=Mariner's Lane | 2026-8-20 11:15", 'the day first');
  eq(read("[Thu, Aug 20, 2026 — Mariner's Lane, Ravenwood | 11:15]"), "place=Mariner's Lane, Ravenwood | 2026-8-20 11:15", 'the date before the place');
  eq(read('[Sun Temple — Sat., Sept. 5, 2026 | 06:40 | dawn]'), 'place=Sun Temple | 2026-9-5 6:40', 'a place like a short weekday');
  eq(read('[Mar Vista Pier — Mon, Mar 3, 2025 | 18:05 | dusk]'), 'place=Mar Vista Pier | 2025-3-3 18:5', 'a place like a short month');
  eq(read('[Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:20 | clear]'), 'place=Tenth Division Courtyard | time 9:20 (Sunday, Hanami 5, 1001 AG)', 'the story\'s own calendar (M455)');
});
