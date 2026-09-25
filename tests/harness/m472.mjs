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

test('M473 the domain of the beat: a summoner known for summoning 9 (3 for anything not listed) commands his summons at 9, strikes with a blade at 3, and a domain not on his sheet leaves the unit’s rating', async () => {
  const { engineSettings: es, startBattle: sb, resolveBattleRound } = await import('../../js/engine/duels.js');
  const s = mkState();
  s.sheet.actors['Jovan Arden'] = { default: 3, domains: { summoning: 9, willpower: 8, intellect: 6, social: 5 } };
  sb(s, { allies: ['Mahoraga', 'Fenrir', 'Void'], enemies: ['Varkhos'], domain: 'melee', scaleMismatch: 0 }, es({}));
  eq(s.battle.allies[0].rating, 3, 'on the field, the battle’s domain: 3');
  const cmd = resolveBattleRound(s, { kind: 'command', target: null, domain: 'summoning', circumstance: 0 }, es({}));
  eq(cmd.mcRes.aR, 9, 'an order to his summons is rolled at his summoning 9');
  const s2 = mkState(); s2.sheet.actors['Jovan Arden'] = { default: 3, domains: { summoning: 9 } };
  sb(s2, { allies: ['Mahoraga'], enemies: ['Varkhos'], domain: 'melee', scaleMismatch: 0 }, es({}));
  const blade = resolveBattleRound(s2, { kind: 'attack', target: 'Varkhos', domain: 'melee', circumstance: 0 }, es({}));
  eq(blade.mcRes.aR, 3, 'a blade in his own hand: 3');
  const s3 = mkState(); s3.sheet.actors['Jovan Arden'] = { default: 3, domains: { summoning: 9 } };
  sb(s3, { allies: ['Mahoraga'], enemies: ['Varkhos'], domain: 'melee', scaleMismatch: 0 }, es({}));
  const none = resolveBattleRound(s3, { kind: 'command', target: null, domain: 'tactics', circumstance: 0 }, es({}));
  eq(none.mcRes.aR, 3, 'a domain not on his sheet: the unit’s rating stands');
  /* through the normaliser: the domain rides */
  const a = normalizeBattleAdj({ exchange: true, action: 'orders the summons to strike', move: { kind: 'command', target: 'Varkhos', domain: 'Summoning', circumstance: 0 } }, s);
  eq(a.move.domain, 'summoning');
});

