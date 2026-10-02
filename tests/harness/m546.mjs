/* Cozy Tavern — harness laws of M546: the final audit — the header gate reads short day and month names too (M540's fault in its
 * other reader). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { isHeaderLine } from '../../js/ui/headergate.js';

test('M546-1 A HEADER WITHOUT BRACKETS, IN SHORT NAMES, IS THE HEADER: "**Mariner\'s Lane — Thu, Aug 20, 2026 — 11:15**" opens the page (its words never stream into the thinking); a time-skip line, a sentence holding a date, and a place like "Sun Temple" with no date are not headers', () => {
  const cases = [
    ['**Mariner\'s Lane — Thu, Aug 20, 2026 — 11:15**', true],
    ['**Hillside cemetery — Tuesday, March 4, 2026 — 22:31**', true],
    ['[Mariner\'s Lane, Ravenwood — Thu, Aug 20, 2026 | 11:15 | overcast]', true],
    ['Sun Temple — Sat., Sept. 5, 2026 — 06:40', true],
    ['Thu, Aug 20 — 07:10', false],
    ['She checked the clock: Thu, Aug 20, 11:15.', false],
    ['Sun Temple at 06:40 was quiet', false],
  ];
  for (const [line, want] of cases) eq(isHeaderLine(line), want, line);
});
