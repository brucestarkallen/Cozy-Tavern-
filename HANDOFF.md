# Cozy Tavern: current handoff

## M684 final verification, not yet on main

Jovan requested the complete ledger audit in SPEC.md. Main is still 71b22e8, M683.
The working release is saved on origin/m684-ledger. Application checkpoints are
10cdb17, 8cbf422 and 0cabba0. The last adds source names from the recent pages the
extractor actually receives; it fixes an overstrict M684 name guard, proven by
M684-22. There are 22 new focused laws, all green.

The broad `full --tag m684c` run is finishing in the original checkout. Its harness
passed 1468/1468, long play 9/9, lint and all performance checks passed. The original
walk was 292/296: four legacy fixtures supplied unsupported names. In the separate
worktree /tmp/cozy-m684-fixtures those sources are corrected, with every assertion
kept. DOM-1/2/127/234/244/255 pass together. The same worktree is running the final
complete harness, walk, long play, lint, perf_send and perf_repair, tagged m684d;
progress /tmp/m684d-progress.log, summary /tmp/gates/m684d_summary.json. No code
edits during this run. The 54-check original report is /tmp/gates/m684c_summary.json.

After verification: fast-forward the original m684-ledger worktree to this worktree's
HEAD, record both runs and their source commits honestly, replace this progress note
with a concise release handoff, append HISTORY, verify remote main and publish without
force. Do not describe the original full invocation as all green. Tests use scripted
providers; no real story data was accessed. Baseline M680/M681 and Claude's final fixes
are verified ancestors; original HISTORY is intact. See docs/LEDGER-AUDIT-M684.md and
audit/results/m684.json. The previous release notes below remain for continuity.

## Current release: m683-001, main

Jovan requested faster checks, smaller context, removal of the factory female voice
restriction, disappearing resolved housekeeper warnings, one academy story/input canvas,
a cozy academy night choice, and a clearer workflow. SPEC.md has the acceptance criteria.
All seven changes and validation are complete and published on GitHub main.
The first verified release commit is 2f9543c. The saved m683-workflow-academy branch mirrors main.
The product source tested by the full release is f45a68c. A final runner report initialization
fix has its own failing-before/passing-after unit and a fresh successful fast run.

The preceding release is m682-001, published on main at ff200328. Original Claude M680
(4a19de3), M681 (8880a0), and the two final fixes remain in history. Canon Verification
main is 5aed234, version 0.68.3; this milestone does not change that repository.

## Start here

Read AGENTS.md, this handoff and docs/WORKFLOW.md. Use tools/context.py for relevant
milestones rather than reading the whole HISTORY. Full previous instructions/handoff
are preserved verbatim in docs/archive; HISTORY remains complete and append only.

- Prompt: js/assemble/craft.js and modules.js. Remove the retired factory line only;
  edited module storage and other user words remain intact.
- Housekeeper: js/agents/housekeeper.js, js/ui/housekeeper.js. Retry passes explicit failed
  IDs; a readable replacement retires that warning. Failed retries/unrelated failures stay.
  Obsolete cards/receipts disappear visibly, while original turns/raw answers stay saved.
- Academy: css/academy.css and base.css, index.html Appearance choices, app.js and
  speechcolours.js. Day and night share one story/input canvas; night reuses local art/fonts.
- Workflow: tools/check.py, tests/check_runner_unit.py, docs/WORKFLOW.md.

## M683 validation, October 10, 2026

Full release: all 33 checks passed in 1713.89 s (28.6 minutes), source unchanged throughout.
Harness 1447/1447, app walk 295/295, long play 9/9, lint 0 errors; all 22 original standing
checks, housekeeper, workflow and day/night pixel/performance checks green. Additional
coat and contrast checks pass for all ten coats. No assertion or budget was lowered.
Final fast: 15.69 s, 41 selected laws, 4 selected app scenarios, lint, five workflow units,
three readiness cases, real phone/desktop Appearance controls. Full results/timings and
causal controls: audit/results/m683.json. Complete app/CSS unchanged after the full release;
only initial runner progress reporting changed, with its targeted proof and final fast run.

## Checks

Fast while editing: python3 tools/check.py fast
Ready to publish: python3 tools/check.py release --tag m683
Interrupted, same source: same command with --resume
Broad optional inventory: python3 tools/check.py full --list
Legacy audit/gates.sh calls the release runner and now fails if a check fails.
Logs and JSON timings live at /tmp/gates/<tag>_*. Tests use scripted providers, not paid
model calls. No test result guarantees that every possible bug is absent.

M683 regressions: tests/harness/m683.mjs and DOM-M683-1; actual Appearance choice,
theme persistence, phone/desktop canvas and motion: tests/academy_ui.py. Existing academy
pixel/performance tests accept COZY_TEST_COAT=academy-night; budgets are unchanged.

## Established care points

Canon vendoring must use tools/vendor-canon.lock.json. Never overwrite local divergence:
merge shared fixes into the extension, then verify --check. M682 reconciled the old copies.
Boot readiness must follow sync's reload decision; fixture changes must finish pushAll
before measurement. Version taps retain their ordered store writes and legacy reversal m.of.
Backup restore and page ownership guards are exercised in standing release checks.

This hosted sandbox needs its existing process namespace adapter in /tmp/cozy-work-test-bin
for launcher/upgrade tests; prepend that directory to PATH here only. It is not a product
change and is unnecessary on the owner's normal device. Do not store access tokens here.
