/* M626 — his: "with a smaller flash model the header is sometimes not detailed, with the wrong outfit or position — fix by
 * mend page or what? And sometimes stray Chinese or Japanese in normal-alphabet text — Chinese glued to 'eat'." Laws RUN the
 * page's tidy and BUILD the readers' requests. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { tidyPage, dropGluedStrays } from '../../js/ui/pageshape.js';
import { buildExtractorMessages } from '../../js/agents/extractor.js';
import { buildContinuityMessages } from '../../js/agents/continuity.js';
import { emptyState } from '../../js/engine/state.js';

const BODY = ' She sat by the window and watched the rain run down the glass, the tea cooling between her hands, the lamp humming softly over the table while the city settled into night.';
const HEAD = '[Karakura Town — Monday, March 3, 2025 | 21:10 | 🌧 rain on the glass]';

test('M626-1 A STRAY GLUED TO THE FRONT OF AN ENGLISH WORD COMES OFF IN CODE — the word stays; a stray that replaces a word, one inside a word, a phrase someone speaks and a short page are left alone', () => {
  const page = 'She began to 吃eat the rice slowly.' + BODY.repeat(2);
  const t = dropGluedStrays(page);
  assert(t.changed && /began to eat the rice/.test(t.text) && !/吃/.test(t.text), 'the glued stray is gone, the word stays: ' + t.text.slice(0, 40));
  eq(dropGluedStrays('Then to吃 the food again.' + BODY.repeat(2)).changed, false, 'a stray that replaces a word is the mender\u2019s (the eye names it)');
  eq(dropGluedStrays('An app吃le on the table.' + BODY.repeat(2)).changed, false, 'never inside a word');
  eq(dropGluedStrays('She whispered いただきますeat and laughed.' + BODY.repeat(2)).changed, false, 'five or more: a phrase someone speaks, kept');
  eq(dropGluedStrays('She began to 吃eat.').changed, false, 'a page too short to judge');
  const tidied = tidyPage(HEAD + '\n\nShe began to 吃eat the rice slowly.' + BODY.repeat(2), { place: 'Karakura Town' });
  assert(tidied.did.includes('stray') && !/吃/.test(tidied.text), 'the landing tidy takes it off');
});

test('M626-2 A HEADER THAT STOPS AFTER THE WEATHER IS GIVEN HIS ATTIRE AND POSITION FROM THE LEDGER — never a header that wrote them, never with nothing to give', () => {
  const t = tidyPage(HEAD + '\n\nShe set the cup down.' + BODY, { place: 'Karakura Town', attire: 'black shihakush\u014d', position: 'at the kitchen table' });
  eq(t.text.split('\n')[0], '[Karakura Town — Monday, March 3, 2025 | 21:10 | 🌧 rain on the glass | black shihakush\u014d | at the kitchen table]', 'five fields');
  const whole = '[Karakura Town — Monday, March 3, 2025 | 21:10 | 🌧 rain | grey hoodie | by the door]';
  eq(tidyPage(whole + '\n\nShe set the cup down.' + BODY, { place: 'Karakura Town', attire: 'black shihakush\u014d', position: 'at the table' }).text.split('\n')[0], whole, 'a header that wrote them is left as written (the second reader judges a slip)');
  eq(tidyPage(HEAD + '\n\nShe set the cup down.' + BODY, { place: 'Karakura Town' }).text.split('\n')[0], HEAD, 'nothing in the ledger: nothing added');
});

test('M626-3 THE READERS ARE TOLD WHAT A HEADER\u2019S ATTIRE AND POSITION ARE — the page reader writes a change only when the page or his move shows one; the second reader names a slip with the ledger\u2019s words', () => {
  const st = { ...emptyState(), place: { name: 'Karakura Town' }, present: [{ name: 'Jovan', attire: 'black shihakush\u014d', position: 'at the table' }], sheet: { playerName: 'Jovan', actors: {} }, page: 4 };
  const ex = JSON.stringify(buildExtractorMessages({ state: st, userText: 'I wait.', assistantText: '[Karakura Town — Monday, March 3, 2025 | 21:10 | rain | grey hoodie | by the door]\n\nThe rain went on.', founding: false }));
  assert(/READING of the ledger, never a change on their own/.test(ex) && /header's slip; the ledger keeps what it holds/.test(ex), 'the page reader: a header\u2019s attire and position are a reading');
  const co = JSON.stringify(buildContinuityMessages({ state: st, assistantText: '[Karakura Town — Monday, March 3, 2025 | 21:10 | rain | grey hoodie | by the door]\n\nThe rain went on.' }));
  assert(/THE HEADER LINE \(the bracketed first line\) is the storyteller/.test(co) && /slip of the header/.test(co), 'the second reader: a header slip is a warn, mended');
});
