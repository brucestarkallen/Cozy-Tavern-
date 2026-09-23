/* M422: a housekeeper card's review watches the entry its write lands on — found by the same finder (M419), so a card
 * about "Rukia" notices when "Rukia Kuchiki"'s body changes under it. Runs the real slice hash on a real ledger. */
import { test, assert } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { ledgerSliceHash } from '../../js/agents/housekeeper.js';

test('M422-1 A CARD WATCHES WHAT IT WRITES: the slice of "body:rukia" is Rukia Kuchiki\u2019s body — a new hurt changes it; someone else\u2019s does not', () => {
  const st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'people.set', name: 'Rukia Kuchiki', field: 'core', text: 'his lieutenant' },
    { type: 'people.set', name: 'Renji Abarai', field: 'core', text: 'lieutenant of the 6th' }, { type: 'body.injure', name: 'Rukia', what: 'a cut on the forearm', sev: 1 }]).state;
  const before = ledgerSliceHash(st, 'body:rukia');
  const hurt = applyMutations(st, [{ type: 'body.injure', name: 'Rukia Kuchiki', what: 'bruised ribs', sev: 2 }]).state;
  assert(ledgerSliceHash(hurt, 'body:rukia') !== before, 'her body changed under the card — the review sees it');
  const other = applyMutations(st, [{ type: 'body.injure', name: 'Renji Abarai', what: 'a black eye', sev: 1 }]).state;
  assert(ledgerSliceHash(other, 'body:rukia') === before, 'someone else\u2019s hurt leaves her slice alone');
});
