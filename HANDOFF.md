# M728 followup: centered reading, Rias seated behind the left side

Version m728-002. Base a052a80d722a442e5f11c393f1e6da5d39999f17.
Owner's device screenshot shows the reserved right artwork lane pushing chat
left. Owner explicitly permits panels covering Rias and wants her sitting left.
Removed the asymmetric thread padding. Existing 740px maximum panels now center
across the full chat area. Moved the decorative figure to left/bottom zero,
increased its available size and anchored its lower crop behind the composer.
Welcome, theme identity, other coats, data and application logic are unchanged.

Updated theme CSS, version and old test assertions that required a separate
artwork lane. Focused neon_tokyo_resize.py passed center alignment, bottom-left
anchoring, live phone/unfolded/desktop/landscape/short viewport changes, no reload,
retained draft, visible composer and no overflow. Inspected actual 760px and
1440px story screenshots. No unrelated suites or provider calls. Physical device
confirmation remains the owner's; the picture may be substantially covered by
reading panels, as requested. No source art edits or service-worker logic changes.

# M728: Neon Tokyo visual redesign for phones and unfolded screens

Version m728-001. Base main 9568e5f5cd238db9bc3f6c895dccd68073193096.
Reopened M721: the 1280px/650px gate excluded Rias on phones; narrow gutter
placement minimized her elsewhere. The 95% full reading veil and nearly solid
surfaces suppressed the scene, while prose kept the generic presentation.
No additional old stacking defect was established. Passing M721 functional
checks had not established the owner's visual acceptance.

Replaces only the Neon Tokyo stylesheet's visual design. index.html adds one
aria-hidden, noninteractive room stage outside the message DOM. Local positive
stacking replaces the negative pseudo layers. Welcome allocates portrait space
on every width; expanded welcome seats Rias beside centered controls. A container
query uses actual story-area width (600px), not device or desktop width, to seat
Rias beside active reading. Compact active reading omits the large figure but
always retains her welcome presentation. The stage is stationary during scroll.

Magenta neon brand, cyan navigation, luminous writing console/send button,
illuminated story selection, glass settings and dashboard ledger now share a
coherent appearance. Narration and user writing have separate padded glass
panels, labels and corner treatments. Serif narration and chosen speech/thought
colors remain. Scene headings and existing built-in scene-card tokens are styled
without rewriting text or display rules. Local reading darkness leaves scenery
visible around and between turns. No animation, filters, new dependencies, API
calls, data migration or changes to application behavior.

Modified: css/neon-tokyo-night.css, index.html, js/version.js,
tests/neon_tokyo.py, tests/neon_tokyo_details.py, README.md, HANDOFF.md, SPEC.md.
Created tests/neon_tokyo_resize.py. HISTORY.md appended only. Existing artwork,
other coat rules, theme identity, registrations, tokens and preference storage
are unchanged. Existing service-worker shell already includes all these runtime
files; only normal VERSION changes its cache. M722-M727 behavior is retained.

Checks actually run: neon_tokyo.py with the clean M727 baseline first confirmed
all computed properties of nine Cyberpunk surfaces identical. Its first Neon
check caught the new stage's hidden attribute conflicting with the global
important hidden rule; corrected to an isolated default display rule. The focused
runner then passed 1440x900, 760x960, 390x844, 320x740 selection/persistence,
scrolling, typing, drawer/settings, switching, decoration bounds, no overflow,
reduced motion and offline shell. Cyberpunk comparison screenshots are pixel
identical above the version footer. No application page errors. Static test
server logged harmless reset/broken-pipe errors for unavailable local sync
endpoints during teardown; these are not production server verification.

neon_tokyo_details.py passed separate custom speech/thought persistence/reset,
unchanged fixture prose, nested-path offline assets and short viewport input.
Worst-case white artwork behind the local narration panel gave default palette
contrast from 7.12:1 to 13.20:1. neon_tokyo_resize.py passed active resizing at
390,600,760,950,844 landscape,320 and 390x430 without reload, lost unsent input,
clipped composer or artwork over prose. A targeted second run after welcome
spacing and compact title refinement passed and captured final welcomes.

Visually inspected narrow/expanded/desktop welcome and story screenshots,
Neon ledger/settings and both Cyberpunk comparisons. The visual difference is
substantial; owner's physical device and aesthetic acceptance remain unverified.
Original 1092x935 scenery softens on large screens; fine extraction fringes
remain, with a lower crop fade. No image pixels changed. Chromium responsive
emulation only, not physical foldable hinges/keyboards or Safari. No unrelated
worker suites, paid models or hosted deployment verification. Publication is a
normal main push under the owner's standing authorization.

# M727: Reconcile historical warnings and route local health recovery

Version m727-001. Base main 6136196b9d20653bad1d6fabf32108e332151d85.

Confirmed M726 defect: findInPages emitted `p72 #ef7158 the storyteller`,
but fetch parsing and evidence resolution rejected that complete label. The
new generated-label fixture failed before the fix with one finding still open.
The shared resolver now checks ordinal, unique handle and optional speaker
against the same original ID. Disagreement is rejected. Literal quotation and
M725 semantic fidelity checks remain unchanged. A scoped evidence-policy
checkpoint reconsiders old blocked composite-reference failures, not genuine
ambiguity or all completed historical reviews.

Successful historical receipts now identify their record. New page advisories
carry record/source provenance. Both the health inventory and corrections panel
derive advisory disposition from valid saved recovery receipts. Original warning
text remains inspectable. Legacy association requires the exact allegation and
actual cited original, with unchanged source fingerprints; similar wording or
page numbering alone cannot dismiss anything. Correct memory is not rewritten.

New agents/health.js inventories essential failures/incomplete operations,
record and ledger gaps, source/entry receipts, Auditor findings/pauses, current
factual guard failures, historical coverage/findings, advisory dispositions,
queues and ownership. chat.js reuses its existing debounced reads and routes one
eligible existing owner at a time. Normal gap, Auditor and Continuous Audit
paths retain their safeguards. Failed essential workers and the current second
reader can retry their existing single job, at most twice per unchanged input,
with durable checkpoints and backoff. Choices, sensors and unrelated jobs are
not queued by this targeted path. The latest input and existing queue/stale
checks guard application. A status write cannot reset retry counts. No healthy
material triggers another model call. health.js is included in the offline shell.

Verification: node tests/harness/m722-focused.mjs passed generated search label,
fetch, evidence, no-edit settlement, inconsistent/ambiguous references, M726
blocked recovery, advisory reconciliation, changed-source rejection, all health
categories, ordered mocked-owner recovery, green/blocked/busy states, durable
retry bounds and actual production single-job queue registration. Existing
M722–M726 focused preservation cases passed. During testing, an overbroad legacy
advisory association was found and narrowed to the actual cited original.
Controlled production lamp logic and the shared health state reach green only
with other required checks satisfied. node --check passed for changed JS modules
and sw.js; git diff --check passed. No bulk or paid-provider tests.

Limits: no access to the owner's IndexedDB, raw provider reply or live browser.
This establishes the transport and state paths in fixtures, not live resolution.
Legacy advisories lacking sufficient provenance remain unresolved rather than
being guessed away. Existing gap/worker prerequisites and genuine blocked
findings remain visible; no full historical rebuild or automatic data migration.

# M726: Resolve displayed original references before validating evidence

Version m726-001. Base main 30b05553f19db823d6eea46b5df6f5c3233bb37b.

Confirmed transport defect: the recovery prompt displayed [p72], but evidence
was indexed as "72". The new 75-page fixture passed numeric 72 and failed p72
on unmodified M725, leaving open=1. resolveMessageRef also rejected p72.
End-to-end fetch testing then exposed parseFetchRefs discarding p36 before the
resolver. Both filters now share the displayed ordinal grammar.

housekeeper.js resolves numeric ordinals, pN, [pN], page N, exact message IDs
and unambiguous handles. It reports missing/ambiguous/unavailable references
without guessing. continuous.js stores supplied originals under actual message
IDs and canonicalizes supporting and conflicting citations through that shared
resolver. Brief/cast remain distinct writer sources. Receipts retain canonical
identity and the cited spelling. Unfetched or out-of-character originals are
not evidence. Literal quotation matching, including punctuation, is unchanged.
Diagnostics identify the failed reference and distinguish lookup, ambiguity,
availability and quote mismatch from incomplete fields and semantic conflicts.

A separate evidence-transport checkpoint reconsiders blocked M725 entries with
the old exact generic fidelity-evidence validation error once. It does not bump
the semantic disposition policy, reset genuine ambiguous findings, restart
historical coverage, raise retries, or rewrite correct memory. M725 source
fidelity and existing postcondition/stale-write checks still govern settlement.

Verification: node tests/harness/m722-focused.mjs first failed the p72 fixture
on M725 while the identical numeric citation passed. After both transport fixes,
it passes displayed-reference equivalence, canonical receipts, fetched p36,
invalid/wrong-page/typographic quotations, unavailable references, OOC exclusion,
conflicting-source diagnostics, targeted legacy recovery, unchanged memory and
production lamp logic returning green with all other requirements complete.
Previous focused semantic, manual protection, Essentials, independent finding,
source dependency, undo and retry cases also pass. node --check passed for
continuous.js and housekeeper.js; git diff --check passed. No bulk suite.

Only continuous.js, housekeeper.js and version.js changed in production. Lookup
uses housekeeper's existing parser/server; no new worker or prompt architecture.
Healthy material adds zero calls. A valid p72 dismissal takes one existing
recovery request with no clarification. Fetching earlier originals uses the
existing bounded continuation. No foreground delay or full historical rescan.
The owner's live database and raw model reply were not accessible; this proves
the transport path in a mock, not the owner's live green indicator. Semantics
remain the reader's responsibility. Prose, correct memory, manual data, World,
People, themes, branches, backups and scheduling remain unchanged.

# M725: Source fidelity settles false historical allegations

Version m725-001. Base main 6fbe19ad3ff0d750a5fe6930df0e12336909cc3a.

Confirmed reproduction: M724 accepted unknown/blocked with an explanation and
original quotation supporting the record. Its prior regression covered the
simpler disproved/blocked mismatch, not this accepted pair. The new fixture
failed with open=1 before implementation. The owner's raw live response and
complete database remain unavailable, so this is a causal mock reproduction,
not proof of the exact live trigger.

Continuous Audit now validates sourceFidelity: exact record claim, original
quotation provenance, same referent/event, assertion type and scope, relation,
actual conflicting evidence and specific uncertainty. A supported assessment
controls settlement even when the generic operation says unknown/blocked. The
correct record stays intact; only its allegation closes after existing saved
postcondition and stale-source checks. No name matching or explanation keyword
verdict is used. Semantic interpretation remains the existing reader's job.
Missing or inconsistent blocked fidelity gets one clarification in the existing
conversation. Genuine ambiguity and protected unsafe repairs remain visible.
Valid legacy correct/repair replies keep their original evidence/safety checks.

Disposition policy 2 gives saved blocked M724 findings one scoped reconsideration
with durable checkpoints. It does not reset completed historical coverage or
raise retry limits. Receipts retain the fidelity judgment and reported operation.
No new worker, foreground call, UI color override, or memory rebuild was added.

Verification: node tests/harness/m722-focused.mjs failed on M724's unknown/blocked
case and passed after this change. New cases cover supported no-edit dismissal,
policy-1 recovery, different referents, fabricated evidence, genuine uncertainty,
actual contradiction repair, protected correct records, untouched Essentials,
no repeat calls and one bounded clarification. Earlier focused preservation,
stale-write, source, independent-finding and retry cases also pass. The test
executes actual production lamp logic with controlled state and a DOM facade:
yellow becomes green after the sole allegation clears and all other checks pass;
independently incomplete Auditor verification still prevents green. This was
not a browser test. node --check js/agents/continuous.js and git diff --check pass.
No live provider, owner story database or unrelated bulk tests were used.

Healthy verified material adds zero model calls. A consistent supported fidelity
verdict needs one existing recovery request and no extra clarification; missing
or inconsistent fidelity permits at most one clarification. Semantic errors by
the reader remain possible; valid quotations alone do not prove interpretation.
Original prose, valid memory, manual fields, World, themes, backup/undo paths,
worker ordering and M718 through M724 protections remain unchanged.

# M724: Resolve disproved historical findings

Version m724-001. Base main e178e4b0207c02a2a995629645a6bdbd5fb2a6e4.

Continuous Audit now separates the allegation's factual disposition (confirmed,
disproved, unknown) from its operation (repair, correct, blocked). A supported
record needs no edit: correct withdraws the mistaken finding. Inconsistent or
missing blocked dispositions get at most one clarification in the same recovery
conversation, reusing its evidence. Persistent contradictions remain blocked.
No free-text keyword verdicts or extra reviewer were introduced.

