/* M437: a SillyTavern chat comes over with what SillyTavern kept of each page — the other versions of a reply (its
 * swipes), the shown one shown, and the thinking it kept — and its own dates. Runs the real parser, the real import into
 * the store, and reads the pages back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { parseSTChat, importAsStory } from '../../js/import/chats.js';
import { db } from '../../js/store.js';
import { pageText } from '../../js/assemble/stack.js';

test('M437-1 A SILLYTAVERN CHAT KEEPS ITS SWIPES, ITS KEPT THINKING AND ITS DATES', async () => {
  const lines = [
    JSON.stringify({ user_name: 'Jovan', character_name: 'Rias', chat_metadata: {} }),
    JSON.stringify({ name: 'Rias', is_user: false, mes: 'Hello — edited after.', swipes: ['Hi there.', 'Hello.', 'Evening.'], swipe_id: 1, send_date: 'June 1, 2024 3:04pm', extra: { reasoning: 'She is glad he came.' } }),
    JSON.stringify({ name: 'Jovan', is_user: true, mes: 'Hey.', send_date: 'June 1, 2024 3:05pm' }),
    JSON.stringify({ name: 'Rias', is_user: false, mes: 'Come in.', send_date: 'June 1, 2024 3:06pm' }),
  ].join('\n');
  const parsed = parseSTChat(lines);
  eq(parsed.messages[0].ts, Date.parse('June 1, 2024 3:04 pm'), 'SillyTavern\u2019s own date is read');
  const sid = await importAsStory(parsed);
  const pages = await db.messages.list(sid);
  eq(pages.length, 3, 'three pages');
  const first = pages[0];
  eq(first.swipes && first.swipes.length, 3, 'all three versions came');
  eq(first.swipeIdx, 1, 'the shown one shown');
  eq(pageText(first), 'Hello — edited after.', 'the shown words are the ones he had (his edit kept)');
  eq(first.swipes[0].text, 'Hi there.', 'the other versions as they were');
  eq(first.thinking, 'She is glad he came.', 'the kept thinking rides the page');
  eq(pageText(pages[2]), 'Come in.', 'a page with one version is a plain page');
  assert(!pages[2].swipes, 'with no versions list');
  assert(pages[0].ts < pages[1].ts && pages[1].ts < pages[2].ts, 'in the file\u2019s order');
});
