# Cozy Tavern: working rules

For any agent, human or AI. Read in this order, once: this file, HANDOFF.md (the
present state), SPEC.md (the open milestone, if any), docs/WORKFLOW.md (commands).
History is looked up, never loaded whole: tools/context.py (see Context map).
The owner's current request takes priority; preserve established contracts.

## Product contracts

- Vanilla ES modules, no application build step or framework. No CDN or remote fonts.
- Mobile first, relative application URLs; GitHub Pages and Termux localhost:8080 both work.
- IndexedDB through js/store.js's db only; namespace cozytavern.v1. Keep settings,
  connections, stories, messages, exportAll and importAll promise based.
- API keys go only to the chosen provider. Never commit keys or fixture credentials from a real account.
- createProvider(connection) retains test() and streamChat({system,messages,signal,onToken}).
- buildRequest({story,messages,settings}) retains its interface. Stable system prefix;
  Anthropic's last system block receives cache_control: ephemeral.
- One streaming storyteller call per send. No preliminary calls or workers on the send path.
  Background readers keep their existing queues, page ownership and stale answer guards.
- Same origin service worker shell is cache first; cross origin API traffic is network only.
- Keep local records, undo/replay, backup safety and custom rules intact. Warm, plain UI copy;
  serif story text, readable controls, dark/light coats and reduced motion.

## The owner's standing rules

The owner (LO) plays; the agent builds, checks and maintains. These hold for every task.

- A report is a symptom. Find why it happens before changing anything; fix the cause,
  then search the codebase for the same fault and fix every instance.
- Finish the whole job in one pass. No "next pass", no offers to do more later, never
  ask him to test, check, confirm or report back. Verify it yourself and say what is true.
- A list from him gets a disposition for every item: fixed, not a bug (because...), or
  not understood yet. A question is not an order: answer it before changing anything.
- Preserve unrelated working code, data, prose and settings. Make the smallest correct
  change, and understand why code exists before modifying it.
- His connection settings are sent exactly as he set them; nothing set means nothing
  sent. The only override is a floor that prevents corruption (a minimum token budget).
- Controls are named what he calls them. One button, one meaning; no behaviour that
  changes on hidden state; activity lists sort by recency.
- If the app can detect a problem, the app repairs it. It is a finished product: no
  debug surfaces aimed at him, no asking him to find or paste anything to diagnose.
- No content filters, censorship or safety checks he did not ask for.
- A page that fails is never asked again by the app on its own: it names the real
  cause and he retries by hand.
- Everything above the chat history is system role (SillyTavern preset convention).
- In replies: plain words, the answer first, no generic disclaimers. Say exactly what
  was checked, what it proved and what was not covered.

## Testing: real checks, not rituals

The owner, 14 October 2026, 00:40 Jakarta: "Do the agent only test if the agent
genuinely believes it needs testing but differentiate stupid unnecessary testing
than real testing". This replaces the 11 October "default to no tests" rule
(archived in docs/archive/AGENTS.before-M752-tidy.md). Use judgment: a check is
real when it answers a question about this change that reading the code cannot.

First, always: read your own diff line by line. Most bugs here were in code written
minutes earlier and were found by reading it, not by running anything. A green
suite over new code proves nothing until a law covers that code.

Real testing (do it when it applies):
- Reproduce a reported bug before fixing it when reading does not settle the cause:
  a law or a scratch run on the real shape of the data the code expects.
- Prove the fix with one law that runs the feature (writes data, runs the code,
  asserts on what comes back) and fails without the fix. Run it both ways once.
- A change to shared code (js/engine, js/assemble, js/agents, js/store.js,
  js/ui/chat.js, sw.js, or a contract in this file) can break code you did not
  touch. While iterating, run the laws that exercise what you changed (grep
  tests/harness and tests/dom for the function). Before publishing that version,
  run the whole law suite once (about 5 minutes, no provider calls). M682-M749
  shipped without it: 155 laws broke unseen and cost a full audit (M752).
- A change to a UI flow: run the DOM walk laws of that flow (ONLY=...). The whole
  walk (about 13 minutes) only when the change touches what every scenario passes
  through: drawing the thread, sending, opening or branching tales, the store.
