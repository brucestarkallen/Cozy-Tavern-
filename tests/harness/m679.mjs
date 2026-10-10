/* Cozy Tavern — harness laws of M679 (his: "why the auditor keep finding this problem why not do it before auditor found it?
 * … audit the ledger for all things that should not need auditor to find it", with the auditor's reading of his turn 7
 * pasted under it: the hour "Monday" where the page says "Thornday"; the cobbler, the fruit-seller, the young priest, the
 * pie-seller and the raven still "here now" after Azrael and Roska walked south to the Bent Kettle; the purse still in
 * Roska's fist; two threads still hot; Roska's loose end still open). The room below is his, from that reading. Every law
 * runs the real header reader, the real page reader (its request and its answer, through a scripted house) and the real
 * ledger door, and asserts on what the ledger holds afterwards. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, headerMutations } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { findThread } from '../../js/engine/world.js';
import { db } from '../../js/store.js';
import { saveState, loadState } from '../../js/engine/state.js';

const HEADER_A = '[Ilvarren — Thornday, October 14, 1247 | 15:58 | grey, a cold wind off the river | travel cloak | Cooper’s Row, at the no-sign door]';
const PAGE_A = HEADER_A + '\n\n'
  + 'Roska had her knuckles up to the no-sign door on Cooper’s Row when Azrael’s shadow fell across it. She did not knock. She looked at the door a long moment, then at him, and let her hand drop.\n\n'
  + '“Fine,” she said. She held out her fist and opened it, and it dropped into his open palm, the strings still warm from her grip.\n\n'
  + 'Behind them, up on Gilder’s Row, the cobbler had gone back into his own doorway and the fruit-seller was counting apples behind her second stall again; the pie-seller had started crying his mutton pies again, low and flat, and the young priest had gone in under the temple vestibule.\n\n'
  + 'Azrael closed his hand, nodded south, and Roska fell in beside him. They walked south together toward the Bent Kettle.\n\n'
  + '*** The World Beyond ***\n\n'
  + 'On the chandler’s step the watchman came down at last. Marget gave him a shrug and the back of her gable, and her boy went out the back with a guess dressed as a sighting.';

const HUNTED = 'the watch has her description and Azrael is hunting her himself';
const FAVOUR = 'owes the fence behind the no-sign door a favour';
const FENCE = 'Roska and the fence behind the no-sign door';
const WATCH = 'Marget and the watch';
const GUARD = 'the guard at the well and the thief';

/* his turn-6 ledger: the city as its ground (his header names only the city), Gilder's Row's crowd "here now", the purse
 * as his list read it, the two threads and the loose end the auditor closed, the clock as the old build kept it */
function turnSix() {
  return applyMutations({ ...emptyState(), page: 6 }, [
    { type: 'mc.set', name: 'Azrael' },
    { type: 'place.set', name: 'Ilvarren' },
    { type: 'clock.set', year: 1247, month: 10, day: 14, hour: 15, minute: 40 },
    { type: 'presence.enter', name: 'Azrael' },
    { type: 'presence.enter', name: 'Roska', position: 'at the no-sign door, knuckles raised' },
    { type: 'presence.enter', name: 'the cobbler', position: 'in his own doorway on Gilder’s Row' },
    { type: 'presence.enter', name: 'the fruit-seller', position: 'behind her second stall' },
    { type: 'presence.enter', name: 'the young priest', position: 'on the temple steps' },
    { type: 'presence.enter', name: 'the pie-seller', position: 'by the well, crying mutton pies' },
    { type: 'people.set', name: 'Roska', field: 'core', text: 'a thief of Ilvarren’s lower streets, quick hands, quicker mouth' },
    { type: 'people.note', name: 'Roska', field: 'thread', text: HUNTED },
    { type: 'people.note', name: 'Roska', field: 'thread', text: FAVOUR },
    { type: 'thing.set', name: 'the purse', where: 'in Roska’s fist, purse-strings cold in her own hand', owner: 'Roska' },
    { type: 'thread.set', title: FENCE, owner: 'Roska', heat: 'hot', next: 'knock and sell the purse' },
    { type: 'thread.set', title: WATCH, owner: 'Marget', heat: 'hot', next: 'send the watch off with a guess' },
    { type: 'thread.set', title: GUARD, owner: 'the guard at the well', heat: 'hot', next: 'ask the next stall about the thief' },
  ]).state;
}
const here = (st) => (st.present || []).map((p) => p.name).sort().join(', ');
/* the answer his questions now ask for, as a reader that answers them gives it */
const ANSWER_A = {
  mutations: [
    { type: 'presence.leave', name: 'the cobbler', to: 'his own doorway on Gilder’s Row', shown: 'the cobbler had gone back into his own doorway' },
    { type: 'presence.leave', name: 'the fruit-seller', to: 'behind her second stall on Gilder’s Row', shown: 'the fruit-seller was counting apples behind her second stall again' },
    { type: 'presence.leave', name: 'the young priest', to: 'the temple vestibule', shown: 'the young priest had gone in under the temple vestibule' },
    { type: 'presence.leave', name: 'the pie-seller', to: 'Gilder’s Row, by the well', shown: 'They walked south together toward the Bent Kettle' },
    { type: 'mode.snapshot', flags: [] },
  ],
  threads: [{ title: FENCE, now: 'resolved' }, { title: WATCH, now: 'resolved' }, { title: GUARD, now: 'open' }],
  loose: [{ name: 'Roska', text: HUNTED, now: 'closed' }, { name: 'Roska', text: FAVOUR, now: 'open' }],
  things: [{ name: 'the purse', where: 'in Azrael’s open palm', owner: 'Azrael' }],
  here: ['Azrael', { name: 'Roska', at: 'beside him, walking south toward the Bent Kettle' }],
  spot: 'Cooper’s Row',
};

async function readWith(state, page, answer, userText = 'I catch up with her at the door.') {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const house = thinkingHouse({ answer: JSON.stringify(answer) });
  const read = await withHouse(house, () => extractTurn({ connection: HOUSES[0].conn, state, userText, assistantText: page, pageNumber: 7 }));
  return { read, request: house.calls.length ? JSON.stringify(house.calls[0].body.messages) : '' };
}

