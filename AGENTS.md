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

---

# M20 — the word that never goes stale
- cozytavern.sh now lives IN the repo; install.sh copies it (home path baked). After any
  update the command re-copies itself from the fresh repo — fixing the root cause the user
  exposed: the launcher was written once and never updated, so long-lived installs printed
  no version. Launch report law: every launch prints "Already on <ver>"/"Fresh coat on: <ver>".
- Port sanity: if 8080 answers but not as the tavern (ghost lamp from a deleted folder),
  the command prints the exact douse line (with the cozy-chat lamp warning).
- version.js -> m20-001. Harness 152/152.

# M21 — shelf previews, the frame's purpose + echo, TRUE rollback, the fiction frame
- Shelf previews (A): every tale's row carries `preview` — the FIRST sentence or two of
  the latest page (~120 chars), skipping [bracketed scene-header] lines and never the
  thinking voice (makePreview reads pageText only). Refreshed on append/swipe/delete/
  edit/regenerate via refreshPreview(storyId); rows without one derive it from their
  last page on load (in-memory only, so the shelf order never reshuffles). CSS: a
  2-line clamp in --text-2 under the title.
- The frame's purpose line + echo (B): Settings → The frame gains "Its purpose, spoken
  after it" (editable, toggle default ON — a cleared line stays cleared) and "Say it
  again at the end" (default OFF — the whole frame repeats just before The note at the
  end, the anchor against long-context fade). Slot 1 = frame + "\n\n" + line when on;
  the receipt names both ("its purpose spoken after it" / "The frame, said again").
- TRUE rollback (C): state.js keeps a deep snapshot per turn boundary under
  `snapshots:<storyId>` (keyed by the turn's user-message id, cap 50, deep copy via
  structuredClone). The send path snapshots BEFORE the referee/workers commit;
  regenerate-from-here, swipe-creation, and deleteFrom (boundaryFor) restore the
  boundary before the doomed turn and drop newer snapshots. Undo log stays
  independent; snapshots go with a let-go story (store.js).
- The fiction frame (D): js/agents/voice.js exports FICTION_FRAME + withFictionFrame;
  extractor, scribe, keeper (fold + audit), continuity, referee (all four systems +
  seeder), housekeeper, and both showrunners prepend it to every system prompt.
- version.js -> m21-002. Harness 168/168 (16 new M21 checks).

---

# M22 — the Cozy Chat parity wave
- js/providers/effort.js: the full reasoning ladder (off..max) with per-kind levels + alias-down
  (zai: medium→high, xhigh→max), rejection memory (reasoningDownAt/prefillDownAt persist;
  400/422 citing reasoning/prefill params → retry once without, never spend again until the
  model changes). PREFILL_PROFILES: anthropic native trailing assistant; moonshot partial;
  deepseek prefix; generic: reasoning_content only when the prefill carries a think span,
  else skip kindly. "Test it" probe per connection.
- js/providers/index.js: normalizeBaseUrl (strip trailing slashes; known openai-shaped hosts
  gain /v1; anthropic stays bare) + the 8-preset set with url/sample-model/ctx/hint.
- Web search: per-connection toggle+count; anthropic native web_search_20250305 with
  server_tool_use toast + web_search_tool_result (Array.isArray-guarded) → folded sources;
  openrouter plugins:[{id:'web'}]; hidden elsewhere with a kind note.
- js/ui/prose.js: markdown-lite (code/strong/emphasis only; asterisk action convention intact),
  fenced codeblocks on --bg-2 with copy chip. js/ui/storyexport.js (md/jsonl), download.js.
- Prompt library chips above the composer (add/edit/delete via long-press); archive
  (resting tales row); jump-to-latest pill (never drags you down); lore → ST worldbook export
  ("Carry it to SillyTavern"). Reverse id-coverage harness law: every control in index.html
  must be wired in js. version.js -> m22-001.

---

# M23 — labels that explain themselves
- The workers section: each control (who does the reading / who tells this story / the
  keeper / the second reader) now carries one plain line under it saying exactly what it
  does. The user had to ask — that means the poetry failed; plain words first, poetry after.
  version.js -> m23-001.

---

# M24 — the tavern keeps its own books (the wipe lesson)
- ROOT CAUSE of the user's loss: browser-cleared site data erased IndexedDB. From M24 the
  little server keeps the truth ON THE DEVICE: serve.py answers GET/POST /api/books, writing
  ~/.cozytavern/books.json (COZY_DATA_DIR overrides) — atomic tmp+replace, rotating bak1/bak2,
  JSON-guarded, 64MB cap. The file lives OUTSIDE the app folder: rm -rf ~/cozytavern can't
  take the tales.
- js/sync.js: decideBoot law (server file newer -> pull; browser ahead -> push; fresh browser
  + real books -> pull) + a debounced live mirror wrapping every store write. No server
  (GitHub Pages) -> browser-only, and settings says so plainly ("Where the tales live").
- Keeper core (_read_books/_write_books) sits at module scope for testability; HTTP layer
  stdlib-thin. Harness books.mjs: decideBoot matrix + keeper core in-process (the sandbox's
  loopback is too flaky for socket-level harness runs; curl QA proved the wire).
- version.js -> m24-001.

---

# M25 — findable retry + quiet starter-add (user field reports)
- "Where's the regenerate button": it lived only in the long-press menu — invisible on
  phones. Now a quiet "Try again" sits in the composer meta row whenever the latest page
  is the storyteller's; refreshRetry(history) on every render, hidden while busy.
- "save a starter" was loud: now a dashed ghost "＋ starter" in the whisper voice.
- New harness law (findability.mjs): the retry must exist, be wired, and answer busy.
  version.js -> m25-001.

---

# M26 — the masthead, honest workers, and the hardened extractor (field-reported)
- The empty-ledger mystery: reasoning models' <think> spans contain braces that stole the
  first-balanced-object parse -> silent {mutations:[]}. Parser now strips thinking spans and
  tries up to 5 balanced candidates until one holds a mutations list. A missing import
  (balancedCandidates) briefly hid behind the never-throws law — the ghost-call harness law
  widened to catch jsonutil exports used without import.
