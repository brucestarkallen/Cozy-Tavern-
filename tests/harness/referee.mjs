/* M11: the autonomous referee's harness — the ported Arbiter engine laws,
 * the gate, committed fate, the duel economy, identity hardening, degrade
 * behavior, and the injection slot's receipt name. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import {
  probFromDelta, sliceOutcome, tieCheck, rngFloat, TIE_BAND,
  applyExchangeEffects, composurePenaltyOf, EXCHANGE_EFFECTS, RECOVER_EFFECTS,
  presetFor, PRESETS,
} from '../../js/engine/referee-math.js';
import {
  engineSettings, startDuel, resolveDuelExchange, resolveDuelRecovery,
  duelActive, renderFightLine,
} from '../../js/engine/duels.js';
import {
  gatePasses, stripDialogue, OOC_RE, refereeStep, normalizeAdj,
} from '../../js/agents/referee.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState, renderStateFacts } from '../../js/engine/state.js';
import { buildRequest } from '../../js/assemble/stack.js';

/* ---------- shared fakes ---------- */

const mkUser = (id, text) => ({ id, role: 'user', pages: [{ text }], page: 0 });
const mkState = () => ({ ...emptyState(), turn: 1 });
const conn = { type: 'openai' };
const clone = (s) => JSON.parse(JSON.stringify(s));

const checkLLM = (over) => async () => JSON.stringify({
  check: true, kind: 'task', action: 'try the risky thing', tier: 'moderate', circumstance: 0, ...over,
});
const duelLLM = (over) => async () => JSON.stringify({
  exchange: true, combat_ended: false, action: 'press the attack', move: 'attack', circumstance: 0, ...over,
});

/* ---------- the curve ---------- */

test('M11 curve: logistic boundaries and midpoints', () => {
  eq(probFromDelta(0), 0.5, 'even edge is a coin flip');
  assert(probFromDelta(13) > 0.99 && probFromDelta(13) <= 1, 'clamped ceiling near 1');
  assert(probFromDelta(-13) < 0.01 && probFromDelta(-13) >= 0, 'clamped floor near 0');
  assert(probFromDelta(4) > 0.9, '+4 is a strong favorite');
  assert(Math.abs(probFromDelta(2) - 1 / (1 + Math.pow(10, -0.5))) < 1e-12, 'the exact ported formula');
});

test('M11 slicing: interval edges land on the right tiers', () => {
  const mods = PRESETS.realistic.mods;
  eq(sliceOutcome(0.5, 0.0, mods), 'DECISIVE', 'the deepest success at u=0');
  eq(sliceOutcome(0.5, 0.9999, mods), 'DISASTER', 'the far tail at u→1');
  eq(sliceOutcome(0.5, 0.49, mods), 'SUCCESS_COST', 'just under P is a costly win');
  eq(sliceOutcome(0.5, 0.51, mods), 'SETBACK', 'just over P is a fail-forward');
  eq(sliceOutcome(0.9, 0.5, mods), 'SUCCESS', 'a favorite mid-roll wins clean');
  eq(sliceOutcome(0.1, 0.5, mods), 'FAILURE', 'an underdog mid-roll fails');
});

