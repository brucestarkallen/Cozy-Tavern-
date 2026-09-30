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
  const b = ((at) => c.slice(at, c.indexOf('\n  async function ', at + 10)))(c.indexOf('async function branchFrom(')); /* M517: the whole of branchFrom, to its end — a fixed window (15,000 characters, grown by hand in M72, M91, M127, M332) cut off the re-read call when five lines were added above it */
  assert(/carried = await versionStateFor\(story\.id, target\.id, idx\);/.test(b), 'the version checkpoint first');
  assert(/const hit = snaps\.find\(\(e\) => e\.id === nextUser\.id\);/.test(b), 'else the next turn’s boundary');
  /* M66: never a LATER state — the nearest earlier checkpoint, else a clean ledger plus a re-reading */
  assert(!/if \(!carried\) carried = await loadState\(story\.id\);/.test(b), 'the old fallback to the ledger as it stands is gone');
  /* M91: the fold rides where the journal reaches; near the tail of a store it does not reach, the ledger as it stands */
  assert(/carriedOrder\[i\]/.test(b) && /foldJournal\(now, snaps, k === -1 \? -1 : k, applyMutations\)/.test(b) && /journalReaches\(now, snaps/.test(b), 'nearest earlier checkpoint, else the FOLD of the journal (M69), gated by reach (M91)');
  /* M506: the settled newest page carries the ledger as it stands, exact; while its readers are still out the copy is the
   * boundary before the page's turn (else the ledger as it stands), inexact, and M66's line below never overrides that mark */
  assert(/if \(fromTheTail && chainStillRunning\) \{[\s\S]*?carried = boundary && boundary\.snap \? \{ \.\.\.boundary\.snap, pendingVerdict: null \} : nowState;[^\n]*\n\s*exact = false;\s*mustReread = true;\s*\} else if \(fromTheTail\) \{\s*carried = nowState;\s*exact = true;/.test(b), 'the newest page carries the ledger as it stands, first, exact once the readers landed (M91, M112, M506)');
  assert(/exact = \(exact \|\| Boolean\(carried\)\) && !mustReread;/.test(b), 'M66’s checkpoint mark never overrides M112’s (M506)');
  assert(/startBackgroundWork\(branchStory, last, lastUser \? pageText\(lastUser\) : '', \{ deep: true, audit: true \}\)/.test(b), 'an inexact carry is re-read at once');
  /* M337: the carried ledger passes through dropTheFuture on its way — nothing dated past the branch page rides along */
  assert(/const carriedNow = dropTheFuture\(JSON\.parse\(JSON\.stringify\(carried\)\), kBranch \+ 1\)\.state;[\s\S]*msgId: idMap\[e\.msgId\][\s\S]*await saveState\(branch\.id, carriedNow\);/.test(b), 'written to the branch, the referee’s timeline re-keyed (M72)');
  assert(/saveSnapshots\(branch\.id, snaps\)/.test(b) && /idMap\[e\.id\]/.test(b), 'snapshots carried, re-keyed');
  /* M314: the row is written through writeVersionStates now (stored without each ledger's own journal); what is
   * carried and re-keyed is the same — the walk's branch scenarios run it */
  assert(/writeVersionStates\(branch\.id, branchVersions\)/.test(b), 'versions carried, re-keyed');
  assert(/mem\.nodes\.filter\(\(n\) => n\.span\[1\] < visibleCount\)/.test(b), 'only the record lines that cover carried pages');
  assert(/saveLore\(branch\.id/.test(b), 'the lore shelf carried');
  assert(!/The ledger starts clean for the new telling/.test(b), 'the old law is gone');
});

test('M112-1 a branch taken while the readers are still on the newest page re-reads that page itself; an origin\'s chain is never touched', () => {
  const c = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const b = ((at) => c.slice(at, c.indexOf('\n  async function ', at + 10)))(c.indexOf('async function branchFrom(')); /* M523: the whole of branchFrom, to its end — a fixed 15,000-character window cut off the re-read call when lines were added above it (as M43-2 in M517) */
  assert(/chainStillRunning = \(await pendingWork\(story\.id, 8000\)\) === false && workInFlight\(story\.id\);/ /* M332: declared above the branch's try, assigned here; M506: a settled tale is not "still running" */.test(b), 'the wait says whether the chain settled — and only a reader still out means still running (M506)');
  assert(/\} else if \(fromTheTail\) \{\s*carried = nowState;\s*exact = true;/.test(b) && /if \(fromTheTail && chainStillRunning\) \{[\s\S]*?exact = false;\s*mustReread = true;/.test(b), 'the newest page is exact only once the readers landed (the behaviour: walk DOM-127)');
  assert(/if \(fromTheTail && chainStillRunning\) \{\s*startBackgroundWork\(branchStory, last, lastUser \? pageText\(lastUser\) : '', \{ deep: false, audit: true \}\)/.test(b), 'a light re-read of the last page, not the deep one');
});
