/* M289: THE HOUSE ASKS THE PROVIDER HOW MUCH ITS MODEL HOLDS.
 *
 * The writer's models hold half a million tokens and more; a connection whose
 * "The model's room" was left empty was planned at its preset's size (DeepSeek
 * at 128,000 — the size of an API retired in July 2026) and every reader
 * worked in an eighth of the room it had. When the field is empty, the house
 * asks the provider's model list once, in the background; a size it reports
 * for this very model (and address) is kept on the connection and used until
 * the model changes. Asked again after a day when nothing came back. The
 * writer's own number always wins. */
import { db } from '../store.js';
import { createProvider } from './index.js';
import { detectKey } from './room.js';

export const ASK_AGAIN_MS = 24 * 60 * 60 * 1000;

const asking = new Map(); /* one question at a time per connection and model */
export function learnContext(conn, opts = {}) {
  if (!conn || typeof conn !== 'object' || !conn.id) return Promise.resolve(conn);
  const key = conn.id + '|' + detectKey(conn);
  if (asking.has(key)) return asking.get(key);
  const p = learnOnce(conn, opts).finally(() => asking.delete(key));
  asking.set(key, p);
  return p;
}
async function learnOnce(conn, { now = Date.now(), provider = null } = {}) {
  if (typeof conn.contextSize === 'number' && conn.contextSize > 0) return conn;
  if (!String(conn.model || '').trim()) return conn;
  const key = detectKey(conn);
  if (conn.detectedFor === key && Number(conn.detectedContext) > 0) return conn;
  if (conn.detectTriedFor === key && now - (Number(conn.detectTriedAt) || 0) < ASK_AGAIN_MS) return conn;
  let patch = { detectTriedFor: key, detectTriedAt: now };
  try {
    const models = await (provider || createProvider(conn)).listModels();
    const want = String(conn.model).trim();
    const hit = (models || []).find((m) => m && m.id === want)
      || (models || []).find((m) => m && String(m.id).toLowerCase() === want.toLowerCase());
    const size = hit && Number(hit.context) > 0 ? Math.floor(hit.context) : 0;
    if (size) patch = { ...patch, detectedContext: size, detectedFor: key };
  } catch (err) { /* no answer: the preset stands, and it is asked again tomorrow */ }
  try { await db.connections.update(conn.id, patch); } catch (err) { /* kept in hand this once */ }
  return { ...conn, ...patch };
}

/* the same, waited for no longer than `ms` — a page is never held back by it */
export async function learnContextWithin(conn, ms = 1500) {
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(conn), ms); });
  try { return await Promise.race([learnContext(conn), late]); } finally { clearTimeout(timer); }
}
