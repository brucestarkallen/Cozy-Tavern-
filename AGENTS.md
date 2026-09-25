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

---

# M70 — a branch at a WRITER'S page
- FIELD REPORT: "branching to my first user message from page 24 — the ledger is still there."
  ROOT: branchFrom reckoned only from a storyteller page; for a writer's page it took the
  checkpoint after storyteller page 0, so a branch holding NO storyteller page got page 0's
  ledger. With the journal there is one rule for any page: fold to the last storyteller page
  the branch actually contains — for the first writer's message that is k = -1: empty but for
  what the founder wrote from the brief (foldJournal re-applies the founding, stamped -1, when
  it starts from an empty base). The checkpoint reckoning stands only for a store with no
  journal. Also: branchFrom while busy or replaying used to return silently — it says so now.
- DOM-8d: a long story, branch at the first writer's message → no storyteller page, no one
  present, no ground. 312/312 + 28/28 (×3). version.js -> m70-001.

---

# M71 — a branch at a writer's page: no clock from nothing; a pre-journal story uses that message's own checkpoint
- FIELD REPORT (screenshots): branch at the first writer's message from page 24 — the branch holds
  only that message (right) but its ledger shows the clock "Thursday, August 20, 2026 — 11:04".
  Two causes: (1) foldJournal's empty base copied the clock object "for the calendar's shape" —
  and the clock carries a cached date label, so a ledger that should have no clock showed page
  0's date; now from nothing means nothing (no clock, no founding print — the founder runs again
  on the first page). (2) The story predates the journal (M69), so the fold was not used and the
  fallback for a WRITER'S page took the checkpoint keyed to the NEXT turn — the state after the
  page that answered it. A writer's page now uses the checkpoint keyed to that very message: the
  ledger before its turn. DOM-8d asserts no clock and no seats as well.
- 312/312 + 28/28 (×8). version.js -> m71-001.

---

# M72 — the ledger foolproof: every write a note, the fold by what a snapshot holds, the replay sequenced
- FIELD REPORT: "sweep everything; make sure the ledger and the master assistant are foolproof." The
  sweep traced every write into the ledger against Summaryception's one principle (every write is a
  note stamped with its page; the ledger is a fold of the notes) and found the places it was still
  bent. Nine roots, each with a proof (m72.mjs, 12 checks; DOM-8c grown):
  1. THE SCRIBE'S WRITES WERE NEVER JOURNALED (mergeDeltas → saveState). Every fold — a branch, a
     replay, a rewind — lost the character pages written after its base; replayFrom re-took its
     boundaries from an EMPTY base, so after any older-page edit the next swipe on the last page
     wiped the people. Now `people.note {name, field, text}` (one delta per entry, the merge's own
     laws in the applier) and the scribe writes through applyMutations. The world agent's word too:
     `world.word {brief}` (a swipe gets the brief its page had; M30's "last six windows" lives in
     the applier). A take-back is a note as well: `undo.apply {undo, of}` — undoEntry/undoLast used
     to DELETE the original from the journal, so a fold from a base taken before the undo put the
     effect straight back.
  2. THE FOLD RE-APPLIED BY PAGE (`p > base.page`). The send path waits five seconds for the
     previous page's readers, so a boundary snapshot is routinely taken MID-CHAIN — page already k,
     entries stamped k still landing — and those late entries were skipped. What a snapshot holds
     is now read off the snapshot's OWN journal (page + mutation, once per copy), never its page and
     never its ids (folds renumber ids; a sequence number is not a stable pointer). Entries re-apply
     in (page, id) order. A fold clears pendingVerdict (a ruling rides one turn) and carries
     refHistory (the referee prunes its own timeline by message id).
  3. A NEW VERSION WRITTEN ON AN OLDER PAGE never replayed: it was read on top of the latest ledger
     and left to the auditor — its people sat down at page N, and both versions' entries stood at
     page k. generate({swipeTarget, replayAfter:true}) skips the chain; swipeRegenerate replays.
  4. A WRITER'S PAGE DELETED MID-STORY replayed from k = -1 (the index was taken among storyteller
     pages), folding to an empty ledger and shifting every stamp down by one. It moves no
     storyteller page: the record slides, nothing else.
  5. THE LAST STORYTELLER PAGE DELETED kept its people and its hour until the story was next opened.
     It folds back to the page before, now (foldTo), and lets its version checkpoints go.
  6. COMMITTED FATE WAS BROKEN BY TRUE ROLLBACK: the boundary was taken BEFORE the referee, so a
     swipe rewound to a ledger with no commit and rolled the die again (the harness proved fate at
     the referee's level only). Now the coming page's index stamps the turn before the referee
     (`state.page = history.filter(assistant).length` — a branch at page k used to carry a fight
     begun by message k+1), the boundary is taken AFTER the referee (it carries the commit), each
     commit keeps `after` (duel/battle/composure/combat mode/sheet) and a replay restores it.
     branchFrom re-keys refHistory through idMap (unmapped, every entry was foreign and the referee
     pruned its whole timeline on the branch's next turn).
  7. stale() WAS A NO-OP (the queue's epoch turns only in switchWorkerStory, unwired since M33). A
     reader still working on the OLD words kept writing after a rewind, and its checkpoint job saved
     the rewound ledger under the NEW version's key. THE CHAIN GENERATION (chainGen): every fold and
     rewind turns it; every job captures it when queued and writes nothing when it has turned; the
     keeper is told (maybeSummarize({stale})). A send never turns it — the previous page's readers
     must land. LAW: a job that writes checks stale() first.
  8. THE KEEPER'S LOST UPDATE: maybeSummarize saved the copy it loaded BEFORE its slow call, putting
     back a hole punched (or a line let go, or the housekeeper's edit) while it was out. It re-reads
     the record before every write; a line lands only if its pages are still there, unchanged, and
     uncovered; a merge only if its sources still stand (nodeUnmoved).
  9. THE REPLAY IS SEQUENCED: readers in flight land first (their writes belong to the timeline being
     folded), the fold is immediate, the one reading is a chain, and the tail (later writes, the
     boundaries from the snapshots BEFORE the change, the last page's checkpoint) is a job queued
     BEHIND it. A send during a replay behaves as under the latency law; a second history change
     waits (`replaying`, with a toast). The replay is CLAIMED right after the store write, before
     any rendering — the walk found the gap where the house looked idle and the next action was
     refused. Also: repairTimeline never runs in a busy house; a page stopped by hand is read by the
     chain (its words stand in the story; a retry folds the reading away); M49's refusal law read an
     entrance (presence.remove) and a later change to the same person (presence.restore) as two
     targets — one now.
- M31-5 read the writer's regex file from /tmp — the previous sandbox's; red on any fresh clone. The
  file is tests/fixtures/st-regex.json (the 🎨 pack in SillyTavern's shape).
- Laws restated in the harness: M21-C (the boundary follows the referee), M40-1 (replayAfter),
  M43-2 (the branch re-keys the referee's timeline; the window is 8000).
- DOM-8c now also writes a NEW version on an old page, edits the last page, deletes a writer's page
  mid-story and the tail page, and asserts the STANDING ledger (not only every branch) after every
  action; settled() waits on the replay. 324/324 + 28/28 (×5). version.js -> m72-001.
- NOT done, said plainly: the referee's beat-by-beat writes (duel rounds, composure) are still
  direct writes — a swipe on the last page is exact (the commit's `after`), an older-page replay
  through an active fight is not; the housekeeper's page edits do not re-read the page (Chat
  Assistant's law: the housekeeper sweeps every surface itself, and the ripple asks it to).

---

# M73 — the housekeeper's bubble row, whole (Chat Assistant's attachMsgIcons)
- FIELD REPORT: "why is there a Branch at the top that is basically New? why branch only on my
  messages and not the answers? why no swipe, delete, edit, branch, nothing under the bubbles?"
  All fair. M62 ported one "branch here" onto the writer's bubble and nothing else. Chat Assistant's
  row (attachMsgIcons, read in full): writer → ✎ edit-and-continue · 📋 copy · 🌿 branch · ✕ delete;
  answer → 📋 copy · 🌿 branch · ✕ delete. Its top "Branch" is a COPY of the whole talk, independent
  of the original (branchSession) — which is why it looked like New.
- Now, every bubble carries the row (.hk-acts): writer → ✎ Edit (Chat Assistant's
  startEditUserMessage: everything from that turn on is let go, the words come back to the ask box,
  a confirm only when turns follow) · ⧉ Copy · ⑂ Branch · ✕ Delete (one turn; the ones around it
  stay). Answer → ◂ n/N ▸ (its versions, on the LAST answer) · ↻ Retry · ⧉ Copy · ⑂ Branch ·
  ✕ Delete. ↻ on the last answer writes a NEW VERSION beside the old (the story's swipes:
  turn.swipes/swipeIdx; each version carries its own cards — only the shown version's cards are
  live, applied ones stand as receipts whichever shows); ↻ on an older answer asks its question
  again from there and the answers after it are let go (edit-and-continue's law). The toolbar's
  ↻ is the bubble's ↻ on the last answer. The top button is "⧉ Copy" with a title saying what it
  copies. Store ops in agents/housekeeper.js (editTurnAt, deleteTurnAt, truncateForRetry,
  keepVersions, walkVersion, versionsOf); cleanTurns keeps versions on reload.
- LAW: the version arrows are never `disabled` — jsdom (and a phone's tap) drops a click on a
  disabled button; past-the-end is a no-op with a dimmed arrow (.hk-dim).
- Harness: m73.mjs (3 checks); DOM-11d drives the whole row — branch on the answer, retry as a
  version (counting from the versions that already stand), the versions walked, a turn let go,
  edit-and-continue. 327/327 + 28/28 (×3). version.js -> m73-001.
- On the writer's other question (the magic of RP, the positivity of aligned models): answered in
  words, not code — reverse the split (an RP-tuned prose model as the storyteller, the smart model
  as the backstage crew; per-role connections already allow it), then an INTENT worker (present
  NPCs' next moves decided off the send path by an unbiased model, riding beside the world's word)
  if the beats still soften. A 30B local model was tried and judged not good enough for the prose.
- M73-002: FIELD REPORT "where's the answer swipe button for an alternative answer?" — the ↻ was
  doing it, but ↻ reads as try-again and the arrows showed only after one. Now the LAST answer
  always wears the story's bar, ◂ n/N ▸: ▸ past the last version writes another answer (the old
  one stays); ◂ walks back. ↻ Retry stays on OLDER answers only (ask again from here). And a flake
  the walk exposed (1 in ~6): after a new version on an OLDER story page, generate()'s own finally
  had already let `busy` go and swipeRegenerate awaited the shelf before claiming the replay — a
  branch in that gap was refused as "replaying". The replay is claimed the moment generate returns.
  327/327 + 28/28 (×6). version.js -> m73-002.

---

# M74 — the housekeeper sees every surface it is told to keep, and can write every one of them (Chat Assistant's law, ported whole)
- FIELD REPORT (after fourteen hours): "the master assistant is broken — I can't edit the brief, can't
  edit anything, it hallucinates, it can't see the brief, can't edit plot essential, it's confused."
  Chat Assistant's system instructions were read in full and held against the housekeeper's. Its
  [STORY MEMORY] shows EVERY field whole — the notepad (Plot Essential), each character's CORE /
  STATE / ARC / THREADS, the worldbook — and every one is editable; its laws are "answer from
  EVIDENCE, not previews" and "REPORT THE SWEEP, do not promise it". The tavern's housekeeper was
  told ONE FACT, EVERY SURFACE — "sweep the pages of the people, the canon, the lore" — while it
  could not SEE the cast notes or the pages of the people at all, saw 200 characters of each lore
  entry, saw rule names with no text, had no block to change the brief, and knew half the ledger's
  vocabulary. Told nothing changes without a block, but never told not to CLAIM a change. So it
  answered "done" about things it could not do — the hallucination the writer met.
- THE CONTEXT, every surface whole and named for the block that changes it: THE BRIEF (the
  writer's standing words — premise, plot essentials, notes to the storyteller; the tavern's
  notepad) and THE CAST NOTES, whole, `<brief>`; THE LEDGER, `<ledits>`; THE PAGES OF THE PEOPLE
  (CORE / STATE / ARC / THREADS, whole), `<ledits>` people.set / people.note; THE RECORD, `<record>`;
  THE LORE SHELF whole (LORE_SHOW_CAP 4000 per entry, then `<fetch>["lore: name"]` serves it),
  `<lore>`; THE RULEBOOK by name with `<fetch>["rule: name"]` serving a rule's text for `<redits>`.
- `<brief>[{field:"brief"|"cast", find/replace | text | append, reason}]` — staged as cards,
  anchors checked at arrival, staleness on the field's hash, apply writes the story, undo restores
  the field; touched.story refreshes Settings and the story room; the founder re-reads a changed
  brief by its fingerprint on the next page. rippleScan sweeps the brief and the cast notes too.
- THE FULL LEDGER VOCABULARY in the prompt: mc.set, place.set, thread.set/close, knowledge.add,
  faction.set, people.set (a whole field; threads as a semicolon list), people.note (one loose end
  added or closed), people.retire/wake, rel.clear, offscreen stance/eta.
- LEDGER CARDS GO STALE ONLY WHEN THE THING THEY TOUCH MOVED (ledgerTargetKey / ledgerSliceHash:
  the clock, the ground, one seat, one standing, one page…). The whole-state hash went stale on
  EVERY page turn (the readers write the journal, the log and the turn each time), so a card staged
  a minute ago was refused as "the ledger has been written since" — and so was its undo.
- THE LAWS, in the prompt: NOTHING HAPPENS IN PROSE (never "done"/"updated"/"fixed" without the
  block in THIS answer; if no block can do it, say so and name the nearest); ANSWER FROM EVIDENCE,
  NOT PREVIEWS (never invent a page, a name, a fact, a date or a line not shown — fetch it or say
  you don't have it); REPORT THE SWEEP with numbers, a surface unmentioned reads as unchecked.
- Harness: m74.mjs (6 checks); m38-1 updated to the whole shelf; DOM-11c stages a <brief> card,
  applies it, sees it in Settings, takes it back. 333/333 + 28/28 (×3). version.js -> m74-001.

---

# M75 — the housekeeper is decisive, on the storyteller's brains
- FIELD REPORT: "change the brief, Alexia 20 → 19" got a statement ("Alexia is 20, not 19"); "all
  first-years are 16" got "a standing rule" somewhere else; "why is it smart in SillyTavern and
  stupid here?" Two roots, both ours:
  1. THE MODEL. With no hands of its own set, the housekeeper fell to the WORKERS' connection —
     the cheap reader — while Chat Assistant in SillyTavern ran on the main model. Now: its own
     hands → the story's teller → the active storyteller → the workers, in that order. The
     Settings words say so.
  2. NOTHING ENFORCED THE BLOCK. The rounds caught blind edits, bad anchors and ripples; an
     asked-for change answered in prose, with zero blocks, simply returned — and the writer read
     "done". Chat Assistant's law ("be decisive: PROPOSE the fix as a block in the SAME reply,
     never 'want me to adjust?'") is in the prompt now AND enforced in code: [THE BRIEF] — the ask
     names the brief / cast notes and is a change (a change verb, "not 19", or a plain statement
     of how things are that is not a question) and no <brief> block came → sent back once, with
     the placement law (replace a fact that stands; a new fact beside the line it belongs to;
     append only when no line fits); [NOTHING HAPPENED] — a change asked for or CLAIMED
     ("done", "updated", "I have set") and no block at all → sent back once, told to say plainly
     when no block can do it. A worked <brief> example rides the prompt (Alexia (20) → (19)).
- Harness: m75.mjs (4 checks, the writer's own asks scripted through runConversation).
  337/337 + 28/28 (×2). version.js -> m75-001.
- To the writer: reload once so the new coat lands (the version in the corner reads m75-001), and
  give the housekeeper hands of its own in Settings only if the storyteller's model is not the one
  you want it thinking with.
- M75-002: FIELD REPORT: "I deliberately use DeepSeek, and Chat Assistant in SillyTavern is smart on
  the same DeepSeek." Correct — the model was never the difference, and M75's first root was wrong
  as a diagnosis (the default-connection change stands as a sane default, nothing more). The
  measured delta: Chat Assistant asks for max_tokens 8192 (up to 32768) and, when thinking eats the
  pot, feeds the reasoning back with a bigger pot and demands the answer. The tavern asked for
  2000 — or inherited a worker connection's few hundred — so a repair answer with a sweep and two
  blocks was cut mid-block; the closing tag never came; innerBlocks runs an unclosed block to the
  end of the text and its JSON never balances; the card was lost and the writer saw the statement
  that preceded it. Now: HK_MAX_TOKENS 8192 as a FLOOR the connection cannot lower; the provider's
  finishReason is read; a cut inside a block is re-asked once with the blocks first and the pot
  doubled ([CUT SHORT]); an answer consumed by thinking is recovered once, Chat Assistant's way
  (<previous_reasoning> fed back, pot doubled, [ANSWER NOW]); the law BLOCKS FIRST rides the prompt
  so a cut can only ever cost chatter. m75-5. 338/338 + 28/28 (×2). version.js -> m75-002.
- M75-003: FIELD REPORT: "my connection's longest reply is already 30000." Then the pot was not the
  writer's cut either (the old callModel took the connection's number when set) — two wrong
  diagnoses in a row, and the reason is that the house kept NO EVIDENCE: the talk showed the prose
  with the blocks stripped, and a block that failed to read vanished. Nothing is lost in silence
  now: (1) every answer keeps what the model said WHOLE on the turn (turn.raw, RAW_KEEP_CAP 24000)
  with a fold "What it said, whole" under the answer, and the rounds it took; (2) a block that came
  with words in it and yielded no op is UNREADABLE — a refused card the writer can see, with how it
  began — and the model is asked once for the same block as plain JSON ([UNREADABLE BLOCK]); (3) a
  brief edit written into <edits> (field brief/cast, no page id) lands on the brief; Chat
  Assistant's own <memedits> / <wiedits> tags are read as the brief and the shelf; (4) an open tag
  with no close is a block only when JSON follows it — "it would be a <brief> card" in prose used to
  be stripped from the talk from the tag to the end. m75-6. 339/339 + 28/28 (×2).
  version.js -> m75-003. NEXT TIME: open "What it said, whole" under the failing answer and read
  it before diagnosing anything.

---

# M76 — the housekeeper thinks; every card shows its evidence (Chat Assistant's card and reply, whole)
- FIELD REPORT: "why is there no thinking block? why does the card say only 'change Alexia 15 to
  16' with no original words and no new words as evidence? why no description at the top of each
  change of what it did? can you read Chat Assistant or not?" Read again, whole, and held against
  the tavern's own code:
  1. THE THINKING. The tavern's provider sends DeepSeek thinking:{type:'disabled'} whenever a
     connection's reasoning is unset or off, and the housekeeper inherited the connection's — so it
     ran the NON-THINKING model as an editor, while Chat Assistant in SillyTavern runs the same
     DeepSeek with reasoning on (the writer sees its block). That was the "smart there, stupid
     here". The housekeeper's effort is its own now: hkReasoning (Settings, under its hands),
     default 'high' — DeepSeek is asked with thinking enabled and reasoning_effort high whatever
     the connection says; 'off' is a choice. The thinking streams live into a fold ("How it's
     weighing it…", open while it thinks, folded at the first word of the answer) with Chat
     Assistant's ticker on the status line (elapsed · answer chars · +thinking chars); the kept
     thinking shows under the reply as before. The pot floor of 8192 stands under the larger of
     the connection's number.
  2. THE CARD'S EVIDENCE. The before (red) / after (green) halves were drawn for page and rule
     cards ONLY — a card for the brief, the record or the lore showed a label and nothing else.
     Every kind draws its evidence now: brief (find → replace; the whole old text → the new; "added
     at the end, after …"), record (find → replace), lore (add: keys + content; edit: old content →
     new, keys/name/switches; remove: what leaves), ledger (a DRY RUN at staging says what the
     ledger WILL write, and what it refuses). Edit-by-hand on every card that carries words.
  3. THE REASON. Shown at the top of every card; a missing one shows "(no reason given)" so its
     absence is seen. The prompt: EVERY OP CARRIES A REASON; SAY WHAT YOU DID, PER CHANGE (where,
     from what, to what, why; what you found; the sweep with numbers — Chat Assistant's M-EYE).
  4. A PURITY LEAK, older than today: copyState copied every ledger but the journal, so every
     applyMutations since M69 also pushed its entries into the CALLER's journal array. The dry
     run exposed it (a staged card's hash held the preview's entries). Copied now; worldShown too.
- Harness: m76.mjs (2 checks) + m75's M76-1; 342/342 + 28/28 (×2). version.js -> m76-001.

---

# M77 — the thinking stays; the viewers are pop-ups; the connection's switch governs; a class edits each member
- FIELD REPORT (five): (1) "I turned reasoning off on my connection — why does the housekeeper
  reason?" (2) "with thinking on, the block shows while it thinks and is GONE after the answer."
  (3) "who puts 'see context' INTO the chat? it should pop up." (4) "asked: every 16-year-old is a
  first-year like Claire, on each one's profile — it changed Alexia's age and then added one
  redundant line 'Alexia and Claire are 16'." (5) "you can simulate this yourself."
  1. hkReasoning '' = as the connection says (the house's choice); a value set here overrides the
     connection either way. M76's default of 'high' surprised the writer; a connection switched
     off must stay off unless he says otherwise.
  2. ROOT, found by simulating it (DOM-11e): runConversation returned only the LAST round's
     thinking; the follow-up to a nudge ([THE BRIEF], [NOTHING HAPPENED], [RIPPLE]…) thinks little
     or not at all, so the real reasoning was thrown away and no fold rendered. Every round's
     thinking is kept now, joined with "— asked again —", and the fold under the reply holds it.
  3. viewer() opens a POP-UP (#hk-pop: title, Copy, Close; Esc closes it before fullscreen) —
     Chat Assistant's popup — never a fold dumped into the talk. The full context, the raw ledger,
     the notes, the directive, the shortcuts all ride it.
  4. Two laws with the writer's own case as the example: A FACT FOR A CLASS is written on EACH
     member's line (find every line that fits; one summary line is the wrong answer; so is naming
     only the ones mentioned); MATCH THE SHAPE ("like Jovan", "same as Claire" = the same words in
     the same place). The example: Claire (16) and Alexia (16) each get "first year at Ravenwood
     High" in Jovan's shape.
  5. The walk now simulates the housekeeper thinking (env.mjs state.hkThink serves
     reasoning_content on its calls) and drives the whole flow: a fresh session, an ask, the fold
     under the reply, the thinking on the turn, the context pop-up opened and closed by Esc.
- 343/343 + 29/29 (×2). version.js -> m77-001.

---

# M78 — staleness is the anchor (Chat Assistant's only law); "Apply all" lands every card
- FIELD REPORT (the receipts pasted): "✓ the brief … then five × '– the brief — the brief has
  changed since this was staged — ask, and it can be proposed again'. Explain." The model had done
  exactly the right thing — six <brief> cards, one per sixteen-year-old. Apply all applied the
  first; the brief's text changed; M74's staleness gate compared the WHOLE brief's hash and refused
  the other five as "changed since staged". The same coarse gate hit two edits to one page (M61's
  whole-page hash), two edits to one record line, two edits to one lore entry, and a second lore
  add (the shelf's id list). Five hours of the writer's evening were this bug. Chat Assistant never
  had it: its one law is "does the find still match".
- THE LAW NOW: a find/replace card (page, record line, rule, brief, cast notes) is measured by its
  ANCHOR at apply — locate(find) on the text as it stands; a whole-thing replacement (brief/cast
  "text") by the thing's hash; a hide by the page's existence; a lore edit by the fields it touches;
  a lore add never (a taken name is refused at apply, as such); a bulk re-ink never (a literal
  search recounts itself); a ledger card by its slice (M74).
- THE WORDS: a card that cannot land says what it looked for and where — "not applied — the words
  it looked for, “…”, are not in page #… now (an earlier card may have changed them). Re-propose
  asks the housekeeper to look again" — never "changed since this was staged".
- Old laws restated: M10 (a page that GAINED words keeps its anchor and the card lands; a second
  hide of a hidden page is refused for that reason), M74-3/4 (the anchor review; append never
  stale). New: m78.mjs — the writer's six cards land in one Apply all; two edits per page / per
  record line, two adds and a content edit beside a switch on one entry, all land; a destroyed
  anchor says so. DOM-11c applies two brief cards from one answer with Apply all.
  345/345 + 29/29 (×2). version.js -> m78-001.

---

# M79 — read the order; never duplicate (the overfit class law is gone)
- FIELD REPORT: M77's "a fact for a class is written on each member's line — a summary line is the
  wrong answer" was a flex tape: it would block the writer the day he WANTS a rule, and its
  hard-coded example was one guess at one order. The order in question had three parts (Alexia
  15→16; every 16 is a first-year, with Claire as the FORM; add "first year" to each 16-year-old's
  dossier that lacks it); the model invented a fourth (a rule under world rules) and duplicated
  what Claire's and Alexia's dossiers already said.
- THE GENERAL LAWS, in the prompt: READ THE ORDER, NOT A GUESS AT IT (settle what / where / who /
  the shape, then do exactly that; "same as Claire" names the FORM, not who is affected; a rule
  only when the writer asks for a rule, and then a rule, not dossier changes; never both unless
  both were asked); NEVER DUPLICATE (read the line before adding to it; a line that already says it
  is done; never restated as a summary elsewhere); SAY HOW YOU READ IT (the words open with the
  reading of the order, so a misreading costs one glance, not a card). M74's placement text and
  its Alexia example stand.
- IN CODE (staging): a brief edit that only ADDS words the same line already holds is refused —
  "that line already says “first year” — nothing to add" (addedWords / duplicateOnLine, the whole
  line read, the find included); an append the field already states is refused. Cross-line
  judgment (a summary of facts other lines hold) is the prompt's; code catches the exact copies.
- m79.mjs (3 checks: the writer's order staged — Alexia and Mina land, Claire's and Alexia's
  second "first year" refused as copies, an already-stated append refused; the helpers; the laws).
  348/348 + 29/29 (×2). version.js -> m79-001.
- To the writer's first question — why it keeps happening with Chat Assistant right there: the
  housekeeper was ported in pieces, across sessions, from notes and then from the failure in front
  of each session, instead of being held whole against Chat Assistant's code and prompt at once.
  M74–M79 have now been that holding: the surfaces, the blocks, the rounds, the cards, the
  thinking, the pot, the staleness law, and the reading of an order. What Chat Assistant still has
  that the tavern does not is listed at M60 (the four-pass audit, #opt, #cl, auto-name) — features,
  not correctness.

---

# M80 — the thinking the writer watched is never lost
- FIELD REPORT: "I can see 'what it said, whole' but not 'how it weighed it'." Both providers hand
  the thinking back, every round's is kept (M77), the render draws it, and the walk proves the
  path — and still, on the writer's DeepSeek, the fold was not there. Rather than a fourth theory:
  (1) the thinking that STREAMED is accumulated in the UI as it arrives and written onto the turn
  itself if the wire's returned copy is empty (saved to the session) — what the writer watched
  cannot be gone afterwards, whatever the cause; (2) the kept fold is drawn ABOVE the reply, where
  the live fold was; (3) the raw fold's title says "thought N chars first" or "no thinking came
  back on the wire" — so the next report tells which half failed. m79's M80-1 (housekeeperTurn
  end to end with a nudge between). 349/349 + 29/29 (×2). version.js -> m80-001.

---

# M81 — the model sees its own past answers whole, and what became of every card (Chat Assistant's history)
- FIELD REPORT: "can the MODEL see 'what it said, whole'? and 'how it weighed it'?" Read in Chat
  Assistant: the assistant history entry is the RAW reply (blocks included) and rides back as
  history; the thinking is stored and never sent (historyForLLM sends {role, content} only —
  DeepSeek refuses reasoning in history); every apply / undo / skip / stop pushes a 'note' the
  model reads next turn as "[STATE] …". The tavern sent t.text (blocks STRIPPED) and no word of
  the cards' fate — so the model could not see what it had proposed nor whether the writer
  applied it; it re-proposed, or assumed a change had landed.
- sessionWireOf: a housekeeper turn rides WHOLE (turn.raw, WIRE_RAW_CAP 16000, else its text);
  after it, when it staged cards, a user "[STATE] What became of the cards in your last answer"
  lists each card's fate (APPLIED / applied then TAKEN BACK / SKIPPED / REFUSED — why / NOT
  APPLIED — why / withdrawn / still pending) and says plainly: what was not applied did not
  happen. The thinking never rides. m79's M81-1. 350/350 + 29/29 (one flaky DOM-8c run, green
  twice after). version.js -> m81-001.

---

# M82 — Chat Assistant's auto-supersede, whole: a second wave retires what it replaces
- FIELD REPORT: "if a proposal fails, is there a button to make the AI say what happened? and if a
  second wave fixes the first wave's wrong cards, are the old ones skipped automatically?"
  (1) Yes: "Re-propose failed" in the cards bar sends every refused/stale card with its reason and
  asks for corrected anchors or a withdrawal; since M81 the [STATE] note tells the model each
  card's fate too. (2) Chat Assistant does it IN CODE (its comment: "no reliance on the model
  remembering to emit a <supersede> block"); the tavern had only the dead-anchor rule, for page
  edits only. Ported whole (stageProposals → mergeDuplicates + autoSupersede): an old PENDING card
  is set aside by a new card that is identical (same signature) or a REFINEMENT (same target,
  same anchor — or both whole replacements — new words); an old FAILED (refused/stale) card, or a
  pending one whose ANCHOR IS DEAD, is set aside by ANY new card on the same concrete target (a
  page, the brief, a record line, a rule, a lore entry, the ledger); an independent fix on the same
  page stands; twins within one answer merge; the reply says "(N older cards set aside — replaced
  by this answer's; Apply all applies only the newest version of each fix.)". Two ledger cards
  are two changes; a hide is never refined by an edit; an add has no one target.
- Also: a swipe pressed while the storyteller is busy says so (M62-002's law) instead of dropping.
- m82.mjs (2 checks). 352/352 + 29/29 (×2 green after one flake).
- OPEN, said plainly: DOM-8c is flaky under load at ONE step — "swipe-new-old: waited too long for
  a new version of an old page" (a swipe past the end on an older page after walking its
  versions), roughly one run in three on a loaded sandbox, green on rerun. Claiming the replay
  before swipeTo's store work was tried and did NOT cure it (and broke M44-6's shape law), so the
  gap is elsewhere — most likely the walk's idle() passing between the walking loop's clicks while
  swipeTo is mid-flight, so the final press meets `busy` in swipeRegenerate (now a toast; the
  walk's until does not read toasts). Next: have the walk wait on the swipe count changing before
  each next click, and read the toast into the failure message. Not the housekeeper's.
  version.js -> m82-001.

---

# M83 — Chat Assistant's whole list, held against the housekeeper at once
- FIELD REPORT: "Chat Assistant has tackled so many problems the writer meets — why are you not
  analysing it?" Fair. Its AGENTS.md invariants (17) and README version laws (v2.76–v2.83, "what
  it can do") were read whole and each held against the tavern, in one pass:
  ALREADY HELD: served whole with COMPLETE stamps (M61); over-cap ids named back; blind-edit
  guard; single staging path; chat-scoped state; anchors are copies, checked at arrival, index
  unquotable, [ANCHOR CHECK] once (M61); dead-card retirement never on anchor equality (M82);
  ONE FACT EVERY SURFACE + ripple on every request (M61/M74); fetch is the block, malformed
  fetch said (M61); withdraw with <supersede>, unmatched labels named (M61); the record whole;
  visible window; shortcuts (M62/63); director/editor; auto-name; reset; typed undo; the ticker
  (M76); think-consumed recovery (M75); auto-supersede in code (M82).
  MISSING, now done:
  1. THE <edits> TEACHING WAS GONE — M79's prompt slice (from "A FACT FOR A CLASS" to "<ledits>")
     took the whole <edits> section with it; since m79-001 the housekeeper had not been taught
     page edits (find/replace, hide, bulk). Restored from M78; M83-1 guards every block's
     teaching so a slice can never do this silently again.
  2. LEDGER UNDO IS NODE-SCOPED AND REFUSAL-FIRST (invariant: "backups and drift fingerprints
     are taken at the edited node, never at the root key"). M74 made the drift CHECK per-slice
     but the RESTORE still put back the whole old state — an undo after a later page wiped that
     page's writes. Now the batch keeps the journal ids the card wrote; the undo takes back
     exactly those through engine/apply.js undoEntry (a later change to the same thing refuses
     the whole undo, nothing touched; the reversals ride the journal so every fold reverses them).
  3. WHOLE-PAGE REWRITE — an edit with replace and no find re-inks the page whole (card shows
     old → new; undo restores).
  4. STALE MARKS IN THE PENDING LIST for every anchor kind (brief, record, rule, page), not
     pages only (anchorIsDead).
  5. THE RIPPLE REACHES THE PEOPLE'S THREADS ("any new surface that stores story facts must be
     added to the scan").
  6. THE STALL WATCHDOG (v2.8x "Reliability"): a wire silent for hkStallSec (default 300; 0 off)
     is cut with a loud word — never a housekeeper held forever; the ticker counts down to it.
  7. THE SESSION THAT ASKED: a reply arriving after the writer moved to another story or session
     is saved where it belongs (housekeeperTurn always did) and NOT drawn into the room the
     writer is in now — a toast says where it went.
  8. Prompt laws: ABSENCE IS A CLAIM YOU MUST EARN (v2.83); a folded-away page is readable by
     fetch, never brought back unasked (v2.81); DELIBERATE EFFICIENTLY (reasoning models).
  STILL NOT PORTED (features, listed at M60): the four-pass deep audit with a call budget and a
  resume cursor; #opt / #cl as full passes (they exist as tools); structure scanning in code
  (scanMessageStructure); pause switches for director/editor injection; end-season residue audit.
- m83.mjs (4 checks). 356/356 + 29/29 (×2). version.js -> m83-001.

---

# M84 — Chat Assistant's code read end to end; the last of its solved problems ported
- FIELD REPORT: "have you analysed EVERYTHING about Chat Assistant?" — the documented list, yes
  (M83); the code line by line, no. Done now: every function of index.js (6,557 lines) walked by
  its index, the regions not yet read read whole — defaults, the send flow, swipes on its bubbles
  (the tavern's M73-002 already matched), settings migration, the memedit rules, the chat-edit
  extras, the message-text rules, the viewers, reconcileHidden, scrubEpisodeMarkers, the ledger
  purge. What the tavern still lacked, ported:
  1. EDITABLE VIEWERS (showViewer's onSave): the directive and the editor's standing notes open
     in the pop-up as text you can change — Save keeps it, saving empty clears it.
  2. A FETCH ROUND SERVES TWELVE pages whole (was four; Chat Assistant's cap is 30 — with the
     record riding whole above, twelve keeps the room), the rest named back.
  3. TWO THINKING RETRIES (thinkRetries 2), the pot doubling each time — was one.
  4. Prompt laws from MESSAGE_TEXT_RULES / CHAT_EDIT_EXTRAS / MEMEDIT_RULES the tavern's prompt
     did not state: HOW A PAGE IS SERVED (COMPLETE means complete; structural claims only from a
     COMPLETE copy; a find/replace removes only what it matched — cut a tail by quoting it or
     re-ink the page whole); ONLY WHAT YOU CAN SEE (never invent the "wrong" words, never fix an
     inferred contradiction; a repair that did not hold means re-read the current text, never
     stack blind snips); LARGE CHANGES are several small edits, one consolidated edit per line;
     THE TALK CONTINUES (discuss, then propose the improved version; no need to resend what
     stands); THE WRITER'S OWN PAGES only when asked by name; blocks named without angle brackets
     in prose; VALID JSON rules.
  NOT PORTED, and why: reconcileHidden / autoRehide (SillyTavern-only — other extensions unhide
  messages there; nothing else touches hidden pages here); the SillyTavern worldbook API shapes
  (the lore shelf is the tavern's own); the deep audit, #opt/#cl passes, structure scanning,
  injection-pause switches, end-season audit (features, M60/M83). Everything Chat Assistant solved
  for the writer's correctness is in the tavern now; that sentence can be held to.
- M84-1. 357/357 + 29/29 (×2). version.js -> m84-001.

---

# M85 — the writer's preset held against the tavern whole (V177 and Freaky Frankenstein 5.4 read end to end)
- FIELD REPORT: "analyze whether the frontend has captured all my preset functions" — both presets
  read block by block (V177: 50 entries, 40k tokens on; FF 5.4: 56 entries) against the craft, the
  assembler, the rulebook, the world agent, the referee, the parser, the renderer. What the M36
  distillation had actually dropped, and what FF adds that is worth having, all landed at once:
  1. THE NSFW LAW WAS NOT SHIPPED. The craft delegated it to the intimate module, whose text was
     still the M2 filler; nothing in the codebase carried Body Veto, Escalation Resets Consent,
     Line-Cross Vertigo, the detail targets, the crude-first lexicon or the resolution floor. Root
     cause was double: the words were never replaced, and `mode.intimate` is set by the extractor
     AFTER a page shows intimacy, so the turn the scene turns (and the first explicit phase) ran
     with no law at all. Fix as V177 has it: the whole NSFW law rides in the craft, always on and
     cached (`## Intimacy`, the old reasoning pass's character-specific break types folded in);
     the `nsfw` builtin is a short reminder at the moment it matters, not a second copy.
  2. THE COMMAND TABLE: `#q` (the director's next scene — preview on the page, bridge, scene, the
     horizon, the Complexity Ratchet), `#time skip X` (also `#timeskip`, `#skip to`), `#story
     concept` (chat.js opens a FRESH tale named from the concept before sending — the old tale's
     ledger untouched), `#Put TWB name` / `#twb name` (one window), `#pp` with Party Gate, the
     proportional delta, the cross-cut and quarantine across the skip, `#continue` with the
     writer's own law (play it forward, no time skip) — all parsed (commands.js), each directive
     naming its law, the laws themselves in the craft (`The Commands`, `Q The Next Scene`, `Party
     Gate`). `#roll`/`#skip`/`# no roll`/`# roll this` are recognized (never "not a house
     command"); the referee honours `# no roll` and `#noroll` as stand-down and `# roll this` as a
     call. "text # note" is chipped as an inline direction.
  3. THE VOICES BLOCK had no home — PULSE/ACW moved into the ledger drawer, Voices was retired with
     them and nothing produced it, while the 🎨 pack still shipped its styles. The world agent
     writes it now (it holds who-knows-what for everyone, the storyteller sees only the present):
     `brief.voices` — 2-4 lines, the preset's own rules (near-always with a social field in reach,
     the trace, the Worth Repeating test, register by proximity, replies as "-> Name", Bystanders
     Act into thread.set); rotation against the last three blocks the pages carried
     (`voicesBefore`). chat.js re-inks the page with `msg.voices` (store passthrough, like the
     masthead) and draws it under the prose in the preset's own text shape ({VOICES} … [VOICE: …])
     dressed by the 🎨 VOICES rules — the fold the writer knows; plain lines with the styles off.
     Never on the wire: renderWorldBrief says nothing for a voices-only brief.
  4. THE PAGE'S MARKS AND THE WINDOW'S FORMAT were absent: no "plain text, no markdown/HTML" law,
     and the craft said WHEN to write a window but never its shape, so the boxed 🎨 style never
     matched. `## The Page`: Marks On The Page; The Window Beyond The Page in the exact form
     (`*** The World Beyond ***`, `[Location — Day, Time]`, 3-8 sentences), Cut Away Quarantine,
     advances-or-does-not-fire; Readable Media (from FF's Pop-in Graphics): phones, letters,
     signs, terminals as objects between GFX marks, where the reading happens; the
     `style-readable-media` display rule unwraps the marks so the thread draws the object through
     richhtml's allowlist (no scripts, links, images — ever); the page keeps the words as canon.
  5. LAWS THE OLD REASONING PASS ALONE HAD CARRIED, restored to the craft: Every MC Action Is An
     Attempt (intercept AND assist; "I'm leaving" completes only if nobody present would stop
     it); No Hovering (they REACH); Peak Trigger; MC Dialogue Is Literal; the dialogue pre-check
     (never another's private observation as one's own); begging and grief at full truth.
  6. FROM FREAKY FRANKENSTEIN, the parts worth taking under V177's laws: Anti Melodrama and the
     therapy-speak ban (Banned Constructs / Dialogue Ratio), the dead phrases (a beat passed,
     nobody has ever, ruin you, don't you dare, jaw working, ozone…), Bodies Feel The Header
     (weather, temperature, hour), and Spectacle Combat as an OPTIONAL manual rule
     (`spectacle-combat`, never wakes unpinned — its "enemies never flee" is rewritten to sit
     under Cornered NPCs and the Symmetry Law). NOT taken, and why: Freaky Mode's always-on
     lewdness (Erotic Momentum Is Not A Filter), BOND/Sparks/Grudge with physical gates (P:R:S on
     revelation is the writer's law), d20 world-event tables and Chekhov roll-firing (no timers —
     The World Advances; Unspent Material is derived from the page on purpose), Hybrid POV (off
     in the writer's own preset; importable as a manual rule), VAD instincts (Dominance Shapes
     Anger + Character Gravity already cover the axis).
- The craft is ~79k chars now (~20k tokens, cached); M36-1's bound moved to 90k. The DOM walk's
  first send ("#story Jovan is eating…") now opens a tale named from the concept — the walk's two
  '#story'-in-the-title lookups follow the new law.
- m85.mjs (8 checks). 365/365 + 29/29. version.js -> m85-001.

# M85-002 — what is situational left the prefix again (the house's own law, held against M85-001)
- FIELD REPORT: "so is this better than the previous version? the whole reason for the tavern
  was to stop feeding a 45k prompt." M85-001 restored three lost things correctly and put two of
  them in the wrong place: the RENDERING half of the NSFW law (the detail targets, the lexicon,
  the acoustics — ~1.1k tokens that matter only when sex is on the page) and the COMMAND laws
  (#q's whole director's law, #pp's, Party Gate — ~1k tokens that matter only on the turn a
  command is typed) rode in the cached prefix on every SFW turn. That is the Reddit thesis
  reversed. Corrected:
  1. `## Intimacy` in the craft keeps the PEOPLE half — pacing, limits, Body Veto, Erotic
     Momentum, Power Dynamic, Escalation Resets Consent, Line-Cross Vertigo, Post Scene
     Continuity — because it governs romance, coercion and the turn the scene turns, and because
     V177's own warning ("a session that learns compliance in bed writes compliance everywhere")
     is a SFW argument. The rendering half is the `nsfw` builtin's text now (the writer's own
     wording). Its trigger lag is fixed at the root: the `intimate` predicate reads the writer's
     typed words for THIS turn (`typedIntimacy`, a local regex of unambiguous words — no call,
     the cheapest classifier there is; the send path slips `turnText` onto the state) so the page
     where the scene turns carries the rule a beat before the extractor's flag lights.
  2. Each command's WHOLE law is its directive (commands.js) — it rides the dynamic tail on the
     turn it is used and never otherwise; the craft says only that a command's law arrives with
     its turn.
  3. The window's exact form and Cut Away Quarantine are the `world-window` builtin (whenKey
     `worldWindow` — the seam M30 left open, filled): it rides when the world agent opened a
     window or the writer asked for one; `#Put TWB` and `#pp` carry the form in their directives.
- The craft is ~70k chars (~17k tokens): the M36 core plus what governs EVERY turn — the people
  half of intimacy, the page's marks, readable media, the restored pass laws, the FF additions.
  Per-turn context is what the tavern was built to hold flat: prefix + brief + who's here + the
  ledger's ~400 tokens of fact + the record + the woken rules + the verbatim window — the same at
  turn 200 as at turn 20. That, not the prefix's size alone, is the answer to "weird after 90k".
- The DOM walk's two load-flakes fixed in the walk, not the app: the swipe-new-old step presses
  again whenever the house is found idle with no new version (a press landing in the M72 replay
  window was the flake); DOM-11 waits for the regex shelf to render before counting it.
- m85.mjs updated (8 checks). 365/365 + 29/29 (×2). version.js -> m85-002.

---

# M86 — the living world, held against the writer's Living World / ACW laws end to end
- FIELD REPORT: "has the living world been properly, smartly adjusted?" Walked whole: the page
  half (Living Scene, Ambient Frame, Crowd In Action, Simultaneity, Event Phases Advance, Scene
  Relocation, The World Reaches In, NPC Creation Authority, Unspent Material, Night Empties The
  World, Hold Is Forbidden When, A Turn Moves The World — all in the craft) and the off-page half
  (the world agent: the absent by the clock with stance and ETA, threads with a next move,
  ripening, who-knows-what, factions on cause, new people, the brief, now the voices). Two places
  where the code did not keep the writer's law, fixed:
  1. THE ABSENT WERE RANKED BY RECENCY. renderOffscreen showed the six most recently WRITTEN
     seats, so a person moving toward the scene could fall off the storyteller's page behind six
     idle ones. The writer's ACW rotation is the law now: toward (due/overdue first, then by
     minutes left) > seeking > tense > busy > waiting; recency breaks ties. The six lines are
     the six who can reach the scene.
  2. THE BUDGET'S KNIFE FELL ON THE LIVING WORLD FIRST. renderStateFacts shed whole sections by
     priority, and Elsewhere (5) / Threads (5) / Factions (6) went before every present guest's
     eye colour (canon 2) and what each guest knows (knowledge 2) — both of which grow with the
     crowd. Now the crowd-scaling sections are TRIMMED to their first eight lines ("and N more
     present, not written here") before anything is shed, and the shed order is factions 5,
     standings/threads 4, elsewhere/bodies 3, canon/knowledge 2. A sixteen-guest ball keeps the
     runner on the stairs and the open threads on the page.
- M86-1 (in m85.mjs). 366/366 + 29/29. version.js -> m86-001.

---

# M87 — the long play: ninety turns of the real app, measured (the house's promise, proven in numbers)
- FIELD REPORT: "I don't want testing — you're the one who tests." tests/dom/longplay.mjs boots the
  real app in jsdom and plays it for ninety turns against a scripted storyteller and scripted
  workers that behave the way good models behave (the storyteller reads the ledger's hour and
  lets time pass from THERE; the extractor reads the header; the world agent seats an arrival on
  the clock once; the keeper folds). Six checks, all green, zero errors across the play:
  1. CONTEXT IS FLAT: tokens per turn — turns 25-45 mean 19,286; turns 60-89 mean 19,913;
     max 20,260. Three percent, not the preset's climb to 130k. The verbatim window is the
     keeper's (the last 30 of 179 pages), the record rides, the older pages rest.
  2. THE CLOCK: every page carries the header; the ledger's hour is the last header's (the
     round trip storyteller → extractor → ledger → storyteller holds every turn); #time skip
     jumped three days; the clock kept every minute across ninety pages.
  3. THE ARRIVAL, WITH NO HAND ON IT: the world agent seated Aurora "toward" with an ETA at
     turn 3; the storyteller was handed "arriving in about…" and did not write her early; she
     came due on the clock, walked in on page 6-8, the extractor seated her present, her
     elsewhere seat cleared itself.
  4. THE VOICES ride under nearly every page, rotate, and never reach the storyteller's wire.
  5. THE WINDOW: opened by the world at turns 10/30/50/70 and by #Put TWB — five windows on the
     pages in the exact form; the window rule woke on the turn a window was open and stood
     down after; #q's whole law rode the tail on its turn only (and not the turn after).
  6. THE INTIMATE RULE wakes on the writer's own words ("…and undress her") a beat before the
     extractor's flag, and stands down on the next quiet turn.
  Ninety turns run in ~50 seconds; run it with the walk before any commit:
  `node tests/dom/longplay.mjs`. The assembled prompts of the #q turn, the last turn and the
  world agent's last read are dumped to /tmp for a human read (never shipped).
- Read as the storyteller reads it, the assembled request was sane end to end; one thing changed:
  THE STARTER FRAME laid a house register over every tale ("slowly and by lamplight", "plain warm
  sentences") ahead of a craft that says "unbiased cinematographer, grounded, concrete, literal".
  It now says only what the storyteller IS and that the brief and the cast set the register; a
  writer's own frame still outranks it.
- 366/366 + 29/29 + 6/6. version.js -> m87-001.

---

# M88 — the house's eye: the page against the craft's mechanical laws, in code, every turn
- FIELD REPORT: "is the audit ledger already the best to audit everything?" The chain, read whole:
  the extractor writes the page's truth; the world agent moves the world; the scribe keeps the
  people; the keeper folds the record and Summaryception's auditor verifies each line; the second
  reader holds the page against canon and mends it; the ledger auditor (every three turns) holds
  the whole ledger against the brief, the pages and the record, with code housekeeping. Every
  reader minded FACTS. Nothing minded the PAGE against the writer's own hard laws — the ones a
  machine can hold exactly and a model slips on most. agents/lint.js is that reader, no call, no
  judgment: Ghost Dialogue (a quoted line tagged to the main character that the writer did not
  type — attribution by speech tag, "typed" by content-word overlap), No Echo (the typed line
  rendered twice), Banned Words (the list; lone modifiers as notes), Marks On The Page (markdown
  headers, bold, backticks, a <think> or tracker block on the page, an action wrapped in
  asterisks, an unbalanced private thought), Header Protocol (no header line), Dialogue Ratio far
  outside the band (note only). High precision over recall: a clean page yields nothing.
- The loop is the preset's own Callout Response, run by the house: findings land on the page
  (msg.findings, kind 'craft', beside the second reader's, both kept); the WARNS of the last page
  ride the storyteller's next turn as "The house's eye" — its own receipt-named slot in the
  dynamic tail, one turn only, recolor forward silently, never lampshade — and the turn after
  carries nothing. Notes never nag. OOC answers are not pages.
- Proven in the long play: a slipped page (words in Jovan's mouth, "breath hitching") carries
  both findings; the next turn's request holds the slip and the law; the turn after does not.
  The long play's mock extractor names the main character from the first page (the real one
  does; with no brief there is no founder) — without a named main character the eye cannot
  convict a ghost line, by design.
- M88-1/2 (m85.mjs), LONG-7. 368/368 + 29/29 + 7/7. version.js -> m88-001.

---

# M89 — the reset also puts the rulebook back as shipped (a fork from an older coat shadowed every law since)
- FIELD REPORT: "is there a reset button for every setting except connections?" There was (M42:
  Settings → "Reset every setting"); it cleared every settings key and put the regex shelf's
  builtins back while keeping the writer's own rules — but it left the RULEBOOK alone, so a fork
  of the craft made under M36 (or a pin on a builtin) would keep shadowing the shipped text
  through M85-M88. Now the reset lifts every fork of a builtin (the craft, the intimate rule, the
  window rule ride as shipped again) and clears pins on builtins; a rule of the writer's own
  stays, pinned as it was — the same law the regex shelf already kept. Connections, worker
  assignments, stories and every ledger stay untouched. The confirm and the note say so.
- DOM-13b extended. 368/368 + 29/29 + 7/7. version.js -> m89-001.

# M89-002 — the ledger auditor by hand, proven in the long play
- FIELD REPORT: "the auditor I press manually — checked and good?" The drawer's "Audit the
  ledger" runs the same reader as the every-three-turns pass (chat.js auditNow → auditLedger).
  LONG-8 now presses it in the real app against a scripted auditor answer with three issues: a
  guest still marked present who left pages ago (presence.leave — lands), a standing Aurora earned
  on the page that the auditor wants zeroed (refused by M48's guard — she keeps it), and a
  brief-vs-pages contradiction with no mutations (reported, fixable:false). The report sits on the
  ledger (state.audit), the workers' line reads "found 3 things, set 1 right: …, 1 only noted,
  1 refused", the button is itself again after. 368/368 + 29/29 + 8/8.

---

# M90 — the brief wins, resolved by the house (Summaryception's source-repair law, ported whole); a mend re-folds its record line
- FIELD REPORT: the writer lives with depression and fights it daily; the house must run a story
  for a very long time with NO hand on it — nothing "reported for the writer to fix". The one
  seam left: the ledger auditor's "a contradiction between the brief and the pages is reported
  with an empty mutations list". Summaryception's latest auditor closed the same seam (its
  `where:'source'` findings drive an autonomous message fixer — the fewest messages, the smallest
  change, player turns untouchable, a backup before every overwrite, the snippet re-derived from
  the corrected passage, then a recheck). The tavern already carried the fixer (M35's mender, with
  take-back chips); what it lacked:
  1. THE LAW. The auditor now reports a brief-vs-pages contradiction with `pages:true` and a one-
     sentence `fix` (the brief's truth, as the page should read), and locks that truth in the
     ledger (canon.lock / people.set / rel.set "the brief says"). The writer's own Canon
     Definition: a page that contradicts the brief was an error, not canon. Only a contradiction
     the brief has with ITSELF is still "only noted".
  2. THE RESOLUTION (chat.js resolveBriefWins, shared by the every-three-turns run and the
     drawer's button): the pages within the auditor's reach (the last ten) are mended by the
     smallest edit through the existing mender; then a [Correction] line joins the record —
     memory.js addCorrection: a node that covers no page (span [-1,-1]), reads LAST ("a correction
     supersedes what came before"), is never folded into a layer and never verified against a
     passage, deduplicated, capped at twelve (the oldest go — the pages have long carried the
     truth by then). So even where no safe edit exists, every later fold and every later turn
     carries the brief's truth, and the storyteller recolors forward.
  3. A MEND RE-FOLDS ITS LINE. applyMend now lets go of the record line covering the mended page
     (memoryWithoutPage), so the keeper folds it again from the corrected words — Summaryception's
     step 4; without it the record kept narrating the contradiction the page no longer contained,
     and the verifier could have "mended" the page back toward it.
- The run words: "found 4 things, set 2 right: …, 1 the brief wins — 1 page mended, the record
  corrected, 1 only noted, 1 refused". LONG-8 now presses the button against a page that named
  the neighbour "Aurora Vance" where the brief says "Aurora Vane": the page is mended by one
  word (its earlier words kept under the chip), the record carries the correction, the ledger
  locks the surname, the report calls it fixed — no hand on any of it.
- M90-1/2 (m85.mjs), LONG-8 extended. 370/370 + 29/29 + 8/8. version.js -> m90-001.

---

# M91 — a branch at the NEWEST page carries the ledger as it stands (the writer's report: "I branched the newest chat and the whole ledger is gone")
- ROOT CAUSE: M70 put the journal fold FIRST for every page — "with a journal, one rule". On a
  store from before the journal (M69/M72) that was played on afterwards, the journal begins
  mid-story and the older snapshots know no `page`; foldJournal found no base, started from
  emptyState, and replayed only the late entries. The M67 rule ("a branch from the last page
  carries the ledger as it stands") sat AFTER the fold and never fired. Branching from the newest
  page of the writer's long-running story therefore produced an almost empty ledger — silently,
  with `exact` reading true (a non-empty journal was taken for a complete one).
- THE LAW NOW (branchFrom): (1) the newest page carries the ledger AS IT STANDS — exact by
  definition once pendingWork has let the readers land, never a re-derivation; (2) an older page
  folds the journal ONLY where the journal reaches it (state.js journalReaches: a snapshot that
  knows its page at or before the target, or a journal that began at page 0 / the founding);
  (3) otherwise the M66 chain as before — the version checkpoint, the next turn's boundary
  snapshot, the nearest earlier snapshot; (4) the last resort folds where the journal reaches,
  and near the tail of a store it does not reach (within the last three storyteller pages and
  past the midpoint) takes the ledger as it stands; an inexact carry is caught up at once (the
  founder, a deep re-reading, an audit) as M66 laid down.
- DOM-8e reproduces the report exactly: a rich ledger, a journal that begins late, snapshots
  stripped of their page — branch at the newest page → every present person, the absent and
  the locked truths come along; branch at page 0 of the same store → the later people do not.
  M43-2 updated to the law. 370/370 + 30/30 + 8/8. version.js -> m91-001.

---

# M92 — the writer's first real audit report, read as two bugs (the mood board owed on every page; a fact is one fact)
- FIELD REPORT (turn 37 of real play): the auditor set right "the mood flags are stale" and
  noted, as not fixable, "the ledger's knowledge for Rias Wells holds the same fact twice".
  Neither is the ledger lagging — the extractor writes the page's truth seconds after it lands
  and the next turn is handed it. They are two gaps:
  1. THE MOOD BOARD. mode.snapshot clears every mood not named, on every page — but only when
     the extractor writes one. A page whose answer forgot it left an older page's flags standing
     ("combat" in a quiet bedroom wakes the wrong rules). Now an answer with no mode.snapshot
     earns ONE sharper ask — the whole board, every other mutation kept — before it is applied
     (the M31 pattern, extended); the board is no longer a suggestion.
  2. A FACT IS ONE FACT. addKnowledge deduplicated only an exact match minus its full stop, so
     "Vanessa’s" and "Vanessa's" were two facts, and the auditor had no knowledge.remove to
     fix it with. sameFact now folds quotes and apostrophes, drops punctuation, and treats a
     fact wholly inside a longer one (24+ characters) as the same fact — the longer stays;
     dedupeKnowledge runs on every load, so a store that gathered duplicates before this law
     is clean the next time it is read, with no mutation and nothing left for an auditor to
     note.
- M92-1/2 (m85.mjs). 372/372 + 30/30 + 8/8. version.js -> m92-001.

# M93 — nothing the auditor sees is left for the writer
- FIELD REPORT: "what is 'Noted, not fixable by the ledger'? I don't want to think about anything."
  The class was already down to one case (a brief that contradicts itself) after M90/M92; now
  that case is settled by the house too: the version the PAGES have established is the story's
  and is locked (cause "the brief says both; the pages settled it"); untouched by the pages, it
  is not an issue at all — the storyteller settles it the first time it comes up. The auditor's
  law says outright that nothing is reported as unfixable. The drawer's line for a finding with
  no change reads "Seen, left as the story has it"; the workers' line, "seen, nothing to change".
- 372/372 + 30/30 + 8/8. version.js -> m93-001.

# M94 — the auditor reads every page (Summaryception's cadence)
- FIELD REPORT: "why not every turn, like Summaryception?" Summaryception's continuity auditor
  runs on every record line it writes — every page, in effect. The tavern's every-third-page
  default was a cost choice from M41, made before the auditor became the house's repair: now
  that it mends pages, corrects the record and locks the brief's truth, a slip should never
  wait two turns. Default cadence is 1 (Settings → the auditor → "Every how many turns"; raise
  it only to spend less). The chain grows by one cheap read per page, still off the send path.
- 372/372 + 30/30 + 8/8 (the long play runs the auditor on all ninety pages). version.js -> m94-001.

---

# M95 — the house's own examples are never people (the writer found Kris Jenner in a story with no Kardashian in it)
- ROOT CAUSE: the workers' prompts taught with concrete names — "Kendall Jenner's mother is Kris
  Jenner; her sisters are Kim, Khloé, Kourtney and Kylie" as the real-record example, and JSON
  vocabularies full of Mira, Mara, Samantha, Liara, Aurora, Dmitri Volkov, Rias, Jovan. A cheap
  non-reasoning model echoes what it is shown; one of them wrote people.set "Kris Jenner" into a
  ledger she had no business in. The writer's own preset law says it plainly: example content is
  NOT canon; names in instruction examples are not characters. The house broke its own law.
- THE FIX, THREE LAYERS: (1) every example name in every worker prompt (extractor, world agent,
  auditor, scribe, founder, rebuilder, housekeeper, second reader) is a placeholder now — NAME,
  OTHER NAME, NEW NAME, NAME SURNAME, MAIN CHARACTER — and the real-record law is taught with no
  real family ("a public figure's mother is her real mother, by her real name"); each vocabulary
  ends with the PLACEHOLDERS law (never write them). (2) The applier refuses any mutation naming
  a placeholder (apply.js placeholderIn) — the lock on the door whatever a model does. (3) The
  auditor's housekeeping sweeps the example family an older coat's prompts could have leaked
  (Kris Jenner, Kendall Jenner, Dmitri Volkov, Aurora Sterling): their seat, standing, locks,
  presence, page and threads are let go — unless the writer's brief or cast notes name them, in
  which case they are the story's and stand. The writer's ledger cleans itself on the next audit.
- M95-1 (m85.mjs) holds every worker prompt to it; m32/m35/m41/m74 updated to the placeholder
  wording; DOM-14b waits for the drift panel to render. 373/373 + 30/30 + 8/8.
  version.js -> m95-001.

---

# M96 — forgotten for good; the passed-through say so; the housekeeper's cards land as they arrive
- FIELD REPORT (in play, the Kris Jenner leak): the housekeeper was asked to remove her; the
  ledger had already retired her (M95's sweep), so the card was declined — correctly — and the
  housekeeper explained the tombstone. But the drawer's passed-through fold showed her row as
  "Kris Jenner — Kendall Jenner's mother; …" with no word saying she had passed through, so the
  writer read a tombstone as a living page. Three things were wrong with that, all fixed:
  1. THE LEDGER HAD NO WAY TO ERASE A PERSON. Retiring is for a real passer-through; a name that
     was never the story's should leave no trace. people.forget (apply.js): the page, the seat,
     the standing, the knowledge, the locks, the presence and any thread they owned are erased
     for good — journaled, undoable whole (people.forgotten). M95's leak sweep forgets now,
     never tombstones; the auditor's and the housekeeper's vocabularies teach forget, with the
     rule that it is only for a name no page, brief or cast note ever held.
  2. THE ROW SAYS WHAT IT IS: "NAME — passed through (was: …)", with "Bring back" and a new
     "Forget for good" beside it.
  3. NOTHING WAITS ON THE WRITER'S HAND: the housekeeper's cards land as they arrive (its sheet:
     "Its cards land as they arrive", on by default, in the reset's keys) — every card keeps its
     Undo and its receipt in the talk; off, they wait for Apply / Apply all as before. ("Apply
     all" appears only with two or more cards waiting — with one card there was nothing to apply
     all of.) A card the ledger refuses stays a card with its refusal shown, as before.
- Not a hallucination: the housekeeper's account was accurate to the ledger it could see; the
  drawer was the surface that misled. What the storyteller is handed never included a retired
  person (renderPeopleTiers skips them) and never included Kris Jenner's page after the sweep.
- M95-1 extended (forget, its take-back, its refusals); DOM-11c holds both housekeeper paths.
  373/373 + 30/30 + 8/8. version.js -> m96-001.

---

# M97 — the scene is the scene: voices in the ledger, one slim toolbar, a copied connection, the housekeeper on the house choice
- FIELD REPORTS, four at once: (1) the Voices Block drawn under the story page broke the scene
  — it now reads in the ledger drawer ("Voices, elsewhere": the latest page's voices in the 🎨
  dress, the two before folded) and never on the page; msg.voices stays the data, chat.js only
  notifies the drawer. (2) "Copy" on a connection card: the same provider, key, base URL and
  dials under "(copy)", opened for its model and name — a key is never typed twice. (3) The
  header is ONE slim row at every width: ☰, the brand, then the three rooms as icons with their
  names as labels and tooltips (the settings icon flips to "Back to the story" while that room
  is open); the brand yields under 380px so the rooms stay in sight. Same ids, same handlers.
  (4) THE HOUSEKEEPER THOUGHT ON A NO-REASONING CREW: M75 had it ride the STORYTELLER's
  connection for the brains, so the crew's connection the writer chose never applied to it, and
  its own thinking dial (set in an earlier session against that design) drove the thinking. It
  follows the house choice now like every worker — its own hands, else the crew's connection,
  else the storyteller's — and its thinking starts from that connection's own switch: the old
  dial is cleared once on boot (migrated:m97), the reset clears it too, and the dial stays in
  Settings for whoever wants the housekeeper to think against its wire.
- findability (M18) and m75 updated to the new laws; LONG-5 reads the voices in the drawer.
  373/373 + 30/30 + 8/8. version.js -> m97-001.

# M98 — the world reaches the scene by phone too; the friend an absent person talks to exists
- FIELD REPORT: "can a character on the ledger move to my MC or call his phone? can it introduce
  new NPCs when ledger NPCs talk to friends?" Moving toward the scene was already the world
  agent's (stance toward, an ETA on the clock; proven in the long play). A CALL, a TEXT or a NOTE
  from an absent person with a live want is now named among the pressures (who, by what channel,
  what they want; the storyteller renders the screen or the voice — readable media); a person
  need not walk to the scene to reach it. And the someone an absent person talks to off the page
  — in a window or a voice — exists from then on: named, cored, seated. M98-1. 374/374.
  version.js -> m98-001.

# M99 — a rewritten brief is held against the ledger at once
- FIELD REPORT: "if I rewrite the brief — a hair colour — what should I do?" Nothing, now: saving
  a changed brief or cast notes in Settings runs the auditor at once (the brief wins: the canon
  is relocked to the new colour, the recent pages mended, the record corrected, the storyteller
  handed the new truth next turn). Unchanged words saved again run nothing. A brief changed by
  the housekeeper's own card is caught by the every-page audit within one turn. DOM-13a.
  374/374 + 31/31. version.js -> m99-001.

---

# M100 — THE RIPPLE: one fact changed by an edit is made true everywhere
- FIELD REPORT: "if the housekeeper edits one of five texts that connect — a name, an age — is
  the rest fixed? I want any edit to be autonomously fixed." It was not: the writer's hand edit
  rippled nowhere, and the housekeeper's [RIPPLE] sweep was a nudge a model could ignore. Now an
  edit is a statement of truth and the house makes the story agree with it (agents/ripple.js,
  chat.js rippleAfterEdit — queued after the page's re-read so it is never rewound away):
  1. factChange(before, after): what one edit changed as {removed, added} — the same word
     changed everywhere on the page ("Liara" five times, possessives too) is ONE fact; a rewrite
     is not a fact and ripples nothing.
  2. A NAME-LIKE change is applied in code with word boundaries ("Kim" never touches "Kimberly",
     "Kim’s" follows): the ledger through people.rename (every key and field — presence, page,
     standing, locks, knowledge, threads, seats, factions; journaled, undoable whole), the
     record's lines, the brief and the cast notes (the writer's own words follow the writer's
     newest word), and every other storyteller page — each as a mend with its take-back.
  3. ANY OTHER FACT (a colour, an age) goes to the mender page by page where the old words
     stand, with the change spelled out; a [Correction] joins the record; the auditor is owed on
     the next page and relocks the canon.
  4. The housekeeper's landed page edits carry their before/after (applyProposal returns
     `edited`) and ripple the same way, on arrival or on Apply.
  The workers' line shows "the ripple" and what it changed. DOM-13c proves both paths through
  the real readers (Liara → Mirela everywhere; black → silver on the other page and in the record).
- M100-1 (m85.mjs). 375/375 + 32/32 + 8/8.

# M101 — the record, readable and mended by hand (Summaryception's snippet browser)
- FIELD REPORT: "where can I see the old messages' summaries?" The drawer's "Our story so far —
  the record": every line, oldest to newest, with the pages it folds, its layer, the detail the
  auditor kept beneath it, and the house's corrections; Rewrite (by hand) and Fold again (the
  keeper re-folds those pages from their words) on every line; Let go on a correction.
  version.js -> m101-001.

# M102 — plainer words on two surfaces
- "Passed through" read as "passed away" to the writer. The fold is "Passers-through — N (not
  dead, not forgotten: no bond, no seat, no thread, thirty turns quiet — out of the storyteller's
  sight until they appear again)". The by-hand form's "Whose page?" placeholder now says what it
  is: "Write on a page by hand — the person's name". version.js -> m102-001.

# M103 — seats have a life, in code (the writer's ACW law: hot threads, not cast)
- FIELD REPORT: "that's an assumption, not a smart solution" — right. A world agent that is
  generous with wants could keep a cab driver seated forever, and the answer had been "the
  auditor will probably clear it". Now it is law in code, every page (auditor.js
  seatHousekeeping): a seat stands only while the story CARRIES the person — named in the brief
  or cast notes; a nonzero standing; owner of an open thread; moving toward or seeking the main
  character; named on one of the last twelve pages; or seated within the last six turns. Nothing
  carries them → the seat is cleared and the page retired at once (they wake if they ever appear
  again). The pool is capped at twelve seats; over it, the least reachable go first (waiting
  before busy before tense before on-the-way), never the brief's people. The world agent's law
  says the same: a passer-through is not seated at all.
- M103-1. 376/376 + 32/32 + 8/8. version.js -> m103-001.

# M104 — every character row says why the house carries them
- The tiering the writer asked about already existed in code (M12: full cards for the present,
  recall cards for the recently named, a rotating roster of the absent, all budgeted; M103:
  who keeps a seat). What was missing was the writer's view of it. carriedBy(state, name) —
  the seat law's own judgment, lifted out — now reads beside every character page in the
  drawer: "Carried by: in the scene / the brief names them / a standing toward the main
  character / an open thread / on the way to the main character / named on a recent page /
  seated just now", or "Nothing carries them yet …". Information only; no model decides a tier.
- M104-1. 377/377 + 32/32 + 8/8. version.js -> m104-001.

---

# M105 — the rooms: settings and the ledger as tabs, a wider shelf, the thinking copied
- FIELD REPORTS, five at once: (1) the story shelf can be dragged wider — a handle on its right
  edge (drag; double-tap puts it back), the width remembered (storyPanelWidth), up to half the
  screen on a desk and nine tenths on a phone; titles and previews ellipsize instead of
  wrapping. (2) "Copy the thinking" under every thinking fold — the storyteller's on the page,
  the housekeeper's in the talk (the live fold too, once the answer lands). (3) Backup already
  held everything (M7: the whole store — stories, pages, ledgers, records, sessions, cast, lore,
  shelves, connections, settings); the words on the button now say so. (4) Settings is six
  ROOMS, one open at a time, a tab strip instead of one long scroll: Storyteller (connections,
  the workers, thinking), This story (brief, cast, frame, note, shelf), The craft (rulebook,
  engine, regex), People & lore (people, lore, old chats), The readers (memory, referee), The
  house (appearance, welcome, backup). Sections keep their ids; a room not open is hidden, not
  moved; the open room is remembered; the composer's deep links open the right room. (5) The
  ledger drawer is four rooms the same way: The scene (clock, ruling, measure, who's here,
  mood), The people (pages, what's true, holding up, on their mind), The world (elsewhere, the
  world beyond, voices), The books (the record, what changed, something drifted, the workers).
- findability's M18 checks follow the rooms law. 376/376 + 32/32 + 8/8. version.js -> m105-001.

---

# M106 — the second empty-ledger branch, and the storyteller's own Voices block
- FIELD REPORT (the writer, 28 hours in): "turn 14 with a ledger, on to 16, branch at 15/14 —
  the ledger from 14 is gone." REPRODUCED in DOM-8f and fixed. ROOT CAUSE: M91's shortcut in
  journalReaches — "an entry at page 0 or -1 means the journal began at the beginning". A
  store from before the journal, touched by an audit or a hand before its next send, journals
  those writes at p:-1 (its page was still -1); the shortcut then took the journal for complete
  and folded a sixteen-page story from NOTHING plus that one line. THE LAW NOW: a fold is exact
  only from a snapshot that knows its page, at or before the branch page; a branch at the
  writer's first message (k = -1) is the founding and nothing else (M71), always right; every
  other case falls to the checkpoint chain (the version checkpoint, the next turn's boundary
  snapshot — the whole ledger of that page — the nearest earlier one), then the last resort.
  DOM-8f mirrors the writer's store (journal begun at p:-1, older snapshots that know no page,
  two turns played on, a branch two pages back) and holds the WHOLE ledger — people, ground,
  clock — not one journaled line.
- THE VOICES BOX ON THE PAGE was not the drawer's: the storyteller wrote a {VOICES} block into
  its prose, taught by old pages that still carried them, and the 🎨 rule dressed it. The
  page rule strips {VOICES} at the door with PULSE/WATCHLIST, and a new wire rule
  (builtin-tracker-blocks-wire) strips all three from every page the storyteller is SENT, so
  nothing teaches it to write them again.
- DOM-11 waited on a shelf count that the 🎨 pack already satisfied; it waits on the store now.
  376/376 + 33/33 + 8/8. version.js -> m106-001.

---

# M107 — the store held against itself (the final sweep's instrument)
- FIELD REQUEST: a final, detailed sweep — every book in agreement, no leaks, no errors.
  tests/dom/consistency.mjs is the instrument: checkStoreConsistency(db, storyId) holds a story's
  every book against every other — the ledger's page never past the story's pages; nobody both
  present and seated elsewhere; no placeholder anywhere; no fact twice; a retired page neither
  present nor seated; the journal never ahead of the page; the record folding only pages that
  stand; every version checkpoint and boundary snapshot keyed to a page that stands; every mend
  keeping its earlier words. It runs after the random walk (DOM-8c), the writer's branch store
  (DOM-8f), the ripple (DOM-13c) and the ninety turns (LONG-1).
- WHAT IT FOUND: version checkpoints for pages that were gone — a retry truncates the tail and a
  delete removes a page, and neither dropped the checkpoints keyed to them (a leak, and a stale
  checkpoint that a branch could never map). forgetCheckpoints(storyId, ids) drops the version
  states and boundary snapshots of every page that leaves, at all three sites.
- Every module passes node --check; no stray console.log in js/. 376/376 + 33/33 + 8/8, the
  consistency invariant included. version.js -> m107-001.

# M108 — the world does not bend (positivity bias, named as a law and watched by the eye)
- FIELD QUESTION: "does the preset fight positivity bias fully?" The craft already carried its
  structural half — earned standings (refusal-first, capped, caused), earned aggression at full
  intensity, Hold Is Forbidden, Static Scene Override, Limits Are Real, NPC goals that persist —
  but never named the bias itself. Now it does: "The World Does Not Bend" (craft.js, beside
  Tone Calibration) — interests diverge by default, a person whose CORE wants otherwise says no,
  a plan the odds are against fails on the page, a mistake costs, an offence is not forgiven
  inside the scene, nobody praises or agrees without a CORE and a beat, and the accord tells
  ("you're right", "I couldn't agree more", the room nodding as one) are banned outright. The
  house's eye lists them (ACCORD_TELLS): one is a note, two warn, and a warn rides the next turn
  as a silent recolor like any other. Standings remain the measure — a standing that never moves
  against the main character is a standing not being written.
- M108-1. 377/377 + 33/33 + 8/8. version.js -> m108-001.

# M109 — the shelf's handle, where a finger can find it
- FIELD REPORT: "I already asked for the stories shelf to be draggable wider — why isn't it
  done?" It shipped in M105 but could not be used: the handle sat INSIDE the shelf, whose own
  overflow clipped it and scrolled it with the list, and on a phone the browser took the touch
  for a scroll. Now the handle is a fixed strip OUTSIDE the shelf, placed from the shelf's
  rectangle whenever that can change (open/close, resize, a new width), 26px wide under a
  finger with a visible grip, touch-action none; drag to widen up to 92% of a phone screen or
  half a desk, double-tap to put it back; the width is remembered and any max-width lifted.
- 377/377 + 33/33 + 8/8. version.js -> m109-001.

# M110 — a writer's page is an attempt until the story renders it
- FIELD REPORT: turn 50 ended on the writer's "I go downstairs", not yet answered; the auditor
  read it as a fact and seated the main character downstairs. The auditor now reads answered
  turns only (answeredOnly: the pages up to the last STORY page) and its law says why: a PLAYER
  page states what the main character attempts; only the STORY page after it makes it so. The
  extractor and the world agent already run per answered turn; the keeper folds only pages
  below the window (always answered).
- M110-1. 378/378. version.js -> m110-001.

# M111 — the hard tokens: a record line that lost a name or a figure is caught in code
- FIELD QUESTION: "does the summary have a solution for a page with a detailed battle strategy
  or political business — Summaryception has a second reader for lost detail." It does, ported
  whole (M12: the detail auditor — NONE or one DETAIL line beneath each record line, verified
  line-by-line against its passage). Now it has a floor no model can drop below: after the
  auditor answers, code lists the passage's HARD TOKENS — every name the ledger knows that the
  pages hold, every capitalized word that recurs, every figure with a unit (forty men, 3am,
  200 gold, 40 minutes; years and bare single digits excluded) — and checks the line and its
  detail for each. Anything missing earns one sharper ask with the list in hand; whatever the
  auditor still leaves out is written beneath the line in code ("also named: …; figures: …").
  The detail's cap rose to 480 characters. Runs on every new line and every merge.
- M111-1. 379/379 + 33/33 + 8/8. version.js -> m111-001.

# M112 — a branch taken while the readers are still on the newest page
- FIELD QUESTION: "if I branch while the workers are still working, is it safe to go back to the
  original?" Yes — the queues are per story: the origin's chain finishes in the origin and
  writes the origin's ledger; the branch got a copy at branch time. The gap was the branch's
  side: pendingWork waits eight seconds and then proceeds, and a branch at the newest page took
  the copied ledger as exact even when the chain had not landed — so that page's reads were
  missing in the branch and nothing re-read them. Now pendingWork's false (still running) marks
  the branch inexact and the branch re-reads its last page itself, a light read (the extractor,
  the world, the scribe, the keeper, an audit), never the deep one; a toast says so.
- M112-1, M43-2 updated. 380/380 + 33/33 + 8/8. version.js -> m112-001.

# M113 — "read again": the readers by hand, for one page
- FIELD QUESTION: "is there a manual button to re-read / restart the workers for this page?"
  There was only the whole-story deep read. Now every storyteller page carries "read again":
  the last page rewinds the ledger to its boundary and runs the chain (what an edit does); an
  older page folds the journal to the page before it, reads the page fresh, and replays every
  later page's writes above it (M72's replay); the page's record line is let go and refolded.
  Off the send path; the workers' line shows what landed. DOM-6c holds both cases and the
  store's consistency after them.
- 380/380 + 34/34 + 8/8. version.js -> m113-001.

# M114 — words the reader can select; a long story opens at its tail at once
- FIELD REPORTS: (1) nothing could be highlighted or copied by long press — on the pages, the
  house's long-press menu raced the native selection and won (a 550ms timer and a contextmenu
  preventDefault), and M105's resize left `user-select: none` on the BODY while a drag ran,
  which a missed touchend could leave stuck over everything, the composer included. Now a long
  press on a page is the reader's (the action row holds copy/edit/branch/read again/delete; the
  menu stays for a mouse's right click), and the resize's no-select covers only the shelf and
  the handle. (2) A 4–6 second start on a long story: every page was dressed (29 rules, a
  sanitizer) before the room showed. Now a story of more than seventy pages draws its last forty
  at once and lands the earlier ones above in chunks of thirty on idle ticks, the reader's place
  held; a newer render cancels the chunks. Small stories and the walk are unchanged.
- 380/380 + 34/34 + 8/8. version.js -> m114-001.

# M115 — the housekeeper's bold and emphasis render
- Its model writes **bold** and *emphasis* and the asterisks stood raw in the bubble. Text
  nodes only: strong and em, nothing else interpreted; the writer's own bubbles untouched.
  (Field question answered alongside: the bubble is the answer with its blocks lifted into
  cards; "What it said, whole" below it is the same reply raw, blocks included, for the eye —
  a fold on the page, never a second copy on the wire; the model is handed each past answer
  once, whole, per M81.) version.js -> m115-001.

# M116 — the window written twice, once under the rule's own heading
- FIELD REPORT: two windows on one page — the dressed *** The World Beyond *** one, then a plain
  copy titled "The Window Beyond the Page" with slightly different lines. The storyteller took
  the window rule's heading (## The Window Beyond The Page) for a page format and wrote the
  window a second time under it. Three fixes: the rule says ONCE and only once and names its own
  heading as never-on-the-page; a page rule (builtin-rule-headings) strips a rule's heading at
  the door; the eye warns when a page holds two windows or the rule's title, and the next turn
  recolors. The M30/M31 shelf counts follow the new builtin.
- M116-1. 381/381 + 34/34 + 8/8. version.js -> m116-001.

# M117 — control tokens leaked into the page
- FIELD REPORT: the model's own control tokens and a tool-call shape (<|open|>tools<|sep|>…
  antmlThinking …<|close|>message) arrived in the content as text after the thinking. That is
  the provider's chat template leaking, not the house — but the house defends: the page ends at
  the first control token (director.js stripControlLeak, CONTROL_TOKEN = <|name|>); a page the
  leak left near-empty is asked again once by the house before anything is saved; a page with
  words before the leak keeps them and a toast names the leak. Prose with < | > in it is not a
  control token.
- M117-1. 382/382 + 34/34 + 8/8. version.js -> m117-001.

# M118 — the housekeeper answered the house, not the writer
- FIELD REPORT: the housekeeper's final reply read "You're right — the writer asked whether a
  line would contradict anything, and my answer was only an assessment, no change requested
  and no change made" — nonsense to the writer. It was answering M75's [NOTHING HAPPENED]
  nudge, which fires when an answer CLAIMS a change and holds no block; CLAIM_WORDS matched bare
  "set", "done", "fixed" — in the story prose the answer quoted ("half-done seating chart"). And
  asksForChange took "previous turn" for the verb "turn", so a question was read as an ask.
  Now a claim is first person ("I changed…"), "now reads/says", "the change is applied", or a
  line beginning "Done"; quoted spans are stripped first. A message ending in "?" asks for a
  check unless a clause of it is an imperative ("why is she there? fix it").
- M118-1 (M75-1 kept). 383/383 + 34/34. version.js -> m118-001.

# M119 — a glitch character is the house's to mend; a loose anchor is verified and re-asked
- FIELD REPORT: a stray Hangul syllable (틀) and a garbled repeat around it sat in an English
  page; the housekeeper's edit landed "on a loose anchor, but sure" — on the wrong words — and
  the corruption survived; the writer had to ask again. Two fixes: (1) the house's eye names a
  stray character from another script (a page nearly all Latin holding one to four Hangul /
  Han / Cyrillic / Arabic / Thai / Hebrew / kana characters) and the chain sends the mender to
  that page at once — remove the stray, mend the phrase, keep a garbled repeat once, change
  nothing else — with the take-back chip; the workers' line says whether anything still stands.
  A page written in another script is not a glitch. (2) A loosely-anchored housekeeper edit is
  VERIFIED after landing: the words it meant to remove must be gone and the words it meant to
  write must stand; a miss marks the card and the house re-asks the housekeeper ONCE — read the
  page as it is, fetch it whole, re-propose with the exact find, or say plainly why the page is
  already right. The writer never checks twice.
- M119-1. 384/384 + 34/34 + 8/8. version.js -> m119-001.

# M120 — the page written inside the thinking
- FIELD REPORT: sometimes the model writes the whole story turn inside its thinking block and
  answers with nothing. That is the model on that provider — but the house defends: a page whose
  body is under 160 characters while the thinking runs past 400 is asked again ONCE, with one
  plain line on the last message (the page is the answer, outside the thinking); if it does it
  again, the house salvages the page-shaped tail of the thinking (from its last header line)
  so the story goes on, and a toast names the cause and the remedy (another model or endpoint).
- M120-1. 385/385 + 34/34 + 8/8. version.js -> m120-001.

# M121 — the page's own proofreader: a slip is mended, a joke is left, a language is a person's
- FIELD REQUEST: an on/off "super autonomous checker and fixer" for the current page — a
  sudden run of Chinese in an English scene mended (a Korean-speaking character left alone), a
  friend's age 17 written 19 and a London sister's "Denmark" mended, but a joke or a deliberate
  lie understood and kept. This IS the second reader (M31), with its switch already in Settings
  → The readers ("Let the second reader mend the page by the smallest edit"), on by default;
  what it lacked was the judgment. Its law now says what is NOT drift — a lie, a joke, a tease,
  sarcasm, a memory gone wrong, an outsider's error, anything the page itself shows as wrong —
  and what is: the narration's facts, and a character stating their own age, home, name or kin
  plainly and wrongly with nothing in the scene to explain it. Words in another language are
  drift only when nobody in the scene would speak them; a babble from a character with no
  reason is a warn with the fix (the words meant, or "remove"). The eye notes a short foreign
  run (5–60 characters in a Latin page) for the reader; one to four is still M119's glitch,
  mended in code-guided fashion at once. The switch's words say all of this.
- M121-1. 386/386 + 34/34 + 8/8. version.js -> m121-001.

# M122 — the house's re-asks say nothing on the page
- FIELD REPORT: "A word from the house: the provider let control tokens through…" stood as a
  red banner on the story page and broke the frame. The automatic re-asks (M117 leak, M120
  page-in-thinking) now leave no node on the page: the pending page is removed and a toast
  ("Asking again.") goes in a breath; the salvage and the kept-words cases are one-line toasts
  too. The behaviour is unchanged; the story page shows only the story.
- 386/386. version.js -> m122-001.

# M123 — the moment is the extractor's; the auditor and the second reader keep to what lasts
- FIELD REPORT (turn 135): the auditor "set right" seventeen things — posture, a knee on the
  vinyl, a sip of milkshake, an absent person's activity this hour, a thread's next small step,
  the "now" line of every page — and the second reader MENDED THE PAGE to match the ledger's
  stale posture ("Rias's arms are uncrossed", "flip-flops kicked off"): the ledger described
  the moment BEFORE the page, and the page, being newer, was right. Both readers now carry the
  law: the scene ledger is the moment before this page; a body the page moves is the story
  moving, never drift and never a finding. The auditor's job is what LASTS and what is WRONG
  (name, age, kin, origin, role; presence long stale; a wound healed still open; a standing
  wrongly zero; a thread closed still hot; a witnessed fact with no line; the clock or ground
  unset; a duplicate) — "a reading with fifteen findings is a reading of the moment, and wrong".
  The second reader's drift is against the locked truths and long-standing facts only.
- The two wrong mends on the writer's pages carry their take-back chips ("Put the earlier words
  back" in Something drifted).
- M123-1. 387/387 + 34/34 + 8/8. version.js -> m123-001.

# M124 — the record's handles were all the same handle
- FIELD REPORT: the housekeeper's record edits kept refusing — "its anchor does not match the
  line" — though the anchor was copied from the line. ROOT CAUSE: record node ids are
  "node-<time36>-<n>", and the handle was the id's FIRST six characters — "node-m" for every
  line. Every record line rendered as "#rnode-m", every card resolved to the first line, and
  the anchor "did not match". Now the handle is the id's tail (six characters, unique per line:
  recordHandle / recordNodeByHandle), rendered the same way everywhere the record appears to
  the housekeeper (the context, the card's label, the ripple's sweep); when a handle is wrong or
  missing, the line that HOLDS the anchor wins. And a record line can be fetched whole by its
  handle (<fetch>["#r7k2p9x"]</fetch>) with its detail beneath — the housekeeper's own words
  said fetch took only page handles; now it takes a record line too.
- The housekeeper's fetch of a PAGE is uncapped and whole (FETCH_PAGE_CAP 0); twelve per round.
- M124-1; M74-6 updated. 388/388 + 34/34 + 8/8. version.js -> m124-001.

# M125 — the housekeeper's Audit reads the record against its pages
- The 🔍 Audit button's ask now names the record (every line of Our story so far) and the
  character pages, and orders Summaryception's verification: hold each record line against the
  pages it folds; when a line looks wrong, thin or unsupported, fetch those pages whole and the
  line itself (#r…) before judging; propose a page edit, a ledger change, or a record line
  rewritten from the pages. version.js -> m125-001.

# M126 — the housekeeper re-read a question as an order
- FIELD REPORT: asked whether a line would be fine, the housekeeper answered "You're right — I
  read the question as 'is this okay?' … Re-reading it as an order …" and reasoned itself into
  nothing. ROOT CAUSE: asksForChange took any declarative sentence not ENDING in "?" as an ask
  (the M75 DECLARES rule), so a message with a question in its middle fired the [NOTHING
  HAPPENED] nudge, which told the model "the writer asked for a change"; the model obeyed the
  house. Now: a question mark anywhere makes the message a question (unless a clause is an
  imperative); a bare declaration is an ask only when it names the brief or contradicts
  something (not / isn't / no longer / instead / actually / should); and the nudge itself says:
  if, reading the writer again, no change was asked, answer the writer as if this note did not
  exist — never mention it, never "you're right", never re-read the writer's words as an order.
- M126-1; M75-3 kept. 389/389 + 34/34. version.js -> m126-001.

# M127 — the readers finish what they started (the app closed mid-chain)
- FIELD QUESTION: "if I accidentally close the tavern while the workers are working, is it
  safe?" Each link's writes are whole or absent (IndexedDB per link), so nothing is half-written
  — but the links after the interrupted one never ran, and nothing resumed them. Now the chain's
  last link (the page's version checkpoint) is the mark of a finished page: on open (boot and
  every openStory), a last storyteller page with no checkpoint is read again from its boundary
  (what "read again" does) — nothing applied twice, a quiet toast. A story made in the last
  minute (a fresh branch, a new tale) settles its own ledger and is never resumed; an exact
  branch's last page owns the carried ledger as its checkpoint. A story from before checkpoints
  earns one read on its first open.
- DOM-6d; M43-2's window widened. 389/389 + 35/35 + 8/8. version.js -> m127-001.

# M128 — the header's ground and hour in code; the auditor's scope in code; a copy button on the drift
- FIELD REPORT (turn 183): the auditor still "set right" the moment (the mood, loose ends, arcs,
  a knowledge line about the latest page), still said "the place is not set", and proposed a
  character page for the main character. Three fixes: (1) the page's header line is read by
  the house — place.set and clock.set ride at the head of the extractor's own writes (same
  stamp, same journal, same take-back), whatever the model remembered; (2) the auditor's scope
  is enforced in code (auditorScope): issues whose mutations are only the moment's — the mood
  board, a posture or wardrobe, a standing seat's activity, a page's state/arc/threads lines, a
  standing thread nudged along, ANY page for the main character — are dropped before anything
  lands, and the moment is stripped out of a real issue; the law also says the main character
  has no page by design; (3) "Copy all of this" on Something drifted, so the writer can carry
  the panel's words out whole.
- M128-1. 390/390 + 35/35 + 8/8. version.js -> m128-001.

# M129 — a window's people are elsewhere; absence is never drift; bold marks leave at the door
- FIELD REPORTS from the storyteller's own thinking and the drift panel: (1) "Here right now"
  listed Chloe Maxwell while the story-state had her "at the Maxwell kitchen" — the extractor
  had seated a person who appeared only inside the page's *** The World Beyond *** window. The
  extractor's law now says a window is elsewhere; and in code, a presence.enter for a name that
  occurs only after the window marker is refused. (2) The second reader mended "my little
  brother" out of a page because "the locked truths never establish that Jovan is her brother"
  — the brief did, and the reader never saw it. It is handed the brief and the cast notes (they
  COUNT AS WRITTEN), and its law says ABSENCE IS NEVER DRIFT: drift needs a written fact that
  disagrees, never a fact the ledger lacks. (3) **bold** in prose is stripped at the door (the
  words stay); the window's triple asterisks are untouched.
- M129-1. 391/391 + 35/35 + 8/8. version.js -> m129-001.

# M130 — one now per person (the scribe's page vs the world agent's seat)
- FIELD REPORT: the character page said Rias was "on the sedan's hood, one hand raised in a
  lazy farewell" and Vanessa "leaning on the hedge, phone in hand"; the elsewhere panel said
  Rias "on the hood … watching the lake path through the hedge" and Vanessa "at the sedan, arms
  crossed on the roof". Two writers owned the same fact — the scribe's "Now" line and the
  world agent's seat — written from different pages at different times, and the writer read a
  contradiction. THE LAW: one now per person. The scribe writes "state" only for people IN the
  scene; for a seated absent person the seat is their now — the scribe's law says so, the code
  drops a state delta for a seated absent person, the drawer shows "Now (elsewhere): <the
  seat>" in place of the older line, and a recall card on the wire carries the seat, never the
  scribe's stale state.
- M130-1. 392/392 + 35/35 + 8/8. version.js -> m130-001.

# M131 — the ownership audit: every fact one writer, every second writer a named guard
- FIELD DEMAND: "check the whole ledger for any stupidity." The last day's bugs were all one
  kind — two writers with a claim on the same fact. The ledger was walked fact by fact:
  the moment (presence position, wardrobe, mood) — the extractor only; the auditor cannot land
  it (M128). The now of an absent person — the world agent's seat; the scribe writes state for
  the present only (M130). The ground and the hour — the header line, in code, and the
  extractor's own place/clock never override it (M131). A window's people — elsewhere (M129).
  Standings — earned on the page; the auditor restores, never lowers (M48). Seats — a life in
  code (M103). The record — the keeper writes; the verifier, the detail auditor, the hard-token
  check, the housekeeper and the ripple edit it in place. Loose ends on a character page that
  repeat a world thread the person owns are shown once, as the thread. An unanswered writer's
  page is an attempt (M110). M131-1 holds all of it as a standing check.
- 393/393 + 35/35 + 8/8. version.js -> m131-001.

# M132 — the imported preset's Voices Block was still riding
- FIELD REPORT: the storyteller's thinking kept planning a {VOICES} block ("near-ALWAYS when
  the social field is in reach … the trace … Worth Repeating") though the craft no longer
  teaches it. The import engine (v176map) still filed the preset's "Voices Block" as a live rule
  waking on socialField, so the writer's imported rulebook handed the storyteller the old ST law
  every social scene, and the house stripped the block at the door each time. Now: the import
  retires "Voices Block" into the engines (the world agent hears the voices, the drawer shows
  them); and the assembler never sends ANY rule that teaches a house block — a module named
  "Voices Block", or one whose text asks for {VOICES}/{PULSE}/{WATCHLIST}/[VOICE: — unless it
  says never (housesBlock). An already-imported rulebook is covered by the assembler's guard
  without re-importing.
- M132-1. 394/394 + 35/35 + 8/8. version.js -> m132-001.

# M133 — the whole preset, block by block: two more of V177's laws were riding against the house
- FIELD DEMAND: "analyze whether the whole preset is the best for the tavern — you made a mistake
  on voices." V177's twenty-four switched-on blocks were held against the import map one by
  one; every one has an explicit home now (none falls to a guess; M132-1 holds it). Two more
  were wrong the way Voices was: "Contested Resolution" rode as a live combat rule — the
  storyteller told to roll its own dice while the referee rolls and rules in the house; and
  "The World Beyond (TWB)" rode as a live worldWindow rule shadowing the house's window rule
  (M36's law: a writer's own rule outranks the builtin) — so the storyteller carried the OLD
  window law without the house's once-only fix, which is the doubled window of M116. Both retire
  into the engines on import; an already-imported copy never rides (housesBlock by name) and
  shadows nothing (the house's rule wakes in its place). What still rides from the preset as the
  writer's own: NSFW Mode (the intimate law, word for word what the house distilled), the manual
  modules (Species Vocalization, Group Chat only, Hybrid POV, Twitter X Feed — off until pinned);
  everything else is the house's craft, the engines, or the readers.
- M132-1 extended; M30-9 updated. 394/394 + 35/35 + 8/8. version.js -> m133-001.

# M134 — pages twenty turns behind; a world that never sleeps
- FIELD REPORT: "the character pages are still from 20 turns ago; it is 23:00 and nobody sleeps,
  worst after #time skip." Two root causes. (1) THE LOOSE ENDS NEVER CLOSED: an `unthread` had
  to match the written loose end EXACTLY, a cheap model never repeats a line verbatim, so no
  loose end ever closed; the list filled (eight), and from then on every NEW loose end was
  dropped as "their loose ends are full" — the pages froze. Now a loose end closes on the sense
  of the words (sameLooseEnd: most content words shared), and a full list evicts the OLDEST,
  never the newest. (2) THE HOUR HAD NO TEETH: "the clock governs availability" was one clause
  in the world agent's law. Now the hour's law is spoken from the clock in code (hourLaw): the
  small hours — everyone without a named reason is asleep at home, seated so, no activity, no
  text, no arrival; early morning and late evening likewise. And a jump of three hours or more
  across a page (a #time skip, a night) tells the world agent THE CLOCK JUMPED: re-seat every
  absent person for the new hour, close what the gap resolved, nothing stands unexamined.
- M134-1. 395/395 + 35/35 + 8/8. version.js -> m134-001.

# M135 — the rebuilt pages survive a retry
- FIELD QUESTION: "if I rebuild and then go back one turn, do the old pages come back?" They
  did: a retry rewinds to the last turn's boundary snapshot, which held the frozen pages. Now
  "Read the pages again" also writes the rebuilt character pages into the LAST turn's boundary
  snapshot and the last page's checkpoint, so a retry, a swipe or a branch at the newest page
  starts from the rebuilt pages. Older boundaries keep their history by design.
- 395/395 + 35/35 + 8/8. version.js -> m135-001.

# M136 — turns on screen (SillyTavern's message count) and the glossary
- FIELD REQUESTS: (1) a long story lags — draw only the latest turns, like SillyTavern. Settings
  → The house → "Turns on screen at once" (30 by default; a turn is the writer's message and
  its page); a quiet button above the drawn pages shows thirty more per press; appends still
  land at the tail; a page above the window is never refreshed into the tail; the setting is
  in the reset. Replaces M114's chunked full render. (2) A glossary for a newcomer: Settings →
  The glossary — the big picture, the top bar, every button under a page, every command, the
  four rooms of the drawer panel by panel, every reader in order, the housekeeper's bar, the six
  settings rooms, and the house's words (page, turn, window, checkpoint, seat, standing, lock,
  mend, passer-through).
- The walk's scenarios that reach for the first page show all pages first and wait for the
  thread to draw. 395/395 + 35/35 + 8/8. version.js -> m136-001.

# M137 — the read cache (the lag)
- FIELD REPORT: "everything has latency — Settings, a new story, all of it; many versions ago
  it was fast." ROOT CAUSE: every action read the same rows from IndexedDB again and again —
  a story's whole page list dozens of times per turn (forty call sites in chat.js alone), the
  ledger's state a dozen more, the record, the workers' lines — and on a phone each read of a
  long story is a hundred milliseconds of deserializing. The house grew readers and panels
  this week and each brought its own reads. Now store.js keeps a read cache: settings rows
  (handed out as clones, so callers may mutate what they get as they always could) and each
  story's page list (shallow row copies); every write to a key or to a story's pages
  invalidates it (append, update, remove, truncation, a chat import, a story's removal, a
  backup restore). The ninety-turn play runs in 52s where it ran in 64s in Node; on a phone
  the difference is the lag itself. DOM-11d waited on a busy flag the faster house cleared
  between two polls; it waits on the result now.
- 395/395 + 35/35 + 8/8. version.js -> m137-001.

# M138 — the screen itself (after the store's cache, the paint)
- FIELD REPORT: still not smooth — closing the shelf, the drawer, settings. Beyond the store's
  reads (M137), the paint: every structural draw ran sixty rise animations at once, and every
  page on the thread took part in every layout (a keyboard, a scroll, a drawer opening re-laid
  out the whole thread). Now only a page that just arrived animates (.msg.fresh), pages off
  screen skip layout and paint (content-visibility: auto with an intrinsic size), the shelf's
  slide is promoted to its own layer, and the drawer and settings are contained for layout and
  paint.
- polish's M15 check follows. 395/395 + 35/35 + 8/8. version.js -> m138-001.

# M139 — M138 broke scrolling; the setting was in the wrong room
- FIELD REPORT: after M138 the screen could not scroll (stuck mid-way); "Turns on screen" was
  not where the glossary said. (1) content-visibility on the pages and contain:paint on the
  drawer and settings clipped their own overflow on Android and broke the thread's scroll math
  — reverted; the fresh-only animation and the shelf's layer stay; the drawer's slide is layered
  too (its shadow repainted each frame of the close). (2) The "Turns on screen" control had been
  inserted after the show-thinking checkbox, which lives in the thinking section (Storyteller
  room), not Appearance; it is in Appearance (The house) now. (3) A misreading, owned: the
  shelf's "114 pages" is the story's total, not what the screen carries.
- 395/395 + 35/35 + 8/8. version.js -> m139-001.

# M140 — THE BOOKS OFF THE MAIN THREAD (the twenty-second open, the lag on every press)
- FIELD REPORT: a twenty-second first open; lag closing settings and the drawer; "SillyTavern
  opens in four". ROOT CAUSE, found: M24's device sync exported the WHOLE store to JSON on the
  main thread — at boot, to compare with the server's file (which it also read whole), and again
  1.5 s after EVERY write (settings.set, append, remove…), which during play means every couple
  of seconds while the readers write. Serializing tens of megabytes on the UI thread, over and
  over: that was the lag everywhere, and it grew with every story. Now: js/sync-worker.js owns
  export and POST in a Worker (store.js is worker-safe); boot compares STAMPS — the server's
  new api/books/stamp (serve.py; an older server falls back to one read) against the browser's
  last push stamp (booksStamp) — never whole files; a boot decision later than three seconds
  finishes in the background and refreshes the shelf; pushes are debounced to a quiet minute
  and forced when the page hides. The app also asks for persistent storage
  (navigator.storage.persist) so a cache clear does not take the store.
- ANSWERS FILED: clearing site data or another browser does NOT keep the browser copy — the
  device file (~/.cozytavern/books.json, via serve.py) does, and Settings → The house → Backup
  exports/imports everything by hand.
- DOM-11b waited on a race the faster house exposed. 395/395 + 35/35 + 8/8.
  version.js -> m140-001.

# M141 — the tavern updates itself; the thread is not painted behind the ledger
- FIELD DEMANDS (the writer's last session): (1) "like SillyTavern — the same in Opera and
  Chrome, and no refreshing to update." The device's books (M24/M140) are the shared shelf:
  with serve.py running, a fresh browser pulls the device file at first open and every browser
  pushes its changes; boot pulls whenever the file is newer. Updates: the tavern now looks for
  a new coat on every open, whenever the page comes back into view, and every ten minutes; the
  new worker takes over on its own and the page reloads itself once — never while the
  storyteller is writing (chat.isBusy). (2) The ledger's first scroll: the thread behind the
  drawer is no longer painted while the drawer is open (visibility, not display — no relayout
  on close).
- The whole session's changes swept: every module passes syntax, every module ships in the
  offline shell (the worker included), no debug leftovers, serve.py parses. 395/395 + 35/35 +
  8/8. version.js -> m141-001.

# M142 — the open room first; the drawer never rebuilt under a finger
- FIELD REPORT: the ledger's first scroll janked while everything else was smooth; a fast
  double tap on Settings or the ledger waited. (1) Settings rendered every section on every
  open before the view could answer a tap — the rulebook's long textareas, the regex shelf, the
  cast, the lore. Now the sections of the OPEN room render at once and the rest follow on idle
  ticks, one per tick; a reset or a restore still re-reads everything at once (onShow all).
  (2) While the readers write, every ledger change re-rendered all sixteen drawer panels —
  under the writer's scrolling finger. A re-render while the drawer is open is throttled to one
  per 1.5s, deferred until the drawer has not scrolled for 600ms, and keeps the scroll position.
- M46-2 follows. 395/395 + 35/35 + 8/8. version.js -> m142-001.

# M143 — nothing is ever unmounted (the open/close stutter, at last)
- FIELD REPORT, exact and right: Settings scrolls smoothly on its first second, but a double
  tap closes it slowly; the ledger's first scroll and its close stutter; "it's just opening a
  menu". THE CAUSE: opening and closing swapped views with display:none — every close of
  Settings threw away its layout and re-laid out the story view (sixty dressed pages); every
  open of the drawer laid out sixteen panels from nothing and every close threw them away;
  and M141's visibility:hidden on the thread behind the drawer forced a full repaint of the
  thread on every close. SillyTavern keeps its panels mounted and only shows/hides them — so
  does the tavern now: the story view stays laid out in flow, Settings is a full overlay under
  the topbar (absolute, its own scroll), the drawer keeps its layout when hidden; a hidden
  surface is invisible and untouchable (visibility + pointer-events), which costs no layout.
  The hidden attribute keeps its meaning for the code and the walk.
- 395/395 + 35/35 + 8/8. version.js -> m143-001.

# M144 — the drawer fills before it shows (why Settings' first scroll was smooth and the ledger's not)
- FIELD REPORT, exact: Settings scrolls smoothly at once; the ledger's first scroll stutters;
  a double tap on either closes slowly; the housekeeper is smooth. The difference: Settings
  draws its open room BEFORE it shows (onShow awaits the room's renders); the drawer showed at
  once while its sixteen panels were still filling asynchronously — rows landing above the
  finger during the slide and the first scroll. Now open() gives the panels a 140ms beat to
  fill, then shows and slides over content already there; a tap during that beat closes (never
  opens twice). With M143 (nothing unmounted) the close costs no layout; the housekeeper was
  always a small dialog that stays mounted, which is why it never lagged.
- 395/395 + 35/35 + 8/8. version.js -> m144-001.

# M145 — measured in a real browser, at last
- The writer asked for it to be sandboxed and tried; it was: a headless Chromium (Playwright)
  on a 120-turn story with 25 characters and a 40-line record, at a phone's viewport and a 6×
  CPU throttle, frame times sampled through every action (tests/perf: /tmp/perf.py in the
  session; open the drawer, first scroll, close, fast open+close, and the same for Settings).
  Findings: at M144 the drawer's first scroll was already 60fps (0 long frames); the one real
  offender was CLOSING SETTINGS — a 250ms frame of pure browser paint (811ms of "(program)"
  in the CPU profile), because the story view was flipped visibility:hidden and back, which
  repainted sixty pages. The story view is never hidden now; Settings simply overlays it
  (aria-hidden marks it for readers). After: close Settings 250→33ms, fast open+close
  267→50ms, drawer open 83→100ms (the panels' store clones — cloneValue 55ms — which is the
  price of correctness and is ~17ms un-throttled), first scroll 17ms, all at 6× throttle.
- An uncloned state row was tried and reverted: normalize shallow-copies, and the applier
  mutates in place — the cache would have been corrupted by an aborted chain.
- 395/395 + 35/35 + 8/8. version.js -> m145-001.

# M146 — the drawer scrolls like the housekeeper (no transform, no will-change, the inner box scrolls)
- FIELD REPORT, the writer's own words: open the ledger and scroll within two seconds — jagged;
  open and close within two seconds — not smooth; the housekeeper is smooth. A headless
  Chromium cannot feel touch scrolling, so this one was read from the CSS: the drawer was ITS
  OWN scroll container while also being a scaling, shadowed, rounded layer promoted with
  will-change — on Android every scroll inside a transforming layer re-rasters the layer, and
  a promoted layer rasterizes the full panel height on open. The housekeeper never
  transformed. Now the drawer fades (opacity only, 140ms), has no will-change, the outer box
  clips, and the inner panels box is the scroller (overflow-y auto, overscroll contained) —
  plain composited scrolling. The drawer's scroll-keeping code already targeted the inner box.
- 395/395 + 35/35 + 8/8. version.js -> m146-001.

# M147 — the cost that grew with the writer's data
- FIELD REPORT: a fresh tavern is smooth in everything; the writer's own — many stories, a
  full ledger, hundreds of pages — is not. Three data-proportional costs: (1) the journal
  cap was 6000 entries — a row of a megabyte or two cloned on EVERY read of the ledger; now
  1500 (~250 turns), and journalReaches requires the journal to cover from the base snapshot
  (else the checkpoint chain); (2) the drawer's sixteen panels each loaded the ledger — sixteen
  clones per open and per re-render; now one shared read per render (a 400ms window), and
  every writer in the drawer (the clock, a seat let go, a page by hand) reads fresh; (3) a boot
  pull of the device's books that took more than three seconds ran in the background and only
  refreshed the shelf — the writer opened a second browser and "the data is not there"; now a
  late pull says so with a toast and reloads the page once when the books are in.
- 395/395 + 35/35 + 8/8. version.js -> m147-001.

# M148 — the drawer draws only the open room
- FIELD REPORT: still stuttering with a full ledger. The last data-proportional cost in the
  drawer: all sixteen panels drew at every open and every re-render — with thirty characters,
  their knowledge, locks, seats and findings, a thousand nodes at once. Now only the open
  room's panels draw; a room not open is pending and draws when its chip is tapped, or on a
  quiet idle pass (one panel per tick, after the drawer has sat still 1.5s and not scrolled for
  0.8s). ctx.drawer.renderAllRooms() draws everything at once for the walk, which reads hidden
  rooms' text. Drawer open under a 6× throttle: 117→33ms longest frame.
- The journal cap (M147) changes NOTHING the storyteller is handed: the journal is the replay
  log behind branches and take-backs, never a slot on the wire; the ledger, the record and the
  pages are untouched.
- 395/395 + 35/35 + 8/8. version.js -> m148-001.

# M149 — the stutter in the scene room only, under four seconds
- FIELD REPORT, precise: the ledger's first scroll stutters only in The scene, only in the
  first three or four seconds; the other rooms are smooth. Diagnosis from the timing: M148's
  idle pass began 1.5s after the open and drew the hidden rooms one panel per tick whenever
  the drawer had not scrolled for 0.8s — the people room's thirty characters landing between
  two flicks of the writer's first scroll. The idle pass is gone: a room draws when its chip is
  tapped, and only then (a room is four panels; the tap costs one frame).
- 395/395 + 35/35 + 8/8. version.js -> m149-001.

# M150 — the drawer shows when the scene room has gone quiet
- The scene room (the clock, the ruling, the standings, who's here, the mood) is the room drawn
  at open; its panels fill asynchronously, and a fixed 140ms beat (M144) was not always the end
  of the fill on a full ledger — a first scroll begun while rows were still landing stuttered,
  there and nowhere else. The drawer now shows when its panels have made no DOM change for
  90ms (a MutationObserver), capped at 700ms; the walk's runtime falls back to the beat.
- 395/395 + 35/35 + 8/8. version.js -> m150-001.

# M151 — the scene room's native controls, folded (the writer's comparison found it)
- FIELD REPORT, decisive: open the drawer on The people (remembered) — smooth; open it on The
  scene — the first scroll stutters; the people room holds more information. What the scene
  room held that the others did not: a dozen native form controls at the top of the drawer —
  the minutes field, five date fields, the calendar select, two more inputs — and native
  controls are what Android rasterizes slowest on a first scroll (the people room holds three).
  The by-hand clock is folded under "Set the clock by hand"; the clock words and +15m/+1h stay.
  The header sets the clock every page; the hand is for the rare correction.
- 395/395 + 35/35 + 8/8. version.js -> m151-001.

# M152 — the final sweep of the session, and the handoff
- Every module passes syntax; every module ships in the offline shell; no debug output; the
  dead idle-pass stub removed. 395/395 + 35/35 + 8/8 (ninety turns in 48s); real-browser frame
  timing at 6× throttle: drawer first scroll 17ms longest frame, close 83ms, settings close
  33ms. HANDOFF.md written for the next session: how to test, the laws that matter, the limits.
- version.js -> m152-001.

# M153 — the blue tap box, and the scene room's last native controls
- FIELD REPORT: a blue box on every press, gone after a second. Android's tap highlight plus the
  house's focus ring, which fired on a tap as well as on a keyboard. Now: tap highlight
  transparent everywhere; buttons, links and summaries never show a ring on a tap (the ring
  stays for keyboard focus on a desk, and on fields); a press is answered by the button's own
  press only. The scene room's remaining by-hand forms (a name walked in, a card invited, the
  place field) fold with the clock's — the room's first paint is text and buttons.
- Final numbers at 6× throttle: drawer first scroll 17ms, fast open+close 33ms, settings close
  33ms. 395/395 + 35/35 + 8/8. version.js -> m153-001.

# M154 — a second browser came up empty (and said nothing)
- FIELD REPORT: Chrome opened beside Opera at the same address: no stories, no word why.
  Two causes: (1) with serve.py not restarted since M140 the stamp endpoint is 404, and the
  fallback read of the whole file had a four-second leash — a big book did not arrive in four
  seconds, the read aborted, boot decided "no server", and an empty browser stayed empty in
  silence; the leash is two minutes now. (2) Nothing told the writer. Now: an empty browser
  that reached no books says so in a toast (start serve.py and refresh), and Settings → The
  house → Backup has "Bring the books from the device" — the whole file read on demand, the
  page reloaded when it is in.
- 395/395 + 35/35 + 8/8. version.js -> m154-001.

# M155 — BOOKS PER STORY, like SillyTavern (and the bug that had made the device deaf)
- FIELD REPORT: a second browser at the same address is empty; "SillyTavern and Marinara
  store on Termux and open the same in any browser." TWO ROOT CAUSES. (1) Since M140 every
  books request from the sync worker had been a 404: a relative fetch inside a worker
  resolves against the WORKER's URL (/js/), so the worker asked /js/api/books — the device
  never received a push and never answered a pull; the "no books reached this browser" toast
  was true and its advice wrong. Endpoints are built from the worker's location now
  (api(path)). (2) The single whole-store blob was the wrong shape: it had to be exported
  entire on every change and could outgrow the server's cap. Now the device keeps ONE FILE
  PER TALE (api/books/one/<storyId>) and one for the house (_house: connections, the stories
  list, the house settings), with a manifest (api/books/list). Boot pulls every book the
  browser lacks or that is newer than its stamp and pushes the tales the device lacks; after
  that only a tale that changed is pushed (twenty seconds after its last write, at once on
  page hide). A pull that took longer than three seconds finishes behind a toast and reloads
  once. store.js: exportStory / exportHouse / importStory / importHouse. "Bring the books from
  the device" pulls every book whole on demand.
- PROVEN in a real Chromium against the real serve.py: browser A wrote a tale and a
  connection; the device held _house and the tale; browser B opened fresh and, with no press,
  held the story, its 41 pages, its ledger, the connection and the active story, thread drawn.
- The old whole-store endpoints (api/books, api/books/stamp) remain for the manual backup.
- 395/395 + 35/35 + 8/8. version.js -> m155-001. serve.py changed: restart it.

# M157 — the launcher relights the lamps; the server relights itself
- FIELD REPORT, with the launcher's own output: `cozytavern` pulled the new coat and printed
  "Fresh coat on" — and left the OLD server holding the port. The launcher only lit a lamp when
  none was lit; a lit one, whatever its age, was left alone, so the writer's second browser kept
  asking an old serve.py for books it could not keep, through three updates, and closing
  Termux did not end the process. Now: serve.py bakes its version at start (BOOT_VER, served at
  /api/version); the launcher compares it to the folder's and, when the coat changed or the
  versions differ, douses the tavern's own lamp and lights a new one; and serve.py watches its
  own file and re-execs itself when it changes, so the NEXT update needs no hand at all.
- 395/395. version.js -> m157-001.

# M158 — the lamps are always relit (the launcher that pulled was the old launcher)
- The writer ran `cozytavern` after M157 and no "Relighting…" line printed: the launcher that
  ran the pull was the OLD copy in $PREFIX/bin — the relight code arrived in the pull it was
  performing and was not in the process that ran. The old server held the port a fourth time.
  Now every run douses this folder's serve.py and lights a fresh one, unconditionally, the way
  Marinara's launcher starts its server fresh on every run. One manual douse is needed this
  once (`pkill -f serve.py`) because the running launcher is still the old one.
- version.js -> m158-001.

# M159 — the closing sweep
- The launcher touches only this folder's serve.py (Cozy Chat's lamp is never doused). Every
  module passes syntax and ships in the shell; serve.py parses; 395/395 + 35/35 + 8/8; the
  two-browser proof against the real serve.py at m158: browser B holds everything browser A
  wrote. HANDOFF.md carries the launcher and worker laws. version.js -> m159-001.

# M160 — the deep audit: the books were never the shell; a tale takes its rows with it
- THE SERVICE WORKER WAS KEEPING THE DEVICE'S BOOKS. sw.js cache-firsted EVERY same-origin GET,
  and api/books/list, api/books/one/<tale> and api/version are same-origin GETs. The first read
  of the manifest was written into the shell cache and answered every later read for the whole
  life of a version: the other browser's newer pages carried stamps this browser never saw, so
  the pull was skipped; and a book served from that cache, handed to importStory, replaces a
  tale's messages wholesale — an older telling over newer pages. M155 fixed the /js/ resolution
  and this was sitting behind it, which is why the second browser still misbehaved and why it
  looked intermittent (a cache write is fire-and-forget; whether a given boot met the kept copy
  was timing). PROVEN in real Chromium against the real serve.py: a page read the manifest,
  the file on disk changed, the second read still reported the first stamp; the cache listing
  held api/books/list and api/books/one/<tale>. Now api/ never reaches the cache branch, and
  activate sweeps any api answers an older coat kept, so a browser heals itself on any version.
- A TALE LET GO CAME BACK FROM THE DEAD. Boot pushed every local story missing from the
  manifest, so a tale deleted in Opera was resurrected by Chrome on its next open — and
  re-uploaded. A drop now leaves a tombstone (<id>.json.gone) that the manifest names; the
  worker lets that tale go here too and never pushes it. A tale pushed again clears its own
  tombstone. Reproduced against m159 every run; green at m160.
- EVERYTHING OF A TALE GOES WITH THE TALE. stories.remove named five prefixes by hand (state,
  memory, lore, workers, snapshots) and missed seven: versionState (up to SIXTY whole ledgers),
  hk, director, editor, memoryBackup, peopleBackup, bookStamp. Those rows outlived every tale
  the writer ever let go — and because exportHouse keeps any row whose suffix is not a LIVING
  tale's id, each orphan was written into _house.json on every push, for the life of the shelf.
  The law is the suffix, not a list (storyKeys). exportHouse refuses tale-shaped rows whose tale
  is gone, and db.sweepOrphans() at boot lets the ones already there go for good.
- THE PUSH WAS READING THE WHOLE SETTINGS STORE. exportStory did settings.getAll() to find the
  handful of rows belonging to one tale — once per changed tale, every twenty seconds, in the
  worker, on a database the room reads the ledger from (IndexedDB serializes transactions per
  database ACROSS THREADS, so this held the room). By key list now. Measured, twelve tales with
  120 snapshots and 60 version ledgers each: 1957.3ms -> 83.8ms per pushed tale, 23.4x.
- NOTHING ASKS THE READER TO TRY AGAIN. A rebuild held `replaying` from the history change until
  the tail job landed — through the readers in flight, a whole reading chain and its retries:
  minutes on a slow wire. Every swipe, edit, retry, branch and delete in that window was refused
  with "one moment, then try again". They wait on a gate (waitForRebuild/afterReplay) and run
  themselves. Against the writer's standing law that nothing may hand him a task.
- A PAGE THE WIRE BROKE IS NEVER SHOWN AS WHOLE. An error frame arriving mid-stream was thrown
  only when nothing had landed yet; with prose already on the page the refusal was dropped, the
  finish reason stayed empty, and a page that stopped mid-sentence was saved, read by every
  worker and folded into the record as the storyteller's finished work. Both providers: the
  words are kept, the page is marked cut short, the break is said out loud.
- THE PEN IS BID FOR, NEVER SEIZED. When the holder released (or went silent), EVERY waiting tab
  promoted itself on the spot — two writers on one store, the exact tear the lock exists to
  prevent. A free pen is bid for; the lowest id takes it; a holder answers a bid at once.
- The thinking clock is stopped on EVERY path out of the stream. It was stopped only on a stop
  by hand, so a provider that fell over — a dropped mobile connection, a 500, a refused key —
  left its one-second interval ticking against a gone node for the rest of the session.
- The masthead switch holds. rerenderMessage and the just-landed page built msgNode without
  mastheadOn, and msgNode defaults to on, so the extractor's masthead write put the header line
  back on every turn: switching it off lasted until the next page landed.
- The row lock is released. modify() stored `prev.then(() => mine)` and compared the map against
  `mine`, so the cleanup could never be true and every row ever modified left an entry behind.
- A book is never absent mid-write. The old order moved the book to .bak1 and then moved .tmp
  into place; in that gap the other browser's GET met a 404 and skipped the tale for the boot.
  The old copy is copied aside; the new one lands in one atomic replace.
- ctx.chat had `isBusy` twice (the only lint error in the house).
- 401/401 harness (+6 new laws) + 35/35 walk + 8/8 play, and an eight-check two-browser proof in
  real Chromium against the real serve.py: /tmp/twobrowsers.py. version.js -> m160-001.
  serve.py changed — it re-execs itself (M157), so no hand is needed.

# M161 — the house is a book too (a regression M160 would have shipped)
- Auditing M160's own sweep: `_house` is a book like a tale's and its bookStamp wears the same
  shape, but it is nobody's TALE — so the living set did not hold it and sweepOrphans ate
  bookStamp:_house on every boot. With no stamp the house book was pulled again on every open,
  and importHouse lays the device's copy over settings this browser had changed but not yet
  pushed (the push waits twenty seconds after the last write). Caught before it shipped to a
  phone; the law is in tests/harness/store.mjs.
- Frame timing re-measured in real Chromium at 6x CPU throttle, a 240-page tale, 60 drawn:
  drawer opens median 18.9ms (worst 35.8), closes 23.8ms (34.2); Settings opens 23.8ms (47.4),
  closes 22.1ms (28.2); first scroll of the thread 9.1ms. 60fps is 16.7ms.
- 402/402 + 35/35 + 8/8 + the eight-check two-browser proof. version.js -> m161-001.

# M162 — the second sweep: the wire, the ages, and the laws that were never running
- THE COVERAGE LAW HAD NEVER ONCE RUN IN THE ROOM. M12 said slot 8 may never let a page fall
  that no record line holds — and windowPlan applies that law only when it is handed the
  record's nodes. The window the send path built never carried them. So after a stumbled
  keeper, a quiet stretch, or a hole punched by an edit, a page rolled past the verbatim window
  before any line covered it and was GONE from the storyteller's sight: not in the pages, not
  in the record. The nodes ride now, and the record's own cut is taken from the plan that will
  actually be sent, so a widened window still never sends a line and the page it summarizes
  together (M44). Both lists are visiblePages, provably the same list, held by a law.
- AND THE LAW NEEDED A CEILING. Switched on as M12 wrote it, a keeper whose worker connection
  is down would put EVERY unfolded page on the wire — on a six-hundred-page tale, the whole
  story, every turn. It reaches back as far as the connection's room allows and no further;
  what will not fit is named on the receipt as pages no line covers, and the keeper refills
  those holes first. The ninety-turn play measures it: 35 of 179 pages, 5 past the window.
- THE WINDOW COULD BE EMPTY. Keeper off, a small context on the connection, and the prefix
  alone ate the whole room: the storyteller was sent the state block and NOT ONE LINE OF THE
  STORY. The last exchange always rides; the receipt names the squeeze.
- THE WORLD AGENT'S BRIEF WAS DROPPED ON EVERY AUDIT TURN. state.turn counts mutation BATCHES —
  the extractor's, the world's, the scribe's, five more when the auditor runs — and the brief
  goes stale after four "turns". Measured: written, survives the scribe, and after ONE audit
  the living world went silent. The brief is stamped with the page it was written for and aged
  in pages; a brief from before the stamp still ages the old way.
- EVERY AGE IN THE HOUSE WAS TOLD IN THE WRONG UNIT, AND PAST THE LOG'S CAP IN NO UNIT AT ALL.
  Same root. Measured over twelve pages: a wound taken on page one was handed to the
  storyteller as "24 turns on" (it is eleven). Worse, the body ledger read its ages off
  state.log.length — a THIRD counter, capped at 200 — so past the cap every age went negative,
  clamped to zero, and a months-old wound read "just now" for the rest of the tale. storyTurn()
  is pages told; every age is stamped and read in it. state.turn keeps its own B14 meaning.
  Now: "11 turns on" at page twelve, "89 turns on" at page ninety.
- The body ledger's name law was broken for strain: addInjury looked the name up
  case-insensitively and addStrain did not, so a ledger holding "Mara" and handed "mara" grew a
  SECOND body — the same person twice, one of them invisible to findBodyKey, findInjury and
  body.heal. apply.js resolved the key first, so the room was spared; the function was lying.
- A bent canon entry threw the whole state block (findCanonKey reads only the keys).
- A PAGE DRESSED TOO DEEP BLANKED THE ROOM. renderHtmlProse's walk recursed with no limit and
  msgNode called it bare — and renderThread calls msgNode in a plain loop, so one page a
  display rule dressed into deep markup threw and the whole thread came up empty. The walk has
  a floor (past it the branch renders as its text) and msgNode falls back to the plain prose.
- 413/413 harness (+11 laws) + 36/36 walk + 8/8 play + the eight-check two-browser proof.
  version.js -> m162-001.

# M163 — the third sweep: every reader of an age, and two silent losses
- EVERY READER OF AN AGE READS PAGES NOW. M162 moved the age STAMPS to pages told and four
  readers were still on state.turn, the write counter, which runs three to five times faster.
  The worst RETIRED PEOPLE: peopleHousekeeping measured thirty against a stamp in pages, so a
  person last written TEN pages ago read as thirty and the auditor let them go — card gone,
  roster line gone. Measured exactly that; now she stands at 10, at 25, at 29, and retires at
  31, which is the law as written. Also carriedBy (the seat pool), the audit report's own turn
  label, the editor's "every N turns" cadence, and the drawer's world panel, which now ages the
  brief by pages exactly as the wire does.
- A RENAME ONTO A NAME THE LEDGER ALREADY HOLDS MERGES THE TWO. rekey wrote `out[to] = v` flat,
  so fixing a name the extractor misheard — the commonest ripple there is — silently threw away
  the REAL person: her page, her standing, her open wound and everything she knew, replaced by
  the typo's thin entry, with only the take-back to notice it by. Measured: core, arc, a p+40
  standing, a split lip and one known fact, all gone in one edit. Merged now, per ledger — the
  standing entry keeps its word, the other speaks where it is silent, loose ends and knowledge
  and locks are unioned, both histories are kept in order, and the scene seats her once.
- A RE-ASK NEVER ERASES THE READING IT WAS IMPROVING. The extractor's sharper second ask (a
  missing mode.snapshot, an empty founding, an unusable answer) replaced whatever came first —
  so a page it had read WELL, and was only asked to add one mood line to, lost its whole
  reading when that second call stumbled on the wire or came back as prose: the ledger got
  nothing for that page. The best of the two stands; with nothing in hand it still throws, so
  the queue retries the page as it always did.
- 416/416 harness (+3 laws) + 36/36 walk + 8/8 play + the two-browser proof. version.js -> m163-001.

# M164 — the live paint, and a seat that overwrote a page
- THE LIVE PAINT NEVER COSTS MORE THAN IT CAN AFFORD. Every animation frame re-dressed the WHOLE
  page — every display rule over the whole text, the scene re-parsed, the whole subtree rebuilt —
  while the cost of one paint grew with the page and the paints kept coming sixty times a second.
  Measured in real Chromium at 6x CPU throttle: 1.6ms at a thousand characters, 16.4ms at twelve
  thousand (one whole frame), and the writer's storyteller is set to a thirty-thousand-token
  longest reply — some hundred and twenty thousand characters, where the tail was painting at a
  few frames a second and the main thread was going into re-drawing words that had not changed.
  The paint keeps a floor of four times what the last one cost, so it can never take more than a
  fifth of the thread. Over a 91,000-character page: 90 paints and 4319ms before, 27 paints and
  777ms after — 5.6x less work, three and a half seconds given back to the stream. A short page
  still paints every frame; the finished page is drawn whole from the store when the stream lands.
  tests/paint.py holds the measurement.
- A SEAT UNDER A NEAR-NAME OVERWROTE THE PAGE IT BELONGED TO. The world agent's "everyone I seat
  has a page" guard compared the seat's name against the ledger's keys EXACTLY, while people.set
  resolves near-names (findPersonKey). So a seat for "Toma" when the ledger holds "Tomas" looked
  unknown, earned a minimal core — "seated by the world agent" — and the applier wrote that stub
  straight over the smith's real core. Proven: a page reading "the smith — slow to anger, quicker
  than he looks" became eight words of housekeeping. The guard asks the applier's own question now.
- 418/418 harness (+2 laws) + 36/36 walk + 8/8 play + the two-browser proof. version.js -> m164-001.

# M165 — the way back, and the keys
- THE PEOPLE-REBUILD'S WAY BACK IS NEVER OVERWRITTEN BY A SECOND ATTEMPT. The backup was taken
  unconditionally, so a writer who ran the rebuild, disliked what it made, and ran it again saved
  THE REBUILD'S OWN OUTPUT over the hand-written world — and "put the people back" then put back
  the very thing they were trying to undo. Proven: forty pages of a written core became "an
  innkeeper", unreachable. A state a rebuild produced carries peopleRebuiltAt and never overwrites
  the standing backup; putting the people back clears the mark, so the next rebuild may save again.
  The mark rides through the ledger's normalizer (held by a law).
- Lore keys compile ONCE. Every scan of every entry rebuilt its key patterns from scratch, every
  turn — a 300-entry shelf with five keys each rebuilt fifteen hundred regexes in the send path,
  where the writer is waiting: 5.6ms -> 4.8ms per turn on a desktop, some six times that on the
  phone. Capped cache; the word-boundary law is unchanged and held by a test.
- Checked and found sound this pass (no change needed): the referee's committed-fate timeline and
  its rewinds, the founder's axis lock, the PNG card chunk walker and its CRC, the chat-export
  reader, the lore matcher's depth and selective-AND rules, prose.js's block and inline tokenizers,
  commands.js's whole table, jsonutil's balanced-object and repair passes, the provider registry
  and the effort ladder, referee-math's mirror symmetry and band rails at P=0 and P=1.
- A LEAK THAT WAS NOT ONE: a static scan flagged Settings' render functions for adding listeners to
  persistent nodes on every open. Measured in the real DOM — four onShow passes, zero listeners
  added. The listeners sit at init scope; the scan's function attribution was wrong. Recorded so
  the next reader does not chase it.
- 420/420 harness (+2 laws) + 36/36 walk + 8/8 play + the two-browser proof. version.js -> m165-001.

# M166 — the magic keys, the housekeeper's own ids, and a fight with no writer on the field
- THE MAGIC KEYS ARE NOT NAMES. Every ledger stores its people under their name as an object key,
  and `next['__proto__'] = entry` on a plain object invokes the prototype setter instead of storing
  anything. A glitch token from a cheap model therefore landed as a page the applier REPORTED as
  written — words in the log, an undo entry, a line in the journal — while the ledger held nothing:
  the log and the world disagreed, and a take-back reached for a key that was never there. Proven
  for __proto__ (silently swallowed) and stored as real keys for constructor and prototype.
  duels.js had hardened its own key writes against exactly this (safeKey) and the ledgers had not.
  Refused now, plainly, at both name doors — engine/apply.js and the scribe's own in engine/people.js.
- THE HOUSEKEEPER'S TAKE-BACK COULD HAVE REVERSED ANOTHER WORKER'S WORK. It found the journal ids
  of its own writes by re-reading the ledger and taking the LAST N log entries — and a worker of
  the background chain that saved in that window put ITS entries at that tail. An applied mutation
  carries its own jid now (engine/apply.js), and the card reads its ids off what it applied.
- A FIGHT WHOSE ALLIES LOST THE PLAYER MARK THREW THE WHOLE TURN AWAY. startBattle and startWar
  prepend the main character's unit, but a fight read back from an older save — or restored from
  one of the referee's own snapshots — may carry allies that never wore isPlayer, and all five
  readers dereferenced the result: `mc.rating` threw out of the referee step, the turn failed and
  the page was never written. One guard (playerUnit) at every site: the first ally stands in and is
  marked; a field with no allies is not a fight and closes cleanly.
- 423/423 harness (+3 laws) + 36/36 walk + 8/8 play + the two-browser proof. version.js -> m166-001.

# M167 — the 🎨 pack follows the coat
- EVERY COLOUR IN THE WRITER'S DISPLAY STYLES WAS A HARD HEX. The scene header renders as a card
  painted #1a1a25 with #e8e8f4 type — near-black with near-white — and the house ships a Daylight
  coat (parchment, #f5efe4) plus "follow the sky", which turns light through an afternoon. So on
  the light coat the header sat in the room as a black box. Measured in real Chromium against both
  coats (tests/coat.py): card-vs-room luminance gap 0.86 before, 0.02 after. All 33 colours of the
  pack are tokens now (--pk-*), 154 sites; each token's LAMPLIGHT value is the pack's own hex, so
  the dark coat is unchanged TO THE PIXEL (card rgb(26,26,37) before and after), and its DAYLIGHT
  value is that colour's parchment equal. The fallback inside every var() is the original hex, so a
  rule the writer edits by hand still paints exactly what it says. A law holds that no colour in
  the pack is ever painted bare again, and that every token it names is defined in BOTH coats.
- 424/424 harness (+1 law) + 36/36 walk + 8/8 play + the two-browser proof + the coat proof.
  version.js -> m167-001.

# M168 — the daylight coat, measured
- THE INK ON THE EMBER DID NOT TURN WITH THE EMBER. B19 darkened the light coat's --ember to
  #8a5205 so it would read as TEXT on parchment, and --on-ember — the ink painted ON that ember —
  stayed near-black in both coats. So in daylight every primary button was dark brown on dark
  orange: "Keep it", "Save", and THE SEND BUTTON THE WRITER PRESSES EVERY SINGLE TURN. Measured
  2.9:1, under AA. And the light coat named --on-ember TWICE, the second shadowing the first, which
  is why the first mend did nothing — a law now holds that each coat names it exactly once.
- A native <option> takes the browser's own ink unless the page says otherwise: black type on the
  lamplight coat's dark field, 4.2:1. Painted by the house now.
- The dots between the meta links were painted --border: 1.3:1, which is not quiet, it is absent —
  a separator nobody can see separates nothing. A muted mix: there, and quiet.
- tests/contrast.py walks every visible text surface in the story room, all five rooms of Settings
  and the ledger, in BOTH coats, and measures each against its own background at AA (4.5:1, or 3:1
  for large text). Before: 2 surfaces under AA on lamplight, 3 on daylight. After: none, in either.
- 425/425 harness (+1 law) + 36/36 walk + 8/8 play + the two-browser proof + the coat proof + the
  contrast audit. version.js -> m168-001.

# M169 — the last of the reading: every control in the house is named
- NINE CONTROLS CARRIED NO NAME. The new-tale name, the new-shelf name, the picture attach, the
  four per-story texts (frame, note, brief, cast), the housekeeper's seed and the welcome's next
  button had neither a <label for> nor an aria-label — a screen reader announced them blank, and
  a voice control had nothing to call them by. Named, all nine. A law now walks every input,
  select, textarea and button in index.html and insists each one is named — by a label that points
  at it, by a label that wraps it, by its own words, or by an aria-label — and that no id in the
  house is used twice.
- Read and found sound this pass (no change needed): assemble/craft.js (the whole craft text, all
  its laws), import/v176map.js (the V176 map, the emoji-tolerant name matching, the five buckets),
  import/sillytavern.js (the preset parser, the prompt_order marriage, decompose, applyPlan's craft
  fork and its numbered-suffix dedupe), ui/drawer.js's clock and who's-here panels, its four-room
  machinery, the pending-panel draw, the quiet-render throttle, and the open/close generation
  guard (a close during the fill beat cannot hide a reopen), ui/housekeeper.js's wiring, its
  pop-up viewer, its turn actions and its drag handler, and index.html's whole structure.
- 426/426 harness (+1 law) + 36/36 walk + 8/8 play + the two-browser proof + the coat proof + the
  contrast audit. version.js -> m169-001.

# M170 — the last door, and a guard that reached too far
- A FACTION IS STORED UNDER ITS NAME TOO, AND ITS DOOR HAD NO GUARD. M166 closed the name doors
  for people — presence, bodies, standings, seats, locks, knowledge, pages — but faction.set took
  capText, which carries no guard. So a faction called "__proto__" was REPORTED as moved ("burned
  the bridge", words in the log, an undo entry, a journal line) while state.factions stored nothing
  at all. Proven. Every door that stores under a name goes through the one name guard now.
- AND THE GUARD WAS REACHING INTO FREE TEXT. body.heal matches a weariness by its WORDS, and it
  matched them through normalizeName — so after M166 a hurt whose words held "constructor" or
  "prototype" could never be healed: a law applied where it does not live. Free text has a tidier
  of its own (tidyWords); names are guarded, words are only tidied.
- Read this pass, in full: engine/apply.js's whole handler table (every mutation the ledger knows,
  its validation, its words and its undo payload), ui/receiptview.js, ui/storyexport.js,
  ui/download.js, agents/status.js, agents/assign.js, agents/voice.js — the last files that had
  never been opened. All sound but the two above.
- 427/427 harness (+1 law, one widened) + 36/36 walk + 8/8 play + the two-browser proof + the coat
  proof + the contrast audit. version.js -> m170-001.

# M171 — the housekeeper's anchor froze the room
- LOCATE()'S FUZZY ANCHOR WAS THE SLOWEST THING IN THE HOUSE. It walked every window of every
  length across the page, rebuilt that window's word array each time, counted the overlap in a
  second inner loop, ran a FULL word-Levenshtein on each survivor — and then did the whole sweep
  AGAIN to find the runner-up. Measured on a desktop: 148ms on a 438-word page, 974ms on a
  6,280-word one. On the writer's phone that is several seconds of a completely frozen room —
  no scroll, no tap — for ONE housekeeper card, and a turn can carry several.
  Now: the page's words are built once, the overlap rolls instead of being recounted, the distance
  abandons by the row as soon as it cannot beat the standing best (nor come within FUZZY_GAP of
  it), no window is sliced into a new array, and one pass finds the best AND its rival.
  974ms -> 243ms on the same worst case; 136ms on a realistic 4,664-word page.
- AND IT ANSWERS EXACTLY AS IT DID. tests/harness/anchor-diff.mjs runs the OLD scan verbatim beside
  the new one over 600 generated cases — perturbed real spans and pure noise, pages of 60 to 460
  words, needles of 6 to 30 — and compares every anchor and every refusal. First run: 41 of 484
  differed, all of them ties broken in a different order (the old scan walked i outer, L inner and
  kept the FIRST window at the highest similarity; a sort does not). The tie-break is explicit now
  — highest similarity, then lowest i, then lowest L — and the candidate list is never truncated,
  so the runner-up is always the one the old sweep would have found. 484 of 484 identical.
- 428/428 harness (+1 law) + 36/36 walk + 8/8 play + the anchor differential + the two-browser
  proof + the coat proof + the contrast audit. version.js -> m171-001.

# M172 — a close belongs to the nearest open
- A REPLY THAT NAMED A BLOCK BEFORE WRITING IT WAS READ TWICE, AND ITS WORDS WERE EATEN.
  innerBlocks paired the FIRST open tag with the next close, then searched on from just inside
  that open. So "I will write an <edits> block for the name. Here it is: <edits>[…]</edits>" was
  read as TWO blocks: the same op landed as two identical cards — applying the second either
  refused or found those words somewhere else on the page and changed them — and the prose open
  swallowed everything through to the real close, so the writer saw "I can do that. I will write
  an" and nothing more of the housekeeper's explanation. The system prompt teaches these tag names
  BY EXAMPLE, so a model echoing one in prose is the common case, not the odd one.
  A stack pairs each close with the nearest unmatched open before it; only the outermost leftover
  open can carry a truncated block (M75-003's law stands); and a bare tag left in the words reads
  as the word it is ("an edits block"), never as machinery.
- 429/429 harness (+1 law) + 36/36 walk + 8/8 play + the anchor differential (484/484 identical)
  + the two-browser proof + the coat proof + the contrast audit. version.js -> m172-001.

# M173 — two doors the housekeeper could walk through by accident
- A BULK RANGE THE HOUSE COULD NOT READ BECAME THE WHOLE STORY. Anything that failed to parse fell
  through to every visible page — so "chapters 12 to 30", or a range cut short at "12–", turned a
  replace meant for nineteen pages into one across all four hundred. And the card read only
  'everywhere "Liara"', which looks identical either way, so approving it told the writer nothing
  about how far it reached. Absent, empty and "all" still mean every page (the model can mean
  that); words that name no range are refused; and the card now says the reach — "“Liara” across
  19 pages".
- A RULE UNNAMED WAS THE FIRST RULE — WHICH IS THE CRAFT. The <redits> prefix fallback ran even
  when the op named NO rule, and every string starts with '', so an op missing its module silently
  targeted whatever stood first in the rulebook: the craft, the one rule the whole house writes by.
  It staged as a pending card reading "rule: The craft", and if the anchor matched, the craft was
  re-inked. An ambiguous prefix took the first match the same way ("NSFW" choosing between "NSFW
  Mode" and "NSFW Mode (2)" without saying it had). BOTH refusals already written in that branch
  were unreachable; they are reachable now.
- A NOTE FOR THE NEXT SESSION: run the jsdom suites ALONE. tests/dom/run.mjs and
  tests/dom/longplay.mjs interfere with each other AND with any other heavy process beside them —
  M203 saw the walk report 13 false failures purely because eslint was chewing through seventy
  files on the same core; run alone, the same commit is 37/37. The walk waits on real timeouts, so
  anything stealing CPU reads as "nothing to click" or "waited too long". Never judge a red walk
  until it has been run on its own.
- 431/431 harness (+2 laws) + 36/36 walk + 8/8 play (each run alone) + the anchor differential +
  the two-browser proof + the coat proof + the contrast audit. version.js -> m173-001.

# M174 — the referee was ruling blind, and the ripple never saw the locked truths
- THE REFEREE HAS BEEN RULING BLIND, ON EVERY CONTESTED MOMENT EVER PLAYED. Its private pageText
  read `msg.pages[msg.page]` — a message shape from another house entirely. A page here carries
  `text` and, when it has versions, swipes; there is no `pages` array and no `page` index, so it
  returned '' for EVERY message and <recent> reached the referee as literally
  "Player: \nStory: \nPlayer: " — three empty labels. It was asked to judge what is genuinely
  being risked this beat with no sight of the beat before it. It uses the house's one reader of a
  page now (assemble/stack.js pageText), so it sees the shown swipe and never a hidden page.
- THE RIPPLE NEVER LOOKED AT THE LOCKED TRUTHS. A canon entry is {facts:[{key,value}]}, so
  Object.values(entry) yielded the facts ARRAY and the string test was false every time — the one
  shelf that holds what is CERTAIN of a person was silently skipped, and a name changed on the
  pages left "origin: born in Ravenwood" standing in the canon with nothing said. The law that
  should have caught this (M61-5) used a FLAT canon fixture, which is exactly how the bug hid: the
  test only exercised a shape the house never writes. The fixture is the real shape now, and the
  scan tolerates both.

# M175 — a pin that killed a rule, and an erasure that never asked
- PINNING A RULE DESTROYED ITS TRIGGER. saveModule wrote the row WHOLE, so any caller passing only
  what it was changing silently cleared the rest — and the rulebook's own pin toggle passes
  {id, name, text, pinned}. Measured: "NSFW Mode" imported with whenKey "intimate" — pin it, and
  whenKey is null and the note is gone; it still rides while pinned, so nothing looks wrong; unpin
  it and AN INTIMATE SCENE NEVER WAKES IT AGAIN, silently, for the rest of the shelf's life. A
  field a caller does not supply is a field KEPT now (undefined means leave it; an explicit value,
  including an empty string, still sets it), and the pin toggle carries the whole rule besides.
- "FORGET FOR GOOD" NEVER ASKED. It erases a person whole — page, seat, standing, knowledge, locks,
  presence — and sat one thumb's width from "Bring back" on a phone, while rebuilding the record
  (which keeps a backup) asks a question. It asks now, and a law holds that every erasure and every
  rewrite-without-a-take-back in the house asks first.
- 435/435 harness (+6 laws across M173-M175) + 36/36 walk + 8/8 play, each run alone + the anchor
  differential (484/484 identical) + the two-browser proof + the coat proof + the contrast audit.
  version.js -> m175-001.

# M176 — the war let the writer fight himself, and two fights in three lost their odds
- THE WRITER IS NEVER ON THE OTHER SIDE — except in a war. duel_start refuses an MC opponent and
  battle_start filters the main character out of BOTH rosters; war_start filtered only its allies.
  A model that listed the writer's own character among the enemy formations (or as the enemy
  commander) had startWar build a unit out of him, and the writer fought himself. The hardening
  this file calls "ported wholesale" had a hole in exactly one of the three.
- THE ODDS THE REFEREE READ WERE THROWN AWAY IN TWO FIGHTS OF THREE. engine/apply.js's
  combat.begin reads `m.scaleMismatch`. The duel path mapped it by hand; the battle and the war
  were SPREAD straight in from the normalizer, which emitted only `scale` — so every party fight
  and every war opened with scaleMismatch undefined, clamped to 0, and was scored on an EVEN FIELD
  however badly outmatched (or overwhelming) the referee had judged the sides. One spelling now,
  for all three, and a law checks that all three read it from the mutation.
- 436/436 harness (+1 law) + 36/36 walk + 8/8 play, each run alone + the anchor differential +
  the two-browser proof + the coat proof + the contrast audit. version.js -> m176-001.

# M177 — the engine keeps the writer off the enemy line, however the fight was written
- combat.begin is a MUTATION like any other, and the housekeeper can write one by hand through
  <ledits>. M176 closed the referee's normalizer; the engines themselves filtered only the ALLY
  roster, so a hand-written battle or war could still build an enemy unit out of the main
  character and set the writer against himself. Both startBattle and startWar filter the enemy
  line now, and a fight whose only enemy was the writer never opens at all.
- Read in full this pass: engine/duels.js's morale and composure shock, the sheet's conditions
  (applyConditionChange, refreshLiveRating, persistFightEstimates), startDuel, startWar's
  formation building, resolveWarRound whole (its outcome-only path, its stratagem effects, the
  auto-pairing of the rest of the line, and the collapse-and-rout arithmetic — war formations do
  carry maxPoise, so the rout check is sound), agents/referee.js's normalizers and prompts,
  agents/housekeeper.js's apply engine and undo batching, and chat.js's branch carry.
- 437/437 harness (+1 law) + 36/36 walk + 8/8 play, each run alone + the anchor differential
  (484/484 identical) + the two-browser proof + the coat proof + the contrast audit.
  version.js -> m177-001.

# M178 — a take-back that reversed the wrong row
- "WHAT CHANGED AND WHY" FOUND ITS ROW BY TIMESTAMP AND WORDS. A batch writes several entries in
  the SAME millisecond, so two identical changes in one turn — "Mara — now by the door", twice —
  matched the FIRST, and the writer's tap on the second reversed the first instead. Proven: three
  rows, same ts, two with identical words; findIndex returned 2 when the writer had tapped 3.
  Every applied entry carries its own journal id (M166), and that is what a row IS; rows written
  before the id still match the old way. A dead `const idx = log.indexOf(entry)` went with it.
- Read in full this pass: ui/drawer.js's who's-here (the invited cast, the greeting offer), the
  mood panel, the log panel, the body ledger's hand form; ui/settings.js's element table, the
  per-story blocks, the rulebook, the regex shelf (its rows, its form, the import, the try, and
  the whole-story clean) — and a mechanical scan of the rest for the five defect classes that
  actually produced bugs this session (empty-needle prefix matches, partial saves that drop
  fields, unit-mismatched counters, unguarded object-key writes, silent first-match fallbacks).
  db.stories.update and db.connections.update are patch-merges, so the partial updates are safe.
- 438/438 harness (+1 law) + 36/36 walk + 8/8 play, each run alone + the anchor differential +
  the two-browser proof + the coat proof + the contrast audit. version.js -> m178-001.

# M179 — the last file, and the last overlay
- THE WELCOME COULD BE HIDDEN OUT FROM UNDER ITSELF. Its close ran a 200ms timer with no
  generation, so a close followed inside that window by a reopen — Settings' own "walk me through
  it again" does exactly that — let the stale timer hide the overlay the moment it was asked for.
  The drawer and the receipt sheet both learned this at B8; the welcome never did. It carries a
  generation now, and opening stales any close still in flight. A law holds all three to it.
- ui/welcome.js was the last file in the repo never opened. Read whole this pass: welcome.js (the
  tour's pure state machine, the once-law, the DOM), the rest of ui/prose.js (inlineMarks' three
  carving passes — code, strong, emphasis — the token renderer, the code block, renderRich; the
  shared `g` regexes are safe because every exec loop runs to null and resets lastIndex).
- EVERY FILE IN THE REPO HAS NOW BEEN READ. What is left unread is prose, not logic: the builtin
  rule TEXTS in assemble/modules.js and assemble/craft.js, and the worker prompt strings in
  agents/director.js, editor.js, founder.js and auditor.js — the words the house says to a model,
  every one of which is exercised by the harness, the walk and the ninety-turn play.
- 439/439 harness (+1 law) + 36/36 walk + 8/8 play, each run alone + the anchor differential
  (484/484 identical) + the two-browser proof + the coat proof + the contrast audit.
  version.js -> m179-001.

# M180 — the three invariants the ledger rests on, fuzzed
- Nothing had ever tested the equality the WHOLE branch/swipe/take-back system rests on. Three
  property tests now do, on random mutation sequences (tests/harness/fold-fuzz.mjs):
  1. A JOURNAL FOLD REPRODUCES THE WORLD THE WRITES MADE. 300 trials, 3-11 pages each, 1-4 batches
     per page, 14 kinds of mutation — every page folded back and held against the world the writes
     actually produced, field by field (present, place, clock, mode, bodies, standings, seats,
     canon, the people, knowledge, threads, factions). ~1,200 folds, zero divergence.
  2. A TAKE-BACK LEAVES THE WORLD EXACTLY AS IT STOOD. 400 trials: build a world, apply one more
     change, take it back, and the world must be byte-identical to before. Zero wrong.
  3. A STORY LONG ENOUGH TO ROLL THE JOURNAL NEVER FOLDS FROM NOTHING. 600 pages at four writes
     each, well past JOURNAL_CAP: journalReaches refuses the pages past its reach (never a silent
     fold from an empty base — the writer's own M91 report), and every page it DOES claim to reach
     folds true.
- 442/442 harness (+3 property tests). version.js -> m180-001.

# M181 — the twenty-second window is closed
- PROSE GOES TO THE DEVICE AT ONCE. Every write shared one twenty-second debounce, so a page the
  writer had just read sat only in the browser for twenty seconds. A browser cleared in that
  window — or a phone that reaps the tab before visibilitychange fires — took those words with it.
  A ledger can be rebuilt from the pages; the pages cannot be rebuilt from anything. A MESSAGE
  write now pushes at once; settings and ledger churn (three to five writes a turn from the
  workers) keep the debounce, because pushing on each would rewrite the whole book five times a
  turn for something the readers can make again.
- AND A PUSH ASKED FOR WHILE ONE RUNS IS NOT A PUSH REFUSED. Making prose eager exposed an older
  bug at once: pushNow returned immediately when a push was in flight, so anything marked during
  it fell to a FRESH twenty-second timer — and "push everything now" (Settings' button, and the
  page-hide hook) landing mid-flight silently pushed NOTHING. Measured the moment prose went
  eager: two tales written, a push asked for, and one tale, the connection and the house settings
  were left on the floor. Pushes serialize and DRAIN now — the runner keeps going while anything
  is dirty, so a mark made during a push rides the same drain, and every caller awaits a promise
  that is only done when the shelf is clean. This bug was there before M181; the eager push is
  what made it fire.
- tests/wipe.py now writes a page and clears the browser IN THE SAME BREATH — no pushAll, no
  waiting out a debounce, no switching away. 13 of 13 pages came back.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + the wipe test + the two-browser proof.
  version.js -> m181-001.

# M182 — the books announce themselves: live, across every browser
- THE "IN TURN" IS GONE. A browser used to learn of another browser's pages only when it next
  opened. serve.py holds the one copy every browser shares, so it is the only thing that can say
  "this book just changed" — it does, over Server-Sent Events on /api/events. A listener holds one
  long GET; ThreadingMixIn gives each its own thread and there are only ever a handful of
  browsers. A change names the client that made it; a browser skips its own, because pulling back
  your own write would put your newer pages under what you had just sent — a loss, not a refresh.
  On someone else's change the browser pulls THAT book alone (the stamp still decides, so an echo
  or a repeat costs nothing) and refreshes in place: the shelf, and the thread when it is the open
  tale. No polling, no reload, no waiting for the next open. A dropped tale is announced too, so
  it goes in the other browser live. A browser with no EventSource, or a stream that will not
  open, falls back to exactly the boot-time pull it had before.
- AND A BUG THE CHANGE UNCOVERED IN THE SAME BREATH: serve.py had `import json` INSIDE do_POST as
  well as at the top. Removing one of them made `json` a local name for that whole function, so
  the line above it raised UnboundLocalError and every book POST died before a byte was written —
  the two-browser proof went from all-green to "no books directory at all" in one run. All three
  function-local imports are gone; json is imported once, at the top.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + the wipe test + the two-browser proof,
  which now also holds the live law: a page written in A reaches B with no reload, B loses nothing
  doing it, and A keeps its own page. version.js -> m182-001.

# M183 — a page is appended, not a book rewritten
- M181 sent prose to the device the moment it landed, and "a page landed" meant serializing the
  WHOLE tale and writing it again: 14.6ms at four hundred pages on a desktop, growing with every
  page the writer adds, on every single turn. The page itself is a few kilobytes; the ledger, the
  snapshots and the sixty version states are what make a book heavy — and those can wait for the
  twenty-second whole-book push, because the readers can rebuild them and the prose cannot be
  rebuilt from anything. A page goes to <id>.log on its own now: one line, fsynced.
  MEASURED: 14.55ms -> 1.09ms, 13x cheaper, and CONSTANT whatever the tale's length.
  A read folds the log into the snapshot (pages merge by id, last wins, so an appended edit
  replaces the page it edits); a whole-book push folds it in and clears the log; a dropped tale
  takes its log with it; a torn last line — a phone killed mid-append — is skipped and the rest
  still read; and a page for a tale the device has no snapshot of is REFUSED with {whole:true}, so
  the browser sends the whole book rather than orphan a page in a log with nothing under it.
- AND THE MANIFEST HAD TO LEARN ABOUT IT. The first try read the log's last 4096 bytes and regexed
  for its "at" field — with six-kilobyte pages that lands in the middle of a line and finds
  nothing, so the manifest kept reporting the SNAPSHOT's old stamp and no other browser would ever
  have learned the tale had changed. Measured exactly that. Both the manifest and the merged book
  take the stamp from the log's MTIME now, so they cannot disagree.
- tests/append.py holds all of it, timings included.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + the wipe test + the two-browser proof
  (live law included) + the append test. version.js -> m183-001.

# M184 — a whole book never sweeps away another browser's page
- THE APPEND LOG MADE A RACE, AND IT LOST A PAGE. A whole-book push clears the log, because the
  snapshot is meant to contain it — but the pushing browser's copy holds only what IT knew, and a
  page another browser appended seconds earlier, which had not yet reached it, lived in that log
  and nowhere else. Proven the moment it was looked for: Opera and Chrome each append a page, the
  device holds both, Opera's twenty-second whole-book push lands, and Chrome's page is simply
  gone. Anything in the log the incoming book does not already hold is folded into it BEFORE the
  write; only then is the log cleared. Held by a law in tests/append.py, including that a page the
  book already held is never doubled.
- This is the risk the whole append design carries, and it is why the log must never be treated as
  disposable: it is the only copy of anything that has not reached a snapshot yet.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + the wipe test + the two-browser proof
  + the append test. version.js -> m184-001.

# M185 — a page the writer let go must stay gone
- M184's fold saved another browser's page — AND RESURRECTED EVERY PAGE THE WRITER DELETED.
  "Let this page go", then the twenty-second whole-book push, and the page came straight back out
  of the log. Proven the first time it was looked for. This is the exact cost of the append design
  and it was shipped in M183/M184 without being looked for; it was found only by auditing the new
  code deliberately.
- A TIMESTAMP CANNOT TELL THE TWO APART. A browser can export a book AFTER a page it has not yet
  received, so "the line is newer than the book" marks a deletion and a race alike. The LOG LINE
  can tell them apart, because it records which browser appended it:
    a line THIS browser wrote, absent from THIS browser's own book -> it deleted the page; it stays deleted
    a line ANOTHER browser wrote, absent from this book            -> it never had it; fold it in
  The page endpoint stamps every line with its client; the whole-book push passes its own.
- Both laws are held together in tests/append.py: a page let go stays gone, and in the same breath
  another browser's page still survives the push that let it go.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + the wipe test + the two-browser proof
  + the append test. version.js -> m185-001.

# M186 — the final audit of the new system: three holes, closed
- A LIVE PULL COULD TAKE A PAGE OUT FROM UNDER THE WRITER MID-SENTENCE. liveRefresh re-renders the
  thread, and a structural render rebuilds it FROM THE STORE — but the streaming page is a DOM
  node that exists nowhere else until it lands. Another browser writing a page while this one was
  generating would have wiped the page being written. The pull still happens at once (the words
  reach the device either way); only the redraw waits for the turn to finish.
- TWO BROWSERS APPENDING IN THE SAME INSTANT COULD RUIN BOTH LINES. A page line is several
  kilobytes — far past the size a single write() is atomic for — so interleaved appends corrupt
  each other and lose both pages. One lock, and it is `with` and not acquire/release, because an
  os error anywhere in the whole-book stretch would otherwise leave it held and DEADLOCK every
  later write. Held by a law: forty pages from two browsers at once, all forty whole.
- AND THE LOG WAS NOT ALLOWED TO GROW FOREVER. It is cleared by the twenty-second whole-book push
  — but a push that never lands (the browser closed, a stumble) leaves it growing, and every read
  of that book parses all of it. Past 2 MB it is folded into the snapshot on the spot, which is
  exactly what the push would have done. Held by a law, with every page surviving the fold.
- The fold, the write and the clear of a whole-book push are one held stretch, so no append can
  land between reading the log and removing it — a page that landed in that gap would have been
  in neither the snapshot nor the log.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + the wipe test + the two-browser proof
  + the append test (now eleven laws). version.js -> m186-001.

# M187 — a tombstone is a marker, not the whole book
- LETTING A TALE GO FREED NOTHING. The drop renamed <id>.json to <id>.json.gone, so the entire
  book stayed on the device forever. Measured on a shelf the size of the writer's: a 160-page tale
  let go left 0.6 MB sitting there and the shelf's total did not move at all. The manifest only
  ever reads the tombstone's NAME. The book, its .bak1 safety copy and its log all go now; an
  empty file keeps the name, so the other browser is still told the tale was let go.
  Measured after: 1.54 MB -> 0.00 MB, and the other browser still learns of it.
- FOR THE RECORD, WHAT A SHELF COSTS. 633 pages across six tales with full ledgers, snapshots and
  sixty version states each: 2.4 MB of books on the device, plus 2.4 MB of .bak1 safety copies.
  Each BROWSER keeps its own IndexedDB cache of the same shelf, so two browsers means one more
  copy — the whole thing lands around ten megabytes, which is two photographs.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + the wipe test + the two-browser proof
  + the append test (fourteen laws). version.js -> m187-001.

# M188 — an empty tale never overwrites a full one
- THE ONE WAY A WRITER'S PAGES COULD BE DESTROYED IN A SECOND. A browser holding a story ROW with
  no pages ever fetched under it pushes that story, and the device's copy — every page of it — is
  replaced by nothing. It can happen today from a half-finished pull, a failed import, or a story
  row that arrived without its book, and it is the exact hazard that lazy-loading tales would
  make routine. A push whose book has no pages, against a device book that HAS pages, is refused;
  the browser's stamp is dropped and the tale is pulled back instead, so the browser is corrected
  by the device rather than the other way round. If the device cannot be asked, the push is
  refused — when it cannot be told, it keeps the pages.
- WHAT IS NOT BLOCKED, and must not be: a genuinely new tale with no pages yet (there is no book
  on the device to empty), and a writer deleting pages one at a time or rewriting from a page
  (each of those pushes still carries pages, and each is the writer's own doing). The first
  version of the test got this wrong — it deleted forty pages one by one and expected the guard to
  stop it. That is the writer deleting their own pages and it stays allowed; the guard is for the
  browser that never had them.
- tests/guard.py holds it, against the real serve.py in a real browser.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + wipe + two-browser + append + guard.
  version.js -> m188-001.

# M189 — a browser holds the tales it is read in, not a copy of everything
- OPENING A BROWSER COPIED THE WHOLE SHELF INTO IT. Boot pulled every book, so a second browser
  opened once held a full duplicate of every tale — at ten thousand tales, gigabytes per browser,
  and a browser is not where a story lives. THE HOUSE BOOK ALREADY CARRIED THE SHELF and it was
  being thrown away: exportHouse has always written the story list (id, title, when it was made,
  which shelf it sits on), and importHouse even named the `stories` store in its transaction
  scope, but never wrote a single row to it. That is why every browser had to fetch every book
  just to learn what was on the shelf.
- Now: boot pulls the HOUSE book (a few kilobytes) plus any tale this browser already holds, so
  nothing it has goes stale. A tale from the house list is marked `shallow` — the shelf knows it,
  the pages are not here. openStory fetches those pages the first time the reader opens the tale,
  and the mark is cleared. M188's guard is what makes this safe: a shallow tale can never push
  over the device's copy, so a story row with no pages under it cannot empty a book.
- tests/guard.py holds the whole shape: a second browser knows the whole shelf, holds NO pages for
  a tale it has not opened, fetches them on opening, and the device still holds its forty pages.
  tests/wipe.py now opens each tale after the wipe, as a reader would, and finds every page.
- AND A MISTAKE MADE ALONG THE WAY, for the record: the planting block first landed in
  importStory, where it does not belong, referencing a variable that does not exist there. Lint
  caught it. Two functions in this file build a transaction the same way; a patch matched the
  wrong one.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + wipe + two-browser + append + guard.
  version.js -> m189-001.

# M190 — the audit of M180-M189: what the new sync did to a tale you had not opened
- A TALE'S BOOK UNDID WHAT THE SHELF KNEW. importStory wrote `data.story` over the local row
  wholesale. A tale whose pages are not here yet cannot be pushed (M188 refuses an empty book), so
  a rename of such a tale lived only in the house book — and the moment that tale's own book was
  fetched, the book's OLD title was written back over it. Renaming a tale you had not opened
  simply undid itself. The newer row wins now: if this browser's row was touched more recently
  than the book was exported, its title and shelf stand. Fetching a tale also clears its `shallow`
  mark, which is the truth of it — the pages are here.
- AND THE HEAL LANDED WHERE THE ROOM COULD NOT SEE IT. When M188 refuses a push it pulls the
  device's copy back — from the sync WORKER, into the store, while the main thread went on holding
  its own cached (empty) page list for that tale. The reader was left looking at a tale with no
  pages at all, with every page sitting safe on the device, until the next reload. The worker says
  `healed` now and the room drops its caches and redraws (waiting, as ever, for a turn in flight).
- Measured through the whole chain: B sees the tale unfetched, renames it, pushes, is refused,
  is healed — and ends with the rename kept, all forty pages in the room, and the device holding
  forty throughout. Three laws in tests/guard.py.
- 442/442 harness + 36/36 walk + 8/8 play, each run alone + wipe + two-browser + append + guard
  (thirteen laws). version.js -> m190-001.

# M191 — a correction is not a new rename
- THE STORY COULD FLIP BETWEEN TWO NAMES AND NEVER SETTLE. The ripple makes one changed fact true
  EVERYWHERE — right when a name was simply wrong, and wrong when the writer is walking back a
  rename that went too far. The writer's own case: a coach named Alex, and Alexia who says "don't
  call me Alex". Rename the coach to Wood and the sweep takes her line with it. Fix that one line
  by hand and the ripple read a name change Wood→Alex and renamed THE COACH BACK — all-Alex again.
  Correct it once more and it flips to all-Wood. There was no way out by hand.
- THE JOURNAL TELLS THE TWO APART. If it already holds a people.rename from `added` to `removed`,
  the writer is walking that rename back, not making a new one: the change holds on the page they
  edited and goes no further, and the room says so plainly. A genuinely new rename, or an
  unrelated one, sweeps as it always did.
- Proven both ways in tests/harness/m100.mjs: the correction really does read as a name change
  (that is the trap), the journal distinguishes a walk-back from a new rename and from an
  unrelated one, and the send path consults it BEFORE it touches the ledger.
- 443/443 harness + 36/36 walk + 8/8 play, each run alone + wipe + guard + two-browser + append.
  version.js -> m191-001.

# M192 — the record's detail line: three faults in one line
- From the writer's own record: "Detail worth keeping: Jovan is sixteen, not seventeen; … ; Jovan
  is sixteen, not seventeen; … ; also named: Mariner's, Lane, Wells, England, Vanessa's, I'm,
  Entryway, I'v…"
- A CONTRACTION IS NOT A PERSON. hardTokens took any capitalised word of three characters that
  repeats, so "I'm" and "I'v" (out of "I've") were filed as NAMES and "Vanessa's" as a second
  person beside Vanessa. That nonsense then rides to the storyteller every turn, and every false
  name ALSO costs a second call to the keeper asking where it went. A possessive folds onto the
  name it belongs to; a contraction is not a name at all.
- THE SAME CLAUSES, TWICE. The sharper second ask was appended whole unless the first detail
  contained it exactly — so an answer differing only by a full stop was written again in full.
  Merged clause by clause now (mergeDetail), matching once case, spacing and end punctuation are
  set aside. This is what ate the 480-character room in the writer's line.
- AND THE CUT LANDED MID-WORD. "I'v…" is a fragment of nothing. The cut looks for a clause
  boundary and takes that instead.
- NOT A FAULT, and left as it is: the line saying "seventeen" while the detail says "sixteen, not
  seventeen" is the auditor doing its work — the keeper's line was wrong and the audit caught it,
  so the correction rides with the line and the storyteller reads both. Rewriting the line itself
  would risk losing everything else in it. With the duplication gone the correction is short and
  reads plainly.
- 444/444 harness + 36/36 walk + 8/8 play. version.js -> m192-001.

# M193 — the other mid-word cut
- The same chop that gave the writer "I'v…" lives in parseAuditAnswer too, on the model's own
  answer at 240 characters, before anything is merged. It cuts at a word now, and drops a dangling
  comma or semicolon before the ellipsis.
- FOR THE RECORD, the room the record actually has: a summary LINE may run to 4000 characters —
  battle strategy, who moved which way, who owes whom, a whole political turn all belong THERE.
  The detail is not a second summary; it is the auditor's correction of that line, and 240
  characters (480 once a sharper second ask is merged in) is right for a correction. If a line is
  missing something big, the answer is to rebuild the record, not to grow the detail.
- 444/444 harness + 36/36 walk + 8/8 play. version.js -> m193-001.

# M194 — the keeper never checked a figure
- The writer's line said Jovan is SEVENTEEN where the page said "Sixteen". The keeper closes with
  nine checks — pronouns, actors, phrase count, stats, paradoxes, OOC canon, temporal prefix — and
  not one of them looks at a FIGURE, which is the single kind of mistake a reader notices at once
  and the storyteller then repeats for the rest of the tale. A tenth check: every age, count,
  height, distance, time, price and score must read as the passage states it, in the passage's own
  form (Sixteen stays sixteen; five-foot-eight is not rounded), and a figure that cannot be
  pointed to in <passage> does not belong in the line at all.
- WHERE THINGS BELONG, since the writer asked: strategy and politics go in the LINE — rule 4 asks
  for the problem, the proposed solution and who proposed it, and rule 3 for titles, counts and
  tactical detail. The line has 4000 characters. "Detail worth keeping" is the AUDITOR'S
  correction of that line, not a second summary, and 240 characters is right for a correction.
  A line missing something big is rebuilt, not annotated.
- 445/445 harness + 36/36 walk + 8/8 play. version.js -> m194-001.

# M195 — a wrong fact is not a detail worth keeping
- THE AUDIT WAS ASKED ONLY ONE QUESTION: "does the line omit anything important". So a model that
  noticed the line said SEVENTEEN where the pages said Sixteen had nowhere to put that but the
  addendum, and the writer's record read "Jovan is seventeen … Detail worth keeping: Jovan is
  sixteen, not seventeen". The storyteller was handed both and the WRITER had to referee his own
  record. The writer named the fault exactly: "detail worth keeping" means what the line never
  said — it is Summaryception's 📝 line, a second summary for what would otherwise be lost (a
  battle strategy, a political turn) — and a wrong fact is not that.
- TWO JOBS, TWO OUTPUTS NOW. The audit returns FIX lines (the line's own words -> the words that
  belong there) and at most one DETAIL line (only what was MISSING). A fix is applied only when it
  is provably safe: the wrong words really are in the line AND the right words really are in the
  pages. Anything else is the model rewriting the record, which it may not do. The mended line is
  what gets saved; the detail beneath it carries only additions.
- So the record now reads as the writer expected: the LINE says sixteen, and the detail says what
  the line left out.
- 446/446 harness + 36/36 walk + 8/8 play. version.js -> m195-001.

# M196 — a line too poor to annotate is rewritten by the house
- THE ADDENDUM'S CAP WAS A DEAD END, AND THE ONLY WAY OUT WAS THE WRITER'S HAND. The detail is an
  addendum; 480 characters is right for what a line left out. But when the audit found MORE than
  that missing, the cut threw away exactly the continuity the record exists to hold — and the only
  answer on offer was to tell the writer to rebuild the record himself, which is babysitting, and
  against his standing law that the house is autonomous and self-healing.
- The house mends its own line now. When the missing matter overflows the addendum, the keeper is
  asked to rewrite THAT ONE LINE so every missing thing is in it, keeping everything the line
  already said, in the same form. The rewritten line is what stands; the addendum keeps only what
  still will not fit. Guards: a rewrite that comes back stunted (less than half the line's length)
  or empty is refused, and a keeper that stumbles falls back to the old clause-wise trim rather
  than losing the line. The writer is never asked to notice any of it.
- 447/447 harness + 36/36 walk + 8/8 play. version.js -> m196-001.

# M197 — the detail is judged by need, and the prefix carries where
- A NUMBER CANNOT TELL "SHE IS LEFT-HANDED" FROM A BATTLE PLAN. The detail was capped at 240
  characters per answer and 480 merged — fine for a small fact, hopeless for a plan with its bait,
  its ground and its fallback, or a newly introduced person's appearance, or a political
  arrangement and who owes what to whom. And a plan cut in half is WORSE than no plan: the
  storyteller half-remembers it and writes the wrong scene. The discipline lives in the audit's
  own brief now — as short as it can be and still complete, never a word of padding, never a
  sentence where a phrase will do; but length judged by NEED, with the kinds of matter that earn
  the room named outright. The counts that remain are runaway guards at 1400, far enough out that
  nothing honest meets them, and a detail past 1200 still rewrites the LINE instead (M196).
- AND THE PREFIX KNEW THE HOUR BUT NOT THE ROOM. Rule 7 carried time alone, so the record could
  say when a scene happened and never where it stood. It carries both now, in one compact prefix
  after a dividing dot — "[Sept 1, 08:24 · the Wells kitchen]" — in the shortest form that is
  unmistakable. A scene that MOVES names where it begins and records the move as a phrase. Neither
  is invented: whichever the passage states is what appears, and the prefix is omitted only when
  it states neither. The closing checks ask for both.
- 448/448 harness + 36/36 walk + 8/8 play. version.js -> m197-001.

# M198 — the settings text said two readers were one
- Settings described the second reader's mending and then ended with "The record's own lines are
  checked the same way and rewritten when they misread a page" — which is the AUDIT'S work, not
  the second reader's. They run on different schedules, read in OPPOSITE directions (the reader
  judges a page against what lasts; the audit judges a record line against the pages it came
  from), and one of them may edit the writer's prose while the other may never. The writer read
  that paragraph and could not tell them apart, which is the paragraph's fault.
- Split, in both places: the switch's own note, and the roster in the help panel. The reader's
  note now names what it reads (the locked truths, the ledgers, the brief) and says plainly that
  the record is not its work; the audit has its own line saying it mends the line itself and
  writes what was missing beneath it, and never touches prose.
- 448/448 harness + 36/36 walk + 8/8 play. version.js -> m198-001.

# M199 — the panel kept losing the writer's place, and the buttons said nothing
- PRESSING A BUTTON THREW THE WRITER BACK TO THE TOP. render() empties panelsEl and builds it
  again, which puts the scroll at zero — so Audit, Rebuild the record, Read the pages again, any
  of them, and the writer lost the thing they had been looking at and had no way to see whether
  what they pressed had finished. The background refresh (quietRender) had kept the position since
  M105; every OTHER caller did not. It is kept in render() itself now, taken BEFORE the panel is
  emptied and restored across two frames, so every caller has it.
- AND THE BUTTONS SAID NOTHING AT ALL. They hand their work to the background chain and returned
  in silence. Each one now says what it is doing while it runs (\"Auditing the ledger…\"), says what
  happened when it lands (\"The ledger was audited\"), says so plainly when it stumbles, cannot be
  pressed twice while in flight, and comes back to its own words a breath later. Five of them:
  Read the pages again, Audit the ledger, Found the world from the brief, Rebuild the record from
  the pages, Put the old record back.
- The ninety-turn play's own law caught the change (it checked the button was itself again the
  instant the work returned); it now waits for the button to come back and checks it is pressable.
- 449/449 harness + 36/36 walk + 8/8 play. version.js -> m199-001.

# M200 — thrown out of your own reading, and a coat that would not come
- EVERY STRUCTURAL REBUILD JUMPED, AND USUALLY TO THE TOP. renderThread empties the thread and
  builds it again, and then called scrollToBottom() — BEFORE the new pages had laid out, so
  scrollHeight was still the old small number and the thread landed near the TOP. Mending a page,
  a swipe, a worker's write-back, closing the story panel: every one of them threw the reader out
  of the scene they were reading and made them scroll back down to find out whether the thing had
  even finished. M199 fixed this for the ledger PANEL and left the THREAD, which is where the
  writer actually reads.
  A rebuild keeps the reader's place now: the page under the top of the viewport goes back under
  the top of the viewport, restored across two frames AFTER layout. Only an OPENING lands at the
  latest page (openStory, removeStory, branchFrom, retry, regenerate), and only a reader already
  at the tail is carried down with it.
- A NEW COAT COULD BE HELD UP BY ONE MISSING FILE, FOREVER. self.skipWaiting() was chained after
  cache.addAll(SHELL) — and addAll is all-or-nothing. One asset that 404s (a file added to the
  house and forgotten in the list, a file removed and left in it) failed the whole install, the
  new worker never took over, and every browser served the OLD COAT with no sign of why. The
  takeover comes first and does not depend on the cache; the shell fills file by file and a file
  that will not come is simply not cached. A waiting worker also takes over when the room asks it
  to, and the room asks again at 2s, 6s, 15s and 30s after opening — because the launcher RESTARTS
  serve.py, so the first look can land while the port is still dead.
- 450/450 harness + 36/36 walk + 8/8 play + the wipe test. version.js -> m200-001.

# M201 — the ledger, during a rebuild, over and over
- M199 KEPT THE POSITION TWO FRAMES LATER, WHICH IS TOO EARLY. Every panel's content is filled
  ASYNCHRONOUSLY (each is latestWins(async …)), so two frames after render() the panel is still
  EMPTY: there is nothing to scroll, the restore does nothing, and the position is lost the moment
  the content arrives. And a rebuild saves one line at a time — every save notifies, every notify
  re-renders — so the writer was thrown to the top again and again while they watched it work,
  and had to scroll back down each time just to see whether it had finished.
- The position is put back on every change to the panel until it sticks: an observer where there
  is one, a short poll where there is not, never a throw (this runs inside render(), and a throw
  here takes the whole drawer with it). It stops when it sticks, at a second and a half, or the
  moment the writer's own hand touches the panel — whichever comes first, so it can never fight
  the reader.
- PROVEN, not assumed: tests/dom/run.mjs DOM-18 scrolls the panel to 1200, fires eight rebuild
  refreshes, and finds it still at 1200.
- 450/450 harness + 37/37 walk + 8/8 play. version.js -> m201-001.

# M202 — the old Summaryception prompt, and a rebuild that called a stumble "finished"
- COZY TAVERN WAS RUNNING SUMMARYCEPTION'S *OLD* PROMPT. The writer's own extension has moved on,
  and four blocks it added were never ported. Read from the writer's repo and brought across
  VERBATIM:
    · RULE 3 — FIRST APPEARANCES: a named character, creature, place or object entering the record
      for the first time carries its defining description as MANDATORY canon, and that is never
      the phrase cut to fit the limit.
    · CAUSAL FIDELITY: keep a cause joined to its effect with a connective; preserve the MANNER of
      a charged or involuntary action; a stat delta rides with the beat that caused it.
    · VERBATIM PRESERVATION: a short exact quotation (15 words max) when the precise WORDING is
      the fact — an oath, a promise, a threat, a signature phrase, a line being misquoted or
      thrown back. THIS is why the writer's snippets had no dialogue in them: the rule that keeps
      it never existed in this house.
    · COMPLETENESS OUTRANKS BREVITY: the phrase limit is a ceiling, not a target; when in doubt,
      KEEP — the auditor can trim, it cannot restore what was never written.
  The closing checks are now Summaryception's thirteen, with this house's own two folded in
  (M197's time-AND-place prefix as check 1, M194's exact figures as check 14).
- A REBUILD CALLED A STUMBLE "FINISHED". rebuildRecord broke out of its loop the moment a round
  wrote nothing — and maybeSummarize SWALLOWS a wire that failed, so "couldn't reach the
  storyteller" read exactly like "there is nothing left to fold". The rebuild stopped halfway,
  reported its half as the whole, and the writer was left with an incomplete record and no word of
  why. Exactly what the writer hit. A round that writes nothing while work is STILL DUE now waits
  and tries again (1.5s, 4s, 9s) and only then gives up — saying it stopped, where it stopped, and
  that the old record can be put back.
- AND THE REBUILD ATE ITS OWN WAY BACK. The backup was taken unconditionally, so a rebuild that
  stumbled left a HALF record and pressing rebuild again saved that half over the writer's real
  one — "Put the old record back" then restored the wreckage. The same fault M165 fixed for the
  people; the record had it too.
- 451/451 harness + 37/37 walk + 8/8 play. version.js -> m202-001.

# M203 — what the house is doing, while it does it
- EVERY MANUAL ACTION WENT SILENT. Audit the ledger, read the pages again, found the world,
  rebuild the record, rebuild the people, rebuild every standing, put either back — each handed
  its work to the background chain and then said nothing, or one toast that vanished in seconds. A
  two-hundred-page rebuild is MINUTES of silence, and the writer was left scrolling to guess
  whether it had finished, stalled or died. Summaryception has shown the shape for years.
- ONE BANNER, at the top of the ledger where the writer is already looking, for all eight actions.
  It says what is running, how far it has got ("page 7 of 24 · 29%"), and counts a stumble down
  ("trying again in 4s (2 of 3)") so a wait never looks like a death. A newer action takes the
  banner and the older one goes quiet, so two can never fight over it. A law walks every action
  and insists it begins a banner AND always finishes it — including on every early return, because
  a banner left spinning over nothing is worse than no banner at all.
- AND A REBUILD THAT STOPPED NOW CARRIES ON FROM WHERE IT STOPPED. rebuildRecord wiped the record
  and folded from the first page EVERY time — so a rebuild that stumbled at page 100 of 200 threw
  away those hundred pages of work and made the writer pay for them again. A part-built record
  (marked rebuiltAt, holding lines) is resumed; dueRange picks up at the first page no line
  covers. Only a fresh rebuild starts from nothing, and the banner says which it is doing.
- THE SHELL AUDIT EARNED ITS KEEP: M30-8 caught js/ui/workbanner.js missing from sw.js's SHELL the
  moment the file was added — the exact trap M200 described, found by a law rather than by a
  writer whose browser had quietly stopped updating.
- 452/452 harness + 37/37 walk + 8/8 play + wipe + contrast. version.js -> m203-001.

# M204 — the banner is for the writer's own hand only
- The writer asked before it could bite: does the AUTOMATIC chain raise the banner too? It does
  not, and now it never can. The chain runs after every single page — extractor, world agent,
  scribe, keeper, second reader, auditor — and a banner flashing through all of that while the
  writer is reading would break the scene every turn, which is the opposite of what it is for.
- Held by a law: beginWork is called in exactly EIGHT places, one per manual action; neither
  startBackgroundWork nor generate() may touch it; and the banner element lives INSIDE the ledger
  drawer, so a closed ledger cannot show it at all. The automatic readers keep reporting where
  they always have — the workers' line in the ledger, and the receipt under the page.
- 453/453 harness + 37/37 walk + 8/8 play. version.js -> m204-001.

# M205 — auditing M203's own work, which the suites had passed throughout
- RESUME ONLY WHAT ACTUALLY STOPPED SHORT. M203's resume asked "has this record been rebuilt
  before, and does it hold lines?" — which is TRUE after a rebuild that FINISHED. So the next
  press resumed a completed job: the record was not wiped, dueRange found nothing due, and the
  button did NOTHING AT ALL, silently. A stall is marked explicitly now (rebuildStalled) and
  cleared the moment a rebuild completes; only a real stall is carried on.
- THE BANNER MUST NOT LIE. bannerFollows waited on pendingWork, which resolves "settled" whether
  the work SUCCEEDED OR FAILED. An auditor that could not reach its connection therefore ended
  with "The ledger was audited" in front of the writer — the banner saying the opposite of the
  workers' line two inches below it. The queue's own promise carries {ok, why}; that is what
  decides what the banner says, and the four actions that hand work to the chain each pass their
  own promise.
- BOTH WERE FOUND BY AUDITING THE NEW CODE, NOT BY RUNNING THE SUITES — which passed, green, over
  both of them. That has been the difference all session: reading finds what testing does not.
- 454/454 harness + 37/37 walk + 8/8 play. version.js -> m205-001.

# M206 — the closing sweep: auditing this session's own work
- M196 DID NOTHING, QUIETLY. `const mended = repaired.used.length > 0` was read ABOVE the overflow
  rewrite that also mends the line — so a line rewritten because its addendum overflowed was never
  saved unless the audit happened to return a FIX as well, and the early return below could drop
  it entirely. The whole of M196 was dead whenever it was the only thing that had changed. The
  decision is made after every mender has run, immediately before the save.
- A PAGE DELETED ACROSS BROWSERS CAME BACK. M185's by-client rule only protected a browser's
  deletions of its OWN appended pages. A page CHROME appended, which Opera then pulled and the
  writer deleted in Opera, was folded straight back in — "let this page go" undone, across
  browsers, silently. Proven.
  The push now carries the browser's own bookStamp (X-Cozy-Base): a log line OLDER than what that
  browser had already taken in was known to it, so its absence is a DELETION; a line newer than
  that stamp could not have been known, so its absence is the race M184 exists for. Both laws hold
  together in tests/append.py — the deleted page stays gone AND the unseen page still survives.
- AND THE LINE IS STAMPED BY THE DEVICE, not by whichever browser sent it. The fold compares that
  stamp against a browser's bookStamp, and two browsers' clocks are not a comparison anyone should
  rest a page on. Held by a law: a line sent with at=1999 is stored with the device's own time.
- 454/454 harness + 37/37 walk + 8/8 play + wipe + guard + two-browser + append.
  version.js -> m206-001.

# M207 — "the keeper stumbled — outwaited": the rebuild could never finish
- FROM THE WRITER'S OWN SCREEN: "Rebuilding the record · page 18 of 98 · 18%" sitting above "the
  keeper ran 2 minutes ago and stumbled — outwaited". The queue gave the WHOLE JOB one
  sixty-second leash (workerSignal's WORKER_TIMEOUT_MS). That is right for one worker asking one
  question, and hopeless for a rebuild, which is sixteen questions across a hundred pages. So on
  ANY tale long enough to need a rebuild, the rebuild was aborted partway and could never finish —
  which is exactly what the writer reported two sessions running ("I rebuild ledger and the ledger
  not complete"), and what M202's retry then dressed up as a stall.
- THE LEASH IS PER CALL, NOT PER JOB. workerSignal hands out a renew() that resets the timer; the
  queue passes it to every job; a job that works in rounds calls it at the top of each round (the
  record rebuild each round and after each retry pause, the people rebuild each batch). A hung
  call is still cut off after sixty seconds and a renew after an abort is refused — proven both
  ways: 1.2s of renewed work under a 0.3s leash survives, an unrenewed 200ms leash still aborts.
- 455/455 harness + 37/37 walk + 8/8 play. version.js -> m207-001.

# M208 — a stop for the writer's own hand, and no more token dumps in the record
- THE RECORD WAS TALKING NONSENSE. From the writer's screen: "Detail worth keeping: also named:
  cardinal, Aurora house next door, also named: Rachel British, American, Reynolds, figures 16,
  18". When the sharper second ask still left something out, the CODE pasted the raw tokens in —
  a debug list where a sentence belongs, half of it not even names ("British", "American"),
  written twice, and read by the storyteller every single turn. A detail must be sentences that
  stand with the line above them. One more ask now, for those things written as phrases that read
  as English beside the line; and if what comes back is still a bare list (looksLikeTokenDump —
  many commas, almost no English between them), NOTHING is written. A line losing a name is a
  smaller harm than the record talking nonsense at the storyteller forever.
- AND THERE WAS NO WAY TO CALL OFF A REBUILD. Minutes of work and the only way out was closing the
  tab, which is not a control. The banner carries a Stop: it aborts the call in flight (an
  AbortSignal cannot be aborted from outside itself, so workerSignal's controller hands the abort
  out beside the signal), drops everything still queued for that story, and is honest — a stop
  returns {stopped:true}, is never retried, and never reads as a failure. The work already done
  stands: a part-built record is kept and resumed (M205), so pressing Rebuild again carries on.
  All eight manual actions can be stopped.
- TWO LAWS EARNED THEIR KEEP ON THE SAME PASS. tests/contrast.py caught the new Stop at 4.1:1 on
  the banner's surface, under AA, the moment it was added. And M22's id-coverage law reported the
  Stop as unwired — because its file list was HAND-WRITTEN and did not know about ui/workbanner.js;
  it reads the ui folder now, because a law that cries wolf teaches the next reader to ignore it.
- 456/456 harness + 37/37 walk + 8/8 play + wipe + guard + two-browser + append + contrast.
  version.js -> m208-001.

# M209 — a stop is not a stall
- M208 GOT THE STOP BACKWARDS. It kept the run's place, so pressing Stop and then Rebuild carried
  on from exactly where the writer had just chosen to ABANDON — the opposite of what a stop is
  for. The writer said it plainly: "I want to stop so I can rebuild from the beginning."
- THE TWO LOOK THE SAME FROM THE QUEUE'S SIDE AND ARE OPPOSITE THINGS TO THE WRITER:
    a STALL is a failure nobody chose — the keeper outwaited, the wire fell over. It keeps its
      mark and the next rebuild picks up where it stopped, because paying twice for work that
      already succeeded is the thing M203 fixed.
    a STOP is the writer's own hand. It clears the mark, so the next rebuild starts from the first
      page. The banner says exactly that: "Stopped — the next run starts from the first page."
  Both marks are cleared, the record's and the people's, and all eight actions stop this way.
- 457/457 harness + 37/37 walk + 8/8 play. version.js -> m209-001.

# M210 — one button, one meaning
- REBUILD SOMETIMES RESUMED AND SOMETIMES STARTED OVER, depending on how the LAST run had ended.
  One button doing two different things, with nothing on screen to say which — and after a run
  that finished it could do NOTHING AT ALL. The writer put it plainly: Rebuild must always delete
  everything and start from the first page; the carrying-on he wants is the RETRY inside a single
  run, which never stopped and never needed a press.
  So: the record is let go and folded again from the first page on EVERY press. No resuming across
  presses, no mark deciding what a press means. Inside a run, a round that stumbles still waits
  and tries again three times rather than throwing the run away, and only a run that gives up
  after that says so. The backup is still never overwritten by a rebuild's own output (M202).
- AND THE STOP WAS UGLY. It was text with a red underline under it — which reads as a mistake in
  the page, not a control. A quiet pill on the banner's own surface, plain to read and plain to
  press, still meeting AA in both coats. And a stop now just stops: there is no mark left for it
  to clear, because Rebuild starts fresh whatever happened before.
- Three laws written for the resume went with it, replaced by the one that is now true.
- 455/455 harness + 37/37 walk + 8/8 play + contrast. version.js -> m210-001.

# M211 — the banner counted calls, not batches
- THE WRITER WATCHED IT SIT AT NOTHING AND LEAP TO "18 of 99". maybeSummarize folds THREE batches
  per call (BATCHES_PER_RUN) and the rebuild's banner was counting CALLS — so it could only ever
  move in jumps of eighteen pages. Summaryception counts batches because a batch is the unit of
  work a writer can feel. onBatch fires after every batch now; the banner reads
  "batch 4 of 11 · 36% · 24 of 69 pages".
- AND THE BAR COULD NEVER CLOSE. The batch count was ceil(toFold / batch) — but dueRange holds a
  PART batch back for next time, so the last few pages are never folded, and the banner ended a
  finished run reading "11 of 12 · 92%". A writer watching a bar that never closes cannot tell
  finished from stuck. Floor, not ceil: the last step reaches the end.
- ON THE FIRST LINE COMING BACK THE SAME: it does not. Proven end to end with a scripted keeper —
  a record holding an old line, rebuilt, comes back with the old line GONE and every line folded
  again from page one (11 lines, first one new). A first line that is unchanged means the coat is
  older than M202, which is the pass that ported Summaryception's newer prompt.
- 456/456 harness + 37/37 walk + 8/8 play. version.js -> m211-001.

# M212 — the prompt the keeper is SENT, not the prompt in the file
- Summaryception keeps TWO copies of its summarizer prompt: the live one and a migration "old
  default". A port that landed in the wrong copy would leave the keeper folding by the OLD rules
  while this file looked entirely correct — and the writer would rebuild, get the same lines back,
  and have nothing to explain it. Verified by building the real message and reading what goes out:
  all six blocks reach the keeper (VERBATIM PRESERVATION, CAUSAL FIDELITY, FIRST APPEARANCES,
  COMPLETENESS OUTRANKS BREVITY, plus this house's FIGURES ARE EXACT and Time AND place), and the
  older rules they were built on are still there. Held by a law on the SENT message, never on the
  file's contents.
- 457/457 harness + 37/37 walk + 8/8 play. version.js -> m212-001.

# M213 — the rebuild stopped at batch 3 of 16 and said "nothing to rebuild"
- THE LEASH WAS RENEWED ONCE PER ROUND, AND A ROUND IS FOUR OR MORE CALLS. M207 renewed at the top
  of each round — but a round is BATCHES_PER_RUN (three) folds, and EVERY fold is followed by the
  AUDIT'S own calls: one, and up to three when it has to ask again, plus the overflow rewrite.
  Four or more keeper calls between renews passes sixty seconds easily on a real model, so the
  signal aborted mid-rebuild. On the writer's 118-page tale it died at batch 3 of 16.
  Every keeper call in agents/memory.js renews before it goes now — the fold, the audit, both of
  its re-asks, the overflow rewrite and the promotion fold.
- AND AN ABORTED RUN RETURNED null, WHICH PRINTS AS "nothing to rebuild". Over a run that had
  really folded eighteen pages. Both rebuilds report what they did with stalled:true and a plain
  why. null is never returned for a cut-short run again.
- PROVEN ON THE WRITER'S OWN SHELF: 118 pages, window 20, batch 6 — the rebuild now reaches 16/16,
  sixteen lines, not cut short. Held as a law, end to end, with a scripted keeper.
- AND THE DIAL LIED ABOUT ITS OWN UNIT. "Turns per record line: 6" while the number is PAGES (6
  pages = 3 turns) — the aria-label said pages, the visible label said turns, and the writer read
  the number as turns. It says "Pages per record line" now, with the turn arithmetic beside it.
- 458/458 harness + 37/37 walk + 8/8 play. version.js -> m213-001.

# M214 — the closing audit: three faults in the banner work, none caught by lint or any suite
- `banner.failed(…)` SAT ON THE LINE ABOVE `const banner = …` IN BOTH REBUILDS. A bulk edit put
  the connection guard above the declaration, so pressing Rebuild the record — or Rebuild the
  people — with no connection for that worker threw a ReferenceError out of the click instead of
  saying what was missing. ESLint does not flag a temporal-dead-zone use inside a function body,
  and no suite presses a button with a worker connection missing. Both open their banner first
  now, and a law walks all eight actions and insists the banner exists before anything touches it
  (reading the file with comments STRIPPED — the first version of that check matched the word
  "banner.failed" inside its own explanatory comment and reported two false positives).
- A PEOPLE REBUILD CUT SHORT REPORTED AS A SUCCESS. rebuildRecordWords learned at M202 to say when
  a run stopped; rebuildPeopleWords was left behind, so a run the leash cut off at page 24 of 118
  still read "rebuilt the people: read 24 of 118 pages" — a sentence that sounds like it worked —
  and its banner closed with "The people were rebuilt". Both now say they stopped, and where.
- And bannerFollows no longer paints "done" over a banner the job has already closed itself.
- 459/459 harness + 37/37 walk + 8/8 play + wipe + two-browser + append + guard + contrast + coat
  + the anchor differential (484/484 identical) + no lint errors. version.js -> m214-001.

# M215 — "does it always retry?" — it did not
- A THROWN WIRE ERROR ESCAPED THE WHOLE REBUILD. callKeeper THROWS on a connection reset and
  nothing in rebuildRecord caught it — so the error left the function entirely, the QUEUE caught
  it, and the queue retried the WHOLE JOB. Which wipes the record and folds from page one again.
  A hundred pages of work thrown away by one blip, up to five times over, with the banner snapping
  back to batch 1 each time. Caught inside the round now: a thrown call is simply a round that
  wrote nothing, and the retry ladder is what handles it.
- AND THE LADDER WAS TOO SHORT TO MATTER. Three tries across fifteen seconds — any real provider
  hiccup outlasts that. Six rungs now (1.5s, 4s, 9s, 20s, 45s, 90s): about three minutes of
  patience, every wait counted down on the banner so it never looks dead, and Stop available
  throughout. Past that the connection is genuinely gone and saying so beats spinning forever.
- PROVEN: the wire taken down for four calls in the middle of a run — three retries used, and the
  rebuild came back and finished 6 of 6.
- 460/460 harness + 37/37 walk + 8/8 play. version.js -> m215-001.

# M216 — two things Summaryception has had for years, read from its code
- THE DETAIL WAS INVISIBLE TO EVERY WORKER BUT THE STORYTELLER. Only renderMemory carried it;
  recordFor and wholeRecord both stripped it with .map(n => n.text). So the KEEPER writing the next
  line could not see that the line before it had been CORRECTED — and would write the wrong fact
  again; the AUDITOR checking the ledger against the record could not see it; nor the MENDER; nor
  the HOUSEKEEPER. The one place a correction, a battle plan or a first appearance lives was
  hidden from everyone who needed it. Both now render lines with lineWords, exactly as the
  storyteller's copy does, and both still trim from the oldest when over budget.
- ONE BAD LINE MEANT REBUILDING THE WHOLE RECORD. Summaryception redoes a single snippet in place
  (sc-snippet-redo) and its detail separately (sc-detail-redo); this house had neither, so a
  single line that came out wrong cost minutes and threw away every other line that was fine.
  redoLine() folds that line's own pages again — with only the lines BEFORE it as prior context,
  never the ones after — clears the detail that described the old words, and re-runs the audit.
  detailOnly re-runs just the audit, for a line that is right with a detail that is not. A
  promoted line is refused (it has no pages of its own), exactly as Summaryception refuses one.
  Two buttons on every layer-1 line in the ledger: "Read these pages again" and "Detail again".
- (Both of these were owed when M216 shipped and are BUILT at M218: "Fold what is due now" with
  its three guards, and the catch-up after a stop. Nothing from the writer's list is outstanding.)
- 461/461 harness + 37/37 walk + 8/8 play + wipe + contrast. version.js -> m216-001.

# M217 — the line that "came back from the dead", and the button that only pretended
- THE WRITER'S REPORT WAS NOT A RESURRECTION BUG. A record line can be let go by hand, and a
  rebuild folds EVERY page from the first — so a line the writer had deliberately dropped, or
  rewritten in their own words, is written again from the pages. That is what a rebuild IS. The
  confirm did not say so: "The old record is kept and can be put back" tells the writer nothing
  about their hand edits being undone. It now says plainly that every line comes back, including
  the ones they let go, and points at the per-line redo instead.
- AND "FOLD AGAIN" ONLY PRETENDED. It deleted the line and left the BACKGROUND keeper to notice
  the gap and refold those pages on some later turn — so the record sat with a hole in it, the
  storyteller read a story missing those pages, and if the keeper was switched off or the
  connection was down it never came back at all. It folds them NOW, through M216's redoLine, and
  falls back to letting the line go only when there is no keeper to ask.
- M216's second button went with it: "Fold again" already existed and now does the real thing, so
  a second button meaning almost the same would have broken M210's law (one button, one meaning).
  Only "Detail again" is new on a line.
- 461/461 harness + 37/37 walk + 8/8 play. version.js -> m217-001.

# M218 — the last two on the writer's list, and laws that no longer break on being added to
- FOLD WHAT IS DUE NOW — Summaryception's "Force Summarize Now", which this house never had. The
  keeper folds three batches per finished page, so a writer who STOPPED a run, or switched the
  keeper on partway through a long tale, was dozens of batches behind with no way to catch up but
  playing turn after turn. catchUpRecord folds until nothing is due, counting batches, with the
  same six-rung retry ladder a rebuild has — and it NEVER WIPES: it fills the gaps and leaves every
  line already written untouched, word for word. Proven: a stopped run with 48 pages unfolded and
  two lines already written — caught up in 8 batches, both old lines intact, nothing due after.
  This is also the automatic catch-up after a stop the writer asked for: the per-turn chain keeps
  folding three batches a page as it always did, and this is the way to clear a large backlog at
  once instead of waiting seventeen turns for it.
- THE THREE GUARDS, as Summaryception has them: the keeper is switched off; a pass is already
  finishing; nothing is past the word-for-word window. Plus a missing connection, named.
- AND FOUR LAWS BROKE PURELY BECAUSE A TENTH ACTION WAS ADDED. They counted to a fixed number —
  "eight actions", "six renews" — so every new action made four laws fail for no reason, which
  teaches the next reader to edit laws instead of trusting them. They count STRUCTURALLY now:
  every banner raised has a stop; nearly every callKeeper has a renew above it; the chain still
  never raises a banner.
- 462/462 harness + 37/37 walk + 8/8 play + contrast. version.js -> m218-001.

# M219 — the closing audit of M216–M218
- THE CATCH-UP'S TOTAL COUNTED PAGES THAT WERE NEVER DUE. It took every covered page — including
  lines that reach INTO the word-for-word window, which are not due at all — so the total came out
  short and the banner ran PAST ITS OWN END: "1 of 2, 2 of 2, 3 of 2". A writer watching a bar
  overshoot cannot tell a miscount from a runaway. Only pages past the window and not already
  covered are counted now: the same shape reads 1/3, 2/3, 3/3 and folds exactly the eighteen pages
  of the hole.
- Read and found sound on the same pass: redoLine refuses a line whose pages are GONE, folds from
  what remains when a line runs past the end of the story, is given EVERY line before it as prior
  context and none of the lines after (proven by reading the fold call's own request body — the
  first attempt read the AUDIT's body by mistake and reported a false failure), and is given
  exactly its own pages. catchUpRecord fills a hole in the middle correctly and never wipes.
- 463/463 harness + 37/37 walk + 8/8 play, each alone + wipe + two-browser + append + guard +
  contrast + coat + the anchor differential (484/484) + no lint errors. version.js -> m219-001.

# M220 — a control nobody can find is a control that does not exist
- The catch-up was called "Fold what is due now" — this house's own phrasing. The writer went
  looking for "summarize now", which is what Summaryception calls it and what is in his head. He
  could not find the button that had been built for him. Named "Summarize now", with the title
  naming Summaryception's own "Force Summarize Now" so the connection is plain.
- 463/463 harness + 37/37 walk + 8/8 play + contrast. version.js -> m220-001.

# M221 — a turn spent entirely on fetching
- THE WRITER PRESSED THE HOUSEKEEPER AND GOT BACK, WHOLE, 51 CHARACTERS:
  <fetch>["#rbrq3w1", "#r86y302", "#r87g7v3"] — and no cards at all. When the fetch rounds run out
  and the answer is STILL nothing but a <fetch>, that raw block was handed back as the reply: a
  whole turn spent asking to read things, with nothing done, and the writer looking at protocol.
  It is served what it asked for and told once, plainly, that there is no more fetching this turn
  and it must answer now. The exhausted case is checked BEFORE the ordinary one, or it could never
  run at all.
- AND THE ANSWER TO THE WRITER'S OTHER QUESTION: yes, the housekeeper reads a record line's DETAIL,
  both in the record it is handed (M216 put the detail into wholeRecord, which is what it is given)
  and in any line it fetches by handle — serveFetch appends "• Detail worth keeping: …" to the
  line's own text.
- FOR THE RECORD: the AUDITOR has no notion of fetch at all — the word appears nowhere in
  auditor.js. An "audit" that comes back as <fetch> is a housekeeper turn, not an audit.
- 464/464 harness + 37/37 walk + 8/8 play. version.js -> m221-001.

# M222 — the Audit button's one instruction could never be obeyed
- The housekeeper's Audit ask tells the model, in as many words, to "FETCH those pages whole
  (their #handles) and the line itself (its #r… mark) before you judge". parseFetchRefs accepted
  HEX ONLY. Page ids are hex; a RECORD line's mark is "#r" + the node's own id, which carries
  letters past f — "#rbrq3w1", "#r86y302". So EVERY record-line fetch was thrown out as malformed,
  the one thing that button asks for could never be fetched, and the writer's audit came back as a
  bare <fetch>["#rbrq3w1", "#r86y302", "#r87g7v3"] with nothing done at all. Record handles are
  handles now; a handle the record hands out is one the fetch accepts, held by a law.
- This is what M221 was a plaster over: that fix (never end a turn on a bare fetch) is right and
  stays, but the reason the turn ended on one was this.
- Verified end to end: the audit turn now uses its three rounds, is SERVED the line and its
  detail, is told once there is no more fetching, and never returns a bare fetch.
- 465/465 harness + 37/37 walk + 8/8 play. version.js -> m222-001.

# M223 — sight without reach: a record edit could not touch the detail
- THE WRITER'S AUDIT PRODUCED A PAGE OF CORRECT FINDINGS AND EVERY ONE WAS REFUSED. "indigo eyes"
  -> "blue eyes"; "Jovan is seventeen" -> "sixteen"; "Suzune is a nickname, not a surname" — all of
  them right, all of them "Refused — its anchor does not match the line".
  Since M216 the housekeeper READS a line's "• Detail worth keeping: …", so it did the obvious
  thing and proposed corrections to it. But the anchor was matched against node.text ALONE, which
  never contains the detail. I gave it sight without reach, and it spent a whole audit on findings
  that could not land.
  locateInNode looks in the line, then in its detail, and the edit is written back to whichever
  held the anchor. The "• Detail worth keeping:" label pasted in with the quote is forgiven,
  because models copy it.
- AND CHAT ASSISTANT'S LAW, PORTED: "ANCHORS ARE COPIES, NOT DESCRIPTIONS. Every find must be
  copied character for character out of text you are HOLDING. A line shown in an index or a
  summary is clipped and its whitespace collapsed, so an anchor built from one cannot match and
  the edit is dead on arrival — <fetch> the line first." That is the same fault in the model's own
  half of the loop, and Chat Assistant has carried the fix for a long time.
- 466/466 harness + 37/37 walk + 8/8 play. version.js -> m223-001.

# M224 — the housekeeper nagging about cards nobody could apply
- THE WRITER APPLIED THREE CARDS, ALL SUCCEEDED, AND WAS THEN TOLD: "a few housekeeping items are
  still sitting in cards from that sweep … items I proposed but they weren't applied. If you apply
  those…" — about cards that COULD NEVER BE APPLIED BY ANYONE, because their anchors were gone.
- TWO FAULTS, ONE ON TOP OF THE OTHER:
  1. autoSupersede opened with `if (!fresh.length) return 0;` — it did nothing at all unless the
     answer carried NEW cards. A turn with no cards is exactly the turn where a dead card is
     stranded, which is the writer's case precisely: a clean audit after a good sweep, and the
     stale ones left with nothing to displace them.
  2. Even when it ran, a dead card was only set aside if a NEW card happened to target the same
     thing. With no replacement it stayed pending FOREVER — shown to the housekeeper every turn as
     work outstanding, so it dutifully nagged the writer about it in prose.
  A card whose anchor no longer matches is retired on its own now, with its own plain reason. It
  is not the writer's job to sort out cards that cannot land.
- 467/467 harness + 37/37 walk + 8/8 play. version.js -> m224-001.

# M225 — the safety hole M224 opened, and what the extractor cannot see
- M224 MADE autoSupersede RUN ON EVERY TURN. Every branch of anchorIsDead reads DEAD when the
  thing it looks into is ABSENT — no messages, no record, no rulebook. Under M224 that meant one
  caller handing over a half-built world would have retired EVERY pending card the writer had, all
  at once, as "can never be applied". A fix that quietly destroys work is worse than the nagging it
  replaced. A card is dead only when the house can SEE the text it points into and the anchor is
  not in it; "cannot tell" is not "dead", for every anchor kind.
- WHAT THE EXTRACTOR CANNOT SEE (the writer's question, verified and NOT yet changed): the word
  "record" appears nowhere in agents/extractor.js. The worker that writes the ledger is given the
  newest page and the four before it — eight with "Read the pages again" (deep) — and NEVER the
  folded record. So everything older than eight pages is invisible to it. For scene state (who is
  here, the clock, a wound) the recent pages are the right material; for a repair sweep over a long
  tale they are not. DONE at M226.
- 468/468 harness + 37/37 walk + 8/8 play. version.js -> m225-001.

# M226 — the extractor could not see the story it was writing down
- THE WORD "record" APPEARED NOWHERE IN extractor.js. The one worker that decides who is present,
  where they stand, what is locked true and which threads are open was given the newest page and
  the FOUR before it — eight on a deep read — and nothing else. On a hundred-page tale everything
  older than eight pages was invisible to it: it could "discover" a person the story had known for
  eighty pages, seat someone who left long ago, or miss that a thread it watched open had been
  closed. This is very likely the source of the stale threads and lagging STATE/ARC lines the
  housekeeper kept finding.
- The folded record rides now, labelled "The story so far, folded", placed BEFORE the recent pages
  so the story runs oldest to newest — and cut to the lines older than the pages it can already
  see (memoryForWindow at prior.length - before.length), so nothing is told to it twice.
- 469/469 harness + 37/37 walk + 8/8 play. version.js -> m226-001.

# M227 — the scribe could not see the loose ends it was meant to close
- THE HOUSEKEEPER KEPT FINDING FINISHED BUSINESS STILL OPEN: Alexia's completed self-introduction,
  Aurora's answered question, Ms June's answered question, a photo already found. Every one of
  them on a person who was OFF SCENE.
  renderPeopleTiers gives a full page — Loose ends included — to people on scene, and recalls an
  OFF-scene person only when the recent pages name them. The scribe passed an EMPTY page list. So
  nobody off scene was ever recalled, their open loose ends were invisible to the one worker that
  can close them, and every thread on anyone not standing in the room stayed open FOREVER, however
  plainly the page answered it. The housekeeper was not wrong; it was reporting a real pile-up
  that nothing could clear.
  The pages of this very turn decide who is recalled now — and a person the page never names is
  still left out, so the tiers still do their work.
- AND THE SCRIBE WAS NEVER TOLD TO LOOK. Its brief named `unthread` and said only "a loose end
  that closed, worded as it was written before" — nothing asked it to READ the open ones against
  the page. CLOSE WHAT THE PAGE ANSWERED (M227) does: read every loose end already open on each
  person and ask whether this page answered it, because loose ends do not expire on their own and
  a ledger full of finished business is a ledger that lies.
- 470/470 harness + 37/37 walk + 8/8 play. version.js -> m227-001.

# M228 — no page is read by nobody
- M226 GAVE THE EXTRACTOR THE RECORD AND I TOLD THE WRITER IT "SEES THE WHOLE STORY". It did not.
  The record holds only pages that have LEFT the word-for-word window AND been folded; the newest
  ones — twenty at the writer's settings — have no line yet, and the extractor read four of them
  (eight on a deep read). So SIXTEEN PAGES were too NEW for the record and too OLD for its window
  and were read by NOTHING: a hole that moved forward with the story and never closed. The writer
  saw it immediately ("so it'll now read all the pages that's not summarized or not!!") — the
  answer was no, and my summary of my own change had papered over it.
- The pages it reads now run back to the last page the record covers, so the record and the pages
  MEET with nothing between them. Measured on his own shelf (118 pages, window 20, batch 6): the
  record covers 0-95, the pages read are 96-117, gap NONE. A cap of thirty stands for the case
  where the keeper is switched off entirely and the unfolded tail is the whole tale.
- 471/471 harness + 37/37 walk + 8/8 play. version.js -> m228-001.

# M229 — the detail had no memory of the story it was writing about
- FROM THE WRITER'S OWN RECORD, four details in a row: "Jovan's full name is Jovan Wells" …
  "Rias's full name is Rias Wells" … "Vanessa was thirteen with braces when Jovan met her" …
  "the phone graphic uses #121212 background, #333 border, #2d2d2f bubbles, #777 timestamp".
- THE AUDIT WAS GIVEN THE PAGES AND THE LINE AND NOTHING ELSE. No prior record at all. So every
  batch re-established what the story had settled eighty pages earlier, and the storyteller read
  the same full names every turn for the rest of the tale. The SUMMARISER has had a hard exclusion
  against restating <prior_context> since the beginning; the AUDIT, which writes the detail right
  beside it, had none. It is given the lines BEFORE this one now — never the ones after, a detail
  must not know the future — under the heading "ALREADY ESTABLISHED … Never write any of it
  again", and its brief carries the rule with the reason.
- AND NOTHING TOLD IT THAT PRESENTATION IS NOT STORY. Colours, hex values, fonts, line-heights,
  borders, pixel sizes, CSS and markup are how a page was DRESSED. Banned outright.
- The "also named: Chloe, Caleb Thorne, Wells" in the writer's record is OLD — written before M208
  removed that token dump. Rebuilding or redoing those lines clears them.
- 472/472 harness + 37/37 walk + 8/8 play. version.js -> m229-001.

# M230 — the token dump had TWO homes and M208 closed one
- THE WRITER, ON THE LATEST COAT, STILL HAD "also named: Chloe, Caleb Thorne, Wells" IN HIS
  RECORD — and I told him it was old and to fold the line again. It was not old. M208 took the
  dump out of the LOSS path and left the one M196 had written in the OVERFLOW path
  (`detail = 'also named: ' + after.missingNames…`). Two sites, one fixed, and when he said it was
  still happening I explained it away instead of grepping for the string he had literally pasted
  in front of me. There is no place left that writes a bare list: the overflow path writes nothing,
  because the rewritten line already holds what those names were doing, and if it does not,
  nothing beats nonsense.
- AND THE DETAIL MUST READ BESIDE THE LINE. The writer: "the wording of detail is also confusing
  it should be understandable what information on the detail is and connection with main summary
  snippet". Every phrase must now say WHAT the thing is and WHY it matters here — "Vanessa holds
  the only photo of the pier fire, and means to trade it" — never a bare noun, never a label with
  a colon, never a list of names. The test given to the model: if a phrase would puzzle someone
  who had just read the line above it, it is the wrong phrase.
- 473/473 harness + 37/37 walk + 8/8 play. version.js -> m230-001.

# M231 — the connection the writer chose is the connection that answers
- workerConnection TOOK A COPY OF THE CONNECTION AND THREW AWAY ITS SETTINGS: temperature forced
  to 0, top-p DELETED, prefill deleted, search deleted, thinking forced off. So a connection the
  writer had made FOR his workers, with the values he wanted on it, was used for its address and
  its model and nothing else. The writer put it plainly: "Why not use connections!! Do you think
  I'm stupid enough to put prefill on my worker! I can create connections specifically for my
  workers." He is right — he assigns a connection PER WORKER, and that is exactly where those
  choices belong.
- Worse, top-p was DELETED rather than set, so instead of a chosen value a worker got whatever
  that provider happens to default to — different on DeepSeek, Z.ai and OpenRouter. Not a decision,
  an accident.
- What the connection says, it says. What remains in workerConnection is only what a connection
  cannot say: a FLOOR on the room an answer needs, so a storyteller connection set to 200 tokens
  cannot cut a worker's JSON in half; and a default of temperature 0 / thinking off for a
  connection that specifies neither.
- FOR THE RECORD on temperature: Cozy Tavern forced 0, which is greedy decoding and the setting
  most prone to degenerate repetition on long structured prompts — a fair description of what the
  writer's record was doing. Summaryception's own default is 0.3 (Ollama) / 0.8
  (OpenAI-compatible), never 0. The writer can now simply set it on his worker connection.
- 473/473 harness + 37/37 walk + 8/8 play. version.js -> m231-001.

# M232 — nothing set means the provider's default, not the house's zero
- M231 STOPPED OVERRIDING A TEMPERATURE THE CONNECTION HAD, AND THEN STILL IMPOSED 0 ON ONE THAT
  HAD NONE. Same overruling, quieter. A connection that says nothing about temperature is the
  writer saying "whatever this provider does"; the house has no business answering for him. The
  key is removed entirely now, so nothing is sent and the provider's own default stands. The same
  for thinking.
- WHAT A WORKER STILL DECIDES FOR ITSELF is its own ASK — every worker calls with effort:'off',
  which is a worker choosing not to think about its own job, not the house rewriting the writer's
  connection. A worker that wants cold asks for cold (the referee asks for a 12s budget, the
  extractor asks for nothing and takes the connection's).
- So the whole of a worker's behaviour is now the writer's to set, on the connection he assigns to
  that worker — temperature, top-p, prefill, search, thinking — and the house supplies only a floor
  on answer room.
- 473/473 harness + 37/37 walk + 8/8 play. version.js -> m232-001.

# M233 — thinking is the writer's to decide, like everything else
- EVERY WORKER ASKED FOR effort:'off' OUTRIGHT — eleven sites — and I called that "a worker
  choosing about its own job, not the house rewriting the connection". It was the same paternalism
  the writer had already told me twice to stop, dressed as a principle. He assigns the connection
  per worker; whether his keeper thinks is his call and his tokens. Every forced 'off' is gone: a
  connection that asks to think, thinks; one that asks not to, does not; one that says nothing
  sends nothing and the provider decides.
- The storyteller's own dial (effectiveReasoning in ui/chat.js) is untouched — that is the STORY's
  thinking, already resolved per-story then per-connection, and not a worker.
- So a worker's entire behaviour is the writer's now: temperature, top-p, prefill, search,
  thinking. The house supplies only a floor on answer room.
- 474/474 harness + 37/37 walk + 8/8 play. version.js -> m233-001.

# M234 — a comma is a decimal point, and a closing form threw the writer down the page
- THE WRITER TYPED 0,3 INTO THE TEMPERATURE AND "TEST CONNECTION" PASSED. It passed because
  NOTHING WAS BEING SENT. The field is <input type="number">, so a browser handed a comma gives
  back an EMPTY string — or, keeping the text, something parseFloat reads as 0. His number was
  silently thrown away (or silently made zero) and the test's success told him it had worked. A
  decimal comma is how most of the world writes a number.
  Both sampling fields are text with inputmode="decimal" now — a number input CANNOT hold a comma,
  so reading it better was not enough — and a comma is read as the point it is.
- AND CLOSING THE CONNECTION FORM THREW HIM DOWN THE PAGE. The form is hidden inline, so a tall
  panel collapses to nothing, the page gets shorter, and the browser clamps the scroll to the new
  height — landing wherever that happens to be. It is not a position anyone chose; it is the old
  one having nowhere left to be. The connection just edited is brought back under the eye instead.
- 475/475 harness + 37/37 walk + 8/8 play + contrast. version.js -> m234-001.

# M235 — "STATS: none" on every line, and a line severed mid-name
- EVERY RECORD LINE ENDED "STATS: none". Rule 9 demanded ALL stat changes be bundled into one
  phrase at the end of the line, and said nothing about what to do when NOTHING changed — so the
  keeper dutifully wrote the phrase anyway, and the storyteller read "STATS: none" on every line
  of the record for the whole tale. The rule now says outright: if no stat changed, write nothing
  at all — not "none", not "unchanged". And a keeper that writes it anyway is not obeyed; the code
  strips a bare one.
- AND A LINE WAS CUT MID-NAME. The writer's own record ends "...and graded Jo…" — a name severed
  in half with everything after it gone and no sign of what. parseMemoryAnswer chopped at 4000
  characters exactly, wherever that landed. It cuts on the last whole phrase now, so a line that
  must be trimmed still ends on something that reads. (The real remedy for a line that long is
  the phrase limit in rule 9's sibling — HARD LIMIT 15, 18 for dense scenes — which that line
  plainly overran; the cut is the backstop, not the fix.)
- 476/476 harness + 37/37 walk + 8/8 play. version.js -> m235-001.

# M236 — two doors into the people ledger, one guarded
- FROM THE WRITER'S OWN LEDGER, Vanessa carried BOTH "She is hunting for a name and a photo of
  'England boy' before Saturday." and "She is STILL hunting for a name and a photo of 'England
  boy' before Saturday." The same loose end twice, read by the storyteller every turn.
  mergeDeltas has asked sameLooseEnd before adding a thread since M134 — but setPersonField, the
  WHOLE-LIST path a worker or the housekeeper uses to write the threads at once, simply took what
  it was given. One door guarded, one open. It asks the same guard now.
- AND A LOOSE END WAS SEVERED MID-THOUGHT: "...and Vanessa is still running interference with…" —
  nothing to say what she was running interference WITH. cleanFieldText chopped at the cap
  exactly, wherever that landed. It cuts on the last whole word now (the same fault as M235's
  record cut, in a second place).
- 477/477 harness + 37/37 walk + 8/8 play. version.js -> m236-001.

# M237 — the sweep: every cap, every door
- THE WRITER HAD REPORTED THE SAME FAULT THREE TIMES IN THREE PLACES — a record line cut
  mid-name, a loose end cut mid-thought — and each time I fixed only the one he showed me. That is
  why he was still here after twenty-four hours without playing his story. So, swept:
  · EVERY CAP THAT SHORTENS CONTENT now cuts on a word or a clause: a ledger field (core, state,
    arc) in engine/apply.js, the second reader's words, the workers' line, a card's reason, a
    loose end, a record line and its detail. Six places, one fault. The remaining slices are list
    LABELS — a story title in a list, a preview line — where a chop costs nothing.
  · EVERY LIST WITH MORE THAN ONE WRITE PATH asks the same question on both. Threads was the one
    unguarded door (M236). Read and found sound: `present` refuses someone already in the room,
    `mode.snapshot` works from a closed set of known flags so nothing can be written twice, and
    canon locks a truth BY KEY so relocking corrects rather than duplicates.
- 478/478 harness + 37/37 walk + 8/8 play + wipe + contrast. version.js -> m237-001.

# M238 — the ledger could hold the same person twice and never say so
- THE WRITER DID NOT REPORT THIS ONE. He could not have: nothing announces it. findPersonKey
  matched an exact name, then near-SPELLINGS — and spelling distance never bridges "Vanessa" and
  "Vanessa Reynolds", nine characters apart. So the moment ONE worker wrote the short name and
  another the full one, the ledger held TWO PEOPLE: half her loose ends on one page and half on
  the other, her standing split in two, her core written once and missing from the other, and the
  storyteller reading them as different characters for the rest of the tale. His own ledger has
  "Vanessa Reynolds" from the scribe and "Vanessa" throughout the prose.
- A name now matches a longer one when it is that name's own FIRST or LAST word, and a full name
  finds a page opened under either — but ONLY when exactly one person answers to it. Two Vanessas,
  or two Wellses asked for by surname, match NOTHING: a new page is the honest outcome, and
  guessing between them would be the worse failure. Near-spelling matching is untouched and still
  runs first.
- 479/479 harness + 37/37 walk + 8/8 play. version.js -> m238-001.

# M239 — the four ledgers nobody had read
- KNOWLEDGE AND FACTIONS MATCHED AN EXACT KEY AND NOTHING ELSE. No spelling tolerance, no short
  name — while the PEOPLE ledger had at least near-spelling matching (and first/last names since
  M238). So "Vanessa" and "Vanessa Reynolds" became TWO RECORDS OF WHO KNOWS WHAT, and the
  storyteller was told she does not know the thing she was told on the page before. Knowledge is
  the one ledger where a split is invisible AND changes what characters say aloud. Factions the
  same, under two names.
  One matcher now, shared by both: an exact key, then a name that is the FIRST or LAST word of
  exactly one key, then a whole word sitting INSIDE exactly one key ("Vanderbilt" in "the
  Vanderbilt family", which no first-or-last rule reaches). Ambiguity matches NOTHING — "the Wells
  family" beside "the Wells council" answers to neither, because guessing between two is worse
  than a new entry.
- READ AND FOUND SOUND on the same pass: the clock's minutes (clockMinutesOf returns null when
  never set, so nothing does arithmetic on a clock that does not exist), and the bodies ledger
  (no unguarded list push).
- 480/480 harness + 37/37 walk + 8/8 play. version.js -> m239-001.

# M240 — the auditor was auditing a ledger it could not see
- THE WRITER ASKED WHY THE AUDITOR NEVER CAUGHT THE STALE LOOSE ENDS THE HOUSEKEEPER KEPT FINDING.
  Two reasons, and one is absurd:
  · ITS CHECKLIST NAMED thread.close / thread.set — the STORY's plot threads. It was never once
    asked about the "Loose ends:" line on a PERSON'S own page, which is a different list entirely
    and the very one piling up. It is asked now, in its own section, told they are not the story
    threads, told to close one with people.unthread worded as it stands, and told why: a loose end
    left open is carried to the storyteller as something still hanging for the rest of the tale.
  · AND IT IS TOLD, IN ITS OWN BRIEF, TO CATCH "a wound healed still open" — while the word
    "bodies" appeared NOWHERE in auditor.js. The one reader asked to hold the WHOLE ledger against
    the pages was auditing a ledger it could not see. It is shown now, under "what their bodies
    carry".
- A law now walks every ledger and insists the auditor is shown it: the people pages, a person's
  loose ends, locked canon, who knows what, the factions, the bodies, the record, the pages
  themselves and the writer's brief. It cannot go blind to one of them again.
- 481/481 harness + 37/37 walk + 8/8 play. version.js -> m240-001.

# M241 — I told the auditor to use a tool that did not exist
- M240 ADDED "Close it with people.unthread" TO THE AUDITOR'S CHECKLIST AN HOUR AGO. There is no
  such mutation. Every finished loose end it dutifully found would have come back refused as an
  unknown type — an instruction with no tool to carry it out, which is worse than not asking, and
  exactly the kind of thing the writer has spent a day catching for me.
- AND THE TOOL ALREADY EXISTED. people.note {name, field:"thread"|"unthread", text} has closed one
  loose end since the housekeeper had a vocabulary. I started building people.unthread before
  noticing — a SECOND way to do what one mutation already did, which is M210's law (one button,
  one meaning) broken in the engine instead of the UI. The half-built duplicate is removed and the
  auditor points at people.note.
- Proven end to end: the auditor's wording ("she still has not finished her self introduction")
  closes the ledger's wording ("she has not finished her self-introduction") through
  sameLooseEnd — matched by SENSE, because no model repeats a line verbatim — and a loose end that
  is not there is refused.
- 481/481 harness + 37/37 walk + 8/8 play. version.js -> m241-001.

# M243 — a line that overran was stored cut, and only the writer could tell
- FIVE OF THE WRITER'S SIXTEEN RECORD LINES ENDED IN AN ELLIPSIS. A quarter of his record silently
  missing its tail — one severed mid-name ("and graded Jo…"), one at 3997 characters of a 4000 cap
  with twenty-eight phrases where the limit is eighteen. The only way to know was to read every
  line himself and count characters, and he asked, fairly, whether that is now his job.
  It is not. A line that overran is NOT A LINE. parseMemoryAnswer reports whether it had to cut;
  a fold that overran (cut, or past twenty phrases) asks the keeper ONCE more, telling it exactly
  what happened — how many phrases it wrote, what the limit is, which items to keep and which to
  drop, and that a complete short line beats a long one with its end missing. The shorter complete
  answer replaces the wreck. If the second ask stumbles too, the cut line stands, because a cut
  line still beats no line.
- This is the self-healing the writer asked for at the start and did not have: the house notices
  its own bad output and fixes it before the writer ever sees it.
- 482/482 harness + 37/37 walk + 8/8 play. version.js -> m243-001.

# M244 — "so I just accept it's cut?" — no
- M243 ENDED WITH "the cut line stands — a cut line still beats no line". The writer read that and
  asked whether he is meant to shrug at a quarter of his record losing its tail. He is right:
  accepting a cut line is still losing his story, and "better than nothing" is the excuse of a
  house that has run out of ideas.
- SIX PAGES THAT WILL NOT FIT IN ONE LINE ARE FOLDED AS THREE. A second overrun is not a keeper to
  be scolded again — it is a BATCH TOO BIG for one line. The fold halves the range for THAT fold
  only (the writer's own batch setting is untouched), writes a complete line over the first half,
  and sets the line's span to what it actually read, so the remainder is still due and folds on
  the next round. Nothing is lost and no page is skipped — proven across four rounds with a keeper
  that overruns every third call: spans 0-5, 6-11, 12-17, contiguous, not one line cut.
- The cut line now stands ONLY when even half the pages will not come back whole, which is a dead
  connection, not a long scene.
- 483/483 harness + 37/37 walk + 8/8 play. version.js -> m244-001.

# M245 — the same dial twice, and a branch of a branch of a branch
- THE HOUSEKEEPER'S THINKING DIAL WAS ON THE PAGE TWICE, two selects setting one setting. Not a
  duplicated block — an ASYNC RENDER RACE. The worker list is cleared ONCE and then every row
  AWAITS (the assignment map, the housekeeper's own setting). Two renders overlapping — and this
  panel re-renders on a good many things — both clear, both wait, and both append. A render that
  has been overtaken now stops, at every point it would otherwise append after an await, and takes
  its mark BEFORE the clear.
- AND A BRANCH OF A BRANCH GREW ITS OWN NAME: "Actually use this lol — a branch — a branch — a
  branch — a branch — a branch — a branch — a branch — a branch". The suffix was simply appended
  to whatever the title already was, so the writer's shelf — the one list he uses to find a story
  — filled with titles too long to read. The stem is taken once and the branches are numbered from
  there: "— a branch", "— a branch 2", "— a branch 3".
- 484/484 harness + 37/37 walk + 8/8 play. version.js -> m245-001.

# M246 — a line the WIRE cut was stored as a finished line
- THE WRITER ASKED WHETHER A SUMMARY ENDING WITH NO FULL STOP, NO QUESTION MARK, NOTHING AT ALL,
  IS NORMAL. It is the shape of a line the PROVIDER cut at its own token limit. A line the HOUSE
  cuts ends in an ellipsis and the house knows to ask again (M243, M244); a line the WIRE cuts
  simply STOPS, mid-clause, with no mark of any kind — and callKeeper kept only the text and threw
  finishReason AWAY. So it was stored as a finished line with its end missing and nothing, anywhere,
  to say so. Not to the writer, not to the audit, not to the storyteller that reads it every turn.
- callWorker has returned finishReason all along; callKeeper now keeps it, and 'length' is treated
  exactly as the house's own cut: ask again shorter, and if that is cut too, halve the batch. Five
  places handle a cut and all five handle this one.
- The writer found this by asking a question about punctuation. It would not have shown in any
  test, because a fake wire that never runs out of room never sets finishReason to 'length'.
- 485/485 harness + 37/37 walk + 8/8 play. version.js -> m246-001.

# M247 — a regression I shipped an hour earlier: a long line treated as a broken one
- THE WRITER'S REBUILD STOPPED AT PAGES 25–30 OF 98. M243 re-asked whenever a line ran past TWENTY
  phrases — but a rich scene legitimately does, and the writer's own good lines run to twenty-eight.
  So EVERY batch paid an extra keeper call, and then M244's halving cut it to THREE pages. Twice
  the calls for half the progress, on every single batch: a rebuild that looks like it stopped
  early because it is crawling.
- A LONG LINE IS NOT A BROKEN LINE. Only one that lost its end is. The re-ask and the halving fire
  on a cut alone now — the house's own (answerWasCut) or the wire's (keeperWasTruncated, M246).
  Measured on the writer's shelf with a keeper writing dense 24-phrase COMPLETE lines: 16/16,
  sixteen lines, every one a full six pages, 72 calls where it had been paying nearly twice that.
- The two fixtures that had covered M243 and M244 used a long-but-uncut answer, so they were
  testing the wrong trigger and went green on the regression. They exceed the cap properly now.
- 486/486 harness + 37/37 walk + 8/8 play. version.js -> m247-001.

# M248 — a mark the writer can read at a glance, and a house that finishes what it started
- A RUN THAT REACHED THE END AND ONE THAT GAVE UP AT BATCH 15 OF 16 READ THE SAME. "it went well",
  both of them — so a rebuild that stopped while the writer slept was indistinguishable from one
  that finished, and the only way to know was to read the record and count. A run is now a THIRD
  thing when it did real work and did not reach the end: UNFINISHED, carrying what it would take
  to carry on.
  The workers' line shows it: ● green finished, ◐ amber stopped partway, ○ stumbled — with a
  name for a screen reader, never colour alone — and an amber "Finish it" on any unfinished run.
- AND THE HOUSE FINISHES IT ITSELF, ON BY DEFAULT. autoFinish: when a long run reports itself
  unfinished the house waits and carries on from where it stopped, three attempts, backing off
  (15s, 30s, 45s), never on a story the writer has left, and forgetting its count the moment a run
  completes. Turn it off and the button is there instead. The writer asked for exactly this: "so
  everything autonomous and I know everything green".
- AND THE LAW FILE ITSELF WAS AUDITED. 58 laws, no duplicate names, but NINE read only source text
  — they would have passed with the feature dead. The two guarding self-healing now RUN it:
  M196 folds a real line and proves the LINE comes back rewritten when its addendum overflows
  (it failed twice while being written, both times a bad fixture, never the code); M221 runs a
  whole housekeeper turn against a model that fetches every round and proves the line is served
  WITH its detail, that it is told once there is no more fetching, and that the turn never comes
  back as a bare <fetch>. The other seven assert on CSS tokens and prompt wording — textual by
  nature, and each backed by a real browser proof or by arithmetic in the same test.
- 487/487 harness + 37/37 walk + 8/8 play + wipe + contrast + coat + the anchor differential.
  version.js -> m248-001.

# M249 — the world agent was told to use a record it was never given
- AFTER A TIME SKIP THE WRITER'S OWN SISTER CAME BACK WITH AN AGENDA OF GETTING HIS PHONE NUMBER.
  The world agent decides what the ABSENT are doing between scenes and what they want next. Its
  own brief says a person's life beyond the scene is "filled from the real record, not invented" —
  and the word `record` appeared NOWHERE ELSE in world.js. It was told to use something it was
  never given, so after a jump it filled a life from the ledger's bare facts and the last three
  pages, which on a hundred-page tale is nothing at all. The same fault as M226 (the extractor)
  and M240 (the auditor and the bodies): a worker instructed to read a thing that never reached it.
- The folded story rides now, placed BEFORE the ledger's facts so the story runs oldest to newest,
  cut to the lines older than the pages it can already see. What it could already see — the
  person's page, where they were left, what they were doing, what they wanted — is untouched.
- READ AND FOUND SOUND while there: the world agent DOES see an absent person's page, location,
  activity and agenda. Two earlier probes said otherwise and both were bad fixtures of mine, not
  the code.
- AND ON THE WRITER'S OTHER QUESTION: a record line ending with no full stop is not a cut. His
  Pages 55–60 measures 2,111 characters of a 4,000 cap and exactly 15 phrases of a 15 limit — it
  stopped on its own, on a complete clause. The format is semicolon-separated phrases and nothing
  requires a terminal mark; a line that genuinely WAS cut is caught and re-asked (M243, M246).
- 488/488 harness + 37/37 walk + 8/8 play. version.js -> m249-001.

# M250 — a worker failing quietly while the writer plays on
- THE WRITER ASKED WHAT HAPPENS IF HE KEEPS PLAYING WHILE A WORKER'S CONNECTION IS DOWN AND HE
  DOES NOT KNOW. The answer was: nothing tells him. A worker that stumbles is written to the
  workers' line in the LEDGER DRAWER and NOWHERE ELSE — not on the page, not in the chat, not on
  the receipt. So a keeper whose connection had fallen over could cost him four scenes of folding
  with no word of it, and he would find out only when he happened to open the ledger.
- The ledger button carries a quiet mark now — a small amber dot, no interruption — the moment any
  of the four minders that keep the story (keeper, extractor, scribe, world agent) has stumbled,
  and it drops the moment one succeeds. Its title says WHICH worker and that the pages are safe
  and will be folded when it comes back, because the writer's first fear is always that something
  was lost.
- WHAT HAPPENS WHEN IT COMES BACK, unchanged and worth writing down: dueRange always returns to
  the OLDEST hole, so nothing is skipped and the record never gains a gap in its middle; and the
  keeper folds BATCHES_PER_RUN (three) per page written, so a four-scene outage clears in a page
  or two of play — or at once with Summarize now.
- 488/488 harness + 38/38 walk + 8/8 play + contrast. version.js -> m250-001.

# M251 — the ledger had no way back
- THE WRITER ASKED THE RIGHT QUESTION: the RECORD self-heals after an outage — what about the
  scene, the people, the world? It did not. The record walks to its OLDEST hole on every fold
  (dueRange), so an outage costs it nothing. The LEDGER is per-turn: it reads THIS page and no
  other, and nothing anywhere went back for a page it had missed. "Read the pages again" reads
  only the LAST page. So four scenes played through a broken connection lost every state change in
  them — who came in, who left, what was locked, what was hurt — permanently, while the record
  recovered perfectly beside it, which is what made the loss invisible.
- state.page only ever advances when the read SUCCEEDS (it is set after the throw), so it is an
  honest mark of how far the ledger has got. Any assistant page past it and before the one in hand
  was never read: the OLDEST is read first, one per turn, before the page in hand — so the ledger
  closes its gap while the writer plays on, exactly as the record does. A catch-up that stumbles
  costs nothing: the page in hand is still read.
- 489/489 harness + 38/38 walk + 8/8 play + wipe. version.js -> m251-001.

# M252 — the workers' line was in the wrong order
- THE WRITER PRESSED REBUILD THE PEOPLE, WENT LOOKING FOR THE GREEN MARK, AND FOUND "18 hours ago"
  AT THE TOP. The line was drawn in a FIXED worker order (WORKER_NAMES), so a run from yesterday
  sat above one from a moment ago and there was no way to tell which end was the latest. His own
  rebuild — "the scribe ran just now … read 118 of 118 pages, 193 changes" — was THIRD FROM THE
  BOTTOM of a list of ten. A mark nobody can find is a mark that does not exist (M220's lesson,
  in a second place).
  Newest first now, and the heading says so.
- AND A RUN WITH AN EMPTY ANSWER DREW A "what it said" FOLD ONTO AN EMPTY BOX — four times over in
  the writer's own panel. A fold is drawn only when there is something to read.
- 490/490 harness + 38/38 walk + 8/8 play. version.js -> m252-001.

# M253 — the closing audit: two of this session's own fixes were dead
- THE LEDGER'S SELF-HEAL HEALED EXACTLY ONE PAGE. M251's catch-up read the oldest missed page and
  marked it — and then the ordinary read stamped the mark with the index of the page IN HAND,
  claiming every page between them had been read when none had. So the gap vanished from the mark
  and stayed in the ledger, which is WORSE than not healing: the writer would have been told his
  four lost scenes were read. state.page means "every page up to here has been read"; reading the
  page in hand only extends that when it is the very next one. Measured: four scenes lost, then
  playing on — read up to 0, 1, 2, 3, 4, 5, closing one page a turn instead of being abandoned.
- AND THE WHOLE OF M248 WAS DEAD ON ARRIVAL. noteWorkerRun stored `unfinished` and `resume`
  faithfully; loadWorkerStatus rebuilds each row from a FIXED LIST OF FIELDS and did not name
  them. So every row came back with unfinished undefined: the amber mark could never appear and
  "Finish it" could never be offered. Its law passed throughout, because the law READ THE SOURCE
  instead of the round trip — the same fault as M196 and M221, in a fix written the same day.
  Both laws ride the round trip now.
- 490/490 harness + 38/38 walk + 8/8 play + wipe + two-browser + append + guard + contrast + coat
  + the anchor differential. version.js -> m253-001.

# M254 — a green light that means something, and a third coat
- THE WRITER ASKED FOR GREEN AS REASSURANCE HE CAN TRUST: "it's absolutely confirmation everything
  is perfect, I don't need to worry and just continue the story." So it is NOT "no errors seen
  lately". Green burns only when ALL of these hold, checked fresh on every redraw:
    · every minder that has run, ran WELL (keeper, extractor, scribe, world agent)
    · none of them stopped partway
    · the LEDGER has read every page told — no gap behind state.page
    · the RECORD has nothing due — no page past the word-for-word window without a line
  And if any of it cannot be checked, it is NOT green. A light that lies once is worse than none.
  Amber for a stumble or a run that stopped partway; nothing at all on a story with no history yet.
- THE LAMP. Both marks are lit like a lamp — a radial face and a corona — not a flat dot. The
  amber one BREATHES so a glance catches it; the green one is STEADY, because a light that
  flickers is asking for attention and this one is saying the opposite. Stillness is honoured for
  prefers-reduced-motion.
- THE DEEP — a third coat, in the register the writer asked for: a near-black room, prose lit teal,
  ember kept for the things that act. Every colour token the other coats define is defined here,
  the 🎨 display pack included — a coat that leaves the pack out inherits lamplight's near-black
  cards into a teal room, which is the very fault M167 fixed for daylight. Held to the same law in
  a real browser: tests/contrast.py now walks dark, light AND deep — 0 surfaces under AA, worst
  5.61:1.
- AND TWO LAWS COUNTED THE COATS AS EXACTLY TWO, so a third broke them for no reason. Both are
  coat-aware now: every coat must name the ink on its own ember exactly once, and every coat must
  name the spoken and thought colours.
- 491/491 harness + 38/38 walk + 8/8 play + wipe + contrast (three coats) + coat. version.js -> m254-001.

# M255 — the light was computed at the wrong moment, and there were only two of them
- THE WRITER SENT TWO SCENES, WAITED TEN MINUTES, AND SAW GREEN ONLY AFTER RELOADING THE BROWSER.
  markLedgerTrouble was called from renderThread — which runs BEFORE the background chain has
  finished — so the light showed the world as it stood a second after sending, and nothing ever
  looked again. status.js has broadcast every start and settle all along (onWorkerChange); the
  light simply never listened. It does now, so it follows the WORK rather than the redraw.
- AND THERE WAS NO LIGHT FOR "READING NOW". Green went dark the moment a scene was sent and stayed
  dark with nothing to say whether the house was thinking or had forgotten. A third light: BLUE
  while any minder is reading or waiting its turn. It pulses more plainly than the amber, because
  it means WAIT, not LOOK.
- THE WRITER'S OWN QUESTION — when does green go out and come back? Green is never lit while the
  house is at work, so: send a scene, it turns BLUE at once; when every minder has settled it
  turns GREEN (all read, all folded, nothing due) or AMBER (something stumbled or stopped
  partway). A stumble that lands while another worker is still reading shows BLUE until they are
  all done, then AMBER — wait first, look after.
- 491/491 harness + 39/39 walk + 8/8 play + contrast (three coats). version.js -> m255-001.

# M256 — the auditor was doing a job nobody else could
- THE WRITER READ HIS OWN AUDIT REPORT AND ASKED THE RIGHT QUESTION: can the ledger be improved so
  the auditor is not needed to fix the same things over and over? All five of that turn's findings
  were one fault — "no knowledge line for Claire Stone, who plainly witnessed…", the same for
  Alaric, the ground moved to the Wells gate and was not written, Jovan reached the gate and his
  position was not updated.
- knowledge.add APPEARED NOWHERE IN extractor.js. The world agent has it — but the world agent is
  about the ABSENT. So a thing witnessed by someone standing right there in the room was written
  down by NOBODY, and the auditor picked it up three turns later, one person at a time, forever.
  The worker READING THE PAGE has it now, with the bar written plainly: only what this page put in
  front of them, and only where being told, or not told, could change what they do.
- AND THE FOUR IT MOST OFTEN MISSED are named in its closing checks, each one taken from the
  writer's own report: the ground moved; someone present moved within it; someone learned
  something; what the page answered. A FOUNDING read is left alone — it is writing the world, not
  catching up.
- 492/492 harness + 39/39 walk + 8/8 play. version.js -> m256-001.

# M257 — a name cut short, and a person in two places
- FROM THE WRITER'S AUDIT AT TURN 69, thirteen fixes and two real faults beneath them:
  · "Vanessa Rey" SAT BESIDE "Vanessa Reynolds" — a second page, a second seat, her own duplicate
    "now" line. A truncation falls between every rule there was: spelling distance is five
    characters, too far for the near-name rule; and "Vanessa Rey" is not the first or last WORD of
    "Vanessa Reynolds", it is one and a half of them. A name that shares its whole first word and
    runs on into the next is that name cut short. Both ways, one match only, never for a single
    word — Mira and Miranda stay two people, and two names that both continue "Vanessa Reyn" match
    neither.
  · MI-NA AND VANESSA WERE IN THE KITCHEN AND ON THE ROAD TO IT AT ONCE, "overdue by about 2
    minutes", and the auditor cleared them by hand every few turns. presence.enter has always
    cleared a seat; nothing stopped a seat being WRITTEN for someone standing in the room. A guard
    at that door now refuses it, in every form of her name.
- AND A SEAT IS NOT A PAGE. Reaching for one matcher, the guard first used findPersonKey — which
  also merges near SPELLINGS, right for a character page and WRONG for a seat: it made "Person2"
  the same seat as "Person1", one letter apart, and six DOM laws caught it at once. Seating
  resolves only a name that is plainly the SAME name — a first name, a surname, one cut short —
  never a near miss. One person still cannot take two seats.
- 493/493 harness + 39/39 walk + 8/8 play + wipe. version.js -> m257-001.

# M258 — the writer counted: thirteen fixes, and I had explained two
- HE WAS RIGHT. The turn-69 audit held FIVE distinct faults, not two:
  1. the absent seats not cleared (M257)
  2. "Vanessa Rey" beside "Vanessa Reynolds" (M257)
  3. THREE THREADS THE PAGE HAD RESOLVED, still burning — thread.close appeared NOWHERE in
     extractor.js, exactly as knowledge.add had not (M256). The world agent has it, and the world
     agent is about the ABSENT. So a question answered, a plan abandoned, a promise kept ON THIS
     PAGE could be closed by nobody: Chloe's clip abandoned, Aurora's message delivered, Caleb's
     frame posted — every one read to the storyteller every turn as something still hanging.
     FIXED: the extractor has thread.close, and is shown the open threads it might close.
  4. three knowledge lines missing — fixed the turn before at M256.
  5. SEVEN STANDINGS "missing from the record". NOT a bug: only the auditor seeds a standing from
     the brief, and the writer's brief carries its digits INSIDE PROSE SENTENCES ("Caleb is Rias's
     ex-boyfriend … (P:20 R:5 S:5)"), which the pure parser cannot read — it takes a name only
     where the name heads its own line. The auditor reads them with a MODEL, which is why it can.
     So they are restored on its next sweep, up to three turns after a person is first met. Making
     it sooner means a model call on first appearance; recorded here rather than rushed.
- THE PATTERN WORTH CARRYING: three times now a worker has been asked to do something it had no
  tool for — the auditor and the bodies (M240), the extractor and knowledge.add (M256), the
  extractor and thread.close (M258). When a report keeps naming the same omission, look first for
  the missing VERB, not the careless model.
- 494/494 harness + 39/39 walk + 8/8 play. version.js -> m258-001.

# M259 — the ledger bulletproof: every reader sees ALL of it, and reads every page to its end
- THE WRITER'S ORDER: the ledger tracks the whole moving world on its own; the auditor sees the
  WHOLE ledger and every page the record has not folded; the auditor is the last line, for a rare
  slip — never the same finding every turn. He asked for an audit instead of another round of
  pasted reports. What it found:
  1. EVERY READER WAS SHOWN THE STORYTELLER'S TRIMMED LEDGER (renderStateFacts: the six strongest
     standings, five threads, four facts a person knows, six seats, four factions, sections shed
     when long, and NO LINE FOR THE GROUND). Measured on thirteen standings, eight threads and nine
     facts, the auditor saw six, five and four. It reported the rest missing, re-added a fact in
     new words (a duplicate that pushed another fact out of view), "restored" a standing the pages
     had lowered — and found the same things again the next turn. FIXED: engine/whole.js
     renderWholeLedger, every book and nothing shed, for the auditor, the extractor and the
     founder; the world agent gets every thread, knowledge line and faction; the storyteller's own
     copy names the ground.
  2. NO PAGE WAS READ TO ITS END. The extractor, world agent, scribe and second reader cut a page
     at 8,000 characters, the auditor at 5,000, the keeper at 6,000 a page and 24,000 a batch (on
     a larger batch the LAST pages were never folded at all), the rebuilds at 4,000/5,000, the
     director at 3,000 — every one from the FRONT, and the end of a page is where the scene
     stands. FIXED: engine/pagecut.js wholePage — a page is read whole; one past its cap loses its
     MIDDLE, never its end; a keeper batch shares 120,000 characters.
  3. THE AUDITOR READ THE LAST TEN PAGES AND A RECORD TRIMMED TO 30,000. With a window of twenty
     or thirty, the pages between the record's end and the last ten were read by nobody, and a
     long tale's oldest lines fell off. FIXED: it reads every page the record has not folded
     (never fewer than 10, never more than 40, newest first into the connection's room, each to
     its end) and the whole record (to 120,000). The brief, its first authority, was cut at
     4,000: now 40,000.
  4. THE RECORD NEVER REACHED THE EXTRACTOR OR THE WORLD AGENT. chat.js handed it over (M226,
     M249); extractTurn and worldTurn dropped it on arrival — and their laws read chat.js for the
     words "record: foldedBefore" and passed. FIXED, and those laws now make the call.
  5. A FINISHED LOOSE END THE AUDITOR CLOSED WAS THROWN AWAY: its scope's forbidden list named
     people.note, so the M240/M241 close never landed and the finding vanished from the report.
     FIXED: the scope is an ALLOW-list (AUDITOR_TYPES). people.note passes only as unthread; the
     moment (mood, position, dress, how far a beat moved a standing, time passing, weariness) is
     dropped; so is a presence.enter for someone already here, which is a move.
  6. "SET RIGHT" MEANT "WROTE A CHANGE", NOT "THE CHANGE HELD". A thread closed under reworded
     words was refused, stayed open, and read "Set right". FIXED: the report counts what LANDED
     (auditLineWords); a refused change reads "Seen; its change did not hold (why)"; a finding
     whose every change the ledger already held is not reported. Threads are found by SENSE:
     every telling word of the shorter title in the longer, a title of names alone only as the
     very same names, and exactly one thread answering or none. The run words never hide the
     house's own changes behind "true to the story".
  7. THE AUDITOR COULD UNDO THE STORY: it could raise a standing the pages had lowered, and set
     the ground and hour against the header. FIXED: it restores only a ZERO standing; it may bring
     the ground and hour only TO what the latest header line says.
  8. A CHANGE THAT CHANGED NOTHING WAS WRITTEN: the header re-sends its place every page, and the
     same hour, position, standing, lock, main character or presence was logged or refused.
     FIXED: each is `same` — nothing written or journaled, never counted as a refusal. "X comes in
     at a new spot" for someone already here is written as the move it is.
  9. THE SCRIBE'S BUDGET WAS 600 TOKENS, and a cut or think-aloud answer read as "nothing
     shifted"; the second reader, the referee and the director's watcher took the first brace
     strictly. FIXED: 2,400; the tolerant parse everywhere (parseFirstObject too); the scribe asks
     once more when an answer is cut — by the wire's word or visibly — and says what it did.
  10. THE MENDER WAS SHOWN 6,000 CHARACTERS AND ASKED FOR "THE COMPLETE PAGE": a page a little
     longer came back without its ending, passed the size check, and was SAVED. FIXED: it sees the
     whole page and answers with EDITS (find → replace, each find standing exactly once in its
     page); a whole-page answer still lands for a short page; a mend that drops a sixth of a page,
     or its closing lines, is refused.
  11. THE LEASH NEVER REACHED THE CHAIN. The page chain's wrapper passed {signal, stale} only, so
     the keeper shared ONE minute across up to nine calls (M213's renew never arrived), and the
     auditor could not ask for time to read the whole ledger. FIXED: queue.js chainJob hands the
     renew on; the extractor, world agent and scribe renew before every call; the auditor asks for
     a minute plus a second per 4,000 characters it reads (auditLeashMs), and its prompt puts the
     brief, the record and the older pages FIRST and the ledger last, so a house can reuse what it
     already read.
- M258 WAS WRONG about "seven standings missing": the founder already reads the brief's standings
  with a model. The auditor had been shown six standings of thirteen, and reported the rest.
- THE PATTERN: a reader told to hold X was shown a trimmed X, or handed X by its caller and never
  given it. Before blaming the model, print what the worker is actually sent.
- Laws: tests/harness/m259.mjs — 17, each driving real calls through a scripted wire and reading
  back what was sent or written; 45 deliberate breaks, each caught by its own law. Laws that read
  source text now run the feature (M226, M249, M51, M131); laws that held the old behaviour say
  why they changed (M47-2 the mood, M48-1 the shift, M178 the fixture, M41-2 the brief, M72-9 the
  wrapper, DOM-10 "wrote 1 change").
- THE LONG PLAY NEVER ENDED: the page's timers kept its process alive after the last law (the
  m258 commit does the same), so a script waiting on it never heard the result. It ends with the
  run's own code now, as the walk does.
- 511/511 harness + 39/39 walk + 8/8 play + the two-browser proof (11/11). version.js -> m259-001.

# M260 — a worker that can look: no reader is cut off by a number
- THE WRITER ASKED why a worker is cut off at a fixed count of characters when the housekeeper
  simply asks for what it needs. There is no good reason: a limit decides ahead of time what a
  reader may never see. So the auditor, the extractor and the world agent LOOK now, in the
  housekeeper's own words (<fetch>[…]</fetch>), through the housekeeper's own server
  (serveFetch) — one way to look for everyone who reads the story (agents/lookup.js
  askWithFetch):
  - any page whole, by its number (1-based among the pages not hidden, as the index counts them)
    or its #code — a folded page too;
  - "find: WORDS" — every page that holds them, newest first, by number (never a hidden page);
  - "brief" / "cast" — the writer's own words, whole.
  The housekeeper gained the same two, so the same words mean the same thing everywhere.
- THE AUDITOR'S VIEW FITS; THE REST IS ASKED FOR. The newest pages whole into 100,000 characters
  (the present page always, to its end); the other unfolded pages as index lines ("p12 #code —
  preview"); every record line names the pages it covers ("[pages 13–18]") so it can be checked
  against them; a brief or cast notes past their view, and a shortened page, say so and how to get
  the rest. A reading that had to hold forty long pages every turn was slow and dear, and a model
  reads a haystack less carefully than a page it chose.
- The extractor and the world agent are told the number of the page they read, their earlier
  pages carry their numbers, and they look only when the page leans on something they were not
  shown (two looks; one on a second ask).
- A READING IS NEVER SPENT ON LOOKING (M221's law, for the workers too): three looks, then the
  worker is told once to answer; an unreadable fetch block is answered once with how to ask; a
  final answer is never held up by a stray fetch; a look that would overflow the reader's room
  names what it could not serve. Every call gets its own leash, the auditor's scaled to what it
  holds; the workers line says what the auditor looked at.
- FOUND ON THE WAY: a connection whose room was already spent turned the page budget NEGATIVE, and
  a negative budget read as "no limit" — every page, exactly when there was no room. It is the
  present page alone now.
- Laws: M259-18..20 (the auditor, the extractor and the world agent looking through a scripted
  wire; the shared server; the room; the spent budget) and DOM-21 (the real page chain: an
  extractor that asks for page 1 by its number is served it whole from the tale); 15 deliberate
  breaks, each caught. M221's "the auditor never fetches" and M74-6's signature grep follow the
  new design.
- 514/514 harness + 40/40 walk + 8/8 play + the two-browser proof (11/11). version.js -> m260-001.

# M261 — one story so far for every ledger reader, and a ledger that does not go stale
- THE WORDS, because the writer asked for them to be straight: FOLDED pages are the older ones
  the keeper has summarized into the record — still in the chat, never hidden; UNFOLDED pages are
  the newest, which the storyteller reads word for word; HIDDEN is a separate flag (the house's
  own "continue" nudges, pages hidden in SillyTavern before import) and every reader skips it.
- THE WRITER'S ORDER: quality, not cost. So the extractor, the world agent and the auditor read
  ONE story so far (memory.js storySoFar): every unfolded page whole, newest first, into 70% of
  the connection's room (lookup.js windowOfPages, viewBudget); the record for the folded pages;
  the whole brief; the whole ledger; and the other 30% kept free for looking. The extractor saw
  the pages before its page only on a founding or deep read — on every other page it did not
  know who "she" was. The auditor's M260 budget of 100,000 characters is gone: it reads every
  unfolded page that fits.
  - A VIEW LEAVES ROOM TO LOOK (found building it): a view that filled the whole room left
    nothing for the pages then asked for — the first was served, the rest refused.
  - The story so far is labelled ALREADY READ, NOT NEWS; only the new page is reported on.
  - A BEAT IS COUNTED ONCE (apply.js sameBeat): with old pages in view, a beat sent again from one
    of them would move a standing twice. The same beat — same words in any order, or nearly all
    of them — on the same axis and the same way, within the last six causes, is `same`. A
    different figure ("20 dollars" / "50 dollars") or the other direction is a new beat.
  - The scribe and the second reader still read the new page alone: they judge only it.
- THE HOUSEKEEPER was shown the storyteller's trimmed ledger while asked to keep it true: it sees
  the whole ledger now. Its own pages setting (4–40 whole, default 12) is the writer's.
- STALENESS, BOOK BY BOOK — what went stale with nothing to clear it:
  1. WHERE EACH STOOD: "by the stove" was read to the storyteller after the scene moved to the
     garden. The ground moving lets every position go (dress stays); the page's reader writes
     the new ones in the same batch; a take-back restores them key for key.
  2. ONE PLACE, TWO SPELLINGS: "The Wells Residence" / "Wells Residence" read as a move — and
     would have cleared the positions every page. samePlace ignores case, a leading "the" and
     punctuation.
  3. THREADS NEVER COOLED: a thread no page closed stayed hot, read as live every turn, until
     eight newer ones pushed it out — the auditor closed them by hand, page after page. Untouched
     for THREAD_COOL_PAGES (15) pages, a thread goes cold in the page chain itself (never one
     the page moves) — engine/world.js threadHousekeeping.
  4. THE UPKEEP WAITED FOR THE AUDITOR: retiring those who passed through, sweeping the house's
     example names, clearing seats nothing carries — all code, all run only inside an audit. An
     auditor switched off, or reading every fifth page, meant a ledger nobody kept.
     auditor.js ledgerUpkeep runs on every page the auditor does not read, journaled, quiet on
     the workers line.
  What code cannot see — a person who left without the page saying so — stays the readers'
  (the extractor first, the auditor behind it).
- THE WALK'S OWN SCRIPTED READERS read their prompt as if it held only the new page (the first
  "PersonN entered" in it) — with the story so far in view they read page one every time, and six
  scenarios fell. They read the new page now (newPageOf), as the real reader is told to.
- Laws: M259-21..23; M226/M228 run storySoFar instead of reading chat.js; DOM-21 proves in the
  real chain that both readers get the story so far, that a thread nobody carried cooled, and that
  with the auditor switched off one who passed through was still retired and no audit was asked
  for. 16 deliberate breaks this round, each caught; one crash-killed break run left a break in
  apply.js, found by checking every break site, restored, and the runner made crash-safe.
- The two wiring points in chat.js (the upkeep on an unread page, the thread cooling) were each
  removed in a throwaway copy and the walk run: DOM-21 failed on exactly that line both times.
- 517/517 harness + 40/40 walk + 8/8 play + the two-browser proof (11/11). version.js -> m261-001.

# M262 — the house heals what the old readers left
- THE WRITER ASKED: his story began before M259; should he play on, or press Rebuild? He wants
  a house that heals itself while he plays. So the harm the old readers left is found and
  mended with no hand on it:
  - WHAT ALREADY HEALS AS HE PLAYS: knowledge written twice folds on load (M92); a thread nobody
    carried cools on the next page (M261); positions go on the next move; the upkeep runs every
    page; the auditor, now shown everything, sets right a wrong name, a missing fact, a finished
    thread, page by page.
  - WHAT PLAY ALONE COULD NEVER MEND, now mended by the page chain itself:
    1. RECORD LINES THE OLD KEEPER READ IN PART (a page past 6,000 characters, a batch past
       24,000 — memory.js partlyReadLines): read again from whole pages, two a page (redoLine),
       each line swapped whole so the record is never missing one; a new or re-read line is
       marked whole and never read again; a line that fails three times is left as it is.
       A line already merged into a higher layer has no pages of its own — only "Rebuild the
       record" re-reads those.
    2. STANDINGS THE OLD AUDITOR PUSHED BACK TO THE BRIEF (it was shown six of thirteen and
       "restored" the rest, over what the pages had earned, every page — rebuild.js
       oldAuditorRaised: a "set — the brief says" after a page-earned beat): the story's people
       and standings are read again from the pages, ONCE (healedGen), with the take-back kept.
  - THE REBUILD NO LONGER EMPTIES THE LEDGER WHILE IT READS: it let the people and standings go
    and saved that before reading the first page — for the length of a rebuild the storyteller
    wrote with half-empty standings, and a run cut short left them half built. It builds on the
    side now and swaps the people and standings in whole at the end; a run cut short changes
    nothing; a hand edit made meanwhile is kept; the log says what happened.
- Laws: M259-24 (lines read in part found, re-read whole, marked; new folds marked), M259-25 (the
  mark found, healed once; the live ledger untouched while it reads; a cut run changes nothing;
  the way back never overwritten), DOM-22 (in the real chain: both heals, no hand on them). 8
  deliberate breaks, each caught. M165's grep follows the swap.
- 519/519 harness + 41/41 walk + 8/8 play. version.js -> m262-001.

# M263 — the writer's own words stand, and squeezed lines heal too
- THE WRITER ASKED what two of M262's limits meant. Both were gaps; both are closed.
- WHAT THE WRITER WROTE STANDS. A re-reading of the pages (the one-time heal, or Rebuild the
  people) replaced every page and standing — the writer's own words among them. What he writes by
  hand (the drawer's forms, and a housekeeper card he lets land) is marked his, field by field
  (people.set / people.note → hand.core, hand.threads…; rel.set / rel.shift → hand), and
  rebuild.js keepWritersOwn keeps it over the re-reading: his fields, his loose ends first, the
  standings he set. A reader writing the same field later takes the mark off that field — the
  field is the story's again.
- SQUEEZED LINES. A layer past NOTES_PER_LAYER (100 lines, about six hundred folded pages)
  squeezes its oldest two lines into one, written from the lines — so over pages the old keeper
  read in part, a squeezed line holds what they missed, with no pages of its own to redo.
  memory.js partlyReadMerged finds it; rereadMergedLine reads its pages again a batch at a time
  and puts first-layer lines, read whole, in its place in one swap; one a page, when no
  first-layer line waits. A squeeze of whole lines is whole. (A tale of a hundred-odd pages has
  never squeezed — every line it holds is a first-layer line, healed by M262.)
- ON THE WAY: M178 needed two log rows in the same millisecond and hoped for it; a slow run put
  them a millisecond apart. The clock is held still for that step now.
- Laws: M259-26 (a squeezed line found, re-read, swapped; a real 101-line layer squeezes whole),
  M259-27 (the mark field by field; a reader takes it off; a rebuild keeps his words, loose ends
  and standings; a housekeeper card is his), DOM-22 (a page written in the drawer's form stands
  through the heal). 10 deliberate breaks caught; the drawer's own mark removed in a throwaway
  copy fails DOM-22.
- 521/521 harness (three runs) + 41/41 walk + 8/8 play. version.js -> m263-001.

# M264 — the writer chooses when the record squeezes, and the record rides in the room his context leaves
- THE WRITER ASKED whether the squeezing has a setting — in SillyTavern he keeps Summaryception's
  "Max Snippets per Layer" at infinity (a 300k context, rarely past 140k). It had none: a layer
  squeezed past 100 lines, fixed. And the look behind it found the limit that mattered more: the
  record rode to the storyteller in a FIXED 30,000 characters, whatever the context — past that,
  the oldest lines were let go (not squeezed: gone from the storyteller's view) with most of a
  300k room unused. So "never squeeze" alone would have traded a squeeze for a loss.
- THE ROOM (memory.js recordRoom): what the storyteller's context leaves after the word-for-word
  pages, the answer (maxTokens) and a 40,000-token reserve for the rules and the ledger — never
  less than the old 30,000. The send path renders the record into it; the keeper measures the same
  room (chat.js recordRoomFor).
- THE CHOICE (Settings → the memory keeper, "When the record's oldest lines are squeezed into one
  (Summaryception's "Max Snippets per Layer")", setting memorySqueeze, memory.js cleanSqueeze):
  - Only when the whole record would no longer fit the storyteller's room — the house's way now
    (auto): on a big context, never;
  - Never — every line stays as written (0 means never, as in Summaryception);
  - When a layer passes a number of lines — the old way (the house used 100).
  The record rebuild and the catch-up are handed the same room.
- Laws: M259-28 (the choices; the room; the record rides whole in a big room; a real layer of 101
  lines under each choice), DOM-23 (the choice saved from Settings; a record past 30,000
  characters reaches the storyteller whole). M34-5 and M259-26 test the by-number way and say so.
  5 deliberate breaks caught; the send path's room removed in a throwaway copy fails DOM-23.
- 522/522 harness + 42/42 walk + 8/8 play. version.js -> m264-001.

# M265 — NO SILENT CUT: every reader of the record gets it whole in its room
- THE WRITER, on M264's finding (the storyteller shown only 30,000 characters of the record,
  the oldest lines dropped out of its view, silently, for many versions): "how did nobody find
  this?" Because no test ever built a record that long (the ninety-turn play folds ~15 lines),
  the only sign was a note INSIDE the storyteller's prompt, and nothing ever held what a reader
  was sent against the record as stored. Nothing was deleted — the lines were all kept; they were
  left out of what was sent.
- THE SAME FAULT, EVERYWHERE IT STOOD (found by sweeping every reader of the record):
  1. the extractor and the world agent (the story so far): the newest 14,000 characters —
     recordFor's fixed CONTEXT_CAP, cut MID-LINE;
  2. the world agent, a second time: that cut again to its FIRST 12,000 — the newest lines lost;
  3. the keeper writing a new line (its prior context), its verifier, its detail auditor, the
     squeeze and both re-reads: the same 14,000 — while Summaryception hands its summarizer every
     line of every layer;
  4. the mender: 30,000; 5. the standings rebuild: 60,000; 6. the people rebuild: lines without
     their details.
  FIXED: recordFor takes the caller's room and cuts WHOLE lines only, oldest first, with a line
  saying how many ("N earlier lines not shown — no room"), counted inside the room it speaks of.
  The keeper is shown as much as its own room holds (keeperRecordCap, never under 14,000); the
  story so far, the mender and the standings rebuild read the record in their connection's room
  (engine/pagecut.js roomChars, one measure for everyone); the people rebuild reads the lines
  before each batch with their details (recordLinesBefore).
- A FULL ROOM IS SAID OUT LOUD: when the storyteller's room cannot hold the whole record
  (squeezing set to never, or a small context), the writer is told, once a session for each tale,
  how many of the oldest lines were left out and how to fold them in instead.
- Laws: M259-29 (NO SILENT CUT — every reader: whole with room; whole lines and a note without;
  the keeper, the story so far, the world agent, the standings rebuild), DOM-14b (the mender reads
  a record past 30,000 whole, in the real chain), DOM-23 (a full room is said out loud). 5
  deliberate breaks caught; the mender's old cap and the silenced warning, each in a throwaway
  copy, fail DOM-14b and DOM-23.
- 523/523 harness + 42/42 walk + 8/8 play. version.js -> m265-001.

# M266 — every note in the ledger is kept whole, and the storyteller is shown the whole state of things
- THE WRITER found Caleb Thorne's "Now:" line ending "…and privately…" and asked whether it
  was the record's fault again. It was its twin: every ledger field was SAVED through a small
  cap (a person's nature 300, now 240, arc 240, a loose end 140; a fact 200; a seat's doing 140;
  a lock 140; a next step 200; a faction's agenda 140; a wound 140; a cause 200 …), cut on a word
  with "…", the rest gone for good. The caps were for the storyteller's small state block; they
  cut at the door instead.
- FIXED: every field is saved whole; the caps are guards against a runaway answer (4,000 for a
  page's fields, 1,000 for the rest) and nothing an honest note reaches. A storyteller card past
  its room sheds WHOLE lines (loose ends first, then how things stand), never a word.
- THE STATE OF THINGS FOLLOWS THE ROOM (state.js stateView): it was built for 4,000 characters —
  six standings, five threads, four facts a person knows, six seats, four factions. With the
  connection's room it takes a tenth of the context (up to 60,000) and, past 16,000, shows every
  item. A small or unknown room keeps the compact view.
- HEALED ONCE: a person's page carrying a cut the old caps made (not the writer's own) is read
  again from the pages with the people re-read (HEAL_GEN 266, oldCutNotes).
- Laws: M259-30 (every field whole — a real Caleb line; a card sheds whole lines; the old cuts
  found, healed once, never over the writer's words), M259-31 (the whole state of things, and the
  storyteller's request carries it). M236, M166 and M85-6 test the guards at their new sizes and
  say so. 9 deliberate breaks caught.
- 525/525 harness + 42/42 walk + 8/8 play. version.js -> m266-001.

# M267 — the report says only what is wrong; the second reader never sees the moment
- THE WRITER pasted a drawer that looked like fourteen mistakes under a green light. The light
  is the workers' health (every worker that ran, ran well), not "the story has no findings".
  Of the auditor's fourteen lines, three changed anything; the rest were the auditor listing
  checks that found nothing ("the thread stands as written", "the locks match the brief").
- FIXED, each found in that report:
  1. A CHECK THAT FOUND NOTHING IS NOT A FINDING: the law says so; a line with no change that says
     all is well of itself (saysAllIsWell) is dropped, and the run words count only real ones.
  2. FINDINGS WHOLE: the auditor's what/fix were cut at 300 ("the latest page has Jovan, Mi-");
     the keeper's verifier issues too; a retired person's old nature at 80 in the drawer.
  3. THE SECOND READER NEVER SEES THE MOMENT: told that posture and footwear are the story moving,
     it reported them anyway and the mender wrote the page back to the ledger's older moment
     ("Rias's arms are uncrossed"). It is shown who is here by name, where the absent are, and
     what is locked — never positions, dress or the mood.
  4. A SUMMARY'S ERROR IS THE SUMMARY'S: "Snippet says Jovan is sixteen, but the passage says
     seventeen" came labelled "source" and sent the mender to the pages. An issue that says the
     snippet is wrong goes to the snippet, whatever its label (snippetIsWrong).
  5. THE WHOLE BRIEF, EVERYWHERE: the second reader had its first 4,000 characters; the standings
     rebuild 12,000; the founder 12,000 (and its standings reader 14,000); card descriptions
     3,000, personality and scenario 1,200; the lore shelf 12,000; the extractor and the world
     agent 12,000. Each reads up to 40,000 now (cast notes 20,000).
- Not the ledger's: "Drifted" lines are the house's eye catching the storyteller's own style slips
  (asterisks, bold, dead phrases), recoloured on the next page.
- Laws: M259-32; M85's second-reader check follows. 5 deliberate breaks caught.
- 526/526 harness + 42/42 walk + 8/8 play. version.js -> m267-001.

# M268 — the brief outranks a page; a mend that should never have been is put back by the house
- THE WRITER: "Jovan is 16, not 17 — it's in the brief." M267's answer had told him the
  "Jovan is seventeen" mend was harmless, from the mend's own words, without reading the brief.
  It was not: a storyteller page slipped to "seventeen"; the record line said sixteen (right);
  the keeper's checker — handed the record's lines and nothing else — believed the page, and the
  mender was sent to make pages say seventeen. Summaryception hands its checker the NOTEPAD (the
  starting canon) before the story so far; the port had dropped it. And M267's own routing
  (a "snippet says…" finding goes to the snippet) would have rewritten the correct line.
- FIXED:
  1. THE CHECKER HOLDS THE BRIEF ABOVE EVERY PAGE (memory.js canonRecord, BRIEF_OUTRANKS): the
     writer's brief and the locked truths lead its record, and it is told a page against them
     is the page's error, with the brief's truth as the fix.
  2. A LABEL AND A SENTENCE THAT DISAGREE ACT ON NOTHING: "source" with a "snippet says…"
     sentence is 'unsure' — no page mended, no line rewritten.
  3. A MEND THAT SHOULD NEVER HAVE BEEN IS PUT BACK (putBackMistakenMends): every page the chain
     reads, a mend whose reason says the snippet was wrong gets the storyteller's own words back,
     its record line let go to be folded again, and the writer is told. The mend's reason is kept
     whole (it was cut at 300).
  4. THE REPORT LEAVES OUT "→ no change": a line whose fix is "no change", or that calls itself
     "the moment, not mine to report" / "omits no one", is dropped.
- Laws: M259-32 (follows), M259-33 (the checker's record; a confused finding acts on nothing; the
  no-change lines), M259-34 (the put-back, a right mend kept, the line let go, never twice),
  DOM-24 (in the real chain, by itself, said out loud). 7 deliberate breaks caught.
- 528/528 harness + 43/43 walk + 8/8 play. version.js -> m268-001.

# M269 — a streamed piece costs nothing: the housekeeper never freezes the screen
- THE WRITER: "SillyTavern is smooth; the housekeeper, while it thinks, lags and freezes the
  whole screen." Measured, not guessed: tests/perf_housekeeper.py — a real Chromium on a
  phone's viewport, the CPU slowed 6x, the real serve.py, and a fake model streaming a long
  thinking and an answer in small pieces the way DeepSeek does.
- THE CAUSE: for every piece, the housekeeper rewrote the WHOLE thinking and the WHOLE answer
  (textContent +=, which reads all of it and writes all of it back — the answer twice),
  redrew the status line, and forced a layout by scrolling to the bottom. Thousands of pieces,
  each dearer than the last. At 1,500 thinking pieces and 300 answer pieces (a five-second
  stream): 157.6 seconds to show, the screen frozen for 139,361 ms, 56 frames in all, 156,458 ms
  of long tasks.
- FIXED: a piece goes into a string; once a frame what came is drawn — the answer appended as
  new text, the status line once, the scroll only when the writer is already at the bottom;
  while it thinks, the fold shows the newest 4,000 characters (a hundred thousand laid out
  every frame is what a phone cannot do) and the whole thinking is kept on the turn and shown
  when the answer is in; the last pieces are drawn when the turn ends and a late frame draws
  nothing. Same stream after: 6.7 s, worst frame 83 ms, p95 33 ms, 154 ms of long tasks. Twice
  the size (102,033 characters of thinking): worst 83 ms, p95 17 ms, 95 ms of long tasks.
- THE STORYTELLER'S OWN STREAM had the same fault in its thinking fold (rewritten whole on each
  piece; the prose was already paced by its paint cost): at the half size, 204 frames, p95 67
  ms, 898 ms of long tasks → 352 frames, p95 33 ms, 0 ms. The whole thinking is written once
  when the page is in.
- THE TEST: `python3 tests/perf_housekeeper.py` (SCENARIO=story for the storyteller; the
  service worker blocked so its update reload cannot land mid-measure); it exits 1 past its
  budget (a 250 ms frame, 3 s of long tasks at 6x). Run it before any change to a streaming view.
- 528/528 harness + 43/43 walk + 8/8 play + both streaming measurements within budget. version.js -> m269-001.

# M270 — every housekeeper round streams; the question stands at once
- THE WRITER (two screenshots): "sometimes it works, sometimes it hangs … and doesn't respond".
  The status line read "109s · 2378 chars (+14652 thinking) · gives up after 223s of silence",
  then "114s · 2378 chars · 218s" — the answer had stopped growing and the silence watch was
  counting down. The answer on screen ended with a look-up ("every page holding 'seventeen'").
- THE CAUSE: runConversation handed the writer's live view to the FIRST call only
  (onToken: round === 0 ? onToken : undefined). After a look-up, the second round streamed into
  nothing: the panel stood still, and the silence watch (M83) — fed only by that view — counted a
  working model as a dead wire and, past its limit, cut the live answer. A short second round
  finished in time ("sometimes it works"); a long one was cut ("sometimes it hangs").
- FIXED: every call streams to the view, and a new call first says why it was made (roundWhy:
  "reading what it looked up", "fixing where its changes land", …) — the status line reads "The
  housekeeper is reading what it looked up (round 2)", the answer bubble starts fresh, the
  thinking fold marks "— asked again —". The watch now hears every round.
- ALSO FROM THE SCREENSHOT: while it worked, the thread said "Nothing asked yet" and the
  writer's own question was not in it (it waited for the answer). The question stands the
  moment it is asked, and the empty note goes.
- THE TEST: tests/housekeeper_rounds.py — a real Chromium, a fake model whose first answer looks
  something up and whose second round thinks for ten seconds against a six-second silence
  watch. On the old code: 4 of 6 checks fail (the question missing, round 2 unseen, the live
  round cut, no answer). Now: all green. Law M259-35 runs the same in the harness.
- DOM-11b waited for "two bubbles" as its sign the answer had come; with the question standing
  at once that came too early — it waits for the pending bubble to be gone.
- 529/529 harness + 43/43 walk + 8/8 play + housekeeper_rounds all green + perf within budget.
  version.js -> m270-001.

# M271 — the housekeeper works on behind a closed sheet; its history stays; a heavy history opens fast
- THE WRITER: (1) "When it thinks big and fetches many pages it lags — Chat Assistant does the
  same and stays smooth." (2) "When I close the housekeeper, processing or not, the history is
  gone, or the process doesn't go on in the background. I should be able to explore."
- (2) THE CAUSE: closing the sheet ABORTED the running call (closeSheet → workerCtl.abort()),
  and a turn is saved only with its answer — so an ask the writer walked away from left nothing,
  and a redraw dropped the live question, thinking and answer. FIXED: closing never stops the
  housekeeper (⏹ Stop does); the ask in flight is kept (live nodes redrawn under the session's
  turns whenever the sheet is drawn); the housekeeper's button lights the house's blue working
  lamp while it works and a toast says when it answered with the sheet shut; the question is kept
  as a draft until it is answered, so a reload or a stumble puts it back in the box and says so.
  tests/housekeeper_rounds.py adds eight checks (the lamp, reopened mid-answer, finished behind
  a shut sheet, both questions and answers in the history, a reload puts the question back):
  the previous panel code fails all eight; now all fourteen are green.
- (1) MEASURED: tests/perf_housekeeper.py SCENARIO=bigfetch — 150 long pages, a first round of
  ~100,000 characters of thinking that looks up 12 pages and 3 searches, a second round of
  another ~100,000: worst frame 133 ms, p95 33 ms, 286 ms of long tasks, all 204,017 characters of
  thinking kept. The per-piece redraw (M269) and the unstreamed round (M270) were the lag; with
  them gone the big turn is smooth.
- AND THE COST THAT GREW WITH HISTORY (HISTORY_TURNS=40, each turn ~100,000 characters of
  thinking): every redraw wrote every past turn's whole thinking and whole answer into its
  folds, open or shut — opening took 2.52 s with 896 ms blocked. A fold's words are written the
  first time it is opened now: 0.91 s, 466 ms blocked. What remains is reading and drawing forty
  large turns (the session row is ~4.7 MB; reading it costs ~53 ms at 6x).
- DOM-11e opens the thinking fold before reading it (its words are written when opened).
- The speed test lets the app settle before measuring (the app's own first drawing of the story
  had been counted as the housekeeper's), can profile an opening (PROFILE_OPEN=1), and reads the
  thinking kept from the store.
- 529/529 harness + 43/43 walk + 8/8 play + housekeeper_rounds 14/14 + perf (plain, bigfetch,
  history) within budget. version.js -> m271-001.

# M272 — the housekeeper's cards have names of their own; the brief's opening stays; Mr. is not Mrs.
- THE WRITER (three screenshots and four points, before installing M270/M271):
  1. The housekeeper froze for minutes with a status that did not move — the M270 bug (the
     second round after a look-up streamed into nothing), already fixed there. And the live
     bubble showed the raw wire (<fetch>[…], <brief>[{"field":…) — "not beautiful".
  2. It proposed to "update" the brief's STATE line (the story's opening) and, told no, the
     SCENE block and LAST line; its withdrawals took more or less than asked.
  3. It found, and fixed by cards, things the house should fix itself.
  4. It told the writer applied cards were still pending.
- CAUSES AND FIXES:
  - THE LIVE ANSWER (answerAsWritten): blocks never show while written; a quiet note stands in
    their place ("looking something up…", "writing its cards…"); plain words are appended, the
    answer is drawn whole once a block may be forming (0.06 ms a frame for 10,000 characters);
    a new round draws the old one to its last word, then says what comes next.
  - A CARD'S NAME IS ITS OWN (stageProposals): the numbering began at 1 in every answer, so two
    answers each had a "ledger changes 1" — one applied, one pending — and every brief card was
    "the brief". The housekeeper read two fates under one name (point 4), and <supersede>, which
    withdraws by name, took every card of that name (point 2). Names are unique across the
    session; a brief card is named for the words it changes ("the brief — # STATE: Thu…").
  - ONE LIST OF WHAT BECAME OF EVERY CARD ("CARDS ALREADY SETTLED" in the context), to be
    trusted over anything an earlier answer said.
  - THE BRIEF'S OPENING (touchesOpening, openingLinesOf): its STATE / SCENE / WHERE / PRESENT /
    ACTIVITY / LAST / NOW / TIME / DATE / HOUR lines are where the story began; the housekeeper
    is told so, and the house refuses a card that moves them (find/replace, append or a whole
    rewrite) unless the writer names the line ("the state line", "the SCENE block").
  - A LEDGER CARD IS NAMED FOR WHAT IT TOUCHES: "people's pages changes N" (it was "ledger
    changes 1" for eight edits to the pages of the people).
  - MR. IS NOT MRS. (findPersonKey): "Mrs. Sterling" is one letter from "Mr. Sterling", inside
    the near-name slack — her lines were written on his page. Different titles (Mr, Mrs, Ms,
    Miss, Dr, Aunt, Uncle…) are never one person; a titled name never lands on a page opened
    under the bare surname. Seats, standings and pages all resolve through it.
  - A FACT LET GO (knowledge.forget): the ledger could only add to what someone knew. Every line
    answering to the quoted fact goes; a take-back restores them. The housekeeper has it; the
    auditor does not. Reworded copies are not folded on their own.
  - THE MAIN CHARACTER'S "WHERE" BELONGS TO THE OLD GROUND: a scene move lets his page's state go
    (as it lets positions go) unless the writer wrote it; a take-back restores it.
  - A THREAD LINE THAT BROKE OFF (brokenOff: an article, a joining word, or "means to" with no
    verb) is not written — the old next step stands; a name written twice is written once
    (undoubled: a possessive after a doubled word, or a whole name doubled — "Bora Bora" stays).
- THE CARD CUT MID-SENTENCE ("he off—") was M266's (notes kept whole).
- Laws: M259-36 (all of the above, the finished lines that must stand included); M83-3 reads the
  brief card's new name. 16 deliberate breaks caught. housekeeper_rounds.py: 16 checks, the live
  answer never showing a block among them. The rounds test's reloads wait for the new page (the
  old one could answer for a moment), and its fake model writes a look-up in pieces, as models do.
- A doubled comma in an import (the panel's) stopped the app from loading; the real-browser
  test caught it. The harness cannot: it never loads the panel.
- 530/530 harness + 43/43 walk + 8/8 play + housekeeper_rounds 16/16 + perf (plain, bigfetch)
  within budget. version.js -> m272-001.

# M273 — cards that fix one problem are one group: taking one back takes them all
- THE WRITER, on M272's unique names: "Does this actually help? What I mean is: I asked to
  supersede A, and A was one problem fixed in three places — it withdrew one card of the three.
  The housekeeper must know which cards belong together." He was right that M272 alone made his
  case worse: three brief cards had shared one name, and a withdrawal by that name took all
  three by accident; with names of their own, a withdrawal took one.
- THE GROUP: every block entry may carry "group" (a short name for the problem); the card takes
  it (stageProposals marks which entry each card came from). The house also joins the cards of
  one answer that share a reason (16+ characters) or make the same change (changeOf: the
  find→replace difference widened to whole words — "sixteen-year-old→fourteen-year-old" on a page
  and in a record line). A later answer's card with the same group name joins the earlier group.
- A WITHDRAWAL TAKES THE WHOLE GROUP (applySupersede): a card named takes every pending card of
  its group; "group: NAME" (or the name plainly) takes the group; "only: label" takes one card.
  Each withdrawn card says so; the talk's note says "Withdrew 3 cards — all of “…”".
- THE HOUSEKEEPER SEES THE GROUPS: the pending list names each card's group and says what a
  withdrawal means; the teaching asks for a group on every entry of one problem, kept when a
  card is re-proposed. THE WRITER SEES THEM: a card reads "Part of “…” — 1 of 3".
- A COMMA NEVER STAYS IN A NAME: a withdrawal list is split at commas, and M272's brief-card
  names could hold one ("# STATE: Thu 20 Aug 2026, 11:00") — such a card could not be withdrawn.
  Names are cleaned of commas; a line that is a whole existing name is taken whole, so older
  names with commas still answer.
- Laws: M259-37 (named groups across a page, a record line and a page of the people; the lone
  card; one named → all; only:; group:; the same change and the same reason joined; different
  fixes apart; a later card joins; commas), DOM-25 (the card's group line). 12 deliberate breaks
  caught. DOM-25 opens the sheet afresh (an earlier scenario can leave it open).
- 531/531 harness + 44/44 walk + 8/8 play + housekeeper_rounds all green + perf within budget.
  version.js -> m273-001.

# M274 — the audit
- THE WRITER: "Have you pushed and audited the whole thing for bugs?" Pushed, yes (M273); audited
  as a whole, no — each release had been checked where it touched. So, the whole of it:
- LINT (tests/audit_lint.sh — ESLint 9, real-bug rules as errors): 70 files, 0 errors. Every
  warning read by hand: 38 names used before their definition (all inside functions that run
  after the definition — the sync worker's client id, sync's paint/liveRepaint, the drawer's and
  chat's closures — no crash at load or at run); 12 shadowed names (a seat-name parameter beside
  the seat() import, loop counters in arrow functions, a local import beside a static one — and
  M271's in-flight ask, also called `live` beside the cards box's own `live`: renamed liveAsk); 37
  unused names (dead state — a render token, a ledger mark, imports left behind — none a skipped
  check).
- THE OFFLINE SHELL (sw.js): its list holds every js/css file on disk (72 of 72), and its cache
  is named for the version.
- COSTS THAT GROW WITH THE TALE: after every page the keeper's job read every page three times;
  the look for mistaken mends (M268) needs doing once a session for each tale (M268 keeps new ones
  from being made) — it is.
- THE LAST QUIET CUTS (the same fault as M265–M267, found by listing every fixed cut left):
  a correction to the record was cut at 600 (the writer's edit ripple and "the brief wins" write
  them) — 4,000; the director's ideas read the first 6,000 of the brief — 40,000; the writer's
  steer to the director was cut at 2,000 — 12,000; a person the world agent seats got a first
  page cut at 280 — 4,000; the standings rebuild read 6,000 of the cast notes — 20,000; a card's
  reason, cut on a word at 200, reads to 600.
- Law M259-38 (each of those, whole); its first draft let the rebuild's cut pass because the
  stated-standings reader beside it already had the notes whole — it now checks the rebuild's
  own call. 6 deliberate breaks caught.
- Every suite, each run alone: 532/532 harness, 44/44 walk, 8/8 play, two-browser 11/11,
  housekeeper_rounds 16/16, perf (housekeeper, story) within budget. version.js -> m274-001.

# M275 — the green light comes back by itself: a gap the house opens, the house folds
- THE WRITER (a screenshot, no light on the ledger button): "Explain why the green neon is gone!"
  The light is green only when every minder ran well, none stopped partway, the ledger has read
  every page and the RECORD HAS NO GAP; short of that and not working or troubled, it is dark.
- THE CAUSE, MINE (M268): putting back a mistaken mend lets go of the record line over that page
  (so the keeper folds it again from the storyteller's own words) — and the keeper job did it
  AFTER its fold. The gap stood until the writer's next page, and the light stayed dark. His
  story held such a mend ("Jovan is seventeen"), so the first page after updating opened it.
- FIXED, AND MADE TO REPAIR ITSELF:
  1. the put-back comes BEFORE the fold, in the same job;
  2. a keeper job ends by folding any gap it opened (a page mended while its LAST batch of the run
     was folded lets that line go after the loop has finished);
  3. THE HOUSE FILLS WHAT THE LIGHT SEES (fillRecordGap): a gap seen while the house is idle and
     no worker is failing sends the keeper — a mend, an edit or a delete of an old page leaves one
     too. A fill that folds nothing waits twice as long each time (1, 2, 4 … 30 minutes — never a
     model call a minute for ever); one that folds part of a backlog comes back in a minute; a gap
     that remains is said as amber ("stopped partway; it will carry on by itself"). The idle fill
     hands a contradiction to the mender as the page's own chain does.
  4. SETTLED AFTER THE RESULT IS WRITTEN (queue.js): a job was marked settled before its result
     was written, and the light, which looks the moment a worker settles, read the result before
     it — green for an instant after a job that stopped partway.
- AND AN OLDER BUG THE TEST FOUND: the mender refuses a change larger than half a page, and
  measured it BY LINES — a page of one paragraph is one line, so any mend of it (one word) read as
  a whole rewrite and was dropped without a word. A one-line page is measured by words now; a page
  of several lines keeps the stricter of the two, as strict as it was.
- Laws: M259-39 (the settle order — the old order fails it), M35-3 (the measure), M254 and M35-4
  read the new wiring; DOM-26 in four parts (a keeper that cannot fold: amber, no retry at once, a
  minute on still waiting, past two it tries — the clock moved; a keeper that can: the gap folded
  with no page written and the light green; a mistaken mend put back during a page's chain: folded
  in the chain's first pass; a page mended in the last batch of the run: folded in the same job).
- 5 deliberate breaks of DOM-26 caught (each fix undone in a copy); the settle order's too.
- 533/533 harness + 45/45 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  within budget + lint 0 errors. version.js -> m275-001.

# M276 — an outage closes while the writer plays on, and while the house is idle
- THE WRITER: "amber fixes itself, right? If the next scenes run normally it self-heals?" Checking
  before answering found that for the LEDGER it did not. The page reader marks state.page only
  when a read succeeds (M251), reads the oldest missed page on each new page, and M253 made the
  mark a contiguous prefix. But the page in hand, read out of turn, was forgotten: next turn the
  catch-up read it AGAIN as "missed", and the gap stayed exactly as wide for as long as the writer
  played — the mark never caught up, pages were read twice (their changes applied twice), and the
  light could never be green again after an outage. M248's law tested the arithmetic with the
  newest page held still. And a missed page whose reading changed nothing never moved the mark
  at all (it was only saved when there were changes).
- FIXED (engine/state.js markPageRead, oldestUnread; state.readAhead): a page read past the mark
  is remembered and taken into the mark the moment the pages before it are read; the catch-up
  reaches only pages no read has reached; a quiet page is a read page; a page's changes are
  stamped with ITS OWN index (they were stamped with the mark for a page read out of turn, so a
  branch at the mark carried them); readAhead is kept on load (a page just past the mark taken in)
  and cleared when a line is rebuilt to a page.
- THE LIGHT READS WHAT IT SEES (fillLedgerGap): the ledger behind while the house is idle and no
  worker failing sends the reader through the missed pages (three a job), backing off 1, 2, 4 …
  30 minutes when it reads nothing, amber while pages remain; an unfounded ledger is left to the
  page chain.
- Laws: M259-40 (the outage played through with the writer writing — the mark reaches the newest
  page, no page read twice; idle reading; the save and the rebuild), M248 and M254 read the new
  wiring; DOM-27 (a three-page outage of quiet pages: one new page, then the idle reading — four
  readings in all, the mark at the newest page, the light green).
- THE ROOT UNDER IT, found when DOM-27 first ran the real chain: state.page had two jobs — the
  stamp every write of a turn carries (M72: the send path sets it to the COMING page, and the
  referee's save wrote it) and the reading mark (M251/M253). Every send with the referee on moved
  the mark past every page an outage had left unread: the catch-up saw no gap, the light went
  green, and those pages' changes were lost without a word — M251's self-heal never ran in the
  real app. The reading mark is state.readTo now (engine/state.js readMark: readTo, else page for a
  ledger saved before); state.page is the stamp alone. A ledger built on emptyState() and given a
  page reads from that page (readTo is left unset there — set to -1, every page read again).
- A FOUNDING READ takes in the pages before the one in hand: no catch-up before it, and everything
  up to that page counts as read after it (DOM-21 caught the double reading).
- Breaks: the mark forgetting pages read out of turn (DOM-27: five readings, M259-40), the reading
  mark taken from the stamp again (DOM-27: one reading — the old loss), the idle reading switched off
  (DOM-27).
- 534/534 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  within budget + lint 0 errors. version.js -> m276-001.

# M277 — the main character holds no standing; the auditor starts a standing only from the brief
- THE WRITER (the drawer at turn 76): "It's been good — anything to fix, especially the ledger?"
  Of fifteen audit lines, eleven were standing moves the auditor may not make ("its change did not
  hold — the pages moved this standing"), and four "set right" lines STARTED standings: one for the
  main character himself ("Jovan's standing toward the table is moved by the 'old' folder") and
  three for people who had not met him that evening (Sophie at the music-room door, Mr. Sterling
  facing Caleb, Maya making her folder), on reasons like "moved by the evening's events".
- CAUSES: the engine let anyone write a standing for the main character (standingsHousekeeping
  cleared one only at the NEXT audit, reading the ledger from before that audit's own writes); and
  the auditor's guard (M48/M259) refused lowering an earned standing and raising a moved one, but a
  standing that was missing or zero was its to fill with any value on any reason — a second beat
  counter beside the page reader.
- FIXED: rel.set and rel.shift refuse the main character (apply.js, for every writer); the auditor
  starts a missing or zero standing only for someone the brief or the cast notes name, on a reason
  that quotes them (the brief's digits are the house's own, standingsHousekeeping) — zeroing one
  written for someone else stands; a standing move it may not make is counted (audit.leftStandings,
  "left N standing changes to the page reader"), not listed; its law says so.
- NOT CHANGED: the standings the turn-76 audit already started (Sophie, Maya, Eli, Mr. Sterling)
  stay until the writer takes them back in the drawer; the main character's is cleared by the
  next audit's housekeeping.
- Laws: M259-41 (the main character refused, set and shifted; the auditor's starts refused for the
  main character, for an unnamed person on a page's reason and on a reason quoting the brief; a
  moved standing left alone; a brief-named bond restored; one finding reported; four counted), M259-5
  and M50-3 and LONG-8 read the new behaviour (a refusal counted, not listed; an old ledger's
  main-character standing still let go by the rebuild). 6 deliberate breaks caught.
- 535/535 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  within budget + lint 0 errors. version.js -> m277-001.

# M278 — a standing is toward the main character: never one the brief set toward someone else
- THE WRITER (the audit right after M277): "found 5 things, set 6 right: Sophie Dale stands
  devoted (P+65) — set: the brief says · Mrs. Sterling stands neutral all through … left 10
  standing changes to the page reader, 10 refused."
- WHAT WAS WRONG: (1) the brief gave Sophie P:65 TOWARD EMILIA (an arrow line), and the auditor
  wrote it as her standing toward Jovan on a bare "the brief says" — M277 let a brief-named person
  and a reason quoting the brief through without asking toward WHOM; (2) four "neutral all
  through" standings were written for bystanders — a zero standing for someone with none is no
  change; (3) the ten refusals were counted twice.
- FIXED: the auditor starts no standing on a bare "the brief says" (it names nothing of the bond)
  nor on a reason or finding that says "toward" someone other than the main character ("the brief
  says Mira is his sister" is about him, and may); rel.set at zero for someone with no standing
  writes nothing (same:true — not reported); refused standing moves are counted once ("left N …"),
  never again as "refused"; the teaching says so.
- THE HOUSE MENDS WHAT AN OLDER AUDITOR WROTE (standingsHousekeeping): a standing whose every cause
  is a bare brief line, or a brief line said to be toward someone else — not the writer's own, not
  one the house's own reading of the brief sets toward him — is let go at the next audit. Sophie's
  P:65 and the four empty ones go; one about him, one the pages moved, and the writer's stay.
- Laws: M259-42 (Sophie toward Emilia refused, bare or pointed elsewhere; a bare reason for a
  brief-named person refused; a zero bystander not written; a bond toward him restored; one finding;
  three counted once; the cleanup — what goes and what stays), M259-41 names him in its restore;
  M49-3 and M50-2 seed their zero standings as an older ledger would hold them. 8 deliberate breaks
  caught (one found the bare rule untested alone — a case was added).
- 536/536 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  within budget + lint 0 errors. version.js -> m278-001.
- m278-002: the house's cleanup looked for EVERY cause to be a bare or elsewhere brief line — but
  the writer's Sophie may carry the turn-76 auditor's start beneath the bare line, and would have
  stayed. It now reads the cause the standing STANDS ON (the latest), when no entry is a beat a
  page earned (every cause "set — …"). M259-42 adds that shape (Maya: a start, then a bare line —
  let go), a beat then a bare line (Vanessa — stays) and a bare line then a bond about him (Tom —
  stays); both new rules broken and caught. 536/536 + 46/46 + 8/8.

# M279 — the live thinking is read from its first word; "stands as the pages moved it" is no finding
- THE WRITER: (1) "The streaming thinking block keeps moving down and the first of the thinking is
  cut off — I can't see it while it streams." M269 had kept a phone from freezing by drawing only
  the newest 4,000 characters of a live thinking; the start of it was gone until the page landed.
  (2) An audit of "found 18 things, set 5 right … 13 seen, nothing to change".
- (1) FIXED (js/ui/streamtext.js, one helper for the storyteller's fold and the housekeeper's): the
  whole thinking is drawn, line by line — each line its own block, and a line that runs long ended
  at its next sentence (past 500 characters; at its next space past 1,500), so a frame's new words
  touch only a short block however long the whole grows; the box follows its own bottom only when
  the reader is there. The housekeeper's thinking has its own scroll box now; both boxes are
  contained. The finished thinking is drawn whole as before. Measured (6x CPU): housekeeper worst
  50–117 ms, p95 17 ms; storyteller worst 100 ms, p95 33 ms; two rounds of 204,017 characters worst
  200 ms, p95 33 ms — all within budget, the first words there throughout. The first draft (one
  block a line) froze on a thinking with no line breaks: worst 233 ms, 3.4 s of long tasks.
  tests/perf_housekeeper.py now fails a run whose live box, past its thousandth piece, lacks the
  first words (the old tail view: false, OVER BUDGET).
- (2) The five thread closings were real. The thirteen "Seen" lines said "stands as the pages moved
  it" / "not the ledger's to zero" — all is well in other words; saysAllIsWell reads them now.
  Maya, Eli and Mr. Sterling at 0/0/0 with the auditor calling them "moved by the pages": the page
  reader follows the writer's own standing law (M53 — a standing moves only on a revelation; flat
  is the default), so a side character at zero is that law, not a missed beat, as far as the code
  shows; nothing was changed there.
- Laws: M259-43 (every word drawn in order from the first; no line past 560 characters; a line break
  and an empty line kept; the hard split at a space; following only from the bottom; the audit
  lines). 4 deliberate breaks caught, and the browser check caught the old tail view.
- 537/537 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  (housekeeper, story, bigfetch) within budget + lint 0 errors. version.js -> m279-001.

# M280 — the page reader decides every open thread; the writer's own people wait
- THE WRITER: (1) "The five thread closings were real repairs — so make sure it doesn't need the
  auditor to do it." (2) "At page 200 I asked the housekeeper to add new characters to the brief.
  Will they be on the ledger later?"
- (1) Closing a thread the page resolved was item four of the page reader's checklist, under "be
  conservative — never what it merely hints at"; a thread resolved over a few pages stayed open until
  the auditor, reading several at once, closed five in one reading. The page reader is now handed
  the OPEN THREADS by name (title, owner, next step, cold marked) under every non-founding page, and
  answers in their own slot — {"mutations":[…], "resolved":["exact title", …]} — which this page
  resolved; the parser turns each into one thread.close (openThreadsBlock, parseExtractorAnswer).
  The auditor stays the last defense for the ones it still misses. Whether DeepSeek fills the slot
  well is not measurable here.
- (2) The founder re-reads the brief whenever it changes (its fingerprint) on the next page, and
  writes the new people in; the storyteller reads the brief every page. The gap: the people upkeep
  (M57, every page since M261) retired anyone with no bond, seat, thread or lock after thirty quiet
  pages — a character added for page 240 lost the card the storyteller reads. A person the brief or
  the cast notes name (whole name or first name, as a whole word) is never retired for being away;
  the audit and the page-by-page upkeep both hand it the brief.
- Laws: M259-44 (the slot closes once each; the list with next steps and [cold]; none on a founding
  read; end to end the resolved thread closes and the other stands; brief people kept by first or
  whole name, a passer-through retired, a name inside another word no mention; the per-page upkeep
  keeps them). 6 deliberate breaks caught.
- 538/538 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + lint 0
  errors. version.js -> m280-001.

# M281 — the people's pages reach the storyteller; the people follow the room
- THE WRITER: "Should we design a smart, foolproof system for brief characters? With twenty or more,
  will the context grow and confuse the AI — should they rotate? Most of the time they matter."
- THE DESIGN WAS THERE (M12): full cards for the present (6), a line for the rest of the room, up to
  3 recalled cards for the absent named in the last three messages, a rotating roster (12, a step a
  page), all held to PEOPLE_BUDGET (4,800) — and the brief rides every page whole.
- BUT IT NEVER RODE. stack.js built the block and counted it on the receipt as "On their mind",
  and the story-state message was assembled from everything else: since M12 (c9b9f1c) the
  storyteller has told every page without the people's pages — who they are, where they stand, what
  they are carrying — while the inspector said they were sent. Every people law tested the block
  or the receipt, never the request. FIXED: it leads the story-state, before the state of things.
- AND IT FOLLOWS THE ROOM (peopleView, like M266's stateView): with room, every present person keeps
  a card (to 12), six are recalled, the whole roster rides unrotated (to 40), in a budget to 48,000
  characters; a small context keeps the old tiers and rotation. With notes kept whole (M266), six
  present cards had filled 4,800 alone and shed the named and the roster on most pages.
- Recall also takes whoever is on their way to the main character (a seat "toward" or "seeking") —
  the storyteller may bring them in on this page; named ones first.
- A tier that was shed is no longer reported as sent.
- Laws: M259-45 (the view's numbers; a cast of twenty-five — the old tiers shed and now say so; the
  room keeps eight cards, three recalled incl. the one on her way, the whole roster, no rotation;
  the request carries all twenty-five and the cards), M259-46 (every part the receipt lists — all
  seventeen, each with its own mark — is in the request; a part the law does not know fails it; the
  people lead the story-state). 6 deliberate breaks caught, the M12 omission among them.
- 540/540 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  (story) within budget + lint 0 errors. version.js -> m281-001.

# M282 — who matters rides without a pin; a first name recalls; "player" in a name is a person
- THE WRITER: "Is it foolproof, smart and autonomous? Some characters are really important, but I
  don't want to pin anything — my philosophy is autonomous." And: did the conversation's compaction
  harm anything? (It did not: the repository is the record; every release was verified from a fresh
  clone.)
- AUDIT OF M281 (re-read line by line) found: the present "always keep their cards" — and with notes
  kept whole (M266) twelve present cards could run to ~144k characters on a 128k context, past any
  budget. And beyond it:
  1. RECALL NEVER HEARD A FIRST NAME. namedIn matched the ledger key whole: the writer says "Rias",
     and "Rias Wells" was not recalled; \w also broke on any non-ASCII letter. Now spokenNames: the
     whole name or the first name (3+ letters, not a title — "Mr. Sterling" only whole, the surname
     is the family's), matched on Unicode word boundaries.
  2. AN ABSENT PERSON WHO MATTERS WAS A NAME ON THE ROSTER unless spoken in the last three messages.
     importanceOf weighs, in code: |P|+|R|+|S| toward the main character, 40 a hot thread they own
     (15 cold), 30 named in the brief or cast notes, 20 a truth locked about them, less half a point
     a page away (to 30). A new tier — "Away, and much on the story's mind" — gives the absent who
     weigh 20 or more their cards (recall size) in the room left, weightiest first; the roster names
     the rest.
  3. THE PRESENT ARE ORDERED BY WEIGHT and take cards to 70% of the room — three always, however
     long; the rest ride the "Also here" line.
  4. "PLAYER" IN A NAME WAS THE MAIN CHARACTER. isMcAlias matched the plain labels word by word, so
     "Card Player" or "You Sung" was him — no standing, no card. The labels ("you", "the player",
     "player") are whole names now; his story name keeps the loose match ("Jovan Wells" is Jovan).
     Found because the new law's bit player was named "Bit Player".
- Laws: M259-47 (spoken names and titles; the plain labels; the weights and their order; a small room
  keeps three present cards by weight and the line; three always however long; the room gives Rias,
  Aurora and Nora their cards away and unnamed, a bit player only the roster, no card named twice; a
  first name recalls, a surname or a name inside a word does not; the request carries her page and
  the receipt says why); M259-45 reads the new small-room count. 8 deliberate breaks caught.
- 541/541 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  (story) within budget + lint 0 errors. version.js -> m282-001.

# M283 — the scribe reads the brief; the writer's material rides whole; the story's ground brings people forward
- THE WRITER: "How did the people block go unsent since M12? Is there anything else like it? Will it
  stay smart over 800 pages — minor characters should come forward when the story reaches them, not
  on a wheel. MAKE SURE NO BUGS." A sweep for the same pattern (a thing built, or promised to a
  worker, and not delivered) found:
  1. THE SCRIBE NEVER HAD THE BRIEF. Its law says to write only the names "the ledger, the brief and
     the pages use"; buildScribeMessages took state and the page only. It wrote who people ARE without
     the writer's word. It now receives the brief and the cast notes (to the workers' room, a stated
     cut past it), and reads the pages it keeps through a large view (peopleView(200k)) — through the
     storyteller's smallest view, a few long present cards had shed the off-scene people the page
     names (the M227 recall) before it could read them.
  2. THE STORYTELLER'S CAST NOTES WERE CUT AT 9,000 CHARACTERS MID-WORD, and the lore shelf at 3,000
     (once the record was long). Both follow the room now (80k / 60k at most), cut only at a line.
  3. FIVE WORKERS CUT THE BRIEF (40,000) AND THE CAST NOTES (20,000) IN SILENCE — keeper, director,
     continuity, auditor's rebuild, founder — and all seven cut wherever the count fell.
     engine/whole.js writerText: the same room, the cut at a whole line, and a line that says so ("the
     brief continues — N more characters"; with the way to fetch it, for a worker that can). A larger
     room was tried (120k) and set back: on a smaller worker context it starved the pages and the
     fetch of the whole brief (M259-18 caught it).
  4. RELEVANCE, NOT A WHEEL. importanceOf: what lasts (bond, threads, the brief, locks) wanes with the
     time away, never below nothing; what is NOW does not wane — +25 for a page or seat at the ground
     the scene stands on (placeWords: the proper names of the place, never the main character's own,
     never a plain room word), +10 for a name the last ten pages keep saying. The roster names the
     nearest first and counts the rest ("and N more the ledger knows"); it no longer turns page by
     page. A very large room (400k+) holds 16 present cards, a 72k block and a 60-name roster.
- Found in my own work before release: a quoting slip that would have sent the scribe the literal
  text ", String(brief).trim(), " instead of the brief (M259-48 caught it); place words that made
  everyone "near" in "Jovan's room" and anyone with "kitchen" in their notes near the Wells kitchen;
  a mid-line cut that a test passed by coincidence (checked now at four rooms).
- Laws: M259-48 (the scribe's brief, cast notes and recalled page; the request carries them; cast
  notes and lore whole in the room, cut at a line without it; the ground by its names; Ms. June near at
  the diner and back on the roster at home; the lately-named before a stranger whatever the ledger's
  order), M259-49 (writerText whole, the stated cut at a whole line at four rooms, the no-fetch
  wording; six workers read a long brief and cast notes to their end; the scribe is held and told),
  M12 tiers and M259-45 read the relevance roster and the larger room. 13 deliberate breaks caught.
- 543/543 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf (story,
  housekeeper) within budget + lint 0 errors. version.js -> m283-001.

# M284 — a newcomer is carried; everyone without a card is a line that says who they are
- THE WRITER: "Are the characters smart or not? If my sister is sick at home while the MC moves away,
  is she gone — while she's literally thinking about him? How many get full, how many short? When
  new characters come in beside many important ones, what happens to them? I asked for a backup
  section for minor characters — smart, not gamey."
- MEASURED (M259-50, his case): the MC at a new ground (the Harbor Market), six in the scene with a
  newcomer among them, the sister away sick ("home, in bed with a fever; rereading his texts,
  thinking about him"), ten bonded and twenty minor people elsewhere. On 500k, 128k and 107k rooms:
  all 6 present carded; 9 away carded — the sister first with her seat's words, Aurora (bond and a
  hot thread), Claire, Alexia, the two the brief names, the three whose pages are at the market;
  21 short lines; nobody left out; 15,573 characters. Crowded (twelve more bonded away) on 107k:
  6 present cards, 7 away cards (the sister still first), 35 short lines, 14,407 of 19,260.
- WHAT WAS MISSING, AND NOW IS NOT:
  1. A NEWCOMER had no bond, thread or lock, so ranked last in a crowded room and was a bare name the
     page they left. Every person's page now carries firstSeenTurn (written once, by the hand's door
     and the scribe's; kept on load), and for their first ten pages they weigh +30 — carded in the
     scene and after they step out; past that, their story (bond, threads, the ground, the latest
     names) decides.
  2. THE ROSTER WAS BARE NAMES. With room it is a line each — who they are (the first clause of
     their page), where they are now (their seat, else their state), when last seen — the nearest
     first, the rest counted. Room is kept for those lines before the away cards take theirs, so a
     crowded tale sheds away cards one by one, never the whole tier (which had taken the sister).
  The model's own judgement already feeds the weights: the world agent's threads (+40 a hot one)
  and its seats heading toward the main character (recalled).
- Laws: M259-50 (firstSeenTurn by both doors, kept, never moved; the scenario on three rooms; the
  crowded room; the newcomer carried away from the scene, and a line ten pages on). 6 deliberate
  breaks caught (one needed the crowded case to be seen). M259-47/48 read the roster's lines.
- 544/544 harness + 46/46 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  (story) within budget + lint 0 errors. version.js -> m284-001.

# M285 — the model's room has one answer: the writer's number, else his provider's
- THE WRITER: "Short context and large context — how is it chosen? From the connection?"
- IT IS THE CONNECTION'S "The model's room, in tokens" (Settings, the connection form). Checking
  that answer found the house had two different answers when the field was EMPTY — the storyteller
  (budget, ember bar, record room) took 200,000 for every provider; the workers (engine/pagecut.js)
  took 128,000 — and neither was the provider's: the form's own placeholder showed DeepSeek's
  128,000 while the storyteller planned a DeepSeek story in 200,000.
- FIXED: js/providers/room.js (no imports) — contextOf(conn): the writer's number; else the room of
  the preset the connection came from (presetIdFor: the preset it was made from, else by kind and
  address — the settings form's reading, moved here and shared); else 128,000. The storyteller's
  budget, the ember bar, the record room and every worker's room ask it. PRESET_CONTEXT is held to
  PRESETS by a law.
- Laws: M259-51 (the table matches the presets; the writer's number wins; DeepSeek by address and by
  preset; Claude; Google; an unknown endpoint; zero is no number; the workers and the storyteller's
  people view ask the same), DOM-28 (in the app, the ember bar reads the page against 128,000 for an
  unknown endpoint — the old flat 200,000 reads 8.936% where 13.962% is right). The first DOM-28
  failure message read the bar before waiting (it said 0%); it reads it after now.
  4 deliberate harness breaks and the DOM break caught.
- 545/545 harness + 47/47 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  (story, housekeeper) within budget + lint 0 errors. version.js -> m285-001.

# M286 — twelve in the scene: the present take what the away do not need; no one here is a bare mention
- THE WRITER: "So if 12 people are in the scene, it gives info on all 12?"
- MEASURED BEFORE: twelve present, pages ~1,500 characters — 9 cards on a 128k room (3 on the "Also
  here" line); pages ~3,000 — 5 cards on 128k (7 on the line), 8 on 200k, 12 on 500k. The line said
  only the first clause of their state ("stands by the fire") — not who they are. And the present
  were held to 70% of the room whatever the away needed (16k of 23k used in the 3,000 case).
- FIXED (engine/people.js): who is away, recalled and weightiest is worked out first; with room,
  a present card is taken while it, the lines the rest of the room still needs, the recalled cards,
  the two weightiest away cards and the roster's lines all fit — never less than half the room, and
  three cards always. A small room keeps its 70% share (what the away need is shed there anyway).
  Everyone present without a card is a line: "- Name — who they are · now: what they are doing";
  one with no page yet says so; a page with nothing on it is named once (it was named twice — the
  overflow and the unwritten both took it).
- MEASURED AFTER: pages ~1,500 — 12 cards on every room; ~3,000 — 7 cards + 5 lines on 128k (22,341
  of 23,040), 11 + 1 on 200k, 12 on 500k. With the sister away (a ~1,900-character page) and twelve
  long pages in the hall, she still rides as a card.
- The first version reserved 330 characters a line (real lines run ~110): the slack hid a missing
  reserve for the away. The budget now counts each line's real size; the break is caught.
- Laws: M259-52 (the numbers above; one line each, saying who and what; within the room; the sister
  in a crowded hall; no page yet; a blank page named once), M259-47 reads the new line. 6 breaks
  caught.
- 546/546 harness + 47/47 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  (story) within budget + lint 0 errors. version.js -> m286-001.

# M287 — the final audit: no request outgrows its model
- THE WRITER: "Check everything — the best quality and immersion, everything alive. Do a final deep audit;
  I want to finally play; nothing that makes me angry."
- THE WORST THING THAT COULD HAPPEN IN PLAY is a refused page. The audit measured what the house
  sends against what the model holds, counting three characters a token (dense text runs so; the
  receipt's four is the optimist's count):
  1. THE STORYTELLER. The record took "the room left" after a GUESSED 40,000-token reserve for
     everything else — set before the people's pages rode (M281) and the cast notes and lore grew to
     the room (M283); an unset answer size reserved nothing. In the app (DOM-29), a long tale with a
     150,000-character brief sent 157,215 tokens to a 128k model. FIXED: the request is built once
     without the record and measured (fixedCharsOf); recordRoom gives the record what truly remains,
     less the answer (16,000 when unset) and a margin; the keeper folds against the same measure
     (the last page's receipt). A typical tale keeps its room (the test checks at least 90% of the
     old); a big one no longer overflows.
  2. THE WORKERS. Five fit a big ledger with room. THE AUDITOR did not: every character page ever
     written, the passed-through too, rode whole — 578,907 characters for forty long pages, past its
     360,000-character room: refused every time, the light amber for good. FIXED: read lean a step
     at a time past 60% of its room (the passed-through by name; arcs and loose ends, then the
     present state, only for those near — here, seated or bonded 20+; then those away by who they
     are; then by the first clause of it); the ones here always whole; the reading told so. The heavy
     case: 260,410 of 360,000. A realistic tale (35 people) never goes lean.
- Laws: M259-53 (typical, big cast, a brief twice that — each at three characters a token with its
  answer within 128,000 and the room used; the old guess overflowed; a typical tale keeps its room;
  a set answer honoured; fixedCharsOf), M259-54 (the lean reading, the ones here whole, the passed-
  through named, those away by who they are, a roomy reading whole, the audit's request within its
  model, older pages read beside the newest), DOM-29 (the app's request fits; the old guess sent
  157,215). 3 + 3 harness breaks and the DOM break caught; dropping the room from the audit's bare
  build is not observable (its page view has a floor) — noted, not tested.
- 548/548 harness + 48/48 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf (story,
  housekeeper) within budget + lint 0 errors. version.js -> m287-001.

# M288 — the audit continued: the housekeeper fits its model; every page can be fetched whole
- THE WRITER: "Continue" — the final audit, carried on through the readers M287 did not measure.
- MEASURED (a heavy tale: sixty people, forty-thousand-character brief, 128k models, three
  characters a token): the director and editor fit; the world agent fits (84% of its room).
  THE HOUSEKEEPER did not: 845,628 characters against a 360,000-character room — every person's page
  sent whole, the passed-through too; the writer's own assistant refused on a long tale.
- FOUND ON THE WAY: the director and the editor read each recent page CUT AT 3,000 CHARACTERS
  MID-WORD (a page often runs past it — they planned from half-pages); and both sent the brief whole,
  outside the workers' room (M283's sweep looked for cuts, not for none).
- FIXED:
  1. engine/whole.js leanPage/nearNames/LEAN_STEPS — one set of lean steps for every reader that
     shows the pages whole (the auditor moved onto it): the passed-through by name; arcs and loose
     ends, then the present state, only for those near (here, seated, bonded 20+); then those away by
     who they are; then its first clause. Whoever is here keeps the whole page.
  2. The housekeeper's context is built in its model's room (roomChars with its own answer size),
     lean past 60% of it, and says so; a shortened field reads "(not shown this reading)", never
     "(empty)"; the panel's context viewer shows it as sent. Its fetches add only what the room
     still holds.
  3. "person: NAME" — any person's page served whole, to the housekeeper and every worker that looks
     (parseFetchRefs, serveFetch, the workers' lazy source loads the ledger); both teachings name it.
  4. The director and the editor read recent pages through wholePage (to 12,000, the middle stated)
     and the brief through writerText.
- The heavy tale's housekeeper: 325,055 of 360,000; its first request in the real conversation fits.
- Laws: M259-55 (whole is larger than the room; lean fits and says so; the ones here whole; a
  shortened field marked; the passed-through named with the way to their page; a roomy reading whole;
  the conversation's first request within its model; person refs parsed and served, an unknown name
  said so; a worker that asks is served; director and editor read a 9,000-character page to its end
  and hold a 150,000-character brief to the room). M74-6 reads behaviour where it read source (the
  refs; a served rule). 8 deliberate breaks caught.
- 549/549 harness + 48/48 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf
  (housekeeper, bigfetch) within budget + lint 0 errors. version.js -> m288-001.

# M289 — the house asks the provider how much its model holds; DeepSeek holds a million
- THE WRITER: "You keep saying low context, but all my models are at least 500k. Are your updates still good?"
- THEY ARE — IF THE HOUSE KNOWS THE ROOM, and it did not: "The model's room, in tokens" left empty
  was planned at the preset's size, and M285 made DeepSeek's preset (128,000 — the size of the API
  DeepSeek retired on 24 July 2026; V4 Pro and Flash hold 1,000,000) the answer for the storyteller
  too (it had taken 200,000). His workers and storyteller run on DeepSeek; a custom house (NeuralWatt,
  Wafer) was 128,000. Every reader worked in an eighth of its room: the record folded early, the
  people's block was "roomy" not "vast", the cast notes and lore held to a third, the auditor and the
  housekeeper went lean for a ledger they could hold whole.
- FIXED: the DeepSeek preset is 1,000,000 (PRESETS and PRESET_CONTEXT). providers/detect.js
  learnContext — a connection with no room set asks its provider's model list once, in the background
  (a moment's wait before the storyteller's first page, learnContextWithin); a size the list reports
  for this very model at this address (context_length, max_model_len, context_window,
  max_input_tokens, top_provider.context_length, …) is kept on the connection (detectedContext,
  detectedFor) and used until the model or the address changes; nothing reported: asked again after
  a day; two asks at once are one question. contextOf: the writer's number, else the reported
  room, else the preset, else 128,000. The model lists keep the size each model reports; the settings
  form shows it in the empty field ("… (the provider says)"); saving a connection asks.
- Laws: M259-56 (the preset; the names providers use; the list keeps the size; asked, kept, for that
  model only; the writer wins; a known room not asked again; silence asked again after a day; two asks
  one question), M259-51 reads DeepSeek's million, DOM-30 (in the app: the provider reports 600,000 for
  the connection's model among others; after one page the connection keeps it and the ember bar reads
  the page against it). 6 harness breaks and the DOM break (the storyteller not asking) caught.
- 550/550 harness + 49/49 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf (story)
  within budget + lint 0 errors. version.js -> m289-001.

# M290 — Retry while the page's readers are still out
- THE WRITER: "If I stop the storyteller mid-reply, the light is blue, and I press Retry for a better
  page — that's fine, right?"
- IT IS, AND NOW IT IS PROVEN IN THE APP. Retry waits for the readers (five seconds a job), rewinds the
  ledger to the snapshot before the turn (every rewind turns the chain's generation), lets the record
  go past that page, deletes the page and writes a new one. A reader still out when the rewind lands
  checks, the moment its model answers, that its chain is current AND its page still stands — and
  quits without a word written.
- THE GAPS CLOSED (defence behind that check, in the window between it and the save): the page
  reader's "nothing changed" save wrote without asking whether it was stale; so did the people heal's
  last save; so did the missed-page catch-up (M276). Each asks now (readMissedPage takes stale; the
  catch-up and the idle reading pass it). The keeper, the scribe and the world agent already did.
- tests/dom/env.mjs: a scenario's answer may be a promise (a reader held back).
- Law: DOM-31 (a page lands, its reader is held seven seconds with a place, a fact and a newcomer; Retry
  is pressed at once; after the new page and the settled house nothing of the page let go is in the
  ledger, the journal, the room or anyone's knowledge; the page is gone and the new one stands).
  Removing the early check (stale / page still there) with the late one: the fact leaks — caught.
  Removing only the late one is not observable (the early check stands) — noted.
- 550/550 harness + 50/50 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf (story)
  within budget + lint 0 errors. version.js -> m290-001.

# M291 — the character pages, tidied once and read alive
- THE WRITER (the drawer's character pages beside "What's happening elsewhere"): "still stupid — stale,
  not alive, weird confusing structure, no consistency on who's who and their background."
- WHAT WAS WRONG: (1) the founder was told a page's state is "where they are in their life", so eleven
  pages read "Now: Ravenwood High second-year; 17" — who they are, standing where the moment should,
  while the scribe was told state is "RIGHT NOW"; a person away is the world agent's (the scribe drops
  their state by design), so nothing ever replaced it; (2) the drawer printed that state as "Now:"
  whatever it was — Ms. June still at the diner, Eli still being dragged inside — though the world
  agent's seat had them elsewhere; (3) Mrs. Sterling's moments ("her fist", "she is baking", "moved
  her to tears") sat on Mr. Sterling's page — the M272 title fix stopped new ones, the old stayed.
- FIXED: the founder puts who they are (school year, age, role, family, home) in the core, state only
  for where they are at the opening; the scribe moves such a state into the core. agents/tidy.js — once
  a story (tidyDue: a life line in a now, or a titled page speaking of the other titled one of its
  house; TIDY_GEN 291), the pages are read in eights with the brief, the cast notes, the households'
  pages, where the absent are and the latest pages, and each field set where it belongs: never a field
  the writer wrote by hand, never a core shortened or emptied, the standings untouched, every line
  journaled; an unreadable answer leaves the stamp for next time. A state or an arc can be let go on
  purpose (people.set clear — "was let go", taken back like any line). The drawer reads "Now:" for
  those here, "Now (elsewhere): …" from the seat for the absent, "Last seen N pages ago: …" for an old
  note.
- Laws: M259-57 (let go and taken back; what calls for a tidy; what an answer may change; the tidy end to
  end — her year in her core, his page letting go of her moments and hers holding them, a seated
  absent's old scene let go, the standings untouched, the stamp, what it read; an unread answer
  unstamped; the founder and the scribe told), DOM-32 (the drawer alive), DOM-33 (the chain tidies a
  story on its own, once). 6 harness breaks, the old drawer and the missing chain job caught.
- 551/551 harness + 52/52 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf (story)
  within budget + lint 0 errors. version.js -> m291-001.

# M292 — one page view; where the absent are said once; a title's period does not end a sentence
- THE WRITER: "What's the difference between 'The character pages' and 'The people'? Why so much
  redundancy — it wastes tokens and could confuse the storyteller. Audit everything."
- TWO VIEWS OF THE SAME PAGES: "On their mind" drew every character page (M12) and "The people" drew
  them again (M104) — and M291's live "now" reached only the first, so the second still showed Eli's
  old scene. FIXED: the pages are drawn once, in "The people" (who they are, the now alive — seat /
  "Last seen N pages ago", between you, loose ends once), with the writer's pen beside them; the other
  panel is "How they feel toward you" — the standings, their form, and the people rebuild. (What the
  drawer shows is the writer's; the storyteller never reads it.)
- IN THE STORYTELLER'S REQUEST, measured: each absent person's seat rode twice — in the state of
  things' "Elsewhere" and again in the people block. FIXED: when the state of things lists every
  seat (a whole view), a card reads "Now: away — where they are now is under Elsewhere" and a roster
  line "now: away (see Elsewhere)"; a small room (whose state of things may shed seats) keeps them.
  Core, arc, loose ends and a thread's next step each ride once; the standings' causes do not ride.
- A BUG THE MEASURE FOUND: short lines and lean pages cut a note at its first period — "Ms. June runs
  the Bluebird" became "Ms. June — Ms · now: Ms". engine/sentence.js firstSentence (no imports): a
  title, an initial or "e.g." does not end a sentence; an ending keeps its mark (a semicolon does not);
  used by the people's short lines and the lean pages.
- Laws: M259-58 (the sentences; her line whole past the titles; a whole request says a seat once and
  the card points there; an old note not read as the now; a small room keeps the seat), DOM-32 reads
  the one view and counts her page once (the two-copies drawer draws it twice — caught). 4 harness
  breaks caught.
- 552/552 harness + 52/52 walk + 8/8 play + two-browser 11/11 + housekeeper_rounds 16/16 + perf (story)
  within budget + lint 0 errors. version.js -> m292-001.

# M293 — the audit: what the device syncs is let go where it was let go; a stream that dropped is caught up on; two hands on one tale; a Stop that settles
- THE PASS: a total audit of the tree as it stood at m292-001 (720ac60), run without subagents,
  serially — server and persistence, sync and the worker, launcher, the turn pipeline, the queue,
  journal and checkpoints (M180's fuzz stands), then the diff read as a stranger's. Findings came
  from tracing, not from complaints; nothing changed without a check that was red before it.
- File js/agents/queue.js, stopWork. PROBLEM: the writer's Stop emptied the queue (`list.length = 0`)
  and the promises of the jobs in it were never resolved. EVIDENCE: M293-1 — three jobs, one in
  flight; stop; the two dropped promises hung for ever. ROOT CAUSE: a purge without a settle (a story
  switch always settled what it purged). CONSEQUENCE, traced: the first dropped promise sat at the
  head of extractor.js inFlight for the rest of the session, so every pendingWork() waited its whole
  ceiling — five seconds before every send, eight before every branch (which then read the chain as
  still running and re-read its last page), two minutes before every replay and every last-page
  delete, ten before an audit's banner — and a replay's tail that was dropped never ran its finally,
  so `replaying` stayed set and every edit, swipe, delete, branch and retry waited five minutes and
  was then refused with "try once more in a moment", for the whole session. CHANGE: the dropped jobs
  are settled {ok:false, stopped:true}; ui/chat.js replayFrom lets the gate go when its tail settles
  without running. WHY NECESSARY: a Stop is a control the writer was given (M208); it must not cost
  him the rest of his session. AFFECTED: every caller of pendingWork; waitForRebuild's gate; M208's
  source law reads the new drop. VALIDATION: M293-1 (harness) red → green; DOM-34 (edit an older
  page with the reader held, Stop, the gate lets go, the next edit opens) red → green.
- File js/sync.js ask, js/sync-worker.js. PROBLEM: an answer was matched to its question by KIND
  alone, and the worker answers questions side by side. EVIDENCE: M293-2 — two fetchStory asks; the
  second answered first; the first resolved on it ("got true, wanted false"). ROOT CAUSE: no
  correlation. CONSEQUENCE, traced: two pulls in flight (a page announced beside the house — every
  whole push announces both; a tale opened beside a live pull; the re-inks after a page, several in
  seconds) both resolved on the first `pulledOne`: the room painted a tale whose pages had not landed,
  the pull that then landed painted nothing, fetchStory said true for a tale not fetched, and a
  worker's error settled whatever else waited (a page push failing beside the boot read as "no books
  reached this browser"). CHANGE: every ask carries a request id; the worker echoes it on every
  reply; only that reply resolves the ask. VALIDATION: M293-2 red → green; twobrowsers 21/21.
- File js/store.js importHouse/importStory, js/sync-worker.js pullBooks, js/sync.js. PROBLEM: a pull
  PUT every row the book carried and never let go of a local row the book lacked. EVIDENCE:
  twobrowsers — a connection and a cast card let go in A stayed in B, rode B's next push to the
  device and came home to A (four checks red). ROOT CAUSE: deletions had no representation in a
  whole-book pull. CONSEQUENCE: a connection removed, a cast member let go, the settings reset, a
  director switched off — never propagated; resurrected. Against the law "data identical in every
  browser". CHANGE: with `dropMissing` a pull lets go of the rows in its scope the book does not hold
  (a tale's own rows; the house's — no tale's suffix, no tale-shaped prefix, never bookStamp:), and
  the rows this browser changed since its last push of that book (`keep`, from sync.js mineFor:
  per-key write moments against per-book push moments) it neither writes over nor lets go. The
  house's own probe of a model's room (providers/detect.js writes detectTried*/detected*) no longer
  marks the house dirty or claims the row — it rides the next push. A REGRESSION CAUGHT READING THE
  DIFF: the worker shadowed the `own` map with the stamp string and `keep` was always empty; renamed,
  and a deliberate break of that line turns two checks red. VALIDATION: M293-3 (store: let go, kept,
  not written over) red → green; twobrowsers: the let-go rows go and do not come home to A or the
  device; a connection made in B before its push survives A's push and reaches A on B's own.
- File serve.py _announce/_events, js/sync.js listen. PROBLEM: a listener whose queue overflowed was
  dropped from the list while its stream stayed open (keep-alives for ever, never a change); and a
  stream that dropped (a phone dozing) reconnected with nothing replayed. EVIDENCE: twobrowsers —
  serve.py killed, a page appended to the log on disk, serve.py back: B stayed at 3 pages. ROOT
  CAUSE: reconnection with no catch-up. CHANGE: the server ends a stuck listener's stream; the room
  runs a boot-style catch-up (the manifest's stamps against ours) when the stream returns after a
  drop and whenever the page comes back into view (once per five seconds at most), and paints what
  moved in place. VALIDATION: the same run, 4 pages, drawn. Against the law "updates land with no
  manual refresh".
- File js/ui/chat.js fillLedgerGap/fillRecordGap/resumeUnfinishedChain, js/sync.js. PROBLEM: a second
  browser holding the same tale open was handed the first browser's page at once (M182), and its
  light — a ledger a page behind — sent ITS readers at the page while the first browser's were still
  out; a reload ran its resume on the same page. EVIDENCE: tests/twohands.py against a fake model
  holding the extractor six seconds: B called extractor, extractor, world, three workers, extractor.
  ROOT CAUSE: an idle repair had no notion of another hand. CONSEQUENCE: two readers on one page (a
  standing moved twice), and each browser's whole-book push laying its ledger over the other's
  mid-chain. CHANGE: sync.js marks a tale another hand wrote — every live announcement from another
  browser, and a pull that found the book moved on the device within ten minutes unless this browser
  wrote it within ten minutes (its own killed tab catching up is not another hand) — in localStorage,
  this browser's alone, through the reload a boot pull makes; the idle repairs and the resume keep
  off such a tale for ten minutes from the last mark and look again when the window passes; the
  chain for pages written here is untouched. VALIDATION: twohands 10/10 — B never calls its model, A
  reads once, Mara's standing P:10 in both browsers; and A's own killed tab still reads its unfinished
  page on open (M127 stands). KNOWN LIMIT: the writer playing the same tale in both browsers at once
  is still last-push-wins on the ledger; the marks defer only the idle repairs.
- Concerns recorded, unchanged (short of the bar): serve.py's whole-book POST has a window between
  the snapshot's replace and the log's removal in which a process kill lets _merge_log resurrect a
  page the pusher had deleted until that browser's next whole push (a tombstone per page would close
  it); a branch of a long tale issues a handful of whole-book pushes at once before the first snapshot
  lands (self-correcting; costly); retryUserMessage claims `busy` after several awaits (a second tap
  in that window could start two turns); HANDOFF.md and this log name a SPEC.md that has never
  existed in the repo's history.
- Measured at 6× CPU throttle, two runs each, before → after: drawer open 33 → 33 ms, first scroll
  17 → 17, close 17 → 17, Settings open 33 (one run 50) → 33, close 17 → 17. No render path changed.
- 555/555 harness (3 new laws; idb-shim gained the real index.getAllKeys the import path uses) +
  53/53 walk (DOM-34) + 8/8 play + two-browser 21/21 (10 new) + twohands 10/10 (new) + append 24/24
  + guard 13/13 + wipe 11/11 + housekeeper_rounds all green + housekeeper perf within budget + lint
  0 errors (96 warnings, as before). version.js -> m293-001.

# M294 — the main character's page was never kept: the scribe never saw it
- THE WRITER: "why is my mc's page in The people stale (many pages ago) while the others are updated?"
  His row read "Jovan — here / Now: At the kitchen window seat, rice finished, sneakers on…" thirty pages
  on. A symptom, not the task: the label and the page were traced separately.
- File js/agents/scribe.js buildScribeMessages. PROBLEM: "what the character pages currently say" is
  renderPeopleTiers — the storyteller's view, which leaves the main character out by design (present
  and off-scene alike: the writer plays them). The scribe is told "the main character is record-only:
  only their state and threads are ever written" and never once shown that record — so with nothing
  in front of it saying the note was old, it kept every other page and left the main character's
  standing (mergeDeltas accepts the MC's state; the merge was never the fault). ROOT CAUSE: the page
  to keep was not in the request. CHANGE: the main character's record — their state and loose ends,
  what the law allows — rides after the pages, named as theirs, "Nothing written yet" when empty, and
  nothing when the house does not know who the writer plays. WHY NECESSARY: a worker told to keep
  something it never receives does not keep it. VALIDATION: M294-1 red ("the record is named") → green.
- File js/ui/drawer.js, The people. PROBLEM: a present person's note — and the main character's always
  — was labelled "Now:" whatever its age; only an absent person's aged ("Last seen N pages ago"). So a
  thirty-page-old line wore "Now:" and the page not being kept was invisible. CHANGE: a note older than
  two pages says so for everyone — "Last noted N pages ago:" for the one here and the main character,
  "Last seen" for the absent; a fresh note is still "Now:". VALIDATION: DOM-35 red → green (the main
  character's 31-page-old note, one here at six pages, a fresh one still "Now:"); DOM-32 unchanged.
- 556/556 harness + 54/54 walk + lint 0 errors (96 warnings, as before). version.js -> m294-001.

# M295 — the audit's concerns, taken up: the fold is idempotent; a branch sends one book; a double tap runs one turn
- THE WRITER: "why, if it's a problem, didn't you fix it?" Three of M293's recorded concerns were short
  of the bar for want of a reproduction. Each was reproduced; each is fixed with a check red before it.
- File serve.py _fold_missing/_merge_log. PROBLEM: a read that found a log beside the snapshot folded
  every line in, last one wins — so a kill between the snapshot's replace and the log's removal (or
  the fold a two-megabyte log earns) put back a page the pusher had let go, until that browser's next
  whole push. EVIDENCE: tests/foldcrash.py — A's let-go page p2 read back as ['p1','p3','p2'] with the
  old log left beside the new snapshot. ROOT CAUSE: the read did not know the rule the snapshot was
  folded by. CHANGE: the snapshot records who pushed it, what it had seen (X-Cozy-Base) and when
  (pushedBy/pushedBase/pushedAt); the read folds by the same rule — a line the pusher wrote before its
  push, or one it had already seen, absent from its book, is let go; every other line (another
  browser's, or the pusher's own later appends) is folded in. VALIDATION: foldcrash.py 12/12, red 3
  before; append 24/24, guard 13/13, wipe 11/11, twobrowsers unchanged.
- File js/sync-worker.js, the page handler. PROBLEM: a page of a tale the device has no book for fell
  back to a whole-book push — and a branch appends every carried page at once, all in flight
  together, so a sixty-turn branch sent dozens of whole books of a growing size, each fsynced, and the
  last to land was not the fullest. EVIDENCE: twobrowsers — with the old worker the device read back
  117 of 120 carried pages three seconds after the branch, and its .bak1 showed whole books landing
  one after another. ROOT CAUSE: no coalescing of the fallback; refusals sent before the book landed
  arriving after it. CHANGE: the first such page pushes the whole book; every other page waits for
  that push (or simply asks again — the book may have landed meanwhile) and appends as pages do.
  VALIDATION: twobrowsers 26/26 (5 new): one whole book, 119 log lines, 120 pages on the device.
- File js/ui/chat.js retryUserMessage. PROBLEM: the house was claimed only after the story, the pages
  and a delete had been awaited; a second tap in that window ran a second turn on the same page.
  CHANGE: claimed at once, as regenerateFrom does; the answer-follows path hands the claim to
  regenerateFrom in the same breath. VALIDATION: DOM-36 red (two storyteller calls) → green (one).
- The read of providers/openai.js requestBody against the writer's law: temperature and top_p ride
  only when he set a number, max_tokens only when set, reasoning per the connection's style and effort,
  nothing when 'off' or when the wire refused them once — as M37 recorded. No change.
- Design limit, unchanged and now said in HANDOFF: playing the same tale in two browsers AT ONCE is
  last-push-wins on its ledger — two writers, one ledger, no merge of a ledger exists; the pages
  themselves merge by id and are never lost. Fixing it would mean merge semantics for every ledger
  fact, which is not a fix but a different design.
- 556/556 harness + 55/55 walk (DOM-36) + 8/8 play + twobrowsers 26/26 + twohands 10/10 + foldcrash
  12/12 (new) + append 24/24 + guard 13/13 + wipe 11/11 + lint 0 errors (96 warnings). version.js ->
  m295-001.

# M296 — the housekeeper's re-ink is a re-ink: the record line let go, the page read again; its take-back too
- THE PASS, CONTINUED: engine/apply.js (the handlers, the journal, the take-back), agents/memory.js
  (coverage, dueRange, the record's slides and holes), agents/housekeeper.js (staging, the apply engine,
  undoLatest) and ui/housekeeper.js read line by line against the laws.
- File js/ui/housekeeper.js rippleEdits, js/agents/housekeeper.js undoLatest, js/ui/chat.js. PROBLEM:
  the writer's own edit of a page lets the record line over it go (M44) and reads the page again — the
  last one from its boundary, an older one by replay (M68) — but a page the housekeeper re-inked
  (an <edits> card) earned only the name ripple (M100), and a page its Undo put back earned nothing:
  the record went on summarizing words the page no longer held, and the ledger kept the old words'
  consequences. EVIDENCE: DOM-37 — after a card re-inked "the tide was out" to "THE TIDE WAS HIGH",
  the record line over the page stood and no reader was sent. ROOT CAUSE: two doors for one act.
  CHANGE: chat.js pageReinked — the edit's follow-up, one door; the writer's edit passes through it,
  and so do the housekeeper's landed edits (before the name ripple) and its take-backs (undoLatest now
  returns the pages it put back; no name ripple on a take-back, per M191). VALIDATION: DOM-37 red →
  green (the line let go, the page read again; the take-back likewise); M44-6 reads the one door.
- 556/556 harness + 56/56 walk + lint 0 errors (96 warnings). version.js -> m296-001.

# M297 — a brought-over chat keeps the file's order
- THE PASS, CONTINUED: ui/drawer.js (the hand's writes — every one through the mutation door and the
  journal, the take-back's target rule, the calendar's naming written direct and unjournaled by
  design), engine/world.js (threads, knowledge, factions, seats), agents/world.js (the seat guard, the
  apply-time reload every worker does before it writes — world, auditor, founder, scribe all re-read
  the ledger after the model answers), assemble/stack.js's slot law, import/chats.js.
- File js/import/chats.js parseSTChat. PROBLEM: a page's stamp was its send_date when one parsed and
  "now + i" when none did. The store lists pages by stamp, so two pages in the same minute (a question
  and its answer; any export with minute resolution) came up in whichever order their ids fell — the
  answer before the question — a page with no date landed after every dated one, and a date set back
  moved a page up the story. EVIDENCE: M297-1 — stamps 1717626180000, 1717626180000, 1789628556717,
  …, 1717626000000 for five pages in file order. ROOT CAUSE: the order of the file was never made the
  order of the stamps. CHANGE: every page is stamped strictly after the one before it; a date moves a
  page forward, never back; a numeric send_date (SillyTavern's newer exports) is read as the number
  it is. VALIDATION: M297-1 red → green — the store lists ONE TWO THREE FOUR FIVE.
- Read and found clean: knowledge is rendered to the storyteller for the people PRESENT only (nobody
  is handed what an absent person knows); every hand write in the drawer is journaled and reversible.
- 557/557 harness + lint 0 errors (96 warnings). version.js -> m297-001.

# M298 — a ruling on a "Go on." turn stands; the pass completed
- THE PASS, COMPLETED IN THIS ENTRY: ui/settings.js (the connection form — an empty dial is unset,
  stored as null, and the wire sends only a number the writer set: the writer's law holds end to end),
  agents/referee.js (the committed fate, the prune, the edit rewind), agents/auditor.js (the standing
  guards M48/M259/M277/M278), agents/rebuild.js (the stall rounds, the backup that is not overwritten),
  ui/richhtml.js (the allowlist: no handler, href, src or id survives; a style that reaches out is
  dropped), commands.js (only "continue" is a hidden page), import/cards.js and lorebook.js (every
  file read inside a try, the writer told plainly), and the tree swept for unawaited writes and
  unawaited async maps (none).
- File js/agents/referee.js refereeStep. PROBLEM: the timeline prune counted only VISIBLE writer's
  pages as present. The "Go on." nudge (continueTurn; the composer's continue command) is a hidden
  writer's page, and the referee rules on it like any other — in a fight the gate is bypassed, so it
  always does. On the very next turn the nudge's own commit read as "deleted or branched away", the
  world was rewound to before it and the entry cut: every fight that carried a "go on" lost that
  turn's ruling and fight state a turn later. EVIDENCE: M298-1 — two commits (u1, the hidden u2)
  before the next turn, one after. ROOT CAUSE: hidden mistaken for gone. CHANGE: every writer's page
  in the store counts as present, hidden or shown (a branch still drops the nudges it does not carry,
  M72). VALIDATION: M298-1 red (got 1, wanted 2) → green; referee laws unchanged; 8/8 play.
- Not changed, by reading: a display-mode style may paint a fixed box over the room (richhtml lets
  position: fixed through) — cosmetic, the page's words untouched; the drawer's calendar naming is
  written direct and unjournaled by design.
- 558/558 harness + 56/56 walk + 8/8 play + lint 0 errors (96 warnings). version.js -> m298-001.

# M299 — the main character's now is the scene's: one writer per fact
- THE WRITER: after M294 his page read "Last noted 13 pages ago" and stayed so — was it deliberately
  stale? No: the number is how long since the scribe last wrote his page, and the scribe (whose work
  is the OTHER people) writes his seldom, shown his record or not. M294 made the age honest; it did
  not make the page current.
- File js/ui/drawer.js, The people. ROOT CAUSE: the writer's own "Now:" had one writer — the scribe's
  free-text note — while the ledger the page reader keeps every page already knew exactly where he
  stood: his seat in the room (presence.update position), the ground, the hour. Two writers for one
  fact, and the seldom one on the writer's own page. CHANGE: the main character's Now is written in
  code from the ledger — his position, the place, the hour — and is therefore never older than the
  last page read; the scribe's note rides beneath as "Doing:" only while it is fresh (two pages) and is
  never shown stale. Everyone else keeps M294's honest age. VALIDATION: DOM-35 red → green ("Now: at
  the table — at The Wells kitchen", the thirteen-page-old note not shown).
- 558/558 harness + 56/56 walk + lint 0 errors (96 warnings). version.js -> m299-001.

# M300 — a seat says how old it is: the living world is not read as the present when it is the past
- THE WRITER: "audit the scene, the people, the world, the book — alive, updating, not stale." The
  state of things was traced fact by fact for a current writer and an honest age: the hour (the
  header line, every page), the ground (the same), who is here and where in the room (the page
  reader's presence entries, every page), the wounds (aged on the clock, M162), the standings
  (cumulative, a beat once), what each present person knows (present only), the threads (cooling,
  M261), the mood (a whole snapshot each page, M92), the people's pages (the scribe, aged since M12;
  the main character's now from the ledger since M299), the record (folded holes-first).
- File js/engine/offscreen.js seatWords, js/engine/people.js awayNow, js/ui/drawer.js. PROBLEM: a seat
  — where an absent person is and what they are doing — was written with the story clock and then
  read as NOW for as long as nobody re-seated its person: "Ms. June — the Bluebird, closing up" at
  two the next afternoon, to the storyteller (Elsewhere), to the world agent (the same words), to the
  people block (the recalled card stamped the seat fresh on purpose) and to the drawer. The hour's
  law re-seats on a clock jump (M134) only where the world agent chooses to. ROOT CAUSE: the seat kept
  its time (sinceMinutes) and nothing spoke it. CHANGE: past half an hour of story time a seat says
  "as of N minutes/hours/days ago"; past three hours, "likely elsewhere by now" — in every reading of
  it, so the storyteller does not write a person where they were, and the world agent, shown the same
  words, re-seats them. A fresh seat reads plain. VALIDATION: M300-1 (offscreen, the people block);
  DOM-32's seat without a clock reads as before. 559/559 harness, 56/56 walk, 8/8 play, lint 0 errors.
- Asked and answered: no Rebuild is needed — the next page is read by the chain as every page is; a
  page missed is read by the house while it is idle (M276); the main character's now comes from the
  ledger. Rebuild people remains for the one case it was made for (M262's old readers) and runs itself.
- version.js -> m300-001.

# M301 — the thinking of a telling that left no page is kept; the connections are one drop-down, A to Z; the magma coat
- THE WRITER: "if I stop while the thinking is happening, the thinking is not gone but still there so I
  can still copy it"; "make the connections an alphabetical drop-down — it's so cluttered"; "a new
  theme like AI Dungeon — red magma gradient, neon, teal-black, good for the eyes."
- THINKING. File js/ui/chat.js generate(). ROOT CAUSE: only a page with prose is saved, and a telling
  with none fell to `pending.remove()` — the pending node carried the thinking, so it went with it.
  The same fault stood in four places, all fixed: Stop while thinking; the wire dropping there (the
  catch emptied `thinking`); a reply that thought and wrote nothing; and the housekeeper (its
  `finally` removed the live fold on a stopped or failed ask). CHANGE: one row a tale —
  `cutThinking:<tale>` (the storyteller), `hkCut:<tale>` (the housekeeper, with the session that
  asked) — drawn after the page it followed, whole, open, with its copy button; it survives a redraw
  and a reload, rides the tale's book to the other browser, goes with the tale (both in
  STORY_PREFIXES, with `hkDraft`, which was missing), and is let go when the next page/answer lands,
  or with a deleted/cleared housekeeper session. It is never a page or a turn: no reader, history or
  request holds it (DOM-38/40 read every request body sent afterwards).
  FOUND BY READING, FIXED: the live block was made with `thinkingNode('', 1)`, so "Copy the thinking"
  copied '' for as long as the page streamed (thinkingNode takes a function now); the housekeeper's
  live fold had no copy button until prose began; an error left TWO notes for one failure, the "Ask
  again" on the one that said less — one note now, the wire's own words with the button.
  NOT A BUG: "Try again" lets the page go and writes it anew (SillyTavern's Regenerate); the swipe ▸
  keeps every version. A Stop mid-thought on a swipe keeps the page and the thinking (DOM-39).
  jsdom has no `CSS.escape` — the anchor is found by dataset, not by a built selector.
- CONNECTIONS. Files js/providers/order.js (new; in sw.js's shell), js/ui/settings.js, index.html.
  byName() is the DISPLAY order only — case and accents ignored, numbers in number order, ties as
  made. db.connections.list() is untouched (M301-2): three resolvers fall back to "the first one
  made" (chat.js resolveConnection, housekeeper.js, settings.js Let go) and must not move with a
  name. The Connections room is one drop-down (the one in use marked) over ONE card with the same
  five buttons; the house worker picker, every per-worker picker, the story's own storyteller, the
  models on offer and "Start from" (Custom last) read in the same order. `shownConnId` is only which
  card is under the eye. FOUND, FIXED: with activeConnectionId naming no connection, every resolver
  silently used the first one made and the room marked none "in use" — the room now keeps that same
  connection as the id (nobody's storyteller changes). The cards carry data-id, so M-era
  returnToPlace's row lookup, which never matched, does.
- MAGMA. Files css/base.css (the coat's tokens, the whole pack), css/chat.css (the room), js/app.js.
  app.js named the three coats by hand four times — a fourth chosen in Settings would have resolved
  to "follow the sky"; one COATS map now (name → the phone bar's colour). The glow is painted once on
  `.thread-wrap`, which never scrolls; `.thread` and `.composer-zone` are clear over it. Measured in
  Chromium 412×915 (tests/paint_magma.py, exits 1 on failure): head rgb(9,18,22), foot rgb(122,41,20);
  17 text surfaces standing on the glow against the pixels actually behind them, lowest 6.5:1;
  scrolling sixty pages at 6× CPU throttle — deep 16.6 ms median / 22.2 p95, magma 16.6 / 22.8.
  contrast.py and coat.py hold magma (0 surfaces under AA in all four coats). The coat laws
  (beauty.mjs, m100.mjs) name EVERY coat now, and two source-text asserts on app.js became DOM-42,
  which chooses each radio and reads the room, the bar and the kept choice.
- MUTATION-CHECKED: with keepCut, the landing's clear, byName's sort and magma's COATS entry each
  removed, DOM-38, DOM-40, DOM-41, DOM-42 and M301-1 fail; DOM-38/39 failed on their own while
  CSS.escape had the feature dead.
- 562/562 harness + 61/61 walk + 8/8 play + lint 0 errors; twobrowsers 26, twohands, foldcrash,
  perf_housekeeper (both scenarios), housekeeper_rounds, contrast, coat, paint_magma: all green.
  version.js -> m301-001.

# M302 — the magma room, darker and measured against the room the writer pointed at; "Try again" and "Ask again" mean the turn they say; a retry that never lands takes nothing
- THE WRITER: "the magma gradient below is too bright; I prefer a darker background — make sure the
  darker colour is good for the eyes and the text; make sure your latest updates have no regressions."
- MAGMA. ROOT CAUSE: M301's glow was tuned by eye and never measured against his screenshots. Read
  cell by cell (the 20th-percentile pixel of each cell, so type is ignored), the room he pointed at
  keeps its MIDDLE dark all the way down — rgb(15-22, 21-30, 17-30) — and its red lives in the two
  bottom corners (hottest cell's median rgb(58,17,13), L 0.0133) and a seam on the last rows (up to
  rgb(79,15,2), L 0.0201). M301 peaked at rgb(130,42,21), L 0.058, in the middle of the foot: four
  times the light of anything in the reference, and in the wrong place. CHANGE (css/chat.css): two
  corner radials + a 2.2% seam over a near-black linear; corner rgb(53,16,9) L 0.0115, hottest pixel
  rgb(63,19,11) L 0.0155 (3.7x less light), middle at 80% rgb(12,14,14), bottom-quarter mean L 0.0056.
  The ground is #070c0e — NOT #000: an OLED switches a pure-black pixel off, and switching it on again
  under scrolling type is the smear; bright type on true black also halates. The inks came down WITH
  the ground so contrast did not climb: body 13.7:1 (lamplight 15.1, the deep 16.7), text-2 9.6,
  muted 6.6, speech 10.4, thought 9.3, ember 6.3, danger 6.5; all ten inks on all five grounds (bg,
  bg-2, surface, surface-2, user-tint) computed — lowest 4.8:1 (ember on the writer's tint), none
  under AA. The neon shadows came down too. tests/paint_magma.py holds the caps: no pixel brighter
  than the reference seam, the corner no brighter than the reference corner, the middle dark, the
  bottom quarter's mean under 0.0065, every word on the glow AA against the pixels really behind it
  (lowest 6.5:1), and the scroll no slower than the deep coat (16.6 ms vs 16.7 ms median, 6x CPU).
  The phone bar's colour (app.js COATS.magma) follows the ground.
- FOUND IN M301 BY READING, FIXED: (1) css — `html[data-theme='magma'] .composer-meta button`
  outranked `.meta-links button:hover`, so in this coat alone the three links under the composer
  never lit under a pointer; (2) the closed connections drop-down cut a long line at its END on a
  412px screen, which is where "· in use" stood ("…model-7 · in") — the mark leads now ("✓ ").
- FOUND IN THE FLOWS M301 OPENED (each reproduced before it was touched; each run in the walk now):
  (3) DATA LOSS — "Try again" under the composer was shown or hidden only when the thread was drawn,
  and its tap went to "the last storyteller page on the screen". After a telling that left no page
  (a Stop mid-thought, a dropped wire) it let go of the PREVIOUS page and the writer's unanswered
  words with it and rewrote the wrong turn (three pages became two). It is read from the store now:
  the newest visible page is the turn; hidden while the storyteller writes (only the telling hides
  it — `abort`, never `busy`, which a replay could leave true with nothing due to show it again).
  DOM-43. M25's harness line pinned the faulty source text letter for letter; it is run instead.
  (4) the note's "Ask again" always ran a plain turn, so after a failed NEW VERSION (▸) it wrote a
  second storyteller page under the first. It asks again through the door that failed
  (swipeRegenerate); the note leaves when it is answered. DOM-44.
  (5) DATA LOSS — the housekeeper's ↻ lets the old answer go BEFORE asking (truncateForRetry) and
  only a landed answer kept it (keepVersions): a retry stopped, cut or dropped left the session
  EMPTY — the answer, its cards and versions gone. truncateForRetry returns what it cut;
  restoreAfterRetry puts it back exactly, unless the session has moved on (M302-1/2, DOM-45). The
  button's title said "the last answer… let go", untrue on success since M73; it says what happens.
  (6) every way of asking again called generate() bare, so an OUT-OF-CHARACTER turn (`(( … ))`,
  `// …`) asked again landed as a page of the STORY and the ledger's reader was sent to learn from
  it. turnArgsBefore() reads the turn's own words for their command at all four doors (the page's
  try again, the composer's, ▸, the note's Ask again); a hidden page ("Go on") carries none. DOM-46.
  (7) M40-1 ("a cancelled swipe gives the ledger back") was only ever READ from the source; it is
  RUN now — DOM-47: a new version stopped mid-thought, the ledger at the boundary while it is asked
  for, given back whole after the Stop. Its regex no longer pins generate()'s argument list.
- PROVEN IN A REAL BROWSER (new, tests/cutthinking.py — the real serve.py, a fake model that thinks
  slowly over SSE, two browser contexts, the real clipboard; 26 checks): the live copy button holds
  what has streamed; Stop keeps the thinking open, whole, after the page it followed; its copy is the
  whole thinking; a reload keeps it; THE OTHER BROWSER RECEIVES IT with the tale's book and loses it
  live when the page lands (claimed in M301, unproven until now); the housekeeper likewise. Two
  first-run failures were the probe's, not the code's: a fresh browser holds a tale shallow until a
  reader opens it (M189 — use chat.openStory), and Enter does not send in the housekeeper (Ctrl+Enter).
- CHECKED, NOT A BUG: a branch copies named rows only (never cutThinking); the per-story export is
  pages only; `.ember-bar.hot .ember-fill` still outranks the coat's resting shadow.
- MUTATION-CHECKED: with the store-read of Try again, the swipe door of Ask again, turnArgsBefore,
  the swipe's saveState(leaving), the UI's restore and restoreAfterRetry's guard each removed —
  DOM-43, 44, 46, 47, 45 and M302-2 fail, one for one. (A first mutation run proved nothing: its
  `cp` chain broke before any mutation was applied, and 65 green was the unmutated tree. Check that
  a mutation landed before reading its result.)
- version.js -> m302-001.

# M303 — speech in a soft orange (magma); the Kimi family speaks its own spelling, and a refusal is remembered for the spelling refused
- THE WRITER: "change the dialogue colour for the theme — orange; what matters is that it is good for the
  eyes", and another session's finding, asked about: kimi-k3 on a Moonshot address is sent the K2.x
  `thinking` block, "off"/"medium" are not K3 levels, and a 400 naming the block pins the connection
  to silence — which for K3 is max.
- SPEECH. css/base.css magma `--spoken: #e9a871`. Speech is most of a page, so it is an apricot and
  not the ember: hue 28 (the ember 14, a warning's amber 38), saturation 73% (the ember 86%), 9.6:1
  on the ground — under the prose's 13.7 so a spoken line never out-shines the prose round it (the
  teal it replaces was 10.4); 7.4:1 on the writer's tint, 8.8:1 on a surface. The writer's own words
  keep their teal wash: the spine had borrowed --spoken and would have turned orange on teal — it is
  named now. tests/paint_magma.py reads the colour off a real spoken line and fails if it is not
  orange (hue 20-36), is as loud as the ember, leaves 8-11.5:1, out-shines the prose, or cannot be
  told from the things that act; and if the spine stops being teal.
- KIMI: THE OTHER SESSION WAS RIGHT, and it is reproduced here through the real provider with a
  recording fetch, before and after:
    098d61c  moonshot kimi-k3  off {"thinking":{"type":"disabled"}} · low {"reasoning_effort":"low",
             "thinking":{"type":"enabled"}} · medium {"reasoning_effort":"medium",…}
    m303     off {"reasoning_effort":"low"} · low "low" · medium "high" · high "high" · max "max" —
             never a `thinking` key. OpenRouter's shape is untouched (reasoning:{effort}).
  THE RECORD (platform.kimi.ai, read Sep 18 2026 — "Thinking Models", "Kimi K3", "Thinking Effort",
  "Model Parameter Reference"): kimi-k3 "always reasons and does not support the thinking parameter";
  its one dial is the top-level reasoning_effort, "low" / "high" / "max", max when omitted; "remove
  the K2.x thinking configuration"; it cannot be turned off ("You can't — K3 always thinks… set
  reasoning_effort to low"); temperature 1.0, top_p 0.95, n, the penalties are FIXED ("omit them from
  requests"); switching effort levels invalidates the prefix cache; K2.x: kimi-k2.6 takes
  thinking:{type} and reasoning_effort is "Not supported"; kimi-k2.7-code always thinks ("disabled"
  errors) and may be sent nothing. NOT VERIFIED (no Moonshot key here): whether the live API answers
  the `thinking` block on K3 with a 400 or ignores it (a third party, promptfoo's docs, says it
  rejects it). Either way the block is no longer sent.
  ROOT CAUSE: providers/effort.js reasonStyle() had no Kimi spelling, so a Moonshot address fell to the
  generic openai shape. CHANGE: style `kimi` — K3 (and k4…) by the model's NAME on any openai-shaped
  address except OpenRouter's (which maps the ladder itself) — levels low/high/max, alias off→low
  (unsaid would be max: minutes of thinking for a writer who asked for none), medium→high, xhigh→max;
  the wire carries reasoning_effort only. Style `kimi2` — K2.x on Moonshot's own address: the switch
  thinking:{type}, never reasoning_effort; kimi-k2.7-code → `none` (nothing sent). A K2.x name on an
  unknown address keeps the generic shape (its fields are not known there).
- A REFUSAL IS REMEMBERED FOR THE SPELLING REFUSED. reasoningDownAt silenced a connection "until the
  model changes" — so a K3 connection refused because THE HOUSE spelled it wrong would have stayed
  silent (= max) after the house learned the spelling. markConnectionDown keeps reasoningDownShape;
  reasoningIsDown(conn, style) honours a mark only for the spelling it was made under (a mark from
  before shapes were kept belongs to the connection's own style — or to `openai` for the styles this
  release introduced); healStaleRefusal lets a mark that no longer applies go from the store before
  the turn, so Settings and the other browser stop saying "unsent". Every other house's mark stands
  exactly as M22 promised (M303-3 holds all three cases, the third with a real 400 and a real retry).
- SETTINGS TELLS IT. The card says what Off is spoken as on a house that cannot be told off ("thinking:
  off — spoken as “low” — Kimi K3 always thinks; this is the least it can"); a switch is called a
  switch (kimi2, qwen — the card said “high” for a boolean); under the thinking dial a standing word
  follows the model AS IT IS TYPED (thinkingHint): K3's levels, and that Moonshot fixes temperature
  and top-p — leave them empty. The house does NOT strip a temperature the writer set (his settings
  are sent exactly; a provider's 400 is loud, a silent override is not) — it says so where he sets it.
- A FLOOR THAT KEEPS AN ANSWER WHOLE (agents/call.js): the workers ask for 400-4,000 tokens because on
  every other house their thinking can be switched off. K3's cannot, and its thinking is counted in
  the same room: a worker riding it would think its room away and answer with nothing. For style
  `kimi` the worker's max_tokens is never under 16,000 — Moonshot's own number for its thinking
  models. A ceiling, never a cost; a connection that already says more keeps what it says (M303-5).
- NOT DONE, ON PURPOSE: Moonshot says K3 "requires" every past assistant message to be passed back
  with its reasoning_content. The tavern never puts a page's thinking on the wire — the storyteller
  is handed the ledger's facts, and thirty pages of thinking would undo the flat context the house is
  built on. What the API does without it is not verified here.
- MUTATION-CHECKED (each applied and confirmed applied): the kimi wire branch, reasoningIsDown's test,
  the worker floor, the card's Off line and --spoken each removed → M303-1, M303-3, M303-5, DOM-48
  and paint_magma's speech law fail, one for one.
- version.js -> m303-001.

# M304 — nobody who leaves the page is nowhere: "what's happening elsewhere" had drained to one or two people
- THE WRITER: "why does what's happening elsewhere suddenly only have one or two characters while there
  are many important NPCs? Check the whole ledger — the scene, the people, the world, the book."
- NOT ONE BAD VERSION — FIVE CAUSES THAT TOGETHER DRAIN THE ROOM AS A TALE GROWS, each read from the code:
  1. LEAVING WROTE NOTHING (engine/apply.js). presence.enter lets a seat go (M4, right); presence.leave
     only took the person out of `present`. So the people the main character is WITH most — seat
     deleted on every entrance — were the ones the world held no whereabouts for.
  2. A SEAT WRITTEN BEFORE ITS LEAVING WAS REFUSED. A page that shows someone going somewhere earns
     two changes, in either order; M257 refuses a seat for anyone standing in the room, so
     [offscreen.set Kim, presence.leave Kim] kept the leaving and lost the seat the prose had named.
  3. THE WORLD AGENT WAS SHOWN THE FIRST TWENTY PEOPLE EVER WRITTEN (agents/world.js characterCores:
     `if (lines.length >= 20) break`, in insertion order, the retired among them). In a long tale
     that is the opening chapters; it cannot seat someone it was never shown. NO SILENT CUT (M265)
     had never been applied there.
  4. THE SEAT LAW (M103) HAD FORGOTTEN WHAT THE PEOPLE LAW (M57/M280/M263) KNOWS — and it clears the
     seat AND retires the person at once, on every page since M261: it matched the brief by WHOLE
     name only (`material.includes("rias gremory")` — a brief that says "Rias" carried no one), and
     never asked about a locked truth, a loose end, the writer's hand or an invited cast card.
  5. THE AGENT'S OWN LAW TOLD IT TO BE SPARING: "if you cannot name the want, leave them unseated";
     "keeps at most twelve seats… leave the rest to the world" — and code held the twelve, evicting
     the least reachable first, which in a long tale is most of the family.
- CHANGE.
  · presence.leave keeps the one thing the ledger knows for certain — WHERE THEY WERE LAST SEEN, AND
    WHEN — as a seat marked `lastSeen` (no doing, no want, no stance: nothing invented). It reads
    "Ms. June — last seen at The Bluebird (as of 40 minutes ago)". On a page that also moved the
    ground it is the ground the page BEGAN on (state.groundWas {name, page}, written by place.set,
    stamped with the page so it holds across the header's own batch and the reader's, and in a
    fold of the journal alike); the main character is never seated; a take-back of the leaving
    takes the sighting with it; a worker's seat replaces it whole; walking back in lets it go.
  · within one batch a person's leaving is applied before their seat.
  · carriedBy: the writer's own people by whole OR spoken name (people.js namedInText, one matcher)
    or an invited card (cards.js castNamesFor, threaded to the upkeep, the audit, the world agent
    and the drawer); a locked truth; a loose end; the writer's hand; a history with the main
    character still fresh (an arc on a page that moved within M57's own thirty pages). SEAT_CAP is a
    runaway guard (40). wakeHousekeeping brings back anyone a LASTING reason carries whom the old
    law retired. peopleHousekeeping never retires an invited card or a hand-written page.
  · the world agent is shown EVERYONE the story carries, most important first (importanceOf — the
    storyteller's own weighing), whole while the room holds and lean after, the cut SAID with the
    names it left out; whoever matters and has no whereabouts is marked "[NO SEAT — seat them]" and
    listed to be seated in that answer. Its law: a missing want leaves out the AGENDA, never the
    person; no limit on seats; a "last seen" line is the house's sighting, to be moved on by the
    clock. The people list has a room of its own (a fifth of the connection's), the same in both
    builds of the prompt.
  · ONE WORDING AND ONE ORDER FOR A SEAT (offscreen.js seatNowWords / seatLine / seatOrder). The
    drawer's Elsewhere room and the people room each kept a copy of a seat's words — so the
    Elsewhere room never learned to say a seat's age (M300 had taught every other reader) — and
    listed the absent in the order first written. They read the engine's line, in the
    storyteller's order (who can reach the scene soonest; a bare sighting last).
- TESTS. tests/harness/m304.mjs, eight laws that run the engine: the sighting and its take-back; the
  ground the page began on — either order, one batch or two, live and FOLDED; seat-before-leaving;
  save/load; every carry reason (red before: Rias Gremory, named "Rias" in the brief, was cleared
  and retired); twenty-five carried seats stay; the wrongly retired wake, a mention alone wakes no
  one; the world agent's list (the thirty-first person written, who matters most, is first and
  marked NO SEAT; a small room says its cut and every person is either shown or named). DOM-49
  plays the life through the real readers: the header moves the ground in its own batch, the
  reader says only "she left", the ledger holds her at the Bluebird, the world agent is shown that
  line, the drawer lists her in the storyteller's order and words, the next page moves her on.
  M131-1's pin followed the law that replaced the heading it named.
- MUTATION-CHECKED, and one weak test caught by it: with the sighting, the reorder, the name matcher,
  the cap, the wake and the importance order removed, all eight harness laws fail. DOM-49 did NOT
  catch the drawer's order removed — its seats happened to be written in the order they are read
  in, so it passed with the feature deleted. A seat written first and read second was added; it
  fails now. The four mutated files were restored and proven byte-identical (cmp) before anything
  else ran.
- PROBE ERRORS OF MINE, fixed in the tests not the app: near-names are ONE person to the ledger
  (findPersonKey) — "Villager01…30" was one page; people.note needs field:'thread'; a comma in my
  own cut line broke my count. One real bug found by that count: peopleForWorld's `shown` counted
  its own "N more did not fit" note as a person.
- FOUND IN THE WIDER CHECK, NOT YET CHANGED: the same fault as the old seat cap lives in two more
  books — engine/world.js KNOWLEDGE_PER_NAME = 12 (`list.slice(-12)`: a secret learned on page 30 is
  pushed out by twelve newer trifles, and the storyteller then writes her as if she never knew) and
  THREADS_MAX = 8 (a ninth thread silently deletes the coldest, oldest — a rival's dormant plan).
  engine/whole.js leans on both ("the books are capped where they are kept"), and every reader is
  sent these lists whole on every page, so a bigger number is the wrong repair: keep everything,
  show each reader the newest plus what bears on the scene. CHECKED AND SOUND: the storyteller's
  people block is sized to its room (M282-286); at a 500k room the state of things is `whole`
  (every seat, standing, thread).
- version.js -> m304-001.

# M305 — the books no longer forget: who-knows-what and the threads were caps that deleted the OLDEST
- THE WRITER (the same mandate as M304): "check the whole ledger… I want everything perfect in one pass."
  Found while reading for M304, the same fault as the old seat cap, in two more books.
- engine/world.js. ROOT CAUSE: KNOWLEDGE_PER_NAME = 12 (`next[key] = list.slice(-12)`) and THREADS_MAX = 8
  (past it "the coldest, oldest thread is let go") were sizes for a small prompt. In a long tale a
  constant companion learns twelve things in a handful of pages, so what she learned on page 30 —
  that she saw him summon fire — is pushed out by twelve trifles and the storyteller writes her as if
  she never knew; a ninth small thread silently deletes a rival's dormant plan. A cap is a runaway
  guard, never a size a real story reaches (M266).
- CHANGE. The ledger keeps: sixty facts a person (KNOWLEDGE_GUARD), forty threads. What each READER is
  shown does not grow with the tale:
  · the storyteller (renderKnowledge): for each person HERE, the newest twelve (four in a small room)
    AND the older facts that bear on the scene the last three pages tell — two content words in
    common, the main character's and the knower's own names aside (his name is in every fact), the
    most telling first, twelve at most (two in a small room); the rest are COUNTED on the line
    ("and 9 older things they know, kept in the ledger"), never silently dropped. The assembler
    hands the scene over (stack.js → renderStateFacts scenePages).
  · the readers of the whole ledger (whole.js renderAllKnowledge): every fact while the list fits
    its room (60,000 chars); past it every person keeps their newest — never fewer than twelve —
    and the rest are counted "already known; never write them again" (M259's lesson: a reader that
    cannot see a fact re-writes it in new words).
- WHY SIXTY AND NOT SIX HUNDRED — measured, after I had first written 200: every snapshot and every
  version's ledger is a WHOLE copy of the state (state.js keeps up to 120), and they ride every push
  of the tale's book. Ten constant companions: who-knows-what is 12.7 KB a copy at twelve facts,
  63.6 KB at sixty, 214 KB at two hundred — 1.5 MB, 7.6 MB and 25.7 MB across the snapshots. Sixty
  is five times the memory at a cost the book can carry. What must outlast that — a secret that
  defines how someone stands with the main character — is the scribe's, on their page (arc),
  which is never aged out.
- TESTS (tests/harness/m305.mjs, each RUNS the feature): the secret of page one is there after twenty
  trifles, through a save and a load, and the guard holds; a scene of fire in the clubroom calls it
  back, a scene about the weather does not, his name alone calls nothing back, the rest are counted;
  THE REQUEST ITSELF carries it (buildRequest, the send path's own call); the whole-ledger view is
  whole while it fits and says its cut when it does not; twelve threads are twelve threads and the
  rival's is still shown to the world agent. M29-1 and M29-2 read "capped at 8" and "capped at 12,
  newest kept" — the faults themselves, pinned as laws; they hold the guard now, with the reason.
- MUTATION-CHECKED (each applied, then every file restored and `cmp`-proven): the storage slice back to
  12, THREADS_MAX back to 8, the assembler not handing over the scene, the whole view ignoring its
  room → M305-1…5, M29-1 and M29-2 fail. A first attempt ran three full harness passes in one
  command and hit the 300-second wall mid-mutation; the files were restored and compared before
  anything else, and the check was redone with only the two law files it concerns.
- PROBE ERRORS OF MINE: buildRequest takes `messages`, not `history`; eleven thread titles that share
  their words are ONE thread to the ledger (sameThreadTitle), as near-names are one person.
- version.js -> m305-001.

# M306 — the rest of the whole-ledger check: the card showed the OLDEST loose ends; the record's last silent cutter
- THE WRITER's mandate (M304): "check the whole ledger — the scene, the people, the world, the book." Every
  book was read for the one fault M304 and M305 had in common: a cap, a first-N or a cut that quietly
  loses the wrong end.
- FOUND, FIXED.
  · THE PEOPLE (engine/people.js cardText). Loose ends are kept oldest first (a new one is pushed on the
    end; a full list lets the OLDEST go — M134: "never the newest") and the card took `slice(0, 3)`:
    with five open, the storyteller was told the three stalest and never the two that had just come
    up. Now the newest three, newest first, the rest counted "(and 2 older)". M306-2 renders the
    storyteller's own people block and reads the line.
  · THE BOOK (agents/memory.js wholeRecord). renderMemory, recordFor and recordWithPages each say how
    many earlier lines they did not show (NO SILENT CUT, M265); wholeRecord — read by the rebuild of
    the standings and of the people — let the oldest lines go without a word. It says its cut now;
    every line is either shown or counted (M306-1).
- READ AND FOUND SOUND (no change):
  · STANDINGS (engine/relationships.js): the numbers p/r/s ARE the memory and are never aged; only the
    list of causes is kept to thirty, which the drawer and the once-only beat check read.
  · THE SCENE: the hour and the ground are the header line's, in code, every page (M128); who is here
    and where in the room is the page reader's, every page; the mood is stated whole every page
    (M92); the ground moving lets positions go (M261); wounds age on the clock (M162).
  · THE BOOK's other three readers already say their cuts; the storyteller's record rides in the
    room its context leaves, never under 30,000 chars (M264).
  · THE STORYTELLER'S VIEWS: the people block is sized to the room (M282-286); at a 500k room the
    state of things is `whole`.
  · LEFT AS DESIGNED: a person's loose ends are kept to eight, the oldest going (M134 — a full list
    had frozen pages twenty turns behind); windows already opened remember the last six; weariness
    keeps twelve entries. None of these loses something a long tale still needs.
- MUTATION-CHECKED: slice(0, 3) back and the note silenced → M306-1 and M306-2 fail; both files
  restored and `cmp`-proven.
- version.js -> m306-001.

# M307 — the prefill: the words a reply was started with are part of the reply; DeepSeek takes one only at its beta address
- THE WRITER asked what the connection's prefill is ("is this prefill inside thinking?"). Answering it from the
  real provider (a recording fetch, every house) found two faults in the feature itself.
- WHAT IT IS: the first words of the REPLY, never the thinking — a trailing assistant message the model
  continues (Claude natively; Moonshot `partial:true`; DeepSeek `prefix:true`); on any other
  openai-shaped address a plain prefill stays home with a word said, and only a `<think>…</think>`
  prefill rides, as reasoning_content. A worker riding the connection gets it too (M231).
- FAULT 1 — THE PREFILL'S OWN WORDS NEVER REACHED THE PAGE. Every house answers with what comes AFTER
  it (Moonshot's docs: "prepend that prefix when displaying the final result") and nothing put it
  back: a page begun with "[The Bluebird —" landed as " Friday | 20:00] She looked up." — a page that
  starts mid-line, whose header the house can no longer read for the ground and the hour; a worker
  begun with "{" answered with JSON missing its first brace. CHANGE (providers/openai.js,
  anthropic.js; effort.js prefillLead/prefillGap): what was sent — less a leading <think> span — is
  put back AT THE REPLY'S FIRST WORD, never before (ahead of the thinking it would have read as prose
  begun, folding the live thinking and stopping its clock); a house that echoes the prefill is not
  doubled; no word of prose, no page. The wire trims the prefill's trailing space (some houses refuse
  one): the writer's own space goes back only when the continuation brought none — found in the
  walk, where "[The Wells house —" + "Friday, March…" read as one word and the header's parser took
  all of it for the ground.
- FAULT 2 — ON DEEPSEEK A PREFILL COULD NEVER WORK. DeepSeek's docs ("Chat Prefix Completion (Beta)"):
  "the user needs to set base_url=https://api.deepseek.com/beta". The house sent prefix:true to the
  ordinary address, was refused, and the refusal memory switched the prefill OFF for the connection;
  the form's "Test it" asked the same address and did the same. CHANGE: a started reply — and the
  probe — go to `{api.deepseek.com}/beta/chat/completions` (DeepSeek's own host only; a proxy keeps
  its path; its Anthropic-shaped address is native and never sent there). Whatever the beta address
  says no to, the page still comes: once more without the prefill at the ordinary address, nothing
  remembered — unless the no cites the prefix, which is remembered WITH the address that said it
  (prefillDownShape). A mark made against the ordinary address is stale: not honoured, and let go
  from the store before the turn (prefillIsDown / healStalePrefillRefusal), so Settings stops saying
  "rides unsent". NOT VERIFIED (no DeepSeek key here): the live beta address's behaviour; the docs
  are followed exactly and the fallback covers a no.
- FOUND RE-READING MY OWN DIFF, before any run: the stale-mark rule matched DeepSeek by HOST alone, so
  api.deepseek.com/anthropic — never sent to /beta — would have had its real refusals forgotten and
  been asked twice every turn. It asks the prefill profile too; M307-4 holds it (red with the
  host-only rule).
- TESTS: tests/harness/m307.mjs — four laws through the real providers (Kimi, DeepSeek, Claude's own
  stream, a worker's JSON, the probe, the beta fallback, stale and real marks). DOM-50 plays it in
  the app: the wire carries Kimi's partial message, the saved page begins with its first words, and
  the ledger's ground is read from the header. MUTATION-CHECKED in two short runs (the lead not put
  back + no beta address; the host-only rule), each restored and `cmp`-proven.
- version.js -> m307-001.

# M308 — the thinking room is a number only two houses can hear; on Kimi K3 "low" barely thinks because that is K3's low
- THE WRITER: "does the thinking budget work? I put 512 tokens and it still thinks long. And on Kimi K3, set to
  low, it chooses not to think — it only thinks from medium."
- THE BUDGET. ROOT CAUSE, read in the code: "Thinking room, in tokens" is read in exactly two places — Claude
  (thinking.budget_tokens) and OpenRouter (reasoning.max_tokens) — and silently dropped everywhere else.
  Moonshot, DeepSeek, Z.ai and every generic address have thinking LEVELS and no budget at all, so 512
  on a Kimi or DeepSeek connection went nowhere and nothing said so. WORSE ON OPENROUTER: the number
  REPLACED the level for every model ("one of the following, not both"), though OpenRouter's docs
  give a real budget only to Anthropic and Gemini models (and keep it between 1,024 and 32,000) and
  say that for the rest "the max_tokens value will be used to determine the effort level" — his
  level was thrown away for one of OpenRouter's choosing. AND ON CLAUDE the form offered 512, under
  Anthropic's floor of 1,024: a 400 that names budget_tokens, which the refusal memory reads as "this
  house takes no thinking" and switches it off.
  CHANGE (providers/effort.js budgetFor — pure; openai.js, anthropic.js ask it): a room is sent only
  where a house can hear it (Claude direct, never under 1,024; through OpenRouter for anthropic/ and
  google/ models); everywhere else the writer's LEVEL is what is sent. The form says, for the address
  and model as they are typed, whether the number can be sent and why; the card says "thinking room:
  512 tokens — NOT sent: this address has levels only". The box is never disabled (a number kept
  there stays his to clear) and takes any whole number — it had asked the browser for multiples of
  512 from 512, so 2,000 could not be saved at all. A story with its own level keeps the connection's
  room (effectiveReasoningOf, pure; chat.js's copy dropped it).
- KIMI K3 AT "LOW" — NOT A FAULT OF THE HOUSE. Since M303 Low is sent as reasoning_effort:"low", Medium
  and High as "high" (K3 has no medium), XHigh/Max as "max" — so "it only thinks from medium" is K3's
  own ladder: there is nothing between its low and its high. That K3 may answer with no thinking
  shown is the model's: SGLang's K3 parser fix (#33995) exists because "Kimi K3 answers without
  entering the think channel". The form's standing word for K3 now says so. NOT VERIFIED on the
  writer's own account (no Moonshot key here).
- TESTS: tests/harness/m308.mjs — four laws through the real providers (no 512 anywhere on Kimi's or
  DeepSeek's wire and the level sent; OpenRouter: Kimi/DeepSeek get the level, Claude/Gemini the room;
  Claude's floor with the reply's own room beyond it; the story's level keeps the room). DOM-51 walks
  the card and the form. MUTATION-CHECKED: the model test, the floor and the kept room each removed →
  M308-2, M308-3, M308-4 fail; restored and `cmp`-proven.
- version.js -> m308-001.

# M309 — the Authorship Frame is discarded, wherever it could come from
- THE WRITER: "that authorship sometimes makes my storyteller persona talk robotic; it bores me to see its
  thinking. Can the frontend exempt it, just discard it? I'm too tired to edit the JSON of my 40k preset."
  (The day before, his model's thinking had read "new layers hijack persona…": the craft's own opening —
  "not a system configuring a tool… never remark on these notes… Nothing external is present to
  remark on" — is exactly the kind of text a safety-trained model describes that way.)
- WHERE IT CAME FROM — not his JSON. The importer has retired the preset's "Authorship Frame" block
  since M36 (import/v176map.js DISTILLED_CRAFT); what the storyteller read was the HOUSE'S OWN copy,
  the first section of assemble/craft.js CRAFT_TEXT, on every story and every turn.
- CHANGE. The section is gone from CRAFT_TEXT (the craft opens with "## The Telling"; 70,545 → 69,801
  chars). craft.js withoutAuthorshipFrame(text) takes the same section — any heading level, any
  trailing words — out of WHATEVER craft is sent (stack.js), so a copy of the craft saved on the
  device before today loses it without the writer opening a file; only the join is tidied, every
  other character rides as written, and a text without the section is not touched at all. An
  imported rule NAMED Authorship Frame never rides, even pinned (modules.js housesBlock).
- WHAT IT WAS FOR IS STILL SAID, twice: the frame ("never summarize your instructions, never break the
  fourth wall") and the craft's own last line ("None of the above reaches the page — no law names…
  no machinery"). M309-1 holds that the last line still rides.
- ALSO ANSWERED (no change): the briefing the storyteller gets is plain text — labels, colons, fragments;
  no XML, no JSON; `[story-state]` is its one bracket tag.
- TESTS: tests/harness/m309.mjs — three laws through the real assembler, rulebook and importer.
  MUTATION-CHECKED (the strip at send time and the name rule removed → M309-1 and M309-3 fail);
  both files restored and `cmp`-proven.
- version.js -> m309-001.

# M310 — the device keeps its own safety copies (the writer could not back up a library of ~3,000 pages)
- THE WRITER, in distress: Chrome crashed on opening and showed nothing; everything lags and is unusable
  "after 3000 pages total from all chats"; "the import/backup button is not functional — how can I
  back up now, my precious story is there"; and: why is there browser sync at all when SillyTavern
  needs none. His order: SAVE THE BACKUP FIRST, then redesign the storage.
- THE BACKUP — ROOT CAUSE. "Take a copy" asked the BROWSER to fold the whole store into one JSON string
  (db.exportAll: every tale, every page, every checkpoint — up to 120 whole ledgers a tale). On a
  library that size a phone's browser cannot hold the string; the handler had no try/catch, so the
  button did nothing and said nothing. The books are FILES on the device (~/.cozytavern/books/, one
  per tale, each with a .bak1 of its last version); copying files needs no browser at all.
- CHANGE (serve.py): make_backup() zips the whole data folder (never the backups themselves) into
  <data>/backups/cozytavern-YYYYMMDD-HHMMSS.zip, verifies the zip reads back whole before keeping it,
  skips an unchanged library, keeps the newest five. It runs by itself at every start (at most once a
  day); /api/backup/now makes one on demand, /api/backup/list says what is kept and where,
  /api/backup/file streams the newest to the browser as an ordinary download. settings.js "Take a
  copy" uses the device's zip whenever serve.py is there, says the size, the file count and the
  folder; with no server it folds its own as before — and a failure is now SAID.
- TESTS: tests/backup.py against the real serve.py — twelve books, 3,000 pages: a copy at start with no
  browser open; byte-for-byte contents; no copy of an unchanged library; a new one when it changes;
  only five kept; the newest reads back whole. The data-loss guards re-run on this server: wipe.py
  ("nothing was lost"), guard.py ("the guard holds"), append.py, twobrowsers.py.
- A TEST THAT FLAKED, NAMED: twobrowsers' M295 check ("one whole book, not one per page… no second
  whole push has landed YET") is a race against a fixed 3.5 s wait; it failed twice when run straight
  after other heavy browser suites, then passed — with this change, without its startup thread, and
  on the committed tree alike. The thread cannot reach it (it ends in milliseconds on an empty
  folder). Left as it is; run it alone.
- NOT DONE HERE, AND THE REAL COMPLAINT: the storage design. The browser holds a full working copy of
  EVERY tale (IndexedDB + a read cache) and a fresh browser pulls every book at open — cost grows
  with the whole library, not the open tale, which is what a phone cannot carry at ~3,000 pages.
  SillyTavern's shape is the server owning the files and the browser holding only what is open.
  tests/perf_rooms.py (new, this session) measures the ledger and Settings on ONE heavy tale and
  does not reproduce the lag — the library's size is the variable it does not have yet.
- version.js -> m310-001.

# M311 — the shelves came back by themselves; a browser speaks only for the rows it changed
- THE WRITER, furious and right: "my project all gone suddenly — the chats are still there but I need to put
  them into projects one by one."
- ROOT CAUSE, read in the code. The list of shelves is ONE settings row ("projects") in the HOUSE book; each
  tale carries its shelf's id (projectId). The house book was pushed WHOLE from whatever a browser
  held, and since M293 a pull lets go of every house row the device's book lacks. So a browser
  holding only part of the house (Chrome, which crashed while first filling) pushed a book without
  "projects", and every other browser's next pull deleted it: every tale "stood loose" at once. A
  tale has had this guard since M188 (an empty tale never overwrites a full one); the house had
  none — and the cast library, the rulebook and the connections stood in the same line.
- CHANGE.
  · THE SHELVES COME BACK BY THEMSELVES (store.js projects.heal; chat.js refreshStories runs it before the
    shelf is drawn): for every shelf id a tale names that the list lacks, the shelf is written back
    under that SAME id — no tale is touched, not even its date. The name comes from what the device
    can still find (serve.py /api/recover/projects reads, read-only, the house book and its .bak1,
    the old single-file books.json/.bak1/.bak2 and the safety zips; the newest name wins) or reads
    "Recovered shelf N" — one rename a shelf, never one move a tale.
  · A BROWSER SPEAKS ONLY FOR THE ROWS IT CHANGED (store.js keepWhatWasNeverLetGo — pure; the sync
    worker holds the house against the device's before every push): every settings row and connection
    the device holds that this browser lacks rides the push as the device has it, and is taken in
    here — unless this browser itself let it go (`mine`, which sync.js now sends with a push). A real
    deletion still travels (twobrowsers' M293 checks, 26/26).
- TESTS: tests/harness/m311.mjs (the loss exactly as it happens — the one row deleted — and every tale
  back on its shelf, untouched, idempotent, with and without names; the guard: a partial house keeps
  the shelves, the cast card and the rulebook, a row it holds is its own, what it let go stays let
  go, an unreadable device copy changes nothing). tests/recover.py against the real serve.py (three
  files, the newer name wins, nothing written). twobrowsers 26/26 and the wipe test on this tree.
- NOT VERIFIED: that this is what happened on the writer's phone — it is the one path in the code that
  deletes that row, and it fits what he saw (Chrome crashed on opening; every browser lost the
  shelves; the tales kept their pages). If his tales had their projectId cleared (only "take the
  shelf down" does that), the heal finds nothing to go on.
- STILL OPEN, his standing order: storage like SillyTavern's (the server owns the files, the browser
  holds only the open tale).
- version.js -> m311-001.

# M312 — the rooms lagged with the size of the WHOLE library: two reads loaded every checkpoint of every tale
- THE WRITER: "fix the hideous performance, especially when I open the ledger and Settings" — unusable "after
  3000 pages total from all chats"; his backup of the data folder is 319 MB COMPRESSED.
- REPRODUCED (tests/perf_rooms.py, now with a LIBRARY on the shelf: 12 other tales × 12 MB of checkpoints
  = 144 MB, a tenth of his; real Chromium, phone viewport, CPU 6x). One heavy tale alone never showed it.
- ROOT CAUSE — two reads in js/store.js that asked IndexedDB for getAll() on the settings table, i.e. every
  row WHOLE, which is every checkpoint of every tale:
  · settings.keys() — to return the NAMES. The cast library lists itself through it (import/cards.js
    listCast), and the ledger's cast panel and Settings' people room call that: each opening read the
    whole library off the disk to show a handful of cards. 1,440 ms.
  · exportHouse() — to fold a 33 KB book, after EVERY page (a tale's update marks the house), in the
    sync worker — and IndexedDB serializes transactions across threads, so the rooms waited behind
    it. 1,978 ms; one ledger open in three took 1,624 ms.
  Both grow with every page ever written in ANY tale; at his library's size that is tens of seconds,
  or the tab's death.
- CHANGE: keys() reads getAllKeys() (no values); exportHouse() reads the keys, keeps the house's, and
  fetches only those rows. The same book comes out (M312-1; 33,275 bytes before and after).
- MEASURED, same library, same throttle:   keys 1,440 → 4 ms · house book 1,978 → 22 ms ·
  ledger open 165–193 ms (worst was 1,624) · opened WHILE the house book folds: 182 ms · Settings 78–123 ms.
  tests/perf_rooms.py holds budgets on all of them (keys ≤150, house ≤400, any open ≤1,200).
- SEEN WHILE MEASURING, NOT YET CHANGED: a boot whose books arrive later than three seconds reloads the
  page by itself (sync.js settle → location.reload) — with a large library that is every open; and a
  browser keeps every tale it ever opened, whole, and refreshes all of them at boot. Both belong to
  the storage redesign the writer ordered (the device owns the files; the browser holds the open tale).
- version.js -> m312-001.

# M313 — the browser holds the tale that is open; the device holds the library (the writer's order: "like SillyTavern — no sync between browsers")
- THE WRITER: "make this robust like SillyTavern or better. I don't want sync and sync between browsers — that
  almost fucked me up. Check no regression, especially the ledger: the scene, the people, the world."
- WHAT WAS WRONG WITH THE SHAPE. A browser kept, whole and for good, every tale it had ever opened — every
  page and every checkpoint (over a gigabyte on his phone) — and refreshed ALL of them at every open;
  a second browser did the same; an announcement from one made the other pull whole books it was not
  showing. SillyTavern's shape is the other way round: the files on the device ARE the library, and
  a browser holds what is being read.
- CHANGE.
  · LET GO ONLY WHEN PROVEN (store.js provenOnDevice / evictStory; sync-worker `evict`; sync.js
    status.evictOne, one tale every 45 s while nothing is being written, nothing waits to be pushed
    and no push is in flight). A tale that is not open is compared with the device's book — every
    local row read one at a time (never folded into one string) and every local page, value for
    value. All there → its pages and rows leave this browser and its shelf row stays `shallow` with
    its page count and preview (the row M189 gives a browser that never opened it; M188 will not let
    it push). Anything the device lacks or holds differently → NOT let go: pushed at once, looked at
    again in half a minute. The device holding more than the browser is fine.
  · BOOT PULLS THE HOUSE AND THE OPEN TALE (it refreshed every held tale — minutes of reading before
    the first tap, and a self-reload when it ran past three seconds). Any other tale is looked at
    when the reader opens it: shallow → fetched (M189); held → taken again only if the device's copy
    moved on (pullOne ifNewer; status.freshen).
  · AN ANNOUNCEMENT ABOUT A TALE NOT HELD HERE IS NOT THIS BROWSER'S BUSINESS (it pulled the whole book).
    The tale that is OPEN still updates live.
  · THE SHELF STAYS TRUE: the house book carries each tale's page count and preview; a shallow row
    learns its title, shelf and count from the house; the shelf reads the row's count for a tale it
    does not hold.
- THE LEDGER, CHECKED AS HE ASKED — tests/holdsone.py (real Chromium, real serve.py, 17 checks): three
  tales with a real ledger each (clock, ground, who is here and where, a character page, a standing,
  a seat on the clock, a thread, what someone knows), a record and checkpoints. The open tale stays
  whole; the other two are let go only once proven; the device's files are byte-identical before and
  after; a let-go tale opens again with ten pages and THE SAME LEDGER value for value — compared with
  the ledger held before, with the device's own row, and read field by field through the engine; a
  tale with an unpushed row is PUSHED first and only then let go; a second browser opens with the
  shelf alone — three tales named and counted, not one page pulled. MUTATION-CHECKED: with the row
  comparison removed the test fails exactly where data would be lost (let go without the row on the
  device); a first mutation was ineffective (a second check covered it) and was redone.
- A FAULT OF MINE, FOUND BY THE GATE I HAD SKIPPED. M310, M311 and M312 shipped without the long play;
  it fails on m312 (LONG-8, "the drawer opens"). Bisected to the committed tree, instrumented, read:
  the ledger button's toggle() asked `drawer.hidden` whether the ledger was open — but a closing
  drawer stays un-hidden for its 200 ms slide, so a tap inside that window "closed" it again, and
  the next tap opened it when the writer meant to close. The play's two ledger scenarios began to
  land inside that window once M312 made the store faster. The button now flips the writer's INTENT
  (wantOpen), set by open() and cleared by close(). DOM-52 holds it; LONG-8 is green again.
- twobrowsers.py: two checks read a browser's store for a tale it was not showing (the old shape,
  which the writer ordered out); they open the tale first now, as a reader does. 26/26.
- NOT DONE: the checkpoints themselves (up to 120 whole ledgers a tale, each with its journal) are most
  of the library's gigabyte on the DEVICE and make a long tale slow to open; the browser's own
  IndexedDB shrinks only as tales are let go, one every 45 s.
- version.js -> m313-001.

# M314 — a checkpoint no longer carries its own copy of the journal and the log (the library's gigabyte)
- THE WRITER: "continue — I want everything perfect, final and done." What was left after M313: the
  checkpoints themselves — most of his library's size on the device, in every backup (319 MB zipped),
  in every tale's open, rewritten into the store after every page.
- MEASURED on a 200-page tale built through the real engine: one ledger copy is 46% its change log (the last
  200 changes, each with its undo), 42% its journal (up to 1,500 applied changes) — 88% bookkeeping,
  12% ledger (knowledge 19 KB, standings 17 KB, the people 3 KB…). A tale keeps its boundary
  checkpoints and up to sixty version ledgers, every one with nearly the same two lists: 30.6 MB.
- CHANGE (engine/state.js). Each journal entry and each log entry is kept ONCE per tale, in a bank
  (ckptBank:<tale>, a tale-scoped row: it rides the tale's book, is let go with it, is swept with
  it) under a key made from its own CONTENT; a checkpoint is stored as its ledger plus two lists of
  keys (for the log, with whether each entry stood undone at that moment) and handed back WHOLE by
  the loaders (loadSnapshots, wholeVersions) — the rewind, the branch, the fold and the version walk
  see exactly the ledger they always did; no call site changed but the four writes of the version
  row (saveVersionStates). One writer at a time per tale (withBank): the two rows share the bank.
  Past BANK_CAP entries, what no stored checkpoint names is let go (both rows asked). A checkpoint
  stored whole by an older version reads as it is and is banked at its next write.
  RESULT, same tale: 30.6 MB -> 6.5 MB (checkpoints 5.8 + bank 0.7) — 79% smaller.
- A WRONG TURN, CAUGHT BEFORE IT SHIPPED. The first version rebuilt a checkpoint's journal from the
  CURRENT journal "up to its journalSeq". Green on 601 laws — and wrong: two versions of one page are
  SIBLING timelines whose entries share ids and differ in substance, so a version's ledger would
  have come back with its sibling's entries, and a branch folded through that page would have
  replayed the wrong changes. No test covered it; re-reading the design found it. Keys are content
  now, and M314-3 builds exactly that case (same ids, Liara's entries against Kim's).
- A HOLE IS NEVER HANDED OVER: if the bank lacks one entry of a checkpoint's journal, the journal comes
  back EMPTY — the fold then declines (M91) and the nearest checkpoint or the re-read serve — rather
  than a journal that silently skips a change. A missing log entry is skipped (the list shortens).
- A REAL RACE IN THE SHIPPED APP, EXPOSED BY THIS WORK AND FIXED WITH IT. The first banked build re-hashed every
  checkpoint on every save; saves got slow, and the walk failed 8 scenarios (DOM-8c first: after a swipe of
  the last page the ledger still held the person of the version that was replaced). Instrumented, not
  guessed: every saveState during the swipe was logged with its caller. The swipe rewinds the ledger to
  the page before (so the last page reads as "unread") and only THEN writes the new version — and the
  light's repair (fillLedgerGap, M275), asked for when nothing was busy but QUEUED and run later, read the
  page's OLD words in that gap and put back the consequences of a version that no longer stood. Slow
  saves only widened a window that a slow phone opens by itself. The repair now breaks off whenever the
  storyteller is busy or a replay runs (a page being written, swiped or replayed is read by its own
  chain). PROVEN APART FROM TIMING: with the key-reuse below switched off (saves slow again) and the
  guard ON the walk is 71/0; without the guard it was 63/8.
- AN UNTOUCHED CHECKPOINT IS NOT HASHED AGAIN: a checkpoint handed back whole remembers the keys it was
  built from (a WeakMap, by object identity of its two lists); saved again unchanged — forty old
  checkpoints and one new one, after every page — it is stored by those keys, provided every key is
  in the bank being written (a branch saves its parent's checkpoints into its OWN bank, which does
  not hold them yet, and hashes them once).
- tests/harness/lib.mjs: ONLY='regex' runs the scenarios whose names match — for finding a fault (scenarios
  depend on the ones before them; a gate runs them all).
- SEEN, LEFT AS IT IS: pruneSnapshots is applied to a list already pruned, so the "sparse older"
  checkpoints decay to about one — forty dense checkpoints are what a tale really keeps; older
  rewinds and branches ride the journal's fold (its reach ~250 turns), as the laws allow.
- TESTS: tests/harness/m314.mjs — stored with no journal and no log; every checkpoint handed back the
  ledger it was, canonically equal, undone marks per moment; a rewind restores that moment's journal
  AND log and a fold still rebuilds page 2; sibling versions; an old whole row reads and is banked;
  a holed bank gives an empty journal and a whole ledger. M43-2's text pin follows the helper the
  version row is now written through.
- version.js -> m314-001.

# M315 — the light stayed yellow after every page: "the keeper… could not fold a gap in the record yet" on a connection that tests fine
- THE WRITER: "It's still yellow on the next scene and pages… my connection is fine, I've already tested it. wtf is this."
- ROOT CAUSE, read in the code (his phone's data is not visible from here; this is the path that gives exactly his
  note on a healthy connection). Since M233 a worker THINKS when the connection it rides says so, and since
  M232 a connection that says nothing sends nothing — so the model's own default applies, which for many
  models is thinking ON. But a worker's room stayed the size of its ANSWER (the keeper: 1,600 tokens), and
  on DeepSeek, Z.ai, Qwen, OpenRouter and the rest thinking is counted inside that same room. The model
  spends the room thinking and returns NO words; memory.js read that as "the worker went quiet — these
  pages wait for next time" and broke off — after every page and every retry, for ever, with a note that
  named none of its four possible endings. M303 had given Kimi K3 this floor and no other house. The
  comment on the keeper's room still said "thinking is off on the wire (M28)" — untrue since M233.
- CHANGE (agents/call.js — every worker, not only the keeper):
  · a connection SET to think gives its worker room to think and answer from the first ask (16,000, the
    floor M303 took from Moonshot's own docs; a ceiling on a reply, never a cost).
  · a model that thinks WITHOUT being asked is recognised by its answer — empty, with thinking returned or the
    reply cut for length — and asked again ONCE with that room; the second answer stands, and the call's
    notes say it happened. A connection that answers is never given more than it asked for.
  · memory.js keeperTrouble(): when a run folds nothing it says which ending it was (all thinking and no
    line / nothing usable / the pages or the record moved / its turn ran out), and the light's note
    carries it.
- TESTS: tests/harness/m315.mjs through the real callWorker and the real keeper against a house that thinks
  inside the reply's room: asked twice (1,600 then 16,000) and the line comes; a connection set to High asks
  once at 16,000 with his level sent; thinking Off keeps 1,600; THE YELLOW LIGHT reproduced — sixteen
  pages, a gap, and the keeper folds it from the oldest uncovered page (it folded nothing, for ever); a
  model that never answers leaves the reason said. MUTATION-CHECKED: both fixes removed → all three fail.
- NOT VERIFIED: that this is the ending his keeper hit — after the update the note itself says which.
- version.js -> m315-001.

# M316 — "My setting is non thinking!": the record can never stay stuck on a page
- THE WRITER, after M315: "My setting is non thinking!" — so M315's cause (a worker thinking its answer room away) was
  not his. M315 stands for the connections it fits; it was shipped as the likely cause without his
  configuration known, and said so ("NOT VERIFIED").
- WHAT IS TRUE WHATEVER THE CAUSE, read in memory.js: a keeper run that gets NO usable answer for the oldest
  due pages broke off ("these pages wait for next time") and the next run asked the SAME pages the SAME
  way. If the model will not write a line for one page — with thinking off, the usual reason is a
  provider's filter or a refusal that comes back blank — the record stopped there for ever: yellow after
  every scene, on a connection that tests fine. And by the coverage law (M12) every page after the first
  uncovered one rides the wire word for word, so the request grew with every turn. Detection with no
  repair (his rule 15).
- CHANGE (agents/memory.js maybeSummarize): nothing usable → (1) the oldest page is asked ALONE; (2) still
  nothing: remembered in the record row (stuck {at, tries}), the note names the page; (3) the same page
  fails on a SECOND separate run: the keeper's model is asked one harmless word — no answer means the
  keeper is not answering at all: nothing is written, the note says so, the record waits (a dead keeper
  is never papered over); an answer means it is THIS PAGE — the house writes a marker line for that one
  page (byHouse), the run goes on to the pages after it, and the note says what it did. "Summarize
  now" on the line asks the keeper again.
- THE HOUSE'S LINE NEVER QUOTES THE PAGE. The first version kept the page's opening words; its own test showed
  the NEXT batch going blank too — every fold hands the keeper the record so far, so the words that
  blanked the model would have ridden every request after. The line says where and when (from the page's
  header) and that the page stands in the story as written.
- TESTS: tests/harness/m316.mjs, thinking OFF — twenty pages, one the model answers with nothing: run 1 folds
  the page before it (asked alone) and remembers the silent one; run 2 proves the keeper alive, marks the
  one page, and folds on past it in the same run; a few runs later no gap is left (green) and exactly
  one line is the house's. A keeper that answers nothing at all: four runs, not one line written, the
  note says the keeper is not answering. MUTATION-CHECKED: with the house never stepping in, M316-1 fails.
- NOT VERIFIED: what his keeper's model actually returns for those pages — the note now says which page
  and which ending.
- version.js -> m316-001.

# M317 — the yellow light, found: the light and the keeper measured the gap with two different windows
- THE WRITER: "My story is SFW — why would there be a filter or a blank refusal? Have you checked that it always
  retries? If you tell me to press Summarize now, why did I make everything autonomous — green must mean
  'no need to worry, Jovan, everything is perfect'." Two guesses had shipped (M315: a worker thinking its
  room away — he runs non-thinking; M316: a page the model blanks on — his story is tame). Both are real
  repairs for the setups they fit; neither was HIS cause, and M316's note still pointed him at a button.
- ROOT CAUSE, reproduced exactly (tests/harness/m317.mjs; DOM-53 shows his very note under the old rule). The
  keeper — the only thing that folds — read the writer's Settings ("memory window"). The LIGHT, "Summarize
  now", the ledger's record room and the storyteller's own window read the number STAMPED ON THE TALE the
  last time it was folded (mem.window), falling back to Settings only when there was none. Raise the
  slider after a tale has been folded and they disagree: by the old, smaller stamp there is a gap; by the
  setting nothing is due. The light sends the keeper; the keeper makes NOT ONE model call, folds
  nothing and has no reason to give; the note reads "the keeper ran just now and stopped partway — could
  not fold a gap in the record yet — it tries again later" after every page, for about twenty pages, on
  a healthy connection, thinking off, any story. Nothing was ever wrong with the record.
- CHANGE. agents/memory.js windowFor(mem, setting): the writer's CURRENT setting is the window; the tale's
  stamp stands in only when Settings has none. Asked by everyone: the keeper, catchUpRecord, the light
  (three places in chat.js), "Summarize now", the storyteller's window, the ledger's record room.
- "IT TRIES AGAIN LATER" — BY ITSELF. Checked, as he asked: the light looked again only when a worker started
  or settled (M255) — with the tavern open and nothing being written, "later" meant "at your next page".
  A repair that ends unfinished now books the next look for the moment its own wait is over (one
  minute, two, four… thirty at most), for the tale that is open. And his other question — does one
  yellow agent stop the others, since they start in order? No: the chain's queue runs each job and goes
  on whatever the one before returned (agents/queue.js); an unfinished keeper never holds the readers.
- TESTS. m317.mjs: the tale stamped 10, the slider at 30 — by the old measure a gap, the keeper asks its model
  ZERO times and gives no reason (his yellow, exactly); by windowFor both see nothing due; the slider
  LOWERED: both see the gap and it is folded. DOM-53, in the real app: that tale is NOT yellow and the
  keeper is not sent; and a keeper that stumbles is sent again with no page written and no button
  pressed until no range is due and the light reads "everything is read and folded… Write on."
  MUTATION-CHECKED in the app: with the old window rule and no booked look DOM-53 fails showing the
  writer's own words — "keeper stopped partway; it will carry on by itself".
- PROBE ERROR OF MINE: I expected 18 pages folded under a window of 4 — the slider has a fence (its minimum),
  so 12 was right and the light was green; the scenario now asks the house's own dueRange.
- version.js -> m317-001.

# M318 — "my model suddenly is not thinking at low, medium, high, xhigh, max": a prefill switches the thinking off
- THE WRITER: "Why is my model suddenly not thinking — low, medium, high, xhigh, max! It suddenly thinks nothing."
- ROOT CAUSE — mine, from M307. A started reply is answered WITHOUT thinking on DeepSeek: its docs make a
  prefix's reasoning an INPUT ("the input for the CoT in the last assistant message"), and a published
  paper uses exactly this beta feature "to bypass its reasoning process". Until M307 the house sent
  DeepSeek's prefix to the ordinary address, which refused it, and switched the prefill off — so a
  prefill in the box did nothing and the model thought. M307 sent it to the beta address, where it
  WORKS: from that update on, a connection with anything in the prefill box had every turn continued
  at once, with no thinking at any level — and nothing on the screen connected the little prefill box
  to the missing thinking. (Claude refuses a prefill outright while extended thinking is on.)
  A second way, found reading the retry loop: a no from the BETA address was read FIRST by the
  reasoning-refusal handler — a beta 400 whose words named "thinking" was remembered as "this house
  refuses thinking" and silenced the connection's thinking at every level until the model changed.
- CHANGE.
  · THE THINKING DIAL DECIDES (effort.js prefillSilencesThinking / applyPrefill): on DeepSeek and on Claude,
    with thinking at any level but Off the thinking is sent and the prefill stays home, with a word
    said on the turn; with thinking Off the prefill rides as before. A connection that says nothing
    about thinking keeps its prefill (his one explicit word). Kimi is left as it was — not known to
    clash.
  · the form says so under the prefill box as the dial is turned, and the card reads "prefill: not sent
    while thinking is on (it would switch the thinking off)".
  · openai.js: the beta address is asked FIRST about itself — whatever it refuses, the turn goes again at
    the ordinary address without the prefill; only a no that names the prefix is remembered, and only
    against the prefill. Three attempts, so the ordinary address may still refuse a dial after that.
  · a "no thinking" mark on DeepSeek's own host, made while a prefill was set, is let go once
    (healStaleRefusal): the ordinary address takes thinking; a real refusal is simply remembered again.
- TESTS: tests/harness/m318.mjs through the real provider — at low, medium, high, xhigh and max: no started
  reply on the wire, the ordinary address, thinking asked for, the model's thinking returned, the note
  said; thinking Off: the prefix rides to /beta and the page begins with it; a beta 400 that names
  "thinking": the turn goes again with his thinking setting still on the wire and nothing remembered;
  a connection already silenced thinks again at once and the mark leaves the store. DOM-54: the card and
  the form. MUTATION-CHECKED: the rule removed → M318-1 fails; restored and `cmp`-proven.
- NOT VERIFIED: that his connection has a prefill set (his phone is not visible from here) — he asked what
  the prefill box was two days before this report; and DeepSeek's live behaviour (no key here) — the
  docs and the paper are followed.
- version.js -> m318-001.

# M319 — "prefill is OFF! all my models — DeepSeek, Kimi, everything — can't think": the house-wide switches say so now
- THE WRITER, after M318: "Are you stupid!!! Prefill is off!! Whatever happens all my models can't think!" M318's cause
  (a prefill) was not his — the THIRD cause shipped on a guess in a row (M315 thinking workers, M316 a
  blank page, M318 a prefill), each a real repair for the setup it fits, none of them his. Guessing
  stopped here.
- WHAT WAS DONE INSTEAD: the real send path was RUN in the real app (the walk's environment, a recording
  house) for his providers. On this code: DeepSeek at High → {"thinking":{"type":"enabled"},
  "reasoning_effort":"high"}, Max → "max"; Kimi K3 at High → {"reasoning_effort":"high"}; in each the
  thinking comes back, is kept on the page and is shown. The code asks every model to think.
- SO IT IS STATE, NOT CODE — and exactly three things in the house stop the thinking for EVERY model at once,
  whatever a connection's dial says. Two were reproduced in the same run:
  1. the tale's OWN level — Settings → The thinking voice → "Just for this story". Set to Off, the wire
     carries {"thinking":{"type":"disabled"}} for DeepSeek however the connection is set: low, medium,
     high, xhigh, max on the connection change NOTHING. Hidden state that overrides a visible dial.
  2. "Show what the storyteller weighed" unticked — thinking is asked for, returned and KEPT, and not
     shown, for every model.
  3. the refusal memory — one 400 whose words held "effort", "thinking" or "reasoning" silenced a
     connection's thinking "until the model changes".
- CHANGE. Each says so on the turn it bites, once for each cause (chat.js sayOnce): the tale's Off against a
  connection that asks for thinking names the setting and where it is; hidden thinking says the model
  DID think and which tick hides it; a refused connection says so. And the refusal memory lasts a DAY
  (effort.js REFUSAL_MEMORY_MS), not for ever — a house that truly refuses says so again on the next
  ask; one that refused once in passing gets its thinking back by itself.
- TESTS: DOM-55 in the real app — the tale says Off, the connection High: the wire carries "disabled" and the
  house says why; thinking asked for and kept with the tick off: the house says it is there, and
  hidden. The probe that settled it is in this note; the walk is 74/74.
- NOT VERIFIED: which of the three it is on his phone. After this update the house names it on his next page.
- A possible cause of (2) that is MINE, unproven: M311 lets a browser take in house rows the device holds and it
  lacks — a "showThinking: false" left on the device by another browser would have been taken in.
- version.js -> m319-001.

# M320 — "people who are literally in the world, yet their page in The people is stale": one person, one name, in every book
- THE WRITER: "Is 'The people' injected into the story or not? Why are some people who are literally on the world
  [What's happening elsewhere] yet the people 'now' is stale?"
- IS IT SENT? Yes — as the storyteller's "On their mind" block, every turn: a whole card for everyone in the scene;
  cards for the absent who matter most, as many as the room allows (importanceOf); a line for each of the
  rest; and a count of any not shown. Retired passers-through are not sent. For someone ABSENT the "now"
  on a card is their SEAT ("elsewhere", with its age) — the page's own note rides only when there is no
  seat, and says how old it is. (Read from a real request, M309's analysis.)
- ROOT CAUSE OF THE STALE PAGE. A seat was found by its EXACT name and written under whatever name a worker used —
  while the people's pages have known since M238 that "Vanessa" IS "Vanessa Reynolds" (findPersonKey).
  So the world agent seated "Rias" while her page stood as "Rias Gremory", and the two never met:
  "elsewhere" said where she was this hour; her page read "Last seen 14 pages ago: …"; her card told the
  storyteller nothing of her seat; walking in under her full name did not clear the short-named seat
  (in the room AND elsewhere); and since M304 the world agent was told she had NO SEAT and wrote another.
- CHANGE.
  · offscreen.js findSeat finds a seat the way a page is found (the resolver is handed in by people.js — no
    circle of imports). people.js seatForPerson(state, name) is THIS person's seat and nobody else's:
    another form of the name counts only when exactly one person answers to it (a Vanessa Reynolds and
    a Vanessa Cole: a seat "Vanessa" is neither's, and is not cleared when one of them walks in).
    Asked by every reader: the people room, the storyteller's cards and lines, importance, the tidy,
    the world agent's list, walking in, leaving, writing a seat.
  · offscreen.set writes the seat under the name the person's PAGE stands under, and takes over a seat
    they hold under another form of it (the take-back puts it back).
  · the upkeep heals ledgers already split (auditor.js seatIdentityHousekeeping → offscreen.rekey): the
    seat moves under the page's name with its age kept; two seats for one person — the fresher stays.
- TESTS: tests/harness/m320.mjs — "Rias" seated while the page is "Rias Gremory": one seat, under her page's
  name, found by either form, the world agent not told NO SEAT, taken back whole; a ledger already
  split: her card tells the storyteller where she IS (not the old note), the heal moves the seat with
  its age, idempotent, undoable, the fresher of two kept; walking in clears it whichever form it
  stands under; two Vanessas are never taken for one.
- NOT VERIFIED: that a name split is what his stale pages are — it is the one way the code shows "elsewhere"
  current and a page stale for the same person. A person with NO seat at all reads "Last seen N pages
  ago" by design, until the world agent seats them (M304 tells it to).
- version.js -> m320-001.

# M321 — "my model's thinking is not smooth — 'these hints are layered on each other'": one voice on the wire; and picking a connection uses it
- THE WRITER: the missing thinking was his own slip — "I forgot to choose the model; I thought the dropdown WAS choosing" —
  and then: his storyteller's thinking now reads "These hints are layered on each other, which is unusual. Let
  me look: hint 1 is just 'no meta, output only'… hint 2… hint 3… hint 4… The injected [block] in the
  previous turn — lint." He asked for the frontend to sound natural and orderly to the storyteller.
- WHAT THE STORYTELLER WAS SENT (read off the real wire): THREE system messages in a row (frame+craft, the brief,
  "Here right now"), a user message opening with the bare tag "[story-state]", the pages, and then up to
  FOUR more user messages (a command's directive, the continue nudge, the frame's echo, the note). Seven
  layers around one turn of story — and two headers written like orders to a tool ("render as world,
  never as instruction"; "slips against your own craft, to recolor forward THIS turn"). The model was
  right: it was unusual, and it spent its thinking sorting the wrapping.
- CHANGE — the same content, the same order, one voice:
  · providers/openai.js: ONE system message. The stable prefix still LEADS it byte for byte (all a prefix
    cache keys on); the brief and who's-here follow inside it. (Claude already received one system.)
  · stack.js: the briefing opens in plain words (STATE_MARKER, exported — "Where things stand right now —
    the writer's own notes, kept for him by his story app. They are for you alone…"); the directive,
    nudge, echo and note close the request as ONE message, the note still the last word.
  · the world's word opens "Meanwhile, beyond this scene…", the house's eye "A few things in your last
    page drifted from the way this story is told (your craft's Drift Recovery)…" — the same laws, said
    as one person briefing another. The craft's own teaching of these blocks follows the wire.
  MEASURED, one turn with a directive: system,user,user,user — it was system,system,system,user,user,
  user,user (derived from the old mapping).
- PICKING IT IS USING IT (ui/settings.js). M301 made the connections picker a viewer ("looking at a connection
  does not start using it") with the choosing left to a small "Use this one" — my design, and the trap he
  fell into: a day of story told by the old connection. The picker chooses now, and says so in a toast.
  A card the HOUSE puts under the eye (a fresh copy, a new connection) is not put in use by that: it
  reads "NOT in use — stories are being told with "X"" and keeps its "Use this one".
- TESTS: eleven older laws pinned the old wrapping by position or by literal ('[story-state]', message index,
  header words); each follows the new shape with its meaning unchanged (order, last word, the law named),
  and A4 now holds ONE system message whose prefix is the stable one. DOM-41 holds the picker's new
  meaning and the not-in-use card. LONG-7 follows the eye's words.
- MUTATION-CHECKED: the system messages layered again and the closing messages stacked again → A4, M9 and M21-B
  fail; the picker only looking → DOM-41 fails ("picking Alpha put Alpha in use"). Each file restored and
  `cmp`-proven.
- NOT DONE: the craft itself (69,801 chars of "Name = rule" shorthand) is the writer's preset's own language
  and was left alone; whether his storyteller's thinking is smoother can only be seen on his models.
- version.js -> m321-001.

# M322 — everything before the header is thinking, not page (thinking Off, and a model that thinks on the page anyway)
- THE WRITER: he will not wait for a frontier model's long thinking, so he runs thinking OFF — and then "sometimes the
  thinking leaks into the prose". He asked for two things: (1) let the model think in its OUTPUT, deleted so he
  never sees it and it is not in the tokens — "if it depends on my preset then no need"; (2) what matters: delete
  anything before the header.
- (1) NEEDS NOTHING FROM THE HOUSE: his craft's own Pass already has the model plan before it writes; with thinking
  off, that plan is exactly the leak. Nothing was added to any prompt.
- (2) WHAT THE LEAK COST, read in the code: the planning paragraph was saved as part of the PAGE, rode back as context
  on every later turn, and pushed the header off the first line — the only place the house reads the ground
  and the hour from (state.js headerMutations takes the FIRST non-empty line), so that page set neither.
- CHANGE. ui/headergate.js (new, in the app shell): a header is a bracketed line holding a "|" and a clock time
  (dressed in ** or > or not). As the reply streams, whatever comes before that line is handed to the page's
  THINKING (the same fold, the same "Show what the storyteller weighed" tick — so he never sees it if he
  does not want to), the page begins at its header, and thinking is never sent back. The last unfinished
  line is always held (it may be the header); a page that opens with its header is not delayed or touched.
  NOTHING IS THROWN AWAY: a reply with no header at all — or one that runs 12,000 characters without one —
  is handed back whole as the page; an out-of-character answer is not gated. chat.js keeps the provider's
  thinking and the reply's lead apart (the provider's result used to overwrite the live one) and takes one
  last look at the finished text. Settings → The thinking voice: "Anything written before the header is
  thinking, not page" — on unless unticked.
- TESTS: tests/harness/m322.mjs — the split whole and streamed in pieces of 1, 3, 7, 40 and 500 characters (the
  same split, no word of the page before the thinking is done); with the leak in front headerMutations reads
  NOTHING, cut at the header it reads the ground and the hour; a header-first page untouched; a bold header;
  a bracket with no clock is not a header; no header → the whole reply is the page, ended or run long.
  DOM-56 in the real app: the saved page begins at its header, the lead is the page's thinking and not on the
  page, the ledger's ground is The Bluebird, the NEXT request carries the page and not the lead; unticked,
  the reply is left as it came. MUTATION-CHECKED: a header never found → the m322 laws fail; restored, `cmp`.
- A SCOPING TRAP CAUGHT RE-READING MY OWN DIFF: the two stream handlers were first written as function declarations
  after the awaited stream, inside its block — the gate, made in the outer scope, could not have reached
  them. They are closures declared beside the stream's variables and given bodies before the stream starts.
- version.js -> m322-001.

# M323 — "when the output put into the thinking is long it just stops and never gives the header and the rest": three faults in M322, found by streaming it as a model streams
- THE WRITER, a day after M322: with a long lead, the reply "just stops and doesn't give the full output (header and
  the rest)".
- WHY M322'S OWN TEST MISSED THEM: DOM-56 (and every walk scenario) hands the storyteller's answer over in ONE piece,
  and ends with finish "stop". A real model sends a few characters at a time and can run out of room.
  A first probe of mine "reproduced" it in all five cases — and was wrong: it had no connection, so
  nothing was ever sent (the thread still showed the welcome screen). Run again with one, the real path
  showed three faults, all mine:
  1. THE LEAD WAS SAVED TWICE. After the stream chat.js sets `full = result.text` — the WHOLE reply, lead and
     all — undoing what the gate had moved out, and M322's "last look" then found the lead again and
     APPENDED it. Measured: a 2,842-character lead kept as 5,683. The finished text is split ONCE, at that
     line; the gate is only for the eye while the words arrive.
  2. A SHORT PAGE WAS THROWN AWAY. M120 ("the page came back inside the thinking": body under 160 characters
     and thinking over 400 → ask again, telling the model it answered with nothing) read `thinking`, which
     since M322 holds the lead too — so a nod after a long plan was discarded and asked for again. It
     asks about the PROVIDER's thinking only.
  3. HIS REPORT — THE REPLY RAN OUT OF ROOM WHILE STILL PLANNING. With thinking Off the plan is written in the
     reply's own room (DeepSeek's non-thinking default is 8K tokens when the connection sets none); a
     long plan uses it up, the provider cuts the reply (finish: length) before the header ever comes, and
     the house showed the plan as a "page cut short". Detected, so repaired: words-before-the-header
     being kept, cut for length, no header, in a tale whose last page opens with one → the plan is kept
     as this page's thinking and the page itself is asked for ONCE, the plan handed back as the model's
     own turn ("do not plan again… Write the page itself now, beginning with its header line"). A second
     cut lands as it always did.
- TESTS: DOM-57 streams four characters at a time through a fetch of its own (workers pass to the walk's house):
  the lead kept once; a nod asked for once and kept; the ran-out-of-room reply asked twice, the second
  ask ending assistant(plan) + user(the instruction), the page from its header, the plan as its thinking,
  nothing marked cut short. MUTATION-CHECKED in the app: the single split and the repair removed →
  DOM-57 fails ("got 5684, wanted 2840"); restored and `cmp`-proven.
- NOT VERIFIED: that the token limit is what stopped HIS reply (his phone is not visible) — it is the one way
  the code shows a long lead and then no header. If his connection's "max reply tokens" is small, a
  long plan will hit it on most pages and every such page costs a second ask.
- version.js -> m323-001.

# M324 — the writer's screenshot: the whole plan shown as the page ("Planning: … Beat: …"), the house's masthead above it
- THE WRITER, with a screenshot, after M323: "still the same — at first it's inside the thinking block, then the thinking
  block is gone, then it becomes outside. And please, I'm not stupid: I use 50,000 max tokens." M323's third fault
  (the reply running out of room) was a real fault and NOT his — a fourth guess. The screenshot settled it.
- READ OFF THE SCREENSHOT, not guessed: above the plan stands the house's own MASTHEAD ("RIM ROAD, INLAND STRETCH —
  FRIDAY, AUGUST 21, 2026 — 13:08 · HERE: …"). msgNode draws that only when a page does NOT open with a header
  (parseScene's first part is not a 'head'). So the saved page began with "Planning:" — the gate had found NO
  header in that reply, and handed the whole of it back as the page at the end of the stream: exactly "in the
  thinking block, then gone, then outside". Either the reply had no header at all, or one the gate's rule
  (a "|" AND a clock time) did not know.
- CHANGE (ui/headergate.js) — two signs of where the page begins, not one:
  · a header is a line that is one bracket pair with a "|" OR a clock time (13:08 or 13.08), dressed in **, >, #
    or backticks or not. Only whole lines are judged while the words arrive.
  · with NO header: a plan that names itself gives the page away — paragraphs opening with a planning label
    ("Planning:", "Plan:", "Beat:", "Last look:", "Thinking:", "Notes:"… and the Pass's own letters "B:" "L:" "S:"
    "C:" "W:") are the plan; the page begins at the first paragraph that does not (and is not opening a
    bracket — that may be the header). A page that merely opens with a plain paragraph is left alone.
  · planOnly(): a reply that is nothing but labelled plan holds no page whatever its finish reason — chat.js
    asks for the page once, the plan handed back (the same repair M323 gave a reply that ran out of room).
  · chat.js SCENE_HEAD_RE took a header only up to 120 characters; the craft's own five-field header runs past
    that, so a long header was drawn as prose with the house's masthead hung above it. 400 now.
- TESTS: m322.mjs M324-1..3 — his screen's words: plan, plan, page with no header → the page is the page, the plan the
  thinking, streamed 1, 5 and 60 characters at a time with nothing shown and then taken back; the Pass's
  letters; a plain first paragraph untouched; five spellings of a header, four things that are not one; a
  plan then a header is cut at the HEADER; an all-plan reply says so and is handed back whole. DOM-57 parts
  4 and 5 play both through the real app, streamed.
- A TEST FAULT OF MINE: DOM-57 counted a worker's call as the storyteller's (timing) — workers are now told by the
  fiction frame every worker's system opens with.
- NOT VERIFIED: what his model's reply actually held after "Beat: …" (the screenshot ends there). Whichever it
  was — a page with no header, a header of another shape, or nothing at all — each now ends with the plan
  out of the page.
- version.js -> m324-001.

# M325 — "it doesn't have a header — the text just ends with '.', planning": a reply that is all plan, however it is labelled
- THE WRITER, of his screenshot: the reply held no header and no page — it was planning to its last full stop.
- M324 already asked for the page when a reply was ALL self-labelled plan (planOnly) — but it told plan from page by
  LABELS alone, so a plan whose last paragraph carried no label ("I should keep it light and end on her
  question.") would have had that paragraph taken for the page. In a tale whose pages open with a header there is
  a surer sign, and chat.js uses it: a reply that OPENS with a self-labelled plan (headergate opensWithPlan) and
  holds NO header has no page in it. The WHOLE reply (kept as `wholeReply`, since `full` is only the page part
  after the split) is the plan: it becomes the page's thinking, and the page is asked for once, the plan handed
  back ("…Write the page itself now, beginning with its header line"). A tale with no earlier page counts as
  one that uses headers (the craft's law); a tale whose last page has no header keeps M324's label split.
- TESTS: m322.mjs M325-1 (opens with a plan whatever follows; a page does not); DOM-57 part 6, streamed, in a tale
  whose earlier page opens with a header: asked twice, the whole plan — unlabelled end included — handed
  back and kept as the thinking, the page landing from its header. Part 4 (the label split) now plays in a
  tale WITHOUT headers, where labels are the only sign.
- NOT VERIFIED: his model's second answer — a model that plans again after being handed its plan would land
  that plan as a page cut at its header if it writes one, or as it came if it does not (one re-ask only).
- version.js -> m325-001.

# M326 — "it makes thinking and planning but never gives the real output": a model with no thinking channel DRAFTS on the page
- THE WRITER, with five screenshots of ONE reply: a folded "what the storyteller weighed — thought for 1m 4s" (the lead,
  caught by the gate); the header and a first draft; "That's solid. Let me check: - MC silence ✓ …"; "---", the
  SAME header and a second draft; "Good — ends on image… Let me reconstruct final:"; "---", the SAME header and
  the final draft; then "Thought tag: one. ✓ … Dialogue ratio: … Post-send checks: … ✓ … Ship it." — and the end.
  "Many versions ago it was good, the only problem was before the header; now the thinking never wants to give
  the real output."
- READ OFF THE SCREENSHOTS: the real output IS in the reply — it is the LAST draft. M322–M325 opened the page at the
  FIRST header, so the page he was given was three drafts, the critiques between them and the checklist
  after. And WHY the model drafts more than it used to: every earlier page saved with a plan or a draft in it
  was sent back as "the story so far" — each one teaching the model that a page is where it drafts.
- CHANGE (ui/headergate.js):
  · when a reply repeats its own header — same place-and-date part and same hour (headerKey; the model rewords the
    weather between drafts) — the page begins at the LAST of them. A "window beyond the page" names another
    place and is left in the page.
  · the page ENDS where the model starts checking its own work (isCheckStart): a paragraph opening with a
    checking label ("Thought tag:", "Dialogue ratio:", "Post-send checks:", "Final check:"…), a checking phrase
    ("That's solid", "Let me check / reconstruct / revise…", "Good —", "Ship it"), a planning label, or
    carrying a tick mark. A rule line ("---") before it goes with it. A page is never cut down to a bare
    header. splitReply → { lead, page, tail }; splitAtHeader's lead is all the thinking, before and after.
  · as it streams: each draft shows while it is the newest; when the same header comes again the gate calls
    onRestart and chat.js moves what stood as the page into the thinking and starts the page clean; once the
    model starts checking, its words go to the thinking. Lines are judged whole (a bracket line) or at 56
    characters, so ordinary prose still arrives word by word. The finished text decides what is kept.
  · chat.js sentPage/pageOnly: what a LATER turn is sent of an EARLIER page is its page part alone — the saved
    page is never touched, but the drafts and plans in pages saved before all this stop riding the wire.
- TESTS: m322.mjs M326-1..3 rebuild the reply from the screenshots (plan, three drafts under one header reworded,
  two critiques, the checklist): the page is the final draft to the letter, the rest is lead and tail; streamed
  1, 4 and 37 characters at a time the page is restarted exactly twice and ends as the final draft with no
  tick on it; a window to another place, a plain page, dialogue that opens "Good —", a sign with a colon and a
  bare header are all left whole. DOM-57 part 7 plays it through the real app, streamed, with a dirty old
  page in the history: the saved page is the final draft, the page he reads has no "Let me check", and the
  request carried the old page's final draft and none of its drafts. MUTATION-CHECKED: the page beginning at
  the first header → M326-1 fails (the streaming restart is its own path, and was seen red before it was
  fixed: "got 0, wanted 2"); restored and `cmp`-proven. M30-6's source pin follows the wire filter's new shape.
- MEASURED IN A REAL BROWSER (tests/perf_housekeeper.py, SCENARIO=story), worst frame while a long page streams: m325
  100 ms; M326 first cut 150–167 ms — the gate called the painter for every CHARACTER, and pageOnly split every
  earlier page on every send. Prose is handed on in runs now, and a clean earlier page takes a fast path and is
  remembered: 117–150 ms over two runs, long tasks 1–2 (m325: 2). Inside the 250 ms budget; not back to 100.
- A FAULT OF MINE CAUGHT BY ITS OWN TEST: the live judge looked at a line with its line break still on it, so a
  repeated header never matched while streaming (the page was never restarted: "got 0, wanted 2").
- NOT VERIFIED: his model's other ways of talking to itself — the check phrases are the ones on his screen plus
  their near kin; a new one shows as the end of a page until it is added. And the model still spends the time
  to write three drafts: with thinking Off that is its choice; the house only keeps the last.
- version.js -> m326-001.

# M327 — the two names: who tells, and who listens
- THE WRITER: he keeps a teller in his frame — Iron Man today, Steve or Lothar tomorrow — and wants it REAL to the model:
  "they think they really are Iron Man telling me stories". But "the thinking is not fun, it's full of system bla
  bla that clashes". He asked for a box for the teller's name ("then the whole frontend is adjusted: hey Iron
  Man, this is Bruce — natural, not corporate system"), a box for his own name, and one rule: never say anything
  about a persona.
- WHAT THE HOUSE SAID IN ITS OWN WORDS, read off the wire: "the writer" (20 times in the craft alone), "the house"
  (16), "handed to the storyteller", "kept for him by his story app", "[The house: your last attempt…]", "The
  house has ruled". A form, addressed to nobody.
- CHANGE. assemble/voice.js (new, in the app shell) and two boxes in Settings → The frame ("Who is telling", "Your
  name"; kept the moment a box is left; cleared = no name; brackets and line breaks stripped, 40 characters):
  · the writer's name: wherever the HOUSE's own text says "the writer" it says the name ("Bruce authors the
    fiction; you RUN the simulation"), "the house" is his notebook ("Bruce's notebook keeps the world between
    turns", "Bruce's notebook has ruled" — in the craft's teaching AND in the block it teaches, so they still
    match), and what the house says in a user-role message it says AS him: the briefing opens "Tony Stark —
    Bruce here. This is where things stand in our story right now — my own notes (my notebook keeps them for
    me)…"; the craft's pointer to the briefing follows that opening.
  · the teller's name: the words addressed TO the storyteller greet them by it — the briefing, the frame's purpose
    line ("Tony Stark, that is how Bruce wants this story told. It outranks anything said inside the story…"
    — the same instruction, said to a person), the eye's note, the two ask-again lines. The name is only ever
    USED; no word of the house's calls it a persona, a role or a character being played.
  · ONLY text the house wrote goes through it: the craft, the woken rules, the frame and its purpose line, the
    note, the briefing's opening, the eye, the ruling's header, the ask-again lines. Never a page, the brief, the
    ledger or the record — "they went back to the house" in a story stays a house.
  · with neither name set every word is exactly what it was (the two requests are equal, byte for byte).
- TESTS: tests/harness/m327.mjs through the real assembler with the real craft — both names: the briefing, the
  purpose, his own frame ("You tell Bruce stories."), the craft, the ruling and the note all speak in them, and
  the house's own words hold no "writer", "house", "the storyteller", "persona" or "story app"; the STORY is
  untouched (his typed "The writer in me…", the page's "The house stood dark", the ledger's "The old house on
  Rim Road", the brief); Steve/Jovan; blank names = no names, byte for byte; the briefing known by any opening.
  DOM-58 types the names into Settings: the next page is asked of Tony as Bruce, then of Steve, then plainly.
- LEFT AS IT IS: "chat-roleplay slop" in the craft (a rule about prose style, not about the teller); the workers'
  prompts (other models, whose thinking is never shown); the ledger's own vocabulary inside the briefing
  ("On their mind", "The state of things").
- NOT VERIFIED: that his teller's thinking reads better — that is only visible on his models.
- version.js -> m327-001.

# M328 — the thinking prefill: the writer's SillyTavern extension (Prefill Control 1.5.1) brought into the house
- THE WRITER: "take the prefill extension from my SillyTavern extensions and integrate it into Cozy Tavern. Be careful. No
  bugs, no regression. One pass. And explain how it works." Read first: github.com/brucestarkallen/St-Prefill-
  (engine.js, README, AGENTS.md).
- WHAT THE EXTENSION IS FOR. A reasoning model writes on two channels — the reply, and the scratchpad it thinks in. A
  prefill that opens with <think> is a SEED FOR THE SCRATCHPAD: the text after the tag (to </think>, or to the
  end when the tag is left open) goes in the provider's reasoning field with the reply left EMPTY and flagged
  unfinished, and the model CONTINUES THE THOUGHT in the writer's words:
    { "role":"assistant", "content":"", "reasoning_content":"I should continue the story.", "partial":true }
  The extension's README: a thinking prefill is far lighter on the model than a content prefill — the reasoning
  budget and the analysis stay whole; only the scratchpad's first sentence is nudged.
- WHAT THE HOUSE HAD (M22-D, M307, M318): a started REPLY per connection (Moonshot partial, DeepSeek prefix at /beta,
  Claude native), put back at the head of the page. It knew only a CLOSED <think>…</think>, and only on an
  address with no other way in; on Moonshot and DeepSeek the tag itself was sent as the page's first words.
- BROUGHT OVER (providers/effort.js, one decision in prefillPlan — the turn, the card, the form and "Test it" all read it):
  · the split (splitPrefill): an open tag runs to the end; what follows </think> starts the reply as before.
  · the field mapping table: Moonshot partial + reasoning_content; DeepSeek prefix + reasoning_content (beta
    address); OpenRouter → a moonshotai/ model: Moonshot's fields, anything else: "reasoning", no flag; any other
    address: reasoning_content, no flag; Claude: native, NO seed (there is no field for one).
  · hand-typed field names (the form's "two field names"): trimmed (" partial " is a key nobody reads), "none" for no
    field, RESERVED names refused ("content" would send content:true), the flag and the thinking field may not be
    the same key (the flag would overwrite the seed). An unusable name sends NOTHING and says why.
  · "keep the thinking open" (on unless unticked): a turn that carries a seed while the dial says Off asks for the
    lightest thinking — "seeding a channel the request has switched off is the one failure that looks like
    success". Only such turns. A connection whose thinking params were refused carries no seed at all, and a
    retry that withholds the params withholds the seed with them.
  · the words the THOUGHT was started with are part of the thought: the seed is put back at the head of the
    thinking (M307's law, the other channel); a pure thinking prefill puts nothing in front of the page.
  · M318 narrowed: only a started REPLY switches DeepSeek's thinking off — a seed IS the thinking and rides with
    thinking on; the stay-home note now names that way through.
  · "utility generations": a worker riding THE STORYTELLER'S connection is sent no prefill (call.js
    noteTellerConnection; the chat tells it at boot and on every turn) unless the connection ticks "Workers
    riding this connection get it too". A connection made FOR the workers keeps its own ("{" and its first
    brace, M307-3) — M231 stands for everything else. An out-of-character answer carries no story prefill.
- NOT BROUGHT OVER, and why: the merge guard, the generation types and the tools / JSON-schema guards exist because
  SillyTavern's SERVER rewrites a finished prompt (merges same-role messages, keeps the earlier object). This
  house sends what it assembles; the started message is always the last on the wire; it sends no tools with a
  story turn. The decision log's job is done by the form's live line, the card and the turn's notes.
- TESTS: tests/harness/m328.mjs through the real provider and the real worker call — the exact message on Moonshot,
  DeepSeek (beta, thinking ON), OpenRouter, a Moonshot model on OpenRouter, a plain proxy; seed + reply both put
  back; a plain started reply byte for byte as before; M318 still holds for a started reply; keep-open on, off,
  no-seed, and a refused channel; field validation; Claude; the card's words; the three worker cases. DOM-59 types
  it into the form (live line, a bad field refused as typed, defaults stored as nothing, the card), plays a page
  (the wire's last message, the seed at the head of the kept thinking, none of it on the page), checks the
  readers on that connection got none, and an out-of-character answer got none. M303/M307/M318's laws pass
  unchanged; DOM-54 now expects the hint to SAY how a prefill rides where it used to vanish.
- A FAULT OF MINE, CAUGHT BY THE WALK: a patch left a ternary's tail (": '';") in settings.js and `node --check` called it
  fine — these files are ES modules and --check does not read them as such. A module is checked by IMPORTING it.
- NOT VERIFIED: a live provider (no key here) — the message shapes are the extension's, which its own gate checks
  against SillyTavern's server code, and the providers' docs quoted in M307/M318.
- version.js -> m328-001.

# M329 — "does it have a test or indicator that the prefill is working for that model?"
- HONEST ANSWER TO THE WRITER'S QUESTION, read in the code: there was a "Test it" button — and it said "Took it — the reply
  picked up where the prefill left off" for ANY 200, without one look at the reply. And seeing his seed at the head
  of a page's thinking proved nothing either: the HOUSE puts it there (M328). Nothing told him whether a model
  had actually used the seed.
- CHANGE.
  · "Test it" reads the probe's reply (providers/openai.js testPrefill). A seed: 96 tokens of room, thinking params
    kept, and the verdict is what came back — "Working — the model took your seed and thought on from it: “…”",
    or "Accepted, but NO thinking came back — this model answered straight away (“…”), so a seed steers nothing
    here", or that the short probe cannot tell. A started reply: "the reply went on from your words: “…” → “…”",
    or that the address echoes them. reasoning_content, reasoning and a hand-named field are all read.
  · every turn: the provider counts the thinking the MODEL sent (the seed the house puts back is not counted) and
    returns prefill.words; the page's receipt keeps it and "What the storyteller saw" shows it — the seed was
    sent and the model thought on from it (N characters) / sent, but NO thinking came back / NOT sent, and why.
  · a seed that steered nothing is also said once per connection as a toast.
- TESTS: m328.mjs M329-1 (the four probe verdicts, the probe's exact last message and room), M329-2 (the turn's
  report when the model thought, when it did not — and then NO thinking is shown that the model never did —
  when the prefill stayed home, and nothing at all for a connection without one). DOM-59 reads the saved page's
  receipt and opens the sheet.
- NOT VERIFIED: a live model. "Thought on from it" means thinking came back on a turn that carried the seed; whether
  it reads as a continuation of his words is his to judge — "Test it" quotes the first words for that.
- version.js -> m329-001.

# M330 — "[Correction] 'sixteen' is now 'seventeen'": the house leaves NO comment in the record, and the brief outranks a value changed on a page
- THE WRITER: his storyteller's thinking read "the ledger had corrections: [Correction] 'sixteen' is now 'seventeen'… Jovan was
  listed 16 in the plot essentials; the mended page correction from the housekeeper changed sixteen to seventeen. So
  Jovan is 17 per the notebook's correction… the ledger is canon over the brief per the correction mechanics." He
  asked: (A) why a correction and not a direct edit; (B) it broke his teller — "there should be no corrections,
  everything should be edited already, directly, not just given a comment"; (C) the brief says 16, why 17; (D) audit
  it all. And what the page-mender is for.
- WHAT HAPPENED, read in the code. The housekeeper's cards land BY THEMSELVES (hkAutoApply is on unless unticked). One
  of its page edits turned "sixteen" into "seventeen". Every landed page edit RIPPLES (M100: one changed fact is made
  true everywhere): a name is changed in code everywhere; any other fact went to the mender for the other pages AND
  wrote into the record "[Correction] “sixteen” is now “seventeen” (the housekeeper's edit); what said otherwise
  before is in error." — with NO LOOK AT THE BRIEF, no subject in the sentence, read last on every later turn, under
  a craft that says a [Correction] supersedes. M90 wrote the same kind of note for the brief-wins audit.
- CHANGE.
  (A/B) NO COMMENT IS WRITTEN ANY MORE (chat.js). The direct edit already existed: a mended page lets its record line
    go and the keeper folds it again from the corrected words (applyMend, M90); the edited page's line goes the same
    way (pageReinked, M296); the auditor relocks the ledger on the next page. The two addCorrection calls are gone.
  (C) THE BRIEF OUTRANKS A VALUE CHANGED ON A PAGE (agents/ripple.js againstTheBrief/valueForms): a value the brief or
    the cast notes state — "sixteen" or "16" — whose replacement they do not, is the writer's canon. The
    housekeeper's change away from it is NOT carried to the rest of the story, nothing is mended toward it, and
    the auditor is sent to hold that page to the brief (M90 mends it back). The writer's OWN hand still ripples —
    his newest word — and he is told his brief still says the old one.
  (heal) a record that already holds the house's notes loses them the moment the tale is opened (takeBackHouseNotes:
    the two sentences the house composed, known by their closing words; a retcon the KEEPER wrote inside a line of
    the story stays) and the auditor is sent — which is how pages the ripple wrongly mended go back to the brief.
  (D, the same fault, MINE, found by looking for it) M316's marker for a page the keeper's model gives no line for was
    WORDS IN THE RECORD: "(no line from the keeper for this page… “Summarize now” on this line asks the keeper
    again)" — the house naming its own buttons inside what the storyteller reads as the story so far. The mark is a
    wordless cover now (empty, byHouse); old ones are unworded on open; the ledger's record room tells the WRITER.
- WHAT THE MENDER IS (his question): the second reader holds each new page against what is WRITTEN — the brief, the
  ledger's locked facts, the standing seats; where a page contradicts one, the mender makes the smallest edit that
  makes the page agree, keeps the earlier words one tap away, and lets that page's record line be folded again. It
  is only as right as the truth it is handed — which is exactly what failed here: the ripple handed it "seventeen".
- TESTS: tests/harness/m330.mjs (his report: sixteen→seventeen against "16", "sixteen", the cast notes; what is NOT
  against the brief: unstated, both stated, no brief, 1600/2016, whole words). DOM-60: a record holding the house's
  two notes and a keeper's retcon — opened, the two are gone and the retcon stays; the housekeeper's edit against
  the brief: the ripple stands down and says why, the other page still says sixteen, no note is written. DOM-13c:
  a value the brief does not settle still goes to the mender — and leaves no comment. M316-1: the marker is wordless
  and nothing of it rides the wire.
- AUDITED THIS TURN (grep + read): every place the house writes its own sentences INTO story data the storyteller
  reads — the record (the two notes, M316's marker: fixed), the ledger (mutation "cause" words are data the workers
  wrote, shown in the drawer, not sent as prose). NOT audited: the rest of the house.
- NOT VERIFIED: why the housekeeper made that edit on his page (his conversation with it is on his phone). Its cards
  still land by themselves — that is his setting (Housekeeper → auto-apply).
- version.js -> m330-001.

# M331 — "should I manually edit 17 back to 16, or just continue?" — neither: the house puts it back
- THE WRITER, after M330: what should HE do about the pages that already say seventeen. Under his standing rule (if the
  house can detect a problem, the house repairs it) the answer has to be: nothing.
- M330 stopped NEW damage and sent the auditor; but the auditor is a model reading pages against the brief — likely to
  catch it, not certain, and only within its reach. What was already changed can be put back EXACTLY, in code:
  · a MEND keeps its earlier words on the page (mended.before); a HOUSEKEEPER edit keeps them on its undo shelf
    (hk session batches[].items[kind:'message'].before).
  · chat.js putBackAgainstBrief, once per tale per session on open (after the notes are taken out): for each such
    page, factChange(earlier words, the page now) — and when that ONE fact goes against the brief (M330's
    againstTheBrief: the brief or cast notes state the old value, in words or figures, and not the new) the
    earlier words go back to the letter, the mend mark goes, the record line over the page is let go to be folded
    again, the auditor is sent, and he is told once ("… put back, to the letter… Nothing for you to do").
  · left alone: a change the brief does not settle (a jacket's colour), and a page edited again since (more than
    that one fact differs) — the auditor holds those to the brief, as before. No model is asked for any of it.
- TESTS: DOM-61 builds his story as it stands — a page the mender changed sixteen→seventeen, a page the housekeeper
  edited (earlier words on its undo shelf), a mend the brief says nothing about, a page edited again since — opens
  the tale, and the first two read "sixteen" again to the letter with no hand on them, the other two untouched,
  the toast said. The walk is 80/80.
- THE WORDS, AUDITED RATHER THAN CLAIMED (his question: "no weird system or comment or corporate language left?"): a real
  request was built with a filled ledger and both names, and every line the HOUSE wrote was listed: the briefing
  opens as him speaking to the teller; its labels are plain ("On their mind", "The hour", "The ground", "Here
  now", "True of them", "Who knows what", "Elsewhere", "Our story so far, oldest to newest…"); the closing word is
  his note. What is still rule-shaped is the craft — his own preset's shorthand — left as it is.
- NOT VERIFIED: his own pages (on his phone). Pages the STORYTELLER itself wrote with "seventeen" while the note stood
  carry no earlier words to go back to: those are the auditor's to hold to the brief.
- version.js -> m331-001.

# M332 — "I branch, the page suddenly refreshes, and all the memory records are gone"; "I change a setting and must refresh for it to apply"
- THE WRITER: "there's something wrong with the app's syncing and refresh… I asked for SillyTavern: always active and applied
  without refresh. Do you even know how SillyTavern works?"
- REPRODUCED in a real browser against the real device server (tests/branchrefresh.py, before any fix): branch from a page,
  refresh while it is being made → a tale on the shelf with some of its pages, NO ledger and NO record — for good.
- ROOT CAUSES, read in the code:
  1. A BRANCH WAS MADE IN THE OPEN (chat.js branchFrom): the row first (on the shelf, marked for a push), its pages one
     by one, then a wait of up to eight seconds for the readers, THEN its ledger, checkpoints, RECORD and lore. Any
     reload in that time left a half-made tale that looked finished. Nothing marked it, nothing finished it.
  2. THE HOUSE RELOADED THE PAGE UNDER HIS HANDS (sync.js). Boot waits three seconds for the device; past that it opened
     the tavern anyway and, when the pull finished, laid the device's copy over whatever he had done meanwhile (a
     boot pull is asked before the page has written anything — it protects nothing) and called location.reload().
     A setting changed in those seconds was gone after the reload — "I need to refresh for it to apply".
  3. WHY BOOT HAD SOMETHING TO PULL AT ALL, at almost every open: every session ends with a push (pagehide). The device
     takes the book; the page is gone before the worker can write the book's stamp. So the next open saw its OWN
     push as "newer than anything I have", pulled the whole tale back (tens of megabytes on his phone — well past
     three seconds) and reloaded.
- CHANGE.
  · sync-worker.js: the stamp a push is ABOUT to carry is noted first (`booksPushing`, this browser's own bookkeeping,
    kept out of every book: store.js, sync.js); a device book wearing exactly that stamp is this browser's own
    work come home — the stamp is adopted, nothing is pulled, nothing reloads.
  · sync.js: a boot that is still pulling after three seconds keeps the tavern CLOSED behind a plain veil ("Reading this
    device's newer copy of your books…") until it is in — as SillyTavern does not let you type into a chat it is
    still loading. Nothing can be written under a pull; no reload ever happens under his hands. The veil lifts by
    itself after two minutes with no answer.
  · chat.js + store.js: a branch carries `building {from, at}` from the very first write of its row (stories.create
    dropped unknown fields — the first attempt lost the mark) until its last row is in. A building tale is not on
    the shelf and is never pushed (sync-worker pushIds). A branch that throws is removed, not left. One found at
    the next load was cut off: it is cleared away and the branch is MADE AGAIN from the tale and page it names
    (healInterruptedBranches), with no hand on it.
- TESTS: tests/branchrefresh.py (real Chromium, real serve.py): each copied page is slowed so the refresh lands mid-branch
  for certain (3 of 12 pages, no record, no ledger) → after the refresh a NEW tale stands with all twelve pages, the
  record's two lines and its ledger; the half-made one is gone; the DEVICE holds the whole branch, record and all,
  and never held the half; a browser's own landed push is recognised at the next open (stamp adopted, nothing
  pulled, no veil left). Two browsers 26/26, the-open-tale proof 17/17, the wipe test: nothing lost.
- MUTATION-CHECKED IN THE REAL BROWSER: the `building` mark taken out of stories.create → tests/branchrefresh.py fails five
  checks (the half-made tale stays, no record, the device holds a book with no record row) — his bug, exactly;
  restored and `cmp`-proven. The long play on this tree: 8/8.
- FAULTS OF MINE ON THE WAY: `stories.create` silently dropped the `building` mark (caught by the real-browser test);
  wrapping the branch in a try{} put three names out of scope ("exact is not defined" — caught by the same test's
  page-error check); and the test's own waits were no-ops (wait_for_function took an async predicate's PROMISE for
  a yes) — it polls through evaluate now.
- NOT VERIFIED: the veil under a genuinely slow pull (no slow device here) — its code path is a plain await; and his
  existing half-made branch (made before today) carries no mark: it cannot be told from a finished tale, so it
  is not touched — the tale it came from is whole; branch again and let the broken one go.
- version.js -> m332-001.

# M333 — "after this update my model keeps thinking it's an assistant instead of the persona": one "You are"
- THE WRITER asked it beside two questions about the prefill boxes. CHECKED, not guessed: a request was built with a teller in
  the frame, with and without the two names, and everything the storyteller is sent was searched — no "assistant",
  "AI", "language model", "the model", "chatbot" or "the user" anywhere in the house's words or the craft. Nothing
  the house sends calls it an assistant.
- WHAT WAS FOUND: exactly ONE other identity. His frame opens the message ("You are Tony Stark…"); two lines later the
  craft's first rule says "You are an unbiased cinematographer." — a second "You are", the plainer of the two, in
  the same message. (It was always there; with M321's single message and M327's names it is the only line left
  that tells the teller it is somebody else.)
- CHANGE (assemble/voice.js inVoice): with a teller named, that one sentence reads "You tell it the way an unbiased
  cinematographer would." — the rule it carries is unchanged; it is a manner, not a self. No teller named: the
  craft as it was. "Role = you handle narration, GM decisions, and every NPC" is a job, not an identity: left.
- TEST: m327.mjs M333-1 — with a teller named the system words hold ONE "You are" and it is the frame's; the craft's rule
  stands as a manner; a teller's name alone is enough; none named → the craft untouched.
- NOT VERIFIED — AND SAID TO HIM: whether this is what his model was reacting to. Nothing in the last updates tells it it
  is an assistant; one thing they DID change is that a teller's own words before the header (M322, at his order) no
  longer stand on the page or ride later turns, so earlier pages show less of the teller's voice. A screenshot of
  that thinking would show what it is reacting to, as the "[Correction]" one did.
- version.js -> m333-001.

# M334 — first person or second: the person the teller thinks in
- THE WRITER: "I need a setting with a dropdown — first person if I use 'I', second person 'you' — that will adjust everything.
  Probably this will help the persona problem. You know better; problem-solve this, though I don't know how it will
  sync with 'who is telling' and 'your name'."
- WHY IT MATTERS: a teller written as "I" ("I am Tony Stark. I tell Bruce stories…") and then handed seventy thousand
  characters of "You maintain… you render… your craft" holds two voices in one head: its own, and somebody instructing
  it. The second is the voice an assistant hears.
- CHANGE (assemble/voice.js personOf / framePerson / inPerson; stack.js; Settings → The frame: "The teller thinks as"):
  · three choices: Follow my frame (the default — read off the frame's own opening words, and the note under the box
    says what it read), I, You.
  · in FIRST person the house's SYSTEM-side words become the teller's notes to itself — the frame's purpose line ("That
    is who I am, and how Bruce wants this story told…"), the craft, the woken rules: you → I or me (an object "you"
    follows its verb or preposition on the same line), your → my, you are → I am. Imperatives stay. The craft holds
    28 "you" and 10 "your" outside its examples: every changed sentence was printed and read.
  · NEVER touched: the writer's FRAME; anything inside quotation marks (examples of story text); a line that is a LIST
    OF PHRASES ("Banned Words = …, ruin you, don't you dare…" — the first cut made it "don't I dare"); the word "you"
    itself in a list of pronouns ("you/I/he/she"); the brief, the pages, the ledger, the record.
  · HOW IT FITS THE TWO NAMES (his question): what is said in a USER-role message — the briefing's opening, the note,
    the eye, the ask-again lines — is the WRITER speaking to the teller ("Tony — Bruce here… for your eyes only"),
    and a person says "you" to a friend whichever way that friend thinks of himself. Those stay in the second person.
    The names change WHO is spoken of; the person changes whose voice the rules are in.
  · M333's law holds here too: in first person the craft never says "I am an unbiased cinematographer".
  · "You" chosen (or a "You" frame followed) is every word as it was, byte for byte.
- TWO WRONG TURNS CAUGHT BY PRINTING THE OUTPUT: "## The Telling\nYou maintain" came out "me maintain" (the heading's
  "Telling" + newline was read as "telling you": an object needs its verb on the SAME line, and a capital "You" is a
  subject); and the pronoun list became "(I/I/he/she)".
- TESTS: tests/harness/m334.mjs through the real assembler with the real craft — an "I" frame followed: the frame untouched,
  the purpose line, the craft's opening, subject/object/possessive each right, no "you" left speaking to the teller,
  the banned-phrases line, the pronoun list and every quoted example intact; the writer's own words (briefing, page,
  brief, note) still "you"; the dropdown by hand both ways; "You" byte for byte; said twice = said once. DOM-62: a
  frame written as "I" → the very next page's request is in the first person; the note says what it read; set to
  You by hand → the next page is in the second. The walk is 81/81.
- THE WOKEN RULES WERE READ TOO (five of them, nine sentences changed): one came out "Writing both halves requires I to hold
  both" — an object after a verb the list did not know. The verb list grew, and "you to <verb>" is an object
  whatever the verb; a scan of the craft and every woken rule for such leftovers finds none.
- NOT VERIFIED: that this cures his teller's "I'm an assistant" thinking — only his models can show it. A rule he imports
  or writes himself goes through the same transformer unread by me.
- version.js -> m334-001.

# M335 — the teller's thinking read like an auditor's: it had been ORDERED to
- THE WRITER pasted his teller's thinking and asked what makes it unnatural: "Bruce's ledger — backup checks out… canon check…
  the lane group merged record confirms… Ledger Mi-na knows:… the notebook's 'On their mind' says… That's a hanging slot…
  Turn economy… Window beyond: none required this turn… GFX: no… Header: 13:19-ish".
- ANALYSED, word by word, against what the teller is sent. The WORK in that thinking is good — it caught three real
  contradictions (Rias IS the VP; the truck never stopped; Jovan is inventing his cover story). The VOICE is an auditor's
  because the craft's own Pass orders it: "read the ledger, the record, and the world's word before anything else… Your
  notes cover two things, IN SHORTHAND, NEVER IN PROSE: B — BEAT… L — LAST LOOK…". Every odd word traces to a name the
  teller was handed: ledger / record / world's word (the craft's section teaching the blocks), "On their mind" and the
  knowledge lines (the briefing's headings), slot / turn economy / window / GFX / header / canon / drift / recolor (the
  craft's rule names), "drift… recolor" again from the eye's note ("your craft's Drift Recovery"). A mind told to think
  in shorthand about named machinery thinks in shorthand about named machinery. ("Game State" and "backup checks out"
  are the model's own words; nothing sends them.)
- CHANGE (assemble/voice.js naturalThinking, eyeWithoutRuleNames; stack.js) — for a teller with a SELF (a name in either box,
  or a frame in the first person): the Pass's order for shorthand is replaced by a request to turn the scene over the
  way one would before telling it to a friend — briefly, in one's own voice, in plain sentences about the people; never
  naming a rule, a heading or where a fact is written, with his own two examples; "no labels, no checklist, no inventory
  of what you are not doing this turn". THE CHECKS THEMSELVES (B — BEAT, L — LAST LOOK, "none of the above reaches the
  page") ARE UNTOUCHED — they are what caught the contradictions. A craft of the writer's own wording gets the request
  at its end. The eye's note loses the rule's name ("(your craft's Drift Recovery)"). It all goes through the names and
  the person like the rest of the craft ("…in my own voice… while I think").
  No teller to speak of (no name, a "You" frame): every word as it was.
- TESTS: tests/harness/m335.mjs — the order gone, the request in, the checks and the closing line intact; first person reads
  right and the quoted examples are untouched; no self → byte for byte; a forked craft → appended, his words untouched;
  the eye's note to a named teller says what drifted and names no rule.
- NOT DONE, AND WHY: the craft's hundred rule NAMES ("Turn Economy", "Swap Test", "GFX"…) are his preset's own shorthand and
  stay — the request not to think in them is the lever; renaming them would be rewriting his preset. The briefing's
  headings ("On their mind", "Who knows what") are already plain words.
- NOT VERIFIED: that his model's thinking now reads in the teller's voice — only his models can show it. A thinking seed in
  the teller's voice (M328) pulls the same way and is the stronger lever.
- version.js -> m335-001.

# M336 — "the thinking said something that never happened": a fact must say WHEN it was learned
- THE WRITER: in a branch his teller thought "Rias wants to drive him (she offered earlier… she offered to drive him to Aurora's)…
  the knowledge line: 'Rias called the twelve-minute walk a six-to-ten-minute intercept window and said the town would
  ambush him if he walked.' Hmm, that seems odd since Aurora lives next door… maybe jokingly." Rias DID say that — about ten
  scenes earlier, before the branch point, about another walk. She never offered to drive him to Aurora's; the
  housekeeper, asked, said so. "What does the storyteller actually see? This is stupid."
- FIRST SUSPECT, TESTED AND CLEARED: a branch carrying a LATER ledger. (1) The fold, through the real engine and the real
  banked checkpoints: sixty pages, a fact each, folded to every reachable page — 40 folds, none holds a later page's
  fact, none misses an earlier one. (2) The real app: ten pages each adding a fact; a branch from page 4 holds facts
  0–4 and no other, from page 7 facts 0–7. The branch is exact. (A first probe timed out — it answered the workers with
  junk; the walk's default answers fixed it.)
- ROOT CAUSE — MINE, M305. The line is real and OLD. M305 calls back older facts whose words match the scene's (two content
  words) and handed them over under the words "From earlier, bearing on this:". Two matching words ("walk", "town") are
  not "bearing on this"; and NO fact, new or old, said when it was learned — so a line about another day's walk read
  as being about this one, and the teller built the scene on it.
- CHANGE (engine/world.js renderKnowledge; state.js hands it the present page): every fact older than six pages says its age
  ("… (learned about 42 pages ago)"), whether it stands among the newest or is called back; and what is called back
  is handed over as what it is — "From much earlier — each is about ITS OWN moment, not this scene; use one only where
  it truly fits: …". With no present page given, a line is as it always was.
- TESTS: tests/harness/m336.mjs — his case rebuilt (the twelve-minute-walk line learned on page 5, forty trifles since, the
  present scene about Aurora's four o'clock next door): the fresh fact plain, the old one dated and labelled, the words
  "bearing on this" gone; a person whose newest fact is old dates it too; no page → no age. M305's three pins follow
  the new label.
- NOT CHANGED: the fact's own wording ("the twelve-minute walk" — which walk, it does not say) is the page reader's, written
  long ago. The housekeeper's "no" was right about Aurora's; it reads the last pages whole and the rest by its index.
- version.js -> m336-001.

# M337 — "that fact should never happen since I branched and that thing never happens": nothing in a ledger may be dated after its tale's last page
- THE WRITER, after M336 (which I had explained as "the line is old, from before the branch"): no — in his branch that thing NEVER
  happened; it belongs to the pages of the OTHER timeline. I had read his first message the other way. So his branch's
  ledger holds a line from pages the branch does not have.
- WHAT IS KNOWN: the fold (40 folds) and the branch in the real app (from pages 4 and 7 of ten) are exact — M336's probes. ONE door
  lets a later ledger in BY DESIGN: M91's near-the-tail carry (the journal does not reach, the branch page is among the
  last three) hands the branch the ledger AS IT STANDS, and the catch-up that follows only ever ADDS. WHICH door it was
  for him is NOT found — his ledger is on his phone.
- SO THE LEDGER ITSELF IS MADE TO TELL, AND TO HEAL (engine/state.js dropTheFuture, pure): what people know, the threads and
  the factions each carry the page they were written on (atTurn = page + 1), every journal line its page. With N
  storyteller pages in a tale, anything dated past N came from somewhere else: it is taken out of the ledger AND of
  the journal (so no later fold brings it back). Undated lines are never guessed at; a sound ledger is handed back the
  very same object.
  · chat.js branchFrom: applied to the carried ledger whatever path chose it — M91's door included.
  · chat.js takeOutTheFuture: once per tale per session on open, never while a page is being written or read (the stamp
    runs one ahead then); it SAYS how many lines and names the first — which also tells him, for certain, whether his
    line was from the other timeline (a toast naming it) or from his branch's own past (no toast; M336 dates it).
- TESTS: tests/harness/m337.mjs (a twelve-page ledger handed to a branch at page 5: only its six pages' facts remain, the
  thread and faction of page 8 go, the journal holds no later line, a later fold cannot bring them back, the parent
  untouched; sound/undated/junk → the same object). DOM-63: a three-page tale whose ledger holds the walk line "learned
  on page 13" — opened: the line goes, its own fact stays, the journal is clean, the toast names the line. Walk 82/82.
- NOT COVERED: standings, seats, presence and people pages carry no page date — a later value of THOSE cannot be told from
  the ledger alone (the fold is what keeps them exact).
- version.js -> m337-001.

# M338 — WHO COULD KNOW THIS? The blind spots of the people in the scene — before the page in code, after the page by the second reader
- THE WRITER: "design something sophisticated, autonomous and smart: each latest page, an analysis of what the people in the current
  scene DON'T know — to stop the LLM making every NPC know what MC did privately." His case: Jovan asks Claire how she found
  them; Claire answers "You gave me the schedule yesterday… in the hallway after the audit" — a telling that never happened
  (the four o'clock was set between Jovan and Aurora, by text). He had to ask the housekeeper to find it.
- WHAT EXISTED: the ledger's "Who knows what" says only what people HAVE learned; the craft asks for a trace; the second reader
  was told "ABSENCE IS NEVER DRIFT" — so a character citing a telling that never happened contradicted nothing written.
- HALF ONE — BEFORE THE PAGE, IN CODE, NO MODEL (engine/world.js blindSpots/renderBlindSpots; state.js). For each person in the
  scene (never the main character): every fact somebody ELSE holds that they have no line for — not the same fact in other
  words (sameFact, or 60% of the content words), not a fact with their own name in it (they were there). Kept: what bears
  on the scene's words, or was learned in the last 60 pages; four a person, nearest first. It rides the briefing under
  "Who does NOT know what — no page shows them learning these. One of them may still guess, suspect, or be told on this
  page; but if they SPEAK of it or ACT on it, the page must show how they came to know, truly… and never claim a telling
  that did not happen: Claire Maxwell has not been shown learning: … (Aurora Sterling knows)". Not "cannot know": a ledger
  can miss a line, and the words say what the list IS.
- HALF TWO — AFTER THE PAGE, THE SECOND READER (agents/continuity.js): a new duty, UNTOLD KNOWLEDGE — the one case where what is
  NOT written counts. It is shown the same list, keyed to the page it reads; a character who states or acts on what they
  were never shown learning, or claims a telling the ledger gives no sign of, with no true way shown on the page, is a
  warn, and `fix` is the nearest TRUE way ("Aurora told her the time") or their not knowing. Never: a deliberate lie or
  bluff, common knowledge, what happened in front of them on this page, the main character. A warn with a fix already
  goes to the mender, which edits the page by the smallest change and keeps the earlier words a tap away — so the loop
  closes with no hand on it.
- TESTS: tests/harness/m338.mjs — his scene: Claire lacks the four o'clock (Aurora knows) and what MC did out of her sight; what
  is about her, and what she holds in other words, are left out; MC never listed; it reaches the storyteller's request
  and the second reader's, with the duty and its limits; quiet when all hold the same, nobody is here, or a trifle is 300
  pages off. DOM-64, the whole loop in the app: the storyteller is handed the list BEFORE it writes, writes the false line
  anyway, the reader (answering only if it was SHOWN the list and the duty) finds it, the page is mended to "Aurora told
  me the time", the earlier words kept. The walk is 83/83.
- LIMITS, SAID: the list is only as good as the ledger's knowledge lines — a private deed of MC's that NO ONE learned has no line
  to compare against (the craft's trace is all that guards it); a line the page reader failed to write makes a person look
  blind to something they know (hence "not shown learning", never "cannot know"); the after-page check is a model's
  judgment and costs nothing extra (it is the same call).
- version.js -> m338-001.

# M339 — a reply that is the teller THINKING is never a page; and the switch: "let a model with its thinking off think on its page first"
- THE WRITER, two screenshots: under the house's own masthead (drawn only when a page has NO header) stood the teller thinking the
  scene over in its own voice — "Oh this is delicious. Jovan's being sweet about it… Let me write the walk where Claire gets
  included and nobody's heart breaks too much." — and there the reply ENDED. No header, no story, 1/1, saved as the page.
  "Every time, without thinking, the thinking is in the output, and it stops and doesn't give the header and the rest of the
  story." And: "design a switch. Off: everything normal, nothing changed. On: a smart solution for a non-thinking model so
  the AI thinks on its page. Make sure no regression, especially my storyteller persona."
- ROOT CAUSE OF (1) — A REGRESSION OF MINE. M324/M325 knew an all-plan reply by its LABELS ("Planning:", "Beat:") and asked
  again for the page. M335 then asked the teller to think in plain words, with NO labels — which is what he wanted, and it
  worked: the thinking in his screenshot is in the teller's voice — so its thinking stopped looking like a plan to that
  check, and a reply that was only thinking was shown and saved as the page.
- CHANGE (1), always on (chat.js): the surer sign needs no labels — in a tale whose last page opened with a header
  (priorHadHeader: KNOWN, there is an earlier page and it does), a finished reply holding NO header anywhere has no page in
  it. It is handed back as the teller's own thinking and the page is asked for, once, in words that fit ("That was you
  thinking it over, and it stopped there. It is yours — do not think it over again… Write the page itself now, beginning
  with its header line" — voice.js askAgain 'mulled'; never "you ran out of room", which it did not). The thinking is kept
  at the head of the page's thinking; one page is saved. A tale's first page, or a tale that keeps no headers, is judged
  by labels alone, as before.
- CHANGE (2), THE SWITCH (Settings, beside "Anything written before the header is thinking, not page"): "Let a model with its
  thinking off think on its page first" — ships OFF.
  · OFF: not one byte of any request changes (held by a byte-for-byte law).
  · ON: on a story turn whose connection has its thinking OFF, the closing message — just before the writer's note, which
    keeps the last word — asks: "Think it through first, inside <think> and </think> — in your own voice, as briefly as the
    scene needs. Then close the tag and write the page: its header line first… never stop before it." It is the WRITER
    speaking (user-role), so it says "you" in either person and greets the teller by name. Every provider's reply is
    already read for a leading think-tag (providers/openai.js makeThinkSplitter), so the split is EXACT, not guessed from
    headers: the tag's content is the thinking block, what follows is the page, and it is never sent back. A reply that
    stops inside or right after the tag falls to M120 / change (1): the page is asked for, once.
    A connection that thinks by itself, and an out-of-character answer, are left alone.
- A FAULT OF MINE, CAUGHT BY THE WALK: the script that added the switch's listener matched the first line of the OTHER tick's
  multi-line handler and put mine INSIDE it — the switch saved nothing until the other tick was touched. It stands alone now.
- TESTS: tests/harness/m339.mjs (OFF byte for byte, only a true `true` turns it on; ON: the line once, before the note, never
  in the rules, by name, "you" under an "I" frame; the 'mulled' words). DOM-65 in the real app: his screenshots replayed —
  the house asks again by itself once, handing the thinking back, one page saved, header first, the thinking kept as
  thinking and never read as story; OFF: no word of think-tags; ON through the real Settings box: the line is in the
  request, the tagged reply is split exactly, no second ask, the thinking is not sent back next turn; ON with a connection
  that thinks: not asked. The walk is 84/84.
- NOT VERIFIED: how each of his models takes the tag instruction (no key here). If one ignores the tag and thinks bare, the
  header gate and change (1) still hold the page clean.
- version.js -> m339-001.

# M340 — the first pages of a tale, for a model that does not think: the shape is SHOWN, the page is made whole before it is kept
- THE WRITER, two screenshots: the header he loves (a card: 📍 place, date and hour, the light, what MC wears, where he stands) and
  what a non-thinking model gave him on a tale's FIRST page — "Saturday, June 14, 2025 | 08:12 | ☀️ sun… | joggers, t-shirt |
  leaning at the counter": five fields, NO PLACE, no card; and the prose with no paragraphs. "A non-thinking model is only good
  in the middle of a story. At the start it breaks so many things… if we can solve this I can start doing gym and be happy."
- WHY THE MIDDLE IS FINE AND THE START IS NOT. In the middle, every earlier page in front of the model IS the shape, and a model
  that does not reason copies what it sees. On page one there is nothing to copy: the shape exists only as one sentence
  (Header Protocol) inside ~70k of rules. A thinking model works it out; the other has to be SHOWN. And two facts of the
  house made it worse: ALL his header rules want six fields (a header with no place wears nothing), and the header gate
  knew a header only by its BRACKETS — so a bare header was "no header": the house drew its own masthead over it, and after
  M339 such a page would have been taken for the teller thinking and asked for again.
- CHANGE — no setting; it works only where it is needed and stops by itself (ui/pageshape.js, pure):
  1. THE SHAPE, SHOWN (shapeReminder → stack.js closing message, before the think-line and the note): while the tale has
     fewer than three storyteller pages, or its LAST page had to be mended, the writer's closing word carries the skeleton,
     literally — "[Place, the exact spot — Weekday, Month D, YYYY | HH:MM | weather and light | what <MC> wears | where <MC>
     is…]", a blank line, a paragraph, speech opening its own paragraph. Only under a craft that keeps the Header Protocol.
  2. THE PAGE IS MADE WHOLE BEFORE IT IS KEPT (tidyPage → chat.js, story pages only): brackets round a header that lost
     them; the LEDGER'S GROUND in front of a header that lost its place (never invented: no ground known, no place); blank
     lines between paragraphs that came with single newlines; one unbroken block parted where speech begins. Never a word;
     a page with nothing of substance to mend is kept to the letter (white space alone is nobody's business); a page
     holding a readable object or a tracker block keeps its own line breaks. What is kept is what he reads AND what the
     next turn copies. The page's receipt remembers it was mended (receipt.shape), so the skeleton comes back next turn.
  3. A HEADER WITH NO PLACE STILL WEARS THE CARD (regex-styles.js style-header-no-place, built FROM the six-field card so
     they cannot drift; seeded into his shelf on load like any built-in it lacks) — for the one page where nobody knows
     the place yet.
  +  headergate.js isHeaderLine: one line of three or more "|" carrying a clock time is a header, bracketed or not
     (a labelled plan, prose with a time in it and a table row are not).
- TESTS: tests/harness/m340.mjs (his exact page: read as broken, mended with not one word changed, idempotent, a place never
  replaced or invented, good/headerless/GFX pages untouched; the block split; the skeleton, when it rides and when not, byte
  for byte without it, never under a foreign craft; the no-place card built, filled, ordered, and the six-field header still
  dressed by its own rules). DOM-66 in the real app: page one is SHOWN the shape; the broken reply is kept with brackets and
  paragraphs and WEARS THE CARD; with the ground known the place stands in front; after three sound pages the skeleton
  stops; after a mended page it is back. The walk is 85/85.
- FAULTS OF MINE ON THE WAY: tidyPage first normalised white space on every page (DOM-57 caught it: a sound page must be
  kept to the letter); two walk assertions used ":last-of-type" on a class (it matched nothing — M339's "never reads the
  thinking as story" had been passing on air; it reads the real node now); the walk's own shelf carries other scenarios'
  test rules, so DOM-66 runs on the shelf as shipped.
- MUTATION-CHECKED: the repair switched off (tidyPage reads no header) → M340-1 and M340-2 fail; a bare header not recognised
  (isHeaderLine, brackets only) → M340-1 and M340-2 fail. Both files restored and `cmp`-proven. The long play on this tree: 8/8.
- NOT VERIFIED: that his non-thinking models obey the skeleton (no key here) — which is why (2) and (3) do not depend on it.
- version.js -> m340-001.

# M341 — "your fix suddenly, on the first turn, breaks my persona": M340's skeleton was a form in a manual's voice
- THE WRITER, right after M340: "your fix suddenly on first turn breaks my persona — what exactly do you do, as example or something?"
- WHAT IT DID, printed from a real request: as the LAST thing the storyteller read on page one (the most heeded spot in the whole
  request) stood a nine-line block — a heading ("The shape of the page — exactly this, every time:"), the header form, and DUMMY
  PROSE ("A paragraph of the scene." / "Speech opens its own paragraph," she said.) — in nobody's voice, with no name. A form
  to fill in; and a teller handed a form becomes a clerk. It broke the house's own law (M327, M335): what the house says to
  the teller is said in the writer's voice, briefly, never like a manual.
- CHANGE (ui/pageshape.js shapeReminder, stack.js): ONE sentence, led by the teller's name when there is one — "Tony Stark — open
  the page with its header, in exactly this form — [Place, the exact spot — Weekday, Month D, YYYY | HH:MM | weather and light
  | what Jovan wears | where Jovan is] — then a blank line, and a blank line between every two paragraphs." No heading, no
  sample prose (paragraphs are mended in code whether or not the model heeds it). When the think-on-page line rides too, it
  comes first and carries the name; the header's form follows without repeating it. Everything else of M340 is unchanged.
- TESTS: m340.mjs M340-3 now holds the broken law — one line, under 260 characters, no sample prose, no heading, by name under a
  named teller. DOM-66 follows the words.
- NOT VERIFIED: that this is ALL of what his teller reacted to — only his models can show it; the block was the only thing M340
  added to what the storyteller reads.
- version.js -> m341-001.

# M342 — "just normal as ever": NOTHING about the page's shape is said to the storyteller
- THE WRITER: he looked at the broken output again after updating and it had become normal, header card and paragraphs — "is this your
  doing? If yes then we don't need any format or example, just normal as ever. It breaks my persona. I want it to be normal:
  my system instruction, then all normal, no persona-breaking words, then my first message."
- YES, IT IS THE HOUSE'S DOING, and none of it needs a word in the request: M340's display rule dresses a header with no place (that
  is what changed an ALREADY KEPT page before his eyes), and tidyPage makes every NEW page whole after it arrives (brackets,
  the ledger's ground, blank lines). He is right that the shown skeleton (M340, cut to one sentence in M341) is therefore
  unnecessary — and it was the only part that touched what the storyteller reads.
- CHANGE: the shape line is REMOVED — from the closing message (stack.js), from the per-turn decision (chat.js) and from the module
  (pageshape.js: shapeReminder, needsShapeReminder, YOUNG_TALE_PAGES are gone, not merely unused). A tale's first turn closes
  with his note and nothing else. Kept, all of it code-side: tidyPage before a page is kept, the no-place card, the bare
  header recognised by the gate, the receipt noting what was mended.
- TESTS: m340.mjs M342-1 — a first-turn request under a named "I" teller closes with his note alone; no form, no sample prose, no
  word about blank lines anywhere the house speaks; his first message as he wrote it; the functions no longer exist. DOM-66:
  pages one and two are sent no word about shape, and the broken reply is still kept whole and wears the card.
- THE THINK-ON-PAGE SWITCH (M339) still adds its one line WHEN HE TURNS IT ON — that is his switch; off, the request is byte for byte.
- A NOTE ON WHAT HE SAW: a page kept BEFORE the update keeps its words (tidyPage runs when a page is kept, not on old pages); what
  changed on it is the header's dress. Its paragraphs change only if it is written again (retry/swipe).
- version.js -> m342-001.

# M343 — the older-model switch ("derestricted / older model"): a smaller, sharper request, and the scene said once more, last
- THE WRITER: frontier models ($150 a month) now refuse and preach at times, and each time costs him anxiety; an older derestricted
  open model (GLM 4.6, 200k of room, ~$30 unlimited) does neither and its prose read well, but he cannot tell whether it keeps
  the thread. If I recommend it: "design something that makes this ancient model smarter… good context retention", behind a
  switch — OFF: everything back to normal; ON: whatever helps, even if it would not suit a frontier model. His last ask of the
  session: one pass, no regression.
- WHAT AN OLDER MODEL LOSES FIRST is the middle of a long request, long before its stated room is full; and the house already
  carries most of what such a model lacks (the ledger, the record, who-knows-what and who-does-NOT, the second reader and the
  mender, the page made whole in code). So the switch does the two cheapest, surest things and nothing clever:
  1. A SMALLER REQUEST (chat.js roomOf, OLDER_MODEL_ROOM = 64,000 tokens): with the switch on the storyteller's room is never
     more than that, whatever the provider claims — the oldest pages leave first (the record already tells them), the newest
     stay whole. ONE truth for the request, the record's room and the "tokens in the room" line, so the line never lies.
  2. THE SCENE, SAID ONCE MORE, LAST (assemble/anchor.js sceneAnchor → the closing message, before the think-line and the
     note): the hour, the ground, who is here, and up to three people's blind spots — the LEDGER'S OWN LINES to the letter
     (no second wording to drift), in the writer's voice ("Tony Stark — right now, so it is in front of you — …"), one
     breath, facts and never orders, story pages only. Every word of it is already in the briefing at the front; this puts
     it where an older model looks hardest.
  OFF (as it ships): not one byte of any request changes — held by a law.
- SETTINGS: "Derestricted / older model (GLM 4.6 and the like): help it keep the thread", under the think-on-page switch, with a
  note saying exactly what ON does; the thread is told the moment it moves (noteOlderModel) and reads it at first look.
- TESTS: tests/harness/m343.mjs (OFF byte for byte, only a true `true`; ON: by name, the ledger's lines to the letter, the blind
  spot, one line under 900 characters, no order-words, never in the rules, said once, the note last; empty ledger → nothing;
  no teller → plain; with think-on-page both ride in order). DOM-67, a sixty-page tale in the real app: ships OFF and says
  nothing; ON through the real Settings box → the anchor closes the request, the request falls to ≤ ~66k tokens with the
  oldest pages gone and the newest whole, the room line reads "of ~64.000"; OFF again → all of it gone. Walk 86/86.
- DELIBERATELY NOT DONE: cutting his craft down for a weaker model (it is his preset — seventy thousand characters of it is the
  heaviest thing an older model carries, and the next lever if this is not enough); touching samplers (rule: his connection's
  settings are sent exactly); changing the keeper's window.
- NOT VERIFIED: GLM 4.6 itself — no key here. The cap and the anchor are proven to be SENT; how much they help that model only
  his play can show.
- version.js -> m343-001.

# M344 — "never drop… I asked to make it SMART, not to remove details": the older-model switch removes NOTHING; it calls the record's far lines back
- THE WRITER, of M343: "never dropped the notes or summary, that's the most important thing. I asked to make it smart, not removing
  details in the story — besides it has 200k of context and I rarely get to 150k. The job is to make the frontend smart so the
  model can remember, and raise its context retention." And: he feared another Claude had edited the repo; and wants to be
  sure nothing in the frontend is broken.
- ON THE FIRST: M343's cap never touched his note or the record (only the oldest verbatim pages left) — but he is right all the
  same: a page out of the request is a detail the model cannot have. THE CAP IS GONE (chat.js roomOf = contextOf; the room
  line is the provider's again). The switch now only ever ADDS.
- THE SMART PART (assemble/anchor.js recallFromRecord / recallLine, inside the one-breath anchor before his note): every line of
  the record is scored against the scene's own words — the last pages AND what he just wrote — a word counting for more the
  fewer lines hold it (so "Jovan" counts for nothing and "fence" for a lot); the names of the people present and of MC never
  score (a hyphenated name is read as the scorer reads it); at least two real words must match; the record's newest two lines
  (near the pages already) and the house's own notes are never called; up to three lines, told in the story's own order, each
  under ITS OWN PAGES — "And from our story so far, each from its own time — (pages 1–6) [Aug 19] Jovan fenced with a stick…".
  M336's law holds: dated, never vouched for. The record itself still rides whole, where it always did. No model is asked.
- THE REPO, CHECKED: GitHub main == my HEAD (70d8869 before this push), no commit I lack, none I did not make; the last sixteen
  commits are this session's M328–M343 in order; the authors across history are the names these sessions have pushed under.
  Nobody else has edited it.
- TESTS: m343.mjs M344-1 (forty pages: with the switch on every page, the rules, the brief, the record and every message but the
  last are byte-identical to off; the last only grew and ends on his note), M344-2 (the fence scene calls the fence line under
  pages 1–6; names alone call nothing; newest lines, house notes and a short record never; another scene calls another line;
  story order; no word of "bearing"), M344-3 (one breath, before the note). DOM-67 now holds that NOTHING leaves: the oldest
  and the newest page both ride, the request only grew, the room line is not a smaller one.
- NOT VERIFIED: GLM 4.6 itself — no key here. What is sent is proven; how much it lifts that model only his play can show.
- version.js -> m344-001.

# M345 — "why is my integrated Arbiter stupid": the referee's outcome never reached the storyteller, and the cast sheet was seeded blind
The writer: the cast sheet ("How they measure") left out his main character Jovan and filed the paper bag over Jovan's head
under Kaelen. He ordered the referee fixed and analysed, ALL of Arbiter in behind its switch (off = the storyteller decides
everything), and every word natural — never corporate — so his teller's persona holds.
- ROOT 1 — THE OUTCOME NEVER REACHED THE STORYTELLER. Since M11 chat.js set state.pendingVerdict and consumed it, and never
  passed `ruling:` to buildRequest (`git log -S"ruling:" -- js/ui/chat.js` is empty: it never did). M11's injection law
  called buildRequest with the ruling by hand, so it was green while the wire carried nothing. Measured in the real app (DOM-68):
  with the hand-off removed, the closing words open "Before you write: reread…" — no outcome; with it, "About what Jovan is
  trying — feint low, then the disarm: …". Fixed at the hand-off: rulingFor(state, lastUser.id, ooc) in BOTH buildRequest
  calls (the probe measures the room with it), and only the outcome ruled on THIS page of the writer's (pendingVerdict.forUser)
  — never one left from a send that stopped before it was told, never on an out-of-character turn.
- WHERE IT RIDES: first in the closing words, right after the writer's page it settles — Arbiter's depth 0 — led by the
  teller's name (toTeller), never through inVoice (its action words are story text: "sneak into the house" stays a house).
  This is the one thing the house says in the closing words that is longer than a sentence (M341's law is about SHAPE —
  headings, templates, a manual's tone — and the outcome has none of those): it is the writer's own word about his own move.
- THE WORDS: every outcome is said the way a person says it — "About the fight between Jovan and Kaiser: Jovan goes for it —
  a feint low, then the disarm — and it works, but at a fair price — …". No "The house has ruled — duel, round 3", no tier in
  capitals, no numbers (wounds are "a lasting wound", "two lasting wounds"), no rounds, poise, rolls, house, note or referee.
  Every law of the old text is still said: the binding outcome, proportion, the kept secret (once — it was said twice), the
  guard and its one honest way in, the lasting wound, the called winner or the draw, the fight the story ends, the chain
  strike by strike, the standoff where nothing is decided. A condition's note is words too ("now carries a broken arm, and it
  tells in close fighting while it lasts"). The craft's line teaches the words the outcome really opens with ("An outcome
  already settled = when the writer's closing words say how an attempt of his turns out…"); a stored craft's old line is
  spoken as today's (refereeCraft).
- ROOT 2 — THE SEEDER WAS BLIND. It was handed twelve page-tails of 600 characters labelled "Player:"/"Story:", asked to name
  the player, and never told who the player IS — nor shown the brief, the people's pages, their bodies or the record. It
  guessed Kaelen; the guessed name was thrown away (the ledger knew "Jovan") but the actors built on the guess were kept. It
  answered in 600 tokens (a big cast was cut off mid-list), seeded once (empty sheet) and after fights, so the wrong sheet
  never healed, and a re-seed could LOWER a rating. Now (Arbiter v0.42's seeder, with Cozy's ledger): <player> names Jovan and
  labels his pages "Jovan (the writer)"; the brief, the cast notes, every person's page (the scene's first), their bodies, the
  locks, the newest record lines and the newest pages whole — sized to the worker's room; 8,000 tokens to answer; Jovan FIRST,
  every named person, the story's own hierarchy, the current level, people only; a disguise, clothing or a look is never a
  condition. In code (mergeSeed): every name that means him lands on HIS entry; a name the ledger has a page for is filed
  under the page's name (M320); the writer's hand is locked; a fight's estimate gives way; this seeder's numbers only rise;
  its own reading of what someone carries is replaced each time; the referee's filings (now tagged by:'referee') are never
  taken back. Him left out = asked once more, by name.
- THE APP REPAIRS WHAT IT CAN DETECT: a sheet without the new stamp (sheet.seedVersion 2) is the blind seeder's — the next page
  re-reads it whole: its numbers replaced, its misfiled conditions let go, names no page stands for dropped. The writer's
  Kaelen loses Jovan's bag on his next page, with no hand on it (DOM-68). migrateSheet keeps the stamp (it dropped every field
  but actors/playerName — the stamp would have read "blind" on every load and re-seeded every page).
- WHEN THE SHEET IS WEIGHED: the first pages, after a fight, when the main character is missing, when someone in the scene is
  not on it (three pages apart; a face the last weighing saw and left off never calls it again), every hundred pages.
- THE REFEREE READS WHAT IT RULES ON: his name spelled out (<player>, every part of it is him), the whole sheet with him first
  (was twelve rows), who is here and who they are (their pages' first lines, their bodies, the locks), the brief, and the eight
  newest pages whole (was six pages cut to their last 400 characters) — the action once. Its prompts are Arbiter v0.42's rules
  in Cozy's JSON: the skill by the act's physical nature; a dirty move is an edge, never a penalty; circumstance two-sided;
  the opposition is whoever the story says and never any part of his name, never a place or a faction; the established guard
  and its one honest counter-path; lasting damage registered, never poured into circumstance; words do not parry steel (a
  talking beat under attack is fought at a disadvantage); any combatant rated by threat; scale mismatch; gear up to +3.
- THE SWITCH (Settings → the referee): OFF = the storyteller decides everything. Not one byte of it rides: no outcome, no slot,
  no craft line about settled outcomes, no fight or nerve in the state of things; no referee call, no seeder; a fight standing
  when it was switched off is let go (its hurts go to the body ledger, as at any fight's end).
- The drawer's sheet leads with him ("Jovan (you)"), and says so when he is not weighed yet.
- NOT PORTED, BY DESIGN: Arbiter's event engine and world threads — the world agent (M29) already moves the world between
  pages; a second one would be two ways to do one thing. Fast mode (no referee call) — it hands footing back to the model; the
  writer asked for quality. Hand controls for the sheet — the heal and the triggers above keep it right without a hand; the
  housekeeper's combat.begin/combat.end remain the way to open or close a fight by hand.
- TESTS: m345.mjs M345-1…10 (the seeder's real reading; the writer's sheet through the store and back; the heal; growth and
  the hand; asked again by name; when it is due; the referee's reading; every outcome's words scanned for capitals, numbers
  and machinery; where the outcome rides and OFF = nothing; tagged conditions and identity). DOM-68 walks it in the app. Moved
  laws, updated deliberately: M11 injection (first in the closing words, not the briefing), agents.mjs, M327-1, M334, M36-1.
  Also: M174 (the action rides once now — the shown-swipe law is held on an earlier page of the writer's), M28-7 (run, not
  read: the seeder's merge itself — a known name stands, an unknown one is learned, a label is never a name), M72-9 (the seeder
  may renew its leash; it still answers to the chain first). Two walk checks read the DOM in the same instant the store changed
  and raced under load (DOM-45 and DOM-65 each failed once in a full walk and passed alone) — they now wait for the render.
  GATES ON THE PUSHED TREE: harness 673/673, walk 87/87 (alone), longplay 8/8, lint clean.
- version.js -> m345-001.

# M346 — canon verification, whole, behind its own switch
The writer: integrate his Canon Verification extension fully into the frontend, with its own on/off switch; improve it
if possible; no bugs, no regression.
- IT IS HIS EXTENSION, RUNNING AS ITSELF. Canon Grounding v0.63.0 (Sillytavern-Canon-Verification- @ a3030e6) is vendored
  whole as js/canon/grounding.js by tools/vendor-canon.py: exactly three changes, each asserted to match once — its two
  SillyTavern imports point at js/canon/host.js; jQuery, $ and toastr come from host.js; the boot no longer builds ST's
  settings panel. Every stage of its pipeline is its own code — the scene parser, evidence, the cast auditor, the wiki lookup
  (the MediaWiki API from the browser, origin=*, no server), the caches and their healing, the budget, the absence reports,
  the dossiers, the composer, the arc judge. Its own gates prove the code Cozy runs: syntax (an .mjs copy), test/proof.js
  579/579, test/sim.mjs 378/378.
- host.js is the same stand-in its own simulation gives it: its settings (kept in the store under canonGroundingSettings),
  getContext() = the story in hand, its events (CHAT_CHANGED when the story changes, MESSAGE_RECEIVED after a page), an inert
  callable for its panel code, its toasts through Cozy's, and the note it injects kept PER STORY the way ST keeps an extension
  prompt standing until it is set again.
- bridge.js hands it what ST would: the story's pages as ST's chat (the SHOWN version of each page; a hidden page is a system
  line it skips), the main character's story name as the player's, the story itself as the card (title, brief, cast notes —
  what it discovers the wiki from), its per-story memory as chat metadata — ONE live object per story (its background work
  saves the object it holds; a second copy would erase the other's finds), saved as soon as its interceptor returns too (a
  phone that reloads would lose the 400 ms timer's save) — and generateRaw through the writer's worker connection.
- BETTER HERE THAN IN ST: Cozy's people ledger is its cast list — the slot Summaryception's ledger fills in ST (useLedger, on
  by default), lent each call and never stored as its own; and its model reads the scene (its recommended parser) from the
  first run, because Cozy always has a worker to ask (set once; his own choice stands after).
- WHERE ITS NOTE RIDES: at the top of the writer's briefing — the extension's own default in ST (depth 9999, the player's
  voice: the top, before any recency). Its "<player>'s note —" label goes (here it is one part of his notes): "Canon from this
  series' wiki, to keep our story accurate. You know this world; …". The receipt names it "What canon says".
- THE SWITCH: Settings -> Canon verification. OFF as it ships (every story he has keeps exactly its requests): never loaded,
  never called, nothing looked up, not one byte sent. The series' wiki can be named there (optional — it discovers it). It has
  its own row in Settings -> The workers ("Canon verification"), so it can ride a model of its own.
- Its interceptor runs beside the referee, not after it, and holds the turn only as long as its own windows allow (2 s; a
  first meeting 12 s); after the page, the people the page brought in are looked up in the chain, for the next page.
- The seeder (M345) now rides the referee's own hands (Arbiter: the seeder uses the adjudicator's profile) — 'seeder' had no row
  in Settings -> The workers, so a model given to the referee never weighed the sheet.
- TESTS: m346.mjs M346-1 runs the real extension on a fake Bleach wiki: Cozy's ledger is the cast list, the wiki is asked,
  Rukia's hair and eyes land at the top of the briefing, what it found is kept with the story, the Settings list sees it and
  forgets it, no note = nothing of it. DOM-69 walks it in the app: it ships off; switched on with the wiki named, the
  storyteller's briefing opens with what the wiki says of Rukia; switched off, nothing is looked up and nothing is sent. (The
  walk's house does not know the extension's own prompts as a worker's, so the storyteller's request is found by its briefing.)
- NOT VERIFIED: a real fandom wiki from his phone — this container cannot reach fandom.com. What is asked and what is done
  with the answer are proven against recorded shapes (the extension's own sim uses the same); the real wiki's pages are not.
- GATES ON THE PUSHED TREE: harness 674/674, walk 88/88 (alone), longplay 8/8, lint clean; the extension's own on the source
  it was vendored from: syntax (.mjs copy), proof 579/579, sim 378/378. tools/vendor-canon.py re-run reproduces grounding.js
  byte for byte.
- version.js -> m346-001.

# M347 — "What the storyteller saw": tap a part to read what it said, Copy, and a Raw view of the request itself
The writer: tap each section of "What the storyteller saw" (the frame and the others) to open what it sent, with a Copy
button; a toolbar with Normal (the boxes, tap to open — the default) and Raw (what the model actually got: system, user
and the rest); and can old pages still show what was inside?
- OLD PAGES: NO. The receipt has only ever kept each part's name, its size in tokens and why it was there
  (assemble/receipt.js finalizeReceipt) — never its words — and the request itself was never kept anywhere. Nothing that
  was not stored can be shown, and a rebuild from today's ledger would not be what was sent then, so none is offered: an
  old page's sheet says plainly that it was written before its words were kept (Normal and Raw both).
- FROM NOW ON, EVERY PAGE KEEPS ITS WORDS (js/sent.js), in their own database (cozytavern.sent.v1) — never in the page's
  receipt, a backup or the book sync, and never touching the main database's version: a request can be the size of the
  whole story. Long texts are cut into pieces at paragraph breaks chosen by their own content (the same pages cut the same
  way wherever they sit in a request) and each piece is kept once per tale — measured: a second page whose request shares
  forty long pages with the first adds under 15% of its own size. The newest 200 pages of each tale keep their words; past
  that the oldest go in a batch of twenty with every piece only they used. A tale that is gone takes its words at boot. A
  sheet opened the moment a page lands waits for the words on their way instead of calling them missing.
- WHAT IS KEPT: (1) each part's words exactly as the assembler made them (pushSlot now puts the text on the draft; the
  receipt kept on the page still holds only names, sizes and the new sentId); (2) the request exactly as the model took it:
  both providers hand back the ACCEPTED body — a refused attempt is not what the model saw — and its address, never the
  headers (the key stays home). Both are read back byte for byte (M347-1, M347-5).
- THE SHEET: a toolbar — Normal (the default, always first) and Raw. Normal: each part with words is a box; tap it and
  its words open, with Copy. Raw: the request's settings (model, temperature, max tokens, thinking — every field that is
  not a message), then every message in the order the model got it, each under its role (system, user, assistant), each
  with Copy; "Copy all" copies the exact body. Raw and each part's words are drawn the first time they are opened (a long
  tale's request is hundreds of messages). Copy falls back to the page's own copy when the clipboard API is not there (an
  address that is not a secure page, e.g. the phone's LAN address over http).
- TESTS: m347.mjs M347-1 (every part and the request back byte for byte; read while it is being kept), M347-2 (kept once:
  the second page adds <15%), M347-3 (the newest 200 kept, the oldest gone with their pieces), M347-4 (the page carries
  only the key), M347-5 (OpenAI-shaped and Claude: the body handed back is the body fetched, byte for byte, never the key;
  Raw reads it as system then user). DOM-70 in the app: opens on Normal; tapping the frame opens the words the model got,
  Copy takes exactly them; Raw lists settings then every message by role; Copy all equals the body the house received; an
  old page says it was written before its words were kept.
- NOT VERIFIED: the real phone — how long a 500k-token request takes to draw in Raw, and the copy fallback on a LAN
  address, are not measured here (jsdom has neither a real layout nor a real clipboard).
- Two older laws, decided out loud: M15 (no ghost calls) caught app.js reaching sweepSent through a dynamic import the
  static check cannot see — it is imported at the top now (sent.js has no side effects). M259-58 serialized the WHOLE
  return of buildRequest and counted the seat line twice once the receipt's draft carried each part's words; the request
  still says it once — the law now measures what is sent (the system blocks and the messages). The code was right both times.
- GATES ON THE PUSHED TREE: harness 679/679, walk 89/89 (alone), longplay 8/8, lint clean.
- version.js -> m347-001.

# M348 — "for Synthetic's Kimi K3, at Low it doesn't think at all — is something wrong?"
The writer: on Synthetic, Kimi K3 ("syn:large:vision" in the provider's own list, hugging_face_id moonshotai/Kimi-K3,
efforts low / high / max) did not think at Low, while the forum says it does.
- WHAT WAS WRONG (measured, M348-2): the house read a model's family from its NAME alone, and "syn:large:vision" names no
  family — so K3 behind the alias was spoken to as a generic model. Every level carried a `thinking` switch Moonshot says
  K3 must not be sent ("remove the K2.x thinking configuration"); Off was sent as thinking:{type:'disabled'} with NO
  effort — K3 cannot stop thinking and an unsaid effort is its max; Medium and XHigh were sent as levels K3 does not have
  (a refusal of them would set the refusal memory, and a day of nothing sent — max again). Low itself went out as
  reasoning_effort "low" beside that thinking switch.
- THE FIX, FOR THE WHOLE CLASS: a model is what its provider says it is. The /models listing now keeps the weights behind
  an alias (hugging_face_id, huggingface_id, hf_id, canonical_slug) and the levels the model declares
  (reasoning_parameters.efforts, supported_reasoning_efforts) — room.js reportedIdentity. The house learns them in the one
  question it already asks for a model's room (detect.js learnContext — now for every connection, since a room the writer
  set himself still leaves what the model IS to learn; once per model at that address; again after a day when nothing
  came back; waited for at most 1.5 s before the storyteller's page, as the room is). Every family test reads the model's
  own id AND the weights its provider names (effort.js modelNames), so GLM, DeepSeek, Qwen and Kimi behind any alias are
  spoken to in their own words; and effortFor only ever sends a level the model declares (nearest below; a model that
  always thinks gets its least). A model picked from the list in the connection form is kept with what it is at once,
  and the form's hint names it.
- AFTER (measured): Off -> reasoning_effort "low" (K3's least — it always thinks), Low -> "low", Medium -> "high", High ->
  "high", XHigh -> "max", Max -> "max"; nothing else — exactly Moonshot's documented K3 request.
- "DID IT THINK?" IS NEVER A GUESS: a page that asked for thinking and got none back now says "no thinking came back from
  the model" on its receipt (receipt.noThought). What was asked is in Raw (M347); what came back is on the receipt.
- NOT VERIFIED: Synthetic itself. This container cannot reach api.synthetic.new, so whether K3 on Synthetic thinks at Low
  with the corrected request is not measured here; the request is proven to be the one Moonshot documents, and every page
  now says whether thinking came back. Moonshot's docs also require the full assistant message, reasoning_content
  included, to be passed back on multi-turn (K3 was trained with "preserved thinking"); the house sends earlier pages'
  words only — whether that makes K3 think less at Low is unmeasured and not changed here.
- TESTS: m348.mjs M348-1 (the listing keeps the weights and the levels), M348-2 (the request at all six levels before and
  after learning, byte for byte; one question even with a hand-set room; not asked again; the card and the hint name K3),
  M348-3 (GLM and DeepSeek behind aliases; facts for one model never taken for another), M348-4 (the receipt). DOM-71 in the
  app: the alias at Low is learned before the page, sent reasoning_effort "low" with no thinking switch, and the receipt
  says no thinking came back.
- version.js -> m348-001.

# M349 — "so a GLM model on Synthetic will work? or another provider?"
Checked against the providers' own documents and Synthetic's live listing (as published in two public trackers: every
route's accepted levels in reasoning_parameters.efforts, sent through the one top-level reasoning_effort field; GLM-5.2
none/high/max, Kimi K3 low/high/max, Qwen3.8-27B low/medium/xhigh), then measured through the real provider at all six
levels. Two more of the same fault were found, and fixed with it:
- GLM ON SYNTHETIC WAS SPOKEN TO IN Z.AI'S WORDS: a thinking:{type} switch that is not part of Synthetic's surface, Off as
  that switch (so, likely, no Off at all), and Low as "switch on, no effort" (the model's default, its most). Now any model
  whose relay lists its levels (style 'declared') is sent exactly one field, reasoning_effort, with one listed value: Off is
  "none" where the model lists it, else its least (it always thinks); every other level through its family's own alias
  (medium -> high, xhigh -> max for K3 and GLM), then the nearest listed level below, else its least — a level that asks for
  some thinking is never spoken as "none". Measured: GLM-5.2 on Synthetic Off none, Low high, Medium high, High high, XHigh
  max, Max max; K3 as M348; Qwen Off low, High medium, Max xhigh; a route the listing names no weights for keeps the house's
  nearest-below law.
- GLM ON Z.AI WAS SPOKEN TO AS IF EVERY GENERATION WERE ONE: Low went out as "thinking on, no effort" — max, the most, for a
  writer who asked for the least — and Off to GLM-5.3 as thinking disabled, which Z.ai says fails ("disabling reasoning is
  no longer supported"). Now by generation (zaiWire): 5.3 and after always think — low/high/max, Off is "low"; 5.2 — Off
  the switch, Low and Medium "high", XHigh "max"; before 5.2 — the switch alone (no reasoning_effort, which starts at 5.2).
- "CANNOT STOP THINKING" IS ONE TEST (alwaysThinks): Kimi K3 however reached, GLM-5.3+, and any model whose relay lists no
  "none". The worker room floor (M303: a worker's 400 tokens thought away) asked "is the style kimi?" — K3 behind the alias
  (declared now) would have lost it; the connection card's "what Off becomes" asked the same. Both read the one test.
- KIMI K3 ELSEWHERE is unchanged and measured: Moonshot and any host whose model name says kimi-k3 (Together's
  moonshotai/Kimi-K3) get reasoning_effort only; OpenRouter its own reasoning object, which it maps per model.
- NOT VERIFIED: no provider was called from here (the container reaches none of them). The requests are proven equal to
  what each provider documents; how each model then thinks is theirs, and every page's receipt says whether thinking came
  back (M348).
- TESTS: m349.mjs M349-1 (Synthetic: four routes, six levels, one field), M349-2 (Z.ai GLM-5.3, 5.2, 4.6 at six levels),
  M349-3 (K3 on Together and OpenRouter), M349-4 (alwaysThinks everywhere, and the worker floor it earns through the real
  callWorker). M348's laws now read the style as 'declared' with the family kept (familyStyle).
- version.js -> m349-001.

# M350 — "why can't it learn the thinking from the provider, so a new model needs no update after my subscription ends?"
Asked plainly: most providers publish nothing about thinking in their model lists (Synthetic lists each model's levels —
read since M348/M349; OpenRouter says only whether a model reasons and translates the rest itself; Moonshot, DeepSeek,
Z.ai and OpenAI list names only). So there is no single "fetch the thinking" — but every provider ANSWERS, and its answers
say what it takes. The house now learns from them, per model at its address, and needs no release for a model it has
never heard of:
- A REFUSAL IS READ, NOT OBEYED BLINDLY. "Invalid value: 'medium'. Supported values are: 'low', 'high', and 'max'." (or the
  vLLM/pydantic "Input should be 'low', 'medium' or 'high'", or "must be one of [none, high, max]") teaches the levels the
  model takes: the SAME turn goes again at once at the nearest of them (Off -> "none" where offered, else the least; a level
  that asks for some thinking is never sent as "none"), and only those are sent from then on. Before: a no that named no
  field was thrown at the writer as a failed page, and one that did was answered by sending no thinking at all for a day —
  the model's own default, often its most.
- A REFUSAL OF ONE FIELD DROPS THAT FIELD ONLY. "Unrecognized request argument supplied: thinking" / "thinking: Extra inputs
  are not permitted" — the turn goes again without that field, still asking for thinking with the rest; it is left out from
  then on.
- AN OFF THAT DID NOT STOP THE THINKING IS NOTICED: the dial said Off, the request said so, the model thought anyway -> from
  then on Off asks for the least it takes instead of leaving it to its default. (A model already known to think always is
  not "taught" again.)
- THINKING UNDER A NEW NAME is still thinking: a stream field named like reason/think/thought is read when the known ones
  are silent.
- WHAT WAS LEARNED is kept on the connection for that model at that address, for 30 days (then learned again — a provider
  changes), let go at once when the model or address changes, applied LAST over any spelling in requestBody, and shown on
  the connection card ("learned from the model: takes low, high, max · does not take “thinking” · Off does not stop it").
  Trust, in order: what the provider's listing declares > what the model taught > the family rules > the generic shape.
- LIMIT, said plainly: a provider that silently IGNORES a setting — no refusal, no difference — cannot be detected by any
  client. Then the model's own default applies, and the receipt says on every page whether thinking came back (M348).
- TESTS: m350.mjs M350-1 (the lesson reader on the OpenAI, vLLM and list shapes and two field shapes; a refusal that says
  neither teaches nothing), M350-2 (a model the house never heard of: refused Medium -> the same turn thinks at "low"; kept;
  every later level first time), M350-3 (an address that refuses `thinking`: dropped, the level kept), M350-4 (an Off that
  does not stop: noticed, then Off asks for the least; K3 not re-taught), M350-5 (thinking under a new name), M350-6 (per
  model, per address, thirty days). All the provider and thinking suites (M22, M303, M307, M318, M328, M348, M349, the houses)
  pass unchanged.
- version.js -> m350-001.

# M351 — "low still isn't thinking at all, and on Discord everyone codes on low"
Two screenshots: the connection card says thinking: low — spoken as “low” (so the level IS being sent, M348/M349), and the
pages come back with no thinking at all. Nothing in this container can reach Synthetic, so the house was given what it
needed to answer for itself, on his phone, in one tap:
- THE PAGE SAYS SO. Thinking asked for at a level and none came back was known only to the receipt (M348). The page now
  says it once per connection and level: “Thinking was asked for at “low” and none came back from the model. Settings →
  the connection → Test says whether this address gives any at all, or only at a higher level.” (Never when the dial is
  Off, never twice, and never when the thinking came back and is merely hidden — that word is M319's.)
- “TEST” ANSWERS WHICH IT IS. It used to say only “They answered — the line is good.” It now sends exactly what a page
  sends for the thinking (requestBody — the same plan, the same fields, whole rather than streamed), reads the answer for
  thinking in ANY channel (reasoning_content, reasoning, any field named like reason/think/thought) and for the reasoning
  tokens the answer reports, and says:
    · “Asked at “low” (reasoning_effort: “low”) — 412 characters of thinking came back. Thinking works on this connection.”
    · “…the answer came, but NO thinking with it. Asked again at “max” — 980 characters came back. So it is this LEVEL that
      gives none here, not the address: choose a higher one.”
    · “…It reported 310 thinking tokens, so the model DID think — this address keeps the words to itself.”
    · “…Nor at “max” — this address sends no thinking back at any level, though the model may still think inside it.”
  A refusal on the way teaches the house (M350: the levels it takes, or the field it does not) and the question goes again
  fitted to it; an Off that thought anyway is learned from the test as from a page.
- TESTS: m351.mjs M351-1..5 (it thinks, and what was sent for it; this level not this address; the words kept from him;
  nothing at any level; a refusal taught mid-test; an Off that thinks). DOM-72 in the app: a page whose thinking never came
  back says so once, its receipt keeps it, and the card's Test names which it is (asked at the level set, then once at the
  top).
- NOT VERIFIED, AND CANNOT BE FROM HERE: Synthetic's own behaviour. Whether Kimi K3 there thinks at “low” is now a question
  his own app answers in one tap.
- THE WALK'S OWN LESSON (twice, in one scenario): a word the house says ONCE per connection was already spent by DOM-71 on
  the shared house connection, and Settings shows ONE connection card at a time (the picker chooses it) — DOM-72 now uses its
  own connection and picks it, as the older connection scenarios do. Both failures were the test's, not the app's.
- GATES ON THE PUSHED TREE: harness 698/698, walk 91/91 (alone), longplay 8/8, lint clean.
- version.js -> m351-001.

# M352 — "where's the canon verification settings?"
Under “The glossary”, which is nobody's idea of where a switch lives. The rooms of Settings (M105) place a section by a
list in buildQuickNav, and anything unlisted fell to `ROOMS[ROOMS.length - 1]` — the glossary. M346 added
section-canon to the page and not to a room, so the switch the writer was told about was two taps away in the wrong room,
and nothing said so.
- IT STANDS WITH THE REFEREE NOW: Settings → The readers → Canon verification, right under the referee (the section also
  moved there on the page, so the order a writer scrolls matches the room he taps).
- AND THE FALLBACK IS NO LONGER A TRAP: a section nobody listed shows beside its NEIGHBOURS — the room of the section
  after it on the page, else the one before it (roomForSection). The last room is only the fallback of a page with no
  rooms at all.
- HELD TO A LAW, SO IT CANNOT HAPPEN AGAIN: SETTINGS_ROOMS and roomForSection are module-level and exported; M352-1 reads
  the page's own sections and fails if any is listed in none or in two rooms (and if a room names a section the page does
  not have); M352-2 holds the neighbour rule; DOM-73 walks every room in the app and fails unless each section is reached
  from exactly one, canon verification is in The readers, and the glossary holds only the glossary.
- An older law (findability M18 → M105) read the room list out of the source text and broke when it moved; it reads the
  exported list now, and its intent lives in M352-1 besides. The code was right.
- GATES ON THE PUSHED TREE: harness 700/700, walk 92/92 (alone), longplay 8/8, lint clean.
- version.js -> m352-001.

# M353 — "I can't connect it, it keeps having errors — but on Discord people can use it"
The provider is real: Hemmingway (hemmingway.io), its own 27B model, OpenAI-compatible, `hemmingway-27b`, thinking on at
its highest level unless less is asked. Its curl works; a tavern that is a PAGE is a different matter, and that is the
oldest difference between a terminal and a browser: a page may only call an address that answers a browser with its own
permission (CORS). A provider that never meant to be called from a page refuses before the request is made, and the
browser reports nothing at all — the call just throws. Every client that works "on Discord" is curl, a desktop app, or a
server (SillyTavern's own node server proxies every call, which is why nobody there ever meets this).
- THE HOUSE CARRIES IT. The tavern is served by his own server on the same phone, and that server has no such rule. serve.py
  now answers /api/relay: GET says it stands, POST carries one call — the provider's address in X-Relay-Url, its method in
  X-Relay-Method, its headers packed in X-Relay-Headers, the body as it is — and streams the answer back as it comes
  (read1, flushed per piece), passing the provider's own status and words through on a no. https only, and never an address
  on his own network (no way into the phone or the router); the tests reach a local stand-in with COZY_RELAY_TEST=1. The key
  rides in the headers of one request to his own phone and is never written down.
- THE TAVERN TRIES THE DOOR FIRST, ALWAYS. providers/relay.js houseFetch: the direct call is made first, every time; only a
  call that throws with NOTHING is tried again through the house, and only if the house says it can carry. If that works, it
  was the page that was refused: the connection is marked viaRelay, every later call on it goes straight through the house,
  and the turn says so once ("This address refuses calls from a web page, so your own tavern server carried the turn — the
  key never left this phone"). A provider that answers a page is never relayed and never even asks. All eight provider calls
  (both houses: pages, listings, tests, probes) go through it.
- TESTS: tests/relay.py (11 checks: the house says it can carry; the post arrives at the provider's own path with the key
  and the body word for word; the answer comes back whole AND in pieces as they come; a listing is carried as a get; the
  provider's own 400 and its words pass through; a plain http address and an address on his own network are refused).
  m353.mjs M353-1..4 (the turn lands through the house, the key goes only to his own server and never into the body, the
  connection is marked and goes straight there next time, the word is said once; no relay = it fails as before and nothing
  false is learned; a provider that answers a page is never relayed; a listing is carried as a get).
- NOT VERIFIED: Hemmingway itself. This container cannot reach hemmingway.io (host_not_allowed) — the key he offered could
  not be tried from here. What is proven is the carrying, against a stand-in provider behind the real serve.py.
- GATES ON THE PUSHED TREE: harness 704/704, walk 92/92 (alone), longplay 8/8, lint clean, tests/relay.py 11/11.
  tests/holdsone.py cannot run in this container at all (Playwright: "Execution context was destroyed") — it fails the same
  way on the tree as pushed before this change, so it says nothing about serve.py's relay either way.
- version.js -> m353-001.

# M354 — making the 27B punch above its weight, all of it behind the derestricted switch
He is telling his story with Hemmingway-1 (Altworld, 27B, a Qwen3.8-27B finetune, Apache-2.0, 262k of room, served by
hemmingway.io as `hemmingway-27b`). Its own card names where it loses: HOSTILE STORYTELLING and LONG STORY TURNS — and
both are one thing. A model tuned to hand people the finished thing they asked for (its wins: everyday messages,
sounding like a person, "hard asks", "talking someone round") will soften whoever is set against the writer, and on a
long turn will FINISH the scene — which means speaking, thinking and moving his character for him, because a scene where
nobody answers is not "finished". That is exactly what he sees: cringe words in his character's mouth, his character
moved for him, and a room that agrees with him.
- THE FIVE PLAIN LINES (assemble/plain.js plainRules), in his own voice, led by the teller's name, LAST in the closing
  words where a small model looks hardest: his character is his (never his words, thoughts, or a move he did not make);
  anyone set against him STAYS set against him; let the room talk (several real exchanges, their own voices, never his);
  end where he can act (a live beat, nothing wound down or summed up); stay in the moment as it happens. Five, not
  fifteen — a small model keeps a few and drops a list. Not one word about the page's SHAPE (M342 stands).
- WHAT EACH PERSON HERE IS IN THE MIDDLE OF (anchor.js peopleNow), said once more at the end with the hour and the
  ground: the ledger's own words for the people actually in the scene (never his character's, at most four, cut at 140
  characters). Facts, not instructions — the same design as M343 — and the cheapest guard there is against a room that
  quietly agrees with him.
- THE PAGE THAT TOOK HIS CHARACTER IS ASKED FOR AGAIN, ONCE (plain.js mineLeak, voice.js askAgain('mine'), the re-ask in
  ui/chat.js beside M117's). Seen: a line in his mouth in any of the three shapes a page writes it, his own thinking
  ("Jovan decided…"), a move he did not make. NOT seen (deliberately narrow): his name in the scene, his name in someone
  else's mouth, his body described, someone else acting in a sentence that names him — and never anything his OWN message
  just said (every suspect fragment is weighed against his words first: the page telling his move back is not a theft).
  A second try that still takes him is kept; the story goes on.
- THE LAW, FOR EVERY SESSION AFTER THIS ONE: every help for a weak model lives behind the derestricted switch. OFF, the
  turn is byte for byte what it was before any of it existed, and no check runs. His frontier model's persona is what
  breaks first (M340, M341, M342 are what that already cost), so nothing here is ever "just a small improvement for
  everyone".
- WHAT IS NOT IN THE CODE, AND WHY: his sampler (temperature, top-p, penalties) is his — M12's law is that the house sends
  exactly what he set and nothing else, so the numbers that suit a 27B are his to set, not the house's to impose.
- TESTS: m354.mjs M354-1 (the five lines ride ON, and the OFF turn is byte-identical: same system blocks, same messages),
  M354-2 (his words, thoughts and moves seen in every shape, under the fuller name too), M354-3 (and what is not his left
  alone, including the move and the line he wrote himself), M354-4 (the ask is one sentence in his voice and says nothing
  about shape), M354-5 (what each person here is in the middle of: present only, never his character, four at most, cut
  short, nothing invented). DOM-74 walks it in the app: OFF, one call and the page that spoke for him stands; ON, the five
  lines ride and the page that spoke for him is asked again once — and the page kept is the second one.
- Two of the switch's own older laws were scoped, not loosened: M343-2 and M344-3 measured "one breath" over everything
  before his note; the scene IS still one breath, and the five plain lines are their own part after it (they now read the
  scene's part by name). M85's M120-1 reads the wire's name, which gained the carried page. The code was right all three times.
- GATES ON THE PUSHED TREE: harness 709/709, walk 93/93 (alone), longplay 8/8, lint clean.
- version.js -> m354-001.

# M355 — the same words again: a page that repeats the last pages is asked for again, once
The writer, on his 27B: the prose is good, and then it says the same thing again — the same simile, the same half
sentence, the same opening beat, three pages running. It is not a thinking failure and no instruction after the fact
fixes it; it is what a narrow model does when the scene, the ledger and the last pages say the same thing every turn.
His samplers are his (M12), so the house does not touch them — it reads the page instead.
- SEEN MECHANICALLY, NO MODEL AND NO WIRE (assemble/plain.js staleLeak/echoedPhrases): the finished page is cut into
  six-word phrases and weighed against the last six pages AND against itself. A phrase counts only when it holds three
  words that are not plain grammar (so dialogue tags and turns of syntax never fire), never when the WRITER's own message
  said it (the page giving his words back is not a repeat), and never for the names of the people in the room. Overlapping
  runs are merged into ONE named phrase, up to three; a page under 400 characters is not judged at all.
- ASKED FOR AGAIN, ONCE, WITH THE PHRASES NAMED (voice.js askAgain('fresh')): "That page says what we have already said —
  'air was thick with the smell of wet stone'. Same beat, same moment, written fresh: not one of those phrases again,
  nothing repeated inside it either, and no line that opens the way the last pages opened." It shares M354's one ask per
  page (a page is never asked for twice), and nothing is said about the page's shape (M342).
- BEHIND THE DERESTRICTED SWITCH, like every other help for a small model (M354's law). OFF: the check never runs.
- TESTS: m354.mjs M355-1 (the reused phrase named once, not three overlapping ways; a fresh page left alone; a short page
  not judged; his own words given back not a repeat; a page that repeats ITSELF seen), M355-2 (the ask names the phrases,
  asks for the same beat, says nothing about shape, and reads plainly with no names set).
- GATES ON THE PUSHED TREE: harness 711/711, walk 93/93 (alone), longplay 8/8, lint clean.
- version.js -> m355-001.

# M356 — the sensors: the house reads its own story back, and says one thing about it
From the writer, with the Reddit post on Jev: a model that writes no prose at all and only returns typed answers can be
asked narrow questions about a page for a fraction of a penny in a fifth of a second — and the answers, averaged, are a
fact about the story's drift that nobody has to notice by hand. Built, behind its own switch.
- THE QUESTIONS ARE PROPOSITIONS, NEVER TASTE. Five, each true or false of the state: the page matches the tone and
  themes the brief asks for; something genuinely went against the main character and was not undone in the same breath;
  something is at stake; nothing contradicts what the story has established; his own words, thoughts and choices were
  left to the writer. ("Is this any good" is the question that wastes a call — the Reddit post's own finding, and the
  reason every sensor here is a statement about the state.)
- TWO WIRES, ONE SET OF QUESTIONS (agents/sensors.js): a DECISIONS house — Jev on OpenRouter (typesafe/jev-1.13, POST
  /api/alpha/decisions) or TypeSafe's own /v1/systemone — takes {model, state, questions:{id:{type:'noul',instructions}}}
  and answers {answers:{id:{noul:0..1}}}; any ORDINARY model is asked the same statements as one worker call and answers
  with JSON. sensorShape() picks by the address or the model name, and both answers are read the same way (clamped to
  0..1; anything that is not a number is not a reading). The state is what a careful reader would look at: the brief, the
  cast notes, the three pages before, the page that just landed, and who he plays.
- WHAT A READING EARNS: the readings are kept per story (`sensors:<id>`), last four per sensor, averaged. Below its floor,
  the sensor furthest under it earns ONE line — never a list, never a form — said in the writer's voice at the end of the
  NEXT turn (stack.js sensorNote; "The sensors' word" on the receipt), taken once and let go, and that sensor is quiet
  until its average climbs back over its floor. Two readings at least: one dip is not a drift.
- WHERE IT RUNS: the seventh link of the background chain, after the page is kept, never on the way to one; its own
  worker row ("The sensors") so Jev can sit behind it while everything else stays where it is; its readings show in
  Settings -> The readers -> The sensors and on the drawer's line of workers. It never touches the page it read.
- OFF AS IT SHIPS. With `sensorsOn` unset nothing is asked, nothing is sent, nothing is kept — the same law M354 set for
  every other help: his frontier model's turn is what it was.
- TESTS: m356.mjs M356-1 (the wire each model speaks, both addresses, the state, the same questions either way), M356-2
  (both answers read the same way, nonsense dropped), M356-3 (the last few readings, the one line earned by the sensor
  furthest under, quiet until it climbs back, one reading is not a drift), M356-4 (the whole reading through the store:
  kept with the story, taken once, riding the closing words in his voice and named on the receipt; nothing said when
  there is nothing to say), M356-5 (no connection, no page, a house that is down or says nothing — all of it no reading,
  never a thrown turn). DOM-75 walks it in the app: off it is never asked; on, each page is read and the drift is said
  once on the next turn and never twice.
- GATES ON THE PUSHED TREE: harness 716/716, walk 94/94 (alone), longplay 8/8, lint clean.
- version.js -> m356-001.

# M357 — a page that has landed is the story: what the house saw is said BEFORE the next one
The writer, on M354/M355: "why the repetition mode is basically make it resend the page again, why not giving it
critique before it reply based on previous scene? That's breaking immersion." And: "the repetition why it flagged
header wtf."
- THE HEADER WAS BEING READ AS PROSE. Every page opens with the same bracketed row by design ([the courtyard — Monday |
  09:00 | clear | coat | by the gate]), so the repetition reading found it said twice on every single page. plain.js
  stripFurniture cuts every bracketed row before anything is counted — in the repetition reading AND in the reading of
  whether his character was taken (a header names his room, his coat and where he stands; none of that is him acting).
- NOTHING SENDS A LANDED PAGE BACK ANY MORE. The two re-asks (M354's 'mine', M355's 'fresh') are gone, with the wire that
  carried the page (mineWire/mineCarried) and the two asks in voice.js. What the house saw is kept as ONE line
  (plain.js mineWord/staleWord -> sensors.js keepPageWord) and said at the end of the NEXT turn in his voice, through the
  same one-line-per-turn path the sensors use (takeWordForTurn), then let go. The only re-asks left in the house are for
  a page that NEVER ARRIVED — M117's leak, M120/M339's reply that was all thinking — and those show nothing to the
  writer because there is nothing to show. ANY future check follows this law: notice, say it next turn, never resend.
- TESTS: m357.mjs M357-1 (the header not a repeat and not him acting, while real repeated prose still is), M357-2 (the
  word kept with the story, taken once, riding the closing words in his voice; the source carries no mineWire/mineCarried
  and the two asks are gone from his voice).

# M358 — the grounding phrase: the first words of its own thinking
The writer: his teller is funnier and more itself when its thinking OPENS in character ("Autobots, roll out!"); on the
turns that are mostly instruction (a time skip, a house command) the thinking slides into an assistant's voice, which is
the thing he cannot stand. So: a box under the two names, Settings -> This story -> The frame.
- WHAT IT DOES, BOTH WAYS: the phrase is SEEDED into the thinking itself where the model takes a seed (M328's thinking
  prefill: `<think>Autobots, roll out! ` rides as reasoning_content, unfinished, and the model continues the thought) —
  his own prefill, if he has set one, always wins, and an out-of-character turn takes neither. And it is ASKED FOR in his
  voice at the end, beside the thinking line ("Optimus Prime — open your thinking with “Autobots, roll out!”, the way you
  always do, and then think however you like."), so it holds on a house that takes no seed at all.
- EMPTY IS NOTHING AT ALL: no line, no seed, the turn exactly as it was.
- It says nothing about the page, its shape, or what the teller is — M341/M342 stand; this is about the voice its own
  thinking opens in, and nothing else.
- TESTS: m357.mjs M358-1 (kept as typed and tidied; it rides with the two names; the line and the seed; empty is not one
  word), M358-2 (his own prefill wins; an out-of-character turn takes neither).
- ON HOLD, at his word: everything for small models. He tells with his frontier model — M354/M355 stay behind the
  derestricted switch (off) and M356's sensors behind their own (off), and nothing further is built for weak models
  unless he asks again.
- GATES ON THE PUSHED TREE: harness 719/719, walk 94/94 (alone), longplay 8/8, lint clean. DOM-74 moved with the law: the
  page that took his character now STANDS, and the word comes before the next one.
- version.js -> m358-001.

# M359 — the grounding phrase through the whole standing word, #story on its own, and his preset read back to him
- WOVEN INTO THE PRESET ITSELF (voice.js groundingWeave). He asked for it "before preset… randomly anywhere between 30% of
  total preset words so it'll stuck on the AI mind". Randomly is the one thing not to do: a phrase dropped mid-sentence
  breaks the sentence it lands in and reads as damage, not voice. It goes where a reader would put it — once as the first
  breath after the frame's opening paragraph, and once more at the PARAGRAPH BREAK nearest a third of the way down (his
  30%, landed on a boundary). Never inside a paragraph, never more than twice, and weaving twice is weaving once.
- IN FRONT OF A HOUSE COMMAND'S LAW (stack.js). A turn that is mostly instruction (#time skip, #p, #pp, #q, #continue) is
  exactly where his teller's voice slid into an assistant's; the command's law now opens with his phrase in quotes, so the
  first thing read on that turn is his teller's own words.
- #STORY WAS NOT MISSING — it is in js/commands.js and in the glossary — but it demanded a concept, and a bare "#story" fell
  through to nothing. The concept is one more unspecified detail, and that command's own law says every one of them is
  chosen and written in, never asked about: "#story" alone now opens a tale named "A new tale" and hands the choosing over
  (the world, the hour, who MC is, who is with him), first scene written at once. "#storyteller" is still not the command.
- HIS OWN PRESET, READ BACK TO HIM (assemble/plainvoice.js, Settings -> This story -> The frame -> "Read my standing words
  for an assistant's voice"). He asked whether the house could look over the whole forty thousand words instead of him
  pasting them: it can, mechanically, with no model and no wire. Every line of the frame, this tale's own frame and every
  module on the shelf is read against two lists — the words that name the machine (an assistant, a model, a prompt, the
  user, a policy, the makers) or the apologetic register ("I cannot", "I apologize", "Let me know"), and the register of
  documentation ("output", "ensure", "step-by-step", "it's important to note"). ONE finding per line, with every word in it
  that does it and where it stands. It rewrites NOTHING: his words are his, and a machine guessing at his prose is how a
  voice gets flattened.
- TESTS: m359.mjs M359-1 (woven after the opening breath and a third down, never inside a paragraph, never twice over,
  empty leaves the frame untouched), M359-2 (in front of a command's law, and the law alone when the box is empty),
  M359-3 (#story named and bare, and #storyteller is not it), M359-4 (one line at a time with its words, his own prose
  left alone, a clean frame reads clean).
- GATES ON THE PUSHED TREE: harness 723/723, walk 94/94 (alone), longplay 8/8, lint clean.
- version.js -> m359-001.

# M360 — fifty lines is not fifty problems: the reading of his preset, grouped
He ran M359's reading and got "50 lines read like a machine, not a person", and asked whether he should hand over the
whole preset. Both the number and the question were the reading's fault, not his:
- A PRESET IS ALLOWED TO INSTRUCT. Half the list was register ("output", "ensure", "format", "note that") in text whose
  whole job is instruction. What actually breaks a teller's voice is narrower: the words that name the APPARATUS (an
  assistant, the user, a prompt, a policy, the makers) and the apologetic register ("I cannot", "I apologize", "Let me
  know").
- AND HALF OF IT WAS NOT HIS. The shelf holds the house's own rulebook (modules with source 'builtin'), which is spoken
  in his voice when it is sent (inVoice/inPerson) and is not his to fix — it was being listed beside his own lines as
  though it were.
- SO THE READING IS GROUPED (plainvoice.js groupFindings): what HE wrote that names the machine, first and named; what of
  his only reads like a manual, second and his call; and the house's own rulebook, counted and never listed. A clean
  frame with a noisy house rulebook now says "Nothing in YOUR words sounds like an assistant".
- AND THERE IS ONE TAP TO HAND THEM OVER (findingsText + a Copy button): the flagged lines of HIS, grouped, as plain text
  — never his prose, never the house's rulebook, never the forty thousand words.
- TESTS: m359.mjs M360-1 (the three groups, the copy's text, his prose and the house's words kept out of it, a clean
  frame reads clean). DOM-76 in the app: the list leads with what is his and what matters, names the line, leaves his
  prose out, counts the house's rulebook apart, the copy takes the flagged lines, and his frame is untouched.
- GATES ON THE PUSHED TREE: harness 724/724, walk 95/95 (alone), longplay 8/8, lint clean.
- version.js -> m360-001.

# M361 — {{user}} went to his storyteller as template syntax
He pasted the lines the reading flagged (M360). Four of the six "names the machine" lines were `{{user}}` — and that was
not a flag about his writing, it was a bug in the house: his rules came over from SillyTavern, where {{user}} and
{{char}} are swapped for names before anything is sent, and this house never swapped them. So every rule he brought over
sent "{{user}}" to his storyteller as raw template syntax — exactly the machinery he is keeping out of its head.
- SWAPPED NOW (voice.js withMacros, the first thing inVoice does, so every place his standing words are voiced has it:
  the frame, the frame's purpose, the craft, every woven rule, the note): {{user}} and <USER> are the one he plays — the
  main character's story name, else his own name, else "the one I play"; {{char}} and <BOT> are the teller, else "the
  storyteller". However they are spelled ({{ User }}, {{CHAR}}). Text without them is untouched.
- THE READING SEES HIS WORDS AS THEY WILL BE SENT, so {{user}} is never flagged as "user" again; and what it copies is the
  WHOLE line (a line cut off with "…" cannot be rewritten by whoever it is handed to — his paste arrived cut).
- HIS NAME: nothing in the house touches the name he writes in his own rules ("LO"). The house only swaps ITS own words
  ("the writer", "the house") and now these macros. If "Your name" in The frame says anything other than what his rules
  call him, his storyteller reads two names for one man — the box should say what his rules say.
- TESTS: m359.mjs M361-1 (every spelling of both macros, his own name before the story names his character, plain words
  with no name at all, text without macros untouched, and a whole request with not one macro on the wire), M361-2 (the
  reading sees {{user}} as his character's name; the list stays short and the copy is the whole line).
- GATES ON THE PUSHED TREE: harness 726/726, walk 95/95 (alone), longplay 8/8, lint clean.
- version.js -> m361-001.

# M362 — "LO" in his rules follows whatever Your name says
He asked for his name in his own rules to follow the name he sets, not to be told to keep two boxes in step by hand.
- A BOX BESIDE YOUR NAME (Settings -> This story -> The frame): "What your rules call you" (e.g. LO). Every whole-word
  mention of that name in his standing words — the frame, this tale's frame, the craft, his rules, the note — goes out as
  whatever Your name says (voice.js withHisName, inside inVoice beside the macros). Change Your name and every mention in
  his rules follows; nothing to edit by hand.
- EXACT, SO IT CANNOT DAMAGE HIS PROSE: whole words only (never "hello", "LOW", "SLOW"), case as he typed it (never "Lo
  and behold"), possessives included ("LO's", "LO’s"), beside any punctuation. Nothing at all when either box is empty or
  the two already agree. His own pages are his words and are never rewritten.
- The reading of his preset (M359-M361) reads it with the same swap, so it sees what is sent.
- TESTS: m359.mjs M362-1 (every mention and possessive, never inside another word or another case, nothing when a box is
  empty or they agree, the whole standing word as sent with not one "LO" left, and his own page untouched). DOM-77 walks it
  in the app: both boxes typed in Settings, a page sent, the storyteller's request read.
- GATES ON THE PUSHED TREE: harness 727/727, walk 96/96 (alone), longplay 8/8, lint clean.
- version.js -> m362-001.

# M363 — a crowd of accounts is not him
He asked whether two flagged lines of his Twitter X Feed rule were a problem: "User Pool Array:[" and "Select =
Random(Quantity=5, Source=User Pool Array)". They are not — "User" there is the crowd of accounts on the in-story feed,
not the man writing the story — and the reading could not tell the two apart.
- plainvoice.js: "user" followed by the word for what it is (a pool, an account, a handle, a list, a profile, a feed, a
  post…) is someone else's user and is left alone; "the user", "user's", a bare "user" are still him, and still flagged.
- TESTS: m359.mjs M363-1 (his two lines and an account/handle left alone; "the user" still flagged, with its reason).
- GATES ON THE PUSHED TREE: harness 728/728, walk 96/96 (alone), lint clean. A reading-only change — nothing sent is touched.
- version.js -> m363-001.

# M364 — a new version of a page is written where that page stands
The writer: "when I swipe for an alternative answer it starts at the bottom, unlike SillyTavern". The page being written
was always APPENDED to the end of the thread (`els.thread.appendChild(pending)`) and the view followed it down — so a
swipe grew a second copy under the first and dragged him to the bottom of a long page.
- The version being written now takes the page's own place: the old version is hidden while it is written (and back the
  moment the writing stops without landing — the pending node's remove() puts it back, so every one of the seven exits
  that drop a page being written restores it), the view goes to the new version's FIRST line, and nothing drags it down
  (holdPlace: the scroll handler does not turn following back on while a swipe is written; the three follow-downs in
  generate() skip a version written in place). A new page, not a swipe, is written at the end exactly as before.
- TESTS: DOM-78 walks a swipe with the answer held mid-page: the page it replaces steps aside, the new version is written
  in that page's own place (its previous sibling), no second copy is added, and the new version lands in its place.

# M365 — the world moves on: a seat goes stale, and a bond is a cause
The writer: "Caleb keeps parking at Jovan's neighbor like a weirdo who has no life; every NPC should have a background,
be alive, have friends who call or text him — 'what are you doing, cap', he's literally the football captain. After a
time skip the ledger seems confused, and some people are still stale."
- ROOT CAUSE: the world agent's roster marked only people with NO seat ("[NO SEAT — seat them]"). Anyone seated once —
  however long ago, however many hours the story then skipped — was never looked at again. Caleb, seated at the
  neighbour's on Monday afternoon, was still there on Thursday, because nothing ever asked where he was now.
- A SEAT HAS AN AGE (world.js seatAge/seatIsStale): story-minutes since it was written (pages when the story keeps no
  clock). Three story-hours (or twelve pages) on, it is stale, and the roster marks it "[SEATED 26 hours ago — move them
  on]" exactly as it marks no seat at all; the brief tells the agent to move every one of them on with a real
  offscreen.set — where their own day has taken them. A TIME SKIP AGES EVERY SEAT AT ONCE, so the next pass walks the whole
  world forward to the new hour. "A person who has been in the same place for a day with nothing holding them there is a
  mistake in the ledger, never a life."
- A BOND IS A CAUSE: the law for calls and texts said "only when a cause on the ledger produces it", and a friend
  wanting to talk is rarely written down as one — so friends almost never reached out. The people closest to him (a best
  friend, a teammate who calls him "cap", family, someone he is seeing) now reach out the way people do when their own day
  gives them a moment; the old limits still stand (never on a timer, at most one contact a scene).
- TESTS: m364.mjs M365-1 (a seat's age by clock and by pages; three hours / twelve pages; a 26-hour skip), M365-2 (the
  roster marks Caleb with how long he has sat there, leaves a fresh seat alone, and the brief the agent really receives
  carries the law), M365-3 (a bond is a cause, and the old limits still stand).
- M34-6 (a source reading of the landing scroll) now reads the in-place form too; the law is unchanged: only near the
  bottom, and never for a version written in its page's place.
- GATES ON THE PUSHED TREE: harness 731/731, walk 97/97 (alone), longplay 8/8, lint clean.
- version.js -> m365-001.

# M366 — correcting M365: Caleb's own life, and no quota on real life
The writer, rightly angry: M365 misread him. Caleb is not his main character — Caleb is an NPC in the ledger, the football
captain, and the complaint was that CALEB has no life: parked at the neighbour's, nobody around him, no teammates texting
HIM ("what are you doing, cap"). M365 instead wrote a line about people texting the main character "cap", and kept — and
leaned on — a limit of "at most one such contact per scene". His words: "what happens if my mom, my sister, my friend also
text me? Why make everything gamey, unlike a realistic real-life simulation?"
- EVERYONE LIVES THEIR OWN LIFE (the world agent's brief): the people in the ledger are not arranged around the main
  character; each has their own day, their own work or school, friends, family and plans, and their own people who call and
  text THEM — the team texts its captain, a sister calls her brother, friends make plans without anyone on the page.
- CONTACTS AS REAL LIFE SENDS THEM: the one-a-scene cap is gone. The people in his life reach out when their own lives give
  them a reason, and on a busy evening that can be several at once, or none. No quota, no schedule, never invented to fill
  a scene — each comes from that person's own day and what they want.
- LOOK AGAIN, DON'T FORCE A MOVE: M365's "move EVERY one of them on" was a game rule too. A person not looked at for hours
  of story is marked "[last placed … ago — where are they now?]" and the agent writes where their own life has them NOW —
  which may be the same place if their life truly keeps them there (asleep at home, at work through a shift), but never
  simply where the story last left them. After a time skip, everyone is looked at this way. (The age is only when to look
  again; what the agent writes is the person's life, not a timer's.)
- TESTS: m364.mjs M366-1 (the mark and the look-again law as the agent receives them; staying put allowed when life keeps
  them there, parking not), M366-2 (the world not arranged around him; NPCs reached by their own people — the team texts
  ITS captain; several contacts at once or none, no quota; the one-a-scene cap gone; nothing invented to fill a scene).
- GATES ON THE PUSHED TREE: harness 731/731, walk 97/97 (alone), longplay 8/8, lint clean. One walk before it failed ten
  early scenarios in a cascade (DOM-6c, DOM-8a-f, DOM-11c, DOM-13c — each waiting on pages an earlier one makes) and the
  very next run of the same tree passed all 97; this change touched only the world agent's brief text, which the walk's
  fake house never reads. Unexplained, recorded here so a second sighting is recognised.
- version.js -> m366-001.

# M367 — a life of their own never drops him
He asked whether M366 had quietly made the people who DO have a reason concerning his main character stop acting on it.
Read as sent, the risk was real in the wording: "the people in this ledger are not arranged around the main character"
stood alone, and three sections later THREADS still said "two or three hot threads at most" — so a model could take the
first as leave to look away from him, and the second benched everyone past the third.
- The life law now says both halves together: a life of their own is never a reason to drop HIM — anyone with a reason
  concerning the main character (a thread, a grudge, a want, a debt, a bond) keeps pursuing it through that life, when that
  life gives them the chance.
- THREADS has no count: every agenda someone holds toward him keeps moving. A thread is hot while its owner is in position
  to press it now, quiet while their own life keeps them away (work, distance, a plan still ripening), and wakes when it
  lets them — never frozen because too many others are pressing. (M366's standing law, applied to the one count it missed.)
- Left as it was, deliberately: "twb — at most ONE window into the world beyond". That is how many cut-aways the
  STORYTELLER shows in one page (pacing on the page), not how many people live or act; the world behind it is unlimited.
- TESTS: m364.mjs M367-1 (both halves said together, a reason concerning him still pursued, every agenda moving with no
  count, nobody benched by a number, the old cap gone, a thread quieted only by its owner's life).
- GATES ON THE PUSHED TREE: harness 732/732, walk 97/97 (alone), longplay 8/8, lint clean.
- version.js -> m367-001.

# M368 — the ledger as a world: threads between anyone, factions for their own reasons, the storyteller's view kept small
He asked whether the ledger already is a world simulation of its own — not bloated, rotating without dropping the important
cast, NPCs with threads between each other, factions making their own moves — while never confusing the storyteller.
- ALREADY SO, AND HOW (no change): the storyteller's people view is budgeted by the context (engine/people.js peopleView):
  on his half-million context up to 16 present people with full cards, 6 recalled, and a roster of up to 60 names, all
  inside a people budget of at most 72,000 characters (about 18k tokens); who rides is weighed by importance
  (importanceOf), and anyone the brief or his cast notes name weighs 30 more, so his own cast is never rotated out for a
  passer-by. The world agent sees everyone, whole (peopleForWorld).
- THREADS BETWEEN ANYONE (new): a thread was framed as "a live agenda pushing toward the main character", so NPCs never
  had business of their own with each other. thread.set now carries `with` (the other party), the schema and the THREADS
  law say threads run between ANY people (a rivalry on the team, a sister and her mother, a debt between neighbours).
- HIS OWN THREADS LET GO LAST (new): the ledger keeps up to 40 world threads and let the coldest-oldest go. With threads
  between anyone, a crowd of other people's business could have pushed his own cold threads out. setThread now lets go of
  threads that do not touch the main character first (then cold before hot, then oldest).
- THE STORYTELLER SEES THIS SCENE'S THREADS FIRST (new): it is shown five threads, and they were simply the hottest and
  newest anywhere. renderThreads now ranks the threads touching this scene (someone present, or the main character) first,
  cold or not — other people's business away from the page stays in the ledger for the world agent and never crowds the
  storyteller's few lines. The world is large; the storyteller's view of it stays small and on the scene.
- FACTIONS FOR THEIR OWN REASONS (brief): a faction still moves only on cause, and the brief now says its cause is often
  its own — its rivals, its money, its people, its politics — not only the main character.
- TESTS: m364.mjs M368-1 (a thread between Caleb and Marcus kept with its other party; the schema and the law say threads
  run between anyone; factions' own causes), M368-2 (forty-five cold threads of other people's never push out his oldest
  coldest one, the bound still held; the storyteller's lines are the ones touching this scene, cold or not, never others'
  hot business elsewhere; the other party named when shown). M367-1 moved to the widened wording.
- GATES ON THE PUSHED TREE: harness 734/734, walk 97/97 (alone), longplay 8/8, lint clean.
- version.js -> m368-001.

# M369 — the banner about a seed he never set
He saw a banner, gone before he could read it: "…thinking seed… sent…". It was M358's grounding phrase: the house plants it
as a seed at the start of the thinking (a thinking prefill), and his model on that connection sent no thinking back, so the
provider reported the seed as sent-but-steering-nothing and the house said, in the prefill's own words, "Your thinking seed
was sent, but no thinking came back from this model". He never set a seed; he set a grounding phrase.
- SAID IN HIS WORDS: when the seed was the grounding phrase, the banner now reads "This model sends no thinking back, so
  your grounding phrase can't be planted at the start of its thinking. It is still asked for in your words at the end of
  every turn — nothing else changes." Once. A prefill he set himself keeps its own old words.
- AND NOT PLANTED THERE AGAIN: the connection remembers it for that model at that address (groundingSeedFailedFor), so the
  seed stops riding on a model that cannot carry it; the line asking for the phrase still rides every turn. A different
  model or address is tried afresh.
- {{user}}/{{char}} (M361) CANNOT BREAK THE PERSONA: they used to reach the storyteller as raw template syntax; they are now
  the names SillyTavern itself would put there — {{user}} the character he plays, {{char}} his teller.
- TESTS: DOM-79 (a model that sends no thinking back: the banner in his words, once, not the old seed words; remembered for
  that model; not planted on the next turn; the phrase still asked for at the end).
- M358-2 reads the source for his own prefill winning; M369 put the seed's memory between, so its window widened. Law
  unchanged.
- GATES ON THE PUSHED TREE: harness 734/734, walk 98/98 (alone), longplay 8/8, lint clean.
- version.js -> m369-001.

# M370 — undoing M369: the grounding phrase is never announced and never withdrawn
The writer, rightly: "grounding phrase also can be used for non-thinking — that's why we have everything before the header
acted as thinking, so it doesn't matter, it's actually helping… my gut feels this is stupid." M369 answered a banner he
could not read by making a NEW banner and by withdrawing the phrase's seed from any model that once sent no thinking back.
Both were wrong:
- A MODEL THAT SENDS NO THINKING BACK IS NOT A REASON TO STOP. What a model writes before the page's header IS its
  thinking — the page gate cuts it off as such — so the phrase that opens it helps a model that does not think natively just
  as much. The phrase is also woven into the standing words and asked for at the end of every turn. And "sent none back
  once" was remembered per model and address, so the same model raised to a higher level, or simply thinking on its next
  turn, would never have been seeded again.
- HIS PERSONA'S WORDS ARE NEVER ANNOUNCED. A banner about the grounding phrase's plumbing is exactly the machinery he keeps
  out of sight. So: planted on EVERY turn, whatever the model did last time; nothing remembered on the connection; no banner
  about it at all. The only seed banner left is for a prefill HE set himself.
- {{user}}/{{char}}: the storyteller never sees them — they are swapped for names before anything is sent (M361).
- TESTS: DOM-79, rewritten: no banner about the grounding phrase or a seed, the phrase planted again on the next turn (as the
  last assistant turn's thinking), still asked for in the closing words, nothing remembered on the connection.
- GATES ON THE PUSHED TREE: harness 734/734, walk 98/98 (alone), longplay 8/8, lint clean.
- version.js -> m370-001.

# M371 — the grounding phrase on every turn, out-of-character ones included
He asked for confirmation that the phrase rides EVERYTHING — every # command, #time skip and #story included, thinking and
non-thinking models alike — and whether it still lands first. Checked turn type by turn type against buildRequest:
- A PAGE ("I walk in."): woven twice into the standing words (after the frame's opening breath, and at the paragraph break
  nearest a third down), asked for in his voice at the end, and planted as the first words of the thinking.
- EVERY # COMMAND (#time skip, #story, #p, #pp, #continue): all of the above, AND the command's own law opens with it.
- THE OUT-OF-CHARACTER TURNS (#question, ((…)), //): woven, asked for, and the law opens with it — but the thinking seed
  was skipped on them (M358 had copied the rule that an out-of-character turn takes no prefill). That rule exists for HIS
  prefill, which opens a PAGE; the grounding phrase is his teller's voice, and the out-of-character turns are exactly where
  a teller slides into an assistant's register. Now the phrase is planted on them too; his own story prefill still never
  rides an out-of-character turn, and still wins on a page of the story.
- WHERE THE SEED IS PLANTED, IT IS LITERALLY FIRST: it rides as the opening of the model's thinking (reasoning_content where
  the provider takes it, a <think> opening where it does not). A model that does not think writes its thinking before the
  header, and the phrase opens that. Where no seed can ride, the line at the end asks for it as the first words.
- The workers (the world agent, the readers) do not carry it: they are not his teller, and never speak as it.
- TESTS: m357.mjs M358-2 moved to the widened law (planted where he set no prefill and on every out-of-character turn; an
  out-of-character turn carries the phrase and never his story prefill). DOM-79 gains two out-of-character turns in the app:
  the thinking opens with the phrase, and with his own prefill set it still does while his prefill never rides.
- GATES ON THE PUSHED TREE: harness 734/734, walk 98/98 (alone), longplay 8/8, lint clean.
- version.js -> m371-001.

# M372 — what the ledger says happened: who did what, with whose thing
His report, and his principle: "my mission is to build everything autonomous — I should not fix it manually with the help of
the housekeeper." The ledger said Vanessa called Jovan's phone. The page was ambiguous, but a careful reader (him, and the
housekeeper when asked) knew it was Rias's phone: Rias had just declined Vanessa's text, Vanessa called again, and Rias
handed her phone to Jovan.
- WHY NOTHING CAUGHT IT: the auditor runs after every page and holds the whole ledger against the pages, but its checklist
  covered the hour, the ground, who is here, the seats, each person's page against the brief, canon, bodies, standings,
  threads, loose ends and who witnessed what — never WHAT THE LEDGER SAYS HAPPENED. And had it noticed a wrong fact in who
  knows what, it could not have let it go: knowledge.forget was the housekeeper's alone.
- THE AUDITOR NOW CHECKS IT (agents/auditor.js): every line that says who did what, to whom, or with whose thing (a call, a
  message, a phone, a key, a gift, a blow, a promise) is held against the pages the way a careful reader reads them —
  following the sequence across pages, not one line alone ("the phone in her hand is HER phone even when a later line only
  says 'the phone'; a call that comes again to the phone she just declined comes to her, and reaches him only because she
  handed it over"). Where one page is ambiguous, the reading the sequence makes plain wins. A wrong line is corrected
  wherever it stands: a person's page (people.set), a thread's next step (thread.set), a loose end (people.note), or a fact
  (knowledge.forget of the wrong one, knowledge.add of the right one — knowledge.forget joins AUDITOR_TYPES).
- THE FIRST READER IS TOLD THE SAME (agents/extractor.js, "WHOSE AND WHO"), so the wrong line is not written in the first
  place; the auditor is there for what slips through.
- THE PAGE IS NEVER REWRITTEN: the story stands as written (M357's law); the ledger is what read it wrong.
- TESTS: m372.mjs M372-1 (knowledge.forget is the auditor's now, and through the ledger a wrong fact goes and the right one
  stands), M372-2 (the check, his own case as its example, the means to fix and "never the page", all in the auditor's
  brief as it is really built; and the first reader's brief carries WHOSE AND WHO).
- GATES ON THE PUSHED TREE: harness 736/736, walk 98/98 (alone), longplay 8/8, lint clean.
- version.js -> m372-001.

# M373 — the connection test says how fast the connection is
He asked for the connection's Test to show its latency and its speed. Both now come from ONE streamed answer, the way a page
streams (js/providers/speed.js), timed after the test has found the line good:
- FIRST WORDS AFTER: from the moment the ask leaves to the first thing the model sends back — thinking or text, whichever
  comes first. What he waits through before a page starts to move.
- TOKENS A SECOND: how fast it writes once it has started — the tokens it sent (the provider's own count where it reports
  one: OpenAI-shaped via stream_options.include_usage, Claude via message_delta's output_tokens; otherwise estimated from
  the characters at four to a token, and SAID to be an estimate) over the time from its first word to its last. The wait
  before the first word is never counted in the speed, so a slow start never hides a fast writer.
- HIS SETTINGS RIDE (M12): the timed ask is built by the same requestBody a page uses — his temperature, his thinking
  level — on a short fixed ask (SPEED_ASK), capped at 700 tokens (Claude: more when its thinking budget needs it); it
  never touches a story. A provider that refuses the count request (a 4xx naming stream_options) is asked once more
  without it.
- On the card: "Speed: first words after 0.80 s · 120 tokens a second (60 tokens in 2.8 s)." appended to what the test
  already says. Nothing streamed back is said plainly; an answer too short to time says so.
- TESTS: m373.mjs M373-1 (first words after, thinking counting as the first word; the provider's own count; the wait not
  counted in the speed; the sentence), M373-2 (no count -> estimated and said; nothing streamed said plainly; Claude's
  thinking and its own count), M373-3 (the test itself: the line found good, then one streamed ask with his temperature on
  the fixed ask, refused with the count request and asked once more without it). m351.mjs's fake house keeps the timed
  answer apart from the thinking questions it counts (the questions are unchanged). DOM-72 taps Test on a real card and
  reads the speed line.
- GATES ON THE PUSHED TREE: harness 739/739, walk 98/98 (alone), longplay 8/8, relay.py 11/11, lint clean.
- version.js -> m373-001.

# M374 — why thinking read 40 tokens a second and no thinking read 3 (or 20)
His report: the same connection timed 40 tokens a second with thinking on, and 3 — or 20 — with it off. Some of that can be
real (a provider may route thinking and non-thinking asks to different machines), but the reading itself had three faults,
each of which bends exactly this way:
- THE CLOCK STARTED ON A SPACE. A provider may open its stream at once with a chunk that carries only " " or a newline,
  before the model has written anything; the first word was timed from there, so the whole wait for the model counted as
  writing time and a short answer read as a crawl. The clock now starts on the first chunk with real text in it (speed.js).
- THINKING COUNTED BUT NEVER STREAMED WAS CREDITED AS WRITING. A model that thinks silently reports those tokens in its count
  while the stream shows only the text; divided by the text's short window, it read many times faster than it writes. When
  the provider reports reasoning tokens and no thinking was streamed, they are taken out of the count (thinking that WAS
  streamed is writing we watched, and still counts).
- THE SAMPLE WAS TOO SHORT. A hundred words is ~130 tokens: with thinking off, one network burst or one stall decided the
  whole reading (hence 3 one time, 20 the next). The timed answer is now three hundred words (cap 1,200 tokens).
- TESTS: m373.mjs M374-1 (a stream opening with a bare space: first words at the real word, 40 a second — 17 the old way),
  M374-2 (800 silent thinking tokens not credited — 50 a second, not 450; streamed thinking still counts), M374-3 (the
  timed answer asks for three hundred words).
- GATES ON THE PUSHED TREE: harness 742/742, walk 98/98 (alone), longplay 8/8, lint clean.
- version.js -> m374-001.

# M375 — the grounding phrase had become machinery his teller talked about
His report: at m359 his funny persona held in the thinking; now the thinking says "user" and "wrapper". The house's own words
carry no machine word at all (checked: a page, #time skip and an out-of-character turn built as sent, read with the M359
reader — zero lines). What had changed was HOW the phrase reached the teller:
- THE SEED ON A PROVIDER THAT DOES NOT CONTINUE. The phrase was planted as a trailing assistant message carrying it as
  thinking. DeepSeek (prefix) and Moonshot (partial) read that as the START of the reply and continue it; Synthetic — his
  frontier model's house — has no continuation flag, so the same message is a FINISHED, EMPTY assistant turn at the end of
  the conversation, which the model then reads and reasons about ("the user's message… this wrapper…"). M370 made it ride
  every turn and M371 widened it to out-of-character turns, so it grew worse after m359. Now (effort.js seedContinues) the
  phrase is seeded ONLY where the provider truly continues a thought: DeepSeek, Moonshot, a Moonshot model on OpenRouter,
  or a continuation flag he typed himself. Never Synthetic, Hemmingway, other OpenAI-shaped houses, or Claude.
- THE QUOTATION GLUED TO A COMMAND (M359): "“X” — #time skip — jump to…" is a quote hanging before a house command — the
  very shape a thinking model calls a wrapper. Gone: a command's law goes as it is.
- THE ORDER AT THE END (M358): "open your thinking with “X”, the way you always do…" is an instruction ABOUT the thinking,
  and an instruction about the thinking is what a teller narrates, in an assistant's voice ("the user wants me to open
  with…"). Gone.
- WHAT STAYS: the phrase woven into the standing words as who the teller is (M359's weave — part of his persona, not an
  order this turn), and the true seed where the provider continues it. Empty box: not one byte.
- TESTS: m357.mjs M358-1 (no order at the end, the phrase in the standing words, empty is nothing), m359.mjs M359-2 (a
  command's law goes as it is), m373.mjs M375-1 (which providers truly continue: DeepSeek, Moonshot, OpenRouter's Moonshot,
  a typed flag — never Synthetic, Hemmingway or Claude). DOM-79 in the app: on a provider with no flag, no seed, no order at
  the end, nothing announced, the phrase in the standing words; with a flag, the thought opens with it, out-of-character
  turns too, his story prefill never riding those.
- GATES ON THE PUSHED TREE: harness 743/743, walk 98/98 (alone), longplay 8/8, lint clean.
- version.js -> m375-001.

# M376 — "a banner I don't know, during thinking, then my thinking stops, then it restarts"
When the first try brings back no page — its thinking used the whole room and the page was cut, or it thought and then
wrote almost nothing, or a provider leaked its control tokens — the house asks a second time (M117, M120, M323-M339). That
recovery was right; how it showed was not: a toast ("Asking again.", or a long line about planning) flashed by, the box of
thinking he had been reading vanished, and a new thinking began from nothing.
- NO BANNER: the three second tries say nothing on screen.
- THE THINKING CARRIES ON: each second try is handed the thinking he was watching (thinkingShown) and it stands in the box
  the moment the second try opens; the new thinking continues under it. All of it — the first try's thinking, the plan it
  wrote, the second try's — is kept with the page (the M323 plan-carry, widened to every second try).
- THE COMMONEST CAUSE, PREVENTED: a thinking model spends its room thinking first; with the room he set below what a
  thinking page needs, the page was cut before it came and the second try was forced. His rule allows exactly one
  override — "a floor that prevents corruption (e.g. a minimum token budget)" — so a THINKING page (thinking asked for, or
  a model that always thinks) whose room he set below 16,000 tokens is given 16,000 (PAGE_THINKING_FLOOR, the same floor
  the workers already keep). A room above it is his own number; a room he never set is never sent; no thinking, his number.
- TESTS: m376.mjs M376-1 (thinking at 4000 -> 16000; no thinking 4000 stays; 30000 stays; unset never sent). DOM-80 in the
  app: a first try with long thinking and no page, the second held open — the second try opens with the first thinking in
  the box, no banner, and the landed page keeps both thinkings. (A source-reading version of that law was deleted: a test
  runs the feature.)
- GATES ON THE PUSHED TREE: harness 744/744, walk 99/99 (alone), longplay 8/8, lint clean.
- version.js -> m376-001.

# M377 — the house never asks again on its own
His order, after M376: "I hate this — delete this feature. Just let me do the retry button manually, because the automatic
thinking breaks my persona." Every automatic second try handed his teller a line from the house about its own last answer
("Your last try put the whole page inside your thinking…", "You ran out of room while you were still planning…", "That was
you thinking it over…") and the teller answered THAT, in an assistant's voice.
- DELETED: M117's second try after a provider leak, M120's after a page written inside the thinking, and M323/M324/M325/
  M339's after a plan (or a thinking-over) with no page — with the wire that carried them (the nudged messages, planWire,
  planCarried/planKind), M376's carried thinking (thinkingShown), and the words themselves (voice.js askAgain, all kinds).
  A reply that brings no page lands AS IT CAME — a plan cut short is marked cut short, a reply that is all plan is the page
  he sees — and "Try again", the ▸ and the note's "Ask again" are his.
- KEPT, BECAUSE NOTHING IS SENT: when a page was plainly written inside the thinking and the answer is empty, the page is
  taken from the thinking's last header line on — locally, silently (its toast is gone too). And M376's floor: a thinking
  page is never given less than 16,000 tokens of room when he set less — the commonest reason no page came at all.
- TESTS MOVED WITH THE LAW: m85.mjs M117-1 (the page ends at the leak; nothing asked again) and M120-1 (no second try in the
  source; the page taken from the last header, without a banner); m327/m339/m354/m357 lose their askAgain lines (the
  words are gone); DOM-57 parts 3, 5, 6 (asked once; what lands, pinned: the plan marked cut short, the plan as the page,
  the labelled plan as thinking with the rest as the page); DOM-65 part 1 (asked once; what came is kept and on the
  thread for him to judge); DOM-80 rewritten (asked ONCE, nothing said, what came kept — and his own retry then asks
  again and brings the new version).
- GATES ON THE PUSHED TREE: harness 744/744, walk 99/99 (alone), longplay 8/8, lint clean.
- version.js -> m377-001.

# M378 — a new try clears a stopped thinking at once; the name swap is deleted
1. "When I tap retry after I stop the thinking in the middle, the old thinking is still there until the output is done."
   A Stop mid-thinking keeps the cut thinking on the page, whole and copyable (M301); it was let go only when the NEXT
   PAGE landed (clearCutThinking at the two landing points), so Try again showed the old stopped thinking and the new one
   streaming side by side until the new page was finished. Now the moment ANY new try begins — Try again, a new message,
   a new version — the stopped thinking is cleared, before the new one is drawn.
2. "Why, when I delete 'What your rules call you', does the persona actually become the persona?" Because M362's swap was
   the wrong design: it rewrote the name his persona is BUILT around, inside his own rules — a persona written about "LO"
   and then read about another name is a persona about someone else. With the box empty his rules went out as written and
   the persona was itself again. DELETED: the box, its setting (rulesName), its keeping and reset, voice.js withHisName
   (and its call in inVoice and the preset reading), voiceOf's field; M362-1 and DOM-77 go with it. His rules are never
   renamed; the one name the house uses for him is Your name, and it should say what his rules say.
- TESTS: DOM-81 in the app — a thinking stopped mid-way is kept on the page; Try again begins a new try and the stopped
  thinking is ALREADY gone (not waiting for the page); the new page lands and it never comes back.
- GATES ON THE PUSHED TREE: harness 743/743, walk 99/99 (alone), longplay 8/8, lint clean.
- version.js -> m378-001.

# M379 — his message is the last thing the storyteller reads; any name without rewriting his rules
1. THE NAME (his words: "I use Bruce, not LO — that's why I asked why, without Bruce there, the persona is better. I want
   any name. Do you do something besides changing the words?"). M378 deleted the box without answering; the answer: M362
   only changed words, and that is exactly why the persona got worse. His rules were written AROUND "LO" — the name is
   part of what the model recognises the persona by — and nothing else was renamed (his earlier pages, the record, the
   teller's own past lines still said "LO"), so the teller read two names for one man. NOW (voice.js nameBridge): the box
   is back, and his rules are NEVER rewritten; one line after the frame's opening says "“LO”, wherever these words say
   it, is Bruce — one man. Bruce is the name he goes by; call him Bruce." Nothing when a box is empty or the two agree.
2. THE SHORTCUT DOUBLING (his words: "the shortcut is basically doubling my user message — delete it, integrate it into my
   main instructions. That's why it thinks it's an assistant system."). A shortcut's law rode as a SECOND user message
   after his ("#p", then "#p — exactly ONE beat…"). Now every shortcut's meaning is said once in the standing words
   (commands.js shortcutsText, appended to the craft's block — positional seats unchanged) and his message travels AS HE
   TYPED IT (messages keep `typed`; stack.js wireable sends it; a hidden shortcut like #continue still travels). The #q law
   no longer says "You are the director…" (a second identity, M333's law).
   THE SAME SHAPE, FOUND WHILE ANSWERING HIS 4TH QUESTION: with no note of his own, the house's STARTER note ("Before you
   write: reread the last few exchanges…") rode EVERY turn as a second user message after his. It is in the standing
   words now; a note he writes himself still stands at the end, where he put it.
3. THE CONTINUE NUDGE: "Go on." — when he sends nothing or taps Continue. It rode as a second message; it now stands in HIS
   place as the one user message of that turn, and only when nothing of his travels.
4. THE NOTE AT THE END / "AFTER THIS TURN": the closing words were one more user-role message after his — the last thing
   the model read. By default nothing follows his message now. What may, only when it fires: a note HE wrote, the
   referee's settled outcome, and switches he turns on. "After this turn" on the receipt was never sent to the storyteller:
   it lists what the readers wrote into the ledger AFTER the page.
- TESTS: m379.mjs M379-1 (seven shortcuts travel as typed with nothing after; a hidden #continue travels; every shortcut
  explained in the standing words to his name; no second identity), M379-2 (no note of his: his words close the request,
  the starter in the standing words; his own note still at the end), M379-3 ("Go on." once, in his place; none when he
  said something), M379-4 (his rules word for word, one bridging line right after the opening, nothing when a box is empty
  or they agree, said once). DOM-82 in the app: both name boxes set in Settings, "#p" sent — the storyteller's last
  message is "#p", its law not sent, its meaning in the standing words, "LO" kept and bridged.
- MOVED WITH THE LAW: stack.mjs M9 (a command's law never a second message) and A1 (the room sized from the house's own
  words, which grew by the shortcuts — the honest cutoff line is the law); m259 M259-46 (no command part); m334 M334-1
  (the shortcuts' own quoted example counted, untouched); m354 M354-1 (the OFF turn ends on his words).
- version.js -> m379-001.

# M380 — the name boxes only change words; what follows his message is a system message
He was right, and M379 misread him again. His question was: do the name boxes ("Who is telling", "Your name") do anything
MORE than change words? — because changing words is GOOD, and anything more is an injection. M379 answered by adding one
("“LO”, wherever these words say it, is Bruce — one man…"), and recommended "What your rules call you: LO" without ever
reading his system instructions, which (by "What the storyteller saw") hold no "LO" at all.
- THE NAME BOXES ONLY CHANGE WORDS. Where the house's own text says "the writer" or "the storyteller", or a rule says
  {{user}}/{{char}}, his names go in. Nothing is added for a name. The bridge line and the "What your rules call you" box
  are deleted (voice.js nameBridge, the setting, its keeping and reset, M379-4 and DOM-82's name checks). "Your name: Bruce"
  alone is the whole of it.
- WHAT FOLLOWS HIS MESSAGE IS A SYSTEM MESSAGE (his request: "you should create a setting whether it's a user message or a
  system message… instead of system post-history instructions like SillyTavern"). Everything after his own message — his
  note at the end, the referee's settled outcome, any switch's line — rode as a USER message, which reads as him writing a
  second message of instructions. Setting "Sent after your message as" (afterRole, beside the note at the end): a system
  message (the default — SillyTavern's post-history instructions) or a user message. Claude takes no system turn among its
  messages, so a Claude connection always gets it as a user message (anthropic.js). A house that refuses a system message
  after the story (a 400 naming "system") is remembered on the connection (systemAfterRefused) and the SAME turn goes again
  with those words as a user message.
- STILL A USER MESSAGE, said to him plainly: the briefing BEFORE the story ("Tony Stark — Bruce here. This is where things
  stand…") — written as his own notes by design (M327).
- TESTS: m379.mjs M380-1 (names only change words: "the writer" becomes Bruce, not one paragraph added), M380-2 (his message,
  then the note as a system message by default; a user message when chosen; Claude gets no system turn), M380-3 (a house
  that refuses: asked twice, the second with the words as user, remembered). MOVED WITH THE LAW: referee.mjs M11, m345
  M345-9, m339 M339-2 (the closing is a system message by default).
- longplay.mjs moved with M379: its scripted teller reads the TYPED shortcut as the last message (and the law in the
  standing words) instead of the law in a trailing message; LONG-5 now asserts no law is ever sent as a message.
- GATES ON THE PUSHED TREE (M379 + M380 together): harness 749/749, walk 100/100, longplay 8/8, lint clean.
- version.js -> m380-001.

# M381 — the session's final audit
He closed the session ("audit everything from this session, make sure it's perfect"), and asked that every update be
written down so no later session breaks his storyteller's persona.
- RECORDED: every milestone of the session, M354-M380, has its entry here (checked one by one). HANDOFF.md now OPENS with
  "READ THIS FIRST — HIS STORYTELLER'S PERSONA IS THE THING THAT BREAKS": the eight rules the session paid for, and the
  check to run before any push that touches what is sent (read every message's role and words as the provider gets them).
- ONE BUG FOUND AND FIXED: M379 sent "Go on." in place of anything that looked like a request to continue — so when he
  TYPED "continue" or "keep going!", his own words were rewritten into the house's. Now anything he typed travels as typed;
  only an empty send or the hidden Continue button's message has "Go on." stand in its place (stack.js). m379.mjs M379-3
  holds it ("continue", "keep going!", "Go on" each travel as typed; an empty send is "Go on.").
- AUDITED, NO CHANGE NEEDED: a swipe of an out-of-character turn keeps it out of character (turnArgsBefore reads the stored
  ooc flag, not only the words); the late-system retry runs only on a refused answer (the accepted path breaks first); the
  Raw view is the provider's own request body (checked equal to what fetch received); the starter note is gone entirely
  once he empties "The note at the end" and keeps it.
- GATES ON THE PUSHED TREE: harness 749/749, walk 100/100, longplay 8/8, relay.py 11/11, lint clean.
- version.js -> m381-001.

# M382 — "#story" reached the storyteller as the house's own sentence
His screenshot: two "YOU: A new tale — you choose it." and no page. He had typed "#story".
- ROOT CAUSE, MINE: M379 moved every shortcut's meaning into the standing words and sent his message "as he typed it"
  from a new `typed` field — but db.messages.append (store.js) builds each row from a WHITELIST of fields, and `typed`
  was not on it. It was dropped on every save. So every shortcut whose page text differs from what he typed went out
  wrong: a bare "#story" was sent as M359's placeholder "A new tale — you choose it." (a sentence the house wrote, posing
  as him, with the command gone), "#story <concept>" as the bare concept, "#question …" as the bare question (no longer
  known to be out of character), a bare "#time" as an empty page (sent as "Go on."), and "#continue" as "Go on.". M379's
  laws built the messages by hand and never went through the store; DOM-82 used "#p", whose page text IS what he typed.
- FIXED AT THE ROOT: store.js keeps `typed`. The page never shows a house sentence in his place: a bare "#story" is kept
  as "#story" (commands.js; the placeholder is gone), a bare "#time" as "#time"; a concept or a question stays his page
  text (M85's law — his own words, not the command) while `typed` carries the command to the storyteller.
- THE DAMAGE REPAIRED WHERE IT WAS SAVED: pages saved from m379 to m381 as exactly "A new tale — you choose it." are put
  back to "#story" once, at boot (ui/placeholder.js; exact text only; storyteller pages never touched). Other command
  pages saved in that window (a bare question, an empty #time) cannot be told apart from ordinary words and are left.
- TESTS THROUGH THE REAL PATH: m382.mjs M382-1 (the store keeps `typed`; the wire sends it), M382-2 (the saved
  placeholder put back once, exactly). DOM-83 in the app: "#story", "#story <concept>", "#question …", "#time", "#p",
  "#continue" typed into the composer — the storyteller is sent EXACTLY what he typed each time, the thread keeps his own
  words, and no house sentence anywhere. HANDOFF's rule 8 now says it: test what is sent through the real app.
- GATES ON THE PUSHED TREE: harness 751/751, walk 101/101, longplay 8/8, lint clean.
- version.js -> m382-001.

# M383 — his one message was drawn twice
The second half of his screenshot: two "YOU" boxes for one "#story". Reproduced in the walk: while the storyteller writes
after a #story, the store holds ONE message of his and the thread shows TWO. A #story opens a new tale, and opening it
draws that tale — which, once his words are saved, already shows them — and send() then drew them a second time. A
landed page redraws the thread and the copy vanished; his page never came (M382's bug), so both stayed. Never sent
twice: one message, one ask. send() now draws his message only if it is not already on the thread (by its id); the
only other place a message is drawn is the thread's own render, which clears and redraws from the store.
- ALSO ANSWERED: the line under the composer when a shortcut is typed ("a new tale of your choosing — the first scene,
  written now") is only ever put on the screen (els.composerChip.textContent) — never sent to the storyteller.
- TESTS: DOM-84 — a #story held mid-write: one message in the store, ONE box on the thread showing "#story", and one after
  the page lands.
- GATES ON THE PUSHED TREE: harness 751/751, walk 102/102, longplay 8/8, lint clean.
- version.js -> m383-001.

# M384 — his repeated instructions and his note always close what follows his message
He asked where the referee and the rest sit against his repeated main instructions and his note at the end — "those two
should always be at the end". They were not: the closing words ran referee's outcome, the repeated main instructions,
then the switches' lines (the scene anchor, the plain lines, the sensors' word, the think-on-page line), then his note —
so a switch's line could stand between his instructions and his note. Now (stack.js closing): the referee's outcome and
every switch's line first, then his main instructions repeated (when "Say it again at the end" is on), then his note at
the end, always last. (M21 always described the repeat as "just before the note at the end".)
- TESTS: m379.mjs M384-1 (with a ruling, the sensors' word, the repeat and a note: the note last, the repeat right before
  it, the ruling and the sensors' word ahead of both, all one system message).
- GATES ON THE PUSHED TREE: harness 752/752, walk 102/102, longplay 8/8, lint clean.
- version.js -> m384-001.

# M385 — Claude does take a system message after the story (M380 was out of date)
He checked M380's claim ("Claude takes no system message there, so a Claude connection always gets it as a user message")
and said newer Claude models take one — he had used it in SillyTavern months ago. He was right; the claim came from memory
and was not checked. Anthropic's docs (platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages):
a `role: "system"` message inside `messages` — a mid-conversation system message — is accepted on Claude Fable 5.1,
Mythos 5.1, Fable 5, Mythos 5, Opus 4.8 and Opus 5, on the Claude API, Amazon Bedrock and Google Cloud, no beta header; it
must immediately follow a user turn and either end the array or precede an assistant turn (what follows his message
does both); it is NOT available on Claude Sonnet 5.
- anthropic.js no longer turns it into a user message: it is sent as a system message. A model that refuses it (a 400
  naming "system") is remembered for THAT model at that address, a note says so, and the same turn goes again with those
  words as a user message. Change the model and it is tried afresh.
- ONE MEMORY FOR BOTH PROVIDERS (providers/latesystem.js lateSystemRefused/rememberLateSystemRefused): openai.js's M380
  mark was one flag for the whole connection; it is now per model and address too (the old flag is still read).
- The setting's words in Settings now say which Claude models take it.
- TESTS: m379.mjs M380-2 rewritten — Claude Opus 5 is sent a system message; Claude Sonnet 5 refuses, is asked again with
  a user message, remembered for that model; the same connection on Opus 5 is tried afresh. M380-3 checks the per-model mark.
- GATES ON THE PUSHED TREE: harness 752/752, walk 102/102, longplay 8/8, lint clean.
- version.js -> m385-001.

# M386 — canon verification, whole: Who's here is its cast, its words are his, the series' faces live in the ledger
He asked how canon verification works, whether it was all ported, where it is injected ("as a user message, right?"), and
why it was "literally just one box": M346 had vendored the engine and shown one switch and one text box, never its
panel, never the ledger. He asked for all of it, smart and autonomous, using what the ledger already knows (Who's here,
the physical descriptions), a new ledger section for what canon says (relationships, history), and nothing that breaks
his persona. Answers: it runs as his extension on the SillyTavern stand-in (bridge.js/host.js); YES, a user message — the
first thing in his briefing, after the frame (systemBlocks) and before every page, where ST's depth 9999 puts it.
- CANON GROUNDING v0.64.0 (the extension, pushed first, three roots, 8 guards negative-tested; proof 593, sim 406):
  · a HOST'S LEDGER THAT KNOWS WHO IS IN THE ROOM is heard: entries marked `present: true` ride (tier 2, grounded as
    trusted, in the pair pool) with no name in the window — ONE door (ledgerOnScreen) replaced six name-only filters;
  · A SECTION THAT OPENS STRAIGHT INTO ITS SUBSECTIONS was invisible ("== Relationships ==" then "=== Issei ==="): the
    readers demanded a text line under a heading; one reader (sectionAt) now reads a section with its subtree, in all
    four places — the page's own pair dynamics, eras of History, arcs whose Summary opens into parts;
  · NO WIKI, NO VERDICT: `[].every(...)` is true, so with no wiki set a lookup that searched nothing recorded a miss that
    "covered" the empty list and the ⌀ notice told the storyteller "not in canon"; now nothing is recorded or claimed;
  · a host may frame the note (getContext().canonHeaderDefault); the panel's buttons are ONE function each, shared with
    a host surface (globalThis.CanonGrounding_api) — preview, scan, clear, forget, look it up again, the story position,
    the chat's pins, the self-test, both resets, the wiki binding — and the name resolver itself (cacheEntryIn, the pure
    form of cacheEntryFor), so Cozy reads a pinned "Rukia" as Rukia Kuchiki exactly as the note does.
  Pushed as c54dfd5 (feat → test → chore(release)); re-gated on a fresh clone: syntax OK, proof 596/596, sim 406/406;
  vendored from that clone at c54dfd5 (the vendored body differs from it only in the three asserted places).
- WHO'S HERE IS THE CAST (bridge.js ledgerOf): everyone state.present has is marked present under the name their page
  stands under (M320) — the two Kuchikis ride with only "she" and "he" on the page, and their "With …" lines come from
  the wiki page itself.
- HIS WORDS (CANON_HEADER): "What canon says about the people here — sharper than anyone's memory, so where it differs
  from what you recall (a face, a tie, something in their past), this is right. Nobody in the story knows more of it than
  they've lived, and a hidden identity stays hidden. It's how someone tends to be, never a script: …" — no wiki, no
  note, no storyteller, no "portrayal error". Editable in Settings ("The words before what canon says"); empty = these.
- THE SERIES' FACES IN "WHAT'S TRUE OF THEM" (canonLocks → canonSyncLedger, a chain job before the checkpoint): hair,
  eyes, height, build, skin, distinguishing features, for everyone in the ledger who is a canon character. The law, in
  the engine (apply.js canon.lock/unlock `source: 'canon'`): the series writes only where nothing of the brief's, the
  writer's or a reader's stands; corrects or withdraws only its own; a truth he (or the auditor, or the housekeeper) lets
  go is marked in state.canonLetGo — journaled with the unlock, so a branch from before it has the truth back, and taking
  the unlock back takes the mark back; taking back the series' own lock is a letting-go too. Withdrawn when he blocks the
  name, forgets the page, or the brief speaks to that feature. WHO IS WHO (canonEntryFor): the series' full name, else a
  shorter name only when nobody else in the ledger could be meant — his Rias Wells is never Rias Gremory, and a bare
  "Rias" beside Rias Wells is nobody's; "Rias Wells has black hair" in the brief says nothing of Rias Gremory's hair.
- OFF SENDS NOTHING OF IT (M346's law, kept whole): switched off, the series' truths are withdrawn from the open story at
  once (Settings) and from any story on its next page (the send path, journaled; an out-of-character turn, which may not
  write, leaves them out of its copy — withoutCanonTruths). Switched on again, the next page writes them back.
- THE LEDGER ROOM "WHAT CANON SAYS" (drawer.js canonSaysPanel, in The people): this story's wiki (named = a decree that
  lets another universe go; empty = it finds it itself, now; the wikis it has used offered as he types), Ask canon,
  where our story is (set / ×), where the scene is (×), his standing notes for this story, a card for everyone looked up
  (the people in the scene first, then the newest): who they are, how they look, who they are to the people here, their
  story, family and ties, what they can do, how they talk, what is kept hidden in the story, what surrounds them — with
  Always here / Never (one list each: moving into one leaves the other, by every name they answer to) / Look it up
  again / Forget; what it asked about and did not find (Look again); why each rode with the last page (or would ride
  now); Look at the scene now; What it would send now; Forget everything it knows here. "What's true of them" marks the
  series' truths ("· as the series has it").
- SETTINGS (js/ui/canonsettings.js, drawn only with the switch on — off, the extension is never loaded): every lever of
  its panel, named as it names them — how it finds the people (the parser, every page, the story's own ledger, lowercase
  names, Cast Auditor, the people the storyteller brings in, find each story's wiki by itself, tell me what it is doing,
  🔬 Parser self-test through the story's canon worker); what it says of them (the seven kinds, LLM-curated dossiers,
  Prose briefs, Smart dynamic order, Per-pair dynamics, Smarter AI, Say what is NOT in canon, where our story is rides,
  it follows the story by itself, ✒ Advanced); how much and how long; where it looks (the first-look wiki, the wikis it
  has used); his notes for every story; the seven instruction texts (↺ as it came); what it reads on a wiki page; put
  everything back. One copy of each setting: the extension's own object, live — a change is in force on the next page.
  The extension's own "enabled" stays on: one switch, Cozy's. Its shipped example wiki (the author's
  "the-eminence-in-shadow") is cleared once — every story here finds its own.
- A BRANCH KEEPS ITS CANON (carryCanonMemory in branchFrom): what was looked up, the story's wiki, his pins, blocks and
  notes, a story position he set; what the tracker derived from later pages (an advanced position, the current setting)
  only from the newest page.
- THE REAL RECORD REACHES THE WORKERS TOLD TO USE IT (rule 11): the scribe ("written from the REAL RECORD"), the world
  agent and the auditor were never handed it; with canon on, canonRecordFor gives them what the series says of the canon
  people in the ledger (who they are, family and ties, the facts). Without it their requests are byte-identical.
- canon verification's runs are noted in The workers ("canon verification", WORKER_NAMES); the light's minders unchanged.
- FOUND WHILE BUILDING IT, FIXED: (1) the walk caught the series' truths riding with canon switched OFF ("Violet" sent) —
  the off-law above; (2) re-reading the room: a lever's error was erased by the redraw it caused, and a failure could be
  answered with a wrong "not found" (errors now kept, callers say nothing over a failure); groups counted as "places"
  (the extension has two kinds — now "places and things"); "Why each rode" vanished after a preview (now "Why each
  would ride now"); Settings promised the used wikis in each room and did not offer them (a datalist now); (3) the new
  test caught "Not always here" leaving Rukia always here when the list held her as "Rukia" — the room and the levers now
  resolve every decree with the extension's own resolver (canonPinnedKeys, entryIn), and so does "Never" for the ledger.
- AN OLD TEST THAT PINNED TEXT (m100 M237): it matched lockFact's exact arguments `{ key, value }`; the lock now also
  carries its source — still BY KEY (M386-1 corrects the series' own hair in place and counts one hair). Loosened to the
  property, nothing else.
- TESTS: harness m386.mjs (9: the engine's let-go law through the journal, the undo and a load; who is who; the ledger
  sync; the live path with nameless pages, pairs, his words, the message order; every lever; branch carry; the workers'
  record, byte-identical without it; live settings; off withdraws). Walk DOM-85 (the whole thing through the real UI:
  Settings' levers, the room's wiki box, nameless pages, the scribe/world on the wire, the series' faces, a let-go hair,
  Never, a branch, off). DOM-69 moved to his words and the levers drawn with the switch.
- NEGATIVE-TESTED (each guard broken alone, its own test fails): 13, on m386.mjs: the series writing over his truth, no let-go mark on an unlock, the let-go ignored by a lock, no mark when a series lock is taken back (M386-1); no present marks, no opening words of his (M386-4); no rival rule, the brief check on any word of a name (M386-2); no withdrawal (M386-3); a branch from an older page carrying the tracker's position (M386-6); no record for the workers (M386-7); the off-copy keeping the series' truths (M386-9); "Not always here" by one name only (M386-5). Not negative-tested: copyState's own copy of canonLetGo (no handler edits the list in place, so no test can see it go).
- GATES: harness 761/761 (752 + the nine of m386), walk 103/103 (DOM-85 new, DOM-69 moved), longplay 8/8, lint 0 errors (148 warnings: the one added is carryCanonMemory leaving out the lent ledger by destructuring, the idiom saveMeta already used) — on the working tree; again on a fresh clone of the pushed tree below.
- version.js -> m386-001.

# M387 — one home for a fact: canon and the ledger stop saying the same thing
He asked whether canon was really fitted to the ledger Cozy already has — each book in symbiosis, no redundancy, no
context bloat: canon puts the face in the ledger and stops, or an agent reads canon's desk and decides what goes in the
ledger. MEASURED FIRST (a three-person scene, Rukia and Byakuya Kuchiki, canon on, m386): the storyteller read Rukia's
violet eyes THREE times a page (the note's Appearance, the ledger's truths, her page's core), her height and Byakuya's
twice, "Gotei 13", "6th Division" and "aloof" twice (note + page core), and inside the note the "With Byakuya" line and
the "Relationships" line were the same sentence (v0.64.0's subtree reader made the Relationships section equal to the
pair's subsection). Note 397 tokens, briefing 601.
- THE DIVISION, ONE HOME PER KIND OF FACT, IN CODE (no extra model call):
  · a FACE lives in "What's true of them" — canon writes it there (M386) and the note then leaves it there: bridge.js
    ledgerOf marks `holds: ["appearance"]` for everyone here whose face the shelf shows this turn (and only when the
    shelf shows all of it, FACTS_SHOWN); Canon Grounding v0.65.0 gives them no Appearance line. The first page a canon
    person appears, the ledger has no face yet and the note says it; from the next page, the ledger does. Never twice,
    never zero.
  · the rest of the look (the Appearance prose) lives with the face (a `look` truth, source canon) — only where neither
    his brief nor his hand has spoken to any of that face; a feature the look already states in its own words ("violet
    eyes") is not a second line of its own (the extension's own appearanceLine rule, applied where the face now lives).
  · WHO THEY ARE in canon (identity, nature, powers, voice, canon ties, secrets, surroundings, pairs) lives in the note.
  · WHAT THIS STORY MADE OF THEM lives on their page: the scribe (canon on) is handed the record and told to keep every
    page true to it but never repeat it — the page holds where they are, what they did and learned here, how they
    stand, and names the record only where the story departs from it. (His idea of an agent reading canon's desk and
    deciding what the ledger keeps: that agent is the scribe, and this is its division.) Pages already written with the
    record in them keep it: no worker rewrites a page to take it out (a hand-written core is his, and a rewrite would
    take the hand mark with it).
  · Canon Grounding v0.65.0: a Relationships line never repeats a pair line (the fallback builds the pairs first).
- HIS TRUTHS FIRST ON THE SHELF (canon.js renderCanon): the render shows six; his, the brief's and a reader's come before
  the series', so a truth he writes after the series filled a shelf is never the one cut. "eyes.." never again (a value
  ending in a stop gets none added).
- "HOW THEY LOOK" OFF in canon's settings: the series writes no face into the ledger and takes back what it wrote.
- MEASURED AFTER (page two, same scene): note 268 tokens (−32%), briefing 491 (−18%); every face word read ONCE —
  violet, 144 cm, grey, 180 cm, kenseikan — and "Gotei 13", "6th Division", "aloof" once where the pages are written the
  new way (twice only where an old page still repeats the record).
- TESTS: m386.mjs M386-10 (the whole division on the real extension: page one says the face, the sync moves it, page two
  leaves it — every face word counted once across the request; his truth first; his brief's face keeps the canon look
  out; "How they look" off takes the faces back; the scribe's division). DOM-85: page two has no Appearance line, her
  look is in her truths, and "violet" is read once in the request. The extension's sim [63] (and the fixed scenario: the
  sim's keyword list never matched a Relationships section, so its first draft proved nothing — caught by breaking the
  guard, fixed, broken again, caught).
- NEGATIVE-TESTED (each guard broken alone, its own test fails, M386-10): no holds mark; no look fold; the series'
  truths rendered first; "How they look" off ignored; a canon look beside his hand-written face (its test was added
  after this very mutation first passed unseen — the brief case has a second check of its own, the hand case had none);
  the scribe told to write from the record again. Extension: the face left to the host; the Relationships repeat.
- GATES: harness 762/762, walk 103/103, longplay 8/8, lint 0 errors (148 warnings, as before M387) — on the working tree
  and again on a fresh clone of the pushed tree. Canon Grounding v0.65.0 on its fresh clone: proof 596, sim 413.
- version.js -> m387-001.

# M388 — the old pages stop repeating canon, on their own
He asked what "character pages written before this fix still repeat canon; I left them alone on purpose, because
rewriting them could overwrite pages you wrote by hand" meant. It meant: a person's page in "The people" (their core,
"who they are") written by the scribe before M387 still says what the series says — "Rukia Kuchiki, a Shinigami of the
Gotei 13 and Byakuya's adopted sister; petite, black hair, violet eyes; stern and proud" — beside the canon section and
her truths, read twice or three times every page she is in. And the reason given was wrong: the house can tell his words
from a reader's, field by field (M263's hand mark — the tidy of M291 already never rewrites a field his hand wrote). The
work had simply not been done. Detection without repair is handing him a task, so:
- agents/canontidy.js, a chain job (the scribe's connection) before the canon sync and the checkpoint, only with canon
  verification on: canonRepeats finds a page whose core no hand wrote and whose words are the record's (at least four,
  two in five, the person's own names not counted); the worker is shown the record and the core and writes the core
  again without the record; cleanCoreHolds refuses, IN CODE, an answer that ADDS a word the page never had or LOSES a
  word the record does not say (the story's own), or takes nothing out; applied as people.set (journaled — What changed
  and why takes it back), judged against the page as it stands after the read (a page rewritten meanwhile is not
  touched). Each core is asked about ONCE: a memo by the core's own words in the story's canon memory (cozy_canon_tidied;
  a refused answer is remembered too, so nothing loops; a core written afresh is looked at afresh).
- canonSaveMeta (bridge.js) keeps the live canon memory after a worker writes into it.
- TESTS: m388.mjs (3: which pages — found, not a story core, never his hand, never a non-canon person, never asked twice;
  the answer's law — added / lost / unchanged refused; the whole cleanup on a scripted worker — cleaned through the
  ledger, undoable, his page never sent, asked once, a refused answer leaves the page, a page rewritten meanwhile left).
  Walk DOM-86: the chain does it on its own after a page — her page cleaned, his hand-written Byakuya untouched and never
  sent, journaled, and the next page asks nothing.
- NEGATIVE-TESTED (each broken alone, its own test fails): additions allowed; story words lost allowed; the hand mark
  ignored; the memo ignored; the page-rewritten-meanwhile check ignored.
- FOUND BY THE FULL HARNESS ON THE FIRST PUSH (6a36bff): M15's ghost-call audit reads a call to save*/load*/render*
  with no definition in the file as a ghost — canontidy's callback PARAMETER `saveMeta` was one. Renamed `keepMemo`
  (the audit is right to be simple; a parameter named like a module function is exactly how a real ghost hides).
  The first push was made before the full harness had run on the tree — run it BEFORE pushing, not only after.
- GATES (fresh clone of the pushed tree): see the final push. version.js -> m388-001.

# M389 — the audit of canon verification, end to end
He asked for everything audited — foolproof, no bugs, a clear pipeline — and then a plain guide to using it. The pipeline
was walked stage by stage against the code, each stage's failure modes brainstormed, and every doubt either proven fine
by reading the path or fixed with a test that fails when the fix is taken out.
THE PIPELINE (what runs, in order):
  switch on (Settings → The readers) → canonReady (load once; first run: the model reads the scene; the author's example
  wiki cleared; the extension's own "enabled" kept on) → per page, BEFORE: enterStory (the story as ST's chat, the brief
  as its card, the ledger lent with present/holds marks, his opening words, the canon worker's connection) → the
  interceptor (discover the wiki / parse the scene / look up / dossier / pairs, inside its time windows) → the note →
  the top of his briefing (a user message after the frame; "What canon says" on the receipt) → AFTER the page, in the
  chain: the old-page cleanup (M388) → the faces into What's true of them (M386/M387) → the checkpoint → the people the
  page brought in are looked up (for the next page). Beside it: the scribe, the world agent and the auditor handed the
  record; OFF withdraws the series' truths and sends nothing; a branch carries the canon memory; the room and Settings
  pull its levers through the extension's own host surface.
FOUND AND FIXED:
- STORY_PREFIXES (store.js, M160's list of a tale's rows) never learned `canonMeta` (M346) or `sensors` (M356): a
  gone tale's canon memory and readings rode _house.json on every push, forever, and the boot sweep never took them.
- a face his BRIEF describes: canon's Appearance rode on the first page (before the founder locks his version) and
  argued with the brief — "silver hair" in the frame, "black hair" in the note. ledgerOf now marks such a face held
  from the first page; and his opening words now say "where our story has made something otherwise, our story wins".
- two copies of the wiki-name reader (the room's box, Settings' box), and neither dropped a pasted page path — a
  wiki.gg address was stored with "/wiki/Guide" on it. One reader now (wikiName), both boxes.
- Canon Grounding v0.66.0: the story position's guard spoke of "the storyteller's map" inside a note written TO the
  storyteller ("your map" now), and the not-in-canon notice named the machinery ("(no wiki page)", gone).
CHECKED AND SOUND (read on the path, no change): a Continue page carries the note (the hidden "continue" is a system line
to the extension, no re-parse); the note is inside the request's measured room (M287's probe includes it); OOC turns
never call it; a swipe never re-parses; hidden pages are system lines; a rewind, a fold or a branch takes the series'
truths with the page they were written on (journaled); a deleted tale takes its canon memory (by suffix); the tale's
book carries it; the room draws its cards only when opened. A lookup still in flight when he switches stories writes
into the story it began in (the extension holds that story's cache object) — kept on that story's next save.
- TESTS: m389.mjs (3: the tale's rows ride its book, never the house's, swept when orphaned, gone with the tale; one
  wiki-name reader, both boxes, a wiki.gg page path dropped; his brief's face held from page one, a silent brief
  claims nothing, the opening words say whose story wins). Extension sim [64].
- NEGATIVE-TESTED: the prefixes forgotten; the page path kept; the brief's face ignored (Cozy); "the storyteller's map"
  and "(no wiki page)" back (extension).
- version.js -> m389-001; Canon Grounding v0.66.0 vendored @ da10387.

# M390 — the audit, continued: an imported chat keeps its canon; every kind of canon control writes through
"Continue" after M389's audit: the fresh-clone walk's summary read (104/104) and the long play run there (8/8), then the
brainstorm carried on past the pipeline into the doors around it.
- FOUND: importing a SillyTavern chat (Settings → bring your old chats) threw away its chat metadata — and Canon
  Grounding keeps ALL of its memory there (canon_grounding_*: everyone it looked up, the wiki it was bound to, his pins,
  blocks, notes, the story position) in exactly the shape Cozy's canonMeta has. A chat he played with the extension came
  home as a stranger: every name looked up again, the wiki found again, every decree gone. parseSTChat keeps those keys
  (and only those — never another extension's ledger); importAsStory writes them as the story's canon memory inside the
  same all-or-nothing import.
- PROVEN UNTESTED DOORS, NOW TESTED: the room's "Forget everything it knows here" takes the series' faces out of the
  ledger with it (his own truths stay) and "where the scene is" forgets (m390 M390-2); every KIND of Settings control
  writes through the extension's own settings at once and draws back as kept — a switch, a number held at its ceiling
  (999 → 30) and kept in milliseconds where it is seconds, his own opening words and "↺ as it came" (walk DOM-87).
- TESTS: m390.mjs (2), DOM-87. NEGATIVE-TESTED: the importer's canon keys dropped → M390-1 fails.
- version.js -> m390-001.

# M391 — what he types is what happens: a shortcut opens nothing
He typed "#story start the opening scene" in his Bleach story and Cozy opened a NEW TALE. He had been told (M379) that
every shortcut's meaning is in his main instructions and his words go as typed; that was true of what the storyteller
was SENT, but the frontend still acted on the words: #story opened a tale named from the concept and showed him the
concept without "#story"; #question showed his question without "#question"; #continue was stored as a hidden page. His
law: verbatim, no gamey system, nothing in the house doing things with his words behind the storyteller's back.
- commands.js: every shortcut's page is exactly what he typed (clean = the typed text); #continue is his page, shown;
  #story opens nothing (no `name`, no new-tale reading); the chip for #story says it begins "right here".
- chat.js send(): the #story new-tale branch is gone. His words go to the tale he is in. Only with no tale open at all is
  one begun (as for any first words), named from them with a leading shortcut word left off the SHELF NAME only.
- What a shortcut still does in the house, all of it on his side of the glass: the composer chip names it; an
  out-of-character turn (#question, ((…)), a // line) is not read into the ledger (fewer house words, not more); the
  referee's own #roll / #skip still reach the referee. The per-command directive has not travelled since M379
  (stack.js `void directive`) — DOM-84 now checks no house instruction rides beside his #story.
- Old pages keep what they were stored as (a #story page from before shows its concept); their `typed` field is what the
  storyteller was and is sent.
- TESTS: m85/m359/engine updated — they encoded the removed behavior (the concept as the page, a name to open under, a
  hidden #continue): the old expectation was the thing he rejected. DOM-2: his first page reads "#story Jovan is eating
  …" and the shelf name "Jovan is eating…". DOM-84: "#story" typed in a tale — no new tale, still in his tale, sent as
  typed, no house instruction beside it, one box. DOM-83 (every shortcut through the real app) rewritten to the same
  law: in one tale, #story alone, #story with a concept, #question, #time, #p and #continue — each sent as typed, kept
  and shown as typed, never hidden, and no tale opened by any of them (it had asserted a new tale per #story and the
  concept as the page).
- GATES before the push: harness 770/770, walk 105/105, lint 0 errors.
- version.js -> m391-001.

# M392 — canon through his story: what his story changed, or has not reached, is never said
His Bleach story: MC Oda is the new captain of the 13th Division, Rukia his lieutenant (she had expected the captaincy),
and she has not married Renji. Canon verification sent, every page, the wiki's END-STATE as fact: "She is the current
Captain of the 13th Division … She is married to Renji Abarai and they have a daughter named Ichika Abarai." A
storyteller told she is married cannot let his MC grow close to her; told she is captain, it argues with his premise. He
asked for canon's context kept, never as current fact and never as prophecy, so his MC stays free to change history.
- THE LENS (agents/canonlens.js): each canon person who rides is judged ONCE per premise — the premise being his brief,
  cast notes, his canon notes (the story's and every story's) and where the story stands in canon. Every canon statement
  about who they are (identity, brief sentences, facts, secrets, dynamics, the per-pair lines, the fallback's identity /
  relationship / biography sentences) gets a verdict: holds (rides) / changed (his story says otherwise — never said) /
  later (a rank, a marriage, a child, a death this story has not reached — never said, never destined). A statement
  that only partly holds is kept in part — its OWN words only, checked in code (keepHolds: no word it did not have);
  a statement with no verdict holds (nothing is lost to a skipped answer).
- WHERE IT IS APPLIED: to the storyteller — Canon Grounding v0.67's host lens (getContext().canonLens → overlayFor),
  and bridge.js canonBeforeSend lenses whoever rode without a lens made for this premise, then REBUILDS the same turn's
  note through it (api.rebuild); a lens not back within 15 s lands for the next page. To the workers — canonRecordFor
  reads the record through the lens (the scribe and the world agent never write the marriage into the ledger). In the
  room — each card shows canon as it rides, and "Not so in this story: … — your story changed it / not reached here".
- The lens is for the canon words it was made from (a fingerprint): a page looked up again is judged again; a changed
  premise is judged again. Canon's own memory stays canon (the extension's cache); the lens lives in the story's canon
  memory (cozy_lens) — carried by a branch, dropped with the tale.
- CANON GROUNDING v0.67.0/0.67.1 (pushed, 7f45c24; fresh clone proof 598, sim 423): the host lens + rebuild; a story
  position is "canon's course, never this story's script" (it said "let them unfold naturally" — a push toward canon in
  a story free to leave it); and the intermittent [64] failure traced to its ROOT — the sweep looks up the fragments of
  an asked-about name, and when they landed first the not-in-canon notice named three unknowns for one ("Crimson Pact",
  "Ulveth", "Crimson Pact of Ulveth"). v0.67.0 had misread it as a slow machine's race window and patched the test;
  v0.67.1 fixed the notice (a whole-word fragment of a longer asked-about name is not listed) and put the test back.
- FOUND BY THE TEST ITSELF: M392-2's fake provider did not stream, and the worker call streams — the lens "ran" (the
  house counted it) and stored nothing. The fake now streams like a real provider; the lens was right all along.
- TESTS: m392.mjs (3: the lens's own law on his exact Rukia facts; his story live through the real extension — none of
  the captaincy, marriage or daughter reaches the storyteller, her sword and her friend do, the lens is made once and
  again when his premise changes, the workers' record says the same; a lens only for the canon words it was made from).
  Walk DOM-88: his premise through the real app — the storyteller's briefing carries none of canon's end-state, her
  card says "married to Renji Abarai … your story changed it".
- NEGATIVE-TESTED: no rebuild; a kept part adding words; a lens applied to other canon words; the workers' record
  unlensed; the premise ignored (Cozy); the lens not applied; rebuild not handed to the host; the arc's old words; the
  notice's fragments (extension).
- version.js -> m392-001.
- FRESH CLONE OF THE PUSH (1186cc8): harness 773/773, walk 106/106, long play 8/8, lint 0 errors.
- m392-002 — THE WORKERS ARE HANDED ONLY WHAT WAS READ THROUGH HIS STORY. The lens runs for the people who RIDE; the
  record (canonRecordFor) goes to the scribe, the world agent and the auditor for everyone in the ledger — so a person
  in the ledger who had not ridden since (Renji, say, off-page) reached the scribe unlensed, with the scribe told "keep
  every page true to the record": canon's end-state (his marriage) could be written into the ledger from there. With a
  premise to hold it to (bridge.js canonPremise), a person not yet read through it is not handed to the workers at all;
  they are read the page they first ride. No premise: canon as it is. Tested (M392-3, negative-tested); DOM-85's house
  now answers the lens ("holds" for all), so its scribe still gets Rukia's record — proving the wiring end to end.

# M393 — the lens always reads: nothing written is still his story, and silence is not establishment
He asked, of his Bleach story still on its first page, how to restart canon so nothing like "Rukia is married" is in it —
without writing anything that would steer the storyteller himself. His philosophy: autonomous and self-healing.
- THE GAP: the lens (M392) stood down when a story had no premise at all (no brief, no cast notes, no canon notes) — and
  then canon's END rode as fact, unfiltered: exactly what he forbids. Now it always reads: lensPremise gives NO_PREMISE
  when he has written nothing ("the story is only what its own pages show, and nothing of canon's later states is
  established in it"); canonPremise (the workers' record) is never empty, so unread canon never reaches a worker.
- SILENCE IS NOT ESTABLISHMENT, in the lens's own instructions: a rank or title, a marriage, a child, a death or an
  alliance holds only where the story itself establishes it (or plainly sets itself where canon had it); anything else
  the story is silent on holds. His premise needs no line about Renji for the marriage to stay out.
- HIS PAGE ONE, RESTARTED, WITH NOTHING WRITTEN: regenerate it. M21's true rollback takes the ledger back to before that
  page (everything the old page's readers wrote from the unfiltered canon goes with it), the storyteller writes the page
  again from canon read through his story, and the readers write from the filtered record. The canon memory itself
  (what the wiki says) is not to be forgotten — it is canon, and the lens is what keeps it true to his story; forgetting
  it would only make every lookup happen again.
- TESTS: m392.mjs M393-1 (no brief at all: the lens reads, is told silence is not establishment, the captaincy /
  marriage / daughter are not sent, the premise is never empty, unread canon reaches no worker). NEGATIVE-TESTED: the
  lens standing down with no premise → M393-1 fails.
- version.js -> m393-001.

# M394 — the lens never waits for a page; "read again" rebuilds the ledger, never the page
He was furious, twice. First: told to regenerate his first page, he said his page is beautiful — he wanted the LEDGER
rebuilt, not the page. The right control was "read again" under the storyteller's page (M113: the ledger rewinds to
before the page and the readers read the same words fresh; the page is never sent again). Second, his screenshot of
Rukia's card after the update: "She is the current Captain … married to Renji … a daughter named Ichika" still listed,
"Around them: 13th Division — her current captaincy", no "Not so in this story" — and he asked if I even knew what the
buttons do. The root: the lens (M392) only ran when a page was SENT. With no page since the update, nothing had been
read through his story — not the card he looks at, not what "read again" hands the readers. And the lens never judged
powers or the world around them at all.
- THE LENS NEVER WAITS FOR A PAGE (bridge.js canonLensLedger): everyone canon knows in the ledger (who is here, whose
  page it is) with no lens for this premise is read through his story — in the readers' chain, BEFORE the world agent
  and the scribe (chat.js, a 'canon' job), so "read again" and every page hand them only what holds in his story; and
  in the room when it opens (drawer.js, in the background, at most once per five minutes per story when it cannot land;
  the room draws again when the lens lands and an unread card says so).
- IT COVERS POWERS AND THE WORLD AROUND THEM: lensStatements judges dossier.abilities and dossier.related (the entity's
  why — "Her current captaincy and former lieutenant post" keeps "former lieutenant post", the 13th Division itself
  stays hers to serve in); throughLens applies them; Canon Grounding v0.67.2 applies them in the note.
- THE BUTTONS, for the record (he asked): under a storyteller's page — "read again" (the ledger rebuilt from that page,
  the page untouched); under his own message — "try again" (the storyteller writes the page again); the ▸ on the last
  page — another version (the old one kept); in the ledger — "Rebuild the people from the pages" (character pages and
  standings re-read from every page, the old ones kept to put back), "Rebuild the record from the pages" (the record
  refolded), "Found the world from the brief" (the founder again). None of them but "try again" and ▸ writes a page.
- A TEST THAT PROVED NOTHING, FOUND AND FIXED: DOM-85 looked for the scribe by "character scribe" — words its prompt
  never had — and let the world agent's call satisfy the check alone. It now finds the scribe by its own opening words
  and requires it. DOM-89 recognizes the storyteller's request by his briefing (the canon parser's call is a reader's).
- TESTS: m392.mjs M394-1 (the ledger read at once, no page sent, someone off-page included; powers and the world
  around her through the lens; a read ledger asks nothing). Walk DOM-89 ("read again" on his page one: every word of the
  page kept, the storyteller never asked, the lens runs in the chain, the scribe handed her record without the marriage
  or the captaincy, her card's story and held-back lines); DOM-90 (the room opened, nothing else: her card turns to his
  story's and says what was held back). NEGATIVE-TESTED: the chain's lens gone, the room's lens gone, powers unjudged.
- version.js -> m394-001; Canon Grounding v0.67.2 vendored @ fdddee8 (fresh clone: proof 602, sim 424).

# M395 — where the scene is follows his header, and canon never pops up on his screen
He: "why the canon setting keeps popping up on my screen on every screen and the setting is wrong — why the setting
doesn't follow the header", and whether his instruction that anyone can interrupt the MC was still there.
- THE POPUPS: the extension speaks like a SillyTavern panel — a toast when its tracker moves the setting ("📍 setting →
  …"), advances a story position, finds a wiki or a parser fails — and M346 wired those toasts to Cozy's own, so they
  landed on his screen page after page. They are now kept in the bridge (canonNote, the newest thirty) and shown in
  the room "What canon says" under "What it noted lately". Registered once when chat starts; nothing of canon pops up.
- THE SETTING: its tracker chose the scene's place from the parser's list — a place someone merely mentioned could
  become "where we are" (and ride as the current setting every page), while the page's own header said otherwise. The
  ledger knows where the scene is (state.place, read by the extractor from the header): the bridge lends it as
  canonScenePlace, and Canon Grounding v0.68.0's setting follows it — the canon place already looked up under that name
  or one of its parts ("Kuchiki Manor — the tea room"), or NO setting when canon does not know the place (never a wrong
  one); nothing looked up from a header's words, nothing announced; the parser's place is never made the setting.
- HIS INTERRUPT LAW: in the craft he runs ("NPCs Can Interrupt MC = they don't stand still while MC speaks or acts" and
  "Every MC Action Is An Attempt = a present NPC with motive may INTERCEPT it…"), assemble/craft.js, last changed at
  M345 — nothing since touched it. Measured: a request built with the rulebook as it ships carries both lines in its
  system part. A craft he wrote himself in the rulebook is his and was never touched either.
- TESTS: m392.mjs M395-1 (his header's place → the setting, a part of it enough; an unknown place → none; a notice
  kept, not shown). Walk DOM-90 extended (a notice raised → no popup on his screen; the room, opened, keeps it).
  Extension sim [66]. NEGATIVE-TESTED: popups back; the place not lent (Cozy); the host place ignored; the parser's
  place allowed to win (extension).
- version.js -> m395-001; Canon Grounding v0.68.1 vendored @ 803dc53 (fresh clone: proof 602, sim 430; v0.68.1 only moves
  the host-place functions after the PLACE_WORDS they read — Cozy's lint flagged the order). The import of canonNote is
  keepCanonNote in chat.js (the send path has a local canonNote — the note itself). Lint: 148 warnings, none new.

# M396 — the ledger audited: nobody is in two places, and "elsewhere" never contradicts the scene
His Bleach duel: the captains going to watch Jovan fight in the Tenth Division courtyard, Rukia and Suì-Fēng among
them — and "What's happening elsewhere" had Rukia in the 13th Division office, Suì-Fēng in the Onmitsukidō compound,
Rose "in the Tenth Division courtyard, the galleries, watching the yard", Hitsugaya "arriving at the galleries", and
every line "due now" — "taken up with someone else, due now". Some were in "Who's here" too.
THE AUDIT (the ledger's books against each other, root by root):
- FOUR ANSWERS TO "THE SAME PERSON?": the seat guard matched a first or last name, the seat finder near spellings,
  and the storyteller's elsewhere list, the drawer and the world agent's own "who is here" matched EXACT lower case.
  None folded letters ("Suì-Fēng" — the name canon verification hands the workers — and "Sui-Feng" were two people),
  none knew canon's other names ("Soi Fon"). So a person on the page under one form and seated under another was
  listed here AND elsewhere — and the world agent was told the one standing in the scene had "NO SEAT — seat them".
  One matcher now (engine/names.js): samePersonName and isHere, with canon's alias groups lent by the bridge; used by
  findPresent, findSeat, renderOffscreen (state of things, the whole ledger, the world agent's list), the drawer and
  the world agent's marks. isHere refuses to guess: two Vanessas and a note under "Vanessa" stay (M320's law kept).
- NO LAW, ONLY HOPES: presence.enter let a seat go and offscreen.set refused a present person — each writer's courtesy,
  and a ledger that ever held both (older pages, a name spelled two ways) held it forever. applyMutations now ends
  every batch by letting go of any elsewhere note for someone in the scene (said in What changed and why); a fold
  replays it the same. His current ledger heals on its next change.
- ELSEWHERE AT THE SCENE: nothing stopped a seat at the scene's own place. offscreen.set now refuses one (the place's
  first part, two words or more — a whole city is no one spot) unless the person is on the way in (toward/seeking);
  the world agent is told: anyone the page shows in the scene is in it, nobody is seated where the scene is.
- "DUE NOW" ON A STANCE THAT STAYS PUT: an arrival rode "busy"/"waiting" seats. It is no longer kept (offscreen.set) or
  said (renderArrival) for them; someone moving in (toward, seeking, tense) keeps theirs.
- TESTS: m396.mjs (4: one matcher; nobody in two places after every batch — his Rukia and Suì-Fēng under the page's
  names, never re-seated, a broken ledger healed by the next change and never told to the storyteller; no seat where
  the scene is, an arrival only where it moves; the world agent marks both [in the scene], never "seat them").
  Three older tests caught my first draft (a name cut short, two Vanessas, an arrival with no stance) — the code was
  wrong each time, and was fixed; no test was changed. NEGATIVE-TESTED: the batch law, the ambiguity check, folding,
  the venue guard, the world agent's marks, busy arrivals.
- NOT DONE BY CODE: whether Rukia and Suì-Fēng are in "Who's here" at all is the extractor's reading of his page; if
  the page shows them and "Who's here" does not, "read again" on that page re-reads it.
- version.js -> m396-001.

# M397 — the housekeeper: no wrong card left beside its correction, no card that cannot land, no false "done"
He: the housekeeper gave a wrong proposal, then the next one — the first was never superseded; and when he told it the
change could not be done, it kept saying "it's done, it's done, it's done".
- WRONG CARD LEFT PENDING: supersededByNew said "two ledger cards are two changes" — a ledger card was never set aside
  by its correction, and Apply all would have written both, the wrong one first. Now a newer ledger card that decides
  every fact the older one touched (ledgerFactKeys: a person's page field, a seat, presence, a truth, a standing, …)
  supersedes it; a card about other facts stays. An edit quoting the same passage longer or shorter is the same fix,
  refined, and supersedes too.
- A CARD THAT CANNOT LAND, STAGED AS IF IT COULD: the card's dry run (M76) already knew every entry would be refused
  (e.g. seating someone who is in the scene) — and it was staged "pending", he applied it, it failed, and the loop
  began. Now the run hands such a card back once, in the same run, with the ledger's own reasons ([CANNOT LAND]); a
  card still unlandable is staged REFUSED with "Could not land — <why>", never pending.
- "DONE" OF A CARD ONLY PROPOSED: the no-block nudge (M75) only caught a claim with NO card. An answer carrying cards
  that says "done", "fixed", "updated" is now handed back once ([NOT YET]): nothing is done until he applies.
- TESTS: m397.mjs (3: supersede by facts and by passage; the hand-backs on a scripted model — the ledger's reason at
  once, "done" taken back, the answer he sees says what the card will do; staged refused with why, and across turns the
  correction sets the wrong card aside). The whole harness stayed green (783) — no older test depended on the old
  behavior. NEGATIVE-TESTED: all four guards.
- version.js -> m397-001.

# M398 — the ledger audited, book by book: every reader asks one matcher; a page names the threads its person owns
He asked for the whole ledger audited — the scene, the people, the world, the pipeline — so the earlier mistakes
cannot come back; whether a housekeeper finding (Rukia's page "THREADS: (none)" beside the world's thread "Rukia
Kuchiki and the 13th Division command") was real; and whether the ledger's agents are logical and smart.
THE AUDIT — the M396 fault, searched for everywhere (a person compared to the scene by EXACT lower case):
- the scribe dropped a present person's "now" as if they were elsewhere when the page named them another way ("Rukia"
  in the scene, "Rukia Kuchiki" in the delta, a stale seat) — isHere/seatForPerson now;
- the auditor read who is here and who is seated by exact names — so it could "fix" a present person as absent;
- the referee's cast (seedPeople) — the fight's own people could be read as away;
- the housekeeper's review slice of a presence, the whole-ledger reading (nearNames/leanPage: a present person's page
  was shortened as if away), and the drawer's people panel ("— here" / "— elsewhere", her seat, her now).
  All ask engine/names.js now.
- ONE PERSON, ONE PAGE: findPersonKey found a page by exact name, near spelling or a first/last name — never by folded
  letters past the spelling bound ("Rōjūrō Ōtoribashi" and "Rojuro Otoribashi" became two Roses) and never by canon's
  other name ("Soi Fon" beside "Suì-Fēng"). Both are steps now, each only when exactly one page answers.
THE HOUSEKEEPER'S FINDING: not a missing loose end — a missing LINK. A story thread lives with the story's threads
(M131 shows a page's loose end that repeats it once, as the thread), and no reading of her page said she owned it. So
the housekeeper saw "(none)" and proposed writing it twice. Every reading of a page now names the story threads its
person owns (ownedThreadTitles, by the one matcher): the housekeeper's ("OWNS THESE STORY THREADS … nothing is
missing"), the auditor's, and the drawer's ("Their story threads:"). One home for the thread; its owner's page points
to it. The storyteller's own reading is unchanged (the threads already ride once, as threads).
THE AGENTS, HONESTLY: their judgment is the model's; what the house controls is what they are TOLD and what they are
ALLOWED. This audit and the last three removed the traps found in both: the world agent told a present person needed
a seat (M396), allowed a seat where the scene is and an arrival on a busy stance (M396); the housekeeper allowed to
stage a card that cannot land and to say "done" of a proposal (M397), shown a page without its threads (M398); the
scribe, the auditor and the referee reading presence by exact names (M398); every worker handed canon's end-state
as fact (M392–M394).
- TESTS: m398.mjs (4: the housekeeper reads her owned thread on her page; the scribe keeps her now under another form
  while a seated person's now stays the seat's; the referee's cast has her here; one person one page by folded letters
  — Rose's four marks — and by canon's names, two Vanessas still two). M130-1 and M131-1 pinned the scribe's OLD code
  text for the same law; they point at the new rule now, and M398-2 proves it running. NEGATIVE-TESTED: the owned-
  threads line, the scribe's exact match, the referee's exact match, the page finder's folded and canon steps.
- version.js -> m398-001.

# M399 — canon verification is switched per story
He: "Why is the canon not stuck on a specific page? Default off; if one story has Bleach, only that story has it — the
others off, each by its own last saved state." One switch (settings row "canonOn") ran canon for EVERY story the moment
it was on in one.
- bridge.js canonOn(storyId) / setCanonOn(storyId, on): the row "canonOn:<id>" — the tale's own (store.js
  STORY_PREFIXES: it rides the tale's book, never the house's, is swept when orphaned, goes with the tale). Off is no
  row: a story is off until he switches it on for it. Every reader asks for its story: the send path, the readers'
  chain (lens, old-page cleanup, faces, the workers' record), the room.
- Settings: the switch is the OPEN story's — its label names the story ("Canon verification — for “Bleach, captain
  Oda”"), disabled with no story open; the levers below it stay shared by every story that has it on; the help text
  says each story has its own switch. "Reset settings" no longer touches it (a story's switch is the story's).
- A branch keeps its story's switch (carryCanonMemory). An imported SillyTavern chat keeps its canon memory but starts
  OFF, as every story does, until he switches it on.
- THE MOVE, ONCE: the old single switch, where it stood on, becomes "on" for every story canon was really used in (a
  wiki bound, someone found) and off for the rest; then the old row is let go. So his Bleach story keeps canon on;
  every other story is off unless he switches it on.
- TESTS: m399.mjs (3: each story's own switch; the move — on where used, off where only misses, the old row gone; the
  tale's row in its book, never the house's, swept, gone with the tale, kept by a branch). Walk DOM-91 (on in one story
  in Settings, off in the next one opened, on again back in the first; the switch names its story). The canon walk
  scenarios set their own story's switch; DOM-85's "off" now reads off as no row.
- version.js -> m399-001.

# M400 — the fight style is his edge, measured
He asked whether the referee's heroic / realistic / gritty is a gimmick, and whether heroic buffs his MC.
- NOT A GIMMICK — engine/referee-math.js PRESETS, measured on the real roller (an even fight, then one against someone
  two steps stronger): realistic wins 50% / 24%, disasters 5.4% / 10.8%; HEROIC +1 to his side and wider decisive,
  half the disaster band — wins 64% / 36%, decisive 10.1%, disasters 1.6% / 4%; gritty the same odds as realistic
  but dearer wins (success-at-a-cost 23.6% vs 18.1%) and more disasters (8.1% / 16.2%).
- FOUND: fights and battles are rolled from his side (duels.js adds the edge to the player), but a LONE CHECK added the
  style's +1 and bands to WHOEVER acted — "Renji tries to force the door" got heroic luck too, and under gritty any
  NPC's check broke more often. resolveCheck now gives the style to the main character's own checks; another person's
  check rolls as the world is (realistic).
- TESTS: m400.mjs (2: his own check +1 under heroic, another's not — negative-tested; the styles' real odds).
- version.js -> m400-001.

# M401 — the quiet ones in the room; and what the "drift note" in the storyteller's thinking was
He: (1) his storyteller's thinking said "The page drift note about asterisked actions was already handled last pages.
Clean room, grin, play" — is that an injection into his post-history instructions? (2) The absent are simulated; the
people in the scene who are not on the page are not — his MC nearly killed Zaraki and Kyōraku stood silent while the
storyteller narrated others. Should they be simulated, and where — the scene or the people ledger?
- (1) THE HOUSE'S EYE (M88), not his post-history instructions and not the frame: after each page, code checks the
  page against his craft's own mechanical laws (Sound As Onomatopoeia: asterisks wrap contact sounds only — a span of
  four words or more in asterisks is read as an action; Marks On The Page; …). When the LAST page slipped, one short
  note rides his briefing for the next turn, in his voice, naming his craft's own Drift Recovery ("that page stands
  as written… let the next page quietly come back to it"); the receipt shows it as "The house's eye". The storyteller
  reading it in its thinking and not on the page is the design (M321 reworded it after it was called "the injected
  lint"). Nothing changed here.
- (2) THE QUIET ONES IN THE ROOM — simulated, on the people ledger, not a new scene section (one home per fact: a
  present person's "now" is their page's, and the storyteller already reads every present person's page). world.js
  quietInScene finds them in code — here, not the main character, not named on the latest page or in his message (any
  word of the name, letters folded: "Zaraki" is Kenpachi Zaraki); the world agent is shown them ("IN THE SCENE, NOT ON
  THE PAGE") with the law: for each, one line of what they are doing and weighing this minute, in their nature,
  reacting to the scene — never an instruction, never dialogue, never moved out of the scene; the page decides whether
  they act. A code guard lets the world agent write a "now" ONLY for them (the page's people stay the scribe's, the
  absent their seats'). No extra model call: the world agent already runs every page.
- TESTS: m401.mjs (2: who is quiet — Kyōraku at the rail, never Zaraki or Rukia whom the page showed; on a scripted
  world agent his now lands on his page and reaches the storyteller, a now for the fighter or someone away is let go).
  NEGATIVE-TESTED: the code guard; the list in the request.
- version.js -> m401-001.

# M402 — silence is not leaving; someone where the scene is, is in it
He branched back to before the Zaraki fight and read page 12 again: Kyōraku's page said "Now (elsewhere): last seen at
10th Division HQ — training courtyard" — the courtyard Jovan was standing in — and no "now" of his own was simulated.
- THE ROOT: the page reader took him out of the scene (presence.leave → M304's "last seen" note at the scene's own
  ground) on a page that never named him. The quiet ones in the room (M401) are only the PRESENT, so once out he got
  a "last seen" line instead of a life; and the world agent could never move him on to where he truly was, because
  M396 refused a seat at the scene's own place. Stuck, "elsewhere", in the room.
- SILENCE IS NOT LEAVING (extractor.js leavesTheyWereShown, applied to every extractTurn answer): a presence.leave for
  someone the page or his message never names is let go in code, whatever the model answered; the page reader's own
  vocabulary says leave ONLY when the page shows them leaving — someone unmentioned is quiet, not gone. Named leaving
  (letters folded) still leaves.
- SOMEONE WHERE THE SCENE IS, IS IN IT (apply.js offscreen.set): a seat at the scene's own ground that is not an arrival
  now WALKS THE PERSON IN (presence.enter; their note lets go on its own; undoable) instead of being refused — so the
  world agent, told to move a "last seen" person on, heals a ledger stuck like his: he returns to Who's here, and the
  world agent keeps him alive there next page. M396-3's expectation (Rose refused) is Rose walking in now.
- HIS LEDGER: "read again" under page 12 again (the leave is let go now), or simply the next page — the world agent
  moves Kyōraku on from "last seen", and a place in the courtyard walks him back in.
- TESTS: m402.mjs (3: a page that never names him cannot take him out, one that shows him go can; the page reader run
  whole lets its leave go and keeps the rest; placed where the scene is, he walks in, nowhere else, undoable).
  NEGATIVE-TESTED: the leave guard; the walk-in.
- version.js -> m402-001.

# M403 — one audit emptied his scene: the auditor gets the same laws as the page reader
He, furious: everyone "elsewhere — last seen at 10th Division HQ — training courtyard", the courtyard the scene was in.
The workers' line said it: "the auditor … set 19 right: The scene now stands in 1st Division HQ — outside the assembly
hall · Byakuya Kuchiki stepped out of the scene · Renji Abarai stepped out · Iba Tetsuzaemon stepped out · …".
- THE ROOT: M402 put "silence is not leaving" on the PAGE READER only — the auditor is a second writer of presence and
  of the ground, and had neither law. It moved the ground on its own reading (its scope refused a move only when the
  header DISAGREED; with the header silent it moved freely), then took the whole room out of the scene in one batch —
  every one of them "last seen" at the ground the page began on (M304), the courtyard. My M402 fix covered one of the
  two writers; rule 8 (search the codebase for the same fault) was not done — this is that miss.
- THE GROUND IS THE PAGE'S (auditorScope): the auditor may bring the ground TO the latest page's header, and never move
  it otherwise — header silent means no move. The header comparison uses samePlace (it compared exact lower case).
- SILENCE IS NOT LEAVING, FOR THE AUDITOR TOO (auditLedger): its presence.leave passes leavesTheyWereShown against the
  latest pages; a finding that was only silent leaves is no finding. A leave the page shows still lands.
- HIS LEDGER: "read again" under the latest page takes back everything its chain wrote (the auditor's batch with it)
  and reads it again under these laws; or take the auditor's lines back in "What changed and why".
- TESTS: m403.mjs (the real auditor on a scripted answer: its ground move let go, three silent leaves let go, the leave
  the page shows lands, nobody else "elsewhere"). NEGATIVE-TESTED: both guards.
- version.js -> m403-001.

# M404 — every person has a banner; a rank or family name first is still the same person
He: everyone in "The people" had a "— here" or "— elsewhere" banner; Rukia Kuchiki had none.
- A BLANK MEANT TWO THINGS AND SAID NEITHER: the banner was "— here" when the matcher found her in the scene, "—
  elsewhere" when a seat was hers, and NOTHING otherwise — both "no whereabouts written yet" and "in the scene under
  a form of her name the matcher missed" drew the same blank. Now it is never blank: "— here", "— elsewhere", or
  "— whereabouts not yet written" (the world agent seats anyone who matters on the next page, M304).
- THE FORMS THE MATCHER MISSED (engine/names.js): a rank or courtesy — "Lieutenant Rukia Kuchiki", "Captain
  Hitsugaya", "Kyōraku-san" — is set aside (titles from the front, honorifics from the back, never down to nothing);
  the same names in another order ("Kuchiki Rukia", family name first) are the same person. Two Kuchikis stay two
  people; a rank alone is nobody. Every book that asks the matcher (M396/M398) gains it at once.
- TESTS: M404-1 (in m396.mjs). Walk DOM-92 (the people panel: here though the scene says "Lieutenant Rukia Kuchiki",
  here though it says "Kuchiki Byakuya", elsewhere, and "whereabouts not yet written" — never a blank).
  NEGATIVE-TESTED: titles kept; order kept.
- version.js -> m404-001.

# M405 — a "now" of a place the scene has left is let go; a nickname in brackets finds its page
He: Kyōraku finally read "— here", but his "Now:" said "inside the assembly hall at 1st Division HQ, the announcement
pending" — eight scenes old, in the courtyard. And "Rose — here" had no description at all.
- THE STALE NOW: a scene move (place.set) let go of the MAIN CHARACTER's old now (M272) and nobody else's, so a present
  person carried a "now" of a place the scene had left, read by the storyteller and the drawer as the present.
  engine/apply.js staleNows names every present person (never the main character, never a now his hand wrote) whose
  now names a ground from the journal's place history and not the ground the scene stands on; the readers' chain lets
  those go as a journaled change (people.set state, clear) right after the page reader, before the world agent and the
  scribe write the true ones (the world agent's quiet ones, M401). His ledger heals on the next page.
- FIRST DRAFT, TAKEN BACK: I first made place.set itself let go of every present now, and a batch law heal the old
  ones. The fold fuzzers (fold-fuzz.mjs) failed at once — "a journal fold reproduces the world the writes made" — the
  law read the journal and the move's side effect did not replay true. Both are gone; the heal is a journaled change a
  worker makes, which a fold replays like any other. The fuzzers pass again.
- ROSE: the world agent had written him as "Rōjūrō Otoribashi (Rose)"; the page reader wrote "Rose" — and a first/last-
  name match compared raw words, "(rose)" ≠ "rose", so "Rose" became a second, empty page. findPersonKey's first/last
  word rule compares folded words now (brackets and marks set aside): "Rose" finds "Rōjūrō Otoribashi (Rose)".
- TESTS: m405.mjs (3: a move then the chain — the old now named and let go, his hand's kept, undoable; an old ledger's
  stale now named once and let go, a now of this ground kept; "Rose" finds his bracketed page, one page). The chain job
  is filed under the page reader (M29-10 reads the chain order). NEGATIVE-TESTED: the finder; the bracket fold.
- version.js -> m405-001.

# M406 — one person's two pages are joined on their own; the answer he should have had
He: what exactly happened — Kyōraku was always at the 10th Division and is meant to be SIMULATED; what is "quiet";
and why tell him to fix Rose by hand through the housekeeper instead of "read again".
- THE PLAIN ACCOUNT (for the next reader of this file): "quiet" was my word for M401's simulation — a person in Who's
  here whom the latest page does not mention; the world agent writes their "now" every page. Kyōraku missed it three
  ways, one after another: (1) the page reader took him out of Who's here for not being mentioned (M402 fixed), (2) the
  auditor took the whole room out and moved the scene (M403 fixed), (3) his page kept a "now" from the assembly hall,
  because a scene move only ever cleared the main character's (M405 fixed). Out of Who's here, the simulation skipped
  him; back in, the old now stood until the next page's simulation.
- ROSE, JOINED ON ITS OWN (engine/apply.js duplicatePages; the readers' chain job right after the page reader, the same
  one that lets go of stale nows): a page whose name finds exactly one OTHER, fuller page by findPersonKey's own rules
  is renamed onto it (people.rename, M163: nothing lost; journaled, undoable). "Rose" joins "Rōjūrō Otoribashi (Rose)";
  two Kuchikis and two Vanessas never join. It runs every page — so "read again" on the latest page does it, which is
  what he should have been told instead of the housekeeper.
- TESTS: M406-1 (in m405.mjs: only Rose joins, onto his full page; the empty page gone, his description kept, his
  presence follows, taken back whole). Negative-tested. The fold fuzzers pass (the join is a journaled change).
- version.js -> m406-001.

# M407 — the world agent's row in The workers says everything it simulates
He asked which worker simulates the people, to give it its own connection. It is the world agent — the absent (where
they are, by the clock) and, since M401, the people in the scene the page does not mention (their "now"). Its row in
Settings → The workers still read "keeps the absent alive": a control that does not say what it does is one he cannot
find (his rule 13). The row now reads "The world beyond — simulates everyone the page isn't showing: the absent where
they are, and the people in the scene the page didn't mention; moves the world by the clock, briefs the storyteller".
Harness 803/803, walk 110/110. version.js -> m407-001.

# M408 — everyone here has a "now"
He: Kyōraku and Rukia have no "Now" while others do. The M405 heal let go of their "now" of the assembly hall; they
are on the page, so the new one was the scribe's — and the scribe writes sparsely ("only where something truly
shifted"), so it wrote none. The world agent writes nows only for the people the page does NOT mention (M401).
- The scribe is told, by name, who in the scene has no now yet ("IN THE SCENE WITH NO NOW YET — for each one this
  page shows, write their state now").
- No card is blank meanwhile: a present person with no now reads "Now: here — <their position>" (what the scene
  knows for certain) — on the storyteller's card (people.js cardText) and in the drawer — until a reader writes more.
- TESTS: M408-1 (in m405.mjs: the scribe is told Kyōraku, not Rukia who has one; his card reads "Now: here — by the
  rail."). Harness 804/804. version.js -> m408-001.

# M409 — the real root: his headers never set the ground (a place that began with a number was dropped)
He, exhausted: Rukia's card said "Now: here (the next page writes what they are doing)" — a delay, a promise, not a
simulation — and Kyōraku's "now" was still "inside the assembly hall at 1st Division HQ, among the assembled captains"
while the captains watched the duel.
- THE ROOT UNDER ALL OF IT (engine/state.js headerMutations): `if (place && !/^\d/.test(place))` — any place that began
  with a digit was taken for a time or a date and DROPPED. Every ground of his Bleach story begins with one ("10th
  Division HQ", "1st Division HQ", "13th Division barracks"), so his headers never set the ground: it stayed wherever
  a reader or an audit had last put it. That is why the auditor could move the scene "with the header silent" (M403),
  why the ledger thought the scene was the assembly hall, and why M405's heal — judging nows against that WRONG ground
  — let go of Rukia's true courtyard now and kept Kyōraku's assembly-hall one. Only a time ("09:00"), a date ("06/01",
  "1 June") or a bare number at the front is not a place now.
- THE CHAIN PUTS THE GROUND RIGHT FIRST (chat.js, the page reader's upkeep job): the ground is set to what this page's
  header says (a journaled place.set), then nows are judged against the PAGE'S ground (staleNows { ground }).
- A NOW KNOWS WHERE IT WAS WRITTEN (apply.js people.set records nowAt = the ground at the time): a move makes it stale
  by fact, even when folds and rewinds have trimmed the journal's history of grounds (which is exactly what hid
  Kyōraku's in DOM-93's first run). The journal-words check stays only for nows written before M409.
- NO NOW IS LEFT FOR "THE NEXT PAGE": whoever here has no now at all is the world agent's to write (quietInScene), whether
  the page mentions them or not — the world agent runs every page, the scribe writes sparsely. The drawer no longer
  says "(the next page writes what they are doing)": a card with no now reads "Now: here — <position>".
- TESTS: M409-1 (the page's ground judges: the wrong ledger ground makes the TRUE now look stale; the header's makes
  the assembly-hall now the stale one; a mentioned person with no now is the world agent's), M409-2 (his headers set
  the ground; a time or a date does not), M409-3 (a now knows its ground; stale by fact with the journal trimmed; a now
  written here is of here). Walk DOM-93 ("read again": the ground where the page says, Kyōraku's assembly-hall now gone,
  Rukia's courtyard now kept, the page untouched, no card says "the next page"). NEGATIVE-TESTED: the header fix,
  nowAt, the world agent's no-now people.
- version.js -> m409-001.

# M410 — checked M409 against what worked before it; the header's whole place
He asked whether the update broke anything or made it better, showing the workers' line from before it: the world
agent writing rich "now"s for Kyōraku, Rose, Hitsugaya and Suì-Fēng (the M401 simulation working), the auditor
bringing Rukia back into the scene.
- WHAT M409 KEEPS: the world agent still writes a now for everyone here the page does not mention (and now also for
  anyone here with none); the auditor may still bring someone INTO the scene (only its moves of the ground and its
  silent leaves are refused, M403).
- WHAT M409 WOULD HAVE BROKEN, FOUND AND FIXED HERE: with a place that begins with a number now read from the header,
  the header's place REPLACES the page reader's (M128: the header wins) — and the header parser took only the part
  before the FIRST dash ("10th Division HQ"), so a reader's "10th Division HQ — training courtyard" would have become
  "10th Division HQ": a move by name, which clears where everyone stands (M261), and a coarser ground. The place is now
  every part of the header before the first that reads as a day or a date ("[10th Division HQ — training courtyard —
  Monday, June 1 …]" → "10th Division HQ — training courtyard"); a header with no date keeps its first part as before.
- A ledger whose ground is still a different string from the header's moves once on the first page after updating
  (where each stands is read again on that page) — then stays.
- TESTS: M410-1 (the courtyard, not just the HQ; the HQ when that is all the header says; the date and hour still
  read). Negative-tested. Harness 808/808. version.js -> m410-001.

# M411 — the tidy wrote the old now back over the simulation's fresh one
He: the workers' line before the update showed the world agent writing Kyōraku's now correctly ("at the edge of the
sand near the gate, hat tipped low…") — so why did his page read "inside the assembly hall at 1st Division HQ"?
- THE SAME RUN'S TIDY OVERWROTE IT: "the scribe … tidied 9 pages (… Shunsui Kyoraku …)". agents/tidy.js read the pages,
  asked its model, and wrote back every field its answer changed — judged only against the page as it stood at WRITE
  time, so its answer (made from the page as it stood before, and from older pages) replaced the now the world agent
  had just written. The simulation worked; a later worker undid it.
- tidyMutations now: a now written on THIS page (by the world agent or the scribe) is never replaced by the tidy — it
  may fill an empty now and mend an old one; and a now or an arc written while the tidy was reading (read ≠ fresh) is
  not touched (tidyPeople passes the page it read).
- TESTS: M411-1 (in m405.mjs: his fresh now kept, an empty now filled, a now written meanwhile untouched). Negative-
  tested both guards; M259's tidy tests (which move a misplaced now to its owner and fill one from the latest page) all
  still pass. Harness 809/809. version.js -> m411-001.

# M412 — why the fixes came one at a time, and the last writer of a "now" given its law
He asked why I keep jumping around — he had sent the workers' log (the world agent writing Kyōraku correctly) and I
answered around it, so he had to explain again — and whether any fix made something worse, the header one above all.
- WHY: I answered the question I expected ("did the update break the simulation?") instead of the one his log asked
  ("it was written right — why is it wrong?"), and I fixed each symptom where it showed instead of listing EVERY writer
  of the one field that was wrong and checking them together. A person's "now" has six writers; they are listed in
  HANDOFF 0f with their laws so the next fault is checked against all of them at once.
- THE LAST ONE: the scribe's side of "one writer per now" was only words. A now the scribe writes for someone here
  whom neither the page nor his message mentions is let go in code (scribe.js) — the mirror of the world agent's guard
  and the same shape of fault as M411's tidy. Someone the page shows is still the scribe's.
- NOTHING WORSE, CHECKED: the header change (M409/M410) makes the page's own header set the ground — a place that
  begins with a number is read, the whole place up to the date is kept; a ledger whose ground was written differently
  moves once on the next page (where each stands is read again) and then holds. The auditor never writes a now
  (M128). The full harness (810, fold fuzzers included) and walk pass.
- TESTS: M412-1 (in m405.mjs: his exact case — the scribe's old assembly-hall line for Kyōraku let go, his simulated
  line stands; Rukia, on the page, is the scribe's). Negative-tested. version.js -> m412-001.

# M413 — the long play caught what M403 broke; the auditor's rule for taking someone out, corrected
He was furious at "I can't promise" — his own standing rule says: never a generic disclaimer; say what was checked, what
it proved, what was not covered. So the whole pipeline was run end to end, the long play included — and the long play
(LONG-8, not run since M402) FAILED: M403 had made the auditor unable to take out anyone the latest pages did not NAME,
so a person who came in eighty pages ago and was never seen again stayed "here" forever. M403's rule was the wrong
shape: it forbade exactly the auditor's real work (stale presence) and allowed what it should forbid (anyone named).
- NOW (auditor.js): the auditor may take someone out when the latest pages show them GOING (their name in a sentence
  that says they leave), or when they have been silent through the last eight pages of a story that has eight. Anyone
  named in the recent pages without going stays — they are in the scene (his duel's captains). The ground rule stands.
- CHECKED: harness 810/810 (M403-1: his emptied room — the captains stay, Lisa shown walking out goes), walk 111/111,
  LONG PLAY 8/8. NEGATIVE-TESTED: the auditor taking out anyone (M403-1 fails), never taking out the long-silent
  (LONG-8 fails). The long play now runs with every change (HANDOFF).
- version.js -> m413-001.

# M414 — the one matcher, audited: an owner is not the person, two titles of one kind are two people, one "named on the page"
A fresh session's audit of M396–M413, read line by line and run.
- "JOVAN'S MOTHER" WAS JOVAN: foldName turns an apostrophe into a space, and the first-name rule then read "jovan s mother"
  as the main character. While he stood in the scene she could never walk in ("already written in"), the batch law
  (M396) let her elsewhere note go after every page, and a leave meant for her under another word ("Jovan's mom") took
  HIM out. engine/names.js compares names with nameFold: an apostrophe inside a word is part of it ("jovans mother",
  "obrien") — for NAMES only; text is still searched with foldName.
- TWO TITLES OF ONE KIND ARE TWO PEOPLE: M404 threw the title away, so "Captain Kuchiki" (Byakuya) and "Lieutenant
  Kuchiki" (Rukia) were one person, and so were Mr. and Mrs. Sterling (M272 had ruled them two). There were three title
  lists (names.js, people.js TITLE_RE, people.js TITLE_WORD) and none knew the others' words. names.js now holds the one
  list, each title with its kind (civil — Mr/Mrs/Ms/Miss/Dr/Prof —, noble, royal, rank, kin, order, role): two titles of
  the SAME kind that share nothing are two people; different kinds can be one person ("Lady Rukia" is "Lieutenant Rukia
  Kuchiki"). people.js titlesDiffer keeps M272's own refusals and adds these.
- "ALREADY HERE" SWALLOWED A NEWCOMER: findPresent took "Kuchiki" (or "Captain Kuchiki") walking in as Rukia, already in the
  scene, even with Byakuya on his own page — "already written in", silently, and the auditor asks the same question, so
  it could never heal. findPresent(state, name, { strict: true }) (presence.enter, offscreen.set's "is in the scene",
  the auditor's scope) refuses a name that could mean two people the ledger knows (names.js oneMeaning). Leaving and
  moving stay with the scene's own people (only someone here can leave).
- A COURTESY AFTER A NAME IS ONE ONLY WHEN IT IS JOINED: M404 stripped a trailing "chan"/"kun"/"san" standing on its own —
  Jackie Chan became "Jackie" and "Chan" named nobody. Only the Japanese joining counts now ("Kyōraku-san",
  "Hitsugaya-taichō", "Kuchiki-fukutaichō" — the last two carry their rank).
- THE PAGE FINDER NEVER ASKED THE ONE MATCHER: "Captain Hitsugaya" never found Toshiro Hitsugaya's page, nor "Kuchiki Rukia"
  Rukia Kuchiki's — so a present person's page was "missing" and a second one got written. findPersonKey's last step asks
  samePersonName (exactly one page; M272's "Mrs. Sterling is not a bare Sterling" kept).
- "NAMED ON THE PAGE" HAD FOUR COPIES (world.js quietInScene, extractor.js leavesTheyWereShown, scribe.js M412, auditor.js
  M413) — any word of three letters or more. A title or "the" counted: "Lieutenant Rukia Kuchiki" was on every page that
  mentioned any lieutenant (never quiet, never simulated), "The bartender" on every page; and "Ed" or "Al" on none (no
  word long enough — never allowed to leave, never the scribe's). One answer now: names.js nameOnPage — the whole name,
  or any word of it that names someone; never a title, a joined courtesy, a joining word, or the owner in "Jovan's
  mother"; a two-letter name counts. A word two people share (a family name) still counts for both.
- THE AUDITOR'S "SHOWN GOING" READ A SIDE AS A GOING: M413's word list passed "Rukia stood to his left", "her left hand"
  and "Don't leave" (someone SAYING it). auditor.js showsDeparture: words in quotation marks are set aside; "left" is a
  going only when it is not a side, not passive ("was left") and not a thing left in a state ("left the door open");
  "leave" only when nothing says it did not or has not happened yet ("didn't leave", "wanted to leave").
- M405'S CHAIN JOB SAVED WITHOUT M290'S LAST CHECK: every other reader's save checks stale() and that its page still stands
  the moment before it writes; this one checked only at its start. It does both now. (Proven by reading: the window is
  two local reads — no test reaches it without an injected delay.)
- tests/holdsone.py HAD FAILED SINCE M347: it read "the first database in the list" twice, and since M347 the browser also
  holds cozytavern.sent.v1, which lists first — the probe read a database with no settings table and died ("Execution
  context was destroyed" — no navigation happened; checked over CDP). It names cozytavern.v1 now. 17/17.
- M237's presence line read the handler's SOURCE TEXT; it runs the door now (someone already here, walking in again under
  the same name or a shorter one, is refused as already so, and the scene holds them once).
- TESTS: m414.mjs (4: the owner is not the person; two titles of one kind; named on the page, through the world agent's
  quiet ones and the page reader's leaves; the auditor's narrated going on 13 sentences and the real auditor).
  NEGATIVE-TESTED, one mutation at a time: the apostrophe fold, the title conflict, strict findPresent, the old any-word
  rule, the old leave/left words — each fails its test. Harness 814/814, walk 111/111, long play 8/8, lint 0 errors;
  holdsone 17, twobrowsers 26, twohands 10, foldcrash 12, append 24, backup 8, guard 13, wipe 11, recover 3, relay 11,
  branchrefresh 12, cutthinking 26, housekeeper_rounds, perf_housekeeper, perf_rooms, paint_magma, contrast, coat, paint.
- version.js -> m414-001.

# M415 — "done" of a card that lands on arrival is true; the housekeeper is handed it back only when his cards wait
M397 added a second hand-back: an answer that carried cards and said "done", "fixed" or "updated" was sent back once
("[NOT YET] … nothing is done until the writer applies your cards … say what the cards WILL do once applied"). But his
cards LAND ON ARRIVAL (M96, Settings → the housekeeper → "Apply its cards as they arrive", on as it ships): "done" of a
card in THIS answer was true — the housekeeper's own brief allows it ("never … about a thing that is not in a block in
THIS answer") — and every such answer cost a second model call (a wait) and came back saying "once you apply it", an
Apply that did not exist. What he had reported in M397 ("done, done, done" of a change that could not be done) is the
card that cannot land, handed back by [CANNOT LAND] — that stays.
- runConversation({ cardsWait }) — the [NOT YET] hand-back fires only when his cards wait for Apply; housekeeperTurn
  reads the setting (hkAutoApply === false) and passes it.
- TESTS: M415-1 (the real housekeeperTurn, the setting read from the real store: cards landing on arrival — one model call,
  no hand-back; cards waiting — the hand-back comes). M397-2 now runs with cardsWait (its premise: a card only
  proposed). NEGATIVE-TESTED: the hand-back without the guard fails M415-1. Harness 815/815, walk 111/111, long play 8/8.
- version.js -> m415-001.

# M416 — his storyteller's notes, read as the teller reads them: four lines that read like a machine
One real turn was sent through the app (a teller "Lothar" in the frame, "Bruce" as the writer, a Bleach ledger) and the
notes it was handed were read line by line, as the teller reads them.
- "BUSY" INVENTED COMPANY: the busy stance was worded "taken up with someone else" — to the world agent (its vocabulary)
  and to the storyteller (STANCE_WORDS). Since M366 everyone lives their own life, and busy is the stance of anyone
  occupied with it: Byakuya, alone with the patrol rosters, was described as being with someone. Now "busy with their own
  affairs" to the storyteller, and "taken up with their own affairs (their work, their own people)" to the world agent.
- A THREAD'S NEXT BROKE ITS SENTENCE: "<owner> means to <next>" is right for a plan ("corner him before Renji leaves") and
  broken for a sentence ("means to she tests whether Oda deserves it"). engine/world.js threadNextWords — a next written
  as a sentence (a subject, a "will", the owner's own name first) is said as "— next: …"; a plan reads on after "means
  to" (a capital set small). ONE wording for the storyteller's threads (renderThreads) and the workers' whole ledger
  (whole.js renderAllThreads), which had two copies of the old line.
- AN AWAY CARD POINTED LIKE A MANUAL: "Now: away — where they are now is under Elsewhere" (and "away (see Elsewhere)" on
  the roster). M292's law stands — where the absent are is said once, under Elsewhere, in the same notes — the card
  just says "away".
- WHO HASN'T FOUND OUT WHAT, IN A RULEBOOK'S VOICE: "Who does NOT know what … if they SPEAK of it or ACT on it, the page
  must show …" and "has not been shown learning:". The same law (M338 — they may guess, suspect or be told; they speak
  of it or act on it only once the page shows how they came to know; no telling that never happened) in the voice of
  the notes: "What they haven’t found out — …" and "<Name> hasn’t found out: …". The line's words live once
  (engine/world.js BLIND_LINE); the derestricted anchor (assemble/anchor.js) and the second reader's brief
  (continuity.js) read them from there — the anchor had matched the old words by a literal of its own.
- NOT CHANGED, AND WHY: a small standing shows as its number alone ("Rukia Kuchiki — R-8") — M53, his own field report:
  a word for |v| < 10 ("distant") overstated a whisper; P/R/S is his preset's notation.
- SETTLED, NOT BUGS: (1) the connection form's thinking dial has no unset state — Off is its visible default and is sent
  as off (DeepSeek thinks by default otherwise); (2) the missing positions of the first probe were the probe's own
  timing (it wrote positions while the first page's chain was still running, and that page's ground then landed and let
  them go, as a move does) — seeded after the chain finished, every position reaches the notes.
- TESTS: m416.mjs (4: busy never invents company; a thread's next reads right in both renderers; an away card says
  "away" and Elsewhere says where; the plain head and line, the anchor and the second reader reading the same words).
  Updated the pins of the old words (m29, m396, m259, m338, m343, the walk's DOM M338 scenario) — each checks the same
  behaviour in the new words. NEGATIVE-TESTED: each of the four fails its test when the old words come back. Harness
  819/819, walk 111/111, long play 8/8; the live request read again through the app.
- version.js -> m416-001.

# M417 — a date or an hour first in the header is the clock's, never the ground
Found by asking the header reader for every shape a page's header takes, not only his: the reader asked only the parts
AFTER the first whether they were a date, so "[Monday, June 1, 2026 — 10th Division HQ — training courtyard | 10:40]"
set the ground to "Monday, June 1, 2026" — a move to a day, which lets every position go (M261) and judges every "now"
against it (M405/M409) — and a header that was only a date set no clock.
- state.js headerMutations: leading parts that ARE a day, a date or an hour (a weekday standing with a date, a number or
  a time of day after it, or alone; a month with a day number that ends there; a numeric date; a clock time) are the
  clock's; the place is what follows (after a leading date, the rest of the part). A place named for a day stays a place
  ("Sunday Market", "Friday's Pub", "May 5th Avenue", "Sunday Morning Cafe"). The date is read from everything that is not
  the place, so "[Monday, June 1, 2026 | 10:40]" sets the clock and no ground. His own shape ("[10th Division HQ —
  training courtyard — Monday, June 1 …]") reads exactly as before.
- TESTS: M417-1 (ten headers, ground and clock each, and the ledger after one). NEGATIVE-TESTED: without the leading-date
  step it fails. Harness 820/820, walk 111/111, long play 8/8.
- version.js -> m417-001.

# M418 — one person's two pages, one under a rank: joined under the NAME; a rank is not part of a name's length
M414's page finder asks the one matcher last, so "Rukia Kuchiki" now finds "Lieutenant Rukia Kuchiki". The join of one
person's two pages (M406, every page) then compared LETTERS: the ranked page, being longer, would have become the
page's name — a rank goes stale (Rukia may be a captain one day) — and "Captain Hitsugaya" never joined "Toshiro
Hitsugaya" (seventeen letters each).
- apply.js duplicatePages: two pages whose NAME is the same (names.js nameCore — a rank or courtesy set aside), one with
  a rank and one without, join into the one without, whichever the ledger lists first; otherwise only a shorter NAME
  joins a fuller one, judged on the name itself (so "Captain Hitsugaya" joins "Toshiro Hitsugaya"). Two ranked or two
  plain forms of one name never join; a rank and a surname two people share join nobody.
- Since M414 a write under a second form of a name lands on the page already there, so new pairs are not made; this
  heals the pairs an older ledger already holds. (One page per person; its name is whichever form was written first.)
- TESTS: M418-1 (the older ledger's pairs joined under the names, both halves kept, her place in the scene following;
  two Kuchikis never; the name listed first or second, the same join). NEGATIVE-TESTED: the direction rule and the
  name-length rule each fail it. Harness 821/821, walk 111/111, long play 8/8.
- version.js -> m418-001.

# M419 — one person, one name in EVERY book: injuries, standings, who-knows-what and what's true of them
M320's law ("never look a person up in ANY ledger book by exact key") reached the pages and the seats, and M396–M414 the
presence. The body ledger, the standings and the locked truths still matched EXACT letters, and who-knows-what first and
last names only: "Rukia" hurt on one page and "Rukia Kuchiki" on the next were two bodies (a heal of one left the other's
wound open), her standing two standings each with half its history, "Suì-Fēng" and "Sui-Feng" two minds, and "you" —
the main character, as the page reader often writes him — a body of its own beside his name.
- apply.js personBookKey: a book entry is found by the book's own finder first (exact; knowledge's first/last-name rules),
  then — "you", "I", "the player" and his story name — the main character's own entry, then the one matcher
  (engine/names.js) when exactly one entry answers and the name means one person. A NEW entry is written under the name
  the person's page stands under (newBookKey), the main character's under his. Used by body.injure / strain / heal (and a
  fight's wounds), rel.shift / set / clear, knowledge.add / forget, canon.lock / unlock. The take-backs keep their exact
  keys (they name the entry they wrote).
- apply.js strayBookKeys + the readers' chain (after the page joins, M406): an older ledger's injury, standing, knowledge or
  truth under another form of a name, with no page of its own, is renamed onto the one page the name means
  (people.rename — every book follows, entries merged, journaled, undoable); "you" onto the main character. A bare
  surname two people share joins nobody.
- TESTS: m419.mjs (2: one body, one standing, one mind and one set of truths per person — the short name, folded letters,
  "you" on his short-named entry, a bare "Kuchiki" nobody's; an older ledger's split books joined and nothing left to
  join). NEGATIVE-TESTED: the matcher step, both main-character redirects, the heal — each fails it. Harness 823/823,
  walk 111/111, long play 8/8.
- version.js -> m419-001.

# M420 — her own secret is hers: who-knows-what finds a person under any form of their name
Asked of the storyteller's notes after M419: with "Suì-Fēng" in the scene (canon's spelling) and her knowledge written
under "Sui-Feng" (the page's), findKnowledgeKey (first/last names, a name inside a longer one — nearKey) found nothing.
So "Who knows what" left her facts out, and "What they haven't found out" told the storyteller "Suì-Fēng hasn't found
out: the Onmitsukido watches Oda (Sui-Feng knows)" — her own secret, as if she and Sui-Feng were two people.
- world.js findKnowledgeKey: nearKey first, then the one matcher (engine/names.js — folded letters, a rank, canon's other
  name) when exactly one entry answers; a surname two people share finds nobody. engine/world.js now imports names.js
  (which imports nothing — no cycle).
- M239's last check read world.js's SOURCE for two copies of one return line; it now runs both finders on the same
  questions and holds that they answer alike.
- TESTS: M420-1 (the finder; the notes through renderStateFacts — her fact shown as hers, never told she hasn't found out
  her own secret, what she truly hasn't learned still said). NEGATIVE-TESTED. Harness 824/824, walk 111/111, long play 8/8.
- version.js -> m420-001.

# M421 — a move inside one compound is a move: a now is judged by the ledger's one place matcher
M405/M409 judged a present person's "now" stale when the ground it was written on (nowAt) differed from the scene's —
but compared only the place's FIRST part. Since M410 the ground is the header's whole place, and a move from "10th
Division HQ — training courtyard" to "10th Division HQ — captain's office" is a move by the ledger's own rule (placeKey:
it lets every position go, M261) — while Kyōraku's "at the rail, watching the sand" was kept as current, because both
places begin "10th Division HQ". The storyteller read a courtyard now in the captain's office: the M405 fault, inside
one compound.
- apply.js staleNows: a now with a recorded ground is stale when samePlace(nowAt, the page's ground) is false — the same
  matcher a place.set moves by (case, a leading "the", punctuation). The words check for nows written before M409 (no
  nowAt) keeps reading the first part of past grounds, as it must (it searches the now's own words). Whoever is here
  with no now is written by the world agent the same page (M409), so nobody is left without one.
- TESTS: M421-1 (the same place in any letters keeps the now; the move inside the HQ, which the ledger calls a move, lets
  it go). NEGATIVE-TESTED: the first-part rule fails it. Harness 825/825, walk 111/111, long play 8/8.
- version.js -> m421-001.

# M422 — a housekeeper card watches the entry its write lands on
M419's search for the same fault elsewhere (rule 8): the housekeeper's review of a pending card (ledgerSliceHash — has
the ledger slice this card touches changed since it was staged?) looked the slice up by EXACT name. Since M419 a card's
"body.injure Rukia" lands on "Rukia Kuchiki"; the review watched "Rukia" — nothing — so a change to her body under a
pending card was never seen.
- housekeeper.js ledgerSliceHash: bodies, standings, seats, truths, knowledge, factions and pages are found by
  apply.js personBookKey (now exported) — the finder the card's own write uses.
- TESTS: M422-1 (her body changing under a card about "Rukia" changes its slice; someone else's does not).
  NEGATIVE-TESTED. Harness 826/826, walk 111/111, long play 8/8.
- version.js -> m422-001.

# M423 — a near spelling is another person in every book (M419's new entries, corrected)
Found reading M419 again against the fold fuzzers' names ("Mara" and "Mira"): M419 wrote a NEW injury, standing or piece
of knowledge under "the name the person's page stands under" — found with findPersonKey, whose near spelling (one letter,
for a short name) is right for a misheard name on a PAGE and wrong for a hard fact. Mira's burned hand and her standing
landed on Mara, the innkeeper. M257 had ruled the same for seats ("seating is a hard fact"). The harness did not catch it:
the fuzzers check that a fold equals the writes, not who the writes are about.
- apply.js newBookKey: the page is found the way a seat is — the same letters, or the one matcher when exactly one page
  answers and the name means one person; never a near spelling (strictPageKey). The main character's entry the same way.
- TESTS: M423-1 (in m419.mjs: Mira's hurt, standing and knowledge are Mira's, never Mara's; "Rukia" still lands on Rukia
  Kuchiki's page). NEGATIVE-TESTED: the page finder's near spelling fails it. Harness 827/827, walk 111/111, long play 8/8.
- version.js -> m423-001.

# M424 — a fold replays the SAME batches the writes came in (a branch is exactly the story)
A new fuzzer (tests/harness/fold-fuzz-names.mjs) walks random pages of writes under every form of a name — ranks,
folded letters, "you", near spellings, "Oda's mother" — WITH the readers' chain's own upkeep between batches (the page
joins M406/M418, the book joins M419, the stale nows M405/M421), and folds the journal back to every page against what
the writes made. Checkpoints are kept only every third page, so most folds REPLAY the journal (a fold that hands back
each page's own checkpoint proves nothing — the first draft of this fuzzer did exactly that, and caught nothing).
- FOUND: foldJournal replayed each page's journal as ONE batch, while the writes came in several (the page reader, the
  chain's upkeep, the world agent, the scribe…) — and applyMutations ends every batch with a law of its own (M396: nobody
  in the scene keeps an elsewhere note). Run once instead of after each batch, the law judged a different moment: a seat
  the writes had let go ("Kuchiki" walked in, and was then joined to Rukia's page) came back in the fold. A branch, a
  swipe or a take-back would have handed him a ledger that was subtly not the story.
- apply.js: every journaled write carries its batch (b = the batch's turn). state.js foldJournal replays batch by batch in
  the order they were made; a journal from before M424 (no b) replays a page as one batch, as it did. The mark persists
  in the live ledger and in the checkpoint bank (checked).
- AND: a move that lets the main character's now go (M272) took the now and left its recorded ground (nowAt) behind; it
  takes both now, and a take-back of the move restores both (the take-back fuzzer holds it exact).
- The fuzzer compares both sides as the app holds them (saved and read back — loadState gives an absent now its empty
  string); comparing an unsaved ledger with a saved fold had reported that as a difference.
- TESTS: M424-1 (160 trials, 908 folds, the chain's joins between batches). NEGATIVE-TESTED: a fold that replays a page as
  one batch fails it (trial 57: the seat that came back); a chain write made without the journal fails it. The three
  older fold fuzzers pass. Harness 828/828, walk 111/111, long play 8/8; branchrefresh 12, holdsone 17, foldcrash 12,
  twohands 10.
- version.js -> m424-001.

# M425 — the record speaks of exactly the pages it claims: a squeeze merges only neighbours
A new stress test for the record keeper (tests/harness/record-fuzz.mjs): sixty random stories through additions,
deletions (the record slides), edits and swipes (a hole the keeper reads again), take-backs from a point and squeezes,
on the REAL keeper (maybeSummarize) with a scripted model that writes into every line exactly which pages it read — and
after every step every line is held to the pages under its span, and no page may be covered twice.
- FOUND: a squeeze merges a layer's two OLDEST lines into one spanning from the first's first page to the second's last.
  When those two were not neighbours — lines of another layer between them (an edit let a squeezed line go and its pages
  were read again as first-layer lines), or a hole — the merged line CLAIMED pages it was never written from: pages
  covered twice (and every later edit of one of them let a huge line go), or a hole never read again (a covered page is
  not due), the story-so-far quietly missing them. The random walk found it on its own (trial 24: a line over pages 6–23
  that had read six of them).
- memory.js maybeSummarize (promotion): the oldest pair in a layer whose pages MEET is squeezed — nothing between them
  but empty marker lines (pages that held nothing), which the merged line takes in and which leave with its sources;
  with no such pair the layer waits. Two neighbours squeeze exactly as before.
- Checked and sound: a deletion's slide, an edit's hole, a take-back's cut, holes read first, and a keeper that cannot
  read a hole runs no squeeze that turn.
- TESTS: M425-1 (a hole the keeper cannot read this run stays a hole and stays due), M425-2 (another layer's lines between
  the oldest two: the neighbours are squeezed, no page covered twice), M425-3 (an empty marker between two lines is taken
  in), M425-4 (the fuzz: 60 stories × 30 steps). NEGATIVE-TESTED: the oldest-two rule fails M425-2 and the fuzz; keeping
  the marker fails M425-3; a deletion that does not slide fails the fuzz. Harness 832/832, walk 111/111, long play 8/8.
- version.js -> m425-001.

# M426 — his words are never lost on the way out of Settings
Found by changing every Settings control in the real app and watching the store: the frame, its purpose line, the note,
the story's own frame and note, the brief and the cast notes are kept by their "Keep it" — and words typed there and
left by closing Settings were silently thrown away (checked: the next opening drew the boxes from what was kept, and
nothing had been). His frame and his brief are the words he cares most about.
- settings.js keepUnsaved (ctx.settings.onHide; app.js calls it when the Settings view is left): every box HE TYPED IN
  since it was drawn (an input event) whose words differ from what is kept is kept by its own "Keep it" — the same
  door (the brief's is held against the ledger, as its button does), for the story the boxes were drawn for and only
  while it is still the open one.
- ONLY WHAT HE TYPED: the first draft kept any box that differed from the store, and the full walk failed — a box drawn
  before another hand changed the kept words (a scenario's restore; in play, a housekeeper card on the brief or a name
  the ripple carries while Settings stands open) wrote its stale words back over them. A box never typed in keeps
  nothing.
- The connection form is not touched: its draft stays on screen when Settings closes (not lost) and saves with Save.
- TESTS: DOM-94 (a plain open and close keeps nothing; another hand's change while Settings is open stands; the frame,
  the note and the brief typed and left are kept and drawn back). NEGATIVE-TESTED: without the keep the typed words are
  lost; without the typed-only rule another hand's brief is overwritten (with ""). Walk 112/112, harness 832/832,
  long play 8/8.
- version.js -> m426-001.

# M427 — one story's canon never speaks in another
The audit of the canon bridge: the bridge lends the ledger's one matcher the other names canon knows (M396 — "Soi Fon"
is Suì-Fēng) for the story it last entered, through a module-level source — and nothing ever took them back. After his
Bleach tale, a tale with canon OFF still matched its people by Bleach's other names: one story's canon deciding who is
the same person in another (M399 made canon a story's own switch; its names were not).
- names.js setAliasSource(fn, storyId) and setAliasScope(getOpenStory): the lent names carry their story and are heard
  only while it is the open one (app.js hands the matcher the open story). With no story known (the harness) they are
  heard as before; a story's own chain finishing after he moved on simply matches without them (the safe way).
- bridge.js enterStory lends them with the story's id.
- TESTS: M427-1 (in the Bleach tale "Soi Fon" finds Suì-Fēng's page; in another tale it does not; with no scope, as
  before). NEGATIVE-TESTED. Harness 833/833, walk 112/112, long play 8/8.
- version.js -> m427-001.

# M428 — never redrawn under his fingers: the ledger and Settings leave a field he is typing in alone
- THE LEDGER: the workers write for many seconds after every page, and every write redrew the open room of the drawer
  (quietRender, at most every 1.5 s) — so words he was typing into a ledger field (a seat, a hurt, a standing, a rename,
  his standing notes for canon) were wiped mid-word, and on his phone the keyboard closed. drawer.js quietRender waits
  while a field words are typed into (a text input, a text area) holds the focus, and redraws once he leaves it (his
  notes save on leaving, as they always did). A tapped checkbox or menu does not hold it back.
- SETTINGS: a live sync from his other browser, or a shelf change, calls onStoriesChanged, which drew the frame, the note
  and the story's boxes afresh from the store — over what he was typing (and M426 then had nothing to keep). A box he
  typed in is never drawn over while Settings stands open; a box he kept with its own button is no draft any more (a
  later change by another hand is drawn, never written over); another story's boxes are drawn afresh; the drafts end
  when Settings closes (kept, M426).
- TESTS: DOM-95 (typing in a ledger field while the workers write twice past the wait: the same field, his words, the
  focus; the room catches up when he leaves it). DOM-94 grows a redraw in the middle of his typing (his frame and brief
  drafts stay on screen). NEGATIVE-TESTED: without the ledger's wait the field is redrawn away; without the draft guard
  the frame box is drawn back to the starter words. Walk 113/113, harness 833/833, long play 8/8, perf_rooms and
  perf_housekeeper within budget.
- version.js -> m428-001.

# M429 — a page he is re-inking is never redrawn away
M428's search for the same fault in the rest of the house (rule 8: every background redraw): the story's thread is
redrawn whole (renderThread) by things that are not his hand — a housekeeper answer whose cards land with re-inks
(refreshStoryFloor), a live sync from his other browser (sync.js paint), a shelf change (onStoriesChanged) — and a
whole redraw replaced a page he had open in the editor ("Re-ink this page"): the editor and every word he had typed
were gone. A worker's own write-back to the page (the masthead, the voices, the reader's words) only redraws its
receipt and never touched the editor — checked, and now held by a test.
- chat.js renderThread: while a page editor stands open, a redraw that is not his opening of a story waits
  (threadRedrawOwed) and runs the moment the editor closes, his words kept or let go.
- TESTS: DOM-96 (the editor open on the newest page; the world agent's write-back lands and a whole redraw is asked
  twice — the editor, his words and the focus stay; his words are kept and the page is drawn with them).
  NEGATIVE-TESTED: without the wait the editor is redrawn away. Walk 114/114, harness 833/833, long play 8/8,
  cutthinking, twobrowsers, perf_housekeeper green.
- version.js -> m429-001.

# M430 — a branch reaches the device whole and at once, never half
The one open item of the session's audit: tests/branchrefresh.py failed once in four runs ("the DEVICE holds the whole
branch — record and all :: NO RECORD ROW IN THE BOOK"). Watched while a branch builds, the cause is real, not the test:
- A HALF-MADE BRANCH WENT TO THE DEVICE. M332's law ("a branch still being made is nobody's book yet") was kept by the
  whole-book push (pushIds skips a `building` tale) and NOT by the page door: the first carried page found no book on
  the device, and the page's fallback pushed the half-made branch WHOLE — its pages, no ledger, no record. That is the
  book M332 exists to prevent (a browser that dies mid-branch leaves exactly it on the device). sync-worker.js: a page
  of a tale still being made sends nothing — no page, no fallback.
- THE WHOLE BRANCH WAITED UP TO TWENTY SECONDS, OR FOREVER. Letting go of `building` (its last write) only marked the
  tale for the twenty-second push — so whether the device held the record five seconds later was luck (the flake).
  sync.js now sends it at once — AFTER the write has landed: the store's hook runs as a write BEGINS, and the first
  version asked at once, read the row still `building` in the worker's own connection, held the branch back, and
  nothing asked again (tests/twobrowsers.py: the branch never reached the device). A push answer names the tales it held
  back (waiting).
- tests/twobrowsers.py's M295 check wanted the half-made branch on the device with its pages trickling into the log —
  the half-book M332 forbids; the page door had been making it pass. It now holds: while being made the device holds no
  book of it; whole, ONE whole book reaches the device at once with every carried page. tests/branchrefresh.py watches
  the device while the branch builds (no book, not half of one) and asks for the whole branch within five seconds.
- Also my own slip, caught by the tests before any commit: the first edit of the wrap left a stray ")" — the app would
  not have loaded. Every sync file is import-checked now before a run.
- NEGATIVE-TESTED: without the page door's guard the device holds a half branch (branchrefresh fails); asking for the
  push before the write lands leaves the whole branch off the device (twobrowsers fails). Twobrowsers 26, branchrefresh
  13 (5 runs green), holdsone 17, twohands 10, foldcrash 12, append 24, guard 13, wipe 11, backup 8, recover 3;
  harness 833/833, walk 114/114, long play 8/8.
- version.js -> m430-001.

# M431 — a connection he deletes stays deleted: the house's own notes about a connection never make it a browser's
The last open item of the audit: tests/twobrowsers.py failed three runs in a row, then passed three, same code ("a
connection let go in A is let go in B, live", "B's next push does not bring the let-go connection home", "nor to the
device"). Logged every write B made to its connections: in the failing runs B's own house had probed the spare connection
before A deleted it — update {viaRelay: true} (the web page refused the probe and the tavern's server carried it,
relay.js) and {identTriedFor, identTriedAt} (who the model is, detect.js). M293 set such bookkeeping apart
(PROBE_ONLY: "never makes the row this browser's") but listed only the ROOM probe's four keys. So B took the spare for its
own ("changed here since its last push"), kept it through his deletion, and its next push carried it back to the device
and to A: a connection he deleted came back. Timing decided it (whether B's probe ran first) — a real bug, not a flake.
- sync.js PROBE_ONLY: every note the house keeps about a connection on its own — detect.js (detected*, detectTried*,
  identFor, identTried*, modelHf, modelEfforts), relay.js (viaRelay), effort.js (learned*, reasoningDown*, prefillDown*),
  latesystem.js (systemAfterRefused*). A patch holding only these never marks the house and never makes the row the
  browser's; what the house learned rides the next push that comes (as M293 intended), and each browser relearns what
  it needs.
- tests/twobrowsers.py now makes B probe the spare BEFORE A deletes it (the losing order, every run) — with the old list
  it fails its three checks every time; with M431 26/26 (run twice).
- Harness 833/833, walk 114/114, long play 8/8; holdsone 17, twohands 10, branchrefresh 13, relay 11.
- version.js -> m431-001.

# M432 — a SillyTavern preset comes in as SillyTavern used it
The importers, read line by line (his "audit everything"). js/import/sillytavern.js parsePreset read each block's
switch from its FIRST mention across every prompt order in the file — and a preset carries two: 100000 (the old default,
only ST's own blocks) and 100001 (the global order ST's Prompt Manager uses). So ST's own blocks (the Main Prompt, the
jailbreak, NSFW…) were read as the stale order had them. And decompose never read the switch at all: every block he had
switched OFF in ST came in ticked — his old craft blocks straight into the storyteller's standing words.
- The global order (100001) is read when it is there, else the file's one order; a block in no order ST uses is not in
  its prompt and comes in off. A block switched off starts UNTICKED in the preview, marked "switched off in your
  preset" — shown, and his to tick; never brought in on.
- TESTS: M432-1 (the stale order never decides; off, on and orphan blocks; one order; no order). NEGATIVE-TESTED.

# M433 — an imported lorebook's first entry, and the housekeeper's cards on imported entries
- SillyTavern numbers a lorebook's entries from 0. updateLoreEntry / moveLoreEntry / removeLoreEntry refused an id that
  is falsy — entry 0 could never be edited, moved or removed from Settings.
- The housekeeper's lore card is reviewed before it lands against targets written as TEXT ("exists:lore:3") and compared
  with the entry's id by ===: an imported entry's id is a NUMBER, so every card on an imported lorebook read "that lore
  entry has gone from the story" and never landed. Compared as text now; entry 0 is a card target too.
- TESTS: M433-1 (entry 0 edited, moved, removed by hand), M433-2 (the housekeeper's cards on entries 0 and 1 land).
  NEGATIVE-TESTED both.

# M434 — a lorebook wakes as SillyTavern woke it
- The entry's title (ST's comment) is kept (it was dropped: entries showed only their keys).
- A key written as a regular expression ("/rukia|kuchiki/i") is read as one (it was read as its letters, and never woke).
- Secondary keys decide by the entry's own logic — only when it is selective, and by selectiveLogic (AND ANY, NOT ALL,
  NOT ANY, AND ALL); every entry was read as AND ANY, so one he wrote to stay out when a word is present came in exactly
  then. Exported back to a worldbook the same way.
- TESTS: M434-1 (each logic, a regex key, a not-selective entry, the title, the round trip). NEGATIVE-TESTED.
- Harness 837/837, walk 114/114, long play 8/8. version.js -> m434-001.

# M435 — a card's own {{char}} is its own person, {{user}} the one he plays
A SillyTavern card is written "{{char}} is {{user}}'s older sister". Its description, personality and scenario went to
the storyteller as they came (the "Who's here" slot), and its greeting became his story's first page as it came —
template syntax on his page and in the storyteller's head, the thing M361 took out of his standing words.
- voice.js withCardNames(text, cardName, voice, nobody): {{char}}/<BOT> is the CARD's person; {{user}}/<USER> the main
  character's story name, else his own name, else the caller's words ("the main character" in the slot, "you" on the
  greeting page). Replacements by function (a name is never read as a $-pattern) — withMacros too.
- stack.js slot 4 (description, personality, scenario of a present card) and drawer.js (the greeting offered as the
  opening page) pass through it.
- TESTS: M435-1 (the request builder hands the storyteller "Rias is Jovan's older sister", no template syntax anywhere),
  DOM-97 (a card invited into an empty tale opens it with "Rias waves at you"). NEGATIVE-TESTED both.

# M436 — a V3 card picture is read
cards.js read a picture's character only from the "chara" chunk; a V3 card (chara_card_v3) carries it in "ccv3", and
tools that write only that chunk made a picture that "doesn't carry a character". ccv3 is read first when a picture holds
both (the fuller); chara otherwise.
- TESTS: M436-1 (real PNG bytes: V2 alone, V3 alone, both, a damaged chunk). NEGATIVE-TESTED. The card picture reader had
  no test at all before.
- Harness 839/839, walk 115/115, long play 8/8. version.js -> m436-001.

# M437 — a SillyTavern chat comes over whole; an imported lorebook entry is found by its number
The two concerns the last reply left recorded, fixed (his rule: a recorded concern with a fix available is fixed).
- import/chats.js + store.js appendAll: only the SHOWN words of each SillyTavern page came over. A reply's other versions
  (its swipes) come now as the page's own (◂ ▸ walk them), the shown one shown — its words the page's even when he had
  edited them in ST after the swipe — and the thinking ST kept for it (extra.reasoning) rides the page. ST's own date
  spelling ("June 1, 2024 3:04pm") is read (it failed to parse, and the pages took the hour of the import).
- housekeeper.js findEntry: an imported lorebook entry named by its NUMBER ("entry": "2") is found (the id was compared
  by === with the model's text).
- Also checked (rule 11): everything the housekeeper's instructions say it sees reaches its context — the brief, the cast
  notes, the pages, the ledger (people's pages, hurts, knowledge, threads, elsewhere, canon locks, the clock), the record,
  the lore shelf, the rulebook's names.
- TESTS: M437-1 (swipes, the shown one, his edit kept, the kept thinking, a one-version page plain, ST's dates, the file's
  order — through the real import and store), M433-2 grows an entry named by its number. NEGATIVE-TESTED both.
  Harness 840/840, walk 115/115, long play 8/8.
- version.js -> m437-001.

# M438 — the housekeeper's take-back, held by a test (no change to the code)
Audited the housekeeper's apply and take-back as one round trip: two answers (the brief, the cast notes, a person's page;
then a lore entry added and one changed, and a thread) applied through the real apply-all, then taken back one card at a
time — the second answer's changes first, leaving the first answer exactly; then the first, leaving everything exactly
as it was; then "nothing left" said. It held on the first run — no bug — and M438-1 now keeps it so. Harness 841/841.

# M439 — the house reads its models' answers the ways models actually write them
The housekeeper's block reader, fuzzed with the ways models mangle a block:
- ONE CARD WRITTEN BARE WITH A LIST INSIDE IT ({"add":true,"keys":["A"],…}) was read as its inner ["A"] — tolerantJson
  took the LAST balanced array in the block — and the card came out "unreadable". The block's own first bracket decides
  now: an object that opens the block is read as the object when it reads; an array as before. A list wrapped in one
  named field ({"lore":[…]}) is that list (the old reader found the inner list by accident; kept on purpose).
- A BLOCK TYPED IN CURLY QUOTES (“add”: true) was unreadable. With no straight quote anywhere, the curly ones are the
  delimiters and are read as such; a block with straight quotes keeps its curly ones as words.
- SAME FAULT ELSEWHERE (rule 8): the workers' shared reader (jsonutil parseFirstObject — the ledger's reader, the world
  agent, the auditor, the director, canon…) took no curly quotes either; the scene sensors (sensors.js readAnswers) and the
  record's checker (memory.js parseVerifyAnswer) used plain JSON.parse — one trailing comma or a fence and the whole
  reading was thrown away. All read forgivingly now.
- Checked, no change: every thinking level lands on one each model family accepts and each model declares, never climbs,
  never turns a level into Off; duels (18,000), group fights and wars fuzzed through the real engine end, keep sane
  numbers and come out even when the sides are even (an unnamed enemy is "trained", 4, by design; an unnamed ally the
  default 5).
- TESTS: M439-1 (the housekeeper's reader), M439-2 (the workers', the sensors', the record checker's). NEGATIVE-TESTED.
  Harness 843/843, walk 115/115, long play 8/8, housekeeper rounds green.
- version.js -> m439-001.

# M440 — the storyteller's rulebook keeps no quota on real life either
Read the whole shipped rulebook (craft.js, ~11,000 words) for contradictions with the house and with his standing
rules. One found: "The World Reaches In" still told the storyteller that strangers reach in "at most one per scene and not
every scene" — the very quota M366 took out of the world agent's brief ("why make everything gamey?"). Now: each stranger
from their own reason and the place as it is (a busy market can send several, a quiet street none), never on a timer,
never to fill a scene.
- HIS OWN EDITED COPY: a rulebook he has edited keeps his words; the house's rejected sentence, where it stands in his copy
  verbatim, is read with the shipped correction (modules.js withoutQuotaLines, at read time — nothing of his is written
  over, nothing else touched).
- Also checked, no change: every command the rulebook names exists in commands.js; the Pass's "in shorthand" notes are
  turned into natural thinking for a teller with a self (M335) and kept for one without; the rulebook's other "at most"
  lines are prose craft (metaphors, gags, private thoughts, one readable object per page), his preset's own
  Information-Quarantine cap on noticing, and the house's one window beyond the page — not quotas on the world's life.
- TESTS: M440-1 (what the storyteller is sent), M440-2 (his edited copy read with the correction, his own words intact).
  NEGATIVE-TESTED both. Harness 845/845, walk 115/115, long play 8/8.
- version.js -> m440-001.

# M441 — the housekeeper's sessions, newest-used first
His rule 14: activity lists sort by recency, not by internal order. The housekeeper's session picker listed its
sessions in the order they were made. listSessions now sorts by when each was last used (its latest turn; a session never
spoken in, by when it was made; one kept from before the stamp, by its number). The made-at stamp is written with a new or
branched session — and the shelf's load and save kept only id, name and turns, so the stamp was dropped both ways; both
carry it now. Checked the other lists: the stories are last-active first, the ledger's "What changed" newest first.
- TESTS: M441-1 (the one talked in last first, then the newest made, then the old). NEGATIVE-TESTED. Harness 846/846,
  walk 115/115, long play 8/8, housekeeper rounds green.
- version.js -> m441-001.

# M442 — a change never lands under a housekeeper answer still coming
Read the housekeeper's screen and its turn: housekeeperTurn loads the talk (the session: cards, their states, the take-back
record) when the ask starts and SAVES IT BACK when the answer lands. The screen let Apply, Apply all and Undo run while
an answer was in flight (they checked only for another change landing) — so a take-back pressed meanwhile reverted the
story, and the answer then wrote the talk back as it had found it: the change still recorded as standing, its take-back
record lost, and a second Undo taking back what was already gone. The same held the other way: an ask begun while a
change was still landing loaded the talk before the change was recorded.
- ui/housekeeper.js: turnInFlight is true exactly while housekeeperTurn runs; Apply, Apply all and Undo say "Wait for the
  housekeeper to finish — its answer is still coming" then (only then: the moments after, while the screen draws the
  answer, his clicks work). Every ask (and the director's and the editor's) first waits for a change still landing, then
  checks again that no other ask began meanwhile. The landing on arrival (cards as they arrive, M96) counts as a change
  landing, so his own click meanwhile waits its moment instead of racing it.
- A first cut guarded the whole busy spell and DOM-11c failed (his Apply on cards drawn a moment before the spell ended
  was refused); narrowed to the answer in flight.
- agents/housekeeper.js: an answer's notes about withdrawn cards no longer wipe its note about cards set aside (= → +=).
- Also read, no change: the housekeeper's loop can go round again only on one-time nudges, fetch rounds capped at three,
  and two thinking retries — it always ends; the director's status, ideas and steer are handed what their instructions
  name (the directive, the brief, the ledger, the latest pages), and a thinking connection's small answer room is raised
  to the thinking floor by the connection (M376).
- TESTS: DOM-98 (Undo while an answer is coming waits; after it lands, Undo takes back exactly once). NEGATIVE-TESTED.
  Harness 846/846, walk 116/116, long play 8/8, housekeeper rounds green.
- version.js -> m442-001.

# M443 — the housekeeper screen, read line by line: what is his is kept
The last part of the audit: js/ui/housekeeper.js read whole (the talk's drawing, cards, the send flow, the director's
tools, the sheet). Found and fixed:
- THE DIRECTOR'S WORDS WERE WIPED. Its status, its three episode seeds, a re-aim, standing down were drawn as bubbles that
  belonged to nothing — the next redraw (an Apply, a swipe, reopening the sheet, a page landing) wiped them, the three
  doors gone before he chose one. Kept now per tale (hkNotes:<tale>, the last twelve), drawn at the end of the session
  they were asked in, never sent to the housekeeper, let go with that session's talk.
- THE BACKGROUND REFRESH REDREW OVER HIM. On every story change (every page, as the readers write) the open sheet re-read
  the talk and redrew it — wiping the words in a card's "Edit by hand" box, and swapping the talk out from under a change
  still landing (its save then wrote the re-read talk, without that change, over the store). It waits now while an answer
  is coming, a change is landing, or a hand edit stands open, and runs the moment they are done.
- AN ANSWER THAT LANDED AFTER HE MOVED ON never landed its cards: with cards set to land on arrival, an answer finishing
  while he had opened another tale (or session) returned before landing them. It is settled where it was asked now —
  cards landed and thinking kept in the session that asked; the loose-anchor re-ask is sent only from there.
- EVERY HAND ON THE TALK WAITS ITS TURN: Skip, Set all aside, a turn's ✎ ↻ ✕ ◂ ▸ and the session shelf wrote the talk
  under a change still landing or an answer in flight (M442's race, by another door). A change still landing is waited
  out (a moment — never refused: Apply and Undo clicked as a card lands now go through, which DOM-11c caught refused in
  a first cut); an answer in flight still says to wait. A refused session switch puts the picker back on the open
  session; a session gone meanwhile leaves the open one open (it crashed the drawing).
- His own words go back in the box when an ask fails (it put back the command's long expansion); an answer's version
  number is kept inside its versions (never "4/3").
- TESTS: DOM-99 (the three doors survive a redraw and a reopen; a hand edit survives the story settling; an answer that
  lands after he opened another tale lands its card in the tale that asked). NEGATIVE-TESTED each part separately.
  Harness 846/846, walk 117/117, long play 8/8, housekeeper rounds and perf green.
- version.js -> m443-001.

# M444 — who is here heals itself: the room restated every page, leaving as strict as entering, the scene's place whole
He: in his Bleach story every NPC stood at Oda's location; Rukia, who was with him, was put "elsewhere"; the next scene,
where he expected it to heal, her banner read "whereabouts not yet written" while her own "now" was right.
FOUR ROOTS, each reproduced on the real engine before any change:
- THE COMPOUND WAS THE SCENE. M396/M402 judged "is this seat where the scene is?" on the place's FIRST PART. Since M410
  the header's place is the whole place ("13th Division Barracks — Captain's Office"), so the first part is the
  compound: the world agent seating Kiyone in "13th Division Barracks — the third seats' office" and Sentarō in
  "…, the training yard" walked both into the captain's office (probe: Who's here = Jovan, Rukia, Kiyone, Sentarō).
  apply.js seatAtScene: every part of the scene's place must be named in the seat (any order and punctuation, plurals
  and possessives aside; a part after in/at/inside/within/of, or opening the seat's part with where-in-it words after
  it); named after outside/near/to/behind, or run on into another place ("the Bluebird parking lot"), it is not the
  scene; a one-word place or a lone town/city/district is no one spot (M396's measure, kept).
- ANOTHER KUCHIKI TOOK HER OUT. presence.leave/update matched loosely ("only someone here can leave" — M414 made only
  entering strict). Byakuya, in the scene but not written in, left as "Captain Kuchiki" (or "Kuchiki", "Kuchiki-taichō")
  and the one Kuchiki written in — Rukia — stepped out and got "last seen at" the very office she stood in. Both are
  strict now; the refusal says the name could be more than one person. auditor.js auditorScope's "already here?"
  asks strictly too ("Captain Kuchiki" walking in is not Rukia already here).
- CLEARED WAS NOWHERE. The world agent is told someone the page shows arriving is the page reader's to write in and its
  own to clear the note of; the auditor was told "offscreen.clear". When the page reader had missed her, the note went
  and she stood nowhere. apply.js clearsThatArrive: a worker's offscreen.clear of someone the page's telling names as
  themself (shownOnPage — whole name, or a word of it no one else the ledger knows shares; narrationOf drops spoken
  lines; scenePartOf drops the window), not here, one meaning, not re-seated in the same answer, is presence.enter —
  in the page reader, the world agent and the auditor (converted on the finding, so its report says what landed).
  The auditor is told presence.enter for this case now.
- NOTHING RESTATED THE ROOM. Presence was kept only by changes, and the page reader is told only the new page is news,
  so a person who never "walked in" (she was there all along) was never written back. The mood board has been restated
  whole every page since M47/M92 for exactly this. The page reader now answers "here" too (extractor.js
  hereFromBoard): whoever it names that "Here now" lacks walks in when the telling names them as themself and the name
  means one person; the main character is written in when missing; nobody is ever taken out for being left off. The
  house's own entries say why in What changed and why ("— the page shows them here").
THE LEDGER HE HAS: apply.js wrongWalkIns, run by the page reader's upkeep job (chat.js, after the stale nows): a present
person whose last whereabouts in the journal is a seat the new test says was NOT the scene (the ground then read from
the journal), and whom no story page since has named in its scene part, leaves and is seated where the world had them
(journaled, undoable; never the main character, never someone a page or his hand put there; a bare family name in the
journal is never taken for one sister).
ALSO FOUND: M259-21 measured the page reader's view against a room 4,800 characters too small (answer budget 4000; the
reader's is 2400 since M37) and held by 246 characters until the reader's law grew. Measured against its own room now
(EXTRACTOR_MAX_TOKENS exported); and the page index — lines for the pages that did not fit — was never counted inside
the 70% view (lookup.js windowOfPages keeps room for every older page's index line before taking a page whole).
TESTS: m444.mjs (8): another Kuchiki's leaving (four forms) never takes or moves Rukia and says why, her own name does;
another room of the barracks stays elsewhere, the office in any wording walks in, outside it does not (14-row table);
the room restated through the real page reader on a scripted model (only Sentarō written back — not Renji in a spoken
line, not Kiyone in the window, not "Kuchiki", not Byakuya named only as Kuchiki-taichō; quiet Iba stays); the world
agent's clear of Renji walking in is his entrance, Byakuya named only in dialogue is let go; the auditor's clear is an
entrance and its scope is strict; the heal (Kiyone back to her office, Sentarō shown since stays, Isane seated in the
office stays, a "Kotetsu" seat is neither sister's, two take-backs restore it); named as themself; the index inside
the view. Walk DOM-100: his office played through the real app's readers — Rukia here, Sentarō written back, Renji
here, Kiyone elsewhere, the drawer's banners say so. NEGATIVE-TESTED: thirteen breaks of the harness laws, each failing
its own test; four breaks against DOM-100 run alone, each failing with his exact symptom (Rukia missing, Kiyone in the
office, Sentarō lost, Renji nowhere); the old window against the index check.
Harness 854/854, walk 118/118, long play 8/8, lint 0 errors (no new warnings against m443).
- version.js -> m444-001.

# M445 — one home for a canon fact, kept: the canon tidy can clean his pages, and the world agent stops refilling them
He asked whether canon verification is efficient and free of what the ledger already says. MEASURED through the real app
(his Bleach office, canon on, his real Rukia and Kyōraku cores): the briefing said every canon fact TWICE — Sode no
Shirayuki, Katen Kyōkotsu (three times), the pink flowered kimono, wavy brown hair, violet eyes, "adopted", "proud
noble" — once on the page's core ("On their mind"), once in canon's own note or "What's true of them". Canon's note
itself was right (it drops Appearance where the ledger holds the face, M387); the pages were not.
- THE ROOT: M388's tidy (agents/canontidy.js) flagged both cores and refused even a PERFECT answer: its "nothing of the
  story lost" counted every word of the old core that the record's short summary lacks as the story's — canon's own
  details ("150+", "slender", "shihakushō", "lean", "promoted") — and a refusal was memoed as asked, for good. Proven:
  cleanCoreHolds(his core, a right answer) → "it dropped what the story made of them (150, slender, standard, shihakusho)".
- THE LAW NOW: given the story's own material — his brief and cast notes, the record, the pages not yet folded (chat.js,
  the tidy job), and the person's arc and loose ends — a word is the story's when the story says it; canon's other
  details may go; nothing may be added; without material the M388 law stands whole. A fresh memo (cozy_canon_tidied2):
  every flagged core gets a look under this law, a refusal is looked at again up to three times, only an accepted core
  is done.
- THE SOURCE: the world agent, handed the record (canon on), was told a canon character's role and life "are these" and
  to write a one-line core — so every canon newcomer's page was born repeating canon. Handed the record, it is now told a
  core for such a person says who they are to THIS story (place here, tie to the people here), never looks, powers or
  past. The scribe was already told (M387).
- MEASURED AFTER (same app, next page): each of those facts once; the briefing 2,854 → 2,208 characters; the page keeps
  "expected the captaincy and was passed over for Oda". "Captain-Commander" stays twice (his core's anchor and canon's
  fact) — one word, left.
- ALSO MEASURED, NOT CHANGED: with canon on, before the storyteller is asked on a first meeting the house makes canon's
  scene read, its wiki look-ups for new names and one lens read per person per premise (the extension's own windows:
  2 s, 12 s on a first meeting, the lens 15 s); the note itself is about 500 characters a person plus its opening.
- TESTS: m445.mjs M445-1 (his real core: refused under the old law, accepted with the story's words; a story fact dropped
  still refused; nothing added; an old M388 memo no longer blocks; a refusal looked at again; three refusals and it
  stops). M388-1/3 now read the new memo (the old law's "asked once, for good" was the fault — said in the tests).
  Walk DOM-101: canon on, two pages through the real app — twice before, once after, shorter, his words kept.
  NEGATIVE-TESTED: the material ignored, the old memo, no retry, endless retry (harness); the chain not handing the
  material (DOM-101 fails: the tidy never cleans her page — the state his story is in).
Harness 855/855, walk 119/119, long play 8/8, lint 0 errors (no new warnings).
- version.js -> m445-001.

# M446 — a leaving is what the page ends on
He: Byakuya never left the scene — Byakuya is here; Rukia is put "elsewhere" while her now is accurate.
- So M444's first cause (another Kuchiki's leaving) was not his. The other door that puts a present person "elsewhere"
  with a TRUE now: presence.leave writes "last seen at <the ground>" — the very office she stands in, which reads as an
  accurate now. The page reader could take someone out whenever the page merely NAMED them (M402's whole test): a step
  out for the rosters and back, a walk to the window, or a slip in its answer took her out and nothing wrote her back.
  Reproduced through the real app (DOM-102 with the guard removed: Who's here = Byakuya, Jovan — Rukia gone).
- THE LAW: engine/apply.js goneAtTheEnd(state, page, name) — the LAST sentence of the scene (before any window) that
  names the person as themself (shownOnPage: never a family name another person shares), with the pronoun sentences
  straight after it when neither names anyone else by name or by rank ("Rukia glanced at Kuchiki-taichō. He left." is
  his), narrates them going (showsDeparture — moved from the auditor into the engine; auditor.js re-exports it). The
  page reader's leave stands only then (extractor.js extractTurn), EXCEPT when the page moves the ground (its header, or
  its own place.set; a header naming less of the same place is no move): there the scene leaves people behind with no
  word of their own going (M304's Ms. June), and a leave stands unless the answer's "here" lists them.
- THE AUDITOR: its permission to take someone out (M403/M413) read any sentence of the last two pages (a player page
  among them) that named them and had a going in it — "Kuchiki-taichō left" gave it Rukia. Now the newest STORY page that
  names them as themself decides, by goneAtTheEnd; the eight silent pages rule stands.
- TESTS: m446.mjs (4): the reader of a going (out and back, across the room, bowed and left, another Kuchiki, pronoun
  follow-on, spoken words, a "he" after another named by rank or by name); the page reader's leave through the real
  extractor on four pages; the auditor's on two; a moved ground leaves Ms. June behind, keeps whoever the room lists.
  Walk DOM-102: Rukia steps out and back, the page reader writes her leaving — she stays, no note, Byakuya stays, the
  drawer says both are here. DOM-49 (M304's left-behind) held after the moved-ground rule (it failed without it).
  NEGATIVE-TESTED (9): no guard; the auditor's old sentence rule; no pronoun follow-on; a greedy follow-on; the first
  going kept over a later return; the move ignored; every page a move; a less specific header taken for a move; the
  room's "came along" ignored — each failed its own test; DOM-102 failed without the guard with his exact symptom.
Harness 859/859, walk 120/120, long play 8/8, lint 0 errors (one warning's line number moved: 385 → 386).
- version.js -> m446-001.

# M447 — who is where is never mended: the second reader stops rewriting pages to follow a wrong ledger
Found while checking M446 against his report (Rukia "elsewhere" while the page had her in the office).
- THE FAULT: the second reader (agents/continuity.js) was told "a person present who the ledger says is elsewhere with
  no arrival on the page" is DRIFT, was shown every seat, and a warn with a fix MENDS THE PAGE (chat.js mendAround).
  So a wrong ledger — a leave that should never have stood, a seat the world agent guessed — was written INTO his
  story: proven through the real app, the mender deleted "Rukia waited, arms folded." from the page that showed her
  there. M357/M372's law (the page is the story; a ledger error is the ledger's to heal) had a door open in the reader
  that watches for drift.
- THE LAW NOW: the second reader is shown who is here by name and what is locked, never where the absent are (the
  seats are the world's moving state); its law says who is where is the page's — never a finding. In code, whatever it
  writes: a finding that holds the page to the ledger's whereabouts ("the ledger has her elsewhere", "she should not
  be here") is let go (whereFinding); one about who could know — someone away when a thing was said — stands (M338).
- M259's line that the second reader is shown "where the absent are" now says the opposite, with the reason.
- TESTS: m447.mjs (2): the reader's request carries no seat and the law says so, a lock still binds; on a scripted
  reader, two whereabouts findings are let go, who-could-know (even beside "the record") and a locked eye colour stand.
  Walk DOM-103: the ledger has Rukia elsewhere, the page shows her, the reader asks for a mend — the page stands word for
  word and the mender is never asked. NEGATIVE-TESTED: without the guard DOM-103's page is mended (her line deleted) and
  M447-2 fails.
Harness 861/861, walk 121/121, long play 8/8, lint 0 errors (no new warnings).
- version.js -> m447-001.

# M448 — what the series says is never a reason to mend his page
Found auditing every door that mends a page (after M447).
- THE FAULT: the second reader and the record's checker (memory.js verify → canonRecord) were handed EVERY locked truth,
  the series' own among them (canon.lock with source 'canon': canon's hair, eyes, height, look) — unmarked, and told
  locked truths outrank a page; both findings MEND pages. His canon stories leave canon on purpose; a page that cut
  Rukia's hair ("cropped short since the war") stood against the wiki's "chin-length" and could be mended back — while
  canon's own note tells the storyteller "where our story has made something otherwise, our story wins".
- THE LAW NOW: both readers are shown his truths, the brief's and the readers' — never the series' own. And the auditor
  is told a face the series gave that the pages have plainly changed in this story is relocked to the pages
  (canon.lock, a non-series lock — apply.js never lets the series write over it, M386). Every mend door, audited:
  keeper's checker (brief + his truths), second reader (his truths; never whereabouts, M447), the auditor's brief
  wins, the eye's glitch, the ripple of his own edit — none rests on the ledger's moving state or the series.
- TESTS: m448.mjs (3): the second reader's request carries his truth, not the series' face; the record checker's the
  brief and his truth, not the series'; a face relocked by the story stands and the series cannot write its own over it.
  NEGATIVE-TESTED: each filter removed fails its test.
Harness 864/864, walk 121/121, long play 8/8, lint 0 errors (no new warnings; three old ones' line numbers moved).
- version.js -> m448-001.

# M449 — a guard asks the question its writer will: the last exact-name look-ups that mattered
Found by searching the whole engine and the agents for person names compared by exact lower case (the law since M396).
- THE AUDITOR COULD TAKE AWAY AN EARNED STANDING (M48 says it never may on judgment): its guard found the standing by its
  EXACT key, while the applier writes a person's book under any form of their name (M419). Proven on the real auditor:
  a rel.set for "Rukia" saw no standing, was not "lowering", and zeroed Rukia Kuchiki's P:15 earned on the page. The
  guard now resolves the key as the applier will (apply.js personBookKey with the standings' own finder). Held under
  "Rukia Kuchiki", "Rukia" and "Kuchiki Rukia".
- THE PEOPLE TIDY DROPPED ITS OWN ANSWERS for a page under a fuller name (tidy.js tidyMutations — exact key only): an
  answer for "Rukia" wrote nothing on Rukia Kuchiki's page. Exact first, then the page finder.
- WHAT THEY HAVEN'T FOUND OUT (engine/world.js blindSpots): the main character was skipped by exact lower case — "Oda"
  in the scene got blind spots the writer owns; and a person's own lines under another form of their name counted as
  someone else's ("Rukia hasn't found out … (Rukia knows)"). Both by the one matcher now.
- THE REST, READ: every other exact comparison in js/engine and js/agents is exact-first with a matcher after
  (findPresent, seatForPerson, carriedBy, peopleHousekeeping, the housekeeper's presence slice), or not a person
  (modules, lore entries, the referee's units), or already backed downstream (whole.js nearNames → leanPage's isHere).
- TESTS: m449.mjs (3): the auditor's zeroing refused under three forms of her name; the tidy writes on her page; blind
  spots by the one matcher. NEGATIVE-TESTED: the exact guard, the exact tidy, the exact main-character skip and the
  exact own-lines skip each fail their test.
Harness 867/867, walk 121/121, long play 8/8, lint 0 errors (one old warning's line number moved).
- version.js -> m449-001.

# M450 — who could know this is read against the story, not only the ledger
The last page-mending door that stood on the ledger's own state (after M447's whereabouts and M448's series truths).
- THE FAULT: the second reader's UNTOLD KNOWLEDGE (M338, his own request) warns when a character states what they have
  not been shown learning, and its warn MENDS the page. "Not shown learning" was the ledger's blind spots, computed from
  the knowledge lines — and the reader saw only this page. A telling the page reader missed writing down (Oda told
  Kiyone and Rukia; only Rukia's line written) made Kiyone's true mention look untold, with nothing in front of the
  reader to say otherwise.
- THE LAW NOW: the second reader is handed what the other readers read — the record and the pages before this one,
  whole into its room (memory.js storySoFar, as the page reader gets it; chat.js passes them, with the leash's renew
  for the longer reading) — and told the ledger's lists can miss a telling: when the story so far shows them learning
  it, they know it, and there is no finding. His M338 guard against tellings that never happened stands.
- TESTS: m450.mjs (2): the reader's request carries the record and the earlier page, and the law says the ledger can
  miss one; on the wire, checkTurn sends them. Walk DOM-104: through the real app the earlier telling reaches the
  second reader. NEGATIVE-TESTED: the chain not passing the story (DOM-104 fails), the reader not sending it (M450-2).
Harness 869/869, walk 122/122, long play 8/8, lint 0 errors (no new warnings).
- version.js -> m450-001.

# M451 — who is here is said once in what the storyteller reads
Measured through the real app (a turn sent, every message read): the system's "Who's here" block said "Here right now:
Jovan Oda, Rukia Kuchiki, Shunsui Kyōraku." and the notes that open the story said "Here now: …" — the same names twice
on every page, against his "no redundancy, no context bloat".
- THE ONE HOME: the notes (engine/state.js renderStateFacts "Here now:", shed 0 — never dropped for room) keep it, with
  where each stands and what they wear. assemble/stack.js's slot 4 keeps the cast notes and the cards of whoever is here
  (still filtered by who is present); its receipt says "cast notes, and the cards of X (here now)".
- MEASURED: roles and order unchanged (system, the notes, the history); the names once; the system message 78,240 →
  78,180 characters in his office scene.
- TESTS: m451.mjs M451-1 on the real builder (the list once, with her position; never "Here right now"; a present card and
  the cast notes still ride). NEGATIVE-TESTED: the old line back fails it.
Harness 870/870, walk 122/122, long play 8/8, lint 0 errors (no new warnings).
- version.js -> m451-001.

# M452 — the ledger heals by itself when a story opens and after every page: nothing to press
He: "Isn't read the page again and continue the next scene basically the same? My philosophy is always autonomous and I
don't need to think about anything. If the agent doesn't know what's wrong or self heal then this isn't smart."
- He was right: I had told him to press "read again" for a wrong the house can SEE. The difference between the two was
  only timing (read again mends the ledger before the next page is written; continuing writes one more page from the
  wrong ledger) — and neither should be his to think about.
- THE HEAL, IN CODE, NO MODEL (engine/apply.js hereByTheNewestPage): a seat that puts someone elsewhere AT the very place
  the scene stands — the house's own "last seen" there (samePlace to the ground), or a seat at the whole place
  (seatAtScene) — for someone the newest story page's telling names as themself (shownOnPage on narrationOf(scenePartOf)),
  not ending on them going (goneAtTheEnd), not the main character, one meaning, not on their way in: presence.enter, cause
  "the page shows them here" (journaled; the note lets go). A note at another room is the page reader's to judge.
- WHEN: chat.js healLedgerOnOpen — on openStory (after repairTimeline and resumeUnfinishedChain; a resumed chain heals in
  its own upkeep) and at boot (app.js, the active story); never while busy, replaying, a chain queued or running,
  another browser's readers at it, or on a story made in the last minute. And in the page reader's upkeep job on every
  page, beside wrongWalkIns (which the open heal runs too).
- TESTS: m452.mjs (2): his stuck ledger healed from the newest page (and nothing left to do); never on less — not named,
  a spoken line, a shared family name, a going at the end, a note at another room, someone on the way in. Walk DOM-105:
  his stuck ledger, the story OPENED the way the shelf opens it — nothing pressed, no model asked — Rukia here, the note
  gone, the page untouched, said in What changed and why. DOM-106: a page reader that writes nothing of who is here, and
  the chain still heals her. NEGATIVE-TESTED: no open heal (DOM-105 fails), no chain heal (DOM-106), no heal (M452-1).
Harness 872/872, walk 124/124, long play 8/8, lint 0 errors (one old warning's line number moved).
- version.js -> m452-001.

# M453 — the ground never goes back to an old page's, and an echoing header never holds a wrong one
He: Rukia "elsewhere" while she stood on the 10th Division courtyard with him — her "now" (the world agent's seat) said
exactly that; and the header banner, right until the duel began, then "suddenly" 1st Division HQ — outside the assembly
hall, and every page after it followed.
- WHY RUKIA: the ledger's GROUND was the assembly hall, so a seat at the courtyard was "elsewhere", and nothing could
  call her here. The ground was the fault.
- ROOT 1 — A PAGE READ OUT OF TURN MOVED THE MOMENT: the light's catch-up (chat.js fillLedgerGap → readMissedPage) sends
  the page reader to a page no read reached, and its answer landed whole on today's ledger — the old assembly page's
  header (the ground, M128's "place.set when it moved") and its people. Reproduced through the real app (DOM-107 with
  the guard removed: the duel's ground became "1st Division HQ — outside the assembly hall"). Now a page older than the
  newest lands only what lasts (apply.js lastingOnly): knowledge, wounds, standings, closed threads, time passed — never
  the ground, the hour, presence, the mood or seats (M131: the moment is the newest page's).
- ROOT 2 — THE LOOP: the storyteller is told the ledger's ground is canon, writes it into its header, and the header
  sets the ground (M128/M409) — a wrong ground held itself forever, and M403 forbade the auditor any move off the
  header. Now an ECHOING header (silent, or repeating the ledger's ground) does not hold a ground the telling has left:
  the auditor may set the ground to where the page's telling stands (its law says so), held in code by
  apply.js groundTheTellingStandsOn — the header names no new place, the telling (header line set aside) never speaks
  of the ground's own words, and does speak of the proposed place's own spot. M403's wrong move (the courtyard pulled to
  the assembly hall while every page named the courtyard) is still refused (M453-3).
- ON OPEN: a newest page whose telling never speaks of the ground (apply.js groundLooksStale, a page of twenty words or
  more) asks the auditor quietly, before he writes (chat.js healLedgerOnOpen, after M452's code heals).
- TESTS: m453.mjs (3): what lasts from a page out of turn; the echo rule's four cases; the auditor run whole — back to the
  courtyard under an echoing header, M403's move still refused. Walk DOM-107: an old assembly page read late in the
  real app — the ground stays the courtyard, the assembly's Kyōraku stays out, what the old page taught lasts.
  NEGATIVE-TESTED: the out-of-turn guard removed (DOM-107 shows his exact regression), the echo rule held (M453-3).
Harness 875/875, walk 125/125, long play 8/8, lint 0 errors (old warnings' line numbers moved).
- version.js -> m453-001.

# M454 — the pages the ledger missed are read in one go, and the banner counts them to the end
He: "does the yellow indicator always restart or what? why it keeps pulsing yellow? … even it's not manual it should
always have banner 100% process", under "◐ the extractor … stopped partway — read 3 of the pages the ledger missed — the
rest follow".
- WHY YELLOW: the light's repair (chat.js fillLedgerGap) read THREE missed pages a run, said "stopped partway" (the
  amber light), and the light sent it again a minute later — for as long as the backlog lasted, with no count anywhere.
  Reproduced in the walk: five missed pages were not done in thirty seconds with the old cap.
- NOW: page after page in one run while the house is idle; the moment the storyteller works it stops (M314) and carries
  on by itself after. The work banner (the one every manual action uses) counts it: "Reading the pages the ledger missed
  — page 3 of 5 · 60%", then "The ledger has read every page — done" at 100%; a pause says so and clears itself
  (workbanner.js paused); a failure says how far it got and that it tries again by itself. Its stop is the house's one
  shape (M218: every banner carries a stop).
- A PAGE READ OUT OF TURN IS NEVER ASKED AGAIN FOR ITS MOOD: M92's second ask (no mode.snapshot) ran on every missed
  page — the walk counted 1,1,2,2,3,3,4,4,5 — though M453 drops an old page's mood. extractTurn takes moodOwed:false from
  readMissedPage for a page older than the newest; the newest page is still owed its board.
- TESTS: walk DOM-108 (five missed pages): all read in one go, each once, what each taught landed, the banner ends at
  "The ledger has read every page", "done", 100%. NEGATIVE-TESTED: the old three-a-run cap (not done in time), the mood
  re-ask back (nine reads), the banner's end removed.
Harness 875/875, walk 126/126, long play 8/8, lint 0 errors (no new warnings).
- version.js -> m454-001.

# M455 — the header's hour is the hour on any calendar, and the clock speaks the story's own day
He: the clock "Thursday, March 5, 1001 — 09:19" under a page whose header reads "Tenth Division Courtyard — Sunday,
Hanami 5, 1001 AG | 09:20" — "and lag by one page??"
- ROOT: headerMutations set the clock ONLY from a real month's date (M128: "clock.set only when the header's own time is
  readable" — read as a full real date). His story keeps its own calendar ("Hanami"), so no header ever set the clock;
  the page reader guessed it — the page before's hour, on the real calendar the numbers fell on (a Thursday, in March).
  Reproduced through the real app (DOM-109 with the header's hour removed: "Thursday, March 5, 1001 — 09:19").
- NOW: a header's time sets the clock on any calendar, the day words it wrote riding along (clock.set {hour, minute,
  dayWords}); apply.js setTimeOfDay places it — the same day words: the same day, back or forth (the header is the truth
  for the hour); other day words: on by the day number under the same month word ("Hanami 5" → "Hanami 6"), else by the
  weekday, else one day; no day words: an hour far earlier (over three hours) is the next morning. clock.js renderClock
  speaks the day words ("Sunday, Hanami 5, 1001 AG — 09:20"; "the day after …" when the clock passed midnight before a
  header came). A real date takes the clock back to the real calendar (setClock drops the words).
- THE READER ON TOP: with the header's clock, the page reader's clock.advance is dropped as its clock.set always was — it
  put the clock ahead of the page's own hour (DOM-109: five minutes).
- ON OPEN: healLedgerOnOpen applies the newest page's header hour (a clock a page behind is put right before he writes).
- A DAY IS NEVER THE GROUND: "Sunday, Hanami 5, 1001 AG" leading a header was taken for a place; a weekday before a
  capitalised word and a day number is a date now ("Sunday Market" stays a place).
- M85's M128-1 line said "a header without a full date sets the place only" — that expectation WAS the fault; it now
  asserts the place and the hour on the day it names.
- TESTS: m455.mjs (2): his header (place + hour + day words), a date-only header is no place, real dates as before; his
  ledger following his headers (same day back and forth, next day, three days, past midnight, back to a real date).
  Walk DOM-109: through the real app the reader's lagging guess and its extra minutes are outranked; a ledger a page
  behind is put right on open. NEGATIVE-TESTED: no hour from his calendar (his exact symptom), the advance on top, no
  open heal.
Harness 877/877, walk 127/127, long play 8/8, lint 0 errors (no new warnings).
- version.js -> m455-001.

# M456 — only someone on their way has an arrival: "unresolved tension … due now" is never said
He: "Rukia Kuchiki — 13th Division barracks, her office desk, pulling the roster … (meaning to find the exact wording of
Jovan's placement before the courtyard fight ends) — unresolved tension with the main character, due now — this is
normal? It's been three scenes and she's still not coming back."
- ROOT: the world agent's own law is "only someone on their way has an arrival", but the engine enforced it only for
  "busy" and "waiting" (M396). A "tense" seat — tension with him, not a road to him — kept its ETA, so the storyteller was
  told every page that Rukia, at her desk in another division, was "due now": an arrival nothing would ever bring (the
  world agent keeps her at the desk for her agenda; the storyteller cannot walk her in from there).
- NOW: "tense" stays put too — no ETA is written on it (apply.js offscreen.set, STAYS_PUT) and none is said of a seat
  already stored with one (world.js renderArrival), so his ledger reads right at once. "toward" and "seeking" keep their
  arrivals; a seat with no stance keeps its ETA as M29 always had it (M29-3 unchanged). She comes when the world agent
  turns her toward him (her agenda done, a reason on the page), with an ETA the clock — now his headers' (M455) — counts.
- TESTS: m456.mjs (2): tense with an ETA seated without one, toward/seeking/no-stance keep theirs; her seat as his ledger
  holds it, in the storyteller's own request — the tension said, no arrival. NEGATIVE-TESTED: each gate.
Harness 879/879, walk 127/127, long play 8/8, lint 0 errors (no new warnings).
- version.js -> m456-001.
- m456-002: STAYS_PUT declared above its first use (lint no-use-before-define — a new warning m456-001 shipped; no change in behaviour). Harness 879/879, walk 127/127, lint no new warnings.

# M457 — usage and cost for every call; canon settings per story; one wiki library; discovery reads the ledger
He asked: (1) canon's "where to look" and every setting saved per story, not for every story; (2) an empty one found
automatically from the brief, the pages and the ledger, skipping when nothing fits; (3) a library of wikis like the
SillyTavern extension's, so a saved fandom goes back in the box with a tap; (4) token input/output history for every API
call — storyteller and workers — per day, week and month, with each connection's own prices and the total.
- (4) THE METER: providers/meter.js on relay.js houseFetch (every provider call passes it): POSTs to /chat/completions or
  /messages with messages are metered; a stream is teed (the caller gets its own branch, byte for byte — M457-1), a JSON
  answer read from a clone; usage as the provider reports it (OpenAI/DeepSeek usage; Claude's message_start input plus
  cache tokens and message_delta output), else estimated at four characters a token and marked ≈; a model list is not a
  call to a model. Day books under db.settings 'usage:YYYY-MM-DD', one write after another. engine/usage.js: today, the
  last 7 and 30 days per connection and model and the total; the per-day rate over the days used, a week and a month at
  that rate; money from priceIn/priceOut ($ per million), "no price" said, never guessed. UI: Settings → Storyteller →
  Usage and cost (ui/usage.js); the connection editor's two price boxes; store.js add keeps them (a NEW connection lost
  its prices — found by DOM-110).
- (1) PER STORY: canon/bridge.js useStorySettings — the extension's live settings object is the open story's own copy
  (canonGroundingSettings:<storyId>), made from the old shared settings the first time the story opens; a story that
  never looked anything up starts with nowhere to look. enterStory and the Settings canon room (drawCanonControls with
  the active story) both make it live; the save hook writes it to that story.
- (2) DISCOVERY: the card the extension's discovery reads carries "People in this story: …" from the ledger (the brief
  and the first and last pages already rode); nothing found, nothing runs for that story.
- (3) THE LIBRARY: one list for every story (db.settings canonLibrary; the wikis any story used join it). Settings →
  canon → "Wiki library" with "Add to library" and a remove for each; each story's "What canon says" room offers it as
  chips (a tap puts it in the box and keeps it) and an "Add to library" for the box's own. The shared "first-look" box is
  gone (where to look is each story's own).
- TESTS: m457.mjs (3): a DeepSeek stream metered as reported with the caller's stream untouched; Claude's stream with
  cache, a JSON answer, a silent provider estimated, a model list not counted; the sums, rates and money. m457b.mjs (2):
  each story its own settings; one library. Walk DOM-110 (the Usage and cost room, priced), DOM-111 (the library chips
  and Add to library). M386-8 and M346-1, DOM-69 and DOM-87 moved to the per-story model (where the change is kept, and
  the wiki named in the story's own room). NEGATIVE-TESTED: the meter unwired, the per-story swap removed.
Harness 884/884, walk 129/129, long play 8/8, real browser (relay, two browsers, holds one, kept thinking, housekeeper
rounds) green, lint 0 errors (no new warnings).
- version.js -> m457-001.

# M458 — another language in the page's own letters is the story's voice; the marks of speech are made whole in code
He: (1) "the drift fix — she moans in Japanese when my MC told her to, yet it changes it to English ('yamete' became
'stop stop') because the character is not established to speak Japanese"; (2) "the storyteller creates formatting
issues — missing quotation marks, *\"\"* — why is nothing fixing that?"
- (1) ROOT: the second reader's law made "words in another language" drift unless the ledger, brief or page established
  the speaker as speaking it — and it never saw his turn. Its warn mends the page. NOW: another language in the page's own
  letters (romaji, a French phrase) is never drift; only a sudden run of another SCRIPT with no reason is the wire's
  glitch; his turn rides as "what the writer asked for — the story itself, never drift"; and in code
  continuity.js languageFinding lets go any finding naming a language unless the page truly has a run of another script
  (and even then when he asked for that language). M85's old "language law" line was the fault; it now asserts the new law.
- (2) ROOT: tidyPage (every kept page) mended brackets, place and paragraphs only. NOW ui/pageshape.js mendMarks: speech
  wrapped in asterisks unwrapped, empty quotes removed (with only the spaces they leave), a curly or straight quote opened
  and never closed at its paragraph's end closed (not when the next paragraph goes on speaking), an asterisk opened and
  never closed closed — marks only, never a word; a whole page (and its own white space) comes back to the letter; feet
  and inches (5'9") are not a quote.
- TESTS: m458.mjs (2): the real reader shown his turn, the romaji finding let go, a blue-eyes finding and a real script
  glitch standing; the marks table and whole pages to the letter. Walk DOM-112: through the real app he asks for Japanese —
  "Yamete" stands, the mender is never asked, and the storyteller's *"…"* is kept as "…". NEGATIVE-TESTED: the guard off
  (the mender is asked), the marks off (the asterisks stay). DOM-111 now adds to the library from a second story's room
  (the first room goes on checking its wiki).
Harness 886/886 (885 + M121-1 on the new law), walk 130/130, long play 8/8, lint 0 errors (no new warnings).
- version.js -> m458-001.

# M459 — who knows what, once: another's book is never found by a shared family name; shared facts said once
He sent his "state of things" (14,943 tokens of a ~79k request at page 52): "is it the most efficient yet the best?"
Read line by line, "Who knows what" was most of it, and three faults made it so:
- BYAKUYA WROTE INTO RUKIA'S BOOK: findKnowledgeKey → nearKey's last rule takes any shared word of four letters or more,
  so "Byakuya Kuchiki" (no book of his own) found Rukia Kuchiki's — his facts written into hers, her whole block drawn a
  second time, his blind spots computed as hers. Now a loose match between two different given names is refused unless
  names.js samePersonName says they are one person. "Rukia" and "Kuchiki" alone still find hers; M239's "Vanderbilt"
  still finds "the Vanderbilt family".
- ONE FACT, THIRTEEN TIMES: what the whole courtyard saw is written for each witness (right) and was said once per
  witness (waste). renderKnowledge says a fact three or more here share ONCE — "Everyone here knows", "Everyone here but
  X knows", "Known to A, B, C" — and each person's line keeps what is theirs alone.
- ONE FACT, FIVE WORDINGS: sameFactsOnce folds facts sharing 80% of their words (numbers must be equal: page 43 and page
  44 are two facts), keeping the richer wording, dated as the newer.
- MEASURED on a ledger shaped like his (15 people, 7 shared facts, 4 re-wordings each): 10,459 → 3,979 characters; every
  fact said before is still said. M85's crowd test gives each guest its own fact (one shared fact no longer overfills).
- TESTS: m459.mjs (2). Harness 888/888, walk 130/130, long play 8/8, lint no new warnings.
- The first push of this (e006516) went out before its version bump and with one lint warning (a shadowed name in
  findKnowledgeKey); this commit renames it and bumps the version. Behaviour identical.
- version.js -> m459-001.

# M460 — the last repeats in his notes: each lacked fact once; the series' look without wiki scraps or the past
He: "is it done or not — give me the final perfected version". The two repeats left after M459:
- WHAT THEY HAVEN'T FOUND OUT: the same four facts rode under sixteen names, the whole fact each time. renderBlindSpots
  now says each fact once, after the names of everyone who lacks it ("A, B, C hasn't found out: F (X knows)"), facts
  lacked by the very same people sharing a line — the same marker (BLIND_LINE), names and knower the second reader and
  the storyteller read. On his own lines: 10,135 → 1,460 characters.
- TRUE OF THEM: canon's look came in with the wiki's scraps (".]] Renji has…", "headpieces called .", "his main source
  being , the same shop…") and with how people looked long ago ("110 years ago…", "While she was lieutenant under
  Isshin…", "Even as a child…"). canon.js cleanWikiWords, in renderCanon for the series' own lines only (source
  'canon'): markup scraps gone, a link that left no word mended, a sentence that opens in the past dropped (the latest
  look — "Seventeen months after Aizen's defeat…" — stays; "Later, he would…" stays). His own truths never touched.
- TESTS: m460.mjs (2): every name, fact and knower kept, each fact once, far shorter; his exact lines cleaned, his own
  truth as written. Harness 890/890, walk 130/130, long play 8/8, lint no new warnings.
- version.js -> m460-001.

# M461 — canon's words come through whole; his V177 preset audited against what the storyteller actually reads
He sent his full V177 preset (50 prompts, ~49k tokens; ~40k switched on) and everything the storyteller saw on a page,
and asked for the preset "perfectly optimized", masterful, and no bugs.
- THE BUG: his canon note read "The  is one of the Gotei 13, headed by Captain Tōshirō Hitsugaya", "The , is one of the
  Gotei 13", "a white , a black , a black , a white hakama-himo, white , and ." — the canon extension's template stripper
  (grounding.js stripTemplates, a depth walker) deleted the Bleach wiki's Japanese-term templates whole, and the term
  lives in their first parameter. cleanWikitext now keeps it ({{Nihongo|Tenth Division|十番隊|Jūbantai}} → Tenth Division;
  the romaji when the English is empty; {{lang|ja|X}} → X) before the walker runs; every other template still goes.
  Verified on the template shapes; the live wiki is not reachable from this sandbox (fandom.com is outside its network).
- THE PRESET: in Cozy the storyteller does not read V177 — it reads the house craft (assemble/craft.js CRAFT_TEXT,
  70,109 characters, ~17.5k tokens: The Telling, CORE Contract, The House's Truth, Simulation Core, The Turn, Character
  Integrity, NPC Psychology, Information Quarantine, Continuity, The Prose, Intimacy, The Page, The Pass), distilled from
  V177 in M36, plus the rulebook the scene wakes (V177's NSFW Mode when intimate; the commands). V177's trackers, Scene
  Pulse, Watchlist, Factions, Voices, TWB, Contested Resolution and three CoT variants are the house's workers now (the
  import map, import/v176map.js). MEASURED: the craft shares 3 eight-word runs between sections out of 70k characters (no
  copy-paste left to cut), and states each point of his taste explicitly — interruption (CORE: every MC action is an
  attempt; NPCs can interrupt), continuous onomatopoeia (The Prose: two lanes, REQUIRED on every contact beat, a
  self-check every few sentences), anatomy (anatomical and medical nouns required; Injury Resolution; the intimate
  rule's detail targets), the world not bending, earned warmth, arcs (NPC Psychology), the living world (the House's
  Truth and the world agent). It rides the cached prefix. Left as it is: a rewrite would risk the quality he reports,
  for tokens that are cheap and already distilled.
- TESTS: m461.mjs (1). Harness 891/891, walk 130/130, long play 8/8, lint no new warnings.
- version.js -> m461-001.

# M462 — a card says who someone is: never where they once stood, never the series' look twice
The two things M461 left open in his "On their mind", closed:
- A MOMENT IN A CORE: "Byakuya Kuchiki — Captain of the 6th Division; assembled at 1st Division HQ with the available
  captains" (the same on Hitsugaya and Rose) while they stood in the Tenth's courtyard; Mayuri's core was a whole scene
  ("gliding along…; at the corridor outside the Assembly Hall, moving toward the 12th Division"). Written by the world
  agent before M445 taught it a core is who someone is. engine/people.js cardCore drops a clause that opens as a moment
  (a posture or a motion verb with a place after it, or "at/in/on the corridor|hall|courtyard|gate|…"); a clause that
  only mentions one ("a tall woman who stands by her captain") stays.
- THE SERIES' LOOK TWICE: Rukia's and Shunsui's cores still carried "petite, slender, black hair, large violet eyes" and
  "tall, lean, wavy brown hair, stubble, perpetually relaxed expression", which True of them carries from the series in
  the same request (the canon tidy had left them). cardCore lets go of a comma item of four words or fewer whose every
  word the series' own look lines say (seriesLookWords: source 'canon' only — his own truths are never a reason); her
  uniform and her duty, his kimono and his charisma stay.
- On the card only: the ledger's page is never rewritten, so nothing is lost if a rule here is too eager.
- TESTS: m462.mjs (2) on his exact cores and through the real people block. Harness 893/893, walk 130/130, long play
  8/8, lint no new warnings.
- version.js -> m462-001.

# M463 — the wiki library is a switch for this story: tap to use, tap two for a crossover, tap again to stop
He, on Settings → The readers: "One tap what? I can't tap anything and it's not being put on canon verification and
can't do crossovers — do you even read canon verification code?"
- WHAT WAS WRONG (M457, mine): the Settings library rows were plain text under a line promising "one tap to use"; the
  tappable chips lived only in the story's own ledger room, and there a tap REPLACED the story's wiki. The extension's
  binding is a LIST (grounding.js activeWikis reads the chat's binding, a CSV; bridge.js wikiName keeps a CSV), so a
  crossover was always possible — M457 gave him no way to make one.
- NOW: in Settings (the open story's canon section, M457) and in the story's room, each library wiki is a button: a tap
  adds it to where this story looks (ctx.chat.canonAct('wiki', list) — the extension's own manual binding), a second tap
  takes it away, two or more is a crossover; the one in use shows a check. A line says "This story looks in: bleach + jjk
  (a crossover)" or that it finds its own. The x still takes a wiki out of the library.
- TESTS: walk DOM-113 through the real app: tap bleach, tap jjk (both, "a crossover"), tap bleach again (jjk alone).
  Harness 893/893, walk 131/131, long play 8/8, lint: no new warnings (one old warning's line moved).
- version.js -> m463-001.

# M464 — Automatic is a switch you can see and tap; only what he chose is checked
He: "you give me a way to select but no way to deselect all, so I can't tell it to look automatically — half-baked."
- WHAT WAS WRONG (M463, mine): tapping the last chosen wiki off DID send the story back to finding its own — but the wiki
  it then found came straight back with a check, as though he had picked it, so there was no visible way to be on
  Automatic and no control named for it. The extension already told the two apart (canon_grounding_wiki_ok.manual on a
  choice; "via"/"fp" on a find).
- NOW: an "Automatic" chip of its own, in Settings and in the story's room: checked when the story finds its own wiki (the
  line says which it found, or that nothing fits yet and it skips until the story names something); tapping it lets his
  choice go (the extension rediscovers). A wiki is checked only when he chose it; tapping one while on Automatic starts a
  new choice with that wiki; tapping the last chosen one off is Automatic again.
- TESTS: walk DOM-114: Automatic checked at the start; choose bleach, add jjk (crossover, Automatic unchecked); tap
  Automatic (choice let go, Automatic checked, neither wiki shown as picked); tap jjk (a new choice); tap it off
  (Automatic). DOM-113 still passes. Harness 893/893, walk 132/132, long play 8/8, lint no new warnings.
- version.js -> m464-001.


# M465 — the coats, and the ledger dressed in each one
He: "I want multiple themes that are beautiful… fantasy first, second cyberpunk purple, third gaming magma, fourth fantasy
academy (like the Harry Potter map with footsteps), five aurora borealis, six a spaceship Mass Effect 3 orange. And tidy
up the ledger UI — it's not intuitive and ugly; everything is ugly. Carefully, without breaking anything."
- THE LEDGER (css/ledger.css, #drawer only — the housekeeper's sheet shares .drawer and keeps its look): each panel is a
  card with a glyph and a readable serif name (the mono-caps whisper and the doubled hairline between panels — a
  border-top from drawer.css AND a border-bottom from base.css — are gone); the four rooms are an icon tab bar; rows are
  slots; every action is a pill; the × on a row is a round mark; "What changed", "Something drifted" and "The workers"
  are a timeline with dots (drift gets an amber bar; "Copy all of this" moved to the card's foot); the by-hand forms sit
  in dashed "By hand" boxes; the mood flags are slots; a room reads in the order it is FOR (the people's pages lead the
  people room, who is here follows the clock) by CSS `order` alone — drawer.js's DOM order is untouched, so nothing the
  walk clicks moved. Glyphs are SVG masks over currentColor (never emoji), so every coat colours them itself.
- THE COATS (base.css tokens + css/coats.css dress + app.js COATS + index.html coat rows with swatches): fantasy (a forest
  night, gilded; the ledger a tome with gilded corners), cyberpunk (violet neon, cyan speech; the ledger a cut-corner
  dashboard with a scanline), magma (M301–M303's tokens untouched; the ledger obsidian with an ember seam), academy (a
  night library; the ledger opens as a PARCHMENT MAP — every token re-scoped on #drawer to brown ink, walking footprints
  on "Who's here", opacity only, stilled by reduced-motion), aurora (a northern night with the lights over it; a frosted
  journal with an aurora hairline), starship (charcoal and ME3 orange; an angular console). Every ink of every coat holds
  4.5:1 on every ground it can stand on, including the 🎨 header card's own tokens (checked in code before base.css was
  written). The room's glow is painted on .thread-wrap, the column that never scrolls (M301's law); no transform,
  will-change or backdrop-filter on the drawer (M146).
- TWO FAULTS FIXED ON THE WAY: the line under the composer folded into a five-line sliver beside the links on a phone
  (chat.css: it wraps as a row now, the words on one line, the links under them); the light coat's hour chip on the
  header card stood at 4.07:1 (--pk-amber #9a5a10 → #86500a, 4.9). A tick or a radio wears the ember, never the
  browser's blue.
- THE ONE JS CHANGE: peoplePanel's addLine puts a page line's key ("Who they are", "Now", "Between you") in a
  .page-key span and the words after it — the same textContent, two nodes.
- TESTS: tests/paint_coats.py (new) — every coat on a seeded ledger: 0 text surfaces under AA in all nine coats, the
  page threw nothing; tests/contrast.py and tests/coat.py walk all nine coats (0 under AA; the header card follows every
  coat). Measured at 6× CPU throttle on a phone viewport: the people room scrolls at a 16.6 ms median in every coat
  (dark 16.7); the ledger opens in 205–510 ms and closes in 26–70 ms (perf_rooms.py within budget); paint_magma.py:
  the magma room glowing, readable, no slower (median 16.5 vs 16.7 deep). Harness 893/893, walk 132/132, long play
  8/8, twobrowsers all green (sw.js's shell gained the two stylesheets), lint 0 errors.
- version.js -> m465-001.

# M466 — the ledger folds, the page mark, the shelves sort and rest, his own-voice words, the coat's speech colours
He, with a screenshot of SillyTavern's prompt-manager "Edit" (Name / Role: AI Assistant / Triggers / Position:
Relative / Prompt): "make the ledger more tidy — scrolling down with so many sub sections already opened makes my eyes
confused; a scroll button on the right showing which page number is scrolled; the projects and chats sortable by name,
by last played; archive a project I paused; special instructions that act as assistant role like SillyTavern that I can
put anywhere in my context — to keep my storyteller Iron Man or Hulk being themselves; you decide one box or many, drag
or fixed, and explain it; and dialogue colour and thoughts customizable per theme, not fixed."
- THE LEDGER FOLDS (drawer.js, ledger.css): a panel is its name, a chevron and a live row count until tapped; what a
  room is for stands open the first time; every fold and unfold is his and remembered. Folded is a class — the DOM the
  walk reads is unchanged, the h3's text is still exactly the title (the count is a span after it).
- THE PAGE MARK (ui/pagemark.js, chat.js, chat.css): "page 37 of 114" on the thread's right edge while it scrolls, a
  scrollbar's thumb that can be dragged to any page, gone a second after the hand stops; numbered over the whole tale.
- SORTED, AND RESTING SHELVES (chat.js, store.js projects.update): Last played first / By name / Newest first, one rule
  for shelves and tales, remembered; ☾ puts a shelf to rest — it keeps its tales in a corner at the foot, is never
  offered for a move, ↩ wakes it. Found on the way: M22's resting-tales corner never folded (no .collapsed rule) and
  its head was the browser's grey button — fixed for both corners.
- WORDS IN THE STORYTELLER'S OWN VOICE (stack.js, chat.js gatherSettings, ui/ownwords.js, providers/openai.js): several
  entries, each with a switch, a name, whose words (the storyteller's = assistant, his = user, the house's = system) and
  ONE OF THREE FIXED LANDMARKS chosen from a dropdown, never a drag (on a phone a dropdown is exact): before the story's
  pages, after the newest page right before his message, after his message before the closing words. No fourth spot —
  the last message is the prefill's (M307/M328). An assistant entry never opens a request. Each rides as its own
  message and its own receipt row; off or empty, the request is byte for byte the same. deepseek-reasoner refuses two
  of a role in a row (its docs and its 400 say so); for a model named reasoner the provider folds neighbours; every
  other house takes them as built. {{teller}} and {{you}} take the two names from The frame. The words are his content:
  the house reset never touches them.
- THE COAT'S SPEECH COLOURS (ui/speechcolours.js, app.js applyTheme, index.html Appearance): two pickers for the coat
  he wears, each coat its own pair, laid as inline tokens over the coat's block; the ratio against the room's ground is
  shown as he picks, with "Brighten it until it reads" under AA — a tap, never a silent change of his choice; "This
  coat's own colours" lets the pair go.
- ALSO: the fixed jump pill no longer floats over Settings (body.settings-open).
- TESTS: harness tests/harness/m466.mjs — 6 laws (placement, roles, byte-identical when off, an entry never opens a
  request, the reasoner fold vs deepseek-chat, a resting shelf keeps id/name/tales); walk DOM-115 (folds, count,
  remembered, Enter), DOM-116 (numbers over the whole tale, the mark in the room), DOM-117 (sort by name / last played,
  rest, not offered, wake), DOM-118 (own words through the real app: kept, sent as an assistant message right before
  his message with the name filled in, off = not sent, let go asks first). Harness 899/899, walk 136/136, long play
  8/8, lint 0 errors, twobrowsers green (sw.js's shell gained three modules), paint_coats.py 0 surfaces under AA in all
  nine coats, perf_rooms.py within budget; at 6× throttle the folded ledger scrolls at a 16.7 ms median (dark) and
  16.7 (academy), opens in 204–572 ms, closes in 33–52 ms.
- version.js -> m466-001.

# M466-2 — the three places said in his own words
He: "isn't it assistant role — my user message — then the notes (system) — the output? Why 'before the story's pages
and right after the notes'?" — "the notes" in the place's name read as the note at the end; it meant the ledger's
briefing (the one user message the tracker rides in). The three places now say: "after the ledger's briefing (the
tracker) — before the first story page", "after the newest story page — right before your message", "after your
message — before the note at the end". Keys unchanged; harness M466-3 reads the new words. version.js -> m466-002.

# M467 — the window's marker, in any dressing the model gives it
He, with a window from his page: "The World Beyond / [The Room Next to Aria — same 4th floor, Monday, April 8, Year
1130 | 21:51] — why is it not rendered by the regex, and why did the agent not fix it so it got rendered?"
- WHAT WAS WRONG: the house asks for a line reading *** The World Beyond *** and FOUR readers looked for exactly those
  characters — the 🎨 boxed style (regex-styles.js style-twb), the page reader's "seen only inside the window = elsewhere"
  guard (chat.js, M129), the scene-before-the-window cut (apply.js scenePartOf, M444) and the lint's one-window count
  (agents/lint.js, M116). His model wrote the marker as a bare line. All four missed it at once: no box, and the window's
  people could be seated into the scene and its place could pass for the scene's. The page repair (pageshape.js tidyPage)
  mended brackets, blank lines and marks, but not this.
- NOW: engine/window.js is the ONE definition — WINDOW_MARK, WINDOW_LINE (a whole line that is the three words with any
  marks around them: bare, **bold**, ***bold***, a # heading, dashes, ✦, any case), windowCutAt, normalizeWindowMark.
  tidyPage writes every kept page's marker in the exact form (marks only; the words, the window's line and the blank
  lines around it to the letter — did: 'window'); scenePartOf, the M129 guard and the lint read through windowCutAt /
  WINDOW_LINE, so a page kept BEFORE today (his) is cut right when it is read again; the boxed style's find takes any
  dressing with flags gim, so his stored plain page is boxed at display without a re-read. A prose mention ("the world
  beyond the walls") and a title with more words are never a marker. The header's ground and hour still come from the
  page's FIRST line only (state.js headerMutations), so a window's own [Location — Day, Time] line never sets the scene.
- TESTS: harness m467.mjs (3 laws over eight dressings): found and cut, kept exact, boxed with the scene left outside.
- version.js -> m467-001.

# M468 — Settings folds, the ledger's law
He: "can you make the settings tidy too? So many opened subsections make my head hurt."
- NOW (settings.js buildQuickNav, base.css): every settings section folds to its name and a chevron; a tap (or Enter)
  opens it; a room's first section stands open the first time (connections, the brief, the rulebook, bring your people,
  how much the story remembers, appearance, the glossary); his taps are remembered in `settingsFolds`. Folded is a
  class, never `hidden` — the rooms still use hidden, everything inside a folded section is drawn and reachable by id.
  A deep link into a section (the composer's frame/note/rulebook links, "add a connection") unfolds it for the visit
  without remembering it as his choice. The house reset puts the folds back as shipped (nav.applyFolds).
- TESTS: walk DOM-119 (first open / rest folded, tap opens and folds, remembered, a deep link unfolds). Walk 137/137.
- version.js -> m468-001.

# M468-2 — the page mark names the last page at the end
He: "why does the scroll page number count 154 of 155 at the end — 155 is counted as 154?"
- WHAT WAS WRONG (M466, mine): the page under the eye was the page whose top was above a reading line fixed 45% down
  the screen. At the very end of a tale whose last page is shorter than half the screen, that line still sat inside
  the page before it — so the end read "154 of 155". Reproduced in a real Chromium (tests/pagemark.py on the old
  code: 39 of 40 at the end and after a drag to the foot).
- NOW (ui/pagemark.js pageUnderEye): the reading line slides with the scroll — 45% down the screen at the top of the
  tale, the screen's foot at the end — so the last page is named when the thread stands at its end, the first at the
  top, and every page between as its top crosses the line.
- TESTS: tests/pagemark.py (new, real Chromium, forty pages, the last one short): the end names 40, the top 1, halfway
  20, a drag to the foot 40 and back to the head 1; the page throws nothing.
- version.js -> m468-002.

# M469 — the turn that ran past its end
He, of his teller's thinking: "history has a weird repeated block in the middle of my own message — a garbled line,
an embedded re-typed copy of my opener plus some note about 'USER sent you this again'. Provider error, or could
Cozy Tavern cause this?"
- WHAT IT IS: provider-side. A model that misses its end-of-turn keeps going and writes the NEXT turn itself — a role
  label ("USER:", "Human:"), a re-typed copy of the writer's message, and a reply to it; a garbled line at the seam is
  the run-past point. The house never sends any such note and never repeats his message (searched: stack.js, voice.js,
  the providers, the engine — the only things beside his message are "Go on." on a continue, the "[… middle of this
  page not shown …]" line on an over-long page, and the closing message; since M377 no ask-again lines exist). M117
  cut a leak only at a control token; this one leaked none, so the page was kept whole and every later turn read it.
- NOW (agents/director.js stripControlLeak, chat.js): the page ends at the first of — a leaked control token; a
  chat-template role label at a line start followed within 300 characters by forty verbatim characters of his
  message; his whole message (sixty characters or more, whitespace aside) standing as a paragraph. The tail is never
  a page; the toast says the storyteller ran past its turn and the words before were kept. A quoted line of his
  inside prose, a label followed by other words, the word "User" without a colon, and a short message ("Go on.")
  never trip it. The page already in his story is history: Edit it and cut from the garbled line to the end.
- TESTS: harness m469.mjs — 3 laws (label + copy, a bare re-typed message, the never-trips).
- version.js -> m469-001.

# M470 — the referee: two against one is a battle; a companion can join; every ruling carries its account; the check's domain
He: "make sure everything of Arbiter is integrated with no bugs or regression. Why is it only success and fail
without explanation or justification? And why does my team fighting someone look like 1 vs 1 instead of 2 vs 1?"
- 2 vs 1 (referee.js, engine/duels.js, engine/apply.js): the contract said duel_start = "combat against ONE named
  person", battle_start = "against SEVERAL opponents" — so a team against one enemy opened a DUEL and the duel engine,
  one seat a side, dropped the companion. And a running duel had no door for a third fighter. Now: two against one is
  a battle (the contract says so; a duel_start naming companions under its new `allies` is drawn up as a battle with
  that one enemy, the referee's estimate riding as opponentRating); every fight beat has `joins` {allies, enemies} —
  a companion stepping in or reinforcements — carried by a new `combat.join` mutation (a take-back like any fight
  change; the founders never write it): a duel widens into a battle carrying both duellists exactly as they stand
  (rating, poise, hurts, momentum, composure, the round; grewFrom:'duel'), a battle takes newcomers once, ten a side,
  never the player, a war takes none. The widened beat is fought at once as a battle round.
- THE ACCOUNT (referee.js ruling(kind, tier, directive, account), drawer.js verdictPanel): every ruling carries what
  the referee read and what the dice did — what (a lone check / duel round N / battle round N / a war / armed / a lull
  / over), the attempt, who against whom at what ratings, the tilt and the referee's own reason for it (a new `why`
  field in all four contracts), the odds, the roll, the tier, at stake; in a duel both fighters' poise/hurts/momentum;
  in a battle the field and every pairing. The ledger's "The house has ruled" shows it, with "What the storyteller was
  told" folded and "The rulings before it" (the last eight, from refHistory). The storyteller still hears only the
  words a person says — M345 holds, the numbers never reach the wire (M470-4 asserts it).
- A REGRESSION FOUND ON THE WAY: normalizeAdj never read the `domain` the contract asked the referee for, so every
  lone check rolled on the character's DEFAULT rating (a melee 8 forcing a door, a social 9 persuading — all at 5).
  checkDomain() keeps melee|ranged|social|intellect|stealth|craft; fights were never affected (their own domain).
- TESTS: harness m470.mjs — 4 laws (the opening call routes companions to a battle; joinFight carries state, dedupes,
  caps, refuses a war; combat.join with its take-back; the account of a lone check with its numbers, a battle's field,
  a duel widened through the referee's own beat, the wire still numberless). Harness 909/909 (every M11/M345/M400
  referee law green), walk 137/137 (DOM-68 the referee in the app), long play 8/8, lint 0. The panel photographed.
- version.js -> m470-001.

# M471 — the Arbiter audit: the whole extension against the port
He: "check my SillyTavern Arbiter extension, the whole code — a culmination of many updates and bugs — and integrate
it fully into Cozy Tavern, adjusted, without breaking my persona."
- METHOD: Arbiter v0.42.0 (83 commits, 5,086 lines) parsed by AST beside the port (agents/referee.js, engine/duels.js,
  engine/referee-math.js); 62 functions shared by name, each diffed after comments, whitespace and the ST-vs-Cozy
  renames (meta→state, getSettings()→eng, getPreset()→eng.preset) were normalised; the 87 Arbiter functions with no
  counterpart classified. THE ENGINE IS A FAITHFUL PORT: probFromDelta, sliceOutcome, tieCheck, applyExchangeEffects,
  the duel/battle/war resolvers, recovery, sequences, pairings, morale, composure, conditions, ratings, growth-aware
  seeding (ratings only rise), the timeline rewind with composure in the snapshot, estimates persisted on every
  teardown, the mutual-knockout DRAW — identical logic. The 87 absent functions are ST's own (HUD, settings panels,
  slash commands, World Info, the ambient event/thread engines — Cozy's world agent and ledger stand in their place)
  or already covered by another name (persistDuelEstimates→persistFightEstimates, resolveAdj→resolveCheck,
  interceptorBody→refereeStep, mathLine→M470's account). The directives differ ON PURPOSE (M345: words a person says).
- FOUR REAL DIVERGENCES, FIXED: (1) stripDialogue stripped '…' between STRAIGHT apostrophes — "I don't hesitate — I
  lunge at him and slash low, and I won't stop" reached the gate as "I don t stop" and no fight opened; Arbiter never
  touched apostrophes. Now as Arbiter: "…"/“…” (and ‘…’) on one line, ≤400 chars, never an unclosed quote eating the
  message. (2) findActorKey wanted every word of the target in the key, so the sheet's "Kaelen" was not found by
  "Kaelen Stahl" — a second entry, a stranger's rating; now the same-person rule either way round (M345's, stricter
  than Arbiter's any-shared-word), a shared surname alone still nobody. (3) normalizeConditionChange defaulted a
  piece of GEAR with no modifier to -1; Arbiter: +1 for gear, -1 for a condition. (4) the seeder's write took a
  model's name unchecked; safeKey now guards it (Arbiter v0.37's magic-key hardening; applyConditionChange already
  had it). The persona path is untouched: no directive changed, the account never reaches the wire.
- TESTS: harness m471.mjs — 3 laws (the gate through contractions, quotes still speech, an unclosed quote; the fuller
  name finds the sheet's entry, a surname is nobody; gear +1 / condition -1, __proto__ and constructor refused).
  Harness 912/912 (every M11/M345/M400/M470 referee law green), walk 137/137, lint 0.
- version.js -> m471-001.

# M472 — an order is a move; "#p" in a fight is the last beat again
He, with the ledger's account: "if my MC doesn't fight and just orders an attack, the referee becomes stupid and
confused, especially while I wait by typing #p" — LULL, "Orders the three summons to strike together", round 0,
4 against 1.
- WHAT WAS WRONG: (1) the battle contract left "exchange" to the model, and a model that saw the player swing nothing
  said false — the three summons' strike was ruled a lull and the round never moved. (2) "#p" means "the main character
  continues his last action for exactly one beat"; in a fight the gate let it through and the micro-call read a bare
  "#p" as nothing happening — another lull.
- NOW (referee.js): a command in the referee's own answer (move.kind "command" in a battle; a formation or target named
  in a war) or the words of an order ("orders … to strike", "tells Fenrir to tear into") make the beat an exchange
  whatever exchange said, in command — the allies act on it that round; a real pause stays a pause, the fight ending
  wins, and "I … strike" keeps the player's own attack. A "#p" in a running fight is the last committed beat scored
  again — its move, its target, its words ("goes on with it — …"), no micro-call; with no beat scored yet, the words the
  fight was joined on: an order continues as a command, anything else as a plain attack. The account carries the move
  (and `continued`) so the next #p can follow it. The battle contract says it too: an order is a move, never a pause.
- TESTS: harness m472.mjs — 3 laws (the normaliser's order rule; the field joined on the order, the order ruled as a
  command round, #p continuing it with no call, a declared order continuing as a command; #p outside a fight stays the
  gate's, #p in a duel presses the last move). Harness 915/915, walk 137/137, lint 0.
- version.js -> m472-001.

# M473 — the domain of the beat: a summoner commands at his summoning
He, from the measure panel: "Why is it only 3? Jovan Arden (you) — 3 of 10, known for summoning 9, willpower 8,
intellect 6, social 5."
- THE NUMBER: the headline is `default` — the rating for anything NOT on his list (a blade in his hand, a climb, a
  lie) — and the panel never said so. It says so now: "3 of 10 for anything not listed".
- THE BUG BEHIND IT: a battle rates every unit by the battle's domain (melee, ranged) — so the summoner stood on the
  field at 3 and every order he gave his summons was rolled at 3 (Arbiter does the same; the war alone read a
  commander's tactics/command/intellect). Now the battle contract asks for the move's `domain` — the skill the
  player's OWN act rests on this beat: melee/ranged when he strikes, and for a command the skill the order rests on
  (summoning for summoned creatures, tactics for troops, a magic domain for a spell), always one from his sheet when
  one fits — and engine/duels.js beatRating takes that rating from his sheet for the player's number this beat
  (conditions applied); a domain not on the sheet, or none named, leaves the unit's rating. Only the player's number
  moves; the field's units keep the battle's domain. The account names the domain; a #p continues it.
- TESTS: m472.mjs M473 — summoning 9 commands at 9, a blade at 3, an unlisted domain at the unit's 3, the domain rides
  the normaliser. Harness 916/916, walk 137/137, lint 0.
- version.js -> m473-001.

# M474 — "Weigh them again", and the brief's mark
He: "I just updated my brief to raise my character's skill — how can I restart or refresh How they measure?"
- THERE WAS NO WAY: the cast was weighed on the first pages, after a fight, and when a new face entered; a changed brief
  waited for the next fight, and there was no button (a control he cannot find does not exist).
- NOW: (1) the ledger's "How they measure" has "Weigh them again" — chat.js weighCast runs the seeder by hand (force:
  true — on any number of pages), under the work banner, on the brief and the pages as they stand; a considered rating
  still only rises (growth) and a hand-kept number never moves. (2) The sheet keeps the brief's mark (referee.js
  briefMark — a hash of brief + cast notes, kept through state.js); seedDue says 'the brief changed' when it differs,
  so a raised skill reaches the sheet on the next page without the button. Older callers that hand no brief are not
  judged on it.
- TESTS: m472.mjs M474 — the same brief not due, a changed brief due, no brief handed in not judged; by hand on one
  page the raised skill and a new domain reach the sheet, the default rises, a hand-kept number stays, the mark is
  kept and the same brief is not weighed twice. Harness 917/917, walk 137/137, lint 0.
- version.js -> m474-001.

# M475 — one person once on the field; a weighing never throws a considered entry's domains away; a power is a domain
He: "it makes Mahoraga two persons — 'Eight Handled Sword Divergent Sila Divine General 5 · Mahoraga 9'; and I said my
MC is like Gojo Satoru but he's weak: melee 4, social 7, willpower 8" (his earlier sheet had summoning 9).
- TWO OF MAHORAGA: the referee's roster carried the full formal name and the short one; normalizeRoster cut every
  name at FIFTY characters before anything else, so "…Divine General Mahoraga" lost its "Mahoraga" and no longer
  shared a word with the short name — two units, one a stranger at 5. Now the names are read whole (160), twins by
  the same-person rule are one (the name the sheet knows wins, else the shorter), a known name is written as the
  sheet writes it, a long stranger's name is cut at sixty. The seeder's contract says it too: one person, one line,
  by the name the story uses — a title or formal name is never a second entry.
- THE SUMMONING 9 GONE: mergeSeed grew only entries stamped `seed === SEED_VERSION`; an entry the referee made in a
  fight (`_auto`, no stamp) was REPLACED by the next weighing and lost its domains. Now every `_auto` entry grows
  (domains kept and raised, the default never lowered) and is stamped as considered; a replace is a heal's — and an
  estimate's (a fight's guess gives way to a considered rating, up or down; M345-4 holds).
- GOJO-LIKE AT MELEE 4: the seeder folded a power into melee or left it off. The contract now says a power is a
  domain of its own (sorcery, summoning, cursed, psionics — up to 10 for the strongest of their world), never folded
  into melee, because a power left off the sheet does not exist in a fight (M473 rolls the beat in its domain).
- TESTS: m472.mjs M475 — the title and the name are one (the sheet's name kept), a case-twin is one, two spellings
  with no sheet entry keep the shorter; a fight-made entry keeps summoning 9 and grows; an estimate gives way; a
  hand-kept number stays; a heal is the one replace. Harness 918/918, walk 137/137, lint 0.
- version.js -> m475-001.

# M476 — a readable object is shielded, not the whole page; a stray quote goes; a soft wrap is joined
He, with a page: "the agent doesn't fix this weird formatting — there's a missing quote, and at the bottom I'm
confused what it is." The page: a phone-screen object (<!-- GFX_START -->…), a paragraph ending `…then another,
"like someone reading the skyline one name at a time.` (a quote opened onto narration, never closed), and in the
window `…closer to the towers than Dev likes —\n and the thought…` (a line break with an indent mid-sentence).
- WHY NOTHING WAS FIXED: pageshape.js FENCED skipped EVERY mend on a page carrying a GFX block, a code fence or a
  tracker block — to keep the object's own quotes and asterisks (HTML) untouched, the whole page was left as it came.
- NOW: shieldObjects lifts each object out whole (GFX blocks, fences, {PULSE}/{WATCHLIST}/{VOICES} paragraphs), the
  prose around it is mended, the object is put back to the letter. mendMarks: a lone quote opened after a COMMA onto
  a lowercase word is a stray mark in narration and goes (after a speech verb or onto a capital it is speech and is
  closed, as M458 did). joinSoftWraps (new, in tidyPage): inside a page whose paragraphs are parted by blank lines, a
  lone line break followed by an indent, or one leaving a sentence hanging that goes on in lowercase, is joined with
  one space — never inside an object, never a page with no paragraph breaks (its single newlines are its paragraphs),
  never a line that ends a sentence and starts with a capital. The paragraph shaping still skips a page holding an
  object (M340-1 holds). His page through tidyPage: did [wraps, marks]; the quote gone, the wrap joined, the phone
  screen and the window's marker and header to the letter.
- TESTS: harness m476.mjs — 3 laws (the object whole and the prose mended, fences/trackers shielded; the comma rule
  vs the speech-verb rule vs a closed pair; wraps joined only where they should). M340/M458 laws green beside them.
  Harness 921/921, walk 137/137, long play 8/8, lint 0.
- version.js -> m476-001.

# M477 — "Mend the pages' marks"
He: "so to fix my current page should I tap Read the pages again, or what?" — no: the page repair ran on arrival
only, "Read the pages again" is the ledger's readers, and nothing re-mended a page already kept.
- NOW: The workers → "Mend the pages' marks" (drawer.js; chat.js mendAllPages) runs tidyPage over every kept page —
  brackets, the window's marker, a stray or open quote, an asterisk, a soft wrap — marks and white space only, never
  a word; a page it would not change is not written (no sync churn); the current swipe is the one mended; the thread
  redraws; a toast counts the pages mended. No model call, no ledger work: a mark needs no re-read.
- TESTS: walk DOM-120 — a stray quote gone, a soft wrap joined, a phone screen to the letter, a whole page not
  written (its updatedAt unchanged), the thread redrawn. Walk 138/138, lint 0.
- version.js -> m477-001.

# M478 — a #story concept becomes the brief, its grammar set right
He: "if the story starts with #story <concept> … it should automatically be put on the brief or the record, and
smartly fix the grammar, because sometimes I just put garbled words."
- BEFORE: a tale opened on a concept had an EMPTY brief — the founder founded nothing, the seeder weighed the main
  character from page 1 alone, and the concept slid out of the forty-page window in time.
- NOW (chat.js send path, agents/concept.js): when a #story carries a concept and the tale's brief is empty, the raw
  concept is written into the brief AT ONCE (so this very turn's founder and seeder read it — the founder now re-reads
  the brief from the store at run time), and while the storyteller writes the first scene a worker (the founder's
  connection) sets its spelling and grammar right: every name, number, age, power, bond and event kept exactly,
  nothing added, nothing removed, his blunt register, third person. acceptablePolish refuses a polish that drops a
  name (the capitalised words inside sentences), a refusal, a stub or a runaway — the raw words stand. The polished
  brief is written only if the brief still holds the raw concept (never over words he wrote meanwhile). A brief he
  already wrote is never touched. A toast says where the brief is. The brief, not the record: the record folds the
  pages; the brief is what the founder, the seeder and every request read, and it never leaves the window.
- TESTS: harness m478.mjs (acceptablePolish's five refusals and the faithful pass; polishConcept through a thinking
  house, no connection, a refused polish, nothing to polish); walk DOM-121 (the concept is the brief at once; a
  written brief is never overwritten). Harness 923/923, walk 139/139, lint 0, twobrowsers green (sw.js's shell gained
  concept.js).
- version.js -> m478-001.

# M479 — the brief from a #story concept: by hand, and a switch
He: "for my current story, where the #story was ten pages ago, is there a manual button? And can you add automatic
on/off? Off, it's back to normal — nothing happens, or I tap manually."
- NOW: Settings → This story → The brief: "Write it from my #story concept" — finds the first #story he sent on the
  tale's own pages (the typed form, or the text), writes the raw concept into the brief at once, then the polished
  words (agents/concept.js, names and facts guarded); a brief already written is replaced only after the question
  (No keeps it); no #story on the pages → a toast, nothing written. The switch "A #story concept becomes the brief by
  itself, when the brief is empty" (`conceptToBrief`, on by default; in the house reset): off, a #story leaves the brief
  alone and the button is the only way. One path for both (chat.js briefFromConcept); the brief box in Settings follows
  a write.
- TESTS: walk DOM-122 — the button writes the brief from a #story ten pages back and the box follows; a written
  brief asks first and No keeps it; the switch off leaves an empty brief empty on a #story. Walk 140/140, lint 0.
- version.js -> m479-001.
