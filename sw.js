/**
 * Service Worker (Практики 13–16)
 * Объединённая версия с улучшенным кэшированием и поддержкой Push
 */

const CACHE_NAME = 'pwa-combined-v2';
const SHELL_CACHE = 'pwa-shell-v1';
const RUNTIME_CACHE = 'pwa-runtime-v1';

// Основные ресурсы для предварительного кэширования
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/assets/hero.png',
  '/assets/icons/favicon.ico',
  '/assets/icons/favicon-16x16.png',
  '/assets/icons/favicon-32x32.png',
  '/assets/icons/favicon-48x48.png',
  '/assets/icons/favicon-64x64.png',
  '/assets/icons/favicon-128x128.png',
  '/assets/icons/favicon-256x256.png',
  '/assets/icons/favicon-512x512.png',
  '/assets/icons/apple-touch-icon.png'
];

// Контентные страницы для App Shell
const CONTENT_PAGES = [
  '/content/home.html',
  '/content/theory.html',
  '/content/push.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
      await cache.addAll(CONTENT_PAGES);
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

// =========================================================
// Стратегии кэширования
// =========================================================

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shellCached = await caches.match(request);
    if (shellCached) return shellCached;
    return new Response('Офлайн: ресурс недоступен', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request).then(async (response) => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => {});
  
  return cachedResponse || fetchPromise;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('Офлайн: ресурс недоступен', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// =========================================================
// Fetch handler
// =========================================================

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // HTML страницы (навигация): Network First
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Контентные страницы App Shell: Network First
  if (url.pathname.startsWith('/content/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // CSS и JS: Stale While Revalidate
  if (event.request.destination === 'style' || event.request.destination === 'script') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Остальные ресурсы: Cache First
  event.respondWith(cacheFirst(event.request));
});

// =========================================================
// Push API (Практика 16)
// =========================================================

self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) {
      data = JSON.parse(event.data.text());
    }
  } catch (error) {
    console.error('[SW] Push parse error:', error);
  }

  const title = data.title || '📋 Планировщик задач';
  const options = {
    body: data.body || 'У вас есть обновления в списке задач!',
    icon: '/assets/icons/favicon-192x192.png',
    badge: '/assets/icons/favicon-96x96.png',
    data: {
      url: data.url || '/'
    },
    vibrate: [200, 100, 200]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })()
  );
});