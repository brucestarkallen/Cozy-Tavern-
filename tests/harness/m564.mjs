/* Cozy Tavern — harness law of M564: the founder, told to write canon people "from the real record", is handed it. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { buildFounderMessages } from '../../js/agents/founder.js';
import { emptyState } from '../../js/engine/state.js';

test('M564 THE FOUNDER IS HANDED THE REAL RECORD IT IS TOLD TO WRITE CANON PEOPLE FROM — and told its own memory of a canon is not material where none is given', () => {
  const st = { ...emptyState(), mc: { name: 'Jovan' } };
  const withIt = buildFounderMessages({ state: st, brief: 'Bleach, after the war.', canonRecord: 'Kenpachi Zaraki — the captain of the 11th Division' });
  assert(/WHAT THE SERIES ITSELF SAYS OF ITS PEOPLE HERE[\s\S]*Kenpachi Zaraki — the captain of the 11th Division/.test(withIt.user), 'handed it');
  assert(/your own memory of a canon is not material/.test(withIt.system), 'never from memory');
  assert(!/WHAT THE SERIES ITSELF SAYS/.test(buildFounderMessages({ state: st, brief: 'x' }).user), 'none, nothing said');
});