A durable disposition-policy checkpoint gives legacy M723 blocked findings one
scoped reconsideration. Existing transport retry limits remain. Success still
requires original quotation provenance, model interpretation of the exact claim,
unchanged sources/ownership and a verified saved result. Only the matching
finding clears. Receipts retain the conclusion, no-edit status, source span and
source fingerprints, survive promotion, and reopen only affected dismissals
when their supporting originals or cited writer sources change. The lamp uses
actual findings, including invalidated receipts; no forced green behavior.

Focused check: node tests/harness/m722-focused.mjs. The new contradictory verdict
fixture first failed on M723 (open remained 1); the extended harness now passes.
Includes consistent one-call dismissal, legacy reconsideration, bounded ambiguity,
invalid evidence, two independent findings, persistence, source invalidation,
worker completion, actual repair/Essentials preservation and stale writes.
node --check passed for continuous.js, memory.js and chat.js; git diff --check
passed. No bulk suite, paid provider or live browser/story test. The initial
attempt to use --experimental-default-type=module was rejected by Node 24;
the documented plain node command ran the tests successfully.

The owner's actual p72 database and raw response were unavailable. The fixture
proves the contradictory-disposition path, not the precise live trigger or a
cleared warning on the owner's device. Semantic applicability still depends on
the existing reviewer; quotation matching alone does not prove interpretation.
Healthy material adds zero requests; consistent verdicts add no clarification.
Unchanged completed coverage is reused. Original prose, manual memory, World,
M718–M723 behavior, themes, backup paths and worker ordering are preserved.

# M723: Automatic recovery of unresolved historical corrections

Version m723-001. Base main 16b3c0dc7c112131bc34ead9b1b2bc0b345969bf.

M722 preserved auditOpen findings but scheduled them only after input changes;
the idle scheduler also looked only for unread pages. A valid reading with a
failed repair could therefore remain unresolved indefinitely. Its worker row
incorrectly called completed coverage "stopped partway".

Continuous Audit now gives a new or saved unresolved finding one targeted
recovery conversation in the same worker. It supplies the exact record, detail,
original section, brief/cast, earlier record context and precise validation
failure. The existing original-source lookup permits up to two bounded fetch
continuations for earlier evidence. Local silence about a title is not proof
that it was never established. The verdict must repair an exact supported span,
withdraw the allegation with original evidence, or state the blocker.

Each finding has a durable identity and a reservation saved before the request.
Transport/format failures may receive one deferred retry after 60 seconds.
Semantic uncertainty, unsafe edits and protected records remain explicit blocked
findings. Reload does not reset attempts. Relevant source, ownership, record or
writer-fact changes permit reconsideration. Healthy completed material makes no
new calls. No worker, lane, foreground call or historical rebuild was added.

Recovery checks exact unique spans, source quotations, replacement provenance,
M722 shortening limits, surrounding text, writer ownership, node/source identity
and stale results. It rereads the saved result before clearing only the repaired
finding. A saved edit interrupted before completion can finish verification
without another model call. Node metadata retains the disposition, evidence and
previous text for a correction. Existing prose and undo paths are untouched.
The M722 Essentials invalidation path is reused after an actual record edit.

Worker results persist reading coverage separately from open/pending corrections.
The drawer says the reading completed when it did; the lamp remains amber for
blocked findings and shows work while recovery runs. Idle scheduling now sees
unresolved corrections even when every folded page is already reviewed.

Focused verification: node tests/harness/m722-focused.mjs passed, extended with
M723 cases for immediate and saved-finding recovery, earlier-original withdrawal,
manual protection, ambiguity, bounded retries, transport failure, changed writer
facts, interrupted save verification, separate findings and concurrent edits.
The status storage/render helper round trip passed. The healthy case used zero
additional calls; immediate recovery used one follow-up; earlier-page retrieval
used one fetch continuation. These are mocked provider measurements, not live
latency measurements. node --check js/agents/continuous.js, js/ui/chat.js and
js/ui/drawer.js and git diff --check also passed. No bulk suite or live provider
run. The owner's full historical record remains unavailable; the actual captain
identity is not verified. Model interpretation remains fallible. Evidence that
cannot fit safely or establish the claim remains blocked without endless calls.

M718 through M722 identity, World, themes, automatic updates, story generation,
relationships, branches, original prose, manual memory and backup paths remain
unchanged. Only Continuous Audit recovery and its status plumbing were changed.

---

# M722: Source identity completion and historical correction status

Version m722-001. Base main d8f3ba2ba5745fe3054359d9e0952238d19305b6.

Source classification now settles against the valid source-local binding,
independently of People core completeness. Extracted stable facts have their
own source-scoped reconciliation findings. Equivalent wording or a mistaken
extraction can close through the existing factual review or a grounded
withdrawal, cached against the source mark, target, facts and actual core.
Unknown optional biography is not required. Equivalent source.resolve bindings
are no-ops even when their explanations differ; target/kind changes retain undo.
Repair policy 6 permits one reconsideration of old paused work without resetting
source receipts or completed entry checks.

Continuous Audit distinguishes story, record, knowledge and uncertain findings.
A story mend requires the wrong original passage and conflicting prior evidence.
A short record correction may shorten/remove an unsupported assertion only with
explicit source grounding, a unique exact span, surviving surrounding text and
existing ownership/stale-write checks. Failed record edits and uncertain routing
remain on the memory node as auditOpen, separately from reading coverage. They
stay visible but do not reread unchanged sources. Changes to their source, line
or protection allow targeted reconsideration. Existing page audit advisories get
one scoped reconsideration; clean completed sections remain cached. Unresolved
nodes retain their identity during promotion; other lines can still fold.
Corrected memory invalidates contradictory Essentials consumption until normal
background maintenance produces Essentials from the current record.

Focused verification passed: node tests/harness/m722-focused.mjs;
node tests/harness/m718-source-identity.mjs;
node tests/harness/m719-ledger.mjs --sources-only;
node tests/harness/m719-followups.mjs. Also node --check js/ui/chat.js and
git diff --check. Mocked model responses only. The new fixture covers saved
bodyguard decisions, changed-target undo, source collisions, stable fact
recovery, scoped nonactionable decisions, paused receipt reuse, record-only
correction, old advisory recovery, protected unresolved memory, unchanged-call
suppression, Essentials refresh and genuine story-mend eligibility.

The owner's full receipt and pages 70–75 were unavailable. The actual captain
identity and the exact original extracted bodyguard facts remain unverified.
No mandatory model call or worker was added. No original prose, manual facts,
World behavior, themes, update handling, branches or backup paths were changed.

---

# M721: Neon Tokyo Night, an independent scenic coat

Version m721-001. Base main a87d357df542f9c106256f4f1dad1deeca6449b3.
New feature, not a bug repair. Cyberpunk and all existing theme rules retained.

Adds a separate theme registration, Appearance radio/swatch, complete color
palette and speech name mapping. Existing settings persistence is reused.
css/neon-tokyo-night.css scopes every presentation rule to the new identity.
Static fixed pseudo elements use the supplied neon_tokyo_city.webp and
rias_seated_extracted.png unchanged under assets/neon-tokyo/. No painted UI
reference or development previews ship. The supplied source PNG stays in the
owner's original archive. The art is generated illustration, not a real photo;
its inclusion does not convey ownership of the underlying fictional character.

Prose keeps its established serif layout and 760px column, with a 95% dark
reading veil. Rias occupies only the spare right gutter at widths >=1280px
and heights >=650px; hidden elsewhere, including phones. A CSS mask blends
the extracted image's straight lower crop; delicate hair fringes remain in the
original pixels but are unobtrusive at the tested sizes. The 1092x935 city is
soft when enlarged to 1920px, an accepted source limitation, not new detail.
No animation, backdrop filter, :has selector, focusable decoration or JS loop.
Settings, ledger, sidebar, composer, navigation and focus use the new palette.

Service worker changes only add the stylesheet and two images to SHELL;
version bump uses the existing update contract. No update coordinator edits.
No story, worker, provider, auditor, database schema or data migrations.

Focused real Chromium checks passed: 1440x900, 1920x1080, 390x844 and 320x740;
actual Appearance selection, persistence, long fixture prose/scrolling, typing,
ledger opening/closing, settings, theme switching, no horizontal overflow,
reduced motion and offline shell. Baseline Cyberpunk compared all computed
properties on nine primary surfaces including the drawer: identical. Existing
Cyberpunk CSS blocks are byte preserved; other coats' rules are untouched.
The first runner was executed from scratch, retained as tests/neon_tokyo.py
with repository-relative paths and optional clean baseline checkout argument.

tests/neon_tokyo_details.py passed independent speech/thought save, reload,
reset without altering Cyberpunk, exact fixture prose retention, nested path
loading and offline assets, decorative gutter bounds and a 390x430 composer
viewport. Its first attempt read the color input before asynchronous Settings
reload finished; the fixture now waits for the displayed coat name, then passed.
Default text/color contrast against worst-case white artwork under the veil
ranged from 8.30:1 to 15.38:1. Final screenshots were visually inspected after
the crop fade. No paid model calls or unrelated suites.

Limits: Chromium emulation, not physical Android/Opera, Safari or an actual
onscreen keyboard. No owner story touched. No compositor profiling or hosted
GitHub Pages deployment verification. A Git push does not update Termux's clone.

Created: css/neon-tokyo-night.css, assets/neon-tokyo/neon_tokyo_city.webp,
assets/neon-tokyo/rias_seated_extracted.png, tests/neon_tokyo.py,
tests/neon_tokyo_details.py. Modified: css/base.css, css/coats.css, index.html,
js/app.js, js/ui/speechcolours.js, js/version.js, sw.js and milestone docs.

# M720: safe automatic application updates

Version m720-001. Base main: 2201d546368675d19b45f6ba4bd568274c70d175.

Confirmed in real Chromium before correction: takeover during deliberately slow
startup left the old document running after the new worker activated. The late
listener missed its event. The legacy first-install hadController flag also
remained false for the entire sitting and ignored later takeovers. A second fixture with HTTP max-age also reproduced
an imported VERSION remaining cached under updateViaCache imports. Termux sends
no-store already; its caching was not implicated by this reproduction.

Updates now start before asynchronous application startup, compare the loaded
VERSION with the controlling worker through a message channel, and reconcile
again after startup and update checks. Registration uses updateViaCache none;
installation fetches fresh shell files instead of accepting stale HTTP assets.
Existing cache-first offline serving, API exclusions, skipWaiting and claim stay.
Startup, visibility, online and existing timed checks require no GitHub polling.

A single coordinator defers reload for composer text or attachments, visible
forms and edits, generation/replay, story opening and branching, restore and
settings saves, pending database writes, synchronization and queued background
work. A failed database save blocks automatic reload for that document. A visible
notice explains deferral. Drafts remain in their original controls; no new draft
storage or story migration. Reload attempts are bounded per tab and version pair.
Registration failures are retried when the connection returns. All guards observe
existing operations; no ledger, prompt, World or memory decisions changed.

Focused verification: tests/browser_updates.py --baseline reproduced both faults;
the default browser scenario passed automatic normal and slow startup updates,
imported-only version changes under HTTP caching, two tabs, unsent text, active
edit and operation holds, the generation busy guard, reconnect, a real failed
IndexedDB save, story/settings retention, offline opening and no reload loop.
--forms-only passed a real unsent attachment and a blurred unsent form, followed
by automatic reload when both were finished. No test manually refreshed a page.
The generation guard used a controlled busy state, not a paid provider call.
No unrelated suites or ledger audits. --migration passed an actual M719
controlled tab upgrading to the corrected code without manual refresh, while
also confirming the separate stranded legacy first-install tab.

Limits: no owner device, Android/Opera or Safari run. Background browsers may
throttle checks; returning to the visible tab triggers another check. Drafts and
open forms intentionally defer updates until finished. An old document already
stuck before loading this coordinator can still need one initial manual reload;
new code cannot retroactively replace its old event listener or protect its
in-memory draft. Normal legacy takeover is checked separately. A GitHub push
neither updates a local Termux clone nor proves hosted deployment availability.
No deployment requested or performed.

# M719 followups: truthful People status and source identity scope

Version m719-002, based on remote main 2a0d1a8fd46108f97fdb3a9eed0e92bcf6bc0c78.

People reports unfinished only for pending sourced save failures or incomplete
execution. Mutation results explicitly identify recoverable capacity failures;
unsupported, manual-protected and already-held proposals do not create recovery
jobs. Empty-delta replies now apply recovery dispositions and clear stale pending
facts. Incomplete replies remain visible. Storage exceptions still propagate.

