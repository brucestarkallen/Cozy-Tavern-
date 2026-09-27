/* M507 — THE CHECKPOINTS, ONE TO A ROW; THE BANK IN PARTS. Written through the real store and read back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState, snapshotState, loadSnapshots, saveSnapshots, restoreSnapshot, SNAP_CAP } from '../../js/engine/state.js';

const canon = (s) => JSON.stringify(s, Object.keys(s).sort());
function tale(sid, pages) {
  return (async () => {
    let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the kitchen' }]).state;
    await saveState(sid, st);
    const wholes = [];
    for (let i = 0; i < pages; i += 1) {
      st.page = i;
      await snapshotState(sid, 'u' + i, st);
      wholes.push(JSON.parse(JSON.stringify(st)));
      st = applyMutations(st, [{ type: 'presence.enter', name: 'Person' + i + ' Vale' }, { type: 'people.set', name: 'Person' + i + ' Vale', field: 'core', text: 'someone of the house, met on page ' + i }]).state;
      await saveState(sid, st);
    }
    return { st, wholes };
  })();
}

test('M507-1 a send writes ONE checkpoint row and the small index — every stored row is a slim ledger, and every checkpoint comes back whole', async () => {
  const sid = 'm507-rows';
  const { wholes } = await tale(sid, 8);
  const keys = (await db.settings.keys()).filter((k) => k.endsWith(':' + sid));
  const rows = keys.filter((k) => k.startsWith('snap:'));
  eq(rows.length, 8, 'one row per checkpoint: ' + keys.join(', '));
  const index = await db.settings.get('snapshots:' + sid);
  eq(index.length, 8);
  assert(index.every((e) => !('snap' in e) && typeof e.id === 'string' && Number.isInteger(e.page) && Number.isFinite(e.at)), 'the index carries names, pages and times — never a ledger');
  for (const k of rows) { const r = await db.settings.get(k); assert(r.slim === 2 && !('journal' in r) && !('log' in r) && Array.isArray(r.jk), 'a slim ledger: ' + k); }
  const back = await loadSnapshots(sid);
  eq(back.length, 8);
  for (let i = 0; i < 8; i += 1) eq(canon(back[i].snap), canon(wholes[i]), 'checkpoint ' + i + ' comes back whole, journal and log included');
  /* the newest write touched one row: writing a ninth changes no older row */
  const before = new Map(); for (const k of rows) before.set(k, JSON.stringify(await db.settings.get(k)));
  const st = await loadState(sid); st.page = 8;
  await snapshotState(sid, 'u8', st);
  for (const [k, v] of before) eq(JSON.stringify(await db.settings.get(k)), v, 'an older row is untouched by a new checkpoint: ' + k);
  assert(await db.settings.get('snap:u8:' + sid), 'the new row stands');
});

test('M507-2 a row written whole before M507 (the list under snapshots:<tale>) reads as it is and moves to its own rows at the next send; the cap and the sparse retention still hold', async () => {
  const sid = 'm507-legacy';
  let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Liara' }]).state;
  await saveState(sid, st);
  const legacy = [];
  for (let i = 0; i < 3; i += 1) { st = applyMutations(st, [{ type: 'presence.enter', name: 'Old' + i }]).state; st.page = i; legacy.push({ id: 'old' + i, snap: JSON.parse(JSON.stringify(st)), at: i }); }
  await db.settings.set('snapshots:' + sid, legacy);
  const read = await loadSnapshots(sid);
  eq(read.map((e) => e.id).join(','), 'old0,old1,old2', 'read as it was');
  eq(canon(read[2].snap), canon(legacy[2].snap));
  st.page = 3;
  await snapshotState(sid, 'u3', st);
  const index = await db.settings.get('snapshots:' + sid);
  eq(index.map((e) => e.id).join(','), 'old0,old1,old2,u3', 'the old ones and the new, in order');
  assert(index.every((e) => !('snap' in e)), 'the index holds no ledger any more');
  for (const e of index) assert((await db.settings.get('snap:' + e.id + ':' + sid)).slim === 2, 'each in its own row: ' + e.id);
  eq(canon((await loadSnapshots(sid))[1].snap), canon(legacy[1].snap), 'an old checkpoint is the ledger it was');
  /* the cap */
  for (let i = 4; i < SNAP_CAP + 8; i += 1) { st.page = i; await snapshotState(sid, 'u' + i, st); }
  const many = await db.settings.get('snapshots:' + sid);
  assert(many.length <= SNAP_CAP && many.length >= 40, 'within the cap: ' + many.length);
  eq(many[many.length - 1].id, 'u' + (SNAP_CAP + 7), 'the newest kept');
  const rows = (await db.settings.keys()).filter((k) => k.startsWith('snap:') && k.endsWith(':' + sid));
  eq(rows.length, many.length, 'a pruned checkpoint takes its row with it');
});

