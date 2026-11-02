import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

function readCssRules(source) {
  const rules = [];
  const stack = [];
  let segmentStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '{') {
      stack.push({
        header: source.slice(segmentStart, index).trim(),
        contentStart: index + 1,
      });
      segmentStart = index + 1;
    } else if (source[index] === '}') {
      const block = stack.pop();
      if (!block) continue;
      if (!block.header.startsWith('@')) {
        rules.push({
          selector: block.header,
          declarations: source.slice(block.contentStart, index),
          media: stack.filter((parent) => parent.header.startsWith('@media')).map((parent) => parent.header),
        });
      }
      segmentStart = index + 1;
    } else if (source[index] === ';' && stack.length === 0) {
      segmentStart = index + 1;
    }
  }

  return rules;
}

function readDeclarations(rules) {
  const declarations = new Map();
  for (const rule of rules) {
    for (const declaration of rule.declarations.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
  return declarations;
}

const rules = readCssRules(styles);

test('mobile Home scrolls and keeps the command bar above navigation', () => {
  const commandRules = rules.filter((rule) => rule.selector === 'body.new-interface .dashboard-commandbar');
  const mobileRules = commandRules.filter((rule) =>
    rule.media.length === 0 || rule.media.every((media) => /max-width:\s*780px/.test(media)),
  );
  const mobileCascade = readDeclarations(mobileRules);
  assert.equal(mobileCascade.get('position'), 'fixed');
  assert.match(mobileCascade.get('bottom'), /60px/);
  assert.equal(mobileCascade.get('z-index'), '8');

  const desktopRules = commandRules.filter((rule) => rule.media.length === 0);
  const desktopCascade = readDeclarations(desktopRules);
  assert.doesNotMatch(styles.slice(0, styles.indexOf('@media (max-width: 780px)')), /body\.new-interface \.dashboard-commandbar\s*\{[^}]*position:\s*(sticky|fixed)/);

  const mobileNavigation = rules.filter((rule) => rule.selector === '.mobile-nav');
  const fixedNavigation = readDeclarations(mobileNavigation);
  assert.equal(fixedNavigation.get('position'), 'fixed');
  assert.equal(fixedNavigation.get('z-index'), '9');
  assert.equal(fixedNavigation.get('height'), 'calc(66px + env(safe-area-inset-bottom))');

  const newInterfaceNavigation = rules.filter((rule) => rule.selector === 'body.new-interface .mobile-nav');
  const navigationCascade = readDeclarations(newInterfaceNavigation);
  assert.equal(navigationCascade.get('height'), 'calc(60px + env(safe-area-inset-bottom))');

  const mobileMainFrame = rules.filter((rule) =>
    rule.selector === 'body.new-interface .main-frame'
    && (rule.media.length === 0 || rule.media.every((media) => /max-width:\s*780px/.test(media))),
  );
  assert.match(
    readDeclarations(mobileMainFrame).get('padding') || '',
    /132px/,
    'dashboard scroll area should clear the fixed navigation',
  );
});

test('mobile Home keeps cards reachable and portrait visible', () => {
  const mobileRules = rules.filter((rule) => rule.media.some((media) => /max-width:\s*780px/.test(media)));
  assert.doesNotMatch(styles, /body\.new-interface,\s*body\.new-interface \.app-shell\s*\{[^}]*height:\s*100dvh;\s*overflow:\s*hidden;/);
  assert.match(styles, /grid-template-rows:\s*auto\s+auto\s+auto\s+auto/);
  const hiddenHero = readDeclarations(mobileRules.filter((rule) => rule.selector.includes('.avatar-model-controls')));
  assert.match(hiddenHero.get('display'), /^none(?: !important)?$/);
  assert.doesNotMatch(styles, /body\.new-interface \.right-rail\s*\{[^}]*display:\s*none;/);
  assert.doesNotMatch(styles, /body\.new-interface \.holo-stage\.is-avatar-active \.avatar-frame\s*\{\s*opacity:\s*0;/);
  assert.ok(styles.includes('@media (max-width: 359px)'));
  assert.match(styles, /-webkit-line-clamp:\s*2/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /overflow-x:\s*clip/);
  assert.match(styles, /width:\s*78%;[\s\S]*height:\s*88%;[\s\S]*opacity:\s*1;/);
  for (const selector of [
    'id="system-panel"',
    'aria-labelledby="quick-title"',
    'id="briefing-title"',
    'id="upload-title"',
    'data-app-hub',
    'aria-labelledby="ai-status-title"',
    'id="activity-panel"',
    'id="dashboard-message"',
    'id="ai-avatar"',
  ]) {
    assert.match(html, new RegExp(selector), `mobile Home should contain ${selector}`);
  }
  assert.match(html, /placeholder="Ask J\.A\.R\.V\.I\.S\."/);
});

test('mobile chat and settings controls reflow within narrow touch viewports', () => {
  const mobileRules = rules.filter((rule) =>
    rule.media.some((media) => /max-width:\s*780px/.test(media)),
  );
  const composerActions = readDeclarations(mobileRules.filter((rule) => rule.selector === '.composer-actions'));
  const composerTools = readDeclarations(mobileRules.filter((rule) => rule.selector === '.composer-tools'));
  const composerButtons = readDeclarations(mobileRules.filter((rule) => rule.selector === '.composer-tools .tool-button'));
  const settingsDialog = readDeclarations(mobileRules.filter((rule) => rule.selector === '.settings-dialog'));
  const settingsRows = readDeclarations(mobileRules.filter((rule) => rule.selector === '.setting-row'));
  const settingControls = readDeclarations(mobileRules.filter((rule) =>
    rule.selector.includes('.setting-row select')
    && rule.selector.includes('.range-row input'),
  ));

  assert.equal(composerActions.get('flex-wrap'), 'wrap');
  assert.equal(composerTools.get('width'), '100%');
  assert.equal(composerTools.get('flex-wrap'), 'wrap');
  assert.equal(composerButtons.get('min-height'), '44px');
  assert.equal(settingsDialog.get('width'), 'min(510px, calc(100vw - 24px))');
  assert.equal(settingsDialog.get('max-height'), 'calc(100dvh - 24px)');
  assert.equal(settingsRows.get('flex-direction'), 'column');
  assert.equal(settingControls.get('width'), '100%');
  assert.equal(settingControls.get('min-height'), '44px');
});
