# Cozy Tavern — handoff for the next session (state at m263-001)

Repo: https://github.com/brucestarkallen/Cozy-Tavern- (main). Every commit is tested first.
Full history of every law and fix: AGENTS.md (M1 … M263). SPEC.md holds the founding design.

## Run the tests before any commit (all three; all must be green)
- `node tests/harness/run.mjs` — 521 checks on the engines, assembler, workers, laws.
- `cd tests/dom && node run.mjs` — the walk: 41 scenarios of the real app in jsdom (every button,
  the random checkpoint walk, branches on old stores, the ripple, the housekeeper, resume).
- `cd tests/dom && node longplay.mjs` — ninety turns of the real app against scripted models
  (flat context, the clock, arrivals, windows, the audit, the record's lines).
- Real-browser frame timing (Playwright, CPU 6×): the session's /tmp/perf.py measured drawer and
  settings open/scroll/close; recreate from AGENTS.md M145 if needed.

## The laws that matter most (all enforced in code and held by tests)
- Every reader that writes or checks the ledger sees ALL of it (engine/whole.js), never the
  storyteller's trimmed copy; every page is read to its END (engine/pagecut.js — a page past its
  cap loses its middle); the auditor reads every page the record has not folded plus the whole
  record, and its doors are an allow-list — it restores only a zero standing and never moves the
  header's ground or hour (M259). A test that says a worker "uses" something must make the call
  and read what was sent.
- A change that changes nothing is `same`: not written, not journaled, not a refusal (M259).
- The mender answers with find → replace edits; a mend never shortens a page (M259).
- The page chain hands every worker its leash (queue.js chainJob); every worker call gets its own
  minute; a long reading asks for a longer one (M259).
- The words (M261): FOLDED = summarized into the record, still in the chat; UNFOLDED = the
  newest pages the storyteller reads word for word; HIDDEN = a separate flag every reader skips.
- One story so far (M261): the extractor, the world agent and the auditor read every unfolded page
  whole into 70% of the room, the record, the whole brief and ledger; 30% is kept for looking.
  Only the new page is news; a beat is counted once (sameBeat).
- Nothing goes stale by itself (M261): the ground moving lets positions go; one place under two
  spellings is one place; an untouched thread cools after 15 pages; the code upkeep (retire,
  sweep, clear seats) runs on every page, audited or not (ledgerUpkeep).
- The writer's own words stand (M263): hand edits (drawer, housekeeper cards) carry a hand mark,
  and every people rebuild keeps them (keepWritersOwn). Squeezed record lines over pages read in
  part are re-read and swapped (rereadMergedLine).
- The house heals what older readers left (M262): record lines read in part are read again two a
  page (partlyReadLines → redoLine); a story with the old auditor's mark has its people re-read
  once (peopleHealDue → rebuildPeople). A people rebuild builds on the side and swaps in whole.
- No reader is cut off by a number (M260): what a worker is shown fits, and anything else — any
  page by its number, "find: WORDS", "brief" — is asked for with the housekeeper's <fetch>
  through the housekeeper's serveFetch (agents/lookup.js). One way to look, for everyone.
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
- The books are NEVER the shell (M160): sw.js must never cache an `api/` answer. It cache-firsted
  every same-origin GET, so the first read of api/books/list was frozen for the life of a version
  — the other browser's newer pages were never seen, and a cached book could overwrite newer
  pages with an older telling. A tale let go leaves a tombstone the manifest names, so no browser
  resurrects or re-uploads it. A tale's settings rows go by SUFFIX, never a hand-written list of
  prefixes (storyKeys); db.sweepOrphans() at boot clears rows whose tale is already gone.
- Ages are told in PAGES (M162): storyTurn(state) is the unit every age is stamped and read in.
  state.turn counts mutation BATCHES and is not an age. Never read an age off state.log.length.
- The coverage law (M12) only runs when the window is handed the record's nodes, and it reaches
  back only as far as the connection's room allows (M162) — both held by laws in stack.mjs.
- Nothing hands the reader a task (M160): a history change during a rebuild waits on
  waitForRebuild() and then runs itself — it is never refused with "try again".
- Data: serve.py keeps ONE FILE PER TALE in ~/.cozytavern/books/ (plus _house.json) — M155,
  SillyTavern's shape; a fresh browser pulls every book at open (reloads once if slow) and only
  a changed tale is pushed; Settings → The house → Backup exports/imports everything by hand.
  The launcher (cozytavern.sh) douses and relights this folder's serve.py on EVERY run (M158),
  and serve.py re-execs itself when its file changes (M157) — no manual restart, ever. The
  worker's fetches must use api(path) (a relative fetch in a worker resolves against /js/).
- Two-browser proof: tests/twobrowsers.py (Playwright, two contexts, the real
  serve.py) — eleven checks: B holds A's story/pages/ledger/connection; B reads the DEVICE's
  manifest, never a kept copy; a page written after B first booted still reaches B; a tale let
  go in A stays gone in B and is never pushed back; the worker caches no api answer. Run it
  (`python3 tests/twobrowsers.py`; the browsers are in /opt/pw-browsers) before any commit that
  touches sync, sw.js, serve.py or store.js.

## Known limits (not bugs)
- The prose of the model the writer points at it. The house hands it the truth and catches
  slips; it cannot write for it.
- A branch far beyond ~250 turns in a story whose checkpoints were pruned falls to the founder +
  deep re-read path (a toast says so).
- The preset's own copies of Voices/TWB/Contested Resolution on an already-imported shelf are
  never sent and shadow nothing; deleting them is optional.
