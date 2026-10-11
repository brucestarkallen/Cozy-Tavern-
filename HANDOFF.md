# Cozy Tavern: current handoff

## Published release: m687-001

The owner explicitly approved publication with "Yes do it" on 2026-10-11. The reviewed
release was pushed without force to main and m687-auditor-scene-repair, then fetched
from GitHub: main was verified at 36403ab59c6b991bfd6c41b6317b7e997d8fd6dd with
version m687-001. This publication record is a documentation-only follow-up.
The final execution checkpoint remains 13289103d18b83793869c6db9541b23301816420.
Destination: https://github.com/brucestarkallen/Cozy-Tavern-.

## Released behavior

M687 fixes the owner's turn 33 automatic audit loop. The acceptance check now follows
each person's latest quoted evidence throughout the newest scene, including immediate
pronoun continuations, instead of omitting quiet spectators before a long fight ending.
A full header's room is separate from the main character's pose. Later departures,
deaths, scene moves, hand written fields and existing page ownership guards remain.

Real identity merges preserve aliases. Original source receipts and saved cast names
follow completed merges, including old M686 journal entries, so the titled Kelstrum
page is not repeatedly recreated. Reworded findings compact by target, and a repair
completed by an alternative operation or another reader closes satisfied old findings.
Different fields and durable facts remain distinct. Unsupported work stays unfinished.

The M686 idle scheduler is unchanged. Opening a story starts original source recovery;
unfinished work continues through the reader queue with its existing backoff. Explicit
Stop, off switches, new turns, source changes, replay and stopped partial pages retain
their guards. Once the ledger actually completes, green returns and the loop stops.

## Verified results

Final full harness 1517/1517, app walkthrough 305/305, long play 9/9, lint zero errors.
The stable m687d release passed all 33 checks in 1738.11 seconds, with an
unchanged source/runtime fingerprint and ALLDONE. Fast passed six checks in 29.59 seconds.
Eighteen new public auditor laws: 12 fail on published M686 and six controls pass;
129 new and nearby laws pass on M687. The real app backlog case fails on M686 and
passes with the final five cell header, unchanged story, green, idle and reopen completion.

Earlier failures and interrupted attempts are preserved in audit/results/m687.json.
No paid story model calls or live phone/story access were involved. This does not
claim that the owner's phone ledger is already repaired. See
docs/AUDITOR-SCENE-REPAIR-M687.md for cause, changes and limits.

## Worker context and continuity

docs/WORKER-CONTEXT-M687.md traces the real builders and shared save paths. All four
readers receive brief/plot essentials, cast and current turn. Scene, World and Auditor
also receive folded record and preceding unfolded pages with lookup. People is narrower:
no older unfolded pages, folded record or lookup. Generated Story essentials are used
separately by the storyteller. No claim that every context is optimal is made.

Claude's M680 4a19de3, M681 8880a0, final fixes f087472/63f87, M683 71b22e8,
M684 613c174, M685 8e3c46d and M686 2ca4610 remain ancestors. HISTORY is append only;
the instruction archives and Canon Verification v0.68.3 / 5aed234 remain intact.

Read AGENTS.md and this handoff once. Use tools/context.py for bounded history.
Use fast during edits and release on a frozen candidate. This sandbox's shared proc
mount requires PATH=/tmp/cozy-work-test-bin:$PATH for launcher and upgrade checks;
its pgrep/pkill wrapper maps only this namespace's process IDs. No launcher code or
test budget was changed for the environment. Documentation-only commits need no repeat
gate. Future publication must recheck remote main, reconcile without force when needed,
publish within the owner's authorization, and verify the exact remote head and version.
