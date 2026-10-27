const CACHE_NAME = 'jarvis-shell-v22';
const APP_SHELL = ['/', '/styles.css?hud=22', '/diagnostics.js?hud=22', '/app.js?hud=22', '/interface-switcher.js', '/device-monitor.js', '/manifest.webmanifest', '/icons/jarvis.svg', '/icons/jarvis-192.png', '/icons/jarvis-512.png', '/ai-avatar.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const appShell = await caches.match('/');
          if (appShell) return appShell;
        }
        throw error;
      }
    })()
  );
});