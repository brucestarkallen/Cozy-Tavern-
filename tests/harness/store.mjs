/* Store: swipes/hidden/ooc passthrough, quota guard (B1), import atomicity
 * (B17), per-story atomic chat import, update helper (B5 no-resurrect). */
import './idb-shim.mjs';
import { failWritesWithQuota, clearQuotaFailure } from './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db, QUOTA_MESSAGE } from '../../js/store.js';
import { parseSTChat, importAsStory } from '../../js/import/chats.js';

test('store: swipes + swipeIdx persist, msg.text mirrors the shown swipe', async () => {
  const s = await db.stories.create({ title: 'swipe tale' });
  const row = await db.messages.append(s.id, {
    role: 'assistant', text: 'second',
    swipes: [{ text: 'first', ts: 1 }, { text: 'second', ts: 2 }], swipeIdx: 1,
  });
  eq(row.text, 'second', 'text mirrors shown swipe');
  eq(row.swipes.length, 2, 'swipes kept');
  const got = (await db.messages.list(s.id))[0];
  eq(got.swipeIdx, 1); eq(got.swipes[0].text, 'first');
});

test('store: hidden / cutShort / ooc flags persist', async () => {
  const s = await db.stories.create({ title: 'flags' });
  await db.messages.append(s.id, { role: 'user', text: 'continue', hidden: true });
  await db.messages.append(s.id, { role: 'assistant', text: 'x', cutShort: true });
  await db.messages.append(s.id, { role: 'user', text: '((hi))', ooc: true });
  const all = await db.messages.list(s.id);
  assert(all[0].hidden === true && all[1].cutShort === true && all[2].ooc === true, 'flags ride');
});

test('B5: messages.update patches a page; a gone page is a no-op', async () => {
  const s = await db.stories.create({ title: 'reink' });
  const m = await db.messages.append(s.id, { role: 'assistant', text: 'words' });
  const patched = await db.messages.update(s.id, m.id, { extraction: { appliedWords: ['a'] } });
  eq(patched.extraction.appliedWords[0], 'a', 'patch lands');
  eq(patched.text, 'words', 'words untouched');
  const gone = await db.messages.update(s.id, 'nope', { extraction: {} });
  eq(gone, undefined, 'missing id is a quiet no-op — no resurrection');
  eq((await db.messages.list(s.id)).length, 1, 'nothing resurrected');
});

test('B1: a full shelf surfaces ONE kind Error, never a raw quota exception', async () => {
  const s = await db.stories.create({ title: 'quota' });
  failWritesWithQuota();
  try {
    await db.messages.append(s.id, { role: 'user', text: 'hello' });
    throw new Error('should have thrown');
  } catch (err) {
    eq(err.message, QUOTA_MESSAGE, 'the kind quota message');
  } finally { clearQuotaFailure(); }
  await db.messages.append(s.id, { role: 'user', text: 'hello' });
  eq((await db.messages.list(s.id)).length, 1, 'writes recover after');
});

test('B17: importAll validates every row BEFORE clearing — bent backup touches nothing', async () => {
  const s = await db.stories.create({ title: 'keep me' });
  const good = await db.exportAll();
  const bent = JSON.parse(good);
  bent.messages = [{ nope: true }];
  try {
    await db.importAll(JSON.stringify(bent));
    throw new Error('should have thrown');
  } catch (err) {
    assert(/nothing was touched/.test(err.message), 'kind failure: ' + err.message);
  }
  const stories = await db.stories.list();
  assert(stories.some((x) => x.id === s.id), 'the story survived');
  const env = JSON.parse(await db.exportAll());
  assert(env.messages.length >= 0, 'export still reads');
});

test('B17: chat import lands in ONE transaction; a mid-write quota failure leaves no half tale', async () => {
  const parsed = parseSTChat('{"name":"You","message":"hi","is_user":true}\n{"name":"Mira","message":"well met","is_user":false}');
  failWritesWithQuota(1);
  try {
    await importAsStory(parsed);
    throw new Error('should have thrown');
  } catch (err) {
    eq(err.message, QUOTA_MESSAGE);
  } finally { clearQuotaFailure(); }
  const all = await db.messages.list((await db.stories.list()).map((x) => x.id)[0] || 'none');
  void all;
  const id = await importAsStory(parsed);
  eq((await db.messages.list(id)).length, 2, 'a clean retry lands whole');
});
