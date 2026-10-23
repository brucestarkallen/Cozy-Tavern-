# Cozy Tavern: handoff (the present state)

Rewritten each milestone, never grown into a second history. Earlier handoffs are
kept verbatim in docs/archive (HANDOFF.before-M752-tidy.md holds M752 back to M691;
older files sit beside it). Search them with
`python3 tools/context.py "M731" --in handoff`.

## Now

- Version m764-001 on main, 23 October 2026: someone the page only talks about is asked where they are (M764). His: "why
  Vanessa still on the scene and not elsewhere??? AND JUST camel coat wtf is camel coat … latest scene no Vanessa".
  Reproduced with his page: she walked to her car on the page before; on the latest the telling never shows her (Vance:
  "Langley's car's still behind the holly"; her sedan swings for the gate). placesBlock asked the page reader where each
  person is only for those the telling shows, so it was never asked about her; its law keeps whoever the page does not show
  ("quiet, not gone"), and on the header's part-of move ("the drive" → "the drive by the gate") a named room keeps the quiet
  (M758) — she stayed, and the move let her place go: "Vanessa Langley — camel coat" (the coat an earlier page gave her).
  Now a present person the page names anywhere (speech too) but never shows is listed for the reader, marked "the page only
  TALKS about them", with what to decide; one the page never names is still quiet and not asked. Law M764-1.
- Version m763-001, 23 October 2026: a forget that loses nothing is the final review's to make (M763). His: "Why
  it's still yellow for auditor wtf … Convenience Store Clerk is listed as an individual by the source reading in World voice
  after page 14; confirm its identity …; The ledger lists 'Convenience Store Clerk' as a People record, but the source text
  identifies them as a temporary speaker by role … : preserve established records; correct identity with a rename; … : no
  repair was supplied." Reproduced exactly: the clerk had NO People page (the world kept the speaker a voice of that page,
  M759); the final review, asked to decide the voice's mention, answered people.forget — which its vocabulary offers and
  finalAuditorScope refused every time, whatever the ledger held, with a reason that has no answer (rename what?); asked again
  in the same review it kept the finding without the repair ("no repair was supplied"); every pass the same, then paused.
  Now (auditor.js forgetLosesNothing, nothingWrittenOn, forgottenMentions; apply.js people.forget): a forget of a name the
  ledger holds nothing of is already so (the door answers same:true, CLOSED_ALREADY knows it), and one of an EMPTY page
  (nothing written, no seat, standing, knowledge, lock, body, thread, hand, not on his sheet or in the scene) lands, journaled;
  either way the name's undecided source mentions are decided as people of their own source only, for the review's cause,
  unless the same answer decides them itself. A historical finding answered by its id with a change the ledger already holds
  closes (judgeAudit `already`, findingSettled). A forget of a page with anything written on it is still refused with the same
  reason. Vocabulary says a source mention is not a People record. LEDGER_REPAIR_POLICY 14: his paused audit resumes once.
  Laws M763-1 (his case: one answer, nothing owed), M763-2 (his saved findings close on the resumed review), M763-3 (an empty
  page goes; a written one stays).
- Version m762-001, 23 October 2026: the continuous audit's reading may look before it alleges (M762). His: "why would
  an audit keep mistaken and mistaken and mistaken while the housekeeper could find on its own audit perfectly … The
  continuous Audit is kinda supposed like housekeeper audit". The two were not given the same tools: the housekeeper's
  fidelity audit fetches the pages it does not hold whole; the continuous audit's stretch reading was a plain call
  (callWorker) with only its stretch's pages and the record before them, and its law sent whatever those could not settle
  (an identity, a title told on an earlier page) to "focused recovery" as target:unknown — the one reading that may fetch.
  Every such doubt became a historical correction, a second call fetched the earlier page, found the record right, and the
  line said "The mistaken finding was withdrawn". Now (continuous.js auditStretch, buildStretchMessages, law): the reading
  goes through askWithFetch (STRETCH_LOOKS 2) with the shared fetchLaw, is told to look before it alleges, and only what the
  pages it fetched still leave uncertain goes to recovery. Law M762-1 (his Edie Dale case: page 3 fetched, the line right,
  no correction left).
