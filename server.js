import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, statfs } from 'node:fs/promises';
import { cpus, freemem, platform, totalmem } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 24_000;
const maxVisionRequestBytes = 700_000;
const maxVisionImageBytes = 500 * 1024;
const maxVisionDimension = 1_280;
const requestWindowMs = 60_000;
const requestLimit = 30;
const visionRequestLimit = 5;
const aiRequestTimeoutMs = 45_000;
const maxTransientRetries = 2;
const clientRequests = new Map();
const visionClientRequests = new Map();
let runtimeAIConfig = null;
let previousCpuTimes = null;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function getClientKey(request) {
  return request.socket.remoteAddress || 'unknown';
}

function isRateLimited(request, limit = requestLimit, requests = clientRequests) {
  const now = Date.now();
  const clientKey = getClientKey(request);
  const recentRequests = (requests.get(clientKey) || []).filter((time) => now - time < requestWindowMs);

  if (recentRequests.length >= limit) {
    requests.set(clientKey, recentRequests);
    return true;
  }

  recentRequests.push(now);
  requests.set(clientKey, recentRequests);
  return false;
}

function isAuthorized(request) {
  const expected = process.env.APP_ACCESS_TOKEN;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const authorization = request.headers.authorization || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function authorizeApiRequest(request, response) {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ACCESS_TOKEN) {
    sendJson(response, 503, { error: 'This production server is locked until its administrator configures APP_ACCESS_TOKEN.' });
    return false;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'This server requires an access key. Enter it in Settings to continue.' });
    return false;
  }
  return true;
}

async function readJson(request, maxBytes = maxBodyBytes) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function validateMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw Object.assign(new Error('Send between 1 and 24 conversation messages.'), { status: 400 });
  }

  return value.map((message) => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw Object.assign(new Error('Each message needs a supported role and text content.'), { status: 400 });
    }

    const content = message.content.trim();
    if (!content || content.length > 4_000) {
      throw Object.assign(new Error('Each message must contain 1 to 4,000 characters.'), { status: 400 });
    }
    return { role: message.role, content };
  });
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function getJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;

  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function validateVisionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) {
    throw Object.assign(new Error('Enter a question of 1 to 500 characters about the captured screen.'), { status: 400 });
  }
  const match = typeof body.image === 'string'
    ? /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image)
    : null;
  if (!match) {
    throw Object.assign(new Error('Vision accepts one JPEG screen capture only.'), { status: 400 });
  }
  const encoded = match[1];
  const image = Buffer.from(encoded, 'base64');
  if (!image.length || image.length > maxVisionImageBytes || image.toString('base64') !== encoded) {
    throw Object.assign(new Error('The screen capture must be a valid JPEG no larger than 500 KB.'), { status: 400 });
  }
  const dimensions = getJpegDimensions(image);
  if (!dimensions || !dimensions.width || !dimensions.height) {
    throw Object.assign(new Error('The screen capture is not a valid JPEG image.'), { status: 400 });
  }
  if (Math.max(dimensions.width, dimensions.height) > maxVisionDimension) {
    throw Object.assign(new Error('Resize the screen capture so its longest side is no more than 1280 pixels.'), { status: 400 });
  }
  return { question, image, imageDataUrl: body.image };
}

function getAIConfig() {
  if (runtimeAIConfig) return runtimeAIConfig;

  if (
    process.env.AI_PROVIDER === 'ollama'
    || (process.env.AI_PROVIDER !== 'openai-compatible' && !process.env.AI_API_KEY && process.env.OLLAMA_BASE_URL)
  ) {
    return {
      provider: 'ollama',
      model: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    };
  }
  if (process.env.AI_API_KEY) {
    return {
      provider: 'openai-compatible',
      model: process.env.AI_MODEL || 'gemini-3.5-flash-lite',
      apiKey: process.env.AI_API_KEY,
      baseUrl: process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
    };
  }
  return null;
}

function getAIConfigSource(config = getAIConfig()) {
  if (!config) return 'none';
  return runtimeAIConfig ? 'session' : 'environment';
}

function publicAIConfig(config = getAIConfig()) {
  return config ? {
    provider: config.provider,
    model: config.model,
    ...(config.provider === 'openai-compatible' ? { baseUrl: config.baseUrl } : {}),
  } : null;
}

