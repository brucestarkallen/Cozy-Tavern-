/* M47 — the mood is stated whole, every page; a stale mood cannot linger. */
import { test, assert, eq } from './lib.mjs';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { buildExtractorMessages } from '../../js/agents/extractor.js';
import { buildAuditorMessages } from '../../js/agents/auditor.js';

test('M47-1 mode.snapshot diffs the whole board: on what is named, off what is not, logged only on change, undoable', () => {
  const s = emptyState(); s.mode.travel = true; s.mode.socialField = true;
  const r = applyMutations(s, [{ type: 'mode.snapshot', flags: ['socialField', 'group'] }]);
  eq(r.applied.length, 1);
  eq(r.state.mode.travel, false, 'in transit is cleared — he stepped out');
  eq(r.state.mode.socialField, true); eq(r.state.mode.group, true);
  assert(/In company; The road has ended, for now\./.test(r.applied[0].words), r.applied[0].words);
  const same = applyMutations(r.state, [{ type: 'mode.snapshot', flags: ['group', 'socialField'] }]);
  eq(same.applied.length, 0, 'no change, nothing logged');
  const none = applyMutations(r.state, [{ type: 'mode.snapshot', flags: [] }]);
  assert(!none.state.mode.group && !none.state.mode.socialField, 'an empty board clears all');
  const u = undoLast(r.state);
  eq(u.state.mode.travel, true, 'taken back');
  const junk = applyMutations(s, [{ type: 'mode.snapshot', flags: ['travel', 'socialField', 'nonsense'] }]);
  eq(junk.applied.length, 0, 'unknown flags are ignored; the board unchanged');
});

test('M47-2 the reader is shown the board and told to restate it whole; the auditor holds the moods to the page', () => {
  const s = emptyState(); s.mode.travel = true; s.place = { name: 'x' }; s.present = [{ name: 'Rias' }];
  const p = buildExtractorMessages({ state: s, userText: 'u', assistantText: 'a' });
  assert(/Moods on the board right now: travel — restate the whole board with mode\.snapshot\./.test(p.user));
  assert(/THE MOOD IS STATED WHOLE, EVERY PAGE/.test(p.system) && /stepped out of the car is\s*not in transit/.test(p.system.replace(/\n/g, ' ')));
  assert(/mode\.snapshot/.test(p.system) && !/mode\.clear \{/.test(p.system), 'the reader states the board, it does not un-tick');
  const a = buildAuditorMessages({ state: s, pages: [{ role: 'assistant', text: 'x' }] });
  assert(/THE MOOD: do the moods on the board still hold/.test(a.system));
});
