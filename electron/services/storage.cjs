const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAtomicJsonPersistence } = require('./atomicJsonPersistence.cjs');
const { runHeavyIoTask } = require('./heavyIoClient.cjs');
const {
  cleanupStagedBackup,
  recoverManagedCoverTransaction
} = require('./backupPackage.cjs');
const {
  normalizeCollectionAppearance,
  normalizeCoverProfile,
  rebaseManagedCoverProfile,
  stableLegacyVariantId
} = require('./coverManager.cjs');
const { sanitizeDeletionTombstone } = require('./bulkTrash.cjs');

// `electron` is only resolvable in the main/renderer process. This module is
// also loaded from worker threads (library scan / derived sync), where
// `require('electron')` throws "Cannot find module 'electron'". Resolve it
// lazily and tolerate its absence; worker threads rely on the
// SAWA_USER_DATA_PATH override instead.
let cachedElectronApp;
function getElectronApp() {
  if (cachedElectronApp !== undefined) return cachedElectronApp;
  try {
    cachedElectronApp = require('electron').app || null;
  } catch (error) {
    cachedElectronApp = null;
  }
  return cachedElectronApp;
}

const STORAGE_VERSION = 7;
const STATE_VERSION = 7;
const SCAN_INDEX_VERSION = 1;
const QUEUE_VERSION = 1;
const METADATA_VERSION = 1;
const SPLIT_STORAGE_VERSION = 1;
const SEARCH_PRIVACY_VERSION = 1;
const MAX_WORKSPACES = 8;
const WORKSPACE_ICON_KEYS = ['home', 'library', 'layout', 'scroll', 'heart', 'sparkles', 'layers', 'book'];
const TAB_SCREEN_KEYS = new Set([
  'library', 'dashboard', 'favorites', 'recents', 'collections',
  'maintenance', 'workbench', 'vault', 'sources'
]);
const ROOT_STATE_FILE = 'state.json';
const LEGACY_V2_STATE_FILE = 'sawa-manga-state-v2.json';
const LEGACY_V1_STATE_FILE = 'sawa-manga-state.json';
const USER_DATA_DIRNAME = 'user-data';
const DERIVED_DIRNAME = 'derived';
const CACHE_DIRNAME = 'cache';
const MANAGED_COVERS_DIRNAME = 'managed-covers';
const BACKUP_IMPORT_JOURNAL_FILE = 'backup-import-transaction.json';
const USER_DATA_FILES = {
  metadata: 'metadata.json',
  organization: 'organization.json',
  reader: 'reader.json',
  identity: 'identity.json'
};

const ROOT_STATE_KEYS = [
  'version',
  'stateVersion',
  'scanIndexVersion',
  'queueVersion',
  'metadataVersion',
  'splitStorageVersion',
  'categories',
  'scanIndex',
  'session',
  'ui',
  'vault',
  'pdfMeta',
  'backupHistory',
  'migrationLog'
];

const USER_DATA_KEY_GROUPS = {
  metadata: ['metadata', 'metadataLocks', 'metadataFieldSource', 'coverProfiles'],
  organization: ['favorites', 'tags', 'mangaTags', 'mangaTagMeta', 'collections', 'smartCollections', 'annotations', 'metadataWorkbenchQueue', 'metadataWorkbenchItems', 'metadataWorkbenchLastBatch', 'readingQueue', 'plugins'],
  reader: ['readingStates', 'chapterStates', 'readStatus', 'chapterReadStatus', 'progress', 'recents', 'readerPrefs'],
  identity: ['knownChapterCounts', 'identityAliases', 'identityRecords', 'identitySuggestions', 'identityMediaIssues', 'workGroups', 'deletionTombstones', 'relocationJournal']
};

const DEFAULT_SIDEBAR_SECTIONS = [
  'dashboard',
  'library',
  'collections',
  'maintenance',
  'workbench',
  'sources',
  'vault',
  'favorites',
  'recents'
];

const DEFAULT_KEYBOARD_SHORTCUTS = {
  nextPage: 'ArrowRight',
  prevPage: 'ArrowLeft',
  nextChapter: 'Ctrl+ArrowRight',
  prevChapter: 'Ctrl+ArrowLeft',
  toggleFullscreen: 'F',
  toggleUI: 'H',
  zoomIn: '+',
  zoomOut: '-',
  zoomReset: '0',
  exitReader: 'Escape',
  openCommandPalette: 'Ctrl+K',
  toggleReadingQueue: 'Ctrl+Shift+Q',
  newTab: 'Ctrl+T',
  closeTab: 'Ctrl+W',
  goBack: 'Alt+ArrowLeft',
  openSettings: 'Ctrl+,',
  openSources: 'Ctrl+Shift+S',
  toggleSidebar: 'Ctrl+B',
  panicLock: 'Ctrl+Shift+L',
  nextTab: 'Ctrl+Tab',
  prevTab: 'Ctrl+Shift+Tab'
};

const DEFAULT_STATE = {
  version: STORAGE_VERSION,
  stateVersion: STATE_VERSION,
  scanIndexVersion: SCAN_INDEX_VERSION,
  queueVersion: QUEUE_VERSION,
  metadataVersion: METADATA_VERSION,
  splitStorageVersion: SPLIT_STORAGE_VERSION,
  categories: [],
  scanIndex: {
    updatedAt: null,
    entries: {}
  },
  session: {
    version: 8,
    searchPrivacyVersion: SEARCH_PRIVACY_VERSION,
    activeWorkspaceId: null,
    workspaces: [],
    scrollPositions: {}
  },
  ui: {
    theme: 'dark-night',
    interfaceMode: 'kavita',
    kavitaUpgradePromptSeen: false,
    selectedCategoryId: null,
    showHiddenCategories: false,
    sidebarCollapsed: false,
    sort: 'title-asc',
    cardSize: 'comfortable',
    chapterCardSize: 'comfortable',
    pagePreviewSize: 'comfortable',
    previewQuality: 'balanced',
    sawaExperience: 'horizon',
    cinematicBackdrop: true,
    cinematicIntensity: 58,
    foilEnabled: true,
    foilIntensity: 28,
    adaptiveVisualEffects: true,
    readerFocusMode: 'auto',
    readerControlsHideMs: 3000,
    accent: '#8b5cf6',
    accentAlt: '#38bdf8',
    showPagePreviewBeforeReading: true,
    readerMode: 'single',
    readerFit: 'fit-width',
    readerZoom: 1,
    kavitaReaderSettings: {
      mode: 'single',
      fitMode: 'fit-height',
      zoom: 1,
      brightness: 100,
      widthOverride: 0,
      splitDirection: 'none',
      pageOffset: false,
      swipeEnabled: true,
      emulateBook: false,
      autoClose: true
    },
    readerDoublePageMode: 'manga-jp',
    autoMarkReadThreshold: 95,
    continuousReading: true,
    allowNsfwSources: false,
    metadataProviders: {
      enabled: {
        mangadex: true,
        anilist: true,
        nhentai: true,
        imhentai: false,
        hentaiera: false
      },
      preferredAdultMirror: 'imhentai',
      allowAdultHtmlFallback: false
    },
    activeScreen: 'dashboard',
    dashboardLayout: [],
    dashboardHiddenSections: {},
    sidebarSections: [...DEFAULT_SIDEBAR_SECTIONS],
    sidebarHiddenSections: {},
    sidebarPins: [],
    maintenancePrefs: {
      mutedIssueTypes: [],
      lastOpenedAt: null
    },
    experimental: {
      visualReader: false,
      guidedView: false,
      advancedSearch: true,
      archiveFormats: true,
      ocr: true,
      visualDedupe: false,
      pluginPreview: true,
      performanceDiagnostics: false,
      schedulerProfile: 'balanced'
    },
    filters: { readStatus: 'all', favoriteOnly: false, hasDescription: null, hasCustomCover: null, tags: [], collections: [] },
    keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS }
  },
  metadata: {},
  metadataLocks: {},
  metadataFieldSource: {},
  coverProfiles: {},
  favorites: {},
  tags: {},
  mangaTags: {},
  mangaTagMeta: {},
  collections: {},
  smartCollections: {
    'smart-continue': { id: 'smart-continue', name: 'Continuer', icon: 'play', rules: { type: 'in-progress' } },
    'smart-unread': { id: 'smart-unread', name: 'Non lus', icon: 'book', rules: { type: 'unread' } },
    'smart-in-progress': { id: 'smart-in-progress', name: 'En cours', icon: 'clock', rules: { type: 'started' } },
    'smart-completed': { id: 'smart-completed', name: 'Termines', icon: 'check', rules: { type: 'completed' } },
    'smart-favorites': { id: 'smart-favorites', name: 'Favoris', icon: 'heart', rules: { type: 'favorites' } },
    'smart-recent-added': { id: 'smart-recent-added', name: 'Ajoutes recemment', icon: 'plus', rules: { type: 'recent-added', days: 30 } },
    'smart-recent-read': { id: 'smart-recent-read', name: 'Derniere lecture', icon: 'eye', rules: { type: 'recent-read', days: 14 } },
    'smart-new-chapters': { id: 'smart-new-chapters', name: 'Nouveaux chapitres', icon: 'sparkles', rules: { type: 'new-chapters' } },
    'smart-no-cover': { id: 'smart-no-cover', name: 'Sans couverture', icon: 'image', rules: { type: 'no-cover' } },
    'smart-no-metadata': { id: 'smart-no-metadata', name: 'Sans metadonnees', icon: 'alert', rules: { type: 'no-metadata' } }
  },
  annotations: {},
  metadataWorkbenchQueue: [],
  metadataWorkbenchItems: [],
  metadataWorkbenchLastBatch: null,
  readingQueue: [],
  plugins: {
    enabled: {},
    dismissedWarnings: {}
  },
  vault: {
    pinHash: null,
    pinProtectedBlob: null,
    securityMode: 'none',
    locked: false,
    blurCovers: true,
    autoLockOnClose: true,
    stealthMode: false,
    privateMangaIds: [],
    privateCategoryIds: []
  },
  readingStates: {},
  chapterStates: {},
  readStatus: {},
  chapterReadStatus: {},
  progress: {},
  pdfMeta: {},
  recents: [],
  knownChapterCounts: {},
  identityAliases: {},
  identityRecords: {},
  identitySuggestions: [],
  identityMediaIssues: [],
  workGroups: {},
  deletionTombstones: {},
  relocationJournal: [],
  readerPrefs: {},
  backupHistory: [],
  migrationLog: []
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

