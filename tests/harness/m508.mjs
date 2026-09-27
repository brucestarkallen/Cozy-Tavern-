/* M508 — the state of things, leaner and truer: the main character's book is the writer's; a core made of a seat is
 * let go; a blind spot names a long fact in its first words. */
import { test, assert, eq } from './lib.mjs';
import { applyMutations, seatMadeCores } from '../../js/engine/apply.js';
import { emptyState, renderStateFacts } from '../../js/engine/state.js';
import { renderKnowledge, KNOWLEDGE_MC, BLIND_CLIP, renderBlindSpots, blindSpots } from '../../js/engine/world.js';
import { renderPeopleTiers } from '../../js/engine/people.js';

const H = (present) => applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'the courtyard' }, { type: 'presence.enter', name: 'Jovan Oda' }, ...present.map((n) => ({ type: 'presence.enter', name: n }))]).state;

test('M508-1 the main character never stands in "Everyone here but …": a public moment the reader left out of his book is still everyone’s, and his own list is his newest few, nothing older called back', () => {
  let st = H(['Rukia', 'Renji', 'Byakuya', 'Kensei']);
  const fact = 'saw Jovan Oda stop the cut with a bare palm and stab Zaraki in the kidney';
  st = applyMutations(st, ['Rukia', 'Renji', 'Byakuya', 'Kensei'].map((n) => ({ type: 'knowledge.add', name: n, fact })).concat(Array.from({ length: 9 }, (_, i) => ({ type: 'knowledge.add', name: 'Jovan Oda', fact: 'was told thing number ' + i + ' by someone at the rail' })))).state;
  const out = renderKnowledge(st.knowledge, st.present, Infinity, { pages: ['the courtyard and the kidney and the palm'], ignore: ['Jovan Oda'], mc: 'Jovan Oda', turn: 31 });
  assert(/^Everyone here knows: saw Jovan Oda stop the cut/m.test(out), 'everyone, not "everyone but Jovan Oda": ' + out);
  assert(!/but Jovan Oda/.test(out), out);
  const his = out.split('\n').find((l) => l.startsWith('Jovan Oda knows'));
  assert(his && (his.match(/thing number/g) || []).length === KNOWLEDGE_MC && /and 5 older things/.test(his) && !/From much earlier/.test(his), 'his newest ' + KNOWLEDGE_MC + ', the rest counted, none called back: ' + his);
});

test('M508-2 a core made of a seat is let go on opening — Renji at the rail no longer "at the Sixth’s training ground"; a real core, and one the writer wrote by hand, stay', () => {
  let st = H(['Renji Abarai']);
  st = applyMutations(st, [
    { type: 'people.set', name: 'Renji Abarai', field: 'core', text: 'pushing the forms hard, his mind on Rukia; wants find Rukia after the assembly; at 6th Division training ground, running forms' },
    { type: 'people.set', name: 'Iba', field: 'core', text: 'signing requisitions with a blunt brush; at 7th Division barracks' },
    { type: 'people.set', name: 'Momo Hinamori', field: 'core', text: 'lieutenant of the 5th Division under Shinji Hirako; still carrying the war’s weight' },
    { type: 'people.set', name: 'Byhand', field: 'core', text: 'a courier; wants gold; at the gate' },
  ]).state;
  st.characters.Byhand.hand = { core: true };
  const muts = seatMadeCores(st);
  eq(muts.map((m) => m.name).sort().join(','), 'Iba,Renji Abarai', 'the seat-shaped cores, and only those');
  const next = applyMutations(st, muts).state;
  eq(next.characters['Renji Abarai'].core, '');
  eq(next.characters['Momo Hinamori'].core, 'lieutenant of the 5th Division under Shinji Hirako; still carrying the war’s weight', 'a real core stays');
  eq(next.characters.Byhand.core, 'a courier; wants gold; at the gate', 'his hand is his');
  const block = renderPeopleTiers(next, { recentPages: [], rotation: 0, brief: '', scenePages: [] }).text;
  assert(/Renji Abarai/.test(block) && !/training ground/.test(block), 'the block no longer says he is at the yard: ' + block);
  const before = renderPeopleTiers(st, { recentPages: [], rotation: 0, brief: '', scenePages: [] }).text;
  assert(/training ground/.test(before), 'fixture: it did say so before the heal');
  eq(seatMadeCores(next).length, 0, 'nothing left to let go');
});

test('M508-3 a page the world agent opens for someone it seats is EMPTY, and never touches a page that exists', () => {
  let st = H([]);
  let r = applyMutations(st, [{ type: 'people.set', name: 'Kim', field: 'core', open: true }]);
  eq(r.applied.length, 1); eq(r.state.characters.Kim.core, '');
  st = r.state;
  r = applyMutations(st, [{ type: 'people.set', name: 'Kim', field: 'core', text: 'the mother' }]); st = r.state;
  r = applyMutations(st, [{ type: 'people.set', name: 'Kim', field: 'core', open: true }]);
  eq(r.applied.length, 0); eq(r.state.characters.Kim.core, 'the mother', 'an open over a real core changes nothing');
  eq(r.rejected[0] && r.rejected[0].why, 'they have a page already');
});

test('M508-4 a blind spot names a long fact in its first words; the whole fact stands above under whoever knows it', () => {
  let st = H(['Rukia', 'Renji']);
  const long = 'heard Nanao Ise report that the roster acceptance for the Thirteenth Division was penned Sunday the twenty-seventh of Hatsuharu, one original and two sealed copies dispatched the same day from the First’s out-box, one to the Thirteenth’s records desk and one to the Second Division, with no routing entries after the out-box';
  st = applyMutations(st, [{ type: 'knowledge.add', name: 'Renji', fact: long }]).state;
  const spots = blindSpots(st.knowledge, st.present, { scenePages: ['the roster acceptance and the out-box'], turn: 31, mc: 'Jovan Oda' });
  const said = renderBlindSpots(spots);
  assert(/Rukia hasn’t found out: heard Nanao Ise report that the roster acceptance/.test(said), said);
  assert(said.includes('… (Renji knows)') && !said.includes('no routing entries'), 'clipped, with the knower: ' + said);
  assert(said.length < long.length, 'shorter than the fact');
  const facts = renderStateFacts(st, { whole: true, budget: 60000, scenePages: ['the roster acceptance and the out-box'] });
  assert(facts.includes(long), 'the whole fact stands under Renji');
  assert(BLIND_CLIP >= 120, 'a blind spot still says what the fact is about');
});
