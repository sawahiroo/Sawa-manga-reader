const fs = require('fs');
const path = require('path');

const { getUserDataStoreDir, getCacheDir } = require('./storage.cjs');
const { createAtomicJsonPersistence } = require('./atomicJsonPersistence.cjs');
const suwayomiRuntime = require('./suwayomiRuntime.cjs');

const SOURCE_PLUGIN_ID = 'sources-web';
const SOURCE_STORE_VERSION = 1;
const RUNTIME_KIND = suwayomiRuntime.RUNTIME_KIND;
const RUNTIME_VERSION = suwayomiRuntime.RUNTIME_VERSION;
const BUNDLED_REPOSITORY_ID = 'sawa-official';
const BUNDLED_REPOSITORY_URL = 'sawa://catalog/official';
const DEFAULT_EXTENSION_ID = 'sawa.mangadex';
const SUPPORTED_ADAPTER_IDS = new Set(['mangadex']);
const SOURCE_PROVENANCE_FILENAME = 'sawa-source.json';
const LEGACY_EXTENSION_SOURCE_ERRORS = new Set([
  'Extension sans source exploitable.',
  'Les sources seront confirmees apres installation par le runtime local.',
  'Le runtime local n a pas encore confirme cette extension.',
  'Extension installee - sources en attente du runtime local.'
]);

const DEFAULT_SOURCE_STATE = Object.freeze({
  version: SOURCE_STORE_VERSION,
  runtime: {
    kind: RUNTIME_KIND,
    version: RUNTIME_VERSION,
    state: 'stopped',
    healthy: false,
    port: null,
    startedAt: null,
    lastError: '',
    needsAttention: false,
    lastSyncAt: null
  },
  repositories: [],
  extensions: [],
  connectorPrefs: {},
  lastConnectorId: '',
  lastCategoryId: '',
  importHistory: [],
  seriesLinks: [],
  recentSeries: [],
  pinnedConnectors: []
});
const sourcePersistence = createAtomicJsonPersistence({ maxConcurrent: 1 });
let cachedSourcesPath = '';
let cachedSourcesState = null;
let cachedSourcesJson = '';
let queuedSourcesJson = '';

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function normalizeString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return Boolean(value);
}

function normalizeInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function normalizePathString(value) {
  return String(value || '')
    .replace(/\//g, '\\')
    .replace(/\\+/g, '\\')
    .trim()
    .replace(/[\\ ]+$/g, '')
    .toLowerCase();
}

function isLegacySourceAvailabilityError(value) {
  return LEGACY_EXTENSION_SOURCE_ERRORS.has(normalizeString(value));
}

function resolveSourceAvailabilityError({ packageName = '', connectors = [], installed = false }) {
  if (Array.isArray(connectors) && connectors.length > 0) return '';
  if (normalizeString(packageName)) {
    return installed
      ? 'Extension installee - sources en attente du runtime local.'
      : 'Les sources seront confirmees apres installation par le runtime local.';
  }
  return 'Extension sans source exploitable.';
}

function tryParseUrl(value) {
  try {
    return new URL(value);
  } catch (_error) {
    return null;
  }
}

function resolveAbsoluteUrl(baseUrl, target) {
  const normalizedTarget = normalizeString(target);
  if (!normalizedTarget) return '';
  if (!baseUrl) return normalizedTarget;
  try {
    return new URL(normalizedTarget, baseUrl).toString();
  } catch (_error) {
    return normalizedTarget;
  }
}

function ensureTrailingSlash(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function normalizeHost(value) {
  const parsed = tryParseUrl(value);
  return parsed ? parsed.hostname.replace(/^www\./i, '').toLowerCase() : '';
}

function stripExtensionDisplayPrefix(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return normalized.replace(/^(tachiyomi|mihon)\s*:\s*/i, '').trim() || normalized;
}

function normalizeRepositoryInputUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';

  if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(normalized)) {
    return `https://raw.githubusercontent.com/${normalized}/repo/index.min.json`;
  }

  const githubBlobMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (githubBlobMatch) {
    const [, owner, repo, branch, filePath] = githubBlobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  const githubRawMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/i);
  if (githubRawMatch) {
    const [, owner, repo, branch, filePath] = githubRawMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  return normalized;
}

function buildRepositoryTargets(repositoryUrl) {
  const normalizedUrl = normalizeRepositoryInputUrl(repositoryUrl);
  const parsed = tryParseUrl(normalizedUrl);
  if (!parsed) {
    return {
      repositoryUrl: normalizedUrl,
      catalogCandidates: normalizedUrl ? [normalizedUrl] : [],
      metaCandidates: []
    };
  }

  const pathname = parsed.pathname || '';
  const directoryUrl = ensureTrailingSlash(normalizedUrl.replace(/[^/]*$/, ''));

  if (pathname.endsWith('/repo.json')) {
    return {
      repositoryUrl: normalizedUrl,
      catalogCandidates: [
        resolveAbsoluteUrl(normalizedUrl, './index.min.json'),
        resolveAbsoluteUrl(normalizedUrl, './index.json')
      ],
      metaCandidates: [normalizedUrl]
    };
  }

  if (pathname.endsWith('/index.min.json') || pathname.endsWith('/index.json')) {
    return {
      repositoryUrl: normalizedUrl,
      catalogCandidates: [normalizedUrl],
      metaCandidates: [resolveAbsoluteUrl(directoryUrl, './repo.json')]
    };
  }

  return {
    repositoryUrl: normalizedUrl,
    catalogCandidates: [
      resolveAbsoluteUrl(directoryUrl, './index.min.json'),
      resolveAbsoluteUrl(directoryUrl, './index.json')
    ],
    metaCandidates: [resolveAbsoluteUrl(directoryUrl, './repo.json')]
  };
}

async function tryFetchJson(url) {
  const normalizedUrl = normalizeString(url);
  if (!normalizedUrl) return null;
  try {
    return await fetchJson(normalizedUrl);
  } catch (_error) {
    return null;
  }
}

function deriveAdapterIdFromSource({ name = '', packageName = '', baseUrl = '' } = {}) {
  const tokens = [
    normalizeString(name).toLowerCase(),
    normalizeString(packageName).toLowerCase(),
    normalizeHost(baseUrl)
  ].filter(Boolean).join(' ');

  if (tokens.includes('mangadex')) {
    return 'mangadex';
  }

  return '';
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function getSourcesStatePath() {
  return path.join(getUserDataStoreDir(), 'sources.json');
}

function getSourceRuntimeCacheDir() {
  return ensureDir(path.join(getCacheDir(), 'source-runtime'));
}

function getSourceRuntimeImportsDir() {
  return ensureDir(path.join(getSourceRuntimeCacheDir(), 'imports'));
}

function getBundledExtensionCatalog() {
  return [
    {
      id: DEFAULT_EXTENSION_ID,
      repoId: BUNDLED_REPOSITORY_ID,
      packageName: 'app.sawa.compat.mangadex',
      displayName: 'MangaDex',
      version: '1.0.0',
      adapterId: 'mangadex',
      languages: ['fr', 'en'],
      nsfw: false,
      needsConfig: false,
      needsWebView: false,
      status: 'available',
      error: '',
      connectors: [
        {
          sourceId: 'mangadex',
          displayName: 'MangaDex',
          language: 'multi',
          mediaKind: 'manga',
          adapterId: 'mangadex',
          runtimeKind: 'native',
          supportsLatest: true
        }
      ]
    }
  ];
}

function makeBundledRepository(lastSyncedAt = '') {
  return normalizeRepository({
    id: BUNDLED_REPOSITORY_ID,
    name: 'Catalogue officiel integre',
    url: BUNDLED_REPOSITORY_URL,
    enabled: true,
    trusted: true,
    bundled: true,
    locked: true,
    lastSyncedAt: normalizeString(lastSyncedAt),
    status: 'ready',
    error: '',
    catalog: getBundledExtensionCatalog()
  });
}

function normalizeConnectorDefinition(input = {}, fallback = {}) {
  const sourceId = normalizeString(input.sourceId || fallback.sourceId);
  if (!sourceId) return null;
  const adapterId = normalizeString(input.adapterId, normalizeString(fallback.adapterId));
  const runtimeKind = normalizeString(
    input.runtimeKind,
    normalizeString(
      fallback.runtimeKind,
      adapterId && SUPPORTED_ADAPTER_IDS.has(adapterId) ? 'native' : 'suwayomi'
    )
  );
  return {
    sourceId,
    displayName: normalizeString(input.displayName, normalizeString(fallback.displayName, sourceId)),
    language: normalizeString(input.language, normalizeString(fallback.language, 'multi')),
    mediaKind: normalizeString(input.mediaKind, normalizeString(fallback.mediaKind, 'manga')),
    baseUrl: normalizeString(input.baseUrl, normalizeString(fallback.baseUrl)),
    versionId: normalizeInteger(input.versionId, normalizeInteger(fallback.versionId)),
    adapterId,
    runtimeKind,
    iconUrl: normalizeString(input.iconUrl, normalizeString(fallback.iconUrl)),
    isConfigurable: normalizeBoolean(input.isConfigurable, normalizeBoolean(fallback.isConfigurable, false)),
    supportsLatest: normalizeBoolean(input.supportsLatest, normalizeBoolean(fallback.supportsLatest, false))
  };
}

function getSeriesProvenancePath(seriesPath = '') {
  const normalized = normalizeString(seriesPath);
  if (!normalized) return '';
  return path.join(normalized, SOURCE_PROVENANCE_FILENAME);
}

function readSeriesProvenanceForManga(manga = {}) {
  const provenancePath = getSeriesProvenancePath(manga?.path);
  if (!provenancePath || !fs.existsSync(provenancePath)) return null;
  const provenance = readJsonSafe(provenancePath, null);
  if (!provenance || typeof provenance !== 'object') return null;
  if (normalizeString(provenance.pluginId, SOURCE_PLUGIN_ID) !== SOURCE_PLUGIN_ID) return null;
  return provenance;
}

function mergeSeriesLinkChapterState(current = {}, next = {}) {
  const safeCurrent = current && typeof current === 'object' ? current : {};
  const safeNext = next && typeof next === 'object' ? next : {};
  const currentImported = Array.isArray(safeCurrent.importedChapterIds) ? safeCurrent.importedChapterIds : [];
  const nextImported = Array.isArray(safeNext.importedChapterIds) ? safeNext.importedChapterIds : [];
  const currentKnown = Array.isArray(safeCurrent.lastKnownChapterIds) ? safeCurrent.lastKnownChapterIds : [];
  const nextKnown = Array.isArray(safeNext.lastKnownChapterIds) ? safeNext.lastKnownChapterIds : [];
  return {
    importedChapterIds: uniqueStrings([...currentImported, ...nextImported]),
    lastKnownChapterIds: uniqueStrings([...currentKnown, ...nextKnown, ...nextImported])
  };
}

function findSeriesLinkIndex(entries = [], candidate = {}) {
  const normalizedContentId = normalizeString(candidate.localContentId);
  const normalizedMangaId = normalizeString(candidate.localMangaId);
  const normalizedSeriesPath = normalizePathString(candidate.localSeriesPath);
  return (Array.isArray(entries) ? entries : []).findIndex((entry) => {
    if (normalizedContentId && entry.localContentId === normalizedContentId) return true;
    if (normalizedMangaId && entry.localMangaId === normalizedMangaId) return true;
    if (normalizedSeriesPath && normalizePathString(entry.localSeriesPath) === normalizedSeriesPath) return true;
    return (
      entry.connectorId === candidate.connectorId
      && entry.seriesId === candidate.seriesId
      && normalizeString(entry.destinationCategoryId) === normalizeString(candidate.destinationCategoryId)
    );
  });
}

function upsertDraftSeriesLink(draft, linkInput = {}, options = {}) {
  const normalized = normalizeSeriesLink(linkInput);
  if (!normalized) return;
  const linkIndex = findSeriesLinkIndex(draft.seriesLinks, normalized);
  const current = linkIndex >= 0 ? draft.seriesLinks[linkIndex] : null;
  const chapterState = mergeSeriesLinkChapterState(current, normalized);
  const merged = normalizeSeriesLink({
    ...(current || {}),
    ...normalized,
    ...chapterState,
    sourceLabel: normalizeString(normalized.sourceLabel, normalizeString(current?.sourceLabel, 'Source web')),
    updatedAt: options.touch === false
      ? normalizeString(normalized.updatedAt, current?.updatedAt)
      : nowIso()
  });
  if (!merged) return;
  if (linkIndex >= 0) {
    draft.seriesLinks[linkIndex] = merged;
    return;
  }
  draft.seriesLinks.push(merged);
}

function buildSeriesLinkFromProvenance(manga = {}, existingLink = null) {
  const provenance = readSeriesProvenanceForManga(manga);
  if (!provenance) return null;

  const chapterEntries = Array.isArray(provenance.chapters) ? provenance.chapters : [];
  const importedChapterIds = uniqueStrings(chapterEntries.map((entry) => entry?.chapterId));
  const lastImportedAt = chapterEntries
    .map((entry) => normalizeString(entry?.importedAt))
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0];

  return normalizeSeriesLink({
    ...(existingLink || {}),
    localContentId: normalizeString(manga.contentId, existingLink?.localContentId),
    localMangaId: normalizeString(manga.id, existingLink?.localMangaId),
    localSeriesPath: normalizeString(manga.path, existingLink?.localSeriesPath),
    destinationCategoryId: normalizeString(
      manga.categoryId || manga.category?.id || manga.categoryIds?.[0],
      existingLink?.destinationCategoryId
    ),
    repoId: normalizeString(provenance.repoId, existingLink?.repoId),
    extensionId: normalizeString(provenance.extensionId, existingLink?.extensionId),
    connectorId: normalizeString(provenance.connectorId, existingLink?.connectorId),
    sourceId: normalizeString(provenance.sourceId, existingLink?.sourceId),
    seriesId: normalizeString(provenance.seriesId, existingLink?.seriesId),
    seriesTitle: normalizeString(provenance.title, normalizeString(existingLink?.seriesTitle, manga.displayTitle || manga.name)),
    sourceLabel: normalizeString(
      provenance.sourceLabel,
      normalizeString(existingLink?.sourceLabel, 'Source web')
    ),
    coverUrl: normalizeString(provenance.coverUrl, existingLink?.coverUrl),
    lastImportedAt: normalizeString(lastImportedAt, normalizeString(existingLink?.lastImportedAt, provenance.updatedAt)),
    importedChapterIds: uniqueStrings([
      ...(existingLink?.importedChapterIds || []),
      ...importedChapterIds
    ]),
    lastKnownChapterIds: uniqueStrings([
      ...(existingLink?.lastKnownChapterIds || []),
      ...importedChapterIds
    ]),
    lastCheckedAt: normalizeString(existingLink?.lastCheckedAt, provenance.updatedAt),
    updatedAt: normalizeString(existingLink?.updatedAt, provenance.updatedAt)
  });
}

function collectNormalizedPathAncestors(value) {
  const normalized = normalizePathString(value);
  if (!normalized) return [];
  const ancestors = [];
  let current = normalized;
  while (current) {
    ancestors.push(current);
    const parent = current.replace(/\\[^\\]+$/, '');
    if (!parent || parent === current || /^[a-z]:$/i.test(parent)) break;
    current = parent;
  }
  return ancestors;
}

function buildImportHistoryPathIndex(importHistory = []) {
  const index = new Map();
  (Array.isArray(importHistory) ? importHistory : []).forEach((record) => {
    collectNormalizedPathAncestors(record?.localPath).forEach((candidatePath) => {
      const records = index.get(candidatePath) || [];
      records.push(record);
      index.set(candidatePath, records);
    });
  });
  return index;
}

function buildSeriesLinkFromImportHistory(manga = {}, existingLink = null, importHistory = [], pathIndex = null) {
  const normalizedSeriesPath = normalizePathString(manga?.path);
  if (!normalizedSeriesPath) return null;

  const matchingRecords = pathIndex instanceof Map
    ? [...new Set(pathIndex.get(normalizedSeriesPath) || [])]
    : (Array.isArray(importHistory) ? importHistory : []).filter((record) => {
        const localPath = normalizePathString(record?.localPath);
        if (!localPath) return false;
        return (
          localPath === normalizedSeriesPath
          || localPath.startsWith(`${normalizedSeriesPath}\\`)
          || normalizedSeriesPath.startsWith(`${localPath}\\`)
        );
      });

  if (!matchingRecords.length) return null;

  const grouped = new Map();
  matchingRecords.forEach((record) => {
    const connectorId = normalizeString(record.connectorId);
    const seriesId = normalizeString(record.seriesId);
    if (!connectorId || !seriesId) return;
    const destinationCategoryId = normalizeString(record.destinationCategoryId);
    const key = `${connectorId}::${seriesId}::${destinationCategoryId}`;
    const current = grouped.get(key) || {
      connectorId,
      seriesId,
      destinationCategoryId,
      repoId: normalizeString(record.repoId),
      extensionId: normalizeString(record.extensionId),
      sourceId: normalizeString(record.sourceId),
      importedChapterIds: [],
      lastImportedAt: ''
    };
    current.importedChapterIds.push(normalizeString(record.chapterId));
    const importedAt = normalizeString(record.importedAt);
    if (importedAt && (!current.lastImportedAt || importedAt.localeCompare(current.lastImportedAt) > 0)) {
      current.lastImportedAt = importedAt;
    }
    grouped.set(key, current);
  });

  const bestGroup = [...grouped.values()]
    .sort((left, right) => {
      const diff = right.importedChapterIds.length - left.importedChapterIds.length;
      if (diff !== 0) return diff;
      return String(right.lastImportedAt || '').localeCompare(String(left.lastImportedAt || ''));
    })[0];

  if (!bestGroup?.connectorId || !bestGroup?.seriesId) return null;

  const connector = resolveConnector(bestGroup.connectorId, { ui: { allowNsfwSources: true } });

  return normalizeSeriesLink({
    ...(existingLink || {}),
    localContentId: normalizeString(manga.contentId, existingLink?.localContentId),
    localMangaId: normalizeString(manga.id, existingLink?.localMangaId),
    localSeriesPath: normalizeString(manga.path, existingLink?.localSeriesPath),
    destinationCategoryId: normalizeString(
      manga.categoryId || manga.category?.id || manga.categoryIds?.[0],
      normalizeString(bestGroup.destinationCategoryId, existingLink?.destinationCategoryId)
    ),
    repoId: normalizeString(bestGroup.repoId, existingLink?.repoId),
    extensionId: normalizeString(bestGroup.extensionId, existingLink?.extensionId),
    connectorId: bestGroup.connectorId,
    sourceId: normalizeString(bestGroup.sourceId, existingLink?.sourceId),
    seriesId: bestGroup.seriesId,
    seriesTitle: normalizeString(existingLink?.seriesTitle, manga.displayTitle || manga.name),
    sourceLabel: normalizeString(
      existingLink?.sourceLabel,
      normalizeString(connector?.displayName, 'Source web')
    ),
    coverUrl: normalizeString(existingLink?.coverUrl),
    lastImportedAt: normalizeString(bestGroup.lastImportedAt, normalizeString(existingLink?.lastImportedAt, nowIso())),
    importedChapterIds: uniqueStrings([
      ...(existingLink?.importedChapterIds || []),
      ...(bestGroup.importedChapterIds || [])
    ]),
    lastKnownChapterIds: uniqueStrings([
      ...(existingLink?.lastKnownChapterIds || []),
      ...(bestGroup.importedChapterIds || [])
    ]),
    lastCheckedAt: normalizeString(existingLink?.lastCheckedAt)
  });
}

function inferExtensionRuntimeKind({
  input = {},
  fallback = {},
  connectors = [],
  adapterId = '',
  packageName = ''
} = {}) {
  const explicit = normalizeString(input.runtimeKind, normalizeString(fallback.runtimeKind));
  if (explicit) return explicit;
  if (connectors.some((connector) => connector.runtimeKind === 'suwayomi')) {
    return 'suwayomi';
  }
  if (adapterId && SUPPORTED_ADAPTER_IDS.has(adapterId)) {
    return 'native';
  }
  if (packageName) {
    return 'suwayomi';
  }
  return 'native';
}

function shouldDeferRuntimeSources({
  runtimeKind = '',
  packageName = '',
  connectors = [],
  installed = false
} = {}) {
  return runtimeKind === 'suwayomi'
    && Boolean(packageName)
    && connectors.length === 0
    && !installed;
}

function normalizeExtensionCatalogEntry(input = {}, fallback = {}) {
  const id = normalizeString(input.id || fallback.id);
  if (!id) return null;
  const packageName = normalizeString(input.packageName || fallback.packageName, id);

  const connectors = (Array.isArray(input.connectors) ? input.connectors : fallback.connectors || [])
    .map((connector) => normalizeConnectorDefinition(connector))
    .filter(Boolean);
  const compatibleSourceCount = connectors.filter(
    (connector) => connector.runtimeKind === 'suwayomi' || (connector.adapterId && SUPPORTED_ADAPTER_IDS.has(connector.adapterId))
  ).length;
  const adapterId = normalizeString(
    input.adapterId
    || fallback.adapterId
    || connectors.find((connector) => connector.adapterId && SUPPORTED_ADAPTER_IDS.has(connector.adapterId))?.adapterId
    || connectors[0]?.adapterId
  );
  const runtimeKind = inferExtensionRuntimeKind({
    input,
    fallback,
    connectors,
    adapterId,
    packageName
  });
  const sourcesDeferred = normalizeBoolean(
    input.sourcesDeferred,
    normalizeBoolean(
      fallback.sourcesDeferred,
      shouldDeferRuntimeSources({
        runtimeKind,
        packageName,
        connectors
      })
    )
  );
  const hasRuntimeInstallMetadata = Boolean(packageName);
  const isExtensionCompatible = compatibleSourceCount > 0 || (adapterId && SUPPORTED_ADAPTER_IDS.has(adapterId)) || sourcesDeferred;
  const availabilityError = sourcesDeferred
    ? ''
    : isExtensionCompatible
    ? ''
    : connectors.length > 0
      ? 'Le runtime local n a pas encore confirme cette extension.'
      : resolveSourceAvailabilityError({
          packageName,
          connectors,
          installed: false
        });
  const derivedStatus = sourcesDeferred
    ? normalizeString(input.status, normalizeString(fallback.status, 'installable'))
    : !isExtensionCompatible && !hasRuntimeInstallMetadata
    ? 'incompatible'
    : normalizeString(input.status, normalizeString(fallback.status, 'available'));

  return {
    id,
    repoId: normalizeString(input.repoId || fallback.repoId),
    packageName,
    displayName: normalizeString(input.displayName, normalizeString(fallback.displayName, id)),
    version: normalizeString(input.version, normalizeString(fallback.version, '0.0.0')),
    versionCode: normalizeInteger(input.versionCode ?? input.code, normalizeInteger(fallback.versionCode ?? fallback.code)),
    apkUrl: normalizeString(input.apkUrl || input.apk, normalizeString(fallback.apkUrl || fallback.apk)),
    adapterId,
    runtimeKind,
    iconUrl: normalizeString(input.iconUrl, normalizeString(fallback.iconUrl)),
    languages: uniqueStrings(input.languages || fallback.languages),
    nsfw: normalizeBoolean(input.nsfw, normalizeBoolean(fallback.nsfw, false)),
    needsConfig: normalizeBoolean(input.needsConfig, normalizeBoolean(fallback.needsConfig, false)),
    needsWebView: normalizeBoolean(input.needsWebView, normalizeBoolean(fallback.needsWebView, false)),
    status: derivedStatus,
    error: availabilityError || normalizeString(input.error, normalizeString(fallback.error)),
    sourcesDeferred,
    connectors,
    sourceCount: connectors.length,
    compatibleSourceCount
  };
}

function normalizeRepository(input = {}, fallback = {}) {
  const id = normalizeString(input.id || fallback.id);
  if (!id) return null;

  return {
    id,
    name: normalizeString(input.name, normalizeString(fallback.name, id)),
    url: normalizeString(input.url, normalizeString(fallback.url)),
    enabled: normalizeBoolean(input.enabled, normalizeBoolean(fallback.enabled, true)),
    trusted: normalizeBoolean(input.trusted, normalizeBoolean(fallback.trusted, false)),
    bundled: normalizeBoolean(input.bundled, normalizeBoolean(fallback.bundled, false)),
    locked: normalizeBoolean(input.locked, normalizeBoolean(fallback.locked, false)),
    catalogUrl: normalizeString(input.catalogUrl, normalizeString(fallback.catalogUrl)),
    baseUrl: normalizeString(input.baseUrl, normalizeString(fallback.baseUrl)),
    lastSyncedAt: normalizeString(input.lastSyncedAt, normalizeString(fallback.lastSyncedAt)),
    status: normalizeString(input.status, normalizeString(fallback.status, 'idle')),
    error: normalizeString(input.error, normalizeString(fallback.error)),
    catalog: (Array.isArray(input.catalog) ? input.catalog : fallback.catalog || [])
      .map((entry) => normalizeExtensionCatalogEntry(entry, { repoId: id }))
      .filter(Boolean)
  };
}

function normalizeInstalledExtension(input = {}, fallback = {}) {
  const id = normalizeString(input.id || fallback.id);
  if (!id) return null;
  const packageName = normalizeString(input.packageName || fallback.packageName, id);
  const connectors = (Array.isArray(input.connectors) ? input.connectors : fallback.connectors || [])
    .map((connector) => normalizeConnectorDefinition(connector))
    .filter(Boolean);
  const installed = normalizeBoolean(input.installed, normalizeBoolean(fallback.installed, true));
  const adapterId = normalizeString(input.adapterId || fallback.adapterId);
  const runtimeKind = inferExtensionRuntimeKind({
    input,
    fallback,
    connectors,
    adapterId,
    packageName
  });
  const sourcesDeferred = normalizeBoolean(
    input.sourcesDeferred,
    normalizeBoolean(
      fallback.sourcesDeferred,
      shouldDeferRuntimeSources({
        runtimeKind,
        packageName,
        connectors,
        installed
      })
    )
  );
  const rawError = normalizeString(input.error, normalizeString(fallback.error));
  const availabilityError = sourcesDeferred
    ? ''
    : resolveSourceAvailabilityError({
        packageName,
        connectors,
        installed
      });
  return {
    id,
    repoId: normalizeString(input.repoId || fallback.repoId),
    packageName,
    displayName: normalizeString(input.displayName, normalizeString(fallback.displayName, id)),
    version: normalizeString(input.version, normalizeString(fallback.version, '0.0.0')),
    versionCode: normalizeInteger(input.versionCode ?? input.code, normalizeInteger(fallback.versionCode ?? fallback.code)),
    apkUrl: normalizeString(input.apkUrl || input.apk, normalizeString(fallback.apkUrl || fallback.apk)),
    adapterId,
    runtimeKind,
    iconUrl: normalizeString(input.iconUrl, normalizeString(fallback.iconUrl)),
    languages: uniqueStrings(input.languages || fallback.languages),
    nsfw: normalizeBoolean(input.nsfw, normalizeBoolean(fallback.nsfw, false)),
    needsConfig: normalizeBoolean(input.needsConfig, normalizeBoolean(fallback.needsConfig, false)),
    needsWebView: normalizeBoolean(input.needsWebView, normalizeBoolean(fallback.needsWebView, false)),
    installed,
    enabled: normalizeBoolean(input.enabled, normalizeBoolean(fallback.enabled, true)),
    status: normalizeString(input.status, normalizeString(fallback.status, installed ? 'installed' : (sourcesDeferred ? 'installable' : 'available'))),
    error: rawError && !isLegacySourceAvailabilityError(rawError) ? rawError : availabilityError,
    sourcesDeferred,
    connectors,
    sourceCount: connectors.length || normalizeInteger(input.sourceCount, normalizeInteger(fallback.sourceCount, 0)),
    compatibleSourceCount: connectors.filter(
      (connector) => connector.runtimeKind === 'suwayomi' || (connector.adapterId && SUPPORTED_ADAPTER_IDS.has(connector.adapterId))
    ).length || normalizeInteger(input.compatibleSourceCount, normalizeInteger(fallback.compatibleSourceCount, 0)),
    updatedAt: normalizeString(input.updatedAt, normalizeString(fallback.updatedAt, nowIso()))
  };
}

function normalizeImportRecord(input = {}) {
  const chapterId = normalizeString(input.chapterId);
  const destinationCategoryId = normalizeString(input.destinationCategoryId);
  if (!chapterId || !destinationCategoryId) return null;
  return {
    repoId: normalizeString(input.repoId),
    extensionId: normalizeString(input.extensionId),
    connectorId: normalizeString(input.connectorId),
    sourceId: normalizeString(input.sourceId),
    seriesId: normalizeString(input.seriesId),
    chapterId,
    destinationCategoryId,
    importedAt: normalizeString(input.importedAt, nowIso()),
    localPath: normalizeString(input.localPath)
  };
}

function normalizeSeriesLink(input = {}) {
  const connectorId = normalizeString(input.connectorId);
  const seriesId = normalizeString(input.seriesId);
  if (!connectorId || !seriesId) return null;
  return {
    localContentId: normalizeString(input.localContentId),
    localMangaId: normalizeString(input.localMangaId),
    localSeriesPath: normalizeString(input.localSeriesPath),
    destinationCategoryId: normalizeString(input.destinationCategoryId),
    repoId: normalizeString(input.repoId),
    extensionId: normalizeString(input.extensionId),
    connectorId,
    sourceId: normalizeString(input.sourceId),
    seriesId,
    seriesTitle: normalizeString(input.seriesTitle || input.title),
    sourceLabel: normalizeString(input.sourceLabel),
    coverUrl: normalizeString(input.coverUrl),
    lastImportedAt: normalizeString(input.lastImportedAt, nowIso()),
    importedChapterIds: uniqueStrings(input.importedChapterIds),
    lastKnownChapterIds: uniqueStrings(input.lastKnownChapterIds),
    lastCheckedAt: normalizeString(input.lastCheckedAt),
    updatedAt: normalizeString(input.updatedAt, nowIso())
  };
}

function normalizeRecentSeriesEntry(input = {}) {
  const connectorId = normalizeString(input.connectorId);
  const seriesId = normalizeString(input.seriesId);
  if (!connectorId || !seriesId) return null;
  return {
    connectorId,
    seriesId,
    seriesTitle: normalizeString(input.seriesTitle || input.title),
    sourceLabel: normalizeString(input.sourceLabel),
    coverUrl: normalizeString(input.coverUrl),
    localContentId: normalizeString(input.localContentId),
    lastOpenedAt: normalizeString(input.lastOpenedAt, nowIso())
  };
}

function normalizeSourcesState(input = {}) {
  const runtime = input.runtime && typeof input.runtime === 'object' && !Array.isArray(input.runtime)
    ? input.runtime
    : {};
  const normalized = {
    version: SOURCE_STORE_VERSION,
    runtime: {
      kind: normalizeString(runtime.kind, RUNTIME_KIND),
      version: normalizeString(runtime.version, RUNTIME_VERSION),
      state: normalizeString(runtime.state, 'stopped'),
      healthy: normalizeBoolean(runtime.healthy, false),
      port: runtime.port == null ? null : Number(runtime.port),
      startedAt: normalizeString(runtime.startedAt),
      lastError: normalizeString(runtime.lastError),
      needsAttention: normalizeBoolean(runtime.needsAttention, false),
      lastSyncAt: normalizeString(runtime.lastSyncAt)
    },
    repositories: (Array.isArray(input.repositories) ? input.repositories : [])
      .map((repo) => normalizeRepository(repo))
      .filter(Boolean),
    extensions: (Array.isArray(input.extensions) ? input.extensions : [])
      .map((extension) => normalizeInstalledExtension(extension))
      .filter(Boolean),
    connectorPrefs: input.connectorPrefs && typeof input.connectorPrefs === 'object' && !Array.isArray(input.connectorPrefs)
      ? Object.fromEntries(
          Object.entries(input.connectorPrefs)
            .map(([connectorId, value]) => [
              normalizeString(connectorId),
              value && typeof value === 'object' && !Array.isArray(value) ? value : {}
            ])
            .filter(([connectorId]) => Boolean(connectorId))
        )
      : {},
    lastConnectorId: normalizeString(input.lastConnectorId),
    lastCategoryId: normalizeString(input.lastCategoryId),
    importHistory: (Array.isArray(input.importHistory) ? input.importHistory : [])
      .map((record) => normalizeImportRecord(record))
      .filter(Boolean)
      .slice(-500),
    seriesLinks: (Array.isArray(input.seriesLinks) ? input.seriesLinks : [])
      .map((record) => normalizeSeriesLink(record))
      .filter(Boolean)
      .slice(-500),
    recentSeries: (Array.isArray(input.recentSeries) ? input.recentSeries : [])
      .map((record) => normalizeRecentSeriesEntry(record))
      .filter(Boolean)
      .slice(-80),
    pinnedConnectors: uniqueStrings(input.pinnedConnectors).slice(0, 30)
  };
  const seenRepositoryUrls = new Set([BUNDLED_REPOSITORY_URL]);
  normalized.repositories = [
    makeBundledRepository(normalized.runtime.lastSyncAt),
    ...normalized.repositories.filter((repository) => {
      const repositoryId = normalizeString(repository?.id);
      const repositoryUrl = normalizeString(repository?.url);
      if (!repositoryUrl) return false;
      if (repositoryId === BUNDLED_REPOSITORY_ID) return false;
      if (repository?.bundled) return false;
      if (repositoryUrl === BUNDLED_REPOSITORY_URL) return false;
      if (seenRepositoryUrls.has(repositoryUrl)) return false;
      seenRepositoryUrls.add(repositoryUrl);
      return true;
    })
  ];
  return normalized;
}

function loadSourcesState() {
  const statePath = getSourcesStatePath();
  if (cachedSourcesState && cachedSourcesPath === statePath) return cachedSourcesState;
  const raw = readJsonSafe(statePath, DEFAULT_SOURCE_STATE);
  const normalized = normalizeSourcesState(raw);
  const normalizedJson = JSON.stringify(normalized, null, 2);
  const persistedJson = fs.existsSync(statePath)
    ? fs.readFileSync(statePath, 'utf8')
    : '';
  cachedSourcesPath = statePath;
  cachedSourcesState = normalized;
  cachedSourcesJson = persistedJson === normalizedJson ? normalizedJson : '';
  queuedSourcesJson = '';
  if (!fs.existsSync(statePath) || persistedJson !== normalizedJson) saveSourcesState(normalized);
  return cachedSourcesState;
}

function saveSourcesState(nextState) {
  const normalized = normalizeSourcesState(nextState);
  const statePath = getSourcesStatePath();
  const serialized = JSON.stringify(normalized, null, 2);
  if (
    cachedSourcesPath === statePath
    && cachedSourcesState
    && (cachedSourcesJson === serialized || queuedSourcesJson === serialized)
  ) {
    return cachedSourcesState;
  }
  cachedSourcesPath = statePath;
  cachedSourcesState = normalized;
  queuedSourcesJson = serialized;
  sourcePersistence.schedule(statePath, serialized, {
    onSuccess: ({ content }) => {
      if (cachedSourcesPath !== statePath || queuedSourcesJson !== content) return;
      queuedSourcesJson = '';
      cachedSourcesJson = content;
    }
  });
  return cachedSourcesState;
}

function invalidateSourcesStateCache() {
  cachedSourcesPath = '';
  cachedSourcesState = null;
  cachedSourcesJson = '';
  queuedSourcesJson = '';
}

async function flushSourcesStateWrites() {
  const result = await sourcePersistence.flush();
  if (!result.ok) console.error('[sources] persistence failed:', result.error);
  return result.ok;
}

function getSourcesPersistenceStatus() {
  return sourcePersistence.getStatus();
}

function updateSourcesState(updater) {
  const current = loadSourcesState();
  const next = updater(structuredClone(current));
  if (JSON.stringify(next) === JSON.stringify(current)) return current;
  return saveSourcesState(next);
}

function mergeCatalogWithInstalled(catalogEntry, installedEntry = null) {
  const base = normalizeExtensionCatalogEntry(catalogEntry);
  if (!base) return null;
  const installed = normalizeInstalledExtension(installedEntry || {}, base);
  const connectors = installed.connectors.length ? installed.connectors : base.connectors;
  const compatibleSourceCount = connectors.filter(
    (connector) => connector.runtimeKind === 'suwayomi' || (connector.adapterId && SUPPORTED_ADAPTER_IDS.has(connector.adapterId))
  ).length;
  return {
    ...base,
    packageName: installed.packageName || base.packageName,
    version: installed.version || base.version,
    versionCode: installed.versionCode ?? base.versionCode,
    adapterId: installed.adapterId || base.adapterId,
    runtimeKind: installed.runtimeKind || base.runtimeKind,
    iconUrl: installed.iconUrl || base.iconUrl,
    languages: installed.languages.length ? installed.languages : base.languages,
    needsConfig: installed.needsConfig || base.needsConfig,
    needsWebView: installed.needsWebView || base.needsWebView,
    sourcesDeferred: Boolean(installed.sourcesDeferred || base.sourcesDeferred),
    connectors,
    sourceCount: connectors.length,
    compatibleSourceCount,
    installed: Boolean(installedEntry?.installed),
    enabled: Boolean(installedEntry?.enabled),
    status: installedEntry?.installed
      ? normalizeString(installedEntry.status, 'installed')
      : base.status,
    error: normalizeString(installedEntry?.error, base.error),
    updatedAt: installed.updatedAt
  };
}

function listRepositories() {
  const state = loadSourcesState();
  return state.repositories.map((repo) => normalizeRepository(repo)).filter(Boolean);
}

function listExtensions() {
  const state = loadSourcesState();
  const installedById = new Map(
    state.extensions
      .map((entry) => normalizeInstalledExtension(entry))
      .filter(Boolean)
      .map((entry) => [entry.id, entry])
  );

  const catalog = new Map();
  listRepositories().forEach((repo) => {
    repo.catalog.forEach((entry) => {
      catalog.set(entry.id, mergeCatalogWithInstalled({ ...entry, repoId: repo.id }, installedById.get(entry.id)));
    });
  });

  installedById.forEach((entry, id) => {
    if (!catalog.has(id)) {
      catalog.set(id, mergeCatalogWithInstalled({
        id,
        repoId: entry.repoId,
        packageName: entry.packageName,
        displayName: entry.displayName,
        version: entry.version,
        adapterId: entry.adapterId,
        languages: entry.languages,
        nsfw: entry.nsfw,
        needsConfig: entry.needsConfig,
        needsWebView: entry.needsWebView,
        connectors: entry.connectors,
        status: entry.error ? 'incompatible' : 'available',
        error: entry.error
      }, entry));
    }
  });

  return [...catalog.values()]
    .filter(Boolean)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'fr', { sensitivity: 'base' }));
}

