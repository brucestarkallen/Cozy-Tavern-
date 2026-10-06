/* M627 — his: "on my flash model the header's location is not detailed, only 'New York City' while my MC is at his friend's
 * apartment". Laws RUN the header reader with the ledger's ground. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { broaderPlace, noOneSpot } from '../../js/engine/apply.js';
import { headerMutations } from '../../js/engine/state.js';

test('M627-1 A HEADER THAT NAMES ONLY THE AREA IS NO MOVE — the city over the apartment, the town over the clinic, the district over the barracks; a real spot, a fuller name, or a ledger with no ground still move it', () => {
  for (const [h, g] of [['New York City', 'Mark\u2019s apartment'], ['Karakura Town', 'Kurosaki Clinic'], ['Seireitei', '13th Division Barracks'], ['Tokyo', 'Mark\u2019s apartment']]) eq(broaderPlace(h, g), true, h + ' over ' + g + ': only the area');
  for (const [h, g] of [['Central Park', 'Mark\u2019s apartment'], ['Mark\u2019s apartment', 'New York City'], ['New York City', 'New York City'], ['New York City', '']]) eq(broaderPlace(h, g), false, h + ' over ' + (g || 'nothing') + ': a move as before');
  assert(noOneSpot('Brooklyn') && noOneSpot('New York City') && !noOneSpot('the Bluebird diner'), 'one spot or none, by M396\u2019s measure');
  const page = '[New York City — Monday, March 3, 2025 | 21:10 | rain | hoodie | on the couch]\n\nHe stayed on the couch.';
  eq(headerMutations(page, { ground: 'Mark\u2019s apartment' }).map((m) => m.type).join(','), 'clock.set', 'the hour is read, the area is not a ground');
  eq(headerMutations(page).map((m) => m.type).join(','), 'place.set,clock.set', 'with no ground handed in, as before');
});
