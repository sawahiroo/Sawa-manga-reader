import { expect, test } from '@playwright/test';
import {
  createIsolatedProfile,
  launchSawa,
  removeIsolatedProfile,
  scrollToStableOffset
} from './electronFixture.js';

function searchInput(page) {
  return page.locator('.search-experience input[role="combobox"]').first();
}

async function clearSearch(page) {
  const clear = page.getByRole('button', { name: /Effacer la recherche/i }).first();
  if (await clear.count()) await clear.click();
}

for (const interfaceMode of ['sawa', 'kavita']) {
  test(`${interfaceMode} recherche clavier accents portee filtres et protege le coffre`, async () => {
    const profile = createIsolatedProfile({ interfaceMode });
    let running = null;
    try {
      running = await launchSawa(profile);
      const { page } = running;
      const input = searchInput(page);
      await input.fill('eto');
      const suggestions = page.locator('.search-suggestions [role="option"]');
      await expect(suggestions.first()).toBeVisible();
      await expect(suggestions.first()).toContainText(/toile du Matin/i);
      await input.press('ArrowDown');
      await expect(suggestions.first()).toHaveAttribute('aria-selected', 'true');
      await input.press('Enter');
      await expect(input).toHaveValue(/toile du Matin/i);
      await expect(page.locator('.search-experience-count')).toContainText(/1 resultat/);

      await page.locator('.search-experience-scope select').selectOption('all');
      await expect(page.locator('.search-experience-scope select')).toHaveValue('all');
      await clearSearch(page);

      await page.getByRole('button', { name: /Filtres|Ajouter un filtre/i }).first().click();
      const builder = page.getByRole('dialog', { name: 'Constructeur de filtres' });
      await expect(builder).toBeVisible();
      await builder.getByLabel('Champ').selectOption('tag');
      await builder.getByLabel('Valeur').fill('Aventure locale');
      await builder.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await expect(page.locator('.search-experience-chip')).toContainText('Aventure locale');
      await expect(page.locator('.search-experience-count')).toContainText(/1 resultat/);

      await page.getByRole('button', { name: /Retirer Tag/i }).click();
      await input.fill('Secret du Coffre');
      await expect(page.locator('.search-zero-state')).toBeVisible();
      await expect(page.locator(`${running.librarySelector} [data-manga-id]`)).toHaveCount(0);
    } finally {
      await running?.application?.close().catch(() => {});
      await removeIsolatedProfile(profile);
    }
  });
}

test('les recherches incognito ne persistent ni requete ni historique', async () => {
  const profile = createIsolatedProfile({ interfaceMode: 'sawa', incognito: true });
  let running = null;
  try {
    running = await launchSawa(profile);
    await searchInput(running.page).fill('Aoi Testeur');
    await searchInput(running.page).press('Enter');
    await running.application.close();

    running = await launchSawa(profile);
    const input = searchInput(running.page);
    await expect(input).toHaveValue('');
    await input.focus();
    await expect(running.page.getByText('Recherches recentes')).toHaveCount(0);
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});

test('Sawa selectionne vraiment les cartes privees dans un Coffre virtualise', async () => {
  const profile = createIsolatedProfile({
    interfaceMode: 'sawa',
    mangaCount: 500,
    vaultUnlocked: true,
    vaultMangaCount: 320
  });
  let running = null;
  try {
    running = await launchSawa(profile);
    const { page } = running;
    await page.locator('.sawa-sidebar-nav-menu .ps-menu-button').filter({ hasText: /Coffre/i }).click();
    const vault = page.locator('.vault-view');
    await expect(vault).toBeVisible();
    await vault.getByRole('button', { name: /Selection multiple/i }).click();
    const first = vault.locator('[data-manga-id]').first();
    await first.click({ position: { x: 70, y: 120 } });
    const toolbar = page.getByRole('toolbar', { name: 'Actions sur la selection' });
    await expect(toolbar).toContainText('1 selection');
    await expect(first).toHaveAttribute('aria-selected', 'true');

    const checkbox = first.getByRole('checkbox');
    await checkbox.uncheck();
    await expect(toolbar).toContainText('0 selection');
    await first.focus();
    await page.keyboard.press('Space');
    await expect(toolbar).toContainText('1 selection');
    const firstId = await first.getAttribute('data-manga-id');
    await toolbar.getByRole('button', { name: 'Favori', exact: true }).click();
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.mangaAPI.bootstrap());
      return Boolean(snapshot.persisted.favorites[firstId]);
    }).toBe(true);
    await expect(toolbar).toBeVisible();

    await scrollToStableOffset(page, '.vault-grid-virtual', 3200);
    const far = vault.locator('[data-manga-id]').last();
    await far.click({ modifiers: ['Shift'], position: { x: 70, y: 120 } });
    const count = Number.parseInt(await toolbar.locator('.bulk-action-copy-badge').innerText(), 10);
    expect(count).toBeGreaterThan(5);
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});

for (const interfaceMode of ['sawa', 'kavita']) {
  test(`${interfaceMode} selection Ctrl Maj virtualisee filtre onglet action et annulation`, async () => {
    const profile = createIsolatedProfile({ interfaceMode });
    let running = null;
    try {
      running = await launchSawa(profile);
      const { page, librarySelector } = running;
      const first = page.locator(`${librarySelector} [data-manga-id]`).first();
      await first.click({ modifiers: ['Control'], position: { x: 24, y: 24 } });
      const toolbar = page.getByRole('toolbar', { name: 'Actions sur la selection' });
      await expect(toolbar).toBeVisible();
      await expect(toolbar).toContainText('1 selection');

      await scrollToStableOffset(page, librarySelector, 2600);
      const farCard = page.locator(`${librarySelector} [data-manga-id]`).last();
      await farCard.click({ modifiers: ['Shift'], position: { x: 24, y: 24 } });
      const selectionCount = await toolbar.locator('.bulk-action-copy-badge').innerText();
      expect(Number.parseInt(selectionCount, 10)).toBeGreaterThan(5);

      await searchInput(page).fill('Serie Fixture 084');
      await expect(toolbar).toContainText(/masquee/);
      await clearSearch(page);

      await searchInput(page).evaluate((node) => node.blur());
      const activeTab = interfaceMode === 'kavita'
        ? page.locator('[data-kv-tab-id].kv-tab.is-active').first()
        : page.locator('[data-tab-id].browser-tab-active').first();
      const activeTabId = await activeTab.getAttribute(interfaceMode === 'kavita' ? 'data-kv-tab-id' : 'data-tab-id');
      await page.keyboard.press('Control+t');
      await expect(toolbar).toHaveCount(0);
      const originalTab = interfaceMode === 'kavita'
        ? page.locator(`[data-kv-tab-id="${activeTabId}"]`)
        : page.locator(`[data-tab-id="${activeTabId}"]`);
      await originalTab.click();
      await expect(toolbar).toBeVisible();

      await toolbar.getByRole('button', { name: 'Favori', exact: true }).click();
      await expect(toolbar).toBeVisible();
      await expect(toolbar.getByRole('button', { name: /Annuler favoris/ })).toBeVisible();
      await toolbar.getByRole('button', { name: /Annuler favoris/ }).click();
      await page.keyboard.press('Escape');
      await expect(toolbar).toHaveCount(0);
    } finally {
      await running?.application?.close().catch(() => {});
      await removeIsolatedProfile(profile);
    }
  });
}
