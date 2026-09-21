/* M339 — a reply that is the teller thinking is never a page; and the switch: let a model that cannot think, think on its page. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, STARTER_NOTE } from '../../js/assemble/stack.js';
import { thinkOnPageLine } from '../../js/assemble/voice.js';
import { emptyState } from '../../js/engine/state.js';

const build = (settings) => buildRequest({ story: {}, messages: [{ id: 'u1', role: 'user', text: 'It seems we got plus one?' }], settings: { noteText: STARTER_NOTE, frameText: 'You are Tony Stark.', ...settings }, state: { ...emptyState(), page: 2 }, modules: [], memory: '', window: { keeperOn: true } });

test('M339-1 THE SWITCH, OFF (as it ships): not one byte of the request changes', () => {
  const plain = JSON.stringify(build({}));
  eq(JSON.stringify(build({ thinkOnPageNow: false })), plain);
  eq(JSON.stringify(build({ thinkOnPageNow: undefined })), plain);
  eq(JSON.stringify(build({ thinkOnPageNow: 'yes' })), plain, 'only a true `true` turns it on');
  assert(!/<think>/.test(plain), 'and nothing speaks of think-tags');
});

test('M339-2 THE SWITCH, ON: the closing message asks the teller to think first inside a think-tag and then write the page — the note still has the last word; it is the writer speaking, so it says "you" whatever person the teller thinks in, and greets the teller by name', () => {
  const r = build({ thinkOnPageNow: true });
  const last = r.messages[r.messages.length - 1].content;
  assert(/Think it through first, inside <think> and <\/think> — in your own voice/.test(last) && /Only what comes after <\/think> is the page; never stop before it\./.test(last), last.slice(0, 200));
  assert(last.trimEnd().endsWith(STARTER_NOTE.trim()) && last.indexOf('<think>') < last.indexOf(STARTER_NOTE.trim()), 'before the note, which stays last');
  eq(r.messages.filter((m) => m.role === 'user' && /<think>/.test(m.content)).length, 1, 'said once, in one place');
  assert(!r.systemBlocks.some((b) => /<think>/.test(b.text)), 'never in the rules — it is this turn’s word, not a law');
  const named = build({ thinkOnPageNow: true, tellerName: 'Tony Stark', writerName: 'Bruce', frameText: 'I am Tony Stark. I tell Bruce stories.' });
  assert(/Tony Stark — think it through first, inside <think> and <\/think> — in your own voice/.test(named.messages[named.messages.length - 1].content), 'by name, and "you": ' + named.messages[named.messages.length - 1].content.slice(0, 120));
  assert(/^Think it through first/.test(thinkOnPageLine({})) && /^Steve — think it through first/.test(thinkOnPageLine({ teller: 'Steve' })));
});

test('M339-3 the words that ask for the page after the teller only thought it over — never "you ran out of room", which it did not', () => {
});
