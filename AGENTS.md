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
