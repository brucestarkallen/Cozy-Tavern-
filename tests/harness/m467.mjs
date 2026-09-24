/* M467 — the window's marker in any dressing: one definition, every reader on it. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { WINDOW_MARK, windowCutAt, normalizeWindowMark } from '../../js/engine/window.js';
import { scenePartOf } from '../../js/engine/apply.js';
import { tidyPage } from '../../js/ui/pageshape.js';
import { applyRules } from '../../js/regex.js';
import { STYLE_PACK } from '../../js/regex-styles.js';

const HEAD = '[The Lantern — Monday, April 8, Year 1130 | 21:40 | rain | a grey coat | by the door]';
const WINDOW_HEAD = '[The Room Next to Aria — same 4th floor, Monday, April 8, Year 1130 | 21:51]';
const page = (marker) => HEAD + '\n\nThe lamp guttered; the door stayed shut. Rukia Kuchiki said nothing.\n\n' + marker + '\n\n' + WINDOW_HEAD + '\n\nAria folded the letter twice and did not put it down.';
const DRESSINGS = ['The World Beyond', '**The World Beyond**', '***The World Beyond***', '## The World Beyond', '— The World Beyond —', '✦ The World Beyond ✦', 'the world beyond', WINDOW_MARK];

test('M467-1 the marker is found in any dressing, and a prose mention is never a window', () => {
  for (const d of DRESSINGS) {
    const p = page(d);
    eq(windowCutAt(p), p.indexOf(d), 'found: ' + JSON.stringify(d));
    eq(scenePartOf(p).includes('Aria folded'), false, 'the scene ends at the marker: ' + JSON.stringify(d));
    assert(scenePartOf(p).includes('Rukia Kuchiki said nothing'), 'and holds the room before it');
  }
  eq(windowCutAt('She dreamed of the world beyond the walls, and slept.'), -1, 'the words inside a sentence are prose');
  eq(windowCutAt('The World Beyond the Page\nis not a marker'), -1, 'a title with more words is not the marker');
});

test('M467-2 a kept page carries the marker in the exact form — marks only, the words and the blank lines untouched', () => {
  for (const d of DRESSINGS) {
    const out = tidyPage(page(d), { place: 'The Lantern' });
    const lines = out.text.split('\n');
    assert(lines.includes(WINDOW_MARK), 'the exact form on its own line for ' + JSON.stringify(d) + ': ' + JSON.stringify(lines.slice(2, 6)));
    assert(out.text.includes('Aria folded the letter twice and did not put it down.'), 'the window’s prose to the letter');
    assert(out.text.includes(WINDOW_HEAD), 'the window’s own line to the letter');
    assert(out.text.includes('\n\n' + WINDOW_MARK + '\n\n'), 'the blank lines around it are kept');
    if (d !== WINDOW_MARK) assert(out.did.includes('window'), 'the mend is named: ' + out.did.join(','));
  }
  const exact = tidyPage(page(WINDOW_MARK), { place: 'The Lantern' });
  assert(!exact.did.includes('window'), 'a page already in the exact form is not touched for it');
  eq(normalizeWindowMark('plain page'), 'plain page');
});

test('M467-3 the 🎨 box takes the marker in any dressing — the writer’s own plain page is boxed', () => {
  const twb = STYLE_PACK.find((r) => r.id === 'style-twb');
  assert(twb && twb.flags === 'gim', 'the rule reads line by line');
  for (const d of DRESSINGS) {
    const out = applyRules(page(d), [twb], { on: 'assistant', mode: 'display' });
    const box = out.slice(out.indexOf('<details'), out.indexOf('</details>'));
    assert(/<details/.test(out), 'boxed: ' + JSON.stringify(d));
    assert(box.includes('The Room Next to Aria'), 'its line in the box');
    assert(box.includes('Aria folded the letter'), 'its prose in the box');
    assert(!box.includes('Rukia Kuchiki said nothing'), 'the scene stays outside the box');
  }
  const prose = applyRules('She dreamed of the world beyond the walls.\n\nMore.', [twb], { on: 'assistant', mode: 'display' });
  assert(!/<details/.test(prose), 'a prose mention is left alone');
});
