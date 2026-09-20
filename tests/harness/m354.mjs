/* M354: HELP FOR A SMALL MODEL, ALL OF IT BEHIND THE DERESTRICTED SWITCH. His 27B model's own card says where it loses:
 * hostile storytelling and long story turns — a model tuned to hand people a finished piece softens whoever is against
 * him and, on a long turn, finishes the scene by speaking and moving his character for him. With the switch ON: five
 * plain lines at the end, and a page that took his character asked for again, once. With it OFF: not one byte of it. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { plainRules, mineLeak, mineNames, echoesWriter } from '../../js/assemble/plain.js';
import { askAgain } from '../../js/assemble/voice.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const ledger = () => applyMutations({ ...emptyState(), page: 6 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }]).state;
const build = (settings) => buildRequest({
  story: { brief: 'A tale.' }, messages: [{ id: 'u1', role: 'user', text: 'I step into the courtyard.' }], settings,
  state: ledger(), modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 },
  directive: '', directorNote: '', editorEye: '', ruling: '',
});

test('M354-1 THE FIVE PLAIN LINES RIDE ONLY WITH THE SWITCH ON — and the turn with it off is byte for byte the turn before any of this existed', () => {
  const off = build({ tellerName: 'Iron Man', writerName: 'Bruce' });
  const on = build({ tellerName: 'Iron Man', writerName: 'Bruce', olderModelNow: true });
  const offAll = JSON.stringify({ system: off.systemBlocks, messages: off.messages });
  assert(!/is mine\./.test(offAll) && !/five things/.test(offAll), 'OFF: not one word of it');
  const closing = on.messages[on.messages.length - 1].content;
  assert(/Iron Man — while we tell this one, five things/.test(closing), 'ON: said to the teller by name, in his own voice: ' + closing.slice(0, 90));
  for (const law of ['Jovan is mine', 'stays set against him', 'Let the room talk', 'End where I can act', 'Stay in the moment']) assert(closing.includes(law), 'ON: ' + law);
  /* and nothing else moved: the turn is the OFF turn plus the scene line and these lines */
  const offClosing = off.messages[off.messages.length - 1].content;
  eq(JSON.stringify(off.messages.slice(0, -1)), JSON.stringify(on.messages.slice(0, -1)), 'every other message is untouched');
  eq(JSON.stringify(off.systemBlocks), JSON.stringify(on.systemBlocks), 'and so is everything standing');
  assert(on.messages[on.messages.length - 1].content.includes(offClosing.split('\n\n').pop()), 'the closing words keep what they had');
});

test('M354-2 HIS CHARACTER’S OWN WORDS, THOUGHTS AND MOVES ARE SEEN — in every shape a page writes them', () => {
  const his = (page, writerText = '') => mineLeak(page, { mc: 'Jovan', also: ['Jovan Wells'], writerText });
  eq(his('"Fine," Jovan said, and the courtyard went quiet.'), 'gave him words of his own', 'his line, after it');
  eq(his('Jovan said, "Fine. But not today."'), 'gave him words of his own', 'his line, before it');
  eq(his('"Fine," said Jovan.'), 'gave him words of his own', 'his line, the other way round');
  eq(his('Jovan Wells muttered, "Not while I breathe."'), 'gave him words of his own', 'under the fuller name the ledger knows');
  eq(his('Jovan thought about the bag and decided to keep it on.'), 'thought and decided for him', 'his thinking');
  eq(his('Jovan stepped back from the fire.'), 'moved him without me', 'his move');
});

test('M354-3 AND WHAT IS NOT HIS IS LEFT ALONE: his name in the scene, in someone else’s mouth, and the move he himself just wrote', () => {
  const his = (page, writerText = '') => mineLeak(page, { mc: 'Jovan', writerText });
  eq(his('Kaelen raised his sword. "Then show me," he said.'), '', 'someone else speaking');
  eq(his('Kaelen watched Jovan for a long moment, then turned to the gate.'), '', 'someone else moving, with his name in the sentence');
  eq(his('Jovan’s hand was still bleeding.'), '', 'his body, described');
  eq(his('"Jovan, wait," she said.'), '', 'his name inside her line');
  eq(his('Jovan stepped back from the fire.', 'I step back from the fire.'), '', 'the move he wrote himself');
  eq(his('Jovan took the knife off the table and weighed it.', 'I take the knife off the table.'), '', 'the move he wrote, in other tenses');
  eq(his('"Morning," Jovan said, the bag rustling.', 'I nod, the bag rustling. "Morning."'), '', 'the line he wrote himself, given back');
  eq(his('anything at all', ''), '', 'and nothing at all when his character has no name');
  eq(mineLeak('"Fine," Jovan said.', { mc: 'the player' }), '', 'nor when the ledger does not know who he plays');
  eq(JSON.stringify(mineNames('Jovan', ['Jovan Wells', 'jovan', ''])), JSON.stringify(['Jovan', 'Jovan Wells']), 'his names, once each');
  eq(echoesWriter('he steps back from the fire', 'I step back from the fire'), true, 'a fragment weighed against his own words');
  eq(echoesWriter('she draws a knife from her boot', 'I step back from the fire'), false, 'and one that is nothing like them');
});

