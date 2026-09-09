/* A6: one tab holds the pen; a second only reads; a release passes it on. */
import { test, assert, eq } from './lib.mjs';
import { acquirePen } from '../../js/tablock.js';

test('A6: first tab holds the pen, second reads, release promotes the waiter', async () => {
  const first = await acquirePen();
  eq(first.primary, true, 'first tab holds the pen');
  let promoted = false;
  const second = await acquirePen({ onPromoted: () => { promoted = true; } });
  eq(second.primary, false, 'second tab opens read-only');
  first.release();
  await new Promise((r) => setTimeout(r, 120));
  assert(promoted, 'the waiting tab is told the pen is free');
  second.release();
});