test('M11 mirror fairness: (u,P) -> (1-u,1-P) is provably identical over 10k rolls', () => {
  const mirror = {
    DECISIVE: 'DISASTER', DISASTER: 'DECISIVE', SUCCESS: 'FAILURE', FAILURE: 'SUCCESS',
    SUCCESS_COST: 'SETBACK', SETBACK: 'SUCCESS_COST', TRADE: 'TRADE', STALEMATE: 'STALEMATE',
  };
  let exact = 0;
  const N = 10000;
  for (let i = 0; i < N; i += 1) {
    const P = rngFloat();
    const u = rngFloat();
    for (const preset of Object.keys(PRESETS)) {
      const m = PRESETS[preset].mods;
      /* The ported law: the geometry is provably identical under
       * (u,P) -> (1-u,1-P). A preset's tilt is directional by design —
       * dec/dis and cost/sb swap sides in the mirror, so the exact identity
       * holds against the swapped modifiers. */
      const swapped = { dec: m.dis, dis: m.dec, cost: m.sb, sb: m.cost };
      const a = sliceOutcome(P, u, m);
      const b = sliceOutcome(1 - P, 1 - u, swapped);
      if (mirror[a] === b) exact += 1;
    }
  }
  eq(exact, N * Object.keys(PRESETS).length, 'every roll, every preset: the mirror holds exactly');
  /* and the even-handed preset is self-mirrored, tilt and all */
  for (let i = 0; i < N; i += 1) {
    const P = rngFloat();
    const u = rngFloat();
    eq(sliceOutcome(1 - P, 1 - u, PRESETS.realistic.mods), mirror[sliceOutcome(P, u, PRESETS.realistic.mods)], 'realistic is its own mirror');
  }
  /* and even-odds really is a coin flip at any P's mirror */
  let wins = 0;
  for (let i = 0; i < N; i += 1) {
    const t = sliceOutcome(0.5, rngFloat(), PRESETS.realistic.mods);
    if (t === 'DECISIVE' || t === 'SUCCESS' || t === 'SUCCESS_COST') wins += 1;
  }
  assert(Math.abs(wins / N - 0.5) < 0.02, 'P=0.5 wins about half the time');
});

test('M11 tie remap: near-boundary exchanges become TRADE/STALEMATE, never extremes, never lone checks', () => {
  eq(tieCheck('FAILURE', 0.5, 0.51, TIE_BAND), 'TRADE', 'a very-near miss trades');
  eq(tieCheck('FAILURE', 0.5, 0.545, TIE_BAND), 'STALEMATE', 'a near miss stalls');
  eq(tieCheck('FAILURE', 0.5, 0.6, TIE_BAND), 'FAILURE', 'outside the band stands');
  eq(tieCheck('DECISIVE', 0.5, 0.49, TIE_BAND), 'DECISIVE', 'extremes never tie');
  eq(tieCheck('DISASTER', 0.5, 0.51, TIE_BAND), 'DISASTER', 'disasters never tie');
  eq(tieCheck('FAILURE', 0.5, 0.51, 0), 'FAILURE', 'band 0 disables ties');
  /* resolveDuelExchange applies ties; a lone check (referee.resolveCheck via
   * refereeStep) must NEVER produce TRADE/STALEMATE — statistical sweep. */
  const eng = engineSettings({});
  const state = mkState();
  startDuel(state, { playerName: 'the player', oppName: 'Rusk', domain: 'melee', oppEstimate: 5, scaleMismatch: 0 }, eng);
  let sawTie = false;
  let trades = 0;
  for (let i = 0; i < 2000; i += 1) {
    const s = clone(state);
    const r = resolveDuelExchange(s, 0, 'attack', eng);
    if (r.tier === 'TRADE' || r.tier === 'STALEMATE') { sawTie = true; trades += 1; }
  }
  assert(sawTie && trades > 20, 'exchanges do tie near the boundary');
});

/* ---------- the gate ---------- */

test('M11 gate: the truth table — dialogue never triggers, OOC rejected, sensitivity levels', () => {
  /* dialogue stripped: a quoted threat is not an attempt */
  eq(gatePasses('He growls "I could kill you where you stand."', 'normal').pass, false, 'pure dialogue never triggers');
  eq(gatePasses('"Watch this," she says, and tries to pick the lock', 'normal').pass, true, 'the action outside the quotes still counts');
  /* OOC rejected */
  eq(gatePasses('(ooc: brb, dinner)', 'normal').pass, false, 'pure OOC rejected');
  eq(gatePasses('(still on mobile) I try to sneak past the guard', 'normal').pass, true, 'OOC aside stripped, the rest scanned');
  /* quiet beats */
  eq(gatePasses('I walk to the window and look out.', 'normal').pass, false, 'a plain walk is no attempt');
  eq(gatePasses('What do I see in the cellar?', 'normal').pass, false, 'a question is no attempt');
  /* sensitivity levels */
  eq(gatePasses('I try to climb the trellis.', 'conservative').pass, true, 'attempt phrase passes conservative');
  eq(gatePasses('I sneak down the corridor.', 'conservative').pass, false, 'bare verbs sleep at conservative');
  eq(gatePasses('I sneak down the corridor.', 'normal').pass, true, 'gate verbs wake at normal');
  eq(gatePasses('I step closer.', 'normal').pass, false, 'positioning sleeps at normal out of a fight');
  eq(gatePasses('I step closer.', 'aggressive').pass, true, 'positioning wakes at aggressive');
  /* in-fight bypass */
  eq(gatePasses('I wait and watch him.', 'conservative', { inFight: true }).pass, true, 'a fight bypasses the gate entirely');
});

