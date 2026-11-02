function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function normalizeText(value) {
  return String(value || '').trim();
}

function toFileSrc(absolutePath) {
  return `manga://local/${encodeURIComponent(absolutePath)}`;
}

function candidateIds(entity = {}) {
  return [entity.id, entity.contentId, entity.locationId, entity.legacyId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function getByEntityId(mapLike, entity = {}) {
  if (!mapLike || typeof mapLike !== 'object') return undefined;
  for (const id of candidateIds(entity)) {
    if (Object.prototype.hasOwnProperty.call(mapLike, id)) return mapLike[id];
  }
  return undefined;
}

function hasEntityFlag(mapLike, entity = {}) {
  return Boolean(getByEntityId(mapLike, entity));
}

function hasAnyId(values = [], entity = {}) {
  const ids = new Set(candidateIds(entity));
  return (Array.isArray(values) ? values : []).some((value) => ids.has(String(value || '').trim()));
}

function resolveMetadata(manga = {}, persistedState = {}) {
  return getByEntityId(persistedState.metadata, manga) || {};
}

function resolveTagsForManga(manga = {}, persistedState = {}) {
  const allTags = persistedState.tags || {};
  const tagIds = uniqueStrings(getByEntityId(persistedState.mangaTags, manga));
  const tagMeta = getByEntityId(persistedState.mangaTagMeta, manga) || {};
  const allowNsfwTags = Boolean(persistedState.ui?.allowNsfwSources);
  return tagIds
    .map((tagId) => {
      const tag = allTags[tagId];
      if (!tag) return null;
      if (!allowNsfwTags && tagMeta?.[tagId]?.nsfw) return null;
      return tag;
    })
    .filter(Boolean);
}

function resolveCollectionIdsForManga(manga = {}, persistedState = {}) {
  return Object.entries(persistedState.collections || {})
    .filter(([, collection]) => hasAnyId(collection?.mangaIds, manga))
    .map(([collectionId]) => collectionId);
}

function resolveChapterProgress(chapter = {}, persistedState = {}) {
  return getByEntityId(persistedState.progress, chapter) || null;
}

function resolveExplicitChapterState(chapter = {}, persistedState = {}) {
  return getByEntityId(persistedState.chapterStates, chapter);
}

function isChapterMarkedRead(chapter = {}, persistedState = {}) {
  return hasEntityFlag(persistedState.chapterReadStatus, chapter);
}

function deriveChapterReadingState(chapter = {}, persistedState = {}) {
  const explicit = resolveExplicitChapterState(chapter, persistedState);
  if (explicit === 'read') return 'read';
  if (explicit === 'in-progress') return 'in-progress';

  if (isChapterMarkedRead(chapter, persistedState)) return 'read';

  const progress = resolveChapterProgress(chapter, persistedState);
  const furthestPageIndex = Number(progress?.furthestPageIndex ?? progress?.pageIndex) || 0;
  if (progress && Number(progress.pageCount || 0) > 0 && furthestPageIndex >= Number(progress.pageCount || 0) - 1) {
    return 'read';
  }
  if (progress && Number(progress.pageIndex || 0) > 0) return 'in-progress';

  return 'never';
}

function resolveExplicitMangaState(manga = {}, persistedState = {}) {
  return getByEntityId(persistedState.readingStates, manga);
}

function deriveMangaReadingState(manga = {}, chapters = [], persistedState = {}) {
  const explicit = resolveExplicitMangaState(manga, persistedState);
  if (explicit === 'to-resume') return 'to-resume';
  if (hasEntityFlag(persistedState.readStatus, manga)) return 'read';
  if (chapters.length === 0) return 'never';
  if (chapters.every((chapter) => chapter.readingState === 'read')) return 'read';
  if (chapters.some((chapter) => chapter.readingState !== 'never')) return 'in-progress';
  if (explicit === 'in-progress') return 'in-progress';
  return 'never';
}

function applyMetadataOverlay(manga = {}, metadata = {}) {
  const displayTitle = normalizeText(metadata.title)
    || normalizeText(metadata.onlineTitle)
    || manga.displayTitle
    || manga.name
    || '';
  const aliases = uniqueStrings([
    ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
    ...(Array.isArray(metadata.onlineAltTitles) ? metadata.onlineAltTitles : []),
    ...(Array.isArray(manga.aliases) ? manga.aliases : [])
  ]).filter((value) => value.toLowerCase() !== String(displayTitle).toLowerCase());

  const coverPath = normalizeText(metadata.coverPath);
  const onlineCoverPath = normalizeText(metadata.onlineCoverPath);
  const next = {
    ...manga,
    displayTitle,
    author: normalizeText(metadata.author) || normalizeText(metadata.onlineAuthor) || manga.author || '',
    description: normalizeText(metadata.description) || normalizeText(metadata.onlineDescription) || manga.description || '',
    aliases
  };

  if (metadata.coverMode === 'auto') {
    const firstChapter = manga.chapters?.[0] || null;
    next.coverSrc = firstChapter?.previewSrc || null;
    next.coverType = firstChapter ? 'auto' : 'default';
    next.coverMediaType = firstChapter?.previewMediaType || 'image';
    next.coverFilePath = firstChapter?.previewFilePath || (firstChapter?.previewMediaType === 'pdf' ? firstChapter?.path : null);
    next.coverPageNumber = firstChapter?.previewPageNumber || 1;
  } else if (coverPath || onlineCoverPath) {
    const finalCoverPath = coverPath || onlineCoverPath;
    next.coverSrc = toFileSrc(finalCoverPath);
    next.coverType = coverPath ? 'custom' : 'online';
    next.coverMediaType = 'image';
    next.coverFilePath = finalCoverPath;
    next.coverPageNumber = 1;
  }

  return next;
}

function overlayChapter(chapter = {}, persistedState = {}) {
  const progress = resolveChapterProgress(chapter, persistedState);
  const readingState = deriveChapterReadingState(chapter, persistedState);
  return {
    ...chapter,
    progress,
    isRead: readingState === 'read',
    readingState
  };
}

function computeMangaProgress(chapters = []) {
  const completedChapterCount = chapters.filter((chapter) => chapter.isRead).length;
  const progressUnits = chapters.reduce((sum, chapter) => {
    if (chapter.isRead) return sum + 1;
    if (chapter.progress?.pageCount) {
      const ratio = Math.max(0, Math.min(1, (Number(chapter.progress.pageIndex || 0) + 1) / Number(chapter.progress.pageCount || 1)));
      return sum + ratio;
    }
    return sum;
  }, 0);
  const progressPercent = chapters.length
    ? Math.max(0, Math.min(100, Math.round((progressUnits / chapters.length) * 100)))
    : 0;
  const lastProgress = chapters
    .map((chapter) => chapter.progress)
    .filter(Boolean)
    .sort((left, right) => new Date(right.lastReadAt || 0).getTime() - new Date(left.lastReadAt || 0).getTime())[0] || null;

  return {
    completedChapterCount,
    progressPercent,
    lastProgress,
    progress: {
      percent: progressPercent,
      completedChapterCount,
      totalChapterCount: chapters.length,
      lastChapterId: lastProgress?.chapterId ?? null
    }
  };
}

function overlayManga(manga = {}, persistedState = {}) {
  const metadata = resolveMetadata(manga, persistedState);
  const chapters = (Array.isArray(manga.chapters) ? manga.chapters : []).map((chapter) => overlayChapter(chapter, persistedState));
  const progress = computeMangaProgress(chapters);
  const readingState = deriveMangaReadingState(manga, chapters, persistedState);
  const withMetadata = applyMetadataOverlay(manga, metadata);
  const chapterCount = chapters.length || Number(manga.chapterCount || 0);
  const knownCount = getByEntityId(persistedState.knownChapterCounts, manga);

  return {
    ...withMetadata,
    chapterCount,
    chapters,
    completedChapterCount: progress.completedChapterCount,
    progressPercent: progress.progressPercent,
    progress: progress.progress,
    lastProgress: progress.lastProgress,
    lastReadAt: progress.lastProgress?.lastReadAt ?? null,
    isFavorite: hasEntityFlag(persistedState.favorites, manga),
    isRead: readingState === 'read',
    readingState,
    tags: resolveTagsForManga(manga, persistedState),
    collectionIds: resolveCollectionIdsForManga(manga, persistedState),
    hasNewChapters: typeof knownCount === 'number' && chapterCount > knownCount,
    metadataLocks: getByEntityId(persistedState.metadataLocks, manga) || {},
    metadataFieldSource: getByEntityId(persistedState.metadataFieldSource, manga) || {},
    coverProfile: getByEntityId(persistedState.coverProfiles, manga) || null
  };
}

function buildRecentEntries(recents = [], mangaById = new Map()) {
  return [...(Array.isArray(recents) ? recents : [])]
    .sort((left, right) => new Date(right.lastReadAt || 0).getTime() - new Date(left.lastReadAt || 0).getTime())
    .slice(0, 20)
    .map((recent) => {
      const manga = mangaById.get(recent.mangaId) || mangaById.get(recent.mangaContentId);
      if (!manga) return null;
      const chapter = (manga.chapters || []).find((item) => (
        item.id === recent.chapterId
        || item.contentId === recent.chapterId
        || item.locationId === recent.chapterId
      ));
      if (!chapter) return null;
      return {
        ...recent,
        mangaId: manga.id,
        chapterId: chapter.id,
        mangaTitle: manga.displayTitle,
        mangaCoverSrc: manga.coverSrc,
        chapterName: chapter.name,
        categoryName: manga.categoryName,
        mangaContentId: manga.contentId,
        chapterContentId: chapter.contentId
      };
    })
    .filter(Boolean);
}

function indexMangaAliases(mangaById, manga) {
  for (const id of candidateIds(manga)) {
    mangaById.set(id, manga);
  }
}

function applyPersistedOverlayToLibrary(rawLibrary, persistedState = {}) {
  if (!rawLibrary || typeof rawLibrary !== 'object') {
    return { categories: [], allMangas: [], favorites: [], recents: [], scanIndex: { updatedAt: null, entries: [] } };
  }

  const mangaById = new Map();
  const categories = (Array.isArray(rawLibrary.categories) ? rawLibrary.categories : []).map((category) => {
    const persistedCategory = (persistedState.categories || []).find((entry) => entry.id === category.id) || {};
    const mangas = (Array.isArray(category.mangas) ? category.mangas : []).map((manga) => {
      const overlaid = overlayManga({
        ...manga,
        categoryId: category.id,
        categoryName: category.name,
        categoryHidden: Boolean(persistedCategory.hidden ?? category.hidden)
      }, persistedState);
      indexMangaAliases(mangaById, overlaid);
      return overlaid;
    });
    return {
      ...category,
      hidden: Boolean(persistedCategory.hidden ?? category.hidden),
      mangas,
      mangaCount: mangas.length
    };
  });

  const allMangas = categories.flatMap((category) => category.mangas);
  const favorites = allMangas.filter((manga) => manga.isFavorite);
  const recents = buildRecentEntries(persistedState.recents, mangaById);

  return {
    ...rawLibrary,
    categories,
    allMangas,
    favorites,
    recents
  };
}

function buildInteractiveLibraryPayload({ rawLibrary, persisted, scanLibrary }) {
  const hasSnapshot = Boolean(rawLibrary && Array.isArray(rawLibrary.allMangas));
  const baseLibrary = hasSnapshot ? rawLibrary : scanLibrary(persisted);
  return {
    rawLibrary: applyPersistedOverlayToLibrary(baseLibrary, persisted),
    usedSnapshot: hasSnapshot
  };
}

module.exports = {
  applyPersistedOverlayToLibrary,
  buildInteractiveLibraryPayload
};
