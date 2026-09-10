# AGENTS.md — notes for whoever tends the tavern next

Human or AI, these are the house rules. Read them before touching anything.

## The one rule above all

`SPEC.md` is the binding contract for each milestone. Implement it exactly.
If the spec and the code ever disagree, stop and surface the conflict — do
not improvise.

## Voice (applies to every user-facing string)

UI copy reads like a person keeping a writing desk: warm, plain, unhurried.
"The story so far", "Who's here", "The frame", "The note at the end" —
never "Settings Manager v1.2", never gamification, badges, or neon. Buttons
say human things: "Keep it", "Not now", "Take a copy". Errors apologize and
point at a next step; they never show a stack.

## Hard constraints (locked)

- No build step, no npm, no frameworks. Vanilla ES modules only.
- No external CDNs, no remote fonts. Everything self-contained.
- All data local (IndexedDB). API keys leave the device only toward the
  chosen provider's endpoint.
- Runs from GitHub Pages *and* `bash serve.sh` on Termux (localhost:8080).
  Keep every URL in the app relative.
- Mobile-first. Prose measure ~65ch, serif for prose, system sans for chrome.
- Dark + light themes; respect `prefers-color-scheme` unless overridden.

## Performance laws (locked)

- Exactly ONE streaming generation call per user turn. No pre-calls, no
  agent chains on the send path.
- TTFT: the system prefix must stay stable byte-for-byte so provider-side
  prompt caching hits (anthropic gets `cache_control: ephemeral` on the last
  system block). Nothing dynamic goes before it.

## Contracts to preserve

- `js/store.js` — `export const db` with `settings`, `connections`,
  `stories`, `messages`, `exportAll()`, `importAll(json)`. Promise-based.
  Namespace: `cozytavern.v1` (DB name and backup envelope).
- `js/providers/index.js` — `createProvider(connection)` →
  `{ test(), streamChat({system, messages, signal, onToken}) }`.
- `js/assemble/stack.js` — `buildRequest({story, messages, settings})` →
  `{system, messages}`. **M2 replaces the internals; keep this signature.**
- Service worker: cache-first same-origin shell, network-only for
  cross-origin (API) traffic.

## Seams left for later milestones (do not fill yet)

- `js/engine/` — the scene-state engine. The drawer panels in
  `js/ui/drawer.js` are data-driven stubs waiting for it (M3–M4).
- `js/agents/` — background agents. None may join the send path (see
  performance laws).
- Receipts — a record of what was sent and returned. Lands after the engine.
- `js/assemble/stack.js` is the M1 minimal assembler: frame as system, note
  appended as a final user message. M2 makes assembly position-aware behind
  the same interface.

## Conventions

- Small modules, one job each. UI modules receive a shared context object
  from `js/app.js`; they don't reach into each other.
- Store changes go through `db` only — no direct `indexedDB` calls elsewhere.
- New user-facing copy gets read aloud once before shipping. If it sounds
  like software, rewrite it.

---

# M2 — what changed, and what to hold onto

## What changed

- `js/assemble/stack.js` was rewritten into the full ten-slot, cache-aware
  assembler. The export name `buildRequest` and the starter texts did not
  move. The slot order is law — see the header comment in the file.
- `js/assemble/modules.js` (new) — the rulebook: builtin + user modules,
  pins, predicate stubs, persistence. Builtin texts are condensed from the
  V176 audit, 300–600 words each, no emoji headers.
- `js/assemble/receipt.js` (new) — token estimation (ceil(chars/4)) and
  `finalizeReceipt`. Receipts persist on the assistant message
  (`msg.receipt`) and open via "What the storyteller saw" under each reply.
- `js/engine/state.js` (new) — the per-story state object. M2 writes only
  `present` by hand (the ledger's Who's here panel). Everything else is the
  M3 engine's to fill.
- `js/ui/receiptview.js` (new) — the receipt sheet.
- Providers: `streamChat` now resolves `{text, ttftMs, durationMs}` and
  accepts `systemBlocks` ([{text, cache}]) alongside the M1 string `system`.
- `js/ui/settings.js` gained The rulebook, plus per-story The brief and
  Who's here (cast notes). `js/ui/drawer.js`'s Who's here panel is real.

## Contracts added (M2)

- `buildRequest({story, messages, settings, state, modules})` →
  `{systemBlocks:[{text, cache}], messages, receipt:ReceiptDraft}` where
  `modules` is the selected list from `selectModules` ([{mod, reason}]).
- `state.js`: `emptyState()`, `loadState(id)`, `saveState(id, state)`,
  `renderStateFacts(state)` → string | `''`.
- `modules.js`: `listModules()`, `saveModule(mod)`, `removeModule(id)`,
  `selectModules(modules, state)` → `[{mod, reason}]`. Predicates are
  keyed (`always`/`intimate`/`combat`/`acoustics`) because functions can't
  persist; saved rows re-attach by key. Editing a builtin forks it (a user
  row with the same id); removing the fork restores the original.
- `receipt.js`: `finalizeReceipt(draft, {ttftMs, durationMs, model})` →
  `{v:1, ts, slots:[{name,tokens,source,reason}], totalTokens, ttftMs,
  durationMs, model, stateSummary}`.
- Providers: `streamChat({systemBlocks|system, messages, signal, onToken})`
  → `{text, ttftMs, durationMs}`. Anthropic: system array, `cache_control`
  ephemeral on the LAST cache:true block. OpenAI: cache:true blocks
  concatenate into ONE system message; dynamic slots are user messages,
  never system.
- Wire mapping (documented in stack.js): slots 1–4 → systemBlocks;
  slots 5–6 → ONE user message marked `[story-state]` at the FRONT of the
  messages array; slot 8 = history; slot 10 (when it fires) just before
  slot 9; slot 9 (the note) is always the LAST message.
- State and rulebook persistence ride in the settings store
  (`state:<storyId>`, `modules`) — no schema change, and backups carry both.

## Known seams for M3 (do not fill early)

- `state.js` keys `clock`, `mode`, `bodies`, `relationships`, `offscreen`,
  `factions`, `threads` are the engine's to write. `renderStateFacts`
  already renders anything present.
- Module predicates read hand-set state. The acoustics heuristic is
  documented in modules.js: a present name counts as she/her when the
  story's cast notes (passed in as `state.castNotes` by the send path) mark
  it so, or when the ledger name itself carries "(she/her)". M3's event
  extraction replaces the hand-setting, not the predicates.
