/* M330 — the brief outranks a value somebody changed on a page; and the house leaves no comment in the record. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { factChange, againstTheBrief, valueForms } from '../../js/agents/ripple.js';

test('M330-1 THE WRITER’S REPORT: the brief says Jovan is 16; "sixteen" became "seventeen" on a page — that change goes against what the writer set down, in words or in figures', () => {
  const change = factChange('Jovan had turned sixteen in March.', 'Jovan had turned seventeen in March.');
  eq(JSON.stringify(change), JSON.stringify({ removed: 'sixteen', added: 'seventeen' }), 'fixture: the ripple reads it as one changed fact');
  assert(againstTheBrief(['Jovan Wells, 16, new in town.', ''], change.removed, change.added), 'the brief says 16 — in figures');
  assert(againstTheBrief('Jovan is sixteen. Rias is seventeen-and-a-half going on thirty.'.replace('seventeen-and-a-half', 'older'), 'sixteen', 'seventeen'), 'or in words');
  assert(againstTheBrief(['', 'Cast: Jovan (age 16)'], 'sixteen', 'seventeen'), 'or in the cast notes');
  eq(valueForms('sixteen').sort().join(','), '16,sixteen'); eq(valueForms('21').sort().join(','), '21,twenty one,twenty-one');
});

test('M330-2 what is NOT against the brief ripples as it always did: a value the brief never states, one it states both of, no brief at all — and a 16 inside a longer number is not a 16', () => {
  assert(!againstTheBrief('Jovan is new in town.', 'sixteen', 'seventeen'), 'the brief never says');
  assert(!againstTheBrief('Jovan is 16; his sister Kim is 17.', 'sixteen', 'seventeen'), 'the brief holds both — it cannot settle it');
  assert(!againstTheBrief('', 'sixteen', 'seventeen') && !againstTheBrief(['', ''], 'red', 'blue'));
  assert(!againstTheBrief('The house at 1600 Rim Road, built in 2016.', 'sixteen', 'seventeen'), '1600 and 2016 are not 16');
  assert(againstTheBrief('Rias has red hair.', 'red', 'auburn') && !againstTheBrief('Rias is a redhead.', 'red', 'auburn'), 'whole words only');
});
