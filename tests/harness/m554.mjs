/* Cozy Tavern — harness laws of M554: his two reports beside the audit —
 * 1. "why does the AI love to make my MC weak? he parries the strongest student, and the sheet says melee 5 against 8":
 *    the cast sheet's guide meant doubt as lower for everyone and a rival as the player's peer or stronger by default, and
 *    set the ranking and the brief over every page. Now it rates by what each person has DONE, the main character by the
 *    same evidence as anyone; sheets weighed before are weighed again once.
 * 2. "Jovan inside his house, Claire on the street outside — and she is on who's here": the helpers were told "everyone
 *    the page shows there". Now one definition, shared: here means sharing his space. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { SEED_SYSTEM, SEED_VERSION, seedDue, mergeSeed } from '../../js/agents/referee.js';
import { HERE_MEANS } from '../../js/agents/herewords.js';
import { buildExtractorMessages } from '../../js/agents/extractor.js';
import { buildAuditorMessages } from '../../js/agents/auditor.js';
import { buildWorldMessages } from '../../js/agents/world.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

test('M554-1 THE CAST SHEET RATES BY WHAT EACH PERSON HAS DONE — the main character by the same evidence as anyone, never lower for being his; a rival is his peer or stronger only until the pages show how they compare; what a person did on the page outranks the rank they hold', () => {
  assert(!/doubt means lower/.test(SEED_SYSTEM), 'doubt no longer means lower for the main character');
  assert(/What a person has DONE on the page is the strongest evidence there is — someone who holds their own against a fighter rated N is near N in that domain/.test(SEED_SYSTEM), 'evidence first');
  assert(/The main character is rated by exactly the same evidence as everyone else: never lower for being the one the writer plays, never higher/.test(SEED_SYSTEM), 'him by the same evidence');
  assert(/what a person has DONE on the page outranks the rank they hold/.test(SEED_SYSTEM) && !/The brief outranks every page\./.test(SEED_SYSTEM), 'the page outranks the rank; the brief stands where it states a level');
});

test('M554-2 A SHEET WEIGHED UNDER THE OLD GUIDE IS WEIGHED AGAIN, ONCE — and the new weighing takes his numbers where the evidence puts them (up or down), never over the writer\'s own hand', () => {
  const st = applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Jovan Wessex' }]).state;
  st.sheet = { playerName: 'Jovan Wessex', seedVersion: SEED_VERSION - 1, seededAtPage: 29, actors: {
    'Jovan Wessex': { default: 5, domains: { melee: 5, intellect: 8 }, _auto: true, seed: SEED_VERSION - 1 },
    'Ivar van Emreis': { default: 8, domains: { melee: 8, shadow: 8 }, _auto: true, seed: SEED_VERSION - 1 },
    'Mira': { default: 6, domains: { craft: 9 }, _hand: true },
  } };
  eq(seedDue(st, 30, {}), 'heal', 'weighed again once');
  const r = mergeSeed(st, { actors: [{ name: 'Jovan Wessex', default: 7, domains: { melee: 8, intellect: 8 } }, { name: 'Ivar van Emreis', default: 8, domains: { melee: 8 } }, { name: 'Mira', default: 2, domains: { craft: 1 } }] }, { heal: true });
  assert(r.touched >= 2, 'weighed');
  eq(st.sheet.actors['Jovan Wessex'].domains.melee, 8, 'he parried the strongest: near the strongest in melee');
  eq(st.sheet.actors['Jovan Wessex'].default, 7);
  eq(st.sheet.actors.Mira.domains.craft, 9, 'the writer\'s own hand is never weighed over');
  st.sheet.seedVersion = SEED_VERSION;
  assert(seedDue(st, 30, {}) !== 'heal', 'and then not again');
});

test('M554-3 WHO IS IN THE SCENE IS ONE DEFINITION, AND EVERY HELPER THAT WRITES WHO IS HERE IS HANDED IT — the page reader, the auditor, the world beyond: sharing his space; someone only seen at a distance is where they are', () => {
  assert(/someone at his door is here/.test(HERE_MEANS) && /on the street outside while he is indoors/.test(HERE_MEANS) && /glimpsed through a window/.test(HERE_MEANS), 'the door, the street, the window');
  const st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: "Jovan's house" }, { type: 'presence.enter', name: 'Jovan' }]).state;
  const wire = (m) => JSON.stringify(m);
  assert(wire(buildExtractorMessages({ state: st, userText: 'I look out of the window.', assistantText: 'Claire was on the street outside, talking on her phone.' })).includes(HERE_MEANS), 'the page reader');
  assert(wire(buildAuditorMessages({ state: st, pages: [{ role: 'assistant', text: 'x' }], pageCount: 1 })).includes(HERE_MEANS), 'the auditor');
  assert(wire(buildWorldMessages({ state: st, userText: 'x', assistantText: 'y' })).includes(HERE_MEANS), 'the world beyond');
});