function getOpenAIChatCompletionsUrl(baseUrl) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return normalizedBaseUrl.endsWith('/chat/completions')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/chat/completions`;
}

function getRetryDelayMs(upstream, retryIndex) {
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(1_000, seconds * 1_000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(1_000, Math.max(0, retryAt - Date.now()));
  }
  return 250 * (2 ** retryIndex);
}

async function fetchOpenAICompatibleWithRetry(url, options, maxRetries = maxTransientRetries) {
  const deadline = Date.now() + aiRequestTimeoutMs;
  for (let retryIndex = 0; ; retryIndex += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new DOMException('Timed out', 'TimeoutError');
    const upstream = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(remainingMs),
    });
    if (![500, 502, 503, 504].includes(upstream.status) || retryIndex >= maxRetries) {
      return upstream;
    }

    await upstream.body?.cancel();
    const delayMs = Math.min(getRetryDelayMs(upstream, retryIndex), Math.max(0, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function getUpstreamRequestError(error) {
  const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  return Object.assign(
    new Error(isTimeout
      ? 'The AI provider timed out. Check the provider/model and retry.'
      : 'Could not connect to the AI provider. Check the server network connection and provider URL.'),
    { status: isTimeout ? 504 : 502, code: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE' },
  );
}

async function readUpstreamJson(upstream, provider) {
  try {
    return await upstream.json();
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw getUpstreamRequestError(error);
    throw Object.assign(new Error(`${provider} returned an invalid response. Check the selected model and provider configuration.`), {
      status: 502,
      code: 'INVALID_UPSTREAM_RESPONSE',
    });
  }
}

function getSafeProviderErrorCode(value, status) {
  if (Number.isInteger(value) && value >= 100 && value <= 599) return String(value);
  if (typeof value === 'string') {
    const code = value.trim().toUpperCase();
    if (/^\d{3}$/.test(code) && Number(code) >= 100 && Number(code) <= 599) return code;
    if ([
      'ALREADY_EXISTS',
      'CANCELLED',
      'DEADLINE_EXCEEDED',
      'FAILED_PRECONDITION',
      'INSUFFICIENT_QUOTA',
      'INTERNAL',
      'INVALID_API_KEY',
      'INVALID_ARGUMENT',
      'MODEL_NOT_FOUND',
      'NOT_FOUND',
      'OUT_OF_RANGE',
      'PERMISSION_DENIED',
      'RATE_LIMIT_EXCEEDED',
      'RESOURCE_EXHAUSTED',
      'UNAUTHENTICATED',
      'UNAVAILABLE',
      'UNKNOWN',
      'UNIMPLEMENTED',
    ].includes(code)) return code;
  }
  return `HTTP_${status}`;
}

function sanitizeProviderErrorMessage(message, apiKey, status) {
  if (typeof message !== 'string' || !message.trim()) {
    return `AI provider returned HTTP ${status}. Check the model and provider settings.`;
  }

  let sanitized = message
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+[^\s,;]+/gi, '[redacted credential]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[^"'\s,;]+["']?/gi, '[redacted credential]')
    .replace(/\b(?:authorization|api[_-]?key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '[redacted credential]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/[?&](?:key|api[_-]?key|token)=([^&\s]+)/gi, (match) => `${match.slice(0, match.indexOf('=') + 1)}[redacted]`)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/gi, '[redacted]');
  if (apiKey) sanitized = sanitized.split(apiKey).join('[redacted]');

  sanitized = sanitized.replace(/\s+/g, ' ').trim().slice(0, 500);
  return sanitized || `AI provider returned HTTP ${status}. Check the model and provider settings.`;
}

async function getSafeProviderError(upstream, apiKey) {
  const status = upstream.status;
  let details = null;
  let bodyShape = 'invalid JSON';
  try {
    const body = JSON.parse(await upstream.text());
    bodyShape = Array.isArray(body) ? 'JSON array' : body === null ? 'JSON null' : typeof body === 'object' ? 'JSON object without a structured error' : `JSON ${typeof body}`;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      if (body.error && typeof body.error === 'object' && !Array.isArray(body.error)) {
        details = body.error;
        bodyShape = 'JSON object with structured error';
      } else {
        details = body;
      }
    }
  } catch {
    // Keep diagnostics limited to parsed, allowlisted fields.
  }
  const providerCode = getSafeProviderErrorCode(details?.status, status);
  const fallbackCode = getSafeProviderErrorCode(details?.code, status);
  const code = providerCode === `HTTP_${status}` ? fallbackCode : providerCode;
  const message = typeof details?.message === 'string' && details.message.trim()
    ? sanitizeProviderErrorMessage(details.message, apiKey, status)
    : `AI provider returned HTTP ${status}; its response was ${bodyShape} and contained no usable error message.`;
  const rawContentType = upstream.headers.get('content-type')?.split(';', 1)[0].trim() || '';
  const contentType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(rawContentType)
    ? rawContentType.slice(0, 100)
    : 'unknown';
  const bodyPreview = JSON.stringify({
    code: code === `HTTP_${status}` ? undefined : code,
    message: typeof details?.message === 'string' && details.message.trim() ? message : undefined,
    shape: bodyShape,
    ...(typeof details?.message === 'string' && details.message.trim() ? {} : { diagnostic: 'No allowlisted error message found; other upstream fields omitted.' }),
  }).slice(0, 700);
  return {
    code,
    message,
    ...(status === 404 ? { diagnostics: { contentType, body: bodyPreview } } : {}),
  };
}

async function configureAI(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
  if (body.provider === 'environment') {
    runtimeAIConfig = null;
    return publicAIConfig();
  }
  if (!['openai-compatible', 'ollama'].includes(body.provider)) {
    throw Object.assign(new Error('Choose OpenAI-compatible or Ollama as the AI provider.'), { status: 400 });
  }
  if (typeof body.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(body.model.trim())) {
    throw Object.assign(new Error('Enter a valid model name using letters, numbers, dots, underscores, colons, slashes, or hyphens.'), { status: 400 });
  }

  if (body.provider === 'ollama') {
    runtimeAIConfig = {
      provider: 'ollama',
      model: body.model.trim(),
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    };
  } else {
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 1_024) {
      throw Object.assign(new Error('Enter a provider API key, or configure AI_API_KEY on the server. The key must be no longer than 1,024 characters.'), { status: 400 });
    }
    const baseUrl = body.baseUrl ?? process.env.AI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/';
    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw Object.assign(new Error('Enter a valid provider base URL.'), { status: 400 });
    }
    if (
      typeof baseUrl !== 'string'
      || baseUrl.length > 2_048
      || !['http:', 'https:'].includes(parsedBaseUrl.protocol)
      || parsedBaseUrl.username
      || parsedBaseUrl.password
      || parsedBaseUrl.search
      || parsedBaseUrl.hash
    ) {
      throw Object.assign(new Error('Provider base URL must be a valid HTTP or HTTPS URL without credentials, query parameters, or a fragment.'), { status: 400 });
    }
    runtimeAIConfig = {
      provider: 'openai-compatible',
      model: body.model.trim(),
      apiKey: body.apiKey.trim(),
      baseUrl: parsedBaseUrl.href,
    };
  }
  return publicAIConfig();
}

async function handleChat(request, response) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
  if (body.max_tokens !== undefined && (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 256)) {
    throw Object.assign(new Error('Chat output token limit must be an integer from 1 to 256.'), { status: 400 });
  }
  if (body.singleAttempt !== undefined && typeof body.singleAttempt !== 'boolean') {
    throw Object.assign(new Error('singleAttempt must be a boolean.'), { status: 400 });
  }
  const messages = validateMessages(body.messages);
  const language = body.language === 'hi' ? 'Hindi' : 'English';
  const modeInstruction = body.mode === 'study'
    ? 'The user selected Study Mode. Teach interactively with clear short steps and examples, and ask a brief comprehension question when useful.'
    : '';
  const systemMessage = {
    role: 'system',
    content: `You are J.A.R.V.I.S., a capable and thoughtful assistant. Answer the user's actual request directly and use relevant conversation history without repeating it. Prioritize the latest message when the topic changes. Ask a focused clarifying question only when essential. Give useful specifics, short steps, or examples when they help. Reply in ${language} naturally unless the user clearly requests another language; preserve names, code, and technical terms as written. Be honest about uncertainty and never claim to have performed actions or accessed information you cannot. ${modeInstruction}`,
  };

  const config = getAIConfig();
  if (config?.provider === 'ollama') {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const model = config.model;
    let upstream;
    try {
      upstream = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [systemMessage, ...messages],
          stream: false,
          ...(body.max_tokens ? { options: { num_predict: body.max_tokens } } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw Object.assign(new Error('Local Ollama timed out. Check that the model is loaded and the server has enough resources, then retry.'), {
          status: 504,
          code: 'UPSTREAM_TIMEOUT',
        });
      }
      throw Object.assign(new Error('Local Ollama is unavailable. Start Ollama on the server host and confirm it listens on port 11434.'), {
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
      });
    }

    if (!upstream.ok) {
      throw Object.assign(new Error(`Local Ollama returned HTTP ${upstream.status}. Check that the model is installed and running.`), { status: 502 });
    }
    const data = await readUpstreamJson(upstream, 'Local Ollama');
    const content = data.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw Object.assign(new Error('Local model returned an empty response.'), { status: 502 });
    }
    sendJson(response, 200, { reply: content.trim(), provider: `Ollama / ${model}` });
    return;
  }

  if (config?.provider === 'openai-compatible') {
    let upstream;
    try {
      upstream = await fetchOpenAICompatibleWithRetry(getOpenAIChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [systemMessage, ...messages],
        ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
        ...(config.baseUrl.includes('generativelanguage.googleapis.com') ? { reasoning_effort: 'low' } : {}),
      }),
      }, body.singleAttempt ? 0 : maxTransientRetries);
    } catch (error) {
      throw getUpstreamRequestError(error);
    }

    if (!upstream.ok) {
      const providerError = await getSafeProviderError(upstream, config.apiKey);
      const guidance = upstream.status === 401 || upstream.status === 403
        ? ' Check that the API key is valid and has permission to use this model in Settings.'
        : upstream.status === 429
          ? ' Check the provider quota or rate limit, then retry.'
          : upstream.status === 503
            ? ' The AI provider is temporarily unavailable; try again shortly.'
          : upstream.status === 404
            ? config.baseUrl.includes('generativelanguage.googleapis.com')
              ? ' For Gemini, verify that this model is enabled for your key and keep the base URL at https://generativelanguage.googleapis.com/v1beta/openai/.'
              : ' Check the model name and provider base URL in Settings.'
            : '';
      throw Object.assign(new Error(`${providerError.message}${guidance}`), {
        status: upstream.status === 503 ? 503 : 502,
        code: providerError.code,
        ...(providerError.diagnostics ? { diagnostics: providerError.diagnostics } : {}),
      });
    }
    const data = await readUpstreamJson(upstream, 'AI provider');
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw Object.assign(new Error('AI provider returned an empty response.'), { status: 502 });
    }
    sendJson(response, 200, { reply: content.trim(), provider: config.model });
    return;
  }

  throw Object.assign(new Error('No AI provider is configured. Enter a provider API key in Settings or configure AI_API_KEY on the server.'), { status: 503 });
}

