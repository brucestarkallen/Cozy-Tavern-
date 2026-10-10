# M686: autonomous ledger recovery

The owner's contract is a plug and play frontend. Detected ledger faults belong to
the application's repair cycle, not a list the writer must finish manually.

## Confirmed gap

M685 saved incomplete audits and exposed an Audit the ledger resume action. The
existing autoFinish helper only covered record and People rebuilds and summarizing,
with three attempts. It did not resume ledger audits. Page audits ran again on later
turns, but an idle existing story had no automatic full source recovery. Persisting
unfinished findings was necessary bookkeeping, not a complete recovery mechanism.

## Change

The ledger now detects incomplete source coverage, unfinished saved audit findings
and failed auditor runs. While the active story is idle and its page readers have
settled, it starts a full original source review through the existing auditor. Each
pass retains completed work and uses the current story and configured connections.
Owed world work follows in the same repair job. A disabled world worker does not
create an impossible world task, and a recovered world run updates its worker status.

An unfinished pass schedules the next pass itself. Progress resumes after a short
pause. Repeated unsuccessful readings wait one, two, four, then at most five minutes
between attempts. There is no terminal attempt count. These pauses let the connection
recover and leave the story responsive; they do not switch models or reduce the
information the auditor reads. Source receipts avoid repeating completed source work.
Reopening uses saved audit state and coverage to resume without pressing a button.

The normal pause is fifteen seconds. A new story turn interrupts an idle repair
through the existing background reading cancellation mechanism. The queue attempts
an idle job once, releasing its lane during the wait for the next scheduled pass.
Source changes, story switches, replays, other browsers, explicit Stop and disabled
agents retain their existing authority. A stopped partial page is not accepted as
a completed scene. Completion stops the repair loop. The Books worker row describes
automatic repair, and the auditor no longer gives the writer a Finish it button.
The scene indicator cannot call an unfinished audit complete.

## Evidence

Seven new real app scenarios cover opening recovery, more than three failed passes,
completion stopping the loop, explicit Stop, an off switch, transient provider
failure, yielding to a real new story turn, the removal of Finish it, and stopped
partial pages. Four fail on published M685; three preservation controls pass there.
All seven pass on the new code. One development fixture initially let the previous
story's generation outlive cleanup. Waiting for its turn and readers to settle fixed
the fixture without changing the stopped-page assertion.

The existing manual audit recovery and Stop scenarios also pass. The focused profile
passed six checks in 26.79 seconds. Full release verification is in progress; results
will be recorded in audit/results/m686.json before publication.

## Continuity

Earlier source recovery, repair guards, scene simulation, People, World and Books
changes remain. HISTORY is append only; instruction archives and the canon vendor
copy remain intact. Tests use scripted model responses. Existing stories start
recovery automatically when opened after updating; no initial audit button is required.
