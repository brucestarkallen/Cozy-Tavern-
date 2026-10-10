/* Cozy Tavern — harness laws of M681 (his order: "Then M681 (the clock first) and every open finding in HANDOFF.md, most
 * harmful first. Reproduce each one before fixing it."). Every law below was made to happen on m680-001 with the house's
 * own code and the shapes it really writes, and asserts on what comes back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, headerMutations, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { db } from '../../js/store.js';

const page = (h) => '[' + h + ']\n\nThey talked a while.';
/* a page's header, read as the chain reads it (with the ground and the day the ledger keeps) */
const read = (st, h) => applyMutations(st, headerMutations(page(h), { ground: (st.place || {}).name || '', day: (st.clock && st.clock.dayWords) || '' })).state;
const moved = (a, b) => { const s0 = read({ ...emptyState() }, a); const s1 = read(s0, b); return s1.clock.minutes - s0.clock.minutes; };

test('M681-1 THE DAYS BETWEEN TWO HEADERS (the scene audit’s S1): two ways of writing the same day were a day apart or a week — “Thornday, October 14, 1247” then “Thornday, Oct 14” moved the clock a day and fifteen minutes, “Monday” then “Monday evening” a week; each such jump let every place and outfit in the room go and told the world agent a day had passed', () => {
  const T = 'Ilvarren — Thornday, October 14, 1247 | 15:58';
  for (const [b, want] of [['Ilvarren — Thornday, Oct 14 | 16:13', 15], ['Ilvarren — 14 October | 16:13', 15], ['Ilvarren — Thornday the 14th | 16:13', 15], ['Ilvarren — the 14th of October | 16:13', 15], ['Ilvarren | 16:13', 15],
    ['Ilvarren — Thornday, October 15, 1247 | 15:58', 1440], ['Ilvarren — Oct 15 | 08:00', 1440 - 478], ['Ilvarren — Oct 13 | 15:58', -1440]]) eq(moved(T, b), want, T + ' → ' + b);
  eq(moved('the yard — Monday | 09:00', 'the yard — Monday evening | 18:00'), 540, 'Monday, then Monday evening: the same day');
  eq(moved('the yard — Monday morning | 09:00', 'the yard — Monday | 10:00'), 60, 'Monday morning, then Monday');
  eq(moved('the yard — Monday | 09:00', 'the yard — Wednesday | 09:00'), 2880, 'Monday to Wednesday is two days');
  eq(moved('the yard — Saturday | 22:00', 'the yard — Monday | 08:00'), 2040, 'Saturday night to Monday morning, over the week’s end');
  eq(moved('Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:20', 'Tenth Division Courtyard — Sunday | 09:40'), 20, 'his own calendar, then the weekday alone: the same day');
  eq(moved('Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:20', 'Tenth Division Courtyard — Monday, Hanami 6, 1001 AG | 09:20'), 1440, 'Hanami 5 to Hanami 6');
  eq(moved('the yard — Thornday, October 31, 1247 | 22:00', 'the yard — Nov 1 | 08:00'), 600, 'over a month’s end');
  eq(moved('the yard — Day 47, Year 3 of the Long Winter | 09:00', 'the yard — Day 50, Year 3 of the Long Winter | 09:00'), 4320, 'a story that counts its days');
  eq(moved('the yard — Tirdas, 17th of Last Seed, 4E 201 | 09:00', 'the yard — Fredas, 20th of Last Seed, 4E 201 | 09:00'), 4320, 'a month of the story’s own after an ordinal');
});

test('M681-2 A DAY OF THE STORY’S OWN WEEK IS A DAY, AND THE SAME DAY SAID LESS FULLY KEEPS ITS FULLER WORDS: “[the yard — Thornday | 09:00]” kept no day (the clock spoke the real calendar’s “Saturday, January 1, 2000”) and “[Thornday evening | 18:00]” set the ground to “Thornday evening”; “Thornday the 14th” after “Thornday, October 14, 1247” replaced the day words, and the next request lost the month and the year', () => {
  const first = read({ ...emptyState() }, 'the yard — Thornday | 09:00');
  eq(first.clock.label, 'Thornday — 09:00', 'the story’s own weekday is the day');
  eq(first.place.name, 'the yard', 'and the ground is the yard');
  eq(read(first, 'the yard — Fireday | 09:00').clock.minutes - first.clock.minutes, 1440, 'another day of the story’s week is the next day');
  const evening = read(first, 'Thornday evening | 18:00');
  eq(evening.place.name, 'the yard', '“Thornday evening” is no ground');
  eq(evening.clock.minutes - first.clock.minutes, 540, 'it is the same day’s evening');
  const full = read({ ...emptyState() }, 'Ilvarren — Thornday, October 14, 1247 | 15:58');
  for (const h of ['Ilvarren — Thornday the 14th | 16:13', 'Ilvarren — Oct 14 | 16:13', 'Ilvarren — Thornday evening | 18:00']) eq(read(full, h).clock.dayWords, 'Thornday, October 14, 1247', h + ': the fuller words stay');
  eq(read(read({ ...emptyState() }, 'the yard — Monday evening | 20:00'), 'the yard — Monday | 21:00').clock.label, 'Monday — 21:00', 'a time of day kept from before goes — the hour says it');
  for (const place of ['Holiday Inn', 'the Birthday Hall']) eq(read({ ...emptyState() }, place + ' | 09:00').place.name, place, place + ' is still a place');
});

test('M681-3 A “#TIME SKIP” ANSWERED WITH ONLY THE HOUR (the scene audit’s S10): the header’s hour overruled the reader’s own three-day move and an hour far earlier with no day words is the next morning — Monday night became Tuesday morning. The move stands and the hour lands on the day nearest to it; a short move under a header hour, or any header that names the day, is overruled as before', async () => {
  const { readerTimeOverHeader, staleAfterJump } = await import('../../js/engine/apply.js');
  const night = applyMutations(read({ ...emptyState() }, 'Ilvarren — Monday | 21:00'), [{ type: 'presence.enter', name: 'Jovan', position: 'by the hearth', attire: 'a nightshirt' }]).state;
  const land = (st, header, reader) => {
    const h = headerMutations(page(header), { ground: st.place.name, day: st.clock.dayWords || '' });
    const timed = readerTimeOverHeader(h, reader);
    return applyMutations(st, [...timed.header, ...staleAfterJump(st, timed.header), ...timed.reader]).state;
  };
  const skip = land(night, 'Ilvarren | 09:00', [{ type: 'clock.advance', minutes: 4320, reason: 'three days pass' }]);
  eq(skip.clock.minutes - night.clock.minutes, 3600, 'three days on from Monday night, in the morning: Thursday 09:00');
  eq(skip.present[0].position || '', '', 'and after days, nobody stands where the night left them');
  eq(land(night, 'Ilvarren | 21:40', [{ type: 'clock.advance', minutes: 30, reason: 'a talk' }]).clock.minutes - night.clock.minutes, 40, 'a short move under the header’s hour: the header’s hour, as before (M455)');
  eq(land(night, 'Ilvarren — Wednesday | 09:00', [{ type: 'clock.advance', minutes: 4320 }]).clock.minutes - night.clock.minutes, 2160, 'a header that names the day: the day it names, as before');
  eq(land(night, 'Ilvarren | 09:00', []).clock.minutes - night.clock.minutes, 720, 'no move at all: the next morning, as before');
});

test('M681-4 HIS HAND ON THE CLOCK OUTRANKS AN OLDER PAGE’S HOUR (the scene audit’s S6): the clock he set by hand is journaled as his; an older page’s hour does not write over it, a newer page’s does', async () => {
  const { handSetClockSince } = await import('../../js/engine/apply.js');
  let st = read({ ...emptyState(), page: 4 }, 'the yard — Monday | 09:00');
  eq(handSetClockSince(st, 4), false, 'a header set it: not his');
  st = applyMutations({ ...st, page: 4 }, [{ type: 'clock.set', hour: 14, minute: 0, byHand: true }]).state;
  eq(handSetClockSince(st, 4), true, 'set by hand at page 4: page 4’s hour does not write over it');
  eq(handSetClockSince(st, 2), true, 'nor an older page’s');
  eq(handSetClockSince(st, 5), false, 'a newer page’s does');
  st = applyMutations({ ...st, page: 5 }, [{ type: 'clock.set', hour: 15, minute: 0 }]).state;
  eq(handSetClockSince(st, 5), false, 'a page’s own hour after his hand: the page’s, as ever');
});

/* ---- the findings after the clock, each made to happen on m680-001 first ---- */
const here = (st, ...people) => applyMutations(st, people.map((name) => ({ type: 'presence.enter', name }))).state;

test('M681-5 WHO GOES IS WHO THE SENTENCE SENDS (HANDOFF: "Rukia watched Renji leave." made goneAtTheEnd(Rukia) true): a going in a sentence that names someone else is theirs only when the going is said of them', async () => {
  const { goneAtTheEnd } = await import('../../js/engine/apply.js');
  const st = here({ ...emptyState() }, 'Rukia', 'Renji');
  eq(goneAtTheEnd(st, 'They talked a while.\n\nRukia watched Renji leave.', 'Rukia'), false, 'the watcher stays');
  eq(goneAtTheEnd(st, 'They talked a while.\n\nRukia watched Renji leave.', 'Renji'), true, 'the one who leaves is gone');
  eq(goneAtTheEnd(st, 'They talked a while.\n\nRenji left. Rukia watched him go.', 'Rukia'), false, 'the watcher of “him go” stays');
  eq(goneAtTheEnd(st, 'They talked a while.\n\nRukia left without a word to Renji.', 'Rukia'), true, 'her own going, with his name in the sentence, is hers');
});

test('M681-6 A MOOD IN ANOTHER SPELLING IS THAT MOOD (S4): a board of ["Combat"] turned combat OFF; "social field" was no mood', () => {
  let st = applyMutations({ ...emptyState() }, [{ type: 'mode.set', flag: 'combat' }]).state;
  eq(applyMutations(st, [{ type: 'mode.snapshot', flags: ['Combat'] }]).state.mode.combat, true, '“Combat” keeps combat on');
  eq(applyMutations(st, [{ type: 'mode.snapshot', flags: 'Combat, Social Field' }]).state.mode.socialField, true, '“Social Field” is the social field');
  eq(applyMutations({ ...emptyState() }, [{ type: 'mode.set', flag: 'social_field' }]).state.mode.socialField, true, 'mode.set “social_field”');
});

test('M681-7 THE BACK OF HIS HAND IS HIS HAND (P1): “a bruise on the back of his hand” was a wound on his back, and folded one with the real gash there', async () => {
  const { bodyPartOf, addInjury } = await import('../../js/engine/bodies.js');
  eq(bodyPartOf('a bruise on the back of his hand'), 'hand');
  eq(bodyPartOf('a cut on the back of her left hand'), 'left hand');
  eq(bodyPartOf('a gash across his back'), 'back', 'his back is still his back');
  let b = addInjury({}, 'Kira', { what: 'a bruise on the back of his hand', sev: 1 }, 0, 1);
  b = addInjury(b, 'Kira', { what: 'a deep gash across his back', sev: 2 }, 0, 2);
  eq(b.Kira.injuries.length, 2, 'two wounds, never folded into one');
});

test('M681-8 A WOUND TOLD AGAIN KEEPS ITS DRESSING (P10): re-reported without “treated”, the bandaged cut bled untended in the ledger; worse than it was, it is open again', async () => {
  const { addInjury } = await import('../../js/engine/bodies.js');
  let b = addInjury({}, 'Rias', { what: 'a cut along her forearm', sev: 2, treated: true }, 0, 1);
  b = addInjury(b, 'Rias', { what: 'the cut along her forearm', sev: 2 }, 0, 3);
  eq(b.Rias.injuries.length, 1); eq(b.Rias.injuries[0].treated, true, 'still dressed');
  b = addInjury(b, 'Rias', { what: 'the cut along her forearm, torn open', sev: 3 }, 0, 4);
  eq(b.Rias.injuries[0].treated, false, 'worse: the dressing no longer holds it');
});

test('M681-9 A PASSING LOOK IS NOT A TRUTH (P2): “face: flushed” was locked among what is true of her', async () => {
  const st0 = here({ ...emptyState() }, 'Rias');
  let r = applyMutations(st0, [{ type: 'canon.lock', name: 'Rias', key: 'face', value: 'flushed' }]);
  eq(r.applied.length, 0, 'a flush is not locked');
  r = applyMutations(st0, [{ type: 'canon.lock', name: 'Rias', key: 'hair', value: 'copper red, flushed at the ears' }]);
  eq(r.state.canon[Object.keys(r.state.canon)[0]].facts[0].value, 'copper red', 'what lasts is locked, the passing part is not');
  eq(applyMutations(st0, [{ type: 'canon.lock', name: 'Rias', key: 'face', value: 'flushed', byHand: true }]).applied.length, 1, 'his own hand locks what he says');
  for (const v of ['dusty blond', 'messy black hair', 'glowing red eyes']) eq(applyMutations(st0, [{ type: 'canon.lock', name: 'Rias', key: 'hair', value: v }]).applied.length, 1, v + ' is a look that lasts');
});

