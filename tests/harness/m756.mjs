/* Cozy Tavern — harness laws of M756: a source fact is reconciled when its words are in the profile, not when its
 * sentence is copied. His light, yellow for good (22 October 2026): "Vanessa Langley has source identity facts to
 * reconcile: Gives orders to the room and to deputies; authorizes new work order on the bodies; Addresses Jovan as
 * Wessex and asks him to walk with her" — owed on every pass until the audit paused itself. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const source = (text) => ({ id: 'page:1', label: 'page 1', text, mark: 7 });

function scene(core) {
  const st = applyMutations({ ...emptyState(), page: 4 }, [
    { type: 'mc.set', name: 'Jovan Wessex' },
    { type: 'place.set', name: 'Ashford Manor' },
    { type: 'people.set', name: 'Vanessa Langley', field: 'core', text: core },
  ]).state;
  st.auditSources = { 'page:1': { mark: 7, people: [{ name: 'Vanessa Langley', shown: 'Vanessa gave the order', identityFacts: [
    { text: 'Gives orders to the room and to deputies; authorizes new work order on the bodies', shown: 'Vanessa gave the order' },
  ] }] } };
  return st;
}

/* M758 (the audit of m756-001): the expectation of M756-1 changed. m756-001 had the HOUSE judge that a profile holds the
 * source reader's compound sentence in other words (half of each part's long words present) — a judgment of meaning,
 * which is the reader's (M717), and the same measure waved "Having a secret affair with Jovan Wessex that nobody knows"
 * through into a profile that never mentions an affair (M758-F1) and broke M743-F. What ends the dead end he saw is the
 * review's own answer, kept as a decision on her profile as it stands: owed until the review decides, and never again
 * after (M758-F2 drives the review itself). */
test('M756-1 A FACT SPLIT INTO THE PROFILE’S OWN SENTENCES IS THE REVIEW’S TO RECONCILE, AND ITS DECISION CLOSES IT: owed while undecided; once the review’s decision is kept for her profile as it stands, not owed again', async () => {
  const { missingSourcePeople, sourceFactScope } = await import('../../js/agents/auditsources.js');
  const st = scene('an FBI agent; gives orders to the deputies; authorizes the new work order on the bodies');
  const mention = { name: 'Vanessa Langley', source: 'page:1', label: 'page 1', shown: 'Vanessa gave the order', identityFacts: st.auditSources['page:1'].people[0].identityFacts };
  eq(missingSourcePeople(st, [mention]).length, 1, 'owed to the review');
  const decided = { ...st, audit: { sourceFactDecisions: { [sourceFactScope(st, mention)]: { why: 'The profile states both facts in its own words.' } } } };
  eq(missingSourcePeople(decided, [mention]).length, 0, 'decided: not owed again');
  const changed = { ...decided, characters: { ...decided.characters, 'Vanessa Langley': { ...decided.characters['Vanessa Langley'], core: 'an FBI agent' } } };
  eq(missingSourcePeople(changed, [mention]).length, 1, 'her profile rewritten: asked again');
});

test('M756-2 A FACT THE PROFILE DOES NOT HOLD IS STILL OWED: nothing is waved through — a fact whose substance is absent is asked for, as it always was', async () => {
  const { missingSourcePeople } = await import('../../js/agents/auditsources.js');
  const st = scene('an FBI agent who came in from the drive');
  const issues = missingSourcePeople(st, [{ name: 'Vanessa Langley', source: 'page:1', label: 'page 1', shown: 'Vanessa gave the order', identityFacts: st.auditSources['page:1'].people[0].identityFacts }]);
  eq(issues.length, 1, 'still owed: ' + JSON.stringify(issues));
  assert(/has source identity facts to reconcile/.test(issues[0].what), 'said as it always was: ' + issues[0].what);
});

test('M756-3 THE SAME FACT COPIED WHOLE IS STILL RECONCILED, AND A LOCAL DESCRIPTION IS NOT A PROFILE TO FILL', async () => {
  const { missingSourcePeople } = await import('../../js/agents/auditsources.js');
  const whole = scene('an FBI agent. Gives orders to the room and to deputies; authorizes new work order on the bodies');
  eq(missingSourcePeople(whole, [{ name: 'Vanessa Langley', source: 'page:1', label: 'page 1', shown: 'Vanessa gave the order', identityFacts: whole.auditSources['page:1'].people[0].identityFacts }]).length, 0, 'the sentence as it stands');
  const local = scene('an FBI agent');
  eq(missingSourcePeople(local, [{ name: 'Vanessa Langley', source: 'page:1', label: 'page 1', shown: 'x', kind: 'person', identityResolution: { scope: 'local', kind: 'person', why: 'a passers-by of this page only' }, identityFacts: [{ text: 'Gives orders', shown: 'x' }] }]).length, 0, 'a local description keeps its facts in its receipt');
});
