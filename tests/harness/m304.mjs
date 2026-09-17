/* M304 — someone who leaves the page is never nowhere; the seat law knows what the people law knows;
 * the world agent is shown everyone the story carries. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, saveState, loadState, foldJournal } from '../../js/engine/state.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { renderOffscreen, seatLine, seatOrder } from '../../js/engine/offscreen.js';
import { carriedBy, seatHousekeeping, wakeHousekeeping, peopleHousekeeping, SEAT_CAP, RETIRE_AFTER } from '../../js/agents/auditor.js';
import { buildWorldMessages, peopleForWorld } from '../../js/agents/world.js';

const at = (state, page, list) => applyMutations({ ...state, page }, list).state;
const scene = () => at(emptyState(), 0, [
  { type: 'mc.set', name: 'Jovan' },
  { type: 'clock.set', year: 2025, month: 3, day: 14, hour: 20, minute: 0 },
  { type: 'place.set', name: 'The Bluebird' },
  { type: 'presence.enter', name: 'Jovan' },
  { type: 'presence.enter', name: 'Ms. June' },
  { type: 'presence.enter', name: 'Kim' },
  { type: 'presence.enter', name: 'Liara' },
]);

test('M304-1 someone who leaves the page is kept where they were last seen, and when — the house invents nothing, and a take-back takes it with it', () => {
  let st = scene();
  eq(Object.keys(st.offscreen).length, 0);
  st = at(st, 1, [{ type: 'presence.leave', name: 'Kim' }]);
  const kim = st.offscreen.Kim;
  assert(kim && kim.lastSeen === true, 'Kim has a whereabouts the moment she leaves (she had none: walking out wrote nothing)');
  eq(kim.location, 'The Bluebird'); eq(kim.activity, '', 'no doing is invented');
  assert(!kim.agenda && !kim.stance, 'no want and no stance are invented');
  eq(kim.sinceMinutes, st.clock.minutes, 'stamped with the hour');
  eq(seatLine('Kim', kim, st.clock.minutes), 'Kim — last seen at The Bluebird');
  eq(seatLine('Kim', kim, st.clock.minutes + 45), 'Kim — last seen at The Bluebird (as of 45 minutes ago)', 'and it says its age like any seat (M300)');
  /* the main character is never written elsewhere */
  const gone = at(st, 2, [{ type: 'presence.leave', name: 'Jovan' }]);
  assert(!Object.keys(gone.offscreen).some((k) => /jovan/i.test(k)), 'the main character is never seated');
  /* a take-back of the leaving takes the sighting with it */
  const back = undoLast(st);
  assert(back && back.state.present.some((p) => p.name === 'Kim') && !back.state.offscreen.Kim, 'undone: she is in the scene and the sighting is gone');
  /* walking back in lets it go like any seat */
  const returned = at(st, 2, [{ type: 'presence.enter', name: 'Kim' }]);
  assert(!returned.offscreen.Kim && returned.present.some((p) => p.name === 'Kim'));
});

test('M304-2 on a page that also moved the ground, the ones who left were last seen where the page BEGAN — in any order, in one batch or two, live or folded from the journal', () => {
  const want = 'The Bluebird';
  const a = at(scene(), 1, [{ type: 'place.set', name: 'The Wells house' }, { type: 'presence.leave', name: 'Ms. June' }]);
  eq(a.offscreen['Ms. June'].location, want, 'the ground moved first in the batch: she was never at the Wells house');
  const b = at(scene(), 1, [{ type: 'presence.leave', name: 'Ms. June' }, { type: 'place.set', name: 'The Wells house' }]);
  eq(b.offscreen['Ms. June'].location, want, 'the leaving first');
  /* the header line's place.set lands in a batch of its own, before the page reader's */
  let c = at(scene(), 1, [{ type: 'place.set', name: 'The Wells house' }]);
  c = at(c, 1, [{ type: 'presence.leave', name: 'Ms. June' }]);
  eq(c.offscreen['Ms. June'].location, want, 'two batches, one page');
  /* the NEXT page's leaving is at the ground that page began on */
  const d = at(c, 2, [{ type: 'presence.leave', name: 'Liara' }]);
  eq(d.offscreen.Liara.location, 'The Wells house', 'a later page reads the ground as it stands');
  /* a fold of the journal to that page rebuilds the same whereabouts, with no model */
  const folded = foldJournal(d, [], 2, (s, list) => applyMutations(s, list));
  eq(JSON.stringify(Object.fromEntries(Object.entries(folded.offscreen).map(([k, v]) => [k, [v.location, v.lastSeen === true]]))),
    JSON.stringify(Object.fromEntries(Object.entries(d.offscreen).map(([k, v]) => [k, [v.location, v.lastSeen === true]]))), 'the fold and the live ledger agree');
});

