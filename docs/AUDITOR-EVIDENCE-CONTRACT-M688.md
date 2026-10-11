# M688: valid evidence survives the auditor repair path

The owner confirmed the app was running M687 and supplied the same unfinished
turn 33 ledger. M687's test passed, but it did not cover the actual bodily
possessive, earlier arrival quotation, maid continuation, omitted quotation and
MC persona forms in this report. The previous claim that the reported loop was
fixed was too broad. M688 reproduces those forms through public `auditLedger`
calls and through a saved backlog in the real app.

## Concrete causes

* `Alexia's hooked ankle ... She was leaning forward ...` was not recognized as
  bodily presence. The possessive guard knew knees and feet but not ankles.
* M687 required a presence quotation to match the person's latest named account.
  An actual arrival became unacceptable after a later seated pose. Presence
  persists unless later evidence establishes departure, death or a scene move.
* A later reference such as `Commodus turned his head toward Garett` displaced
  Garett's own posture evidence. It says what Commodus does, not Garett's pose.
* The documented posture operation omitted `shown`, while recovery needed that
  quotation. Some models copied it onto the finding instead of the operation.
* Normalizing a posture repair dropped its quotation. A maid correction accepted
  in rehearsal could then fail the same guard when carried through commit.
* The guard interpreted Jugram's separate elsewhere record as another absent
  person even when the writer explicitly established him as Azrael's own persona.
* Older findings could remain unfinished after a real seat clear or identity
  merge, including a persona seat concern saved without an operation.

These are acceptance and repair contract defects. Yellow meant saved unfinished
work; repeated attempts could not overcome the same misread evidence. The patch
does not force a green status or disguise genuinely unresolved findings.

## Resulting behavior and retained protections

Arrival evidence can precede a later pose. Current posture, attire and People
state use the person's latest own narration on the newest scene, with immediate
pronoun continuations. Typographic apostrophe and dash differences do not change
the words of a scene quotation. Exact durable identity receipts remain strict.
The existing plural lower case role seat can use singular field evidence only
when no competing role holder exists; this never invents arrivals or new people.

An exact quotation on a finding can supply an omitted `shown` only when bound
to the operation's target. Another person's arrival cannot move a watcher from
her established elsewhere room. Quoted speech, departures, deaths, scene moves,
the main character's header, written fields and ambiguous identities retain their
guards. An older half of a whole quotation cannot replace a later supported
saved pose or People state. Malformed proposal names cannot crash these checks.

The writer's explicit persona identity, drawn from the brief, cast notes or
visible writer pages, can clear the false separate elsewhere seat. Intentions,
questions, hypothetical statements, other owners and possessive relatives do not
qualify. This correction does not rename the MC, register a new general identity
merge or delete other records. It repairs the false seat described in the report.

A completed durable merge alias lets an old presence finding follow the real
canonical seat. A legacy no-operation persona seat finding closes only after
that actual seat clear; unrelated old identity concerns remain pending. Rejection
messages identify missing arrival evidence, unsupported current fields or a
proposed return to an earlier moment. Prompt examples now request the evidence
that those guards accept and use `people.rename` for duplicate identities.

## Why the Housekeeper differed

The Housekeeper uses its own repair plan and drift checks, then applies explicit
edits through `applyMutations` with hand edit flags. It does not use `auditorScope`.
The automatic auditor uses that additional source acceptance filter before
rehearsal and commit. This explains why a Housekeeper edit could succeed while
the same established fact was refused in the automatic path. It does not establish
that every Housekeeper decision is necessarily correct.

The reader context review remains in `WORKER-CONTEXT-M687.md`. Scene, People,
World and Auditor share saved ledger state through ordered reads and writes.
Their context builders are not identical: in particular People lacks older
unfolded pages, folded record and lookup. No new claim that every context is
optimal or receives everything is made. The auditor already had the current
page in these reproductions; its guard misread valid evidence.

## Verification

The final 23 new public auditor laws run against the unchanged published M687
product: 15 fail and eight preservation controls pass. The corrected candidate
passes all 23 and 130 nearby laws, 153 selected out of 1540 total. The corrected
final development profile passes six jobs in 31.17 seconds, including 136 selected
harness laws and 15 selected app scenarios. Selected checks are not the full gate.

The new app case fails on M687 and passes on the fix. It loads 36 saved proposals
and two legacy concerns, uses the full five cell header and the reported evidence
forms, verifies real presence and posture changes, preserves Azrael's name and
the exact original page, clears the false persona seat, merges the marshal seats,
and checks green, no more idle calls and completion after reopening.

Execution checkpoint: `ef8210f19eefadc6f923afc0dcfd7bdba253e71c`, version `m688-001`.
The first full release stopped after M594 found an omitted existing prompt rule.
That rule was restored without changing its assertion. No successful checks are
reused after this executable change. The final M688b release passed all 33 jobs in
1730.08 seconds, with an unchanged
source/runtime fingerprint and ALLDONE. Full harness: 1540/1540; app walkthrough:
306/306; long play: 9/9; lint: zero errors. Results are preserved in
`audit/results/m688.json`. Publication verification is pending.

All tests use scripted providers and disposable stories. No paid model calls or
access to the owner's phone or live story are involved. Completion on the owner's
device therefore still depends on loading the updated app and letting its
automatic repair run; no manual ledger changes are required. The tests do not
prove zero possible bugs or every possible model answer correct.