let cachedState = null;
let runtimeStateReadOnly = false;
let backupImportTail = Promise.resolve();

function getUserDataPath() {
  const overridePath = String(process.env.SAWA_USER_DATA_PATH || '').trim();
  if (overridePath) {
    ensureDir(overridePath);
    return overridePath;
  }
  const app = getElectronApp();
  if (app && typeof app.getPath === 'function') {
    return app.getPath('userData');
  }
  const fallbackPath = path.join(os.tmpdir(), 'sawa-manga-library-cli');
  ensureDir(fallbackPath);
  return fallbackPath;
}

function getStateDir() {
  const udp = getUserDataPath();
  ensureDir(udp);
  return udp;
}

function getStatePath() {
  return path.join(getStateDir(), ROOT_STATE_FILE);
}

function getLegacyV2StatePath() {
  return path.join(getStateDir(), LEGACY_V2_STATE_FILE);
}

function getLegacyStatePath() {
  return path.join(getStateDir(), LEGACY_V1_STATE_FILE);
}

function getUserDataStoreDir() {
  const dirPath = path.join(getStateDir(), USER_DATA_DIRNAME);
  ensureDir(dirPath);
  return dirPath;
}

function getUserDataStorePaths() {
  const dirPath = getUserDataStoreDir();
  return Object.fromEntries(
    Object.entries(USER_DATA_FILES).map(([key, fileName]) => [key, path.join(dirPath, fileName)])
  );
}

function getDerivedDir() {
  const dirPath = path.join(getStateDir(), DERIVED_DIRNAME);
  ensureDir(dirPath);
  return dirPath;
}

function getDerivedDbPath() {
  return path.join(getDerivedDir(), 'library.db');
}

function getCacheDir() {
  const dirPath = path.join(getStateDir(), CACHE_DIRNAME);
  ensureDir(dirPath);
  return dirPath;
}

function getBackupDir() {
  const dirPath = path.join(getUserDataPath(), 'backups');
  ensureDir(dirPath);
  return dirPath;
}

function getThumbnailDir() {
  const dirPath = path.join(getCacheDir(), 'thumbnails');
  ensureDir(dirPath);
  return dirPath;
}

function getCbzCacheDir() {
  const dirPath = path.join(getCacheDir(), 'cbz');
  ensureDir(dirPath);
  return dirPath;
}

