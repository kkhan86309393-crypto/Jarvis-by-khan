import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPublicShareUrl } from '../public/share-link.js';

test('creates a clean root link from a public HTTPS address', () => {
  assert.equal(
    getPublicShareUrl({ href: 'https://jarvis-123.app.github.dev/chat?token=private#settings' }),
    'https://jarvis-123.app.github.dev/',
  );
});

test('does not make links for localhost, private networks, or insecure origins', () => {
  for (const href of [
    'http://localhost:4173/',
    'https://jarvis.localhost/',
    'https://127.0.0.1:4173/',
    'https://192.168.1.20/',
    'https://10.2.3.4/',
    'https://[::1]/',
    'https://[fd00::1]/',
    'https://printer.local/',
    'http://jarvis.example.com/',
  ]) {
    assert.equal(getPublicShareUrl({ href }), null, href);
  }
});

test('returns no link for an invalid address', () => {
  assert.equal(getPublicShareUrl({ href: 'not a URL' }), null);
});
