/* M48 — the auditor may not take a standing away on judgment. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { auditLedger, buildAuditorMessages } from '../../js/agents/auditor.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

test('M48-1 a standing earned on the pages, or for a person the brief names, is never zeroed by the auditor; the Caleb case still is', async () => {
  const storyId = 'm48';
  let s = emptyState(); s.sheet.playerName = 'Jovan';
  /* Aurora: set by the founder from the brief, then moved on a page */
  s = applyMutations(s, [
    { type: 'rel.set', name: 'Aurora', p: 40, r: 20, s: 5, cause: 'the brief says Aurora has loved Jovan since school' },
    { type: 'rel.shift', name: 'Aurora', axis: 'p', delta: 8, cause: 'she waited on the porch for him' },
    { type: 'rel.set', name: 'Mira', p: 30, r: 0, s: 0, cause: 'the brief says Mira is his sister' },
    { type: 'rel.set', name: 'Caleb', p: 35, r: 45, s: 30, cause: 'a crush on Rias' },
  ]).state;
  await saveState(storyId, s);
  await db.messages.append(storyId, { role: 'assistant', text: 'page' });
  const answer = JSON.stringify({ issues: [
    { what: 'Aurora has no bond in the brief', fix: 'zero', mutations: [{ type: 'rel.set', name: 'Aurora', p: 0, r: 0, s: 0, cause: 'the brief gives no bond with Jovan' }] },
    { what: 'Mira has no bond', fix: 'zero', mutations: [{ type: 'rel.set', name: 'Mira', p: 0, r: 0, s: 0, cause: 'no bond' }] },
    { what: 'Caleb’s standing is for Rias', fix: 'zero', mutations: [{ type: 'rel.set', name: 'Caleb', p: 0, r: 0, s: 0, cause: 'the standing was for Rias, not Jovan' }] },
    { what: 'Aurora warmed on the page', fix: 'up', mutations: [{ type: 'rel.shift', name: 'Aurora', axis: 'p', delta: 3, cause: 'the page shows her run to him' }] },
  ] });
  const house = thinkingHouse({ answer });
  const r = await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId, brief: 'Jovan comes home. Mira is his sister.', castNotes: '', stale: () => false }));
  const st = await loadState(storyId);
  eq(st.relationships.Aurora.p, 51, 'Aurora stands (earned on the page) and may still rise');
  eq(st.relationships.Mira.p, 30, 'Mira stands (the brief names her)');
  eq(st.relationships.Caleb.p, 0, 'Caleb, no page behind him and not in the brief, is zeroed');
  eq(r.rejected.filter((x) => /may not take it away/.test(x.why)).length, 2);
  const p = buildAuditorMessages({ state: st, pages: [{ role: 'assistant', text: 'x' }] });
  assert(/NEVER zero a standing because you do not see the bond yourself/.test(p.system) && /the pages move standings, not the auditor/.test(p.system));
});
