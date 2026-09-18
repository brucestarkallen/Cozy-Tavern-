/* M314 — a checkpoint is stored as its ledger plus keys into the tale's bank, and handed back whole. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState, snapshotState, loadSnapshots, saveSnapshots, restoreSnapshot, foldJournal, saveVersionStates, wholeVersions } from '../../js/engine/state.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const sid = 'm314-tale';
const PEOPLE = ['Abel Moreau', 'Bruna Katz', 'Cedric Vale', 'Dalia Orne', 'Emeric Stahl', 'Fenna Quist'];
async function play() {
  let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Bluebird' }, { type: 'clock.set', year: 2025, month: 3, day: 14, hour: 20, minute: 0 }]).state;
  await saveState(sid, st);
  const wholes = [];
  for (let page = 1; page <= 6; page += 1) {
    await snapshotState(sid, 'turn' + page);
    wholes.push(JSON.parse(JSON.stringify(await loadState(sid))));
    st = applyMutations({ ...(await loadState(sid)), page }, [
      { type: 'presence.enter', name: PEOPLE[page - 1], position: 'by the counter, page ' + page },
      { type: 'people.set', name: PEOPLE[page - 1], field: 'core', text: 'someone of the town, met on page ' + page + '. ' + 'Steady, watchful, slow to trust. '.repeat(20) },
      { type: 'rel.shift', name: PEOPLE[page - 1], axis: 'p', delta: 5 + page, cause: 'the page ' + page },
      { type: 'clock.advance', minutes: 20 },
    ]).state;
    if (page === 3) st = undoLast(st).state; /* a change taken back: the log remembers it as undone from here on */
    await saveState(sid, st);
  }
  return wholes;
}

test('M314-1 the stored checkpoints hold no journal and no log — and every reader is handed the whole ledger back, both lists exactly as they were, undone marks and all', async () => {
  const wholes = await play();
  const stored = await db.settings.get('snapshots:' + sid);
  eq(stored.length, 6);
  assert(stored.every((e) => e.snap.slim === 2 && !('journal' in e.snap) && !('log' in e.snap) && Array.isArray(e.snap.jk) && Array.isArray(e.snap.lk)), 'stored as a ledger and two lists of keys');
  const fat = JSON.stringify(wholes).length;
  const slim = JSON.stringify(stored).length + JSON.stringify(await db.settings.get('ckptBank:' + sid)).length;
  assert(slim < fat * 0.75, 'smaller even on six pages, the bank counted in (a long tale saves far more — measured in AGENTS.md): ' + slim + ' against ' + fat + ' bytes');
  const back = await loadSnapshots(sid);
  for (let i = 0; i < 6; i += 1) eq(canon(back[i].snap), canon(wholes[i]), 'checkpoint ' + (i + 1) + ' is the ledger it was — journal, log and all');
  assert(back[4].snap.log.some((e) => e.undone === true) && !back[2].snap.log.some((e) => e.undone === true), 'an entry stands undone only in the checkpoints taken after it was taken back');
});

test('M314-2 a rewind restores the same ledger it always did, and a branch can still fold from it', async () => {
  const was = JSON.parse(JSON.stringify((await loadSnapshots(sid))[3].snap));
  const restored = await restoreSnapshot(sid, 'turn4');
  eq(restored.present.map((p) => p.name).join(','), 'Abel Moreau,Bruna Katz,Cedric Vale', 'who was here');
  eq(canon((await loadState(sid)).journal), canon(was.journal), 'the journal of that moment');
  eq(canon((await loadState(sid)).log), canon(was.log), 'the log of that moment — what may still be taken back, and what already was');
  eq((await loadSnapshots(sid)).length, 4, 'the later checkpoints are let go, as ever');
  const folded = foldJournal(await loadState(sid), await loadSnapshots(sid), 2, (s, list) => applyMutations(s, list));
  eq(folded.present.map((p) => p.name).join(','), 'Abel Moreau,Bruna Katz', 'the ledger at the end of page 2, rebuilt with no model');
});

test('M314-3 two versions of one page are sibling timelines: the same ids, different substance — each version’s ledger comes back with ITS OWN entries', async () => {
  const vid = 'm314-versions';
  const base = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Bluebird' }]).state;
  const v0 = applyMutations({ ...JSON.parse(JSON.stringify(base)), page: 1 }, [{ type: 'presence.enter', name: 'Liara', position: 'at the counter' }, { type: 'rel.shift', name: 'Liara', axis: 'p', delta: 9, cause: 'she stayed' }]).state;
  const v1 = applyMutations({ ...JSON.parse(JSON.stringify(base)), page: 1 }, [{ type: 'presence.enter', name: 'Kim', position: 'by the door' }, { type: 'rel.shift', name: 'Kim', axis: 'r', delta: 4, cause: 'she came back' }]).state;
  eq(v0.journal.map((e) => e.id).join(','), v1.journal.map((e) => e.id).join(','), 'fixture: the two versions’ entries share their ids');
  await saveState(vid, v1); /* version 1 is the one on the page now */
  await saveVersionStates(vid, { 'a1:0': v0, 'a1:1': v1 });
  const stored = await db.settings.get('versionState:' + vid);
  assert(stored['a1:0'].slim === 2 && stored['a1:1'].slim === 2);
  const back = await wholeVersions(vid, stored);
  eq(canon(back['a1:0']), canon(v0), 'version 0: Liara’s entries, not Kim’s');
  eq(canon(back['a1:1']), canon(v1), 'version 1: Kim’s');
  assert(back['a1:0'].journal.some((e) => e.m.name === 'Liara') && !back['a1:0'].journal.some((e) => e.m.name === 'Kim'), 'named plainly');
});

test('M314-4 a checkpoint stored whole by an older version reads as it is and is banked at its next write; a bank missing an entry hands back an EMPTY journal, never one with a hole', async () => {
  const old = 'm314-old';
  const st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Wells house' }, { type: 'presence.enter', name: 'Liara' }]).state;
  await saveState(old, st);
  await db.settings.set('snapshots:' + old, [{ id: 'turn1', snap: JSON.parse(JSON.stringify(st)), at: 1 }]);
  const read = await loadSnapshots(old);
  eq(canon(read[0].snap), canon(st), 'read as it is');
  await saveSnapshots(old, read);
  assert((await db.settings.get('snapshots:' + old))[0].snap.slim === 2, 'banked from its next write');
  eq(canon((await loadSnapshots(old))[0].snap), canon(st), 'with nothing lost');
  /* the bank loses one journal entry (a write that never landed) */
  const bank = await db.settings.get('ckptBank:' + old);
  delete bank.j[Object.keys(bank.j)[1]];
  await db.settings.set('ckptBank:' + old, bank);
  const holed = (await loadSnapshots(old))[0].snap;
  eq(holed.journal.length, 0, 'no journal at all — so a fold declines, and nothing is silently skipped');
  eq(holed.present.map((p) => p.name).join(','), 'Liara', 'the ledger itself is whole');
});
