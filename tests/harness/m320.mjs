/* M320 — one person, one name, in every book: a seat is found (and written) the way a page is. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { findSeat } from '../../js/engine/offscreen.js';
import { renderPeopleTiers, seatForPerson } from '../../js/engine/people.js';
import { peopleForWorld } from '../../js/agents/world.js';
import { seatIdentityHousekeeping } from '../../js/agents/auditor.js';

const base = () => applyMutations({ ...emptyState(), page: 20, turn: 60 }, [
  { type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2025, month: 3, day: 14, hour: 20, minute: 0 }, { type: 'place.set', name: 'The Wells house' }, { type: 'presence.enter', name: 'Jovan' },
  { type: 'people.set', name: 'Rias Gremory', field: 'core', text: 'his fiancée; heir of her house' },
  { type: 'people.set', name: 'Rias Gremory', field: 'state', text: 'waving from the school gate' },
  { type: 'rel.shift', name: 'Rias Gremory', axis: 'r', delta: 20, cause: 'the page' },
]).state;

test('M320-1 THE WRITER’S STALE PAGE: the world agent seats "Rias" while her page stands as "Rias Gremory" — it is ONE seat, under her page’s name, and her page, her card and the world agent all see it', () => {
  let st = base();
  st.characters['Rias Gremory'].updatedAtTurn = 10; /* her page was last written long ago */
  const r = applyMutations({ ...st, page: 21 }, [{ type: 'offscreen.set', name: 'Rias', location: 'the clubroom', activity: 'reading reports', stance: 'busy' }]);
  eq(Object.keys(r.state.offscreen).join(','), 'Rias Gremory', 'seated under the name her page stands under (it was a second identity, "Rias")');
  assert(findSeat(r.state.offscreen, 'Rias') && findSeat(r.state.offscreen, 'rias gremory'), 'and found by either form of her name');
  const world = peopleForWorld(r.state, { material: 'Jovan and Rias.' });
  assert(!/Rias Gremory \[NO SEAT/.test(world.text) && !world.unseated.includes('Rias Gremory'), 'the world agent is not told she has no seat');
  const back = undoLast(r.state);
  eq(Object.keys(back.state.offscreen).length, 0, 'a take-back takes it back');
});

test('M320-2 a ledger already holding the split is healed by the house: the seat moves under the page’s name with its age kept; her "now" comes from the seat, not the fourteen-page-old note', () => {
  let st = base();
  st.characters['Rias Gremory'].updatedAtTurn = 10;
  st.offscreen = { Rias: { location: 'the clubroom', activity: 'reading reports', stance: 'busy', sinceMinutes: st.clock.minutes - 45, atTurn: 55 } }; /* as m319 and before wrote it */
  /* even before the heal, every reader finds it */
  const card = renderPeopleTiers(st, { recentPages: ['Rias Gremory was on his mind.'], brief: 'Jovan and Rias.' }).text;
  assert(/the clubroom, reading reports/.test(card) && !/waving from the school gate/.test(card.split('Rias Gremory')[1] || ''), 'her card tells the storyteller where she IS: ' + card.slice(0, 400));
  const heal = seatIdentityHousekeeping(st);
  eq(JSON.stringify(heal.map((m) => [m.type, m.from, m.to])), '[["offscreen.rekey","Rias","Rias Gremory"]]');
  const healed = applyMutations({ ...st, page: 21 }, heal);
  eq(Object.keys(healed.state.offscreen).join(','), 'Rias Gremory');
  eq(healed.state.offscreen['Rias Gremory'].sinceMinutes, st.clock.minutes - 45, 'the seat is the same seat — its age is kept');
  eq(seatIdentityHousekeeping(healed.state).length, 0, 'once is enough');
  const undone = undoLast(healed.state);
  eq(Object.keys(undone.state.offscreen).join(','), 'Rias', 'and it can be taken back');
  /* two seats for one person: the fresher stays */
  const two = { ...st, offscreen: { Rias: { location: 'the clubroom', sinceMinutes: 100, atTurn: 5 }, 'Rias Gremory': { location: 'the train home', sinceMinutes: 900, atTurn: 50 } } };
  const merged = applyMutations(two, seatIdentityHousekeeping(two)).state;
  eq(JSON.stringify(Object.entries(merged.offscreen).map(([k, v]) => [k, v.location])), '[["Rias Gremory","the train home"]]');
});

test('M320-3 walking in lets the seat go whichever form of the name it stands under; and two people who share a first name are never taken for one', () => {
  let st = base();
  st.offscreen = { Rias: { location: 'the clubroom', sinceMinutes: 1, atTurn: 1 } };
  const entered = applyMutations({ ...st, page: 21 }, [{ type: 'presence.enter', name: 'Rias Gremory' }]).state;
  eq(Object.keys(entered.offscreen).length, 0, 'she is in the scene — and no longer also "elsewhere"');
  const twins = applyMutations(base(), [{ type: 'people.set', name: 'Vanessa Reynolds', field: 'core', text: 'a teacher' }, { type: 'people.set', name: 'Vanessa Cole', field: 'core', text: 'a nurse' }]).state;
  const seated = applyMutations(twins, [{ type: 'offscreen.set', name: 'Vanessa', location: 'the market', activity: 'shopping' }]).state;
  eq(Object.keys(seated.offscreen).join(','), 'Vanessa', 'two Vanessas: the short name is nobody’s in particular, and stays its own');
  eq(seatForPerson(seated, 'Vanessa Cole'), null, 'and it is shown as NEITHER Vanessa’s whereabouts');
  eq(seatForPerson(seated, 'Vanessa Reynolds'), null);
  const walkedIn = applyMutations(seated, [{ type: 'presence.enter', name: 'Vanessa Cole' }]).state;
  eq(Object.keys(walkedIn.offscreen).join(','), 'Vanessa', 'nor cleared when one of them walks in');
});
