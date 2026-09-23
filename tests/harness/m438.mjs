/* M438: every change the housekeeper makes can be taken back exactly — the latest answer first — across the brief, the
 * cast notes, the lore shelf (added and changed), a person's page and a thread. Runs the real staging, apply-all and
 * take-back on the real store. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { parseProtocol, stageProposals, applyAllPending, undoLatest } from '../../js/agents/housekeeper.js';
import { saveLore, loadLore } from '../../js/import/lorebook.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

test('M438-1 WHAT THE HOUSEKEEPER CHANGED IS TAKEN BACK EXACTLY, THE LATEST ANSWER FIRST', async () => {
  const st0 = await db.stories.create({ title: 'Undo tale' });
  const sid = st0.id;
  await db.stories.update(sid, { brief: 'Jovan comes home. Rias is his older sister.', castNotes: 'Rias — red hair.' });
  await saveLore(sid, [{ id: 0, name: 'Rukia', keys: ['Rukia'], content: 'Lieutenant.', enabled: true }]);
  const st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' }, { type: 'people.set', name: 'Rias', field: 'core', text: 'his sister' }]).state;
  st.readTo = 2;
  await saveState(sid, st);
  const snap = async () => { const s = await db.stories.get(sid); const l = await loadState(sid); return JSON.stringify({ brief: s.brief, castNotes: s.castNotes, lore: await loadLore(sid), chars: l.characters, threads: l.threads }); };
  const start = await snap();
  const session = { id: 1, turns: [], batches: [] };
  const answer = async (text, ts) => {
    const staged = stageProposals(parseProtocol(text), { messages: [], state: await loadState(sid), modules: [], lore: await loadLore(sid), memory: { nodes: [] }, session, story: await db.stories.get(sid) });
    for (const p of staged) eq(p.status, 'pending', p.kind + ' staged: ' + p.words);
    session.turns.push({ role: 'housekeeper', text: 'x', proposals: staged, ts });
    const r = await applyAllPending(session, sid);
    assert(r.ok, r.words);
  };
  await answer('<brief>[{"field":"brief","find":"older sister","replace":"younger sister"},{"field":"cast","append":"Kim — the neighbor."}]</brief><ledits>[{"type":"people.set","name":"Rias","field":"core","text":"his younger sister"}]</ledits>', 1);
  const afterFirst = await snap();
  await answer('<lore>[{"add":true,"name":"Aurora","keys":["Aurora"],"content":"next door"},{"entry":"Rukia","content":"Oda\'s lieutenant."}]</lore><ledits>[{"type":"thread.set","owner":"Rias","title":"The party","next":"Saturday"}]</ledits>', 2);
  assert((await snap()) !== afterFirst, 'the second answer changed things');
  /* the latest answer's cards first, until the first answer's state stands again */
  for (let k = 0; k < 3 && (await snap()) !== afterFirst; k += 1) assert((await undoLatest(session, sid)).ok, 'a take-back');
  eq(await snap(), afterFirst, 'taking back the latest answer leaves the first answer standing, exactly');
  for (let k = 0; k < 4 && (await snap()) !== start; k += 1) assert((await undoLatest(session, sid)).ok, 'a take-back');
  eq(await snap(), start, 'and taking back the first leaves everything exactly as it was');
  const more = await undoLatest(session, sid);
  assert(more && more.ok === false, 'with nothing left, a take-back says so');
});
