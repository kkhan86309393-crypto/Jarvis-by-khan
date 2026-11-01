import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

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

test('mobile command bar cascade stays sticky above navigation with page clearance', () => {
  const commandRules = rules.filter((rule) => rule.selector === 'body.new-interface .dashboard-commandbar');
  const stickyRules = commandRules.filter((rule) => readDeclarations([rule]).get('position') === 'sticky');
  assert.equal(stickyRules.length, 1, 'there should be one consolidated sticky rule');
  assert.ok(stickyRules[0].media.some((media) => /max-width:\s*780px/.test(media)));

  const mobileRules = commandRules.filter((rule) =>
    rule.media.length === 0 || rule.media.every((media) => /max-width:\s*780px/.test(media)),
  );
  const mobileCascade = readDeclarations(mobileRules);
  assert.equal(mobileCascade.get('position'), 'sticky');
  assert.equal(mobileCascade.get('bottom'), 'calc(66px + env(safe-area-inset-bottom))');
  assert.equal(mobileCascade.get('z-index'), '8');

  const desktopRules = commandRules.filter((rule) => rule.media.length === 0);
  const desktopCascade = readDeclarations(desktopRules);
  assert.equal(desktopCascade.has('position'), false, 'desktop should retain normal-flow positioning');
  assert.equal(desktopCascade.has('z-index'), false, 'desktop should retain the default stacking level');

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
  assert.equal(
    readDeclarations(mobileMainFrame).get('padding'),
    '7px 0 calc(72px + env(safe-area-inset-bottom))',
    'dashboard scroll area should clear the fixed navigation',
  );
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
