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

# M718 source-local identity disposition

Final source candidate review is part of the existing auditor conversation.
Identities:[{sourceId,name,to,kind,why}] binds one extracted mention to an actual
existing person, or assigns its actual nonperson/reference kind. It becomes a
journaled source.resolve operation with metadata undo. It never renames a real
People record or installs a global contextual descriptor alias. Missing actual
individuals receive their source-established profile in the same answer first.

Unbound source mentions carry stable source-local tasks beside actual ledger
entries. Omitted decisions finish through the existing format continuation,
not a new audit loop. A withdrawal alone cannot regenerate the same candidate
next turn; its source decision must be saved. Long page sections with the same
visible label retain independent ids and are resolved together. Legacy findings
are replaced with their scoped versions. Explicit per-source mapping wins over
generic name lookup; no mapping is borrowed from a different source document.
Appearance/identity inventory share the same resolver, including player aliases.

Source ids/marks, original quotations and valid cached receipt coverage remain
stable. Recall hints help source readers identify named subjects before audit;
original source meaning remains model-owned. Policy4 resumes earlier pauses
once without reopening completed unchanged audits. Undo of a source disposition
clears completion. Manual cores, valid judgments, feelings and prose are untouched.

# M717 original source reference protocol

Source review supplies the complete ordered original text as passages with
local ids. The model selects identity/fact evidence references and determines
actual subjects, titles, pronouns and entity kinds. Transport attaches literal
original spans. Canonical labels need not occur verbatim inside every passage;
copying quotations is not a semantic approval requirement. Existing literal
replies and receipt caches remain supported. Selected source references remain
in the People lookup index independently of canonical-label substring matches.
Source ids/marks are stable; no completed section is reread for this release.

Request budgets measure the actual payload, without a second raw copy of the
source. One existing same-conversation correction requests supplied references.
Unknown ids do not certify coverage. Manual fields, actual source changes,
concurrent writes and earned judgments retain their existing protections.
Repair policy3 resumes old paused failures once; completed unchanged reviews
remain factual, not app-version-dependent. M717 adds no extra model call.

# M716 subject ownership and entity corrections

Names in source extraction are candidates until their subject is identified.
Titles containing a homeland must not assign the individual's biography or
appearance to that place. Source kinds preserve provenance and omit nonperson
references from individual recovery and appearance/identity atoms. Existing
source ids, marks and valid cache receipts remain reusable.

People can issue source-quoted entities classifications in its existing turn
answer. people.reclassify archives an erroneous individual record as a place,
organization, object or group and corrects that reference in the current source
inventory. It is journaled and undoable. No actual prose or manual/player record
is removed, no similarly spelled individual is selected for removal, and no
name-specific detector is added. The final auditor can make this same explicit
semantic decision. A kingdom is not an alias of its prince. Recovery complaints
close from the actual classification and preserved source review.

People can correct an existing wrong physical value with a literal original
quote, replaces matching its currently saved value, and a cause explaining the
correction after considering chronology. Missing values need no replaces. This
does not authorize overwriting manual facts, earned feelings or alternate faces.

Synthetic empty People rows must not change fact attribution during review.
The final verdict already covers its approved repairs and their actual new
rows. Corrected source classifications survive rehearsal and commit. A repair
policy revision can resume old paused failures once without invalidating any
completed unchanged audit; same-policy failures remain bounded.

# M715 source recovery and audit persistence

An incomplete original-source answer gets at most one precise correction in
the same source reading. Keep already accepted source receipts. Only unfinished
source ids are requested again; exact original quote and identity/appearance
requirements remain. Persist bounded source ids and rejection reasons in the
debug report. Unsupported or omitted evidence stays unfinished.

A previously approved ledger needs no new combined review during source-only
recovery if originals match and every actual semantic row remains approved.
Newly recovered profile facts, changed values, changed scope or real findings
still require authoritative review. Completion keys are tied to factual inputs
and the audit contract, not app releases, providers or housekeeping timestamps.
M713/M714 legacy keys require proof from ordered original hashes, writer roles,
writer authority and matching entry receipts; subsequent releases retain that
migration. Reopening completed unchanged stories must not summon opening heal,
chain replay or idle audit. Actual new/edited content remains eligible. Never
certify unreviewed work or hide a genuine unresolved source behind green.

