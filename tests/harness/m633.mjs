/* M633 — his: "a manual random benchmark: I tick 1–4 connections, press it, a random story is written by each and graded;
 * and several judges, averaged". Laws RUN the request's replay shape. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { neutralRequest } from '../../js/agents/benchrun.js';

test('M633-1 A KEPT REQUEST IS REPLAYED AS IT WAS SENT — OpenAI\u2019s messages or Anthropic\u2019s system and messages back to system blocks and messages; the late system words kept in place; the original\u2019s prefill left off for each storyteller\u2019s own', () => {
  const oa = neutralRequest({ model: 'x', messages: [
    { role: 'system', content: 'FRAME' }, { role: 'system', content: 'CRAFT' },
    { role: 'user', content: 'I wait.' }, { role: 'assistant', content: 'The gate was quiet.' },
    { role: 'user', content: 'I knock.' }, { role: 'system', content: 'CLOSING WORDS' }, { role: 'assistant', content: '[The gate' },
  ] });
  eq(oa.systemBlocks.map((b) => b.text).join('|'), 'FRAME|CRAFT', 'the leading system messages are the system blocks');
  eq(oa.messages.map((m) => m.role + ':' + m.content).join('|'), 'user:I wait.|assistant:The gate was quiet.|user:I knock.|system:CLOSING WORDS', 'the story and the closing words, the prefill left off');
  const an = neutralRequest({ model: 'y', system: [{ type: 'text', text: 'FRAME' }, { type: 'text', text: 'CRAFT', cache_control: { type: 'ephemeral' } }], messages: [
    { role: 'user', content: [{ type: 'text', text: 'I wait.' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Quiet.' }] }, { role: 'user', content: [{ type: 'text', text: 'I knock.' }] },
  ] });
  eq(an.systemBlocks.map((b) => b.text).join('|'), 'FRAME|CRAFT', 'Anthropic\u2019s system blocks');
  eq(an.messages.map((m) => m.role + ':' + m.content).join('|'), 'user:I wait.|assistant:Quiet.|user:I knock.', 'its messages, their text parts joined');
  assert(neutralRequest(null).messages.length === 0, 'nothing kept: nothing to replay');
});

test('M634-1 A STORYTELLER OR A JUDGE PAST ITS TIME IS LET GO, NOT WAITED FOR — the limit ends the one call, the run\u2019s own Stop ends every one, and a call done in time is left alone', async () => {
  const { limited } = await import('../../js/agents/benchrun.js');
  const short = limited(null, 30);
  await new Promise((r) => setTimeout(r, 60));
  assert(short.signal.aborted && short.timedOut(), 'past its time: ended, and said so');
  short.done();
  const run = new AbortController();
  const one = limited(run.signal, 60000);
  run.abort(new Error('stopped by hand'));
  assert(one.signal.aborted && !one.timedOut(), 'the run stopped: ended, and not as out of time');
  one.done();
  const quick = limited(null, 50);
  quick.done();
  await new Promise((r) => setTimeout(r, 80));
  assert(!quick.signal.aborted, 'done in time: never ended');
});
