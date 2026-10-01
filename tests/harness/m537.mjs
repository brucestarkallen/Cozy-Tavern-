/* Cozy Tavern — harness laws of M537: a misspelling of someone found is not "not found" (his storyteller's thinking: "Wait —
 * the canon note says 'Not found in this story's canon sources: "Gojo Satorou" — treat these as original to this story'.
 * Hmm, but actually the canon DOES list Satoru Gojo. The name is slightly misspelled."). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { unverifiedNamedForHarness as unverified } from '../../js/canon/grounding.js';

const WIKI = 'jujutsu-kaisen.fandom.com';
const store = {
  'satoru gojo': { name: 'Satoru Gojo', aliases: ['Gojo Satoru', 'Gojo'], found: true, sections: { identity: 'x' } },
  'gojo satorou': { name: 'Gojo Satorou', found: false, reason: 'no-page', searched: [WIKI], trusted: true, ts: 1 },
  'takeshi moriyama': { name: 'Takeshi Moriyama', found: false, reason: 'no-page', searched: [WIKI], trusted: true, ts: 2 },
  'gojo kenta': { name: 'Gojo Kenta', found: false, reason: 'no-page', searched: [WIKI], trusted: true, ts: 3 },
};

test('M537-1 A NAME ONE SLIP FROM SOMEONE FOUND IS THAT PERSON, NOT "NOT FOUND": "Gojo Satorou" beside the found Satoru Gojo is never told to the storyteller as original to the story; a name that is truly no one the wiki knows still is, and so is a different person who only shares a family name', () => {
  const said = (msg) => unverified(msg, store, WIKI, []).map((x) => (typeof x === 'string' ? x : x.name));
  eq(said('Where is Gojo Satorou? Why is the fake Geto here?').join(', '), '', 'the misspelling is not reported');
  assert(said('Have you met Takeshi Moriyama?').includes('Takeshi Moriyama'), 'a name the wiki truly lacks is still reported');
  assert(said('Is Gojo Kenta the heir?').includes('Gojo Kenta'), 'a different person sharing only the family name is still news');
});
