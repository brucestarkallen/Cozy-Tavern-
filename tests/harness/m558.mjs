/* Cozy Tavern — harness law of M558: his brief makes Jovan an official E-tier who "barely fights" in public, "deliberately
 * understates his own ability", his ice and fire CONCEALED — and the sheet rated the mask (melee 6, "5 for anything not
 * listed") while Ivar, top of the rankings, was 9 at everything. The sheet decides contests: the truth, never the mask; a
 * default is what someone does outside their arts, never their peak. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { SEED_SYSTEM, SEED_VERSION } from '../../js/agents/referee.js';

test('M558 THE SHEET RATES THE TRUTH, NEVER THE MASK — a public rank, a reputation, a pretended level are what others believe; concealed arts are rated; a rank tells power only where nothing says otherwise; a default sits below the best, never at the peak', () => {
  assert(/The truth, never the mask/.test(SEED_SYSTEM) && /never their public rank, their reputation, what others believe of them, or the level they pretend to be/.test(SEED_SYSTEM), 'the truth');
  assert(/Concealed or sealed arts are rated; a low official tier the brief says is a mask is only what others believe/.test(SEED_SYSTEM), 'concealed power, rated; the mask');
  assert(/Where the story has not shown their measure yet, their place in the world sets it/.test(SEED_SYSTEM), 'a rank tells power only where the story has not shown it');
  assert(/DEFAULT is how a person fares at things they are NOT known for — usually two to four below their best, never their peak/.test(SEED_SYSTEM), 'defaults below the best');
  assert(SEED_VERSION >= 6, 'weighed again once');
});
