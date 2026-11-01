import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  normalizeSourceResults,
  renderBriefingResults,
  renderBriefingState,
  renderSearchResults,
} from '../public/news-briefing.js';
import { translateUiText } from '../public/ui-localization.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

class TestElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.textContent = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  get childElementCount() {
    return this.children.length;
  }
}

function createContainer() {
  const document = { createElement: (tagName) => new TestElement(tagName, document) };
  const container = new TestElement('div', document);
  return container;
}

const sourcedData = {
  source: 'Example News Index',
  results: [
    {
      title: 'Source-backed headline',
      snippet: 'Source excerpt.',
      url: 'https://news.example/article',
      date: '2026-10-30',
    },
  ],
};

test('briefing renders provided title, source, date, excerpt, and safe article link', () => {
  const container = createContainer();

  assert.equal(renderBriefingResults(container, sourcedData, 'en'), 1);
  const [story] = container.children;
  const [heading, metadata, snippet] = story.children;
  const [link] = heading.children;

  assert.equal(story.className, 'briefing-story');
  assert.equal(link.textContent, 'Source-backed headline');
  assert.equal(link.href, 'https://news.example/article');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.referrerPolicy, 'no-referrer');
  assert.deepEqual(metadata.children.map((item) => item.children[1].textContent), [
    'Example News Index',
    '2026-10-30',
  ]);
  assert.deepEqual(metadata.children.map((item) => item.children[0].textContent), [
    'Source: ',
    'Date: ',
  ]);
  assert.equal(snippet.textContent, 'Source excerpt.');
});

test('missing and invalid article URLs never render a broken or unsafe link', () => {
  const container = createContainer();
  renderBriefingResults(container, {
    source: 'Verified source',
    results: [
      { title: 'Missing URL headline', url: '', source: 'Publisher' },
      { title: 'Invalid URL headline', url: 'javascript:alert(1)' },
      { title: 'Credential URL headline', url: 'https://user:pass@news.example/path' },
    ],
  });

  assert.equal(container.children.length, 3);
  for (const story of container.children) {
    const [heading, metadata] = story.children;
    assert.equal(heading.children.length, 0);
    assert.ok(metadata.children.some((item) => item.className === 'briefing-link-unavailable'));
  }
});

test('duplicate headlines are removed and only results with a source are retained', () => {
  const results = normalizeSourceResults({
    source: 'Search provider',
    results: [
      { title: '  Example   headline ', url: 'https://news.example/1' },
      { title: 'example headline', url: 'https://news.example/2' },
      { title: 'Another headline', source: 'Publisher', url: 'javascript:alert(1)' },
      { title: '', url: 'https://news.example/empty' },
    ],
  });

  assert.equal(results.length, 2);
  assert.deepEqual(results.map(({ title }) => title), ['Example   headline', 'Another headline']);
  assert.equal(results[1].source, 'Publisher');
  assert.equal(results[1].url, '');

  assert.deepEqual(normalizeSourceResults({
    results: [{ title: 'No source', url: 'https://example.com' }],
  }), []);
});

test('search result rendering deduplicates items and marks unavailable links without anchors', () => {
  const container = createContainer();
  const results = renderSearchResults(container, {
    source: 'Search provider',
    results: [
      { title: 'Search headline', url: 'https://news.example/story', datePublished: '2026-10-30' },
      { title: ' search headline ', url: 'javascript:alert(1)' },
      { title: 'Unlinked headline', url: 'not a URL', source: 'Publisher' },
    ],
  }, 'hi');

  assert.equal(results.length, 2);
  assert.equal(container.children.length, 3);
  assert.equal(container.children[0].className, 'message-source');
  const [linked, unlinked] = container.children.slice(1);
  assert.equal(linked.children[0].href, 'https://news.example/story');
  assert.equal(linked.children[1].children[0].children[1].textContent, '2026-10-30');
  assert.equal(unlinked.children[0].tagName, 'STRONG');
  assert.equal(unlinked.children[1].children[0].children[0].textContent, 'स्रोत: ');
  assert.equal(unlinked.children[1].children[0].children[1].textContent, 'Publisher');
  assert.equal(unlinked.children[1].children[1].textContent, 'लेख लिंक उपलब्ध नहीं');
});

