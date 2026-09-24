/* M455: the header's hour is the hour on any calendar, and the clock speaks the story's own day. His header
 * "[Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:20 | …]" set no clock (only a real month's date could), so
 * the reader guessed — a page behind (09:19) and on another calendar ("Thursday, March 5, 1001"). Runs the real engine. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { headerMutations, emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { renderClock } from '../../js/engine/clock.js';

const H = (t) => headerMutations(t + '\n\nZaraki grinned.');
const clockOf = (t) => H(t).filter((m) => m.type === 'clock.set');

test('M455-1 HIS HEADER SETS THE HOUR AND THE DAY IN ITS OWN WORDS — a date-only header on his calendar is no place; real dates and "Sunday Market" as before', () => {
  eq(JSON.stringify(H('[Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:20 | blinding spring sun, drifting sand | black shihakushō]')),
    JSON.stringify([{ type: 'place.set', name: 'Tenth Division Courtyard' }, { type: 'clock.set', hour: 9, minute: 20, dayWords: 'Sunday, Hanami 5, 1001 AG' }]), 'his header');
  assert(!H('[Sunday, Hanami 5, 1001 AG | 09:20]').some((m) => m.type === 'place.set'), 'a day is never the ground');
  eq(H('[Sunday Market | 09:20]')[0].name, 'Sunday Market', 'a market named for a day stays a place');
  eq(JSON.stringify(clockOf('[Tenth Division Courtyard — Monday, June 1, 2026 | 09:20]')), JSON.stringify([{ type: 'clock.set', year: 2026, month: 6, day: 1, hour: 9, minute: 20 }]), 'a real date as it always was');
});

test('M455-2 HIS LEDGER, A PAGE BEHIND ON ANOTHER CALENDAR, FOLLOWS HIS HEADERS — the same day back and forth, the next day, three days on, and past midnight with no header', () => {
  let st = applyMutations({ ...emptyState() }, [{ type: 'clock.set', year: 1001, month: 3, day: 5, hour: 9, minute: 19 }]).state;
  eq(renderClock(st.clock), 'Thursday, March 5, 1001 — 09:19', 'where his ledger stood');
  const go = (h) => { st = applyMutations(st, clockOf(h)).state; return renderClock(st.clock); };
  eq(go('[Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:20]'), 'Sunday, Hanami 5, 1001 AG — 09:20', 'the page’s hour and day');
  const at920 = st.clock.minutes;
  eq(go('[Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:45]'), 'Sunday, Hanami 5, 1001 AG — 09:45', 'on');
  eq(go('[Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:40]'), 'Sunday, Hanami 5, 1001 AG — 09:40', 'a header behind the clock sets it back');
  eq(go('[13th Division Barracks — Monday, Hanami 6, 1001 AG | 06:10]'), 'Monday, Hanami 6, 1001 AG — 06:10', 'the next day');
  eq(st.clock.minutes - at920, 20 * 60 + 50, 'twenty hours and fifty minutes on');
  eq(go('[13th Division Barracks — Thursday, Hanami 9, 1001 AG | 18:00]'), 'Thursday, Hanami 9, 1001 AG — 18:00', 'three days on');
  st = applyMutations(st, [{ type: 'clock.advance', minutes: 400 }]).state;
  eq(renderClock(st.clock), 'the day after Thursday, Hanami 9, 1001 AG — 00:40', 'past midnight, said honestly');
  eq(go('[13th Division Barracks — Thursday, June 11, 1001 | 07:00]').startsWith('Thursday, June 11, 1001'), true, 'a real date takes the clock back to the real calendar');
});
