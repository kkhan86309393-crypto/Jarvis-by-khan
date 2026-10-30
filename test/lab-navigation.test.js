import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { switchWorkspaceView } from '../public/interface-switcher.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function createViewState(startingView) {
  const classes = new Set(startingView === 'dashboard' ? ['new-interface'] : ['chat-view']);
  const body = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      remove(...names) {
        for (const name of names) classes.delete(name);
      },
    },
  };
  const dashboard = { hidden: startingView !== 'dashboard' };
  const conversation = { hidden: startingView !== 'chat' };
  const lab = { hidden: true };
  const navigationItems = ['dashboard', 'chat', 'lab'].map((nav) => ({
    dataset: { nav },
    isCurrent: nav === startingView,
    classList: {
      toggle(name, enabled) {
        if (name === 'is-current') this.owner.isCurrent = enabled;
      },
      owner: null,
    },
  }));
  for (const item of navigationItems) item.classList.owner = item;

  return {
    body,
    classes,
    dashboard,
    conversation,
    lab,
    navigationItems,
  };
}

function switchView(state, view) {
  switchWorkspaceView(view, {
    dashboard: state.dashboard,
    conversation: state.conversation,
    lab: state.lab,
    body: state.body,
    navigationItems: state.navigationItems,
  });
}

test('opens LAB from either JARVIS view and returns without changing the saved workspace view', () => {
  for (const startingView of ['dashboard', 'chat']) {
    const state = createViewState(startingView);

    switchView(state, 'lab');
    assert.equal(state.lab.hidden, false);
    assert.equal(state.dashboard.hidden, true);
    assert.equal(state.conversation.hidden, true);
    assert.equal(state.classes.has('jarvis-lab-view'), true);
    assert.equal(state.navigationItems.find(({ dataset }) => dataset.nav === 'lab').isCurrent, true);

    switchView(state, startingView);
    assert.equal(state.lab.hidden, true);
    assert.equal(state.dashboard.hidden, startingView !== 'dashboard');
    assert.equal(state.conversation.hidden, startingView !== 'chat');
    assert.equal(state.classes.has('jarvis-lab-view'), false);
    assert.equal(state.classes.has('new-interface'), startingView === 'dashboard');
    assert.equal(state.classes.has('chat-view'), startingView === 'chat');
  }
});

test('provides bottom navigation launchers, a return control, and four interface-only modules', () => {
  const primaryNavigation = html.match(/<nav class="primary-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const mobileNavigation = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const labStart = html.indexOf('<section class="jarvis-lab"');
  const labEnd = html.indexOf('</main>', labStart);
  const labScreen = html.slice(labStart, labEnd);

  assert.match(primaryNavigation, /data-nav="lab"/);
  assert.match(mobileNavigation, /data-nav="lab"/);
  assert.match(html, /id="lab-return-button"/);
  assert.match(labScreen, /<h2>Personalize<\/h2>/);
  assert.match(labScreen, /<h2>AI Modify<\/h2>/);
  assert.match(labScreen, /data-lab-module="ai-modify" role="button"/);
  assert.match(labScreen, /<h2>Code Studio<\/h2>/);
  assert.match(labScreen, /data-lab-module="code-studio" role="button"/);
  assert.match(labScreen, /id="code-studio-panel"/);
  assert.match(labScreen, /<h2>Extensions<\/h2>/);
  assert.match(labScreen, /id="lab-safety-panel"/);
  assert.match(labScreen, /PROJECT LOCKED/);
  assert.match(labScreen, /data-lab-module="extensions" role="button"[^>]*aria-controls="extensions-panel"/);
  assert.match(labScreen, /id="extensions-panel"/);
  assert.match(labScreen, /AI plan generation is not connected\. Requests stay in this browser/);
  assert.match(labScreen, /data-lab-module="personalize" role="button"/);
  assert.match(labScreen, /name="lab-theme" value="system"/);
  assert.match(labScreen, /name="lab-accent" value="violet"/);
  assert.match(labScreen, /id="lab-density-select"/);
  assert.match(labScreen, /id="lab-voice-select"/);
  assert.match(labScreen, /name="lab-widget-system"/);
  assert.match(labScreen, /id="personalize-preview"/);
  assert.match(labScreen, /id="personalize-preview-voice"/);
  assert.match(labScreen, /id="personalize-apply"/);
  assert.match(labScreen, /id="personalize-reset"/);
  assert.match(labScreen, /id="personalize-cancel-footer"/);
  assert.match(appSource, /destination === 'lab'[\s\S]*?openJarvisLab\(\)/);
  assert.match(appSource, /lab-return-button'\)\.addEventListener\('click', returnToJarvisWorkspace\)/);
  assert.match(appSource, /savedPreferences = saveLabPreferences\(personalizeDraft, localStorage\)/);
  assert.match(appSource, /labPreferences: loadLabPreferences\(localStorage\)/);
  assert.match(appSource, /applyLabPreferences\(state\.labPreferences, document\)/);
  assert.match(appSource, /Applied LAB voice overrides output while selected/);
  assert.match(appSource, /state\.labPreferences\.voiceURI \|\| state\.preferences\.voiceURI/);
  assert.match(appSource, /labSafetyPanel\.hidden = true/);
  assert.match(appSource, /labSafetyPanel\.hidden = false/);
});

test('keeps the LAB layout responsive at the existing mobile breakpoint', () => {
  assert.match(styles, /\.lab-module-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.personalize-content \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(260px, \.85fr\)/);
  assert.match(styles, /@media \(max-width: 780px\) \{[\s\S]*?\.lab-module-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /@media \(max-width: 780px\) \{[\s\S]*?\.personalize-content \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.ai-modify-panel \{ display: grid/);
  assert.match(styles, /\.code-studio-panel \{ display: grid/);
  assert.match(styles, /\.extensions-panel \{ display: grid/);
  assert.match(styles, /\.lab-safety-panel \{ display: grid/);
  assert.match(styles, /\.extensions-list \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 780px\) \{[\s\S]*?\.ai-modify-review-actions \{ align-items: stretch; flex-direction: column;/);
  assert.match(styles, /@media \(max-width: 780px\) \{[\s\S]*?\.code-studio-toolbar \{ align-items: flex-start; flex-direction: column;/);
  assert.match(styles, /@media \(max-width: 780px\) \{[\s\S]*?\.extensions-list \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /@media \(max-width: 780px\) \{[\s\S]*?\.lab-safety-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
});
