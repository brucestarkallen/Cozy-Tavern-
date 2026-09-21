/* M357: what the house saw in a page is said BEFORE the next one — never by sending that page back (the writer: "that's
 * breaking immersion"); the page's furniture (the header, any bracketed row) is never read as prose.
 * M358: THE GROUNDING PHRASE — the first words of the teller's own thinking, so its voice starts in character. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { db } from '../../js/store.js';
import { stripFurniture, staleLeak, mineLeak, mineWord, staleWord } from '../../js/assemble/plain.js';
import { voiceOf, groundingOf, groundingLine, groundingSeed, askAgain } from '../../js/assemble/voice.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { keepPageWord, takeWordForTurn, loadSensors } from '../../js/agents/sensors.js';

const HEAD = '[The courtyard — Monday, March 3, 2025 | 09:00 | clear | coat | by the gate]';
const A = [
  'Rain found the gutters first, and then the low sill under the shutter.',
  'A dog barked twice somewhere past the wall and gave it up.',
  'Someone had left a bucket upturned beside the well since the feast.',
  'The bell in the tower ran three minutes fast, as it always had.',
  'Wool smoke hung low over the roofs of the lower town all morning.',
  'Two apprentices argued about a broken strap until neither meant it.',
  'Salt crusted the flagstone where the fish cart stood at dawn.',
].join(' ');
const B = [
  'Pigeons lifted off the granary roof together and settled again.',
  'A cart wheel had shed its iron rim near the fountain in the night.',
  'Chalk numbers climbed the wall beside the cooper’s door, none of them recent.',
  'Nobody had swept the arcade since the last feast day.',
  'A cat considered the fish cart from underneath a bench.',
  'The well rope creaked in its bracket whenever the wind turned.',
  'Somebody’s laundry snapped like a flag above the lane.',
].join(' ');

test('M357-1 THE PAGE’S FURNITURE IS NOT ITS PROSE: the header is the same shape on every page by design, and is never counted as a phrase said twice — nor as him acting', () => {
  eq(stripFurniture(HEAD + '\n\nKaelen waited.').trim(), 'Kaelen waited.', 'the bracketed row is cut');
  eq(staleLeak(HEAD + '\n\n' + A, [HEAD + '\n\n' + B]).length, 0, 'the same header twice is not a repeat');
  const stale = staleLeak(HEAD + '\n\n' + A, [HEAD + '\n\n' + B + ' Rain found the gutters first, and then the low sill under the shutter.']);
  assert(stale.length >= 1 && /rain found the gutters first and then the low sill/.test(stale[0]), 'and what the prose really repeats is still seen: ' + JSON.stringify(stale));
  eq(mineLeak('[Jovan’s room — Monday | 09:00 | clear | coat | at the window]\n\nKaelen waited by the door.', { mc: 'Jovan' }), '', 'his name in the header is not him acting');
});

test('M357-2 IT IS SAID BEFORE THE NEXT PAGE, NOT BY SENDING THIS ONE BACK — one line, his voice, kept with the story and taken once', async () => {
  const st = await db.stories.create({ title: 'said next time' });
  await keepPageWord(st.id, mineWord('gave him words of his own', 'Jovan'));
  const kept = await loadSensors(st.id);
  assert(/That last page gave him words of his own/.test(kept.pageWord), 'kept with the story');
  const word = await takeWordForTurn(st.id);
  assert(/Jovan is mine to play/.test(word), 'taken for the next turn: ' + word);
  eq(await takeWordForTurn(st.id), '', 'and never twice');
  const r = buildRequest({ story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }], settings: { tellerName: 'Iron Man' }, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '', sensorNote: word });
  assert(r.messages[r.messages.length - 1].content.startsWith('Iron Man — that last page gave him'), 'and rides the closing words in his voice');
  /* the two asks that used to send a page back are gone, and so is the wire that carried it */
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(!/mineWire|mineCarried|mineRetried/.test(chat), 'nothing carries a landed page back to the model any more');
  eq(askAgain('mine', {}), askAgain('anything else', {}), 'and the ask for it is gone from his voice');
  assert(/ran out of room while you were still planning/.test(askAgain('fresh', {})), 'what is left asks only for a page that never arrived');
});

test('M358-1 THE GROUNDING PHRASE opens its thinking, in his voice and in the thinking itself — and empty is nothing at all', () => {
  eq(groundingOf({ groundingPhrase: '  Autobots,   roll out!  ' }), 'Autobots, roll out!', 'kept as he typed it, tidied');
  eq(groundingOf({}), '', 'and nothing when it is empty');
  const voice = voiceOf({ tellerName: 'Optimus Prime', writerName: 'Bruce', groundingPhrase: 'Autobots, roll out!' });
  eq(voice.grounding, 'Autobots, roll out!', 'it rides with the two names');
  const line = groundingLine(voice);
  eq(line, 'Optimus Prime — open your thinking with “Autobots, roll out!”, the way you always do, and then think however you like.', line);
  assert(!/format|paragraph|header|template|assistant/i.test(line), 'and says nothing about the page or what it is');
  eq(groundingLine(voiceOf({ tellerName: 'Optimus Prime' })), '', 'empty: not one word');
  eq(groundingSeed({ groundingPhrase: 'Autobots, roll out!' }), '<think>Autobots, roll out! ', 'the thinking itself is seeded with it');
  eq(groundingSeed({}), '', 'empty: no seed');
  const on = buildRequest({ story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }], settings: { tellerName: 'Optimus Prime', groundingPhrase: 'Autobots, roll out!' }, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '' });
  assert(on.messages[on.messages.length - 1].content.startsWith('Optimus Prime — open your thinking with'), 'it rides the closing words');
  const off = buildRequest({ story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }], settings: { tellerName: 'Optimus Prime' }, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '' });
  assert(!/open your thinking/i.test(JSON.stringify(off.messages) + JSON.stringify(off.systemBlocks)), 'with the box empty, the turn is what it was');
});

test('M358-2 HIS OWN PREFILL ALWAYS WINS, and an out-of-character turn takes neither', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const at = chat.indexOf('const grounding = ooc ? \'\' : groundingSeed(settingsValues);');
  assert(at > 0, 'the seed is made only for a page of the story');
  const near = chat.slice(at, at + 1200); /* M369 put the model's memory of a seed that did not take between them */
  assert(/!String\(connection\.prefill \|\| ''\)\.trim\(\)/.test(near), 'and only where he has set no prefill of his own');
  assert(/\.\.\.\(ooc \? \{ prefill: '' \} : \{\}\)/.test(near), 'an out-of-character turn keeps its empty prefill');
});