test('M681-10 A NAME THAT MEANS TWO PEOPLE IS NOBODY’S TO MERGE (P4): a standing under a bare “Rias” was folded into Rias Wells’s while the ledger also kept Rias Gremory — and Rias Wells’s own beats landed in it', async () => {
  const { standingsHousekeeping } = await import('../../js/agents/auditor.js');
  let st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'people.set', name: 'Rias Wells', field: 'core', text: 'his sister' }, { type: 'people.set', name: 'Rias Gremory', field: 'core', text: 'a devil heiress' },
    { type: 'rel.shift', name: 'Rias', axis: 'p', delta: 5, cause: 'Rias laughed with Jovan' }, { type: 'rel.shift', name: 'Rias Wells', axis: 'p', delta: 10, cause: 'she hugged Jovan' }]).state;
  eq(Object.keys(st.relationships).sort().join(', '), 'Rias, Rias Wells', 'Rias Wells’s own beat is her own standing — never the bare “Rias” two people answer to');
  const out = standingsHousekeeping(st, '', '', 'Jovan', []);
  assert(!out.some((m) => m.type === 'rel.clear' && m.name === 'Rias'), 'the bare “Rias” is not folded into Rias Wells: ' + JSON.stringify(out));
  const out2 = standingsHousekeeping(st, '', '', 'Jovan', [{ name: 'Rias', p: 40, r: 0, s: 0 }]);
  assert(!out2.some((m) => m.type === 'rel.set'), 'the brief’s “Rias” lands on no one of two: ' + JSON.stringify(out2));
  /* a ledger written before, both standings in it: the housekeeping folded “Rias” into Rias Wells */
  const two = { ...st, relationships: { Rias: { p: 5, r: 0, s: 0, history: [{ cause: 'Rias laughed with Jovan', delta: 5, axis: 'p' }] }, 'Rias Wells': { p: 10, r: 0, s: 0, history: [{ cause: 'she hugged Jovan', delta: 10, axis: 'p' }] } } };
  eq(JSON.stringify(standingsHousekeeping(two, '', '', 'Jovan', [])), '[]', 'nothing merged');
});

test('M681-11 THE FOUNDER READ AGAIN NEVER WRITES OVER WHAT THE PAGES EARNED (P6’s same fault in the founder): every edit of the brief founded again and wrote the brief’s digits over the standing', async () => {
  const { foundWorld } = await import('../../js/agents/founder.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const storyId = 'm681-founder';
  await saveState(storyId, emptyState());
  await db.messages.append(storyId, { role: 'assistant', text: 'page' });
  const notes = 'Aurora — childhood best friend (P:65 R:30 S:5)';
  const house = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mc.set', name: 'Jovan' }] }) });
  await withHouse(house, () => foundWorld({ connection: HOUSES[0].conn, storyId, brief: 'Jovan comes home.', castNotes: notes, stale: () => false }));
  eq((await loadState(storyId)).relationships.Aurora.p, 65, 'founded');
  await saveState(storyId, applyMutations(await loadState(storyId), [{ type: 'rel.shift', name: 'Aurora', axis: 'p', delta: -20, cause: 'Jovan forgot her birthday' }]).state);
  await withHouse(house, () => foundWorld({ connection: HOUSES[0].conn, storyId, brief: 'Jovan comes home. (edited)', castNotes: notes, stale: () => false }));
  eq((await loadState(storyId)).relationships.Aurora.p, 45, 'the page’s beat stands');
});

test('M681-12 THE DEAD ARE NOT ASKED ABOUT THEIR WOUNDS (P5)', async () => {
  const { openWoundsBlock } = await import('../../js/agents/extractor.js');
  let st = here({ ...emptyState() }, 'Jovan');
  st = applyMutations(st, [{ type: 'offscreen.set', name: 'Old Hesk', location: 'dead — on the floor of the Bent Kettle taproom', activity: 'dead' }, { type: 'body.injure', name: 'Old Hesk', what: 'a crossbow bolt through the chest', sev: 4 }, { type: 'body.injure', name: 'Jovan', what: 'a cut on his arm', sev: 1 }]).state;
  assert(st.bodies && st.bodies['Old Hesk'] && st.bodies['Old Hesk'].injuries.length, 'the wound is on the books: ' + JSON.stringify(st.bodies));
  const block = openWoundsBlock(st, 'Jovan knelt by Old Hesk’s body.');
  assert(!/Hesk/.test(block), 'the dead are not asked about: ' + block);
  assert(/cut on his arm/.test(block), 'the living still are');
});

test('M681-13 A SHORT LOOSE END IN OTHER CASE OR MARKS IS THE SAME LOOSE END (P7)', async () => {
  const { sameLooseEnd } = await import('../../js/engine/people.js');
  eq(sameLooseEnd('Hunting Kim.', 'hunting Kim'), true);
  eq(sameLooseEnd('Find Al', 'find al!'), true);
  eq(sameLooseEnd('Pay the debt', 'Pay the debt to Kim'), false, 'more said is another loose end');
  let st = here({ ...emptyState() }, 'Roska');
  st = applyMutations(st, [{ type: 'people.note', name: 'Roska', field: 'thread', text: 'Hunting Kim.' }]).state;
  st = applyMutations(st, [{ type: 'people.note', name: 'Roska', field: 'unthread', text: 'hunting kim' }]).state;
  eq((st.characters.Roska.threads || []).length, 0, 'closed by its own words in other case');
});

test('M681-14 THE MAIN CHARACTER’S PAGE IS HIS RECORD ALONE (P12): a core written for him before the ledger knew him stood for good, and his own hand could not let it go', async () => {
  const { mcPageOnlyHis, mcSeatLetGo } = await import('../../js/engine/apply.js');
  let st = applyMutations({ ...emptyState() }, [{ type: 'people.set', name: 'Jovan Oda', field: 'core', text: 'a brooding swordsman' }]).state;
  const named = applyMutations(st, [{ type: 'mc.set', name: 'Jovan Oda' }]);
  eq(named.state.characters['Jovan Oda'].core || '', '', 'the core written before he was known goes');
  const { undoLast } = await import('../../js/engine/apply.js');
  eq(undoLast(named.state).state.characters['Jovan Oda'].core, 'a brooding swordsman', 'the take-back brings it back with the name');
  /* a ledger from before: the heal lets it go, and his hand can */
  const old = { ...st, sheet: { ...(st.sheet || {}), playerName: 'Jovan Oda' } };
  const heal = mcPageOnlyHis(old);
  eq(heal.length, 1, 'the heal finds it');
  eq(applyMutations(old, heal).state.characters['Jovan Oda'].core || '', '', 'and lets it go');
  eq(applyMutations(old, [{ type: 'people.set', name: 'Jovan Oda', field: 'core', text: '', clear: true, byHand: true }]).applied.length, 1, 'his hand can let it go');
  eq(applyMutations(old, [{ type: 'people.set', name: 'Jovan Oda', field: 'core', text: 'a hero' }]).applied.length, 0, 'nobody can write it');
});

test('M681-15 A THREAD IS NEVER CLOSED BY THE PAGE THAT OPENED IT (W6): the auditor, reading the same page, closed the reader’s new “Roska hunts the fence”', async () => {
  const { auditorScope } = await import('../../js/agents/auditor.js');
  let st = { ...here({ ...emptyState() }, 'Roska'), page: 3 };
  st = applyMutations(st, [{ type: 'thread.set', title: 'Roska hunts the fence', owner: 'Roska', heat: 'hot' }]).state;
  const issues = [{ what: 'the hunt is over', fixable: true, mutations: [{ type: 'thread.close', title: 'Roska hunts the fence', outcome: 'found him' }] }];
  eq(auditorScope(issues, st, { page: 'Roska set out after the fence.', pageAt: 3 }).length, 0, 'the same page: not closed');
  eq(auditorScope(issues, { ...st, page: 4 }, { page: 'Roska found the fence and broke his nose.', pageAt: 4 })[0].mutations.length, 1, 'a later page may close it');
});

test('M681-16 A FULL BOOK KEEPS ITS SECRETS (B9): past the guard the oldest fact went, a secret only she held among them', async () => {
  const { KNOWLEDGE_GUARD, sameFact } = await import('../../js/engine/world.js');
  const WORDS = ['bell', 'goat', 'lantern', 'barrel', 'harp', 'kite', 'anchor', 'saddle', 'mirror', 'ladder', 'falcon', 'kettle', 'candle', 'basket', 'hammer', 'violin', 'compass', 'banner', 'oyster', 'tulip', 'pepper', 'glove', 'ribbon', 'dagger', 'quill', 'spindle', 'pumpkin', 'walnut', 'trumpet', 'anvil', 'feather', 'wagon', 'bucket', 'crown', 'lute', 'mitten', 'needle', 'pebble', 'scarf', 'thimble', 'acorn', 'button', 'cobble', 'drum', 'easel', 'fiddle', 'gourd', 'helmet', 'inkwell', 'jug', 'kilt', 'ledger', 'mallet', 'napkin', 'oar', 'pail', 'quiver', 'rake', 'sickle', 'tankard', 'urn', 'vase', 'whistle', 'yoke', 'zither'];
  const FAIR = WORDS.map((w, i) => 'a ' + w + ' was sold at the fair stall ' + String.fromCharCode(65 + (i % 26)) + i);
  for (let i = 0; i < FAIR.length; i += 1) for (let j = i + 1; j < FAIR.length; j += 1) if (sameFact(FAIR[i], FAIR[j])) throw new Error('the test’s facts are not distinct: ' + FAIR[i] + ' / ' + FAIR[j]);
  let st = here({ ...emptyState() }, 'Rias', 'Kiba');
  st = applyMutations(st, [{ type: 'knowledge.add', name: 'Rias', fact: 'the duke poisoned her father' }]).state;
  for (let i = 0; i < KNOWLEDGE_GUARD + 2; i += 1) st = applyMutations({ ...st, page: 10 + i * 3 }, [{ type: 'knowledge.add', name: 'Rias', fact: FAIR[i] }, { type: 'knowledge.add', name: 'Kiba', fact: FAIR[i] }]).state;
  const facts = st.knowledge.Rias.map((k) => k.fact);
  assert(facts.includes('the duke poisoned her father'), 'the secret only she holds stays');
  eq(facts.length, KNOWLEDGE_GUARD, 'the book is held to its guard');
});

test('M681-17 A DEATH IS NEVER LET GO BUT BY HIS HAND (W13): a worker’s clear let go the one record that a man with no page of his own had died', () => {
  const st = applyMutations({ ...emptyState() }, [{ type: 'offscreen.set', name: 'the fence’s man', location: 'dead — in the alley behind the Kettle', activity: 'dead' }]).state;
  eq(applyMutations(st, [{ type: 'offscreen.clear', name: 'the fence’s man' }]).applied.length, 0, 'a worker’s clear is refused');
  eq(applyMutations(st, [{ type: 'offscreen.clear', name: 'the fence’s man', byHand: true }]).applied.length, 1, 'his hand lets it go');
});

test('M681-18 THE BOARD NEVER ENDS A LIVE FIGHT (S5): a page read in a breath between blows turned combat off under a running duel', () => {
  const st = { ...applyMutations({ ...emptyState() }, [{ type: 'mode.set', flag: 'combat' }]).state, duel: { active: true, over: false } };
  eq(applyMutations(st, [{ type: 'mode.snapshot', flags: ['travel'] }]).state.mode.combat, true, 'a running duel keeps combat on, whatever the board says');
  eq(applyMutations({ ...st, duel: { active: true, over: true } }, [{ type: 'mode.snapshot', flags: [] }]).state.mode.combat, false, 'a duel that is over: the board decides, as ever');
});

test('M681-19 ONE LOOK HAS ONE KEY (P3): “Hair” and “hair colour” stood as two truths of one woman, and the storyteller was told both', async () => {
  const st0 = here({ ...emptyState() }, 'Rias');
  let s = applyMutations(st0, [{ type: 'canon.lock', name: 'Rias', key: 'Hair', value: 'long and black' }]).state;
  s = applyMutations(s, [{ type: 'canon.lock', name: 'Rias', key: 'hair colour', value: 'brown' }]).state;
  const facts = s.canon[Object.keys(s.canon)[0]].facts;
  eq(facts.length, 1, 'one look'); eq(facts[0].value, 'brown', 'the newer word stands');
  /* a ledger written before: two keys for one look fold on load */
  await saveState('m681-looks', { ...emptyState(), canon: { Rias: { facts: [{ key: 'eye color', value: 'blue' }, { key: 'Eyes', value: 'grey' }, { key: 'hair style', value: 'a braid' }] } } });
  const back = (await loadState('m681-looks')).canon.Rias.facts;
  eq(back.map((f) => f.key + '=' + f.value).join(', '), 'eye color=grey, hair style=a braid', 'folded on load, the later one standing');
});

test('M681-20 A STANDING THE PAGES WORE DOWN STAYS DOWN (P6): the brief’s “P+40” was written back over a standing three betrayals had brought to nothing', async () => {
  const { standingsHousekeeping } = await import('../../js/agents/auditor.js');
  let st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  /* P6: three betrayals brought Kiyone to nothing */
  st = applyMutations(st, [{ type: 'rel.set', name: 'Kiyone', p: 40, r: 0, s: 0, cause: 'the brief states (P:40 R:0 S:0) toward Jovan' }]).state;
  for (const [i, why] of ['Jovan sold her map to the duke', 'Jovan left her at the gate in the rain', 'Jovan lied about the letter', 'Jovan laughed when she fell'].entries()) st = applyMutations({ ...st, page: 5 + i * 3 }, [{ type: 'rel.shift', name: 'Kiyone', axis: 'p', delta: -10, cause: why }]).state;
  eq(st.relationships.Kiyone.p, 0, 'worn down to zero');
  const out3 = standingsHousekeeping(st, '', '', 'Jovan', [{ name: 'Kiyone', p: 40, r: 0, s: 0 }]);
  assert(!out3.some((m) => m.type === 'rel.set' && m.name === 'Kiyone'), 'the brief does not write P+40 back: ' + JSON.stringify(out3));
  st = applyMutations(st, [{ type: 'rel.set', name: 'Aurora', p: 0, r: 0, s: 0, cause: 'set down by hand' }, { type: 'rel.set', name: 'Aurora', p: 1, r: 0, s: 0, cause: 'x' }, { type: 'rel.set', name: 'Aurora', p: 0, r: 0, s: 0, cause: 'zeroed' }]).state;
  assert(standingsHousekeeping(st, '', '', 'Jovan', [{ name: 'Aurora', p: 65, r: 30, s: 5 }]).some((m) => m.type === 'rel.set' && m.name === 'Aurora'), 'a standing only ever SET to zero takes the brief’s digits, as before (M49)');
});

test('M681-21 THE MAIN CHARACTER IS NEVER ELSEWHERE (W3): a seat for him was written whenever he was not in Here now, and the storyteller was told he was at the training ground', async () => {
  const { mcSeatLetGo } = await import('../../js/engine/apply.js');
  const named = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan Oda' }]);
  const mc = named.state; /* he is not in Here now — the page has not listed him (the house never lists him by name) */
  eq(applyMutations(mc, [{ type: 'offscreen.set', name: 'Jovan Oda', location: 'the training ground', activity: 'drilling' }]).applied.length, 0, 'never seated elsewhere');
  eq(applyMutations(mc, [{ type: 'offscreen.set', name: 'Oda', location: 'the training ground', activity: 'drilling' }]).applied.length, 0, 'not by his family name either');
  const seated = { ...mc, offscreen: { 'Jovan Oda': { location: 'the training ground', activity: 'drilling' } } };
  eq(Object.keys(applyMutations(seated, mcSeatLetGo(seated)).state.offscreen).length, 0, 'a seat from before is let go on opening');
});

test('M681-22 A RENAME KEEPS THE WHOLE BOOK (W9): two books joined under one name were cut to the newest twelve facts', async () => {
  const { renameInState } = await import('../../js/agents/ripple.js');
  const big = { ...emptyState(), knowledge: { Rias: Array.from({ length: 20 }, (_, i) => ({ fact: 'fact ' + i, atTurn: i })), 'Rias Gremory': [{ fact: 'fact x', atTurn: 30 }] } };
  eq(renameInState(big, 'Rias', 'Rias Gremory').state.knowledge['Rias Gremory'].length, 21, 'merged whole, never cut to twelve');
});

test('M681-23 THE WORLD AGENT DOES NOT WRITE OVER THE SEAT THIS PAGE’S READER GAVE (W4): the reader wrote “upstairs in the Wells house”; the world agent, after it on the same page, moved her to “the Bluebird Diner”', async () => {
  const { worldTurn } = await import('../../js/agents/world.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const world = (mutations) => thinkingHouse({ answer: JSON.stringify({ mutations, brief: { pressure: [], ripe: [], twb: null, voices: [] } }) });
  const PAGE = '[The Wells kitchen — Friday | 18:00]\n\nRias set the plates out. Upstairs, a door closed: Kiyone had gone up to her room without a word.';
  const setUp = async (id) => {
    let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Wells kitchen' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' }, { type: 'presence.enter', name: 'Kiyone' }]).state;
    st.page = 1;
    st = applyMutations(st, [{ type: 'presence.leave', name: 'Kiyone', to: 'upstairs in the Wells house', shown: 'Kiyone had gone up to her room' }]).state;
    await saveState(id, { ...st, readTo: 1 });
  };
  await setUp('m681-w4');
  assert(/upstairs/.test(((await loadState('m681-w4')).offscreen.Kiyone || {}).location || ''), 'fixture: the reader seated her upstairs');
  await withHouse(world([{ type: 'offscreen.set', name: 'Kiyone', location: 'the Bluebird Diner', activity: 'nursing a coffee' }]), () => worldTurn({ connection: HOUSES[0].conn, storyId: 'm681-w4', userText: 'I sit down.', assistantText: PAGE, stale: () => false, pageAt: 1 }));
  eq((await loadState('m681-w4')).offscreen.Kiyone.location, 'upstairs in the Wells house', 'the reader’s seat stands');
  await setUp('m681-w4b');
  await withHouse(world([{ type: 'offscreen.set', name: 'Kiyone', location: 'upstairs in the Wells house, in her room', activity: 'lying on her bed with headphones on' }]), () => worldTurn({ connection: HOUSES[0].conn, storyId: 'm681-w4b', userText: 'I sit down.', assistantText: PAGE, stale: () => false, pageAt: 1 }));
  eq((await loadState('m681-w4b')).offscreen.Kiyone.location, 'upstairs in the Wells house, in her room', 'the same place, said more fully, lands');
});

