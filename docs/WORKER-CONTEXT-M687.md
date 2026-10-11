# Ledger reader context review

Reviewed the actual prompt builders and the callers in M687. The ledger rooms are
views of one saved story state, rather than independent stores. Readers run through
the existing per story queue; World and the People writer reload that shared state,
and the auditor reloads it again before committing its proposals. Rewinds, cancelled
jobs and changed pages retain their existing stale answer checks.

| Reader | Story sources in its initial request | Shared ledger view | Further lookup |
| --- | --- | --- | --- |
| Scene reader | Brief, cast notes, folded record, preceding unfolded pages, current writer message and story page | Presence, position, clothes, clock, ground, relationships, threads, knowledge, elsewhere records, bodies, locked facts, factions and scene questions | Whole pages by number, searches, complete brief or cast notes, individual People pages and record lines |
| People writer | Brief, cast notes, optional canon record, current writer message and story page | Character cores, current states, arcs, loose ends, current presence and the main character's permitted record; relevant absent people are recalled | None: this writer calls the provider directly |
| World reader | Brief, cast notes, optional canon record, folded record, preceding unfolded pages, current writer message and story page | Scene facts, current clock, presence, absent people, their identities and current situations, knowledge, threads and factions | Same lookup mechanism as Scene |
| Whole ledger auditor | Brief, cast notes, optional canon record, folded record and unfolded pages; source recovery also reviews original input and pages in batches | Whole ledger plus character pages, outstanding findings and original source coverage | Same lookup mechanism as Scene |

The writer's plot essentials belong to `story.brief`, alongside the premise and
standing notes. That brief reaches all four readers. The separately generated
**Story essentials** are the folded record condensed for the storyteller's context
assembly. They are not separately injected into these four ledger readers.

For Scene and World, `storySoFar` gathers preceding unfolded messages, with a
maximum of 100. The prompt then fits complete recent pages into the model's context
budget and indexes those that do not fit. A lookup can retrieve an earlier page
whether it was folded or not. Their folded record also has a context budget.
The auditor similarly fits its unfolded pages and indexes the remainder; original
source coverage is checked separately rather than pretending one request can hold
the entire story. Brief and cast note limits are 40,000 and 20,000 characters,
respectively, with complete text available through lookup where supported.

These are actual limits, not a claim that every reader sees everything at once or
that each context is optimal. In particular, the People writer does not receive
older unfolded pages, the folded record, every knowledge entry, or the generated
Story essentials. Its existing character records provide some history indirectly.
M687 fixes the reported repair loop; it does not change that narrower context.

The repair fault was in the audit's acceptance check: it could receive the newest
page, correctly identify an earlier spectator or posture, and still reject the
repair because only the last few paragraphs were accepted as evidence. M687 follows
the latest evidence for each person throughout the current scene while preserving
later departures, deaths, scene moves and hand written fields.

Verified with distinct source markers in the real exported prompt builders:
brief, plot text inside the brief, cast notes and current page appeared in all four;
record and preceding unfolded page appeared in Scene, World and Auditor;
character core appeared in People, World and Auditor; knowledge appeared in Scene,
World and Auditor. Shared queue, fetch and commit paths were also read directly.

Source paths: `js/ui/chat.js`, `js/agents/extractor.js`, `js/agents/scribe.js`,
`js/agents/world.js`, `js/agents/auditor.js`, `js/agents/memory.js`,
`js/agents/lookup.js`, `js/engine/whole.js`, `js/engine/people.js`,
`js/assemble/stack.js` and `js/agents/housekeeper.js`.
