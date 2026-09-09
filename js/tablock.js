/* Cozy Tavern — tablock.js
 * One tab holds the pen (M9, audit A6). Two tabs writing to the same
 * IndexedDB store is how stories tear, so the tavern keeps a house lock
 * over a BroadcastChannel: the first tab to claim it holds the pen; any
 * later tab opens read-only, with a plain notice saying so. When the holder
 * closes (or its heartbeat goes silent), a waiting tab may take the pen on
 * its next visit.
 *
 *   acquirePen({ onPromoted? }) -> Pen
 *   Pen = { primary:boolean, release():void }
 *
 * `primary` resolves true when this tab holds the pen. onPromoted fires if
 * a waiting tab later takes the pen (the holder released or went silent) —
 * the app then invites a reload rather than hot-swapping mid-word.
 *
 * The channel name is namespaced like the store. No BroadcastChannel (a
 * very old browser) means the lock simply isn't kept — the tab is primary.
 */

const CHANNEL = 'cozytavern.v1.pen';
const CLAIM_WAIT_MS = 350;
const HEARTBEAT_MS = 4000;
const SILENCE_MS = 12000;

export function acquirePen({ onPromoted } = {}) {
  if (typeof BroadcastChannel === 'undefined') {
    return Promise.resolve({ primary: true, release() {} });
  }
  const id = 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const channel = new BroadcastChannel(CHANNEL);
  let primary = false;
  let heartbeat = null;
  let watchdog = null;
  let lastPulse = Date.now();
  let released = false;

  const becomePrimary = (notify) => {
    if (primary || released) return;
    primary = true;
    if (watchdog) { clearInterval(watchdog); watchdog = null; }
    heartbeat = setInterval(() => {
      if (!released) channel.postMessage({ kind: 'pulse', id });
    }, HEARTBEAT_MS);
    if (notify && typeof onPromoted === 'function') onPromoted();
  };

  channel.onmessage = (e) => {
    const msg = e && e.data;
    if (!msg || typeof msg !== 'object' || msg.id === id) return;
    if (msg.kind === 'claim' && primary) {
      channel.postMessage({ kind: 'taken', id });
    } else if (msg.kind === 'pulse') {
      lastPulse = Date.now();
    } else if (msg.kind === 'release' && !primary) {
      /* The holder let the pen go — a waiting tab may pick it up. */
      becomePrimary(true);
    }
  };

  const release = () => {
    if (released) return;
    released = true;
    if (heartbeat) clearInterval(heartbeat);
    if (watchdog) clearInterval(watchdog);
    try {
      if (primary) channel.postMessage({ kind: 'release', id });
      channel.close();
    } catch (err) { /* the door is closing anyway */ }
  };

  return new Promise((resolve) => {
    let answered = false;
    const listener = (e) => {
      const msg = e && e.data;
      if (msg && msg.kind === 'taken') answered = true;
    };
    /* A second listener channel would double the bookkeeping; the claim
     * answer rides the main channel through a one-shot addEventListener. */
    channel.addEventListener('message', listener);
    channel.postMessage({ kind: 'claim', id });
    setTimeout(() => {
      channel.removeEventListener('message', listener);
      if (released) return;
      if (answered) {
        /* Someone holds the pen. Watch its pulse; silence long enough and
         * this tab may take over (the holder closed without a goodbye). */
        watchdog = setInterval(() => {
          if (!primary && Date.now() - lastPulse > SILENCE_MS) becomePrimary(true);
        }, HEARTBEAT_MS);
        resolve({ primary: false, release });
      } else {
        becomePrimary(false);
        resolve({ primary: true, release });
      }
    }, CLAIM_WAIT_MS);
  });
}
