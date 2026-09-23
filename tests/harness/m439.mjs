/* M439: the housekeeper reads its own answer blocks the ways models actually write them — one card written bare with a
 * list inside it, a block typed in curly quotes, a list wrapped in one named field — never as "unreadable". Runs the
 * real reader. */
import { test, assert, eq } from './lib.mjs';
import { parseProtocol, tolerantJson } from '../../js/agents/housekeeper.js';

test('M439-1 A CARD WRITTEN BARE WITH A LIST INSIDE, A BLOCK IN CURLY QUOTES, A LIST IN ONE NAMED FIELD — ALL READ', () => {
  const bare = parseProtocol('<lore>{"add":true,"name":"Aurora","keys":["Aurora","the neighbor"],"content":"next door"}</lore>');
  eq(bare.lore.length, 1, 'the bare card is read'); eq(bare.lore[0].name, 'Aurora'); eq(bare.unreadable.length, 0, 'never unreadable');
  const curly = parseProtocol('<lore>[{\u201cadd\u201d:true,\u201cname\u201d:\u201cKim\u201d,\u201ckeys\u201d:[\u201cKim\u201d],\u201ccontent\u201d:\u201cthe neighbor\u201d}]</lore>');
  eq(curly.lore.length, 1, 'curly quotes as the delimiters'); eq(curly.lore[0].content, 'the neighbor');
  const wrapped = parseProtocol('<lore>{"lore":[{"add":true,"name":"W","keys":["W"],"content":"w"},{"add":true,"name":"V","keys":["V"],"content":"v"}]}</lore>');
  eq(wrapped.lore.map((o) => o.name).join(','), 'W,V', 'a list in one named field is that list');
  eq(JSON.stringify(tolerantJson('[{"content":"She said \u201chi\u201d."}]')), '[{"content":"She said \u201chi\u201d."}]', 'curly quotes inside straight-quoted words stay words');
  eq(JSON.stringify(parseProtocol('<fetch>["#abc123", 3]</fetch>').fetch), '["#abc123","3"]', 'a fetch list as before');
  const garbage = parseProtocol('<lore>not json at all</lore>');
  eq(garbage.unreadable.length, 1, 'words that are no card are still said unreadable');
});

test('M439-2 THE WORKERS READ THEIR ANSWERS AS FORGIVINGLY: curly quotes, a trailing comma — the ledger\u2019s reader, the scene sensors, the record\u2019s checker', async () => {
  const { parseFirstObject } = await import('../../js/agents/jsonutil.js');
  const { readAnswers } = await import('../../js/agents/sensors.js');
  const { parseVerifyAnswer } = await import('../../js/agents/memory.js');
  const ledger = parseFirstObject('{\u201cmutations\u201d:[{\u201ctype\u201d:\u201cpresence.enter\u201d,\u201cname\u201d:\u201cKim\u201d}]}');
  assert(ledger && ledger.mutations && ledger.mutations[0].name === 'Kim', 'the ledger\u2019s reader takes curly quotes');
  const sensors = [{ id: 'danger' }];
  const read = readAnswers('```json\n{"danger": 3,}\n```', 'scores', sensors);
  eq(JSON.stringify(Object.keys(read)), JSON.stringify(Object.keys(readAnswers('{"danger": 3}', 'scores', sensors))), 'a fenced answer with a trailing comma reads as the plain one');
  assert(Object.keys(readAnswers('{"danger": 3}', 'scores', sensors)).length > 0, 'the plain one reads at all');
  eq(parseVerifyAnswer('[{"issue":"the date is wrong","where":"line 3"},]').length, 1, 'the record\u2019s checker keeps a finding past a trailing comma');
  eq(parseVerifyAnswer('[{\u201cissue\u201d:\u201cthe date is wrong\u201d,\u201cwhere\u201d:\u201cline 3\u201d}]').length, 1, 'and in curly quotes');
});
