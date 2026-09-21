/* M382: his screenshot — "#story" sent, and the thread (and the storyteller) got "A new tale — you choose it." M379 sent
 * shortcuts "as typed" from a `typed` field the store never kept. These laws go THROUGH THE REAL STORE, which is what
 * M379's own laws failed to do. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { repairStoryPlaceholder, STORY_PLACEHOLDER } from '../../js/ui/placeholder.js';

const wireOf = async (storyId) => {
  const messages = await db.messages.list(storyId);
  return buildRequest({ story: { brief: '' }, messages, settings: {}, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 1000000 }, directive: '', directorNote: '', editorEye: '', ruling: '' }).messages;
};

test('M382-1 WHAT HE TYPED SURVIVES THE STORE, and is what the storyteller is sent — a hidden shortcut included', async () => {
  const st = await db.stories.create({ title: 'typed, kept' });
  await db.messages.append(st.id, { role: 'user', text: 'continue', hidden: true, typed: '#continue' });
  const kept = (await db.messages.list(st.id))[0];
  eq(kept.typed, '#continue', 'the store keeps it');
  const wire = await wireOf(st.id);
  eq(wire[wire.length - 1].content, '#continue', 'and the storyteller is sent it');
});

test('M382-2 THE PLACEHOLDER SAVED BETWEEN m379 AND m381 IS PUT BACK TO WHAT HE TYPED — once, exactly, nothing else touched', async () => {
  const st = await db.stories.create({ title: 'the placeholder' });
  await db.messages.append(st.id, { role: 'user', text: STORY_PLACEHOLDER });
  await db.messages.append(st.id, { role: 'assistant', text: 'A page that happens to say: ' + STORY_PLACEHOLDER });
  await db.messages.append(st.id, { role: 'user', text: 'A new tale — you choose it, I said.' });
  const fixed = await repairStoryPlaceholder({ force: true });
  assert(fixed >= 1, 'it found it: ' + fixed);
  const pages = await db.messages.list(st.id);
  eq(pages[0].text, '#story', 'his page says what he typed');
  eq(pages[1].text, 'A page that happens to say: ' + STORY_PLACEHOLDER, 'a storyteller page is never touched');
  eq(pages[2].text, 'A new tale — you choose it, I said.', 'nor words that merely look like it');
  const wire = await wireOf(st.id);
  eq(wire[0].content, '#story', 'and the storyteller is sent "#story"');
  eq(await repairStoryPlaceholder(), 0, 'and it runs once');
});
