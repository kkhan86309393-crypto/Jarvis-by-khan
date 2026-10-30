const CACHE_NAME = 'jarvis-shell-v53';
const APP_SHELL = ['/', '/styles.css?hud=43', '/diagnostics.js?hud=28', '/app.js?hud=48', '/lab-personalize.js', '/lab-ai-modify.js', '/lab-code-studio.js', '/lab-extensions.js', '/lab-safety.js', '/app-hub.js', '/search-summary.js', '/interface-switcher.js', '/device-monitor.js', '/share-link.js', '/manifest.webmanifest', '/icons/jarvis.svg', '/icons/jarvis-192.png', '/icons/jarvis-512.png'];
const NETWORK_TIMEOUT_MS = 4_000;

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'JARVIS_DIAGNOSTICS') return;
  event.ports?.[0]?.postMessage({ cacheVersion: CACHE_NAME });
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('jarvis-shell-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const response = await fetch(event.request, { signal: controller.signal });
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        try {
          await cache.put(event.request, response.clone());
        } catch (error) {
          console.warn('J.A.R.V.I.S. could not update its offline asset cache.', error);
        }
      } else if (response.status >= 500 && cached) {
        return cached;
      }
      return response;
    } catch (error) {
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const appShell = await caches.match('/');
        if (appShell) return appShell;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })());
});