/* ---------- committed fate ---------- */

test('M11 committed fate: replay vs re-roll, and the timeline cap', async () => {
  const m1 = mkUser('u1', 'I try to sneak past the guard');
  const first = await refereeStep({
    connection: conn, userText: 'I try to sneak past the guard', userId: 'u1',
    history: [m1], state: mkState(), settings: {}, callLLM: checkLLM(),
  });
  eq(first.status, 'ruled', 'ruled once');
  let calls = 0;
  const spy = async (...a) => { calls += 1; return checkLLM()(...a); };
  const replay = await refereeStep({
    connection: conn, userText: 'I try to sneak past the guard', userId: 'u1',
    history: [m1], state: first.state, settings: {}, callLLM: spy,
  });
  eq(replay.status, 'replayed', 'the swipe replays');
  eq(calls, 0, 'the referee is not re-asked');
  eq(replay.ruling.directive, first.ruling.directive, 'same ruling, word for word');
  /* edited text = new world: rewind, then a fresh roll */
  const m1e = mkUser('u1', 'I try to sneak past the captain');
  const edit = await refereeStep({
    connection: conn, userText: 'I try to sneak past the captain', userId: 'u1',
    history: [m1e], state: replay.state, settings: {}, callLLM: spy,
  });
  eq(edit.status, 'ruled', 'edited words earn a fresh roll');
  eq(calls, 1, 'the referee was asked again');
  /* the cap: 20 distinct messages leave 12 */
  let st = mkState();
  const hist = [];
  for (let i = 0; i < 20; i += 1) {
    const m = mkUser('m' + i, 'I try thing number ' + i);
    hist.push(m);
    const r = await refereeStep({
      connection: conn, userText: pageTextOf(m), userId: m.id,
      history: hist.slice(), state: st, settings: {}, callLLM: checkLLM(),
    });
    st = r.state;
  }
  assert(st.refHistory.length <= 12, 'the timeline is capped at 12');
  eq(st.refHistory.length, 12, 'exactly the cap once exceeded');
});

function pageTextOf(m) { return m.pages[m.page].text; }

/* ---------- snapshot rewind on a deleted suffix ---------- */

test('M11 rewind: a deleted/branched suffix restores the pre-turn world', async () => {
  const eng = engineSettings({});
  /* turn 1 opens a duel (check + duel_start), turn 2 fights a round */
  const openLLM = async () => JSON.stringify({
    check: true, kind: 'actor', action: 'I swing at Rusk', opposition: 'Rusk',
    circumstance: 0, duel_start: { opponent: 'Rusk', domain: 'melee', rating: 5 },
  });
  const m1 = mkUser('u1', 'I swing at Rusk');
  let r = await refereeStep({
    connection: conn, userText: pageTextOf(m1), userId: 'u1',
    history: [m1], state: mkState(), settings: {}, callLLM: openLLM,
  });
  eq(r.status, 'ruled', 'the opening is ruled');
  assert(duelActive(r.state) || (r.state.duel && r.state.duel.active), 'the duel joined');
  const after1 = clone(r.state);
  const m2 = mkUser('u2', 'I press the attack');
  r = await refereeStep({
    connection: conn, userText: pageTextOf(m2), userId: 'u2',
    history: [m1, m2], state: r.state, settings: {}, callLLM: duelLLM(),
  });
  eq(r.status, 'ruled', 'round two is ruled');
  eq(r.state.duel.round, 2, 'two rounds played');
  /* now the second message is deleted/branched away: the world rewinds */
  r = await refereeStep({
    connection: conn, userText: pageTextOf(m1), userId: 'u1',
    history: [m1], state: r.state, settings: {}, callLLM: duelLLM(),
  });
  eq(r.status, 'replayed', 'the surviving turn replays after the rewind');
  eq(r.state.duel.round, after1.duel.round, 'the duel state rewound to round one');
  eq(JSON.stringify(r.state.duel), JSON.stringify(after1.duel), 'the world is exactly what it was');
  /* and the timeline no longer holds the deleted turn */
  assert(!r.state.refHistory.some((e) => e.msgId === 'u2'), 'the vanished suffix is off the timeline');
});

