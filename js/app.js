/* Cozy Tavern — app.js
 * Bootstrap: theme, router-lite between the two views, service worker,
 * and the shared context handed to each UI module.
 */

import { repairStoryPlaceholder } from './ui/placeholder.js'; /* M382 */
import { sweepSent } from './sent.js'; /* M347: a gone tale's kept words go with it */
import { db } from './store.js';
import { initChat } from './ui/chat.js';
import { initSettings } from './ui/settings.js';
import { initDrawer } from './ui/drawer.js';
import { initHousekeeper } from './ui/housekeeper.js';
import { initWelcome } from './ui/welcome.js';
import { VERSION } from './version.js';
import { acquirePen } from './tablock.js';
import { initSync } from './sync.js';
import { setAliasScope } from './engine/names.js'; /* M427: canon's other names are heard only in their own story */

/* ---------- theme: lamplight by default; "follow the sky" is a choice ----
 * M8: the hearth (dark) is the default face. Nothing stored → dark. The
 * "system" choice still follows the sky and listens for its changes. */

const sky = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
let themeMode = 'dark';

/* M301: the coats, and the colour the phone's own bar wears with each. A coat
 * is a name here, a token block in base.css and a radio in Settings — the
 * three names were written out four times in this file, so a fourth coat
 * would have been chosen in Settings and resolved to "follow the sky". */
const COATS = { dark: '#16120f', light: '#f5efe4', deep: '#0a0f12', magma: '#070c0e' };

function resolveTheme() {
  if (Object.prototype.hasOwnProperty.call(COATS, themeMode)) return themeMode;
  /* system mode: follow the sky, hearth when the sky is silent */
  return sky && sky.matches ? 'light' : 'dark';
}

function applyTheme() {
  const now = resolveTheme();
  document.documentElement.dataset.theme = now;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COATS[now]);
}

function setTheme(mode) {
  themeMode = Object.prototype.hasOwnProperty.call(COATS, mode) ? mode : 'system';
  applyTheme();
}

async function applyStoredTheme() {
  themeMode = (await db.settings.get('theme')) || 'dark';
  applyTheme();
  /* M32: the speech colour switch */
  try { document.body.classList.toggle('plain-speech', (await db.settings.get('colourSpeech')) === false); } catch (err) { /* colour is a courtesy */ }
}

if (sky && sky.addEventListener) {
  sky.addEventListener('change', () => { if (themeMode === 'system') applyTheme(); });
}

/* ---------- the visible viewport (--vvh), keyboard-safe (M8) ---------- */

function setVvh() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vvh', h + 'px');
}

setVvh();
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setVvh);
} else {
  window.addEventListener('resize', setVvh);
}

/* ---------- toasts: small warm words, bottom-centred (M8) ---------- */

function toast(words, onTap) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const pill = document.createElement('div');
  pill.className = 'toast';
  pill.textContent = words;
  /* M16: a toast that asks for a tap (the update nudge) stays until it is
   * heard — it never fades out from under the reader. */
  if (typeof onTap === 'function') {
    pill.classList.add('toast-tap');
    pill.setAttribute('role', 'button');
    pill.tabIndex = 0;
    const go = () => { pill.remove(); onTap(); };
    pill.addEventListener('click', go);
    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  }
  host.appendChild(pill);
  requestAnimationFrame(() => pill.classList.add('show'));
  if (typeof onTap !== 'function') {
    setTimeout(() => {
      pill.classList.remove('show');
      setTimeout(() => pill.remove(), 250);
    }, 2600);
  }
}

/* ---------- active story ---------- */

let activeStoryId = null;

setAliasScope(() => getActiveStoryId()); /* M427 */
function getActiveStoryId() {
  return activeStoryId;
}

function setActiveStoryId(id) {
  activeStoryId = id;
  db.settings.set('activeStoryId', id).catch(() => {});
}

/* ---------- shared context ---------- */

const ctx = {
  db,
  getActiveStoryId,
  setActiveStoryId,
  setTheme,
  applyStoredTheme,
  toast,
  /* filled in by the ui modules: */
  chat: null,
  settings: null,
  drawer: null,
  housekeeper: null,
  onStoriesChanged: null,
  /* M9 (A6): false when another tab holds the pen — this one only reads. */
  holdsPen: true,
};

/* ---------- router-lite: #/settings or the chat floor ---------- */

