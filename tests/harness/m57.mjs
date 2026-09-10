/* M57 — passers-through retire; a page or an entrance wakes them; the storyteller never sees the retired. */
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { applyMutations } from '../../js/engine/apply.js';
import { peopleHousekeeping, RETIRE_AFTER } from '../../js/agents/auditor.js';
import { renderPeopleTiers } from '../../js/engine/people.js';
import { emptyState } from '../../js/engine/state.js';
import { buildScribeMessages } from '../../js/agents/scribe.js';

test('M57-1 an Uber driver with no bond, no seat, no thread, absent thirty turns, retires; the sister does not; a page or an entrance wakes him', () => {
  let s = emptyState(); s.sheet.playerName = 'Jovan'; s.turn = 40;
  s.characters = {
    'Uber driver': { core: 'talked about traffic', state: '', arc: '', threads: [], updatedAtTurn: 2 },
    'Rias Wells': { core: 'older sister', state: '', arc: '', threads: [], updatedAtTurn: 2 },
    'Old Marco': { core: 'the ferryman', state: '', arc: '', threads: ['owes him a crossing'], updatedAtTurn: 1 },
    Fresh: { core: 'met just now', state: '', arc: '', threads: [], updatedAtTurn: 39 },
  };
  s = applyMutations(s, [{ type: 'rel.set', name: 'Rias Wells', p: 85, r: 65, s: 45, cause: 'the brief states toward Jovan' }]).state;
  const fixes = peopleHousekeeping(s);
  eq(fixes.map((f) => f.name).join(','), 'Uber driver', 'only the passer-through');
  const after = applyMutations(s, fixes).state;
  assert(after.characters['Uber driver'].retired, 'retired');
  const tiers = renderPeopleTiers(after, { recentPages: [] });
  assert(!/Uber driver/.test(tiers.text), 'the storyteller never sees the retired');
  assert(/Rias Wells/.test(tiers.text));
  const woke = applyMutations(after, [{ type: 'presence.enter', name: 'Uber driver' }]).state;
  assert(!woke.characters['Uber driver'].retired, 'an entrance wakes him');
  const woke2 = applyMutations(after, [{ type: 'people.set', name: 'Uber driver', field: 'state', text: 'back at the curb' }]).state;
  assert(!woke2.characters['Uber driver'].retired, 'a page written wakes him');
  const back = applyMutations(after, [{ type: 'people.wake', name: 'Uber driver' }]);
  assert(back.applied.length === 1 && !back.state.characters['Uber driver'].retired, 'brought back by hand, undoable');
  eq(peopleHousekeeping(after).length, 0, 'once is enough');
  eq(RETIRE_AFTER, 30);
});

test('M57-2 the scribe pages no passer-through; the drawer folds the passed-through with a way back', () => {
  const sc = buildScribeMessages({ state: emptyState(), userText: 'u', assistantText: 'a' });
  assert(/PASSERS-THROUGH GET NO PAGE/.test(sc.system));
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/Passed through — /.test(drawer) && /people\.wake/.test(drawer));
});
