/* M476 — a readable object is shielded, not the whole page; a stray quote in narration goes; a soft wrap is joined. */
import { test, assert, eq } from './lib.mjs';
import { tidyPage, mendMarks, joinSoftWraps, shieldObjects } from '../../js/ui/pageshape.js';

const HEAD = '[Metropolis — Jovan’s apartment — Tuesday, March 18, 2025 | 18:05 | gold spill | scarf loose | on the sofa]';
const GFX = '<!-- GFX_START -->\n<div style="background:#121212; color:#fff;">\n<div style="font-weight:bold;">Vivi 💅💸</div>\n<div>jovan answer ur phone this is NOT funny</div>\n</div>\n<!-- GFX_END -->';

test('M476-1 the object is lifted out whole and put back to the letter; the prose around it is mended; the page keeps its own line breaks (M340-1 holds)', () => {
  const page = HEAD + '\n\nKara looks over.\n\n' + GFX + '\n\n*bzz-bzz.* The screen flares.\n\nShe watches the bay, then another, "like someone reading the skyline one name at a time.\n\nMore.';
  const t = tidyPage(page, { place: 'X' });
  assert(t.text.includes(GFX), 'the object to the letter');
  assert(t.text.includes('then another, like someone reading the skyline one name at a time.'), 'the stray quote three paragraphs past the object is gone: ' + JSON.stringify(t.text.slice(-120)));
  assert(!t.did.includes('paragraphs'), 'a page holding an object keeps its own line breaks');
  const s = shieldObjects('a\n```\ncode "x"\n```\nb {PULSE} tracker "y"\n\nc');
  assert(!/code|tracker/.test(s.safe) && s.restore(s.safe).includes('code "x"') && s.restore(s.safe).includes('tracker "y"'), 'fences and tracker blocks are shielded and restored');
  eq(mendMarks('*"Hi."* she said').text, '"Hi." she said', 'the old mends still run');
});

test('M476-2 a lone quote opened after a comma onto a lowercase word is a stray mark and goes; after a speech verb, or onto a capital, it is speech and is closed', () => {
  eq(mendMarks('She looked at the bay, "like a name read out.').text, 'She looked at the bay, like a name read out.');
  eq(mendMarks('She turned. "Like a name read out, she said.').text, 'She turned. "Like a name read out, she said."', 'speech left open is closed, as M458 did');
  eq(mendMarks('"Fine," she said. "Go on.').text, '"Fine," she said. "Go on."');
  eq(mendMarks('He said "stop').text, 'He said "stop"', 'after a speech verb: speech, closed (M458-2)');
  const whole = 'He said, "we go now," and left.';
  eq(mendMarks(whole).text, whole, 'a closed pair is never touched, lowercase or not');
});

test('M476-3 a soft wrap is joined — an indented line, or a sentence left hanging that goes on in lowercase — inside a parted page only, never inside the object, never a real paragraph', () => {
  const parted = HEAD + '\n\nThe spotlight keeps sweeping the waterline — closer than Dev likes —\n and the thought that surfaces plain as thirst is: pay.\n\nA new paragraph.\nAnother line that is its own.';
  const t = tidyPage(parted, {});
  assert(t.text.includes('closer than Dev likes — and the thought that surfaces'), 'the indented wrap is joined: ' + JSON.stringify(t.text.slice(-160)));
  assert(t.text.includes('A new paragraph.\nAnother line'), 'a line that ends a sentence and starts with a capital is left as it came');
  assert(t.did.includes('wraps'));
  const unparted = 'one line\n two';
  eq(joinSoftWraps(unparted).changed, false, 'a page with no paragraph breaks is not judged (its single newlines are its paragraphs)');
  const withObject = 'a\n\n' + GFX.replace('<div>jovan', '<div>\n jovan') + '\n\nb —\n c';
  const j = joinSoftWraps(withObject);
  assert(j.text.includes('<div>\n jovan') && j.text.includes('b — c'), 'inside the object nothing moves; outside it the wrap is joined');
});
