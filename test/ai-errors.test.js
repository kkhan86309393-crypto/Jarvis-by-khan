import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

const savedEnvironment = new Map(
  ['AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL', 'AI_PROVIDER', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL'].map((key) => [key, process.env[key]]),
);
for (const key of savedEnvironment.keys()) delete process.env[key];
process.env.AI_API_KEY = 'test-only-ai-error-key';
process.env.AI_MODEL = 'gemini-3.5-flash-lite';
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
    assert.equal(timeoutDurations.at(-1), 45_000);

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

test('retries transient provider failures with bounded backoff and preserves 503 on exhaustion', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalTimeout = AbortSignal.timeout;
  const backoffDurations = [];
  const timeoutDurations = [];
  AbortSignal.timeout = (milliseconds) => {
    timeoutDurations.push(milliseconds);
    return originalTimeout(milliseconds);
  };
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds === 250 || milliseconds === 500) {
      backoffDurations.push(milliseconds);
      return originalSetTimeout(callback, 0, ...args);
    }
    return originalSetTimeout(callback, milliseconds, ...args);
  };
  let upstreamMode = 'recover';
  let attempts = 0;
  globalThis.fetch = async (input, options) => {
    if (String(input).endsWith('/chat/completions')) {
      attempts += 1;
      assert.equal(options.signal.aborted, false);
      assert.equal(options.headers.accept, 'application/json');
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.model, 'gemini-3.5-flash-lite');
      assert.equal(requestBody.reasoning_effort, 'low');
      if (requestBody.max_tokens !== undefined) {
        assert.equal(requestBody.max_tokens, 256);
      } else {
        assert.equal(requestBody.max_tokens, undefined);
      }
      if (upstreamMode === 'recover' && attempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'Temporary outage', status: 'UNAVAILABLE' } }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        });
      }
      if (upstreamMode === 'exhaust') {
        return new Response(JSON.stringify({ error: { message: 'Temporary outage', status: 'UNAVAILABLE' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Recovered response.' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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
    assert.equal(response.status, 200);
    assert.equal(result.reply, 'Recovered response.');
    assert.equal(attempts, 2);

    upstreamMode = 'exhaust';
    attempts = 0;
    backoffDurations.length = 0;
    response = await request();
    result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.code, 'UNAVAILABLE');
    assert.match(result.error, /temporarily unavailable/i);
    assert.equal(attempts, 3);
    assert.deepEqual(backoffDurations, [250, 500]);
    assert.equal(timeoutDurations.length, 5);
    assert.ok(timeoutDurations.every((duration, index) => duration > 0 && duration <= 45_000
      && ([1, 3, 4].includes(index) ? duration <= timeoutDurations[index - 1] : true)));

    attempts = 0;
    backoffDurations.length = 0;
    response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Summarize these sources.' }],
        max_tokens: 256,
        singleAttempt: true,
      }),
    });
    const oneShotResult = await response.json();
    assert.equal(response.status, 503, oneShotResult.error);
    assert.equal(attempts, 1);
    assert.deepEqual(backoffDurations, []);

    const invalidTokenCap = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 257,
      }),
    });
    assert.equal(invalidTokenCap.status, 400);
    assert.match((await invalidTokenCap.json()).error, /from 1 to 256/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    AbortSignal.timeout = originalTimeout;
  }
});