- Layout, scrolling, contrast, performance, offline and update behaviour need a real
  browser (Playwright with Chromium, tests/*.py): jsdom cannot see them. Measure
  before and after.
- A number he reports (tokens, ms, MB, a count) is measured before and after.

Unnecessary testing (do not):
- Checks after every edit; re-running a passing check because notes, a commit
  message or a rebase changed nothing in the code. Documentation needs no tests.
- Long play, hundreds of turns, multi-session runs, thousand-case mock runs. If a
  bug only appears over a long run, use the shortest run that shows it.
- Checks unrelated to the change (theme, pixel or performance for a ledger fix;
  the auditor for a CSS fix); several suites or trees with no question to answer.
- Tests that read source text, comments or file lists, mirror the implementation,
  or would still pass with the feature deleted.
- Re-running an intermittent failure until it passes. Find the mechanism
  (instrument the path), compare with the previous version under the same load.
- Live provider calls, which cost him money, unless the bug is in a provider's
  real behaviour.

Always: when a law you did not write fails, suspect your change first; never loosen
or delete a law to make a build green; change an expectation only when you can say
why the old one is wrong under the current contract. Keep verification in proportion:
minutes for a narrow fix. Report the checks you ran, what they proved, and what you
did not run. A scripted pass does not prove the owner's live story is repaired.

## Publishing (standing permission)

On 11 October 2026 at 19:27 Jakarta, the owner explicitly said:
"Yes for every version you can publish anything."
This authorizes publishing M704 and future CozyTavern versions containing the
owner's requested work to the existing GitHub main branch. Do not ask for new
permission per version. Publish with a normal nonforce push, reconcile remote
changes when necessary, and verify the exact remote head. Preserve prose,
manual edits, data, credentials and valid worker judgments under the existing
contracts. This permission does not authorize unrelated work or destructive
repository actions. If automatic review nevertheless rejects publication,
report the actual rejection and do not bypass it. Publishing itself is never a
reason to test; the law suite runs because of what a version changed (Testing).

## Working loop

1. Locate the relevant history with tools/context.py; read the source and those
   entries, not the whole history.
2. Diagnose to the cause, fix it, search for the same fault elsewhere.
3. Read the diff. Run the checks the change genuinely needs (Testing above).
4. Version a functional change (js/version.js; the service worker cache follows it).
   Rewrite HANDOFF.md as the present state, append a short HISTORY.md entry with
   measured results and limits. Documentation-only work needs no version bump.
5. Verify remote main, publish without force, then verify its exact head.

## Context map

- HANDOFF.md: the present state, the latest milestone and known open items. It is
  rewritten each milestone, never grown into a second history.
- SPEC.md: the open milestone's plan, when one is open.
- HISTORY.md: the complete milestone record, append only, never loaded in full.
- tools/context.py "M731" searches HISTORY.md; add --in handoff for the detailed
  per-milestone handoffs archived in docs/archive, or --in all.
- docs/README.md: which documents are current references and which are history.
- docs/archive: verbatim earlier instructions, handoffs and specs, for archaeology.
  Do not resurrect old milestone instructions as current tasks.
- Test npm dependencies are allowed inside tests; the application has no npm/build step.

## Ledger and auditor contracts

### Ledger ownership after M713

Fix upstream omissions where they arise; do not deliberately reserve known
writer biography or missing profiles for the auditor. Founder and People may
record explicitly sourced writer facts about the MC, never invent their core
or arc. Worker views and durable storage are separate: a small prompt must not
delete unresolved threads or learned facts. Reuse original-source receipts
inside existing worker calls. Preserve original prose, manual edits, earned
standings, undo and exact page ownership. Final audit remains the factual check.
See docs/LEDGER_PIPELINE.md before another broad ledger repair.

### Audit completion after M715

Do not restart completed unchanged audits on open/reload, provider changes or
new app versions. Completion is factual; require matching semantic receipts
and original sources. Preserve the fixed M713/M714 legacy key migration and
stable source chunk ids/marks. Source-only transport correction reuses approved
ledger checks and never certifies unsupported facts. Debug failures must name
the exact unfinished source and reason within the existing bounded report.

After M716, do not treat every quoted name as an individual or create empty
People preview rows before the reader classifies its subject. Use the existing
People answer to correct factual ownership and source-quoted entity kinds.
people.reclassify is an archived, journaled, undoable correction, never a rename
of a place into a person. Do not overwrite its corrected source cache during
audit commit. Advance LEDGER_REPAIR_POLICY only for an actual changed repair
procedure; keep completed factual audits independent of app versions.

After M717, source identity and fact meaning belong to the reader using ordered
original passage references. Do not reintroduce verbatim canonical-name gates
or collective-name regex semantic verdicts in source transport. Reference
binding supplies literal originals and source lookup retains explicit selected
section ids, even for shorter names/pronouns. Do not reset source ids, marks or
completed caches because the reference transport changed. Keep the one focused
correction inside the original reading conversation, with no bulk rescan.

After M718, contextual source labels have durable per-section identity
resolutions through identities/source.resolve. Do not use a global character
rename or alias for an extraction-only girl/stranger/captain descriptor. Do not
borrow another source's ledgerName when resolving a row without a local binding.
Keep source finding ids distinct across same-label chunks. A final source
withdrawal must save its actual disposition, so it cannot reappear next turn.
Omitted decisions complete in the existing conversation, no independent checker.

### After the M752 audit (M682-M751)

Keep these; each has a law that fails without it:
- One measure of room: the storyteller's request is planned and fitted in budget.js's
  measure; a worker's room is call.js workerRoom (pagecut.js roomChars uses it). With
  no Max tokens set, refuse only below ANSWER_FLOOR; a refusal is said in the thread.
- A model answer never grants itself byHand, auditorApproved, writerEstablished,
  spelling, story or similar flags: every reader's parser strips them.
- Durable books, bounded views: threads and seats are kept whole and shown 40 at a time,
  chosen for what is read, with a count and a fetch ("person: NAME" returns the seat).
- One knowledge record per kind and exact statement; a worker label is never a receipt
  (receipts ride in `provenance`).
- The final review: an open verdict holds every write to its row; a confirmed scene
  ending outranks a contradicting update; two writes to one field are refused; a
  refused repair is never certified; rows past the room stay open, never approved unread.
- Record lines stay bound when the house itself rewrites or copies pages (spelling,
  branch, mends: restampRecord, branchRecord, recordAfterPageChange).
- A spelling correction matches the name as written (and in capitals), never an
  ordinary word; a month, a weekday or a word the story writes in lower case is refused.
- The thread shows the tale that is open: a drawing or a page redrawn after waits stands
  down when another tale was opened meanwhile (renderThread, rerenderMessage); a telling's
  failure is said in its own tale's thread, or by the tale's name (generate's sayFailed).
- Every law runs in the suite: a new harness file is imported by tests/harness/run.mjs,
  and a standalone fixture is listed in tests/harness/focused.mjs, never left outside it.
