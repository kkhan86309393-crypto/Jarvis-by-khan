import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  EXTENSION_PACKAGE_MAX_BYTES,
  LAB_EXTENSIONS_KEY,
  addPendingExtension,
  getExtensionPackageFileStatus,
  loadLabExtensions,
  recordLabExtensionExport,
  recordLabExtensionRejection,
  removeLabExtension,
  serializeLabExtensionPackage,
  setLabExtensionState,
  validateExtensionPackageText,
} from '../public/lab-extensions.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function packageText(overrides = {}) {
  return JSON.stringify({
    manifest: {
      name: 'Safe Example',
      version: '1.2.3',
      description: 'Metadata-only example package.',
      permissions: ['chat.read', 'theme.read'],
      ...overrides.manifest,
    },
    files: {
      'src/index.js': 'export default "untrusted";',
      'README.md': 'Do not execute imported content.',
      ...overrides.files,
    },
  });
}

function parsePackage(text = packageText(), fileName = 'safe.jarvis-extension.json') {
  const result = validateExtensionPackageText(text, fileName);
  assert.equal(result.valid, true, result.reason);
  return result;
}

test('validates package type, JSON manifest, version, permissions, and bounded size', () => {
  assert.equal(parsePackage().manifest.name, 'Safe Example');
  assert.equal(validateExtensionPackageText(packageText(), 'payload.js').valid, false);
  assert.equal(validateExtensionPackageText('{', 'bad.jext').valid, false);
  assert.equal(validateExtensionPackageText(packageText({ manifest: { version: 'latest' } }), 'bad.jext').valid, false);
  assert.equal(validateExtensionPackageText(packageText({ manifest: { permissions: ['secrets.read'] } }), 'bad.jext').valid, false);
  assert.equal(validateExtensionPackageText(packageText({ manifest: { extra: 'unexpected' } }), 'bad.jext').valid, false);
  const secretPackage = validateExtensionPackageText(packageText({
    files: { 'src/index.js': 'const API_KEY = "private-example-value";' },
  }), 'secret.jext');
  assert.equal(secretPackage.valid, false);
  assert.match(secretPackage.reason, /credential-like value/);
  assert.equal(validateExtensionPackageText('x'.repeat(EXTENSION_PACKAGE_MAX_BYTES + 1), 'large.jext').valid, false);

  assert.deepEqual(getExtensionPackageFileStatus({
    name: 'extension.jext',
    size: 12,
    text: async () => '{}',
  }), { valid: true });
  assert.equal(getExtensionPackageFileStatus({ name: 'extension.js', size: 12, text() {} }).valid, false);
  assert.equal(getExtensionPackageFileStatus({
    name: 'large.jext',
    size: EXTENSION_PACKAGE_MAX_BYTES + 1,
    text() {},
  }).valid, false);
});

test('rejects traversal, absolute, encoded, prototype and non-text package paths', () => {
  for (const unsafePath of [
    '../escape.js',
    'src/../escape.js',
    '/absolute.js',
    'C:/windows.js',
    'src\\escape.js',
    'src/%2e%2e/escape.js',
    'src/__proto__/escape.js',
    'constructor/unsafe.js',
  ]) {
    const result = validateExtensionPackageText(packageText({ files: { [unsafePath]: 'text' } }), 'bad.jext');
    assert.equal(result.valid, false, unsafePath);
  }
  assert.equal(validateExtensionPackageText(packageText({ files: { 'script.js': { code: 'not text' } } }), 'bad.jext').valid, false);
});

test('imports into pending review without modifying JARVIS preferences', () => {
  const storage = createStorage({ 'jarvis.preferences.v1': '{"voiceURI":"existing"}' });
  const extension = addPendingExtension(storage, parsePackage(), { id: 'ext-1', timestamp: 100 });

  assert.equal(extension.state, 'pending-review');
  assert.deepEqual(extension.manifest.permissions, ['chat.read', 'theme.read']);
  const saved = loadLabExtensions(storage);
  assert.equal(saved.extensions.length, 1);
  assert.equal(saved.history[0].action, 'pending-review');
  assert.equal(storage.values.get('jarvis.preferences.v1'), '{"voiceURI":"existing"}');
  assert.throws(() => addPendingExtension(storage, parsePackage(), { id: 'ext-2' }), /already imported/);
});

test('preserves malformed or inaccessible extension storage instead of treating it as empty', () => {
  const corrupt = createStorage({ [LAB_EXTENSIONS_KEY]: '{' });
  assert.throws(() => loadLabExtensions(corrupt), /not valid JSON/);
  assert.equal(corrupt.values.get(LAB_EXTENSIONS_KEY), '{');

  const malformed = createStorage({
    [LAB_EXTENSIONS_KEY]: JSON.stringify({ extensions: [{ id: 'broken' }], history: [] }),
  });
  assert.throws(() => loadLabExtensions(malformed), /invalid package record/);
  assert.throws(() => loadLabExtensions({
    getItem() {
      throw new Error('Storage unavailable');
    },
  }), /Storage unavailable/);
});