test('M679-1 THE STORY’S OWN WEEKDAY: his header “Thornday, October 14, 1247” is the ledger’s day — not the real calendar’s “Monday”; the auditor’s same numbers change nothing; a clock the old build wrote is put right at the very same minute; a real calendar still speaks and rolls over by itself', () => {
  const read = (st, page) => applyMutations(st, headerMutations(page, { ground: (st.place || {}).name || '', day: (st.clock && st.clock.dayWords) || '' })).state;
  let st = read({ ...emptyState() }, PAGE_A);
  eq(st.clock.label, 'Thornday, October 14, 1247 — 15:58', 'his page’s day and hour');
  const again = applyMutations(st, [{ type: 'clock.set', year: 1247, month: 10, day: 14, hour: 15, minute: 58 }]);
  assert(!again.applied.length && again.rejected.some((r) => r && r.same), 'the auditor’s clock.set of the same numbers is “already so”');
  eq(again.state.clock.label, 'Thornday, October 14, 1247 — 15:58', 'and the day keeps its own words');
  eq(applyMutations(st, [{ type: 'clock.set', year: 1247, month: 10, day: 14, hour: 16, minute: 30 }]).state.clock.label, 'Thornday, October 14, 1247 — 16:30', 'a later hour of the same day, by numbers alone, is still Thornday');
  eq(read(st, '[Ilvarren — October 14, 1247 | 17:05 | dusk]\n\nLater.').clock.label, 'Thornday, October 14, 1247 — 17:05', 'a header that names no weekday on the same day keeps it');
  st = read(st, '[Ilvarren — Ashday, October 15, 1247 | 08:10 | fog]\n\nMorning.');
  eq(st.clock.label, 'Ashday, October 15, 1247 — 08:10', 'the next day of his own week');
  eq(read(st, '[Ilvarren — October 16, 1247 | 09:00 | fog]\n\nAnother day.').clock.label, 'October 16, 1247 — 09:00', 'a day his header gives no weekday: no real weekday is made up for his world');
  /* his ledger as the old build left it: "Monday", the same minute as the page */
  const old = applyMutations({ ...emptyState() }, [{ type: 'clock.set', year: 1247, month: 10, day: 14, hour: 15, minute: 58 }]).state;
  eq(old.clock.label, 'Monday, October 14, 1247 — 15:58', 'the old build’s reading (the real calendar’s weekday)');
  const healed = applyMutations(old, headerMutations(PAGE_A, { ground: 'Ilvarren' }));
  assert(healed.applied.some((a) => a.mutation.type === 'clock.set'), 'the header’s own day is written over it at the same minute (not refused as the same hour)');
  eq(healed.state.clock.label, 'Thornday, October 14, 1247 — 15:58', 'and it reads as the page does');
  /* a real calendar: the header’s weekday is the real one — the real calendar speaks and rolls over at midnight */
  let real = read({ ...emptyState() }, '[Mark’s apartment — Monday, March 3, 2025 | 21:00 | rain]\n\nIn.');
  eq(real.clock.label, 'Monday, March 3, 2025 — 21:00', 'a real Monday');
  real = applyMutations(real, [{ type: 'clock.advance', minutes: 720, reason: 'the night' }]).state;
  eq(real.clock.label, 'Tuesday, March 4, 2025 — 09:00', 'and the morning after is the real Tuesday');
  eq(read({ ...emptyState() }, '[Mark’s apartment — Thu, Mar 6, 2025 | 08:00 | clear]\n\nIn.').clock.label, 'Thursday, March 6, 2025 — 08:00', 'a short real weekday is the real calendar');
  eq(read({ ...emptyState() }, '[Mark’s apartment — Friday, March 6, 2025 | 08:00 | clear]\n\nIn.').clock.label, 'Friday, March 6, 2025 — 08:00', 'a weekday the real calendar does not put on that date is still the page’s word');
});

test('M679-2 THE QUESTIONS HIS PAGE IS ASKED: where in Ilvarren the scene stands (his header names only the city); for each of the five Gilder’s Row people the page shows, still with him or left behind; a verdict for every open thread (his two among them) and for every loose end of Roska’s; the purse she holds though the page says only “it”', async () => {
  const { buildExtractorMessages } = await import('../../js/agents/extractor.js');
  const p = buildExtractorMessages({ state: turnSix(), userText: 'I catch up with her at the door.', assistantText: PAGE_A, pageNumber: 7 });
  const block = (title) => { const at = p.user.indexOf(title); return at === -1 ? '' : p.user.slice(at, p.user.indexOf('\n\n', at)); };
  const spot = block('WHERE THE SCENE STANDS');
  assert(spot && spot.includes('“Ilvarren”') && /"spot"/.test(spot), 'asked where in Ilvarren the scene stands: ' + spot);
  const places = block('WHERE EACH OF THEM IS AS THIS PAGE ENDS');
  for (const n of ['the cobbler', 'the fruit-seller', 'the pie-seller', 'the young priest']) assert(places.includes(n + ' — the ledger has: '), 'asked about ' + n);
  assert(/NO LONGER WITH HIM/.test(places) && /presence\.leave/.test(places) && /STILL WITH HIM/.test(places), 'and each may be answered as left behind, not only as here: ' + places.slice(0, 300));
  const threads = block('OPEN THREADS');
  for (const t of [FENCE, WATCH, GUARD]) assert(threads.includes('“' + t + '”'), 'the thread “' + t + '” is to be decided');
  assert(/"now":"resolved"/.test(threads) && /"now":"open"/.test(threads) && /pages just before/.test(threads) && /World Beyond/.test(threads), 'each with its own verdict, by how the story stands — the pages before and the window counting');
  const loose = block('LOOSE ENDS STILL OPEN');
  assert(loose.includes('Roska — “' + HUNTED + '”') && loose.includes('Roska — “' + FAVOUR + '”'), 'Roska’s two loose ends, each to be decided: ' + loose);
  const { LOOSE_ANSWERED_MEANS } = await import('../../js/agents/herewords.js');
  assert(loose.includes(LOOSE_ANSWERED_MEANS), 'and what answers one — the one definition the scribe and the auditor read too — rides with them');
  const things = block('THINGS THE LEDGER KEEPS');
  assert(things.includes('the purse (Roska’s)'), 'the purse she holds is asked about though the page never says “purse”: ' + things);
  assert(/"owner"/.test(things), 'and whose it is may be answered');
  /* a header that names the spot asks nothing of where the scene stands */
  const named = buildExtractorMessages({ state: turnSix(), userText: 'x', assistantText: PAGE_A.replace('[Ilvarren —', '[Cooper’s Row, Ilvarren —'), pageNumber: 7 });
  assert(!named.user.includes('WHERE THE SCENE STANDS'), 'a header that names the spot is the ground, and nobody is asked');
});

