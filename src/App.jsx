import { Suspense, lazy, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import TitleBar from './components/TitleBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import LibraryView from './components/LibraryView.jsx';
import MangaDetailView from './components/MangaDetailView.jsx';
import ChapterPreviewView from './components/ChapterPreviewView.jsx';
import ReaderView from './components/ReaderView.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import Dashboard from './components/Dashboard.jsx';
import TagManagerModal from './components/TagManagerModal.jsx';
import BulkActionBar from './components/BulkActionBar.jsx';
import BatchPickerModal from './components/BatchPickerModal.jsx';
import MetadataEditorModal from './components/MetadataEditorModal.jsx';
import CoverManagerModal from './components/CoverManagerModal.jsx';
import ReadingQueueDrawer from './components/ReadingQueueDrawer.jsx';
import AddEntryMenu from './components/AddEntryMenu.jsx';
import TextPromptModal from './components/TextPromptModal.jsx';
import ShellErrorBoundary from './components/ShellErrorBoundary.jsx';
import ReliabilityNoticeCenter from './components/ReliabilityNoticeCenter.jsx';
import { resolveNumberedTabIndex } from './interfaces/kavita/tabInteractions.js';
import { createReaderSessionStore } from './interfaces/kavita/readerSessionStore.js';
import { createInterfaceTransitionCoordinator } from './interfaces/interfaceTransition.js';
import {
  AlertIcon,
  ArchiveIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BookIcon,
  CopyIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  FolderPlusIcon,
  FullscreenIcon,
  HeartIcon,
  LayoutGridIcon,
  LibraryIcon,
  PlusIcon,
  PinIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  TagIcon,
  LayersIcon,
  TrashIcon
} from './components/Icons.jsx';
import {
  buildSmartCollectionFromSearch,
  formatSearchChips,
  parseSearchQuery,
  resolveSmartCollection,
  sortMangas
} from './utils/reader.js';
import { mergePayloadForStability } from './utils/payloadMerge.js';
import { createLibraryReferenceIndex } from './utils/libraryReferenceIndex.js';
import { isTextContextRequest } from './utils/textContextMenu.js';
import {
  getScrollOffset,
  normalizeScrollPosition,
  normalizeScrollPositions,
  updateScrollPositionRegistry
} from './utils/scrollPositions.js';
import {
  applyChapterReadMutation,
  applyCollectionMutation,
  applyFavoriteMutation,
  applyMangaReadMutation,
  applyTagMutation,
  applyReaderProgressMutation,
  captureReadMutationSnapshot,
  restoreReadMutationSnapshot,
  captureReaderProgressSnapshot,
  restoreReaderProgressSnapshot
} from './utils/payloadMutations.js';
import { createOptimisticMutationManager } from './utils/optimisticMutationManager.js';
import { createSettingsPersistenceController } from './utils/settingsPersistence.js';
import { createBackgroundRefreshController } from './utils/backgroundRefresh.js';
import { attachWorkGroupMetadata, projectCanonicalMangas } from './utils/workGroups.js';
import {
  createSelectionSessionsState,
  getSelectionSession,
  getSelectionSummary,
  makeSelectionSessionKey,
  selectionSessionsReducer
} from './utils/selectionSessions.js';
import { mergeIdentityPatchIntoPayload } from './utils/identityPatch.js';
import {
  buildDashboardSelectionModel,
  resolveVisibleSelectionIds
} from './utils/selectionVisibility.js';
import {
  applyBulkTrashPatch,
  createFailedTrashRetry,
  formatTrashConfirmation,
  readBulkTrashJobUpdate,
  resolveCurrentTrashTargets
} from './utils/bulkTrashWorkflow.js';
import {
  buildCompactSearchIndex,
  getSearchSuggestions,
  searchCompactIndex
} from './utils/searchIndex.js';
import {
  normalizeReaderOpenIntent,
  resolveReaderEntry
} from './utils/readerProgress.js';
import {
  advancedSearchResultsMatch,
  createAdvancedSearchState,
  createDeferredSearchController,
  createRecentSearchStore,
  neutralizePrivateTabSearch,
  normalizeSearchState,
  removeAdvancedQueryToken,
  SEARCH_PRIVACY_VERSION,
  serializeTabSearchState,
  updateSearchState
} from './utils/searchSession.js';

const SettingsDrawer = lazy(() => import('./components/SettingsDrawer.jsx'));
const CollectionsView = lazy(() => import('./components/CollectionsView.jsx'));
const MaintenanceView = lazy(() => import('./components/MaintenanceView.jsx'));
const MetadataWorkbenchView = lazy(() => import('./components/MetadataWorkbenchView.jsx'));
const VaultView = lazy(() => import('./components/VaultView.jsx'));
const CommandPalette = lazy(() => import('./components/CommandPalette.jsx'));
const SourcesView = lazy(() => import('./components/SourcesView.jsx'));
const KavitaShell = lazy(() => import('./interfaces/kavita/KavitaShell.jsx'));
const preloadKavitaShell = () => import('./interfaces/kavita/KavitaShell.jsx');

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

function isEditableTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tagName);
}

function normalizeShortcutToken(token = '') {
  const value = String(token || '').trim();
  if (!value) return '';
  const lower = value.toLowerCase();
  if (['control', 'ctrl', 'meta', 'cmd', 'command'].includes(lower)) return 'Ctrl';
  if (['shift'].includes(lower)) return 'Shift';
  if (['alt', 'option'].includes(lower)) return 'Alt';
  if (['esc', 'escape'].includes(lower)) return 'Escape';
  if (['arrowleft', 'left'].includes(lower)) return 'ArrowLeft';
  if (['arrowright', 'right'].includes(lower)) return 'ArrowRight';
  if (['arrowup', 'up'].includes(lower)) return 'ArrowUp';
  if (['arrowdown', 'down'].includes(lower)) return 'ArrowDown';
  if (lower === 'browserback') return 'BrowserBack';
  if (lower === 'tab') return 'Tab';
  if (lower === 'space' || lower === 'spacebar') return 'Space';
  if (lower === 'comma') return ',';
  if (lower === 'plus') return '+';
  if (lower === 'minus') return '-';
  if (value.length === 1) return value.toUpperCase();
  return value;
}

function splitShortcut(shortcut = '') {
  return String(shortcut || '')
    .split('+')
    .map((token) => normalizeShortcutToken(token))
    .filter(Boolean);
}

function getEventShortcutTokens(event) {
  const tokens = [];
  if (event.ctrlKey || event.metaKey) tokens.push('Ctrl');
  if (event.shiftKey) tokens.push('Shift');
  if (event.altKey) tokens.push('Alt');

  let key = event.key || event.code || '';
  if (key === '=' && event.shiftKey) key = '+';
  const normalizedKey = normalizeShortcutToken(key);
  if (normalizedKey && !['Ctrl', 'Shift', 'Alt'].includes(normalizedKey)) {
    tokens.push(normalizedKey);
  }
  return tokens;
}

function eventMatchesShortcut(event, shortcut = '') {
  const expected = splitShortcut(shortcut);
  if (expected.length === 0) return false;
  const actual = getEventShortcutTokens(event);
  if (expected.length !== actual.length) return false;
  return expected.every((token, index) => token === actual[index]);
}

function formatShortcutLabel(shortcut = '') {
  return splitShortcut(shortcut).join('+');
}

function LazyPanelPlaceholder({ label = 'Chargement de l interface...' }) {
  return (
    <div className="settings-note lazy-panel-placeholder">
      {label}
    </div>
  );
}

