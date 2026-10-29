import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeShortcut,
  normalizeWebUrl,
  initializeAppHubs,
  dispatchAppDestination,
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

test('normalizes tel links for the dialer and sms links for a reviewed message draft', () => {
  const call = parseAppDestination('tel:+1 (555) 123-4567');
  assert.equal(call.kind, 'call');
  assert.equal(call.url, 'tel:+15551234567');

  const message = parseAppDestination('sms:+15551234567?body=Meet me at 5!');
  assert.equal(message.kind, 'message');
  assert.equal(new URL(message.url).pathname, '+15551234567');
  assert.equal(new URL(message.url).searchParams.get('body'), 'Meet me at 5!');

  const emptyDraft = parseAppDestination('sms:+15551234567');
  assert.equal(emptyDraft.url, 'sms:+15551234567');
});

test('rejects unsafe call and message URI parameters and invalid phone numbers', () => {
  for (const value of [
    'tel:911?automatic=true',
    'tel:+12',
    'sms:5551234567?to=5557654321',
    'sms:5551234567?body=one&body=two',
    'sms:5551234567?body=ok#fragment',
    `sms:5551234567?body=${'x'.repeat(2_001)}`,
    'javascript:alert(1)',
  ]) {
    assert.throws(() => parseAppDestination(value), TypeError, value);
  }
});

test('hands call and message links to the browser without sending them from JARVIS', () => {
  const opened = [];
  const launch = (value) => openAppDestination(value, (url, target) => {
    opened.push({ url, target });
    return {};
  });

  assert.equal(launch('tel:+15551234567').opened, true);
  assert.equal(launch('sms:+15551234567?body=Hello').opened, true);
  assert.deepEqual(opened, [
    { url: 'tel:+15551234567', target: '_blank' },
    { url: 'sms:+15551234567?body=Hello', target: '_blank' },
  ]);

  const unavailable = openAppDestination('tel:+15551234567', () => null);
  assert.equal(unavailable.opened, false);
  assert.equal(unavailable.handoffAttempted, true);
});

test('handles browsers that throw or block navigation without escaping the launcher', () => {
  assert.equal(openAppDestination('https://example.com', () => { throw new Error('blocked'); }).opened, false);
  const blockedCall = openAppDestination('tel:+15551234567', () => { throw new Error('unsupported scheme'); });
  assert.equal(blockedCall.opened, false);
  assert.equal(blockedCall.handoffAttempted, false);
});

test('dispatches approved destinations through the explicit desktop callback', () => {
  const opened = [];
  const result = dispatchAppDestination(
    parseAppDestination('https://example.com/path'),
    () => { throw new Error('browser fallback should not run'); },
    (url) => { opened.push(url); return true; },
  );

  assert.equal(result.handoffAttempted, true);
  assert.equal(result.destination.kind, 'web');
  assert.deepEqual(opened, ['https://example.com/path']);
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
  const desktopRequestedUrls = [];
  let desktopBridgeEnabled = false;
  let blockNextOpen = false;
  let clipboardAllowed = true;
  let copiedText = '';
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
      openWindow: (url) => {
        openedUrls.push(url);
        if (blockNextOpen) {
          blockNextOpen = false;
          return null;
        }
        return {};
      },
      copyUserText: async (text) => {
        copiedText = text;
        return clipboardAllowed;
      },
      openDesktopExternal: (url) => {
        if (!desktopBridgeEnabled) return false;
        desktopRequestedUrls.push(url);
        return true;
      },
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

    root.fields.get('run-url').value = 'tel:+15551234567';
    await submit(root.runner);
    assert.equal(openedUrls.at(-1), 'tel:+15551234567');
    assert.match(root.status.textContent, /does not place calls/i);

    root.fields.get('run-url').value = 'sms:+15551234567?body=Hello';
    await submit(root.runner);
    assert.equal(openedUrls.at(-1), 'sms:+15551234567?body=Hello');
    assert.match(root.status.textContent, /does not send messages/i);

    desktopBridgeEnabled = true;
    root.fields.get('run-url').value = 'https://system-browser.example/path';
    await submit(root.runner);
    assert.deepEqual(desktopRequestedUrls, ['https://system-browser.example/path']);
    assert.match(root.status.textContent, /default browser was asked/i);

    root.fields.get('run-url').value = 'Copy this user-entered text';
    await click('copy-text');
    assert.equal(copiedText, 'Copy this user-entered text');
    assert.match(root.status.textContent, /copied to the clipboard/i);

    clipboardAllowed = false;
    await click('copy-text');
    assert.match(root.status.textContent, /Clipboard access was denied/i);

    root.fields.get('run-url').value = '';
    await click('copy-text');
    assert.match(root.status.textContent, /Enter text in URL Runner/i);

    desktopBridgeEnabled = false;
    blockNextOpen = true;
    root.fields.get('run-url').value = 'https://external.example/path';
    await submit(root.runner);
    assert.match(root.status.textContent, /could not confirm navigation.*blocked or handed off externally/i);

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
