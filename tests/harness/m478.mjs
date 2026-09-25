/* M478 — a #story concept becomes the brief, its grammar set right; a polish that loses a name is refused. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { acceptablePolish, polishConcept } from '../../js/agents/concept.js';
import { thinkingHouse, withHouse } from './thinkinghouse.mjs';

const CONCEPT = 'the world where DC and Marvel live together on the same world. Jovan Arden. Very handsome white hair tall like gojo satorou Age 19 a rich a bastard son of famous billionaire. He got the power of summoning from another realm and can use their power so OP. Currently he walk and see Supergirl fighting someone omega threat.';
const POLISHED = 'A world where DC and Marvel live together. Jovan Arden: very handsome, white-haired and tall like Gojo Satoru, age 19, the rich bastard son of a famous billionaire. He has the power of summoning from another realm and can use its power — he is overpowered. Right now he is walking and sees Supergirl fighting an omega-level threat.';

test('M478-1 acceptablePolish: the names and the size must hold; a refusal, a dropped name, a runaway or a stub is refused', () => {
  assert(acceptablePolish(CONCEPT, POLISHED), 'a faithful polish passes');
  assert(!acceptablePolish(CONCEPT, POLISHED.replace('Supergirl', 'the heroine')), 'a dropped name is refused');
  assert(!acceptablePolish(CONCEPT, 'I cannot help with that.'), 'a refusal is refused');
  assert(!acceptablePolish(CONCEPT, 'Jovan Arden.'), 'a stub is refused');
  assert(!acceptablePolish(CONCEPT, POLISHED + ' ' + 'And then a great many things happened that nobody wrote. '.repeat(20)), 'a runaway is refused');
  assert(acceptablePolish('a quiet town', 'A quiet town.'), 'no names: the size alone is judged');
});

test('M478-2 polishConcept through a worker: the polished words come back; with no connection, or a refused polish, the raw words stand', async () => {
  const house = thinkingHouse({ answer: POLISHED });
  const r = await withHouse(house, () => polishConcept({ connection: { type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'deepseek-chat' }, concept: CONCEPT }));
  assert(r.polished && r.text === POLISHED, 'polished: ' + JSON.stringify(r).slice(0, 120));
  const none = await polishConcept({ connection: null, concept: CONCEPT });
  eq(none.text, CONCEPT); eq(none.polished, false);
  const bad = thinkingHouse({ answer: 'Sorry, I cannot rewrite that.' });
  const r2 = await withHouse(bad, () => polishConcept({ connection: { type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'deepseek-chat' }, concept: CONCEPT }));
  eq(r2.text, CONCEPT); assert(r2.refused, 'the raw words stand');
  eq((await polishConcept({ connection: {}, concept: '   ' })).text, '', 'nothing to polish');
});