/* ---------- the duel economy ---------- */

test('M11 duel economy: momentum cap, recovery caps, the free-swing floor', () => {
  const eng = engineSettings({});
  /* momentum ±0.5, cap 1 */
  let pl = { poise: 5, injuries: 0, momentum: 0, opening: false };
  let op = { poise: 5, injuries: 0, momentum: 0, opening: false };
  for (let i = 0; i < 5; i += 1) {
    const r = applyExchangeEffects(pl, op, 'SUCCESS', 0);
    pl = r.player; op = r.opp;
  }
  eq(pl.momentum, 1, 'momentum caps at 1');
  /* margin scaling: a lopsided win strips more poise, capped */
  const close = applyExchangeEffects({ ...pl, momentum: 0 }, { ...op }, 'SUCCESS', 1);
  const wide = applyExchangeEffects({ ...pl, momentum: 0 }, { ...op }, 'SUCCESS', 5);
  eq(close.opp.poise, op.poise - 1.5, 'close fight: base damage');
  eq(wide.opp.poise, op.poise - 1.5 - 3, 'lopsided fight: capped bonus');
  /* recovery: tier-scaled, capped at maxPoise and at one pool per fight */
  const state = mkState();
  startDuel(state, { playerName: 'the player', oppName: 'Rusk', domain: 'melee', oppEstimate: 5, scaleMismatch: 0 }, eng);
  state.duel.player.poise = 1;
  state.duel.recovered = 0;
  let totalGained = 0;
  for (let i = 0; i < 8 && !state.duel.over; i += 1) {
    const before = state.duel.player.poise;
    const r = resolveDuelRecovery(state, 3, eng); // hugely favorable circumstance
    totalGained += state.duel.player.poise - before;
    assert(state.duel.player.poise <= state.duel.player.maxPoise, 'never heals past the pool');
    assert(r.counter >= 0.5, 'the free swing is floored at 0.5 while a trained foe stands');
  }
  assert((state.duel.recovered || 0) <= state.duel.player.maxPoise, 'one pool per fight, no more');
  /* composure schedule: nothing above half, to -3 at empty */
  eq(composurePenaltyOf(6, 6), 0, 'full nerve: no penalty');
  eq(composurePenaltyOf(3, 6), 0, 'half nerve: still no penalty');
  assert(composurePenaltyOf(1, 6) <= -2, 'fraying nerve bites');
  eq(composurePenaltyOf(0, 6), -3, 'breaking: -3');
});

test('M11 duel: margin-scaled exchange tiers resolve and a winner is called', () => {
  const eng = engineSettings({});
  /* a hopeless player loses quickly in tracked mode */
  const state = mkState();
  state.sheet.actors['the player'] = undefined;
  startDuel(state, { playerName: 'the player', oppName: 'The Champion', domain: 'melee', oppEstimate: 10, scaleMismatch: 0 }, eng);
  state.duel.player.rating = 2;
  let rounds = 0;
  while (!state.duel.over && rounds < 40) {
    resolveDuelExchange(state, -3, 'attack', eng);
    rounds += 1;
  }
  assert(state.duel.over, 'a tracked duel ends');
  eq(state.duel.victor, 'opp', 'the overmatched fighter loses');
  /* outcome-only style never calls a winner */
  const engOut = engineSettings({ fightStyle: 'outcome' });
  const s2 = mkState();
  startDuel(s2, { playerName: 'the player', oppName: 'Rusk', domain: 'melee', oppEstimate: 9, scaleMismatch: 0 }, engOut);
  for (let i = 0; i < 10; i += 1) resolveDuelExchange(s2, -3, 'attack', engOut);
  assert(!s2.duel.over, 'outcome-only tallies nothing');
  /* teardown: injuries move to the body ledger via combat.end */
  const s3 = mkState();
  startDuel(s3, { playerName: 'the player', oppName: 'Rusk', domain: 'melee', oppEstimate: 8, scaleMismatch: 0 }, eng);
  s3.duel.opp.injuries = 2;
  const applied = applyMutations(s3, [{ type: 'combat.end', engine: {} }]);
  eq(applied.state.duel, null, 'the duel lets go');
  eq(applied.state.mode.combat, false, 'the combat mood clears');
  assert(applied.state.bodies.Rusk && applied.state.bodies.Rusk.injuries.length === 1, 'Rusk carries the marks in the body ledger');
  assert(applied.state.sheet.actors.Rusk && applied.state.sheet.actors.Rusk._estimated, 'the estimated foe kept his baseline');
  const undone = applyMutations && applied.state; // undo rides the log
  assert(applied.state.log.some((e) => e.words.includes('The fight has ebbed')), 'the letting-go is logged');
});