function sanitizeReaderState(state = null) {
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

function sanitizeReaderIntent(intent = null) {
  if (!intent || typeof intent !== 'object') return null;
  const kind = ['normal', 'exact-page', 'restart'].includes(intent.kind) ? intent.kind : 'normal';
  return {
    kind,
    pageIndex: Math.max(0, Math.floor(Number(intent.pageIndex) || 0)),
    token: typeof intent.token === 'string' && intent.token ? intent.token : `${kind}-restored`
  };
}

function normalizeView(view = {}) {
  const normalizedReaderState = sanitizeReaderState(view?.readerState);
  return {
    screen: 'library',
    mangaId: null,
    chapterId: null,
    pageIndex: 0,
    ...view,
    readerState: normalizedReaderState,
    readerIntent: sanitizeReaderIntent(view?.readerIntent),
    readerNotice: typeof view?.readerNotice === 'string' ? view.readerNotice : null
  };
}

const TAB_SCREEN_KEYS = new Set([
  'library', 'dashboard', 'favorites', 'recents', 'collections',
  'maintenance', 'workbench', 'vault', 'sources'
]);

function normalizeTabScreen(screen) {
  const value = String(screen || '').trim();
  return TAB_SCREEN_KEYS.has(value) ? value : 'library';
}

function normalizeVaultCategoryFilterId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

let tabSequence = 0;
function createTab(initialView, seedStack = [], options = {}) {
  tabSequence += 1;
  return {
    id: `tab-${Date.now()}-${tabSequence}`,
    screen: normalizeTabScreen(options?.screen),
    vaultCategoryFilterId: normalizeVaultCategoryFilterId(options?.vaultCategoryFilterId),
    pinned: false,
    incognito: Boolean(options?.incognito),
    searchPrivate: Boolean(options?.searchPrivate),
    searchState: normalizeSearchState(options?.searchState),
    stack: [...seedStack.map(normalizeView), normalizeView(initialView)]
  };
}

function choosePreferredOcrLanguages(info = {}) {
  const languageCodes = (Array.isArray(info?.languages) ? info.languages : [])
    .map((entry) => String(entry?.code || entry?.label || entry || '').trim())
    .filter(Boolean);

  if (languageCodes.length === 0) {
    if (info?.engineKind === 'windows-ocr') return ['fr-FR'];
    return ['eng'];
  }

  if (info?.engineKind === 'windows-ocr') {
    const preferred = languageCodes.find((code) => /^fr\b|^fr-/i.test(code))
      || languageCodes.find((code) => /^en\b|^en-/i.test(code))
      || languageCodes.find((code) => /^ja\b|^ja-/i.test(code))
      || languageCodes[0];
    return preferred ? [preferred] : [languageCodes[0]];
  }

  const preferred = [
    languageCodes.find((code) => /^eng$/i.test(code)),
    languageCodes.find((code) => /^jpn$/i.test(code)),
    languageCodes.find((code) => /^(fra|fre|fr)$/i.test(code))
  ].filter(Boolean);

  return preferred.length > 0 ? [...new Set(preferred)] : [languageCodes[0]];
}

const INITIAL_TAB = createTab(normalizeView());
const MAX_WORKSPACES = 8;
const WORKSPACE_ICON_KEYS = ['home', 'library', 'layout', 'scroll', 'heart', 'sparkles', 'layers', 'book'];
let workspaceSequence = 0;

function defaultWorkspaceName(index) {
  return `Espace ${index + 1}`;
}

function nextWorkspaceId() {
  workspaceSequence += 1;
  return `workspace-${Date.now()}-${workspaceSequence}`;
}

function sanitizeTab(candidate, fallbackIdPrefix = 'restored') {
  const stack = Array.isArray(candidate?.stack) && candidate.stack.length > 0
    ? candidate.stack.map(normalizeView)
    : [normalizeView()];

  return {
    id: typeof candidate?.id === 'string' && candidate.id.trim()
      ? candidate.id
      : `${fallbackIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    screen: normalizeTabScreen(candidate?.screen),
    vaultCategoryFilterId: normalizeVaultCategoryFilterId(candidate?.vaultCategoryFilterId),
    pinned: Boolean(candidate?.pinned),
    incognito: Boolean(candidate?.incognito),
    searchPrivate: Boolean(candidate?.searchPrivate),
    searchState: normalizeSearchState(candidate?.searchState, candidate?.search),
    stack
  };
}

function sanitizeWorkspace(candidate, index = 0) {
  const id = typeof candidate?.id === 'string' && candidate.id.trim()
    ? candidate.id
    : nextWorkspaceId();

  const name = typeof candidate?.name === 'string' && candidate.name.trim()
    ? candidate.name.trim()
    : defaultWorkspaceName(index);

  const iconKey = WORKSPACE_ICON_KEYS.includes(candidate?.iconKey)
    ? candidate.iconKey
    : WORKSPACE_ICON_KEYS[index % WORKSPACE_ICON_KEYS.length];

  const tabs = Array.isArray(candidate?.tabs) && candidate.tabs.length > 0
    ? candidate.tabs.map((tab, tabIndex) => sanitizeTab(tab, `${id}-${tabIndex}`))
    : [createTab(normalizeView())];

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

function createWorkspace(index = 0, overrides = {}) {
  return sanitizeWorkspace({
    id: nextWorkspaceId(),
    name: defaultWorkspaceName(index),
    iconKey: WORKSPACE_ICON_KEYS[index % WORKSPACE_ICON_KEYS.length],
    tabs: [createTab(normalizeView())],
    ...overrides
  }, index);
}

const INITIAL_WORKSPACE = createWorkspace(0, {
  tabs: [INITIAL_TAB],
  activeTabId: INITIAL_TAB.id
});

export function restoreSessionModel(session) {
  const requiresSearchPrivacyMigration = Number(session?.searchPrivacyVersion || 0) < SEARCH_PRIVACY_VERSION;
  const migrateWorkspaceSearchPrivacy = (workspace) => {
    if (!requiresSearchPrivacyMigration) return workspace;
    return {
      ...workspace,
      tabs: workspace.tabs.map((tab) => ({
        ...tab,
        searchPrivate: false,
        searchState: normalizeSearchState(null)
      }))
    };
  };

  if ([2, 3, 4, 5, 6, 7, 8].includes(Number(session?.version)) && Array.isArray(session?.workspaces) && session.workspaces.length > 0) {
    const restoredWorkspaces = session.workspaces
      .slice(0, MAX_WORKSPACES)
      .map((workspace, index) => migrateWorkspaceSearchPrivacy(sanitizeWorkspace(workspace, index)));

    return {
      searchPrivacyVersion: SEARCH_PRIVACY_VERSION,
      version: 8,
      workspaces: restoredWorkspaces,
      activeWorkspaceId: restoredWorkspaces.some((workspace) => workspace.id === session?.activeWorkspaceId)
        ? session.activeWorkspaceId
        : restoredWorkspaces[0].id,
      scrollPositions: Number(session?.version) >= 3 ? normalizeScrollPositions(session.scrollPositions) : {}
    };
  }

  const restoredTabs = Array.isArray(session?.tabs) && session.tabs.length > 0
    ? session.tabs.map((tab, index) => sanitizeTab(tab, `restored-${index}`))
    : [createTab(normalizeView())];
  const privacySafeTabs = requiresSearchPrivacyMigration
    ? restoredTabs.map((tab) => ({
        ...tab,
        searchPrivate: false,
        searchState: normalizeSearchState(null)
      }))
    : restoredTabs;

  const restoredActiveTabId = privacySafeTabs.some((tab) => tab.id === session?.activeTabId)
    ? session.activeTabId
    : privacySafeTabs[0].id;

  const defaultWorkspace = sanitizeWorkspace({
    id: nextWorkspaceId(),
    name: defaultWorkspaceName(0),
    iconKey: WORKSPACE_ICON_KEYS[0],
    tabs: privacySafeTabs,
    activeTabId: restoredActiveTabId
  }, 0);

  return {
    searchPrivacyVersion: SEARCH_PRIVACY_VERSION,
    version: 8,
    workspaces: [defaultWorkspace],
    activeWorkspaceId: defaultWorkspace.id,
    scrollPositions: {}
  };
}

function getTabView(tab) {
  return tab?.stack?.[tab.stack.length - 1] ?? normalizeView();
}

function neutralizeLockedVaultTabs(meta, view, vault, manga) {
  if (!vault?.locked || !view?.mangaId) return meta;
  const mangaId = String(view.mangaId);
  const privateIds = Array.isArray(vault.privateMangaIds) ? vault.privateMangaIds : [];
  const knownPrivate = privateIds.some((entry) => String(entry) === mangaId);
  if (!knownPrivate && manga) return meta;
  return {
    ...meta,
    label: 'Contenu prive',
    subtitle: 'Coffre verrouille'
  };
}

function matchesEntityReference(entity, reference) {
  const needle = String(reference || '').trim();
  if (!needle) return false;
  return [entity?.id, entity?.contentId, entity?.locationId].some((value) => String(value || '').trim() === needle);
}

function findManga(library, mangaId) {
  return library.allMangas.find((manga) => matchesEntityReference(manga, mangaId)) ?? null;
}

function findMangaInPayload(payload, mangaId) {
  return findManga(payload?.library || { allMangas: [] }, mangaId)
    || findManga(payload?.vaultLibrary || { allMangas: [] }, mangaId);
}

function findChapter(library, mangaId, chapterId) {
  const manga = findManga(library, mangaId);
  if (!manga) return { manga: null, chapter: null };
  const chapter = manga.chapters.find((item) => matchesEntityReference(item, chapterId)) ?? null;
  return { manga, chapter };
}

function makeViewScrollKey(tabId, view, activeScreen = 'library', screenContextKey = 'all') {
  const screen = view?.screen || 'library';
  const mangaId = view?.mangaId || 'none';
  const chapterId = view?.chapterId || 'none';
  return `${tabId}:${screen}:${mangaId}:${chapterId}:${activeScreen}:${screenContextKey || 'all'}`;
}

function normalizeThemeName(theme) {
  if (theme === 'dark') return 'dark-night';
  if (theme === 'light') return 'light-paper';
  return theme || 'dark-night';
}

function normalizeInterfaceMode(ui = {}) {
  return ui.interfaceMode === 'kavita' || ui.interfaceMode === 'kavita-clean' || ui.theme === 'kavita-clean'
    ? 'kavita'
    : 'sawa';
}

function shouldShowKavitaUpgradeBanner(ui = {}) {
  return normalizeInterfaceMode(ui) !== 'kavita' && !ui.kavitaUpgradePromptSeen;
}

function cardSizeMinWidth(cardSize) {
  if (cardSize === 'compact') return '180px';
  if (cardSize === 'large') return '320px';
  return '240px';
}

function cardSizeGridGap(cardSize) {
  if (cardSize === 'compact') return '14px';
  if (cardSize === 'large') return '22px';
  return '18px';
}

function toSortableNumber(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractOrderFromText(value) {
  const text = String(value || '');
  const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)/g)];
  if (!matches.length) return null;
  return toSortableNumber(matches[matches.length - 1][1]);
}

function buildChapterOrderDescriptor(chapter, index = 0) {
  const metadataVolume = toSortableNumber(chapter?.volume);
  const metadataNumber = toSortableNumber(chapter?.number);
  if (metadataVolume !== null || metadataNumber !== null) {
    return {
      tier: 0,
      volume: metadataVolume ?? 0,
      number: metadataNumber ?? 0,
      fallback: String(chapter?.name || '').toLowerCase(),
      index
    };
  }

  const filenameNumber = extractOrderFromText(chapter?.name) ?? extractOrderFromText(chapter?.path);
  if (filenameNumber !== null) {
    return {
      tier: 1,
      volume: 0,
      number: filenameNumber,
      fallback: String(chapter?.name || '').toLowerCase(),
      index
    };
  }

  return {
    tier: 2,
    volume: 0,
    number: index,
    fallback: String(chapter?.name || '').toLowerCase(),
    index
  };
}

function sortChaptersForNextCandidate(chapters = []) {
  return [...chapters]
    .map((chapter, index) => ({ chapter, order: buildChapterOrderDescriptor(chapter, index) }))
    .sort((left, right) => (
      left.order.tier - right.order.tier
      || left.order.volume - right.order.volume
      || left.order.number - right.order.number
      || left.order.fallback.localeCompare(right.order.fallback, 'fr')
      || left.order.index - right.order.index
    ))
    .map((entry) => entry.chapter);
}

function buildMangaOrderDescriptor(manga, index = 0) {
  const metadataVolume = toSortableNumber(manga?.volume);
  const metadataNumber = toSortableNumber(manga?.number);
  if (metadataVolume !== null || metadataNumber !== null) {
    return {
      tier: 0,
      volume: metadataVolume ?? 0,
      number: metadataNumber ?? 0,
      fallback: String(manga?.displayTitle || manga?.name || '').toLowerCase(),
      index
    };
  }

  const filenameNumber = extractOrderFromText(manga?.displayTitle) ?? extractOrderFromText(manga?.path);
  if (filenameNumber !== null) {
    return {
      tier: 1,
      volume: 0,
      number: filenameNumber,
      fallback: String(manga?.displayTitle || manga?.name || '').toLowerCase(),
      index
    };
  }

  return {
    tier: 2,
    volume: 0,
    number: index,
    fallback: String(manga?.displayTitle || manga?.name || '').toLowerCase(),
    index
  };
}

function sortMangasForNextCandidate(mangas = []) {
  return [...mangas]
    .map((manga, index) => ({ manga, order: buildMangaOrderDescriptor(manga, index) }))
    .sort((left, right) => (
      left.order.tier - right.order.tier
      || left.order.volume - right.order.volume
      || left.order.number - right.order.number
      || left.order.fallback.localeCompare(right.order.fallback, 'fr')
      || left.order.index - right.order.index
    ))
    .map((entry) => entry.manga);
}

function buildMangaAggregate(manga) {
  const chapters = Array.isArray(manga?.chapters) ? manga.chapters : [];
  const completedChapterCount = chapters.filter((chapter) => chapter.isRead).length;
  const progressUnits = chapters.reduce((sum, chapter) => {
    if (chapter.isRead) return sum + 1;
    if (chapter.progress?.pageCount) {
      const ratio = Math.max(0, Math.min(1, (chapter.progress.pageIndex + 1) / chapter.progress.pageCount));
      return sum + ratio;
    }
    return sum;
  }, 0);
  const progressPercent = chapters.length
    ? Math.max(0, Math.min(100, Math.round((progressUnits / chapters.length) * 100)))
    : 0;
  return {
    ...manga,
    completedChapterCount,
    progressPercent,
    isRead: chapters.length > 0 && completedChapterCount === chapters.length,
    progress: {
      percent: progressPercent,
      completedChapterCount,
      totalChapterCount: chapters.length,
      lastChapterId: manga?.lastProgress?.chapterId ?? null
    }
  };
}

export default function App() {
  const [payload, setPayload] = useState(null);
  const [workspaces, setWorkspaces] = useState([INITIAL_WORKSPACE]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(INITIAL_WORKSPACE.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(null);
  const [coverManagerManga, setCoverManagerManga] = useState(null);
  const [tagManagerManga, setTagManagerManga] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [collectionPickerManga, setCollectionPickerManga] = useState(null);
  const [metadataSearchManga, setMetadataSearchManga] = useState(null);
  const [selectionSessions, dispatchSelection] = useReducer(
    selectionSessionsReducer,
    undefined,
    createSelectionSessionsState
  );
  const [maintenanceStats, setMaintenanceStats] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [batchCollectionOpen, setBatchCollectionOpen] = useState(false);
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [bulkUndoAction, setBulkUndoAction] = useState(null);
  const [bulkTrashJobStatus, setBulkTrashJobStatus] = useState(null);
  const [collectionSelectionView, setCollectionSelectionView] = useState({
    viewId: 'overview',
    ids: []
  });
  const [requestedCollectionId, setRequestedCollectionId] = useState(null);
  const [requestedCollectionsTab, setRequestedCollectionsTab] = useState('manual');
  const [chapterPagesCache, setChapterPagesCache] = useState({});
  const [bootError, setBootError] = useState('');
  const [readingQueueOpen, setReadingQueueOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);
  const [advancedSearchState, setAdvancedSearchState] = useState(() => createAdvancedSearchState());
  const advancedSearchGenerationRef = useRef(0);
  const advancedSearchControllerRef = useRef(null);
  if (!advancedSearchControllerRef.current) {
    advancedSearchControllerRef.current = createDeferredSearchController({
      delay: 260,
      execute: (input) => window.mangaAPI.searchAdvanced(input)
    });
  }
  const recentSearchStoreRef = useRef(null);
  if (!recentSearchStoreRef.current) {
    recentSearchStoreRef.current = createRecentSearchStore(window.localStorage);
  }
  const [recentSearches, setRecentSearches] = useState(() => recentSearchStoreRef.current.list());
  const [duplicateCandidates, setDuplicateCandidates] = useState([]);
  const [ocrStatus, setOcrStatus] = useState(null);
  const [migrationStatus, setMigrationStatus] = useState(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationFeedback, setMigrationFeedback] = useState('');
  const [identityBusy, setIdentityBusy] = useState(false);
  const [plugins, setPlugins] = useState([]);
  const [pluginBusyId, setPluginBusyId] = useState(null);
  const [pluginFeedback, setPluginFeedback] = useState('');
  const [addEntryMenuAnchor, setAddEntryMenuAnchor] = useState(null);
  const [sourcesSection, setSourcesSection] = useState('explorer');
  const [sourceExplorerContext, setSourceExplorerContext] = useState(null);
  const [panicSession, setPanicSession] = useState('inactive');
  const [renderedInterfaceMode, setRenderedInterfaceMode] = useState(null);
  const [interfaceTransitioning, setInterfaceTransitioning] = useState(false);
  const [interfaceTransitionError, setInterfaceTransitionError] = useState('');
  const [reliabilityIssues, setReliabilityIssues] = useState([]);
  const [relocationNotice, setRelocationNotice] = useState(null);
  const [textPromptState, setTextPromptState] = useState({
    open: false,
    title: '',
    description: '',
    label: 'Nom',
    defaultValue: '',
    placeholder: '',
    confirmLabel: 'Valider',
    cancelLabel: 'Annuler',
    onConfirm: null
  });
  const scrollPositionsRef = useRef({});
  const activeScrollRestorationRef = useRef({ key: '', position: null });
  const scrollPersistTimerRef = useRef(null);
  const [scrollPersistenceRevision, setScrollPersistenceRevision] = useState(0);
  const screenHistoryRef = useRef(new Map());
  const legacyExperimentalPatchPendingRef = useRef(false);
  const readerSessionStoreRef = useRef(null);
  const interfaceTransitionLockRef = useRef(false);
  const previousInterfaceModeRef = useRef('sawa');
  const latestStateRevisionRef = useRef(0);
  const payloadRef = useRef(null);
  const bulkTrashJobContextsRef = useRef(new Map());
  const optimisticMutationManagerRef = useRef(null);
  const settingsPersistenceRef = useRef(null);
  const backgroundRefreshControllerRef = useRef(null);
  const backgroundRefreshTimerRef = useRef(null);

  const updatePayloadTracked = useCallback((updater) => {
    const resolve = (previous) => (typeof updater === 'function' ? updater(previous) : updater);
    const previousSnapshot = payloadRef.current;
    if (previousSnapshot) {
      const immediate = resolve(previousSnapshot);
      payloadRef.current = immediate;
      setPayload((current) => {
        if (current === previousSnapshot) return immediate;
        const reconciled = resolve(current);
        payloadRef.current = reconciled;
        return reconciled;
      });
      return;
    }
    setPayload((previous) => {
      const next = resolve(previous);
      payloadRef.current = next;
      return next;
    });
  }, []);

  if (!optimisticMutationManagerRef.current) {
    optimisticMutationManagerRef.current = createOptimisticMutationManager({
      getState: () => payloadRef.current,
      updateState: updatePayloadTracked,
      onRevision: (revision) => {
        latestStateRevisionRef.current = Math.max(latestStateRevisionRef.current, Number(revision || 0));
      },
      onIssuesChanged: (mutationIssues) => {
        setReliabilityIssues((current) => [
          ...current.filter((issue) => issue.kind !== 'mutation'),
          ...mutationIssues
        ]);
      }
    });
  }

  if (!settingsPersistenceRef.current) {
    settingsPersistenceRef.current = createSettingsPersistenceController({
      getSettings: () => payloadRef.current?.persisted?.ui || {},
      applyPatch: (patch) => updatePayloadTracked((previous) => mergeUiSettingsIntoPayload(previous, patch)),
      persist: (patch) => window.mangaAPI.updateSettingsLight
        ? window.mangaAPI.updateSettingsLight(patch)
        : window.mangaAPI.updateSettings(patch),
      getRevision: () => latestStateRevisionRef.current,
      onRevision: (revision) => {
        latestStateRevisionRef.current = Math.max(latestStateRevisionRef.current, Number(revision || 0));
      },
      onIssue: (issue) => {
        setReliabilityIssues((current) => [
          ...current.filter((entry) => entry.id !== issue.id),
          issue
        ]);
      },
      onIssueResolved: ({ fields }) => {
        const resolved = new Set(fields);
        setReliabilityIssues((current) => current.flatMap((issue) => {
          if (issue.kind !== 'settings') return [issue];
          const remainingFields = (issue.fields || []).filter((field) => !resolved.has(field));
          return remainingFields.length
            ? [{ ...issue, fields: remainingFields, message: `${remainingFields.length} reglage(s) restent a enregistrer.` }]
            : [];
        }));
      }
    });
  }

  if (!backgroundRefreshControllerRef.current) {
    backgroundRefreshControllerRef.current = createBackgroundRefreshController({
      load: () => window.mangaAPI.bootstrap(),
      getRevision: () => latestStateRevisionRef.current,
      apply: (incoming) => {
        const revision = Number(incoming?.stateRevision || 0);
        latestStateRevisionRef.current = Math.max(latestStateRevisionRef.current, revision);
        startTransition(() => {
          updatePayloadTracked((previous) => mergePayloadForStability(previous, incoming));
        });
      },
      onStatus: setSyncStatus
    });
  }
  if (!readerSessionStoreRef.current) {
    readerSessionStoreRef.current = createReaderSessionStore({
      persistProgress: (progress) => window.mangaAPI.updateProgressLight(progress),
      commitProgress: (progress, meta) => commitReaderProgress(progress, meta),
      persistSettings: (settings) => window.mangaAPI.updateSettingsLight({
        kavitaReaderSettings: settings
      }),
      commitSettings: (settings) => commitKavitaReaderSettings(settings),
      onPersistenceError: (failure) => handleReaderPersistenceError(failure),
      onPersistenceSuccess: ({ kind }) => {
        setReliabilityIssues((current) => current.filter((issue) => (
          issue.kind !== 'reader-session' || issue.persistenceKind !== kind
        )));
      }
    });
  }

  // Stable callback wrappers — prop-level handlers below are redeclared on every render (plain
  // `function` declarations), which breaks React.memo on LibraryView/Dashboard/VaultView/etc. and
  // cascades into re-rendering every visible MangaCard. We read the latest implementation through
  // a ref so the wrappers keep a stable identity for the whole component lifetime.
  const latestHandlersRef = useRef({});
  const stableOpenManga = useCallback((id) => latestHandlersRef.current.openMangaInCurrentTab?.(id), []);
  const stableOpenMangaInNewTab = useCallback((id, options) => latestHandlersRef.current.openMangaInNewTab?.(id, options), []);
  const stableOpenMangaInBackgroundTab = useCallback((id) => latestHandlersRef.current.openMangaInNewTab?.(id, { activate: false }), []);
  const stableToggleFavorite = useCallback((id) => latestHandlersRef.current.handleToggleFavorite?.(id), []);
  const stableToggleSelectedManga = useCallback((id, meta) => latestHandlersRef.current.toggleSelectedManga?.(id, meta), []);
  const stableToggleSelectionMode = useCallback(() => latestHandlersRef.current.toggleSelectionMode?.(), []);
  const stableOpenContextMenu = useCallback((event, context) => latestHandlersRef.current.openContextMenu?.(event, context), []);
  const stableResumeManga = useCallback((id) => latestHandlersRef.current.resumeMangaInCurrentTab?.(id), []);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? INITIAL_WORKSPACE,
    [workspaces, activeWorkspaceId]
  );

  const tabs = activeWorkspace?.tabs ?? [INITIAL_TAB];
  const activeTabId = activeWorkspace?.activeTabId ?? tabs[0]?.id ?? INITIAL_TAB.id;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? INITIAL_TAB;
  const activeScreen = normalizeTabScreen(activeTab?.screen);
  const vaultCategoryFilterId = normalizeVaultCategoryFilterId(activeTab?.vaultCategoryFilterId);

  const setTabs = useCallback((updater) => {
    setWorkspaces((prev) => prev.map((workspace) => {
      if (workspace.id !== activeWorkspaceId) return workspace;

      const nextTabsRaw = typeof updater === 'function' ? updater(workspace.tabs) : updater;
      const nextTabs = Array.isArray(nextTabsRaw) && nextTabsRaw.length > 0
        ? nextTabsRaw.map((tab, index) => sanitizeTab(tab, `${workspace.id}-${index}`))
        : [createTab(normalizeView())];

      const nextActiveTabId = nextTabs.some((tab) => tab.id === workspace.activeTabId)
        ? workspace.activeTabId
        : nextTabs[0].id;

      return {
        ...workspace,
        tabs: nextTabs,
        activeTabId: nextActiveTabId
      };
    }));
  }, [activeWorkspaceId]);

  const setActiveTabScreen = useCallback((nextScreen) => {
    const normalizedScreen = normalizeTabScreen(nextScreen);
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === activeTabId ? { ...tab, screen: normalizedScreen } : tab
    )));
  }, [activeTabId, setTabs]);

  const setVaultCategoryFilterId = useCallback((nextValue) => {
    const resolved = typeof nextValue === 'function' ? nextValue(vaultCategoryFilterId) : nextValue;
    const normalizedValue = normalizeVaultCategoryFilterId(resolved);
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === activeTabId ? { ...tab, vaultCategoryFilterId: normalizedValue } : tab
    )));
  }, [activeTabId, setTabs, vaultCategoryFilterId]);

  const setActiveTabId = useCallback((nextActiveTabId) => {
    setWorkspaces((prev) => prev.map((workspace) => {
      if (workspace.id !== activeWorkspaceId) return workspace;
      const requestedId = typeof nextActiveTabId === 'function'
        ? nextActiveTabId(workspace.activeTabId)
        : nextActiveTabId;
      const resolvedActiveTabId = workspace.tabs.some((tab) => tab.id === requestedId)
        ? requestedId
        : workspace.tabs[0]?.id ?? workspace.activeTabId;
      return {
        ...workspace,
        activeTabId: resolvedActiveTabId
      };
    }));
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (workspaces.some((workspace) => workspace.id === activeWorkspaceId)) return;
    const fallbackWorkspaceId = workspaces[0]?.id;
    if (fallbackWorkspaceId) setActiveWorkspaceId(fallbackWorkspaceId);
  }, [workspaces, activeWorkspaceId]);

  useEffect(() => {
    let unsubscribe = () => {};
    let unsubscribeSync = () => {};
    let unsubscribeStatePatch = () => {};
    let unsubscribeJobs = () => {};
    let disposed = false;
    let idleProbeId = null;
    let syncProbeTimer = null;
    const signalBootReady = () => {
      try {
        window.mangaAPI?.signalBootReady?.();
      } catch (_error) {
        // Renderer boot should stay resilient even if IPC is unavailable.
      }
    };

    async function boot() {
      try {
        const nextPayload = await window.mangaAPI.bootstrap();
        if (disposed) return;
        setBootError('');
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        if (nextPayload?.reliability?.shutdownWarning) {
          setSyncStatus({
            state: 'attention-needed',
            label: 'verification requise',
            detail: 'La derniere fermeture n a pas confirme toutes les ecritures. Le dernier snapshot valide a ete conserve.',
            attentionCount: 1
          });
        }
        latestStateRevisionRef.current = Number(nextPayload?.stateRevision || 0);
        setPlugins(Array.isArray(nextPayload?.plugins) ? nextPayload.plugins : []);
        const runSyncProbe = () => {
          window.mangaAPI.getSyncStatus().then((status) => {
            if (!disposed && !nextPayload?.reliability?.shutdownWarning) setSyncStatus(status);
          }).catch(() => {
            if (!disposed) setSyncStatus(null);
          });
        };
        if (typeof window.requestIdleCallback === 'function') {
          idleProbeId = window.requestIdleCallback(runSyncProbe, { timeout: 1600 });
        } else {
          syncProbeTimer = window.setTimeout(runSyncProbe, 900);
        }
        const restoredSession = restoreSessionModel(nextPayload?.persisted?.session);
        scrollPositionsRef.current = restoredSession.scrollPositions;
        setWorkspaces(restoredSession.workspaces);
        setActiveWorkspaceId(restoredSession.activeWorkspaceId);
        setPanicSession('inactive');
        unsubscribe = window.mangaAPI.onLibraryChanged((incoming) => {
          if (disposed) return;
          startTransition(() => {
            updatePayloadTracked((previous) => mergePayloadForStability(previous, incoming));
            if (Array.isArray(incoming?.plugins)) {
              setPlugins(incoming.plugins);
            }
          });
        });
        unsubscribeSync = window.mangaAPI.onSyncStatusChanged((incoming) => {
          if (!disposed) setSyncStatus(incoming);
        });
        unsubscribeStatePatch = window.mangaAPI.onStatePatch?.((incoming) => {
          if (disposed) return;
          const revision = Number(incoming?.revision || 0);
          if (revision <= latestStateRevisionRef.current) return;
          latestStateRevisionRef.current = revision;
          startTransition(() => {
            updatePayloadTracked((previous) => previous ? {
              ...previous,
              ...(incoming?.patch || {}),
              stateRevision: revision,
              sourceRevision: Number(incoming?.sourceRevision || previous.sourceRevision || 0)
            } : previous);
          });
        }) || (() => {});
        unsubscribeJobs = window.mangaAPI.onJobsProgress?.((incoming) => {
          if (!disposed && incoming?.syncStatus) setSyncStatus(incoming.syncStatus);
          if (!disposed) latestHandlersRef.current.handleJobsProgress?.(incoming);
        }) || (() => {});
        signalBootReady();
        scheduleBackgroundBootstrapRefresh(1800);
      } catch (error) {
        if (!disposed) {
          setBootError(error?.message || 'Impossible de charger la bibliotheque.');
        }
        signalBootReady();
      }
    }

    boot();
    return () => {
      disposed = true;
      if (idleProbeId != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleProbeId);
      }
      if (syncProbeTimer != null) {
        window.clearTimeout(syncProbeTimer);
      }
      if (backgroundRefreshTimerRef.current != null) {
        window.clearTimeout(backgroundRefreshTimerRef.current);
        backgroundRefreshTimerRef.current = null;
      }
      backgroundRefreshControllerRef.current?.cancel();
      unsubscribe();
      unsubscribeSync();
      unsubscribeStatePatch();
      unsubscribeJobs();
    };
  }, []);

  const flushTabsSessionNow = useCallback(async () => {
    if (!payload) return false;
    const serializableWorkspaces = workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      iconKey: workspace.iconKey,
      activeTabId: workspace.activeTabId,
      tabs: workspace.tabs.map((tab) => ({
        id: tab.id,
        screen: normalizeTabScreen(tab.screen),
        vaultCategoryFilterId: normalizeVaultCategoryFilterId(tab.vaultCategoryFilterId),
        pinned: Boolean(tab.pinned),
        incognito: Boolean(tab.incognito),
        searchPrivate: Boolean(tab.searchPrivate)
          && !Boolean(payload?.persisted?.vault?.locked || payload?.persisted?.vault?.stealthMode),
        searchState: serializeTabSearchState(tab, {
          vaultLocked: Boolean(payload?.persisted?.vault?.locked || payload?.persisted?.vault?.stealthMode),
          privateContext: tab.id === activeTabId && activeScreen === 'vault'
        }),
        stack: tab.stack.map(normalizeView)
      }))
    }));

    try {
      await window.mangaAPI.saveTabsSession({
        version: 8,
        searchPrivacyVersion: SEARCH_PRIVACY_VERSION,
        activeWorkspaceId,
        workspaces: serializableWorkspaces,
        scrollPositions: normalizeScrollPositions(scrollPositionsRef.current)
      });
      return true;
    } catch (_error) {
      return false;
    }
  }, [activeScreen, activeTabId, activeWorkspaceId, payload, workspaces]);

  useEffect(() => {
    if (!payload) return undefined;
    let cancelled = false;
    const unsubscribe = window.mangaAPI.onSessionFlushRequested?.(async (requestId) => {
      const ok = await flushTabsSessionNow();
      if (!cancelled) window.mangaAPI.acknowledgeSessionFlush?.(requestId, ok);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [flushTabsSessionNow, payload]);

  useEffect(() => {
    if (!payload) return undefined;
    const timer = window.setTimeout(() => {
      void flushTabsSessionNow();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [flushTabsSessionNow, payload, scrollPersistenceRevision]);

  const scheduleScrollPersistence = useCallback(() => {
    if (scrollPersistTimerRef.current != null) window.clearTimeout(scrollPersistTimerRef.current);
    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null;
      setScrollPersistenceRevision((revision) => revision + 1);
    }, 500);
  }, [updatePayloadTracked]);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => () => {
    if (scrollPersistTimerRef.current != null) window.clearTimeout(scrollPersistTimerRef.current);
  }, []);

  useEffect(() => {
    const addonSourcesWebActif = plugins.some(
      (plugin) => plugin.id === 'sources-web' && plugin.installed && plugin.enabled
    );
    if (addonSourcesWebActif) return;
    setAddEntryMenuAnchor(null);
    setSourcesSection('explorer');
    setSourceExplorerContext(null);
    setWorkspaces((current) => current.map((workspace) => workspace.id === activeWorkspaceId
      ? {
          ...workspace,
          tabs: workspace.tabs.map((tab) => tab.screen === 'sources' ? { ...tab, screen: 'library' } : tab)
        }
      : workspace));
  }, [activeWorkspaceId, plugins]);

  useEffect(() => {
    if (panicSession !== 'recovered') return undefined;
    const timer = window.setTimeout(() => {
      setPanicSession('inactive');
    }, 120);
    return () => window.clearTimeout(timer);
  }, [panicSession]);

  const persistedUi = payload?.persisted?.ui ?? {};
  const theme = normalizeThemeName(persistedUi.theme);
  const persistedInterfaceMode = normalizeInterfaceMode(persistedUi);
  const interfaceMode = renderedInterfaceMode || persistedInterfaceMode;
  const interfaceClassName = 'interface-sawa';
  const ui = {
    ...persistedUi,
    theme,
    interfaceMode,
    experimental: {
      ...(persistedUi.experimental || {}),
      advancedSearch: true,
      archiveFormats: true,
      ocr: true,
      pluginPreview: true,
      visualReader: false,
      guidedView: false,
      visualDedupe: false
    }
  };
  const sawaExperience = ui.sawaExperience === 'classic' ? 'classic' : 'horizon';
  const visualVariant = interfaceMode === 'sawa' ? sawaExperience : 'classic';

  useEffect(() => {
    if (!renderedInterfaceMode && payload) {
      setRenderedInterfaceMode(persistedInterfaceMode);
      previousInterfaceModeRef.current = persistedInterfaceMode;
    }
  }, [payload, persistedInterfaceMode, renderedInterfaceMode]);

  useEffect(() => {
    if (!payload || interfaceMode === 'kavita') return undefined;
    const preload = () => {
      void preloadKavitaShell().catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload, { timeout: 2500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(preload, 800);
    return () => window.clearTimeout(timer);
  }, [interfaceMode, payload]);

  useEffect(() => {
    if (!payload) return;
    const persistedExperimental = payload?.persisted?.ui?.experimental || {};
    if (!persistedExperimental.visualReader && !persistedExperimental.guidedView && !persistedExperimental.visualDedupe) {
      legacyExperimentalPatchPendingRef.current = false;
      return;
    }
    if (legacyExperimentalPatchPendingRef.current) {
      return;
    }
    legacyExperimentalPatchPendingRef.current = true;
    const patchedExperimental = {
      ...persistedExperimental,
      visualReader: false,
      guidedView: false,
      visualDedupe: false
    };
    const applyLegacyPatch = window.mangaAPI.updateSettingsLight
      ? window.mangaAPI.updateSettingsLight({ experimental: patchedExperimental })
      : window.mangaAPI.updateSettings({ experimental: patchedExperimental });
    applyLegacyPatch.then((nextPayload) => {
      legacyExperimentalPatchPendingRef.current = false;
      if (nextPayload?.persisted) {
        setPayload(nextPayload);
      } else {
        startTransition(() => {
          setPayload((previous) => mergeUiSettingsIntoPayload(previous, { experimental: patchedExperimental }));
        });
      }
    }).catch(() => {
      legacyExperimentalPatchPendingRef.current = false;
      // Garder l'UI stable meme si la migration de flags ne passe pas du premier coup.
    });
  }, [
    payload,
    payload?.persisted?.ui?.experimental?.visualReader,
    payload?.persisted?.ui?.experimental?.guidedView,
    payload?.persisted?.ui?.experimental?.visualDedupe
  ]);

  const keyboardShortcuts = useMemo(() => {
    const customShortcuts = ui.keyboardShortcuts || {};
    return Object.fromEntries(
      Object.entries(DEFAULT_KEYBOARD_SHORTCUTS).map(([id, shortcut]) => [
        id,
        typeof customShortcuts[id] === 'string' && customShortcuts[id].trim()
          ? customShortcuts[id]
          : shortcut
      ])
    );
  }, [ui.keyboardShortcuts]);
  const experimental = ui.experimental ?? {};
  useEffect(() => {
    if (!experimental.performanceDiagnostics || typeof PerformanceObserver === 'undefined') return undefined;
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.duration < 50) return;
          window.mangaAPI?.reportPerformanceEntry?.({
            kind: 'renderer.longtask',
            durationMs: entry.duration
          });
        });
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch (_error) {
      return undefined;
    }
    return () => observer?.disconnect();
  }, [experimental.performanceDiagnostics]);
  const library = payload?.library ?? { categories: [], allMangas: [], favorites: [], recents: [] };
  const webSourcesPlugin = useMemo(
    () => (plugins.find((plugin) => plugin.id === 'sources-web') ?? payload?.plugins?.find?.((plugin) => plugin.id === 'sources-web') ?? null),
    [plugins, payload?.plugins]
  );
  const webSourcesEnabled = Boolean(webSourcesPlugin?.installed && webSourcesPlugin?.enabled);

  const selectedCategoryId = payload?.persisted.ui.selectedCategoryId ?? null;
  const selectedCategory = library.categories.find((category) => category.id === selectedCategoryId) ?? null;

  const visibleCategories = useMemo(() => {
    return library.categories.filter((category) => !category.hidden);
  }, [library.categories]);

  const activeView = getTabView(activeTab);
  const readerFocusActive = visualVariant === 'horizon'
    && activeView.screen === 'reader'
    && ui.readerFocusMode !== 'off';
  const shellSidebarCollapsed = Boolean(ui.sidebarCollapsed);
  const activeSearchPrivacyLocked = Boolean(
    payload?.persisted?.vault?.locked
    || payload?.persisted?.vault?.stealthMode
  );
  const activeSearchPrivateContext = activeScreen === 'vault' || Boolean(activeTab?.searchPrivate);
  const maskActiveSearch = (activeScreen !== 'vault' && Boolean(activeTab?.searchPrivate))
    || (activeSearchPrivacyLocked && activeSearchPrivateContext);
  const searchState = useMemo(
    () => maskActiveSearch
      ? normalizeSearchState(null)
      : normalizeSearchState(activeTab?.searchState, activeTab?.search),
    [activeTab?.search, activeTab?.searchState, maskActiveSearch]
  );
  const search = searchState.query;
  const setSearchState = useCallback((nextStateOrUpdater) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      const current = normalizeSearchState(tab.searchState, tab.search);
      const requested = typeof nextStateOrUpdater === 'function'
        ? nextStateOrUpdater(current)
        : nextStateOrUpdater;
      return {
        ...tab,
        searchPrivate: activeScreen === 'vault',
        searchState: normalizeSearchState(requested)
      };
    }));
  }, [activeScreen, activeTabId, setTabs]);
  const setSearch = useCallback((nextQuery) => {
    setSearchState((current) => updateSearchState(current, {
      query: typeof nextQuery === 'function' ? nextQuery(current.query) : nextQuery
    }));
  }, [setSearchState]);
  const neutralizeActivePrivateSearch = useCallback(({
    leavingPrivateContext = false
  } = {}) => {
    if (!leavingPrivateContext && !activeTab?.searchPrivate) return;
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === activeTabId
        ? neutralizePrivateTabSearch(tab, { leavingPrivateContext })
        : tab
    )));
    advancedSearchControllerRef.current.cancel();
    advancedSearchGenerationRef.current += 1;
    setAdvancedSearchState(createAdvancedSearchState({
      generation: advancedSearchGenerationRef.current
    }));
  }, [activeTab?.searchPrivate, activeTabId, setTabs]);
  useEffect(() => {
    if (activeScreen === 'vault' || !activeTab?.searchPrivate) return;
    neutralizeActivePrivateSearch();
  }, [activeScreen, activeTab?.searchPrivate, activeTabId, neutralizeActivePrivateSearch]);
  const activeScrollScope = activeScreen === 'vault'
    ? `vault:${vaultCategoryFilterId ?? 'all'}`
    : activeScreen === 'sources'
      ? `sources:${sourcesSection || 'explorer'}`
      : `category:${selectedCategoryId ?? 'all'}`;
  const activeScrollKey = useMemo(
    () => makeViewScrollKey(activeTab?.id || 'tab', activeView, activeScreen, activeScrollScope),
    [activeTab?.id, activeView, activeScreen, activeScrollScope]
  );
  if (activeScrollRestorationRef.current.key !== activeScrollKey) {
    activeScrollRestorationRef.current = {
      key: activeScrollKey,
      position: scrollPositionsRef.current[activeScrollKey] ?? null
    };
  }
  const activeInitialScrollPosition = activeScrollRestorationRef.current.position;
  const activeInitialScrollTop = getScrollOffset(activeInitialScrollPosition);

  useEffect(() => {
    window.mangaAPI?.setReaderActive?.(activeView.screen === 'reader');
    return () => {
      window.mangaAPI?.setReaderActive?.(false);
    };
  }, [activeView.screen]);

  useEffect(() => {
    const flushOnBlur = () => {
      void flushReaderSession().catch(() => {});
    };
    window.addEventListener('blur', flushOnBlur);
    return () => {
      window.removeEventListener('blur', flushOnBlur);
      void flushReaderSession().catch(() => {});
    };
  }, []);

  useEffect(() => {
    let lastSignalAt = 0;
    const emitInteraction = () => {
      const now = Date.now();
      if ((now - lastSignalAt) < 1200) return;
      lastSignalAt = now;
      window.mangaAPI?.markInteraction?.();
    };

    window.addEventListener('pointerdown', emitInteraction, { passive: true });
    window.addEventListener('keydown', emitInteraction);
    window.addEventListener('wheel', emitInteraction, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', emitInteraction);
      window.removeEventListener('keydown', emitInteraction);
      window.removeEventListener('wheel', emitInteraction);
    };
  }, []);
  const captureCurrentViewScroll = useCallback(() => {
    const candidates = [...document.querySelectorAll(
      '.library-view, .virtual-manga-grid-scroll, .kv-scroll-region, .detail-view, .preview-view, .dashboard-view, .collections-view, .vault-view, .maintenance-view, .workbench-view, .sources-view'
    )];
    const currentScrollable = candidates.find((node) => (
      node.scrollHeight > node.clientHeight
      && ['auto', 'scroll'].includes(window.getComputedStyle(node).overflowY)
    )) || candidates[0];
    if (currentScrollable) {
      const previousPosition = normalizeScrollPosition(scrollPositionsRef.current[activeScrollKey]);
      scrollPositionsRef.current = updateScrollPositionRegistry(
        scrollPositionsRef.current,
        activeScrollKey,
        {
          ...previousPosition,
          fallbackOffset: currentScrollable.scrollTop || 0,
          updatedAt: Date.now()
        }
      );
      scheduleScrollPersistence();
    }
  }, [activeScrollKey, scheduleScrollPersistence]);

  const baseMangas = useMemo(() => {
    if (activeScreen === 'favorites') return library.favorites;
    if (activeScreen === 'recents') {
      const seen = new Set();
      return library.recents
        .map((recent) => findManga(library, recent.mangaId))
        .filter((manga) => {
          if (!manga || seen.has(manga.id)) return false;
          seen.add(manga.id);
          return true;
        });
    }
    return library.allMangas;
  }, [activeScreen, library]);

  const deferredSearch = useDeferredValue(search);
  const parsedSearch = useMemo(() => parseSearchQuery(deferredSearch), [deferredSearch]);
  const immediateParsedSearch = useMemo(() => parseSearchQuery(search), [search]);
  const advancedSearchQuery = useMemo(
    () => (immediateParsedSearch.textTerms || []).join(' ').trim(),
    [immediateParsedSearch]
  );
  const advancedSearchScope = activeScreen === 'vault' ? 'vault' : 'library';
  const combinedParsedSearch = useMemo(() => ({
    ...parsedSearch,
    filters: [...(parsedSearch.filters || []), ...(searchState.filters || [])]
  }), [parsedSearch, searchState.filters]);

  useEffect(() => {
    advancedSearchGenerationRef.current += 1;
    const generation = advancedSearchGenerationRef.current;
    if (!payload || advancedSearchQuery.length < 3) {
      advancedSearchControllerRef.current.cancel();
      setAdvancedSearchState(createAdvancedSearchState({
        query: advancedSearchQuery,
        scope: advancedSearchScope,
        generation
      }));
      return;
    }

    setAdvancedSearchState(createAdvancedSearchState({
      query: advancedSearchQuery,
      scope: advancedSearchScope,
      generation,
      results: [],
      busy: true
    }));

    advancedSearchControllerRef.current.run({
      query: advancedSearchQuery,
      limit: 120,
      scope: advancedSearchScope
    }).then((outcome) => {
      if (outcome?.stale) return;
      if (outcome?.error) {
        setAdvancedSearchState((current) => advancedSearchResultsMatch(current, {
          query: advancedSearchQuery,
          scope: advancedSearchScope,
          generation
        }) ? createAdvancedSearchState({
          query: advancedSearchQuery,
          scope: advancedSearchScope,
          generation,
          results: [],
          busy: false,
          error: outcome.error?.message || 'Recherche etendue indisponible.'
        }) : current);
        return;
      }
      const result = outcome?.value;
      setAdvancedSearchState((current) => advancedSearchResultsMatch(current, {
        query: advancedSearchQuery,
        scope: advancedSearchScope,
        generation
      }) ? createAdvancedSearchState({
        query: advancedSearchQuery,
        scope: advancedSearchScope,
        generation,
        results: Array.isArray(result?.results) ? result.results : [],
        busy: false,
        error: ''
      }) : current);
    });
  }, [payload, advancedSearchQuery, advancedSearchScope]);

  useEffect(() => () => advancedSearchControllerRef.current?.cancel(), []);

  const libraryReferenceIndex = useMemo(
    () => createLibraryReferenceIndex(library),
    [library]
  );

  const advancedSearchMangaIds = useMemo(() => {
    if (!advancedSearchQuery || !advancedSearchResultsMatch(advancedSearchState, {
      query: advancedSearchQuery,
      scope: advancedSearchScope,
      generation: advancedSearchGenerationRef.current
    })) return null;
    return libraryReferenceIndex.resolveMangaIds(advancedSearchState.results);
  }, [advancedSearchQuery, advancedSearchScope, advancedSearchState, libraryReferenceIndex]);
  const workGroups = payload?.persisted?.workGroups ?? {};
  const publicSearchIndex = useMemo(
    () => buildCompactSearchIndex(library.allMangas, {
      collectionsById: payload?.persisted?.collections || {},
      tags: Object.values(payload?.persisted?.tags || {})
    }),
    [library.allMangas, payload?.persisted?.collections, payload?.persisted?.tags]
  );

  const filteredMangas = useMemo(() => {
    const currentCandidates = baseMangas.filter((manga) => {
      if (!ui.showHiddenCategories && manga.categoryHidden) return false;
      if (selectedCategory && manga.categoryId !== selectedCategory.id) return false;
      return true;
    });
    const allCandidates = library.allMangas.filter((manga) => ui.showHiddenCategories || !manga.categoryHidden);
    const candidates = searchState.scope === 'all' ? allCandidates : currentCandidates;
    const hasSearch = Boolean(search.trim() || searchState.filters.length);
    if (!hasSearch) {
      return projectCanonicalMangas(sortMangas(candidates, ui.sort), workGroups);
    }
    const ranked = searchCompactIndex(publicSearchIndex, {
      query: search,
      filters: searchState.filters,
      scopeIds: new Set(candidates.map((manga) => String(manga.id))),
      includePrivate: false,
      extendedIds: advancedSearchMangaIds
    });
    return projectCanonicalMangas(ranked.map((result) => result.manga), workGroups);
  }, [advancedSearchMangaIds, baseMangas, library.allMangas, publicSearchIndex, search, searchState.filters, searchState.scope, selectedCategory, ui.showHiddenCategories, ui.sort, workGroups]);

  const searchStatus = useMemo(() => {
    if (!advancedSearchQuery) return null;
    if (!advancedSearchResultsMatch(advancedSearchState, {
      query: advancedSearchQuery,
      scope: advancedSearchScope,
      generation: advancedSearchGenerationRef.current
    })) {
      return { label: 'index local...', tone: 'neutral' };
    }
    if (advancedSearchState.busy) {
      return { label: 'index local...', tone: 'neutral' };
    }
    if (advancedSearchState.error) {
      return { label: 'index indisponible', tone: 'warning' };
    }
    return {
      label: `index local ${advancedSearchState.results.length}`,
      tone: 'success'
    };
  }, [advancedSearchQuery, advancedSearchScope, advancedSearchState]);

  const searchChips = useMemo(
    () => formatSearchChips(parsedSearch, { collectionsById: payload?.persisted?.collections || {} }),
    [parsedSearch, payload?.persisted?.collections]
  );

  const allCollections = useMemo(
    () => Object.values(payload?.persisted?.collections ?? {}),
    [payload?.persisted?.collections]
  );

  const allTags = useMemo(
    () => Object.values(payload?.persisted?.tags ?? {}),
    [payload?.persisted?.tags]
  );

  const sidebarPins = useMemo(
    () => (Array.isArray(ui.sidebarPins) ? ui.sidebarPins : []),
    [ui.sidebarPins]
  );
  const sidebarSections = useMemo(
    () => (Array.isArray(ui.sidebarSections) ? ui.sidebarSections : []),
    [ui.sidebarSections]
  );
  const sidebarHiddenSections = useMemo(
    () => (ui.sidebarHiddenSections && typeof ui.sidebarHiddenSections === 'object' ? ui.sidebarHiddenSections : {}),
    [ui.sidebarHiddenSections]
  );

  const vaultLibrary = payload?.vaultLibrary ?? { categories: [], allMangas: [], favorites: [], recents: [] };
  const selectableMangas = useMemo(() => {
    const merged = new Map();
    [...(library.allMangas || []), ...(vaultLibrary.allMangas || [])].forEach((manga) => {
      if (manga?.id && !merged.has(manga.id)) merged.set(manga.id, manga);
    });
    return attachWorkGroupMetadata([...merged.values()], workGroups);
  }, [library.allMangas, vaultLibrary.allMangas, workGroups]);
  const entityLibrary = useMemo(
    () => ({ allMangas: selectableMangas }),
    [selectableMangas]
  );
  const vaultState = payload?.persisted?.vault ?? {
    configured: false,
    locked: true,
    blurCovers: true,
    privateCount: 0,
    privateCategoryCount: 0,
    privateMangaIds: [],
    privateCategoryIds: [],
    autoLockOnClose: true,
    securityMode: 'none',
    systemProtectionAvailable: false,
    stealthMode: false
  };
  const vaultCategories = useMemo(
    () => (Array.isArray(vaultLibrary.categories) ? vaultLibrary.categories : []),
    [vaultLibrary.categories]
  );
  const activeVaultCategory = useMemo(
    () => vaultCategories.find((category) => category.id === vaultCategoryFilterId) ?? null,
    [vaultCategories, vaultCategoryFilterId]
  );

  const workbenchQueueIds = payload?.persisted?.metadataWorkbenchItems?.map((item) => item.mangaId)
    ?? payload?.persisted?.metadataWorkbenchQueue
    ?? [];
  const workbenchQueueMangas = useMemo(
    () => workbenchQueueIds.map((mangaId) => findManga(entityLibrary, mangaId)).filter(Boolean),
    [entityLibrary, workbenchQueueIds]
  );

  const privateMangas = useMemo(
    () => {
      const mangas = Array.isArray(vaultLibrary.allMangas) ? vaultLibrary.allMangas : [];
      if (!vaultCategoryFilterId) return mangas;
      return mangas.filter((manga) => manga.categoryId === vaultCategoryFilterId);
    },
    [vaultCategoryFilterId, vaultLibrary.allMangas]
  );
  const privateSearchIndex = useMemo(
    () => buildCompactSearchIndex(vaultLibrary.allMangas, {
      collectionsById: payload?.persisted?.collections || {},
      tags: Object.values(payload?.persisted?.tags || {})
    }),
    [payload?.persisted?.collections, payload?.persisted?.tags, vaultLibrary.allMangas]
  );
  const filteredPrivateMangas = useMemo(() => {
    const allCandidates = Array.isArray(vaultLibrary.allMangas) ? vaultLibrary.allMangas : [];
    const candidates = searchState.scope === 'all' ? allCandidates : privateMangas;
    const hasSearch = Boolean(search.trim() || searchState.filters.length);
    if (!hasSearch) {
      return projectCanonicalMangas(sortMangas(candidates, ui.sort), workGroups);
    }
    const ranked = searchCompactIndex(privateSearchIndex, {
      query: search,
      filters: searchState.filters,
      scopeIds: new Set(candidates.map((manga) => String(manga.id))),
      includePrivate: !vaultState.locked,
      extendedIds: advancedSearchMangaIds
    });
    return projectCanonicalMangas(ranked.map((result) => result.manga), workGroups);
  }, [advancedSearchMangaIds, privateMangas, privateSearchIndex, search, searchState.filters, searchState.scope, ui.sort, vaultLibrary.allMangas, vaultState.locked, workGroups]);
  const suggestionScopeIds = useMemo(() => {
    if (searchState.scope === 'all') return null;
    const candidates = activeScreen === 'vault'
      ? privateMangas
      : baseMangas.filter((manga) => {
        if (!ui.showHiddenCategories && manga.categoryHidden) return false;
        if (selectedCategory && manga.categoryId !== selectedCategory.id) return false;
        return true;
      });
    return new Set(candidates.map((manga) => String(manga.id)));
  }, [activeScreen, baseMangas, privateMangas, searchState.scope, selectedCategory, ui.showHiddenCategories]);
  const searchSuggestions = useMemo(
    () => getSearchSuggestions(
      activeScreen === 'vault' ? privateSearchIndex : publicSearchIndex,
      search,
      {
        limit: 8,
        recents: activeTab?.incognito || activeTab?.searchPrivate || activeScreen === 'vault' ? [] : recentSearches,
        includePrivate: activeScreen === 'vault' && !vaultState.locked,
        scopeIds: suggestionScopeIds
      }
    ),
    [activeScreen, activeTab?.incognito, activeTab?.searchPrivate, privateSearchIndex, publicSearchIndex, recentSearches, search, suggestionScopeIds, vaultState.locked]
  );
  const activeSearchResultCount = activeScreen === 'vault'
    ? filteredPrivateMangas.length
    : filteredMangas.length;
  const dashboardMangas = useMemo(
    () => projectCanonicalMangas(library.allMangas.filter((manga) => !manga.categoryHidden), workGroups),
    [library.allMangas, workGroups]
  );
  const dashboardFavorites = useMemo(
    () => projectCanonicalMangas(library.favorites.filter((manga) => !manga.categoryHidden), workGroups),
    [library.favorites, workGroups]
  );
  const dashboardSelectionModel = useMemo(
    () => buildDashboardSelectionModel({
      allMangas: dashboardMangas,
      favorites: dashboardFavorites,
      persisted: payload?.persisted ?? {},
      ui
    }),
    [dashboardFavorites, dashboardMangas, payload?.persisted, ui]
  );
  const kavitaDashboardSelectionIds = useMemo(() => {
    const seen = new Set();
    return (library.recents || []).flatMap((entry) => {
      const mangaId = String(entry?.mangaId || '').trim();
      if (!mangaId || seen.has(mangaId)) return [];
      seen.add(mangaId);
      return [mangaId];
    }).slice(0, 12);
  }, [library.recents]);

  const activeSelectionKey = makeSelectionSessionKey({
    interfaceMode,
    tabId: activeTabId,
    view: `${activeView.screen}:${activeScreen}${activeScreen === 'collections' ? `:${collectionSelectionView.viewId}` : ''}`
  });
  const activeSelectionSession = getSelectionSession(selectionSessions, activeSelectionKey);
  const visibleSelectionIds = useMemo(
    () => resolveVisibleSelectionIds({
      interfaceMode,
      activeViewScreen: activeView.screen,
      activeScreen,
      filteredMangas,
      vaultMangas: filteredPrivateMangas,
      workbenchMangas: workbenchQueueMangas,
      collectionVisibleIds: collectionSelectionView.ids,
      dashboardModel: interfaceMode === 'kavita'
        ? { visibleIds: kavitaDashboardSelectionIds }
        : dashboardSelectionModel
    }),
    [
      activeScreen,
      activeView.screen,
      collectionSelectionView.ids,
      dashboardSelectionModel,
      filteredMangas,
      filteredPrivateMangas,
      interfaceMode,
      kavitaDashboardSelectionIds,
      workbenchQueueMangas
    ]
  );
  const selectionSummary = useMemo(
    () => getSelectionSummary(activeSelectionSession, visibleSelectionIds),
    [activeSelectionSession, visibleSelectionIds]
  );
  const selectionMode = activeSelectionSession.mode;
  const selectedMangaIds = selectionSummary.selectedIds;
  const selectedMangaIdSet = selectionSummary.selectedIdSet;
  const selectedMangas = useMemo(
    () => selectableMangas.filter((manga) => selectedMangaIdSet.has(String(manga.id ?? '').trim())),
    [selectableMangas, selectedMangaIdSet]
  );

  const readingQueue = payload?.persisted?.readingQueue ?? [];
  const readingQueueEntries = useMemo(() => {
    return readingQueue.map((entry, index) => {
      const manga = findManga(library, entry.mangaContentId || entry.mangaId)
        || findManga(vaultLibrary, entry.mangaContentId || entry.mangaId)
        || findManga({ allMangas: selectableMangas }, entry.mangaContentId || entry.mangaId);
      if (!manga) return null;

      const chapter = entry.chapterContentId || entry.chapterId
        ? (manga.chapters || []).find((item) => matchesEntityReference(item, entry.chapterContentId || entry.chapterId)) || null
        : null;

      return {
        key: `${entry.mangaId}:${entry.chapterId || 'manga'}:${index}`,
        raw: entry,
        manga,
        chapter,
        mangaId: manga.id,
        chapterId: chapter?.id || null,
        title: manga.displayTitle,
        subtitle: chapter?.name || manga.author || manga.categoryName || 'Manga',
        displaySource: entry.displaySource || 'manual',
        pinned: Boolean(entry.pinned),
        deferredUntil: entry.deferredUntil || null
      };
    }).filter(Boolean);
  }, [readingQueue, library, vaultLibrary, selectableMangas]);

  useEffect(() => {
    if (vaultCategoryFilterId && !vaultCategories.some((category) => category.id === vaultCategoryFilterId)) {
      setVaultCategoryFilterId(null);
    }
  }, [vaultCategories, vaultCategoryFilterId]);

  const maintenanceIssues = useMemo(() => {
    const collectDetails = activeScreen === 'maintenance';
    const missingCover = [];
    const missingMetadata = [];
    const sparseChapters = [];
    const duplicateMap = new Map();
    let missingCoverCount = 0;
    let missingMetadataCount = 0;
    let sparseChaptersCount = 0;

    library.allMangas.forEach((manga) => {
      const displayTitle = manga.displayTitle || manga.name || 'Manga';
      const normalizedTitle = displayTitle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

      if (normalizedTitle) {
        if (collectDetails) {
          const group = duplicateMap.get(normalizedTitle) ?? [];
          group.push(manga);
          duplicateMap.set(normalizedTitle, group);
        } else {
          duplicateMap.set(normalizedTitle, (duplicateMap.get(normalizedTitle) || 0) + 1);
        }
      }

      if (!manga.coverSrc || manga.coverType === 'default') {
        missingCoverCount += 1;
        if (collectDetails) missingCover.push(manga);
      }

      const hasAuthor = typeof manga.author === 'string' && manga.author.trim();
      const hasDescription = typeof manga.description === 'string' && manga.description.trim();
      if (!hasAuthor || !hasDescription) {
        missingMetadataCount += 1;
        if (collectDetails) missingMetadata.push(manga);
      }

      const chapters = Array.isArray(manga.chapters) ? manga.chapters : [];
      if (!chapters.length) {
        sparseChaptersCount += 1;
        if (collectDetails) {
          sparseChapters.push({ manga, reason: 'Aucun chapitre detecte dans ce dossier.' });
        }
        return;
      }

      const emptyChapter = chapters.find((chapter) => !chapter.pageCount || chapter.pageCount <= 0);
      if (emptyChapter) {
        sparseChaptersCount += 1;
        if (collectDetails) {
          sparseChapters.push({
            manga,
            reason: `${emptyChapter.name || 'Chapitre'} semble vide ou incomplet.`
          });
        }
      }
    });

    const duplicateGroups = collectDetails
      ? [...duplicateMap.entries()]
        .filter(([, mangas]) => mangas.length > 1)
        .map(([key, mangas]) => ({
          key,
          mangas,
          label: mangas[0]?.displayTitle || mangas[0]?.name || 'Titre proche'
        }))
      : [];
    const duplicateGroupCount = collectDetails
      ? duplicateGroups.length
      : [...duplicateMap.values()].filter((count) => count > 1).length;

    return {
      missingCover,
      missingMetadata,
      sparseChapters,
      duplicateGroups,
      missingCoverCount,
      missingMetadataCount,
      sparseChaptersCount,
      duplicateGroupCount,
      totalCount: missingCoverCount + missingMetadataCount + sparseChaptersCount + duplicateGroupCount
    };
  }, [activeScreen, library.allMangas]);

  const maintenanceCount = maintenanceIssues.totalCount || 0;

  const kavitaCollectionShowcase = useMemo(() => {
    const persisted = payload?.persisted ?? {};
    const mangaById = new Map((library.allMangas || []).map((manga) => [manga.id, manga]));
    const manual = Object.values(persisted.collections || {}).map((collection) => {
      const mangas = (collection.mangaIds || []).map((id) => mangaById.get(id)).filter(Boolean);
      return { ...collection, mangas };
    });
    const smart = Object.values(persisted.smartCollections || {}).map((collection) => {
      const mangas = resolveSmartCollection(library.allMangas || [], collection, persisted);
      return { ...collection, isSmart: true, mangas, mangaIds: mangas.map((manga) => manga.id) };
    });
    return [...manual, ...smart];
  }, [library.allMangas, payload?.persisted]);

  const currentManga = activeView.mangaId ? findManga(entityLibrary, activeView.mangaId) : null;
  const currentChapterData = activeView.chapterId && currentManga
    ? {
      manga: currentManga,
      chapter: (currentManga.chapters || []).find((item) => matchesEntityReference(item, activeView.chapterId)) ?? null
    }
    : { manga: currentManga, chapter: null };

  const resolvedChapter = currentChapterData.chapter
    ? (() => {
        const resolvedPages = chapterPagesCache[currentChapterData.chapter.id] ?? currentChapterData.chapter.pages;
        return {
          ...currentChapterData.chapter,
          pages: resolvedPages,
          pageCount: Array.isArray(resolvedPages) && resolvedPages.length > 0
            ? resolvedPages.length
            : currentChapterData.chapter.pageCount
        };
      })()
    : null;

  const currentMangaAnnotations = useMemo(
    () => (currentManga ? (payload?.persisted?.annotations?.[currentManga.id] ?? []) : []),
    [payload?.persisted?.annotations, currentManga]
  );

  useEffect(() => {
    if (!payload) return;
    const visibleIds = new Set(selectableMangas.map((manga) => String(manga.id ?? '').trim()).filter(Boolean));
    const removedIds = activeSelectionSession.selectedIds.filter((mangaId) => !visibleIds.has(mangaId));
    if (removedIds.length > 0) {
      dispatchSelection({ type: 'remove', key: activeSelectionKey, ids: removedIds });
    }
  }, [activeSelectionKey, activeSelectionSession.selectedIds, payload, selectableMangas]);

  useEffect(() => {
    if (!payload || activeScreen !== 'maintenance') return;
    let disposed = false;
    window.mangaAPI.getStats({ includeOcr: activeScreen === 'maintenance' }).then((stats) => {
      if (!disposed) {
        setMaintenanceStats(stats);
        if (stats?.syncStatus) setSyncStatus(stats.syncStatus);
        if (stats?.ocr) setOcrStatus(stats.ocr);
      }
    }).catch(() => {
      if (!disposed) setMaintenanceStats(null);
    });
    window.mangaAPI.getMigrationStatus?.().then((status) => {
      if (!disposed) setMigrationStatus(status);
    }).catch(() => {
      if (!disposed) setMigrationStatus(null);
    });

    setDuplicateCandidates([]);
    return () => {
      disposed = true;
    };
  }, [!!payload, activeScreen]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    let disposed = false;
    setPluginFeedback('');
    window.mangaAPI.listPlugins().then((result) => {
      if (!disposed) setPlugins(Array.isArray(result?.plugins) ? result.plugins : []);
    }).catch(() => {
      if (!disposed) setPlugins([]);
    });
    return () => {
      disposed = true;
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!currentChapterData.chapter?.path) return;
    if (!(activeView.screen === 'preview' || activeView.screen === 'reader')) return;
    if (chapterPagesCache[currentChapterData.chapter.id]) return;

    let disposed = false;
    window.mangaAPI.getChapterPages(currentChapterData.chapter.path).then((pages) => {
      if (disposed) return;
      setChapterPagesCache((prev) => (prev[currentChapterData.chapter.id] ? prev : {
        ...prev,
        [currentChapterData.chapter.id]: pages
      }));

      if (Array.isArray(pages) && pages.length > 0) {
        setPayload((prev) => {
          if (!prev?.library) return prev;
          const nextPageCount = pages.length;
          const applyMangaUpdate = (manga) => {
            if (!manga?.chapters?.some((chapter) => chapter.id === currentChapterData.chapter.id)) return manga;
            const chapters = manga.chapters.map((chapter) => chapter.id === currentChapterData.chapter.id
              ? { ...chapter, pageCount: nextPageCount }
              : chapter);
            return buildMangaAggregate({
              ...manga,
              chapters,
              pageCount: chapters.reduce((sum, chapter) => sum + (chapter.pageCount || 0), 0)
            });
          };

          return {
            ...prev,
            library: {
              ...prev.library,
              allMangas: prev.library.allMangas.map(applyMangaUpdate),
              favorites: prev.library.favorites.map(applyMangaUpdate),
              categories: prev.library.categories.map((category) => ({
                ...category,
                mangas: category.mangas.map(applyMangaUpdate)
              }))
            }
          };
        });
      }
    }).catch(() => {
      // Un échec de préchargement ne doit pas casser l'écran.
    });

    return () => {
      disposed = true;
    };
  }, [activeView.screen, currentChapterData.chapter?.id, currentChapterData.chapter?.path, chapterPagesCache[currentChapterData.chapter?.id]]);

  const tabsMeta = useMemo(() => {
    return tabs.map((tab) => {
      const view = getTabView(tab);
      const manga = view.mangaId ? findManga(entityLibrary, view.mangaId) : null;
      const secureMeta = (meta) => neutralizeLockedVaultTabs(meta, view, vaultState, manga);
      const chapter = view.chapterId && manga
        ? manga.chapters.find((item) => matchesEntityReference(item, view.chapterId)) ?? null
        : null;

      if (view.screen === 'library') {
        const tabScreen = normalizeTabScreen(tab.screen);
        const screenLabels = {
          dashboard: 'Dashboard',
          library: 'Bibliotheque',
          collections: 'Collections',
          favorites: 'Favoris',
          recents: 'Recents',
          maintenance: 'Entretien',
          workbench: 'Atelier',
          sources: 'Sources web',
          vault: 'Coffre'
        };
        const screenSubtitles = {
          dashboard: 'Vue d ensemble',
          collections: 'Collections et vues intelligentes',
          favorites: 'Tes favoris',
          recents: 'Dernieres lectures',
          maintenance: 'Centre d entretien',
          workbench: 'Metadata et covers en lot',
          sources: sourcesSection === 'catalogue' ? 'Depots et extensions' : 'Recherche et import',
          vault: 'Zone privee'
        };
        return secureMeta({
          id: tab.id,
          kind: 'library',
          pinned: Boolean(tab.pinned),
           label: screenLabels[tabScreen] || 'Bibliotheque',
           subtitle: screenSubtitles[tabScreen] || selectedCategory?.name || 'Toute la bibliotheque'
        });
      }

      if (view.screen === 'manga') {
        return secureMeta({
          id: tab.id,
          kind: 'manga',
          pinned: Boolean(tab.pinned),
          label: manga?.displayTitle ?? 'Manga',
          subtitle: manga?.author || 'Détails du manga'
        });
      }

      if (view.screen === 'preview') {
        return secureMeta({
          id: tab.id,
          kind: 'preview',
          pinned: Boolean(tab.pinned),
          label: manga?.displayTitle ?? 'Aperçu',
          subtitle: chapter?.name ?? 'Aperçu du chapitre'
        });
      }

      return secureMeta({
        id: tab.id,
        kind: 'reader',
        pinned: Boolean(tab.pinned),
        label: manga?.displayTitle ?? 'Lecture',
        subtitle: chapter?.name ?? 'Mode lecture'
      });
    });
  }, [tabs, entityLibrary, activeScreen, selectedCategory, sourcesSection, vaultState]);

  const activeTabMeta = useMemo(
    () => tabsMeta.find((tab) => tab.id === activeTabId) ?? tabsMeta[0] ?? null,
    [tabsMeta, activeTabId]
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    const dismiss = () => closeContextMenu();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('mousedown', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeContextMenu]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      let handled = false;
      if (readingQueueOpen) {
        setReadingQueueOpen(false);
        handled = true;
      }
      if (commandPaletteOpen) {
        setCommandPaletteOpen(false);
        handled = true;
      }
      if (searchHelpOpen) {
        setSearchHelpOpen(false);
        handled = true;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [readingQueueOpen, commandPaletteOpen, searchHelpOpen]);

  useEffect(() => {
    const isEditableTarget = (target) => {
      const tagName = target?.tagName?.toLowerCase();
      return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tagName);
    };

    const onKeyDown = (event) => {
      const lowerKey = String(event.key || '').toLowerCase();
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || lowerKey !== 'k') return;
      if (isEditableTarget(event.target) && !commandPaletteOpen) return;
      event.preventDefault();
      setCommandPaletteOpen((prev) => !prev);
      setCommandPaletteQuery('');
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [commandPaletteOpen]);

  function mergeUiSettingsIntoPayload(previousPayload, patch = {}) {
    if (!previousPayload || !patch || typeof patch !== 'object') return previousPayload;
    const previousPersisted = previousPayload.persisted || {};
    const previousUi = previousPersisted.ui || {};
    const nextUi = {
      ...previousUi,
      ...patch,
      experimental: patch?.experimental
        ? {
            ...(previousUi.experimental || {}),
            ...patch.experimental
          }
        : (previousUi.experimental || {})
    };
    return {
      ...previousPayload,
      persisted: {
        ...previousPersisted,
        ui: nextUi
      }
    };
  }

  function mergeVaultPrefsIntoPayload(previousPayload, patch = {}) {
    if (!previousPayload || !patch || typeof patch !== 'object') return previousPayload;
    const previousPersisted = previousPayload.persisted || {};
    const previousVault = previousPersisted.vault || {};
    const nextVault = {
      ...previousVault,
      ...patch
    };
    return {
      ...previousPayload,
      persisted: {
        ...previousPersisted,
        vault: nextVault
      }
    };
  }

  async function refreshWith(promise) {
    const nextPayload = await promise;
    startTransition(() => {
      setPayload((previous) => mergePayloadForStability(previous, nextPayload));
    });
  }

  async function applyOptimisticMutation({
    key,
    label,
    updatePayload,
    captureInverse,
    captureApplied,
    rollback,
    persist,
    fallback
  }) {
    if (typeof persist !== 'function') {
      await refreshWith(fallback());
      return;
    }
    return optimisticMutationManagerRef.current.execute({
      key,
      label,
      apply: updatePayload,
      captureInverse,
      captureApplied,
      rollback,
      persist
    });
  }

  function applyIdentityPatch(result) {
    if (!result?.ok || !result?.patch) return false;
    latestStateRevisionRef.current = Math.max(latestStateRevisionRef.current, Number(result.revision || 0));
    updatePayloadTracked((previous) => mergeIdentityPatchIntoPayload(previous, result));
    return true;
  }

  function scheduleBackgroundBootstrapRefresh(delay = 1200) {
    if (backgroundRefreshTimerRef.current != null) {
      window.clearTimeout(backgroundRefreshTimerRef.current);
    }
    backgroundRefreshTimerRef.current = window.setTimeout(() => {
      backgroundRefreshTimerRef.current = null;
      const run = () => backgroundRefreshControllerRef.current.run().catch(() => {});
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 3500 });
      } else {
        run();
      }
    }, delay);
  }

  function handleRetryBackgroundSync() {
    return backgroundRefreshControllerRef.current.retry();
  }

  function handleDismissReliabilityIssue(issueId) {
    const issue = reliabilityIssues.find((entry) => entry.id === issueId);
    if (issue?.kind === 'mutation') {
      optimisticMutationManagerRef.current.dismiss(issueId);
      return;
    }
    setReliabilityIssues((current) => current.filter((entry) => entry.id !== issueId));
  }

  async function handleRetryReliabilityIssue(issueId) {
    const issue = reliabilityIssues.find((entry) => entry.id === issueId);
    if (!issue) return;
    if (issue.kind === 'mutation') {
      await optimisticMutationManagerRef.current.retry(issueId);
      return;
    }
    setReliabilityIssues((current) => current.filter((entry) => entry.id !== issueId));
    await issue.retry?.();
  }

  function pushViewToActive(nextView) {
    captureCurrentViewScroll();
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      return {
        ...tab,
        stack: [...tab.stack, normalizeView(nextView)]
      };
    }));
  }

  function replaceActiveView(nextView) {
    captureCurrentViewScroll();
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      const stack = [...tab.stack];
      stack[stack.length - 1] = normalizeView(nextView);
      return { ...tab, stack };
    }));
  }

  async function popActiveView() {
    await flushReaderSession();
    captureCurrentViewScroll();
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      if (tab.stack.length <= 1) {
        return { ...tab, stack: [normalizeView()] };
      }
      return { ...tab, stack: tab.stack.slice(0, -1) };
    }));
  }

  function openNewTab(nextView, seedStack = [], options = {}) {
    captureCurrentViewScroll();
    const newTab = createTab(nextView, seedStack, options);
    const shouldActivate = options.activate !== false;
    setTabs((prev) => [...prev, newTab]);
    if (shouldActivate) {
      setActiveTabId(newTab.id);
    }
    return newTab.id;
  }

  async function openNewLibraryTab(options = {}) {
    await flushReaderSession();
    openNewTab(normalizeView(), [], options);
  }

  async function switchWorkspace(workspaceId) {
    if (!workspaceId || workspaceId === activeWorkspaceId) return;
    await flushReaderSession();
    captureCurrentViewScroll();
    setActiveWorkspaceId(workspaceId);
  }

  function createWorkspaceFromUI() {
    if (workspaces.length >= MAX_WORKSPACES) {
      window.alert(`Limite atteinte: ${MAX_WORKSPACES} espaces maximum.`);
      return null;
    }

    const nextWorkspace = createWorkspace(workspaces.length);
    setWorkspaces((prev) => [...prev, nextWorkspace]);
    captureCurrentViewScroll();
    setActiveWorkspaceId(nextWorkspace.id);
    return nextWorkspace.id;
  }

  function renameWorkspace(workspaceId) {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    requestTextPrompt({
      title: "Renommer l'espace",
      description: 'Choisis un nom simple pour retrouver cet espace rapidement.',
      label: "Nom de l'espace",
      defaultValue: workspace.name,
      placeholder: 'Espace lecture',
      confirmLabel: 'Renommer',
      onConfirm: async (value) => {
        const nextName = String(value || '').trim();
        if (!nextName) return;
        setWorkspaces((prev) => prev.map((item) => (item.id === workspaceId ? { ...item, name: nextName } : item)));
      }
    });
  }

  function deleteWorkspace(workspaceId) {
    if (workspaces.length <= 1) {
      window.alert('Impossible de supprimer le dernier espace.');
      return;
    }

    const workspaceIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (workspaceIndex === -1) return;
    const workspace = workspaces[workspaceIndex];
    const confirmed = window.confirm(`Supprimer l'espace "${workspace.name}" ?`);
    if (!confirmed) return;

    const fallbackWorkspaceId = workspaces[workspaceIndex - 1]?.id
      ?? workspaces[workspaceIndex + 1]?.id
      ?? workspaces[0]?.id
      ?? null;

    setWorkspaces((prev) => prev.filter((item) => item.id !== workspaceId));
    if (activeWorkspaceId === workspaceId && fallbackWorkspaceId) {
      setActiveWorkspaceId(fallbackWorkspaceId);
    }
  }

  function toggleTabPin(tabId) {
    setTabs((prev) => {
      const tabIndex = prev.findIndex((tab) => tab.id === tabId);
      if (tabIndex === -1) return prev;

      const currentTab = prev[tabIndex];
      const toggledTab = { ...currentTab, pinned: !currentTab.pinned };
      const remainingTabs = prev.filter((tab) => tab.id !== tabId);
      const nextTabs = [...remainingTabs];

      if (toggledTab.pinned) {
        const firstUnpinnedIndex = remainingTabs.findIndex((tab) => !tab.pinned);
        const insertIndex = firstUnpinnedIndex === -1 ? remainingTabs.length : firstUnpinnedIndex;
        nextTabs.splice(insertIndex, 0, toggledTab);
      } else {
        const pinnedCount = remainingTabs.filter((tab) => tab.pinned).length;
        nextTabs.splice(pinnedCount, 0, toggledTab);
      }

      return nextTabs;
    });
  }

  function duplicateTab(tabId) {
    const sourceTab = tabs.find((tab) => tab.id === tabId);
    if (!sourceTab) return;
    const duplicate = {
      ...sourceTab,
      id: createTab(normalizeView()).id,
      incognito: Boolean(sourceTab.incognito),
      stack: sourceTab.stack.map((view) => normalizeView(view))
    };
    const sourceIndex = tabs.findIndex((tab) => tab.id === tabId);
    setTabs((prev) => {
      const next = [...prev];
      next.splice(sourceIndex + 1, 0, duplicate);
      return next;
    });
    setActiveTabId(duplicate.id);
  }

  function closeOtherTabs(tabId) {
    const selected = tabs.find((tab) => tab.id === tabId);
    if (!selected) return;
    const nextTabs = tabs.filter((tab) => tab.id === tabId || tab.pinned);
    setTabs(nextTabs);
    setActiveTabId(tabId);
  }

  function closeTabsToRight(tabId) {
    const selectedIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (selectedIndex === -1) return;
    const nextTabs = tabs.filter((tab, index) => index <= selectedIndex || tab.pinned);
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabId);
    }
  }

  function moveTabToWorkspace(tabId, targetWorkspaceId) {
    if (!tabId || !targetWorkspaceId) return;

    setWorkspaces((prev) => {
      const sourceWorkspaceIndex = prev.findIndex((workspace) => workspace.tabs.some((tab) => tab.id === tabId));
      const targetWorkspaceIndex = prev.findIndex((workspace) => workspace.id === targetWorkspaceId);
      if (sourceWorkspaceIndex === -1 || targetWorkspaceIndex === -1 || sourceWorkspaceIndex === targetWorkspaceIndex) {
        return prev;
      }

      const sourceWorkspace = prev[sourceWorkspaceIndex];
      const sourceTabIndex = sourceWorkspace.tabs.findIndex((tab) => tab.id === tabId);
      if (sourceTabIndex === -1) return prev;
      const movingTab = sourceWorkspace.tabs[sourceTabIndex];
      const sourceRemainingTabs = sourceWorkspace.tabs.filter((tab) => tab.id !== tabId);
      const sourceNextTabs = sourceRemainingTabs.length > 0 ? sourceRemainingTabs : [createTab(normalizeView())];

      const sourceNextActiveTabId = sourceWorkspace.activeTabId === tabId
        ? (sourceNextTabs[Math.max(0, sourceTabIndex - 1)] ?? sourceNextTabs[0]).id
        : (sourceNextTabs.some((tab) => tab.id === sourceWorkspace.activeTabId)
          ? sourceWorkspace.activeTabId
          : sourceNextTabs[0].id);

      const next = prev.map((workspace, index) => {
        if (index === sourceWorkspaceIndex) {
          return {
            ...workspace,
            tabs: sourceNextTabs,
            activeTabId: sourceNextActiveTabId
          };
        }

        if (index === targetWorkspaceIndex) {
          return {
            ...workspace,
            tabs: [...workspace.tabs, movingTab]
          };
        }

        return workspace;
      });

      return next;
    });
  }

  async function closeTab(tabId) {
    await flushReaderSession();
    captureCurrentViewScroll();
    if (tabs.length === 1) {
      setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, stack: [normalizeView()] } : tab)));
      setActiveTabId(tabId);
      return;
    }

    const index = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);

    if (activeTabId === tabId) {
      const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      setActiveTabId(fallback.id);
    }
  }

  function reorderTabs(updater) {
    setTabs((prev) => updater(prev));
  }

  async function handleSelectTab(tabId) {
    if (tabId === activeTabId) return;
    await flushReaderSession();
    captureCurrentViewScroll();
    setActiveTabId(tabId);
  }

  function rememberScreenTransition(nextScreen) {
    if (!nextScreen || nextScreen === activeScreen) return;
    const history = screenHistoryRef.current.get(activeTabId) || [];
    if (history[history.length - 1] !== activeScreen) {
      history.push(activeScreen);
      if (history.length > 24) {
        history.splice(0, history.length - 24);
      }
    }
    screenHistoryRef.current.set(activeTabId, history);
  }

  function pullPreviousScreen(fallbackScreen = 'library') {
    const history = screenHistoryRef.current.get(activeTabId) || [];
    while (history.length > 0) {
      const previous = history.pop();
      if (previous && previous !== activeScreen) {
        screenHistoryRef.current.set(activeTabId, history);
        return previous;
      }
    }
    screenHistoryRef.current.set(activeTabId, history);
    return fallbackScreen;
  }

  function navigateToScreen(screen, options = {}) {
    if (!screen || screen === activeScreen) return;
    if (screen !== 'vault' && (activeScreen === 'vault' || activeTab?.searchPrivate)) {
      neutralizeActivePrivateSearch({ leavingPrivateContext: activeScreen === 'vault' });
    }
    if (options.captureScroll !== false) {
      captureCurrentViewScroll();
    }
    if (!options.replaceHistory) {
      rememberScreenTransition(screen);
    }
    setActiveTabScreen(screen);
  }

  function handleScreenChange(screen) {
    navigateToScreen(screen);
    if (screen !== 'collections') {
      setRequestedCollectionId(null);
      setRequestedCollectionsTab('manual');
    }
    if (activeView.screen !== 'library') {
      replaceActiveView(normalizeView());
    }
  }

  function requestTextPrompt(options = {}) {
    setTextPromptState({
      open: true,
      title: options.title || '',
      description: options.description || '',
      label: options.label || 'Nom',
      defaultValue: options.defaultValue || '',
      placeholder: options.placeholder || '',
      confirmLabel: options.confirmLabel || 'Valider',
      cancelLabel: options.cancelLabel || 'Annuler',
      onConfirm: typeof options.onConfirm === 'function' ? options.onConfirm : null
    });
  }

  function closeTextPrompt() {
    setTextPromptState((current) => ({
      ...current,
      open: false,
      onConfirm: null
    }));
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape' && selectionMode) {
        event.preventDefault();
        dispatchSelection({ type: 'exit', key: activeSelectionKey });
        return;
      }

      const numberedTabIndex = resolveNumberedTabIndex(event, tabs.length);
      if (numberedTabIndex !== null) {
        event.preventDefault();
        void handleSelectTab(tabs[numberedTabIndex].id);
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.closeTab)) {
        event.preventDefault();
        closeTab(activeTabId);
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.newTab)) {
        event.preventDefault();
        openNewLibraryTab();
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.openCommandPalette)) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.toggleReadingQueue)) {
        event.preventDefault();
        if (panicSession !== 'panic') {
          setReadingQueueOpen((prev) => !prev);
        }
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.panicLock)) {
        event.preventDefault();
        triggerPanicLock();
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.nextTab)) {
        if (tabs.length <= 1) return;
        event.preventDefault();
        const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex + 1 + tabs.length) % tabs.length;
        void handleSelectTab(tabs[nextIndex].id);
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.prevTab)) {
        if (tabs.length <= 1) return;
        event.preventDefault();
        const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
        if (currentIndex === -1) return;
        const nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        void handleSelectTab(tabs[nextIndex].id);
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.openSettings)) {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.openSources)) {
        event.preventDefault();
        handleOpenWebSources();
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.toggleSidebar)) {
        event.preventDefault();
        void toggleSidebarCollapsed();
        return;
      }

      const lowerKey = String(event.key || '').toLowerCase();
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const digit = Number.parseInt(lowerKey, 10);
        if (Number.isFinite(digit) && digit >= 1 && digit <= MAX_WORKSPACES) {
          const targetWorkspace = workspaces[digit - 1];
          if (targetWorkspace) {
            event.preventDefault();
            switchWorkspace(targetWorkspace.id);
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeSelectionKey, activeTabId, keyboardShortcuts, panicSession, selectionMode, tabs, workspaces]);

  useEffect(() => {
    const goBack = () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (activeTab.stack.length > 1 || activeView.screen !== 'library') {
        captureCurrentViewScroll();
        popActiveView();
        return;
      }
      if (activeScreen !== 'library') {
        captureCurrentViewScroll();
        const previousScreen = pullPreviousScreen('library');
        if (previousScreen !== 'vault' && (activeScreen === 'vault' || activeTab?.searchPrivate)) {
          neutralizeActivePrivateSearch({ leavingPrivateContext: activeScreen === 'vault' });
        }
        setActiveTabScreen(previousScreen);
      }
    };

    const onKeyDown = (event) => {
      if (isEditableTarget(event.target)) return;
      const key = String(event.key || '').toLowerCase();
      if (event.key === 'BrowserBack' || key === 'browserback') {
        event.preventDefault();
        goBack();
        return;
      }
      if (eventMatchesShortcut(event, keyboardShortcuts.goBack)) {
        event.preventDefault();
        goBack();
        return;
      }
    };

    const onMouseUp = (event) => {
      if (event.button === 3) {
        event.preventDefault();
        goBack();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mouseup', onMouseUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onMouseUp, true);
    };
  }, [activeScreen, activeTab.stack.length, activeView.screen, keyboardShortcuts.goBack, settingsOpen]);

  const handleViewScrollPositionChange = useCallback((position) => {
    scrollPositionsRef.current = updateScrollPositionRegistry(
      scrollPositionsRef.current,
      activeScrollKey,
      position
    );
    scheduleScrollPersistence();
  }, [activeScrollKey, scheduleScrollPersistence]);

  const buildReaderViewForChapter = useCallback((mangaId, chapterId, fallbackPageIndex = 0, intentKind = 'normal') => {
    const { chapter } = findChapter(entityLibrary, mangaId, chapterId);
    const entry = resolveReaderEntry({
      chapter,
      fallbackPageIndex,
      intent: normalizeReaderOpenIntent({ kind: intentKind, pageIndex: fallbackPageIndex }, fallbackPageIndex)
    });
    return {
      screen: 'reader',
      mangaId,
      chapterId,
      pageIndex: entry.pageIndex,
      readerState: sanitizeReaderState(entry.readerState),
      readerIntent: entry.intent,
      readerNotice: entry.notice
    };
  }, [entityLibrary]);

  const buildResumeViewForManga = useCallback((mangaId) => {
    const manga = findManga(entityLibrary, mangaId);
    if (!manga) {
      return { screen: 'library', mangaId: null, chapterId: null, pageIndex: 0, readerState: null };
    }

    const resumeProgress = manga.lastProgress ?? null;
    const chapterId = resumeProgress?.chapterId
      ?? manga.chapters?.find((chapter) => !chapter.isRead)?.id
      ?? manga.chapters?.[0]?.id
      ?? null;

    if (!chapterId) {
      return { screen: 'manga', mangaId, chapterId: null, pageIndex: 0, readerState: null };
    }

    return buildReaderViewForChapter(mangaId, chapterId, resumeProgress?.pageIndex ?? 0, 'normal');
  }, [buildReaderViewForChapter, entityLibrary]);

  const isCurrentTabIncognito = Boolean(activeTab?.incognito);

  const isMangaPrivate = useCallback((mangaRef) => {
    const manga = findManga({ allMangas: selectableMangas }, mangaRef);
    return Boolean(manga?.isPrivate);
  }, [selectableMangas]);

  const isViewPrivate = useCallback((view) => {
    if (!view) return false;
    if (view.screen === 'library') {
      return activeScreen === 'vault';
    }
    if (!view.mangaId) return false;
    return isMangaPrivate(view.mangaId);
  }, [activeScreen, isMangaPrivate]);

  useEffect(() => {
    const shouldUseNeutralTitle = panicSession !== 'inactive' || isViewPrivate(activeView);
    document.title = shouldUseNeutralTitle
      ? 'Sawa Manga Library'
      : activeTabMeta?.label
        ? `${activeTabMeta.label} - Sawa Manga Library`
        : 'Sawa Manga Library';
  }, [panicSession, activeView, activeTabMeta, isViewPrivate]);

  const findNextChapterCandidate = useCallback((mangaRef, chapterRef = null) => {
    const manga = findManga(entityLibrary, mangaRef);
    if (!manga) return null;
    const chapters = sortChaptersForNextCandidate(Array.isArray(manga.chapters) ? manga.chapters : []);
    if (!chapters.length) return null;
    if (!chapterRef) {
      return chapters.find((chapter) => !chapter.isRead) || chapters[0] || null;
    }
    const currentIndex = chapters.findIndex((chapter) => matchesEntityReference(chapter, chapterRef));
    if (currentIndex >= 0 && currentIndex < chapters.length - 1) {
      return chapters[currentIndex + 1];
    }
    return null;
  }, [entityLibrary]);

  const buildQueueDraft = useCallback((mangaRef, chapterRef = null, source = 'manual', extra = {}) => {
    const manga = findManga(entityLibrary, mangaRef);
    if (!manga) return null;
    const chapter = chapterRef
      ? (manga.chapters || []).find((item) => matchesEntityReference(item, chapterRef)) || null
      : null;
    return {
      mangaId: manga.contentId || manga.id,
      chapterId: chapter?.contentId || chapter?.id || null,
      source,
      pinned: Boolean(extra.pinned),
      deferredUntil: extra.deferredUntil || null
    };
  }, [entityLibrary]);

  const buildNextQueueDraft = useCallback((mangaRef, chapterRef = null, source = 'next-engine') => {
    const nextChapter = findNextChapterCandidate(mangaRef, chapterRef);
    if (nextChapter) {
      return buildQueueDraft(mangaRef, nextChapter.contentId || nextChapter.id, source);
    }
    const manga = findManga(entityLibrary, mangaRef);
    if (!manga) return null;
    const sameCategory = sortMangasForNextCandidate(selectableMangas.filter((entry) => entry.categoryId === manga.categoryId));
    const currentIndex = sameCategory.findIndex((entry) => matchesEntityReference(entry, mangaRef));
    if (currentIndex >= 0 && currentIndex < sameCategory.length - 1) {
      const nextManga = sameCategory[currentIndex + 1];
      const nextUnreadChapter = findNextChapterCandidate(nextManga.id);
      return buildQueueDraft(nextManga.contentId || nextManga.id, nextUnreadChapter?.contentId || nextUnreadChapter?.id || null, source);
    }
    return null;
  }, [buildQueueDraft, entityLibrary, findNextChapterCandidate, selectableMangas]);

  function openMangaInCurrentTab(mangaId) {
    replaceActiveView({ screen: 'manga', mangaId, chapterId: null, pageIndex: 0 });
  }

  function openMangaInNewTab(mangaId, options = {}) {
    openNewTab({ screen: 'manga', mangaId, chapterId: null, pageIndex: 0 }, [normalizeView()], options);
  }

  function openChapterInCurrentTab(mangaId, chapterId, pageIndex = 0) {
    const nextView = ui.showPagePreviewBeforeReading
      ? { screen: 'preview', mangaId, chapterId, pageIndex: 0 }
      : buildReaderViewForChapter(mangaId, chapterId, pageIndex, pageIndex > 0 ? 'exact-page' : 'normal');
    pushViewToActive(nextView);
  }

  function openChapterInNewTab(mangaId, chapterId, pageIndex = 0, options = {}) {
    const nextView = ui.showPagePreviewBeforeReading
      ? { screen: 'preview', mangaId, chapterId, pageIndex: 0 }
      : buildReaderViewForChapter(mangaId, chapterId, pageIndex, pageIndex > 0 ? 'exact-page' : 'normal');
    openNewTab(nextView, [normalizeView(), { screen: 'manga', mangaId }], options);
  }

  function resumeMangaInCurrentTab(mangaId) {
    pushViewToActive(buildResumeViewForManga(mangaId));
  }

  function resumeMangaInNewTab(mangaId, options = {}) {
    const nextView = buildResumeViewForManga(mangaId);
    openNewTab(nextView, [normalizeView(), { screen: 'manga', mangaId }], options);
  }

  function resumeChapterInCurrentTab(mangaId, chapterId, fallbackPageIndex = 0) {
    pushViewToActive(buildReaderViewForChapter(mangaId, chapterId, fallbackPageIndex, 'normal'));
  }

  async function toggleSidebarCollapsed() {
    await handleUpdateSettings({ sidebarCollapsed: !ui.sidebarCollapsed });
  }

  async function handleSelectCategory(categoryId) {
    await handleUpdateSettings({ selectedCategoryId: categoryId });
  }

  async function handleOpenAddCategoriesDirect() {
    await refreshWith(window.mangaAPI.addCategories());
  }

  function closeAddEntryMenu() {
    setAddEntryMenuAnchor(null);
  }

  async function handleOpenAddCategories() {
    closeAddEntryMenu();
    await handleOpenAddCategoriesDirect();
  }

  function handleAddEntry(event) {
    if (!webSourcesEnabled) {
      void handleOpenAddCategoriesDirect();
      return;
    }

    const rect = event?.currentTarget?.getBoundingClientRect?.();
    setAddEntryMenuAnchor(rect ? { left: rect.left, bottom: rect.bottom } : { left: 24, bottom: 92 });
  }

  function handleOpenWebSources() {
    closeAddEntryMenu();
    setSourcesSection('explorer');
    setSourceExplorerContext(null);
    handleScreenChange('sources');
  }

  function handleOpenSourceSeriesForManga(manga) {
    if (!manga?.sourceWeb?.linked) return;
    if (!webSourcesEnabled) {
      setPluginFeedback('Active l addon Sources web pour reprendre cette serie.');
      setSettingsOpen(true);
      return;
    }
    closeAddEntryMenu();
    setSettingsOpen(false);
    setSourcesSection('explorer');
    setSourceExplorerContext({
      manga: {
        id: manga.id || '',
        contentId: manga.contentId || '',
        path: manga.path || '',
        displayTitle: manga.displayTitle || '',
        sourceWeb: manga.sourceWeb || null
      },
      requestedAt: Date.now()
    });
    navigateToScreen('sources');
    if (activeView.screen !== 'library') {
      replaceActiveView(normalizeView());
    }
  }

  async function handleToggleCategoryHidden(categoryId) {
    await refreshWith(window.mangaAPI.toggleCategoryHidden(categoryId));
  }

  async function handleRemoveCategory(categoryId) {
    await refreshWith(window.mangaAPI.removeCategory(categoryId));
  }

  async function handleRelinkCategory(categoryId) {
    setRelocationNotice({ kind: 'working', title: 'Recherche du nouvel emplacement…', message: 'Choisissez le dossier qui contient maintenant cette categorie.' });
    const picked = await window.mangaAPI.pickRelocationTarget(categoryId);
    if (!picked?.ok || picked?.canceled) {
      setRelocationNotice(picked?.error ? { kind: 'error', title: 'Rattachement impossible', message: picked.error } : null);
      return;
    }
    setRelocationNotice({ kind: 'working', title: 'Comparaison en cours…', message: 'Les empreintes des oeuvres et chapitres sont verifiees en arriere-plan.' });
    const inspected = await window.mangaAPI.inspectRelocation({ categoryId, targetPath: picked.path });
    if (!inspected?.ok) {
      setRelocationNotice({ kind: 'error', title: 'Nouvel emplacement non reconnu', message: inspected?.error || 'La comparaison a echoue.' });
      return;
    }
    if (!inspected.plan?.autoApplicable) {
      const matched = inspected.plan?.mangaMatches?.length || 0;
      const total = matched + (inspected.plan?.unmatched?.length || 0);
      setRelocationNotice({
        kind: 'warning',
        title: 'Verification manuelle requise',
        message: `${matched}/${total || 0} oeuvre(s) reconnue(s). Le cas a ete conserve sans modifier vos donnees.`
      });
      return;
    }
    const applied = await window.mangaAPI.applyRelocation(inspected.plan.id);
    if (!applied?.ok) {
      setRelocationNotice({ kind: 'error', title: 'Rattachement non applique', message: applied?.error || 'Aucune donnee n a ete modifiee.' });
      return;
    }
    startTransition(() => setPayload((previous) => mergePayloadForStability(previous, applied.payload)));
    const missingChapterCount = inspected.plan?.unmatchedChapters?.length || 0;
    setRelocationNotice({
      kind: 'success',
      title: 'Categorie retrouvee',
      message: missingChapterCount > 0
        ? `Les donnees ont ete rattachees a ${picked.path}. ${missingChapterCount} ancien(s) chapitre(s) absent(s) du dossier restent conserves.`
        : `Les donnees ont ete rattachees a ${picked.path}.`,
      relocationId: applied.relocation?.id || null
    });
  }

  async function handleUndoRelocation(relocationId) {
    if (!relocationId) return;
    const result = await window.mangaAPI.undoRelocation(relocationId);
    if (!result?.ok) {
      setRelocationNotice({ kind: 'error', title: 'Annulation impossible', message: result?.error || 'Le rattachement a change depuis son application.' });
      return;
    }
    startTransition(() => setPayload((previous) => mergePayloadForStability(previous, result.payload)));
    setRelocationNotice({ kind: 'success', title: 'Rattachement annule', message: 'Le dernier emplacement connu a ete restaure.' });
  }

  async function handleToggleFavorite(mangaId) {
    const manga = findMangaInPayload(payloadRef.current, mangaId)
      || findManga(library, mangaId)
      || findManga(vaultLibrary, mangaId);
    const isFavorite = !manga?.isFavorite;
    const captureFavorite = (current) => ({
      isFavorite: Boolean(findMangaInPayload(current, mangaId)?.isFavorite)
    });
    await applyOptimisticMutation({
      key: `favorite:${mangaId}`,
      label: `Favori non enregistre - ${manga?.displayTitle || 'manga'}`,
      updatePayload: (previous) => applyFavoriteMutation(previous, mangaId, isFavorite),
      captureInverse: captureFavorite,
      captureApplied: captureFavorite,
      rollback: (current, inverse) => applyFavoriteMutation(current, mangaId, inverse.isFavorite),
      persist: window.mangaAPI.toggleFavoriteLight ? () => window.mangaAPI.toggleFavoriteLight(mangaId) : null,
      fallback: () => window.mangaAPI.toggleFavorite(mangaId)
    });
  }

  async function handleTrashManga(mangaId) {
    captureCurrentViewScroll();
    const result = await window.mangaAPI.trashManga(mangaId);
    await refreshWith(Promise.resolve(result));
    const deletion = result?.bulkTrash?.results?.find((entry) => entry.mangaId === mangaId);
    if (deletion?.ok && activeView.mangaId === mangaId) {
      replaceActiveView(normalizeView());
    }
    if (deletion && !deletion.ok) {
      setReliabilityIssues((current) => [
        ...current.filter((issue) => issue.id !== `trash-${mangaId}`),
        {
          id: `trash-${mangaId}`,
          kind: 'filesystem',
          title: 'Suppression non terminee',
          message: 'La carte et les donnees sont conservees.',
          details: `${deletion.path || mangaId}: ${deletion.error}`,
          retry: () => handleTrashManga(mangaId)
        }
      ]);
    }
  }

  async function handleSetReadStatus(mangaId, isRead, chapterIds = []) {
    const captureReading = (current) => captureReadMutationSnapshot(current, mangaId, chapterIds);
    await applyOptimisticMutation({
      key: `reading-series:${mangaId}`,
      label: 'Etat de lecture non enregistre',
      updatePayload: (previous) => applyMangaReadMutation(previous, mangaId, isRead, chapterIds),
      captureInverse: captureReading,
      captureApplied: captureReading,
      rollback: (current, inverse) => restoreReadMutationSnapshot(current, inverse),
      persist: window.mangaAPI.setReadStatusLight ? () => window.mangaAPI.setReadStatusLight(mangaId, isRead, chapterIds) : null,
      fallback: () => window.mangaAPI.setReadStatus(mangaId, isRead, chapterIds)
    });
  }

  async function handleSetChapterReadStatus(mangaId, chapterId, isRead, pageCount = 0) {
    const captureReading = (current) => captureReadMutationSnapshot(current, mangaId, [chapterId]);
    await applyOptimisticMutation({
      key: `reading:${mangaId}:${chapterId}`,
      label: 'Etat du chapitre non enregistre',
      updatePayload: (previous) => applyChapterReadMutation(previous, mangaId, chapterId, isRead, pageCount),
      captureInverse: captureReading,
      captureApplied: captureReading,
      rollback: (current, inverse) => restoreReadMutationSnapshot(current, inverse),
      persist: window.mangaAPI.setChapterReadStatusLight
        ? () => window.mangaAPI.setChapterReadStatusLight(mangaId, chapterId, isRead, pageCount)
        : null,
      fallback: () => window.mangaAPI.setChapterReadStatus(mangaId, chapterId, isRead, pageCount)
    });
  }

  async function handleResetProgress(mangaId, chapterIds = []) {
    await refreshWith(window.mangaAPI.resetProgress(mangaId, chapterIds));
  }

  async function handleResetChapterProgress(chapterId) {
    await refreshWith(window.mangaAPI.resetChapterProgress(chapterId));
  }

  async function handleSaveMetadata(mangaId, patch) {
    await refreshWith(window.mangaAPI.updateMetadata(mangaId, patch));
    setEditingMetadata(null);
  }

  async function handlePickCover(mangaId) {
    const manga = findManga(entityLibrary, mangaId)
      || findManga(library, mangaId)
      || findManga(vaultLibrary, mangaId);
    if (manga) setCoverManagerManga(manga);
  }

  async function handleCreateTag(name, color) {
    await refreshWith(window.mangaAPI.createTag(name, color));
  }

  async function handleDeleteTag(tagId) {
    await refreshWith(window.mangaAPI.deleteTag(tagId));
  }

  async function handleImportOnlineMetadata(mangaId, onlineData) {
    await refreshWith(window.mangaAPI.importOnlineMetadata(mangaId, onlineData));
  }

  async function handleToggleTag(mangaId, tagId) {
    const manga = findMangaInPayload(payloadRef.current, mangaId)
      || findManga(library, mangaId)
      || findManga(vaultLibrary, mangaId);
    const isAssigned = !(manga?.tags || []).some((tag) => tag.id === tagId);
    const captureTag = (current) => ({
      isAssigned: Boolean((findMangaInPayload(current, mangaId)?.tags || []).some((tag) => tag.id === tagId))
    });
    await applyOptimisticMutation({
      key: `tag:${mangaId}:${tagId}`,
      label: 'Tag non enregistre',
      updatePayload: (previous) => applyTagMutation(previous, mangaId, tagId, isAssigned),
      captureInverse: captureTag,
      captureApplied: captureTag,
      rollback: (current, inverse) => applyTagMutation(current, mangaId, tagId, inverse.isAssigned),
      persist: window.mangaAPI.toggleMangaTagLight ? () => window.mangaAPI.toggleMangaTagLight(mangaId, tagId) : null,
      fallback: () => window.mangaAPI.toggleMangaTag(mangaId, tagId)
    });
  }

  async function handleAddToCollection(mangaId, collectionId) {
    const captureCollection = (current) => ({
      isAssigned: Boolean((findMangaInPayload(current, mangaId)?.collectionIds || []).includes(collectionId))
    });
    await applyOptimisticMutation({
      key: `collection:${mangaId}:${collectionId}`,
      label: 'Rattachement a la collection non enregistre',
      updatePayload: (previous) => applyCollectionMutation(previous, mangaId, collectionId, true),
      captureInverse: captureCollection,
      captureApplied: captureCollection,
      rollback: (current, inverse) => applyCollectionMutation(current, mangaId, collectionId, inverse.isAssigned),
      persist: window.mangaAPI.addMangaToCollectionLight
        ? () => window.mangaAPI.addMangaToCollectionLight(collectionId, mangaId)
        : null,
      fallback: () => window.mangaAPI.addMangaToCollection(collectionId, mangaId)
    });
  }

  async function handleCreateCollection(name, description, appearance = null) {
    await refreshWith(window.mangaAPI.createCollection(name, description, '#8b5cf6', appearance));
  }

  async function handleDeleteCollection(collectionId) {
    await refreshWith(window.mangaAPI.deleteCollection(collectionId));
  }

  async function handleUpdateCollection(collectionId, patch) {
    await refreshWith(window.mangaAPI.updateCollection(collectionId, patch));
  }

  async function handleRemoveMangaFromCollection(collectionId, mangaId) {
    const captureCollection = (current) => ({
      isAssigned: Boolean((findMangaInPayload(current, mangaId)?.collectionIds || []).includes(collectionId))
    });
    await applyOptimisticMutation({
      key: `collection:${mangaId}:${collectionId}`,
      label: 'Rattachement a la collection non enregistre',
      updatePayload: (previous) => applyCollectionMutation(previous, mangaId, collectionId, false),
      captureInverse: captureCollection,
      captureApplied: captureCollection,
      rollback: (current, inverse) => applyCollectionMutation(current, mangaId, collectionId, inverse.isAssigned),
      persist: window.mangaAPI.removeMangaFromCollectionLight
        ? () => window.mangaAPI.removeMangaFromCollectionLight(collectionId, mangaId)
        : null,
      fallback: () => window.mangaAPI.removeMangaFromCollection(collectionId, mangaId)
    });
  }

  async function handleUpdateSettings(patch) {
    let normalizedPatch = patch && typeof patch === 'object' ? patch : {};
    if (!Object.keys(normalizedPatch).length) return;
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'interfaceMode')) {
      const { interfaceMode: requestedMode, ...remainingPatch } = normalizedPatch;
      const switched = await handleRequestInterfaceMode(requestedMode);
      if (!switched) return;
      normalizedPatch = remainingPatch;
      if (!Object.keys(normalizedPatch).length) return;
    }

    await settingsPersistenceRef.current.update(normalizedPatch);
  }

  async function handleRequestInterfaceMode(requestedMode) {
    if (interfaceTransitionLockRef.current) return false;
    const nextMode = requestedMode === 'kavita' ? 'kavita' : 'sawa';
    const currentMode = interfaceMode;
    const coordinator = createInterfaceTransitionCoordinator({
      flushReaderSession,
      closeTransientUi: () => {
        setContextMenu(null);
        setAddEntryMenuAnchor(null);
        setCommandPaletteOpen(false);
        setReadingQueueOpen(false);
        setSettingsOpen(false);
      },
      preloadKavita: preloadKavitaShell,
      persistMode: async (mode) => {
        if (!window.mangaAPI.updateSettingsLight) {
          throw new Error('La persistence legere de l interface est indisponible.');
        }
        await window.mangaAPI.updateSettingsLight({ interfaceMode: mode });
      },
      applyMode: (mode) => {
        previousInterfaceModeRef.current = currentMode;
        setRenderedInterfaceMode(mode);
        startTransition(() => {
          setPayload((previous) => mergeUiSettingsIntoPayload(previous, { interfaceMode: mode }));
        });
      },
      setTransition: setInterfaceTransitioning,
      reportError: setInterfaceTransitionError
    });
    setInterfaceTransitionError('');
    interfaceTransitionLockRef.current = true;
    try {
      return await coordinator.request(nextMode, currentMode);
    } finally {
      interfaceTransitionLockRef.current = false;
    }
  }

  function handleShellMountError(error) {
    const failedMode = interfaceMode;
    const fallbackMode = previousInterfaceModeRef.current === failedMode
      ? (failedMode === 'kavita' ? 'sawa' : 'kavita')
      : previousInterfaceModeRef.current;
    setInterfaceTransitionError(error?.message || 'Impossible de monter cette interface.');
    setRenderedInterfaceMode(fallbackMode);
    startTransition(() => {
      setPayload((previous) => mergeUiSettingsIntoPayload(previous, { interfaceMode: fallbackMode }));
    });
    void window.mangaAPI.updateSettingsLight?.({ interfaceMode: fallbackMode })?.catch(() => {});
  }

  async function handleActivateKavitaClean() {
    await handleUpdateSettings({
      interfaceMode: 'kavita',
      cardSize: 'compact',
      kavitaUpgradePromptSeen: true
    });
  }

  async function handleDismissKavitaCleanUpgrade() {
    await handleUpdateSettings({
      kavitaUpgradePromptSeen: true
    });
  }

  async function handleUpdateVaultPrefs(patch) {
    const normalizedPatch = patch && typeof patch === 'object' ? patch : {};
    if (!Object.keys(normalizedPatch).length) return;

    startTransition(() => {
      setPayload((previous) => mergeVaultPrefsIntoPayload(previous, normalizedPatch));
    });

    try {
      if (window.mangaAPI.updateVaultPrefsLight) {
        await window.mangaAPI.updateVaultPrefsLight(normalizedPatch);
      } else {
        const nextPayload = await window.mangaAPI.updateVaultPrefs(normalizedPatch);
        if (nextPayload?.persisted) {
          startTransition(() => {
            setPayload(nextPayload);
          });
        }
      }
    } catch (_error) {
      try {
        const restored = await window.mangaAPI.bootstrap();
        if (restored?.persisted) {
          startTransition(() => {
            setPayload(restored);
          });
        }
      } catch (_) {
        // Garder l'UI locale si la persistence est momentanement indisponible.
      }
    }
  }

  async function handleSetSidebarSectionVisible(sectionId, visible) {
    const normalizedId = String(sectionId || '').trim();
    if (!normalizedId || normalizedId === 'library') return;
    const nextHidden = { ...sidebarHiddenSections };
    if (visible) {
      delete nextHidden[normalizedId];
    } else {
      nextHidden[normalizedId] = true;
    }
    const nextSections = sidebarSections.includes(normalizedId)
      ? sidebarSections
      : [...sidebarSections, normalizedId];
    await handleUpdateSettings({
      sidebarSections: nextSections,
      sidebarHiddenSections: nextHidden
    });
  }

  async function handleReorderSidebarSections(nextVisibleOrder) {
    const safeVisibleOrder = Array.isArray(nextVisibleOrder)
      ? [...new Set(nextVisibleOrder.map((entry) => String(entry || '').trim()).filter(Boolean))]
      : [];
    if (!safeVisibleOrder.includes('library')) {
      safeVisibleOrder.unshift('library');
    }
    const remainder = sidebarSections.filter((sectionId) => !safeVisibleOrder.includes(sectionId));
    await handleUpdateSettings({
      sidebarSections: [...safeVisibleOrder, ...remainder]
    });
  }

  async function handleSaveQueryAsSmartCollection() {
    const trimmed = search.trim();
    if (!trimmed && searchState.filters.length === 0) return;
    requestTextPrompt({
      title: 'Sauver cette requete',
      description: 'Cette recherche sera convertie en smart collection locale avec tes filtres actuels.',
      label: 'Nom de la smart collection',
      defaultValue: 'Recherche sauvegardee',
      placeholder: 'Serie a suivre',
      confirmLabel: 'Sauver',
      onConfirm: async (value) => {
        const smartCollection = buildSmartCollectionFromSearch(combinedParsedSearch, {
          name: String(value || '').trim() || 'Recherche sauvegardee',
          sort: ui.sort,
          collectionsById: payload?.persisted?.collections || {},
          tagsById: payload?.persisted?.tags || {}
        });
        await handleSaveSmartCollection(smartCollection);
        navigateToScreen('collections');
        setRequestedCollectionsTab('smart');
        setRequestedCollectionId(smartCollection.id);
      }
    });
  }

  async function handlePickBackgroundImage() {
    await refreshWith(window.mangaAPI.pickBackgroundImage());
  }

  async function handleRemoveBackgroundImage() {
    await refreshWith(window.mangaAPI.removeBackgroundImage());
  }

  async function handleClearCache() {
    await window.mangaAPI.clearCache();
    const status = await window.mangaAPI.getSyncStatus().catch(() => null);
    setSyncStatus(status);
  }

  async function handleForceRescan() {
    setMaintenanceStats(null);
    const result = await window.mangaAPI.forceRescan();
    const nextPayload = result?.payload || (result?.library ? result : null);
    if (nextPayload) {
      startTransition(() => {
        setPayload((previous) => mergePayloadForStability(previous, nextPayload));
      });
    }
    const status = result?.syncStatus || await window.mangaAPI.getSyncStatus().catch(() => null);
    setSyncStatus(status);
  }

  async function handleRunDeepScan() {
    setMaintenanceStats(null);
    const result = await window.mangaAPI.runDeepScan();
    if (result?.payload) setPayload(result.payload);
    if (result?.syncStatus) setSyncStatus(result.syncStatus);
  }

  async function handleRebuildDerivedData() {
    setMaintenanceStats(null);
    const result = await window.mangaAPI.rebuildDerivedData();
    if (result?.payload) setPayload(result.payload);
    if (result?.syncStatus) setSyncStatus(result.syncStatus);
  }

  async function handleAnalyzeIdentities() {
    setIdentityBusy(true);
    try {
      const result = await window.mangaAPI.analyzeIdentities();
      if (!applyIdentityPatch(result)) throw new Error(result?.error || 'Analyse d’identité impossible.');
    } catch (error) {
      setReliabilityIssues((current) => [
        ...current.filter((entry) => entry.id !== 'identity-analysis'),
        {
          id: 'identity-analysis',
          kind: 'identity',
          title: 'Analyse des déplacements interrompue',
          message: 'Les données visibles restent intactes.',
          details: String(error?.message || error),
          retry: handleAnalyzeIdentities
        }
      ]);
    } finally {
      setIdentityBusy(false);
    }
  }

  async function handleDecideIdentitySuggestion(suggestionId, decision) {
    const result = await window.mangaAPI.decideIdentitySuggestion(suggestionId, decision);
    if (!applyIdentityPatch(result)) {
      throw new Error(result?.error || 'La décision n’a pas été enregistrée.');
    }
  }

  async function handleSetPreferredEdition(groupId, mangaId) {
    const result = await window.mangaAPI.setPreferredEdition(groupId, mangaId);
    if (!applyIdentityPatch(result)) throw new Error(result?.error || 'Édition invalide.');
  }

  async function handleUngroupEditions(groupId) {
    const result = await window.mangaAPI.ungroupEditions(groupId);
    if (!applyIdentityPatch(result)) throw new Error(result?.error || 'Dégroupement impossible.');
  }

  async function handleAnalyzeMigration() {
    setMigrationBusy(true);
    setMigrationFeedback('');
    try {
      const result = await window.mangaAPI.analyzeMigration?.();
      if (result?.report) {
        setMigrationStatus((prev) => ({ ...(prev || {}), pendingReport: result.report }));
        setMigrationFeedback('Analyse terminee: aucune ecriture effectuee.');
      }
    } catch (error) {
      setMigrationFeedback(error?.message || 'Analyse migration impossible.');
    } finally {
      setMigrationBusy(false);
    }
  }

  async function handleRunMigration() {
    setMigrationBusy(true);
    setMigrationFeedback('');
    try {
      const result = await window.mangaAPI.runMigration?.({ createBackup: true });
      if (result?.status) setMigrationStatus(result.status);
      setMigrationFeedback(result?.ok ? 'Migration Core v2 terminee avec backup prealable.' : (result?.error || 'Migration non terminee.'));
    } catch (error) {
      setMigrationFeedback(error?.message || 'Migration Core v2 impossible.');
    } finally {
      setMigrationBusy(false);
    }
  }

  async function handleCleanupLegacyStorage() {
    setMigrationBusy(true);
    setMigrationFeedback('');
    try {
      const result = await window.mangaAPI.cleanupLegacyStorage?.({ confirm: 'cleanup-legacy-json' });
      setMigrationFeedback(result?.message || (result?.ok ? 'Demande de nettoyage enregistree.' : 'Nettoyage refuse.'));
    } catch (error) {
      setMigrationFeedback(error?.message || 'Nettoyage legacy impossible.');
    } finally {
      setMigrationBusy(false);
    }
  }

  function clearSelection() {
    dispatchSelection({ type: 'clear', key: activeSelectionKey });
  }

  function toggleSelectionMode() {
    dispatchSelection({
      type: selectionMode ? 'exit' : 'enter',
      key: activeSelectionKey
    });
  }

  function handleCommitSearch(query) {
    const next = recentSearchStoreRef.current.add(query, {
      incognito: Boolean(activeTab?.incognito),
      privateContext: activeScreen === 'vault' || Boolean(activeTab?.searchPrivate),
      vaultLocked: activeScreen === 'vault' && Boolean(vaultState.locked)
    });
    setRecentSearches(next);
  }

  function handleClearSearchRecents() {
    setRecentSearches(recentSearchStoreRef.current.clear());
  }

  function handleRemoveAdvancedSearchToken(rawToken) {
    setSearch((current) => removeAdvancedQueryToken(current, rawToken));
  }

  function toggleSelectedManga(mangaId, meta = {}) {
    if (!mangaId) return;
    const event = meta?.event || meta;
    dispatchSelection({
      type: 'toggle',
      key: activeSelectionKey,
      id: mangaId,
      orderedIds: meta?.orderedIds?.length ? meta.orderedIds : visibleSelectionIds,
      ctrlKey: Boolean(event?.ctrlKey || event?.metaKey),
      shiftKey: Boolean(event?.shiftKey)
    });
  }

  function selectAllVisibleMangas() {
    dispatchSelection({ type: 'select-all', key: activeSelectionKey, orderedIds: visibleSelectionIds });
  }

  function invertVisibleMangaSelection() {
    dispatchSelection({ type: 'invert', key: activeSelectionKey, orderedIds: visibleSelectionIds });
  }

  function exitSelection() {
    dispatchSelection({ type: 'exit', key: activeSelectionKey });
  }

  async function handleBulkFavorite(nextValue) {
    if (!selectedMangaIds.length) return;
    await refreshWith(window.mangaAPI.bulkFavorite(selectedMangaIds, nextValue));
    const inverseTrue = selectedMangas.filter((manga) => manga.isFavorite).map((manga) => manga.id);
    const inverseFalse = selectedMangas.filter((manga) => !manga.isFavorite).map((manga) => manga.id);
    setBulkUndoAction({
      label: 'Annuler favoris',
      run: async () => {
        if (inverseTrue.length) await refreshWith(window.mangaAPI.bulkFavorite(inverseTrue, true));
        if (inverseFalse.length) await refreshWith(window.mangaAPI.bulkFavorite(inverseFalse, false));
      }
    });
  }

  async function handleBulkRead(isRead) {
    if (!selectedMangaIds.length) return;
    const entries = selectedMangas.map((manga) => ({
      mangaId: manga.id,
      chapterIds: (manga.chapters ?? []).map((chapter) => chapter.id)
    }));
    await refreshWith(window.mangaAPI.bulkSetReadStatus(entries, isRead));
    const readIds = new Set(selectedMangas.filter((manga) => manga.isRead).map((manga) => manga.id));
    setBulkUndoAction({
      label: 'Annuler lecture',
      run: async () => {
        const readEntries = entries.filter((entry) => readIds.has(entry.mangaId));
        const unreadEntries = entries.filter((entry) => !readIds.has(entry.mangaId));
        if (readEntries.length) await refreshWith(window.mangaAPI.bulkSetReadStatus(readEntries, true));
        if (unreadEntries.length) await refreshWith(window.mangaAPI.bulkSetReadStatus(unreadEntries, false));
      }
    });
  }

  async function handleBulkAddCollection(collectionId) {
    if (!collectionId || !selectedMangaIds.length) return;
    const collection = allCollections.find((entry) => entry.id === collectionId);
    const newlyAddedIds = selectedMangaIds.filter((id) => !(collection?.mangaIds || []).includes(id));
    await refreshWith(window.mangaAPI.addManyToCollection(collectionId, selectedMangaIds));
    if (newlyAddedIds.length) {
      setBulkUndoAction({
        label: 'Annuler collection',
        run: () => refreshWith(window.mangaAPI.removeManyFromCollection(collectionId, newlyAddedIds))
      });
    }
    setBatchCollectionOpen(false);
  }

  async function handleBulkAddTag(tagId) {
    if (!tagId || !selectedMangaIds.length) return;
    const newlyAddedIds = selectedMangaIds.filter((mangaId) => !(payload?.persisted?.mangaTags?.[mangaId] || []).includes(tagId));
    await refreshWith(window.mangaAPI.addTagToMany(tagId, selectedMangaIds));
    if (newlyAddedIds.length) {
      setBulkUndoAction({
        label: 'Annuler tag',
        run: () => refreshWith(window.mangaAPI.removeTagFromMany(tagId, newlyAddedIds))
      });
    }
    setBatchTagOpen(false);
  }

  async function handleSetPrivateFlag(mangaId, isPrivate) {
    await refreshWith(window.mangaAPI.setPrivateFlag(mangaId, isPrivate));
  }

  async function handleSetPrivateCategoryFlag(categoryId, isPrivate) {
    await refreshWith(window.mangaAPI.setPrivateCategoryFlag(categoryId, isPrivate));
    if (isPrivate) {
      navigateToScreen('vault');
      setVaultCategoryFilterId(categoryId);
    } else if (vaultCategoryFilterId === categoryId) {
      setVaultCategoryFilterId(null);
    }
  }

  async function handleBulkVaultToggle() {
    if (!selectedMangaIds.length) return;
    const shouldArchive = !selectedMangas.every((manga) => manga.isPrivate);
    await refreshWith(window.mangaAPI.setPrivateFlagMany(selectedMangaIds, shouldArchive));
    const privateIds = selectedMangas.filter((manga) => manga.isPrivate).map((manga) => manga.id);
    const publicIds = selectedMangas.filter((manga) => !manga.isPrivate).map((manga) => manga.id);
    setBulkUndoAction({
      label: 'Annuler coffre',
      run: async () => {
        if (privateIds.length) await refreshWith(window.mangaAPI.setPrivateFlagMany(privateIds, true));
        if (publicIds.length) await refreshWith(window.mangaAPI.setPrivateFlagMany(publicIds, false));
      }
    });
  }

  async function handleBulkUndo() {
    const action = bulkUndoAction;
    if (!action?.run) return;
    setBulkUndoAction(null);
    await action.run();
  }

  async function handleQueueWorkbench(mangaIds, mode = 'append') {
    if (!Array.isArray(mangaIds) || mangaIds.length === 0) return;
    const result = await window.mangaAPI.queueMetadataWorkbench(mangaIds, mode);
    if (result?.ok) {
      setPayload((previous) => previous ? {
        ...previous,
        persisted: {
          ...previous.persisted,
          metadataWorkbenchQueue: result.metadataWorkbenchQueue || result.patch?.metadataWorkbenchQueue || [],
          metadataWorkbenchItems: result.metadataWorkbenchItems || result.patch?.metadataWorkbenchItems || []
        }
      } : previous);
    }
    navigateToScreen('workbench');
  }

  async function handleReplaceWorkbenchQueue(mangaIds) {
    const result = await window.mangaAPI.setMetadataWorkbenchQueue(mangaIds);
    if (result?.ok) {
      setPayload((previous) => previous ? {
        ...previous,
        persisted: {
          ...previous.persisted,
          metadataWorkbenchQueue: result.metadataWorkbenchQueue || result.patch?.metadataWorkbenchQueue || [],
          metadataWorkbenchItems: result.metadataWorkbenchItems || result.patch?.metadataWorkbenchItems || []
        }
      } : previous);
    }
  }

  async function handleImportWorkbenchMatch(mangaId, result) {
    await refreshWith(window.mangaAPI.importOnlineMetadata(mangaId, result));
  }

  async function handleSaveSmartCollection(collection) {
    await refreshWith(window.mangaAPI.saveSmartCollection(collection));
  }

  async function handleDeleteSmartCollection(collectionId) {
    await refreshWith(window.mangaAPI.deleteSmartCollection(collectionId));
  }

  async function applyVaultResult(result) {
    if (!result?.ok) {
      throw new Error(result?.error || 'Operation impossible.');
    }
    if (result.payload) {
      setPayload(result.payload);
    }
  }

  async function handleSetVaultPin(pin) {
    const result = await window.mangaAPI.setVaultPin(pin);
    await applyVaultResult(result);
  }

  async function handleUnlockVault(pin) {
    const result = await window.mangaAPI.unlockVault(pin);
    await applyVaultResult(result);
    setPanicSession((prev) => (prev === 'panic' ? 'recovered' : prev));
  }

  async function handleLockVault() {
    const result = await window.mangaAPI.lockVault();
    await applyVaultResult(result);
    clearSelection();
    setVaultCategoryFilterId(null);
  }

  async function handleToggleVaultBlur() {
    await handleUpdateVaultPrefs({ blurCovers: !vaultState.blurCovers });
  }

  async function handleToggleVaultStealth() {
    await handleUpdateVaultPrefs({ stealthMode: !vaultState.stealthMode });
  }

  async function handleUpdateMetadataLocks(mangaId, patch) {
    const nextPayload = await window.mangaAPI.updateMetadataFieldLocks(mangaId, patch);
    setPayload(nextPayload);
    setEditingMetadata(findManga(nextPayload?.library ?? library, mangaId) || findManga(nextPayload?.vaultLibrary ?? vaultLibrary, mangaId));
  }

  async function handleImportComicInfoForManga(mangaId, options = {}) {
    const result = await window.mangaAPI.importComicInfo(mangaId, options);
    if (result?.payload) {
      setPayload(result.payload);
      setEditingMetadata(findManga(result.payload?.library ?? library, mangaId) || findManga(result.payload?.vaultLibrary ?? vaultLibrary, mangaId));
    }
    return result;
  }

  async function handleExportComicInfoForManga(mangaId, options = {}) {
    return window.mangaAPI.exportComicInfo({ mangaId, mode: 'sidecar', ...options });
  }

  async function handleBulkGroupEditions() {
    if (selectedMangaIds.length < 2) return;
    const result = await window.mangaAPI.groupEditions(selectedMangaIds);
    if (!applyIdentityPatch(result)) {
      throw new Error(result?.error || 'Regroupement des editions impossible.');
    }
    const groupId = result?.workGroup?.id;
    if (groupId) {
      setBulkUndoAction({
        label: 'Annuler regroupement',
        run: async () => {
          const undoResult = await window.mangaAPI.ungroupEditions(groupId);
          if (!applyIdentityPatch(undoResult)) {
            throw new Error(undoResult?.error || 'Annulation du regroupement impossible.');
          }
        }
      });
    }
  }

  function getCurrentSelectableMangas() {
    const current = payloadRef.current;
    return [
      ...(current?.library?.allMangas || []),
      ...(current?.vaultLibrary?.allMangas || [])
    ];
  }

  async function startBulkTrashJob(mangaIds, {
    confirmPaths = true,
    selectionKey = activeSelectionKey
  } = {}) {
    const targets = resolveCurrentTrashTargets(mangaIds, getCurrentSelectableMangas());
    if (!targets.length) return { ok: false, error: 'Aucun manga courant a supprimer.' };
    if (confirmPaths && !window.confirm(formatTrashConfirmation(targets))) {
      return { ok: false, cancelled: true };
    }
    captureCurrentViewScroll();
    const requestedIds = targets.map((manga) => manga.id);
    const result = await window.mangaAPI.bulkTrashMangas(requestedIds);
    if (!result?.ok || !result?.jobId) {
      throw new Error(result?.error || 'La tache de suppression n a pas demarre.');
    }
    bulkTrashJobContextsRef.current.set(result.jobId, {
      selectionKey,
      requestedIds
    });
    setBulkTrashJobStatus({
      jobId: result.jobId,
      status: result.job?.status || 'queued',
      completed: 0,
      total: requestedIds.length
    });
    window.mangaAPI.listJobs?.().then((snapshot) => {
      latestHandlersRef.current.handleJobsProgress?.(snapshot);
    }).catch(() => {});
    return result;
  }

  async function handleBulkTrashMangas() {
    if (!selectedMangaIds.length) return;
    await startBulkTrashJob(selectedMangaIds);
  }

  function handleBulkTrashJobProgress(incoming) {
    for (const [jobId, context] of bulkTrashJobContextsRef.current.entries()) {
      const update = readBulkTrashJobUpdate(incoming, jobId);
      if (!update) continue;
      setBulkTrashJobStatus(update);
      if (!update.terminal) continue;
      if (update.patch?.removedMangaIds?.length) {
        latestStateRevisionRef.current = Math.max(
          latestStateRevisionRef.current,
          Number(update.patch.revision || 0)
        );
        updatePayloadTracked((previous) => applyBulkTrashPatch(previous, update.patch));
      }
      if (update.succeededIds.length) {
        dispatchSelection({
          type: 'remove',
          key: context.selectionKey,
          ids: update.succeededIds
        });
      }
      const failedIds = update.status === 'failed' && !update.failedIds.length
        ? context.requestedIds.filter((id) => !update.succeededIds.includes(id))
        : update.failedIds;
      if (failedIds.length) {
        const failures = update.results.filter((entry) => failedIds.includes(entry.mangaId));
        const retry = createFailedTrashRetry({
          failedIds,
          getCurrentMangas: getCurrentSelectableMangas,
          confirm: (message) => window.confirm(message),
          start: (ids) => startBulkTrashJob(ids, {
            confirmPaths: false,
            selectionKey: context.selectionKey
          })
        });
        setReliabilityIssues((current) => [
          ...current.filter((issue) => issue.id !== `bulk-trash:${jobId}`),
          {
            id: `bulk-trash:${jobId}`,
            kind: 'filesystem',
            title: `${failedIds.length} suppression${failedIds.length > 1 ? 's' : ''} a relancer`,
            message: 'Les mangas en echec restent selectionnes.',
            details: failures.length
              ? failures.map((entry) => `${entry.path || entry.mangaId}: ${entry.error}`).join('\n')
              : update.error || 'La tache a echoue avant le traitement.',
            retry
          }
        ]);
      }
      bulkTrashJobContextsRef.current.delete(jobId);
    }
  }

  async function handleCancelBulkTrashJob() {
    if (!bulkTrashJobStatus?.jobId || bulkTrashJobStatus.terminal) return;
    await window.mangaAPI.cancelJob(bulkTrashJobStatus.jobId);
  }

  async function handleRefreshDuplicateCandidates() {
    const result = await window.mangaAPI.getDuplicateCandidates();
    setDuplicateCandidates(Array.isArray(result?.candidates) ? result.candidates : []);
  }

  async function handleEnqueueOcr() {
    const info = await window.mangaAPI.listOcrLanguages().catch(() => null);
    const languages = choosePreferredOcrLanguages(info || {});
    const result = await window.mangaAPI.enqueueOcr({ scope: 'all', languages });
    if (result?.ok === false && result?.error) {
      window.alert(result.error);
      return;
    }
    const status = await window.mangaAPI.listOcrLanguages().catch(() => null);
    if (status) setOcrStatus(status);
    const nextSync = await window.mangaAPI.getSyncStatus().catch(() => null);
    if (nextSync) setSyncStatus(nextSync);
  }

  async function handlePauseOcr() {
    const result = await window.mangaAPI.pauseOcr();
    setOcrStatus((prev) => ({ ...(prev || {}), paused: result?.paused !== false }));
  }

  async function handleResumeOcr() {
    const result = await window.mangaAPI.resumeOcr();
    setOcrStatus((prev) => ({ ...(prev || {}), paused: !!result?.paused }));
  }

  async function handlePurgeOcr() {
    await window.mangaAPI.purgeOcr();
    const status = await window.mangaAPI.listOcrLanguages().catch(() => null);
    if (status) setOcrStatus(status);
  }

  async function handleSetPluginEnabled(pluginId, enabled) {
    setPluginBusyId(pluginId);
    try {
      const result = await window.mangaAPI.setPluginEnabled(pluginId, enabled);
      setPlugins(Array.isArray(result?.plugins) ? result.plugins : []);
      if (!result?.ok) {
        setPluginFeedback(result?.error || 'Impossible de modifier ce plugin.');
        return;
      }
      setPluginFeedback(
        pluginId === 'sources-web'
          ? (enabled ? 'Addon Sources web actif.' : 'Addon Sources web desactive.')
          : (enabled ? 'Plugin actif.' : 'Plugin desactive.')
      );
    } catch (error) {
      setPluginFeedback(error?.message || 'Impossible de modifier ce plugin.');
    } finally {
      setPluginBusyId(null);
    }
  }

  async function handleInstallPlugin(pluginId) {
    setPluginBusyId(pluginId);
    try {
      const result = await window.mangaAPI.installPlugin(pluginId);
      setPlugins(Array.isArray(result?.plugins) ? result.plugins : []);
      if (!result?.ok) {
        setPluginFeedback(result?.error || 'Installation du plugin impossible.');
        return;
      }
      setPluginFeedback(pluginId === 'sources-web' ? 'Addon Sources web installe.' : 'Plugin installe avec succes.');
    } catch (error) {
      setPluginFeedback(error?.message || 'Installation du plugin impossible.');
    } finally {
      setPluginBusyId(null);
    }
  }

  async function handleUninstallPlugin(pluginId) {
    setPluginBusyId(pluginId);
    try {
      const result = await window.mangaAPI.uninstallPlugin(pluginId);
      setPlugins(Array.isArray(result?.plugins) ? result.plugins : []);
      if (!result?.ok) {
        setPluginFeedback(result?.error || 'Desinstallation du plugin impossible.');
        return;
      }
      if (pluginId === 'sources-web') {
        setSourcesSection('explorer');
        setAddEntryMenuAnchor(null);
      }
      setPluginFeedback(pluginId === 'sources-web' ? 'Addon Sources web retire.' : 'Plugin retire.');
    } catch (error) {
      setPluginFeedback(error?.message || 'Desinstallation du plugin impossible.');
    } finally {
      setPluginBusyId(null);
    }
  }

  async function handleOpenPlugin(pluginId) {
    if (pluginId === 'sources-web') {
      setPluginFeedback('');
      setSourcesSection('catalogue');
      setSettingsOpen(false);
      handleScreenChange('sources');
      return;
    }
    setPluginBusyId(pluginId);
    try {
      const result = await window.mangaAPI.openPlugin(pluginId);
      setPlugins(Array.isArray(result?.plugins) ? result.plugins : []);
      if (!result?.ok) {
        setPluginFeedback(result?.error || 'Lancement du plugin impossible.');
        return;
      }
      setPluginFeedback('Plugin lance.');
    } catch (error) {
      setPluginFeedback(error?.message || 'Lancement du plugin impossible.');
    } finally {
      setPluginBusyId(null);
    }
  }

  async function handleUpsertQueueItem(draft) {
    if (!draft || panicSession === 'panic') return;
    const nextPayload = await window.mangaAPI.upsertReadingQueueItem(draft);
    setPayload(nextPayload);
  }

  async function handleRemoveQueueItem(item) {
    if (!item) return;
    const nextPayload = await window.mangaAPI.removeReadingQueueItem({
      mangaId: item.raw?.mangaId || item.mangaId,
      chapterId: item.raw?.chapterId || item.chapterId || null
    });
    setPayload(nextPayload);
  }

  async function handleReorderQueue(nextItems) {
    const nextPayload = await window.mangaAPI.saveReadingQueue(nextItems.map((item) => item.raw));
    setPayload(nextPayload);
  }

  async function handleToggleQueuePinned(item) {
    const raw = item?.raw;
    if (!raw) return;
    await handleUpsertQueueItem({
      mangaId: raw.mangaContentId || raw.mangaId,
      chapterId: raw.chapterContentId || raw.chapterId || null,
      source: item.displaySource || raw.displaySource || 'manual',
      pinned: !Boolean(raw.pinned),
      deferredUntil: raw.deferredUntil || null
    });
  }

  function openQueueItem(item) {
    if (!item?.mangaId) return;
    setReadingQueueOpen(false);
    if (item.chapterId) {
      const view = buildReaderViewForChapter(item.mangaId, item.chapterId, 0, 'normal');
      if (activeView.screen === 'reader') {
        replaceActiveView(view);
      } else {
        pushViewToActive(view);
      }
      return;
    }
    if (activeView.screen === 'manga' && matchesEntityReference(currentManga || {}, item.mangaId)) {
      return;
    }
    pushViewToActive({ screen: 'manga', mangaId: item.mangaId, chapterId: null, pageIndex: 0 });
  }

  function toggleTabIncognito(tabId = activeTabId) {
    setTabs((prev) => prev.map((tab) => (
      tab.id === tabId ? { ...tab, incognito: !tab.incognito } : tab
    )));
  }

  async function triggerPanicLock() {
    if (panicSession === 'panic') return;
    setPanicSession('panic');
    setReadingQueueOpen(false);
    setContextMenu(null);
    setSettingsOpen(false);
    setMetadataSearchManga(null);
    setCollectionPickerManga(null);
    setEditingMetadata(null);
    setTagManagerManga(null);
    navigateToScreen('dashboard', { replaceHistory: true, captureScroll: false });
    setVaultCategoryFilterId(null);
    setWorkspaces((prev) => prev.map((workspace) => ({
      ...workspace,
      tabs: workspace.tabs.map((tab) => {
        const topView = getTabView(tab);
        return isViewPrivate(topView) ? { ...tab, stack: [normalizeView()] } : tab;
      }),
      activeTabId: workspace.tabs.some((tab) => !isViewPrivate(getTabView(tab)))
        ? workspace.tabs.find((tab) => !isViewPrivate(getTabView(tab)))?.id || workspace.activeTabId
        : workspace.tabs[0]?.id || workspace.activeTabId
    })));
    try {
      await handleLockVault();
    } catch (_error) {
      // Renderer panic should remain best-effort.
    }
  }

  async function handleAddAnnotation(input) {
    await refreshWith(window.mangaAPI.addAnnotation(input));
  }

  async function handleDeleteAnnotation(mangaId, annotationId) {
    await refreshWith(window.mangaAPI.deleteAnnotation(mangaId, annotationId));
  }

  async function handleToggleSidebarPin(pinDraft) {
    if (!pinDraft?.type || !pinDraft?.refId) return;
    const existing = sidebarPins.find((pin) => pin.type === pinDraft.type && pin.refId === pinDraft.refId);
    const nextPins = existing
      ? sidebarPins.filter((pin) => pin.id !== existing.id)
      : [
          ...sidebarPins,
          {
            id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ...pinDraft
          }
        ];
    await handleUpdateSettings({ sidebarPins: nextPins });
  }

  function handleActivateSidebarPin(pin) {
    if (!pin) return;

    if (pin.type === 'collection' || pin.type === 'smart-collection') {
      setRequestedCollectionsTab(pin.type === 'smart-collection' ? 'smart' : 'manual');
      setRequestedCollectionId(pin.refId);
      navigateToScreen('collections');
      if (activeView.screen !== 'library') {
        replaceActiveView(normalizeView());
      }
      return;
    }

    if (pin.type === 'tag') {
      setSearch(pin.label || '');
      handleScreenChange('library');
      return;
    }

    if (pin.type === 'screen') {
      handleScreenChange(pin.refId || 'library');
    }
  }

  async function handleQueueMaintenanceIssue(kind, explicitIds = []) {
    const mangaIds = explicitIds.length > 0
      ? explicitIds
      : kind === 'missingCover'
        ? maintenanceIssues.missingCover.map((manga) => manga.id)
        : kind === 'missingMetadata'
          ? maintenanceIssues.missingMetadata.map((manga) => manga.id)
          : [];

    await handleQueueWorkbench(mangaIds, 'append');
  }

  function commitReaderTabProgress(progressPayload, meta = {}) {
    const targetTabId = meta.tabId || activeTabId;
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== targetTabId) return tab;
      const stack = [...tab.stack];
      const topIndex = stack.length - 1;
      const topView = stack[topIndex];
      if (!topView || topView.screen !== 'reader' || topView.chapterId !== progressPayload.chapterId) return tab;
      const settledReaderIntent = topView.readerIntent
        ? {
            ...topView.readerIntent,
            kind: 'normal',
            pageIndex: Math.max(0, Math.floor(Number(progressPayload.pageIndex) || 0))
          }
        : null;
      stack[topIndex] = normalizeView({
        ...topView,
        pageIndex: progressPayload.pageIndex,
        readerState: sanitizeReaderState(progressPayload),
        readerIntent: settledReaderIntent,
        readerNotice: null
      });
      return { ...tab, stack };
    }));
  }

  function commitReaderProgress(progressPayload, meta = {}) {
    const incognito = meta.incognito ?? activeTab?.incognito;
    if (!incognito) {
      updatePayloadTracked((previous) => applyReaderProgressMutation(previous, progressPayload, {
        profile: meta.profile
      }));
    }
    commitReaderTabProgress(progressPayload, meta);
  }

  function handleUpdateProgress(progressPayload) {
    const meta = {
      tabId: activeTabId,
      incognito: Boolean(activeTab?.incognito)
    };
    commitReaderTabProgress(progressPayload, meta);
    if (meta.incognito) return;
    const now = new Date().toISOString();
    void optimisticMutationManagerRef.current.execute({
      key: `progress:${progressPayload.chapterId}`,
      label: 'Progression de lecture non enregistree',
      apply: (previous) => applyReaderProgressMutation(previous, progressPayload, { now }),
      captureInverse: (current) => captureReaderProgressSnapshot(current, progressPayload),
      captureApplied: (current) => captureReaderProgressSnapshot(current, progressPayload),
      rollback: (current, inverse) => restoreReaderProgressSnapshot(current, inverse),
      persist: () => window.mangaAPI.updateProgressLight(progressPayload)
    });
  }

  function handleReaderPersistenceError({ kind, error, retry, revision }) {
    const issue = {
      id: `reader-${kind}-${revision}`,
      kind: 'reader-session',
      persistenceKind: kind,
      title: kind === 'settings'
        ? 'Reglages du lecteur non enregistres'
        : 'Progression Kavita non enregistree',
      message: 'La lecture reste disponible, mais cette ecriture locale doit etre relancee.',
      details: String(error?.message || error || 'Ecriture locale impossible.'),
      retry: async () => {
        const result = await retry();
        if (result?.ok === false) throw result.error;
        return result;
      }
    };
    setReliabilityIssues((current) => [
      ...current.filter((entry) => entry.id !== issue.id),
      issue
    ]);
  }

  function handleKavitaProgress(progressPayload) {
    readerSessionStoreRef.current.stageProgress(progressPayload, {
      tabId: activeTabId,
      incognito: Boolean(activeTab?.incognito),
      profile: 'kavita'
    });
  }

  function handleKavitaReaderSettings(nextSettings) {
    readerSessionStoreRef.current.stageSettings(nextSettings);
  }

  function commitKavitaReaderSettings(nextSettings) {
    startTransition(() => {
      updatePayloadTracked((previous) => mergeUiSettingsIntoPayload(previous, {
        kavitaReaderSettings: {
          ...(previous?.persisted?.ui?.kavitaReaderSettings || {}),
          ...nextSettings
        }
      }));
    });
  }

  async function flushReaderSession() {
    return readerSessionStoreRef.current.flush({ commit: true });
  }

  async function handleReaderExit() {
    await popActiveView();
    scheduleBackgroundBootstrapRefresh(1400);
  }

  function actionItem(label, action, options = {}) {
    return {
      type: 'action',
      label,
      icon: options.icon,
      danger: options.danger,
      disabled: options.disabled,
      checked: options.checked,
      onSelect: async () => {
        closeContextMenu();
        await action();
      }
    };
  }

  function separatorItem() {
    return { type: 'separator' };
  }

  function openContextMenu(event, context = { type: 'app' }) {
    if (isTextContextRequest(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 280;
    const x = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8));
    let items = [];

    try {
      items = [];
    if (context.type === 'manga' && context.manga) {
      const mangaChapterIds = Array.isArray(context.manga.chapters)
        ? context.manga.chapters.map((chapter) => chapter.id).filter(Boolean)
        : [];
      const nextQueueDraft = buildNextQueueDraft(context.manga.id);
      items.push(
        actionItem('Ouvrir dans cet onglet', () => openMangaInCurrentTab(context.manga.id), { icon: <EyeIcon size={14} /> }),
        actionItem('Ouvrir dans un nouvel onglet', () => openMangaInNewTab(context.manga.id), { icon: <PlusIcon size={14} /> }),
        actionItem('Reprendre en incognito', () => resumeMangaInNewTab(context.manga.id, { incognito: true }), { icon: <EyeOffIcon size={14} /> }),
        ...(context.manga.sourceWeb?.linked ? [
          actionItem('Voir les chapitres web', () => handleOpenSourceSeriesForManga(context.manga), { icon: <LayersIcon size={14} /> })
        ] : []),
        separatorItem(),
        actionItem(context.manga.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris', () => handleToggleFavorite(context.manga.id), {
          icon: <HeartIcon size={14} filled={context.manga.isFavorite} />
        }),
        actionItem(context.manga.isRead ? 'Marquer comme non lu' : 'Marquer comme lu', () => handleSetReadStatus(context.manga.id, !context.manga.isRead, mangaChapterIds), {
          icon: <BookIcon size={14} />
        }),
        separatorItem(),
        actionItem('Gérer les tags', () => setTagManagerManga(context.manga), { icon: <TagIcon size={14} /> }),
        actionItem('Éditer les métadonnées', () => setEditingMetadata(context.manga), { icon: <EditIcon size={14} /> }),
        actionItem('Rechercher les métadonnées en ligne', () => {
          setMetadataSearchManga(context.manga);
        }, { icon: <SearchIcon size={14} /> }),
        actionItem('Importer ComicInfo', () => handleImportComicInfoForManga(context.manga.id), { icon: <SparklesIcon size={14} /> }),
        actionItem('Choisir une couverture', () => handlePickCover(context.manga.id), { icon: <SparklesIcon size={14} /> }),
        actionItem('Envoyer à l’atelier metadata', () => handleQueueWorkbench([context.manga.id], 'append'), { icon: <EditIcon size={14} /> }),
        separatorItem(),
        actionItem('Gérer les collections', () => {
          setCollectionPickerManga(context.manga);
        }, { icon: <LayersIcon size={14} /> }),
        actionItem('Ajouter à la queue', () => handleUpsertQueueItem(buildQueueDraft(context.manga.id, null, 'manual')), { icon: <LayersIcon size={14} /> }),
        actionItem('Ajouter la suite détectée', () => nextQueueDraft ? handleUpsertQueueItem(nextQueueDraft) : null, {
          icon: <ChevronRightIcon size={14} />,
          disabled: !nextQueueDraft
        }),
        actionItem(context.manga.isPrivate ? 'Retirer du coffre' : 'Envoyer au coffre', () => handleSetPrivateFlag(context.manga.id, !context.manga.isPrivate), {
          icon: <ArchiveIcon size={14} />
        }),
        separatorItem(),
        actionItem('Réinitialiser la progression', () => handleResetProgress(context.manga.id, mangaChapterIds), {
          icon: <RefreshIcon size={14} />,
          danger: true
        }),
        actionItem('Supprimer le manga', () => handleTrashManga(context.manga.id), { icon: <TrashIcon size={14} />, danger: true })
      );
    }

    if (context.type === 'chapter' && context.manga && context.chapter) {
      const nextQueueDraft = buildNextQueueDraft(context.manga.id, context.chapter.id);
      items.push(
        actionItem('Ouvrir ce chapitre ici', () => openChapterInCurrentTab(context.manga.id, context.chapter.id, context.pageIndex ?? 0), { icon: <EyeIcon size={14} /> }),
        actionItem('Ouvrir ce chapitre dans un nouvel onglet', () => openChapterInNewTab(context.manga.id, context.chapter.id, context.pageIndex ?? 0), { icon: <PlusIcon size={14} /> }),
        actionItem('Ouvrir en incognito', () => openChapterInNewTab(context.manga.id, context.chapter.id, context.pageIndex ?? 0, { incognito: true }), { icon: <EyeOffIcon size={14} /> }),
        actionItem('Ouvrir le manga dans un nouvel onglet', () => openMangaInNewTab(context.manga.id), { icon: <LayoutGridIcon size={14} /> }),
        ...(context.manga.sourceWeb?.linked ? [
          actionItem('Voir les chapitres web', () => handleOpenSourceSeriesForManga(context.manga), { icon: <LayersIcon size={14} /> })
        ] : []),
        separatorItem(),
        actionItem(context.chapter.isRead ? 'Marquer ce chapitre comme non lu' : 'Marquer ce chapitre comme lu', () => handleSetChapterReadStatus(context.manga.id, context.chapter.id, !context.chapter.isRead, context.chapter.pageCount), {
          icon: <BookIcon size={14} />
        }),
        actionItem('Ajouter à la queue', () => handleUpsertQueueItem(buildQueueDraft(context.manga.id, context.chapter.id, 'manual')), { icon: <LayersIcon size={14} /> }),
        actionItem('Ajouter la suite détectée', () => nextQueueDraft ? handleUpsertQueueItem(nextQueueDraft) : null, {
          icon: <ChevronRightIcon size={14} />,
          disabled: !nextQueueDraft
        }),
        actionItem('Réinitialiser la progression de ce chapitre', () => handleResetChapterProgress(context.chapter.id), {
          icon: <RefreshIcon size={14} />,
          danger: true
        }),
        separatorItem()
      );
    }

    if (context.type === 'category' && context.category) {
      const isCategoryPrivate = Array.isArray(vaultState.privateCategoryIds) && vaultState.privateCategoryIds.includes(context.category.id);
      items.push(
        ...(context.category.exists === false || context.category.availability === 'missing' ? [
          actionItem('Retrouver le dossier', () => handleRelinkCategory(context.category.id), { icon: <FolderPlusIcon size={14} /> }),
          separatorItem()
        ] : []),
        actionItem(
          context.scope === 'vault' ? 'Voir cette categorie dans le coffre' : 'Filtrer sur cette categorie',
          () => {
            if (context.scope === 'vault') {
              navigateToScreen('vault');
              setVaultCategoryFilterId(context.category.id);
              return;
            }
            handleSelectCategory(context.category.id);
          },
          { icon: <LibraryIcon size={14} /> }
        ),
        actionItem(
          isCategoryPrivate ? 'Retirer cette categorie du coffre' : 'Envoyer la categorie au coffre',
          () => handleSetPrivateCategoryFlag(context.category.id, !isCategoryPrivate),
          { icon: <ArchiveIcon size={14} /> }
        ),
        actionItem('Ouvrir le coffre', () => {
          navigateToScreen('vault');
          setVaultCategoryFilterId(isCategoryPrivate ? context.category.id : null);
        }, { icon: <ArchiveIcon size={14} /> }),
        actionItem(context.category.hidden ? 'Afficher la categorie' : 'Masquer la categorie', () => handleToggleCategoryHidden(context.category.id), {
          icon: context.category.hidden ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />,
          disabled: context.scope === 'vault'
        }),
        actionItem('Retirer cette categorie', () => handleRemoveCategory(context.category.id), {
          icon: <TrashIcon size={14} />,
          danger: true,
          disabled: context.scope === 'vault'
        }),
        separatorItem()
      );
    }

    if (context.type === 'collection' && context.collection) {
      const pinType = context.collection.isSmart ? 'smart-collection' : 'collection';
      const isPinned = sidebarPins.some((pin) => pin.type === pinType && pin.refId === context.collection.id);
      items.push(
        actionItem('Ouvrir cette collection', () => handleActivateSidebarPin({
          type: pinType,
          refId: context.collection.id,
          label: context.collection.name
        }), { icon: <LayersIcon size={14} /> }),
        actionItem(isPinned ? 'Retirer de la barre laterale' : 'Epingler a la barre laterale', () => handleToggleSidebarPin({
          type: pinType,
          refId: context.collection.id,
          label: context.collection.name
        }), { icon: <PinIcon size={14} /> }),
        separatorItem()
      );
    }

    if (context.type === 'sidebar-pin' && context.pin) {
      items.push(
        actionItem('Ouvrir ce raccourci', () => handleActivateSidebarPin(context.pin), { icon: <LayersIcon size={14} /> }),
        actionItem('Retirer de la barre laterale', () => handleToggleSidebarPin(context.pin), {
          icon: <TrashIcon size={14} />,
          danger: true
        }),
        separatorItem()
      );
    }

    if (context.type === 'workspace' && context.workspace) {
      items.push(
        actionItem('Basculer vers cet espace', () => switchWorkspace(context.workspace.id), { icon: <LayersIcon size={14} /> }),
        actionItem('Renommer cet espace', () => renameWorkspace(context.workspace.id), { icon: <EditIcon size={14} /> }),
        actionItem('Supprimer cet espace', () => deleteWorkspace(context.workspace.id), {
          icon: <TrashIcon size={14} />,
          danger: true,
          disabled: workspaces.length <= 1
        }),
        separatorItem()
      );
    }

    if (context.type === 'tab' && context.tab) {
      const tabInWorkspace = tabs.find((tab) => tab.id === context.tab.id) ?? null;
      const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== activeWorkspaceId);
      const selectedIndex = tabs.findIndex((tab) => tab.id === context.tab.id);
      const hasTabsToRight = selectedIndex >= 0 && tabs.slice(selectedIndex + 1).some((tab) => !tab.pinned);
      const canCloseOthers = tabs.some((tab) => tab.id !== context.tab.id && !tab.pinned);

      items.push(
        actionItem(tabInWorkspace?.pinned ? 'Désépingler l’onglet' : 'Épingler l’onglet', () => toggleTabPin(context.tab.id), { icon: <PinIcon size={14} /> }),
        actionItem('Dupliquer l’onglet', () => duplicateTab(context.tab.id), { icon: <CopyIcon size={14} /> }),
        actionItem('Fermer les autres onglets', () => closeOtherTabs(context.tab.id), {
          icon: <TrashIcon size={14} />,
          danger: true,
          disabled: !canCloseOthers
        }),
        actionItem('Fermer les onglets à droite', () => closeTabsToRight(context.tab.id), {
          icon: <TrashIcon size={14} />,
          danger: true,
          disabled: !hasTabsToRight
        }),
        separatorItem(),
        actionItem('Nouvel onglet bibliothèque', () => openNewLibraryTab(), { icon: <PlusIcon size={14} /> }),
        actionItem('Fermer cet onglet', () => closeTab(context.tab.id), { icon: <TrashIcon size={14} />, danger: true, disabled: tabs.length === 1 }),
        separatorItem()
      );

      if (otherWorkspaces.length > 0) {
        otherWorkspaces.forEach((workspace) => {
          items.push(actionItem(`Déplacer vers ${workspace.name}`, () => moveTabToWorkspace(context.tab.id, workspace.id), { icon: <LayersIcon size={14} /> }));
        });
        items.push(separatorItem());
      }
    }

    if (context.type === 'reader') {
      const nextQueueDraft = buildNextQueueDraft(activeView.mangaId, activeView.chapterId, 'end-of-chapter');
      items.push(
        actionItem('Quitter la lecture', () => popActiveView(), { icon: <ChevronLeftIcon size={14} /> }),
        actionItem('Plein écran', () => window.mangaAPI.toggleFullScreen(), { icon: <FullscreenIcon size={14} /> }),
        actionItem(isCurrentTabIncognito ? 'Désactiver l incognito' : 'Activer l incognito', () => toggleTabIncognito(activeTabId), {
          icon: <EyeOffIcon size={14} />
        }),
        actionItem('Ajouter la suite à la queue', () => nextQueueDraft ? handleUpsertQueueItem(nextQueueDraft) : null, {
          icon: <LayersIcon size={14} />,
          disabled: !nextQueueDraft
        }),
        actionItem('Panic lock', () => triggerPanicLock(), { icon: <ArchiveIcon size={14} />, danger: true }),
        separatorItem()
      );
    }

    items.push(
      actionItem('Nouvel onglet bibliothèque', () => openNewLibraryTab(), { icon: <PlusIcon size={14} /> }),
      actionItem('Ajouter des catégories', () => handleOpenAddCategoriesDirect(), { icon: <FolderPlusIcon size={14} /> }),
      actionItem('Actualiser la bibliothèque', () => refreshWith(window.mangaAPI.bootstrap()), { icon: <RefreshIcon size={14} /> }),
      actionItem('Ouvrir le coffre', () => {
        navigateToScreen('vault');
        setVaultCategoryFilterId(null);
      }, { icon: <ArchiveIcon size={14} /> }),
      separatorItem(),
      actionItem(theme === 'light-paper' ? 'Passer en thème dark night' : 'Passer en thème clair', () => handleUpdateSettings({ theme: theme === 'light-paper' ? 'dark-night' : 'light-paper' }), {
        icon: <SparklesIcon size={14} />
      }),
      actionItem('Ouvrir les paramètres', () => setSettingsOpen(true), { icon: <SettingsIcon size={14} /> })
    );

    if (activeView.screen !== 'library') {
      items.push(separatorItem());
      items.push(actionItem('Revenir à la bibliothèque dans cet onglet', () => replaceActiveView(normalizeView()), { icon: <LibraryIcon size={14} /> }));
    }

    items.push(separatorItem());
    items.push(actionItem('Fermer l’onglet actif', () => closeTab(activeTabId), {
      icon: <TrashIcon size={14} />,
      danger: true
    }));
    } catch (error) {
      console.error('Context menu failed to open:', error);
      items = [
        actionItem('Nouvel onglet bibliothèque', () => openNewLibraryTab(), { icon: <PlusIcon size={14} /> }),
        actionItem('Ouvrir les paramètres', () => setSettingsOpen(true), { icon: <SettingsIcon size={14} /> })
      ];
    }

    const menuHeight = Math.min(items.length * 38 + 18, window.innerHeight - 16);
    const y = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8));

    setContextMenu({ x, y, items });
  }

  const commandPaletteCommands = useMemo(() => {
    const commands = [
      {
        id: 'go-library',
        label: 'Ouvrir la bibliotheque',
        description: 'Revenir a la vue principale.',
        keywords: 'bibliotheque accueil home',
        action: () => handleScreenChange('library')
      },
      {
        id: 'go-favorites',
        label: 'Ouvrir les favoris',
        description: 'Retrouver les titres epingles en coeur.',
        keywords: 'favoris coeur',
        action: () => handleScreenChange('favorites')
      },
      {
        id: 'go-recents',
        label: 'Ouvrir les recents',
        description: 'Reprendre les dernieres lectures.',
        keywords: 'recents historique reprise',
        action: () => handleScreenChange('recents')
      },
      {
        id: 'go-collections',
        label: 'Ouvrir les collections',
        description: 'Parcourir les collections manuelles et smart.',
        keywords: 'collections smart',
        action: () => handleScreenChange('collections')
      },
      {
        id: 'go-maintenance',
        label: 'Ouvrir la maintenance',
        description: 'Voir sync et OCR local.',
        keywords: 'maintenance ocr sync',
        action: () => handleScreenChange('maintenance')
      },
      {
        id: 'go-workbench',
        label: 'Ouvrir l atelier metadata',
        description: 'Traiter la file metadata en lot.',
        keywords: 'atelier metadata queue',
        action: () => handleScreenChange('workbench')
      },
      {
        id: 'go-vault',
        label: 'Ouvrir le coffre',
        description: 'Basculer vers les titres proteges.',
        keywords: 'coffre prive vault',
        action: () => handleScreenChange('vault')
      },
      {
        id: 'open-settings',
        label: 'Ouvrir les parametres',
        description: 'Acceder aux reglages avances et aux preferences.',
        keywords: 'parametres reglages avances preferences',
        action: () => setSettingsOpen(true)
      },
      {
        id: 'open-queue',
        label: 'Ouvrir la queue de lecture',
        description: 'Voir ce qui vient ensuite.',
        keywords: 'queue lecture ensuite',
        action: () => setReadingQueueOpen(true)
      },
      {
        id: 'run-deep-scan',
        label: 'Lancer un scan profond',
        description: 'Reconstruit l analyse locale de la bibliotheque.',
        keywords: 'scan profond analyse',
        action: () => handleRunDeepScan()
      },
      {
        id: 'rebuild-derived',
        label: 'Reconstruire les donnees derivees',
        description: 'Regenerer la base derivee et le cache.',
        keywords: 'derivees cache sqlite reconstruction',
        action: () => handleRebuildDerivedData()
      }
    ];

    if (webSourcesEnabled) {
      commands.splice(9, 0, {
        id: 'open-web-sources',
        label: 'Ouvrir Sources web',
        description: 'Rechercher puis importer dans une categorie locale.',
        keywords: 'sources web import mangadex addon',
        action: () => {
          setSourcesSection('explorer');
          handleScreenChange('sources');
        }
      });
    }

    filteredMangas.slice(0, 6).forEach((manga) => {
      commands.push({
        id: `open-manga-${manga.id}`,
        label: `Ouvrir ${manga.displayTitle || manga.name}`,
        description: manga.author || manga.categoryName || 'Manga',
        keywords: `${manga.displayTitle || manga.name} manga lecture`,
        action: () => openMangaInCurrentTab(manga.id)
      });
    });

    return commands;
  }, [filteredMangas, handleRebuildDerivedData, handleRunDeepScan, webSourcesEnabled]);

  function handleRunCommand(command) {
    if (!command?.action) return;
    setCommandPaletteOpen(false);
    setCommandPaletteQuery('');
    command.action();
  }

  if (bootError) {
    return (
      <div className="boot-screen">
        <div className="boot-screen-panel">
          <p>{bootError}</p>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="boot-screen">
        <div className="boot-screen-panel">
          <div className="boot-spinner" aria-hidden="true" />
          <p>Chargement de la bibliothèque…</p>
        </div>
      </div>
    );
  }

  const bgImageUrl = ui.backgroundImage
    ? `manga://local/${encodeURIComponent(ui.backgroundImage)}`
    : null;
  const bgOpacity = ui.backgroundOpacity ?? 0.15;
  const showKavitaUpgradeBanner = shouldShowKavitaUpgradeBanner(ui);
  const visibleVaultCount = vaultState.locked ? 0 : (vaultState.privateCount || privateMangas.length);
  const vaultActionLabel = selectedMangas.length > 0 && selectedMangas.every((manga) => manga.isPrivate)
    ? 'Retirer du coffre'
    : 'Envoyer au coffre';
  const shouldShowTopBar = activeView.screen === 'library'
    && !['dashboard', 'collections', 'maintenance', 'workbench', 'sources'].includes(activeScreen)
    && !(activeScreen === 'vault' && (vaultState.locked || !vaultState.configured));
  const topBarCategory = activeScreen === 'vault' ? activeVaultCategory : selectedCategory;
  const clearTopBarCategory = activeScreen === 'vault'
    ? () => setVaultCategoryFilterId(null)
    : () => handleSelectCategory(null);

  latestHandlersRef.current.openMangaInCurrentTab = openMangaInCurrentTab;
  latestHandlersRef.current.openMangaInNewTab = openMangaInNewTab;
  latestHandlersRef.current.handleToggleFavorite = handleToggleFavorite;
  latestHandlersRef.current.toggleSelectedManga = toggleSelectedManga;
  latestHandlersRef.current.toggleSelectionMode = toggleSelectionMode;
  latestHandlersRef.current.openContextMenu = openContextMenu;
  latestHandlersRef.current.resumeMangaInCurrentTab = resumeMangaInCurrentTab;
  latestHandlersRef.current.handleJobsProgress = handleBulkTrashJobProgress;

  if (interfaceMode === 'kavita') {
    const kavitaModel = {
      ui,
      activeView,
      activeScreen,
      library,
      mangas: filteredMangas,
      categories: visibleCategories,
      selectedCategoryId,
      currentManga,
      currentChapter: resolvedChapter,
      annotations: currentMangaAnnotations,
      collections: allCollections,
      collectionShowcase: kavitaCollectionShowcase,
      tags: allTags,
      maintenanceIssues,
      maintenanceStats,
      identitySuggestions: payload?.persisted?.identitySuggestions ?? [],
      identityBusy,
      workbenchMangas: workbenchQueueMangas,
      vault: vaultState,
      vaultMangas: filteredPrivateMangas,
      vaultCategories,
      activeVaultCategoryId: vaultCategoryFilterId,
      plugins,
      migrationStatus,
      syncStatus,
      scrollKey: activeScrollKey,
      initialScrollPosition: activeInitialScrollPosition,
      initialScrollTop: activeInitialScrollTop,
      onScrollPositionChange: handleViewScrollPositionChange,
      tabs: tabsMeta,
      activeTabId,
      workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
      activeWorkspaceId,
      search,
      searchState,
      searchSuggestions,
      searchResultCount: activeSearchResultCount,
      searchChips,
      searchStatus,
      searchFilterOptions: {
        tags: allTags,
        collections: allCollections
      },
      settingsOpen,
      selectionMode,
      selectedIds: selectedMangaIdSet,
      selectionHiddenCount: selectionSummary.hiddenCount,
      bulkTrashJobStatus,
      webSourcesEnabled,
      actions: {
        onSearchChange: setSearch,
        onSearchStateChange: setSearchState,
        onCommitSearch: handleCommitSearch,
        onClearSearchRecents: handleClearSearchRecents,
        onRemoveAdvancedSearchToken: handleRemoveAdvancedSearchToken,
        onSaveSearch: handleSaveQueryAsSmartCollection,
        onScreenChange: handleScreenChange,
        onSelectCategory: handleSelectCategory,
        onOpenManga: stableOpenManga,
        onOpenMangaInNewTab: openMangaInNewTab,
        onResumeMangaIncognito: (mangaId) => resumeMangaInNewTab(mangaId, { incognito: true }),
        onOpenSourceSeries: handleOpenSourceSeriesForManga,
        onResumeManga: resumeMangaInCurrentTab,
        onOpenChapter: openChapterInCurrentTab,
        onOpenChapterInNewTab: openChapterInNewTab,
        onOpenChapterIncognito: (mangaId, chapterId, pageIndex = 0) => openChapterInNewTab(
          mangaId,
          chapterId,
          pageIndex,
          { incognito: true }
        ),
        onReadFrom: (mangaId, chapterId, pageIndex) => pushViewToActive(
          buildReaderViewForChapter(mangaId, chapterId, pageIndex, 'exact-page')
        ),
        onReadFromInNewTab: (mangaId, chapterId, pageIndex, options = {}) => openNewTab(
          buildReaderViewForChapter(mangaId, chapterId, pageIndex, 'exact-page'),
          [normalizeView(), { screen: 'manga', mangaId }, { screen: 'preview', mangaId, chapterId }],
          options
        ),
        onReaderExit: handleReaderExit,
        onOpenReaderChapter: async (chapterId) => {
          await flushReaderSession();
          replaceActiveView(buildReaderViewForChapter(currentChapterData.manga?.id, chapterId, 0, 'normal'));
        },
        onUpdateProgress: handleKavitaProgress,
        onReaderSettingsChange: handleKavitaReaderSettings,
        onAddAnnotation: handleAddAnnotation,
        onDeleteAnnotation: handleDeleteAnnotation,
        onToggleFavorite: stableToggleFavorite,
        onSetMangaReadStatus: handleSetReadStatus,
        onSearchOnlineMetadata: (query) => window.mangaAPI.searchOnlineMetadata(query),
        onImportOnlineMetadata: handleImportOnlineMetadata,
        onImportComicInfo: handleImportComicInfoForManga,
        onPickCover: handlePickCover,
        onQueueWorkbench: (mangaId) => handleQueueWorkbench([mangaId], 'append'),
        onAddMangaToQueue: (mangaId) => handleUpsertQueueItem(buildQueueDraft(mangaId, null, 'manual')),
        onAddNextToQueue: (mangaId, chapterId = null) => {
          const draft = buildNextQueueDraft(mangaId, chapterId);
          return draft ? handleUpsertQueueItem(draft) : null;
        },
        onSetPrivateFlag: handleSetPrivateFlag,
        onResetMangaProgress: handleResetProgress,
        onTrashManga: handleTrashManga,
        onToggleSelect: stableToggleSelectedManga,
        onClearSelection: clearSelection,
        onExitSelection: exitSelection,
        onSelectAllSelection: selectAllVisibleMangas,
        onInvertSelection: invertVisibleMangaSelection,
        onBulkRead: handleBulkRead,
        onBulkFavorite: handleBulkFavorite,
        onOpenBulkCollectionPicker: () => setBatchCollectionOpen(true),
        onOpenBulkTagPicker: () => setBatchTagOpen(true),
        onBulkQueueWorkbench: () => handleQueueWorkbench(selectedMangaIds, 'append'),
        onBulkVaultToggle: handleBulkVaultToggle,
        bulkVaultActionLabel: vaultActionLabel,
        onBulkGroupEditions: handleBulkGroupEditions,
        onBulkTrash: handleBulkTrashMangas,
        onCancelBulkTrash: handleCancelBulkTrashJob,
        onBulkUndo: bulkUndoAction ? handleBulkUndo : null,
        bulkUndoLabel: bulkUndoAction?.label,
        onBack: popActiveView,
        onSaveMetadata: handleSaveMetadata,
        onToggleTag: handleToggleTag,
        onCreateTag: handleCreateTag,
        onDeleteTag: handleDeleteTag,
        onAddToCollection: handleAddToCollection,
        onRemoveFromCollection: handleRemoveMangaFromCollection,
        onCreateCollection: handleCreateCollection,
        onSetChapterReadStatus: handleSetChapterReadStatus,
        onAddChapterToQueue: (mangaId, chapterId) => handleUpsertQueueItem(
          buildQueueDraft(mangaId, chapterId, 'manual')
        ),
        onAddNextChapterToQueue: (mangaId, chapterId) => {
          const draft = buildNextQueueDraft(mangaId, chapterId);
          return draft ? handleUpsertQueueItem(draft) : null;
        },
        onResetChapterProgress: handleResetChapterProgress,
        onToggleCategoryHidden: handleToggleCategoryHidden,
        onRemoveCategory: handleRemoveCategory,
        onOpenCollection: (collection) => handleActivateSidebarPin({
          type: collection.isSmart ? 'smart-collection' : 'collection',
          refId: collection.id,
          label: collection.name
        }),
        onToggleCollectionPin: (collection) => handleToggleSidebarPin({
          type: collection.isSmart ? 'smart-collection' : 'collection',
          refId: collection.id,
          label: collection.name
        }),
        onUpdateSettings: handleUpdateSettings,
        onRequestInterfaceMode: handleRequestInterfaceMode,
        onSettingsOpenChange: setSettingsOpen,
        onSelectTab: handleSelectTab,
        onCloseTab: closeTab,
        onNewTab: openNewLibraryTab,
        onReorderTabs: reorderTabs,
        onToggleTabPin: toggleTabPin,
        onDuplicateTab: duplicateTab,
        onCloseOtherTabs: closeOtherTabs,
        onCloseTabsToRight: closeTabsToRight,
        onMoveTabToWorkspace: moveTabToWorkspace,
        onForceRescan: handleForceRescan,
        onRunDeepScan: handleRunDeepScan,
        onRebuildDerivedData: handleRebuildDerivedData,
        onAnalyzeMigration: handleAnalyzeMigration,
        onRunMigration: handleRunMigration,
        onAnalyzeIdentities: handleAnalyzeIdentities,
        onDecideIdentitySuggestion: handleDecideIdentitySuggestion,
        onSelectEdition: (mangaId) => replaceActiveView({ screen: 'manga', mangaId, chapterId: null, pageIndex: 0 }),
        onSetPreferredEdition: handleSetPreferredEdition,
        onUngroupEditions: handleUngroupEditions,
        onSetupVault: handleSetVaultPin,
        onUnlockVault: handleUnlockVault,
        onLockVault: handleLockVault,
        onSelectVaultCategory: setVaultCategoryFilterId,
        onToggleSelectionMode: stableToggleSelectionMode,
        onToggleVaultBlur: handleToggleVaultBlur,
        onToggleVaultStealth: handleToggleVaultStealth
      }
    };

    return (
      <ShellErrorBoundary key={`shell-${interfaceMode}`} onError={handleShellMountError}>
        <>
          <Suspense fallback={<LazyPanelPlaceholder label="Chargement de l interface Kavita..." />}>
            <KavitaShell model={kavitaModel} />
          </Suspense>
          {batchCollectionOpen ? (
            <BatchPickerModal
              title="Ajouter a une collection"
              subtitle="Choisis une collection pour tous les mangas selectionnes."
              items={allCollections}
              itemLabel={(item) => item.name}
              itemMeta={(item) => `${(item.mangaIds || []).length} manga(s)`}
              createLabel="Creer la collection"
              newItemPlaceholder="Nom de la collection"
              onCreate={(name) => handleCreateCollection(name, '')}
              onPick={(item) => handleBulkAddCollection(item.id)}
              onClose={() => setBatchCollectionOpen(false)}
            />
          ) : null}
          {batchTagOpen ? (
            <BatchPickerModal
              title="Ajouter un tag"
              subtitle="Applique un tag a toute la selection."
              items={allTags}
              itemLabel={(item) => item.name}
              itemMeta={(item) => item.color || 'Tag'}
              createLabel="Creer le tag"
              newItemPlaceholder="Nom du tag"
              onCreate={(name) => handleCreateTag(name, ui.accent || '#38bdf8')}
              onPick={(item) => handleBulkAddTag(item.id)}
              onClose={() => setBatchTagOpen(false)}
            />
          ) : null}
          <ReliabilityNoticeCenter
            issues={reliabilityIssues}
            syncStatus={syncStatus}
            onRetry={handleRetryReliabilityIssue}
            onDismiss={handleDismissReliabilityIssue}
            onRetrySync={handleRetryBackgroundSync}
          />
          {interfaceTransitioning ? <div className="interface-transition-veil" aria-hidden="true" /> : null}
          {interfaceTransitionError ? <div className="interface-transition-error" role="alert">{interfaceTransitionError}</div> : null}
        </>
      </ShellErrorBoundary>
    );
  }

  return (
    <ShellErrorBoundary key={`shell-${interfaceMode}`} onError={handleShellMountError}>
      <>
      <div
      className={`app-shell theme-${theme} ${interfaceClassName} sawa-${sawaExperience} ${readerFocusActive ? 'sawa-reader-focus' : ''}`}
      style={{
        '--accent': ui.accent,
        '--accent-alt': ui.accentAlt || '#38bdf8',
        '--card-min': cardSizeMinWidth(ui.cardSize),
        '--manga-card-min-width': cardSizeMinWidth(ui.cardSize),
        '--manga-grid-gap': cardSizeGridGap(ui.cardSize),
        '--sawa-cinematic-intensity': `${Math.max(0, Math.min(100, Number(ui.cinematicIntensity ?? 58)))}%`,
        '--sawa-foil-intensity': Math.max(0, Math.min(100, Number(ui.foilIntensity ?? 28))) / 100,
        '--sawa-custom-backdrop-factor': ui.backgroundImage ? 0.36 : 1
      }}
      onContextMenu={stableOpenContextMenu}
    >
      {bgImageUrl && (
        <div
          className="app-bg-image"
          style={{
            backgroundImage: `url("${bgImageUrl}")`,
            opacity: bgOpacity
          }}
        />
      )}
      <TitleBar
        sidebarCollapsed={shellSidebarCollapsed}
        readerFocus={readerFocusActive}
        visualVariant={visualVariant}
        onToggleSidebar={toggleSidebarCollapsed}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={switchWorkspace}
        onCreateWorkspace={createWorkspaceFromUI}
        canCreateWorkspace={workspaces.length < MAX_WORKSPACES}
        tabs={tabsMeta}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={closeTab}
        onNewTab={openNewLibraryTab}
        onContextMenu={stableOpenContextMenu}
        onReorderTabs={reorderTabs}
        queueCount={readingQueueEntries.length}
        queueOpen={readingQueueOpen}
        onToggleQueue={() => setReadingQueueOpen((prev) => !prev)}
        queueDisabled={panicSession === 'panic'}
      />
      <ReadingQueueDrawer
        open={readingQueueOpen}
        items={readingQueueEntries}
        onClose={() => setReadingQueueOpen(false)}
        onOpenItem={openQueueItem}
        onRemoveItem={handleRemoveQueueItem}
        onTogglePinned={handleToggleQueuePinned}
        onReorderItems={handleReorderQueue}
        blocked={panicSession === 'panic'}
      />
      {showKavitaUpgradeBanner ? (
        <div className="v2-upgrade-banner" role="region" aria-label="Sawa v2 interface Kavita">
          <div className="v2-upgrade-banner-copy">
            <span>Sawa v2</span>
            <strong>La nouvelle interface Kavita est disponible</strong>
            <p>Active une interface independante, plus plate, dense et classique.</p>
          </div>
          <div className="v2-upgrade-banner-actions">
            <button type="button" className="primary-button" onClick={handleActivateKavitaClean}>
              Activer l interface Kavita
            </button>
            <button type="button" className="ghost-button" onClick={handleDismissKavitaCleanUpgrade}>
              Garder Sawa actuel
            </button>
          </div>
        </div>
      ) : null}
      {commandPaletteOpen ? (
        <Suspense fallback={<LazyPanelPlaceholder label="Chargement de la palette locale..." />}>
          <CommandPalette
            open={commandPaletteOpen}
            query={commandPaletteQuery}
            commands={commandPaletteCommands}
            onQueryChange={setCommandPaletteQuery}
            onClose={() => {
              setCommandPaletteOpen(false);
              setCommandPaletteQuery('');
            }}
            onRun={handleRunCommand}
          />
        </Suspense>
      ) : null}
      <AddEntryMenu
        open={!!addEntryMenuAnchor}
        anchor={addEntryMenuAnchor}
        showWebSources={webSourcesEnabled}
        onClose={closeAddEntryMenu}
        onAddCategories={handleOpenAddCategories}
        onOpenWebSources={handleOpenWebSources}
      />
      <div className={`layout-shell ${shellSidebarCollapsed ? 'layout-shell-sidebar-collapsed' : ''} ${readerFocusActive ? 'layout-shell-reader-focus' : ''}`}>
        <Sidebar
          collapsed={shellSidebarCollapsed || readerFocusActive}
          visualVariant={visualVariant}
          onToggleCollapsed={toggleSidebarCollapsed}
          activeScreen={activeScreen}
          onScreenChange={handleScreenChange}
          categories={visibleCategories}
          allCategories={library.categories}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={handleSelectCategory}
          onAddCategories={handleAddEntry}
          onToggleCategoryHidden={handleToggleCategoryHidden}
          onRemoveCategory={handleRemoveCategory}
          onRelinkCategory={handleRelinkCategory}
          onOpenSettings={() => setSettingsOpen(true)}
          showHiddenCategories={ui.showHiddenCategories}
          onContextMenu={stableOpenContextMenu}
          favoritesCount={library.favorites?.length ?? 0}
          maintenanceCount={maintenanceCount}
          workbenchCount={workbenchQueueMangas.length}
          vaultCount={visibleVaultCount}
          showSources={webSourcesEnabled}
          sidebarSections={sidebarSections}
          sidebarHiddenSections={sidebarHiddenSections}
          sidebarPins={sidebarPins}
          onActivatePin={handleActivateSidebarPin}
          onSetSectionVisible={handleSetSidebarSectionVisible}
          onReorderSections={handleReorderSidebarSections}
        />

        <div className="content-shell">
          {shouldShowTopBar && (
            <TopBar
              sidebarCollapsed={ui.sidebarCollapsed}
              onToggleSidebar={toggleSidebarCollapsed}
              search={search}
              onSearchChange={setSearch}
              searchState={searchState}
              onSearchStateChange={setSearchState}
              searchSuggestions={searchSuggestions}
              searchResultCount={activeSearchResultCount}
              searchFilterOptions={{ tags: allTags, collections: allCollections }}
              onCommitSearch={handleCommitSearch}
              onClearSearchRecents={handleClearSearchRecents}
              onRemoveAdvancedSearchToken={handleRemoveAdvancedSearchToken}
              sort={ui.sort}
              onSortChange={(sort) => handleUpdateSettings({ sort })}
              selectedCategory={topBarCategory}
              onClearCategory={clearTopBarCategory}
              onOpenSettings={() => setSettingsOpen(true)}
              onAddCategories={handleAddEntry}
              activeScreen={activeScreen}
              selectionMode={selectionMode}
              selectedCount={selectedMangaIds.length}
              onToggleSelectionMode={stableToggleSelectionMode}
              searchChips={searchChips}
              searchStatus={searchStatus}
              searchHelpOpen={searchHelpOpen}
              onToggleSearchHelp={() => setSearchHelpOpen((prev) => !prev)}
              onSaveSearch={handleSaveQueryAsSmartCollection}
              onOpenCommandPalette={() => setCommandPaletteOpen(true)}
              commandPaletteLabel={formatShortcutLabel(keyboardShortcuts.openCommandPalette)}
            />
          )}

          {activeView.screen === 'library' && selectionMode && !(activeScreen === 'vault' && (vaultState.locked || !vaultState.configured)) && (
            <BulkActionBar
              selectionCount={selectedMangaIds.length}
              hiddenCount={selectionSummary.hiddenCount}
              onClear={clearSelection}
              onExit={exitSelection}
              onSelectAll={selectAllVisibleMangas}
              onInvert={invertVisibleMangaSelection}
              onMarkRead={() => handleBulkRead(true)}
              onMarkUnread={() => handleBulkRead(false)}
              onFavorite={() => handleBulkFavorite(true)}
              onUnfavorite={() => handleBulkFavorite(false)}
              onOpenCollectionPicker={() => setBatchCollectionOpen(true)}
              onOpenTagPicker={() => setBatchTagOpen(true)}
              onQueueWorkbench={() => handleQueueWorkbench(selectedMangaIds, 'append')}
              onVaultToggle={handleBulkVaultToggle}
              vaultActionLabel={vaultActionLabel}
              onGroupEditions={handleBulkGroupEditions}
              onTrash={handleBulkTrashMangas}
              trashJob={bulkTrashJobStatus}
              onCancelTrash={handleCancelBulkTrashJob}
              onUndo={bulkUndoAction ? handleBulkUndo : null}
              undoLabel={bulkUndoAction?.label}
            />
          )}

          {activeView.screen === 'library' && activeScreen === 'dashboard' && (
            <Dashboard
              allMangas={dashboardMangas}
              favorites={dashboardFavorites}
              persisted={payload?.persisted ?? {}}
              ui={ui}
              onOpenManga={stableOpenManga}
              onResumeManga={stableResumeManga}
              onToggleFavorite={stableToggleFavorite}
              onNavigateTo={(target) => {
                if (target === 'library') {
                  handleScreenChange('library');
                } else if (target === 'collections') {
                  handleScreenChange('collections');
                } else if (target === 'favorites') {
                  handleScreenChange('favorites');
                } else {
                  handleScreenChange('library');
                }
              }}
              onContextMenu={stableOpenContextMenu}
              onOpenSettings={() => setSettingsOpen(true)}
              onUpdateSettings={handleUpdateSettings}
              onOpenMaintenance={() => handleScreenChange('maintenance')}
              maintenanceCount={maintenanceCount}
              selectionMode={selectionMode}
              selectedMangaIds={selectedMangaIdSet}
              selectionOrder={dashboardSelectionModel.visibleIds}
              onToggleSelect={stableToggleSelectedManga}
              onSelectionModeChange={stableToggleSelectionMode}
            />
          )}

            {activeView.screen === 'library' && activeScreen === 'collections' && (
              <Suspense fallback={<LazyPanelPlaceholder label="Chargement des collections..." />}>
                <CollectionsView
                  visualVariant={visualVariant}
                  cardSize={ui.cardSize}
                  foilEnabled={ui.foilEnabled !== false}
                  foilIntensity={Number(ui.foilIntensity ?? 28)}
                  adaptiveVisualEffects={ui.adaptiveVisualEffects !== false}
                  allMangas={projectCanonicalMangas(library.allMangas, workGroups)}
                  persisted={payload?.persisted ?? {}}
                  onOpenManga={stableOpenManga}
                  onOpenMangaInBackgroundTab={stableOpenMangaInBackgroundTab}
                  initialScrollTop={activeInitialScrollTop}
                  initialScrollPosition={activeInitialScrollPosition}
                  scrollKey={activeScrollKey}
                  onScrollPositionChange={handleViewScrollPositionChange}
                  onToggleFavorite={stableToggleFavorite}
                  onCreateCollection={handleCreateCollection}
                  onDeleteCollection={handleDeleteCollection}
                  onUpdateCollection={handleUpdateCollection}
                  onRemoveMangaFromCollection={handleRemoveMangaFromCollection}
                  onSaveSmartCollection={handleSaveSmartCollection}
                  onDeleteSmartCollection={handleDeleteSmartCollection}
                  sidebarPins={sidebarPins}
                  onToggleSidebarPin={handleToggleSidebarPin}
                  requestedCollectionId={requestedCollectionId}
                  requestedTab={requestedCollectionsTab}
                  selectionMode={selectionMode}
                  selectedMangaIds={selectedMangaIdSet}
                  onToggleSelect={stableToggleSelectedManga}
                  onSelectionModeChange={stableToggleSelectionMode}
                  onVisibleSelectionChange={setCollectionSelectionView}
                  onContextMenu={stableOpenContextMenu}
                />
              </Suspense>
            )}

            {activeView.screen === 'library' && activeScreen === 'maintenance' && (
              <Suspense fallback={<LazyPanelPlaceholder label="Chargement de l entretien..." />}>
                <MaintenanceView
                  initialScrollTop={activeInitialScrollTop}
                  scrollKey={activeScrollKey}
                  onScrollPositionChange={handleViewScrollPositionChange}
                  issues={maintenanceIssues}
                  stats={maintenanceStats}
                  syncStatus={syncStatus}
                  ocrStatus={ocrStatus}
                  migrationStatus={migrationStatus}
                  migrationBusy={migrationBusy}
                  migrationFeedback={migrationFeedback}
                  duplicateCandidates={duplicateCandidates}
                  identitySuggestions={payload?.persisted?.identitySuggestions ?? []}
                  identityBusy={identityBusy}
                  showOcrSection={true}
                  showVisualDedupeSection={false}
                  workbenchCount={workbenchQueueMangas.length}
                  vaultCount={visibleVaultCount}
                  onOpenManga={stableOpenManga}
                  onForceRescan={handleForceRescan}
                  onRetrySync={handleRetryBackgroundSync}
                  onRunDeepScan={handleRunDeepScan}
                  onRebuildDerivedData={handleRebuildDerivedData}
                  onAnalyzeMigration={handleAnalyzeMigration}
                  onRunMigration={handleRunMigration}
                  onCleanupLegacyStorage={handleCleanupLegacyStorage}
                  onRefreshDuplicateCandidates={handleRefreshDuplicateCandidates}
                  onAnalyzeIdentities={handleAnalyzeIdentities}
                  onDecideIdentitySuggestion={handleDecideIdentitySuggestion}
                  onEnqueueOcr={handleEnqueueOcr}
                  onPauseOcr={handlePauseOcr}
                  onResumeOcr={handleResumeOcr}
                  onPurgeOcr={handlePurgeOcr}
                  onQueueIssue={handleQueueMaintenanceIssue}
                  onPickCover={handlePickCover}
                  onOpenWorkbench={() => handleScreenChange('workbench')}
                  onOpenVault={() => handleScreenChange('vault')}
                />
              </Suspense>
            )}

            {activeView.screen === 'library' && activeScreen === 'workbench' && (
              <Suspense fallback={<LazyPanelPlaceholder label="Chargement de l atelier..." />}>
                <MetadataWorkbenchView
                  initialScrollTop={activeInitialScrollTop}
                  scrollKey={activeScrollKey}
                  onScrollPositionChange={handleViewScrollPositionChange}
                  queueMangas={workbenchQueueMangas}
                  onReplaceQueue={handleReplaceWorkbenchQueue}
                  onImportMatch={handleImportWorkbenchMatch}
                  onPickCover={handlePickCover}
                  onOpenManga={stableOpenManga}
                />
              </Suspense>
            )}

            {activeView.screen === 'library' && activeScreen === 'sources' && webSourcesEnabled && (
              <Suspense fallback={<LazyPanelPlaceholder label="Chargement du centre Sources web..." />}>
                <SourcesView
                  plugin={webSourcesPlugin}
                  section={sourcesSection}
                  categories={visibleCategories}
                  defaultCategoryId={payload?.persisted?.plugins?.lastSourceImportCategoryId || selectedCategoryId || visibleCategories[0]?.id || ''}
                  context={sourceExplorerContext}
                  recentSeries={payload?.sources?.recentSeries ?? []}
                  linkedSeries={payload?.sources?.linkedSeries ?? []}
                  initialScrollTop={activeInitialScrollTop}
                  onSectionChange={setSourcesSection}
                  onImported={async () => {
                    try {
                      await refreshWith(window.mangaAPI.bootstrap());
                    } finally {
                      window.mangaAPI.getSyncStatus().then((status) => setSyncStatus(status)).catch(() => {});
                    }
                  }}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onScrollPositionChange={handleViewScrollPositionChange}
                />
              </Suspense>
            )}

            {activeView.screen === 'library' && activeScreen === 'vault' && (
              <Suspense fallback={<LazyPanelPlaceholder label="Chargement du coffre..." />}>
                <VaultView
                  visualVariant={visualVariant}
                  foilEnabled={ui.foilEnabled !== false}
                  foilIntensity={Number(ui.foilIntensity ?? 28)}
                  adaptiveVisualEffects={ui.adaptiveVisualEffects !== false}
                  initialScrollTop={activeInitialScrollTop}
                  scrollKey={activeScrollKey}
                  onScrollPositionChange={handleViewScrollPositionChange}
                  vault={vaultState}
                  mangas={filteredPrivateMangas}
                  categories={vaultCategories}
                  cardSize={ui.cardSize}
                  initialScrollPosition={activeInitialScrollPosition}
                  activeCategoryId={vaultCategoryFilterId}
                  selectionMode={selectionMode}
                  selectedIds={selectedMangaIdSet}
                  onToggleSelectionMode={stableToggleSelectionMode}
                  onSelectCategory={setVaultCategoryFilterId}
                  onToggleSelect={stableToggleSelectedManga}
                  onOpenManga={stableOpenManga}
                  onOpenMangaInBackgroundTab={stableOpenMangaInBackgroundTab}
                  onToggleFavorite={stableToggleFavorite}
                  onContextMenu={stableOpenContextMenu}
                  onSetupPin={handleSetVaultPin}
                  onUnlock={handleUnlockVault}
                  onLock={handleLockVault}
                  onToggleBlur={handleToggleVaultBlur}
                  onToggleStealth={handleToggleVaultStealth}
                />
              </Suspense>
            )}

          {activeView.screen === 'library' && !['dashboard', 'collections', 'maintenance', 'workbench', 'vault', 'sources'].includes(activeScreen) && (
            <LibraryView
              mangas={filteredMangas}
              activeScreen={activeScreen}
              categories={visibleCategories}
              cardSize={ui.cardSize}
              initialScrollTop={activeInitialScrollTop}
              initialScrollPosition={activeInitialScrollPosition}
              scrollKey={activeScrollKey}
              onScrollPositionChange={handleViewScrollPositionChange}
              onOpenManga={stableOpenManga}
              onOpenSourceSeries={handleOpenSourceSeriesForManga}
              onOpenMangaInCurrentTab={stableOpenManga}
              onOpenMangaInNewTab={stableOpenMangaInNewTab}
              onOpenMangaInBackgroundTab={stableOpenMangaInBackgroundTab}
              onToggleFavorite={stableToggleFavorite}
              onContextMenu={stableOpenContextMenu}
              selectionMode={selectionMode}
              selectedIds={selectedMangaIdSet}
              onToggleSelect={stableToggleSelectedManga}
              visualVariant={visualVariant}
              cinematicBackdrop={ui.cinematicBackdrop !== false}
              cinematicIntensity={Number(ui.cinematicIntensity ?? 58)}
              foilEnabled={ui.foilEnabled !== false}
              foilIntensity={Number(ui.foilIntensity ?? 28)}
              adaptiveVisualEffects={ui.adaptiveVisualEffects !== false}
            />
          )}

          {activeView.screen === 'manga' && currentManga && (
            <MangaDetailView
              visualVariant={visualVariant}
              manga={currentManga}
              allTags={payload?.persisted?.tags ?? {}}
              allCollections={allCollections}
              annotations={currentMangaAnnotations}
              initialScrollTop={activeInitialScrollTop}
              onScrollPositionChange={handleViewScrollPositionChange}
              onBack={popActiveView}
              onOpenChapter={(chapterId) => openChapterInCurrentTab(currentManga.id, chapterId, 0)}
              onOpenChapterInNewTab={(chapterId) => openChapterInNewTab(currentManga.id, chapterId, 0)}
              onOpenChapterInBackgroundTab={(chapterId) => openChapterInNewTab(currentManga.id, chapterId, 0, { activate: false })}
              onResumeReading={() => resumeMangaInCurrentTab(currentManga.id)}
              onOpenSourceSeries={handleOpenSourceSeriesForManga}
              onToggleFavorite={stableToggleFavorite}
              onPickCover={handlePickCover}
              onOpenMetadataEditor={() => setEditingMetadata(currentManga)}
              onAddTag={() => setTagManagerManga(currentManga)}
              onAddToCollection={() => setCollectionPickerManga(currentManga)}
              onImportOnlineMetadata={handleImportOnlineMetadata}
              onOpenAnnotation={(annotation) => {
                if (!annotation?.chapterId) return;
                replaceActiveView(buildReaderViewForChapter(currentManga.id, annotation.chapterId, annotation.pageIndex ?? 0, 'exact-page'));
              }}
              onSelectEdition={(mangaId) => replaceActiveView({ screen: 'manga', mangaId, chapterId: null, pageIndex: 0 })}
              onSetPreferredEdition={handleSetPreferredEdition}
              onUngroupEditions={handleUngroupEditions}
              chapterCardSize={ui.chapterCardSize}
              previewQuality={ui.previewQuality}
              onPreviewSettingsChange={handleUpdateSettings}
              onContextMenu={stableOpenContextMenu}
            />
          )}

          {activeView.screen === 'preview' && currentChapterData.manga && resolvedChapter && (
            <ChapterPreviewView
              visualVariant={visualVariant}
              manga={currentChapterData.manga}
              chapter={resolvedChapter}
              initialScrollTop={activeInitialScrollTop}
              onScrollPositionChange={handleViewScrollPositionChange}
              onBack={popActiveView}
              onReadFrom={(pageIndex, intentKind = 'exact-page') => pushViewToActive(buildReaderViewForChapter(
                currentChapterData.manga.id,
                resolvedChapter.id,
                pageIndex,
                intentKind
              ))}
              onReadFromNewTab={(pageIndex, intentKind = 'exact-page') => openNewTab(buildReaderViewForChapter(
                currentChapterData.manga.id,
                resolvedChapter.id,
                pageIndex,
                intentKind
              ), [normalizeView(), { screen: 'manga', mangaId: currentChapterData.manga.id }, { screen: 'preview', mangaId: currentChapterData.manga.id, chapterId: resolvedChapter.id, pageIndex: 0 }])}
              onReadFromBackgroundTab={(pageIndex, intentKind = 'exact-page') => openNewTab(buildReaderViewForChapter(
                currentChapterData.manga.id,
                resolvedChapter.id,
                pageIndex,
                intentKind
              ), [normalizeView(), { screen: 'manga', mangaId: currentChapterData.manga.id }, { screen: 'preview', mangaId: currentChapterData.manga.id, chapterId: resolvedChapter.id, pageIndex: 0 }], { activate: false })}
              onOpenSourceSeries={handleOpenSourceSeriesForManga}
              pagePreviewSize={ui.pagePreviewSize}
              previewQuality={ui.previewQuality}
              onPreviewSettingsChange={handleUpdateSettings}
              onContextMenu={stableOpenContextMenu}
            />
          )}

          {activeView.screen === 'reader' && currentChapterData.manga && resolvedChapter && (
            <ReaderView
              key={`${activeTab.id}:${currentChapterData.manga.contentId || currentChapterData.manga.id}:${resolvedChapter.contentId || resolvedChapter.id}:${activeView.readerIntent?.token || 'restored'}`}
              manga={currentChapterData.manga}
              chapter={resolvedChapter}
              chapters={currentChapterData.manga.chapters ?? []}
              annotations={payload?.persisted?.annotations?.[currentChapterData.manga.id] ?? []}
              experimentalFeatures={ui.experimental ?? {}}
              focusToken={activeTab.id}
              initialPageIndex={activeView.pageIndex}
              initialReaderState={sanitizeReaderState(activeView.readerState)}
              readerIntent={sanitizeReaderIntent(activeView.readerIntent)}
              entryNotice={activeView.readerNotice}
              preferredMode={ui.readerMode}
              preferredFitMode={ui.readerFit}
              preferredZoom={ui.readerZoom ?? 1}
              autoHideUI={readerFocusActive || !!ui.autoHideReaderUI}
              controlsHideMs={Number(ui.readerControlsHideMs ?? 3000)}
              visualVariant={visualVariant}
              onExit={handleReaderExit}
              onOpenChapter={(chapterId) => replaceActiveView(buildReaderViewForChapter(currentChapterData.manga.id, chapterId, 0, 'normal'))}
              onUpdateProgress={handleUpdateProgress}
              onAddAnnotation={handleAddAnnotation}
              onDeleteAnnotation={handleDeleteAnnotation}
              onContextMenu={stableOpenContextMenu}
            />
          )}

          {!currentManga && activeView.screen !== 'library' && (
            <section className="empty-card">
              <h3>Ce contenu n’est plus disponible</h3>
              <p>Le manga ou le chapitre lié à cet onglet n’existe plus dans la bibliothèque actuelle.</p>
              <div className="detail-actions-row" style={{ marginTop: 16 }}>
                <button className="ghost-button" onClick={popActiveView}>Retour</button>
                <button className="primary-button" onClick={() => replaceActiveView(normalizeView())}>Revenir à la bibliothèque</button>
              </div>
            </section>
          )}
        </div>
      </div>

      {batchCollectionOpen && (
        <BatchPickerModal
          title="Ajouter a une collection"
          subtitle="Choisis une collection pour tous les mangas selectionnes."
          items={allCollections}
          itemLabel={(item) => item.name}
          itemMeta={(item) => `${(item.mangaIds || []).length} manga(s)`}
          createLabel="Creer la collection"
          newItemPlaceholder="Nom de la collection"
          onCreate={async (name) => {
            await handleCreateCollection(name, '');
          }}
          onPick={(item) => handleBulkAddCollection(item.id)}
          onClose={() => setBatchCollectionOpen(false)}
        />
      )}

      {batchTagOpen && (
        <BatchPickerModal
          title="Ajouter un tag"
          subtitle="Applique un tag a toute la selection pour accelerer le tri."
          items={allTags}
          itemLabel={(item) => item.name}
          itemMeta={(item) => item.color || 'Tag'}
          createLabel="Creer le tag"
          newItemPlaceholder="Nom du tag"
          onCreate={async (name) => {
            await handleCreateTag(name, ui.accent || '#38bdf8');
          }}
          onPick={(item) => handleBulkAddTag(item.id)}
          onClose={() => setBatchTagOpen(false)}
        />
      )}

      {settingsOpen ? (
        <Suspense fallback={<LazyPanelPlaceholder label="Chargement des reglages..." />}>
          <SettingsDrawer
            open={settingsOpen}
            ui={ui}
            visualVariant={visualVariant}
            vault={vaultState}
            syncStatus={syncStatus}
            onClose={() => setSettingsOpen(false)}
            onChange={handleUpdateSettings}
            onRequestInterfaceMode={handleRequestInterfaceMode}
            onPickBackground={handlePickBackgroundImage}
            onRemoveBackground={handleRemoveBackgroundImage}
            onClearCache={handleClearCache}
            onForceRescan={handleForceRescan}
            onRetrySync={handleRetryBackgroundSync}
            onRunDeepScan={handleRunDeepScan}
            onRebuildDerivedData={handleRebuildDerivedData}
            onUpdateVaultPrefs={handleUpdateVaultPrefs}
            onLockVault={handleLockVault}
            onPanicLock={triggerPanicLock}
            plugins={plugins}
            pluginBusyId={pluginBusyId}
            pluginFeedback={pluginFeedback}
            sidebarSections={sidebarSections}
            sidebarHiddenSections={sidebarHiddenSections}
            showSources={webSourcesEnabled}
            onSetPluginEnabled={handleSetPluginEnabled}
            onInstallPlugin={handleInstallPlugin}
            onUninstallPlugin={handleUninstallPlugin}
            onOpenPlugin={handleOpenPlugin}
          />
        </Suspense>
      ) : null}

      <TextPromptModal
        open={textPromptState.open}
        title={textPromptState.title}
        description={textPromptState.description}
        label={textPromptState.label}
        defaultValue={textPromptState.defaultValue}
        placeholder={textPromptState.placeholder}
        confirmLabel={textPromptState.confirmLabel}
        cancelLabel={textPromptState.cancelLabel}
        onCancel={closeTextPrompt}
        onConfirm={async (value) => {
          await textPromptState.onConfirm?.(value);
          closeTextPrompt();
        }}
      />

      {editingMetadata && (
        <MetadataEditorModal
          manga={editingMetadata}
          onClose={() => setEditingMetadata(null)}
          onSave={handleSaveMetadata}
          onUpdateLocks={handleUpdateMetadataLocks}
          onImportComicInfo={handleImportComicInfoForManga}
          onExportComicInfo={handleExportComicInfoForManga}
          onOpenCoverManager={() => setCoverManagerManga(editingMetadata)}
        />
      )}

      {coverManagerManga && (
        <CoverManagerModal
          manga={coverManagerManga}
          onClose={() => setCoverManagerManga(null)}
          onChanged={() => refreshWith(window.mangaAPI.bootstrap())}
        />
      )}

      {tagManagerManga && (
        <TagManagerModal
          manga={tagManagerManga}
          allTags={payload?.persisted?.tags ?? {}}
          onToggleTag={handleToggleTag}
          onCreateTag={handleCreateTag}
          onDeleteTag={handleDeleteTag}
          onClose={() => setTagManagerManga(null)}
        />
      )}

      {collectionPickerManga && (
        <CollectionPickerModal
          manga={collectionPickerManga}
          collections={Object.values(payload?.persisted?.collections ?? {})}
          onToggleCollection={(colId) => {
            const col = (payload?.persisted?.collections ?? {})[colId];
            if (!col) return;
            const isIn = (col.mangaIds || []).includes(collectionPickerManga.id);
            if (isIn) {
              handleRemoveMangaFromCollection(colId, collectionPickerManga.id);
            } else {
              handleAddToCollection(collectionPickerManga.id, colId);
            }
          }}
          onCreateCollection={async (name) => {
            await handleCreateCollection(name, '');
            const updated = await window.mangaAPI.bootstrap();
            setPayload(updated);
            const newCols = Object.values(updated?.persisted?.collections ?? {});
            const newest = newCols.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
            if (newest) await handleAddToCollection(collectionPickerManga.id, newest.id);
          }}
          onClose={() => setCollectionPickerManga(null)}
        />
      )}

      {metadataSearchManga && (
        <OnlineMetadataSearchModal
          manga={metadataSearchManga}
          onImport={handleImportOnlineMetadata}
          onClose={() => setMetadataSearchManga(null)}
        />
      )}

      <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
      <ReliabilityNoticeCenter
        issues={reliabilityIssues}
        syncStatus={syncStatus}
        onRetry={handleRetryReliabilityIssue}
        onDismiss={handleDismissReliabilityIssue}
        onRetrySync={handleRetryBackgroundSync}
      />
      {relocationNotice ? (
        <aside className={`relocation-notice relocation-notice-${relocationNotice.kind}`} role="status" aria-live="polite">
          <div>
            <strong>{relocationNotice.title}</strong>
            <span>{relocationNotice.message}</span>
          </div>
          <div className="relocation-notice-actions">
            {relocationNotice.relocationId ? (
              <button type="button" onClick={() => handleUndoRelocation(relocationNotice.relocationId)}>Annuler</button>
            ) : null}
            {relocationNotice.kind !== 'working' ? (
              <button type="button" onClick={() => setRelocationNotice(null)}>Fermer</button>
            ) : null}
          </div>
        </aside>
      ) : null}
      </div>
      {interfaceTransitioning ? <div className="interface-transition-veil" aria-hidden="true" /> : null}
      {interfaceTransitionError ? <div className="interface-transition-error" role="alert">{interfaceTransitionError}</div> : null}
      </>
    </ShellErrorBoundary>
  );
}