function deepMerge(base, incoming) {
  if (Array.isArray(base) || Array.isArray(incoming)) return incoming ?? base;
  const result = { ...base };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && base[key]
      && typeof base[key] === 'object'
      && !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function makeRuntimeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultWorkspaceName(index) {
  return `Espace ${index + 1}`;
}

function normalizeReaderState(state) {
  if (!state || typeof state !== 'object') return null;
  const zoom = Number(state.zoom);
  const scrollTop = Number(state.scrollTop);
  const scrollRatio = Number(state.scrollRatio);
  const anchorPageIndex = Number(state.anchorPageIndex);
  const intraPageOffset = Number(state.intraPageOffset);
  const furthestPageIndex = Number(state.furthestPageIndex);
  return {
    mode: typeof state.mode === 'string' ? state.mode : null,
    fitMode: typeof state.fitMode === 'string' ? state.fitMode : null,
    zoom: Number.isFinite(zoom) ? zoom : null,
    scrollTop: Number.isFinite(scrollTop) ? scrollTop : 0,
    scrollRatio: Number.isFinite(scrollRatio) ? scrollRatio : 0,
    anchorPageIndex: Number.isFinite(anchorPageIndex) ? Math.max(0, Math.floor(anchorPageIndex)) : null,
    intraPageOffset: Number.isFinite(intraPageOffset) ? Math.max(0, intraPageOffset) : 0,
    furthestPageIndex: Number.isFinite(furthestPageIndex) ? Math.max(0, Math.floor(furthestPageIndex)) : null
  };
}

function normalizeView(view = {}) {
  return {
    screen: typeof view?.screen === 'string' ? view.screen : 'library',
    mangaId: typeof view?.mangaId === 'string' && view.mangaId.trim() ? view.mangaId : null,
    chapterId: typeof view?.chapterId === 'string' && view.chapterId.trim() ? view.chapterId : null,
    pageIndex: Number.isFinite(Number(view?.pageIndex)) ? Math.max(0, Math.floor(Number(view.pageIndex))) : 0,
    readerState: normalizeReaderState(view?.readerState),
    readerIntent: view?.readerIntent && typeof view.readerIntent === 'object'
      ? {
          kind: ['normal', 'exact-page', 'restart'].includes(view.readerIntent.kind) ? view.readerIntent.kind : 'normal',
          pageIndex: Math.max(0, Math.floor(Number(view.readerIntent.pageIndex) || 0)),
          token: String(view.readerIntent.token || 'restored')
        }
      : null,
    readerNotice: typeof view?.readerNotice === 'string' ? view.readerNotice : null
  };
}

function normalizeSearchState(candidate, legacyQuery = '') {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const allowedScopes = new Set(['current', 'all']);
  const allowedFields = new Set([
    'tag',
    'status',
    'favorite',
    'private',
    'author',
    'collection',
    'missing',
    'chapters',
    'added'
  ]);
  const allowedOperators = new Set([':', '=', '>', '>=', '<', '<=']);
  const filters = (Array.isArray(source.filters) ? source.filters : [])
    .slice(0, 24)
    .map((filter, index) => {
      if (!filter || typeof filter !== 'object') return null;
      const field = String(filter.field || '').trim().toLowerCase().slice(0, 32);
      const value = String(filter.value || '').trim().slice(0, 256);
      if (!allowedFields.has(field) || !value) return null;
      return {
        id: String(filter.id || `filter-${field}-${index}`).trim().slice(0, 96),
        field,
        operator: allowedOperators.has(filter.operator) ? filter.operator : ':',
        value,
        label: String(filter.label || '').trim().slice(0, 256)
      };
    })
    .filter(Boolean);
  return {
    query: String(source.query ?? legacyQuery ?? '').trim().slice(0, 512),
    scope: allowedScopes.has(source.scope) ? source.scope : 'current',
    filters
  };
}

function normalizeTab(candidate, fallbackIdPrefix = 'restored') {
  const stack = Array.isArray(candidate?.stack) && candidate.stack.length > 0
    ? candidate.stack.map(normalizeView)
    : [normalizeView()];
  const incognito = Boolean(candidate?.incognito);
  const searchPrivate = Boolean(candidate?.searchPrivate);

  return {
    id: typeof candidate?.id === 'string' && candidate.id.trim()
      ? candidate.id
      : `${fallbackIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    screen: TAB_SCREEN_KEYS.has(String(candidate?.screen || '').trim())
      ? String(candidate.screen).trim()
      : 'library',
    vaultCategoryFilterId: String(candidate?.vaultCategoryFilterId || '').trim() || null,
    pinned: Boolean(candidate?.pinned),
    incognito,
    searchPrivate: false,
    searchState: incognito || searchPrivate
      ? normalizeSearchState(null)
      : normalizeSearchState(candidate?.searchState, candidate?.search),
    stack
  };
}

function normalizeWorkspace(candidate, index = 0) {
  const id = typeof candidate?.id === 'string' && candidate.id.trim()
    ? candidate.id
    : makeRuntimeId('workspace');

  const name = typeof candidate?.name === 'string' && candidate.name.trim()
    ? candidate.name.trim()
    : defaultWorkspaceName(index);

  const iconKey = WORKSPACE_ICON_KEYS.includes(candidate?.iconKey)
    ? candidate.iconKey
    : WORKSPACE_ICON_KEYS[index % WORKSPACE_ICON_KEYS.length];

  const tabs = Array.isArray(candidate?.tabs) && candidate.tabs.length > 0
    ? candidate.tabs.slice(0, 80).map((tab, tabIndex) => normalizeTab(tab, `${id}-${tabIndex}`))
    : [normalizeTab(null, `${id}-tab-0`)];

  const activeTabId = tabs.some((tab) => tab.id === candidate?.activeTabId)
    ? candidate.activeTabId
    : tabs[0].id;

  return {
    id,
    name,
    iconKey,
    tabs,
    activeTabId
  };
}

function normalizeSessionState(session, options = {}) {
  const sourcePrivacyVersion = options.sourceSearchPrivacyVersion === undefined
    ? session?.searchPrivacyVersion
    : options.sourceSearchPrivacyVersion;
  const requiresSearchPrivacyMigration = Number(sourcePrivacyVersion || 0) < SEARCH_PRIVACY_VERSION;
  const migrateTabs = (tabs) => requiresSearchPrivacyMigration
    ? tabs.map((tab) => ({
        ...tab,
        searchPrivate: false,
        searchState: normalizeSearchState(null)
      }))
    : tabs;
  const normalizeScrollPositions = (positions) => Object.fromEntries(
    Object.entries(positions && typeof positions === 'object' ? positions : {})
      .map(([key, value]) => {
        const fallbackOffset = Number(typeof value === 'number' ? value : value?.fallbackOffset);
        const intraRowOffset = Number(value?.intraRowOffset);
        const updatedAt = Number(value?.updatedAt);
        if (!key || !Number.isFinite(fallbackOffset)) return null;
        return [key, {
          anchorId: typeof value?.anchorId === 'string' && value.anchorId ? value.anchorId : null,
          intraRowOffset: Number.isFinite(intraRowOffset) ? intraRowOffset : 0,
          fallbackOffset: Math.max(0, fallbackOffset),
          layoutKey: typeof value?.layoutKey === 'string' ? value.layoutKey : '',
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0
        }];
      })
      .filter(Boolean)
      .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
      .slice(-256)
  );

  if ([2, 3, 4, 5, 6, 7, 8].includes(Number(session?.version)) && Array.isArray(session?.workspaces) && session.workspaces.length > 0) {
    const workspaces = session.workspaces
      .slice(0, MAX_WORKSPACES)
      .map((workspace, index) => {
        const normalizedWorkspace = normalizeWorkspace(workspace, index);
        return {
          ...normalizedWorkspace,
          tabs: migrateTabs(normalizedWorkspace.tabs)
        };
      });

    return {
      version: 8,
      searchPrivacyVersion: SEARCH_PRIVACY_VERSION,
      workspaces,
      activeWorkspaceId: workspaces.some((workspace) => workspace.id === session?.activeWorkspaceId)
        ? session.activeWorkspaceId
        : workspaces[0].id,
      scrollPositions: Number(session?.version) >= 3 ? normalizeScrollPositions(session.scrollPositions) : {}
    };
  }

  const legacyTabs = migrateTabs(Array.isArray(session?.tabs) && session.tabs.length > 0
    ? session.tabs.map((tab, index) => normalizeTab(tab, `legacy-${index}`))
    : [normalizeTab(null, 'legacy-0')]);

  const legacyActiveTabId = legacyTabs.some((tab) => tab.id === session?.activeTabId)
    ? session.activeTabId
    : legacyTabs[0].id;

  const defaultWorkspace = normalizeWorkspace({
    id: makeRuntimeId('workspace'),
    name: defaultWorkspaceName(0),
    iconKey: WORKSPACE_ICON_KEYS[0],
    tabs: legacyTabs,
    activeTabId: legacyActiveTabId
  }, 0);

  return {
    version: 8,
    searchPrivacyVersion: SEARCH_PRIVACY_VERSION,
    workspaces: [defaultWorkspace],
    activeWorkspaceId: defaultWorkspace.id,
    scrollPositions: {}
  };
}

function normalizePersistedSessionPayload(payload) {
  return normalizeSessionState(payload);
}

function getManagedCoverDir() {
  const dirPath = path.join(getStateDir(), MANAGED_COVERS_DIRNAME);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function normalizeQueueItem(entry, index = 0) {
  if (!entry || typeof entry !== 'object') return null;
  const mangaId = String(entry.mangaId || '').trim();
  const chapterId = String(entry.chapterId || '').trim() || null;
  if (!mangaId) return null;

  const candidateSources = Array.isArray(entry.sources) && entry.sources.length > 0
    ? entry.sources
    : [entry.source || entry.displaySource || 'manual'];
  const sources = uniqueStrings(candidateSources);
  const priority = ['manual', 'quick-add', 'end-of-chapter', 'next-engine'];
  const displaySource = priority.find((source) => sources.includes(source)) || sources[0] || 'manual';
  const deferredAt = entry.deferredUntil == null ? null : Number(entry.deferredUntil);

  return {
    id: String(entry.id || `queue-${mangaId}-${chapterId || 'manga'}-${index}`),
    mangaId,
    chapterId,
    sources,
    displaySource,
    pinned: Boolean(entry.pinned),
    deferredUntil: Number.isFinite(deferredAt) ? deferredAt : null,
    updatedAt: String(entry.updatedAt || entry.createdAt || new Date().toISOString())
  };
}

function normalizeQueue(queue) {
  const dedup = new Map();
  (Array.isArray(queue) ? queue : []).forEach((entry, index) => {
    const normalized = normalizeQueueItem(entry, index);
    if (!normalized) return;
    const identity = normalized.chapterId ? `${normalized.mangaId}::${normalized.chapterId}` : `${normalized.mangaId}::manga`;
    const previous = dedup.get(identity);
    if (!previous) {
      dedup.set(identity, normalized);
      return;
    }
    const mergedSources = uniqueStrings([...(previous.sources || []), ...(normalized.sources || [])]);
    const priority = ['manual', 'quick-add', 'end-of-chapter', 'next-engine'];
    dedup.set(identity, {
      ...previous,
      ...normalized,
      id: previous.id,
      sources: mergedSources,
      displaySource: priority.find((source) => mergedSources.includes(source)) || mergedSources[0] || 'manual',
      pinned: Boolean(previous.pinned || normalized.pinned),
      updatedAt: new Date(Math.max(new Date(previous.updatedAt || 0).getTime(), new Date(normalized.updatedAt || 0).getTime())).toISOString()
    });
  });
  return [...dedup.values()].sort((a, b) => {
    if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
}

function normalizeMetadataFieldMap(map) {
  const next = {};
  for (const [mangaId, fields] of Object.entries(map && typeof map === 'object' ? map : {})) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    const fieldEntries = Object.entries(fields)
      .map(([field, value]) => [String(field || '').trim(), value])
      .filter(([field]) => Boolean(field));
    if (fieldEntries.length === 0) continue;
    next[mangaId] = Object.fromEntries(fieldEntries);
  }
  return next;
}

function normalizeScanIndex(scanIndex) {
  const sourceEntries = Array.isArray(scanIndex?.entries)
    ? scanIndex.entries
    : (scanIndex?.entries && typeof scanIndex.entries === 'object' ? Object.values(scanIndex.entries) : []);
  const entries = {};
  for (const value of sourceEntries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const pathValue = String(value.path || '').trim();
    const locationId = String(value.locationId || value.id || value.path || '').trim();
    if (!pathValue || !locationId) continue;
    const type = String(value.type || value.kind || '').trim() || 'item';
    const nullableNumber = (input) => {
      if (input === null || input === undefined || input === '') return null;
      const parsed = Number(input);
      return Number.isFinite(parsed) ? parsed : null;
    };
    entries[locationId] = {
      locationId,
      path: pathValue,
      kind: String(value.kind || value.type || '').trim() || 'item',
      type,
      legacyId: String(value.legacyId || '').trim() || null,
      contentId: String(value.contentId || '').trim() || null,
      containerType: String(value.containerType || '').trim() || null,
      sourceType: String(value.sourceType || '').trim() || null,
      healthStatus: String(value.healthStatus || '').trim() || 'ok',
      size: Number.isFinite(Number(value.size)) ? Number(value.size) : 0,
      mtimeMs: Number.isFinite(Number(value.mtimeMs)) ? Number(value.mtimeMs) : 0,
      pageCount: nullableNumber(value.pageCount),
      chapterCount: type === 'chapter' ? null : nullableNumber(value.chapterCount),
      signature: String(value.signature || '').trim() || null,
      categoryId: value.categoryId ? String(value.categoryId) : null,
      mangaContentId: value.mangaContentId ? String(value.mangaContentId) : null,
      lastError: value.lastError ? String(value.lastError) : null,
      updatedAt: value.updatedAt ? String(value.updatedAt) : null
    };
  }
  return {
    updatedAt: scanIndex?.updatedAt ? String(scanIndex.updatedAt) : null,
    entries
  };
}

function getImportedNsfwGenreSet(state, mangaId) {
  const metadata = state?.metadata?.[mangaId] || {};
  const isNhentaiImport = metadata.onlineSource === 'nhentai' || Boolean(metadata.nhentaiId);
  if (!isNhentaiImport) return new Set();
  return new Set(uniqueStrings(metadata.onlineGenres).map((value) => value.toLowerCase()));
}

function normalizeState(state) {
  const normalized = deepMerge(DEFAULT_STATE, state || {});
  normalized.version = STORAGE_VERSION;
  normalized.stateVersion = STATE_VERSION;
  normalized.scanIndexVersion = SCAN_INDEX_VERSION;
  normalized.queueVersion = QUEUE_VERSION;
  normalized.metadataVersion = METADATA_VERSION;

  normalized.categories = Array.isArray(normalized.categories)
    ? normalized.categories.map((category, index) => ({
        id: String(category?.id || `category-${index}`),
        path: String(category?.path || '').trim(),
        name: String(category?.name || path.basename(String(category?.path || 'Categorie'))).trim(),
        hidden: Boolean(category?.hidden),
        pathHistory: uniqueStrings([
          ...(Array.isArray(category?.pathHistory) ? category.pathHistory : []),
          category?.path
        ]).slice(-12),
        availability: ['available', 'missing', 'checking'].includes(category?.availability)
          ? category.availability
          : 'available',
        lastSeenAt: category?.lastSeenAt ? String(category.lastSeenAt) : null,
        missingSince: category?.missingSince ? String(category.missingSince) : null
      })).filter((category) => category.path)
    : [];

  normalized.session = normalizeSessionState(normalized.session, {
    sourceSearchPrivacyVersion: state?.session?.searchPrivacyVersion
  });
  normalized.session.version = 8;
  normalized.scanIndex = normalizeScanIndex(normalized.scanIndex);
  normalized.readingQueue = normalizeQueue(normalized.readingQueue);
  normalized.metadataLocks = normalizeMetadataFieldMap(normalized.metadataLocks);
  normalized.metadataFieldSource = normalizeMetadataFieldMap(normalized.metadataFieldSource);
  normalized.coverProfiles = normalized.coverProfiles && typeof normalized.coverProfiles === 'object' && !Array.isArray(normalized.coverProfiles)
    ? Object.fromEntries(
        Object.entries(normalized.coverProfiles)
          .map(([mangaId, profile]) => {
            const id = String(mangaId || '').trim();
            return id ? [id, rebaseManagedCoverProfile(profile, getManagedCoverDir(), id)] : null;
          })
          .filter(Boolean)
      )
    : {};
  for (const [mangaId, metadata] of Object.entries(normalized.metadata || {})) {
    if (!metadata || typeof metadata !== 'object') continue;
    const profile = normalizeCoverProfile(normalized.coverProfiles[mangaId], mangaId);
    const variants = [...profile.variants];
    const addLegacy = (kind, filePath, label) => {
      const normalizedPath = String(filePath || '').trim();
      if (!normalizedPath) return;
      const id = stableLegacyVariantId(kind, normalizedPath);
      if (variants.some((variant) => variant.id === id)) return;
      variants.push({
        id,
        hash: null,
        path: normalizedPath,
        fileName: path.basename(normalizedPath),
        kind,
        label,
        createdAt: null
      });
    };
    if (path.basename(String(metadata.coverPath || '')).toLowerCase().startsWith('.sawa-custom-cover')) {
      addLegacy('legacy-custom', metadata.coverPath, 'Ancienne couverture personnalisée');
    }
    if (path.basename(String(metadata.onlineCoverPath || '')).toLowerCase().startsWith('.sawa-online-cover')) {
      addLegacy('legacy-online', metadata.onlineCoverPath, 'Ancienne couverture en ligne');
    }
    if (variants.length > 0) {
      normalized.coverProfiles[mangaId] = normalizeCoverProfile({ ...profile, variants }, mangaId);
    }
    const activeVariant = normalized.coverProfiles[mangaId]?.variants?.find(
      (variant) => variant.id === normalized.coverProfiles[mangaId]?.activeVariantId
    );
    if (activeVariant?.kind === 'managed') {
      metadata.coverPath = activeVariant.path;
      metadata.coverMode = 'custom';
    }
  }

  normalized.mangaTags = normalized.mangaTags && typeof normalized.mangaTags === 'object' ? normalized.mangaTags : {};
  normalized.mangaTagMeta = normalized.mangaTagMeta && typeof normalized.mangaTagMeta === 'object' ? normalized.mangaTagMeta : {};
  normalized.annotations = normalized.annotations && typeof normalized.annotations === 'object' ? normalized.annotations : {};
  normalized.metadataWorkbenchQueue = uniqueStrings(normalized.metadataWorkbenchQueue);
  normalized.metadataWorkbenchItems = normalizeWorkbenchItems(
    normalized.metadataWorkbenchItems,
    normalized.metadataWorkbenchQueue
  );
  normalized.metadataWorkbenchQueue = normalized.metadataWorkbenchItems.map((item) => item.mangaId);
  normalized.metadataWorkbenchLastBatch = normalized.metadataWorkbenchLastBatch && typeof normalized.metadataWorkbenchLastBatch === 'object'
    ? normalized.metadataWorkbenchLastBatch
    : null;
  normalized.ui = normalized.ui && typeof normalized.ui === 'object' ? normalized.ui : {};
  const requestedTheme = String(normalized.ui.theme || DEFAULT_STATE.ui.theme).trim() || DEFAULT_STATE.ui.theme;
  const requestedInterfaceMode = String(normalized.ui.interfaceMode || '').trim();
  const migratingLegacyKavita = requestedTheme === 'kavita-clean' || requestedInterfaceMode === 'kavita-clean';
  normalized.ui.theme = migratingLegacyKavita ? 'dark-night' : requestedTheme;
  normalized.ui.interfaceMode = migratingLegacyKavita || requestedInterfaceMode === 'kavita'
    ? 'kavita'
    : 'sawa';
  normalized.ui.chapterCardSize = ['compact', 'comfortable', 'large'].includes(String(normalized.ui.chapterCardSize || '').trim())
    ? String(normalized.ui.chapterCardSize).trim()
    : DEFAULT_STATE.ui.chapterCardSize;
  normalized.ui.pagePreviewSize = ['compact', 'comfortable', 'large'].includes(String(normalized.ui.pagePreviewSize || '').trim())
    ? String(normalized.ui.pagePreviewSize).trim()
    : DEFAULT_STATE.ui.pagePreviewSize;
  normalized.ui.previewQuality = ['economy', 'balanced', 'high'].includes(String(normalized.ui.previewQuality || '').trim())
    ? String(normalized.ui.previewQuality).trim()
    : DEFAULT_STATE.ui.previewQuality;
  normalized.ui.sawaExperience = normalized.ui.sawaExperience === 'classic' ? 'classic' : 'horizon';
  normalized.ui.cinematicBackdrop = normalized.ui.cinematicBackdrop === undefined
    ? DEFAULT_STATE.ui.cinematicBackdrop
    : Boolean(normalized.ui.cinematicBackdrop);
  normalized.ui.cinematicIntensity = Math.min(100, Math.max(0, Number(normalized.ui.cinematicIntensity ?? DEFAULT_STATE.ui.cinematicIntensity) || 0));
  normalized.ui.foilEnabled = normalized.ui.foilEnabled === undefined
    ? DEFAULT_STATE.ui.foilEnabled
    : Boolean(normalized.ui.foilEnabled);
  normalized.ui.foilIntensity = Math.min(100, Math.max(0, Number(normalized.ui.foilIntensity ?? DEFAULT_STATE.ui.foilIntensity) || 0));
  normalized.ui.adaptiveVisualEffects = normalized.ui.adaptiveVisualEffects === undefined
    ? DEFAULT_STATE.ui.adaptiveVisualEffects
    : Boolean(normalized.ui.adaptiveVisualEffects);
  normalized.ui.readerFocusMode = normalized.ui.readerFocusMode === 'off' ? 'off' : 'auto';
  normalized.ui.readerControlsHideMs = Math.min(10000, Math.max(1000, Number(normalized.ui.readerControlsHideMs ?? DEFAULT_STATE.ui.readerControlsHideMs) || 3000));
  const providerInput = normalized.ui.metadataProviders && typeof normalized.ui.metadataProviders === 'object'
    ? normalized.ui.metadataProviders
    : {};
  const providerEnabledInput = providerInput.enabled && typeof providerInput.enabled === 'object'
    ? providerInput.enabled
    : {};
  normalized.ui.metadataProviders = {
    enabled: Object.fromEntries(Object.entries(DEFAULT_STATE.ui.metadataProviders.enabled).map(([providerId, fallback]) => [
      providerId,
      providerEnabledInput[providerId] === undefined ? fallback : Boolean(providerEnabledInput[providerId])
    ])),
    preferredAdultMirror: ['imhentai', 'hentaiera'].includes(providerInput.preferredAdultMirror)
      ? providerInput.preferredAdultMirror
      : DEFAULT_STATE.ui.metadataProviders.preferredAdultMirror,
    allowAdultHtmlFallback: Boolean(providerInput.allowAdultHtmlFallback)
  };
  const allowedSidebarSections = new Set(DEFAULT_SIDEBAR_SECTIONS);
  const rawSidebarSections = Array.isArray(normalized.ui.sidebarSections)
    ? normalized.ui.sidebarSections
    : [];
  const nextSidebarSections = uniqueStrings(rawSidebarSections)
    .filter((sectionId) => allowedSidebarSections.has(sectionId));
  normalized.ui.sidebarSections = nextSidebarSections.length > 0
    ? [
        ...nextSidebarSections,
        ...DEFAULT_SIDEBAR_SECTIONS.filter((sectionId) => !nextSidebarSections.includes(sectionId))
      ]
    : [...DEFAULT_SIDEBAR_SECTIONS];
  if (!normalized.ui.sidebarSections.includes('library')) {
    normalized.ui.sidebarSections.unshift('library');
  }
  const rawSidebarHiddenSections = normalized.ui.sidebarHiddenSections && typeof normalized.ui.sidebarHiddenSections === 'object'
    ? normalized.ui.sidebarHiddenSections
    : {};
  normalized.ui.sidebarHiddenSections = DEFAULT_SIDEBAR_SECTIONS.reduce((accumulator, sectionId) => {
    if (sectionId !== 'library' && rawSidebarHiddenSections[sectionId]) {
      accumulator[sectionId] = true;
    }
    return accumulator;
  }, {});
  normalized.ui.sidebarPins = Array.isArray(normalized.ui.sidebarPins)
    ? normalized.ui.sidebarPins
      .map((pin, index) => {
        const type = String(pin?.type || '').trim();
        const refId = String(pin?.refId || '').trim();
        if (!type || !refId) return null;
        return {
          id: String(pin?.id || `${type}-${refId}-${index}`),
          type,
          refId,
          label: String(pin?.label || '').trim() || null,
          icon: String(pin?.icon || '').trim() || null
        };
      })
      .filter(Boolean)
    : [];
  normalized.ui.maintenancePrefs = normalized.ui.maintenancePrefs && typeof normalized.ui.maintenancePrefs === 'object'
    ? {
        ...DEFAULT_STATE.ui.maintenancePrefs,
        ...normalized.ui.maintenancePrefs,
        mutedIssueTypes: uniqueStrings(normalized.ui.maintenancePrefs.mutedIssueTypes)
      }
    : structuredClone(DEFAULT_STATE.ui.maintenancePrefs);
  const rawKeyboardShortcuts = normalized.ui.keyboardShortcuts && typeof normalized.ui.keyboardShortcuts === 'object'
    ? normalized.ui.keyboardShortcuts
    : (normalized.ui.shortcuts && typeof normalized.ui.shortcuts === 'object' ? normalized.ui.shortcuts : {});
  normalized.ui.keyboardShortcuts = Object.fromEntries(
    Object.entries(DEFAULT_KEYBOARD_SHORTCUTS).map(([shortcutId, fallbackValue]) => {
      const rawValue = rawKeyboardShortcuts[shortcutId];
      if (Array.isArray(rawValue)) {
        const joined = rawValue
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
          .join('+');
        return [shortcutId, joined || fallbackValue];
      }
      const normalizedValue = String(rawValue || '').trim();
      return [shortcutId, normalizedValue || fallbackValue];
    })
  );
  normalized.ui.experimental = normalized.ui.experimental && typeof normalized.ui.experimental === 'object'
    ? {
        ...DEFAULT_STATE.ui.experimental,
        ...normalized.ui.experimental,
        schedulerProfile: ['interactive', 'balanced', 'idle-only'].includes(String(normalized.ui.experimental.schedulerProfile || '').trim())
          ? String(normalized.ui.experimental.schedulerProfile).trim()
          : DEFAULT_STATE.ui.experimental.schedulerProfile
      }
    : structuredClone(DEFAULT_STATE.ui.experimental);
  normalized.vault = normalized.vault && typeof normalized.vault === 'object'
    ? { ...DEFAULT_STATE.vault, ...normalized.vault }
    : structuredClone(DEFAULT_STATE.vault);
  normalized.vault.privateMangaIds = uniqueStrings(normalized.vault.privateMangaIds);
  normalized.vault.privateCategoryIds = uniqueStrings(normalized.vault.privateCategoryIds);
  normalized.vault.pinHash = normalized.vault.pinHash ? String(normalized.vault.pinHash) : null;
  normalized.vault.pinProtectedBlob = normalized.vault.pinProtectedBlob ? String(normalized.vault.pinProtectedBlob) : null;
  normalized.vault.blurCovers = Boolean(normalized.vault.blurCovers);
  normalized.vault.autoLockOnClose = true;
  normalized.vault.stealthMode = Boolean(normalized.vault.stealthMode);
  normalized.vault.securityMode = normalized.vault.pinProtectedBlob
    ? 'system'
    : (normalized.vault.pinHash ? 'basic' : 'none');
  normalized.vault.locked = (normalized.vault.pinHash || normalized.vault.pinProtectedBlob)
    ? Boolean(normalized.vault.locked)
    : false;
  normalized.identityAliases = normalized.identityAliases && typeof normalized.identityAliases === 'object' && !Array.isArray(normalized.identityAliases)
    ? Object.fromEntries(
        Object.entries(normalized.identityAliases)
          .map(([alias, target]) => [String(alias || '').trim(), String(target || '').trim()])
          .filter(([alias, target]) => alias && target)
      )
    : {};
  normalized.identityRecords = normalized.identityRecords && typeof normalized.identityRecords === 'object' && !Array.isArray(normalized.identityRecords)
    ? Object.fromEntries(
        Object.entries(normalized.identityRecords)
          .map(([mangaId, record]) => {
            if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
            const normalizedId = String(record.mangaId || mangaId || '').trim();
            if (!normalizedId) return null;
            return [normalizedId, {
              ...record,
              mangaId: normalizedId,
              path: String(record.path || '').trim() || null,
              title: String(record.title || '').trim(),
              normalizedTitles: uniqueStrings(record.normalizedTitles),
              author: String(record.author || '').trim(),
              normalizedAuthor: String(record.normalizedAuthor || '').trim(),
              externalIds: uniqueStrings(record.externalIds),
              chapterFingerprints: uniqueStrings(record.chapterFingerprints),
              private: Boolean(record.private),
              strongFingerprint: String(record.strongFingerprint || '').trim() || null
            }];
          })
          .filter(Boolean)
      )
    : {};
  normalized.deletionTombstones = normalized.deletionTombstones
    && typeof normalized.deletionTombstones === 'object'
    && !Array.isArray(normalized.deletionTombstones)
    ? Object.fromEntries(
        Object.entries(normalized.deletionTombstones)
          .map(([mangaId, tombstone]) => {
            const normalizedId = String(mangaId || '').trim();
            const sanitized = sanitizeDeletionTombstone(tombstone, normalizedId);
            return normalizedId && sanitized ? [normalizedId, sanitized] : null;
          })
          .filter(Boolean)
      )
    : {};
  normalized.relocationJournal = (Array.isArray(normalized.relocationJournal) ? normalized.relocationJournal : [])
    .filter((entry) => entry && typeof entry === 'object' && entry.id && entry.entityId)
    .map((entry) => ({
      ...entry,
      id: String(entry.id),
      kind: entry.kind === 'manga' ? 'manga' : 'category',
      entityId: String(entry.entityId),
      fromPath: String(entry.fromPath || ''),
      toPath: String(entry.toPath || ''),
      appliedAt: String(entry.appliedAt || new Date().toISOString()),
      undoUntil: String(entry.undoUntil || entry.appliedAt || new Date().toISOString()),
      undoneAt: entry.undoneAt ? String(entry.undoneAt) : null
    }))
    .filter((entry) => Date.now() - Date.parse(entry.appliedAt) <= 30 * 24 * 60 * 60 * 1000)
    .slice(-50);
  normalized.progress = normalized.progress && typeof normalized.progress === 'object' && !Array.isArray(normalized.progress)
    ? Object.fromEntries(Object.entries(normalized.progress).map(([chapterId, progress]) => {
        const source = progress && typeof progress === 'object' ? progress : {};
        const pageIndex = Math.max(0, Math.floor(Number(source.pageIndex) || 0));
        return [chapterId, {
          ...source,
          pageIndex,
          furthestPageIndex: Math.max(pageIndex, Math.floor(Number(source.furthestPageIndex) || 0)),
          anchorPageIndex: Number.isFinite(Number(source.anchorPageIndex))
            ? Math.max(0, Math.floor(Number(source.anchorPageIndex)))
            : pageIndex,
          intraPageOffset: Number.isFinite(Number(source.intraPageOffset))
            ? Math.max(0, Number(source.intraPageOffset))
            : 0
        }];
      }))
    : {};
  const identityNow = new Date().toISOString();
  normalized.identitySuggestions = (Array.isArray(normalized.identitySuggestions) ? normalized.identitySuggestions : [])
    .map((suggestion) => {
      if (!suggestion || typeof suggestion !== 'object') return null;
      const id = String(suggestion.id || '').trim();
      const fromMangaId = String(suggestion.fromMangaId || '').trim();
      const toMangaId = String(suggestion.toMangaId || '').trim();
      if (!id || !fromMangaId || !toMangaId || fromMangaId === toMangaId) return null;
      return {
        id,
        kind: ['move', 'edition'].includes(suggestion.kind) ? suggestion.kind : 'move',
        status: ['pending', 'accepted', 'rejected'].includes(suggestion.status) ? suggestion.status : 'pending',
        fromMangaId,
        toMangaId,
        fromPath: String(suggestion.fromPath || '').trim() || null,
        toPath: String(suggestion.toPath || '').trim() || null,
        score: Math.max(0, Math.min(1, Number(suggestion.score || 0))),
        reasons: uniqueStrings(suggestion.reasons),
        createdAt: suggestion.createdAt || identityNow,
        decidedAt: suggestion.decidedAt || null
      };
    })
    .filter(Boolean)
    .slice(-256);
  normalized.identityMediaIssues = (Array.isArray(normalized.identityMediaIssues) ? normalized.identityMediaIssues : [])
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return null;
      const mangaId = String(issue.mangaId || '').trim();
      const chapterId = String(issue.chapterId || '').trim() || null;
      if (!mangaId) return null;
      return {
        type: 'identity-media-unreadable',
        severity: 'warning',
        mangaId,
        chapterId,
        path: String(issue.path || '').trim() || null,
        failedPath: String(issue.failedPath || '').trim() || null,
        reason: String(issue.reason || 'media-unreadable').trim(),
        code: String(issue.code || '').trim() || null
      };
    })
    .filter(Boolean)
    .slice(-256);
  normalized.workGroups = normalized.workGroups && typeof normalized.workGroups === 'object' && !Array.isArray(normalized.workGroups)
    ? Object.fromEntries(
        Object.entries(normalized.workGroups)
          .map(([groupId, group]) => {
            if (!group || typeof group !== 'object' || Array.isArray(group)) return null;
            const id = String(group.id || groupId || '').trim();
            const editionIds = uniqueStrings(group.editionIds);
            if (!id || editionIds.length < 2) return null;
            const preferredEditionId = editionIds.includes(group.preferredEditionId)
              ? group.preferredEditionId
              : editionIds[0];
            return [id, {
              id,
              title: String(group.title || '').trim(),
              editionIds,
              preferredEditionId,
              favorite: Boolean(group.favorite),
              tagIds: uniqueStrings(group.tagIds),
              collectionIds: uniqueStrings(group.collectionIds),
              private: Boolean(group.private),
              createdAt: group.createdAt || identityNow,
              updatedAt: group.updatedAt || group.createdAt || identityNow
            }];
          })
          .filter(Boolean)
      )
    : {};
  normalized.collections = Object.fromEntries(
    Object.entries(normalized.collections && typeof normalized.collections === 'object' ? normalized.collections : {})
      .map(([collectionId, collection]) => {
        if (!collection || typeof collection !== 'object') return null;
        const id = String(collection.id || collectionId || '').trim();
        if (!id) return null;
        return [id, {
          ...collection,
          id,
          name: String(collection.name || 'Collection').trim(),
          description: String(collection.description || '').trim(),
          color: String(collection.color || '#8b5cf6').trim(),
          mangaIds: uniqueStrings(collection.mangaIds),
          appearance: normalizeCollectionAppearance(collection.appearance),
          createdAt: collection.createdAt || null
        }];
      })
      .filter(Boolean)
  );
  normalized.smartCollections = Object.fromEntries(
    Object.entries({
      ...DEFAULT_STATE.smartCollections,
      ...(normalized.smartCollections && typeof normalized.smartCollections === 'object' ? normalized.smartCollections : {})
    })
      .map(([collectionId, collection]) => {
        if (!collection || typeof collection !== 'object') return null;
        return [
          collectionId,
          {
            id: collectionId,
            builtIn: Boolean(DEFAULT_STATE.smartCollections[collectionId]?.builtIn || collection.builtIn || collectionId.startsWith('smart-')),
            name: String(collection.name || DEFAULT_STATE.smartCollections[collectionId]?.name || collectionId).trim(),
            icon: String(collection.icon || DEFAULT_STATE.smartCollections[collectionId]?.icon || 'layers').trim(),
            color: String(collection.color || DEFAULT_STATE.smartCollections[collectionId]?.color || '#64748b').trim(),
            description: String(collection.description || DEFAULT_STATE.smartCollections[collectionId]?.description || '').trim(),
            appearance: normalizeCollectionAppearance(collection.appearance),
            rules: collection.rules && typeof collection.rules === 'object'
              ? collection.rules
              : (DEFAULT_STATE.smartCollections[collectionId]?.rules || { type: 'unread' })
          }
        ];
      })
      .filter(Boolean)
  );

  const now = new Date().toISOString();
  const validTagIds = new Set(Object.keys(normalized.tags || {}));

  for (const mangaId of Object.keys(normalized.mangaTags)) {
    const nextTagIds = uniqueStrings(normalized.mangaTags[mangaId]).filter((tagId) => validTagIds.has(tagId));
    if (nextTagIds.length === 0) {
      delete normalized.mangaTags[mangaId];
      delete normalized.mangaTagMeta[mangaId];
      continue;
    }

    normalized.mangaTags[mangaId] = nextTagIds;
    const existingMeta = normalized.mangaTagMeta[mangaId] && typeof normalized.mangaTagMeta[mangaId] === 'object'
      ? normalized.mangaTagMeta[mangaId]
      : {};
    const nsfwGenreNames = getImportedNsfwGenreSet(normalized, mangaId);
    const nextMeta = {};

    for (const tagId of nextTagIds) {
      const currentMeta = existingMeta[tagId] && typeof existingMeta[tagId] === 'object'
        ? { ...existingMeta[tagId] }
        : {};
      const tagName = String(normalized.tags?.[tagId]?.name || '').trim().toLowerCase();
      if (tagName && nsfwGenreNames.has(tagName)) {
        currentMeta.nsfw = true;
        currentMeta.source = currentMeta.source || 'nhentai';
        if (currentMeta.autoImported === undefined) currentMeta.autoImported = true;
        if (!currentMeta.markedAt) currentMeta.markedAt = now;
      }
      if (Object.keys(currentMeta).length > 0) nextMeta[tagId] = currentMeta;
    }

    if (Object.keys(nextMeta).length > 0) normalized.mangaTagMeta[mangaId] = nextMeta;
    else delete normalized.mangaTagMeta[mangaId];
  }

  for (const mangaId of Object.keys(normalized.mangaTagMeta)) {
    if (!normalized.mangaTags[mangaId]) delete normalized.mangaTagMeta[mangaId];
  }

  for (const mangaId of Object.keys(normalized.annotations)) {
    const items = Array.isArray(normalized.annotations[mangaId]) ? normalized.annotations[mangaId] : [];
    const nextItems = items
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const chapterId = String(item.chapterId || '').trim();
        if (!chapterId) return null;
        const pageIndex = Number(item.pageIndex);
        return {
          id: String(item.id || makeRuntimeId('annotation')),
          mangaId,
          chapterId,
          pageIndex: Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0,
          label: String(item.label || '').trim() || 'Repere',
          note: String(item.note || '').trim(),
          createdAt: item.createdAt || now,
          updatedAt: item.updatedAt || item.createdAt || now
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

    if (nextItems.length > 0) normalized.annotations[mangaId] = nextItems;
    else delete normalized.annotations[mangaId];
  }

  return normalized;
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_error) {
    return null;
  }
}

function pickStateKeys(source, keys = []) {
  return Object.fromEntries(
    keys
      .filter((key) => Object.prototype.hasOwnProperty.call(source || {}, key))
      .map((key) => [key, source[key]])
  );
}

function splitStateForStorage(state) {
  const normalized = normalizeState(state);
  const rootState = pickStateKeys(normalized, ROOT_STATE_KEYS);
  const userData = Object.fromEntries(
    Object.entries(USER_DATA_KEY_GROUPS).map(([group, keys]) => [group, pickStateKeys(normalized, keys)])
  );
  return { rootState, userData, normalized };
}

// Regrouper les rafales interactives (progression, favoris, scroll) sur une
// fenetre assez large pour qu aucune serialisation de segment ne concurrence
// le retour visuel. La fermeture force toujours un flush borne a 2 secondes.
const WRITE_DEBOUNCE_MS = Number.parseInt(process.env.SAWA_STATE_WRITE_DEBOUNCE_MS || '1200', 10);
let pendingWriteState = null;
let pendingWriteSegments = new Set();
let writeTimer = null;
const statePersistence = createAtomicJsonPersistence({ maxConcurrent: 2 });
const scheduledSegmentJson = new Map();
const queuedSegmentJson = new Map();

function writeStateBundleToDisk(normalized, segments = null) {
  const selected = segments instanceof Set && segments.size > 0
    ? segments
    : new Set(['root', ...Object.keys(USER_DATA_KEY_GROUPS)]);
  const statePath = getStatePath();
  const storePaths = getUserDataStorePaths();
  const entries = [];
  if (selected.has('root')) {
    entries.push([statePath, JSON.stringify(pickStateKeys(normalized, ROOT_STATE_KEYS), null, 2)]);
  }
  Object.entries(storePaths).forEach(([group, filePath]) => {
    if (!selected.has(group)) return;
    entries.push([filePath, JSON.stringify(pickStateKeys(normalized, USER_DATA_KEY_GROUPS[group] || []), null, 2)]);
  });
  let changedCount = 0;
  entries.forEach(([filePath, serialized]) => {
    if (
      scheduledSegmentJson.get(filePath) === serialized
      || queuedSegmentJson.get(filePath) === serialized
    ) return;
    queuedSegmentJson.set(filePath, serialized);
    statePersistence.schedule(filePath, serialized, {
      onSuccess: ({ content }) => {
        if (queuedSegmentJson.get(filePath) !== content) return;
        queuedSegmentJson.delete(filePath);
        scheduledSegmentJson.set(filePath, content);
      }
    });
    changedCount += 1;
  });
  return changedCount;
}

function writeStateBundleImmediately(nextState) {
  const { normalized, rootState, userData } = splitStateForStorage(nextState);
  const entries = [
    [getStatePath(), rootState],
    ...Object.entries(getUserDataStorePaths()).map(([group, filePath]) => [filePath, userData[group] || {}])
  ];
  entries.forEach(([filePath, value]) => {
    const serialized = JSON.stringify(value, null, 2);
    const temporaryPath = `${filePath}.recovery-${process.pid}-${Date.now()}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, serialized, 'utf8');
    fs.renameSync(temporaryPath, filePath);
    queuedSegmentJson.delete(filePath);
    scheduledSegmentJson.set(filePath, serialized);
  });
  cachedState = normalized;
  return normalized;
}

