# Current editing and publication workflow

The owner's 11 October 2026 instruction governs all work, including publication.
Read AGENTS.md and HANDOFF.md once. Historical test mandates are not active policy.

## Fix the requested problem

Trace the actual failure through the relevant code, complete a coherent repair,
and preserve unrelated functionality, user writing and saved records. Do not turn
a narrow fix into a project wide testing or cleanup exercise.

## Testing policy

Default to no tests. Consider only an extremely small, directly relevant check at
a meaningful milestone or after several useful implementation iterations.
Before running it, identify the concrete failure or remaining risk it resolves.
If it cannot answer a specific question about this change, skip it.

Examples:

* Presence repair: check the reported presence update and its saved result.
* Retry loop: check that the same unresolved input stops repeating and new evidence
  can resume it. Do not run theme, pixel, performance or long gameplay suites.
* Relationship repair: check the explicit starting value and preservation of an
  earned value. Do not launch unrelated scene or whole app suites.
* Theme change: inspect the affected visual surface only when needed.
* Documentation, instructions or publication only: no tests.

No automatic fast, release, full or all profile. No mandatory old code comparison,
new regression file for every edit, full browser walk, multi hundred turn gameplay,
theme check or performance gate just because a milestone is being published.
Existing tests remain available; their existence is not an instruction to run them.
Never delete or weaken tests to hide failures.

Do not test after every edit. Do not rerun a passing check for notes, commit messages
or publication. If a relevant check fails, fix that cause and repeat only that check.
Stop once the specific risk is sufficiently resolved. Do not broaden checks unless
new concrete evidence or a direct owner request requires it.
Report what was actually checked, what passed or failed, and what remains unknown.
Scripted provider success does not prove the owner's live story has been repaired.

## Handoff and publishing

Version functional changes. Documentation only does not need an app version bump.
Keep HANDOFF.md concise, append HISTORY.md, and retain earlier instructions as
historical records when replacing them. Document the cause, changed behavior and
verification limits so the next session does not repeat finished work.

Inspect remote main before publishing, reconcile without force, and verify the
resulting remote commit. Use established publication authorization. If automatic
approval review blocks an action, report the precise action and stated reason;
do not bypass it. Remote commit verification is not a reason to rerun tests.
Credentials stay outside git and logs.

Use tools/context.py or bounded searches for historical context. Do not load the
entire history or resurrect archived workflows. The old bulk workflow is preserved
in docs/archive/WORKFLOW.before-owner-testing-policy.md for historical reference.
