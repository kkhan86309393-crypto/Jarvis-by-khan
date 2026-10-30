import {
  containsSensitiveText,
  redactSensitiveText,
  validateWorkspaceRelativePath,
} from './lab-safety.js';

export const LAB_EXTENSIONS_KEY = 'jarvis.lab.extensions.v1';
export const EXTENSION_PACKAGE_MAX_BYTES = 512 * 1024;
export const EXTENSION_HISTORY_LIMIT = 100;
export const EXTENSION_FILE_LIMIT = 100;

const PACKAGE_EXTENSIONS = ['.jarvis-extension.json', '.jext'];
const EXTENSION_STATES = new Set(['pending-review', 'installed', 'disabled']);
const PROTECTED_PERMISSION = /(?:api.?key|secret|credential|password|token)/i;
const PERMISSION_PATTERN = /^[a-z][a-z0-9._:-]{0,63}$/;
const MANIFEST_KEYS = ['name', 'version', 'description', 'permissions'];
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

function isValidTimestamp(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_DATE_TIMESTAMP;
}

function utf8Size(value) {
  return new TextEncoder().encode(value).byteLength;
}

function isPackageFileName(fileName) {
  const name = String(fileName).toLowerCase();
  return PACKAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, reason: 'Package manifest must be an object.' };
  }
  if (Object.keys(manifest).length !== MANIFEST_KEYS.length
    || MANIFEST_KEYS.some((key) => !Object.hasOwn(manifest, key))) {
    return { valid: false, reason: 'Manifest must contain only name, version, description, and permissions.' };
  }
  const name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  const description = typeof manifest.description === 'string' ? manifest.description.trim() : '';
  if (!name || name.length > 80) return { valid: false, reason: 'Extension name must contain 1–80 characters.' };
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    return { valid: false, reason: 'Extension version must use semantic version format, such as 1.0.0.' };
  }
  if (description.length > 500) return { valid: false, reason: 'Extension description cannot exceed 500 characters.' };
  if (!Array.isArray(manifest.permissions) || manifest.permissions.length > 30) {
    return { valid: false, reason: 'Manifest permissions must be a list of at most 30 items.' };
  }
  const permissions = [];
  for (const permission of manifest.permissions) {
    if (typeof permission !== 'string' || !PERMISSION_PATTERN.test(permission)) {
      return { valid: false, reason: 'Manifest contains a malformed permission identifier.' };
    }
    if (PROTECTED_PERMISSION.test(permission)) {
      return { valid: false, reason: 'Extensions cannot request access to API keys, credentials, passwords, secrets, or tokens.' };
    }
    if (permissions.includes(permission)) {
      return { valid: false, reason: 'Manifest permissions cannot contain duplicates.' };
    }
    permissions.push(permission);
  }
  return {
    valid: true,
    manifest: { name, version, description, permissions },
  };
}

function validatePackageFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    return { valid: false, reason: 'Package files must be an object of relative paths and text contents.' };
  }
  const entries = Object.entries(files);
  if (!entries.length || entries.length > EXTENSION_FILE_LIMIT) {
    return { valid: false, reason: `Package must contain 1–${EXTENSION_FILE_LIMIT} files.` };
  }
  const safeFiles = Object.create(null);
  let contentsBytes = 0;
  for (const [path, contents] of entries) {
    const pathStatus = validateWorkspaceRelativePath(path);
    if (!pathStatus.valid || path.length > 240
      || path.split('/').some((segment) => ['__proto__', 'prototype', 'constructor'].includes(segment.toLowerCase()))) {
      return { valid: false, reason: 'Unsafe or sensitive package path rejected.' };
    }
    if (typeof contents !== 'string') {
      return { valid: false, reason: `Package file "${path.slice(0, 100)}" must contain text only.` };
    }
    contentsBytes += utf8Size(contents);
    if (contentsBytes > EXTENSION_PACKAGE_MAX_BYTES) {
      return { valid: false, reason: 'Package contents exceed the 512 KB limit.' };
    }
    safeFiles[path] = contents;
  }
  return { valid: true, files: safeFiles };
}

