/* M379: his message is the last thing the storyteller reads. A shortcut's law, the house's own starter note and the
 * continue nudge all rode as a SECOND user message after his — "#p", then "#p — exactly ONE beat…" — and a teller that
 * reads a second, instruction-shaped message after the writer's reads a system talking to an assistant. And: any name,
 * without rewriting the name his rules were written around. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, CONTINUE_NUDGE } from '../../js/assemble/stack.js';
import { shortcutsText, parseCommand } from '../../js/commands.js';

const HEAD = '[Kitchen — Monday | 09:00]\n\n';
const base = [{ id: 'u0', role: 'user', text: 'We begin.' }, { id: 'a0', role: 'assistant', text: HEAD + 'The kettle was cold.' }];
const build = (msgs, { settings = { tellerName: 'Tony Stark', writerName: 'Bruce' }, directive = '' } = {}) => buildRequest({
  story: { brief: '' }, messages: [...base, ...msgs], settings, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [],
  window: { keeperOn: false, window: 30, budgetTokens: 1000000 }, directive, directorNote: '', editorEye: '', ruling: '',
});
const last = (r) => r.messages[r.messages.length - 1];

test('M379-1 A SHORTCUT TRAVELS AS HE TYPED IT, AND NOTHING FOLLOWS IT — its meaning is in the standing words', () => {
  for (const typed of ['#p', '#pp', '#q', '#time skip to dawn', '#story a lighthouse keeper', '#question what does she want', '((slow down))']) {
    const p = parseCommand(typed);
    const r = build([{ id: 'u1', role: 'user', text: p.clean || typed, typed }], { directive: p.directive });
    eq(last(r).role, 'user'); eq(last(r).content, typed, typed + ': his words, as typed, are the last message');
    assert(!JSON.stringify(r.messages).includes(String(p.directive).slice(0, 40)), typed + ': its law is not sent on the turn');
  }
  const hidden = build([{ id: 'u1', role: 'user', text: 'continue', hidden: true, typed: '#continue' }], { directive: parseCommand('#continue').directive });
  eq(last(hidden).content, '#continue', 'a shortcut the thread keeps hidden still travels, as typed');
  const standing = JSON.stringify(build([{ id: 'u1', role: 'user', text: 'I walk in.' }]).systemBlocks);
  assert(/SHORTCUTS\. When Bruce/.test(standing), 'the shortcuts are in the standing words, said to his name');
  for (const k of ['#p — exactly ONE beat', '#pp — arc transit', '#continue, or a bare \u201cGo on.\u201d — play the CURRENT situation', '#q — the next scene', '#time skip — jump', '#story — a new story', '#question <his question>']) assert(standing.includes(k), 'explained: ' + k);
  assert(!/You are the director/.test(shortcutsText()), 'and they hand the teller no second identity');
});

test('M379-2 WITH NO NOTE OF HIS OWN, HIS MESSAGE IS THE LAST THING IT READS — the house’s starter note is in the standing words; a note he writes stays at the end', () => {
  const r = build([{ id: 'u1', role: 'user', text: 'I walk in.' }]);
  eq(last(r).content, 'I walk in.', 'his words close the request');
  assert(/reread the last few exchanges/.test(JSON.stringify(r.systemBlocks)), 'the starter note is said once, in the standing words');
  const own = build([{ id: 'u1', role: 'user', text: 'I walk in.' }], { settings: { tellerName: 'Tony Stark', writerName: 'Bruce', noteText: 'Keep it slow and warm.' } });
  eq(last(own).content, 'Keep it slow and warm.', 'a note he wrote himself still stands at the end, where he put it');
  assert(!/reread the last few exchanges/.test(JSON.stringify(own.systemBlocks)), 'and then the starter note is nowhere');
});

test('M379-3 THE CONTINUE NUDGE IS HIS OWN MESSAGE — “Go on.” in his place when nothing of his travels, never a second message', () => {
  const tapped = build([{ id: 'u1', role: 'user', text: 'continue', hidden: true }]);
  eq(last(tapped).role, 'user'); eq(last(tapped).content, CONTINUE_NUDGE, 'Continue tapped: “Go on.” stands as the one user message');
  eq(tapped.messages.filter((m) => m.role === 'user' && m.content === CONTINUE_NUDGE).length, 1, 'once');
  const typed = build([{ id: 'u1', role: 'user', text: 'I walk in.' }]);
  assert(!typed.messages.some((m) => m.content === CONTINUE_NUDGE), 'a turn where he said something has no nudge at all');
  /* M381: his own "continue" is his words — never rewritten into the house's "Go on." */
  for (const words of ['continue', 'keep going!', 'Go on']) {
    const his = build([{ id: 'u1', role: 'user', text: words }]);
    eq(last(his).content, words, 'he typed “' + words + '”, and that is what travels');
  }
  const empty = build([{ id: 'u1', role: 'user', text: '' }]);
  eq(last(empty).content, CONTINUE_NUDGE, 'an empty send has “Go on.” in its place');
});


