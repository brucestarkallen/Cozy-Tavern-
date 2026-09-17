/* M306 — the last cutter of the record says its cut. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { wholeRecord } from '../../js/agents/memory.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { renderPeopleTiers } from '../../js/engine/people.js';

test('M306-1 a reader handed the whole record is told when the oldest lines did not fit — and is handed every line when they do', () => {
  const nodes = Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i, level: 1, span: [i, i], at: i, text: 'Page ' + (i + 1) + ': the river rose another hand and the ferry did not run; Marta counted the sacks again.' }));
  const mem = { nodes };
  const all = wholeRecord(mem, 1000000);
  assert(!/not shown/.test(all), 'whole when it fits');
  eq((all.match(/the river rose/g) || []).length, 40, 'every line');
  const cut = wholeRecord(mem, 1200);
  const said = cut.match(/^\((\d+) earlier lines? of the record not shown/);
  assert(said, 'the cut is said on the first line: ' + cut.slice(0, 90));
  eq(Number(said[1]) + (cut.match(/the river rose/g) || []).length, 40, 'and every line is either shown or counted');
  assert(/Page 40:/.test(cut) && !/Page 1:/.test(cut), 'the newest are what is kept');
});

test('M306-2 a card tells the storyteller the NEWEST loose ends, newest first — it told the three oldest and never the ones that had just come up', () => {
  let st = applyMutations({ ...emptyState(), page: 0 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Liara' },
    { type: 'people.set', name: 'Liara', field: 'core', text: 'his oldest friend' },
  ]).state;
  const ENDS = ['owes the librarian an apology for the torn atlas', 'promised her mother a visit before the solstice', 'still has not returned the borrowed violin bow',
    'means to ask Jovan about the scar on his wrist', 'agreed to meet the ferryman at dawn on Thursday'];
  ENDS.forEach((text, i) => { st = applyMutations({ ...st, page: i + 1 }, [{ type: 'people.note', name: 'Liara', field: 'thread', text }]).state; });
  eq(st.characters.Liara.threads.length, 5, 'fixture: five different loose ends');
  const block = renderPeopleTiers(st, { recentPages: [], brief: '' }).text;
  const line = block.split('\n').find((l) => l.startsWith('Loose ends:')) || '';
  assert(/^Loose ends: agreed to meet the ferryman at dawn on Thursday; means to ask Jovan about the scar on his wrist; still has not returned the borrowed violin bow/.test(line), 'the newest three, newest first: ' + line);
  assert(!/torn atlas/.test(line), 'not the stalest');
  assert(/\(and 2 older\)/.test(line), 'and the rest are counted');
});
