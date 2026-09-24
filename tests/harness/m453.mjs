/* M453: the ground his story fought on went back to the 1st Division's assembly hall and stayed there — an old page read
 * out of turn moved the moment, and a header that only echoes the ledger held it. Runs the real engine and auditor. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { applyMutations, lastingOnly, groundTheTellingStandsOn } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { auditLedger } from '../../js/agents/auditor.js';

const HALL = '1st Division HQ — outside the assembly hall';
const YARD = '10th Division HQ — training courtyard';
const DUEL = '[' + HALL + ' — Sunday, Hanami 5, 1001 AG | 09:00 | spring sun, torn sand | black shihakushō | mid-sand]\n\nZaraki widened his stance on the torn sand of the courtyard; Ikkaku gripped the rail.';
const at = (g) => applyMutations({ ...emptyState(), page: 7 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: g }, ...['Jovan Oda', 'Kenpachi Zaraki'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
const streamed = (answer) => async () => {
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
};

test('M453-1 A PAGE READ OUT OF TURN LANDS ONLY WHAT LASTS — never the ground, the hour, who is here, the mood or a seat', () => {
  const kept = lastingOnly([{ type: 'place.set', name: HALL }, { type: 'clock.set' }, { type: 'presence.enter', name: 'Shunsui Kyōraku' }, { type: 'presence.leave', name: 'X' }, { type: 'presence.update', name: 'X' },
    { type: 'mode.snapshot', flags: [] }, { type: 'offscreen.set', name: 'X' }, { type: 'offscreen.clear', name: 'X' }, { type: 'knowledge.add' }, { type: 'body.injure' }, { type: 'rel.shift' }, { type: 'thread.close' }, { type: 'clock.advance' }]);
  eq(kept.map((m) => m.type).join(), 'knowledge.add,body.injure,rel.shift,thread.close,clock.advance', 'what lasts');
});

test('M453-2 AN ECHOING HEADER DOES NOT HOLD A GROUND THE TELLING HAS LEFT — and never frees the M403 wrong move, a header naming a new place, or a ground the telling still speaks of', () => {
  eq(groundTheTellingStandsOn(at(HALL), DUEL, YARD, HALL), true, 'his case');
  eq(groundTheTellingStandsOn(at(YARD), '[' + YARD + ']\n\nZaraki widened his stance in the courtyard.', HALL, YARD), false, 'M403’s wrong move stays refused');
  eq(groundTheTellingStandsOn(at(HALL), DUEL, YARD, 'Kyōraku’s office'), false, 'a header naming somewhere new rules');
  eq(groundTheTellingStandsOn(at(HALL), 'They waited outside the assembly hall; the courtyard lay beyond.', YARD, HALL), false, 'the telling still speaks of the hall');
});

test('M453-3 THE AUDITOR, RUN WHOLE: under an echoing header its ground goes back to the courtyard the duel is fought in; the M403 move away from the courtyard is still refused', async () => {
  const s0 = await db.stories.create({ title: 'The duel' });
  await db.messages.append(s0.id, { role: 'user', text: 'I draw.' });
  await db.messages.append(s0.id, { role: 'assistant', text: DUEL });
  await saveState(s0.id, at(HALL));
  await withHouse({ fetch: streamed(JSON.stringify({ issues: [{ what: 'the duel is in the 10th Division courtyard; the ledger has the assembly hall', fix: 'the courtyard', pages: false, mutations: [{ type: 'place.set', name: YARD }] }] })) }, () => auditLedger({ connection: HOUSES[0].conn, storyId: s0.id, brief: 'A Bleach story.' }));
  eq((await loadState(s0.id)).place.name, YARD, 'the ground is the courtyard again');
  const s1 = await db.stories.create({ title: 'The duel, held' });
  await db.messages.append(s1.id, { role: 'user', text: 'I draw.' });
  await db.messages.append(s1.id, { role: 'assistant', text: '[' + YARD + ']\n\nZaraki widened his stance in the courtyard.' });
  await saveState(s1.id, at(YARD));
  await withHouse({ fetch: streamed(JSON.stringify({ issues: [{ what: 'the scene is at the assembly', fix: 'move it', pages: false, mutations: [{ type: 'place.set', name: HALL }] }] })) }, () => auditLedger({ connection: HOUSES[0].conn, storyId: s1.id, brief: 'A Bleach story.' }));
  eq((await loadState(s1.id)).place.name, YARD, 'the courtyard stays');
});