test('M679-3 HIS TURN 7, READ: what the reader answers to those questions lands — the ground is Cooper’s Row (in Ilvarren), the Gilder’s Row people are no longer here, the purse is in Azrael’s palm and his again, the two threads are closed and the guard’s stays open, Roska’s hunted loose end is closed and her favour stays', async () => {
  const st = turnSix();
  const { read } = await readWith(st, PAGE_A, ANSWER_A);
  const after = applyMutations(applyMutations(st, headerMutations(PAGE_A, { ground: 'Ilvarren', day: '' })).state, read.mutations).state;
  eq(after.place.name, 'Cooper’s Row, Ilvarren', 'the ground is where in the city the page stands, the city kept with it');
  eq(here(after), 'Azrael, Roska', 'the four left on Gilder’s Row and at the temple are not here now');
  for (const n of ['the cobbler', 'the fruit-seller', 'the young priest', 'the pie-seller']) assert(Object.keys(after.offscreen || {}).some((k) => k === n), n + ' is seated where the page left them');
  eq(after.things['the purse'].where, 'in Azrael’s open palm', 'the purse is in his palm');
  eq(after.things['the purse'].owner, 'Azrael', 'and his again (the list read “(Roska’s)”)');
  eq(findThread(after.threads, FENCE), -1, 'Roska and the fence: closed');
  eq(findThread(after.threads, WATCH), -1, 'Marget and the watch: closed (it ended in the window)');
  assert(findThread(after.threads, GUARD) !== -1, 'the guard’s thread, answered “open”, stays');
  const roska = after.characters.Roska;
  assert(!roska.threads.some((t) => /hunting her/.test(t)), 'Roska’s hunted loose end is closed');
  assert(roska.threads.some((t) => /favour/.test(t)), 'her favour, answered “open”, stays');
  eq(after.clock.label, 'Thornday, October 14, 1247 — 15:58', 'and the hour is the page’s, in its own words');
  /* the old way of answering the threads is still read */
  const { read: old } = await readWith(st, PAGE_A, { mutations: [{ type: 'mode.snapshot', flags: [] }], resolved: [FENCE], here: ['Azrael', 'Roska'] });
  assert(old.mutations.some((m) => m.type === 'thread.close' && m.title === FENCE) && !old.mutations.some((m) => m.type === 'thread.close' && m.title === WATCH), 'a "resolved" list closes what it names, and only that');
});

test('M679-4 A WALK FROM ONE STREET TO THE NEXT IS A MOVE: from Cooper’s Row into the Bent Kettle under a header that names only the city, whoever the page’s room does not hold stays behind on Cooper’s Row — written by the house when the reader names the room and forgets the leave', async () => {
  const st = applyMutations({ ...emptyState(), page: 7 }, [
    { type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'Cooper’s Row, Ilvarren' },
    { type: 'presence.enter', name: 'Azrael' }, { type: 'presence.enter', name: 'Roska' },
    { type: 'presence.enter', name: 'the raven', position: 'on the gable above the door' },
  ]).state;
  const page = '[Ilvarren — Thornday, October 14, 1247 | 16:20 | grey | travel cloak | the Bent Kettle, by the fire]\n\n'
    + 'The Bent Kettle was warm and half empty. Old Hesk looked up from his barrel-top as Azrael ducked in under the lintel with Roska behind him, and set out two cups without being asked.';
  const { read } = await readWith(st, page, { mutations: [{ type: 'presence.enter', name: 'Old Hesk', position: 'behind his barrel-top' }, { type: 'mode.snapshot', flags: [] }], here: ['Azrael', 'Roska', 'Old Hesk'], spot: 'the Bent Kettle' });
  assert(read.mutations.some((m) => m.type === 'place.set' && m.name === 'the Bent Kettle, Ilvarren'), 'the ground moves into the Bent Kettle: ' + JSON.stringify(read.mutations.filter((m) => m.type === 'place.set')));
  const left = read.mutations.find((m) => m.type === 'presence.leave' && m.name === 'the raven');
  assert(left, 'the raven, quiet and not in the room the page names, is left behind: ' + JSON.stringify(read.mutations));
  const after = applyMutations(st, read.mutations).state;
  eq(here(after), 'Azrael, Old Hesk, Roska', 'the room as the page ends');
  /* a spot the page does not hold is not written */
  const { read: invented } = await readWith(st, page, { mutations: [{ type: 'mode.snapshot', flags: [] }], here: ['Azrael', 'Roska'], spot: 'the Gilded Eel' });
  assert(!invented.mutations.some((m) => m.type === 'place.set'), 'a place the page never names is not taken for the ground');
});

