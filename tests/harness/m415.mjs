/* M415: "done" said of a card that LANDS ON ARRIVAL is true — the housekeeper is handed it back only when his cards wait
 * for Apply. Runs the real housekeeperTurn with the setting read from the real store, and counts the model calls. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { housekeeperTurn } from '../../js/agents/housekeeper.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const scene = () => applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
const DONE = 'Done — her page now says she is watching the duel from the galleries.\n<ledits>[{"type":"people.set","name":"Rukia Kuchiki","field":"state","text":"watching the duel from the galleries"}]</ledits>';

test('M415-1 CARDS THAT LAND ON ARRIVAL MAY SAY "DONE": one model call, the words he sees kept — and with Apply by hand, the hand-back still comes', async () => {
  const st = await db.stories.create({ title: 'The duel' });
  await saveState(st.id, scene());
  const prior = await db.settings.get('hkAutoApply');
  try {
    await db.settings.set('hkAutoApply', true);
    let calls = [];
    const call = async ({ messages }) => { calls.push(messages[messages.length - 1].content); return { text: DONE }; };
    const landing = await housekeeperTurn({ storyId: st.id, writerText: 'Rukia is at the duel — fix her page', connection: { type: 'openai' }, call });
    assert(landing.ok, landing.error);
    eq(calls.length, 1, 'cards that land on arrival: the answer is taken as it came — no second call');
    assert(!calls.some((c) => /^\[NOT YET\]/.test(c)), 'and no "[NOT YET]" hand-back');
    calls = [];
    await db.settings.set('hkAutoApply', false);
    const waiting = await housekeeperTurn({ storyId: st.id, writerText: 'and once more, by hand', connection: { type: 'openai' }, call });
    assert(waiting.ok, waiting.error);
    assert(calls.some((c) => /^\[NOT YET\]/.test(c)), 'cards that wait for Apply: "done" is handed back once — ' + calls.map((c) => c.slice(0, 40)).join(' | '));
  } finally {
    await db.settings.set('hkAutoApply', prior === undefined ? true : prior);
  }
});
