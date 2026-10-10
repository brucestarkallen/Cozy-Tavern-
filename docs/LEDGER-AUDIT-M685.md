# M685: ledger recovery across all four rooms

Jovan requested an actual audit of Scene, People, World and Books after an existing
story still lost Princess Alexia. Baseline: published M684, commit
613c1749e56524f30d371e518e86cd06e0b65920. Implementation checkpoint: 6fd7667.
Release verification is in progress; do not treat this document as a green gate.

## Reproduced failures and repairs

The auditor could read the whole surviving ledger but still miss a person absent from
every book. Folded summaries could omit the original introduction. Its instructions
also accepted writer supplied identities in one place and prohibited PLAYER only
facts elsewhere. A scope filter silently removed proposed corrections before the
report, and an empty model answer could announce that the ledger was true.

M685 reads original answered input and story pages, plus the brief and cast, in
bounded source batches. Exact quotations establish recovered identities. Historical
identity evidence never seats someone in the current room. The normal auditor is
shown recovered identities and checks their current relationships and whereabouts.
A normal turn reviews one uncached batch; the explicit Audit the ledger action reviews
all remaining batches. Receipts are tied to each source's text and are reused until
that source changes. Hidden and out of character material is excluded. This adds
background model work, particularly on the first complete audit of a long story.

Known names without People identities now trigger one targeted repair followup.
Blocked proposals return their actual reason to the auditor so it can choose a
working operation. A wrong name can be renamed while retaining its records; deletion
is not a substitute for that repair. Unfinished findings persist across later empty
answers. They clear when a matching repair lands or the auditor explicitly withdraws
the concern with an exact quotation and explanation. A different successful repair
cannot hide the first failure. Repeated operations do not create duplicate journal
entries. The arbitrary twenty finding truncation and prompt quota are removed. A
provider cutoff remains incomplete even if its prefix is valid JSON; one followup
can complete it, while valid earlier corrections survive. A failed followup keeps completed repairs. A failed main reading also keeps
completed source work and its receipts, with the audit still marked unfinished.

The auditor can now correct a wrong current mood, a current character state and a
missing personal promise when exact source evidence supports the change. Current
moment corrections must use the newest ending. The existing protections for manual
edits, actual departures, deaths, page earned relationships and main character
ownership remain. A clock advanced by hand no longer gets rewound by an audit of the
older header. Changed source pages or a changed brief invalidate an in flight audit.

World recovery now includes people with no location record, as well as stale records.
After an audit restores people, the world worker handles any owed review in the same
queued job, without waiting for another story turn or advancing the clock again.
Its own configured connection and enabled setting are respected. Missing or failed
world decisions remain named as unfinished. When no story clock exists, a new location
is not perpetually declared overdue merely because it has no clock timestamp.

## Audit of every requested section

This table separates reviewed existing behavior from new repairs. It is not a claim
that every possible model interpretation is correct. References are executable tests
and the implementation paths, rather than source text assertions added for M685.

