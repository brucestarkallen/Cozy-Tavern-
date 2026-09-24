/* M458: (1) a word of another language in the page's own letters is never drift — he told her to moan in Japanese and
 * the second reader had her "yamete" mended to "stop, stop"; (2) the marks of speech and stress are made whole in code.
 * Runs the real second reader (a scripted model) and the real page tidy. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { checkTurn, buildContinuityMessages, languageFinding } from '../../js/agents/continuity.js';
import { mendMarks, tidyPage } from '../../js/ui/pageshape.js';

const scene = () => applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan Oda' }, ...['Jovan Oda', 'Rukia Kuchiki'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
const PAGE = 'Rukia arched against him. “Yamete… yamete—” The word broke on a gasp.';
const ASK = 'I whisper to her: moan for me in Japanese.';
const streamed = (answer) => async () => {
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
};

test('M458-1 ANOTHER LANGUAGE IN THE PAGE’S OWN LETTERS IS NEVER DRIFT — the reader is shown what he asked for; a finding calling her romaji drift is let go, while a real run of another script and every other finding stand', async () => {
  const m = buildContinuityMessages({ state: scene(), assistantText: PAGE, userText: ASK });
  assert(m.user.includes(ASK) && /never drift/.test(m.user), 'his turn rides as the story itself');
  assert(/NEVER DRIFT when it is written in the page/.test(m.system), 'the law');
  const answer = JSON.stringify({ findings: [
    { severity: 'warn', words: 'Rukia moans in Japanese ("yamete") though she is not established as speaking Japanese', fix: 'stop, stop' },
    { severity: 'warn', words: 'Rukia’s eyes are called blue; they are violet', fix: 'violet' }] });
  const r = await withHouse({ fetch: streamed(answer) }, () => checkTurn({ connection: HOUSES[0].conn, state: scene(), assistantText: PAGE, userText: ASK }));
  eq(r.findings.length, 1, 'the language finding let go: ' + JSON.stringify(r.findings));
  assert(/violet/.test(r.findings[0].fix), 'the other one stands');
  eq(languageFinding({ words: 'a run of Chinese text inside an English sentence', fix: 'remove' }, 'She said 我们走 and left.', ''), false, 'a real glitch of the wire stands');
  eq(languageFinding({ words: 'she speaks Japanese', fix: 'x' }, 'She said 私は.', ASK), true, 'even in its own script, when he asked for it');
});

test('M458-2 THE MARKS MADE WHOLE IN CODE — asterisks around speech, empty quotes, a quote or an asterisk left open; long speech, feet and inches, and a whole page untouched to the letter', () => {
  const rows = [
    ['She whispered *"come here"* and waited.', 'She whispered "come here" and waited.'],
    ['He grinned. *""*', 'He grinned.'],
    ['Rukia gasped. “Yamete—\n\nHe did not stop.', 'Rukia gasped. “Yamete—”\n\nHe did not stop.'],
    ['“The first part of a long speech.\n\n“And the rest.”', '“The first part of a long speech.\n\n“And the rest.”'],
    ['He said "stop', 'He said "stop"'],
    ['*She smiled at him.', '*She smiled at him.*'],
    ['He was 5\'9" tall and grinned.', 'He was 5\'9" tall and grinned.'],
  ];
  for (const [a, want] of rows) eq(mendMarks(a).text, want, JSON.stringify(a));
  const whole = '[Office | 09:00]\n\nA page with a trailing space.  \n\nAnd  two spaces, "Hello," she said. *Soft.*';
  eq(tidyPage(whole).text, whole, 'a whole page comes back to the letter');
  eq(JSON.stringify(tidyPage('[Tenth Division Courtyard | 09:20]\n\nShe said *"yamete"* softly.')), JSON.stringify({ text: '[Tenth Division Courtyard | 09:20]\n\nShe said "yamete" softly.', did: ['marks'] }), 'a page with a header');
});
