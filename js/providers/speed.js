/* Cozy Tavern — js/providers/speed.js
 * M373: HOW FAST IS THIS CONNECTION. The writer asked for the connection test to say its latency and its speed. Both
 * come from ONE streamed answer, the way a page streams:
 *   - FIRST WORDS AFTER — from the moment the ask leaves to the first thing the model sends back, thinking or text: what he
 *     waits through before a page starts to move.
 *   - TOKENS A SECOND — how fast it writes once it has started: the tokens it sent (as the provider counts them when it
 *     reports them, else estimated from the characters, and said to be an estimate) over the time from the first word
 *     to the last. The wait before the first word is NOT counted in it, so a slow start never hides a fast writer.
 * It is measured with the connection's own settings (his temperature, his thinking level — M12's law), on a short fixed
 * ask; it never touches a story. */

export const SPEED_ASK = 'Write one short paragraph, about a hundred words, of rain on a window at night.';
export const SPEED_MAX_TOKENS = 700; /* enough for thinking to start and a paragraph to follow; the test's own cap */

/* Read a streamed answer to its end. `pick(json)` says what one event carried: {text, tokens} — the characters of
 * thinking or text in it, and a token count if the provider reported one there. */
export async function measureStream(res, pick, { now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), startedAt } = {}) {
  const t0 = Number.isFinite(startedAt) ? startedAt : now();
  let first = null;
  let last = null;
  let chars = 0;
  let reported = null;
  const body = res && res.body;
  if (!body || typeof body.getReader !== 'function') return null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  const take = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const data = t.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json = null;
    try { json = JSON.parse(data); } catch (err) { return; }
    const got = pick(json) || {};
    if (typeof got.text === 'string' && got.text.length) {
      const at = now();
      if (first === null) first = at;
      last = at;
      chars += got.text.length;
    }
    if (Number.isFinite(got.tokens) && got.tokens > 0) reported = got.tokens;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop();
    for (const line of lines) take(line);
  }
  if (carry) take(carry);
  const end = now();
  if (first === null) return { firstMs: null, totalMs: end - t0, tokens: reported || 0, estimated: reported == null, tps: null };
  const tokens = reported != null ? reported : Math.max(1, Math.round(chars / 4));
  const writing = ((last !== null ? last : end) - first) / 1000;
  return {
    firstMs: first - t0,
    totalMs: end - t0,
    tokens,
    estimated: reported == null,
    tps: writing >= 0.25 && tokens > 1 ? tokens / writing : null,
  };
}

/* the sentence the connection card shows */
export function speedWords(m) {
  if (!m) return '';
  const secs = (ms) => (ms < 1000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1)) + ' s';
  if (m.firstMs === null) return 'Speed: nothing streamed back to time (' + secs(m.totalMs) + ' in all).';
  const rate = m.tps !== null ? (m.estimated ? 'about ' : '') + Math.round(m.tps) + ' tokens a second' : 'too short an answer to time its writing';
  return 'Speed: first words after ' + secs(m.firstMs) + ' · ' + rate + ' (' + m.tokens.toLocaleString() + (m.estimated ? ' tokens, estimated from its length' : ' tokens') + ' in ' + secs(m.totalMs) + ').';
}

/* what one event of each wire carries */
export function pickOpenAI(json) {
  const c = json && Array.isArray(json.choices) && json.choices[0] ? json.choices[0] : null;
  const d = c && c.delta ? c.delta : {};
  let text = '';
  for (const [k, v] of Object.entries(d)) if (typeof v === 'string' && v && (k === 'content' || /reason|think|thought/i.test(k))) text += v;
  const u = json && json.usage ? json.usage : null;
  return { text, tokens: u ? Number(u.completion_tokens) : null };
}
export function pickAnthropic(json) {
  if (!json || typeof json !== 'object') return {};
  if (json.type === 'content_block_delta' && json.delta) {
    const d = json.delta;
    return { text: String(d.text || d.thinking || '') };
  }
  if (json.type === 'message_delta' && json.usage) return { tokens: Number(json.usage.output_tokens) };
  return {};
}
