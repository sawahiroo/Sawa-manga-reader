import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createIsolatedProfile, launchSawa, removeIsolatedProfile, REPO_ROOT } from './electronFixture.js';

test('Horizon est le shell Sawa par defaut et Classique reste disponible', async () => {
  const profile = createIsolatedProfile({ interfaceMode: 'sawa', mangaCount: 36 });
  let running = null;
  try {
    running = await launchSawa(profile);
    const { page } = running;
    await expect(page.locator('.app-shell.sawa-horizon')).toBeVisible();
    await expect(page.locator('.horizon-hero')).toBeVisible();
    await expect(page.locator('.mc-horizon').first()).toBeVisible();
    await expect(page.locator('.titlebar')).toHaveCSS('height', '32px');
    await expect(page.locator('.sidebar-panel')).toHaveCSS('width', '216px');
    await page.locator('.horizon-resume-copy h2').evaluate((node) => {
      node.textContent = 'Mushoku no Eiyuu: Betsu ni Skill Nanka Iranakatta nda ga - Sainou Zero no Nariagari et la chronique au titre volontairement tres long';
    });
    await page.locator('.page-subtitle').evaluate((node) => {
      node.textContent = 'Vue globale de toute la bibliotheque avec un libelle volontairement tres long pour verifier la troncature';
    });
    const layoutAudit = await page.evaluate(() => {
      const titlebar = document.querySelector('.titlebar')?.getBoundingClientRect();
      const layout = document.querySelector('.layout-shell')?.getBoundingClientRect();
      const topbar = document.querySelector('.topbar-shell')?.getBoundingClientRect();
      const hero = document.querySelector('.horizon-hero')?.getBoundingClientRect();
      const heroContent = [...document.querySelectorAll('.horizon-hero h2, .horizon-hero .horizon-resume-action, .horizon-hero .horizon-recents')]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.getBoundingClientRect());
      const cards = [...document.querySelectorAll('.manga-grid-row .mc')]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.getBoundingClientRect());
      const intersects = cards.some((card, index) => cards.slice(index + 1).some((other) => (
        card.left < other.right && card.right > other.left && card.top < other.bottom && card.bottom > other.top
      )));
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        intersects,
        shellGap: titlebar && layout ? layout.top - titlebar.bottom : null,
        topbarHeroGap: topbar && hero ? hero.top - topbar.bottom : null,
        topbarInside: topbar ? topbar.left >= 0 && topbar.right <= window.innerWidth + 1 : false,
        heroContentInside: hero ? heroContent.every((rect) => rect.left >= hero.left - 1 && rect.right <= hero.right + 1 && rect.top >= hero.top - 1 && rect.bottom <= hero.bottom + 1) : false
      };
    });
    expect(layoutAudit.overflow).toBeLessThanOrEqual(1);
    expect(layoutAudit.intersects).toBe(false);
    expect(Math.abs(layoutAudit.shellGap)).toBeLessThanOrEqual(1);
    expect(layoutAudit.topbarHeroGap).toBeGreaterThanOrEqual(30);
    expect(layoutAudit.topbarInside).toBe(true);
    expect(layoutAudit.heroContentInside).toBe(true);
    await page.screenshot({ path: path.join(REPO_ROOT, 'test-results', 'sawa-5-0-1-horizon-library.png'), fullPage: false });

    await page.locator('.topbar-sidebar-toggle').click();
    await expect(page.locator('.sidebar-panel')).toHaveCSS('width', '72px');
    await expect(page.locator('.sawa-sidebar-panel .ps-menu-label').first()).toBeHidden();
    const collapsedAudit = await page.evaluate(() => {
      const sidebar = document.querySelector('.sawa-sidebar-panel')?.getBoundingClientRect();
      const settings = document.querySelector('.sawa-sidebar-settings-button')?.getBoundingClientRect();
      const firstNavButton = document.querySelector('.sawa-sidebar-nav-menu .ps-menu-button')?.getBoundingClientRect();
      return {
        sidebarInside: sidebar ? sidebar.left >= 0 && sidebar.right <= window.innerWidth + 1 : false,
        settingsInside: settings ? settings.top >= 0 && settings.bottom <= window.innerHeight + 1 : false,
        navLeftGap: sidebar && firstNavButton ? firstNavButton.left - sidebar.left : null,
        navRightGap: sidebar && firstNavButton ? sidebar.right - firstNavButton.right : null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    expect(collapsedAudit.sidebarInside).toBe(true);
    expect(collapsedAudit.settingsInside).toBe(true);
    expect(collapsedAudit.navLeftGap).toBeGreaterThanOrEqual(13);
    expect(collapsedAudit.navRightGap).toBeGreaterThanOrEqual(13);
    expect(Math.abs(collapsedAudit.navLeftGap - collapsedAudit.navRightGap)).toBeLessThanOrEqual(1);
    expect(collapsedAudit.overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(REPO_ROOT, 'test-results', 'sawa-5-0-1-horizon-library-collapsed.png'), fullPage: false });
    await page.locator('.topbar-sidebar-toggle').click();
    await expect(page.locator('.sidebar-panel')).toHaveCSS('width', '216px');

    await page.setViewportSize({ width: 1280, height: 720 });
    const narrowAudit = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      topbarRight: document.querySelector('.topbar-shell')?.getBoundingClientRect().right || 0,
      viewportRight: window.innerWidth,
      heroRight: document.querySelector('.horizon-hero')?.getBoundingClientRect().right || 0
    }));
    expect(narrowAudit.overflow).toBeLessThanOrEqual(1);
    expect(narrowAudit.topbarRight).toBeLessThanOrEqual(narrowAudit.viewportRight + 1);
    expect(narrowAudit.heroRight).toBeLessThanOrEqual(narrowAudit.viewportRight + 1);
    await page.setViewportSize({ width: 2048, height: 1152 });

    await page.getByRole('button', { name: /Parametres/i }).last().click();
    await expect(page.getByText('Expérience Sawa')).toBeVisible();
    await page.getByRole('button', { name: 'Sawa classique', exact: true }).click();
    await expect(page.locator('.app-shell.sawa-classic')).toBeVisible();
    await expect(page.locator('.horizon-hero')).toHaveCount(0);
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});

