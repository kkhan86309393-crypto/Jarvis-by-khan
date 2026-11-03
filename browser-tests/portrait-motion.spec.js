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

    return pixelData.slice(1).map((current) => {
      let changedPixels = 0;
      let absoluteDifference = 0;
      for (let index = 0; index < current.length; index += 4) {
        const difference = Math.abs(current[index] - pixelData[0][index])
          + Math.abs(current[index + 1] - pixelData[0][index + 1])
          + Math.abs(current[index + 2] - pixelData[0][index + 2]);
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

test('portrait speech, blink, and tilt change their screenshot regions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.jarvisAvatarAnimation));
  await page.locator('#ai-avatar').evaluate((image) => image.decode());
  await expect(page.locator('#holo-stage')).toBeVisible();
  await page.locator('#settings-button').click();
  await page.locator('#activate-holographic-earth').waitFor({ state: 'visible' });
  await page.locator('#activate-holographic-earth').click();
  await expect(page.locator('#holo-stage')).toHaveClass(/is-globe-active/);
  await page.locator('#settings-dialog [aria-label="Close settings"]').click();
  await page.waitForFunction(() => Boolean(
    document.querySelector('.portrait-mouth')?.style.getPropertyValue('--portrait-mouth-open'),
  ));

  const output = (name) => testInfo.outputPath(name);
  const artworkBox = await page.locator('.portrait-artwork').boundingBox();
  const mouthRegion = {
    x: artworkBox.x + artworkBox.width * 0.517 - artworkBox.width * 0.1,
    y: artworkBox.y + artworkBox.height * 0.419 - artworkBox.height * 0.05,
    width: artworkBox.width * 0.2,
    height: artworkBox.height * 0.1,
  };

  await page.evaluate(() => {
    window.jarvisAvatarAnimation.setSpeaking(true);
    window.jarvisAvatarAnimation.setSpeechCue(0.75, 'aa');
  });
  const mouthImages = [];
  mouthImages.push((await captureRegion(page, mouthRegion, output('mouth-1.png'))).image);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.jarvisAvatarAnimation.setSpeechCue(0.32, 'ih'));
  mouthImages.push((await captureRegion(page, mouthRegion, output('mouth-2.png'))).image);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.jarvisAvatarAnimation.setSpeechCue(0.68, 'oh'));
  mouthImages.push((await captureRegion(page, mouthRegion, output('mouth-3.png'))).image);
  const mouthDifferences = await comparePixels(page, mouthImages);
  expect(mouthDifferences[0].changedPixels).toBeGreaterThan(0);
  expect(mouthDifferences[1].changedPixels).toBeGreaterThan(0);

  await page.evaluate(() => window.jarvisAvatarAnimation.setSpeaking(false));
  await page.waitForTimeout(100);
  const eyeRegion = {
    x: artworkBox.x + artworkBox.width * 0.38,
    y: artworkBox.y + artworkBox.height * 0.24,
    width: artworkBox.width * 0.27,
    height: artworkBox.height * 0.1,
  };
  const openEyes = (await captureRegion(page, eyeRegion, output('eyes-open.png'))).image;
  await page.evaluate(() => window.jarvisAvatarAnimation.blink());
  await expect(page.locator('.portrait-cutout-frame')).toHaveAttribute('data-blink', 'closed', { timeout: 500 });
  const closedEyes = (await captureRegion(page, eyeRegion, output('eyes-blink.png'))).image;
  const eyeDifference = (await comparePixels(page, [openEyes, closedEyes]))[0];
  expect(eyeDifference.changedPixels).toBeGreaterThan(0);

  await page.evaluate(() => {
    const quality = document.querySelector('#hologram-quality');
    quality.value = 'high';
    quality.dispatchEvent(new Event('change', { bubbles: true }));
    window.jarvisAvatarAnimation.setEyeMode('listening');
  });
  const stageBox = await page.locator('#holo-stage').boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.waitForTimeout(250);
  const portraitBox = await page.locator('.portrait-cutout-frame').boundingBox();
  const portraitRegion = {
    x: portraitBox.x - 8,
    y: portraitBox.y - 8,
    width: portraitBox.width + 16,
    height: portraitBox.height + 16,
  };
  const neutralPortrait = (await captureRegion(page, portraitRegion, output('portrait-neutral.png'))).image;
  await page.mouse.move(stageBox.x + stageBox.width * 0.98, stageBox.y + stageBox.height * 0.02);
  await page.waitForTimeout(300);
  const tiltedPortrait = (await captureRegion(page, portraitRegion, output('portrait-tilted.png'))).image;
  const tiltDifference = (await comparePixels(page, [neutralPortrait, tiltedPortrait]))[0];
  const tilt = await page.locator('.portrait-cutout-frame').evaluate((frame) => ({
    x: Number.parseFloat(frame.style.getPropertyValue('--portrait-tilt-x')),
    y: Number.parseFloat(frame.style.getPropertyValue('--portrait-tilt-y')),
    portraitDepthX: Number.parseFloat(frame.style.getPropertyValue('--portrait-depth-x')),
    sphereDepthX: Number.parseFloat(document.querySelector('.holo-sphere-shell').style.getPropertyValue('--sphere-depth-x')),
  }));
  expect(Math.abs(tilt.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(tilt.y)).toBeLessThanOrEqual(3);
  expect(tiltDifference.changedPixels).toBeGreaterThan(0);
  expect(tilt.portraitDepthX * tilt.sphereDepthX).toBeLessThan(0);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('jarvis:hologram-quality-change', {
      detail: { quality: 'low' },
    }));
  });
  await page.waitForTimeout(50);
  const lowQualityTilt = await page.locator('.portrait-cutout-frame').evaluate((frame) => ({
    x: Number.parseFloat(frame.style.getPropertyValue('--portrait-tilt-x')),
    y: Number.parseFloat(frame.style.getPropertyValue('--portrait-tilt-y')),
  }));
  expect(lowQualityTilt.x).toBe(0);
  expect(lowQualityTilt.y).toBe(0);

  console.log('Portrait screenshot pixel differences', JSON.stringify({
    mouth: mouthDifferences,
    eyes: eyeDifference,
    tilt: tiltDifference,
    tiltDegrees: { x: tilt.x, y: tilt.y },
    oppositeDepthPx: { portrait: tilt.portraitDepthX, sphere: tilt.sphereDepthX },
  }));
});