Determiner-led source descriptions require interpretation in their own section,
including when an identically labelled character exists globally. Explicit saved
M718 decisions take priority; same-label inferred ledger names are not decisions.
Unresolved descriptions cannot inject another person's identity or appearance.
Continuing couriers can bind to their existing Elsewhere record without a core.
Unique unnamed identities remain recoverable through the existing final reader.
Original receipts, marks and saved decisions are retained; no blanket invalidation.

Focused checks: m719-followups.mjs passed with six mocked People calls; the M718
source identity harness passed; only the source/audit portion of m719-ledger.mjs
passed (now separately selectable with --sources-only). That portion checks
princess recovery, optional courier biography, completed review reuse, changed
sources, undo and retry bounds. A syntax error found when loading the auditor was
corrected before those source checks passed. No bulk suite or live provider test.

No World lifecycle, memory, context assembly, scheduling, prose, manual facts,
relationships, branches, backup or migration changes. No new model calls or
workers. Semantic support and source interpretation still depend on the existing
readers; conservative descriptor routing can require a local identity decision
inside the existing audit conversation. No live story correctness claim.

# M719: evidence based identity, durable memory and bounded World work

Current publication update, 12 October 2026 Jakarta: the owner explicitly
authorized normal publication using the attached credential after completion.
Implementation and focused verification are complete as documented below.
Authenticated fetch confirmed remote main still at the original M718 base.
The earlier integration permission failure below is historical; a normal push
is now authorized. No deployment or additional live provider test is included.


Earlier publication attempt: BLOCKED. The connected GitHub integration rejected
create_blob with HTTP403, Resource not accessible by integration. No remote
commit was created and no branch update was attempted. The attached account
token was not used. Publication requires write access through the connected
integration, not another approval for the requested code work.
Local implementation commit: 43e15fe7b2f37fea70050d3e85a9e1790dc1c125.
Last confirmed remote main:267302bb54cf30788033b23b28c9b0b34717c2b0.


Version m719-001. M718 remote base267302bb54cf30788033b23b28c9b0b34717c2b0.
See docs/M719.md for exact changes, executed checks, measurements and limits.

Optional empty biographies no longer create compulsory missing core repairs.
Original sourced individuals and identity facts still require real review;
M718 source local bindings, receipts and completed audit reuse remain intact.
Policy5 resumes old paused procedures once, not completed factual audits.

World activity is separate from newcomer/appearance relevance. Goals persist
when omitted, the 40 seat eviction is gone, retirement retains historical
identity and lastKnown evidence, and returning dormant people are recallable.
Views and ordinary required reviews are budgeted; deferred lives remain stored
and explicitly reported. People core additions retain the old facts. Failed
sourced core proposals return to the existing People reader and remain visible.
No new model, mandatory call, dependency, migration or deployment.

Focused m719 and m718 fixtures passed. The m713 worker fixture passed after its
old replacement expectation was updated to intentional additive preservation.
Long history estimates:174688 input at200K;961817 at1M;16000 answer allowance.
No live story/provider test or latency claim. Cup ending adapters passed without
a chronology rewrite. All prose, manual facts, earned standings, sources,
branches, journal, backup and existing memory/provider pipelines preserved.
Do not rerun tests for these notes or publication. Default focused testing and
standing normal main publication permission remain in AGENTS.md.

# M718: durable source identity decisions, no global descriptor aliases

Version m718-001. The owner's M717 report now has181/181 original sections,
208/208 ledger entries and final review ok. One source candidate, "the girl"
on Page72, remains unbound and loops as a missing person. M717's quotation
transport repair succeeded but the pipeline lacked a durable source-local
identity disposition in the final answer. Live browser not inspected.

* Final auditor may return identities:[{sourceId,name,to,kind,why}], applied as
  source.resolve in the existing transaction. A contextual label is bound to
  its actual existing person within that one source section. Nonperson and
  comparison-only reference decisions retain original provenance too. No new
  People page, global alias, relationship rewrite or original prose change.
  Truly missing individuals still need their sourced profile in the same answer.
* Pending source findings retain their sourceId and original name. The current
  mention and explicit decision task are shown with the real ledger. A missing
  saved decision is completed in the existing SAME-conversation continuation,
  rather than discovered again by another full audit. A text-only withdrawal
  must not erase the task without saving its durable source decision.
* Source-local remembered names take precedence and are never borrowed from
  another page with the same descriptor. Identity and appearance inventory use
  this shared resolver. Existing valid receipts and source marks are unchanged.
  A small existing-name/alias/identity hint index helps new source readings
  resolve contextual descriptions before final audit; actual originals govern.
* Same-label chunks of a long page retain distinct source finding ids and are
  resolved together. New scoped findings replace their legacy unscoped words.
  Engine source.resolve is journaled/undoable and changes only receipt identity
  metadata. Undo invalidates completed approval and preserves unrelated source
  facts/decisions. Repair policy4 resumes old pauses once, without invalidating
  completed unchanged reviews or rereading already completed source sections.

Only node tests/harness/m718-source-identity.mjs ran. Passed first in0.14s,
then0.22s after the source-section collision found during code review was fixed.
One final mocked call completed the persisted old source complaint with zero
source scans, no owed repeat audit, unchanged manual cores/arcs/feelings/prose,
and different identities for the same descriptor on different pages. Same
fixture exercised one omitted decision completed inside the original exchange,
metadata undo, nonperson/reference classification and multiple same-label long
page sections resolved together in one call. No broad suite, themes, gameplay,
paid/provider calls or live browser verification. No repeat for docs/publication.
Default NO tests and owner standing normal publication permission still apply.
This certifies the exercised paths, not the unseen live final verdict.

# M717: original passage selection instead of copied quote gates

Version m717-001. The owner's M716 report approved208/208 ledger entries and
read180/181 original sections. Only Page72 failed source transport: a copied
identity quote was not literal, a canonical title did not occur verbatim in a
shorter-name passage, and one identity quote was paraphrased. The live browser
was not inspected. This was a source protocol defect, not another known ledger
contradiction or a reason to replay the story.

* Source requests now contain ordered, referenced ORIGINAL passages, covering
  the complete unchanged source once. The model selects evidence ids and owns
  identity, kind and fact meaning across titles, shorter names and pronouns.
  The app binds selected spans to the actual original words, including spans
  across passages. It no longer demands that the model reproduce punctuation,
  Markdown or a canonical title inside every quote, or uses a collective-name
  regex as another source semantic verdict.
* Literal legacy replies and existing valid receipts remain reusable. Source
  ids, marks and completion contracts are unchanged. Saved receipts still hold
  literal quotations; downstream provenance, manual ownership, undo and stale
  source protections remain. No duplicate raw source beside the passage text,
  and request packing measures the actual referenced payload.
* The existing one focused correction stays in the SAME conversation and asks
  for supplied references, not another hand-copied quotation. No new worker,
  independent semantic checker or paid call was added. Original source lookup
  retains the reader's selected sections even when the canonical title does
  not appear verbatim there. Repair policy3 resumes older paused failures once;
  completed unchanged audits stay completed across this release and reload.

Only node tests/harness/m717-source-passages.mjs ran. Initial persisted fixture
was seeded before storage normalization and lacked the previously held source
facts; corrected fixture setup. It then passed in0.09s, and after the linked
source-index preservation passed in0.11s. A paused already-approved ledger with
one unfinished source completed with ONE mocked source call and ZERO repeated
ledger calls, then owed no audit on unchanged reopen. The same fixture covers
canonical titles, pronouns, formatted dialogue, unknown-id refusal, one focused
correction, complete original text, long paragraphs/CRLF and selected source
fetchability. No broad suite, gameplay, theme or real provider calls. No further
fixture repetition for documentation or publication. Default NO tests and the
owner's normal standing publication permission remain in AGENTS.md.
This demonstrates the exercised protocol; the owner's live result is unobserved.

# M716: actual subjects, false entity correction and upstream physical repair

Version m716-001. The owner's new M715 report has175/175 sources read, resolving
the preceding transport failure, but a kingdom was extracted as an individual
and given a prince's appearance. Final audit identified the error yet blanket
people.forget rejection forced an inappropriate rename. One prince profile
was206/207, rejected as changed while reading. No live browser was inspected.

* Shared Founder/Scene/World/People/Auditor instructions identify the actual
  subject before saving an identity or physical fact. A homeland in a title is
  not another person. Original source extraction now carries an optional kind,
  retaining nonperson provenance without creating People or appearance atoms.
  Existing cached receipts and source ids/marks remain valid.
* People supports entities decisions in its EXISTING answer. A quoted place,
  organization, object or group misfiled as a person gets people.reclassify.
  Actual misplaced records are archived in entityCorrections, removed only
  from individual books, and the current source inventory classification is
  corrected. Real facts go on their actual subject in that same answer.
  No new worker/auditor call. A wrong existing physical value can be corrected
  using replaces matching the current value and a source reason. Manual facts,
  later actual developments and valid alternate faces remain protected.
* Final audit can make the same explicit entity correction instead of being
  told to rename a kingdom into a prince. Semantic classification belongs to
  the reader, with no place-name detectors. The normal journal and undo retain
  original misplaced books and source kind metadata. Exact removal cannot
  accidentally erase a similarly spelled real character. Prose and manual
  People/canon/player records stay protected.
* Removed synthetic empty People preview rows for extracted names. They could
  change source-fact ownership during rehearsal before any approved identity
  write. Actual newly created rows are already covered by the single completed
  final verdict. Source classifications persist through both preview and final
  commit; sourceReview.cache no longer overwrites the approved correction.
  Old recovery/forget findings close after the actual classified repair.
  Missing reasons are stated plainly instead of appending undefined.
* Repair policy2 lets an old paused failure try this new procedure once, without
  invalidating completed unchanged audits. New pauses carry pausedPolicy;
  scheduler and drawer agree. Future changes to actual repair mechanics should
  explicitly advance this policy, never tie completed audits to app VERSION.

Only node tests/harness/m716-entity-subject.mjs ran. First run exposed missing
player rejection at final scope (the engine already rejected it), corrected.
Then passed in0.11s, and passed again after adding the named upstream existing
wrong-value correction. One mocked People call, no audit, corrected entity and
physical ownership including an already wrong eye value. One mocked final audit
call, no source rescan, repaired the saved false entity, completed every actual
entry and owed no repeat review. It exercised archival/undo, original prose,
manual/player preservation, source classification, old-pause resumption and
refusal to certify a genuine concurrent change. No broad suite, themes, gameplay
or real provider calls. Do not repeat the passing fixture for docs/publication.
This proves the exercised generic paths, not the owner's live final green light.
There are no story-name branches. Default NO tests and standing publication
permission remain in AGENTS.md.

# M715: source receipt correction and completed audit reuse

Version m715-001. Owner reported one original source still incomplete while
all210 ledger checks were approved, and unwanted audits on story opening or
reload. The attached report was captured on M713. No live IndexedDB or provider
session was inspected; the report did not identify the rejected source row.

* Source reading now retains exact per-section transport problems. A missing
  checked id, missing identityFacts, unsupported literal quote, unknown id or
  collective identity receives one correction in the SAME reading, requesting
  only unfinished ids and retaining valid source receipts. Still-invalid facts
  stay open; no invented source receipt or green verdict. Debug shows bounded
  exact reasons rather than demanding a giant prose export.
* Completed semantic review is reused during source-only recovery when every
  actual ledger value still has its approved receipt and originals match.
  A changed source inventory/profile value or real outstanding finding still
  needs factual review. No second fresh full review for an unchanged approved
  ledger merely because one source reply was incomplete.
* Completion fingerprints use source content/order/writer roles and semantic
  ledger values, independent of app release/provider/bookkeeping timestamps.
  Existing M713/M714 approval can migrate only through its exact legacy source
  key, original ordered marks, writer authority and matching actual row checks.
  Do not remove these fixed legacy formats as releases advance. Earlier or
  unprovable completion is not fabricated.
* Opening heal/replay and idle scheduling recognize saved factual completion
  first, including when an old worker shelf says unfinished or a version
  snapshot is missing. Existing paused unfinished work remains paused for an
  unchanged factual input; real changes and explicit audit can resume it.
  The changed contract lets old paused M713/M714 inputs try the corrected
  source transport once, preserving their valid cached originals and checks.

Only node tests/harness/m715-source-resume.mjs ran. It passed source format
correction, failure diagnostics, unchanged cache reuse, source/fact/role/order
invalidation, metadata/provider tolerance and proven M713 migration. Actual
persisted audit source-only recovery made two mocked source calls and zero
combined ledger calls, finished, and owed no idle repair. Two prior runs found
a fixture-only normalization mismatch: initial empty state had not been saved
before constructing review receipts. No broad suite, paid calls, gameplay,
theme checks or inspection of the owner's live story. The legacy release list
was then made fixed rather than relative; its current M713/M714 behavior is
unchanged. Do not repeat this passing fixture for docs or publication.