function ensureDefaultExtensionInstalled(nextState) {
  if (nextState.extensions.some((entry) => normalizeString(entry.id) === DEFAULT_EXTENSION_ID)) {
    return nextState;
  }
  const official = getBundledExtensionCatalog().find((entry) => entry.id === DEFAULT_EXTENSION_ID);
  if (!official) return nextState;
  nextState.extensions.push(normalizeInstalledExtension({
    ...official,
    installed: true,
    enabled: true,
    status: 'installed',
    updatedAt: nowIso()
  }));
  return nextState;
}

function getRuntimeStatus() {
  const state = loadSourcesState();
  return {
    state: state.runtime.state,
    version: state.runtime.version,
    healthy: Boolean(state.runtime.healthy),
    port: state.runtime.port,
    startedAt: state.runtime.startedAt || null,
    lastError: state.runtime.lastError || '',
    needsAttention: Boolean(state.runtime.needsAttention),
    kind: state.runtime.kind
  };
}

function buildRuntimeAttachOptions(state = null) {
  const runtimeState = state && typeof state === 'object' ? state.runtime : null;
  return {
    existingPort: runtimeState?.port ?? null,
    existingStartedAt: normalizeString(runtimeState?.startedAt)
  };
}

function buildActiveRepositoryUrls(repositories = []) {
  return repositories
    .filter((repository) => repository.enabled && repository.trusted && repository.url !== BUNDLED_REPOSITORY_URL)
    .map((repository) => normalizeString(repository.url))
    .filter(Boolean);
}