- Version m761-001, 23 October 2026: a value that lost its closing quote is read; an answer that could not be used is
  not "went well" (M761). His: "the world agent ran just now and it went well — its answer could not be used" with its answer
  (his paste is the drawer's 2,000-character cut, status.js RAW_CAP). One value lost its closing quote —
  "activity":"Refreshing the live blog feed: 'Sheriff investigating interior',"agenda":… — so every quote after it read the
  wrong way round and seven placed people and the world's word were thrown away, both asks. jsonutil.js stringEndsAt: inside a
  string, a comma, a quoted plain key and a colon is where the string ended (valid JSON never has an unescaped quote there);
  the candidate finder, the first-object finder and the repair read it alike — every reader that parses a model's answer.
  And a run whose answer could not be used (or was cut short) was recorded as one that went well: the world agent, the page
  reader, the founder, the planner, the world-of-the-story keeper and the plans keeper now record it unfinished, so the drawer
  says "stopped partway" and, for the four readers the light watches, the house's bounded recovery asks again
  (chat.js recoverHealthWorker, two tries a page). Laws M761-1/2.
- Version m760-001, 23 October 2026: the review fits its connection with every owed source fact (M760). His manual
  yellow check: "Current ledger verification is incomplete; Ledger entry receipts are incomplete; Vanessa Langley has source
  identity facts to reconcile: … no review answer for it — the review did not finish this pass" (a dozen of them). Each owed
  source fact went to the final review with the whole section it was read from (up to 12,000 characters) and her whole
  record, and the record again in the historical checklist, once per page she was read on — outside the room the review is
  planned in (only the pages, the entries and the evidence were planned). Reproduced with his shape (forty 7,000-character
  pages, a fact of hers on twelve, ten people): 145,000 characters of tasks and 69,000 of checklist; on a 128k connection and
  on a 200k one the transport refused the request before it left, every pass — nothing decided, 0 of 51 entries verified,
  and M758-F3 (rightly) never counts a review that was not sent as an ask. Now (auditor.js reviewSourceTasks, factPassage,
  auditRepairChecklist): a fact's task carries the passage around its quotes (at most 2,400 characters) and her record once;
  the checklist entry of a source fact points at its task; the findings get a room of their own before the pages are fitted,
  and the tasks are fitted to it (identity decisions first) — the rest wait, are not asked, and say "waits for the next review
  — this one had room for N of the source tasks". Same tale: one review of 277,000 characters, the twelve tasks in 18,000,
  every fact and all 51 entries decided; forty facts: 13 carried, the review fits. LEDGER_REPAIR_POLICY 13. Laws M760-1/2.
- Version m759-001, 22 October 2026: the world agent's voices (M759). His: "Is this normal the world agent sometimes
  yellow but then become green once auditor finish?" Yes, by M731's design: a voice whose speaker the world agent does not
  identify (identity:{scope local|tracked, why}), even when asked again in the same answer, is settled by the auditor from the
  page (auditSources voice:… receipts), and health.js reconciledWorkerStatus turns the run green once the audit has. Why it
  happened often: the per-voice shape the model copies listed {"icon","speaker","channel","content"} and the identity rule
  stood as a line of its own BEFORE the voices were described — the shape now names identity and the rule sits inside the
  voices section (world.js). His line said "stopped partway" and showed the model's own instruction; it now says "is waiting
  for the auditor — the auditor will say who is speaking in 2 voices (it reads them from the page): Deputy Vance, Dr. Hollis
  Rennick" (world.js worldRunWords, drawer.js, health.js). With the auditor switched off nobody would settle it, so the run is
  finished and says the speakers stay unnamed (world.js worldRunState, chat.js). Laws M759-1..3.
- Version m758-001, 22 October 2026: the audit of the laptop's m755-001 … m757-001 (M758). What stands now:
  - THE GOINGS (apply.js endingGoing, behind mcWalksOff and mcGoesOut). Three kinds of verb, each with its own shape: his own
    feet (the M588 list, read as before, plus outside/home/upstairs/downstairs); running with the direction straight after
    the verb ("ran out", "hurried back outside"); carrying with a PERSON between the verb and the direction ("led her out",
    "took Vanessa out", "followed her out", "led the way out"). No bare forms ("to take her out", "let the guard lead her
    out"), no "drew", and "them" only after verbs that carry people. Another's hand on him ("Vanessa led Jovan out", "took
    Jovan's hand and led him outside") and the company going ("the two of them went out") count when his name stands as one
    of them — not when he only looks on ("Jovan watched the two of them leave") or a pair is named without him ("nodded to
    Claire and Tobin, and they left together"). mcGoesOut also refuses an outward word that is a thing's ("slipped off his
    coat", "stepped out of the way", "left the cup on the table"). m755-001's widened reading had 27 of 52 ordinary endings
    wrong ("took out his phone and showed Vanessa the message" emptied the room of the quiet Tobin and refused arrivals);
    now 0 of 80 (52 + 28 held out), and every going the m754-001 reading caught is still caught. Law M758-G1/G2.
  - THE ROOM ON A MOVE (extractor.js). Far and near moves as before (a near move with no room named: the page decides,
    m755-002); his going out with the ground unchanged leaves behind whoever the page's room does not hold (m755-001); a jump
    of four hours or more moves the room (m755-002); the reader's "newScene" makes the page alone the witness (m755-003/004 —
    it trusts his model's flag; a person the page names only by an alias or a pronoun is not "shown" there, the same test a
    far move with no named room uses). A move to a PART of the old ground ("the garden of Ashford Manor", "Cooper's Row,
    Ilvarren") lets the page decide only when the reader named no room: m755-002 made a named room the truth there and took
    the quiet raven out of his own turn 7 (walk DOM-271, red on the laptop's head). Law M758-G3.
  - SOURCE FACTS (auditsources.js, auditor.js). Whether her profile already holds a fact in other words is the review's to
    say (M717); the house compares the words as they stand. m756-001's half-the-words match was reverted: it waved "Having a
    secret affair with Jovan Wessex that nobody knows" through into a profile that never mentions an affair, and broke M743-F.
    The review decides: a fact kept open with a reason is left as it stands with that reason; open without one, after being
    asked again, is left as it stands and says so; the rest are approved only by a review that says it is complete (m756-002
    took any answer as approval, an unfinished one too). A fact a review ANSWERED for twice without deciding is set aside in a
    line that says so (m756-004 counted every pass, so two provider failures set his facts aside). One lookup for a finding's
    mention everywhere (findingMention: its own label, or a legacy finding's bound person — m756-002 changed one of five
    lookups). The light says why each fact is owed (m756-003). Laws M758-F1..F3, M756-1 (expectation changed: owed until the
    review decides), M743-F.
  - THE ENTRIES LEFT OVER (auditor.js). His "8 of 62", "9 of 62": the whole-ledger reading carries what fits beside the
    ledger and the sources; the rest are now read in batches of their own in the same pass, each fitted to the connection
    (workerRoom, with the room to look), with the newest page and the right to fetch. An entry is approved only by an explicit
    check on the value it was shown; one the whole reading's own repair changed is not sent; a batch that fails, is cut short
    or answers for none ends the readings for that pass. m757-001's one extra reading was paid for and approved nothing (its
    checks went where finalAuditChecks never reads). The 142-entry ledger of M752-A11: 63 of 142 after a pass before, 142 of
    142 now, in 2 review calls. Laws M758-A1/A2.
  - LEDGER_REPAIR_POLICY 12: his audit paused over Vanessa's facts resumes once.
  Measured: see HISTORY M758 for the suite, walk and lint numbers. Not run: his live tale and his model (no provider calls).
- The laptop's own record of m755-001 … m756-002 is in HISTORY (M755, M756); m756-003, m756-004 and m757-001 left no entry
  there (their commit messages and HISTORY M758 record them). Where those records and the item above differ, the item above
  is the code as it stands.
- Version m754-001, 18 October 2026: an old close the ledger already holds no longer keeps the auditor's
  light yellow (M754, the next item). m753-001 the same day: speech marks paired as the screen pairs them, and a
  page's readers sooner (M753, the two items after it). Before them, m752-021 on 15 October; m752-001 (d73bbaf) was the audit;
  m752-002 lets go, when a tale opens, a persona the old rule made of an ordinary
  sentence; m752-003 makes the notes say when they have not read the newest page;
  m752-004 settles the continuous audit's historical corrections instead of
  stranding them, and adds "Manual continuous audit" (below); m752-005 centres the
  blue full-screen dot like the green and yellow (tests/m739_ui.py, every lamp);
  m752-006 takes the shelf handle's grey grip off a phone's open shelf (the edge still
  drags; it glows only while dragged; tests/shelf_handle.py); m752-007 leaves the page
  mark as the story's one scroll thumb (the browser's own is not drawn; tests/pagemark.py);
  m752-008: a shelf he opened inside a giant project no longer folds shut again — a
  setting read while its own write is under way is the new value (store.js; law
  M752-ST1; law suite 1671 of 1671, DOM walk 316 of 316); m752-009: a historical
  correction's conversation ends on a verdict, not on a mistake nobody said (below);
  m752-010: "Manual yellow check", first in the workers' room — every owner the light is
  yellow about is given a fresh try now, one after another, and the banner says what is
  still yellow and why (chat.js yellowCheckNow; DOM-M752-13); m752-011: the continuous audit
  reads a verdict for what it says, as the housekeeper reads an edit — quotes held word by
  word (punctuation aside), the page's own passage given back when a word differs, and
  "supported but the record does not preserve it" read as a contradiction to repair (below);
  m752-012: a record found wrong is repaired in its own voice — the right name or figure where
  the wrong one stands, every name and number from the pages (below); m752-013: Choices
  matter's helper is handed the whole request the newest page was written from — his preset
  (its anti-positivity rules), cast notes, world, lore, canon and rules, the history as sent —
  and asks its question after the page (choices.js choiceAskWhole; DOM-M752-14); m752-014:
  Settings → Choices matter → "Choices are written as" I or You, per story (DOM-M752-15);
  m752-015: a branch keeps what the auditor paid for — its receipts and approvals name the
  copies, and a branch made before reuses same-text receipts (laws M752-BR1/BR2, DOM-M752-16);
  m752-016: "Restart choices" under the choices — new ones sealed blind (DOM-M752-17);
  m752-017: the automatic audit starts as soon as the house is idle (DOM-M752-18);
  m752-018: Choices matter says what it is doing — sealing, waiting for the page's readers,
  or why there are no choices, with "Restart choices" to ask again (DOM-M752-19); m752-019:
  a page the helper found quiet says so, with "Restart choices" (DOM-M752-20); m752-020: nothing
  he does waits for the auditor, and a description it cannot tie to anyone is set aside (below);
  m752-021: an unchanged entry the new page does not name keeps its approval (below).
- The auditor's light, yellow for good (m754-001). His: "the auditor ran just now has unresolved findings; repeated
  attempts are paused until the story or ledger changes — still checking: Jugram's loose end 'first bell tomorrow: he must
  show Marshal Kelstrum …' was answered when the duel was fought at first bell on Freeday: no such loose end is written for
  them". The loose end was closed already; the auditor's old finding to close it was kept and shown to each review, the
  close of a loose end that is not open was refused ("no such loose end"), a finding was counted as so only for a few kinds
  of change (never a loose end, a thread, a line of what someone knows, a faction, a truth, a wound, a departure, a thing),
  and the review was shown the person's "unthread" — a field no page has — so it never saw the loose end was gone; every
  pass asked the same close again, held the person's rows open with it, and paused. Now a close of a loose end not open on
  any of their pages is already so, for every reader (people.js looseEndOn; one near it that is not it is still refused,
  saying what is written); a loose end on a page of his kept under another of his names is closed there; an old close is
  settled once its door finds nothing left to close (auditor.js mutationSatisfied: a dry run, never a write; something
  still there, or two that could answer, is not); the review is shown the loose ends as they stand. LEDGER_REPAIR_POLICY
  10 → 11: his paused audit resumes once by itself. Laws M754-1..4 (each fails on m753-001); M237's loose-end line runs
  the door instead of reading its source; DOM-6d holds the tale's audit off while it asks for the unfinished page (the
  house's own restart of the audit, a quarter second after the light looks, raced it on a loaded machine). Measured on m754-001: the law suite 1708 of 1708, the DOM walk 327 of 327, lint 0 errors
  (247 warnings, as before). Not run: his tale (its ledger was not available here).
- Speech marks (m753-001). His page under a green light: `"A gift,* she said, slowly, … "From my sister. …"` — the
  closing quote came out as an asterisk, and the screen, which pairs straight quotes in order, coloured the narration as
  speech and her words as narration. The auditor reads the ledger, never a page's marks, and the page repair knew only
  some shapes of a broken mark; nothing asked whether a line's speech pairs. The repair now pairs each line's speech marks
  as the screen does (pageshape.js pairSpeech): a lone asterisk, or a single quote after , . ! ? … — that nothing else
  pairs, standing where the missing quote belongs, becomes that quote when it alone makes every pair whole; a pair in two
  kinds is written in one; a curly mark facing the wrong way is turned; an open asterisk is closed inside its own
  stretch; „…“ and «…» keep their own rules. A quote simply left out mid-line is seen (speechFaults) and put to the
  second reader's mender under his mend switch — kept only if it adds quotation marks and nothing else, and fewer
  lines are left unpaired (insertsOnlyMarks): after a page's readers and before its auditor, which then reads the page
  as it stands (that page and the pages the storyteller reads word for word), once when a tale opens on this build, and
  on "Mend the pages' marks" (every page; it says what it could not place by itself, never "whole already" then). It
  never holds him up — it does not begin while he sends, steps aside when he writes, and is taken up at the next page's
  end; each telling is asked once (`marksAsked`). His stored pages are mended by the repair the first time each tale
  opens on m753-001. Laws M753-1..5, DOM-M753-1.
- The workers' speed (m753-001), measured with the real app on a 60-page, ~80,000-token tale (two pages sent; every
  worker answering its contract; times from a latency model — 0.6 s a call, a request's new part read at 6,000
  tokens/s, the part that begins as the same worker's request on the page before at 60,000 tokens/s, answers at 100
  tokens/s; not his provider). Each reader's request began with what changes every page — the ledger (its hour first),
  the world's hour in its system words, the scribe's list of who is owed a page or a now — so a provider that keeps what
  it has read of a request's beginning kept little: the page reader 19%, the world 0%, the second reader 9%. What stays
  the same comes first now — the brief, cast notes, the series, the record, the pages already read — then the hour and
  the ledger, then the page and the task: 77%, 83%, 89% (the scribe 78%; it was 79%, and 0% on a page that owed someone
  a page or a now). The same words. The world agent, the scribe and the second reader, which need nothing of each other,
  read together with "Two workers at once" (at most two requests at a time for a tale); the world and the scribe write
  the ledger one at a time, each over the ledger as it then stands (engine/state.js ledgerTurn); the second reader holds
  the page against the ledger as it stood before the page's readers wrote, as its words say. "Two workers at once" is on
  unless he turned it off; a provider that turns two away puts it back to one at a time by itself, and it stays off
  (M530). Modelled from the page landing: its readers done 59.6 → 35.2 s, the choices sealed 71.5 → 47.2 s, everything
  settled 104.8 → 76.6 s (before: two at once off, as it shipped). With two at once already on, the old code still ran
  its readers one after another (59.6 s) and settled at 100.9 s. Left as it is: the storyteller's own request keeps 44%
  of its beginning, its notes riding above the story by his word (M510-37); the auditor, the plans keeper and Choices
  matter as they were. A Claude connection keeps only what the house marks (a worker's system words — the world's are
  now the same every page), so the reordering gains on providers that keep a request's beginning by themselves
  (DeepSeek, OpenAI and others); whether his workers' provider does was not checked.
- Measured on m753-001: the law suite 1704 of 1704, the DOM walk 327 of 327, lint 0 errors (247 warnings, the same as
  before). DOM-254 had begun failing on the calendar alone (its finisher dated Date.now(), past that finisher's window
  since 16 October); it is dated inside the window now.
- Measured on m752-013: the law suite 1682 of 1682, the DOM walk 318 of 318 (a first
  walk was red once on DOM-263, a fixture race present on m752-008 too, fixed — below),
  lint 0 errors (253 warnings, as before). On m752-004: Chromium at 390 px, the new
  button wraps with the others, no page or panel overflow. On m752-001: tests/m739_ui.py
  and tests/m730_housekeeper.mjs pass.
- Choices matter (m752-013): the helper that seals what follows each choice was handed a
  summary — the brief, the record, the ledger, the people, six pages — and none of his
  preset (its anti-positivity and character rules), cast notes, world, lore, canon or
  rules, so its outcomes leaned the model's own way. It is now asked with the request the
  newest page was written from, his preset first, and its question after the page; the
  summary (now with the cast notes) only for a page from before requests were kept. Each
  turning-point check therefore sends about the storyteller's whole request again, on the
  Choices connection (smaller rooms cut the oldest turns first). "Choices are written as"
  (m752-014): I ("I draw my sword", as it shipped) or You ("You draw your sword"), kept on
  the story and carried by a branch; switching it seals the newest page's open choices again
  in the new voice (one helper call); a choice already taken keeps its words. "Restart
  choices" (m752-016), under the choices: they are let go unseen and the helper is asked
  afresh from the page, shown none of them (it never was shown an earlier offer); one call.
  While choices are asked for the newest page the row above where he types says so (m752-018):
  "Sealing choices for this page…", or "…waiting for this page's readers to finish first…"
  while its readers are out (up to ten minutes, M680). A helper that gives none says why —
  its call failed (with what the provider said), its answer could not be read, it was
  outwaited, no connection — with "Restart choices" to ask again by hand; a restart answered
  "no turning point" says so too. Since m752-019 every quiet page on the newest page says "No
  turning point on this page — no choices." with "Restart choices" (choices he let go could not
  be asked for again before). A restart during a fight is refused with a toast.
