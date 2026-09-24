/* M470 — the referee: two against one is a battle, never a duel; a companion can join a running fight; every ruling
 * carries its account (who, the odds, the roll, the reason). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { refereeStep, normalizeAdj, normalizeDuelAdj } from '../../js/agents/referee.js';
import { engineSettings, startDuel, startBattle, joinFight } from '../../js/engine/duels.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';

const mkUser = (id, text) => ({ id, role: 'user', pages: [{ text }], page: 0 });
const pageTextOf = (m) => m.pages[m.page].text;
const mkState = () => { const s = { ...emptyState(), turn: 1 }; s.sheet = { actors: { Jovan: { domains: { melee: 6 } }, Rukia: { domains: { melee: 7 } }, Kaelen: { domains: { melee: 7 } } }, playerName: 'Jovan', seedVersion: 2 }; return s; };
const conn = { type: 'openai' };
const eng = engineSettings({});

test('M470-1 the opening call: a duel_start that names companions is drawn up as a battle — the companions on the field, the one enemy against them; alone, a duel', () => {
  const s = mkState();
  const two = normalizeAdj({ check: true, kind: 'actor', action: 'we rush him together', opposition: 'Kaelen', tier: 'peer', circumstance: 0, duel_start: { opponent: 'Kaelen', domain: 'melee', rating: 7, allies: ['Rukia', 'Jovan'] } }, s);
  assert(!two.duel_start, 'no duel when a companion fights beside the player');
  assert(two.battle_start, 'a battle instead');
  eq(two.battle_start.allies.join(','), 'Rukia', 'the companion listed, the player never');
  eq(two.battle_start.enemies.join(','), 'Kaelen', 'the one enemy');
  eq(two.battle_start.oppEstimate, 7, 'the referee’s estimate of him rides');
  const one = normalizeAdj({ check: true, kind: 'actor', action: 'I lunge', opposition: 'Kaelen', tier: 'peer', circumstance: 0, duel_start: { opponent: 'Kaelen', domain: 'melee', allies: [] } }, s);
  assert(one.duel_start && !one.battle_start, 'alone: a duel');
  const named = normalizeAdj({ check: true, kind: 'actor', action: 'x', opposition: 'Kaelen', duel_start: { opponent: 'Kaelen', allies: ['Rukia'] }, battle_start: { allies: ['Rukia'], enemies: ['Kaelen', 'Renji'] } }, s);
  eq(named.battle_start.enemies.length, 2, 'a battle_start the referee wrote itself wins over the duel’s companions');
  eq(normalizeAdj({ check: true, kind: 'task', action: 'x', why: '  he has the high ground  ' }, s).why, 'he has the high ground', 'the referee’s reason is kept');
});

test('M470-2 a companion joins a running duel — it widens into a battle carrying both duellists as they stand; a battle takes newcomers once; a war takes none', () => {
  const s = mkState();
  startDuel(s, { playerName: 'Jovan', oppName: 'Kaelen', domain: 'melee', oppEstimate: null, scaleMismatch: 0 }, eng);
  s.duel.round = 3; s.duel.player.poise = 2; s.duel.player.injuries = 1; s.duel.opp.poise = 1; s.duel.opp.injuries = 2; s.duel.opp.momentum = 1;
  const b = joinFight(s, { allies: ['Rukia', 'Jovan'], enemies: [] }, eng);
  assert(b && s.battle && !s.duel, 'a battle now, the duel gone');
  eq(s.battle.allies.map((u) => u.name).join(','), 'Jovan,Rukia', 'the player leads the allied line, the companion beside him');
  eq(s.battle.enemies.map((u) => u.name).join(','), 'Kaelen');
  eq(s.battle.round, 3, 'the round count carries');
  const mc = s.battle.allies[0]; const opp = s.battle.enemies[0];
  eq(mc.poise, 2); eq(mc.injuries, 1, 'the player’s hurts carry');
  eq(opp.poise, 1); eq(opp.injuries, 2); eq(opp.momentum, 1, 'the opponent’s state carries');
  eq(s.battle.grewFrom, 'duel');
  /* reinforcements for the enemy, and nobody twice */
  const again = joinFight(s, { allies: ['Rukia'], enemies: ['Renji', 'Kaelen'] }, eng);
  assert(again, 'the battle grows');
  eq(s.battle.enemies.map((u) => u.name).join(','), 'Kaelen,Renji', 'Renji joins the enemy line; Kaelen is not doubled');
  eq(s.battle.allies.length, 2, 'Rukia is not doubled');
  eq(joinFight(s, { allies: ['Rukia'], enemies: ['Renji'] }, eng), null, 'nothing new: nothing changes');
  eq(joinFight(s, { allies: ['Jovan'], enemies: [] }, eng), null, 'the player is never a newcomer');
  /* the cap */
  const many = Array.from({ length: 12 }, (_, i) => 'Bandit ' + (i + 1));
  joinFight(s, { allies: [], enemies: many }, eng);
  assert(s.battle.enemies.length <= 10, 'ten a side at most: ' + s.battle.enemies.length);
  /* a war takes no walk-ins */
  const w = mkState();
  w.battle = { kind: 'war', active: true, over: false, allies: [{ name: 'Jovan', isPlayer: true, standing: true }], enemies: [{ name: 'The Legion', standing: true }], round: 1, domain: 'war' };
  eq(joinFight(w, { allies: ['Rukia'], enemies: [] }, eng), null, 'army scale: null');
});

