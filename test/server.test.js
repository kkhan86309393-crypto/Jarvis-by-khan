import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';
import { getForwardedUrl, getServerEnvironment } from '../scripts/codespaces.js';
import {
  readWorkspaceView,
  saveWorkspaceView,
  switchWorkspaceView,
} from '../public/interface-switcher.js';
import { detectDeviceProfile } from '../public/device-monitor.js';

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

test('detects mobile, tablet, Windows, browser, and platform hints', () => {
  assert.deepEqual(detectDeviceProfile({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    userAgentData: { mobile: false, platform: 'Windows' },
  }), {
    deviceType: 'Desktop',
    isMobile: false,
    browser: 'Microsoft Edge',
    platform: 'Windows',
  });
  assert.deepEqual(detectDeviceProfile({
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
    userAgentData: { mobile: true, platform: 'Android' },
  }), {
    deviceType: 'Mobile device',
    isMobile: true,
    browser: 'Chrome',
    platform: 'Android',
  });
  assert.deepEqual(detectDeviceProfile({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  }), {
    deviceType: 'Tablet',
    isMobile: true,
    browser: 'Safari',
    platform: 'iOS',
  });
});

test('provides every client-selected element and the avatar/mobile controls', async () => {
  const html = await (await fetch(baseUrl)).text();
  const client = await (await fetch(`${baseUrl}/app.js`)).text();
  const interfaceSwitcher = await (await fetch(`${baseUrl}/interface-switcher.js`)).text();
  const deviceMonitor = await (await fetch(`${baseUrl}/device-monitor.js`)).text();
  const diagnostics = await (await fetch(`${baseUrl}/diagnostics.js`)).text();
  const worker = await (await fetch(`${baseUrl}/service-worker.js`)).text();
  const styles = await (await fetch(`${baseUrl}/styles.css`)).text();
  const selectedIds = [...client.matchAll(/querySelector\('#([\w-]+)'\)/g)].map((match) => match[1]);
  const missingIds = [...new Set(selectedIds)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missingIds, []);
  assert.match(html, /id="ai-avatar"/);
  assert.match(html, /class="ai-avatar is-normal" id="ai-avatar"/);
  assert.doesNotMatch(html, /class="avatar-(?:blink|smile|mouth)"/);
  assert.match(html, /id="hud-build-tag">J\.A\.R\.V\.I\.S\. · HOLOGRAPHIC CORE</);
  assert.match(html, /<img class="ai-avatar is-normal" id="ai-avatar" src="\/ai-avatar\.jpg"/);
  assert.match(html, /id="full-access-toggle"/);
  assert.match(html, /id="full-access-mobile-toggle"/);
  assert.match(html, /class="mobile-nav"/);
  assert.match(html, /id="file-input"/);
  assert.match(html, /id="dashboard-layout"/);
  assert.match(html, /<div class="dashboard-layout" id="dashboard-layout" hidden>/);
  assert.match(html, /id="conversation-view"/);
  assert.match(html, /<section class="conversation" id="conversation-view"[^>]*>/);
  assert.match(html, /id="new-interface-button"[^>]*>New Interface</);
  assert.match(html, /id="old-interface-button"[^>]*>Old Interface</);
  assert.match(html, /id="dashboard-transcript"/);
  assert.match(html, /class="left-rail"/);
  assert.match(html, /class="right-rail"/);
  assert.match(html, /id="dashboard-chat-title">AI Chat/);
  assert.match(html, /id="dashboard-voice-title">Voice Assistant/);
  assert.match(html, /id="expression-title">Live status/);
  assert.match(html, /id="voice-waveform"/);
  assert.match(html, /id="cpu-meter-track"/);
  assert.match(html, /id="ram-meter-track"/);
  assert.match(html, /id="disk-meter-track"/);
  assert.match(html, /id="device-type-value"/);
  assert.match(html, /id="platform-value"/);
  assert.match(html, /id="battery-value"/);
  assert.match(html, /id="browser-memory-value"/);
  assert.match(html, /id="backend-connection-value"/);
  assert.match(html, /data-device-group="desktop"/);
  assert.match(html, /data-device-group="mobile"/);
  assert.match(html, /class="new-feature-bar"/);
  for (const feature of ['chat', 'files', 'browser', 'voice', 'system', 'settings']) {
    assert.match(html, new RegExp(`data-avatar-feature="${feature}"`));
  }
  for (const feature of ['chat', 'voice', 'files', 'browser', 'system', 'more']) {
    assert.match(html, new RegExp(`data-dashboard-feature="${feature}"`));
  }
  assert.match(html, /class="feature-toolbar"/);
  assert.match(html, /id="presence-ai-status"/);
  assert.match(html, /id="presence-mic-status"/);
  assert.match(html, /id="presence-memory-status"/);
  for (const status of ['normal', 'listening', 'thinking', 'speaking', 'error']) {
    assert.match(html, new RegExp(`data-expression="${status}"`));
  }
  assert.match(html, /id="image-tools-title">Image AI/);
  assert.match(html, /id="generate-image-button"[^>]*disabled/);
  assert.match(html, /id="image-prompt-input"[^>]*disabled/);
  assert.match(html, /no image-generation service or endpoint/i);
  assert.match(html, /class="voice-console"/);
  assert.match(html, /id="dashboard-mic-button"/);
  assert.match(html, /id="dashboard-mic-button"[^>]*aria-pressed="false"/);
  assert.match(html, /class="playback-indicator"/);
  assert.match(html, /id="system-title">System monitor/);
  assert.match(html, /id="quick-title">Quick actions/);
  assert.match(html, /id="dashboard-attach-button"/);
  assert.match(html, /id="dashboard-attach-button"/);
  assert.match(html, /id="dashboard-command-form"/);
  assert.match(html, /id="history-dialog"/);
  assert.match(html, /id="file-search-dialog"/);
  assert.match(html, /id="screen-capture-dialog"/);
  assert.match(html, /id="application-dialog"/);
  assert.match(html, /id="more-navigation-dialog"/);
  assert.match(html, /id="focus-timer-button"/);
  assert.match(html, /id="ai-settings-form"/);
  assert.match(html, /id="ai-provider-select"/);
  assert.match(html, /id="ai-model-input"/);
  assert.match(html, /id="ai-base-url"/);
  assert.match(html, /id="ai-api-key"/);
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
  assert.match(interfaceSwitcher, /LEGACY_PREFERENCE_KEYS = \['jarvis\.interface\.mode\.v6', 'jarvis\.interface\.mode\.v5', 'jarvis\.interface\.mode\.v4'\]/);
  assert.match(styles, /\.holo-particles \{/);
  assert.match(html, /id="install-button"/);
  assert.match(client, /setWorkspaceView\(state\.workspaceView, \{ remember: false \}\);\s*initializeDeviceMonitor\(\)/);
  assert.doesNotMatch(client, /scheduleAvatarExpression|utterance\.onboundary|is-talking|avatarSpeechTimer/);
  assert.match(client, /dashboardCommandForm\.addEventListener\('submit'[\s\S]*?elements\.form\.requestSubmit\(\)/);
  assert.match(client, /elements\.dashboardSend\.disabled = true/);
  assert.match(client, /dashboardRetryButton\.addEventListener\('click', retryLastChat\)/);
  assert.match(client, /function retryLastChat\(\)/);
  assert.match(client, /setDashboardChatState\('thinking'/);
  assert.match(client, /setAssistantState\('error'/);
  assert.doesNotMatch(styles, /avatar-blink|avatar-smile|avatar-mouth|avatar-speech|is-talking/);
  assert.match(html, /bundled portrait is static and has no facial animation or lip-sync/);
  assert.match(client, /updateMetricGauge\(elements\.cpuMeterTrack, elements\.cpuMeter, metrics\.cpuUsagePercent\)/);
  assert.match(client, /updateMetricGauge\(elements\.ramMeterTrack, elements\.ramMeter, metrics\.memoryPercent\)/);
  assert.match(client, /updateMetricGauge\(elements\.diskMeterTrack, elements\.diskMeter, metrics\.diskPercent\)/);
  assert.match(client, /function handleDashboardFeature/);
  assert.match(client, /closest\('\[data-dashboard-feature\], \[data-avatar-feature\]'\)/);
  assert.match(client, /destination === 'settings'[\s\S]*?openSettings\(\)/);
  assert.match(client, /navigator\.permissions\.query\(\{ name: 'microphone' \}\)/);
  assert.match(client, /navigator\.getBattery\(\)/);
  assert.match(client, /performance\.memory/);
  assert.match(client, /if \(profile\.isMobile\) \{/);
  assert.match(deviceMonitor, /export function detectDeviceProfile/);
  assert.match(html, /Device details use browser-reported information/);
  assert.match(styles, /body\.new-interface \.new-feature-bar/);
  assert.match(styles, /body\.new-interface \.right-rail[\s\S]*overflow-y: auto/);
  assert.match(styles, /body\.new-interface \.right-rail \{ order: 2; \}/);
  assert.match(styles, /body\.new-interface \.left-rail \{ order: 3; \}/);
  assert.match(styles, /body\.new-interface \.holo-stage \{\s*width: min\(100%, 330px\)/);
  assert.match(styles, /body\.new-interface \.avatar-frame \{\s*width: 78%;\s*height: 91%/);
  assert.match(styles, /body\.new-interface \.right-rail \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /body\.new-interface \.holo-stage \{ width: min\(57vw, 205px\); margin: 0; \}/);
  assert.match(styles, /body\.new-interface \.new-feature-bar \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(interfaceSwitcher, /dashboard\.hidden = view !== 'dashboard'/);
  assert.match(interfaceSwitcher, /conversation\.hidden = view !== 'chat'/);
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
  assert.match(styles, /@media \(min-width: 1101px\) and \(max-width: 1399px\)/);
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
  assert.match(html, /diagnostics\.js\?hud=22/);
  assert.match(html, /id="runtime-diagnostics"/);
  assert.match(diagnostics, /JavaScript errors:/);
  assert.match(diagnostics, /get\('diagnostics'\) === '1'/);
  assert.match(worker, /jarvis-shell-v22/);
  assert.match(worker, /styles\.css\?hud=22/);
  assert.match(worker, /diagnostics\.js\?hud=22/);
  assert.match(worker, /app\.js\?hud=22/);
  assert.match(worker, /device-monitor\.js/);
  assert.match(worker, /interface-switcher\.js/);
  assert.match(worker, /const response = await fetch\(event\.request\)/);
  assert.match(client, /service-worker\.js\?hud=22/);
  assert.match(client, /feature-toolbar, \.right-rail/);
  assert.match(client, /updateAvatarExpression/);
  assert.match(styles, /\.feature-toolbar \{ display: none; \}/);
  assert.match(styles, /\.dashboard-command \{/);
  assert.match(styles, /\.ai-avatar\.is-thinking/);
  assert.match(styles, /@media \(max-width: 780px\)/);
  assert.match(styles, /@media \(min-width: 781px\) and \(max-width: 1100px\)/);
  const mobileNavigation = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.deepEqual([...mobileNavigation.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1]), [
    'dashboard', 'chat', 'voice', 'memory', 'settings',
  ]);
  assert.match(html, /id="more-tools-button"/);
  assert.doesNotMatch(client, /scheduleAvatarExpression|clearAvatarSpeech/);
  assert.match(client, /utterance\.onstart = \(\) => \{\s*if \(playbackId !== state\.speechPlaybackId\) return;\s*setAssistantState\('speaking'/);
  assert.match(client, /utterance\.onend = \(\) => \{\s*if \(playbackId !== state\.speechPlaybackId\) return;/);
  assert.doesNotMatch(styles, /\.ai-avatar\.is-talking|@keyframes avatar-speech/);
  assert.match(styles, /\.holo-stage\.is-speaking \.playback-indicator/);
});

test('switches between the original chat and new dashboard in both directions', () => {
  const dashboard = { hidden: true };
  const conversation = { hidden: false };
  const bodyClasses = new Set(['mobile-system-open']);
  const body = {
    classList: {
      toggle(name, enabled) {
        if (enabled) bodyClasses.add(name);
        else bodyClasses.delete(name);
      },
      remove(...names) {
        for (const name of names) bodyClasses.delete(name);
      },
    },
  };
  const navigationItems = ['chat', 'dashboard'].map((destination) => ({
    dataset: { nav: destination },
    classes: new Set(),
    classList: {
      toggle(name, enabled) {
        const selected = this.owner.classes;
        if (enabled) selected.add(name);
        else selected.delete(name);
      },
      owner: null,
    },
  }));
  for (const item of navigationItems) item.classList.owner = item;

  for (const [view, expectedDashboardHidden, expectedChatView] of [
    ['dashboard', false, false],
    ['chat', true, true],
    ['dashboard', false, false],
    ['chat', true, true],
  ]) {
    switchWorkspaceView(view, { dashboard, conversation, body, navigationItems });
    assert.equal(dashboard.hidden, expectedDashboardHidden);
    assert.equal(conversation.hidden, !expectedDashboardHidden);
    assert.equal(bodyClasses.has('chat-view'), expectedChatView);
    assert.equal(bodyClasses.has('new-interface'), !expectedChatView);
    assert.equal(bodyClasses.has('mobile-system-open'), false);
    assert.equal(navigationItems[0].classes.has('is-current'), expectedChatView);
    assert.equal(navigationItems[1].classes.has('is-current'), !expectedDashboardHidden);
  }
});

test('defaults to the original interface and remembers the selected interface', () => {
  const values = new Map([['jarvis.interface.mode.v6', 'new']]);
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };

  assert.equal(readWorkspaceView(storage), 'chat');
  assert.equal(values.has('jarvis.interface.mode.v6'), false);
  saveWorkspaceView('dashboard', storage);
  assert.equal(readWorkspaceView(storage), 'dashboard');
  saveWorkspaceView('chat', storage);
  assert.equal(readWorkspaceView(storage), 'chat');
  assert.equal(values.get('jarvis.interface.mode.v7'), 'old');
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
  assert.equal(health.search, 'DuckDuckGo Instant Answers with Wikipedia search fallback');
});

test('defaults server environment credentials to Google Gemini without exposing the key', async () => {
  const previousApiKey = process.env.AI_API_KEY;
  const apiKey = 'test-only-gemini-environment-secret';
  process.env.AI_API_KEY = apiKey;
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.provider, 'openai-compatible');
    assert.equal(health.model, 'gemini-2.5-flash');
    assert.equal(health.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai/');
    assert.doesNotMatch(JSON.stringify(health), new RegExp(apiKey));
  } finally {
    if (previousApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousApiKey;
  }
});

test('returns truthful server CPU, RAM, and disk metrics', async () => {
  const response = await fetch(`${baseUrl}/api/system`);
  const metrics = await response.json();
  assert.equal(response.status, 200);
  assert.match(metrics.source, /server|container/);
  assert.ok(metrics.cpuUsagePercent === null || (metrics.cpuUsagePercent >= 0 && metrics.cpuUsagePercent <= 100));
  assert.ok(metrics.cpuCount > 0);
  assert.ok(metrics.memoryTotalBytes > 0);
  assert.ok(metrics.diskTotalBytes > 0);
  assert.ok(metrics.memoryPercent >= 0 && metrics.memoryPercent <= 100);
  assert.ok(metrics.diskPercent >= 0 && metrics.diskPercent <= 100);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const nextResponse = await fetch(`${baseUrl}/api/system`);
  const nextMetrics = await nextResponse.json();
  assert.ok(Number.isFinite(nextMetrics.cpuUsagePercent));
  assert.ok(nextMetrics.cpuUsagePercent >= 0 && nextMetrics.cpuUsagePercent <= 100);
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

test('configures a server-side OpenAI-compatible provider without returning its API key', async () => {
  const localConfiguration = await fetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'ollama', model: 'qwen2.5:3b' }),
  });
  assert.deepEqual(await localConfiguration.json(), {
    configured: true,
    provider: 'ollama',
    model: 'qwen2.5:3b',
  });

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
    const localHealth = await originalFetch(`${baseUrl}/api/health`);
    const localStatus = await localHealth.json();
    assert.equal(localStatus.provider, 'ollama');
    assert.equal(localStatus.model, 'qwen2.5:3b');
    assert.equal(localStatus.aiAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  await originalFetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'environment' }),
  });

  const apiKey = 'test-only-provider-secret';
  const invalid = await fetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-compatible', model: 'bad model', apiKey }),
  });
  assert.equal(invalid.status, 400);

  const missingKey = await fetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-compatible', model: 'gemini-2.5-flash' }),
  });
  assert.equal(missingKey.status, 400);
  assert.match((await missingKey.json()).error, /API key|AI_API_KEY/);

  const invalidBaseUrl = await fetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-compatible', model: 'gemini-2.5-flash', apiKey, baseUrl: 'javascript:alert(1)' }),
  });
  assert.equal(invalidBaseUrl.status, 400);

  const geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
  const configured = await fetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-compatible', model: 'gemini-2.5-flash', apiKey, baseUrl: geminiBaseUrl }),
  });
  const configuration = await configured.json();
  assert.equal(configured.status, 200);
  assert.deepEqual(configuration, { configured: true, provider: 'openai-compatible', model: 'gemini-2.5-flash', baseUrl: geminiBaseUrl });
  assert.doesNotMatch(JSON.stringify(configuration), new RegExp(apiKey));

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const health = await healthResponse.json();
  assert.equal(health.provider, 'openai-compatible');
  assert.equal(health.model, 'gemini-2.5-flash');
  assert.equal(health.baseUrl, geminiBaseUrl);
  assert.doesNotMatch(JSON.stringify(health), new RegExp(apiKey));

  let providerAuthorization;
  let providerRequest;
  globalThis.fetch = async (input, options) => {
    if (String(input) === 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions') {
      providerAuthorization = options.headers.authorization;
      providerRequest = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Configured provider reply.' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input, options);
  };
  try {
    const chatResponse = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    const chat = await chatResponse.json();
    assert.equal(chatResponse.status, 200);
    assert.equal(chat.reply, 'Configured provider reply.');
    assert.equal(chat.provider, 'gemini-2.5-flash');
    assert.equal(providerAuthorization, `Bearer ${apiKey}`);
    assert.equal(providerRequest.model, 'gemini-2.5-flash');
    assert.deepEqual(providerRequest.messages.at(-1), { role: 'user', content: 'hello' });
    assert.doesNotMatch(JSON.stringify(chat), new RegExp(apiKey));
  } finally {
    globalThis.fetch = originalFetch;
    await originalFetch(`${baseUrl}/api/settings/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'environment' }),
    });
  }
});

test('reports rejected OpenAI-compatible provider keys without treating them as server access keys', async () => {
  const apiKey = 'test-only-invalid-provider-secret';
  const echoedToken = 'test-only-echoed-bearer-token';
  await fetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'openai-compatible',
      model: 'gemini-2.5-flash',
      apiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions') {
      return new Response(JSON.stringify({
        error: {
          code: 401,
          status: 'UNAUTHENTICATED',
          message: `API key ${apiKey} rejected. Authorization: Bearer ${echoedToken}`,
        },
      }), { status: 401 });
    }
    return originalFetch(input);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.code, 'UNAUTHENTICATED');
    assert.match(result.error, /API key \[redacted\] rejected/i);
    assert.match(result.error, /redacted credential/i);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(echoedToken));
  } finally {
    globalThis.fetch = originalFetch;
    await originalFetch(`${baseUrl}/api/settings/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'environment' }),
    });
  }
});