test('M507-3 the bank in parts: a send appends its few entries to the newest part and never rewrites the base row; the whole bank still hands every checkpoint back', async () => {
  const sid = 'm507-bank';
  const { wholes } = await tale(sid, 6);
  const base = await db.settings.get('ckptBank:' + sid);
  const parts = (await db.settings.keys()).filter((k) => k.startsWith('ckptBankPart:') && k.endsWith(':' + sid));
  /* a young tale keeps everything in the base row until it fills */
  assert(base && base.j && Object.keys(base.j).length > 0 && Array.isArray(base.parts) && parts.length === base.parts.length, 'the base row lists its parts');
  /* a base row already full (a store from before M507 at its cap) is never rewritten again: the next entries go to a part */
  const big = { j: {}, l: {}, parts: [] };
  for (let i = 0; i < 1300; i += 1) big.j['fill' + i] = { id: i, p: 0, m: { type: 'noop' } };
  await db.settings.set('ckptBank:' + sid, big);
  const { forgetBankCache } = await import('../../js/engine/state.js'); forgetBankCache(sid);
  const st = await loadState(sid); st.page = 6;
  await snapshotState(sid, 'u6', st);
  const after = await db.settings.get('ckptBank:' + sid);
  eq(Object.keys(after.j).length, 1300, 'the full base row keeps exactly its entries');
  eq(after.parts.length, 1, 'and names one part');
  const part = await db.settings.get('ckptBankPart:1:' + sid);
  assert(part && Object.keys(part.j).length > 0, 'the new entries went to the part');
  const back = await loadSnapshots(sid);
  for (let i = 0; i < 6; i += 1) eq(canon(back[i].snap), canon(wholes[i]), 'checkpoint ' + i + ' whole, from base and part together');
  eq(back[6].snap.journal.length, st.journal.length, 'the newest, its journal from the part');
});

test('M507-4 a rewind drops the newer checkpoints, writes the index and deletes their rows — and rewrites no row it did not change', async () => {
  const sid = 'm507-rewind';
  await tale(sid, 6);
  const rowsBefore = new Map();
  for (const k of (await db.settings.keys()).filter((k) => k.startsWith('snap:') && k.endsWith(':' + sid))) rowsBefore.set(k, JSON.stringify(await db.settings.get(k)));
  let writes = 0; const realSet = db.settings.set; db.settings.set = async function (key, val) { if (String(key).startsWith('snap:')) writes += 1; return realSet.call(this, key, val); };
  try { await restoreSnapshot(sid, 'u3'); } finally { db.settings.set = realSet; }
  eq(writes, 0, 'no checkpoint row rewritten by a rewind');
  const index = await db.settings.get('snapshots:' + sid);
  eq(index.map((e) => e.id).join(','), 'u0,u1,u2,u3', 'the boundary keeps, the newer drop');
  const rows = (await db.settings.keys()).filter((k) => k.startsWith('snap:') && k.endsWith(':' + sid));
  eq(rows.sort().join(','), ['u0', 'u1', 'u2', 'u3'].map((u) => 'snap:' + u + ':' + sid).sort().join(','), 'the dropped ones took their rows with them');
  for (const k of rows) eq(JSON.stringify(await db.settings.get(k)), rowsBefore.get(k), 'a kept row is byte for byte what it was: ' + k);
  const st = await loadState(sid);
  eq(st.present.map((p) => p.name).join(','), 'Person0 Vale,Person1 Vale,Person2 Vale', 'the ledger is the boundary before the fourth page');
});

