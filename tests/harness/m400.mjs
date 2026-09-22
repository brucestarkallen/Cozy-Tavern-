/* M400: the fight style is his edge — heroic's +1 and wider decisive / narrower disaster bands (gritty the reverse)
 * land on the main character's own rolls; another person's lone check rolls as the world is. Runs the real roller. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { resolveCheck } from '../../js/agents/referee.js';
import { engineSettings } from '../../js/engine/duels.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { probFromDelta, sliceOutcome, PRESETS } from '../../js/engine/referee-math.js';

test('M400-1 HEROIC IS HIS EDGE, NOT THE WORLD’S: his own check gets +1; Renji’s check against the world does not', () => {
  const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' }]).state;
  const heroic = engineSettings({ preset: 'heroic' });
  const real = engineSettings({ preset: 'realistic' });
  const check = (actor, eng) => resolveCheck(state, { actor, kind: 'task', tier: 'moderate', opposition: 'moderate', circumstance: 0 }, eng).delta;
  eq(check('Jovan Oda', heroic) - check('Jovan Oda', real), 1, 'his own roll: +1 under heroic');
  eq(check('Renji Abarai', heroic) - check('Renji Abarai', real), 0, 'another’s lone check: the world as it is');
});

test('M400-2 THE STYLES ARE REAL NUMBERS, NOT A LABEL: an even fight — heroic wins more and almost never falls apart; gritty wins as often but pays and breaks more', () => {
  const dist = (name, delta) => {
    const p = PRESETS[name]; const P = probFromDelta(delta + p.bonus); const out = {}; const N = 20000;
    for (let i = 0; i < N; i += 1) { const t = sliceOutcome(P, (i + 0.5) / N, p.mods); out[t] = (out[t] || 0) + 1 / N; }
    return { win: P, ...out };
  };
  const r = dist('realistic', 0); const h = dist('heroic', 0); const g = dist('gritty', 0);
  assert(h.win > r.win + 0.1, 'heroic wins more: ' + h.win.toFixed(2) + ' vs ' + r.win.toFixed(2));
  assert(h.DISASTER < r.DISASTER / 2, 'heroic almost never falls apart');
  assert(Math.abs(g.win - r.win) < 1e-9 && g.DISASTER > r.DISASTER && g.SUCCESS_COST > r.SUCCESS_COST, 'gritty: the same odds, dearer wins, more disasters');
});
