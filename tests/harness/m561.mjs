/* Cozy Tavern — harness law of M561: his order — "it should watch all the pages, as much as the story remembers; the WHOLE
 * essentials, the WHOLE brief, the detailed fold summary — without context how would it know someone's power, or that
 * someone is injured?" The weighing fills its model's room in a game master's order; the ruling reads the whole brief, the
 * whole story in brief, and each person's evidence beside the numbers. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildSeedUser, buildRefereeUser } from '../../js/agents/referee.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const st = applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Ivar van Emreis' }, { type: 'body.injure', name: 'Ivar van Emreis', what: 'a cracked rib', severity: 'moderate' }]).state;
const brief = 'BRIEF-START Jovan Wessex (16), E-tier in name only. ' + 'b'.repeat(60000) + ' BRIEF-END Ivar van Emreis — the strongest student.';
const essentials = '- (pages 1-2) ESS-OPENING: Jovan parried Ivar\u2019s first strike.\n' + Array.from({ length: 200 }, (_, i) => '- (page ' + (i + 3) + ') the drills went on.').join('\n') + '\n- (page 220) ESS-NEWEST: the rib cracked.';
const record = 'REC-OLDEST the gate.\n' + 'r'.repeat(90000) + '\nREC-NEWEST the yard.';
const pages = [];
for (let i = 0; i < 30; i += 1) { pages.push({ id: 'u' + i, role: 'user', text: 'I move ' + i + '.' }); pages.push({ id: 'a' + i, role: 'assistant', text: 'PAGE-' + i + ' ' + 'p'.repeat(2500) }); }

test('M561-1 THE WEIGHING FILLS ITS MODEL\'S ROOM AS A GAME MASTER READS: on a large model the whole brief, the whole story in brief, the whole detailed record and every page; on a small one the brief is cut with a note, the story in brief keeps its opening and its newest, and the newest pages still ride', () => {
  const big = buildSeedUser({ state: st, pages, brief, essentials, record, room: 1000000, blind: true });
  for (const mark of ['BRIEF-START', 'BRIEF-END', 'ESS-OPENING', 'ESS-NEWEST', 'REC-OLDEST', 'REC-NEWEST', 'PAGE-0 ', 'PAGE-29 ']) assert(big.includes(mark), 'the large room holds ' + mark);
  assert(/cracked rib/.test(big), 'who is hurt rides');
  const small = buildSeedUser({ state: st, pages, brief, essentials, record, room: 40000, blind: true });
  assert(small.includes('BRIEF-START') && /the brief continues/.test(small), 'the brief cut, and said to be');
  assert(small.includes('ESS-OPENING') && small.includes('ESS-NEWEST'), 'the story in brief keeps both ends');
  assert(small.includes('PAGE-29 '), 'the newest page rides');
  assert(small.length < 60000, 'and it stays inside its room: ' + small.length);
});

test('M561-2 THE RULING READS THE WHOLE BRIEF, THE WHOLE STORY IN BRIEF, WHO IS HURT, AND EACH PERSON\'S EVIDENCE BESIDE THE NUMBERS', () => {
  const s = { ...st, sheet: { playerName: 'Jovan Wessex', actors: { 'Jovan Wessex': { default: 6, domains: { melee: 8 }, why: 'parried Ivar in the opening scene', _auto: true }, 'Ivar van Emreis': { default: 7, domains: { melee: 8 }, why: 'the strongest student', _auto: true } } } };
  const shortBrief = 'BRIEF-START ' + 'b'.repeat(30000) + ' BRIEF-END';
  const u = buildRefereeUser({ state: s, userText: 'I lunge at Ivar.', history: pages.slice(-4), brief: shortBrief, essentials });
  assert(u.includes('BRIEF-END'), 'a 30,000-character brief rides whole (it was cut at 12,000)');
  assert(/<story_in_brief>[\s\S]*ESS-OPENING[\s\S]*ESS-NEWEST/.test(u), 'the whole story, told shorter');
  assert(/Jovan Wessex \(the player\): default 6, melee 8 — why: parried Ivar in the opening scene/.test(u), 'his evidence beside his numbers');
  assert(/cracked rib/.test(u), 'who is hurt');
});
