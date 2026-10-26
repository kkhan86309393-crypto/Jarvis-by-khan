import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';
import { getForwardedUrl, getServerEnvironment } from '../scripts/codespaces.js';

const previousEnvironment = new Map();
for (const key of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROVIDER', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'APP_ACCESS_TOKEN', 'NODE_ENV']) {
  previousEnvironment.set(key, process.env[key]);
  delete process.env[key];
}

const server = createAppServer();
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('serves the app shell with restrictive browser security headers', async () => {
  const response = await fetch(baseUrl);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(html, /J\.A\.R\.V\.I\.S\./);
});

test('provides every client-selected element and the avatar/mobile controls', async () => {
  const html = await (await fetch(baseUrl)).text();
  const client = await (await fetch(`${baseUrl}/app.js`)).text();
  const worker = await (await fetch(`${baseUrl}/service-worker.js`)).text();
  const styles = await (await fetch(`${baseUrl}/styles.css`)).text();
  const selectedIds = [...client.matchAll(/querySelector\('#([\w-]+)'\)/g)].map((match) => match[1]);
  const missingIds = [...new Set(selectedIds)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missingIds, []);
  assert.match(html, /id="ai-avatar"/);
  assert.match(html, /id="hud-build-tag">J\.A\.R\.V\.I\.S\. · HOLOGRAPHIC CORE</);
  assert.match(html, /<img class="ai-avatar" id="ai-avatar" src="\/ai-avatar\.jpg"/);
  assert.match(html, /id="full-access-toggle"/);
  assert.match(html, /id="full-access-mobile-toggle"/);
  assert.match(html, /class="mobile-nav"/);
  assert.match(html, /id="file-input"/);
  assert.match(html, /id="dashboard-layout"/);
  assert.match(html, /id="conversation-view"/);
  assert.match(html, /class="left-rail"/);
  assert.match(html, /class="right-rail"/);
  assert.match(html, /class="voice-console"/);
  assert.match(html, /id="dashboard-mic-button"/);
  assert.match(html, /id="dashboard-attach-button"/);
  assert.match(html, /id="dashboard-command-form"/);
  assert.match(html, /id="history-dialog"/);
  assert.match(html, /id="file-search-dialog"/);
  assert.match(html, /id="screen-capture-dialog"/);
  assert.match(html, /id="application-dialog"/);
  assert.match(html, /id="more-navigation-dialog"/);
  assert.match(html, /id="focus-timer-button"/);
  assert.match(html, /id="study-quick-indicator"/);
  for (const destination of ['history', 'files', 'applications', 'study', 'productivity', 'system']) {
    assert.match(html, new RegExp(`data-nav="${destination}"`));
  }
  for (const action of ['capture', 'files', 'applications', 'search', 'chat', 'study']) {
    assert.match(html, new RegExp(`data-quick-action="${action}"`));
  }
  assert.match(html, /data-nav="study"/);
  assert.match(html, /data-nav="productivity"/);
  assert.match(html, /data-nav="system"/);
  assert.match(client, /getDisplayMedia/);
  assert.match(client, /showHistory/);
  assert.match(client, /searchAttachedFiles/);
  assert.match(client, /setWorkspaceView\('chat'\)/);
  assert.match(client, /toggleStudyMode/);
  assert.match(client, /loadSystemMetrics/);
  assert.match(client, /jarvis\.interface\.mode\.v4/);
  assert.match(styles, /\.holo-particles \{/);
  assert.match(html, /id="install-button"/);
  assert.match(html, /id="interface-toggle"[^>]*>Old UI</);
  assert.match(html, /class="holo-particles"/);
  assert.match(html, /id="install-help"/);
  assert.match(client, /beforeinstallprompt/);
  assert.match(client, /appinstalled/);
  assert.match(client, /showInstallInstructions/);
  assert.match(worker, /jarvis-192\.png/);
  assert.match(worker, /jarvis-512\.png/);
  assert.match(styles, /@media \(max-width: 780px\)/);
  assert.match(styles, /\.mobile-nav \{ position: fixed/);
  assert.match(styles, /\.ai-avatar \{[^}]*object-fit: cover;[^}]*mix-blend-mode: normal;/);
  assert.match(styles, /\.dashboard-layout \{[^}]*minmax\(220px, \.76fr\) minmax\(510px, 1\.85fr\) minmax\(270px, \.94fr\)/);
  assert.match(styles, /\.dashboard-layout \{ grid-template-columns: minmax\(140px, \.72fr\) minmax\(240px, 1\.32fr\) minmax\(170px, \.82fr\)/);
  assert.match(styles, /@media \(min-width: 901px\) and \(max-width: 1100px\)/);
  assert.match(styles, /\.holo-stage \{ width: min\(100%, 630px\)/);
  assert.match(styles, /\.orbit-three \{ width: 121%; height: 121%;/);
  assert.match(styles, /\.orbit-two \{[^}]*perspective\(850px\) rotateX\(67deg\)/);
  assert.match(styles, /\.avatar-frame \{ width: 87%; height: 98%;/);
  assert.match(styles, /\.activity-log \{ min-height: 150px; flex: 1/);
  assert.match(styles, /\.left-rail, \.right-rail \{ display: none; \}/);
  assert.match(styles, /body\.mobile-system-open \.dashboard-layout > \.right-rail/);
  assert.match(styles, /body\.mobile-news-open \.right-rail \.briefing-panel/);
  assert.match(styles, /body\.mobile-activity-open \.left-rail \.activity-panel/);
  assert.match(styles, /\.presence \{[^}]*grid-template-rows: auto minmax\(260px, 1fr\)/);
  assert.match(worker, /jarvis-shell-v10/);
  assert.match(worker, /styles\.css\?hud=10/);
  assert.match(worker, /app\.js\?hud=10/);
  assert.match(styles, /\.dashboard-command \{/);
});

test('serves PWA metadata with the current dashboard theme', async () => {
  const response = await fetch(`${baseUrl}/manifest.webmanifest`);
  const manifest = await response.json();
  assert.equal(response.status, 200);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#050a17');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
});

test('serves valid 192px and 512px PNG installation icons', async () => {
  for (const size of [192, 512]) {
    const response = await fetch(`${baseUrl}/icons/jarvis-${size}.png`);
    const image = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/png/);
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(image.readUInt32BE(16), size);
    assert.equal(image.readUInt32BE(20), size);
  }
});

test('serves the photographic portrait as a local JPEG asset', async () => {
  const response = await fetch(`${baseUrl}/ai-avatar.jpg`);
  const image = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/jpeg/);
  assert.ok(image.length > 20_000);
  assert.deepEqual([...image.slice(0, 3)], [0xff, 0xd8, 0xff]);
});

test('formats a private Codespaces HTTPS URL and handles non-Codespaces runs', () => {
  assert.equal(
    getForwardedUrl({ codespaceName: 'bright-jarvis', forwardingDomain: 'app.github.dev', port: 4173 }),
    'https://bright-jarvis-4173.app.github.dev',
  );
  assert.equal(getForwardedUrl({ forwardingDomain: 'app.github.dev' }), null);
});

test('selects the requested local Ollama model without adding credentials', () => {
  const configured = getServerEnvironment({}, ['--ollama']);
  assert.equal(configured.AI_PROVIDER, 'ollama');
  assert.equal(configured.OLLAMA_BASE_URL, 'http://127.0.0.1:11434');
  assert.equal(configured.OLLAMA_MODEL, 'qwen2.5:3b');
  assert.equal('AI_API_KEY' in configured, false);
});

test('reports provider and access configuration without exposing credentials', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const health = await response.json();
  assert.equal(response.status, 200);
  assert.equal(health.aiConfigured, false);
  assert.equal(health.aiAvailable, false);
  assert.equal(health.ollamaAvailable, null);
  assert.equal(health.accessRequired, false);
  assert.equal(health.accessConfigured, false);
  assert.equal(health.search, 'DuckDuckGo Instant Answer');
});

test('returns truthful server CPU, RAM, and disk metrics', async () => {
  const response = await fetch(`${baseUrl}/api/system`);
  const metrics = await response.json();
  assert.equal(response.status, 200);
  assert.match(metrics.source, /server|container/);
  assert.ok(Number.isFinite(metrics.cpuLoad1mPercent));
  assert.ok(metrics.cpuCount > 0);
  assert.ok(metrics.memoryTotalBytes > 0);
  assert.ok(metrics.diskTotalBytes > 0);
  assert.ok(metrics.memoryPercent >= 0 && metrics.memoryPercent <= 100);
  assert.ok(metrics.diskPercent >= 0 && metrics.diskPercent <= 100);
});

test('rejects invalid chat payloads and reports a missing provider honestly', async () => {
  const invalid = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'system', content: 'bad role' }] }),
  });
  assert.equal(invalid.status, 400);

  const unavailable = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
  });
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /No AI provider is configured/);
});

