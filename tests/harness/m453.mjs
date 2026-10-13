/* M453: the ground his story fought on went back to the 1st Division's assembly hall and stayed there — an old page read
 * out of turn moved the moment, and a header that only echoes the ledger held it. Runs the real engine and auditor. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse, thinkingHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { applyMutations, lastingOnly, groundTheTellingStandsOn } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState, headerMutations } from '../../js/engine/state.js';
import { auditLedger } from '../../js/agents/auditor.js';

const HALL = '1st Division HQ — outside the assembly hall';
const YARD = '10th Division HQ — training courtyard';
const DUEL = '[' + HALL + ' — Sunday, Hanami 5, 1001 AG | 09:00 | spring sun, torn sand | black shihakushō | mid-sand]\n\nZaraki widened his stance on the torn sand of the courtyard; Ikkaku gripped the rail.';
const at = (g) => applyMutations({ ...emptyState(), page: 7 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: g }, ...['Jovan Oda', 'Kenpachi Zaraki'].map((n) => ({ type: 'presence.enter', name: n }))]).state;

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

/* M689 (the pipeline review he agreed to, docs/LEDGER-PIPELINE-M689.md): "production no longer runs [auditorScope]" — the
 * header-agreement and echo tests went with it; M709 left the final review's scope with supported operations and ownership
 * only (docs/LEDGER_PIPELINE.md: no new regex guards over the auditor's judgment). What carries the law now: the house still
 * writes the header's ground in code (headerMutations, the page reader's door — M710 kept the clock and place parsing), and
 * the auditor is TOLD that the header line is the ground's truth except for a header that only echoes a wrong ledger. */
const told = (house) => house.calls.map((c) => (c.body.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')).join('\n').replace(/\s+/g, ' ');
const review = (more) => JSON.stringify({ scene: [], issues: [], review: { status: 'complete', why: 'every entry read against the newest page, to its end', open: [] }, standings: [], ...more });
test('M453-3 THE AUDITOR, RUN WHOLE: it is told the header line is the ground’s truth, and an echo of a wrong ledger is not; as told, under an echoing header its ground goes back to the courtyard the duel is fought in, and under a header naming the courtyard nothing moves it — the header’s ground is the house’s own, in code', async () => {
  const s0 = await db.stories.create({ title: 'The duel' });
  await db.messages.append(s0.id, { role: 'user', text: 'I draw.' });
  await db.messages.append(s0.id, { role: 'assistant', text: DUEL });
  await saveState(s0.id, at(HALL));
  const echo = thinkingHouse({ answer: review({ issues: [{ what: 'the duel is in the 10th Division courtyard; the ledger has the assembly hall, which the header only echoes', fix: 'the courtyard', pages: false, mutations: [{ type: 'place.set', name: YARD, shown: 'Zaraki widened his stance on the torn sand of the courtyard' }] }] }) });
  await withHouse(echo, () => auditLedger({ connection: HOUSES[0].conn, storyId: s0.id, brief: 'A Bleach story.' }));
  for (const rule of ['that line is the truth for both, and the house writes it into the ledger in code; set them only to what that line says, never to anything else',
    'is an echo of a wrong ledger, not the page\'s word: set the ground to where the telling stands']) assert(told(echo).includes(rule), 'the auditor is told: ' + rule);
  eq((await loadState(s0.id)).place.name, YARD, 'the ground is the courtyard again');
  const held = '[' + YARD + ']\n\nZaraki widened his stance in the courtyard.';
  eq((headerMutations(held, { ground: YARD }).find((m) => m.type === 'place.set') || {}).name, YARD, 'the header’s own ground, read in code');
  const s1 = await db.stories.create({ title: 'The duel, held' });
  await db.messages.append(s1.id, { role: 'user', text: 'I draw.' });
  await db.messages.append(s1.id, { role: 'assistant', text: held });
  await saveState(s1.id, at(YARD));
  await withHouse(thinkingHouse({ answer: review({ scene: [{ name: 'Kenpachi Zaraki', repair: false, ending: { position: 'in the courtyard, stance widened', shown: 'Zaraki widened his stance in the courtyard.' } }] }) }), () => auditLedger({ connection: HOUSES[0].conn, storyId: s1.id, brief: 'A Bleach story.' }));
  eq((await loadState(s1.id)).place.name, YARD, 'the courtyard stays');
});
