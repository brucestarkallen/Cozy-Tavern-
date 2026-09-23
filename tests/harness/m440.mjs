/* M440: the storyteller's rulebook keeps no quota on real life either — M366 took "at most one contact per scene" out of
 * the world agent's brief; the same cap stood in the storyteller's own rules for strangers. Runs the real request
 * builder with the shipped rulebook and reads what the storyteller is sent. */
import { test, assert } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { emptyState } from '../../js/engine/state.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';

test('M440-1 STRANGERS REACH IN AS THE PLACE SENDS THEM — no "at most one per scene" in what the storyteller is sent', () => {
  const req = buildRequest({
    story: { title: 't' }, messages: [{ id: 'u1', role: 'user', text: 'I walk through the market.' }], settings: {},
    state: { ...emptyState(), page: 1 }, modules: [{ mod: { id: 'core-craft', name: 'Craft', text: CRAFT_TEXT }, reason: 'always' }],
    memory: '', lore: '', loreFired: [], window: { mode: 'keeper', window: 30, budgetTokens: 200000 },
  });
  const wire = JSON.stringify({ s: req.systemBlocks, m: req.messages });
  assert(wire.includes('The World Reaches In'), 'the rule is sent');
  assert(!/at most one per scene|one per scene and not every scene/.test(wire), 'with no quota on strangers');
  assert(wire.includes('a busy market can send several, a quiet street none') && wire.includes('never on a timer, never to fill a scene'), 'each from their own reason and the place as it is');
});

test('M440-2 HIS OWN EDITED RULEBOOK IS READ WITHOUT THE HOUSE\u2019S REJECTED QUOTA LINE — and nothing else of his changes', async () => {
  await import('./idb-shim.mjs');
  const { saveModule, listModules } = await import('../../js/assemble/modules.js');
  const oldLine = 'may promote from texture to contact — small, locale-true, at most one per scene and not every scene, never on a timer.';
  const mine = 'MY OWN RULE: Rias never apologises.\n' + CRAFT_TEXT.replace("may promote from texture to contact — small, locale-true, each from that stranger's own reason and the place as it is: a busy market can send several, a quiet street none; never on a timer, never to fill a scene.", oldLine);
  assert(mine.includes(oldLine), 'the fixture carries the old line');
  await saveModule({ id: 'core-craft', text: mine, pinned: false });
  const craft = (await listModules()).find((m) => m.id === 'core-craft');
  assert(craft && craft.source === 'user', 'his copy is the one read');
  assert(!craft.text.includes(oldLine), 'the quota line is gone from what is read');
  assert(craft.text.includes('a busy market can send several, a quiet street none'), 'the shipped correction stands in its place');
  assert(craft.text.startsWith('MY OWN RULE: Rias never apologises.'), 'his own words untouched');
});
