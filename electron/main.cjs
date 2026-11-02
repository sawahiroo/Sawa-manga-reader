/**
 * Sawa Manga Library v3.0.0 - Electron Main Process
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  shell,
  utilityProcess
} = require('electron');
const { pathToFileURL } = require('url');

const {
  loadState,
  activateRuntimeStateOverride,
  normalizePersistedSessionPayload,
  updateState,
  createBackup,
  exportBackup,
  importBackup,
  listBackups,
  createTag,
  deleteTag,
  setMangaTags,
  addTagToManga,
  removeTagFromManga,
  createCollection,
  deleteCollection,
  updateCollection,
  addMangaToCollection,
  removeMangaFromCollection,
  clearDerivedArtifacts,
  getDerivedDbPath,
  getCacheDir,
  getThumbnailDir,
  getManagedCoverDir,
  getUserDataPath,
  flushStateWrites,
  updateStateSegments
} = require('./services/storage.cjs');
const { createMetadataProviderRegistry } = require('./services/metadataProviders.cjs');
const {
  DEFAULT_MATCH_POLICY,
  getWorkbenchPage,
  getWorkbenchSelectionIds,
  rankMetadataCandidates,
  resolveSafeMetadataPatch
} = require('./services/metadataWorkbench.cjs');
const {
  activeCoverPath,
  importManagedCover,
  mergeCoverVariants,
  normalizeCollectionAppearance,
  normalizeCoverProfile,
  resolveCoverCandidatePath,
  selectCoverVariant,
  updateCoverCrop
} = require('./services/coverManager.cjs');
const {
  sanitizePrivateMangaReferences,
  sanitizeSessionSearchPrivacy
} = require('./services/privacySanitizer.cjs');
const {
  bulkTrashMangas,
  removeDeletedMangaState,
  restoreReturnedTombstones
} = require('./services/bulkTrash.cjs');

const {
  scanLibrary,
  getChapterPages,
  makeId,
  buildCompactIndex,
  isPdfFile,
  isCbzFile,
  areScanIndexesEquivalent
} = require('./services/libraryScanner.cjs');
const { scanLibraryInWorker } = require('./services/libraryScanWorker.cjs');
const { patchLibrarySnapshotInWorker } = require('./services/derivedSyncWorker.cjs');
const { reconcileSourceLinksInWorker } = require('./services/sourceLinkReconcileWorker.cjs');
const {
  applyPersistedOverlayToLibrary,
  buildInteractiveLibraryPayload
} = require('./services/libraryOverlay.cjs');
const {
  buildLegacySeriesIndex,
  queryLegacySeriesIndex
} = require('./services/legacySeriesIndex.cjs');
const {
  consumeFirstRunScanMarker,
  writeFirstRunScanMarker
} = require('./services/firstRunScan.cjs');

const { LibraryWatcher } = require('./services/watcher.cjs');
const { createThumbnailCache } = require('./services/thumbnailCache.cjs');
const { createThumbnailUtilityPool } = require('./services/thumbnailUtilityClient.cjs');
const {
  createCbzAssetResponse,
  clearCbzCache,
  loadComicInfoForSource,
  ensureCbzEntryCached
} = require('./services/archive.cjs');
const {
  getSnapshotMeta,
  syncLibrarySnapshot,
  readLibrarySnapshot,
  listJobs,
  getJob,
  searchDocuments,
  upsertOcrPage,
  listOcrPages,
  countOcrPages,
  clearOcrData,
  upsertVisualHash,
  listVisualHashes,
  closeDerivedStore
} = require('./services/derivedStore.cjs');
const { runPrivacySafeAdvancedSearch } = require('./services/searchPrivacy.cjs');
const {
  analyzeLegacySnapshot,
  getCoreStore,
  closeCoreStore
} = require('./services/coreStore.cjs');
const { JobInterruptedError, JobOrchestrator } = require('./services/jobOrchestrator.cjs');
const { installTextContextMenu } = require('./services/textContextMenu.cjs');
const {
  buildComicInfoExportRecord,
  buildComicInfoXml,
  writeComicInfoSidecar
} = require('./services/comicInfo.cjs');
const {
  runHeavyIoTask,
  shutdownHeavyIoWorkers
} = require('./services/heavyIoClient.cjs');
const {
  MAX_PDF_BYTES,
  readAllowedPdfBuffer,
  resolveAllowedPdfPath,
  resolveRealPathWithinRoots
} = require('./services/mediaFileAccess.cjs');
const {
  clearShutdownMarker,
  flushWithDeadline,
  getDiagnosticDir,
  readLastValidSnapshot,
  readShutdownMarker,
  writeLastValidSnapshot,
  writeShutdownMarker
} = require('./services/appReliability.cjs');
const {
  configurePerfDiagnostics,
  getDiagnosticsSnapshot,
  measureSync,
  recordMeasurement
} = require('./services/perfDiagnostics.cjs');
const {
  listAvailablePlugins,
  installPlugin,
  uninstallPlugin,
  openPlugin
} = require('./services/plugins.cjs');
const {
  SOURCE_PLUGIN_ID,
  listSourceConnectors,
  searchSourceSeries,
  getSourceSeries,
  getSourceChapters,
  getSeriesContextForManga,
  getSeriesChaptersForManga,
  checkSourceUpdatesForManga,
  getSourceConnectorPrefs,
  setSourceConnectorPrefs,
  importSourceChapters
} = require('./services/webSources.cjs');
const {
  getRuntimeStatus: getSourceRuntimeStatus,
  startRuntime: startSourceRuntime,
  stopRuntime: stopSourceRuntime,
  terminateRuntimeProcesses: terminateSourceRuntimeProcesses,
  resetRuntimeCache: resetSourceRuntimeCache,
  listRepositories: listSourceRepositories,
  addRepository: addSourceRepository,
  removeRepository: removeSourceRepository,
  syncRepositories: syncSourceRepositories,
  listExtensions: listSourceExtensions,
  installExtension: installSourceExtension,
  updateExtension: updateSourceExtension,
  uninstallExtension: uninstallSourceExtension,
  setExtensionEnabled: setSourceExtensionEnabled,
  markRuntimeSelection: markSourceRuntimeSelection,
  loadSourcesState,
  updateSourcesState,
  invalidateSourcesStateCache,
  flushSourcesStateWrites,
  listLinkedSeries,
} = require('./services/sourceRuntime.cjs');
const { createIdentityService } = require('./services/identityService.cjs');
const {
  remapPersistedReferences,
  remapSourceLinks,
  stripPrivateIdentityState
} = require('./services/identityWorks.cjs');
const {
  applyCategoryRelocation,
  createCategoryRelocationPlan,
  normalizePath: normalizeRelocationPath,
  preserveUnavailableLibraryEntries,
  undoCategoryRelocation
} = require('./services/relocation.cjs');
const { getOcrEngineInfo, listOcrLanguages, runOcrOnImage } = require('./services/ocrService.cjs');

// Les profils fonctionnels et de benchmark doivent isoler aussi les caches Chromium,
// pas seulement les fichiers metier lus par storage.cjs.
const overriddenUserDataPath = String(process.env.SAWA_USER_DATA_PATH || '').trim();
if (overriddenUserDataPath) {
  app.setPath('userData', path.resolve(overriddenUserDataPath));
}

/* ------------------------------------------------------------------ */
/*  Color extraction from image buffer                                 */
/* ------------------------------------------------------------------ */

