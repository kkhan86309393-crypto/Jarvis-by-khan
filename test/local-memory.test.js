import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createMemory,
  createMemoryContextMessage,
  loadMemories,
  MEMORIES_STORAGE_KEY,
  removeMemory,
  saveMemories,
  searchMemories,
  selectMemoryAwareChatContext,
  selectRelevantMemories,
  setMemoryContextApproval,
  updateMemory,
  upsertMemory,
} from '../public/local-memory.js';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function createStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) {
      assert.equal(key, MEMORIES_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, MEMORIES_STORAGE_KEY);
      value = nextValue;
    },
  };
}

test('creates local memories with dates and requires separate context approval', () => {
  const memory = createMemory(
    { type: 'preference', title: 'Response style', content: 'Keep technical answers concise.' },
    '2026-01-02T03:04:05.000Z',
  );
  assert.equal(memory.type, 'preference');
  assert.equal(memory.includeInContext, false);
  assert.equal(memory.createdAt, '2026-01-02T03:04:05.000Z');
  assert.equal(memory.updatedAt, memory.createdAt);
  assert.equal(createMemoryContextMessage([memory], 'Explain this', true), null);
});

test('Smart Memory defaults off and only restores an explicit saved opt-in', () => {
  assert.match(appSource, /smartMemoryEnabled:\s*false/);
  assert.match(appSource, /smartMemoryEnabled:\s*stored\.smartMemoryEnabled\s*===\s*true/);
});

test('only includes explicitly approved preferences and relevant approved facts when enabled', () => {
  const preference = setMemoryContextApproval(
    createMemory({ type: 'preference', title: 'Tone', content: 'Use concise answers.' }, '2026-01-01T00:00:00Z'),
    true,
    '2026-01-02T00:00:00Z',
  );
  const relevantFact = setMemoryContextApproval(
    createMemory({ type: 'fact', title: 'Project', content: 'The current project uses TypeScript.' }, '2026-01-01T00:00:00Z'),
    true,
  );
  const unrelatedFact = setMemoryContextApproval(
    createMemory({ type: 'fact', title: 'Pet', content: 'My cat is named Ada.' }),
    true,
  );
  const memories = [preference, relevantFact, unrelatedFact];

  assert.equal(createMemoryContextMessage(memories, 'How does TypeScript help?', false), null);
  assert.deepEqual(
    selectRelevantMemories(memories, 'How does TypeScript help?').map((entry) => entry.includes('TypeScript')),
    [false, true],
  );
  assert.match(createMemoryContextMessage(memories, 'How does TypeScript help?', true).content, /Tone/);
  assert.match(createMemoryContextMessage(memories, 'How does TypeScript help?', true).content, /Project/);
  assert.doesNotMatch(createMemoryContextMessage(memories, 'How does TypeScript help?', true).content, /Ada/);
});

test('supports search, update, re-approval, upsert, and deletion', () => {
  const memory = setMemoryContextApproval(
    createMemory({ type: 'fact', title: 'Project name', content: 'JARVIS dashboard' }),
    true,
  );
  const unchanged = updateMemory(memory, {
    type: 'fact',
    title: 'Project name',
    content: 'JARVIS dashboard',
  });
  assert.equal(unchanged.includeInContext, true);

  const updated = updateMemory(memory, {
    type: 'fact',
    title: 'Project name',
    content: 'JARVIS productivity dashboard',
  });
  assert.equal(updated.includeInContext, false);
  assert.equal(searchMemories([updated], 'productivity').length, 1);
  assert.deepEqual(upsertMemory([memory], updated), [updated]);
  assert.deepEqual(removeMemory([updated], updated.id), []);
});

test('revokes context approval when the memory title or type changes', () => {
  const memory = setMemoryContextApproval(
    createMemory({ type: 'fact', title: 'Project', content: 'Uses TypeScript.' }),
    true,
  );
  assert.equal(updateMemory(memory, {
    type: 'fact',
    title: 'Technology',
    content: 'Uses TypeScript.',
  }).includeInContext, false);
  assert.equal(updateMemory(memory, {
    type: 'preference',
    title: 'Project',
    content: 'Uses TypeScript.',
  }).includeInContext, false);
});

test('stores and loads validated memories without exposing malformed storage as an empty success', () => {
  const storage = createStorage();
  const memory = createMemory({ type: 'preference', title: 'Language', content: 'Use English.' });
  saveMemories(storage, [memory]);
  assert.deepEqual(loadMemories(storage), [memory]);
  assert.throws(() => loadMemories(createStorage('{bad json')), /not valid JSON/);
  assert.throws(() => loadMemories(createStorage(JSON.stringify([{ id: 'invalid' }]))), /unsupported format/);
});

test('surfaces local storage read and write failures', () => {
  assert.throws(() => loadMemories({
    getItem() {
      throw new Error('Storage access denied');
    },
  }), /Storage access denied/);
  assert.throws(() => saveMemories({
    setItem() {
      throw new Error('Quota exceeded');
    },
  }, []), /Quota exceeded/);
});

test('rejects credentials and high-risk personal data', () => {
  assert.throws(() => createMemory({
    type: 'fact',
    title: 'Credentials',
    content: 'password=secret-value',
  }), /sensitive information/);
  assert.throws(() => createMemory({
    type: 'fact',
    title: 'Contact',
    content: 'Call 555-123-4567',
  }), /sensitive information/);
  assert.throws(() => createMemory({
    type: 'fact',
    title: 'Health',
    content: 'My prescription is changing.',
  }), /sensitive information/);
});

test('keeps memory context bounded and preserves recent chat ordering and the latest user message', () => {
  const memory = setMemoryContextApproval(
    createMemory({ type: 'preference', title: 'Style', content: 'Be concise.' }),
    true,
  );
  const contextMessage = createMemoryContextMessage([memory], 'Explain caching', true);
  const conversation = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `Older message ${index} ${'x'.repeat(800)}`,
  }));
  conversation.push({ role: 'user', content: 'Explain caching now.' });
  const contextWithoutMemory = selectMemoryAwareChatContext(conversation, [memory], false);
  assert.ok(contextWithoutMemory.every((message) => !message.content.includes('User-approved memory')));
  const context = selectMemoryAwareChatContext(conversation, [memory], true);
  const expectedOrder = [...contextWithoutMemory];
  const latestUserIndex = expectedOrder.map((message) => message.role).lastIndexOf('user');
  expectedOrder.splice(latestUserIndex, 0, contextMessage);

  assert.equal(context.at(-1).content, 'Explain caching now.');
  assert.ok(context.some((message) => message.content === contextMessage.content));
  assert.ok(context.length <= 24);
  assert.ok(Buffer.byteLength(JSON.stringify({ messages: context })) <= 18_000);
  const positions = context.map((message) => expectedOrder.findIndex((entry) => (
    entry.role === message.role && entry.content === message.content
  )));
  assert.ok(positions.every((position, index) => index === 0 || positions[index - 1] < position));
});

test('falls back to normal context if approved memory would crowd out the newest user message', () => {
  const memory = setMemoryContextApproval(
    createMemory({ type: 'preference', title: 'Style', content: 'x'.repeat(950) }),
    true,
  );
  const messages = [{ role: 'user', content: `Question ${'y'.repeat(17_500)}` }];
  const normalContext = selectMemoryAwareChatContext(messages, [memory], false);
  const memoryContext = selectMemoryAwareChatContext(messages, [memory], true);

  assert.equal(normalContext.length, 1);
  assert.deepEqual(memoryContext, normalContext);
  assert.equal(memoryContext[0].content, messages[0].content);
});
