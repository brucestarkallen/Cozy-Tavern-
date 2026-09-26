/* M505 — OUTCOME ONLY: every ruling states what happened and hands the story back in one line. Built for real through
 * the engine (single strike, chain, battle, war); none carries the old boilerplate, none orders the fight kept open. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { engineSettings, startDuel, startBattle, startWar, buildDuelDirective, buildDuelSequenceDirective, buildBattleDirective, buildWarDirective, HAND_BACK } from '../../js/engine/duels.js';

const ledger = () => applyMutations({ ...emptyState(), page: 12 }, [
  { type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'the Tenth’s courtyard' },
  { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Zaraki' },
]).state;
const BOILERPLATE = /tallied|goes on until|nobody is calling|Taken together|It’s settled|in secret|Keep every consequence|end on a live beat|live tension|nobody lands, yields/i;

test('M505 outcome only: the single strike, the chain, the battle and the war each state what happened and end with the one hand-back — no boilerplate, nothing that keeps the fight open', () => {
  const eng = engineSettings({});
  const st = ledger();
  startDuel(st, { playerName: 'Jovan Oda', oppName: 'Zaraki', domain: 'melee', oppEstimate: 8, scaleMismatch: 0 }, eng);
  const rulings = [
    ['single', buildDuelDirective(st, { action: 'a red-charged groin kick' }, { tier: 'SUCCESS_COST', outcome: true })],
    ['chain', buildDuelSequenceDirective(st, { action: 'a chain' }, { outcome: true, overall: 'SUCCESS', steps: [{ strike: 'burst in and sword clash', tier: 'STALEMATE' }, { strike: 'red-charged groin kick', tier: 'SUCCESS_COST' }] })],
  ];
  const bs = ledger();
  startBattle(bs, { allies: ['Rukia'], enemies: ['Guard x3'], domain: 'melee', scaleMismatch: 0 }, eng);
  rulings.push(['battle', buildBattleDirective(bs, { action: 'sweep through the guards' }, { mcRes: { tier: 'SUCCESS' }, reports: [], outcome: true })]);
  const ws = ledger();
  startWar(ws, { allies: ['Left Flank'], enemies: ['Iron Legion'], enemyCommander: 'Ivar', scaleMismatch: 0 }, eng);
  rulings.push(['war', buildWarDirective(ws, { action: 'flank their right' }, { focalRes: { tier: 'SUCCESS' }, reports: [], outcome: true })]);
  for (const [what, text] of rulings) {
    assert(text.endsWith(HAND_BACK), what + ' ends with the hand-back: ' + text);
    assert(!BOILERPLATE.test(text), what + ' carries boilerplate: ' + text);
    assert(!/\b(?:roll|dice|tier|poise|percent)\b/i.test(text), what + ' breaks persona: ' + text);
  }
  const chain = rulings[1][1];
  assert(/neither lands/.test(chain) && /lands, at a price/.test(chain), 'the chain keeps each strike’s own result: ' + chain);
  eq(chain.split(/(?<=\.) /).length <= 3, true, 'the chain is short: ' + chain);
});
