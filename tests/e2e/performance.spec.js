import { expect, test } from '@playwright/test';
import {
  createIsolatedProfile,
  launchSawa,
  percentile95,
  removeIsolatedProfile
} from './electronFixture.js';

const ITERATIONS = Math.max(3, Number.parseInt(process.env.SAWA_PERF_ITERATIONS || '5', 10));

test('demarrages froid et chaud respectent les budgets p95', async () => {
  const coldDurations = [];
  const warmDurations = [];

  for (let index = 0; index < ITERATIONS; index += 1) {
    const profile = createIsolatedProfile({ interfaceMode: 'sawa', diagnostics: true, representative: true });
    try {
      const cold = await launchSawa(profile);
      coldDurations.push(cold.usableMs);
      await cold.application.close();

      const warm = await launchSawa(profile);
      warmDurations.push(warm.usableMs);
      await warm.application.close();
    } finally {
      await removeIsolatedProfile(profile);
    }
  }

  const result = {
    samples: ITERATIONS,
    coldMs: coldDurations.map(Math.round),
    warmMs: warmDurations.map(Math.round),
    coldP95Ms: Math.round(percentile95(coldDurations)),
    warmP95Ms: Math.round(percentile95(warmDurations))
  };
  console.log(`SAWA_PERF_RESULT=${JSON.stringify(result)}`);
  expect(result.coldP95Ms).toBeLessThanOrEqual(4000);
  expect(result.warmP95Ms).toBeLessThanOrEqual(2000);
});

test('les mutations legeres restent sous 100 ms au p95 sans blocage de plus de 50 ms', async () => {
  const profile = createIsolatedProfile({ interfaceMode: 'sawa', diagnostics: true });
  let running = null;
  try {
    running = await launchSawa(profile);
    const result = await running.page.evaluate(async () => {
      const bootstrap = await window.mangaAPI.bootstrap();
      const mangaId = bootstrap?.library?.allMangas?.[0]?.id;
      if (!mangaId) throw new Error('Aucun manga de test disponible');
      // Le bootstrap a son propre budget. Laisser parvenir ses entrees
      // PerformanceObserver, puis borner cette mesure aux mutations ci-dessous.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const baselineStats = await window.mangaAPI.getStats({ includeDiagnostics: true });
      const baselineMeasurementCount = baselineStats?.diagnostics?.measurements?.length || 0;
      const durations = [];
      for (let index = 0; index < 20; index += 1) {
        const startedAt = performance.now();
        const mutation = await window.mangaAPI.toggleFavoriteLight(mangaId);
        durations.push(performance.now() - startedAt);
        if (!mutation?.ok) throw new Error(mutation?.error || 'Mutation refusee');
      }
      const stats = await window.mangaAPI.getStats({ includeDiagnostics: true });
      const diagnostics = stats?.diagnostics || null;
      return {
        durations,
        diagnostics: diagnostics ? {
          ...diagnostics,
          measurements: (diagnostics.measurements || []).slice(baselineMeasurementCount)
        } : null
      };
    });
    const p95 = percentile95(result.durations);
    const unresponsive = result.diagnostics?.measurements?.filter((item) => item.kind === 'renderer.unresponsive') || [];
    const longTasks = result.diagnostics?.measurements?.filter((item) => item.kind === 'renderer.longtask' && item.durationMs > 50) || [];
    console.log(`SAWA_INTERACTION_RESULT=${JSON.stringify({ p95Ms: Math.round(p95), samples: result.durations.length, unresponsive: unresponsive.length, longTasks: longTasks.length })}`);
    expect(p95).toBeLessThanOrEqual(100);
    expect(unresponsive).toHaveLength(0);
    expect(longTasks).toHaveLength(0);
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});

test('les suggestions et l entree en selection restent sous 100 ms au p95', async () => {
  const profile = createIsolatedProfile({ interfaceMode: 'sawa', diagnostics: true });
  let running = null;
  try {
    running = await launchSawa(profile);
    const result = await running.page.evaluate(async () => {
      const input = document.querySelector('.search-experience input[role="combobox"]');
      const initialCard = document.querySelector('.library-view [data-manga-id]');
      if (!(input instanceof HTMLInputElement) || !(initialCard instanceof HTMLElement)) {
        throw new Error('Controles de recherche ou de bibliotheque introuvables');
      }

      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const waitFor = async (predicate, timeoutMs = 2_000) => {
        const startedAt = performance.now();
        while (!predicate()) {
          if (performance.now() - startedAt > timeoutMs) throw new Error('Attente UI expiree');
          await nextFrame();
        }
      };
      const setSearch = (value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const baselineStats = await window.mangaAPI.getStats({ includeDiagnostics: true });
      const baselineMeasurementCount = baselineStats?.diagnostics?.measurements?.length || 0;

      const searchDurations = [];
      const searchQueries = ['eto', 'aoi', 'serie fixture', 'auteur'];
      for (let index = 0; index < 40; index += 1) {
        setSearch('');
        await waitFor(() => !document.querySelector('.search-suggestions [role="option"]'));
        const query = searchQueries[index % searchQueries.length];
        const startedAt = performance.now();
        setSearch(query);
        await waitFor(() => Boolean(document.querySelector('.search-suggestions [role="option"]')));
        searchDurations.push(performance.now() - startedAt);
      }
      setSearch('');
      await waitFor(() => !document.querySelector('.search-suggestions [role="option"]'));
      input.blur();
      // Isoler l'entree en selection du repeuplement de la grille provoque par
      // l'effacement de la derniere recherche. La mesure commence sur une vue
      // ordinaire stabilisee, comme les autres budgets d'interaction.
      await waitFor(() => document.querySelectorAll('.library-view [data-manga-id]').length > 1);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const selectionDurations = [];
      for (let index = 0; index < 40; index += 1) {
        const card = document.querySelector('.library-view [data-manga-id]');
        if (!(card instanceof HTMLElement)) throw new Error('Carte de bibliotheque introuvable');
        const startedAt = performance.now();
        card.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          clientX: 24,
          clientY: 24
        }));
        await waitFor(() => Boolean(document.querySelector('[role="toolbar"][aria-label="Actions sur la selection"]')));
        selectionDurations.push(performance.now() - startedAt);
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true
        }));
        await waitFor(() => !document.querySelector('[role="toolbar"][aria-label="Actions sur la selection"]'));
      }

      const stats = await window.mangaAPI.getStats({ includeDiagnostics: true });
      return {
        searchDurations,
        selectionDurations,
        diagnostics: {
          measurements: (stats?.diagnostics?.measurements || []).slice(baselineMeasurementCount)
        }
      };
    });

    const searchP95 = percentile95(result.searchDurations);
    const selectionP95 = percentile95(result.selectionDurations);
    const unresponsive = result.diagnostics.measurements.filter((item) => item.kind === 'renderer.unresponsive');
    const longTasks = result.diagnostics.measurements.filter((item) => item.kind === 'renderer.longtask' && item.durationMs > 50);
    console.log(`SAWA_SEARCH_SELECTION_RESULT=${JSON.stringify({
      searchP95Ms: Math.round(searchP95),
      selectionP95Ms: Math.round(selectionP95),
      searchSamples: result.searchDurations.length,
      selectionSamples: result.selectionDurations.length,
      unresponsive: unresponsive.length,
      longTasks: longTasks.length,
      searchMs: result.searchDurations.map(Math.round),
      selectionMs: result.selectionDurations.map(Math.round)
    })}`);
    expect(searchP95).toBeLessThanOrEqual(100);
    expect(selectionP95).toBeLessThanOrEqual(100);
    expect(unresponsive).toHaveLength(0);
    expect(longTasks).toHaveLength(0);
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});

