> **THE LINE-BY-LINE AUDIT — checkpoint and how to continue it: `audit/README.md`** (the ledger of every file: `audit/LINE_AUDIT.md`; the gates: `audit/gates.sh`).

# Cozy Tavern — handoff for the next session (state at m630-001)

## READ THIS FIRST — HIS STORYTELLER'S PERSONA IS THE THING THAT BREAKS
00000. M548 — CHOICES MATTER (Settings → Choices matter, per story, OFF by default; agents/choices.js). Off must stay byte for byte
   (law M548-6). The outcomes are sealed BEFORE he chooses by a helper that cannot know his pick — never let the storyteller
   or any later step decide or soften them; the referee never rules on a sealed choice. The offer lives on the page
   (choiceOffer, per version), the seal on his message (choiceTaken — store.append must keep it; it once did not), so
   branches, take-backs, sync and backups carry them as they carry pages. The helper runs OUTSIDE the page chain: no send
   waits for it. Walk DOM-197/198 run it through the app.
0000. M547 — THE SMART RECALL READS HIS MOVE FOR A SMALL STORYTELLER TOO, AND WAITS BESIDE THE REFEREE. chat.js smartRecallFor
   is asked for every storyteller, started right after canon's question (beside the referee) and awaited just before the
   build — never move it back after them (DOM-196 measures the overlap). For a small one it is not offered what the small
   request carries in full (stack.js smallRecordWhole — the small branch's own doors; law M547-3 fails if they part); the
   lines it names ride whole, with their detail, beside the word-matched ones in the closing words, within
   SMALL_PICK_CHARS. No picks = the small request byte for byte as before. Why: his find, arcquill.com — its "no context
   limits" is per-turn retrieval by meaning; Cozy had every one of its layers except this one, in the small mode.
000. M512 — THE SMALL MODEL AT ITS BEST (his order: "make the smaller model the best — realistic, beautiful prose, natural,
   no old LLM repetition"; a mode that never touches the frontier request — proven byte-for-byte, 24 of 24 fixtures).
   A small page carries laws.js PROSE_LAWS (ten of his prose laws, his words) beside ALWAYS_LAWS (Real People, Real
   Record now among them) and the helper's picks (the helper is no longer offered what always rides); OOC rides on an
   out-of-character turn. laws.js LAW_START reads a name with commas or a closing aside — four laws had been read as the
   tail of the law before them; lawKey drops the aside. smallprose.js: the story's voice (a passage of the newest page a
   BIG storyteller wrote, older than the eight sent whole — receipt.small says who wrote a page; else the page that
   repeats the others least) rides at the end of the craft block (seat 2 stands) with its own row "The story’s voice";
   the turns of phrase the last pages keep using are said once at the end of the plan (never names, places, small
   words or a stretched sound; the longest stretch, as written, cut at twelve words); the plan says how each person
   talks (planner "voice"). Walk DOM-169 proves it through the send button (fails on m511-001); tellerConnectionId() —
   a walk run alone has no active connection set, and "mark the active one small" marked nothing.
00. M511 (after a platform crash cut the m510 session short; nothing of the crash reached GitHub — m510-063 was whole).
   A BRANCH COPIES ITS PAGES WHOLE: chat.js branchFrom writes each page with db.messages.copy (store.js), never through
   messages.append — append is the maker of NEW pages and keeps only the fields it lists (a field on a page never
   listed there is lost in every branch: M510-43's keptText was, and the branch's first open mended his put-back page
   again). WHAT THE STORYTELLER SAW IS WHAT WAS SENT: a record line reaches the request only through stack.js
   recordLine (pages, words, the auditor's detail beneath it) — "Our story so far" once wrote its lines by hand and
   dropped every detail while the rows showed them; each notes row holds exactly its part's lines (What remains = "In
   full, just before the pages that follow"; "Earlier moments, in full" = the one list of the people here and the lines
   his move brings up; the small model's rows likewise). Law M511-1 checks every row line is in the request, in every
   voice and notes role. NEVER build "who's here" name patterns per line or per pass (patternsOf, once a call).
0. CLOSED (M506) — BRANCH WHILE A READER IS STILL OUT. It was cause (a): M66's `exact = exact || Boolean(carried)` overrode
   M112's inexact mark, so the branch kept a ledger without the page's reads and its incomplete ledger became the page's
   checkpoint. Now (chat.js branchFrom): still running = the 8s wait ran out AND extractor.js workInFlight(storyId); such
   a branch carries the boundary snapshot before the page's turn (else the ledger as it stands), is inexact
   (`mustReread`), and re-reads its last page; a settled tale's newest page is exact and sends no reader. Walk DOM-127
   holds it end to end (a held reader; the branch's reading in the branch only). The laws of the m498 session still
   hold for the ORIGINAL (its readers write only to it). ALSO M506: buildArmedDirective serves a battle and a war again
   (M505-2 threw on state.duel); mendThoughts shields the exact thought forms before mending and heals the shape its
   first version made of a thought with a ~ inside (pages mend on the next open, per build); shownOnPage reads "Vivi's
   already…" as Vivi (CONTRACTION_NEXT) and "Vivi's left hand" as her body; goneByTheirOwnPage never trusts a "Left…"
   line the journal dates before the person's last presence.enter (nowPredatesTheirReturn).
0a. THE SEND IS MEASURED, NEVER REASONED (M507): `python3 tests/perf_send.py` (SENDS=2 for his steady state — the number that matters; PROFILE=1 for the top functions before the
   request, PHASES=1 for the isolated costs, store reads/writes by key, regex compilations) — run it for ANY change to
   the send path, the checkpoint store or the assembler, and compare against AGENTS M507's numbers. The checkpoints are
   one row each (snap:<turn>:<tale> + the index snapshots:<tale>; the version ledgers ver:<msg>:<swipe>:<tale> + the
   index versionState:<tale>, an array of keys), the bank is in parts (ckptBankPart:<n>:<tale>); never read or write
   those rows directly — loadSnapshots / saveSnapshots / snapshotState / loadVersionStates / saveVersionStates /
   saveOneVersion / versionStateOf. An index write lets go of every row of its kind the index does not name.
   `python3 tests/migrate_checkpoints.py` proves a store from before M507 moves to the rows on its first send, whole. sweepOrphans reads a tale's id from
   the row's SUFFIX. M507-2: a boot pull after a page append takes PAGES ONLY when the served book's snapshotAt (serve.py) is
   no newer than this browser's bookStamp — never the device's older ledger over the browser's newer one; run
   `python3 tests/bootpull.py` for any change to the pull, importStory, or serve.py's fold.
0b. THE STATE OF THINGS IS READ ONCE (M508–M509): the main character's book is the writer's (newest four, never "but"),
   four called-back facts a person, a sixteen-page blind window with clipped facts, the shorter list names a shared
   fact, a blind spot never repeats a shared line, a word in most facts calls nothing back, one next move rides once;
   a seated person's page opens EMPTY and a seat-shaped core (two or three clauses, never one) is cleared on opening
   (seatMadeCores). If he pastes the blocks again, measure them against AGENTS M508/M509 before touching the renderers.
0c. ONE MAN, ONE NAME (M509-2..8): a role the ledger names in apposition ("the courier Hachigorō") resolves to the
   named page (people.js roleOwnersNamed — once per ledger object and role, NFC-safe; NEVER search the ledger's words
   on every render again, that was the m509-002 lag); present descriptors join their person on opening, in the page
   reader's upkeep, before the checkpoint, AND in the fold (chat.js healFold) — a heal written on the newest page is
   otherwise thrown away by every Try again (that was the courier doubled in every retry block). people.rename says a
   name once ("Hachigorō Hachigorō" no more).
0d. TRY AGAIN IS CHECKED WHOLE (M509-9/10): after a rewind the ledger's hour is checked against the previous page's
   header; a mismatch restores the whole boundary ledger, or, with no checkpoint kept, the house reads the page before
   again by itself before the retry is built (settleRereadOwed). Never patch the hour alone; never tell the writer to
   do something. The rewind itself (M21/M72) was never broken — walk DOM-129/130/131 drive it through the real app.
0e. THE ROOM MOVES RIGHT (M509-12/13): when the page moves to another place altogether and names its room, everyone
   not named is left behind at the old ground (extractor.js, farMove — not for "the Tenth's courtyard" written
   "Tenth Division courtyard", not for a room of the same compound); a spot within the same ground does not let the
   nows go (staleNows + seatAtScene); the dress is never said twice in a position (withoutAttire). The drawer says
   which page the ledger belongs to (ledgerStandingWords, #ledger-standing).
0f. CLOSED (M509-15): a public moment the reader wrote into ONE witness's book is now everyone's who was in the room
   (extractor.js broadcastPublicMoments at read; world.js publicMoment + state.js wasThereFn at render) — seen is
   public, heard is public only when said before all and never with a mark of privacy; a whisper stays a whisper.
   M509-14: the frame and the note can be switched off (frameOn/noteOn); the purpose line is gone for good.
   Also: the perf gate's steady send at the end of this session — request 605 ms, his page 84 ms,
   worst freeze 270 ms, whole send 1280 ms (CPU 6×) — a shade over m507-007's 430–520 / 45–90 / 100–240 / ~1100 on a
   busier VM; nothing attributable in the profile (structuredClone 281 ms self, the store's clone, is the known cost).
1zb. NO THIRD AUTHORITY ON THE WIRE (M495): every text a side agent adds to the storyteller's request must read as the
   writer's own notes — m495.mjs scans the whole wire; a new agent's slot must pass it (voice it, no capitals-form labels).
1za. THE LIVING LEDGER SIMULATION (M492): tests/harness/livingledger.mjs runs a story through the real gate and heals
   and checks the truth page by page. Any change to presence, seats, the heals, knowledge, wounds or names must keep
   it green — extend its pages with every new failure he reports.
1z. A POSSESSIVE IS NOT A PRESENCE (M491): shownOnPage is the one test of "shown" for the page reader's leave gate,
   the auditor's leave gate and the walk-back heal — keep possessives-of-things and dialogue out of it. goneByTheirOwnPage
   repairs a missed leave from the person's own page. showsDeparture's OUT_THE_DOOR is the vocabulary to extend.
1y. THE SESSION AUDIT'S LAWS (M490-3) — each was a real fault of this session: a heuristic that can DELETE or MERGE
   (isGroupName, resolveDescriptor/resolveRole, sameFact, findActorKey, the run-past cut, the canon trim) must answer
   "nobody / keep it" on doubt; probe it with real names shaped like the thing it catches before shipping. Laws in
   m469, m471, m472, m482, m484 pin every case found.
1x. A DISPLAY FAULT IS PROVEN ON THE SCREEN (M490): tests/mend_marks.py reads the STORE and the SCREEN in a real
   Chromium. Every asterisk-pair regex (prose.js, pageshape.js, lint.js) keeps markdown's flanking rule — an emphasis
   never starts or ends on a space OR an asterisk ([^\\s*]; M490-2). Diff the renderer before/after any change to it. When he says 'it's still there', compare store vs screen before touching a rule.
1w. THE PAGES' MARKS HEAL ON OPEN (M488): chat.js mendPagesOnOpen, once per tale per build (pagesMended:<id>); a new
   mark rule in pageshape.js reaches old pages by itself on the next open — no button needed.
1v. THE CANON NOTE READS CLEAN (M487): grounding.js stripTemplates keeps a template's display text (never drop a
   template whole unless it is key=value only or a hatnote/quote); bridge.js trimCanonNote trims the dead and closes
   a cut block — every note the bridge hands out goes through it.
1u. THE CANON ROW ALWAYS STANDS WHEN CANON IS ON (M486): stack.js pushes 'What canon says' with the note, or empty with
   canonWhy (canon/bridge.js, from grounding.js lastInjectionReport — the extension loads lazily; read it through
   groundingMod, never a static import).
1t. THE BRIEFING'S ANTI-BLOAT LAWS (M484/M485 — and the same folds run on LOAD in state.js normalize): one wound per body part (bodies.js bodyPartOf), one fact in one wording
   house-wide (world.js sameFact — numbers strict, names nested), a role is its holder and a group is never a person
   (people.js resolveRole / isGroupName), the dead one line (offscreen.js isDeadSeat), a bare card a name. Any new
   writer of wounds, facts, people or seats goes through these doors.
1s. EVERY PAGE NODE IS NUMBERED (M483): any new builder of a .msg node must call numberPage (chat.js) — renderThread,
   the landed page, rerenderMessage do. The ledger light has four states: working, trouble, well, WAITING (is-waiting).
1r. A DESCRIPTOR IS NOT A PERSON (M482): people.js resolveDescriptor at every name door (pages, seats, knowledge,
   standings, threads, presence.enter). Two answers are none. pageshape.js SHIELD_RE also shields ~t~*…*~/t~ and the
   window's marker — any new asterisk rule in mendMarks must keep it so.
1q. A #STORY CONCEPT IS THE BRIEF (M478/M479): chat.js briefFromConcept — by itself on send (switch `conceptToBrief`,
   default OFF since M480, EMPTY brief only) or by hand from Settings → The brief (asks before replacing); agents/concept.js
   polishes (acceptablePolish guards names and size); the founder re-reads the brief at run time.
1p. "MEND THE PAGES' MARKS" (M477): chat.js mendAllPages — tidyPage over kept pages, unchanged pages never written.
1o. THE PAGE REPAIR SHIELDS OBJECTS (M476): pageshape.js shieldObjects — never skip a whole page for a GFX block or a
   fence again; mendMarks and joinSoftWraps run around the object. The comma rule (a stray quote) vs the speech-verb
   rule (close it) is deliberate: M458-2 holds 'He said "stop' → closed.
1n. ROSTERS ARE READ WHOLE AND DEDUPED (M475): normalizeRoster(v, state) — never cut a name before the twin check.
   mergeSeed grows every `_auto` entry; only a heal or an `_estimated` guess is replaced. The seeder's contract names
   a power as its own domain.
1m. THE CAST IS WEIGHED AGAIN BY HAND OR WHEN THE BRIEF CHANGES (M474): drawer.js measurePanel "Weigh them again" →
   chat.js weighCast → maybeSeedSheet({ force: true }); seedDue(state, told, { brief, castNotes }) reads sheet.briefMark.
1l. THE DOMAIN OF THE BEAT (M473): battle moves carry `domain`; duels.js beatRating rates the PLAYER's beat by it from
   his sheet (a summoner commands at summoning 9, not his melee 3). Units keep the battle's domain. The measure panel's
   headline is `default` — "for anything not listed".
1k. AN ORDER IS A MOVE; #p IN A FIGHT IS THE LAST BEAT (M472): referee.js isOrder/ORDER_RE, continuedBeat, BEAT_RE. A
   beat the referee's answer calls a command is an exchange whatever `exchange` said; #p never reaches the micro-call
   inside a fight. The account's `move` is what a #p continues — keep writing it.
1j. THE ARBITER AUDIT (M471): the engine is a faithful port of Arbiter v0.42 — diff it by AST when Arbiter moves
   (/home/claude/astkit was the tool: parse both, normalise meta→state / getSettings()→eng, diff per function). Four
   divergences were real and are fixed (the gate's apostrophes, findActorKey's other direction, gear's default, the
   seeder's safeKey). The directives differ on purpose (M345). Never re-import Arbiter's directives or its HUD.
1i. THE REFEREE'S FIELD AND ITS ACCOUNT (M470): two against one is a BATTLE (duel_start.allies → battle_start in
   normalizeAdj); `joins` on every fight beat → `combat.join` (apply.js) → duels.joinFight (a duel widens into a
   battle carrying both fighters; a battle grows; a war refuses). Every ruling carries `account` (what, action, why,
   circumstance, actor/opposition ratings, delta, chance, roll, tier, fight, reports) — the ledger's, NEVER the wire's
   (M345: the storyteller hears words). normalizeAdj reads `domain` now (checkDomain) — it never did; lone checks
   rolled on the default rating until M470.
1h. A TURN THAT RAN PAST ITS END IS CUT (M469): director.js stripControlLeak(text, { writerText }) ends a page where a
   model began writing the writer's next turn (a role label + his words, or his whole message as a paragraph) — the
   provider's fault, the house's repair. Keep the two guards (label AND his words) — one alone trips on prose.
1g. SETTINGS FOLD LIKE THE LEDGER (M468): settings.js buildQuickNav — folded is a class on .settings-section, the h3 is the
   handle (role=button), `settingsFolds` remembers his taps, a deep link's unfold is never remembered, nav.applyFolds
   re-reads the store (the reset, the walk). Never use `hidden` for a fold — the rooms own `hidden`.
1f. THE WINDOW'S MARKER HAS ONE DEFINITION (M467): engine/window.js (WINDOW_MARK, WINDOW_LINE, windowCutAt,
   normalizeWindowMark). NEVER look for the literal '*** The World Beyond ***' again — a model writes it bare, bold or as
   a heading, and every literal look-up missed his page at once. tidyPage writes the exact form on keep; the 🎨 style,
   scenePartOf, the M129 guard and the lint read any dressing. Any NEW reader of the window goes through window.js.
1e. THE LEDGER FOLDS; THE PAGE MARK; THE SHELVES SORT AND REST; HIS OWN-VOICE WORDS; THE COAT'S SPEECH COLOURS (M466).
   (a) drawer.js: every panel folds to its name + a chevron + a live row count (.fold-count, a span AFTER the h3 — the
   h3's textContent stays exactly the title, the walk reads it); `folded` is a CLASS, never `hidden`; OPEN_BY_DEFAULT =
   the-clock, whos-here, the-people, elsewhere, the-record; his taps are remembered in settings `ledgerFolds`. The
   counts come from one MutationObserver (window's in jsdom) + a rAF, an attribute write only where the number moved.
   (b) ui/pagemark.js: "page N of M" thumb on .thread-wrap's right edge (position: relative now), draggable; chat.js
   renderThread stamps every storyteller page data-page over the WHOLE tale and the thread data-pages. jsdom lays
   nothing out — the number is real-browser only. (c) chat.js: `shelfSort` (played | name | newest) — sortTales and
   sortShelves, one rule; `db.projects.update(id, patch)`; a shelf with archived:true rests in the "N resting shelves"
   corner (restingShelvesRow), is never offered for a move or a new tale, its tales stay on it. The resting corners
   FOLD now (`.shelf.collapsed > .shelf-stories { display:none }` — M22's corner never did) and their button heads wear
   the shelf's quiet. (d) assemble/stack.js ownWordsFor + OWN_WORDS_PLACES: settings `ownWords` = [{id,on,name,role
   teller|you|house, place before-pages|before-your-message|after-your-message, text}]; each entry is its own message at
   its landmark (an assistant entry NEVER opens a request — it steps behind his first page) and its own receipt row
   "Own words — <name>"; off/empty = byte-identical request (M466-2). ui/ownwords.js draws the cards. providers/openai.js
   folds same-role neighbours for a model named reasoner only (deepseek-reasoner refuses them; deepseek-chat does not).
   (e) ui/speechcolours.js: settings `speechColours` = { [coat]: { spoken, thought } } laid as INLINE --spoken/--thought
   on <html> by app.js applyTheme (inline beats the coat's block; #drawer's re-scoped tokens untouched); the pickers show
   the ratio against the room's ground and offer "Brighten it until it reads" — never a silent change of his pick.
   (f) body.settings-open hides the fixed jump pill under Settings. TESTS: harness m466.mjs (6), walk DOM-115…118.
1d. THE COATS AND THE LEDGER'S DRESS (M465). Nine coats: fantasy, cyberpunk, magma, academy, aurora, starship, deep, dark, light
   (+ system). A coat is FOUR things now: a COATS entry in app.js (its --bg, for the phone's bar), a token block in base.css
   defining EVERY token :root defines (51 colours — beauty.mjs fails a coat missing one), a coat-row radio + swatch in
   index.html, and its dress in css/coats.css (the room's glow on .thread-wrap — the column that never scrolls — and the
   ledger in the coat's idiom). css/ledger.css is the ledger's structure for every coat, scoped to #drawer ONLY (the
   housekeeper's sheet shares .drawer and is untouched): one card a panel with a glyph (SVG masks over currentColor, keyed
   on data-panel), the four rooms as a tab bar (keyed on data-room), pill buttons, slot rows, a timeline for What changed /
   drifted / the workers, "By hand" boxes for the forms, and the reading order of a room set with CSS `order` — the DOM is
   drawer.js's, so the walk clicks nothing new. The academy coat re-scopes every token on #drawer (parchment, brown ink)
   and walks footprints on "Who's here" (opacity only, stilled by reduced-motion). NEVER: a transform, will-change or
   backdrop-filter on #drawer (M146); a gradient on .thread or .drawer-panels (they scroll); a glyph as an emoji. TESTS:
   `python3 tests/paint_coats.py` — every coat on a SEEDED ledger, every text surface of the story and all four rooms
   held to AA, shots in /tmp/coats/; tests/contrast.py and tests/coat.py now walk all nine coats; paint_magma.py and
   perf_rooms.py still hold the magma glow and the open/close budget. The only JS change: peoplePanel's addLine splits a
   page line into a .page-key span + text (same textContent).
1c. AUTOMATIC IS A SWITCH YOU CAN SEE AND TAP (M464): Settings (canon-lib-auto) and the story room (canon-room-auto) have an
   "Automatic" chip, checked when the story finds its own wiki (the line says which); a wiki is checked only when he CHOSE it
   (meta.canon_grounding_wiki_ok.manual) — what it found by itself is never shown as his pick. Tap Automatic = let the choice
   go (act('wiki','') → the extension rediscovers); the last chosen wiki tapped off = Automatic too.
1b. THE WIKI LIBRARY IS A SWITCH FOR THIS STORY (M463): in Settings (canonsettings.js drawLibrary) and in the story's room
   (drawer.js), each library wiki is a button: a tap adds it to where THIS story looks (the extension's binding,
   meta.canon_grounding_wiki — a list), a second tap takes it away; two or more = a crossover; the line above says where
   the story looks. Never a plain-text list promising "one tap", never a tap that replaces the story's wiki.
1a. A CARD SAYS WHO THEY ARE (M462): engine/people.js cardCore, on the storyteller's cards only (the page is never rewritten):
   a core clause that is a moment ("assembled at 1st Division HQ with the available captains", "at the corridor outside…")
   goes, and a comma item of the series' own look that True of them carries in the same request goes (Rukia's "petite,
   slender, black hair, large violet eyes"); his own truths are never a reason; what the story made of them stays.
0z. CANON'S WORDS WHOLE (M461): canon/grounding.js cleanWikitext keeps the term of the wiki's Japanese-term templates
   ({{Nihongo|Tenth Division|十番隊|Jūbantai}} → "Tenth Division"; the romaji when the English is empty; {{lang|ja|X}} → X) —
   his canon note read "The  is one of the Gotei 13", "a white , a black ,". AUDIT OF HIS V177 PRESET: in Cozy the storyteller
   reads the house craft (assemble/craft.js, 17.5k tokens, distilled from V177 in M36), not the 40k preset; measured, the
   craft repeats itself in 3 eight-word runs out of 70k characters and carries every point of his taste explicitly — it was
   left as it is (a rewrite risks the quality he has, for tokens that ride the cached prefix).
0y. THE LAST REPEATS (M460): world.js renderBlindSpots says each lacked fact ONCE, after the names of all who lack it (same
   marker, names and knower; facts lacked by the same people share a line) — his lines: 10,135 → 1,460 characters.
   canon.js cleanWikiWords (renderCanon, the series' own lines only): wiki scraps (".]]", "called .", "being ,") mended
   and sentences set in the past ("110 years ago…", "While she was…", "Even as a child…") dropped; his truths never touched.
0x. WHO KNOWS WHAT, ONCE (M459): world.js findKnowledgeKey never takes another person's book by a shared family name (two
   given names are two people — "Byakuya Kuchiki" wrote into Rukia's, and her block was drawn twice); renderKnowledge draws
   each book once, says a fact three or more here share ONCE ("Everyone here knows" / "Everyone here but X knows" / "Known
   to A, B, C") and folds re-worded facts (sameFactsOnce: 80% of words, equal numbers, the richer wording kept). Measured
   on a ledger shaped like his: 10,459 → 3,979 characters, nothing said before left unsaid.
0w. ANOTHER LANGUAGE IS THE STORY'S VOICE; THE MARKS ARE MADE WHOLE (M458). The second reader is shown his turn and told a word of
   another language in the page's own letters is never drift (only a run of another SCRIPT is the wire's glitch);
   continuity.js languageFinding lets such a finding go in code (never mended). ui/pageshape.js mendMarks (run by tidyPage on
   every kept page): *"…"* → "…", empty quotes, a quote or asterisk opened and never closed — marks only, never a word; a
   whole page to the letter.
0v. USAGE AND COST; CANON PER STORY; ONE WIKI LIBRARY (M457). providers/meter.js meters EVERY call on the one road
   (relay.js houseFetch → watchUsage: a stream is teed, the caller's branch untouched; JSON read from a clone; the
   provider's usage as reported, else four characters a token, marked ≈) into day books (db.settings 'usage:YYYY-MM-DD',
   one write after another); engine/usage.js sums today / 7 / 30 days and the per-day rate (over the days used) × 7 ×
   30, priced from each connection's priceIn/priceOut ($ per million; store.js add keeps them). Settings → Storyteller →
   Usage and cost (ui/usage.js). Canon: each story its own settings (bridge.js useStorySettings: the live object is the
   open story's copy, saved under canonGroundingSettings:<id>; the old shared key is only the template; a story that
   never looked anything up starts with nowhere to look); discovery reads the ledger's people too (the card); the wiki
   library (canonLibrary/addToLibrary/removeFromLibrary, key canonLibrary) is shared — Settings adds and removes, each
   story's room offers it as chips with "Add to library". Chip classes: usage-period, lib-chip — never nav-chip (a
   Settings room). A walk test must drive the canon bridge through the app's own UI: a test's own import of bridge.js
   is a second instance with its own live settings.
0u. ONLY SOMEONE ON THEIR WAY HAS AN ARRIVAL (M456): "tense" joins "busy" and "waiting" as stances that stay put — no ETA is
   written on them (apply.js offscreen.set, STAYS_PUT) and none is said of a seat stored with one (world.js
   renderArrival). Rukia at her desk read "unresolved tension with the main character, due now" for scenes. A seat with
   no stance keeps its ETA (M29).
0t. THE HEADER'S HOUR IS THE HOUR, ON ANY CALENDAR (M455). state.js headerMutations sets the clock from a header's time
   even with no real month ("Sunday, Hanami 5, 1001 AG | 09:20"), carrying the day words; apply.js clock.set takes a
   time of day (setTimeOfDay: same day words → same day, back or forth; other words → on by the day number, else the
   weekday, else one day; no words → an hour far earlier is the next morning); clock.js renderClock speaks the day
   words ("the day after …" past midnight with no header). With a header's clock, the reader's clock.advance is
   dropped too (it put the clock ahead). The open heal puts the newest header's hour back. A weekday before a custom
   month ("Sunday, Hanami 5") is a date, never the ground.
0s. THE MISSED PAGES ARE READ IN ONE GO, COUNTED ON THE BANNER (M454, his words: "why it keeps pulsing yellow… even it's not
   manual it should always have banner 100% process"). chat.js fillLedgerGap reads page after page while the house is
   idle (it was three a run and a minute between runs — the yellow pulse for as long as a backlog lasted), stops the
   moment the storyteller works (M314) and carries on by itself; the work banner counts "page 12 of 57 · 21%" to done
   (a pause says so and clears itself — workbanner.js paused). A page read out of turn is never asked again for the mood
   (extractTurn moodOwed:false — its mood is dropped anyway, M453): it doubled every missed page's time.
0r. THE GROUND NEVER GOES BACK TO AN OLD PAGE'S (M453). A page read OUT OF TURN (the light's catch-up of a page no read
   reached, chat.js readMissedPage) lands only what lasts (apply.js lastingOnly — never place, clock.set, presence, mood,
   seats): an old assembly-hall page read late had set his duel's ground back to the 1st Division, and the storyteller,
   told the ground is canon, echoed it into every header after. An ECHOING header (silent, or repeating the ledger's
   ground) no longer holds a ground the page's telling has left: the auditor may move it to where the telling stands,
   held in code (groundTheTellingStandsOn: the telling never speaks of the ground's own words and does speak of the new
   place's spot; M403's wrong move stays refused). On open, a newest page that never speaks of the ground asks the
   auditor quietly (groundLooksStale). DOM-107 reproduces his exact regression without the guard.
0q. THE LEDGER HEALS BY ITSELF — NEVER A BUTTON (M452, his words: "if the agent doesn't know what's wrong or self heal then
   this isn't smart"). When a story opens (chat.js openStory and app.js boot, after resumeUnfinishedChain) and after every
   page (the page reader's upkeep job), code with no model mends what an older reader left: someone "elsewhere" AT the
   scene's own place (a "last seen" there, or a seat at the whole place) whom the newest page's telling names as themself
   and does not end on them going is written in (apply.js hereByTheNewestPage); whoever the old compound test put in the
   room goes back (wrongWalkIns). Never while writing, replaying, reading or another browser's readers are at it. Never
   advise him to press "read again" for something the house can see — build the heal instead.
0p. WHO IS HERE IS SAID ONCE (M451): the notes that open the story say it ("Here now:" with where each stands and what they
   wear — shed 0, never dropped); the system's "Who's here" block holds the cast notes and the cards of whoever is here,
   never the names again. Measured through the app: the names once, the request 60 characters shorter, roles unchanged.
0o. WHO COULD KNOW THIS IS READ AGAINST THE STORY (M450): the second reader's untold-knowledge warn MENDS the page, and
   its blind spots come from the ledger's knowledge lines — one the page reader missed made a true telling look untold.
   It is handed the story so far now (memory.js storySoFar: the record and the unfolded pages before this one, whole
   into its room; chat.js passes them with the leash's renew) and told the ledger can miss a telling. Proven on the
   wire (M450-2) and in the app (DOM-104: the earlier telling reaches the reader).
0n. A GUARD ASKS THE QUESTION ITS WRITER WILL (M449, M164's law, searched through the whole engine): the auditor's standing
   guard now finds a standing the way the applier writes it (apply.js personBookKey — any form of the name, M419); the
   people tidy finds the page its answer means (findPersonKey); blindSpots skips the main character under any form of his
   name and counts a person's own lines under another form as theirs. The remaining exact-name look-ups in engine/agents
   are exact-first with a matcher after, or not about people (modules, lore, referee units).
0m. WHAT THE SERIES SAYS NEVER MENDS HIS PAGE (M448). The two readers whose findings MEND pages — the second reader
   (continuity.js buildContinuityMessages) and the record's checker (memory.js canonRecord) — are shown his truths, the
   brief's and the readers', never a truth with source 'canon' (canon's faces are where his story started; his story
   may change them). The auditor is told a face the pages changed in this story is relocked to the pages (canon.lock —
   a non-series lock the series never writes over). EVERY DOOR THAT MENDS A PAGE (chat.js mendAround callers): the
   keeper's checker, the second reader, the auditor's brief-wins, the eye's glitch, the ripple of his own edit — each
   rests on his material, his truths or a glitch; never on the ledger's moving state or the series.
0l. WHO IS WHERE IS NEVER MENDED (M447). The second reader (agents/continuity.js) is shown who is here by name and what is
   locked — never the seats — and told who is where is the page's. A finding that holds the page to the ledger's
   whereabouts is let go in code (whereFinding; one about who could know stays). Its warn MENDS THE PAGE: with the seats
   and the old law, a wrong "elsewhere" deleted "Rukia waited, arms folded." from his page (DOM-103 without the guard).
   Any new reason for a mend must be a fact that lasts (a lock, the brief) — never the ledger's moving state.
0k. A LEAVING IS WHAT THE PAGE ENDS ON (M446). The page reader's presence.leave stands only when the last sentence of the
   scene naming the person as themself (and the pronoun sentences right after it, when neither names anyone else by name
   or rank) narrates them going — engine/apply.js goneAtTheEnd, with showsDeparture (moved there from the auditor, which
   re-exports it). When the page MOVES the ground (header or answer; a header naming less of the same place is no move),
   the scene can leave someone behind: the leave stands unless the answer's "here" lists them. The auditor's permission
   to take someone out reads the same: the newest STORY page naming them decides, by its last such sentence.
0j. ONE HOME FOR A CANON FACT, KEPT (M445): with canon on, what the series says of a person rides in canon's note and their
   face in "What's true of them"; their page's core holds what THIS story made of them. agents/canontidy.js takes the
   series out of old cores — its law judges "the story's words" against the STORY'S OWN MATERIAL (brief, cast notes, the
   record, the unfolded pages, the person's arc and loose ends — chat.js hands it over); without material the M388 law
   stands (it refused even a right answer on his real cores). Memo cozy_canon_tidied2: a refusal is looked at again up
   to three times; only an accepted core is done. The world agent, handed the record, writes a canon person's core as
   who they are to this story. DOM-101 measures the real request: each canon fact once after the tidy.
0i. WHO IS HERE HEALS ITSELF (M444). (1) THE ROOM IS RESTATED ON EVERY PAGE: the page reader answers "here" (everyone in
   the scene at the page's end); whoever it names that "Here now" lacks walks in when the page's TELLING names them as
   themself (before any window, outside spoken lines, never by a family name another person shares — apply.js
   shownOnPage, narrationOf, scenePartOf) and the name means one person; nobody is ever taken out for being left off
   (M402 stands). extractor.js hereFromBoard. (2) LEAVING AND MOVING ARE STRICT like entering (M414): a name the ledger
   knows as two people ("Captain Kuchiki" with Rukia and Byakuya) takes nobody out and moves nobody — it took Rukia out.
   (3) THE SCENE'S PLACE IS WHOLE: a seat is at the scene only when it names every part of the place (apply.js
   seatAtScene) — the first-part test read the compound after M410 and pulled every NPC of "13th Division Barracks"
   into the captain's office. (4) CLEARED IS NEVER NOWHERE: a worker's offscreen.clear of someone the page shows there
   is her entrance (clearsThatArrive — page reader, world agent, auditor). (5) wrongWalkIns puts back, once, whoever the
   old compound test pulled in and no page has shown since (the page reader's upkeep job). The view a reader gets now
   counts its page index inside the 70% (lookup.js windowOfPages).
0f. EVERY WRITER OF A PERSON'S "NOW", AND ITS LAW (M412) — check them ALL when one misbehaves: the world agent (only
   for someone here the page does not show, or with no now — code guard, M401/M409); the scribe (only for someone the
   page shows — code guard, M412); the tidy (never over a now written this page or while it read, M411); the page
   reader's upkeep (lets go of a now of a ground left, M405/M409); the auditor (never — M128); his hand (always his).
0e. THE PAGE'S HEADER IS THE GROUND (M409; M417: a date or an hour FIRST is the clock's — the place is what follows it): a place may begin with a number ("10th Division HQ") — state.js
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
0b. THE HOUSEKEEPER NEVER CLAIMS WHAT IT ONLY PROPOSED (M397) — and M415: his cards LAND ON ARRIVAL by default (M96), so "done" of a
   card in the same answer is true; the [NOT YET] hand-back runs only when his cards wait for Apply (runConversation cardsWait). A ledger card the dry run says can never land is handed
   back in the same run ([CANNOT LAND], the ledger's reasons) and, if still unlandable, staged REFUSED with why — never
   pending. An answer with cards that says "done/fixed/updated" is handed back once ([NOT YET]). A newer ledger card
   that decides the same facts (ledgerFactKeys) supersedes the older; an edit quoting the same passage longer or
   shorter supersedes too.
0h. READ THE NOTES AS THE TELLER READS THEM (M416): send one turn through the app and read the briefing line by line. Words the
   house says live ONCE and every reader takes them from there — a thread's next (world.js threadNextWords), the line
   for what someone hasn't found out (world.js BLIND_LINE — the anchor and the second reader match by it). "Busy" is
   "busy with their own affairs", never "someone else". A small standing's bare number ("R-8") is M53, his rule.
0g. THE ONE MATCHER HAS ONE LIST OF TITLES, AND ONE "NAMED ON THE PAGE" (M414, engine/names.js). A title is evidence: two
   titles of the same kind that share nothing are two people (Captain/Lieutenant Kuchiki, Mr./Mrs./Dr. Sterling); an
   apostrophe inside a word belongs to the name ("Jovan's mother" is never Jovan); a courtesy after a name counts only
   when joined ("-san", "-taichō" — Jackie Chan keeps "Chan"). "Already here?" for someone walking in is strict
   (findPresent strict / oneMeaning — "Kuchiki" with two Kuchikis is nobody's). Whether a person is NAMED in a text is
   names.js nameOnPage and nothing else — never a title, "the" or an owner; "Ed" counts. The auditor's permission to
   take someone out needs a going the NARRATION shows (auditor.js showsDeparture: never a side, never a quote).
   Tests that need the tavern's database name it (cozytavern.v1) — never the first in the list (M347 added a second).
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
- The real-browser tests share default ports (8097 is six tests') — run them ONE AT A TIME, or give each COZY_TEST_PORT.
- `node tests/harness/run.mjs` — 893 checks on the engines, assembler, workers, laws (run it detached: it takes longer than one 300 s tool call).
- `bash tests/audit_lint.sh --quiet` — the lint audit (0 errors at M274; warnings reviewed there).
- `python3 tests/paint_coats.py` — every coat on a seeded ledger, every text surface held to AA (M465); run it for any change to a coat, to css/ledger.css or to the drawer's markup.
- `python3 tests/mend_marks.py` — the scene break and the page repair in a real Chromium: fourteen shapes, store and screen (M490).
- `python3 tests/pagemark.py` — the page mark in a real Chromium: the last page named at the end, the first at the top, the drag to both (M468-2); jsdom lays nothing out, so this is the only proof of the number.
- `cd tests/dom && node run.mjs` — the walk: 132 scenarios of the real app in jsdom (every button,
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
  referee's settled outcome, and the switches he turns on (think-on-page, the sensors, a small model's plan and sounds, the frame echo) —
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
- THE DIALS (M510, providers/knobs.js): top-k, min-p, presence/frequency/repetition penalty, stop texts, a seed — each
  sent only when he filled it in; hidden for Claude's house. A refusal that names one (knobRefused — read BEFORE the
  thinking's lesson, so a refused dial never costs him his thinking) is learned per model and address (learnFact drop)
  and the turn goes again without it. A worker never rides a penalty or a stop text (call.js WORKER_UNSAFE: they corrupt
  JSON) — the one override his law allows.
- A HEATED PAGE IS NEVER SILENT (M510-3, his word: "boring novel without slap slap slap and continuous moan… in movie sex
  scene always rendered"). The intimacy rule (modules.js NSFW_TEXT, the rule that OWNS a sex scene's acoustics per the
  craft's "Rendering At Full Resolution") said "porn volume as baseline is slop", "forced quiet… hotter than screaming",
  "wall-to-wall moaning is claustrophobic noise" and "characters talk through intimacy" — against his own Sound As
  Onomatopoeia and High Intensity Scenes, and it won, being the scene's own rule. Acoustics Are Simulation now asks for a
  continuous soundtrack in both lanes on every beat — character, state and setting shape the sound, never remove it;
  forced quiet muffles, never silences; Intimate Dialogue is mostly sound, words in short bursts, no conversation
  paragraphs mid-act. For every storyteller. PINNED COPIES FOLLOW THEIR BUILT-IN (modules.js followsBuiltin): the pin
  toggle used to freeze the words; a saved copy equal to words a built-in shipped with before (SHIPPED_BEFORE
  fingerprints) rides the built-in as it stands, an edited copy keeps his words, and a pin stores no copy (text null).
  When a built-in's words change, add the old words' fingerprint to SHIPPED_BEFORE. heatedNow (stack.js) reads a heated
  scene from what woke (any intimacy/contest rule — his imported ones too), the ledger's intimate mode, or a live fight.
  M510-4 (his page: lone "Nnnh—", "Mmf—", "Ah—", the slap and the creak NARRATED, not one word): a sound law's examples
  are what a model copies — the M510-3 text's pillow-biter and shy one, and the hushed block's "stifled, bitten back,
  half-escaped", came back almost word for word. Now: voiced lines stretch and repeat with words, names and pleas breaking
  through; a lone "Ah—" and a narrated sound are failures by name; repetition inside a sound IS the sound (rotate between
  beats); muffled = the same continuous sound, muffled, only when the scene forces it (shyness never does — planner);
  every heated block ends on what each paragraph carries (planwords.js). Copies pinned at M510-2, -3 or -4 follow.
  M510-5: an intimate scene on a small model carries the craft's WHOLE Intimacy section (pacing, limits, Body Veto,
  Erotic Momentum, Power Dynamic, Line-Cross Vertigo, Inexperience…) whatever the helper picked — the woken rule says its
  people half rides in the craft every turn; the sound is braided where the action puts it, never parked in one spot.
  M510-7: a fight's page carries the craft's fight laws (laws.js FIGHT_LAWS: Combat Calibration, Injury Resolution,
  Symmetry Law) and the sounds — from the ledger's combat mark, a woken contest rule, a live fight, or HIS OWN WORDS
  starting one (laws.js typedCombat, a local read like typedIntimacy; the ledger marks a fight only after its page).
  Small model only: the frontier request is unchanged.
- THE FRAME SWITCHED OFF IS OFF WHOLE (M510): no teller name leading the house's lines, no grounding phrase planted.
  Frame on: nothing changed.
- db.connections.add KEEPS EVERY FIELD IT IS GIVEN (M510): it kept an M22-era list and a NEW connection lost its prefill
  dials (M328), its learned model facts (M348) and every M510 field until saved a second time (update() always kept all).
- SMALL-MODEL WORK RESUMED AT HIS ASK (M510): he tells on a small model again (Hemmingway on hemmingway.io, a Qwen 27B
  finetune) as well as his frontier model. Everything for the small one hangs on the connection's own tick (below); the
  frontier request is byte for byte what it was. M356's sensors stay behind their own switch, off.
- THE SENSORS READ, THEY NEVER WRITE (M356, agents/sensors.js): after each page, narrow true/false questions about it,
  answered as numbers by a decisions model (Jev: {model, state, questions} -> {answers:{id:{noul}}}) or by any model as
  JSON — the same questions either way. Averages over the last four readings; when one falls under its floor the
  storyteller is told ONE line on the NEXT turn, in the writer's voice, taken once and let go, and that sensor stays quiet
  until its average climbs back. Never touches the page it read. Own switch (`sensorsOn`), OFF as it ships = nothing asked,
  nothing sent, nothing kept.
- EVERY HELP FOR A SMALL MODEL LIVES BEHIND THE CONNECTION'S OWN "Small model (derestricted mode)" TICK, AND NOWHERE ELSE
  (M343, M344, M354, M510). `conn.smallModel === true`; chat.js isSmallModel(connection) -> settingsValues.smallModelNow
  (story pages only). The old global `olderModel` switch is RETIRED — one switch for the whole house leaked the small-model
  words into his frontier model. THE QUICK SWITCH (main screen, its own item on the line under the message box — never
  inside the links row, which never wraps: there it made the page wider than a phone). M510-8: THE ONE MODEL CHOICE — the
  Quick switch, Settings' picker and "Use this one" all run chat.js useConnection: the house's activeConnectionId, and
  the story he is in follows it (its own story.connectionId, if set, is let go). The switch shows what the story he is
  in actually tells with (resolveConnection); Settings -> "Who tells this story" is the one deliberate exception and the
  switch shows it while it stands. Settings' picker drops a card from before when the connection in use changed
  elsewhere (activeWhenShown). Small models wear " · small model" there and in Settings; renderConnections refreshes it.
  ON: THE PLANNING HELPER (agents/planner.js, worker row 'planner') reads EVERYTHING — the whole craft, the ledger, the
  people's pages, the record, lore, the world's word, the director, thirty storyteller pages — after each page (the
  chain's last link), when the Quick switch or Settings hands a tale to a small model, and on opening such a tale. Its
  answer is DATA (readPlan: present people only, never the MC, the craft's own law names only, clipped); an unusable
  answer is asked for once more with a word why, then let go (never thrown: a throw is the queue's minute of retries).
  Plans are kept per page (id:version — M510-6: never the words' hash, or any mend dropped the small model back on the
  whole story; the words' fingerprint rides beside the plan and the helper reads a changed page again), the last four by
  order, so Try again finds the one before. M510-10: walking to a version (swipe back or forward on the last page)
  reads ahead too — a version whose plan was pushed out is read again, never sent whole.
  M510-11 — A SMALL MODEL REMEMBERS THE WHOLE STORY: the helper also writes "story", the whole tale the way a person
  remembers it (under 180 words, rewritten each page from the whole record and thirty pages), riding at the head of
  the notes ("Our story so far, the way I remember it:", receipt row "The story in short"); and at send time the M344
  recall (anchor.js: record lines whose rare words this scene and his message speak, up to three, each with its pages)
  rides word for word after the plan — the fold his move names, which the helper planned too early to know.
  M510-12 — THE WORLD ELSEWHERE: the world's word (what could reach this scene and when, what ripened out of sight, an
  open window's who/where/what) rides for a small model too — M510-2 had held it back, and a woken window rule then
  asked for a cut-away the small model was never told about; whoever the world's word names is recalled with their card.
  M510-13 — NO GAP LEFT: the pages between the record's reach (coveredUntil) and the eight were neither whole nor folded
  for a small model; a paragraph there that HIS MESSAGE names (anchor.js recallFromPages, two at most, each with its
  page) comes back word for word. The director's note, the editor's eye and the house's eye ride for it too (each
  short, each his switch). What a small model now gets that the frontier gets differently: the craft (the always-laws,
  the helper's twelve, the Intimacy section in an intimate scene, the fight laws on a fight, the sound laws on a
  heated page), the story (eight pages whole; the story in short; the plan; the far folds and in-between paragraphs his
  move names), the people (who is here and whoever the pages or the world's word name), the frame/note/own words by
  their small switches. Everything else rides as for the frontier.
  M510-14 — THE RECORD RIDES FOR A SMALL MODEL: the keeper's folds (written once, never rewritten), the newest first,
  up to SMALL_RECORD_CHARS (16,000 characters, about 4,000 tokens); older lines rest (said so on the page and the
  receipt) and still come back when his move names them. "The story in short" stays under 180 words on purpose: the
  helper rewrites it every page — a long rewrite would take minutes a page and shift its details each time.
  M510-15 — THE STORY'S ESSENTIALS (his design, like his Plot Essential Maker): agents/essentials.js streamlines the
  WHOLE record (Summaryception) into four parts — who they are to each other, what has happened in order, what still
  stands (promises, debts, secrets, wounds, who knows what), where things were left — at most ~4,000 tokens (M510-16:
  the room the record's newest lines had; at most 2,000 words, fewer while the story is young); rebuilt
  whenever the record's fingerprint changes, always from the record itself (never from its last version, so it cannot
  drift). It rides in front of a small model on every page (receipt "Story essentials"); the record's detailed lines
  ride only when a move names them (the recall) or when folded since the essentials were made. No essentials yet: the
  record's newest lines (M510-14). Worker row 'essentials'; the chain's last link; planAhead runs it too. The plan says it was made BEFORE his move ("how things stood before my move
  above"; "before my move, that looked like: …") — after his message, a small model must never take it over his move.
  WITH A PLAN — THE SMALL REQUEST (stack.js smallB, his choice B): the craft rides as laws.js ALWAYS_LAWS (The Telling,
  Header Protocol, MC Agency and its companions, Intent Horizon, Epistemic Law and The 3 Part Trace — M510-18: what a
  person can know, as a RULE beside the scene's part of the list — the Page's three laws) plus the helper's laws, WORD FOR
  WORD (lawsOf/joinLaws never reword); the shortcuts; the cards of who is here; woken rules, lore, canon, the ruling, the
  sensors; the last 8 storyteller pages (SMALL_PAGES, trimmed to the room); his message; then the closing words: ruling,
  the plan in his voice (planwords.js renderPlan — the hour, ground and who is here are the LEDGER's lines, never the
  helper's), sensor, think line, and on a heated scene (the combat/intimacy rules woke, a live fight, or the plan says so)
  THE SOUNDS — his two sound laws verbatim with the scene's own sounds, and "the last page went quiet" when it did (plain.js
  soundCount after each page). M510-2: the ledger's own compact view (the scene first) and the cards of who is here —
  with anyone the latest pages named — ride too (before, a hurt, a secret seen or a live thread of someone standing in the
  room reached a small model only if the helper happened to name it); the cast notes, the record, the absent crowd (the
  roster, "away and much on the story's mind"), the world, the director, the editor, the eye and older pages stay with the
  helper — M510-9: and each stands on the receipt as a 0-token row saying it was not sent to the small model and who
  read it (his own words, the cast notes). NO PLAN
  (first page, helper not back in the five seconds, an unusable answer, a craft without the
  load-bearing laws): the whole request with the scene said once more (A: anchor.js + the M344 recall). With no teller
  (the frame off, a small model's default) that line opens "Right now, …" — match it case-blind.
  The frame, the note and his own-voice words reach a small model only through their own switches (frameOnSmall,
  noteOnSmall, ownWordsOnSmall — off as shipped; in his tests they made it dumber). A page that put words in his mouth or a
  thought in his head ENDS THERE before it is kept (plain.js mineCutAt; a window after the cut is kept; under 400
  characters of scene it stands and the next turn hears it); a MOVE is never cut — a paraphrase of his typed move is the
  craft — it gets the next-turn note (mineLeak/mineWord). The five plain lines and the "same words again" note are
  retired. OFF (a connection without the tick): byte for byte the old request — M354-1 and M510-7 fail if one byte leaks,
  and M510 was checked against m509-016's own code on nine fixtures (identical).
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
- NOTHING IS REDRAWN UNDER HIS FINGERS (M428/M429): the drawer's background redraw waits while a text field of it has
  the focus; Settings never draws a box he is typing in over his draft; the thread's whole redraw waits while a page
  editor is open (runs when it closes). Any new background redraw must do the same.
- LEAVING SETTINGS KEEPS WHAT HE TYPED (M426): a keep-box he typed in and did not Keep is kept by its own button when
  Settings closes — never a box he did not type in (it must not write stale words over another hand's change).
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
- THREE OPT-IN SWITCHES, EACH "OFF = NOT ONE BYTE" AND HELD BY A BYTE-FOR-BYTE LAW: think-on-page (M339), the Small model tick (M343 -> M510: on the connection now), and the
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
- NOTHING IS MADE IN THE OPEN, AND THE PAGE IS NEVER RELOADED UNDER THE WRITER'S HANDS (M332; M430 — EVERY door to the
  device keeps a `building` tale off it, the page door included, and letting go of `building` sends it at once, after
  the write lands). A multi-step creation (a
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
- ONE PERSON, ONE NAME, IN EVERY BOOK (M320; M419 — bodies, standings, knowledge and truths too, apply.js personBookKey /
  newBookKey — never a near spelling, M423 — and strayBookKeys heals an older split): never look a person up in ANY ledger book by exact key — pages
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
- The house's own notes about a connection (M431 — probes, identity, relay, what a model taught or refused) are
  bookkeeping (sync.js PROBE_ONLY): they never make a row a browser's. A NEW house-written connection field goes on that
  list, or a connection deleted in one browser comes back from the other.
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
  in app.js + a token block in base.css + a coat-row radio with a swatch + its dress in css/coats.css
  (M465, see 1d); tests/paint_magma.py measures the magma room (the
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
- A FOLD REPLAYS THE SAME BATCHES (M424): every journal write carries its batch (b); foldJournal replays batch by batch —
  a law that ends each batch (M396) judges the same moments it judged live. Any new chain write MUST go through
  applyMutations (journaled) — tests/harness/fold-fuzz-names.mjs fails a write that does not.
- Branches carry that page's exact ledger: newest page = as it stands; older = checkpoint chain;
  the journal fold only where it reaches AND covers (M91, M106, M147); a branch during a running
  chain re-reads its last page (M112); a story closed mid-chain finishes on open (M127).
- Any edit ripples (M100): a name in code everywhere; a value through the mender + a correction.
- The record: a squeeze merges only NEIGHBOURING lines (M425 — tests/harness/record-fuzz.mjs holds every line to
  the pages under it). Keeper folds, verifier checks, detail auditor keeps, hard tokens checked in code
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
- M510-20 — EVERY ROW, EVERY PAGE (his rule): "What the storyteller saw" names every part the house can send, in the order it
  rides (stack.js EVERY_ROW), on both models. A part that did not ride stands at 0 tokens with why (emptyWhy): small-model
  parts on the normal model say "small model only"; Story essentials on a first scene says the record is still empty and
  the keeper's window. The wire is untouched — rows only. Laws that said "empty = no row" now say "nothing on the wire,
  and the row stands at 0 saying why" (M10, M11, M21-B, M29-9, M88-2, M345-9, M346-1, M356-4, M486, M510-6, M510-13).
- M510-21 — HIS ESSENTIALS: the record's own format, told shorter (essentials.js essentialsAsk/readEssentials): lines,
  oldest first, "[time · place] (pages a–b) phrase; phrase; …", one line for a stretch that belongs together; small talk,
  errands, passers-by, crowds, weather and repeated reactions cut; decisions and causes (→), promises and oaths (exact
  words, 15 at most), debts, secrets and who knows them, wounds, bonds, firsts and every correction kept. Shown in the
  drawer's books under the record (drawer.js essentialsPanel, "Story essentials — the record, told shorter"), or why
  there are none. Only the small storyteller reads them; every worker reads the original record. WHO'S HERE, IN THE
  RECORD (stack.js recordOfWhoIsHere, small only): while someone is in the scene, the record's own lines that name them,
  the newest 5 each, 6,000 characters in all, the MC left out, lines already riding skipped; receipt row "Who’s here, in
  the record" (EVERY_ROW). Laws M510-17 (updated), M510-21, DOM-137.
- M510-22 — THE PLANS KEEPER (agents/plans.js, assemble/planbook.js): a plan the characters lay out — who does what, in
  what order, on what signal — is written down whole the moment a page lays it out (every part; the exact words of a
  signal or cry), marked part by part as it is carried out, and let go when it is carried out in full or dropped (kept
  with its outcome for the drawer, the last 12). A summary retells history; a plan is what is still to happen. Reads the
  pages not read yet (first reading: the last 30; a page since rewritten is read again); an unusable answer leaves them to
  be read again. Small model only (chain link 10, planAhead); stored in settings "standingPlans:<storyId>" (never "plans:", the planning helper's key); rides the small request
  whole under "Plans standing" (receipt row, EVERY_ROW); drawer book "Plans — kept whole until carried out"; worker row
  'plans'. The frontier request is unchanged. Laws M510-22, DOM-138.
- M510-23 — WHO'S HERE, IN THE RECENT PAGES (stack.js pagesOfWhoIsHere, small only): the pages between the eight a small
  model reads whole and the record's reach are neither whole nor folded; the storyteller's own paragraphs there that name
  each person in the scene ride word for word in the notes — the newest 2 each (100–1,200 characters a paragraph), 6,000
  characters in all, counted in the room before the eight are trimmed; a paragraph his move's recall already brings is
  skipped (it stays beside his move, M510-13); receipt row "Who’s here, in the recent pages" (placeRow puts a late row
  where its part rides). A TITLE IS NOT A NAME (nameAsWord, shared with recordOfWhoIsHere): "Lord Varen" is found as
  "Lord Varen" or "Varen", never "Lord". Law M510-23.
- M510-24 — A CROWDED SCENE KEEPS WHO KNOWS WHAT (engine/state.js renderStateFacts): when a view that is not whole
  overflows, what the people here know (and what they have not found out) is told again with 2, then 1 facts each — the
  newest and the ones the scene calls back — BEFORE any section is shed whole. Before: eight present people overflowed the
  compact view and the whole section was shed (measured on a Bleach-sized ledger: 0 facts; now 16, 8 of them on the
  scene's own question, 900 tokens). A whole view (the frontier model in a large room) never overflows: unchanged. Law
  M510-24.
- M510-25 — USAGE AND COST, AUDITED (engine/usage.js, providers/meter.js, ui/usage.js, providers/openai.js): (1) streamed
  storyteller and worker calls now ask for their usage (stream_options.include_usage) — most OpenAI-compatible providers
  (OpenAI, DeepSeek) report it only when asked, so those pages were estimated (≈); an address that refuses it (by name,
  or with a 400 naming nothing, tried once more without) is taught and left out (learnedDrop 'stream_options');
  (2) Kimi's stream puts its usage inside the choice — read; (3) cached input is read in every shape (OpenAI
  prompt_tokens_details.cached_tokens, DeepSeek prompt_cache_hit_tokens, Kimi cached_tokens, Claude cache_read / its
  writes apart) and priced at the connection's new "Cached input price" (the input price when unset), Claude's cache
  writes at 1.25x — it was all priced as full input; (4) the prices a connection had ride with each day's row, so a
  connection let go keeps its money; (5) "Your busiest day, per model — and a month of days like it": of every day
  recorded, each model's day with the most tokens, and that day thirty times. Laws M457-4..6, M510-25, DOM-110.
- M510-26 — HOW A FIGHT SOUNDS (laws.js FIGHT_SOUND_TEXT, small only): a small model's fight page carries the fight's own
  acoustics after his fight laws, as an intimate page carries sex's — both lanes every beat (contact in asterisks, voiced
  in quotes), palettes of steel, flesh, bone, ground, power; war cries, effort, pain that climbs, curses, taunts, breath,
  the loser's pleading; a lone "Ugh." or a narrated sound is a failure; a fight paragraph without sound is failed; rotate,
  never reuse the last page's. typedCombat now reads parry, dodge, grapple, counterattack, duel/spar with, block his
  blade, "we fight" (not "fight for/over/about"), choke/strangle/throttle, slam into. Frontier unchanged. Law M510-26.
- M510-27 — HOW A FIGHT SOUNDS, FOR EVERY STORYTELLER (his request: "normal mode is boring too — one bam, and my enemy
  makes no noise"): FIGHT_SOUND_TEXT is a built-in rule now (modules.js 'fight-acoustics', "How a fight sounds",
  whenKey combat), riding as a woken rule for the frontier model and the small model alike (said once — the small
  request's own copy is gone); it adds "every fighter is heard — the enemy as much as his character" and "a single sound
  for a whole exchange is a failure". The combat predicate wakes on his own typed fight words too (typedCombat, as the
  intimacy rule wakes on his words — M85-002), so the contest rule and this one ride on the page where he draws his blade,
  for every storyteller. A page that is no fight is byte for byte as before (the nine fixtures). Law M510-26/27.
- M510-28 — THE HOUSEKEEPER HOLDS THE LIVE LEDGER, AND IS TOLD SO: it always was handed the whole ledger, read fresh from
  the store each time he speaks (housekeeperTurn → loadState → buildHousekeeperContext → renderWholeLedger, "Here now"
  included) — but the block said only "the scene as the readers keep it", and it told him "the only surface I can't see
  is the live ledger text, so presence.leave fires blind". The block is headed "THE LEDGER — LIVE: read fresh from the
  store the moment the writer spoke to you…", and its standing words say the ledger is live, every applied card shows in
  it, and to look at "Here now" before taking anyone out. Law M510-28.
- M510-29 — THE BANNED WORDS LET GO (his word): the "Banned Words" law is out of the built-in craft (craft.js) and out of
  the last look's list; the house's eye (agents/lint.js) no longer counts banned phrases or words; SHIPPED_BEFORE
  ['core-craft'] holds the craft as it shipped through M510-28 ('1gzud8e'), so an unedited saved copy follows — an edited
  copy keeps his words; v176map's DISTILLED_CRAFT keeps 'Banned Words' so a preset brought in again leaves them out. His
  preset's other rules are untouched (the frontier wire differs from m509-016 by exactly the two removed pieces). Laws
  M510-29, M36-1, M85-2, M88-1, LONG-7 updated.
- M510-30 — THE FALLBACK FOR EVERY WORKER (agents/call.js callWorker, housekeeper.js callModel): Settings → The workers →
  "Fallback for every worker" (settings workerFallbackId). A worker whose connection fails is sent again at once on the
  fallback; never onto itself; a stopped call is never resent; both down, the first failure stands and the queue retries;
  the housekeeper falls back only before a word came back. workerFallbackLast is shown under the picker. And the busiest
  day in Usage and cost is folded (details) until he opens it — remembered (usageBusiestOpen). Laws M510-30, DOM-110.
- M510-31 — COPY THE WORDS: Settings → The frame and The note at the end (the house's and this story's) each have "Copy
  the words" beside "Keep it" (copies the box as it stands); each of his own words has one; "What the storyteller saw"
  puts one Copy on every part's row (no longer only inside the opened part — one per part). All use receiptview.js
  copyWords (works on the phone's own address too). DOM-70 updated, DOM-139.
- M510-32 — A THOUGHT'S CLOSER BACK TO FRONT, OR ALONE (ui/pageshape.js mendThoughts, mendMarks): "~t/~" and "t/~" close a
  thought like "~/t~" (the lost-opener mend too); after every exact thought is shielded, any closer left over belongs to no
  thought and is taken off the page with its space. Stored pages heal on the next open (the once-per-build mend, M488).
  Law M510-32; the real-browser mend check green.
- M510-33 — MOVE A TALE TO ANOTHER SHELF, ITS OWN BUTTON: each tale's row has ⇄ ("Move to another shelf") opening the
  shelves alone; ⇩ ("Take this tale with you") shows only the ways to take it; a long press on the row shows both.
  (Shelves are his "projects" — db.projects.) DOM-10's shelf check updated.
- M510-34 — THE PAGE FINISHED (ui/pageshape.js finishPage, run at the head of tidyPage): an empty World Beyond (nothing up
  to the next marker or the end) goes; of the markers that stand only the first opens the window (a later one goes, its
  words kept); the storyteller's notes to him at the page's END go — the last paragraphs, from the end back, each a note
  and nothing else (questions or offers to "you", what does <MC> do, OOC/author's notes/"note:", "to be continued", "your
  move", a word count, a bare separator, a header with no page under it; a paragraph of a few sentences when every one is
  such a note). Speech (a quote at its start or inside) and anything past 400 characters are story. At most four
  paragraphs and 900 characters, never leaving under 200; never an out-of-character answer (finish:false). What came off
  is returned (removed) and kept as the page's earlier words (msg.mended, "tidied — took off …") — the drawer lists it,
  a tap puts it back — for a new page (chat.js landing) and for stored pages (mendAllPages, once per build on open, never
  over an existing mend). Laws M510-34, DOM-140.
- M510-35 — THE STORYTELLER'S VOICE, SAVED (engine/voicepresets.js; Settings → The frame → "Presets"): a preset holds
  tellerName, writerName, groundingPhrase, tellerPerson, frameText, noteText and ownWords (settings voicePresets; the one
  last used, voicePresetActive). "Use it" writes every part back exactly (a part kept empty is cleared) and redraws the
  boxes and his own words; it asks first when his voice right now is in no preset. "Save as a new preset" (a name used
  again is that preset, after asking), "Save over the chosen one", "Let the chosen one go" (asks). What he sees in the
  boxes is what a preset takes. The switches and a story's own frame/note are not a voice. Laws M510-35, DOM-141.
- M510-36 — PRESETS AS ROWS, IN HIS WORDS: each preset is its own row with Use, Update, Rename (inline — Enter keeps,
  Escape cancels; never empty, never another's name: renamePreset) and Delete; "Save as new preset" under the list. The
  row in use says so. (M510-35 had a picker acting on "the chosen one", delete hidden as "Let the chosen one go", no
  rename.) Laws M510-35 (rename), DOM-141 (Use, Rename, Delete through the rows).
- M510-37 — THE NOTES ABOVE THE STORY, IN THE SYSTEM: the notes (on their mind, the state of things, the woken rules, the
  record, canon, the director's and editor's words, the eye…) are the LAST system block (never cached; the frame and the
  craft stay the cached prefix), no longer a user message in front of the story. The openai mapping joins every system
  block into the one leading system message; Anthropic sends them as the system array (cache_control on the craft). THE
  STORY OPENS ON HIS PAGE: a window whose first page is the teller's steps back to the move of his that led to it (the
  keeper's window of thirty usually does — thirty back from his move is the teller's page; the user-role notes had hidden
  it); a tale opening on the teller's own page is opened by "(Our story begins.)" (STORY_BEGINS). On a tale's first turn
  his message stays first: an own-words entry "before your message" steps behind it (M466-4). The frontier wire
  changed on purpose: the notes word for word from the first user message to the last system block, and the one move of
  his in front — nothing else. Laws M510-37; A1, M12-coverage and nineteen laws that read the notes as the first message
  read them from the system (tests/harness/lib.mjs notesOf).
- M510-38 — HIS WORDS WHERE HE PUT THEM; HIS TURN FIRST ONLY WHERE A HOUSE INSISTS (providers/userfirst.js): the builder
  puts every own-words entry at its landmark — "before the pages" right after the briefing, before the first story page;
  "before your message" right before his message, first turn included — and never ends a request on the teller's words.
  It adds no line of its own. "(Our story begins.)" (STORY_BEGINS) comes from the provider: Claude always (its first
  message must be the user's); any OpenAI-shaped house only after it refuses a conversation that opens on the assistant
  (ORDER_REFUSAL), remembered for that model at that address (connection.userFirstFor), as a refused late system message
  is. A house that takes it gets nothing added. Laws M510-38; M466-3/4, M481 and DOM-118 restated.
- M510-39 — HIS SWITCH FOR THE NOTES' ROLE (Settings → The frame → "The notes before the story ride as"; setting
  notesRole: system (default) | user | assistant). The woken rules (Active modules) are instructions: always system, their
  own block — seat 4 (never in the notes). The notes — the brief and who's here travelling with them, on their mind, the
  state of things, the record, canon, the director's and editor's words, the eye, the small model's parts — ride as seat 5
  of the system (default), or as ONE message before the story: his (user, briefingOpening) or the storyteller's own
  notebook (assistant, voice.js notebookOpening), seats 2–3 then empty. "Before the pages" own words stand right after
  that message. An assistant-first request gets "(Our story begins.)" only where a house insists (M510-38). Laws M510-39,
  DOM-142; A4 and M386-4 count the seats.
- M510-40 — FINAL AUDIT of M510-34..39. One real fault: the M510-37 step back to his move (so the story opens on his
  page) ignored the room the window was cut to — with the keeper off and a tight budget, a long move behind the cut was
  stepped back over it (a 30,000-token budget sent 35,673). It steps back now only where the move fits; otherwise the
  window stays as cut, opening on the teller's page, and the provider adds his line where a house insists (M510-38).
  Law M510-40. Checked and sound: the backup takes every setting (his presets, notesRole) and every connection field
  (userFirstFor); reset leaves his presets (his writing) and resets notesRole; the page finisher keeps second-person
  narration, narrative questions, speech and letters, and takes off only notes to him (9 of 9 in a probe).
- M510-42 — A BANNER BELONGS TO ITS TALE (ui/workbanner.js): one banner serves the house, and work goes on in its own
  tale after he opens another. beginWork(what, stop, tale) keeps the tale (the open one at begin unless named — the
  missed-pages reader names its own); on another tale the banner says whose work it is ("“Title” — Reading the pages the
  ledger missed"), repaintWork() redraws it when the open tale changes (app.js setActiveStoryId), and Stop hands the
  banner's own tale to its handler (all eleven stop handlers took the tale open at the tap). bannerKnowsTales() is told the
  open tale and the shelf's titles by chat.js. DOM-143 reproduces his report (origin with nine unread pages, its reader
  held, a branch at his first message) — failed on m510-040, passes now.
- M510-43 — WHOLE-APP AUDIT. (1) "Put the earlier words back" did not stick: the stored-page mend (mendPagesOnOpen, once
  per tale per BUILD, and "Mend the pages' marks") finished the page again and took the note off again. unmend now keeps
  keptText (the words he put back); mendAllPages leaves a page alone while it still reads them. DOM-140 checks it (failed
  on m510-042). (2) A gap-filler run with nothing to do armed the full wait: fillLedgerGap and fillRecordGap set their
  "filled at" before looking, so a real gap seen just after can wait a minute (a likely cause of DOM-135's rare timeout).
  A five-second wait after a no-op was tried and taken back (the first walk with it lost DOM-131); the waits stand as
  they were. Kept: the ledger light counts "behind" exactly as the reader counts unread pages (a page read ahead of the
  mark is read) — it no longer shows behind while the reader finds nothing. (3) DOM-144 proves a tale
  opened while a page is written: the page lands whole in its own tale; the other shows and gets nothing (no fault).
- M510-44 — WHO KNOWS WHAT HAS A ROOM OF ITS OWN IN THE WHOLE VIEW (engine/state.js KNOWLEDGE_WHOLE_CHARS = 16,000,
  about 4,000 tokens). Normal mode's who knows what never grew with the story (each person: newest 12 + 4 called back of
  the 60 kept) but grew with the crowd. Past the room, each person is told with fewer newest (8, 6, 4, 3, 2, 1) and fewer
  called back; shared facts said once; "(and N older things they know, kept in the ledger)"; never shed whole. Measured:
  11 people 7,493 → 3,823 tokens; 20 people 13,515 → 3,521; a few people unchanged. Only the storyteller's whole view —
  the housekeeper and every worker read as before. Law M510-44.
- M510-45 — THE PRESETS FOLD. Settings → The frame → the presets box is a <details> (#voice-presets), closed until he
  opens it; its line says "· N saved · using “Hulk”" folded; the open state is read once at Settings' start and kept on
  every toggle (setting voicePresetsOpen) — never re-read on a redraw. Every id inside is unchanged; nothing about a
  saved preset is written by the fold. DOM-141 opens it first; DOM-145: twelve saved presets — folded and counted, all
  twelve rows with their four buttons when opened, remembered across Settings, the stored presets byte for byte.
- M510-46 — A RESTORE SPEAKS FOR EVERY ROW IT REPLACED (js/sync.js rowsHeld, restoreSpeaksFor; the importAll wrap):
  with serve.py running, the house's push after "Bring a copy back" took back every device house row the browser lacked
  (M311 keepWhatWasNeverLetGo) — a connection or a setting made after the copy came back over the restore — and pushed
  the tales known BEFORE it. Now the restore notes every settings key and connection held before or after it as this
  browser's word, refreshes knownIds, and pushes the restored tales and the house. Law M510-46 (every store round-trips
  byte for byte, keys included; nothing adopted back; the fault shown on the blind merge).
- M510-47 — THE DEVICE'S ZIP COMES HOME (DONE — was the open item). "Bring a copy back" takes the server's .zip:
  POST api/backup/restore (serve.py restore_backup: refuses a non-zip, a path outside the library, a zip with no
  books/_house.json, or one that cannot be read whole — nothing touched; zips the library as it stands into backups/
  first; reads the copy out into .restore-stage; only then removes the library's files and moves the copy's in; never
  touches backups/). Then booksStatus.mirrorDevice(): every push held (a push would lay the browser's old books over the
  copy), the worker's pull {exact:true} reads every device book whole and lets go of tales the device does not hold, the
  page reloads. A .json still goes through importAll (M510-46). Tests: tests/restore_backup_unit.py (the server, on a
  real folder) and tests/restore_zip.py (real browser + real serve.py: take the zip, make a later tale and change a
  setting, bring the zip back through Settings' own file button — the device and the browser hold exactly the copy; the
  library as it stood kept in backups).
- M510-48 — THE HYBRID MEMORY, ALWAYS ON, FOR EVERY STORYTELLER (his decision: no threshold). The essentials keeper and
  the plans keeper run for every tale (chat.js essentialsNext/plansNext lost their small-model gate); their books ride
  every request. A frontier storyteller WITH the essentials made reads: the essentials (the whole story as a timeline),
  "The newest of the record, word for word" (HYBRID_RECENT_CHARS 32,000), what the record holds of who is here
  (HYBRID_PRESENT_EACH 6, 24,000 chars), "From the older record, word for word" — the older lines this scene (last pages +
  his move) names, WHOLE, under their pages (recallFromRecord, HYBRID_RECALL_LINES 6), and the plans standing. Before the
  essentials exist the whole record rides as it always did. No record line is ever deleted by this. The receipt tells it.
  Bonus (his Bleach story): the rulebook's new law "Exposed" (a lie or cover story MC told is believed and untrue; when
  the truth comes out in front of the fooled, they react — never a flat "cool"; what someone was told long ago they still
  know — check who knows what before anyone asks), in ALWAYS_LAWS too; SHIPPED_BEFORE core-craft gains '99fpod' so an
  unedited saved rulebook follows. The page reader writes a believed lie as "believes X — untrue: Y" and the exposure as
  what they learned. Tests: M510-48; M510-20/21/22 restated; the test house knows the essentials keeper's real words
  ("condense the record of a long collaborative story" — it had been taken for the storyteller); LONG-4 counts the
  record's own rows (the essentials and plans books share the row style).
- M510-49 — FINAL AUDIT OF THE HYBRID, as storyteller, reader and the one pressing buttons. (1) No hole behind stale
  essentials: every record line folded since the essentials rides word for word (hybridRecent's room grows to hold them);
  if those alone pass twice HYBRID_RECENT_CHARS the essentials are stale and the whole record rides. (2) recordOfWhoIsHere
  shares a tight room fairly: lines go from whoever still has the most, oldest first, so each person keeps their newest
  line (long dense lines let the oldest-named person lose everything). (3) The drawer's essentials book: "Make the
  essentials again" (chat.remakeEssentials → runEssentials force), shown whenever there is a record; its words and the
  plans book's and The workers' no longer say "small model". Checked, sound: a frontier storyteller gets no closing
  recall glimpses (anchorLine is the small model's), so nothing is said twice. Laws M510-49, DOM-146.
- M510-50 — SMART RECALL (agents/recallpick.js; Settings → How much the story remembers → "Smart recall", on unless he
  turns it off — setting smartRecall; worker row 'recall'). For a frontier storyteller with the essentials made: before
  the page, a worker reads his move and the last page against the essentials and an index of the OLDER record lines
  (numbered, pages, first 220 characters — the newest lines' room skipped) and names up to 4 by number, for what the move
  means. Only indexed numbers count; slow (8 s), failing or unsure → none, the page goes on. The named lines ride WHOLE
  under "From the older record, word for word" beside the word-match ones (never twice); the receipt's source line says
  how many the smart recall picked. Laws M510-50, DOM-147.
- M510-51 — OUR STORY SO FAR, ONE PART READ ONE WAY (the frontier hybrid only; the small model and the whole-record path
  are as they were). One part, placed after canon and before On their mind and the state of things: a line saying how to
  read it (brief → full; the full line is right over the brief, the pages over both; every line is its own pages' past),
  "In brief, from the beginning (pages 1–N)" (the essentials), "In full, just before the pages you have (pages a–b)" (the
  newest lines, each "(pages a–b)"), "In full, earlier moments this scene touches — the people here, and what my move is
  about" (who's-here lines and recalled lines — word-matched and smart — one list, in page order, never twice), then the
  plans. Gone: "the N older lines are in the essentials above, each kept whole on the device", and the three separate
  headings. Law M510-51; M510-48/49/50 and DOM-147 read the new part.
- M510-52 — THE WHOLE REQUEST READ TOP TO BOTTOM, AS THE STORYTELLER. For a frontier storyteller the notes are: canon →
  our story so far (the hybrid part, or — before the essentials exist, or when the record fits the full-detail room whole
  — "Our story so far, in full — everything before the pages you have, in the order it happened") → plans → On their mind
  → the state of things → lore, world, director, editor, eye. No brief beside a record that fits in full (the receipt's
  Story essentials row says why). A belief reads "Rukia believes: …" (renderKnowledge), never "knows: believes". A blind
  spot SHOWS a telling as its news ("was told Jovan serves…" → "Jovan serves…", only when a capital-led sentence follows;
  "heard X say…" keeps its verb) while its tests still read the fact as written; a belief is no one's blind spot. Every
  age is in pages ("Last noted N pages ago", the world's "as of N pages ago"). The small model's request is unchanged.
- M510-53 — THE SMALL MODEL'S STORY SO FAR, the same one part as the frontier's, in the same place (after canon; then On
  their mind; then the state of things; the helper's plan still closes the request). Its pieces: "In brief, from the
  beginning (pages 1–N)" (the essentials) or, before they exist, "In brief, as I remember it" (the helper's story in
  short) — never both (the receipt's "The story in short" row says the essentials stand for it); "In full, since then"
  (or "the newest of it"), each line with its pages when the record's lines are handed over; "In full, the people here in
  the pages just before the ones you have" (M510-23's paragraphs, set at RECENT_HERE_MARK once the window is known, or the
  mark taken out); "In full, earlier moments with the people here"; the plans. Gone: "Our story so far, the way I
  remember it" at the head, "What our story holds, in essentials", "Folded since the essentials were made", "What remains
  of the older pages (… N older lines rest outside this page)", "What the record holds of who is here", "What the recent
  pages hold of who is here" at the tail. A belief's age reads "since about N pages ago". The plan's "Set against Jovan:
  Jovan" says him once. Laws M510-6/13/16/17/21/23 restated.
- M510-54 — ONE PERSON, ONE CANON ENTRY. The canon cache is keyed by the name looked up; the same wiki page found again
  under another name ("rukia" after "rukia kuchiki" — a stale miss carried into a branch, looked up again) was written a
  second time: two Rukias in the drawer. Now: grounding.js merges a newly found page into a kept entry of the same wiki
  and name (the new name joins its aliases; a miss under that name goes); bridge.js mergeCanonTwins(cache) (pure; the
  richer, else newer, stays; other keys and names become aliases; redirect map) runs on the copy a branch receives
  (carryCanonMemory) and on the drawer's list. The note to the storyteller already wrote one block per character (M-ext
  seenEntities). Law M510-54, DOM-148 (failed on m510-053: "got 2").
- M510-55 — WHAT THE STORYTELLER SAW, IN THE ORDER IT WAS SENT. stack.js orderAsSent(slots, systemBlocks, out) runs last:
  each row that rode stands where its own words stand in the request (system blocks, then messages; a line's "- (pages
  a–b)" prefix ignored when looking; the closing's parts — plan, sounds, frame said again, note, nudge — looked for from
  the end, since the frame said again is also the first system block's words); a row that did not ride stands beside the
  row before it in EVERY_ROW (now in the sent order: frame, craft, brief, who's here, active modules, canon, story in
  short, essentials, what remains, who's here in the recent pages, who's here in the record, plans, on their mind, the
  state of things, …). The record rows' explanations name the words they are sent under ("sent as “Our story so far — In
  brief…”"); the pages' row is "The pages, word for word" (was "The story so far", which now named the record in the
  raw). Law M510-55; M510-23 and M21-B read the new order.
- M510-56 — AN ONGOING STORY GETS ITS ESSENTIALS BY ITSELF. chat.js planAhead() (run when a story is opened, when the
  storyteller changes, and when a page's version is walked to) queued the essentials and plans keepers only after the
  small-model gate — so a frontier story opened after the update waited for its next page's chain before its essentials
  were made, and that page still went with the whole record. Now planAhead queues the essentials keeper for every
  storyteller (a model is asked only when the record changed or none exist); the planning helper and the plans keeper's
  reading on open stay the small model's (the plans keeper reads every page after it is written, for everyone; DOM-105:
  opening a story to look asks no model). DOM-149: a frontier story with a long record and no essentials — opening
  it makes them and the next page is sent with "Our story so far — In brief…"; with them let go, the page's own chain
  makes them again (failed on m510-055: "waited too long for opening the story made its essentials").
- M510-57 — THE RECEIPT EXPLAINS EXACTLY. Audited every memory row in six situations (frontier: no essentials, hybrid,
  fits whole, stale; small: with and without essentials). Three made exact: "Story essentials" before they exist says
  when they are made (when the story opens, and after each page) and what is sent meanwhile in the raw's words ("Our story
  so far, in full" — the What remains row); with the whole record sent, "Who's here, in the record" says every line about
  the people here is in it (was "…— or the essentials are still being made…"); the pages' row points to "Our story so far
  (the What remains row)". Law M510-57.
- M510-58 — THE HYBRID ALWAYS STARTS (his standing decision since M510-48: no threshold). M510-52's "fits in full" rule
  (a record under ~8,000 tokens rode whole, the essentials "not part of this turn") was a threshold he had refused; it is
  gone (fitsWhole = false). With the essentials made the hybrid rides at every size; the full-detail part is at most HALF
  the record (hybridRoom = max(since + 1, min(HYBRID_RECENT_CHARS, recordChars / 2))), the older half in the brief; every
  line since the essentials in full; only essentials more than twice the room behind give way to the whole record. Law
  M510-58; M510-52 restated.
- M510-59 — THE FOLD SIZE DOES NOT MATTER. The older lines called back (word-matched and smart picks) rode whole with no
  room of their own; with a fold of 30 pages a line, ten whole lines ballooned the memory (a 600-page story: 28,000 tokens
  at 30 pages a fold vs 15,500 at 6, measured on m510-058). HYBRID_RECALL_CHARS = 16,000 (~4,000 tokens): the smart picks
  first, then the word-matched, at least one always; shown in page order. Now 12,500–16,000 at every fold size. Law M510-59.
- M510-60 — THE DEEP AUDIT, READ AS THE STORYTELLER. The lore shelf (the world's standing facts, woken by the pages) now
  stands with canon, before our story so far — reference first, then the past, the plans, the people, the state of things
  now; it stood between the state of things and the pages. The story part's words hold in every voice the notes take
  (system, his user message, the storyteller's own notebook): "the pages that follow" (was "you have"), "what the newest
  move is about" (was "my move" — in the notebook, the storyteller claiming his move). Checked and sound: the rulebook
  already names the record "Our story so far" and the notes' opening; the people are said three ways on purpose (his cast
  notes, canon, the tracker's page), each its own authority. Law M510-60.
- M510-61 — AN EDITED MESSAGE IS READ AGAIN. A shortcut ("#q" = the next scene) is kept as typed beside the shown words
  and the typed form is what the storyteller gets (M379 typedOf); a "#question …" keeps its ooc mark. An edit changed only
  msg.text — typed and ooc stayed, so Try again sent "#q" again. chat.js finish(keep): for his message, parseCommand(new
  words) sets typed (a shortcut kept → the new typed words; none → gone) and ooc (a question → true; not → gone). DOM-150
  reproduces (on m510-060 the storyteller was sent "#q" after the edit).
- M510-62 — THE COMMANDS LIVE IN THE INSTRUCTIONS. Since M379 each #command's law rides once with the rulebook
  (commands.js shortcutsText → "SHORTCUTS.") and his typed words are sent; no directive is sent on the turn (stack.js
  `void directive`). The rulebook's own "The Commands" law still said a command "arrives with its own law as the house's
  directive for THAT turn … a turn with no directive is a story turn" — telling the storyteller to wait for something that
  never comes, and to treat a typed #q as a story turn. It now says a command typed as his whole message means what
  SHORTCUTS says. SHIPPED_BEFORE core-craft += '1icfhkj'. The app still parses commands for its own bookkeeping only (an
  out-of-character answer is not story; #story writes the brief; a window opens; the referee's overrides; the chip). Law
  M510-62; M85-2 restated.
- M510-63 — A PERSON BY EVERY NAME THAT IS ONLY THEIRS (stack.js nameAsWord(name, known), knownNames(state)). "Who's here,
  in the record" (and the small model's "in the recent pages") found a person by whole name or first name only; lines
  saying "Zaraki" or "Captain Hitsugaya" were never found. Now any part of the name counts (titles never), a part other
  than the first only when no other name the ledger knows (present, characters, knowledge, the MC) shares it — "Kuchiki"
  alone is neither Rukia's nor Byakuya's. Law M510-63.
- M511-1 — AFTER THE CRASH. The crash (Sep 29, during his "Normal vs Raw" question) left GitHub at m510-063, whole: every
  module parses and links, harness/walk/long play/lint were green on it. Found by reading that session's code: (1) a
  branch lost `keptText` (store.js append's list) — db.messages.copy now, walk DOM-140 proves it through the branch
  button and the shelf's open (fails on m510-063); (2) "Who's here, in the record" built ~14,000 name patterns a call on
  a dense record (~300 ms, twice a send) — patternsOf, once per person (16); (3) his question: the auditor's details
  never reached the storyteller in "Our story so far" (frontier with essentials, and the small model) while the receipt
  showed them; the rows showed a different copy of the record than the one sent; the one "earlier moments" part was
  split over two rows; and the room kept for every line folded since the essentials was measured without the details,
  so the oldest of them fell out of the request (a hole: 9 of 30 lines in the m510-063 fixture). All fixed with one
  renderer (recordLine) and rows that are the parts; the row "Who's here, in the record" is now "Earlier moments, in
  full"; the heading reads "In full, earlier moments that matter now — with the people here, and the ones the newest
  move brings up". Laws M511-1…4 (tests/harness/m511.mjs).
  Browser proofs at m511-001: all green but paint_magma (below). tests/branchrefresh.py now slows db.messages.copy (the
  copy the branch makes) to land its refresh mid-branch — it slowed append, which the branch no longer calls, so the
  refresh never landed mid-branch and its own fixture check said so. tests/twobrowsers.py "one whole book, not one per
  page" now checks that every version the device kept of the branch holds all its carried pages — "no second write at
  all" also failed on m510-063 (1 run in 3): the branch's house's eye writes its findings onto the last page the moment
  the branch is whole, a new version of the WHOLE book (the two writes diffed: findings on one page and the workers row).
  tests/paint_magma.py (M302/M303) has failed since M465 redesigned the coats (identical on m510-063): its darker-room
  checks measure the pre-M465 magma; its contrast line flags the DISABLED "◂" of a one-version page (opacity .35 by
  design; WCAG exempts inactive controls). It is not in the gate list; paint_coats.py and contrast.py are, and pass.
  Send (tests/perf_send.py, SENDS=2, 6x, four runs each, keeper off — the changed paths do not run there): request
  1027 ms mean on m510-063 vs 1087 on m511, done 1788 vs 1774 — within the VM's noise; the profile has none of M511's
  functions among its top self-time.
- M512-1 — THE SMALL MODEL AT ITS BEST. Measured on m511: a calm small page carried 12 laws and none of his prose laws; its
  only example of the story's voice was its own last eight pages; nothing looked for repetition. Now: ten prose laws on
  every small page (the craft block ~3,650 → ~5,000 tokens), the story's voice held up from a big storyteller's page, the
  worn phrases said once in his voice, each person's way of talking in the plan. Costs on the send (desktop): picking the
  passage 1.6 ms on a 600-page story (15 ms with no big page to take it from), the worn phrases ~12 ms (read once a send).
  Laws M512-1…6 (tests/harness/m512.mjs), walk DOM-169; the frontier request identical to m511-001 (24 of 24).
- M513-1 — WHY NOTHING WAS RULED. His question with a small storyteller: "why does the referee seem not to work — no outcome,
  no The house has ruled?" It worked: walk DOM-170 sends a chancy move through the app with a small storyteller — the
  referee rules and the outcome rides first in the small storyteller's closing words, on its row. The referee rules only
  on an attempt (gatePasses: an attempt phrase or a gate verb) and on every beat of a fight; talk, an out-of-character
  line and "# no roll" get no ruling, for every storyteller. The fault was the row: it said "nothing settled by the
  referee for this page" whatever the reason. Now referee.js refereeWhyWords(step) says exactly why (off, only spoken
  words, no attempt, out of character, # no roll, ran out of its 12 seconds, no usable answer twice, no connection) and
  chat.js hands it to buildRequest (refereeWhy) for the row — receipt only, never the wire (the frontier request is still
  m511-001's, 24 of 24). Law M513-1.
- M514-1 — A PERSON WITH NO PAGE GETS ONE. His word: "the people ledger on #story doesn't fill up by itself — I have to
  rebuild the people". The per-page scribe (agents/scribe.js) was asked only "what shifted on the character pages?" and
  told to write a core "rarely": on a new tale ("Nothing is written on the character pages yet") the people of the opening
  got a now at most, or nothing, until "Rebuild the people from the pages" — whose reader writes whole pages. Now its
  law says a person with no page gets one (a core, a now if here, an arc if the page moved it; never the main character's
  core; no page for a nameless extra), and buildScribeMessages names them first: "NO CHARACTER PAGE YET: <names> — open a
  page for each one this page shows…" — everyone the ledger knows (here, or standing with the main character) with no
  page; the M408 now-line keeps the rest. Not only #story: any new face on any page. Laws M514-1/2; walk DOM-171 (a
  #story opening in a fresh tale fills the people with no rebuild — fails on m513-001).
- M515-1 — HOW PEOPLE REALLY TAKE IT. His word, after Gemma 31B and Qwen 27B in a medieval war story: "one small model
  makes everyone crazy evil, the other makes everyone jelly good guys — I mean beautiful, realistic reactions" (threatened
  with his soldier's execution, one captain smiled and cheered it; the other only pleaded — "don't do it" is not the goal
  either). A small page carried none of his laws on how people react, so each model's own lean wrote every person. Now
  laws.js PEOPLE_LAWS ride on every small page in his words (Character Gravity, A Person Is Not Their CORE, Stakes Web,
  The World Does Not Bend, Concession Is Earned Not Banned, Weight Is Not Defused; ~850 tokens) — they pull both ways —
  and the helper says how each person here acts under pressure (planner "pressed": from who they are and what they are
  bound to, "never a villain's glee nor a saint's softness unless that is truly them"), which the plan says after how
  they talk. The frontier request identical to m511-001 (24 of 24). Laws M515-1/2; walk DOM-169 checks both reach the
  small storyteller through the app.
- M516-1 — WHERE OUR STORY BEGAN IN CANON. His word: "#story jujutsu kaisen — Jovan Oda… he sees Yuki about to die and
  parries it. It confuses every timeline: Yuta abroad, the Zenin clan not destroyed by Maki" (Kimi K3, which answers "who
  does Yuta fight in Sendai?" rightly). A fact known, its moment not: in a scene a model reaches for each person's
  strongest memory, and the ledger then writes the wrong date down as canon (his thinking showed "Nov 22, 2018, the
  Culling Game not yet announced"). Now agents/canonstart.js asks ONCE, alone, when a #story opens a tale with no page
  yet (chat.js send, before the first page; the founder's connection; up to 30 s; a failure never blocks the page): the
  series, the arc, the moment, the canon date, and up to twenty facts true AT that moment — the states that changed
  earlier said as they stand, nothing after it, never his own character. Kept as canonStart:<id> ({none} for a story in
  no canon); it rides in the notes beside canon's note, every page, every storyteller, row "Where our story began";
  Settings → This story shows it and keeps his correction (his words then ride as written; emptied and kept, nothing).
  Laws M516-1…3; walk DOM-172 (asked once before the first page, carried, corrected). The walk's house knows the placer
  ("place a story in its canon") is a helper.
- M516-2 — a tale that BEGAN with a #story before M516 (his Jujutsu Kaisen tale) is placed on its next page, once, from
  that first #story (its typed words), before that page; its own clock already stands, so the canon date is left out. A
  helper that gives nothing is remembered as tried (canonStart {tried}) and asked again only after six hours — never on
  every page. Walk DOM-173.
- M517-1 — THE AUTOMATIC BRIEF (his design). Settings → This story → The brief: Manual (his words only — as always) or
  Automatic (his words, then "The world of our story, as it stands" — six parts: the setting, where in canon, how power
  works, who holds power, the places that matter, what stands now; never people, never events retold). agents/
  worldground.js; kept as worldGround:<id> on the story (story.briefMode 'automatic'); rides in the brief's seat (system
  block 2, big and small alike) with its own row "The world". Built at once when he switches (Settings awaits
  chat.remakeGround), then looked at again only after 24 more pages are folded into the record (pages, not lines — lines
  merge as the record layers), or when canon's story position or the canon start changes — and then only the parts that
  moved are asked for and replaced; held to 700 characters a part and 4,200 in all. Sources: his #story line, his brief
  (never repeated), the canon start, canon's story position (when canon is on), the ledger's place/factions/worldBrief,
  the essentials, the newest record lines. His correction (Keep it) stands until "Rebuild from the story". With a world
  riding, the canon start is not sent on its own (it is a source), and canon's note drops its story-position lines
  (canonWithoutWorld) unless Settings → Canon verification → "Legacy canon verification" is ticked. "New stories start
  Automatic" sets it for #story tales and the shelf's New story. A branch carries the mode, the canon start and the world.
  Laws M517-1…5; walk DOM-174; M43-2 now reads the whole of branchFrom (its fixed 15,000-character window cut off the
  re-read call when five lines were added above it). The per-person half is M518 (below).
- M518-1 — CANON ON THEIR OWN PAGE (the per-person half). Same mode (brief Automatic, legacy off, canon on): before the
  request is built, each canon person's LASTING lines in canon's note (assemble/canonpages.js lastingLines: Identity or
  the prose brief, Personality, Background, Relationships, Powers & Abilities, Trivia, Voice — never Appearance, Facts,
  Abilities, Context, With…, Now, and never a Secret) are kept on their page (apply.js 'people.canon', journaled, only on
  a page that exists, replaced whole when canon's lens says otherwise, written from a fresh read of the ledger); their
  card carries them ("From canon:", people.js cardText — shed for room before "Between you"); the builder then leaves
  out of canon's note exactly the lines the people section carries (canonOffPages — exact lines only, so a line a card
  shed stays in the note; a block with nothing left loses its name). In any other mode the cards are as before and a
  page's kept lines are never sent (M386). Laws M518-1…3; walk DOM-175 on the simulated Bleach wiki (kept on Rukia's
  page; the next request says each lasting line once, on her card; legacy puts the note back whole, the card as before).
- M518-2 — HIS OWN BRIEF AND THE AUTOMATIC WORLD. His question: "I already made my own Bleach brief — what happens when I
  turn on Automatic?" His brief rides first, untouched; the world is built with it as a source and never repeats it. Now
  also: when his brief rides above, the world opens "…as it stands (the brief above is right wherever the two differ):";
  and a rewritten brief makes the world look again — at once when he keeps it in Settings (remakeGround), and in the
  chain (briefFp fingerprint, a reason to look like a new arc or start) — so it never repeats or contradicts what he
  just wrote. Law M518-2; walk DOM-174 (the brief edited → the world asked again → shown).
- M519-1 — WHEN THE SOUND DROWNS THE STORY. His word: "once the dashes and the sounds start, the small model spams them
  until I can't read it, and it keeps that repeating structure." Two causes, both the app's: every heated small page was
  asked for "a voiced line that stretches or repeats" in EVERY paragraph (a word when a page went quiet, none when it went
  too loud), and the small model's only example was its own last eight pages. Now (small model only): each page's
  texture is kept (smallprose.js pageTexture — sounds and dashes per hundred words, at least 150 words counted;
  planner.js keepTexture, the last three); tooLoud decides with a hold (newest past 1.5× the band, or two of three past
  it; released only when the newest is under 70% of it). While too loud: the sounds line becomes the breath
  (planwords.js breathWords — whole plain sentences, a sound only where a blow lands or a cry breaks, once), also on a
  calm page; the first paragraph of the story's voice passage rides with it ("How our story reads when it is right");
  the helper is told to name at most two sounds; and the copy of its own recent pages the model reads is eased
  (calmPage: a word repeated with dashes once, a strung sound short, a chain of fragments its first two, the same
  asterisked sound once, a run of sound-only lines one, one pure sound a paragraph, a dash-strung sentence its first dash
  — speech and ordinary prose exactly as written). His stored pages are never touched. Laws M519-1…4; walk DOM-176 (his
  test: five drowned scenes, then the sixth request; a clean sixth page gives the seventh his heated page again).
- M519-2 — his story as it stands. Asked "so I just try scene 6?", the brake was traced on HIS story: its five loud pages
  were written before the brake existed, so nothing was measured or kept, and m519-001 (deciding from what keepTexture
  had kept) would have sent scene 6 the old "every paragraph" demand. Now the send path judges from the very pages the
  model is about to read (the last three), with the kept decision as the hold; tooLoud is set off only by a loud newest
  page (older loud pages alone never re-trigger it once released); and while braked the breath rides ALONE — his sound
  laws ("action, sound, dialogue braided in the same sentences via em-dashes", with a dash-strung example) wait until the
  pages are back inside the band. Walk DOM-177 (fails on m519-001).
- M519-3 — his three questions. (1) The banner at a story's start is the canon placement (M516): "Placing your story in
  its canon…" while the first page waits, then a toast — now plain: "Your story begins in Jujutsu Kaisen — Culling Game
  arc." (it pointed him to Settings; directions on his screen are not his way). (2) "Legacy canon verification" never
  turns canon off — canon's own switch does; legacy only keeps canon's whole note every page when the brief is
  Automatic. Its row now shows only while canon verification is on, and says so. (3) Automatic/Manual is this story's
  brief; "New stories start Automatic" is the default for stories made from now on. Walk DOM-69 checks the legacy row
  follows canon's switch.
- M519-4 — the story-start check is not canon verification. He saw a "canon" banner with canon verification and legacy
  both off: the M516 placement runs on every #story (the helper's own knowledge of the series, no wiki), whatever canon
  verification is set to. Its waiting line said "Placing your story in its canon…"; it now says "Checking which series
  your story is from…" (the toast after stays: "Your story begins in <series> — <arc>."). Walk DOM-172/173/174 green.
- M519-5 — "Worth a look: spoken dialogue is 1% of the page" (small mode). The eye's Dialogue Ratio is a NOTE — shown to him
  in the drawer, never sent (houseEyeWords sends warns only), so nothing told the next page. Two changes, small model
  only: the breath (M519) now ends "The people here still talk, in their own words." (a page of narration alone is its
  own failure — and the brake's thinned sound-lines had counted as speech); and when the last page carries that note
  under 6% with someone besides him present, the next small page's closing says once "The last page barely let anyone
  speak. The people here talk this time — in their own voices, their own words." (chat.js quietNow → stack.js
  quietPage → planwords.js talkWords). Law M519-5; walk DOM-178.
- M520-1 — WHO KNOWS WHAT, UNSCRAMBLED. His auditor "set 27 right: the knowledge lines for the hero, priestess, paladin,
  assassin and mage are scrambled — each holds facts that belong to another". Reproduced (tests/harness/m520.mjs): the page
  reader's room-sharing rule (extractor.js broadcastPublicMoments, M509-15) copied any "saw…/watched…" line into every book
  in the room — into the book of the very person it was about ("saw the paladin hesitate" for the paladin; "heard the
  priestess pray aloud" for the priestess), and a hidden act to everyone ("watched the assassin slip a vial into the
  paladin's cup when no one was looking" — to the paladin who drank it). Five witness lines became twenty; six were lines
  the auditor must take back. Now: a moment is never copied into the book of the one it is about (whole name or its first
  word — never a shared family name alone), and a SEEN line with a mark of a hidden act (secretly, slipped, palmed,
  pocketed, hidden, unnoticed, when no one was looking, behind someone's back…) is not the room's (world.js COVERT_MARK).
  A whisper seen is still seen. M509-15's expectation now leaves Rukia out of the bow she was whispered to (explained in
  the test). Laws M520-1/2.
- M521-1 — NO THINKING BANNERS DURING PLAY. His word: "it's so stupid and breaks my immersion — the model is set to think,
  the output has no thinking, and there's a banner." chat.js raised five one-time banners over his page (sayOnce, an
  in-memory set — so again every session): thinking asked for and none came back (M351), thinking kept but hidden by his
  tick (M319), the story's own thinking level Off (M308-era), a connection that once refused its thinking settings, and a
  seed that steered nothing (M329). All five are gone, with sayOnce and the values and imports only they used; what
  happened stays on the page's receipt (noThought, effort, prefill — What the storyteller saw). DOM-55 and DOM-72 now
  check that no such banner appears.
- M521-2 — the receipt says every cause. Two of the five removed banners had no line on the receipt: the story's own thinking
  level Off, and a connection that once refused its thinking settings. Now the page's receipt keeps thinkWhy ("no thinking
  asked for — this story's own thinking level is Off" / "thinking settings not sent — this connection refused them
  once"), shown in the footer of What the storyteller saw beside "thinking <level>", "no thinking came back from the
  model" and the prefill line. DOM-55 checks it.
- M522-1 — THE AUDITOR CAN SET A SHARED LINE RIGHT. His report: five findings on "heard the demon prince offer all of
  them…" — "Seen; its change did not hold (the hero already knows that)", "(no line of what the paladin knows answers to
  …)", 6 refused. Reproduced (tests/harness/m522.mjs): correcting a line five people share could not land — M484's
  house-wide wording turned each person's corrected line back into the old words the others still held, and "let go" took
  any line that merely contained the old words; by order, the party kept the wrong line, or forgot the moment entirely.
  Now: world.js addKnowledge takes another's wording only when it says at least as much (the longer stays, house-wide);
  apply.js knowledge.forget takes the exact line first, a clipped quote only for a line it covers ≥80%; a line made
  fuller in place is a landed change (not "already knows that", which threw it away). And extractor.js broadcast leaves
  out only the one who DID the moment (the name right after "saw"/"heard"…), never someone merely named — the paladin,
  named in the demon prince's offer, hears it too (M509-15's original "Kensei,Rukia,Shunsui" restored). Laws M522-1…3;
  M520-1 extended.
- M523-1 — BRANCH AT THE START. His question: "can I just branch at the start of the chat and the settings and canon will
  work?" Traced what a branch carries: the story row (brief, briefMode, frame/note, connection, thinking level, workers…),
  canon verification's switch and memory (M386, the tracker's later positions dropped from an earlier page), the ledger
  at the page, the record's covered lines, lore, the canon start — and the world (M517) WHOLE, which from an early page
  held "what stands in the world now" from pages the branch never had. Now the world goes with a branch only from the
  newest page or as his own words; otherwise the branch's world is written again from its own pages (groundNext, force)
  right after it opens. Walk DOM-179 (fails on m522-001). M43 and M72's branch laws now read the whole of branchFrom (a
  fixed 15,000-character window again cut their checks off).
- M524-1 — A BLOCK OF TAGS AFTER THE PAGE. His page ended "<npc> <the mage> <wound>left arm severed… <standing>P=-15 (…)
  </the mage> … </npc>" (shown raw in the editor, as bare text on the page); the housekeeper found its numbers already
  wrong against the ledger, and the people's ARC lines carrying them. Not the provider: the storyteller invented a tracker
  (the craft forbids it — System Stays Backstage, Marks On The Page), and the house took off only the shapes it knew. Now
  one pattern (regex.js TAG_TAIL_SOURCE — a block of the storyteller's own tags, with tags inside, at the very end of a
  page; real HTML a page may carry never taken) is used at the door (house rule, page mode), on the wire (older pages sent)
  and in the mend of kept pages (pageshape.js finishPage — once a build on opening; the words taken kept for a take-back).
  And a standing's number is the ledger's alone: people.js withoutStandingNumbers leaves "P=-12" out of what is written to a
  person's page (people.note) and out of their card (cardText) — exactly as it was when no such number is in the words.
  Laws M524-1…3; walk DOM-180.
- M525/M526 — THE DEEP AUDIT (his order: "everything I do has a contingency and heals itself — make it foolproof"). Audited
  first: the rows each tale writes, against the list that says a row is a tale's (store.js STORY_PREFIXES — the house book
  leaves a gone tale's rows out by it, the boot sweep lets them go by it). Eight kinds the list never learned: plans,
  standingPlans, essentials, pagesMended, canonStart, worldGround, canonGroundingSettings (canon's per-story settings) and
  hkNotes (the housekeeper's notes) — a gone tale's copy of each rode _house.json on every push and was never swept. The
  last two were found by a behavioural law, not the search: walk DOM-181, run LAST, takes every tale the walk made, lets
  their story rows go, and requires that none of their rows rides the house book and the boot sweep takes them all — a new
  per-tale key the list lacks fails it. Then two contingencies (M526): a world last looked at over more pages than the
  record now covers (pages taken back) is not sent and is written again (worldground.js rolledBack; chat.js send path);
  and where the story began is asked again when his #story line changed (canonStart conceptFp). Walk DOM-182.
  STILL TO AUDIT (continue on "Continue"): swipe/retry/edit/delete/rewind against every store added since M510 (plans,
  standing plans, essentials, textures), the quick switch between storytellers mid-heat (loud state), import of
  SillyTavern chats into a canon story, sync of a branch between two devices while its world is being written.
- M527 — THE DEEP AUDIT, SECOND PASS (pages taken back; a tale with no #story line; the storyteller switched; imports; sync).
  Found and healed: (1) essentials made over more pages than the record now covers were still sent after a rewind — not
  sent now (the record's lines stand in) and remade after the page; (2) a standing plan born on a page taken back was
  still sent — not sent, and the plans keeper mends its book (plans.js runPlans: born after the end gone, closed after it
  standing again, reading from the page that stands last); (3) the brake's hold (M519) was kept state a swiped or deleted
  page could hold — now walked over the last ten pages that stand, as each would have been judged; (4) an imported
  SillyTavern chat ignored "New stories start Automatic" — follows it; (5) a tale with no #story line (imported, older)
  was never placed in its canon — placed once by the page chain (placeNext, before the world keeper so the world is
  written from the newest start), from its brief and first page; a tale under way is never placed before or beside the
  storyteller's request (only a #story opening a fresh tale waits for it). Checked and holding: the switch to a small
  storyteller plans at once (planAhead, M510); a branch syncing while its world is written (each device's world is built
  from the same pages; last write stands). Laws M527-1; walk DOM-183 (fails on m526-001). DOM-173/182 now expect the
  placement from the page after. NOTE: DOM-79 passes in the walk's own order but fails run alone — on m526 too (a
  pre-existing test-order dependence, not the app).
- M528 — THE DEEP AUDIT, THIRD PASS (a page rewritten by hand; a message deleted from the middle). Traced the edit door
  (pageReinked: the page's record line let go and refilled; the last page re-read from its boundary, an older one replayed
  from it; his own message sent to the auditor) and the delete path (replayFrom with the pages after shifted). Two stores
  did not follow a hand edit: the plans keeper checked only the last page it had read — an edited earlier page is now read
  again (plans.js pageRewritten, from pageReinked); the automatic world looked again only for new pages, a new arc, a new
  start, his brief or pages taken back — it now also looks again when the record's lines over the pages it came from no
  longer read the same (recordPrint / recordChanged). A middle deletion: the record shrinks — the world is rebuilt
  (M526), the essentials not sent until remade (M527), the plans book mended (M527); the canon start follows a changed or
  deleted first line (M526/M527). Laws M528-1/2; walk DOM-184. DOM-79 (the grounding phrase): found — it was flaky, not
  order-bound (alone it failed about one run in three): its send took the first request on its model, and the plans keeper
  (M510-48, every storyteller) on the same model sometimes landed first and was checked as the storyteller's. It (and the one
  other scenario with that helper) now leaves helpers out; six runs alone, six passes.
- M529 — HIS SEVEN-POINT ORDER (no redundancy, the storyteller's reading, the reader's eye, speed, faster workers, the
  highest standard). Measured, not assumed: (1–2) a rich turn's whole request searched for any run of eight words said in
  two parts — only the natural overlap of one event in the record, the essentials, who-knows-what and the world's "what
  stands"; each fact has its home. (3) The order read as the storyteller: frame, craft, brief + world, the notes (canon on
  the people here — first by M386's own decision — the story so far in brief then in full, the people, the ground), the
  pages, his move; "On their mind" and "The ground" are the least plain names — left, they are his long-standing labels and
  every request's. (5) Speed at a 6× CPU slowdown: the send's request out 1.89 s median (m518: 1.96 s), his page on screen
  ~0.14 s; the rooms within budget (a cold first reading re-measured 12 and 8 ms); the housekeeper's streaming within
  budget. (6) BUILT: "Two workers at once" (Settings → The workers, off as it ships — exactly one lane then): queue.js
  lanes (setSideBySide; a job's lane 'side' runs in the story's second lane; queuedCount, workIsRunning and stopWork see
  both; each lane's job in flight has its own stop; a story switch purges both), chat.js SIDE_JOBS (keeper, sensors,
  essentials, placer, ground, plans — they read the pages and the record and write only their own books; the ledger's
  readers, the canon worker and the planner stay in the main lane), applied at boot (app.js) and on the switch (settings).
  Measured with each helper answering in 0.25 s: 2.6 s → 2.08 s per page. Laws M529-1…3; walk DOM-185.
- M530 — THE FALLBACK FOR TWO AT ONCE. His question: "what if I don't know how much my provider can do — is there a
  fallback when I switch it on?" Now: with both of a story's lanes in flight, a worker's call refused as too many (429, or
  a refusal that says concurrent / too many requests / rate limit — queue.js refusedAsTooMany) puts the house back to one
  at a time by itself (backToOneAtATime: the side lane's waiting workers join the main lane in order; the refused call is
  tried again like any refused call), and app.js's handler keeps the switch off (helpersSideBySide false) and records why
  (helpersSideBySideTurnedOff), said under the switch in Settings; turning it on again clears it. A 429 with only one lane in
  flight is a plain busy and leaves it on. Laws M530-1/2; walk DOM-186 (a provider serving one request at a time).
- M531 — A FIGHT NEVER STARTS WITH AN UNWEIGHED FIGHTER. His report: "on my first fight it basically just makes my MC 5
  unknown". The sheet seeder (How they measure) waited for two storyteller pages and ran after them, so a fight on the
  first or second page was ruled with the engine's plain rating for an unknown fighter (duels.js defaultRating 5). Now:
  seedDue weighs from the first page (referee.js), and the send path, when a move goes to the referee (its own gate —
  gatePasses — an attempt, or a fight under way) while the main character or someone here is not on the sheet, weighs them
  FIRST (maybeSeedSheet, forced, 45 s ceiling, "Weighing everyone before the fight…"; a failure never holds the page).
  M345-3's expectation now seeds from the first page (explained in the test). Walk DOM-187 (fails on m530-001).
- M532 — THE GM'S EYE AND THE OPENING'S FEELINGS. His word: "for fights the seeding is supposed to be my GM — each time
  enemies come it rates them as the GM thinks is logical for my story" — and "every time How they feel about you is empty
  and I have to rebuild the people, especially on #story". (1) The pre-fight weighing (M531) now leaves out only someone
  the last weighing already saw here and left off the sheet (a crowd, a voice — sheet.seenPresent), so a crowd never calls a
  weighing before every blow, while a NEW face (an enemy who just walked in) is weighed before the blow (DOM-187 showed it:
  a person seated by another scenario's reader was weighed at once). (2) The young ledger's page reader (extractor.js
  founding law) named no standing — a #story opening was founded as a place and a room only, and later pages move a
  standing only on something new, so the opening's moment (he saves Yuki) was never counted until a rebuild. The founding
  law now asks rel.shift for anyone the opening plainly moves (rel.set only where the brief or prose says where a standing
  already stands; a stranger the page does not move stays 0/0/0) and knowledge.add for what someone plainly learned.
  Walk DOM-188 (the opening's standing after the first page); DOM-187 extended (the crowd).
- M533 — THE SWEEP FOR THE SAME FAULTS (his order: "audit everything, make sure there are no bugs like these"). The classes:
  (1) an opening read short — the young ledger's reader (extractor.js founding law) now asks every kind of change a later
  page is read for: standings and knowledge (M532) and now hurts (body.injure / body.strain); its lines point "above" to
  the shapes and the standings law, where they really sit in its prompt. (2) a helper that starts too late — every
  page-count gate in the agents and the send path searched: only the worn-phrase finder (needs two pages by definition) and
  the cadenced keepers (auditor, housekeeper, sensors' averages) remain, by design. (3) an updater that cannot create —
  people pages (M514), standings (rel.shift creates), knowledge, seats, threads, factions, bodies, the sheet (M531/M532),
  canon lines (the page after a first meeting) — each creates. (4) a step that runs before what it needs exists — the
  referee and the sheet (M531), and the #story PREMISE: written in the first person it could pass the referee's gate and
  be ruled against his own premise before anyone was weighed — now never refereed (the receipt says so). The world agent,
  the scribe, the canon parser, the placer and the world keeper all run from the first page. Walk DOM-188 extended (the
  opening's wound; a first-person premise not refereed). Old tales whose openings were read before M532: one "Rebuild the
  people from the pages" fills them (not run by itself — it rewrites people pages).
- M534 — CANON'S REASON IS THIS TURN'S. His screenshots: the drawer's "What canon says of each" listing nine canon people
  in the scene, while the receipt said "What canon says — not part of this turn — canon found no canon face to speak of
  in the latest pages (scene scan)". Reproduced both of his modes (walk DOM-189, the simulated Bleach wiki): with Rukia
  here by the ledger and not named on the latest lines, canon speaks of her (Manual: 161 tokens; his mode, Automatic +
  legacy off: 136 tokens of the scene's lines, and her lasting lines on her card under "From canon:"). The receipt's
  reason came from the extension's ONE last-run report (another tale's page, a preview in its room, or a reset when a
  tale is entered — a reset reads as an empty scan). bridge.js canonWhy({ since }) now gives a report's reason only when
  it is this turn's (stamped after the turn asked) and has a source; otherwise "canon was still reading when the page was
  asked for — what it finds rides with the next page". The drawer's list is canon's memory of each person, not what a
  page was sent.
- M535 — THE CAPTAINS WHO LEFT STAY GONE. His report (angry): sixteen Bleach captains in "Who's here" after the meeting
  broke up, the world agent's report right (Suì-Fēng out the side door to the 2nd Division road, Shinji down the corridor
  with Rose…), and the auditor's: "Byakuya Kuchiki came into the scene. The elsewhere note let go of Byakuya Kuchiki ·
  Zaraki… · Kensei… · Rose…". The page reader had let them go and the world had seated each; the auditor — told "is
  everyone on the latest page in the ledger's presence?" — read their NAMES on the page (the room emptying) as presence and
  wrote them all back in, letting the world's seats go. No guard held its walk-ins to the newest page. Now: auditor.js
  auditorScope refuses an auditor presence.enter for someone the newest page shows going (goneAtTheEnd) or someone seated
  elsewhere the newest page does not show; apply.js walkedBackOverTheWorld puts right the walk-ins already made (a walk-in
  that let go of a seat the world wrote ON THE SAME PAGE, for someone the newest page does not keep → presence.leave and the
  seat back), on opening (with the other open-time repairs) and after every page. Laws M535-1/2.
- M536 — THE CHECK RESTARTS AFTER A LOST CONNECTION. His questions: where does "Checking which series your story is
  from…" go (the start is kept per tale — Settings → This story → "Where our story began", and it rides with every page:
  its own row, or inside the world for an Automatic brief); and "if I lose my internet during it and press retry, it is gone
  and does not restart — bug?" Yes: placeInCanon turned a failed call into "no answer", which was written down as tried
  (asked again only after six hours), and the check ran only on the send, so Try again never reached it. Now a failed call
  is { failed: true } and written down as nothing (generate's check and the chain's placeNext alike), and the opening's check
  runs in generate() where its first page is built — a send, a Try again or a reroll alike; send()'s old copy is gone.
  Walk DOM-190 (fails on m535-001).
- M537 — A MISSPELLING OF SOMEONE FOUND IS NOT "NOT FOUND". His storyteller's thinking: "the canon note says 'Not found in
  this story's canon sources: "Gojo Satorou" — treat these as original to this story…' Hmm, but actually the canon DOES list
  Satoru Gojo. The name is slightly misspelled." Canon verification's not-found report (grounding.js unverifiedNamed) let a
  miss go only when EVERY word of it was a word of someone found; "satorou" is not "satoru", so the misspelling became an
  instruction to treat Gojo as an original character. Now a word one slip from a found name's word (first letter kept; one
  edit for 4–6 letters, two from 7; Damerau) counts as that found canon, with at least one word exact — "Gojo Kenta" (a
  different person sharing the family name) and a name the wiki truly lacks are still reported. Law M537-1
  (unverifiedNamedForHarness). DOM-187 now waits until the first blow's page helpers are idle a whole second (the chain
  queues as it goes — a post-fight weighing of its own had landed in the next blow's window in the full walk).
- M538 — CANON SPEAKS ONLY OF WHAT IT FOUND. His word (furious): "why is there injection to my storyteller… 'Not found in
  this story's canon sources: Zenin clan — treat as original to this story' … if it's not canon then just be silent; why
  inject something, and even something wrong". The ⌀ line (grounding.js unvBlock) turned a FAILED wiki lookup into an
  instruction to the storyteller — wrong whenever the search was (the wiki spells it Zen'in; "Gojo Satorou" was a typo).
  Now it is never sent in Cozy Tavern (grounding.js HOST_SILENCES_MISSES, whatever a stored setting says), its default is
  off, and its switch is gone from canon's room ("Say what is NOT in canon"). The misses stay in canon's own room for his
  eyes. Walk DOM-189 (a missed name with ask intent, an old setting still on: nothing sent — fails on m535), DOM-73-era
  lever list updated.
- M539 — A FAMILY NAME USED FOR THE FAMILY NAMES NO ONE; NO NUDGE THAT FORCES SPEECH. His questions: "is there any
  injection that is stupid and could break my system?" and "why does canon say Ogi Zenin — can't it see the scene, instead of
  blindly using 'Zenin'?" (1) canon's "named by you" tier (grounding.js castNamedIn — it outranks the parser) took one word
  owned by one cached person for that person: "the Zenin clan" named Ogi Zenin, the only Zenin in canon's memory. Now an
  occurrence used for the group — "<name> clan/family/house/elders/heirs/members…", "the <name>s", "house of <name>" — is
  not a reference (groupUseAt); a person named by surname, or by name, still counts. (2) The sweep of every part a page can
  carry (EVERY_ROW) for claims that could be wrong: the ⌀ "not in canon" line is gone (M538); the M519-5 nudge ("The people
  here talk this time") could push speech through a silence the scene calls for — now "Where the moment gives the people
  here anything to say, they say it". Walk DOM-191 (castNamedInForHarness on canon's live memory); DOM-178's line updated.
- M540 — SHORT NAMES ARE THE SAME DAY. His ledger: "Saturday, January 1, 2000 — 11:15" while the page said "Mariner's Lane,
  Ravenwood — Thu, Aug 20, 2026 | 11:15". The header reader (state.js headerMutations) knew only whole weekday and month
  names, so a storyteller writing "Thu, Aug 20, 2026" set the hour and no date — the clock's empty date reads 2000-01-01.
  Not a regression: m518 and an M400-era build read it the same (the M400 one set no clock at all). Now short months
  ("Aug", "Sept.") and short weekdays read (a short weekday only where a date follows, so "Sun Temple" and "Mar Vista Pier"
  stay places), and a day-first date ("20 Aug 2026"). His tale is put right when it opens (healLedgerOnOpen's header
  clock). Law M540-1; walk DOM-192.
- M541 — TALKED ABOUT IS NOT HERE; LAST SEEN IS WHEN THEY WERE THERE. His Ravenwood evening: Claire (drove off) still in
  "Who's here" in a blouse with no position; the auditor's turn-17 reading named Aurora, Claire and Chloe as gone but only
  Aurora's leave landed; Aurora "last seen 8 pages ago" the page she left. Traced: (1) the page reader (its own walk-in, or
  its board — hereFromBoard) wrote Claire back in when Rias TALKED about her, letting the world's seat go; (2) the auditor's
  M403 rule ("anyone named in the recent pages without going stays") refused her leave — it could not tell talked-about from
  standing-there; (3) "last seen" counted from her page's last rewrite (updatedAtTurn), in the drawer and in the roster the
  storyteller reads. Now: extractor.js holds a walk-in of someone the world seated elsewhere to the newest page's telling
  (shown outside the spoken lines, not going at its end — M535's test); auditor.js may take out someone the last two story
  pages name only inside spoken lines (notToldHere; not named at all is silence and stays — M402/M403-1 green); people.js
  lastSeenTurn = the later of the page's rewrite and the last time the journal wrote them in/moved/out (one pass over the
  journal per ledger — the first version cost ~175 ms per drawer render on a 2,000-line journal and made DOM-11c/DOM-135
  time out in two full walks; measured 873 ms → 81 ms for 5 renders × 60 people). Not a regression (DOM-193 fails on
  m535). Law M541-1; walk DOM-193.
- M542 — A TRACKED PERSON IS NAMED ONCE. His question: "is it smart, autonomous, self-healing, no bloat or redundancy, an
  alive tracker?" Read in the real request (his Aurora case): the live tracker ("Elsewhere: Aurora Sterling — number 10, her
  bedroom window, weighing whether to walk over at six fifty-five") AND the end-of-list roster ("Elsewhere in the tale: Aurora
  Sterling (with us just now), …") named her — the roster leaves out tracked people only when seatsInState, which was set
  only on the biggest budgets (stateView.whole) while the ledger block carries "Elsewhere:" at every budget it fits. Now
  seatsInState is also true whenever the rendered ledger block has its "Elsewhere:" (stack.js), and the short roster keeps
  only people the world is NOT tracking (people.js). Measured: 2,024 → 2,015 tokens on his case (one tracked person; the
  saving grows with each tracked person who reached the roster); the 24 frontier fixtures identical. Law M542-1.
- M543 — THE WINDOW BEYOND THE PAGE IS ON SOMEONE BEYOND THE PAGE. His report: his storyteller's "World Beyond" window
  showed a character standing in the same scene as his main character. The window's person comes from the world agent's
  brief (twb), taken as it came (world.js normalizeBrief) and kept until its next reading — nothing checked the person was
  away, and someone it chose while away can walk in before the page is asked for. Now world.js windowOnSomeoneHere: a window
  on someone the ledger has here (or the main character, by duels.js mcName) is not told (renderWorldBrief, called with the
  ledger from chat.js) and does not wake the window's craft rule (modules.js worldWindow). M29-10's source check follows the
  new call. Law M543-1 (through listModules + selectModules, as the app loads them).
- M544 — THE SWEEP OF WHERE-EVERYONE-IS (his order: "audit everything step by step — do I need to keep telling the same
  thing?"). Every door that says who is where was gone through. Holding: only apply.js moves people (no direct writes to
  present/offscreen anywhere else); offscreen.set refuses anyone here; presence.enter lets a seat go; the world agent cannot
  move people in or out (WORLD_TYPES); the founder cannot; the send path keeps window-only names out; the page reader's and
  the auditor's walk-ins are held to the newest page (M535/M541); the window (M543). Fixed now: (1) the world's VOICES
  ("people the main character cannot hear") kept a line from someone standing in the room — world.js voicesBeyondTheRoom,
  applied where the voices are kept on the page; (2) a present person's card (and drawer line) said "Now:" from a page note
  written before they last walked in ("at the corner of Mariner's Lane…") — people.js lastEnteredTurn; such a note gives way
  to the ledger's here-and-now; (3) the auditor saw stale places in the room ("Jovan … in the kitchen" while upstairs) and
  could change nothing (M128) — it may now let such a place go when none of its words are on the newest page
  (auditorScope, presence.update with position '' only). Laws M544-1…3.
- M545 — WHY A PAGE CAME BACK EMPTY, AND WHAT SITS AFTER THE PAGES. His questions: (1) is anything injected near the end
  (depth 0–2) in normal mode, besides his note, the frame said again and the voice? Measured with every optional part on:
  after the pages, the house places only the referee's ruling (a turn whose move it ruled) and the sensors' one line (only
  with The sensors switched on — off as it ships); the director's note, the editor's eye, the house's eye, the world's word,
  canon, the people and the ledger all sit before the pages. (2) "the thinking is perfect, ends at 'let's write', then a red
  note says ask again" — the note said "went quiet" for every empty page although the provider says why it stopped. Now
  chat.js emptyPageWhy names it from the stop reason: out of room (length/max_tokens — the thinking spent the room), blocked
  by the provider's filter, ended with nothing, or the connection closed with no reason; never asked again by itself.
  Walk DOM-194 (env.mjs thinkThenNothing).
- M546 — THE FINAL AUDIT (his word: "this is the final session, audit everything, I want to enjoy and play perfectly").
  Found and fixed: the header gate's loose-header reader (a header with no brackets — a first page, a model's own dress)
  knew only whole day and month names (M540's fault in its other reader) — headergate.js SHORT_DATE, a short weekday only
  with a date after it. Added: LONG-9, the final audit's invariants over every storyteller request of the ninety-turn long
  play and its final ledger (no one both here and elsewhere; no window on someone here; no not-in-canon line; no tracked
  person named twice; no standing numbers on the wire; no empty-date clock beside a dated header; no paragraph said twice
  in one request) — 92 requests, none broken; the check prints what it read so it cannot pass on nothing. Checked and
  holding: every presence decision reads the telling, not the spoken lines (shownOnPage callers); canon has no other line
  that says something is not canon; speed — the rooms, the send (request out 1,453 ms, first token 1,797 ms at a 6×
  slowdown) and the housekeeper's streaming within budget; the browser checks for kept thinking, the page mark, the one-tale
  hold and contrast green. Law M546-1.
  M546-2 (tests only): LONG-9 read "Here now" with the line's own full stop on the last name ("Person72."), so the last
  person here was never compared against Elsewhere or the window; the stop is cut before the split (a name ending in
  "Jr." keeps its own). Long play 9/9; the last request reads "Person72". No app change.
  Also tests only: perf_rooms.py waits for the app to settle (settled(): no fixed sleep — the boot's one reload of its own
  had landed mid-measure on a slower machine) and pushes the seeded books before its reload; paint_magma.py reads the room
  after the page mark rests (its pill had been read as the glow since M466). Every tests/*.py green at m546-001.

