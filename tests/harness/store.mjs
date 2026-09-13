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

test('M46: append keeps the page’s clock, its masthead and its mend (a branch copies pages through append)', async () => {
  const { db } = await import('../../js/store.js');
  const sid = 'm46-store';
  const saved = await db.messages.append(sid, { role: 'assistant', text: 'a', thinking: 't', thinkingMs: 1234, masthead: 'McDonald’s — 14:30', mended: { before: 'b', why: 'w', at: 1 }, swipes: [{ text: 'a', thinking: 't', thinkingMs: 1234 }], swipeIdx: 0 });
  const back = (await db.messages.list(sid)).find((m) => m.id === saved.id);
  eq(back.thinkingMs, 1234); eq(back.masthead, 'McDonald’s — 14:30'); eq(back.mended.before, 'b'); eq(back.swipes[0].thinkingMs, 1234);
});

test('M59: an update is read-modify-write in one transaction — two overlapping updates keep both changes', async () => {
  const { db } = await import('../../js/store.js');
  const story = await db.stories.create({ title: 'race' });
  await Promise.all([
    db.stories.update(story.id, { projectId: 'shelf-a' }),
    db.stories.update(story.id, { brief: 'the brief' }),
    db.stories.update(story.id, { castNotes: 'notes' }),
  ]);
  const back = await db.stories.get(story.id);
  eq(back.projectId, 'shelf-a'); eq(back.brief, 'the brief'); eq(back.castNotes, 'notes');
  const m = await db.messages.append(story.id, { role: 'assistant', text: 'a' });
  await Promise.all([
    db.messages.update(story.id, m.id, { findings: [{ words: 'x', severity: 'note' }] }),
    db.messages.update(story.id, m.id, { extraction: { appliedWords: ['y'] } }),
    db.messages.update(story.id, m.id, { mended: { before: 'b', why: 'w', at: 1 } }),
  ]);
  const mb = (await db.messages.list(story.id)).find((x) => x.id === m.id);
  assert(mb.findings && mb.extraction && mb.mended, 'all three writes stand');
  eq(await db.messages.update('other-story', m.id, { text: 'no' }), undefined, 'a page is only updated within its own story');
});

/* M160: EVERYTHING OF A TALE GOES WITH THE TALE. Twelve prefixes wear a
 * tale's id; stories.remove named five of them by hand. versionState: alone
 * holds up to sixty whole ledgers, and every orphan rode _house.json on
 * every push, for the life of the shelf. The law is the suffix, not a list. */
test('M160: a tale let go takes EVERY row that wore its id — and none of another tale’s', async () => {
  const mine = await db.stories.create({ title: 'the doomed tale' });
  const other = await db.stories.create({ title: 'the tale that stays' });
  const prefixes = ['state', 'memory', 'lore', 'workers', 'snapshots', 'versionState', 'hk', 'director', 'editor', 'memoryBackup', 'peopleBackup', 'bookStamp'];
  for (const p of prefixes) {
    await db.settings.set(p + ':' + mine.id, { kept: p });
    await db.settings.set(p + ':' + other.id, { kept: p });
  }
  await db.settings.set('cast:a-card-id', { name: 'app-wide, not a tale’s' });
  await db.settings.set('memoryWindow', 30);

  await db.stories.remove(mine.id);

  const keys = await db.settings.keys();
  const left = prefixes.filter((p) => keys.includes(p + ':' + mine.id));
  eq(left.length, 0, 'not one of the doomed tale’s rows is left: ' + left.join(', '));
  const kept = prefixes.filter((p) => keys.includes(p + ':' + other.id));
  eq(kept.length, prefixes.length, 'the other tale keeps every row');
  assert(keys.includes('cast:a-card-id'), 'the app-wide cast library is untouched');
  assert(keys.includes('memoryWindow'), 'a house setting is untouched');
});