- The auditor and his waiting (m752-020). Per page the auditor makes two calls one after the other —
  the newest page's source reading, then a review of the whole ledger against the tale (measured on a
  synthetic 60-page tale: ~43,000 tokens in; 200 pages: ~108,000) — and answers for every entry it
  checks, so even a fast model without thinking takes far longer than a page reader. It is no longer
  waited for: the choices wait only for the readers that write the page into the ledger; his next
  move, try again, an edit, a branch let its reading go at once (it was 5 s for a send, up to 2 min
  for an edit, and the next page's readers queued behind it while its answer, made worthless by the
  new page, was thrown away); the automatic audit finishes the check when he pauses. DOM-M752-21:
  send → storyteller 5,080 ms → 40 ms; new page → its reader never within 90 s → 6 ms.
  A description the reader cannot tie to anyone ("the groom", "the under-steward's boy", "the older
  house-knight", his page 122) was owed on every pass until the automatic audit paused; it is kept as
  a person of its page only with the reader's reason (M752-SA1..SA5). A ledger entry the reader keeps
  open (scene:clock) still stays open: approving it would certify a value it doubts.
- The auditor's approvals (m752-021). A new page used to send almost the whole ledger back to review
  (an approval was tied to the whole set of originals): on large ledgers the review could never catch
  up — measured, 60 people at 128k context stuck at 286 of 313 entries for good, 200 people at 631 of
  969 — and every page re-sent ~70,000 characters of unchanged entries. An unchanged standing,
  knowledge, thread, thing, body or faction entry now keeps its approval over pages only added, unless
  the new pages name its subject or the subject is in the scene; the scene and current states are
  reviewed every page; an edited older page sends everything back. Measured: 313 of 313 by the second
  page and kept (71 entries asked a page, not 227; ~48,000 tokens a page, not ~71,000); 969 of 969 by
  the fourth. My earlier line that the housekeeper reads "a page or a short stretch" was wrong: it is
  served the whole house too (measured 25,000–45,000 tokens against the auditor's 38,000–100,000).
- The workers, measured per page (16 October 2026, a 40-page, 25-person tale at 128k, every worker answering its
  contract): the storyteller and seven worker calls, each once — the page reader (~12,800 tokens in), the world
  (~10,500), the scribe (~8,500), the second reader (~3,300), the auditor's source reading (~2,600) and review
  (~23,900), the plans keeper (~900); no repeated call and no repair pass after the chain. From one page to the next
  each request keeps its beginning: the page reader 81%, the world 90%, the auditor's source reading 80%, the scribe
  61%, the plans keeper 48%, the second reader 43%, the auditor's review 36% (it shows only the new page after its
  checkpoint) — what a provider that caches a prompt's beginning does not read again. Those two pages left the ledger as
  it was; in play it changes every page, and the readers kept far less until m753-001 (above). A second call happens
  only when a first answer leaves its contract unfinished (the world's seats, the auditor's decisions, the seeder's main
  character); how often his model does that was not measured. The "Auditor scratchbook" (workers' room, read-only)
  shows the saved audit itself: law DOM-M752-22.
- Branches and the auditor (m752-015): a source section is named by its page's id, and a
  branch copies every page under a new id, so a branch of his long tale found none of the
  auditor's receipts and read the whole tale again ("278 original source sections still need
  review"), a batch per run. The branch now carries them under the copies' names
  (auditprogress.js branchAuditBooks: receipts, the people they resolved, the ledger's citations,
  approvals and completion keys where they were computed over the parent's same pages); a branch
  already made reuses a receipt for the same text under a name it does not hold
  (auditsources.js reviewAuditSources). A branch from an older page still re-reads its newest
  page and runs one audit (M66), now over reused sections. The 503 in his report ("Service is too
  busy") is his provider's own answer to one auditor call; the call is tried again.
- The automatic audit's waits (m752-017, chat.js scheduleLedgerRepair): it starts a quarter
  second after the house is idle and again as soon as a pass that got somewhere ends (both
  were 15 s); after a pass that got nowhere or failed, 5, 10, 20, 30 s at most (were 1–5 min),
  and that wait is never cut short; two stalled passes in a row still pause it. A house busy
  with his page or its readers: the light's next look starts it, 5 s at the latest.
- His stuck correction ("The recovery verdict remains inconsistent after
  clarification: The fidelity decision needs an exact claim from this record and a
  valid status"): its answer had said, rightly, that page 94 holds the record's words.
  The house now reads the claim under "Alexia:" in quotation marks as the record's
  words, "p94 (#8793a1, the court, Oct 15 1247 10:20)" as page 94, and "didn't" as
  the page's "didn’t"; it says back the one real mistake (page 64, an earlier scene,
  listed as a conflict) with what a conflict is. A correction the old reading blocked
  is asked again once, by itself, when the house is idle (VERDICT_POLICY); M752-C1/C2
  settle his answer's shape in two calls and his saved state in one.
- His three yellow corrections on his 316-page tale (m752-009): "Incorrect original-source
  quotation" (a repair whose passage left words out, refused after the conversation with no
  word to the model), "Evidence "p242": quoted passage does not occur" (a quote of what the
  page says across its phone markup, told only "copy exactly") and "did not provide a usable
  correction verdict" ("person: Edie Dale", offered by its own law, dropped without a word,
  until its third look ended the talk). Now: markup, character references and unseen
  characters are marks; a quote with words left out is read where every piece is the
  page's; a refused repair, a quote that departs (with what the page says there), an answer
  that is no verdict and a look past two are said back in the same conversation, twice at
  most; "person: NAME" is served as the pages that hold the name. VERDICT_POLICY 2 asks
  about his three once more, by itself, when the house is idle (laws M752-H1..H5).
- His fourth (m752-011): "(1) … preservesAssertion is false, not true. (2) Evidence "p52":
  … where your quote has "thing?"" — the model had closed a quotation mark where the page's
  line runs on, and called the donations line "supported" while saying the record does not
  preserve what the page asserts (Rias says it, not Vanessa). Both are read now, in code
  (evidence.js wordSpan; continuous.js readVerdict): the quote is the page's words, the
  verdict a contradiction, and the line is repaired. Blocked by the reading before,
  it is asked again once by itself (VERDICT_POLICY 3; laws M752-H6..H8).
- His fifth (m752-012): the model agreed the donations line is wrong (Rias says it, not
  Vanessa) and could not repair it, because a repair's right words had to be the page's,
  letter for letter, and the page has it as Rias's dialogue; it was set aside "unsafe", yellow
  for good. Now a repair may be in the record line's own voice ("she said" → "Rias, not
  Vanessa, said"), provided every name, place and number in it is one the pages give; the
  keeper's own audit, the continuous audit's reading and its recovery share that one rule.
  His correction is asked again once by itself (REPAIR_POLICY; law M752-H9).
- Still yellow, on purpose: a correction whose answer says its sources do not settle
  it (with the specific reason), whose line is his, or for which no edit in the
  originals' own words can set it right (blocker "unsafe", with its reason); and one whose
  verdict could not be read in two attempts (six calls) — until he presses "Manual
  continuous audit" or "Manual yellow check" (the workers' room), which ask again by hand
  and step aside for his page ("Finish it" carries on).
- Tales stored by M751, opened in place by m752 (an M751-made shelf of five tales,
  its device rows kept as they were): every tale opens and draws; every checkpoint
  reads byte for byte as M751 reads it; the completed audit stays verified (no audit
  again after the update); no reader or auditor is asked on opening; a page, a swipe
  and a branch work; no errors.
- What heals itself when a tale opens or its next page is read: copies of one
  knowledge fact fold on load; bare continuous-audit findings are cleared; a keeper-off
  tale's record lines are rebound to their pages; a seat owed to the World is placed;
  a persona the rule before M752 made of an ordinary sentence ("I am Byakuya Kuchiki's
  lieutenant.") is let go, journaled and undoable (js/engine/duels.js
  personasRefusedToday, run first in chat.js taleOpened; DOM-M752-8); a historical
  correction blocked by the reading before m752-004 is asked again once.
- Writing while the light is blue: the send waits 5 seconds at most (M3), then the
  notes open with "Not in these notes yet: the newest page …" (DOM-M752-9).
- Not repaired on their own, on purpose: a spelling correction made before M752 that
  rewrote an ordinary word ("may", "the first of May") stays in his pages until he
  takes that correction back with the Housekeeper's undo; the house does not rewrite
  his pages again by itself. Seats the old loose persona match let go are not brought
  back; the World seats people again as the story goes on.
- Never verified in this environment: a live provider, the owner's phone, long play,
  his own stored story.
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
