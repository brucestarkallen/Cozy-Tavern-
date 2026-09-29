/* Cozy Tavern — js/providers/userfirst.js (M510-38)
 * HIS TURN FIRST — ONLY WHERE A HOUSE INSISTS. With the notes above the story in the system (M510-37), a request may open
 * on the storyteller's own words: his words "in the storyteller's own voice" placed before the pages, or a tale whose first
 * page is the teller's. Most houses take that as it is. Claude's API does not (its first message must be the user's), and
 * a few OpenAI-shaped houses refuse a conversation that opens on the assistant ("roles must alternate", "the first
 * message must be from the user"). For those — Claude always; any other house once it has said no, remembered for THAT
 * model at that address, as a refused late system message is (latesystem.js) — one line of his opens it:
 * "(Our story begins.)". Everywhere else, nothing is added. */
import { db } from '../store.js';

export const STORY_BEGINS = '(Our story begins.)';
const keyOf = (conn) => String((conn && conn.model) || '') + '@' + String((conn && conn.baseUrl) || '');

export function userFirstRequired(conn) {
  return Boolean(conn && typeof conn.userFirstFor === 'string' && conn.userFirstFor === keyOf(conn));
}

export async function rememberUserFirst(conn) {
  if (!conn) return;
  const key = keyOf(conn);
  conn.userFirstFor = key;
  try { if (conn.id) await db.connections.update(conn.id, { userFirstFor: key }); } catch (err) { /* the turn is asked again all the same */ }
}

/* the first message after the system ones is the assistant's: one line of his goes before it */
export function opensOnAssistant(list) {
  const first = (Array.isArray(list) ? list : []).find((m) => m && m.role !== 'system');
  return Boolean(first && first.role === 'assistant');
}
export function withUserFirst(list) {
  const out = Array.isArray(list) ? list.slice() : [];
  if (!opensOnAssistant(out)) return out;
  const at = out.findIndex((m) => m && m.role !== 'system');
  out.splice(at, 0, { role: 'user', content: STORY_BEGINS });
  return out;
}

/* a refusal that is about the order of the turns, in the words houses use for it */
export const ORDER_REFUSAL = /first (?:non-system )?message|must (?:start|begin) with|roles? must alternate|alternate (?:between )?user|user\/assistant\/user|conversation roles|expected (?:a )?user (?:message|role)/i;