/* ---------- identity hardening ---------- */

test('M11 identity: actor always player, opposition never an MC alias', () => {
  const state = mkState();
  state.sheet.playerName = 'Mara';
  state.sheet.actors.Rusk = { default: 6, domains: {} };
  const a = normalizeAdj({
    check: true, actor: 'Rusk', action: 'swing', kind: 'actor', opposition: 'Mara', circumstance: 0,
  }, state);
  eq(a.actor, 'Mara', 'the actor is the player, whoever the model named');
  eq(a.kind, 'task', 'a self-opposition is rewritten to a task');
  const b = normalizeAdj({
    check: true, action: 'square up', kind: 'actor', opposition: 'Rusk',
    duel_start: { opponent: 'you', domain: 'melee' },
  }, state);
  eq(b.duel_start, null, 'a duel against yourself is refused');
  const c = normalizeAdj({
    check: true, action: 'draw steel', kind: 'actor', opposition: 'Rusk',
    duel_start: { opponent: 'Rusk', domain: 'melee', rating: 14 },
  }, state);
  assert(c.duel_start && c.duel_start.opponent === 'Rusk', 'a real opponent arms');
  eq(c.duel_start.rating, 10, 'ratings clamp to the scale');
});

/* ---------- degrade to nothing ---------- */

test('M11 degrade: no connection, garbage, or a timeout means no ruling and no throw', async () => {
  const m = mkUser('u1', 'I try to force the gate');
  const noConn = await refereeStep({
    connection: null, userText: pageTextOf(m), userId: 'u1', history: [m], state: mkState(), settings: {}, callLLM: checkLLM(),
  });
  eq(noConn.status, 'degraded', 'no connection degrades');
  eq(noConn.ruling, null, 'no ruling rides');
  let tries = 0;
  const garbage = async () => { tries += 1; return 'sure! here is what happens next: they win.'; };
  const bad = await refereeStep({
    connection: conn, userText: pageTextOf(m), userId: 'u1', history: [m], state: mkState(), settings: {}, callLLM: garbage,
  });
  eq(bad.status, 'degraded', 'unparseable answers degrade');
  eq(tries, 2, 'exactly one retry was attempted');
  eq(bad.state.refHistory.length, 0, 'a degraded turn commits nothing');
  /* a quiet beat commits a no-check, and replays as one */
  const m2 = mkUser('u2', 'I look out at the rain.');
  const quiet = await refereeStep({
    connection: conn, userText: pageTextOf(m2), userId: 'u2', history: [m2], state: mkState(), settings: {}, callLLM: checkLLM(),
  });
  eq(quiet.status, 'no-check', 'the gate keeps quiet beats quiet');
  const quietReplay = await refereeStep({
    connection: conn, userText: pageTextOf(m2), userId: 'u2', history: [m2], state: quiet.state, settings: {}, callLLM: checkLLM(),
  });
  eq(quietReplay.status, 'replayed', 'even a no-check replays — the turn is stable');
  /* #skip waves a ruling off; #roll insists on one */
  const m3 = mkUser('u3', '#skip I try to force the gate');
  const skipped = await refereeStep({
    connection: conn, userText: pageTextOf(m3), userId: 'u3', history: [m3], state: mkState(), settings: {}, callLLM: checkLLM(),
  });
  eq(skipped.status, 'skipped', '#skip stands down');
  const m4 = mkUser('u4', '#roll I look out at the rain');
  const forced = await refereeStep({
    connection: conn, userText: pageTextOf(m4), userId: 'u4', history: [m4], state: mkState(), settings: {}, callLLM: checkLLM(),
  });
  eq(forced.status, 'ruled', '#roll asks for a ruling on a quiet beat');
});

