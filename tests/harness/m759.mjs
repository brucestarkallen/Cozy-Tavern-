/* Cozy Tavern — harness laws of M759: the world agent's voices and who is speaking in them. His (22 October 2026, 23:40):
 * "Is this normal the world agent sometimes yellow but then become green once auditor finish? the world agent ran just now
 * and stopped partway — speaker identities await source reconciliation: Deputy Vance: Supply the speaker identity scope and
 * reason, retaining the original voice.; Dr. Hollis Rennick: …". Each law runs the real world agent, its words and the
 * light, and failed on m758-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { worldTurn, worldRunWords, worldRunState } from '../../js/agents/world.js';
import { healthSnapshot } from '../../js/agents/health.js';

const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000 };
const stream = (reply) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(reply) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
const VOICES = [
  { icon: '📻', speaker: 'Deputy Vance', channel: 'the cellar radio', content: 'Hatch is clear, Sheriff.' },
  { icon: '💬', speaker: 'Dr. Hollis Rennick', channel: 'the ballroom', content: 'Photographs first. Then the bodies.' },
];
async function run(answer) {
  const story = await db.stories.create({ title: 'Blackwood Manor ' + Math.random() });
  const page = await db.messages.append(story.id, { role: 'assistant', text: 'Vanessa waited at the foot of the stairs while the rain worked at the windows.' });
  await saveState(story.id, { ...emptyState(), sheet: { playerName: 'Jovan', actors: {} } });
  const sent = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (_, options) => { const body = JSON.parse(options.body); sent.push(body); return stream(answer(sent.length)); };
  try { return { result: await worldTurn({ connection: CONN, storyId: story.id, assistantText: page.text, story, pageAt: 0 }), sent, page }; } finally { globalThis.fetch = before; }
}

test('M759-1 THE VOICE SHAPE THE WORLD AGENT IS GIVEN CARRIES WHO IS SPEAKING: the shape its model copies for each voice lists identity beside icon, speaker, channel and content, and the rule for it stands inside the voices it governs — it was a line of its own before the voices were described, and the shape listed four fields without it', async () => {
  const { sent } = await run(() => ({ mutations: [], brief: { pressure: [], ripe: [], twb: null, voices: VOICES.map((v) => ({ ...v, identity: { scope: 'local', why: 'a speaker of this scene only' } })) } }));
  const system = String((sent[0].messages.find((m) => m.role === 'system') || {}).content || '');
  assert(system.includes('Each: {"icon","speaker","channel","content","identity"}'), 'the per-voice shape names identity');
  const voicesAt = system.indexOf('voices — THE WORLD TALKING TO ITSELF');
  const ruleAt = system.indexOf('Every voice includes identity:');
  assert(voicesAt !== -1 && ruleAt > voicesAt, 'the identity rule sits inside the voices section (' + voicesAt + ', ' + ruleAt + ')');
  eq(sent.length, 1, 'an answer that names its speakers is asked once');
});

test('M759-2 HIS LINE SAYS WHAT WAITS AND ON WHOM: two voices whose speakers the world agent never named, even when asked again — the run waits for the auditor, its line names the speakers in plain words and never hands him the model’s instruction; the light says the same', async () => {
  const { result, sent, page } = await run(() => ({ mutations: [], brief: { pressure: [], ripe: [], twb: null, voices: VOICES } }));
  eq(sent.length, 2, 'asked once more in the same answer, as before');
  eq(result.identityPending.map((p) => p.speaker).join(', '), 'Deputy Vance, Dr. Hollis Rennick', 'both still unnamed');
  const words = worldRunWords(result);
  assert(/the auditor will say who is speaking in 2 voices \(it reads them from the page\): Deputy Vance, Dr\. Hollis Rennick/.test(words), words);
  assert(!/Supply the speaker identity|source reconciliation/.test(words), 'no model instruction on his line: ' + words);
  const state = worldRunState(result);
  eq(state.unfinished, true, 'owed while the auditor is on');
  eq(state.resume, 'voice-identities', 'and routed to it');
  const shelf = { world: { ok: true, unfinished: true, at: 1, detail: words, resume: 'voice-identities:' + page.id } };
  const lamp = healthSnapshot({ shelf, state: { ...emptyState() }, pages: [{ ...page, role: 'assistant' }], story: {}, repairOwed: true });
  const issue = lamp.issues.find((i) => i.id === 'worker:world');
  assert(issue && /world is waiting for the auditor to say who is speaking in its voices/.test(issue.reason) && !/stopped partway/.test(issue.reason), 'the light: ' + JSON.stringify(issue));
  eq(issue.route, 'auditor', 'sent to the auditor');
});

test('M759-3 WITH THE AUDITOR SWITCHED OFF NOBODY WILL SETTLE IT, SO IT HOLDS NOTHING YELLOW: the run is finished, and its line says the speakers stay unnamed and why', async () => {
  const { result } = await run(() => ({ mutations: [], brief: { pressure: [], ripe: [], twb: null, voices: VOICES } }));
  const state = worldRunState(result, { auditor: false });
  eq(state.unfinished, false, 'nothing owed to a reader that will never run');
  eq(state.resume, '', 'nothing to resume');
  assert(/nobody will say who is speaking in 2 voices — the auditor is switched off: Deputy Vance, Dr\. Hollis Rennick/.test(worldRunWords(result, { auditor: false })), worldRunWords(result, { auditor: false }));
  /* other unfinished world work stays owed whatever the auditor's switch */
  eq(worldRunState({ ...result, pending: ['Sheriff Odell Cray'] }, { auditor: false }).unfinished, true, 'a person the world still owes a decision is still owed');
});