test('le lecteur Horizon replie la navigation et masque ses commandes', async () => {
  const profile = createIsolatedProfile({ interfaceMode: 'sawa', theme: 'neon-city', mangaCount: 8 });
  let running = null;
  try {
    running = await launchSawa(profile);
    const { page } = running;
    await page.locator('.mc-horizon').first().click();
    await expect(page.locator('.detail-view')).toBeVisible();
    const detailOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(detailOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(REPO_ROOT, 'test-results', 'sawa-5-0-1-detail.png'), fullPage: false });
    const readButton = page.getByRole('button', { name: /Lire|Continuer/i }).first();
    if (await readButton.count()) await readButton.click();
    const chapter = page.locator('.chapter-card').first();
    if (await chapter.count()) await chapter.click();
    const startReading = page.getByRole('button', { name: /Lire depuis le d.but/i }).first();
    if (await startReading.count()) await startReading.click();
    const reader = page.locator('.reader-horizon');
    await expect(reader).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveClass(/sawa-reader-focus/);
    await expect(page.locator('.sidebar-panel')).toHaveCSS('width', '0px');
    await expect(page.locator('.reader-horizon-chapter-capsule')).toBeVisible();
    await expect(page.locator('.reader-horizon-progress')).toBeVisible();
    await expect(page.locator('.reader-horizon-tool-rail')).toBeVisible();
    const readerLayoutAudit = await page.evaluate(() => {
      const titlebar = document.querySelector('.titlebar')?.getBoundingClientRect();
      const layout = document.querySelector('.layout-shell')?.getBoundingClientRect();
      const reader = document.querySelector('.reader-horizon');
      const stage = document.querySelector('.reader-horizon .reader-stage, .reader-horizon .webtoon-stage');
      const capsule = document.querySelector('.reader-horizon-chapter-capsule');
      const label = capsule?.querySelector('label');
      const hiddenLabel = capsule?.querySelector('.sr-only');
      const range = document.querySelector('.reader-horizon-progress input');
      const background = reader ? getComputedStyle(reader).backgroundColor : '';
      const stageBackground = stage ? getComputedStyle(stage).backgroundColor : '';
      const alphaMatch = background.match(/rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/);
      const stageAlphaMatch = stageBackground.match(/rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/);
      return {
        shellGap: titlebar && layout ? layout.top - titlebar.bottom : null,
        readerAlpha: alphaMatch?.[1] == null ? 1 : Number(alphaMatch[1]),
        stageAlpha: stageAlphaMatch?.[1] == null ? 1 : Number(stageAlphaMatch[1]),
        capsuleLabelHeight: label?.getBoundingClientRect().height || 0,
        hiddenLabelWidth: hiddenLabel?.getBoundingClientRect().width || 0,
        rangeTransform: range ? getComputedStyle(range).transform : 'none'
      };
    });
    expect(Math.abs(readerLayoutAudit.shellGap)).toBeLessThanOrEqual(1);
    expect(readerLayoutAudit.readerAlpha).toBe(0);
    expect(readerLayoutAudit.stageAlpha).toBeGreaterThanOrEqual(0.34);
    expect(readerLayoutAudit.stageAlpha).toBeLessThanOrEqual(0.42);
    expect(readerLayoutAudit.capsuleLabelHeight).toBeLessThanOrEqual(28);
    expect(readerLayoutAudit.hiddenLabelWidth).toBeLessThanOrEqual(1);
    expect(readerLayoutAudit.rangeTransform).not.toBe('none');
    const progressInput = page.locator('.reader-horizon-progress input');
    const progressBox = await progressInput.boundingBox();
    expect(progressBox).not.toBeNull();
    await progressInput.click({ position: { x: Math.max(1, progressBox.width / 2), y: Math.max(1, progressBox.height - 2) } });
    await expect(page.locator('.reader-horizon-position')).toHaveText('4/4');
    await progressInput.click({ position: { x: Math.max(1, progressBox.width / 2), y: 2 } });
    await expect(page.locator('.reader-horizon-position')).toHaveText('1/4');
    await page.locator('[data-reader-tool="settings"]').click();
    await expect(page.locator('.reader-horizon-settings')).toBeVisible();
    await expect(page.locator('.reader-horizon-settings')).toContainText('Lecture');
    await page.getByRole('button', { name: 'Webtoon', exact: true }).click();
    const firstWebtoonPage = page.locator('.webtoon-page').first();
    await expect(firstWebtoonPage).toBeVisible();
    const widthFit = await firstWebtoonPage.evaluate((node) => node.getBoundingClientRect().width);
    await page.getByRole('button', { name: 'Hauteur', exact: true }).click();
    await expect(firstWebtoonPage).toHaveCSS('height', /px/);
    const heightFit = await firstWebtoonPage.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
      viewportHeight: window.innerHeight
    }));
    expect(heightFit.height).toBeLessThanOrEqual(heightFit.viewportHeight - 42);
    expect(Math.abs(heightFit.width - widthFit)).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await expect(firstWebtoonPage).toHaveCSS('max-width', 'none');
    await page.locator('[data-reader-tool="settings"]').click();
    await page.screenshot({ path: path.join(REPO_ROOT, 'test-results', 'sawa-5-0-1-reader.png'), fullPage: false });
    await page.waitForTimeout(3200);
    await expect(reader).toHaveClass(/reader-shell-ui-hidden/);
    await page.keyboard.press('H');
    await expect(reader).not.toHaveClass(/reader-shell-ui-hidden/);
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});

