import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer, lockRuntimeGeminiApiKey, setRuntimeGeminiApiKey } from '../server.js';
import {
  createGeminiKeyStore,
  getGeminiKeyStorageAvailability,
  registerGeminiKeyIpcHandlers,
} from '../desktop/gemini-key-storage.js';

const originalFetch = globalThis.fetch;
const temporaryDirectories = [];
const server = createAppServer();
let baseUrl;

function createMockSafeStorage({
  available = true,
  backend = 'test-keychain',
} = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString(value) {
      return Buffer.from(`mock-encrypted:${Buffer.from(value).toString('base64')}`);
    },
    decryptString(value) {
      const encrypted = value.toString();
      if (!encrypted.startsWith('mock-encrypted:')) throw new Error('Invalid ciphertext');
      return Buffer.from(encrypted.slice('mock-encrypted:'.length), 'base64').toString();
    },
  };
}

async function createTemporaryKeyStore(safeStorage = createMockSafeStorage()) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-gemini-key-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    filePath: join(directory, 'gemini-api-key.enc'),
    store: createGeminiKeyStore({
      safeStorage,
      filePath: join(directory, 'gemini-api-key.enc'),
    }),
  };
}

function createTrustedEvent() {
  const frame = { url: 'http://127.0.0.1:4173/?desktop-app=1' };
  return { senderFrame: frame, sender: { mainFrame: frame } };
}

function createIpcHandlers(
  keyStore,
  setGeminiApiKey = () => ({ provider: 'gemini', model: 'gemini-test-model' }),
  lockGeminiApiKey = () => {},
) {
  const handlers = new Map();
  registerGeminiKeyIpcHandlers({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    expectedOrigin: 'http://127.0.0.1:4173',
    keyStore,
    setGeminiApiKey,
    lockGeminiApiKey,
  });
  return handlers;
}