function getBackupImportJournalPath() {
  return path.join(getStateDir(), BACKUP_IMPORT_JOURNAL_FILE);
}

function writeBackupImportJournal(value) {
  const journalPath = getBackupImportJournalPath();
  const temporaryPath = `${journalPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporaryPath, journalPath);
  return journalPath;
}

function recoverIncompleteBackupImport() {
  const journalPath = getBackupImportJournalPath();
  if (!fs.existsSync(journalPath)) {
    try { recoverManagedCoverTransaction(getManagedCoverDir()); } catch (_error) {}
    return { recovered: false };
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  if (journal.phase === 'committed') {
    recoverManagedCoverTransaction(getManagedCoverDir(), { commit: true });
    fs.rmSync(journalPath, { force: true });
    return { recovered: true, committed: true };
  }
  recoverManagedCoverTransaction(getManagedCoverDir());
  const backup = JSON.parse(fs.readFileSync(journal.preImportBackupPath, 'utf8'));
  if (!backup?.state) throw new Error('Etat pre-import introuvable pour recovery.');
  writeStateBundleImmediately(normalizeState(backup.state));
  fs.rmSync(journalPath, { force: true });
  return { recovered: true, committed: false };
}

async function flushStateWrites() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const pending = pendingWriteState;
  const segments = pendingWriteSegments;
  pendingWriteState = null;
  pendingWriteSegments = new Set();
  if (pending) writeStateBundleToDisk(pending, segments);
  const result = await statePersistence.flush();
  if (!result.ok) console.error('[storage] flushStateWrites failed:', result.error);
  return result.ok;
}

function scheduleStateWrite(normalized, segments = null) {
  pendingWriteState = normalized;
  const selected = segments instanceof Set
    ? segments
    : new Set(Array.isArray(segments) ? segments : ['root', ...Object.keys(USER_DATA_KEY_GROUPS)]);
  selected.forEach((segment) => pendingWriteSegments.add(segment));
  if (writeTimer) return;
  // Debounce must not be 0: if someone sets it to 0 we still fall through the timer so writes happen on next tick.
  const delay = Number.isFinite(WRITE_DEBOUNCE_MS) && WRITE_DEBOUNCE_MS >= 0 ? WRITE_DEBOUNCE_MS : 1200;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const pending = pendingWriteState;
    const pendingSegments = pendingWriteSegments;
    pendingWriteState = null;
    pendingWriteSegments = new Set();
    if (!pending) return;
    writeStateBundleToDisk(pending, pendingSegments);
  }, delay);
  // Ensure the timer does not keep the event loop alive past normal shutdown.
  if (typeof writeTimer.unref === 'function') writeTimer.unref();
}

function writeSplitStateFiles(nextState) {
  const { normalized } = splitStateForStorage(nextState);
  cachedState = normalized;
  scheduleStateWrite(normalized);
  return normalized;
}

function loadSplitState() {
  const statePath = getStatePath();
  const storePaths = getUserDataStorePaths();
  const hasRootState = fs.existsSync(statePath);
  const hasUserData = Object.values(storePaths).some((filePath) => fs.existsSync(filePath));
  if (!hasRootState && !hasUserData) return null;

  const rootState = readJsonFile(statePath) || {};
  const merged = { ...rootState };
  for (const [group, filePath] of Object.entries(storePaths)) {
    const segment = readJsonFile(filePath);
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) continue;
    Object.assign(merged, pickStateKeys(segment, USER_DATA_KEY_GROUPS[group] || []));
  }
  const primed = splitStateForStorage(merged);
  scheduledSegmentJson.set(statePath, JSON.stringify(primed.rootState, null, 2));
  queuedSegmentJson.delete(statePath);
  Object.entries(storePaths).forEach(([group, filePath]) => {
    scheduledSegmentJson.set(filePath, JSON.stringify(primed.userData[group] || {}, null, 2));
    queuedSegmentJson.delete(filePath);
  });
  return merged;
}

function migrateLegacyState(rawState, sourceLabel = 'legacy') {
  const migrated = normalizeState(rawState || {});
  migrated.migrationLog = Array.isArray(migrated.migrationLog) ? migrated.migrationLog : [];
  migrated.migrationLog.push({
    from: Number(rawState?.stateVersion || rawState?.version || 1),
    to: STATE_VERSION,
    source: sourceLabel,
    date: new Date().toISOString()
  });
  return migrated;
}

function migrateFromV1(v1State) {
  return migrateLegacyState(v1State, 'v1');
}

function loadState() {
  if (cachedState) return cachedState;
  try {
    recoverIncompleteBackupImport();
  } catch (error) {
    console.error('[storage] backup import recovery failed:', error?.message || error);
  }
  const splitState = loadSplitState();
  if (splitState) {
    try {
      const parsed = splitState;
      if (parsed?.stateVersion === STATE_VERSION) {
        cachedState = normalizeState(parsed);
        return cachedState;
      }
      const migrated = migrateLegacyState(parsed, 'split-state');
      saveState(migrated);
      return migrated;
    } catch (_error) {
      // continue to legacy fallback below
    }
  }

  const legacyV2Path = getLegacyV2StatePath();
  if (fs.existsSync(legacyV2Path)) {
    try {
      const raw = fs.readFileSync(legacyV2Path, 'utf-8');
      const parsed = JSON.parse(raw);
      const backupPath = path.join(getBackupDir(), `v2-auto-backup-${Date.now()}.json`);
      fs.writeFileSync(backupPath, raw, 'utf-8');
      const migrated = migrateLegacyState(parsed, 'legacy-v2-path');
      saveState(migrated);
      return migrated;
    } catch (_error) {
      // continue to legacy fallback below
    }
  }

  const legacyPath = getLegacyStatePath();
  if (fs.existsSync(legacyPath)) {
    try {
      const raw = fs.readFileSync(legacyPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const backupPath = path.join(getBackupDir(), `v1-auto-backup-${Date.now()}.json`);
      fs.writeFileSync(backupPath, raw, 'utf-8');
      const migrated = migrateLegacyState(parsed, 'legacy-path');
      saveState(migrated);
      return migrated;
    } catch (_error) {
      // continue to fresh state below
    }
  }

  const fresh = normalizeState(structuredClone(DEFAULT_STATE));
  saveState(fresh);
  return fresh;
}

function saveState(nextState) {
  if (runtimeStateReadOnly) {
    cachedState = normalizeState(nextState);
    return cachedState;
  }
  return writeSplitStateFiles(nextState);
}

function activateRuntimeStateOverride(state, options = {}) {
  cachedState = normalizeState(state || {});
  runtimeStateReadOnly = options.readOnly !== false;
  return cachedState;
}

function updateState(updater) {
  const current = loadState();
  const next = updater(structuredClone(current));
  return saveState(next);
}

function updateStateSegments(selection = {}, updater) {
  const current = loadState();
  const allowedBySegment = { root: ROOT_STATE_KEYS, ...USER_DATA_KEY_GROUPS };
  const selectedEntries = Object.entries(selection || {}).filter(([segment]) => allowedBySegment[segment]);
  if (selectedEntries.length === 0) return updateState(updater);

  const next = { ...current };
  selectedEntries.forEach(([segment, requestedKeys]) => {
    const allowed = new Set(allowedBySegment[segment]);
    const keys = Array.isArray(requestedKeys) && requestedKeys.length > 0
      ? requestedKeys.filter((key) => allowed.has(key))
      : [...allowed];
    keys.forEach((key) => {
      next[key] = structuredClone(current[key]);
    });
  });
  const updated = updater(next) || next;
  cachedState = updated;
  scheduleStateWrite(updated, selectedEntries.map(([segment]) => segment));
  return updated;
}

function createBackup(label = '') {
  const state = loadState();
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const fileName = `sawa-backup-${stamp}${label ? `-${label.replace(/[^a-zA-Z0-9]/g, '_')}` : ''}.json`;
  const backupPath = path.join(getBackupDir(), fileName);
  const manifest = {
    app: 'sawa-manga-library',
    version: '5.0.1',
    storageVersion: STORAGE_VERSION,
    stateVersion: STATE_VERSION,
    scanIndexVersion: SCAN_INDEX_VERSION,
    queueVersion: QUEUE_VERSION,
    metadataVersion: METADATA_VERSION,
    createdAt: now.toISOString(),
    label: label || 'Manual backup',
    stats: {
      categories: state.categories.length,
      favorites: Object.keys(state.favorites).length,
      tags: Object.keys(state.tags).length,
      collections: Object.keys(state.collections).length,
      progress: Object.keys(state.progress).length,
      metadata: Object.keys(state.metadata).length,
      readingQueue: state.readingQueue.length
    }
  };
  fs.writeFileSync(backupPath, JSON.stringify({ manifest, state }, null, 2), 'utf-8');
  updateState((nextState) => {
    nextState.backupHistory.push({ path: backupPath, createdAt: now.toISOString(), label: manifest.label, stats: manifest.stats });
    if (nextState.backupHistory.length > 20) nextState.backupHistory = nextState.backupHistory.slice(-20);
    return nextState;
  });
  return { path: backupPath, manifest };
}

async function exportBackup(targetPath, label = '') {
  return runHeavyIoTask('backup-export', {
    targetPath,
    state: loadState(),
    managedCoverDir: getManagedCoverDir(),
    appVersion: '5.0.1',
    storageVersion: STORAGE_VERSION,
    stateVersion: STATE_VERSION,
    label
  });
}

async function rollbackBackupImport(options = {}) {
  const errors = [];
  let coversRolledBack = true;
  let stateRolledBack = false;
  if (options.coverTransaction) {
    try {
      await options.coverTransaction.rollback();
    } catch (error) {
      coversRolledBack = false;
      errors.push(`couvertures: ${error?.message || String(error)}`);
    }
  }

  try {
    options.saveStateFn(options.previousState);
    const flushed = await options.flushStateFn();
    stateRolledBack = flushed === true;
    if (!stateRolledBack) errors.push('etat: la reecriture de restauration a echoue');
  } catch (error) {
    errors.push(`etat: ${error?.message || String(error)}`);
  }

  return {
    rolledBack: coversRolledBack && stateRolledBack,
    coversRolledBack,
    stateRolledBack,
    rollbackError: errors.length > 0 ? errors.join('; ') : null
  };
}

function serializeBackupImport(operation) {
  const current = backupImportTail.then(() => operation());
  backupImportTail = current.catch(() => {});
  return current;
}

async function importBackupTransaction(backupFilePath) {
  const staged = await runHeavyIoTask('backup-stage', { filePath: backupFilePath });
  const previous = structuredClone(loadState());
  const preImport = createBackup('pre-import-auto');
  let coverTransaction = null;
  let transactionCommitted = false;
  writeBackupImportJournal({
    version: 1,
    phase: 'prepared',
    preImportBackupPath: preImport.path,
    createdAt: new Date().toISOString()
  });
  try {
    const imported = normalizeState(staged.state);
    saveState(imported);
    const persisted = await flushStateWrites();
    if (!persisted) throw new Error('La sauvegarde a ete validee mais son etat n a pas pu etre ecrit sur disque.');
    if (staged.stagedCoverDir) {
      const managedCoverDir = getManagedCoverDir();
      const transaction = await runHeavyIoTask('covers-replace', {
        stagedCoverDir: staged.stagedCoverDir,
        managedCoverDir
      });
      coverTransaction = {
        ...transaction,
        rollback: () => runHeavyIoTask('covers-rollback', { managedCoverDir }),
        commit: () => runHeavyIoTask('covers-commit', { managedCoverDir })
      };
    }
    writeBackupImportJournal({
      version: 1,
      phase: 'committed',
      preImportBackupPath: preImport.path,
      createdAt: new Date().toISOString()
    });
    transactionCommitted = true;
    await coverTransaction?.commit();
    fs.rmSync(getBackupImportJournalPath(), { force: true });
    return {
      ok: true,
      restored: true,
      legacy: staged.legacy,
      manifest: staged.manifest,
      preImportBackupPath: preImport.path,
      coversRestored: Boolean(coverTransaction?.changed)
    };
  } catch (error) {
    if (transactionCommitted) {
      return {
        ok: true,
        restored: true,
        cleanupPending: true,
        error: `Import applique; nettoyage transactionnel differe: ${error?.message || error}`,
        preImportBackupPath: preImport.path
      };
    }
    const rollback = await rollbackBackupImport({
      coverTransaction,
      previousState: previous,
      saveStateFn: saveState,
      flushStateFn: flushStateWrites
    });
    if (rollback.rolledBack) fs.rmSync(getBackupImportJournalPath(), { force: true });
    const primaryError = error?.message || 'Import de sauvegarde impossible.';
    return {
      ok: false,
      restored: false,
      ...rollback,
      error: rollback.rolledBack
        ? primaryError
        : `${primaryError} Restauration incomplete: ${rollback.rollbackError || 'cause inconnue'}.`,
      preImportBackupPath: preImport.path
    };
  } finally {
    await runHeavyIoTask('backup-cleanup', { staged }).catch(() => cleanupStagedBackup(staged));
  }
}

function importBackup(backupFilePath) {
  return serializeBackupImport(() => importBackupTransaction(backupFilePath));
}

function listBackups() {
  const dir = getBackupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((fileName) => fileName.endsWith('.json')).map((fileName) => {
    const fullPath = path.join(dir, fileName);
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return { path: fullPath, fileName, manifest: parsed.manifest || null, size: fs.statSync(fullPath).size };
    } catch (_error) {
      return { path: fullPath, fileName, manifest: null, size: 0 };
    }
  }).sort((a, b) => (b.manifest?.createdAt || '').localeCompare(a.manifest?.createdAt || ''));
}

function clearDirectoryContents(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, entry);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch (_error) {
      // noop
    }
  }
}

function clearDerivedArtifacts() {
  clearDirectoryContents(getDerivedDir());
  clearDirectoryContents(getCacheDir());
  return {
    derivedDir: getDerivedDir(),
    cacheDir: getCacheDir(),
    dbPath: getDerivedDbPath()
  };
}

function createTag(name, color = '#8b5cf6') {
  return updateStateSegments({ organization: ['tags'] }, (state) => {
    const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.tags[id] = { id, name: name.trim(), color, createdAt: new Date().toISOString() };
    return state;
  });
}

function deleteTag(tagId) {
  return updateStateSegments({ organization: ['tags', 'mangaTags', 'mangaTagMeta'] }, (state) => {
    delete state.tags[tagId];
    for (const mangaId of Object.keys(state.mangaTags)) {
      state.mangaTags[mangaId] = (state.mangaTags[mangaId] || []).filter((id) => id !== tagId);
      if (state.mangaTags[mangaId].length === 0) {
        delete state.mangaTags[mangaId];
        delete state.mangaTagMeta[mangaId];
        continue;
      }
      if (state.mangaTagMeta?.[mangaId]) {
        delete state.mangaTagMeta[mangaId][tagId];
        if (Object.keys(state.mangaTagMeta[mangaId]).length === 0) delete state.mangaTagMeta[mangaId];
      }
    }
    return state;
  });
}

function getWorkEditionIds(state, mangaId) {
  const normalizedId = String(mangaId || '').trim();
  const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(normalizedId));
  return group ? [...group.editionIds] : [normalizedId];
}

function setMangaTags(mangaId, tagIds, tagMeta = null) {
  return updateStateSegments({ organization: ['mangaTags', 'mangaTagMeta'], identity: ['workGroups'] }, (state) => {
    const nextTagIds = uniqueStrings(tagIds).filter((tagId) => state.tags[tagId]);
    for (const editionId of getWorkEditionIds(state, mangaId)) {
      if (nextTagIds.length === 0) {
        delete state.mangaTags[editionId];
        delete state.mangaTagMeta[editionId];
        continue;
      }
      state.mangaTags[editionId] = nextTagIds;
      const prevMeta = state.mangaTagMeta?.[editionId] && typeof state.mangaTagMeta[editionId] === 'object' ? state.mangaTagMeta[editionId] : {};
      const nextMeta = {};
      for (const tagId of nextTagIds) {
        const metaPatch = tagMeta?.[tagId] && typeof tagMeta[tagId] === 'object' ? tagMeta[tagId] : null;
        const mergedMeta = { ...(prevMeta[tagId] || {}), ...(metaPatch || {}) };
        if (Object.keys(mergedMeta).length > 0) nextMeta[tagId] = mergedMeta;
      }
      if (Object.keys(nextMeta).length > 0) state.mangaTagMeta[editionId] = nextMeta;
      else delete state.mangaTagMeta[editionId];
    }
    const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
    if (group) group.tagIds = nextTagIds;
    return state;
  });
}

function addTagToManga(mangaId, tagId, meta = null) {
  return updateStateSegments({ organization: ['mangaTags', 'mangaTagMeta'], identity: ['workGroups'] }, (state) => {
    for (const editionId of getWorkEditionIds(state, mangaId)) {
      const current = state.mangaTags[editionId] || [];
      if (!current.includes(tagId)) state.mangaTags[editionId] = [...current, tagId];
      if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
        state.mangaTagMeta[editionId] = state.mangaTagMeta[editionId] && typeof state.mangaTagMeta[editionId] === 'object' ? state.mangaTagMeta[editionId] : {};
        state.mangaTagMeta[editionId][tagId] = { ...(state.mangaTagMeta[editionId][tagId] || {}), ...meta };
      }
    }
    const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
    if (group) group.tagIds = uniqueStrings([...(group.tagIds || []), tagId]);
    return state;
  });
}

function removeTagFromManga(mangaId, tagId) {
  return updateStateSegments({ organization: ['mangaTags', 'mangaTagMeta'], identity: ['workGroups'] }, (state) => {
    for (const editionId of getWorkEditionIds(state, mangaId)) {
      state.mangaTags[editionId] = (state.mangaTags[editionId] || []).filter((id) => id !== tagId);
      if (state.mangaTags[editionId].length === 0) {
        delete state.mangaTags[editionId];
        delete state.mangaTagMeta[editionId];
        continue;
      }
      if (state.mangaTagMeta?.[editionId]) {
        delete state.mangaTagMeta[editionId][tagId];
        if (Object.keys(state.mangaTagMeta[editionId]).length === 0) delete state.mangaTagMeta[editionId];
      }
    }
    const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
    if (group) group.tagIds = (group.tagIds || []).filter((id) => id !== tagId);
    return state;
  });
}

function createCollection(name, description = '', color = '#8b5cf6', appearance = null) {
  return updateStateSegments({ organization: ['collections'] }, (state) => {
    const id = `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.collections[id] = {
      id,
      name: name.trim(),
      description,
      color,
      mangaIds: [],
      appearance: normalizeCollectionAppearance(appearance),
      createdAt: new Date().toISOString()
    };
    return state;
  });
}

