import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  getApprovedGeminiApiKey,
  getApprovedGeminiModel,
  isTrustedDesktopIpcEvent,
} from './ipc-validation.js';

const MAX_ENCRYPTED_KEY_BYTES = 8_192;
const STORAGE_UNAVAILABLE_MESSAGE = 'OS-backed encryption is unavailable. The Gemini key can only be used for the current session.';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

export function getGeminiKeyStorageAvailability(safeStorage) {
  if (typeof safeStorage?.isEncryptionAvailable !== 'function'
    || typeof safeStorage?.encryptString !== 'function'
    || typeof safeStorage?.decryptString !== 'function') {
    return { available: false, message: STORAGE_UNAVAILABLE_MESSAGE };
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { available: false, message: STORAGE_UNAVAILABLE_MESSAGE };
    }
    const backend = safeStorage.getSelectedStorageBackend?.();
    if (typeof backend !== 'string' || !backend.trim() || ['basic_text', 'unknown'].includes(backend.toLowerCase())) {
      return { available: false, message: STORAGE_UNAVAILABLE_MESSAGE };
    }
    return { available: true, backend };
  } catch {
    return { available: false, message: STORAGE_UNAVAILABLE_MESSAGE };
  }
}

function getValidatedKey(key) {
  if (typeof key !== 'string' || !key.trim() || key.length > 1_024 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw Object.assign(new Error('Enter a valid Gemini API key.'), { code: 'INVALID_GEMINI_KEY' });
  }
  return key.trim();
}

function getValidatedModel(model) {
  const selectedModel = model ?? process.env.AI_MODEL ?? DEFAULT_GEMINI_MODEL;
  if (typeof selectedModel !== 'string'
    || !/^gemini-[A-Za-z0-9][A-Za-z0-9._-]{0,112}$/.test(selectedModel)) {
    throw Object.assign(new Error('Enter a valid Gemini model name beginning with gemini-.'), {
      code: 'INVALID_GEMINI_MODEL',
    });
  }
  return selectedModel;
}

export function createGeminiKeyStore({ safeStorage, filePath }) {
  if (!safeStorage || typeof filePath !== 'string' || !filePath) {
    throw new TypeError('Gemini key storage requires safeStorage and a file path.');
  }

  async function hasSavedKey() {
    try {
      const fileStat = await stat(filePath);
      return fileStat.isFile() && fileStat.size > 0 && fileStat.size <= MAX_ENCRYPTED_KEY_BYTES;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw new Error('Could not check secure Gemini key storage.');
    }
  }

  async function save(key, model) {
    const validatedKey = getValidatedKey(key);
    const validatedModel = getValidatedModel(model);
    const availability = getGeminiKeyStorageAvailability(safeStorage);
    if (!availability.available) {
      throw Object.assign(new Error(STORAGE_UNAVAILABLE_MESSAGE), { code: 'SAFE_STORAGE_UNAVAILABLE' });
    }

    const encrypted = safeStorage.encryptString(JSON.stringify({
      version: 1,
      key: validatedKey,
      model: validatedModel,
    }));
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > MAX_ENCRYPTED_KEY_BYTES) {
      throw Object.assign(new Error('The operating system did not produce valid encrypted Gemini key data.'), {
        code: 'SAFE_STORAGE_ENCRYPTION_FAILED',
      });
    }

    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    let temporaryFileExists = false;
    try {
      await writeFile(temporaryPath, encrypted, { flag: 'wx', mode: 0o600 });
      temporaryFileExists = true;
      await rename(temporaryPath, filePath);
      temporaryFileExists = false;
    } finally {
      if (temporaryFileExists) await rm(temporaryPath, { force: true });
    }
  }

  async function readSavedConfiguration() {
    let encrypted;
    try {
      encrypted = await readFile(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw new Error('Could not read the encrypted Gemini key.');
    }
    if (!encrypted.length || encrypted.length > MAX_ENCRYPTED_KEY_BYTES) {
      throw new Error('The saved Gemini key data is invalid.');
    }

    let decrypted;
    try {
      decrypted = safeStorage.decryptString(encrypted);
    } catch {
      throw new Error('The saved Gemini key could not be decrypted by this operating system.');
    }
    try {
      const record = JSON.parse(decrypted);
      if (record?.version === 1) {
        return {
          key: getValidatedKey(record.key),
          model: getValidatedModel(record.model),
        };
      }
    } catch (error) {
      if (error?.code === 'INVALID_GEMINI_KEY' || error?.code === 'INVALID_GEMINI_MODEL') throw error;
    }
    return {
      key: getValidatedKey(decrypted),
      model: getValidatedModel(),
    };
  }

  async function status() {
    const availability = getGeminiKeyStorageAvailability(safeStorage);
    const hasKey = await hasSavedKey();
    const savedModel = hasKey && availability.available
      ? (await readSavedConfiguration())?.model
      : undefined;
    return {
      persistentStorageAvailable: availability.available,
      hasSavedKey: hasKey,
      ...(savedModel ? { model: savedModel } : {}),
      ...(!availability.available ? { message: availability.message } : {}),
    };
  }

  async function unlock(useKey) {
    const availability = getGeminiKeyStorageAvailability(safeStorage);
    if (!availability.available) {
      return {
        unlocked: false,
        persistentStorageAvailable: false,
        message: availability.message,
      };
    }
    const configuration = await readSavedConfiguration();
    if (!configuration) {
      return { unlocked: false, persistentStorageAvailable: true, message: 'No saved Gemini key was found.' };
    }
    try {
      await useKey(configuration.key, configuration.model);
    } catch {
      throw new Error('The saved Gemini key could not be activated. Check the Gemini model configuration.');
    }
    return { unlocked: true, persistentStorageAvailable: true };
  }

  return Object.freeze({ save, status, unlock });
}

