/* M338 — who could know this? The blind spots of the people in the scene: computed in code before the page, held to by the second reader after it. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, renderStateFacts } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { blindSpots } from '../../js/engine/world.js';
import { buildContinuityMessages } from '../../js/agents/continuity.js';
import { buildRequest, STARTER_NOTE } from '../../js/assemble/stack.js';

function lakeside() {
  let st = applyMutations({ ...emptyState(), page: 40 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Lakeside path' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Aurora Sterling' }, { type: 'presence.enter', name: 'Claire Maxwell' },
    { type: 'knowledge.add', name: 'Aurora Sterling', fact: 'Jovan agreed by text to walk with her at four o’clock from her driveway' },
    { type: 'knowledge.add', name: 'Aurora Sterling', fact: 'Claire left for the west bench five minutes early' },
    { type: 'knowledge.add', name: 'Claire Maxwell', fact: 'Aurora has held her four o’clock like a museum piece since the lake bend' },
    { type: 'knowledge.add', name: 'Claire Maxwell', fact: 'Jovan fenced with a stick on the path' },
    { type: 'knowledge.add', name: 'Aurora Sterling', fact: 'Jovan fenced on the path with a stick, like something out of a movie' },
    { type: 'knowledge.add', name: 'Rias Wells', fact: 'Jovan lied to Mi-na about football training' }]).state;
  return { ...st, page: 44 };
}
const PAGE = '"You gave me the schedule yesterday," Claire said, level. "Four o’clock at the Sterling driveway. It was in the hallway after the audit."';

test('M338-1 THE WRITER’S REPORT: Claire "was given the schedule yesterday" — a telling that never happened. Before the page, the storyteller is handed what each person here has NOT been shown learning — computed from the ledger’s own lines, no model', () => {
  const st = lakeside();
  const spots = blindSpots(st.knowledge, st.present, { scenePages: ['Jovan asked Claire how she found them at four o’clock.'], turn: 45, mc: 'Jovan' });
  const claire = spots.find((s) => s.name === 'Claire Maxwell');
  assert(claire && claire.lacks.some((l) => /agreed by text to walk with her at four o’clock/.test(l.fact) && l.from === 'Aurora Sterling'), 'Claire was never shown learning the four o’clock: ' + JSON.stringify(claire));
  assert(!claire.lacks.some((l) => /Claire left for the west bench/.test(l.fact)), 'what is ABOUT her she was there for');
  assert(!claire.lacks.some((l) => /fenced/.test(l.fact)), 'what she holds in OTHER WORDS she holds (the fencing, told two ways)');
  assert(claire.lacks.some((l) => /lied to Mi-na about football training/.test(l.fact)), 'and what MC did out of her sight: ' + JSON.stringify(claire.lacks.map((l) => l.fact)));
  assert(!spots.some((s) => s.name === 'Jovan'), 'the main character is the writer’s — never listed');
  const facts = renderStateFacts(st, { scenePages: ['Jovan asked Claire how she found them at four o’clock.'] });
  assert(/Who does NOT know what — no page shows them learning these\./.test(facts) && /never claim a telling that did not happen: /.test(facts) && /Claire Maxwell has not been shown learning: Jovan agreed by text[^.]*\(Aurora Sterling knows\)/.test(facts), 'it rides in the ledger’s words: ' + facts.slice(facts.indexOf('Who does NOT'), facts.indexOf('Who does NOT') + 420));
  /* …and it reaches the storyteller's request */
  const r = buildRequest({ story: {}, messages: [{ id: 'u', role: 'user', text: 'How did you find us?' }], settings: { noteText: STARTER_NOTE }, state: st, modules: [], memory: '', window: { keeperOn: true } });
  assert(/Claire Maxwell has not been shown learning: Jovan agreed by text/.test(r.messages[0].content), 'in the briefing, before the page is written');
});

test('M338-2 after the page, the second reader is GIVEN the duty and the list: a character who speaks of what no page showed them learning is a finding, and the fix is the nearest TRUE way', () => {
  const { system, user } = buildContinuityMessages({ state: lakeside(), assistantText: PAGE, brief: '' });
  assert(/UNTOLD KNOWLEDGE/.test(system) && /claims a telling the ledger gives no sign of \("you told me yesterday",/.test(system), 'the duty');
  assert(/`fix` is the nearest TRUE way/.test(system) && /Never a finding: a character lying or\s+bluffing on purpose/.test(system) && /the main character, whose knowledge is the writer's/.test(system), 'the fix, and what is the story and not a slip');
  assert(/ABSENCE IS NEVER DRIFT/.test(system), 'the older law stands for everything else');
  assert(/Claire Maxwell has not been shown learning: Jovan agreed by text to walk with her at four o’clock from her driveway \(Aurora Sterling knows\)/.test(user), 'and it is shown what she was never shown — keyed to this page: ' + user.slice(user.indexOf('Who does NOT'), user.indexOf('Who does NOT') + 300));
  assert(user.includes(PAGE), 'beside the page itself');
});

test('M338-3 quiet when there is nothing to say: everybody holds what the others hold; nobody is here; old trifles far from the scene stay out', () => {
  let st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kim' }, { type: 'presence.enter', name: 'Liara' },
    { type: 'knowledge.add', name: 'Kim', fact: 'the letter was left unread' }, { type: 'knowledge.add', name: 'Liara', fact: 'The letter was left unread.' }]).state;
  eq(blindSpots(st.knowledge, st.present, { turn: 4, mc: 'Jovan' }).length, 0, 'the same fact held by both');
  assert(!/Who does NOT know/.test(renderStateFacts(st)), 'no heading with nothing under it');
  eq(blindSpots(st.knowledge, [], { turn: 4 }).length, 0);
  st = applyMutations({ ...st, page: 3 }, [{ type: 'knowledge.add', name: 'Vanessa', fact: 'the bakery closes early on Mondays' }]).state;
  eq(blindSpots(st.knowledge, st.present, { turn: 300, mc: 'Jovan', scenePages: ['They argued about the fence.'] }).length, 0, 'three hundred pages on, a trifle far from the scene is not brought up');
});
