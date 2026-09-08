/* Cozy Tavern service worker.
 * Cache-first for the app shell (same-origin GETs); network-only for
 * cross-origin traffic, so API calls to providers always go straight out
 * and are never cached or intercepted. */
'use strict';

const CACHE = 'cozytavern-shell-v1';

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
  'js/ui/chat.js',
  'js/ui/settings.js',
  'js/ui/drawer.js',
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
