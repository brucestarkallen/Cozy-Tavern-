/* M353: a provider that refuses a web page (no CORS) — curl works, the tavern does not, and the browser says nothing.
 * The call is tried once more through the writer's own server (serve.py's /api/relay, tested in tests/relay.py); if
 * that works it was the page that was refused, and the connection goes that way from then on. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { forgetRelayCheck, throughHouse } from '../../js/providers/relay.js';

const PAGE = 'data: {"choices":[{"delta":{"content":"The page."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const streamRes = () => ({ ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(PAGE)); c.close(); } }), async json() { return {}; }, async text() { return PAGE; }, clone() { return this; } });

function house({ pageRefused = true, relayStands = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === '/api/relay' && (init.method || 'GET') === 'GET') {
      if (!relayStands) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, async json() { return { relay: true }; } };
    }
    if (u === '/api/relay') return streamRes();
    if (pageRefused) throw new TypeError('Failed to fetch'); /* what a browser says when a page is refused */
    return streamRes();
  };
  return calls;
}

const ask = (conn) => createProvider(conn).streamChat({ systemBlocks: [{ text: 's' }], messages: [{ role: 'user', content: 'u' }], onToken() {} });

test('M353-1 THE HOUSE CARRIES WHAT THE PAGE IS REFUSED: the turn still lands, the key rides to his own server only, the connection is marked, and the page says what happened', async () => {
  const real = globalThis.fetch;
  forgetRelayCheck();
  const conn = { id: 'c-refused', type: 'openai', baseUrl: 'https://hemmingway.io', apiKey: 'SECRET-KEY', model: 'hemmingway-27b' };
  await db.connections.add(conn);
  const calls = house();
  try {
    const res = await ask((await db.connections.list()).find((c) => c.id === 'c-refused'));
    eq(res.text, 'The page.', 'the turn landed');
    const carried = calls.find((c) => c.url === '/api/relay' && c.init.method === 'POST');
    assert(carried, 'the house carried it');
    eq(carried.init.headers['X-Relay-Url'], 'https://hemmingway.io/v1/chat/completions', 'to the provider’s own address');
    eq(carried.init.headers['X-Relay-Method'], 'POST', 'as a post');
    eq(JSON.parse(carried.init.body).model, 'hemmingway-27b', 'with the body, word for word');
    const packed = JSON.parse(Buffer.from(carried.init.headers['X-Relay-Headers'], 'base64').toString('utf-8'));
    eq(packed.authorization || packed.Authorization, 'Bearer SECRET-KEY', 'the key goes to his own server, in the headers, nowhere else');
    assert(!/SECRET-KEY/.test(String(carried.init.body)), 'never in the body');
    assert(res.notes.some((n) => /refuses calls from a web page, so your own tavern server carried the turn/.test(n)), 'and the page says so: ' + res.notes.join(' | '));
    const kept = (await db.connections.list()).find((c) => c.id === 'c-refused');
    eq(kept.viaRelay, true, 'the connection is marked');
    /* from now on it goes straight there — the refused address is not tried again */
    const next = house();
    const again = await ask((await db.connections.list()).find((c) => c.id === 'c-refused'));
    eq(again.text, 'The page.', 'and lands');
    assert(!next.some((c) => /hemmingway\.io/.test(c.url)), 'the page does not knock on a door it is refused at: ' + next.map((c) => c.url).join(', '));
    assert(!again.notes.some((n) => /carried the turn/.test(n)), 'and it is not said twice');
  } finally { globalThis.fetch = real; }
});

test('M353-2 A HOUSE WITH NO RELAY CHANGES NOTHING: the turn fails as it always did, and the connection is not marked', async () => {
  const real = globalThis.fetch;
  forgetRelayCheck();
  const conn = { id: 'c-norelay', type: 'openai', baseUrl: 'https://hemmingway.io', apiKey: 'k', model: 'hemmingway-27b' };
  await db.connections.add(conn);
  house({ relayStands: false });
  try {
    let threw = '';
    try { await ask(conn); } catch (err) { threw = String(err && err.message); }
    assert(threw, 'it failed, as it did before');
    const kept = (await db.connections.list()).find((c) => c.id === 'c-norelay');
    assert(!kept.viaRelay, 'and nothing was learned that is not true');
  } finally { globalThis.fetch = real; }
});

test('M353-3 A PROVIDER THAT ANSWERS A PAGE IS NEVER RELAYED — the direct call is made first, every time', async () => {
  const real = globalThis.fetch;
  forgetRelayCheck();
  const conn = { id: 'c-fine', type: 'openai', baseUrl: 'https://api.fine.example', apiKey: 'k', model: 'm' };
  await db.connections.add(conn);
  const calls = house({ pageRefused: false });
  try {
    const res = await ask(conn);
    eq(res.text, 'The page.', 'it landed');
    assert(!calls.some((c) => c.url === '/api/relay'), 'the house was never asked: ' + calls.map((c) => c.url).join(', '));
    const kept = (await db.connections.list()).find((c) => c.id === 'c-fine');
    assert(!kept.viaRelay, 'and the connection is untouched');
  } finally { globalThis.fetch = real; }
});

test('M353-4 A LISTING IS CARRIED THE SAME WAY, as a get', () => {
  const [path, wrapped] = throughHouse('https://hemmingway.io/v1/models', { headers: { Authorization: 'Bearer k' } });
  eq(path, '/api/relay', 'to the house');
  eq(wrapped.headers['X-Relay-Method'], 'GET', 'as a get');
  eq(wrapped.headers['X-Relay-Url'], 'https://hemmingway.io/v1/models', 'to its own address');
});