- Slot 7 (What remains) is recorded on every receipt, sent as nothing — the
  memory slot, M6.
- Receipts are written but never read by the app itself; no engine consumes
  them yet.


---

# M3 — the scene-state engine & the workers

## What changed

- `js/engine/clock.js` (new) — the in-world clock. State is
  `{calendar, minutes, label, monthNames?, dayNames?}` where minutes counts
  from the proleptic Gregorian epoch (Hinnant's days-from-civil, exact leap
  years, no Date objects or timezones). `createClock`/`setClock`/
  `advanceClock` are pure (fresh copies out); `advanceClock` clamps deltas
  to 0..24*365 minutes. Custom calendars carry their own month/day names
  and borrow the real ones for any unnamed slot. No travel ETAs — that's M4.
- `js/engine/apply.js` (new) — the only place mutations become true.
  Validates the closed v1 vocabulary, applies deterministically, writes a
  plain-words line to `state.log` per change (cap 200), and stores an `undo`
  payload on each line so `undoLast` can take it back.
- `js/engine/state.js` (extended) — state v2: `log:[]` joins the shape,
  present entries may carry `position`/`attire`. `loadState` migrates M2
  states with no loss (string presence entries become `{name}`; an M2
  `{iso,label}` clock keeps rendering until the engine sets it properly).
  Adds `subscribe(storyId, fn)` / `notify(storyId)` — in-memory only; the
  drawer re-renders on change.
- `js/agents/extractor.js` (new) — the background worker. Runs AFTER the
  stream completes, never on the critical path, and never throws into the
  chat path: every failure is `{mutations:[]}`. Anthropic gets an assistant
  prefill of `"{"`; OpenAI gets `response_format: json_object` only when the
  address really is api.openai.com; everywhere relies on the tolerant parser
  (fences stripped, first balanced `{...}` respecting strings). max_tokens
  400, temperature 0. Also holds the in-flight tracker:
  `noteExtraction(storyId, promise)` / `pendingExtraction(storyId, ms)`.
