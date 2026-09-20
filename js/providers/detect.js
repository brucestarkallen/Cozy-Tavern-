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
/* M348: and WHAT THE MODEL IS — the weights behind an alias and the thinking levels it declares — asked in the same one
 * question, for every connection (a room the writer set himself still leaves this to learn), kept for that very model
 * at that very address, asked again after a day when nothing came back. */
async function learnOnce(conn, { now = Date.now(), provider = null } = {}) {
  if (!String(conn.model || '').trim()) return conn;
  const key = detectKey(conn);
  const roomKnown = (typeof conn.contextSize === 'number' && conn.contextSize > 0) || (conn.detectedFor === key && Number(conn.detectedContext) > 0);
  const whoKnown = conn.identFor === key;
  const roomAsked = conn.detectTriedFor === key && now - (Number(conn.detectTriedAt) || 0) < ASK_AGAIN_MS;
  const whoAsked = conn.identTriedFor === key && now - (Number(conn.identTriedAt) || 0) < ASK_AGAIN_MS;
  if ((roomKnown || roomAsked) && (whoKnown || whoAsked)) return conn;
  let patch = {};
  if (!roomKnown) patch = { ...patch, detectTriedFor: key, detectTriedAt: now };
  if (!whoKnown) patch = { ...patch, identTriedFor: key, identTriedAt: now };
  try {
    const models = await (provider || createProvider(conn)).listModels();
    const want = String(conn.model).trim();
    const hit = (models || []).find((m) => m && m.id === want)
      || (models || []).find((m) => m && String(m.id).toLowerCase() === want.toLowerCase());
    const size = hit && Number(hit.context) > 0 ? Math.floor(hit.context) : 0;
    if (size && !roomKnown) patch = { ...patch, detectedContext: size, detectedFor: key };
    if (hit && !whoKnown) patch = { ...patch, identFor: key, modelHf: typeof hit.hf === 'string' ? hit.hf : '', modelEfforts: Array.isArray(hit.efforts) && hit.efforts.length ? hit.efforts : null };
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
