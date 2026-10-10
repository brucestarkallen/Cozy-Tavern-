# Cozy Tavern: current handoff

## Work in progress: M685

Branch m685-ledger-repair holds the complete ledger recovery changes. Main still
serves m684-001 until release verification passes. Read docs/LEDGER-AUDIT-M685.md
for the section audit, original source recovery, bounded correction loop, persistent
unfinished findings and post audit world review. All 28 new laws pass; 25 fail on
published M684 and three controls pass there. The actual audit button scenario
fails on M684 and passes on M685. Fast profile: 17.90 seconds. First full harness
found three obsolete prompt expectations, now updated with the runtime safeguards
retained. Release m685b then passed the full harness (1496/1496) and 296/297 walk scenarios.
DOM-262 caught Stop being reported as success after a worker returned partial work.
The queue fix is committed at 98ae6ce; M685-28 and the unchanged DOM-262 pass.
Release m685c is running on that checkpoint. Do not claim
main is updated or the release is green until the result is recorded below.

## Published release: m684-001

Jovan asked for a complete ledger pipeline audit: missing nearby people, introductions
ignored in his input, invented names/ranks, deletion instead of identity correction,
stale world simulation and unclear Books explanations. These repairs are implemented
and verified. SPEC.md states the contract. docs/LEDGER-AUDIT-M684.md explains every
stage, fixes, evidence, fixture corrections and limits. audit/results/m684.json keeps
all verification runs, including failures and their successful followups.

Final tested product checkpoint: 1dc8d7f. Application code last changed at 0cabba0;
the later change corrects the long-play mock's reading of the newest page. M683 is
71b22e8. Claude M680 (4a19de3), M681 (8880a0) and final fixes f087472/63f87 remain
verified ancestors. Original HISTORY is preserved. Canon Verification is unchanged,
v0.68.3 / 5aed234; do not overwrite the vendor lock or rerun vendoring casually.

## Behavior and code map

- Both sides of an answered turn establish facts. New identities retain source names;
  recent pages and existing records also establish identity. Explicit introductions
  get People pages even when absent. extractor.js, scribe.js, engine/evidence.js;
  chat.js pageWrites includes the paired writer input in the world-window guard.
- Quiet companions stay until an actual departure. Dead people are not revived by
  a room board. Auditor arrivals can use an exact writer quote, with later departures
  still winning. OOC slots retain their journal indices. agents/auditor.js.
- Auditor renames/merges preserve a person's records. Deleting a source-backed or
  linked person is refused. Duplicate merges keep the existing loose-end capacity
  and rename roomAt; undo includes it. engine/apply.js and agents/ripple.js.
- World reviews are owed by story time. One bounded followup covers omitted people;
  unresolved names remain unfinished. offscreen.confirm explicitly explains a stay,
  updates freshness and can be undone. No invented departure from age alone.
- Books show source/page/cause/evidence when saved. Partial corrections and pending
  page repairs are identified. ui/ledgerexplain.js, drawer.js, chat.js.

## Verification

Final harness 1469/1469; complete app walk 296/296; long play 9/9; lint 0 errors;
final send and repair performance passed with unchanged budgets. All 54 checks in
the broad matrix have a green qualifying result across the recorded runs.

This was NOT one all-green full invocation. m684c ran all 54 checks (2096.39 s):
53 passed and four unsupported-name fixtures failed within the walk. Those sources
were corrected without weakening assertions. m684d passed the final full harness
and walk; its long-play mock exposed that it read old arrivals from earlier context.
After fixing only that mock, standalone long play passed 9/9. m684e passed final
lint, perf_send and perf_repair. The report preserves each run and source commit.

M684 adds 22 focused laws and DOM-M684-1. Against M683: 18 new laws fail, four
controls pass; all 22 pass now. Controls also caught M684's own OOC-index, MC-name
and recent-page-name regressions before publication. Development fast: 16.19 s.

## Next session

Read AGENTS.md and this handoff once. Use tools/context.py for HISTORY; do not load
it all. Run python3 tools/check.py fast during edits; release when ready, full for
broad changes. Never change execution inputs during a check run or loosen budgets.
This sandbox's launcher/upgrade tests need PATH=/tmp/cozy-work-test-bin:$PATH.

No real user story data was accessed or changed. After updating, “Audit the ledger”
can apply the revised repair rules to an existing story; normal page turns run the
world simulation. Models still judge prose. A failed review stays visibly overdue.
