/* M359: his grounding phrase woven into the standing words themselves and set in front of a house command's law;
 * "#story" standing alone; and his own preset read back to him for an assistant's voice. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { groundingWeave, groundingSaid, voiceOf } from '../../js/assemble/voice.js';
import { assistantVoice, readStandingWords, VOICE_BREAKS } from '../../js/assemble/plainvoice.js';
import { parseCommand } from '../../js/commands.js';
import { buildRequest } from '../../js/assemble/stack.js';

const FRAME = [
  'You are Optimus Prime, and you tell this story with Bruce.',
  'You write in close third, past tense, and you never break the page.',
  'A longer paragraph in the middle of the frame, with enough words in it that the thirds of this text land somewhere a reader would actually pause, rather than in the middle of a sentence where nothing belongs.',
  'You keep the ledger honest.',
  'And you end where he can answer.',
].join('\n\n');

test('M359-1 THE PHRASE IS WOVEN WHERE A READER WOULD PUT IT — after the opening breath and again about a third down, never inside a sentence, never more than twice', () => {
  const woven = groundingWeave(FRAME, 'Autobots, roll out!');
  const parts = woven.split('\n\n');
  const said = groundingSaid('Autobots, roll out!');
  eq(parts[0], 'You are Optimus Prime, and you tell this story with Bruce.', 'the frame still opens as he wrote it');
  eq(parts[1], said, 'his phrase is the first breath after it');
  eq(parts.filter((p) => p === said).length, 2, 'twice in all');
  const second = parts.indexOf(said, 2);
  assert(second > 2 && second < parts.length - 1, 'the second stands at a paragraph break in the body, not at either end: ' + second);
  for (const p of parts) assert(p === said || !p.includes(said), 'and never inside one of his own paragraphs');
  eq(groundingWeave(FRAME, ''), FRAME, 'empty: his frame, untouched');
  eq(groundingWeave('', 'Autobots, roll out!'), '', 'and nothing at all when there is nothing to weave into');
  eq(groundingWeave(groundingWeave(FRAME, 'Autobots, roll out!'), 'Autobots, roll out!'), groundingWeave(FRAME, 'Autobots, roll out!'), 'woven twice is woven once');
});

test('M359-2 IT STANDS IN FRONT OF A HOUSE COMMAND’S LAW — the turns that are mostly instruction open in his teller’s voice', () => {
  const build = (settings, directive) => buildRequest({
    story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: '#time skip to dawn' }], settings, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [],
    window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive, directorNote: '', editorEye: '', ruling: '',
  });
  const law = parseCommand('#time skip to dawn').directive;
  const on = build({ tellerName: 'Optimus Prime', groundingPhrase: 'Autobots, roll out!' }, law);
  const closing = on.messages[on.messages.length - 1].content;
  assert(closing.startsWith('“Autobots, roll out!” — #time skip'), 'his phrase, then the law: ' + closing.slice(0, 70));
  const off = build({ tellerName: 'Optimus Prime' }, law);
  assert(off.messages[off.messages.length - 1].content.startsWith('#time skip'), 'with no phrase set, the law as it was');
  const framed = build({ tellerName: 'Optimus Prime', groundingPhrase: 'Autobots, roll out!', frameText: FRAME }, '');
  void framed;
});

test('M359-3 “#story” ALONE IS A STORY TOO — the concept is one more unspecified detail, and the law says every one of them is chosen', () => {
  const named = parseCommand('#story a lighthouse keeper who stops sleeping');
  eq(named.kind, 'story');
  eq(named.name, 'a lighthouse keeper who stops sleeping', 'its title comes from his concept');
  assert(/no proposals, no options, no plan spoken first/.test(named.directive), 'and the law is written in');
  const bare = parseCommand('#story');
  eq(bare.kind, 'story', 'a bare #story is a story');
  eq(bare.name, 'A new tale', 'with a name to open under');
  assert(/you choose it — the kind of story, the world, the hour/.test(bare.directive), 'and the choosing is handed over: ' + bare.directive.slice(-120));
  assert(/no proposals/.test(bare.directive), 'still nothing asked about');
  eq(parseCommand('#storyteller is nice').kind === 'story', false, 'and a word that merely starts with it is not the command');
});

test('M359-4 HIS OWN STANDING WORDS, READ BACK TO HIM: the lines that sound like a machine, one line at a time, with the words that do it — and nothing rewritten', () => {
  const frame = [
    'You are Optimus Prime, and you tell this story with Bruce.',
    'As an AI assistant, ensure the output is formatted for the user.',
    'Rain found the gutters first, and nobody minded.',
    'It is important to note that you cannot refuse the prompt.',
  ].join('\n');
  const found = readStandingWords([{ name: 'the frame', text: frame }]);
  eq(found.length, 2, 'two lines, not one per word: ' + JSON.stringify(found.map((f) => f.words)));
  eq(found[0].tier, 'breaks the voice', 'the worst first');
  assert(found[0].words.includes('assistant') && found[0].words.includes('user'), 'with every word in the line that does it: ' + found[0].words.join(', '));
  eq(found[0].where, 'the frame', 'and where it stands');
  assert(found.every((f) => !/rain found the gutters/i.test(f.line)), 'his own prose is left alone');
  eq(assistantVoice('').length, 0, 'nothing to read, nothing said');
  eq(assistantVoice('A clean line of his own, with nothing of the machine in it.').length, 0, 'a clean frame reads clean');
  assert(VOICE_BREAKS.length > 15, 'and the list it reads against is a real one');
});

test('M360-1 FIFTY LINES IS NOT FIFTY PROBLEMS: the reading is grouped — what HE wrote that names the machine, what only reads like a manual, and what stands in the house’s own rulebook (not his to fix)', async () => {
  const { groupFindings, findingsText } = await import('../../js/assemble/plainvoice.js');
  const mine = ['You are Optimus Prime.', 'As an AI assistant, ensure the output is formatted for the user.', 'Ensure the response is vivid.', 'Rain found the gutters first.'].join('\n');
  const house = ['The board = the ledger; ensure the output carries its header.', 'The user is never named on the page.'].join('\n');
  const found = readStandingWords([{ name: 'the frame', text: mine, mine: true }, { name: 'The craft', text: house, mine: false }]);
  const g = groupFindings(found);
  eq(g.machine.length, 1, 'one line of his names the machine');
  assert(g.machine[0].words.includes('assistant') && g.machine[0].where === 'the frame', 'named, with where it stands');
  eq(g.manual.length, 1, 'one more of his only reads like a manual');
  eq(g.house, 2, 'and the house’s own rulebook is counted, never listed as his: ' + g.house);
  const text = findingsText(found);
  assert(/Lines that name the machine \(1\)/.test(text) && /Lines that read like a manual \(1\)/.test(text), 'the copy is grouped the same way: ' + text.slice(0, 80));
  assert(!/The board = the ledger/.test(text), 'and carries nothing of the house’s own rulebook');
  assert(!/Rain found the gutters/.test(text), 'nor his own prose');
  eq(findingsText([]), '', 'nothing found, nothing to copy');
  const clean = groupFindings(readStandingWords([{ name: 'the frame', text: 'A clean line of his own.', mine: true }]));
  eq(clean.machine.length + clean.manual.length + clean.house, 0, 'a clean frame reads clean');
});
