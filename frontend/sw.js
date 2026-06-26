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
  let data = {
    title: 'ALARMA DE ENTREGA CRITICA!',
    body: 'Has superado tu Falsa Fecha Limite. Entrega de inmediato al aula virtual!',
    icon: '/icons/icon-192.svg',
    vibrate: [300, 100, 300, 100, 500, 100, 500],
    tag: 'alarma-agresiva',
    requireInteraction: true
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
        { action: 'open_app', title: 'Ver Mis Tareas' },
        { action: 'silence', title: 'Silenciar' }
      ]
    })
  );
});

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
