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

/* M636: A HOUSE THAT TAKES NO TWO TURNS OF ONE ROLE IN A ROW. DeepSeek's reasoner was known for it by name (M466); any
 * other house says so once ("successive user or assistant messages", "roles must alternate"), is remembered for THAT
 * model at that address, and from then on neighbours of one role go to it as one message — a blank line between, the
 * order kept. A storyteller's own-voice turn beside its page (his own-voice entries, the sensors' word sent as the
 * storyteller's own) is what meets that wall. */
export const TWIN_REFUSAL = /successive|consecutive|roles? must alternate|alternate (?:between )?user|interleave|user\/assistant\/user|conversation roles/i;
export function twinsRefused(conn) {
  return Boolean(conn && typeof conn.twinsRefusedFor === 'string' && conn.twinsRefusedFor === keyOf(conn));
}
export async function rememberTwinsRefused(conn) {
  if (!conn) return;
  const key = keyOf(conn);
  conn.twinsRefusedFor = key;
  try { if (conn.id) await db.connections.update(conn.id, { twinsRefusedFor: key }); } catch (err) { /* the turn is asked again all the same */ }
}
const twinAt = (wire, i) => { const prev = wire[i - 1]; const cur = wire[i]; return Boolean(prev && cur && prev.role === cur.role && prev.role !== 'system' && typeof prev.content === 'string' && typeof cur.content === 'string'); };
export function hasTwins(wire) {
  const list = Array.isArray(wire) ? wire : [];
  for (let i = 1; i < list.length; i += 1) if (twinAt(list, i)) return true;
  return false;
}
/* in place: the same array the next attempt is built from */
export function foldTwins(wire) {
  for (let i = 1; i < wire.length; i += 1) {
    if (!twinAt(wire, i)) continue;
    wire[i - 1] = { ...wire[i - 1], content: wire[i - 1].content + '\n\n' + wire[i].content };
    wire.splice(i, 1);
    i -= 1;
  }
  return wire;
}

/* a refusal that is about the order of the turns, in the words houses use for it */
export const ORDER_REFUSAL = /first (?:non-system )?message|must (?:start|begin) with|roles? must alternate|alternate (?:between )?user|user\/assistant\/user|conversation roles|expected (?:a )?user (?:message|role)/i;
