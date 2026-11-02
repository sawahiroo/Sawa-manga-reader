const fs = require('fs');
const path = require('path');
const { remapPersistedReferences } = require('./identityWorks.cjs');

function normalizePath(value) {
  return path.resolve(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function isPathInside(candidate, root) {
  const resolvedCandidate = normalizePath(candidate);
  const resolvedRoot = normalizePath(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function rebasePath(value, fromRoot, toRoot) {
  if (!value || !isPathInside(value, fromRoot)) return value;
  const relative = path.relative(path.resolve(fromRoot), path.resolve(value));
  const next = path.resolve(toRoot, relative);
  return fs.existsSync(next) ? next : value;
}

function byContentId(items = []) {
  const result = new Map();
  for (const item of items || []) {
    const contentId = String(item?.contentId || '').trim();
    if (!contentId) continue;
    const list = result.get(contentId) || [];
    list.push(item);
    result.set(contentId, list);
  }
  return result;
}

function normalizeLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function resolveUniqueContentCandidate(previousItem, candidates = []) {
  if (candidates.length <= 1) return candidates;
  const previousLabels = new Set([
    normalizeLabel(previousItem?.name),
    normalizeLabel(previousItem?.displayTitle)
  ].filter(Boolean));
  if (!previousLabels.size) return candidates;
  const labelMatches = candidates.filter((candidate) => (
    previousLabels.has(normalizeLabel(candidate?.name))
    || previousLabels.has(normalizeLabel(candidate?.displayTitle))
  ));
  return labelMatches.length > 0 ? labelMatches : candidates;
}

function resolveExactStructureCandidates(previousItem, candidates = []) {
  const previousName = normalizeLabel(previousItem?.name);
  const previousTitle = normalizeLabel(previousItem?.displayTitle);
  if (!previousName && !previousTitle) return [];
  return candidates.filter((candidate) => {
    const candidateName = normalizeLabel(candidate?.name);
    const candidateTitle = normalizeLabel(candidate?.displayTitle);
    return Boolean(
      (previousName && candidateName === previousName)
      || (previousName && candidateTitle === previousName)
      || (previousTitle && candidateName === previousTitle)
      || (previousTitle && candidateTitle === previousTitle)
    );
  });
}

function resolveRelocationCandidates(previousItem, contentCandidates = [], allCandidates = []) {
  const fingerprintMatches = resolveUniqueContentCandidate(previousItem, contentCandidates);
  const structureMatches = resolveExactStructureCandidates(previousItem, allCandidates);
  if (structureMatches.length === 1 && (
    fingerprintMatches.length !== 1
    || String(fingerprintMatches[0]?.id) !== String(structureMatches[0]?.id)
  )) {
    return { candidates: structureMatches, matchMethod: 'structure' };
  }
  if (fingerprintMatches.length > 0) {
    return { candidates: fingerprintMatches, matchMethod: 'content' };
  }
  return {
    candidates: structureMatches,
    matchMethod: 'structure'
  };
}

function getScanEntries(scanIndex) {
  if (Array.isArray(scanIndex?.entries)) return scanIndex.entries;
  if (scanIndex?.entries && typeof scanIndex.entries === 'object') return Object.values(scanIndex.entries);
  return [];
}

function preserveUnavailableLibraryEntries(scannedLibrary, previousLibrary, persistedState) {
  if (!scannedLibrary || !previousLibrary) return scannedLibrary;
  const previousByCategory = new Map((previousLibrary.categories || []).map((category) => [String(category.id), category]));
  const unavailableRoots = [];
  const categories = (scannedLibrary.categories || []).map((category) => {
    if (category?.exists !== false) return { ...category, availability: 'available', unavailable: false };
    unavailableRoots.push(category.path);
    const previous = previousByCategory.get(String(category.id));
    if (!previous) return { ...category, availability: 'missing', unavailable: true };
    const mangas = (previous.mangas || []).map((manga) => ({
      ...manga,
      categoryId: category.id,
      categoryName: category.name,
      categoryHidden: Boolean(category.hidden),
      categoryUnavailable: true,
      readOnly: true
    }));
    return { ...previous, ...category, mangas, mangaCount: mangas.length, availability: 'missing', unavailable: true };
  });
  if (unavailableRoots.length === 0) return { ...scannedLibrary, categories };
  const allMangas = categories.flatMap((category) => (category.mangas || []).map((manga) => ({
    ...manga,
    categoryId: category.id,
    categoryName: category.name,
    categoryHidden: Boolean(category.hidden),
    categoryUnavailable: category.exists === false || Boolean(category.unavailable),
    readOnly: category.exists === false || Boolean(category.unavailable)
  })));
  const entriesByPath = new Map(getScanEntries(scannedLibrary.scanIndex).map((entry) => [normalizePath(entry?.path), entry]));
  getScanEntries(persistedState?.scanIndex)
    .filter((entry) => unavailableRoots.some((root) => isPathInside(entry?.path, root)))
    .forEach((entry) => entriesByPath.set(normalizePath(entry?.path), entry));
  const mangaIds = new Set(allMangas.map((manga) => String(manga.id)));
  return {
    ...scannedLibrary,
    categories,
    allMangas,
    favorites: allMangas.filter((manga) => manga.isFavorite),
    recents: (previousLibrary.recents || []).filter((recent) => mangaIds.has(String(recent?.mangaId))),
    scanIndex: { ...(scannedLibrary.scanIndex || {}), entries: [...entriesByPath.values()] }
  };
}

function createCategoryRelocationPlan({ category, previousCategory, nextCategory, targetPath, stateRevision = 0 } = {}) {
  if (!category?.id || !previousCategory || !nextCategory) {
    throw new Error('Categorie ou snapshot de relocalisation introuvable.');
  }
  const previousMangas = Array.isArray(previousCategory.mangas) ? previousCategory.mangas : [];
  const nextMangas = Array.isArray(nextCategory.mangas) ? nextCategory.mangas : [];
  const nextByContent = byContentId(nextMangas);
  const mangaMatches = [];
  const ambiguous = [];
  const unmatched = [];
  const chapterAmbiguous = [];
  const unmatchedChapters = [];

  for (const previousManga of previousMangas) {
    const mangaResolution = resolveRelocationCandidates(
      previousManga,
      nextByContent.get(String(previousManga?.contentId || '')) || [],
      nextMangas
    );
    const { candidates } = mangaResolution;
    if (candidates.length !== 1) {
      if (candidates.length > 1) ambiguous.push({ fromMangaId: previousManga.id, candidateIds: candidates.map((item) => item.id) });
      else unmatched.push(previousManga.id);
      continue;
    }
    const nextManga = candidates[0];
    const nextChaptersByContent = byContentId(nextManga.chapters || []);
    const chapterMatches = [];
    for (const previousChapter of previousManga.chapters || []) {
      const chapterResolution = resolveRelocationCandidates(
        previousChapter,
        nextChaptersByContent.get(String(previousChapter?.contentId || '')) || [],
        nextManga.chapters || []
      );
      const chapterCandidates = chapterResolution.candidates;
      if (chapterCandidates.length === 1 && chapterCandidates[0].id !== previousChapter.id) {
        chapterMatches.push({
          fromChapterId: previousChapter.id,
          toChapterId: chapterCandidates[0].id,
          contentId: previousChapter.contentId,
          matchMethod: chapterResolution.matchMethod
        });
      } else if (chapterCandidates.length > 1) {
        chapterAmbiguous.push({ fromChapterId: previousChapter.id, candidateIds: chapterCandidates.map((item) => item.id) });
      } else if (chapterCandidates.length === 0) {
        unmatchedChapters.push(previousChapter.id);
      }
    }
    mangaMatches.push({
      fromMangaId: previousManga.id,
      toMangaId: nextManga.id,
      contentId: previousManga.contentId,
      matchMethod: mangaResolution.matchMethod,
      chapterMatches
    });
  }

  const exactCoverage = previousMangas.length === 0 ? 1 : mangaMatches.length / previousMangas.length;
  return {
    id: `relocation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'category',
    entityId: category.id,
    fromPath: category.path,
    toPath: path.resolve(targetPath),
    stateRevision: Number(stateRevision || 0),
    mangaMatches,
    ambiguous,
    unmatched,
    chapterAmbiguous,
    unmatchedChapters,
    newMangaIds: nextMangas.filter((item) => !mangaMatches.some((match) => match.toMangaId === item.id)).map((item) => item.id),
    exactCoverage,
    chapterCoverageComplete: chapterAmbiguous.length === 0 && unmatchedChapters.length === 0,
    autoApplicable: previousMangas.length > 0
      && ambiguous.length === 0
      && unmatched.length === 0
      && chapterAmbiguous.length === 0
      && exactCoverage === 1,
    createdAt: new Date().toISOString()
  };
}

function rebaseMangaPaths(state, mangaMatches, fromRoot, toRoot) {
  for (const match of mangaMatches) {
    const targetId = match.toMangaId;
    const metadata = state.metadata?.[targetId];
    if (metadata) {
      for (const key of ['coverPath', 'onlineCoverPath']) {
        metadata[key] = rebasePath(metadata[key], fromRoot, toRoot);
      }
    }
    const profile = state.coverProfiles?.[targetId];
    if (profile?.variants) {
      profile.variants = profile.variants.map((variant) => ({
        ...variant,
        path: rebasePath(variant?.path, fromRoot, toRoot)
      }));
    }
  }
}

function applyCategoryRelocation(state, plan, now = new Date()) {
  const category = (state.categories || []).find((entry) => entry.id === plan.entityId);
  if (!category) throw new Error('Categorie a relocaliser introuvable.');
  if (normalizePath(category.path) !== normalizePath(plan.fromPath)) {
    throw new Error('Le chemin de la categorie a change depuis la verification.');
  }

  const mangaMoves = plan.mangaMatches
    .filter((match) => match.fromMangaId && match.toMangaId && match.fromMangaId !== match.toMangaId);
  const chapterMoves = plan.mangaMatches.flatMap((match) => match.chapterMatches || []);
  remapPersistedReferences(state, mangaMoves, chapterMoves);
  rebaseMangaPaths(state, mangaMoves, plan.fromPath, plan.toPath);
  if (plan.nextScanIndex) state.scanIndex = plan.nextScanIndex;

  category.pathHistory = [...new Set([...(category.pathHistory || []), category.path, plan.toPath])].slice(-12);
  category.path = plan.toPath;
  category.name = path.basename(plan.toPath) || category.name;
  category.availability = 'available';
  category.lastSeenAt = now.toISOString();
  category.missingSince = null;

  const appliedAt = now.toISOString();
  const journalEntry = {
    id: plan.id,
    kind: 'category',
    entityId: category.id,
    fromPath: plan.fromPath,
    toPath: plan.toPath,
    mangaMoves,
    chapterMoves,
    appliedAt,
    undoUntil: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    undoneAt: null
  };
  state.relocationJournal = [...(state.relocationJournal || []), journalEntry]
    .filter((entry) => now.getTime() - Date.parse(entry.appliedAt) <= 30 * 24 * 60 * 60 * 1000)
    .slice(-50);
  return journalEntry;
}

function undoCategoryRelocation(state, relocationId, now = new Date()) {
  const entry = (state.relocationJournal || []).find((item) => item.id === relocationId);
  if (!entry || entry.undoneAt) throw new Error('Rattachement introuvable ou deja annule.');
  if (now.getTime() > Date.parse(entry.undoUntil)) throw new Error("Le delai d'annulation de 30 minutes est depasse.");
  const category = (state.categories || []).find((item) => item.id === entry.entityId);
  if (!category || normalizePath(category.path) !== normalizePath(entry.toPath)) {
    throw new Error('La categorie a ete modifiee depuis le rattachement.');
  }
  remapPersistedReferences(
    state,
    (entry.mangaMoves || []).map((move) => ({ fromMangaId: move.toMangaId, toMangaId: move.fromMangaId })),
    (entry.chapterMoves || []).map((move) => ({ fromChapterId: move.toChapterId, toChapterId: move.fromChapterId }))
  );
  for (const move of entry.mangaMoves || []) {
    if (state.identityAliases?.[move.fromMangaId] === move.toMangaId) {
      delete state.identityAliases[move.fromMangaId];
    }
  }
  category.path = entry.fromPath;
  category.name = path.basename(entry.fromPath) || category.name;
  category.availability = fs.existsSync(entry.fromPath) ? 'available' : 'missing';
  category.missingSince = category.availability === 'missing' ? now.toISOString() : null;
  entry.undoneAt = now.toISOString();
  return entry;
}

module.exports = {
  applyCategoryRelocation,
  createCategoryRelocationPlan,
  isPathInside,
  normalizePath,
  preserveUnavailableLibraryEntries,
  rebasePath,
  undoCategoryRelocation
};