async function handleVision(request, response) {
  const { question, image, imageDataUrl } = validateVisionRequest(await readJson(request, maxVisionRequestBytes));
  const config = getAIConfig();
  if (!config) {
    throw Object.assign(new Error('No AI provider is configured. Configure an image-capable provider before using Vision.'), { status: 503 });
  }

  const systemMessage = {
    role: 'system',
    content: 'Answer the user’s question using only visible details in this single screen image. Be concise and say when text or content is unclear.',
  };
  let upstream;
  let providerName = config.model;
  try {
    if (config.provider === 'ollama') {
      providerName = `Ollama / ${config.model}`;
      upstream = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [systemMessage, { role: 'user', content: question, images: [image.toString('base64')] }],
          stream: false,
          options: { num_predict: 256 },
        }),
        signal: AbortSignal.timeout(aiRequestTimeoutMs),
      });
    } else {
      upstream = await fetch(getOpenAIChatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            systemMessage,
            {
              role: 'user',
              content: [
                { type: 'text', text: question },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
          max_tokens: 256,
          ...(config.baseUrl.includes('generativelanguage.googleapis.com') ? { reasoning_effort: 'low' } : {}),
        }),
        signal: AbortSignal.timeout(aiRequestTimeoutMs),
      });
    }
  } catch (error) {
    throw getUpstreamRequestError(error);
  }

  if (!upstream.ok) {
    if (config.provider === 'ollama') {
      throw Object.assign(new Error(`Local Ollama returned HTTP ${upstream.status}. Check that the selected model supports images.`), {
        status: 502,
        code: `HTTP_${upstream.status}`,
      });
    }
    const providerError = await getSafeProviderError(upstream, config.apiKey);
    const guidance = upstream.status === 429
      ? ' Check the provider quota or rate limit, then retry manually.'
      : upstream.status === 404
        ? ' Check that the configured Gemini model is enabled and supports image input.'
        : '';
    throw Object.assign(new Error(`${providerError.message}${guidance}`), {
      status: 502,
      code: providerError.code,
      ...(providerError.diagnostics ? { diagnostics: providerError.diagnostics } : {}),
    });
  }

  const data = await readUpstreamJson(upstream, providerName);
  const content = config.provider === 'ollama'
    ? data.message?.content
    : data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw Object.assign(new Error('The selected AI model returned no Vision response. Confirm that it supports image input.'), {
      status: 502,
      code: 'EMPTY_VISION_RESPONSE',
    });
  }
  sendJson(response, 200, { reply: content.trim(), provider: providerName });
}

