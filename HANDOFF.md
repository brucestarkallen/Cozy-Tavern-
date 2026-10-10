# M686 work in progress

The owner's autonomous recovery contract is implemented on m686-autonomous-recovery.
Opening a story starts original source recovery, and saved unfinished audits retry
while idle with no terminal attempt limit. They yield to storytelling and respect
Stop and disabled agents. The auditor no longer hands the writer a Finish it task.
See docs/AUTONOMOUS-RECOVERY-M686.md. Seven new app scenarios pass; four fail on M685,
and three controls pass there. Fast checks passed in 26.79 seconds. Full release
m686a is running. Main still serves M685 until results and publication are verified.

# Cozy Tavern: current handoff

## Current release: m685-001

Jovan asked for an actual audit across Scene, People, World and Books after an
existing story still lost Princess Alexia. The section by section audit is in
docs/LEDGER-AUDIT-M685.md. SPEC.md defines the accepted behavior; exact test results,
including failed attempts and their corrections, are in audit/results/m685.json.

Product checkpoint: df35cd5d158ce0d6d20adff9cfbbd4a194f575bd. The later release commit
changes documentation only. M684 was 613c174. Claude's M680 (4a19de3), M681 (8880a0),
final fixes f087472/63f87 and M683 (71b22e8) remain ancestors. Original HISTORY and
instruction archives are preserved. Canon Verification remains v0.68.3 / 5aed234;
do not replace the vendored copy or rerun vendoring without reconciling its changes.

## What changed and where

* agents/auditsources.js reads original answered writer input, story pages, brief
  and cast in bounded batches. Exact quotations recover missing People identities
  even when summaries and all books lost them. Old introductions do not establish
  current presence. Receipts are cached by source text; changed sources are reread.
* agents/auditor.js gives blocked proposals their actual reason and one followup.
  Renames preserve records. Unresolved findings survive later empty answers and
  close only with a matching repair or source quoted withdrawal. Cut off or failed
  readings do not declare completion. All returned findings are considered.
* Evidence can correct a wrong current mood, character state and missing personal
  promise. Manual fields, later clock advances, deaths, actual departures, page
  earned standings, source changes and concurrent writes remain protected.
* agents/world.js includes absent people who lack a location record in owed work.
  ui/chat.js finishes an audit with any owed world review in the same job, using
  the configured world worker without an extra story turn or clock advance.
* Books shows source coverage, landed repairs and pending reasons. A repeated page
  correction is combined before mending. Manual Stop wins even after partial work;
  auditor timeouts propagate without breaking the continuous reader's separate
  mender timeout contract. agents/queue.js, auditor.js, chat.js and drawer.js.

## Verification

Final complete harness 1499/1499, app walkthrough 297/297, long play 9/9 and lint
0 errors. All 33 release checks have qualifying green results. This was not one
all-green invocation: m685e passed 32/33; long play caught a duplicated page repair.
After its four-line correction, m685f reran the full harness, walkthrough, unchanged
long play and lint. The device, theme and performance code is unchanged from m685e.
No budget or long-play assertion was relaxed.

All 30 M685 laws pass. The original 29 were run against M684: 26 fail and three
preservation controls pass. M685-30 reproduces the duplicate mend on e876f85 and
passes with the correction. DOM-M685-1 fails on M684 and passes now through the
actual audit button. It restores missing people, current presence and absent
world state without another storyteller turn. Stop is covered by unchanged DOM-262.
A focused development profile took 21.81 seconds before the final duplicate fix.
Tests use scripted providers; no paid model calls or real user stories were used.

## Next session

Read AGENTS.md and this handoff once. Use tools/context.py for relevant history;
do not load the entire archive. Fast checks belong during editing; release checks
belong on a stable candidate. Preserve rejected and interrupted runs in the report.
This environment's launcher/upgrade checks need PATH=/tmp/cozy-work-test-bin:$PATH.

No phone ledger was accessed or changed directly. After updating, run “Audit the
ledger” once on an existing story for complete original source recovery. The first
full audit of a long story needs additional background model calls. Normal turns
review new source batches. Source interpretation remains a model judgment; omitted
or failed repairs stay explicitly unfinished rather than becoming a clean report.