function deleteCollection(collectionId) {
  return updateStateSegments({ organization: ['collections'] }, (state) => {
    delete state.collections[collectionId];
    return state;
  });
}

function sanitizeCollectionPatch(patch) {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const next = {};
  if (Object.prototype.hasOwnProperty.call(source, 'name')) {
    const name = String(source.name || '').trim();
    if (name) next.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'description')) {
    next.description = String(source.description || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(source, 'color')) {
    const color = String(source.color || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) next.color = color;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'appearance')) {
    next.appearance = normalizeCollectionAppearance(source.appearance);
  }
  return next;
}

const WORKBENCH_STATUSES = new Set([
  'pending',
  'analyzing',
  'reliable',
  'review',
  'no-result',
  'error',
  'done',
  'interrupted'
]);

function normalizeWorkbenchCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const identity = String(candidate.identity || `${candidate.source || ''}:${candidate.sourceId || ''}`).trim();
  if (!identity) return null;
  return {
    identity,
    source: String(candidate.source || '').trim(),
    sourceLabel: String(candidate.sourceLabel || candidate.source || '').trim(),
    sourceId: String(candidate.sourceId || '').trim(),
    title: String(candidate.title || '').trim(),
    titleEnglish: String(candidate.titleEnglish || '').trim() || null,
    titleJapanese: String(candidate.titleJapanese || '').trim() || null,
    altTitles: uniqueStrings(candidate.altTitles).slice(0, 30),
    synopsis: String(candidate.synopsis || '').trim() || null,
    authors: String(candidate.authors || '').trim(),
    tags: uniqueStrings(candidate.tags || candidate.genres).slice(0, 60),
    reasons: uniqueStrings(candidate.reasons).slice(0, 10),
    confidence: Number.isFinite(Number(candidate.confidence)) ? Math.max(0, Math.min(1, Number(candidate.confidence))) : null,
    pages: Number.isFinite(Number(candidate.pages)) ? Number(candidate.pages) : null,
    chapters: Number.isFinite(Number(candidate.chapters)) ? Number(candidate.chapters) : null,
    coverUrl: String(candidate.coverUrl || candidate.coverDownloadUrl || '').trim() || null,
    coverPreviewUrl: String(candidate.coverPreviewUrl || candidate.coverUrl || '').trim() || null,
    type: String(candidate.type || candidate.format || '').trim() || null,
    mangaDexId: String(candidate.mangaDexId || '').trim() || null,
    anilistId: String(candidate.anilistId || '').trim() || null,
    nhentaiId: String(candidate.nhentaiId || '').trim() || null,
    malId: Number.isFinite(Number(candidate.malId)) ? Number(candidate.malId) : null,
    hydrated: Boolean(candidate.hydrated)
  };
}

