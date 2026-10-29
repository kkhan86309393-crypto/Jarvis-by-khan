import { getAllowedExternalUrl } from './external-links.js';

const MAX_CLIPBOARD_TEXT_LENGTH = 20_000;

export function isTrustedDesktopIpcEvent(event, expectedOrigin) {
  const frame = event?.senderFrame;
  if (!frame || frame !== event.sender?.mainFrame) return false;
  try {
    return new URL(frame.url).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function getApprovedDesktopExternalUrl(event, expectedOrigin, value) {
  if (!isTrustedDesktopIpcEvent(event, expectedOrigin)) return null;
  return getAllowedExternalUrl(value);
}

export function getApprovedClipboardText(event, expectedOrigin, value) {
  if (!isTrustedDesktopIpcEvent(event, expectedOrigin)
    || typeof value !== 'string'
    || !value.trim()
    || value.length > MAX_CLIPBOARD_TEXT_LENGTH
    || value.includes('\u0000')) {
    return null;
  }
  return value;
}