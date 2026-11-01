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

test('globe projection lighting stays layered, viewport-bounded, and motion-accessible', async () => {
  const globeSelector = 'body.new-interface .holo-stage.is-globe-active';
  const platformSelector = `${globeSelector} .holo-platform`;
  const emitterSelector = `${globeSelector} .holo-emitter`;
  const beamSelector = `${globeSelector} .holo-emitter::before`;
  const raySelector = `${globeSelector} .holo-emitter::after`;
  const projectorRaySelector = `${globeSelector} .projector-ray`;
  const coreRaySelector = `${globeSelector} .projector-ray-core`;
  const canvasSelector = `${globeSelector} > .avatar-canvas`;
  const reducedMotionRules = rules.filter((rule) =>
    rule.media.some((media) => /prefers-reduced-motion:\s*reduce/.test(media)),
  );
  const globeStage = readDeclarations(rules.filter((rule) => rule.selector === globeSelector));
  const platform = readDeclarations(rules.filter((rule) =>
    rule.selector === platformSelector && rule.media.length === 0,
  ));
  const emitter = readDeclarations(rules.filter((rule) => rule.selector === emitterSelector));
  const mobilePlatform = readDeclarations(rules.filter((rule) =>
    rule.selector === platformSelector && rule.media.some((media) => /max-width:\s*780px/.test(media)),
  ));
  const beam = readDeclarations(rules.filter((rule) => rule.selector === beamSelector));
  const rays = readDeclarations(rules.filter((rule) => rule.selector === raySelector));
  const projectorRay = readDeclarations(rules.filter((rule) => rule.selector === projectorRaySelector));
  const coreRay = readDeclarations(rules.filter((rule) => rule.selector === coreRaySelector));
  const canvas = readDeclarations(rules.filter((rule) =>
    rule.selector === canvasSelector && rule.media.length === 0,
  ));
  const desktopCanvas = readDeclarations(rules.filter((rule) =>
    rule.selector === canvasSelector && rule.media.some((media) => /min-width:\s*781px/.test(media)),
  ));
  const reducedMotion = readDeclarations(reducedMotionRules.filter((rule) =>
    rule.selector.includes(`${globeSelector} .holo-emitter::after`),
  ));
  const reducedMotionProjectorRays = readDeclarations(reducedMotionRules.filter((rule) =>
    rule.selector.includes(`${globeSelector} .projector-ray`),
  ));
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.equal(globeStage.get('max-width'), 'min(100%, calc(100vw - 24px), 440px)');
  assert.match(platform.get('background'), /repeating-radial-gradient/);
  assert.equal(platform.get('width'), '84%');
  assert.equal(platform.get('height'), '28%');
  assert.equal(platform.get('bottom'), '-3%');
  assert.equal(platform.get('left'), '50%');
  assert.equal(platform.get('translate'), '-50% 0');
  assert.equal(platform.get('transform-origin'), 'center center');
  assert.equal(platform.get('z-index'), '8');
  assert.match(platform.get('transform'), /perspective\(760px\) rotateX\(64deg\)/);
  assert.match(platform.get('box-shadow'), /46%/);
  assert.match(platform.get('box-shadow'), /48px/);
  assert.equal(mobilePlatform.get('width'), 'min(84%, calc(100vw - 48px))');
  assert.equal(mobilePlatform.get('bottom'), '-3%');
  assert.equal(mobilePlatform.get('left'), '50%');
  assert.equal(mobilePlatform.get('translate'), '-50% 0');
  assert.match(beam.get('background'), /linear-gradient/);
  assert.equal(beam.get('width'), '42%');
  assert.equal(beam.get('height'), '238%');
  assert.equal(beam.get('left'), '50%');
  assert.equal(beam.get('bottom'), '29%');
  assert.equal(emitter.get('z-index'), '7');
  assert.equal(emitter.get('bottom'), '0');
  assert.equal(beam.get('clip-path'), 'polygon(0 0, 100% 0, 59% 100%, 41% 100%)');
  assert.equal(rays.get('left'), '50%');
  assert.equal(rays.get('width'), '76%');
  assert.equal(rays.get('clip-path'), 'polygon(0 0, 100% 0, 54% 100%, 46% 100%)');
  assert.match(rays.get('background'), /repeating-linear-gradient/);
  assert.equal(projectorRay.get('height'), '238%');
  assert.equal(projectorRay.get('bottom'), '29%');
  assert.equal(coreRay.get('width'), '18%');
  assert.equal(coreRay.get('opacity'), '.64');
  assert.match(readDeclarations(rules.filter((rule) =>
    rule.selector === `${globeSelector} .projector-ray-left,\n${globeSelector} .projector-ray-right`,
  )).get('background'), /repeating-linear-gradient/);
  assert.match(coreRay.get('background'), /radial-gradient/);
  assert.equal((html.match(/class="projector-ray projector-ray-(?:left|right|core)"/g) ?? []).length, 3);
  assert.match(html, /class="holo-emitter" aria-hidden="true">[\s\S]*projector-ray-core/);
  assert.match(platform.get('background'), /transparent 0 5\.2%/);
  assert.match(
    readDeclarations(rules.filter((rule) => rule.selector === `${platformSelector}::after`)).get('background'),
    /96%/,
    'platform aperture should have a bright central emitter without filling the beam opening',
  );
  assert.match(platform.get('background'), /68%/);
  assert.match(platform.get('background'), /81%/);
  assert.equal(globeStage.get('overflow'), 'visible');
  assert.equal(canvas.get('transform'), 'scale(1)');
  assert.equal(canvas.get('transform-origin'), 'center');
  assert.equal(canvas.get('pointer-events'), 'none');
  assert.equal(desktopCanvas.get('transform'), 'scale(1)');
  assert.equal(
    canvas.get('filter').includes('contrast(1.15)'),
    true,
  );
  assert.equal(reducedMotion.get('animation'), 'none !important');
  assert.equal(reducedMotionProjectorRays.get('animation'), 'none !important');
});

