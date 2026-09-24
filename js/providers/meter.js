/* M457: THE METER ON THE ONE ROAD. Every call to a model — the storyteller's and every worker's — goes through
 * relay.js houseFetch; this reads what each one cost without touching what the caller reads: a stream is teed (the
 * caller gets its own branch, byte for byte), a JSON answer is read from a clone. What the provider reports is taken
 * as said; when it reports nothing, the words in and out are counted at four characters a token and marked
 * estimated. The day's book is written one call after another (never two at once over each other). */
import { db } from '../store.js';
import { dayKey, addToDay, usageFrom, USAGE_PREFIX } from '../engine/usage.js';

let writing = Promise.resolve();
export function noteUsage(entry) {
  writing = writing.then(async () => {
    const key = USAGE_PREFIX + dayKey(entry.at);
    const day = (await db.settings.get(key)) || {};
    await db.settings.set(key, addToDay(day, entry));
  }).catch(() => { /* a meter that fails never fails the call */ });
  return writing;
}

const GENERATES = /\/chat\/completions(?:\?|$)|\/v1\/messages(?:\?|$)|\/messages(?:\?|$)/;
const CHARS_PER_TOKEN = 4;

function settle(meta, reported, outChars) {
  const inTok = reported && Number.isFinite(reported.inTok) ? reported.inTok : null;
  const outTok = reported && Number.isFinite(reported.outTok) ? reported.outTok : null;
  return noteUsage({
    at: Date.now(), connId: meta.connId, connName: meta.connName, model: meta.model,
    inTok: inTok !== null ? inTok : Math.round(meta.inChars / CHARS_PER_TOKEN),
    outTok: outTok !== null ? outTok : Math.round(outChars / CHARS_PER_TOKEN),
    estimated: inTok === null || outTok === null,
  });
}

function textOf(j) {
  if (!j || typeof j !== 'object') return '';
  const c = Array.isArray(j.choices) && j.choices[0] ? (j.choices[0].delta || j.choices[0].message || {}) : null;
  if (c) return String(c.content || '') + String(c.reasoning_content || c.reasoning || '');
  if (j.delta && typeof j.delta === 'object') return String(j.delta.text || j.delta.thinking || j.delta.partial_json || '');
  if (Array.isArray(j.content)) return j.content.map((b) => String((b && (b.text || b.thinking)) || '')).join('');
  return '';
}

async function readStream(stream, meta) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let outChars = 0;
  const reported = { inTok: null, outTok: null };
  const take = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const data = t.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let j;
    try { j = JSON.parse(data); } catch (err) { return; }
    outChars += textOf(j).length;
    const u = usageFrom(j);
    if (u) { if (u.inTok !== null && (u.inTok > 0 || reported.inTok === null)) reported.inTok = u.inTok; if (u.outTok !== null) reported.outTok = u.outTok; }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) take(l);
    }
    if (buf) take(buf);
  } catch (err) { /* the caller stopped it — what was read is still counted */ }
  return settle(meta, reported, outChars);
}

/* the response the caller reads — the same one, or its own branch of the stream */
export function watchUsage(url, init, conn, res) {
  try {
    if (!res || !res.ok || !init || String(init.method || 'GET').toUpperCase() !== 'POST' || !GENERATES.test(String(url))) return res;
    let body;
    try { body = JSON.parse(String(init.body || '')); } catch (err) { return res; }
    if (!body || !Array.isArray(body.messages)) return res;
    const meta = {
      connId: conn && conn.id ? String(conn.id) : '',
      connName: conn ? String(conn.label || conn.name || '') : '',
      model: String(body.model || (conn && conn.model) || ''),
      inChars: JSON.stringify(body.messages).length + (body.system ? JSON.stringify(body.system).length : 0),
    };
    if (body.stream && res.body && typeof res.body.tee === 'function' && typeof Response === 'function') {
      const [mine, theirs] = res.body.tee();
      readStream(mine, meta);
      return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    if (typeof res.clone === 'function') {
      const copy = res.clone();
      if (copy && copy !== res && typeof copy.json === 'function') copy.json().then((j) => settle(meta, usageFrom(j), textOf(j).length)).catch(() => {});
    }
    return res;
  } catch (err) {
    return res;
  }
}
