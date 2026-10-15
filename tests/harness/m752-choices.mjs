/* Cozy Tavern — harness laws of M752 (followup 13): CHOICES MATTER IS HANDED THE WHOLE OF WHAT THE STORYTELLER SAW.
 * HIS (15 October 2026): "if it doesn't have the whole storyteller saw and create predetermined outcome, how can it create
 * realistic predetermined outcome? And the preset have so many important things like anti positivity bias … that prevent the
 * core bias of model." The helper that seals what follows each choice was handed a summary (brief, record, ledger, people,
 * six pages) and none of his preset, cast notes, world, lore, canon or rules.
 *   CH1  from the request the newest page was written from (either provider's shape): everything above the history in the
 *        system role, his preset first; the history as sent; the newest page as the storyteller's own turn; the question last,
 *        with where things stand now and what his earlier choices set in motion — and, cut to a smaller model's room, the
 *        oldest turns go first, never the preset or the newest page
 *   CH2  the helper is called with exactly that conversation; with no kept request, the story's summary still carries the
 *        cast notes
 * New code is reached through module namespaces, so this file loads against the tree before M752 (followup 13). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import * as choices from '../../js/agents/choices.js';
import { packageFromRequest } from '../../js/agents/sensors.js';

const PRESET = 'PRESET: there is no positivity bias here — people act by their natures, and kindness is not rewarded for being kind.';
const CAST = 'THE CAST NOTES: Kaelen never forgives a slight in front of the yard.';
const NOTE = 'THE NOTE AT THE END: write the page in the present tense.';
const openaiKept = { model: 'm', messages: [
  { role: 'system', content: PRESET }, { role: 'system', content: CAST },
  { role: 'user', content: 'I circle him.' }, { role: 'assistant', content: 'Kaelen raised his practice sword.' },
  { role: 'user', content: 'I feint low.' }, { role: 'system', content: NOTE },
] };
const anthropicKept = { model: 'm', system: [{ type: 'text', text: PRESET }, { type: 'text', text: CAST }], messages: [
  { role: 'user', content: 'I circle him.' }, { role: 'assistant', content: 'Kaelen raised his practice sword.' },
  { role: 'user', content: [{ type: 'text', text: 'I feint low.' }] },
] };
const NEWEST = 'Kaelen saw the feint coming and smiled. "Again," he said, and the whole yard was watching.';

test('M752-CH1 THE CHOICES HELPER IS HANDED WHAT THE STORYTELLER WAS HANDED (it read a summary, and none of his preset): from the newest page’s own request, in either provider’s shape — the preset first in the system role with everything else above the history, the history as sent, the newest page as the storyteller’s turn, then the question with where things stand now and his earlier choices’ echoes; cut to a smaller room, the oldest turns go and the preset and the newest page stay', () => {
  eq(typeof choices.choiceAskWhole, 'function', 'the helper can be handed the storyteller’s request');
  for (const [shape, kept] of [['openai', openaiKept], ['anthropic', anthropicKept]]) {
    const ask = choices.choiceAskWhole({ pkg: packageFromRequest(kept), newest: NEWEST, mc: 'Jovan', echoes: ['- (page 2) Kaelen — remembers the feint.'], facts: 'Here now: Jovan, Kaelen' });
    assert(ask && ask.system.startsWith(PRESET) && ask.system.includes(CAST), shape + ': the preset first, then all the storyteller was given, in the system role: ' + (ask && ask.system.slice(0, 200)));
    if (shape === 'openai') assert(ask.system.includes(NOTE), 'the closing note rides above the history too');
    eq(ask.messages.map((m) => m.role).join(' '), 'user assistant user assistant user', shape + ': the history as sent, the newest page, the question');
    eq(ask.messages[2].content, 'I feint low.', shape + ': his move, as sent');
    eq(ask.messages[3].content, NEWEST, shape + ': the newest page is the storyteller’s own turn');
    const q = ask.messages[4].content;
    assert(/^THE HOUSE'S QUESTION — this is not a page of the story/.test(q) && /keep the turning points of this story/.test(q), shape + ': the question last');
    assert(/WHERE THINGS STAND NOW \(the ledger, after this page\):\nHere now: Jovan, Kaelen/.test(q) && /remembers the feint/.test(q) && /Answer with ONLY this JSON/.test(q), shape + ': with the ledger as the page left it, his choices’ echoes and the answer’s shape');
  }
  /* a smaller model's room: the oldest turns go first; the preset (the head) and the newest page stay */
  const long = { model: 'm', messages: [{ role: 'system', content: PRESET + '\n' + 'x'.repeat(30000) + '\nTAIL-OF-INSTRUCTIONS' },
    ...Array.from({ length: 40 }, (_, i) => [{ role: 'user', content: 'move ' + i + ' ' + 'y'.repeat(800) }, { role: 'assistant', content: 'page ' + i + ' ' + 'z'.repeat(1500) }]).flat(),
    { role: 'user', content: 'my last move' }] };
  const fit = choices.choiceAskWhole({ pkg: packageFromRequest(long), newest: NEWEST, mc: 'Jovan', room: 30000 });
  const size = fit.system.length + fit.messages.reduce((n, m) => n + m.content.length, 0);
  assert(size <= 30000 + 200, 'held to the room: ' + size);
  assert(fit.system.startsWith(PRESET) && fit.system.includes('TAIL-OF-INSTRUCTIONS'), 'the preset kept at the head, the instructions’ end kept');
  eq(fit.messages[0].role, 'user', 'the history still opens with his turn');
  eq(fit.messages.at(-3).content, 'my last move', 'his last move kept');
  eq(fit.messages.at(-2).content, NEWEST, 'the newest page kept whole');
  eq(choices.choiceAskWhole({ pkg: null, newest: NEWEST }), null, 'no kept request: nothing to hand on');
});