function CollectionPickerModal({ manga, collections, onToggleCollection, onCreateCollection, onClose }) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState('');

  const filteredCollections = useMemo(() => {
    const query = collectionSearch.trim().toLowerCase();
    if (!query) return collections;
    return collections.filter((col) => {
      const name = (col?.name || '').toLowerCase();
      const description = (col?.description || '').toLowerCase();
      return name.includes(query) || description.includes(query);
    });
  }, [collections, collectionSearch]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel collection-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Collections — {manga.displayTitle}</h3>
        <p className="muted-text" style={{ margin: '0 0 12px' }}>Coche les collections auxquelles ajouter ce manga.</p>
        {collections.length > 0 && (
          <div className="modal-search-row">
            <SearchIcon size={15} />
            <input
              className="modal-search-input"
              value={collectionSearch}
              onChange={(e) => setCollectionSearch(e.target.value)}
              placeholder="Rechercher une collection"
            />
          </div>
        )}
        <div className="collection-picker-list">
          {collections.length === 0 && <p className="muted-text">Aucune collection. Crée-en une ci-dessous.</p>}
          {collections.length > 0 && filteredCollections.length === 0 && (
            <p className="muted-text modal-empty-state">Aucune collection ne correspond à la recherche.</p>
          )}
          {filteredCollections.map((col) => {
            const isIn = (col.mangaIds || []).includes(manga.id);
            return (
              <label key={col.id} className="collection-picker-item">
                <input type="checkbox" checked={isIn} onChange={() => onToggleCollection(col.id)} />
                <span>{col.name}</span>
                <small className="muted-text">{(col.mangaIds || []).length} manga{(col.mangaIds || []).length > 1 ? 's' : ''}</small>
              </label>
            );
          })}
        </div>
        {creating ? (
          <form className="collection-picker-create" onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            await onCreateCollection(newName.trim());
            setNewName('');
            setCreating(false);
          }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom de la collection" autoFocus />
            <button type="submit" className="primary-button" disabled={!newName.trim()}>Créer</button>
            <button type="button" className="ghost-button" onClick={() => setCreating(false)}>Annuler</button>
          </form>
        ) : (
          <button className="ghost-button" onClick={() => setCreating(true)} style={{ marginTop: 8 }}>
            <PlusIcon size={14} /> Nouvelle collection
          </button>
        )}
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

