/* M625 — his: "I played with canon verification, then branched at the start of the story: is it normal that What canon
 * says does not reset, and no line says where the setting is right now?" Laws RUN the branch's canon carry. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { carryCanonMemory, canonMetaKey, setCanonOn } from '../../js/canon/bridge.js';
import { saveState, emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const KARAKURA = { name: 'Karakura Town', kind: 'place', found: true, wiki: 'bleach', sections: { identity: 'A town in western Tokyo.' }, aliases: [], ts: 1 };
const SEIREITEI = { name: 'Seireitei', kind: 'place', found: true, wiki: 'bleach', sections: { identity: 'The Soul Reapers\u2019 city.' }, aliases: [], ts: 2 };
const RUKIA = { name: 'Rukia Kuchiki', kind: 'character', found: true, wiki: 'bleach', sections: { identity: 'A Soul Reaper.' }, aliases: ['Rukia'], ts: 3 };

test('M625-1 A BRANCH FROM AN EARLIER PAGE KNOWS WHERE ITS SCENE IS AT ONCE — the later setting is not carried; the branch\u2019s own ledger place, as canon knows it, is set the moment the branch is made; what the series says and his decrees go with it', async () => {
  const from = (await db.stories.create({ title: 'trunk' })).id;
  await setCanonOn(from, true);
  await db.settings.set(canonMetaKey(from), {
    canon_grounding_cache: { 'karakura town': KARAKURA, seireitei: SEIREITEI, 'rukia kuchiki': RUKIA },
    canon_grounding_wiki: 'bleach', canon_grounding_pin: 'his note', canon_grounding_setting: 'seireitei',
  });
  const branch = (await db.stories.create({ title: 'trunk — a branch' })).id;
  const led = applyMutations({ ...emptyState() }, [{ type: 'place.set', name: 'Karakura Town — the Kurosaki Clinic' }]).state;
  await saveState(branch, led);
  eq(await carryCanonMemory(from, branch, { fromTheTail: false }), true, 'carried');
  const b = await db.settings.get(canonMetaKey(branch));
  eq(b.canon_grounding_setting, 'karakura town', 'the scene\u2019s setting is the branch\u2019s own — Karakura Town, from its ledger — not the later Seireitei');
  assert(b.canon_grounding_cache['rukia kuchiki'] && b.canon_grounding_wiki === 'bleach' && b.canon_grounding_pin === 'his note', 'the series and his decrees go with the branch');
  /* a branch whose place canon has not looked up gets no setting — the next page's pass looks, as before */
  const other = (await db.stories.create({ title: 'trunk — a branch 2' })).id;
  await saveState(other, applyMutations({ ...emptyState() }, [{ type: 'place.set', name: 'A noodle stall' }]).state);
  await carryCanonMemory(from, other, { fromTheTail: false });
  eq((await db.settings.get(canonMetaKey(other))).canon_grounding_setting, undefined, 'a place canon does not know: no setting');
});