- `js/ui/drawer.js` (rewritten panels) — The clock (label, set-by-hand,
  +15m/+1h/custom advance, calendar mode + comma-list names), Who's here
  (position/attire shown; hand add/remove now rides through mutations so
  it's logged), The mood of the scene (plain-words checkboxes), What changed
  and why (newest first, "Take it back" on the newest standing entry).
  "On their mind" stays a stub — M4.
- `js/ui/settings.js` (extended) — The workers: agent connection picker
  (`workerConnectionId` setting; '' = same as the storyteller) and the
  per-story extraction toggle (`story.extraction`, default on).
- `js/ui/chat.js` (extended) — fires the extractor after the assistant page
  is saved (fire-and-forget); the send path awaits
  `pendingExtraction(storyId, 5000)` before assembling; writes
  `msg.extraction = {appliedWords, rejectedCount}` back onto the same
  assistant message and re-renders its receipt line.
- `js/ui/receiptview.js` (extended) — `openReceipt(receipt, extraction)`;
  the sheet ends with "After this turn" when an extraction exists.
- `js/store.js` (additive) — `messages.append` passes `extraction` through
  the same way it passes `receipt`; re-appending a message with its id
  re-inks the page (that's how the extraction lands after the fact).
- `sw.js` — cache bumped to v3; the three new modules joined the shell list.

## The mutation vocabulary (v1 — closed list; unknown types rejected)

```
clock.set {year,month,day,hour,minute}     clock.advance {minutes, reason}
presence.enter {name, position?, attire?}  presence.leave {name}
presence.update {name, position?, attire?}
mode.set {flag, reason}                    mode.clear {flag}
```
flag ∈ combat, intimate, travel, socialField, isolation, group. Names
normalize (trim, collapse whitespace; matching is case-insensitive, stored
casing wins). `applyMutations(state, mutations)` → `{state, applied:
[{mutation, words}], rejected: [{mutation, why}]}` — `words` is the sentence
the log speaks. `undoLast(state)` → `{state, words}` | null.

## Contracts to preserve (added in M3)

- `clock.js`: `createClock({calendar, start})`, `setClock(state, parts)`,
  `advanceClock(state, deltaMinutes, reason)`, `renderClock(state)`.
- `apply.js`: `applyMutations`, `undoLast`, plus `MODE_FLAGS`/`MODE_WORDS`
  (the drawer's mood panel shares the words).
- `state.js`: v2 shape + `subscribe`/`notify`.
- `extractor.js`: `extractTurn({connection, state, userText, assistantText,
  signal})` → `{mutations}` — never throws; `noteExtraction` /
  `pendingExtraction` — the send path's courtesy wait.

## The latency law, restated

One streamed generation per user turn. The extractor fires only after the
stream completes and its promise is never awaited by the turn that fired it.
The NEXT send awaits `pendingExtraction(storyId, 5000)` — hard ceiling, then
last-good state — before `buildRequest`. State consistency without prose
ever waiting on the workers.

## Seams for M4 (do not fill early)

- `state.bodies`, `state.relationships`, `state.offscreen`, `state.factions`
  exist and `renderStateFacts` already passes anything in them along, but no
  engine writes them. "On their mind" in the drawer is their panel.
- The clock doesn't derive travel ETAs; that rides with the offscreen engine.
- `state.log` entries carry `undo` payloads beyond the documented
  `{ts, words, undone}` — the additive piece undoLast needs. Keep them when
  touching the log shape.
- The extractor's vocabulary is v1-closed; M4 engines (bodies,
  relationships) will want new mutation types — extend HANDLERS in apply.js
  and the prompt's vocabulary list together, never one without the other.

---

# M4 — the ledgers: bodies, standings, and the world elsewhere

## What changed

- `js/engine/bodies.js` (new) — the body ledger. Per character:
  `{injuries:[{what, sev:1|2|3, atMinutes, treated, healed}], strain:[...]}`.
  Pure functions (`addInjury`/`addStrain`/`healInjury` — fresh copies out).
  Ages render from the story clock (`clockMinutes − atMinutes`); when no
  clock is set, entries fall back to the turn count via an additive `atTurn`
  field (the log's length when written — same pattern as M3's `undo`
  payload). Healed injuries keep their record but stop rendering (scars of
  record). Severity words are law: 1 "a graze/bruise-class", 2 "a real
  wound", 3 "severe" (`SEV_WORDS`).
- `js/engine/relationships.js` (new) — P:R:S standings toward the main
  character, and ONLY toward the main character (axis lock: there is no
  NPC↔NPC type anywhere in the vocabulary, so none can ever be written).
  Zero-init: no entry exists until the first caused shift. Deltas clamp
  ±20 per beat, totals ±100. Every shift needs a cause in words — the
  applier rejects any without one. `historyWords` gives the drawer's
  "grew warmer after the chapel" line.
- `js/engine/offscreen.js` (new) — where the absent are: `{location,
  activity, agenda?, sinceMinutes}` plus additive `atTurn` for recency.
  presence.leave never seats (the prose has to say where they went);
  presence.enter auto-unseats, and its undo puts the seat back.
  `renderOffscreen` shows the top 6 by recency, skipping anyone present.
- `js/engine/apply.js` (extended) — the v2 vocabulary, validated and
  undoable like v1:
  ```
  body.injure {name, what, sev?, treated?}   body.strain {name, what}
  body.heal {name, what}
  rel.shift {name, axis, delta, cause}       rel.set {name, p?, r?, s?, cause}
  offscreen.set {name, location, activity, agenda?}   offscreen.clear {name}
  ```
  New undo kinds ride the same log payload: `body.restore`, `rel.restore`,
  `offscreen.restore` (deep "before" snapshots), and `presence.remove`
  gained an `offscreenBefore` for the auto-unseat. `body.heal` matches
  injuries by exact-then-substring words; when no injury matches it lifts
  a strain instead (strain keeps no healed flag). Free text is trimmed and
  length-capped (`capText`) so no single note can blow the render budget.
- `js/engine/state.js` (extended) — state v3. `loadState` migrates v1/v2
  objects: the three ledgers are coerced into shape, unknown extra fields
  ride along, nothing is dropped. `renderStateFacts` now speaks real
  sections in law-order (clock, presence, bodies top-4, standings top-6 by
  |total|, elsewhere top-6, mood words; threads trail) under a hard budget:
  `STATE_BUDGET = 1600` chars (~400 tokens). Section caps do the daily
  work; if words still run long, lower-priority sections are shed — the
  hour and who's here always stay.
- `js/agents/extractor.js` (extended) — the v2 vocabulary joined the prompt
  with the conservatism law restated (injuries only when the blow lands
  on-page; feelings only from on-page acts with a cause quoting the beat;
  never invent off-screen doings). max_tokens is 600 now. Everything else —
  prefill, tolerant parser, never-throws — unchanged.
- `js/ui/drawer.js` (extended) — three real panels: "How they're holding
  up" (heal/lift/add by hand), "On their mind" (standings in plain words +
  history line; hand shift or outright set, cause always required),
  "What's happening elsewhere" (seat/edit/let go by hand). All hand edits
  ride `handMutate` → `applyMutations`, so they're validated, logged, and
  undoable exactly like the workers' proposals.
- `sw.js` — cache bumped to v4; the three new engine modules joined the
  shell list.

## Contracts to preserve (added in M4)

- `bodies.js`: `addInjury(bodies, name, {what, sev, treated}, clockMinutes)`,
  `addStrain(bodies, name, {what}, clockMinutes)`, `healInjury(bodies, name,
  what)`, `renderBodies(bodies, clockMinutes)` (optional third arg = turn
  count), `SEV_WORDS`.
- `relationships.js`: `shift(relationships, name, {axis, delta, cause},
  clockMinutes)`, `renderRelationships(relationships)`, `axisWords`,
  `historyWords`, `AXES`.
- `offscreen.js`: `seat(offscreen, name, {location, activity, agenda},
  clockMinutes)`, `unseat(offscreen, name)`, `renderOffscreen(offscreen,
  present)`.
- `state.js`: `STATE_BUDGET` export; renderStateFacts section order is law.
- The v2 mutation types above. Extend HANDLERS and the extractor prompt's
  vocabulary together, never one without the other.

## Seams for M5+ (do not fill early)

- `state.factions` still has no engine; `threads` remains hand/legacy —
  rendered but not yet written by any worker.
- The clock doesn't derive travel ETAs from offscreen locations; that's a
  later milestone's call.
- Preset migration (M5) and the referee/memory/continuity agents (M6) are
  untouched: no new agent joins the send path, ever (the latency law).

---

# M5 — bring your engine (preset migration)

## What changed

- `js/import/v176map.js` (new) — the known-entry map for the Simulation
  Engine V176 preset, keyed by name with case-insensitive, emoji-tolerant
  whole-phrase matching (`normalizeName` + containment on word boundaries).
  Buckets: craft (10), modules with triggers (9: intimate ×1, combat ×1,
  socialField ×1, manual ×6), frame seeds (3, copy-only), retired-engine
  (5), retired-house (2 + all CoT blocks), skipped (markers by
  identifier/name, "⛔ … IS OFF" toggles — checked FIRST so their names
  can't false-match retired keys —, Enhance Definitions / Auxiliary Prompt,
  Post-History Instructions when empty). `heuristicSort` catches every
  other preset: keyword guesses (intimate/combat/socialField), "jailbreak"
  → frame seed, empty → skipped, in-chat (pos 1) unknowns → manual module,
  everything else → craft — all marked `guessed` so the preview says so.
- `js/import/sillytavern.js` (new) — `parsePreset(jsonText)` (throws kind,
  human Errors on garbage/empty/wrong-shape JSON; marries `prompt_order`'s
  enabled flags back onto entries), `decompose(entries)` → Plan with
  per-item `include` flags the preview checkboxes flip in place, and
  `applyPlan(plan)` → summary. Craft entries join in original order into a
  `core-craft` user override (a fork — the shipped original stays
  restorable). Modules land as user modules, deduped: identical text under
  the same name (or one of its numbered suffixes) is "already home" —
  re-imports are no-ops — while a taken name with different words gets
  ` (2)`, ` (3)`… Frame seeds are copy-button only, never auto-written.
  `summaryWords` phrases the after-apply line.
- `js/assemble/modules.js` (extended) — two new predicate keys:
  `socialField` (mode.socialField, reason "the room is full of voices") and
  `manual` (never wakes on its own). New exported `WHEN_WORDS` table maps
  every key to plain-words trigger text for custom rules and the preview.
  Custom rules may now carry a known `whenKey` (unknown keys fall back to
  pin-only) and a `note` string, both persisted on the saved row; manual
  imported rules carry "you choose when this walks in", shown in the
  rulebook. Builtin behavior and existing keys are byte-identical.
- `js/ui/settings.js` (extended) — "Bring your engine" section: file picker
  or paste → **Read it over** → grouped preview (The craft / The rulebook /
  Seeds for the frame & the note / Retired into the house + a quiet skipped
  count) with per-item include checkboxes → **Bring it home** → applyPlan →
  plain-words summary and the rulebook re-rendered in place. All parsing is
  client-side; nothing uploads.
- `index.html`, `css/chat.css` — markup and a few quiet styles for the
  section. `sw.js` — cache bumped to v5, the two import modules joined the
  shell list.

## Contracts to preserve (added in M5)

- `parsePreset(jsonText)` → `{entries:[{name, identifier, content, enabled,
  role, pos, depth}], warnings:[]}` — throws (kindly) on bad input.
- `decompose(entries)` → `{craft, modules, frameSeeds, retired, skipped}`;
  `applyPlan(plan, opts)` → `{craftWords, modulesAdded,
  modulesAlreadyHome, retiredCount, skippedCount}`.
- `modules.js`: `WHEN_WORDS`, predicate keys now `always`, `intimate`,
  `combat`, `acoustics`, `socialField`, `manual`.

## The privacy law (locked, restated)

The user's real preset (`/tmp/v176-preset.json`) is harness material only.
It is never committed, never a fixture, never quoted into shipped files.
Before any commit touching import code: `grep -r "Simulation Engine V176" .`
must find only code references (map names, comments), and a content-snippets
scan of the tree against the real file must come back empty.

## Seams for M6 (do not fill early)

- The retired shelf's whys point at engines ("the registry keeps names
  unique", "the canon store verifies") that partially still land in M6 —
  the words are promises the house intends to keep.
- Frame seeds stay copy-only; nothing yet writes Frame/Note text on the
  user's behalf, and that restraint is deliberate.
- Referee/memory/continuity agents remain M6's; no agent joins the send
  path, ever (the latency law).

# M6 — the referee, the canon store, the memory keeper, the continuity check

## What changed

- `js/agents/referee.js` (new) — the ONLY agent allowed before the story
  generation, and only when `shouldAdjudicate` fires: an inline `#roll` in
  the user's words, or `state.mode.combat === true` (the trigger law). The
  model reads the board and picks a rung (5 clearly favored / 10 even / 14
  disadvantaged / 18 outclassed — snapped if it invents one); the d20 is
  rolled IN CODE with crypto.getRandomValues (rejection-sampled, perfectly
  uniform). Margin → outcome: +10 decisive / +5 clean / +1 a success with a
  cost / 0 partial / −5 failure / −10 failure with consequences / −15
  catastrophic. Tiny and cold (max_tokens 150, temperature 0); never
  throws; a failure simply means no ruling this turn.
- `js/engine/canon.js` (new) — `state.canon = { [name]: {facts:[{key,
  value, atMinutes}]} }`, what's true of them. `lockFact` / `unlockFact`
  are pure (fresh copies out), case-insensitive on name and key.
  `renderCanon` speaks the present characters' facts only, compact; it
  joins slot 5, counts toward the 1600-char budget, and sheds after the
  body ledger.
- `js/agents/memory.js` (new) — the keeper. Store key `memory:<storyId>` =
  `{window:30, nodes:[{id, span:[fromIdx,toIdx], text, level, at}]}` in the
  settings store, so backups carry it. Threshold: history beyond window+20
  folds the oldest pages into a level-1 note (~150 words, faithful); more
  than 6 level-1 notes folds the oldest 3 into a level-2 note. Slot 7,
  "What remains", is the newest 3 node texts (level descending), budget
  3200 chars — and the receipt slot appears ONLY when memory exists (this
  supersedes M2's "kept place" row). The switch (`memoryKeeper`, default
  on) and the window (`memoryWindow`, 10–100, default 30) are app-wide
  settings under "How much the story remembers".
- `js/agents/continuity.js` (new) — the second reader: advisory only, OFF
  by default (`continuityCheck`). Compares each finished page against ALL
  canon and the ledgers; findings `[{words, severity:'note'|'warn'}]` are
  stored on the assistant message (`msg.findings`), shown on the receipt
  ("Drift") and the drawer ("Something drifted"). It never edits prose,
  never blocks, never throws.
- `js/engine/apply.js` (extended) — v3 of the closed vocabulary:
  `canon.lock` / `canon.unlock`, validated, logged, undoable
  (`canon.restore`).
- `js/engine/state.js` (extended) — state v4: `canon`, `pendingVerdict`
  (consumed by the next buildRequest, then cleared), `lastVerdict` (the
  drawer's echo); memorySettings and anything unknown pass through on
  migration. `renderStateFacts` speaks the ruling at the head of slot 5
  (never shed) and the locked truths after presence.
- `js/assemble/stack.js` (extended) — `buildRequest` takes `memory` (slot
  7's text); the receipt's "What remains" appears only when memory exists;
  slot 7 rides the `[story-state]` injection after the active modules.
- `js/agents/extractor.js` (extended) — the in-flight tracker widened to a
  chain: `noteWork` / `pendingWork(storyId, 5000)` give EACH background
  link its own hard five seconds; the M3 names remain as aliases.
- `js/ui/chat.js` (extended) — the send path: await the background chain →
  referee pre-send when triggered (verdict into state) → buildRequest →
  consume-and-clear the verdict. Post-stream fan-out, in order: extractor →
  memory keeper → continuity reader, all in the background.
- `js/ui/drawer.js` (extended) — three panels: "The house has ruled" (the
  latest ruling), "What's true of them" (the canon store, hand-editable via
  the v3 mutations), "Something drifted" (the second reader's notes).
- `js/ui/settings.js` + `index.html` (extended) — "How much the story
  remembers": the keeper's switch, the word-for-word window slider, and the
  second reader's switch.
- `js/ui/receiptview.js` (extended) — the receipt gains a "Drift" section
  when a page carries findings.
- `js/store.js` (additive, same pattern as M3's `extraction`) — messages
  carry `findings`; a story's `memory:<storyId>` key is let go with the
  story.

## Contracts to preserve (added in M6)

- `shouldAdjudicate({userText, state})` → true iff inline `#roll` OR
  `state.mode.combat === true`. No other trigger, ever.
- `adjudicate({connection, userText, state, signal})` →
  `{dc, roll, margin, outcome, words}` | null on any failure. Never throws;
  never rolls the die anywhere but in code.
- The referee's verdict is consumed by exactly one buildRequest and
  cleared; slot 5's receipt records it.
- `maybeSummarize({connection, storyId, signal})` — threshold-gated
  (window+20), layered (7+ level-1 → fold oldest 3 into level 2), never
  throws; the keeper's off-switch means it never wakes.
- Slot 7 = newest 3 node texts, level descending, 3200 chars; receipt slot
  only when memory exists.
- `checkTurn({connection, state, assistantText, signal})` →
  `{findings:[{words, severity:'note'|'warn'}]}`; advisory only; never
  throws; never touches prose.
- The fan-out order (extractor → keeper → reader) and the 5-seconds-each
  courtesy wait are the latency law, restated.

## Verification

- `node --check` clean on every `.js` file.
- Harnesses (kept in /tmp during development, not shipped):
  `m6-harness.mjs` (150 checks: curve/DC boundaries, crypto d20
  distribution over 1000 rolls, trigger truth table, consume-and-clear
  across a buildRequest, memory threshold/layering math, slot-7 budget,
  canon lock/unlock/render-budget, continuity parse tolerance,
  referee/keeper/reader never-throws under a failing provider, v3→v4
  migration no-loss, the pendingWork chain) and `m6-regression.mjs`
  (73 checks re-proving M1–M5). All green at commit time.

## Seams for M7 (do not fill early)

- SillyTavern character cards, lorebooks, and chat import remain M7's; the
  canon store is the landing shelf for a card's locked truths, but nothing
  writes to it from import yet.
- The verdict is one line of fact per ruling; no roll history or odds
  display beyond "The house has ruled" is promised.

---

# M7 — SillyTavern imports, hardening, polish (v1 complete)

## What changed

- `js/import/cards.js` (new) — character cards. `parseCard(fileOrText)`
  accepts a browser File (PNG or JSON), a JSON text string, or raw bytes
  (the harness path) — what a thing IS is read from its contents, never
  its name. The PNG walker reads chunks by hand (length/type/data/CRC),
  finds the tEXt or iTXt chunk with keyword `chara`, verifies ITS CRC
  (a disagreement is a "damaged page" kind error), decodes base64 → JSON
  → v2 `payload.data` (a flat v1 card reads too). iTXt: uncompressed and
  zlib-compressed both read (DecompressionStream). Kind errors throughout:
  "That picture doesn't carry a character." for a cardless PNG, a damaged
  line for cut-short/bad-CRC, a not-JSON line for garbage. A JSON object
  with no recognizable card fields is refused kindly. The cast library is
  app-wide (`cast:<cardId>` in the settings store, so backups carry it);
  stories hold `castIds`. `removeCastMember` un-invites everywhere.
  `castForStory(story)` (additive helper) resolves a story's invitations
  to full Cards for the assembler.
- `js/import/lorebook.js` (new) — World Info JSON. `parseLorebook` reads
  entries as object or array, `key`/`keys`, `disable`/`enabled`; kind
  errors on garbage/wrong-shape/empty. `saveLore`/`loadLore` keep the
  shelf under `lore:<storyId>` (settings store; backups carry it; it goes
  with its story). `matchLore(entries, recentText, budgetChars=1200)` is
  pure and deterministic: case-insensitive whole-word hits (letters and
  numbers are word, everything else is a boundary; "Ashford" never wakes
  "ash"), scored by DISTINCT keys hit, strongest first with shelf order
  breaking ties, contents joined under budget — an overlong lone entry
  trims with an ellipsis, an entry that no longer fits stays home.
  recentText = the last user message + the last assistant message. No LLM.
- `js/import/chats.js` (new) — ST chat JSONL. First line must carry
  `chat_metadata`; title comes from `character_name` ("With Mara Vane",
  else "An old tale, brought home"). Each message line:
  `{name, is_user, mes, send_date}` — is_user true → user, anything else
  → assistant; prose verbatim; send_date parsed, missing → steady sequence
  fallback. A malformed line, a line without `mes`, a cover-only file:
  kind errors (with the line number), nothing half-imported.
  `importAsStory` creates the story and appends the pages.
- `js/store.js` (extended) — additive `settings.keys()` and
  `settings.delete(key)`; `stories.remove` now also lets go of
  `lore:<storyId>` (cast stays — it's app-wide). Backup/import were
  already whole-settings-store, so cast + lore ride along unchanged.
- `js/assemble/stack.js` (extended) — `buildRequest` takes `cast` and
  `lore`. Slot 4: for each invited card whose name appears in
  state.present (case-insensitive, "(she/her)"-style parentheticals
  ignored — same normalization as the acoustics predicate), `name —
  description` rides, description trimmed to 400 chars; the section holds
  1600 chars total — cast notes and the present line keep their seats,
  cards join while there's room. Slot 7: memory first (unchanged), then
  lore in the room left within the keeper's 3200-char budget
  (`SLOT_BUDGET` imported from agents/memory.js — single source of truth);
  the receipt lists "What remains" and "The lore shelf" as separate
  sub-parts, each only when present (M6's silent-when-empty law widened,
  not broken).
- `js/ui/chat.js` (extended) — the send path loads the story's invited
  cast and lore shelf (store reads only) and passes them to buildRequest.
  Zero new per-turn calls; the latency law is untouched.
- `js/ui/settings.js` + `index.html` (extended) — three sections: "Bring
  your people" (card picker + the cast library shelf with remove), "Bring
  your lore" (per active story, "N entries on the shelf", take the shelf
  down), "Bring your old chats" (JSONL → a new story, made active).
- `js/ui/drawer.js` (extended) — Who's here: invited cast listed with the
  book-mark (❧) and a × to let the invitation go; an invite picker offers
  whoever is still on the shelf.
- `index.html` / css — polish: focus-visible rings extended to links,
  `@media (prefers-reduced-motion: reduce)` stills every transition and
  the blinking caret, safe-area right insets on drawer and receipt sheet
  (top/bottom were already there from M1).
- `sw.js` — cache bumped to v6; the three import modules joined the shell
  list; a full audit confirmed every shipped js/css/asset file is listed.
- `README.md` — rewritten as the v1 front door (what it is, install via
  Pages or Termux `serve.sh`, the rooms, the engines and agents in plain
  words, privacy, importing from SillyTavern, the smoke pointer).

## Contracts to preserve (added in M7)

- `parseCard(fileOrText)` → Card `{id, name, description, personality,
  scenario, firstMes, creatorNotes, alternateGreetings:[], source,
  importedAt}` — throws kindly on anything that isn't a card.
- `listCast()` / `saveCastMember(card)` / `removeCastMember(id)` /
  `attachToStory(storyId, cardId)` / `detachFromStory(storyId, cardId)`.
- `parseLorebook(jsonText)` → `[{id, keys:[], content, enabled}]`;
  `saveLore(storyId, entries)` / `loadLore(storyId)`;
  `matchLore(entries, recentText, budgetChars=1200)` → string.
- `parseSTChat(jsonlText)` → `{title, messages:[{role, text, ts}]}`;
  `importAsStory(parsed)` → storyId.
- Slot 4 budget 1600 / per-card description 400; slot 7 shared budget
  3200 (memory first). Receipt sub-parts appear only when present.
- `db.settings.keys()` / `db.settings.delete(key)` (additive).

## Verification

- `node --check` clean on every `.js` file.
- Harnesses (kept in /tmp during development, not shipped):
  `/tmp/m7-harness.mjs` (115 checks: chunk walker incl. tEXt/iTXt/zlib/
  bad-CRC/multi-chunk/truncated/non-card; JSON cards incl. v1 + alternate
  greetings; whole-word scoring + budgets; JSONL roles + kind-failures;
  slot 4/7 budgets; cast/lore round-trips via the IndexedDB shim; story
  removal cleanup; backup carrying cast + lore), fixtures built by
  `/tmp/m7-fixtures.py` (Pillow). Full M1–M6 re-run green:
  m6-harness.mjs 150 checks, m6-regression.mjs 73 checks.
- Static serve + curl: all changed files 200 with correct MIME; sw shell
  list audited complete.

## The privacy law (unchanged, restated)

Card/lore/chat fixtures live in /tmp for harnesses and hand testing only.
No user payload is ever committed, shipped, or quoted into shipped files.

## Seams beyond v1 (do not fill early)

- A card's creator notes and alternate greetings are shelved but not yet
  offered as story starters; firstMes likewise. Deliberate restraint.
- The lore shelf listens only to the two latest pages; a deeper memory of
  keys is a later milestone's call, if ever.
- Nothing from imports writes to the canon store yet; locked truths stay
  hand-set or engine-earned.

---

# M8 + M8.5 — hearth design + the thinking voice
- onToken signature is now channel-aware: onToken({channel:'thinking'|'prose', text}).
- streamChat resolves {text, thinking, ttftMs, tfftMs, durationMs}. ttft = first PROSE; tfft = first THOUGHT (null when quiet).
- Connections carry: temperature, topP, maxTokens (default 4096), contextSize, reasoning {effort:'off|low|medium|high', budgetTokens?}. Provider mapping: anthropic thinking{budget_tokens} + FORCES temperature:1 and drops top_p (effort→budget low 2048 / medium 8192 / high 24576, explicit budget wins); openai reasoning_effort; openrouter reasoning{effort|max_tokens}; custom openai passthrough.
- openai-compatible parser routes delta.reasoning_content ?? delta.reasoning to the thinking channel; a leading literal <think>…</think> in the prose channel is split out by a stream state machine (chunk-safe).
- Messages may carry msg.thinking (persisted) and msg.stopped (user aborted mid-stream; UI labels "stopped mid-sentence").
- store.js: messages.remove(storyId, messageId) added; connections.update treats null as "leave the dial alone".
- First-send with no story auto-creates one named from the first words; no-connection send keeps the text and shows a kind inline note. Composer never silently swallows words (B2 killed at the root).
- Design tokens: Hearth (dark, default) + Parchment themes per SPEC M8 exact sheet; serif --font-prose kept for prose/headings; theme key stays 'theme'.

---

# M9 — the interaction loop & truth fixes
- Slot 8 (story-so-far) law: ONLY the verbatim window rides (keeper on: memory.window;
  keeper off: token-budgeted cutoff with an honest receipt line). Hidden pages never ride.
- systemBlocks are positionally stable (slots 1–4 always four blocks, empty text allowed);
  PROVIDERS drop empties when mapping to the wire. Cache breakpoint = end of slot 2; slots
  3–4 are cache:false (A4).
- Messages may carry swipes[]+swipeIdx (text mirrors the shown swipe), hidden, cutShort,
  ooc. messages.update patches without resurrection; appendAll imports atomically.
- The command parser (js/commands.js): #question/#p/#pp/#continue/#time, ((…)) and // asides;
  unknown # passes through with a hint. Commands become hidden directives on the wire.
- The lore shelf: entries {id, keys, content, enabled, constant?, secondaryKeys?, depth?};
  ST fields constant/keysecondary/scan_depth are read on import. Constant rides first.
- The workers: every background call rides workerSignal() (60s hard timeout); worker status
  lives at workers:<storyId>, shown as "The workers" in the drawer. Per-story switches are
  separate: ledger (extraction), keeper, reader.
- Tab lock (js/tablock.js): first tab writes; a second tab reads with a plain notice.
- One VERSION in js/version.js; sw.js derives its cache name from it. Harnesses ship in
  tests/harness/ — `node tests/harness/run.mjs` must be green before any commit.
- Audit closures: B1–B20, A1–A8 all addressed in code (B15 docs this entry).

---

# M10 — the housekeeper & the showrunners
- js/agents/housekeeper.js: the master-AI. Protocol blocks: <edits> (pages: find/replace,
  whole-replace, hide, bulk_replace), <ledits> (ledger mutations — MUST ride engine/apply.js's
  closed vocabulary; module.pin routes to modules.js), <redits> (rulebook find/replace),
  <fetch> (self-serve pages), <supersede>. locate(): exact -> normalized -> fuzzy (>=0.78,
  ambiguity refuses); minimalDiff salvage once. Proposal cards staged with review-hashes;
  undo = node-scoped batches (before-values + after-hashes, cap 50) that REFUSE on drift.
  Session store hk:<storyId>; context = brief + message index + last-N full (hkContextPages,
  default 12) + ledger summary + rulebook names + director/editor blocks.
- js/agents/director.js: {text, episode, concluded, auto}; modes new/next/seed/edit/restart;
  3 passes (skippable); [EPISODE_END] stripped in chat.js before save; conclusion chain =
  editor review then auto-next when auto. js/agents/editor.js: standing critique, diffed,
  cadence/manual/episode-end.
- stack.js gains dynamic-tail slots "The director's note" / "The editor's eye" (empty =
  omitted, receipt-named), before history. Showrunner work never joins pendingWork (latency law).
- Fixed a latent M9 ReferenceError: drawer.js PANELS referenced an undefined workersPanel.

## M11 — the autonomous referee (true Arbiter port)
- The M6 referee (#roll d20 verdicts) is REPLACED. js/agents/referee.js is now the Arbiter port: local gate (DEFAULT_VERBS/ATTEMPT_RE/OOC_RE/stripDialogue, sensitivity, in-fight bypass) → micro-call (worker connection, 600 tok, temp 0, 12s, ONE retry, balanced-brace JSON) → ALL math in code.
- js/engine/referee-math.js is pure: probFromDelta logistic (±13), sliceOutcome mirrored 6-tier (mirror law: (u,P)->(1-u,1-P) identical with dec/dis+cost/sb swapped), tieCheck (|u-P|<=0.06 → TRADE/STALEMATE, never extremes, never lone checks), crypto rngFloat, TIER_RATINGS, PRESETS, EXCHANGE_EFFECTS (margin-scaled, momentum ±0.5 cap 1, symmetric openings), RECOVER_EFFECTS, composurePenaltyOf (0 above half → -3).
- js/engine/duels.js: duel/battle/war state machines on state.duel/state.battle; recovery economy (tier heal, one-pool cap, free swing floored ≥0.5 while a standing foe rates 3+); tracked vs outcome-only styles; directive builders ("The house has ruled —"); renderFightLine.
- apply.js v4: combat.begin/combat.end (mode.combat + engine state + injuries→bodies on end; undo kind combat.restore). state.js v5: sheet/duel/battle/composure/refHistory/seedDueAfterFight.
- Committed fate: state.refHistory (cap 12) holds {key=userMessageHash, msgId, verdict, snap(pre-turn duel/battle/composure/turn)}; swipes replay; edits rewind+fresh roll; deleted/branched suffixes rewind.
- Injection: buildRequest `ruling` → dynamic-tail slot receipt-named "The house has ruled" (last tail part); chat.js consumes pendingVerdict per turn. Seeding: maybeSeedSheet (4th background link). Settings keys: refereeOn/refereeSensitivity/refereePreset/refereeFightStyle. Harness: tests/harness/referee.mjs.

---

# M12 + M13 — the finishing wave
- js/engine/people.js: character ledger {core, state, arc, threads[], updatedAtTurn}; MC record-only
  enforced in mergeDeltas (persona redirect + contamination guard + bounded-Levenshtein name resolution).
  Tiered injection via renderPeopleTiers: present full cards cap 6, also-present lines, mention-recall
  cap 3 (500 chars, "not in the scene"), rotating roster cap 12; aging labels ("Now:" -> "Last noted N
  turns ago:" >20 turns); 2400-char budget with shed order.
- apply.js: people.set {name, field, text} (MC core/arc refused) + people.restore undo.
- js/agents/queue.js: exclusive SEQUENTIAL worker channel per story; epoch purge on story switch
  (purged jobs settle stale); 5 retries 2s->60s exponential honoring Retry-After floor; 60s per-call
  workerSignal; every settled run lands on the drawer workers line with one plain word.
- js/agents/scribe.js: live ledger scribe after extraction (gated by the ledger switch).
- memory.js: detail auditor per fold — NONE or one DETAIL line stored on the node, injected as a slot-7
  bullet; discard-if-moved guard via store re-read + node signature.
- stack.js: "On their mind" tiered block in the slot-5 area (named receipt slot); coverage law in
  windowPlan — slot 8's verbatim window extends so no uncovered turn is ever dropped (activates when
  callers pass nodes; chat.js always does).
- chat.js: worker chain routed through the queue (extractor -> scribe -> keeper -> continuity -> seeder),
  stale() checked before every commit.
- FIXED a latent HEAD defect: app.js called initHousekeeper(ctx) without importing it (boot-time
  ReferenceError). Import added.
- js/ui/welcome.js: createTour machine (3 steps), welcomeSeen flag (shows once), "The guided tour"
  re-opens from settings; "How the tavern works" sheet (settings link + welcome step 3).
- serve.py binds and prints http://127.0.0.1:PORT (Android localhost->::1 ambiguity avoided).
- install.sh: idempotent Termux one-shot; writes $PREFIX/bin/cozytavern (wake-lock hint + pull +
  port-check + serve + open-url).
- js/version.js is the single version source; sw.js cache name derives from it.

---

# M14 — the beauty pass + latent bug sweep
- ROOT CAUSE of the "dead app" the user saw: index.html was missing the card-editor form
  (#card-form etc.); initSettings threw at boot, aborting start() before initChat /
  initHousekeeper / initWelcome. One missing element killed the tour, the thread, and the
  frame textarea. NEW LAW enforced by tests/harness/beauty.mjs: every getElementById literal
  must exist in index.html (id-coverage harness check).
- drawer.js: measurePanel implemented (was referenced, never defined — ledger click threw).
- app.js: #btn-housekeeper wired (no listener existed). composer-chip element added.
- chat.js: THE HEARTH empty state (book mark, serif greeting, starter chips seed the
  composer, "pick up a tale" when stories exist); story rows gain relative time + page
  count (db.messages.count added); ember meta label visible at 0%; story-created toasts.
- welcome tour verified firing on true first run (fresh-profile browser proof).
- version.js -> m14-001. Harness 122/122.

---

# M15 — the last polish + the great un-inerting
- THE BIG ONE: chat.js called showrunner functions (loadDirector, loadEditor, stripEpisodeEnd,
  maybeAutoDirector, maybeRunEditor, afterEpisodeEnd, renderDirectorNote, renderEditorNote) without
  importing them (missing since M10) + undeclared episodeEnded — every send threw ReferenceError.
  The app could not complete a turn. Fixed. New harness law (polish.mjs): no ghost calls — every
  called cross-module name must be imported; every locally-called function must be declared.
- More audit fixes: lore hand controls missing imports; renderReferee undefined (killed settings
  below the memory room) + referee dials now wired; drawer void mcLabel crash; workers line
  fmtWhenWords missing; tour-again getter-only assignment -> tour.restart(); swipe on fresh page
  early-return -> now regenerates per M9 law; branch action added to message row.
- Beauty: msg-rise entrance, ember caret, press/hover states, thread vignette, scene-head
  typography (parseScene), drawer hairline sections, settings cards, sidebar colophon,
  ember-bar pulse while streaming.
- QA TOOLING LAW: SSE mock must send Connection: close (keep-alive hangs fetch streams).
- Browser audit: 49/49 vs mock provider, 0 page errors; evidence set /mnt/agents/output/qa-m15-*.png.
- Harness: 132/132 (tests/harness/polish.mjs added). version.js -> m15-001.
- Known minor: no-connection note visibility refreshes on next thread render (cosmetic).

---

# M16 — projects + the update nudge + version you can see
- THE UPDATE NUDGE (app.js): registration wires updatefound -> installing worker's
  statechange; when state=='installed' AND an old controller exists, a TAPPABLE toast
  ("A new coat is on the tavern — tap to refresh.") appears — toast(words, onTap) variant
  never auto-dismisses and gets pointer-events:auto (the toasts layer is pointer-events:none).
  controllerchange -> location.reload() with TWO guards: `reloading` once-flag AND
  `hadController` (a first visit settles in without a reload; no loop possible).
- PROJECTS (store.js): the shelves live as ONE list under settings key `projects`
  ({id,name,createdAt}) — no schema change, rides backups. db.projects: list/create/rename/
  remove; remove NEVER deletes tales (projectId -> null, they stand loose). stories.create
  accepts projectId. shelvesOf(stories, projects) is the exported pure grouping (recency
  order preserved; bent/unknown projectId -> loose) — the harness walks it.
- SIDEBAR (chat.js/index.html/css/chat.css): sections per shelf — collapsible .lbl header
  (caret, name, page-count badge = summed pages), tales in interaction-recency order,
  "Loose tales" section last. Fold state persists under settings key `shelfCollapsed`
  ({id|'loose': true}). Shelf rename inline (beginShelfRename), takedown via confirm with
  "the tales stay" copy. "A new shelf" inline form beside "Start a new story"; the new-story
  form gains a shelf pick defaulting to the open tale's shelf (or loose).
- STORY SETTINGS (settings.js): new section "The shelf it sits on" (#section-shelf,
  #story-shelf) moves the active story; sidebar re-gathers immediately. Settings header
  shows "the shelves · <VERSION>" (#settings-version, .lbl micro-caps).
- TOUR (welcome.js): last step gains "the housekeeper keeps the tale tidy — find it up top".
- Harness: tests/harness/projects.mjs (+7 = 139/139): projects CRUD, story move,
  delete-keeps-stories (pages survive too), shelvesOf grouping/ordering/bent-id laws,
  updatefound+controllerchange wiring, version line + tour line, sidebar wiring.
- Browser QA (mock SSE provider, fresh profile, 0 page errors): shelves render, collapse
  persists across reload, move picker works, takedown keeps tales loose, SW active.
  Evidence: /mnt/agents/output/qa-m16-*.png. version.js -> m16-001.

---

# M17 — every worker may have hands of its own
- js/agents/assign.js: pickWorkerConnection + WORKER_ROWS. Chain: per-worker pick
  (settings.workerConnections map) -> M3 general workers' pick (workerConnectionId) ->
  caller falls back to the story's connection. Stale ids degrade down the chain, never shadow.
- chat.js resolveWorkerConnection(story, worker); call sites tagged: extractor, scribe,
  keeper, continuity, seeder, referee, showrunner. housekeeper.js reads the same map.
- Settings → The workers: per-worker pickers under the general one ("hands of their own").
- Harness: tests/harness/assign.mjs (5 checks). version.js -> m17-001.

---

# M18 — discoverability + update clarity
- POCKET HEADER (index.html/css/base.css): the topbar gains a .topbar-main box
  (☰ + brand; flex:1, min-width:0 — desktop layout is pixel-identical). At
  <=720px the topbar wraps: row 1 is .topbar-main (flex-basis:100%), row 2 is
  .topbar-actions (flex-basis:100%, hairline top border) with the three rooms
  as equal-width quiet buttons (flex:1 1 0, border-left separators, 0.85rem,
  ellipsis fallback so nothing can ever overflow). Safe-area top padding kept;
  .settings-section scroll-margin-top grows to 6.5rem to clear the taller
  header. VISIBLE LAW: no hamburger-for-actions, ever — all three rooms show.
- QUICK-NAV (settings.js/index.html/css/base.css): #settings-quicknav (a <nav>
  above the first room) is filled by buildQuickNav() from
  querySelectorAll('#view-settings .settings-section') — one .nav-chip per
  room, named by the room's own h3. DATA-DRIVEN LAW: add a section with an h3
  and its chip appears; there is NO second list to forget. A tap does
  scrollIntoView({behavior: smooth|auto per prefers-reduced-motion}) and adds
  .ember-flash (inset 3px ember left edge, @keyframes ember-edge, 1.6s —
  re-armed via rAF so repeat taps re-flash; the global reduced-motion rule
  stills it).
- UPDATE CLARITY (install.sh + the cozytavern it writes + README): both weigh
  HEAD with rev-parse before/after the pull and, only when it moved, print
  "A new coat is on — if the tavern looks the same, pull the page down once
  to reload." (the bridge for pre-M16 shells that have no in-app nudge; in
  the heredoc the runtime $vars are escaped). README's "Keeping it current"
  tells the nudge law, the bridge, and where the running version stands
  (sidebar colophon / top of Settings).
- Harness: tests/harness/findability.mjs (+5 = 149/149): two-row header CSS +
  all three buttons, data-driven chips (count==sections by construction, no
  hardcoded room list), scroll+flash wiring, install.sh line x2 + HEAD
  weighing x2, README section.
- Browser QA (python playwright, chromium): 390px — all three actions fully
  visible, no horizontal scroll, two rows (88.5px), "Back to the story" fits
  without ellipsis; chip tap lands The workers at top with ember-flash;
  18 chips == 18 sections; desktop single-row unchanged; 0 page errors.
  Evidence: /mnt/agents/output/qa-m18-*.png. version.js -> m18-001.

---

# M19 — the launch report (the cozy-chat lesson)
- install.sh + the cozytavern command now report the running version every launch:
  "Already on mNN-NNN — the tavern is current." / "Fresh coat on: the tavern is now at mNN-NNN."
  (the pattern the user loves from Cozy Chat's "Already on 5.24.3"). Bridge lines kept for
  stale shells: pull-to-reload once; still same → close every tab of the tavern and reopen.
- serve.py prints the version alongside the address. The hearth shows "the shelves · mNN-NNN"
  (visible on the home screen, phone included — sidebar colophon alone wasn't enough).
- Harness: two heredoc/case traps fixed in findability.mjs (delimiter is a line of its own;
  case-insensitive copy checks). version.js -> m19-001.
