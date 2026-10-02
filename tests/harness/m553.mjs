/* Cozy Tavern — harness laws of M553: THE AUDIT, PART 2 — what is read back from storage passes through its shape before a
 * request is built from it (a kept plan, the plans book, where our story began): one field of the wrong kind in a row an
 * older build kept, a branch copied or damage left must never stop a page. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { planShape, loadPlan, keepPlan } from '../../js/agents/planner.js';
import { renderPlan as renderStandingPlan } from '../../js/assemble/planbook.js';
import { canonStartWords } from '../../js/agents/canonstart.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const BROKEN = { scene: 'The yard waits.', people: [{ name: 'Kaelen', now: 7, wants: null, voice: ['clipped'] }, 'Rukia', null, { now: 'nameless' }], unknown: ['Kaelen does not know', { name: 'Kaelen', fact: 42 }, { name: 'Kaelen', fact: 'that Jovan trained at night' }], pressing: 'the bell', earlier: [null, 'the first duel'], laws: ['Voice Fingerprints', 3], intense: 'yes', sounds: [1, 'clang'], leaveTo: { at: 'x' } };

test('M553-1 A KEPT PLAN IS READ BACK THROUGH ITS SHAPE: a plan an older build kept, with fields of the wrong kind, comes back as a plan the request can be built from — the good parts kept, the rest dropped; no plan at all is null (the page goes whole)', async () => {
  const p = planShape(BROKEN);
  eq(p.people.map((x) => x.name + ':' + x.now + ':' + x.voice).join(' | '), 'Kaelen::', 'the person with a name stays; fields of the wrong kind are empty');
  eq(p.unknown.map((u) => u.name + ' / ' + u.fact).join(' | '), 'Kaelen / that Jovan trained at night', 'only whole entries');
  eq(JSON.stringify([p.pressing, p.earlier, p.laws, p.intense, p.sounds, p.leaveTo]), JSON.stringify([[], ['the first duel'], ['Voice Fingerprints'], false, ['clang'], '']));
  eq(planShape({ people: 'x' }), null, 'no scene, no people, no laws: no plan');
  eq(planShape('junk'), null);
  await keepPlan('st-553', 'page-key', BROKEN, 'h');
  const loaded = await loadPlan('st-553', 'page-key');
  assert(loaded && loaded.unknown.length === 1, 'loadPlan hands back the shaped plan');
  const st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }]).state;
  const msgs = [{ id: 'u0', role: 'user', text: 'go' }, { id: 'a0', role: 'assistant', text: '[the yard — Monday | 09:00]\n\nThe yard.' }, { id: 'u1', role: 'user', text: 'I raise my sword.' }];
  const r = buildRequest({ story: { brief: 'b' }, messages: msgs, settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: { ...st, page: 2 }, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: false, budgetTokens: 500000 }, smallPlan: loaded, smallIntense: false });
  assert(/What I have in mind for this page/.test(JSON.stringify(r.messages)), 'the small request is built from it');
});

test('M553-2 THE PLANS BOOK AND WHERE OUR STORY BEGAN NEVER BREAK ON A FIELD OF THE WRONG KIND — they say what is whole and leave the rest out', () => {
  const words = renderStandingPlan({ title: 'The ambush', by: null, goal: 5, parts: [{ who: 'Kaelen', does: 'waits at the gate', when: 3 }, null, { who: 'Rukia' }], words: ['Now!', 7] });
  assert(/^The ambush\.\n {2}1\. Kaelen — waits at the gate\./.test(words) && /The words to be said: “Now!”$/.test(words), words);
  const note = canonStartWords({ series: 'Bleach', moment: 'after the war', facts: ['Ichigo has a son.', null, 42, { x: 1 }] });
  assert(/- Ichigo has a son\./.test(note) && !/null|42|object/.test(note), note);
});
