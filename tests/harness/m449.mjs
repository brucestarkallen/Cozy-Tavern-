/* M449: a guard asks the same question its writer will (M164's law) — found auditing every exact-name look-up left. The
 * auditor's standing guard read an EXACT key while the applier finds a book under any form of a name (M419): "Rukia"
 * zeroed Rukia Kuchiki's earned warmth. The people tidy had the same exact look-up. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { tidyMutations } from '../../js/agents/tidy.js';

const streamed = (answer) => async (url, opts) => {
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
};
const scene = () => applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Rukia' },
  { type: 'rel.shift', name: 'Rukia Kuchiki', axis: 'p', delta: 15, cause: 'she saw him shield the new recruits' }]).state;

test('M449-1 THE AUDITOR MAY NOT TAKE AWAY AN EARNED STANDING UNDER ANY FORM OF HER NAME — "Rukia" leaves Rukia Kuchiki’s P:15 as the page earned it', async () => {
  for (const form of ['Rukia Kuchiki', 'Rukia', 'Kuchiki Rukia']) {
    const s0 = await db.stories.create({ title: 'standing, ' + form });
    await db.messages.append(s0.id, { role: 'user', text: 'I thank her.' });
    await db.messages.append(s0.id, { role: 'assistant', text: 'Rukia nodded.' });
    await saveState(s0.id, scene());
    const answer = JSON.stringify({ issues: [{ what: 'Rukia does not trust him', fix: 'zero it', pages: false, mutations: [{ type: 'rel.set', name: form, p: 0, r: 0, s: 0, cause: 'the brief says she is wary' }] }] });
    await withHouse({ fetch: streamed(answer) }, () => auditLedger({ connection: HOUSES[0].conn, storyId: s0.id, brief: 'A Bleach story.' }));
    eq((await loadState(s0.id)).relationships['Rukia Kuchiki'].p, 15, 'via "' + form + '": the earned standing stands');
  }
});

test('M449-2 THE PEOPLE TIDY WRITES ON THE PAGE ITS ANSWER MEANS — "Rukia" is Rukia Kuchiki’s page, never dropped', () => {
  const st = scene();
  st.characters = { 'Rukia Kuchiki': { core: 'His lieutenant; she files the rosters every morning at the 13th Division Barracks, and still answers the door for him.', state: '', threads: [] } };
  const out = tidyMutations(st, [{ name: 'Rukia', state: 'at the desk, squaring the roster' }]);
  assert(out.some((m) => m && m.name === 'Rukia Kuchiki'), 'written on her page: ' + JSON.stringify(out));
});

test('M449-3 WHAT THEY HAVEN’T FOUND OUT, BY THE ONE MATCHER — the main character in the scene as "Oda" has none (his are the writer’s); Rukia’s own lines under "Rukia" are hers, never "Rukia hasn’t found out (Rukia knows)"', async () => {
  const { blindSpots } = await import('../../js/engine/world.js');
  /* her lines under two forms of her name (a ledger from before M419's join) */
  const knowledge = { 'Rukia Kuchiki': [{ fact: 'Oda keeps late hours', atTurn: 9 }], Rukia: [{ fact: 'the transfer order came from the Captain-Commander', atTurn: 9 }], 'Byakuya Kuchiki': [{ fact: 'the 6th will lend two squads', atTurn: 9 }] };
  const spots = blindSpots(knowledge, [{ name: 'Oda' }, { name: 'Rukia Kuchiki' }, { name: 'Byakuya Kuchiki' }], { turn: 10, mc: 'Jovan Oda' });
  const of = (n) => (spots.find((s) => s.name === n) || { lacks: [] }).lacks.map((l) => l.fact);
  eq(of('Oda').length, 0, 'the main character, named short, has no blind spots');
  assert(!of('Rukia Kuchiki').some((f) => /transfer order/.test(f)), 'her own line is hers: ' + JSON.stringify(of('Rukia Kuchiki')));
  assert(of('Rukia Kuchiki').some((f) => /two squads/.test(f)), 'what only Byakuya knows is still hers to not know');
});
