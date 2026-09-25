/* M472 — an order is a move; "#p" in a fight is the last beat again. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { refereeStep, normalizeBattleAdj, normalizeWarAdj } from '../../js/agents/referee.js';
import { engineSettings, startBattle } from '../../js/engine/duels.js';
import { emptyState } from '../../js/engine/state.js';

const mkUser = (id, text) => ({ id, role: 'user', pages: [{ text }], page: 0 });
const pageTextOf = (m) => m.pages[m.page].text;
const mkState = () => { const s = { ...emptyState(), turn: 1 }; s.sheet = { actors: { 'Jovan Arden': { domains: { melee: 5 } }, Mahoraga: { domains: { melee: 5 } }, Fenrir: { domains: { melee: 5 } }, Void: { domains: { melee: 5 } }, Varkhos: { domains: { melee: 4 } } }, playerName: 'Jovan Arden', seedVersion: 2 }; return s; };
const conn = { type: 'openai' };
const eng = engineSettings({});
const field = (s) => startBattle(s, { allies: ['Mahoraga', 'Fenrir', 'Void'], enemies: ['Varkhos'], domain: 'melee', scaleMismatch: 0 }, eng);

test('M472-1 an order to the allies is a move: the referee’s own "command" makes an exchange whatever exchange said; the words of an order do too; a war’s named formation likewise', () => {
  const s = mkState();
  const a = normalizeBattleAdj({ exchange: false, combat_ended: false, action: 'Orders the three summons to strike together', move: { kind: 'command', target: 'Varkhos', circumstance: 0 } }, s);
  assert(a.exchange, 'a command is an exchange'); eq(a.move.kind, 'command');
  const b = normalizeBattleAdj({ exchange: false, combat_ended: false, action: 'tells Fenrir to tear into Varkhos', move: { kind: 'attack', target: null, circumstance: 0 } }, s);
  assert(b.exchange && b.move.kind === 'command', 'the words of an order: an exchange, in command');
  const c = normalizeBattleAdj({ exchange: false, combat_ended: false, action: 'waits and watches the door', move: { kind: 'attack', target: null, circumstance: 0 } }, s);
  assert(!c.exchange, 'a real pause is still a pause');
  const d = normalizeBattleAdj({ exchange: false, combat_ended: true, action: 'orders them to stand down and attack no more', move: { kind: 'command', target: null, circumstance: 0 } }, s);
  assert(!d.exchange && d.combat_ended, 'the fight ending wins');
  const e = normalizeBattleAdj({ exchange: true, action: 'I let fear go and strike at him myself', move: { kind: 'attack', target: 'Varkhos', circumstance: 0 } }, s);
  eq(e.move.kind, 'attack', 'the player striking himself stays an attack');
  const w = normalizeWarAdj({ exchange: false, combat_ended: false, action: 'orders the left wing forward', move: { kind: 'maneuver', acting: 'Left wing', target: 'Their centre', circumstance: 0 } }, s);
  assert(w.exchange, 'a war order with a formation named is a move');
});

test('M472-2 through the referee: the field joined on the order, the order ruled as a command round — not a lull; then "#p" continues it without a call', async () => {
  const s = mkState();
  field(s);
  eq(s.battle.round, 0, 'joined, nothing rolled');
  const m = mkUser('u1', 'I order Mahoraga, Fenrir and Void to strike together.');
  const lullLLM = async () => JSON.stringify({ exchange: false, combat_ended: false, action: 'Orders the three summons to strike together', move: { kind: 'command', target: 'Varkhos', circumstance: 0 } });
  const r = await refereeStep({ connection: conn, userText: pageTextOf(m), userId: 'u1', history: [m], state: s, settings: {}, callLLM: lullLLM });
  eq(r.status, 'ruled');
  assert(r.ruling.tier !== 'LULL', 'not a lull: ' + r.ruling.tier);
  eq(r.state.battle.round, 1, 'a round was fought');
  assert(r.ruling.account.command === true, 'in command — the allies act on the order');
  eq(r.ruling.account.move.kind, 'command');
  /* #p: the last beat again, no micro-call */
  const m2 = mkUser('u2', '#p');
  let called = 0;
  const neverLLM = async () => { called += 1; return '{}'; };
  const r2 = await refereeStep({ connection: conn, userText: pageTextOf(m2), userId: 'u2', history: [m, m2], state: r.state, settings: {}, callLLM: neverLLM });
  eq(called, 0, 'no call made for #p in a fight');
  eq(r2.status, 'ruled');
  assert(r2.ruling.tier !== 'LULL', '#p is never a lull in a fight');
  eq(r2.state.battle.round, 2, 'the next round was fought');
  eq(r2.ruling.account.move.kind, 'command', 'the same move — in command');
  assert(/goes on with it — Orders the three summons/.test(r2.ruling.account.action), 'the same words, continued: ' + r2.ruling.account.action);
  eq(r2.ruling.account.continued, true);
  /* a fight joined on an order, then #p with no beat scored yet: still a command */
  const s3 = mkState(); field(s3);
  s3.refHistory = [{ key: 'x', verdict: { kind: 'armed', tier: 'ARMED', words: 'fight joined — nothing rolled yet', account: { what: 'the fight is joined', action: 'orders the summons to strike Varkhos', fight: { kind: 'battle' } } } }];
  const r3 = await refereeStep({ connection: conn, userText: '#p', userId: 'u3', history: [mkUser('u3', '#p')], state: s3, settings: {}, callLLM: neverLLM });
  eq(r3.status, 'ruled'); eq(r3.ruling.account.move.kind, 'command', 'the declared order continues as a command');
  eq(called, 0);
});

test('M472-3 a "#p" with no fight on is not the referee’s (the gate still decides), and a "#p" in a duel presses the last move', async () => {
  const s = mkState();
  let called = 0;
  const r = await refereeStep({ connection: conn, userText: '#p', userId: 'u1', history: [mkUser('u1', '#p')], state: s, settings: {}, callLLM: async () => { called += 1; return '{}'; } });
  eq(r.status, 'no-check', 'nothing to score outside a fight'); eq(called, 0);
  const { startDuel } = await import('../../js/engine/duels.js');
  const d = mkState(); startDuel(d, { playerName: 'Jovan Arden', oppName: 'Varkhos', domain: 'melee', oppEstimate: null, scaleMismatch: 0 }, eng);
  d.refHistory = [{ key: 'y', verdict: { kind: 'duel', tier: 'SUCCESS', words: 'succeeds as intended', account: { what: 'duel, round 1', action: 'a low cut at his knee', move: 'attack', fight: { kind: 'duel' } } } }];
  const r2 = await refereeStep({ connection: conn, userText: '#p', userId: 'u2', history: [mkUser('u2', '#p')], state: d, settings: {}, callLLM: async () => { called += 1; return '{}'; } });
  eq(called, 0); eq(r2.status, 'ruled'); assert(r2.ruling.tier !== 'LULL'); eq(r2.state.duel.round, 1, 'a round fought');
  eq(r2.ruling.account.move, 'attack');
});
