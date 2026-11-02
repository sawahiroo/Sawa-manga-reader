import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  createIsolatedProfile,
  fixtureLibraryRoot,
  launchSawa,
  removeIsolatedProfile
} from './electronFixture.js';

test('an Explorer folder move keeps the category identity and all mapped data', async () => {
  test.setTimeout(90_000);
  const profile = createIsolatedProfile({ interfaceMode: 'sawa', mangaCount: 12, vaultUnlocked: true, vaultMangaCount: 2 });
  let running = null;
  try {
    running = await launchSawa(profile);
    await running.page.waitForTimeout(2200);
    const before = await running.page.evaluate(() => window.mangaAPI.bootstrap());
    const category = before.library.categories[0];
    const seedFavoriteId = Object.keys(before.persisted.favorites)[0];
    const seedProgress = Object.values(before.persisted.progress)[0];
    await running.page.evaluate(async ({ mangaId, progress }) => {
      await window.mangaAPI.toggleFavoriteLight(mangaId);
      await window.mangaAPI.toggleFavoriteLight(mangaId);
      await window.mangaAPI.updateProgressLight(progress);
    }, { mangaId: seedFavoriteId, progress: seedProgress });
    await running.application.close();
    running = null;

    const oldRoot = fixtureLibraryRoot(profile);
    const newRoot = path.join(profile, 'library-moved-by-explorer');
    fs.renameSync(oldRoot, newRoot);

    running = await launchSawa(profile);
    const unavailableSnapshot = await running.page.evaluate(() => window.mangaAPI.bootstrap());
    const favoriteId = Object.keys(unavailableSnapshot.persisted.favorites)[0];
    expect(favoriteId).toBeTruthy();
    const firstManga = [...unavailableSnapshot.library.allMangas, ...(unavailableSnapshot.vaultLibrary?.allMangas || [])]
      .find((manga) => manga.id === favoriteId);
    expect(firstManga).toBeTruthy();
    const inspected = await running.page.evaluate(
      ({ categoryId, targetPath }) => window.mangaAPI.inspectRelocation({ categoryId, targetPath }),
      { categoryId: category.id, targetPath: newRoot }
    );
    expect(inspected.ok).toBe(true);
    expect(inspected.plan.autoApplicable).toBe(true);
    expect(inspected.plan.exactCoverage).toBe(1);
    expect(inspected.plan.mangaMatches.length).toBeGreaterThanOrEqual(category.mangaCount);

    const applied = await running.page.evaluate((planId) => window.mangaAPI.applyRelocation(planId), inspected.plan.id);
    expect(applied.ok).toBe(true);
    const movedCategory = applied.payload.library.categories.find((entry) => entry.id === category.id);
    expect(movedCategory.path).toBe(newRoot);
    const firstMove = inspected.plan.mangaMatches.find((match) => match.fromMangaId === firstManga.id);
    const movedManga = applied.payload.library.allMangas.find((entry) => entry.id === firstMove.toMangaId);
    expect(movedManga).toBeTruthy();
    expect(movedManga.isFavorite).toBe(true);
    expect(movedManga.lastProgress.pageIndex).toBe(2);

    expect(applied.relocation).toMatchObject({ entityId: category.id, fromPath: oldRoot, toPath: newRoot });
    await running.application.close();
    running = await launchSawa(profile);
    const restored = await running.page.evaluate(() => window.mangaAPI.bootstrap());
    expect(restored.persisted.categories[0]).toMatchObject({ id: category.id, path: newRoot, availability: 'available' });
    expect(restored.persisted.favorites[firstMove.toMangaId]).toBe(true);
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});
