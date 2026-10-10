# Editing and releasing Cozy Tavern

Tests exercise the real application with scripted model replies and disposable libraries.
They do not spend API credit. Some recovery scenarios deliberately wait minutes; timings,
slow CPU profiles and actual browser pixels explain why a complete run is longer than edits.

| Command | Purpose | Scope |
| --- | --- | --- |
| `python3 tools/check.py fast` | Every editing checkpoint | Selected prompt, housekeeper, store and M682 laws; UI smoke; lint; real academy controls; boot readiness |
| `python3 tools/check.py release --tag m683` | Once the product is ready | Full harness, walk, long play, lint; all 22 previous standing checks; workflow, housekeeper and both academy coats |
| Same command with `--resume` | Continue an interruption | Successful functional jobs with identical source/runtime only; all measurements rerun |
| `python3 tools/check.py full --tag broad` | Broad changes or periodic audit | Every top level Python test plus complete core gates and both academy coats |
| Any profile with `--list` | Review coverage before running | Commands and explicit selectors, without starting tests |

Only independent functional browser tests overlap, at most two and on different ports.
Core suites, fixed port launchers, speed checks and pixel checks run alone. Use --jobs 1
on a constrained machine. Logs include real exit codes, elapsed seconds and individual
harness timings; the runner returns nonzero on failure or source changes during a gate.
An empty ONLY selection fails. ALLDONE is written only when all checks passed.

A resume fingerprint covers executable product/tests/tools/assets and runtime versions,
including new files. A changed implementation invalidates earlier successful functional
jobs. Documentation changes do not. Never cache speed/pixel results, loosen a budget to
obtain green, hide a failing assertion or report selected tests as full coverage.

For a simple isolated patch, run its regression and nearby checks during editing. Reserve
the full release for the final product tree; add relevant full-profile tests for dependencies
that changed. Do not run the whole suite again after a note-only edit. If a gate fails,
diagnose the failure and use its focused check to iterate before another release attempt.
No test suite proves zero possible bugs; reproducible failures and causal tests are stronger
than repeated lucky passes. Each test uses its own data; never run fixtures on the owner's
live library.

## Reading without flooding context

Read AGENTS.md and HANDOFF.md first, once. Keep HISTORY.md as the complete record.
`python3 tools/context.py housekeeper` shows bounded matching milestone excerpts.
Use `--list` to see titles first; narrow a term to a module path or milestone, or use
`rg -n` and read a bounded source range. The tool has a hard character budget; the full
history is not automatically concatenated. The original AGENTS/HANDOFF and old gate
script are verbatim in docs/archive. Originals there describe their historical stage.

## A reviewable change

Work on a named branch. Write the concrete trigger and desired behavior in the issue or
SPEC. Keep small causal tests; show new defect laws fail on old code. Preserve custom
words and stored records. Version functional changes, append HISTORY and keep the active
handoff short. Use the issue/PR templates for reproduction and actual measured validation.
Before publication, fetch/inspect remote main and reconcile changes without force. Verify
the resulting remote head and version. Tokens stay outside git and logs. Commit documents
once after results; a document-only commit need not repeat functional validation.
