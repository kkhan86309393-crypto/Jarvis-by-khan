import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('keeps the Master Dashboard permanent and LAB separate from interface selection', () => {
  assert.match(html, /<body class="new-interface">/);
  assert.match(html, /id="dashboard-layout"/);
  assert.match(html, /id="conversation-view"[^>]*hidden/);
  assert.doesNotMatch(html, /New Interface|Old Interface|interface-switcher/);
  assert.doesNotMatch(appSource, /setWorkspaceView\(['"]chat['"]\)|interface-switcher/);
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
  assert.match(appSource, /labPreferences: loadLabPreferences\(getLocalStorageSafely\(\)\)/);
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