function normalizeWorkbenchItems(items, queueIds = []) {
  const byId = new Map();
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const mangaId = String(item?.mangaId || item?.id || '').trim();
    if (!mangaId || byId.has(mangaId)) return;
    const requestedStatus = String(item?.status || 'pending').trim();
    const status = requestedStatus === 'analyzing'
      ? 'interrupted'
      : (WORKBENCH_STATUSES.has(requestedStatus) ? requestedStatus : 'pending');
    byId.set(mangaId, {
      mangaId,
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
      status,
      confidence: Number.isFinite(Number(item?.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0,
      margin: Number.isFinite(Number(item?.margin)) ? Math.max(0, Math.min(1, Number(item.margin))) : 0,
      candidate: normalizeWorkbenchCandidate(item?.candidate),
      candidateCount: Math.max(0, Number(item?.candidateCount || 0)),
      fields: uniqueStrings(item?.fields).slice(0, 40),
      error: String(item?.error || '').trim() || null,
      decision: ['accepted', 'keep-local'].includes(String(item?.decision || '').trim()) ? String(item.decision).trim() : null,
      reviewedAt: String(item?.reviewedAt || '').trim() || null,
      updatedAt: String(item?.updatedAt || new Date().toISOString()),
      jobId: String(item?.jobId || '').trim() || null
    });
  });
  uniqueStrings(queueIds).forEach((mangaId, index) => {
    if (byId.has(mangaId)) return;
    byId.set(mangaId, {
      mangaId,
      order: index,
      status: 'pending',
      confidence: 0,
      margin: 0,
      candidate: null,
      candidateCount: 0,
      fields: [],
      error: null,
      decision: null,
      reviewedAt: null,
      updatedAt: new Date().toISOString(),
      jobId: null
    });
  });
  return [...byId.values()]
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({ ...item, order: index }));
}