test('mobile globe geometry stays centered and fits 320px, 390px, and 740px viewports', async () => {
  const globeSelector = 'body.new-interface .holo-stage.is-globe-active';
  const orbitSelector = `${globeSelector} .orbit`;
  const orbitOneSelector = `${globeSelector} .orbit-one`;
  const orbitTwoSelector = `${globeSelector} .orbit-two`;
  const avatarSelector = `${globeSelector} .avatar-frame`;
  const portraitSelector = `${globeSelector} .portrait-artwork`;
  const controlsSelector = 'body.new-interface .holo-stage.is-globe-active ~ .avatar-model-controls';
  const mobileRules = rules.filter((rule) =>
    rule.media.some((media) => /max-width:\s*780px/.test(media))
    && !rule.media.some((media) => /max-height:\s*520px/.test(media)),
  );
  const stage = readDeclarations(mobileRules.filter((rule) => rule.selector === globeSelector));
  const orbit = readDeclarations(rules.filter((rule) => rule.selector === orbitSelector));
  const orbitOne = readDeclarations(rules.filter((rule) => rule.selector === orbitOneSelector));
  const orbitTwo = readDeclarations(rules.filter((rule) => rule.selector === orbitTwoSelector));
  const mobileOrbits = readDeclarations(mobileRules.filter((rule) =>
    rule.selector === `${globeSelector} .orbit-one,\n  ${globeSelector} .orbit-two`,
  ));
  const mobileDefaultOrbitOne = readDeclarations(mobileRules.filter((rule) =>
    rule.selector === 'body.new-interface .holo-stage .orbit-one',
  ));
  const mobileDefaultOrbitTwo = readDeclarations(mobileRules.filter((rule) =>
    rule.selector === 'body.new-interface .holo-stage .orbit-two',
  ));
  const avatar = readDeclarations(rules.filter((rule) => rule.selector === avatarSelector));
  const portrait = readDeclarations(rules.filter((rule) => rule.selector === portraitSelector));
  const desktopAvatar = readDeclarations(rules.filter((rule) =>
    rule.selector === avatarSelector && rule.media.length === 0,
  ));
  const mobileAvatar = readDeclarations(mobileRules.filter((rule) => rule.selector === avatarSelector));
  const controls = readDeclarations(rules.filter((rule) => rule.selector === controlsSelector));
  const expandedPresence = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .presence:has(.avatar-model-controls[open])'
    && rule.media.some((media) => /max-width:\s*780px/.test(media)),
  ));
  const expandedControls = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .avatar-model-controls[open]'
    && rule.media.some((media) => /max-width:\s*780px/.test(media)),
  ));
  const expandedStatePanel = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .avatar-hero:has(.avatar-model-controls[open]) > .state-panel'
    && rule.media.some((media) => /max-width:\s*780px/.test(media)),
  ));
  const expandedOptions = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .avatar-model-controls[open] .avatar-model-options'
    && rule.media.some((media) => /max-width:\s*780px/.test(media)),
  ));
  const expandedFullWidthControls = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .avatar-model-controls[open] #load-custom-avatar,\n  body.new-interface .avatar-model-controls[open] #avatar-audio-sync-button,\n  body.new-interface .avatar-model-controls[open] .avatar-model-options > p'
    && rule.media.some((media) => /max-width:\s*780px/.test(media)),
  ));
  const avatarCanvasRule = rules.find((rule) => rule.selector === '.holo-stage > .avatar-canvas');
  const globeCanvasRule = rules.find((rule) => rule.selector === '.holo-stage.is-globe-active > .avatar-canvas');
  const controlsMarkup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.equal(stage.get('width'), 'min(100%, calc(100vw - 24px), 440px)');
  assert.equal(stage.get('max-width'), 'min(100%, calc(100vw - 24px), 440px)');
  assert.equal(stage.get('margin-left'), '0');
  assert.equal(orbit.get('top'), '50%');
  assert.equal(orbit.get('left'), '50%');
  assert.equal(orbit.get('translate'), '-50% -50%');
  assert.equal(orbitOne.get('width'), '92%');
  assert.equal(orbitTwo.get('width'), '96%');
  assert.equal(mobileOrbits.get('width'), 'min(72%, calc(100vw - 48px))');
  assert.equal(mobileDefaultOrbitOne.get('width'), '76%');
  assert.equal(mobileDefaultOrbitTwo.get('width'), '78%');
  assert.equal(desktopAvatar.get('width'), '68%');
  assert.equal(desktopAvatar.get('height'), '94%');
  assert.equal(avatar.get('width'), '68%');
  assert.equal(avatar.get('height'), '94%');
  assert.equal(avatar.get('top'), '56%');
  assert.equal(portrait.get('inset'), '0 auto auto 50%');
  assert.equal(portrait.get('transform'), 'translateX(-50%)');
  assert.equal(mobileAvatar.get('width'), '68%');
  assert.equal(mobileAvatar.get('height'), '94%');
  assert.equal(controls.get('margin'), '2px auto 4px');
  assert.equal(controls.get('padding-top'), '0');
  assert.equal(expandedPresence.get('z-index'), '10');
  assert.equal(expandedControls.get('z-index'), '2');
  assert.equal(expandedStatePanel.get('z-index'), '1');
  assert.equal(expandedOptions.get('display'), 'grid');
  assert.equal(expandedOptions.get('grid-template-columns'), 'repeat(2, minmax(0, 1fr))');
  assert.equal(expandedOptions.get('max-height'), 'min(116px, calc(100dvh - 300px))');
  assert.equal(expandedOptions.get('overflow-y'), 'auto');
  assert.equal(expandedFullWidthControls.get('grid-column'), '1 / -1');
  assert.match(avatarCanvasRule.declarations, /inset:\s*auto;\s*top:\s*47%;\s*left:\s*50%/);
  assert.match(globeCanvasRule.declarations, /inset:\s*auto;\s*top:\s*0;\s*left:\s*0/);
  assert.ok(controlsMarkup.indexOf('id="holo-stage"') < controlsMarkup.indexOf('class="avatar-model-controls"'));
  assert.match(controlsMarkup, /<details class="avatar-model-controls">\s*<summary class="avatar-model-controls-summary">/);
  assert.match(controlsMarkup, /id="activate-3d-avatar" type="button"/);
  assert.match(controlsMarkup, /id="activate-holographic-earth" type="button"/);
  assert.match(controlsMarkup, /id="load-custom-avatar" type="button"/);
  assert.match(controlsMarkup, /id="avatar-audio-sync-button" type="button" aria-pressed="false"/);
  assert.match(controlsMarkup, /id="avatar-audio-sync-status" role="status" aria-live="polite"/);
  assert.match(controlsMarkup, /id="activate-holographic-earth"/);

  for (const viewportWidth of [320, 390, 740]) {
    const stageWidth = Math.min(viewportWidth - 36, 440);
    const orbitWidth = Math.min(stageWidth * 0.72, viewportWidth - 48);
    const platformWidth = Math.min(stageWidth * 0.84, viewportWidth - 48);

    assert.ok(stageWidth > 0 && stageWidth <= viewportWidth, `${viewportWidth}px stage must fit`);
    assert.ok(orbitWidth <= viewportWidth, `${viewportWidth}px orbit must fit`);
    assert.ok(platformWidth <= stageWidth, `${viewportWidth}px platform must fit and stay centered`);
  }
});

