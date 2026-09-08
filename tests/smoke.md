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


---

# M3 — the scene-state engine & the workers

Run these after anything that touches the clock, the applier, the extractor,
the ledger drawer, or the send path. They mirror the M3 acceptance checklist
in SPEC.md. The mocked-LLM checks (§16) are Node harnesses kept in /tmp
during development — not shipped with the app.

## 13. The clock comes alive

1. Tell a story turn where time clearly passes ("Half an hour later, the
   walk to the chapel behind them…"). When the page finishes, wait a breath
   (the workers read after the last token, never during).
2. Open **The ledger → The clock**: the hour has moved on. If the clock was
   never set, prose that fixes a time ("It was two in the afternoon") sets it.
3. Next turn's receipt: **The state of things** carries "The hour: …".
4. By hand: The clock panel → set the time (year/month/day/hour/minute) →
   **Set the clock**; the +15m / +1h buttons and the minutes field move it
   on. Each move appears in **What changed and why** in plain words.
5. Calendar: switch to **A calendar of its own**, write month and day names
   (comma lists), **Keep the names** — the clock speaks them, borrowing the
   real names for any slot left blank.

## 14. Who's here & the mood of the scene

1. A page where someone clearly leaves ("Samantha slipped out into the
   rain") → the ledger's Who's here loses her; **What changed and why** says
   so in a sentence; **Take it back** on the newest entry walks her back in.
2. A page that turns to combat → **The mood of the scene** shows "A fight is
   on" checked; the NEXT turn's receipt loads "When words won’t carry it"
   with the reason from the state ("talk has given way — the moment is
   contested").
3. Hand add/remove in Who's here still works and is logged the same way;
   mood checkboxes toggle by hand, logged the same way.
4. Position and attire, when the prose shows them, appear beside the name —
   and ride the next turn's slot 5.

## 15. The workers & the send path

1. Settings → **The workers**: pick who does the reading (default: the same
   one telling the story). The choice survives a reload.
2. Uncheck **Keep the ledger for this story** → send turns → no changes in
   What changed and why, chat entirely unaffected. Re-check → the workers
   resume.
3. Rapid second send while the workers are still reading (send again the
   moment the stream ends): the send waits for them — hard ceiling of five
   seconds, then it goes on with last-good state. The next turn's receipt
   shows the consistent state (harness-verified too).
4. Under an assistant reply, **What the storyteller saw** → the sheet now
   ends with **After this turn**: each applied change in plain words, or
   "Nothing in the ledger changed." Reload — it persists on the message.
5. Point the workers at a connection that will answer garbage (or take the
   device offline mid-extraction): nothing breaks, no error in the thread,
   the ledger simply doesn't move.

## 16. Harness checks (Node, mocked)

The M3 harnesses live outside the app. To re-run them, recreate per the
contracts: clock set/advance/render incl. custom calendars; applyMutations
validation (junk rejected with reasons, name normalization, delta clamps);
undoLast reversibility; extractor with a mocked provider (clean JSON, fenced
JSON, prose-wrapped JSON, garbage → `{"mutations":[]}`); the send path
awaiting an in-flight extraction (5s ceiling); state v1→v2 migration without
loss; state round-trip through an IndexedDB shim. All must pass.

## 17. Regression

- M1 (§1–§8) and M2 (§9–§12) still pass, untouched.
- Exactly one streamed generation per user turn: devtools → Network shows
  the storytelling call, then (after the stream ends) at most one small,
  cold worker call. Never a worker call before or during the stream.
- `node --check` clean on every `.js` file; the shell (now including
  js/engine/clock.js, js/engine/apply.js, js/agents/extractor.js) is in the
  service worker's cache list and the app still loads offline.

---

# M4 — the ledgers: bodies, standings, and the world elsewhere

Run these after anything that touches the ledgers, the applier's v2
vocabulary, the extractor's prompt, the drawer, or the state render. They
mirror the M4 acceptance checklist in SPEC.md. The harness checks (§21) are
Node scripts kept in /tmp during development — not shipped with the app.

## 18. How they're holding up (the body ledger)

1. Tell a turn where a blow lands on the page ("The beam caught Mara's
   forearm — a crack, and she went white."). Wait a breath after the stream
   ends; the workers read after the last token, never during.
2. Open **The ledger → How they're holding up**: the hurt is written down —
   what it is, how bad (a graze / a real wound / severe), and whether anyone
   saw to it. The NEXT turn's receipt: **The state of things** carries the
   same line, with its age on the story clock ("2h, untreated").
3. Ages move with the clock: advance the hour by hand (The clock → +1h) and
   the age grows. In a story with no clock set, ages count in turns instead.
4. By hand: add a hurt (name, what, how bad, "seen to") and a weariness
   ("A weariness"). Both are logged in What changed and why.
5. **It's healed** marks a hurt healed: it vanishes from the panel and from
   the state of things, but stays in the data (scars of record — reload and
   look at the backup export if you like). **It's lifted** lets a weariness
   go. **Take it back** undoes each.

## 19. On their mind (the standings between people)

1. Tell a turn where an NPC does something kind (or cruel) to the main
   character on the page. The ledger → **On their mind** gains a line:
   warmth (P), pull (R), charge (S) in plain words and numbers, with a
   history note ("drew closer after the dance").
2. Zero-init: before the first earned shift, no entry exists at all. A
   soul with all zeros shows no line in the state of things.
3. The NEXT turn's receipt slot 5 shows the new standing.
4. Hand adjust: name, an axis, "Shift by" an amount — the cause field is
   required; leaving it blank writes nothing. "Set it to" seeds a standing
   outright (the brief's way in), also with a cause.
5. There is no NPC↔NPC anywhere: every standing is toward the main
   character. Undo walks each shift back.

## 20. What's happening elsewhere (the off-screen world)

1. A page where someone clearly leaves for a known place ("Samantha slipped
   out toward the chapel, to light candles for the dead") → the workers seat
   her: **What's happening elsewhere** shows where and what she's at.
   Someone leaving without a stated where gets no seat — the prose has to say.
2. Bring her back on the page ("Samantha came back in, shaking off the
   rain") → the elsewhere note lets go of her on its own (presence.enter
   auto-unseats). Taking that enter back restores the note.
3. By hand: seat someone (name, where, what they're at, "meaning to…" if
   known), re-seat to edit, **Let it go** to clear. All logged, all undoable.
4. The state of things lists at most the six most recently seated, and never
   anyone who is in the scene right now.

## 21. Harness checks (Node, mocked)

The M4 harness lives outside the app (see /tmp/m4-harness.mjs during
development; rebuild per the contracts if it's gone). It covers: body aging
by clock minutes and by turn count, healing (render-gone, data-kept),
severity words; relationship clamps (±20 per beat, ±100 total),
cause-required rejection, zero-init, axis lock (no NPC↔NPC exists);
offscreen top-6-by-recency and present-skip, enter auto-unseat with undo;
v2→v3 migration with no loss; the state-of-things budget (≤ ~1600 chars
even with every ledger full); extractor v2 malformed/fenced/prose-wrapped
JSON resilience and max_tokens 600; undo for every v2 type.
`node --check` clean on every `.js` file.

## 22. Regression

- M1 (§1–§8), M2 (§9–§12), and M3 (§13–§17) still pass, untouched. The M3
  harness checks (/tmp/m3-regression.mjs during development) are green.
- The latency law still holds: exactly one streamed generation per turn;
  the workers read afterward, and a fast second send waits (5s ceiling)
  before assembling.
- `node --check` clean; sw.js cache bumped (v4) with the three new engine
  modules in the shell list; the app still loads offline.
