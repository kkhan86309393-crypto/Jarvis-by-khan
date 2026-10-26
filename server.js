import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, statfs } from 'node:fs/promises';
import { availableParallelism, freemem, loadavg, platform, totalmem } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 24_000;
const requestWindowMs = 60_000;
const requestLimit = 30;
const clientRequests = new Map();

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

function isRateLimited(request) {
  const now = Date.now();
  const clientKey = getClientKey(request);
  const recentRequests = (clientRequests.get(clientKey) || []).filter((time) => now - time < requestWindowMs);

  if (recentRequests.length >= requestLimit) {
    clientRequests.set(clientKey, recentRequests);
    return true;
  }

  recentRequests.push(now);
  clientRequests.set(clientKey, recentRequests);
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

async function readJson(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
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

async function handleChat(request, response) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
  const messages = validateMessages(body.messages);
  const language = body.language === 'hi' ? 'Hindi' : 'English';
  const modeInstruction = body.mode === 'study'
    ? 'The user selected Study Mode. Teach interactively with clear short steps and examples, and ask a brief comprehension question when useful.'
    : '';
  const systemMessage = {
    role: 'system',
    content: `You are J.A.R.V.I.S., a helpful, concise assistant. Reply in ${language} unless the user clearly asks for another language. Be honest about uncertainty and never claim to have performed actions you cannot perform. ${modeInstruction}`,
  };

  if (process.env.AI_PROVIDER === 'ollama' || process.env.OLLAMA_BASE_URL) {
    const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const model = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
    let upstream;
    try {
      upstream = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [systemMessage, ...messages], stream: false }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw Object.assign(new Error('Local Ollama is unavailable. Start Ollama on the server host and confirm it listens on port 11434.'), {
        status: error.name === 'TimeoutError' ? 504 : 503,
      });
    }

    if (!upstream.ok) {
      throw Object.assign(new Error(`Local Ollama returned HTTP ${upstream.status}. Check that the model is installed and running.`), { status: 502 });
    }
    const data = await upstream.json();
    const content = data.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw Object.assign(new Error('Local model returned an empty response.'), { status: 502 });
    }
    sendJson(response, 200, { reply: content.trim(), provider: `Ollama / ${model}` });
    return;
  }

  if (process.env.AI_API_KEY) {
    const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.AI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        messages: [systemMessage, ...messages],
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!upstream.ok) {
      throw Object.assign(new Error(`AI provider returned HTTP ${upstream.status}. Check server provider settings.`), { status: 502 });
    }
    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw Object.assign(new Error('AI provider returned an empty response.'), { status: 502 });
    }
    sendJson(response, 200, { reply: content.trim(), provider: process.env.AI_MODEL || 'configured AI provider' });
    return;
  }

  throw Object.assign(new Error('No AI provider is configured. Set OLLAMA_BASE_URL for a local Ollama model, or configure AI_API_KEY and AI_MODEL on the server.'), { status: 503 });
}

async function inspectOllama() {
  const selected = process.env.AI_PROVIDER === 'ollama' || Boolean(process.env.OLLAMA_BASE_URL);
  if (!selected) return null;
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
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
  const systemLoad = loadavg()[0];
  const cpuCount = availableParallelism();

  return {
    source: process.env.CODESPACE_NAME ? 'Codespaces container' : `${platform()} server`,
    cpuLoad1mPercent: Math.round(Math.min(100, (systemLoad / cpuCount) * 100)),
    cpuCount,
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

async function handleSearch(url, response) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query || query.length > 200) {
    throw Object.assign(new Error('Enter a search query of 1 to 200 characters.'), { status: 400 });
  }

  const searchUrl = new URL('https://api.duckduckgo.com/');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('no_html', '1');
  searchUrl.searchParams.set('skip_disambig', '1');

  let data;
  try {
    const upstream = await fetch(searchUrl, { signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    data = await upstream.json();
  } catch {
    throw Object.assign(new Error('Internet search is temporarily unavailable. Check your connection and try again.'), { status: 502 });
  }

  const results = [];
  if (data.AbstractURL && data.AbstractText) {
    results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL });
  }
  flattenTopics(data.RelatedTopics, results);

  sendJson(response, 200, {
    query,
    source: 'DuckDuckGo Instant Answer',
    results,
    notice: results.length ? null : 'No instant-answer results were returned. This endpoint does not provide comprehensive web results.',
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
    if (filePath.endsWith('service-worker.js')) headers['service-worker-allowed'] = '/';
    response.writeHead(200, headers);
    response.end(content);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const ollama = await inspectOllama();
        const aiConfigured = Boolean(process.env.AI_API_KEY || ollama);
        sendJson(response, 200, {
          aiConfigured,
          aiAvailable: ollama ? ollama.available && ollama.modelInstalled : Boolean(process.env.AI_API_KEY),
          ollamaAvailable: ollama?.available ?? null,
          modelInstalled: ollama?.modelInstalled ?? null,
          model: ollama?.model ?? process.env.AI_MODEL ?? null,
          accessRequired: Boolean(process.env.APP_ACCESS_TOKEN) || process.env.NODE_ENV === 'production',
          accessConfigured: Boolean(process.env.APP_ACCESS_TOKEN),
          search: 'DuckDuckGo Instant Answer',
          voice: 'Browser Web Speech API when available',
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
      sendJson(response, status, { error: error.message || 'The request could not be completed.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createAppServer().listen(port, '0.0.0.0', () => {
    console.log(`J.A.R.V.I.S. ready at http://localhost:${port}`);
  });
}