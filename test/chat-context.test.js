import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRecentChatContext } from '../public/chat-context.js';

test('preserves ordered user and assistant context while excluding non-chat entries', () => {
  const messages = [
    { role: 'user', content: 'My name is Ada.' },
    { role: 'assistant', content: 'Nice to meet you, Ada.' },
    { role: 'assistant', content: '', kind: 'search', data: { query: 'Ada' } },
    { role: 'user', content: 'What did I tell you my name was?' },
  ];

  assert.deepEqual(selectRecentChatContext(messages), [messages[0], messages[1], messages[3]]);
});

test('keeps the most recent complete turns within the serialized request budget', () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: String(index).repeat(4_000),
  }));
  const context = selectRecentChatContext(messages);

  assert.deepEqual(context, messages.slice(1));
  assert.ok(new TextEncoder().encode(JSON.stringify({ messages: context })).byteLength <= 18_000);
});

test('limits context to 24 messages and retains the newest user message', () => {
  const messages = [
    { role: 'user', content: 'Newest user message' },
    ...Array.from({ length: 24 }, (_, index) => ({
      role: 'assistant',
      content: `Assistant reply ${index}`,
    })),
  ];
  const context = selectRecentChatContext(messages);

  assert.equal(context.length, 24);
  assert.deepEqual(context, [messages[0], ...messages.slice(-23)].map(
    ({ role, content }) => ({ role, content }),
  ));
});

test('keeps the newest user message when the byte limit excludes older context', () => {
  const messages = [
    { role: 'user', content: 'older'.repeat(4_000) },
    { role: 'assistant', content: 'older reply'.repeat(500) },
    { role: 'user', content: 'newest user'.repeat(300) },
    { role: 'assistant', content: 'recent reply'.repeat(400) },
    { role: 'assistant', content: 'latest reply'.repeat(400) },
  ];
  const context = selectRecentChatContext(messages);
  const serializedBytes = new TextEncoder().encode(JSON.stringify({ messages: context })).byteLength;

  assert.deepEqual(context, [messages[2], messages[3], messages[4]].map(
    ({ role, content }) => ({ role, content }),
  ));
  assert.ok(serializedBytes <= 18_000);
});

test('preserves order and excludes search-result entries while applying the message cap', () => {
  const messages = Array.from({ length: 26 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
  }));
  messages.splice(4, 0, { role: 'assistant', content: '', kind: 'search' });
  const context = selectRecentChatContext(messages);

  assert.equal(context.length, 24);
  assert.deepEqual(context, messages.filter((message) => !message.kind).slice(-24));
});