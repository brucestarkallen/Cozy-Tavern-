/* M48 — the auditor may not take a standing away on judgment. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { auditLedger, buildAuditorMessages } from '../../js/agents/auditor.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

test('M48-1 a standing earned on the pages, or for a person the brief names, is never zeroed by the auditor; since M689 no standing is the auditor’s to move, the Caleb case included', async () => {
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
  ], standings: [] });
  const house = thinkingHouse({ answer });
  const r = await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId, brief: 'Jovan comes home. Mira is his sister.', castNotes: '', stale: () => false }));
  const st = await loadState(storyId);
  /* M259: how far a beat moves a standing is the PAGE READER's (one writer per fact, M131).
   * The auditor re-reads up to forty pages every turn and sees only the latest causes, so a
   * shift from it counts a beat the extractor already counted — a standing that climbs every
   * turn. Its rel.shift is dropped; Aurora stands where the pages put her. */
  eq(st.relationships.Aurora.p, 48, 'Aurora stands (earned on the page); the auditor does not move her');
  eq(st.relationships.Mira.p, 30, 'Mira stands (the brief names her)');
  /* M689 (docs/LEDGER-PIPELINE-M689.md): "Numeric auditor suggestions cannot replace Scene's judgments" — the auditor's
   * standing moves never land, the zeroing of a feeling written for someone else included; each is counted, never written */
  eq(st.relationships.Caleb.p, 35, 'Caleb’s standing is not the auditor’s to zero either');
  eq(r.rejected.filter((x) => x.standing && /relationship judgments belong to Scene/.test(x.why)).length, 4, 'all four standing moves are refused as the page reader’s');
  eq(r.leftStandings, 4, 'and counted for the workers line');
  eq(r.issues.length, 0, 'none of them is a finding (M277) — the beat the auditor would add included');
  assert(!(r.pending || []).some((p) => /Aurora|Mira|Caleb/.test(p)), 'nor left pending for the next reading: ' + JSON.stringify(r.pending));
  const p = buildAuditorMessages({ state: st, pages: [{ role: 'assistant', text: 'x' }] });
  assert(/THE STANDINGS are not yours to write: never rel\.set, rel\.shift or rel\.clear/.test(p.system) && /Never zero a real bond/.test(p.system), 'lowering on judgment is banned — no standing is the auditor’s to write');
  assert(/the house restores the brief's explicit starting digits, axis by axis, only before earned changes/.test(p.system) && /never invent scores from a bond description/.test(p.system), 'and the auditor is told the brief’s digits are restored apart from it, never invented from a bond');
  /* restoring a zeroed standing: never from a bond the brief only describes — from the brief’s explicit digits, by the house */
  const zeroed = applyMutations(st, [{ type: 'rel.set', name: 'Mira', p: 0, r: 0, s: 0, cause: 'set down by hand' }]).state;
  await saveState(storyId, zeroed);
  const restoreMove = { what: 'Mira, his sister per the brief, stands at zero', fix: 'restore', mutations: [{ type: 'rel.set', name: 'Mira', p: 30, r: 0, s: 0, cause: 'the brief says Mira is his devoted sister' }] };
  await withHouse(thinkingHouse({ answer: JSON.stringify({ issues: [restoreMove], standings: [] }) }), () => auditLedger({ connection: HOUSES[0].conn, storyId, brief: 'Mira is his sister.', stale: () => false }));
  eq((await loadState(storyId)).relationships.Mira.p, 0, 'a bond the brief only describes is not turned into a number');
  const r2 = await withHouse(thinkingHouse({ answer: JSON.stringify({ issues: [restoreMove], standings: [{ name: 'Mira', p: 30, r: 0, s: 0 }] }) }), () => auditLedger({ connection: HOUSES[0].conn, storyId, brief: 'Mira — his sister (P:30 R:0 S:0).', stale: () => false }));
  eq((await loadState(storyId)).relationships.Mira.p, 30, 'restored — from the brief’s explicit digits');
  assert(r2.applied.some((a) => a.mutation.type === 'rel.set' && a.mutation.name === 'Mira' && /explicit starting digits/.test(a.mutation.cause)), 'written by the house, not the auditor');
});

test('M48-2 the auditor is never asked for a standing it may not write — the request it is sent offers no rel.* and asks for the brief’s digits as a list', async () => {
  const storyId = 'm48-request';
  let s = emptyState(); s.sheet.playerName = 'Jovan';
  s = applyMutations(s, [{ type: 'rel.set', name: 'Mira', p: 30, r: 0, s: 0, cause: 'the brief says Mira is his sister' }]).state;
  await saveState(storyId, s);
  await db.messages.append(storyId, { role: 'user', text: 'I come home.' });
  await db.messages.append(storyId, { role: 'assistant', text: 'Mira waved from the porch.' });
  const house = thinkingHouse({ answer: JSON.stringify({ issues: [{ what: 'Mira should stand higher', fix: 'P:40', mutations: [{ type: 'rel.set', name: 'Mira', p: 40, cause: 'the brief says' }] }], standings: [] }) });
  const r = await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId, brief: 'Mira is his sister.', stale: () => false }));
  assert(house.calls.length >= 1, 'the auditor read');
  /* M689 (cf9bd4a): judgeAudit refuses every rel.* the auditor proposes — what it is SENT must not invite one */
  for (const call of house.calls) {
    const sent = call.body.messages.map((m) => String(m.content || '')).join('\n');
    assert(!/\brel\.(?:set|shift|clear) \{/.test(sent), 'no standing operation is offered in its vocabulary');
    assert(!/\(rel\.set with the cause|or\s+rel\.set with the cause|a standing\s+wrongly\s+zero|Zero a wrong-owner standing|only to restore a standing that is wrongly zero/.test(sent), 'no instruction asks it to restore, zero or set a standing');
    assert(/THE STANDINGS are not yours to write: never rel\.set, rel\.shift or rel\.clear/.test(sent), 'it is told standings are not its to write');
  }
  /* the house's path for explicit starting digits: the standings list in the same combined answer (M708) */
  assert(/Return standings:\[\{name,p,r,s\}\] ONLY for explicit starting digits in the writer brief\/cast TOWARD Jovan/.test(house.calls[0].body.messages.map((m) => String(m.content || '')).join('\n')), 'and is asked for the brief’s explicit digits as a list');
  /* and the door still holds when a model proposes one anyway: counted, never written */
  eq((await loadState(storyId)).relationships.Mira.p, 30, 'the proposed standing move is not written');
  eq(r.leftStandings, 1, 'it is counted for the workers line');
});
