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

test('M51 the auditor, the rebuild and the mender read the WHOLE record, not the summarizer’s 14k tail', async () => {
  const { wholeRecord, recordFor, saveMemory, loadMemory, CONTEXT_CAP } = await import('../../js/agents/memory.js');
  const nodes = Array.from({ length: 200 }, (_, i) => ({ id: 'n' + i, span: [i * 6, i * 6 + 5], text: '[Day ' + i + '] line ' + i + ' ' + 'x'.repeat(100), level: 1, at: i }));
  const mem = { window: 30, nodes };
  const whole = wholeRecord(mem);
  const tail = recordFor(mem);
  assert(whole.includes('[Day 0]'), 'the founding is in the whole record');
  assert(!tail.includes('[Day 0]') && tail.length <= CONTEXT_CAP, 'the summarizer’s tail drops it');
  const src = (await import('node:fs')).readFileSync(new URL('../../js/agents/auditor.js', import.meta.url), 'utf8');
  assert(!/recordFor\(/.test(src) && /wholeRecord\(mem\)/.test(src), 'the auditor and the rebuild read the whole record');
  const chat = (await import('node:fs')).readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/record: wholeRecord\(mem\)/.test(chat), 'the mender too');
});

test('M57-002 the writer’s exact block: a CORE line WITHOUT digits is not a heading — Aurora owns her → Jovan line', () => {
  const brief = `Rias Wells
CORE: devoted older sister with a secret romantic attachment (P:85 R:65 S:45)

Aurora Sterling
CORE: Warm, sociable, quietly perceptive; trusted by classmates and firm when it matters. Forms deep, steady attachments early and holds onto them.
→ Jovan: childhood best friend, reunion stirring she won't name (P:65 R:30 S:5)
→ Claire Stone: close friend and the one who says what Aurora won't (P:60 R:0 S:0)`;
  const out = explicitStandings(brief, 'Jovan');
  eq(out.map((s) => s.name + ':' + s.p + '/' + s.r + '/' + s.s).join(' | '), 'Rias Wells:85/65/45 | Aurora Sterling:65/30/5');
  let s = emptyState(); s.sheet.playerName = 'Jovan';
  s = applyMutations(s, [{ type: 'rel.set', name: 'CORE', p: 85, r: 65, s: 45, cause: 'x' }, { type: 'rel.set', name: 'Aurora Sterling', p: 0, r: 0, s: 0, cause: 'the brief gives no bond' }]).state;
  const after = applyMutations(s, standingsHousekeeping(s, brief, '', 'Jovan')).state;
  assert(!after.relationships.CORE, 'CORE cleared');
  eq(after.relationships['Aurora Sterling'].r, 30, 'Aurora restored from her own line');
});

test('M57-003 a heading is a person, never a group; a blank line ends a block; commas and parentheticals after the name are fine; an unrecognized block owns nothing', () => {
  const brief = `Vanderbilt family
Old money. Owns half the marina.

Rias Wells, 18, senior
CORE: devoted older sister with a secret romantic attachment (P:85 R:65 S:45)

Aurora Sterling (17)
CORE: Warm, sociable, quietly perceptive.
→ Jovan: childhood best friend, reunion stirring she won't name (P:65 R:30 S:5)
→ Claire Stone: close friend (P:60 R:0 S:0)

Ravenwood High
The school. (P:1 R:0 S:0)

?? Some Unknown Format ??
CORE: whatever (P:50 R:50 S:50)`;
  const out = explicitStandings(brief, 'Jovan');
  eq(out.map((s) => s.name + ':' + s.p).join(' | '), 'Rias Wells:85 | Aurora Sterling:65', JSON.stringify(out));
  assert(!out.some((s) => /Vanderbilt|Ravenwood|Unknown|CORE/.test(s.name)), 'no group, no school, no label, no stale owner');
  let s = emptyState(); s.sheet.playerName = 'Jovan';
  s = applyMutations(s, [{ type: 'rel.set', name: 'Vanderbilt family', p: 85, r: 65, s: 45, cause: 'x' }]).state;
  const after = applyMutations(s, standingsHousekeeping(s, brief, '', 'Jovan')).state;
  assert(after.relationships['Rias Wells'] && after.relationships['Rias Wells'].p === 85, 'Rias restored from her own block');
});

test('M58 the model reads the stated standings; code only validates; the line parser is the fallback', async () => {
  const { readStatedStandings, validateStatedStandings, buildStatedStandingsMessages } = await import('../../js/agents/founder.js');
  const v = validateStatedStandings([
    { name: 'Aurora Sterling', p: 65, r: 30, s: 5 },
    { name: 'CORE', p: 85, r: 65, s: 45 },
    { name: 'Vanderbilt family', p: 1, r: 0, s: 0 },
    { name: 'Jovan', p: 50, r: 0, s: 0 },
    { name: 'Aurora', p: 1, r: 1, s: 1 },
    { name: 'Rias Wells (18)', p: 85, r: 65, s: 45 },
  ], 'Jovan');
  eq(v.map((x) => x.name + ':' + x.p).join(' | '), 'Aurora Sterling:65 | Rias Wells:85', 'labels, groups, the MC out; the same person once');
  const p = buildStatedStandingsMessages({ brief: 'b', castNotes: 'c', mc: 'Jovan' });
  assert(/WHOSE stance it is and TOWARD WHOM/.test(p.user) && /section labels, never\s*people/.test(p.user.replace(/\n/g, ' ')));
  /* the model's reading wins */
  const house = thinkingHouse({ answer: '{"standings":[{"name":"Rias Wells","p":85,"r":65,"s":45},{"name":"CORE","p":1,"r":1,"s":1}]}' });
  const read = await withHouse(house, () => readStatedStandings({ connection: HOUSES[0].conn, brief: 'anything', mc: 'Jovan' }));
  eq(read.map((x) => x.name).join(','), 'Rias Wells');
  /* nothing usable → the parser */
  const dumb = thinkingHouse({ answer: 'no idea' });
  const fb = await withHouse(dumb, () => readStatedStandings({ connection: HOUSES[0].conn, brief: 'Rias Wells — sister (P:85 R:65 S:45)', mc: 'Jovan' }));
  eq(fb.length, 1); eq(fb[0].p, 85);
  eq((await readStatedStandings({ connection: null, brief: '', mc: 'Jovan' })).length, 0);
});
