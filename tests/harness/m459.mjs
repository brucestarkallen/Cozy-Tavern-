/* M459: who knows what, once. A shared family name no longer finds another person's book ("Byakuya Kuchiki" wrote into
 * Rukia's, and her block was drawn twice); a fact many here share is said once with who knows it; the same fact in new
 * words is one fact. Runs the real engine. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { findKnowledgeKey, renderKnowledge } from '../../js/engine/world.js';

test('M459-1 A SHARED FAMILY NAME NEVER FINDS ANOTHER’S BOOK — Byakuya’s facts go in his own, never Rukia’s; "Rukia" still finds hers', () => {
  let st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan Oda' }, ...['Jovan Oda', 'Rukia Kuchiki', 'Byakuya Kuchiki'].map((n) => ({ type: 'presence.enter', name: n })),
    { type: 'knowledge.add', name: 'Rukia Kuchiki', fact: 'the roster has no Jovan Oda on it' }]).state;
  eq(findKnowledgeKey(st.knowledge, 'Byakuya Kuchiki'), null, 'no book of his own: none of hers');
  eq(findKnowledgeKey(st.knowledge, 'Rukia'), 'Rukia Kuchiki', 'her short name still finds hers');
  st = applyMutations(st, [{ type: 'knowledge.add', name: 'Byakuya Kuchiki', fact: 'the Kuchiki elders want Rukia married by spring' }]).state;
  eq(st.knowledge['Rukia Kuchiki'].length, 1, 'her book untouched');
  assert((st.knowledge['Byakuya Kuchiki'] || []).some((k) => /elders/.test(k.fact)), 'his own book: ' + JSON.stringify(Object.keys(st.knowledge)));
  const said = renderKnowledge(st.knowledge, st.present, undefined, null);
  eq((said.match(/Rukia Kuchiki knows/g) || []).length, 1, 'her book drawn once');
});

test('M459-2 WHAT MANY HERE KNOW IS SAID ONCE, AND A RE-WORDED FACT IS ONE FACT — nothing a person knows goes unsaid', () => {
  const sword = 'that the blade stopped one inch from Zaraki’s face after circling the Seireitei';
  const witnesses = ['Hitsugaya', 'Isane Kotetsu', 'Suì-Fēng', 'Kensei'];
  const knowledge = {};
  for (const w of witnesses) knowledge[w] = [{ fact: sword, atTurn: 40 }, { fact: w + ' counted four beats between the strikes', atTurn: 41 }];
  knowledge['Zaraki Kenpachi'] = [{ fact: 'that Shunsui accepted Jovan through his own office and has named him captain of the 13th Division', atTurn: 20 },
    { fact: 'that Shunsui Kyoraku accepted Jovan Oda through his own office and has named Jovan captain of the 13th Division', atTurn: 22 }, { fact: 'felt the blade enter him from inside his own charge', atTurn: 41 }];
  const present = [{ name: 'Jovan Oda' }, ...witnesses.map((n) => ({ name: n })), { name: 'Zaraki Kenpachi' }];
  const said = renderKnowledge(knowledge, present, undefined, { pages: ['the sand'], ignore: ['Jovan Oda'], turn: 42 });
  eq((said.match(/stopped one inch/g) || []).length, 1, 'said once: ' + said);
  assert(/Everyone here but Zaraki Kenpachi knows: that the blade stopped one inch/.test(said), 'with who knows it');
  for (const w of witnesses) assert(said.includes(w + ' counted four beats'), w + '’s own fact stays');
  eq((said.match(/named (him|Jovan) captain of the 13th/g) || []).length, 1, 'the same fact in new words, once (the newer)');
  assert(/felt the blade enter him/.test(said), 'Zaraki’s own');
});
