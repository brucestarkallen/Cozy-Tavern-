/* Cozy Tavern — app.js
 * Bootstrap: theme, router-lite between the two views, service worker,
 * and the shared context handed to each UI module.
 */

import { db } from './store.js';
import { initChat } from './ui/chat.js';
import { initSettings } from './ui/settings.js';
import { initDrawer } from './ui/drawer.js';

/* ---------- theme: follow the sky unless told otherwise ---------- */

const sky = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let themeMode = 'system';

function resolveTheme() {
  if (themeMode === 'dark' || themeMode === 'light') return themeMode;
  return sky && sky.matches ? 'dark' : 'light';
}

function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolveTheme() === 'dark' ? '#211c16' : '#f6f1e7');
}

function setTheme(mode) {
  themeMode = mode === 'dark' || mode === 'light' ? mode : 'system';
  applyTheme();
}

async function applyStoredTheme() {
  themeMode = (await db.settings.get('theme')) || 'system';
  applyTheme();
}

if (sky && sky.addEventListener) {
  sky.addEventListener('change', () => { if (themeMode === 'system') applyTheme(); });
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
  /* filled in by the ui modules: */
  chat: null,
  settings: null,
  drawer: null,
  onStoriesChanged: null,
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
  document.getElementById('btn-settings').textContent =
    name === 'settings' ? 'Back to the story' : 'Settings';
}

window.addEventListener('hashchange', () => showView(currentRoute()));

document.getElementById('btn-settings').addEventListener('click', () => {
  location.hash = currentRoute() === 'settings' ? '#/' : '#/settings';
});

document.getElementById('btn-ledger').addEventListener('click', () => {
  if (ctx.drawer) ctx.drawer.toggle();
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

  if (ctx.chat) await ctx.chat.refreshStories();
  if (ctx.chat) await ctx.chat.renderThread();

  showView(currentRoute());

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (err) {
      /* the shell still works online; offline just won't be cached yet */
    }
  }
})();
