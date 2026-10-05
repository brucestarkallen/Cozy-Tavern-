/* M616 — his: "isn't the LLM smart, why the fuck does it need a dictionary to know when the fight starts?" Laws RUN the
 * real referee step with a scripted model and read back what it did. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';

function scene() {
  return {
    sheet: { playerName: 'Jovan', actors: { Jovan: { default: 8, domains: { summoning: 9 }, conditions: [] }, Sukuna: { default: 10, domains: {}, conditions: [] }, Mahoraga: { default: 9, domains: {}, conditions: [] } } },
    characters: { Jovan: { core: 'a summoner' }, Sukuna: { core: 'the King of Curses' } },
    present: [{ name: 'Jovan' }, { name: 'Sukuna' }, { name: 'Mahoraga' }],
    place: { name: 'the ruined shrine' }, mode: { combat: true }, log: [], journal: [], page: 5,
  };
}

test('M616-1 HIS ORDER TO A SUMMON STARTS THE FIGHT — with a fight in the air, "I order Mahoraga to make him bleed" reaches the referee (no word list stands in the way) and the fight it opens has Mahoraga beside him; his readiness is said to it', async () => {
  const { refereeStep } = await import('../../js/agents/referee.js');
  const asked = [];
  const callLLM = async (...args) => {
    asked.push(JSON.stringify(args.slice(1)));
    return JSON.stringify({ check: false, situation: 'combat', battle_start: { allies: ['Mahoraga'], enemies: ['Sukuna'], domain: 'melee', scale: 0 }, duel_start: null, war_start: null });
  };
  const text = 'I order Mahoraga to make him bleed';
  const r = await refereeStep({ connection: { id: 'c', type: 'openai', model: 'm' }, userText: text, userId: 'u1', history: [{ id: 'u1', role: 'user', text }], state: scene(), settings: { sensitivity: 'conservative' }, callLLM });
  eq(asked.length >= 1, true, 'the referee was asked (on m615 the gate stopped it: "no attempt")');
  assert(/<how_readily>The writer wants few rulings/.test(asked.join(' ')), 'his readiness is said to it in words');
  const st = r && r.state;
  assert(st && st.battle && st.battle.active, 'a fight began: ' + JSON.stringify(r && { status: r.status, why: r.why }));
  assert((st.battle.allies || []).some((u) => /Mahoraga/.test(u.name)), 'Mahoraga fights beside him: ' + JSON.stringify((st.battle.allies || []).map((u) => u.name)));
  assert((st.battle.enemies || []).some((u) => /Sukuna/.test(u.name)), 'against Sukuna');
});

test('M616-2 A CALM PAGE NEVER WAITS ON THE REFEREE — with no fight in the air a quiet move is not sent to it (the instant word list stands for a calm scene); with one, every move is', async () => {
  const { refereeStep } = await import('../../js/agents/referee.js');
  let asked = 0;
  const callLLM = async () => { asked += 1; return JSON.stringify({ check: false, situation: 'none' }); };
  const calm = { ...scene(), mode: {} };
  const text = 'I look out at the rain.';
  const r = await refereeStep({ connection: { id: 'c', type: 'openai', model: 'm' }, userText: text, userId: 'u9', history: [{ id: 'u9', role: 'user', text }], state: calm, settings: {}, callLLM });
  eq(asked, 0, 'a calm quiet move: no referee call, no wait');
  eq(r.status, 'no-check', 'and nothing ruled');
  const tense = scene();
  await refereeStep({ connection: { id: 'c', type: 'openai', model: 'm' }, userText: 'Go, Mahoraga!', userId: 'u10', history: [{ id: 'u10', role: 'user', text: 'Go, Mahoraga!' }], state: tense, settings: {}, callLLM });
  eq(asked, 1, 'a fight in the air: his bare command reaches the referee');
});
