/* Cozy Tavern — app.js
 * Bootstrap: theme, router-lite between the two views, service worker,
 * and the shared context handed to each UI module.
 */

import { db } from './store.js';
import { initChat } from './ui/chat.js';
import { initSettings } from './ui/settings.js';
import { initDrawer } from './ui/drawer.js';
import { initHousekeeper } from './ui/housekeeper.js';
import { initWelcome } from './ui/welcome.js';
import { switchWorkerStory } from './agents/queue.js';
import { VERSION } from './version.js';
import { acquirePen } from './tablock.js';

/* ---------- theme: lamplight by default; "follow the sky" is a choice ----
 * M8: the hearth (dark) is the default face. Nothing stored → dark. The
 * "system" choice still follows the sky and listens for its changes. */

const sky = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
let themeMode = 'dark';

function resolveTheme() {
  if (themeMode === 'dark' || themeMode === 'light') return themeMode;
  /* system mode: follow the sky, hearth when the sky is silent */
  return sky && sky.matches ? 'light' : 'dark';
}

function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolveTheme() === 'dark' ? '#16120f' : '#f5efe4');
}

function setTheme(mode) {
  themeMode = mode === 'dark' || mode === 'light' ? mode : 'system';
  applyTheme();
}

async function applyStoredTheme() {
  themeMode = (await db.settings.get('theme')) || 'dark';
  applyTheme();
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

function toast(words) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const pill = document.createElement('div');
  pill.className = 'toast';
  pill.textContent = words;
  host.appendChild(pill);
  requestAnimationFrame(() => pill.classList.add('show'));
  setTimeout(() => {
    pill.classList.remove('show');
    setTimeout(() => pill.remove(), 250);
  }, 2600);
}

/* ---------- active story ---------- */

let activeStoryId = null;

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
  views.chat.hidden = name !== 'chat';
  views.settings.hidden = name !== 'settings';
  if (name === 'settings' && ctx.settings) ctx.settings.onShow();
  const btnSettings = document.getElementById('btn-settings');
  btnSettings.textContent =
    name === 'settings' ? 'Back to the story' : 'Settings';
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
  await applyStoredTheme();

  /* restore the open tale before the chat view wakes, so it renders the
   * right thread on its first pass */
  const storedStory = await db.settings.get('activeStoryId');
  if (storedStory) activeStoryId = storedStory;

  initDrawer(ctx);
  initSettings(ctx);
  initChat(ctx);
  initHousekeeper(ctx);
  initWelcome(ctx);

  /* B7 (M9): when the shelf of stories changes, every open listener hears
   * it — the drawer re-points its live subscription, the settings view
   * refreshes its per-story blocks. */
  ctx.onStoriesChanged = () => {
    if (ctx.drawer && typeof ctx.drawer.onStoriesChanged === 'function') ctx.drawer.onStoriesChanged();
    if (ctx.settings && typeof ctx.settings.onStoriesChanged === 'function') ctx.settings.onStoriesChanged();
  };

  if (ctx.chat) await ctx.chat.refreshStories();
  if (ctx.chat) await ctx.chat.renderThread();

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
   * one VERSION in js/version.js — a deploy can't forget to bump it. */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try {
      await navigator.serviceWorker.register('sw.js', { type: 'module' });
    } catch (err) {
      /* the shell still works online; offline just won't be cached yet */
    }
  }
})();
