/* Cozy Tavern — harness laws of M584 (the line-by-line audit, part 7: engine/duels.js). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { findActorKey, findActorKeySamePerson, liveCombatant } from '../../js/engine/duels.js';

const st = { sheet: { playerName: 'Jovan Wessex', actors: { 'Rukia Kuchiki': { default: 6 }, 'Byakuya Kuchiki': { default: 9 }, 'Kenpachi Zaraki': { default: 10 }, 'Aldric Vane': { default: 8 }, 'Jovan Wessex': { default: 5 } } } };

test('M584-1 A FIGHT NEVER READS THE WRONG PERSON\'S SKILLS: a family name two people share ("Kuchiki") names no one in the sheet or in a live fight; a name with a title in front ("Captain Zaraki", "Headmaster Vane") is found; one meaning or none', () => {
  eq(findActorKey(st, 'Kuchiki'), null, 'Rukia and Byakuya: no one');
  eq(findActorKeySamePerson(st, 'Kuchiki'), null);
  eq(findActorKey(st, 'Byakuya'), 'Byakuya Kuchiki');
  eq(findActorKey(st, 'Rukia Kuchiki'), 'Rukia Kuchiki');
  eq(findActorKey(st, 'Zaraki'), 'Kenpachi Zaraki');
  eq(findActorKey(st, 'Captain Zaraki'), 'Kenpachi Zaraki', 'a title read past');
  eq(findActorKey(st, 'Headmaster Vane'), 'Aldric Vane', 'a school title too');
  eq(findActorKey(st, 'Captain Kuchiki'), null, 'still two Kuchikis');
  const duel = { duel: { player: { name: 'Rukia Kuchiki' }, opp: { name: 'Byakuya Kuchiki' } } };
  eq(liveCombatant(duel, 'Kuchiki'), null, 'in a live fight too');
  eq(liveCombatant(duel, 'Byakuya').name, 'Byakuya Kuchiki');
  eq(liveCombatant(duel, 'Rukia Kuchiki').name, 'Rukia Kuchiki', 'the exact name first');
});

test('M584-2 A CONDITION OR AN ESTIMATE FOR A NAME TWO PEOPLE SHARE IS LET GO — never written onto a new "Kuchiki" beside Rukia and Byakuya; a name that fits one is written to that one', async () => {
  const { applyConditionChange, persistFightEstimates } = await import('../../js/engine/duels.js');
  const s2 = JSON.parse(JSON.stringify(st));
  eq(applyConditionChange(s2, { who: 'Kuchiki', add: 'a cut on the arm', mod: -1 }), null);
  assert(!s2.sheet.actors.Kuchiki, 'no ghost entry');
  applyConditionChange(s2, { who: 'Byakuya', add: 'a cut on the arm', mod: -1 });
  eq(s2.sheet.actors['Byakuya Kuchiki'].conditions[0].name, 'a cut on the arm', 'the one it fits');
  s2.duel = { opp: { name: 'Kuchiki', rating: 7, estimated: true }, domain: 'melee' };
  persistFightEstimates(s2);
  assert(!s2.sheet.actors.Kuchiki, 'no estimate written for a shared name');
});

test('M600 A COMPOSURE TOLL NEVER LANDS ON THE WRONG KUCHIKI: the referee\'s toll on "Kuchiki" in a battle holding Rukia and Byakuya lands on neither; on "Byakuya" it lands on him — the fight\'s one lookup', async () => {
  const { refereeStep } = await import('../../js/agents/referee.js');
  const { startBattle, engineSettings } = await import('../../js/engine/duels.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const base = () => {
    const s = { ...emptyState(), sheet: { playerName: 'Jovan Oda', actors: { 'Rukia Kuchiki': { default: 6 }, 'Byakuya Kuchiki': { default: 9 }, 'Jovan Oda': { default: 7 } } } };
    startBattle(s, { allies: ['Rukia Kuchiki'], enemies: ['Byakuya Kuchiki'], domain: 'melee' }, engineSettings({}));
    return s;
  };
  /* the referee's own stand-in shape: the model's raw text */
  const answer = (who) => async () => JSON.stringify({ exchange: false, combat_ended: false, action: 'stares him down', move: { kind: 'attack', target: null, circumstance: 0 }, why: null, joins: null, composure_change: { who, delta: -2 } });
  const comp = (s, n) => [...s.battle.allies, ...s.battle.enemies].find((u) => u.name === n).composure;
  const a = base(); const before = { r: comp(a, 'Rukia Kuchiki'), b: comp(a, 'Byakuya Kuchiki') };
  const ra = await refereeStep({ connection: { type: 'openai', baseUrl: 'x', model: 'm' }, userText: 'I glare at them.', userId: 'u1', history: [], state: a, settings: {}, callLLM: answer('Kuchiki') });
  eq(ra.status, 'ruled', 'the referee ruled (a lull) — the toll was read: ' + ra.why);
  eq(comp(ra.state, 'Rukia Kuchiki'), before.r, 'Rukia untouched'); eq(comp(ra.state, 'Byakuya Kuchiki'), before.b, 'Byakuya untouched');
  const b = base();
  const rb = await refereeStep({ connection: { type: 'openai', baseUrl: 'x', model: 'm' }, userText: 'I glare at him.', userId: 'u2', history: [], state: b, settings: {}, callLLM: answer('Byakuya') });
  eq(comp(rb.state, 'Byakuya Kuchiki'), before.b - 2, 'Byakuya takes it');
});
