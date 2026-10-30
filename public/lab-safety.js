export const LAB_PROJECT_CHANGES_ENABLED = false;
export const LAB_SAFETY_STORAGE_NAME = 'separate-backup-store';

const SECRET_ASSIGNMENT = /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|credential|private[_-]?key)["']?\s*[:=]\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`|([^\r\n]*))/gi;
const BEARER_CREDENTIAL = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const BASIC_CREDENTIAL = /\b(Basic\s+)[A-Za-z0-9+/]+=*/gi;
const PRIVATE_KEY_BLOCK = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;
const KNOWN_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}|AIza[A-Za-z0-9_-]{30,})\b/g;
const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\..*)?|[^/]*(?:secret|credential|token|password|private[-_]?key)[^/]*|[^/]+\.(?:pem|p12|pfx|key))$/i;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export function redactSensitiveText(value) {
  return String(value)
    .replace(PRIVATE_KEY_BLOCK, '-----BEGIN [REDACTED PRIVATE KEY]-----')
    .replace(BEARER_CREDENTIAL, '$1[REDACTED]')
    .replace(BASIC_CREDENTIAL, '$1[REDACTED]')
    .replace(SECRET_ASSIGNMENT, (_match, prefix, doubleQuoted, singleQuoted, templateQuoted) => (
      doubleQuoted !== undefined ? `${prefix}"[REDACTED]"`
        : singleQuoted !== undefined ? `${prefix}'[REDACTED]'`
          : templateQuoted !== undefined ? `${prefix}\`[REDACTED]\``
            : `${prefix}[REDACTED]`
    ))
    .replace(KNOWN_TOKEN, '[REDACTED TOKEN]');
}

export function containsSensitiveText(value) {
  if (typeof value === 'string') return redactSensitiveText(value) !== value;
  if (Array.isArray(value)) return value.some(containsSensitiveText);
  if (value && typeof value === 'object') return Object.values(value).some(containsSensitiveText);
  return false;
}

export function validateWorkspaceRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240
    || value.startsWith('/') || value.startsWith('\\')
    || value.includes('\\') || value.includes('%') || /[:\u0000-\u001f]/.test(value)) {
    return { valid: false, reason: 'Only canonical relative paths inside the project workspace are allowed.' };
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || ['__proto__', 'prototype', 'constructor'].includes(segment.toLowerCase()))) {
    return { valid: false, reason: 'Path traversal and special path segments are not allowed.' };
  }
  if (segments.some((segment) => SENSITIVE_PATH.test(segment)
    || segment === '.git' || segment === 'node_modules')) {
    return { valid: false, reason: 'Sensitive and protected project paths cannot be changed.' };
  }
  return { valid: true, path: segments.join('/') };
}

function validateChangeList(changes) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 100) {
    throw new TypeError('A change proposal must list between 1 and 100 affected files.');
  }
  const seenPaths = new Set();
  return changes.map((change) => {
    const path = validateWorkspaceRelativePath(change?.path);
    if (!path.valid) throw new TypeError(path.reason);
    if (seenPaths.has(path.path)) throw new TypeError('A change proposal cannot list a file more than once.');
    if (typeof change.before !== 'string' || typeof change.after !== 'string') {
      throw new TypeError('Each file change must include text before and after the proposed change.');
    }
    seenPaths.add(path.path);
    return {
      path: path.path,
      before: redactSensitiveText(change.before),
      after: redactSensitiveText(change.after),
    };
  });
}

function validateChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0 || checks.length > 100) {
    throw new TypeError('A proposal requires at least one validation check.');
  }
  return checks.map((check) => {
    if (!check || typeof check.name !== 'string' || !check.name.trim() || typeof check.passed !== 'boolean') {
      throw new TypeError('Validation checks require a name and a pass/fail result.');
    }
    return { name: redactSensitiveText(check.name).slice(0, 120), passed: check.passed };
  });
}

export function createChangeReview(changes, checks) {
  const files = validateChangeList(changes);
  const validations = validateChecks(checks);
  return {
    affectedFiles: files.map(({ path }) => path),
    diffs: files,
    validationChecks: validations,
    validationsPassed: validations.every(({ passed }) => passed),
    approvalRequired: true,
    projectChangesEnabled: LAB_PROJECT_CHANGES_ENABLED,
    approvalAvailable: LAB_PROJECT_CHANGES_ENABLED && validations.every(({ passed }) => passed),
  };
}

export function requestProjectChangeApproval(review, { confirmed = false, backup = null } = {}) {
  if (!review || !Array.isArray(review.affectedFiles) || !Array.isArray(review.diffs)) {
    throw new TypeError('A reviewed change proposal is required.');
  }
  if (!confirmed) throw new Error('Explicit confirmation is required for every project change.');
  if (!review.validationsPassed) throw new Error('All validation checks must pass before approval.');
  if (!backup || backup.created !== true || backup.storage !== LAB_SAFETY_STORAGE_NAME || !Array.isArray(backup.files)
    || review.affectedFiles.some((path) => !backup.files.includes(path))) {
    throw new Error('Create a separate backup of every affected file before approval.');
  }
  if (!LAB_PROJECT_CHANGES_ENABLED) {
    return {
      approved: false,
      reason: 'Project changes are not enabled. The reviewed diff remains uncommitted and unchanged.',
    };
  }
  return { approved: true, reason: 'Approved.' };
}

export function createBackupDescriptor(paths, { timestamp = Date.now(), existingIds = [] } = {}) {
  if (!Array.isArray(paths)) throw new TypeError('Backup paths must be listed explicitly.');
  if (!Array.isArray(existingIds) || existingIds.some((id) => typeof id !== 'string')) {
    throw new TypeError('Existing backup IDs must be a list of strings.');
  }
  if (!Number.isSafeInteger(timestamp) || Math.abs(timestamp) > MAX_TIMESTAMP) {
    throw new TypeError('A valid backup timestamp is required.');
  }
  const files = validateChangeList(paths.map((path) => ({ path, before: '', after: '' })))
    .map(({ path }) => path);
  const stamp = new Date(timestamp).toISOString().replaceAll(/[-:.]/g, '');
  const baseId = `jarvis-backup-${stamp}`;
  let id = baseId;
  for (let suffix = 2; existingIds.includes(id); suffix += 1) id = `${baseId}-${suffix}`;
  return {
    id,
    timestamp,
    files,
    storage: LAB_SAFETY_STORAGE_NAME,
    created: false,
    approved: false,
    reason: 'Project file access is disabled; no backup data was read or written.',
  };
}

export function requestRollback(backup, { confirmed = false, currentStateBackup = null } = {}) {
  if (!confirmed) throw new Error('Explicit confirmation is required before rollback.');
  if (!currentStateBackup || currentStateBackup.created !== true
    || currentStateBackup.storage !== LAB_SAFETY_STORAGE_NAME
    || typeof currentStateBackup.id !== 'string' || currentStateBackup.id === backup?.id) {
    throw new Error('Preserve the current state in a separate backup before rollback.');
  }
  if (!backup || backup.created !== true || backup.approved !== true
    || backup.storage !== LAB_SAFETY_STORAGE_NAME || typeof backup.id !== 'string') {
    throw new Error('No approved backup is available to restore.');
  }
  if (!LAB_PROJECT_CHANGES_ENABLED) {
    return {
      restored: false,
      reason: 'Rollback is unavailable because project file access is disabled.',
    };
  }
  return { restored: true, reason: 'Rollback requested.' };
}
