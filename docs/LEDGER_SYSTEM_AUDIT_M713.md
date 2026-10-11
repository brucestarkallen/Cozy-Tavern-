# CozyTavern ledger system audit, M713

Reviewed on 11 October 2026. This is an audit of the current code and its request assembly, not a claim that a live provider has verified every story. Application code and story data were not changed during this review.

The foundation is worth keeping. The system already separates durable story records, current scene state, character interpretation, offscreen simulation, historical memory and final factual review. It also protects manual ownership, earned standings, original source retrieval and timeline recovery. The remaining weaknesses are concentrated in request selection, context accounting, repeated reading and scheduling. A targeted restructure of those boundaries is warranted. Replacing the whole system is not.

## What the system actually does

The storyteller writes the scene from a selected briefing and recent original exchanges. After the page, Scene reads its completed events, World makes authorized decisions about activity elsewhere and quiet people, and People develops character records. The keeper folds older passages. Other readers maintain plans, essentials, canon and optional writing notes. The auditor compares the resulting ledger with established sources and repairs factual discrepancies.

This is a story driven sandbox with durable state. It is not a continuously running independent simulation of every character. Offscreen activity advances through worker decisions driven by story time and established circumstances. Opening the application does not mean every character lives through another hour of fictional time.

The storyteller sees a view of the ledger, not the entire database. A stored fact and a fact sent to the model are different things. The ordinary storyteller request has no internal database fetch conversation equivalent to the workers' askWithFetch. If an important fact is omitted from its request and unavailable in the selected prose or memory, the storyteller cannot simply read it from storage while generating.

Evidence: js/ui/chat.js startBackgroundWork and generate; js/agents/world.js buildWorldMessages and worldTurn; js/assemble/stack.js buildRequest; js/agents/lookup.js askWithFetch.

## Strengths to preserve

1. Scene, People and World have distinct responsibilities. Shared reading instructions explicitly preserve valid worker judgments and distinguish established facts from simulated developments.

2. Current appearance, enduring identity, present posture, knowledge, standings, arcs and offscreen seats have separate stores. One universal biography paragraph would be a regression.

3. Original messages remain available behind folded memory. Workers can retrieve a person's full record or original passages instead of treating a shortened view as an empty record.

4. Source receipts and durable audit checkpoints reuse unchanged work. The system does not inherently need to reread all historical pages after every ordinary turn.

5. Journaled mutations, snapshots, source matching, manual ownership and stale job checks protect the timeline. Content banking shares repeated snapshot data. These mechanisms are functional protections and should survive any restructure.

6. The request already separates past from present, includes knowledge restrictions and relevant world developments, and hides bookkeeping language from fictional dialogue. These are useful conditions for coherent storytelling.

Evidence: js/agents/ledgercontext.js; js/agents/auditprogress.js; js/engine/apply.js; js/engine/state.js; js/agents/housekeeper.js; js/assemble/stack.js.

## Confirmed findings

### 1. Recalled characters can lose their saved physical facts in the request

Severity: high. Confirmed by local request inspection.

State facts select appearance locks using the current presence list. The People block separately recalls absent people named by the current move. Its recalled cards carry identity and interpretation but do not independently include those story appearance locks.

Consequently, a move toward a person who is still listed elsewhere can recall their identity without their saved hair or eyes. This is especially relevant to a first meeting after a long absence. Historical prose might happen to supply the detail, but that is not a dependable injection contract.

In the inspection, Elin's queen identity was included and her stored distinctive hair value was absent.

Repair: derive one shared relevant person set for the request from presence, the writer's move, recent scene references, nearby people and supported arrivals. Feed that set to identity, physical facts, knowledge and relevant obligations. Relevance must not change physical presence. Preserve persona distinctions and manual facts.

Evidence: js/assemble/stack.js 1044 to 1056; js/engine/state.js 1122; js/engine/apply.js canonNamesFor; js/engine/people.js awayCard.

### 2. There is no complete final context budget

Severity: high. Confirmed by local request inspection.

With the keeper enabled, windowPlan starts from the requested message count. It limits extension for uncovered history, but it does not shrink the normal selected window when that window itself exceeds available room.

With the keeper disabled, the window budgets against input context without reserving the storyteller's answer. Other budgets make conservative allowances in some paths, but there is no final complete request accounting that covers every path, optional closing note, provider wrapping and output allowance.

The local inspection used a configured room of 200,000 tokens. Long pages with the keeper enabled produced approximately 245,141 input tokens, or 261,141 with a 16,000 token answer allowance. With the keeper disabled, the result was approximately 185,124 input tokens, or 201,124 including that allowance.

Repair: one final budget owner must account for the full serialized request and effective answer allowance. Fit complete exchanges, memory excerpts and optional views according to explicit priority. Never silently truncate the newest input or erase stored records. Keep uncertainty margin for character based estimates and provider differences.

Evidence: js/assemble/stack.js windowPlan, prefixTokens and buildRequest return; js/agents/memory.js recordRoom and fixedCharsOf; js/assemble/receipt.js estimateTokens; js/engine/pagecut.js roomChars.

