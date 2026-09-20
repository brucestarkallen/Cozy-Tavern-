/* M347: "What the storyteller saw" shows what was sent — each part's words (Normal) and the request exactly as the model
 * took it (Raw). These laws run the product: the words kept and read back byte for byte, the pages that ride every
 * request kept once, the newest pages kept and the rest let go with their pieces, the receipt carrying only the key,
 * and both providers handing back the very body they sent (never the key in the headers). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { keepSent, loadSent, newSentId, piecesOf, KEEP_PAGES, sentStats } from '../../js/sent.js';
import { finalizeReceipt } from '../../js/assemble/receipt.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { createProvider } from '../../js/providers/index.js';
import { rawMessagesOf, rawSettingsOf } from '../../js/ui/receiptview.js';

const para = (i) => 'Page ' + i + '. ' + 'The courtyard held its breath while the rain went on, and nobody said the name out loud. '.repeat(9) + '\n\n';
const pages = (from, to) => { const out = []; for (let i = from; i < to; i += 1) out.push({ role: i % 2 ? 'assistant' : 'user', content: para(i).repeat(4) }); return out; };
const bodyOf = (msgs, extra = {}) => ({ model: 'deepseek-v3.2', stream: true, max_tokens: 8000, temperature: 0.9, messages: [{ role: 'system', content: 'You are Iron Man.\n\n' + 'The craft says this. '.repeat(80) }, ...msgs], ...extra });

test('M347-1 THE WORDS COME BACK EXACTLY: every part and the whole request, byte for byte — and a short string stays a string', async () => {
  const body = bodyOf([...pages(0, 12), { role: 'user', content: 'I bow.' }]);
  const slots = [{ name: 'The frame', text: 'You are Iron Man. '.repeat(60) }, { name: 'The note at the end', text: 'Keep it tight.' }, { name: 'The continue nudge', text: '' }];
  const id = newSentId();
  eq(await keepSent({ id, storyId: 'tale-a', slots, requests: [{ url: 'https://api.deepseek.com/v1/chat/completions', body }] }), true, 'kept');
  const back = await loadSent(id);
  eq(JSON.stringify(back.requests[0].body), JSON.stringify(body), 'the request, as sent');
  eq(back.requests[0].url, 'https://api.deepseek.com/v1/chat/completions', 'and where');
  eq(JSON.stringify(back.slots), JSON.stringify(slots), 'every part, in order, empty ones too');
  eq(await loadSent('snt_nothing'), null, 'a page with nothing kept reads as nothing');
  /* a sheet opened the moment the page lands waits for the words on their way, never reads them as missing */
  const early = newSentId();
  const keeping = keepSent({ id: early, storyId: 'tale-a', slots: [{ name: 'The brief', text: 'Just written. '.repeat(50) }], requests: [] });
  const read = await loadSent(early);
  assert(read && /Just written/.test(read.slots[0].text), 'read while it was being kept: whole');
  await keeping;
  assert(piecesOf('').length === 0 && piecesOf(para(1)).join('') === para(1), 'pieces rejoin to the text');
});

test('M347-2 A STORY IS KEPT ONCE, NOT ONCE PER PAGE: forty pages that ride every request add almost nothing the second time', async () => {
  const history = pages(0, 40);
  await keepSent({ id: newSentId(), storyId: 'tale-b', slots: [], requests: [{ url: 'u', body: bodyOf(history) }] });
  const first = await sentStats('tale-b');
  const next = [...history.slice(1), ...pages(40, 42)];
  await keepSent({ id: newSentId(), storyId: 'tale-b', slots: [], requests: [{ url: 'u', body: bodyOf(next) }] });
  const second = await sentStats('tale-b');
  const firstChars = first.chars;
  const added = second.chars - firstChars;
  const sent = JSON.stringify(bodyOf(next)).length;
  assert(added < sent * 0.15, 'the second page added ' + added + ' characters for a ' + sent + '-character request (first: ' + firstChars + ')');
  eq(second.pages, 2, 'two pages kept');
});

test('M347-3 THE NEWEST ' + KEEP_PAGES + ' PAGES OF A TALE KEEP THEIR WORDS; the oldest go in a batch with every piece only they used', async () => {
  const ids = [];
  for (let i = 0; i <= KEEP_PAGES; i += 1) {
    const id = newSentId();
    ids.push(id);
    await keepSent({ id, storyId: 'tale-c', slots: [{ name: 'The state of things', text: 'Only page ' + i + ' says this. '.repeat(90) }], requests: [] });
  }
  const s = await sentStats('tale-c');
  assert(s.pages < KEEP_PAGES && s.pages >= KEEP_PAGES - 20, 'let go in a batch: ' + s.pages + ' kept');
  eq(await loadSent(ids[0]), null, 'the oldest is gone');
  assert(/Only page 200 says this/.test((await loadSent(ids[ids.length - 1])).slots[0].text), 'the newest reads whole');
  assert(s.pieces <= s.pages + 2, 'and its pieces went with it: ' + s.pieces + ' pieces for ' + s.pages + ' pages');
});

test('M347-4 THE PAGE CARRIES ONLY THE KEY: the draft holds each part’s words; the receipt kept on the page holds names, sizes and where the words are', () => {
  const r = buildRequest({ story: { brief: 'A brief.' }, messages: [{ id: 'u1', role: 'user', text: 'Hello.' }], settings: { noteText: 'Keep it tight.' }, state: null, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '' });
  const brief = r.receipt.slots.find((s) => s.name === 'The brief');
  eq(brief.text, 'A brief.', 'the draft keeps the words');
  const kept = finalizeReceipt(r.receipt, { sentId: 'snt_x', model: 'm' });
  eq(kept.sentId, 'snt_x', 'the page knows where its words are');
  assert(kept.slots.every((s) => !('text' in s)), 'and carries none of them');
  assert(!('sentId' in finalizeReceipt(r.receipt, {})), 'no key, no field');
});

test('M347-5 THE PROVIDERS HAND BACK THE VERY BODY THEY SENT — and never the key', async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), body: opts && opts.body });
    const isClaude = /\/v1\/messages$/.test(String(url));
    const text = isClaude
      ? 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'
      : 'data: {"choices":[{"delta":{"content":"Hi."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    return { ok: true, status: 200, headers: new Headers(), body, async json() { return {}; }, async text() { return text; }, clone() { return this; } };
  };
  try {
    for (const conn of [{ type: 'openai', baseUrl: 'https://api.example.com', model: 'm1', apiKey: 'SECRET-KEY-1' }, { type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x', apiKey: 'SECRET-KEY-2' }]) {
      const before = seen.length;
      const res = await createProvider(conn).streamChat({ systemBlocks: [{ text: 'You are Iron Man.' }], messages: [{ role: 'user', content: 'Hello.' }], onToken() {} });
      const wire = seen[seen.length - 1];
      assert(seen.length > before && res.sent && res.sent.body, conn.type + ': it hands back what it sent');
      eq(JSON.stringify(res.sent.body), wire.body, conn.type + ': byte for byte');
      eq(res.sent.url, wire.url, conn.type + ': and where');
      assert(!/SECRET-KEY/.test(JSON.stringify(res.sent)), conn.type + ': never the key');
      const roles = rawMessagesOf(res.sent.body).map((m) => m.role);
      assert(roles[0] === 'system' && roles.includes('user'), conn.type + ': Raw reads it as system, then user: ' + roles.join(','));
      assert(rawSettingsOf(res.sent.body).model, conn.type + ': and its settings');
    }
  } finally {
    globalThis.fetch = real;
  }
});
