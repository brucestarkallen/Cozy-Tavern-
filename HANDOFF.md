# Cozy Tavern — handoff for the next session (state at m296-001)

Repo: https://github.com/brucestarkallen/Cozy-Tavern- (main). Every commit is tested first.
Full history of every law and fix: AGENTS.md (M1 … M296). (There is no SPEC.md in the repo — the
founding design lives in AGENTS.md's first entries.)

## Run the tests before any commit (all three; all must be green)
- `node tests/harness/run.mjs` — 556 checks on the engines, assembler, workers, laws.
- `bash tests/audit_lint.sh --quiet` — the lint audit (0 errors at M274; warnings reviewed there).
- `cd tests/dom && node run.mjs` — the walk: 56 scenarios of the real app in jsdom (every button,
  the random checkpoint walk, branches on old stores, the ripple, the housekeeper, resume).
- `cd tests/dom && node longplay.mjs` — ninety turns of the real app against scripted models
  (flat context, the clock, arrivals, windows, the audit, the record's lines).
- Real-browser frame timing (Playwright, CPU 6×): `python3 tests/perf_housekeeper.py` measures the
  housekeeper streaming (SCENARIO=story: the storyteller) against a fake streaming model; it exits 1
  past its budget. Run it before any change to a streaming view. `python3 tests/housekeeper_rounds.py`
  proves a housekeeper round after a look-up streams and is never cut by the silence watch, that
  closing the sheet never stops it, that its history stays, and that a reload puts the question
  back. perf_housekeeper.py also takes SCENARIO=bigfetch and HISTORY_TURNS=40. (M145's drawer/settings check was
  /tmp/perf.py in its session; recreate from AGENTS.md M145 if needed.)

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
- One page view (M292): the drawer draws the pages once ("The people"); "How they feel toward you" is the
  standings; a whole request says where the absent are once; engine/sentence.js knows titles.
- Character pages (M291): core = who they are, state = the now; agents/tidy.js tidies a story's pages
  once; the drawer reads the seat for the absent and ages an old note.
- Retry mid-reading (M290): a rewound page's readers write nothing (early check + stale guards on every
  chain save); DOM-31 proves it in the app.
- The model's room, asked (M289): providers/detect.js learnContext asks an empty-room connection's provider
  for its model's size (kept per model and address); DeepSeek's preset is 1,000,000.
- Lean readings (M288): engine/whole.js leanPage — the auditor and the housekeeper show the people's
  pages lean past 60% of their room; "person: NAME" fetches any page whole.
- Room (M287): the record is sized to the MEASURED request (fixedCharsOf, recordRoom fixedChars; an unset
  answer is 16,000); the auditor reads a ledger lean when it would outgrow its room.
- The present (M286): cards take what the away do not need (exact sizes); the rest of the room is
  "- Name — who · now: what".
- The model's room (M285): providers/room.js contextOf — the connection's number, else its preset's,
  else 128,000; asked by the storyteller, the ember bar, the record room and every worker.
- Newcomers and lines (M284): firstSeenTurn on every page; +30 for the first ten pages; the roster is
  one line each (who, where, when) with room kept for it.
- The writer's material (M283): the scribe reads the brief and cast notes; every worker holds them
  to writerText's room with a stated line cut; the storyteller's cast notes and lore follow its room;
  relevance (the ground, the latest names) orders the people, no rotation.
- Who matters (M282): importanceOf weighs the cast in code; the absent who matter ride as cards;
  a first name recalls; the plain labels ("you", "player") are whole names only.
- People (M281): the people block is IN the request now (it never was, since M12); peopleView sizes
  it to the room; M259-46 fails any receipt part that is not in the request.
- Threads (M280): the page reader answers "resolved" (open-thread titles this page resolved);
  brief- or cast-named people are never retired for being away.
- Live thinking (M279): js/ui/streamtext.js draws it line by line, whole from the first word;
  perf_housekeeper.py fails a live box that has lost its first words.
- Standings toward him only (M278): the auditor starts none on a bare "the brief says" or a line toward
  someone else; no zero standing is written for someone with none; the house lets such old ones go.
- Standings (M277): never for the main character; the auditor starts one only for a brief-named
  person on a reason quoting the brief; its refused standing moves are counted, not listed.
- The ledger mark (M276): state.page is every page up to there read; readAhead holds pages read
  out of turn; the catch-up reads only pages no read reached; the light sends the reader when idle.
- The light repairs what it sees (M275): a record gap seen while idle sends the keeper (backing off
  when it folds nothing); a job is settled only after its result is written.
- Card groups (M273): cards that fix one problem share a group (named by the housekeeper, or joined by
  the house on the same reason or the same change); a withdrawal takes the whole group ("only:" one).
- The housekeeper's cards (M272): every card name is unique in its session (withdrawal is by name);
  the context lists what became of every settled card; the brief's opening lines (STATE, SCENE,
  WHERE, PRESENT, ACTIVITY, LAST…) are refused unless the writer names them.
