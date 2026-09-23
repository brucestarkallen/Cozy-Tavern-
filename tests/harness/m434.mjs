/* M434: an imported SillyTavern lorebook wakes as SillyTavern woke it — its titles kept, a key written as a regular
 * expression read as one, and secondary keys by the entry's own logic (only when the entry is selective). Runs the real
 * importer and the real matcher on the pages. */
import { test, assert, eq } from './lib.mjs';
import { parseLorebook, matchLoreDetailed, loreToWorldbook } from '../../js/import/lorebook.js';

const book = () => parseLorebook(JSON.stringify({ entries: {
  0: { uid: 0, key: ['sword'], keysecondary: ['Renji'], selective: true, selectiveLogic: 2, comment: 'Zabimaru, unseen', content: 'NOT ANY entry' },
  1: { uid: 1, key: ['/rukia|kuchiki/i'], comment: 'Rukia by regex', content: 'REGEX entry' },
  2: { uid: 2, key: ['duel'], keysecondary: ['Byakuya', 'Renji'], selective: true, selectiveLogic: 3, content: 'AND ALL entry' },
  3: { uid: 3, key: ['duel'], keysecondary: ['Byakuya'], selective: false, content: 'NOT SELECTIVE entry' },
  4: { uid: 4, key: ['duel'], keysecondary: ['Byakuya', 'Renji'], selective: true, selectiveLogic: 1, content: 'NOT ALL entry' },
} }));
const fired = (entries, text) => matchLoreDetailed(entries, [text], 4000).fired.map((f) => f.id).sort().join(',');

test('M434-1 A LOREBOOK WAKES AS SILLYTAVERN WOKE IT: titles kept, regex keys read as regex, secondary keys by the entry\u2019s own logic', () => {
  const es = book();
  eq(es[0].name, 'Zabimaru, unseen', 'his title for the entry comes with it');
  eq(fired(es, 'Renji drew his sword. The duel with Byakuya began.'), '2,3', 'NOT ANY stays out when Renji is there; AND ALL wakes with both; NOT ALL stays out with both; a not-selective entry ignores its secondaries');
  eq(fired(es, 'Rukia raised her sword before the duel.'), '0,1,3,4', 'NOT ANY wakes with Renji absent; the regex hears Rukia; NOT ALL wakes with not all present');
  eq(fired(es, 'KUCHIKI watched from the wall.'), '1', 'a regex key is case-insensitive as its flag says');
  const back = loreToWorldbook(es, 'x');
  eq(back.entries['0'].selectiveLogic, 2, 'the logic goes back out with it');
  eq(back.entries['3'].selective, false, 'and a not-selective entry stays so');
});
