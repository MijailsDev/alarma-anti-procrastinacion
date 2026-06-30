const CACHE_NAME = 'alarma-anti-proc-v3';
const API_CACHE = 'alarma-api-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Almacenando recursos estaticos en cache');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== API_CACHE) {
            console.log('[SW] Eliminando cache antigua:', key);
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET') {
      e.respondWith(networkFirstWithCache(request));
    }
    return;
  }

  e.respondWith(
    fetch(request)
      .then((response) => {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

async function networkFirstWithCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cloned = response.clone();
      const cache = await caches.open(API_CACHE);
      cache.put(request, cloned);
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'Sin conexion. No hay datos en cache.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-tareas') {
    e.waitUntil(syncPendingTasks());
  }
});

async function syncPendingTasks() {
  try {
    const cache = await caches.open('pending-tasks');
    const keys = await cache.keys();
    for (const req of keys) {
      const data = await cache.match(req);
      if (data) {
        const body = await data.json();
        const response = await fetch(req, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (response.ok) {
          await cache.delete(req);
          const clients = await self.clients.matchAll();
          clients.forEach(client => client.postMessage({ type: 'task-synced', task: body }));
        }
      }
    }
  } catch (err) {
    console.error('[SW] Error en sync:', err);
  }
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'queue-task') {
    e.waitUntil(queueTask(e.data.task));
  }
});

async function queueTask(task) {
  const cache = await caches.open('pending-tasks');
  const url = `${self.location.origin}/api/tareas`;
  const request = new Request(url, { method: 'POST' });
  const response = new Response(JSON.stringify(task));
  await cache.put(request, response);
  if ('sync' in self.registration) {
    await self.registration.sync.register('sync-tareas');
  }
}

self.addEventListener('push', (e) => {
  const payload = e.data ? e.data.json() : {};
  const tareaId = payload.tareaId || null;
  const title = payload.title || 'Acción requerida';
  const body = payload.body || 'La Falsa Fecha Límite está por vencer. Revisa tus tareas pendientes.';

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-512.svg',
      badge: '/icons/icon-192.svg',
      data: { tareaId },
      vibrate: [300, 100, 300],
      tag: payload.tag || 'alarma-pendiente',
      requireInteraction: true,
      actions: [
        { action: 'complete', title: 'Completar' },
        { action: 'snooze', title: 'Posponer' }
      ]
    })
  );
});

function sendActionToClient(action, tareaId) {
  clients.matchAll({ type: 'window' }).then(clientList => {
    for (const client of clientList) {
      if ('postMessage' in client) {
        client.postMessage({ type: 'notification-action', action, tareaId });
      }
    }
  });
}

self.addEventListener('notificationclick', (e) => {
  const notification = e.notification;
  const tareaId = notification.data && notification.data.tareaId;
  notification.close();

  if (e.action === 'complete' && tareaId) {
    e.waitUntil(sendActionToClient('complete', tareaId));
    return;
  }

  if (e.action === 'snooze' && tareaId) {
    e.waitUntil(sendActionToClient('snooze', tareaId));
    return;
  }

  if (e.action === 'open_app' || !e.action) {
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow('/');
      })
    );
  }
});