test('M681-24 A PAGE REWRITTEN IN PLACE IS READ AGAIN ALONE (B6): a typo fixed on an older page let go of every plan laid out from that page on and sent the reading back there', async () => {
  const { runPlans, loadPlansBook, pageRewritten } = await import('../../js/agents/plans.js');
  const sid = 'm681-plans';
  const pages = (two) => Array.from({ length: 6 }, (_, i) => ({ n: i + 1, who: i % 2 ? 'the storyteller' : 'the writer', text: i === 2 ? two : 'page ' + (i + 1) }));
  const raid = { title: 'the night raid', by: 'Rukia', page: 3, goal: 'take the gate', parts: [{ who: 'Renji', does: 'draws the guards off', when: 'at midnight' }, { who: 'Rukia', does: 'opens the gate', when: 'on the bell' }] };
  const feast = { title: 'the feast', by: 'Momo', page: 5, goal: 'cheer the captain', parts: [{ who: 'Momo', does: 'bakes the cake', when: 'at dawn' }] };
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages: pages('Rukia lays out the night raid.').slice(0, 4), callLLM: async () => JSON.stringify({ new: [raid], progress: [], closed: [] }) });
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages: pages('Rukia lays out the night raid.'), callLLM: async () => JSON.stringify({ new: [feast], progress: [{ title: 'the night raid', done: [1] }], closed: [] }) });
  let book = await loadPlansBook(sid);
  eq(book.plans.map((p) => p.title).sort().join(', '), 'the feast, the night raid', 'fixture: two plans');
  await pageRewritten(sid, 2); /* a typo fixed on page 3 */
  book = await loadPlansBook(sid);
  eq(book.readTo, 5, 'the pages after it stay read');
  eq(book.plans.map((p) => p.title).join(', '), 'the feast', 'the plan its old words laid out is set aside at once; the later page’s plan stands');
  const asked = [];
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages: pages('Rukia lays out the night raid, typo fixed.'), callLLM: async (c, { user }) => { asked.push(user); return JSON.stringify({ new: [raid], progress: [], closed: [] }); } });
  eq(asked.length, 1, 'one reading'); assert(/typo fixed/.test(asked[0]) && !/page 5/.test(asked[0]), 'of the rewritten page alone');
  book = await loadPlansBook(sid);
  eq(book.plans.map((p) => p.title).sort().join(', '), 'the feast, the night raid', 'both stand');
  eq(book.plans.find((p) => p.title === 'the night raid').parts.map((x) => Boolean(x.done)).join(','), 'true,false', 'what a later page carried out stays carried out');
  /* rewritten again, its new words lay out no plan: the raid goes */
  await pageRewritten(sid, 2);
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages: pages('Rukia shrugs.'), callLLM: async () => '{"new":[],"progress":[],"closed":[]}' });
  eq((await loadPlansBook(sid)).plans.map((p) => p.title).join(', '), 'the feast', 'a plan the page no longer lays out is gone');
});

/* ---- the people audit's P8, P9 and P11: canon's face through his story, canon off, and a name the wiki also knows ----
 * One house for the three: a wiki answered over fetch (titles, a redirect, a search, a page) and a scripted worker for
 * the lens (it judges each numbered statement by the story it is shown) — the real extension, the real lens, the real
 * ledger engine. */
const m681Ok = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
function m681CanonHouse({ pages = {}, redirects = {}, judge = () => 'holds' } = {}) {
  const realFetch = globalThis.fetch;
  const asks = { titles: [], lens: [] };
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/fandom\.com/.test(u)) {
      const q = new URL(u);
      const t = q.searchParams.get('titles'), p = q.searchParams.get('page'), sr = q.searchParams.get('srsearch');
      if (q.searchParams.get('list') === 'recentchanges') return m681Ok({ query: { recentchanges: [{ timestamp: '2026-09-01T00:00:00Z' }] } });
      if (sr) return m681Ok({ query: { search: Object.keys(pages).filter((k) => k.toLowerCase().includes(sr.toLowerCase())).map((title) => ({ title })) } });
      if (t) {
        asks.titles.push(t);
        const to = redirects[t] || t;
        return pages[to] ? m681Ok({ query: { ...(redirects[t] ? { redirects: [{ from: t, to }] } : {}), pages: { 9: { pageid: 9, title: to } } } }) : m681Ok({ query: { pages: { '-1': { title: t, missing: '' } } } });
      }
      if (p && pages[p]) return m681Ok({ parse: { title: p, wikitext: { '*': pages[p] } } });
      return m681Ok({});
    }
    if (/z\.ai/.test(u)) {
      const body = JSON.parse(opts.body);
      const sys = String((body.messages || []).find((m) => m.role === 'system')?.content || '');
      const user = String((body.messages || []).filter((m) => m.role === 'user').pop()?.content || '');
      let answer = '{}';
      if (/You keep a canon character true to ONE story/.test(sys)) {
        const statements = [...user.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));
        asks.lens.push(statements.map((x) => x.text));
        answer = JSON.stringify({ verdicts: statements.map((x) => ({ n: x.n, verdict: judge(x.text, user) })) });
      }
      if (body.stream) {
        const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\n' + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
        const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } });
        return { ok: true, status: 200, headers: new Headers(), body: stream, json: async () => ({}), text: async () => lines, clone() { return this; } };
      }
      const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
      return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
    }
    return realFetch(url, opts);
  };
  return { asks, restore: () => { globalThis.fetch = realFetch; } };
}
const M681_CONN = { type: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: 'k', model: 'glm-5.2', preset: 'zai' }; /* thinkinghouse's Z.ai house */
async function m681CanonStory(title, brief, meta) {
  const { canonMetaKey } = await import('../../js/canon/bridge.js');
  const st = await db.stories.create({ title });
  await db.stories.update(st.id, { brief });
  await db.settings.set(canonMetaKey(st.id), meta);
  return db.stories.get(st.id);
}

test('M681-40 CANON’S FACE IS READ THROUGH HIS STORY (P8): his canon notes give Rukia long hair and his story never made her captain — the lens judged every word canon says of her but her face, so “hair: Black, chin-length” and “As captain she wears a sleeveless haori” were locked among what is true of her and said in the note’s Appearance line', async () => {
  const { canonBeforeSend, canonSyncLedger } = await import('../../js/canon/bridge.js');
  const { lensFingerprint, lensCurrent, overlayFor, LENS_KEY } = await import('../../js/agents/canonlens.js');
  const RUKIA = () => ({ name: 'Rukia Kuchiki', found: true, kind: 'character', wiki: 'bleach', aliases: ['Rukia'], ts: 1,
    sections: { identity: 'Rukia Kuchiki is a Shinigami of the Gotei 13.', physical: 'hair: Black, chin-length; eyes: Violet',
      look: 'Rukia is a petite young woman with violet eyes. As captain she wears a sleeveless haori over her shihakushō.' } });
  const house = m681CanonHouse({ judge: (t) => (/haori|As captain/.test(t) ? 'later' : /^hair:/.test(t) ? 'changed' : 'holds') });
  try {
    const story = await m681CanonStory('Oda of the 13th', 'A Bleach story after the war. Oda is the new captain of the 13th Division; Rukia Kuchiki is his lieutenant.', {
      canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: 'x', fp: '(manual)', manual: true, ts: 1 },
      canon_grounding_pin: 'In this story Rukia wears her hair long, down to her waist.', canon_grounding_cache: { rukia: RUKIA() } });
    const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'presence.enter', name: 'Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
    state.characters = { 'Rukia Kuchiki': { core: 'Oda’s lieutenant.', state: 'at the division office', threads: [] } };
    await saveState(story.id, state);
    const note = await canonBeforeSend({ story, state, messages: [{ id: 'u1', role: 'user', text: 'I hand Rukia the duty roster.' }], connection: M681_CONN });
    eq(house.asks.lens.length, 1, 'she was read through his story once');
    assert(house.asks.lens[0].includes('hair: Black, chin-length') && house.asks.lens[0].some((s) => /sleeveless haori/.test(s)), 'her face is among what the lens judges: ' + JSON.stringify(house.asks.lens[0]));
    const look = (note.match(/Appearance:[^\n]*/) || [''])[0];
    assert(/petite young woman with violet eyes/.test(look) && !/haori|chin-length/.test(look), 'the note’s Appearance line is her face as it holds in his story: ' + look);
    await canonSyncLedger(story);
    const facts = ((await loadState(story.id)).canon['Rukia Kuchiki'] || { facts: [] }).facts;
    assert(!facts.some((f) => f.key === 'hair'), 'his canon notes changed her hair — canon’s is not locked: ' + JSON.stringify(facts));
    eq((facts.find((f) => f.key === 'look') || {}).value, 'Rukia is a petite young woman with violet eyes.', 'her look as it holds — no haori of a captaincy his story never gave her');
    /* a lens made before the face was judged still holds back what it judged, and is asked again, face and all */
    const entry = RUKIA();
    const faceless = { ...entry, sections: { identity: entry.sections.identity } };
    const old = { [LENS_KEY]: { 'rukia kuchiki': { fp: lensFingerprint(faceless), key: lensFingerprint(faceless) + '|old', overlay: { sections: { identity: '' } }, held: [] } } };
    assert(overlayFor(old, entry), 'an older lens still applies to the words it judged (the note never falls back to canon’s END while it is asked again)');
    eq(lensCurrent(old, entry, 'old'), false, 'and it is not current: the face is judged on the next canon turn');
  } finally { house.restore(); }
});

