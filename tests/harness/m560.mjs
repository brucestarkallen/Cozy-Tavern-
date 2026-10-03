/* Cozy Tavern — harness law of M560: "why can't it think like a human GM? Jovan parried Ivar in the OPENING scene and it rates
 * his melee 4." The weighing never saw that scene: the newest forty messages, the record's NEWEST part, the brief cut at
 * 15% of its room. It now reads the story in brief (the whole story, oldest first), the brief at twice the room, and must
 * name the evidence for each person — kept, and shown under them in the drawer. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildSeedUser, mergeSeed, SEED_SYSTEM, SEED_VERSION } from '../../js/agents/referee.js';
import { emptyState } from '../../js/engine/state.js';

test('M560 THE WEIGHING SEES THE WHOLE STORY AND SAYS WHY: the story in brief rides oldest first and keeps its opening when it must be shortened; a long brief rides at twice the old room; the evidence comes first and each person\'s "why" is kept', () => {
  const st = { ...emptyState(), mc: { name: 'Jovan Wessex' } };
  const essentials = '- [Day 1 · the gate] (pages 1-2) OPENING: Jovan parried Ivar\u2019s first strike before anyone saw him move.\n' + Array.from({ length: 400 }, (_, i) => '- [Day ' + (i + 2) + '] (page ' + (i + 3) + ') the drills went on, nothing of note, again and again.').join('\n');
  const brief = 'MC — Jovan Wessex (16). ' + 'x'.repeat(20000) + ' IVAR-AT-THE-END: Ivar van Emreis, the strongest student.';
  const u = buildSeedUser({ state: st, pages: [], brief, essentials, record: 'R', room: 120000, blind: true });
  assert(/<story_in_brief>[\s\S]*OPENING: Jovan parried Ivar/.test(u), 'the opening stands, though the story in brief was shortened');
  assert(u.includes('IVAR-AT-THE-END'), 'a 20,000-character brief rides whole at a 120,000 room (it was cut at 18,000)');
  assert(/1\. Read all of it first/.test(SEED_SYSTEM) && /Take every contest and feat in its context/.test(SEED_SYSTEM) && /a little above, level, a little below, or well below when preparation or luck carried it/.test(SEED_SYSTEM) && /"why": string/.test(SEED_SYSTEM), 'evidence first, read in its context (M562: a parry is not equality by itself); the why asked for');
  const s = { ...emptyState(), mc: { name: 'Jovan Wessex' } };
  s.sheet = { playerName: 'Jovan Wessex', actors: { 'Jovan Wessex': { default: 5, domains: { melee: 4 }, _auto: true, seed: SEED_VERSION } } };
  mergeSeed(s, { actors: [{ name: 'Jovan Wessex', why: 'parried Ivar (melee 8) in the opening scene; his brief says he hides his skill', default: 6, domains: { melee: 8 } }] }, { byHand: true });
  eq(s.sheet.actors['Jovan Wessex'].domains.melee, 8);
  eq(s.sheet.actors['Jovan Wessex'].why, 'parried Ivar (melee 8) in the opening scene; his brief says he hides his skill', 'the evidence kept');
  assert(SEED_VERSION >= 7, 'weighed again once');
});
