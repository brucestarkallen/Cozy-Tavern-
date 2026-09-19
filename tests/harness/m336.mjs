/* M336 — a fact says when it was learned; what is called back from long ago is about its own moment. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, renderStateFacts } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { renderKnowledge } from '../../js/engine/world.js';

test('M336-1 THE WRITER’S REPORT: a fact ten scenes old, about another walk, was handed to the teller as "bearing on this" with no date — and the teller built the scene on it. Now it says its age, and is handed over as what it is', () => {
  let st = applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias Wells' },
    { type: 'knowledge.add', name: 'Rias Wells', fact: 'Rias called the twelve-minute walk a six-to-ten-minute intercept window and said the town would ambush Jovan if he walked' }]).state;
  for (let page = 5; page < 45; page += 1) st = applyMutations({ ...st, page }, [{ type: 'knowledge.add', name: 'Rias Wells', fact: 'Rias heard the small thing said on page ' + page }]).state;
  st = applyMutations({ ...st, page: 45 }, [{ type: 'knowledge.add', name: 'Rias Wells', fact: 'Aurora set four o’clock at her own driveway, next door' }]).state;
  const scene = ['Jovan looked at the clock. The four-o’clock walk with Aurora was close — through town or not, the driveway was just across the hedge.'];
  const facts = renderStateFacts({ ...st, page: 46 }, { scenePages: scene });
  const line = facts.split('\n').find((l) => /Rias Wells knows:/.test(l)) || '';
  assert(/Aurora set four o’clock at her own driveway, next door;/.test(line) && !/next door \(learned/.test(line), 'a fresh fact is just a fact: ' + line.slice(0, 160));
  assert(/From much earlier — each is about ITS OWN moment, not this scene; use one only where it truly fits: Rias called the twelve-minute walk[^;]*\(learned about 42 pages ago\)/.test(line), 'the old walk is called back — dated, and as its own moment: ' + line.slice(-330));
  assert(!/bearing on this/.test(facts), 'and nothing claims a relevance two matching words cannot give');
});

test('M336-2 a person whose NEWEST fact is old says so too; no page number known, no age claimed', () => {
  const k = { 'Mi-na Wells': [{ fact: 'a silver truck passed the house without stopping', atTurn: 3 }] };
  assert(/Mi-na Wells knows: a silver truck passed the house without stopping \(learned about 37 pages ago\)\./.test(renderKnowledge(k, ['Mi-na Wells'], undefined, { turn: 40 })));
  eq(renderKnowledge(k, ['Mi-na Wells'], undefined, { turn: 5 }), 'Mi-na Wells knows: a silver truck passed the house without stopping.');
  eq(renderKnowledge(k, ['Mi-na Wells']), 'Mi-na Wells knows: a silver truck passed the house without stopping.', 'no present page given: the line as it always was');
});
