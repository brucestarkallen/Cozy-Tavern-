/* Cozy Tavern — harness laws of M550: WHERE OUR STORY BEGAN, CHECKED AGAINST THE WIKI (his Bleach tale, after the war: the
 * note said Zaraki is the Captain-Commander, written from a model's memory and never looked up). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { startCheckAsk, readStartCheck, applyStartCheck, startCheckPrint, checkCanonStart, canonStartWords } from '../../js/agents/canonstart.js';

const START = { series: 'Bleach', arc: 'after the Thousand-Year Blood War', moment: 'ten years after the war, in the Seireitei', facts: ['Ichigo has a son, Kazui.', 'Kenpachi Zaraki is the Captain-Commander of the Gotei 13.', 'Renji leads the 6th Division.'] };
const WIKI = ['Kenpachi Zaraki — the captain of the 11th Division of the Gotei 13', 'Shunsui Kyōraku — the Captain-Commander of the Gotei 13 and captain of the 1st Division'];

test('M550-1 THE CHECK IS ASKED WITH THE MOMENT, THE NUMBERED FACTS AND THE WIKI\'S LINES — told the wiki is the series as it ends, so an earlier moment\'s seat is not wrong, and a fact the wiki does not mention is never wrong', () => {
  const ask = startCheckAsk({ start: START, wiki: WIKI });
  assert(ask.user.includes('WHERE THE STORY BEGINS: Bleach — after the Thousand-Year Blood War — ten years after the war, in the Seireitei'), 'the moment');
  assert(ask.user.includes('2. Kenpachi Zaraki is the Captain-Commander of the Gotei 13.'), 'the facts, numbered');
  for (const w of WIKI) assert(ask.user.includes('- ' + w), 'the wiki: ' + w);
  assert(/tell the series as it ENDS/.test(ask.system) && /that is NOT wrong/.test(ask.system), 'the end, and an earlier moment');
  assert(/Never mark a fact wrong because the wiki does not mention it/.test(ask.system), 'silence is not wrong');
});

test('M550-2 ITS ANSWER IS READ STRICTLY, AND ONLY WHAT IT SHOWS WRONG IS LET GO — the note then rides without it; his own correction is never touched; a checked start is not asked again until its facts or the wiki change', async () => {
  eq(JSON.stringify(readStartCheck('the second one {"wrong":[2,2,7,0,"x"]}', 3)), '{"wrong":[1]}', 'numbers of facts that exist, each once');
  eq(readStartCheck('no idea', 3), null, 'nonsense is no answer');
  eq(readStartCheck('{"wrong":"2"}', 3), null, 'not a list, no answer');
  const next = applyStartCheck(START, [1], WIKI);
  eq(next.facts.join(' | '), 'Ichigo has a son, Kazui. | Renji leads the 6th Division.', 'only the wrong one goes');
  eq(next.dropped.join(' | '), 'Kenpachi Zaraki is the Captain-Commander of the Gotei 13.', 'kept aside, never said');
  assert(!/Zaraki/.test(canonStartWords(next)) && /Ichigo has a son, Kazui\./.test(canonStartWords(next)), 'the note rides without it');
  eq(next.checkedFp, startCheckPrint(next, WIKI), 'checked as it now stands — not asked again');
  assert(startCheckPrint(next, [...WIKI, 'Rukia Kuchiki — captain of the 13th Division']) !== next.checkedFp, 'a new line of the wiki: asked again');
  const his = { ...START, words: 'Where our story began: my own words, Zaraki and all.' };
  eq(applyStartCheck(his, [1], WIKI), his, 'his own correction stands as he wrote it');
  let asked = 0;
  const out = await checkCanonStart({ connection: { id: 'c' }, start: START, wiki: WIKI, callLLM: async (c, { user }) => { asked += 1; assert(user.includes('2. Kenpachi Zaraki'), 'it reads the facts'); return { text: '{"wrong":[2]}' }; } });
  eq(asked, 1); eq(JSON.stringify(out), '{"wrong":[1]}');
  eq(await checkCanonStart({ connection: { id: 'c' }, start: START, wiki: WIKI, callLLM: async () => { throw new Error('down'); } }), null, 'a failed call changes nothing');
  let none = 0;
  eq(await checkCanonStart({ connection: { id: 'c' }, start: START, wiki: [], callLLM: async () => { none += 1; return { text: '{"wrong":[2]}' }; } }), null, 'nothing looked up: never asked');
  eq(none, 0);
});
