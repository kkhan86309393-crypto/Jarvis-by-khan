import { translateUiText } from './ui-localization.js';

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readArticleUrl(value) {
  const rawUrl = readText(value);
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname
      || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function normalizeSourceResults(data, limit = 8) {
  if (!Array.isArray(data?.results) || !Number.isInteger(limit) || limit < 1) return [];
  const source = readText(data.source);
  const seenTitles = new Set();
  const normalized = [];

  for (const result of data.results) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
    const title = readText(result.title);
    const resultSource = readText(result.source) || source;
    if (!title || !resultSource) continue;

    const titleKey = title.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);

    const date = readText(
      result.date
      || result.publishedAt
      || result.datePublished
      || result.published_date,
    );
    normalized.push({
      title,
      source: resultSource,
      date,
      snippet: readText(result.snippet),
      url: readArticleUrl(result.url),
    });
    if (normalized.length >= limit) break;
  }
  return normalized;
}

export function renderSearchResults(container, data, language = 'en') {
  const document = container.ownerDocument;
  const results = normalizeSourceResults(data, 8);

  if (data?.source) {
    const source = document.createElement('span');
    source.className = 'message-source';
    source.dataset.noTranslate = '';
    source.textContent = readText(data.source);
    if (source.textContent) container.append(source);
  }

  for (const result of results) {
    const item = document.createElement('div');
    item.className = 'search-result';
    const title = result.url ? document.createElement('a') : document.createElement('strong');
    if (result.url) {
      title.href = result.url;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
      title.referrerPolicy = 'no-referrer';
    }
    title.dataset.noTranslate = '';
    title.textContent = result.title;
    item.append(title);

    const metadata = document.createElement('div');
    metadata.className = 'search-result-metadata';
    if (result.source && result.source !== readText(data?.source)) {
      appendMetadata(metadata, 'Source', result.source, language);
    }
    if (result.date) {
      appendMetadata(metadata, 'Date', result.date, language);
    }
    if (!result.url) {
      const unavailable = document.createElement('span');
      unavailable.textContent = translateUiText('Article link unavailable', language);
      metadata.append(unavailable);
    }
    if (metadata.childElementCount) item.append(metadata);

    if (result.snippet) {
      const snippet = document.createElement('p');
      snippet.dataset.noTranslate = '';
      snippet.textContent = result.snippet;
      item.append(snippet);
    }
    container.append(item);
  }

  if (!results.length) {
    const notice = document.createElement('p');
    notice.className = 'search-notice';
    notice.textContent = translateUiText(
      data?.notice || 'No source-backed search results were returned.',
      language,
    );
    container.append(notice);
  }
  return results;
}

function appendMetadata(container, label, value, language) {
  if (!value) return;
  const item = container.ownerDocument.createElement('span');
  item.className = 'briefing-metadata-item';
  const labelNode = container.ownerDocument.createElement('strong');
  labelNode.textContent = `${translateUiText(label, language)}: `;
  const valueNode = container.ownerDocument.createElement('span');
  valueNode.dataset.noTranslate = '';
  valueNode.textContent = value;
  item.append(labelNode, valueNode);
  container.append(item);
}

export function renderBriefingResults(container, data, language = 'en') {
  const document = container.ownerDocument;
  const results = normalizeSourceResults(data, 3);
  container.replaceChildren();

  if (!results.length) {
    const notice = document.createElement('p');
    notice.className = 'briefing-state';
    notice.textContent = translateUiText(
      data?.notice || 'No source-backed headlines were returned.',
      language,
    );
    container.append(notice);
    return 0;
  }

  for (const result of results) {
    const story = document.createElement('article');
    story.className = 'briefing-story';
    const heading = document.createElement('h3');
    heading.className = 'briefing-story-title';
    heading.dataset.noTranslate = '';
    if (result.url) {
      const link = document.createElement('a');
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.textContent = result.title;
      heading.append(link);
    } else {
      heading.textContent = result.title;
    }
    story.append(heading);

    const metadata = document.createElement('div');
    metadata.className = 'briefing-story-metadata';
    appendMetadata(metadata, 'Source', result.source, language);
    appendMetadata(metadata, 'Date', result.date, language);
    if (!result.url) {
      const unavailable = document.createElement('span');
      unavailable.className = 'briefing-link-unavailable';
      unavailable.textContent = translateUiText('Article link unavailable', language);
      metadata.append(unavailable);
    }
    if (metadata.childElementCount) story.append(metadata);

    if (result.snippet) {
      const snippet = document.createElement('p');
      snippet.className = 'briefing-story-snippet';
      snippet.dataset.noTranslate = '';
      snippet.textContent = result.snippet;
      story.append(snippet);
    }
    container.append(story);
  }
  return results.length;
}

export function renderBriefingState(container, message, language = 'en', state = 'status') {
  const status = container.ownerDocument.createElement('p');
  status.className = `briefing-state is-${state}`;
  status.setAttribute('role', state === 'error' ? 'alert' : 'status');
  status.textContent = translateUiText(message, language);
  container.replaceChildren(status);
}
