/* Cozy Tavern — providers/sse.js
 * The one SSE reader, shared by both providers (M9, audit B16 — it used to
 * live twice, once per provider, and could drift).
 *
 *   readSSE(body, onEvent)
 *     body    — a fetch Response body (a ReadableStream of bytes)
 *     onEvent — called with the parsed JSON of each `data:` event
 *
 * Handles partial chunks, CRLF, multi-line data, and the [DONE] sentinel.
 * event:/id:/comment lines are guidance we don't need. A frame that won't
 * parse (a keep-alive, a partial) is skipped — the stream goes on.
 */
export async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let dataLines = [];

  const dispatch = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join('\n');
    dataLines = [];
    if (raw === '[DONE]') return;
    try {
      onEvent(JSON.parse(raw));
    } catch (err) {
      /* a keep-alive or partial frame; keep listening */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') { dispatch(); continue; }
      if (line.startsWith(':')) continue; /* a comment/heartbeat */
      if (/^(?:data|event|id|retry):/.test(line)) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        continue; /* event:/id:/retry: are guidance we don't need */
      }
      /* Lenient (M9 harness): a bare content line inside an event — some
       * relays hand us multi-line data without re-prefixing. If we're
       * mid-event, it continues the data; otherwise it's noise. */
      if (dataLines.length) dataLines.push(line);
    }
  }
  buf += decoder.decode();
  const last = buf.replace(/\r$/, '');
  if (last.startsWith('data:')) dataLines.push(last.slice(5).replace(/^ /, ''));
  dispatch();
}
