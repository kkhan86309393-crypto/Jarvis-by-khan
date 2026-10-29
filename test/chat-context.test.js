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