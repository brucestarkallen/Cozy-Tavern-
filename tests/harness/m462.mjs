/* M462: a card says who someone is — never where they once stood, never the series' look twice. His own cores, through
 * the real card writer and the real people block. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { cardCore, renderPeopleTiers } from '../../js/engine/people.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';

test('M462-1 A MOMENT IN A CORE GOES; WHO THEY ARE STAYS — Byakuya, Mayuri, and a core that merely mentions standing', () => {
  eq(cardCore('Captain of the 6th Division; assembled at 1st Division HQ with the available captains'), 'Captain of the 6th Division');
  eq(cardCore('gliding along with his golden eyes half-lidded; wants to profile Jovan Oda; at the corridor outside the Assembly Hall, moving toward the 12th Division'), 'wants to profile Jovan Oda');
  eq(cardCore('A tall woman who stands by her captain; keeps the roster'), 'A tall woman who stands by her captain; keeps the roster');
});

test('M462-2 THE SERIES’ LOOK IS NEVER SAID TWICE — Rukia’s card lets go of "petite, slender, black hair, large violet eyes" that True of them carries; her uniform and her duty stay; his own truths are no reason', () => {
  let st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan Oda' }, ...['Jovan Oda', 'Rukia Kuchiki'].map((n) => ({ type: 'presence.enter', name: n })),
    { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'black', source: 'canon' }, { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'large violet', source: 'canon' },
    { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'build', value: 'petite, slender', source: 'canon' }]).state;
  st.characters = { 'Rukia Kuchiki': { core: 'Lieutenant of the 13th Division, 150+; petite, slender, black hair, large violet eyes, standard Shinigami uniform with lieutenant badge; fierce sense of duty', state: 'beside him', threads: [] } };
  const out = renderPeopleTiers(st);
  const block = typeof out === 'string' ? out : JSON.stringify(out);
  assert(/Rukia Kuchiki — Lieutenant of the 13th Division, 150\+; standard Shinigami uniform with lieutenant badge; fierce sense of duty/.test(block), 'her card: ' + block.slice(0, 400));
  assert(!/large violet eyes/.test(block), 'the series’ look is said once, in True of them');
  const his = applyMutations(st, [{ type: 'canon.unlock', name: 'Rukia Kuchiki', key: 'eyes' }, { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'large violet' }]).state;
  his.characters = st.characters;
  assert(/large violet eyes/.test(JSON.stringify(renderPeopleTiers(his))), 'a truth of his own is never a reason to let the card’s words go');
});
