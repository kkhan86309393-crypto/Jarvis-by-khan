import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeShortcut,
  normalizeWebUrl,
  initializeAppHubs,
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

test('routes Vision actions from both App Hub roots through the same callback', () => {
  const roots = [];
  const createElement = () => ({
    dataset: {},
    append() {},
    replaceChildren() {},
    setAttribute() {},
  });
  const createRoot = () => {
    const listeners = new Map();
    const root = {
      listeners,
      addEventListener: (type, listener) => listeners.set(type, listener),
      querySelector: (selector) => selector === '[data-hub-search]'
        ? { value: '' }
        : createElement(),
    };
    roots.push(root);
    return root;
  };
  createRoot();
  createRoot();
  const storage = createStorage();
  const documentObject = { querySelectorAll: () => roots, createElement };
  let openVisionCalls = 0;

  const previousDocument = globalThis.document;
  globalThis.document = documentObject;
  try {
    initializeAppHubs({ documentObject, storage, onOpenVision: () => { openVisionCalls += 1; } });
    for (const root of roots) {
      const clickHandler = root.listeners.get('click');
      assert.equal(typeof clickHandler, 'function');
      clickHandler({
        target: { closest: () => ({ dataset: { hubAction: 'vision' } }) },
      });
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(openVisionCalls, 2);
});

test('adds, edits, deletes, runs a URL, and saves an uploaded shortcut icon', async () => {
  const roots = [];
  const createElement = () => ({
    dataset: {},
    children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    focus() {},
  });
  const createRoot = () => {
    const listeners = new Map();
    const fields = new Map();
    for (const name of ['name', 'url', 'fallback', 'icon', 'run-url', 'run-fallback']) {
      fields.set(name, {
        value: '',
        files: [],
        matches: (selector) => name === 'icon' && selector === '[data-hub-field="icon"]',
        focus() {},
      });
    }
    const form = createElement();
    form.hidden = true;
    form.matches = (selector) => selector === '[data-hub-form]';
    form.reset = () => {
      for (const field of fields.values()) {
        field.value = '';
        field.files = [];
      }
    };
    const runner = createElement();
    runner.matches = (selector) => selector === '[data-hub-runner]';
    const search = { value: '' };
    const apps = createElement();
    const status = createElement();
    const iconStatus = createElement();
    const root = {
      listeners,
      fields,
      form,
      runner,
      apps,
      status,
      addEventListener: (type, listener) => listeners.set(type, listener),
      querySelector(selector) {
        if (selector === '[data-hub-search]') return search;
        if (selector === '[data-hub-apps]') return apps;
        if (selector === '[data-hub-form]') return form;
        if (selector === '[data-hub-runner]') return runner;
        if (selector === '[data-hub-status]') return status;
        if (selector === '[data-hub-icon-status]') return iconStatus;
        const match = selector.match(/^\[data-hub-field="([^"]+)"\]$/);
        return match ? fields.get(match[1]) : null;
      },
    };
    roots.push(root);
    return root;
  };
  const root = createRoot();
  createRoot();
  const documentObject = { querySelectorAll: () => roots, createElement };
  const storage = createStorage();
  const intentShortcut = normalizeShortcut({
    name: 'Scanner',
    url: 'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end',
  });
  writeShortcuts([...readShortcuts(storage), intentShortcut], storage);
  const openedUrls = [];
  let fullAccessEnabled = false;
  const globalListeners = new Map();
  const previousDocument = globalThis.document;
  const previousFileReader = globalThis.FileReader;
  const previousAddEventListener = globalThis.addEventListener;
  globalThis.document = documentObject;
  globalThis.addEventListener = (type, listener) => globalListeners.set(type, listener);
  globalThis.FileReader = class {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    readAsDataURL() {
      this.result = 'data:image/png;base64,AAAA';
      this.listeners.get('load')();
    }
  };

  const click = (action, shortcutId = '') => root.listeners.get('click')({
    target: { closest: () => ({ dataset: { hubAction: action, shortcutId } }) },
  });
  const submit = async (form) => root.listeners.get('submit')({
    target: { closest: () => form },
    preventDefault() {},
  });

  try {
    initializeAppHubs({
      documentObject,
      storage,
      openWindow: (url) => { openedUrls.push(url); return {}; },
      canLaunchIntent: () => fullAccessEnabled,
    });

    const scannerCard = root.apps.children.find((card) => card.children[1].children[0].textContent === 'Scanner');
    assert.equal(scannerCard.children[2].children[0].disabled, true);
    click('launch', intentShortcut.id);
    assert.equal(openedUrls.length, 0);
    assert.match(root.status.textContent, /Enable Full Access/);
    root.fields.get('run-url').value = intentShortcut.url;
    await submit(root.runner);
    assert.equal(openedUrls.length, 0);

    fullAccessEnabled = true;
    globalListeners.get('jarvis:full-access-change')();
    const enabledScannerCard = root.apps.children.find((card) => card.children[1].children[0].textContent === 'Scanner');
    assert.equal(enabledScannerCard.children[2].children[0].disabled, false);
    click('launch', intentShortcut.id);
    assert.equal(openedUrls.length, 1);
    assert.match(openedUrls[0], /^intent:\/\//);

    click('add');
    root.fields.get('name').value = 'Docs';
    root.fields.get('url').value = 'docs.example.com';
    root.fields.get('icon').files = [{ type: 'image/png', size: 4 }];
    await root.listeners.get('change')({ target: root.fields.get('icon') });
    await submit(root.form);

    let saved = readShortcuts(storage);
    assert.equal(saved.length, 6);
    const shortcutId = saved.at(-1).id;
    assert.equal(saved.at(-1).url, 'https://docs.example.com/');
    assert.equal(saved.at(-1).icon, 'data:image/png;base64,AAAA');
    assert.equal(roots[1].apps.children.length, 6);

    click('edit', shortcutId);
    root.fields.get('name').value = 'Docs Updated';
    await submit(root.form);
    saved = readShortcuts(storage);
    assert.equal(saved.at(-1).name, 'Docs Updated');
    assert.equal(saved.at(-1).icon, 'data:image/png;base64,AAAA');

    root.fields.get('run-url').value = 'https://example.org/path';
    await submit(root.runner);
    assert.equal(openedUrls.at(-1), 'https://example.org/path');

    click('delete', shortcutId);
    assert.equal(readShortcuts(storage).length, 5);
    assert.equal(roots[1].apps.children.length, 5);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousFileReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = previousFileReader;
    if (previousAddEventListener === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = previousAddEventListener;
  }
});