test('redacts credential-like values from stored extension history and rejects sensitive paths', () => {
  const storage = createStorage({
    [LAB_EXTENSIONS_KEY]: JSON.stringify({
      extensions: [],
      history: [{
        timestamp: 1,
        extensionId: 'old-package',
        extensionName: 'API_KEY="history-secret-value"',
        action: 'removed',
      }],
    }),
  });
  const history = loadLabExtensions(storage).history;
  assert.doesNotMatch(history[0].extensionName, /history-secret-value/);
  assert.equal(validateExtensionPackageText(packageText({
    files: { 'private-token/config.js': 'const setting = true;' },
  }), 'sensitive-path.jext').valid, false);
});

test('approval, enable, disable and removal retain package-management history', () => {
  const storage = createStorage();
  const imported = addPendingExtension(storage, parsePackage(), { id: 'ext-1', timestamp: 1 });
  assert.throws(() => setLabExtensionState(storage, imported.id, 'installed'), /Review and install/);

  const approved = setLabExtensionState(storage, imported.id, 'disabled', 2);
  assert.equal(approved.state, 'disabled');
  assert.equal(setLabExtensionState(storage, imported.id, 'installed', 3).state, 'installed');
  assert.equal(setLabExtensionState(storage, imported.id, 'disabled', 4).state, 'disabled');
  removeLabExtension(storage, imported.id, 5);

  assert.deepEqual(loadLabExtensions(storage).extensions, []);
  assert.deepEqual(loadLabExtensions(storage).history.map(({ action }) => action), [
    'pending-review', 'approved', 'enabled', 'disabled', 'removed',
  ]);
});

test('rejection and export are recorded, and exported package contains metadata plus inert files', () => {
  const storage = createStorage();
  const imported = addPendingExtension(storage, parsePackage(), { id: 'ext-export', timestamp: 1 });
  const exportedText = serializeLabExtensionPackage(imported);
  const exported = JSON.parse(exportedText);
  assert.deepEqual(exported.manifest, imported.manifest);
  assert.deepEqual(exported.files, JSON.parse(JSON.stringify(imported.files)));
  assert.equal(exportedText.includes('jarvis.preferences.v1'), false);

  const installed = setLabExtensionState(storage, imported.id, 'disabled', 2);
  recordLabExtensionExport(storage, installed, 3);
  assert.equal(loadLabExtensions(storage).history.at(-1).action, 'exported');
  recordLabExtensionRejection(storage, addPendingExtension(storage, parsePackage(packageText({
    manifest: { name: 'Another Extension' },
  })), { id: 'ext-reject', timestamp: 4 }), 5);
  assert.equal(loadLabExtensions(storage).history.at(-1).action, 'rejected');
  assert.throws(() => serializeLabExtensionPackage({ manifest: {}, files: {} }), TypeError);

  const legacyDataWithSecret = {
    manifest: imported.manifest,
    files: { 'src/key.js': 'const API_KEY = "legacy-secret-value";' },
  };
  assert.doesNotMatch(serializeLabExtensionPackage(legacyDataWithSecret), /legacy-secret-value/);
});

test('manager requires explicit import and permission approval and never loads package scripts', () => {
  const card = html.match(/data-lab-module="extensions"[\s\S]*?<\/article>/)?.[0] || '';
  const panel = html.match(/<section class="extensions-panel"[\s\S]*?<\/section>\s*<p class="lab-disclaimer"/)?.[0] || '';

  assert.match(card, /aria-controls="extensions-panel"/);
  assert.match(panel, /id="extensions-package-file" type="file"/);
  assert.match(panel, /requested permissions/i);
  assert.match(panel, /API keys, passwords, tokens/);
  assert.match(app, /window\.confirm\(\s*'Import an untrusted extension package/);
  assert.match(app, /Requested permissions \(not granted\)/);
  assert.match(app, /metadata only\. No code runs and no permissions or secret access are granted/);
  assert.match(app, /data-lab-module="extensions"\]'\)\.addEventListener\('click', openExtensionsPanel\)/);
  assert.match(app, /extensions-back'\)\.addEventListener\('click', closeExtensionsPanel\)/);
  assert.match(app, /elements\.extensionsList\.addEventListener\('click', handleLabExtensionAction\)/);
  assert.match(app, /elements\.extensionsList\.append\(card\)/);
  const extensionHandlers = app.slice(app.indexOf('function importLabExtension'), app.indexOf('function resetPersonalizeDraft'));
  assert.doesNotMatch(extensionHandlers, /eval\(|new Function|import\(|\/api\/chat|fetch\(|createElement\(['"]script['"]\)/);
});