Default NO tests remains, with only genuinely useful tiny milestone checks.
Normal publication is authorized in AGENTS.md. See SPEC.md for this contract.

# M714: foundation selection, context fit and source recovery

Version m714-001, published to origin/main after explicit owner approval.
Verified code commit: 5d1ff01ede41388695bd5dcda484dba000809cd4.
Owner requested the ledger foundation milestone after the
M713 system audit. The changes are universal selection/transport/scheduling
repairs, not named story patches. Read docs/LEDGER_FOUNDATION_M714.md.

* Named absent people now contribute saved canonical physical facts and their
  selected knowledge without becoming present. Latest named recalls take
  priority; aliases are recognized. Relevant older People obligations, MC
  knowledge and explicitly mentioned stored things can ride again.
* The final request includes all closing words, notes, and own words in its
  conservative fit estimate, reserves the configured answer and3000 tokens,
  and removes old history only. Latest exchange, current input and rules stay
  intact. Receipts say when history rests. Impossible required content gives
  a clear error rather than a knowingly oversized send. Estimates are not
  provider tokenizer counts. No source records are deleted.
* Historical review fits more original chunks to actual connection room and
  answer allowance; a truncated group shrinks and retries in the same run.
  Chunk ids/marks and quote validation stay stable. Unchanged source receipts
  and durable auditor checkpoints remain reusable. The earlier audit overstated
  a long-page blocker:12000 character overlapping source chunks already existed.
* World no longer repeats knowledge/seats/threads/factions in two input
  sections. Workers omit exact already-held profile facts from the recovery
  appendix. The raw evidence and unresolved differing facts remain available.
  Hybrid record nodes follow the caller's actual pre-window coverage boundary.
* Foreground pendingWork shares one total deadline instead of resetting it for
  every queued job. This does NOT claim all existing optional send helpers or
  background model calls now take less than five seconds. Idle ordinary review
  honors auditEvery; initial recovery/open findings still resume autonomously.
  Green requires existing authoritative completion, never a fabricated verdict.

One directly relevant local fixture passed: node tests/harness/m714-foundation.mjs.
Actual assembler with more than100 stored people and long pages carried saved
appearance, older obligation/knowledge/item, closing instructions and the
latest exchange. Both keeper modes measured175445 estimated input tokens in
200000 context, with16000 answer plus3000 margin reserved. Seven original
chunks packed in one mocked source call; unchanged reread made zero calls;
truncated packing retried to complete. It checked duplicate World knowledge,
held-profile omission, durable checkpoint reuse/change invalidation and one
worker-wait deadline. State stayed byte-equivalent under rendering. No real
provider calls, browser/IndexedDB inspection, gameplay, themes or broad suites.
Two unsupported Node launch flags failed before the fixture ran; plain Node
ran the fixture successfully. No repetition for documentation/publication.

The owner remains exhausted by unnecessary tests. Default NO tests. Future
sessions must use only tiny specific checks when genuinely needed at milestones
or after useful iterations. Publication permission remains in AGENTS.md.

# Ledger system audit after M713

The owner requested an audit of sandbox behavior, storyteller injection,
token efficiency, long play, duplication and restructuring on 11 October 2026.
Read docs/LEDGER_SYSTEM_AUDIT_M713.md before implementing the next milestone.
This review changed documentation only. Its newly identified findings are NOT
fixed by M713 and must not be reported as completed repairs.

One local request inspection, no provider calls or gameplay, confirmed:
an absent queen named in the newest move was recalled without her stored hair;
an older open promise of a present person was omitted; a keeper window with
long pages produced about245141 input tokens for a200000 token room; the
keeper off case reached201124 including a16000 token answer allowance.
Direct review also found the historical source review's24000 character batch
ceiling can block a single readable original document, and idle verification
can bypass the page chain's audit frequency. Prioritize relevant appearance,
final whole request fit and source document fit, then relevance, duplicate
views and scheduling. Preserve source receipts, manual ownership, prose,
valid standings, journal/undo and existing worker dependencies. Default no
tests remains. No broad suite, live model audit or application change ran.

# M713: repair the ledger workers before the final auditor

Version m713-001. The owner requested a whole audit of the upstream ledger
pipeline, rather than another patch to the final auditor or individual story
characters. Default remains NO tests; only a tiny causal milestone check is
allowed. Do not run release/theme/gameplay matrices or repeat checks for docs
or publication. Normal publication remains authorized by AGENTS.md.

The latest M712 live report already settled the original wall-position and
rewording loop: one final call,207/207 entries,167/167 sources,no pending work.
M713 repairs upstream causes found by inspecting Founder, Scene, World, People,
source retrieval, persistence, worker ordering and journal/ownership handoffs.
Read docs/LEDGER_PIPELINE.md for the responsibility map and remaining bounds.

Changes:
* Founder/Scene/People read complete selected People records, not storyteller
  card and recall limits. Every omitted name remains available for lookup.
* People receives matching cached original identity/appearance facts, including
  folded sources, inside its EXISTING call. Source marks invalidate stale or
  hidden originals. Nonempty event-only cores are not complete biographies.
* Founder and People can save ONLY original writer-established MC biography,
  with verified writer quotations and durable coreOrigin, through journaled
  people.set. MC arc remains protected. Manual fields and earned standings stay.
* Scene's last instruction now agrees with its nested ending contract. Exact
  ending evidence may come from either message. Newly introduced singular-role
  identities and explicitly established aliases exist when their looks are
  attributed in the SAME answer. Appearance quotes and persona-specific keys
  survive parsing. Supported paraphrases do not need lexical word overlap.
* World sees ALL elsewhere seats, includes empty established character pages,
  and receives character arcs/loose ends and full quiet-character records.
* Person lookup uses the shared unique matcher and player aliases, never the
  first record sharing a first name. Search retains references to ALL original
  matching pages beyond the newest excerpts, including folded originals.
* Open character/world threads and learned knowledge no longer evict old facts
  just because a new one is added. Reload and merge also retain open threads.
  The old 60-fact constant stays only as a conservative LEGACY loss horizon.
  Prompt views remain fitted separately; explicit closures still work.
* Removed silent response-count cuts for appearance, introductions, healed
  wounds, thread/loose-end verdicts and things, and arbitrary question-list
  cuts for open wounds/loose ends. Existing structural field bounds remain.

Validation: only tests/harness/m713-workers.mjs, actual Founder/Scene/World/
People paths with mocked provider replies and NO auditor. It demonstrated
writer biography/coreOrigin, old original profile/hair recovery while earlier
pages are folded, a new unnamed royal sibling and appearance, a writer-input
ending pose,100 actual seats and arcs,manual appearance ownership,unchanged
p60/r50 and prose,and retention/reload of46 open threads and66 knowledge facts.
The check exposed one missing quotedSource import, fixed; its next run exposed
an incomplete fixture world answer (it omitted the already-owed queen), fixed
in the fixture. Final run passed. Two unsupported node-flag launch attempts
never executed the fixture; use plain node tests/harness/m713-workers.mjs.
No broad suites, paid calls, gameplay, live story audit, or publishing retests.
Later removal of collection-count cuts and the compact older-search-reference
listing were directly reviewed, not separately exercised. Do not misrepresent
mock wiring as a live provider verdict. No NEW model call added to a page.

No user-specific character names or story phrases occur in production changes.
Existing provider fetch/recovery and transport retries remain; this does not
promise every future answer will require exactly one request. The model still
owns chronology, semantic equivalence and interpretation. Existing live browser
records change only when their workers run; repository code cannot certify or
rewrite unseen IndexedDB data. Audit remains the final factual check, not a
substitute for deliberate gaps in the workers. No forced rescan, green reset,
new approval certificate, source checkpoint reset, or repeated audit added.

# M712: retain scene provenance and respect semantic equivalence

Version m712-001. The owner's M711 live report confirms the original position
repair: the MC is backed TO the wall, not still crossing the ground. The audit
completed in one call,167/167 sources,210/210 approvals,no pending operations.
The phrase after six steps describes how they arrived without contradicting
where they now are. Do not demand another stylistic pose edit or describe this
specific live fix as unconfirmed.

The report also exposes two bookkeeping faults. Source quotations on the
scene entry rather than inside ending were lost by sceneEndingFields, leaving
journal shown empty and a cast-only reference. The adapter now retains outer
shown/evidenceId while ONLY physical fields come from ending. No fabricated
quote, mandatory source echo or blocking guard added. Existing historical
journal entries remain unchanged; subsequent writes retain supplied evidence.

The scene adapter previously treated every different string as an error. The
new auditor scene contract includes repair:false for a physically correct or
equivalent saved state, repair:true for a factual correction. Explicit false
keeps the ending read in the scratchbook without generating a write. The model
owns equivalence, not another English classifier or AI. Shorter/reordered
wording is not a discrepancy; preserve useful specifics such as a seat count.
Missing flags retain older direct-write compatibility; ordinary explicit
issue mutations remain supported. No extra call, completion echo or retry.
Do not call seven logged writes seven newly discovered factual errors: the
report includes equivalent rewording. Prose, ownership, profiles, scores,
snapshot concurrency, checkpoint reuse and normal journal/undo remain intact.

No tests or new audit were run, as promised for this report analysis and the
owner's default no-test policy. Changes were reviewed directly. Previous M711
causal milestone check remains the last executed fixture; do not rerun it for
notes or publication. Publish normally under standing permission and verify
remote main. The specific wall-position fix is observed live; M712 bookkeeping
behavior is implemented but not yet observed in a subsequent provider reply.

# M711: separate physical history from the current snapshot

Version m711-001. The owner's actual M710 report confirms all eight writes
landed and the audit completed in one call,167/167 sources,210/210 receipts,
no unfinished work. But the model's position concatenates the earlier retreat
with the shoulder finding the wall. M710 recovered the ending evidence without
producing a clean current-state snapshot. Do not describe that live position
as fully corrected or confuse completed approval with perfect interpretation.

Scene here entries and auditor scene entries now separate optional earlier
movement from an explicit ending object: position,attire,shown. A shared
sceneEndingFields adapter saves ONLY that ending when present, never appending
legacy/earlier wording. The original quote is evidence, not the prose to copy
into current position: final physical state may be faithfully paraphrased in
present terms. Changed movements replace superseded pose, rather than adding
a page summary to it. Exact old flat replies remain compatible. The ending
object is working state, not another certificate or approval gate. Unknown
outfits are omitted; punctuation placeholders cannot become recorded attire.

The same adapter feeds Scene here notes and the final auditor's ordinary
presence repairs, preserving M710's one-pass approval for changed retained
entries. Earlier narrative remains in saved prose and finalReview.scene,
not injected as an ongoing physical position. No character-specific patch,
regex interpretation of the story, extra provider call or retry gate added.
Manual ownership, profiles, feelings, source checkpoints, concurrent snapshot
protections and journal/undo remain. No prose or ledger record is deleted.

Only tests/harness/m711-ending.mjs ran once at this milestone,0.24s,passed.
It exercises the actual extractor/auditor paths with an earlier movement and
contradictory legacy flat fields beside the explicit final stop and outfit;
only ending reaches current presence. A missing pose/placeholder attire does
not promote old fields. History remains in the scratchbook. A retained entry
is repaired and approved in one mocked audit call, keeping witnesses, prose,
profiles and p60/r50. No broad or old suites, paid calls or publishing retests.
This establishes the wiring, not the next live provider's semantic verdict.
Publish normally under standing permission and verify exact remote main.

# M710: save and reconcile the completed scene

Version m710-001. The owner's live M709 report is genuinely complete:
167/167 source coverage, 210/210 approvals, one final model call, no open
findings. However its presence still says the player is backing across the
ground while the completed narration puts their shoulder against the wall.
Green reports the auditor's approval, not an infallible semantic judgment.

Root cause in Scene: the MC was excluded from the explicit ending-position
questions, and a separate header pose/outfit was appended as a fallback.
Whole-page word overlap could make an opening state eligible even after it
changed. The fallback also did not see the newly collected ending updates as
already touching those fields. Removed automatic header pose/outfit injection;
retained clock/place parsing. MC receives the same explicit ending question,
including pronoun-only actions. Removed the arbitrary 16-person question cap.
Quoted final updates now take precedence over legacy unquoted restatements.
The founding prompt also folds header attire/position through later narration.

