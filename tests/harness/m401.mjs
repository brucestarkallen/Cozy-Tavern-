/* M401: the quiet ones in the room — whoever is here and not on the page is kept alive by the world agent: one line of
 * what they are doing and weighing, on their own page, where the storyteller already reads everyone here. The world
 * agent writes that "now" for them alone. Runs the real world agent on a scripted model and the real ledger. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { quietInScene, buildWorldMessages, worldTurn } from '../../js/agents/world.js';
import { renderPeopleTiers } from '../../js/engine/people.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const PAGE = 'Zaraki reels back, blood sheeting from his ribs, and laughs — Rukia’s knuckles whiten on the rail.';
const duel = () => {
  const st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'Eleventh Division yard' },
    ...['Jovan Oda', 'Kenpachi Zaraki', 'Shunsui Kyōraku', 'Rukia Kuchiki'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
  st.characters = { 'Kenpachi Zaraki': { core: 'Captain of the 11th.', state: 'fighting', threads: [] }, 'Shunsui Kyōraku': { core: 'Captain-Commander; lazy-eyed, never lazy.', state: 'arriving at the rail', threads: [] }, 'Rukia Kuchiki': { core: 'His lieutenant.', state: 'watching', threads: [] }, 'Byakuya Kuchiki': { core: 'Captain of the 6th.', state: 'x', threads: [] } };
  return st;
};

test('M401-1 WHO IS QUIET IN THE ROOM: here, not him, not on the page — Kyōraku at the rail, never Zaraki or Rukia whom the page showed', () => {
  const st = duel();
  eq(quietInScene(st, PAGE, 'I press the attack.').join(), 'Shunsui Kyōraku', 'only the one the page left quiet');
  const msg = buildWorldMessages({ state: st, userText: 'I press the attack.', assistantText: PAGE, brief: 'A Bleach story.' });
  assert(/IN THE SCENE, NOT ON THE PAGE[^\n]*\n- Shunsui Kyōraku — Captain-Commander/.test(msg.user), 'the world agent is shown him, with who he is');
  assert(!/NOT ON THE PAGE[^\n]*\n- Kenpachi Zaraki/.test(msg.user), 'and not the fighter the page showed');
  assert(/THE QUIET ONES IN THE ROOM/.test(msg.system) && /never a line of dialogue/.test(msg.system), 'the law is said');
});

test('M401-2 THE WORLD AGENT KEEPS HIM ALIVE, AND ONLY HIM: his now lands on his page and reaches the storyteller; a now for someone the page showed, or someone away, is let go', async () => {
  const sid = 'm401';
  await saveState(sid, duel());
  const answer = JSON.stringify({ mutations: [
    { type: 'people.set', name: 'Shunsui Kyōraku', field: 'state', text: 'at the rail, hat tipped low, one hand drifting to Katen Kyōkotsu, weighing whether to stop it before Zaraki dies' },
    { type: 'people.set', name: 'Kenpachi Zaraki', field: 'state', text: 'kneeling' },
    { type: 'people.set', name: 'Byakuya Kuchiki', field: 'state', text: 'in his office' },
  ], brief: { note: 'The yard holds its breath.' } });
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
    const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
  };
  await withHouse({ fetch: fetchImpl }, () => worldTurn({ connection: HOUSES[0].conn, storyId: sid, userText: 'I press the attack.', assistantText: PAGE, brief: 'A Bleach story.' }));
  const after = await loadState(sid);
  assert(/weighing whether to stop it before Zaraki dies/.test(after.characters['Shunsui Kyōraku'].state), 'his now, on his page');
  eq(after.characters['Kenpachi Zaraki'].state, 'fighting', 'the fighter the page showed is the scribe’s');
  eq(after.characters['Byakuya Kuchiki'].state, 'x', 'someone away is the seat’s, never a now');
  const told = renderPeopleTiers(after, { recentPages: [PAGE] });
  assert(/weighing whether to stop it before Zaraki dies/.test(typeof told === 'string' ? told : JSON.stringify(told)), 'and the storyteller reads it with everyone here');
});
