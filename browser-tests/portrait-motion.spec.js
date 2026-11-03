import { expect, test } from '@playwright/test';

async function captureRegion(page, box, path) {
  const clip = {
    x: Math.max(0, Math.floor(box.x)),
    y: Math.max(0, Math.floor(box.y)),
    width: Math.max(1, Math.ceil(box.width)),
    height: Math.max(1, Math.ceil(box.height)),
  };
  const image = await page.screenshot({ clip, path });
  return { image, clip };
}

async function comparePixels(page, images) {
  return page.evaluate(async (encodedImages) => {
    const loaded = await Promise.all(encodedImages.map((source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/png;base64,${source}`;
    })));
    const width = loaded[0].naturalWidth;
    const height = loaded[0].naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const pixelData = loaded.map((image) => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, width, height).data;
    });

    return pixelData.slice(1).map((current, pairIndex) => {
      let changedPixels = 0;
      let absoluteDifference = 0;
      for (let pixelIndex = 0; pixelIndex < current.length; pixelIndex += 4) {
        const previous = pixelData[pairIndex];
        const difference = Math.abs(current[pixelIndex] - previous[pixelIndex])
          + Math.abs(current[pixelIndex + 1] - previous[pixelIndex + 1])
          + Math.abs(current[pixelIndex + 2] - previous[pixelIndex + 2]);
        absoluteDifference += difference;
        if (difference > 24) changedPixels += 1;
      }
      return {
        changedPixels,
        meanAbsoluteRgbDifference: Number((absoluteDifference / (width * height * 3)).toFixed(3)),
        totalPixels: width * height,
      };
    });
  }, images.map((image) => image.toString('base64')));
}

test('head-only portrait keeps its body static and proves blink and speaking changes', async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === 'android-mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 1000 });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.jarvisAvatarAnimation));
  await page.locator('#ai-avatar').evaluate((image) => image.decode());
  await page.locator('.portrait-head-image').evaluate((image) => image.decode());
  await page.locator('.portrait-blink-image').evaluate((image) => image.decode());
  await expect(page.locator('#holo-stage')).toBeVisible();
  await expect(page.locator('#avatar-canvas')).toBeHidden();
  await expect(page.locator('#ai-avatar')).toBeVisible();
  expect(await page.locator('.portrait-artwork > #ai-avatar').count()).toBe(1);
  expect(await page.locator('.portrait-head-image[src*="reference-face"]').count()).toBe(0);
  const blinkAsset = await page.locator('.portrait-blink-image').evaluate((image) => {
    const source = document.querySelector('#ai-avatar');
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0);
    const openAlpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const closedAlpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let alphaDifferences = 0;
    for (let index = 3; index < openAlpha.length; index += 4) {
      if (openAlpha[index] !== closedAlpha[index]) alphaDifferences += 1;
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      alphaDifferences,
    };
  });
  expect(blinkAsset).toEqual({ width: 800, height: 875, alphaDifferences: 0 });
  const eyeAlignment = await page.locator('.portrait-blink-image').evaluate((image) => {
    const closed = image.getBoundingClientRect();
    const head = image.closest('.portrait-head-content').getBoundingClientRect();
    const styles = getComputedStyle(image);
    return {
      mask: styles.maskImage,
      sameBoxAsHead: Math.abs(closed.width - head.width) < 0.5
        && Math.abs(closed.height - head.height) < 0.5,
    };
  });
  expect(eyeAlignment.sameBoxAsHead).toBe(true);
  expect(eyeAlignment.mask).toContain('43.6% 28.8%');
  expect(eyeAlignment.mask).toContain('58.9% 27.6%');

  const output = (name) => testInfo.outputPath(name);
  const artworkBox = await page.locator('.portrait-artwork').boundingBox();
  const bodyRegion = {
    x: artworkBox.x,
    y: artworkBox.y + artworkBox.height * 0.66,
    width: artworkBox.width,
    height: artworkBox.height * 0.34,
  };
  const headRegion = {
    x: artworkBox.x + artworkBox.width * 0.23,
    y: artworkBox.y + artworkBox.height * 0.05,
    width: artworkBox.width * 0.54,
    height: artworkBox.height * 0.48,
  };
  const mouthRegion = {
    x: artworkBox.x + artworkBox.width * 0.44,
    y: artworkBox.y + artworkBox.height * 0.385,
    width: artworkBox.width * 0.16,
    height: artworkBox.height * 0.08,
  };
  const eyeRegion = {
    x: artworkBox.x + artworkBox.width * 0.36,
    y: artworkBox.y + artworkBox.height * 0.235,
    width: artworkBox.width * 0.29,
    height: artworkBox.height * 0.105,
  };

  await page.locator('.holo-stage > :not(.portrait-cutout-frame), .portrait-cutout-frame > .portrait-scanline')
    .evaluateAll((elements) => elements.forEach((element) => element.style.setProperty('display', 'none', 'important')));
  await page.waitForTimeout(100);
  const idleBodyStart = (await captureRegion(page, bodyRegion, output('body-idle-start.png'))).image;
  const headStart = (await captureRegion(page, headRegion, output('head-start.png'))).image;
  await page.waitForTimeout(3_000);
  const idleBodyEnd = (await captureRegion(page, bodyRegion, output('body-idle-end.png'))).image;
  const headEnd = (await captureRegion(page, headRegion, output('head-end.png'))).image;
  const idleBodyDifference = (await comparePixels(page, [idleBodyStart, idleBodyEnd]))[0];
  const headDifference = (await comparePixels(page, [headStart, headEnd]))[0];
  expect(idleBodyDifference.changedPixels).toBe(0);
  expect(headDifference.changedPixels).toBeGreaterThan(0);

  await page.evaluate(() => window.jarvisAvatarAnimation.setSpeaking(true));
  const speakingBodyStart = (await captureRegion(page, bodyRegion, output('body-speaking-start.png'))).image;
  const mouthFrames = [];
  for (const [index, [opening, viseme]] of [
    [0.92, 'aa'],
    [0.18, 'ih'],
    [0.82, 'oh'],
    [0.26, 'ee'],
  ].entries()) {
    await page.evaluate(({ opening: value, viseme: shape }) => {
      window.jarvisAvatarAnimation.setSpeechCue(value, shape, { emphasis: value > 0.8 });
    }, { opening, viseme });
    await page.waitForTimeout(120);
    mouthFrames.push((await captureRegion(page, mouthRegion, output(`mouth-${index + 1}.png`))).image);
  }
  const speakingBodyEnd = (await captureRegion(page, bodyRegion, output('body-speaking-end.png'))).image;
  const speakingBodyDifference = (await comparePixels(page, [speakingBodyStart, speakingBodyEnd]))[0];
  const mouthDifferences = await comparePixels(page, mouthFrames);
  expect(speakingBodyDifference.changedPixels).toBe(0);
  expect(mouthDifferences).toHaveLength(3);
  for (const difference of mouthDifferences) expect(difference.changedPixels).toBeGreaterThan(0);

  await page.evaluate(() => window.jarvisAvatarAnimation.setSpeaking(false));
  await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'open');
  const openEyes = (await captureRegion(page, eyeRegion, output('eyes-open.png'))).image;
  const closedEyes = await page.evaluate(async () => {
    const image = document.querySelector('.portrait-blink-image');
    const transitionEnded = new Promise((resolve) => {
      image.addEventListener('transitionend', ({ propertyName }) => {
        if (propertyName === 'opacity') resolve();
      }, { once: true });
    });
    window.jarvisAvatarAnimation.blink({ holdDurationMs: 200 });
    const frame = document.querySelector('.portrait-cutout-frame');
    const transition = getComputedStyle(image).transitionDuration;
    const duration = Number.parseFloat(transition);
    const closeTransitionMs = transition.endsWith('ms') ? duration : duration * 1_000;
    await transitionEnded;
    return {
      state: frame.dataset.blink,
      opacity: getComputedStyle(image).opacity,
      duration: closeTransitionMs,
    };
  });
  expect(closedEyes.state).toBe('closed');
  expect(closedEyes.opacity).toBe('1');
  expect(closedEyes.duration).toBeGreaterThanOrEqual(45);
  expect(closedEyes.duration).toBeLessThanOrEqual(60);
  const closedEyesImage = (await captureRegion(page, eyeRegion, output('eyes-closed.png'))).image;
  const eyeDifference = (await comparePixels(page, [openEyes, closedEyesImage]))[0];
  expect(eyeDifference.changedPixels).toBeGreaterThan(0);
  await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'open', { timeout: 300 });
  const openTransition = await page.locator('.portrait-blink-image').evaluate((image) => {
    const transition = getComputedStyle(image).transitionDuration;
    const duration = Number.parseFloat(transition);
    return transition.endsWith('ms') ? duration : duration * 1_000;
  });
  expect(openTransition).toBeGreaterThanOrEqual(70);
  expect(openTransition).toBeLessThanOrEqual(95);

  await page.goto('/?debug=1');
  await expect(page.locator('.portrait-debug-markers')).toBeVisible();
  const markers = await page.locator('.portrait-debug-marker').evaluateAll((items) => items.map((item) => {
    const artwork = item.closest('.portrait-artwork');
    const frame = artwork.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    return {
      name: item.className,
      nestedInHead: Boolean(item.closest('.portrait-head-content')),
      x: (box.left + box.width / 2 - frame.left) / frame.width,
      y: (box.top + box.height / 2 - frame.top) / frame.height,
    };
  }));
  expect(markers).toHaveLength(4);
  expect(markers.every((marker) => marker.nestedInHead)).toBe(true);
  for (const marker of markers) {
    expect(marker.x).toBeGreaterThan(0.35);
    expect(marker.x).toBeLessThan(0.67);
    expect(marker.y).toBeGreaterThan(0.25);
    expect(marker.y).toBeLessThan(0.55);
  }

  console.log('Head-only portrait pixel differences', JSON.stringify({
    idleBody: idleBodyDifference,
    speakingBody: speakingBodyDifference,
    head: headDifference,
    blink: eyeDifference,
    mouth: mouthDifferences,
    debugMarkers: markers,
  }));
});

test('captures static and Three.js portrait motion states with bounded static transforms', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  page.on('pageerror', (error) => console.error('Portrait motion browser error:', error));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('Portrait motion browser console:', message.text());
  });
  const mobile = testInfo.project.name === 'android-mobile';
  await page.setViewportSize(mobile
    ? { width: 390, height: 844 }
    : { width: 1440, height: 1000 });
  await page.route('**/api/health', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.jarvisAvatarAnimation), undefined, { timeout: 10_000 });
  await page.locator('#ai-avatar').evaluate((image) => image.decode());
  await expect(page.locator('#holo-stage')).toHaveClass(/is-offline/);
  await expect(page.locator('#holo-state-announcement')).toHaveText('J.A.R.V.I.S. is offline.');
  await expect(page.locator('#holo-waveform')).toHaveAttribute('aria-label', 'Voice activity idle');
  await expect(page.locator('#holo-waveform')).not.toHaveClass(/is-active/);

  const staticStates = [];
  await page.locator('.portrait-artwork').screenshot({
    path: testInfo.outputPath(`${mobile ? 'mobile' : 'desktop'}-static-offline.png`),
  });
  for (const state of ['idle', 'listening', 'thinking', 'speaking']) {
    await page.evaluate((nextState) => {
      const animation = window.jarvisAvatarAnimation;
      animation.setSpeaking(nextState === 'speaking');
      animation.setEyeMode(['listening', 'thinking'].includes(nextState) ? nextState : 'idle');
      if (nextState === 'speaking') animation.setSpeechCue(0.7, 'aa', { emphasis: true });
    }, state);
    await page.waitForTimeout(500);
    const transform = await page.locator('.portrait-head-content').evaluate((head) => ({
      rotation: Number.parseFloat(getComputedStyle(head).getPropertyValue('--portrait-head-rotation')) || 0,
      translation: Number.parseFloat(getComputedStyle(head).getPropertyValue('--portrait-head-y')) || 0,
    }));
    expect(Math.abs(transform.rotation), `${state} rotation`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(transform.translation), `${state} translation`).toBeLessThanOrEqual(1.2);
    staticStates.push({ state, ...transform });
    await page.locator('.portrait-artwork').screenshot({
      path: testInfo.outputPath(`${mobile ? 'mobile' : 'desktop'}-static-${state}.png`),
    });
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(400);
  const reducedMotionTransform = await page.locator('.portrait-head-content').evaluate((head) => ({
    rotation: Number.parseFloat(getComputedStyle(head).getPropertyValue('--portrait-head-rotation')) || 0,
    translation: Number.parseFloat(getComputedStyle(head).getPropertyValue('--portrait-head-y')) || 0,
  }));
  expect(Math.abs(reducedMotionTransform.rotation)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(reducedMotionTransform.translation)).toBeLessThanOrEqual(1.2);
  await page.locator('.portrait-artwork').screenshot({
    path: testInfo.outputPath(`${mobile ? 'mobile' : 'desktop'}-static-reduced-motion.png`),
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.locator('#activate-3d-avatar').evaluate((button) => button.click());
  await expect(page.locator('#holo-stage')).toHaveClass(/is-avatar-active/);
  await expect(page.locator('#avatar-canvas')).toBeVisible();
  await page.waitForFunction(() => typeof window.setHologramState === 'function');
  for (const state of ['idle', 'listening', 'thinking', 'speaking', 'offline']) {
    await page.evaluate((nextState) => window.setHologramState(nextState, nextState === 'speaking' ? 0.55 : 0), state);
    await page.waitForTimeout(500);
    await page.locator('#holo-stage').screenshot({
      path: testInfo.outputPath(`${mobile ? 'mobile' : 'desktop'}-3d-${state}.png`),
    });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(500);
  await page.locator('#holo-stage').screenshot({
    path: testInfo.outputPath(`${mobile ? 'mobile' : 'desktop'}-3d-reduced-motion.png`),
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#hologram-quality').evaluate((select) => {
    select.value = 'low';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await page.locator('#holo-stage').screenshot({
    path: testInfo.outputPath(`${mobile ? 'mobile' : 'desktop'}-3d-low-quality.png`),
  });
  console.log('Portrait motion screenshot bounds', JSON.stringify({ project: testInfo.project.name, staticStates, reducedMotionTransform }));
});