# M714 ledger foundation milestone

The persistent ledger and the storyteller's selected view are distinct.
Named absent people carry saved physical facts and selected knowledge without
changing physical presence. Open obligations and stored facts are selected
by scene relevance with recency fallback. Unshown facts are not erased or
proof of ignorance. The final complete request reserves answer space and fits
its named context using a conservative estimate, preserving the current move,
latest exchange and instructions. Source recovery retains existing chunk ids,
marks and receipts, packs by actual room and shrinks truncated groups.
World input sections have one authoritative copy. One pendingWork deadline
covers the chain wait. Idle review respects the chosen frequency while initial
recovery and unresolved findings remain autonomous. The authoritative auditor
still completes factual verification; model work and live data are not certified
by a local mocked fixture. Details: docs/LEDGER_FOUNDATION_M714.md.

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

# M697: bind selected evidence to literal original source text

The auditor may select a supplied evidenceId rather than reproduce quotation text.
The application binds it to that exact original span; unknown references cannot
fall back to a made-up quotation. Meaning still requires source interpretation and
final verification. Mutation-bearing repair/open rows never count as withdrawals.
Verify provisional identity merges and withhold disputed/interrupted drafts.
No character-specific repair exceptions. Minimal owner verification policy applies.
See HANDOFF.md for actual measured scope and remaining live-story uncertainty.

# M696: unfinished audits must repair each finding from original sources

Use focused per-id repair decisions with actual current records and original source
passages, then full-ledger/current-scene verification. Never pass a folded-summary
paraphrase as an original quotation. Include saved World voices in identity proof.
Resolve the same owner and same possessive role consistently while preserving the
owner/dependent exclusion and distinct roles/owners. Keep unaddressed findings open.
Maintain owner minimal verification policy. See HANDOFF.md for measured limits.

# M695: repair recovery must not manufacture another story turn

An audit recovery reviews only owed World decisions at the same story hour.
Preserve saved voices, completed unrelated lives, threads and the existing World
brief. Never replace the source page as a side effect of its own repair.
Retry history is bound to story/brief changes, not regenerated worker voices;
green verification remains bound to all actual source and ledger content.
Present historical allegations alongside actual target records and reconcile each
finding id. Unknown attire placeholders must not block closure or erase known clothes.
Owner minimal testing policy remains authoritative. See HANDOFF.md for measured limits.

# M694: completed audit is required for green

Green requires completed source coverage, zero unresolved audit findings and an
audit receipt bound to the current ledger and source snapshot. Idle or paused is
not verification. Earlier continuing-scene evidence and saved World voice records
are valid sources; interpretation follows completed chronology. Reconcile inherited
claims by stable finding id and prune actual satisfied operations. See HANDOFF.md.
Owner minimal testing policy remains authoritative.

# M693: identity separation and auditor repair verification

Keep owners distinct from their dependent descriptors in automatic name resolution.
Recover proven old merges from saved history without rewinding other records.
Archive mixed data, preserve manual fields and earned judgments, and require source
review where history cannot establish attribution. Verify tentative scene corrections
against the complete page using the existing followup. An explicit evidence-backed
withdrawal closes a mistaken inherited finding. HANDOFF.md records measured limits.
Owner testing policy in AGENTS.md applies; no bulk release gates.

# M689: shared ledger knowledge and authoritative factual repairs

Current owner request supersedes older testing mandates below. Improve the whole
ledger path: context, first reader decisions, save ownership, explicit baselines,
auditor authority and termination of unchanged retries. Preserve worker judgments,
manual edits, history and story prose. Use only minimal milestone verification.
Implementation and limits: docs/LEDGER-PIPELINE-M689.md.

Previous milestone specifications follow as historical records.

# M688: auditor evidence matches its repair contract

The reported M687 app still rejects Alexia's actual gallery arrival and current
ankle/pronoun passage, the maid's latest posture, and an explicitly established
MC persona's false elsewhere seat. Repeating a proposal cannot fix a guard that
misreads its valid evidence. Correct the acceptance contract rather than hiding
unfinished work or removing source protections.

