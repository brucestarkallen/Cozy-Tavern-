/* M356, rebuilt at M636: THE SENSORS — the craft's own laws, measured. After each page a checker answers a short list of
 * statements about it (numbers only), the house counts what can be counted, and when the same slip shows on several of
 * the pages that stand, the storyteller is told ONE fixed line on the next turn. Every test here runs the feature. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { thinkingHouse, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import {
  SENSORS, MODEL_SENSORS, sensorById, sensorShape, decisionsUrl, decisionsBody, decisionsState, decisionsRoom, chatAsk, readAnswers,
  packageFromRequest, packageFromPages, fitPackage, readPage, senseOf, sensePatch, dueSensor, sensorWordForTurn, loadSensors,
  sensorLine, openingKind, closingKind, impactCount, nameRun, longSpeeches, thoughtCount, constructsOf, TAIL, TAIL_OWN, SENSOR_GAP,
  readPageFull, readingWords, slipNames, SAMPLE_READ, sensorRoleFor, LEAST_ROOM,
} from '../../js/agents/sensors.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { PRESETS, normalizeBaseUrl } from '../../js/providers/index.js';
import { callWorker } from '../../js/agents/call.js';
import { TWIN_REFUSAL, hasTwins, foldTwins } from '../../js/providers/userfirst.js';
import { lintPage, spokenShare } from '../../js/agents/lint.js';

const HEAD = '[The courtyard — Monday, March 3, 2025 | 09:00 | clear | coat | by the gate]';
/* prose that never says the same thing twice: every page's words are its own (a fixture that repeats itself is, rightly, caught) */
const filler = (seed, n = 1100) => {
  let x = (seed * 2654435761) >>> 0;
  const r = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x >>> 8; };
  const syl = () => 'bdfgklmnprstvz'[r() % 14] + 'aeiou'[r() % 5];
  const word = () => syl() + syl() + (r() % 2 ? syl() : '');
  let out = '';
  while (out.length < n) { const len = 7 + (r() % 6); const w = Array.from({ length: len }, word); out += w[0][0].toUpperCase() + w[0].slice(1) + ' ' + w.slice(1).join(' ') + '. '; }
  return out.trim();
};
const page = (open, seed, close = '') => HEAD + '\n\n' + open + ' ' + filler(seed) + (close ? '\n\n' + close : '');
const fine = Object.fromEntries(MODEL_SENSORS.map((s) => [s.id, 0.05])); /* every statement names a slip: low is no slip */
const reads = (list) => list.map((scores, i) => ({ text: page(['The gate stood.', 'Kaelen laughed.', '“So,” she said.', 'It rained.'][i % 4], i + 1), scores }));
const base = { story: { brief: '' }, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '' };