async function inspectOllama(config) {
  if (config?.provider !== 'ollama') return null;
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const model = config.model;
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return { available: false, modelInstalled: false, model };
    const data = await response.json();
    const modelInstalled = Array.isArray(data.models) && data.models.some((item) => item.name === model);
    return { available: true, modelInstalled, model };
  } catch {
    return { available: false, modelInstalled: false, model };
  }
}

async function getSystemMetrics() {
  const totalMemory = totalmem();
  const freeMemory = freemem();
  const disk = await statfs(root);
  const diskTotal = Number(disk.blocks) * Number(disk.bsize);
  const diskFree = Number(disk.bavail) * Number(disk.bsize);
  const cpuTimes = cpus().map(({ times }) => times);
  let cpuUsagePercent = null;
  if (previousCpuTimes && previousCpuTimes.length === cpuTimes.length) {
    let totalDelta = 0;
    let idleDelta = 0;
    for (const [index, times] of cpuTimes.entries()) {
      for (const [key, value] of Object.entries(times)) {
        const delta = Math.max(0, value - previousCpuTimes[index][key]);
        totalDelta += delta;
        if (key === 'idle') idleDelta += delta;
      }
    }
    if (totalDelta > 0) cpuUsagePercent = Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
  }
  previousCpuTimes = cpuTimes;

  return {
    source: process.env.CODESPACE_NAME ? 'Codespaces container' : `${platform()} server`,
    cpuUsagePercent,
    cpuCount: cpuTimes.length,
    memoryUsedBytes: totalMemory - freeMemory,
    memoryTotalBytes: totalMemory,
    memoryPercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 100),
    diskUsedBytes: Math.max(0, diskTotal - diskFree),
    diskTotalBytes: diskTotal,
    diskPercent: diskTotal ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : 0,
    measuredAt: new Date().toISOString(),
  };
}

