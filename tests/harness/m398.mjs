/* M398: the rest of the ledger asks "is this person here?" of the one matcher, and a page names the story threads its
 * person owns — so no reader (the housekeeper, the auditor, the scribe, the referee, the drawer) takes a page, a seat
 * or a thread for missing when it is there under another form of the name. Each runs the real code. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { runConversation } from '../../js/agents/housekeeper.js';
import { scribeTurn } from '../../js/agents/scribe.js';
import { seedPeople } from '../../js/agents/referee.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const scene = () => {
  const st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Rukia' },
    { type: 'thread.set', title: 'Rukia Kuchiki and the 13th Division command', owner: 'Rukia', next: 'find how Jovan was appointed' }]).state;
  st.characters = { 'Rukia Kuchiki': { core: 'His lieutenant; she had expected the captaincy.', state: 'watching the duel', threads: [] } };
  return st;
};

test('M398-1 A PAGE NAMES THE STORY THREADS ITS PERSON OWNS: the housekeeper reads Rukia’s page with her thread named on it — never "(none)" beside a thread she owns', async () => {
  const seen = [];
  const r = await runConversation({ story: { id: 's', title: 't', brief: '' }, messages: [], state: scene(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, writerText: 'is the ledger consistent?', contextPages: 8, call: async ({ messages }) => { seen.push(messages.map((m) => String(m.content)).join('\n')); return { text: 'It reads consistent.' }; } });
  assert(r.ok, r.error);
  assert(/\[Rukia Kuchiki\][\s\S]*THREADS: \(none\)\n  OWNS THESE STORY THREADS[^\n]*Rukia Kuchiki and the 13th Division command/.test(seen[0]), 'her page names the thread she owns: ' + (seen[0].match(/\[Rukia Kuchiki\][\s\S]{0,400}/) || [''])[0]);
});

test('M398-2 THE SCRIBE’S "NOW" FOR SOMEONE IN THE SCENE UNDER ANOTHER FORM OF THE NAME IS KEPT; FOR SOMEONE SEATED ELSEWHERE IT STAYS THE SEAT’S', async () => {
  const st = scene();
  st.characters['Byakuya Kuchiki'] = { core: 'Captain of the 6th.', state: 'x', threads: [] };
  const seated = applyMutations(st, [{ type: 'offscreen.set', name: 'Byakuya Kuchiki', location: '6th Division office', activity: 'signing orders', stance: 'busy' }]).state;
  /* a stale note of hers from before she walked in, under her page's name — the case the exact match got wrong */
  seated.offscreen = { ...seated.offscreen, 'Rukia Kuchiki': { location: '13th Division barracks, her office', activity: 'reviewing the roster', stance: 'busy' } };
  const sid = 'm398-scribe';
  await saveState(sid, seated);
  const answer = JSON.stringify({ deltas: [
    { name: 'Rukia Kuchiki', field: 'state', text: 'at the galleries’ rail, arms folded, eyes on the duel' },
    { name: 'Byakuya Kuchiki', field: 'state', text: 'watching from the rail' },
  ] });
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
    const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
  };
  await withHouse({ fetch: fetchImpl }, () => scribeTurn({ connection: HOUSES[0].conn, storyId: sid, userText: 'I step into the yard.', assistantText: 'Rukia watches from the rail.' }));
  const after = await loadState(sid);
  eq(after.characters['Rukia Kuchiki'].state, 'at the galleries’ rail, arms folded, eyes on the duel', 'in the scene as "Rukia": her now is kept');
  eq(after.characters['Byakuya Kuchiki'].state, 'x', 'seated elsewhere: the seat is his now (M130)');
});

test('M398-3 THE REFEREE’S CAST KNOWS WHO IS HERE UNDER ANY FORM OF THE NAME', () => {
  const st = scene();
  const out = seedPeople(st, '', 60000);
  const text = typeof out === 'string' ? out : JSON.stringify(out);
  assert(/Rukia Kuchiki[^\n]*(here|in the scene)/i.test(text), 'Rukia Kuchiki is here: ' + text.slice(0, 300));
});

test('M398-4 ONE PERSON, ONE PAGE: a page is found by folded letters and by canon’s other name for its person — never a second page for Suì-Fēng written as "Sui-Feng" or "Soi Fon"; two Vanessas are still two', async () => {
  const { setAliasSource, foldName } = await import('../../js/engine/names.js');
  const hers = (chars) => Object.keys(chars).filter((k) => /feng|soi fon/.test(foldName(k))).join();
  let st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'people.set', name: 'Suì-Fēng', field: 'core', text: 'Captain of the 2nd Division.' }, { type: 'people.set', name: 'Vanessa Reynolds', field: 'core', text: 'x' }, { type: 'people.set', name: 'Vanessa Cole', field: 'core', text: 'y' }]).state;
  st = applyMutations(st, [{ type: 'people.set', name: 'Sui-Feng', field: 'state', text: 'at the rail' }]).state;
  eq(hers(st.characters), 'Suì-Fēng', 'folded letters: her page, not a second one');
  /* letters folded beyond any spelling distance: four marks apart */
  st = applyMutations(st, [{ type: 'people.set', name: 'Rōjūrō Ōtoribashi', field: 'core', text: 'Captain of the 3rd.' }]).state;
  st = applyMutations(st, [{ type: 'people.set', name: 'Rojuro Otoribashi', field: 'state', text: 'in the galleries' }]).state;
  eq(Object.keys(st.characters).filter((k) => /otoribashi/.test(foldName(k))).join(), 'Rōjūrō Ōtoribashi', 'Rose keeps one page however his marks are written');
  setAliasSource(() => [['Suì-Fēng', 'Soi Fon']]);
  st = applyMutations(st, [{ type: 'people.set', name: 'Soi Fon', field: 'arc', text: 'wary of him' }]).state;
  eq(hers(st.characters), 'Suì-Fēng', 'canon’s other name: still her page');
  eq(st.characters['Suì-Fēng'].arc, 'wary of him', 'written where she is kept');
  st = applyMutations(st, [{ type: 'people.set', name: 'Vanessa', field: 'state', text: 'z' }]).state;
  assert(!st.characters['Vanessa Reynolds'].state && !st.characters['Vanessa Cole'].state, 'two Vanessas: neither is guessed');
  setAliasSource(() => []);
});
