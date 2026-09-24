/* M469 — the turn that ran past its end: the page ends where the model began writing the writer's next turn. */
import { test, assert, eq } from './lib.mjs';
import { stripControlLeak } from '../../js/agents/director.js';

const OPENER = 'I set the cup down and look at the door, then at Rias. "Anyone coming tonight, or is it just us and the rain?" I ask, and wait.';
const PAGE = '[The Lantern — Monday | 21:40 | rain | a coat | by the door]\n\nThe rain kept on against the shutters. Rias turned her glass and did not look up. "Just us," she said.';

test('M469-1 a role label and a re-typed copy of his message end the page there; the words before are kept', () => {
  const junk = PAGE + '\n\nfucking balon hes mijdnightji\n\nUSER: ' + OPENER + '\n\n(USER sent you this again)\n\nASSISTANT: The rain kept on against the shutters. Rias turned her glass.';
  const r = stripControlLeak(junk, { writerText: OPENER });
  assert(r.leaked && r.ranPast, 'seen as a turn that ran past its end');
  assert(r.text.endsWith('"Just us," she said.\n\nfucking balon hes mijdnightji') || r.text.endsWith('"Just us," she said.'), 'the page is what came before the label: ' + JSON.stringify(r.text.slice(-60)));
  assert(!r.text.includes('USER') && !r.text.includes('sent you this again'), 'the next turn is never a page');
  const labelled = PAGE + '\n\n### Human: ' + OPENER;
  assert(stripControlLeak(labelled, { writerText: OPENER }).text === PAGE, 'a markdown-headed label too');
  const bold = PAGE + '\n\n**User:** ' + OPENER.slice(0, 80);
  assert(stripControlLeak(bold, { writerText: OPENER }).text === PAGE, 'a bold label, a partial re-typing (forty characters are enough)');
});

test('M469-2 his whole message standing as a paragraph of the page — no label — ends the page there', () => {
  const junk = PAGE + '\n\n' + OPENER + '\n\nThe rain kept on. Rias smiled.';
  const r = stripControlLeak(junk, { writerText: OPENER });
  assert(r.leaked && r.ranPast, 'seen');
  eq(r.text, PAGE, 'the page is what came before his re-typed message');
  const spaced = PAGE + '\n\n' + OPENER.replace(/ /g, '  ') + '\n\nMore.';
  eq(stripControlLeak(spaced, { writerText: OPENER }).text, PAGE, 'whitespace aside');
});

test('M469-3 a quoted line of his inside prose, a short message, a label with other words, and prose with the word User never trip it', () => {
  const quote = PAGE + '\n\n"Anyone coming tonight, or is it just us and the rain?" Rias repeated his words back at him, amused.';
  const r = stripControlLeak(quote, { writerText: OPENER });
  assert(!r.leaked, 'his quoted line inside the storyteller’s prose is prose: ' + JSON.stringify(r.text.slice(-40)));
  const short = PAGE + '\n\nUSER: Go on.';
  assert(!stripControlLeak(short, { writerText: 'Go on.' }).leaked, 'a message under forty characters cannot be re-typed for the check — the page is kept');
  const other = PAGE + '\n\nSystem: reactor at forty percent. Human: one, in the airlock.';
  assert(!stripControlLeak(other, { writerText: OPENER }).leaked, 'a label followed by other words is prose');
  const user = PAGE + '\n\nUser error, the console said, and the lights went out.';
  assert(!stripControlLeak(user, { writerText: OPENER }).leaked, 'the word without a colon is prose');
  assert(!stripControlLeak(PAGE).leaked, 'no writer text: only a control token counts');
  const control = PAGE + '\n\n<|im_end|>\n\nUSER: ' + OPENER;
  const c = stripControlLeak(control, { writerText: OPENER });
  assert(c.leaked && !c.ranPast && c.text === PAGE, 'a control token still ends the page first, and is named as M117’s leak');
});