test('routes chat to Ollama and returns its actual response', async () => {
  process.env.AI_PROVIDER = 'ollama';
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  process.env.OLLAMA_MODEL = 'qwen2.5:3b';
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (input, options) => {
    if (String(input) === 'http://127.0.0.1:11434/api/chat') {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ message: { content: 'Test response from local model.' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input, options);
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'नमस्ते' }], language: 'hi', mode: 'study' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.reply, 'Test response from local model.');
    assert.equal(data.provider, 'Ollama / qwen2.5:3b');
    assert.equal(requestBody.model, 'qwen2.5:3b');
    assert.equal(requestBody.stream, false);
    assert.ok(requestBody.messages.some((message) => message.content.includes('Reply in Hindi')));
    assert.ok(requestBody.messages.some((message) => message.content.includes('Study Mode')));
    assert.deepEqual(requestBody.messages.at(-1), { role: 'user', content: 'नमस्ते' });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.AI_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
  }
});

test('health distinguishes a reachable Ollama daemon from an installed model', async () => {
  process.env.AI_PROVIDER = 'ollama';
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  process.env.OLLAMA_MODEL = 'qwen2.5:3b';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    if (String(input) === 'http://127.0.0.1:11434/api/tags') {
      return new Response(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input, options);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/health`);
    const health = await response.json();
    assert.equal(health.aiConfigured, true);
    assert.equal(health.aiAvailable, true);
    assert.equal(health.ollamaAvailable, true);
    assert.equal(health.modelInstalled, true);
    assert.equal(health.model, 'qwen2.5:3b');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.AI_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
  }
});

test('reports a useful error when the configured local Ollama daemon is unreachable', async () => {
  process.env.AI_PROVIDER = 'ollama';
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    if (String(input) === 'http://127.0.0.1:11434/api/chat') throw new TypeError('connection refused');
    return originalFetch(input, options);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Start Ollama on the server host/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.AI_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
  }
});

test('rejects oversized request bodies', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(24_100) }] }),
  });
  assert.equal(response.status, 413);
});

test('requires the configured server access token for chat and search', async () => {
  process.env.APP_ACCESS_TOKEN = 'unit-test-access-token';
  const chatRequest = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
  };
  const missing = await fetch(`${baseUrl}/api/chat`, chatRequest);
  assert.equal(missing.status, 401);
  const wrong = await fetch(`${baseUrl}/api/search?q=test`, { headers: { authorization: 'Bearer wrong-token' } });
  assert.equal(wrong.status, 401);
  const protectedMetrics = await fetch(`${baseUrl}/api/system`);
  assert.equal(protectedMetrics.status, 401);
  const valid = await fetch(`${baseUrl}/api/chat`, {
    ...chatRequest,
    headers: { ...chatRequest.headers, authorization: 'Bearer unit-test-access-token' },
  });
  assert.equal(valid.status, 503);
  delete process.env.APP_ACCESS_TOKEN;
});

test('fails closed in production when an access token has not been configured', async () => {
  process.env.NODE_ENV = 'production';
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.accessRequired, true);
  assert.equal(health.accessConfigured, false);
  const response = await fetch(`${baseUrl}/api/search?q=test`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /locked/);
  delete process.env.NODE_ENV;
});

test('validates search queries before contacting the search provider', async () => {
  const empty = await fetch(`${baseUrl}/api/search?q=`);
  assert.equal(empty.status, 400);
  const tooLong = await fetch(`${baseUrl}/api/search?q=${'x'.repeat(201)}`);
  assert.equal(tooLong.status, 400);
});

test('blocks paths that escape the public directory', async () => {
  const response = await fetch(`${baseUrl}/..%2fserver.js`);
  assert.equal(response.status, 403);
});