test('M354-4 (as M357 changed it) WHAT THE HOUSE SAW IS SAID BEFORE THE NEXT PAGE, in one sentence in his voice — the page that landed is never sent back', async () => {
  const { mineWord } = await import('../../js/assemble/plain.js');
  const words = mineWord('gave him words of his own', 'Jovan');
  assert(/^That last page gave him words of his own — Jovan is mine to play\./.test(words), 'it names what it saw and whose he is: ' + words);
  assert(/Leave his words, his thoughts and his moves to me from here\./.test(words), 'and what to do from here');
  assert(!/again|rewrite|same beat/i.test(words), 'and never asks for that page back');
  assert(!/format|template|example|paragraph|word count/i.test(words), 'nor says anything about shape');
  eq(mineWord('', 'Jovan'), '', 'nothing seen, nothing said');
  const plain = plainRules('Jovan');
  assert(!/\d/.test(plain) && !/format|structure|template/i.test(plain), 'nor do the five lines');
});

/* ---- M355: the same words again ---- */
/* filler with no six-word run in common, and none inside itself — the detector is meant to catch a repeated frame, so
 * the fixtures must not have one */
const LINES = [
  'Rain found the gutters first.', 'A dog barked twice somewhere past the wall.', 'Someone had left a bucket upturned by the well.',
  'The bell in the tower was three minutes fast, as always.', 'Wool smoke hung low over the roofs of the lower town.',
  'Two apprentices argued about a broken strap.', 'Salt crusted the step where the fish cart stood at dawn.',
  'A shutter banged, then quieted.', 'The baker’s boy went by with his tray held high.', 'Somebody was singing badly, four streets off.',
  'Ash drifted from a chimney that should have been cold.', 'An old woman counted coppers into her palm.',
  'Pigeons lifted off the granary roof together.', 'A cart wheel had shed its iron rim near the fountain.',
  'Chalk numbers climbed the wall beside the cooper’s door.', 'Nobody had swept the arcade since the feast.',
  'A cat considered the fish cart from under a bench.', 'The well rope creaked in its bracket.',
  'Someone’s laundry snapped like a flag above the lane.', 'Bees worked the vine over the south arch.',
];
const fresh = (n, from = 0) => LINES.slice(from, from + n).join(' ');

test('M355-1 A PAGE THAT SAYS WHAT WAS ALREADY SAID IS SEEN, and the phrase it reused is named — his own words and the room’s names never count', async () => {
  const { staleLeak, echoedPhrases } = await import('../../js/assemble/plain.js');
  const before = ['The air was thick with the smell of wet stone, and Kaelen waited by the gate. ' + fresh(10, 10)];
  const said = staleLeak('The air was thick with the smell of wet stone again, and he knew it. ' + fresh(10, 0), before, { names: ['Kaelen', 'Jovan'] });
  eq(said.length, 1, 'one phrase, not the three overlapping ways to say it: ' + JSON.stringify(said));
  assert(/air was thick with the smell of wet stone/.test(said[0]), 'named as it was written: ' + said[0]);
  eq(staleLeak('Rain found the gutters first, and the practice swords went back on their rack. ' + fresh(10, 0), before, { names: ['Kaelen', 'Jovan'] }).length, 0, 'a page that says something new is left alone');
  eq(staleLeak('The air was thick with the smell of wet stone.', before).length, 0, 'a short page is not judged for repeating itself');
  const his = 'I step into the courtyard where the practice swords lay stacked.';
  eq(echoedPhrases('He stepped into the courtyard where the practice swords lay stacked, and the rain went on. ' + fresh(10, 0), ['He stepped into the courtyard where the practice swords lay stacked by the wall.'], { writerText: his }).length, 0, 'the page giving HIS words back is not a repeat');
  const twice = 'She turned the lamp down until the room was the colour of weak tea, and said nothing. ' + fresh(5, 0) + ' She turned the lamp down until the room was the colour of weak tea. ' + fresh(5, 10);
  assert(echoedPhrases(twice, []).some((p) => /turned the lamp down until the room/.test(p)), 'and a page that repeats ITSELF is seen too: ' + JSON.stringify(echoedPhrases(twice, [])));
});

test('M355-2 (as M357 changed it) THE PHRASES ARE NAMED IN THE LINE SAID BEFORE THE NEXT PAGE — one sentence, his voice, nothing about shape', async () => {
  const { staleWord } = await import('../../js/assemble/plain.js');
  const words = staleWord(['air was thick with the smell of wet stone', 'a long moment passed between them']);
  assert(/^The last page said what we had already said — “air was thick/.test(words), 'it names the phrase: ' + words.slice(0, 80));
  assert(words.includes('a long moment passed between them'), 'both of them');
  assert(/Find other words for it this time/.test(words), 'and asks for other words next time');
  assert(!/same beat|write it again/i.test(words), 'never for that page again');
  assert(!/format|paragraph|template|word count|\d/.test(words), 'and nothing about the page’s shape');
  eq(staleWord([]), '', 'nothing repeated, nothing said');
});