- The masthead: the house writes the header line itself from ledger truth (place — date —
  hour — who's here), pinned on pages that didn't write one; state gains place; apply.js
  gains place.set (+undo, house convention); extractor vocabulary gains place.set; drawer
  clock room gains Set the place + the masthead switch; onStoriesChanged now also
  re-renders the thread.
- Honest workers line: extractor runs report "wrote N changes" / "nothing to write down" /
  "its answer could not be used"; transport failures throw into the queue's stumble path
  instead of looking like "nothing changed".
- Craft agency law hardened: never give the other writer's character words, choices,
  reactions, or unwritten stillness; if the next beat needs their answer, stop.
- version.js -> m26-001.

---

# M27 — field-reported fixes (image upload, founding read, scroll law, user retry)
- Pictures: attach button in the composer; downscale to 1568px jpeg; the picture rides the
  wire ONLY on its own page's turn (older pages carry "[a picture was shared here]") —
  providers/wire.js withImagePart maps anthropic base64 blocks / openai data-url parts;
  keepsake thumbnail on the page, tap for whole view. Store keeps msg.image.
- Founding read: a young ledger (no place, nobody here) reads the four pages just before
  too — scene-setting posts no longer starve the ledger (the "does it only read one page"
  field report). buildExtractorMessages gains `before`.
- Scroll law: completion/pending/send scrolls are gated on nearBottom() — the thread stays
  where the reader left it. (Jump pill remains for finding the tail.)
- User pages carry "try again" — rewind-and-regenerate for reader input, riding the M21
  rollback law.
- version.js -> m27-001. Harness 184/184.

---

# M28 — the workers speak through the wire; the ledger is founded (field-reported)
- THE FIELD REPORT: first message of a new story ("Jovan … eating at McDonald's with Liara"),
  the storyteller answers, the ledger stays empty, nothing populates the world. Three root
  causes, all proved by tests/harness/m28.mjs against a mock reasoning house
  (tests/harness/thinkinghouse.mjs — GLM/Kimi/Qwen law: unless told to stop thinking in the
  house's own spelling, it thinks first and spends the budget; content comes back empty):
  1. SIX WIRE PATHS. extractor, scribe, keeper, second reader and referee each carried their
     own hand-rolled anthropic+openai fetch that NEVER disabled thinking. Before: 0/3 reasoning
     houses produced a mutation. M26's max_tokens 600→2000 was a bandage. Now every worker
     rides js/agents/call.js → createProvider().streamChat — the same providers, the same
     effort ladder (Z.ai thinking:{type:'disabled'}, OpenRouter reasoning:{enabled:false},
     Qwen enable_thinking:false, Anthropic no thinking block), rejection memory, address
     normalization. After: 3/3. LAW (harness-enforced): no fetch() in js/agents/*.
  2. THE FOUNDING. The extractor asked "what changed?" of a page that IS the world so far and
     was told the empty list is the most common honest answer. Now a young ledger (no place,
     nobody present — isYoungLedger, one home) switches the prompt into founding mode:
     place.set, presence.enter for everyone (MC included), clock.set only if fixed, mode.set,
     and "an empty answer here is almost always wrong". The brief and cast notes ride along.
  3. WHO IS THE MAIN CHARACTER. state.sheet.playerName was learned only by the referee's sheet
     seeder (after the first fight) or by hand; every worker said "the main character" to a
     model that had no idea who that was. New mutation mc.set {name} (apply.js, undo kind
     mc.restore): set once, a known name is never overwritten by a worker (hand wins), and
     the seeder no longer clobbers a known name either.
- Transport truth: providers/wire.js gains retryAfterMs + transportError(res, message) —
  a refused call throws an Error carrying status and retryAfterMs; the queue's backoff honors
  it. Workers THROW on transport failure now (the queue retries; the workers line says
  "stumbled"/"too many asks") instead of resolving a silent empty list.
- scribe.js re-exports retryAfterMs from its new home (harness contract kept).
- Harness: tests/harness/m28.mjs (9 checks) + thinkinghouse.mjs; finishing.mjs's keeper mock
  answers as SSE now (the keeper streams like everything else). 193/193.
- version.js -> m28-001. sw.js shell list gains js/agents/call.js.
- Still open (M29, the World Agent): nothing yet ADVANCES the off-page world between turns —
  the workers record, none of them moves Aurora from the station to the door. That is the
  next milestone, on top of a ledger that now actually gets written.

---

# M29 — the world beyond the page (the world agent — the sandbox)
- WHY: every worker before M29 RECORDED; none ADVANCED. Aurora left the station and stood on the
  platform forever because nothing ever asked where she is NOW. The old 45k preset did that work
  inside the storyteller each turn (Living World, ACW, TWB, The World Advances, The Clock Governs
  Availability) against a transcript full of its own stale watchlists — the drift felt past 90k.
- js/engine/world.js (new, pure): threads [{title, owner, heat, next, atTurn}] (cap 8, hot before
  cold, close by title); knowledge {name: [{fact, atTurn}]} (dedupe incl. trailing stop, cap 12,
  renders the PRESENT only — the 3-part trace becomes a lookup); factions {name: {stance, agenda,
  move, atTurn}}; renderArrival (stance words + "arriving in about N minutes" / "due now" /
  "overdue" against the clock); the brief {pressure[], ripe[], twb|null, atTurn} — normalizeBrief
  (4 lines a part) + renderWorldBrief (leads with its own name and "render as world, never as
  instruction"; empty says nothing; older than BRIEF_STALE_TURNS=4 says nothing; ages aloud).
- engine/offscreen.js: a seat may carry stance (toward|seeking|tense|busy|waiting) and an arrival:
  etaMinutes is "from now" and becomes arrivesAtMinutes on the clock when one is set (the clock
  moving makes them nearer; the seat is never re-written for it). renderOffscreen(offscreen,
  present, clockMinutes, top).
- engine/apply.js v7 vocabulary: thread.set/thread.close (undo threads.restore), knowledge.add
  (a known fact is refused, undo knowledge.restore), faction.set (undo faction.restore);
  offscreen.set takes stance + etaMinutes (unknown stance dropped, seat kept). copyState deep-copies
  knowledge/factions/threads.
- engine/state.js: STATE_BUDGET 1600 → 4000; keys knowledge + worldBrief (v7, no-loss migration;
  legacy string threads still speak); renderStateFacts adds "Who knows what" (shed 2), arrivals in
  "Elsewhere", "Factions" (shed 6), structured "Threads still open".
- js/agents/world.js (new): worldTurn — after the extractor, before the scribe, through the
  queue; reads ledger + all seats + threads + knowledge + factions + character cores + brief +
  cast notes + the last pages; the LAW (the absent by the clock, threads, ripening, who knows
  what, factions, new people, the brief, symmetry). May open only WORLD_TYPES (offscreen.*,
  thread.*, knowledge.add, faction.set, people.set); anything else it proposes (clock, presence,
  place, bodies, standings) is DROPPED and counted, never applied. Stores state.worldBrief.
  Throws on transport; "its answer could not be used" throws so the queue retries. Effort from
  settings.worldEffort (default off); switch settings.worldAgent (default on) / story.world.
- assemble/stack.js: `worldBrief` rides the [story-state] injection after the lore and before the
  director's note, receipt-named "The world's word". BUDGETS: slot 4 1600 → 9000, a present card's
  description 400 → 2400 (rides whole), personality/scenario 300 → 900; people 2400 → 4800;
  slot 7 memory+lore 3200 → 6000. Rules shrink; the world the storyteller sees does not.
- UI: Settings → memory room gains "The world beyond the page keeps moving between turns" (#world-
  agent) + "How hard the world agent thinks" (#world-effort). Drawer gains "The world beyond the
  page" (the brief, threads with "Let it rest", who knows what, factions); "What's happening
  elsewhere" rows speak stance + arrival. Workers roster/ledger know 'world'.
- Harness: tests/harness/m29.mjs (11 checks, incl. end-to-end through every mock house with
  thinking off). 204/204. version.js -> m29-001.
- NEXT (M30): decompose the V177 preset into the craft core + situational modules instead of the
  wholesale 106k-char import; the storyteller keeps only the beat and the last look.

---

# M30 — the regex shelf; the import stops asking the storyteller to run the simulation
- FIELD REPORT: "my header is ugly and there's Plot Momentum". ROOT: the wholesale preset import
  (M5) kept Time and Place (the [Place — Day | HH:MM | weather | attire | position] header) and
  Better Narrative Drive (the Plot Momentum <details> block with its four gates) in the craft,
  so the storyteller kept emitting them — and they rode back in history every turn. A regex that
  only hid them would have been a bandage over exactly the stale-block drift the world agent ends.
- js/regex.js (new): SillyTavern-style rules {id, name, find, flags, replace, on, mode, enabled}.
  Three moments: page (on the finished page BEFORE save — history and workers see the result),
  display (the thread only), wire (what the storyteller is sent only). Two voices + both. 'g' is
  always on; a rule that won't compile is skipped, never a crash; a page-mode removal tidies the
  hole (3+ newlines → 2). Three builtins ship on: the preset's bracketed-with-pipe header line,
  the Plot Momentum block, the {PULSE}/{WATCHLIST}/{VOICES} blocks. Store key regexRules (whole
  list; builtins seeded when missing; a writer's edits to a builtin stand; "Restore the original").
- Hooks: chat.js — page-mode on the finished page right after stripEpisodeEnd (before save, before
  the workers), page-mode on the writer's words (never a hidden command page), display-mode in
  msgNode; stack.js — buildRequest takes `pageFilter(text, role)`, applied in wireable() on the
  history only. Settings → "The regex shelf": list, form, "Try it on the latest page" (matches +
  chars), "Clean this story's pages now" (rewrites text + swipes of every page; confirm; no
  take-back). loadRules() at chat init keeps a live copy for the render paths.
- import/v176map.js: Time and Place → retired-house (the masthead is the house's; travel/ETAs are
  the world agent's clock); Better Narrative Drive → retired-engine (Plot Momentum's gates are the
  world agent's); ACW/Factions/Genesis whys now name the world agent. RE-IMPORT the preset for
  this to take effect on an existing craft override.
- agents/world.js law: "a place implies its people" — the neighbor who never moved, the school
  friend still on the street — may be invented when their motive could cross the main character;
  at most one new named person per page.
- sw.js: 16 shipped modules were missing from the offline shell (assign, director, editor,
  housekeeper, voice, commands, effort, sse, wire, sync, tablock, download, prose, storyexport,
  version, regex). All listed; NEW LAW (m30.mjs): every js/*.js and css/*.css must be in the shell.
- Harness: tests/harness/m30.mjs (8 checks). 212/212. version.js -> m30-001.
- NEXT (M31): the craft core — distill the remaining ~90k-char craft (Main, Simulation Core,
  Character Integrity, Information Quarantine, NPC Psychology, Living World, Writing Guidelines)
  into a ~12k-token core that binds the storyteller to the ledger and the world's word.
- M30-002: the cut-away's craft rides when it should. New predicate key `worldWindow` (modules.js)
  wakes a rule when state.worldBrief carries a TWB seed; the import maps "The World Beyond (TWB)"
  to it (was manual). The agent remembers the windows it opened — state.worldShown (cap
  WORLD_SHOWN_MAX=6), shown to it each read as "windows already opened" — so "never the same
  beat twice" is a mechanism. Law: two absent people sharing a place and a stake talk, and what
  each learns lands in knowledge.add. 213/213.

---

# M31 — the ledger says what it saw; the regex dresses the page, it doesn't undress it
- FIELD REPORT 1: "ledger empty again — the world agent stumbled, its answer could not be used".
  Three roots: (a) status.js loadWorkerStatus DROPPED `detail` on read — the drawer could never say
  "wrote 3 changes" / "nothing to write down", so nobody could see why the ledger was empty; now
  detail AND `raw` (what the worker actually said, cap RAW_CAP=2000) ride the shelf, and the drawer
  folds "what it said" under each worker. (b) a garbled world-agent answer THREW, so the queue
  retried it five times over ~62s (six model calls) and then said "stumbled"; now a garbled answer
  earns ONE sharper second ask inside the worker, then is said out loud ("could not be used" /
  "ran out of room") and never thrown. The extractor does the same, plus a founding nudge when a
  young ledger's answer comes back empty; its detail names refusals ("nothing to write down (2
  refused: …)"). (c) jsonutil gains repairJson/parseLenient (comments, trailing commas, raw
  newlines in strings) — strict first, mended second; extractor and world parsers use it. World
  agent MAX_TOKENS 2400 → 4000.
- FIELD REPORT 2: "you're not supposed to make the header gone, make it beautiful" — the writer's
  SillyTavern 🎨 regex scripts style the header and trackers as HTML on display. So: (a)
  regex.js importSillyTavernRegex — placement 1/2 → writer/storyteller, markdownOnly → display,
  promptOnly → wire, both → two rules, neither → page; Settings "Bring your SillyTavern regex".
  (b) ui/richhtml.js renders a dressed page through an ALLOWLIST (tags; only style/class/open/
  title; styles that reach out — url(), expression(), @import, javascript: — dropped whole; text
  nodes still go through the inline renderer). The masthead decision reads the RAW page so a
  styled header is still a header. (c) builtin "Remove the preset's header line" ships OFF; the
  state-block rule removes {PULSE}/{WATCHLIST} only ({VOICES} is content); Time and Place is CRAFT
  again — the storyteller writes the header the writer styles. A shelf that already exists is not
  re-flipped (the writer's switch stands).
- Harness: tests/harness/m31.mjs (7 checks, incl. the writer's real regex file at /tmp during
  development — never committed). 220/220. version.js -> m31-001. sw.js gains ui/richhtml.js.

---

# M32 — the spoken lines and the thoughts have a colour; untouched builtins follow the coat
- FIELD REPORTS: "npc dialog is all white, ugly"; "does the npc thought have colour and format";
  "the time is not on the ledger — is it your regex?" (yes: m30's header-removal rule ran BEFORE the
  extractor read the page, so it never saw the [… | HH:MM …] line); "the agent didn't invent my
  sister Kim though the prose named her".
- ui/prose.js: inlineMd now tokenizes spoken lines ("…", “…”, „…“, «…» — one line, marks kept)
  and the preset's thoughts (~t~*…*~/t~ or *~t~…~/t~*, marks removed) as spans with children; the
  M22 marks (`code`, **strong**, *em*) still work inside both (inlineMarks is the old pipeline,
  exported). An unclosed quote is plain text. CSS: .spoken → --spoken, .thought → --thought
  (both themes); Settings → Appearance "Colour the spoken lines and the thoughts" (colourSpeech,
  default on) toggles body.plain-speech; applied at boot in app.js. Works inside a 🎨-dressed page
  too (richhtml's text nodes ride appendInline).
- regex.js: builtins carry `touched` (settings sets it on toggle/edit/restore). loadRules syncs an
  UNTOUCHED builtin to the shipped words and switch — so an m30 shelf seeded with header removal
  ON lands on the m31 default (OFF) by itself; a touched builtin stands as the writer left it.
- extractor prompt: the bracketed header line is the truth for place.set/clock.set (all five
  numbers) and the main character's attire/position — on a founding and on a settled ledger.
- world agent law: a person the page names in passing ("my sister Kim would laugh") exists from
  that line on — people.set core + a seat with a want.
- Harness: tests/harness/m32.mjs (4 checks). 224/224. version.js -> m32-001.

---

# M33 — the dom walk (the field reports that founded it: "try again does nothing", "the white banner")
- FIELD REPORT 1: the "try again" under a writer's page did nothing. TWO roots: the thread's click
  listener routed copy/edit/swipe/branch/go on/delete and never 'try again' (only the long-press
  menu knew the word); and retryUserMessage found "the answer after this page" with
  `m.id > messageId` — a lexical comparison of UUID strings — so even via the menu it landed on an
  arbitrary page or answered the tail. Now: routed from the row; the store's ORDER decides (first
  storyteller page after this one); a tail page with a stale hidden nudge after it is answered anew.
- FIELD REPORT 2: "Keep the new words" was a bare browser button — no class, so white in a lamplit
  room. Now .btn. LAW (m33.mjs): every button the house creates wears a class.
- Found by the walk: a send with NO connection begat an empty story named after the words ("Hello?")
  before noticing there was no storyteller. The storyteller is looked for first now.
- THE DOM WALK — tests/dom/run.mjs boots the REAL app (index.html + every module) in jsdom
  (tests/dom/env.mjs: the idb shim, a mock house that answers the storyteller with prose and the
  workers with JSON, browser globals, Blob.text / object-URL polyfills) and presses what a person
  presses: send, try again (tail + middle), edit (both voices), swipe/swipe-prev, branch, delete,
  go on, the drawer (panels, the world's word, the workers' lines and "what it said"), settings
  (regex shelf add/try/keep, bring a SillyTavern regex file, the switches), a dressed page through
  the allowlist, housekeeper/tour, a refused house — then THE SWEEP: every visible button in every
  room pressed once (≈100), any error attributed to the button's own words. Zero errors is the law.
  Run: `cd tests/dom && npm install` once, then `node tests/dom/run.mjs`. tests/dom/node_modules is
  gitignored; the app itself keeps its no-npm law.
- LAW: both harnesses green before any commit — `node tests/harness/run.mjs` (229) AND
  `node tests/dom/run.mjs` (16).
- switchWorkerStory: the unused import is gone from app.js; the purge-on-switch idea is documented
  as deliberately unwired (it would throw away the ledger writes of the tale the writer just left).
- version.js -> m33-001.

---

# M34 — the record (Summaryception, ported); the keyboard stays down; the 🎨 pack ships on
- FIELD REPORTS: "does the keeper summarize like Summaryception?" (honest answer: it did not);
  "after every output it pulls up the keyboard and bounces the screen"; "my header is not
  beautiful — I already gave you the regex".
- agents/memory.js rewritten as a RECORD, the Summaryception principle whole: as pages leave the
  verbatim window, each batch (memoryBatch, default 6 pages = 3 exchanges; setting slider 2–20)
  becomes ONE dense line of what is NEW against the record so far — the writer's own summarizer
  prompt verbatim (player name = mcName; prior_context = the record's newest CONTEXT_CAP chars;
  passage = the batch with authors). No hysteresis (nextBatch); catch-up at BATCHES_PER_RUN=3
  lines per finished page. "(no new state)" → an empty node (covers its pages, says nothing).
  Layers: a layer past NOTES_PER_LAYER=100 merges its oldest two with the same prompt (the two
  lines are the passage, the layers above the record) behind a shrink guard (SHRINK_FLOOR 0.4 →
  one stricter ask, then accept). The detail auditor (M12) runs on every line and merge. Slot 7
  renders the WHOLE record oldest→newest under "Our story so far … established canon" (SLOT_BUDGET
  30000 chars; over budget the oldest lines rest, with a word). The lore shelf keeps LORE_BUDGET
  3000 of its own beside it. Transport failures throw to the queue. Store shape unchanged.
  Workers line: "wrote N lines — M lines on the record".
- chat.js: isTouch() (pointer: coarse / touch points); focusComposerIfDesktop() replaces the
  composer focus after an answer and after a new tale — on a phone the keyboard rises only when
  the reader taps. The landing scroll obeys the M27 law (nearBottom()).
- regex-styles.js (new): the writer's 🎨 SillyTavern display pack as built-in display rules
  (pack:'styles'), on by default; the TWB open/close pair (which relied on a tracker block after
  it) is replaced by a self-closing house rule that boxes the marker, the optional [Location —
  Day, Time] line, and the paragraph after. The shelf folds the pack under one heading.
- Harness: m34.mjs (7 checks incl. end-to-end lines/coverage/promotion through the mock house);
  finishing.mjs's M12 auditor test rewritten to the ledger law; the dom walk's DOM-12 reads the
  pack's card. 236/236 + 16/16. version.js -> m34-001. sw.js gains regex-styles.js.

---

# M35 — the record is verified and mended (Summaryception's auditor, ported); relations and the real record
- FIELD REPORTS: "make sure fully autonomous, no continuity issues" (→ the auditor that FIXES, not
  just flags); "my MC said 'what will your mother think' to Kendall and the agent didn't put the
  mother on the ledger; if it's a real person, use the real source".
- agents/memory.js: after every level-1 line, the VERIFIER runs Summaryception's audit prompt
  (VERIFY_USER: <record>/<passage>/<snippet>; DRIFT vs CONTINUITY; where: snippet|source). A
  snippet issue rewrites the line in place (REWRITE_USER; node.verified = {at, fixed}); a source
  issue is handed to the caller's onSourceIssue({issue, fix, span}). Exported: buildVerifyMessages,
  buildRewriteMessages, parseVerifyAnswer.
- agents/continuity.js: findings on a warn now carry `fix` (how the page should read). New: the
  MEND — buildMendMessages/parseMendAnswer/mendPages: Summaryception's source-edit law ("edit the
  fewest STORY pages by the smallest amount; never a PLAYER page; [] if no safe edit"). A change
  larger than half the page (by length or by lines, editDistanceRatio) is refused as a rewrite.
- ui/chat.js: mendAround(story, connection, pageIds, contradiction) — the drifted page and up to
  five before it, the record as canon; applyMend writes {text, mended:{before, why, at}} (swipes
  in step) and re-inks; the page shows a chip "mended by the second reader — take it back"
  (act 'unmend' → the earlier words return). The keeper hands verifier source issues to it; the
  second reader mends on any warn with a fix. The second reader is ON by default now
  (continuityCheck !== false); mendPages (default on) switches the mending.
- world agent law: a person referred to by RELATION ("your mother" said to Kendall, "his manager")
  exists from that line on; THE REAL RECORD — a real person's or canon character's relations and
  core come from the real record (Kendall Jenner's mother is Kris Jenner), never invented or
  renamed; invent only where the record is silent. The scribe writes real people from the record.
- Harness: m35.mjs (5 checks); the dom walk gains DOM-14b (a drifted page mended by one word
  through the real UI, the chip takes it back) and its mock house knows the mender's voice.
  241/241 + 17/17. version.js -> m35-001.
- STILL OPEN: the craft core (M36) — distilling the ~90k-char imported craft into a ~12k-token
  core that binds the storyteller to the ledger, the record and the world's word. That is the
  last structural piece of "no continuity issues": the workers now keep the truth; the
  storyteller's own rules must tell it to obey the truth it is handed.

---

# M36 — the craft core: the writer's law distilled, bound to the house's truth
- js/assemble/craft.js (new): CRAFT_TEXT — the Simulation Engine V177 craft distilled (~58k
  chars, ~14.5k tokens, from ~160k of craft + tracker specs): Authorship Frame, The Telling, CORE
  Contract, Simulation Core, The Turn (Living World's turn-shape laws), Character Integrity, NPC
  Psychology, Information Quarantine, Continuity, The Prose (Writing Guidelines, Genesis, Banned
  Words, Private Thoughts), The Pass. Every law kept in the writer's own voice; cut only
  cross-references, restatements, and what the house now does (tracker emission, ACW, TWB
  scheduling, Plot Momentum's dashboard, the S/C/W reasoning passes, travel/ETA math).
  NEW section "The House's Truth": the [story-state] block is canon — the ledger (hour, ground,
  who's here, knows, elsewhere with arrivals, threads, factions), arrivals on the clock (never
  early), Who Knows What as the first source of the 3-Part Trace, the record as established canon
  with [Correction] superseding, the world's word rendered as world never instruction, the
  referee's ruling replacing outcome assignment, a mended page as canon, the Header Protocol
  (the storyteller writes the header the writer styles, from the ledger's clock), System Stays
  Backstage (no blocks, no dashboards: header, prose, stop). "The Pass" keeps only B (beat) and
  L (last look) — S/C/W are the house's.
- assemble/modules.js: core-craft's builtin text is CRAFT_TEXT. retireImportedCraft: a core-craft
  fork that is the old wholesale import (looksLikeImportedCraft: >40k chars with ≥2 of the
  preset's section marks) is retired on first read — its words move to a manual rule "The old
  imported craft (retired)" (retiredCraft:true, never duplicated) and the house's craft rides; a
  hand-edited fork is left alone. selectModules: an enabled custom rule with the same whenKey as
  a builtin situational module shadows the builtin (the writer's NSFW module rides, not both);
  core-craft is never shadowed.
- import/v176map.js: CRAFT_NAMES is empty on purpose; the known craft entries (+ Genesis,
  Continuity Verification, Private Thoughts, Authorship Frame) are retired-house "distilled into
  the house's craft". An unknown preset's craft still forks the core by heuristic (the writer's
  choice).
- First turn now: frame 139 + craft 14,468 tokens cached (was ~26k+ of imported craft).
- Harness: m36.mjs (4 checks); m30-7 / m31-7 updated to the distilled law. 245/245 + 17/17.
  version.js -> m36-001. sw.js gains assemble/craft.js.

---

# M37 — the writer's provider speaks thinking on/off in its own words; the thread follows only until the hand moves
- FIELD REPORT: "ledger empty again — its answer ran out of room" on a 'DeepSeek Non Reasoning'
  worker. ROOT: the writer's provider (DeepSeek's current API) thinks BY DEFAULT at high effort
  and is told not to with {"thinking":{"type":"disabled"}}; the house had DeepSeek as "decides for
  itself" and sent nothing, so the worker thought its budget away. Now: reasonStyle 'deepseek'
  (preset, any address containing deepseek, or a deepseek model) → thinking:{type:disabled|enabled}
  + reasoning_effort on DeepSeek's ladder off|low|high|max (medium→high, xhigh→max). The generic
  openai shape sends the thinking switch too — except to the real api.openai.com (hostIsOpenAI),
  which never takes it. DeepSeek behind the Anthropic shape: reasoning:{effort: none|low|high|
  max} instead of the thinking block. Worker budgets: extractor 2400, world agent 6000.
- FIELD REPORT: "when the output is streaming I can't move my screen; SillyTavern lets me". ROOT:
  the follow test was "within 120px of the tail" per token, so a small upward scroll was snapped
  back every token. THE FOLLOW LAW (SillyTavern's): `following` is true until a scroll/wheel/
  touchmove takes the thread up off the tail; then the thread stays where the hand put it; it
  follows again only when the hand brings it back within 8px of the tail. One scroll per frame
  (requestAnimationFrame). scrollToBottom() (a send, a structural render, the jump pill) sets
  following back on.
- The workers say WHAT they wrote: the extractor lists its applied changes (5), the world agent
  what moved (4) — the drawer's line is a ledger of the turn, not a count.
- Harness: m37.mjs (5 checks). 250/250 + 17/17. version.js -> m37-001.

---

# M38 — the housekeeper keeps the lore shelf
- The one thing Chat Assistant could do that the housekeeper could not. New protocol block
  <lore>[…]</lore>: {add:true, name, keys, content, constant?} | {entry, content?, keys?, name?,
  enabled?, constant?} | {entry, remove:true} — "entry" is an entry's name or its first key.
  Staged as cards like every other change (kind 'lore'), refused kindly when the entry is not
  there or the op says nothing; review hashes on the entry (or the shelf's ids for an add) make
  a card stale when the shelf moved under it; apply writes the shelf and keeps the WHOLE shelf
  before in the undo batch; undo refuses on drift. The context shows the shelf (name, keys, off/
  always, 200 chars of content); the prompt teaches the block; touched.lore refreshes Settings.
- Harness: m38.mjs (2 checks). 252/252 + 17/17. version.js -> m38-001.

---

# M39 — the stream is dressed as it arrives
- FIELD REPORT: "regex must render first, like SillyTavern — it rendered only after the output was
  done." ROOT: the pending page painted raw text (body.textContent = full) per token; the display
  regex, the 🎨 styles, the spoken colour, the thoughts and the scene heads ran only in msgNode on
  the finished page. Now dressInto(host, text, role) is the ONE dresser (display rules → allowlisted
  HTML or scene heads + rich prose); msgNode uses it, and the stream paints through it at most
  once per frame (paintLive, requestAnimationFrame). A rule needing a complete line (the header
  card, the boxed cut-away) dresses the moment its line completes, as it does in SillyTavern.
- Settings: the record-line slider is labelled in Summaryception's terms ("turns per record line";
  one turn = the writer's page + the storyteller's).
- 253/253 + 17/17. version.js -> m39-001.

---

# M40 — versions keep their ledger; the swipe bar; the thinking clock; seated people have pages; rescan
- FIELD REPORT: "when I swipe the ledger is gone even though I cancelled". ROOT: swipe-creation
  restored the boundary (M21) BEFORE asking, so a cancelled or empty swipe left the pre-turn
  ledger and threw the standing version's consequences away. Now the ledger being left is saved
  as that version's checkpoint (versionState:<storyId>, key '<msgId>:<swipeIdx>', cap 60), the
  boundary is restored, and if nothing landed (generate returns `landed`) the ledger is given
  straight back. A 'checkpoint' job at the end of every chain saves the version's ledger; walking
  to a version (swipe-prev/next) restores ITS ledger, or, never read, restores the boundary and
  re-reads that version with the workers. Summaryception's per-swipe checkpoints, in the house.
- The swipe bar: ◀ n/N ▶ at the page's foot (SillyTavern's), on the last storyteller page always
  (▶ past the last version writes a new one) and on any page with versions; the word "swipe" left
  the action row.
- The thinking clock: starts at the first thought, stops at the first word of prose; live
  ("what the storyteller weighed — 4s…"), kept as msg.thinkingMs on the page and each version.
- Starters: the saved-starters row above the composer is hidden unless Settings → Appearance
  "Show the saved starters row" is on (it filled the screen).
- FIELD REPORT: "the character page gives two people while elsewhere shows three". ROOT: the world
  agent seated people without writing them a page. Now every offscreen.set without a people.set
  in the same answer gets a minimal core from the seat (activity; wants agenda; at location);
  the scribe enriches it later. Drawer gains "The people" — every character page (core/now/arc/
  loose ends), the present first.
- Rescan: Drawer → The workers → "Read the pages again": the chain reads the latest storyteller
  page with the eight before it in view (deep), by hand, when something looks missing.
- Harness: m40.mjs (5 checks); DOM-7b walks versions, checks the people panel and the rescan;
  m29-8 expects the auto-page. 258/258 + 18/18. version.js -> m40-001.

---

# M41 — the auditor: the whole ledger against the brief, the pages and the record
- FIELD REPORT: "is there an agent that sees all the ledger and compares it with the story, the
  brief, everything — so no mistake happens?" There wasn't. The second reader minds a page; the
  verifier minds a record line; nobody minded the LEDGER.
- js/agents/auditor.js: auditLedger reads the whole ledger (state facts, every seat, every
  character page, the canon, the threads, who knows what, the factions), the brief and cast notes,
  the record, and the last AUDIT_PAGES=10 pages; holds them together in the order of authority
  (brief > pages > record); answers {issues:[{what, fix, mutations}]}. Mutations ride the closed
  vocabulary through applyMutations — validated, logged, take-back-able (the auditor MAY move the
  clock, the ground and the presence: it is correcting the ledger to the story). Unfixable
  disagreements carry an empty list and are noted. The report lands as state.audit {at, turn,
  issues:[{what, fix, fixable}]}. One sharper retry on an unusable answer; raw kept.
- Runs LAST in the chain (after the second reader, before the checkpoint) every auditEvery turns
  (default 3; Settings slider 1–20; auditOn default on; story.audit override), and by hand:
  Drawer → The workers → "Audit the ledger" (auditNow). "Something drifted" shows the auditor's
  last reading first. Roster/ledger know 'auditor' (hands of its own).
- Harness: m41.mjs (3 checks incl. end to end: a stale presence, a wrong clock, a wrong mother
  set right; an unfixable brief/pages contradiction noted). 261/261 + 18/18. version.js -> m41-001.

---

# M42 — reset every setting to the house's defaults (connections untouched)
- Settings → Backup → "Reset settings to the house's defaults". The recommended settings are the
  ABSENCE of a stored value (every room reads its default when the key is missing), so the reset
  deletes the app-wide preference keys (RESET_KEYS: theme/colour/starters/masthead/thinking; the
  memory room; the world agent; the auditor; the referee's dials; the frame and the note; the
  housekeeper's context pages; the shelf folds) and re-seeds the regex shelf's built-ins to their
  shipped words and switches while the writer's own rules stay. Untouched: connections,
  activeConnectionId, workerConnectionId/workerConnections (which worker uses which), stories and
  every per-story store (ledgers, records, snapshots, versions, lore, cast, sessions), the rulebook
  (modules), the starters library. Confirm first; the rooms re-read; theme back to Lamplight.
- DOM-13b proves it through the real UI. 261/261 + 19/19. version.js -> m42-001.

---

# M43 — the mend is quiet on the page; a branch carries its checkpoint
- FIELD REPORT: "the mended chip hurts my eyes; everything is autonomous, don't put it on the page."
  The chip is gone. The mend stays recorded (msg.mended); "Something drifted" lists mended pages
  with "Put the earlier words back" (ctx.chat.unmend).
- FIELD REPORT: "branching puts a checkpoint on the ledger like Summaryception, right?" It did NOT
  — M15's branch started with a clean ledger. Now branchFrom carries: the ledger as it stood after
  the branch page (that page's version checkpoint; else the boundary snapshot before the NEXT
  turn, which is the state after this page's chain; else, from the tail, the ledger as it
  stands), the snapshots up to the branch point re-keyed to the branch's page ids (so a rewind in
  the branch lands right), the version checkpoints of carried pages re-keyed, the record's lines
  that cover carried pages only, and the lore shelf. Nothing of the old telling's later turns
  crosses over. loadSnapshots/saveSnapshots exported from engine/state.js.
- Harness: m43.mjs; DOM-8 asserts the branch has a ledger; DOM-14b takes the mend back from the
  drawer. 263/263 + 19/19. version.js -> m43-001.

---

# M44 — Summaryception's checkpoint and coverage laws, held against the tavern
- Read in full: Summaryception's ghostMessage/ghostMessagesUpTo/healOrphanGhosts (coverage is the
  licence to hide; holes below the pointer are repaired), repairIfBranched (summary/snippet
  overruns, verbatimGhosted, ledgerAhead → trim, drop, rewind), onMessageEdited/Deleted/Swiped,
  _pruneCheckpoints (keepRecent dense + sparseEvery), _pickCheckpoint (nearest ≤ target),
  _editRewindDecision (rewind only within depth). Five gaps in the tavern, all closed:
  1. INDEX DRIFT (latent since M6): record spans counted ALL pages, the window law counted
     VISIBLE ones — off by one after every hidden "go on". The record's index space is the
     visible pages now (visiblePages), everywhere.
  2. HOLES NEVER REFILLED: coveredEnd was max(span)+1, so a hole (deleted/edited covered page)
     stayed unsummarized and the verbatim window widened forever. dueRange is holes-first:
     the first uncovered page below the window is due; a hole smaller than a batch folds as it is.
  3. DELETION DIDN'T MOVE THE SPANS: memoryAfterDeletion — the covering line goes, later lines
     slide down one; deleteMessage applies it and asks the auditor.
  4. EDIT OF THE LAST PAGE DIDN'T REWIND: the readers re-read the new words against a ledger
     holding the old version's consequences. Now the last storyteller page's edit rewinds to the
     boundary before its turn, then re-reads; an OLDER page's edit does not rewind what came
     after (Summaryception's depth law) — its line is let go and the auditor sets the ledger
     right. Swipe (new or walk) lets the page's line go too (memoryWithoutPage).
  5. DEEP REWINDS FAILED SILENTLY: snapshots kept the newest 50 only. pruneSnapshots keeps
     SNAP_DENSE=40 dense + every SNAP_SPARSE_EVERY=5th older (cap 120); restoreNearestSnapshot
     lands on the nearest checkpoint at or before the turn when the exact one is gone, and an
     inexact landing asks the auditor (pendingAudit → the next chain's auditor runs regardless
     of cadence). rewindTo() is the one door for retry, swipe-new, swipe-walk and last-page edit.
- Retry/regenerate truncates the record at the first gone page (memoryTruncatedAt).
- At send, a line never rides beside the page it summarizes: memoryForWindow drops lines that
  overlap the verbatim window (Summaryception's verbatimGhosted repair, done every turn — which
  also covers a widened window and a branch).
- Harness: m44.mjs (6 checks incl. an end-to-end hole refill); m21's cap/rewind laws updated.
  269/269 + 19/19. version.js -> m44-001.

---

# M45 — the founder: the ledger from the ground up
- FIELD REPORT: "the ledger only parses the chat, not the brief — then how do they know the world?"
  True: the brief, cast notes, cards and lore rode to the storyteller and were read by workers
  as context, but nothing turned them into LEDGER; the first pages had to rebuild the world.
- js/agents/founder.js: foundWorld reads the brief, the cast notes, the invited cards
  (description/personality/scenario) and the enabled lore, and writes the world through the
  closed vocabulary — mc.set; a people.set page for every named person (never the MC's core);
  rel.set only for standings the brief states ("the brief says…"); canon.lock for the five
  features and scars when stated; faction.set; offscreen.set for everyone the brief places
  elsewhere; thread.set for the premise's live wants; knowledge.add for what a person knows,
  never what is sealed from them. STATED, NEVER INVENTED; THE REAL RECORD; the opening scene's
  presence is the extractor's. state.founded = {at, print}: a fingerprint over the material so
  the founder runs once, and again when any of it changes; by hand: Drawer → The workers →
  "Found the world from the brief" (foundNow). First in the chain, before the extractor.
- Harness: m45.mjs (3 checks incl. end to end). 272/272 + 19/19. version.js -> m45-001.
- M45-002 (FIELD REPORT: "Caleb and Alaric's P:R:S are for Rias, not the MC — Caleb never met
  Jovan"): the founder broke the writer's AXIS LOCK. Law: a standing exists only TOWARD THE MAIN
  CHARACTER, only when the brief states a bond with them; feelings for anyone else go in the page
  as words. Code guard in foundWorld: a rel.set/rel.shift whose cause does not name the main
  character (or "main character") is refused with the reason. The auditor's law: a standing whose
  history speaks of a feeling for someone else, or for a person who never met the MC, is zeroed
  (rel.set 0/0/0, "the brief gives no bond with <MC>") and the feeling moved to the page.

---

# M46 — "reading now…"; the founder keeps out of the scene
- FIELD REPORT: "I pressed Audit and can't tell if it's loading or done." The workers' panel only
  ever showed a FINISHED run. status.js gains markWorkerRunning/runningWorkers/onWorkerChange (in
  memory); queue.js marks start and every exit; noteWorkerRun marks settle. The drawer subscribes
  once (re-renders while open): "the auditor is reading now…" leads the panel, the button that is
  reading is disabled and says "Auditing…"/"Founding…"/"Reading…", and the finished line lands
  the moment it is done.
- FIELD REPORT (from the founder's own line): "The scene now stands in Ravenwood · …the Wells house
  · …Ravenwood High" — the founder set the scene's place once per place the brief mentioned.
  NOT_THE_FOUNDERS: place/clock/presence/mode/body/combat are refused in code with the reason (the
  scene is the extractor's from the first page); the law says a place the brief mentions is
  world and needs no line.
- Harness: m46.mjs (3 checks). 276/276 + 19/19. version.js -> m46-001.
- M46-002/003 (FIELD REPORT: "after thinking it should also say how long it thought"): the clock was
  measured but never SAVED — store.js's append copies fields by an explicit list and thinkingMs
  was not on it (nor masthead, nor mended: a branch copies pages through append and would have
  dropped both). All three ride now, on the page and on each swipe. The finished page's thinking
  block reads "what the storyteller weighed — thought for 12s"; under half a second reads so.
  DOM-14a drives a THINKING storyteller through the real UI (the mock house emits
  reasoning_content first) and proves the thought and its time are kept and shown.
  LAW (relearned, the hard way, twice this session): never push with a red harness.
  277/277 + 20/20. version.js -> m46-002.

---

# M47 — the mood is stated whole, every page
- FIELD REPORT: "he got out of the Uber and hugged his sister on the porch and the scene is still
  'on the road' — is something ticked never un-ticked?" Exactly that: the reader was told to
  mode.clear "when a mood clearly ends", which means remembering to un-tick; models forget. And a
  stale mood is not cosmetic — combat left on makes the referee rule every turn, intimate wakes
  the NSFW module in a kitchen, socialField wakes Voices in an empty room.
- apply.js: mode.snapshot {flags:[…]} — the WHOLE BOARD: every mood that holds at the end of the
  page; anything not named is cleared; diffed against the ledger so only real changes are
  logged (undo kind mode.restore). mode.set/mode.clear stay for the hand.
- extractor: the reader is shown the moods on the board and told to restate it whole every page
  (with the concrete cases: stepped out of the car is not in transit, an emptied room is not a
  social field, an ended fight is not combat). The auditor holds the moods to the latest page too.
- Harness: m47.mjs. 279/279 + 20/20. version.js -> m47-001.

---

# M48 — the auditor may not take a standing away on judgment
- FIELD REPORT: "the auditor deleted Aurora's P:R:S because 'not in the brief' — she is his childhood
  best friend." My M45-002 law let the auditor zero "a standing for a person who has never met
  the main character" — a judgment call it cannot make. Standings are earned on the pages and set
  by the founder from the brief; the auditor corrects only what it can PROVE.
- Law: the only standing the auditor may zero is one whose own history says it was written for a
  feeling toward someone else (the Caleb case); never because it does not see the bond; when in
  doubt, leave every standing — the pages move standings, not the auditor.
- Code guard in auditLedger: a rel.set/rel.shift that LOWERS a standing is refused when that
  standing has any on-page history (a cause not from the brief/hand/founder) or when the person is
  named in the brief or the cast notes; the refusal is on the workers' line. Raising is never
  blocked. Recovery for a standing already zeroed: "Take it back" in What changed and why.
- Harness: m48.mjs. 280/280 + 20/20. version.js -> m48-001.

---

# M49 — the writer's digits are read in code; any entry can be taken back
- FIELD REPORT: "the auditor still doesn't put Aurora's P:R:S back — the cast notes literally say
  (P:65 R:30 S:5)". Digits in the brief or cast notes are no longer left to a model's reading.
  founder.js explicitStandings(text): one per line — the name is the line's head (before " — "
  or ":"), the numbers the first P/R/S triple. The founder applies them in code (rel.set, cause
  "the brief states (P:.. R:.. S:..)"); the auditor restores any that are MISSING or all-zero in
  the ledger, every audit, in code — and never touches one the pages have moved.
- FIELD REPORT: "why can't I undo a specific entry in What changed instead of the last one?"
  apply.js undoEntry(state, index): takes back ONE entry anywhere in the log, refusing with a
  reason when a later standing entry touched the same thing (undoTarget: kind + name); the
  reversal (applyUndo) is shared with undoLast. The drawer offers "Take it back" on every
  standing entry (last 40 shown) and toasts a refusal's reason.
- Harness: m49.mjs (3 checks). 283/283 + 20/20. version.js -> m49-001.

---

# M50 — the brief's digits read the way the brief is shaped; standings cleaned in code; the rebuild
- FIELD REPORT: "everyone likes Jovan, doubled, hallucinated — Aurora P60 not following the brief."
  ROOT: the M49 parser took a line's head as the person and assumed every P/R/S triple was toward
  the MC. The writer's briefs are shaped as a HEADING (the owner) followed by "→ Target: … (P R S)"
  lines — the owner's standing toward the target — most of which are NPC↔NPC. The parser wrote a
  standing for "→ Jovan" (the MC toward himself), NPC-to-NPC numbers as if toward the MC,
  duplicates ("Rias" / "Rias Wells" / "→ Rias"), and Aurora's P60 from someone else's line about
  her. A parser built without reading the brief's structure — my fault.
- founder.js explicitStandings(text, mc): a → line yields a standing ONLY when its target IS the
  main character, owned by the nearest heading above; a line without a marker owns its own
  standing toward the MC unless its head is the MC; arrows/bullets stripped; deduped by person
  (samePersonLoose: same first token + containment), the fuller name kept. Without a known MC
  only inline standings are read.
- apply.js rel.clear {name, cause}: a standing let go entirely, undoable (rel.restore).
- auditor.js standingsHousekeeping(state, brief, castNotes, mc), applied EVERY audit in code: junk
  keys (arrow/bullet heads, the MC himself) cleared; duplicates merged to the fuller name (numbers
  move over when the fuller is zero); the brief's digits restore a standing that is missing or
  zero AS THE LEDGER WILL STAND after the merge; a living standing is left alone.
- rebuildStandings (Drawer → On their mind → "Rebuild from the brief, the pages and the record",
  confirm): every standing let go (undoable), the digits written in code, then one model reading
  of the brief + record + latest pages writes rel.set toward the MC only — a cause that does not
  name the MC, a standing for the MC, or any other mutation type is refused.
- Harness: m50.mjs (3 checks on the writer's exact brief shape); m49-1 updated. 286/286 + 20/20.
  version.js -> m50-001.

---

# M52 — the gradual rebuilder (Summaryception's way)
- FIELD REPORT: "Summaryception rebuilds snippets and the character ledger gradually — turn 0 to 3,
  summarize, continue — it never reads the whole 1000-turn chat." The tavern's record was already
  folded that way as pages left the window, and the pages of the people written per page; what
  did not exist was a REBUILD of either, and the M50 standings rebuild was a one-shot read.
- js/agents/rebuild.js:
  rebuildRecord — the record's lines are backed up (memoryBackup:<storyId>) and let go; the keeper
  folds the pages again from the first, six at a time, holes-first (maybeSummarize in a loop
  until nothing below the window is uncovered); progress toasts; the old record can be put back.
  rebuildPeople — the pages of the people and every standing are backed up (peopleBackup:) and
  let go; the brief's digits become the standings' origin; then every batch of six pages is read
  IN ORDER with the record that covers the pages before it, the pages-so-far and the standings-
  so-far as context; the reader answers {deltas (people.set), shifts (rel.shift toward the MC
  with a cause)}; names resolve to the person the ledger already knows ("Rias" → "Rias Wells");
  the MC gets no page (state only) and no standing; applied through the closed vocabulary.
  Never the whole story in one prompt — ~N/6 worker calls for N pages.
- Drawer: The workers → "Rebuild the record from the pages" / "Put the old record back";
  On their mind → "Rebuild the people from the pages" / "Put the old pages and standings back"
  (replaces the M50 one-shot button; rebuildStandings stays for the harness and the housekeeper).
- Harness: m52.mjs (3 checks incl. both gradual walks end to end). 291/291 + 20/20.
  version.js -> m52-001.

---

# M53 — the reader knows the writer's law of the standings; a nudge is a number
- FIELD REPORT (a sex scene, empty brief, turn 7): "Rebecca — distant (R-8), a charge (S+15) …
  stepped back after 'You can't see me next weekend … don't waste this one' — she names the limit
  of what he is to her. Not accurate; no P; does the agent even know what P:R:S is?" It did not:
  the reader's whole law was one line ("p warmth, r romantic pull, s sensual charge"), nothing
  about WHEN a standing moves. It docked R on a motivated reading of a playful line and never
  moved P through intimacy because nobody told it trust is warmth.
- extractor.js STANDINGS_LAW — the writer's NPC Psychology law, whole: the three axes with their
  negatives (R negative = romantic aversion, NOT "wants less commitment"); zero start; SCORES MOVE
  ON REVELATION with the examples; DISPOSITION NOT MOOD (care-shaped distress never subtracts);
  a stated boundary/limit is a FACT about the bond, lowering R only if the page shows she wants
  LESS than before — said playfully or while wanting him now it moves nothing, or moves S;
  intimacy moves S with wanting shown, P with trust shown, R with attachment shown; charm is not
  a cause.
- relationships.js AXIS_WORDS: symmetric bands, a word only at |v| ≥ 10 ("distant" for R-8 was
  the drawer shouting a whisper): friendly/cooler, a spark/holding back, a charge/cool.
- Harness: m53.mjs. 293/293 + 20/20. version.js -> m53-001.

---

# M54 — the workers carry their slices of the writer's preset
- FIELD REPORT: "does the whole frontend carry all parts of my preset, or only the storyteller?"
  Inventory (grep of law names by file): the craft carries every law; the workers carried slices
  — the extractor the standings law (M53), the founder/auditor the Axis Lock and the real record,
  the world agent the quarantine's pathways. Missing: the SCRIBE had no Character Gravity, so a
  page could drift to "grudgingly impressed" and the storyteller would inherit it; the WORLD AGENT
  had no Strategic Persistence / Goal Death Test, Self-Preservation > Loyalty > MC, Stakes Web,
  Setting Baseline, Cost Is World Logic.
- scribe.js: CHARACTER GRAVITY block (STACK, ROUTE, VELOCITY, RECALL, A Person Is Not Their CORE,
  Defeat Is Not Redemption, Goals Persist). world.js: THE PEOPLE'S PHYSICS block (Strategic
  Persistence + Goal Death Test, Self-Preservation > Loyalty > MC, Stakes Web, Setting Baseline
  + transactional indifference, Cost Is World Logic Not Punishment).
- The preset itself is on disk (/home/claude/preset, 39 modules; the V177 JSON in uploads) and
  the craft core is in js/assemble/craft.js — none of it depends on conversation memory.
- 294/294 + 20/20. version.js -> m54-001.

---

# M55 — the rest glyph; a branch stays on its shelf
- FIELD REPORT: "a bar like prison bars on the chat that makes resting, with a white banner" — the
  story list's archive button drew "▦" (crosshatched square), which Android renders as a white
  tile. Now "☾" (put to rest) / "↩" (wake) — plain text glyphs everywhere.
- FIELD REPORT: "when I branch a chat from a project it lands outside the project" — BRANCH_CARRY
  lacked projectId. Carried now, with workerConnections, mend, audit, worldAgent (the story's own
  switches). DOM-8 puts the origin on a shelf and asserts the branch is on the same one.
- 294/294 + 20/20. version.js -> m55-001.

---

# M56 — a tale moves to a shelf
- FIELD REPORT: "can we move a chat to a project?" The story row's menu (the "Take this tale with
  you" button) now has a "Move to a shelf" section: one entry per shelf and "No shelf (loose)",
  the current one omitted; the shelves are re-read at menu open. Moving changes projectId only —
  nothing inside the tale. DOM-12b moves a tale to a shelf and back through the real UI.
- 294/294 + 21/21. version.js -> m56-001.

---

# M57 — passers-through retire
- FIELD REPORT: "unimportant characters like my MC's Uber driver keep being tracked." Three fixes:
  the scribe's law — PASSERS-THROUGH GET NO PAGE (a driver, a clerk, a waiter: texture, not a
  person to keep, until the story gives them a want, a bond or a second scene); in code, every
  audit's peopleHousekeeping retires a person with no nonzero standing, no seat, no loose end,
  nothing locked, not present, not the MC, and RETIRE_AFTER=30 turns since their page last moved
  (people.retire, undoable; people.wake by hand); a retired page rides to NO ONE (renderPeopleTiers
  skips it — no card, no roster line) and shows in the drawer's people panel folded under "Passed
  through" with "Bring back". A presence.enter or a people.set for them wakes them automatically.
- The bottom count ("~N of ~M tokens in the room") is the last request whole — ledger included;
  the receipt under a reply is its breakdown. Documented in the reply, no change.
- Harness: m57.mjs. 296/296 + 21/21. version.js -> m57-001.

---

# M58 — the model reads the brief's standings; code only validates
- FIELD REPORT: "why a dumb parser when Chat Assistant can read any text and understand it?" Because
  I put a code guard where a model reader belonged (M49, after one model miss), then chased the
  brief's shapes one line at a time (M50, M50-002, M57-002, M57-003). Code cannot misjudge — and
  cannot understand. The house's own design is: models READ, code GUARDS.
- founder.js: readStatedStandings({connection, brief, castNotes, mc}) — one small focused call
  (buildStatedStandingsMessages: whose stance, toward whom; labels are not people; a family is
  not a person; only toward the MC); validateStatedStandings in code (a person, not a label, not
  a group, not the MC, deduped to the fuller name, clamped). explicitStandings (the line parser)
  remains ONLY as the fallback when the model returns nothing usable or there is no connection.
  Used by the founder, the auditor's housekeeping (standingsHousekeeping takes the list), the
  M50 one-shot rebuild and the M52 gradual rebuild.
- Harness: M58 law in m50.mjs; m52-2 counts batch calls only. 299/299 + 21/21. version.js ->
  m58-001.

---

# M59 — updates are serialized per row (a lost update, seen as a flaky shelf)
- The walk flaked on the shelf twice in ten runs (DOM-8 "branch is on the same shelf — got
  undefined", DOM-12b "nothing to click"). ROOT, real in the app: stories.update / messages.update /
  connections.update read the row in one transaction and wrote it in another, so two overlapping
  updates (a worker's status beside a shelf move; a mend beside a swipe; a finding beside an
  extraction) could carry a stale row — the later write erased the earlier change.
- store.js modify(store, key, change): read-modify-write serialized by a per-row promise lock
  (rowLocks). A first attempt inside one IndexedDB transaction did not survive the harness/jsdom
  shims' event ordering; the lock is environment-proof. messages.update also refuses a page
  from another story (returns undefined).
- Harness: store.mjs M59 (three overlapping updates on a story and on a page all stand).
  300/300 + 21/21 ×10. version.js -> m59-001.
- LAW: `… | tail -1 && git push` does not gate on the walk — tail's exit code is 0. Read the line.

---

# M60 — the housekeeper's panel: fullscreen, a draggable top bar, ↻ Retry (Chat Assistant read in full)
- FIELD REPORT: "the assistant box can't be dragged, has no fullscreen, no retry — have you read
  Chat Assistant's full code?" I hadn't (6,557 lines; I worked from notes). Cloned and read:
  makeDraggable (pointer capture on the top bar, clamped, no drag in fullscreen), the
  cc_fullscreen toggle (inline position cleared so CSS wins; Esc leaves fullscreen BEFORE any
  close), retryLast (drop the last assistant turn, re-run the last question).
- index.html/css: #btn-hk-full in the head; .hk-sheet.fullscreen (whole viewport), .floating
  (a dragged sheet keeps its corners), a grab cursor on a fine pointer only.
- ui/housekeeper.js: setFullscreen (aria-pressed, inline position cleared); Esc leaves fullscreen
  first (capture phase); makeDraggable on the head (mouse/pen only — a phone's sheet is full
  width already; double-click docks it back); retryLast: the last housekeeper turn (and its
  still-pending cards) is let go and the last question sent again — applied cards stand.
- DOM-11b drives all three through the real UI; the mock house now knows the housekeeper's
  voice. 300/300 + 22/22. version.js -> m60-001.
- What Chat Assistant has that the tavern does NOT (read, not guessed): the deep four-pass
  audit (#m: structure / continuity window by window / memory-against-itself with a spine /
  verify) with a call budget and a resume point; #opt memory optimize; #cl memory cleanup;
  #a fidelity; #o OOC harvest; #i brainstorm; #p psychology read; auto-name chats. The
  tavern's auditor + verifier + rebuild cover the continuity parts by construction (the record
  is verified line by line as it is written; the auditor reads the whole ledger every three
  turns); the writing-room commands (#i, #p, #br) and #opt/#cl are candidates, not gaps in
  correctness.

---

# M61 — Chat Assistant's fixed bugs, held against the housekeeper in one pass
- FIELD REPORT: "you keep fixing bugs Chat Assistant already fixed." Its AGENTS.md invariants and
  README version notes (v2.72–v2.83) were read in full and each held against the housekeeper:
  - v2.72 SERVED WHOLE: FULL_PAGE_CAP/FETCH_PAGE_CAP were bare slices labelled "in full" — the
    exact undetectable truncation. Now 0 (no cap); formatPage stamps "(N chars, COMPLETE — first
    character to last)"; over-cap fetch ids are named back, never dropped.
  - v2.76 ANCHORS ARE COPIES: every edit's find is checked at ARRIVAL with Apply's own locate;
    a miss gets ONE [ANCHOR CHECK] round naming the target and the reason; a still-bad card is
    staged REFUSED with the reason, never a failed Apply the writer must notice. A pending card
    whose anchor is dead is retired by any newer proposal on the same page (retireDead) —
    never by anchor equality.
  - v2.80/v2.76 BLIND EDITS: the model's held-whole set is tracked (the served window + every
    fetched page); an edit to a page seen only as an index line is fetched whole and the answer
    asked again, once ([BLIND EDIT]).
  - v2.82 STALE CARDS: the context now carries PENDING CARDS with ⚠ STALE where the anchor no
    longer matches; the law says withdraw with <supersede> in the same answer.
  - v2.77 ONE FACT, EVERY SURFACE: rippleScan — the words an edit removes (find minus the shared
    head/tail, widened to word boundaries) are found in code on every other surface (other pages,
    the record's lines, the pages of the people, the canon, the lore) and handed back once
    ([RIPPLE]) for a sweep in the same run; the law ships on every request.
  - v2.79 FETCH IS THE BLOCK: parseFetchRefs accepts only handles; a fetch in words is
    fetchMalformed and told once with the shape.
  - v2.78 WITHDRAW: applySupersede matches labels loosely (labelKey), returns {count, unmatched};
    unmatched labels are named in the reply; a supersede-only reply says "Withdrew N".
  - THE RECORD IN THE CONTEXT (Chat Assistant's [STORY MEMORY]): every line with its handle
    (#r + id) and page span; <record>[{line, find, replace}] edits a line by the smallest change
    (applyRecordOp, staleness on the line's hash, undo restores the whole line).
- Harness: m61.mjs (7 checks, each a Chat Assistant bug re-proven here); housekeeper.mjs
  supersede law updated. 307/307 + 23/23. version.js -> m61-001.
- Not ported (features, not bugs): the four-pass deep audit with a call budget, #opt, #cl,
  #a, #o, #i, #p, auto-name.

---

# M62 — Chat Assistant's panel, whole
- FIELD REPORT: "port EVERYTHING on Chat Assistant — sessions, branch, clear chat — not three
  functions." Every button in its panel was listed from the code (cc_*) and each is here now:
  SESSIONS (per story, batches shared): a picker + New / Branch (copy) / Rename / Delete; "⑂ branch
  here" on every writer bubble (branchAt); More → Clear this session / Delete the last question
  and answer. Store hk:<storyId> = {sessions:[{id,name,turns}], activeId, batches}; the old
  shape migrates into "Session 1"; loadSession returns the active view so every caller stands.
  COMMANDS in the ask box: #f fix continuity, #s check the session, #a fidelity of the record,
  #o harvest OOC, #i brainstorm four directions, #p psychology read, #opt zero-loss record
  optimize, #cl showrunner cleanup with a SPINE/SUPPORT/TEXTURE/NOISE manifest, #br handoff,
  #d steer the director (directorSteer — re-aims, keeps the number), #e seed the next episode.
  The talk shows what was typed; the expanded request rides the wire.
  MORE: Show the full context it reads (with its char/token count), Raw ledger and record,
  Episode progress (spoiler-free, directorStatus), Reveal the directive, Three episode seeds
  (directorIdeas), Director off (directorOff — clear + reset numbering), View the editor's
  notes, Auto-name this story (one small call), Rename this story, the shortcut list.
  CARDS BAR: Apply all pending / Dismiss all / Clear done (hides applied+skipped) / Re-propose
  failed (asks for corrected anchors or a withdrawal) / Hide-Show cards.
  ⏹ Stop while the housekeeper runs (aborts the worker call).
- Not ported, deliberately: the four-pass deep audit (#m) — the house verifies every record
  line as it is written and audits the whole ledger every three turns, so the pass exists
  as a standing process rather than a command; ST-specific tools (worldbook detector,
  memory-source detector, renamechat slash).
- Harness: m62.mjs (4 checks); DOM-11d drives sessions, a command, the context viewer and
  branch-here through the real UI. 311/311 + 24/24. version.js -> m62-001.
- M62-002: two bugs the walk exposed after the M62 push (which went out red — chaining through
  `tail` again; the rule stands, obey it): (1) closing the sheet then reopening it within 220 ms
  hid it again — a stale close timer; the ledger drawer had a generation guard, the housekeeper
  did not (closeTimer cleared on open, and the timer only hides when still closed); (2) a send
  while the housekeeper was busy was dropped silently — it now says so. The walk waits for the
  ask button to be enabled before asking or touching sessions (busy ↔ send disabled).
  16 green walks in a row. 311/311 + 24/24. version.js -> m62-002.

---

# M63 — the shortcuts adjusted to the house; M24 was never flaky
- FIELD REPORT: "why port SillyTavern's #-commands into a frontend that is different and better?"
  Because I had just been burned for skipping things and stopped judging what belongs. The
  split, by what the house already does: #f/#s (fix/check continuity) → the second reader and
  the auditor do it every turn; #a (fidelity) → the verifier does it on every record line;
  #o (harvest OOC) → the tavern never writes OOC into pages. Those tags still answer but are
  demoted and explained. The asks with no other door become named tools in the More menu:
  Four directions (#i), Read a character's psychology (#p, asks whom), A handoff paragraph
  (#br), Compress the record without loss (#opt), Clean the record like a showrunner (#cl);
  #d/#e stay as the director's steer/seed. The tags remain for muscle memory.
- M24 "the shelf" was failing intermittently since M24: its python check wrote to
  /tmp/m24-shelf-<pid>, and pids recycle in a long-lived sandbox, so a later run inherited an
  earlier run's shelf. A fresh uuid directory per run, cleaned first. Not the keeper's bug; the
  test's. Four clean runs since.
- 311/311 + 24/24. version.js -> m63-001.

---

# M64 — the housekeeper's sheet in Chat Assistant's shape
- FIELD REPORT: "the cards toolbar shows always; where is Clear; the UI is a cluttered mess." True
  on all three: I had stacked a tagline, a sessions row, a nine-button quick row, a cards bar
  and a rules fold ABOVE the talk, and the cards bar was never conditional.
- Now, Chat Assistant's layout exactly: head (title, fullscreen, close) → sessions row (select,
  ＋ New, ⑂ Branch, ✎, ✕) → THE TALK, filling the room → a CARDS BOX that exists only while a
  card is pending or refused (count, Apply all when ≥2, Dismiss all, Re-propose failed when any
  refused, Hide/Show) → the composer at the foot: row one 🔍 Audit · 🎬 New · 🎬 Next · 🎬 Seed ·
  🎬 ? · 📝 Critique; row two ↻ Retry · ⌫ Del last · ↶ Undo · 🧹 Clear · ⋯ More (a drop-up) ·
  ⏹ Stop while busy; then the ask box, the status line, and the house rules folded away (More →
  The house rules). Done cards leave a one-line receipt in the talk ("✓ label — applied"); the
  tagline is gone; "Clear done" is gone (there is nothing to clear).
- Two bugs the walk exposed: Apply/Apply all/Undo were refused while the housekeeper's model
  lock was held — they never call a model; they run on their own `applying` lock now and touch
  only the status line (they used to flip `busy` off mid-turn, which could re-enable the ask
  box while an answer was streaming).
- 311/311 + 24/24 (ten green walks). version.js -> m64-001.

---

# M65 — hidden wins; the sheet's controls are buttons
- FIELD REPORT (screenshots, the tavern beside Chat Assistant): an empty cards bar drawn with no
  cards; the seed form sitting open above the ask box; controls as scattered orange words with
  dashed lines between rows. ROOT of the first two: `hidden` is only the browser's default
  `display:none`, and any class rule that sets display (flex/grid/block) beats it — .hk-cards
  and .hk-seed-form both set display:flex. The walk could not see it: jsdom does not compute
  CSS. base.css now has `[hidden] { display: none !important; }` — the one display-forcing
  !important in the house — and M65's law counts it. Controls: Chat Assistant's cc_btn shape
  (bordered pills on surface-2) for the sessions row, the two composer rows and the cards bar;
  Ren/Del in words; no dashed separators.
- LAW: a CSS rule that sets display on an element that can be `hidden` is a bug unless [hidden]
  wins globally. It does now; never remove it.
- 312/312 + 24/24. version.js -> m65-001.

---

# M66 — a branch never carries a LATER ledger
- FIELD REPORT: "I branched to the start of the story and the ledger wasn't cleared." ROOT: M43's
  fallback. With no checkpoint after the branch page (older than the kept snapshots, or a story
  from before the checkpoint law), branchFrom carried the ledger AS IT STANDS NOW — everything
  that happened afterwards. The order is now: the page's version checkpoint → the boundary before
  the next turn → the nearest checkpoint at or BEFORE the branch point among the carried turns →
  a CLEAN ledger (the MC's name and the calendar's shape kept, nothing else). An inexact carry
  is caught up at once: the chain runs on the last carried page with {deep, audit} — the founder
  (the branch has no founding print), a deep re-reading of the carried pages, the auditor.
- Harness: m43-2 updated; DOM-8b wipes a story's checkpoints, branches at the first page, and
  asserts the branch starts clean and is then founded from its own page. 312/312 + 25/25.
  version.js -> m66-001.

---

# M67 — a version checkpoint belongs to the LAST page only
- FIELD REPORT: "branch from turn 10 to 0 — the ledger is still there; branch from 0 to 0 — the
  ledger is gone." Two bugs:
  (1) 0→0: M66 removed the "ledger as it stands" fallback entirely, but for the LAST page the
      standing ledger IS the exact checkpoint (the page's own checkpoint is written only after
      its workers finish, which a fast branch beats). branchFrom now awaits pendingWork and
      carries the present when the target is the last page.
  (2) N→0: page 0's version checkpoint was being OVERWRITTEN with the present — walking a swipe
      on an old page saved "the ledger being left" (the turn-N ledger) under page 0's key, and
      the chain's checkpoint job did the same whenever it ran on an old page (edit, rescan).
      The branch then carried it faithfully. Now: isLastAssistantPage gates every checkpoint
      write; an OLDER page's versions never own a ledger — walking or re-writing an old page
      changes its words, lets its record line go and asks the auditor; it never rewinds,
      restores, or saves a checkpoint (M40's per-version ledger applies to the last page only,
      which is also all SillyTavern allows).
- DOM-8a drives both reports: a fresh story, branch 0→0 keeps the ledger; two more turns with
  Kim entering, a swipe walked on page 0, then branch N→0 — page 0's checkpoints never hold
  Kim and the branch does not carry her. 312/312 + 26/26 (×4). version.js -> m67-001.

---

# M68 — THE CHECKPOINT INVARIANT, and the replay
- FIELD REPORT: "Summaryception solved all of this; why can't you analyze it so no bugs ever
  again?" Summaryception's laws were already ported (M44); the last bugs were in what it never
  had to solve — versions and edits on OLDER pages, which SillyTavern forbids. What ends the
  class is an INVARIANT, not a bug list: for every storyteller page i, at any moment, a branch at
  page i carries exactly the ledger that stood after page i.
- DOM-8c: a story whose reader seats Person<i> on page i, then a seeded sequence — four sends,
  swipe the last page, send, walk a version on an old page, retry, edit an old page, send, delete
  a middle page, send — and after EVERY action a branch at EVERY page, checked against the set
  of people that page's prefix seats. Four real bugs it found, all fixed:
  1. The swipe path `return`ed undefined from inside generate's try, so generate reported
     "nothing landed" and the caller put the PRE-SWIPE ledger back over the new version (the
     old and the new person both present). `return landed`.
  2. A history change at an OLDER page (a version walked, an edit kept, a middle page deleted)
     left the ledger to "the auditor next turn". Now THE REPLAY (replayFrom): rewind to the
     checkpoint before that turn (rewindTo, exact or nearest; a first-turn change → a clean
     ledger), let the record go from that page (memoryTruncatedAt), and run the workers over
     every page from there forward, re-taking each turn's boundary (snapshotState) as it goes —
     Summaryception's journal replay, done with the pages. One replay at a time.
  3. A middle-page delete replayed from the NEXT page's boundary, so the deleted page's person
     survived; it rewinds to the DELETED turn's boundary (computed before removal, passed in).
  4. Stale per-version checkpoints survived a replay and branchFrom trusted them first; a replay
     clears the version states from that page on and the checkpoint job writes fresh ones while
     `replaying` (otherwise the last page only, M67).
- Also: a send while the house is busy kept silently dropping the typed words — they stay in the
  box now, with a toast; window.__cozy exposes ctx (the walk waits on ctx.chat.isBusy()).
- 312/312 + 27/27 (the invariant walk green ×4). version.js -> m68-001.

---

# M69 — Summaryception's journal, ported: the ledger is a fold; the timeline judges itself
- FIELD REPORT (from Summaryception's author): "Summaryception had the same class of problem —
  branch at the start not clearing the ledger and snippets — and solved it. 'ST only swipes the
  last message' makes no sense." Correct, and I was wrong. repairIfBranched + rewindLedgerFromNotes
  are the design: every ledger write is a NOTE stamped with its turn, the ledger is a FOLD of the
  notes, a rewind is "keep notes ≤ T and fold" (exact, no model call), and a branch is repaired
  by its own stamps (_t/_st past the chat end), never by trusting a pointer or a checkpoint.
- state.journal [{id, p, m}] — every applied mutation, stamped with the storyteller-page index
  (state.page, set by the extractor's job before it applies; the founder's writes before it carry
  the previous page) and tied to its log entry (jid) so a take-back drops it from the fold.
  JOURNAL_CAP 6000; older folds start from the sparse snapshots (which carry page + journal).
- foldJournal(current, snapshots, P, applyMutations): the ledger at the end of page P — from the
  nearest snapshot with page ≤ P (else empty, keeping the MC's name, the calendar's shape and the
  founding print), re-applying the journal's entries with page in (base, P]. Pure, deterministic.
- timelineAhead(state, pages): the stamps judge the ledger — state.page or any journal entry at
  or past the end = another timeline's ledger. repairTimeline runs on every story open and folds
  back to the last page that exists (Summaryception's repairIfBranched).
- The replay (M68) is now a FOLD: fold to the page before the change; ONE reading for the page
  whose words changed (walk, edit); the later pages' writes re-applied exactly from the journal
  (shifted down after a delete, via kOverride/atOverride/shiftAfter); every later boundary
  re-taken from the folded timeline. branchFrom's inexact case is the fold too.
- The invariant walk (DOM-8c) holds throughout; DOM-8b now asserts the branch at page 0 equals
  the fold at page 0 (better than clean). 312/312 + 27/27 (×3). version.js -> m69-001.
