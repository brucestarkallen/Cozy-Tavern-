/* M402: silence is not leaving — the page reader takes someone out only when the page or his message names them; and
 * someone put where the scene is walks into it. His Kyōraku, quiet at the rail of the courtyard the duel was in, is
 * never "elsewhere — last seen at" that very courtyard. Runs the real page reader on a scripted model and the real ledger. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { leavesTheyWereShown, extractTurn } from '../../js/agents/extractor.js';
import { applyMutations, undoEntry } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';

const PAGE = '[10th Division HQ — training courtyard]\n\nJovan squares up to Zaraki; the courtyard goes very still.';
const scene = () => applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: '10th Division HQ — training courtyard' },
  ...['Jovan Oda', 'Kenpachi Zaraki', 'Shunsui Kyōraku'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
const streamed = (answer) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
  const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
  return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
};

test('M402-1 SILENCE IS NOT LEAVING: a page that never names Kyōraku cannot take him out of the scene; a page that shows him go can', () => {
  const leave = [{ type: 'presence.leave', name: 'Shunsui Kyōraku' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }];
  eq(leavesTheyWereShown(leave, PAGE).map((m) => m.type).join(), 'presence.enter', 'not named: he stays');
  eq(leavesTheyWereShown(leave, 'Kyoraku tips his hat and is gone in a flicker of shunpo.').length, 2, 'named leaving (letters folded): he goes');
});

test('M402-2 THE PAGE READER, RUN WHOLE: its leave for the quiet Kyōraku is let go before it lands', async () => {
  const answer = JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Shunsui Kyōraku' }, { type: 'presence.update', name: 'Kenpachi Zaraki', position: 'center of the yard' }] });
  const read = await withHouse({ fetch: streamed(answer) }, () => extractTurn({ connection: HOUSES[0].conn, state: scene(), userText: 'I step into the yard.', assistantText: PAGE }));
  assert(read && Array.isArray(read.mutations), 'it read');
  assert(!read.mutations.some((m) => m.type === 'presence.leave'), 'the leave is let go: ' + JSON.stringify(read.mutations));
  assert(read.mutations.some((m) => m.type === 'presence.update'), 'the rest of what it read stands');
});

test('M402-3 SOMEONE PUT WHERE THE SCENE IS WALKS INTO IT — the stuck "last seen at the scene’s own ground" heals, and can be taken back', () => {
  let st = applyMutations(scene(), [{ type: 'presence.leave', name: 'Shunsui Kyōraku' }]).state;
  assert(st.offscreen['Shunsui Kyōraku'] && st.offscreen['Shunsui Kyōraku'].lastSeen, 'the stuck state: last seen at the courtyard');
  const r = applyMutations(st, [{ type: 'offscreen.set', name: 'Shunsui Kyōraku', location: '10th Division HQ — training courtyard', activity: 'watching from the rail', stance: 'busy' }]);
  st = r.state;
  assert(st.present.some((p) => p.name === 'Shunsui Kyōraku'), 'he is in the scene');
  assert(!st.offscreen['Shunsui Kyōraku'], 'and nowhere else');
  const back = undoEntry(st, st.log.length - 1);
  assert(back && !back.state.present.some((p) => p.name === 'Shunsui Kyōraku'), 'taken back like any change');
});
