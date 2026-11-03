import { expect, test } from '@playwright/test';

test('keeps exactly one portrait face visible in the phone hero', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#holo-stage')).toBeVisible();
  await page.waitForTimeout(2_000);

  const layers = await page.locator('.avatar-hero img, .avatar-hero canvas, .avatar-hero *').evaluateAll((elements) => (
    elements.filter((element) => {
      const style = getComputedStyle(element);
      return element.matches('img, canvas') || style.backgroundImage !== 'none';
    }).map((element, index) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && rect.width > 0 && rect.height > 0;
      element.dataset.heroDiagnosticLayer = String(index);
      return {
        index,
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: typeof element.className === 'string' ? element.className : '',
        src: element.currentSrc || element.getAttribute('src'),
        backgroundImage: style.backgroundImage,
        width: rect.width,
        height: rect.height,
        zIndex: style.zIndex,
        opacity: style.opacity,
        visible,
      };
    })
  ));
  console.log('Hero layers at 390x844', JSON.stringify(layers));
  await page.screenshot({ path: testInfo.outputPath('hero-baseline.png'), fullPage: false });

  const candidates = layers.filter((layer) => layer.visible && (layer.tag === 'img' || layer.tag === 'canvas'));
  for (const candidate of candidates) {
    const locator = page.locator(`[data-hero-diagnostic-layer="${candidate.index}"]`);
    const previousDisplay = await locator.evaluate((element) => {
      const current = element.style.getPropertyValue('display');
      element.style.setProperty('display', 'none', 'important');
      return current;
    });
    await page.screenshot({
      path: testInfo.outputPath(`hero-without-${candidate.id || candidate.index}.png`),
      fullPage: false,
    });
    await locator.evaluate((element, display) => {
      if (display) element.style.setProperty('display', display);
      else element.style.removeProperty('display');
    }, previousDisplay);
  }

  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    id: 'ai-avatar',
    src: expect.stringMatching(/\/jarvis-portrait\.webp$/),
  });
  await expect(page.locator('#avatar-canvas')).toBeHidden();
  await expect(page.locator('#ai-avatar')).toBeVisible();
  const sphereBackground = await page.locator('.holo-sphere-shell').evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(sphereBackground).not.toContain('url(');

  await page.goto('/?debug=1');
  await expect(page.locator('.portrait-debug-markers')).toBeVisible();
  const markerReport = await page.locator('.portrait-artwork').evaluate((artwork) => {
    const box = artwork.getBoundingClientRect();
    const image = artwork.querySelector('#ai-avatar');
    const customProperties = getComputedStyle(document.documentElement);
    const markers = [
      ['leftEye', '.portrait-debug-left-eye', '--portrait-eye-left-x', '--portrait-eye-y'],
      ['rightEye', '.portrait-debug-right-eye', '--portrait-eye-right-x', '--portrait-eye-y'],
      ['mouth', '.portrait-debug-mouth', '--portrait-mouth-x', '--portrait-mouth-y'],
      ['chin', '.portrait-debug-chin', '--portrait-chin-x', '--portrait-chin-y'],
    ];
    return {
      artwork: {
        aspectRatio: artwork.offsetWidth / artwork.offsetHeight,
        naturalImageAspectRatio: image.naturalWidth / image.naturalHeight,
        computedAspectRatio: getComputedStyle(artwork).aspectRatio,
      },
      markers: markers.map(([name, selector, xProperty, yProperty]) => {
      const marker = artwork.querySelector(selector);
      const markerBox = marker.getBoundingClientRect();
      return {
        name,
        nestedInCutout: marker.parentElement.parentElement === artwork,
        x: (markerBox.left + markerBox.width / 2 - box.left) / box.width,
        y: (markerBox.top + markerBox.height / 2 - box.top) / box.height,
        expectedX: Number.parseFloat(customProperties.getPropertyValue(xProperty)) / 100,
        expectedY: Number.parseFloat(customProperties.getPropertyValue(yProperty)) / 100,
      };
      }),
    };
  });
  console.log('Normalized overlay marker positions', JSON.stringify(markerReport));
  expect(markerReport.artwork.aspectRatio).toBeCloseTo(800 / 875, 3);
  expect(markerReport.artwork.naturalImageAspectRatio).toBeCloseTo(800 / 875, 3);
  expect(markerReport.markers).toHaveLength(4);
  for (const marker of markerReport.markers) {
    expect(marker.nestedInCutout).toBe(true);
    expect(Math.abs(marker.x - marker.expectedX)).toBeLessThan(0.02);
    expect(Math.abs(marker.y - marker.expectedY)).toBeLessThan(0.02);
  }
  await page.screenshot({ path: testInfo.outputPath('hero-debug-overlay.png'), fullPage: false });
});
