/* M356: THE SENSORS. After each page the house asks a few narrow questions about it and keeps the answers as numbers;
 * when one drifts below its floor the storyteller is told ONE short line on the next turn, in the writer's voice, and
 * then it is let go. Two wires: a decisions house (Jev) and any ordinary model, asked for JSON. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import {
  SENSORS, sensorShape, decisionsUrl, decisionsBody, chatAsk, readAnswers, sensorState,
  foldReadings, averages, dueWord, stillSpoken, readSensors, takeWordForTurn, loadSensors, sensorLine, SENSOR_WINDOW,
} from '../../js/agents/sensors.js';
import { buildRequest } from '../../js/assemble/stack.js';

test('M356-1 IT SPEAKS THE WIRE THE MODEL SPEAKS: a decisions house by its address or its model, anything else as JSON — and the questions are the same either way', () => {
  eq(sensorShape({ baseUrl: 'https://openrouter.ai/api', model: 'typesafe/jev-1.13' }), 'decisions', 'Jev, by its model');
  eq(sensorShape({ baseUrl: 'https://api.typesafe.ai/v1/systemone', model: 'anything' }), 'decisions', 'a decisions address');
  eq(sensorShape({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4' }), 'chat', 'an ordinary model');
  eq(decisionsUrl({ baseUrl: 'https://openrouter.ai/api' }), 'https://openrouter.ai/api/alpha/decisions', 'OpenRouter’s decisions endpoint');
  eq(decisionsUrl({ baseUrl: 'https://api.typesafe.ai' }), 'https://api.typesafe.ai/v1/systemone', 'TypeSafe’s own');
  eq(decisionsUrl({ baseUrl: 'https://openrouter.ai/api/alpha/decisions' }), 'https://openrouter.ai/api/alpha/decisions', 'an address already there is left alone');
  const state = sensorState({ brief: 'A tale of the courtyard.', pages: ['one', 'two', 'three', 'four'], newest: 'the newest page', mc: 'Jovan' });
  eq(state.player, 'Jovan', 'it says who he plays');
  eq(state.story_so_far.length, 3, 'three pages before the newest');
  eq(state.latest_page, 'the newest page', 'and the newest, whole');
  const body = decisionsBody({ model: 'typesafe/jev-1.13' }, state);
  eq(body.model, 'typesafe/jev-1.13');
  eq(Object.keys(body.questions).length, SENSORS.length, 'one question per sensor');
  eq(body.questions.tone.type, 'noul', 'asked as a probability');
  eq(body.questions.tone.instructions, SENSORS[0].ask, 'the same words the other wire uses');
  const ask = chatAsk(state);
  assert(/one raw JSON object/.test(ask.system) && /never write prose/.test(ask.system), 'the ordinary model is told to answer with numbers only');
  for (const s of SENSORS) assert(ask.user.includes(s.ask), 'and is asked ' + s.id);
});

test('M356-2 BOTH HOUSES’ ANSWERS ARE READ THE SAME WAY, and anything that is not a number is not a reading', () => {
  const jev = { answers: { tone: { type: 'noul', noul: 0.81 }, cost: { type: 'noul', noul: 0.2 } }, usage: { cost: 0.00003 } };
  eq(JSON.stringify(readAnswers(jev, 'decisions')), JSON.stringify({ tone: 0.81, cost: 0.2 }), 'Jev’s shape');
  eq(JSON.stringify(readAnswers('Sure! {"tone": 0.7, "world": 1.4, "mine": "x"}', 'chat')), JSON.stringify({ tone: 0.7, world: 1 }), 'a model’s JSON, clamped, the nonsense dropped');
  eq(JSON.stringify(readAnswers('no json here', 'chat')), '{}', 'and nothing at all when there is nothing to read');
});

test('M356-3 THE READINGS ARE THE LAST FEW, AND ONE LINE IS EARNED — the sensor furthest under its floor, never a list, never twice until it climbs back', () => {
  let kept = {};
  for (let i = 0; i < SENSOR_WINDOW + 3; i += 1) kept = foldReadings(kept, { tone: 0.9, cost: 0.1, tension: 0.9 });
  eq(kept.cost.length, SENSOR_WINDOW, 'only the last few are kept');
  eq(averages(kept).cost, 0.1, 'and the average is of those');
  const due = dueWord(kept, {});
  eq(due.id, 'cost', 'the one furthest under its floor');
  assert(/Nothing has cost him anything/.test(due.word), 'said as the writer would say it: ' + due.word);
  const spoken = { cost: true };
  eq(dueWord(kept, spoken), null, 'once said, it is quiet');
  eq(JSON.stringify(stillSpoken(kept, spoken)), JSON.stringify({ cost: true }), 'while it is still under');
  let better = kept;
  for (let i = 0; i < SENSOR_WINDOW; i += 1) better = foldReadings(better, { cost: 0.9 });
  eq(JSON.stringify(stillSpoken(better, spoken)), '{}', 'and can be earned again once it climbs back');
  const thin = foldReadings({}, { tension: 0.1 });
  eq(dueWord(thin, {}), null, 'one reading is not a drift');
});

test('M356-4 THE WHOLE READING, THROUGH THE STORE: the answers are kept with the story, the line is taken once and let go, and it rides in the closing words', async () => {
  const st = await db.stories.create({ title: 'the sensors' });
  const asked = [];
  const model = async ({ shape, body }) => { asked.push({ shape, body }); return { answers: { tone: { noul: 0.9 }, cost: { noul: 0.05 }, tension: { noul: 0.8 }, world: { noul: 0.9 }, mine: { noul: 0.9 } } }; };
  const read = async () => readSensors({ connection: { baseUrl: 'https://openrouter.ai/api', model: 'typesafe/jev-1.13' }, storyId: st.id, brief: 'A hard tale.', pages: ['a', 'b'], newest: 'The page that just landed.', mc: 'Jovan', callLLM: model });
  await read();
  const second = await read();
  eq(asked.length, 2, 'asked once per page');
  eq(asked[0].shape, 'decisions', 'on the wire its model speaks');
  eq(second.averages.cost, 0.05, 'the average is kept');
  eq(second.word, SENSORS.find((s) => s.id === 'cost').word, 'and the line is earned');
  const kept = await loadSensors(st.id);
  eq(kept.readings.cost.length, 2, 'kept with the story');
  assert(/cost to him \.05/.test(sensorLine(kept)), 'and readable in a line: ' + sensorLine(kept));
  const word = await takeWordForTurn(st.id);
  eq(word, second.word, 'taken for this turn');
  eq(await takeWordForTurn(st.id), '', 'and never twice');
  const r = buildRequest({ story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }], settings: { tellerName: 'Iron Man' }, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '', sensorNote: word });
  const closing = r.messages[r.messages.length - 1].content;
  assert(closing.startsWith('Iron Man — nothing has cost him anything'), 'in his voice, led by the teller’s name: ' + closing.slice(0, 80));
  assert((r.receipt.slots || []).some((s) => s.name === 'The sensors’ word'), 'and named on the receipt');
  const quiet = buildRequest({ story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }], settings: {}, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '' });
  assert(!/nothing has cost him/i.test(JSON.stringify(quiet.messages)) && !(quiet.receipt.slots || []).some((s) => s.name === 'The sensors’ word'), 'with nothing to say, nothing is said');
});

test('M356-5 IT NEVER BREAKS A TURN: no connection, no page, a house that says nothing — all of it comes back as no reading at all', async () => {
  eq(await readSensors({ connection: null, storyId: 'x', newest: 'page' }), null, 'no connection');
  eq(await readSensors({ connection: { baseUrl: 'https://x', model: 'jev' }, storyId: 'x', newest: '' }), null, 'no page');
  eq(await readSensors({ connection: { baseUrl: 'https://x', model: 'jev' }, storyId: 'x', newest: 'page', callLLM: async () => { throw new Error('down'); } }), null, 'a house that is down');
  eq(await readSensors({ connection: { baseUrl: 'https://x', model: 'jev' }, storyId: 'x', newest: 'page', callLLM: async () => ({ answers: {} }) }), null, 'a house that answers nothing');
});
