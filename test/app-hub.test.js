import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeShortcut,
  normalizeWebUrl,
  openAppDestination,
  parseAppDestination,
  readShortcuts,
  writeShortcuts,
} from '../public/app-hub.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('normalizes web URLs and rejects unsafe protocols or embedded credentials', () => {
  assert.equal(normalizeWebUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeWebUrl('http://localhost:4173/'), 'http://localhost:4173/');
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com',
    'https://user:password@example.com',
    'https://example.com/a b',
  ]) {
    assert.throws(() => normalizeWebUrl(value), TypeError, value);
  }
});

test('accepts explicit Android intent links with safe fallbacks and rejects unsafe intents', () => {
  const destination = parseAppDestination(
    'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end',
  );
  assert.equal(destination.kind, 'intent');
  assert.equal(destination.packageName, 'com.google.zxing.client.android');
  assert.equal(destination.fallbackUrl, 'https://play.google.com/store/apps/details?id=com.google.zxing.client.android');
  assert.match(destination.url, /S\.browser_fallback_url=https%3A%2F%2Fplay\.google\.com/);

  const embeddedFallback = parseAppDestination(
    'intent://open/#Intent;scheme=https;package=com.example.reader;S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fweb;end',
  );
  assert.equal(embeddedFallback.fallbackUrl, 'https://example.com/web');

  assert.throws(() => parseAppDestination('intent://open/#Intent;scheme=javascript;package=com.example.app;end'));
  assert.throws(() => parseAppDestination('intent://open/#Intent;scheme=https;end'));
  assert.throws(() => parseAppDestination(
    'intent://open/#Intent;scheme=https;package=com.example.app;end',
    'javascript:alert(1)',
  ));
  assert.throws(() => parseAppDestination('whatsapp://send?text=hello'));
});

test('persists default examples and edited/reordered shortcuts in browser storage', () => {
  const storage = createStorage();
  const defaults = readShortcuts(storage);
  assert.deepEqual(defaults.map((shortcut) => shortcut.name), ['Google', 'YouTube', 'GitHub', 'Wikipedia']);
  assert.deepEqual(readShortcuts(storage), defaults);

  const edited = normalizeShortcut({ ...defaults[1], name: 'Video', url: 'https://m.youtube.com/' });
  const saved = writeShortcuts([edited, defaults[0]], storage);
  assert.deepEqual(readShortcuts(storage), saved);
  assert.equal(saved[0].name, 'Video');
  assert.equal(saved[0].url, 'https://m.youtube.com/');
  assert.deepEqual(writeShortcuts([], storage), []);
  assert.deepEqual(readShortcuts(storage), []);
});

test('validates shortcut names, limits, and uploaded image-only icon data', () => {
  assert.throws(() => normalizeShortcut({ name: ' ', url: 'https://example.com' }));
  assert.throws(() => normalizeShortcut({ name: 'x'.repeat(33), url: 'https://example.com' }));
  assert.throws(() => normalizeShortcut({ name: 'Unsafe', url: 'javascript:alert(1)' }));
  assert.throws(() => normalizeShortcut({
    name: 'SVG',
    url: 'https://example.com',
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
  }));
  assert.throws(() => writeShortcuts(Array(61).fill({ name: 'App', url: 'https://example.com' }), createStorage()));
});

test('rejects malformed or duplicate saved shortcut records', () => {
  const storage = createStorage();
  storage.setItem('jarvis.app-hub.v1', JSON.stringify([
    { id: 'same-id', name: 'First', url: 'https://example.com' },
    { id: 'same-id', name: 'Second', url: 'https://example.org' },
  ]));
  assert.throws(() => readShortcuts(storage), /duplicate identifiers/);
  storage.setItem('jarvis.app-hub.v1', JSON.stringify([{ name: 'Missing ID', url: 'https://example.com' }]));
  assert.throws(() => readShortcuts(storage), /missing identifiers/);
});

test('opens validated destinations safely and falls back when app launch is blocked', () => {
  const calls = [];
  const successWindow = { opener: {} };
  const result = openAppDestination('https://example.com', (url, target) => {
    calls.push([url, target]);
    return successWindow;
  });
  assert.equal(result.opened, true);
  assert.equal(successWindow.opener, null);
  assert.deepEqual(calls, [['https://example.com/', '_blank']]);

  calls.length = 0;
  const intent = parseAppDestination('intent://open/#Intent;scheme=example;package=com.example.app;end');
  const fallbackResult = openAppDestination(intent, (url, target) => {
    calls.push([url, target]);
    return calls.length === 1 ? null : {};
  });
  assert.equal(fallbackResult.opened, true);
  assert.equal(fallbackResult.usedFallback, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], intent.fallbackUrl);

  assert.equal(openAppDestination('https://example.com', () => null).opened, false);
  assert.throws(() => openAppDestination('javascript:alert(1)', () => ({})));
});