test('le Coffre verrouille masque les controles et utilise le nouvel ecran generique', async () => {
  const profile = createIsolatedProfile({ interfaceMode: 'sawa', mangaCount: 12, vaultUnlocked: false, vaultMangaCount: 2 });
  let running = null;
  try {
    running = await launchSawa(profile);
    const { page } = running;
    await page.locator('.sawa-sidebar-nav-menu .ps-menu-button').filter({ hasText: /Coffre/i }).click();
    await expect(page.locator('.vault-unlock-stage')).toBeVisible();
    await expect(page.locator('.topbar-shell')).toHaveCount(0);
    await expect(page.locator('.vault-view .mc-horizon')).toHaveCount(0);
    await expect(page.locator('.vault-lock-emblem')).toBeVisible();
    await page.getByLabel('Code PIN').fill('0000');
    await page.getByRole('button', { name: /Deverrouiller/i }).click();
    await expect(page.getByRole('alert')).toContainText('incorrect');
    await page.screenshot({ path: path.join(REPO_ROOT, 'test-results', 'sawa-5-0-1-vault-locked.png'), fullPage: false });
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});

test('le Coffre deverrouille conserve un en-tete Horizon sans debordement', async () => {
  const profile = createIsolatedProfile({ interfaceMode: 'sawa', mangaCount: 24, vaultUnlocked: true, vaultMangaCount: 4 });
  let running = null;
  try {
    running = await launchSawa(profile);
    const { page } = running;
    await page.locator('.sawa-sidebar-nav-menu .ps-menu-button').filter({ hasText: /Coffre/i }).click();
    await expect(page.locator('.topbar-shell')).toBeVisible();
    await expect(page.locator('.vault-view .mc-horizon').first()).toBeVisible();
    const audit = await page.evaluate(() => {
      const topbar = document.querySelector('.topbar-shell')?.getBoundingClientRect();
      const hero = document.querySelector('.vault-hero')?.getBoundingClientRect();
      const controls = [...document.querySelectorAll('.topbar-right > *')]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.getBoundingClientRect());
      const heroChildren = [...document.querySelectorAll('.vault-hero > *')]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.getBoundingClientRect());
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        inside: topbar ? controls.every((rect) => rect.left >= topbar.left - 1 && rect.right <= topbar.right + 1) : false,
        vaultInside: hero ? heroChildren.every((rect) => rect.left >= hero.left - 1 && rect.right <= hero.right + 1 && rect.top >= hero.top - 1 && rect.bottom <= hero.bottom + 1) : false,
        vaultOverlap: heroChildren.length === 2
          ? heroChildren[0].left < heroChildren[1].right && heroChildren[0].right > heroChildren[1].left && heroChildren[0].top < heroChildren[1].bottom && heroChildren[0].bottom > heroChildren[1].top
          : false
      };
    });
    expect(audit.overflow).toBeLessThanOrEqual(1);
    expect(audit.inside).toBe(true);
    expect(audit.vaultInside).toBe(true);
    expect(audit.vaultOverlap).toBe(false);
    await page.setViewportSize({ width: 1280, height: 720 });
    const narrowAudit = await page.evaluate(() => {
      const topbar = document.querySelector('.topbar-shell')?.getBoundingClientRect();
      const hero = document.querySelector('.vault-hero')?.getBoundingClientRect();
      const heroChildren = [...document.querySelectorAll('.vault-hero > *')]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.getBoundingClientRect());
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        topbarInside: topbar ? topbar.left >= 0 && topbar.right <= window.innerWidth + 1 : false,
        vaultInside: hero ? heroChildren.every((rect) => rect.left >= hero.left - 1 && rect.right <= hero.right + 1) : false
      };
    });
    expect(narrowAudit.overflow).toBeLessThanOrEqual(1);
    expect(narrowAudit.topbarInside).toBe(true);
    expect(narrowAudit.vaultInside).toBe(true);
    await page.screenshot({ path: path.join(REPO_ROOT, 'test-results', 'sawa-5-0-1-vault-unlocked.png'), fullPage: false });
  } finally {
    await running?.application?.close().catch(() => {});
    await removeIsolatedProfile(profile);
  }
});
