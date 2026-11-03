import { expect, test } from '@playwright/test';

test.describe('forwarded preview reloads', () => {
  test.use({ serviceWorkers: 'allow' });

  test('service-worker updates do not reload the page and direct refresh remains stable', async ({ page }) => {
    const errors = [];
    let documentRequests = 0;
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documentRequests += 1;
      }
    });

    await page.goto('/');
    await expect(page.locator('#dashboard-layout')).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForTimeout(500);
    expect(documentRequests).toBe(1);
    await expect(page.locator('#holo-stage')).toBeVisible();

    await page.locator('[data-nav="chat"]:visible').first().click();
    await expect(page.locator('.dashboard-chat-panel')).toBeVisible();
    await expect(page.locator('#dashboard-message')).toBeFocused();
    await page.locator('[data-nav="lab"]:visible').first().click();
    await expect(page.locator('#jarvis-lab')).toBeVisible();
    await page.locator('#lab-return-button').click();
    await expect(page.locator('#dashboard-layout')).toBeVisible();

    const navigationCountBeforeManualRefresh = documentRequests;
    await page.reload();
    await expect(page.locator('#dashboard-layout')).toBeVisible();
    await page.waitForTimeout(500);
    expect(documentRequests).toBe(navigationCountBeforeManualRefresh + 1);
    expect(errors).toEqual([]);

    const directEntry = await page.goto('/index.html');
    expect(directEntry.status()).toBe(200);
    await expect(page.locator('#dashboard-layout')).toBeVisible();
    await expect(page.locator('#holo-stage')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
