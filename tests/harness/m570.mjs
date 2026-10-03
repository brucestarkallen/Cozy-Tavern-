/* Cozy Tavern — harness laws of M570: the ledger's own pages shared between checkpoints (his book outgrew the device:
 * 180 whole copies of the ledger). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
const exportStory = (id) => db.exportStory(id);
import { emptyState, snapshotState, loadSnapshots, saveSnapshots, saveOneVersion, loadVersionStates, shareCheckpoints, CKPT_SHARED_KEY } from '../../js/engine/state.js';

const person = (i, page) => ({ core: 'person ' + i + ' ' + 'c'.repeat(300), state: 'at page ' + (i === 0 ? page : 0) + ' ' + 's'.repeat(150), arc: 'a'.repeat(200), threads: ['owes a favour ' + i], knows: [] });
function ledgerAt(page, people = 60) {
  const st = { ...emptyState(), page, journalSeq: page };
  st.characters = {}; st.relationships = {};
  for (let i = 0; i < people; i += 1) { st.characters['Person ' + i] = person(i, page); st.relationships['Person ' + i] = { p: i % 10, r: 2, s: 0, history: ['h'.repeat(80)] }; }
  st.threads = [{ title: 'the rematch', owner: 'Person 1', next: 'page ' + page }];
  return st;
}
const bankSize = async (sid) => { const base = await db.settings.get('ckptBank:' + sid); let p = Object.keys((base && base.p) || {}).length; for (const n of (base && base.parts) || []) { const part = await db.settings.get('ckptBankPart:' + n + ':' + sid); p += Object.keys((part && part.p) || {}).length; } return p; };

test('M570-1 A CHECKPOINT HANDED BACK IS THE WHOLE LEDGER IT WAS — every person, every standing, the threads, exactly; and a person who did not change between pages is stored ONCE in the tale, not once per checkpoint', async () => {
  const sid = 'st-570a';
  await db.stories.create({ id: sid, title: 't' }).catch(() => {});
  for (let page = 1; page <= 30; page += 1) await snapshotState(sid, 'turn-' + page, ledgerAt(page));
  const list = await loadSnapshots(sid);
  eq(list.length, 30);
  const back = list[17].snap;
  const want = ledgerAt(18);
  eq(JSON.stringify(back.characters), JSON.stringify(want.characters), 'every person exactly');
  eq(JSON.stringify(back.relationships), JSON.stringify(want.relationships), 'every standing exactly');
  eq(JSON.stringify(back.threads), JSON.stringify(want.threads), 'the threads exactly');
  const p = await bankSize(sid);
  /* Person 0 changes every page (30 versions), 59 others never (59), standings 60, threads 30: 179 — not 30 x 121 */
  assert(p <= 200, 'stored once per change: ' + p + ' entries for 30 checkpoints of 120 entries');
  const row = await db.settings.get('snap:turn-17:' + sid);
  assert(row.slim === 3 && row.pk && row.pk.characters && !row.characters, 'the row holds names and keys, not the pages');
});

test('M570-2 A PAGE THE BANK HAS LOST NEVER BECOMES A LEDGER WITH A HOLE — that checkpoint is left out, the others stand; the fold falls to the nearest other, as for a lost journal entry', async () => {
  const sid = 'st-570b';
  await db.stories.create({ id: sid, title: 't' }).catch(() => {});
  for (let page = 1; page <= 5; page += 1) await snapshotState(sid, 'turn-' + page, ledgerAt(page, 5));
  const row = await db.settings.get('snap:turn-3:' + sid);
  const lostKey = row.pk.characters['Person 0'];
  const base = await db.settings.get('ckptBank:' + sid);
  if (base.p && base.p[lostKey]) { delete base.p[lostKey]; await db.settings.set('ckptBank:' + sid, base); }
  for (const n of base.parts || []) { const part = await db.settings.get('ckptBankPart:' + n + ':' + sid); if (part && part.p && part.p[lostKey]) { delete part.p[lostKey]; await db.settings.set('ckptBankPart:' + n + ':' + sid, part); } }
  const { forgetBankCache } = await import('../../js/engine/state.js');
  forgetBankCache(sid);
  const list = await loadSnapshots(sid);
  assert(!list.some((e) => e.id === 'turn-3'), 'the holed checkpoint is left out');
  eq(list.length, 4, 'the others stand');
  assert(list.every((e) => Object.keys(e.snap.characters).length === 5), 'each whole');
});

test('M570-3 A TALE STORED BEFORE IS SHARED ONCE WHEN OPENED — its book shrinks, every checkpoint and version ledger still hands back the same ledger, and a second open does nothing', async () => {
  const sid = (await db.stories.create({ title: 'the long war' })).id;
  /* rows as an older build wrote them: slim 2, every page whole in every row */
  const index = [];
  for (let page = 1; page <= 40; page += 1) {
    const { journal, log, ...rest } = ledgerAt(page);
    await db.settings.set('snap:t' + page + ':' + sid, { ...rest, slim: 2, jk: [], lk: [] });
    index.push({ id: 't' + page, at: page, page, seq: page });
  }
  await db.settings.set('snapshots:' + sid, index);
  const keys = [];
  for (let v = 1; v <= 20; v += 1) { const { journal, log, ...rest } = ledgerAt(v); await db.settings.set('ver:m' + v + ':0:' + sid, { ...rest, slim: 2, jk: [], lk: [] }); keys.push('m' + v + ':0'); }
  await db.settings.set('versionState:' + sid, keys);
  const before = (await exportStory(sid)).length;
  const did = await shareCheckpoints(sid);
  assert(did, 'shared');
  const after = (await exportStory(sid)).length;
  assert(after < before / 4, 'the book shrank: ' + Math.round(before / 1024) + ' KB → ' + Math.round(after / 1024) + ' KB');
  const list = await loadSnapshots(sid);
  eq(list.length, 40);
  eq(JSON.stringify(list[24].snap.characters), JSON.stringify(ledgerAt(25).characters), 'a checkpoint hands back the same ledger');
  const vers = await loadVersionStates(sid);
  eq(Object.keys(vers).length, 20);
  eq(JSON.stringify(vers['m7:0'].relationships), JSON.stringify(ledgerAt(7).relationships), 'a version ledger too');
  eq(await db.settings.get(CKPT_SHARED_KEY(sid)), 1);
  eq(await shareCheckpoints(sid), false, 'once');
});

test('M570-4 THE SEND\'S CHECKPOINT IS TAKEN AT ONCE AND KEPT AFTER THE PAGE: its copy is the ledger at the moment it was called (a change after it is not in it), nothing is written until the page releases it, and then it is whole', async () => {
  const sid = 'st-570d';
  await snapshotState(sid, 'turn-1', ledgerAt(1, 8));
  const st = ledgerAt(2, 8);
  let go; const after = new Promise((r) => { go = r; });
  const keeping = snapshotState(sid, 'turn-2', st, { after });
  st.characters['Person 3'] = { core: 'CHANGED AFTER THE CALL' };
  await new Promise((r) => setTimeout(r, 30));
  assert(!(await db.settings.get('snap:turn-2:' + sid)), 'nothing written before the page releases it');
  go(); await keeping;
  const list = await loadSnapshots(sid);
  const two = list.find((e) => e.id === 'turn-2');
  assert(two, 'kept once released');
  eq(JSON.stringify(two.snap.characters), JSON.stringify(ledgerAt(2, 8).characters), 'the ledger as it was when the checkpoint was taken');
});
