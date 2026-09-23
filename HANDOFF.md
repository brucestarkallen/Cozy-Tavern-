# Cozy Tavern — handoff for the next session (state at m413-001)

## READ THIS FIRST — HIS STORYTELLER'S PERSONA IS THE THING THAT BREAKS
0f. EVERY WRITER OF A PERSON'S "NOW", AND ITS LAW (M412) — check them ALL when one misbehaves: the world agent (only
   for someone here the page does not show, or with no now — code guard, M401/M409); the scribe (only for someone the
   page shows — code guard, M412); the tidy (never over a now written this page or while it read, M411); the page
   reader's upkeep (lets go of a now of a ground left, M405/M409); the auditor (never — M128); his hand (always his).
0e. THE PAGE'S HEADER IS THE GROUND (M409): a place may begin with a number ("10th Division HQ") — state.js
   headerMutations dropped every one before M409, so his headers never set the ground. The readers' chain puts the
   ground where the page's header says before judging anyone's "now"; a now records the ground it was written on
   (nowAt) and is stale when the ground moved; whoever here has no now is the world agent's, mentioned or not.
0d. THE QUIET ONES IN THE ROOM (M401): whoever is here, not the main character and not on the latest page or in his
   message (world.js quietInScene — any word of the name, letters folded) is the world agent's to keep alive: one
   line of what they are doing and weighing, written as their page's "now" (people.set field state) — where the
   storyteller already reads everyone here. The world agent may write a "now" for them ALONE (a code guard); the
   page's people are the scribe's, the absent are their seats'. Never an order, never a line of dialogue.
   M402: SILENCE IS NOT LEAVING — the page reader's presence.leave for someone the page (or his message) never names
   is let go in code (extractor.js leavesTheyWereShown). Someone the world agent puts where the scene is WALKS INTO it
   (offscreen.set at the scene's ground, not arriving → presence.enter) — never "elsewhere" there.
   M403/M413: THE AUDITOR may take someone out only when the latest pages show them GOING (their name in a sentence that
   says they leave) or they have been silent through the last eight pages of a story that has eight — never someone
   named in the recent pages without going; and it may move the ground ONLY to what the latest page's header says.
   RUN THE LONG PLAY (tests/dom/longplay.mjs) with the harness and the walk — M403's first rule broke LONG-8 unseen.
0c. CANON VERIFICATION IS SWITCHED PER STORY (M399): canonOn(storyId) / setCanonOn — the row "canonOn:<id>", a tale's
   own (STORY_PREFIXES), off unless switched on for that story; Settings' switch is the OPEN story's and names it; a
   branch keeps it. The old single switch moved once (on where canon was really used) and is gone.
0b. THE HOUSEKEEPER NEVER CLAIMS WHAT IT ONLY PROPOSED (M397). A ledger card the dry run says can never land is handed
   back in the same run ([CANNOT LAND], the ledger's reasons) and, if still unlandable, staged REFUSED with why — never
   pending. An answer with cards that says "done/fixed/updated" is handed back once ([NOT YET]). A newer ledger card
   that decides the same facts (ledgerFactKeys) supersedes the older; an edit quoting the same passage longer or
   shorter supersedes too.
0a. NOBODY IS IN TWO PLACES (M396). "The same person?" has ONE answer in the whole ledger: engine/names.js —
   samePersonName (letters folded, a first/last name, a name cut short, canon's other names via setAliasSource) and
   isHere (a name means one person, or only its exact letters decide). Every book uses it: the seat guard, the seat
   finder, the storyteller's elsewhere list, the drawer, the world agent's "[in the scene]". applyMutations ends every
   batch by letting go of any elsewhere note for someone in the scene. M398: the scribe, the auditor, the referee's
   cast, the housekeeper's reading, the whole-ledger reading and the drawer's people panel ask the same matcher; a
   page is found by folded letters and canon's other names (findPersonKey); a page names the story threads its person
   owns (ownedThreadTitles) wherever it is read. No seat where the scene itself is (unless on
   the way in); no arrival on a stance that stays put. Never compare person names by exact lower case again.
0. WHAT HE TYPES IS WHAT HAPPENS (M391). A shortcut (#story, #p, #pp, #q, #continue, #time, #question, #Put TWB, ((…)),
   //) does NOTHING in the house: the page he sees, the page kept and the words the storyteller is sent are exactly what
   he typed, in the tale he typed them in. Their meaning lives in the standing words (M379's SHORTCUTS). The house may
   only (a) name it on the composer chip and (b) not read an out-of-character turn into the ledger. Never again a new
   tale, a hidden page, a stripped word or an instruction riding beside his message because of a # word.
He tells his story with a frontier model and a hand-built persona (a funny teller, his own frame and rules). Almost every
bad week in M340–M380 was one kind of mistake: the house putting words in front of that teller that read like a system
talking to an assistant. The teller then thinks in an assistant's voice ("the user wants…", "this wrapper…"). Rules:
1. HIS MESSAGE IS THE LAST THING IT READS. Nothing the house writes may follow his message as a USER message. What does
   follow (his own note, the referee's outcome, a switch's line) goes as a SYSTEM message by default (setting "Sent after
   your message as", afterRole — SillyTavern's post-history instructions). Claude takes it as a system message too on
   Opus 4.8, Opus 5, Fable 5/5.1 and Mythos 5/5.1 (mid-conversation system messages); Sonnet 5, older Claude models and a
   few strict houses refuse it — the refusal is remembered PER MODEL (providers/latesystem.js) and those words then go as
   a user message on that model. CHECK THE PROVIDER'S CURRENT DOCS BEFORE CLAIMING WHAT A MODEL CANNOT DO (M385).
   Inside it, HIS TWO ALWAYS CLOSE IT (M384): the referee's outcome and any switch's line first, then his main
   instructions repeated (when "Say it again at the end" is on), then his note at the end — always last.
2. HIS WORDS TRAVEL AS HE TYPED THEM. A shortcut (#p, #pp, #q, #continue, #time skip, #story, #question, ((…)), //) is sent
   exactly as typed; its meaning lives ONCE in the standing words (commands.js shortcutsText). Never a second message with
   its law. "continue" typed is "continue" sent; only an EMPTY or hidden message is sent as "Go on.".
3. NEVER ASK AGAIN ON ITS OWN. No automatic second try, for any reason (M377). A page that landed is the story (M357).
   "Try again" is his.
4. NO NOTES ABOUT ITS PLUMBING. No banner about seeds, the grounding phrase or retries (M370, M376→M377).
5. THE GROUNDING PHRASE lives in the standing words only ("You open every thought with “X”.", woven twice), plus a true
   thinking seed ONLY on a provider that continues a started thought (DeepSeek, Moonshot). Never a user line, never glued
   to a command, never on Synthetic as a trailing message (M375).
6. THE NAME BOXES ONLY CHANGE WORDS ("the writer" → his name, {{user}}/{{char}}). Nothing is ever ADDED for a name, and
   the name his rules were written around is never rewritten (M378, M380).
7. SMALL-MODEL HELP ONLY BEHIND THE DERESTRICTED SWITCH (on hold, off). OFF = byte for byte (M354).
8. BEFORE YOU PUSH ANYTHING THAT TOUCHES WHAT IS SENT: send a turn THROUGH THE REAL APP (the dom walk — typed into the
   composer, kept by the real store, sent by the real provider) and read every message's ROLE and WORDS. A test that
   builds the messages by hand proves nothing about the app: M379's "as typed" field passed every such test while the
   store silently dropped it, and his bare "#story" reached the storyteller as the house's own sentence (M382). A new
   field on a message must be added to store.js's append whitelist, or it does not exist.

Repo: https://github.com/brucestarkallen/Cozy-Tavern- (main). Every commit is tested first.
Full history of every law and fix: AGENTS.md (M1 … M385). (There is no SPEC.md in the repo — the
founding design lives in AGENTS.md's first entries.)

## Run the tests before any commit (all three; all must be green)
- `node tests/harness/run.mjs` — 810 checks on the engines, assembler, workers, laws (run it detached: it takes longer than one 300 s tool call).
- `bash tests/audit_lint.sh --quiet` — the lint audit (0 errors at M274; warnings reviewed there).
- `cd tests/dom && node run.mjs` — the walk: 111 scenarios of the real app in jsdom (every button,
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
- HIS MESSAGE IS THE LAST THING THE STORYTELLER READS (M379). A second user message after his, in the house's words, reads
  to a teller as a system instructing an assistant — his persona's worst enemy. So: every shortcut's meaning lives in the
  standing words (commands.js shortcutsText, with the craft) and his message travels AS TYPED (messages keep `typed`; a
  hidden shortcut still travels); the house's starter note is in the standing words; the continue nudge ("Go on.") stands
  in HIS place when nothing of his travels. What may still follow his message, only when it fires: a note HE wrote, the
  referee's settled outcome, and the switches he turns on (think-on-page, the sensors, derestricted, the frame echo) —
  and THAT goes as a SYSTEM message by default (M380, SillyTavern's post-history instructions; setting afterRole, beside
  the note at the end; Claude always gets it as user; a house that refuses a late system message is remembered and asked
  again with it as user). NEVER add a house line after his message again.
- THE LEDGER HEALS ITSELF, THE PAGE IS NEVER TOUCHED (M372): his mission is a house that runs itself, so a ledger error a
  careful reader would catch is the AUDITOR's to catch and correct (it runs after every page), never his to fix by hand
  through the housekeeper. It checks what the ledger says happened — who did what, to whom, with whose thing — read across
  the pages' sequence, and may let a wrong fact go (knowledge.forget). The first reader is told the same before it writes.
- THE WORLD IS A LIFE SIMULATION, NOT A GAME (M366, his words: "realistic real life simulation", "not gamey"). Everyone in
  the ledger lives their own life — their own people call and text THEM, the world is not arranged around the main
  character — and nothing in the world agent's brief is a quota: no "one contact a scene", no forced moves, no schedules.
  A person not looked at for hours is looked at again and placed where their own life has them now (which may be where
  they were, if their life keeps them there). A life of their own never drops HIM (M367): anyone with a reason concerning
  the main character keeps pursuing it through that life, and no count caps how many threads may press him at once.
  Threads run between ANY two people (M368: thread.set `with`), factions move for their own causes, the ledger lets his
  own threads go last, and the storyteller is shown this scene's threads first (renderThreads scene ranking) — the world
  is large, the storyteller's view of it stays small. Never add a counting rule to the world again.
- SILLYTAVERN'S MACROS ARE SWAPPED LIKE SILLYTAVERN SWAPS THEM (M361, voice.js withMacros, run first inside inVoice):
  {{user}}/<USER> = the one he plays (the main character's story name, else his own name), {{char}}/<BOT> = the teller.
  Never a raw macro on the wire. His own words are never renamed. THE NAME BOXES ONLY CHANGE WORDS (M380): where the
  house's own text says "the writer"/"the storyteller", or a rule says {{user}}/{{char}}, his names go in — nothing is
  ever ADDED for a name (M379's "one man" line was an injection, and is gone with its box).
- THE HOUSE NEVER ASKS AGAIN ON ITS OWN (M377, his order: "delete this feature — let me do the retry button manually,
  the automatic thinking breaks my persona"). No second try is ever sent by the house — not for a leak (M117), not for a
  page inside the thinking (M120), not for a plan with no page (M323-M339). A reply that brings no page lands as it came
  and "Try again" is his. The only thing kept: a page PLAINLY written inside the thinking (from its last header on) is taken
  out of it, silently — local, nothing sent. A thinking page is never given less than 16,000 tokens of room when he set
  less (M376's floor, the one override his rule allows) — the commonest reason no page came. NEVER re-add an automatic
  second try.
- A PAGE THAT HAS LANDED IS THE STORY (M357): nothing the house notices ABOUT a page ever sends that page back to the model.
  What it saw (his character taken, the same words again) is said once at the end of the NEXT turn, in his voice
  (plain.js mineWord/staleWord -> sensors.js keepPageWord -> takeWordForTurn -> stack.js sensorNote). The only re-asks left
  are gone too (M377): nothing is ever asked again by the house. Any future check follows this.
- THE GROUNDING PHRASE (M358/M359/M375, Settings -> This story -> The frame, under the two names): NEVER AS MACHINERY.
  It lives in TWO places only: woven into the standing words as who the teller is ("You open every thought with “X”." —
  after the frame's opening breath and at the paragraph break nearest a third down), and, ONLY where the provider truly
  continues a started thought (a continuation flag: DeepSeek's prefix, Moonshot's partial, or one he typed), as the
  thought's own first words — every turn, out-of-character ones too, never announced (M370/M371). M375 took away the
  line at the end ("open your thinking with…") and the quotation glued to a command's law: his teller's thinking started
  narrating them in an assistant's voice ("the user wants…", "the wrapper"). On a provider with no continuation flag
  (Synthetic) a seed is an empty extra turn the model reads — never send one there. Empty box = not one byte.
- SMALL-MODEL WORK IS ON HOLD (his word, at m358): he tells with his frontier model. M354/M355 stay behind the derestricted
  switch, off; M356's sensors behind their own, off. Build nothing further for weak models unless he asks again.
- THE SENSORS READ, THEY NEVER WRITE (M356, agents/sensors.js): after each page, narrow true/false questions about it,
  answered as numbers by a decisions model (Jev: {model, state, questions} -> {answers:{id:{noul}}}) or by any model as
  JSON — the same questions either way. Averages over the last four readings; when one falls under its floor the
  storyteller is told ONE line on the NEXT turn, in the writer's voice, taken once and let go, and that sensor stays quiet
  until its average climbs back. Never touches the page it read. Own switch (`sensorsOn`), OFF as it ships = nothing asked,
  nothing sent, nothing kept.
- EVERY HELP FOR A SMALL MODEL LIVES BEHIND THE DERESTRICTED SWITCH, AND NOWHERE ELSE (M343, M344, M354). settings key
  `olderModel`; chat.js reads it per story turn into `settingsValues.olderModelNow`. ON it adds — a page that repeats the
  last pages asked for again once, its reused phrases named (M355, plain.js staleLeak); the scene said once more
  at the end with what each person here is in the middle of (assemble/anchor.js), the record's far line called back
  (M344), the five plain lines (assemble/plain.js plainRules), and ONE re-ask of a page that took his character
  (plain.js mineLeak -> voice.js askAgain('mine')). OFF it adds NOTHING: the request is byte for byte what it was, and no
  check runs. ANY future help for a weak model goes behind this switch too — his frontier model's persona is the thing
  that breaks first, and M340/M341/M342 are what that costs. M354-1 fails if one byte of it leaks into an OFF turn.
- THE REFEREE'S OUTCOME REACHES THE STORYTELLER (M345) — it never did from M11 to M344: chat.js never passed `ruling:`. It rides
  FIRST IN THE CLOSING WORDS (toTeller, never inVoice), only for THIS page of the writer's (pendingVerdict.forUser), in words a
  person says (no tier names, numbers, rounds, poise). The referee OFF = not one byte of it, no referee or seeder call, a standing
  fight let go. The cast sheet is seeded WITH the ledger in view (<player> names the MC; brief, people, bodies, record, pages), the
  MC first; a sheet without seedVersion 2 heals itself on the next page. Prove any referee change in the app (DOM-68).
- A PROVIDER THAT REFUSES A WEB PAGE IS CARRIED BY HIS OWN SERVER (M353): every provider call goes through
  providers/relay.js houseFetch — direct first, and only a call that throws with nothing (what a browser says when CORS
  refuses it) is tried again through serve.py's /api/relay (https only, never a private address; COZY_RELAY_TEST=1 lets the
  tests reach a local stand-in). A connection that needed it is marked viaRelay and goes that way from then on; the turn
  says so once. Run `python3 tests/relay.py` when serve.py or relay.js is touched.
- A NEW SETTINGS SECTION MUST BE LISTED IN A ROOM (M352, settings.js SETTINGS_ROOMS): canon verification was in none, and
  unlisted used to mean “the last room” — the glossary — so its switch was unfindable. Unlisted now shows beside its
  neighbours (roomForSection), and M352-1 + DOM-73 fail if a section is listed in none or in two.
- “IT ISN'T THINKING” IS ANSWERED BY THE APP (M351): a page that asked for thinking and got none says so once per
  connection and level, and the connection's Test sends what a page sends, reads any thinking channel and the reasoning
  tokens, and — when none came back — asks once at the top, so the writer is told WHICH it is (this level / this address /
  the words kept from him). Never diagnose a provider from here: this container reaches none of them.
- THE MODEL TEACHES THE HOUSE HOW IT THINKS (M350) — so a new model needs no release: a refusal is READ (effort.js
  lessonFrom: the levels it offers instead, or the one field it does not take) and the SAME turn goes again fitted to it; an
  Off that did not stop the thinking is noticed and Off then asks for the least; thinking is read from any channel named
  reason/think/thought. Kept per model@address for 30 days (learnedFacts), applied LAST over any spelling (openai.js
  requestBody), shown on the connection card. Order of trust: the provider's listing > what the model taught > family rules.
- A RELAY THAT LISTS A MODEL'S LEVELS IS SPOKEN TO IN THOSE WORDS (M349): style 'declared' (Synthetic's
  reasoning_parameters.efforts) = ONE field, reasoning_effort, one listed value (Off = "none" where listed, else the least);
  GLM on Z.ai by its generation (effort.js zaiWire: 5.3+ always thinks low/high/max; 5.2 off/high/max; before 5.2 a switch).
  "Cannot stop thinking" is ONE test, alwaysThinks(conn) — the worker room floor and the connection card read it.
- A MODEL IS WHAT ITS PROVIDER SAYS IT IS (M348): an alias (Synthetic's "syn:large:vision" = Kimi K3) is read by the weights
  the provider's own /models listing names (hugging_face_id / canonical_slug) and sent only the levels it declares
  (reasoning_parameters.efforts) — learned with the room (providers/detect.js, one question, kept per model@address) and read by
  every family test (effort.js modelNames). A page that asked for thinking and got none says so on its receipt.
- WHAT THE STORYTELLER SAW IS KEPT WORD FOR WORD (M347): each page's parts (Normal: tap, read, Copy) and the request as the
  model took it (Raw: settings, then every message under its role; Copy all = the exact body) live in js/sent.js — ITS OWN
  database (cozytavern.sent.v1), never in the receipt, a backup or the book sync; pieces cut at content-chosen paragraph
  breaks, kept once per tale; the newest KEEP_PAGES (200) pages of a tale keep theirs. The receipt carries only sentId.
  Providers return `sent: {url, body}` of the ACCEPTED request (never headers). Pages from before m347 cannot show words.
- CANON VERIFICATION IS THE WRITER'S OWN EXTENSION, NOT A COPY OF ITS IDEAS (M346): js/canon/grounding.js is Canon Grounding's
  index.js made by tools/vendor-canon.py (three asserted changes: imports -> js/canon/host.js, its toasts and jQuery from host.js,
  no ST panel). NEVER edit grounding.js — change the extension, run its gates (node --check on an .mjs copy, test/proof.js,
  test/sim.mjs), then vendor again. js/canon/bridge.js hands it the story as ST's chat and card, Cozy's people ledger as its
  cast (Summaryception's slot), the 'canon' worker for its model calls, ONE live memory object per story (canonMeta:<id>).
  Its note leads the briefing. Switch canonOn, OFF as it ships = never loaded, never called, not one byte (DOM-69).
  M386 (Canon Grounding v0.64.0): the WHOLE of it is Cozy's now, and the ledger beside it —
  · WHO'S HERE IS ITS CAST: bridge.js ledgerOf marks everyone state.present has `present: true`; the extension's ONE door
    (ledgerOnScreen) puts them in the scene with no name on the page and resolves their pairs. Never filter the lent
    ledger by name anywhere else.
  · ITS OPENING WORDS ARE HIS (bridge.js CANON_HEADER, through getContext().canonHeaderDefault): no wiki, no note, no
    storyteller. The ⌀ / story-position / pin blocks are the extension's own words, in the player's voice.
  · THE SERIES' FACES LIVE IN "WHAT'S TRUE OF THEM" (canonLocks → canonSyncLedger, a chain job BEFORE the checkpoint):
    apply.js canon.lock/unlock carry `source: 'canon'` — the series writes only where nothing of anyone else's stands,
    corrects and withdraws only its own, and a truth let go by anyone else is marked in state.canonLetGo (journaled:
    folds, branches and take-backs keep it honest). Never write a canon-sourced lock any other way.
  · OFF SENDS NOTHING OF IT: the send path withdraws the series' truths (canonWithdraw, journaled) or leaves them out of
    an out-of-character turn's copy (withoutCanonTruths); Settings withdraws them from the open story at once.
  · Its levers: the ledger room "What canon says" (per story, canonAction → the extension's host surface
    CanonGrounding_api) and Settings (js/ui/canonsettings.js, drawn only with the switch on, one copy of each setting:
    the extension's own live object). A branch keeps its canon (carryCanonMemory). The scribe, the world agent and the
    auditor are handed the real record (canonRecordFor) — byte-identical requests without it.
  M387 (Canon Grounding v0.65.0): ONE HOME FOR A FACT — measure before claiming none is repeated (M387's scene read
  Rukia's violet eyes three times a page). A face lives in "What's true of them" (canon's features + its `look`; a
  feature the look states is no line of its own); ledgerOf marks `holds: ["appearance"]` for everyone here whose face
  the shelf shows whole, and the note then gives them no Appearance line. Who they are in canon lives in the note; what
  THIS story made of them lives on their page (the scribe keeps pages true to the record and never repeats it). His
  truths render before the series' (renderCanon). Never add a second place the storyteller reads a canon fact.
  M388: pages written before that division are cleaned ONCE, on their own (agents/canontidy.js, a chain job before the
  checkpoint): a core no hand wrote, that repeats the record, is asked about once (memo by the core's words in the canon
  memory); the answer must ADD no word and LOSE no word of the story — checked in code, refused otherwise; journaled.
  M389 (the audit): EVERY PER-TALE ROW PREFIX IS IN store.js STORY_PREFIXES (canonMeta and sensors were not — a gone
  tale's copy rode the house book forever). A new per-tale row = a new prefix there, in the same change. A face his
  brief describes is marked held (ledgerOf's briefFace) from the first page. One wiki-name reader (bridge.js wikiName).
  M390: an imported SillyTavern chat keeps its canon memory (import/chats.js: the chat metadata's canon_grounding_*
  keys ARE canonMeta's shape) — never drop a chat's canon on the way in.
  M392: CANON THROUGH HIS STORY (agents/canonlens.js + Canon Grounding v0.67's host lens). A wiki is canon's END; his
  stories leave canon. Each canon person who rides is judged once per premise (brief, cast notes, his canon notes, the
  story position): every canon statement holds / changed / later; only what holds is said — to the storyteller (the
  note, rebuilt the same turn), to the workers (canonRecordFor) and in the room ("Not so in this story"). A kept part
  is the statement's own words only (keepHolds). Never let canon's end-state reach anyone as fact or as prophecy.
  M393: THE LENS ALWAYS READS (lensPremise is never empty — NO_PREMISE when he wrote nothing) and SILENCE IS NOT
  ESTABLISHMENT (a rank, marriage, child, death or alliance holds only where the story establishes it). To restart a
  story's first page clean WITHOUT touching it: "read again" under it (M113 — the ledger rewinds to before the page and
  the readers read the same words fresh). M394: the lens never waits for a page — the readers' chain reads the ledger's
  canon people before the world agent and the scribe (canonLensLedger), and the room reads them when it opens; it
  covers powers (abilities) and the world around them (related) too (Canon Grounding v0.67.2).
  M395: WHERE THE SCENE IS belongs to the ledger (state.place, from the header) — lent as canonScenePlace; the
  extension's setting follows it (Canon Grounding v0.68.0), a known canon place or none. Canon's own notices NEVER
  pop up: chat.js routes the extension's toasts to canonNote, shown in its room ("What it noted lately").
- THREE OPT-IN SWITCHES, EACH "OFF = NOT ONE BYTE" AND HELD BY A BYTE-FOR-BYTE LAW: think-on-page (M339), older model (M343), and the
  cut-before-header tick. Anything that adds words to what the storyteller reads goes behind a switch like these, in the
  writer's voice, one line — or it does not go in (M341/M342). The storyteller's room is read through chat.js roomOf ONLY, and roomOf is the provider's room: NO switch may ever take a page, the note or the record out of a request (M344) — help a weaker model by ADDING what is far (assemble/anchor.js), never by removing.
- WHATEVER THE HOUSE SAYS TO THE TELLER IS ONE SHORT SENTENCE IN THE WRITER'S VOICE (M341) — never a block, a heading, a template
  with sample prose, or a manual's tone, and least of all in the closing message, the most heeded spot. Print the closing
  message and READ it as the teller would before shipping anything that adds to it.
- A MODEL THAT DOES NOT THINK COPIES WHAT IT SEES (M340, M342): every kept page is made whole IN CODE (ui/pageshape.js) because kept
  pages ARE the example — and NOTHING about format is ever said to the storyteller (M340's shown skeleton broke his persona
  and was removed in M342: fix the page after it arrives, never lecture the teller before it writes). Anything
  that keeps a page must go through tidyPage; anything that detects a header must use headergate.isHeaderLine (bare or
  bracketed). In the walk, never select with ":last-of-type" on a class — take qa(...).slice(-1)[0].
- A REPLY WITH NO HEADER, IN A TALE OF HEADERS, IS NOT A PAGE (M339) — never detect the teller's thinking by its LABELS again:
  M335 made its thinking plain prose. And when patching a file by matching ONE line, check the line is not the opening of
  a multi-line block (the switch's listener landed inside another handler).
- WHO COULD KNOW THIS (M338): before every page the briefing lists, per person in the scene, what no page has shown them
  learning (engine/world.js blindSpots — code, from the knowledge lines); after every page the second reader holds the page
  to that list (UNTOLD KNOWLEDGE) and the mender fixes a false telling by itself. Anything new that teaches the ledger
  who learned what must keep writing knowledge lines — they are what both halves stand on.
- A FACT SAYS WHEN (M336): anything old that is put in front of the storyteller carries its age, and nothing the house
  recalls by matching WORDS is ever labelled as relevant — the storyteller builds scenes on what it is told matters.
  Before blaming the branch/fold for a "memory from nowhere", run the two probes in AGENTS M336: they are exact.
- THE PERSON THE TELLER THINKS IN (M334, assemble/voice.js): SYSTEM-side words the house wrote go through inVoice (names)
  then inPerson (I / You); USER-role words are the writer speaking and always say "you"; the frame, quoted examples,
  phrase lists and story data are never transformed. Any new rule text must read right in BOTH persons — print it.
- NOTHING IS MADE IN THE OPEN, AND THE PAGE IS NEVER RELOADED UNDER THE WRITER'S HANDS (M332). A multi-step creation (a
  branch) marks its row `building` from its first write, stays off the shelf and off the device until whole, and
  is remade at the next load if cut off. A boot pull still running keeps the tavern closed (sync.js veil); a push
  notes its stamp BEFORE it goes (booksPushing) so its own work is never pulled back. tests/branchrefresh.py.
  In Playwright, poll with page.evaluate — wait_for_function does not await an async predicate.
- THE HOUSE NEVER WRITES A REMARK INTO STORY DATA (M330): the record, the ledger and the pages hold the story's facts,
  never a sentence ABOUT the house, its edits or its buttons — the storyteller reads all of it as story, every turn.
  A fact is made true by EDITING (mend the page → its record line refolds → the auditor relocks), never by a note.
  And THE BRIEF WINS everywhere: anything that would spread a changed value asks agents/ripple.js againstTheBrief first.
- THE PREFILL HAS ONE PLAN (M328, providers/effort.js prefillPlan): the turn, "Test it", the card and the form's live line
  all read it — never decide prefill behaviour anywhere else. <think> first = a thinking SEED (reasoning field,
  empty content, flagged); after </think> = a started reply. Seeds keep the thinking open; started replies
  obey M318. A worker on the storyteller's connection gets none. `node --check` does NOT check these ES
  modules — import the file.
- THE TWO NAMES (M327, assemble/voice.js): any NEW sentence the house sends the storyteller in its own words must go
  through inVoice / toTeller / briefingOpening / askAgain — and must read naturally said by the writer to a
  named friend. Never route story text (pages, brief, ledger, record) through it. Never call the teller a
  persona, a role or a character. No names set = the old words, byte for byte.
- THE PAGE IS THE LAST DRAFT (M326, ui/headergate.js splitReply): before the page → lead; a repeated header → the page
  begins at the LAST one; the model checking its own work → tail. What a later turn is sent of an earlier
  page is pageOnly(). Never touch a saved page; never cut a page to a bare header; a different place is a
  window, not a draft.
- A SCREENSHOT IS EVIDENCE — READ ALL OF IT (M324): the house's masthead above a page means that page did NOT open
  with a header; that one line said what four guesses had not. Where the page begins has two signs
  (ui/headergate.js): a header line, or the end of a plan that names itself.
- TEST A STREAM AS A MODEL STREAMS (M323): the walk's house answers in ONE piece with finish "stop"; anything that
  touches the storyteller's stream needs a scenario that sends a few characters at a time and one that
  ends on finish "length" (DOM-57 shows how: a fetch of its own, workers passed through). And a probe
  that "reproduces" a fault in every case at once has usually not sent anything — check it has a connection.
- EVERYTHING BEFORE THE HEADER IS THINKING (M322, ui/headergate.js): a story page begins at its header line; what a
  reply says before it goes to the page's thinking (never the page, never the wire). Never delete — a reply
  with no header comes back whole. A new js file must be added to sw.js's shell list.
- ONE VOICE ON THE WIRE (M321): one system message (stable prefix first), one briefing that opens in plain words
  (stack.js STATE_MARKER — never a literal, never a bracket tag), one closing message with the note
  last. A header sent to the storyteller is written as one person briefing another, and the craft's
  teaching of a block must match the words that block really opens with. A picker CHOOSES (settings.js).
- ONE PERSON, ONE NAME, IN EVERY BOOK (M320): never look a person up in ANY ledger book by exact key — pages
  by findPersonKey, seats by people.js seatForPerson (this person's seat and nobody else's). A seat is
  written under the name the person's page stands under. When two books describe one person and
  disagree, suspect the KEY before the content.
- WHEN THE WRITER SAYS "IT STOPPED WORKING", RUN HIS PATH BEFORE NAMING A CAUSE (M319): three causes in a row
  were shipped on reading alone and none was his. Probe the real send path in the walk's environment
  (boot() from tests/dom/env.mjs, a connection shaped like his, house.state.calls for the wire); if
  the code is right, it is STATE — list every switch that could produce the symptom and make each one
  say so where he is looking. A setting that overrides a visible dial must never be silent.
- A PREFILL SWITCHES THE THINKING OFF on DeepSeek (and Claude refuses the pair): the thinking dial decides
  (effort.js prefillSilencesThinking) — any level but Off keeps the prefill home, said on the turn, the
  card and the form. Making a dormant setting WORK (M307) changes behaviour for everyone who had filled
  it in: before shipping such a fix, ask what else that setting does once it is live.
  A refusal from one ADDRESS is never remembered against another (the beta handler runs first).
- ONE WINDOW FOR A TALE (M317): memory.js windowFor(mem, setting) — the writer's current Settings value, the
  tale's stamp only when there is none. NEVER read mem.window or the setting directly. Whoever DETECTS a
  gap and whoever REPAIRS it must measure with the same function, or the light turns yellow over work the
  repairer will never do. A light that says "tries again later" must book that look itself. When the
  writer's symptom survives a fix: stop guessing causes — diff the path that works against the one
  that does not.
- THE RECORD NEVER STAYS STUCK ON A PAGE (M316): no usable answer → the oldest page alone → on a second run a
  one-word proof of life → a byHouse marker line for that ONE page (never quoting it: the record rides
  every later keeper request). A dead keeper writes nothing and says so. Ask the writer's configuration
  before shipping a cause — M315 fixed a thinking setup he does not use.
- A WORKER THAT THINKS HAS ROOM TO ANSWER (M315): thinking is counted inside max_tokens on most houses; a
  worker's room is its ANSWER's. call.js floors the room at 16,000 when the connection is set to think,
  and asks again once when an answer comes back empty with thinking (a model that thinks by default).
  A reader that treats an empty answer as "went quiet" must say so where the writer can read it.
- THE LIGHT'S REPAIR NEVER READS WHILE THE STORYTELLER IS AT WORK (M314): a queued job runs later than the
  moment it was asked for — re-check `busy`/`replaying` INSIDE any queued reader. A slow save is a test:
  switch the checkpoint key-reuse off (state.js BUILT_FROM) and run the walk to see what a slow phone sees.
- CHECKPOINTS ARE LEDGER + KEYS (M314): journal and log entries live once per tale in ckptBank:<tale>, keyed
  by CONTENT (never by id — versions of a page are sibling timelines that share ids); loadSnapshots /
  wholeVersions hand checkpoints back whole, saveSnapshots / saveVersionStates bank them. Never write
  `snapshots:` or `versionState:` rows directly. A holed journal is handed back EMPTY, never partial.
- THE BROWSER HOLDS THE OPEN TALE; THE DEVICE HOLDS THE LIBRARY (M313). A tale not open is let go from
  the browser ONLY when store.js provenOnDevice finds every local row and page on the device, value for
  value; otherwise it is pushed. Boot pulls the house and the open tale. `python3 tests/holdsone.py`
  (17 checks) holds it, the ledger value for value included — run it for ANY change to store.js,
  sync.js, sync-worker.js or serve.py, with twobrowsers, wipe, guard, append. THE LONG PLAY IS A
  GATE FOR EVERY PUSH: three pushes skipped it and shipped a fault it would have caught.
- NEVER getAll() the settings table (M312): it holds every checkpoint of every tale — over a gigabyte on
  the writer's phone. Keys by getAllKeys(), rows by key. `python3 tests/perf_rooms.py` measures the
  ledger and Settings with a LIBRARY on the shelf and holds the budgets; a change to store.js, sync or
  a room's first draw is measured there before it ships. One heavy tale proves nothing about his lag.
- The house book (M311): a browser speaks only for the rows it changed — before every push the worker
  holds its house against the device's and carries every row it lacks and did not itself let go
  (store.js keepWhatWasNeverLetGo). Shelves heal from the tales' own projectId (projects.heal), names
  from /api/recover/projects. NEVER push any book whole from a store you have not proven whole.
- The device keeps its own safety copies (M310): serve.py zips the data folder at every start (once a
  day), on demand at /api/backup/now, newest five kept, each verified readable; "Take a copy" downloads
  that zip. `python3 tests/backup.py` holds it. NEVER make the browser fold the whole store for a
  backup again. OPEN, the writer's standing order: storage like SillyTavern's — the server owns the
  files, the browser holds only the open tale; today every browser holds every tale and pulls all at open.
- The thinking room (M308): a token budget exists only on Claude (floor 1,024) and, through OpenRouter, on
  anthropic/ and google/ models; every other house has LEVELS only and is sent the writer's level
  (effort.js budgetFor decides, and gives the form and the card their words). A dial a house cannot hear
  is never taken in silence — it says so where it is set.
- The prefill (M307): the first words of the REPLY, put back on the page at the reply's first word
  (effort.js prefillLead/prefillGap) because every house answers only with what follows it; DeepSeek's
  own host takes a started reply ONLY at /beta (the turn and "Test it" both go there, with a fallback
  that still brings the page); a refusal is remembered with the address that said it. To see what any
  house is really sent, run the provider with a recording fetch (tests/harness/m307.mjs `tell`).
- The books do not forget (M305): sixty facts a person and forty threads are RUNAWAY GUARDS; a reader
  is shown the newest plus the older facts that bear on the scene (world.js renderKnowledge, fed the
  last pages by stack.js), and whatever is not shown is counted on the line. Before raising ANY
  storage cap, measure it times the snapshots — every snapshot is a whole ledger (state.js, up to
  120), and the tale's book carries them all. A mutation run is one harness pass per command: the
  tool's wall is 300 seconds, and a run cut short leaves mutated files behind — restore and `cmp` first.
- Nobody is nowhere (M304): presence.leave keeps a `lastSeen` seat at the ground the page BEGAN on
  (state.groundWas); a leaving is applied before its seat within a batch; ONE definition of who is
  carried (auditor.js carriedBy — the brief by whole or spoken name, an invited card, a standing, a
  thread, on the way, a locked truth, a loose end, the writer's hand, a fresh history) serves the seat
  law, the wake and the drawer; SEAT_CAP (40) is a runaway guard. The world agent is shown everyone the
  story carries by importance with the cut SAID (peopleForWorld) and told who has NO SEAT. A seat has
  one wording and one order (offscreen.js seatNowWords/seatLine/seatOrder) — never word a seat by hand.
  Test names in fixtures must be DIFFERENT people: near-names are one person (findPersonKey).
  After a mutation run, `cmp` every mutated file against its copy before running anything else.
- A house's spelling of "think" (M303): providers/effort.js reasonStyle → one branch in openai.js
  requestBody. Kimi K3 (`kimi`): reasoning_effort low|high|max ONLY — never `thinking`, never off
  (off→low), never medium; K2.x on Moonshot (`kimi2`): the thinking:{type} switch only. Before adding
  or changing a house, read its own docs and run the wire (tests/harness/m303.mjs shows how: the real
  provider, a recording fetch). A refusal (reasoningDownAt) is honoured only for the spelling it was
  made under (reasoningDownShape); change a house's spelling and its old marks heal themselves.
  The writer's sampling dials are never stripped — a house with fixed dials gets a standing word in
  the form (thinkingHint), not a silent override. A worker's room has a 16,000 floor on a house that
  cannot stop thinking.
- Asking again (M302): "Try again" is the NEWEST turn read from the store (the storyteller's page is
  written anew; the writer's unanswered page is asked again, nothing let go) and is hidden only while a
  telling streams; the note's "Ask again" goes back through the door that failed (a version stays a
  version); every door reads the turn's own words for its command (turnArgsBefore — an `(( … ))` turn
  asked again stays out of character); a housekeeper retry that never lands puts its turns back
  (restoreAfterRetry). `python3 tests/cutthinking.py` proves the kept thinking in a real browser, two
  contexts — run it with twobrowsers.py. A coat's glow is capped against the writer's own reference
  room in tests/paint_magma.py; a new probe of another browser must open the tale with chat.openStory
  (a fresh browser holds tales shallow, M189).
- Thinking with no page (M301): a telling stopped, dropped or empty while the storyteller thought keeps
  its thinking in `cutThinking:<tale>` (the housekeeper's in `hkCut:<tale>`) until the next page/answer
  lands; never a page, never in a request. Connections read A to Z through providers/order.js byName —
  DISPLAY only; db.connections.list() stays as made (the resolvers' fallback). A coat is a COATS entry
  in app.js + a token block in base.css + a radio; tests/paint_magma.py measures the magma room (the
  glow, the words over it against real pixels, the scroll against the deep coat) — run it before any
  change to a coat that paints a gradient, because contrast.py cannot see one.
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