test('returns sanitized Google upstream details for OpenAI-compatible 404 responses', async () => {
  const apiKey = 'test-only-gemini-404-provider-secret';
  const echoedToken = 'test-only-google-error-bearer-secret';
  const previousEnvironment = new Map(
    ['AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL'].map((key) => [key, process.env[key]]),
  );
  process.env.AI_API_KEY = apiKey;
  process.env.AI_MODEL = 'gemini-2.5-flash';
  process.env.AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions') {
      return new Response(JSON.stringify({
        error: {
          code: 404,
          status: 'NOT_FOUND',
          message: `Model not found for API version v1beta. API key=${apiKey}; Authorization: Bearer ${echoedToken}`,
          details: [{ sensitiveDebugField: 'test-only-sensitive-response-field' }],
        },
      }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.code, 'NOT_FOUND');
    assert.match(result.error, /Model not found for API version v1beta/i);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(echoedToken));
    assert.doesNotMatch(JSON.stringify(result), /test-only-sensitive-response-field|sensitiveDebugField/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('explains missing upstream error messages without exposing response details', async () => {
  const previousEnvironment = new Map(
    ['AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL'].map((key) => [key, process.env[key]]),
  );
  process.env.AI_API_KEY = 'test-only-gemini-missing-message-secret';
  process.env.AI_MODEL = 'gemini-2.5-flash';
  process.env.AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions') {
      return new Response(JSON.stringify({
        error: {
          code: 404,
          status: 'NOT_FOUND',
          details: [{ privateDiagnostic: 'test-only-private-response-value' }],
        },
      }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.code, 'NOT_FOUND');
    assert.match(result.error, /response was missing an error message/i);
    assert.doesNotMatch(JSON.stringify(result), /privateDiagnostic|test-only-private-response-value/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('does not append chat completions twice when the configured base URL already includes the endpoint', async () => {
  const baseUrlWithEndpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const configured = await fetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'openai-compatible',
      model: 'gemini-2.5-flash',
      apiKey: 'test-only-provider-secret',
      baseUrl: baseUrlWithEndpoint,
    }),
  });
  assert.equal(configured.status, 200);

  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/v1beta/openai/')) {
      upstreamUrl = String(input);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Endpoint verified.' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamUrl, baseUrlWithEndpoint);
  } finally {
    globalThis.fetch = originalFetch;
    await originalFetch(`${baseUrl}/api/settings/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'environment' }),
    });
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
  const protectedSettings = await fetch(`${baseUrl}/api/settings/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'ollama', model: 'qwen2.5:3b' }),
  });
  assert.equal(protectedSettings.status, 401);
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
  const unsupportedLanguage = await fetch(`${baseUrl}/api/search?q=test&lang=fr`);
  assert.equal(unsupportedLanguage.status, 400);
});

