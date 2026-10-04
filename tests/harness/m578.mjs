/* Cozy Tavern — harness laws of M578 (the line-by-line audit, part 5: engine/apply.js). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';

test('M578-1 A PERSON FORGOTTEN IS FORGOTTEN WHOLE, AND COMES BACK WHOLE: one written only in the wounds can be forgotten; their sheet entry goes with them; the undo gives back their threads and their sheet entry too', () => {
  let st = applyMutations({ ...emptyState() }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'body.injure', name: 'Ghost Rider', what: 'a cut on the arm', sev: 1 },
  ]).state;
  const onlyWounded = applyMutations(st, [{ type: 'people.forget', name: 'Ghost Rider', cause: 'never the story\u2019s' }]);
  eq(onlyWounded.applied.length, 1, 'one written only in the wounds is forgotten: ' + JSON.stringify(onlyWounded.rejected.map((r) => r.why)));
  assert(!onlyWounded.state.bodies['Ghost Rider'], 'the wound goes');
  st = applyMutations({ ...emptyState() }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Orrin Vale', field: 'core', text: 'a stranger at the gate' },
    { type: 'thread.set', title: 'the debt at the gate', owner: 'Orrin Vale', next: 'pay it' },
    { type: 'thread.set', title: 'the rematch', owner: 'Kaelen', next: 'challenge him' },
  ]).state;
  st = { ...st, sheet: { ...(st.sheet || {}), actors: { ...((st.sheet && st.sheet.actors) || {}), 'Orrin Vale': { standing: 4, skills: {} } } } };
  const gone = applyMutations(st, [{ type: 'people.forget', name: 'Orrin Vale' }]).state;
  assert(!gone.threads.some((t) => t.owner === 'Orrin Vale') && gone.threads.some((t) => t.owner === 'Kaelen'), 'their thread goes, the others stay');
  assert(!(gone.sheet.actors || {})['Orrin Vale'], 'their sheet entry goes');
  const back = undoLast(gone).state;
  assert(back.threads.some((t) => t.title === 'the debt at the gate'), 'the undo gives their thread back');
  eq(back.sheet.actors['Orrin Vale'].standing, 4, 'and their sheet entry');
  assert(back.characters['Orrin Vale'], 'and their page');
});

test('M578-2 THE MAIN CHARACTER\'S NAME, REFUSED, POINTS AT THE WAY THAT WORKS — a rename (a page edited, or the housekeeper) — never at a panel with no such control', () => {
  const st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const r = applyMutations(st, [{ type: 'mc.set', name: 'Kael' }]);
  eq(r.applied.length, 0);
  assert(/change it on a page/.test(r.rejected[0].why) && !/How they measure/.test(r.rejected[0].why), r.rejected[0].why);
});

test('M579 A SECRET LEARNED LONG AGO IS NEVER TOLD AS ONE THEY "HAVEN\'T FOUND OUT": past the guard a person\'s oldest facts are let go — and a fact older than what their full list still holds is no longer claimed unknown to them; one inside it still is', async () => {
  const { blindSpots, KNOWLEDGE_GUARD } = await import('../../js/engine/world.js');
  let st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  st.page = 9; /* page 10: both learn Jovan is a Quincy */
  st = applyMutations(st, [{ type: 'knowledge.add', name: 'Rukia', fact: 'that Jovan is secretly a Quincy' }, { type: 'knowledge.add', name: 'Kaelen', fact: 'that Jovan is secretly a Quincy' }]).state;
  for (let i = 0; i < KNOWLEDGE_GUARD + 5; i += 1) { st.page = 20 + i; st = applyMutations(st, [{ type: 'knowledge.add', name: 'Rukia', fact: 'small detail number ' + i + ' about the barracks schedule' }]).state; }
  assert(!st.knowledge.Rukia.some((k) => /Quincy/.test(k.fact)), 'fixture: her oldest fact was let go at the guard');
  st.page = 400;
  const spots = blindSpots(st.knowledge, [{ name: 'Rukia' }], { scenePages: ['Jovan the Quincy stood by Rukia.'], turn: 401, mc: 'Jovan' });
  assert(!spots.some((sp) => sp.lacks.some((l) => /Quincy/.test(l.fact))), 'never told as a secret she has not found out: ' + JSON.stringify(spots));
  /* a fact inside what her list holds is still a blind spot when she lacks it */
  st = applyMutations(st, [{ type: 'knowledge.add', name: 'Kaelen', fact: 'that the captain hid the Quincy archive under the barracks' }]).state;
  const later = blindSpots(st.knowledge, [{ name: 'Rukia' }], { scenePages: ['The captain, the Quincy archive, the barracks.'], turn: 401, mc: 'Jovan' });
  assert(later.some((sp) => sp.lacks.some((l) => /archive/.test(l.fact))), 'a newer fact she lacks is still hers to find out: ' + JSON.stringify(later));
});
