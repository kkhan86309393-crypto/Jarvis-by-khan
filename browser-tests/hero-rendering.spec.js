import { expect, test } from '@playwright/test';

async function activateProjection(page, selector) {
  await page.locator(selector).evaluate((button) => button.click());
}

async function expectCanvasMode(page, mode) {
  const report = await page.locator('#avatar-canvas').evaluate((canvas) => {
    const style = getComputedStyle(canvas);
    const bounds = canvas.getBoundingClientRect();
    const stage = canvas.parentElement.getBoundingClientRect();
    const artwork = document.querySelector('.portrait-artwork');
    const artworkStyle = getComputedStyle(artwork);
    return {
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity),
      cssTop: style.top,
      cssLeft: style.left,
      cssTransform: style.transform,
      cssInset: style.inset,
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.width,
      height: bounds.height,
      stageLeft: stage.left,
      stageTop: stage.top,
      stageRight: stage.right,
      stageBottom: stage.bottom,
      stageWidth: stage.width,
      stageHeight: stage.height,
      stageClass: canvas.parentElement.className,
      bodyClass: document.body.className,
      matchingSelector: canvas.matches('.holo-stage.is-globe-active > .avatar-canvas'),
      stylesheetUrls: [...document.styleSheets].map((sheet) => sheet.href),
      insideStage: bounds.left >= stage.left - 2
        && bounds.top >= stage.top - 2
        && bounds.right <= stage.right + 2
        && bounds.bottom <= stage.bottom + 2,
      artworkVisibility: artworkStyle.visibility,
      artworkOpacity: Number(artworkStyle.opacity),
      basePortraitVisibility: getComputedStyle(document.querySelector('#ai-avatar')).visibility,
    };
  });
  expect(report.display).not.toBe('none');
  expect(report.visibility).toBe('visible');
  expect(report.opacity).toBe(1);
  expect(report.width).toBeGreaterThan(0);
  expect(report.height).toBeGreaterThan(0);
  expect(report.insideStage, `canvas bounds exceeded the stage: ${JSON.stringify(report)}`).toBe(true);
  expect(report.artworkVisibility).toBe(mode === 'avatar' ? 'hidden' : 'visible');
  expect(report.basePortraitVisibility).toBe(mode === 'avatar' ? 'hidden' : 'visible');
  if (mode === 'earth') expect(report.artworkOpacity).toBeGreaterThan(0);
}

async function expectStaticFallback(page) {
  await expect(page.locator('#avatar-canvas')).toBeHidden();
  await expect(page.locator('#ai-avatar')).toBeVisible();
  const visibility = await page.locator('.portrait-artwork').evaluate((element) => getComputedStyle(element).visibility);
  expect(visibility).toBe('visible');
  await expect(page.locator('#holo-stage')).not.toHaveClass(/is-avatar-active|is-globe-active/);
}

test('default, avatar, Earth, and context-loss modes keep the intended hero layers', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#holo-stage')).toBeVisible();

  const viewports = [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-360', width: 360, height: 780 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.reload();
    await expectStaticFallback(page);
    const defaultCanvasStyle = await page.locator('#avatar-canvas').evaluate((canvas) => ({
      display: getComputedStyle(canvas).display,
      width: canvas.getBoundingClientRect().width,
      height: canvas.getBoundingClientRect().height,
    }));
    expect(defaultCanvasStyle.display).toBe('none');
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-default.png`) });

    await activateProjection(page, '#activate-holographic-earth');
    await expect(page.locator('#holo-stage')).toHaveClass(/is-globe-active/);
    await expect(page.locator('#avatar-canvas')).toBeVisible();
    await expectCanvasMode(page, 'earth');
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-earth.png`) });

    await page.locator('#avatar-canvas').evaluate((canvas) => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    });
    await expectStaticFallback(page);
    await expect(page.locator('#activate-holographic-earth')).toHaveAttribute('aria-pressed', 'false');
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-context-loss-fallback.png`) });

    await activateProjection(page, '#activate-3d-avatar');
    await expect(page.locator('#holo-stage')).toHaveClass(/is-avatar-active/);
    await expect(page.locator('#avatar-canvas')).toBeVisible();
    await expectCanvasMode(page, 'avatar');
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-avatar.png`) });
  }
});

test('bundle and WebGL initialization failures preserve the static portrait', async ({ page }) => {
  await page.route('**/avatar3d.bundle.js*', (route) => route.abort());
  await page.goto('/');
  await activateProjection(page, '#activate-3d-avatar');
  await expect(page.locator('#avatar-model-status')).toContainText('static portrait is still available');
  await expectStaticFallback(page);
});

test('WebGL renderer initialization failure restores the static portrait', async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return originalGetContext.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await activateProjection(page, '#activate-holographic-earth');
  await expect(page.locator('#avatar-model-status')).toContainText('portrait remains active');
  await expectStaticFallback(page);
});
