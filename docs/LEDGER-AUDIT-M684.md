# M684 ledger audit

Requested by Jovan on October 10, 2026. Baseline: published M683, commit
71b22e8a1277f622ca29ae55594b0279cdfbee42. Implementation checkpoints: 10cdb17 and 8cbf422; final test fixture: 9e82274.
The release gate is still running; final results belong in audit/results/m684.json.

## What the ledger is responsible for

The ledger keeps facts, the current scene and a changing world outside that scene.
It is not a second storyteller that may replace the writer's names, ranks or history.
Physical presence, an established identity and an offscreen situation are different
facts. A prince mentioned in a biography needs a People page without being put in the
room. A quiet companion stays in the room until an event actually changes that.

The source is both sides of a completed turn. An explicit introduction in the writer's
input remains authoritative when the reply uses a pronoun. Questions, wishes and
hypotheticals do not prove that an event happened. Later actions still decide the
scene's ending. Dialogue about a person and an offscreen story window do not put that
person near the main character. Existing header, ownership and stale-answer guards
remain in place.

The simulation advances by **story time**, not the time a phone has been left alone.
An absent person's location, activity, travel and plans should be reconsidered as that
clock advances. Staying somewhere can be the right outcome, but it needs an explicit
current decision. An unsuccessful or omitted review must remain visible as unfinished.

## Pipeline and audit results

| Stage | Responsibility | Finding and disposition |
| --- | --- | --- |
| Story input and reply | Supply established facts and physical events in order | The extractor saw both messages, but several downstream guards used only the reply. Those guards now include the paired writer input. Unanswered input still does not mutate the scene through the auditor. |
| Scene reader | Decide who is nearby at the end, separate the main scene from world windows | A pronoun-only reply could lose people established in the input; chat's window filter could discard them again. Both doors are fixed and exercised through the running app. Writer departures also count, and a mistaken room board cannot revive someone known dead. |
| Named introductions | Keep identity and biography independently of presence | The reader now returns source-quoted introductions. Exact source names are required for new identities, and exact quoted facts can open their People pages even while absent. The character writer uses the same rule. Existing names and main-character aliases still resolve normally. |
| Character writer | Maintain core, current state and loose ends from the page | The prompt now explicitly includes intentional introductions in the writer's input. New unsupported names are refused with a reason. Source, cause and quoted evidence are saved when supplied. Existing ownership restrictions remain. |
| World worker | Simulate absent people from the clock, their situation, goals and information | A valid answer could omit stale people and still look complete. Overdue people are now listed explicitly. One bounded followup asks for omissions. Remaining omissions are named as unfinished. Useful first decisions survive a failed followup. |
| World freshness | Distinguish old evidence from a current decision | Age alone used to imply someone had probably moved. That inference is removed. `offscreen.confirm` records a reasoned stay, with an undoable review timestamp. Last sightings, the dead and overdue journeys cannot be rubber-stamped. |
| Auditor correction | Repair discrepancies across ledger sections | It was told to fix mistakes but could not use `people.rename`. It now can correct and merge an identity through the reversible rename operation. A deletion of a source-backed or linked person is refused, preventing a mistaken name correction from erasing the person. |
| Auditor presence | Repair missed arrivals or departures without inventing movement | Several quiet pages, or names only in dialogue, could authorize a removal. Silence no longer does. A real departure after the last arrival can still be recovered. An exact writer quote can recover a missed arrival when a long reply uses only pronouns. Assistant-page indices remain aligned through out-of-character turns. |
| Identity merge | Carry one person's records to the corrected name | The existing merge kept only eight loose ends despite the current larger limit and omitted the saved room identity. Both are fixed; undo restores the original identity and room. Existing knowledge and relationship preservation are checked. |
| Mutation and journal | Apply valid changes atomically, stamp ownership, support undo/replay | New log metadata records the responsible reader, page, cause and source quote. Freshness uses the existing reversible journal door. New confirmations are excluded from moment writes on old-page rereads. |
| Auditor report and page mender | Tell the user what actually happened | Partial corrections now retain their refusal reasons. A proposed story repair is pending until a mend actually changes a page. The post-mend report update checks report identity and reloads the current state. |
| Books display | Explain changes and unresolved concerns | Changes show page, responsible reader, cause and evidence when available. “Something drifted” is now “Corrections and unresolved issues.” Audit corrections, page concerns and completed mends are distinguished. Older records without saved explanations are identified as such. |
| Memory, plans, replay, persistence | Preserve story history and rebuild after edits or version changes | These mechanisms retain the M680–M683 implementations. The full harness, browser walk, long play, backup, restore, sync, crash recovery and device suites are included in the final broad run. No wholesale rewrite, library migration or canon vendoring was performed. |