export function registerGeminiKeyIpcHandlers({
  ipcMain,
  expectedOrigin,
  keyStore,
  setGeminiApiKey,
  lockGeminiApiKey = () => {},
}) {
  if (!ipcMain || !expectedOrigin || !keyStore
    || typeof setGeminiApiKey !== 'function' || typeof lockGeminiApiKey !== 'function') {
    throw new TypeError('Gemini key IPC requires ipcMain, an application origin, key storage, and a runtime configurator.');
  }

  function assertTrustedEvent(event) {
    if (!isTrustedDesktopIpcEvent(event, expectedOrigin)) {
      throw new Error('Gemini key request came from an untrusted application frame.');
    }
  }

  ipcMain.handle('jarvis:gemini-key-save', async (event, ...args) => {
    assertTrustedEvent(event);
    const key = args.length >= 1 && args.length <= 2
      ? getApprovedGeminiApiKey(event, expectedOrigin, args[0])
      : null;
    const model = args.length === 2
      ? getApprovedGeminiModel(event, expectedOrigin, args[1])
      : getValidatedModel();
    if (!key) throw new Error('Enter a valid Gemini API key.');
    if (!model) throw new Error('Enter a valid Gemini model name.');
    try {
      await keyStore.save(key, model);
      lockGeminiApiKey();
      return {
        saved: true,
        configuredForSession: false,
        persistentStorageAvailable: true,
      };
    } catch (error) {
      if (error?.code === 'SAFE_STORAGE_UNAVAILABLE') {
        setGeminiApiKey(key, model);
        return {
          saved: false,
          configuredForSession: true,
          persistentStorageAvailable: false,
          message: STORAGE_UNAVAILABLE_MESSAGE,
        };
      }
      throw new Error('Secure Gemini key storage failed. The key was not activated.');
    }
  });

  ipcMain.handle('jarvis:gemini-key-status', async (event, ...args) => {
    assertTrustedEvent(event);
    if (args.length) throw new Error('Gemini key status does not accept arguments.');
    return keyStore.status();
  });

  ipcMain.handle('jarvis:gemini-key-unlock', async (event, ...args) => {
    assertTrustedEvent(event);
    if (args.length) throw new Error('Gemini key unlock does not accept arguments.');
    return keyStore.unlock(setGeminiApiKey);
  });

  ipcMain.handle('jarvis:gemini-key-lock', async (event, ...args) => {
    assertTrustedEvent(event);
    if (args.length) throw new Error('Gemini key lock does not accept arguments.');
    lockGeminiApiKey();
    return { locked: true };
  });
}