Scene and the final auditor use the same derive-before-compare procedure:
track actor/recipient, fold movements and clothes to their final state, keep
quiet observers, and exclude the World Beyond window from local presence.
The final review returns a short scene array as its working ending record.
Actual position/attire differences become ordinary approved presence writes,
not just an explanatory verdict, including when issues is empty. Equivalent
wording should reuse current text. No story-specific names or wall detector,
additional model call, mandatory source certificate or semantic guard added.
Legacy issues/checks-only responses remain supported. Arrivals, departures,
bodies and factual People now repairs retain their explicit operations.

An approved repair can change an already-retained entry and the shared scene
scope of other rows. These resulting snapshots now receive the SAME final
review approval; the old retained row id cannot force another echo audit.
Later concurrent writes still cannot borrow approval. The working ending read
is saved with its page id in finalReview.scene and appears in capped debug.
Durable profile checkpoints, source coverage, manual ownership, established
biographies, personas, earned feelings, original prose and journal/undo remain.

Only tests/harness/m710-ending.mjs was used at this milestone. Initial run
reached the final preservation assertion, whose raw fixture omitted the
store's default fields; corrected it to compare the saved pre-audit snapshot.
Final targeted run passed in 0.29s. It exercises actual extractor/auditor paths:
header pose/outfit cannot override a later pronoun stop/clothes change or be
promoted when the pose is omitted; MC gets an ending decision; a formerly
approved stale entry is repaired and approved in ONE mocked audit call; quiet
witnesses, prose, profiles and p60/r50 remain. No other suites, theme/gameplay
checks or paid calls. This proves the code path, not a live model verdict.
No retest for notes, commit or publishing. Publish normally under the owner's
standing permission, verify exact remote main, and do not ask them to design
another repair or paste another report merely to finish this code work.

# M709 current revision: optional provenance cannot silently drop writes

Version m709-002. Final review of the legacy physicalFacts adapter found that
it still discarded an explicitly requested appearance write without an id or
quote. That extra transport requirement is removed: key/value create the
logged proposal under final auditor authority. No fabricated evidence is added.
The one targeted fixture was rerun only after this runtime fix,0.14s,passed,
including the new no-provenance adapter case. This is not a publishing retest.
All M709 authority, ownership, concurrency and live-verification limits below
remain. Both M709 revisions were normally published under standing permission.

# M709: final auditor authority and concise review approval

Version m709-001. The actual M708 report covers167/167 sources and208/210
entries. Last attempt made2 model calls,0 source calls and0 lookups, returned
both requested character verdicts, but remained pending because identityFacts
with inCore:true did not satisfy another mandatory identity mapping array.
Earlier history still contains source-reference failures. Do not claim that
source pages were lost, the owner just needs to wait, or M708 finished live.

The production auditor now accepts one explicit completed whole-review verdict
for ALL supplied required snapshots, or the existing explicit entry verdicts.
Nested identity/appearance mapping arrays and per-entry quotation certificates
are no longer required to repeat the same semantic approval. Completion is
explicit, with why and open entries; issues:[] alone still cannot turn green.
The model remains responsible for reviewing original chronology, completeness,
all valid personas and identity, and for repairing actual omissions. Extracted
source atoms are guidance, not authority over originals. This intentionally
replaces M708's forced profile mapping continuation. A genuinely open verdict
stays pending. One format completion remains only for an unusable verdict.

Production finalAuditorScope keeps supported operations and ownership rules,
but no longer requires the opaque evidence-id/quote gate or the duplicate
identity English classifier. Unknown old evidence references are retained as
an honest provenance note with supplied original source ids, without inventing
quotations or blocking the model's approved factual repair. Manual edits,
player ownership, established records and earned relationship scores remain
protected. People forget is refused; use preserving renames. Regular workers
retain their existing behavior. Approved auditor appearance, persona and
rename writes skip engine prose classifiers, using an application-assigned
approval marker; they are not marked manual. Earlier manual appearance locks
and unlocks now keep ownership across later pages, not only the page they
were edited on. Writer biography provenance retains real supplied source ids.

The final audit no longer runs automatic seat/identity/retirement heuristics
alongside the model verdict. Their exported helpers and regular upkeep paths
remain intact. Explicit starting digits continue their established preservation
rules. Approved state is derived from the actual shown snapshot plus approved
repairs; a later concurrently changed value cannot borrow that verdict. All
writes still use normal journal/undo. A complete approval does not certify a
rejected mutation, an actual missing person, incomplete source coverage, an
open page concern or newer ledger work. Resulting new rows are included in
the same complete review rather than requiring a second echo audit.

The prompt now requests a short whole-review result and working repairs,
instead of hundreds of certificates and duplicated profile arrays. The output
budget no longer grows with the count of unchanged entries. Durable source
coverage/checkpoints/cursor remain. Source scanning new or edited originals
and genuine missing-context fetches can still add calls; no fixed provider
latency is claimed. Debug differentiates whole-review versus entry approval,
counts approved decisions rather than raw JSON checks, and does not call
approved facts unresolved merely because redundant appearance arrays vanished.

Only node tests/harness/m709-focused.mjs was run once,0.14s,passed. It exercises
the actual identityFacts/inCore reply without another identity array, approved
appearance repair with an unavailable old source id and no fabricated quote,
compact complete verdict for every required entry, reused durable approvals,
explicit open refusal and exact snapshot concurrency handling. It preserves
manual eyes across later pages, biographies, dual faces, prose and p60/r50.
No broad/theme/gameplay tests and no paid provider calls. The fixture proves
these connections, not live completion or a bug-free model judgment. Publish
under the owner's standing permission without another ask or a retest.

# M708: one combined ledger verdict, complete profiles before saving

Version m708-001. The owner's actual M707 reports have167/167 original
sources,205 or206 of210 entry receipts, all4 requested character checks
returned, but missing appearance mappings and source binding errors. Repeated
reads overwrite the same player's hair between own and alternate faces. This
is a real repair cycle, not one entry per model call and not a completed fix.

The automatic auditor now makes ONE combined semantic review: discover actual
discrepancies, propose repairs, map identity/appearance facts, reconcile old
findings and certify resulting entry snapshots in the same response. Removed
the preliminary discovery request and the separate focused profile request.
Explicit starting standings are included in that same answer and cached by
writer inputs/player identity, eliminating a separate recurring digits call.
The original source scanner remains separate: unchanged originals are cached;
new or edited originals may require source reading calls. Historical backfills
still use context-sized source groups. Do not claim the entire large history
fits one provider request or a fixed live latency.

All required entry checks are supplied together, never fixed-size entry
batches. Canon appearance already inside an approved People snapshot receives
that exact approval without another duplicate canon verdict. Complete source
mappings are required in the main prompt, not deferred to a later broad audit.
The same review can request at most one response completion when required
checks/mappings are missing or appearance proposals conflict. Existing source
fetches remain available for genuinely missing context. Completion carries
actual unresolved facts and saved targets in the original conversation.

Before saving profile rewrites, the actual proposed resulting fields are
checked against the housekeeper's explicit source mappings. Conflicting
canon writes for the same person/key cannot alternate colours into the saved
ledger. An unresolved profile holds its own biography/appearance rewrites;
other completed repairs remain usable. Player aliases route to the actual
player before withholding a draft. Source-backed missing identities receive
empty PREVIEW rows so their actual sourced creation and resulting check can
finish together; these empty placeholders are not saved as biographies.
The auditor owns semantic meaning; literal source evidence, manual ownership,
identity/scope restrictions and concurrent-write protections remain. There is
no separate AI approving the auditor. The housekeeper edits ledger records,
not application code. Code fixes happen in the repository.

Source receipts normalize whitespace, while M707's evidence book required raw
substring equality. The book now resolves those normalized quotes back to
exact original multiline spans before storing offsets. Source hash validation
and source-mark invalidation still apply; unknown opaque ids alone are invalid.
This corrects a transport fault without hardcoded characters or hair colours.

Scratchbook and capped debug now show actual review calls, source calls,
fetches and whether one response completion occurred. Old and new reply
markers are supported. Entry totals are completed saved decisions, not calls.
M707's durable checkpoints and scene cursor remain. Stable approved profiles
survive new scenes; changed source facts/values reopen affected profiles.

Only tests/harness/m708-focused.mjs was run at the implementation milestone.
Initial run0.11s passed; after alias withholding/evidence-error handling and
an end-to-end conflicting-answer case, the final run0.14s passed. It exercises
one combined mocked request, complete equivalent profile mappings, preservation
of dual faces and long purple hair, normalized multiline evidence transport,
shared canon certification, checkpoint reuse/invalidation, and a contradictory
hair answer corrected once in the same conversation with no interim blonde
write. Manual eyes, biographies, prose and earned p60/r50 remain intact. No
broad/theme/gameplay tests or real provider calls. These fixtures do NOT prove
that the owner's live story has finished green. Do not claim that prematurely.
Publish under the owner's standing permission; no new approval ask or retest.

# M707: durable auditor scratchbook and shared evidence transport

Version m707-001. The live M706 report still has167/167 original sources read,
but156/169 entry checks. Its last reply requested13 checks, returned ZERO,
finished normally and was labeled usable. Source references from other readings
or saved ledger evidence were unavailable to a later binder. Do not describe
this as another semantic auditor rejecting the housekeeper, mere waiting or a
completed live repair. M706 did not finish the live pipeline.

A shared persisted evidence book now registers original-validated source and
inventory spans for discovery, final verification and focused reconciliation.
It stores source id/mark/offset/length pointers, not duplicated story pages.
Existing journal references can be upgraded only from their real original quote
and matching source hash. Reopening preserves valid references; changed or
removed originals invalidate them. Successful rebinding clears stale transport
errors. A valid literal original quotation also suffices when an old opaque id
is unavailable. Invented ids without evidence still cannot supply a quote.

Final review has an explicit primary checks contract. An issues-only reply is
not a completed checklist. The same conversation receives at most ONE format
continuation, keeping its source context; no extra semantic auditor is added.
Partial replies are reported as incomplete checks and keep valid completed work.
The player-core vocabulary now agrees with the established writer biography
exception instead of contradicting it. Supported saved repairs are certified
from their exact approved resulting snapshot, regardless of correct/repair
wording. No-change supported verdicts close; concurrent unreviewed values do not.

Characters verification now covers stable core, identity and appearance.
characterState rows separately cover current state and valid worker arc/threads.
Durable checkpoints retain character/canon reviews across appended story pages
and releases when actual values, identity, writer authority and original source
dependencies still hold. Moving or advancing the clock does not discard stable
profile approval. Repeating an unchanged appearance fact adds provenance, not
another required approval. Changed facts or affected source documents reopen
those reviews. Current scene/state still gets new-page verification. After a complete scene
review, a saved source cursor starts the next reading at the new pages. The
actual view honors this even below its old ten-page minimum. The latest scene
stays available for same-page changes; edited or removed earlier sources reset
the cursor. Folded context and originals remain fetchable. Source coverage
continues to reuse unchanged original receipts. The old M703 assertion
that movement alone invalidates biography is intentionally superseded.

The Workers panel has an Auditor scratchbook button opening a read-only window
with source coverage, retained stable reviews, current entry completion, partial
fact decisions and remaining work. It does not call a model or modify the story.
Debug output adds only bounded scratchbook counts/ids; its24KB cap stays. New
modules are in the service-worker shell. No unrelated theme changes.

Verification used only tests/harness/m707-focused.mjs, each run about0.1s. The
first run exposed incorrect refusal of a supported no-change repair verdict;
that runtime bug was fixed. The next run exposed a fixture null-clock setup,
then corrected. Further meaningful iterations covered repeated source facts
and acceptance of an exact supported current-state repair labeled correct,
while rejecting a later unreviewed concurrent value. Final run passed. The
fixture reproduces zero-check ordinary JSON, one same-review continuation,
shared source references in focused output, actual missing hair repair,
checkpoint reuse after scene movement, per-person invalidation, original
removal, stale error cleanup, literal fallback, and preservation of manual eyes,
all biographies, prose and p60/r50. No bulk/theme/gameplay tests or live provider
calls. These checks validate exercised mechanisms, not the owner's actual final
green state. Publish under the standing permission in AGENTS.md; no new ask.

# M706: finish source reconciliation instead of repeating broad audit

Version m706-001. The actual M705 reading covered167/167 source documents and
received all11 requested checks, but verified only157/168 entries. No repair
operations remained unresolved. Azrael's enriched biography and the queen's
recovered profile were real repairs; yellow persisted because ordinary complete
character verdicts omitted mandatory nested mappings for source facts expressed
under different keys, combined persona values, or paraphrased core phrases.
Do not claim those facts are absent merely because reconciliation is missing.

