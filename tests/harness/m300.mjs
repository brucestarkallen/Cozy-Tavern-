/* M300 — a seat says how old it is, everywhere it is read. */
import { test, assert, eq } from './lib.mjs';
import { renderOffscreen, seatAgeWords, seat } from '../../js/engine/offscreen.js';
import { renderPeopleTiers } from '../../js/engine/people.js';
import { emptyState } from '../../js/engine/state.js';

test('M300-1: a seat older than half an hour of story time says its age; it reports an overdue review without guessing a departure; a fresh seat says nothing', () => {
  const at = 22 * 60 + 40; /* 10:40pm, when she was seated */
  const seats = seat({}, 'Ms. June', { location: 'the Bluebird', activity: 'closing up', stance: 'busy' }, at, 5);
  eq(seatAgeWords(seats['Ms. June'], at + 10), '', 'ten minutes on: nothing to say');
  eq(seatAgeWords(seats['Ms. June'], at + 45), 'last updated 45 minutes ago in story time; awaiting the world’s next review', 'three quarters of an hour: said');
  eq(seatAgeWords(seats['Ms. June'], at + 9 * 60), 'last updated about 9 hours ago in story time; awaiting the world’s next review', 'nine hours on: said, and doubted');
  eq(seatAgeWords(seats['Ms. June'], null), '', 'no clock: nothing to say');
  const line = renderOffscreen(seats, [{ name: 'Jovan' }], at + 9 * 60);
  assert(/Ms\. June — the Bluebird, closing up.*\(last updated about 9 hours ago in story time; awaiting the world’s next review\)/.test(line), 'the storyteller reads the age with the seat: ' + line);
  const fresh = renderOffscreen(seats, [{ name: 'Jovan' }], at + 5);
  assert(!/last updated/.test(fresh), 'a fresh seat is read plain: ' + fresh);
  /* the people block's recalled card carries it too */
  const state = { ...emptyState(), page: 40, clock: { minutes: at + 9 * 60, calendar: 'real' }, present: [{ name: 'Jovan' }], offscreen: seats,
    characters: { 'Ms. June': { core: 'Bluebird waitress in her fifties.', state: 'behind the counter', arc: '', threads: [], updatedAtTurn: 10 } } };
  const tiers = renderPeopleTiers(state, { recentPages: ['Ms. June waved from the doorway.'] });
  assert(tiers && /awaiting the world’s next review/.test(tiers.text), 'the recalled card says the seat’s age: ' + (tiers && tiers.text));
});