test('four-state assistant panel has distinct active icons and responsive reduced-motion styling', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const statePanelSelector = 'body.new-interface .state-panel';
  const stripSelector = `${statePanelSelector} .holo-state-strip`;
  const stateSelector = `${statePanelSelector} .holo-state`;
  const mobileRules = rules.filter((rule) =>
    rule.media.some((media) => /max-width:\s*780px/.test(media)),
  );
  const reducedMotionRules = rules.filter((rule) =>
    rule.media.some((media) => /prefers-reduced-motion:\s*reduce/.test(media)),
  );
  const strip = readDeclarations(rules.filter((rule) =>
    rule.selector === stripSelector && rule.media.length === 0,
  ));
  const state = readDeclarations(rules.filter((rule) =>
    rule.selector === stateSelector && rule.media.length === 0,
  ));
  const statePanelLayout = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .avatar-hero > .state-panel',
  ));
  const mobileState = readDeclarations(mobileRules.filter((rule) => rule.selector === stateSelector));
  const mobileStateIcon = readDeclarations(mobileRules.filter((rule) =>
    rule.selector === `${stateSelector} .state-icon`,
  ));
  const compactGlobeHeading = readDeclarations(mobileRules.filter((rule) =>
    rule.selector === 'body.new-interface .presence:has(.holo-stage.is-globe-active) .state-panel .panel-heading',
  ));
  const icon = readDeclarations(rules.filter((rule) =>
    rule.selector === `${stateSelector} .state-icon` && rule.media.length === 0,
  ));
  const stateCopy = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .state-panel .holo-state-copy',
  ));
  const stateSubtitle = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .state-panel .holo-state-subtitle',
  ));
  const narrowRules = rules.filter((rule) =>
    rule.media.some((media) => /max-width:\s*360px/.test(media)),
  );
  const narrowStrip = readDeclarations(narrowRules.filter((rule) =>
    rule.selector === stripSelector,
  ));
  const narrowState = readDeclarations(narrowRules.filter((rule) =>
    rule.selector === stateSelector,
  ));
  const narrowCopy = readDeclarations(narrowRules.filter((rule) =>
    rule.selector === 'body.new-interface .state-panel .holo-state-copy',
  ));
  const narrowSubtitle = readDeclarations(narrowRules.filter((rule) =>
    rule.selector === 'body.new-interface .state-panel .holo-state-subtitle',
  ));
  const narrowStateLabel = readDeclarations(narrowRules.filter((rule) =>
    rule.selector === 'body.new-interface .state-panel .holo-state > .holo-state-copy > span',
  ));
  const reducedMotion = readDeclarations(reducedMotionRules.filter((rule) =>
    rule.selector.includes(`${stateSelector} .state-icon`),
  ));

  assert.deepEqual([...html.matchAll(/data-holo-state="([^"]+)"/g)].map((match) => match[1]), [
    'listening', 'thinking', 'speaking', 'online',
  ]);
  assert.match(html, /id="holo-state-strip" role="group"/);
  assert.equal(strip.get('grid-template-columns'), 'repeat(4, minmax(0, 1fr))');
  assert.equal(strip.get('border-radius'), '11px');
  assert.equal(strip.get('border'), '0');
  assert.equal(state.get('min-height'), '82px');
  assert.equal(state.get('border-radius'), '0');
  assert.equal(statePanelLayout.get('grid-area'), 'auto');
  assert.equal(statePanelLayout.get('width'), '100%');
  assert.match(state.get('color'), /var\(--holo-state-color\)/);
  assert.equal((html.match(/id="holo-state-strip"/g) ?? []).length, 1);
  assert.ok(html.indexOf('id="holo-stage"') < html.indexOf('id="holo-state-strip"'));
  assert.ok(html.indexOf('id="activate-3d-avatar"') < html.indexOf('id="holo-state-strip"'));
  assert.ok(html.indexOf('id="holo-state-strip"') < html.indexOf('id="dashboard-command-form"'));
  for (const [name, subtitle] of [
    ['Listening', 'Waiting for your voice...'],
    ['Thinking', 'Analyzing...'],
    ['Speaking', 'Generating response...'],
    ['Online', 'Ready'],
  ]) {
    assert.ok(
      html.includes(`<span>${name}</span><small class="holo-state-subtitle"`),
      `${name} status should contain a subtitle`,
    );
    assert.ok(html.includes(`>${subtitle}</small>`), `${name} subtitle should be present`);
  }
  assert.match(html, /data-holo-state="thinking"><svg class="state-icon"[^>]*>[\s\S]*?<path d="M12 5a3 3/);
  assert.match(html, /data-holo-state="speaking"><svg class="state-icon"[^>]*>[\s\S]*?<path d="M3 10v4m4-7v10m4-13v16/);
  assert.match(app, /const activeMode = \['listening', 'thinking', 'speaking'\]\.includes\(state\.assistantMode\)/);
  assert.match(app, /state\.holoOnline \? 'Ready' : 'Offline'/);
  assert.match(app, /elements\.holoOnlineStatus\.textContent = translateUiText/);
  assert.match(app, /window\.matchMedia\('\(max-width: 780px\)'\)/);
  assert.match(app, /isCompact \? elements\.avatarHero : elements\.dashboardLayout/);
  assert.equal(icon.get('stroke-width'), '1.8');
  assert.equal(icon.get('width'), '38px');
  assert.equal(icon.get('border-radius'), '50%');
  assert.match(icon.get('box-shadow'), /color-mix/);
  assert.equal(stateCopy.get('min-width'), '0');
  assert.equal(stateSubtitle.get('white-space'), 'normal');
  assert.equal(stateSubtitle.get('overflow-wrap'), 'anywhere');
  assert.equal(mobileState.get('min-height'), '82px');
  assert.equal(mobileState.get('flex-direction'), 'column');
  assert.equal(mobileStateIcon.get('width'), '38px');
  assert.equal(compactGlobeHeading.get('position'), 'absolute');
  assert.equal(compactGlobeHeading.get('clip-path'), 'inset(50%)');
  assert.equal(narrowStrip.get('grid-template-columns'), 'repeat(2, minmax(0, 1fr))');
  assert.equal(narrowState.get('display'), 'grid');
  assert.equal(narrowState.get('min-height'), '48px');
  assert.equal(narrowState.get('font-size'), '8px');
  assert.equal(narrowCopy.get('text-align'), 'left');
  assert.equal(narrowCopy.get('width'), '100%');
  assert.equal(narrowSubtitle.get('font-size'), '7.5px');
  assert.equal(stateSubtitle.get('white-space'), 'normal');
  assert.equal(narrowStateLabel.get('white-space'), 'normal');
  assert.match(styles, /presence:has\(\.holo-stage\.is-globe-active\) > \.assistant-greeting[\s\S]*?display: none;/);
  for (const [name, color] of [
    ['listening', '#52dfff'],
    ['thinking', '#c58eff'],
    ['speaking', '#5ce5cf'],
    ['online', '#73e5aa'],
  ]) {
    const stateColor = readDeclarations(rules.filter((rule) =>
      rule.selector === `${stateSelector}[data-holo-state="${name}"]`,
    ));
    assert.equal(stateColor.get('--holo-state-color'), color);
  }
  assert.match(styles, /status-listening 1\.7s ease-in-out infinite/);
  assert.match(styles, /status-thinking 2\.2s ease-in-out infinite/);
  assert.match(styles, /status-speaking 1\.1s ease-in-out infinite/);
  assert.match(styles, /status-online 2s ease-in-out infinite/);
  assert.equal(reducedMotion.get('animation'), 'none !important');
});

test('desktop globe composition keeps model controls in flow and decorative layers non-interactive', () => {
  const globeSelector = 'body.new-interface .holo-stage.is-globe-active';
  const desktopStage = readDeclarations(rules.filter((rule) =>
    rule.selector === globeSelector
    && rule.media.some((media) => /min-width:\s*781px/.test(media)),
  ));
  const waveform = readDeclarations(rules.filter((rule) =>
    rule.selector === 'body.new-interface .holo-waveform' && rule.media.length === 0,
  ));
  const earthDecorations = rules.filter((rule) =>
    rule.selector === [
      'body.new-interface .presence:has(.holo-stage.is-globe-active) > .assistant-greeting',
      'body.new-interface .presence:has(.holo-stage.is-globe-active) > .assistant-identity',
      'body.new-interface .presence:has(.holo-stage.is-globe-active) > .holo-waveform',
    ].join(',\n'),
  );
  const hiddenDecorations = readDeclarations(earthDecorations);

  assert.equal(desktopStage.get('width'), 'min(100%, 640px, 68dvh)');
  assert.equal(desktopStage.get('top'), 'auto');
  assert.equal(waveform.get('pointer-events'), 'none');
  assert.equal(hiddenDecorations.get('display'), 'none');
});
