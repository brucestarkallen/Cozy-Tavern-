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

---

# M5 — bring your engine (preset migration)

Run these after anything that touches the importer, the rulebook's predicate
keys, or the settings view. They mirror the M5 acceptance checklist in
SPEC.md. The harness checks (§24) are Node scripts kept in /tmp during
development — not shipped with the app. **The real V176 preset lives at
/tmp/v176-preset.json for harness and hand testing only. It must never be
committed, copied into fixtures, or shipped — grep the tree for its words
before every commit.**

## 23. Bringing a preset home, end to end

1. Settings → **Bring your engine**. Choose the preset file (the /tmp copy
   when testing) — or paste its whole text — and **Read it over**.
2. The preview sorts every block into plain-word groups: **The craft**
   (always with the storyteller), **The rulebook** (each row says when it
   wakes — "wakes when the scene turns intimate", "wakes when the room is
   full of voices", "you choose when this walks in"), **Seeds for the frame
   & the note** (copy-only, with **Copy for the frame** / **Copy for the
   note** buttons), **Retired into the house** (each with its why — "the
   ledger renders it"), and a quiet count of what was left behind (markers,
   off-switches, empty husks).
3. With the real V176 file: 50 blocks read, all accounted for — 10 craft,
   9 rulebook, 3 seeds, 10 retired (5 to the engines, 2 to the house, 3
   thinking-aloud blocks), 18 left behind. Nothing marked "a guess".
4. Untick one rulebook row → **Bring it home** → the summary line speaks in
   plain words (the craft now carries your words; N rules joined; M rest on
   the retired shelf), and the unticked rule is absent from the rulebook.
5. The rulebook shows the new rules immediately; the manual ones carry the
   quiet line "you choose when this walks in". **The craft** card shows
   "— your version"; **Put back the original** restores the shipped text.
6. Send a turn: the receipt's **The craft** slot has grown to the imported
   word count. Pin the imported NSFW rule → next turn's receipt names it in
   Active modules with "pinned on by you".
7. Read the same preset in again → **Bring it home** → the summary says the
   rules were already home; the rulebook shows no duplicates.
8. Empty textarea → **Read it over** → a kind nudge, nothing applied.
   Garbage text or a non-preset JSON → a kind error ("doesn't read like…"),
   nothing applied, the rulebook untouched.
9. Frame seeds are never written for you: after apply, The frame and The
   note hold exactly what they held before.

## 24. Harness checks (Node, mocked)

The M5 harness lives outside the app (/tmp/m5-harness.mjs during
development; rebuild per the contracts if it's gone). It covers: full
known-map classification of the real preset (counts above, zero guessed,
zero unaccounted); heuristic fallback classes (intimate/combat/socialField/
manual/frameSeed/skipped/craft, all marked "guessed"); applyPlan round-trip
through an IndexedDB shim (craft fork restorable, whenKeys survive
persistence, manual notes ride along); dedupe-on-apply (identical re-import
adds nothing; same name + different words gets a numbered suffix, and that
suffix is itself idempotent); exclusions respected; garbage/empty/wrong-
shape JSON all failing kindly. A second harness (/tmp/m5-regression.mjs)
re-proves the M1–M4 contracts the M5 files touch: builtin modules and
reasons, fork/restore, the ten-slot receipt order, note-last message law,
and engine mutations/undo.

## 25. Regression

- M1 (§1–§8), M2 (§9–§12), M3 (§13–§17), and M4 (§18–§22) still pass,
  untouched. Both /tmp harnesses are green.
- The importer never joins the send path: it runs only from settings, only
  when asked, and makes no network calls at all.
- `node --check` clean on every `.js` file; sw.js cache bumped (v5) with
  the two new import modules in the shell list; the app still loads
  offline.

## 26. The referee — the trigger law

- In a calm scene, send `#roll I leap the gap between the roofs`. Before
  the storyteller writes, the drawer’s “The house has ruled” panel shows
  the ruling — the roll, the mark, the outcome words — and the page that
  follows honors it. Receipt → slot 5 carries “The house has ruled: …”.
- Send a plain message in a calm scene: no ruling, and no ruling line rides
  the stack.
- Switch combat on in the drawer, send a plain message: the referee rules
  again (a fight counts as contested). Switch it off: quiet again.
- After the ruled page, send one more plain message: its slot 5 no longer
  carries the ruling (consumed and cleared); the drawer keeps the echo.

## 27. The canon store

- Drawer → “What’s true of them”: lock “Mara — hair: black”. It lists; the
  next turn’s slot 5 carries “True of them: Mara — hair: black.” while Mara
  is present (a locked truth about someone off-page stays off the stack).
- Tap × beside it: the truth lets go, the next receipt no longer carries
  it. Both the lock and the unlock undo from “What changed and why”.

## 28. The memory keeper

- Settings → “How much the story remembers”: the keeper is on by default,
  30 pages word for word (slider 10–100).
- Tell a story past window+20 pages (51 by default): the receipt gains
  “What remains” with a short, faithful note of the oldest pages — names,
  promises, hurts, not embellishments. Older turns without memory show no
  “What remains” slot at all (M6: the slot appears only when present,
  superseding §9.2’s “kept place”).
- Slide the window down to 10: notes gather sooner. Switch the keeper off:
  no new notes; the ones already folded stay.
- Keep writing long enough for seven level-1 notes: the oldest three fold
  into one wider note (level 2), which leads “What remains”.

## 29. The continuity check

- Default OFF. Settings → switch the second reader on.
- With “Mara — hair: black” locked, coax a page where her hair reads
  blonde. Moments after the page finishes: the message’s receipt shows a
  “Drift” section, and the drawer’s “Something drifted” lists it. The words
  themselves are never touched; an empty findings list renders nothing.
- With the switch off, no reading happens at all.

## 30. One stream, as ever (M6 latency law)

- Watch traffic (or a local mock): each send streams exactly ONE story
  call. The referee, when triggered, is one tiny cold call (max 150 tokens)
  before it. Extractor → memory keeper → continuity reader run only after
  the stream completes, in that order; the next send waits on each for at
  most five seconds, then goes on with last-good state.
- Kill the network mid-flight: the story still streams; every worker fails
  quietly; no ruling, no notes, no drift — and no error in the chat.

## 31. Regression

- M1 (§1–§8), M2 (§9–§12), M3 (§13–§17), M4 (§18–§22), and M5 (§23–§25)
  still pass, untouched. Both /tmp harnesses are green
  (m6-harness.mjs: 150 checks; m6-regression.mjs: 73 checks).
- `node --check` clean on every `.js` file; sw.js cache bumped (v6) with
  the four new modules in the shell list; backup/restore carries
  `memory:<storyId>`; deleting a story lets its memory go with it.



---

# M7 — bring your people, your lore, your old chats (v1 complete)

Run these after anything that touches the importers, the cast library, the
lore shelf, slots 4 or 7, or the settings view. They mirror the M7
acceptance checklist in SPEC.md. The harness checks (§35) are Node scripts
kept in /tmp during development — not shipped with the app. PNG card
fixtures are built in /tmp with Pillow (`/tmp/m7-fixtures.py`); nothing of
the kind is ever committed.

## 32. Bring your people (character cards)

1. Settings → **Bring your people** → **Choose a card** → pick a v2 PNG
   card (a harness-built one from /tmp when testing). The shelf lists the
   character — name, "from a picture", a taste of their description, and
   any other greetings counted.
2. Choose a JSON card (with alternate greetings inside): it shelves the
   same way, "from a JSON card".
3. Choose an ordinary picture (no character inside): a kind line — "That
   picture doesn't carry a character." — and nothing shelves.
4. Open a story → the ledger → **Who's here** → invite the character in
   (the picker by the list, **Invite them in**). They appear with the
   book-mark (❧). Write their name into the scene (the same Who's here
   panel), then send a turn: the receipt's slot 4 carries
   `name — description`, trimmed to its 400 characters.
5. Someone invited but NOT written into the scene does not ride slot 4.
6. **Let go** of a card in Settings (with its confirm): it leaves the
   shelf AND every story's cast list.
7. The × beside an invited card in the ledger lets the invitation go
   without letting go of the card.

## 33. Bring your lore (World Info)

1. With a story open: Settings → **Bring your lore** → choose a lorebook
   JSON → the count line reads "N entries on the shelf".
2. Send a turn whose recent words speak one of the entry keys (whole word —
   "ash" wakes on "the ash pit", never on "Ashford"): the NEXT turn's
   receipt shows **The lore shelf** under What remains, with the entry's
   words, within the shared budget. A turn that speaks no key changes
   nothing — no lore slot at all.
3. The shelf is per story: another story reads empty until stocked.
4. **Take the shelf down** (with its confirm) clears it; the lore slot
   goes quiet.

## 34. Bring your old chats (JSONL)

1. Settings → **Bring your old chats** → choose a SillyTavern .jsonl
   export → a new story appears on the shelf ("With <name>"), already
   active, pages in order, roles as they were, prose verbatim.
2. Send a message in it: the tale simply continues, receipt and all.
3. A file that isn't a chat export (no metadata up top, a malformed line,
   a line with no words) fails kindly, names the line when it can, and
   nothing is created.

## 35. Backup, removal, and the offline shell

1. With a card shelved and a lore shelf stocked: Settings → Backup →
   **Take a copy**. Wipe the store (devtools → IndexedDB → delete
   `cozytavern.v1`), reload, **Bring a copy back**: the cast library and
   every story's lore shelf return (they ride in the settings store).
2. Let go of a story that had lore: its `lore:` key goes with it; the cast
   library is untouched.
3. Devtools → Network → Offline → reload: the shell loads (sw cache v6,
   every shipped file listed), your stories open and read; sending fails
   kindly ("Couldn't reach…" style, no stack).
4. Focus through the app with a keyboard: every control shows a visible
   ring. With the device's reduce-motion setting on, nothing slides or
   blinks.

## 36. Harness checks (Node, mocked)

The M7 harness lives outside the app (/tmp/m7-harness.mjs during
development; fixtures from /tmp/m7-fixtures.py via Pillow). It covers: the
PNG chunk walker (tEXt, iTXt plain and zlib-compressed, bad CRC on the
chara chunk, multi-chunk with decoys, truncated files, non-card PNG kind
errors); JSON cards incl. v1 flat shape and alternate_greetings; lorebook
parse (entries object and array, `key`/`keys`, `disable`), whole-word
scoring (distinct keys, case-insensitive, "Ashford" ≠ "ash"), and budget
enforcement; chat JSONL role mapping (missing is_user → assistant, missing
send_date keeps order) and kind-failures (no metadata, malformed line with
line number, missing mes, cover-only); slot 4 budget (1600) and per-card
trim (400); slot 7 shared budget (memory first, lore in the room left,
both sub-parts on the receipt only when present); cast/lore store
round-trips via the IndexedDB shim; story-removal cleanup (lore gone, cast
survives); backup carrying cast + lore. All green at commit time (115
checks), plus the full M1–M6 re-run (150 + 73 checks, green).

## 37. Regression

- M1 (§1–§8), M2 (§9–§12), M3 (§13–§17), M4 (§18–§22), M5 (§23–§25), and
  M6 (§26–§31) still pass, untouched.
- The latency law stands: importers run only from Settings, only when
  asked, and make no network calls; lore retrieval is plain keyword
  listening, no model involved; exactly one streamed generation per turn.
- `node --check` clean on every `.js` file; sw.js cache bumped (v6) with
  the three new import modules in the shell list; README.md rewritten as
  the v1 front door.

## M8/M8.5 additions
38. First run: no story, no connection — type words, Send → story is auto-created from the words; a kind note asks for a connection; typed text is never lost.
39. Connection editor: "Fetch what's on offer" lists models (openai-compatible + anthropic); thinking effort control; temperature/top-p/longest reply/context size dials persist.
40. Reasoning on (Claude or reasoning_content provider): thinking streams into the folded "what the storyteller weighed" block; folds when prose starts; persists folded after reload; receipt shows first-thought/first-word timings + effort.
41. Stop mid-stream: partial page kept, labeled "stopped mid-sentence".
42. Ember bar fills with context use; glows past 72%.
43. Themes: hearth (dark, default) and parchment both render; choice persists.

## M9 — the interaction loop & truth fixes
44. Swipes: on an assistant page, swipe right — a new version generates and the old one is kept; ◂ n/m ▸ walks versions; editing the user message first rolls fresh.
45. Edit any page (yours or the storyteller's) inline; deleting one page asks kindly and takes only itself.
46. "Go on" on the last page continues without leaving a visible "continue" bubble.
47. A reply cut short by length says so, with a "Go on" offer; an empty answer never vanishes silently.
48. #question, ((…)), // asides answer out of story; #p #pp #continue #time parse to quiet directives with a chip in the composer; unknown # passes through with a hint.
49. The lore shelf: entries can be seen, edited, toggled, reordered, deleted; constant entries always ride; the receipt names what fired.
50. Cards: attaching offers their greeting as the opener; personality/scenario ride the who's-here slot; inviting a card seats them in the scene.
51. Custom rules can pick when they wake (trigger picker) and carry a note.
52. Per-story connection override; "The workers" line in the ledger shows each worker's last run and any failure.
53. Second tab opens read-only with a plain notice.
54. Memory window law: the story-so-far carries only the window; older pages live in What remains; keeper-off cuts by token budget and says so on the receipt.
55. Harnesses ship in the repo: `node tests/harness/run.mjs`.

## M10 — the housekeeper & the showrunners
56. The housekeeper (right sheet) sees the whole tale; ask it to fix a line and it proposes red/green cards — Apply, hand-edit, or Skip; Apply-all with staleness marks.
57. Undo refuses loudly when the page drifted since the proposal.
58. Ledger edits ride the same validated mutations as everything else; rulebook text edits propose as cards.
59. The director: New episode / Next / Seed / edit; auto mode writes the next when one concludes; [EPISODE_END] never shows in prose.
60. The editor's standing notes ride when enabled; both showrunner notes are named on the receipt.

## M11 — the autonomous referee
- [ ] Settings → The referee: master switch, readiness (conservative/normal/aggressive), world tilt (gritty/realistic/heroic), fight keeping (tracked/outcome-only) — all persist across reload.
- [ ] A chancy attempt ("I try to sneak past the guard") rules BEFORE the page writes: the receipt names "The house has ruled" in the dynamic tail; the drawer panel echoes the ruling.
- [ ] Pure dialogue ("He growls 'I could kill you'") and ((OOC)) never trigger a ruling; a quiet beat stays quiet.
- [ ] A swipe or regenerate replays the SAME ruling word for word; editing the message rolls fresh; deleting the last exchange rewinds the duel.
- [ ] "I draw my blade" arms a duel without rolling (round 0, standoff directive); the next attack is round 1; the duel line shows in "The state of things" and the combat mood rides the mode ledger.
- [ ] A duel ends when a pool empties; injuries land in the body ledger when the fight lets go; "How they measure" (drawer) shows/updates the sheet; the sheet seeds itself after the first turns and after fights.
- [ ] #roll forces a ruling on a quiet beat; #skip waves one off; with no worker connection the story simply goes on unruled.
