# M743 implementation report

Status: VERIFIED for the focused code paths. The owner's live story remains
IMPLEMENTED BUT NOT FULLY VERIFIED. No access to its current IndexedDB, exact
original chandler receipt, complete 31922 character draft or provider trace was
available in this handoff. Publication does not prove live completion.

## Confirmed causes and limits

Essentials accepted at most 16000 characters while workerConnection treated
5000 output tokens as a floor, retaining a larger configured allowance. M742
already performed two draft revisions. Persistent oversized answers exhausted
that round, and recordParts divided only by input room. A fitting input therefore
had no smaller source repair path for output failure. The production transport
fixture used a configured 32000 token allowance and three simulated 31922
character replies, exercising both real revision conversations. The exact live
input size, effective configured allowance, revision availability and finish
reasons cannot be recovered from the reported final rejection alone. Latency was
not established as a cause, and the fixture does not imply that the provider
actually ignored a newly requested output ceiling.

The quoted chandler fact is a literal substring of the quoted saved core.
With a valid source binding and complete receipts, M742 can already close that
exact pair. It is not an intrinsic determiner or biography size problem.
A production reproduction showed a different concrete failure: a saved source
fact complaint with sourceId and canonical name but no extracted sourceName
cannot select the original row named "the chandler's boy", despite its explicit
binding to "a chandler's boy". It remains unfinished after the ledger is approved.
The unchanged M742 baseline fails that reproduction; M743 settles it with zero
provider calls. Parsing and resaving failed model complaints also discarded
source metadata. These are verified code defects, but the handoff does not
prove which metadata was present in the owner's actual saved finding.

Unresolved source fact tasks were excluded from the required source decision
contract. They now participate in the existing review with their originals and
actual profile. A completed semantic verdict persists its decision only for the
reviewed source/profile scope. A concurrent edit cannot borrow that approval.
Explicit open decisions remain open on the next audit as well.

repairRetryCheckpoint retained the historical bestPending=0 when new factual
work appeared. New work could never improve that minimum. UI scheduling could
also pause after one no change pass independently of the checkpoint. Work
identities, saved decisions and closures now establish progress, while two
repeated stalled runs still pause. Policy9 resumes old paused failures once;
completed factual reviews retain their version independent receipts.

## Changed production code

| File | Functions and purpose |
| :--- | :--- |
| js/agents/auditor.js | auditLedger, findingSettled, unresolvedFindings, bindHistoricalFindings and restoreSourceFactFindings preserve/recover unique source bindings, review facts, persist decisions, and retain uncertainty |
| js/agents/auditprogress.js | repairRetryCheckpoint recognizes discovery and real closure; LEDGER_REPAIR_POLICY advances once to9 |
| js/agents/essentials.js | runEssentials, tellPart, sourcePrint, essentialsRepairMessages and helperPrintOf enforce request allocations, retain revisions, partition failed sections and persist completed leaves |
| js/agents/call.js | workerConnection and callWorkerOn accept an explicit request output ceiling; other worker allowances are unchanged |
| js/ui/chat.js | existing idle audit scheduling consumes the factual progress checkpoint and pauses after two stalls |
| js/version.js | m743-001 |

Essentials partitions near the chronological midpoint without clipping source
text. A folded node can split at record line or paragraph boundaries, retaining
its original id/span and source offsets. An indivisible passage remains pending.
Child character shares plus joining newlines cannot exceed their parent's share.
Each accepted leaf is saved before the next call. The source, setup, connection
accounting and allocation must match before reuse. Changed originals cannot
reuse a stale draft or leaf. Successful combined save clears pending state.
Maximum12 worker requests per round and four subdivision levels bound costs;
existing transport/fallback retries and cooldowns remain. Always thinking floors
and configured reasoning are preserved. Storyteller context is not enlarged.

## Verification executed

All checks use production modules, simulated SSE/provider replies and disposable
IndexedDB fixture storage. No live provider costs or user browser data access.

1. tests/harness/m743-auditor.mjs passed source label restoration, zero call
   cached closure, equivalent wording persistence, reload, source/profile
   invalidation, genuine missing fact additive repair, distinct identity,
   existing local groundkeeper receipt, manual/concurrent preservation,
   uncertainty across repeated audits, honest health and bounded progress.
2. tests/harness/m743-essentials.mjs passed the31922 character rejection against
   16000, both draft revisions, two smaller chronological requests, all13 source
   receipts and the final correction. Accepted simulated text was1833 characters.
   Folded source identity, full source/detail transport, incomplete page range
   rejection, prior text preservation, cooldown, one request partial resume,
   changed source isolation, pending cleanup, green after saved completion,
   indivisible failure and unchanged connection/reasoning controls passed.
3. Existing tests/harness/m741-essentials.mjs passed recovery, queue/status,
   cooldown, partial resume, cancellation and manual preservation with the new
   bounded request count. Its all failing round now permits12 requests; the
   heavily subdivided fixture recovered in5. This differs from a single failed
   newer section, which needed1 request in the M743 fixture.
4. Existing tests/harness/m742-essentials-length.mjs passed both direct revisions,
   the33851 character draft,6302 character accepted output,49 source receipts,
   persisted indivisible draft resume, source isolation and context guarding.
5. Existing tests/harness/m732-identity-contract.mjs passed existing/new/local
   decisions, rejected targets, bounded correction, reload, cached approval,
   health and undo with policy9.

The new Auditor fixture first exposed fixture normalization differences; it was
corrected to model saved records before comparing receipts. The partial transport
fixture expected one fetch, but the existing provider correctly retried it once;
that expectation was corrected. Folded sections share their original page span,
so their simulated output uses that supplied range rather than invented subspans.
Old recovery expectations were updated for the intentional bounded partition path.
JavaScript syntax and diff whitespace were checked. No broad suite or browser run.

Original prose, memory nodes, manual fields, scores, local identities, source
marks, receipts, journals and existing undo mechanisms remain intact. There is
no global descriptor merge, source rescan, new judgment worker, dependency or
storyteller critical path call. Green still requires current saved completion.
An earlier failure does not override a later matching saved completion.

Structural source coverage cannot prove every subtle story meaning survived.
A noncompliant model or memory capacity conflict remains honestly pending, with
previous usable Essentials preserved. Exact live resolution still requires an
observed completed audit and Essentials update in the owner's story. Git commit
and confirmed remote publication are reported in the delivery message.
