/* M357: what the house saw in a page is said BEFORE the next one — never by sending that page back (the writer: "that's
 * breaking immersion"); the page's furniture (the header, any bracketed row) is never read as prose.
 * M358: THE GROUNDING PHRASE — the first words of the teller's own thinking, so its voice starts in character. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { db } from '../../js/store.js';
import { stripFurniture, staleLeak, mineLeak, mineWord, staleWord } from '../../js/assemble/plain.js';
import { voiceOf, groundingOf, groundingLine, groundingSeed } from '../../js/assemble/voice.js';
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
});

test('M358-1 (as M375 changed it) THE GROUNDING PHRASE lives in who the teller is and, where the provider truly continues a thought, in the thought itself — never as an order at the end; empty is nothing at all', () => {
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
  /* M375: no line at the end about the thinking any more — that order is what a teller narrates in an assistant's voice */
  const on = buildRequest({ story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }], settings: { tellerName: 'Optimus Prime', groundingPhrase: 'Autobots, roll out!', frameText: 'You are Optimus Prime.\n\nYou tell it in close third.\n\nA third paragraph with a middle of its own.\n\nA fourth.' }, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '' });
  const closing = on.messages.filter((m) => m.role === 'user').slice(-1)[0].content;
  assert(!/open your thinking/i.test(closing), 'no order about the thinking at the end: ' + closing.slice(0, 80));
  assert(/You open every thought with “Autobots, roll out!”/.test(JSON.stringify(on.systemBlocks)), 'the phrase lives in who the teller is');
  const off = buildRequest({ story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }], settings: { tellerName: 'Optimus Prime' }, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '' });
  assert(!/open your thinking|open every thought/i.test(JSON.stringify(off.messages) + JSON.stringify(off.systemBlocks)), 'with the box empty, the turn is what it was');
});

test('M358-2 (as M371 widened it) HIS OWN PREFILL WINS ON A PAGE OF THE STORY, and an out-of-character turn takes the grounding phrase — never his story prefill', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const at = chat.indexOf('const grounding = groundingSeed(settingsValues);');
  assert(at > 0, 'the phrase is made for every turn, in character or out of it');
  const near = chat.slice(at, at + 600);
  assert(/const seeded = grounding && \(ooc \|\| !ownPrefill\)/.test(near), 'planted where he has set no prefill, and on every out-of-character turn');
  assert(/\.\.\.\(ooc \? \{ prefill: seeded\.prefill \|\| '' \} : \{\}\)/.test(near), 'an out-of-character turn carries the phrase and never his story prefill');
});
