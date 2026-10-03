/* Cozy Tavern — harness law of M558: his brief makes Jovan an official E-tier who "barely fights" in public, "deliberately
 * understates his own ability", his ice and fire CONCEALED — and the sheet rated the mask (melee 6, "5 for anything not
 * listed") while Ivar, top of the rankings, was 9 at everything. The sheet decides contests: the truth, never the mask; a
 * default is what someone does outside their arts, never their peak. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { SEED_SYSTEM, SEED_VERSION } from '../../js/agents/referee.js';

test('M558 THE SHEET RATES THE TRUTH, NEVER THE MASK — a public rank, a reputation, a pretended level are what others believe; concealed arts are rated; a rank tells power only where nothing says otherwise; a default sits below the best, never at the peak', () => {
  assert(/TRUE ABILITY, NEVER THE MASK/.test(SEED_SYSTEM) && /never their public rank, their reputation, what others believe of them, or the level they pretend to be/.test(SEED_SYSTEM), 'the truth');
  assert(/hides, conceals, understates or seals their power \(a low official tier, "barely fights", a concealed affinity, a sealed form\), rate the truth — their concealed arts included/.test(SEED_SYSTEM), 'concealed power, rated');
  assert(/A rank tells power only where nothing says otherwise/.test(SEED_SYSTEM) && /a public rank the brief says is a mask is not that level/.test(SEED_SYSTEM), 'a rank, a mask');
  assert(/DEFAULT is how a person fares at something they are NOT known for — almost always two to four below their best domains, never their peak/.test(SEED_SYSTEM), 'defaults below the best');
  assert(SEED_VERSION >= 6, 'weighed again once');
});