function updateCollection(collectionId, patch) {
  return updateStateSegments({ organization: ['collections'] }, (state) => {
    if (state.collections[collectionId]) {
      state.collections[collectionId] = {
        ...state.collections[collectionId],
        ...sanitizeCollectionPatch(patch)
      };
    }
    return state;
  });
}

function addMangaToCollection(collectionId, mangaId) {
  return updateStateSegments({ organization: ['collections'], identity: ['workGroups'] }, (state) => {
    const collection = state.collections[collectionId];
    const editionIds = getWorkEditionIds(state, mangaId);
    if (collection) collection.mangaIds = uniqueStrings([...(collection.mangaIds || []), ...editionIds]);
    const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
    if (group) group.collectionIds = uniqueStrings([...(group.collectionIds || []), collectionId]);
    return state;
  });
}

function removeMangaFromCollection(collectionId, mangaId) {
  return updateStateSegments({ organization: ['collections'], identity: ['workGroups'] }, (state) => {
    const collection = state.collections[collectionId];
    const editionIds = new Set(getWorkEditionIds(state, mangaId));
    if (collection) collection.mangaIds = collection.mangaIds.filter((id) => !editionIds.has(id));
    const group = Object.values(state.workGroups || {}).find((entry) => (entry.editionIds || []).includes(mangaId));
    if (group) group.collectionIds = (group.collectionIds || []).filter((id) => id !== collectionId);
    return state;
  });
}