test('M304-3 when the prose says where they went, that seat stands — written before the leaving (it was REFUSED: "is in the scene") or after it', () => {
  const seatFirst = applyMutations({ ...scene(), page: 1 }, [
    { type: 'offscreen.set', name: 'Kim', location: 'the 6:10 bus', activity: 'riding home', agenda: 'call her sister', stance: 'busy' },
    { type: 'presence.leave', name: 'Kim' },
  ]);
  eq(seatFirst.rejected.filter((r) => !r.same).length, 0, 'nothing refused: ' + JSON.stringify(seatFirst.rejected.map((r) => r.why)));
  const k1 = seatFirst.state.offscreen.Kim;
  assert(k1 && k1.location === 'the 6:10 bus' && k1.lastSeen !== true, 'the reader’s seat stands, not a sighting: ' + JSON.stringify(k1));
  const leaveFirst = at(scene(), 1, [
    { type: 'presence.leave', name: 'Kim' },
    { type: 'offscreen.set', name: 'Kim', location: 'the 6:10 bus', activity: 'riding home' },
  ]);
  assert(leaveFirst.offscreen.Kim.location === 'the 6:10 bus' && leaveFirst.offscreen.Kim.lastSeen !== true, 'the sighting is replaced whole');
  /* and the world agent moving someone on from a sighting later replaces it the same way */
  let later = at(scene(), 1, [{ type: 'presence.leave', name: 'Kim' }]);
  later = at(later, 3, [{ type: 'offscreen.set', name: 'Kim', location: 'her flat', activity: 'asleep' }]);
  assert(later.offscreen.Kim.lastSeen !== true && later.offscreen.Kim.location === 'her flat');
});

test('M304-4 a sighting and the ground-as-it-was survive a save and a load', async () => {
  let st = at(scene(), 1, [{ type: 'place.set', name: 'The Wells house' }, { type: 'presence.leave', name: 'Ms. June' }]);
  await saveState('m304-roundtrip', st);
  const again = await loadState('m304-roundtrip');
  eq(again.offscreen['Ms. June'].lastSeen, true);
  eq(JSON.stringify(again.groundWas), JSON.stringify({ name: 'The Bluebird', page: 1 }));
});

test('M304-5 the seat law knows what the people law knows: the brief’s first name, an invited card, a locked truth, a loose end, the writer’s hand and a fresh history each keep a seat — and its person', () => {
  let st = { ...emptyState(), turn: 200 };
  st = applyMutations({ ...st, page: 60 }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Rias Gremory', field: 'core', text: 'his fiancée; heir of her house' },
    { type: 'offscreen.set', name: 'Rias Gremory', location: 'the clubroom', activity: 'reading reports', stance: 'busy' },
    { type: 'people.set', name: 'Akeno Himejima', field: 'core', text: 'the vice-president' },
    { type: 'offscreen.set', name: 'Akeno Himejima', location: 'the shrine', activity: 'sweeping' },
    { type: 'people.set', name: 'Mira', field: 'core', text: 'his sister' },
    { type: 'offscreen.set', name: 'Mira', location: 'Osaka', activity: 'at work' },
    { type: 'canon.lock', name: 'Mira', key: 'kin', value: 'Jovan’s younger sister' },
    { type: 'people.set', name: 'Old Tom', field: 'core', text: 'the landlord' },
    { type: 'offscreen.set', name: 'Old Tom', location: 'his office', activity: 'counting rent' },
    { type: 'people.note', name: 'Old Tom', field: 'thread', text: 'promised to fix the boiler before winter' },
    { type: 'people.set', name: 'Sona', field: 'core', text: 'the student council president' },
    { type: 'people.set', name: 'Sona', field: 'arc', text: 'wary of Jovan since the council meeting; respects his nerve' },
    { type: 'offscreen.set', name: 'Sona', location: 'the council room', activity: 'working late' },
    { type: 'people.set', name: 'Wendell', field: 'core', text: 'a cab driver' },
    { type: 'offscreen.set', name: 'Wendell', location: 'the boardwalk', activity: 'parked' },
  ]).state;
  for (const k of Object.keys(st.offscreen)) st.offscreen[k].atTurn = 1; /* seated long ago */
  const pages = Array.from({ length: 20 }, (_, i) => ({ role: 'assistant', text: 'Page ' + i + ': Jovan walked alone along the river and thought about the exam.' }));
  const opts = { brief: 'Jovan is engaged to Rias, who does not know he is leaving.', castNotes: '', castNames: ['Akeno Himejima'], pages };
  eq(carriedBy(st, 'Rias Gremory', opts), 'the brief names them', 'the brief says "Rias" — material.includes("rias gremory") carried no one');
  eq(carriedBy(st, 'Akeno Himejima', opts), 'the brief names them', 'an invited card is the writer’s own person');
  eq(carriedBy(st, 'Mira', opts), 'something locked true of them');
  eq(carriedBy(st, 'Old Tom', opts), 'a loose end on their page');
  eq(carriedBy(st, 'Sona', opts), 'a history with the main character');
  eq(carriedBy(st, 'Wendell', opts), '', 'nothing carries the cab driver');
  const sweep = seatHousekeeping(st, opts);
  eq(sweep.filter((m) => m.type === 'offscreen.clear').map((m) => m.name).join(','), 'Wendell', 'only the passer-through loses his seat: ' + JSON.stringify(sweep));
  eq(sweep.filter((m) => m.type === 'people.retire').map((m) => m.name).join(','), 'Wendell', 'and only he passes out of the story');
  /* a history that has gone quiet as long as M57 itself waits no longer carries */
  const quiet = JSON.parse(JSON.stringify(st));
  quiet.characters.Sona.updatedAtTurn = (quiet.characters.Sona.updatedAtTurn || 0) - RETIRE_AFTER - 1;
  eq(carriedBy(quiet, 'Sona', opts), '', 'thirty quiet pages, no bond, no thread: the old law holds');
  /* the writer's own hand */
  const hand = applyMutations({ ...st, page: 61 }, [{ type: 'people.set', name: 'Wendell', field: 'core', text: 'a cab driver who knows every back street', hand: true }]).state;
  if (hand.characters.Wendell.hand) eq(carriedBy(hand, 'Wendell', opts), 'the writer’s own hand on their page');
  /* the people law: an invited card is never retired for being quiet */
  const old = JSON.parse(JSON.stringify(st));
  delete old.offscreen['Akeno Himejima'];
  old.characters['Akeno Himejima'].updatedAtTurn = -100;
  assert(peopleHousekeeping(old, opts.brief, '', []).some((m) => m.name === 'Akeno Himejima'), 'without the card’s name she would retire');
  assert(!peopleHousekeeping(old, opts.brief, '', ['Akeno Himejima']).some((m) => m.name === 'Akeno Himejima'), 'with it she waits as long as the story needs');
});

