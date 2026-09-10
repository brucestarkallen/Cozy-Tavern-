/* Cozy Tavern service worker.
 * Cache-first for the app shell (same-origin GETs); network-only for
 * cross-origin traffic, so API calls to providers always go straight out
 * and are never cached or intercepted. */
'use strict';

import { VERSION } from './js/version.js';

const CACHE = 'cozytavern-shell-' + VERSION;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/chat.css',
  'css/drawer.css',
  'js/app.js',
  'js/store.js',
  'js/providers/index.js',
  'js/providers/anthropic.js',
  'js/providers/openai.js',
  'js/assemble/stack.js',
  'js/assemble/modules.js',
  'js/assemble/receipt.js',
  'js/engine/state.js',
  'js/engine/clock.js',
  'js/engine/apply.js',
  'js/engine/bodies.js',
  'js/engine/relationships.js',
  'js/engine/offscreen.js',
  'js/engine/world.js',
  'js/engine/canon.js',
  'js/engine/referee-math.js',
  'js/engine/duels.js',
  'js/engine/people.js',
  'js/agents/extractor.js',
  'js/agents/queue.js',
  'js/agents/call.js',
  'js/agents/world.js',
  'js/agents/scribe.js',
  'js/agents/referee.js',
  'js/agents/memory.js',
  'js/agents/continuity.js',
  'js/agents/status.js',
  'js/agents/jsonutil.js',
  'js/import/sillytavern.js',
  'js/import/v176map.js',
  'js/import/cards.js',
  'js/import/lorebook.js',
  'js/import/chats.js',
  'js/ui/chat.js',
  'js/ui/settings.js',
  'js/ui/drawer.js',
  'js/ui/receiptview.js',
  'js/ui/housekeeper.js',
  'js/ui/welcome.js',
  /* M30: the shell audit — every shipped module, kept honest by the harness */
  'js/agents/assign.js',
  'js/agents/director.js',
  'js/agents/editor.js',
  'js/agents/housekeeper.js',
  'js/agents/voice.js',
  'js/commands.js',
  'js/providers/effort.js',
  'js/providers/sse.js',
  'js/providers/wire.js',
  'js/regex.js',
  'js/sync.js',
  'js/tablock.js',
  'js/ui/download.js',
  'js/ui/prose.js',
  'js/ui/storyexport.js',
  'js/version.js',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Network-only for API calls and anything that isn't a same-origin GET.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first app shell, with a network fallback that refills the cache.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
