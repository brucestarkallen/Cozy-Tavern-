/* M365: a seat goes stale. Caleb, seated once at the neighbour's, stayed there for days of story because the world
 * agent was only ever asked to seat people with NO whereabouts. A seat now has an age, and one past it is marked for
 * moving on like no seat at all; a time skip ages every seat at once. And a bond is a cause: the people closest to
 * him reach him the way people do. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { seatAge, seatIsStale, peopleForWorld, STALE_SEAT_MINUTES, STALE_SEAT_PAGES, buildWorldMessages } from '../../js/agents/world.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const briefOf = (st) => { const m = buildWorldMessages({ state: st, userText: 'I wait.', assistantText: 'Nothing moved.' }); return String(m.system || ''); };
const world = (clockMinutes, seatMinutes, { page = 3, seatTurn = 3 } = {}) => {
  const st = applyMutations({ ...emptyState(), page }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  if (clockMinutes !== null) st.clock = { minutes: clockMinutes };
  st.characters = { Caleb: { core: 'Football captain; everyone calls him cap. Jovan’s best friend.', state: '', threads: [] } };
  st.offscreen = { Caleb: { location: 'the neighbour’s porch', activity: 'waiting', sinceMinutes: seatMinutes, atTurn: seatTurn } };
  return st;
};

test('M365-1 A SEAT HAS AN AGE, AND ONE PAST IT IS STALE — by the story clock, or by pages when the story keeps none', () => {
  eq(seatIsStale(world(9 * 60, 9 * 60), 'Caleb'), false, 'just seated: not stale');
  eq(seatIsStale(world(9 * 60 + STALE_SEAT_MINUTES - 1, 9 * 60), 'Caleb'), false, 'a little under three hours: not yet');
  eq(seatIsStale(world(9 * 60 + STALE_SEAT_MINUTES, 9 * 60), 'Caleb'), true, 'three story-hours on: stale');
  const skipped = world(9 * 60 + 26 * 60, 9 * 60);
  eq(seatAge(skipped, 'Caleb').minutes, 26 * 60, 'a 26-hour skip ages the seat by 26 hours');
  eq(seatIsStale(skipped, 'Caleb'), true, 'and it is stale');
  const clockless = world(null, null, { page: 3 + STALE_SEAT_PAGES, seatTurn: 3 });
  eq(seatIsStale(clockless, 'Caleb'), true, 'no clock: twelve pages on is stale');
  eq(seatIsStale(world(null, null, { page: 5, seatTurn: 3 }), 'Caleb'), false, 'and two pages on is not');
  eq(seatAge(world(9 * 60, 9 * 60), 'Nobody'), null, 'someone with no seat has no seat’s age');
});

test('M365-2 THE WORLD AGENT IS SHOWN WHO HAS BEEN SITTING STILL, AND TOLD TO MOVE THEM ON — a time skip walks the whole world forward', () => {
  const roster = peopleForWorld(world(9 * 60 + 26 * 60, 9 * 60), { material: 'Caleb is Jovan’s best friend.' });
  const text = typeof roster === 'string' ? roster : roster.text;
  assert(/Caleb \[SEATED 26 hours ago — move them on\]/.test(text), 'Caleb is marked, with how long he has been sitting there: ' + text.slice(0, 120));
  const fresh = peopleForWorld(world(9 * 60 + 30, 9 * 60), { material: 'Caleb is Jovan’s best friend.' });
  assert(!/move them on/.test(typeof fresh === 'string' ? fresh : fresh.text), 'a fresh seat is left alone');
  assert(/A SEAT GOES STALE/.test(briefOf(world(9 * 60, 9 * 60))) && /After a time skip, that is\s+everyone/.test(briefOf(world(9 * 60, 9 * 60))), 'the law is in its brief');
  assert(/never a life/.test(briefOf(world(9 * 60, 9 * 60))), 'a day in one place with nothing holding them is a mistake, said so');
});

test('M365-3 A BOND IS A CAUSE: the people closest to him reach him the way people do — still never on a timer, still at most one a scene', () => {
  assert(/A BOND IS A CAUSE/.test(briefOf(world(9 * 60, 9 * 60))), 'the law is in its brief');
  assert(/a teammate who\s+(?:'\s*\+\s*')?calls him "cap"/.test(briefOf(world(9 * 60, 9 * 60)).replace(/\n/g, ' ')) || /calls him "cap"/.test(briefOf(world(9 * 60, 9 * 60))), 'in his own story’s terms');
  assert(/NEVER on a timer/.test(briefOf(world(9 * 60, 9 * 60))) && /at most one such contact per scene/.test(briefOf(world(9 * 60, 9 * 60))), 'and the old limits still stand');
});
