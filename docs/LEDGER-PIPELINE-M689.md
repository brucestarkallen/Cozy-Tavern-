# M689 ledger pipeline review and repair

## Findings from the actual production paths

1. Scene reads brief, cast, history and ledger but its heuristic acceptance could
   override its own final scene judgment. People lacked prior pages, record and
   lookup. Scene did not receive the character view used to interpret scores.
2. World and People reload shared state before committing through the journal.
   World followed Scene in the existing queue, then People, then Auditor. No new
   parallel writers or agent discussion loops were introduced.
3. World treated its own earlier same page seat as though Scene had assigned it,
   restricting a subsequent legitimate simulation. Its source filter now excludes
   world writes when protecting Scene's assigned location.
4. Founder skipped explicit digits when it already had a model proposed score.
   Auditor mostly repaired zero standings and could miss a wrong nonzero baseline.
5. Auditor could read valid evidence but reject it using subject, body word,
   ending and posture matching heuristics. Rehearsal and commit ran that filter.
6. Idle recovery had backoff but no termination for unchanged semantic failures.
   Worker copy claimed automatic repair even while identical requests failed.

## Changes

Shared ledgercontext supplies source hierarchy and worker ownership instructions,
plus available story essentials. People gets the detailed record, prior unfolded
pages, shared ledger and the same fetch mechanism as other readers. Scene gets a
relevant character view. Existing brief, cast and canon routes remain. Summaries
are marked as summaries and do not override later evidence. This is shared relevant
story knowledge, not a byte identical copy of the storyteller's writing prompt.
No claim is made that every craft, lore or module instruction is initially present
in every worker call. Existing source budgets and complete history lookup remain.

Scene accepts its final here entry with a real supporting quote and preserves that
quote for posture and attire. Legacy response shapes keep their fallback path.
Auditor production uses a simpler repair contract: supported operations, a real
source quotation, explicit user protections and existing identity checks. The AI
interprets the evidence. The old auditorScope export remains for compatibility,
but production no longer runs it or the separate departure keyword filter.
A quotation check proves source availability, not the truth of an interpretation.
The shared prompt requires factual contradictions, not competing worker opinions.

Numeric auditor suggestions cannot replace Scene's judgments. Explicit starting
digits are reconciled axis by axis only where no earned development or manual
control exists. Founder applies those digits before the first save. Unstated axes
are not manufactured as zero by the model response validator. New shifts keep
persistent earnedAxes; legacy histories are still consulted. Old histories already
truncated before this release cannot be reconstructed automatically by that flag.

All actual repairs still use applyMutations, journal, undo and fresh state reload.
Source changes during an auditor call still invalidate its result. People and World
respect manually owned character fields. No story prose or saved user data was
edited during this work.

After an idle audit and followup fail to make progress, the scheduler saves a pause
fingerprint and stops unchanged requests, including after reopen. Open findings
remain amber. Changed pages, brief, cast, ledger state or app version invalidate the
pause; explicit audit also runs. Transport failures retain backoff. This is not a
claim of completed repair. No separate agent message board was added.

## Minimal verification and limits

One standalone scripted milestone check: tests/harness/m689-focused.mjs.
Five groups cover Scene presence/posture, public auditLedger save and completion,
explicit starting values, earned/manual values, People context and lookup contract,
retry fingerprint behavior and the public founder initialization path.
The first run caught an accidentally removed local variable in housekeeping. After
restoring it the same check passed, in under one second. No bulk suite was run.
A syntax check covers changed JavaScript modules, including UI wiring.

The scheduler fingerprint was checked directly; a timed browser reopen walkthrough
was not run. Provider replies were scripted. Actual model accuracy and the owner's
live phone/story remain unverified. Existing World prose heuristics outside the
identified source ownership bug remain and may deserve a later targeted review if
real output demonstrates another failure. This release is not proof of perfection.
