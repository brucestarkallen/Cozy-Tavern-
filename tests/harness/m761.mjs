/* Cozy Tavern — harness laws of M761: an answer whose one value lost its closing quote is read, and a run whose answer could
 * not be used is not "went well". His (23 October 2026, 06:31): "Why it said this the world agent ran just now and it went
 * well — its answer could not be used. what it said {"mutations":[{"type":"offscreen.set","name":"Sheriff Odell Cray" …".
 * Each law runs the real readers and failed on m760-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { saveState, loadState, emptyState } from '../../js/engine/state.js';
import { parseWorldAnswer, worldTurn, worldRunState, worldRunWords } from '../../js/agents/world.js';
import { parseFirstObject } from '../../js/agents/jsonutil.js';
import { healthSnapshot } from '../../js/agents/health.js';

/* his world agent's answer as his drawer kept it (its first 2,000 characters, status.js RAW_CAP), and the world's word that
 * closes it (the drawer cut it there; these last words are the fixture's) */
const HIS = "{\"mutations\":[{\"type\":\"offscreen.set\",\"name\":\"Sheriff Odell Cray\",\"location\":\"Blackwood Manor, second-floor corridor, climbing toward the attic\",\"activity\":\"Following the sound of the door opening, heavy tread on the oilcloth\",\"agenda\":\"Intercept the agents in the attic and demand the room's contents be logged under county supervision\",\"stance\":\"toward\",\"etaMinutes\":1},{\"type\":\"offscreen.set\",\"name\":\"Dr. Hollis Rennick\",\"location\":\"Blackwood Manor ballroom, body table\",\"activity\":\"Picking up the first stretcher frame, checking the jaw shot on his own camera\",\"agenda\":\"Complete the first lift once Cray clears the room or gives the nod\",\"stance\":\"busy\",\"etaMinutes\":0},{\"type\":\"offscreen.set\",\"name\":\"Deputy Pruitt\",\"location\":\"Blackwood Manor cellar, crawlspace entrance\",\"activity\":\"Squeezing his headlamp through the gap Ashford found, checking for a draft that isn't airflow\",\"agenda\":\"Report back on whether the crawlspace is a highway or a dead end\",\"stance\":\"busy\",\"etaMinutes\":0},{\"type\":\"offscreen.set\",\"name\":\"Claire Ashford\",\"location\":\"Blackwood Manor cellar, crawlspace entrance\",\"activity\":\"Prying the loose panel back with her multi-tool, watching the dark inside\",\"agenda\":\"Determine if the killer used the subfloor to move between rooms\",\"stance\":\"busy\",\"etaMinutes\":0},{\"type\":\"offscreen.set\",\"name\":\"Ellis Grady\",\"location\":\"Press van, county road\",\"activity\":\"Refreshing the live blog feed: 'Sheriff investigating interior',\"agenda\":\"Get a name or a quote before midnight deadline\",\"stance\":\"busy\",\"etaMinutes\":0},{\"type\":\"offscreen.set\",\"name\":\"Deputy Vance\",\"location\":\"Blackwood Manor gate\",\"activity\":\"Listening to radio chatter about the Sheriff's movement up the drive, glancing at the van\",\"agenda\":\"Keep the gate secure; let Grady know if the Sheriff comes out angry\",\"stance\":\"busy\",\"etaMinutes\":0},{\"type\":\"offscreen.set\",\"name\":\"Anne Wessex\",\"location\":\"Home, sofa\",\"activity\":\"Asleep\",\"agenda\":\"\",\"stance\":\"waiting\",\"etaMinutes\":0}],\"brief\":{\"pressure\":[\"Sheriff";
const ANSWER = HIS + " Cray is on the stairs, a minute out\"],\"ripe\":[],\"twb\":null,\"voices\":[]}}";

test('M761-1 HIS WORLD AGENT’S ANSWER IS READ: one value lost its closing quote ("…investigating interior\',"agenda":…") and the whole answer — seven people placed and the world’s word — was thrown away; it is read now, Ellis Grady’s activity whole', async () => {
  eq(HIS.length, 2000, 'the drawer’s cut, as he pasted it');
  const read = parseWorldAnswer(ANSWER);
  eq(read.note, 'ok', 'read');
  eq(read.mutations.length, 7, 'seven people placed');
  const grady = read.mutations.find((m) => m.name === 'Ellis Grady');
  eq(grady.activity, "Refreshing the live blog feed: 'Sheriff investigating interior'", 'the value ends where its quote was lost');
  eq(grady.agenda, 'Get a name or a quote before midnight deadline', 'and the next one is its own');
  assert(read.brief && Array.isArray(read.brief.pressure), 'the world’s word too');
  /* every reader that asks for one object reads it the same way */
  const obj = parseFirstObject(ANSWER, (p) => Array.isArray(p.mutations));
  eq(obj && obj.mutations.length, 7, 'the shared reader');
  /* and through the world agent itself: the people are placed */
  const storyId = 'm761-world';
  await saveState(storyId, { ...emptyState(), sheet: { playerName: 'Jovan Wessex', actors: {} } });
  const before = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: ANSWER } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  let r;
  try { r = await worldTurn({ connection: { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'k', model: 'm', contextSize: 200000 }, storyId, userText: 'I open the door.', assistantText: 'Jovan turned the brass knob of the attic door.', stale: () => false }); } finally { globalThis.fetch = before; }
  eq(r.note, 'ok', 'the world agent used it');
  const st = await loadState(storyId);
  assert(st.offscreen && st.offscreen['Ellis Grady'] && /Press van/.test(st.offscreen['Ellis Grady'].location), 'Grady is in the press van: ' + JSON.stringify(st.offscreen && st.offscreen['Ellis Grady']));
});

test('M761-2 A RUN WHOSE ANSWER COULD NOT BE USED DID NOT GO WELL: the world agent’s is unfinished — the light says it stopped partway and sends the house’s own bounded recovery — and so is one cut short; a run that read its answer is not', () => {
  for (const note of ['unusable', 'cut short']) {
    const state = worldRunState({ note, applied: [] });
    eq(state.unfinished, true, note + ': unfinished');
  }
  eq(worldRunState({ note: 'ok', applied: [{ words: 'x' }] }).unfinished, false, 'a run that read its answer is finished');
  const shelf = { world: { ok: true, unfinished: true, at: 1, detail: worldRunWords({ note: 'unusable' }) } };
  const lamp = healthSnapshot({ shelf, state: { ...emptyState() }, pages: [{ id: 'p', role: 'assistant', text: 'x' }], story: {}, workerRecovery: { world: { input: 'k', eligible: true, reason: '' } } });
  const issue = lamp.issues.find((i) => i.id === 'worker:world');
  assert(issue && /world stopped partway; it will carry on by itself \(its answer could not be used\)/.test(issue.reason), 'the light: ' + JSON.stringify(issue));
  eq(issue.route, 'worker:world', 'and the house asks again');
});
