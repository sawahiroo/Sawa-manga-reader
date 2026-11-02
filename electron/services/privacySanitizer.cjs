const SEARCH_PRIVACY_VERSION = 1;

function blankSearchState() {
  return { query: '', scope: 'current', filters: [] };
}

function tabContainsPrivateReference(tab, privateIds, privateChapters) {
  const views = [
    ...(Array.isArray(tab?.stack) ? tab.stack : []),
    tab?.view
  ].filter(Boolean);
  return views.some((view) => (
    privateIds.has(String(view?.mangaId || ''))
    || privateChapters.has(String(view?.chapterId || ''))
  ));
}

function sanitizeSessionSearchPrivacy(session, {
  vaultLocked = false,
  privateMangaIds = new Set(),
  privateChapterIds = new Set()
} = {}) {
  const sourcePrivacyVersion = Number(session?.searchPrivacyVersion || 0);
  const requiresSearchPrivacyMigration = sourcePrivacyVersion < SEARCH_PRIVACY_VERSION;
  const privateIds = new Set([...privateMangaIds].map((value) => String(value || '').trim()).filter(Boolean));
  const privateChapters = new Set([...privateChapterIds].map((value) => String(value || '').trim()).filter(Boolean));
  const sanitizeTab = (tab) => {
    if (!tab || typeof tab !== 'object') return tab;
    const privateTab = Boolean(tab.searchPrivate)
      || tabContainsPrivateReference(tab, privateIds, privateChapters);
    const maskSearch = requiresSearchPrivacyMigration
      || Boolean(tab.incognito)
      || Boolean(tab.searchPrivate)
      || (vaultLocked && privateTab);
    if (!maskSearch) return { ...tab };
    const { search: _legacySearch, ...safeTab } = tab;
    return {
      ...safeTab,
      searchPrivate: false,
      searchState: blankSearchState()
    };
  };
  const sanitized = {
    ...(session && typeof session === 'object' ? session : {}),
    searchPrivacyVersion: SEARCH_PRIVACY_VERSION
  };
  if (Array.isArray(sanitized.workspaces)) {
    sanitized.workspaces = sanitized.workspaces.map((workspace) => ({
      ...workspace,
      tabs: (Array.isArray(workspace?.tabs) ? workspace.tabs : []).map(sanitizeTab)
    }));
  }
  if (Array.isArray(sanitized.tabs)) {
    sanitized.tabs = sanitized.tabs.map(sanitizeTab);
  }
  return sanitized;
}

function sanitizePrivateMangaReferences(clientState, privateMangaIds = new Set(), privateChapterIds = new Set()) {
  const privateIds = new Set([...privateMangaIds].map((value) => String(value || '').trim()).filter(Boolean));
  const privateChapters = new Set([...privateChapterIds].map((value) => String(value || '').trim()).filter(Boolean));
  const keyedRecords = [
    'metadata',
    'metadataLocks',
    'metadataFieldSource',
    'favorites',
    'readingStates',
    'readStatus',
    'mangaTags',
    'mangaTagMeta',
    'annotations',
    'knownChapterCounts',
    'readerPrefs',
    'coverProfiles'
  ];
  for (const mangaId of privateIds) {
    keyedRecords.forEach((key) => { delete clientState[key]?.[mangaId]; });
  }
  for (const chapterId of privateChapters) {
    ['chapterStates', 'chapterReadStatus', 'progress'].forEach((key) => { delete clientState[key]?.[chapterId]; });
  }

  for (const collection of Object.values(clientState.collections || {})) {
    collection.mangaIds = (collection.mangaIds || []).filter((mangaId) => !privateIds.has(String(mangaId)));
    if (collection.appearance) {
      collection.appearance.featuredMangaIds = (collection.appearance.featuredMangaIds || [])
        .filter((mangaId) => !privateIds.has(String(mangaId)));
    }
  }
  for (const collection of Object.values(clientState.smartCollections || {})) {
    if (collection.appearance) {
      collection.appearance.featuredMangaIds = (collection.appearance.featuredMangaIds || [])
        .filter((mangaId) => !privateIds.has(String(mangaId)));
    }
  }

  clientState.recents = (clientState.recents || []).filter((entry) => !privateIds.has(String(entry?.mangaId)));
  clientState.metadataWorkbenchQueue = (clientState.metadataWorkbenchQueue || [])
    .filter((mangaId) => !privateIds.has(String(mangaId)));
  clientState.metadataWorkbenchItems = (clientState.metadataWorkbenchItems || [])
    .filter((item) => !privateIds.has(String(item?.mangaId)));
  if (Array.isArray(clientState.metadataWorkbenchLastBatch?.entries)) {
    clientState.metadataWorkbenchLastBatch.entries = clientState.metadataWorkbenchLastBatch.entries
      .filter((entry) => !privateIds.has(String(entry?.mangaId)));
    if (clientState.metadataWorkbenchLastBatch.entries.length === 0) clientState.metadataWorkbenchLastBatch = null;
  }
  clientState.readingQueue = (clientState.readingQueue || [])
    .filter((item) => !privateIds.has(String(item?.mangaId)));

  const sanitizeTab = (tab) => {
    if (!tab || typeof tab !== 'object') return tab;
    const isPrivateView = (view) => (
      privateIds.has(String(view?.mangaId || ''))
      || privateChapters.has(String(view?.chapterId || ''))
    );
    const hadPrivateView = tabContainsPrivateReference(tab, privateIds, privateChapters);
    const stack = (Array.isArray(tab.stack) ? tab.stack : []).filter((view) => !isPrivateView(view));
    const view = isPrivateView(tab.view)
      ? { screen: 'library', mangaId: null, chapterId: null, pageIndex: 0 }
      : tab.view;
    const { search: _legacySearch, ...safeTab } = tab;
    return {
      ...safeTab,
      ...(hadPrivateView || tab.searchPrivate || tab.incognito
        ? { searchState: blankSearchState(), searchPrivate: false }
        : {}),
      ...(Array.isArray(tab.stack) ? { stack: stack.length ? stack : [{ screen: 'library', mangaId: null, chapterId: null, pageIndex: 0 }] } : {}),
      ...(tab.view ? { view } : {})
    };
  };
  if (Array.isArray(clientState.session?.workspaces)) {
    clientState.session.workspaces = clientState.session.workspaces.map((workspace) => ({
      ...workspace,
      tabs: (workspace.tabs || []).map(sanitizeTab)
    }));
  }
  if (Array.isArray(clientState.session?.tabs)) {
    clientState.session.tabs = clientState.session.tabs.map(sanitizeTab);
  }
  if (clientState.session?.scrollPositions && typeof clientState.session.scrollPositions === 'object') {
    clientState.session.scrollPositions = Object.fromEntries(
      Object.entries(clientState.session.scrollPositions).filter(([key, position]) => (
        !privateIds.has(String(position?.anchorId || ''))
        && !privateChapters.has(String(position?.anchorId || ''))
        && ![...privateIds].some((mangaId) => String(key).includes(mangaId))
        && ![...privateChapters].some((chapterId) => String(key).includes(chapterId))
      ))
    );
  }
  return clientState;
}

module.exports = {
  SEARCH_PRIVACY_VERSION,
  blankSearchState,
  sanitizeSessionSearchPrivacy,
  sanitizePrivateMangaReferences
};
