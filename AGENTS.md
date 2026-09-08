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

