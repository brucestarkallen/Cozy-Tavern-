/* Cozy Tavern — harness law of M591: the header gate never loses the page's last line ("I just said hi — the provider ended
 * its answer after the thinking with no page in it… Nothing was cut by the house"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { makeHeaderGate } from '../../js/ui/headergate.js';

function run(text, step) {
  let page = ''; let lead = '';
  const g = makeHeaderGate({ onThinking: (x) => { lead += x; }, onProse: (x) => { page += x; }, onGiveBack: (x) => { lead = lead.slice(0, lead.length - x.length); } });
  for (let i = 0; i < text.length; i += step) g.feed(text.slice(i, i + step));
  g.end();
  return { page, lead };
}

test('M591 THE LAST LINE IS ALWAYS HANDED ON: a reply whose planning was only judged at its end, then a short line with no break after it ("Hey there!"), keeps that line as the page — in any size of pieces; a reply with no header and no planning is the page whole', () => {
  for (const step of [1, 3, 7, 50, 1000]) {
    const a = run('Planning: greet him.\nBeat: a warm hello.\n\nHey there!', step);
    eq(a.page, 'Hey there!', 'the short last line is the page (pieces of ' + step + ')');
    assert(/Planning: greet him/.test(a.lead), 'the plan in the thinking');
    eq(run('Hi! How are you?', step).page, 'Hi! How are you?', 'no header, no plan: the page whole');
    eq(run('Plan: open warm.\n\n[The gate — Monday | 09:00]\n\nHey.', step).page, '[The gate — Monday | 09:00]\n\nHey.', 'a header after the plan: the page from the header, its last short line kept');
  }
});

test('M593 A VOICE PRESET KEPT UNDER AN ID THAT IS GONE, WITH NO NAME, IS NOTHING TO SAVE — never a throw', async () => {
  const { savePreset } = await import('../../js/engine/voicepresets.js');
  eq(await savePreset('', { tellerName: 'Hulk' }, { id: 'vp-gone' }), null);
  const kept = await savePreset('Hulk night', { tellerName: 'Hulk' });
  assert(kept && kept.name === 'Hulk night', 'a named one is kept');
});

test('M595 THE RECORD NAMES THE MAIN CHARACTER IN EVERY PATH: "Fold again" on a line writes him by the ledger\'s name — never "the player" (it read a setting nothing writes)', async () => {
  const { saveMemory, loadMemory, redoLine } = await import('../../js/agents/memory.js');
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { db } = await import('../../js/store.js');
  const st = await db.stories.create({ title: 'fold again' });
  await db.messages.append(st.id, { role: 'user', text: 'I open the gate.' });
  await db.messages.append(st.id, { role: 'assistant', text: '[The gate — Monday | 09:00]\n\nYou push the gate open.' });
  await saveState(st.id, applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan Oda' }]).state);
  await saveMemory(st.id, { window: 30, nodes: [{ id: 'n1', span: [0, 1], text: 'old line', level: 1, at: 1 }] });
  const asked = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const b = JSON.parse(opts.body); asked.push(JSON.stringify(b.messages || b)); const enc = new TextEncoder(); const t = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Jovan Oda pushes the gate open.' } }] }) + '\n\ndata: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new ReadableStream({ start(c) { c.enqueue(enc.encode(t)); c.close(); } }), clone() { return this; }, json: async () => ({ choices: [{ message: { content: 'Jovan Oda pushes the gate open.' } }] }) }; };
  try {
    await redoLine({ connection: { type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'm' }, storyId: st.id, nodeId: 'n1' });
  } finally { globalThis.fetch = prior; }
  assert(asked.length && /<player_name>Jovan Oda<\/player_name>/.test(asked[0]), 'the keeper is told the main character by name: ' + (asked[0] || '').slice(0, 160));
  assert(!asked.some((a) => /<player_name>the player<\/player_name>/.test(a)), 'never "the player"');
});
