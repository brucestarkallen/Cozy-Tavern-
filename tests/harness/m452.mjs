/* M452: the house heals who is here by itself, from the newest page — no button, no model. His stuck ledger (Rukia "last
 * seen" at the very office she stands in, from an earlier page) is mended the moment the story opens, and after every
 * page. Runs the real engine. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations, hereByTheNewestPage } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';

const ROOM = "13th Division Barracks — Captain's Office";
const stuck = () => {
  const st = applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: ROOM },
    ...['Jovan Oda', 'Rukia Kuchiki', 'Byakuya Kuchiki'].map((n) => ({ type: 'presence.enter', name: n })),
    { type: 'presence.leave', name: 'Rukia Kuchiki' }]).state; /* the old reader's leave: "last seen" at the office */
  st.characters = { 'Rukia Kuchiki': { core: 'His lieutenant.' }, 'Byakuya Kuchiki': { core: 'Captain of the 6th.' }, 'Renji Abarai': { core: 'Lieutenant of the 6th.' } };
  return st;
};
const PAGE = "[13th Division Barracks — Captain's Office]\n\nRukia set the rosters on Oda’s desk while Byakuya read by the window.";

test('M452-1 SOMEONE "LAST SEEN" AT THE VERY PLACE THE SCENE STANDS, WHOM THE NEWEST PAGE SHOWS THERE, IS HERE — written in, the note let go, and it says why', () => {
  const st = stuck();
  assert(st.offscreen['Rukia Kuchiki'] && st.offscreen['Rukia Kuchiki'].lastSeen, 'the stuck state');
  const muts = hereByTheNewestPage(st, PAGE);
  eq(muts.map((m) => m.name).join(), 'Rukia Kuchiki', 'she is named back in');
  const after = applyMutations(st, muts).state;
  assert(after.present.some((p) => p.name === 'Rukia Kuchiki') && !after.offscreen['Rukia Kuchiki'], 'here, and nowhere else');
  assert(after.log.some((e) => /Rukia Kuchiki came into the scene — the page shows them here/.test(e.words)), 'said in What changed and why');
  eq(hereByTheNewestPage(after, PAGE).length, 0, 'and nothing more to do');
});

test('M452-2 NEVER ON LESS: a page that does not name her, names her only in a spoken line or by the family name another shares, ends on her going, or a note at another place — each left as it is; someone on their way in stays on the road', () => {
  const st = stuck();
  eq(hereByTheNewestPage(st, 'Byakuya read by the window.').length, 0, 'not named');
  eq(hereByTheNewestPage(st, 'Byakuya said, “Rukia will be back soon.”').length, 0, 'only in a spoken line');
  eq(hereByTheNewestPage(st, 'Kuchiki-taichō read by the window.').length, 0, 'only by the family name another shares');
  eq(hereByTheNewestPage(st, 'Rukia set the rosters down, bowed, and left the office.').length, 0, 'the page ends on her going');
  const elsewhere = { ...st, offscreen: { 'Rukia Kuchiki': { location: '13th Division Barracks — her own office', activity: 'filing', stance: 'busy' } } };
  eq(hereByTheNewestPage(elsewhere, PAGE).length, 0, 'a note at another room is the page reader’s to judge, never this code’s');
  const coming = { ...st, offscreen: { 'Renji Abarai': { location: ROOM, activity: 'on his way with the reports', stance: 'toward', arrivesAtMinutes: 60 } } };
  eq(hereByTheNewestPage(coming, 'Renji Abarai was on his way.').length, 0, 'on the way in: left on the road');
});