1. Presence persists after an actual arrival while later departures, death and
   scene moves still win. Recognize the reported bodily possessive and bind an
   exact source quote to its own person, including a quote supplied on the finding.
2. Posture, attire and source-backed People state use that person's latest own
   narration, not a later incidental mention by another actor. Keep quotation
   evidence through normalization, rehearsal and commit. A saved later field
   supported by a pronoun continuation cannot be replaced with an earlier moment.
3. The writer's explicit MC persona fact can clear that persona's false separate
   elsewhere seat. Do not rename the MC, merge unrelated identities, infer a
   persona from intentions, or erase another person's whereabouts.
4. Close saved findings only after real repairs or established satisfaction,
   following durable completed merge aliases. A legacy persona seat concern with
   no operation may close after that actual seat clear; unrelated concerns remain.
5. Reproduce the reported forms through auditLedger and the real app's saved
   backlog. Show old failures, corrected state, unchanged story text, actual green,
   idle completion and completion after reopening. Preserve all standing checks.
6. Align prompt examples and guards, record concrete rejection reasons, and explain
   the Housekeeper's different edit path. Qualify and publish m688-001, without
   claiming that scripted verification proves the owner's live ledger is repaired.

# M687: supported scene repairs finish

Jovan's auditor repeatedly rejected the same salle corrections for ten minutes:
gallery spectators were missing, old postures remained, and Kelstrum's original
titled identity was restored and merged again on successive passes.

1. Check each person's latest evidence throughout the newest scene, including
   spectators before a long fight ending. Preserve later departures, deaths,
   scene moves, quoted reader decisions and hand written fields.
2. Original source recovery follows actual reversible identity merges, including
   old saved journal entries and cast names. Receipts preserve their original
   quotation and remember its current ledger identity without recreating aliases.
3. A unique named role can be merged using source evidence, including the reported
   "Lord Marshal Kelstrum" title. Ambiguous roles and the main character retain
   their identity protections.
4. An already cleared elsewhere note is satisfied work. Compact reworded findings
   by repair target and field, preserve unrelated facts and fields, and close old
   proposals only when their repair lands, the saved state satisfies them, or
   source evidence disproves them.
5. A saved backlog completes through automatic idle recovery, returns to green
   and stops requesting audits. Reopening retains completion. No new story turn
   or manual ledger edits are required; explicit Stop remains respected.
6. Review actual context supplied to Scene, People, World and Auditor. Record the
   shared state, brief and plot text, record and page routing, lookup capabilities
   and context limits accurately in docs/WORKER-CONTEXT-M687.md. Do not claim that
   every reader currently receives everything or that all contexts are optimal.
7. Preserve histories, source authority, undo, backup and upgrade behavior. Use
   scripted providers and disposable stories; verify the stable release before
   publication without accessing the owner's phone or spending model credit.

# M686: autonomous ledger recovery

Detected ledger problems are work the application completes automatically. Opening
an existing story starts original source recovery without an audit button. An
unfinished audit or transient provider error schedules its next idle attempt from
saved work, without another story turn and without a terminal retry count. Completed
work stops retrying. Background recovery yields to storytelling, respects explicit
Stop and disabled agents, and preserves concurrent source and ledger writes. Its
status describes automatic repair rather than handing the writer a Finish it task.

# M685: complete ledger audit recovery

Jovan asked for a real audit across Scene, People, World and Books, especially the
missing Princess Alexia and auditor proposals that failed without fixing the ledger.

1. Recover missing identities from exact original answered source quotations, even
   when folded summaries and every surviving ledger book omit them. Cache source
   receipts by content. Historical identities do not invent present whereabouts.
2. Give blocked proposals their actual reason and one bounded correction attempt.
   Preserve useful work, carry unfinished findings across later audits, and require
   a matching repair or an evidence backed withdrawal before closing a concern.
3. Permit evidence backed corrections to wrong current mood and state, and missing
   personal promises. Preserve manual edits, source authority, page endings, deaths,
   journal replay and earned relationships.