test('M681-41 CANON OFF SENDS NO “FROM CANON:” ANYWHERE (P9): what canon kept on a person’s page (M518) stayed when it was switched off — the storyteller’s request left it out, but the scribe, the planner, the choices helper and the people rebuild read the cards as kept', async () => {
  const { canonWithdraw, withoutCanonTruths, canonOn } = await import('../../js/canon/bridge.js');
  const { canonBlocks, lastingLines } = await import('../../js/assemble/canonpages.js');
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const { buildScribeMessages } = await import('../../js/agents/scribe.js');
  const { buildReaderMessages } = await import('../../js/agents/rebuild.js');
  const { renderPeopleTiers, peopleView } = await import('../../js/engine/people.js');
  const NOTE = ['What canon says about the people here:', 'Yuki Tsukumo:', '  - Identity: A special grade sorcerer who wanders abroad.', '  - Voice: "So, what kind of woman is your type?"', '  - With Choso: Wary allies.'].join('\n');
  const st0 = await db.stories.create({ title: 'Canon off' });
  const story = await db.stories.get(st0.id);
  let st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the barrier' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Yuki Tsukumo' }, { type: 'people.note', name: 'Yuki Tsukumo', field: 'core', text: 'A special grade.' }]).state;
  st = applyMutations(st, [{ type: 'people.canon', name: 'Yuki Tsukumo', lines: lastingLines(canonBlocks(NOTE)[1].lines) }, { type: 'canon.lock', name: 'Yuki Tsukumo', key: 'hair', value: 'long, blonde', source: 'canon' }]).state;
  await saveState(story.id, st);
  eq(await canonOn(story.id), false, 'canon is off for this story');
  const cards = (s) => (renderPeopleTiers(s, { recentPages: ['Yuki grins.'], view: peopleView(400000) }) || {}).text || '';
  assert(/From canon:/.test(cards(st)), 'fixture: the ledger as canon left it carries her canon lines on her card');
  /* an out-of-character turn may not write: its copy */
  const copy = withoutCanonTruths(st);
  assert(!/From canon:/.test(cards(copy)) && /A special grade\./.test(cards(copy)), 'the copy’s card has no canon lines, and keeps her page: ' + cards(copy));
  assert(Array.isArray(st.characters['Yuki Tsukumo'].canon), 'the copy never touches the ledger it came from');
  /* what the switch and every page with canon off do */
  assert(await canonWithdraw(story.id), 'withdrawn');
  const led = await loadState(story.id);
  const msgs = [{ id: 'u1', role: 'user', text: 'I raise my blade.' }];
  const wire = (r) => [...r.systemBlocks.map((b) => b.text), ...r.messages.map((m) => String(m.content))].join('\n');
  const sent = {
    storyteller: wire(buildRequest({ story: { brief: 'JJK.' }, messages: msgs, settings: {}, state: led, modules: [], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: [] }, canonNote: '', canonOn: false, canonOnPages: false })),
    scribe: JSON.stringify(buildScribeMessages({ state: led, userText: 'I raise my blade.', assistantText: 'Yuki grins.' })),
    'planner and choices': cards(led),
    'people rebuild': JSON.stringify(buildReaderMessages({ state: led, record: '', pages: [{ role: 'assistant', text: 'Yuki grins.' }], mc: 'Jovan' })),
  };
  for (const [who, text] of Object.entries(sent)) assert(!/From canon:/.test(text) && !/wanders abroad/.test(text), who + ' is sent no canon line: ' + text.slice(0, 400));
  assert(/A special grade\./.test(sent.scribe) && /A special grade\./.test(sent['people rebuild']), 'her own page still rides to the workers (the rebuild reader is shown the pages, not “[object Object]”)');
  eq(led.characters['Yuki Tsukumo'].core, 'A special grade.', 'her page stays');
  assert(led.journal.some((j) => j.m && j.m.type === 'people.canon'), 'journaled — a branch folds it the same way');
  eq(await canonWithdraw(story.id), null, 'nothing left, nothing written');
});

test('M681-42 AN ORIGINAL “ROSE” AND A WIKI THAT ALSO KNOWS ONE (P11): his brief says Rose is his own; the wiki’s “Rose” redirects to Rose Tyler — she is looked up as Rose Tyler (a name is all the wiki can go on), and his story is what decides what of Rose Tyler holds: none of her face is locked on his Rose or said in the note', async () => {
  const { canonBeforeSend, canonSyncLedger, canonLensLedger, canonMeta, canonEntryFor, canonLocks } = await import('../../js/canon/bridge.js');
  const ROSE_TYLER = "{{Infobox Character\n| name = Rose Tyler\n| hair = Blonde\n| eyes = Brown\n| species = Human\n}}\n'''Rose Tyler''' is a companion of the Doctor.\n== Appearance ==\nRose is a young woman with blonde hair and brown eyes.\n";
  const BRIEF = 'A Doctor Who story. Rose is my own character, a florist in Cardiff who has never met the Doctor; she is not Rose Tyler.';
  const house = m681CanonHouse({ pages: { 'Rose Tyler': ROSE_TYLER }, redirects: { Rose: 'Rose Tyler' }, judge: (t, user) => (/Rose is my own character/.test(user) ? 'changed' : 'holds') });
  try {
    const story = await m681CanonStory('Petals', BRIEF, { canon_grounding_wiki: 'tardis', canon_grounding_wiki_ok: { wikis: 'tardis', name: 'x', fp: '(manual)', manual: true, ts: 1 } });
    const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rose' }]).state;
    state.characters = { Rose: { core: 'a florist in Cardiff', state: 'at her stall', threads: [] } };
    await saveState(story.id, state);
    const messages = [{ id: 'u1', role: 'user', text: 'I buy a rose from Rose.' }];
    await canonBeforeSend({ story, state, messages, connection: null });
    const meta = await canonMeta(story.id);
    const hit = canonEntryFor(meta.canon_grounding_cache, 'Rose', ['Rose', 'Jovan']);
    assert(house.asks.titles.includes('Rose') && hit && hit.entry.name === 'Rose Tyler', 'found as it happens: the wiki’s redirect grounds the ledger’s “Rose” as Rose Tyler: ' + JSON.stringify(Object.values(meta.canon_grounding_cache).map((e) => e.name)));
    const unread = canonLocks({ state: await loadState(story.id), meta, brief: BRIEF });
    assert(unread.some((m) => m.name === 'Rose' && /blonde hair and brown eyes/.test(m.value)), 'fixture: with nothing of his story read, canon would give her Rose Tyler’s face: ' + JSON.stringify(unread));
    /* the chain: the lens reads his story first, then the ledger's faces are synced */
    await canonLensLedger(story, { connection: M681_CONN });
    eq(house.asks.lens.length, 1, 'Rose Tyler was read through his story');
    await canonSyncLedger(story);
    const facts = ((await loadState(story.id)).canon.Rose || { facts: [] }).facts;
    eq(facts.length, 0, 'his story says Rose is his own: nothing of Rose Tyler’s face is locked on her — ' + JSON.stringify(facts));
    const note = await canonBeforeSend({ story, state: await loadState(story.id), messages: [...messages, { id: 'a1', role: 'assistant', text: 'She wraps it.' }, { id: 'u2', role: 'user', text: 'I thank Rose.' }], connection: M681_CONN });
    assert(!/blonde|brown eyes/i.test(note), 'nor is it said in the note: ' + note);
  } finally { house.restore(); }
});

/* ---- THE WORLD (the world audit's W1, W2, W5, W7, W8, W10, W11, W12), each made to happen on 3d28628 first ---- */
const worldHouse = async (answer) => { const { thinkingHouse } = await import('./thinkinghouse.mjs'); return thinkingHouse({ answer: JSON.stringify(answer) }); };

test('M681-50 THE WORLD’S WORD DOES NOT TELL THE ARRIVAL OF SOMEONE ALREADY HERE (W1): “Rias Gremory is on her way — about 15 minutes out” was written while she was away; the next page walked her in, and the storyteller was still told she could reach the scene', async () => {
  const { renderWorldBrief } = await import('../../js/engine/world.js');
  let st = applyMutations({ ...emptyState(), page: 4, clock: { minutes: 1080 } }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Wells kitchen' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'people.set', name: 'Rias Gremory', field: 'core', text: 'a devil heiress' }, { type: 'offscreen.set', name: 'Rias Gremory', location: 'the clubhouse', activity: 'gathering her coat', stance: 'toward', etaMinutes: 15 },
    { type: 'world.word', brief: {
      pressure: ['Rias Gremory is on her way from the clubhouse — about 15 minutes out', 'Kiba could reach the scene within the hour, still furious about the bet', 'Rias’s father arrives at nine with the contract', 'Jovan arrives at the gala at nine whether he likes it or not'],
      ripe: ['Rias and Akeno are heading this way together', 'Rias heads back to the clubhouse at ten to sign the papers'], twb: null } }]).state;
  const told = (s) => renderWorldBrief(s.worldBrief, s.turn, s.page, s);
  assert(/Rias Gremory is on her way/.test(told({ ...st, page: 5 })), 'fixture: told while she is away');
  st = applyMutations({ ...st, page: 5 }, [{ type: 'presence.enter', name: 'Rias Gremory' }]).state; /* the page walked her in */
  const words = told(st);
  assert(!/Rias Gremory is on her way/.test(words), 'her own arrival is not told once she stands here: ' + words);
  assert(/Kiba could reach the scene/.test(words), 'someone still away still comes');
  assert(/Rias’s father arrives/.test(words), 'her father’s coming is his, not hers');
  assert(/Jovan arrives at the gala/.test(words), 'the main character is the scene — a line of his own plans stands');
  assert(/Rias and Akeno are heading this way/.test(words), 'a coming said of two, one still away, stands');
  assert(/Rias heads back to the clubhouse/.test(words), 'a going of hers is no arrival');
  st = applyMutations(st, [{ type: 'presence.enter', name: 'Akeno' }]).state;
  assert(!/Rias and Akeno are heading/.test(told(st)), 'both here: their coming is not told');
});

test('M681-51 THE WINDOW RULE SLEEPS WHEN THE WORD THAT OPENED IT HAS AGED OUT (W2): the brief stopped being told after four pages and the rule “A window is open this turn — the house’s word names who” still rode', async () => {
  const { renderWorldBrief, BRIEF_STALE_TURNS } = await import('../../js/engine/world.js');
  const { listModules } = await import('../../js/assemble/modules.js');
  const rule = (await listModules()).find((m) => m.id === 'world-window');
  assert(rule && typeof rule.when === 'function', 'the window rule is there');
  const wakes = (s) => Boolean(rule.when(s).load);
  const st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'world.word', brief: { pressure: [], ripe: [], twb: { who: 'Aurora', where: 'the train', changed: 'she has read the letter twice and decided' } } }]).state;
  const next = { ...st, page: 3 };
  assert(/A window into the world beyond/.test(renderWorldBrief(next.worldBrief, next.turn, next.page, next)), 'fixture: the next page is told of the window');
  eq(wakes(next), true, 'and the rule wakes');
  const late = { ...st, page: 2 + BRIEF_STALE_TURNS + 1 };
  eq(renderWorldBrief(late.worldBrief, late.turn, late.page, late), '', 'aged out: the storyteller is told nothing');
  eq(wakes(late), false, 'and the window rule sleeps');
  const hers = applyMutations(next, [{ type: 'presence.enter', name: 'Aurora' }]).state;
  eq(wakes({ ...hers, page: 3 }), false, 'a window on someone here: no rule (M543, as before)');
});

test('M681-52 AN APPROACH THAT NEVER LANDED IS NOBODY ON THE WAY (W5): a rider due four hours ago ranked first among the six told — above someone ten minutes out — and was carried as “on the way” for ever', async () => {
  const { renderOffscreen, seatOrder } = await import('../../js/engine/offscreen.js');
  const { carriedBy, seatHousekeeping } = await import('../../js/agents/auditor.js');
  let st = applyMutations({ ...emptyState(), page: 1, clock: { minutes: 600 } }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'offscreen.set', name: 'Tobias Wren', location: 'the north road', activity: 'riding hard', stance: 'toward', etaMinutes: 20 }]).state;
  st = applyMutations({ ...st, page: 30, clock: { minutes: 600 + 20 + 240 } }, [{ type: 'offscreen.set', name: 'Rias', location: 'the station', activity: 'hailing a cab', stance: 'toward', etaMinutes: 10 },
    ...['Kiba', 'Akeno', 'Koneko', 'Gasper', 'Xenovia', 'Irina'].map((n) => ({ type: 'offscreen.set', name: n, location: n + '’s flat', activity: 'at home', stance: 'busy' }))]).state;
  const now = st.clock.minutes;
  const lines = renderOffscreen(st.offscreen, st.present, now).split('\n');
  assert(/^Rias — /.test(lines[0]), 'the one truly arriving is told first: ' + lines.join(' | '));
  eq(seatOrder(st.offscreen, now)[0], 'Rias', 'the drawer’s order, the same');
  eq(carriedBy(st, 'Tobias Wren', {}), '', 'a lapsed approach carries nobody');
  assert(seatHousekeeping(st, {}).some((m) => m.type === 'offscreen.clear' && m.name === 'Tobias Wren'), 'and nothing else carrying him, his seat goes as a passer-through’s');
  eq(carriedBy(st, 'Rias', {}), 'on the way to the main character', 'a live approach still carries');
  const due = { ...st, clock: { minutes: 600 + 20 + 60 } }; /* an hour overdue: still said, still first (M645) */
  eq(carriedBy(due, 'Tobias Wren', {}), 'on the way to the main character', 'overdue within the hours is still on the way');
});

