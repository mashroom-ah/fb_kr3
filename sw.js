/**
 * УЛУЧШЕНИЯ (согласно TODO из комментариев):
 * - Добавлен runtime-cache для GET-ресурсов
 * - Реализована стратегия Network First для HTML
 * - Реализована стратегия Stale While Revalidate для CSS/JS
 * - Улучшен fallback для офлайн-режима
 */

const CACHE_NAME = 'practice-13-14-cache-v4';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/hero.png',
  './assets/icons/favicon.ico',
  './assets/icons/favicon-16x16.png',
  './assets/icons/favicon-32x32.png',
  './assets/icons/favicon-48x48.png',
  './assets/icons/favicon-64x64.png',
  './assets/icons/favicon-128x128.png',
  './assets/icons/favicon-256x256.png',
  './assets/icons/favicon-512x512.png',
  './assets/icons/apple-touch-icon-57x57.png',
  './assets/icons/apple-touch-icon-114x114.png',
  './assets/icons/apple-touch-icon-120x120.png',
  './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheKeys) => {
      return Promise.all(
        cacheKeys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  // =========================================================
  // 1. ДЛЯ HTML-СТРАНИЦ: стратегия Network First
  // =========================================================
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(async () => {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response(
            '<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>Офлайн-режим</h1><p>Вы не подключены к интернету.</p><button onclick="location.reload()">Попробовать снова</button></body></html>',
            {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }
          );
        })
    );
    return;
  }

  // =========================================================
  // 2. ДЛЯ CSS И JS: стратегия Stale While Revalidate
  // =========================================================
  if (event.request.destination === 'style' || event.request.destination === 'script') {
    event.respondWith(
      (async () => {
        const cachedResponse = await caches.match(event.request);

        const fetchPromise = fetch(event.request).then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          console.log('Сеть недоступна для фонового обновления');
        });

        if (cachedResponse) {
          return cachedResponse;
        }

        return await fetchPromise;
      })()
    );
    return;
  }

  // =========================================================
  // 3. ДЛЯ ВСЕХ ОСТАЛЬНЫХ РЕСУРСОВ: стратегия Cache First
  // =========================================================
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          if (event.request.destination === 'image') {
            return new Response('Изображение недоступно офлайн', {
              status: 200,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          }
          return new Response('Офлайн: ресурс недоступен', {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
    })
  );
});