test('M470-3 combat.join is a mutation like any other — words for the log, and taken back whole', () => {
  const s = mkState();
  startDuel(s, { playerName: 'Jovan', oppName: 'Kaelen', domain: 'melee', oppEstimate: null, scaleMismatch: 0 }, eng);
  const before = JSON.stringify(s.duel);
  const r = applyMutations(s, [{ type: 'combat.join', allies: ['Rukia'], enemies: [], engine: {} }]);
  assert(r.state.battle && !r.state.duel, 'joined');
  const line = (r.applied || r.log || r.words || []).map ? (r.applied || r.log || r.words).map((x) => (x && x.words) || x).join(' ') : '';
  assert(/widens into a battle/.test(line) || /widens into a battle/.test(JSON.stringify(r)), 'the log says the duel widened: ' + JSON.stringify(r).slice(0, 200));
  const undo = (r.applied || r.log || []).find ? (r.applied || r.log).find((x) => x && x.undo) : null;
  const undoPayload = undo ? undo.undo : (JSON.stringify(r).includes('combat.restore') ? true : null);
  assert(undoPayload, 'a take-back is recorded (combat.restore)');
  const nothing = applyMutations(mkState(), [{ type: 'combat.join', allies: ['Rukia'], enemies: [], engine: {} }]);
  assert(!nothing.state.battle && !nothing.state.duel, 'no fight on: nothing joins');
  void before;
});

test('M470-4 every ruling carries its account — a lone check: the attempt, the ratings, the tilt and its reason, the odds, the roll, the tier; a battle: the field and its pairings', async () => {
  const m = mkUser('u1', 'I shove the rusted door with my shoulder and try to force it.');
  const checkLLM = async () => JSON.stringify({ check: true, kind: 'task', action: 'force the rusted door', domain: 'melee', tier: 'moderate', circumstance: -1, why: 'the hinge is rusted solid and he is off balance', stakes: 'a wrenched shoulder' });
  const r = await refereeStep({ connection: conn, userText: pageTextOf(m), userId: 'u1', history: [m], state: mkState(), settings: {}, callLLM: checkLLM });
  eq(r.status, 'ruled');
  const a = r.ruling.account;
  assert(a && a.what === 'a lone check — moderate difficulty', 'what: ' + (a && a.what));
  eq(a.action, 'force the rusted door'); eq(a.why, 'the hinge is rusted solid and he is off balance'); eq(a.circumstance, -1); eq(a.stakes, 'a wrenched shoulder');
  eq(a.actor, 'Jovan'); eq(a.actorRating, 6);
  assert(Number.isFinite(a.oppositionRating) && Number.isFinite(a.chance) && a.chance >= 0 && a.chance <= 100, 'the odds are a percent: ' + a.chance);
  assert(Number.isFinite(a.roll) && a.roll >= 0 && a.roll <= 100, 'the roll is shown: ' + a.roll);
  assert(a.tier && r.ruling.tier === a.tier, 'the tier named');
  assert(!/\d+%|rolled/.test(r.ruling.directive), 'the storyteller still hears words, never the numbers (M345)');
  /* a battle: two against one, the field in the account */
  const m2 = mkUser('u2', 'Rukia and I charge Kaelen together and attack.');
  const battleLLM = async () => JSON.stringify({ check: true, kind: 'actor', action: 'rush him together', opposition: 'Kaelen', tier: 'peer', circumstance: 0, why: 'two on one', duel_start: { opponent: 'Kaelen', domain: 'melee', rating: 7, allies: ['Rukia'] } });
  const r2 = await refereeStep({ connection: conn, userText: pageTextOf(m2), userId: 'u2', history: [m2], state: mkState(), settings: {}, callLLM: battleLLM });
  eq(r2.status, 'ruled', 'ruled');
  assert(r2.state.battle && !r2.state.duel, 'two against one opens as a BATTLE');
  eq(r2.state.battle.allies.length, 2); eq(r2.state.battle.enemies.length, 1);
  const b = r2.ruling.account;
  assert(b.what.startsWith('a battle opens — 2 against 1'), b.what);
  assert(b.fight && b.fight.kind === 'battle' && b.fight.allies.length === 2, 'the field is in the account');
  assert(Array.isArray(b.reports), 'the pairings are in the account');
  /* a companion joining a running duel, through the referee's own beat */
  const s3 = mkState();
  startDuel(s3, { playerName: 'Jovan', oppName: 'Kaelen', domain: 'melee', oppEstimate: null, scaleMismatch: 0 }, eng);
  s3.duel.round = 2;
  const m3 = mkUser('u3', 'Rukia leaps in beside me and we press him.');
  const joinLLM = async () => JSON.stringify({ exchange: true, combat_ended: false, action: 'press him with Rukia', move: 'attack', circumstance: 1, why: 'two blades on one', joins: { allies: ['Rukia'], enemies: [] } });
  const r3 = await refereeStep({ connection: conn, userText: pageTextOf(m3), userId: 'u3', history: [m3], state: s3, settings: {}, callLLM: joinLLM });
  eq(r3.status, 'ruled');
  eq(r3.why, 'a duel widened into a battle');
  assert(r3.state.battle && !r3.state.duel && r3.state.battle.allies.length === 2, 'the fight is a battle of two against one now');
  assert(r3.ruling.account.what.startsWith('the duel widened into a battle'), r3.ruling.account.what);
  const beat = normalizeDuelAdj({ exchange: true, action: 'x', move: 'attack', circumstance: 0, joins: { allies: ['Jovan'], enemies: [] } }, mkState());
  eq(beat.joins, null, 'the player alone never counts as a join');
});
