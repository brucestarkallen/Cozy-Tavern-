/* Cozy Tavern — js/providers/latesystem.js
 * M385: A SYSTEM MESSAGE AFTER THE STORY, AND THE MODELS THAT REFUSE ONE. What follows his message goes as a system
 * message (M380, SillyTavern's post-history instructions). Most OpenAI-shaped houses take one anywhere; Claude takes one
 * on Opus 4.8, Opus 5, Fable 5/5.1 and Mythos 5/5.1 and refuses it on Sonnet 5 and older models; a few strict houses
 * refuse it. A refusal is remembered for THAT model at that address — change the model and it is tried afresh — and
 * those words then go as a user message. One place for both providers. */
import { db } from '../store.js';

const keyOf = (conn) => String((conn && conn.model) || '') + '@' + String((conn && conn.baseUrl) || '');

export function lateSystemRefused(conn) {
  if (!conn) return false;
  if (conn.systemAfterRefused === true && !conn.systemAfterRefusedFor) return true; /* M380's older mark, before it knew the model */
  return typeof conn.systemAfterRefusedFor === 'string' && conn.systemAfterRefusedFor === keyOf(conn);
}

export async function rememberLateSystemRefused(conn) {
  if (!conn) return;
  const key = keyOf(conn);
  conn.systemAfterRefusedFor = key;
  delete conn.systemAfterRefused;
  try { if (conn.id) await db.connections.update(conn.id, { systemAfterRefusedFor: key, systemAfterRefused: undefined }); } catch (err) { /* the turn is asked again all the same */ }
}