const views = {
  chat: document.getElementById('view-chat'),
  settings: document.getElementById('view-settings'),
};

function currentRoute() {
  return location.hash === '#/settings' ? 'settings' : 'chat';
}

function showView(name) {
  /* M145: the story view is never hidden — Settings overlays it (M143), and
   * flipping the thread invisible/visible repainted sixty pages on every
   * close (811ms of browser paint in the profile). The overlay covers it. */
  views.chat.hidden = false;
  views.chat.setAttribute('aria-hidden', name !== 'chat' ? 'true' : 'false');
  const wasSettings = !views.settings.hidden;
  views.settings.hidden = name !== 'settings';
  if (name === 'settings' && ctx.settings) ctx.settings.onShow();
  /* M426: leaving Settings keeps any words typed there and not yet kept */
  if (wasSettings && name !== 'settings' && ctx.settings && typeof ctx.settings.onHide === 'function') ctx.settings.onHide();
  const btnSettings = document.getElementById('btn-settings');
  /* M97: an icon now — the words live on its label and tooltip, and flip to
   * say the way back while the settings room is open */
  const label = name === 'settings' ? 'Back to the story' : 'Settings';
  btnSettings.setAttribute('aria-label', label);
  btnSettings.title = name === 'settings' ? 'Back to the story' : 'Settings — connections, the workers, the craft, the frame';
  /* M14: the room you're in keeps the ember. */
  btnSettings.classList.toggle('current', name === 'settings');
}

window.addEventListener('hashchange', () => showView(currentRoute()));

document.getElementById('btn-settings').addEventListener('click', () => {
  location.hash = currentRoute() === 'settings' ? '#/' : '#/settings';
});

document.getElementById('btn-ledger').addEventListener('click', () => {
  if (ctx.drawer) ctx.drawer.toggle();
});

document.getElementById('btn-housekeeper').addEventListener('click', () => {
  if (ctx.housekeeper) ctx.housekeeper.toggle();
});

/* ---------- wake the tavern ---------- */