async function postJson(path, body) {
  return originalFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  lockRuntimeGeminiApiKey();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test('encrypts the key to disk and unlocks it after creating a new store instance', async () => {
  const apiKey = 'test-only-persistent-gemini-key';
  const { filePath, store } = await createTemporaryKeyStore();
  const model = 'gemini-key-storage-test-model';
  await store.save(apiKey, model);

  const encryptedFile = await readFile(filePath);
  assert.ok(encryptedFile.length > 0);
  assert.equal(encryptedFile.includes(Buffer.from(apiKey)), false);

  const restartedStore = createGeminiKeyStore({
    safeStorage: createMockSafeStorage(),
    filePath,
  });
  assert.deepEqual(await restartedStore.status(), {
    persistentStorageAvailable: true,
    hasSavedKey: true,
    model,
  });
  let activatedKey;
  let activatedModel;
  const result = await restartedStore.unlock(async (key, selectedModel) => {
    activatedKey = key;
    activatedModel = selectedModel;
  });
  assert.deepEqual(result, { unlocked: true, persistentStorageAvailable: true });
  assert.equal(activatedKey, apiKey);
  assert.equal(activatedModel, model);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.equal(encryptedFile.includes(Buffer.from(model)), false);
});

test('refuses persistence with unavailable or basic-text safeStorage and reports session-only use', async () => {
  const unavailableStorage = createMockSafeStorage({ available: false });
  const unavailable = await createTemporaryKeyStore(unavailableStorage);
  assert.deepEqual(getGeminiKeyStorageAvailability(unavailableStorage), {
    available: false,
    message: 'OS-backed encryption is unavailable. The Gemini key can only be used for the current session.',
  });
  await assert.rejects(unavailable.store.save('test-only-session-gemini-key'), {
    code: 'SAFE_STORAGE_UNAVAILABLE',
  });
  assert.equal((await unavailable.store.status()).hasSavedKey, false);

  const basicText = createMockSafeStorage({ backend: 'basic_text' });
  assert.equal(getGeminiKeyStorageAvailability(basicText).available, false);

  let activeKey;
  const handlers = createIpcHandlers(unavailable.store, (key, model) => {
    activeKey = key;
    assert.equal(model, 'gemini-session-model');
    return { provider: 'gemini', model: 'gemini-test-model' };
  });
  const result = await handlers.get('jarvis:gemini-key-save')(
    createTrustedEvent(),
    'test-only-session-gemini-key',
    'gemini-session-model',
  );
  assert.deepEqual(result, {
    saved: false,
    configuredForSession: true,
    persistentStorageAvailable: false,
    message: 'OS-backed encryption is unavailable. The Gemini key can only be used for the current session.',
  });
  assert.equal(activeKey, 'test-only-session-gemini-key');
});

test('saved keys remain locked until explicit unlock and can be locked again through IPC', async () => {
  const { store } = await createTemporaryKeyStore();
  let activeKey = null;
  let activeModel = null;
  const handlers = createIpcHandlers(
    store,
    (key, model) => {
      activeKey = key;
      activeModel = model;
      return { provider: 'gemini', model: 'gemini-test-model' };
    },
    () => { activeKey = null; },
  );
  const key = 'test-only-locked-gemini-key';
  const model = 'gemini-ui-selected-model';
  const saved = await handlers.get('jarvis:gemini-key-save')(createTrustedEvent(), key, model);
  assert.deepEqual(saved, {
    saved: true,
    configuredForSession: false,
    persistentStorageAvailable: true,
  });
  assert.equal(activeKey, null);

  const unlocked = await handlers.get('jarvis:gemini-key-unlock')(createTrustedEvent());
  assert.deepEqual(unlocked, { unlocked: true, persistentStorageAvailable: true });
  assert.equal(activeKey, key);
  assert.equal(activeModel, model);

  const locked = await handlers.get('jarvis:gemini-key-lock')(createTrustedEvent());
  assert.deepEqual(locked, { locked: true });
  assert.equal(activeKey, null);
  assert.equal(JSON.stringify({ saved, unlocked, locked }).includes(key), false);
});

test('a persisted but locked Gemini key returns clear Chat and Vision errors without fallback', async () => {
  const environmentKeys = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROVIDER', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL'];
  const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  for (const key of environmentKeys) delete process.env[key];
  const apiKey = 'test-only-locked-route-gemini-key';
  const { filePath, store } = await createTemporaryKeyStore();
  await store.save(apiKey, 'gemini-locked-test-model');
  const restartedStore = createGeminiKeyStore({
    safeStorage: createMockSafeStorage(),
    filePath,
  });
  let upstreamCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input);
    upstreamCalls += 1;
    throw new Error(`Unexpected outbound request while Gemini key is locked: ${String(input)}`);
  };

  try {
    assert.deepEqual(await restartedStore.status(), {
      persistentStorageAvailable: true,
      hasSavedKey: true,
      model: 'gemini-locked-test-model',
    });

    const chat = await postJson('/api/chat', {
      provider: 'gemini',
      messages: [{ role: 'user', content: 'Must not route while the saved key is locked.' }],
    });
    const chatError = await chat.json();
    assert.equal(chat.status, 503);
    assert.equal(chatError.code, 'AI_PROVIDER_NOT_CONFIGURED');
    assert.match(chatError.error, /Unlock the saved Gemini key/);
    assert.doesNotMatch(JSON.stringify(chatError), new RegExp(apiKey));

    const vision = await postJson('/api/vision', {
      provider: 'gemini',
      question: 'Must not route while the saved key is locked.',
      image: `data:image/jpeg;base64,${Buffer.from([
        0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00,
        0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
      ]).toString('base64')}`,
    });
    const visionError = await vision.json();
    assert.equal(vision.status, 503);
    assert.equal(visionError.code, 'AI_PROVIDER_NOT_CONFIGURED');
    assert.match(visionError.error, /Unlock the saved Gemini key/);
    assert.doesNotMatch(JSON.stringify(visionError), new RegExp(apiKey));
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    lockRuntimeGeminiApiKey();
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('validates sender origin and main-frame identity for key IPC', async () => {
  const { store } = await createTemporaryKeyStore();
  const handlers = createIpcHandlers(store);
  const save = handlers.get('jarvis:gemini-key-save');
  const check = handlers.get('jarvis:gemini-key-status');
  const unlock = handlers.get('jarvis:gemini-key-unlock');
  const lock = handlers.get('jarvis:gemini-key-lock');

  await assert.rejects(save({ senderFrame: { url: 'http://evil.invalid' }, sender: { mainFrame: {} } }, 'test-key'));
  const subframe = { url: 'http://127.0.0.1:4173/?desktop-app=1' };
  await assert.rejects(check({ senderFrame: subframe, sender: { mainFrame: {} } }));
  const wrongOriginFrame = { url: 'http://evil.invalid/' };
  await assert.rejects(unlock({ senderFrame: wrongOriginFrame, sender: { mainFrame: wrongOriginFrame } }));
  await assert.rejects(save(createTrustedEvent(), ''));
  await assert.rejects(save(createTrustedEvent(), 'x'.repeat(1_025)));
  await assert.rejects(save(createTrustedEvent(), 'test-key', 'invalid-model'));
  await assert.rejects(check(createTrustedEvent(), 'unexpected'));
  await assert.rejects(unlock(createTrustedEvent(), 'unexpected'));
  await assert.rejects(lock(createTrustedEvent(), 'unexpected'));
});

test('does not expose unlocked Gemini keys through health, API errors, or logs', async () => {
  const apiKey = 'test-only-unlocked-gemini-key';
  const { store } = await createTemporaryKeyStore();
  await store.save(apiKey);
  const handlers = createIpcHandlers(store, setRuntimeGeminiApiKey);
  const savedKey = await handlers.get('jarvis:gemini-key-unlock')(createTrustedEvent());
  assert.deepEqual(savedKey, { unlocked: true, persistentStorageAvailable: true });
  assert.equal(JSON.stringify(savedKey).includes(apiKey), false);

  const healthResponse = await originalFetch(`${baseUrl}/api/health`);
  assert.doesNotMatch(await healthResponse.text(), new RegExp(apiKey));

  const originalConsoleError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  globalThis.fetch = async (input) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) {
      return new Response(JSON.stringify({
        error: {
          status: 'INVALID_ARGUMENT',
          message: `Rejected key ${apiKey}`,
        },
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    if (String(input).startsWith(baseUrl)) return originalFetch(input);
    throw new Error(`Unexpected outbound request in local key test: ${String(input)}`);
  };
  try {
    const response = await postJson('/api/chat', {
      messages: [{ role: 'user', content: 'hello' }],
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.match(result.error, /Rejected key \[redacted\]/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
    assert.doesNotMatch(logs.join(' '), new RegExp(apiKey));
  } finally {
    console.error = originalConsoleError;
    lockRuntimeGeminiApiKey();
  }
});