test('M474 the brief changed: the sheet is due again on the next page; asked by hand it runs on any number of pages; a raised skill reaches the sheet, a hand-kept number never moves', async () => {
  const { seedDue, briefMark, maybeSeedSheet } = await import('../../js/agents/referee.js');
  const { db } = await import('../../js/store.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const s = mkState();
  s.sheet.actors = { 'Jovan Arden': { default: 3, domains: { summoning: 6 }, _auto: true, seed: (await import('../../js/agents/referee.js')).SEED_VERSION }, Varkhos: { default: 4, domains: { melee: 7 }, _hand: true } };
  s.sheet.seedVersion = (await import('../../js/agents/referee.js')).SEED_VERSION;
  s.sheet.seededAtPage = 5; s.sheet.briefMark = briefMark('the old brief', '');
  eq(seedDue(s, 6, { brief: 'the old brief', castNotes: '' }), '', 'the same brief: not due');
  eq(seedDue(s, 6, { brief: 'the NEW brief — Jovan summons at the level of a master', castNotes: '' }), 'the brief changed');
  eq(seedDue(s, 6), '', 'no brief handed in (an older caller): the mark is not judged');
  /* by hand, through the seeder, the numbers rise and the hand-kept stays */
  const st = await db.stories.create({ title: 'weighed' });
  await db.messages.append(st.id, { role: 'user', text: 'I raise my hand.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The summons answer.' });
  await saveState(st.id, s);
  const seedLLM = async () => JSON.stringify({ actors: [{ name: 'Jovan Arden', default: 4, domains: { summoning: 9, willpower: 8 } }, { name: 'Varkhos', default: 2, domains: { melee: 3 } }] });
  const r = await maybeSeedSheet({ connection: conn, storyId: st.id, brief: 'the NEW brief', castNotes: '', force: true, callLLM: seedLLM });
  assert(r.ok, 'ran by hand on one page: ' + JSON.stringify(r));
  const after = await loadState(st.id);
  eq(after.sheet.actors['Jovan Arden'].domains.summoning, 9, 'the raised skill reached the sheet');
  eq(after.sheet.actors['Jovan Arden'].domains.willpower, 8, 'a new domain too');
  eq(after.sheet.actors['Jovan Arden'].default, 4, 'and the default rose');
  eq(after.sheet.actors.Varkhos.domains.melee, 7, 'a hand-kept number never moves');
  eq(after.sheet.briefMark, briefMark('the NEW brief', ''), 'the brief’s mark is kept, so the same brief is not weighed again');
  eq(seedDue(after, 6, { brief: 'the NEW brief', castNotes: '' }), '', 'not due now');
  await db.stories.remove(st.id);
});

test('M475 one person once on a roster, and a weighing never throws a considered entry’s domains away', async () => {
  const { mergeSeed, SEED_VERSION } = await import('../../js/agents/referee.js');
  const s = mkState();
  s.sheet.actors = { Mahoraga: { default: 9, domains: { melee: 9 }, _auto: true, seed: SEED_VERSION } };
  /* the roster: the title and the name are one person, the sheet's name wins */
  const b = normalizeBattleAdj({ exchange: true, action: 'we press him', move: { kind: 'command', target: null, circumstance: 0 }, joins: { allies: ['Eight Handled Sword Divergent Sila Divine General Mahoraga', 'Mahoraga', 'Fenrir'], enemies: ['Varkhos', 'varkhos'] } }, s);
  eq(b.joins.allies.join('|'), 'Mahoraga|Fenrir', 'the title and the name are one; the sheet’s name kept');
  eq(b.joins.enemies.join('|'), 'Varkhos', 'a case-twin is one');
  const { normalizeAdj: na } = await import('../../js/agents/referee.js');
  const open = na({ check: true, kind: 'actor', action: 'x', opposition: 'Varkhos', battle_start: { allies: ['Kaelen Stahl', 'Kaelen'], enemies: ['Varkhos'] } }, s);
  eq(open.battle_start.allies.join('|'), 'Kaelen', 'with no sheet entry, the shorter name stands for both');
  /* the merge: a fight-made entry (no seed stamp) keeps its summoning 9 and grows; an estimated foe likewise */
  const t = mkState();
  t.sheet.actors = {
    'Jovan Arden': { default: 3, domains: { summoning: 9, willpower: 8 }, _auto: true },
    Varkhos: { default: 6, domains: { melee: 6 }, _estimated: true },
    Kara: { default: 5, domains: { melee: 8 }, _hand: true },
  };
  t.sheet.playerName = 'Jovan Arden';
  mergeSeed(t, { actors: [{ name: 'Jovan Arden', default: 4, domains: { melee: 4, social: 7 } }, { name: 'Varkhos', default: 9, domains: { melee: 9 } }, { name: 'Kara', default: 2, domains: { melee: 2 } }] });
  const j = t.sheet.actors['Jovan Arden'];
  eq(j.domains.summoning, 9, 'the summoning stays'); eq(j.domains.willpower, 8); eq(j.domains.melee, 4, 'the new domain lands'); eq(j.default, 4, 'the default rose'); eq(j.seed, SEED_VERSION, 'considered now');
  eq(t.sheet.actors.Varkhos.domains.melee, 9, 'an estimated foe gives way to the considered rating'); assert(!t.sheet.actors.Varkhos._estimated, 'and is the seeder’s now (M345-4)');
  eq(t.sheet.actors.Kara.domains.melee, 8, 'a hand-kept number never moves');
  /* a heal still rebuilds */
  mergeSeed(t, { actors: [{ name: 'Jovan Arden', default: 5, domains: { sorcery: 10 } }] }, { heal: true });
  eq(t.sheet.actors['Jovan Arden'].domains.sorcery, 10); eq(t.sheet.actors['Jovan Arden'].domains.summoning, undefined, 'a heal is the one replace');
});