test('M304-6 the seat cap is a runaway guard: twenty-five people the story carries keep twenty-five whereabouts (twelve was the most it would hold)', () => {
  let st = { ...emptyState(), turn: 90 };
  const muts = [{ type: 'mc.set', name: 'Jovan' }];
  for (let i = 0; i < 25; i += 1) { muts.push({ type: 'offscreen.set', name: 'Friend' + i, location: 'town', activity: 'about their day' }); muts.push({ type: 'rel.shift', name: 'Friend' + i, axis: 'p', delta: 10, cause: 'the page' }); }
  st = applyMutations(st, muts).state;
  for (const k of Object.keys(st.offscreen)) st.offscreen[k].atTurn = 1;
  eq(seatHousekeeping(st, { pages: [] }).filter((m) => m.type === 'offscreen.clear').length, 0, 'none of the twenty-five is let go');
  assert(SEAT_CAP >= 40, 'the guard sits well past a real cast: ' + SEAT_CAP);
});

test('M304-7 whoever the story still carries is brought back from among the passers-through; a mention alone wakes no one', () => {
  let st = { ...emptyState(), turn: 90 };
  st = applyMutations(st, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Mira', field: 'core', text: 'his sister' },
    { type: 'rel.shift', name: 'Mira', axis: 'p', delta: 18, cause: 'the page' },
    { type: 'people.retire', name: 'Mira', cause: 'the old seat law' },
    { type: 'people.set', name: 'Wendell', field: 'core', text: 'a cab driver' },
    { type: 'people.retire', name: 'Wendell', cause: 'passed through' },
  ]).state;
  assert(st.characters.Mira.retired && st.characters.Wendell.retired);
  const woken = wakeHousekeeping(st, { brief: '', castNotes: '', castNames: [] });
  eq(woken.map((m) => m.type + ':' + m.name).join(','), 'people.wake:Mira', 'the sister with a standing comes back; the cab driver does not');
  const after = applyMutations(st, woken).state;
  assert(!after.characters.Mira.retired, 'and she is in the storyteller’s sight again');
  eq(wakeHousekeeping(after, {}).length, 0, 'once is enough');
});

