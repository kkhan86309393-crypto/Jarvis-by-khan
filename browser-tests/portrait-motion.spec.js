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
  await page.setViewportSize({ width: 390, height: 844 });
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

  const output = (name) => testInfo.outputPath(name);
  const artworkBox = await page.locator('.portrait-artwork').boundingBox();
  const bodyRegion = {
    x: artworkBox.x,
    y: artworkBox.y + artworkBox.height * 0.64,
    width: artworkBox.width,
    height: artworkBox.height * 0.36,
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
  await page.evaluate(() => window.jarvisAvatarAnimation.blink());
  await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'closed', { timeout: 500 });
  await page.waitForTimeout(60);
  const closedEyes = (await captureRegion(page, eyeRegion, output('eyes-closed.png'))).image;
  const eyeDifference = (await comparePixels(page, [openEyes, closedEyes]))[0];
  expect(eyeDifference.changedPixels).toBeGreaterThan(0);

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