test('M679-5 THE SPOT IS HELD TO THE PAGE, AND NOTHING ELSE CHANGES: the reader naming the city again writes nothing; a train to another city altogether stands (M627); a whose-it-is that names nobody the story knows is not written', async () => {
  const st = applyMutations({ ...emptyState(), page: 3 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Jovan’s apartment, New York City' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'thing.set', name: 'the case of cash', where: 'under his bed', owner: 'Jovan' },
  ]).state;
  const tokyo = '[Tokyo — Monday, March 3, 2025 | 09:00 | clear | coat | on the platform]\n\nThe bullet train let Jovan off into Tokyo, the case of cash in his hand.';
  const { read } = await readWith(st, tokyo, { mutations: [{ type: 'place.set', name: 'Tokyo' }, { type: 'mode.snapshot', flags: [] }], here: ['Jovan'], things: [{ name: 'the case of cash', where: 'in his hand on the platform', owner: 'a man in a grey coat' }] });
  assert(read.mutations.some((m) => m.type === 'place.set' && m.name === 'Tokyo'), 'his own move to another city stands, as M627 keeps it');
  const cash = read.mutations.find((m) => m.type === 'thing.set' && m.name === 'the case of cash');
  assert(cash && cash.where === 'in his hand on the platform' && !cash.owner, 'the case moves with him; an owner nobody in the story is, is not written: ' + JSON.stringify(cash));
  const city = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'Ilvarren' }, { type: 'presence.enter', name: 'Azrael' }]).state;
  const { read: again } = await readWith(city, '[Ilvarren — Thornday, October 14, 1247 | 10:00 | grey]\n\nAzrael stood in the square.', { mutations: [{ type: 'place.set', name: 'Ilvarren' }, { type: 'mode.snapshot', flags: [] }], here: ['Azrael'], spot: '' });
  assert(!again.mutations.some((m) => m.type === 'place.set'), 'the city named again by the reader is the header’s to give, and writes nothing');
});

/* ---- his second report: the auditor's turn 21 (and Mirelia at turn 19) ---- */
const HALL = '[Kingsreach — Thornday, October 16, 1247 | 19:40 | cold, clear | wool doublet | at the small council room door with the page]\n\n'
  + 'At the hall’s threshold Jugram swept the cloak off his shoulders and folded it over his forearm. Corven stood beside him, lamp up, waiting. Down the great table’s lower end Ser Holvard had one boot on a bench and a horn in his fist, complaining to anyone who would listen.\n\n'
  + 'A page came at a half-run and stopped short of them. “The king sups in the small council room tonight, m’lord. He asks for you before he sleeps.”\n\n'
  + '“I guess I should go, Captain Corven,” Jugram said, and asked the boy to walk him to the small council room.\n\n'
  + 'Corven let him go without another word about the cloak. The boy led Jugram down the side passage, past the kitchens’ heat, to the small council room’s door, where a grey steward took the cloak over his hand.';
/* the ledger as his page reader left it after turn 21 — read, and right: Azrael at the small council room door with the page,
 * Corven left at the hall, Ser Holvard where the world had him, the cloak over the steward's hand */
async function turnTwentyOne(storyId, { read = true } = {}) {
  let st = applyMutations({ ...emptyState(), page: 0, readTo: 0, sheet: { actors: {}, playerName: 'Azrael Jugram' } }, [
    { type: 'mc.set', name: 'Azrael Jugram' }, { type: 'place.set', name: 'Kingsreach, the king’s hall' },
    { type: 'presence.enter', name: 'Azrael Jugram', position: 'at the foot of the hall steps', attire: 'wool doublet, cloak over his shoulders' },
    { type: 'presence.enter', name: 'Corven', position: 'beside him, lamp up' },
    { type: 'offscreen.set', name: 'Ser Holvard', location: 'the lower end of the great table in the king’s hall', activity: 'drinking' },
    { type: 'offscreen.set', name: 'Mirelia', location: 'the colonnade, in the column’s shadow', activity: 'taking the air before hall' },
    { type: 'thing.set', name: 'the cloak', where: 'over Jugram’s shoulders', owner: 'Azrael Jugram' },
    { type: 'knowledge.add', name: 'Corven', fact: 'that the king sups in the small council room tonight, not the high table' },
  ]).state;
  /* page 1 (turn 21), as its own reader wrote it — or, when its readers never read it (their call failed), nothing */
  if (read) st = applyMutations({ ...st, page: 1 }, [
    { type: 'presence.update', name: 'Azrael Jugram', position: 'at the small council room door with the page' },
    { type: 'presence.enter', name: 'the page', position: 'at the door beside him' },
    { type: 'presence.leave', name: 'Corven', to: 'the hall’s threshold', shown: 'Corven let him go without another word about the cloak' },
    { type: 'thing.set', name: 'the cloak', where: 'over the grey steward’s hand at the small council room threshold' },
  ]).state;
  await saveState(storyId, { ...st, page: 1, readTo: read ? 1 : 0 });
  await db.messages.append(storyId, { role: 'user', text: 'We walk up from the colonnade.' });
  await db.messages.append(storyId, { role: 'assistant', text: '[Kingsreach — Thornday, October 16, 1247 | 19:20 | cold | wool doublet | at the foot of the hall steps]\n\nThey came up from the colonnade, Corven at his side.' });
  await db.messages.append(storyId, { role: 'user', text: 'I go in.' });
  await db.messages.append(storyId, { role: 'assistant', text: HALL });
}
/* what his auditor answered at turn 21 — the page's START taken for the present */
const AUDIT_21 = { issues: [
  { what: 'the ledger’s presence has Azrael at the small council room door with the page, but the latest page shows him at the hall’s threshold beside Corven, cloak off over his forearm', fix: 'Azrael is at the hall’s threshold beside Corven, cloak off over his forearm', pages: false, mutations: [{ type: 'presence.update', name: 'Azrael', position: 'at the hall’s threshold beside Corven, cloak off over his forearm' }] },
  { what: 'the ledger’s Here now does not list Corven, but the latest page shows him at the hall’s threshold beside Jugram', fix: 'Corven is in the scene', pages: false, mutations: [{ type: 'presence.enter', name: 'Corven', shown: 'Corven stood beside him, lamp up, waiting' }] },
  { what: 'the ledger’s Here now does not list Ser Holvard, but the latest page shows him down the great table’s lower end', fix: 'Ser Holvard is in the scene', pages: false, mutations: [{ type: 'offscreen.clear', name: 'Ser Holvard' }] },
  { what: 'the ledger’s Things list has the cloak over the grey steward’s hand, but the latest page shows Jugram folding it over his forearm at the hall’s threshold', fix: 'the cloak is over Jugram’s forearm', pages: false, mutations: [{ type: 'thing.set', name: 'the cloak', where: 'over Jugram’s forearm at the hall’s threshold' }] },
  { what: 'Corven has no line for Jugram’s leave-taking', fix: 'Corven knows it', pages: false, mutations: [{ type: 'knowledge.add', name: 'Corven', fact: 'that Jugram took his leave with “I guess I should go, Captain Corven” and went with the boy to the small council room' }] },
  { what: 'the ledger lacks Mirelia, who the pages show in the colonnade', fix: 'Mirelia is here', pages: false, mutations: [{ type: 'presence.enter', name: 'Mirelia' }] },
  { what: 'the ledger’s knowledge for Corven does not include that the king sups in the small council room tonight', fix: 'Corven knows it', pages: false, mutations: [{ type: 'knowledge.add', name: 'Corven', fact: 'that the king sups in the small council room tonight, not the high table' }] },
] };
/* a house that answers the auditor with his turn-21 reading (streamed or not, as it is asked) and anything else with nothing */
const auditorHouse = (answer) => {
  const calls = [];
  const say = (text, stream) => {
    if (stream) {
      const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n' + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n' + 'data: [DONE]\n\n';
      const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } });
      return { ok: true, status: 200, headers: new Headers(), body, async json() { return {}; }, async text() { return lines; }, clone() { return this; } };
    }
    const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
  };
  return { calls, fetch: async (url, opts) => { const body = JSON.parse(opts.body); calls.push(body); const sys = String((body.messages || [])[0] && body.messages[0].content || ''); return say(/auditor of the ledger/i.test(sys) ? JSON.stringify(answer) : '{"standings":[]}', body.stream); } };
};

