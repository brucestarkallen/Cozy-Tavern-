# Workflow: commands and practice

AGENTS.md holds the rules, including when a check is real testing and when it is a
ritual (its Testing section). This file holds the commands to run the checks that
are real, what each one can and cannot see, and how a version is handed off and
published. Times are measured on a two-core cloud sandbox.

## The checks, from cheapest

| Check | Command | Time | Sees |
|---|---|---|---|
| One law, or a few | `ONLY='^M688-1 \|^M688-2 ' node tests/harness/run.mjs` | about 1 s each | engine, agents, request building, store, against the real modules |
| The whole law suite | `node tests/harness/run.mjs` | about 5 min | everything above, every milestone's laws, the focused fixtures (tests/harness/focused.mjs) |
| One DOM walk law, or a flow | `ONLY='^DOM-(1\|2\|8a) ' node tests/dom/run.mjs` | a few seconds | the real app in jsdom: clicks, sends, swipes, branches, Settings |
| The whole DOM walk | `node tests/dom/run.mjs` | about 13 min | every scenario in one booted app, in order |
| Lint | `bash tests/audit_lint.sh` | about 11 s | undefined names, unreachable code and the like; 0 errors required, warnings are read by hand |
| Real browser checks | `CHROMIUM_PATH=/path/to/chrome python3 tests/<name>.py` | 10-60 s each | layout, scrolling, contrast, focus, offline shell, updates, real IndexedDB |
| Long play | `node tests/dom/longplay.mjs` | long | accumulation over many turns; only for a bug that needs a long run, and then the shortest run that shows it |

Notes:
- ONLY is a regular expression matched against the law's name. Anchor it (`^`) and end
  with a space, or `M688-1` also selects `M688-10`.
- DOM laws run inside one booted app, in file order. A law that sends needs the mock
  connection that DOM-2 adds: include `DOM-1|DOM-2` in ONLY. A law that starts from an
  earlier law's tale needs that law too; when unsure, run the walk's laws up to it.
- tests/dom needs its packages once: `cd tests/dom && npm install`.
- The node browser checks (tests/*.mjs with Playwright) also need Playwright resolvable:
  `CODEX_PRIMARY_RUNTIME_NODE_MODULES=<global node_modules>` names where it is.
- No check calls a real provider. A live provider costs the owner money; use one only
  when the bug is in a provider's real behaviour.

## Which check answers which question

- "Is this the cause?" A failing law or a scratch run on the real data shape, before the fix.
- "Does the fix work?" One law that runs the feature and fails without the fix; run it
  with and without the fix once.
- "Did I break something I did not touch?" The laws that exercise what you changed while
  iterating; the whole law suite once before publishing a version that changed shared code.
- "Does the screen do it?" The DOM walk laws of that flow; the whole walk only when the
  change touches what every scenario passes through (drawing the thread, sending,
  opening or branching tales, the store).
- "Does it look, scroll and feel right on his phone?" A real browser check, measured.
- "Is it fast enough?" Measure before and after in a real browser, at phone size.

## When a check fails

- A law you did not write: suspect your change first. Change its expectation only when
  you can say why the old one is wrong under the current contract, and cite it.
- A failure that comes and goes: do not re-run until it passes. Instrument the path to
  see what happened in the failing run, and compare with the previous version under the
  same conditions (interleaved runs, the same load). M752's DOM-8a was a real race found
  this way: a drawing of another tale landing late.
- A law that would still pass with its feature deleted is removed, not kept green.

## Several agents at once

One git worktree per agent (`git worktree add`), each on its own branch, merged by one
coordinator. Never `git stash`: the stash is shared by every worktree of a repository.

## Handoff and publishing

- A functional change gets a version (js/version.js; the service worker cache follows
  it). Documentation-only work does not.
- HANDOFF.md is rewritten as the present state: the latest milestone, what was checked,
  what was not, and the open items. Earlier handoffs go to docs/archive verbatim when
  it is rewritten wholesale; HISTORY.md gets a short appended entry with measured
  results and limits.
- Inspect remote main, reconcile without force, push, then verify the exact remote
  head. Publishing is not a reason to run checks; what the version changed is.
- If automatic review blocks an action, report the precise action and reason; do not
  bypass it. Credentials stay outside git and logs.
- Historical context: `python3 tools/context.py "M731"` (HISTORY.md), add
  `--in handoff` for the archived detailed handoffs, `--list` for titles only.
