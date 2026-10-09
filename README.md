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

### Opening the tavern under another name (another device, a forwarder)

The tavern's server listens on this device alone, and it keeps its books for
pages opened under its own name: `127.0.0.1` or `localhost`. If you reach it
some other way — from a tablet through a port-forward or a proxy, under the
phone's LAN address or a name of your own — the page still opens, but the
server turns the books' doors away, and the app says so: *"The tavern is
running, but it does not answer under this address…"*. Until you start it for
that name, nothing written there reaches the device.

Name every extra address in `COZY_HOSTS` when you start it (names or
addresses, comma-separated, no port needed):

```bash
COZY_HOSTS=192.168.1.23 cozytavern               # Termux: the one word, for one more address
COZY_HOSTS=192.168.1.23,tablet.lan bash serve.sh # anywhere else, two of them
```

Then refresh the page. A proxy in front of the tavern must pass on the address
it was asked under (`Host`, or `X-Forwarded-Host`) — the server checks that a
page writing to it is its own. Remember the honest note above: that address
keeps its own shelf in its own browser, sharing the device's books.

**Two browsers, one tale — one more honest note.** Two browsers that can both
reach the tavern hand each other every page the moment it lands. But if you
write the *same tale* in two browsers while one of them cannot reach the
tavern (the phone asleep, the Wi-Fi gone), the one that reaches it last puts
its telling of that tale on the device, and the pages the other wrote
meanwhile are gone. Write a tale from one browser at a time, or take a copy
first.

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

## Starting the storyteller's reply (the prefill)

Settings → Storyteller → your connection → **Change** → *Start the reply for it*.

**How it is sent — As written** (works everywhere a prefill works):
- `Some words` — the reply starts with these words, already written.
- `<think>Some words` — the model's *thinking* starts with these words (DeepSeek, Moonshot, OpenRouter).
- `<think>Some words</think>[The gate — ` — both: the thinking starts with *Some words*, the reply with *[The gate — *.
- Words written before the scene header line go into the thinking box while *Anything written before the header is
  thinking, not page* is on (it is, unless you untick it) — so start the reply with the header if it should be on the page.

**How it is sent — Structured** (OpenAI, and OpenRouter models that list "structured outputs"; DeepSeek and Moonshot
always use As written): the reply must *begin* with your words, and the model writes them itself — it is not handed
them, so it cannot refuse at the first word or skip them. The page looks exactly like a normal page.

The easy way — **Ready-made template** (shown when Structured is chosen): pick one, type your words, press
*Put it in the prefill box*, then *Keep it*.
1. **Your words open every page, right after the scene header** — `[The yard — Monday | 09:00]` then your words, then the scene.
2. **It plans first (you never see the plan), then writes the page** — your words are optional.
3. **Another model starts every page (the opener)** — pick the opener in Settings → The workers.
4. **It thinks in your words first (in the thinking box), then writes the page** — your words start its thinking, like a
   thinking prefill, but the model writes them itself. Works with its own thinking on or off: both go in the thinking box.
5. **It weighs three paths and picks one (in the thinking box), then writes the page** — a short form it cannot skip.

In Structured, a `<think>…</think>` at the start of your prefill is a thinking block the model must write itself (it goes in
the thinking box, beside the model's own thinking); a `<think>` you never close lets it think as long as it likes, then
it must close the thought and write the page.

Writing your own: `[[keep]]` hides everything before it; `[[w:2-5]]` 2–5 words; `[[opt:A|B]]` one of these; `[[line]]`
one line; `[[lines:2-4]]`; `[[num]]`; `[[number:1-100]]`; `[[emotion]]`; `[[name]]`; `[[action]]`; `[[thought]]`;
`[[re:…]]` your own pattern; `[[pg]]` the opener's words; `[[end]]` the reply ends there. *Words it can never write* — up to
about three, any capitals. *At least this many characters after it* — 80 unless you change it.

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

## Where your tales live

Served from Termux (or any `serve.py`), the tavern keeps its books **on the device, in a
real file** — `~/.cozytavern/books.json`, rotated and written atomically after every turn.
Clear the browser's data, wipe the app folder, replace the phone's browser — the tales walk
back in. On GitHub Pages there is no little server, so the tales live in the browser alone,
and the Backup section says so plainly.

What takes the room on the device is "what the storyteller saw" — the words sent with every
page, kept beside each tale so a receipt can always be opened. A **branch** keeps its own copy
of those words for the pages it carries (so letting the first tale go never takes them with
it): a branch of a long tale costs about what that tale's kept words cost, again, on the
device and in every copy you take.

## Starting over clean

The tavern's files are just files — deleting them never touches your stories,
your keys, or your settings; those live in the browser. To wipe and replant:

```bash
rm -rf ~/cozytavern
bash <(curl -sL https://raw.githubusercontent.com/brucestarkallen/Cozy-Tavern-/main/install.sh)
cozytavern
```

(If a lamp stayed lit from an old folder, douse it first: `pkill -f "python3 serve.py"`
— mind: that also douses Cozy Chat's lamp; relight it anytime with `cozy`.)