test('M681-53 A FACTION HAS AN AGE AND CAN BE LET GO (W7): a move made twenty pages ago was told as this hour’s, and nothing — no worker, not his hand — could let a faction go', async () => {
  const { renderFactions } = await import('../../js/engine/world.js');
  const { undoLast } = await import('../../js/engine/apply.js');
  const { foldJournal, renderStateFacts } = await import('../../js/engine/state.js');
  const { worldTurn, WORLD_TYPES } = await import('../../js/agents/world.js');
  const { AUDITOR_TYPES } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  let st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'faction.set', name: 'the Black Hand', stance: 'hunting the heir', move: 'burned the granary' }]).state;
  assert(/the Black Hand — hunting the heir; last move: burned the granary/.test(renderFactions(st.factions, 4, 4)), 'a fresh move says no age');
  assert(/last move \(about 20 pages ago\): burned the granary/.test(renderFactions(st.factions, 4, 23)), 'an old one says when: ' + renderFactions(st.factions, 4, 23));
  assert(/Factions:[^\n]*about 20 pages ago/.test(renderStateFacts({ ...st, page: 22 })), 'the storyteller’s state of things says it');
  const r = applyMutations({ ...st, page: 9 }, [{ type: 'faction.clear', name: 'the Black Hand' }]);
  eq(r.applied.length, 1, 'a faction is let go: ' + JSON.stringify(r.rejected));
  eq(Object.keys(r.state.factions).length, 0, 'gone from the ledger');
  const j = r.state.journal[r.state.journal.length - 1];
  eq(j.m.type + '@' + j.p, 'faction.clear@9', 'journaled with its page');
  eq(undoLast(r.state).state.factions['the Black Hand'].move, 'burned the granary', 'taken back whole');
  eq(foldJournal(r.state, [], 8, applyMutations).factions['the Black Hand'].move, 'burned the granary', 'a fold to before the clear keeps the faction');
  eq(applyMutations(st, [{ type: 'faction.clear', name: 'the Red Hand' }]).applied.length, 0, 'no such faction: refused — “hand” alone is not the Black Hand');
  const two = applyMutations(st, [{ type: 'faction.set', name: 'the Red Hand', stance: 'allied with the crown', move: 'sent envoys' }]).state.factions;
  eq(Object.keys(two).sort().join(' | ') + ' / ' + two['the Black Hand'].move, 'the Black Hand | the Red Hand / burned the granary', 'the Red Hand is its own faction — never written over the Black Hand');
  const { findFactionKey } = await import('../../js/engine/world.js');
  eq(findFactionKey({ 'the Vanderbilt family': {} }, 'House Vanderbilt'), 'the Vanderbilt family', 'another word for the kind of group is the same faction');
  assert(WORLD_TYPES.has('faction.clear') && AUDITOR_TYPES.has('faction.clear'), 'the world agent and the auditor may let one go');
  await saveState('m681-w7', { ...st, readTo: 2 });
  await withHouse(await worldHouse({ mutations: [{ type: 'faction.clear', name: 'the Black Hand' }], brief: { pressure: [], ripe: [], twb: null } }), () => worldTurn({ connection: HOUSES[0].conn, storyId: 'm681-w7', userText: 'I watch the smoke.', assistantText: 'The Black Hand was finished: its last captains hanged at dawn, its hall burned.', stale: () => false, pageAt: 3 }));
  eq(Object.keys((await loadState('m681-w7')).factions).length, 0, 'the world agent’s clear lands');
});

test('M681-54 THE AUDITOR’S SEAT FIX LANDS WHEN THE NEWEST PAGE BEARS IT OUT (W10): “Rias’s seat says the night market; the page has her at the Blue Lantern bar” was reported and its fix dropped, every audit — never the moment it guarded, never against how the page ends', async () => {
  const { auditorScope } = await import('../../js/agents/auditor.js');
  let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Wells kitchen' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'people.set', name: 'Rias', field: 'core', text: 'his neighbour' }, { type: 'offscreen.set', name: 'Rias', location: 'the night market', activity: 'haggling over peaches' }]).state;
  st = { ...st, page: 3 };
  const issue = (location, activity = 'nursing a gin') => [{ what: 'Rias’s seat says the night market; the page has her at the Blue Lantern bar', fixable: true, mutations: [{ type: 'offscreen.set', name: 'Rias', location, activity }] }];
  const PAGE = '[The Wells kitchen — Friday | 21:00]\n\nJovan scrolled through his messages. Across town, Rias sat at the Blue Lantern bar, nursing a gin and ignoring her phone.';
  const kept = (issues, page, s = st) => auditorScope(issues, s, { page, pageAt: 3 }).flatMap((i) => i.mutations);
  const landed = kept(issue('the Blue Lantern bar'), PAGE);
  eq(landed.length, 1, 'the newest page has her at the bar: the fix stands');
  eq(applyMutations(st, landed).state.offscreen.Rias.location, 'the Blue Lantern bar', 'and lands');
  eq(kept(issue('the night market, by the peach stalls', 'counting her change'), PAGE).length, 0, 'the same place said again is the moment (M128), still dropped');
  eq(kept(issue('the Blue Lantern bar'), '[The Wells kitchen — Friday | 21:00]\n\nJovan scrolled through his messages and sighed.').length, 0, 'a page that does not have her there moves nobody');
  /* this page’s reader seated her where the page ENDS; the auditor reading its start does not walk her back */
  const went = applyMutations(st, [{ type: 'offscreen.set', name: 'Rias', location: 'her flat above the bakery', activity: 'asleep' }]).state;
  const ENDS = '[The Wells kitchen — Friday | 21:00]\n\nAcross town, Rias sat at the Blue Lantern bar, nursing a gin.\n\n' + 'By midnight she had paid, pulled her coat on against the wind and walked the long way home through the empty streets, past the shuttered stalls and the dark tram depot, up the narrow stairs to her flat above the bakery, where she kicked off her shoes, let the phone die on the dresser, and fell asleep in her clothes with the window still open to the smell of the ovens below and the first carts rattling in the lane before dawn.';
  eq(kept(issue('the Blue Lantern bar'), ENDS, went).length, 0, 'never back to where the page started');
  eq(kept(issue('her flat above the bakery, in bed', 'asleep in her clothes'), ENDS, st).length, 1, 'where the page ends, it may');
});

test('M681-55 THE WORKERS’ LINE SAYS WHAT THE WORLD’S WORD IS (W12): it said “left the world’s word” and never what could reach the scene — and said it of a word of voices alone, which the storyteller is never told', async () => {
  const { worldTurn, worldRunWords } = await import('../../js/agents/world.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  await saveState('m681-w12', { ...applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }]).state, readTo: 0 });
  const run = async (brief) => worldRunWords(await withHouse(await worldHouse({ mutations: [], brief }), () => worldTurn({ connection: HOUSES[0].conn, storyId: 'm681-w12', userText: 'I wait.', assistantText: 'Jovan waited in the booth.', stale: () => false, pageAt: 1 })));
  const said = await run({ pressure: ['Kim could reach the restaurant in about forty minutes'], ripe: ['The studio knows about the photos'], twb: { who: 'Aurora', where: 'the train', changed: 'she decided' }, voices: [] });
  assert(/left the world’s word \(could reach the scene: Kim could reach the restaurant in about forty minutes · 1 ripened out of sight · a window on Aurora\)/.test(said), said);
  const voices = await run({ pressure: [], ripe: [], twb: null, voices: [{ icon: '🍺', speaker: 'a barman', channel: 'the Kettle · late', content: 'Last orders, lads.' }, { icon: '🏪', speaker: 'a fishwife', channel: 'the quay · late', content: 'Two for one, going off tomorrow.' }] });
  assert(!/left the world’s word/.test(voices) && /2 voices heard/.test(voices), 'voices alone are no word for the storyteller: ' + voices);
});

test('M681-56 THE WORLD’S WRITES FOR A PAGE WHOSE READER FAILED ARE ALL THAT PAGE’S (W11 — checked: M680-11 stamps them; the brief, the windows shown, the threads, the facts and the factions fold away with the seat)', async () => {
  const { worldTurn } = await import('../../js/agents/world.js');
  const { foldJournal } = await import('../../js/engine/state.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const led = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'people.set', name: 'Kim', field: 'core', text: 'a courier' }]).state;
  await saveState('m681-w11', { ...led, readTo: 0 }); /* the reader of page 1 failed: the ledger stands at page 0 */
  await withHouse(await worldHouse({ mutations: [
    { type: 'offscreen.set', name: 'Kim', location: 'the north gate', activity: 'waiting for a reply', stance: 'busy' },
    { type: 'thread.set', title: 'Kim and the letter', owner: 'Kim', heat: 'hot', next: 'deliver it by dusk' },
    { type: 'knowledge.add', name: 'Kim', fact: 'saw the seal on the letter was broken' },
    { type: 'faction.set', name: 'the Couriers’ Guild', stance: 'nervous', move: 'doubled its riders' },
  ], brief: { pressure: ['Kim could reach the yard by dusk'], ripe: [], twb: { who: 'Kim', where: 'the north gate', changed: 'she opened the letter' } } }), () => worldTurn({ connection: HOUSES[0].conn, storyId: 'm681-w11', userText: 'I wait for word.', assistantText: 'The yard, page 2. No rider came.', stale: () => false, pageAt: 1 }));
  const after = await loadState('m681-w11');
  assert(after.worldBrief && after.worldShown.length === 1 && after.threads.length === 1 && Object.keys(after.factions).length === 1, 'fixture: the world wrote its page');
  eq([...new Set((after.journal || []).filter((e) => e.p === 1).map((e) => e.m.type))].sort().join(','), 'faction.set,knowledge.add,offscreen.set,thread.set,world.word', 'every write of the world is journaled with the page it is about');
  const folded = foldJournal(after, [], 0, applyMutations);
  eq(folded.worldBrief, null, 'a fold to the page before keeps no word of it');
  eq(folded.worldShown.length + folded.threads.length + Object.keys(folded.factions).length + Object.keys(folded.knowledge).length + Object.keys(folded.offscreen).length, 0, 'nor its window, thread, faction, fact or seat');
});

test('M681-43 WITH NO DOSSIER, WHAT THE NOTE SAYS OF THEM IS READ THROUGH HIS STORY TOO (P8’s same fault, found by a search): the regex-section note says canon’s Personality, Abilities and Trivia whole — “She later became captain of the 13th Division” rode every page of a story where she never did', async () => {
  const { canonBeforeSend } = await import('../../js/canon/bridge.js');
  const RUKIA = () => ({ name: 'Rukia Kuchiki', found: true, kind: 'character', wiki: 'bleach', aliases: ['Rukia'], ts: 1,
    sections: { identity: 'Rukia Kuchiki is a Shinigami of the Gotei 13.', personality: 'Rukia is reserved and dutiful.', trivia: 'She later became captain of the 13th Division. She draws rabbits.' } });
  const house = m681CanonHouse({ judge: (t) => (/captain/.test(t) ? 'later' : 'holds') });
  try {
    const story = await m681CanonStory('Oda of the 13th, no dossier', 'A Bleach story after the war. Oda is the new captain of the 13th Division; Rukia Kuchiki is his lieutenant.', {
      canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: 'x', fp: '(manual)', manual: true, ts: 1 }, canon_grounding_cache: { rukia: RUKIA() } });
    const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'presence.enter', name: 'Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
    await saveState(story.id, state);
    const note = await canonBeforeSend({ story, state, messages: [{ id: 'u1', role: 'user', text: 'I hand Rukia the duty roster.' }], connection: M681_CONN });
    assert(house.asks.lens.length === 1 && house.asks.lens[0].some((s) => /became captain/.test(s)), 'her trivia is among what the lens judges: ' + JSON.stringify(house.asks.lens));
    assert(/draws rabbits/.test(note), 'what holds is still said: ' + note);
    assert(!/became captain/.test(note), 'a captaincy his story never gave her is not: ' + note);
  } finally { house.restore(); }
});

/* ---- the scene audit's S7, S8, S11, S12, S13 — each made to happen on m680-001 / 3d28628 first ---- */
const MONTHS_OWN = ['Frostfall', 'Deepwinter', 'Thawmoon', 'Seedtide', 'Bloomrise', 'Highsun', 'Emberfall', 'Harvestide', 'Leafturn', 'Mistmoon', 'Duskfall', 'Longnight'];
const DAYS_OWN = ['Sunsday', 'Moonsday', 'Thornday', 'Fireday', 'Windsday', 'Starday', 'Restday'];

test('M681-30 THE STORY’S OWN CALENDAR OUTLIVES A FOLD (the scene audit’s S11): the drawer wrote “A calendar of its own” and its month and day names straight into the clock with no journal line — “Try again” on the page he named them under folded the clock back to a checkpoint without them, and the real calendar spoke again', async () => {
  const { foldJournal, withStoryWrites } = await import('../../js/engine/state.js');
  const { renderClock } = await import('../../js/engine/clock.js');
  const { undoEntry } = await import('../../js/engine/apply.js');
  let st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'clock.set', year: 1247, month: 10, day: 14, hour: 15, minute: 58 }]).state;
  const checkpoint = JSON.parse(JSON.stringify(st)); /* the boundary before page 5, taken when he sent */
  st = applyMutations({ ...st, page: 4 }, [{ type: 'presence.enter', name: 'Mara' }, { type: 'clock.set', hour: 16, minute: 20 }]).state;
  /* his hand, as the drawer writes it (handMutate: "Keep the names") */
  const named = applyMutations(st, [{ type: 'clock.calendar', calendar: 'custom', monthNames: MONTHS_OWN, dayNames: DAYS_OWN, story: true }]);
  eq(named.applied.length, 1, 'the calendar is a write the ledger takes, journaled');
  st = named.state;
  const said = renderClock(st.clock);
  assert(/Mistmoon 14, 1247 — 16:20$/.test(said), 'the clock speaks his names: ' + said);
  /* "Try again" on page 5 (index 4): the fold to the page before, as chat.js foldTo makes it */
  const folded = withStoryWrites(foldJournal(st, [{ id: 'u5', snap: checkpoint }], 3, applyMutations), st, applyMutations);
  eq(folded.clock.calendar, 'custom', 'the calendar he chose stands after the fold');
  assert(/Mistmoon 14, 1247 — 15:58$/.test(renderClock(folded.clock)), 'his names, on the hour of the page folded to: ' + renderClock(folded.clock));
  assert(/Mistmoon/.test(renderClock(applyMutations({ ...folded, page: 4 }, [{ type: 'clock.set', hour: 18, minute: 0 }]).state.clock)), 'and the next header’s hour keeps them');
  eq(applyMutations(st, [{ type: 'clock.calendar', calendar: 'custom', monthNames: MONTHS_OWN, dayNames: DAYS_OWN, story: true }]).rejected[0].same, true, 'the same names again are already so');
  /* the take-back: the calendar alone goes back, never the hour — and a fold keeps the take-back */
  const at = st.log.findIndex((e) => /calendar of its own/.test(e.words));
  const back = undoEntry(st, at);
  eq(back.state.clock.calendar, 'real', 'taken back');
  eq(back.state.clock.minutes, st.clock.minutes, 'the hour untouched');
  const foldedBack = withStoryWrites(foldJournal(back.state, [{ id: 'u5', snap: checkpoint }], 3, applyMutations), back.state, applyMutations);
  eq(foldedBack.clock.calendar, 'real', 'the fold keeps the take-back');
  eq(foldedBack.clock.minutes, checkpoint.clock.minutes, 'and the folded page’s own hour');
  /* a take-back of an hour leaves the calendar as it stands */
  const hourAt = st.log.findIndex((e) => /16:20/.test(e.words));
  eq(undoEntry(st, hourAt).state.clock.calendar, 'custom', 'taking back an hour keeps his calendar');
});

