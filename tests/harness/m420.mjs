/* M420: who-knows-what finds a person under any form of their name — the scene's "Suì-Fēng" is her knowledge's
 * "Sui-Feng": her facts are shown as hers, and she is never told she "hasn't found out" her own secret. */
import { test, assert, eq } from './lib.mjs';
import { emptyState, renderStateFacts } from '../../js/engine/state.js';
import { findKnowledgeKey } from '../../js/engine/world.js';

test('M420-1 HER OWN SECRET IS HERS: "Suì-Fēng" in the scene reads the knowledge written under "Sui-Feng" — shown as what she knows, never as what she hasn\u2019t found out', () => {
  eq(findKnowledgeKey({ 'Sui-Feng': [] }, 'Suì-Fēng'), 'Sui-Feng', 'folded letters find her');
  eq(findKnowledgeKey({ 'Rukia Kuchiki': [], 'Byakuya Kuchiki': [] }, 'Kuchiki'), null, 'a surname two people share finds nobody');
  const st = { ...emptyState(), page: 3, sheet: { playerName: 'Oda', actors: {} },
    present: [{ name: 'Oda' }, { name: 'Suì-Fēng' }, { name: 'Rukia' }],
    knowledge: { 'Sui-Feng': [{ fact: 'the Onmitsukido watches Oda', atTurn: 3 }], 'Rukia Kuchiki': [{ fact: 'Oda skipped the captains meeting yesterday', atTurn: 3 }] } };
  const facts = renderStateFacts(st, { scenePages: ['The Onmitsukido watches from the roof; Oda skipped the meeting.'] });
  assert(/Sui-Feng knows: the Onmitsukido watches Oda/.test(facts), 'her fact, as hers: ' + facts);
  assert(!/Suì-Fēng hasn’t found out:[^\n]*Onmitsukido/.test(facts), 'never told she hasn’t found out her own secret: ' + facts);
  assert(/Suì-Fēng hasn’t found out: Oda skipped the captains meeting yesterday \(Rukia Kuchiki knows\)/.test(facts), 'what she truly has not learned is still said');
});
