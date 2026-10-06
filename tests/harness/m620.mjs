/* M620 — his: "add a new section on notes so I can just easily add notes and it'll append above it". Laws BUILD the real
 * request and read back the closing words the storyteller reads last. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';

const OPTS = () => ({ story: {}, messages: [{ role: 'user', text: 'I wait by the gate.' }], state: {}, modules: [], memory: '', window: { keeperOn: true } });
const ADDS = [{ id: 'a', on: true, text: 'Never write Jovan\u2019s words.' }, { id: 'b', on: false, text: 'HELD BACK' }, { id: 'c', on: true, text: 'End where Jovan can act.' }];

test('M620-1 HIS NOTES RIDE ABOVE HIS NOTE AT THE END — in the order he added them, the unticked one held back; the receipt says so', () => {
  const r = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE', noteAdds: ADDS } });
  const closing = r.messages[r.messages.length - 1].content;
  assert(closing.endsWith('Never write Jovan\u2019s words.\n\nEnd where Jovan can act.\n\nMY NOTE'), 'above his note, in his order, his note last: ' + JSON.stringify(closing.slice(-120)));
  assert(!closing.includes('HELD BACK'), 'an unticked note is not sent');
  const row = r.receipt.slots.find((s) => s.name === 'The note at the end');
  /* M622 moved this: the house's thinking note stands first by default — three notes above his */
  eq(row.source, 'your 3 notes above it, then the note for every story', 'the receipt names them');
});

test('M620-2 THEY RIDE ONLY WITH THE NOTE — switched off, none of them; with no note of his own they stand at the end alone; none added, the note is as it was', () => {
  const off = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE', noteOn: false, noteAdds: ADDS } });
  assert(!off.messages.some((m) => /Never write Jovan|End where Jovan|MY NOTE/.test(String(m.content))), 'note off: nothing of it');
  const alone = buildRequest({ ...OPTS(), settings: { noteAdds: ADDS } });
  assert(alone.messages[alone.messages.length - 1].content.endsWith('Never write Jovan\u2019s words.\n\nEnd where Jovan can act.'), 'no note of his own: his notes close the request');
  const plain = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE' } });
  assert(plain.messages[plain.messages.length - 1].content.endsWith('MY NOTE'), 'no notes added: his note last');
  /* M622 moved this: with nothing added, the house's thinking note alone stands above his note */
  eq(plain.receipt.slots.find((s) => s.name === 'The note at the end').source, 'your note above it, then the note for every story', 'and its receipt says so');
  const none = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE', noteAdds: [{ id: 'house-cot', on: false }] } });
  eq(none.receipt.slots.find((s) => s.name === 'The note at the end').source, 'for every story', 'the house note switched off: his note as it was');
});

test('M620-3 A VOICE PRESET KEEPS THE NOTES WITH THE NOTE — saved with it, put back with it', async () => {
  const { db } = await import('../../js/store.js');
  const { readVoice, savePreset, usePreset } = await import('../../js/engine/voicepresets.js');
  await db.settings.set('noteText', 'PRESET NOTE');
  await db.settings.set('noteAdds', [{ id: 'p1', on: true, text: 'kept with the preset' }]);
  const p = await savePreset('With notes', await readVoice());
  await db.settings.set('noteAdds', [{ id: 'x', on: true, text: 'changed after' }]);
  await usePreset(p.id);
  eq(((await db.settings.get('noteAdds')) || [])[0].text, 'kept with the preset', 'using the preset puts its notes back');
  await db.settings.delete('noteAdds'); await db.settings.delete('noteText');
});