test('M380-1 THE NAME BOXES ONLY CHANGE WORDS — nothing is added for a name', () => {
  const frame = 'You are ENI.\n\nYou write this story with the writer.';
  const withNames = build([{ id: 'u1', role: 'user', text: 'I walk in.' }], { settings: { tellerName: 'Tony Stark', writerName: 'Bruce', frameText: frame } });
  const without = build([{ id: 'u1', role: 'user', text: 'I walk in.' }], { settings: { frameText: frame } });
  const a = withNames.systemBlocks[0].text; const b = without.systemBlocks[0].text;
  assert(/You write this story with Bruce\./.test(a), 'the house word "the writer" becomes his name');
  eq(a.split('\n\n').length, b.split('\n\n').length, 'and not one paragraph is added for a name');
  assert(!/one man|goes by|call him/i.test(a), 'no line about names at all');
});

test('M380-2 (as M385 corrected it) WHAT FOLLOWS HIS MESSAGE IS A SYSTEM MESSAGE — or a user one if he chooses; Claude gets it as a system message too, and a Claude model that refuses it is remembered and sent a user one', async () => {
  const note = { tellerName: 'Tony Stark', writerName: 'Bruce', noteText: 'Keep it funny.' };
  const sys = build([{ id: 'u1', role: 'user', text: 'I walk in.' }], { settings: note });
  eq(sys.messages[sys.messages.length - 2].role, 'user'); eq(sys.messages[sys.messages.length - 2].content, 'I walk in.', 'his message');
  eq(sys.messages[sys.messages.length - 1].role, 'system', 'then the note, as a system message — the default');
  const usr = build([{ id: 'u1', role: 'user', text: 'I walk in.' }], { settings: { ...note, afterRole: 'user' } });
  eq(usr.messages[usr.messages.length - 1].role, 'user', 'or as a user message, when he chooses it');
  const { createProvider } = await import('../../js/providers/index.js');
  const { db } = await import('../../js/store.js');
  const stub = (refuse) => async (url, opts) => {
    const body = JSON.parse(opts.body); sent.push(body);
    if (refuse && body.messages.some((m) => m.role === 'system')) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages.1.role: system messages are not supported on this model' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  let sent = [];
  const prior = globalThis.fetch;
  try {
    /* a Claude model that takes it (Opus 5): sent as a system message */
    globalThis.fetch = stub(false);
    try { await createProvider({ type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-opus-5' }).streamChat({ systemBlocks: sys.systemBlocks, messages: sys.messages, onToken() {} }); } catch (err) { /* the stub writes nothing */ }
    eq(sent.length, 1); eq(sent[0].messages[sent[0].messages.length - 1].role, 'system', 'Claude Opus 5 is sent a system message after his');
    /* a Claude model that refuses it (Sonnet 5): refused once, remembered for that model, the same turn sent again as user */
    sent = [];
    const conn = await db.connections.add({ label: 'sonnet', type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-sonnet-5' });
    globalThis.fetch = stub(true);
    const stored = (await db.connections.list()).find((c) => c.id === conn.id);
    try { await createProvider(stored).streamChat({ systemBlocks: sys.systemBlocks, messages: sys.messages, onToken() {} }); } catch (err) { /* the stub writes nothing */ }
    eq(sent.length, 2, 'asked as set, then again');
    eq(sent[1].messages[sent[1].messages.length - 1].role, 'user', 'the second time as a user message');
    const kept = (await db.connections.list()).find((c) => c.id === conn.id);
    eq(kept.systemAfterRefusedFor, 'claude-sonnet-5@https://api.anthropic.com', 'remembered for that model');
    sent = [];
    await db.connections.update(conn.id, { model: 'claude-opus-5' });
    globalThis.fetch = stub(false);
    try { await createProvider((await db.connections.list()).find((c) => c.id === conn.id)).streamChat({ systemBlocks: sys.systemBlocks, messages: sys.messages, onToken() {} }); } catch (err) { /* nothing */ }
    eq(sent[0].messages[sent[0].messages.length - 1].role, 'system', 'and a different model on the same connection is tried afresh');
    await db.connections.remove(conn.id);
  } finally { globalThis.fetch = prior; }
});

test('M380-3 A HOUSE THAT REFUSES A SYSTEM MESSAGE AFTER THE STORY is remembered, and the same turn goes again with it as a user message', async () => {
  const { db } = await import('../../js/store.js');
  const { createProvider } = await import('../../js/providers/index.js');
  const conn = await db.connections.add({ label: 'strict', type: 'openai', baseUrl: 'https://strict.example', apiKey: 'k', model: 'm' });
  const r = build([{ id: 'u1', role: 'user', text: 'I walk in.' }], { settings: { noteText: 'Keep it funny.' } });
  const sent = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); sent.push(body);
    if (body.messages.some((m, i) => i > 0 && m.role === 'system')) return new Response(JSON.stringify({ error: { message: 'System message must be at the beginning.' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    return new Response('data: {"choices":[{"delta":{"content":"Page."}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const stored = (await db.connections.list()).find((c) => c.id === conn.id);
    const out = await createProvider(stored).streamChat({ systemBlocks: r.systemBlocks, messages: r.messages, onToken() {} });
    assert(/Page\./.test(out.text), 'the turn landed');
    eq(sent.length, 2, 'asked once as set, once again with the words as a user message');
    eq(sent[1].messages[sent[1].messages.length - 1].role, 'user');
    eq((await db.connections.list()).find((c) => c.id === conn.id).systemAfterRefusedFor, 'm@https://strict.example', 'and remembered for this model at this address (M385)');
  } finally { globalThis.fetch = prior; await db.connections.remove(conn.id); }
});

test('M384-1 HIS TWO ALWAYS CLOSE IT: whatever else rides after his message comes first — the repeated main instructions, then his note, are the last two things the storyteller reads', () => {
  const r = buildRequest({
    story: { brief: '' }, messages: [...base, { id: 'u1', role: 'user', text: 'I swing at him.' }],
    settings: { tellerName: 'Tony Stark', writerName: 'Bruce', frameText: 'MAIN: You are Tony Stark.', framePurposeOn: false, frameEcho: true, noteText: 'NOTE: keep it funny.' },
    state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 1000000 },
    directive: '', directorNote: '', editorEye: '', ruling: 'RULING: the blow lands.', sensorNote: 'SENSOR: something is at stake.',
  });
  const after = last(r);
  eq(after.role, 'system');
  const parts = after.content.split('\n\n');
  eq(parts[parts.length - 1], 'NOTE: keep it funny.', 'his note is the very last thing');
  eq(parts[parts.length - 2], 'MAIN: You are Tony Stark.', 'his main instructions, repeated, right before it');
  assert(parts.findIndex((p) => /RULING/.test(p)) < parts.length - 2 && parts.findIndex((p) => /SENSOR/.test(p)) < parts.length - 2, 'the referee and the switches come before both');
});
