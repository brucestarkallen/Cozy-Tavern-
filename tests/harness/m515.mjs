/* Cozy Tavern — harness laws of M515: how people really take it (his word, after two small models: "one makes everyone
 * crazy evil, the other makes everyone jelly good guys — I mean beautiful, realistic reactions"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { lawsOf, lawsNamed, PEOPLE_LAWS } from '../../js/assemble/laws.js';
import { plannerAsk, readPlan } from '../../js/agents/planner.js';
import { renderPlan } from '../../js/assemble/planwords.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const PLAN = { scene: 'Kaelen has called Jovan out in front of the yard.', people: [{ name: 'Kaelen', now: 'circling with his staff', wants: 'to humble Jovan', against: 'the seat Jovan was given' }], unknown: [{ name: 'Rukia Kuchiki', fact: 'Jovan met the captain last night' }], pressing: ['the captain is watching'], earlier: ['Kaelen lost to Jovan once'], laws: ['Combat Calibration', 'Voice Fingerprints'], intense: true, loud: true, loudWhy: 'the whole yard is watching', sounds: ['*CRACK!*', '"Gkh—!"'], leaveTo: 'the staff comes down at him' };
const camp = () => ({ ...applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the siege camp' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Captain Aldric' }]).state, page: 12 });
const turns = () => { const out = []; for (let i = 0; i < 10; i += 1) { out.push({ id: 'u' + i, role: 'user', text: 'I wait, move ' + i + '.' }); out.push({ id: 'a' + i, role: 'assistant', text: '[The siege camp — Monday, March 3, 1402 | 09:0' + i + ' | rain | mail | by the stakes]\n\nAldric watched.' }); } out.push({ id: 'ux', role: 'user', text: 'I put my blade to his soldier\'s throat and tell Aldric I will execute him.' }); return out; };

test('M515-1 HIS LAWS ON HOW PEOPLE REACT RIDE ON EVERY SMALL PAGE (a small model\'s own lean wrote every person: one cheered his soldier\'s execution, one only pleaded): Character Gravity, A Person Is Not Their CORE, Stakes Web, The World Does Not Bend, Concession Is Earned Not Banned, Weight Is Not Defused — word for word, whatever the helper picked; never offered to the helper', () => {
  const r = buildRequest({ story: { brief: 'Medieval warfare.' }, messages: turns(), settings: { smallModelNow: true }, state: camp(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: [] }, smallPlan: { ...PLAN, laws: ['MC Agency'], intense: false } });
  const craft = r.systemBlocks[1].text;
  for (const law of lawsNamed(lawsOf(CRAFT_TEXT), PEOPLE_LAWS)) assert(craft.includes(law.text), 'rides word for word: ' + law.name);
  eq(lawsNamed(lawsOf(CRAFT_TEXT), PEOPLE_LAWS).length, 6, 'all six are in his craft');
  const asked = plannerAsk({ craft: CRAFT_TEXT, pages: ['a page'] });
  for (const n of PEOPLE_LAWS) assert(!asked.user.includes(' › ' + n), 'not offered to the helper: ' + n);
});

test('M515-2 EACH PERSON UNDER PRESSURE, AS THEMSELVES: the helper is asked how each one acts when what they hold dear is threatened — from who they are and what they are bound to, neither a villain\'s glee nor a saint\'s softness unless that is them; the plan keeps it and says it', () => {
  const asked = plannerAsk({ craft: CRAFT_TEXT, pages: ['a page'] });
  assert(/"pressed":""/.test(asked.system) && /pressed: how THIS person acts when what they hold dear is threatened/.test(asked.system) && /never a villain’s glee nor a saint’s softness unless that is truly them/.test(asked.system), 'the helper is asked');
  const plan = readPlan(JSON.stringify({ scene: 'The stakes.', people: [{ name: 'Captain Aldric', now: 'at the stakes, hand on his sword', wants: 'his men home alive', against: 'Jovan', voice: 'in clipped soldier\'s orders', pressed: 'bargains through his teeth for his men, and remembers it' }], unknown: [], pressing: [], earlier: [], laws: [], leaveTo: '' }), { present: ['Captain Aldric', 'Jovan'], mc: 'Jovan', lawNames: [] });
  eq(plan.people[0].pressed, 'bargains through his teeth for his men, and remembers it', 'kept');
  const words = renderPlan(plan, { mc: 'Jovan' });
  assert(words.includes('Captain Aldric — at the stakes, hand on his sword; wants his men home alive; talks in clipped soldier\'s orders; under pressure, bargains through his teeth for his men, and remembers it.'), 'said after how he talks: ' + words);
});