module.exports = {
  STORAGE_VERSION,
  STATE_VERSION,
  SCAN_INDEX_VERSION,
  QUEUE_VERSION,
  METADATA_VERSION,
  SPLIT_STORAGE_VERSION,
  SEARCH_PRIVACY_VERSION,
  DEFAULT_STATE,
  normalizeState,
  normalizePersistedSessionPayload,
  loadState,
  saveState,
  activateRuntimeStateOverride,
  updateState,
  updateStateSegments,
  flushStateWrites,
  getUserDataPath,
  getStateDir,
  getStatePath,
  getLegacyV2StatePath,
  getUserDataStoreDir,
  getUserDataStorePaths,
  getDerivedDir,
  getDerivedDbPath,
  getCacheDir,
  getBackupDir,
  getManagedCoverDir,
  getBackupImportJournalPath,
  getThumbnailDir,
  getCbzCacheDir,
  clearDerivedArtifacts,
  createBackup,
  exportBackup,
  importBackup,
  serializeBackupImport,
  recoverIncompleteBackupImport,
  rollbackBackupImport,
  listBackups,
  migrateFromV1,
  createTag,
  deleteTag,
  setMangaTags,
  addTagToManga,
  removeTagFromManga,
  createCollection,
  deleteCollection,
  sanitizeCollectionPatch,
  updateCollection,
  addMangaToCollection,
  removeMangaFromCollection
};