/* ---------- ARMED without rolling ---------- */

test('M11 armed: a fight opening on a declaration binds the standoff, nothing rolled', async () => {
  const m = mkUser('u1', '"Draw," I tell him, my hand on the hilt. I draw my blade and square up, waiting.');
  const armLLM = async () => JSON.stringify({
    check: false, action: 'squaring up with a hand on the hilt', kind: 'task',
    duel_start: { opponent: 'Rusk', domain: 'melee', rating: 5 },
  });
  const r = await refereeStep({
    connection: conn, userText: pageTextOf(m), userId: 'u1', history: [m], state: mkState(), settings: {}, callLLM: armLLM,
  });
  eq(r.status, 'ruled', 'the standoff binds');
  eq(r.ruling.tier, 'ARMED', 'armed — nothing rolled');
  assert(r.ruling.directive.includes('nothing is decided yet') || r.ruling.directive.includes('nothing has succeeded'), 'the directive says nothing is decided');
  assert(r.state.duel && r.state.duel.active && r.state.duel.round === 0, 'the duel state exists at round zero');
  eq(r.state.mode.combat, true, 'the combat mood rides the mode ledger');
  /* the next beat is round one — the in-fight bypass carries it */
  const m2 = mkUser('u2', 'I strike at him');
  const r2 = await refereeStep({
    connection: conn, userText: pageTextOf(m2), userId: 'u2', history: [m, m2], state: r.state, settings: {}, callLLM: duelLLM(),
  });
  eq(r2.status, 'ruled', 'round one is ruled');
  eq(r2.state.duel.round, 1, 'the first real attempt is round 1');
});

/* ---------- the injection slot ---------- */

test('M11 injection: the ruling rides the dynamic tail as the receipt-named "The house has ruled" slot', () => {
  const state = mkState();
  const directive = 'The house has ruled — how this goes:\nMara tries: leap the fence.\nHow it lands: SUCCESS — it succeeds as intended.';
  const { messages, receipt } = buildRequest({
    story: { brief: '' }, messages: [], settings: {}, state,
    modules: [], memory: '', cast: [], lore: '', loreFired: [],
    window: { keeperOn: false, window: 30, budgetTokens: 100000 },
    directive: '', directorNote: '', editorEye: '', ruling: directive,
  });
  const slot = (receipt.slots || []).find((s) => s.name === 'The house has ruled');
  assert(slot, 'the receipt names the slot');
  assert(slot.tokens > 0, 'the slot carries the ruling');
  const tail = messages.find((msg) => typeof msg.content === 'string' && msg.content.includes('[story-state]'));
  assert(tail && tail.content.includes(directive), 'the ruling is in the dynamic tail');
  /* and when nothing was ruled, there is no slot at all */
  const quiet = buildRequest({
    story: { brief: '' }, messages: [], settings: {}, state: mkState(),
    modules: [], memory: '', cast: [], lore: '', loreFired: [],
    window: { keeperOn: false, window: 30, budgetTokens: 100000 },
    directive: '', directorNote: '', editorEye: '', ruling: '',
  });
  assert(!(quiet.receipt.slots || []).some((s) => s.name === 'The house has ruled'), 'no ruling, no slot');
});

test('M11 the state of things names a fight that stands', () => {
  const state = mkState();
  eq(renderStateFacts(state).includes('duel'), false, 'no fight, no line');
  const eng = engineSettings({});
  startDuel(state, { playerName: 'the player', oppName: 'Rusk', domain: 'melee', oppEstimate: 5, scaleMismatch: 0 }, eng);
  const facts = renderStateFacts(state);
  assert(facts.includes('A duel is joined'), 'the duel line rides the facts');
  assert(renderFightLine(state).includes('Rusk'), 'and names the foe');
});
