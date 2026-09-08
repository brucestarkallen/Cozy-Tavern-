# Smoke — an evening walkthrough

Run through this by hand after any change that touches the shell, the store,
the providers, or the send path. It mirrors the acceptance checklist in
SPEC.md. Anything that can't be automated (IndexedDB, live provider calls)
is exercised here in the browser.

## 0. Before you start

- `node --check` every `.js` file — all must parse clean.
- `manifest.webmanifest` must be valid JSON (open devtools → Application →
  Manifest, no errors; the install prompt should appear).

## 1. Serving & the offline shell

1. `bash serve.sh` → "The tavern is warm at http://localhost:8080".
2. Open `http://localhost:8080`. The app loads, warm paper tones, serif prose.
3. Devtools → Application → Service Workers: `sw.js` activated.
4. Devtools → Network → Offline → reload. The shell still loads and renders
   (no storyteller calls, of course — those are network-only by design).
5. "Add to Home Screen" / install prompt appears (manifest + icons valid).

## 2. Connections

1. Settings → **Add a connection** → preset **Claude**. Paste a real key.
2. **Test** → "Claude answered — the line is good."
   - With a bad key: "The key wasn’t accepted…" (no stack, no raw JSON).
3. Add another with preset **OpenRouter** (base address should read
   `https://openrouter.ai/api`, model e.g. `anthropic/claude-sonnet-4.5`).
4. **Test** → ok. **Use this one** switches the active connection; the card
   shows "— the one you’re using".
5. Reload. Both connections and the active choice survive.

## 3. A story, end to end

1. **Start a new story** → name it "Ash and Ember" → **Keep it**.
2. Composer: "The door opens on a rainy evening." → **Send**.
3. The reply streams in token by token (a caret blinks while writing).
   **Stop** mid-stream keeps whatever arrived and saves it.
4. Reload the page. The story and its pages are still there, in order.
5. Long-press (or right-click) the reply → **Copy the words** puts it on the
   clipboard; **Rewrite from here** discards from that point and writes again.
   Long-press your own message → **Rewrite from here** re-sends from it.
6. Rename the story (✎), let go of a scratch story (×) with its confirm.

## 4. The frame & the note at the end

1. Settings → The frame → change the global text, **Keep it**.
2. Send a message. Devtools → Network → the request payload's `system`
   (anthropic) or first `system` message (openai) shows the new frame text.
   - Anthropic: `system` is an array of blocks; the last block carries
     `cache_control: {type: "ephemeral"}`.
3. The note at the end: write one, keep it, send. The final message in the
   payload is a user-role message containing the note.
4. Per-story: with a story open, write a frame "just for" it. The next
   request uses the override; other stories keep the global one.

## 5. Backup & restore

1. Settings → Backup → **Take a copy**. A `cozy-tavern-backup-….json`
   downloads. Open it: `namespace` reads `cozytavern.v1`; all four stores
   are present.
2. Devtools → Application → IndexedDB → delete `cozytavern.v1`. Reload —
   the tavern is empty.
3. **Bring a copy back** → choose the file → confirm. Everything — stories,
   pages, connections, the frame, the note, the theme — returns.

## 6. Appearance

1. Settings → Appearance → **Lamplight**: the room dims. Reload: still dark.
2. **Follow the sky**: matches the device's light/dark setting, and flips
   live when the device does.

## 7. The ledger

1. **The ledger** (top right) slides in: "Who's here", "The clock",
   "On their mind", each saying "Coming as the engine wakes up."
2. Esc, the ×, or tapping the dimmed page closes it.

## 8. Voice sweep

Read every visible string aloud. Nothing corporate, nothing gamey, no
version numbers, no "success!". Errors point at a next step.