test('M679-6 HIS TURN 21, AUDITED: the page reader had the room as the page ENDS (Azrael at the small council room door with the page; Corven left at the hall; the cloak over the steward’s hand) — the auditor’s reading from the page’s START changes none of it: no one walked back in (Corven, Ser Holvard, Mirelia), his place not put back, the cloak not moved back; what lasts (a line of who knows what) still lands', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const storyId = 'm679-turn21';
  await turnTwentyOne(storyId);
  const house = auditorHouse(AUDIT_21);
  const r = await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId, stale: () => false }));
  assert(r && r.note === 'ok', 'the auditor read: ' + JSON.stringify(r && r.note));
  const after = await loadState(storyId);
  const az = after.present.find((p) => /Azrael/.test(p.name));
  eq(az && az.position, 'at the small council room door with the page', 'his place is where the page ENDS, as the reader wrote it');
  eq(after.present.map((p) => p.name).sort().join(', '), 'Azrael Jugram, the page', 'nobody walked back in — not Corven, not Ser Holvard, not Mirelia');
  assert(Object.keys(after.offscreen || {}).includes('Corven') && Object.keys(after.offscreen || {}).includes('Ser Holvard') && Object.keys(after.offscreen || {}).includes('Mirelia'), 'they keep where the reader and the world put them');
  eq(after.things['the cloak'].where, 'over the grey steward’s hand at the small council room threshold', 'the cloak stays where the page ends');
  assert((after.knowledge.Corven || []).some((k) => /I guess I should go/.test(k.fact)), 'what lasts still lands from the auditor: Corven’s line');
  const { auditRunWords } = await import('../../js/agents/auditor.js');
  eq((after.knowledge.Corven || []).filter((k) => /king sups/.test(k.fact)).length, 1, 'the line Corven already held is held once');
  assert(!/refused|did not hold/.test(auditRunWords(r)), 'a line Corven already holds is no refusal in the workers line: ' + auditRunWords(r));
  /* the auditor's doors on a page its readers never read (their call failed): it is the only one to set the room, and does
   * — from the page's ending: the boy who leads him comes in, the cloak goes over the steward's hand; Ser Holvard, shown
   * only at the page's start, stays seated where the world has him */
  const unread = 'm679-turn21-unread';
  await turnTwentyOne(unread, { read: false });
  const before = await loadState(unread);
  assert(!(before.journal || []).some((j) => j.p === 1), 'nothing was written on the unread page');
  const r2 = await withHouse(auditorHouse({ issues: [
    { what: 'the boy who leads him is not in the scene', fix: 'he is', pages: false, mutations: [{ type: 'presence.enter', name: 'the page', shown: 'The boy led Jugram down the side passage' }] },
    AUDIT_21.issues[2],
    { what: 'the cloak is still over his shoulders in the ledger', fix: 'the steward has it', pages: false, mutations: [{ type: 'thing.set', name: 'the cloak', where: 'over the grey steward’s hand at the small council room’s door' }] },
  ] }), () => auditLedger({ connection: HOUSES[0].conn, storyId: unread, stale: () => false }));
  assert(r2 && r2.note === 'ok', 'the auditor read the unread page');
  const after2 = await loadState(unread);
  assert(after2.present.some((p) => p.name === 'the page'), 'the boy the ending shows comes in: ' + after2.present.map((p) => p.name).join(', '));
  assert(!after2.present.some((p) => p.name === 'Ser Holvard') && Object.keys(after2.offscreen || {}).includes('Ser Holvard'), 'Ser Holvard, shown only at the page’s start, keeps his seat');
  eq(after2.things['the cloak'].where, 'over the grey steward’s hand at the small council room’s door', 'the cloak goes where the ending puts it');
});

