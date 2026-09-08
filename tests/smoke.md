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
   "On their mind". The clock and mind still say "Coming as the engine wakes
   up." Who's here is real now (see §9).
2. Esc, the ×, or tapping the dimmed page closes it.

## 8. Voice sweep

Read every visible string aloud. Nothing corporate, nothing gamey, no
version numbers, no "success!". Errors point at a next step.

---

# M2 — the assembler & the receipt

Run these after anything that touches the stack, the rulebook, state, or the
receipt. They mirror the M2 acceptance checklist in SPEC.md.

## 9. The receipt, end to end

1. Send a turn. Under the reply, a small line reads **"What the storyteller
   saw"**. Tap it.
2. The sheet "What the storyteller saw this turn" opens and lists all ten
   slots in order: The frame, The craft, The brief, Who's here, The state of
   things, Active modules, What remains, The story so far, The note at the
   end, The continue nudge — each with ~tokens (or "not part of this turn").
3. Footer names the model, "First word in X.Xs", and the total time.
4. Older messages keep their receipts after a reload (they persist on the
   message).

## 10. The rulebook

1. Settings → **The rulebook** lists four house rules; The craft is "always
   on", the others say when they wake.
2. Pin **When the scene turns intimate** → send a turn → the receipt's
   Active modules row names it with "pinned on by you". Unpin → next turn's
   receipt no longer names it.
3. **Read & change the words** on a builtin, edit, **Keep it** → the card
   shows "— your version". **Put back the original** restores the shipped text.
4. **Write a rule of your own**, pin it on, send a turn → it rides in the
   [story-state] injection (visible in the request payload via devtools).

## 11. The brief & who's here (per story)

1. With a story open: Settings → **The brief** → write a line, **Keep it**.
   Next turn's receipt: The brief's token count matches the new text;
   devtools shows it as the third system block (anthropic) / inside the
   single system message (openai).
2. Settings → **Who's here**: write cast notes with a name marked she/her.
   The ledger → Who's here → add that same name. Next turn: slot 4 includes
   both, and The sound of a voice wakes on its own (receipt says
   "a she/her voice is in the scene").
3. Edit the global **frame** → next turn's receipt: slot 1's tokens change.
4. Add two names in the ledger's Who's here → next receipt's slot 4 includes
   them. Reload the page → the ledger still lists them.
5. The receipt's footer shows real timings from the streamed turn, and
   "The state of things" carries who is present.

## 12. The continue nudge & regression

1. Send "continue" as a message → the request's messages end with
   "Go on." just before The note at the end; the note stays last.
2. M1 regression: everything in §1–§8 still passes, including:
   - the frame edit showing up in the request payload (§4),
   - export → wipe → import restoring everything (now including ledger
     state and rulebook pins/overrides, which ride in the settings store),
   - `node --check` clean on every `.js` file.

