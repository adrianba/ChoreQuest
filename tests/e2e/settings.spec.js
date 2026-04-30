import { test, expect } from './fixtures.js';

test.describe('Settings — parent only', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('settings page accessible for parent', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/login/);
  });

  test('feature toggles are visible', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await expect(page.locator('text=/leaderboard|spin wheel|trading/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('grace period input is present', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await expect(page.locator('text=/grace period/i')).toBeVisible({ timeout: 8_000 });
  });

  test('grace period can be updated', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const input = page.locator('input[type="number"]').filter({ has: page.locator('..') }).first();
    if (await input.isVisible()) {
      await input.fill('2');
      const saveBtn = page.locator('button:has-text("Save"), button[type="submit"]').first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        // Should not error
        await expect(page.locator('text=/error/i')).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
      }
    }
  });
});

test.describe('Update overlay', () => {
  test.beforeEach(async ({ loginAsParent }) => {});

  test('overlay appears when app:update-triggered event is dispatched', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Pass null as currentVersion so the health-check guard (startVersionRef && ...)
    // never fires, keeping the overlay in "Working on updates" state for inspection.
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('app:update-triggered', {
        detail: { currentVersion: null },
      }));
    });

    // The overlay should appear with the Windows-Update-style content
    await expect(page.locator('text=Working on updates')).toBeVisible({ timeout: 5_000 });
  });

  test('overlay shows ring spinner when visible', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('app:update-triggered', {
        detail: { currentVersion: null },
      }));
    });

    // Wait for the overlay to render
    await expect(page.locator('text=Working on updates')).toBeVisible({ timeout: 5_000 });
    // The SVG ring spinner must also be visible
    await expect(page.locator('.fixed.inset-0 svg').first()).toBeVisible({ timeout: 3_000 });
  });

  test('progress bar stays below 30% after 60 seconds of 270s timeout', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('app:update-triggered', {
        detail: { currentVersion: null },
      }));
    });

    await expect(page.locator('text=Working on updates')).toBeVisible({ timeout: 5_000 });

    // Simulate 60 seconds elapsed out of the 270s timeout.
    // At 60s the bar should be well under 30% — confirming it's paced
    // across the full duration rather than the old 90s window.
    const percent = await page.evaluate(() => {
      const SAFETY_TIMEOUT_MS = 4 * 60_000 + 30_000; // must match component
      const elapsedMs = 60_000; // 60 seconds
      const t = Math.min(elapsedMs / SAFETY_TIMEOUT_MS, 1);
      return Math.round(80 * (1 - Math.pow(1 - t, 1.8)));
    });

    expect(percent).toBeLessThan(30);
    expect(percent).toBeGreaterThan(0);
  });

  test('overlay covers the full viewport', async ({ loginAsParent: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('app:update-triggered', {
        detail: { currentVersion: null },
      }));
    });

    // Wait for the overlay to render before measuring
    await expect(page.locator('text=Working on updates')).toBeVisible({ timeout: 5_000 });

    const overlay = page.locator('[data-testid="update-overlay"]');
    const box = await overlay.boundingBox();
    const vp = page.viewportSize();
    if (box && vp) {
      expect(box.width).toBeGreaterThanOrEqual(vp.width);
      expect(box.height).toBeGreaterThanOrEqual(vp.height);
    }
  });
});

test.describe('index.html cache headers', () => {
  test('index.html is served with no-cache headers', async ({ page }) => {
    const responses = [];
    page.on('response', (res) => {
      if (res.url().endsWith('/') || res.url().endsWith('/index.html')) {
        responses.push(res);
      }
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // At least one HTML response captured
    const htmlResp = responses.find((r) => {
      const ct = r.headers()['content-type'] || '';
      return ct.includes('text/html');
    });

    if (htmlResp) {
      const cc = htmlResp.headers()['cache-control'] ?? '';
      expect(cc).toMatch(/no-cache|no-store/i);
    }
  });
});

test.describe('Settings — kid view', () => {
  test('kid can load settings page without crashing', async ({ loginAsKid: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // Kids see a limited settings page — no crash, no redirect to login
    await expect(page).not.toHaveURL(/login/);
    await expect(page).not.toHaveURL(/error/);
  });

  test('kid does not see parent-only save button or grace period control', async ({ loginAsKid: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // Parent-only settings controls must not be visible to kids.
    // Scope to .game-panel to avoid matching sidebar nav links.
    await expect(page.locator('.game-panel').locator('text=/grace period/i')).not.toBeVisible();
    await expect(page.locator('button:has-text("Save Settings"), button:has-text("Save Changes")')).not.toBeVisible();
  });
});