test('M679-7 HIS TURN 19: the header gives his dress on every page; a reader that moved only his place no longer stands it aside — "bared to the waist" from the courtyard is not kept once a page dresses him', async () => {
  const st = applyMutations({ ...emptyState(), page: 18 }, [
    { type: 'mc.set', name: 'Azrael Jugram' }, { type: 'place.set', name: 'Kingsreach, the colonnade' },
    { type: 'presence.enter', name: 'Azrael Jugram', position: 'against the courtyard wall', attire: 'cloak and wool dropped where he stood, bared to the waist and below' },
    { type: 'presence.enter', name: 'Corven', position: 'at the colonnade’s end, lamp up' },
  ]).state;
  const page = '[Kingsreach — Thornday, October 16, 1247 | 19:10 | cold | wool on, cloak turned and settled, hood down | at the foot of the hall steps at Corven’s side]\n\n'
    + 'He had the wool on again and the cloak turned and settled, hood down, by the time Corven’s lamp found them. They walked to the foot of the hall steps, Corven at his side.';
  const { read } = await readWith(st, page, { mutations: [{ type: 'presence.update', name: 'Azrael Jugram', position: 'at the foot of the hall steps at Corven’s side' }, { type: 'mode.snapshot', flags: [] }], here: ['Azrael Jugram', 'Corven'] });
  const after = applyMutations(st, read.mutations).state;
  const az = after.present.find((p) => /Azrael/.test(p.name));
  eq(az.position, 'at the foot of the hall steps at Corven’s side', 'the reader’s own place for him');
  eq(az.attire, 'wool on, cloak turned and settled, hood down', 'and his header’s dress, which the page bears out');
});

/* his turn 19's loose ends: closed by the auditor as "answered by the pages" — the page that said them */
const UNNAMED = 'He unpicked the inside-out fold of Jugram’s cloak and said only that it should be squared before the king’s hall — the wrong-turned cloak and what it means remain unnamed between them.';
const NOON = 'She wants to know where Jugram went at noon, and has not asked him yet';
const STEPS = '[Kingsreach — Thornday, October 16, 1247 | 19:10 | cold | wool on, cloak turned and settled, hood down | at the foot of the hall steps at Corven’s side]\n\n'
  + '“Where were you at noon?” Mirelia asked him at the last column. “The docks,” he told her, and she let it be.\n\n'
  + 'At the foot of the hall steps Corven reached over and unpicked the inside-out fold of the cloak. “Square that before the king’s hall,” he said, and nothing else.';
test('M679-8 HIS TURN 19’S LOOSE ENDS: one answers a loose end only by what comes after it — the scribe, the page reader and the auditor are told so in the same words; a loose end written from the newest page (Corven’s: “what it means remains unnamed between them”) is not closed on that same page’s word; one an earlier page wrote and this page answers (Mirelia’s question, answered) is still the auditor’s to close', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { buildScribeMessages } = await import('../../js/agents/scribe.js');
  const { LOOSE_ANSWERED_MEANS } = await import('../../js/agents/herewords.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const storyId = 'm679-turn19-loose';
  let st = applyMutations({ ...emptyState(), page: 0, sheet: { actors: {}, playerName: 'Azrael Jugram' } }, [
    { type: 'mc.set', name: 'Azrael Jugram' }, { type: 'place.set', name: 'Kingsreach, the colonnade' },
    { type: 'presence.enter', name: 'Azrael Jugram' }, { type: 'presence.enter', name: 'Corven' }, { type: 'presence.enter', name: 'Mirelia' },
    { type: 'people.set', name: 'Mirelia', field: 'core', text: 'the queen, cool in public' },
    { type: 'people.note', name: 'Mirelia', field: 'thread', text: NOON },
  ]).state;
  /* the newest page's scribe wrote Corven's */
  st = applyMutations({ ...st, page: 1 }, [
    { type: 'people.set', name: 'Corven', field: 'core', text: 'captain of the king’s guard, a lamp and few words' },
    { type: 'people.note', name: 'Corven', field: 'thread', text: UNNAMED },
  ]).state;
  await saveState(storyId, { ...st, readTo: 1 });
  await db.messages.append(storyId, { role: 'user', text: 'We wait in the colonnade.' });
  await db.messages.append(storyId, { role: 'assistant', text: '[Kingsreach — Thornday, October 16, 1247 | 18:50 | cold | wool on | the colonnade]\n\nThe colonnade was cold.' });
  await db.messages.append(storyId, { role: 'user', text: 'We walk to the hall.' });
  await db.messages.append(storyId, { role: 'assistant', text: STEPS });
  const house = auditorHouse({ issues: [
    { what: 'Corven’s loose end is answered — the pages show he unpicked the fold and said it should be squared', fix: 'close it', pages: false, mutations: [{ type: 'people.note', name: 'Corven', field: 'unthread', text: UNNAMED }] },
    { what: 'Mirelia’s loose end is answered — she asked and he said the docks', fix: 'close it', pages: false, mutations: [{ type: 'people.note', name: 'Mirelia', field: 'unthread', text: NOON }] },
  ] });
  const r = await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId, stale: () => false }));
  assert(r && r.note === 'ok', 'the auditor read');
  const asked = house.calls.find((c) => /auditor of the ledger/i.test(String(c.messages[0].content)));
  assert(asked && String(asked.messages[0].content).includes(LOOSE_ANSWERED_MEANS), 'the auditor is told what answers a loose end');
  const after = await loadState(storyId);
  assert(after.characters.Corven.threads.some((t) => /remain unnamed/.test(t)), 'Corven’s, written from this very page, stays open: ' + JSON.stringify(after.characters.Corven.threads));
  assert(!after.characters.Mirelia.threads.some((t) => /noon/.test(t)), 'Mirelia’s, which this page answered, is closed');
  assert(r.issues.some((i) => /Corven’s loose end/.test(i.what) && !i.landed && i.refused.length), 'the rejected close remains visible for a corrected reading');
  const scribe = buildScribeMessages({ state: after, userText: 'x', assistantText: STEPS });
  assert(String(scribe.system || '').includes(LOOSE_ANSWERED_MEANS) || String(scribe.user || '').includes(LOOSE_ANSWERED_MEANS), 'the scribe is told the same');
});

