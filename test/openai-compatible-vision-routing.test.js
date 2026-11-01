import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

const environmentKeys = ['AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL', 'AI_PROVIDER', 'APP_ACCESS_TOKEN', 'NODE_ENV'];
const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
process.env.AI_API_KEY = 'test-only-openai-vision-secret';
process.env.AI_MODEL = 'vision-test-model';
process.env.AI_BASE_URL = 'https://openai-compatible.invalid/v1/';
process.env.AI_PROVIDER = 'openai-compatible';
delete process.env.APP_ACCESS_TOKEN;
process.env.NODE_ENV = 'test';

const server = createAppServer();
const originalFetch = globalThis.fetch;
let baseUrl;

function makeVisionJpeg(width = 1_280, height = 720) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11,
    0x08, (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
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

test('routes selected-provider Vision requests and enforces the five-request limit', async () => {
  let upstreamRequest;
  let upstreamAuthorization;
  globalThis.fetch = async (input, options) => {
    if (String(input) !== 'https://openai-compatible.invalid/v1/chat/completions') {
      throw new Error(`Unexpected outbound request in local Vision test: ${String(input)}`);
    }
    upstreamRequest = JSON.parse(options.body);
    upstreamAuthorization = options.headers.authorization;
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'A settings window is open.' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const image = `data:image/jpeg;base64,${makeVisionJpeg().toString('base64')}`;
  for (let requestCount = 0; requestCount < 5; requestCount += 1) {
    const response = await originalFetch(`${baseUrl}/api/vision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-compatible', question: 'What is visible?', image }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.reply, 'A settings window is open.');
    assert.equal(result.provider, 'vision-test-model');
    assert.doesNotMatch(JSON.stringify(result), /test-only-openai-vision-secret/);
  }

  assert.equal(upstreamAuthorization, 'Bearer test-only-openai-vision-secret');
  assert.equal(upstreamRequest.model, 'vision-test-model');
  assert.equal(upstreamRequest.max_tokens, 256);
  assert.equal(upstreamRequest.messages.at(-1).content.length, 2);
  assert.equal(upstreamRequest.messages.at(-1).content[0].text, 'What is visible?');
  assert.equal(upstreamRequest.messages.at(-1).content[1].image_url.url, image);

  const limited = await originalFetch(`${baseUrl}/api/vision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai-compatible', question: 'What is visible?', image }),
  });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /five requests per minute/);
});