/* a tale of five pages, its ledger read to the newest (index 4) */
const weighTale = async (title) => {
  const story = await db.stories.create({ title });
  for (let i = 0; i < 5; i += 1) {
    await db.messages.append(story.id, { id: title + '-u' + i, role: 'user', text: 'I square up to Renji. (' + i + ')', ts: 1000 + i * 2 });
    await db.messages.append(story.id, { id: title + '-a' + i, role: 'assistant', text: '[Tenth Division Courtyard — Monday | 09:2' + i + ']\n\nRenji rolled his shoulders; Jovan parried him once more. (' + i + ')', ts: 1001 + i * 2 });
  }
  const st = applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Tenth Division Courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Renji' }]).state;
  await saveState(story.id, st);
  return story.id;
};
const WEIGHED = JSON.stringify({ actors: [{ name: 'Jovan', default: 5, domains: { melee: 7 }, why: 'he parried Renji five times' }, { name: 'Renji', default: 6, domains: { melee: 8 }, why: 'a lieutenant' }] });
const CONN = { type: 'openai', contextSize: 128000 };

test('M681-31 A WEIGHING OF THE CAST OUTLIVES A FOLD (the scene audit’s S12): the weighing wrote the sheet straight into the ledger, after the next page’s checkpoint was taken — “Try again” on the next page folded to that checkpoint and the cast was unweighed again', async () => {
  const { maybeSeedSheet } = await import('../../js/agents/referee.js');
  const { foldJournal } = await import('../../js/engine/state.js');
  const sid = await weighTale('m681-weigh-fold');
  const checkpoint = JSON.parse(JSON.stringify(await loadState(sid))); /* taken when he sent the next page, before the weighing landed */
  const r = await maybeSeedSheet({ connection: CONN, storyId: sid, callLLM: async () => WEIGHED });
  eq(r && r.ok, true, 'weighed');
  let st = await loadState(sid);
  eq(st.sheet.actors.Renji.default, 6, 'fixture: Renji is weighed');
  /* page 6 is read; then "Try again" on it folds to page 5 (index 4) */
  st = applyMutations({ ...st, page: 5 }, [{ type: 'presence.enter', name: 'Ikkaku' }]).state;
  const folded = foldJournal(st, [{ id: 'u5', snap: checkpoint }], 4, applyMutations);
  assert(folded.sheet.actors.Renji && folded.sheet.actors.Renji.default === 6 && folded.sheet.actors.Jovan.domains.melee === 7, 'the weighing stands after the fold: ' + JSON.stringify(folded.sheet.actors));
  const line = (st.journal || []).find((e) => e && e.m && e.m.type === 'sheet.weigh');
  eq(line && line.p, 4, 'a journal line, stamped with the last page it read');
  eq(folded.sheet.seedVersion, st.sheet.seedVersion, 'and its marks — it is not due again for nothing');
  eq(folded.seedDueAfterFight, false, 'nor after a fight it already weighed');
  assert(!foldJournal(st, [], 3, applyMutations).sheet.actors.Renji, 'a fold to before the page it read lets it go with the page');
});

test('M681-32 THE REFEREE LAYS ITS OWN CHANGE ON THE SHEET, NEVER ITS WHOLE COPY (S12’s same fault, found by its search): a weighing that landed while the referee ruled was written over by the referee’s copy on the send, and by the committed ruling’s copy on every replay of that turn', async () => {
  const { refereeBase, refereeOnto, refereeStep, userMessageHash } = await import('../../js/agents/referee.js');
  const st = applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  st.sheet.actors = { Jovan: { default: 5, domains: { melee: 6 }, _auto: true } };
  const base = refereeBase(st);
  const after = JSON.parse(JSON.stringify(st));
  after.sheet.actors.Jovan.conditions = [{ name: 'cut forearm', mod: -1, by: 'referee' }];
  const fresh = JSON.parse(JSON.stringify(st));
  fresh.sheet.actors.Renji = { default: 6, domains: { melee: 8 }, _auto: true }; /* the weighing, landed meanwhile */
  const merged = refereeOnto(fresh, base, after);
  assert(merged.sheet.actors.Renji && merged.sheet.actors.Renji.default === 6, 'the weighing stands: ' + JSON.stringify(merged.sheet.actors));
  eq((merged.sheet.actors.Jovan.conditions || []).map((c) => c.name).join(), 'cut forearm', 'and the ruling’s own change lands');
  /* the replay of the committed ruling (a "Try again" of that turn) */
  const text = 'I swing at Renji.';
  const ledger = JSON.parse(JSON.stringify(fresh));
  ledger.refHistory = [{ key: userMessageHash(text), msgId: 'u5', verdict: { tier: 'success' }, snap: { duel: null, battle: null, turn: 1, sheet: JSON.parse(JSON.stringify(st.sheet)) }, after: { duel: null, battle: null, turn: 1, combat: false, sheet: JSON.parse(JSON.stringify(after.sheet)) }, at: 1 }];
  const replay = await refereeStep({ userText: text, userId: 'u5', history: [{ id: 'u5', role: 'user', text }], state: ledger, settings: {} });
  eq(replay.status, 'replayed', 'fixture: the committed ruling replays');
  assert(replay.state.sheet.actors.Renji && replay.state.sheet.actors.Renji.default === 6, 'the weighing stands through the replay: ' + JSON.stringify(replay.state.sheet.actors));
  eq((replay.state.sheet.actors.Jovan.conditions || []).map((c) => c.name).join(), 'cut forearm', 'and the ruling’s change is there');
});

test('M681-33 A WEIGHING OF PAGES LET GO IS NOT WRITTEN (the scene audit’s S8): “Try again” waits five seconds for the page’s helpers, folds, and the weighing still out landed on the folded ledger — read from the page let go', async () => {
  const { maybeSeedSheet } = await import('../../js/agents/referee.js');
  const sid = await weighTale('m681-weigh-stale');
  const rewound = JSON.parse(JSON.stringify(await loadState(sid)));
  rewound.page = 3;
  const r = await maybeSeedSheet({ connection: CONN, storyId: sid, callLLM: async () => { await db.messages.deleteFrom(sid, 'm681-weigh-stale-a4'); await saveState(sid, rewound); return WEIGHED; } });
  eq(r && r.ok, false, 'not written');
  eq(Object.keys((await loadState(sid)).sheet.actors || {}).length, 0, 'the folded ledger holds no weighing of the page let go');
  /* the chain's own stale(): a fold turned the chain while it weighed */
  const sid2 = await weighTale('m681-weigh-stale2');
  let turned = false;
  const r2 = await maybeSeedSheet({ connection: CONN, storyId: sid2, stale: () => turned, callLLM: async () => { turned = true; return WEIGHED; } });
  eq(r2 && r2.ok, false, 'a stale chain’s weighing is let go');
  eq(Object.keys((await loadState(sid2)).sheet.actors || {}).length, 0, 'nothing written');
  /* and a page that merely LANDED while it weighed is no reason to let it go */
  const sid3 = await weighTale('m681-weigh-landed');
  const r3 = await maybeSeedSheet({ connection: CONN, storyId: sid3, callLLM: async () => { await db.messages.append(sid3, { id: 'm681-weigh-landed-u9', role: 'user', text: 'I go on.', ts: 5000 }); return WEIGHED; } });
  eq(r3 && r3.ok, true, 'a page added after it is no change to what it read');
});

test('M681-34 A HEALED WOUND IS HEALED ON THE REFEREE’S SHEET (the scene audit’s S7): the referee filed “gashed forearm -2”, the story healed the forearm, and every fight after still rolled him two below himself', async () => {
  const { undoEntry } = await import('../../js/engine/apply.js');
  const { ratingFor } = await import('../../js/engine/duels.js');
  let st = applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'body.injure', name: 'Jovan', what: 'a deep gash along the left forearm', sev: 2 }]).state;
  st.sheet.actors = { Jovan: { default: 5, domains: { melee: 7 }, _auto: true, conditions: [{ name: 'gashed forearm', mod: -2, domain: 'melee', by: 'referee' }, { name: 'masterwork blade', mod: 1, domain: 'melee', by: 'referee', gear: true }, { name: 'poisoned', mod: -1, by: 'referee' }, { name: 'forearm brace', mod: -1, by: 'hand' }] } };
  eq(ratingFor(st.sheet.actors.Jovan, 'melee', 5), 4, 'fixture: melee 7, the gash -2, the blade +1, the poison -1, his brace -1');
  const healed = applyMutations({ ...st, page: 9 }, [{ type: 'body.heal', name: 'Jovan', what: 'his forearm has healed' }]);
  eq(healed.applied.length, 1, 'the wound heals');
  const names = (s) => (s.sheet.actors.Jovan.conditions || []).map((c) => c.name).join(', ');
  eq(names(healed.state), 'masterwork blade, poisoned, forearm brace', 'the gash goes from the sheet; the blade, another harm, and his own line stay');
  eq(ratingFor(healed.state.sheet.actors.Jovan, 'melee', 5), 6, 'he fights at 6 again, not 4');
  const back = undoEntry(healed.state, healed.state.log.length - 1);
  eq(names(back.state), 'masterwork blade, poisoned, forearm brace, gashed forearm', 'the take-back puts the line back');
  /* a fold replays the healing the same way */
  const { foldJournal } = await import('../../js/engine/state.js');
  eq(names(foldJournal(healed.state, [{ id: 'x', snap: JSON.parse(JSON.stringify(st)) }], 9, applyMutations)), 'masterwork blade, poisoned, forearm brace', 'a fold heals it again');
});

test('M681-35 THE REFEREE’S HARM ANSWERS TO THE WEIGHING THAT WAS SHOWN IT (the scene audit’s S7): every weighing was shown “carries: cracked rib” long after the story mended it, left it out — and it stood for good; one that named it again counted it twice', async () => {
  const { mergeSeed, maybeSeedSheet, harmShown, SEED_VERSION } = await import('../../js/agents/referee.js');
  const sheet = () => ({ default: 5, domains: { melee: 7 }, _auto: true, seed: SEED_VERSION, conditions: [{ name: 'cracked rib', mod: -1, by: 'referee' }, { name: 'masterwork blade', mod: 1, by: 'referee', gear: true }] });
  const base = () => { const s = applyMutations({ ...emptyState(), page: 9 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }]).state; s.sheet.actors = { Jovan: sheet() }; s.sheet.seedVersion = SEED_VERSION; return s; };
  const names = (s) => (s.sheet.actors.Jovan.conditions || []).map((c) => c.name).join(', ');
  const answer = (lasting) => ({ actors: [{ name: 'Jovan', default: 5, domains: { melee: 7 }, lasting }] });
  /* through the house's own weighing: what it was shown is what it judges */
  const weigh = async (title, lasting) => {
    const sid = await weighTale(title);
    const led = await loadState(sid); led.sheet.actors = { Jovan: sheet(), Renji: { default: 6, _auto: true, seed: SEED_VERSION } }; led.sheet.seedVersion = SEED_VERSION; await saveState(sid, led);
    await maybeSeedSheet({ connection: CONN, storyId: sid, force: true, callLLM: async () => {
      const mid = await loadState(sid); mid.sheet.actors.Renji.conditions = [{ name: 'bruised knee', mod: -1, by: 'referee' }]; await saveState(sid, mid); /* the referee rules while it reads */
      return JSON.stringify({ actors: [{ name: 'Jovan', default: 5, domains: { melee: 7 }, lasting }, { name: 'Renji', default: 6, domains: { melee: 8 }, lasting: [] }] });
    } });
    return loadState(sid);
  };
  let after = await weigh('m681-weigh-rib', []);
  eq(names(after), 'masterwork blade', 'the mended rib the weighing left out is let go; the blade (gear) stays');
  eq((after.sheet.actors.Renji.conditions || []).map((c) => c.name).join(), 'bruised knee', 'the knee filed while it read (never shown it) stays');
  after = await weigh('m681-weigh-rib2', [{ name: 'cracked ribs', mod: -1 }]);
  eq(names(after), 'cracked rib, masterwork blade', 'named again: the referee’s line stands, never a second');
  /* and the rule, case by case */
  let s = base(); s.duel = { active: true, over: false, player: { name: 'Jovan' }, opp: { name: 'Renji' } }; mergeSeed(s, answer([]), { shown: harmShown(s) });
  eq(names(s), 'cracked rib, masterwork blade', 'under a live fight the referee’s line is the referee’s');
  s = base(); s = applyMutations(s, [{ type: 'body.injure', name: 'Jovan', what: 'two cracked ribs on the left side', sev: 2 }]).state; mergeSeed(s, answer([]), { shown: harmShown(s) });
  eq(names(s), 'cracked rib, masterwork blade', 'the bodies still carry it unhealed: it stays');
  s = base(); mergeSeed(s, answer([]));
  eq(names(s), 'cracked rib, masterwork blade', 'a merge told nothing of what was shown judges nothing (M345-3’s heal, as before)');
});