4. After identity restoration, run any owed world review in the same audit job using
   the configured world worker, without a new story turn or invented elapsed time.
5. Keep source and state changes during model calls safe. Interrupted readings retain
   completed source work and report the remainder as unfinished.
6. Verify the actual audit button, all existing ledger regressions and release gates.
   Record the complete section audit and exact results in docs/LEDGER-AUDIT-M685.md
   and audit/results/m685.json. Preserve the original histories and canon copy.

The earlier specifications remain below as release records.

# M684: one coherent ledger

Jovan's October 10 report: people introduced in his input vanish from the scene
and People; a wrong name is deleted instead of corrected; the world stays hours
behind; the Books panels do not explain what happened or why.

Acceptance criteria:

1. Read the writer's established facts and physical actions as well as the reply.
   Keep nearby participants, quiet people and named introductions; do not bring in
   people merely discussed, imagined, remote, departed or shown in a world cut.
2. Preserve exact names and roles from the source. Open a person's page when the
   writer establishes them, including absent people. Do not invent a surname or rank.
3. Auditor identity corrections rename/merge through the existing reversible door,
   preserving presence, facts and history. A rejected replacement must not leave
   only a deletion applied. Reports distinguish complete, partial and blocked fixes.
4. Advance the absent by story time. Require explicit review of overdue people,
   including an explained decision to stay. An omission or failed call must never
   masquerade as a completed simulation or an invented departure.
5. Books show the change, cause, source and page where available. Preserve undo,
   page replay, originals and earlier audit work.
6. Prove failures with realistic scripted inputs through public doors and the app.
   Keep existing regressions and budgets; use focused checks during development,
   then the broad release checks once the implementation is stable.

The prior M683 specification remains below as a release record.

## M683: faster checks, smaller session context, and the academy at night

This milestone implements Jovan's seven requests from October 10, 2026.

1. Keep every existing regression assertion and performance budget. Add fast,
   release and full check profiles, measured durations, reliable exit status,
   and safe resume for unchanged functional checks. Performance measurements
   run alone. A fast result must never be presented as the full release gate.
2. Preserve the original AGENTS and HANDOFF verbatim in docs/archive. Keep
   HISTORY intact and append new results. The active instructions and handoff
   are short and direct sessions to relevant source and historical sections.
3. Remove the shipped Female Vocal Acoustics restriction from the active craft.
   Old untouched copies follow the new builtin. Read edited copies without
   that exact retired line, retaining every other word and the stored original.
4. Re-proposing an unreadable housekeeper block retires its old warning only
   when that explicitly retried block has a valid replacement of the same
   kind. Refused and stale proposals can be explicitly withdrawn. Superseded
   and stale notices leave the visible conversation; saved turns and raw
   answers remain intact. Unrelated failures and unsuccessful retries remain.
5. Academy story and composer share one continuous reading background. Text,
   caret, placeholder and buttons remain readable and controls behave as before.
6. Add a separate academy night choice. Reuse the original local map and type,
   with moonlit blue grounds and warm amber lights. No network assets, new
   animation work, or motion behind an open story. Respect reduced motion.
7. Document one clear contribution and validation workflow, a concise current
   handoff, and GitHub issue and pull request templates. Preserve all prior
   audit commits and reconcile remote main before publication.

Verification includes causal housekeeper/prompt regressions, the real UI resend
flow, day/night visual inspection, actual pixel contrast and existing academy
performance budgets, the full harness/walk, and the release profile. Additional
full-profile checks run when their dependencies change, not after documentation
edits. No test suite is a proof that all possible bugs are absent.

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


# M709 current revision: optional provenance cannot silently drop writes

Version m709-002. Final review of the legacy physicalFacts adapter found that
it still discarded an explicitly requested appearance write without an id or
quote. That extra transport requirement is removed: key/value create the
logged proposal under final auditor authority. No fabricated evidence is added.
The one targeted fixture was rerun only after this runtime fix,0.14s,passed,
including the new no-provenance adapter case. This is not a publishing retest.
All M709 authority, ownership, concurrency and live-verification limits below
remain. Both M709 revisions were normally published under standing permission.



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

