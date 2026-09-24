/* Cozy Tavern — js/providers/relay.js
 * M353: THE PROVIDER THAT REFUSES A WEB PAGE. The tavern is a page, and a page may only call an address that answers a
 * browser with its own permission (CORS). A provider that never meant to be called from a page refuses before the
 * request is even made: curl works, the tavern does not, and the browser will not say why — the call simply throws with
 * nothing in it. The tavern is served by his own server on the same phone (serve.py), and that server has no such rule.
 * So: a call that fails with nothing at all is tried once more through the house (/api/relay). If that works, it was the
 * page that was refused, not the address — the connection is marked and every later call goes straight through the
 * house. The key rides in the headers of one request to his own phone and is never written down.
 * Nothing changes for a provider that answers a page: the direct call is made first, every time, until one fails. */
import { db } from '../store.js';
import { watchUsage } from './meter.js'; /* M457 */

const RELAY_PATH = '/api/relay';
let houseHasRelay = null; /* asked once a session */

export function forgetRelayCheck() { houseHasRelay = null; } /* for the tests */

export async function relayStands() {
  if (houseHasRelay !== null) return houseHasRelay;
  try {
    const res = await fetch(RELAY_PATH, { method: 'GET' });
    const said = res && res.ok ? await res.json() : null;
    houseHasRelay = Boolean(said && said.relay);
  } catch (err) {
    houseHasRelay = false;
  }
  return houseHasRelay;
}

const packHeaders = (headers) => {
  const flat = {};
  if (headers && typeof headers === 'object') for (const [k, v] of Object.entries(headers)) if (typeof v === 'string') flat[k] = v;
  const json = JSON.stringify(flat);
  /* the page's own btoa; a harness without one falls back to the same bytes by hand */
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(json)));
  const bytes = new TextEncoder().encode(json);
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const b = bytes[i + 1]; const c = bytes[i + 2];
    out += CHARS[a >> 2] + CHARS[((a & 3) << 4) | ((b || 0) >> 4)]
      + (b === undefined ? '=' : CHARS[((b & 15) << 2) | ((c || 0) >> 6)])
      + (c === undefined ? '=' : CHARS[c & 63]);
  }
  return out;
};

/* the same call, addressed to the house instead */
export function throughHouse(url, init = {}) {
  const method = String(init.method || (init.body ? 'POST' : 'GET')).toUpperCase();
  return [RELAY_PATH, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Relay-Url': String(url), 'X-Relay-Method': method, 'X-Relay-Headers': packHeaders(init.headers) },
  }];
}

async function rememberRelay(conn) {
  if (!conn || conn.viaRelay) return;
  conn.viaRelay = true;
  if (conn.id) { try { await db.connections.update(conn.id, { viaRelay: true }); } catch (err) { /* it stands for this session either way */ } }
}

/* Every call to a provider goes through here. A connection already known to be refused by pages starts at the house.
 * M457: and every one is metered on its way back (providers/meter.js) — tokens in and out, per connection and model. */
export async function houseFetch(url, init, conn) {
  return watchUsage(url, init, conn, await houseFetchUnmetered(url, init, conn));
}
async function houseFetchUnmetered(url, init, conn) {
  if (conn && conn.viaRelay && (await relayStands())) {
    const [path, wrapped] = throughHouse(url, init);
    return fetch(path, wrapped);
  }
  try {
    return await fetch(url, init);
  } catch (err) {
    /* nothing came back at all — refused by the page's own rules, or the line is down. The house can tell us which. */
    if (!(await relayStands())) throw err;
    const [path, wrapped] = throughHouse(url, init);
    const res = await fetch(path, wrapped); /* if this throws too, the line really is down: it throws to the caller */
    await rememberRelay(conn);
    return res;
  }
}