### 3. Important old obligations can remain stored but unseen

Severity: high for continuity. Confirmed for character loose ends.

A character card shows their newest three loose ends. It does not first select by the current move. The local inspection stored six obligations for a present gatekeeper, including an older distinctive promise. That promise did not reach the request.

The same general boundary appears in object and knowledge views. Objects are limited to twelve selected records. Knowledge is fitted to a separate size allowance. Those restrictions are necessary in some form, but recency and fixed counts alone do not prove that the relevant fact survived.

The craft treats supplied knowledge lines as authority. A known fact omitted from the view can therefore be mistaken for an unknown fact unless prose or recalled memory supplies the missing pathway.

Repair: select obligations, objects and knowledge by their relationship to the current scene and move before using recency as a fallback. Explicitly distinguish an incomplete view from a complete knowledge inventory. Keep all durable records.

Evidence: js/engine/people.js cardText; js/engine/state.js renderThings and knowledgeAt; js/engine/world.js renderKnowledge; js/assemble/craft.js Who Knows What.

### 4. Historical source review uses a small hard ceiling and can reject a readable page

Severity: high for autonomous recovery. Confirmed by code review.

reviewAuditSources caps a source batch at 24,000 characters, even when the connection has much more room. Whole source documents are packed into that limit. When one document cannot fit, the loop breaks and reports that the source page does not fit the configured context.

That is not necessarily true of the model's context. A page above this internal ceiling can fit a 200,000 token model while still preventing source coverage from completing. Escaped document representation also consumes part of the ceiling.

Repair: fit original documents against actual available context and the expected fact output. If a single original exceeds that room, review indexed portions with original document identity and offsets, then reconcile their receipts. A partial reading must not mark the whole source complete. Unchanged source receipts remain reusable.

A whole long story cannot always be read in one call. The required improvement is to avoid an arbitrary small ceiling and unnecessary serial calls, not to promise that any amount of text fits one response.

Evidence: js/agents/auditsources.js reviewAuditSources.

### 5. Delay comes from more than the final auditor

Severity: medium to high for responsiveness. Confirmed by code review; live duration was not measured.

The send path waits for background work and can also wait for semantic recall, canon preparation, gated referee work and initial canon placement. Semantic recall has an eight second timeout. Referee work and initial preparation have their own allowances.

pendingWork applies its timeout separately to the first outstanding promise on each loop. A chain of jobs settling individually within that allowance can hold the send for more than five seconds overall. The caller also proceeds after timeout, so this is neither a strict total latency budget nor an unconditional guarantee of a completely current ledger.

Most background jobs use the main queue by default. A separate lane for independent books already exists as an optional setting. Worker retries, malformed answer recovery and additional fetch rounds can add further calls. A worker sharing a connection inherits the selected reasoning configuration and output setting; it is not automatically a cheap nonthinking model.

Repair: give the send one total deadline and distinguish essential current scene work from optional historical upkeep. Preserve dependency order for ledger writes. Run independent readers from a consistent snapshot where safe, rather than blindly running all writers together. Report useful job identity, calls and elapsed time.

Evidence: js/ui/chat.js generate and startBackgroundWork; js/agents/extractor.js pendingWork; js/agents/recallpick.js; js/agents/queue.js; js/agents/call.js workerConnection.

### 6. Several repeated views consume tokens without adding distinct authority

Severity: medium. Confirmed structural overlap; no live percentage claimed.

World receives rendered state plus explicit offscreen seats, knowledge, threads and factions. Some of these records already appear inside rendered state. Quiet character cores can also appear beside the general People view.

People receives source facts already recovered, up to its room, without filtering all already reconciled facts out of the ordinary worker prompt. Returning a historical fact unchanged is useful for a focused repair but need not become a repeated large reading every scene.

The storyteller can receive original cast notes or invited cards alongside ledger identity and physical facts. These have different origins, so not all overlap is waste. However, there is no unified fact identity that consistently renders the authoritative current fact once while retaining its provenance.

Memory avoids overlap between the primary rendered record and the original window, but auxiliary hybrid recall selection draws from all memory nodes. Exact text checks remove some duplicates, not every overlap between source spans or semantically repeated facts. Optional frame repetition is deliberate and should not be mistaken for an accidental duplicate.

Repair: build one view per consumer from stable record identities and source spans. Render each authoritative fact once, retain references to all supporting origins, and supply unresolved source facts only when they matter to that worker. Preserve the actual records and all writer text.

Evidence: js/agents/world.js buildWorldMessages; js/agents/ledgercontext.js workerProfileSources; js/assemble/stack.js cast cards, hybrid recall and frame echo; js/agents/memory.js memoryForWindow.

### 7. Audit scheduling and reuse need one consistent policy

Severity: medium to high for perceived loops and cost. Confirmed by code review.

