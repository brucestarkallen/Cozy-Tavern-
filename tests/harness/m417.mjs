/* M417: a date or an hour first in the header is the clock's, never the ground — and a header that is only a date still
 * sets the clock. Runs the real header reader and the real ledger. */
import { test, assert, eq } from './lib.mjs';
import { headerMutations, emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const read = (h) => {
  const m = headerMutations(h + '\n\nThe courtyard was quiet.');
  const p = m.find((x) => x.type === 'place.set');
  const c = m.find((x) => x.type === 'clock.set');
  return { place: p ? p.name : '', clock: c ? [c.year, c.month, c.day, c.hour, c.minute].join('-') : '' };
};

test('M417-1 A DATE OR AN HOUR FIRST IS NOT A PLACE: the ground is what follows it, the date sets the clock — and a place named for a day stays a place', () => {
  const cases = [
    ['[Monday, June 1, 2026 — 10th Division HQ — training courtyard | 10:40]', '10th Division HQ — training courtyard', '2026-6-1-10-40'],
    ['[June 1, 2026 — Karakura Town — Urahara Shop | 22:10]', 'Karakura Town — Urahara Shop', '2026-6-1-22-10'],
    ['[10:40 — 13th Division barracks | Monday, June 1, 2026]', '13th Division barracks', '2026-6-1-10-40'],
    ['[Monday morning — Kuoh Academy — club room | June 1, 2026 | 08:10]', 'Kuoh Academy — club room', '2026-6-1-8-10'],
    ['[10th Division HQ — training courtyard — Monday, June 1, 2026 | 10:40 | ☀]', '10th Division HQ — training courtyard', '2026-6-1-10-40'],
    ['[Sunday Market — east stalls — Monday, June 1, 2026 | 10:40]', 'Sunday Market — east stalls', '2026-6-1-10-40'],
    ["[Friday's Pub — back booth — Saturday, June 6, 2026 | 23:10]", "Friday's Pub — back booth", '2026-6-6-23-10'],
    ['[May 5th Avenue — the corner deli — Friday, March 14, 2025 | 14:30]', 'May 5th Avenue — the corner deli', '2025-3-14-14-30'],
    ['[Sunday Morning Cafe — patio | Friday, March 14, 2025 | 09:30]', 'Sunday Morning Cafe', '2025-3-14-9-30'],
    ['[Monday, June 1, 2026 | 10:40]', '', '2026-6-1-10-40'],
  ];
  for (const [h, place, clock] of cases) {
    const got = read(h);
    eq(got.place, place, 'the ground of ' + h);
    eq(got.clock, clock, 'the clock of ' + h);
  }
  /* through the ledger: the day never becomes the ground */
  const st = applyMutations({ ...emptyState(), page: 0 }, headerMutations('[Monday, June 1, 2026 — 10th Division HQ — training courtyard | 10:40]\n\nx')).state;
  eq(st.place.name, '10th Division HQ — training courtyard', 'the ledger stands in the courtyard, not on a Monday');
});
