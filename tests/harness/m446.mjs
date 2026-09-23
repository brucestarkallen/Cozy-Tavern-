/* M446: Byakuya never left; Rukia was put "elsewhere — last seen at" the very office she stood in, her "now" true. A
 * leaving now stands only when the page ENDS on it: the last line of the scene that names the person as themself
 * narrates them going. Runs the real engine, the real page reader and the real auditor on scripted models. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { applyMutations, goneAtTheEnd } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { extractTurn } from '../../js/agents/extractor.js';
import { auditLedger } from '../../js/agents/auditor.js';

const ROOM = "13th Division Barracks — Captain's Office";
const streamed = (answer) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
  const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
  return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
};
const office = () => {
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: ROOM },
    ...['Jovan Oda', 'Rukia Kuchiki', 'Byakuya Kuchiki'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
  st.characters = { 'Rukia Kuchiki': { core: 'His lieutenant.', threads: [] }, 'Byakuya Kuchiki': { core: 'Captain of the 6th.', threads: [] } };
  return st;
};
const BACK = "[13th Division Barracks — Captain's Office]\n\nRukia stepped out to fetch the duty rosters.\n\nByakuya studied the map on the wall, silent.\n\nRukia came back with the files and set them on Oda’s desk.";
const ACROSS = "[13th Division Barracks — Captain's Office]\n\nRukia crossed to the window and stood looking out over the barracks while Byakuya spoke.";
const GONE = "[13th Division Barracks — Captain's Office]\n\nByakuya spoke of the 6th's patrols.\n\nRukia bowed to both captains and left the office.";
const OTHER = "[13th Division Barracks — Captain's Office]\n\nRukia filed the reports.\n\nKuchiki-taichō nodded to Oda, then left without a word.";
const PRONOUN = "[13th Division Barracks — Captain's Office]\n\nRukia rose from her desk. She bowed once and left.";

test('M446-1 GONE AT THE END OF THE PAGE: she stepped out and came back — here; crossed to the window — here; bowed and left — gone; another Kuchiki left — she is not; “She bowed once and left” on her line — gone', () => {
  const st = office();
  eq(goneAtTheEnd(st, BACK, 'Rukia Kuchiki'), false, 'out and back: the last line that names her has her back');
  eq(goneAtTheEnd(st, ACROSS, 'Rukia Kuchiki'), false, 'across the room: no going');
  eq(goneAtTheEnd(st, GONE, 'Rukia Kuchiki'), true, 'bowed and left: gone');
  eq(goneAtTheEnd(st, OTHER, 'Rukia Kuchiki'), false, 'Kuchiki-taichō leaving is not Rukia');
  eq(goneAtTheEnd(st, PRONOUN, 'Rukia Kuchiki'), true, 'a going told of her on the line that names her');
  eq(goneAtTheEnd(st, 'Rukia said, “I will leave now.” She stayed.', 'Rukia Kuchiki'), false, 'saying it is not going');
  eq(goneAtTheEnd(st, 'Rukia glanced at Kuchiki-taichō. He turned and left.', 'Rukia Kuchiki'), false, 'a “he” after another named by rank is his going, not hers');
  eq(goneAtTheEnd(st, 'Rukia glanced at Byakuya. He left.', 'Rukia Kuchiki'), false, 'nor after another named');
  eq(goneAtTheEnd(st, 'Rukia glanced at Byakuya. He left.', 'Byakuya Kuchiki'), false, 'and the pronoun is never taken for anyone the sentence did not start from');
});

test('M446-2 THE PAGE READER’S LEAVE STANDS ONLY WHEN THE PAGE ENDS ON IT — the step out and back, the walk to the window and another Kuchiki’s going take nobody out; a real going does', async () => {
  const leaveRukia = JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Rukia Kuchiki' }, { type: 'mode.snapshot', flags: [] }], here: ['Jovan Oda', 'Byakuya Kuchiki'] });
  for (const [page, stays] of [[BACK, true], [ACROSS, true], [OTHER, true], [GONE, false]]) {
    const st = office();
    const read = await withHouse({ fetch: streamed(leaveRukia) }, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I wait.', assistantText: page }));
    const after = applyMutations(st, read.mutations).state;
    eq(after.present.some((p) => p.name === 'Rukia Kuchiki'), stays, page.split('\n').pop().slice(0, 50) + ' → ' + (stays ? 'here' : 'gone'));
    eq(Boolean(after.offscreen['Rukia Kuchiki']), !stays, (stays ? 'no' : 'a') + ' "last seen" note');
    assert(after.present.some((p) => p.name === 'Byakuya Kuchiki'), 'Byakuya stays');
  }
});

test('M446-3 THE AUDITOR’S LEAVE, THE SAME LAW: the latest page that names her decides — back with the files, she stays; bowed and left, she goes', async () => {
  for (const [page, stays] of [[BACK, true], [GONE, false]]) {
    const s0 = await db.stories.create({ title: 'The office, audited' });
    await db.messages.append(s0.id, { role: 'user', text: 'I wait.' });
    await db.messages.append(s0.id, { role: 'assistant', text: page });
    await saveState(s0.id, office());
    const answer = JSON.stringify({ issues: [{ what: 'Rukia left the office', fix: 'take her out', pages: false, mutations: [{ type: 'presence.leave', name: 'Rukia Kuchiki' }] }] });
    await withHouse({ fetch: streamed(answer) }, () => auditLedger({ connection: HOUSES[0].conn, storyId: s0.id, brief: 'A Bleach story.' }));
    const after = await loadState(s0.id);
    eq(after.present.some((p) => p.name === 'Rukia Kuchiki'), stays, stays ? 'back with the files: she stays' : 'bowed and left: she goes');
  }
});

test('M446-4 WHEN THE PAGE MOVES THE GROUND, THE SCENE LEAVES PEOPLE BEHIND — Ms. June waving them off from the diner door is left at the Bluebird (the page reader’s leave stands, no word of her own going needed); whoever the page’s own room says came along stays', async () => {
  const bluebird = () => {
    const st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Bluebird' },
      ...['Jovan', 'Ms. June', 'Liara'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
    st.characters = { 'Ms. June': { core: 'runs the Bluebird' }, Liara: { core: 'his oldest friend' } };
    return st;
  };
  const HOME = '[The Wells house — Friday, March 14, 2025 | 20:40 | clear | gray hoodie | on the porch]\n\nMs. June waved them off from the diner door. Liara walked him home, and they sat on the porch steps.';
  const answer = (here) => JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Ms. June' }, { type: 'presence.leave', name: 'Liara' }, { type: 'mode.snapshot', flags: [] }], ...(here ? { here } : {}) });
  let st = bluebird();
  let read = await withHouse({ fetch: streamed(answer(['Jovan', 'Liara'])) }, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'We walk home.', assistantText: HOME }));
  let after = applyMutations(st, [{ type: 'place.set', name: 'The Wells house' }, ...read.mutations]).state;
  eq(after.present.map((p) => p.name).sort().join(), 'Jovan,Liara', 'Ms. June is left behind; Liara, who came along, stays');
  assert(after.offscreen['Ms. June'] && after.offscreen['Ms. June'].lastSeen, 'Ms. June is last seen where the page began');
  st = bluebird();
  read = await withHouse({ fetch: streamed(answer(null)) }, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'We walk home.', assistantText: HOME }));
  after = applyMutations(st, [{ type: 'place.set', name: 'The Wells house' }, ...read.mutations]).state;
  eq(after.present.map((p) => p.name).sort().join(), 'Jovan', 'with no room said, the page reader’s leaves stand on a move (M304 as it was)');
});

