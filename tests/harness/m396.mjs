/* M396: nobody is in two places — one matcher for "the same person" in every book (letters folded, first names, canon's
 * other names), a law of every batch that lets go of an elsewhere note for anyone in the scene, no seat where the scene
 * itself is, and an arrival only for someone on their way. Each runs the real engine. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { samePersonName, setAliasSource } from '../../js/engine/names.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { renderOffscreen } from '../../js/engine/offscreen.js';
import { renderArrival } from '../../js/engine/world.js';
import { buildWorldMessages } from '../../js/agents/world.js';

const scene = (present, extra = []) => applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'Tenth Division courtyard — the galleries' }, ...present.map((n) => ({ type: 'presence.enter', name: n })), ...extra]).state;

test('M396-1 THE SAME PERSON, ONE ANSWER: letters folded, a first name, a name cut short, canon’s other name — and never a near miss', () => {
  setAliasSource(() => []);
  eq(samePersonName('Suì-Fēng', 'Sui-Feng'), true, 'Suì-Fēng is Sui-Feng');
  eq(samePersonName('Suì-Fēng', 'sui feng'), true, '…and sui feng');
  eq(samePersonName('Rukia', 'Rukia Kuchiki'), true, 'a first name');
  eq(samePersonName('Rukia Kuchiki', 'Byakuya Kuchiki'), false, 'two Kuchikis are two people');
  eq(samePersonName('Soi Fon', 'Suì-Fēng'), false, 'another romanization is not the same letters…');
  setAliasSource(() => [['Suì-Fēng', 'Soi Fon', 'Shaolin Fēng']]);
  eq(samePersonName('Soi Fon', 'Suì-Fēng'), true, '…but canon knows them as one person');
  eq(samePersonName('Soi Fon', 'Rukia'), false, 'and nobody else');
  setAliasSource(() => []);
});

test('M396-2 NOBODY IS IN TWO PLACES, AFTER EVERY BATCH: whoever is in the scene under any form of their name holds no elsewhere note — his Rukia and Suì-Fēng at the duel are not also in an office and a compound', () => {
  setAliasSource(() => [['Suì-Fēng', 'Soi Fon']]);
  let st = scene(['Jovan Oda']);
  /* the notes the world agent wrote while they were away */
  st = applyMutations(st, [
    { type: 'offscreen.set', name: 'Rukia Kuchiki', location: '13th Division barracks, her office', activity: 'reviewing the roster', stance: 'busy' },
    { type: 'offscreen.set', name: 'Suì-Fēng', location: 'Onmitsukidō compound', activity: 'issuing orders', stance: 'busy' },
    { type: 'offscreen.set', name: 'Mayuri Kurotsuchi', location: '12th Division, his laboratory', activity: 'ordering a profile', stance: 'busy' },
  ]).state;
  eq(Object.keys(st.offscreen).sort().join(), 'Mayuri Kurotsuchi,Rukia Kuchiki,Suì-Fēng', 'three away');
  /* the page shows them at the duel — under the names the page uses */
  st = applyMutations(st, [{ type: 'presence.enter', name: 'Rukia' }, { type: 'presence.enter', name: 'Soi Fon' }]).state;
  eq(Object.keys(st.offscreen).join(), 'Mayuri Kurotsuchi', 'in the scene: no longer elsewhere, under any name');
  assert(st.log.some((e) => /Suì-Fēng/.test(e.words) && /elsewhere/i.test(e.words)), 'said in What changed and why (walking in lets the note go)');
  const back = applyMutations(st, [{ type: 'offscreen.set', name: 'Sui-Feng', location: 'Onmitsukidō compound', activity: 'x', stance: 'busy' }]);
  eq(back.applied.length, 0, 'and cannot be written elsewhere again while she is here');
  /* a ledger that already held both heals on the next change, whatever it is */
  const broken = { ...st, offscreen: { ...st.offscreen, 'Rukia Kuchiki': { location: 'her office', activity: 'x' } } };
  eq(renderOffscreen(broken.offscreen, broken.present, null).includes('Rukia'), false, 'the storyteller is never told she is elsewhere');
  const healed = applyMutations(broken, [{ type: 'canon.lock', name: 'Jovan Oda', key: 'eyes', value: 'grey' }]).state;
  assert(!healed.offscreen['Rukia Kuchiki'], 'healed by the next change');
  assert(healed.log.some((e) => /Rukia Kuchiki is in the scene — the elsewhere note that said otherwise was let go/.test(e.words)), 'and says so');
  setAliasSource(() => []);
});

