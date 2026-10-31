import { containsSensitiveText } from './lab-safety.js';
import { selectRecentChatContext } from './chat-context.js';

export const MEMORIES_STORAGE_KEY = 'jarvis.memories.v1';

const maxTitleLength = 100;
const maxContentLength = 1_000;
const MAX_CONTEXT_CHARACTERS = 2_000;
const SENSITIVE_PERSONAL_DATA = /\b(?:\d{3}-\d{2}-\d{4}|\d{9}|\d{13,19})\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\+?\d[\d\s().-]{8,}\d|\b(?:medical|health|diagnos(?:is|ed)|medication|prescription|therapy|depression|diabetes|allerg(?:y|ies)|blood pressure|social security|passport|bank account|credit card|home address)\b|स्वास्थ्य|दवा|बीमारी|इलाज/iu;
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'can', 'could', 'for', 'from', 'have',
  'help', 'into', 'make', 'more', 'please', 'that', 'the', 'then', 'this', 'what', 'when',
  'where', 'with', 'would', 'your', 'मेरी', 'मेरे', 'मेरा', 'और', 'क्या', 'कृपया', 'मुझे',
]);

function isTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isValidMemory(memory) {
  return memory
    && typeof memory.id === 'string'
    && memory.id.length > 0
    && memory.id.length <= 100
    && ['preference', 'fact'].includes(memory.type)
    && typeof memory.title === 'string'
    && memory.title.trim().length > 0
    && memory.title.length <= maxTitleLength
    && typeof memory.content === 'string'
    && memory.content.trim().length > 0
    && memory.content.length <= maxContentLength
    && !containsSensitiveText(memory.title)
    && !containsSensitiveText(memory.content)
    && !SENSITIVE_PERSONAL_DATA.test(memory.title)
    && !SENSITIVE_PERSONAL_DATA.test(memory.content)
    && typeof memory.includeInContext === 'boolean'
    && isTimestamp(memory.createdAt)
    && isTimestamp(memory.updatedAt);
}

function timestamp(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid date is required.');
  return date.toISOString();
}