test('returns DuckDuckGo instant answers when it provides source-backed results', async () => {
  const originalFetch = globalThis.fetch;
  const requestedHosts = [];
  globalThis.fetch = async (input) => {
    requestedHosts.push(new URL(String(input)).hostname);
    return new Response(JSON.stringify({
      AbstractText: 'A source-backed summary.',
      AbstractURL: 'https://example.com/article',
      Heading: 'Example article',
      RelatedTopics: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/search?q=example`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source, 'DuckDuckGo Instant Answer');
    assert.equal(data.results[0].url, 'https://example.com/article');
    assert.deepEqual(requestedHosts, ['api.duckduckgo.com']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('falls back to source-linked Wikipedia results in the selected language', async () => {
  const originalFetch = globalThis.fetch;
  const requestedHosts = [];
  globalThis.fetch = async (input) => {
    const searchUrl = new URL(String(input));
    requestedHosts.push(searchUrl.hostname);
    if (searchUrl.hostname === 'api.duckduckgo.com') {
      return new Response(JSON.stringify({ RelatedTopics: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    assert.equal(searchUrl.hostname, 'hi.wikipedia.org');
    assert.equal(searchUrl.searchParams.get('gsrsearch'), 'भारत');
    return new Response(JSON.stringify({
      query: { pages: { 42: { pageid: 42, title: 'भारत', extract: 'भारत का परिचय।' } } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/search?q=${encodeURIComponent('भारत')}&lang=hi`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source, 'Wikipedia search (Hindi)');
    assert.equal(data.results[0].title, 'भारत');
    assert.equal(data.results[0].url, 'https://hi.wikipedia.org/wiki/%E0%A4%AD%E0%A4%BE%E0%A4%B0%E0%A4%A4');
    assert.deepEqual(requestedHosts, ['api.duckduckgo.com', 'hi.wikipedia.org']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports search provider outages instead of fabricating results', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
  try {
    const response = await originalFetch(`${baseUrl}/api/search?q=example`);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /DuckDuckGo Instant Answers and Wikipedia search could not be reached/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('blocks paths that escape the public directory', async () => {
  const response = await fetch(`${baseUrl}/..%2fserver.js`);
  assert.equal(response.status, 403);
});