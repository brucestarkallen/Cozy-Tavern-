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
