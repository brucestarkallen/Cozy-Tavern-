/* M337 — nothing in a ledger may be dated after its tale's last page. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, dropTheFuture, foldJournal } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

function tale(pages) {
  let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias Wells' }]).state;
  for (let page = 0; page < pages; page += 1) st = applyMutations({ ...st, page }, [{ type: 'knowledge.add', name: 'Rias Wells', fact: 'FACT-OF-PAGE-' + page }, ...(page === 8 ? [{ type: 'thread.set', title: 'The drive to Aurora’s', owner: 'Rias Wells', heat: 'hot', next: 'she insists' }, { type: 'faction.set', name: 'The council', stance: 'watching' }] : [])]).state;
  return st;
}

test('M337-1 THE WRITER’S REPORT: a branch holding a line from pages it does not have. Whatever door let it in, the ledger can tell — and it is taken out of the ledger AND the journal, so no later fold brings it back', () => {
  const parent = tale(12);                       /* twelve pages; the branch is taken at page 5 — and handed the ledger AS IT STANDS (M91's door) */
  const r = dropTheFuture(parent, 6);
  const facts = JSON.stringify(r.state.knowledge);
  eq((facts.match(/FACT-OF-PAGE-\d+/g) || []).join(','), 'FACT-OF-PAGE-0,FACT-OF-PAGE-1,FACT-OF-PAGE-2,FACT-OF-PAGE-3,FACT-OF-PAGE-4,FACT-OF-PAGE-5', 'only what its own six pages taught');
  eq(r.facts.length, 6, 'six lines from the other timeline, named: ' + r.facts[0]);
  eq(r.threads, 1); eq(r.factions, 1); assert(!r.state.threads.length && !Object.keys(r.state.factions).length, 'the thread and the faction of page 8 too');
  assert(r.journal > 0 && r.state.journal.every((e) => e.p <= 5), 'and the journal holds no line of a later page');
  const again = foldJournal({ ...r.state, page: 5 }, [], 5, (s, l) => applyMutations(s, l));
  assert(!/FACT-OF-PAGE-(6|7|8|9|10|11)/.test(JSON.stringify(again.knowledge)), 'a later fold cannot bring them back');
  assert(parent.knowledge['Rias Wells'].length === 12, 'pure: the parent is untouched');
});

test('M337-2 a sound ledger is handed back as it is — the very same object; facts with no date are never guessed at', () => {
  const st = tale(6);
  assert(dropTheFuture(st, 6).state === st, 'nothing dated past the last page: not a copy, the same ledger');
  assert(dropTheFuture(st, 7).state === st);
  const undated = { ...emptyState(), knowledge: { Kim: [{ fact: 'an old fact from before dates were kept', atTurn: null }] } };
  assert(dropTheFuture(undated, 0).state === undated, 'no date, no verdict');
  assert(dropTheFuture(null, 3).state === null && dropTheFuture(st, -1).state === st && dropTheFuture(st, 2.5).state === st, 'junk in, the same thing out');
});
