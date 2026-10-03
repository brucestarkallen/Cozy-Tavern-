/* Cozy Tavern — harness law of M572: the remaining helpers' instructions read in full, as sent. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { buildScribeMessages } from '../../js/agents/scribe.js';
import { buildContinuityMessages } from '../../js/agents/continuity.js';
import { emptyState } from '../../js/engine/state.js';

const sys = (r) => String(r.system || (Array.isArray(r.messages) ? r.messages[0].content : ''));
const st = { ...emptyState(), mc: { name: 'Jovan Wessex' } };

test('M572 THE SCRIBE\'S AND THE SECOND READER\'S INSTRUCTIONS READ AS ONE: the arc keeps its own last line; the real record is its own rule and never lets a canon person be invented or written from memory; a passer-through is never given a page by the rule that gives the named their pages; and no stray words of an older edit are left in the second reader\'s', () => {
  const s = sys(buildScribeMessages({ state: st, userText: 'x', assistantText: 'y' }));
  assert(/arc {4}— how they stand with the main character, and WHY it moved\.\n {11}Only when something on the page moved it, and name the beat\./.test(s), 'the arc and its own last line, together');
  assert(/THE REAL RECORD: a real person or a character from an established canon is written from the real record given\nbelow/.test(s) && /your own memory of a canon is not material/.test(s), 'the real record, its own rule');
  assert(!/invent only\s+where the record is silent/.test(s), 'never invented where the record is silent');
  assert(s.indexOf('THE REAL RECORD:') > s.indexOf('unthread —'), 'after the fields, never inside one');
  assert(/A PERSON WITH NO PAGE GETS ONE\. Everyone named who acts or speaks on this page \(a passer-through excepted/.test(s), 'the passers-through excepted');
  const c = sys(buildContinuityMessages({ state: st, userText: 'x', assistantText: 'y' }));
  assert(!/no finding\.\ncould not know\./.test(c) && /there is no finding\.\n`fix` is the nearest TRUE way/.test(c), 'no stray words');
});
