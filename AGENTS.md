# Cozy Tavern: current working rules

Read this file and HANDOFF.md once. SPEC.md describes the current milestone.
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

## Owner priority: specific fixes, minimal verification

Fix X does not mean test the whole application. A ledger or auditor fix must not
trigger theme, pixel, performance, long gameplay or hundreds of turns of testing.
Run a check only if it resolves a named uncertainty in the requested change, and
only at a meaningful milestone or after useful iterations. Default to no tests.
Publishing is not a reason to run a release matrix. A passing relevant check is
not repeated after documentation or commit changes. Documentation needs no tests.
This policy overrides all older gate commands, templates and historical notes.

## Owner standing publication permission

On 11 October 2026 at 19:27 Jakarta, the owner explicitly said:
"Yes for every version you can publish anything."
This authorizes publishing M704 and future CozyTavern versions containing the
owner's requested work to the existing GitHub main branch. Do not ask for new
permission per version. Publish with a normal nonforce push, reconcile remote
changes when necessary, and verify the exact remote head. Preserve prose,
manual edits, data, credentials and valid worker judgments under the existing
contracts. This permission does not authorize unrelated work or destructive
repository actions. If automatic review nevertheless rejects publication,
report the actual rejection and do not bypass it. No extra tests for publishing.

## Working loop

1. Use tools/context.py to locate the relevant historical entries; read source and those
   entries, rather than loading the entire history. HISTORY.md is an append only archive.
2. Follow the owner's testing instruction of 11 October 2026: default to no tests.
   Only consider an extremely small, directly relevant check after a meaningful milestone
   or several useful implementation iterations. Do not test after every edit.
3. When verification is warranted, use the smallest causal check of the actual reported
   failure. Avoid blind bulk tests, unrelated suites, repetitive checks, and tests that
   merely mirror implementation. A scripted pass does not establish success in the
   owner's live story; report that distinction honestly.
4. No automatic fast, release, full, or all test matrix is required. This instruction
   supersedes conflicting test mandates in HANDOFF.md, docs/WORKFLOW.md, historical
   milestones, and other project notes. Do not spend an hour on verification for a narrow
   fix or repeat a long testing cycle. Keep diagnosis and repair focused and timely.
5. Documentation only changes require no tests. Do not rerun passing checks because
   notes or a commit message changed. Report checks actually run, or state none were run.
6. Update version, concise HANDOFF and append HISTORY with measured results and limits.
   Verify remote main, publish without force when authorized, then verify its exact head.

## Context map

HANDOFF.md: present state. docs/WORKFLOW.md: commands and release practices.
HISTORY.md: complete milestone record, never automatically loaded in full.
docs/archive: verbatim instructions and handoff before M683, for targeted archaeology.
Do not resurrect old milestone instructions as current tasks. Test npm dependencies are
allowed inside tests; the application itself has no npm/build dependency.

## Ledger ownership after M713

Fix upstream omissions where they arise; do not deliberately reserve known
writer biography or missing profiles for the auditor. Founder and People may
record explicitly sourced writer facts about the MC, never invent their core
or arc. Worker views and durable storage are separate: a small prompt must not
delete unresolved threads or learned facts. Reuse original-source receipts
inside existing worker calls. Preserve original prose, manual edits, earned
standings, undo and exact page ownership. Final audit remains the factual check.
See docs/LEDGER_PIPELINE.md before another broad ledger repair.

## Audit completion after M715

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
