import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const navigationStart = app.indexOf('function handleNavigation(event)');
const navigationEnd = app.indexOf('\nfunction handleDashboardFeature(event)', navigationStart);
const navigationHandler = app.slice(navigationStart, navigationEnd);

const expectedRoutes = {
  lab: { source: /openJarvisLab\(\)/ },
  dashboard: { source: /setWorkspaceView\('dashboard'\)/ },
  chat: { source: /setWorkspaceView\('chat'\)|dashboardChatPanel/ },
  voice: { source: /startListeningFromUserGesture\(\)/ },
  more: { source: /moreNavigationDialog\.showModal\(\)/, target: 'id="more-navigation-dialog"' },
  history: { source: /showHistory\(\)/, target: 'id="history-dialog"' },
  memory: { source: /openSmartMemoryPanel\(\)/ },
  files: { source: /fileSearchDialog\.showModal\(\)/, target: 'id="file-search-dialog"' },
  applications: { source: /applicationDialog\.showModal\(\)/, target: 'id="application-dialog"' },
  study: { source: /toggleStudyMode\(\)/ },
  productivity: { source: /\.focus-timer-row/ },
  system: { source: /#system-title/ },
  news: { source: /\.briefing-panel[\s\S]*?loadBriefing\(\)/ },
  settings: { source: /openSettings\(\)/, target: 'id="settings-dialog"' },
  activity: { source: /#activity-panel/ },
};

function destinations(markup) {
  return [...new Set([...markup.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1]))].sort();
}

test('every navigation target in the UI has a corresponding route and every route is reachable', () => {
  assert.notEqual(navigationStart, -1, 'Expected handleNavigation to exist');
  assert.notEqual(navigationEnd, -1, 'Expected handleNavigation to end before dashboard feature handling');
  const actualRoutes = [...navigationHandler.matchAll(/destination === '([^']+)'/g)]
    .map((match) => match[1])
    .filter((destination, index, matches) => matches.indexOf(destination) === index)
    .sort();
  const actualTargets = destinations(html);

  assert.deepEqual(actualTargets, Object.keys(expectedRoutes).sort());
  assert.deepEqual(actualRoutes, Object.keys(expectedRoutes).sort());
  for (const [destination, route] of Object.entries(expectedRoutes)) {
    assert.match(navigationHandler, route.source, `Expected ${destination} to dispatch to its intended view/action`);
    if (route.target) assert.ok(html.includes(route.target), `${destination} target ${route.target} is missing`);
  }
});

test('primary navigation keeps its established order and the More dialog contains its overflow destinations', () => {
  const primaryNav = html.match(/<nav class="primary-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const moreNav = html.match(/<dialog class="settings-dialog" id="more-navigation-dialog"[\s\S]*?<\/dialog>/)?.[0] || '';
  const primaryOrder = [...primaryNav.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(primaryOrder, [
    'dashboard', 'chat', 'voice', 'history', 'files', 'applications', 'study',
    'productivity', 'system', 'news', 'memory', 'activity', 'settings', 'lab',
  ]);
  assert.deepEqual(destinations(moreNav), [
    'activity', 'applications', 'files', 'history', 'memory', 'news', 'productivity', 'study', 'system',
  ]);
});

test('navigation route targets referenced by the handler exist in the rendered page', () => {
  for (const selector of [
    '#system-title',
    '#activity-panel',
    '.focus-timer-row',
    '.briefing-panel',
  ]) {
    const [kind, name] = selector.startsWith('#')
      ? ['id', selector.slice(1)]
      : ['class', selector.slice(1)];
    assert.match(html, new RegExp(`${kind}="[^"]*\\b${name}\\b[^"]*"`), `Missing navigation target ${selector}`);
  }
  assert.match(html, /data-nav="news" data-requires-full-access/);
});
