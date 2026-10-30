import { redactSensitiveText } from './lab-safety.js';

export const LAB_AI_MODIFY_HISTORY_KEY = 'jarvis.lab.ai-modify-history.v1';
export const LAB_AI_MODIFY_HISTORY_LIMIT = 20;

const HISTORY_MESSAGES = Object.freeze({
  unavailable: 'Plan not generated · AI Modify integration unavailable',
  cancelled: 'Request canceled · no plan generated',
  rejected: 'Request rejected · no plan generated',
});

export function loadLabAiModifyHistory(storage) {
  try {
    const saved = JSON.parse(storage.getItem(LAB_AI_MODIFY_HISTORY_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((entry) => (
        entry
        && Number.isFinite(entry.timestamp)
        && Number.isFinite(new Date(entry.timestamp).getTime())
        && Object.hasOwn(HISTORY_MESSAGES, entry.status)
      ))
      .slice(-LAB_AI_MODIFY_HISTORY_LIMIT)
      .map(({ timestamp, status }) => ({
        timestamp,
        status,
        message: redactSensitiveText(HISTORY_MESSAGES[status]),
      }));
  } catch {
    return [];
  }
}

export function recordLabAiModifyHistory(storage, status, timestamp = Date.now()) {
  if (!Object.hasOwn(HISTORY_MESSAGES, status)) {
    throw new TypeError('Unknown AI Modify history status.');
  }
  const history = loadLabAiModifyHistory(storage);
  const entry = {
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    status,
    message: redactSensitiveText(HISTORY_MESSAGES[status]),
  };
  const updated = [...history, entry].slice(-LAB_AI_MODIFY_HISTORY_LIMIT);
  storage.setItem(LAB_AI_MODIFY_HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

export function getLabAiModifyRequestStatus(request) {
  return typeof request === 'string' && request.trim()
    ? 'unavailable'
    : 'empty';
}
