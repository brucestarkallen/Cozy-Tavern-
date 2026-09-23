/* M418: one person's two pages, one written with a rank — joined under the NAME, never under the rank; and a rank is not
 * part of a name's length. Runs the real join finder and the real ledger's rename. */
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations, duplicatePages } from '../../js/engine/apply.js';

test('M418-1 A RANKED PAGE JOINS THE NAME: "Lieutenant Rukia Kuchiki" folds into "Rukia Kuchiki" (both halves kept, her place in the scene follows); "Captain Hitsugaya" into "Toshiro Hitsugaya"; two Kuchikis never', () => {
  /* a ledger from before M414, which wrote a second page for each form (since M414 a write under either form finds the
   * page already there, so no new pair is made — this is the pair an older ledger still holds) */
  let st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'presence.enter', name: 'Oda' },
    { type: 'presence.enter', name: 'Lieutenant Rukia Kuchiki', position: 'at the edge of the sand' }]).state;
  st.characters = {
    ...st.characters,
    'Lieutenant Rukia Kuchiki': { state: 'drilling the recruits', updatedAtTurn: 2 },
    'Rukia Kuchiki': { core: 'Oda\u2019s lieutenant; proud, precise.', updatedAtTurn: 1 },
    'Captain Hitsugaya': { state: 'reading reports', updatedAtTurn: 2 },
    'Toshiro Hitsugaya': { core: 'captain of the 10th.', updatedAtTurn: 1 },
  };
  const joins = duplicatePages(st);
  eq(JSON.stringify(joins.map((j) => [j.from, j.to]).sort()), JSON.stringify([['Captain Hitsugaya', 'Toshiro Hitsugaya'], ['Lieutenant Rukia Kuchiki', 'Rukia Kuchiki']]), 'the ranked pages join the names');
  const done = applyMutations(st, joins.map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one person, one page' })));
  st = done.state;
  assert(!st.characters['Lieutenant Rukia Kuchiki'] && st.characters['Rukia Kuchiki'], 'one page, under her name');
  eq(st.characters['Rukia Kuchiki'].core, 'Oda\u2019s lieutenant; proud, precise.', 'her core kept');
  eq(st.characters['Rukia Kuchiki'].state, 'drilling the recruits', 'and the now the ranked page held');
  assert(st.present.some((p) => /Rukia Kuchiki/.test(p.name)), 'she is still in the scene');
  assert(!st.characters['Captain Hitsugaya'] && st.characters['Toshiro Hitsugaya'].state === 'reading reports', 'Hitsugaya: one page, his now kept');
  const kuchikis = { ...emptyState(), characters: { 'Captain Kuchiki': { core: 'x' }, 'Byakuya Kuchiki': { core: 'x' }, 'Rukia Kuchiki': { core: 'x' } } };
  eq(duplicatePages(kuchikis).length, 0, 'a rank and a surname shared by two Kuchikis join nobody');
  /* whichever page the ledger lists first, the join goes the same way — into the name */
  const nameFirst = { ...emptyState(), characters: { 'Rukia Kuchiki': { core: 'x' }, 'Lieutenant Rukia Kuchiki': { state: 'y' } } };
  eq(JSON.stringify(duplicatePages(nameFirst)), JSON.stringify([{ from: 'Lieutenant Rukia Kuchiki', to: 'Rukia Kuchiki' }]), 'the name listed first: the ranked page still joins it');
});
