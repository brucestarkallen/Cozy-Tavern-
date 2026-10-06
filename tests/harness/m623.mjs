/* M623 — his: "why are there no settings to put it before or after the original notes persona? And where is the setting
 * to put it as a system or user message, for each of the notes, separate from the persona notes?" Laws BUILD the real
 * request and read back the messages after his. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';

const OPTS = () => ({ story: {}, messages: [{ role: 'user', text: 'I wait by the gate.' }], state: {}, modules: [], memory: '', window: { keeperOn: true } });
const after = (r) => { const at = r.messages.map((m) => m.content).lastIndexOf('I wait by the gate.'); return r.messages.slice(at + 1).map((m) => m.role + ': ' + m.content); };

test('M623-1 EACH NOTE IN ITS PLACE AND ITS ROLE — above or below his note, a system or a user message, or like the note at the end; neighbours of one role go as one message; the order is kept exactly', () => {
  const notes = [
    { id: 'house-cot', on: false },
    { id: 'a', on: true, text: 'NOTE A', place: 'above', role: 'system' },
    { id: 'b', on: true, text: 'NOTE B', place: 'above', role: 'user' },
    { id: 'c', on: true, text: 'NOTE C', place: 'below', role: '' },
  ];
  const r = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE', noteAdds: notes } });
  eq(after(r).join(' | '), 'system: NOTE A | user: NOTE B | system: MY NOTE\n\nNOTE C', 'A as system above, B as a user message above, his note, C below it like the note at the end');
  eq(r.receipt.slots.find((s) => s.name === 'The note at the end').source, 'your 2 notes above it, then the note for every story, then your note below it', 'the receipt says where each stands');
  const asUser = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE', afterRole: 'user', noteAdds: notes } });
  eq(after(asUser).join(' | '), 'system: NOTE A | user: NOTE B\n\nMY NOTE\n\nNOTE C', 'with the closing words sent as his: B, his note and C go as one user message; A keeps its system');
});

test('M623-2 THE HOUSE\u2019S THINKING NOTE CAN STAND BELOW HIS NOTE AND GO AS A USER MESSAGE — its own words, last of all', () => {
  const r = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE', noteAdds: [{ id: 'house-cot', on: true, place: 'below', role: 'user' }] } });
  const tail = r.messages.slice(-2);
  eq(tail[0].role + ': ' + tail[0].content, 'system: MY NOTE', 'his note');
  eq(tail[1].role, 'user', 'then the thinking note as a user message');
  assert(/^Before you write/.test(tail[1].content), 'its own words');
});
