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

test('M359-2 (as M375 changed it) A HOUSE COMMAND’S LAW GOES AS IT IS — no quotation glued to its front (his teller’s thinking had started calling it “the wrapper”)', () => {
  const build = (settings, directive) => buildRequest({
    story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: '#time skip to dawn' }], settings, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [],
    window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive, directorNote: '', editorEye: '', ruling: '',
  });
  const law = parseCommand('#time skip to dawn').directive;
  const on = build({ tellerName: 'Optimus Prime', groundingPhrase: 'Autobots, roll out!' }, law);
  const closing = on.messages.filter((m) => m.role === 'user').slice(-1)[0].content;
  assert(closing.startsWith('#time skip'), 'the law, as it is: ' + closing.slice(0, 60));
  assert(!/Autobots, roll out!/.test(closing), 'with nothing of the phrase glued to it');
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

test('M361-1 SILLYTAVERN’S NAMES ARE SWAPPED FOR HIS, AS SILLYTAVERN DOES: {{user}} is the one he plays, {{char}} the teller — never a raw macro on the wire', async () => {
  const { withMacros, inVoice } = await import('../../js/assemble/voice.js');
  const names = { teller: 'Optimus Prime', writer: 'LO', mc: 'Jovan' };
  eq(withMacros('Contact Trigger: IF any contact occurs with {{user}} -> describe it.', names), 'Contact Trigger: IF any contact occurs with Jovan -> describe it.', '{{user}} is the one he plays');
  eq(withMacros('{{char}} narrates; <BOT> never speaks for <USER>.', names), 'Optimus Prime narrates; Optimus Prime never speaks for Jovan.', 'and {{char}}, <BOT>, <USER>');
  eq(withMacros('{{ User }} and {{CHAR}}', names), 'Jovan and Optimus Prime', 'however they are spelled');
  eq(withMacros('{{user}} waits.', { writer: 'LO' }), 'LO waits.', 'before the story names his character, his own name');
  eq(withMacros('{{user}} waits, and {{char}} watches.', {}), 'the one I play waits, and the storyteller watches.', 'and with no name at all, plain words — never a macro');
  eq(withMacros('No macros here.', names), 'No macros here.', 'text without them is untouched');
  assert(!/\{\{/.test(inVoice('A rule for {{user}} from {{char}}.', names)), 'and every voiced word goes out without them');
  /* the whole standing word, as the storyteller gets it */
  const r = buildRequest({
    story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I wait.' }],
    settings: { tellerName: 'Optimus Prime', writerName: 'LO', frameText: 'You are {{char}}. You tell the story of {{user}}.' },
    state: { sheet: { playerName: 'Jovan', actors: {} } }, modules: [], memory: '', cast: [], lore: '', loreFired: [],
    window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '',
  });
  const wire = JSON.stringify(r.systemBlocks) + JSON.stringify(r.messages);
  assert(!/\{\{\s*(user|char)\s*\}\}/i.test(wire), 'not one macro reaches the storyteller');
});

test('M361-2 THE READING SEES HIS WORDS AS THEY WILL BE SENT, AND HANDS OVER WHOLE LINES', async () => {
  const { withMacros } = await import('../../js/assemble/voice.js');
  const { findingsText } = await import('../../js/assemble/plainvoice.js');
  const names = { teller: 'Optimus Prime', writer: 'LO', mc: 'Jovan' };
  const text = 'Contact Trigger: IF any sensation or contact occurs with {{user}} -> ALWAYS describe the physiological feeling.';
  eq(readStandingWords([{ name: 'Hybrid POV', text: withMacros(text, names), mine: true }]).length, 0, '{{user}} is Jovan by the time it is read — not "user"');
  const long = 'Scope Exception = this module overrides the Main Prompt for one layer ONLY; ' + 'all narration stays as it was, and nothing else about the page changes at all. '.repeat(3);
  const found = readStandingWords([{ name: 'Hybrid POV', text: long, mine: true }]);
  assert(found[0].line.endsWith('…'), 'the list on screen stays short');
  assert(findingsText(found).includes(long.trim()), 'but what is copied is the whole line, so it can be rewritten');
});


test('M363-1 A CROWD OF ACCOUNTS IS NOT HIM: “User Pool Array” on an in-story feed is left alone, while “the user” still is flagged', () => {
  eq(assistantVoice('User Pool Array:[').length, 0, 'the feed’s pool of accounts');
  eq(assistantVoice('Select = Random(Quantity=5, Source=User Pool Array)').length, 0, 'and the line that picks from it');
  eq(assistantVoice('Each user account posts once; every user handle is lowercase.').length, 0, 'an account, a handle');
  eq(assistantVoice('Describe it for the user.').length, 1, 'but “the user” is still him, and still flagged');
  eq(assistantVoice('The user decides what happens next.')[0].why, 'calls him the user', 'with the reason said');
});