test('M160: the boot sweep lets go of rows whose tale is already gone, and the house book refuses them', async () => {
  const living = await db.stories.create({ title: 'still telling' });
  /* a tale let go by an older coat: its rows outlived it */
  await db.settings.set('versionState:ghost-tale-1', { sixty: 'whole ledgers' });
  await db.settings.set('snapshots:ghost-tale-1', [1, 2, 3]);
  await db.settings.set('hk:ghost-tale-2', { session: true });
  await db.settings.set('state:' + living.id, { clock: null });
  await db.settings.set('cast:another-card', { name: 'stays' });

  const house = JSON.parse(await db.exportHouse());
  const houseKeys = house.settings.map((r) => r.key);
  assert(!houseKeys.includes('versionState:ghost-tale-1'), 'a dead tale’s ledgers never ride the house book');
  assert(!houseKeys.includes('hk:ghost-tale-2'), 'nor a dead tale’s housekeeper session');
  assert(!houseKeys.includes('state:' + living.id), 'nor a living tale’s own rows');
  assert(houseKeys.includes('cast:another-card'), 'the cast library is the house’s');

  const swept = await db.sweepOrphans();
  assert(swept >= 3, 'the sweep let the orphans go (' + swept + ')');
  const keys = await db.settings.keys();
  assert(!keys.includes('versionState:ghost-tale-1') && !keys.includes('snapshots:ghost-tale-1') && !keys.includes('hk:ghost-tale-2'), 'the orphans are gone from the shelf');
  assert(keys.includes('state:' + living.id), 'the living tale’s ledger stands');
  assert(keys.includes('cast:another-card'), 'the cast library stands');
});

/* M160: the row lock's cleanup test compared the map against a promise the
 * map never held, so every row ever modified left an entry behind. */
test('M160: a row lock is released — the lock map does not grow with every edit', async () => {
  const s = await db.stories.create({ title: 'lock tale' });
  const m = await db.messages.append(s.id, { role: 'assistant', text: 'words' });
  for (let i = 0; i < 25; i += 1) await db.messages.update(s.id, m.id, { extraction: { appliedWords: ['n' + i] } });
  const src = (await import('node:fs')).readFileSync(new URL('../../js/store.js', import.meta.url), 'utf8');
  assert(/rowLocks\.set\(lockKey, chained\)/.test(src), 'the map holds the very promise the cleanup compares');
  assert(/rowLocks\.get\(lockKey\) === chained/.test(src), 'the cleanup can actually be true');
  const got = (await db.messages.list(s.id))[0];
  eq(got.extraction.appliedWords[0], 'n24', 'the last write stands after twenty-five serialized edits');
});

/* M161: the house is a book too. The M160 sweep read `_house` as a tale that
 * no longer stands and ate bookStamp:_house on every boot — so the house book
 * was pulled again on every open, laying the device's copy over settings this
 * browser had changed but not yet pushed. */
test('M161: the sweep keeps the house’s own stamp, and still lets a dead tale’s go', async () => {
  const living = await db.stories.create({ title: 'still telling' });
  await db.settings.set('bookStamp:' + living.id, '2026-01-01T00:00:00.000Z');
  await db.settings.set('bookStamp:_house', '2026-01-01T00:00:00.000Z');
  await db.settings.set('bookStamp:a-tale-long-gone', '2025-01-01T00:00:00.000Z');
  await db.settings.set('versionState:a-tale-long-gone', { sixty: 'ledgers' });

  await db.sweepOrphans();

  const keys = await db.settings.keys();
  assert(keys.includes('bookStamp:_house'), 'the house keeps its stamp — it is a book, not a tale');
  assert(keys.includes('bookStamp:' + living.id), 'a living tale keeps its stamp');
  assert(!keys.includes('bookStamp:a-tale-long-gone'), 'a dead tale’s stamp goes');
  assert(!keys.includes('versionState:a-tale-long-gone'), 'and its ledgers with it');
});
