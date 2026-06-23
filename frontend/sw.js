const CACHE_NAME = 'alarma-anti-proc-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.json'
];

// Instalar Service Worker y almacenar recursos en caché
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 [Service Worker] Almacenando recursos estáticos en caché');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activar y limpiar cachés antiguas
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('🧹 [Service Worker] Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Interceptar peticiones para servir desde caché de manera preferente (offline first para los recursos locales)
self.addEventListener('fetch', (e) => {
  // Ignorar peticiones a la API del backend para que siempre vayan a la red en vivo
  if (e.request.url.includes('/api/')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        return networkResponse;
      });
    }).catch(() => {
      // Si falla y es una página, podríamos devolver un fallback
    })
  );
});

// --- BASE ARQUITECTÓNICA PARA NOTIFICACIONES PUSH AGRESIVAS ---
// Este evento escuchará señales del servidor (FCM/WebPush) para disparar avisos intrusivos
self.addEventListener('push', (e) => {
  let data = {
    title: '🚨 ¡ALARMA DE ENTREGA CRÍTICA!',
    body: 'Has superado tu Falsa Fecha Límite. ¡Entrega de inmediato al aula virtual!',
    icon: 'https://img.icons8.com/color/192/alarm.png',
    vibrate: [300, 100, 300, 100, 500, 100, 500], // Patrón de vibración agresiva en móviles
    tag: 'alarma-agresiva',
    requireInteraction: true // Mantiene la notificación visible hasta que el usuario interactúe
  };

  if (e.data) {
    try {
      const payload = e.data.json();
      data = { ...data, ...payload };
    } catch (err) {
      data.body = e.data.text();
    }
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.icon,
      vibrate: data.vibrate,
      tag: data.tag,
      requireInteraction: data.requireInteraction,
      actions: [
        { action: 'open_app', title: '🛡️ Ver Mis Tareas' },
        { action: 'silence', title: '🔕 Silenciar' }
      ]
    })
  );
});

// Manejar clics en notificaciones
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  if (e.action === 'open_app' || !e.action) {
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});
