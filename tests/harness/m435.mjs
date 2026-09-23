/* M435: a SillyTavern card's {{char}} is the card's own person and {{user}} the one he plays — in what the storyteller
 * is handed of a present card, and never as template syntax. Runs the real request builder. */
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

test('M435-1 A CARD\u2019S OWN WORDS READ WITH NAMES: "{{char}} is {{user}}\u2019s older sister" reaches the storyteller as "Rias is Jovan\u2019s older sister"', () => {
  const st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' }]).state;
  const req = buildRequest({
    story: { title: 't' },
    messages: [{ id: 'u1', role: 'user', text: 'I knock.' }],
    settings: {}, state: st, modules: [], memory: '', lore: '', loreFired: [],
    cast: [{ name: 'Rias', description: '{{char}} is {{user}}\u2019s older sister.', personality: '<BOT> teases <USER> gently.', scenario: '{{char}} and {{user}} share the Wells house.' }],
    window: { mode: 'keeper', window: 30, budgetTokens: 200000 },
  });
  const wire = JSON.stringify({ systemBlocks: req.systemBlocks, messages: req.messages });
  assert(wire.includes('Rias is Jovan\u2019s older sister.'), 'the description with names');
  assert(wire.includes('Rias teases Jovan gently.'), 'the personality with names (the older <BOT>/<USER> too)');
  assert(wire.includes('Rias and Jovan share the Wells house.'), 'the scenario with names');
  assert(!/\{\{\s*(?:char|user)\s*\}\}|<BOT>|<USER>/i.test(wire), 'no template syntax reaches the storyteller');
});