function extractRuntimeSourceNodes(runtimeExtension) {
  if (Array.isArray(runtimeExtension?.source?.nodes)) {
    return runtimeExtension.source.nodes;
  }
  if (Array.isArray(runtimeExtension?.sources?.nodes)) {
    return runtimeExtension.sources.nodes;
  }
  if (Array.isArray(runtimeExtension?.source)) {
    return runtimeExtension.source;
  }
  if (Array.isArray(runtimeExtension?.sources)) {
    return runtimeExtension.sources;
  }
  if (runtimeExtension?.source && typeof runtimeExtension.source === 'object') {
    return Object.values(runtimeExtension.source).filter((entry) => entry && typeof entry === 'object');
  }
  if (runtimeExtension?.sources && typeof runtimeExtension.sources === 'object') {
    return Object.values(runtimeExtension.sources).filter((entry) => entry && typeof entry === 'object');
  }
  return [];
}

function mapRuntimeSourceToConnector(source) {
  return normalizeConnectorDefinition({
    sourceId: normalizeString(source?.id),
    displayName: normalizeString(source?.displayName || source?.name),
    language: normalizeString(source?.lang, 'multi'),
    mediaKind: 'manga',
    adapterId: deriveAdapterIdFromSource({
      name: source?.displayName || source?.name,
      packageName: '',
      baseUrl: ''
    }),
    runtimeKind: 'suwayomi',
    iconUrl: normalizeString(source?.iconUrl),
    isConfigurable: normalizeBoolean(source?.isConfigurable, false),
    supportsLatest: normalizeBoolean(source?.supportsLatest, false)
  });
}