function extractDominantColors(imgBuffer) {
  try {
    const img = nativeImage.createFromBuffer(imgBuffer);
    if (img.isEmpty()) return null;
    // Resize to small for fast sampling
    const small = img.resize({ width: 64, height: 64, quality: 'low' });
    const bmp = small.toBitmap();
    const w = small.getSize().width;
    const h = small.getSize().height;

    // Sample pixels, group by hue buckets
    const buckets = new Array(12).fill(null).map(() => ({ r: 0, g: 0, b: 0, count: 0, satSum: 0 }));
    for (let i = 0; i < bmp.length; i += 4) {
      const r = bmp[i], g = bmp[i + 1], b = bmp[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const delta = max - min;
      const lightness = (max + min) / 510;
      if (delta < 20 || lightness < 0.08 || lightness > 0.92) continue; // skip grays
      const sat = delta / (max || 1);
      let hue = 0;
      if (delta > 0) {
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = ((hue * 60) + 360) % 360;
      }
      const bucket = Math.floor(hue / 30) % 12;
      buckets[bucket].r += r;
      buckets[bucket].g += g;
      buckets[bucket].b += b;
      buckets[bucket].count += 1;
      buckets[bucket].satSum += sat;
    }

    // Sort by weighted score (count * avg saturation)
    const scored = buckets
      .filter(b => b.count > 0)
      .map(b => ({
        r: Math.round(b.r / b.count),
        g: Math.round(b.g / b.count),
        b: Math.round(b.b / b.count),
        score: b.count * (b.satSum / b.count)
      }))
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    const toHex = (c) => `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`;
    const accent = toHex(scored[0]);
    const accentAlt = scored.length > 1 ? toHex(scored[1]) : accent;
    return { accent, accentAlt };
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Globals                                                           */
/* ------------------------------------------------------------------ */

let mainWindow = null;
let splashWindow = null;
let splashFailSafeTimer = null;
const watcher = new LibraryWatcher();
let lastScanTime = 0;
let pdfMetaSyncPromise = null;
let pdfMetaResyncRequested = false;
let pdfMetaNeedsRefresh = false;
let libraryEmitInFlight = false;
let libraryEmitQueued = false;
let latestSyncStatus = {
  state: 'up-to-date',
  label: 'a jour',
  detail: 'Donnees derivees synchronisees',
  runningCount: 0,
  queuedCount: 0,
  attentionCount: 0,
  profile: 'balanced'
};
let rawLibrarySnapshot = null;
let ocrPaused = false;
let bootstrapRefreshScanTimer = null;
let bootstrapChapterDetectionTimer = null;
let interactiveDerivedSyncTimer = null;
let interactiveDerivedSyncPromise = null;
let interactiveDerivedSyncQueued = false;
let libraryScanPromise = null;
let thumbnailCache = null;
let thumbnailUtilityPool = null;
let legacySeriesIndex = [];
let legacySeriesIndexReady = false;
let stateRevision = 1;
let sourceRevision = 1;
let sourceReconcileTimer = null;
let sourceReconcilePromise = null;
const relocationPlans = new Map();
let quitFlushInProgress = false;
let quitFlushComplete = false;
let sessionFlushSequence = 0;
const sessionFlushWaiters = new Map();
const safeModeEnabled = process.argv.includes('--sawa-safe-mode');
const safeModeSnapshot = safeModeEnabled ? readLastValidSnapshot(getUserDataPath()) : null;
const mediaFailureLastReported = new Map();
if (safeModeSnapshot?.state) {
  activateRuntimeStateOverride(safeModeSnapshot.state, { readOnly: true });
}

let pdfJsModulePromise = null;

function getScanEntries(scanIndex) {
  if (Array.isArray(scanIndex?.entries)) return scanIndex.entries;
  if (scanIndex?.entries && typeof scanIndex.entries === 'object') return Object.values(scanIndex.entries);
  return [];
}

function requestLibraryScan(persistedState = loadState()) {
  if (!libraryScanPromise) {
    const reusableSnapshot = rawLibrarySnapshot || readLibrarySnapshot();
    libraryScanPromise = scanLibraryInWorker(persistedState, {
      userDataPath: getUserDataPath(),
      skipUnchanged: Boolean(reusableSnapshot)
    })
      .then((result) => {
        const scanned = result?.unchanged ? reusableSnapshot : result;
        return preserveUnavailableLibraryEntries(scanned, reusableSnapshot, persistedState);
      })
      .finally(() => {
        libraryScanPromise = null;
      });
  }
  return libraryScanPromise;
}

function getThumbnailCache() {
  if (!thumbnailCache) {
    thumbnailUtilityPool = createThumbnailUtilityPool({
      forkImpl: utilityProcess.fork.bind(utilityProcess),
      workerPath: path.join(__dirname, 'services', 'thumbnailUtilityWorker.cjs'),
      maxConcurrent: 2
    });
    thumbnailCache = createThumbnailCache({
      cacheDir: getThumbnailDir(),
      generateThumbnail: (payload) => thumbnailUtilityPool.generateThumbnail(payload),
      maxConcurrent: 2
    });
  }
  return thumbnailCache;
}

async function createThumbnailAssetResponse(sourcePath, url) {
  if (url.searchParams.get('thumbnail') !== '1') return null;
  const thumbnailPath = await getThumbnailCache().getOrCreate(sourcePath, {
    width: url.searchParams.get('w'),
    height: url.searchParams.get('h'),
    quality: url.searchParams.get('q')
  });
  return thumbnailPath ? net.fetch(pathToFileURL(thumbnailPath).toString()) : null;
}

function updateSyncStatusPatch(patch = {}) {
  latestSyncStatus = {
    ...latestSyncStatus,
    ...patch,
    snapshot: getSnapshotMeta()
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('library:syncStatusChanged', latestSyncStatus);
  }
  emitStatePatch({
    syncState: {
      status: latestSyncStatus.state,
      lastSuccess: latestSyncStatus.lastCompletedAt || null,
      error: latestSyncStatus.state === 'attention-needed' ? latestSyncStatus.detail : null
    }
  });
}

function persistCategoryAvailability(library, persistedState) {
  const scannedById = new Map((library?.categories || []).map((category) => [String(category.id), category]));
  const needsUpdate = (persistedState?.categories || []).some((category) => {
    const scanned = scannedById.get(String(category.id));
    const next = scanned?.exists === false ? 'missing' : 'available';
    return String(category.availability || 'available') !== next;
  });
  if (!needsUpdate) return persistedState;
  const now = new Date().toISOString();
  return updateState((state) => {
    state.categories = (state.categories || []).map((category) => {
      const scanned = scannedById.get(String(category.id));
      const availability = scanned?.exists === false ? 'missing' : 'available';
      return {
        ...category,
        availability,
        lastSeenAt: availability === 'available' ? now : category.lastSeenAt,
        missingSince: availability === 'missing' ? (category.missingSince || now) : null
      };
    });
    return state;
  });
}

function emitStatePatch(patch = {}) {
  stateRevision += 1;
  if (!mainWindow || mainWindow.isDestroyed()) return stateRevision;
  mainWindow.webContents.send('state:patch', {
    revision: stateRevision,
    sourceRevision,
    patch
  });
  return stateRevision;
}

function mutationResult(patch = {}) {
  const revision = stateRevision += 1;
  return { ok: true, revision, patch, ...patch };
}

function normalizeHashBits(value) {
  return String(value || '').trim().replace(/[^01]/g, '');
}

function hammingDistance(left, right) {
  const a = normalizeHashBits(left);
  const b = normalizeHashBits(right);
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) distance += 1;
  }
  return distance;
}

function computeAverageImageHash(imagePath) {
  try {
    if (!imagePath || !fs.existsSync(imagePath)) return null;
    const img = nativeImage.createFromPath(imagePath);
    if (!img || img.isEmpty()) return null;
    const small = img.resize({ width: 8, height: 8, quality: 'low' });
    const bmp = small.toBitmap();
    if (!bmp?.length) return null;

    const values = [];
    for (let index = 0; index < bmp.length; index += 4) {
      const red = bmp[index] || 0;
      const green = bmp[index + 1] || 0;
      const blue = bmp[index + 2] || 0;
      values.push(Math.round((red + green + blue) / 3));
    }

    const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    return values.map((value) => (value >= average ? '1' : '0')).join('');
  } catch (_error) {
    return null;
  }
}

function titleSimilarityScore(leftTitle, rightTitle) {
  const normalize = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  const left = normalize(leftTitle);
  const right = normalize(rightTitle);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.82;
  const overlap = [...new Set(left.split(''))].filter((char) => right.includes(char)).length;
  return overlap / Math.max(left.length, right.length, 1);
}

async function resolveMangaVisualSource(manga) {
  if (!manga) return null;
  if (manga.coverFilePath && fs.existsSync(manga.coverFilePath)) {
    return { source: 'cover', imagePath: manga.coverFilePath };
  }

  const firstChapter = (manga.chapters || []).find((chapter) => chapter?.path);
  if (!firstChapter?.path) return null;
  const pages = getChapterPages(firstChapter.path, loadState()) || [];
  const firstPage = pages.find((page) => page?.containerType !== 'pdf');
  if (!firstPage) return null;

  if (firstPage.containerType === 'cbz' && firstPage.assetPath && firstPage.archiveEntryName) {
    const cachedPath = await ensureCbzEntryCached(firstPage.assetPath, firstPage.archiveEntryName);
    return cachedPath ? { source: 'archive-first-page', imagePath: cachedPath } : null;
  }

  if (firstPage.path && fs.existsSync(firstPage.path)) {
    return { source: 'first-page', imagePath: firstPage.path };
  }

  return null;
}

async function runLibraryJob({ job, checkpoint, isCancelled }) {
  const persistedBeforeScan = loadState();
  const rawLibrary = await requestLibraryScan(persistedBeforeScan);
  if (isCancelled()) return;

  const diskChanged = !areScanIndexesEquivalent(persistedBeforeScan.scanIndex, rawLibrary.scanIndex);
  const scannedCategoryById = new Map((rawLibrary?.categories || []).map((category) => [String(category.id), category]));
  const availabilityChanged = (persistedBeforeScan.categories || []).some((category) => {
    const scanned = scannedCategoryById.get(String(category.id));
    const nextAvailability = scanned?.exists === false ? 'missing' : 'available';
    return String(category.availability || 'available') !== nextAvailability;
  });
  checkpoint({
    diskChanged,
    availabilityChanged,
    mangaCount: Number(rawLibrary?.allMangas?.length || 0)
  });
  rawLibrarySnapshot = rawLibrary;
  lastScanTime = Date.now();
  if (!diskChanged && !availabilityChanged) {
    updateSyncStatusPatch({
      lastCompletedKind: job.kind,
      lastCompletedAt: new Date().toISOString()
    });
    return;
  }

  const payload = buildStatePayload({
    rawLibrary,
    skipReconciliation: false
  });
  detectNewChapters(payload.library);
  updateSyncStatusPatch({
    lastCompletedKind: job.kind,
    lastCompletedAt: new Date().toISOString()
  });
  emitLibraryPayload(payload);
}

async function runHashJob({ checkpoint, isCancelled }) {
  const payload = await buildInteractivePayloadAsync({ refreshDerived: false });
  const mangas = getMergedPayloadMangas(payload);
  const currentHashes = listVisualHashes();
  let processed = 0;

  for (const manga of mangas) {
    if (isCancelled()) return;
    const stored = await ensureStoredVisualHashForManga(manga, currentHashes);
    if (stored && !currentHashes.some((entry) => entry.id === stored.id)) currentHashes.push(stored);
    processed += 1;
    checkpoint({ totalMangas: mangas.length, processedMangas: processed });
  }
}

async function runSourceImportJob({ job, checkpoint, isCancelled }) {
  const payload = job?.payload || {};
  const category = resolveSourceImportCategory(payload.destinationCategoryId);
  if (!category?.path || !fs.existsSync(category.path)) {
    throw new Error('Categorie de destination introuvable.');
  }

  const result = await importSourceChapters({
    state: loadState(),
    connectorId: payload.connectorId,
    seriesId: payload.seriesId,
    chapterIds: payload.chapterIds,
    destinationDir: category.path,
    destinationCategoryId: payload.destinationCategoryId,
    jobId: job.id,
    isCancelled,
    throttleMs: jobOrchestrator?.readerActive ? 90 : 20,
    onProgress: (progress) => {
      checkpoint(progress);
    }
  });

  updateState((state) => {
    state.plugins = state.plugins || {};
    state.plugins.lastSourceImportCategoryId = payload.destinationCategoryId || '';
    return state;
  });
  markSourceRuntimeSelection({
    connectorId: payload.connectorId,
    categoryId: payload.destinationCategoryId
  });

  checkpoint({
    chapterCount: Number(result?.chapterCount || 0),
    importedCount: Number(result?.importedCount || 0),
    skipCount: Number(result?.skipCount || 0),
    downloadedPages: Number(result?.downloadedPages || 0),
    seriesDir: result?.seriesDir || ''
  });

  restartWatchers();
  ensureQueuedJob('scan', { source: 'sources-web-import' });
  ensureQueuedJob('analyze', { source: 'sources-web-import' });
  await jobOrchestrator.process();
}

async function runArchiveExportJob({ job, checkpoint, isCancelled }) {
  const payload = job?.payload || {};
  const result = await runHeavyIoTask('archive-export', {
    sourcePath: payload.sourcePath,
    targetPath: payload.targetPath,
    xml: payload.xml,
    conflictPolicy: payload.conflictPolicy,
    replaceSource: payload.replaceSource
  }, {
    isCancelled,
    onProgress: checkpoint
  });
  if (!result.ok) {
    if (result.cancelled) throw new JobInterruptedError(result.error || 'Export annule.');
    throw new Error(result.error || 'Export CBZ impossible.');
  }
  checkpoint({
    phase: 'done',
    percent: 100,
    resultPath: result.path,
    skipped: Boolean(result.skipped),
    originalBackupPath: result.originalBackupPath || null,
    imageCount: result.validation?.imageCount || 0
  });
}

async function resolveWorkbenchMangasById(mangaIds = []) {
  const state = loadState();
  const snapshot = rawLibrarySnapshot || readLibrarySnapshot() || await requestLibraryScan(state);
  const library = applyPersistedOverlayToLibrary(snapshot || { allMangas: [] }, state);
  const byId = new Map();
  for (const manga of library?.allMangas || []) {
    [manga.id, manga.contentId, manga.locationId].map((value) => String(value || '').trim()).filter(Boolean)
      .forEach((id) => byId.set(id, manga));
  }
  return new Map((Array.isArray(mangaIds) ? mangaIds : []).map((value) => {
    const id = String(value || '').trim();
    return [id, byId.get(id) || null];
  }));
}

function isPrivateWorkbenchManga(state, manga) {
  const mangaId = String(manga?.id || '').trim();
  const categoryId = String(manga?.categoryId || '').trim();
  return (state?.vault?.privateMangaIds || []).map(String).includes(mangaId)
    || (state?.vault?.privateCategoryIds || []).map(String).includes(categoryId);
}

function patchWorkbenchItem(mangaId, patch) {
  const normalizedId = String(mangaId || '').trim();
  let result = null;
  updateStateSegments({ organization: ['metadataWorkbenchQueue', 'metadataWorkbenchItems'] }, (state) => {
    state.metadataWorkbenchItems = Array.isArray(state.metadataWorkbenchItems) ? state.metadataWorkbenchItems : [];
    const index = state.metadataWorkbenchItems.findIndex((item) => String(item?.mangaId || '') === normalizedId);
    const previous = index >= 0
      ? state.metadataWorkbenchItems[index]
      : { mangaId: normalizedId, order: state.metadataWorkbenchItems.length, status: 'pending' };
    result = { ...previous, ...patch, mangaId: normalizedId, updatedAt: new Date().toISOString() };
    if (index >= 0) state.metadataWorkbenchItems[index] = result;
    else state.metadataWorkbenchItems.push(result);
    state.metadataWorkbenchQueue = state.metadataWorkbenchItems.map((item) => item.mangaId);
    return state;
  });
  return result;
}

function applyWorkbenchCandidateToState(state, mangaId, candidate) {
  const safe = resolveSafeMetadataPatch({
    mangaId,
    candidate,
    metadata: state.metadata,
    locks: state.metadataLocks,
    fieldSources: state.metadataFieldSource
  });
  const before = {
    metadata: structuredClone(state.metadata?.[mangaId] || {}),
    fieldSources: structuredClone(state.metadataFieldSource?.[mangaId] || {})
  };
  for (const [field, value] of Object.entries(safe.patch)) {
    applyMetadataField(state, mangaId, field, value, 'online');
  }
  state.metadata[mangaId] = {
    ...(state.metadata[mangaId] || {}),
    onlineImportedAt: new Date().toISOString()
  };
  return { ...safe, before };
}

async function analyzeWorkbenchItem({ mangaId, manga, jobId, autoApply }) {
  const state = loadState();
  if (!manga) {
    return patchWorkbenchItem(mangaId, { status: 'error', error: 'Oeuvre locale introuvable.', jobId });
  }
  const privateContext = isPrivateWorkbenchManga(state, manga);
  if (privateContext && state?.vault?.locked) {
    return patchWorkbenchItem(mangaId, { status: 'error', error: 'Deverrouille le Coffre pour analyser cette oeuvre.', jobId });
  }
  patchWorkbenchItem(mangaId, { status: 'analyzing', error: null, decision: null, reviewedAt: null, jobId });
  const ui = privateContext && state?.vault?.locked
    ? {
        ...state.ui,
        metadataProviders: {
          ...(state.ui?.metadataProviders || {}),
          enabled: { ...(state.ui?.metadataProviders?.enabled || {}), imhentai: false, hentaiera: false }
        }
      }
    : state.ui;
  const response = await getMetadataProviderRegistry().searchCandidates(manga.displayTitle || manga.title, {
    ui,
    privateContext
  });
  const ranking = rankMetadataCandidates(manga, response.results, DEFAULT_MATCH_POLICY);
  let appliedFields = [];
  let undoEntry = null;
  if (autoApply && ranking.safelyAutomatic && ranking.best) {
    updateStateSegments({ metadata: ['metadata', 'metadataFieldSource'], organization: ['metadataWorkbenchLastBatch'] }, (nextState) => {
      const applied = applyWorkbenchCandidateToState(nextState, mangaId, ranking.best);
      appliedFields = applied.fields;
      undoEntry = { mangaId, ...applied.before };
      const previousEntries = Array.isArray(nextState.metadataWorkbenchLastBatch?.entries)
        ? nextState.metadataWorkbenchLastBatch.entries.filter((entry) => entry.mangaId !== mangaId)
        : [];
      nextState.metadataWorkbenchLastBatch = {
        id: jobId,
        createdAt: new Date().toISOString(),
        entries: [...previousEntries, undoEntry]
      };
      return nextState;
    });
  }
  return patchWorkbenchItem(mangaId, {
    status: autoApply && ranking.safelyAutomatic ? 'done' : ranking.status,
    confidence: ranking.confidence,
    margin: ranking.margin,
    candidate: ranking.best ? { ...ranking.best, confidence: ranking.confidence, reasons: ranking.reasons } : null,
    candidateCount: ranking.ranked.length,
    fields: appliedFields,
    decision: autoApply && ranking.safelyAutomatic ? 'accepted' : null,
    reviewedAt: autoApply && ranking.safelyAutomatic ? new Date().toISOString() : null,
    error: Object.keys(response.providerErrors || {}).length && !ranking.best
      ? Object.values(response.providerErrors).join(' | ')
      : null,
    jobId
  });
}

async function runWorkbenchAnalysisJob({ job, checkpoint, isCancelled }) {
  const itemIds = [...new Set((job?.payload?.mangaIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  const mangas = await resolveWorkbenchMangasById(itemIds);
  const autoApply = job?.payload?.autoApply !== false;
  checkpoint({ phase: 'starting', completed: 0, total: itemIds.length, percent: 0 });
  for (let index = 0; index < itemIds.length; index += 2) {
    if (isCancelled()) throw new JobInterruptedError('Analyse Atelier annulee.');
    const chunk = itemIds.slice(index, index + 2);
    await Promise.all(chunk.map((mangaId) => analyzeWorkbenchItem({
      mangaId,
      manga: mangas.get(mangaId),
      jobId: job.id,
      autoApply
    }).catch((error) => patchWorkbenchItem(mangaId, {
      status: 'error',
      error: error?.message || 'Analyse impossible.',
      jobId: job.id
    }))));
    const completed = Math.min(itemIds.length, index + chunk.length);
    checkpoint({ phase: 'analyzing', completed, total: itemIds.length, percent: itemIds.length ? Math.round((completed / itemIds.length) * 100) : 100 });
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function runWorkbenchApplyJob({ job, checkpoint, isCancelled }) {
  const itemIds = [...new Set((job?.payload?.mangaIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  checkpoint({ phase: 'starting', completed: 0, total: itemIds.length, percent: 0 });
  for (let index = 0; index < itemIds.length; index += 1) {
    if (isCancelled()) throw new JobInterruptedError('Import Atelier annule.');
    const mangaId = itemIds[index];
    const state = loadState();
    const item = (state.metadataWorkbenchItems || []).find((entry) => entry.mangaId === mangaId);
    const candidate = job?.payload?.candidates?.[mangaId]
      || getMetadataProviderRegistry().getCandidate(item?.candidate?.identity)
      || item?.candidate;
    if (!candidate) {
      patchWorkbenchItem(mangaId, { status: 'error', error: 'Candidat introuvable.', jobId: job.id });
    } else {
      updateStateSegments({ metadata: ['metadata', 'metadataFieldSource'], organization: ['metadataWorkbenchLastBatch'] }, (nextState) => {
        const applied = applyWorkbenchCandidateToState(nextState, mangaId, candidate);
        const previousEntries = Array.isArray(nextState.metadataWorkbenchLastBatch?.entries)
          ? nextState.metadataWorkbenchLastBatch.entries.filter((entry) => entry.mangaId !== mangaId)
          : [];
        nextState.metadataWorkbenchLastBatch = {
          id: job.id,
          createdAt: new Date().toISOString(),
          entries: [...previousEntries, { mangaId, ...applied.before }]
        };
        return nextState;
      });
      patchWorkbenchItem(mangaId, { status: 'done', decision: 'accepted', reviewedAt: new Date().toISOString(), error: null, jobId: job.id });
    }
    checkpoint({ phase: 'applying', completed: index + 1, total: itemIds.length, percent: itemIds.length ? Math.round(((index + 1) / itemIds.length) * 100) : 100 });
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const jobOrchestrator = new JobOrchestrator({
  profile: normalizeJobProfile(loadState()?.ui?.experimental?.schedulerProfile),
  handlers: {
    scan: runLibraryJob,
    analyze: runLibraryJob,
    'deep-scan': runLibraryJob,
    'source-import': runSourceImportJob,
    'workbench-analysis': runWorkbenchAnalysisJob,
    'workbench-apply': runWorkbenchApplyJob,
    export: runArchiveExportJob,
    'bulk-trash': runBulkTrashJob,
    ocr: runOcrJob,
    hash: runHashJob
  },
  shouldBlockJob: (job) => {
    if (job.kind === 'ocr') {
      return ocrPaused || !getOcrEngineInfo().available;
    }
    if (job.kind === 'source-import') {
      return listJobs().some((entry) => (
        entry.id !== job.id
        && entry.kind === 'source-import'
        && entry.status === 'running'
        && (
          entry.payload?.connectorId === job.payload?.connectorId
          || (
            entry.payload?.sourceId
            && job.payload?.sourceId
            && entry.payload.sourceId === job.payload.sourceId
          )
        )
      ));
    }
    return false;
  },
  onStateChanged: ({ job, syncStatus }) => {
    updateSyncStatusPatch(syncStatus);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('jobs:progress', {
        job,
        syncStatus: latestSyncStatus
      });
    }
  }
});

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfJsModulePromise;
}

function normalizeJobProfile(profile) {
  return ['interactive', 'balanced', 'idle-only'].includes(String(profile || '').trim())
    ? String(profile).trim()
    : 'balanced';
}

async function readPdfPageCount(pdfPath, options = {}) {
  const maxBytes = Math.max(1, Number(options.maxBytes) || MAX_PDF_BYTES);
  const stats = await fs.promises.stat(pdfPath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > maxBytes) {
    throw new Error('PDF hors limite de taille.');
  }
  const pdfjs = await loadPdfJsModule();
  // Use async I/O so large PDFs don't block the main event loop during the boot-time cache warm-up.
  const fileBuffer = await fs.promises.readFile(pdfPath);
  if (fileBuffer.length > maxBytes) throw new Error('PDF hors limite de taille.');
  const data = new Uint8Array(fileBuffer);
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    verbosity: 0
  });

  try {
    const document = await loadingTask.promise;
    return Number(document?.numPages || 0);
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}


async function collectPdfFilesFromState(state) {
  const files = [];
  for (const category of state?.categories || []) {
    if (!category?.path) continue;
    let mangaEntries;
    try {
      mangaEntries = await fs.promises.readdir(category.path, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const mangaEntry of mangaEntries) {
      if (!mangaEntry.isDirectory()) continue;
      const mangaPath = path.join(category.path, mangaEntry.name);
      let chapterEntries;
      try {
        chapterEntries = await fs.promises.readdir(mangaPath, { withFileTypes: true });
      } catch (_error) {
        continue;
      }
      for (const entry of chapterEntries) {
        if (entry.isFile() && isPdfFile(entry.name)) {
          files.push(path.join(mangaPath, entry.name));
        }
      }
    }
  }
  return files;
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function syncPdfMetaCache() {
  const state = loadState();
  const nextPdfMeta = { ...(state.pdfMeta || {}) };
  const knownFiles = new Set(await collectPdfFilesFromState(state));
  let changed = false;
  let processedSinceYield = 0;

  for (const filePath of knownFiles) {
    // Yield between files so the renderer keeps getting CPU time during the boot-time warm-up.
    if (processedSinceYield >= 4) {
      await yieldToEventLoop();
      processedSinceYield = 0;
    }
    processedSinceYield += 1;

    let stats = null;
    try {
      stats = await fs.promises.stat(filePath);
    } catch (_error) {
      continue;
    }

    const mtimeMs = Number(stats?.mtimeMs || 0);
    const cached = nextPdfMeta[filePath];
    if (cached?.pageCount > 0 && Number(cached?.mtimeMs || 0) === mtimeMs) {
      continue;
    }

    try {
      const pageCount = await readPdfPageCount(filePath);
      if (pageCount > 0) {
        nextPdfMeta[filePath] = {
          ...(cached || {}),
          pageCount,
          mtimeMs,
          validatedAt: new Date().toISOString()
        };
        changed = true;
      }
    } catch (_error) {
      // Ignore invalid PDFs without blocking the library load.
    }
  }

  for (const cachedPath of Object.keys(nextPdfMeta)) {
    if (!knownFiles.has(cachedPath)) {
      delete nextPdfMeta[cachedPath];
      changed = true;
    }
  }

  if (changed) {
    updateState((draft) => {
      draft.pdfMeta = nextPdfMeta;
      return draft;
    });
  }

  return changed;
}

function emitLibraryPayload(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('library:changed', payload);
  mainWindow.webContents.send('library:compactIndexChanged', payload.compactIndex);
}

function scheduleSourceLinkReconciliation(library, delay = 900) {
  const mangas = (Array.isArray(library?.allMangas) ? library.allMangas : []).map((manga) => ({
    id: manga?.id || null,
    contentId: manga?.contentId || null,
    path: manga?.path || null,
    displayTitle: manga?.displayTitle || manga?.name || '',
    categoryId: manga?.categoryId || manga?.category?.id || manga?.categoryIds?.[0] || null
  }));
  if (!mangas.length) return;
  if (sourceReconcileTimer) clearTimeout(sourceReconcileTimer);
  sourceReconcileTimer = setTimeout(() => {
    sourceReconcileTimer = null;
    if (sourceReconcilePromise) return;
    updateSyncStatusPatch({
      state: 'updating',
      label: 'mise a jour',
      detail: 'Liens de sources verifies en arriere-plan'
    });
    sourceReconcilePromise = reconcileSourceLinksInWorker(mangas, { userDataPath: getUserDataPath() })
      .then((result) => {
        if (!result?.changed) return;
        invalidateSourcesStateCache();
        sourceRevision += 1;
        emitStatePatch({
          sourceSync: {
            revision: sourceRevision,
            linkCount: Number(result.linkCount || 0)
          }
        });
      })
      .catch((error) => {
        console.error('[sources] background reconciliation failed:', error);
        updateSyncStatusPatch({
          state: 'attention-needed',
          label: 'attention',
          detail: 'Verification des liens de sources a relancer'
        });
      })
      .finally(() => {
        sourceReconcilePromise = null;
        if (latestSyncStatus.state !== 'attention-needed') {
          updateSyncStatusPatch({
            state: 'up-to-date',
            label: 'a jour',
            detail: 'Donnees locales synchronisees'
          });
        }
      });
  }, Math.max(0, delay));
  if (typeof sourceReconcileTimer.unref === 'function') sourceReconcileTimer.unref();
}

function requestPdfMetaSync(options = {}) {
  if (options.refreshLibraryAfterSync) {
    pdfMetaNeedsRefresh = true;
  }

  if (pdfMetaSyncPromise) {
    pdfMetaResyncRequested = true;
    return pdfMetaSyncPromise;
  }

  pdfMetaSyncPromise = (async () => {
    let hasChanges = false;
    do {
      pdfMetaResyncRequested = false;
      const changed = await syncPdfMetaCache();
      if (changed) hasChanges = true;
    } while (pdfMetaResyncRequested);
    return hasChanges;
  })()
    .catch(() => false)
    .then(async (hasChanges) => {
      if (hasChanges && pdfMetaNeedsRefresh && mainWindow && !mainWindow.isDestroyed()) {
        const payload = await buildInteractivePayloadAsync({ refreshDerived: false });
        detectNewChapters(payload.library);
        emitLibraryPayload(payload);
      }
      return hasChanges;
    })
    .finally(() => {
      pdfMetaSyncPromise = null;
      pdfMetaNeedsRefresh = false;
    });

  return pdfMetaSyncPromise;
}

/* ------------------------------------------------------------------ */
/*  Protocol - manga://local/<encoded-path>                                  */
/* ------------------------------------------------------------------ */

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'manga',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

function registerLocalAssetProtocol() {
  protocol.handle('manga', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'local') {
        const encodedPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
        const filePath = decodeURIComponent(encodedPath);
        const thumbnailResponse = await createThumbnailAssetResponse(filePath, url);
        if (thumbnailResponse) return thumbnailResponse;
        return net.fetch(pathToFileURL(filePath).toString());
      }

      if (url.hostname === 'cbz') {
        const encodedPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
        const archivePath = decodeURIComponent(encodedPath);
        const entryName = url.searchParams.get('entry');
        if (!archivePath || !entryName) {
          return new Response('Missing CBZ asset parameters', { status: 400 });
        }
        if (url.searchParams.get('thumbnail') === '1') {
          const cachedEntryPath = await ensureCbzEntryCached(archivePath, entryName);
          if (cachedEntryPath) {
            const thumbnailResponse = await createThumbnailAssetResponse(cachedEntryPath, url);
            if (thumbnailResponse) return thumbnailResponse;
          }
        }
        return createCbzAssetResponse(archivePath, entryName);
      }

      if (url.hostname === 'remote') {
        const encodedUrl = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
        const remoteUrl = decodeURIComponent(encodedUrl);
        const targetUrl = new URL(remoteUrl);
        if (!['http:', 'https:'].includes(targetUrl.protocol)) {
          return new Response('Unsupported remote protocol', { status: 400 });
        }
        return net.fetch(targetUrl.toString(), {
          headers: {
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'User-Agent': 'Sawa Manga Library/5.0.1',
            Referer: `${targetUrl.protocol}//${targetUrl.host}/`
          }
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      return new Response('Unable to load local asset', { status: 500 });
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Window                                                            */
/* ------------------------------------------------------------------ */

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) return;

  splashWindow = new BrowserWindow({
    width: 440,
    height: 260,
    show: true,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#0a1020',
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  const splashHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          :root { color-scheme: dark; }
          html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #0a1020; font-family: "Segoe UI", system-ui, sans-serif; }
          .shell {
            width: 100%;
            height: 100%;
            display: grid;
            place-items: center;
            background:
              radial-gradient(130% 100% at 15% 8%, rgba(96, 165, 250, 0.25), transparent 60%),
              radial-gradient(120% 110% at 85% 90%, rgba(244, 114, 182, 0.22), transparent 62%),
              #0a1020;
            color: #dbe5f8;
          }
          .card {
            display: grid;
            gap: 14px;
            place-items: center;
            width: 280px;
          }
          .logo {
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 0.02em;
          }
          .spinner {
            width: 28px;
            height: 28px;
            border-radius: 999px;
            border: 2px solid rgba(255, 255, 255, 0.18);
            border-top-color: #7dd3fc;
            animation: spin 0.7s linear infinite;
          }
          .label {
            font-size: 13px;
            color: rgba(219, 229, 248, 0.75);
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="card">
            <div class="logo">Sawa</div>
            <div class="spinner"></div>
            <div class="label">Chargement rapide…</div>
          </div>
        </div>
      </body>
    </html>
  `;

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function ensureMainWindowVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) return;
  try {
    mainWindow.maximize();
    mainWindow.show();
  } catch (_error) {
    // Best effort only.
  }
}

function scheduleSplashFailSafeClose(delayMs = 10000) {
  if (splashFailSafeTimer) {
    clearTimeout(splashFailSafeTimer);
  }
  splashFailSafeTimer = setTimeout(() => {
    ensureMainWindowVisible();
    closeSplashWindow();
  }, delayMs);
}

function closeSplashWindow() {
  if (splashFailSafeTimer) {
    clearTimeout(splashFailSafeTimer);
    splashFailSafeTimer = null;
  }
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  try {
    if (typeof splashWindow.setClosable === 'function') {
      splashWindow.setClosable(true);
    }
    splashWindow.destroy();
  } catch (_error) {
    try {
      splashWindow.close();
    } catch (_) {
      // noop
    }
  }
  splashWindow = null;
}

function createWindow() {
  createSplashWindow();
  scheduleSplashFailSafeClose(10000);

  mainWindow = new BrowserWindow({
    title: 'Sawa',
    width: 1500,
    height: 960,
    minWidth: 1160,
    minHeight: 720,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  installTextContextMenu(mainWindow.webContents, Menu, () => mainWindow);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.once('did-finish-load', () => {
    ensureMainWindowVisible();
    setTimeout(() => closeSplashWindow(), 40);
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    ensureMainWindowVisible();
    setTimeout(() => closeSplashWindow(), 60);
  });

  mainWindow.webContents.on('did-fail-load', () => {
    closeSplashWindow();
  });

  mainWindow.webContents.on('unresponsive', () => {
    recordMeasurement('renderer.unresponsive', 0, { severity: 'critical' });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    recordMeasurement('renderer.process-gone', 0, {
      reason: String(details?.reason || 'unknown'),
      exitCode: Number(details?.exitCode || 0)
    });
  });

  mainWindow.on('close', () => {
    persistVaultLock();
  });

  mainWindow.on('closed', () => {
    closeSplashWindow();
    mainWindow = null;
  });
}

/* ------------------------------------------------------------------ */
/*  State helpers                                                     */
/* ------------------------------------------------------------------ */

function getNsfwOnlyTagIds(state) {
  const usageByTagId = new Map();
  const mangaTags = state?.mangaTags || {};
  const mangaTagMeta = state?.mangaTagMeta || {};

  for (const [mangaId, tagIds] of Object.entries(mangaTags)) {
    const metaForManga = mangaTagMeta[mangaId] || {};
    for (const tagId of Array.isArray(tagIds) ? tagIds : []) {
      if (!state?.tags?.[tagId]) continue;
      const entry = usageByTagId.get(tagId) || { nsfw: 0, safe: 0 };
      if (metaForManga?.[tagId]?.nsfw) entry.nsfw += 1;
      else entry.safe += 1;
      usageByTagId.set(tagId, entry);
    }
  }

  const hidden = new Set();
  for (const [tagId, usage] of usageByTagId.entries()) {
    if (usage.nsfw > 0 && usage.safe === 0) hidden.add(tagId);
  }
  return hidden;
}

function getPrivateMangaIdSet(state) {
  return new Set(
    (Array.isArray(state?.vault?.privateMangaIds) ? state.vault.privateMangaIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
}

function getPrivateCategoryIdSet(state) {
  return new Set(
    (Array.isArray(state?.vault?.privateCategoryIds) ? state.vault.privateCategoryIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
}

function isVaultConfigured(state) {
  return Boolean(state?.vault?.pinProtectedBlob || state?.vault?.pinHash);
}

function isVaultLocked(state) {
  return isVaultConfigured(state) && Boolean(state?.vault?.locked);
}

function isSystemVaultProtectionAvailable() {
  return process.platform === 'win32'
    && Boolean(safeStorage)
    && typeof safeStorage.isEncryptionAvailable === 'function'
    && safeStorage.isEncryptionAvailable();
}

function getVaultSecurityMode(state) {
  if (state?.vault?.pinProtectedBlob) return 'system';
  if (state?.vault?.pinHash) return 'basic';
  return 'none';
}

function buildProtectedPinBlob(pin) {
  if (!isSystemVaultProtectionAvailable()) return null;
  const normalizedPin = normalizePinInput(pin);
  if (!normalizedPin) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(normalizedPin, salt, 32).toString('hex');
  return safeStorage.encryptString(JSON.stringify({ version: 1, salt, hash })).toString('base64');
}

function verifyProtectedPinBlob(pin, pinProtectedBlob) {
  if (!pinProtectedBlob || !isSystemVaultProtectionAvailable()) return false;
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(String(pinProtectedBlob), 'base64'));
    const parsed = JSON.parse(decrypted);
    if (!parsed?.salt || !parsed?.hash) return false;
    const nextHash = crypto.scryptSync(normalizePinInput(pin), parsed.salt, 32).toString('hex');
    return nextHash === parsed.hash;
  } catch (_error) {
    return false;
  }
}

function buildVaultPrivacyModel(library, state) {
  const existingMangaMap = new Map();
  for (const manga of library?.allMangas || []) {
    if (manga?.id) existingMangaMap.set(manga.id, manga.id);
    if (manga?.contentId) existingMangaMap.set(manga.contentId, manga.id);
    if (manga?.locationId) existingMangaMap.set(manga.locationId, manga.id);
  }
  const directPrivateIds = new Set(
    [...getPrivateMangaIdSet(state)]
      .map((mangaId) => existingMangaMap.get(mangaId) || null)
      .filter(Boolean)
  );
  const privateCategoryIds = getPrivateCategoryIdSet(state);
  const categoryPrivateIds = new Set();

  for (const category of library?.categories || []) {
    if (!privateCategoryIds.has(category.id)) continue;
    for (const manga of category.mangas || []) {
      if (manga?.id) categoryPrivateIds.add(manga.id);
    }
  }

  return {
    directPrivateIds,
    privateCategoryIds,
    categoryPrivateIds,
    allPrivateIds: new Set([...directPrivateIds, ...categoryPrivateIds])
  };
}

function applyVaultVisibilityToLibrary(library, state, privacyModel) {
  const { directPrivateIds, privateCategoryIds, categoryPrivateIds, allPrivateIds } = privacyModel || buildVaultPrivacyModel(library, state);
  const hideDirectPrivate = isVaultLocked(state) || Boolean(state?.vault?.stealthMode);
  const idsHiddenFromLibrary = hideDirectPrivate ? allPrivateIds : categoryPrivateIds;
  const withPrivacy = (manga, forcedPrivate = null) => ({
    ...manga,
    isPrivate: forcedPrivate === null ? allPrivateIds.has(manga.id) : Boolean(forcedPrivate)
  });

  const visibleCategories = (library.categories || [])
    .filter((category) => !privateCategoryIds.has(category.id))
    .map((category) => {
      const mangas = (category.mangas || [])
        .filter((manga) => !idsHiddenFromLibrary.has(manga.id))
        .map((manga) => withPrivacy(manga, hideDirectPrivate ? false : null));
      return {
        ...category,
        mangas,
        mangaCount: mangas.length
      };
    });

  const visibleMangas = (library.allMangas || [])
    .filter((manga) => !idsHiddenFromLibrary.has(manga.id))
    .map((manga) => withPrivacy(manga, hideDirectPrivate ? false : null));
  const visibleMap = new Map(visibleMangas.map((manga) => [manga.id, manga]));

  return {
    ...library,
    allMangas: visibleMangas,
    favorites: (library.favorites || [])
      .filter((manga) => !idsHiddenFromLibrary.has(manga.id))
      .map((manga) => visibleMap.get(manga.id) || withPrivacy(manga, hideDirectPrivate ? false : null)),
    recents: (library.recents || [])
      .filter((entry) => !idsHiddenFromLibrary.has(entry.mangaId))
      .map((entry) => ({
        ...entry,
        isPrivate: hideDirectPrivate ? false : directPrivateIds.has(entry.mangaId)
      })),
    categories: visibleCategories
  };
}

function buildVaultLibrary(library, state, privacyModel) {
  const { privateCategoryIds, allPrivateIds } = privacyModel || buildVaultPrivacyModel(library, state);
  if (isVaultLocked(state) || allPrivateIds.size === 0) {
    return { categories: [], allMangas: [], favorites: [], recents: [] };
  }

  const privateMangas = (library.allMangas || [])
    .filter((manga) => allPrivateIds.has(manga.id))
    .map((manga) => ({ ...manga, isPrivate: true }));
  const privateMap = new Map(privateMangas.map((manga) => [manga.id, manga]));

  return {
    categories: (library.categories || [])
      .filter((category) => privateCategoryIds.has(category.id))
      .map((category) => {
        const mangas = (category.mangas || [])
          .filter((manga) => allPrivateIds.has(manga.id))
          .map((manga) => privateMap.get(manga.id) || { ...manga, isPrivate: true });
        return {
          ...category,
          isVaulted: true,
          mangas,
          mangaCount: mangas.length
        };
      }),
    allMangas: privateMangas,
    favorites: (library.favorites || [])
      .filter((manga) => allPrivateIds.has(manga.id))
      .map((manga) => privateMap.get(manga.id) || { ...manga, isPrivate: true }),
    recents: (library.recents || [])
      .filter((entry) => allPrivateIds.has(entry.mangaId))
      .map((entry) => ({ ...entry, isPrivate: true }))
  };
}

function persistVaultLock() {
  const current = loadState();
  if (!isVaultConfigured(current) || current?.vault?.locked) {
    return current;
  }
  return updateState((state) => {
    state.vault = state.vault || {};
    state.vault.autoLockOnClose = true;
    state.vault.locked = true;
    return state;
  });
}

function stripPrivateContentFromPersistedState(state, existingLibrary) {
  const library = existingLibrary || scanLibrary(state);
  const { privateCategoryIds, allPrivateIds } = buildVaultPrivacyModel(library, state);
  const clientState = structuredClone(state);
  const locked = isVaultLocked(state);
  const stealthMode = Boolean(state?.vault?.stealthMode);
  const effectiveHidePrivate = locked || stealthMode;

  clientState.vault = {
    configured: isVaultConfigured(state),
    locked,
    blurCovers: Boolean(state?.vault?.blurCovers),
    stealthMode,
    autoLockOnClose: true,
    privateCount: allPrivateIds.size,
    privateCategoryCount: privateCategoryIds.size,
    privateMangaIds: effectiveHidePrivate ? [] : [...allPrivateIds],
    privateCategoryIds: effectiveHidePrivate ? [] : [...privateCategoryIds],
    securityMode: getVaultSecurityMode(state),
    systemProtectionAvailable: isSystemVaultProtectionAvailable()
  };

  if (!effectiveHidePrivate) return clientState;

  const privateChapterIds = new Set(
    (library?.allMangas || [])
      .filter((manga) => allPrivateIds.has(manga.id))
      .flatMap((manga) => (manga.chapters || []).flatMap((chapter) => [
        chapter.id,
        chapter.contentId,
        chapter.locationId,
        chapter.legacyId,
        chapter.progressKey,
        chapter.metadataKey
      ]))
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  sanitizePrivateMangaReferences(clientState, allPrivateIds, privateChapterIds);

  clientState.categories = (clientState.categories || []).filter((category) => !privateCategoryIds.has(category.id));
  if (privateCategoryIds.has(clientState?.ui?.selectedCategoryId)) {
    clientState.ui.selectedCategoryId = null;
  }
  return stripPrivateIdentityState(clientState, allPrivateIds);
}

function buildClientPersistedState(state, rawLibrary) {
  const privateSafeState = stripPrivateContentFromPersistedState(state, rawLibrary);
  // Tombstones contain local paths and rollback state. They are intentionally
  // retained only in the main process and never cross the preload boundary.
  delete privateSafeState.deletionTombstones;
  if (privateSafeState?.ui?.allowNsfwSources) return privateSafeState;

  const hiddenTagIds = getNsfwOnlyTagIds(privateSafeState);
  if (hiddenTagIds.size === 0) return privateSafeState;

  const clientState = structuredClone(privateSafeState);
  for (const tagId of hiddenTagIds) {
    delete clientState.tags[tagId];
  }

  for (const mangaId of Object.keys(clientState.mangaTags || {})) {
    clientState.mangaTags[mangaId] = (clientState.mangaTags[mangaId] || []).filter((tagId) => !hiddenTagIds.has(tagId));
    if (clientState.mangaTags[mangaId].length === 0) delete clientState.mangaTags[mangaId];
  }

  for (const mangaId of Object.keys(clientState.mangaTagMeta || {})) {
    for (const tagId of Object.keys(clientState.mangaTagMeta[mangaId] || {})) {
      if (hiddenTagIds.has(tagId)) delete clientState.mangaTagMeta[mangaId][tagId];
    }
    if (Object.keys(clientState.mangaTagMeta[mangaId]).length === 0) delete clientState.mangaTagMeta[mangaId];
  }

  return clientState;
}

function buildSourceWebMeta(link) {
  const importedSet = new Set(Array.isArray(link?.importedChapterIds) ? link.importedChapterIds : []);
  const knownIds = Array.isArray(link?.lastKnownChapterIds) ? link.lastKnownChapterIds : [];
  const newChapterCount = knownIds.filter((chapterId) => !importedSet.has(chapterId)).length;
  return {
    linked: true,
    connectorId: link.connectorId,
    seriesId: link.seriesId,
    sourceId: link.sourceId,
    sourceLabel: link.sourceLabel || 'Source web',
    coverUrl: link.coverUrl || '',
    destinationCategoryId: link.destinationCategoryId || '',
    importedChapterIds: [...importedSet],
    lastKnownChapterIds: knownIds,
    lastImportedAt: link.lastImportedAt || '',
    lastCheckedAt: link.lastCheckedAt || '',
    newChapterCount,
    statusLabel: newChapterCount > 0 ? 'Nouveaux chapitres disponibles' : 'Suivi web actif'
  };
}

function enrichMangasWithSourceLinks(mangas = [], links = []) {
  const byContentId = new Map();
  const byMangaId = new Map();
  const byPath = new Map();

  links.forEach((link) => {
    if (link.localContentId) byContentId.set(link.localContentId, link);
    if (link.localMangaId) byMangaId.set(link.localMangaId, link);
    if (link.localSeriesPath) byPath.set(String(link.localSeriesPath).toLowerCase(), link);
  });

  return (Array.isArray(mangas) ? mangas : []).map((manga) => {
    const match = byContentId.get(manga.contentId)
      || byMangaId.get(manga.id)
      || byPath.get(String(manga.path || '').toLowerCase())
      || null;
    if (!match) return manga;
    return {
      ...manga,
      sourceWeb: buildSourceWebMeta(match)
    };
  });
}

function enrichCategoriesWithSourceLinks(categories = [], links = []) {
  return (Array.isArray(categories) ? categories : []).map((category) => ({
    ...category,
    mangas: enrichMangasWithSourceLinks(category?.mangas, links)
  }));
}

function buildStatePayload(options = {}) {
  const {
    rawLibrary: providedLibrary = null,
    skipReconciliation = false,
    skipDerivedSync = false,
    skipScanIndexSync = false,
    skipScanTimestamp = false
  } = options;

  let persisted = loadState();
  configurePerfDiagnostics(Boolean(persisted?.ui?.experimental?.performanceDiagnostics));
  const persistedExperimental = persisted?.ui?.experimental || {};
  if (persistedExperimental.visualReader || persistedExperimental.guidedView || persistedExperimental.visualDedupe) {
    persisted = updateState((state) => {
      state.ui = state.ui || {};
      state.ui.experimental = {
        ...(state.ui.experimental || {}),
        visualReader: false,
        guidedView: false,
        visualDedupe: false
      };
      return state;
    });
  }

  const usesProvidedLibrary = Boolean(providedLibrary);
  const previousLibrary = rawLibrarySnapshot || readLibrarySnapshot();
  let rawLibrary = providedLibrary || scanLibrary(persisted);
  rawLibrary = preserveUnavailableLibraryEntries(rawLibrary, previousLibrary, persisted);
  persisted = persistCategoryAvailability(rawLibrary, persisted);
  const livePaths = new Set((rawLibrary?.allMangas || [])
    .map((manga) => String(manga?.path || '').toLowerCase())
    .filter(Boolean));
  const now = Date.now();
  const tombstoneNeedsUpdate = Object.values(persisted.deletionTombstones || {}).some((tombstone) => (
    Date.parse(tombstone?.expiresAt) <= now
    || livePaths.has(String(tombstone?.path || '').toLowerCase())
  ));
  if (tombstoneNeedsUpdate) {
    persisted = updateState((state) => {
      restoreReturnedTombstones(state, rawLibrary?.allMangas || [], now);
      return state;
    });
  }

  if (!skipReconciliation) {
    const reconciliation = reconcilePersistedStateWithLibrary(persisted, rawLibrary);
    if (reconciliation.changed) {
      persisted = reconciliation.persisted;
    } else if (!skipScanIndexSync) {
      const currentScanEntries = JSON.stringify(getScanEntries(persisted?.scanIndex));
      const nextScanEntries = JSON.stringify(getScanEntries(rawLibrary?.scanIndex));
      if (currentScanEntries !== nextScanEntries) {
        persisted = updateState((state) => {
          state.scanIndex = rawLibrary.scanIndex;
          return state;
        });
      }
    }
  }

  // A derived snapshot intentionally contains scan data only. Always reapply
  // the current user segments before exposing it so remapped progress,
  // metadata and organization survive a restart after a folder move.
  rawLibrary = applyPersistedOverlayToLibrary(rawLibrary, persisted);

  const sourceState = loadSourcesState();
  const sourceLinks = sourceState.seriesLinks || [];
  const privacyModel = buildVaultPrivacyModel(rawLibrary, persisted);
  const library = {
    ...applyVaultVisibilityToLibrary(rawLibrary, persisted, privacyModel)
  };
  const vaultLibrary = {
    ...buildVaultLibrary(rawLibrary, persisted, privacyModel)
  };
  library.allMangas = enrichMangasWithSourceLinks(library.allMangas, sourceLinks);
  library.favorites = enrichMangasWithSourceLinks(library.favorites, sourceLinks);
  library.recents = enrichMangasWithSourceLinks(library.recents, sourceLinks);
  library.categories = enrichCategoriesWithSourceLinks(library.categories, sourceLinks);
  vaultLibrary.allMangas = enrichMangasWithSourceLinks(vaultLibrary.allMangas, sourceLinks);
  vaultLibrary.favorites = enrichMangasWithSourceLinks(vaultLibrary.favorites, sourceLinks);
  vaultLibrary.recents = enrichMangasWithSourceLinks(vaultLibrary.recents, sourceLinks);
  vaultLibrary.categories = enrichCategoriesWithSourceLinks(vaultLibrary.categories, sourceLinks);
  const compactIndex = buildCompactIndex(library);
  legacySeriesIndex = buildLegacySeriesIndex(library);
  legacySeriesIndexReady = true;
  rawLibrarySnapshot = rawLibrary;
  if (!skipDerivedSync) {
    try {
      syncLibrarySnapshot(rawLibrary, {
        annotationsByManga: persisted.annotations || {}
      });
    } catch (_error) {
      // Keep the primary library flow healthy even if the derived layer needs a rebuild.
    }
  }
  if (!skipScanTimestamp) {
    lastScanTime = Date.now();
  }
  updateSyncStatusPatch();
  stateRevision += 1;
  const payload = {
    stateRevision,
    sourceRevision,
    syncState: {
      status: latestSyncStatus.state,
      lastSuccess: latestSyncStatus.lastCompletedAt || null,
      error: latestSyncStatus.state === 'attention-needed' ? latestSyncStatus.detail : null
    },
    persisted: buildClientPersistedState(persisted, rawLibrary),
    plugins: listAvailablePlugins(persisted),
    sources: {
      recentSeries: sourceState.recentSeries || [],
      linkedSeries: sourceLinks
    },
    library,
    vaultLibrary,
    compactIndex,
    systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  };
  recordMeasurement('library.payload', 0, {
    source: usesProvidedLibrary ? 'snapshot' : 'scan',
    mangaCount: Array.isArray(library?.allMangas) ? library.allMangas.length : 0,
    payload
  });
  return payload;
}

function runInteractiveDerivedSync() {
  if (interactiveDerivedSyncPromise) {
    interactiveDerivedSyncQueued = true;
    return interactiveDerivedSyncPromise;
  }

  interactiveDerivedSyncPromise = (async () => {
    do {
      interactiveDerivedSyncQueued = false;
      const persisted = loadState();
      const baseLibrary = rawLibrarySnapshot || readLibrarySnapshot();
      if (!baseLibrary) return;
      const { rawLibrary } = buildInteractiveLibraryPayload({
        rawLibrary: baseLibrary,
        persisted,
        scanLibrary
      });
      rawLibrarySnapshot = rawLibrary;
      await patchLibrarySnapshotInWorker(rawLibrary, {
        annotationsByManga: persisted.annotations || {}
      }, {
        userDataPath: getUserDataPath()
      });
    } while (interactiveDerivedSyncQueued);
  })().finally(() => {
    interactiveDerivedSyncPromise = null;
  });

  return interactiveDerivedSyncPromise;
}

function scheduleInteractiveDerivedSync(delay = 900) {
  if (interactiveDerivedSyncTimer) {
    clearTimeout(interactiveDerivedSyncTimer);
  }

  interactiveDerivedSyncTimer = setTimeout(() => {
    interactiveDerivedSyncTimer = null;
    runInteractiveDerivedSync().then(() => {
      updateSyncStatusPatch({
        state: 'up-to-date',
        label: 'a jour',
        detail: 'Donnees derivees synchronisees'
      });
    }).catch((error) => {
      updateSyncStatusPatch({
        state: 'attention-needed',
        label: 'attention',
        detail: 'Synchronisation derivee a relancer'
      });
      console.error('[library] interactive derived sync failed:', error);
    });
  }, delay);

  if (typeof interactiveDerivedSyncTimer.unref === 'function') {
    interactiveDerivedSyncTimer.unref();
  }
}

function buildInteractivePayload(options = {}) {
  const {
    refreshDerived = true,
    derivedSyncDelay = 900
  } = options;
  const persisted = loadState();
  const baseLibrary = rawLibrarySnapshot || readLibrarySnapshot();
  const { rawLibrary, usedSnapshot } = buildInteractiveLibraryPayload({
    rawLibrary: baseLibrary,
    persisted,
    scanLibrary
  });
  const payload = buildStatePayload({
    rawLibrary,
    skipReconciliation: true,
    skipDerivedSync: true,
    skipScanIndexSync: true,
    skipScanTimestamp: true
  });
  rawLibrarySnapshot = rawLibrary;

  if (refreshDerived) {
    updateSyncStatusPatch({
      state: 'updating',
      label: 'mise a jour',
      detail: usedSnapshot ? 'Synchronisation locale en arriere-plan' : 'Indexation locale en arriere-plan'
    });
    scheduleInteractiveDerivedSync(derivedSyncDelay);
  }

  return payload;
}

async function buildInteractivePayloadAsync(options = {}) {
  if (!rawLibrarySnapshot && !readLibrarySnapshot()) {
    rawLibrarySnapshot = await requestLibraryScan(loadState());
  }
  return buildInteractivePayload(options);
}

async function buildPayloadAfterStructuralScan() {
  if (libraryScanPromise) {
    await libraryScanPromise.catch(() => {});
  }
  const persisted = loadState();
  const rawLibrary = await requestLibraryScan(persisted);
  rawLibrarySnapshot = rawLibrary;
  return buildStatePayload({
    rawLibrary,
    skipReconciliation: false
  });
}

function getCoreTransitionLibrary() {
  const persisted = loadState();
  const baseLibrary = rawLibrarySnapshot || readLibrarySnapshot();
  const { rawLibrary } = buildInteractiveLibraryPayload({
    rawLibrary: baseLibrary,
    persisted,
    scanLibrary
  });
  rawLibrarySnapshot = rawLibrary;
  return { persisted, rawLibrary };
}

function getCoreMigrationReport() {
  const { persisted, rawLibrary } = getCoreTransitionLibrary();
  return analyzeLegacySnapshot({
    persistedState: persisted,
    library: rawLibrary
  });
}

function getCoreMigrationStatus() {
  const store = getCoreStore();
  return {
    ...store.getMigrationStatus(),
    pendingReport: getCoreMigrationReport()
  };
}

function fallbackSeriesFromPayload(options = {}) {
  if (!legacySeriesIndexReady) {
    buildInteractivePayload({ refreshDerived: false });
  }
  return queryLegacySeriesIndex(legacySeriesIndex, options);
}

function fallbackSeriesDetail(ref) {
  const payload = buildInteractivePayload({ refreshDerived: false });
  const manga = findMangaByReference(payload.library, ref) || findMangaByReference(payload.vaultLibrary, ref);
  if (!manga) return null;
  return {
    id: manga.id,
    contentId: manga.contentId || null,
    locationId: manga.locationId || null,
    legacyId: manga.legacyId || manga.id || null,
    libraryId: manga.categoryId || null,
    title: manga.displayTitle || manga.name || manga.id,
    author: manga.author || '',
    description: manga.description || '',
    path: manga.path || null,
    coverSrc: manga.coverSrc || null,
    pageCount: Number(manga.pageCount || 0),
    chapterCount: Number(manga.chapterCount || manga.chapters?.length || 0),
    favorite: Boolean(manga.isFavorite),
    readState: manga.readingState || (manga.isRead ? 'read' : 'never'),
    progressPercent: Number(manga.progressPercent || 0),
    lastReadAt: manga.lastReadAt || null,
    tags: Array.isArray(manga.tags) ? manga.tags : [],
    collectionIds: Array.isArray(manga.collectionIds) ? manga.collectionIds : [],
    payload: manga
  };
}

function fallbackSeriesChapters(ref, options = {}) {
  const payload = buildInteractivePayload({ refreshDerived: false });
  const manga = findMangaByReference(payload.library, ref) || findMangaByReference(payload.vaultLibrary, ref);
  if (!manga) return { source: 'legacy-snapshot', total: 0, items: [] };
  const limit = Math.max(1, Math.min(1000, Number(options?.limit) || 1000));
  const offset = Math.max(0, Number(options?.offset) || 0);
  const items = (manga.chapters || []).map((chapter) => ({
    id: chapter.id,
    seriesId: manga.id,
    contentId: chapter.contentId || null,
    locationId: chapter.locationId || null,
    legacyId: chapter.legacyId || chapter.id || null,
    title: chapter.name || chapter.title || chapter.id,
    path: chapter.path || null,
    pageCount: Number(chapter.pageCount || 0),
    readState: chapter.readingState || (chapter.isRead ? 'read' : 'never'),
    progressPercent: Number(chapter.progress?.percent || 0),
    lastReadAt: chapter.lastReadAt || chapter.progress?.lastReadAt || null,
    payload: chapter
  }));
  return { source: 'legacy-snapshot', total: items.length, limit, offset, items: items.slice(offset, offset + limit) };
}

function fallbackChapterDetail(ref) {
  const payload = buildInteractivePayload({ refreshDerived: false });
  const { manga, chapter } = findChapterByReference(payload.library, ref);
  const match = chapter ? { manga, chapter } : findChapterByReference(payload.vaultLibrary, ref);
  if (!match?.chapter) return null;
  return {
    id: match.chapter.id,
    seriesId: match.manga?.id || null,
    contentId: match.chapter.contentId || null,
    locationId: match.chapter.locationId || null,
    legacyId: match.chapter.legacyId || match.chapter.id || null,
    title: match.chapter.name || match.chapter.title || match.chapter.id,
    path: match.chapter.path || null,
    pageCount: Number(match.chapter.pageCount || 0),
    readState: match.chapter.readingState || (match.chapter.isRead ? 'read' : 'never'),
    progressPercent: Number(match.chapter.progress?.percent || 0),
    lastReadAt: match.chapter.lastReadAt || match.chapter.progress?.lastReadAt || null,
    payload: match.chapter
  };
}

function hasCompletedCoreMigration() {
  const status = getCoreStore().getMigrationStatus();
  return Boolean(status?.latestMigration?.status === 'completed');
}

function detectNewChapters(library) {
  const state = loadState();
  const known = state.knownChapterCounts || {};
  const updates = {};
  let hasNew = false;

  for (const manga of library.allMangas || []) {
    const prev = known[manga.id];
    if (typeof prev === 'number' && manga.chapterCount > prev) {
      hasNew = true;
    }
    updates[manga.id] = manga.chapterCount;
  }

  if (Object.keys(updates).length > 0) {
    updateState((s) => {
      s.knownChapterCounts = { ...s.knownChapterCounts, ...updates };
      return s;
    });
  }

  return hasNew;
}

function ensureQueuedJob(kind, payload = {}) {
  const existing = listJobs().find((job) =>
    job.kind === kind
    && ['queued', 'running', 'cancel_requested'].includes(job.status)
  );
  if (existing) return existing;
  return jobOrchestrator.enqueue({ kind, payload });
}

function consumeInstallerFirstRunScan() {
  const prefix = '--sawa-first-run-scan=';
  const scanArg = process.argv.find((arg) => String(arg || '').startsWith(prefix));
  if (scanArg) {
    const libraryPath = scanArg.slice(prefix.length);
    writeFirstRunScanMarker(getUserDataPath(), libraryPath);
  }

  const result = consumeFirstRunScanMarker({
    userDataPath: getUserDataPath(),
    loadState,
    updateState,
    makeId,
    enqueueScan: ensureQueuedJob
  });

  if (result.consumed && result.categoryAdded) {
    try {
      jobOrchestrator.schedule();
      restartWatchers();
    } catch (_error) {
      // Startup must stay resilient even if the first scan cannot be scheduled immediately.
    }
  }
  return result;
}

function getMergedPayloadMangas(payload) {
  const unique = new Map();
  [...(payload?.library?.allMangas || []), ...(payload?.vaultLibrary?.allMangas || [])].forEach((manga) => {
    if (manga?.id && !unique.has(manga.id)) unique.set(manga.id, manga);
  });
  return [...unique.values()];
}

let identityAnalysisPromise = null;

function getIdentityMangas() {
  const state = loadState();
  const privateIds = buildVaultPrivacyModel(
    rawLibrarySnapshot || { allMangas: [], categories: [] },
    state
  ).allPrivateIds;
  return (rawLibrarySnapshot?.allMangas || []).map((manga) => {
    const metadata = state.metadata?.[manga.id] || {};
    return {
      ...manga,
      aliases: [...new Set([
        ...(manga.aliases || []),
        ...(metadata.aliases || []),
        ...(metadata.onlineAltTitles || [])
      ])],
      externalIds: [
        metadata.malId,
        metadata.anilistId,
        metadata.mangadexId,
        metadata.nhentaiId
      ].filter(Boolean),
      isPrivate: privateIds.has(manga.id)
    };
  });
}

function getIdentityAnalysisContextSignature() {
  const state = loadState();
  const libraryIdentity = (rawLibrarySnapshot?.allMangas || [])
    .map((manga) => ({
      id: manga.id,
      contentId: manga.contentId || null,
      path: manga.path || null,
      chapters: (manga.chapters || []).map((chapter) => ({
        id: chapter.id,
        contentId: chapter.contentId || null,
        path: chapter.path || chapter.filePath || null,
        pageCount: chapter.pageCount || chapter.pages?.length || 0
      }))
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const relevantState = {
    metadata: Object.entries(state.metadata || {})
      .sort(([left], [right]) => left.localeCompare(right)),
    vault: {
      locked: Boolean(state.vault?.locked),
      stealthMode: Boolean(state.vault?.stealthMode),
      privateMangaIds: [...(state.vault?.privateMangaIds || [])].sort()
    },
    identityRecords: Object.entries(state.identityRecords || {})
      .map(([id, record]) => [id, record?.contentId, record?.path, record?.strongFingerprint, record?.updatedAt])
      .sort(([left], [right]) => left.localeCompare(right)),
    workGroups: Object.entries(state.workGroups || {})
      .sort(([left], [right]) => left.localeCompare(right))
  };
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      stateRevision,
      sourceRevision,
      libraryIdentity,
      relevantState
    }))
    .digest('hex');
}

const identityService = createIdentityService({
  loadState,
  updateState,
  getMangas: getIdentityMangas,
  getContextSignature: getIdentityAnalysisContextSignature,
  updateSourcesState
});

function runIdentityAnalysis() {
  if (safeModeEnabled) {
    return Promise.resolve({ ok: false, error: 'Mode sûr actif.' });
  }
  if (identityAnalysisPromise) return identityAnalysisPromise;
  identityAnalysisPromise = identityService.analyze()
    .finally(() => {
      identityAnalysisPromise = null;
    });
  return identityAnalysisPromise;
}

function scheduleIdentityAnalysis(delayMs = 1200) {
  const timer = setTimeout(() => {
    runIdentityAnalysis().catch((error) => {
      console.warn('[identity] background analysis failed:', error?.message || error);
    });
  }, Math.max(0, Number(delayMs || 0)));
  timer.unref?.();
}

function resolveComicInfoSidecarTargetPath(manga) {
  if (manga?.path && fs.existsSync(manga.path)) {
    const stats = fs.statSync(manga.path);
    if (stats.isDirectory()) {
      return path.join(manga.path, 'ComicInfo.xml');
    }
  }

  const firstChapter = (manga?.chapters || []).find((chapter) => chapter?.path);
  if (!firstChapter?.path) return null;
  return path.join(path.dirname(firstChapter.path), 'ComicInfo.xml');
}

function makeOcrPageId(chapter, page, languages = []) {
  return crypto
    .createHash('sha1')
    .update(`${chapter?.contentId || chapter?.locationId || chapter?.id}::${page?.index || 0}::${languages.join('+')}`)
    .digest('hex')
    .slice(0, 24);
}

async function resolvePageImagePath(page) {
  if (!page) return null;
  if (page.containerType === 'cbz' && page.assetPath && page.archiveEntryName) {
    return ensureCbzEntryCached(page.assetPath, page.archiveEntryName);
  }
  if (page.containerType === 'pdf') return null;
  if (page.path && fs.existsSync(page.path)) return page.path;
  return null;
}

async function collectOcrTargets(input = {}) {
  const payload = await buildInteractivePayloadAsync({ refreshDerived: false });
  const mangas = getMergedPayloadMangas(payload);
  const entityLibrary = { allMangas: mangas };

  const requestedMangaRefs = Array.isArray(input?.mangaIds) ? input.mangaIds : [];
  const requestedChapterRefs = Array.isArray(input?.chapterIds) ? input.chapterIds : [];

  const explicitMangas = requestedMangaRefs
    .map((reference) => findMangaByReference(entityLibrary, reference))
    .filter(Boolean);

  const baseMangas = explicitMangas.length > 0 ? explicitMangas : mangas;
  const targets = [];

  baseMangas.forEach((manga) => {
    const chapters = requestedChapterRefs.length > 0
      ? (manga.chapters || []).filter((chapter) => requestedChapterRefs.some((reference) => (
          String(reference || '').trim() === String(chapter.id || '').trim()
          || String(reference || '').trim() === String(chapter.contentId || '').trim()
          || String(reference || '').trim() === String(chapter.locationId || '').trim()
        )))
      : (manga.chapters || []);

    chapters.forEach((chapter) => {
      if (!chapter?.path) return;
      const pages = getChapterPages(chapter.path, loadState()) || [];
      const imagePages = pages.filter((page) => page?.containerType !== 'pdf');
      if (imagePages.length === 0) return;
      targets.push({ manga, chapter, pages: imagePages });
    });
  });

  return targets;
}

async function runOcrJob({ job, checkpoint, isCancelled }) {
  const engine = getOcrEngineInfo();
  if (!engine.available) {
    throw new Error('Moteur OCR local introuvable. Installe Tesseract ou active l OCR Windows pris en charge par Sawa.');
  }

  const languages = uniqueStrings(Array.isArray(job?.payload?.languages) ? job.payload.languages : ['eng']);
  const targets = await collectOcrTargets(job?.payload || {});
  const totalPages = targets.reduce((sum, entry) => sum + entry.pages.length, 0);
  let processedPages = 0;
  let indexedPages = 0;
  let skippedPages = 0;

  for (const target of targets) {
    for (const page of target.pages) {
      if (isCancelled()) return;
      const imagePath = await resolvePageImagePath(page);
      if (!imagePath) {
        skippedPages += 1;
        checkpoint({ totalPages, processedPages, indexedPages, skippedPages });
        continue;
      }

      try {
        const textBody = await runOcrOnImage(imagePath, languages);
        if (textBody) {
          upsertOcrPage({
            id: makeOcrPageId(target.chapter, page, languages),
            itemContentId: target.chapter.contentId || target.manga.contentId || null,
            itemLocationId: target.chapter.locationId || target.chapter.id || null,
            pageRef: `${target.chapter.contentId || target.chapter.id || target.chapter.locationId}:${page.index}`,
            langCodes: languages,
            textBody,
            title: `${target.manga.displayTitle || target.manga.name || 'Manga'} · ${target.chapter.name || 'Chapitre'} · page ${Number(page.index || 0) + 1}`
          });
          indexedPages += 1;
        } else {
          skippedPages += 1;
        }
      } catch (_error) {
        skippedPages += 1;
      }

      processedPages += 1;
      checkpoint({ totalPages, processedPages, indexedPages, skippedPages });
    }
  }
}

async function ensureStoredVisualHashForManga(manga, existingHashes = null) {
  const existing = (existingHashes || listVisualHashes()).find((entry) => (
    entry.itemContentId === manga?.contentId
    || entry.itemLocationId === manga?.locationId
    || entry.id === manga?.contentId
    || entry.id === manga?.locationId
    || entry.id === manga?.id
  ));
  if (existing?.hash) return existing;

  const source = await resolveMangaVisualSource(manga);
  if (!source?.imagePath) return null;
  const hash = computeAverageImageHash(source.imagePath);
  if (!hash) return null;

  return upsertVisualHash({
    id: manga.contentId || manga.locationId || manga.id,
    itemContentId: manga.contentId || null,
    itemLocationId: manga.locationId || manga.id || null,
    hash,
    source: source.source
  });
}

async function buildVisualDuplicateCandidates() {
  const payload = await buildInteractivePayloadAsync({ refreshDerived: false });
  const mangas = getMergedPayloadMangas(payload);
  const currentHashes = listVisualHashes();
  const prepared = [];

  for (const manga of mangas) {
    const visual = await ensureStoredVisualHashForManga(manga, currentHashes);
    if (!visual?.hash) continue;
    if (!currentHashes.some((entry) => entry.id === visual.id)) currentHashes.push(visual);
    prepared.push({ manga, visual });
  }

  const pairs = [];
  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
      const left = prepared[leftIndex];
      const right = prepared[rightIndex];
      const distance = hammingDistance(left.visual.hash, right.visual.hash);
      if (!Number.isFinite(distance) || distance > 10) continue;

      const titleScore = titleSimilarityScore(left.manga.displayTitle || left.manga.name, right.manga.displayTitle || right.manga.name);
      const chapterDelta = Math.abs(Number(left.manga.chapterCount || 0) - Number(right.manga.chapterCount || 0));
      const score = Math.max(1, Math.round(((64 - distance) / 64) * 70 + titleScore * 30));
      const reasons = [];
      reasons.push(`distance visuelle ${distance}/64`);
      if (titleScore >= 0.8) reasons.push('titre tres proche');
      else if (titleScore >= 0.55) reasons.push('titre proche');
      if (chapterDelta === 0) reasons.push('meme nombre de chapitres');

      if (score < 55) continue;

      pairs.push({
        id: `${left.manga.id}:${right.manga.id}`,
        score,
        reasons,
        left: {
          id: left.manga.id,
          title: left.manga.displayTitle || left.manga.name || 'Manga'
        },
        right: {
          id: right.manga.id,
          title: right.manga.displayTitle || right.manga.name || 'Manga'
        }
      });
    }
  }

  return pairs
    .sort((left, right) => right.score - left.score)
    .slice(0, 24);
}

/* ------------------------------------------------------------------ */
/*  Library watcher                                                   */
/* ------------------------------------------------------------------ */

async function emitLibraryChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  ensureQueuedJob('scan', { source: 'watcher' });
  requestPdfMetaSync({ refreshLibraryAfterSync: true });
}

function restartWatchers() {
  const state = loadState();
  const paths = state.categories.map((category) => category.path);
  watcher.restart(paths, emitLibraryChanged);
}

/* ------------------------------------------------------------------ */
/*  App lifecycle                                                     */
/* ------------------------------------------------------------------ */

function scheduleBootstrapPdfSync() {
  // Defer the first PDF metadata warm-up until after the renderer has painted its first frame
  // so the main thread's fs/async work does not compete with UI startup.
  const kick = () => {
    setTimeout(() => requestPdfMetaSync({ refreshLibraryAfterSync: true }), 5000);
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', kick);
    } else {
      kick();
    }
  } else {
    setTimeout(kick, 1200);
  }
}

function scheduleBootstrapRefreshScan() {
  if (bootstrapRefreshScanTimer) return;
  bootstrapRefreshScanTimer = setTimeout(() => {
    bootstrapRefreshScanTimer = null;
    try {
      ensureQueuedJob('scan', { source: 'bootstrap-refresh' });
      jobOrchestrator.schedule();
    } catch (_error) {
      // Keep startup flow stable even if queueing fails once.
    }
  }, 6000);
}

function requestRendererSessionFlush() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false);
  sessionFlushSequence += 1;
  const requestId = `session-flush-${Date.now()}-${sessionFlushSequence}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sessionFlushWaiters.delete(requestId);
      resolve(false);
    }, 1200);
    sessionFlushWaiters.set(requestId, (ok) => {
      clearTimeout(timer);
      sessionFlushWaiters.delete(requestId);
      resolve(Boolean(ok));
    });
    try {
      mainWindow.webContents.send('session:flushRequested', requestId);
    } catch (_error) {
      clearTimeout(timer);
      sessionFlushWaiters.delete(requestId);
      resolve(false);
    }
  });
}

app.whenReady().then(() => {
  registerLocalAssetProtocol();
  createWindow();
  if (!safeModeEnabled) {
    jobOrchestrator.bootstrap();
    consumeInstallerFirstRunScan();
    setTimeout(() => restartWatchers(), 3500);
    scheduleBootstrapPdfSync();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (!safeModeEnabled) scheduleBootstrapPdfSync();
    }
  });
});

app.on('before-quit', (event) => {
  if (quitFlushComplete) return;
  event.preventDefault();
  if (quitFlushInProgress) return;
  quitFlushInProgress = true;
  requestRendererSessionFlush().catch(() => false).then(() => {
    persistVaultLock();
    metadataProviderRegistry?.clearPrivateCache();
    terminateSourceRuntimeProcesses();
    const snapshot = loadState();
    try { writeLastValidSnapshot(getUserDataPath(), snapshot); } catch (_error) {}
    return Promise.all([
      flushWithDeadline({
        timeoutMs: 2000,
        flushState: flushStateWrites,
        flushSources: flushSourcesStateWrites
      }),
      shutdownHeavyIoWorkers({ timeoutMs: 750 }),
      thumbnailUtilityPool?.shutdown() || Promise.resolve(),
      metadataProviderRegistry?.flush() || Promise.resolve()
    ]);
  }).then(([result]) => {
    if (result.ok) clearShutdownMarker(getUserDataPath());
    else writeShutdownMarker(getUserDataPath(), result);
  }).catch((error) => {
    writeShutdownMarker(getUserDataPath(), { error: error?.message || String(error) });
  }).finally(() => {
    closeDerivedStore();
    closeCoreStore();
    closeSplashWindow();
    quitFlushComplete = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  closeSplashWindow();
  if (process.platform !== 'darwin') {
    watcher.close();
    terminateSourceRuntimeProcesses();
    app.quit();
  }
});

/* ------------------------------------------------------------------ */
/*  Reading progress helper                                           */
/* ------------------------------------------------------------------ */

function persistReadingProgress(payload) {
  updateStateSegments({
    reader: ['progress', 'chapterReadStatus', 'recents'],
    root: ['ui']
  }, (state) => {
    const {
      mangaId,
      chapterId,
      pageIndex,
      pageCount,
      mode,
      fitMode,
      zoom,
      scrollTop,
      scrollRatio,
      anchorPageIndex,
      intraPageOffset
    } = payload;
    const now = new Date().toISOString();
    const previous = state.progress?.[chapterId] || {};
    const furthestPageIndex = Math.max(
      Number(previous.furthestPageIndex ?? previous.pageIndex) || 0,
      Number(payload.furthestPageIndex ?? pageIndex) || 0
    );

    state.progress[chapterId] = {
      ...previous,
      mangaId,
      chapterId,
      pageIndex,
      furthestPageIndex,
      pageCount,
      mode,
      fitMode,
      zoom,
      scrollTop,
      scrollRatio,
      anchorPageIndex: Number.isFinite(Number(anchorPageIndex)) ? Math.max(0, Math.floor(Number(anchorPageIndex))) : Math.max(0, Number(pageIndex) || 0),
      intraPageOffset: Number.isFinite(Number(intraPageOffset)) ? Math.max(0, Number(intraPageOffset)) : 0,
      lastReadAt: now
    };

    // Auto-mark chapter as read based on threshold from UI settings
    const threshold = state.ui?.autoMarkReadThreshold ?? 95;
    if (typeof pageCount === 'number' && typeof pageIndex === 'number' && pageCount > 0) {
      const percent = ((furthestPageIndex + 1) / pageCount) * 100;
      if (percent >= threshold) {
        state.chapterReadStatus[chapterId] = true;
      }
    }

    state.recents = state.recents.filter((entry) => entry.chapterId !== chapterId);
    state.recents.unshift({
      mangaId,
      chapterId,
      pageIndex,
      lastReadAt: now
    });
    state.recents = state.recents.slice(0, 50);

    state.ui.readerMode = mode;
    if (fitMode) state.ui.readerFit = fitMode;
    if (Number.isFinite(Number(zoom))) state.ui.readerZoom = Number(zoom);
    return state;
  });
}

function makeLocalId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePinInput(pin) {
  return String(pin || '').trim().replace(/\s+/g, '');
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(normalizePinInput(pin)).digest('hex');
}

const QUEUE_SOURCE_PRIORITY = ['manual', 'quick-add', 'end-of-chapter', 'next-engine'];
const METADATA_SOURCE_WEIGHT = {
  'manual-locked': 5,
  manual: 4,
  comicinfo: 3,
  online: 2,
  scanner: 1
};

function normalizeQueueSource(source) {
  const normalized = String(source || '').trim();
  return QUEUE_SOURCE_PRIORITY.includes(normalized) ? normalized : 'manual';
}

function getQueueDisplaySource(sources = []) {
  const normalizedSources = [...new Set((Array.isArray(sources) ? sources : []).map(normalizeQueueSource))];
  return QUEUE_SOURCE_PRIORITY.find((source) => normalizedSources.includes(source)) || 'manual';
}

function applyMetadataField(state, mangaId, field, nextValue, source) {
  const metadata = state.metadata?.[mangaId] || {};
  const locks = state.metadataLocks?.[mangaId] || {};
  const fieldSources = state.metadataFieldSource?.[mangaId] || {};
  const currentSource = String(fieldSources[field] || '').trim();
  const currentValue = metadata[field];
  const hasCurrentValue = Array.isArray(currentValue) ? currentValue.length > 0 : String(currentValue || '').trim().length > 0;
  const normalizedSource = String(source || 'manual').trim();
  const nextWeight = METADATA_SOURCE_WEIGHT[locks[field] ? 'manual-locked' : normalizedSource] ?? 0;
  const currentWeight = METADATA_SOURCE_WEIGHT[locks[field] ? 'manual-locked' : currentSource] ?? 0;

  if (locks[field] && normalizedSource !== 'manual') return false;
  if (hasCurrentValue && normalizedSource !== 'manual' && currentWeight > nextWeight) return false;
  if (hasCurrentValue && normalizedSource !== 'manual' && currentWeight === nextWeight) return false;

  state.metadata[mangaId] = {
    ...(state.metadata[mangaId] || {}),
    [field]: nextValue
  };
  state.metadataFieldSource[mangaId] = {
    ...(state.metadataFieldSource[mangaId] || {}),
    [field]: normalizedSource
  };
  return true;
}

function findMangaByReference(library, reference) {
  const normalized = String(reference || '').trim();
  if (!normalized) return null;
  return (library?.allMangas || []).find((manga) =>
    manga.id === normalized
    || manga.contentId === normalized
    || manga.locationId === normalized
  ) || null;
}

function findChapterByReference(library, reference) {
  const normalized = String(reference || '').trim();
  if (!normalized) return { manga: null, chapter: null };
  for (const manga of library?.allMangas || []) {
    const chapter = (manga.chapters || []).find((entry) =>
      entry.id === normalized
      || entry.contentId === normalized
      || entry.locationId === normalized
    );
    if (chapter) return { manga, chapter };
  }
  return { manga: null, chapter: null };
}

function moveKeyedEntry(record, fromKey, toKey, transformValue = (value) => value) {
  if (!record || typeof record !== 'object' || !fromKey || !toKey || fromKey === toKey) return false;
  if (!(fromKey in record)) return false;
  if (!(toKey in record)) {
    record[toKey] = transformValue(record[fromKey]);
  }
  delete record[fromKey];
  return true;
}

function remapValue(value, fromId, toId) {
  return String(value || '').trim() === fromId ? toId : value;
}

function remapSessionIdentifiers(state, mangaIdMap, chapterIdMap) {
  if (!state?.session || typeof state.session !== 'object') return false;
  let changed = false;

  const remapView = (view) => {
    if (!view || typeof view !== 'object') return view;
    const nextView = { ...view };
    if (nextView.mangaId && mangaIdMap.has(nextView.mangaId)) {
      nextView.mangaId = mangaIdMap.get(nextView.mangaId);
      changed = true;
    }
    if (nextView.chapterId && chapterIdMap.has(nextView.chapterId)) {
      nextView.chapterId = chapterIdMap.get(nextView.chapterId);
      changed = true;
    }
    return nextView;
  };

  const remapTab = (tab) => {
    if (!tab || typeof tab !== 'object') return tab;
    const nextTab = { ...tab };
    if (nextTab.view) nextTab.view = remapView(nextTab.view);
    return nextTab;
  };

  if (Array.isArray(state.session.workspaces)) {
    state.session.workspaces = state.session.workspaces.map((workspace) => ({
      ...workspace,
      tabs: Array.isArray(workspace.tabs) ? workspace.tabs.map(remapTab) : []
    }));
  }

  if (Array.isArray(state.session.tabs)) {
    state.session.tabs = state.session.tabs.map(remapTab);
  }

  return changed;
}

function reconcilePersistedStateWithLibrary(persisted, rawLibrary) {
  const previousEntries = getScanEntries(persisted?.scanIndex);
  const nextEntries = getScanEntries(rawLibrary?.scanIndex);
  if (previousEntries.length === 0 || nextEntries.length === 0) {
    return { changed: false, persisted };
  }

  const previousByContentId = new Map();
  for (const entry of previousEntries) {
    if (!entry?.contentId) continue;
    const matches = previousByContentId.get(entry.contentId) || [];
    matches.push(entry);
    previousByContentId.set(entry.contentId, matches);
  }
  const pathTail = (entry) => {
    const normalized = path.normalize(String(entry?.path || ''));
    const parts = normalized.split(path.sep).filter(Boolean);
    const depth = entry?.type === 'chapter' ? 2 : 1;
    return parts.slice(-depth).join(path.sep).toLowerCase();
  };
  const mangaIdMap = new Map();
  const chapterIdMap = new Map();

  for (const entry of nextEntries) {
    const candidates = (previousByContentId.get(entry?.contentId) || [])
      .filter((candidate) => candidate?.type === entry?.type);
    const structuralMatches = candidates.length > 1
      ? candidates.filter((candidate) => pathTail(candidate) === pathTail(entry))
      : candidates;
    const previous = structuralMatches.length === 1 ? structuralMatches[0] : null;
    if (!previous || !previous.legacyId || !entry?.legacyId || previous.legacyId === entry.legacyId) continue;
    if (entry.type === 'manga') mangaIdMap.set(previous.legacyId, entry.legacyId);
    if (entry.type === 'chapter') chapterIdMap.set(previous.legacyId, entry.legacyId);
  }

  if (mangaIdMap.size === 0 && chapterIdMap.size === 0) {
    return { changed: false, persisted };
  }

  const nextState = updateState((state) => {
    for (const [fromId, toId] of mangaIdMap.entries()) {
      moveKeyedEntry(state.metadata, fromId, toId);
      moveKeyedEntry(state.favorites, fromId, toId);
      moveKeyedEntry(state.readStatus, fromId, toId);
      moveKeyedEntry(state.knownChapterCounts, fromId, toId);
      moveKeyedEntry(state.mangaTags, fromId, toId);
      moveKeyedEntry(state.mangaTagMeta, fromId, toId);
      moveKeyedEntry(state.annotations, fromId, toId, (value) =>
        Array.isArray(value)
          ? value.map((item) => ({ ...item, mangaId: toId }))
          : value
      );
      moveKeyedEntry(state.metadataLocks, fromId, toId);
      moveKeyedEntry(state.metadataFieldSource, fromId, toId);

      state.recents = (state.recents || []).map((entry) => ({
        ...entry,
        mangaId: remapValue(entry.mangaId, fromId, toId)
      }));
      state.metadataWorkbenchQueue = (state.metadataWorkbenchQueue || []).map((value) => remapValue(value, fromId, toId));
      state.metadataWorkbenchItems = (state.metadataWorkbenchItems || []).map((item) => ({
        ...item,
        mangaId: remapValue(item?.mangaId, fromId, toId)
      }));
      if (Array.isArray(state.metadataWorkbenchLastBatch?.entries)) {
        state.metadataWorkbenchLastBatch.entries = state.metadataWorkbenchLastBatch.entries.map((entry) => ({
          ...entry,
          mangaId: remapValue(entry?.mangaId, fromId, toId)
        }));
      }
      state.vault.privateMangaIds = (state.vault?.privateMangaIds || []).map((value) => remapValue(value, fromId, toId));
      state.readingQueue = (state.readingQueue || []).map((item) => ({
        ...item,
        mangaId: remapValue(item.mangaId, fromId, toId)
      }));

      for (const progressEntry of Object.values(state.progress || {})) {
        if (progressEntry?.mangaId === fromId) progressEntry.mangaId = toId;
      }

      for (const collection of Object.values(state.collections || {})) {
        if (!Array.isArray(collection?.mangaIds)) continue;
        collection.mangaIds = collection.mangaIds.map((value) => remapValue(value, fromId, toId));
      }
    }

    for (const [fromId, toId] of chapterIdMap.entries()) {
      moveKeyedEntry(state.progress, fromId, toId, (value) => ({ ...(value || {}), chapterId: toId }));
      moveKeyedEntry(state.chapterReadStatus, fromId, toId);
      state.recents = (state.recents || []).map((entry) => ({
        ...entry,
        chapterId: remapValue(entry.chapterId, fromId, toId)
      }));
      state.readingQueue = (state.readingQueue || []).map((item) => ({
        ...item,
        chapterId: remapValue(item.chapterId, fromId, toId)
      }));
      for (const annotations of Object.values(state.annotations || {})) {
        if (!Array.isArray(annotations)) continue;
        for (const annotation of annotations) {
          if (annotation?.chapterId === fromId) annotation.chapterId = toId;
        }
      }
    }

    remapSessionIdentifiers(state, mangaIdMap, chapterIdMap);
    remapPersistedReferences(
      state,
      [...mangaIdMap.entries()].map(([fromMangaId, toMangaId]) => ({ fromMangaId, toMangaId })),
      [...chapterIdMap.entries()].map(([fromChapterId, toChapterId]) => ({ fromChapterId, toChapterId }))
    );
    state.scanIndex = rawLibrary.scanIndex;
    return state;
  });

  if (mangaIdMap.size > 0) {
    updateSourcesState((draft) => {
      draft.seriesLinks = remapSourceLinks(
        draft.seriesLinks,
        [...mangaIdMap.entries()].map(([fromMangaId, toMangaId]) => ({ fromMangaId, toMangaId }))
      );
      return draft;
    });
  }

  return { changed: true, persisted: nextState };
}

/* ================================================================== */
/*  IPC Handlers                                                      */
/* ================================================================== */

/* ---------- App ---------- */

ipcMain.on('app:boot-ready', () => {
  ensureMainWindowVisible();
  closeSplashWindow();
});

ipcMain.on('session:flushComplete', (_event, payload) => {
  const requestId = typeof payload === 'string' ? payload : payload?.requestId;
  const waiter = sessionFlushWaiters.get(String(requestId || ''));
  waiter?.(typeof payload === 'string' ? true : payload?.ok !== false);
});

ipcMain.on('app:mark-interaction', () => {
  jobOrchestrator.markInteraction();
});

ipcMain.on('app:perf-event', (_event, entry = {}) => {
  const durationMs = Math.max(0, Math.min(60_000, Number(entry?.durationMs) || 0));
  const kind = String(entry?.kind || 'renderer.event').replace(/[^a-z0-9_.-]/gi, '').slice(0, 60);
  recordMeasurement(kind || 'renderer.event', durationMs, { source: 'renderer' });
});

ipcMain.on('reader:set-active', (_event, active) => {
  jobOrchestrator.setReaderActive(Boolean(active));
});

ipcMain.handle('app:reload', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'Fenetre indisponible.' };
  mainWindow.reload();
  return { ok: true };
});

ipcMain.handle('app:restart', async (_event, options = {}) => {
  const safeMode = Boolean(options?.safeMode);
  const args = process.argv.slice(1).filter((arg) => arg !== '--sawa-safe-mode');
  if (safeMode) args.push('--sawa-safe-mode');
  app.relaunch({ args });
  app.quit();
  return { ok: true, safeMode };
});

ipcMain.handle('app:openDiagnostics', async () => {
  const directory = getDiagnosticDir(getUserDataPath());
  const error = await shell.openPath(directory);
  return error ? { ok: false, error } : { ok: true, path: directory };
});

ipcMain.handle('app:copyDiagnostics', async (_event, input = {}) => {
  const message = String(input?.message || '').replace(/[\r\n]+/g, ' ').slice(0, 500);
  const marker = readShutdownMarker(getUserDataPath());
  clipboard.writeText(JSON.stringify({
    appVersion: app.getVersion(),
    safeMode: safeModeEnabled,
    rendererMessage: message || null,
    shutdownWarning: marker ? {
      recordedAt: marker.recordedAt,
      timedOut: marker.timedOut,
      stateFlushed: marker.stateFlushed,
      sourcesFlushed: marker.sourcesFlushed
    } : null,
    diagnostics: getDiagnosticsSnapshot()
  }, null, 2));
  return { ok: true };
});

function resolveAllowedMediaPath(filePath) {
  const roots = [
    getUserDataPath(),
    ...loadState().categories.map((category) => category.path)
  ];
  return resolveRealPathWithinRoots(filePath, roots);
}

ipcMain.handle('media:openSource', async (_event, filePath) => {
  const resolved = resolveAllowedMediaPath(filePath);
  if (!resolved) return { ok: false, error: 'Chemin media refuse ou introuvable.' };
  const error = await shell.openPath(resolved);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('media:reportFailure', async (_event, input = {}) => {
  const resolved = resolveAllowedMediaPath(input?.filePath);
  if (!resolved) return { ok: false, error: 'Chemin media refuse ou introuvable.' };
  const entry = {
    recordedAt: new Date().toISOString(),
    kind: ['pdf', 'image'].includes(String(input?.kind)) ? String(input.kind) : 'image',
    pageNumber: Math.max(1, Math.min(100000, Number(input?.pageNumber) || 1)),
    code: String(input?.code || 'render-failed').replace(/[^a-z0-9_.-]/gi, '').slice(0, 60),
    fileName: path.basename(resolved)
  };
  const rateKey = `${entry.kind}:${resolved}:${entry.pageNumber}:${entry.code}`;
  const now = Date.now();
  if ((now - Number(mediaFailureLastReported.get(rateKey) || 0)) < 10_000) {
    return { ok: true, rateLimited: true };
  }
  mediaFailureLastReported.set(rateKey, now);
  const logPath = path.join(getDiagnosticDir(getUserDataPath()), 'media-failures.jsonl');
  if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
    fs.rmSync(`${logPath}.1`, { force: true });
    fs.renameSync(logPath, `${logPath}.1`);
  }
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return { ok: true };
});

ipcMain.handle('app:bootstrap', async () => {
  const snapshotLibrary = readLibrarySnapshot();
  const hasSnapshot = Boolean(snapshotLibrary && Array.isArray(snapshotLibrary?.allMangas));
  const payload = hasSnapshot
    ? buildStatePayload({
      rawLibrary: snapshotLibrary,
      skipReconciliation: true,
      skipDerivedSync: true,
      skipScanIndexSync: true,
      skipScanTimestamp: true
    })
    : await (async () => {
      const persistedBeforeScan = loadState();
      const rawLibrary = await requestLibraryScan(persistedBeforeScan);
      const diskChanged = !areScanIndexesEquivalent(persistedBeforeScan.scanIndex, rawLibrary.scanIndex);
      return buildStatePayload({
        rawLibrary,
        skipReconciliation: false,
        skipDerivedSync: !diskChanged
      });
    })();
  if (hasSnapshot) {
    if (bootstrapChapterDetectionTimer) clearTimeout(bootstrapChapterDetectionTimer);
    bootstrapChapterDetectionTimer = setTimeout(() => {
      bootstrapChapterDetectionTimer = null;
      try {
        detectNewChapters(payload.library);
      } catch (_error) {
        // Non bloquant: le scan en arriere-plan corrigera l'etat si besoin.
      }
    }, 2500);
  } else {
    detectNewChapters(payload.library);
  }
  if (!safeModeEnabled && hasSnapshot && (loadState()?.categories?.length || 0) > 0) {
    updateSyncStatusPatch({
      state: 'updating',
      label: 'mise a jour',
      detail: 'Verification locale en arriere-plan'
    });
    scheduleBootstrapRefreshScan();
  }
  if (!safeModeEnabled) scheduleSourceLinkReconciliation(payload.library);
  if (!safeModeEnabled) scheduleIdentityAnalysis(hasSnapshot ? 1800 : 400);
  const shutdownWarning = readShutdownMarker(getUserDataPath());
  return {
    ...payload,
    reliability: {
      safeMode: safeModeEnabled,
      safeModeSnapshotLoaded: Boolean(safeModeSnapshot?.state),
      shutdownWarning: shutdownWarning ? {
        recordedAt: shutdownWarning.recordedAt,
        timedOut: shutdownWarning.timedOut,
        stateFlushed: shutdownWarning.stateFlushed,
        sourcesFlushed: shutdownWarning.sourcesFlushed
      } : null
    }
  };
});

ipcMain.handle('app:getCompactIndex', async () => {
  requestPdfMetaSync();
  const derivedLibrary = readLibrarySnapshot();
  if (derivedLibrary) return buildCompactIndex(derivedLibrary);
  return (await buildInteractivePayloadAsync({ refreshDerived: false })).compactIndex;
});

ipcMain.handle('library:getSyncStatus', async () => {
  return {
    ...latestSyncStatus,
    snapshot: getSnapshotMeta(),
    jobs: listJobs()
  };
});

/* ---------- Core v2 migration and targeted APIs ---------- */

ipcMain.handle('migration:getStatus', async () => getCoreMigrationStatus());

ipcMain.handle('migration:analyze', async () => ({
  ok: true,
  report: getCoreMigrationReport(),
  status: getCoreStore().getMigrationStatus()
}));

ipcMain.handle('migration:run', async (_event, options = {}) => {
  const { persisted, rawLibrary } = getCoreTransitionLibrary();
  const report = analyzeLegacySnapshot({ persistedState: persisted, library: rawLibrary });
  if (options?.dryRun) {
    return {
      ok: true,
      dryRun: true,
      report,
      status: getCoreStore().getMigrationStatus()
    };
  }

  const backup = createBackup('pre-v2-migration');
  await flushStateWrites();
  const migrationId = `migration-${Date.now()}`;
  const result = getCoreStore().migrateLegacySnapshot({
    persistedState: persisted,
    library: rawLibrary,
    backupPath: backup.path,
    migrationId
  });
  updateState((state) => {
    state.migrationLog = Array.isArray(state.migrationLog) ? state.migrationLog : [];
    state.migrationLog.push({
      id: migrationId,
      type: 'core-v2',
      createdAt: new Date().toISOString(),
      backupPath: backup.path,
      counts: result.report?.counts || report.counts
    });
    return state;
  });
  return {
    ...result,
    backup,
    status: getCoreStore().getMigrationStatus()
  };
});

ipcMain.handle('migration:restoreBackup', async (_event, input = {}) => {
  const backupPath = typeof input === 'string' ? input : input?.backupPath;
  if (!backupPath || !fs.existsSync(backupPath)) {
    return { ok: false, error: 'Backup introuvable.' };
  }
  const restored = await importBackup(backupPath);
  if (!restored?.restored) {
    return { ok: false, restored, error: restored?.error || 'Restauration impossible.' };
  }
  rawLibrarySnapshot = null;
  return {
    ok: true,
    restored,
    payload: await buildPayloadAfterStructuralScan()
  };
});

ipcMain.handle('migration:listBackups', async () => ({
  ok: true,
  backups: listBackups()
}));

ipcMain.handle('migration:cleanupLegacyStorage', async (_event, input = {}) => {
  if (input?.confirm !== 'cleanup-legacy-json') {
    return {
      ok: false,
      requiresConfirmation: true,
      message: 'Nettoyage refuse sans confirmation explicite. Les anciens JSON restent restaurables.'
    };
  }
  updateState((state) => {
    state.migrationLog = Array.isArray(state.migrationLog) ? state.migrationLog : [];
    state.migrationLog.push({
      id: `cleanup-${Date.now()}`,
      type: 'core-v2-cleanup-requested',
      createdAt: new Date().toISOString(),
      note: 'Nettoyage destructif non execute automatiquement; conservation legacy privilegiee.'
    });
    return state;
  });
  return {
    ok: true,
    cleaned: false,
    message: 'Aucun fichier legacy supprime automatiquement; conservation active pour rollback manuel.'
  };
});

ipcMain.handle('series:list', async (_event, input = {}) => {
  if (hasCompletedCoreMigration()) {
    return {
      source: 'core-v2',
      ...getCoreStore().listSeries(input)
    };
  }
  return fallbackSeriesFromPayload(input);
});

ipcMain.handle('series:getDetail', async (_event, seriesRef) => {
  if (hasCompletedCoreMigration()) {
    return {
      source: 'core-v2',
      series: getCoreStore().getSeriesDetail(seriesRef)
    };
  }
  return {
    source: 'legacy-snapshot',
    series: fallbackSeriesDetail(seriesRef)
  };
});

ipcMain.handle('series:getChapters', async (_event, seriesRef, options = {}) => {
  if (hasCompletedCoreMigration()) {
    return {
      source: 'core-v2',
      ...getCoreStore().getSeriesChapters(seriesRef, options)
    };
  }
  return fallbackSeriesChapters(seriesRef, options);
});

ipcMain.handle('chapter:getDetail', async (_event, chapterRef) => {
  if (hasCompletedCoreMigration()) {
    return {
      source: 'core-v2',
      chapter: getCoreStore().getChapterDetail(chapterRef)
    };
  }
  return {
    source: 'legacy-snapshot',
    chapter: fallbackChapterDetail(chapterRef)
  };
});

ipcMain.handle('reader:getPages', async (_event, chapterRef) => {
  if (hasCompletedCoreMigration()) {
    const result = getCoreStore().getReaderPages(chapterRef);
    if (result.pages.length > 0 || !result.chapter?.path) {
      return { source: 'core-v2', ...result };
    }
    return {
      source: 'core-v2-fallback-pages',
      chapter: result.chapter,
      pages: getChapterPages(result.chapter.path, loadState())
    };
  }
  const chapter = fallbackChapterDetail(chapterRef);
  return {
    source: 'legacy-snapshot',
    chapter,
    pages: chapter?.path ? getChapterPages(chapter.path, loadState()) : []
  };
});

ipcMain.handle('reader:saveProgress', async (_event, payload = {}) => {
  persistReadingProgress(payload);
  scheduleInteractiveDerivedSync(350);
  return { ok: true };
});

ipcMain.handle('search:query', async (_event, input = {}) => {
  const state = loadState();
  const rawLibrary = rawLibrarySnapshot || readLibrarySnapshot() || {
    allMangas: [],
    categories: []
  };
  const useCoreSearch = hasCompletedCoreMigration();
  const result = runPrivacySafeAdvancedSearch({
    input,
    state,
    rawLibrary,
    searchDocuments: useCoreSearch
      ? (query, limit) => getCoreStore().search(query, limit).results.map((entry) => ({
          itemContentId: entry?.series?.contentId || null,
          itemLocationId: entry?.series?.locationId || entry?.series?.id || entry?.id || null,
          docType: 'manga'
        }))
      : searchDocuments
  });
  return {
    source: useCoreSearch ? 'core-v2' : 'derived-index',
    ...result
  };
});

ipcMain.handle('filters:run', async (_event, filter = {}) => {
  if (hasCompletedCoreMigration()) {
    return {
      source: 'core-v2',
      ...getCoreStore().runSmartFilter(filter)
    };
  }
  const rules = filter?.rules || filter || {};
  const result = fallbackSeriesFromPayload({ limit: filter?.limit || 100, favoriteOnly: rules.type === 'favorites' });
  if (rules.type === 'in-progress' || rules.type === 'started') {
    result.items = result.items.filter((series) => series.progressPercent > 0 || series.readState === 'in-progress');
  } else if (rules.type === 'unread') {
    result.items = result.items.filter((series) => series.progressPercent === 0 && series.readState !== 'read');
  } else if (rules.type === 'completed') {
    result.items = result.items.filter((series) => series.progressPercent >= 100 || series.readState === 'read');
  }
  result.total = result.items.length;
  return result;
});

/* ---------- Library management ---------- */

ipcMain.handle('library:addCategories', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir un ou plusieurs dossiers de categories',
    properties: ['openDirectory', 'multiSelections']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return buildInteractivePayload();
  }

  updateState((state) => {
    for (const folderPath of result.filePaths) {
      const exists = state.categories.some((entry) => entry.path === folderPath);
      if (exists) continue;
      state.categories.push({
        id: makeId('category', folderPath),
        path: folderPath,
        name: path.basename(folderPath),
        hidden: false,
        pathHistory: [folderPath],
        availability: 'available',
        lastSeenAt: new Date().toISOString(),
        missingSince: null
      });
    }
    return state;
  });

  restartWatchers();
  const payload = await buildPayloadAfterStructuralScan();
  requestPdfMetaSync({ refreshLibraryAfterSync: true });
  return payload;
});

ipcMain.handle('library:removeCategory', async (_event, categoryId) => {
  updateState((state) => {
    state.categories = state.categories.filter((entry) => entry.id !== categoryId);
    if (state.vault?.privateCategoryIds) {
      state.vault.privateCategoryIds = state.vault.privateCategoryIds.filter((entryId) => entryId !== categoryId);
    }
    if (state.ui.selectedCategoryId === categoryId) {
      state.ui.selectedCategoryId = null;
    }
    return state;
  });
  restartWatchers();
  return buildPayloadAfterStructuralScan();
});

ipcMain.handle('library:listUnavailableLocations', async () => {
  const state = loadState();
  return {
    ok: true,
    revision: stateRevision,
    categories: (state.categories || [])
      .filter((category) => category.availability === 'missing' || !fs.existsSync(category.path))
      .map((category) => ({
        id: category.id,
        name: category.name,
        path: category.path,
        pathHistory: category.pathHistory || [],
        availability: 'missing',
        missingSince: category.missingSince || null
      }))
  };
});

ipcMain.handle('library:pickRelocationTarget', async (_event, categoryId) => {
  const category = (loadState().categories || []).find((entry) => String(entry.id) === String(categoryId));
  if (!category) return { ok: false, revision: stateRevision, error: 'Categorie introuvable.' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Retrouver ${category.name}`,
    defaultPath: path.dirname(category.path),
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths?.[0]) return { ok: true, revision: stateRevision, canceled: true };
  return { ok: true, revision: stateRevision, categoryId: category.id, path: result.filePaths[0] };
});

ipcMain.handle('library:inspectRelocation', async (_event, input = {}) => {
  try {
    const categoryId = String(input.categoryId || '');
    const targetPath = path.resolve(String(input.targetPath || ''));
    const state = loadState();
    const category = (state.categories || []).find((entry) => String(entry.id) === categoryId);
    if (!category) throw new Error('Categorie introuvable.');
    const targetStat = await fs.promises.stat(targetPath);
    if (!targetStat.isDirectory()) throw new Error('Le nouvel emplacement n est pas un dossier.');
    const duplicate = (state.categories || []).find((entry) => entry.id !== category.id && normalizeRelocationPath(entry.path) === normalizeRelocationPath(targetPath));
    if (duplicate) throw new Error(`Ce dossier est deja suivi par la categorie ${duplicate.name}.`);

    const previousLibrary = rawLibrarySnapshot || readLibrarySnapshot();
    const previousCategory = (previousLibrary?.categories || []).find((entry) => String(entry.id) === categoryId);
    if (!previousCategory) throw new Error('Le dernier snapshot de cette categorie est introuvable.');
    const inspectionState = {
      ...state,
      categories: [{ ...category, path: targetPath, availability: 'available' }]
    };
    const inspectedLibrary = await scanLibraryInWorker(inspectionState, {
      userDataPath: getUserDataPath(),
      skipUnchanged: false
    });
    const nextCategory = (inspectedLibrary?.categories || []).find((entry) => String(entry.id) === categoryId);
    const publicPlan = createCategoryRelocationPlan({
      category,
      previousCategory,
      nextCategory,
      targetPath,
      stateRevision
    });
    const plan = { ...publicPlan, nextScanIndex: inspectedLibrary.scanIndex, nextLibrary: inspectedLibrary };
    relocationPlans.set(plan.id, plan);
    return { ok: true, revision: stateRevision, plan: publicPlan };
  } catch (error) {
    return { ok: false, revision: stateRevision, error: error?.message || 'Analyse du nouvel emplacement impossible.' };
  }
});

ipcMain.handle('library:applyRelocation', async (_event, planId) => {
  try {
    const plan = relocationPlans.get(String(planId || ''));
    if (!plan) throw new Error('Le plan de rattachement a expire. Relancez la verification.');
    if (!plan.autoApplicable) throw new Error('Cette correspondance doit etre validee manuellement dans Entretien.');
    let journalEntry = null;
    updateState((state) => {
      journalEntry = applyCategoryRelocation(state, plan);
      return state;
    });
    if (journalEntry?.mangaMoves?.length) {
      updateSourcesState((draft) => {
        draft.seriesLinks = remapSourceLinks(draft.seriesLinks, journalEntry.mangaMoves);
        return draft;
      });
    }
    rawLibrarySnapshot = plan.nextLibrary || null;
    relocationPlans.delete(plan.id);
    restartWatchers();
    const payload = await buildPayloadAfterStructuralScan();
    return { ok: true, revision: stateRevision, payload, relocation: journalEntry };
  } catch (error) {
    return { ok: false, revision: stateRevision, error: error?.message || 'Rattachement impossible.' };
  }
});

ipcMain.handle('library:undoRelocation', async (_event, relocationId) => {
  try {
    let journalEntry = null;
    updateState((state) => {
      journalEntry = undoCategoryRelocation(state, String(relocationId || ''));
      return state;
    });
    if (journalEntry?.mangaMoves?.length) {
      const inverseMoves = journalEntry.mangaMoves.map((move) => ({
        fromMangaId: move.toMangaId,
        toMangaId: move.fromMangaId
      }));
      updateSourcesState((draft) => {
        draft.seriesLinks = remapSourceLinks(draft.seriesLinks, inverseMoves);
        return draft;
      });
    }
    rawLibrarySnapshot = null;
    restartWatchers();
    const payload = await buildPayloadAfterStructuralScan();
    return { ok: true, revision: stateRevision, payload, relocation: journalEntry };
  } catch (error) {
    return { ok: false, revision: stateRevision, error: error?.message || 'Annulation du rattachement impossible.' };
  }
});

async function performTrashScannedMangas(mangaIds, {
  checkpoint = () => {},
  isCancelled = () => false
} = {}) {
  const payload = await buildInteractivePayloadAsync({ refreshDerived: false });
  const allMangas = [
    ...(payload.library?.allMangas || []),
    ...(payload.vaultLibrary?.allMangas || [])
  ];
  const stateBeforeTrash = loadState();
  const trashItem = async (targetPath) => {
    if (typeof shell.trashItem === 'function') {
      await shell.trashItem(targetPath);
      return;
    }
    if (typeof shell.moveItemToTrash === 'function' && shell.moveItemToTrash(targetPath)) return;
    throw new Error('Windows n a pas confirme le deplacement vers la Corbeille.');
  };
  const result = await bulkTrashMangas({
    mangas: allMangas,
    requestedIds: Array.isArray(mangaIds) ? mangaIds : [],
    categoryRoots: stateBeforeTrash.categories.map((category) => category.path),
    trashItem,
    state: stateBeforeTrash,
    concurrency: 2,
    isCancelled,
    onProgress: (progress) => {
      const { tombstone: _tombstone, ...resultEntry } = progress.result || {};
      checkpoint({
        completed: progress.completed,
        total: progress.total,
        lastResult: resultEntry
      });
    }
  });
  const succeededById = new Map(result.succeeded.map((entry) => [entry.mangaId, entry]));
  if (succeededById.size > 0) {
    updateState((state) => {
      allMangas.forEach((manga) => {
        const success = succeededById.get(manga.id);
        if (success) removeDeletedMangaState(state, manga, success.tombstone);
      });
      return state;
    });
    restartWatchers();
  }
  if (succeededById.size > 0) {
    await buildPayloadAfterStructuralScan();
    stateRevision += 1;
  }
  const results = result.results.map(({ tombstone, ...entry }) => entry);
  const patch = {
    removedMangaIds: [...succeededById.keys()],
    revision: stateRevision
  };
  checkpoint({
    completed: results.length,
    total: results.length,
    results,
    patch
  });
  return {
    results,
    patch,
    error: result.failed.length > 0
      ? `${result.failed.length} suppression${result.failed.length > 1 ? 's' : ''} non terminee${result.failed.length > 1 ? 's' : ''}.`
      : undefined
  };
}

function sanitizeCbzFileName(value, fallback = 'Chapitre') {
  const normalized = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || fallback).slice(0, 120);
}

async function runBulkTrashJob({ job, checkpoint, isCancelled }) {
  await performTrashScannedMangas(job.payload?.mangaIds, { checkpoint, isCancelled });
}

ipcMain.handle('library:trashManga', async (_event, mangaId) => {
  // The shared path returns buildPayloadAfterStructuralScan after Windows
  // confirms the Trash operation, preserving the structural-scan contract.
  const result = await performTrashScannedMangas([mangaId]);
  const nextPayload = await buildInteractivePayloadAsync({ refreshDerived: false });
  return {
    ...nextPayload,
    bulkTrash: {
      results: result.results
    },
    error: result.error
  };
});

ipcMain.handle('library:bulkTrashMangas', async (_event, mangaIds = []) => {
  if (!Array.isArray(mangaIds) || mangaIds.length > 500) {
    return {
      ok: false,
      error: 'Selection de suppression invalide.'
    };
  }
  const requestedIds = [...new Set(mangaIds
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
  if (!requestedIds.length) {
    return { ok: false, error: 'La selection de suppression est vide.' };
  }
  const job = jobOrchestrator.enqueue({
    kind: 'bulk-trash',
    payload: { mangaIds: requestedIds },
    requeueable: false,
    progress: { completed: 0, total: requestedIds.length }
  });
  return {
    ok: true,
    jobId: job.id,
    job: {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: job.progress
    }
  };
});

ipcMain.handle('library:toggleCategoryHidden', async (_event, categoryId) => {
  updateState((state) => {
    state.categories = state.categories.map((entry) =>
      entry.id === categoryId ? { ...entry, hidden: !entry.hidden } : entry
    );
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('library:getChapterPages', async (_event, chapterPath) => {
  try {
    if (isPdfFile(chapterPath)) {
      const roots = [
        getUserDataPath(),
        ...loadState().categories.map((category) => category.path)
      ];
      const allowedPdf = resolveAllowedPdfPath(chapterPath, { roots });
      if (!allowedPdf) return [];
      const pageCount = await readPdfPageCount(allowedPdf.resolvedPath, {
        maxBytes: MAX_PDF_BYTES
      });
      if (pageCount > 0) {
        updateState((state) => {
          state.pdfMeta = state.pdfMeta || {};
          state.pdfMeta[chapterPath] = {
            ...(state.pdfMeta?.[chapterPath] || {}),
            pageCount,
            validatedAt: new Date().toISOString()
          };
          return state;
        });
      }
    }
    return getChapterPages(chapterPath, loadState());
  } catch (error) {
    return [];
  }
});


ipcMain.handle('library:readPdfData', async (_event, filePath) => {
  try {
    const roots = [
      getUserDataPath(),
      ...loadState().categories.map((category) => category.path)
    ];
    const readStartedAt = Date.now();
    const result = await readAllowedPdfBuffer(filePath, { roots });
    if (!result) return null;
    const { buffer, resolvedPath } = result;
    recordMeasurement('media.pdf.readFile', Date.now() - readStartedAt, {
      filePath: resolvedPath,
      fileBytes: buffer.length
    });
    const base64 = measureSync('media.pdf.encodeBase64', () => buffer.toString('base64'), {
      fileBytes: buffer.length
    });
    recordMeasurement('media.pdf.readDataPayload', 0, {
      fileBytes: buffer.length,
      base64Bytes: Buffer.byteLength(base64, 'utf8')
    });
    return { base64 };
  } catch (error) {
    return null;
  }
});

async function resolveCoverManagerManga(mangaId) {
  const normalizedId = String(mangaId || '').trim();
  if (!normalizedId) throw new Error('Manga invalide.');
  const payload = await buildInteractivePayloadAsync({ refreshDerived: false });
  const manga = findMangaByReference(payload.library, normalizedId)
    || findMangaByReference(payload.vaultLibrary, normalizedId);
  if (!manga) throw new Error('Manga introuvable ou coffre verrouillé.');
  return manga;
}

function persistCoverProfile(mangaId, nextProfile) {
  const normalizedId = String(mangaId || '').trim();
  const profile = normalizeCoverProfile(nextProfile, normalizedId);
  const selectedPath = activeCoverPath(profile);
  updateStateSegments({ metadata: ['coverProfiles', 'metadata'] }, (state) => {
    state.coverProfiles = state.coverProfiles || {};
    state.metadata = state.metadata || {};
    state.coverProfiles[normalizedId] = profile;
    state.metadata[normalizedId] = {
      ...(state.metadata[normalizedId] || {}),
      coverMode: profile.activeVariantId === 'auto' ? 'auto' : 'custom'
    };
    if (selectedPath) state.metadata[normalizedId].coverPath = selectedPath;
    return state;
  });
  scheduleInteractiveDerivedSync();
  return profile;
}

async function importCoverFromDialog(mangaId) {
  const manga = await resolveCoverManagerManga(mangaId);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir une couverture personnalisee',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, manga };
  }
  const sourcePath = result.filePaths[0];
  const variant = await runHeavyIoTask('cover-import', {
    sourcePath,
    managedCoverDir: getManagedCoverDir(),
    sourceLabel: 'Image locale importée'
  });
  const current = loadState().coverProfiles?.[manga.id];
  const profile = selectCoverVariant(mergeCoverVariants(current, [variant]), variant.id);
  return { canceled: false, manga, profile: persistCoverProfile(manga.id, profile), variant };
}

ipcMain.handle('library:pickCover', async (_event, mangaId) => {
  const imported = await importCoverFromDialog(mangaId);
  if (imported.canceled) return buildInteractivePayload({ refreshDerived: false });
  return buildInteractivePayload();
});

ipcMain.handle('covers:list', async (_event, mangaId) => {
  const manga = await resolveCoverManagerManga(mangaId);
  const state = loadState();
  const gallery = await runHeavyIoTask('cover-gallery', {
    manga,
    profile: state.coverProfiles?.[manga.id]
  });
  const current = normalizeCoverProfile(state.coverProfiles?.[manga.id], manga.id);
  if (JSON.stringify(current.variants) !== JSON.stringify(gallery.profile.variants)) {
    updateStateSegments({ metadata: ['coverProfiles'] }, (nextState) => {
      nextState.coverProfiles = nextState.coverProfiles || {};
      nextState.coverProfiles[manga.id] = gallery.profile;
      return nextState;
    });
  }
  return { ok: true, gallery };
});

ipcMain.handle('covers:import', async (_event, mangaId) => {
  const imported = await importCoverFromDialog(mangaId);
  if (imported.canceled) return { ok: true, canceled: true };
  return mutationResult({
    mangaId: imported.manga.id,
    profile: imported.profile,
    variant: imported.variant
  });
});

ipcMain.handle('covers:adoptCandidate', async (_event, input) => {
  const manga = await resolveCoverManagerManga(input?.mangaId);
  const sourcePath = resolveCoverCandidatePath(input?.sourcePath, manga.path);
  if (!sourcePath) {
    throw new Error('La page candidate doit appartenir exactement au manga.');
  }
  const variant = await runHeavyIoTask('cover-import', {
    sourcePath,
    allowedRoot: manga.path,
    managedCoverDir: getManagedCoverDir(),
    sourceLabel: 'Page candidate'
  });
  const current = loadState().coverProfiles?.[manga.id];
  const profile = selectCoverVariant(mergeCoverVariants(current, [variant]), variant.id);
  persistCoverProfile(manga.id, profile);
  return mutationResult({ mangaId: manga.id, profile, variant });
});

ipcMain.handle('covers:select', async (_event, input) => {
  const manga = await resolveCoverManagerManga(input?.mangaId);
  const current = loadState().coverProfiles?.[manga.id];
  const profile = persistCoverProfile(manga.id, selectCoverVariant(current, input?.variantId));
  return mutationResult({ mangaId: manga.id, profile });
});

ipcMain.handle('covers:updateCrop', async (_event, input) => {
  const manga = await resolveCoverManagerManga(input?.mangaId);
  const current = loadState().coverProfiles?.[manga.id];
  const profile = persistCoverProfile(manga.id, updateCoverCrop(current, input?.format, input?.crop));
  return mutationResult({ mangaId: manga.id, profile });
});

ipcMain.handle('library:updateMetadata', async (_event, mangaId, patch) => {
  updateState((state) => {
    state.metadata = state.metadata || {};
    state.metadataLocks = state.metadataLocks || {};
    state.metadataFieldSource = state.metadataFieldSource || {};
    for (const [field, value] of Object.entries(patch || {})) {
      applyMetadataField(state, mangaId, field, value, 'manual');
    }
    return state;
  });
  return buildInteractivePayload();
});

function getGroupedEditionIds(state, mangaId) {
  const normalizedId = String(mangaId || '').trim();
  const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(normalizedId));
  return group ? [...group.editionIds] : [normalizedId];
}

ipcMain.handle('library:toggleFavorite', async (_event, mangaId) => {
  updateState((state) => {
    const nextValue = !state.favorites[mangaId];
    for (const editionId of getGroupedEditionIds(state, mangaId)) {
      if (nextValue) state.favorites[editionId] = true;
      else delete state.favorites[editionId];
    }
    const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
    if (group) group.favorite = nextValue;
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('library:toggleFavoriteLight', async (_event, mangaId) => {
  let isFavorite = false;
  updateStateSegments({ organization: ['favorites'] }, (state) => {
    isFavorite = !state.favorites?.[mangaId];
    state.favorites = state.favorites || {};
    for (const editionId of getGroupedEditionIds(state, mangaId)) {
      if (isFavorite) state.favorites[editionId] = true;
      else delete state.favorites[editionId];
    }
    const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
    if (group) group.favorite = isFavorite;
    return state;
  });
  scheduleInteractiveDerivedSync();
  return mutationResult({ mangaId, isFavorite });
});

ipcMain.handle('library:bulkFavorite', async (_event, mangaIds = [], nextValue = true) => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  updateState((state) => {
    ids.forEach((mangaId) => {
      const nextFavorite = nextValue === null ? !state.favorites?.[mangaId] : Boolean(nextValue);
      for (const editionId of getGroupedEditionIds(state, mangaId)) {
        if (nextFavorite) state.favorites[editionId] = true;
        else delete state.favorites[editionId];
      }
      const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
      if (group) group.favorite = nextFavorite;
    });
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('library:setPrivateFlag', async (_event, mangaId, isPrivate) => {
  updateState((state) => {
    const next = getPrivateMangaIdSet(state);
    for (const editionId of getGroupedEditionIds(state, mangaId)) {
      if (isPrivate) next.add(editionId);
      else next.delete(editionId);
    }
    state.vault = state.vault || {};
    state.vault.privateMangaIds = [...next];
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('library:setPrivateFlagMany', async (_event, mangaIds = [], isPrivate) => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  updateState((state) => {
    const next = getPrivateMangaIdSet(state);
    ids.forEach((mangaId) => {
      getGroupedEditionIds(state, mangaId).forEach((editionId) => {
        if (isPrivate) next.add(editionId);
        else next.delete(editionId);
      });
    });
    state.vault = state.vault || {};
    state.vault.privateMangaIds = [...next];
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('library:setPrivateCategoryFlag', async (_event, categoryId, isPrivate) => {
  const normalizedCategoryId = String(categoryId || '').trim();
  if (!normalizedCategoryId) return buildInteractivePayload();

  updateState((state) => {
    const next = getPrivateCategoryIdSet(state);
    if (isPrivate) next.add(normalizedCategoryId);
    else next.delete(normalizedCategoryId);
    state.vault = state.vault || {};
    state.vault.privateCategoryIds = [...next];
    if (state.ui?.selectedCategoryId === normalizedCategoryId) {
      state.ui.selectedCategoryId = null;
    }
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('library:forceRescan', async () => {
  restartWatchers();
  const scanJob = ensureQueuedJob('scan', { source: 'manual-rescan' });
  await jobOrchestrator.process();
  requestPdfMetaSync({ refreshLibraryAfterSync: true });
  const completedJob = getJob(scanJob.id);
  if (completedJob?.progress?.diskChanged === false) {
    return { ok: true, changed: false, syncStatus: latestSyncStatus };
  }
  return {
    ok: true,
    changed: true,
    payload: buildInteractivePayload({ refreshDerived: false }),
    syncStatus: latestSyncStatus
  };
});

ipcMain.handle('library:runDeepScan', async () => {
  restartWatchers();
  const scanJob = ensureQueuedJob('deep-scan', { source: 'manual-deep-scan' });
  await jobOrchestrator.process();
  const completedJob = getJob(scanJob.id);
  const changed = completedJob?.progress?.diskChanged !== false;
  return {
    ok: true,
    changed,
    payload: changed ? buildInteractivePayload({ refreshDerived: false }) : null,
    syncStatus: latestSyncStatus
  };
});

/* ---------- Reading ---------- */

ipcMain.handle('reading:updateProgress', async (_event, payload) => {
  persistReadingProgress(payload);
  return buildInteractivePayload();
});

ipcMain.handle('reading:updateProgressLight', async (_event, payload) => {
  persistReadingProgress(payload);
  return mutationResult({});
});

ipcMain.handle('reading:setReadStatus', async (_event, mangaId, isRead, chapterIds = []) => {
  updateStateSegments({ reader: ['chapterReadStatus', 'progress', 'readStatus'] }, (state) => {
    const ids = Array.isArray(chapterIds) ? chapterIds : [];
    if (ids.length > 0) {
      ids.forEach((chapterId) => {
        if (isRead) {
          state.chapterReadStatus[chapterId] = true;
        } else {
          delete state.chapterReadStatus[chapterId];
          if (state.progress[chapterId]) {
            state.progress[chapterId] = { ...state.progress[chapterId], pageIndex: 0 };
          }
        }
      });
    }
    if (isRead) {
      state.readStatus[mangaId] = true;
    } else {
      delete state.readStatus[mangaId];
    }
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('reading:setReadStatusLight', async (_event, mangaId, isRead, chapterIds = []) => {
  updateStateSegments({ reader: ['chapterReadStatus', 'progress', 'readStatus'] }, (state) => {
    for (const chapterId of Array.isArray(chapterIds) ? chapterIds : []) {
      if (isRead) state.chapterReadStatus[chapterId] = true;
      else {
        delete state.chapterReadStatus[chapterId];
        if (state.progress[chapterId]) state.progress[chapterId] = { ...state.progress[chapterId], pageIndex: 0 };
      }
    }
    if (isRead) state.readStatus[mangaId] = true;
    else delete state.readStatus[mangaId];
    return state;
  });
  scheduleInteractiveDerivedSync();
  return mutationResult({ mangaId, isRead: Boolean(isRead) });
});

ipcMain.handle('reading:setChapterReadStatus', async (_event, mangaId, chapterId, isRead, pageCount = 0) => {
  updateStateSegments({ reader: ['chapterReadStatus', 'progress'] }, (state) => {
    if (isRead) {
      state.chapterReadStatus[chapterId] = true;
      state.progress[chapterId] = {
        ...(state.progress[chapterId] || {}),
        mangaId,
        chapterId,
        pageIndex: Math.max(0, pageCount - 1),
        pageCount,
        lastReadAt: new Date().toISOString()
      };
    } else {
      delete state.chapterReadStatus[chapterId];
      if (state.progress[chapterId]) {
        state.progress[chapterId] = { ...state.progress[chapterId], pageIndex: 0, pageCount };
      }
    }
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('reading:setChapterReadStatusLight', async (_event, mangaId, chapterId, isRead, pageCount = 0) => {
  updateStateSegments({ reader: ['chapterReadStatus', 'progress'] }, (state) => {
    if (isRead) {
      state.chapterReadStatus[chapterId] = true;
      state.progress[chapterId] = {
        ...(state.progress[chapterId] || {}),
        mangaId,
        chapterId,
        pageIndex: Math.max(0, pageCount - 1),
        pageCount,
        lastReadAt: new Date().toISOString()
      };
    } else {
      delete state.chapterReadStatus[chapterId];
      if (state.progress[chapterId]) state.progress[chapterId] = { ...state.progress[chapterId], pageIndex: 0, pageCount };
    }
    return state;
  });
  scheduleInteractiveDerivedSync();
  return mutationResult({ mangaId, chapterId, isRead: Boolean(isRead), pageCount });
});

ipcMain.handle('reading:resetProgress', async (_event, mangaId, chapterIds = []) => {
  updateState((state) => {
    const ids = Array.isArray(chapterIds) ? chapterIds : [];
    if (ids.length > 0) {
      ids.forEach((chapterId) => {
        delete state.progress[chapterId];
        delete state.chapterReadStatus[chapterId];
      });
    } else {
      for (const [chapterId, entry] of Object.entries(state.progress)) {
        if (entry?.mangaId === mangaId) {
          delete state.progress[chapterId];
          delete state.chapterReadStatus[chapterId];
        }
      }
    }
    state.recents = state.recents.filter((entry) => entry.mangaId !== mangaId);
    delete state.readStatus[mangaId];
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('reading:resetChapterProgress', async (_event, chapterId) => {
  updateState((state) => {
    delete state.progress[chapterId];
    delete state.chapterReadStatus[chapterId];
    state.recents = state.recents.filter((entry) => entry.chapterId !== chapterId);
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('reading:bulkSetReadStatus', async (_event, entries = [], isRead) => {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      mangaId: String(entry?.mangaId || '').trim(),
      chapterIds: Array.isArray(entry?.chapterIds) ? entry.chapterIds.map((value) => String(value || '').trim()).filter(Boolean) : []
    }))
    .filter((entry) => entry.mangaId);

  updateState((state) => {
    normalizedEntries.forEach(({ mangaId, chapterIds }) => {
      chapterIds.forEach((chapterId) => {
        if (isRead) {
          state.chapterReadStatus[chapterId] = true;
        } else {
          delete state.chapterReadStatus[chapterId];
          if (state.progress[chapterId]) {
            state.progress[chapterId] = { ...state.progress[chapterId], pageIndex: 0 };
          }
        }
      });

      if (isRead) state.readStatus[mangaId] = true;
      else delete state.readStatus[mangaId];
    });
    return state;
  });

  return buildInteractivePayload();
});

/* ---------- Tags ---------- */

ipcMain.handle('tags:create', async (_event, name, color) => {
  createTag(name, color);
  return buildInteractivePayload();
});

ipcMain.handle('tags:delete', async (_event, tagId) => {
  deleteTag(tagId);
  return buildInteractivePayload();
});

ipcMain.handle('tags:addToManga', async (_event, mangaId, tagId) => {
  addTagToManga(mangaId, tagId);
  return buildInteractivePayload();
});

ipcMain.handle('tags:removeFromManga', async (_event, mangaId, tagId) => {
  removeTagFromManga(mangaId, tagId);
  return buildInteractivePayload();
});

ipcMain.handle('tags:setForManga', async (_event, mangaId, tagIds) => {
  setMangaTags(mangaId, Array.isArray(tagIds) ? tagIds : []);
  return buildInteractivePayload();
});

ipcMain.handle('tags:toggleForManga', async (_event, mangaId, tagId) => {
  const state = loadState();
  const current = state.mangaTags?.[mangaId] || [];
  if (current.includes(tagId)) {
    removeTagFromManga(mangaId, tagId);
  } else {
    addTagToManga(mangaId, tagId);
  }
  return buildInteractivePayload();
});

ipcMain.handle('tags:toggleForMangaLight', async (_event, mangaId, tagId) => {
  const state = loadState();
  const current = state.mangaTags?.[mangaId] || [];
  const isAssigned = !current.includes(tagId);
  if (isAssigned) addTagToManga(mangaId, tagId);
  else removeTagFromManga(mangaId, tagId);
  scheduleInteractiveDerivedSync();
  return mutationResult({ mangaId, tagId, isAssigned });
});

ipcMain.handle('tags:addMany', async (_event, tagId, mangaIds = []) => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length > 0) {
    updateState((state) => {
      for (const mangaId of ids) {
        for (const editionId of getGroupedEditionIds(state, mangaId)) {
          state.mangaTags[editionId] = [...new Set([...(state.mangaTags[editionId] || []), tagId])];
        }
        const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
        if (group) group.tagIds = [...new Set([...(group.tagIds || []), tagId])];
      }
      return state;
    });
  }
  return buildInteractivePayload();
});

ipcMain.handle('tags:removeMany', async (_event, tagId, mangaIds = []) => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length > 0) {
    updateState((state) => {
      for (const mangaId of ids) {
        for (const editionId of getGroupedEditionIds(state, mangaId)) {
          state.mangaTags[editionId] = (state.mangaTags[editionId] || []).filter((id) => id !== tagId);
          if (state.mangaTags[editionId].length === 0) delete state.mangaTags[editionId];
        }
        const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
        if (group) group.tagIds = (group.tagIds || []).filter((id) => id !== tagId);
      }
      return state;
    });
  }
  return buildInteractivePayload();
});

/* ---------- Collections ---------- */

ipcMain.handle('collections:create', async (_event, name, description, color, appearance) => {
  createCollection(name, description, color, normalizeCollectionAppearance(appearance));
  return buildInteractivePayload();
});

ipcMain.handle('collections:delete', async (_event, collectionId) => {
  deleteCollection(collectionId);
  return buildInteractivePayload();
});

ipcMain.handle('collections:update', async (_event, collectionId, patch) => {
  updateCollection(collectionId, patch);
  return buildInteractivePayload();
});

ipcMain.handle('collections:addManga', async (_event, collectionId, mangaId) => {
  addMangaToCollection(collectionId, mangaId);
  return buildInteractivePayload();
});

ipcMain.handle('collections:addMangaLight', async (_event, collectionId, mangaId) => {
  addMangaToCollection(collectionId, mangaId);
  scheduleInteractiveDerivedSync();
  return mutationResult({ collectionId, mangaId, isAssigned: true });
});

ipcMain.handle('collections:removeManga', async (_event, collectionId, mangaId) => {
  removeMangaFromCollection(collectionId, mangaId);
  return buildInteractivePayload();
});

ipcMain.handle('collections:removeMangaLight', async (_event, collectionId, mangaId) => {
  removeMangaFromCollection(collectionId, mangaId);
  scheduleInteractiveDerivedSync();
  return mutationResult({ collectionId, mangaId, isAssigned: false });
});

ipcMain.handle('collections:addMany', async (_event, collectionId, mangaIds = []) => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length > 0) {
    updateState((state) => {
      const collection = state.collections?.[collectionId];
      if (collection) {
        const expandedIds = [...new Set(ids.flatMap((mangaId) => getGroupedEditionIds(state, mangaId)))];
        collection.mangaIds = [...new Set([...(collection.mangaIds || []), ...expandedIds])];
        for (const mangaId of ids) {
          const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
          if (group) group.collectionIds = [...new Set([...(group.collectionIds || []), collectionId])];
        }
      }
      return state;
    });
  }
  return buildInteractivePayload();
});

ipcMain.handle('collections:removeMany', async (_event, collectionId, mangaIds = []) => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (ids.length > 0) {
    updateState((state) => {
      const collection = state.collections?.[collectionId];
      if (collection) {
        const expandedIds = new Set(ids.flatMap((mangaId) => getGroupedEditionIds(state, mangaId)));
        collection.mangaIds = (collection.mangaIds || []).filter((id) => !expandedIds.has(id));
        for (const mangaId of ids) {
          const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
          if (group) group.collectionIds = (group.collectionIds || []).filter((id) => id !== collectionId);
        }
      }
      return state;
    });
  }
  return buildInteractivePayload();
});

ipcMain.handle('smartCollections:save', async (_event, collection) => {
  const collectionId = String(collection?.id || '').trim() || `smart-custom-${Date.now()}`;
  updateState((state) => {
    state.smartCollections = state.smartCollections || {};
    const previous = state.smartCollections[collectionId] || {};
    state.smartCollections[collectionId] = {
      ...previous,
      id: collectionId,
      name: String(collection?.name || previous.name || 'Collection intelligente').trim(),
      description: String(collection?.description || previous.description || '').trim(),
      icon: String(collection?.icon || previous.icon || 'layers').trim(),
      color: String(collection?.color || previous.color || '#64748b').trim(),
      appearance: normalizeCollectionAppearance(collection?.appearance || previous.appearance),
      rules: collection?.rules && typeof collection.rules === 'object' ? collection.rules : (previous.rules || { type: 'unread' }),
      builtIn: Boolean(previous.builtIn && collection?.builtIn !== false)
    };
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('smartCollections:delete', async (_event, collectionId) => {
  updateState((state) => {
    if (state.smartCollections?.[collectionId]?.builtIn || String(collectionId || '').startsWith('smart-')) {
      return state;
    }
    delete state.smartCollections?.[collectionId];
    state.ui.sidebarPins = (state.ui.sidebarPins || []).filter((pin) => !(pin.type === 'smart' && pin.refId === collectionId));
    return state;
  });
  return buildInteractivePayload();
});

/* ---------- Online Metadata ---------- */

function uniqueStrings(values = []) {
  return [...new Map(
    values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => [value.toLowerCase(), value])
  ).values()];
}

function stripMarkup(input) {
  return String(input || '')
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/~!/g, '')
    .replace(/!~/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeAltTitles(title, values = []) {
  const normalizedTitle = String(title || '').trim().toLowerCase();
  return uniqueStrings(values).filter((value) => value.toLowerCase() !== normalizedTitle);
}

function pickJapaneseTitle(values = []) {
  return values.find((value) => /[\\u3000-\\u9fff\\uf900-\\ufaff]/.test(String(value || ''))) || null;
}

function normalizeQuery(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function computeResultRelevance(item, query) {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const sourceBoosts = { mangadex: 120, anilist: 110, nhentai: 80 };
  const titles = uniqueStrings([
    item.title,
    item.titleEnglish,
    item.titleJapanese,
    ...(Array.isArray(item.altTitles) ? item.altTitles : [])
  ]);

  let best = sourceBoosts[item.source] || 0;
  for (const title of titles) {
    const candidate = normalizeQuery(title);
    if (!candidate) continue;
    if (candidate === q) best = Math.max(best, 1000);
    else if (candidate.startsWith(q)) best = Math.max(best, 850);
    else if (candidate.includes(q)) best = Math.max(best, 700);
    else {
      const parts = q.split(' ').filter(Boolean);
      const matches = parts.filter((part) => candidate.includes(part)).length;
      if (matches > 0) best = Math.max(best, 500 + (matches * 40));
    }
  }
  return best;
}

function inferImageExtensionFromContentType(contentType = '') {
  const lower = String(contentType || '').toLowerCase();
  if (lower.includes('png')) return '.png';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('avif')) return '.avif';
  if (lower.includes('gif')) return '.gif';
  if (lower.includes('bmp')) return '.bmp';
  if (lower.includes('svg')) return '.svg';
  return '.jpg';
}

function buildNormalizedResult(data = {}) {
  const source = data.source || 'unknown';
  const sourceId = String(data.sourceId || data.mangaDexId || data.anilistId || data.nhentaiId || data.id || '');
  const title = String(data.title || data.titleEnglish || data.titleJapanese || 'Sans titre').trim() || 'Sans titre';
  const rawTags = uniqueStrings([...(Array.isArray(data.tags) ? data.tags : []), ...(Array.isArray(data.genres) ? data.genres : [])]);
  const rawAltTitles = [
    ...(Array.isArray(data.altTitles) ? data.altTitles : []),
    data.titleEnglish,
    data.titleJapanese
  ];
  const altTitles = normalizeAltTitles(title, rawAltTitles);
  const titleJapanese = data.titleJapanese || pickJapaneseTitle(altTitles) || null;

  return {
    resultId: `${source}:${sourceId || title.toLowerCase().replace(/\s+/g, '-')}`,
    source,
    sourceLabel: data.sourceLabel || source,
    sourceId,
    malId: data.malId ?? `${source}:${sourceId || title}`,
    mangaDexId: data.mangaDexId || null,
    anilistId: data.anilistId || null,
    nhentaiId: data.nhentaiId || null,
    title,
    titleJapanese,
    titleEnglish: data.titleEnglish || null,
    altTitles,
    synopsis: data.synopsis ? stripMarkup(data.synopsis) : null,
    authors: data.authors || '',
    genres: rawTags,
    tags: rawTags,
    coverUrl: data.coverUrl || null,
    coverDownloadUrl: data.coverDownloadUrl || data.coverUrl || null,
    coverPreviewUrl: data.coverPreviewUrl || data.coverUrl || data.coverDownloadUrl || null,
    score: data.score ?? null,
    status: data.status || null,
    chapters: data.chapters ?? null,
    volumes: data.volumes ?? null,
    year: data.year ?? null,
    contentRating: data.contentRating || null,
    isAdult: Boolean(data.isAdult),
    siteUrl: data.siteUrl || null
  };
}

function buildRemoteHeaders(url, extraHeaders = {}) {
  const headers = {
    'User-Agent': 'Sawa Manga Library/3.0.0',
    ...extraHeaders
  };
  if (/nhentai\.net/i.test(String(url || ''))) {
    headers.Referer = headers.Referer || 'https://nhentai.net/';
    headers.Origin = headers.Origin || 'https://nhentai.net';
  }
  return headers;
}

async function fetchJson(url, options = {}) {
  const response = await net.fetch(url, {
    ...options,
    headers: buildRemoteHeaders(url, {
      'Accept': 'application/json',
      ...(options.headers || {})
    })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await net.fetch(url, {
    ...options,
    headers: buildRemoteHeaders(url, {
      'Accept': 'text/html,application/xhtml+xml',
      ...(options.headers || {})
    })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

function makeSourceImportJobId() {
  return `srcimp_${crypto.randomBytes(8).toString('hex')}`;
}

function buildSourceImportProgressLabel(job) {
  if (!job) return 'Preparation en cours';
  if (job.status === 'queued') return 'En attente';
  if (job.status === 'cancel_requested') return 'Annulation demandee';
  if (job.status === 'cancelled' || job.status === 'interrupted') return 'Import annule';
  if (job.status === 'failed') return job.lastError || job.error || 'Import interrompu';
  if (job.status === 'done') {
    const chapterCount = Number(job.progress?.chapterCount || 0);
    return chapterCount > 0
      ? `${chapterCount} chapitre${chapterCount > 1 ? 's' : ''} importe${chapterCount > 1 ? 's' : ''}`
      : 'Import termine';
  }

  const progress = job.progress || {};
  if (progress.chapterLabel && progress.pageCount) {
    return `${progress.chapterLabel} · page ${Number(progress.pageIndex || 0) + 1}/${progress.pageCount}`;
  }
  if (progress.chapterLabel) return progress.chapterLabel;
  return 'Import en cours';
}

function serializeSourceImportJob(job) {
  if (!job) return null;
  const payload = job.payload || job;
  return {
    id: job.id,
    pluginId: payload.pluginId || SOURCE_PLUGIN_ID,
    repoId: payload.repoId || '',
    extensionId: payload.extensionId || '',
    connectorId: payload.connectorId || '',
    connectorName: payload.connectorName || 'Source web',
    sourceId: payload.sourceId || '',
    seriesId: payload.seriesId || '',
    seriesTitle: payload.seriesTitle || 'Import web',
    destinationCategoryId: payload.destinationCategoryId || '',
    categoryName: payload.categoryName || '',
    status: job.status,
    progress: job.progress || {},
    progressLabel: buildSourceImportProgressLabel(job),
    error: job.lastError || payload.error || '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt || null,
    endedAt: job.endedAt || null
  };
}

function listSourceImportJobs() {
  return listJobs()
    .filter((job) => job.kind === 'source-import')
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
    .map(serializeSourceImportJob)
    .filter(Boolean);
}

function resolveSourceImportCategory(categoryId) {
  const state = loadState();
  return (state.categories || []).find((category) => category.id === categoryId) || null;
}

function enqueueSourceImportJob(input = {}) {
  const chapterIds = Array.isArray(input.chapterIds)
    ? input.chapterIds.map((chapterId) => String(chapterId || '').trim()).filter(Boolean)
    : [];
  const job = jobOrchestrator.enqueue({
    kind: 'source-import',
    payload: {
      pluginId: SOURCE_PLUGIN_ID,
      repoId: String(input.repoId || '').trim(),
      extensionId: String(input.extensionId || '').trim(),
      connectorId: String(input.connectorId || '').trim(),
      connectorName: String(input.connectorName || '').trim() || 'Source web',
      sourceId: String(input.sourceId || '').trim(),
      seriesId: String(input.seriesId || '').trim(),
      seriesTitle: String(input.seriesTitle || '').trim() || 'Import web',
      destinationCategoryId: String(input.destinationCategoryId || '').trim(),
      categoryName: String(input.categoryName || '').trim(),
      chapterIds
    },
    progress: {},
    requeueable: true
  });
  jobOrchestrator.schedule();
  return job;
}

function decodeHtmlEntities(input = '') {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");
}

function parseNHentaiSearchHtml(html, limit = 8) {
  if (!html || typeof html !== 'string') return [];
  const results = [];
  const cardRegex = /<a[^>]*class="cover"[^>]*href="\/g\/(\d+)\/"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"[\s\S]*?<div[^>]*class="caption"[^>]*>([\s\S]*?)<\/div>/gi;

  let match;
  while ((match = cardRegex.exec(html)) && results.length < limit) {
    const id = Number.parseInt(match[1], 10);
    const rawCover = match[2] || '';
    const rawTitle = match[3] || '';
    if (!Number.isFinite(id)) continue;
    const title = decodeHtmlEntities(rawTitle.replace(/<[^>]+>/g, '').trim()) || 'Sans titre';
    const coverUrl = rawCover.startsWith('//') ? `https:${rawCover}` : rawCover;

    results.push(buildNormalizedResult({
      source: 'nhentai',
      sourceLabel: 'nHentai',
      sourceId: id,
      nhentaiId: id,
      title,
      contentRating: 'adult',
      isAdult: true,
      chapters: 1,
      coverUrl: coverUrl || null,
      coverDownloadUrl: coverUrl || null,
      coverPreviewUrl: coverUrl || null,
      siteUrl: `https://nhentai.net/g/${id}/`
    }));
  }

  return results;
}

function formatMangaDexResults(json) {
  return (json.data || []).map((item) => {
    const attr = item.attributes || {};
    const titleMap = attr.title || {};
    const title = titleMap.en || titleMap['ja-ro'] || titleMap.ja || Object.values(titleMap)[0] || 'Sans titre';
    const rawAltTitles = [
      ...Object.values(titleMap || {}),
      ...(attr.altTitles || []).flatMap((entry) => Object.values(entry || {}))
    ];
    const descMap = attr.description || {};
    const synopsis = descMap.fr || descMap.en || Object.values(descMap)[0] || null;
    const authors = (item.relationships || [])
      .filter((r) => r.type === 'author' || r.type === 'artist')
      .map((r) => r.attributes?.name)
      .filter(Boolean);
    const tags = (attr.tags || [])
      .map((t) => t.attributes?.name?.en || Object.values(t.attributes?.name || {})[0])
      .filter(Boolean);
    const coverRel = (item.relationships || []).find((r) => r.type === 'cover_art');
    const coverFileName = coverRel?.attributes?.fileName || null;
    const coverDownloadUrl = coverFileName ? `https://uploads.mangadex.org/covers/${item.id}/${coverFileName}` : null;
    const coverUrl = coverFileName ? `https://uploads.mangadex.org/covers/${item.id}/${coverFileName}.512.jpg` : null;
    const coverPreviewUrl = coverFileName ? `https://uploads.mangadex.org/covers/${item.id}/${coverFileName}.256.jpg` : coverUrl;

    return buildNormalizedResult({
      source: 'mangadex',
      sourceLabel: 'MangaDex',
      sourceId: item.id,
      mangaDexId: item.id,
      title,
      titleEnglish: titleMap.en || null,
      titleJapanese: pickJapaneseTitle(rawAltTitles),
      altTitles: rawAltTitles,
      synopsis,
      authors: uniqueStrings(authors).join(', '),
      tags,
      coverUrl,
      coverDownloadUrl,
      coverPreviewUrl,
      score: attr.rating?.bayesian ? Math.round(attr.rating.bayesian * 10) / 10 : null,
      status: attr.status,
      chapters: attr.lastChapter ? parseInt(attr.lastChapter, 10) : null,
      volumes: attr.lastVolume ? parseInt(attr.lastVolume, 10) : null,
      year: attr.year,
      contentRating: attr.contentRating,
      isAdult: ['pornographic', 'erotica'].includes(attr.contentRating)
    });
  });
}

async function searchMangaDex(query) {
  const encoded = encodeURIComponent(query.trim());
  const url = `https://api.mangadex.org/manga?title=${encoded}&limit=10&includes[]=cover_art&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic&order[relevance]=desc`;
  const json = await fetchJson(url);
  return formatMangaDexResults(json);
}

function extractAniListAuthors(staffEdges = []) {
  const preferred = [];
  const fallback = [];
  for (const edge of staffEdges || []) {
    const role = String(edge?.role || '');
    const node = edge?.node;
    const name = node?.name?.full || node?.name?.userPreferred || node?.name?.native || null;
    if (!name) continue;
    fallback.push(name);
    if (/(story|art|original creator|creator|author|writer|illustrator|mangaka)/i.test(role)) {
      preferred.push(name);
    }
  }
  return uniqueStrings(preferred.length ? preferred : fallback).join(', ');
}

function extractAniListTags(tags = []) {
  return uniqueStrings(
    (tags || [])
      .filter((tag) => tag?.name)
      .sort((a, b) => (b?.rank || 0) - (a?.rank || 0))
      .slice(0, 12)
      .map((tag) => tag.name)
  );
}

async function searchAniList(query) {
  const gql = `
    query ($search: String!, $page: Int!, $perPage: Int!) {
      Page(page: $page, perPage: $perPage) {
        media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
          id
          idMal
          siteUrl
          isAdult
          format
          status
          chapters
          volumes
          averageScore
          startDate { year }
          title {
            romaji
            english
            native
            userPreferred
          }
          synonyms
          description(asHtml: false)
          genres
          tags {
            name
            rank
            category
          }
          coverImage {
            extraLarge
            large
            medium
          }
          staff(perPage: 8, sort: [RELEVANCE, ID]) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                  userPreferred
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await net.fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Sawa Manga Library/3.0.0'
    },
    body: JSON.stringify({
      query: gql,
      variables: { search: query.trim(), page: 1, perPage: 8 }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(json.errors[0]?.message || 'AniList error');
  }

  return (json?.data?.Page?.media || []).map((item) => buildNormalizedResult({
    source: 'anilist',
    sourceLabel: 'AniList',
    sourceId: item.id,
    anilistId: item.id,
    malId: item.idMal ?? null,
    title: item.title?.userPreferred || item.title?.romaji || item.title?.english || item.title?.native || 'Sans titre',
    titleEnglish: item.title?.english || null,
    titleJapanese: item.title?.native || null,
    altTitles: [
      item.title?.romaji,
      item.title?.english,
      item.title?.native,
      ...(item.synonyms || [])
    ],
    synopsis: item.description || null,
    authors: extractAniListAuthors(item.staff?.edges || []),
    genres: item.genres || [],
    tags: extractAniListTags(item.tags || []),
    coverUrl: item.coverImage?.large || item.coverImage?.medium || item.coverImage?.extraLarge || null,
    coverDownloadUrl: item.coverImage?.extraLarge || item.coverImage?.large || item.coverImage?.medium || null,
    coverPreviewUrl: item.coverImage?.medium || item.coverImage?.large || item.coverImage?.extraLarge || null,
    score: typeof item.averageScore === 'number' ? Math.round(item.averageScore) / 10 : null,
    status: item.status || item.format || null,
    chapters: item.chapters ?? null,
    volumes: item.volumes ?? null,
    year: item.startDate?.year ?? null,
    contentRating: item.isAdult ? 'adult' : 'safe',
    isAdult: Boolean(item.isAdult),
    siteUrl: item.siteUrl || null
  }));
}

function nhentaiImageExtension(type) {
  if (type === 'p') return 'png';
  if (type === 'g') return 'gif';
  if (type === 'w') return 'webp';
  return 'jpg';
}

function buildNHentaiCoverUrl(mediaId, imageType) {
  if (!mediaId) return null;
  const ext = nhentaiImageExtension(imageType);
  return `https://t.nhentai.net/galleries/${mediaId}/cover.${ext}`;
}

function extractNHentaiAuthors(tags = []) {
  const artists = tags
    .filter((tag) => tag?.type === 'artist' || tag?.type === 'group')
    .map((tag) => tag?.name)
    .filter(Boolean);
  return uniqueStrings(artists).join(', ');
}

function extractNHentaiTags(tags = []) {
  return uniqueStrings(
    (tags || [])
      .filter((tag) => ['category', 'tag', 'parody', 'character'].includes(tag?.type))
      .map((tag) => tag?.name)
      .filter(Boolean)
      .slice(0, 20)
  );
}

function formatNHentaiEntry(item) {
  const title = item?.title?.pretty || item?.title?.english || item?.title?.japanese || 'Sans titre';
  return buildNormalizedResult({
    source: 'nhentai',
    sourceLabel: 'nHentai',
    sourceId: item?.id,
    nhentaiId: item?.id,
    title,
    titleEnglish: item?.title?.english || null,
    titleJapanese: item?.title?.japanese || null,
    altTitles: [item?.title?.english, item?.title?.japanese],
    synopsis: null,
    authors: extractNHentaiAuthors(item?.tags || []),
    tags: extractNHentaiTags(item?.tags || []),
    coverUrl: buildNHentaiCoverUrl(item?.media_id, item?.images?.cover?.t),
    coverDownloadUrl: buildNHentaiCoverUrl(item?.media_id, item?.images?.cover?.t),
    coverPreviewUrl: buildNHentaiCoverUrl(item?.media_id, item?.images?.cover?.t),
    score: null,
    status: null,
    chapters: 1,
    volumes: null,
    year: item?.upload_date ? new Date(item.upload_date * 1000).getUTCFullYear() : null,
    contentRating: 'adult',
    isAdult: true,
    siteUrl: item?.id ? `https://nhentai.net/g/${item.id}/` : null
  });
}

const NHENTAI_CACHE_MAX = 500;
const nhentaiTagsCacheById = new Map();
const nhentaiGalleryCacheById = new Map();

function capMapSize(map, max) {
  if (map.size <= max) return;
  const excess = map.size - max;
  const iter = map.keys();
  for (let i = 0; i < excess; i++) {
    const key = iter.next().value;
    if (key !== undefined) map.delete(key);
  }
}

function buildNHentaiThumbUrl(thumbnail) {
  if (!thumbnail) return null;
  if (/^https?:\/\//i.test(String(thumbnail))) return String(thumbnail);
  const normalized = String(thumbnail).replace(/^\/+/, '');
  return normalized ? `https://t3.nhentai.net/${normalized}` : null;
}

async function fetchNHentaiTagsByIds(tagIds = []) {
  const normalizedIds = [...new Set(
    (Array.isArray(tagIds) ? tagIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
  if (normalizedIds.length === 0) return [];

  const unresolvedIds = normalizedIds.filter((id) => !nhentaiTagsCacheById.has(id));
  for (let index = 0; index < unresolvedIds.length; index += 100) {
    const chunk = unresolvedIds.slice(index, index + 100);
    if (chunk.length === 0) continue;
    try {
      const json = await fetchJson(`https://nhentai.net/api/v2/tags/ids?ids=${chunk.join(',')}`, {
        headers: {
          Referer: 'https://nhentai.net/',
          Origin: 'https://nhentai.net'
        }
      });
      for (const tag of Array.isArray(json) ? json : []) {
        const id = Number(tag?.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        nhentaiTagsCacheById.set(id, tag);
      }
    } catch (_error) {
      // Silent by design: metadata search must remain resilient.
    }
  }

  capMapSize(nhentaiTagsCacheById, NHENTAI_CACHE_MAX);
  return normalizedIds.map((id) => nhentaiTagsCacheById.get(id)).filter(Boolean);
}

function extractNHentaiV2AuthorsAndTags(tagObjects = []) {
  const normalized = Array.isArray(tagObjects) ? tagObjects : [];
  const authors = uniqueStrings(
    normalized
      .filter((tag) => tag?.type === 'artist' || tag?.type === 'group')
      .map((tag) => tag?.name)
      .filter(Boolean)
  ).join(', ');
  const tags = uniqueStrings(
    normalized
      .filter((tag) => ['category', 'tag', 'parody', 'character'].includes(tag?.type))
      .map((tag) => tag?.name)
      .filter(Boolean)
      .slice(0, 20)
  );
  return { authors, tags };
}

async function fetchNHentaiV2GalleryById(galleryId) {
  const id = Number(galleryId);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (nhentaiGalleryCacheById.has(id)) return nhentaiGalleryCacheById.get(id);
  try {
    const json = await fetchJson(`https://nhentai.net/api/v2/galleries/${id}`, {
      headers: {
        Referer: 'https://nhentai.net/',
        Origin: 'https://nhentai.net'
      }
    });
    if (json && typeof json === 'object') {
      capMapSize(nhentaiGalleryCacheById, NHENTAI_CACHE_MAX);
      nhentaiGalleryCacheById.set(id, json);
      for (const tag of Array.isArray(json.tags) ? json.tags : []) {
        const tagId = Number(tag?.id);
        if (!Number.isInteger(tagId) || tagId <= 0) continue;
        nhentaiTagsCacheById.set(tagId, tag);
      }
      return json;
    }
  } catch (_error) {
    // Silent by design.
  }
  return null;
}

function formatNHentaiV2Entry(item, tagLookup = new Map(), galleryFallback = null) {
  const resolvedTags = (Array.isArray(item?.tag_ids) ? item.tag_ids : [])
    .map((id) => tagLookup.get(Number(id)))
    .filter(Boolean);
  const fallbackTags = Array.isArray(galleryFallback?.tags) ? galleryFallback.tags : [];
  const { authors, tags } = extractNHentaiV2AuthorsAndTags(resolvedTags.length > 0 ? resolvedTags : fallbackTags);

  const fallbackEnglish = galleryFallback?.title?.english || null;
  const fallbackJapanese = galleryFallback?.title?.japanese || null;
  const fallbackPretty = galleryFallback?.title?.pretty || null;
  const title = item?.english_title || item?.japanese_title || fallbackEnglish || fallbackJapanese || fallbackPretty || 'Sans titre';
  const cover = buildNHentaiThumbUrl(item?.thumbnail || galleryFallback?.thumbnail || galleryFallback?.cover);
  const sourceId = item?.id || galleryFallback?.id || null;

  return buildNormalizedResult({
    source: 'nhentai',
    sourceLabel: 'nHentai',
    sourceId,
    nhentaiId: sourceId,
    title,
    titleEnglish: item?.english_title || fallbackEnglish || null,
    titleJapanese: item?.japanese_title || fallbackJapanese || null,
    altTitles: [item?.english_title || fallbackEnglish, item?.japanese_title || fallbackJapanese, fallbackPretty],
    synopsis: null,
    authors,
    tags,
    coverUrl: cover,
    coverDownloadUrl: cover,
    coverPreviewUrl: cover,
    score: null,
    status: null,
    chapters: 1,
    volumes: null,
    year: null,
    contentRating: 'adult',
    isAdult: true,
    siteUrl: sourceId ? `https://nhentai.net/g/${sourceId}/` : null
  });
}

async function searchNHentai(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];
  const encoded = encodeURIComponent(trimmed);

  try {
    const jsonV2 = await fetchJson(`https://nhentai.net/api/v2/search?query=${encoded}&sort=date&page=1`, {
      headers: {
        Referer: 'https://nhentai.net/',
        Origin: 'https://nhentai.net'
      }
    });
    const v2Entries = (jsonV2?.result || []).slice(0, 8);
    const allTagIds = [...new Set(v2Entries.flatMap((entry) => (Array.isArray(entry?.tag_ids) ? entry.tag_ids : [])))];
    const resolvedTags = await fetchNHentaiTagsByIds(allTagIds);
    const tagLookup = new Map(resolvedTags.map((tag) => [Number(tag.id), tag]));
    const apiV2Results = v2Entries.map((entry) => formatNHentaiV2Entry(entry, tagLookup));
    const fallbackIndexes = new Set(
      apiV2Results
        .map((entry, index) => (Array.isArray(entry?.genres) && entry.genres.length > 0 ? -1 : index))
        .filter((index) => index >= 0)
    );
    if (fallbackIndexes.size > 0) {
      const galleryDetails = await Promise.all(
        v2Entries.map((entry, index) => (
          fallbackIndexes.has(index)
            ? fetchNHentaiV2GalleryById(entry?.id)
            : Promise.resolve(null)
        ))
      );
      const hydratedResults = v2Entries.map((entry, index) => (
        formatNHentaiV2Entry(entry, tagLookup, galleryDetails[index])
      ));
      if (hydratedResults.length > 0) return hydratedResults;
    }
    if (apiV2Results.length > 0) return apiV2Results;
  } catch (_error) {
    // Fallback below
  }

  try {
    const json = await fetchJson(`https://nhentai.net/api/galleries/search?query=${encoded}&page=1`, {
      headers: {
        Referer: 'https://nhentai.net/',
        Origin: 'https://nhentai.net'
      }
    });
    const apiResults = (json?.result || []).slice(0, 8).map(formatNHentaiEntry);
    if (apiResults.length > 0) return apiResults;
  } catch (_error) {
    // Fallback below
  }

  try {
    const html = await fetchText(`https://nhentai.net/search/?q=${encoded}`);
    const fallbackResults = parseNHentaiSearchHtml(html, 8);
    if (fallbackResults.length > 0) return fallbackResults;
  } catch (_error) {
    // Silent fail: NSFW provider should not break metadata search UI
  }
  return [];
}

let metadataProviderRegistry = null;

function getMetadataProviderRegistry() {
  if (metadataProviderRegistry) return metadataProviderRegistry;
  metadataProviderRegistry = createMetadataProviderRegistry({
    fetchImpl: (url, options) => net.fetch(url, options),
    cachePath: path.join(getCacheDir(), 'metadata-candidates-v1.json'),
    legacyProviders: {
      mangadex: (query) => searchMangaDex(query),
      anilist: (query) => searchAniList(query),
      nhentai: (query) => searchNHentai(query)
    }
  });
  return metadataProviderRegistry;
}

async function downloadCandidateCover(identity) {
  const normalizedIdentity = String(identity || '').trim();
  let candidate = getMetadataProviderRegistry().getCandidate(normalizedIdentity);
  if (!candidate) {
    const state = loadState();
    const storedItem = (state.metadataWorkbenchItems || []).find((item) =>
      String(item?.candidate?.identity || '') === normalizedIdentity
    );
    const privateCandidateLocked = storedItem
      && state?.vault?.locked
      && isPrivateWorkbenchManga(state, storedItem.mangaId);
    if (!privateCandidateLocked) candidate = storedItem?.candidate || null;
  }
  const url = candidate?.coverPreviewUrl || candidate?.coverUrl || candidate?.coverDownloadUrl;
  if (!url) return { ok: false, error: 'Couverture indisponible.' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return { ok: false, error: 'URL de couverture invalide.' };
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) return { ok: false, error: 'Protocole de couverture refuse.' };
  const response = await net.fetch(parsed.toString(), {
    headers: buildRemoteHeaders(parsed.toString(), { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' })
  });
  if (!response.ok) return { ok: false, error: `Couverture HTTP ${response.status}` };
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') {
    return { ok: false, error: 'Le serveur n a pas retourne une image acceptee.' };
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  const maxBytes = 15 * 1024 * 1024;
  if (declaredLength > maxBytes) return { ok: false, error: 'Couverture superieure a 15 Mio.' };
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) return { ok: false, error: 'Couverture vide ou superieure a 15 Mio.' };
  const image = nativeImage.createFromBuffer(buffer);
  const size = image.getSize();
  if (image.isEmpty() || size.width < 1 || size.height < 1) return { ok: false, error: 'Couverture illisible.' };
  return {
    ok: true,
    identity: candidate.identity,
    buffer,
    contentType,
    width: size.width,
    height: size.height,
    bytes: buffer.length
  };
}

async function loadCandidateCoverData(identity) {
  const result = await downloadCandidateCover(identity);
  if (!result.ok) return result;
  return {
    ...result,
    buffer: undefined,
    dataUrl: `data:${result.contentType};base64,${result.buffer.toString('base64')}`
  };
}

ipcMain.handle('metadata:listProviders', () => {
  const state = loadState();
  return getMetadataProviderRegistry().listProviders(state.ui)
    .filter((provider) => !(state?.vault?.locked && provider.family === 'imhentai-family'));
});

ipcMain.handle('metadata:getCandidateCover', async (_event, identity) => loadCandidateCoverData(identity));

ipcMain.handle('metadata:hydrateCandidate', async (_event, candidate, input = {}) => {
  const state = loadState();
  if (!state?.ui?.allowNsfwSources) return { ok: false, error: 'Sources adultes desactivees.' };
  const settings = getMetadataProviderRegistry().normalizeProviderSettings(state.ui);
  try {
    const result = await getMetadataProviderRegistry().hydrateCandidate(candidate, { settings, privateContext: Boolean(input.privateContext) });
    return { ok: true, candidate: result };
  } catch (error) {
    return { ok: false, error: error?.message || 'Hydratation impossible.' };
  }
});

ipcMain.handle('metadata:searchOnline', async (_event, query) => {
  if (!query || !query.trim()) return { results: [] };
  const trimmedQuery = query.trim();
  const state = loadState();
  const ui = state?.vault?.locked
    ? {
        ...state.ui,
        metadataProviders: {
          ...(state.ui?.metadataProviders || {}),
          enabled: { ...(state.ui?.metadataProviders?.enabled || {}), imhentai: false, hentaiera: false }
        }
      }
    : state.ui;
  const response = await getMetadataProviderRegistry().searchCandidates(trimmedQuery, { ui });
  const ranked = response.results
    .map((item) => ({ ...item, _relevance: computeResultRelevance(item, trimmedQuery) }))
    .sort((a, b) => {
      if (b._relevance !== a._relevance) return b._relevance - a._relevance;
      if (a.isAdult !== b.isAdult) return Number(a.isAdult) - Number(b.isAdult);
      return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    })
    .slice(0, 20)
    .map(({ _relevance, ...item }) => item);

  const errorKeys = Object.keys(response.providerErrors);
  return {
    results: ranked,
    error: errorKeys.length ? errorKeys.map((key) => `${key}: ${response.providerErrors[key]}`).join(' | ') : null,
    providerErrors: response.providerErrors,
    cached: Boolean(response.cached)
  };
});

ipcMain.handle('metadata:importOnline', async (_event, mangaId, onlineData) => {
  const importedGenres = uniqueStrings([
    ...(Array.isArray(onlineData?.genres) ? onlineData.genres : []),
    ...(Array.isArray(onlineData?.tags) ? onlineData.tags : [])
  ]);
  const patch = {};
  if (onlineData.title) patch.onlineTitle = onlineData.title;
  if (onlineData.titleJapanese) patch.titleJapanese = onlineData.titleJapanese;
  if (onlineData.titleEnglish) patch.titleEnglish = onlineData.titleEnglish;
  if (onlineData.synopsis) patch.onlineDescription = onlineData.synopsis;
  if (onlineData.authors) patch.onlineAuthor = onlineData.authors;
  if (importedGenres.length > 0) patch.onlineGenres = importedGenres;
  if (onlineData.source) patch.onlineSource = onlineData.source;
  if (onlineData.sourceLabel) patch.onlineSourceLabel = onlineData.sourceLabel;
  if (onlineData.sourceId) patch.onlineSourceId = String(onlineData.sourceId);
  if (onlineData.mangaDexId) patch.mangaDexId = onlineData.mangaDexId;
  if (onlineData.anilistId) patch.anilistId = onlineData.anilistId;
  if (onlineData.nhentaiId) patch.nhentaiId = onlineData.nhentaiId;
  if (Array.isArray(onlineData.altTitles)) {
    patch.onlineAltTitles = uniqueStrings(onlineData.altTitles);
  }
  if (onlineData.source === 'anilist' && Number.isFinite(Number(onlineData.malId))) {
    patch.malId = Number(onlineData.malId);
  }

  let managedCoverVariant = null;
  if (onlineData.identity && (onlineData.coverDownloadUrl || onlineData.coverUrl)) {
    let tempPath = null;
    try {
      const downloaded = await downloadCandidateCover(onlineData.identity);
      if (downloaded.ok) {
        const extension = inferImageExtensionFromContentType(downloaded.contentType) || '.jpg';
        tempPath = path.join(getCacheDir(), `.metadata-cover-${process.pid}-${Date.now()}${extension}`);
        await fs.promises.writeFile(tempPath, downloaded.buffer);
        managedCoverVariant = await importManagedCover({
          sourcePath: tempPath,
          managedCoverDir: getManagedCoverDir(),
          sourceLabel: `${onlineData.sourceLabel || onlineData.source || 'Source en ligne'} - ${onlineData.title || 'couverture'}`
        });
      }
    } catch (_error) {
      managedCoverVariant = null;
    } finally {
      if (tempPath) await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  const TAG_COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
    '#6366f1', '#f43f5e', '#0ea5e9', '#84cc16'
  ];
  const isAdultMetadataSource = ['nhentai', 'imhentai', 'hentaiera'].includes(onlineData.source);
  const now = new Date().toISOString();

  updateState((state) => {
    state.metadata = state.metadata || {};
    state.metadataLocks = state.metadataLocks || {};
    state.metadataFieldSource = state.metadataFieldSource || {};
    state.tags = state.tags || {};
    state.mangaTags = state.mangaTags || {};
    state.mangaTagMeta = state.mangaTagMeta || {};
    state.coverProfiles = state.coverProfiles || {};

    for (const [field, value] of Object.entries(patch)) {
      applyMetadataField(state, mangaId, field, value, 'online');
    }
    state.metadata[mangaId] = {
      ...(state.metadata[mangaId] || {}),
      onlineImportedAt: now
    };
    if (managedCoverVariant) {
      const profile = mergeCoverVariants(normalizeCoverProfile(state.coverProfiles[mangaId], mangaId), [managedCoverVariant]);
      state.coverProfiles[mangaId] = selectCoverVariant(profile, managedCoverVariant.id);
    }

    for (const tag of importedGenres) {
      const tagName = tag.trim();
      if (!tagName) continue;

      let existingTag = Object.values(state.tags).find((t) => t.name.toLowerCase() === tagName.toLowerCase());
      if (!existingTag) {
        let hash = 0;
        for (let i = 0; i < tagName.length; i += 1) {
          hash = ((hash << 5) - hash) + tagName.charCodeAt(i);
          hash |= 0;
        }
        const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        existingTag = { id, name: tagName, color: TAG_COLORS[Math.abs(hash) % TAG_COLORS.length], createdAt: now };
        state.tags[id] = existingTag;
      }
      if (existingTag) {
        state.mangaTags[mangaId] = [...new Set([...(state.mangaTags[mangaId] || []), existingTag.id])];
        if (isAdultMetadataSource) {
          state.mangaTagMeta[mangaId] = state.mangaTagMeta[mangaId] || {};
          state.mangaTagMeta[mangaId][existingTag.id] = { nsfw: true, source: onlineData.source, autoImported: true, markedAt: now };
        }
      }
    }

    return state;
  });

  return buildInteractivePayload();
});

ipcMain.handle('metadata:queueWorkbench', async (_event, mangaIds = [], mode = 'append') => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  let nextItems = [];
  updateStateSegments({ organization: ['metadataWorkbenchQueue', 'metadataWorkbenchItems'] }, (state) => {
    const existing = Array.isArray(state.metadataWorkbenchQueue) ? state.metadataWorkbenchQueue : [];
    state.metadataWorkbenchQueue = mode === 'replace'
      ? ids
      : [...new Set([...existing, ...ids])];
    const existingItems = new Map((state.metadataWorkbenchItems || []).map((item) => [String(item.mangaId), item]));
    state.metadataWorkbenchItems = state.metadataWorkbenchQueue.map((mangaId, order) => ({
      ...(existingItems.get(mangaId) || { mangaId, status: 'pending', confidence: 0, margin: 0, candidate: null, candidateCount: 0, fields: [], error: null, jobId: null }),
      mangaId,
      order
    }));
    nextItems = structuredClone(state.metadataWorkbenchItems);
    return state;
  });
  return mutationResult({ metadataWorkbenchQueue: nextItems.map((item) => item.mangaId), metadataWorkbenchItems: nextItems });
});

ipcMain.handle('metadata:setWorkbenchQueue', async (_event, mangaIds = []) => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  let nextItems = [];
  updateStateSegments({ organization: ['metadataWorkbenchQueue', 'metadataWorkbenchItems'] }, (state) => {
    const existingItems = new Map((state.metadataWorkbenchItems || []).map((item) => [String(item.mangaId), item]));
    state.metadataWorkbenchQueue = ids;
    state.metadataWorkbenchItems = ids.map((mangaId, order) => ({
      ...(existingItems.get(mangaId) || { mangaId, status: 'pending', confidence: 0, margin: 0, candidate: null, candidateCount: 0, fields: [], error: null, jobId: null }),
      mangaId,
      order
    }));
    nextItems = structuredClone(state.metadataWorkbenchItems);
    return state;
  });
  return mutationResult({ metadataWorkbenchQueue: ids, metadataWorkbenchItems: nextItems });
});

ipcMain.handle('metadata:getWorkbenchPage', async (_event, input = {}) => {
  const state = loadState();
  let items = Array.isArray(state.metadataWorkbenchItems) ? state.metadataWorkbenchItems : [];
  const mangaMap = await resolveWorkbenchMangasById(items.map((item) => item.mangaId));
  if (state?.vault?.locked) {
    items = items.filter((item) => !isPrivateWorkbenchManga(state, mangaMap.get(item.mangaId)));
  }
  const page = getWorkbenchPage(items, input);
  return {
    ...page,
    items: page.items.map((item) => {
      const manga = mangaMap.get(item.mangaId);
      return {
        ...item,
        manga: manga ? {
          id: String(manga.id || item.mangaId),
          displayTitle: manga.displayTitle || manga.title || 'Sans titre',
          author: manga.author || manga.onlineAuthor || '',
          chapterCount: Number(manga.chapterCount || manga.chapters?.length || 0),
          pageCount: Number(manga.pageCount || manga.totalPages || 0),
          coverSrc: manga.coverSrc || null,
          coverMediaType: manga.coverMediaType || 'image',
          coverFilePath: manga.coverFilePath || null,
          coverPageNumber: Number(manga.coverPageNumber || 1),
          isPrivate: isPrivateWorkbenchManga(state, manga)
        } : null
      };
    })
  };
});

ipcMain.handle('metadata:getWorkbenchSelectionIds', async (_event, input = {}) => {
  const state = loadState();
  let items = Array.isArray(state.metadataWorkbenchItems) ? state.metadataWorkbenchItems : [];
  if (state?.vault?.locked) {
    const mangaMap = await resolveWorkbenchMangasById(items.map((item) => item.mangaId));
    items = items.filter((item) => !isPrivateWorkbenchManga(state, mangaMap.get(item.mangaId)));
  }
  const ids = getWorkbenchSelectionIds(items, input);
  return { ok: true, revision: stateRevision, ids, total: ids.length };
});

ipcMain.handle('metadata:searchCandidates', async (_event, input = {}) => {
  const mangaId = String(input.mangaId || '').trim();
  const state = loadState();
  const manga = mangaId ? (await resolveWorkbenchMangasById([mangaId])).get(mangaId) : null;
  const privateContext = Boolean(manga && isPrivateWorkbenchManga(state, manga));
  if (privateContext && state?.vault?.locked) return { ok: false, error: 'Coffre verrouille.', results: [] };
  const query = String(input.query || manga?.displayTitle || '').trim();
  const response = await getMetadataProviderRegistry().searchCandidates(query, { ui: state.ui, privateContext });
  const ranking = manga ? rankMetadataCandidates(manga, response.results, DEFAULT_MATCH_POLICY) : null;
  return {
    ok: true,
    results: ranking ? ranking.ranked.map((entry) => ({ ...entry.candidate, confidence: entry.confidence, reasons: entry.reasons })) : response.results,
    providerErrors: response.providerErrors,
    cached: Boolean(response.cached)
  };
});

ipcMain.handle('metadata:startWorkbenchAnalysis', (_event, input = {}) => {
  const state = loadState();
  const requested = [...new Set((input.mangaIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  const mangaIds = requested.length
    ? requested
    : (state.metadataWorkbenchItems || []).filter((item) => ['pending', 'interrupted', 'error'].includes(item.status)).map((item) => item.mangaId);
  const job = jobOrchestrator.enqueue({
    kind: 'workbench-analysis',
    payload: { mangaIds, autoApply: input.autoApply !== false },
    requeueable: true,
    progress: { phase: 'queued', completed: 0, total: mangaIds.length, percent: 0 }
  });
  return { ok: true, revision: stateRevision, job };
});

ipcMain.handle('metadata:applyWorkbenchMatches', (_event, input = {}) => {
  const mangaIds = [...new Set((input.mangaIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  const job = jobOrchestrator.enqueue({
    kind: 'workbench-apply',
    payload: { mangaIds, candidates: input.candidates && typeof input.candidates === 'object' ? input.candidates : {} },
    requeueable: false,
    progress: { phase: 'queued', completed: 0, total: mangaIds.length, percent: 0 }
  });
  return { ok: true, revision: stateRevision, job };
});

ipcMain.handle('metadata:resolveWorkbenchItems', async (_event, input = {}) => {
  const decision = String(input?.decision || '').trim();
  if (!['keep-local'].includes(decision)) {
    return { ok: false, revision: stateRevision, error: 'Decision Atelier invalide.' };
  }
  const requestedIds = [...new Set((input?.mangaIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!requestedIds.length) return { ok: false, revision: stateRevision, error: 'Aucune oeuvre selectionnee.' };
  const state = loadState();
  const mangaMap = await resolveWorkbenchMangasById(requestedIds);
  const allowedIds = requestedIds.filter((mangaId) => !(state?.vault?.locked && isPrivateWorkbenchManga(state, mangaMap.get(mangaId))));
  const reviewedAt = new Date().toISOString();
  updateStateSegments({ organization: ['metadataWorkbenchQueue', 'metadataWorkbenchItems'] }, (nextState) => {
    const allowed = new Set(allowedIds);
    nextState.metadataWorkbenchItems = (nextState.metadataWorkbenchItems || []).map((item) => allowed.has(String(item?.mangaId || ''))
      ? { ...item, status: 'done', decision, reviewedAt, error: null, jobId: null, updatedAt: reviewedAt }
      : item);
    nextState.metadataWorkbenchQueue = (nextState.metadataWorkbenchItems || []).map((item) => item.mangaId);
    return nextState;
  });
  return mutationResult({ resolvedIds: allowedIds, rejectedIds: requestedIds.filter((id) => !allowedIds.includes(id)) });
});

ipcMain.handle('metadata:retryWorkbenchItems', (_event, mangaIds = []) => {
  const ids = [...new Set((Array.isArray(mangaIds) ? mangaIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  ids.forEach((mangaId) => patchWorkbenchItem(mangaId, { status: 'pending', decision: null, reviewedAt: null, error: null, jobId: null }));
  const job = jobOrchestrator.enqueue({
    kind: 'workbench-analysis',
    payload: { mangaIds: ids, autoApply: true },
    requeueable: true,
    progress: { phase: 'queued', completed: 0, total: ids.length, percent: 0 }
  });
  return { ok: true, revision: stateRevision, job };
});

ipcMain.handle('metadata:cancelWorkbenchJob', (_event, jobId) => {
  const job = jobOrchestrator.cancel(String(jobId || '').trim());
  return job ? { ok: true, revision: stateRevision, job } : { ok: false, revision: stateRevision, error: 'Tache introuvable.' };
});

ipcMain.handle('metadata:undoLastWorkbenchBatch', () => {
  let restoredIds = [];
  updateStateSegments({ metadata: ['metadata', 'metadataFieldSource'], organization: ['metadataWorkbenchItems', 'metadataWorkbenchLastBatch'] }, (state) => {
    const batch = state.metadataWorkbenchLastBatch;
    for (const entry of Array.isArray(batch?.entries) ? batch.entries : []) {
      const mangaId = String(entry?.mangaId || '').trim();
      if (!mangaId) continue;
      state.metadata[mangaId] = structuredClone(entry.metadata || {});
      state.metadataFieldSource[mangaId] = structuredClone(entry.fieldSources || {});
      const item = (state.metadataWorkbenchItems || []).find((value) => value.mangaId === mangaId);
      if (item) {
        item.status = 'review';
        item.decision = null;
        item.reviewedAt = null;
      }
      restoredIds.push(mangaId);
    }
    state.metadataWorkbenchLastBatch = null;
    return state;
  });
  return mutationResult({ restoredIds });
});

ipcMain.handle('metadata:updateFieldLocks', async (_event, mangaId, patch = {}) => {
  updateState((state) => {
    state.metadataLocks = state.metadataLocks || {};
    state.metadataLocks[mangaId] = {
      ...(state.metadataLocks[mangaId] || {}),
      ...Object.fromEntries(
        Object.entries(patch || {}).map(([field, value]) => [field, Boolean(value)])
      )
    };
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('metadata:importComicInfo', async (_event, mangaRef, options = {}) => {
  const payload = buildInteractivePayload({ refreshDerived: false });
  const manga = findMangaByReference(payload.library, mangaRef);
  if (!manga) return { ok: false, error: 'Manga introuvable.', payload };

  const explicitChapterRef = String(options?.chapterId || options?.chapterContentId || '').trim();
  const targetChapter = explicitChapterRef
    ? (manga.chapters || []).find((chapter) => chapter.id === explicitChapterRef || chapter.contentId === explicitChapterRef || chapter.locationId === explicitChapterRef)
    : (manga.chapters || []).find((chapter) => chapter.comicInfo)
      || (manga.chapters || []).find((chapter) => chapter.containerType === 'cbz' || chapter.containerType === 'folder')
      || null;

  if (!targetChapter?.path) {
    return { ok: false, error: 'Aucune source ComicInfo exploitable.', payload };
  }

  const comicInfo = targetChapter.comicInfo || await loadComicInfoForSource(targetChapter.path);
  if (!comicInfo) {
    return { ok: false, error: 'ComicInfo.xml introuvable.', payload };
  }

  const authorParts = [...new Set([comicInfo.writer, comicInfo.artist].map((value) => String(value || '').trim()).filter(Boolean))];
  const comicPatch = {
    title: String(comicInfo.series || comicInfo.title || '').trim() || undefined,
    description: String(comicInfo.summary || '').trim() || undefined,
    author: authorParts.join(', ') || undefined,
    volume: String(comicInfo.volume || '').trim() || undefined,
    number: String(comicInfo.number || '').trim() || undefined,
    year: String(comicInfo.year || '').trim() || undefined
  };

  const importedGenres = uniqueStrings(
    String(comicInfo.genre || '')
      .split(/[;,]/g)
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const TAG_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
  const now = new Date().toISOString();

  updateState((state) => {
    state.metadata = state.metadata || {};
    state.metadataLocks = state.metadataLocks || {};
    state.metadataFieldSource = state.metadataFieldSource || {};
    state.tags = state.tags || {};
    state.mangaTags = state.mangaTags || {};

    Object.entries(comicPatch).forEach(([field, value]) => {
      if (value !== undefined) applyMetadataField(state, manga.id, field, value, 'comicinfo');
    });

    state.metadata[manga.id] = {
      ...(state.metadata[manga.id] || {}),
      comicInfoImportedAt: now
    };

    for (const tagName of importedGenres) {
      let existingTag = Object.values(state.tags).find((tag) => tag.name.toLowerCase() === tagName.toLowerCase());
      if (!existingTag) {
        let hash = 0;
        for (let index = 0; index < tagName.length; index += 1) {
          hash = ((hash << 5) - hash) + tagName.charCodeAt(index);
          hash |= 0;
        }
        const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        existingTag = { id, name: tagName, color: TAG_COLORS[Math.abs(hash) % TAG_COLORS.length], createdAt: now };
        state.tags[id] = existingTag;
      }
      if (existingTag) {
        state.mangaTags[manga.id] = [...new Set([...(state.mangaTags[manga.id] || []), existingTag.id])];
      }
    }

    return state;
  });

  return { ok: true, payload: buildInteractivePayload(), comicInfo };
});

ipcMain.handle('queue:upsert', async (_event, item = {}) => {
  const payload = buildInteractivePayload({ refreshDerived: false });
  const manga = findMangaByReference(payload.library, item.mangaId);
  const chapterTarget = item.chapterId ? findChapterByReference(payload.library, item.chapterId) : { manga: null, chapter: null };
  const targetManga = chapterTarget.manga || manga;
  const targetChapter = chapterTarget.chapter || null;
  if (!targetManga) return payload;

  updateState((state) => {
    const nextSource = normalizeQueueSource(item.source);
    const currentQueue = Array.isArray(state.readingQueue) ? state.readingQueue : [];
    const targetIndex = currentQueue.findIndex((entry) =>
      String(entry?.mangaId || '') === targetManga.id
      && String(entry?.chapterId || '') === String(targetChapter?.id || '')
    );

    const existing = targetIndex >= 0 ? currentQueue[targetIndex] : null;
    const sources = [...new Set([...(existing?.sources || []), nextSource].map(normalizeQueueSource))];
    const nextItem = {
      mangaId: targetManga.id,
      mangaContentId: targetManga.contentId,
      chapterId: targetChapter?.id || null,
      chapterContentId: targetChapter?.contentId || null,
      sources,
      displaySource: getQueueDisplaySource(sources),
      pinned: item.pinned !== undefined ? Boolean(item.pinned) : Boolean(existing?.pinned),
      deferredUntil: item.deferredUntil ?? existing?.deferredUntil ?? null,
      updatedAt: new Date().toISOString()
    };

    if (targetIndex >= 0) currentQueue[targetIndex] = nextItem;
    else currentQueue.unshift(nextItem);
    state.readingQueue = currentQueue;
    return state;
  });

  return buildInteractivePayload();
});

ipcMain.handle('queue:remove', async (_event, item = {}) => {
  updateState((state) => {
    state.readingQueue = (state.readingQueue || []).filter((entry) => !(
      String(entry?.mangaId || '') === String(item?.mangaId || '')
      && String(entry?.chapterId || '') === String(item?.chapterId || '')
    ));
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('queue:save', async (_event, items = []) => {
  updateState((state) => {
    state.readingQueue = Array.isArray(items) ? items : [];
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('annotations:add', async (_event, input = {}) => {
  const mangaId = String(input?.mangaId || '').trim();
  const chapterId = String(input?.chapterId || '').trim();
  if (!mangaId || !chapterId) return buildInteractivePayload();

  updateState((state) => {
    state.annotations = state.annotations || {};
    const list = Array.isArray(state.annotations[mangaId]) ? state.annotations[mangaId] : [];
    const now = new Date().toISOString();
    list.unshift({
      id: makeLocalId('annotation'),
      mangaId,
      chapterId,
      pageIndex: Math.max(0, Number(input?.pageIndex || 0)),
      label: String(input?.label || '').trim() || 'Repere',
      note: String(input?.note || '').trim(),
      createdAt: now,
      updatedAt: now
    });
    state.annotations[mangaId] = list.slice(0, 200);
    return state;
  });

  return buildInteractivePayload();
});

ipcMain.handle('annotations:delete', async (_event, mangaId, annotationId) => {
  const targetMangaId = String(mangaId || '').trim();
  const targetAnnotationId = String(annotationId || '').trim();
  updateState((state) => {
    if (!state.annotations?.[targetMangaId]) return state;
    state.annotations[targetMangaId] = state.annotations[targetMangaId].filter((item) => item.id !== targetAnnotationId);
    if (state.annotations[targetMangaId].length === 0) delete state.annotations[targetMangaId];
    return state;
  });
  return buildInteractivePayload();
});

/* ---------- Backup ---------- */

ipcMain.handle('backup:create', async (_event, label) => {
  const result = createBackup(label);
  return { ...(await buildInteractivePayloadAsync({ refreshDerived: false })), backup: result };
});

ipcMain.handle('backup:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer une sauvegarde Sawa',
    properties: ['openFile'],
    filters: [
      { name: 'Sawa Backup', extensions: ['sawa-backup', 'sawa', 'json'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { restored: false };
  }

  try {
    const importResult = await importBackup(result.filePaths[0]);
    if (!importResult?.restored) return importResult;
    restartWatchers();
    return { ...(await buildPayloadAfterStructuralScan()), ...importResult };
  } catch (error) {
    return { restored: false, error: error?.message || 'Import failed' };
  }
});

ipcMain.handle('backup:list', async () => {
  return listBackups();
});

ipcMain.handle('backup:export', async () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultName = `sawa-backup-${timestamp}.sawa-backup`;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter la sauvegarde Sawa',
    defaultPath: defaultName,
    filters: [
      { name: 'Sawa Backup', extensions: ['sawa-backup'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { exported: false };
  }

  try {
    return await exportBackup(result.filePath);
  } catch (error) {
    return { exported: false, error: error?.message || 'Export failed' };
  }
});

/* ---------- UI / Session ---------- */

function applyUiSettingsPatch(state, patch = {}) {
  const safePatch = patch && typeof patch === 'object' ? patch : {};
  state.ui = {
    ...state.ui,
    ...safePatch,
    experimental: safePatch?.experimental
      ? {
          ...(state.ui?.experimental || {}),
          ...safePatch.experimental
        }
      : (state.ui?.experimental || {})
  };
  return state.ui;
}

ipcMain.handle('ui:updateSettings', async (_event, patch) => {
  updateState((state) => {
    applyUiSettingsPatch(state, patch);
    return state;
  });
  if (patch?.experimental?.schedulerProfile) {
    jobOrchestrator.setProfile(normalizeJobProfile(patch.experimental.schedulerProfile));
  }
  return buildInteractivePayload();
});

ipcMain.handle('ui:updateSettingsLight', async (_event, patch) => {
  let nextUi = null;
  updateStateSegments({ root: ['ui'] }, (state) => {
    nextUi = applyUiSettingsPatch(state, patch);
    return state;
  });
  if (patch?.experimental?.schedulerProfile) {
    jobOrchestrator.setProfile(normalizeJobProfile(patch.experimental.schedulerProfile));
  }
  configurePerfDiagnostics(Boolean(nextUi?.experimental?.performanceDiagnostics));
  return mutationResult({ ui: nextUi || {} });
});

ipcMain.handle('ui:pickBackgroundImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir une image de fond',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return buildInteractivePayload();
  }

  const sourcePath = result.filePaths[0];
  const udp = getUserDataPath();
  const ext = (path.extname(sourcePath) || '.jpg').toLowerCase();
  const destPath = path.join(udp, `sawa-background${ext}`);

  // Remove any previous background image
  try {
    for (const f of fs.readdirSync(udp)) {
      if (f.startsWith('sawa-background')) {
        const fp = path.join(udp, f);
        if (fp !== destPath) try { fs.unlinkSync(fp); } catch (_) {}
      }
    }
  } catch (_) {}

  try {
    fs.copyFileSync(sourcePath, destPath);
  } catch (_) {
    // Fall back to source path
  }

  const finalPath = fs.existsSync(destPath) ? destPath : sourcePath;

  // Read a small version of the image to extract dominant colors
  let extractedColors = null;
  try {
    const imgBuffer = fs.readFileSync(finalPath);
    extractedColors = extractDominantColors(imgBuffer);
  } catch (_) {}

  updateState((state) => {
    state.ui = {
      ...state.ui,
      backgroundImage: finalPath,
      backgroundOpacity: state.ui.backgroundOpacity ?? 0.15,
    };
    if (extractedColors) {
      state.ui.backgroundAccent = extractedColors.accent;
      state.ui.backgroundAccentAlt = extractedColors.accentAlt;
    }
    return state;
  });

  return buildInteractivePayload();
});

ipcMain.handle('ui:removeBackgroundImage', async () => {
  const udp = getUserDataPath();
  try {
    for (const f of fs.readdirSync(udp)) {
      if (f.startsWith('sawa-background')) {
        try { fs.unlinkSync(path.join(udp, f)); } catch (_) {}
      }
    }
  } catch (_) {}

  updateState((state) => {
    delete state.ui.backgroundImage;
    delete state.ui.backgroundOpacity;
    delete state.ui.backgroundAccent;
    delete state.ui.backgroundAccentAlt;
    return state;
  });

  return buildInteractivePayload();
});

ipcMain.handle('session:saveTabs', async (_event, payload) => {
  const persisted = loadState();
  const rawLibrary = rawLibrarySnapshot || readLibrarySnapshot() || { allMangas: [], categories: [] };
  const privacyModel = buildVaultPrivacyModel(rawLibrary, persisted);
  const privateChapterIds = new Set(
    (rawLibrary?.allMangas || [])
      .filter((manga) => privacyModel.allPrivateIds.has(manga.id))
      .flatMap((manga) => (manga.chapters || []).flatMap((chapter) => [
        chapter.id,
        chapter.contentId,
        chapter.locationId,
        chapter.legacyId
      ]))
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const sanitizedPayload = sanitizeSessionSearchPrivacy(payload, {
    vaultLocked: isVaultLocked(persisted) || Boolean(persisted?.vault?.stealthMode),
    privateMangaIds: privacyModel.allPrivateIds,
    privateChapterIds
  });
  updateStateSegments({ root: ['session'] }, (state) => {
    state.session = normalizePersistedSessionPayload(sanitizedPayload);
    return state;
  });
  return true;
});

ipcMain.handle('vault:setPin', async (_event, pin) => {
  const normalizedPin = normalizePinInput(pin);
  if (normalizedPin.length < 4) {
    return { ok: false, error: 'Le code PIN doit contenir au moins 4 caracteres.' };
  }

  updateState((state) => {
    state.vault = state.vault || {};
    const pinProtectedBlob = buildProtectedPinBlob(normalizedPin);
    state.vault.pinProtectedBlob = pinProtectedBlob;
    state.vault.pinHash = pinProtectedBlob ? null : hashPin(normalizedPin);
    state.vault.securityMode = pinProtectedBlob ? 'system' : 'basic';
    state.vault.autoLockOnClose = true;
    state.vault.locked = false;
    return state;
  });

  return { ok: true, payload: buildInteractivePayload() };
});

ipcMain.handle('vault:unlock', async (_event, pin) => {
  const state = loadState();
  if (!isVaultConfigured(state)) {
    return { ok: false, error: 'Aucun code PIN n est configure.' };
  }
  const normalizedPin = normalizePinInput(pin);
  const matchesProtected = verifyProtectedPinBlob(normalizedPin, state?.vault?.pinProtectedBlob);
  const matchesBasic = !state?.vault?.pinProtectedBlob && hashPin(normalizedPin) === (state?.vault?.pinHash || null);
  if (!matchesProtected && !matchesBasic) {
    return { ok: false, error: 'Code PIN incorrect.' };
  }
  updateState((nextState) => {
    nextState.vault = nextState.vault || {};
    if (!nextState.vault.pinProtectedBlob) {
      const nextProtectedBlob = buildProtectedPinBlob(normalizedPin);
      if (nextProtectedBlob) {
        nextState.vault.pinProtectedBlob = nextProtectedBlob;
        nextState.vault.pinHash = null;
        nextState.vault.securityMode = 'system';
      }
    }
    nextState.vault.locked = false;
    return nextState;
  });
  return { ok: true, payload: buildInteractivePayload() };
});

ipcMain.handle('vault:lock', async () => {
  metadataProviderRegistry?.clearPrivateCache();
  updateState((state) => {
    if (!isVaultConfigured(state)) return state;
    state.vault.locked = true;
    return state;
  });
  return { ok: true, payload: buildInteractivePayload() };
});

function applyVaultPrefsPatch(state, patch = {}) {
  state.vault = {
    ...(state.vault || {}),
    blurCovers: patch.blurCovers !== undefined ? Boolean(patch.blurCovers) : Boolean(state.vault?.blurCovers),
    stealthMode: patch.stealthMode !== undefined ? Boolean(patch.stealthMode) : Boolean(state.vault?.stealthMode)
  };
  return state.vault;
}

ipcMain.handle('vault:updatePrefs', async (_event, patch = {}) => {
  updateState((state) => {
    applyVaultPrefsPatch(state, patch);
    return state;
  });
  return buildInteractivePayload();
});

ipcMain.handle('vault:updatePrefsLight', async (_event, patch = {}) => {
  let nextVault = null;
  updateStateSegments({ root: ['vault'] }, (state) => {
    nextVault = applyVaultPrefsPatch(state, patch);
    return state;
  });
  return mutationResult({ vault: nextVault || {} });
});

/* ---------- Window ---------- */

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle('window:close', () => {
  persistVaultLock();
  mainWindow?.close();
});

ipcMain.handle('window:toggleFullScreen', () => {
  if (!mainWindow) return false;
  const nextValue = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(nextValue);
  return nextValue;
});

/* ---------- Maintenance ---------- */

ipcMain.handle('maintenance:clearCache', async () => {
  const thumbDir = getThumbnailDir();
  try {
    if (fs.existsSync(thumbDir)) {
      const files = fs.readdirSync(thumbDir);
      for (const file of files) {
        try { fs.unlinkSync(path.join(thumbDir, file)); } catch (_) {}
      }
    }
    clearCbzCache();
    return { ok: true, cleared: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Impossible de vider le cache.' };
  }
});

ipcMain.handle('maintenance:rebuildIndex', async () => {
  restartWatchers();
  ensureQueuedJob('scan', { source: 'maintenance-rebuild-index' });
  await jobOrchestrator.process();
  return buildInteractivePayload();
});

ipcMain.handle('maintenance:rebuildDerivedData', async () => {
  clearDerivedArtifacts();
  rawLibrarySnapshot = null;
  restartWatchers();
  ensureQueuedJob('scan', { source: 'maintenance-rebuild-derived' });
  ensureQueuedJob('analyze', { source: 'maintenance-rebuild-derived' });
  await jobOrchestrator.process();
  return {
    ok: true,
    payload: await buildInteractivePayloadAsync({ refreshDerived: false }),
    syncStatus: latestSyncStatus
  };
});

ipcMain.handle('maintenance:getStats', async (_event, options = {}) => {
  const state = loadState();
  const memUsage = process.memoryUsage();
  const includeOcr = Boolean(options?.includeOcr);
  const ocrInfo = includeOcr
    ? {
      ...listOcrLanguages(),
      indexedPages: countOcrPages()
    }
    : {
      available: false,
      languages: [],
      paused: ocrPaused,
      indexedPages: 0,
      skipped: true
    };
  const plugins = listAvailablePlugins(state);
  return {
    uptime: process.uptime(),
    lastScanTime,
    memoryUsage: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss
    },
    syncStatus: latestSyncStatus,
    diagnostics: getDiagnosticsSnapshot(),
    derivedDbPath: getDerivedDbPath(),
    derivedSnapshot: getSnapshotMeta(),
    jobs: listJobs(),
    ocr: {
      ...ocrInfo,
      paused: ocrPaused
    },
    plugins: {
      total: plugins.length,
      enabled: plugins.filter((plugin) => plugin.enabled).length
    },
    counts: {
      categories: state.categories.length,
      favorites: Object.keys(state.favorites).length,
      tags: Object.keys(state.tags).length,
      collections: Object.keys(state.collections).length,
      progressEntries: Object.keys(state.progress).length,
      metadataEntries: Object.keys(state.metadata).length,
      recents: state.recents.length
    }
  };
});

ipcMain.handle('maintenance:getDuplicateCandidates', async () => ({
  candidates: await buildVisualDuplicateCandidates()
}));

function getClientIdentityState(state = loadState()) {
  return buildClientPersistedState(state, rawLibrarySnapshot || { allMangas: [] });
}

function assertVisibleWorkMutation({ mangaIds = [], groupId = null } = {}) {
  const state = loadState();
  const privateIds = buildVaultPrivacyModel(rawLibrarySnapshot || { allMangas: [] }, state).allPrivateIds;
  const group = groupId ? state.workGroups?.[groupId] : null;
  const affectedIds = [...new Set([
    ...(mangaIds || []),
    ...(group?.editionIds || [])
  ])];
  const hasPrivate = Boolean(group?.private) || affectedIds.some((mangaId) => privateIds.has(mangaId));
  const hasPublic = affectedIds.some((mangaId) => !privateIds.has(mangaId));
  if (hasPrivate && hasPublic) {
    throw new Error('Regroupement refusé: contenu public et coffre ne peuvent pas être mélangés.');
  }
  if (hasPrivate && (isVaultLocked(state) || state?.vault?.stealthMode)) {
    throw new Error('Cette opération nécessite le déverrouillage du coffre.');
  }
}

ipcMain.handle('identity:listSuggestions', async () => ({
  ok: true,
  suggestions: (getClientIdentityState().identitySuggestions || [])
    .filter((entry) => entry.status === 'pending')
}));

function buildWorkOrganizationPatch(state = loadState()) {
  const clientState = buildClientPersistedState(state, rawLibrarySnapshot || { allMangas: [] });
  const hidePrivateGroups = isVaultLocked(state) || Boolean(state?.vault?.stealthMode);
  const privateIds = hidePrivateGroups
    ? buildVaultPrivacyModel(rawLibrarySnapshot || { allMangas: [] }, state).allPrivateIds
    : new Set();
  const workGroups = Object.fromEntries(Object.entries(clientState.workGroups || {})
    .filter(([, group]) => !(group.editionIds || []).some((mangaId) => privateIds.has(mangaId))));
  return {
    workGroups: workGroups,
    favorites: clientState.favorites || {},
    mangaTags: clientState.mangaTags || {},
    collections: clientState.collections || {}
  };
}

ipcMain.handle('identity:analyze', async () => {
  try {
    const result = await runIdentityAnalysis();
    if (!result?.ok) {
      if (result?.stale) scheduleIdentityAnalysis(500);
      return {
        ok: false,
        stale: Boolean(result?.stale),
        retryable: Boolean(result?.retryable),
        revision: stateRevision,
        error: result?.stale ? 'Analyse devenue obsolète; une nouvelle analyse est planifiée.' : result?.error
      };
    }
    const clientState = getClientIdentityState();
    stateRevision += 1;
    return {
      ok: true,
      exactMoveCount: result.exactMoveCount,
      ambiguousCount: result.ambiguousCount,
      mediaIssues: clientState.identityMediaIssues || [],
      suggestions: (clientState.identitySuggestions || []).filter((entry) => entry.status === 'pending'),
      revision: stateRevision,
      patch: {
        identitySuggestions: clientState.identitySuggestions || [],
        identityMediaIssues: clientState.identityMediaIssues || [],
        ...buildWorkOrganizationPatch()
      }
    };
  } catch (error) {
    return { ok: false, revision: stateRevision, error: error?.message || 'Analyse d’identité impossible.' };
  }
});

ipcMain.handle('identity:decideSuggestion', async (_event, input = {}) => {
  try {
    const suggestionId = String(input?.suggestionId || '').trim();
    const decision = input?.decision === 'accept' ? 'accept' : 'reject';
    if (!suggestionId || suggestionId.length > 160) {
      return { ok: false, revision: stateRevision, error: 'Suggestion invalide.' };
    }
    const visibleSuggestion = (getClientIdentityState().identitySuggestions || [])
      .find((entry) => entry.id === suggestionId && entry.status === 'pending');
    if (!visibleSuggestion) {
      return { ok: false, revision: stateRevision, error: 'Suggestion introuvable ou coffre verrouillé.' };
    }
    const result = identityService.decideSuggestion(suggestionId, decision);
    const clientState = getClientIdentityState();
    stateRevision += 1;
    return {
      ok: result.ok,
      suggestion: (clientState.identitySuggestions || []).find((entry) => entry.id === suggestionId),
      revision: stateRevision,
      patch: {
        identitySuggestions: clientState.identitySuggestions || [],
        ...buildWorkOrganizationPatch()
      }
    };
  } catch (error) {
    return { ok: false, revision: stateRevision, error: error?.message || 'Décision impossible.' };
  }
});

ipcMain.handle('works:groupEditions', async (_event, input = {}) => {
  try {
    const mangaIds = [...new Set((Array.isArray(input?.mangaIds) ? input.mangaIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean))]
      .slice(0, 24);
    assertVisibleWorkMutation({ mangaIds });
    const result = identityService.groupEditions(mangaIds, {
      title: String(input?.title || '').trim().slice(0, 300),
      preferredEditionId: String(input?.preferredEditionId || '').trim() || null
    });
    stateRevision += 1;
    return {
      ...result,
      revision: stateRevision,
      patch: buildWorkOrganizationPatch()
    };
  } catch (error) {
    return { ok: false, revision: stateRevision, error: error?.message || 'Regroupement impossible.' };
  }
});

ipcMain.handle('works:ungroup', async (_event, groupId) => {
  const normalizedGroupId = String(groupId || '').trim();
  assertVisibleWorkMutation({ groupId: normalizedGroupId });
  const result = identityService.ungroup(normalizedGroupId);
  stateRevision += 1;
  return {
    ...result,
    revision: stateRevision,
    patch: buildWorkOrganizationPatch(),
    error: result.ok ? undefined : 'Œuvre introuvable.'
  };
});

ipcMain.handle('works:setPreferredEdition', async (_event, input = {}) => {
  const groupId = String(input?.groupId || '').trim();
  const mangaId = String(input?.mangaId || '').trim();
  assertVisibleWorkMutation({ mangaIds: [mangaId], groupId });
  const result = identityService.setPreferred(groupId, mangaId);
  stateRevision += 1;
  return {
    ...result,
    revision: stateRevision,
    patch: buildWorkOrganizationPatch(),
    error: result.ok ? undefined : 'Édition invalide.'
  };
});

ipcMain.handle('jobs:list', async () => ({
  jobs: listJobs(),
  syncStatus: latestSyncStatus
}));

ipcMain.handle('jobs:cancel', async (_event, jobId) => ({
  job: jobOrchestrator.cancel(jobId),
  jobs: listJobs(),
  syncStatus: latestSyncStatus
}));

ipcMain.handle('jobs:retry', async (_event, jobId) => {
  const job = jobOrchestrator.retry(jobId);
  await jobOrchestrator.process();
  return {
    job,
    jobs: listJobs(),
    syncStatus: latestSyncStatus
  };
});

ipcMain.handle('search:advanced', async (_event, input = {}) => {
  const state = loadState();
  const rawLibrary = rawLibrarySnapshot || readLibrarySnapshot() || {
    allMangas: [],
    categories: []
  };
  return runPrivacySafeAdvancedSearch({
    input,
    state,
    rawLibrary,
    searchDocuments
  });
});

ipcMain.handle('reader:getVisualPrefs', async (_event, mangaRef = null) => {
  const state = loadState();
  const payload = buildInteractivePayload({ refreshDerived: false });
  const manga = mangaRef ? findMangaByReference(payload.library, mangaRef) || findMangaByReference(payload.vaultLibrary, mangaRef) : null;
  const visualPrefs = state.readerPrefs?.visual || {};
  const globalPrefs = visualPrefs.global || {
    enabled: false,
    preset: 'custom',
    contrast: 0,
    sharpen: 0,
    denoise: 0,
    moireReduction: 0,
    autoCrop: false
  };
  const byManga = visualPrefs.byManga || {};
  return {
    global: globalPrefs,
    manga: manga ? (byManga[manga.contentId || manga.id] || null) : null
  };
});

ipcMain.handle('reader:setVisualPrefs', async (_event, mangaRef = null, patch = {}) => {
  const payload = buildInteractivePayload({ refreshDerived: false });
  const manga = mangaRef ? findMangaByReference(payload.library, mangaRef) || findMangaByReference(payload.vaultLibrary, mangaRef) : null;
  updateState((state) => {
    state.readerPrefs = state.readerPrefs || {};
    state.readerPrefs.visual = state.readerPrefs.visual || { global: {}, byManga: {} };
    if (manga) {
      const key = manga.contentId || manga.id;
      state.readerPrefs.visual.byManga[key] = {
        ...(state.readerPrefs.visual.byManga[key] || {}),
        ...patch
      };
    } else {
      state.readerPrefs.visual.global = {
        ...(state.readerPrefs.visual.global || {}),
        ...patch
      };
    }
    return state;
  });
  return buildInteractivePayload({ refreshDerived: false });
});

ipcMain.handle('guidedView:getPanelMap', async (_event, chapterRef) => {
  const payload = buildInteractivePayload({ refreshDerived: false });
  const { chapter } = findChapterByReference(payload.library, chapterRef);
  const state = loadState();
  const maps = state.readerPrefs?.guidedView?.panelMaps || {};
  const key = chapter ? (chapter.contentId || chapter.id) : String(chapterRef || '').trim();
  return maps[key] || null;
});

ipcMain.handle('guidedView:savePanelMap', async (_event, chapterRef, panelMap = {}) => {
  const payload = buildInteractivePayload({ refreshDerived: false });
  const { chapter } = findChapterByReference(payload.library, chapterRef);
  const key = chapter ? (chapter.contentId || chapter.id) : String(chapterRef || '').trim();
  updateState((state) => {
    state.readerPrefs = state.readerPrefs || {};
    state.readerPrefs.guidedView = state.readerPrefs.guidedView || {};
    state.readerPrefs.guidedView.panelMaps = state.readerPrefs.guidedView.panelMaps || {};
    state.readerPrefs.guidedView.panelMaps[key] = {
      ...panelMap,
      chapterId: key,
      updatedAt: new Date().toISOString(),
      source: panelMap?.source || 'manual'
    };
    return state;
  });
  return { ok: true, panelMap: loadState().readerPrefs?.guidedView?.panelMaps?.[key] || null };
});

ipcMain.handle('ocr:listLanguages', async () => {
  const info = listOcrLanguages(true);
  return {
    ...info,
    paused: ocrPaused,
    indexedPages: listOcrPages().length,
    mode: info.available ? 'local' : 'indisponible'
  };
});

ipcMain.handle('ocr:enqueue', async (_event, payload = {}) => {
  const info = getOcrEngineInfo(true);
  if (!info.available) {
    return {
      ok: false,
      error: 'OCR local indisponible. Installe Tesseract ou active l OCR Windows pris en charge par Sawa.'
    };
  }

  const job = jobOrchestrator.enqueue({
    kind: 'ocr',
    payload,
    requeueable: true
  });
  jobOrchestrator.schedule();
  return {
    ok: true,
    job,
    syncStatus: latestSyncStatus
  };
});

ipcMain.handle('ocr:pause', async () => {
  ocrPaused = true;
  updateSyncStatusPatch();
  return { ok: true, paused: true };
});

ipcMain.handle('ocr:resume', async () => {
  ocrPaused = false;
  jobOrchestrator.schedule();
  updateSyncStatusPatch();
  return { ok: true, paused: false };
});

ipcMain.handle('ocr:purge', async () => {
  const result = clearOcrData();
  return {
    ok: true,
    ...result,
    indexedPages: listOcrPages().length
  };
});

ipcMain.handle('ocr:cancel', async (_event, jobId) => ({
  ok: true,
  job: jobOrchestrator.cancel(jobId),
  syncStatus: latestSyncStatus
}));

ipcMain.handle('comicinfo:export', async (_event, input = {}) => {
  const payload = await buildInteractivePayloadAsync({ refreshDerived: false });
  const mangaRef = input?.mangaId || input?.mangaContentId || input?.mangaLocationId;
  const manga = findMangaByReference(payload.library, mangaRef) || findMangaByReference(payload.vaultLibrary, mangaRef);
  if (!manga) {
    return { ok: false, error: 'Manga introuvable.' };
  }

  const mode = String(input?.mode || 'sidecar').trim();
  const record = buildComicInfoExportRecord(manga);
  if (mode === 'sidecar') {
    const targetPath = resolveComicInfoSidecarTargetPath(manga);
    if (!targetPath) {
      return { ok: false, error: 'Aucun emplacement sidecar valide pour ce manga.' };
    }
    try {
      const result = writeComicInfoSidecar(targetPath, record);
      return { ok: true, path: result.path, preview: buildComicInfoXml(record) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Export ComicInfo impossible.' };
    }
  }

  if (!['embed-cbz', 'create-cbz', 'manga-cbz'].includes(mode)) {
    return { ok: false, error: 'Mode d export ComicInfo invalide.' };
  }
  const conflictPolicy = ['rename', 'replace', 'skip'].includes(String(input?.conflictPolicy || '').trim())
    ? String(input.conflictPolicy).trim()
    : 'rename';

  if (mode === 'manga-cbz') {
    const chapters = (manga.chapters || []).filter((chapter) => chapter?.path);
    if (chapters.length === 0) return { ok: false, error: 'Aucun chapitre exportable.' };
    const destination = await dialog.showOpenDialog(mainWindow, {
      title: 'Choisir le dossier des CBZ',
      properties: ['openDirectory', 'createDirectory']
    });
    if (destination.canceled || !destination.filePaths?.[0]) {
      return { ok: false, cancelled: true };
    }
    const destinationRoot = destination.filePaths[0];
    const jobs = chapters.map((chapter, index) => {
      const chapterLabel = chapter.displayTitle || chapter.name || chapter.title || `Chapitre ${index + 1}`;
      const fileName = `${sanitizeCbzFileName(chapterLabel, `Chapitre ${index + 1}`)}.cbz`;
      return jobOrchestrator.enqueue({
        kind: 'export',
        requeueable: false,
        payload: {
          sourcePath: chapter.path,
          targetPath: path.join(destinationRoot, fileName),
          xml: buildComicInfoXml(buildComicInfoExportRecord(manga, chapter)),
          mangaId: manga.id,
          chapterId: chapter.id,
          mode: path.extname(chapter.path).toLowerCase() === '.cbz' ? 'copy-cbz' : 'create-cbz',
          conflictPolicy,
          replaceSource: false
        }
      });
    });
    if (input?.background === false) {
      await jobOrchestrator.process();
      const completedJobs = jobs.map((job) => getJob(job.id));
      return {
        ok: completedJobs.every((job) => job?.status === 'done'),
        queued: false,
        jobs: completedJobs,
        error: completedJobs.find((job) => job?.status !== 'done')?.lastError || null
      };
    }
    return { ok: true, queued: true, jobs, jobCount: jobs.length };
  }

  const chapterRef = String(input?.chapterId || '').trim();
  const chapter = (manga.chapters || []).find((entry) => (
    !chapterRef || entry.id === chapterRef || entry.contentId === chapterRef || entry.locationId === chapterRef
  ));
  if (!chapter?.path || !fs.existsSync(chapter.path)) {
    return { ok: false, error: 'Chapitre source introuvable.' };
  }
  const sourceStats = fs.statSync(chapter.path);
  if (mode === 'embed-cbz' && (!sourceStats.isFile() || path.extname(chapter.path).toLowerCase() !== '.cbz')) {
    return { ok: false, error: 'Le chapitre selectionne n est pas un CBZ.' };
  }
  if (mode === 'create-cbz' && !sourceStats.isDirectory()) {
    return { ok: false, error: 'La creation CBZ exige un dossier de chapitre.' };
  }

  let targetPath = chapter.path;
  if (mode === 'create-cbz') {
    const destination = await dialog.showSaveDialog(mainWindow, {
      title: 'Creer un CBZ avec ComicInfo.xml',
      defaultPath: `${path.basename(chapter.path)}.cbz`,
      filters: [{ name: 'Archive CBZ', extensions: ['cbz'] }]
    });
    if (destination.canceled || !destination.filePath) return { ok: false, cancelled: true };
    targetPath = destination.filePath.toLowerCase().endsWith('.cbz')
      ? destination.filePath
      : `${destination.filePath}.cbz`;
  }

  const job = jobOrchestrator.enqueue({
    kind: 'export',
    requeueable: false,
    payload: {
      sourcePath: chapter.path,
      targetPath,
      xml: buildComicInfoXml(buildComicInfoExportRecord(manga, chapter)),
      mangaId: manga.id,
      chapterId: chapter.id,
      mode,
      conflictPolicy: mode === 'embed-cbz' ? 'replace' : conflictPolicy
    }
  });
  if (input?.background === false) {
    await jobOrchestrator.process();
    const completed = getJob(job.id);
    return {
      ok: completed?.status === 'done',
      job: completed,
      path: completed?.progress?.resultPath || null,
      error: completed?.lastError || null
    };
  }
  return { ok: true, queued: true, job };
});

ipcMain.handle('sources:listConnectors', async () => {
  const state = loadState();
  const sourceState = loadSourcesState();
  const addon = listAvailablePlugins(state).find((plugin) => plugin.id === SOURCE_PLUGIN_ID);
  if (addon?.installed && addon?.enabled) {
    await startSourceRuntime();
  }
  return {
    connectors: listSourceConnectors(state),
    runtime: getSourceRuntimeStatus(),
    lastConnectorId: sourceState.lastConnectorId || '',
    lastCategoryId: sourceState.lastCategoryId || ''
  };
});

ipcMain.handle('sources:getRuntimeStatus', async () => ({
  ok: true,
  runtime: getSourceRuntimeStatus()
}));

ipcMain.handle('sources:startRuntime', async () => ({
  ok: true,
  runtime: (await startSourceRuntime()).runtime
}));

ipcMain.handle('sources:stopRuntime', async () => ({
  ok: true,
  runtime: await stopSourceRuntime()
}));

ipcMain.handle('sources:resetRuntimeCache', async () => ({
  ok: true,
  ...(await resetSourceRuntimeCache())
}));

ipcMain.handle('sources:listRepositories', async () => ({
  ok: true,
  repositories: listSourceRepositories(),
  runtime: getSourceRuntimeStatus()
}));

ipcMain.handle('sources:addRepository', async (_event, input = {}) => {
  try {
    const result = addSourceRepository(input);
    return {
      ok: true,
      ...result,
      repositories: listSourceRepositories(),
      extensions: listSourceExtensions(),
      runtime: getSourceRuntimeStatus()
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Depot impossible a ajouter.',
      repositories: listSourceRepositories(),
      extensions: listSourceExtensions(),
      runtime: getSourceRuntimeStatus()
    };
  }
});

ipcMain.handle('sources:removeRepository', async (_event, repositoryId) => {
  try {
    const result = removeSourceRepository(repositoryId);
    return {
      ok: true,
      ...result,
      repositories: listSourceRepositories(),
      extensions: listSourceExtensions(),
      runtime: getSourceRuntimeStatus()
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Depot introuvable.',
      repositories: listSourceRepositories(),
      extensions: listSourceExtensions(),
      runtime: getSourceRuntimeStatus()
    };
  }
});

ipcMain.handle('sources:syncRepositories', async () => {
  try {
    return {
      ...(await syncSourceRepositories()),
      ok: true
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Sync impossible.',
      repositories: listSourceRepositories(),
      extensions: listSourceExtensions(),
      runtime: getSourceRuntimeStatus()
    };
  }
});

ipcMain.handle('sources:listExtensions', async () => ({
  ok: true,
  extensions: listSourceExtensions(),
  runtime: getSourceRuntimeStatus()
}));

ipcMain.handle('sources:installExtension', async (_event, extensionId) => {
  try {
    const result = await installSourceExtension(extensionId);
    return {
      ok: true,
      ...result,
      extensions: listSourceExtensions(),
      connectors: listSourceConnectors(loadState()),
      runtime: getSourceRuntimeStatus()
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Installation impossible.',
      extensions: listSourceExtensions(),
      connectors: listSourceConnectors(loadState()),
      runtime: getSourceRuntimeStatus()
    };
  }
});

ipcMain.handle('sources:updateExtension', async (_event, extensionId) => {
  try {
    const result = await updateSourceExtension(extensionId);
    return {
      ok: true,
      ...result,
      extensions: listSourceExtensions(),
      connectors: listSourceConnectors(loadState()),
      runtime: getSourceRuntimeStatus()
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Mise a jour impossible.',
      extensions: listSourceExtensions(),
      connectors: listSourceConnectors(loadState()),
      runtime: getSourceRuntimeStatus()
    };
  }
});

ipcMain.handle('sources:uninstallExtension', async (_event, extensionId) => {
  try {
    const result = await uninstallSourceExtension(extensionId);
    return {
      ok: true,
      ...result,
      extensions: listSourceExtensions(),
      connectors: listSourceConnectors(loadState()),
      runtime: getSourceRuntimeStatus()
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Retrait impossible.',
      extensions: listSourceExtensions(),
      connectors: listSourceConnectors(loadState()),
      runtime: getSourceRuntimeStatus()
    };
  }
});

ipcMain.handle('sources:setExtensionEnabled', async (_event, extensionId, enabled) => {
  try {
    const result = setSourceExtensionEnabled(extensionId, enabled);
    return {
      ok: true,
      ...result,
      extensions: listSourceExtensions(),
      connectors: listSourceConnectors(loadState()),
      runtime: getSourceRuntimeStatus()
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Activation impossible.',
      extensions: listSourceExtensions(),
      connectors: listSourceConnectors(loadState()),
      runtime: getSourceRuntimeStatus()
    };
  }
});

ipcMain.handle('sources:getConnectorPrefs', async (_event, connectorId) => {
  try {
    return {
      ok: true,
      ...(await getSourceConnectorPrefs({
        state: loadState(),
        connectorId
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Preferences source introuvables.',
      fields: [],
      values: {}
    };
  }
});

ipcMain.handle('sources:setConnectorPrefs', async (_event, input = {}) => {
  try {
    return {
      ok: true,
      ...(await setSourceConnectorPrefs({
        state: loadState(),
        connectorId: input?.connectorId,
        values: input?.values || {}
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Preferences source impossibles a enregistrer.'
    };
  }
});

ipcMain.handle('sources:searchSeries', async (_event, input = {}) => {
  try {
    const state = loadState();
    return {
      ok: true,
      results: await searchSourceSeries({
        state,
        connectorId: input?.connectorId,
        query: input?.query,
        limit: input?.limit
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Recherche web impossible.',
      results: []
    };
  }
});

ipcMain.handle('sources:getSeries', async (_event, input = {}) => {
  try {
    const state = loadState();
    return {
      ok: true,
      series: await getSourceSeries({
        state,
        connectorId: input?.connectorId,
        seriesId: input?.seriesId
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Serie introuvable.',
      series: null
    };
  }
});

ipcMain.handle('sources:getChapters', async (_event, input = {}) => {
  try {
    const state = loadState();
    return {
      ok: true,
      chapters: await getSourceChapters({
        state,
        connectorId: input?.connectorId,
        seriesId: input?.seriesId
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Chapitres introuvables.',
      chapters: []
    };
  }
});

ipcMain.handle('sources:listLinkedSeries', async () => ({
  ok: true,
  series: listLinkedSeries()
}));

ipcMain.handle('sources:getSeriesContextForManga', async (_event, input = {}) => {
  try {
    return {
      ok: true,
      ...(await getSeriesContextForManga({
        state: loadState(),
        manga: input?.manga || input
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Serie web introuvable pour ce manga.'
    };
  }
});

ipcMain.handle('sources:getSeriesChaptersForManga', async (_event, input = {}) => {
  try {
    return {
      ok: true,
      ...(await getSeriesChaptersForManga({
        state: loadState(),
        manga: input?.manga || input
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Impossible de charger les chapitres web.',
      chapters: []
    };
  }
});

ipcMain.handle('sources:checkUpdatesForManga', async (_event, input = {}) => {
  try {
    return {
      ok: true,
      ...(await checkSourceUpdatesForManga({
        state: loadState(),
        manga: input?.manga || input
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Verification des mises a jour impossible.'
    };
  }
});

ipcMain.handle('sources:openSeriesContext', async (_event, input = {}) => {
  try {
    return {
      ok: true,
      ...(await getSeriesContextForManga({
        state: loadState(),
        manga: input?.manga || input
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Ouverture de la serie web impossible.'
    };
  }
});

ipcMain.handle('sources:enqueueImport', async (_event, input = {}) => {
  try {
    const state = loadState();
    const connectors = listSourceConnectors(state);
    const connector = connectors.find((entry) => entry.id === String(input?.connectorId || '').trim());
    if (!connector) {
      return {
        ok: false,
        error: 'Installe et active une extension source compatible.',
        imports: listSourceImportJobs()
      };
    }

    const category = resolveSourceImportCategory(input?.destinationCategoryId);
    if (!category?.id || !category?.path) {
      return {
        ok: false,
        error: 'Choisis une categorie de destination valide.',
        imports: listSourceImportJobs()
      };
    }

    const series = await getSourceSeries({
      state,
      connectorId: connector.id,
      seriesId: input?.seriesId
    });

    const job = enqueueSourceImportJob({
      repoId: connector.repoId,
      extensionId: connector.extensionId,
      connectorId: connector.id,
      connectorName: connector.displayName,
      sourceId: connector.sourceId,
      seriesId: input?.seriesId,
      seriesTitle: series?.title || 'Import web',
      destinationCategoryId: category.id,
      categoryName: category.name,
      chapterIds: input?.chapterIds
    });
    markSourceRuntimeSelection({
      connectorId: connector.id,
      categoryId: category.id
    });

    return {
      ok: true,
      job: serializeSourceImportJob(job),
      imports: listSourceImportJobs()
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Import web impossible.',
      imports: listSourceImportJobs()
    };
  }
});

ipcMain.handle('sources:listImports', async () => ({
  ok: true,
  imports: listSourceImportJobs()
}));

ipcMain.handle('sources:cancelImport', async (_event, jobId) => {
  const normalizedId = String(jobId || '').trim();
  const job = getJob(normalizedId);
  if (!job) {
    return { ok: false, error: 'Import introuvable.', imports: listSourceImportJobs() };
  }

  jobOrchestrator.cancel(normalizedId);
  jobOrchestrator.schedule();

  return {
    ok: true,
    imports: listSourceImportJobs()
  };
});

ipcMain.handle('plugins:list', async () => {
  const state = loadState();
  return {
    plugins: listAvailablePlugins(state)
  };
});

ipcMain.handle('plugins:setEnabled', async (_event, pluginId, enabled) => {
  const normalizedId = String(pluginId || '').trim();
  if (!normalizedId) {
    return { ok: false, error: 'Plugin introuvable.', plugins: listAvailablePlugins(loadState()) };
  }
  const before = listAvailablePlugins(loadState());
  const targetPlugin = before.find((plugin) => plugin.id === normalizedId);
  if (!targetPlugin) {
    return { ok: false, error: 'Plugin introuvable.', plugins: before };
  }
  if (!targetPlugin.installed) {
    return { ok: false, error: 'Installe ce plugin avant de l activer.', plugins: before };
  }

  updateState((state) => {
    state.plugins = state.plugins || {};
    state.plugins.enabled = state.plugins.enabled || {};
    state.plugins.enabled[normalizedId] = Boolean(enabled);
    return state;
  });

  if (normalizedId === SOURCE_PLUGIN_ID) {
    if (enabled) await startSourceRuntime();
    else await stopSourceRuntime();
  }

  return {
    ok: true,
    pluginId: normalizedId,
    enabled: Boolean(enabled),
    plugins: listAvailablePlugins(loadState())
  };
});

ipcMain.handle('plugins:install', async (_event, pluginId) => {
  const normalizedId = String(pluginId || '').trim();
  if (!normalizedId) {
    return { ok: false, error: 'Plugin introuvable.', plugins: listAvailablePlugins(loadState()) };
  }

  try {
    const plugin = await installPlugin(normalizedId);
    updateState((state) => {
      state.plugins = state.plugins || {};
      state.plugins.enabled = state.plugins.enabled || {};
      if (state.plugins.enabled[normalizedId] === undefined) {
        state.plugins.enabled[normalizedId] = false;
      }
      return state;
    });

    return {
      ok: true,
      plugin,
      plugins: listAvailablePlugins(loadState())
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Installation du plugin impossible.',
      plugins: listAvailablePlugins(loadState())
    };
  }
});

ipcMain.handle('plugins:uninstall', async (_event, pluginId) => {
  const normalizedId = String(pluginId || '').trim();
  if (!normalizedId) {
    return { ok: false, error: 'Plugin introuvable.', plugins: listAvailablePlugins(loadState()) };
  }

  try {
    const result = uninstallPlugin(normalizedId);
    updateState((state) => {
      state.plugins = state.plugins || {};
      state.plugins.enabled = state.plugins.enabled || {};
      state.plugins.enabled[normalizedId] = false;
      return state;
    });
    if (normalizedId === SOURCE_PLUGIN_ID) {
      await stopSourceRuntime();
    }

    return {
      ok: true,
      removed: Boolean(result?.removed),
      plugins: listAvailablePlugins(loadState())
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Desinstallation du plugin impossible.',
      plugins: listAvailablePlugins(loadState())
    };
  }
});

ipcMain.handle('plugins:open', async (_event, pluginId) => {
  const normalizedId = String(pluginId || '').trim();
  if (!normalizedId) {
    return { ok: false, error: 'Plugin introuvable.', plugins: listAvailablePlugins(loadState()) };
  }

  try {
    const launch = openPlugin(normalizedId);
    return {
      ok: true,
      launch,
      plugins: listAvailablePlugins(loadState())
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Lancement du plugin impossible.',
      plugins: listAvailablePlugins(loadState())
    };
  }
});