function OnlineMetadataSearchModal({ manga, onImport, onClose }) {
  const [query, setQuery] = useState(manga.displayTitle || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(null);

  async function handleSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await window.mangaAPI.searchOnlineMetadata(query.trim());
      setResults(response.results || []);
      if (response.error) setError(response.error);
    } catch (err) {
      setError(err?.message || 'Erreur réseau');
    }
    setLoading(false);
  }

  async function handleImport(item) {
    setImporting(item.malId);
    try {
      await onImport(manga.id, item);
      onClose();
    } catch (_) {
      setError("Erreur lors de l'import");
      setImporting(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Rechercher des métadonnées — {manga.displayTitle}</h3>
        <p className="muted-text">Les données importées sont copiées localement et restent disponibles hors ligne.</p>
        <form onSubmit={handleSearch} className="online-search-form">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un manga…" autoFocus />
          <button type="submit" className="primary-button" disabled={loading || !query.trim()}>
            {loading ? 'Recherche…' : 'Rechercher'}
          </button>
        </form>
        {error && <p className="muted-text" style={{ color: '#ef4444' }}>{error}</p>}
        <div className="online-results-list">
          {results.map((item) => (
            <div key={item.malId} className="online-result-card">
              <div className="online-result-cover">
                {(item.coverPreviewSrc || item.coverUrl) ? <img src={item.coverPreviewSrc || item.coverUrl} alt={item.title} /> : <div className="cover-fallback">?</div>}
              </div>
              <div className="online-result-info">
                <strong>{item.title}</strong>
                {item.titleJapanese && <small>{item.titleJapanese}</small>}
                {item.authors && <span className="muted-text">{item.authors}</span>}
                {item.synopsis && <p className="manga-description-clamp">{item.synopsis.slice(0, 200)}…</p>}
                <div className="online-result-meta">
                  {item.score && <span className="badge-pill">Score: {item.score}</span>}
                  {item.genres?.slice(0, 3).map((g) => <span key={g} className="badge-pill">{g}</span>)}
                </div>
              </div>
              <button
                className="primary-button online-result-import"
                onClick={() => handleImport(item)}
                disabled={importing === item.malId}
              >
                {importing === item.malId ? 'Import…' : 'Importer'}
              </button>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
