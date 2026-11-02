import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
  return true;
}

function sourceProfilePath() {
  const explicit = String(process.env.SAWA_E2E_SOURCE_PROFILE || '').trim();
  if (explicit) return path.resolve(explicit);
  const appData = String(process.env.APPDATA || '').trim();
  return appData ? path.join(appData, 'sawa-manga-library') : '';
}

function hashFromString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function makeFixtureId(prefix, absolutePath) {
  return `${prefix}_${hashFromString(absolutePath)}`;
}

function buildTestSession({ incognito = false } = {}) {
  return {
    version: 5,
    searchPrivacyVersion: 1,
    activeWorkspaceId: 'e2e-workspace',
    workspaces: [{
      id: 'e2e-workspace',
      name: 'E2E',
      iconKey: 'library',
      activeTabId: 'e2e-tab',
      tabs: [{
        id: 'e2e-tab',
        pinned: false,
        incognito,
        searchPrivate: false,
        searchState: { query: '', scope: 'current', filters: [] },
        stack: [{ screen: 'library', mangaId: null, chapterId: null, pageIndex: 0, readerState: null }]
      }]
    }],
    scrollPositions: {}
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createFixturePng(seed = 0) {
  const width = 48;
  const height = 72;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const baseHue = (Number(seed) * 37) % 180;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + (x * 4);
      const panel = ((x >> 3) + (y >> 3)) % 2;
      raw[offset] = Math.min(245, 64 + baseHue + panel * 42);
      raw[offset + 1] = Math.min(245, 88 + ((seed * 19 + y * 2) % 120));
      raw[offset + 2] = Math.min(245, 118 + ((seed * 13 + x * 3) % 110));
      raw[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND')
  ]);
}

function createSeedLibrary(profileRoot, mangaCount = 84) {
  const libraryRoot = path.join(profileRoot, 'fixture-library');
  fs.mkdirSync(libraryRoot, { recursive: true });
  const mangas = [];

  for (let index = 0; index < mangaCount; index += 1) {
    const folderName = index === 0
      ? 'Etoile du Matin'
      : index === 1
        ? 'Etoile du Matin - Edition Couleur'
        : index === 2
          ? 'Secret du Coffre'
          : `Serie Fixture ${String(index + 1).padStart(3, '0')}`;
    const mangaPath = path.join(libraryRoot, folderName);
    const chapterCount = index < 3 ? 3 : 1;
    fs.mkdirSync(mangaPath, { recursive: true });
    const chapterPaths = [];
    for (let chapterIndex = 0; chapterIndex < chapterCount; chapterIndex += 1) {
      const chapterPath = path.join(mangaPath, `Chapitre ${String(chapterIndex + 1).padStart(2, '0')}`);
      fs.mkdirSync(chapterPath, { recursive: true });
      for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
        fs.writeFileSync(
          path.join(chapterPath, `${String(pageIndex + 1).padStart(3, '0')}.png`),
          createFixturePng((index * 97) + (chapterIndex * 17) + pageIndex)
        );
      }
      chapterPaths.push(chapterPath);
    }
    mangas.push({
      index,
      path: mangaPath,
      id: makeFixtureId('manga', mangaPath),
      chapters: chapterPaths.map((chapterPath) => ({
        path: chapterPath,
        id: makeFixtureId('chapter', chapterPath)
      }))
    });
  }

  return { libraryRoot, mangas };
}