function mapRuntimeExtensionToInstalled(runtimeExtension, fallback = {}) {
  const connectors = extractRuntimeSourceNodes(runtimeExtension)
    .map((source) => mapRuntimeSourceToConnector(source))
    .filter(Boolean);
  return normalizeInstalledExtension({
    id: normalizeString(fallback.id || runtimeExtension?.pkgName),
    repoId: normalizeString(fallback.repoId),
    packageName: normalizeString(runtimeExtension?.pkgName, normalizeString(fallback.packageName, fallback.id)),
    displayName: stripExtensionDisplayPrefix(normalizeString(runtimeExtension?.name, normalizeString(fallback.displayName, fallback.id))),
    version: normalizeString(runtimeExtension?.versionName, normalizeString(fallback.version, '0.0.0')),
    versionCode: normalizeInteger(runtimeExtension?.versionCode, normalizeInteger(fallback.versionCode)),
    apkUrl: normalizeString(fallback.apkUrl),
    adapterId: normalizeString(
      fallback.adapterId
      || connectors.find((connector) => connector.adapterId && SUPPORTED_ADAPTER_IDS.has(connector.adapterId))?.adapterId
    ),
    runtimeKind: connectors.some((connector) => connector.runtimeKind === 'suwayomi') ? 'suwayomi' : normalizeString(fallback.runtimeKind),
    iconUrl: normalizeString(runtimeExtension?.iconUrl, normalizeString(fallback.iconUrl)),
    languages: uniqueStrings([runtimeExtension?.lang, ...(fallback.languages || []), ...connectors.map((connector) => connector.language)]),
    nsfw: normalizeBoolean(runtimeExtension?.isNsfw, normalizeBoolean(fallback.nsfw, false)),
    needsConfig: connectors.some((connector) => connector.isConfigurable) || normalizeBoolean(fallback.needsConfig, false),
    needsWebView: normalizeBoolean(fallback.needsWebView, false),
    installed: normalizeBoolean(runtimeExtension?.isInstalled, normalizeBoolean(fallback.installed, false)),
    enabled: normalizeBoolean(fallback.enabled, true),
    status: normalizeBoolean(runtimeExtension?.isInstalled, false)
      ? 'installed'
      : normalizeString(fallback.status, 'available'),
    error: normalizeString(fallback.error),
    connectors,
    sourceCount: connectors.length,
    compatibleSourceCount: connectors.length,
    updatedAt: nowIso()
  });
}

