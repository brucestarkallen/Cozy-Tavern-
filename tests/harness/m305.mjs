/* M305 — the books no longer forget: every fact and every thread is kept; each reader is shown the newest plus what bears on the scene. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, renderStateFacts, stateView, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { renderKnowledge, KNOWLEDGE_GUARD, KNOWLEDGE_RECENT } from '../../js/engine/world.js';
import { renderAllKnowledge, renderAllThreads } from '../../js/engine/whole.js';
import { buildRequest } from '../../js/assemble/stack.js';

const TRIFLES = ['heard the kettle boil over', 'noticed the bus ran late', 'watched the rain start at noon', 'was told the bakery closed early', 'read the notice about the fair', 'overheard the neighbours arguing',
  'found the library card expired', 'learned the landlord raised the rent', 'spotted a stray cat by the gate', 'heard the school bell ring twice', 'saw the florist change her window', 'was told the ferry is delayed',
  'noticed the streetlight flicker', 'heard the choir practising hymns', 'watched the postman drop a parcel', 'learned the pharmacy moved premises', 'saw the grocer paint his shutters', 'heard the mayor cough through a speech',
  'read the menu at the corner cafe', 'noticed the gutter overflowing again'];
function ledgerWithSecret() {
  let st = applyMutations({ ...emptyState(), page: 0 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The clubroom' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Liara' },
    { type: 'knowledge.add', name: 'Liara', fact: 'saw Jovan summon fire in the clubroom when he thought he was alone' },
  ]).state;
  TRIFLES.forEach((fact, i) => { st = applyMutations({ ...st, page: i + 1 }, [{ type: 'knowledge.add', name: 'Liara', fact }]).state; });
  return st;
}

test('M305-1 the ledger keeps what a person learned long ago: the secret of page one is still there after twenty newer trifles (it kept the newest twelve)', async () => {
  const st = ledgerWithSecret();
  eq(st.knowledge.Liara.length, 21, 'all twenty-one facts are kept');
  assert(/summon fire/.test(st.knowledge.Liara[0].fact), 'the oldest among them');
  await saveState('m305-know', st);
  eq((await loadState('m305-know')).knowledge.Liara.length, 21, 'and a save and a load keep them');
  /* the guard is a runaway guard */
  let many = st;
  for (let i = 0; i < KNOWLEDGE_GUARD + 10; i += 1) many = applyMutations(many, [{ type: 'knowledge.add', name: 'Liara', fact: 'counted ' + i + ' swallows on wire number ' + (i * 7 + 3) }]).state;
  eq(many.knowledge.Liara.length, KNOWLEDGE_GUARD, 'past the guard the oldest goes');
});

test('M305-2 the storyteller is shown the newest — and the old fact comes back when the scene is about it, and only then; what is not shown is counted', () => {
  const st = ledgerWithSecret();
  const quiet = renderKnowledge(st.knowledge, st.present, Infinity, { pages: ['They talked about the weather and the fair on Saturday.'], ignore: ['Jovan'] });
  assert(!/summon fire/.test(quiet), 'a scene about the weather does not call it back');
  assert(new RegExp('and ' + (21 - KNOWLEDGE_RECENT) + ' older things they know, kept in the ledger').test(quiet), 'and the rest are counted, not dropped: ' + quiet.slice(-120));
  const hot = renderKnowledge(st.knowledge, st.present, Infinity, { pages: ['"Show me," she said. A small fire woke in his palm, there in the empty clubroom.'], ignore: ['Jovan'] });
  assert(/From earlier, bearing on this: saw Jovan summon fire in the clubroom/.test(hot), 'a scene of fire in the clubroom calls back what she saw there: ' + hot.slice(-260));
  /* the main character's name is in every fact — alone it calls nothing back */
  const nameOnly = renderKnowledge(st.knowledge, st.present, Infinity, { pages: ['Jovan. Jovan! Jovan, Jovan.'], ignore: ['Jovan'] });
  assert(!/From earlier/.test(nameOnly), 'his name alone is not a scene');
  /* a small room is as it was: the newest few (and at most two called back) */
  const small = renderKnowledge(st.knowledge, st.present, 4, null);
  eq((small.match(/;/g) || []).length, 3, 'four facts in a small room');
});

test('M305-3 the change reaches the wire: the storyteller’s own request carries the fact called back by the page just told', async () => {
  const st = ledgerWithSecret();
  const facts = renderStateFacts(st, { ...stateView(500000), scenePages: ['A small fire woke in his palm, there in the empty clubroom.'] });
  assert(/From earlier, bearing on this: saw Jovan summon fire/.test(facts), 'through renderStateFacts');
  /* and through the assembler, as the send path calls it */
  const story = { id: 'm305-wire', title: 't', brief: '', castNotes: '' };
  const history = [
    { id: 'u1', role: 'user', text: 'I hold out my hand.' },
    { id: 'a1', role: 'assistant', text: 'A small fire woke in his palm, there in the empty clubroom. Liara did not look surprised.' },
    { id: 'u2', role: 'user', text: 'I ask her how long she has known.' },
  ];
  const built = buildRequest({ story, messages: history, settings: {}, state: st, modules: [], memory: '', cast: [], lore: '', window: { keeperOn: true, budgetTokens: 500000 } }); /* the send path's own call: `messages`, not `history` */
  const sent = JSON.stringify(built);
  assert(/bearing on this: saw Jovan summon fire in the clubroom/.test(sent), 'the request itself holds it');
});

test('M305-4 a reader of the whole ledger is shown every fact while it fits, and told what it is not shown when it does not', () => {
  const st = ledgerWithSecret();
  const all = renderAllKnowledge(st.knowledge, st.present);
  assert(/summon fire/.test(all) && !/older thing/.test(all), 'whole while it fits');
  const tight = renderAllKnowledge(st.knowledge, st.present, 600);
  assert(/\(and \d+ older things? — already known; never write them again\)/.test(tight), 'past its room the cut is said, with the word not to write them again: ' + tight.slice(-140));
  assert(/noticed the gutter overflowing again/.test(tight), 'and the newest are what is kept');
});

test('M305-5 a dormant thread is not deleted by a ninth: twelve threads are twelve threads (the coldest, oldest used to go)', () => {
  let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'thread.set', title: 'Riser and the broken engagement', owner: 'Riser', heat: 'cold', next: 'wait for the wedding season, then call in the debt' }]).state;
  /* eleven DIFFERENT threads — titles that share their words are one thread to the ledger (sameThreadTitle) */
  const LATER = ['Akeno and the shrine roof', 'Koneko and the missing cat', 'Sona and the council audit', 'Kiba and the broken sword', 'Asia and the hospital shift', 'Xenovia and the church letter',
    'Gasper and the locked room', 'Rossweisse and the unpaid rent', 'Irina and the transfer papers', 'Azazel and the fishing trip', 'Ravel and the television interview'];
  LATER.forEach((title, i) => { st = applyMutations({ ...st, page: i + 1 }, [{ type: 'thread.set', title, owner: title.split(' ')[0], heat: 'hot', next: 'see to it tomorrow' }]).state; });
  eq(st.threads.length, 12);
  assert(st.threads.some((t) => /Riser/.test(t.title)), 'the rival’s dormant plan is still on the ledger');
  assert(/Riser and the broken engagement/.test(renderAllThreads(st.threads)), 'and the world agent is still shown it');
});
