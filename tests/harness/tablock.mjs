/* A6: one tab holds the pen; a second only reads; a release passes it on.
 * M160: and only ONE waiting tab may take it. */
import { test, assert, eq } from './lib.mjs';
import { acquirePen } from '../../js/tablock.js';

test('A6: first tab holds the pen, second reads, release promotes the waiter', async () => {
  const first = await acquirePen();
  eq(first.primary, true, 'first tab holds the pen');
  let promoted = false;
  const second = await acquirePen({ onPromoted: () => { promoted = true; } });
  eq(second.primary, false, 'second tab opens read-only');
  first.release();
  await new Promise((r) => setTimeout(r, 600));
  assert(promoted, 'the waiting tab is told the pen is free');
  second.release();
});

/* M160: THE PEN IS BID FOR, NEVER SEIZED. When the holder let go, EVERY
 * waiting tab promoted itself on the spot — two writers on one IndexedDB
 * store, the exact tear the lock exists to prevent. A free pen is bid for
 * and the lowest id takes it; the rest keep reading. */
test('M160: two waiting tabs, one released pen — exactly one tab takes it', async () => {
  const holder = await acquirePen();
  eq(holder.primary, true, 'the holder holds');
  let takers = 0;
  const a = await acquirePen({ onPromoted: () => { takers += 1; } });
  const b = await acquirePen({ onPromoted: () => { takers += 1; } });
  eq(a.primary, false, 'the first waiter reads');
  eq(b.primary, false, 'the second waiter reads');
  holder.release();
  await new Promise((r) => setTimeout(r, 800));
  eq(takers, 1, 'exactly one waiting tab took the pen (was ' + takers + ')');
  a.release(); b.release();
});