test('M679-9 THE HOUSE’S OWN HEAL OF WHO IS HERE READS THE PAGE’S ENDING TOO, AND NEVER UNDOES ITS READER: his turn 21 — the reader took Corven out (no “to”: it was he who walked away), the house noted him last seen at the hall, and the heal, finding him named on that page and not going, wrote him straight back in; now nobody this very page took out is written back in, nobody against the room its reader named, nobody only its start shows, and nobody when it ends on HIM walking off — and someone the ending shows coming in, with no room named, still is', async () => {
  const { hereByTheNewestPage } = await import('../../js/engine/apply.js');
  let st = applyMutations({ ...emptyState(), page: 0, sheet: { actors: {}, playerName: 'Azrael Jugram' } }, [
    { type: 'mc.set', name: 'Azrael Jugram' }, { type: 'place.set', name: 'Kingsreach, the king’s hall' },
    { type: 'presence.enter', name: 'Azrael Jugram' }, { type: 'presence.enter', name: 'Corven', position: 'beside him, lamp up' },
  ]).state;
  st = applyMutations({ ...st, page: 1 }, [{ type: 'presence.leave', name: 'Corven', shown: 'Corven let him go without another word about the cloak' }]).state;
  assert(st.offscreen.Corven && st.offscreen.Corven.lastSeen, 'the house notes him last seen at the hall');
  const page21 = HALL.replace('[Kingsreach —', '[Kingsreach, the king’s hall —');
  eq(hereByTheNewestPage(st, page21, { pageAt: 1 }).length, 0, 'the page that took him out does not write him back in');
  /* a page later, in the small council room */
  const later = (text) => '[Kingsreach, the king’s hall — Thornday, October 16, 1247 | 19:50 | cold | wool doublet | the small council room]\n\n' + text;
  const thought = later('The king looked up from his cup and waved the steward out. Azrael bowed. Somewhere behind him in the great hall, Corven would be walking the lamp along the benches.');
  const came = later('The door opened behind them and Corven came in, lamp lowered, and took his place by the wall.');
  eq(hereByTheNewestPage({ ...st, roomAt: { page: 2, names: ['Azrael Jugram', 'the king'] } }, thought, { pageAt: 2 }).length, 0, 'not against the room its reader named');
  eq(hereByTheNewestPage(st, came, { pageAt: 2 }).map((m) => m.name).join(), 'Corven', 'with no room named, the ending that shows him coming in still writes him in (M452)');
  /* an older reader's bare leave on this very page (no words of the page for the going) is what M452 mends, and still is */
  const back = applyMutations({ ...st, page: 2 }, [{ type: 'presence.enter', name: 'Corven' }]).state;
  const stuck = applyMutations(back, [{ type: 'presence.leave', name: 'Corven' }]).state;
  const stillHere = later('Corven stood at his shoulder with the lamp, reading the patrol board over it.');
  eq(hereByTheNewestPage(stuck, stillHere, { pageAt: 2 }).map((m) => m.name).join(), 'Corven', 'a bare leave of an older reader, on the newest page itself, is mended (M452)');
  const startOnly = later('Corven came to the door, lamp up, and said the king would wait.\n\nThe king did not wait. He talked of the princess and the duke’s banquet for an hour, of roads and of escorts, and of the queen’s word before it; Azrael listened, and the fire burned down, and the steward came twice with wine and twice was waved away again until the cups stood empty and the candles ran low in their sconces. When at last he rose, the king rose with him, and walked him to the inner door himself, a hand on his shoulder, saying nothing more of princesses.');
  eq(hereByTheNewestPage(st, startOnly, { pageAt: 2 }).length, 0, 'not someone only the page’s start shows');
  const walksOff = later('Corven stood by the wall with his lamp. Azrael turned and walked away down the passage.');
  eq(hereByTheNewestPage(st, walksOff, { pageAt: 2 }).length, 0, 'not when the page ends on him walking off');
});

test('M679-10 A SEAT LET GO IS A WALK-IN TOO, AND THE ROOM THE READER NAMES IS ITS LAST WORD: a reader that names the room as the page ends without Ser Holvard and still writes his seat away (offscreen.clear — “in the scene now”) does not walk him in; he keeps his seat', async () => {
  const st = applyMutations({ ...emptyState(), page: 1, sheet: { actors: {}, playerName: 'Azrael Jugram' } }, [
    { type: 'mc.set', name: 'Azrael Jugram' }, { type: 'place.set', name: 'Kingsreach, the king’s hall' },
    { type: 'presence.enter', name: 'Azrael Jugram' },
    { type: 'offscreen.set', name: 'Ser Holvard', location: 'the lower end of the great table in the king’s hall', activity: 'drinking' },
  ]).state;
  const page = HALL.replace('[Kingsreach —', '[Kingsreach, the king’s hall —');
  const { read } = await readWith(st, page, { mutations: [{ type: 'offscreen.clear', name: 'Ser Holvard' }, { type: 'mode.snapshot', flags: [] }], here: ['Azrael Jugram', 'the page'] });
  assert(!read.mutations.some((m) => m && m.name === 'Ser Holvard' && (m.type === 'presence.enter' || m.type === 'offscreen.clear')), 'nothing walks him in or lets his seat go: ' + JSON.stringify(read.mutations));
  const { read: named } = await readWith(st, page, { mutations: [{ type: 'offscreen.clear', name: 'Ser Holvard' }, { type: 'mode.snapshot', flags: [] }], here: ['Azrael Jugram', 'Ser Holvard'] });
  assert(named.mutations.some((m) => m && m.name === 'Ser Holvard' && m.type === 'presence.enter'), 'in the room it names, he walks in as before (M444)');
});


