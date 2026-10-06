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
  sensorLine, openingKind, closingKind, impactCount,
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
const fine = { mine: 0.95, knows: 0.05, world: 0.95, accord: 0.05, pushed: 0.05, held: 0.05, same: 0.05, swap: 0.05, tone: 0.9 };
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
});

test('M636-4 WHICH LAW IS DUE: one page earns nothing, several pages earn ONE fixed line; calm pages earn none; it rests, repeats on Try again, and stops when nothing changes', async () => {
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
  eq(due.word, sensorById('accord').word, 'its own fixed line, in the writer’s voice');
  eq(due.own, sensorById('accord').own, 'and the same law as the storyteller’s own words');
  eq(dueSensor({ pages: reads([bad, bad, bad, fine, fine, fine]) }).due, null, 'a slip that has already stopped (the newest two pages clean) is not said');
  eq(dueSensor({ pages: reads([null, null, null, null, null, null]) }).due, null, 'pages with no reading are never a slip');
  eq(dueSensor({ pages: reads([fine, { accord: 0.5 }, { accord: 0.5 }, { accord: 0.5 }, { accord: 0.5 }, { accord: 0.5 }]) }).due, null, 'a checker that could not tell (0.5) says nothing');
  const both = { ...fine, accord: 0.9, mine: 0.1 };
  eq(dueSensor({ pages: reads([fine, both, fine, both, both, both]) }).due.id, 'mine', 'two laws slipping: only the weightier is said');
  eq(dueSensor({ pages: reads([fine, both, fine, both, both, both]), covered: ['Ghost Dialogue'] }).due.id, 'accord', 'a law the house’s eye already speaks of this turn is not said twice');
  /* it rests after it is said; the same turn asked again is told the same thing; pages taken back unsay it */
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
  assert(/easy agreement \.90/.test(sensorLine(bad)) && /his to play \.95/.test(sensorLine(bad)), 'a reading reads in a line: ' + sensorLine(bad));
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
  eq(dueSensor({ pages: hushed, others: true, covered: ['Dialogue Ratio', 'Sound As Onomatopoeia'] }).due, null, 'a small storyteller’s talk and sounds are its own planner’s to mind — never asked for here against them');
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
    assert(/^I |^My |^People have hardly spoken on my|^Something in my/.test(s.own), s.id + ': its own-words form is the storyteller speaking: ' + s.own);
    assert(!/\bI have been\b|\bmy last pages\b/i.test(s.word), s.id + ': the writer’s form is the writer speaking: ' + s.word);
  }
  eq(new Set(SENSORS.map((s) => s.id)).size, SENSORS.length, 'every sensor has its own name');
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