After a usable full review, the housekeeper now receives ONE focused task only
for unmatched original profile facts, with literal source quotations and exact
saved core/canon targets. Its required output is the semantic mapping itself.
Equivalent meaning is mapped without cosmetic rewrites; missing facts receive
supported direct canon/core repairs and verification in that same reading.
Only requested profile fields can change here; scene, aliases, prose, manual
ownership, worker feelings and earned scores keep their existing protections.
No source cache/schema bump or full story source rescan is required. The usual
source replacement and concurrent-write checks still run after this new call.

Partial successful fact mappings are saved under the actual profile fingerprint
and scope, even if another fact on that person remains open. Reuse requires the
same source input and exact current profile/context. Retry progress now counts
those accounted facts instead of pausing while real fact-level work proceeds.
Full-entry approval still requires every recovered fact to be accounted for;
no blanket green or automatic semantic matching was introduced. Diagnostics
include focused profile review status, requested facts and received checks.

Verification: node tests/harness/m706-focused.mjs ran once and passed in0.11s.
It reproduces the actual reply shape: all ordinary checks, omitted nested
mappings, combined dual-face hair, an appearance stored under another key,
paraphrased identities and absent queen hair. One focused mocked call closes
those checks and saves missing hair. It also verifies partial mapping reuse,
stale/missing-value refusal, and preservation of manual eyes, biographies,
prose and p60/r50. One additional tiny in-memory progress assertion passed:
accounted atoms count as progress; mappings for changed profiles do not.
No broad suite, theme/gameplay run, source reread or real provider calls.
This verifies the mechanism, not completion on the owner's live story.
Publishing is authorized for every version in AGENTS.md; do not ask again.

# M705: connect profile references, approved facts and writer role recovery

Version m705-001. The actual M704 report has source coverage167/167,25 recovered
appearance facts across9 people, entry verification154/163, and no-progress
pause. The queen's hair WAS retrieved from an original page; the report does
not include its full quote/value. Actual rejected repairs use appearance ids
that were supplied in the character checklist but absent from the evidence
binder's registry. The final reader returned9 checks, yet recorded appearances
still lacked per-fact reconciliation. Do not tell the owner this was merely
waiting, missing originals or a completed live repair. M704's small fixture did
not exercise repairs using appearance ids or dual-face field mappings.

Both initial and final reading now register original-validated appearance and
identity ids as evidence. The final registry follows the actual provisional
identity snapshot, including merges, rather than retaining pre-merge ids.
Invented references remain rejected. PhysicalFacts on an approved character
check now directly propose logged canon.lock writes; the model need not repeat
that same decision under profiles/issues. Supported physical repairs can earn
the same final receipt even if the reader called its approved target correct.
Exact source key/value already saved is accounted for deterministically, with a
real receipt, without requiring a second appearance array. Missing facts still
fail. A housekeeper-approved explicit source-id mapping may choose an actual
persona/form-specific field, keeping multiple faces under the one player
identity without forcing dark and gold hair into a single key. The model judges
meaning; code checks original evidence and actual saved values. Original prose,
manual facts, player biography and earned feelings are retained.

Source discovery now includes individually established singular role labels,
ranked siblings and relatives without inventing personal names or treating a
character design reference as another story person. Writer-source review also
collects source-backed atomic identity facts for rank/background/personality and
preferences, excluding guessed feelings. Only writer inputs/brief/cast with old
profile receipts need upgrading; completed M704 story appearance receipts stay
cached. No global source mark bump or full-story appearance rescan is required.
Actual character rows include writer identity inventory; missing recovered
facts cannot pass until the saved core represents them, or an evidenced/current
manual decision accounts for them. Correct cores with exact recorded phrases
need no redundant echo; semantic rewordings use an explicit exact saved excerpt.
This also exposes loss of a player's earlier writer biography after a persona
rewrite instead of silently approving only the latest face. The housekeeper
must preserve all valid existing identity and faces when enriching that core.

Folded originals ARE fetchable: askWithFetch uses stored messages, and serveFetch
returns original pages by number/code, while memory summaries are separate
record handles. Folding alone does not erase source pages. Current capped
diagnostics include pending verification characters, their actual physical
facts/writer inventory, and rejected mutation keys/values. The cap is retained.

Verification: only node tests/harness/m705-focused.mjs, passed once. One mocked
source call and one final review reproduce the actual appearance-id shape,
record direct approved physical facts, preserve two persona hair fields,
recover an absent queen's explicit personality/appearance and a role-only
princess, reuse old story-source reads, accept accounted exact facts without
duplicate echoes, refuse unsupported ids and missing personality, and fetch a
folded original page. Manual eyes, full player biography, prose and p60/r50
remain unchanged. No bulk, theme, gameplay or real provider calls. Do not rerun
for documentation, commit or publishing. This proves the exercised connections,
not that the owner's actual nine remaining entries or every source extraction
are already complete. Standing publication permission is recorded in AGENTS.md.

# M704: account for recovered appearance before approving a character

Publication authorization: the initial M704 push was rejected by automatic
review because it treated the prior approval as specific to M703. The owner
then explicitly approved M704 and ALL future versions at19:27 Jakarta on
11 October2026. Standing permission is recorded in AGENTS.md; the older
version-specific approval stops below are historical. Publish requested work
without asking per version, using normal nonforce push and remote verification.
No tests were added or repeated for this permission/documentation update.

Version m704-001. The owner's live M703 report completed source coverage167/167
and entry verification163/163 without unresolved work. That proves completion
of the recorded audit, not exhaustive factual correctness. The subsequent queen
appearance concern exposed a shared code gap: source reading retained one
identity quote per person/document, without an appearance inventory; the final
housekeeper could approve identity/appearance with a blanket sourced verdict.
The compact report omits the queen's actual record and full older descriptions,
so do not claim her specific purple hair was present, absent or repaired here.

Source schema2 now asks the EXISTING original-source reading for every explicit
lasting physical fact, with exact original quotation and a facts array even when
empty. Unsupported quotations or identity-only replies cannot certify a source.
The old identity-only source receipts require one new appearance reading, then
are cached and reused. Output room is6000 tokens and batches cap at24000 input
characters to reserve room for sourced facts. No extra independent agent or
paid call is added to the ordinary send path.

The inventory routes through known identities/player aliases, retains original
source references and deduplicates repeated identical person/key/value facts.
Each actual People verification row contains its source appearance inventory.
The final housekeeper must account for each fact by id: held with an actual
saved canon key/value, superseded with original replacement evidence and the
actual replacement, ended with original evidence and no remaining lock, or an
actual current manual lock/unlock. Unknown or duplicate ids, absent facts and
unsupported replacements remain unfinished. The housekeeper owns semantic
meaning/chronology, the code checks named operations, evidence and actual saved
values. There is no queen name, appearance or story-specific production patch.
Newly repaired physical locks use the character's actual reconciliation for
same-pass canon receipts. Changed inventory/physical values invalidate the
character receipt; unrelated completed rows still resume normally. Compact
diagnostics include appearance inventory counts and first pending source facts.
Prose, earned relationship judgments, source text and manual values are retained.

Verification: only node tests/harness/m704-focused.mjs, passed once. One mocked
source reading and two final readings exercise original appearance extraction,
old-cache invalidation, rejected unsupported quotes, blocked blanket approval
for an absent character, source-backed physical repair on the remaining entry,
reused source coverage, same-pass new canon receipt, exact saved-value checks,
deduplication, evidenced later replacements and retained manual hair, prose and
p60/r50 scores. No bulk, theme, gameplay or live provider calls. No rerun needed
for notes, commit or publication. The source model can still miss something;
this closes the known silent omission between recovered facts and approval,
not a claim of perfect extraction or the owner's specific live queen recovery.

# M703: connect housekeeper authority, writer facts and resumable verification

Version m703-001. The actual M702 report confirms Jovan's persona and the king
merge landed, then exposes a different conflict: the auditor demands Azrael's
empty core be populated, its scope and the engine forbid it, and opening the
story clears any primary MC core. Entry review stalls at95/163 with missing
checks. A controlled M702 pass did not cover an empty primary MC People record.

Writer facts are records, not model interpretation. The auditor may recover MC
core only from a literal ORIGINAL writer brief, cast note or writer page quote.
Scope removes provider permission flags and establishes writerEstablished itself.
The engine routes the core through the normal logged/undoable setter, retains
coreOrigin proof, and reopening preserves an exact writer-proven core or manual
field. Ordinary workers still cannot invent MC core or arc. Shared reader and
scribe instructions agree with this ownership. Main-character original writer
references are now proactively included in the evidence bank. The original
prose, manual fields and valid earned relationship scores are untouched.

Final biography approval includes exact before/after text, preventing the final
reader from losing sight of valid facts a shortened draft omitted. An absent or
open entry verdict withholds its first-pass core. Corrections can supersede
provisional People fields without saving the wrong draft first. A failed final
reading withholds provisional core, scene and identity writes. The housekeeper's
explicit sourced correct/repair verdict means complete identity/appearance review;
no duplicate boolean flags or rewritten biography are required in checks. If
optional detail is supplied it still must be valid, source-bound and match actual
canon; explicitly unfinished review cannot pass. New physical locks can still
receive same-pass canon receipts from explicit physicalFacts.

Completed receipts are reused by source, exact row fingerprint and relevant
context instead of requiring the entire ledger hash to stay unchanged. Context
includes identity routing and, for physical rows, the scene; a People row also
depends on its own presence/elsewhere context. A biography repair does not throw
away other characters' completed reviews. Changed sources, values or dependent
context invalidate receipts. Completion still requires every actual row and all
source coverage, never just empty findings. Originals are offered fairly across
People before long passages consume the bank. The capped debug report now shows
final-reader status, requested/received counts, reply size and grouped failures.
This makes missing output distinguishable from a refused factual correction.

Verification: only node tests/harness/m703-focused.mjs. The first execution's
fixture seeded receipts before normal migration defaults, so its mock final
reader rejected a changed fingerprint and approval was withheld. Setup was fixed
to seed ACTUAL saved/loaded shapes. The next execution passed. It exercises empty
primary MC source recovery, save/open preservation and undo, rejected provider
ownership spoofing, preserved manual biography, withheld unapproved shortening,
retained unrelated receipts, one missing-check continuation, context/source
invalidation, incomplete-review refusal and unchanged prose/scores. Three mocked
reader replies exercise repair, final review and continuation; no gameplay, theme,
bulk suite or paid calls. Do not rerun after documentation or publishing.

Owner explicitly authorized this connected implementation. Automatic approval
review rejected the commit/push before execution, treating prior publication
approval as limited to M702 and requiring explicit approval for this new M703
commit on GitHub main. Do not retry or bypass this rejection; the tested change
is prepared as a local commit for that approval. No additional tests are needed.
The owner's complete phone sources/provider output
are not available here. These shared defects are repaired and controlled behavior
is verified; do not claim the live ledger or every possible story is perfect.

# M702: repair identity authority and entry receipt contracts

Version m702-001. The actual M701 report remains yellow: source coverage167/167,
entry verification126/167, duplicate Theodagar/the king refused despite literal
King Theodagar proof and the target core identifying him, and Jovan's declarative
writer identity list refused by the narrow persona sentence recognizer. Alexia's
stable profile recovery did land. Do not claim this was a completed live repair.

The auditor owns semantic identity judgments. Its mc.alias proposal may use an
original quote grounding both the known player and persona without matching one
English sentence pattern. Literal original membership, named parties, excluded
dialogue/World identity sources, manual ownership and stale-source checks remain.
Ordinary workers still use the conservative automatic recognizer. Persona aliases
join the provisional identity checklist and are withheld along with merges when
that final reading fails. A completed alias persists and prevents World reseating.
Role-label merge targets are supported when their actual core and literal quote
both identify the source name and role, including short roles. No story names or
biographies are hardcoded. The final reader judges one identity, not cooccurrence.

People checks can prove their facts individually. Valid identity/physical fact
proof no longer needs a duplicate top-level quotation. Unknown references and
unsupported physical facts remain refused. JSON containing only checks is usable.
The caller binds an omitted fingerprint to that call's exact requested snapshot;
unrequested ids cannot earn receipts, explicit wrong hashes fail, and a changed
row still requires an actually applied repair. Providers need not echo hashes.
Old explicit target ids follow aliases to actual merged records, so rejected
historical seat proposals do not persist just because the duplicate id vanished.
Diagnostics distinguish absent checks, wrong fingerprints and duplicate checks.
The queue respects newly verified entries counted by its checkpoint rather than
pausing merely because a raw receipt count did not increase. Genuine no-progress
still pauses; unresolved or unchecked work cannot show green.