test('M752-CH2 THE HELPER IS CALLED WITH THAT CONVERSATION — and with no kept request, the story’s summary still carries the cast notes (it was missing them: the people’s written natures)', async () => {
  const ask = choices.choiceAskWhole({ pkg: packageFromRequest(openaiKept), newest: NEWEST, mc: 'Jovan' });
  let seen = null;
  const answer = { turning: true, choices: [{ label: 'Laugh it off', move: 'I laugh.', outcome: 'Kaelen does not laugh.', echoes: [] }, { label: 'Walk away', move: 'I walk away.', outcome: 'The yard calls it running.', echoes: [] }] };
  const read = await choices.makeChoices({ connection: { id: 'c' }, ask, callLLM: async (conn, opts) => { seen = opts; return { text: JSON.stringify(answer) }; } });
  eq(read && read.options.length, 2, 'its answer is read');
  assert(seen && seen.system.startsWith(PRESET) && Array.isArray(seen.messages) && seen.messages.at(-2).content === NEWEST && !('user' in seen), 'called with the storyteller’s system and the conversation: ' + JSON.stringify(Object.keys(seen || {})));
  const fallback = choices.choiceAsk({ brief: 'BRIEF', castNotes: CAST, record: 'R', facts: 'F', people: 'P', pages: ['p'], newest: 'n', mc: 'Jovan' });
  assert(fallback.user.includes('THE CAST NOTES:') && fallback.user.includes('Kaelen never forgives'), 'the summary carries the cast notes');
});

test('M752-CH3 “I” OR “YOU” (HIS, 15 October 2026: “so it’s not always I do x but you do x”): the story’s setting decides how the helper is told to write each move — the first person as it shipped, the second person when he picks “You” — in the whole request and in the summary alike', () => {
  eq(typeof choices.choicesVoice, 'function', 'the setting is read');
  eq(choices.choicesVoice({}) + ' ' + choices.choicesVoice({ choicesVoice: 'you' }) + ' ' + choices.choicesVoice({ choicesVoice: 'odd' }), 'i you i', '“I” unless he picked “You”');
  const whole = (voice) => choices.choiceAskWhole({ pkg: packageFromRequest(openaiKept), newest: NEWEST, mc: 'Jovan', voice }).messages.at(-1).content;
  const summary = (voice) => choices.choiceAsk({ newest: 'n', mc: 'Jovan', voice }).system;
  for (const [name, ask] of [['whole', whole], ['summary', summary]]) {
    assert(/"move": what Jovan does[^\n]*the first person[^\n]*"I tell/.test(ask()) && !/the second person/.test(ask()), name + ': “I” as it shipped');
    assert(/"move": what Jovan does[^\n]*the second person, Jovan as "you"[^\n]*"You tell[^\n]*Never "I"/.test(ask('you')) && !/the first person/.test(ask('you')), name + ': “You” when he picks it');
  }
});
