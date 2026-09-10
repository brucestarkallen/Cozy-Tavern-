/* M50 — the brief's digits read the way the brief is shaped; junk and duplicates cleaned in code; the rebuild. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { explicitStandings, samePersonLoose } from '../../js/agents/founder.js';
import { standingsHousekeeping, rebuildStandings, buildRebuildMessages } from '../../js/agents/auditor.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

const BRIEF = `Aurora Sterling
Best friend, ex-idol.
→ Jovan: childhood best friend, reunion stirring she won't name (P:65 R:30 S:5)
→ Vanessa Reynolds: rival at school (P:70 R:0 S:0)

Rias Wells — devoted older sister (P:85 R:65 S:45)

Caleb Thorne
→ Rias: still possessive (P:20 R:5 S:5)
→ Jovan: never met`;

test('M50-1 the writer’s shape: a heading owns its → Jovan line; a → line toward anyone else is not a standing; the MC owns nothing', () => {
  const out = explicitStandings(BRIEF, 'Jovan');
  eq(out.map((s) => s.name + ':' + s.p + '/' + s.r + '/' + s.s).join(' | '), 'Aurora Sterling:65/30/5 | Rias Wells:85/65/45');
  assert(!out.some((s) => /^→|Jovan|Vanessa|Caleb/.test(s.name)), 'no arrows, no MC, no NPC-to-NPC');
  eq(explicitStandings(BRIEF, '').length, 1, 'without a known MC only inline standings are read (Rias)');
  assert(samePersonLoose('Rias', 'Rias Wells') && !samePersonLoose('Rias', 'Aurora'));
});

test('M50-2 housekeeping in code: junk keys go, duplicates merge to the fuller name, the brief’s digits are restored, a living standing is left alone', () => {
  let s = emptyState(); s.sheet.playerName = 'Jovan';
  s = applyMutations(s, [
    { type: 'rel.set', name: '→ Jovan', p: 65, r: 30, s: 5, cause: 'x' },
    { type: 'rel.set', name: '→ Vanessa Reynolds', p: 70, r: 0, s: 0, cause: 'x' },
    { type: 'rel.set', name: 'Rias', p: 50, r: 60, s: 25, cause: 'x' },
    { type: 'rel.set', name: 'Rias Wells', p: 0, r: 0, s: 0, cause: 'x' },
    { type: 'rel.set', name: 'Aurora Sterling', p: 0, r: 0, s: 0, cause: 'the auditor' },
    { type: 'rel.set', name: 'Sophie Dale', p: 12, r: 0, s: 0, cause: 'the page' },
  ]).state;
  const fixes = standingsHousekeeping(s, BRIEF, '', 'Jovan');
  const after = applyMutations(s, fixes).state;
  const keys = Object.keys(after.relationships);
  assert(!keys.some((k) => /^→/.test(k)), 'arrow keys gone: ' + keys.join(', '));
  assert(!keys.includes('Rias'), 'the shorter duplicate gone');
  eq(after.relationships['Rias Wells'].r, 60, 'the numbers moved to the fuller name');
  eq(after.relationships['Aurora Sterling'].p, 65, 'restored from the brief');
  eq(after.relationships['Sophie Dale'].p, 12, 'a living standing untouched');
});

test('M50-3 the rebuild: everything let go, the digits written in code, the model’s rel.set kept only toward the MC with a cause naming him', async () => {
  const storyId = 'm50';
  let s = emptyState(); s.sheet.playerName = 'Jovan';
  s.characters = { 'Aurora Sterling': { core: 'x' }, 'Sophie Dale': { core: 'y' }, Vanessa: { core: 'z' } };
  s = applyMutations(s, [{ type: 'rel.set', name: '→ Jovan', p: 65, r: 30, s: 5, cause: 'x' }, { type: 'rel.set', name: 'Alaric', p: 70, r: 0, s: 0, cause: 'x' }]).state;
  await saveState(storyId, s);
  await db.messages.append(storyId, { role: 'assistant', text: 'Sophie waited for Jovan at the gate.' });
  const answer = JSON.stringify({ mutations: [
    { type: 'rel.set', name: 'Sophie Dale', p: 20, r: 5, s: 0, cause: 'the record: Sophie waited for Jovan at the gate' },
    { type: 'rel.set', name: 'Vanessa', p: 70, r: 0, s: 0, cause: 'rival of Aurora' },
    { type: 'rel.set', name: 'Jovan', p: 50, r: 0, s: 0, cause: 'Jovan' },
    { type: 'offscreen.set', name: 'x', location: 'y', activity: 'z' },
  ] });
  const house = thinkingHouse({ answer });
  const r = await withHouse(house, () => rebuildStandings({ connection: HOUSES[0].conn, storyId, brief: BRIEF, stale: () => false }));
  eq(r.cleared, 2); eq(r.digits, 2);
  const st = await loadState(storyId);
  const keys = Object.keys(st.relationships).sort();
  eq(keys.join(','), 'Aurora Sterling,Rias Wells,Sophie Dale');
  eq(st.relationships['Sophie Dale'].p, 20);
  eq(r.rejected.length, 3, 'Vanessa (cause names Aurora), Jovan (the MC), the seat');
  const p = buildRebuildMessages({ state: st, brief: BRIEF, castNotes: '', record: 'r', pages: [], mc: 'Jovan' });
  assert(/exist ONLY toward the main character/.test(p.user) && /THE PEOPLE THE LEDGER KNOWS: /.test(p.user) && !/THE PEOPLE THE LEDGER KNOWS:[^\n]*Jovan/.test(p.user));
});

test('M50-4 a label is never a person: "CORE: … (P R S)" under a heading belongs to the heading; a CORE entry is cleared', () => {
  const brief = `Rias Wells
CORE: devoted older sister with a secret romantic attachment (P:85 R:65 S:45)
ARC: hasn't seen him in years

Aurora Sterling
→ Jovan: childhood best friend (P:65 R:30 S:5)

Caleb Thorne — Rias's ex, never met Jovan`;
  const out = explicitStandings(brief, 'Jovan');
  eq(out.map((s) => s.name + ':' + s.p).join(' | '), 'Rias Wells:85 | Aurora Sterling:65');
  let s = emptyState(); s.sheet.playerName = 'Jovan';
  s = applyMutations(s, [{ type: 'rel.set', name: 'CORE', p: 85, r: 65, s: 45, cause: 'x' }, { type: 'rel.set', name: 'Rias Wells', p: 0, r: 0, s: 0, cause: 'x' }]).state;
  const after = applyMutations(s, standingsHousekeeping(s, brief, '', 'Jovan')).state;
  assert(!after.relationships.CORE, 'the label entry is gone');
  eq(after.relationships['Rias Wells'].p, 85, 'and Rias has her digits');
});
