function references(entity = {}) {
  return [entity.id, entity.contentId, entity.locationId, entity.legacyId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function matchesReference(entity, reference) {
  const needle = String(reference || '').trim();
  return Boolean(needle) && references(entity).includes(needle);
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function updateLibraryManga(library, mangaReference, update) {
  if (!library || !Array.isArray(library.allMangas)) return { library, manga: null };
  let updatedManga = null;
  const allMangas = library.allMangas.map((manga) => {
    if (!matchesReference(manga, mangaReference)) return manga;
    updatedManga = update(manga);
    return updatedManga;
  });
  if (!updatedManga) return { library, manga: null };

  const categories = (library.categories || []).map((category) => {
    let changed = false;
    const mangas = (category.mangas || []).map((manga) => {
      if (!matchesReference(manga, mangaReference)) return manga;
      changed = true;
      return updatedManga;
    });
    return changed ? { ...category, mangas } : category;
  });

  return {
    manga: updatedManga,
    library: {
      ...library,
      allMangas,
      categories,
      favorites: allMangas.filter((manga) => manga.isFavorite)
    }
  };
}

function updatePayloadManga(payload, mangaReference, update) {
  if (!payload) return payload;
  const publicResult = updateLibraryManga(payload.library, mangaReference, update);
  const vaultResult = updateLibraryManga(payload.vaultLibrary, mangaReference, update);
  return {
    ...payload,
    library: publicResult.library,
    vaultLibrary: vaultResult.library,
    targetManga: publicResult.manga || vaultResult.manga || null
  };
}

function withoutMutationMetadata(payload) {
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'targetManga')) return payload;
  const { targetManga: _targetManga, ...clean } = payload;
  return clean;
}

function updatePersisted(payload, patch) {
  return {
    ...payload,
    persisted: {
      ...(payload.persisted || {}),
      ...patch
    }
  };
}

function recomputeMangaProgress(manga, chapters) {
  const completedChapterCount = chapters.filter((chapter) => chapter.isRead).length;
  const progressUnits = chapters.reduce((sum, chapter) => {
    if (chapter.isRead) return sum + 1;
    const pageIndex = Number(chapter.progress?.pageIndex || 0);
    const pageCount = Number(chapter.progress?.pageCount || chapter.pageCount || 0);
    return pageIndex > 0 && pageCount > 0 ? sum + Math.min(1, (pageIndex + 1) / pageCount) : sum;
  }, 0);
  const progressPercent = chapters.length > 0
    ? Math.max(0, Math.min(100, Math.round((progressUnits / chapters.length) * 100)))
    : 0;
  const isRead = chapters.length > 0 && completedChapterCount === chapters.length;
  const readingState = isRead ? 'read' : progressPercent > 0 ? 'in-progress' : 'never';
  return {
    ...manga,
    chapters,
    chapterCount: chapters.length || manga.chapterCount || 0,
    completedChapterCount,
    progressPercent,
    isRead,
    readingState,
    progress: {
      percent: progressPercent,
      completedChapterCount,
      totalChapterCount: chapters.length,
      lastChapterId: manga.progress?.lastChapterId || null
    }
  };
}

function findPayloadManga(payload, mangaReference) {
  return [payload?.library, payload?.vaultLibrary]
    .flatMap((library) => library?.allMangas || [])
    .find((manga) => matchesReference(manga, mangaReference)) || null;
}

export function captureReadMutationSnapshot(payload, mangaReference, chapterIds = []) {
  const manga = findPayloadManga(payload, mangaReference);
  if (!manga) return null;
  const targets = new Set(unique(chapterIds));
  const chapters = (manga.chapters || [])
    .filter((chapter) => targets.size === 0 || references(chapter).some((reference) => targets.has(reference)))
    .map((chapter) => ({
      references: references(chapter),
      isRead: Boolean(chapter.isRead),
      readingState: chapter.readingState,
      progress: chapter.progress ?? null
    }));
  return {
    mangaReference,
    isRead: Boolean(manga.isRead),
    readingState: manga.readingState,
    progressPercent: manga.progressPercent,
    completedChapterCount: manga.completedChapterCount,
    progress: manga.progress ?? null,
    chapters
  };
}

export function restoreReadMutationSnapshot(payload, snapshot) {
  if (!snapshot) return payload;
  return withoutMutationMetadata(updatePayloadManga(payload, snapshot.mangaReference, (manga) => {
    const chapters = (manga.chapters || []).map((chapter) => {
      const previous = snapshot.chapters.find((entry) => (
        entry.references.some((reference) => references(chapter).includes(reference))
      ));
      return previous
        ? {
            ...chapter,
            isRead: previous.isRead,
            readingState: previous.readingState,
            progress: previous.progress
          }
        : chapter;
    });
    return {
      ...manga,
      chapters,
      isRead: snapshot.isRead,
      readingState: snapshot.readingState,
      progressPercent: snapshot.progressPercent,
      completedChapterCount: snapshot.completedChapterCount,
      progress: snapshot.progress
    };
  }));
}

function restoreListEntry(list, predicate, entry, index) {
  const next = (Array.isArray(list) ? list : []).filter((item) => !predicate(item));
  if (!entry) return next;
  next.splice(Math.max(0, Math.min(Number(index || 0), next.length)), 0, entry);
  return next;
}

export function captureReaderProgressSnapshot(payload, progressPayload, options = {}) {
  const manga = findPayloadManga(payload, progressPayload?.mangaId);
  const chapterId = progressPayload?.chapterId;
  const persistedProgress = payload?.persisted?.progress || {};
  const persistedRecents = payload?.persisted?.recents || [];
  const libraryRecents = payload?.library?.recents || [];
  const persistedRecentIndex = persistedRecents.findIndex((entry) => entry?.chapterId === chapterId);
  const libraryRecentIndex = libraryRecents.findIndex((entry) => entry?.chapterId === chapterId);
  return {
    mangaReference: progressPayload?.mangaId,
    chapterId,
    read: captureReadMutationSnapshot(payload, progressPayload?.mangaId, [chapterId]),
    lastProgress: manga?.lastProgress ?? null,
    lastReadAt: manga?.lastReadAt ?? null,
    hadPersistedProgress: Object.prototype.hasOwnProperty.call(persistedProgress, chapterId),
    persistedProgress: persistedProgress[chapterId],
    persistedRecent: persistedRecentIndex >= 0 ? persistedRecents[persistedRecentIndex] : null,
    persistedRecentIndex,
    libraryRecent: libraryRecentIndex >= 0 ? libraryRecents[libraryRecentIndex] : null,
    libraryRecentIndex,
    readerUi: options.profile === 'kavita'
      ? null
      : {
          readerMode: payload?.persisted?.ui?.readerMode,
          readerFit: payload?.persisted?.ui?.readerFit,
          readerZoom: payload?.persisted?.ui?.readerZoom
        }
  };
}

export function restoreReaderProgressSnapshot(payload, snapshot) {
  if (!snapshot) return payload;
  let restored = restoreReadMutationSnapshot(payload, snapshot.read);
  restored = withoutMutationMetadata(updatePayloadManga(restored, snapshot.mangaReference, (manga) => ({
    ...manga,
    lastProgress: snapshot.lastProgress,
    lastReadAt: snapshot.lastReadAt
  })));
  const progress = { ...(restored?.persisted?.progress || {}) };
  if (snapshot.hadPersistedProgress) progress[snapshot.chapterId] = snapshot.persistedProgress;
  else delete progress[snapshot.chapterId];
  const persistedRecents = restoreListEntry(
    restored?.persisted?.recents,
    (entry) => entry?.chapterId === snapshot.chapterId,
    snapshot.persistedRecent,
    snapshot.persistedRecentIndex
  );
  const ui = snapshot.readerUi
    ? { ...(restored?.persisted?.ui || {}), ...snapshot.readerUi }
    : restored?.persisted?.ui;
  return {
    ...restored,
    persisted: {
      ...(restored?.persisted || {}),
      progress,
      recents: persistedRecents,
      ui
    },
    library: restored?.library
      ? {
          ...restored.library,
          recents: restoreListEntry(
            restored.library.recents,
            (entry) => entry?.chapterId === snapshot.chapterId,
            snapshot.libraryRecent,
            snapshot.libraryRecentIndex
          )
        }
      : restored?.library
  };
}

export function applyReaderProgressMutation(payload, progressPayload, options = {}) {
  if (!payload || !progressPayload?.chapterId || !progressPayload?.mangaId) return payload;
  const now = options.now || new Date().toISOString();
  const persistedPrevious = payload?.persisted?.progress?.[progressPayload.chapterId] || null;
  const mergedProgress = {
    ...(persistedPrevious || {}),
    ...progressPayload,
    pageIndex: Math.max(0, Number(progressPayload.pageIndex) || 0),
    furthestPageIndex: Math.max(
      Number(persistedPrevious?.furthestPageIndex ?? persistedPrevious?.pageIndex) || 0,
      Number(progressPayload.furthestPageIndex ?? progressPayload.pageIndex) || 0
    ),
    lastReadAt: now
  };
  const threshold = Number(payload?.persisted?.ui?.autoMarkReadThreshold ?? 95);
  const reachedThreshold = Number(mergedProgress.pageCount) > 0
    && (((mergedProgress.furthestPageIndex + 1) / mergedProgress.pageCount) * 100) >= threshold;
  const changed = updatePayloadManga(payload, progressPayload.mangaId, (manga) => {
    const chapters = (manga.chapters || []).map((chapter) => {
      if (!matchesReference(chapter, progressPayload.chapterId)) return chapter;
      const isRead = Boolean(chapter.isRead || chapter.readingState === 'read' || reachedThreshold);
      return {
        ...chapter,
        progress: mergedProgress,
        isRead,
        readingState: isRead ? 'read' : 'in-progress'
      };
    });
    return {
      ...recomputeMangaProgress(manga, chapters),
      lastProgress: mergedProgress,
      lastReadAt: now
    };
  });
  const clean = withoutMutationMetadata(changed);
  const progress = {
    ...(clean?.persisted?.progress || {}),
    [progressPayload.chapterId]: mergedProgress
  };
  const recents = [
    {
      mangaId: progressPayload.mangaId,
      chapterId: progressPayload.chapterId,
      pageIndex: progressPayload.pageIndex,
      lastReadAt: now
    },
    ...(clean?.persisted?.recents || []).filter((entry) => entry.chapterId !== progressPayload.chapterId)
  ].slice(0, 30);
  const targetManga = findPayloadManga(clean, progressPayload.mangaId);
  const targetChapter = targetManga?.chapters?.find((chapter) => matchesReference(chapter, progressPayload.chapterId));
  const recentView = targetManga && targetChapter
    ? {
        ...recents[0],
        mangaTitle: targetManga.displayTitle,
        mangaCoverSrc: targetManga.coverSrc,
        chapterName: targetChapter.name,
        categoryName: targetManga.categoryName
      }
    : recents[0];
  const ui = options.profile === 'kavita'
    ? clean?.persisted?.ui
    : {
        ...(clean?.persisted?.ui || {}),
        readerMode: progressPayload.mode,
        readerFit: progressPayload.fitMode ?? clean?.persisted?.ui?.readerFit,
        readerZoom: Number.isFinite(Number(progressPayload.zoom))
          ? Number(progressPayload.zoom)
          : (clean?.persisted?.ui?.readerZoom ?? 1)
      };
  return {
    ...clean,
    persisted: { ...(clean.persisted || {}), progress, recents, ui },
    library: clean.library
      ? {
          ...clean.library,
          recents: [
            recentView,
            ...(clean.library.recents || []).filter((entry) => entry.chapterId !== progressPayload.chapterId)
          ].filter(Boolean).slice(0, 20)
        }
      : clean.library
  };
}

export function applyFavoriteMutation(payload, mangaReference, isFavorite) {
  const changed = updatePayloadManga(payload, mangaReference, (manga) => ({ ...manga, isFavorite: Boolean(isFavorite) }));
  const mangaId = changed.targetManga?.id;
  if (!mangaId) return withoutMutationMetadata(changed);
  const favorites = { ...(changed.persisted?.favorites || {}) };
  if (isFavorite) favorites[mangaId] = true;
  else delete favorites[mangaId];
  return withoutMutationMetadata(updatePersisted(changed, { favorites }));
}

export function applyTagMutation(payload, mangaReference, tagId, isAssigned) {
  const tag = payload?.persisted?.tags?.[tagId] || null;
  const changed = updatePayloadManga(payload, mangaReference, (manga) => {
    const tagIds = unique([...(manga.tagIds || manga.tags?.map((entry) => entry.id) || [])]);
    const nextIds = isAssigned ? unique([...tagIds, tagId]) : tagIds.filter((id) => id !== tagId);
    const tagsById = new Map((manga.tags || []).map((entry) => [entry.id, entry]));
    if (tag) tagsById.set(tagId, tag);
    return {
      ...manga,
      tagIds: nextIds,
      tags: nextIds.map((id) => tagsById.get(id) || payload?.persisted?.tags?.[id]).filter(Boolean)
    };
  });
  const mangaId = changed.targetManga?.id;
  if (!mangaId) return withoutMutationMetadata(changed);
  return withoutMutationMetadata(updatePersisted(changed, {
    mangaTags: {
      ...(changed.persisted?.mangaTags || {}),
      [mangaId]: changed.targetManga.tagIds
    }
  }));
}

export function applyCollectionMutation(payload, mangaReference, collectionId, isAssigned) {
  const changed = updatePayloadManga(payload, mangaReference, (manga) => {
    const current = unique(manga.collectionIds || []);
    return {
      ...manga,
      collectionIds: isAssigned ? unique([...current, collectionId]) : current.filter((id) => id !== collectionId)
    };
  });
  const mangaId = changed.targetManga?.id;
  const collection = changed.persisted?.collections?.[collectionId];
  if (!mangaId || !collection) return withoutMutationMetadata(changed);
  const currentIds = unique(collection.mangaIds || []);
  const mangaIds = isAssigned ? unique([...currentIds, mangaId]) : currentIds.filter((id) => id !== mangaId);
  return withoutMutationMetadata(updatePersisted(changed, {
    collections: {
      ...(changed.persisted?.collections || {}),
      [collectionId]: { ...collection, mangaIds }
    }
  }));
}

export function applyChapterReadMutation(payload, mangaReference, chapterId, isRead, pageCount = 0) {
  return withoutMutationMetadata(updatePayloadManga(payload, mangaReference, (manga) => {
    const chapters = (manga.chapters || []).map((chapter) => {
      if (!matchesReference(chapter, chapterId)) return chapter;
      const resolvedPageCount = Math.max(0, Number(pageCount || chapter.pageCount || 0));
      return {
        ...chapter,
        isRead: Boolean(isRead),
        readingState: isRead ? 'read' : 'never',
        progress: isRead
          ? { ...(chapter.progress || {}), mangaId: manga.id, chapterId: chapter.id, pageIndex: Math.max(0, resolvedPageCount - 1), pageCount: resolvedPageCount }
          : null
      };
    });
    return recomputeMangaProgress(manga, chapters);
  }));
}

export function applyMangaReadMutation(payload, mangaReference, isRead, chapterIds = []) {
  const targets = new Set(unique(chapterIds));
  return withoutMutationMetadata(updatePayloadManga(payload, mangaReference, (manga) => {
    const chapters = (manga.chapters || []).map((chapter) => {
      if (targets.size > 0 && !references(chapter).some((reference) => targets.has(reference))) return chapter;
      const pageCount = Math.max(0, Number(chapter.pageCount || chapter.progress?.pageCount || 0));
      return {
        ...chapter,
        isRead: Boolean(isRead),
        readingState: isRead ? 'read' : 'never',
        progress: isRead
          ? { ...(chapter.progress || {}), mangaId: manga.id, chapterId: chapter.id, pageIndex: Math.max(0, pageCount - 1), pageCount }
          : null
      };
    });
    const recomputed = recomputeMangaProgress(manga, chapters);
    return targets.size === 0
      ? { ...recomputed, isRead: Boolean(isRead), readingState: isRead ? 'read' : 'never', progressPercent: isRead ? 100 : 0 }
      : recomputed;
  }));
}
