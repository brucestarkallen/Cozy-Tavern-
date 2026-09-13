/* M163 — the ripple's rename: a name the ledger already holds. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';

/* M163: A RENAME ONTO A NAME THE LEDGER ALREADY HOLDS MERGES THE TWO.
 * rekey wrote out[to] = v flat, so fixing a name the extractor misheard —
 * the commonest ripple there is — silently threw away the REAL person: her
 * page, her standing, her open wound and everything she knew, replaced by
 * the typo's thin entry, with only the take-back to notice it by. */
test('M163: a rename onto an existing name loses nothing', async () => {
  const { renameInState } = await import('../../js/agents/ripple.js');
  const state = {
    characters: {
      Mira: { core: 'the innkeeper, dry and watchful', state: 'behind the bar', arc: 'wary of you', threads: ['owes the ferryman'], updatedAtTurn: 9 },
      Mirela: { core: '', state: 'by the fire', arc: '', threads: ['left her cloak upstairs'], updatedAtTurn: 4 },
    },
    relationships: {
      Mira: { p: 40, r: 0, s: 0, history: [{ atMinutes: 10, axis: 'p', delta: 40, cause: 'the chapel' }] },
      Mirela: { p: 0, r: 15, s: 0, history: [{ atMinutes: 20, axis: 'r', delta: 15, cause: 'the fire' }] },
    },
    bodies: {
      Mira: { injuries: [{ what: 'a split lip', sev: 2, healed: false }], strain: [] },
      Mirela: { injuries: [], strain: [{ what: 'the long climb' }] },
    },
    knowledge: { Mira: [{ fact: 'the ferryman lied' }], Mirela: [{ fact: 'the north road is watched' }] },
    canon: { Mira: { facts: [{ key: 'eyes', value: 'grey' }] }, Mirela: { facts: [{ key: 'hair', value: 'black' }] } },
    offscreen: {}, present: [{ name: 'Mira' }, { name: 'Mirela' }], threads: [], factions: {},
  };
  const { state: a } = renameInState(state, 'Mirela', 'Mira');

  eq(Object.keys(a.characters).join(','), 'Mira', 'one person now');
  eq(a.characters.Mira.core, 'the innkeeper, dry and watchful', 'the standing page keeps its core');
  eq(a.characters.Mira.arc, 'wary of you', 'and its arc');
  eq(a.characters.Mira.threads.length, 2, 'both loose ends are kept');
  eq(a.characters.Mira.updatedAtTurn, 9, 'the newer stamp stands');
  eq(a.relationships.Mira.p, 40, 'a real standing is never wiped by a zero');
  eq(a.relationships.Mira.r, 15, 'and the other axis is carried across');
  eq(a.relationships.Mira.history.length, 2, 'both causes are remembered, in order');
  eq(a.bodies.Mira.injuries.length, 1, 'the open wound survives');
  eq(a.bodies.Mira.strain.length, 1, 'and the strain joins it');
  eq(a.knowledge.Mira.length, 2, 'she knows both things');
  eq(a.canon.Mira.facts.length, 2, 'and both locks stand');
  eq(a.present.length, 1, 'the scene seats her once, not twice');

  /* a rename to a genuinely new name still just moves */
  const { state: b } = renameInState(state, 'Mirela', 'Corvin');
  eq(b.characters.Corvin.state, 'by the fire', 'a plain rename still moves the entry whole');
  assert(b.characters.Mira && b.characters.Mira.core, 'and never touches anyone else');
});

/* M163: EVERY READER OF AN AGE READS PAGES. M162 moved the STAMPS to pages
 * told; these readers were still on state.turn, the write counter, which
 * runs three to five times faster. Measured: a person last written ten
 * pages ago measured thirty and the auditor RETIRED them — card gone,
 * roster line gone — for a law that says thirty pages. */
test('M163: the retirement law counts pages, so nobody is let go early', async () => {
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const { peopleHousekeeping, RETIRE_AFTER } = await import('../../js/agents/auditor.js');
  const after = (pages) => {
    let st = emptyState();
    st.page = 0;
    st = applyMutations(st, [{ type: 'people.note', name: 'Mara', field: 'core', text: 'the innkeeper' }]).state;
    for (let p = 1; p <= pages; p += 1) {
      st.page = p;
      st = applyMutations(st, [{ type: 'presence.enter', name: 'Tomas' }]).state;
      st = applyMutations(st, [{ type: 'world.word', brief: { pressure: ['a rider'], ripe: [], twb: null } }]).state;
      st = applyMutations(st, [{ type: 'people.note', name: 'Tomas', field: 'state', text: 'by the door' }]).state;
    }
    return { st, out: peopleHousekeeping(st) };
  };
  const ten = after(10);
  assert(ten.st.turn > 25, 'the write counter has run well ahead (' + ten.st.turn + ')');
  eq(ten.out.length, 0, 'ten pages on, Mara still stands');
  eq(after(RETIRE_AFTER - 1).out.length, 0, 'and one page short of the law');
  const past = after(RETIRE_AFTER + 1);
  eq(past.out.length, 1, 'past the law she retires');
  eq(past.out[0].name, 'Mara', 'and it is her');
});
