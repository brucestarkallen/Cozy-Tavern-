/* M294 — the main character's record rides to the scribe, so it is kept. */
import { test, assert } from './lib.mjs';
import { buildScribeMessages } from '../../js/agents/scribe.js';
import { emptyState } from '../../js/engine/state.js';

const chars = {
  'Jovan': { core: '', state: 'At the kitchen window seat, rice finished, sneakers on', arc: '', threads: ['what Vanessa meant by folder-worthy'], updatedAtTurn: 10 },
  'Mi-na': { core: 'Sharp, quiet, keeps score.', state: 'across the table, phone face down', arc: 'wary but warming', threads: [], updatedAtTurn: 40 },
};

test('M294-1: the scribe is shown the main character’s record — their state and loose ends — beside the other pages (it never saw it, so it never kept it)', () => {
  const state = { ...emptyState(), page: 40, turn: 40, place: { name: 'The Wells kitchen' }, present: [{ name: 'Jovan' }, { name: 'Mi-na' }],
    sheet: { ...emptyState().sheet, playerName: 'Jovan' }, characters: chars };
  const { user } = buildScribeMessages({ state, userText: 'I shrug.', assistantText: 'Mi-na slid the phone across.' });
  assert(/Mi-na/.test(user), 'the other pages ride as before');
  assert(/The main character’s record — Jovan/.test(user), 'the main character’s record is named: ' + user.slice(0, 400));
  assert(/Now: At the kitchen window seat/.test(user), 'with its state, so a note that no longer holds is seen');
  assert(/Loose ends: what Vanessa meant by folder-worthy/.test(user), 'and its loose ends');
  assert(user.indexOf('The main character’s record') < user.indexOf('The writer just wrote:'), 'before the pages of this turn');
  /* no page yet: the record is still named, so the first note lands on it */
  const bare = buildScribeMessages({ state: { ...state, characters: { 'Mi-na': chars['Mi-na'] } }, userText: 'x', assistantText: 'y' });
  assert(/The main character’s record — Jovan[^\n]*\nNothing written yet\./.test(bare.user), 'an empty record says so');
  /* no main character named: nothing to show */
  const nobody = buildScribeMessages({ state: { ...state, sheet: emptyState().sheet }, userText: 'x', assistantText: 'y' });
  assert(!/main character’s record/.test(nobody.user), 'no record block when the house does not know who the writer plays');
});
