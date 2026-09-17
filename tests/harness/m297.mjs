/* M297 — a brought-over chat keeps the file's order. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { parseSTChat, importAsStory } from '../../js/import/chats.js';
import { db } from '../../js/store.js';

test('M297-1: pages that share a send_date minute, and pages with none, keep the file’s order in the store (they used to sort by chance)', async () => {
  const same = '2024-06-05T22:23:00';
  const lines = [
    JSON.stringify({ user_name: 'Jovan', character_name: 'Rias', create_date: same, chat_metadata: {} }),
    JSON.stringify({ name: 'Jovan', is_user: true, mes: 'ONE — the question', send_date: same }),
    JSON.stringify({ name: 'Rias', is_user: false, mes: 'TWO — the answer', send_date: same }),
    JSON.stringify({ name: 'Jovan', is_user: true, mes: 'THREE — no date at all' }),
    JSON.stringify({ name: 'Rias', is_user: false, mes: 'FOUR — a numeric date', send_date: Date.parse(same) + 60000 }),
    JSON.stringify({ name: 'Jovan', is_user: true, mes: 'FIVE — an earlier date than the page before (a clock set back)', send_date: '2024-06-05T22:20:00' }),
  ].join('\n');
  const parsed = parseSTChat(lines);
  const ts = parsed.messages.map((m) => m.ts);
  for (let i = 1; i < ts.length; i += 1) assert(ts[i] > ts[i - 1], 'every page is stamped strictly after the one before: ' + ts.join(','));
  const storyId = await importAsStory(parsed);
  const order = (await db.messages.list(storyId)).map((m) => m.text.split(' ')[0]);
  eq(order.join(' '), 'ONE TWO THREE FOUR FIVE', 'the store lists them as the file had them');
});
