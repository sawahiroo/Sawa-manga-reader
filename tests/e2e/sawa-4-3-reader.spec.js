import { expect, test } from '@playwright/test';
import { createIsolatedProfile, launchSawa, removeIsolatedProfile } from './electronFixture.js';

async function selectHorizonReaderMode(page, mode) {
  const settings = page.locator('[data-reader-tool="settings"]');
  if (await settings.count()) {
    await settings.click();
  }
  await page.getByRole('button', { name: mode, exact: true }).click();
}

test.describe('Sawa 4.3 reader navigation', () => {
  let running;
  let profile;

  test.beforeEach(async () => {
    profile = createIsolatedProfile({ interfaceMode: 'sawa', mangaCount: 12 });
    running = await launchSawa(profile);
  });

  test.afterEach(async () => {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  });

  test('a thumbnail opens the exact requested page instead of global progress', async () => {
    await running.page.locator(`${running.librarySelector} [data-manga-id]`).first().click();
    await expect(running.page.locator('.detail-view')).toBeVisible();
    await running.page.locator('.chapter-grid .chapter-card').first().click();
    await expect(running.page.locator('.preview-view')).toBeVisible();

    await running.page.locator('.page-preview-grid .page-thumb').nth(2).click();
    await expect(running.page.locator('.reader-shell')).toBeVisible();
    await expect(running.page.locator('.reader-entry-notice')).toContainText('Page 3 ouverte');
    await expect(running.page.locator('.reader-page[alt="Page 3"]')).toBeVisible();
  });

  test('reader progress persistence never replays the entry page during interaction', async () => {
    await running.page.locator(`${running.librarySelector} [data-manga-id]`).first().click();
    await running.page.locator('.chapter-grid .chapter-card').first().click();
    await running.page.locator('.page-preview-grid .page-thumb').first().click();
    await expect(running.page.locator('.reader-page[alt="Page 1"]')).toBeVisible();

    const nextPageButton = await running.page.locator('.reader-nav-right').boundingBox();
    expect(nextPageButton).not.toBeNull();
    await running.page.mouse.click(
      nextPageButton.x + nextPageButton.width / 2,
      nextPageButton.y + nextPageButton.height / 2
    );
    await expect(running.page.locator('.reader-page[alt="Page 2"]')).toBeVisible();
    await running.page.waitForTimeout(900);
    await expect(running.page.locator('.reader-page[alt="Page 2"]')).toBeVisible();

    await running.page.addStyleTag({ content: '.webtoon-page { width: 800px !important; height: 1200px !important; object-fit: contain; }' });
    await selectHorizonReaderMode(running.page, 'Webtoon');
    const webtoon = running.page.locator('.webtoon-stage');
    await expect(webtoon).toBeVisible();
    await webtoon.evaluate((node) => { node.scrollTop = 600; });
    await expect.poll(() => webtoon.evaluate((node) => node.scrollTop)).toBeGreaterThan(500);
    await running.page.waitForTimeout(900);
    await expect.poll(() => webtoon.evaluate((node) => node.scrollTop)).toBeGreaterThan(500);
  });

  test('the webtoon reader restores the selected page only once', async () => {
    await running.page.locator(`${running.librarySelector} [data-manga-id]`).first().click();
    await running.page.locator('.chapter-grid .chapter-card').first().click();
    await running.page.locator('.page-preview-grid .page-thumb').nth(2).click();
    await running.page.addStyleTag({ content: '.webtoon-page { width: 800px !important; height: 1200px !important; object-fit: contain; }' });
    await selectHorizonReaderMode(running.page, 'Webtoon');
    const webtoon = running.page.locator('.webtoon-stage');
    await expect(webtoon).toBeVisible();
    await expect.poll(() => webtoon.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const restored = await webtoon.evaluate((node) => node.scrollTop);
    await running.page.waitForTimeout(350);
    expect(Math.abs((await webtoon.evaluate((node) => node.scrollTop)) - restored)).toBeLessThanOrEqual(2);
  });

  test('two tabs keep independent webtoon positions across a restart', async () => {
    const tallPages = '.webtoon-page { width: 800px !important; height: 1200px !important; object-fit: contain; }';
    await running.page.addStyleTag({ content: tallPages });
    await running.page.locator(`${running.librarySelector} [data-manga-id]`).first().click();
    await running.page.locator('.chapter-grid .chapter-card').first().click();
    await running.page.locator('.page-preview-grid .page-thumb').nth(2).click();
    await selectHorizonReaderMode(running.page, 'Webtoon');
    const firstTabId = await running.page.locator('.browser-tab-active').getAttribute('data-tab-id');
    const firstReader = running.page.locator('.webtoon-stage');
    await expect.poll(() => firstReader.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
    await firstReader.evaluate((node) => { node.scrollTop += 150; });
    await running.page.waitForTimeout(350);
    const firstScroll = await firstReader.evaluate((node) => node.scrollTop);

    await running.page.locator('.tabsbar-new').click();
    await running.page.locator(`${running.librarySelector} [data-manga-id]`).nth(1).click();
    await running.page.locator('.chapter-grid .chapter-card').first().click();
    await running.page.locator('.page-preview-grid .page-thumb').first().click();
    await selectHorizonReaderMode(running.page, 'Webtoon');
    await expect.poll(() => running.page.locator('.webtoon-stage').evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(2);

    await running.page.locator(`[data-tab-id="${firstTabId}"]`).click();
    await expect.poll(() => running.page.locator('.webtoon-stage').evaluate((node) => node.scrollTop))
      .toBeGreaterThan(firstScroll - 3);
    await running.page.locator('.tabsbar-new').click();
    await running.page.waitForTimeout(800);
    await running.application.close();

    running = await launchSawa(profile);
    await running.page.addStyleTag({ content: tallPages });
    await running.page.locator(`[data-tab-id="${firstTabId}"]`).click();
    await expect(running.page.locator('.webtoon-stage')).toBeVisible();
    await expect.poll(() => running.page.locator('.webtoon-stage').evaluate((node) => node.scrollTop))
      .toBeGreaterThan(firstScroll - 3);
  });
});
