/* M43 — the mend is quiet on the page; a branch carries its checkpoint. */
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
const chat = () => readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');

test('M43-1 no chip on a mended page; the take-back lives in the drawer', () => {
  const c = chat();
  assert(!/chip\.textContent = 'mended by the second reader/.test(c), 'the chip is gone');
  assert(/unmend,/.test(c), 'unmend is offered to the drawer');
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/Put the earlier words back/.test(drawer) && /ctx\.chat\.unmend\(m\.id\)/.test(drawer));
});

test('M43-2 a branch carries its checkpoint: the ledger after the branch page, the snapshots, the versions, the record’s lines, the lore', () => {
  const c = chat();
  const b = c.slice(c.indexOf('async function branchFrom('), c.indexOf('async function branchFrom(') + 12000) /* M72, M91, M127: the window grew */;
  assert(/carried = await versionStateFor\(story\.id, target\.id, idx\);/.test(b), 'the version checkpoint first');
  assert(/const hit = snaps\.find\(\(e\) => e\.id === nextUser\.id\);/.test(b), 'else the next turn’s boundary');
  /* M66: never a LATER state — the nearest earlier checkpoint, else a clean ledger plus a re-reading */
  assert(!/if \(!carried\) carried = await loadState\(story\.id\);/.test(b), 'the old fallback to the ledger as it stands is gone');
  /* M91: the fold rides where the journal reaches; near the tail of a store it does not reach, the ledger as it stands */
  assert(/carriedOrder\[i\]/.test(b) && /foldJournal\(now, snaps, k === -1 \? -1 : k, applyMutations\)/.test(b) && /journalReaches\(now, snaps/.test(b), 'nearest earlier checkpoint, else the FOLD of the journal (M69), gated by reach (M91)');
  assert(/if \(fromTheTail\) \{\s*carried = nowState;\s*exact = !chainStillRunning;/.test(b), 'the newest page carries the ledger as it stands, first, exact once the readers landed (M91, M112)');
  assert(/startBackgroundWork\(branchStory, last, lastUser \? pageText\(lastUser\) : '', \{ deep: true, audit: true \}\)/.test(b), 'an inexact carry is re-read at once');
  assert(/const carriedNow = JSON\.parse\(JSON\.stringify\(carried\)\);[\s\S]*msgId: idMap\[e\.msgId\][\s\S]*await saveState\(branch\.id, carriedNow\);/.test(b), 'written to the branch, the referee’s timeline re-keyed (M72)');
  assert(/saveSnapshots\(branch\.id, snaps\)/.test(b) && /idMap\[e\.id\]/.test(b), 'snapshots carried, re-keyed');
  assert(/versionState:' \+ branch\.id/.test(b), 'versions carried, re-keyed');
  assert(/mem\.nodes\.filter\(\(n\) => n\.span\[1\] < visibleCount\)/.test(b), 'only the record lines that cover carried pages');
  assert(/saveLore\(branch\.id/.test(b), 'the lore shelf carried');
  assert(!/The ledger starts clean for the new telling/.test(b), 'the old law is gone');
});

test('M112-1 a branch taken while the readers are still on the newest page re-reads that page itself; an origin\'s chain is never touched', () => {
  const c = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const b = c.slice(c.indexOf('async function branchFrom('), c.indexOf('async function branchFrom(') + 12000);
  assert(/const chainStillRunning = \(await pendingWork\(story\.id, 8000\)\) === false;/.test(b), 'the wait says whether the chain settled');
  assert(/if \(fromTheTail\) \{\s*carried = nowState;\s*exact = !chainStillRunning;/.test(b), 'the newest page is exact only once the readers landed');
  assert(/if \(fromTheTail && chainStillRunning\) \{\s*startBackgroundWork\(branchStory, last, lastUser \? pageText\(lastUser\) : '', \{ deep: false, audit: true \}\)/.test(b), 'a light re-read of the last page, not the deep one');
});
