# M687: the auditor can finish the reported scene repairs

The owner's turn 33 report was not normal progress. Original source coverage was
67 of 67, but quiet spectators and witness postures kept failing acceptance while
the auditor continued automatically. The same titled marshal was restored and
merged again, and differently worded refusals accumulated as separate findings.
The yellow indicator accurately represented unfinished work; the work itself was
stuck. Dialogue proportion concerns in that report were reader notes, not evidence
that a story page had been rewritten.

## Cause and resulting behavior

The auditor received the newest page but its acceptance check relied on the page's
last paragraphs. A long ending about the duel excluded earlier, still current
evidence about Alexia in the gallery, her woman, Commodus at the rail, and the
witnesses. A Scene reader omission could then block the auditor from correcting
that omission. M687 follows the latest named evidence for each person throughout
the newest scene, including immediate pronoun continuations. The proposal must
quote that evidence. Later departures, deaths, changed poses, scene moves and
protected hand written fields still win. This extends the auditor's recovery
check; it does not change the other readers' general arrival rules.

A final regression exposed a full header variant: its fifth cell is the main
character's pose, not the room shared by spectators. The recovery check now uses
the page's actual place and requires an exact quotation for this exception. The
real app regression includes that full five cell header. Existing checks that keep
people behind when the main character leaves still pass.

Original source receipts now follow actual identity merges. New merges preserve
durable aliases; older M686 merges are followed through the saved journal and
remembered source receipts. The original source name and quotation remain intact.
Saved cast names also follow those completed merges. Thus reviewing the original
"Lord Marshal Kelstrum" introduction does not recreate a second People page after
it was merged into Kelstrum. A descriptor merge still requires one source named
owner, and cannot automatically rename the main character. The regression uses
the owner's exact sentence, including the period after Kelstrum.

Saved findings are reconciled against the actual saved ledger and compacted by
their repair target. An alternative operation or another worker's completed repair
can satisfy the concern. Already absent elsewhere records count as satisfied work.
Distinct clothing, posture and durable facts remain distinct findings; unrelated
repairs cannot close them. Useful changes survive a failed followup. An unsupported
remaining concern stays visible rather than being declared complete.

The existing M686 idle continuation remains responsible for scheduling. M687 makes
these repairs land and the accumulated findings close, allowing the existing
completion indicator to become green and the automatic audit loop to stop.

## Context review

The four readers use one saved state and the existing per story reader queue. They
are interconnected, with different initial views and context budgets. The actual
prompt builders were checked with distinct markers for brief, plot text, cast,
record, unfolded pages, character cores and knowledge. Their lookup and commit
paths were read as well. See [the complete context table](WORKER-CONTEXT-M687.md).

All four receive the brief, including the writer's plot essentials, cast notes and
current turn. Scene, World and Auditor receive preceding unfolded pages and the
folded record, with lookup for material outside their initial budget. People is
narrower: it receives current turn and character records, but no older unfolded
pages, folded record or lookup. The separately generated Story essentials are used
by the storyteller, not injected separately into these readers. M687 does not
claim that every reader sees everything or that this narrower context is optimal.

## Verification

All tests use scripted providers and disposable stories. No paid story API calls
or access to the owner's phone or live story were involved.

| Check | Result |
| --- | --- |
| Eighteen new public `auditLedger` laws on published M686 | 12 fail, 6 preservation controls pass |
| New laws and nearby M679, M680, M681, M685 coverage on M687 | 129 pass, 0 fail |
| Real app backlog regression on M686 | Fails to complete; two prerequisite app scenarios pass |
| Same real app regression on M687 | Completes, green, unchanged story page, no new story turn; remains complete on idle and reopen |
| Final fast profile | 6 checks pass in 29.59 seconds; 113 selected laws and 14 app scenarios |
| Complete harness | 1517 of 1517 pass |
| Complete app walkthrough | 305 of 305 pass |
| Long play | 9 of 9 pass |
| Lint | 0 errors |

The final `m687d` release matrix passed all 33 checks in 1738.11
seconds. Exact results and preserved earlier attempts are in `audit/results/m687.json`. The candidate
is frozen at executable checkpoint `1328910`; documentation is outside the gate's
execution fingerprint.

The launcher and upgrade tests initially failed because this sandbox's shared
process mount reports host IDs to `pgrep` while signals use local namespace IDs.
The preceding handoff already documented the required external process wrapper.
It was restored and checked against a disposable child process. Product launcher
code, assertions and timing budgets were not changed to accommodate the sandbox.
Initial failures and the qualified rerun are retained in the release results.

After updating, opening an existing story uses its saved source coverage and starts
the existing automatic recovery. A particular live story has not been inspected
here; completion still depends on its actual source evidence and configured model.
All prior milestones, history, instruction archives and the canon vendor remain.

Publication is awaiting fresh user approval after automatic approval review rejected
the branch push. The public repository destination was verified against the supplied
project link. No retry or update to main was made; the tested candidate is local.
