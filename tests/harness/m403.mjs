/* M403: the auditor never moves the ground on its own reading, and never takes someone out of the scene the latest
 * page never shows leaving — his whole Gotei 13 went "elsewhere, last seen at the courtyard" from one audit. Runs the
 * real auditor on a scripted model and the real ledger. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const streamed = (answer) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
  const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
  return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
};

test('M403-1 ONE AUDIT CANNOT EMPTY HIS SCENE: its move of the ground (the header silent) is let go; its leaves for people the page never shows leaving are let go; a leave the page shows still lands', async () => {
  const st0 = await db.stories.create({ title: 'The courtyard' });
  await db.messages.append(st0.id, { role: 'user', text: 'I step onto the sand.' });
  await db.messages.append(st0.id, { role: 'assistant', text: 'Zaraki grins across the sand. Across the yard, Lisa shuts her book and walks out through the east gate.' });
  let st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: '10th Division HQ — training courtyard' },
    ...['Jovan Oda', 'Kenpachi Zaraki', 'Byakuya Kuchiki', 'Renji Abarai', 'Iba Tetsuzaemon', 'Lisa Yadōmaru'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
  await saveState(st0.id, st);
  const answer = JSON.stringify({ issues: [
    { what: 'the scene is at the assembly', fix: 'move it', pages: false, mutations: [{ type: 'place.set', name: '1st Division HQ — outside the assembly hall' }] },
    { what: 'the captains are inside the hall', fix: 'take them out', pages: false, mutations: [{ type: 'presence.leave', name: 'Byakuya Kuchiki' }, { type: 'presence.leave', name: 'Renji Abarai' }, { type: 'presence.leave', name: 'Iba Tetsuzaemon' }] },
    { what: 'Lisa left', fix: 'she walked out', pages: false, mutations: [{ type: 'presence.leave', name: 'Lisa Yadōmaru' }] },
  ] });
  await withHouse({ fetch: streamed(answer) }, () => auditLedger({ connection: HOUSES[0].conn, storyId: st0.id, brief: 'A Bleach story.' }));
  st = await loadState(st0.id);
  eq(st.place.name, '10th Division HQ — training courtyard', 'the ground stays where the page has it');
  const here = st.present.map((p) => p.name);
  for (const n of ['Byakuya Kuchiki', 'Renji Abarai', 'Iba Tetsuzaemon']) assert(here.includes(n), n + ' is still here');
  assert(!here.includes('Lisa Yadōmaru'), 'Lisa, shown walking out, is gone');
  eq(Object.keys(st.offscreen || {}).filter((k) => /Byakuya|Renji|Iba/.test(k)).length, 0, 'nobody else "elsewhere"');
});
