/* Cozy Tavern — harness law of M562: one game master's procedure; the better fighter never counted twice; the ruling quick. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { SEED_SYSTEM, DUEL_SYSTEM } from '../../js/agents/referee.js';

test('M562 ONE PROCEDURE, IN A GAME MASTER\'S ORDER — read it all, deeds in their context, the truth not the mask, place in the world where nothing is shown, numbers that agree with each other, him by the same evidence — no rule spoken twice, no milestone number in the model\'s words; and a beat\'s tilt never counts the better fighter a second time', () => {
  const order = ['1. Read all of it first', '2. What they have DONE weighs most', '3. The truth, never the mask', '4. Where the story has not shown their measure yet', '5. The numbers agree with each other the way the story does', '6. The main character is weighed by exactly the same evidence'];
  let at = -1;
  for (const step of order) { const i = SEED_SYSTEM.indexOf(step); assert(i > at, 'in order: ' + step); at = i; }
  assert(/near-equal rivals sit within a point of each other; someone who clearly outclasses another sits two or more above/.test(SEED_SYSTEM), 'relative sense');
  assert(/rate the middle of what it allows, never its floor/.test(SEED_SYSTEM), 'doubt is the middle, not the floor');
  assert(!/\(M\d{3}\)/.test(SEED_SYSTEM) && !/CALIBRATE TO THE STORY|RATE AS A SHARP GAME MASTER|TRUE ABILITY, NEVER THE MASK|A feat is a floor/.test(SEED_SYSTEM), 'no stacked rule left, no milestone number');
  assert(!/simply the more dangerous fighter/.test(DUEL_SYSTEM) && /never because they are the better fighter: the ratings already carry that, and counting it here would count it twice/.test(DUEL_SYSTEM), 'the better fighter counted once');
});
