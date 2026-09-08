# Cozy Tavern

A quiet place to tell stories, one exchange at a time.

Cozy Tavern is a standalone storyteller you can carry in your pocket. It's a
plain web app — no build step, no accounts, nothing to install but a browser.
Your stories, your keys, and your words live on your device.

## Opening the door

Any static file server will do. The one that ships in the box:

```bash
bash serve.sh        # serves on http://localhost:8080
```

Then visit `http://localhost:8080`. On a phone you can add it to your home
screen and it behaves like a small book that remembers where you left off —
the shell keeps working even when the network doesn't.

## Using the tavern

- **Your stories** — the list on the left (or behind the ☰ on a small screen).
  Start one, name it, come back to it whenever.
- **The story so far** — the thread itself. Long-press or right-click any
  passage to copy it or have the storyteller rewrite from that point.
- **Settings** — where connections live (Claude, OpenAI, OpenRouter, or a
  custom address), along with the frame, the note at the end, appearance, and
  backup.
- **The frame** — the standing word given to the storyteller before anything
  else. One for every story, or a private one per tale.
- **The note at the end** — a last quiet word slipped in just before the
  storyteller writes.
- **The ledger** — the drawer on the right. For now it holds placeholders;
  it fills in as the engine wakes up in later milestones.

## Keeping your words safe

Settings → Backup → **Take a copy** downloads everything as one JSON file.
**Bring a copy back** restores it. Nothing leaves your device except the
messages you send to the storyteller you chose.

## For the curious

Plain ES modules, IndexedDB for storage, a service worker for the offline
shell. No frameworks, no CDNs, no fonts fetched from elsewhere. See
`AGENTS.md` if you're here to tend the code, and `tests/smoke.md` for the
evening walkthrough.
