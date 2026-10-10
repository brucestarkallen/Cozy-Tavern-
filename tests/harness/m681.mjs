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
