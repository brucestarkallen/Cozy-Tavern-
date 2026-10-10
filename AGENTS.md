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
2. Reproduce a defect through its public door. Write a causal regression, show it fails on
   old code and passes on the fix. Do not use source text assertions or vacuous fixtures.
3. Run python3 tools/check.py fast while editing. For a narrow change, ONLY may select laws;
   report selected counts accurately. Do not call a fast run a full gate.
4. When the product is ready, run python3 tools/check.py release --tag mNNN.
   Add relevant checks from full for changed dependencies. Run all only for broad changes.
   Timing/pixel checks run alone; do not edit execution inputs during a gate.
5. Resume an interrupted unchanged release with the same tag and --resume. The runner
   refuses reuse after any execution input/runtime change and always reruns measurements.
   Do not repeat green checks just because notes or a commit message changed.
6. Update version, concise HANDOFF and append HISTORY with measured results and limits.
   Verify remote main, publish without force when authorized, then verify its exact head.

## Context map

HANDOFF.md: present state. docs/WORKFLOW.md: commands and release practices.
HISTORY.md: complete milestone record, never automatically loaded in full.
docs/archive: verbatim instructions and handoff before M683, for targeted archaeology.
Do not resurrect old milestone instructions as current tasks. Test npm dependencies are
allowed inside tests; the application itself has no npm/build dependency.
