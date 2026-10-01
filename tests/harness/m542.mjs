/* Cozy Tavern — harness laws of M542: a person the world is tracking is named once in the request (his question: "is the tracker
 * alive, and no redundancy?"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { buildRequest } from '../../js/assemble/stack.js';

test('M542-1 ONCE, NOT TWICE: Aurora, gone home and tracked by the world ("Elsewhere: Aurora Sterling — number 10, her bedroom window, …"), is not named again in the end-of-list roster; Old Mr. Hale, whom the world is not tracking, still is, with how long he has been away', () => {
  let st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan Wells' }, { type: 'place.set', name: "8 Mariner's Lane — upstairs hall" }, { type: 'presence.enter', name: 'Jovan Wells' }, { type: 'presence.enter', name: 'Rias Wells' }, { type: 'presence.enter', name: 'Aurora Sterling' }]).state;
  st = { ...st, characters: { ...st.characters, 'Aurora Sterling': { core: 'his neighbour at number 10', state: 'reading his message', updatedAtTurn: 12 }, 'Old Mr. Hale': { core: 'the mailman', state: 'sorting letters', updatedAtTurn: 3 } } };
  st = applyMutations({ ...st, page: 21 }, [{ type: 'presence.leave', name: 'Aurora Sterling' }]).state;
  st = applyMutations({ ...st, page: 21 }, [{ type: 'offscreen.set', name: 'Aurora Sterling', location: 'number 10, her bedroom window', activity: 'weighing whether to walk over at six fifty-five as promised' }]).state;
  st = { ...st, page: 21 };
  const req = buildRequest({ story: { id: 's', brief: 'Jovan comes home to Ravenwood.' }, messages: [{ id: 'u1', role: 'user', text: 'I knock on her door.' }], settings: {}, state: st, modules: [], memory: '', window: { keeperOn: false } });
  const text = [...(req.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text || '')), ...(req.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))].join('\n');
  assert(/Elsewhere: Aurora Sterling — number 10, her bedroom window, weighing whether to walk over at six fifty-five/.test(text), 'the live tracker carries her');
  const roster = (text.match(/Elsewhere in the tale:[^\n]*/) || [''])[0];
  assert(!/Aurora/.test(roster), 'the roster does not name her again: ' + roster);
  assert(/Old Mr\. Hale \(last seen \d+ turns ago\)/.test(roster), 'the untracked mailman stays, with how long he has been away: ' + roster);
});
