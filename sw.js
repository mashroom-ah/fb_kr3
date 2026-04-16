/**
 * Service Worker (Практики 13-17)
 * 
 * Включает:
 * - Кэширование App Shell
 * - Push уведомления
 * - Обработку кнопки "Отложить на 5 минут"
 */

const CACHE_NAME = 'pr17-cache-v3';

// App Shell: минимум файлов для офлайн-работы
const ASSETS_TO_CACHE = [
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

// =====================================================
// INSTALL
// =====================================================

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS_TO_CACHE);
      await cache.addAll(CONTENT_PAGES);
    })()
  );
  self.skipWaiting();
});

// =====================================================
// ACTIVATE
// =====================================================

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

// =====================================================
// FETCH
// =====================================================

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// =====================================================
// PUSH (Практика 16-17)
// =====================================================

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  
  const title = data.title || 'Напоминание';
  const body = data.body || 'У вас новое уведомление';
  const reminderId = data.reminderId || null;
  
  // Добавляем кнопку "Отложить" только если есть reminderId
  const actions = [];
  if (reminderId) {
    actions.push({ action: 'snooze_5m', title: '⏰ Отложить на 5 минут' });
  }
  
  const options = {
    body,
    data: {
      url: data.url || '/',
      reminderId,
    },
    actions,
    icon: '/assets/icons/favicon-128x128.png',
    badge: '/assets/icons/favicon-48x48.png',
    vibrate: [200, 100, 200],
    requireInteraction: true  // Уведомление не исчезает автоматически
  };
  
  event.waitUntil(self.registration.showNotification(title, options));
});

// =====================================================
// NOTIFICATION CLICK (Практика 16-17)
// =====================================================

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const { url, reminderId } = event.notification.data || {};
  
  // ПР17: Обработка кнопки "Отложить на 5 минут"
  if (event.action === 'snooze_5m' && reminderId) {
    console.log('[SW] Snooze clicked for reminder:', reminderId);
    
    event.waitUntil(
      fetch('/api/reminders/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderId, minutes: 5 }),
      })
      .then(response => {
        if (response.ok) {
          console.log('[SW] Reminder rescheduled successfully');
          // Показываем подтверждение
          return self.registration.showNotification('Напоминание отложено', {
            body: 'Новое уведомление придёт через 5 минут',
            icon: '/assets/icons/favicon-128x128.png',
          });
        }
      })
      .catch(error => {
        console.error('[SW] Snooze request failed:', error);
      })
    );
    return;
  }
  
  // Обычный клик по уведомлению — открываем приложение
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url || '/') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url || '/');
      }
    })
  );
});