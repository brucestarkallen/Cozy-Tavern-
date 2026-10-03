/* Cozy Tavern — harness laws of M574 (the line-by-line audit, part 1). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, snapshotState, loadSnapshots, saveSnapshots, saveOneVersion, loadVersionStates, saveVersionStates } from '../../js/engine/state.js';
import { scrubStyle } from '../../js/ui/richhtml.js';

test('M574-1 A CHECKPOINT CHANGED AND SAVED IS WRITTEN — the rebuild of the people patched the turn\'s checkpoint in place and the save, seeing the very object it had handed out, skipped it; as a new object it is written (checkpoints and version ledgers alike)', async () => {
  const sid = 'st-574';
  const st = { ...emptyState(), page: 1, characters: { Kaelen: { core: 'old core' } } };
  await snapshotState(sid, 'turn-1', st);
  await saveOneVersion(sid, 'p1:0', st);
  const list = await loadSnapshots(sid);
  list[0] = { ...list[0], snap: { ...list[0].snap, characters: { Kaelen: { core: 'REBUILT core' } } } };
  await saveSnapshots(sid, list);
  eq((await loadSnapshots(sid))[0].snap.characters.Kaelen.core, 'REBUILT core', 'the checkpoint holds the rebuilt people');
  const all = await loadVersionStates(sid);
  all['p1:0'] = { ...all['p1:0'], characters: { Kaelen: { core: 'REBUILT core' } } };
  await saveVersionStates(sid, all);
  eq((await loadVersionStates(sid))['p1:0'].characters.Kaelen.core, 'REBUILT core', 'and the version ledger');
  /* the old way, changed in place, is what was skipped — held here so the rule is plain */
  const again = await loadSnapshots(sid);
  again[0].snap.characters = { Kaelen: { core: 'IN PLACE' } };
  await saveSnapshots(sid, again);
  eq((await loadSnapshots(sid))[0].snap.characters.Kaelen.core, 'REBUILT core', 'a change made in place is not seen — which is why the rebuild hands a new object');
});

test('M574-2 A PAGE\'S STYLE NEVER REACHES A SERVER — url(, a CSS escape that spells it, image-set(, image(, cross-fade(, element( are refused; ordinary styling stands', () => {
  for (const bad of ['background:url(x)', 'background:\\75 rl(http://x)', 'background-image:image-set("http://x" 1x)', 'background:image(x)', 'background:cross-fade(x,y)', 'background:element(#x)']) eq(scrubStyle(bad), '', bad);
  eq(scrubStyle('color: #c33; font-weight: bold'), 'color: #c33; font-weight: bold');
});
