/* M354: HELP FOR A SMALL MODEL, ALL OF IT BEHIND THE DERESTRICTED SWITCH. His 27B model's own card says where it loses:
 * hostile storytelling and long story turns — a model tuned to hand people a finished piece softens whoever is against
 * him and, on a long turn, finishes the scene by speaking and moving his character for him. With the switch ON: five
 * plain lines at the end, and a page that took his character asked for again, once. With it OFF: not one byte of it. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { mineLeak, mineNames, echoesWriter } from '../../js/assemble/plain.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const ledger = () => applyMutations({ ...emptyState(), page: 6 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }]).state;
/* M622: the house's thinking note rides by default — switched off here, this law is about what else stands after his message */
const build = (settings) => buildRequest({
  story: { brief: 'A tale.' }, messages: [{ id: 'u1', role: 'user', text: 'I step into the courtyard.' }], settings: { noteAdds: [{ id: 'house-cot', on: false }], ...settings },
  state: ledger(), modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 },
  directive: '', directorNote: '', editorEye: '', ruling: '',
});

/* M510 retired the five lines (one fought his #p — "several real exchanges" against "exactly ONE beat" —, one asked for
 * "plain words" against his onomatopoeia law, one said "nothing else from me" before his own instructions). What stands
 * of this law: the small-model mode ON adds ONLY its closing words — everything before them is the OFF turn, byte for
 * byte — and not one of the five lines rides. */
test('M354-1 (as M510 changed it) THE SMALL-MODEL MODE ADDS ONLY ITS CLOSING WORDS — the turn with it off is byte for byte the turn before any of this existed, and the five plain lines never ride again', () => {
  const off = build({ tellerName: 'Iron Man', writerName: 'Bruce' });
  const on = build({ tellerName: 'Iron Man', writerName: 'Bruce', smallModelNow: true });
  const onAll = JSON.stringify({ system: on.systemBlocks, messages: on.messages });
  for (const law of ['five things', 'is mine.', 'stays set against him', 'Let the room talk', 'End where I can act', 'Stay in the moment', 'plain words']) assert(!onAll.includes(law), 'retired, never sent: ' + law);
  const closing = on.messages[on.messages.length - 1].content;
  assert(/right now, so it is in front of you/i.test(closing), 'ON (no plan yet): the scene said once more, last: ' + closing.slice(0, 90));
  const onRest = on.messages.slice(0, -1);
  eq(JSON.stringify(off.messages.slice(0, onRest.length)), JSON.stringify(onRest), 'every other message is untouched');
  eq(JSON.stringify(off.systemBlocks), JSON.stringify(on.systemBlocks), 'and so is everything standing');
  eq(String(off.messages[off.messages.length - 1].content), 'I step into the courtyard.', 'OFF: his own words are the last thing it reads (M379)');
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
});

/* M355 (the same words again) was retired at M510 with its detector: it quoted the repeated phrase back to the model, and
 * the connection's own repetition penalties (M510's dials) do that job while the page is written. */
