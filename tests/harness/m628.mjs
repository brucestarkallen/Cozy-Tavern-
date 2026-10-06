/* M628 — his: "does the header now fix itself when it is not detailed — 'New York City' when it should say Jovan's bedroom?"
 * Laws RUN the header's fix and the ledger's ground. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { headerWithGround, emptyState } from '../../js/engine/state.js';
import { applyMutations, sameSpot, undoEntry } from '../../js/engine/apply.js';

test('M628-1 THE HEADER IS GIVEN THE SPOT — an area-only place gets the ledger\u2019s ground written in, the area kept after it; a place that is a spot, or no ground to give, is left as written', () => {
  const page = '[New York City — Monday, March 3, 2025 | 21:10 | rain | hoodie | on the bed]\n\nHe lay back.';
  eq(headerWithGround(page, 'Jovan\u2019s bedroom').split('\n')[0], '[Jovan\u2019s bedroom, New York City — Monday, March 3, 2025 | 21:10 | rain | hoodie | on the bed]', 'the spot, then the area');
  eq(headerWithGround(page, 'Jovan\u2019s bedroom, New York City').split('\n')[0], '[Jovan\u2019s bedroom, New York City — Monday, March 3, 2025 | 21:10 | rain | hoodie | on the bed]', 'a ground that holds the area already is written alone');
  eq(headerWithGround('[Central Park — Monday, March 3, 2025 | 21:10 | rain]\n\nx', 'Jovan\u2019s bedroom'), '[Central Park — Monday, March 3, 2025 | 21:10 | rain]\n\nx', 'a spot is the storyteller\u2019s');
  eq(headerWithGround(page, ''), page, 'nothing to give');
  assert(headerWithGround(page, 'Jovan\u2019s bedroom').endsWith('\n\nHe lay back.'), 'the page under it untouched');
});

test('M628-2 THE SAME SPOT WITH OR WITHOUT ITS AREA IS ONE GROUND — no move, everyone keeps where they stand; another room, or a deeper one, is still a move', () => {
  const base = () => applyMutations({ ...emptyState() }, [{ type: 'place.set', name: 'Jovan\u2019s bedroom' }, { type: 'presence.enter', name: 'Mark', position: 'by the desk' }]).state;
  const fuller = applyMutations(base(), [{ type: 'place.set', name: 'Jovan\u2019s bedroom — New York City' }]).state;
  eq(fuller.place.name, 'Jovan\u2019s bedroom — New York City', 'named in full');
  eq(fuller.present[0].position, 'by the desk', 'and Mark keeps where he stands');
  /* M629 (the session's audit): the renaming is taken back like any move — the old name again */
  const log = fuller.log || [];
  const undone = undoEntry(fuller, log.length - 1);
  eq(((undone && (undone.state || undone)).place || {}).name, 'Jovan\u2019s bedroom', 'taken back: the short name again');
  const back = applyMutations(fuller, [{ type: 'place.set', name: 'Jovan\u2019s bedroom' }]);
  assert(back.rejected.length && back.rejected[0].same && back.state.present[0].position === 'by the desk', 'the short name again: the same ground, nothing let go');
  eq(applyMutations(base(), [{ type: 'place.set', name: 'Jovan\u2019s kitchen' }]).state.present[0].position, undefined, 'another room is a move');
  assert(sameSpot('Mark\u2019s apartment', 'Mark\u2019s apartment, Brooklyn') && !sameSpot('the Barracks', 'the Barracks — Captain\u2019s Office'), 'one spot with its area; a deeper room is another spot');
});