export function validateExtensionPackageText(text, fileName) {
  if (!isPackageFileName(fileName)) {
    return { valid: false, reason: 'Choose a .jarvis-extension.json or .jext package file.' };
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, reason: 'Extension package is empty or is not text.' };
  }
  if (utf8Size(text) > EXTENSION_PACKAGE_MAX_BYTES) {
    return { valid: false, reason: 'Extension package exceeds the 512 KB limit.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, reason: 'Extension package is not valid JSON.' };
  }
  if (containsSensitiveText(parsed)) {
    return { valid: false, reason: 'Package contains a credential-like value. Remove secrets before importing.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).length !== 2
    || !Object.hasOwn(parsed, 'manifest')
    || !Object.hasOwn(parsed, 'files')) {
    return { valid: false, reason: 'Package must contain exactly a manifest and files object.' };
  }
  const manifestResult = validateManifest(parsed.manifest);
  if (!manifestResult.valid) return manifestResult;
  const filesResult = validatePackageFiles(parsed.files);
  if (!filesResult.valid) return filesResult;
  return {
    valid: true,
    manifest: manifestResult.manifest,
    files: filesResult.files,
  };
}

function emptyStore() {
  return { extensions: [], history: [] };
}

function normalizeStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.extensions) || !Array.isArray(value.history)) {
    throw new TypeError('Saved extension data has an invalid structure.');
  }
  const extensions = [];
  for (const entry of value.extensions) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string'
      || !entry.id || entry.id.length > 128
      || !EXTENSION_STATES.has(entry.state) || !isValidTimestamp(entry.importedAt)) {
      throw new TypeError('Saved extension data contains an invalid package record.');
    }
    const manifestResult = validateManifest(entry.manifest);
    const filesResult = validatePackageFiles(entry.files);
    if (!manifestResult.valid || !filesResult.valid) {
      throw new TypeError('Saved extension data contains an invalid package manifest or file.');
    }
    if (extensions.some(({ id }) => id === entry.id)) {
      throw new TypeError('Saved extension data contains duplicate package IDs.');
    }
    extensions.push({
      id: entry.id,
      manifest: manifestResult.manifest,
      files: filesResult.files,
      state: entry.state,
      importedAt: entry.importedAt,
    });
  }
  const validActions = ['pending-review', 'approved', 'enabled', 'disabled', 'removed', 'exported', 'rejected'];
  if (value.history.some((entry) => (
    !entry
    || !isValidTimestamp(entry.timestamp)
    || typeof entry.extensionId !== 'string'
    || typeof entry.extensionName !== 'string'
    || !validActions.includes(entry.action)
  ))) {
    throw new TypeError('Saved extension history is malformed.');
  }
  const history = value.history
    .slice(-EXTENSION_HISTORY_LIMIT)
    .map(({ timestamp, extensionId, extensionName, action }) => ({
      timestamp,
      extensionId,
      extensionName: redactSensitiveText(extensionName).slice(0, 80),
      action,
    }));
  return { extensions, history };
}

export function loadLabExtensions(storage) {
  const stored = storage.getItem(LAB_EXTENSIONS_KEY);
  if (stored === null) return emptyStore();
  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    throw new Error('Saved extension data is not valid JSON and was not changed.', { cause: error });
  }
  return normalizeStore(parsed);
}

function saveStore(storage, store) {
  storage.setItem(LAB_EXTENSIONS_KEY, JSON.stringify(store));
}

function appendHistory(store, extension, action, timestamp) {
  store.history.push({
    timestamp: isValidTimestamp(timestamp) ? timestamp : Date.now(),
    extensionId: extension.id,
    extensionName: redactSensitiveText(extension.manifest.name),
    action,
  });
  store.history = store.history.slice(-EXTENSION_HISTORY_LIMIT);
}

