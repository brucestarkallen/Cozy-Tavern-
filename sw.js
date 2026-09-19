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
  'js/providers/room.js',
  'js/providers/detect.js',
  'js/providers/order.js',
  'js/providers/anthropic.js',
  'js/providers/openai.js',
  'js/assemble/stack.js',
  'js/assemble/voice.js',
  'js/assemble/anchor.js',
  'js/assemble/modules.js',
  'js/assemble/craft.js',
  'js/assemble/receipt.js',
  'js/engine/state.js',
  'js/engine/clock.js',
  'js/engine/apply.js',
  'js/engine/bodies.js',
  'js/engine/relationships.js',
  'js/engine/offscreen.js',
  'js/engine/world.js',
  'js/engine/whole.js',
  'js/engine/sentence.js',
  'js/engine/pagecut.js',
  'js/agents/lookup.js',
  'js/engine/canon.js',
  'js/engine/referee-math.js',
  'js/engine/duels.js',
  'js/engine/people.js',
  'js/agents/extractor.js',
  'js/agents/queue.js',
  'js/agents/call.js',
  'js/agents/world.js',
  'js/agents/auditor.js',
  'js/agents/founder.js',
  'js/agents/rebuild.js',
  'js/agents/scribe.js',
  'js/agents/referee.js',
  'js/agents/memory.js',
  'js/agents/continuity.js',
  'js/agents/lint.js',
  'js/agents/ripple.js',
  'js/agents/status.js',
  'js/agents/jsonutil.js',
  'js/import/sillytavern.js',
  'js/import/v176map.js',
  'js/import/cards.js',
  'js/import/lorebook.js',
  'js/import/chats.js',
  'js/ui/chat.js',
  'js/ui/headergate.js',
  'js/ui/pageshape.js',
  'js/ui/settings.js',
  'js/ui/drawer.js',
  'js/ui/receiptview.js',
  'js/ui/housekeeper.js',
  'js/ui/streamtext.js',
  'js/ui/welcome.js',
  'js/ui/workbanner.js',
  'js/ui/richhtml.js',
  /* M30: the shell audit — every shipped module, kept honest by the harness */
  'js/agents/assign.js',
  'js/agents/director.js',
  'js/agents/editor.js',
  'js/agents/housekeeper.js',
  'js/agents/tidy.js',
  'js/agents/voice.js',
  'js/commands.js',
  'js/providers/effort.js',
  'js/providers/sse.js',
  'js/providers/wire.js',
  'js/regex.js',
  'js/regex-styles.js',
  'js/sync.js',
  'js/sync-worker.js',
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
  /* M200: A NEW COAT MUST NEVER BE HELD UP BY ONE MISSING FILE. skipWaiting
   * was chained AFTER cache.addAll(SHELL), and addAll is all-or-nothing — so
   * a single asset that 404s (a file added to the house and forgotten in the
   * list, a file removed and left in it) failed the whole install, the new
   * worker never took over, and every browser served the old coat FOREVER
   * with no sign of why. The takeover comes first and does not depend on the
   * cache; the shell is filled file by file, and a file that will not come
   * is simply not cached. */
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(
      SHELL.map((path) => cache.add(path).catch(() => null))
    ))
  );
});

/* M200: a waiting worker takes over when the room asks it to. */
self.addEventListener('message', (event) => {
  if (event && event.data && event.data.kind === 'takeOver') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      /* M160: and sweep any api/ answers an older coat had already kept, so a
       * browser heals itself even if it lands on the same version again. */
      .then(() => caches.open(CACHE))
      .then((cache) => cache.keys().then((reqs) => Promise.all(
        reqs.filter((r) => /(^|\/)api\//.test(new URL(r.url).pathname)).map((r) => cache.delete(r))
      )))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Network-only for API calls and anything that isn't a same-origin GET.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* M160: THE DEVICE'S BOOKS ARE NEVER THE SHELL. Every same-origin GET fell
   * into the cache-first branch below — including api/books/list,
   * api/books/one/<tale> and api/version. The first read of the manifest was
   * kept, and from then on this browser answered its own boot from that
   * frozen copy for the whole life of a version: the other browser's newer
   * pages were never seen (their stamps looked old), and a book pulled from
   * the cache could overwrite newer pages with an older telling. The API is
   * the device speaking; it goes to the wire, always, and nothing about it
   * is ever written to a cache. */
  if (/(^|\/)api\//.test(url.pathname)) return;

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
