import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

const environmentKeys = [
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_PROVIDER',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'APP_ACCESS_TOKEN',
  'NODE_ENV',
];
const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
for (const key of environmentKeys) delete process.env[key];

const server = createAppServer();
const originalFetch = globalThis.fetch;
let baseUrl;

function makeVisionJpeg(width = 640, height = 360) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11,
    0x08, (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

async function postJson(path, body) {
  return originalFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function configureOllama({
  baseUrl: ollamaBaseUrl = 'http://127.0.0.1:11434',
  model = 'qwen2.5:3b',
} = {}) {
  return postJson('/api/settings/ai', {
    provider: 'ollama',
    model,
    baseUrl: ollamaBaseUrl,
  });
}

function mockOllamaFetch(baseUrlToMock, handler) {
  globalThis.fetch = async (input, options) => {
    const requestUrl = String(input);
    if (requestUrl.startsWith(baseUrlToMock)) return handler(new URL(requestUrl), options);
    if (requestUrl.startsWith(baseUrl)) return originalFetch(input, options);
    throw new Error(`Unexpected outbound request in local Ollama test: ${requestUrl}`);
  };
}

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('configures and reports a local Ollama URL and installed model', async () => {
  const ollamaBaseUrl = 'http://127.0.0.1:11435';
  const configured = await configureOllama({ baseUrl: ollamaBaseUrl, model: 'llama3.2:3b' });
  assert.deepEqual(await configured.json(), {
    configured: true,
    providerSource: 'session',
    provider: 'ollama',
    model: 'llama3.2:3b',
    baseUrl: ollamaBaseUrl,
  });

  mockOllamaFetch(ollamaBaseUrl, async (url, options) => {
    assert.equal(url.pathname, '/api/tags');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/health`);
    const health = await response.json();
    assert.equal(health.provider, 'ollama');
    assert.equal(health.baseUrl, ollamaBaseUrl);
    assert.equal(health.ollamaAvailable, true);
    assert.equal(health.modelInstalled, true);
    assert.equal(health.aiAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('rejects invalid and external Ollama URLs and invalid model names', async () => {
  const missingModel = await postJson('/api/settings/ai', {
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
  });
  assert.equal(missingModel.status, 400);
  assert.match((await missingModel.json()).error, /valid model name/);

  for (const ollamaBaseUrl of [
    'https://example.com',
    'http://user:pass@127.0.0.1:11434',
    'http://127.0.0.1:11434?target=elsewhere',
    'javascript:alert(1)',
    'not a URL',
  ]) {
    const response = await configureOllama({ baseUrl: ollamaBaseUrl });
    assert.equal(response.status, 400, ollamaBaseUrl);
    assert.match((await response.json()).error, /Ollama base URL|valid local Ollama base URL/);
  }

  const invalidModel = await configureOllama({ model: '../external/model' });
  assert.equal(invalidModel.status, 400);
  assert.match((await invalidModel.json()).error, /valid Ollama model name/);

  const privateLan = await configureOllama({ baseUrl: 'http://192.168.10.5:11434', model: 'llama3.2:3b' });
  assert.equal(privateLan.status, 200);
  assert.equal((await privateLan.json()).baseUrl, 'http://192.168.10.5:11434');
  await postJson('/api/settings/ai', { provider: 'environment' });
});

test('reports an unavailable configured Ollama endpoint without falling back to another provider', async () => {
  const ollamaBaseUrl = 'http://127.0.0.1:11436';
  await configureOllama({ baseUrl: ollamaBaseUrl });
  mockOllamaFetch(ollamaBaseUrl, async () => {
    throw new TypeError('mocked local Ollama connection failure');
  });

  try {
    const healthResponse = await originalFetch(`${baseUrl}/api/health`);
    const health = await healthResponse.json();
    assert.equal(health.provider, 'ollama');
    assert.equal(health.ollamaAvailable, false);
    assert.equal(health.modelInstalled, false);
    assert.equal(health.aiAvailable, false);

    const response = await postJson('/api/chat', {
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.code, 'UPSTREAM_UNAVAILABLE');
    assert.match(result.error, /Ollama is unavailable at http:\/\/127\.0\.0\.1:11436/);

    const image = makeVisionJpeg();
    const visionResponse = await postJson('/api/vision', {
      provider: 'ollama',
      question: 'What is visible?',
      image: `data:image/jpeg;base64,${image.toString('base64')}`,
    });
    const visionResult = await visionResponse.json();
    assert.equal(visionResponse.status, 503);
    assert.equal(visionResult.code, 'UPSTREAM_UNAVAILABLE');
    assert.match(visionResult.error, /Ollama is unavailable at http:\/\/127\.0\.0\.1:11436/);
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('reports missing Ollama models in health and chat responses', async () => {
  const ollamaBaseUrl = 'http://127.0.0.1:11437';
  const model = 'missing-model:latest';
  await configureOllama({ baseUrl: ollamaBaseUrl, model });
  mockOllamaFetch(ollamaBaseUrl, async (url) => {
    if (url.pathname === '/api/tags') {
      return new Response(JSON.stringify({ models: [{ name: 'another-model:latest' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: `model '${model}' not found` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  });

  try {
    const health = await (await originalFetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.ollamaAvailable, true);
    assert.equal(health.modelInstalled, false);
    assert.equal(health.aiAvailable, false);

    const response = await postJson('/api/chat', {
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.code, 'MODEL_NOT_FOUND');
    assert.match(result.error, /missing-model:latest.*not installed/);
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('routes local chat to the configured Ollama URL and model', async () => {
  const ollamaBaseUrl = 'http://127.0.0.1:11438';
  const model = 'llama3.2:3b';
  await configureOllama({ baseUrl: ollamaBaseUrl, model });
  let upstreamBody;
  mockOllamaFetch(ollamaBaseUrl, async (url, options) => {
    assert.equal(url.pathname, '/api/chat');
    assert.equal(options.redirect, 'error');
    upstreamBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ message: { content: 'Local Ollama reply.' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  try {
    const response = await postJson('/api/chat', {
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 32,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      reply: 'Local Ollama reply.',
      provider: 'Ollama / llama3.2:3b',
    });
    assert.equal(upstreamBody.model, model);
    assert.equal(upstreamBody.stream, false);
    assert.equal(upstreamBody.messages.at(-1).content, 'hello');
    assert.deepEqual(upstreamBody.options, { num_predict: 32 });
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('Study Mode and source-backed search summaries stay on the configured Ollama endpoint', async () => {
  const ollamaBaseUrl = 'http://127.0.0.1:11440';
  const model = 'qwen2.5:7b';
  await configureOllama({ baseUrl: ollamaBaseUrl, model });
  const requests = [];
  mockOllamaFetch(ollamaBaseUrl, async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ message: { content: 'Local feature response.' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  try {
    const study = await postJson('/api/chat', {
      provider: 'ollama',
      mode: 'study',
      messages: [{ role: 'user', content: 'Explain photosynthesis.' }],
    });
    assert.equal(study.status, 200);
    assert.match(requests[0].body.messages[0].content, /Study Mode/);

    const summaryPrompt = 'Summarize retrieved search sources. Source [1]: Verified article title; URL: https://news.example/article.';
    const summary = await postJson('/api/chat', {
      provider: 'ollama',
      singleAttempt: true,
      messages: [{ role: 'user', content: summaryPrompt }],
    });
    assert.equal(summary.status, 200);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.url.origin, ollamaBaseUrl);
      assert.equal(request.url.pathname, '/api/chat');
      assert.equal(request.body.model, model);
    }
    assert.equal(requests[1].body.messages.at(-1).content, summaryPrompt);
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('rejects a provider mismatch rather than routing a local selection to another adapter', async () => {
  const ollamaBaseUrl = 'http://127.0.0.1:11441';
  await configureOllama({ baseUrl: ollamaBaseUrl });
  let upstreamCalls = 0;
  mockOllamaFetch(ollamaBaseUrl, async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({ message: { content: 'unexpected' } }));
  });

  try {
    const response = await postJson('/api/chat', {
      provider: 'gemini',
      messages: [{ role: 'user', content: 'must not route to Ollama' }],
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'AI_PROVIDER_MISMATCH');
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('routes Vision JPEG input only to the configured local Ollama endpoint', async () => {
  const ollamaBaseUrl = 'http://127.0.0.1:11439';
  const model = 'llava:latest';
  await configureOllama({ baseUrl: ollamaBaseUrl, model });
  let upstreamBody;
  mockOllamaFetch(ollamaBaseUrl, async (url, options) => {
    assert.equal(url.pathname, '/api/chat');
    assert.equal(options.redirect, 'error');
    upstreamBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ message: { content: 'A local Vision result.' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  try {
    const image = makeVisionJpeg();
    const response = await postJson('/api/vision', {
      provider: 'ollama',
      question: 'What is visible?',
      image: `data:image/jpeg;base64,${image.toString('base64')}`,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      reply: 'A local Vision result.',
      provider: 'Ollama / llava:latest',
    });
    assert.equal(upstreamBody.model, model);
    assert.deepEqual(upstreamBody.messages.at(-1).images, [image.toString('base64')]);
    assert.equal(upstreamBody.messages.at(-1).content, 'What is visible?');
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});