function flattenTopics(topics, results) {
  for (const topic of topics || []) {
    if (topic.Topics) {
      flattenTopics(topic.Topics, results);
    } else if (topic.FirstURL && topic.Text) {
      results.push({ title: topic.Text.split(' - ')[0], snippet: topic.Text, url: topic.FirstURL });
    }
    if (results.length >= 8) return;
  }
}

async function searchDuckDuckGo(query) {
  const searchUrl = new URL('https://api.duckduckgo.com/');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('no_html', '1');
  searchUrl.searchParams.set('skip_disambig', '1');
  const upstream = await fetch(searchUrl, { signal: AbortSignal.timeout(8_000) });
  if (!upstream.ok) throw new Error(`DuckDuckGo returned HTTP ${upstream.status}.`);
  const data = await upstream.json();
  const results = [];
  if (data.AbstractURL && data.AbstractText) {
    results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL });
  }
  flattenTopics(data.RelatedTopics, results);
  return results.slice(0, 8);
}

async function searchWikipedia(query, language) {
  const searchUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('generator', 'search');
  searchUrl.searchParams.set('gsrsearch', query);
  searchUrl.searchParams.set('gsrlimit', '8');
  searchUrl.searchParams.set('prop', 'extracts');
  searchUrl.searchParams.set('exintro', '1');
  searchUrl.searchParams.set('explaintext', '1');
  searchUrl.searchParams.set('exsentences', '2');
  searchUrl.searchParams.set('format', 'json');
  const upstream = await fetch(searchUrl, {
    headers: { 'user-agent': 'JARVIS-Personal-Assistant/1.0 (Wikipedia search)' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!upstream.ok) throw new Error(`Wikipedia returned HTTP ${upstream.status}.`);
  const data = await upstream.json();
  return Object.values(data.query?.pages || {})
    .filter((page) => Number.isInteger(page.pageid) && typeof page.title === 'string')
    .slice(0, 8)
    .map((page) => ({
      title: page.title,
      snippet: typeof page.extract === 'string' ? page.extract.trim() : '',
      url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`,
    }));
}

async function handleSearch(url, response) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query || query.length > 200) {
    throw Object.assign(new Error('Enter a search query of 1 to 200 characters.'), { status: 400 });
  }
  const language = url.searchParams.get('lang') || 'en';
  if (!['en', 'hi'].includes(language)) {
    throw Object.assign(new Error('Search language must be English or Hindi.'), { status: 400 });
  }

  let results;
  try {
    results = await searchDuckDuckGo(query);
    if (results.length) {
      sendJson(response, 200, { query, source: 'DuckDuckGo Instant Answer', results, notice: null });
      return;
    }
  } catch {
    results = [];
  }

  try {
    results = await searchWikipedia(query, language);
  } catch {
    throw Object.assign(new Error('Internet search is temporarily unavailable. DuckDuckGo Instant Answers and Wikipedia search could not be reached. Check your connection and try again.'), { status: 502 });
  }
  sendJson(response, 200, {
    query,
    source: `Wikipedia search (${language === 'hi' ? 'Hindi' : 'English'})`,
    results,
    notice: results.length ? null : 'No results were found by DuckDuckGo Instant Answers or Wikipedia search.',
  });
}

async function serveStatic(url, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: 'Invalid URL path.' });
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(root, `.${requestedPath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }

  try {
    const content = await readFile(filePath);
    const headers = {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    };
    if (filePath.endsWith('service-worker.js')) {
      headers['service-worker-allowed'] = '/';
      headers['cache-control'] = 'no-cache';
    } else if (filePath.endsWith('index.html') || filePath.endsWith('manifest.webmanifest')) {
      headers['cache-control'] = 'no-cache';
    }
    response.writeHead(200, headers);
    response.end(content);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
  }
}

export function createAppServer() {
  const server = createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) response.setHeader('cache-control', 'no-store');
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const config = getAIConfig();
        const ollama = await inspectOllama(config);
        const aiConfigured = Boolean(config);
        sendJson(response, 200, {
          aiConfigured,
          providerSource: getAIConfigSource(config),
          aiAvailable: ollama ? ollama.available && ollama.modelInstalled : Boolean(config),
          ollamaAvailable: ollama?.available ?? null,
          modelInstalled: ollama?.modelInstalled ?? null,
          provider: config?.provider ?? null,
          model: config?.model ?? null,
          baseUrl: config?.provider === 'openai-compatible' ? config.baseUrl : null,
          accessRequired: Boolean(process.env.APP_ACCESS_TOKEN) || process.env.NODE_ENV === 'production',
          accessConfigured: Boolean(process.env.APP_ACCESS_TOKEN),
          search: 'DuckDuckGo Instant Answers with Wikipedia search fallback',
          voice: 'Browser Web Speech API when available',
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/settings/ai') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request)) {
          sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' });
          return;
        }
        const config = await configureAI(await readJson(request));
        sendJson(response, 200, {
          configured: Boolean(config),
          providerSource: getAIConfigSource(config),
          ...config,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/system') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request)) {
          sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' });
          return;
        }
        sendJson(response, 200, await getSystemMetrics());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/chat') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request)) {
          sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' });
          return;
        }
        await handleChat(request, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/vision') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, visionRequestLimit, visionClientRequests)) {
          sendJson(response, 429, { error: 'Vision is limited to five requests per minute. Wait a minute and try again.' });
          return;
        }
        await handleVision(request, response);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/search') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request)) {
          sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' });
          return;
        }
        await handleSearch(url, response);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'API endpoint not found.' });
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      await serveStatic(url, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error.status || (error.name === 'TimeoutError' || error.name === 'AbortError' ? 504 : 502);
      sendJson(response, status, {
        error: error.message || 'The request could not be completed.',
        ...(typeof error.code === 'string' ? { code: error.code } : {}),
        ...(error.diagnostics && typeof error.diagnostics === 'object' ? { diagnostics: error.diagnostics } : {}),
      });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createAppServer().listen(port, '0.0.0.0', () => {
    console.log(`J.A.R.V.I.S. ready at http://localhost:${port}`);
  });
}