test('M304-8 the world agent is shown everyone the story carries, the most important first — not the first twenty ever written — and is told who has no whereabouts', () => {
  let st = { ...emptyState(), turn: 300 };
  const muts = [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The river path' }];
  /* thirty DIFFERENT people — near-names are one person to the ledger (findPersonKey), so "Villager01…30" was one page */
  const VILLAGERS = ['Abel Moreau', 'Bruna Katz', 'Cedric Vale', 'Dalia Orne', 'Emeric Stahl', 'Fenna Quist', 'Goran Pell', 'Hedda Ruiz', 'Ivo Marchetti', 'Jorun Ashby',
    'Kasimir Lund', 'Lotte Brandt', 'Marek Oyelaran', 'Nives Corbin', 'Osric Thane', 'Petra Vogel', 'Quillon Reyes', 'Rosalind Kerr', 'Stellan Moss', 'Tamsin Wray',
    'Ulric Banner', 'Vesna Dahl', 'Wystan Holt', 'Xanthe Piper', 'Yorick Salo', 'Zelda Farrow', 'Anselm Drury', 'Beatrix Noll', 'Caspian Hurst', 'Delphine Aubry'];
  for (const name of VILLAGERS) muts.push({ type: 'people.set', name, field: 'core', text: 'someone from the opening chapters, met once at the market' });
  muts.push({ type: 'people.set', name: 'Rias Gremory', field: 'core', text: 'his fiancée; heir of her house; proud, watchful, in love and hiding it' });
  muts.push({ type: 'rel.shift', name: 'Rias Gremory', axis: 'r', delta: 20, cause: 'the page' }, { type: 'rel.shift', name: 'Rias Gremory', axis: 'p', delta: 20, cause: 'the page' });
  muts.push({ type: 'people.set', name: 'Gone Guy', field: 'core', text: 'a courier' }, { type: 'people.retire', name: 'Gone Guy', cause: 'passed through' });
  st = applyMutations({ ...st, page: 120 }, muts).state;
  /* the villagers are OLD — a person's first ten pages weigh as someone who matters (M284), and these are from the opening chapters */
  for (const name of VILLAGERS) st.characters[name] = { ...st.characters[name], firstSeenTurn: 1, updatedAtTurn: 1 };
  const { user, system } = buildWorldMessages({ state: st, userText: 'I walk.', assistantText: 'He walked.', brief: 'Jovan and Rias.', castNotes: '' });
  const list = user.slice(user.indexOf('THE PEOPLE THE STORY CARRIES'));
  assert(/Rias Gremory \[NO SEAT — seat them\]/.test(list), 'the one who matters most — written LAST, thirty-first — is shown (the old loop stopped at twenty)');
  assert(list.indexOf('Rias Gremory') < list.indexOf('Abel Moreau'), 'and first, by importance, not by when her page was made');
  assert(/WITH NO WHEREABOUTS RIGHT NOW[^\n]*Rias Gremory/.test(user), 'and named among those to seat in this answer');
  assert(!/Gone Guy/.test(list), 'a passer-through is not the world agent’s to move');
  eq(VILLAGERS.filter((n) => list.includes(n)).length, 30, 'everyone fits a room this size — no one is cut');
  assert(!/Abel Moreau \[NO SEAT/.test(list), 'someone met once, long ago, with no bond is not pushed onto the world agent to seat');
  /* a small room: whole, then lean, then a stated cut that names the rest */
  const tight = peopleForWorld(st, { material: 'Jovan and Rias.', room: 1200 });
  assert(tight.shown < tight.total && /more the ledger knows did not fit[^\n]*Zelda Farrow/.test(tight.text), 'the cut is said, with the names it left out: ' + tight.text.slice(-200));
  eq(tight.shown + tight.text.match(/the least important: ([^\n]*?) — fetch/)[1].split(', ').length, tight.total, 'every person is either shown or named in the cut — no one is silently dropped');
  assert(tight.text.startsWith('Rias Gremory'), 'and what is kept is the most important');
  /* the law no longer tells it to leave people nowhere, or to keep twelve */
  assert(/leave the AGENDA\s+out, never the person/.test(system.replace(/\n/g, ' ')), 'a missing want never unseats a person');
  assert(!/leave them\s+unseated/.test(system) && !/at most twelve seats/.test(system), 'the two lines that emptied the room are gone');
  assert(/last seen at/.test(system), 'and it is told what the house’s own sighting is');
  /* the drawer's order is the storyteller's order */
  const seats = applyMutations({ ...st, page: 121 }, [
    { type: 'offscreen.set', name: 'Bruna Katz', location: 'the market', activity: 'selling' },
    { type: 'offscreen.set', name: 'Rias Gremory', location: 'the train', activity: 'riding', stance: 'toward', etaMinutes: 20 },
  ]).state;
  eq(seatOrder(seats.offscreen, null)[0], 'Rias Gremory', 'whoever can reach the scene first leads the list');
  assert(renderOffscreen(seats.offscreen, [], null, 40).startsWith('Rias Gremory'));
});
