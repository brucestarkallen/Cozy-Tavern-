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
