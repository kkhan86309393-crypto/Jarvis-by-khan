import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllowedExternalUrl } from '../desktop/external-links.js';
import {
  getApprovedClipboardText,
  getApprovedDesktopExternalUrl,
  isTrustedDesktopIpcEvent,
} from '../desktop/ipc-validation.js';

test('allows secure websites and validated dialer/message handoffs only', () => {
  assert.equal(getAllowedExternalUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(getAllowedExternalUrl('tel:+15551234567'), 'tel:+15551234567');
  assert.equal(getAllowedExternalUrl('sms:+15551234567?body=Hello'), 'sms:+15551234567?body=Hello');

  for (const value of [
    'http://example.com',
    'https://user:password@example.com',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'intent://open/#Intent;scheme=example;package=com.example.app;end',
    'tel:123?call=true',
    'sms:123?to=456',
  ]) {
    assert.equal(getAllowedExternalUrl(value), null, value);
  }
});

function makeTrustedEvent(url = 'http://127.0.0.1:4173/') {
  const frame = { url };
  return { senderFrame: frame, sender: { mainFrame: frame } };
}

test('IPC accepts only the trusted desktop main frame and approved destinations', () => {
  const origin = 'http://127.0.0.1:4173';
  const event = makeTrustedEvent();
  assert.equal(isTrustedDesktopIpcEvent(event, origin), true);
  assert.equal(getApprovedDesktopExternalUrl(event, origin, 'https://example.com'), 'https://example.com/');
  assert.equal(getApprovedDesktopExternalUrl(event, origin, 'tel:+15551234567'), 'tel:+15551234567');
  assert.equal(getApprovedDesktopExternalUrl(event, origin, 'sms:+15551234567?body=Hi'), 'sms:+15551234567?body=Hi');

  assert.equal(getApprovedDesktopExternalUrl(event, origin, 'http://example.com'), null);
  assert.equal(getApprovedDesktopExternalUrl(event, origin, 'javascript:alert(1)'), null);
  assert.equal(getApprovedDesktopExternalUrl(makeTrustedEvent('https://evil.example/'), origin, 'https://example.com'), null);

  const subframe = { url: 'http://127.0.0.1:4173/frame' };
  assert.equal(isTrustedDesktopIpcEvent({ senderFrame: subframe, sender: { mainFrame: {} } }, origin), false);
  assert.equal(isTrustedDesktopIpcEvent({ sender: { mainFrame: event.sender.mainFrame } }, origin), false);
});

test('IPC allows bounded user text and rejects invalid clipboard payloads', () => {
  const event = makeTrustedEvent();
  assert.equal(getApprovedClipboardText(event, 'http://127.0.0.1:4173', 'User text\nनमस्ते'), 'User text\nनमस्ते');
  assert.equal(getApprovedClipboardText(event, 'http://127.0.0.1:4173', 'x'.repeat(20_001)), null);
  assert.equal(getApprovedClipboardText(event, 'http://127.0.0.1:4173', 'bad\u0000text'), null);
  assert.equal(getApprovedClipboardText(event, 'http://127.0.0.1:4173', '   '), null);
  assert.equal(getApprovedClipboardText(event, 'http://other.example', 'text'), null);
  assert.equal(getApprovedClipboardText(event, 'http://127.0.0.1:4173', 123), null);
});