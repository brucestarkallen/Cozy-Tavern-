# Cozy Tavern: handoff (the present state)

Rewritten each milestone, never grown into a second history. Earlier handoffs are
kept verbatim in docs/archive (HANDOFF.before-M752-tidy.md holds M752 back to M691;
older files sit beside it). Search them with
`python3 tools/context.py "M731" --in handoff`.

## Now

- Version m752-001 on main, published 14 October 2026 (d73bbaf). The agent documents
  were tidied after it; no application code changed.
- Measured on that tree: the law suite 1664 of 1664, the DOM walk 311 of 311, lint
  0 errors (253 warnings, read), tests/m739_ui.py and tests/m730_housekeeper.mjs pass.
- Never verified in this environment: a live provider, the owner's phone, long play.
- No milestone is open; SPEC.md is empty until one is.
- Testing is by judgment since 14 October: real checks, not rituals (AGENTS.md).

## Decided by the owner and kept: do not "fix" these

- Since M689/M709 (a review he agreed to) the final reviewer, a model, judges scene
  endings, leaves, walk-ins and poses; the code guards were removed on purpose. A wrong
  verdict can land, and the journal shows its provenance. Two consequences: a standing
  Scene writes to the wrong person is no longer zeroed by code (the Caleb case), and a
  completed verdict with no repair settles a source identity fact even for a person
  present with no People record.
- A page changed while the keeper is on lets its record line go, with the line's
  corrections; the keeper folds the page again (M673).
- A spelling correction refuses a month, a weekday, or a word the story writes in
  lower case, and says why.
- With no Max tokens set, a request is refused only when fewer than 4,096 tokens would
  remain for the answer (ANSWER_FLOOR in js/assemble/budget.js).
- Threads and offscreen seats are kept whole and shown 40 at a time, with a count and
  a fetch ("person: NAME").
- His page mark (M466) shows; M739 had hidden it without his asking.

## Open, not changed

- A branch reads its sources again and runs the final review again, which costs paid
  calls: the auditor's receipts and checkpoint are keyed by page ids
  (js/agents/auditsources.js, 'page:<id>:<offset>') and a branch's pages get new ids.
  From the newest page the cost could be saved by carrying the receipts under the
  copies' ids. From an earlier page the re-reading is what keeps identity decisions
  made with later pages out of the branch. Either is a change to the auditor's
  identity model, to be made deliberately, with laws for both kinds of branch.
- Checkpoint pruning keeps about 41 checkpoints (older than M681).

## M752: every update after M681 audited; regressions fixed, every suite green again

Version m752-001. Base 5ff1a5e (M751).
The owner asked for an audit of all updates after M680/M681 so that everything
they tackle works, with as few bugs as possible and no regression. M681
(f087472) was the last version whose whole law suite passed (1434 laws).
M682–M749 shipped without it. At M751: 155 laws failed and M134-1 looped
forever; the DOM walk failed 30 of 304 (M681: 289 of 291, two timing flakes);
22 of Codex's 38 standalone milestone fixtures failed, and none ran in the suite.

Every failing law was bisected to its commit and classified: regression (app
fixed), stale fixture (updated to what the current code asks for), contract
changed by a later owner-agreed milestone (re-aimed with equal strength), or
obsolete (removed). Five area reviews reproduced about 60 more defects no law
covered. Every fix has a law that fails without it.

Fixed, by area:
- Offline: js/agents/appearanceinventory.js, a boot import since M704, was not
  in the service worker shell, so the app could not start offline.
- Sending: a request too large for the connection failed silently (his message
  saved, nothing else); it is now said in the thread with Ask again. With no Max
  tokens set the house refused unless 16,000 tokens stayed free (no OpenAI-style
  connection under ~47k could send); now only below a 4,096-token answer floor.
  The 30-page window holds; a line and its pages never ride together; after a
  spelling fix the request no longer grows 40k→157k tokens telling every page
  twice; the pages row names pages no line tells; a small storyteller's recall
  runs beside the referee; the cast weighing and the planner fit the room their
  calls are refused past; worker rooms (pagecut.js roomChars) are measured the
  same way; a page's receipt 16.8 KB→11 bytes; the plans row names only plans sent.
- Record keeper: one line it cannot re-read no longer stops all folding (bounded
  tries); lines stay bound through spelling fixes, branches and keeper-off edits;
  merges keep their corrections and receipts; background re-reads never write over
  his lines; corrections follow page deletes, inserts and rewinds.
- Continuous audit: a bare finding, one about an out-of-character page or an empty
  line no longer becomes an unresolved correction with a recovery call; ones
  already saved are cleared with no call; stepping aside costs no attempt.
- Lamp: green with the auditor or readers off and between audits; not blue while
  only the continuous audit reads; names the reader that stumbled again.
- Auditor: a long story's final review fits (lean rows; rows past the room stay
  open as not read yet, never approved unread) — it was refused locally forever;
  a finding whose source text changed can close; checkpoints no longer copy the
  audit's source passages (200 pages: 183 MB → 33 MB); ledger upkeep runs on
  audited pages again (never since M709); a page awaiting its reply no longer
  unverifies; deleted rows no longer stay verified; paid readings survive a stale
  audit; the repair loop pauses as designed; two different writes to one field
  (the alternating hair) are refused; an open verdict holds every write to its
  row; a confirmed scene ending outranks a contradicting update; a refused repair
  is never certified; a completion merges with the reply it completes; a merge
  already made is no open repair; pending lines read "what: reason".
- People: ordinary first-person text ("I am Byakuya's lieutenant", "I play
  Rukia's song") no longer makes someone his persona; his biography survives
  renames and spelling fixes; a former name never captures another person, and
  a descriptor ("the girl") is never an alias; a looks quote is judged by its own
  paragraph; his core is added to, never replaced, under "you" or a persona; no
  model answer grants itself byHand, auditorApproved or the like; re-founding
  adds to cores; World places last-seen people with offscreen.set, so nobody is
  owed forever; a second reclassify keeps both archives; "Alexia's woman" never
  takes the princess Alexia.
- Knowledge: one record per fact (a worker's label was read as the fact's receipt,
  so every re-send added a copy); a learned truth replaces its belief; "everyone
  here" reaches the room on a founding page; readers see believes / suspects /
  has not learned; "everyone here but NAME". Threads and seats stay durable but
  are shown 40 at a time, chosen for the page, with a count and a fetch
  ("person: NAME" returns the seat). A 300-seat storyteller's state of things was
  cut to 110 characters; it is whole again. Rendering 300 seats 532 ms → 31 ms.
- Housekeeper spelling: only the name as written (never "may", "the first of
  May"); expansions written once; undoable after its log line rolls out. A page
  edit renaming a name that is also a word holds on its page.
- Updates and UI: a wrong backup file no longer blocks updates all session; an
  empty focused composer no longer blocks them; his page mark (M466) is back —
  M739 had hidden it with no request of his; Academy Night's bar colour; the
  auditor scratchbook opens as the house's own pop-up; a gone tale's health rows
  go with it. A seat's age reads "as of 9 hours ago in story time". The README
  tells the M720 self-refresh. A drawing of one tale that lands after another
  was opened stands down (a branch's pages were laid over the tale he went back
  to, and a ▸ on them wrote nothing: the walk's rare DOM-8a failure); a page
  redrawn in that moment is no longer put into the other tale's thread; a
  telling that fails after he opened another tale is said by its tale's name,
  never in the other thread with an Ask again that asked in the open tale.