test('M396-3 NO SEAT WHERE THE SCENE IS; AN ARRIVAL ONLY FOR SOMEONE ON THEIR WAY', () => {
  let st = scene(['Jovan Oda']);
  const r = applyMutations(st, [
    { type: 'offscreen.set', name: 'Rōjūrō Otoribashi', location: 'Tenth Division courtyard, the galleries', activity: 'watching the yard', stance: 'busy' },
    { type: 'offscreen.set', name: 'Tōshirō Hitsugaya', location: 'Tenth Division courtyard, the east gate', activity: 'walking in', stance: 'toward', etaMinutes: 2 },
    { type: 'offscreen.set', name: 'Mayuri Kurotsuchi', location: '12th Division, his laboratory', activity: 'ordering a profile', stance: 'busy', etaMinutes: 0 },
  ]);
  /* M402: someone put where the scene is walks INTO it (a refusal left such a person stuck "elsewhere" at the scene's
   * own ground, where no worker could ever move them on) */
  eq(r.applied.length, 3, 'all three land');
  st = r.state;
  assert(st.present.some((p) => p.name === 'Rōjūrō Otoribashi') && !st.offscreen['Rōjūrō Otoribashi'], 'Rose, at the scene’s own place, is IN the scene — never "elsewhere" there');
  assert(st.offscreen['Tōshirō Hitsugaya'], 'someone on the way to it is');
  const lines = renderOffscreen(st.offscreen, st.present, st.clock && st.clock.minutes);
  assert(!/Mayuri[^\n]*due now/.test(lines), 'no arrival for someone taken up elsewhere: ' + lines);
  eq(renderArrival({ stance: 'busy', arrivesAtMinutes: 600 }, 600), 'busy with their own affairs', 'busy is busy'); /* M416 */
  assert(/due now/.test(renderArrival({ stance: 'toward', arrivesAtMinutes: 600 }, 600)), 'toward, at its hour, is due');
});

test('M396-4 THE WORLD AGENT IS NEVER TOLD TO SEAT SOMEONE STANDING IN THE SCENE', () => {
  setAliasSource(() => [['Suì-Fēng', 'Soi Fon']]);
  const st = scene(['Jovan Oda', 'Soi Fon', 'Rukia']);
  st.characters = { 'Suì-Fēng': { core: 'Captain of the 2nd Division.', state: 'watching', threads: [] }, 'Rukia Kuchiki': { core: 'His lieutenant.', state: 'watching', threads: [] } };
  const msg = buildWorldMessages({ state: st, userText: 'I step into the yard.', assistantText: 'They watch.', brief: 'A Bleach story.', castNames: [] });
  assert(/Suì-Fēng \[in the scene\]/.test(msg.user) && /Rukia Kuchiki \[in the scene\]/.test(msg.user), 'both marked in the scene');
  assert(!/Suì-Fēng \[NO SEAT/.test(msg.user) && !/Rukia Kuchiki \[NO SEAT/.test(msg.user), 'never "seat them"');
  assert(/Nobody is seated where the scene itself is/.test(msg.system), 'the law is said');
  setAliasSource(() => []);
});

test('M404-1 A RANK, A COURTESY OR FAMILY NAME FIRST IS STILL THE SAME PERSON — and nothing more', () => {
  eq(samePersonName('Lieutenant Rukia Kuchiki', 'Rukia Kuchiki'), true, 'a rank');
  eq(samePersonName('Captain Hitsugaya', 'Tōshirō Hitsugaya'), true, 'a rank and a surname');
  eq(samePersonName('Kyōraku-san', 'Shunsui Kyōraku'), true, 'a courtesy');
  eq(samePersonName('Kuchiki Rukia', 'Rukia Kuchiki'), true, 'family name first');
  eq(samePersonName('Rukia Kuchiki', 'Byakuya Kuchiki'), false, 'two Kuchikis are two people');
  eq(samePersonName('Captain', 'Rukia'), false, 'a rank alone is nobody');
});