function buildSeedState(profileRoot, { interfaceMode, diagnostics, theme = 'dark-night', incognito = false, mangaCount = 84, vaultUnlocked = false, vaultMangaCount = 1, workbenchMangaCount = 0, workbenchReviewCount = 0 }) {
  const { libraryRoot, mangas } = createSeedLibrary(profileRoot, mangaCount);
  const first = mangas[0];
  const second = mangas[1];
  const secret = mangas[2];
  const metadata = Object.fromEntries(mangas.map((manga) => [
    manga.id,
    {
      title: manga.index === 0
        ? 'Étoile du Matin'
        : manga.index === 1
          ? 'Étoile du Matin — Édition couleur'
          : manga.index === 2
            ? 'Secret du Coffre'
            : `Série Fixture ${String(manga.index + 1).padStart(3, '0')}`,
      author: manga.index < 2 ? 'Aoi Testeur' : `Auteur ${manga.index % 7}`,
      aliases: manga.index === 0 ? ['Morning Star', 'Etoile Matin'] : [],
      description: `Description locale de test ${manga.index + 1}`
    }
  ]));

  const collectionId = 'collection-e2e';
  const tagId = 'tag-e2e';
  const now = new Date().toISOString();
  return {
    version: 5,
    stateVersion: 5,
    scanIndexVersion: 1,
    queueVersion: 1,
    metadataVersion: 1,
    splitStorageVersion: 1,
    categories: [{
      id: 'category-e2e',
      name: 'Bibliothèque E2E',
      path: libraryRoot,
      hidden: false
    }],
    session: buildTestSession({ incognito }),
    ui: {
      interfaceMode,
      theme,
      kavitaUpgradePromptSeen: true,
      activeScreen: 'library',
      selectedCategoryId: null,
      cardSize: 'comfortable',
      chapterCardSize: 'comfortable',
      pagePreviewSize: 'comfortable',
      previewQuality: 'balanced',
      showPagePreviewBeforeReading: true,
      sort: 'title-asc',
      filters: {
        readStatus: 'all',
        favoriteOnly: false,
        hasDescription: null,
        hasCustomCover: null,
        tags: [],
        collections: []
      },
      experimental: {
        advancedSearch: true,
        performanceDiagnostics: diagnostics
      }
    },
    metadata,
    metadataLocks: {},
    metadataFieldSource: {},
    coverProfiles: {},
    favorites: { [first.id]: true },
    tags: {
      [tagId]: { id: tagId, name: 'Aventure locale', color: '#22c55e', createdAt: now }
    },
    mangaTags: {
      [first.id]: [tagId],
      [second.id]: [tagId]
    },
    mangaTagMeta: {},
    collections: {
      [collectionId]: {
        id: collectionId,
        name: 'Collection E2E',
        description: 'Collection visible de test',
        color: '#8b5cf6',
        mangaIds: [first.id, second.id, mangas[3].id, mangas[4].id],
        appearance: {
          type: 'mosaic',
          featuredMangaIds: [first.id, second.id]
        },
        createdAt: now
      }
    },
    smartCollections: {},
    annotations: {},
    metadataWorkbenchQueue: mangas.slice(0, workbenchMangaCount).map((manga) => manga.id),
    metadataWorkbenchItems: mangas.slice(0, workbenchMangaCount).map((manga, order) => ({
      mangaId: manga.id,
      order,
      status: order < workbenchReviewCount ? 'review' : 'pending',
      confidence: order < workbenchReviewCount ? 0.78 : 0,
      margin: order < workbenchReviewCount ? 0.04 : 0,
      candidate: order < workbenchReviewCount ? {
        identity: `fixture:${order + 1}`,
        source: 'fixture',
        sourceLabel: 'Catalogue fixture',
        sourceId: String(order + 1),
        title: `Proposition distante ${String(order + 1).padStart(3, '0')}`,
        authors: `Auteur ${order % 7}`,
        pages: 4,
        tags: ['Test', 'Vérification'],
        reasons: ['near-title', 'author'],
        confidence: 0.78,
        coverUrl: null,
        coverPreviewUrl: null
      } : null,
      candidateCount: order < workbenchReviewCount ? 3 : 0,
      fields: [],
      error: null,
      jobId: null,
      updatedAt: now
    })),
    metadataWorkbenchLastBatch: null,
    readingQueue: [],
    plugins: { enabled: {}, dismissedWarnings: {} },
    vault: {
      pinHash: 'fixture-pin-hash',
      pinProtectedBlob: null,
      securityMode: 'basic',
      locked: !vaultUnlocked,
      blurCovers: true,
      autoLockOnClose: true,
      stealthMode: false,
      privateMangaIds: vaultMangaCount > 0
        ? mangas.slice(2, 2 + Math.min(mangas.length - 2, vaultMangaCount)).map((manga) => manga.id)
        : [],
      privateCategoryIds: []
    },
    readingStates: {},
    chapterStates: {},
    readStatus: {},
    chapterReadStatus: {},
    progress: {
      [first.chapters[0].id]: {
        mangaId: first.id,
        chapterId: first.chapters[0].id,
        pageIndex: 2,
        pageCount: 4,
        lastReadAt: now
      }
    },
    recents: [],
    knownChapterCounts: {},
    identityAliases: {},
    identityRecords: {},
    identitySuggestions: [],
    identityMediaIssues: [],
    workGroups: {
      'work-e2e': {
        id: 'work-e2e',
        editionIds: [first.id, second.id],
        preferredEditionId: first.id,
        shared: {
          favorite: true,
          tagIds: [tagId],
          collectionIds: [collectionId]
        },
        createdAt: now,
        updatedAt: now
      }
    },
    deletionTombstones: {},
    readerPrefs: {},
    pdfMeta: {},
    backupHistory: [],
    migrationLog: []
  };
}

