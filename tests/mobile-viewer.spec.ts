import fs from 'fs';
import path from 'path';

import { test, expect } from '@playwright/test';

const traceName = 'sample.zip';

test.beforeAll(async ({ browser }) => {
  // Record a trace with the same Playwright version the viewer comes from.
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  await page.setContent('<button onclick="this.textContent = \'Clicked\'">Click me</button>');
  await page.getByRole('button', { name: 'Click me' }).click();
  await expect(page.getByRole('button')).toHaveText('Clicked');
  const tracePath = path.join(import.meta.dirname, '.traces', traceName);
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  await context.tracing.stop({ path: tracePath });
  await context.close();
});

test('loads a trace from the current Playwright version', async ({ page }) => {
  await page.goto(`/index.html?trace=/traces/${traceName}`);
  await expect(page.getByText('Click me').first()).toBeVisible();
  await expect(page.getByText(/created by a newer version/)).toHaveCount(0);
});

test('mobile workbench fits the visual viewport in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/index.html?trace=/traces/${traceName}`);

  const mobileWorkbench = page.locator('.workbench-mobile-landscape');
  await expect(mobileWorkbench).toBeVisible();
  await expect(page.locator('.mobile-pane-tabs')).toBeVisible();

  await expect.poll(async () => {
    const box = await mobileWorkbench.boundingBox();
    return box && { width: Math.round(box.width), height: Math.round(box.height) };
  }).toEqual({ width: 390, height: 844 });
});
