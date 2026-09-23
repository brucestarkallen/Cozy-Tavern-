/* M451: who is here is said once in what the storyteller reads — the notes say it (with where each stands and what they
 * wear); the system's "Who's here" block no longer repeats the names. Runs the real request builder. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';

test('M451-1 WHO IS HERE IS SAID ONCE — the names ride in the notes with where they stand, never again in the system block; a present card still rides', () => {
  const state = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: "13th Division Barracks — Captain's Office" },
    { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki', position: 'at the filing cabinet' }, { type: 'presence.enter', name: 'Byakuya Kuchiki' }]).state;
  const r = buildRequest({ story: { brief: 'A Bleach story.', castNotes: 'Rukia is his lieutenant.' }, messages: [{ role: 'user', content: 'I look up.' }], settings: { noteText: '' }, state, modules: [], memory: '',
    cast: [{ name: 'Byakuya Kuchiki', description: 'Captain of the 6th, cold and exact.' }], window: { keeperOn: false } });
  const all = [...(r.systemBlocks || []).map((b) => b.text), ...(r.messages || []).map((m) => String(m.content))].join('\n');
  eq((all.match(/Byakuya Kuchiki, /g) || []).length + (all.match(/, Byakuya Kuchiki/g) || []).length, 1, 'the list of who is here, once');
  assert(/Here now: [^\n]*Rukia Kuchiki \(at the filing cabinet\)/.test(all), 'with where she stands');
  assert(!/Here right now/.test(all), 'never again in the system block');
  assert(/Captain of the 6th, cold and exact/.test(all), 'his card still rides while he is here');
  assert(/Rukia is his lieutenant/.test(all), 'and the cast notes');
});
