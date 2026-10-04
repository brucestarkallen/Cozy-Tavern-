/* Cozy Tavern — harness laws of M588: who is here, and where everyone else is (his reports: "she's not at my location, why
 * is she still here?"; "I walked to her door and she's gone from the world and from who's here"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

test('M588-1 A PERSON IS ALWAYS SOMEWHERE: an elsewhere note is never let go while she is not in the scene (she would be nowhere); a new place moves it, walking in lets it go, and a note of someone here is still let go', () => {
  const st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Academy courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'people.set', name: 'Rukia', field: 'core', text: 'a shinigami of the Thirteenth' }, { type: 'offscreen.set', name: 'Rukia', location: 'her quarters in the east wing' }, { type: 'offscreen.set', name: 'a stray porter', location: 'the gate' }]).state;
  eq(applyMutations(st, [{ type: 'offscreen.clear', name: 'a stray porter' }]).applied.length, 1, 'a note nobody\u2019s page carries may still be let go');
  const r = applyMutations(st, [{ type: 'offscreen.clear', name: 'Rukia' }]);
  eq(r.applied.length, 0, 'refused');
  assert(/leave them nowhere/.test(r.rejected[0].why), r.rejected[0].why);
  eq(r.state.offscreen.Rukia.location, 'her quarters in the east wing', 'she is still somewhere');
  eq(applyMutations(st, [{ type: 'offscreen.set', name: 'Rukia', location: 'behind her door' }]).state.offscreen.Rukia.location, 'behind her door', 'a new place moves the note');
  const inScene = applyMutations(st, [{ type: 'presence.enter', name: 'Rukia' }]).state;
  assert(inScene.present.some((p) => p.name === 'Rukia') && !inScene.offscreen.Rukia, 'walking in lets it go');
});

test('M588-2 HE WALKS AWAY, SHE STAYS: the reader\'s leave stands when the page ends on the main character going (it was thrown away unless SHE went); and a move inside a compound (the academy\'s courtyard to its dormitory) is a move — whoever the new room does not hold stays behind', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Academy courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia' }]).state;
  const h = HOUSES[0];
  const same = '[Academy courtyard — Monday, March 3, 2025 | 09:30 | clear | uniform | by the fountain]\n\nRukia stayed by the fountain. Jovan turned his back on her and walked away toward the far gate, leaving the courtyard behind.';
  const leave = JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Rukia', cause: 'he walked away; she stayed by the fountain' }], brief: { pressure: [], ripe: [], twb: null }, deltas: [] });
  const read = await withHouse(thinkingHouse({ answer: leave }), () => extractTurn({ connection: h.conn, state: st, userText: 'I walk away.', assistantText: same, pageNumber: 20 }));
  assert(read.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Rukia'), 'his walking off: her leave stands: ' + JSON.stringify(read.mutations));
  const after = applyMutations(st, read.mutations).state;
  assert(!after.present.some((p) => p.name === 'Rukia') && after.offscreen.Rukia, 'not here, and seated where he left her: ' + JSON.stringify(after.offscreen.Rukia));
  const dorm = '[Academy dormitory — Monday, March 3, 2025 | 09:40 | clear | uniform | in the hall]\n\nJovan pushed open the dormitory door. The hall was empty.';
  const roomOnlyHim = JSON.stringify({ mutations: [], here: ['Jovan'], brief: { pressure: [], ripe: [], twb: null }, deltas: [] });
  const read2 = await withHouse(thinkingHouse({ answer: roomOnlyHim }), () => extractTurn({ connection: h.conn, state: st, userText: 'I go to the dormitory.', assistantText: dorm, pageNumber: 21 }));
  assert(read2.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Rukia' && /left behind at Academy courtyard/.test(m.cause)), 'left behind in the courtyard: ' + JSON.stringify(read2.mutations));
});

test('M588-3 A STATED FEELING SETS ITS LEVEL, AND WHO IS CLOSE BY IS SHOWN: the page reader and the founder carry the levels (in love is R 55–75, never P alone; a feeling revealed is a rel.set, not an inch); the storyteller is shown who is behind the door he is at — and the attempt rule reaches them', async () => {
  const ex = await import('../../js/agents/extractor.js');
  const fo = await import('../../js/agents/founder.js');
  const st0 = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const exMsgs = ex.buildExtractorMessages({ state: st0, userText: 'x', assistantText: 'y' });
  const exSys = String(exMsgs.system || (exMsgs.messages ? exMsgs.messages[0].content : ''));
  assert(/REVEALED, NOT EARNED/.test(exSys) && /in love 55–75/.test(exSys) && /Romantic love is R — never P alone/.test(exSys), 'the page reader carries the levels');
  const foMsgs = fo.buildFounderMessages({ state: st0, brief: 'Rukia has loved Jovan since school.' });
  const foSys = String(foMsgs.system || (foMsgs.messages ? foMsgs.messages[0].content : '')) + JSON.stringify(foMsgs);
  assert(/in\s+love 55–75/.test(foSys) && /"r":65/.test(foSys), 'and the founder');
  const { renderStateFacts } = await import('../../js/engine/state.js');
  const st = applyMutations(st0, [{ type: 'place.set', name: 'Rukia’s quarters' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'offscreen.set', name: 'Rukia', location: 'Rukia’s quarters', activity: 'behind the door' }, { type: 'offscreen.set', name: 'Renji', location: 'the training yard' }]).state;
  const facts = renderStateFacts(st);
  assert(/Close by — not in the scene, but right here[\s\S]*Rukia — Rukia’s quarters \(behind the door\)/.test(facts), 'who is behind the door is shown: ' + facts.slice(0, 300));
  assert(/Elsewhere:[\s\S]*Renji/.test(facts) && !/Elsewhere:[\s\S]*Rukia/.test(facts), 'once, never also among Elsewhere');
  const { CRAFT_TEXT } = await import('../../js/assemble/craft.js');
  assert(/or one Close by \(behind the door he is at/.test(CRAFT_TEXT) && /Walking through someone's door is walking into THEIR space/.test(CRAFT_TEXT), 'the attempt rule reaches them');
});
