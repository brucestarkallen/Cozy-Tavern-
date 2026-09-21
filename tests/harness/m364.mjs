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

test('M366-1 THE WORLD AGENT IS SHOWN WHO HAS NOT BEEN LOOKED AT, AND ASKED WHERE THEIR OWN LIFE HAS THEM NOW — never forced to move, never where the story simply left them', () => {
  const roster = peopleForWorld(world(9 * 60 + 26 * 60, 9 * 60), { material: 'Caleb is Jovan’s best friend.' });
  const text = typeof roster === 'string' ? roster : roster.text;
  assert(/Caleb \[last placed 26 hours ago — where are they now\?\]/.test(text), 'Caleb is marked, with how long ago he was placed: ' + text.slice(0, 120));
  const fresh = peopleForWorld(world(9 * 60 + 30, 9 * 60), { material: 'Caleb is Jovan’s best friend.' });
  assert(!/where are they now/.test(typeof fresh === 'string' ? fresh : fresh.text), 'a fresh placing is left alone');
  const brief = briefOf(world(9 * 60, 9 * 60)).replace(/\s+/g, ' ');
  assert(/EVERYONE LIVES THEIR OWN LIFE/.test(brief), 'the law is in the brief the agent really receives');
  assert(/which may be the same place if their life truly keeps them there/.test(brief), 'staying put is allowed when their life keeps them there');
  assert(/never simply where the story last left them/.test(brief), 'and parking is not');
});

test('M366-2 EVERY PERSON HAS THEIR OWN PEOPLE, AND CONTACTS COME AS REAL LIFE SENDS THEM — no quota, several at once is allowed, none invented', () => {
  const brief = briefOf(world(9 * 60, 9 * 60)).replace(/\s+/g, ' ');
  assert(/not arranged around the main character/.test(brief), 'the world is not arranged around the main character');
  assert(/their own people who call and text THEM \(the team texts its captain/.test(brief), 'NPCs are reached by their own people — the team texts ITS captain');
  assert(/several of them at once, or none/.test(brief) && /No quota and no schedule/.test(brief), 'a mother, a sister and a friend may all reach out on one evening');
  assert(!/at most one such contact per scene/.test(brief), 'the old one-a-scene cap is gone');
  assert(/never invented to fill a scene/.test(brief), 'and nothing is made up to fill one');
});

test('M367-1 A LIFE OF THEIR OWN NEVER DROPS HIM: anyone with a reason concerning the main character keeps pursuing it — and no count caps how many may', () => {
  const brief = briefOf(world(9 * 60, 9 * 60)).replace(/\s+/g, ' ');
  assert(/A life of their own is never a reason to drop HIM/.test(brief), 'the two laws are said together');
  assert(/a thread, a grudge, a want, a debt, a bond — keeps pursuing it through that life/.test(brief), 'a reason concerning him is still pursued');
  assert(/Every agenda someone holds toward the main character keeps moving — no count, no cap/.test(brief), 'every agenda moves');
  assert(/never frozen because too many others are pressing/.test(brief), 'nobody is benched by a number');
  assert(!/Two or three hot threads at most/.test(brief), 'the old cap on threads is gone');
  assert(/it goes quiet while their own life keeps them away/.test(brief), 'what quiets a thread is their life, not a rule');
});
