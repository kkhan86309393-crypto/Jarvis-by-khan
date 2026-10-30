import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  LAB_PROJECT_CHANGES_ENABLED,
  LAB_SAFETY_STORAGE_NAME,
  containsSensitiveText,
  createBackupDescriptor,
  createChangeReview,
  redactSensitiveText,
  requestProjectChangeApproval,
  requestRollback,
  validateWorkspaceRelativePath,
} from '../public/lab-safety.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

test('redacts credential assignments, bearer values, known tokens and private key blocks', () => {
  const raw = [
    'API_KEY="sk-super-secret-value-123456"',
    'PASSWORD = "a phrase with several secret words"',
    'Authorization: Bearer abc.def.ghi',
    'github_pat_0123456789abcdefghijklmnop',
    '-----BEGIN RSA PRIVATE KEY-----private-material-----END RSA PRIVATE KEY-----',
  ].join('\n');
  const redacted = redactSensitiveText(raw);

  assert.equal(containsSensitiveText(raw), true);
  assert.doesNotMatch(redacted, /sk-super-secret|several secret words|abc\.def\.ghi|github_pat_0123456789|private-material/);
  assert.match(redacted, /API_KEY="\[REDACTED\]"/);
  assert.match(redacted, /Bearer \[REDACTED\]/);
  assert.equal(containsSensitiveText('No credentials are present.'), false);
});

test('accepts only canonical workspace-relative, non-sensitive paths', () => {
  assert.deepEqual(validateWorkspaceRelativePath('public/app.js'), {
    valid: true,
    path: 'public/app.js',
  });
  for (const path of [
    '../outside.js',
    'public/../outside.js',
    '/etc/passwd',
    'C:/project/file.js',
    'public\\file.js',
    'public/%2e%2e/file.js',
    '.env',
    'config/.env.production',
    'secrets/provider.json',
    'keys/signing.pem',
    '.git/config',
    'node_modules/package/index.js',
  ]) {
    assert.equal(validateWorkspaceRelativePath(path).valid, false, path);
  }
});

test('creates redacted review diffs and requires passing checks plus explicit approval', () => {
  const review = createChangeReview([
    {
      path: 'public/app.js',
      before: 'const API_KEY = "old-private-value";',
      after: 'const API_KEY = "new-private-value";',
    },
  ], [{ name: 'node --test test/lab-safety.test.js', passed: true }]);

  assert.deepEqual(review.affectedFiles, ['public/app.js']);
  assert.doesNotMatch(JSON.stringify(review.diffs), /old-private-value|new-private-value/);
  assert.equal(review.approvalRequired, true);
  assert.equal(review.approvalAvailable, false);
  assert.throws(() => requestProjectChangeApproval(review), /Explicit confirmation/);
  assert.throws(
    () => requestProjectChangeApproval(review, { confirmed: true }),
    /separate backup/,
  );
  assert.deepEqual(requestProjectChangeApproval(review, {
    confirmed: true,
    backup: {
      created: true,
      storage: LAB_SAFETY_STORAGE_NAME,
      files: ['public/app.js'],
    },
  }), {
    approved: false,
    reason: 'Project changes are not enabled. The reviewed diff remains uncommitted and unchanged.',
  });

  const failingReview = createChangeReview([
    { path: 'src/module.js', before: 'old', after: 'new' },
  ], [{ name: 'typecheck', passed: false }]);
  assert.throws(
    () => requestProjectChangeApproval(failingReview, { confirmed: true }),
    /All validation checks must pass/,
  );
  assert.throws(() => createChangeReview([
    { path: '../escape.js', before: '', after: '' },
  ], [{ name: 'tests', passed: true }]), /Path traversal/);
  assert.throws(() => createChangeReview([
    { path: 'src/module.js', before: '', after: '' },
  ], []), /at least one validation check/);
});

test('backup descriptors are timestamped, collision-safe, external, and do not copy workspace content', () => {
  const first = createBackupDescriptor(['public/app.js'], { timestamp: 1_798_000_000_000 });
  const second = createBackupDescriptor(['public/app.js'], {
    timestamp: first.timestamp,
    existingIds: [first.id],
  });

  assert.match(first.id, /^jarvis-backup-\d{4}/);
  assert.notEqual(first.id, second.id);
  assert.match(second.id, /-2$/);
  assert.equal(first.storage, LAB_SAFETY_STORAGE_NAME);
  assert.equal(first.created, false);
  assert.deepEqual(first.files, ['public/app.js']);
  assert.equal(Object.hasOwn(first, 'contents'), false);
  assert.match(first.reason, /no backup data was read or written/);
  assert.throws(() => createBackupDescriptor(['../outside.js']), /Path traversal/);
});

test('rollback requires confirmation and preserved current state but remains disabled', () => {
  const futureBackup = {
    id: 'backup-id',
    created: true,
    approved: true,
    storage: LAB_SAFETY_STORAGE_NAME,
  };
  const currentStateBackup = {
    id: 'current-backup-id',
    created: true,
    storage: LAB_SAFETY_STORAGE_NAME,
  };
  assert.throws(() => requestRollback(futureBackup), /Explicit confirmation/);
  assert.throws(
    () => requestRollback(futureBackup, { confirmed: true }),
    /Preserve the current state/,
  );
  assert.deepEqual(requestRollback(futureBackup, {
    confirmed: true,
    currentStateBackup,
  }), {
    restored: false,
    reason: 'Rollback is unavailable because project file access is disabled.',
  });
  assert.throws(() => requestRollback({ id: 'preview-only', created: false, approved: false }, {
    confirmed: true,
    currentStateBackup,
  }), /No approved backup is available/);
  assert.equal(LAB_PROJECT_CHANGES_ENABLED, false);
});

test('LAB displays disabled recovery actions and never adds project-write or execution APIs', () => {
  const panel = html.match(/<section class="lab-safety-panel"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(panel, /No backup created/);
  assert.match(panel, /workspace-relative paths, a visible file list and redacted diff/);
  assert.match(panel, /No changes to validate/);
  assert.match(panel, /Rollback requires confirmation/i);
  assert.match(panel, /credential-like values are redacted/i);
  assert.match(panel, /<button[^>]*disabled>Create backup/);
  assert.match(panel, /<button[^>]*disabled>Approve project changes/);
  assert.match(panel, /<button[^>]*disabled>Restore backup/);
  assert.match(html, /PROJECT LOCKED/);
  assert.doesNotMatch(app, /writeFile|writeFileSync|createWriteStream|eval\(|new Function/);
  assert.doesNotMatch(serviceWorker, /lab-safety\.js.*(?:eval\(|importScripts\()/);
});
