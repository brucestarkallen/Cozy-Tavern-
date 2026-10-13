# M745: source repair before Essentials

## Confirmed failure path

`runEssentials` correctly rejected record lines whose saved page ids or content
versions no longer matched the visible originals. It saved that result as
`blocked`. `essentialsRecoveryState` then treated a blocked candidate under the
same Essentials policy as ineligible, and `essentialsHealth` cancelled its
retry timer.

The keeper did not repair the prerequisite because its health route and
`recordGap` used `dueRange`, which checks only whether page indexes are covered.
A record can cover every index while one covered entry has a stale source
binding, so neither the keeper nor Essentials made progress. M744 also changed
spans during delete, insert and rewind operations without consistently updating
source receipts, creating another way for those checks to disagree.

The code path and scheduler defect are confirmed. The owner's database was not
opened, so the specific cause of the saved mismatch in that story is unknown.
It may be an edited page, a branch copy, a structural change or another stale
receipt; the implementation now distinguishes these cases from current data.

## Repair

`sourceBindingIssues` in `js/assemble/selection.js` is the shared validity check
for Essentials and the keeper. The keeper's existing `maybeSummarize` queue path
calls `repairInvalidRecordSources` for only the entries with invalid bindings.
Exact copied pages are rebound only after original-row equality is proven.
Unchanged source groups with stale spans move to their proven current range.
Edited, reordered or unavailable pages use the existing `redoLine` or
`rereadMergedLine` keeper paths. Rewind tails use `memoryTruncatedAt`; deleted,
inserted and truncated manual lines retain their words while their old page
receipts are preserved as provenance. Generated text kept while the keeper is
off stays source-invalid, so it cannot make an Essentials snapshot current.

`recordBehind` and `recordGap` now include source-binding issues as well as
missing page ranges. The ordinary idle keeper route repairs the record, then
the existing health route resumes Essentials. Source changes, queue ownership,
the keeper switch, another browser, Stop, manual entries and the existing
atomic Essentials publication checks remain in force. Essentials policy
advances from 4 to 5, making older M744 blocked candidates eligible for this
repair path without resetting unrelated ledger approvals or completed sections.

## Focused verification

`tests/harness/m745-source-repair.mjs` passed with production memory and storage
modules, disposable IndexedDB and simulated provider replies. It repaired an
edited source line and a promoted line, rebound an exact branch copy and
unchanged relocated metadata without a model request, retained unrelated
manual text, classified deleted/reordered/rewound and legacy entries, and
confirmed a deliberate Stop leaves the record unchanged.

`tests/m745_essentials_source_repair.py` passed in Chromium with disposable
IndexedDB and simulated streamed provider replies. Starting from a complete
range-covered record and an M744 policy-4 blocked Essentials candidate, the
normal story-open scheduler repaired the changed source line, generated and
saved a complete Essentials under 16,000 characters, cleared pending state,
made the summary available to `buildRequest`, displayed it in the drawer, and
settled health green. Reopening the unchanged story made no further provider
request. The fixture also preserved an unrelated hand-edited record line.

The existing M744 Essentials module and Chromium recovery fixtures passed as
well, covering retained accepted snapshots, request-limit continuation, Stop,
and publication. JavaScript syntax and `git diff --check` passed. All provider
replies were simulated. There were no live model calls, no access to the owner's
browser database, and no deployment. The test establishes the code path in
disposable storage, not recovery of the owner's saved text or live model
compliance.
