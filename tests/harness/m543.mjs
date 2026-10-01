/* Cozy Tavern — harness laws of M543: the window beyond the page is on someone beyond the page (his report: "why does my World
 * Beyond show a character who is in the same scene and on the same page as my MC?"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { renderWorldBrief, windowOnSomeoneHere } from '../../js/engine/world.js';
import * as M from '../../js/assemble/modules.js';

const room = () => applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan Wells' }, { type: 'place.set', name: "8 Mariner's Lane — upstairs hall" }, { type: 'presence.enter', name: 'Jovan Wells' }, { type: 'presence.enter', name: 'Rias Wells' }]).state;
const brief = (who) => ({ pressure: ['Chloe is at the door.'], ripe: [], twb: { who, where: 'number 10', changed: 'she decides to walk over early' }, voices: [], atTurn: 20, atPage: 20 });

test('M543-1 NO WINDOW ON SOMEONE IN THE SCENE: a window the world agent opened on Rias — standing in the hall with him — or on the main character is not opened and not told; a window on Aurora, at home at number 10, is', async () => {
  const st = room();
  eq(windowOnSomeoneHere(brief('Rias Wells'), st), true, 'Rias is here');
  eq(windowOnSomeoneHere(brief('Jovan Wells'), st), true, 'the main character is the page itself');
  eq(windowOnSomeoneHere(brief('Aurora Sterling'), st), false, 'Aurora is beyond the page');
  assert(!/A window into the world beyond/.test(renderWorldBrief(brief('Rias Wells'), 20, 20, st)), 'the storyteller is not told of a window on Rias');
  assert(/A window into the world beyond is open this turn[^\n]*Aurora Sterling/.test(renderWorldBrief(brief('Aurora Sterling'), 20, 20, st)), 'it is told of the window on Aurora');
  assert(/Chloe is at the door/.test(renderWorldBrief(brief('Rias Wells'), 20, 20, st)), 'the rest of the world\'s word still rides');
  /* the window's craft rule, through the real selection */
  const mods = await M.listModules(); /* the house's own rules, as the app loads them (each with its trigger) */
  const wakes = (who) => M.selectModules(mods, { ...st, worldBrief: brief(who) }).some((c) => (c.mod || c).id === 'world-window');
  eq(wakes('Rias Wells'), false, 'the window\'s craft does not wake for Rias');
  eq(wakes('Aurora Sterling'), true, 'it wakes for Aurora');
});
