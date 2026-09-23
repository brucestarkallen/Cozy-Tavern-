/* M421: a "now" written in one part of a place is stale once the scene moves to another part of it — judged by the
 * ledger's own one place matcher, the rule a move is made by. Runs the real ledger and the real stale-now finder. */
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations, staleNows } from '../../js/engine/apply.js';

test('M421-1 A MOVE INSIDE ONE COMPOUND IS A MOVE: Kyōraku\u2019s "at the rail, watching the sand" goes when the scene moves from the courtyard to the captain\u2019s office — and stays while it does not', () => {
  let st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'place.set', name: '10th Division HQ — training courtyard' },
    { type: 'presence.enter', name: 'Oda' }, { type: 'presence.enter', name: 'Shunsui Kyōraku' },
    { type: 'people.set', name: 'Shunsui Kyōraku', field: 'state', text: 'at the rail, watching the sand' }]).state;
  eq(staleNows(st, { ground: '10th Division HQ — training courtyard' }).length, 0, 'the same place: his now stands');
  eq(staleNows(st, { ground: '10th division HQ — Training Courtyard' }).length, 0, 'the same place in other letters: it stands');
  const moved = applyMutations(st, [{ type: 'place.set', name: '10th Division HQ — captain\u2019s office' }]);
  assert(moved.applied.length === 1, 'the ledger calls it a move');
  eq(JSON.stringify(staleNows(moved.state, { ground: '10th Division HQ — captain\u2019s office' })), JSON.stringify(['Shunsui Kyōraku']), 'and his courtyard now is of a place the scene has left');
});