| Room and section | Source to saved state to use | Evidence and disposition |
| --- | --- | --- |
| Scene: clock | Header and page reader maintain story time; a long page retains its span. The clock is included in the storyteller's state. The +15m and +1h controls explicitly advance it by hand. | Reviewed state.js, apply.js, stack.js and drawer.js. M681 clock and span laws remain; M685-12 prevents the auditor undoing a later manual advance. |
| Scene: Who's Here | Completed writer input and reply establish nearby physical presence at the scene ending. Quiet companions remain; mentions, remote windows and departed people are separate. | M684 arrival, silence, death and OOC laws; DOM-M684-1. DOM-M685-1 repairs a missed nearby princess through the actual audit button. |
| Scene: mood | The reader states the current board; the storyteller receives the relevant mode instructions. | M681 stale board recovery retained. M685-9 proves that a wrong but recently stamped board can also be corrected from the ending. |
| Scene: The house has ruled | The referee judges attempts and evidence, the engine resolves the outcome, and the ruling reaches the storyteller. Ordinary conversation does not require a roll. | Reviewed referee.js and stack.js. Existing M11 injection, M470 accounting, M505 outcome, M513 reason and M681-32 concurrency laws are retained. |
| Scene: How they measure | The seeder maintains ability ratings and conditions from brief, character records and pages. This is a stored referee sheet, not a full biography injected for every person. | M681-31, 32, 33 and 35 cover journal replay, concurrent changes, stale source rejection and conditions. No speculative rewrite of ratings. |
| People: character pages and injection | Writer and story introductions open identities independently of presence. Core, current state, arc and loose ends feed the existing relevance based prompt selection. | Reviewed extractor.js, scribe.js, people.js and stack.js. M685-1, 2, 7, 8 and DOM-M685-1 add recovery from original sources and preserve exact ranks. |
| People: feelings toward the main character | The founder supplies established initial bonds and the page reader applies earned changes. Other people's relationships are not silently treated as feelings toward the main character. | Existing M48, M259-5, M599 and M681 standing protections retained; the followup uses the same mutation guards. |
| People: holding up | Injury records and current conditions affect the character state and referee sheet. Healing clears matching injury penalties, preserving unrelated and manual conditions. | Reviewed body and referee application paths. M681-34 and 35 retained; M685-11 permits an evidence backed correction to a wrong current state. |
| People: what's true | Stable facts and character identity are distinct from passing activity. Manual fields remain owned by the writer. | M681 look normalization and transient look laws retained. M685-10 restores personal promises; M685-16 and 20 preserve concurrent identity edits. |
| People: what canon says | Canon facts and quotes pass through the story's own lens before locks and storyteller notes. The writer's established version wins. | Reviewed canonlens.js and bridge.js; existing M681 face and voice quote laws retained. Vendored Canon Verification is unchanged. |
| World: elsewhere | The world worker advances absent people by story time and their own information. A stay needs a current reason; age alone does not prove departure. | M684 overdue and confirm laws retained. M685-15 includes unseated people; M685-22 covers clockless records; DOM-M685-1 verifies post audit world recovery. |
| World: beyond the pages | World threads, pressure and eligible windows are prepared separately from the main scene and selected for the next request. A window does not place its cast near the main character. | Reviewed world.js and stack.js. Existing M29, M30, M681 world laws and DOM-M684-1 retained. |
| World: voices | Ambient voices are stored with the page for the reader; they are not injected into the storyteller as witnessed knowledge. | Reviewed world result, voicesBeyondTheRoom and request assembly. M681-55 retained; audit world recovery follows the same storage path. |
| Books: record, essentials, plans and choices | Existing readers preserve history, ongoing plans and selected choices through edits and replay. Auditor findings do not erase original story pages. | Reviewed memory.js, plans.js, continuous.js and the chat queue. Existing M681 books laws and the complete walk/long play are release checks. |
| Books: changes and corrections | Mutation journal records what landed. Reports expose original source coverage, the reason for blocked proposals, completed repairs and remaining work. | M685-3 through 6, 14, 18, 19, 23 and 24; real drawer coverage in DOM-M685-1. No blanket declaration of correctness from an empty answer. |

## Verification record

Final focused development profile: 6 checks green in 17.90 seconds. The earlier
focused profile passed in 17.99 seconds. Ledger and neighboring selection before the last two completeness laws: 98 passed, 0 failed, out of 1494 total
harness laws. Final completeness and prompt selection: 31 passed out of 1496 total. The real button scenario passes with its two app setup scenarios.
Twenty seven M685 laws cover new behavior and preservation controls. Against the published M684 baseline, 24 fail and three preservation controls pass;
all 27 pass on M685. The new button scenario also fails on M684 at the missing identity
assertion and passes on M685. Release counts will be recorded in audit/results/m685.json when the
release run finishes. Tests use scripted providers; no paid story model calls.

The first release attempt completed its full harness with 1491 passed and three
failures requiring the obsolete prompt restrictions in M47, M110 and M123. It was
stopped before the remaining release checks. Those checks now permit evidenced
repairs while retaining the runtime protections; the new completeness laws were
then proved before restarting the release.

An early diagnostic full harness was stopped before completion while implementation
continued. It is not a release result. Its failures led to checking repeat repairs and
updating old report expectations, followed by the focused green result above.

Existing tests updated for changed behavior:

* M47, M110 and M123 inspect the actual constructed prompt and retain the unsupported
  mood and unanswered attempt protections. They now accept direct writer facts and
  exact source corrections rather than requiring the contradictory blanket bans.

* M41 keeps its applied state checks and now requires unfinished work to survive an
  empty later audit, instead of calling that ledger correct.
* M259-4 finds the successful and blocked findings by their content rather than
  their order after a followup. Its state and landed count assertions remain.
* M259-6 and M679-8 keep the header and same page loose end protections and now check
  the visible pending correction instead of silent disappearance.
* M259-18 uses a 90000 token fixture context for the longer audit prompt and its
  combined 45000 character brief plus page fetch. It still proves older pages are
  initially indexed, fetched whole and actually used. No application budget changed.
* The DOM provider recognizes the new source review schema separately from story
  prose. The recovery scenario supplies exact source identities explicitly; unrelated
  fixtures return an empty checked people list by default.

## Existing stories and continuity

No real user story or phone ledger was available or changed in this session. After
updating, Audit the ledger is the complete source recovery entry point for an existing
story. Normal turns perform incremental coverage and use the same correction guards.
Unchanged source sections are not reread on each page. Source judgment still uses the
configured model; an exact quotation validates grounding, not every semantic inference.

All M680, M681, M682, M683 and M684 commits remain ancestors. HISTORY is append only,
the archived instructions remain, and the canon vendor copy was not replaced.