function createRepresentativeProfile({ interfaceMode, diagnostics }) {
  const sourceRoot = sourceProfilePath();
  if (!sourceRoot || !fs.existsSync(path.join(sourceRoot, 'state.json'))) {
    return null;
  }

  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-e2e-'));
  const requiredCopies = [
    ['state.json', 'state.json'],
    ['user-data', 'user-data'],
    [path.join('derived', 'library.db'), path.join('derived', 'library.db')]
  ];
  requiredCopies.forEach(([relativeSource, relativeDestination]) => {
    copyIfPresent(path.join(sourceRoot, relativeSource), path.join(profileRoot, relativeDestination));
  });

  const statePath = path.join(profileRoot, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.session = buildTestSession();
  // Le profil representatif protege une categorie volumineuse dans le coffre.
  // Le test utilise une copie jetable et la rend visible afin de mesurer les 499 mangas,
  // sans changer les preferences du profil utilisateur original.
  state.vault = {
    ...(state.vault || {}),
    locked: false,
    privateMangaIds: [],
    privateCategoryIds: [],
    stealthMode: false
  };
  state.ui = {
    ...(state.ui || {}),
    interfaceMode,
    activeScreen: 'library',
    selectedCategoryId: null,
    cardSize: 'comfortable',
    filters: {
      readStatus: 'all',
      favoriteOnly: false,
      hasDescription: null,
      hasCustomCover: null,
      tags: [],
      collections: []
    },
    experimental: {
      ...(state.ui?.experimental || {}),
      performanceDiagnostics: diagnostics
    }
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return profileRoot;
}

export function createIsolatedProfile({
  interfaceMode = 'sawa',
  diagnostics = false,
  theme = 'dark-night',
  representative = false,
  incognito = false,
  mangaCount = 84,
  vaultUnlocked = false,
  vaultMangaCount = 1,
  workbenchMangaCount = 0,
  workbenchReviewCount = 0
} = {}) {
  if (representative) {
    const representativeProfile = createRepresentativeProfile({ interfaceMode, diagnostics });
    if (representativeProfile) return representativeProfile;
  }
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-e2e-'));
  const state = buildSeedState(profileRoot, { interfaceMode, diagnostics, theme, incognito, mangaCount, vaultUnlocked, vaultMangaCount, workbenchMangaCount, workbenchReviewCount });
  fs.writeFileSync(path.join(profileRoot, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return profileRoot;
}

export function readFixtureState(profileRoot) {
  return JSON.parse(fs.readFileSync(path.join(profileRoot, 'state.json'), 'utf8'));
}

export function fixtureLibraryRoot(profileRoot) {
  return path.join(profileRoot, 'fixture-library');
}

export async function removeIsolatedProfile(profileRoot) {
  const resolved = path.resolve(String(profileRoot || ''));
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('sawa-e2e-')) {
    throw new Error(`Refus de supprimer un profil non isole: ${resolved}`);
  }
  // Windows peut conserver le verrou SQLite quelques centaines de millisecondes
  // apres la fermeture de la BrowserWindow. La suppression reste strictement
  // bornee au repertoire temporaire valide ci-dessus.
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastError;
}

export async function launchSawa(profileRoot, extraEnv = {}) {
  const startedAt = performance.now();
  const application = await electron.launch({
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SAWA_USER_DATA_PATH: profileRoot,
      SAWA_PERF_DIAGNOSTICS: '1',
      ...extraEnv
    }
  });

  let page = application.windows().find((candidate) => candidate.url().startsWith('file:')) || null;
  const deadline = Date.now() + 20_000;
  while (!page && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    page = application.windows().find((candidate) => candidate.url().startsWith('file:')) || null;
  }
  if (!page) {
    await application.close().catch(() => {});
    throw new Error('Fenetre principale Electron introuvable.');
  }

  const interfaceRoot = page.locator('.app-shell, .kv-app').first();
  try {
    await interfaceRoot.waitFor({ state: 'visible', timeout: 20_000 });
  } catch (error) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const bodyHtml = await page.locator('body').innerHTML().catch(() => '');
    await application.close().catch(() => {});
    throw new Error(`Interface Sawa absente: ${bodyText.slice(0, 1200)}\nHTML: ${bodyHtml.slice(0, 1200)}`, { cause: error });
  }
  const isSawaInterface = await interfaceRoot.evaluate((node) => node.classList.contains('app-shell'));
  const librarySelector = isSawaInterface ? '.library-view' : '.kv-scroll-region';
  if (!await page.locator(librarySelector).isVisible()) {
    const libraryNavigation = isSawaInterface
      ? page.getByText('Bibliotheque', { exact: true }).first()
      : page.getByText('Toutes les series', { exact: true }).first();
    await libraryNavigation.waitFor({ state: 'visible', timeout: 20_000 });
    await libraryNavigation.click();
  }
  await page.locator(librarySelector).waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator(`${librarySelector} [data-manga-id]`).first().waitFor({ state: 'visible', timeout: 20_000 });
  return {
    application,
    page,
    librarySelector,
    usableMs: performance.now() - startedAt
  };
}

export async function readScrollSnapshot(page, librarySelector) {
  return page.locator(librarySelector).evaluate((node) => {
    const cards = [...node.querySelectorAll('[data-manga-id]')];
    const viewportTop = node.getBoundingClientRect().top;
    const anchor = cards
      .map((card) => ({
        id: card.getAttribute('data-manga-id'),
        top: card.getBoundingClientRect().top - viewportTop,
        bottom: card.getBoundingClientRect().bottom - viewportTop
      }))
      .filter((item) => item.id && item.bottom >= 0)
      .sort((left, right) => left.top - right.top)[0] || null;
    return { scrollTop: node.scrollTop, anchorId: anchor?.id || null, anchorTop: anchor?.top ?? null };
  });
}

export async function scrollToStableOffset(page, librarySelector, offset = 3200) {
  await page.locator(librarySelector).evaluate((node, target) => {
    node.scrollTop = target;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, offset);
  await page.waitForTimeout(750);
  return readScrollSnapshot(page, librarySelector);
}

export function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
}