The page chain honors auditEvery. Idle repair also treats any unverified current snapshot as work owed. A new scene invalidates current verification, so idle scheduling can request an audit even when the page chain skipped it under the frequency setting.

Durable character identity and canon approvals can be reused across scenes. Current scene and other entries are still rendered for final review. The final review can approve entries together; a display such as 206 of 210 does not by itself imply 210 separate model calls.

Repair: distinguish initial source recovery, an ordinary changed scene review and unresolved repair work. Honor a single explicit policy. Reuse approvals for unchanged values with valid dependencies and present changed or affected entries for the authoritative review. Green must continue to mean the current configured review completed without unresolved findings.

Do not reduce cost by declaring an unchecked snapshot verified or by retrying the same failed proposal forever.

Evidence: js/ui/chat.js auditor queue, ledgerRepairNeeded and scheduleLedgerRepair; js/agents/auditor.js auditLedger; js/agents/auditprogress.js reusableAuditCheckpoint and ledgerAuditVerified.

### 8. A green ledger is not a review of the exact next storyteller request

Severity: medium. Architectural limitation.

The ledger can be correctly stored and audited while the next assembled view omits hair or an obligation. The local appearance and promise findings demonstrate that distinction.

Repair: enforce request assembly contracts locally. For selected people, include their required identity and physical facts, appropriate knowledge boundary and relevant obligations within the final budget. This is a view compiler responsibility, not another model auditor and not another approval ladder.

### 9. Automatic prose repair is a separate existing capability

Severity: an ownership decision, not a claim of current data corruption.

The existing mender is enabled unless explicitly disabled by story or global setting. Continuity and memory readers can request changes to stored narration. Earlier wording is retained and writes are checked against the version shown to the mender.

Ledger repair and prose editing are different actions. Their policies should be clear. A ledger correction should not imply authority to rewrite prose merely to make the ledger agree.

Evidence: js/ui/chat.js mendOn, mendAround and applyMend; js/agents/continuity.js mendPages.

## Tokens and long play

At a configured 200,000 token room, peopleView permits a nominal 36,000 character People section, twelve full present cards, six recalled cards and forty roster entries. These are view targets, not a promise that every person or fact is sent. Essential present cards may exceed the nominal section budget.

The current built in craft contains 70,480 characters, approximately 17,620 tokens using the application's four character estimate. That is before story data. Its stable prefix is cache friendly, including an explicit Anthropic cache breakpoint. Caching may reduce billing or processing work where supported; the prefix still occupies context. User customization can change this size.

One ordinary local request with invented records and 8,000 character narration pages measured approximately 50,147 input tokens. This is an inspection example, not the user's live request size or a universal per turn bill.

The application meters model calls and reported cache usage. Its daily totals are grouped by connection and model. They do not directly identify every worker's contribution when several jobs share one connection. Detailed cost attribution needs story, page and job identity.

Longer than 200,000 total story tokens is possible because originals remain stored and older content is folded and selectively recalled. A 200,000 token model does not need the full lifetime story every turn. The limits are memory fidelity, correct retrieval, active world workload and final request fit. Recursive summaries remain lossy interpretations. Original retrieval reduces that risk but cannot help the storyteller if the relevant source is never selected.

The code supports this long play approach. It does not yet justify a claim that every request will fit safely or that every relevant stored fact will be supplied.

## Recommended work order

1. Fix relevant person physical fact injection, final complete context budgeting and source documents blocked by the small historical review ceiling. These are the strongest concrete correctness findings.

2. Introduce shared selection for scene relevant knowledge, older obligations and objects. Keep durable storage separate from views.

3. Deduplicate consumer views and show per job cost and elapsed time. Set an overall send deadline while preserving required scene dependencies.

4. Consolidate the audit policy around reusable source receipts, stable approvals and the current scene delta. Keep the final auditor as the authority for factual repair, without another model approval step.

5. Move World toward due events and explicit persistent stays. A large cast should retain its entire history while only relevant, due or affected lives require substantial new reasoning. Do not make all one hundred people invent a fresh action every short exchange.

6. Separate original fact storage, current state, character interpretation and narration editing in the implementation boundaries. Refactor those boundaries incrementally. Keep prose, original inputs, manually owned fields, valid standings, snapshots and recovery contracts intact.

7. Preserve the rulebook. If active instruction compilation is improved, retain every writer rule in its canonical source and explain which rules are selected for a scene. Do not delete rules or reduce creative freedom merely to reduce tokens.

The next implementation milestone should use one directly relevant local inspection of the actual request and changed recovery path. No theme checks, long gameplay, paid provider matrix or repeated release checks are justified by this audit.

## Verification and scope

One local inspection invoked the real buildRequest with invented records and no provider calls. It measured an ordinary request, long pages with the keeper on and budgeted history with the keeper off, and checked whether saved appearance and an older open promise were present in the assembled text. The output established the specific findings above. Other findings came from direct code review.

No broad test suite, gameplay, live provider request or live browser ledger audit ran. Nothing in this report claims that these newly identified issues have already been repaired.

