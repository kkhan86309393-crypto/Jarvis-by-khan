import { expect, test } from '@playwright/test';

async function takeEyeScreenshot(page, testInfo, name) {
  const artwork = await page.locator('.portrait-artwork').boundingBox();
  const path = testInfo.outputPath(name);
  await page.screenshot({
    path,
    clip: {
      x: artwork.x + artwork.width * 0.34,
      y: artwork.y + artwork.height * 0.235,
      width: artwork.width * 0.32,
      height: artwork.height * 0.115,
    },
  });
  return path;
}

async function takePortraitScreenshot(page, testInfo, name) {
  const artwork = await page.locator('.portrait-artwork').boundingBox();
  const path = testInfo.outputPath(name);
  await page.screenshot({
    path,
    clip: {
      x: artwork.x,
      y: artwork.y,
      width: artwork.width,
      height: artwork.height,
    },
  });
  return path;
}

async function prepareTransitions(page, { mode = 'idle', speaking = false } = {}) {
  await page.evaluate(({ nextMode, isSpeaking }) => {
    window.jarvisAvatarAnimation.setEyeMode(nextMode);
    window.jarvisAvatarAnimation.setSpeaking(isSpeaking);
  }, { nextMode: mode, isSpeaking: speaking });
}

async function armOpacityTransition(page) {
  await page.locator('.portrait-blink-image').evaluate((image) => {
    window.__portraitBlinkTransitionMidpoint = new Promise((resolve) => {
      image.addEventListener('transitionrun', (event) => {
        if (event.propertyName !== 'opacity') return;
        const transition = image.getAnimations().find((animation) => (
          animation.transitionProperty === 'opacity'
        ));
        if (!transition) {
          resolve({ error: 'opacity transition animation was not available' });
          return;
        }
        const duration = Number(transition.effect.getTiming().duration);
        transition.pause();
        transition.currentTime = duration / 2;
        window.__portraitBlinkTransitionAnimation = transition;
        requestAnimationFrame(() => resolve({
          duration,
          opacity: Number(getComputedStyle(image).opacity),
        }));
      }, { once: true });
    });
    window.__portraitBlinkTransitionEnd = new Promise((resolve) => {
      image.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'opacity') {
          resolve(Number(getComputedStyle(image).opacity));
        }
      }, { once: true });
    });
  });
}

async function transitionMidpoint(page) {
  return page.evaluate(() => window.__portraitBlinkTransitionMidpoint);
}

async function resumeTransition(page) {
  await page.locator('.portrait-blink-image').evaluate((image) => {
    window.__portraitBlinkTransitionAnimation?.play();
  });
  return page.evaluate(() => window.__portraitBlinkTransitionEnd);
}

async function keepBlinkClosed(page) {
  await page.evaluate(() => {
    window.__portraitBlinkPin = window.setInterval(() => {
      if (document.querySelector('.portrait-cutout-frame')?.dataset.blink === 'closed') {
        window.jarvisAvatarAnimation.blink({ holdDurationMs: 500 });
      }
    }, 150);
  });
}

async function releaseBlinkClosed(page) {
  await page.evaluate(() => {
    window.clearInterval(window.__portraitBlinkPin);
    window.__portraitBlinkPin = null;
  });
}

async function captureBlink(page, testInfo, name, { captureTransitionFrames = true } = {}) {
  await armOpacityTransition(page);
  await page.evaluate(() => {
    window.__portraitBlinkTestRandom = 0.5;
    window.jarvisAvatarAnimation.blink({ holdDurationMs: 500 });
  });
  await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'closed');
  await keepBlinkClosed(page);

  const closing = await transitionMidpoint(page);
  expect(closing.error).toBeUndefined();
  expect(closing.duration).toBeGreaterThan(0);
  expect(closing.opacity).toBeGreaterThan(0);
  expect(closing.opacity).toBeLessThan(1);
  const screenshots = [];
  if (captureTransitionFrames) {
    screenshots.push(await takeEyeScreenshot(page, testInfo, `${name}-closing.png`));
  }

  const closedOpacity = await resumeTransition(page);
  expect(closedOpacity).toBeGreaterThan(0.99);
  await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'closed');
  screenshots.push(await takeEyeScreenshot(page, testInfo, `${name}-closed.png`));

  await armOpacityTransition(page);
  await releaseBlinkClosed(page);
  await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'open');
  const reopening = await transitionMidpoint(page);
  expect(reopening.error).toBeUndefined();
  expect(reopening.duration).toBeGreaterThan(0);
  expect(reopening.opacity).toBeGreaterThan(0);
  expect(reopening.opacity).toBeLessThan(1);
  if (captureTransitionFrames) {
    screenshots.push(await takeEyeScreenshot(page, testInfo, `${name}-reopening.png`));
  }

  const openOpacity = await resumeTransition(page);
  expect(openOpacity).toBeLessThan(0.01);
  await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'open');
  return screenshots;
}

test('captures real blink transition phases across desktop and mobile sizes', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    window.__portraitBlinkTestRandom = 0.5;
    Math.random = () => window.__portraitBlinkTestRandom;
  });

  const viewports = [
    { width: 1440, height: 1000, label: 'desktop' },
    { width: 390, height: 844, label: 'mobile-390x844' },
    { width: 360, height: 780, label: 'mobile-360x780' },
  ];
  const captures = [];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.jarvisAvatarAnimation));
    await page.locator('#ai-avatar').evaluate((image) => image.decode());
    await page.locator('.portrait-blink-image').evaluate((image) => image.decode());
    await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'open');
    captures.push(await takePortraitScreenshot(
      page,
      testInfo,
      `${viewport.label}-idle-open.png`,
    ));

    await prepareTransitions(page);
    captures.push(...await captureBlink(page, testInfo, `${viewport.label}-idle`));

    captures.push(...await captureBlink(
      page,
      testInfo,
      `${viewport.label}-double-first`,
      { captureTransitionFrames: false },
    ));
    captures.push(await takeEyeScreenshot(
      page,
      testInfo,
      `${viewport.label}-double-open-between.png`,
    ));
    captures.push(...await captureBlink(
      page,
      testInfo,
      `${viewport.label}-double-second`,
      { captureTransitionFrames: false },
    ));

    await prepareTransitions(page, { mode: 'idle', speaking: true });
    captures.push(...await captureBlink(
      page,
      testInfo,
      `${viewport.label}-speaking`,
      { captureTransitionFrames: false },
    ));
    expect(await page.locator('.portrait-cutout-frame').getAttribute('data-speaking')).toBe('true');

    await prepareTransitions(page, { mode: 'listening' });
    captures.push(...await captureBlink(
      page,
      testInfo,
      `${viewport.label}-listening`,
      { captureTransitionFrames: false },
    ));
    expect(await page.evaluate(() => window.jarvisAvatarAnimation.getMotionState().eyeMode)).toBe('listening');

    await prepareTransitions(page, { mode: 'thinking' });
    captures.push(...await captureBlink(
      page,
      testInfo,
      `${viewport.label}-thinking`,
      { captureTransitionFrames: false },
    ));
    expect(await page.evaluate(() => window.jarvisAvatarAnimation.getMotionState().eyeMode)).toBe('thinking');

    await page.evaluate(() => window.jarvisAvatarAnimation.setSpeaking(false));
    captures.push(await takePortraitScreenshot(
      page,
      testInfo,
      `${viewport.label}-idle-final-open.png`,
    ));
  }

  expect(captures).toHaveLength(viewports.length * 11);
  console.log('Portrait blink visual audit screenshots', JSON.stringify(captures));
});
