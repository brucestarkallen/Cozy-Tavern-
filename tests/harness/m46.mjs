/* M46 — "reading now…": the workers' panel follows the jobs; the founder keeps out of the scene. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { markWorkerRunning, runningWorkers, onWorkerChange, noteWorkerRun } from '../../js/agents/status.js';
import { enqueueWork } from '../../js/agents/queue.js';
import { foundWorld, NOT_THE_FOUNDERS } from '../../js/agents/founder.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

test('M46-1 a job is marked running from start to settle, and listeners hear both', async () => {
  const seen = [];
  const off = onWorkerChange((sid, name, on) => { if (sid === 'm46') seen.push(name + ':' + on); });
  let during = null;
  await enqueueWork('m46', { name: 'auditor', run: async () => { during = runningWorkers('m46').slice(); return { silent: false, detail: 'done' }; } });
  eq(during.join(','), 'auditor', 'running while it runs');
  eq(runningWorkers('m46').length, 0, 'not running after');
  assert(seen.includes('auditor:true') && seen.includes('auditor:false'), seen.join(' '));
  await enqueueWork('m46', { name: 'auditor', run: async () => { throw new Error('busy'); } }).catch(() => null);
  eq(runningWorkers('m46').length, 0, 'a failing job is not left running');
  off();
});

test('M46-2 the drawer shows "reading now…", disables the button that is reading, and re-renders on change', () => {
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/is reading now…/.test(drawer) && /audit\.textContent = 'Auditing…'/.test(drawer) && /found\.textContent = 'Founding…'/.test(drawer));
  assert(/onWorkerChange\(\(\) => \{ if \(!drawer\.hidden\) render\(\); \}\);/.test(drawer), 'one subscription for the drawer');
  assert(!/DOMNodeRemoved/.test(drawer));
});

test('M46-3 the founder keeps out of the scene: place, clock, presence, mood and bodies are refused', async () => {
  const storyId = 'm46-founder';
  await saveState(storyId, emptyState());
  const answer = JSON.stringify({ mutations: [
    { type: 'place.set', name: 'Ravenwood' }, { type: 'place.set', name: 'the Wells house' },
    { type: 'clock.set', year: 2025, month: 1, day: 1, hour: 8, minute: 0 },
    { type: 'presence.enter', name: 'Rias' },
    { type: 'people.set', name: 'Rias', field: 'core', text: 'older sister' },
    { type: 'faction.set', name: 'the student council', stance: 'the school’s social power' },
  ] });
  const house = thinkingHouse({ answer });
  const r = await withHouse(house, () => foundWorld({ connection: HOUSES[0].conn, storyId, brief: 'x', stale: () => false }));
  eq(r.applied.length, 2, 'the page and the faction');
  eq(r.rejected.filter((x) => /extractor’s to found/.test(x.why)).length, 4);
  const st = await loadState(storyId);
  eq(st.place, null); eq(st.present.length, 0); eq(st.clock, null);
  assert(NOT_THE_FOUNDERS.has('place.set') && NOT_THE_FOUNDERS.has('presence.enter'));
});
