# Cozy Tavern — handoff for the next session (state at m152-001)

Repo: https://github.com/brucestarkallen/Cozy-Tavern- (main). Every commit is tested first.
Full history of every law and fix: AGENTS.md (M1 … M152). SPEC.md holds the founding design.

## Run the tests before any commit (all three; all must be green)
- `node tests/harness/run.mjs` — 395 checks on the engines, assembler, workers, laws.
- `cd tests/dom && node run.mjs` — the walk: 35 scenarios of the real app in jsdom (every button,
  the random checkpoint walk, branches on old stores, the ripple, the housekeeper, resume).
- `cd tests/dom && node longplay.mjs` — ninety turns of the real app against scripted models
  (flat context, the clock, arrivals, windows, the audit, the record's lines).
- Real-browser frame timing (Playwright, CPU 6×): the session's /tmp/perf.py measured drawer and
  settings open/scroll/close; recreate from AGENTS.md M145 if needed.

## The laws that matter most (all enforced in code and held by tests)
- One writer per ledger fact; every second writer is a named guard (M131). The moment (posture,
  wardrobe, mood, the ground, the hour) is the extractor's from the newest page; the header line
  is the truth for ground and hour (M128); an absent person's now is the world agent's seat
  (M130); the auditor and second reader judge only what lasts, never the moment (M123/M128), and
  the second reader never calls absence drift (M129); a writer's unanswered page is an attempt
  (M110); a window's people are elsewhere (M129).
- Branches carry that page's exact ledger: newest page = as it stands; older = checkpoint chain;
  the journal fold only where it reaches AND covers (M91, M106, M147); a branch during a running
  chain re-reads its last page (M112); a story closed mid-chain finishes on open (M127).
- Any edit ripples (M100): a name in code everywhere; a value through the mender + a correction.
- The record: keeper folds, verifier checks, detail auditor keeps, hard tokens checked in code
  (M111); a brief that contradicts a page: the brief wins, page mended, record corrected (M90).
- Seats have a life in code (M103); loose ends close on sense and evict the oldest (M134); the
  hour's law is spoken from the clock and a clock jump re-seats everyone (M134).
- The housekeeper's cards land on arrival with undo (M96); a loose anchor is verified and
  re-asked once (M119); the [NOTHING HAPPENED] nudge fires only on a real claim (M118/M126);
  record handles are unique (M124).
- Provider defenses: control-token leak (M117), page written in the thinking (M120), a glitch
  character mended (M119), re-asks silent on the page (M122).
- Performance: the store's read cache (M137); the books off the main thread with stamps (M140);
  nothing unmounted (M143/M145); the drawer fades, scrolls in its inner box, draws only the open
  room, shows when quiet, by-hand clock folded (M146–M151); turns on screen (M136).
- Data: serve.py keeps ~/.cozytavern/books.json; a fresh browser pulls it at open (reloads once
  if the pull was slow); Settings → The house → Backup exports/imports everything.

## Known limits (not bugs)
- The prose of the model the writer points at it. The house hands it the truth and catches
  slips; it cannot write for it.
- A branch far beyond ~250 turns in a story whose checkpoints were pruned falls to the founder +
  deep re-read path (a toast says so).
- The preset's own copies of Voices/TWB/Contested Resolution on an already-imported shelf are
  never sent and shadow nothing; deleting them is optional.
