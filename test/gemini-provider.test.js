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

async function configureGemini(apiKey = 'test-only-gemini-secret') {
  return postJson('/api/settings/ai', {
    provider: 'gemini',
    model: 'gemini-test-model',
    apiKey,
  });
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

test('exposes Gemini as a settings option and validates configuration without storing keys', async () => {
  const shellResponse = await originalFetch(baseUrl);
  assert.match(await shellResponse.text(), /<option value="gemini">Google Gemini API<\/option>/);

  const missingKey = await postJson('/api/settings/ai', {
    provider: 'gemini',
    model: 'gemini-test-model',
  });
  assert.equal(missingKey.status, 400);
  assert.match((await missingKey.json()).error, /Google Gemini API key/);

  const invalidModel = await postJson('/api/settings/ai', {
    provider: 'gemini',
    model: 'models\/gemini-test-model',
    apiKey: 'test-only-invalid-model-secret',
  });
  assert.equal(invalidModel.status, 400);

  const invalidEndpoint = await postJson('/api/settings/ai', {
    provider: 'gemini',
    model: 'gemini-test-model',
    apiKey: 'test-only-invalid-endpoint-secret',
    baseUrl: 'https://example.invalid/',
  });
  assert.equal(invalidEndpoint.status, 400);
  assert.match((await invalidEndpoint.json()).error, /official Google API endpoint/);

  const unsupportedProvider = await postJson('/api/settings/ai', {
    provider: 'unknown',
    model: 'gemini-test-model',
    apiKey: 'test-only-unsupported-provider-secret',
  });
  assert.equal(unsupportedProvider.status, 400);

  const missingModel = await postJson('/api/settings/ai', {
    provider: 'gemini',
    apiKey: 'test-only-missing-model-secret',
  });
  assert.equal(missingModel.status, 400);
  assert.match((await missingModel.json()).error, /valid model name/);

  process.env.AI_PROVIDER = 'gemini';
  const unavailable = await originalFetch(`${baseUrl}/api/health`);
  const unavailableHealth = await unavailable.json();
  assert.equal(unavailableHealth.aiConfigured, false);
  assert.equal(unavailableHealth.provider, null);
  process.env.AI_API_KEY = 'test-only-gemini-environment-secret';
  process.env.AI_MODEL = 'gemini-environment-model';
  const configured = await originalFetch(`${baseUrl}/api/health`);
  const configuredHealth = await configured.json();
  assert.equal(configuredHealth.aiConfigured, true);
  assert.equal(configuredHealth.provider, 'gemini');
  assert.equal(configuredHealth.model, 'gemini-environment-model');
  assert.equal(configuredHealth.baseUrl, null);
  assert.doesNotMatch(JSON.stringify(configuredHealth), /test-only-gemini-environment-secret/);
  process.env.AI_MODEL = 'models/gemini-invalid';
  const invalidEnvironment = await originalFetch(`${baseUrl}/api/health`);
  assert.equal(invalidEnvironment.status, 500);
  assert.doesNotMatch(await invalidEnvironment.text(), /test-only-gemini-environment-secret/);
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.AI_PROVIDER;
});

test('rejects invalid environment provider values rather than falling back to another adapter', async () => {
  process.env.AI_PROVIDER = 'unsupported-provider';
  process.env.AI_API_KEY = 'test-only-invalid-environment-provider-key';
  process.env.AI_MODEL = 'gemini-environment-model';
  process.env.AI_BASE_URL = 'https://openai-compatible.invalid/v1/';
  let upstreamCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input);
    upstreamCalls += 1;
    throw new Error('Unexpected provider request from invalid environment configuration.');
  };

  try {
    const health = await originalFetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 500);
    assert.match((await health.json()).error, /AI_PROVIDER must be gemini, ollama, or openai-compatible/);

    const chat = await postJson('/api/chat', {
      provider: 'openai-compatible',
      messages: [{ role: 'user', content: 'Must not route through invalid environment config.' }],
    });
    const error = await chat.json();
    assert.equal(chat.status, 500);
    assert.equal(error.code, 'INVALID_AI_PROVIDER_CONFIG');
    assert.doesNotMatch(JSON.stringify(error), /test-only-invalid-environment-provider-key/);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL']) delete process.env[key];
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('rejects invalid OpenAI-compatible environment model and URL before provider requests', async () => {
  process.env.AI_PROVIDER = 'openai-compatible';
  process.env.AI_API_KEY = 'test-only-invalid-openai-environment-key';
  process.env.AI_MODEL = 'invalid model name';
  process.env.AI_BASE_URL = 'https://openai-compatible.invalid/v1/';
  let upstreamCalls = 0;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, options);
    upstreamCalls += 1;
    throw new Error('Unexpected provider request from invalid environment configuration.');
  };

  try {
    const invalidModel = await postJson('/api/chat', {
      provider: 'openai-compatible',
      messages: [{ role: 'user', content: 'Must not route with an invalid model.' }],
    });
    assert.equal(invalidModel.status, 500);
    assert.equal((await invalidModel.json()).code, 'INVALID_AI_PROVIDER_CONFIG');

    process.env.AI_MODEL = 'valid-model';
    process.env.AI_BASE_URL = 'javascript:alert(1)';
    const invalidBaseUrl = await postJson('/api/chat', {
      provider: 'openai-compatible',
      messages: [{ role: 'user', content: 'Must not route with an invalid endpoint.' }],
    });
    assert.equal(invalidBaseUrl.status, 500);
    const error = await invalidBaseUrl.json();
    assert.equal(error.code, 'INVALID_AI_PROVIDER_CONFIG');
    assert.doesNotMatch(JSON.stringify(error), /test-only-invalid-openai-environment-key/);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL']) delete process.env[key];
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('sends native Gemini text requests and normalizes candidate parts', async () => {
  const apiKey = 'test-only-gemini-chat-secret';
  const configurationResponse = await configureGemini(apiKey);
  const configuration = await configurationResponse.json();
  assert.deepEqual(configuration, {
    configured: true,
    providerSource: 'session',
    provider: 'gemini',
    model: 'gemini-test-model',
  });
  assert.doesNotMatch(JSON.stringify(configuration), new RegExp(apiKey));

  let upstreamUrl;
  let upstreamBody;
  let upstreamApiKey;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) {
      upstreamUrl = new URL(input);
      upstreamBody = JSON.parse(options.body);
      upstreamApiKey = options.headers['x-goog-api-key'];
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Gemini ' }, { text: 'reply.' }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, options);
  };

  try {
    const response = await postJson('/api/chat', {
      provider: 'gemini',
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'Previous answer' },
        { role: 'user', content: 'Follow-up' },
      ],
      max_tokens: 96,
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result, { reply: 'Gemini reply.', provider: 'Gemini / gemini-test-model' });
    assert.equal(upstreamUrl.pathname, '/v1beta/models/gemini-test-model:generateContent');
    assert.equal(upstreamUrl.search, '');
    assert.equal(upstreamApiKey, apiKey);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
    assert.equal(upstreamBody.systemInstruction.parts.length, 1);
    assert.deepEqual(upstreamBody.contents.map(({ role }) => role), ['user', 'model', 'user']);
    assert.deepEqual(upstreamBody.contents.at(-1).parts, [{ text: 'Follow-up' }]);
    assert.deepEqual(upstreamBody.generationConfig, { maxOutputTokens: 96 });
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('Study Mode and source-backed search summaries use the native Gemini adapter', async () => {
  await configureGemini('test-only-gemini-feature-routing-secret');
  const requests = [];
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) {
      requests.push({ url: new URL(input), body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Gemini feature response.' }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, options);
  };

  try {
    const study = await postJson('/api/chat', {
      provider: 'gemini',
      mode: 'study',
      messages: [{ role: 'user', content: 'Explain photosynthesis.' }],
    });
    assert.equal(study.status, 200);
    assert.match(requests[0].body.systemInstruction.parts[0].text, /Study Mode/);

    const summaryPrompt = 'Summarize retrieved search sources. Source [1]: Verified article title; URL: https://news.example/article.';
    const summary = await postJson('/api/chat', {
      provider: 'gemini',
      singleAttempt: true,
      messages: [{ role: 'user', content: summaryPrompt }],
    });
    assert.equal(summary.status, 200);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url.pathname, '/v1beta/models/gemini-test-model:generateContent');
    assert.equal(requests[1].url.pathname, '/v1beta/models/gemini-test-model:generateContent');
    assert.deepEqual(requests[1].body.contents, [{ role: 'user', parts: [{ text: summaryPrompt }] }]);
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('rejects mismatched and unconfigured Gemini selections without trying another provider', async () => {
  await configureGemini('test-only-gemini-no-fallback-secret');
  let upstreamCalls = 0;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/')) upstreamCalls += 1;
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, options);
    throw new Error(`Unexpected provider request: ${String(input)}`);
  };

  try {
    const mismatch = await postJson('/api/chat', {
      provider: 'openai-compatible',
      messages: [{ role: 'user', content: 'must not route to Gemini' }],
    });
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).code, 'AI_PROVIDER_MISMATCH');
    assert.equal(upstreamCalls, 0);

    const image = makeVisionJpeg();
    const visionMismatch = await postJson('/api/vision', {
      provider: 'ollama',
      question: 'Must not route to Gemini.',
      image: `data:image/jpeg;base64,${image.toString('base64')}`,
    });
    assert.equal(visionMismatch.status, 409);
    assert.equal((await visionMismatch.json()).code, 'AI_PROVIDER_MISMATCH');
    assert.equal(upstreamCalls, 0);

    await postJson('/api/settings/ai', { provider: 'environment' });
    const missingKey = await postJson('/api/chat', {
      provider: 'gemini',
      messages: [{ role: 'user', content: 'must not route without a key' }],
    });
    const error = await missingKey.json();
    assert.equal(missingKey.status, 503);
    assert.equal(error.code, 'AI_PROVIDER_NOT_CONFIGURED');
    assert.match(error.error, /Unlock the saved Gemini key or enter a Gemini API key/);
    assert.doesNotMatch(JSON.stringify(error), /test-only-gemini-no-fallback-secret/);
    assert.equal(upstreamCalls, 0);

    const missingVisionKey = await postJson('/api/vision', {
      provider: 'gemini',
      question: 'Describe this frame.',
      image: `data:image/jpeg;base64,${image.toString('base64')}`,
    });
    const visionError = await missingVisionKey.json();
    assert.equal(missingVisionKey.status, 503);
    assert.equal(visionError.code, 'AI_PROVIDER_NOT_CONFIGURED');
    assert.match(visionError.error, /Unlock the saved Gemini key or enter a Gemini API key/);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('normalizes Gemini chat errors and redacts keys from responses and logs', async () => {
  const apiKey = 'test-only-gemini-chat-error-secret';
  await configureGemini(apiKey);
  const originalConsoleError = console.error;
  const loggedMessages = [];
  console.error = (...args) => loggedMessages.push(args.join(' '));
  globalThis.fetch = async (input) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) {
      return new Response(JSON.stringify({
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: `Rejected credential ${apiKey}`,
        },
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input);
  };

  try {
    const response = await postJson('/api/chat', {
      provider: 'gemini',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.code, 'INVALID_ARGUMENT');
    assert.match(result.error, /Rejected credential \[redacted\]/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
    assert.doesNotMatch(loggedMessages.join(' '), new RegExp(apiKey));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('sends Gemini Vision JPEG input as inline data and normalizes the response', async () => {
  await configureGemini('test-only-gemini-vision-secret');
  let upstreamBody;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) {
      upstreamBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'A settings window is open.' }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, options);
  };

  try {
    const image = makeVisionJpeg();
    const response = await postJson('/api/vision', {
      provider: 'gemini',
      question: 'What is visible?',
      image: `data:image/jpeg;base64,${image.toString('base64')}`,
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result, {
      reply: 'A settings window is open.',
      provider: 'Gemini / gemini-test-model',
    });
    assert.deepEqual(upstreamBody.contents[0].parts[0], { text: 'What is visible?' });
    assert.deepEqual(upstreamBody.contents[0].parts[1], {
      inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') },
    });
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});

test('normalizes Gemini Vision errors without exposing the API key', async () => {
  const apiKey = 'test-only-gemini-vision-error-secret';
  await configureGemini(apiKey);
  globalThis.fetch = async (input) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) {
      return new Response(JSON.stringify({
        error: { status: 'PERMISSION_DENIED', message: `Vision denied for ${apiKey}` },
      }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input);
  };

  try {
    const image = makeVisionJpeg();
    const response = await postJson('/api/vision', {
      provider: 'gemini',
      question: 'Describe this image.',
      image: `data:image/jpeg;base64,${image.toString('base64')}`,
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.code, 'PERMISSION_DENIED');
    assert.match(result.error, /Vision denied for \[redacted\]/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
  } finally {
    globalThis.fetch = originalFetch;
    await postJson('/api/settings/ai', { provider: 'environment' });
  }
});