test('M636-1 EVERY ADDRESS THE HOUSE KEEPS REACHES ITS DECISIONS HOUSE — OpenRouter as the app stores it, TypeSafe, Neuralwatt, Cloudflare; Clef is known like Jev', () => {
  const openrouter = PRESETS.find((p) => p.id === 'openrouter').baseUrl;
  for (const kept of [openrouter, normalizeBaseUrl('https://openrouter.ai/api'), normalizeBaseUrl('https://openrouter.ai/api/alpha/decisions'), 'https://openrouter.ai/api/alpha/decisions', 'https://openrouter.ai']) {
    eq(decisionsUrl({ baseUrl: kept, model: 'typesafe/jev-1.13' }), 'https://openrouter.ai/api/alpha/decisions', 'OpenRouter, kept as ' + kept);
  }
  eq(decisionsUrl({ baseUrl: 'https://api.typesafe.ai' }), 'https://api.typesafe.ai/v1/systemone', 'TypeSafe, bare');
  eq(decisionsUrl({ baseUrl: 'https://api.typesafe.ai/v1' }), 'https://api.typesafe.ai/v1/systemone', 'TypeSafe, with its version');
  eq(decisionsUrl({ baseUrl: normalizeBaseUrl('https://api.neuralwatt.com/v1') }), 'https://api.neuralwatt.com/v1/systemone', 'Neuralwatt');
  eq(decisionsUrl({ baseUrl: 'https://api.neuralwatt.com/v1/systemone' }), 'https://api.neuralwatt.com/v1/systemone', 'an address already there is left alone');
  const cf = 'https://api.cloudflare.com/client/v4/accounts/abc/ai/run/@cf/cloudflare/clef-flash';
  eq(decisionsUrl({ baseUrl: cf }), cf, 'Cloudflare’s own run address, whole');
  eq(decisionsUrl({ baseUrl: 'https://nano-gpt.com/api/v1' }), 'https://nano-gpt.com/api/v1/decisions', 'NanoGPT');
  eq(sensorShape({ baseUrl: openrouter, model: 'typesafe/jev-1.13' }), 'decisions', 'Jev, by its model');
  eq(sensorShape({ baseUrl: openrouter, model: 'cloudflare/clef-flash' }), 'decisions', 'Clef on OpenRouter, by its model');
  eq(sensorShape({ baseUrl: 'https://api.neuralwatt.com/v1', model: 'clef-flash' }), 'decisions', 'Clef on Neuralwatt, by its model');
  eq(sensorShape({ baseUrl: cf, model: '@cf/cloudflare/clef-flash' }), 'decisions', 'Clef on Cloudflare, by its address');
  eq(sensorShape({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' }), 'chat', 'an ordinary model');
  eq(sensorShape({ baseUrl: 'https://x.example/v1', model: 'clefairy-13b' }), 'chat', 'a name that merely begins like one is an ordinary model');
  eq(decisionsBody({ baseUrl: cf, model: '@cf/cloudflare/clef-flash' }, {}).model, 'clef-flash', 'Cloudflare is told the model by its short name');
  eq(decisionsRoom({ baseUrl: openrouter, model: 'typesafe/jev-1.13' }), 32000, 'Jev’s room');
  eq(decisionsRoom({ baseUrl: 'https://api.neuralwatt.com/v1', model: 'clef-flash' }), 262144, 'Clef’s room on Neuralwatt');
  eq(decisionsRoom({ baseUrl: openrouter, model: 'typesafe/jev-1.13', contextSize: 9000 }), 9000, 'his own number wins');
  const jev = { answers: { mine: { type: 'noul', noul: 0.81 }, knows: { noul: 0.2 } }, usage: { cost: 0.00003 } };
  eq(JSON.stringify(readAnswers(jev, 'decisions')), JSON.stringify({ mine: 0.81, knows: 0.2 }), 'Jev’s shape');
  eq(JSON.stringify(readAnswers({ result: jev, success: true }, 'decisions')), JSON.stringify({ mine: 0.81, knows: 0.2 }), 'Cloudflare’s wrapped answer');
  eq(JSON.stringify(readAnswers('Sure! {"mine": 0.7, "world": 1.4, "tone": "x", "swap": null, "held": true}', 'chat')), JSON.stringify({ mine: 0.7, world: 1 }), 'a model’s JSON, clamped; what is not a number is not a reading');
  eq(JSON.stringify(readAnswers('no json here', 'chat')), '{}', 'and nothing at all when there is nothing to read');
});

test('M636-2 THE CHECKER IS HANDED WHAT THE STORYTELLER WAS HANDED — the request the page was written from, then the page; cut only to the room the reader has, the page never first to go', async () => {
  const r = buildRequest({ ...base, story: { brief: 'BRIEF-MARK a hard tale of the Tenth.' }, settings: { tellerName: 'Iron Man' }, ruling: 'RULING-MARK the blow lands.',
    messages: [{ id: 'u0', role: 'user', text: 'We begin.' }, { id: 'a0', role: 'assistant', text: HEAD + '\n\nOLD-PAGE-MARK Kaelen waited by the gate.' }, { id: 'u1', role: 'user', text: 'MOVE-MARK I ask him what it will cost.' }] });
  const body = { model: 'm', messages: [{ role: 'system', content: r.systemBlocks.map((b) => b.text).join('\n\n') }, ...r.messages, { role: 'assistant', content: 'PREFILL-MARK' }] };
  const asked = [];
  const answer = async (a) => { asked.push(a); return JSON.stringify(fine); };
  const read = await readPage({ connection: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro', preset: 'deepseek' }, kept: body, page: HEAD + '\n\nNEW-PAGE-MARK He named a price.', mc: 'Jovan', callLLM: answer });
  eq(read.whole, true, 'read from the kept request');
  eq(Object.keys(read.scores).length, MODEL_SENSORS.length, 'one number per statement');
  const ask = asked[0].body;
  eq(asked[0].shape, 'chat', 'an ordinary model is asked for JSON');
  for (const mark of ['BRIEF-MARK', 'OLD-PAGE-MARK', 'MOVE-MARK', 'RULING-MARK', 'NEW-PAGE-MARK']) assert(ask.user.includes(mark), 'the checker reads ' + mark);
  assert(!ask.user.includes('PREFILL-MARK'), 'a started reply is not a turn of the story');
  assert(ask.user.indexOf('NEW-PAGE-MARK') > ask.user.indexOf('</what the storyteller was given>'), 'and the page stands apart, after what the storyteller was given');
  for (const s of MODEL_SENSORS) assert(ask.user.includes(s.ask), 'asked: ' + s.id);
  assert(/You judge a page of a story/.test(ask.system) && /never continue the story/.test(ask.system) && /0\.5/.test(ask.system), 'told to judge, never to write, and to say 0.5 when it cannot tell');
  /* Anthropic's shape reads the same */
  const claude = packageFromRequest({ system: [{ type: 'text', text: 'SYS-A' }, { type: 'text', text: 'SYS-B' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'I wait.' }] }] });
  eq(claude.instructions, 'SYS-A\n\nSYS-B', 'Anthropic’s system blocks');
  eq(claude.turns[0].who + ':' + claude.turns[0].text, 'writer:I wait.', 'and its turns');
  eq(packageFromRequest({ messages: [{ role: 'system', content: 's' }] }), null, 'a request with no turn of his is no package');
  /* no kept request: the brief and the pages themselves */
  asked.length = 0;
  const thin = await readPage({ connection: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' }, kept: null, brief: 'BRIEF-TWO', before: [{ who: 'teller', text: 'BEFORE-PAGE' }, { who: 'writer', text: 'HIS-MOVE' }], page: 'THE-PAGE', callLLM: answer });
  eq(thin.whole, false, 'said to be read from the pages');
  for (const mark of ['BRIEF-TWO', 'BEFORE-PAGE', 'HIS-MOVE', 'THE-PAGE']) assert(asked[0].body.user.includes(mark), 'the fallback carries ' + mark);
  /* a small room: the oldest turns go first, then the head of the instructions; the page and his move stay whole */
  const turns = Array.from({ length: 40 }, (_, i) => ({ who: i % 2 ? 'teller' : 'writer', text: 'TURN-' + i + ' ' + 'x'.repeat(3000) }));
  const fit = fitPackage({ instructions: 'HEAD-OF-INSTRUCTIONS ' + 'i'.repeat(60000) + ' TAIL-NOTES', turns }, 'THE-WHOLE-PAGE ' + 'p'.repeat(5000), 20000);
  assert(fit.dropped > 0 && !fit.turns.some((t) => t.text.startsWith('TURN-0 ')), 'the oldest turns are left out, and it says how many: ' + fit.dropped);
  assert(fit.turns[fit.turns.length - 1].text.startsWith('TURN-39 '), 'the newest turn stays');
  assert(fit.page.startsWith('THE-WHOLE-PAGE') && fit.page.length === 15 + 5000, 'the page is whole');
  assert(!fit.instructions.includes('HEAD-OF-INSTRUCTIONS') && fit.instructions.endsWith('TAIL-NOTES'), 'of the instructions, the end (the brief and the notes) is what is kept');
  const big = fitPackage({ instructions: 'I', turns }, 'P', 1000000);
  eq(big.dropped, 0, 'a reader with room is handed all of it');
  /* a decisions house: the same package as a state, THE PAGE FIRST — a house that reads less than it says loses the oldest of the story, never the page */
  asked.length = 0;
  await readPage({ connection: { baseUrl: 'https://openrouter.ai/api/v1', model: 'typesafe/jev-1.13' }, kept: body, page: 'NEW-PAGE-MARK', mc: 'Jovan', callLLM: async (a) => { asked.push(a); return { answers: { mine: { noul: 0.9 } } }; } });
  eq(asked[0].shape, 'decisions', 'Jev is asked on its own wire');
  const keys = Object.keys(asked[0].body.state);
  eq(keys[0], 'page_to_judge', 'the page first');
  eq(asked[0].body.state.page_to_judge, 'NEW-PAGE-MARK', 'and whole');
  assert(/MOVE-MARK/.test(asked[0].body.state.the_writers_move_it_answers), 'his move beside it');
  assert(JSON.stringify(asked[0].body.state).indexOf('NEW-PAGE-MARK') < JSON.stringify(asked[0].body.state).indexOf('OLD-PAGE-MARK'), 'the older story after it');
  eq(Object.keys(asked[0].body.questions).length, MODEL_SENSORS.length, 'the same statements either way');
  eq(asked[0].body.questions.knows.instructions, sensorById('knows').ask, 'in the same words');
  /* it never breaks a turn */
  eq(await readPage({ connection: null, page: 'page' }), null, 'no connection');
  eq(await readPage({ connection: { baseUrl: 'https://x', model: 'jev' }, page: '' }), null, 'no page');
  eq(await readPage({ connection: { baseUrl: 'https://x', model: 'jev' }, page: 'page', callLLM: async () => { throw new Error('down'); } }), null, 'a house that is down');
  eq(await readPage({ connection: { baseUrl: 'https://x', model: 'jev' }, page: 'page', callLLM: async () => ({ answers: {} }) }), null, 'a house that answers nothing');
});

test('M636-3 A READING LIVES ON THE PAGE IT READ: under the version read, for the words read — another version, or the page edited, has none', () => {
  const text = 'The page as it was read.';
  const pageRow = { id: 'a1', ...sensePatch({ id: 'a1' }, 0, text, { mine: 0.9 }) };
  eq(JSON.stringify(senseOf(pageRow, 0, text)), JSON.stringify({ mine: 0.9 }), 'the version read');
  eq(senseOf(pageRow, 1, text), null, 'a new version (Try again) has no reading yet');
  eq(senseOf(pageRow, 0, text + ' Edited.'), null, 'the page edited: the reading is not of these words');
  const two = { id: 'a1', ...sensePatch(pageRow, 1, 'Another take.', { mine: 0.2 }) };
  eq(senseOf(two, 0, text).mine, 0.9, 'the first version keeps its own');
  eq(senseOf(two, 1, 'Another take.').mine, 0.2, 'and the second its own');
  eq(senseOf({ id: 'x' }, 0, text), null, 'a page never read');
  const older = sensePatch({ id: 'a2' }, 0, text, { mine: 0.95 }); delete older.sense[0].v;
  eq(senseOf(older, 0, text), null, 'a reading made when a high number meant “his character was left to him” is not a reading of these laws');
});

test('M636-4 WHICH LAW IS DUE: one page earns nothing, several pages earn ONE fixed line; calm pages earn none; the absolute laws first, then the one said longest ago; after any line two turns of quiet; it rests, repeats on Try again, and stops when nothing changes', async () => {
  eq(sensorById('cost'), null, 'no sensor asks for a cost');
  eq(sensorById('tension'), null, 'and none asks for something at stake');
  const calm = reads([fine, fine, fine, fine, fine, fine]);
  eq(dueSensor({ pages: calm }).due, null, 'a calm stretch where every law holds earns no word');
  const bad = { ...fine, accord: 0.9 };
  eq(dueSensor({ pages: reads([fine, fine, fine, fine, fine, bad]) }).due, null, 'one slipping page is not a drift');
  eq(dueSensor({ pages: reads([fine, fine, fine, fine, bad, bad]) }).due, null, 'nor two, of a law that needs three');
  const three = reads([fine, bad, fine, bad, fine, bad]);
  const due = dueSensor({ pages: three }).due;
  eq(due.id, 'accord', 'three of the last five: the law is due');
  assert(due.word.startsWith(sensorById('accord').word) && due.word.endsWith(TAIL), 'its own fixed line in the writer’s voice, and with it that the pages stand — nothing to fix or explain: ' + due.word);
  assert(due.own.startsWith(sensorById('accord').own) && due.own.endsWith(TAIL_OWN), 'and the same as the storyteller’s own words');
  eq(dueSensor({ pages: reads([bad, bad, bad, fine, fine, fine]) }).due, null, 'a slip that has already stopped (the newest two pages clean) is not said');
  eq(dueSensor({ pages: reads([null, null, null, null, null, null]) }).due, null, 'pages with no reading are never a slip');
  eq(dueSensor({ pages: reads([fine, { accord: 0.5 }, { accord: 0.5 }, { accord: 0.5 }, { accord: 0.5 }, { accord: 0.5 }]) }).due, null, 'a checker that could not tell (0.5) says nothing');
  /* every statement names a slip: for every law, a high number on page after page is that law due — and nothing else */
  for (const s of MODEL_SENSORS) { const slip = { ...fine, [s.id]: 0.95 }; eq(dueSensor({ pages: reads([slip, slip, slip, slip, slip, slip]) }).due.id, s.id, s.id + ' is said when it slips'); }
  /* the absolute laws first */
  const both = { ...fine, accord: 0.9, mine: 0.9 };
  const bothPages = reads([fine, both, fine, both, both, both]);
  eq(dueSensor({ pages: bothPages }).due.id, 'mine', 'his character before anything else');
  eq(dueSensor({ pages: bothPages, covered: ['Ghost Dialogue'] }).due.id, 'accord', 'a law the house’s eye already speaks of this turn is not said twice');
  /* among the others: the one said longest ago, so every slipping law has its turn */
  const two = { ...fine, accord: 0.9, pushed: 0.9 };
  const twoPages = reads([two, two, two, two, two, two]);
  eq(dueSensor({ pages: twoPages, index: 20 }).due.id, 'accord', 'neither said yet: the weightier');
  eq(dueSensor({ pages: twoPages, index: 20, said: { accord: { at: 2, runs: 1 } } }).due.id, 'pushed', 'the one never said goes before the one that was');
  eq(dueSensor({ pages: twoPages, index: 20, said: { accord: { at: 2, runs: 1 }, pushed: { at: 9, runs: 1 } } }).due.id, 'accord', 'both said: the one said longest ago');
  const withKnows = reads(Array.from({ length: 6 }, () => ({ ...two, knows: 0.9 })));
  eq(dueSensor({ pages: withKnows, index: 20, said: { knows: { at: 15, runs: 1 } } }).due.id, 'knows', 'an absolute law past its rest goes before them all, however lately it was said');
  /* after ANY line, two turns of quiet */
  eq(SENSOR_GAP, 2, 'two turns');
  eq(dueSensor({ pages: twoPages, index: 11, said: { accord: { at: 10, runs: 1 } } }).due, null, 'the turn after a line: nothing, though another law slips');
  eq(dueSensor({ pages: twoPages, index: 12, said: { accord: { at: 10, runs: 1 } } }).due, null, 'nor the turn after that');
  eq(dueSensor({ pages: twoPages, index: 13, said: { accord: { at: 10, runs: 1 } } }).due.id, 'pushed', 'then the next law has its turn (the first still rests)');
  /* the same turn asked for again is told the same thing — even when a weightier law slips too */
  eq(dueSensor({ pages: bothPages, index: 10, said: { accord: { at: 10, runs: 1 } } }).due.id, 'accord', 'Try again of the turn accord was said on: accord again');
  /* a law rests after it is said; pages taken back unsay it; three times unchanged and it stops */
  eq(dueSensor({ pages: three, index: 6, said: { accord: { at: 6, runs: 1 } } }).due.id, 'accord', 'Try again of the same turn: the same line');
  eq(dueSensor({ pages: three, index: 7, said: { accord: { at: 6, runs: 1 } } }).due, null, 'the next page: it rests');
  eq(dueSensor({ pages: three, index: 12, said: { accord: { at: 6, runs: 1 } } }).due, null, 'still resting on the last page of its rest');
  eq(dueSensor({ pages: three, index: 13, said: { accord: { at: 6, runs: 1 } } }).due.id, 'accord', 'past its rest and still slipping: said again');
  eq(dueSensor({ pages: three, index: 4, said: { accord: { at: 6, runs: 1 } } }).due.id, 'accord', 'the pages it was said on were taken back: it was never said');
  eq(dueSensor({ pages: three, index: 40, said: { accord: { at: 20, runs: 3 } } }).due, null, 'said three times and nothing changed: not again');
  eq(JSON.stringify(dueSensor({ pages: calm, index: 41, said: { accord: { at: 20, runs: 3 } } }).clear), '["accord"]', 'until the slip has cleared once');
  /* through the store, as the send path asks it */
  const st = await db.stories.create({ title: 'the sensors' });
  const first = await sensorWordForTurn(st.id, { pages: three, index: 6 });
  eq(first.id, 'accord', 'due on this turn');
  eq((await loadSensors(st.id)).said.accord.at, 6, 'kept with the story: where it was said');
  eq((await sensorWordForTurn(st.id, { pages: three, index: 6 })).id, 'accord', 'the same turn asked again: the same line');
  eq((await loadSensors(st.id)).said.accord.runs, 1, 'counted once');
  eq(await sensorWordForTurn(st.id, { pages: three, index: 7 }), null, 'and the next turn: nothing');
  eq(await sensorWordForTurn(st.id, { pages: calm, index: 8 }), null, 'nothing slipping: nothing said');
  eq((await loadSensors(st.id)).said.accord.runs, 0, 'and the slip is noted as cleared');
  assert(/easy agreement \.90/.test(sensorLine(bad)) && /his to play \.05/.test(sensorLine(bad)), 'a reading reads in a line: ' + sensorLine(bad));
  /* a story the first build left a line waiting on: that line is never said, and what it kept is let go */
  const old = await db.stories.create({ title: 'from the first build' });
  await db.settings.set('sensors:' + old.id, { readings: { cost: [0.1, 0.1] }, spoken: {}, word: 'Nothing has cost him anything for a while now — let something go against him, and let it stand.', wordFrom: 'cost', pageWord: '' });
  eq(await sensorWordForTurn(old.id, { pages: calm, index: 6 }), null, 'the first build’s waiting line is not said');
  eq((await sensorWordForTurn(old.id, { pages: three, index: 7 })).id, 'accord', 'the laws that stand now are');
  const row = await loadSensors(old.id);
  eq(JSON.stringify(Object.keys(row).sort()), JSON.stringify(['pageWord', 'said']), 'and the first build’s numbers and its line are gone from the story’s row');
});

test('M636-5 WHAT THE HOUSE COUNTS BY ITSELF: how the pages open and close, the turns of phrase they reuse, how much is spoken, a blow with no sound — each read from the pages, with no model', () => {
  eq(openingKind(HEAD + '\n\n“You knew,” she said.'), 'speech', 'a page that opens on speech');
  eq(openingKind(HEAD + '\n\nKaelen crossed the yard.', ['Kaelen Voss']), 'name', 'on the name of someone the story knows');
  eq(openingKind(HEAD + '\n\nKaelen’s hand shook.', ['Kaelen Voss']), 'name', 'or what is theirs');
  eq(openingKind(HEAD + '\n\nRain found the gutters first.', ['Kaelen Voss']), '', 'a sentence that merely begins with a capital is not a name');
  eq(openingKind(HEAD + '\n\nThe rain had stopped.', ['the courier', 'The Hollow King', 'Kaelen Voss']), '', 'nor is “The…”, whatever the ledger calls its people');
  eq(openingKind(HEAD + '\n\nCaptain Oda turned.', ['Captain Oda']), 'name', 'a title that is part of the name counts with it');
  eq(openingKind(HEAD + '\n\n*CRACK!* The beam gave.'), 'sound', 'on a sound');
  eq(openingKind(HEAD + '\n\nThe rain had stopped.'), '', 'an ordinary opening is no kind at all');
  eq(closingKind('He stood.\n\n~t~*She can’t find out.*~/t~ Mira thought.'), 'thought', 'a page that ends on a private thought');
  eq(closingKind('He stood.\n\n“Well? What will it be?”'), '', 'a question left hanging for him is the craft’s own slot, never a kind');
  const opens = sensorById('opens'); const closes = sensorById('closes');
  const speechy = [1, 2, 3, 4].map((i) => page('“Line ' + i + ',” she said.', i));
  eq(opens.test({ texts: speechy }), true, 'four pages opening the same way');
  eq(opens.test({ texts: [...speechy.slice(0, 3), page('Kaelen crossed the yard.', 9)], names: ['Kaelen'] }), false, 'one page that opens differently breaks it');
  eq(opens.test({ texts: [1, 2, 3, 4].map((i) => page('Kaelen moved, take ' + i + '.', i)), names: ['Kaelen'] }), true, 'four pages opening on the same person’s name');
  eq(opens.test({ texts: [1, 2, 3, 4].map((i) => page('Rain fell, take ' + i + '.', i)), names: ['Kaelen'] }), false, 'four pages that merely begin with a capital are not a pattern');
  eq(opens.test({ texts: [1, 2, 3, 4].map((i) => page('The rain went on.', i)) }), false, 'ordinary openings are never a pattern');
  eq(closes.test({ texts: [1, 2, 3, 4].map((i) => page('It rained.', i, '~t~*Thought ' + i + '.*~/t~')) }), true, 'four pages ending on a thought');
  eq(closes.test({ texts: [1, 2, 3, 4].map((i) => page('It rained.', i, '“Well?”')) }), false, 'four pages ending on his slot are not');
  /* spoken share: the house's eye's own measure */
  const silent = [1, 2, 3, 4].map((i) => page('It rained.', i));
  const chatty = [1, 2, 3, 4].map((i) => HEAD + '\n\n' + Array.from({ length: 30 }, (_, k) => '“Spoken line number ' + (i * 100 + k) + ' runs on about the harvest and the toll.”').join(' '));
  assert(spokenShare(silent[0]) === 0 && spokenShare(chatty[0]) > 0.7, 'measured as the house’s eye measures it');
  eq(spokenShare('short'), null, 'a page too short to judge has no share');
  const lowNote = lintPage({ assistantText: silent[0] }).findings.find((f) => f.law === 'Dialogue Ratio');
  assert(lowNote && /Spoken dialogue is 0%/.test(lowNote.words), 'and the house’s eye still notes it in its own words (one measure, two readers)');
  eq(sensorById('quiet').test({ texts: silent, others: true }), true, 'four pages with people here and hardly a word');
  eq(sensorById('quiet').test({ texts: silent, others: false }), false, 'alone, silence is not a slip');
  const hushed = silent.map((text) => ({ text, scores: fine }));
  eq(dueSensor({ pages: hushed, others: true }).due.id, 'quiet', 'said, with people here');
  eq(dueSensor({ pages: hushed, others: true, small: true }).due, null, 'a small storyteller’s talk and sounds are its own planner’s to mind — never asked for here against them');
  eq(sensorById('talky').test({ texts: chatty }), true, 'four pages of almost nothing but talk');
  eq(sensorById('talky').test({ texts: silent }), false, 'and not the quiet ones');
  /* a blow with no sound */
  const blows = (i, sound) => page('He punched the post, kicked the door, slammed the lid and smashed the jar.' + (sound ? ' *CRACK!*' : ''), i);
  eq(impactCount(blows(1, false)), 4, 'four blows counted');
  eq(impactCount(HEAD + '\n\n“He kicked me out, we crashed at hers, she slammed the door and smashed my phone,” Mira said.'), 0, 'blows only spoken of are not blows on the page');
  eq(sensorById('sounds').test({ texts: [blows(1, false), page('It rained.', 2), blows(3, false)] }), true, 'two of the last three pages had blows and no sound');
  eq(sensorById('sounds').test({ texts: [blows(1, true), page('It rained.', 2), blows(3, true)] }), false, 'with their sounds, nothing to say');
  eq(sensorById('sounds').test({ texts: silent }), false, 'a page with no blows needs no sound');
  /* the same turns of phrase */
  const worn = ['A slow breath rattled through the old rafters above.', 'The lamp guttered hard against the cold draft again.', 'Heavy boots scraped slowly over the wet flagstones outside.'];
  const wornPages = [1, 2, 3, 4, 5].map((i) => page('It rained.', i) + '\n\n' + worn.join(' '));
  eq(sensorById('phrases').test({ texts: wornPages, names: [] }), true, 'five pages reaching for the same three turns of phrase');
  eq(sensorById('phrases').test({ texts: [1, 2, 3, 4, 5].map((i) => page('It rained.', i)), names: [] }), false, 'fresh pages: nothing');
  const said = dueSensor({ pages: wornPages.map((text) => ({ text, scores: fine })) }).due;
  eq(said.id, 'phrases', 'and it is the law said');
  for (const w of worn) assert(!said.word.includes(w.slice(0, 20)) && !said.own.includes(w.slice(0, 20)), 'the worn words are never quoted back');
  eq(dueSensor({ pages: wornPages.map((text) => ({ text, scores: fine })), small: true }).due, null, 'a small storyteller’s planner already names its worn phrases — not said twice');
  /* paragraph after paragraph opening on a name */
  const named = (i) => HEAD + '\n\n' + ['Kaelen crossed the yard, take ' + i + '.', 'He set the bucket down.', 'Mira watched him from the step.', 'She said nothing for a while.', 'Kaelen wiped his hands.'].map((open, k) => open + ' ' + filler(i * 10 + k, 200)).join('\n\n');
  const mixed = (i) => HEAD + '\n\n' + ['Kaelen crossed the yard, take ' + i + '.', 'The bucket rang on the stones.', 'Mira watched him from the step.', '“Well?” she said.', 'Rain came on.'].map((open, k) => open + ' ' + filler(i * 10 + k, 200)).join('\n\n');
  eq(nameRun(named(1), ['Kaelen Voss', 'Mira']), 5, 'five paragraphs running open on a name or He / She');
  eq(nameRun(mixed(1), ['Kaelen Voss', 'Mira']), 1, 'paragraphs that begin in different ways have no run');
  eq(sensorById('paras').test({ texts: [named(1), named(2), mixed(3), named(4)], names: ['Kaelen Voss', 'Mira'] }), true, 'three of the last four pages');
  eq(sensorById('paras').test({ texts: [named(1), mixed(2), mixed(3), named(4)], names: ['Kaelen Voss', 'Mira'] }), false, 'two is not a habit');
  /* speeches */
  const speech = (n) => '“' + Array.from({ length: n }, (_, k) => 'This is sentence number ' + (k + 1) + ' of what she has to say about the harvest.').join(' ') + '”';
  eq(longSpeeches(page('It rained.', 1) + '\n\n' + speech(7)), 1, 'seven sentences with no beat is a speech');
  eq(longSpeeches(page('It rained.', 1) + '\n\n' + speech(3) + ' She shrugged. ' + speech(3)), 0, 'two to four, a beat, two to four is how people talk');
  eq(sensorById('speeches').test({ texts: [1, 2, 3, 4].map((i) => page('It rained.', i) + '\n\n' + speech(i === 2 ? 3 : 7)) }), true, 'speeches on three of the last four pages');
  eq(sensorById('speeches').test({ texts: [1, 2, 3, 4].map((i) => page('It rained.', i) + '\n\n' + speech(3)) }), false, 'none: nothing');
  /* private thoughts */
  const thinks = (n) => page('It rained.', n) + '\n\n' + Array.from({ length: n }, (_, k) => '~t~*Thought ' + k + ' of hers.*~/t~ She looked away.').join(' ');
  eq(thoughtCount(thinks(3)), 3, 'three private thoughts counted');
  eq(sensorById('thoughts').test({ texts: [thinks(3), thinks(4), thinks(2), thinks(3)] }), true, 'more than two a page on three of the last four');
  eq(sensorById('thoughts').test({ texts: [thinks(2), thinks(2), thinks(1), thinks(2)] }), false, 'two at most is the law kept');
  /* the turns kept out of the narration — counted in the narration alone, dashes only on a calm page */
  const turns = 'He was not angry, but tired. She waited — then left — without a word. And the door closed. But nobody moved. The lamp was not bright, but it held.';
  const leaning = (i) => page('It rained.', i) + '\n\n' + turns;
  const c = constructsOf(leaning(1));
  eq([c.swivel, c.dashes, c.starts, c.heavy].join(','), '2,2,2,true', 'two “not this, but that”, two dashes, two sentences opening on And / But: a heavy page');
  eq(constructsOf(page('It rained.', 1) + '\n\n“' + turns + '”').total, 0, 'the same turns in someone’s mouth are theirs — not counted');
  const loud = constructsOf(leaning(1) + ' *CRACK!* *THUD!*');
  eq(loud.dashes + ',' + loud.heavy, '0,false', 'where sounds are on the page, dashes are the craft’s own braiding — not counted');
  eq(constructsOf(page('It rained.', 1)).heavy, false, 'plain narration is not heavy');
  eq(constructsOf(HEAD + '\n\nHe did not answer, but his jaw set. She could not help but smile. Nothing but rain fell.').swivel, 0, 'an ordinary “did not…, but…” is not the turn');
  eq(constructsOf(HEAD + '\n\nIt wasn’t anger. It was something quieter. The yard was not empty, but it felt that way. He came not with a threat but with a promise.').swivel, 3, 'the contrast set up to be knocked down is — in each of its shapes');
  /* a short one-beat page, as real drifting narration reads */
  const beat = HEAD + '\n\nThe morning was not cold, but it carried a weight — the kind that settled in the chest and stayed. Rukia did not look at him. She set the ledger down — carefully, deliberately — and squared its corners.\n\nIt wasn’t anger. It was something quieter. And it was worse.\n\nRenji shifted his weight... then stopped. But the silence stretched.';
  const b1 = constructsOf(beat);
  eq(b1.heavy, true, 'a short page thick with them is heavy: ' + JSON.stringify(b1));
  eq(constructsOf(HEAD + '\n\nRukia set the ledger on the rail and squared its corners with two fingers. Below, the recruits ran the long side of the yard in pairs. A bell rang twice from the gate tower.\n\n“You are late,” she said.').total, 0, 'and clean narration has none');
  eq(sensorById('constructs').test({ texts: [leaning(1), page('It rained.', 2), leaning(3), leaning(4)] }), true, 'heavy on three of the last four pages');
  const told = dueSensor({ pages: [leaning(1), page('It rained.', 2), leaning(3), leaning(4)].map((text) => ({ text, scores: fine })) }).due;
  eq(told.id, 'constructs', 'and it is the law said');
  assert(told.word.includes('the “not this, but that” turn') && told.word.includes('dashes where nothing is racing') && told.word.includes('sentences that open on And or But') && !told.word.includes('trailing dots'), 'naming the turns the newest page leans on, and only those: ' + told.word);
  assert(!told.word.includes('not angry') && !told.own.includes('not angry'), 'in fixed words — nothing of the page is quoted back');
});

test('M636-6 THE ONE LINE, IN THE ROLE HE CHOSE: after his message as it ships; a system or a user message; or the storyteller’s own words right before his message — never last, and nothing at all when nothing is due', () => {
  const s = sensorById('mine');
  const msgs = [{ id: 'u0', role: 'user', text: 'We begin.' }, { id: 'a0', role: 'assistant', text: HEAD + '\n\nKaelen waited.' }, { id: 'u1', role: 'user', text: 'I wait.' }];
  const build = (extra) => buildRequest({ ...base, messages: msgs, settings: { tellerName: 'Iron Man' }, ...extra });
  const plain = build({});
  const asShips = build({ sensorNote: s.word, sensorOwn: s.own, sensorRole: '' });
  const closing = asShips.messages[asShips.messages.length - 1];
  eq(closing.role, 'system', 'as it ships: with the other words after his message');
  assert(closing.content.includes('Iron Man — leave him to me — his words and his choices are mine to write.'), 'in his voice, led by the teller’s name: ' + closing.content.slice(0, 120));
  assert((asShips.receipt.slots || []).some((x) => x.name === 'The sensors’ word' && x.tokens > 0), 'and named on the receipt');
  assert(!JSON.stringify(asShips.messages).includes(s.own), 'the storyteller’s-own wording is not sent in this role');
  const asUser = build({ sensorNote: s.word, sensorOwn: s.own, sensorRole: 'user' });
  const userSeg = asUser.messages.slice(3).find((m) => m.role === 'user' && m.content.includes('leave him to me'));
  assert(userSeg, 'as a user message: a message of his carries it, after his move');
  eq(build({ sensorNote: s.word, sensorOwn: s.own, sensorRole: 'system' }).messages.slice(3).filter((m) => m.role === 'system' && m.content.includes('leave him to me')).length, 1, 'as a system message');
  const asOwn = build({ sensorNote: s.word, sensorOwn: s.own, sensorRole: 'assistant' });
  const at = asOwn.messages.findIndex((m) => m.role === 'assistant' && m.content === s.own);
  assert(at > 0, 'as the storyteller’s own words: a turn of its own');
  eq(asOwn.messages[at - 1].role + '>' + asOwn.messages[at + 1].role, 'assistant>user', 'beside its last page, right before his message');
  eq(asOwn.messages[at + 1].content.includes('I wait.'), true, 'his message follows it');
  assert(asOwn.messages[asOwn.messages.length - 1].role !== 'assistant', 'the request never ends on the storyteller’s words');
  assert(!JSON.stringify(asOwn.messages).includes('leave him to me'), 'and it is said once, not also after his message');
  assert((asOwn.receipt.slots || []).some((x) => x.name === 'The sensors’ word' && x.text === s.own), 'the receipt shows the words that rode');
  const alone = buildRequest({ ...base, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }], settings: { tellerName: 'Iron Man' }, sensorNote: s.word, sensorOwn: s.own, sensorRole: 'assistant' });
  assert(!alone.messages.some((m) => m.role === 'assistant') && alone.messages[alone.messages.length - 1].content.includes('leave him to me'), 'with no page of its own to stand beside, it is said after his message instead');
  eq(JSON.stringify(build({ sensorNote: '', sensorOwn: '', sensorRole: 'assistant' }).messages), JSON.stringify(plain.messages), 'nothing due: not one byte of the request changes, whatever the role');
  assert((plain.receipt.slots || []).some((x) => x.name === 'The sensors’ word' && x.tokens === 0 && x.reason), 'and the row stands at 0 saying why (M510-20)');
});

test('M636-8 EVERY LINE A SENSOR CAN SAY READS AS THE WRITER’S OWN NOTE, OR AS THE STORYTELLER’S OWN THOUGHT — no third voice, no machinery (M495’s law, held for each of them)', () => {
  const persona = /\b(assistant|an AI|language model|LLM|system prompt|the system|worker|JSON|mutation|marching orders|the director|the editor|the auditor|the referee|the house|sensor|checker|reading|score|flag)\b/i;
  for (const s of SENSORS) {
    for (const line of [s.word, s.own]) {
      assert(typeof line === 'string' && line.length > 20 && line.length < 260, s.id + ': one short line');
      assert(!persona.test(line), s.id + ' names the machinery: ' + line);
      assert(!/\n/.test(line), s.id + ': one line');
    }
    assert(/\bI (?:have|keep|hold|am|show|open|stop|vary|check)\b|\bMy (?:last pages|narration)\b|\bmy last pages\b/.test(s.own), s.id + ': its own-words form is the storyteller speaking: ' + s.own);
    assert(!/\bI have been\b|\b[Mm]y last pages\b|\bMy narration\b|\byour (?:character|brief|move)\b/.test(s.word), s.id + ': the writer’s form is the writer speaking: ' + s.word);
    assert(typeof s.law === 'string' && s.law.length > 3, s.id + ' is a law of his craft, by name');
    if (s.kind === 'model') assert(s.op === 'above' && s.line >= 0.6 && s.need >= 2 && s.window >= s.need && s.rest >= 3, s.id + ': a statement that names a slip, said only when it shows on several pages');
  }
  for (const tail of [TAIL, TAIL_OWN]) assert(!persona.test(tail) && /nothing to fix or explain/.test(tail), 'what is said with every line: the pages stand');
  eq(new Set(SENSORS.map((s) => s.id)).size, SENSORS.length, 'every sensor has its own name');
  eq(SENSORS.filter((s) => s.tier === 1).map((s) => s.id).join(','), 'mine,ahead,knows,world', 'the absolute laws: his character, his move, what people can know, what is true');
});

test('M636-7 A HOUSE THAT TAKES NO TWO TURNS OF ONE ROLE IN A ROW says so once, is remembered, and the same turn goes again with the neighbours as one message', async () => {
  assert(TWIN_REFUSAL.test('deepseek-reasoner does not support successive user or assistant messages') && TWIN_REFUSAL.test('Conversation roles must alternate user/assistant/user/assistant/...') && !TWIN_REFUSAL.test('Unknown parameter: min_p'), 'the refusal is known by its words');
  const wire = [{ role: 'system', content: 's' }, { role: 'system', content: 's2' }, { role: 'assistant', content: 'PAGE' }, { role: 'assistant', content: 'OWN' }, { role: 'user', content: 'MOVE' }];
  eq(hasTwins(wire), true, 'two of the storyteller’s turns side by side');
  eq(hasTwins([{ role: 'system', content: 'a' }, { role: 'system', content: 'b' }, { role: 'user', content: 'u' }]), false, 'system messages side by side are not twins');
  eq(foldTwins(wire.slice()).map((m) => m.role + ':' + m.content).join(' | '), 'system:s | system:s2 | assistant:PAGE\n\nOWN | user:MOVE', 'folded into one, a blank line between, the order kept');
  const conn = await db.connections.add({ type: 'openai', preset: 'custom', baseUrl: 'https://strict.example/v1', apiKey: 'k', model: 'strict-13b', label: 'Strict twins' });
  const msgs = [{ role: 'user', content: 'We begin.' }, { role: 'assistant', content: 'PAGE' }, { role: 'assistant', content: 'OWN' }, { role: 'user', content: 'MOVE' }];
  const inner = thinkingHouse({ answer: '{"ok":true}' });
  const seen = [];
  const strict = { calls: inner.calls, fetch: async (url, opts) => { const body = JSON.parse(opts.body); seen.push(body); if (hasTwins(body.messages)) return new Response(JSON.stringify({ error: { message: 'This model does not support successive user or assistant messages.' } }), { status: 400, headers: { 'content-type': 'application/json' } }); return inner.fetch(url, opts); } };
  const out = await withHouse(strict, () => callWorker(conn, { system: 's', messages: msgs }));
  eq(out.text, '{"ok":true}', 'the turn went again and answered');
  eq(seen.length, 2, 'refused once, then answered');
  eq(seen[1].messages.filter((m) => m.role === 'assistant').map((m) => m.content).join('|'), 'PAGE\n\nOWN', 'the neighbours went as one message');
  const back = (await db.connections.list()).find((c) => c.id === conn.id);
  assert(back && typeof back.twinsRefusedFor === 'string' && back.twinsRefusedFor.length, 'remembered for that model at that address');
  const again = thinkingHouse({ answer: '{"ok":true}' });
  await withHouse(again, () => callWorker(back, { system: 's', messages: msgs }));
  eq(again.calls.length, 1, 'and from then on it is asked that way — no refusal first');
  eq(again.calls[0].body.messages.filter((m) => m.role === 'assistant').length, 1, 'one message');
});

test('M638-1 EVERY TRY SAYS WHAT HAPPENED: a decisions address that works says how much it took in; one that refuses says its own reason; one that takes in too little is NOT USED; a model that answers with words is said to — never a silent nothing', async () => {
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const answers = Object.fromEntries(MODEL_SENSORS.map((s) => [s.id, { noul: s.id === 'accord' ? 0.9 : 0.05 }]));
  const before = Array.from({ length: 10 }, (_, i) => ({ who: i % 2 ? 'teller' : 'writer', text: 'TURN-' + i + ' ' + filler(i + 50, 6000) }));
  const args = { brief: 'A hard tale.', before, page: HEAD + '\n\nKaelen named a price.' };
  const clef = { baseUrl: 'https://api.neuralwatt.com/v1', model: 'clef-flash', label: 'Clef Flash', apiKey: 'k' };
  const seen = [];
  const house = (status, body) => ({ calls: [], fetch: async (url, opts) => { seen.push({ url: String(url), body: JSON.parse(opts.body), auth: (opts.headers && (opts.headers.authorization || opts.headers.Authorization)) || '' }); return res(status, typeof body === 'function' ? body(JSON.parse(opts.body)) : body); } });
  /* works: the address says how many tokens it took in — about what it was sent */
  const ok = await withHouse(house(200, (sent) => ({ model: 'clef-flash', answers, usage: { input_tokens: Math.round(JSON.stringify(sent.state).length / 4) } })), () => readPageFull({ connection: clef, ...args }));
  eq(ok.ok, true, 'it read the page');
  eq(seen[0].url, 'https://api.neuralwatt.com/v1/systemone', 'at the decisions address of that connection');
  eq(seen[0].auth, 'Bearer k', 'with its key');
  eq(Object.keys(seen[0].body.state)[0], 'page_to_judge', 'the page first');
  eq(Object.keys(ok.scores).length, MODEL_SENSORS.length, 'every statement answered');
  assert(ok.sent > 10000 && Math.abs(ok.read - ok.sent) < 50, 'what it was sent, and what it says it took in: ' + ok.sent + ' / ' + ok.read);
  const words = readingWords(ok, 'page 34');
  assert(/^Working — Clef Flash read page 34: 18 answers in [\d.]+ s\. It was sent about [\d,]+ tokens and took in [\d,]+\./.test(words), 'said in one plain sentence: ' + words);
  assert(/Slips it saw on that page: easy agreement\.$/.test(words), 'with what it saw');
  eq(slipNames(ok.scores).join(','), 'easy agreement', 'by the law’s own name');
  /* refuses: its own status and words */
  const refused = await withHouse(house(401, { error: { message: 'Invalid API key' } }), () => readPageFull({ connection: clef, ...args }));
  eq(refused.ok, false, 'no reading');
  eq(refused.why, 'the address answered 401 — Invalid API key', 'the real reason');
  eq(readingWords(refused, 'page 34'), 'Not working — Clef Flash could not read page 34: the address answered 401 — Invalid API key.', 'said plainly');
  eq((await withHouse(house(403, { detail: 'Preview access required' }), () => readPageFull({ connection: clef, ...args }))).why, 'the address answered 403 — Preview access required', 'whatever field the address puts its reason in');
  /* takes in too little (Cloudflare's own hosting: about two thousand tokens of any state): its answers are not used */
  const cut = await withHouse(house(200, { result: { model: 'clef-flash', answers, usage: { input_tokens: 2392 } }, success: true }), () => readPageFull({ connection: { baseUrl: 'https://api.cloudflare.com/client/v4/accounts/abc/ai/run/@cf/cloudflare/clef-flash', model: 'clef-flash', label: 'Clef on Cloudflare', apiKey: 'k' }, ...args }));
  eq(cut.ok, false, 'a reading made on a sliver of the story is no reading');
  assert(/took in only about 2,392 of the [\d,]+ tokens it was sent — too little of the story to judge a page by/.test(cut.why), 'and it says how little: ' + cut.why);
  /* an address that does not say how much it took in still reads; the sentence says it does not say */
  const quiet = await withHouse(house(200, { answers }), () => readPageFull({ connection: clef, ...args }));
  eq(quiet.ok && quiet.read, null, 'no count given');
  assert(/this address does not say how many it took in/.test(readingWords(quiet, 'page 2')), 'said so');
  /* an ordinary model */
  const chat = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro', label: 'DeepSeek', preset: 'deepseek' };
  const fineAll = JSON.stringify(Object.fromEntries(MODEL_SENSORS.map((s) => [s.id, 0.05])));
  const good = await readPageFull({ connection: chat, ...args, callLLM: async () => fineAll });
  assert(good.ok && good.read === null && /^Working — DeepSeek read the page: 18 answers in [\d.]+ s\. That page’s own request was no longer kept, so it was read with the pages before it\. It saw no slip on that page\.$/.test(readingWords(good)), 'works, and says how it read: ' + readingWords(good));
  eq((await readPageFull({ connection: chat, ...args, callLLM: async () => 'I would rather not judge this page.' })).why, 'the model answered, but not with the numbers it was asked for', 'words instead of numbers');
  eq((await readPageFull({ connection: chat, ...args, callLLM: async () => { throw new Error('Insufficient Balance'); } })).why, 'Insufficient Balance', 'the provider’s own refusal');
  eq((await readPageFull({ connection: null, ...args })).why, 'no model is set for the sensors', 'no connection');
  eq((await readPageFull({ connection: chat, page: ' ' })).why, 'there is no page to read', 'no page');
  /* the sample page reads like any other */
  const sample = await readPageFull({ connection: chat, ...SAMPLE_READ, callLLM: async () => fineAll });
  assert(sample.ok && /^Working — DeepSeek read a sample page: 18 answers/.test(readingWords(sample, 'a sample page')) && !/no longer kept/.test(readingWords(sample, 'a sample page')), 'a check with no story open: ' + readingWords(sample, 'a sample page'));
});

test('M640-1 A DECISIONS ADDRESS IS HANDED WHAT IT SHOWS IT TAKES IN: one whose own count says its room is smaller than listed is asked once more, cut to that room by the house’s own order, and the room is kept for that model at that address; one that takes in too little to judge by is still not used', async () => {
  const res = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const answers = Object.fromEntries(MODEL_SENSORS.map((s) => [s.id, { noul: 0.05 }]));
  const before = Array.from({ length: 40 }, (_, i) => ({ who: i % 2 ? 'teller' : 'writer', text: 'TURN-' + i + ' ' + filler(i + 200, 6000) }));
  const args = { brief: 'A hard tale.', before, page: HEAD + '\n\nPAGE-MARK Kaelen named a price.' };
  const clef = { id: 'c1', baseUrl: 'https://api.neuralwatt.com/v1', model: 'clef-flash', label: 'Clef Flash', apiKey: 'k' };
  const seen = [];
  /* an address that takes in `real` tokens at most, and says how many it took */
  const house = (real) => ({ calls: [], fetch: async (url, opts) => { const sent = JSON.parse(opts.body); const tokens = Math.round(JSON.stringify(sent.state).length / 4); seen.push({ tokens, state: sent.state }); return res({ answers, usage: { input_tokens: Math.min(real, tokens) } }); } });
  eq(decisionsRoom(clef), 262144, 'listed for it');
  const learned = await withHouse(house(20000), () => readPageFull({ connection: clef, ...args }));
  eq(seen.length, 2, 'asked once, found short, asked once more');
  assert(seen[0].tokens > 40000 && seen[1].tokens < 20000, 'the second asking is cut to the room it showed: ' + seen[0].tokens + ' then ' + seen[1].tokens);
  for (const call of seen) assert(call.state.page_to_judge.includes('PAGE-MARK') && /TURN-38/.test(call.state.the_writers_move_it_answers), 'the page and his move are whole in both');
  assert(JSON.stringify(seen[1].state).includes('TURN-39') && !JSON.stringify(seen[1].state).includes('TURN-0 '), 'what is left out is the oldest of the story — the house’s own cut, not the address’s');
  eq(learned.ok, true, 'and that reading is used');
  eq(learned.learnedRoom, 20000, 'the room it showed is handed back to be kept');
  assert(learned.read === seen[1].tokens && learned.sent === seen[1].tokens, 'it took in all of the second asking');
  assert(/This address takes in about 20,000 tokens — less than is listed for it — so it is handed no more than that from now on\./.test(readingWords(learned, 'page 9')), 'said plainly: ' + readingWords(learned, 'page 9'));
  /* kept for that model at that address: the next page is cut to it at once */
  const kept = { ...clef, sensesRoom: 20000, sensesRoomFor: 'clef-flash@https://api.neuralwatt.com/v1' };
  eq(decisionsRoom(kept), 20000, 'the room it showed, from now on');
  seen.length = 0;
  const next = await withHouse(house(20000), () => readPageFull({ connection: kept, ...args }));
  eq(seen.length + ':' + next.ok + ':' + next.learnedRoom, '1:true:null', 'one asking, used, nothing new to learn');
  eq(decisionsRoom({ ...kept, model: 'clef' }), 262144, 'another model on that connection is not held to it');
  eq(decisionsRoom({ ...kept, contextSize: 9000 }), 9000, 'his own smaller number still wins');
  /* too little to judge by: not asked again, not used */
  eq(LEAST_ROOM, 16000, 'the least that is enough');
  seen.length = 0;
  const sliver = await withHouse(house(2048), () => readPageFull({ connection: clef, ...args }));
  eq(seen.length + ':' + sliver.ok, '1:false', 'asked once, and its answers are not used');
  assert(/took in only about 2,048 of the [\d,]+ tokens it was sent — too little of the story to judge a page by/.test(sliver.why), sliver.why);
  seen.length = 0;
  const thin = await withHouse(house(9000), () => readPageFull({ connection: clef, ...args }));
  eq(seen.length + ':' + thin.ok, '1:false', 'nine thousand is still too little');
});

test('M640-2 THE ROLE OF THE ONE LINE: his choice — but the storyteller’s own words only where a turn of its own can stand beside its page', () => {
  eq(sensorRoleFor('assistant', { model: 'kimi-k3' }), 'assistant', 'his choice, where it can stand');
  eq(sensorRoleFor('assistant', { model: 'deepseek-reasoner' }), '', 'a reasoner by name: after his message instead');
  eq(sensorRoleFor('assistant', { model: 'kimi-k3', twins: true }), '', 'a house that has refused two turns of one role: after his message');
  eq(sensorRoleFor('assistant', { model: 'glm-4.6', small: true }), '', 'a small storyteller: after his message');
  eq(sensorRoleFor('user', { model: 'deepseek-reasoner', twins: true, small: true }), 'user', 'a user message is his choice anywhere');
  eq(sensorRoleFor('system', { small: true }), 'system', 'and a system message');
  eq(sensorRoleFor(undefined) + '|' + sensorRoleFor('') + '|' + sensorRoleFor('teller') + '|' + sensorRoleFor(7), '|||', 'nothing chosen, or a word that is no role: as it ships');
});

test('M642-3 ONE NOTE AT A TIME FOR A STORY’S SHELF OF WORKERS: two workers noting at the same moment both keep their rows (the sensors note outside the chain), and a row that just turned fine is not put back to “stumbled” by the other’s write', async () => {
  const { noteWorkerRun, loadWorkerStatus } = await import('../../js/agents/status.js');
  const a = await db.stories.create({ title: 'two notes at once' });
  await Promise.all([noteWorkerRun(a.id, 'sensors', { ok: true, detail: 'Working — read page 3' }), noteWorkerRun(a.id, 'extractor', { ok: true, detail: 'wrote 2 changes' })]);
  eq(Object.keys(await loadWorkerStatus(a.id)).sort().join(','), 'extractor,sensors', 'both rows are kept');
  for (const order of [['sensors', 'extractor'], ['extractor', 'sensors']]) {
    const b = await db.stories.create({ title: 'a stale failure ' + order[0] });
    await noteWorkerRun(b.id, 'extractor', { ok: false, why: 'the provider was busy' });
    const notes = { sensors: { ok: true, detail: 'Working — read page 3' }, extractor: { ok: true, detail: 'wrote 2 changes' } };
    await Promise.all(order.map((n) => noteWorkerRun(b.id, n, notes[n])));
    const shelf = await loadWorkerStatus(b.id);
    eq(shelf.extractor.ok + ':' + shelf.extractor.why + ':' + Boolean(shelf.sensors), 'true::true', 'the page reader is fine and the sensors’ row stands, whichever noted first (' + order.join(' then ') + ')');
  }
  /* many at once, across two stories: every row lands */
  const c = await db.stories.create({ title: 'many' });
  const names = ['extractor', 'world', 'scribe', 'keeper', 'sensors', 'auditor'];
  await Promise.all([...names.map((n) => noteWorkerRun(c.id, n, { ok: true, detail: n })), noteWorkerRun(a.id, 'world', { ok: true, detail: 'other story' })]);
  const many = await loadWorkerStatus(c.id);
  eq(names.filter((n) => many[n] && many[n].detail === n).length, names.length, 'six notes at once: six rows, each its own words — ' + Object.keys(many).join(','));
  assert((await loadWorkerStatus(a.id)).world && (await loadWorkerStatus(a.id)).sensors, 'and another story’s shelf is its own');
});
