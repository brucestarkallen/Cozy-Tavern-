# THE LINE-BY-LINE AUDIT — CHECKPOINT (read this first in a new session)

**Where it stands:** m609-001, Oct 5 2026. 85 of 122 files read whole and fixed —
40,621 of 64,113 lines (28,986 of 47,196 code lines). Every helper (js/agents) and the request builder (js/assemble) are read. Every helper in js/agents is read. The ledger of every file is `audit/LINE_AUDIT.md`
(`DONE (Mxxx)` = read whole; `todo` = not yet). The full history of every fix is the tail of `AGENTS.md`
(search `# M574` onward for the audit's own parts); `HANDOFF.md` says how to run the app and the tests.

LO (Bruce, the owner) audits nothing himself and verifies nothing himself: the session does the reading, the fixing, the
testing and the pushing, and reports what it checked. He types "Continue" or "." to resume; the audit carries on from the
next file in the order below without asking.

## What is DONE (read whole)

- The send path and the page UI: `js/ui/chat.js`, `js/ui/richhtml.js` (M574–M577)
- The ledger engine, all of it: `js/engine/*` — apply, state, people, names, world, duels, bodies, relationships, offscreen,
  canon, clock, referee-math, whole, usage, sentence, window, voicepresets (M578–M579, M584, M593)
- Every helper in `js/agents/` (M588–M608)
- The prefill, both modes, every path: `js/providers/structured.js` and the prefill paths in `openai.js`/`effort.js`
  (M580–M592, M596) — the rest of openai.js/effort.js is still to read line by line

## What is left — take it in this order

1. Storage and sync: `serve.py` (size limits already checked), `sw.js` (store, sync and the sync worker are read)
2. The UI: `js/ui/settings.js`, `drawer.js`, `housekeeper.js` (the UI of it), `receiptview.js`, `pageshape.js`,
   `headergate.js`, `canonsettings.js`, the rest of `js/ui/*`, `index.html`
3. Canon: `js/canon/bridge.js`, then `js/canon/grounding.js` (the vendored canon engine, ~4,200 code lines — last)
4. Imports and the rest: `js/import/*`, `js/regex*.js`, `js/sent.js`, `js/app.js`

`python3 audit/show.py <file> <from> <to> [width]` prints a file's code lines with comments set aside; read the prompt
strings as well — they are what a helper or the storyteller is told.

## The bug classes the audit keeps finding — look for these in every file

- **A part of a name taken as the first match** ("Kuchiki" = whichever Kuchiki stood first): every lookup must be one
  meaning or none, the exact name first (M584, M600). Search the whole codebase for the pattern when one is found.
- **A worker told to do something its own code refuses** (the auditor told to restore a standing its guard refused, M599;
  the housekeeper told it may edit a record line's detail while the staleness check and undo read only the text, M602).
  For every instruction a helper is given, check the code path that would carry it out.
- **A worker told to use data it never receives** — verify the code passes it.
- **Instructions out of step with the engine** (the page reader told "leave ONLY when they leave" after the engine let
  his walking away stand, M594). When an engine rule changes, every helper's words about it change too.
- **Shared objects mutated** (a ledger copy that writes into the map it was handed — M604's first version).
- **The browser's store keeps copies, never objects** (two stored copies drifting apart — M603).
- **A check that runs before the last words are in** (M590/M591 — flush first, then judge).
- **Nobody left nowhere** — a person the story keeps is always here or seated somewhere (M588); the main character never
  leaves his own scene (M589).

## How each part is done (the conventions)

1. Read the file whole. Fix what is wrong at its root; search the codebase for the same pattern.
2. Every fix gets a law: `tests/harness/mNNN.mjs` (registered in `tests/harness/run.mjs`) that drives the real code —
   never one that reads source text — and a NEGATIVE CONTROL: put the old code back and see the law fail. A law that
   passes on the old code is not kept. UI fixes get a walk scenario in `tests/dom/run.mjs`.
3. Bump `js/version.js` (`mNNN-001`), add a `# MNNN — …` section at the end of `AGENTS.md` (what was found, the root, the
   fix, the laws), update the state line in `HANDOFF.md`, mark the file in `audit/LINE_AUDIT.md`.
4. A milestone number never appears inside any prompt text a helper reads (law M563 catches it).
5. When the craft's text changes, add the OLD craft's fingerprint to `SHIPPED_BEFORE['core-craft']` in
   `js/assemble/modules.js` so his tales holding the old shipped craft get the new one.
6. An older law that fails after a change: suspect the change first; move the law only with the reason written beside it.
7. Run the gates (below). Push only when every gate passes; if one cannot be judged on the machine, say why and prove it
   (run the same check on the previous commit).

## The gates

```
setsid bash audit/gates.sh m607 > /dev/null 2>&1 < /dev/null &
# poll (each tool call under 300 s — a call that times out kills what it started):
tail -2 /tmp/gates/m607_harness.log      # harness — 1196/1196 at m606
tail -3 /tmp/gates/m607_walk.log         # the DOM walk — 211/211
grep -c "^  ok" /tmp/gates/m607_long.log # long play — 9
grep problems /tmp/gates/m607_lint.log   # lint — 0 errors (170 warnings)
cat /tmp/gates/m607_browser.log          # perf_send, holdsone, cutthinking — EXIT 0 each
```
perf_send measures real speed: on a container with ONE CPU (`nproc`) it fails for every commit (checked at m606) — say so
and prove it on the previous commit rather than counting it.

Push (the token is LO's fine-grained PAT, expiring 2026-10-30; he pastes it at the start of a session):
```
git push https://x-access-token:<TOKEN>@github.com/brucestarkallen/Cozy-Tavern-.git main
```
Then confirm GitHub's main is the new commit (`api.github.com/repos/brucestarkallen/Cozy-Tavern-/commits/main`).

## His rules (he will not repeat them)

- Answer every item he sends; do the work in this reply — never "next session", "say the word", "let me know if it is
  still broken"; never ask him to test, check or report back. Verify yourself and say exactly what was checked.
- A symptom is not the bug: find why. Search the whole codebase for the same pattern. Read your own diff before saying it
  works. Tests run the feature, never read the source.
- Use his connection settings exactly. Controls are named what he calls them; one button, one meaning. If the app can
  detect a problem, the app repairs it — but a failed page is NEVER asked again by the house: it names the real cause
  and he asks again by hand.
- Plain words, short, the answer first. No generic disclaimers. No milestone numbers or jargon to him.
- His frontend is uncensored and his own: never add content filters. Everything above the history is system role.
- The world is a realistic simulation, never gamey: no caps or quotas on how people live; NPCs know only what a pathway
  gave them; capable people stay capable.
