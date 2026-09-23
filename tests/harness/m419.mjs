/* M419: one person, one name in every book — injuries, standings and who-knows-what find a person under any form of their
 * name (the one matcher), a new entry is written under their page's name, the main character's labels are his; and an
 * older ledger's entries under another form of a name join the page. Runs the real ledger. */
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations, strayBookKeys } from '../../js/engine/apply.js';

const base = () => applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' },
  { type: 'people.set', name: 'Rukia Kuchiki', field: 'core', text: 'his lieutenant' }, { type: 'people.set', name: 'Byakuya Kuchiki', field: 'core', text: 'captain of the 6th' }]).state;

test('M419-1 ONE BODY, ONE STANDING, ONE MIND PER PERSON: "Rukia" and "Rukia Kuchiki" land on one entry under her page\u2019s name; "you" is Jovan Oda; a bare "Kuchiki" with two Kuchikis decides nobody', () => {
  const st = applyMutations(base(), [
    { type: 'body.injure', name: 'Rukia', what: 'a cut on the forearm', sev: 1 }, { type: 'body.injure', name: 'Rukia Kuchiki', what: 'bruised ribs', sev: 2 },
    { type: 'rel.shift', name: 'Rukia', axis: 'p', delta: 5, cause: 'he took the blow for her' }, { type: 'rel.shift', name: 'Rukia Kuchiki', axis: 'p', delta: 6, cause: 'he stood by her at the meeting' },
    { type: 'knowledge.add', name: 'Rukia', fact: 'Oda skipped the meeting' }, { type: 'knowledge.add', name: 'Rukia Kuchiki', fact: 'the recruits fear him' },
    { type: 'body.injure', name: 'you', what: 'a split lip', sev: 1 }, { type: 'body.injure', name: 'Kuchiki', what: 'a sprained wrist', sev: 1 },
    { type: 'canon.lock', name: 'Rukia', key: 'eyes', value: 'violet' }, { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'black, to the jaw' },
  ]).state;
  eq(Object.keys(st.canon).join(','), 'Rukia Kuchiki', 'what is true of her: one entry'); eq(st.canon['Rukia Kuchiki'].facts.length, 2, 'both truths on it');
  eq(st.bodies['Rukia Kuchiki'].injuries.length, 2, 'both hurts on her one body');
  assert(!st.bodies.Rukia, 'never a second body under "Rukia"');
  eq(Object.keys(st.relationships).join(','), 'Rukia Kuchiki', 'one standing');
  eq(st.relationships['Rukia Kuchiki'].p, 11, 'holding both moves');
  eq(st.knowledge['Rukia Kuchiki'].length, 2, 'one mind, both facts');
  assert(st.bodies['Jovan Oda'] && !st.bodies.you, '"you" is the main character\u2019s own body');
  assert(st.bodies.Kuchiki && st.bodies['Rukia Kuchiki'].injuries.length === 2, 'a bare "Kuchiki", meaning either of two, is nobody\u2019s entry but its own');
  /* an entry already standing under another form: the write finds it (folded letters; the main character's short name) */
  const held = { ...base(), bodies: { 'Sui-Feng': { injuries: [{ what: 'a graze', sev: 1 }], strain: [] }, Jovan: { injuries: [{ what: 'a bruise', sev: 1 }], strain: [] } } };
  const more = applyMutations(held, [{ type: 'body.injure', name: 'Suì-Fēng', what: 'a cracked rib', sev: 2 }, { type: 'body.injure', name: 'you', what: 'a cut brow', sev: 1 }]).state;
  eq(more.bodies['Sui-Feng'].injuries.length, 2, 'Suì-Fēng is Sui-Feng — one body');
  eq(more.bodies.Jovan.injuries.length, 2, '"you" finds the main character\u2019s entry under his short name');
  assert(!more.bodies['Suì-Fēng'] && !more.bodies['Jovan Oda'], 'never a second entry: ' + Object.keys(more.bodies).join(', '));
});

test('M419-2 AN OLDER LEDGER\u2019S SPLIT BOOKS JOIN THE PAGE: "Rukia"\u2019s injury and standing, "you"\u2019s split lip — renamed onto the page (merged, nothing lost, undoable)', () => {
  const old = { ...emptyState(), page: 3, sheet: { playerName: 'Jovan Oda', actors: {} },
    characters: { 'Rukia Kuchiki': { core: 'x' }, 'Jovan Oda': { state: 'y' }, 'Byakuya Kuchiki': { core: 'z' } },
    bodies: { Rukia: { injuries: [{ what: 'cut', sev: 1 }], strain: [] }, you: { injuries: [{ what: 'lip', sev: 1 }], strain: [] }, Kuchiki: { injuries: [{ what: 'wrist', sev: 1 }], strain: [] } },
    relationships: { Rukia: { p: 5, r: 0, s: 0, history: [] }, 'Rukia Kuchiki': { p: 6, r: 0, s: 0, history: [] } }, knowledge: {} };
  const strays = strayBookKeys(old);
  eq(JSON.stringify(strays), JSON.stringify([{ from: 'Rukia', to: 'Rukia Kuchiki' }, { from: 'you', to: 'Jovan Oda' }]), 'the strays, and never the ambiguous "Kuchiki"');
  const done = applyMutations(old, strays.map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one person, one name in every book' })));
  eq(done.applied.length, 2, 'both joined');
  const st = done.state;
  assert(st.bodies['Rukia Kuchiki'] && !st.bodies.Rukia && st.bodies['Jovan Oda'] && !st.bodies.you && st.bodies.Kuchiki, 'the bodies under the pages: ' + Object.keys(st.bodies).join(', '));
  eq(Object.keys(st.relationships).join(','), 'Rukia Kuchiki', 'one standing for her');
  eq(strayBookKeys(st).length, 0, 'healed — nothing left to join');
});
