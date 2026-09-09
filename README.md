# Cozy Tavern

A quiet place to tell stories, one exchange at a time. Cozy Tavern is a
storyteller you can carry in your pocket: a plain web app — no build step,
no accounts, nothing to install but a browser — that keeps your stories,
your keys, and your words on your device, and pairs you with a storyteller
of your choosing (Claude, OpenAI, OpenRouter, or any compatible address).
Around the telling it keeps a ledger of what the scene knows — the hour,
who's here, what the body remembers, what stands between people, what's
happening elsewhere — so a long tale stays true to itself.

## Opening the door

**On Termux (Android) — one line, once:**

```bash
bash <(curl -sL https://raw.githubusercontent.com/brucestarkallen/Cozy-Tavern-/main/install.sh)
```

That installs what you need, clones the tavern, and leaves you a single word
for the rest of your life:

```bash
cozytavern      # updates, lights the lamps, opens the browser
```

The tavern lives at **http://127.0.0.1:8080** (we print 127.0.0.1 on purpose —
on some phones "localhost" wanders to IPv6 while the server listens on IPv4;
the number never wanders).

**Anywhere else** — any static file server will do. The one in the box:

```bash
bash serve.sh        # serves on http://127.0.0.1:8080
```

Hosted on GitHub Pages it works exactly the same — every URL in the app is
relative. On a phone, add it to your home screen and it behaves like a small
book that remembers where you left off; the shell keeps working even when the
network doesn't. **One honest note:** each address (Pages, 127.0.0.1,
localhost) keeps its own separate shelf of stories — pick one as your main,
and move between them any time with backup/restore in settings.

## Keeping it current

The tavern tops itself up: every `cozytavern` run pulls the latest tales
before lighting the lamps.

- **When a new version lands, the tavern tells you.** A small toast appears
  — *"A new coat is on the tavern — tap to refresh."* One tap and you're
  running the new coat.
- **On an older tavern (before the nudge existed), the word comes from the
  command instead.** If `cozytavern` says *"A new coat is on — if the tavern
  looks the same, pull the page down once to reload."*, do just that: pull
  the page down once in your browser and the new version takes over.
- **To see which version is running:** the quiet line under your stories in
  the sidebar, or the top of Settings — both read `the shelves · <version>`.

## How the tavern works

One connection does everything. Add a single connection (Claude, OpenAI,
OpenRouter, or a compatible address) and it tells the story *and* carries the
workers — the quiet hands that keep the ledger, the memory, and the referee
honest. If you want the story to feel faster, you may give the workers their
own cheaper, quicker connection in settings ("The workers") — never required.

Each turn: the tavern assembles only what the scene needs — the frame, the
craft, who's here, the state of things, the rules this scene calls for, what
remains of older pages — and the storyteller streams back. Then the workers
read the page in the background and update the ledger. Every reply carries a
receipt: tap it to see exactly what the storyteller saw, and why.


## The rooms

- **Your stories** — the list on the left (or behind the ☰ on a small
  screen). Start one, name it, come back to it whenever.
- **The story so far** — the thread itself. Long-press or right-click any
  passage to copy it, or have the storyteller rewrite from that point.
- **The frame** — the standing word given to the storyteller before anything
  else. One for every story, or a private one per tale.
- **The note at the end** — a last quiet word slipped in just before the
  storyteller writes.
- **The brief & Who's here** — what this one story is about, and who's in
  it, in your own words.
- **The rulebook** — house rules the storyteller keeps in mind. Some wake on
  their own when the scene calls for them; any can be pinned on by hand; you
  can write your own. Editing a house rule forks it — the original stays
  restorable.
- **The ledger** — the drawer on the right: the clock, who's here, the mood
  of the scene, how they're holding up, on their mind, what's happening
  elsewhere, what's true of them, what changed and why (every change in
  plain words, the latest one take-back-able).
- **The receipt** — under any reply, "What the storyteller saw" opens the
  record of exactly what was sent that turn, slot by slot, with timings.

## The engines and the agents, in plain words

One streamed generation per turn — nothing ever queues ahead of the story.

After a page is finished (never during), quiet workers read it: an
**extractor** keeps the ledger honest (the clock moves, people come and go,
hurts and feelings are written down with their causes); a **memory keeper**
folds pages that have scrolled past into short, faithful notes the
storyteller still sees; an optional **second reader** notes drift against
what's been locked down — it flags, it never touches the words.

Before a turn, exactly one agent may speak, and only when the moment is
genuinely chancy: the **referee** rolls a real die (in code, never by the
model) against the state of the scene and rules the outcome as fact.
"#roll I leap the gap", or a fight on, and the house has ruled.

## Bringing your SillyTavern life

In Settings, all of it read on this device, nothing uploaded:

- **Bring your engine** — a preset JSON, sorted into the craft, the
  rulebook, seeds for the frame, and a retired shelf with reasons.
- **Bring your people** — character cards (a PNG with the character tucked
  inside, or a JSON card) into the cast library; a story invites them in
  from the ledger's Who's here, and their words ride along when they're
  present in the scene.
- **Bring your lore** — a World Info lorebook per story. Entries stay on the
  shelf until one of their words is spoken in the latest pages; then they
  ride along within budget. Plain keyword listening — no model is woken.
- **Bring your old chats** — a chat export (.jsonl) becomes a new story on
  your shelf, pages in order, every word as written.

## Privacy

Everything lives in your browser's local storage on your device. The only
traffic outward is to the storyteller and worker connections you chose, when
you send a turn. Backups are a single JSON file you carry yourself:
Settings → Backup → **Take a copy** / **Bring a copy back**.

## For the curious

Plain ES modules, IndexedDB for storage, a service worker for the offline
shell. No frameworks, no CDNs, no fonts fetched from elsewhere. See
`AGENTS.md` if you're here to tend the code, and `tests/smoke.md` for the
evening walkthrough — the by-hand checklist that keeps every milestone
honest.