- Names (M272): different titles (Mr/Mrs/Ms/Dr/Aunt…) are never one person.
- Run the walk ALONE: with the harness or another suite beside it, timing scenarios fail by the dozen.
- A change to js/ui/*.js is only proven by the walk or the real-browser tests — the harness never
  loads those files (M272: a syntax error there stopped the app while the harness was green).
- Every ledger note is saved whole (M266); the storyteller's state of things follows the room
  (stateView). A cap is a runaway guard, never a size a real note reaches.
- NO SILENT CUT (M265): no reader of the record is handed less than its room holds; a cut is
  whole lines with a note (recordFor(mem, minLevel, cap)); a full storyteller room is said out
  loud. Before adding a reader of anything long, test it with an input past every old cap.
- The record's room and its squeezing (M264): the record rides in the room the storyteller's
  context leaves (recordRoom, never under 30,000 chars); squeezing is the writer's choice
  (memorySqueeze: auto = only when the record would not fit / never / a number of lines).
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
  serve.py) — twenty-six checks: B holds A's story/pages/ledger/connection; B reads the DEVICE's
  manifest, never a kept copy; a page written after B first booted still reaches B; a tale let
  go in A stays gone in B and is never pushed back; the worker caches no api answer; a connection
  and a cast card let go in A go in B live and never come home to A or the device (M293); a row
  made in B before its push survives A's push; a page that landed while B's stream was down reaches
  B when the stream returns, painted (M293); a branch of a sixty-turn tale sends one whole book and appends the rest (M295). Run it (`python3 tests/twobrowsers.py`; the browsers
  are in /opt/pw-browsers) before any commit that touches sync, sw.js, serve.py or store.js.
- The device's fold: tests/foldcrash.py (HTTP only, the real serve.py) — twelve checks: a page the
  pusher let go stays gone even with the old log left beside the new snapshot (a kill mid-write),
  another browser's page is never lost, the pusher's own later appends are read (M295).
- Two hands on one tale: tests/twohands.py (Playwright, two contexts, the real serve.py, a fake
  model that holds the extractor) — ten checks: B, handed A's page live, never sends its own readers
  at it (no idle repair, no resume on reload) while A's are out; A reads it once; the standing moves
  once and both browsers hold it; A's own killed tab still resumes its unfinished page on open (M127).
  Run it with twobrowsers.py; the marks it relies on live in localStorage (cozy.elsewhere:<tale>,
  cozy.wrote:<tale>), this browser's alone.

## Known limits (not bugs)
- The prose of the model the writer points at it. The house hands it the truth and catches
  slips; it cannot write for it.
- A branch far beyond ~250 turns in a story whose checkpoints were pruned falls to the founder +
  deep re-read path (a toast says so).
- The preset's own copies of Voices/TWB/Contested Resolution on an already-imported shelf are
  never sent and shadow nothing; deleting them is optional.
- Playing the same tale in two browsers at the same time is last-push-wins on its ledger (M293
  keeps only the idle repairs and the resume of the second browser off a tale another hand wrote
  within the last ten minutes; the pages themselves merge by id and are never lost).