## Evidence

Twenty-one focused laws live in tests/harness/m684.mjs. Eighteen fail against the M683
baseline for the behaviors repaired here. Three are controls: rejecting invalid quoted
introductions, preserving repair of a real departure after out-of-character pages, and keeping the main character when the same answer first establishes their identity.
The departure control also caught an index error in the first M684 implementation and passed after
that error was corrected. The main-character control caught and fixed an overstrict new-name filter in M684, first exposed by the existing DOM-47 version-recovery scenario. Tests use scripted providers, not paid LLM calls.

DOM-M684-1 exercises a full app turn: the input introduces Princess Alexia with an
explicit rank and an absent Prince Caelan with an explicit rank; the assistant uses
“she” and then shows a different person in a world window. It checks nearby presence,
separate People pages, correct ranks, absence of the remote characters from the scene,
Books evidence and persistence after reopening the story. The names and ranks are
fixtures, not a claim about Jovan's actual story.

The fast development profile passed in 16.19 seconds. The final broad gate runs the
entire harness, entire app walk, long play and every top-level browser/server test.
Results, actual counts, elapsed times and any encountered failures are recorded with
the release. A fast profile is never described as the full gate.

## Existing tests adjusted

- Exact stale-age wording in M300, M304 and M588 now expects an overdue review without
  an invented departure. The same ages and behavior remain tested.
- M642, M660 and M667 expect additive source metadata on the same mutations; the facts
  and rejected mutations are unchanged.
- M45, M48, M131, M372 and M588 follow the shorter auditor instructions, retaining the
  standing/ownership promises. Two source-file assertions now read the actual built
  request. Existing runtime standing protections remain asserted.
- M163's retry fixture now actually names Mara in its source instead of using the
  literal page “a.” The retry/fallback assertions are unchanged.
- M666's newcomer fixture now calls the maid “Oriana's maid” in the source, matching
  its model answer, rather than expecting an unsupported possessive name to pass.
- DOM-27 now identifies its sole initial present person as the main character.
  Without that identity, a scene move left Jovan as an unreviewed offscreen person,
  correctly keeping the world indicator amber. The same recovery assertions remain.
- Long play now contains the departure its scripted auditor previously claimed had
  happened. A legacy incorrect presence entry is seeded explicitly for the manual repair; the original final presence assertions remain unchanged.

No performance budget was relaxed. No existing history was removed.

## Limits and use with existing stories

This audits and repairs application behavior. Jovan's real story, prompts and saved
ledger were not available to this session, so no claim is made that his phone's existing
records have already been corrected. After updating, **Audit the ledger** can apply the
new repair rules to an existing story. Source-backed renames are now permitted; a
provider that returns a deletion instead is refused and the reason remains visible.
The auditor does not replace an absent person's simulation; that belongs to the world
worker in the page chain.

Semantic judgment still depends on the configured models returning useful, grounded
answers. Exact-source checks, bounded followups, ownership guards and honest reports
reduce failures and make them recoverable; they cannot prove every future answer
correct. A stale label can still appear when a review fails. It now accurately explains
that the world is awaiting review instead of pretending to know where someone went.
