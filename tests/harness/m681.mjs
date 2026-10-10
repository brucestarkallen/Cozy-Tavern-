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
