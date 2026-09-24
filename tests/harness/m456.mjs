/* M456: only someone on their way has an arrival. Rukia sat at her desk in the 13th's barracks, "unresolved tension with
 * the main character, due now", for scene after scene — an arrival nothing would bring. Runs the real engine and the
 * storyteller's own request. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { renderOffscreen } from '../../js/engine/offscreen.js';
import { buildRequest } from '../../js/assemble/stack.js';

const RUKIA = { location: '13th Division barracks, her office desk', activity: 'pulling the roster and every order signed through Shunsui’s office', agenda: 'find the exact wording of Jovan’s placement before the courtyard fight ends' };
const base = () => applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'Tenth Division Courtyard' },
  { type: 'clock.set', hour: 9, minute: 20, dayWords: 'Sunday, Hanami 5, 1001 AG' }, { type: 'presence.enter', name: 'Jovan Oda' }]).state;

test('M456-1 A STANCE THAT STAYS PUT CARRIES NO ARRIVAL — "tense" with an ETA is seated without one; "toward", "seeking" and a seat with no stance keep theirs (M29)', () => {
  const st = applyMutations(base(), [{ type: 'offscreen.set', name: 'Rukia Kuchiki', ...RUKIA, stance: 'tense', etaMinutes: 0 },
    { type: 'offscreen.set', name: 'Byakuya Kuchiki', location: '6th Division office', activity: 'signing', etaMinutes: 20 },
    { type: 'offscreen.set', name: 'Shunsui Kyōraku', location: 'the road from the 1st', activity: 'walking', stance: 'toward', etaMinutes: 25 },
    { type: 'offscreen.set', name: 'Renji Abarai', location: 'the western gate', activity: 'asking after him', stance: 'seeking', etaMinutes: 40 }]).state;
  assert(!Number.isFinite(st.offscreen['Rukia Kuchiki'].arrivesAtMinutes), 'tension carries no arrival');
  assert(Number.isFinite(st.offscreen['Byakuya Kuchiki'].arrivesAtMinutes), 'a seat with no stance keeps its ETA, as M29 always had it');
  assert(Number.isFinite(st.offscreen['Shunsui Kyōraku'].arrivesAtMinutes) && Number.isFinite(st.offscreen['Renji Abarai'].arrivesAtMinutes), 'the ones on their way keep it');
  const said = renderOffscreen(st.offscreen, st.present, st.clock.minutes);
  assert(/Kyōraku — [^\n]*arriving in about 25 minutes/.test(said) && /Rukia Kuchiki — [^\n]*unresolved tension with the main character/.test(said) && !/Rukia[^\n]*due now/.test(said), said);
});

test('M456-2 HER SEAT AS HIS LEDGER HOLDS IT (stored with an arrival) — the storyteller is never told "due now" of her; the tension stands', () => {
  const st = base();
  st.offscreen = { 'Rukia Kuchiki': { ...RUKIA, stance: 'tense', arrivesAtMinutes: st.clock.minutes, sinceMinutes: st.clock.minutes - 20, atTurn: 4 } };
  const r = buildRequest({ story: { brief: 'A Bleach story.' }, messages: [{ role: 'user', content: 'I draw.' }], settings: { noteText: '' }, state: st, modules: [], memory: '', window: { keeperOn: false } });
  const all = r.messages.map((m) => String(m.content)).join('\n');
  const line = (all.match(/Rukia Kuchiki — [^\n]*/) || [''])[0];
  assert(/unresolved tension with the main character/.test(line), 'the tension is said: ' + line);
  assert(!/due now|arriving in|overdue/.test(line), 'and no arrival: ' + line);
});