Verification: node tests/harness/m702-focused.mjs passed once. One controlled
full audit exercises the three receipt-contract failures, role/name merge,
declarative persona, final identity checklist, retained knowledge, obsolete target
reconciliation, literal source refusal, wrong hash refusal, alias undo, false-green
refusal and unchanged prose/earned scores. No bulk, theme, gameplay or paid calls.
Two unsupported Node CLI flag attempts exited before running any test; the plain
repository command ran successfully. No rerun after documentation. The phone's
complete sources, provider reply and final saved ledger are unavailable here.
This fixes shared contracts; it is not proof that all live findings are resolved
or that every possible story is perfect. Continue AGENTS.md's minimal checks.

Publication status: automatic approval review rejected the combined commit/push
before execution, then rejected the retry after Personal Context retrieved the
owner's explicit prior approval, treating that retrieved context as untrusted.
The owner subsequently explicitly approved publishing the prepared M702 commit
in the current conversation on 11 October 2026. That resolves the authorization
block. Publish normally to the verified existing main destination and verify its
remote commit; no additional tests are required for these publication notes.

# M701: repair the shared evidence contract and reconcile original personas

Version m701-001. The owner's actual M700 compact report has 167/167 source
coverage but only 109/167 entry checks, rejected Alexia/Roddick/priest/pie-seller
profiles, duplicate identical king writes and Jugram still treated as another
person despite original narration explicitly saying the MC walks as that name.

Root cause: M700 proactively supplies 1600-character profile passages. Shared
quotedSource and auditorSourceQuote rejected quotes longer than 1200. Correct
references were bound to real text, then rejected by their own consumer. The prior
fixture's descriptive passage ended near the excerpt start, so its selected span
was shorter than 1200 and never exercised this contract. Do not call that prior
controlled pass proof that the owner's profiles were fixed.

Literal source membership now validates evidence independently of quote size.
Remove the same arbitrary auditor fallback restriction and proof truncation at
parse time. Unknown references, fabricated quotes, source replacement, stale
answers, manual protections and field ownership remain checked. Renames and
persona proof use the same source contract. This fixes a producer/consumer defect
across stories, rather than special cases for particular people or appearances.

Original writer material and completed main narration reconcile already tracked
own-persona names before profile reading. Explicit named-owner identity statements
are recognized too. World voices are excluded. Completed main narration is read with dialogue
removed, while original writer material supplies explicit writer facts. The source-backed alias preview informs all audit readers;
its normal logged mutation is committed only in the final fresh-source transaction.
Scene uses the same source reconciliation before routing its writes. Persona
registration is no longer contingent on the model remembering an additional op.
This preserves the existing player name and prevents a separate Elsewhere seat.

Auditor People writes with an identical saved field are no-ops, including duplicates
within one result. Normal worker freshness and manual same-value locks are unaffected.
Retry progress counts only current-source receipts for exact current entries. Old
version check counts cannot set an unreachable progress baseline; genuinely new
verified entries count as progress even when a larger audit discovers more work.
Debug evidence summaries include reference errors and quote lengths under the existing
24k byte cap, so a future producer/consumer mismatch is directly visible.

Verification: only tests/harness/m701-focused.mjs ran, once and passed. It exercises
an original selected passage longer than 1200 through the full controlled audit,
rejects fabricated text, omits the model's persona proposal while recovering explicit
completed narration, catches duplicate People writes, checks old-version progress,
and retains the prior targeted profile/state/physical fact, final-lock verification,
equivalent posture, undo and prose/earned-score preservation assertions. No bulk,
theme, gameplay or paid live calls. The owner's full phone story remains unavailable;
its eventual saved result, not a synthetic model reply, establishes live success.
Keep AGENTS.md's minimal milestone verification policy for future sessions.

# M700: reconcile actual repairs, recover profiles, persist player personas

Version m700-001. Owner reports operationless historical findings remain yellow
although a position repair landed, equivalent completed posture is called wrong,
Jugram is wrongly simulated as a separate absent person, and Alexia retains an
escort sentence instead of her established identity/personality/physical facts.

Repair checklists now include actual current ledger entries even when an old
allegation has no operation. Completed source-backed checks of those exact entries
close the allegation. An unverified entry still prevents closure. Check Scene AND
People state; do not mistake verb tense or added detail for a changed end posture.
Settled no-operation complaints are removed from the final report too.

Profile retrieval considers every matching source and every occurrence, ranks
descriptive passages rather than taking the earliest three mentions, and shares
space across characters. Remaining original pages can be fetched. Profile repairs
can return sourced core/state/facts directly, converted into normal logged writes.
Final People receipts list identity and physical facts with source proof; physical
facts must actually be in canon. New locks explicitly verified with their People
record can receive their exact canon receipt in the same final reading. No extra
batch is needed merely to repeat the new entry id. No particular story name, rank,
trait or appearance is hardcoded as a repair.

mc.alias persists explicitly established own personas in sheet.playerAliases.
All isMc consumers, World and reader context share them. It clears the separate
seat and blocks future World seats for that persona. A legacy supported persona
clear becomes an alias registration. Founder/Scene require literal writer material;
Auditor binds original writer evidence. Hypotheticals/dialogue do not establish an
identity. Surrounding unrelated questions do not invalidate a valid identity sentence.
Identity and cleared seats are undoable together. Names, prose, manual fields and
valid earned relationship judgments remain intact.

Capped debug reports now include player personas and actual People core/now/physical
facts even if there are no findings. They retain the 24k byte cap and redaction.

Verification: only tests/harness/m700-focused.mjs was run, with controlled replies.
It passed after correcting two fixture assertions and after useful final iterations
covering a canon fact introduced during final review and an unrelated question in
persona evidence. It checks late descriptive-source recovery, real profile/state/hair
writes, unchanged equivalent posture, closure only against verified current records,
persisted persona recognition and blocked reseating, undo, unchanged prose and scores.
No theme tests, gameplay, bulk suite or live paid calls. The phone's complete local
story is unavailable here; this proves the causal code paths, not its live green light.
Keep AGENTS.md minimal-verification policy. Do not promise live profile completeness
until the updated auditor's actual saved result confirms it.

# M699: accept real evidence and recover complete People records

Version m699-001. The owner's M698 snapshot proves the MC wall correction landed,
but verification stalled at 156/166. Actual valid replies carried lastEvidenceId
only for presence checks. M698 bound that to lastShown, then separately required
shown/evidenceId. Its own duplicate proof requirement rejected those answers.
The previous controlled fixture supplied both fields and missed this real shape.

Presence verification now accepts the bound original main-story reference as the
proof, without demanding it again in another field. An explicit positionMatches
verdict permits equivalent wording without cosmetic ledger writes; a changed
meaning still needs a real correction. Unknown refs and stale checks still fail.

Remove the arbitrary 32-entry slice. All outstanding current entries are supplied
in the same final review, with answer space sized to ledger size (up to 24k output
tokens) and that space reserved from the input view. Fetching can use the normal
lookup rounds. Completed valid receipts still persist, but there is no artificial
multi-run entry batching. Truly oversized context/output and model failures remain
possible and must not be represented as successful verification.

The incomplete People profiles have a separate production cause: missingSourcePeople
and extractor copied a literal occurrence quotation directly into core. Recovery
then stopped at any nonempty core, including an event-only sentence. Source recovery
now creates a repair target, never a raw-quote core write. Extractor requires a
separate synthesized stable core with source evidence; an absent core is not filled
with an arbitrary event. Legacy sourceRecovery no longer bypasses quotation proof.

Auditor receives an original-source index for every character and known alias,
including old pages and World records, plus proactively selected early profile
passages. Every character check must explicitly cover identity AND appearance
completeness. Rank/family/background/enduring nature belong in core; lasting
physical details belong in canon locks. Nonempty but incomplete profiles require
source recovery too. No particular story names or ranks are hardcoded. Existing
valid traits, manual fields, prose and earned relationship judgments remain intact.
Character verification values include their physical facts for cross-checking.

The People worker can now return source-backed physical facts in its normal response,
including when there are no event deltas. It checks original stored pages for fetched
quotations and only fills missing locks, preserving existing ones. Existing empty
cores are included in its missing-identity work. Shared reader rules distinguish
stable identity, lasting appearance, current clothes/pose and transient events.

Verification: one focused harness passed once, using the observed lastEvidenceId-only
answer shape. It checks all 160+ entries in the same final review, adequate answer
space, no cosmetic pose change, original-source core/physical recovery, no automatic
quote-to-core writes, normal People recovery of an older-page physical fact with no
event delta, and preserved existing physical facts/prose/earned scores. Controlled
model replies only; no live paid calls, theme tests, gameplay runs or bulk suite.
The capped user snapshot does not expose the whole live story. Do not claim the live
People dossiers are complete until a new report shows what actually landed.

# M698: verify actual ledger entries before green

Version m698-001. The owner explicitly approved publishing this change to the
existing GitHub main branch on 11 October 2026 after the initial approval block.
The owner reports M697 repaired the captain and Commodus and
went green, but its actual saved MC position still contradicts a later stop in
the completed prose. Source-page identity coverage and an empty findings list
were insufficient evidence of semantic ledger verification.

Final review now runs even when the first reading reports no errors. Required
checks enumerate actual scene entries, every People record, Elsewhere seats,
standings, knowledge, locks, bodies, things, threads, factions and rule/World
records, including empty sections for omissions. These values bypass renderer
trimming. Each verdict needs the exact entry fingerprint and a reason; factual
entries need an original source reference/quote, while valid worker judgments
remain their workers' responsibility. No reinterpretation of earned scores.

Every presence verdict additionally supplies the position that should be saved
and an original main-story passage for the last established movement/resting
point. Source ids bind literal prose in code, excluding the opening header.
That position must match the actual final saved entry. A repair verdict only
completes when a relevant change actually lands. Missing, duplicate, open or
stale checks cannot certify green. The model still interprets chronology; an
existing literal passage is provenance, not an automatic proof of meaning.

Review batches contain at most 32 entries. Receipts persist across unchanged
source/ledger snapshots; continuation skips repeated broad searches and model
baseline requests. New entry-review coverage is actual retry progress in both
the checkpoint and scheduler. Outside edits invalidate receipts. World briefs,
referee rulings and fight state also invalidate stale green receipts. The debug
copy includes bounded entry counts, remaining checks and scene evidence.

Scene now treats a quoted MC ending pose through the same path as an NPC pose.
The final quoted here entry supersedes a conflicting draft of that field. It
must quote completed story prose, not an unfulfilled player attempt. Shared
reader instructions explicitly require the last established movement and retain
quiet spectators and unchanged clothing. All normal undo/manual protections hold.

Verification: one focused mock harness, retried once after correcting its fixture's
missing migrated history array, passed. It reproduces an empty first reading that
misses a stopping point, refuses green for an unreconciled final position, then
repairs it through the final review and resumes only unfinished checks. It also
checks actual extractor handling of a quoted MC stop, unchanged prose and earned
scores, stale World brief rejection, and entry-review progress. No bulk/theme/
gameplay tests, browser session, live paid model calls or live saved-story repair.
A passing mock does not establish perfect model judgment. Reload M698 and inspect
the actual live receipt before claiming the owner's remaining position is fixed.
All earlier milestone records remain below unchanged.

# M697: source references instead of reconstructing quotations

Version m697-001. Owner M696 report still has four open targets, all blocked by
unsupported quotation text. Model attempted an evidence-backed withdrawal but
copied the same invented old quotation. This is not a completed ledger repair;
previous generic changes addressed real causes but were partial.

Audit evidence passages now have stable evidenceId references. The auditor selects
an id, and bindAuditEvidence supplies the actual literal source span as shown and
evidence. Unknown ids erase any fallback quote and carry a rejection reason. Same
source-change checks still guard commit. Retrieval ranking locates passages; it
never proves their meaning. Existing fetch/exact-quote answers remain compatible.
Source bank includes current main-scene spans, not only targeted historic evidence.
Historic proposal quotes/references are removed from checklist operations so the
model is not invited to recycle an invalid allegation as source text. System and
repair instructions both specify the reference contract.

Parser separates status repair/open or mutation-bearing resolved rows from actual
withdrawals. A repair cannot close a finding merely by appearing in resolved.
All mutations inherit a parent evidenceId when supplied. Valid references establish
provenance, not correctness; semantic interpretation and final full-ledger/scene
verification remain the auditor's responsibility. No story names are hardcoded.

A descriptor merge into an existing named record may use its recorded role plus a
real source anchor naming that person/descriptor. Unique-role/both-name heuristics
alone could block contextual ordinal roles across stories. Identity merges now
receive provisional verification as Scene writes do. A followup status open for the
merge id withholds that draft; an interrupted followup withholds identity and Scene
drafts. Real records, prose, manual control, earned scores and undo logging remain.

