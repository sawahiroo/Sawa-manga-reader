import { expect, test } from '@playwright/test';
import {
  createIsolatedProfile,
  launchSawa,
  removeIsolatedProfile
} from './electronFixture.js';

test('Sawa ouvre et virtualise un Atelier de 500 oeuvres', async ({}, testInfo) => {
  const profile = createIsolatedProfile({
    interfaceMode: 'sawa',
    mangaCount: 500,
    vaultMangaCount: 0,
    workbenchMangaCount: 500,
    workbenchReviewCount: 120
  });
  let running = null;
  try {
    running = await launchSawa(profile);
    const { page } = running;
    const startedAt = Date.now();
    await page.locator('.sawa-sidebar-nav-menu .ps-menu-button').filter({ hasText: /Atelier/i }).click();
    const workbench = page.locator('.workbench-v2');
    await expect(workbench).toBeVisible();
    await expect(workbench.getByRole('heading', { name: /500 .*uvres/i })).toBeVisible();
    expect(Date.now() - startedAt).toBeLessThan(1000);

    const rows = workbench.locator('.workbench-table-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThan(40);
    await workbench.locator('.workbench-virtual-list').evaluate((node) => {
      node.scrollTop = 18_000;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(250);
    await expect(workbench.locator('.workbench-table-row').first()).toBeVisible();
    expect(await workbench.locator('.workbench-table-row').count()).toBeLessThan(40);

    await workbench.getByRole('button', { name: /Sélection multiple/i }).click();
    const first = workbench.locator('.workbench-table-row').first();
    await first.getByRole('checkbox').check();
    await workbench.locator('.workbench-table-row').nth(2).click({ modifiers: ['Shift'] });
    await expect.poll(async () => Number.parseInt(await workbench.locator('.workbench-selection-bar strong').textContent(), 10)).toBeGreaterThan(1);
    await workbench.getByRole('button', { name: /Tout le filtre/i }).click();
    await expect(workbench.locator('.workbench-selection-bar')).toContainText('500 sélectionnées');
    await workbench.getByRole('button', { name: 'Vider' }).click();

    await workbench.getByRole('button', { name: 'Vérifier 120', exact: true }).click();
    await expect(workbench.locator('.workbench-review-runway')).toContainText('1 / 120');
    await expect(workbench.locator('.workbench-visual-match')).toContainText('Dans ta bibliothèque');
    await expect(workbench.locator('.workbench-visual-match')).toContainText('Proposition retenue');
    await expect(workbench.getByRole('button', { name: /Accepter \+ suivant/i })).toBeEnabled();
    await workbench.getByRole('button', { name: /Garder local \+ suivant/i }).click();
    await expect(workbench.locator('.workbench-review-runway')).toContainText(/1 \/ 119|2 \/ 120/);
    await expect(workbench.locator('.workbench-inspector')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('workbench-500.png'), fullPage: false });
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});
