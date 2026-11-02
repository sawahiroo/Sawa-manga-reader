import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { createIsolatedProfile, removeIsolatedProfile } from './electronFixture.js';

const executablePath = String(process.env.SAWA_PACKAGED_EXE || '').trim();

test('l executable empaquete migre un profil historique vers v7', async () => {
  test.skip(!executablePath, 'Definir SAWA_PACKAGED_EXE pour le smoke test du paquet.');
  const profile = createIsolatedProfile({
    interfaceMode: 'sawa',
    mangaCount: 40,
    vaultUnlocked: true,
    vaultMangaCount: 12,
    workbenchMangaCount: 20
  });
  let application = null;
  try {
    application = await electron.launch({
      executablePath: path.resolve(executablePath),
      env: {
        ...process.env,
        SAWA_USER_DATA_PATH: profile,
        SAWA_PERF_DIAGNOSTICS: '1'
      }
    });
    await application.firstWindow();
    await expect.poll(() => application.windows().some((window) => window.url().startsWith('file:')), {
      timeout: 20_000,
      message: 'La fenêtre principale empaquetée doit remplacer le splash screen.'
    }).toBe(true);
    const page = application.windows().find((window) => window.url().startsWith('file:'));
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 });
    const snapshot = await page.evaluate(() => window.mangaAPI.bootstrap());
    expect(snapshot.persisted).toMatchObject({ version: 7, stateVersion: 7 });
    expect(snapshot.library.allMangas.length).toBeGreaterThan(0);
    const providers = await page.evaluate(() => window.mangaAPI.listMetadataProviders());
    expect(providers.map((provider) => provider.id)).toEqual(expect.arrayContaining(['mangadex', 'anilist', 'nhentai', 'imhentai', 'hentaiera']));
    await page.locator('.sawa-sidebar-nav-menu .ps-menu-button').filter({ hasText: /Atelier/i }).click();
    await expect(page.locator('.workbench-v2')).toBeVisible();
  } finally {
    await application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});
