import assert from 'node:assert/strict';
import test from 'node:test';
import { readApiResponse, readChatReply } from '../public/api-response.js';

test('preserves JSON server errors instead of hiding them', async () => {
  const response = new Response(JSON.stringify({ error: 'Gemini quota exceeded.' }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(readApiResponse(response), /HTTP 429: Gemini quota exceeded/);
});

test('includes stable server error codes in client-facing diagnostics', async () => {
  const response = new Response(JSON.stringify({
    error: 'AI provider returned no usable text.',
    code: 'EMPTY_AI_RESPONSE',
  }), {
    status: 502,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(readApiResponse(response), /HTTP 502 \(EMPTY_AI_RESPONSE\): AI provider returned no usable text/);
});

test('reports HTTP status and content type when a gateway returns non-JSON', async () => {
  const response = new Response('<html>upstream unavailable</html>', {
    status: 502,
    headers: { 'content-type': 'text/html' },
  });

  await assert.rejects(readApiResponse(response), /HTTP 502 with a non-JSON response \(text\/html\)/);
});

test('distinguishes malformed successful responses from HTTP errors', async () => {
  const response = new Response('not json', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(readApiResponse(response), /unreadable response \(HTTP 200, application\/json\)/);
});

test('rejects successful chat responses without usable reply text', () => {
  assert.equal(readChatReply({ reply: '  Hello.  ' }), 'Hello.');
  assert.throws(() => readChatReply({ reply: '' }), /no usable AI reply/);
  assert.throws(() => readChatReply({}), /no usable AI reply/);
});