test('M507-6 the end of a page keeps ONE version ledger in its own row: the newest sixty stand, the sixty-first drops with its row, every ledger comes back whole, and a row written whole before (the map of sixty) moves to its own rows at the next write', async () => {
  const { saveOneVersion, versionStateOf, loadVersionStates, saveVersionStates } = await import('../../js/engine/state.js');
  const sid = 'm507-versions';
  let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the hall' }]).state;
  await saveState(sid, st);
  const wholes = {};
  for (let i = 0; i < 64; i += 1) {
    st.page = i;
    st = applyMutations(st, [{ type: 'presence.enter', name: 'Voice' + i + ' Adair' }]).state;
    await saveOneVersion(sid, 'm' + i + ':0', st);
    wholes['m' + i + ':0'] = JSON.parse(JSON.stringify(st));
  }
  const index = await db.settings.get('versionState:' + sid);
  assert(Array.isArray(index) && index.length === 60 && index[0] === 'm4:0' && index[59] === 'm63:0', 'the newest sixty, in order: ' + index[0] + ' … ' + index[59]);
  const rows = (await db.settings.keys()).filter((k) => k.startsWith('ver:') && k.endsWith(':' + sid));
  eq(rows.length, 60, 'sixty rows, the dropped four gone with theirs');
  assert(!(await db.settings.get('ver:m0:0:' + sid)) && !(await db.settings.get('ver:m3:0:' + sid)), 'the oldest rows are gone');
  for (const k of ['m4:0', 'm40:0', 'm63:0']) eq(canon(await versionStateOf(sid, k)), canon(wholes[k]), 'whole, journal and log included: ' + k);
  eq(await versionStateOf(sid, 'm2:0'), null, 'a dropped version is not there');
  const all = await loadVersionStates(sid);
  eq(Object.keys(all).length, 60);
  eq(canon(all['m30:0']), canon(wholes['m30:0']));
  /* writing one more touches ONE new row and no older one */
  const before = new Map(); for (const k of rows) before.set(k, JSON.stringify(await db.settings.get(k)));
  let writes = 0; const realSet = db.settings.set; db.settings.set = async function (key, val) { if (String(key).startsWith('ver:')) writes += 1; return realSet.call(this, key, val); };
  try { st.page = 64; await saveOneVersion(sid, 'm64:0', st); } finally { db.settings.set = realSet; }
  eq(writes, 1, 'one version row written');
  for (const [k, v] of before) { const now = await db.settings.get(k); if (now) eq(JSON.stringify(now), v, 'an older row untouched: ' + k); }
  /* the whole-map door: a version let go (a page deleted) takes its row, the others are not rewritten */
  const kept = await loadVersionStates(sid);
  delete kept['m64:0']; delete kept['m63:0'];
  writes = 0; db.settings.set = async function (key, val) { if (String(key).startsWith('ver:')) writes += 1; return realSet.call(this, key, val); };
  try { await saveVersionStates(sid, kept); } finally { db.settings.set = realSet; }
  eq(writes, 0, 'letting two go rewrites nothing');
  assert(!(await db.settings.get('ver:m64:0:' + sid)) && !(await db.settings.get('ver:m63:0:' + sid)), 'their rows are gone');
  eq((await db.settings.get('versionState:' + sid)).length, 58);
  /* a legacy map moves to rows at the next write */
  const lid = 'm507-versions-legacy';
  await saveState(lid, st);
  const legacy = {}; for (let i = 0; i < 3; i += 1) legacy['L' + i + ':0'] = JSON.parse(JSON.stringify(wholes['m' + (10 + i) + ':0']));
  await db.settings.set('versionState:' + lid, legacy);
  eq(canon(await versionStateOf(lid, 'L1:0')), canon(legacy['L1:0']), 'read as it was');
  await saveOneVersion(lid, 'L3:0', st);
  const li = await db.settings.get('versionState:' + lid);
  assert(Array.isArray(li) && li.join(',') === 'L0:0,L1:0,L2:0,L3:0', 'the old ones and the new: ' + JSON.stringify(li));
  eq(canon(await versionStateOf(lid, 'L0:0')), canon(legacy['L0:0']), 'an old ledger is the ledger it was');
  assert((await db.settings.get('ver:L2:0:' + lid)).slim === 2, 'in its own row, banked');
});