test('M679-11 HIS TURN 19’S MIRELIA: the page ends with her staying in the column’s shadow while he and Corven cross to the hall steps — named in its ending, and left there. The reader named the room as the page ends (him and Corven); the auditor’s walk-in of her, seated in the colonnade, does not stand against it — and when the room the reader named has her in it, it does', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const PAGE19 = '[Kingsreach, the king’s palace — Thornday, October 16, 1247 | 19:10 | cold | wool on, cloak turned and settled, hood down | at the foot of the hall steps at Corven’s side]\n\n'
    + 'He had the wool on again and the cloak turned and settled, hood down, by the time Corven’s lamp found them.\n\n'
    + 'Mirelia stayed where she was in the column’s shadow, and Corven said nothing more to her. Azrael and Corven crossed to the foot of the hall steps.';
  const seed = async (storyId, names, page = PAGE19) => {
    const st = applyMutations({ ...emptyState(), page: 0, sheet: { actors: {}, playerName: 'Azrael Jugram' } }, [
      { type: 'mc.set', name: 'Azrael Jugram' }, { type: 'place.set', name: 'Kingsreach, the king’s palace' },
      { type: 'presence.enter', name: 'Azrael Jugram' }, { type: 'presence.enter', name: 'Corven', position: 'lamp up' },
      { type: 'offscreen.set', name: 'Mirelia', location: 'the colonnade, in the column’s shadow', activity: 'taking the air before hall' },
    ]).state;
    await saveState(storyId, { ...st, page: 1, readTo: 1, roomAt: { page: 1, names } });
    await db.messages.append(storyId, { role: 'user', text: 'We go.' });
    await db.messages.append(storyId, { role: 'assistant', text: '[Kingsreach, the king’s palace — Thornday, October 16, 1247 | 19:00 | cold | wool | the colonnade]\n\nThe colonnade was cold.' });
    await db.messages.append(storyId, { role: 'user', text: 'We walk on.' });
    await db.messages.append(storyId, { role: 'assistant', text: page });
  };
  const WALK_IN = { issues: [
    { what: 'the ledger’s presence lists only Azrael and Corven, but the latest page shows Mirelia still in the scene', fix: 'Mirelia is present', pages: false, mutations: [{ type: 'presence.enter', name: 'Mirelia', position: 'in the colonnade shadow by the last column', shown: 'Mirelia stayed where she was in the column’s shadow' }] },
    { what: 'Mirelia’s elsewhere note is stale', fix: 'let it go', pages: false, mutations: [{ type: 'offscreen.clear', name: 'Mirelia' }] },
  ] };
  await seed('m679-turn19-room', ['Azrael Jugram', 'Corven']);
  await withHouse(auditorHouse(WALK_IN), () => auditLedger({ connection: HOUSES[0].conn, storyId: 'm679-turn19-room', stale: () => false }));
  let after = await loadState('m679-turn19-room');
  assert(!after.present.some((p) => p.name === 'Mirelia') && Object.keys(after.offscreen || {}).includes('Mirelia'), 'she keeps her seat in the colonnade: ' + after.present.map((p) => p.name).join(', '));
  /* the page where she comes with them, and the room its reader named has her: the auditor's walk-in stands */
  const ALONG = PAGE19.replace('Mirelia stayed where she was in the column’s shadow, and Corven said nothing more to her. Azrael and Corven crossed to the foot of the hall steps.', 'They came to the foot of the hall steps, Corven at his side, and Mirelia came with them out of the column’s shadow, her hand on Corven’s arm.');
  assert(ALONG !== PAGE19, 'the page where she comes along');
  await seed('m679-turn19-with-her', ['Azrael Jugram', 'Corven', 'Mirelia'], ALONG);
  await withHouse(auditorHouse({ issues: [{ ...WALK_IN.issues[0], mutations: [{ type: 'presence.enter', name: 'Mirelia', shown: 'Mirelia came with them out of the column’s shadow' }] }] }), () => auditLedger({ connection: HOUSES[0].conn, storyId: 'm679-turn19-with-her', stale: () => false }));
  after = await loadState('m679-turn19-with-her');
  assert(after.present.some((p) => p.name === 'Mirelia'), 'in a room that has her, the auditor brings her in');
});

test('M679-12 AN OLDER READER’S BARE LEAVE IS NOT THE PAGE’S WORD: the auditor’s walk-in is held back only by a leave this page’s reader held to the page by its own words for the going — an older reader’s leave with none (M452’s stuck Rukia, here Corven at his shoulder with the lamp) is still the auditor’s to set right when the ending shows him there', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const storyId = 'm679-bare-leave';
  let st = applyMutations({ ...emptyState(), page: 0, sheet: { actors: {}, playerName: 'Azrael Jugram' } }, [
    { type: 'mc.set', name: 'Azrael Jugram' }, { type: 'place.set', name: 'Kingsreach, the guardroom' },
    { type: 'presence.enter', name: 'Azrael Jugram' }, { type: 'presence.enter', name: 'Corven' },
  ]).state;
  st = applyMutations({ ...st, page: 1 }, [{ type: 'presence.leave', name: 'Corven' }]).state; /* the old reader's, no words for it */
  await saveState(storyId, { ...st, readTo: 1 });
  await db.messages.append(storyId, { role: 'user', text: 'I wait.' });
  await db.messages.append(storyId, { role: 'assistant', text: '[Kingsreach, the guardroom — Thornday, October 16, 1247 | 18:00 | cold | wool | by the patrol board]\n\nThe guardroom was quiet.' });
  await db.messages.append(storyId, { role: 'user', text: 'I read the board.' });
  await db.messages.append(storyId, { role: 'assistant', text: '[Kingsreach, the guardroom — Thornday, October 16, 1247 | 18:10 | cold | wool | by the patrol board]\n\nAzrael read the names twice. Corven stood at his shoulder with the lamp, reading the patrol board over it.' });
  await withHouse(auditorHouse({ issues: [{ what: 'Corven is at his shoulder and not in the scene', fix: 'he is here', pages: false, mutations: [{ type: 'presence.enter', name: 'Corven', shown: 'Corven stood at his shoulder with the lamp' }] }] }), () => auditLedger({ connection: HOUSES[0].conn, storyId, stale: () => false }));
  const after = await loadState(storyId);
  assert(after.present.some((p) => p.name === 'Corven'), 'he is set right: ' + after.present.map((p) => p.name).join(', '));
});
