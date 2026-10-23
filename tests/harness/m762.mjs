/* Cozy Tavern — harness law of M762: the continuous audit's reading may look before it alleges. His (23 October 2026,
 * 07:59): "the continuous audit ran just now finished reviewing all folded pages… Original evidence supports the record.
 * The mistaken finding was withdrawn… why would an audit keep mistaken and mistaken and mistaken while the housekeeper could
 * find on its own audit perfectly" — and (08:01) "The continuous Audit is kinda supposed like housekeeper audit". The
 * housekeeper fetches the pages it does not hold whole; the stretch reading could not, so every doubt about something told
 * on an earlier page became an allegation for a second call to settle. Runs the real reading with the provider scripted at
 * the wire; fails on m761-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { auditStretch } from '../../js/agents/continuous.js';
import { loadMemory, saveMemory } from '../../js/agents/memory.js';

const CONN = { id: 'm762', type: 'openai', baseUrl: 'https://m762.fixture/v1', model: 'fixture', apiKey: 'fixture', contextSize: 200000, maxTokens: 32000, reasoning: { effort: 'off' } };
const sse = (text) => new Response([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
  .map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const EARLY = 'Edie Dale — Mrs. Dale to the whole lane — posted her first correction before the kettle had boiled.';
const LATER = 'The postman’s wife read Edie’s second correction post aloud from her porch: “Edie says the swan was never inflatable.”';

test('M762-1 THE CONTINUOUS AUDIT LOOKS BEFORE IT ALLEGES: the record line over pages 4-6 calls the poster "Mrs. Dale", the pages only say "Edie" — the reading fetches page 3 ("Edie Dale — Mrs. Dale to the whole lane"), finds the line right, and leaves no historical correction for a second call to withdraw', async () => {
  const s = await db.stories.create({ title: 'm762 Ravenwood' });
  const texts = ['I walk the lane. (1)', 'Ravenwood went on with its Friday. (2)', EARLY, 'I listen. (4)', LATER, 'I go on. (6)'];
  for (let i = 0; i < 6; i += 1) await db.messages.append(s.id, { role: i === 2 || i === 4 ? 'assistant' : i % 2 ? 'assistant' : 'user', text: texts[i], ts: 1000 + i });
  await saveMemory(s.id, { window: 12, nodes: [
    { id: 'early', span: [0, 2], level: 1, text: 'Jovan walked the lane; Edie Dale, Mrs. Dale to everyone, posted her first correction.', whole: true, audited: 3, correctionReviewed: true },
    { id: 'post', span: [3, 5], level: 1, text: 'The postman’s wife read Mrs. Dale’s second correction post aloud: the swan was never inflatable.', whole: true },
  ] });
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init = {}) => {
    const messages = JSON.parse(init.body || '{}').messages || [];
    asked.push(messages);
    const all = messages.map((m) => String(m.content || '')).join('\n');
    /* a reader that cannot tell "Edie" is Mrs. Dale from pages 4-6 looks at page 3; once it has read it, the line is right */
    return sse(all.includes('Mrs. Dale to the whole lane') && messages.length > 2 ? '{"issues":[]}' : '<fetch>["3"]</fetch>');
  };
  let r;
  try { r = await auditStretch({ connection: CONN, storyId: s.id, brief: '', stale: () => false, renew: () => true }); } finally { globalThis.fetch = was; }
  assert(r && r.ok, 'the stretch was read: ' + JSON.stringify(r).slice(0, 200));
  eq(asked.length, 2, 'it looked once, then answered');
  assert(asked[1].some((m) => m.role === 'user' && String(m.content).includes('Mrs. Dale to the whole lane')), 'page 3 was served to it');
  const line = (await loadMemory(s.id)).nodes.find((n) => n.id === 'post');
  eq(line.audited, 3, 'its pages are read');
  eq((line.auditOpen || []).length, 0, 'no historical correction left for a second call to withdraw');
  eq(line.text, 'The postman’s wife read Mrs. Dale’s second correction post aloud: the swan was never inflatable.', 'the line stands as written');
});