(async function start() {
  /* M140: ask the browser to keep the store through cache clears (persistent storage) */
  try { if (navigator.storage && typeof navigator.storage.persist === 'function') navigator.storage.persist().catch(() => {}); } catch (err) { /* fine */ }
  const booksStatus = await initSync(ctx);
  ctx.booksStatus = booksStatus;
  /* M160: rows left behind by tales already let go — a deleted tale's sixty
   * version ledgers, its snapshots, its housekeeper session — are swept once
   * at boot. They cost real room on the device and rode _house.json on every
   * push. Runs after the books have settled so a tale still arriving is
   * never mistaken for one that is gone; quiet, and never a reason to fail
   * the open. */
  /* M347: a tale that is gone takes the words its pages were sent with it (js/sent.js keeps them in its own database) */
  try { const tales = await db.stories.list(); sweepSent((tales || []).map((t) => t && t.id).filter(Boolean)).catch(() => 0); } catch (err) { /* never holds the boot */ }
  /* M382: THE PLACEHOLDER REPAIRED WHERE IT WAS SAVED. From m379 to m381 a bare "#story" was kept as the house's own
   * sentence, "A new tale — you choose it.", and that is what the storyteller was sent, every time the turn was asked.
   * It is detected exactly, and put back to what he typed — once, on the first boot of this version. */
  try { await repairStoryPlaceholder(); } catch (err) { /* the next boot tries again */ }
  try { if (typeof db.sweepOrphans === 'function') await db.sweepOrphans(); } catch (err) { /* the shelf is no worse for it */ }
  await applyStoredTheme();

  /* M97, once: the housekeeper's own thinking dial was set against the old
   * design (it rode the storyteller's connection); now that it follows the
   * house choice, the dial starts from the connection's own switch again.
   * A dial set after this stands. */
  try {
    if (!(await db.settings.get('migrated:m97'))) {
      await db.settings.delete('hkReasoning');
      await db.settings.set('migrated:m97', true);
    }
  } catch (err) { /* a store that will not take the note is left as it is */ }

  /* restore the open tale before the chat view wakes, so it renders the
   * right thread on its first pass */
  const storedStory = await db.settings.get('activeStoryId');
  if (storedStory) activeStoryId = storedStory;

  initDrawer(ctx);
  initSettings(ctx);
  initChat(ctx);
  initHousekeeper(ctx);
  initWelcome(ctx);
  /* M68: the house's context, reachable by the harness (and a curious writer) */
  window.__cozy = ctx;

  /* B7 (M9): when the shelf of stories changes, every open listener hears
   * it — the drawer re-points its live subscription, the settings view
   * refreshes its per-story blocks. */
  ctx.onStoriesChanged = () => {
    if (ctx.drawer && typeof ctx.drawer.onStoriesChanged === 'function') ctx.drawer.onStoriesChanged();
    if (ctx.settings && typeof ctx.settings.onStoriesChanged === 'function') ctx.settings.onStoriesChanged();
    if (ctx.chat && typeof ctx.chat.renderThread === 'function') ctx.chat.renderThread();
  };

  if (ctx.chat) await ctx.chat.refreshStories();
  if (ctx.chat) await ctx.chat.renderThread();
  /* M127: a story closed mid-chain finishes its last page on open */
  if (ctx.chat && typeof ctx.chat.resumeUnfinishedChain === 'function') {
    try { const s = activeStoryId ? await db.stories.get(activeStoryId) : null; if (s) await ctx.chat.resumeUnfinishedChain(s); } catch (err) { /* best-effort */ }
  }

  showView(currentRoute());

  /* A8 (M9): the house's one version, visible for debugging; sw.js derives
   * its cache name from this same constant. */
  document.documentElement.dataset.version = VERSION;

  /* A6 (M9): one tab holds the pen. A second tab opens read-only, with a
   * plain notice; if the holder closes, a waiting tab is told it may take
   * the pen on its next visit. */
  try {
    const pen = await acquirePen({
      onPromoted: () => {
        toast('The other tab let the pen go — reload this one to write again.');
      },
    });
    ctx.holdsPen = pen.primary;
    if (!pen.primary) {
      const notice = document.getElementById('read-only-notice');
      if (notice) notice.hidden = false;
      document.body.classList.add('read-only');
      const input = document.getElementById('composer-input');
      const sendBtn = document.getElementById('btn-send');
      if (input) {
        input.disabled = true;
        input.placeholder = 'Another tab holds the pen — this one only reads.';
      }
      if (sendBtn) sendBtn.disabled = true;
    }
    window.addEventListener('beforeunload', () => pen.release());
  } catch (err) { /* a lock that won't hold is no reason to lock the door */ }

  /* A8 (M9): the worker is a module now, and its cache name comes from the
   * one VERSION in js/version.js — a deploy can't forget to bump it.
   * M16: the update nudge. When a new worker finishes installing while an
   * old controller still holds the room, the tavern says so warmly — one
   * tap refreshes. And when the new worker takes over (controllerchange),
   * the page reloads ONCE: the guard keeps it from looping, and a page
   * that loaded with no controller (a first visit) simply settles in. */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        /* never mid-sentence: a reload waits for the storyteller to finish */
        const go = () => { if (ctx.chat && typeof ctx.chat.isBusy === 'function' && ctx.chat.isBusy()) { setTimeout(go, 2000); return; } location.reload(); };
        go();
      });
      const registration = await navigator.serviceWorker.register('sw.js', { type: 'module' });
      /* M141: the tavern looks for a new coat on every open, whenever the page
       * comes back into view, and every ten minutes — and the new worker takes
       * over on its own (skipWaiting + claim), so the page reloads itself
       * once; nobody has to remember to refresh. */
      const lookForUpdate = () => {
        try {
          registration.update().catch(() => {});
          /* M200: and if a worker is already waiting — installed but never
           * given the room — tell it to take over. A coat that installed
           * while the server was mid-restart used to sit there unused. */
          if (registration.waiting) registration.waiting.postMessage({ kind: 'takeOver' });
        } catch (err) { /* fine */ }
      };
      lookForUpdate();
      /* M200: the launcher pulls and RESTARTS serve.py, so the first look can
       * land while the port is still dead. A few more, close together, catch
       * the coat the moment the tavern is warm again — instead of leaving the
       * writer on the old one until the ten-minute round comes by. */
      for (const wait of [2000, 6000, 15000, 30000]) setTimeout(lookForUpdate, wait);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lookForUpdate(); });
      setInterval(lookForUpdate, 10 * 60 * 1000);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new coat is on the tavern — tap to refresh.', () => location.reload());
          }
        });
      });
    } catch (err) {
      /* the shell still works online; offline just won't be cached yet */
    }
  }
})();
