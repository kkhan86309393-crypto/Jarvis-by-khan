import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const workerSource = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

function createWorker({ fetchImpl = async () => { throw new TypeError('offline'); }, cacheNames = [], timeout = setTimeout } = {}) {
  const origin = 'https://jarvis.test';
  const listeners = new Map();
  const storedResponses = new Map();
  const deletedCaches = [];
  let activeCacheName;
  let skipWaitingCalled = false;
  let clientsClaimed = false;
  let fetchCalls = 0;
  const cache = {
    async addAll(paths) {
      for (const path of paths) storedResponses.set(new URL(path, origin).href, new Response(`cached ${path}`));
    },
    async put(request, response) {
      storedResponses.set(request.url, response);
    },
  };
  const caches = {
    async open(name) {
      activeCacheName = name;
      return cache;
    },
    async keys() {
      return [...cacheNames, ...(activeCacheName ? [activeCacheName] : [])];
    },
    async delete(name) {
      deletedCaches.push(name);
      return true;
    },
    async match(request) {
      const url = typeof request === 'string' ? new URL(request, origin).href : request.url;
      return storedResponses.get(url) || null;
    },
  };
  const self = {
    location: { origin },
    clients: { claim: async () => { clientsClaimed = true; } },
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: async () => { skipWaitingCalled = true; },
  };
  const fetch = (...args) => {
    fetchCalls += 1;
    return fetchImpl(...args);
  };
  runInNewContext(workerSource, { self, caches, fetch, URL, AbortController, setTimeout: timeout, clearTimeout, Response, console });
  return {
    listeners,
    storedResponses,
    deletedCaches,
    get skipWaitingCalled() { return skipWaitingCalled; },
    get clientsClaimed() { return clientsClaimed; },
    get fetchCalls() { return fetchCalls; },
  };
}

async function dispatchFetch(worker, request) {
  let responsePromise;
  worker.listeners.get('fetch')({
    request: { method: 'GET', mode: 'navigate', ...request },
    respondWith: (response) => { responsePromise = Promise.resolve(response); },
  });
  return responsePromise;
}

test('installs the lightweight app shell without avatar assets', async () => {
  const worker = createWorker();
  let installation;
  worker.listeners.get('install')({ waitUntil: (promise) => { installation = promise; } });
  await installation;
  assert.equal(worker.skipWaitingCalled, true);
  assert.ok(worker.storedResponses.has('https://jarvis.test/'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/styles.css?hud=43'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/diagnostics.js?hud=28'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/app.js?hud=48'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/lab-personalize.js'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/lab-ai-modify.js'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/lab-code-studio.js'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/lab-extensions.js'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/lab-safety.js'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/app-hub.js'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/search-summary.js'));
  assert.ok(worker.storedResponses.has('https://jarvis.test/manifest.webmanifest'));
  assert.equal(worker.storedResponses.has('https://jarvis.test/avatar-cues.js'), false);
  assert.equal(worker.storedResponses.has('https://jarvis.test/ai-avatar.jpg'), false);
  assert.equal(worker.storedResponses.has('https://jarvis.test/reference-face.jpg'), false);
  assert.equal(worker.storedResponses.has('https://jarvis.test/avatar3d.bundle.js'), false);
});

test('reports the active shell cache version only to an explicit diagnostics request', () => {
  const worker = createWorker();
  let version;
  worker.listeners.get('message')({
    data: { type: 'JARVIS_DIAGNOSTICS' },
    ports: [{ postMessage: (message) => { version = message.cacheVersion; } }],
  });
  assert.equal(version, 'jarvis-shell-v53');

  let ignored = false;
  worker.listeners.get('message')({
    data: { type: 'OTHER_MESSAGE' },
    ports: [{ postMessage: () => { ignored = true; } }],
  });
  assert.equal(ignored, false);
});

test('removes only obsolete JARVIS shell caches when activating', async () => {
  const worker = createWorker({ cacheNames: ['jarvis-shell-v34', 'unrelated-app-cache'] });
  let activation;
  worker.listeners.get('activate')({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.deepEqual(worker.deletedCaches, ['jarvis-shell-v34']);
  assert.equal(worker.clientsClaimed, true);
});

test('serves the cached app shell promptly when offline', async () => {
  const worker = createWorker();
  worker.storedResponses.set('https://jarvis.test/', new Response('<main>JARVIS</main>'));
  const response = await dispatchFetch(worker, { url: 'https://jarvis.test/', mode: 'navigate' });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /JARVIS/);
});

test('refreshes cached UI assets from the network for the next reopen', async () => {
  const worker = createWorker({ fetchImpl: async () => new Response('fresh styles') });
  worker.storedResponses.set('https://jarvis.test/styles.css?hud=30', new Response('old styles'));
  const response = await dispatchFetch(worker, {
    url: 'https://jarvis.test/styles.css?hud=30',
    mode: 'no-cors',
  });
  assert.equal(await response.text(), 'fresh styles');
  const cached = worker.storedResponses.get('https://jarvis.test/styles.css?hud=30');
  assert.equal(await cached.text(), 'fresh styles');
});

test('uses cached UI on upstream 5xx and keeps API requests out of cache', async () => {
  const worker = createWorker({ fetchImpl: async () => new Response('unavailable', { status: 503 }) });
  worker.storedResponses.set('https://jarvis.test/styles.css?hud=30', new Response('cached styles'));
  const response = await dispatchFetch(worker, {
    url: 'https://jarvis.test/styles.css?hud=30',
    mode: 'no-cors',
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'cached styles');

  let intercepted = false;
  worker.listeners.get('fetch')({
    request: { method: 'GET', url: 'https://jarvis.test/api/health', mode: 'cors' },
    respondWith: () => { intercepted = true; },
  });
  assert.equal(intercepted, false);
});

test('falls back to cache when the network exceeds the short UI fetch deadline', async () => {
  let timeoutMs;
  const worker = createWorker({
    timeout: (callback, milliseconds) => {
      timeoutMs = milliseconds;
      queueMicrotask(callback);
      return 1;
    },
    fetchImpl: (_request, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')), { once: true });
    }),
  });
  worker.storedResponses.set('https://jarvis.test/', new Response('<main>offline shell</main>'));
  const response = await dispatchFetch(worker, { url: 'https://jarvis.test/', mode: 'navigate' });
  assert.equal(timeoutMs, 4_000);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /offline shell/);
});

test('defines an always-on Render web service and keeps deployment secrets out of source', async () => {
  const blueprint = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');
  assert.match(blueprint, /type: web/);
  assert.match(blueprint, /runtime: node/);
  assert.match(blueprint, /plan: starter/);
  assert.match(blueprint, /healthCheckPath: \/api\/health/);
  assert.match(blueprint, /key: AI_API_KEY\s+sync: false/);
  assert.match(blueprint, /key: APP_ACCESS_TOKEN\s+generateValue: true/);
  assert.doesNotMatch(blueprint, /AIza[0-9A-Za-z_-]{20,}|GEMINI_API_KEY\s*:/);
});