async function waitForRuntimeExtension(packageName, options = {}) {
  const normalizedPackageName = normalizeString(packageName);
  if (!normalizedPackageName) return null;

  const minSourceCount = Math.max(0, Number(options.minSourceCount ?? 1));
  const attempts = Math.max(1, Number(options.attempts ?? 8));
  const delayMs = Math.max(150, Number(options.delayMs ?? 500));
  let lastMatch = null;

  for (let index = 0; index < attempts; index += 1) {
    try {
      const directMatch = await suwayomiRuntime.getExtension(normalizedPackageName);
      if (directMatch) {
        lastMatch = directMatch;
        if (extractRuntimeSourceNodes(directMatch).length >= minSourceCount || !directMatch?.isInstalled) {
          return directMatch;
        }
      }
    } catch (_error) {
      // ignore and retry
    }

    try {
      const listedMatch = (await suwayomiRuntime.queryExtensions()).find(
        (entry) => normalizeString(entry?.pkgName) === normalizedPackageName
      ) || null;
      if (listedMatch) {
        lastMatch = listedMatch;
        if (extractRuntimeSourceNodes(listedMatch).length >= minSourceCount || !listedMatch?.isInstalled) {
          return listedMatch;
        }
      }
    } catch (_error) {
      // ignore and retry
    }

    if (index < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return lastMatch;
}

async function reconcileRuntimeExtensions() {
  const runtimeExtensions = await suwayomiRuntime.queryExtensions();
  const hydratedRuntimeExtensions = await Promise.all(
    runtimeExtensions.map(async (entry) => {
      const packageName = normalizeString(entry?.pkgName);
      const runtimeSources = extractRuntimeSourceNodes(entry);
      if (!entry?.isInstalled || runtimeSources.length > 0 || !packageName) {
        return entry;
      }
      try {
        return await waitForRuntimeExtension(packageName, { minSourceCount: 1, attempts: 6, delayMs: 400 }) || entry;
      } catch (_error) {
        return entry;
      }
    })
  );
  const runtimeByPackage = new Map(
    hydratedRuntimeExtensions
      .map((entry) => [normalizeString(entry?.pkgName), entry])
      .filter(([pkgName]) => Boolean(pkgName))
  );

  const nextState = updateSourcesState((draft) => {
    draft.repositories = draft.repositories.map((repository) => normalizeRepository({
      ...repository,
      catalog: (repository.catalog || []).map((entry) => {
        const runtimeEntry = runtimeByPackage.get(normalizeString(entry.packageName || entry.id));
        if (!runtimeEntry) {
          return normalizeExtensionCatalogEntry(entry);
        }
        const runtimeConnectors = extractRuntimeSourceNodes(runtimeEntry)
          .map((source) => mapRuntimeSourceToConnector(source))
          .filter(Boolean);
        const hasRuntimeConnectors = runtimeConnectors.length > 0;
        return normalizeExtensionCatalogEntry({
          ...entry,
          version: normalizeString(runtimeEntry.versionName, entry.version),
          versionCode: normalizeInteger(runtimeEntry.versionCode, entry.versionCode),
          iconUrl: normalizeString(runtimeEntry.iconUrl, entry.iconUrl),
          needsConfig: hasRuntimeConnectors
            ? runtimeConnectors.some((source) => source?.isConfigurable)
            : entry.needsConfig,
          connectors: hasRuntimeConnectors ? runtimeConnectors : entry.connectors,
          status: hasRuntimeConnectors
            ? 'available'
            : normalizeString(entry.status, 'installable'),
          error: hasRuntimeConnectors ? '' : normalizeString(entry.error)
        });
      })
    })).filter(Boolean);

    const installedById = new Map(
      draft.extensions
        .map((entry) => normalizeInstalledExtension(entry))
        .filter(Boolean)
        .map((entry) => [entry.id, entry])
    );

    draft.repositories.forEach((repository) => {
      repository.catalog.forEach((entry) => {
        const runtimeEntry = runtimeByPackage.get(normalizeString(entry.packageName || entry.id));
        const existing = installedById.get(entry.id);
        if (runtimeEntry?.isInstalled || existing?.installed) {
          installedById.set(entry.id, mapRuntimeExtensionToInstalled(runtimeEntry || {}, {
            ...entry,
            ...existing,
            enabled: existing?.enabled !== false
          }));
        }
      });
    });

    draft.extensions = [...installedById.values()]
      .map((entry) => normalizeInstalledExtension(entry))
      .filter(Boolean);
    return draft;
  });

  return {
    runtime: getRuntimeStatus(),
    repositories: nextState.repositories,
    extensions: listExtensions(),
    runtimeExtensions: hydratedRuntimeExtensions
  };
}

async function startRuntime(options = {}) {
  const current = loadSourcesState();
  const runtime = await suwayomiRuntime.startRuntime({
    extensionRepos: buildActiveRepositoryUrls(current.repositories),
    ...buildRuntimeAttachOptions(current)
  });
  const state = updateSourcesState((draft) => {
    draft.runtime.kind = RUNTIME_KIND;
    draft.runtime.version = normalizeString(runtime.version, RUNTIME_VERSION);
    draft.runtime.state = normalizeString(runtime.state, 'running');
    draft.runtime.healthy = Boolean(runtime.healthy);
    draft.runtime.port = runtime.port ?? null;
    draft.runtime.startedAt = normalizeString(runtime.startedAt, draft.runtime.startedAt || nowIso());
    draft.runtime.lastError = normalizeString(runtime.lastError);
    draft.runtime.needsAttention = Boolean(runtime.needsAttention);
    if (options.ensureDefaultExtension !== false) {
      ensureDefaultExtensionInstalled(draft);
    }
    return draft;
  });
  await reconcileRuntimeExtensions();
  return {
    runtime: getRuntimeStatus(),
    repositories: listRepositories(),
    extensions: listExtensions(),
    state
  };
}

async function stopRuntime() {
  const runtime = await suwayomiRuntime.stopRuntime();
  updateSourcesState((draft) => {
    draft.runtime.state = normalizeString(runtime.state, 'stopped');
    draft.runtime.healthy = Boolean(runtime.healthy);
    draft.runtime.port = runtime.port ?? null;
    draft.runtime.lastError = normalizeString(runtime.lastError);
    draft.runtime.needsAttention = Boolean(runtime.needsAttention);
    return draft;
  });
  return getRuntimeStatus();
}

function terminateRuntimeProcesses() {
  const killed = suwayomiRuntime.terminateOwnedRuntimeProcesses();
  updateSourcesState((draft) => {
    draft.runtime.state = 'stopped';
    draft.runtime.healthy = false;
    draft.runtime.port = null;
    draft.runtime.lastError = '';
    draft.runtime.needsAttention = false;
    return draft;
  });
  return killed;
}

async function resetRuntimeCache() {
  const runtimeCacheDir = getSourceRuntimeCacheDir();
  for (const entry of fs.readdirSync(runtimeCacheDir)) {
    fs.rmSync(path.join(runtimeCacheDir, entry), { recursive: true, force: true });
  }
  const runtime = await suwayomiRuntime.resetRuntimeData();
  updateSourcesState((draft) => {
    draft.runtime.state = normalizeString(runtime.state, 'stopped');
    draft.runtime.healthy = Boolean(runtime.healthy);
    draft.runtime.port = runtime.port ?? null;
    draft.runtime.startedAt = normalizeString(runtime.startedAt);
    draft.runtime.lastError = normalizeString(runtime.lastError);
    draft.runtime.needsAttention = Boolean(runtime.needsAttention);
    draft.runtime.lastSyncAt = nowIso();
    return draft;
  });
  return {
    ok: true,
    runtime: getRuntimeStatus(),
    cacheDir: runtimeCacheDir
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Sawa Manga Library/5.0.1'
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeManifestRepository(repository, fallback = {}) {
  const repoId = normalizeString(repository.id || fallback.id);
  const entries = (Array.isArray(repository.extensions) ? repository.extensions : [])
    .map((entry) => normalizeExtensionCatalogEntry(entry, { repoId }))
    .filter(Boolean);
  return {
    id: repoId,
    name: normalizeString(repository.name, normalizeString(fallback.name, repoId)),
    extensions: entries
  };
}

function normalizeMihonCatalogSource(input = {}, fallback = {}) {
  const packageName = normalizeString(
    input.packageName || input.pkg || input.package,
    normalizeString(fallback.packageName || fallback.pkg || fallback.package)
  );
  const displayName = normalizeString(
    input.displayName || input.title || input.name,
    normalizeString(fallback.displayName || fallback.title || fallback.name)
  );
  const language = normalizeString(
    input.language || input.lang,
    normalizeString(fallback.language || fallback.lang, 'multi')
  );
  const baseUrl = normalizeString(
    input.baseUrl || input.baseURL || input.site || input.domainBaseUrl,
    normalizeString(fallback.baseUrl || fallback.baseURL || fallback.site || fallback.domainBaseUrl)
  );
    const sourceId = normalizeString(
      input.sourceId
      || input.sourceID
      || input.id
      || fallback.sourceId
      || fallback.id
      || [
        packageName,
        language,
      displayName || baseUrl || 'source'
    ]
      .filter(Boolean)
      .join(':')
      .toLowerCase()
      .replace(/[^a-z0-9:._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
  if (!sourceId) return null;

  return normalizeConnectorDefinition({
    sourceId,
    displayName,
    language,
    mediaKind: normalizeString(input.mediaKind, normalizeString(fallback.mediaKind, 'manga')),
    baseUrl,
    versionId: normalizeInteger(
      input.versionId ?? input.versionCode ?? input.version,
      normalizeInteger(fallback.versionId ?? fallback.versionCode ?? fallback.version)
    ),
    iconUrl: normalizeString(input.iconUrl, normalizeString(fallback.iconUrl)),
    adapterId: deriveAdapterIdFromSource({
      name: displayName,
      packageName,
      baseUrl
    })
  });
}

function normalizeMihonCatalogExtension(entry = {}, context = {}) {
  const packageName = normalizeString(entry.pkg || entry.package || entry.packageName || entry.pkgName || context.packageName);
  const id = normalizeString(entry.id || packageName);
  if (!id) return null;

  const displayName = stripExtensionDisplayPrefix(
    normalizeString(entry.name, normalizeString(context.displayName, packageName))
  );
  const repoBaseUrl = normalizeString(context.baseUrl);
  const catalogSources = [
    ...(Array.isArray(entry.sources) ? entry.sources : []),
    ...(Array.isArray(entry.sourceList) ? entry.sourceList : []),
    ...(Array.isArray(entry.source) ? entry.source : []),
    ...(Array.isArray(entry.source?.nodes) ? entry.source.nodes : []),
    ...(Array.isArray(entry.sources?.nodes) ? entry.sources.nodes : []),
    ...(!Array.isArray(entry.source) && entry.source && typeof entry.source === 'object' && !Array.isArray(entry.source?.nodes)
      ? [entry.source]
      : []),
    ...(!Array.isArray(entry.sourceList) && entry.sourceList && typeof entry.sourceList === 'object'
      ? Object.values(entry.sourceList)
      : []),
    ...(!Array.isArray(entry.sources) && entry.sources && typeof entry.sources === 'object' && !Array.isArray(entry.sources?.nodes)
      ? Object.values(entry.sources)
      : [])
  ].filter((source) => source && typeof source === 'object');
  const connectors = catalogSources
    .map((source) => normalizeMihonCatalogSource(source, { packageName }))
    .filter(Boolean);
  const fallbackBaseUrl = Array.isArray(entry.baseUrl)
    ? entry.baseUrl[0]
    : (entry.baseUrl || entry.baseURL || entry.site || context.baseUrl);
  const fallbackConnector = connectors.length > 0
    ? null
    : normalizeMihonCatalogSource({
      name: displayName,
      lang: normalizeString(entry.language || entry.lang, 'multi'),
      baseUrl: fallbackBaseUrl,
      versionId: normalizeInteger(entry.versionId ?? entry.versionCode ?? entry.code),
      packageName
    }, {
      packageName,
      name: displayName,
      lang: normalizeString(entry.language || entry.lang, 'multi'),
      baseUrl: fallbackBaseUrl
    });
  const resolvedConnectors = fallbackConnector ? [fallbackConnector] : connectors;

  return normalizeExtensionCatalogEntry({
    id,
    repoId: normalizeString(context.repoId),
    packageName,
    displayName,
    version: normalizeString(entry.version, normalizeString(context.version, '0.0.0')),
    versionCode: normalizeInteger(entry.code, normalizeInteger(context.versionCode)),
    apkUrl: resolveAbsoluteUrl(repoBaseUrl, entry.apk || context.apkUrl),
    languages: uniqueStrings([
      normalizeString(entry.lang),
      ...resolvedConnectors.map((connector) => connector.language)
    ]),
    nsfw: normalizeBoolean(entry.nsfw, false),
    needsConfig: false,
    needsWebView: false,
    connectors: resolvedConnectors
  });
}

async function resolveMihonCatalogManifest(repository) {
  const targets = buildRepositoryTargets(repository.url);
  const metaCandidates = uniqueStrings(targets.metaCandidates);

  let repoMeta = null;
  let repoMetaUrl = '';
  for (const candidate of metaCandidates) {
    const nextMeta = await tryFetchJson(candidate);
    if (nextMeta && typeof nextMeta === 'object' && !Array.isArray(nextMeta)) {
      repoMeta = nextMeta;
      repoMetaUrl = candidate;
      break;
    }
  }

  const repoBaseUrl = normalizeString(
    resolveAbsoluteUrl(repoMetaUrl || repository.url, repoMeta?.baseUrl || '')
  );
  const catalogCandidates = uniqueStrings([
    ...targets.catalogCandidates,
    repoBaseUrl ? resolveAbsoluteUrl(ensureTrailingSlash(repoBaseUrl), 'index.min.json') : '',
    repoBaseUrl ? resolveAbsoluteUrl(ensureTrailingSlash(repoBaseUrl), 'index.json') : ''
  ]);

  for (const candidate of catalogCandidates) {
    const manifest = await tryFetchJson(candidate);
    if (Array.isArray(manifest)) {
      return {
        name: normalizeString(repoMeta?.name, repository.name),
        baseUrl: repoBaseUrl || ensureTrailingSlash(candidate.replace(/[^/]*$/, '')),
        catalogUrl: candidate,
        extensions: manifest
          .map((entry) => normalizeMihonCatalogExtension(entry, {
            repoId: repository.id,
            baseUrl: repoBaseUrl || ensureTrailingSlash(candidate.replace(/[^/]*$/, ''))
          }))
          .filter(Boolean)
      };
    }
  }

  return null;
}

async function loadRepositoryCatalog(repository) {
  if (repository.url === BUNDLED_REPOSITORY_URL) {
    return normalizeManifestRepository({
      id: repository.id,
      name: repository.name,
      extensions: getBundledExtensionCatalog()
    }, repository);
  }

  const mihonCatalog = await resolveMihonCatalogManifest(repository);
  if (mihonCatalog) {
    return mihonCatalog;
  }

  const manifest = await fetchJson(normalizeRepositoryInputUrl(repository.url));
  if (Array.isArray(manifest)) {
    return {
      name: repository.name,
      extensions: manifest
        .map((entry) => normalizeMihonCatalogExtension(entry, {
          repoId: repository.id,
          baseUrl: ensureTrailingSlash(normalizeRepositoryInputUrl(repository.url).replace(/[^/]*$/, ''))
        }))
        .filter(Boolean)
    };
  }

  if (Array.isArray(manifest?.extensions)) {
    return normalizeManifestRepository({
      id: repository.id,
      name: manifest.name || repository.name,
      extensions: manifest.extensions
    }, repository);
  }

  if (Array.isArray(manifest?.repositories)) {
    const candidate = manifest.repositories.find((entry) => normalizeString(entry.id) === repository.id);
    if (candidate) return normalizeManifestRepository(candidate, repository);
  }

  throw new Error('Manifest de depot non reconnu.');
}

function makeRepositoryId(url) {
  const safe = normalizeRepositoryInputUrl(url).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return safe ? `repo-${safe.slice(0, 36)}` : `repo-${Date.now()}`;
}

function addRepository(input = {}) {
  const url = normalizeRepositoryInputUrl(input.url);
  if (!url) {
    throw new Error('URL de depot manquante.');
  }
  if (url === BUNDLED_REPOSITORY_URL) {
    throw new Error('Le catalogue officiel integre est deja disponible.');
  }

  const repositoryId = normalizeString(input.id, makeRepositoryId(url));
  const nextState = updateSourcesState((draft) => {
    const existingIndex = draft.repositories.findIndex((repo) => repo.id === repositoryId || repo.url === url);
    const nextRepo = normalizeRepository({
      id: repositoryId,
      name: normalizeString(input.name, 'Depot tiers'),
      url,
      enabled: true,
      trusted: Boolean(input.trusted),
      bundled: false,
      locked: false,
      status: 'idle',
      error: '',
      catalog: []
    });
    if (existingIndex >= 0) draft.repositories.splice(existingIndex, 1, nextRepo);
    else draft.repositories.push(nextRepo);
    return draft;
  });
  return {
    ok: true,
    repository: nextState.repositories.find((repo) => repo.id === repositoryId) || null,
    repositories: listRepositories()
  };
}

function removeRepository(repositoryId) {
  const normalizedId = normalizeString(repositoryId);
  if (!normalizedId || normalizedId === BUNDLED_REPOSITORY_ID) {
    throw new Error('Depot introuvable.');
  }

  updateSourcesState((draft) => {
    draft.repositories = draft.repositories.filter((repo) => repo.id !== normalizedId);
    draft.extensions = draft.extensions.filter((extension) => extension.repoId !== normalizedId);
    draft.importHistory = draft.importHistory.filter((record) => record.repoId !== normalizedId);
    return draft;
  });

  return {
    ok: true,
    repositories: listRepositories(),
    extensions: listExtensions()
  };
}

async function syncRepositories() {
  const current = loadSourcesState();
  const synced = [];

  for (const repository of current.repositories) {
    const nextRepository = normalizeRepository(repository);
    if (!nextRepository) continue;
    if (!nextRepository.enabled) {
      synced.push(nextRepository);
      continue;
    }
    try {
      const catalog = await loadRepositoryCatalog(nextRepository);
      synced.push(normalizeRepository({
        ...nextRepository,
        name: catalog.name || nextRepository.name,
        catalogUrl: catalog.catalogUrl || nextRepository.catalogUrl,
        baseUrl: catalog.baseUrl || nextRepository.baseUrl,
        status: 'ready',
        error: '',
        lastSyncedAt: nowIso(),
        catalog: catalog.extensions
      }));
    } catch (error) {
      synced.push(normalizeRepository({
        ...nextRepository,
        status: 'error',
        error: error?.message || 'Sync impossible.',
        lastSyncedAt: nowIso()
      }));
    }
  }

  updateSourcesState((draft) => {
    draft.repositories = synced;
    draft.runtime.lastSyncAt = nowIso();
    return draft;
  });

  try {
    const runtimeResult = await suwayomiRuntime.synchronizeRepositories(
      buildActiveRepositoryUrls(synced),
      buildRuntimeAttachOptions(loadSourcesState())
    );
    updateSourcesState((draft) => {
      draft.runtime.kind = RUNTIME_KIND;
      draft.runtime.version = normalizeString(runtimeResult.runtime?.version, RUNTIME_VERSION);
      draft.runtime.state = normalizeString(runtimeResult.runtime?.state, 'running');
      draft.runtime.healthy = Boolean(runtimeResult.runtime?.healthy);
      draft.runtime.port = runtimeResult.runtime?.port ?? null;
      draft.runtime.startedAt = normalizeString(runtimeResult.runtime?.startedAt, draft.runtime.startedAt || nowIso());
      draft.runtime.lastSyncAt = nowIso();
      draft.runtime.needsAttention = synced.some((repo) => repo.status === 'error');
      draft.runtime.lastError = draft.runtime.needsAttention
        ? synced.find((repo) => repo.status === 'error')?.error || ''
        : '';
      return draft;
    });
    await reconcileRuntimeExtensions();
  } catch (error) {
    updateSourcesState((draft) => {
      draft.runtime.needsAttention = true;
      draft.runtime.lastError = normalizeString(error?.message, 'Impossible de synchroniser Suwayomi.');
      return draft;
    });
  }

  return {
    ok: true,
    runtime: getRuntimeStatus(),
    repositories: listRepositories(),
    extensions: listExtensions()
  };
}

async function installExtension(extensionId) {
  const normalizedId = normalizeString(extensionId);
  const catalogEntry = listExtensions().find((entry) => entry.id === normalizedId);
  if (!catalogEntry) {
    throw new Error('Extension introuvable.');
  }

  const runtimeState = loadSourcesState();
  await suwayomiRuntime.startRuntime({
    extensionRepos: buildActiveRepositoryUrls(runtimeState.repositories),
    ...buildRuntimeAttachOptions(runtimeState)
  });
  await suwayomiRuntime.installExtension(catalogEntry.packageName || normalizedId);
  const hydratedRuntimeEntry = await waitForRuntimeExtension(
    catalogEntry.packageName || normalizedId,
    { minSourceCount: 1, attempts: 10, delayMs: 500 }
  );

  updateSourcesState((draft) => {
    const existingIndex = draft.extensions.findIndex((entry) => entry.id === normalizedId);
    const nextEntry = hydratedRuntimeEntry
      ? mapRuntimeExtensionToInstalled(hydratedRuntimeEntry, {
          ...catalogEntry,
          installed: true,
          enabled: true,
          status: 'installed',
          updatedAt: nowIso()
        })
      : normalizeInstalledExtension({
          ...catalogEntry,
          installed: true,
          enabled: true,
          status: 'installed',
          updatedAt: nowIso()
        });
    if (existingIndex >= 0) draft.extensions.splice(existingIndex, 1, nextEntry);
    else draft.extensions.push(nextEntry);
    return draft;
  });
  await reconcileRuntimeExtensions();

  return {
    ok: true,
    extension: listExtensions().find((entry) => entry.id === normalizedId) || null,
    extensions: listExtensions()
  };
}

async function updateExtension(extensionId) {
  const normalizedId = normalizeString(extensionId);
  const catalogEntry = listExtensions().find((entry) => entry.id === normalizedId);
  if (!catalogEntry) {
    throw new Error('Extension introuvable.');
  }
  const runtimeState = loadSourcesState();
  await suwayomiRuntime.startRuntime({
    extensionRepos: buildActiveRepositoryUrls(runtimeState.repositories),
    ...buildRuntimeAttachOptions(runtimeState)
  });
  await suwayomiRuntime.refreshExtension(catalogEntry.packageName || normalizedId);
  const hydratedRuntimeEntry = await waitForRuntimeExtension(
    catalogEntry.packageName || normalizedId,
    { minSourceCount: 1, attempts: 8, delayMs: 450 }
  );
  updateSourcesState((draft) => {
    const existingIndex = draft.extensions.findIndex((entry) => entry.id === normalizedId);
    if (existingIndex < 0) {
      throw new Error('Extension non installee.');
    }
    const baseEntry = {
      ...draft.extensions[existingIndex],
      ...catalogEntry,
      installed: true,
      enabled: draft.extensions[existingIndex].enabled !== false,
      status: 'installed',
      updatedAt: nowIso()
    };
    draft.extensions.splice(
      existingIndex,
      1,
      hydratedRuntimeEntry
        ? mapRuntimeExtensionToInstalled(hydratedRuntimeEntry, baseEntry)
        : normalizeInstalledExtension(baseEntry)
    );
    return draft;
  });
  await reconcileRuntimeExtensions();
  return {
    ok: true,
    extension: listExtensions().find((entry) => entry.id === normalizedId) || null,
    extensions: listExtensions()
  };
}

async function uninstallExtension(extensionId) {
  const normalizedId = normalizeString(extensionId);
  const catalogEntry = listExtensions().find((entry) => entry.id === normalizedId);
  if (catalogEntry?.packageName) {
    try {
      const state = loadSourcesState();
      await suwayomiRuntime.startRuntime({
        extensionRepos: buildActiveRepositoryUrls(state.repositories),
        ...buildRuntimeAttachOptions(state)
      });
      await suwayomiRuntime.uninstallExtension(catalogEntry.packageName);
    } catch (_error) {
      // keep local cleanup as fallback
    }
  }
  updateSourcesState((draft) => {
    draft.extensions = draft.extensions.filter((entry) => entry.id !== normalizedId);
    Object.keys(draft.connectorPrefs).forEach((connectorId) => {
      if (connectorId.startsWith(`${normalizedId}:`)) {
        delete draft.connectorPrefs[connectorId];
      }
    });
    return draft;
  });
  await reconcileRuntimeExtensions();
  return {
    ok: true,
    extensions: listExtensions()
  };
}

function setExtensionEnabled(extensionId, enabled) {
  const normalizedId = normalizeString(extensionId);
  updateSourcesState((draft) => {
    const target = draft.extensions.find((entry) => entry.id === normalizedId);
    if (!target) {
      throw new Error('Extension non installee.');
    }
    target.enabled = Boolean(enabled);
    target.updatedAt = nowIso();
    return draft;
  });
  return {
    ok: true,
    extension: listExtensions().find((entry) => entry.id === normalizedId) || null,
    extensions: listExtensions()
  };
}

function buildConnectorId(extensionId, sourceId) {
  return `${extensionId}:${sourceId}`;
}

function listConnectors(appState = {}) {
  const allowNsfwSources = Boolean(appState?.ui?.allowNsfwSources);
  return listExtensions()
    .filter((extension) => extension.installed && extension.enabled)
    .filter((extension) => allowNsfwSources || !extension.nsfw)
    .flatMap((extension) => extension.connectors.map((connector) => ({
      id: buildConnectorId(extension.id, connector.sourceId),
      pluginId: SOURCE_PLUGIN_ID,
      repoId: extension.repoId,
      extensionId: extension.id,
      adapterId: normalizeString(connector.adapterId, extension.adapterId),
      runtimeKind: normalizeString(connector.runtimeKind, normalizeString(extension.runtimeKind)),
      sourceId: connector.sourceId,
      displayName: connector.displayName,
      language: connector.language,
      nsfw: extension.nsfw,
      iconUrl: normalizeString(connector.iconUrl, normalizeString(extension.iconUrl)),
      configState: extension.needsConfig ? 'needs-config' : (
        normalizeString(connector.runtimeKind, normalizeString(extension.runtimeKind)) === 'suwayomi'
          ? (connector.isConfigurable ? 'configurable' : 'ready')
          : normalizeString(connector.adapterId, extension.adapterId) && SUPPORTED_ADAPTER_IDS.has(normalizeString(connector.adapterId, extension.adapterId))
          ? 'ready'
          : 'unsupported'
      ),
      availability: normalizeString(connector.runtimeKind, normalizeString(extension.runtimeKind)) === 'suwayomi'
        ? 'available'
        : normalizeString(connector.adapterId, extension.adapterId) && SUPPORTED_ADAPTER_IDS.has(normalizeString(connector.adapterId, extension.adapterId))
        ? 'available'
        : 'incompatible',
      mediaKind: connector.mediaKind,
      baseUrl: connector.baseUrl,
      versionId: connector.versionId,
      supportsLatest: Boolean(connector.supportsLatest),
      isConfigurable: Boolean(connector.isConfigurable)
    })))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'fr', { sensitivity: 'base' }));
}

function resolveConnector(connectorId, appState = {}) {
  const normalizedId = normalizeString(connectorId);
  return listConnectors(appState).find((connector) => connector.id === normalizedId) || null;
}

function getConnectorPrefs(connectorId) {
  const state = loadSourcesState();
  const normalizedId = normalizeString(connectorId);
  return state.connectorPrefs[normalizedId] && typeof state.connectorPrefs[normalizedId] === 'object'
    ? state.connectorPrefs[normalizedId]
    : {};
}

function setConnectorPrefs(connectorId, values = {}) {
  const normalizedId = normalizeString(connectorId);
  if (!normalizedId) {
    throw new Error('Connecteur introuvable.');
  }
  const next = updateSourcesState((draft) => {
    draft.connectorPrefs[normalizedId] = values && typeof values === 'object' && !Array.isArray(values)
      ? values
      : {};
    return draft;
  });
  return {
    ok: true,
    connectorId: normalizedId,
    prefs: next.connectorPrefs[normalizedId] || {}
  };
}

function markRuntimeSelection({ connectorId = '', categoryId = '' } = {}) {
  updateSourcesState((draft) => {
    if (connectorId) draft.lastConnectorId = normalizeString(connectorId);
    if (categoryId) draft.lastCategoryId = normalizeString(categoryId);
    return draft;
  });
}

function hasImportedChapter(input = {}) {
  const normalized = normalizeImportRecord(input);
  if (!normalized) return false;
  const state = loadSourcesState();
  return state.importHistory.some((record) => (
    record.chapterId === normalized.chapterId
    && record.destinationCategoryId === normalized.destinationCategoryId
    && record.seriesId === normalized.seriesId
    && record.connectorId === normalized.connectorId
  ));
}

function recordImportHistory(records = []) {
  const nextRecords = (Array.isArray(records) ? records : [records])
    .map((record) => normalizeImportRecord(record))
    .filter(Boolean);

  if (!nextRecords.length) {
    return loadSourcesState().importHistory;
  }

  const nextState = updateSourcesState((draft) => {
    const dedupKey = (record) => [
      record.connectorId,
      record.seriesId,
      record.chapterId,
      record.destinationCategoryId
    ].join('::');
    const existing = new Map(draft.importHistory.map((record) => [dedupKey(record), record]));
    nextRecords.forEach((record) => {
      existing.set(dedupKey(record), record);
    });
    draft.importHistory = [...existing.values()].slice(-500);
    return draft;
  });

  return nextState.importHistory;
}

function upsertSeriesLinkFromImport(linkInput = {}) {
  const normalized = normalizeSeriesLink({
    ...linkInput,
    importedChapterIds: uniqueStrings(linkInput.importedChapterIds),
    lastKnownChapterIds: uniqueStrings([
      ...(Array.isArray(linkInput.lastKnownChapterIds) ? linkInput.lastKnownChapterIds : []),
      ...(Array.isArray(linkInput.importedChapterIds) ? linkInput.importedChapterIds : [])
    ]),
    lastCheckedAt: normalizeString(linkInput.lastCheckedAt, nowIso()),
    updatedAt: nowIso()
  });
  if (!normalized) {
    return loadSourcesState().seriesLinks;
  }

  const nextState = updateSourcesState((draft) => {
    const linkIndex = draft.seriesLinks.findIndex((entry) => {
      if (normalized.localContentId && entry.localContentId === normalized.localContentId) return true;
      if (normalized.localMangaId && entry.localMangaId === normalized.localMangaId) return true;
      if (
        normalized.localSeriesPath
        && normalizePathString(entry.localSeriesPath) === normalizePathString(normalized.localSeriesPath)
      ) {
        return true;
      }
      return (
        entry.connectorId === normalized.connectorId
        && entry.seriesId === normalized.seriesId
        && entry.destinationCategoryId === normalized.destinationCategoryId
      );
    });

    const current = linkIndex >= 0 ? draft.seriesLinks[linkIndex] : null;
    const merged = normalizeSeriesLink({
      ...(current || {}),
      ...normalized,
      importedChapterIds: uniqueStrings([
        ...(current?.importedChapterIds || []),
        ...(normalized.importedChapterIds || [])
      ]),
      lastKnownChapterIds: uniqueStrings([
        ...(current?.lastKnownChapterIds || []),
        ...(normalized.lastKnownChapterIds || []),
        ...(normalized.importedChapterIds || [])
      ]),
      updatedAt: nowIso()
    });

    if (!merged) return draft;
    if (linkIndex >= 0) draft.seriesLinks[linkIndex] = merged;
    else draft.seriesLinks.unshift(merged);
    draft.seriesLinks = draft.seriesLinks.slice(0, 500);
    return draft;
  });

  return nextState.seriesLinks;
}

function listLinkedSeries() {
  return [...loadSourcesState().seriesLinks].sort((left, right) =>
    String(right.lastImportedAt || right.updatedAt || '').localeCompare(String(left.lastImportedAt || left.updatedAt || ''))
  );
}

function getImportedChapterIdsForSeries({ connectorId = '', seriesId = '', destinationCategoryId = '' } = {}) {
  const normalizedConnectorId = normalizeString(connectorId);
  const normalizedSeriesId = normalizeString(seriesId);
  const normalizedCategoryId = normalizeString(destinationCategoryId);
  if (!normalizedConnectorId || !normalizedSeriesId) return [];
  const records = loadSourcesState().importHistory;
  const chapterIds = new Set();
  records.forEach((record) => {
    if (record.connectorId !== normalizedConnectorId) return;
    if (record.seriesId !== normalizedSeriesId) return;
    if (normalizedCategoryId && record.destinationCategoryId !== normalizedCategoryId) return;
    chapterIds.add(record.chapterId);
  });
  return [...chapterIds];
}

function getSeriesLinkForManga(input = {}) {
  const normalizedContentId = normalizeString(input.localContentId || input.contentId);
  const normalizedMangaId = normalizeString(input.localMangaId || input.mangaId || input.id);
  const normalizedSeriesPath = normalizePathString(input.localSeriesPath || input.path);
  return listLinkedSeries().find((entry) => {
    if (normalizedContentId && entry.localContentId === normalizedContentId) return true;
    if (normalizedMangaId && entry.localMangaId === normalizedMangaId) return true;
    if (normalizedSeriesPath && normalizePathString(entry.localSeriesPath) === normalizedSeriesPath) return true;
    return false;
  }) || null;
}

function reconcileSeriesLinksWithLibrary(mangas = []) {
  const safeMangas = Array.isArray(mangas) ? mangas : [];
  const nextState = updateSourcesState((draft) => {
    if (!safeMangas.length) return draft;

    const mangaByContentId = new Map();
    const mangaById = new Map();
    const mangaByPath = new Map();
    const importHistoryPathIndex = buildImportHistoryPathIndex(draft.importHistory);

    safeMangas.forEach((manga) => {
      if (manga?.contentId) mangaByContentId.set(manga.contentId, manga);
      if (manga?.id) mangaById.set(manga.id, manga);
      const normalizedPath = normalizePathString(manga?.path);
      if (normalizedPath) mangaByPath.set(normalizedPath, manga);
    });

    safeMangas.forEach((manga) => {
      const existingIndex = findSeriesLinkIndex(draft.seriesLinks, {
        localContentId: manga?.contentId,
        localMangaId: manga?.id,
        localSeriesPath: manga?.path
      });
      const existing = existingIndex >= 0 ? draft.seriesLinks[existingIndex] : null;
      const needsProvenanceRefresh = (
        !existing
        || !existing.connectorId
        || !existing.seriesId
        || !existing.sourceLabel
        || !Array.isArray(existing.importedChapterIds)
        || existing.importedChapterIds.length === 0
      );
      if (!needsProvenanceRefresh) return;
      const inferredLink = buildSeriesLinkFromProvenance(manga, existing)
        || buildSeriesLinkFromImportHistory(manga, existing, draft.importHistory, importHistoryPathIndex);
      if (inferredLink) {
        upsertDraftSeriesLink(draft, inferredLink);
      }
    });

    if (!draft.seriesLinks.length) return draft;
    draft.seriesLinks = draft.seriesLinks.map((entry) => {
      const match = (entry.localContentId && mangaByContentId.get(entry.localContentId))
        || (entry.localMangaId && mangaById.get(entry.localMangaId))
        || mangaByPath.get(normalizePathString(entry.localSeriesPath))
        || null;
      if (!match) return entry;
      return normalizeSeriesLink({
        ...entry,
        localContentId: normalizeString(match.contentId, entry.localContentId),
        localMangaId: normalizeString(match.id, entry.localMangaId),
        localSeriesPath: normalizeString(match.path, entry.localSeriesPath),
        updatedAt: entry.updatedAt || nowIso()
      }) || entry;
    });
    const dedupedLinks = [];
    [...draft.seriesLinks].reverse().forEach((entry) => {
      upsertDraftSeriesLink({ seriesLinks: dedupedLinks }, entry, { touch: false });
    });
    draft.seriesLinks = dedupedLinks.sort((left, right) => {
      const leftKey = left.localContentId || left.localMangaId || normalizePathString(left.localSeriesPath)
        || `${left.connectorId}::${left.seriesId}`;
      const rightKey = right.localContentId || right.localMangaId || normalizePathString(right.localSeriesPath)
        || `${right.connectorId}::${right.seriesId}`;
      return String(leftKey).localeCompare(String(rightKey));
    });
    return draft;
  });
  return nextState.seriesLinks;
}

function markSeriesRecent(input = {}) {
  const normalized = normalizeRecentSeriesEntry(input);
  if (!normalized) {
    return loadSourcesState().recentSeries;
  }
  const nextState = updateSourcesState((draft) => {
    const dedupKey = `${normalized.connectorId}::${normalized.seriesId}`;
    draft.recentSeries = [
      normalized,
      ...(draft.recentSeries || []).filter((entry) => `${entry.connectorId}::${entry.seriesId}` !== dedupKey)
    ].slice(0, 80);
    return draft;
  });
  return nextState.recentSeries;
}

function pinConnector(connectorId, pinned = true) {
  const normalizedId = normalizeString(connectorId);
  const nextState = updateSourcesState((draft) => {
    const current = new Set(uniqueStrings(draft.pinnedConnectors));
    if (normalizedId) {
      if (pinned) current.add(normalizedId);
      else current.delete(normalizedId);
    }
    draft.pinnedConnectors = [...current].slice(0, 30);
    return draft;
  });
  return nextState.pinnedConnectors;
}

module.exports = {
  SOURCE_PLUGIN_ID,
  BUNDLED_REPOSITORY_ID,
  BUNDLED_REPOSITORY_URL,
  DEFAULT_EXTENSION_ID,
  RUNTIME_KIND,
  RUNTIME_VERSION,
  loadSourcesState,
  saveSourcesState,
  updateSourcesState,
  invalidateSourcesStateCache,
  flushSourcesStateWrites,
  getSourcesPersistenceStatus,
  getSourcesStatePath,
  getSourceRuntimeCacheDir,
  getSourceRuntimeImportsDir,
  getRuntimeStatus,
  startRuntime,
  stopRuntime,
  terminateRuntimeProcesses,
  resetRuntimeCache,
  listRepositories,
  addRepository,
  removeRepository,
  syncRepositories,
  listExtensions,
  installExtension,
  updateExtension,
  uninstallExtension,
  setExtensionEnabled,
  listConnectors,
  resolveConnector,
  getConnectorPrefs,
  setConnectorPrefs,
  markRuntimeSelection,
  hasImportedChapter,
  recordImportHistory,
  upsertSeriesLinkFromImport,
  listLinkedSeries,
  getImportedChapterIdsForSeries,
  getSeriesLinkForManga,
  reconcileSeriesLinksWithLibrary,
  markSeriesRecent,
  pinConnector
};
