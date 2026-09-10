/* M49 — the writer's digits are read in code; any entry can be taken back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { explicitStandings, foundWorld } from '../../js/agents/founder.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { applyMutations, undoEntry, undoLast, undoTarget } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

test('M49-1 explicit standings are parsed from the writer’s lines, in digits', () => {
  const notes = 'Aurora Sterling — childhood best friend, reunion stirring she won’t name (P:65 R:30 S:5)\nRias Wells: devoted older sister (P:85, R:65, S:45)\n- Mira — no numbers here\nCaleb — P: -20 R:0 S:0';
  const out = explicitStandings(notes);
  eq(out.length, 3);
  eq(out[0].name, 'Aurora Sterling'); eq(out[0].p, 65); eq(out[0].r, 30); eq(out[0].s, 5);
  eq(out[1].name, 'Rias Wells'); eq(out[1].p, 85);
  eq(out[2].name, 'Caleb'); eq(out[2].p, -20);
  eq(explicitStandings('nothing').length, 0);
});

test('M49-2 the founder applies them whether or not the model did; the auditor restores them when missing or zero', async () => {
  const storyId = 'm49';
  await saveState(storyId, emptyState());
  await db.messages.append(storyId, { role: 'assistant', text: 'page' });
  const notes = 'Aurora — childhood best friend (P:65 R:30 S:5)';
  const house = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mc.set', name: 'Jovan' }] }) });
  await withHouse(house, () => foundWorld({ connection: HOUSES[0].conn, storyId, brief: 'Jovan comes home.', castNotes: notes, stale: () => false }));
  let st = await loadState(storyId);
  eq(st.relationships.Aurora.p, 65, 'the founder wrote the digits in code');
  /* zeroed by hand; the auditor (even answering nothing) restores */
  st = applyMutations(st, [{ type: 'rel.set', name: 'Aurora', p: 0, r: 0, s: 0, cause: 'set down by hand' }]).state;
  await saveState(storyId, st);
  const quiet = thinkingHouse({ answer: '{"issues":[]}' });
  const r = await withHouse(quiet, () => auditLedger({ connection: HOUSES[0].conn, storyId, brief: 'Jovan comes home.', castNotes: notes, stale: () => false }));
  eq((await loadState(storyId)).relationships.Aurora.r, 30, 'restored in code');
  assert(r.applied.some((a) => /Aurora/.test(a.words)));
  /* a standing the pages moved is not touched by the digits */
  const moved = applyMutations(await loadState(storyId), [{ type: 'rel.shift', name: 'Aurora', axis: 'p', delta: 10, cause: 'she ran to him' }]).state;
  await saveState(storyId, moved);
  await withHouse(quiet, () => auditLedger({ connection: HOUSES[0].conn, storyId, brief: 'x', castNotes: notes, stale: () => false }));
  eq((await loadState(storyId)).relationships.Aurora.p, 75, 'a living standing is left to the pages');
});

test('M49-3 any entry can be taken back; a later touch of the same thing refuses with a reason', () => {
  let s = emptyState();
  s = applyMutations(s, [{ type: 'place.set', name: 'the porch' }]).state;              // 0
  s = applyMutations(s, [{ type: 'presence.enter', name: 'Rias' }]).state;             // 1
  s = applyMutations(s, [{ type: 'rel.set', name: 'Aurora', p: 0, r: 0, s: 0, cause: 'the auditor' }]).state; // 2
  s = applyMutations(s, [{ type: 'place.set', name: 'the kitchen' }]).state;           // 3
  const r = undoEntry(s, 2);
  assert(r && r.state, 'the middle entry is taken back on its own');
  assert(!r.state.relationships.Aurora, 'Aurora’s standing is as it was before');
  eq(r.state.place.name, 'the kitchen', 'nothing else moved');
  const blocked = undoEntry(r.state, 0);
  assert(blocked && blocked.refused && /later change touched the same thing/.test(blocked.refused), 'the porch cannot be taken back under the kitchen');
  const ok = undoEntry(r.state, 3);
  eq(ok.state.place.name, 'the porch', 'the kitchen first, then the porch is free');
  eq(undoTarget({ kind: 'rel.restore', name: 'Aurora' }), 'rel:aurora');
  assert(undoLast(s), 'undoLast still works');
});