test('M681-36 A MOOD BOARD NO READER STATED FOR THE NEWEST PAGE IS THE AUDITOR’S TO RESTATE (the scene audit’s S13): a reader that forgot the board twice, or failed, left an older page’s moods standing, and the one reader of the whole ledger had no door to it', async () => {
  const { auditorScope, boardStale, buildAuditorMessages } = await import('../../js/agents/auditor.js');
  const page = '[the inn — Monday | 20:00]\n\nThey had arrived; Mara set her pack down by the hearth.';
  const st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'place.set', name: 'the inn' }, { type: 'mode.snapshot', flags: ['travel'] }]).state;
  st.moodAt = 3; /* the reader of page 4 (index 3) stated the board; page 5 (index 4)'s did not */
  const issue = [{ what: 'still marked as travelling — they arrived', fix: 'clear travel', mutations: [{ type: 'mode.snapshot', flags: ['group'] }] }];
  eq(auditorScope(issue, st, { page, pageAt: 4 }).length, 1, 'its restated board lands');
  eq(boardStale(st, 4), true, 'stale: stated for an older page');
  eq(applyMutations(st, auditorScope(issue, st, { page, pageAt: 4 })[0].mutations).state.mode.travel, false, 'and travel is off');
  eq(auditorScope(issue, { ...st, moodAt: 4 }, { page, pageAt: 4 }).length, 0, 'the board its reader stated for this page is the reader’s alone (M47)');
  const written = applyMutations({ ...st, page: 4 }, [{ type: 'mode.snapshot', flags: ['group'] }]).state;
  eq(auditorScope(issue, written, { page, pageAt: 4 }).length, 0, 'nor one its readers wrote on this page');
  eq(auditorScope(issue, { ...st, moodAt: undefined }, { page, pageAt: 4 }).length, 0, 'a ledger that never marked it: as before');
  eq(auditorScope(issue, st).length, 0, 'no page in hand: as before');
  assert(/THE MOOD BOARD IS STALE/.test(buildAuditorMessages({ state: st, pages: [{ role: 'assistant', text: page }], staleBoard: true }).user), 'the auditor is told when the board is its');
  assert(!/THE MOOD BOARD IS STALE/.test(buildAuditorMessages({ state: st, pages: [{ role: 'assistant', text: page }] }).user), 'and only then');
});

/* ---------- the books audit (M680's B1–B10), laws M681-70 … M681-89 ---------- */
/* a wire that answers from a script — one answer per call (the last repeats), each with the finish reason it names; both shapes */
function scripted(answers) {
  const calls = [];
  const fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const a = typeof answers === 'function' ? await answers(body, calls.length) : answers[Math.min(calls.length - 1, answers.length - 1)];
    const text = typeof a === 'string' ? a : a.text;
    const finish = typeof a === 'string' ? 'stop' : (a.finish || 'stop');
    if (body.stream) {
      const t = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) + '\n\ndata: [DONE]\n\n';
      return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(t)); c.close(); } }), async json() { return {}; }, async text() { return t; }, clone() { return this; } };
    }
    const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: finish }] };
    return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
  };
  return { calls, fetch };
}
const onWire = async (house, fn) => { const prior = globalThis.fetch; globalThis.fetch = house.fetch; try { return await fn(); } finally { globalThis.fetch = prior; } };
const lastUser = (body) => String(((body.messages || []).slice(-1)[0] || {}).content || '');
const KEEPER_CONN = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };

test('M681-70 A BELIEF GOES WHEN THE TRUTH IS LEARNED (the books audit’s B3): “believes Orrin Vale is only a recruit — untrue: …” stood beside “learned Orrin Vale is the new captain”, and the storyteller was told every page that she knew the one and believed the other', async () => {
  const { renderStateFacts } = await import('../../js/engine/state.js');
  let st = here({ ...emptyState(), page: 3 }, 'Kiyone', 'Rias');
  st = applyMutations(st, [
    { type: 'knowledge.add', name: 'Kiyone', fact: 'believes Orrin Vale is only a recruit — untrue: Orrin Vale is the new captain of the guard' },
    { type: 'knowledge.add', name: 'Kiyone', fact: 'believes the duke is in the capital — untrue: the duke rode for the border at dawn' },
  ]).state;
  const out = applyMutations({ ...st, page: 9 }, [{ type: 'knowledge.add', name: 'Kiyone', fact: 'learned Orrin Vale is the new captain, not a recruit — he had told them otherwise' }]);
  const facts = out.state.knowledge.Kiyone.map((k) => k.fact);
  assert(!facts.some((f) => /only a recruit — untrue/.test(f)), 'the belief the truth answers goes: ' + JSON.stringify(facts));
  assert(facts.some((f) => /duke is in the capital/.test(f)), 'a belief it does not answer stands');
  assert(facts.some((f) => /^learned Orrin Vale is the new captain/.test(f)), 'and the truth is written');
  eq(out.applied.length, 1, 'the write landed');
  assert(!/believes: Orrin Vale is only a recruit/.test(renderStateFacts(out.state)), 'the storyteller is not told she believes it');
  const { beliefAnswered } = await import('../../js/engine/world.js');
  eq(beliefAnswered('believes Kiba is a boy — untrue: Kiba is a girl', 'learned Kiba is a girl, not a boy'), true, 'a short truth, said, answers it');
  eq(beliefAnswered('believes Kiba is a boy (untrue: Kiba is a girl)', 'Kiba is a girl'), true, 'in brackets too, and without “learned”');
  eq(beliefAnswered('believes Kiba is a boy — untrue: Kiba is a girl', 'learned Kiba likes tea'), false, 'another fact about him does not');
  eq(beliefAnswered('believes Kiba is a boy — untrue: Kiba is a girl', 'believes Kiba is a girl'), false, 'nor another belief');
  /* a later page's own belief, laid down beside a truth learned before it, is not touched by this rule (only learning answers a belief) */
  const back = applyMutations({ ...out.state, page: 12 }, [{ type: 'knowledge.add', name: 'Kiyone', fact: 'believes the vault is empty — untrue: the gold was moved to the vault' }]).state;
  assert(back.knowledge.Kiyone.some((k) => /vault is empty/.test(k.fact)), 'a new belief is written');
});

test('M681-71 THE SECOND READER IS SHOWN HIS OWN DRESS AND PLACE (the books audit’s B7): told to warn when the header’s attire or position for the main character disagrees with the ledger, it was shown no attire or position at all — his were stripped with everyone’s', async () => {
  const { buildContinuityMessages } = await import('../../js/agents/continuity.js');
  const st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Wells kitchen' },
    { type: 'presence.enter', name: 'Jovan', attire: 'black shihakushō', position: 'at the kitchen table' },
    { type: 'presence.enter', name: 'Rias', attire: 'flip-flops kicked off', position: 'at the stove counter' }]).state;
  const PAGE = '[The Wells kitchen — Friday | 21:10 | rain | grey hoodie | by the door]\n\nThe rain went on. Rias stirred the pot.';
  const u = buildContinuityMessages({ state: st, assistantText: PAGE }).user;
  assert(/black shihakushō/.test(u) && /at the kitchen table/.test(u), 'his attire and position as the ledger held them are shown: ' + u.slice(0, 900));
  assert(/THE HEADER LINE only/.test(u), 'for the header alone');
  assert(!/flip-flops|stove counter/.test(u), 'and nobody else’s (M267 stands)');
  /* no main character in the room: no such line */
  const none = buildContinuityMessages({ state: applyMutations({ ...emptyState() }, [{ type: 'presence.enter', name: 'Rias', attire: 'flip-flops', position: 'at the stove' }]).state, assistantText: PAGE }).user;
  assert(!/THE MAIN CHARACTER AS THE LEDGER HELD HIM/.test(none), 'nothing to show, nothing shown');
});

test('M681-72 THE WHOLE ANSWER TO THE KEEPER’S RE-ASK IS KEPT (the books audit’s B10): a line the wire cut was asked for again; the whole answer was thrown away for having more phrases than what was left of the cut one, and — the re-ask having come back whole — the cut line was stored as a finished line', async () => {
  const { maybeSummarize, loadMemory, saveMemory } = await import('../../js/agents/memory.js');
  const st = await db.stories.create({ title: 'a keeper cut by the wire' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i + ': Jovan and Rias walked the pier.' });
  await db.settings.set('memoryWindow', 20); await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });
  const CUT = 'Jovan arrived at the pier; Rias met him there; they walked toward the';
  const WHOLE = 'Jovan arrived at the pier; Rias met him there; they walked to the inn; Rias paid the keeper; Jovan took the room upstairs';
  const house = scripted((body, n) => (n === 1 ? { text: CUT, finish: 'length' } : /ran past the limit and had to be CUT/.test(lastUser(body)) ? WHOLE : 'Jovan and Rias walked the pier'));
  try {
    await onWire(house, () => maybeSummarize({ connection: { ...KEEPER_CONN }, storyId: st.id, stale: () => false, renew: () => true }));
  } finally { await db.settings.delete('memoryWindow'); await db.settings.delete('memoryBatch'); }
  assert(house.calls.some((b) => /ran past the limit/.test(lastUser(b))), 'fixture: the cut line was asked for again');
  const first = (await loadMemory(st.id)).nodes.find((n) => n.span[0] === 0);
  eq(first && first.text, WHOLE, 'the whole answer is the line, never the cut one');
});

test('M681-73 THE WHOLE ANSWER TO THE SCRIBE’S RE-ASK IS KEPT (the same fault, the scribe): asked again for “the changes that matter most”, its whole answer was shorter than what had arrived of the cut one and was thrown away by that count — the note said “ok” over the cut answer', async () => {
  const { scribeTurn } = await import('../../js/agents/scribe.js');
  const sid = 'm681-scribe-cut';
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st.characters = { Mira: { core: 'the innkeeper', state: 'behind the bar', arc: '', threads: [], updatedAtTurn: 0 }, Rias: { core: 'a regular', state: 'at a table', arc: '', threads: [], updatedAtTurn: 0 } };
  st = here(st, 'Mira', 'Rias');
  await saveState(sid, st);
  const house = scripted([
    { text: '{"deltas":[{"name":"Mira","field":"state","text":"wiping the bar"},{"name":"Mira","field":"arc","text":"she has forgiven Rias"},{"name":"Rias","field":"state","text":"by the window, waiting"},{"name":"Rias","field":"ar', finish: 'length' },
    '{"deltas":[{"name":"Mira","field":"state","text":"in the cellar, counting casks"},{"name":"Rias","field":"arc","text":"she means to leave town at dawn"}]}',
  ]);
  const r = await onWire(house, () => scribeTurn({ connection: { type: 'openai', baseUrl: 'https://custom.example/v1', apiKey: 'k', model: 'm', preset: 'custom' }, storyId: sid, userText: 'I wait.', assistantText: 'Mira went down to the cellar. Rias said she would leave at dawn.', stale: () => false }));
  eq(house.calls.length, 2, 'fixture: the cut answer was asked for again');
  const after = await loadState(sid);
  eq(after.characters.Mira.state, 'in the cellar, counting casks', 'the whole answer’s own words stand');
  assert(/leave town at dawn/.test(after.characters.Rias.arc || ''), 'every note of the whole answer is written: ' + JSON.stringify(after.characters.Rias));
  assert(/forgiven Rias/.test(after.characters.Mira.arc || ''), 'and a note of the cut one that arrived whole and speaks of what the whole one does not, stays');
  eq(r.note, 'ok', 'the note says what happened');
});

test('M681-74 A PAGE COVERED WITHOUT WORDS IS ASKED AGAIN (the books audit’s B4): a provider answering long asks with nothing for a while — and the one-word question in between — covered a page for good: no line was ever asked for it again, and “Summarize now” found nothing due', async () => {
  const { maybeSummarize, loadMemory, COVER_TRIES } = await import('../../js/agents/memory.js');
  await db.settings.set('memoryWindow', 4); await db.settings.set('memoryBatch', 6);
  const st = await db.stories.create({ title: 'a streak that passed' });
  for (let i = 0; i < 20; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'Page ' + i + ': Jovan and Liara talked on the porch about the letter and the fair. ' + 'The street went quiet. '.repeat(6) });
  let down = true; let refuses = '';
  const LINE = 'Jovan and Liara talked on the porch; the street went quiet; she asked him to stay for the fair.';
  const house = scripted((body) => {
    const u = lastUser(body);
    if (/single word: ready/.test(u)) return 'ready';
    if (down || (refuses && u.includes(refuses))) return '';
    return LINE;
  });
  const run = () => onWire(house, () => maybeSummarize({ connection: { ...KEEPER_CONN }, storyId: st.id, stale: () => false, renew: () => true }));
  try {
    await run(); await run(); /* the streak: page 0 gives nothing on two runs; the one-word question is answered */
    const cover = (await loadMemory(st.id)).nodes.find((n) => n.span[0] === 0);
    assert(cover && cover.byHouse === true && cover.text === '', 'fixture: the page was covered without words: ' + JSON.stringify(cover));
    down = false; /* the streak passes */
    for (let i = 0; i < 3; i += 1) await run();
    const now = (await loadMemory(st.id)).nodes.find((n) => n.span[0] === 0);
    assert(now && now.text === LINE && !now.empty, 'the page has its line now: ' + JSON.stringify(now));
    assert(!now.byHouse, 'and the cover’s mark is gone (an opening of the tale took the words of a marked line away)');
    /* a page its model truly will not summarise is asked COVER_TRIES times more, then left */
    const st2 = await db.stories.create({ title: 'a page it will not touch' });
    for (let i = 0; i < 20; i += 1) await db.messages.append(st2.id, { role: i % 2 ? 'assistant' : 'user', text: (i === 1 ? 'THE FORBIDDEN PAGE. ' : '') + 'Page ' + i + ': Jovan and Liara talked on the porch about the letter and the fair. ' + 'The street went quiet. '.repeat(6) });
    refuses = 'THE FORBIDDEN PAGE';
    const run2 = () => onWire(house, () => maybeSummarize({ connection: { ...KEEPER_CONN }, storyId: st2.id, stale: () => false, renew: () => true }));
    for (let i = 0; i < 4 + COVER_TRIES; i += 1) await run2();
    const asksAt = house.calls.length;
    await run2(); await run2();
    const covered = (await loadMemory(st2.id)).nodes.find((n) => n.span[0] === 1);
    assert(covered && covered.byHouse === true && covered.healTries === COVER_TRIES, 'still covered, asked ' + COVER_TRIES + ' times more: ' + JSON.stringify(covered));
    assert(!house.calls.slice(asksAt).some((b) => lastUser(b).includes('THE FORBIDDEN PAGE')), 'and then left alone');
  } finally { await db.settings.delete('memoryWindow'); await db.settings.delete('memoryBatch'); }
});

