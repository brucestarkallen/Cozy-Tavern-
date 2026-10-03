/* Cozy Tavern — harness law of M566: the brief is held to the workers' shared room (with its "continues" note) in every
 * helper — the choices keeper, the planner and the essentials keeper had taken it raw, however long. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { choiceAsk } from '../../js/agents/choices.js';
import { plannerAsk } from '../../js/agents/planner.js';
import { essentialsAsk } from '../../js/agents/essentials.js';
import { BRIEF_ROOM } from '../../js/engine/whole.js';

test('M566 A LONG BRIEF IS HELD TO THE WORKERS\' SHARED ROOM IN EVERY HELPER, AND SAYS IT CONTINUES — never sent raw past what a smaller model holds', () => {
  const brief = 'BRIEF-HEAD ' + 'b'.repeat(90000) + ' BRIEF-TAIL';
  for (const [name, ask] of [['choices', choiceAsk({ brief, pages: [], newest: 'x' })], ['planner', plannerAsk({ brief, pages: [] })], ['essentials', essentialsAsk({ brief, record: '- (pages 1) r' })]]) {
    const u = String(ask.user || '');
    assert(u.includes('BRIEF-HEAD') && !u.includes('BRIEF-TAIL'), name + ': held to its room');
    assert(/the brief continues/.test(u), name + ': and says so');
    assert(u.length < BRIEF_ROOM + 20000, name + ': ' + u.length + ' characters');
  }
});