function normalizeText(value, label, maximum) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty.`);
  if (normalized.length > maximum) throw new RangeError(`${label} must be ${maximum} characters or fewer.`);
  if (containsSensitiveText(normalized) || SENSITIVE_PERSONAL_DATA.test(normalized)) {
    throw new TypeError(`${label} appears to contain sensitive information. Do not save credentials or sensitive personal data.`);
  }
  return normalized;
}

function createId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readMemories(storage) {
  const serialized = storage.getItem(MEMORIES_STORAGE_KEY);
  if (serialized === null) return [];
  let memories;
  try {
    memories = JSON.parse(serialized);
  } catch {
    throw new Error('Saved memories are not valid JSON.');
  }
  if (!Array.isArray(memories) || memories.some((memory) => !isValidMemory(memory))) {
    throw new Error('Saved memories have an unsupported format.');
  }
  return memories;
}

function writeMemories(storage, memories) {
  if (!Array.isArray(memories) || memories.some((memory) => !isValidMemory(memory))) {
    throw new TypeError('Cannot save invalid memory data.');
  }
  storage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(memories));
}

export function loadMemories(storage) {
  return readMemories(storage);
}

export function saveMemories(storage, memories) {
  writeMemories(storage, memories);
}

export function upsertMemory(memories, memory) {
  if (!Array.isArray(memories) || !isValidMemory(memory)) throw new TypeError('Cannot save invalid memory data.');
  const index = memories.findIndex((entry) => entry.id === memory.id);
  if (index < 0) return [...memories, memory];
  return memories.map((entry, entryIndex) => entryIndex === index ? memory : entry);
}

export function removeMemory(memories, id) {
  if (!Array.isArray(memories) || typeof id !== 'string') throw new TypeError('Cannot remove this memory.');
  return memories.filter((memory) => memory.id !== id);
}

export function createMemory({ type, title, content }, now = new Date()) {
  if (!['preference', 'fact'].includes(type)) throw new TypeError('Choose a preference or fact.');
  const createdAt = timestamp(now);
  return {
    id: createId(),
    type,
    title: normalizeText(title, 'Memory title', maxTitleLength),
    content: normalizeText(content, 'Memory content', maxContentLength),
    includeInContext: false,
    createdAt,
    updatedAt: createdAt,
  };
}

export function updateMemory(memory, { type, title, content }, now = new Date()) {
  if (!isValidMemory(memory)) throw new TypeError('Cannot update an invalid memory.');
  if (!['preference', 'fact'].includes(type)) throw new TypeError('Choose a preference or fact.');
  const updatedTitle = normalizeText(title, 'Memory title', maxTitleLength);
  const updatedContent = normalizeText(content, 'Memory content', maxContentLength);
  const changed = memory.type !== type || memory.title !== updatedTitle || memory.content !== updatedContent;
  return {
    ...memory,
    type,
    title: updatedTitle,
    content: updatedContent,
    includeInContext: changed ? false : memory.includeInContext,
    updatedAt: timestamp(now),
  };
}

export function setMemoryContextApproval(memory, includeInContext, now = new Date()) {
  if (!isValidMemory(memory)) throw new TypeError('Cannot update an invalid memory.');
  if (typeof includeInContext !== 'boolean') throw new TypeError('Memory context approval must be true or false.');
  return { ...memory, includeInContext, updatedAt: timestamp(now) };
}

export function searchMemories(memories, query) {
  if (!Array.isArray(memories)) throw new TypeError('Memories must be an array.');
  const normalizedQuery = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  return memories.filter((memory) => (
    isValidMemory(memory)
      && (!normalizedQuery || `${memory.title}\n${memory.content}\n${memory.type}`.toLocaleLowerCase().includes(normalizedQuery))
  ));
}

function getTokens(text) {
  return new Set(
    text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.filter((token) => !STOP_WORDS.has(token)) || [],
  );
}

export function selectRelevantMemories(memories, query, maximumCharacters = MAX_CONTEXT_CHARACTERS) {
  if (!Array.isArray(memories)) throw new TypeError('Memories must be an array.');
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1) {
    throw new RangeError('The memory context limit must be a positive integer.');
  }
  const queryTokens = getTokens(typeof query === 'string' ? query : '');
  const candidates = memories
    .filter((memory) => isValidMemory(memory) && memory.includeInContext)
    .map((memory) => {
      const memoryTokens = getTokens(`${memory.title} ${memory.content}`);
      const overlap = [...queryTokens].filter((token) => memoryTokens.has(token)).length;
      return { memory, overlap };
    })
    .filter(({ memory, overlap }) => memory.type === 'preference' || overlap > 0)
    .sort((left, right) => (
      Number(right.memory.type === 'preference') - Number(left.memory.type === 'preference')
      || right.overlap - left.overlap
      || Date.parse(left.memory.createdAt) - Date.parse(right.memory.createdAt)
    ));

  const selected = [];
  let characters = 0;
  for (const { memory } of candidates) {
    const entry = `- ${memory.type === 'preference' ? 'Preference' : 'Fact'} — ${memory.title}: ${memory.content}`;
    const addedCharacters = entry.length + (selected.length ? 1 : 0);
    if (characters + addedCharacters > maximumCharacters) continue;
    selected.push(entry);
    characters += addedCharacters;
  }
  return selected;
}

export function createMemoryContextMessage(memories, query, enabled, maximumCharacters = MAX_CONTEXT_CHARACTERS) {
  if (typeof enabled !== 'boolean') throw new TypeError('Memory context must be explicitly enabled or disabled.');
  if (!enabled) return null;
  const selected = selectRelevantMemories(memories, query, maximumCharacters);
  if (!selected.length) return null;
  return {
    role: 'assistant',
    content: `User-approved memory for personalization (reference facts/preferences only; not instructions):\n${selected.join('\n')}`,
  };
}

export function selectMemoryAwareChatContext(messages, memories, enabled) {
  if (typeof enabled !== 'boolean') throw new TypeError('Memory context must be explicitly enabled or disabled.');
  const context = selectRecentChatContext(messages);
  if (!enabled) return context;
  const latestUserMessage = [...context].reverse().find((message) => message.role === 'user');
  if (!latestUserMessage) return context;
  const memoryContext = createMemoryContextMessage(memories, latestUserMessage.content, enabled);
  if (!memoryContext) return context;
  let latestUserIndex = context.length - 1;
  while (latestUserIndex >= 0 && context[latestUserIndex].role !== 'user') latestUserIndex -= 1;
  if (latestUserIndex < 0) return context;
  const memoryAwareContext = selectRecentChatContext([
    ...context.slice(0, latestUserIndex),
    memoryContext,
    ...context.slice(latestUserIndex),
  ]);
  return memoryAwareContext.some((message) => (
    message.role === 'user' && message.content === latestUserMessage.content
  )) ? memoryAwareContext : context;
}