export function addPendingExtension(storage, packageData, { id, timestamp = Date.now() } = {}) {
  if (!packageData?.valid || typeof id !== 'string' || !id) {
    throw new TypeError('A validated extension package and unique ID are required.');
  }
  const manifestResult = validateManifest(packageData.manifest);
  const filesResult = validatePackageFiles(packageData.files);
  if (!manifestResult.valid || !filesResult.valid) {
    throw new TypeError('Extension package did not pass validation.');
  }
  const store = loadLabExtensions(storage);
  if (store.extensions.some(({ id: existingId }) => existingId === id)) {
    throw new Error('Extension ID already exists.');
  }
  if (store.extensions.some(({ manifest }) => (
    manifest.name.toLocaleLowerCase() === manifestResult.manifest.name.toLocaleLowerCase()
      && manifest.version === manifestResult.manifest.version
  ))) {
    throw new Error('This extension name and version are already imported.');
  }
  const extension = {
    id,
    manifest: manifestResult.manifest,
    files: filesResult.files,
    state: 'pending-review',
    importedAt: isValidTimestamp(timestamp) ? timestamp : Date.now(),
  };
  store.extensions.push(extension);
  appendHistory(store, extension, 'pending-review', timestamp);
  saveStore(storage, store);
  return extension;
}

export function setLabExtensionState(storage, id, state, timestamp = Date.now()) {
  if (!['installed', 'disabled'].includes(state)) {
    throw new TypeError('Extensions can only be approved to installed or disabled states.');
  }
  const store = loadLabExtensions(storage);
  const extension = store.extensions.find((item) => item.id === id);
  if (!extension) throw new Error('Extension was not found.');
  if (extension.state === 'pending-review' && state !== 'disabled') {
    throw new Error('Review and install the extension before enabling it.');
  }
  if (extension.state === state) return extension;
  const previousState = extension.state;
  extension.state = state;
  const action = previousState === 'pending-review'
    ? 'approved'
    : state === 'installed' ? 'enabled' : 'disabled';
  appendHistory(store, extension, action, timestamp);
  saveStore(storage, store);
  return extension;
}

export function removeLabExtension(storage, id, timestamp = Date.now()) {
  const store = loadLabExtensions(storage);
  const index = store.extensions.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('Extension was not found.');
  const [extension] = store.extensions.splice(index, 1);
  appendHistory(store, extension, 'removed', timestamp);
  saveStore(storage, store);
  return extension;
}

export function recordLabExtensionExport(storage, extension, timestamp = Date.now()) {
  if (!extension || typeof extension.id !== 'string') {
    throw new TypeError('A stored extension is required for export history.');
  }
  const store = loadLabExtensions(storage);
  const saved = store.extensions.find(({ id }) => id === extension.id);
  if (!saved) throw new Error('Extension was not found.');
  appendHistory(store, saved, 'exported', timestamp);
  saveStore(storage, store);
}

export function recordLabExtensionRejection(storage, extension, timestamp = Date.now()) {
  if (!extension || typeof extension.id !== 'string') {
    throw new TypeError('A pending extension is required for rejection history.');
  }
  const store = loadLabExtensions(storage);
  const index = store.extensions.findIndex(({ id, state }) => id === extension.id && state === 'pending-review');
  if (index < 0) throw new Error('Pending extension was not found.');
  const [rejected] = store.extensions.splice(index, 1);
  appendHistory(store, rejected, 'rejected', timestamp);
  saveStore(storage, store);
}

export function serializeLabExtensionPackage(extension) {
  const manifestResult = validateManifest(extension?.manifest);
  const filesResult = validatePackageFiles(extension?.files);
  if (!manifestResult.valid || !filesResult.valid) {
    throw new TypeError('Extension package is not valid for export.');
  }
  return JSON.stringify({
    manifest: {
      ...manifestResult.manifest,
      name: redactSensitiveText(manifestResult.manifest.name),
      description: redactSensitiveText(manifestResult.manifest.description),
      permissions: manifestResult.manifest.permissions.map(redactSensitiveText),
    },
    files: Object.fromEntries(Object.entries(filesResult.files).map(([path, contents]) => [
      path,
      redactSensitiveText(contents),
    ])),
  }, null, 2);
}

export function getExtensionPackageFileStatus(file) {
  if (!file || typeof file.name !== 'string' || typeof file.text !== 'function') {
    return { valid: false, reason: 'Choose an extension package file.' };
  }
  if (!isPackageFileName(file.name)) {
    return { valid: false, reason: 'Choose a .jarvis-extension.json or .jext package file.' };
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > EXTENSION_PACKAGE_MAX_BYTES) {
    return { valid: false, reason: 'Extension package exceeds the 512 KB limit.' };
  }
  return { valid: true };
}
