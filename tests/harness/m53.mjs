/* M53 — the reader knows the writer's law of the standings; a nudge is a number, not a word. */
import { test, assert, eq } from './lib.mjs';
import { buildExtractorMessages } from '../../js/agents/extractor.js';
import { axisWords } from '../../js/engine/relationships.js';
import { emptyState } from '../../js/engine/state.js';

test('M53-1 the reader is given the standings law whole', () => {
  const p = buildExtractorMessages({ state: emptyState(), userText: 'u', assistantText: 'a' });
  for (const k of ['THE STANDINGS (rel.shift)', 'SCORES MOVE ON REVELATION', 'DISPOSITION NOT MOOD', 'A boundary or a limit she states', 'S rises with wanting shown; P rises with trust shown', 'flat is the default']) {
    assert(p.system.includes(k), 'law: ' + k);
  }
});

test('M53-2 a nudge carries the number only; the bands are symmetric', () => {
  eq(axisWords('r', -8), 'R-8', 'no "distant" for a whisper');
  eq(axisWords('r', 8), 'R+8');
  eq(axisWords('r', -12), 'holding back (R-12)');
  eq(axisWords('p', 15), 'friendly (P+15)');
  eq(axisWords('p', -15), 'cooler (P-15)');
  eq(axisWords('s', 30), 'wanting (S+30)');
  eq(axisWords('p', 0), '');
});