One focused generic fixture, different setting/characters from the owner's story,
passed: reference binding supplies verbatim text, unknown refs rejected, a repair
row in resolved is not a false withdrawal, role merge with multiple couriers is
verified, a disputed merge is withheld and remains open, scene/coat corrections
land, prose and scores unchanged. Mock replies only, not live story verification.
Auditor syntax/diff checked. No bulk tests or paid model calls. Green still requires
actual complete current-source audit with zero outstanding findings.

# M696: repair specific inherited findings from original evidence

Version m696-001. Owner M695 report is paused with 13 pending items. Existing
pause code is not a completed repair. Current guards and Commodus presence already
contradict inherited absence/short-position allegations, while canonical captain
identity and duplicate king repairs are still rejected. MC position still reads
before reaching the wall despite later wall contact in the prose.

Identity repair's identitySource excluded saved World voices even though the audit
quote/sources path included them. Use the same original document set for identity
proof. A possessive descriptor with the same role and equivalent owner name resolves
consistently, e.g. Alexander William's captain and William's captain; preserve the
owner/dependent exclusion and different owners/roles. Source people lookup can use
one complete matching owned descriptor rather than treat its empty duplicate core
as a lost identity. A supported same-owned-descriptor rename into an existing record
retains records; never a blanket title-only merge.

Unfinished audits now first use a focused repair prompt with every inherited finding
id, actual current target records, outstanding identities and proactively selected
ORIGINAL source passages. Ranking retrieves literal spans, not proofs of meaning.
The model must return repairs with status correct/repair/open, shown, why and any
mutations. Parser accepts this contract, preserves repair ids, validates withdrawals
against original documents and leaves unaddressed findings open. Folded summaries
and historical complaint wording must never be presented as original quotes.

The existing followup always performs full ledger and current-scene verification
after a targeted repair, even if the first pass closed all inherited findings.
No new model pass is added to the existing initial/followup flow. Empty issues
alone cannot close old findings; provisional scene writes still require verification.
Compact debug now summarizes operation targets and reasons before long prose and
shows the last followup excerpt rather than always the first reply. Still 24000 bytes.

One focused production fixture passed: same-owner captain alias/merge with complete
identity preserved, distinct owners/dependents/roles remain separate, original World
voice identity proof for king merge, equivalent guard finding withdrawn without a
cosmetic write, missing fur repaired, ending wall position corrected, final verification
and unchanged prose/earned scores. Uses mock model replies, not a live provider or
owner IndexedDB. Auditor syntax and diff checked. No bulk tests. Prior minimal-test
policy remains binding. Live completion still requires actual zero-pending audit.

# M695: stop World recovery from creating new audit evidence

Version m695-001. The owner's actual M694 report still shows an audit loop:
World recovery runs after repeated audits on the same page, writes unrelated
threads/seats and regenerates the saved voices. Those changed voices invalidate
source receipts and reset retryProgress.source. The report's coverage grew to
171 sections with 18 findings; completed attendant/guard repairs still coexist
with historical allegations. The saved MC position also contradicts the later
wall contact in the prose. This is not a successful audit.

finishLedgerAudit now passes only the owed people to worldTurn recovery mode.
Recovery accepts only their whereabouts/review and missing core decisions;
it preserves unrelated lives, threads, World brief and the saved message voices.
Ordinary new-page World simulation remains unchanged. Recovery never reinks the
page. Retry progress follows writer/story text, not regenerated worker voices;
verification still checks the actual saved voices and substantive ledger.

Historical audit checklist now supplies current presence/elsewhere/person records
alongside each proposed target and requires per-id reconciliation. Does not repeat
the same old allegation again as a separate pending paragraph. Inline resolved:true
now retains its finding id. Unknown placeholder attire is neither a repair target
nor allowed to erase known clothing, preventing a corrected position being held
open by a meaningless old dash. Final scene instructions prioritize completed
movement over the opening header and distinguish stable identity from copied action
quotes. No phone-specific story facts are hardcoded or forcibly overwritten.

Focused local fixture checks actual worldTurn recovery with a deliberately overbroad
mock reply: owed person reviewed once, unrelated seat/threads/core/brief untouched,
saved voices/prose unchanged. It also checks stable retry history across worker voice
changes, actual-record checklist, old placeholder-attire closure, supported final wall
position, earned-score preservation and completed verification. This uses mock replies,
not the owner's provider or saved story. Chat syntax checked. No bulk tests.
Published code cannot certify the owner's live story green until its own current
source-bound audit completes with zero pending work.

# M694: evidence access, inherited finding closure and real green status

Version m694-001. Owner M693 report confirms identity recovery landed, but real
repair attempts are blocked and inherited allegations keep accumulating.
M692 introduced an incorrect newest-page-only quote restriction: earlier arrival
or posture evidence remains valid for a quiet spectator unless superseded. Remove
that restriction; the model follows completed chronology in its verification pass.
Auditor quote matching tolerates markdown and typography changes while returning
a literal source span and preserving words, numbers and negation. No invented quote.
World voices saved on messages now join audit source documents and prompt context;
they are labelled as offscreen reports, not automatically local presence. Original
source receipts and stale-source checks include them.

Inherited findings have stable ids, provided in initial and followup prompts.
Evidence-backed withdrawals may use ids instead of reproducing long complaint
wording. Already-satisfied inherited operations are pruned from readingState and
are no longer reintroduced from the original saved state afterward.

Green now additionally requires verifiedInput matching current substantive ledger,
visible source pages (including voices), brief/cast, connections and app version,
with complete source coverage and no open audit work. Auditor stamps successful
completion; any source/ledger change invalidates it and schedules verification.
Blue means workers active. Amber means unfinished, failed or unverified; a paused
repair is failure to complete, never successful resolution. Manual stop/off remains
respected and cannot produce audited green merely because nothing is running.

Compact report still capped at 24000 bytes. Now includes clear verification/pause
status, actual unresolved operations before legacy prose, a small latest auditor
reply, current scene, relevant People and Elsewhere records, and identity recovery
status. Excludes huge undo snapshots; shows story beginning and ending separately.

One focused production fixture passed after useful fixture/implementation iterations:
continuing spectator evidence from an earlier page, markdown source matching without
accepting a negated false quote, World voice document/context, id-based closure,
missing identity repair, current verification, invalidation on open work/ledger/new
page, bounded report and unchanged prose. Chat syntax checked. No bulk/browser/paid
model tests. This proves the tested code path, not completion in the owner's phone.

# M693: repair the reported identity and audit failures

Version m693-001. Actual cause found: findPersonKey used foldName before its
first-word shortcut, turning Alexia's woman into words beginning with Alexia.
Automatic duplicate cleanup then merged the princess into her attendant.
Owner/dependent pairs now remain distinct across name lookup, aliases, source
receipts and automatic rename. A manual explicit rename remains allowed.

Normal state loading performs a journaled people.separate recovery for proven
old automatic owner/dependent merges when the two original cores can be recovered
from an undo receipt or retained exact-name journal writes. Replays subsequent
named writes, preserves manual fields/standings and unrelated state, and archives
the mixed records in identityRecoveries. Does not rewind the full ledger or prose.
If history cannot establish both identities, or later renames/undo make attribution
uncertain, it does not guess. Original-source audit recovery now ignores that bad
merge/alias instead of wrongly treating the owner as already recorded elsewhere.
The old mixed records remain available; thread/thing references still need audit
source interpretation where a bad rename changed their prose references.

Auditor followup now checks provisional Scene changes before saving, replacing
superseded draft fields and withholding drafts if verification fails. It follows
movement through the whole page, not only the earlier quoted action. The prompt
now requires supporting shown evidence for every operation, supplies inherited
repair targets, and requests the actual resolved contract to withdraw disproved
findings. Explicit resolved issues are parsed too. Retry/coverage metadata no
longer disappears when judgeAudit constructs its report. MC persona seat repairs
retain explicit writer identity evidence even if absent from the newest page.

One focused fixture was run during useful implementation iterations. It passed
owner/dependent lookup, rejection of the bad automatic merge, recovery with and
without the short undo receipt, manual data and P/R preservation, production audit
followup correcting an earlier movement to the later wall contact, distinct
attendant presence, closure of a disproved inherited finding, prose preservation,
and explicit persona evidence. No bulk suites, browser run or paid model calls.
Fixture verification does not prove the owner's saved browser data was repaired
or that a model will interpret every future page correctly. Do not claim that.

# M692: visible unresolved status and bounded repair retries

Owner compact report confirmed no running workers with pending audit findings,
and Commodus reworded from at the rail to the rail while old findings persisted.
Lamp now stays amber whenever findings or queued repairs remain; ledgerMark agrees.
Automatic repair persists best pending count and coverage for unchanged sources.
Two passes without improving those best values pause even if ledger text changes;
the existing immediate no-change pause remains. Findings stay open, never green.
Current-scene proposals now need newest-story-page quotes, not any old source.
This verifies quote origin only; it does not prove model interpretation is correct.
Prompt explicitly rejects cosmetic repairs and requires following later movement.
One focused check passed for open work, 1/2/1 recurrence, new evidence reset, and
old/current quote scope. Chat syntax checked. No browser or bulk testing.
Report also shows an OLD merge of Alexia into Alexia's woman and a questionable
Azrael position correction. Neither is safely reversible from this capped snapshot.
Do not claim those saved records are repaired. Source/journal identity diagnosis
remains needed. Historical rejection strings can persist in unresolved findings;
they do not prove the removed old guard is still executing.
Version m692-001. No user story data or manual edits changed by this release.

# M691: compact debug report

Version m691-001. Copy now has a hard 24000 UTF8 byte cap, independent
section budgets, unresolved audit findings first and newest worker runs first.
Raw replies, full memory and brief are omitted. Every ledger category gets a
small excerpt; truncation is disclosed. Source data is unchanged.
One oversized Unicode fixture passed the cap, findings/history retention, secret
redaction and story preservation check. No bulk or browser tests.
M690 report format below is historical and superseded by this compact format.

# Cozy Tavern current handoff

## M690: one copyable ledger debug report

Version m690-001. Ledger debug report sections are available in Workers and audit
findings. Copy collects ledger, pending auditor findings, recent changes, latest
worker results, up to 30 recent run records, brief/cast, six recent story messages
and memory context. It includes a ready written diagnostic request. No model call
or story mutation occurs. Clipboard failure exposes selectable report text.
Known connection secrets and common token patterns are redacted. Historical run
recording starts with this release; old runs cannot be reconstructed.
One focused report check passed, including credential redaction and preservation
of story messages. Drawer syntax checked. No browser or bulk suites were run.


## Next session priority

M689 is published to main at cf9bd4a5c20a4b69b764d686a509a58127e2d6d6.
The owner explicitly approved publication. Live story behavior remains unverified.
Current work is the owner's next specific request, not rerunning M689 verification.

The owner reiterated: no theme tests, long gameplay runs or bulk suites for an
unrelated fix. Default to no tests; only a tiny useful check at a meaningful
milestone. docs/WORKFLOW.md and the PR template now match AGENTS.md. The old audit
checkpoint and bulk workflow are historical records, not instructions.
This documentation cleanup requires no tests or app version change.

## M689, worker context and direct auditor repair

Owner authorized implementation and publication on 11 October 2026 after agreeing
to the pipeline review. Default to no tests; only a tiny relevant milestone check.
AGENTS.md overrides the historical bulk release instructions. Do not resurrect them.

Version: m689-001. See docs/LEDGER-PIPELINE-M689.md for the changes and limits.
People now receives prior pages, detailed record, shared ledger and history lookup.
Scene, People, World and Auditor receive available story essentials and a shared
source and ownership contract. Scene also reads relevant character cores and arcs.
Scene can commit quotation supported presence and posture judgments. The auditor
uses auditorRepairScope in production instead of the legacy prose interpretation
filter, while retaining valid operation, identity, manual edit and stale input checks.

Founder estimates yield to explicitly stated starting digits. Auditor numerical
repairs use explicit digits only on axes without earned history or manual control.
New relationship shifts retain earnedAxes even after their short history rolls off.
World excludes its own earlier writes when determining this page's Scene location.
People and World preserve manual character fields.

Idle repair pauses after a completed pass makes no progress. The saved pause key
includes app version, story sources and ledger contents. New relevant input or an
explicit audit can resume. Unresolved findings remain visible; they are never green
or described as continuing automatically when paused.

Verification: node tests/harness/m689-focused.mjs, five focused scenario groups
passed. Initial execution exposed a local material reference error; it was repaired
and the same check passed. Changed JavaScript syntax was checked. No full suite,
paid model calls, browser walkthrough or access to the owner's actual story.
Do not claim the owner's live repair or every model interpretation is verified.

Previous handoff retained in docs/archive/HANDOFF.before-M689.md. No saved user
story, prose, settings or credentials were modified. Publication details belong in
the final delivery; verify GitHub head after pushing without force.
