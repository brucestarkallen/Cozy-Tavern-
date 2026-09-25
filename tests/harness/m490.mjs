/* M490 — the scene break was drawn as a lone "*": the renderer read "* * *" as an italic space. An emphasis starts and
 * ends on a visible character, everywhere an asterisk pair is read; and the repair takes every shape of the break. */
import { test, assert, eq } from './lib.mjs';
import { inlineMarks } from '../../js/ui/prose.js';
import { mendMarks, tidyPage } from '../../js/ui/pageshape.js';

const kinds = (t) => inlineMarks(t).map((s) => s.k + ':' + s.text).join(' | ');

test('M490-1 the renderer: "* * *" is text, never an italic space; real emphasis still renders', () => {
  assert(!inlineMarks('* * *').some((s) => s.k === 'em' || s.k === 'strong'), '* * * is text: ' + kinds('* * *'));
  eq(inlineMarks('* * *').map((s) => s.text).join(''), '* * *', 'and all of it is shown');
  assert(!inlineMarks('** **').some((s) => s.k === 'strong'), 'nor a bold space');
  assert(!inlineMarks('five * three * two').some((s) => s.k === 'em'), 'asterisks with spaces inside are not emphasis');
  assert(inlineMarks('I take the *bus*, Jovan.').some((s) => s.k === 'em' && s.text === 'bus'), 'one-word emphasis: ' + kinds('I take the *bus*, Jovan.'));
  assert(inlineMarks('a *twhnn* of springs').some((s) => s.k === 'em' && s.text === 'twhnn'), 'a sound');
  assert(inlineMarks('*He is lying,* she thought').some((s) => s.k === 'em' && s.text === 'He is lying,'), 'a thought');
  assert(inlineMarks('it is **very** late').some((s) => s.k === 'strong' && s.text === 'very'), 'bold');
  assert(inlineMarks('*a*').some((s) => s.k === 'em' && s.text === 'a'), 'a single letter');
});

test('M490-2 the repair takes every shape of a lone break — CR, every space, zero-width marks, look-alike asterisks — and never adds an asterisk', () => {
  const H = '[X — Monday | 09:00 | sun | coat | here]\n\n"Know you."';
  const T = "Kara doesn't move right away.";
  for (const [name, shape] of [['CRLF', '\r\n\r\n  *\r\n\r\n'], ['em space', '\n\n\u2003*\n\n'], ['thin + narrow', '\n\n\u2009\u202f*\n\n'], ['ideographic', '\n\n\u3000*\n\n'], ['zero-width', '\n\n  *\u200b\n\n'], ['BOM', '\n\n\ufeff  *\n\n'], ['fullwidth', '\n\n  \uff0a\n\n'], ['operator', '\n\n  \u2217\n\n'], ['space lines', '\n\n \n  *\n \n\n']]) {
    const t = tidyPage(H + shape + T, {}).text;
    assert(t.includes('"Know you."\n\n* * *\n\n' + T), name + ': ' + JSON.stringify(t.slice(40)));
    assert(!/\*\u200b\*/.test(t), name + ': no asterisk added');
  }
  eq(mendMarks('** **').text, '** **', 'the bold strip never takes a span of spaces');
});

test('M490-2 the regression M490 made is closed: "***", "*****" and every run of asterisks are text — an emphasis never has an asterisk for its first or last letter; the repair never strips a run of asterisks', () => {
  for (const run of ['***', '****', '*****', '******']) {
    assert(!inlineMarks(run).some((s) => s.k !== 'text'), run + ' is text: ' + kinds(run));
    eq(inlineMarks(run).map((s) => s.text).join(''), run, run + ' shown whole');
  }
  eq(kinds('***both***'), 'text:* | strong:both | text:*', 'as it rendered before M490');
  eq(mendMarks('Text *****.').text, 'Text *****.', 'the bold strip leaves a run of asterisks');
});
