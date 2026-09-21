/* M376: "a banner I don't know, during thinking — then my thinking stops, then it restarts." When the first try brought
 * back no page, the house asked a second time: a banner flashed, the thinking he was reading vanished, and a new one began
 * from nothing. Two roots: a thinking page given too little room (the thinking used it up and the page was cut), and a
 * second try that started blank. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { createProvider } from '../../js/providers/index.js';
import { PAGE_THINKING_FLOOR } from '../../js/providers/openai.js';

async function sentFor(conn) {
  const seen = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { seen.push(JSON.parse(opts.body)); return new Response('data: {"choices":[{"delta":{"content":"Page."}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
  try { await createProvider({ type: 'openai', baseUrl: 'https://x.example', model: 'm', apiKey: 'k', ...conn }).streamChat({ systemBlocks: [{ text: 's', cache: true }], messages: [{ role: 'user', content: 'u' }], onToken() {} }); }
  finally { globalThis.fetch = prior; }
  return seen[0];
}

test('M376-1 A THINKING PAGE IS NEVER GIVEN LESS ROOM THAN THE FLOOR — his own number rides whenever it is above it, and a room he never set is never sent', async () => {
  eq((await sentFor({ reasoning: { effort: 'high' }, maxTokens: 4000 })).max_tokens, PAGE_THINKING_FLOOR, 'thinking, set to 4000: raised to the floor');
  eq((await sentFor({ reasoning: { effort: 'off' }, maxTokens: 4000 })).max_tokens, 4000, 'no thinking: his 4000 exactly');
  eq((await sentFor({ reasoning: { effort: 'high' }, maxTokens: 30000 })).max_tokens, 30000, 'thinking, set above the floor: his own number');
  eq('max_tokens' in (await sentFor({ reasoning: { effort: 'high' } })), false, 'never set: never sent');
});

/* M376-2 is walked in the app (DOM-80): a first try with thinking and no page, the second held open — no banner, the
 * thinking he watched standing in the box, and all of it kept with the page. A source reading of it was deleted: a test
 * runs the feature. */

