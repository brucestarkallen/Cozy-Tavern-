/* M163 — the ripple's rename: a name the ledger already holds. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';

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

/* M164: the world agent's "everyone I seat has a page" guard compared the
 * seat's name against the ledger's keys EXACTLY, while people.set resolves
 * near-names. A seat for "Toma" when the ledger holds "Tomas" looked
 * unknown, earned a minimal core, and the applier wrote that stub straight
 * over the smith's real core. */
test('M164: a seat under a near-name never stubs out the page it belongs to', async () => {
  const { findPersonKey } = await import('../../js/engine/people.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  let st = emptyState();
  st = applyMutations(st, [{ type: 'people.set', name: 'Tomas', field: 'core', text: 'the smith — slow to anger, quicker than he looks' }]).state;

  /* the shape of the guard, as the world agent now asks it */
  const known = new Set(Object.keys(st.characters).map((k) => k.trim().toLowerCase()));
  eq(known.has('toma'), false, 'an exact-key guard calls the near-name unknown');
  eq(findPersonKey(st.characters, 'Toma'), 'Tomas', 'while the applier resolves it to the smith');

  const src = readFileSync(new URL('../../js/agents/world.js', import.meta.url), 'utf8');
  assert(/const hasPage = \(name\) => Boolean\(findPersonKey\(fresh\.characters \|\| \{\}, name\)\);/.test(src), 'the guard asks the applier’s own question');
  assert(!/known\.has\(key\)/.test(src), 'and the exact-key guard is gone');

  /* and the damage it used to do, held as a law */
  const stubbed = applyMutations(st, [{ type: 'people.set', name: 'Toma', field: 'core', text: 'seated by the world agent' }]).state;
  eq(stubbed.characters.Tomas.core, 'seated by the world agent', 'the applier really would write the stub over him — which is why the guard must resolve');
});

/* M164: the live paint re-dressed the WHOLE page every animation frame —
 * every display rule over the whole text, the scene re-parsed, the subtree
 * rebuilt — while the cost of one paint grew with the page. Measured at 6x
 * CPU throttle: 1.6ms at a thousand characters, 16.4ms at twelve thousand,
 * and the writer's storyteller is set to thirty thousand tokens. Over a
 * 91,000-character page: 90 paints and 4,319ms of main thread before,
 * 27 paints and 777ms after — 5.6x less, 3.5 seconds given back. */
test('M164: the live paint keeps a floor of four times what the last one cost', () => {
  const src = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const at = src.indexOf('const paintLive = () => {');
  assert(at !== -1, 'the live paint still exists');
  const body = src.slice(at, at + 400);
  assert(/paintedAt \+ paintCostMs \* 4/.test(body), 'the floor is four times the last paint’s cost');
  assert(/if \(paintRaf \|\| paintTimer\) return;/.test(body), 'and only one paint is ever in flight');
  assert(/const stopPainting = \(\) => \{[\s\S]{0,220}cancelAnimationFrame\(paintRaf\)/.test(src), 'a stream that falls over stops painting');
  assert(/stopPainting\(\); \/\* M164/.test(src), 'and the error path calls it');

  /* the arithmetic the floor guarantees: paint work can never exceed a
   * fifth of the thread, whatever the page grows to */
  let clock = 0; let cost = 0; let at2 = -1e9; let paints = 0; let work = 0;
  for (let chunk = 0; chunk < 90; chunk += 1) {
    clock += 40;
    if (clock < at2 + cost * 4) continue;
    cost = 0.6 + chunk * 0.55;   /* a paint's cost grows with the page, as measured */
    at2 = clock; paints += 1; work += cost;
  }
  assert(work / clock < 0.25, 'paint work stays under a quarter of the stream’s wall time (' + Math.round(work) + 'ms of ' + clock + 'ms)');
  assert(paints >= 8, 'and the page still visibly grows while it streams (' + paints + ' paints)');
});
