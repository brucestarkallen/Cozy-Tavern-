/* M300 — a seat says how old it is, everywhere it is read. */
import { test, assert, eq } from './lib.mjs';
import { renderOffscreen, seatAgeWords, seat } from '../../js/engine/offscreen.js';
import { renderPeopleTiers } from '../../js/engine/people.js';
import { emptyState } from '../../js/engine/state.js';

test('M300-1: a seat older than half an hour of story time says its age; past three hours it says the person has likely moved on; a fresh seat says nothing', () => {
  const at = 22 * 60 + 40; /* 10:40pm, when she was seated */
  const seats = seat({}, 'Ms. June', { location: 'the Bluebird', activity: 'closing up', stance: 'busy' }, at, 5);
  eq(seatAgeWords(seats['Ms. June'], at + 10), '', 'ten minutes on: nothing to say');
  eq(seatAgeWords(seats['Ms. June'], at + 45), 'as of 45 minutes ago', 'three quarters of an hour: said');
  eq(seatAgeWords(seats['Ms. June'], at + 9 * 60), 'as of about 9 hours ago; likely elsewhere by now', 'nine hours on: said, and doubted');
  eq(seatAgeWords(seats['Ms. June'], null), '', 'no clock: nothing to say');
  const line = renderOffscreen(seats, [{ name: 'Jovan' }], at + 9 * 60);
  assert(/Ms\. June — the Bluebird, closing up.*\(as of about 9 hours ago; likely elsewhere by now\)/.test(line), 'the storyteller reads the age with the seat: ' + line);
  const fresh = renderOffscreen(seats, [{ name: 'Jovan' }], at + 5);
  assert(!/as of/.test(fresh), 'a fresh seat is read plain: ' + fresh);
  /* the people block's recalled card carries it too */
  const state = { ...emptyState(), page: 40, clock: { minutes: at + 9 * 60, calendar: 'real' }, present: [{ name: 'Jovan' }], offscreen: seats,
    characters: { 'Ms. June': { core: 'Bluebird waitress in her fifties.', state: 'behind the counter', arc: '', threads: [], updatedAtTurn: 10 } } };
  const tiers = renderPeopleTiers(state, { recentPages: ['Ms. June waved from the doorway.'] });
  assert(tiers && /likely elsewhere by now/.test(tiers.text), 'the recalled card says the seat’s age: ' + (tiers && tiers.text));
});