test('briefing empty, loading, and error states have clear localized text and semantics', () => {
  const empty = createContainer();
  assert.equal(renderBriefingResults(empty, { source: 'Provider', results: [] }, 'hi'), 0);
  assert.equal(empty.children[0].textContent, 'स्रोतों से जुड़ी कोई सुर्ख़ी नहीं मिली।');

  const loading = createContainer();
  renderBriefingState(loading, 'Searching available web sources...', 'hi');
  assert.equal(loading.children[0].textContent, 'उपलब्ध वेब स्रोत खोजे जा रहे हैं…');
  assert.equal(loading.children[0].attributes.get('role'), 'status');

  const error = createContainer();
  renderBriefingState(
    error,
    'Internet search is temporarily unavailable. DuckDuckGo Instant Answers and Wikipedia search could not be reached. Check your connection and try again.',
    'hi',
    'error',
  );
  assert.equal(error.children[0].textContent, 'इंटरनेट खोज अस्थायी रूप से उपलब्ध नहीं है। DuckDuckGo Instant Answers और Wikipedia खोज से संपर्क नहीं हो सका। कनेक्शन जाँचकर फिर कोशिश करें।');
  assert.equal(error.children[0].attributes.get('role'), 'alert');
  assert.equal(error.children[0].className, 'briefing-state is-error');

  const searchEmpty = createContainer();
  renderSearchResults(searchEmpty, { source: 'Provider', results: [] }, 'hi');
  assert.equal(searchEmpty.children[1].textContent, 'स्रोतों से जुड़े कोई खोज परिणाम नहीं मिले।');
  assert.equal(
    translateUiText('Searching available web sources...', 'hi'),
    'उपलब्ध वेब स्रोत खोजे जा रहे हैं…',
  );
  assert.equal(
    translateUiText('The web search timed out. Check your connection or AI provider, then try again.', 'hi'),
    'वेब खोज का समय समाप्त हुआ। कनेक्शन या AI प्रदाता जाँचकर फिर कोशिश करें।',
  );
  const providerStatus = 'Retrieved results from Wikipedia search (Hindi). Results are shown as retrieved; no AI summary is implied.';
  const hindiStatus = translateUiText(providerStatus, 'hi');
  assert.equal(translateUiText(hindiStatus, 'en'), providerStatus);
  assert.match(app, /setDashboardChatState\('thinking', 'Searching available web sources\.'\)/);
  assert.match(app, /setDashboardChatState\('error', message\)/);
});

test('briefing requires source-backed results and does not invent missing metadata', () => {
  const container = createContainer();
  renderBriefingResults(container, {
    results: [{ title: 'Unattributed title', snippet: 'No provenance', date: '2026-10-30' }],
  });
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].className, 'briefing-state');

  renderBriefingResults(container, {
    source: 'Verified source',
    results: [{ title: 'Headline only' }],
  });
  const [story] = container.children;
  assert.equal(story.children[0].textContent, 'Headline only');
  assert.equal(story.children[0].children.length, 0);
  assert.equal(story.children[1].children.length, 2);
  assert.equal(story.children[1].children[0].children[1].textContent, 'Verified source');
});

test('search and briefing UI messages localize while server notices stay source-derived', () => {
  const container = createContainer();
  renderBriefingResults(container, {
    source: 'Example Index',
    results: [],
    notice: 'No results were found by DuckDuckGo Instant Answers or Wikipedia search.',
  }, 'hi');
  assert.equal(container.children[0].textContent, 'DuckDuckGo Instant Answers या Wikipedia खोज में कोई परिणाम नहीं मिला।');
  assert.match(app, /translateUiText\([\s\S]*?No source-backed search results were returned\./);
  assert.match(app, /renderBriefingState\([\s\S]*?Searching available web sources/);
  assert.match(app, /renderBriefingState\([\s\S]*?getRequestErrorMessage\(error, 'news briefing'\)/);
});

test('existing dashboard section order and local UI integration remain intact', () => {
  const briefingIndex = html.indexOf('class="dashboard-panel dashboard-accordion briefing-panel"');
  const uploadIndex = html.indexOf('class="dashboard-panel dashboard-accordion upload-panel"');
  assert.ok(briefingIndex >= 0);
  assert.ok(uploadIndex > briefingIndex);
  assert.match(html, /id="briefing-results"[^>]*aria-live="polite"/);
  assert.match(app, /normalizeSourceResults\(data, 8\)/);
  assert.match(app, /renderSearchResults\(wrapper, message\.data, state\.preferences\.language\)/);
  assert.match(app, /renderBriefingResults\(elements\.briefingResults, data, state\.preferences\.language\)/);
});

test('source retrieval remains independent while AI summaries use the selected provider chat route', () => {
  const search = app.match(/async function searchWeb\(query\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const summarize = app.match(/function summarizeSearchResults\(data, prompt\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const sendChat = app.slice(app.indexOf('async function sendChat('), app.indexOf('\nfunction retryLastChat', app.indexOf('async function sendChat(')));

  assert.match(search, /fetch\(`\/api\/search\?/);
  assert.doesNotMatch(search, /state\.aiConfigured|\/api\/chat|createSearchSummaryPrompt/);
  assert.match(summarize, /sendChat\(prompt/);
  assert.match(sendChat, /provider = elements\.aiProvider\.value/);
});