test('M681-75 THE PLANS KEEPER MOVES WITH A PAGE THAT LEAVES OR COMES BACK (the books audit’s B2): a page let go or folded away moved every page after it down one — the keeper took back the NEWEST page’s plans and kept the gone page’s; a page brought back was never read', async () => {
  const { runPlans, loadPlansBook, pageLeft, pageCameBack } = await import('../../js/agents/plans.js');
  const sid = 'm681-plans-shift';
  const TEXT = ['I wait.', 'The night raid: Renji draws the guards off at midnight, Rukia opens the gate on the bell.', 'I nod.', 'They eat.', 'I ask about the feast.', 'The feast: Momo bakes the cake at dawn.', 'I go.', 'The signal: Kira lights the beacon when the ships come.'];
  const all = TEXT.map((text, i) => ({ id: 'p' + i, text }));
  const pagesOf = (list) => list.map((p, i) => ({ n: i + 1, who: i % 2 ? 'the storyteller' : 'the writer', text: p.text }));
  const plan = (title, page, who) => ({ title, by: who, page, goal: title, parts: [{ who, does: 'does it', when: 'then' }] });
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages: pagesOf(all), callLLM: async () => JSON.stringify({ new: [plan('the night raid', 2, 'Rukia'), plan('the feast', 6, 'Momo'), plan('the signal', 8, 'Kira')], progress: [], closed: [] }) });
  const fromOf = async () => Object.fromEntries((await loadPlansBook(sid)).plans.map((p) => [p.title, p.from]));
  eq(JSON.stringify(await fromOf()), JSON.stringify({ 'the night raid': 1, 'the feast': 5, 'the signal': 7 }), 'fixture: three plans');
  /* the page that laid out the raid leaves (index 1) */
  const less = all.filter((p) => p.id !== 'p1');
  await pageLeft(sid, 1);
  eq(JSON.stringify(await fromOf()), JSON.stringify({ 'the feast': 4, 'the signal': 6 }), 'the gone page’s plan goes; the later ones move down one');
  let asked = 0;
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages: pagesOf(less), callLLM: async () => { asked += 1; return '{"new":[],"progress":[],"closed":[]}'; } });
  eq(asked, 0, 'nothing is owed a reading');
  eq(JSON.stringify(await fromOf()), JSON.stringify({ 'the feast': 4, 'the signal': 6 }), 'and the newest page’s plan stands (it was taken back as if gone)');
  /* it comes back */
  await pageCameBack(sid, 1);
  eq((await loadPlansBook(sid)).readTo, 7, 'the mark moves up with it');
  const read = [];
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages: pagesOf(all), callLLM: async (c, { user }) => { read.push(user); return JSON.stringify({ new: [plan('the night raid', 2, 'Rukia')], progress: [], closed: [] }); } });
  eq(read.length, 1, 'one reading'); assert(/night raid/.test(read[0]) && !/feast|signal/.test(read[0].split('The pages to read')[1] || ''), 'of the page that came back, alone');
  eq(JSON.stringify(await fromOf()), JSON.stringify({ 'the feast': 5, 'the signal': 7, 'the night raid': 1 }), 'every plan where its page stands');
  /* the newest page read leaves: its plan goes, and nothing else is read again */
  await pageLeft(sid, 7);
  let again = 0;
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages: pagesOf(all.slice(0, 7)), callLLM: async () => { again += 1; return '{"new":[],"progress":[],"closed":[]}'; } });
  eq(again, 0, 'no reading owed'); eq(JSON.stringify(await fromOf()), JSON.stringify({ 'the feast': 5, 'the night raid': 1 }), 'the newest page’s plan goes with it');
});

test('M681-76 THE RECORD MOVES WITH A PAGE THAT COMES BACK (the books audit’s B2): the lines after it move up one; a line it comes back inside goes for the keeper to fold again — unless it is his, or no keeper folds again, and then it stays over its pages and the one back', async () => {
  const { memoryAfterInsertion, memoryAfterDeletion } = await import('../../js/agents/memory.js');
  const HIS = { id: 'his', span: [0, 3], text: 'his', verified: { fixed: 'the writer' } };
  const mem = { nodes: [HIS, { id: 'k2', span: [4, 7], text: 'k2', audited: 4 }, { id: 'k3', span: [8, 11], text: 'k3' }] };
  const show = (m) => m.nodes.map((n) => n.id + ' ' + n.span.join('–') + (n.audited !== undefined ? ' a' + n.audited : '')).join(' | ');
  eq(show(memoryAfterInsertion(mem, 6)), 'his 0–3 | k3 9–12', 'the keeper’s line it came back inside goes; the line after it moves up');
  eq(show(memoryAfterInsertion(mem, 6, { keepCovering: () => true })), 'his 0–3 | k2 4–8 a2 | k3 9–12', 'with no keeper, it stays over its pages and the one back (read no further than it)');
  eq(show(memoryAfterInsertion(mem, 2)), 'his 0–4 | k2 5–8 a4 | k3 9–12', 'his own line stays over its pages and the one back');
  eq(show(memoryAfterInsertion(mem, 4)), 'his 0–3 | k2 5–8 a4 | k3 9–12', 'a page back at a line’s first page moves the line, whole');
  eq(show(memoryAfterInsertion(memoryAfterDeletion(mem, 6, { keepCovering: () => true }), 6, { keepCovering: () => true })), 'his 0–3 | k2 4–7 a2 | k3 8–11', 'folded away and brought back: every line over its own pages again');
});

test('M681-77 THE HOUSEKEEPER SAYS WHICH PAGES IT FOLDED AWAY OR BROUGHT BACK (the books audit’s B2): its fold changed the page’s `hidden` and reported nothing, so nothing the house keeps of the story moved with it — its card, “Apply all”, and its take-back say so now', async () => {
  const { stageProposals, applyProposal, applyAllPending, undoLatest } = await import('../../js/agents/housekeeper.js');
  const story = await db.stories.create({ title: 'folded away' });
  await db.messages.append(story.id, { role: 'user', text: 'Mira came in.' });
  const a = await db.messages.append(story.id, { role: 'assistant', text: 'Mira sat down by the fire.' });
  await db.messages.append(story.id, { role: 'user', text: 'I wait.' });
  const session = { turns: [], batches: [] };
  const stage = async (edits) => { const cards = stageProposals({ edits, ledits: [], redits: [] }, { messages: await db.messages.list(story.id), state: await loadState(story.id), modules: [] }); session.turns.push({ role: 'housekeeper', text: 'cards', ts: Date.now(), proposals: cards }); return cards; };
  const [hide] = await stage([{ id: '#' + a.id.slice(0, 6), hide: true, reason: 'let it rest' }]);
  const r = await applyProposal(session, story.id, hide.id);
  assert(r.ok, 'fixture: folded away — ' + r.words);
  eq(JSON.stringify(r.folded), JSON.stringify([{ messageId: a.id, hidden: true }]), 'the card says the page left the story');
  const back = await undoLatest(session, story.id);
  assert(back.ok, 'fixture: taken back');
  eq(JSON.stringify(back.folded), JSON.stringify([{ messageId: a.id, hidden: false }]), 'its take-back says the page came back');
  await stage([{ id: '#' + a.id.slice(0, 6), hide: true, reason: 'let it rest' }]);
  const all = await applyAllPending(session, story.id);
  eq(JSON.stringify(all.folded), JSON.stringify([{ messageId: a.id, hidden: true }]), '“Apply all” says it too');
});

test('M681-78 EVERY DOOR THAT CHANGES A PAGE’S WORDS TELLS THE PLANS KEEPER (B1’s pattern, here: a mistaken mend put back by the house): the words came back and the plans keeper kept the plan as the mended words had it', async () => {
  const { putBackMistakenMends } = await import('../../js/agents/memory.js');
  const { PLANS_KEY, loadPlansBook, runPlans } = await import('../../js/agents/plans.js');
  const { fingerprint36 } = await import('../../js/engine/fingerprint.js');
  const st = await db.stories.create({ title: 'a mend put back' });
  await db.messages.append(st.id, { role: 'user', text: 'I listen.' });
  const a = await db.messages.append(st.id, { role: 'assistant', text: 'The raid: Kris opens the gate on the bell.' });
  await db.messages.update(st.id, a.id, { mended: { before: 'The raid: Kim opens the gate on the bell.', why: 'Snippet says Kris, but the passage says Kim', at: 1 } });
  await db.messages.append(st.id, { role: 'user', text: 'I nod.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'They wait for the bell.' });
  const raid = (who) => ({ title: 'the raid', by: who, goal: 'the gate', parts: [{ who, does: 'opens the gate', when: 'on the bell' }] });
  await db.settings.set(PLANS_KEY(st.id), { plans: [{ ...raid('Kris'), parts: [{ who: 'Kris', does: 'opens the gate', when: 'on the bell', done: false }], words: [], status: 'standing', from: 1, to: 1, at: 1 }], readTo: 3, readHash: fingerprint36('They wait for the bell.') });
  eq((await putBackMistakenMends(st.id)).length, 1, 'fixture: the mistaken mend is put back');
  const book = await loadPlansBook(st.id);
  eq(book.again.join(','), '1', 'the page is owed its reading again');
  const read = [];
  const pages = (await db.messages.list(st.id)).map((m, i) => ({ n: i + 1, who: m.role === 'user' ? 'the writer' : 'the storyteller', text: m.text }));
  await runPlans({ connection: { id: 'c' }, storyId: st.id, pages, callLLM: async (c, { user }) => { read.push(user); return JSON.stringify({ new: [{ ...raid('Kim'), page: 2 }], progress: [], closed: [] }); } });
  assert(read.length === 1 && /Kim opens the gate/.test(read[0]), 'read again, from the words put back');
  eq((await loadPlansBook(st.id)).plans.map((p) => p.parts[0].who).join(','), 'Kim', 'the plan as the page says it');
});

test('M681-44 THEIR OWN WORDS ARE READ THROUGH HIS STORY TOO (P8’s same fault, Canon Grounding v0.68.2): the dossier’s quotes rode the note’s Voice line unjudged — “As captain of the 13th, I will not yield” in a story where she never became captain', async () => {
  const { canonBeforeSend } = await import('../../js/canon/bridge.js');
  const RUKIA = () => ({ name: 'Rukia Kuchiki', found: true, kind: 'character', wiki: 'bleach', aliases: ['Rukia'], ts: 1,
    sections: { identity: 'Rukia Kuchiki is a Shinigami of the Gotei 13.' },
    dossier: { identity: 'A Shinigami of the Gotei 13', brief: 'A dutiful Shinigami.', facts: ['Wields Sode no Shirayuki'], secrets: [], dynamics: {}, abilities: [], related: [], voice: ['As captain of the 13th, I will not yield.', 'Idiot! Get up.'] } });
  const house = m681CanonHouse({ judge: (t) => (/captain/i.test(t) ? 'later' : 'holds') });
  try {
    const story = await m681CanonStory('Oda of the 13th, her words', 'A Bleach story after the war. Oda is the new captain of the 13th Division; Rukia Kuchiki is his lieutenant.', {
      canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: 'x', fp: '(manual)', manual: true, ts: 1 }, canon_grounding_cache: { rukia: RUKIA() } });
    const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'presence.enter', name: 'Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
    await saveState(story.id, state);
    const note = await canonBeforeSend({ story, state, messages: [{ id: 'u1', role: 'user', text: 'I hand Rukia the duty roster.' }], connection: M681_CONN });
    assert(house.asks.lens.length === 1 && house.asks.lens[0].some((s) => /As captain of the 13th/.test(s)), 'her quotes are among what the lens judges: ' + JSON.stringify(house.asks.lens));
    assert(/Get up/.test(note), 'a quote that holds is still her voice: ' + note);
    assert(!/As captain of the 13th/.test(note), 'a quote from a captaincy his story never gave her is not: ' + note);
  } finally { house.restore(); }
});

test('M681-45 THE NEXT PAGE’S JUMP IS MEASURED FROM WHERE THE LAST PAGE ENDED (S9): a page headed 09:30 whose reader said it ran five hours, then a page headed 14:40 — the house read a five-hour jump and let every place in the room and every outfit go, though ten minutes had passed', async () => {
  const { readerTimeOverHeader, staleAfterJump, clockReached } = await import('../../js/engine/apply.js'); /* (clockReached is new in M681-2) */
  const land = (st, header, reader) => {
    const h = headerMutations(page(header), { ground: (st.place || {}).name || '', day: (st.clock && st.clock.dayWords) || '' });
    const timed = readerTimeOverHeader(h, reader);
    return { st: applyMutations(st, [...timed.header, ...staleAfterJump(st, timed.header), ...timed.reader]).state, letGo: staleAfterJump(st, timed.header) };
  };
  let st = land({ ...emptyState() }, 'the yard — Monday | 09:30', []).st; /* the ground first: a change of ground lets every place go */
  st = applyMutations(st, [{ type: 'presence.enter', name: 'Kim', position: 'at the stables', attire: 'riding clothes' }]).state;
  st = land(st, 'the yard — Monday | 09:30', [{ type: 'clock.advance', minutes: 300, reason: 'the long ride out and back' }]).st;
  eq(st.clock.minutes % 1440, 9 * 60 + 30, 'the clock is the header’s hour, as ever');
  const next = land(st, 'the yard — Monday | 14:40', []);
  eq(next.letGo.length, 0, 'ten minutes after the page ended: nobody’s place or dress is let go');
  eq(next.st.present[0].position, 'at the stables', 'Kim is where the page left her');
  eq(clockReached(st.clock) % 1440, 14 * 60 + 30, 'the page’s span stands beside the hour');
  /* the open heal sets the same hour again with no span: the span stands */
  eq(clockReached(applyMutations(st, [{ type: 'clock.set', hour: 9, minute: 30 }]).state.clock) % 1440, 14 * 60 + 30, 'the same hour set again keeps the span');
  /* a real jump is still a jump */
  eq(land(st, 'the yard — Monday | 23:00', []).letGo.length, 1, 'eight and a half hours on: let go, as before');
});
