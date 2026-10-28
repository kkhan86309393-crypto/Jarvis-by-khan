import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

const savedEnvironment = new Map(
  ['AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL', 'AI_PROVIDER', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL'].map((key) => [key, process.env[key]]),
);
for (const key of savedEnvironment.keys()) delete process.env[key];
process.env.AI_API_KEY = 'test-only-ai-error-key';
process.env.AI_MODEL = 'gemini-3.8-flash';
process.env.AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

const server = createAppServer();
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('returns clear timeout and malformed-provider response errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const timeoutDurations = [];
  AbortSignal.timeout = (milliseconds) => {
    timeoutDurations.push(milliseconds);
    return originalTimeout(milliseconds);
  };
  let upstreamMode = 'timeout';
  globalThis.fetch = async (input, options) => {
    if (String(input).endsWith('/chat/completions')) {
      assert.equal(options.signal.aborted, false);
      if (upstreamMode === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
      if (upstreamMode === 'unavailable') throw new TypeError('fetch failed');
      return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, options);
  };

  try {
    const request = () => originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });

    let response = await request();
    let result = await response.json();
    assert.equal(response.status, 504);
    assert.equal(result.code, 'UPSTREAM_TIMEOUT');
    assert.match(result.error, /AI provider timed out/i);
    assert.equal(timeoutDurations.at(-1), 120_000);

    upstreamMode = 'unavailable';
    response = await request();
    result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.code, 'UPSTREAM_UNAVAILABLE');
    assert.match(result.error, /Could not connect to the AI provider/i);

    upstreamMode = 'invalid-json';
    response = await request();
    result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.code, 'INVALID_UPSTREAM_RESPONSE');
    assert.match(result.error, /returned an invalid response/i);
    assert.doesNotMatch(JSON.stringify(result), /test-only-ai-error-key/);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});
