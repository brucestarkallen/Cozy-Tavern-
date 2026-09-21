/* M372: WHAT THE LEDGER SAYS HAPPENED. His report: the ledger said Vanessa called Jovan's phone; the page was ambiguous,
 * but a careful reader — him, and the housekeeper — knew it was Rias's phone (she declined Vanessa's text, Vanessa called
 * again, Rias handed her phone to Jovan). The auditor runs after every page and was never asked to check who did what
 * with whose thing — and could not have let a wrong fact go if it had (knowledge.forget was the housekeeper's alone). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { AUDITOR_TYPES, buildAuditorMessages } from '../../js/agents/auditor.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { readFileSync } from 'node:fs';

const auditorSource = readFileSync(new URL('../../js/agents/auditor.js', import.meta.url), 'utf8');
const extractorSource = readFileSync(new URL('../../js/agents/extractor.js', import.meta.url), 'utf8');

test('M372-1 THE AUDITOR MAY LET A WRONG FACT GO, and the ledger lets it go and takes the right one', () => {
  assert(AUDITOR_TYPES.has('knowledge.forget'), 'knowledge.forget is one of the auditor’s own changes now');
  let st = applyMutations({ ...emptyState(), page: 9 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'knowledge.add', name: 'Jovan', fact: 'Vanessa called his phone twice' }]).state;
  const fixed = applyMutations(st, [
    { type: 'knowledge.forget', name: 'Jovan', fact: 'Vanessa called his phone twice' },
    { type: 'knowledge.add', name: 'Jovan', fact: 'Vanessa called Rias’s phone, and Rias handed it to him' },
  ]);
  const lines = (fixed.state.knowledge.Jovan || []).map((k) => k.fact);
  assert(!lines.some((f) => /called his phone twice/.test(f)), 'the wrong line is gone: ' + JSON.stringify(lines));
  assert(lines.some((f) => /called Rias’s phone, and Rias handed it to him/.test(f)), 'and the right one stands');
  eq(fixed.rejected ? fixed.rejected.length : 0, 0, 'nothing refused');
});

test('M372-2 THE AUDITOR IS ASKED WHO DID WHAT WITH WHOSE THING, read across the pages — and the first reader is told the same before it writes', () => {
  /* the brief as the auditor really receives it */
  const built = buildAuditorMessages({ state: applyMutations({ ...emptyState(), page: 9 }, [{ type: 'mc.set', name: 'Jovan' }]).state, brief: '', castNotes: '', record: '', pages: [] });
  const brief = String((built && (built.system || (built.messages && built.messages[0] && built.messages[0].content))) || '').replace(/\s+/g, ' ');
  assert(brief.length > 1000, 'the brief was built: ' + brief.length);
  assert(/WHAT THE LEDGER SAYS HAPPENED \(M372\)/.test(brief), 'the check is in the auditor’s brief');
  assert(/The phone in her hand is HER phone even when a later line only says/.test(brief), 'with his own case as its example');
  assert(/knowledge\.forget of the wrong fact with knowledge\.add of the right one/.test(brief), 'and the means to fix it');
  assert(/The pages are never rewritten — the story stands as written; the ledger is what reads it wrong/.test(brief), 'never the page');
  const first = extractorSource.replace(/\s+/g, ' ');
  assert(/WHOSE AND WHO \(M372\)/.test(first) && /never guessed toward the main character/.test(first), 'the first reader is told the same, so the wrong line is not written at all');
});