test('la selection du Coffre reste sous 100 ms au p95 avec 500 oeuvres', async () => {
  const profile = createIsolatedProfile({
    interfaceMode: 'sawa',
    diagnostics: true,
    mangaCount: 500,
    vaultUnlocked: true,
    vaultMangaCount: 320
  });
  let running = null;
  try {
    running = await launchSawa(profile);
    const { page } = running;
    await page.locator('.sawa-sidebar-nav-menu .ps-menu-button').filter({ hasText: /Coffre/i }).click();
    await expect(page.locator('.vault-view')).toBeVisible();
    await page.locator('.vault-view').getByRole('button', { name: /Selection multiple/i }).click();
    const result = await page.evaluate(async () => {
      const waitFor = async (predicate, timeoutMs = 2_000) => {
        const startedAt = performance.now();
        while (!predicate()) {
          if (performance.now() - startedAt > timeoutMs) throw new Error('Attente selection Coffre expiree');
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      };
      const durations = [];
      for (let index = 0; index < 40; index += 1) {
        const card = document.querySelector('.vault-view [data-manga-id]');
        if (!(card instanceof HTMLElement)) throw new Error('Carte privee introuvable');
        const before = card.getAttribute('aria-selected');
        const startedAt = performance.now();
        card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 70, clientY: 120 }));
        await waitFor(() => card.getAttribute('aria-selected') !== before);
        durations.push(performance.now() - startedAt);
      }
      const stats = await window.mangaAPI.getStats({ includeDiagnostics: true });
      return { durations, measurements: stats?.diagnostics?.measurements || [] };
    });
    const selectionP95 = percentile95(result.durations);
    const unresponsive = result.measurements.filter((item) => item.kind === 'renderer.unresponsive');
    console.log(`SAWA_VAULT_SELECTION_RESULT=${JSON.stringify({
      p95Ms: Math.round(selectionP95),
      samples: result.durations.length,
      unresponsive: unresponsive.length
    })}`);
    expect(selectionP95).toBeLessThanOrEqual(100);
    expect(unresponsive).toHaveLength(0);
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});
