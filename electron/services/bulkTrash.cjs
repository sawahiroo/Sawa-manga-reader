const fs = require('fs');
const path = require('path');
const { buildIdentityRecord } = require('./identityWorks.cjs');

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeId(value) {
  return String(value || '').trim();
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function comparablePath(value) {
  const normalized = path.resolve(String(value || ''));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function statIdentity(stat) {
  const type = stat?.isDirectory?.() ? 'directory' : stat?.isFile?.() ? 'file' : 'other';
  return [
    type,
    String(stat?.dev ?? ''),
    String(stat?.ino ?? ''),
    String(stat?.mode ?? ''),
    String(stat?.rdev ?? ''),
    type === 'file' ? String(stat?.size ?? '') : '',
    String(stat?.birthtimeMs ?? '')
  ].join(':');
}

async function inspectStablePathChain(rootPath, targetPath, fsApi) {
  const relative = path.relative(rootPath, targetPath);
  const segments = [rootPath];
  let current = rootPath;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    segments.push(current);
  }

  const entries = [];
  for (let index = 0; index < segments.length; index += 1) {
    const logicalPath = segments[index];
    const stat = await fsApi.lstat(logicalPath);
    if (stat?.isSymbolicLink?.()) {
      throw new Error('Suppression refusee: lien symbolique, jonction ou point de reanalyse detecte.');
    }
    const realPath = await fsApi.realpath(logicalPath);
    if (!samePath(realPath, logicalPath)) {
      throw new Error('Suppression refusee: lien symbolique, jonction ou point de reanalyse detecte.');
    }
    const isTarget = index === segments.length - 1;
    if (!isTarget && !stat?.isDirectory?.()) {
      throw new Error('Suppression refusee: un parent du manga n est plus un dossier stable.');
    }
    if (isTarget && !stat?.isDirectory?.() && !stat?.isFile?.()) {
      throw new Error('Suppression refusee: type de fichier non pris en charge.');
    }
    entries.push({
      path: comparablePath(logicalPath),
      realPath: comparablePath(realPath),
      stat: statIdentity(stat)
    });
  }
  return entries;
}

async function captureScannedMangaPath({
  mangaPath,
  categoryRoots = [],
  fsApi = fs.promises
}) {
  const rawPath = String(mangaPath || '').trim();
  if (!rawPath || !path.isAbsolute(rawPath)) {
    throw new Error('Le chemin du manga est absent ou non absolu.');
  }

  const resolvedPath = path.resolve(rawPath);
  if (resolvedPath !== path.normalize(rawPath)) {
    throw new Error('Le chemin du manga ne correspond pas exactement au chemin scanne.');
  }

  const resolvedRoots = [...new Set(categoryRoots
    .map((root) => String(root || '').trim())
    .filter(Boolean)
    .map((root) => path.resolve(root)))];
  if (resolvedRoots.some((root) => root === resolvedPath)) {
    throw new Error('Suppression refusee: une categorie racine ne peut pas etre supprimee.');
  }
  const owningRoot = resolvedRoots.find((root) => isPathInside(resolvedPath, root));
  if (!owningRoot) {
    throw new Error('Suppression refusee: chemin hors des categories scannees.');
  }

  const entries = await inspectStablePathChain(owningRoot, resolvedPath, fsApi);
  const realRoot = await fsApi.realpath(owningRoot);
  const realPath = await fsApi.realpath(resolvedPath);
  if (!isPathInside(path.resolve(realPath), path.resolve(realRoot))) {
    throw new Error('Suppression refusee: le chemin reel sort de la categorie scannee.');
  }
  return {
    canonicalRoot: path.resolve(realRoot),
    canonicalTarget: path.resolve(realPath),
    signature: JSON.stringify(entries)
  };
}

async function validateScannedMangaPath(options) {
  const validation = await captureScannedMangaPath(options);
  return validation.canonicalTarget;
}

function pickRecord(record, key) {
  if (!record || typeof record !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(record, key) ? structuredClone(record[key]) : undefined;
}

function normalizeStrongFingerprint(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^(?:sha256:)?[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function readStrongFingerprint(manga, identityRecord) {
  const candidates = [
    identityRecord?.strongFingerprint,
    manga?.strongFingerprint,
    buildIdentityRecord(manga || {}).strongFingerprint
  ];
  for (const candidate of candidates) {
    const normalized = normalizeStrongFingerprint(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function cloneObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value)
    : undefined;
}

function sanitizeDeletionTombstone(tombstone, fallbackMangaId = '', now = Date.now()) {
  if (!tombstone || typeof tombstone !== 'object' || Array.isArray(tombstone)) return null;
  const mangaId = normalizeId(tombstone.mangaId || fallbackMangaId);
  const mangaPath = String(tombstone.path || '').trim();
  const expiresAt = String(tombstone.expiresAt || '');
  if (!mangaId || !mangaPath || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) {
    return null;
  }
  const strongFingerprint = normalizeStrongFingerprint(
    tombstone.identity?.strongFingerprint || tombstone.identityRecord?.strongFingerprint
  );
  const sourceReading = tombstone.reading && typeof tombstone.reading === 'object'
    ? tombstone.reading
    : tombstone;
  const reading = {};
  [
    ['readStatus', sourceReading.readStatus],
    ['readingState', sourceReading.readingState],
    ['progress', sourceReading.progress],
    ['chapterReadStatus', sourceReading.chapterReadStatus],
    ['chapterStates', sourceReading.chapterStates]
  ].forEach(([key, value]) => {
    const cloned = cloneObject(value);
    if (cloned !== undefined && Object.keys(cloned).length > 0) reading[key] = cloned;
  });
  return {
    mangaId,
    path: mangaPath,
    deletedAt: String(tombstone.deletedAt || ''),
    expiresAt,
    identity: strongFingerprint ? { strongFingerprint } : null,
    reading
  };
}

function createDeletionTombstone(state, manga, now = Date.now()) {
  const mangaId = normalizeId(manga?.id);
  const chapterIds = (manga?.chapters || []).map((chapter) => normalizeId(chapter?.id)).filter(Boolean);
  const progress = {};
  const chapterReadStatus = {};
  const chapterStates = {};
  chapterIds.forEach((chapterId) => {
    const progressValue = pickRecord(state?.progress, chapterId);
    const readValue = pickRecord(state?.chapterReadStatus, chapterId);
    const chapterState = pickRecord(state?.chapterStates, chapterId);
    if (progressValue !== undefined) progress[chapterId] = progressValue;
    if (readValue !== undefined) chapterReadStatus[chapterId] = readValue;
    if (chapterState !== undefined) chapterStates[chapterId] = chapterState;
  });
  const reading = {
    readStatus: pickRecord(state?.readStatus, mangaId),
    readingState: pickRecord(state?.readingStates, mangaId),
    progress,
    chapterReadStatus,
    chapterStates
  };
  Object.keys(reading).forEach((key) => {
    const value = reading[key];
    if (value === undefined || (value && typeof value === 'object' && Object.keys(value).length === 0)) {
      delete reading[key];
    }
  });
  return {
    mangaId,
    path: String(manga?.path || ''),
    deletedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TOMBSTONE_TTL_MS).toISOString(),
    identity: {
      strongFingerprint: readStrongFingerprint(manga, state?.identityRecords?.[mangaId])
    },
    reading
  };
}

function removeDeletedMangaState(state, manga, tombstone) {
  const mangaId = normalizeId(manga?.id);
  state.deletionTombstones = state.deletionTombstones || {};
  state.deletionTombstones[mangaId] = tombstone;
  [
    'metadata', 'favorites', 'readStatus', 'readingStates', 'knownChapterCounts',
    'mangaTags', 'mangaTagMeta', 'annotations', 'identityRecords'
  ].forEach((key) => {
    if (state[key]) delete state[key][mangaId];
  });
  Object.values(state.collections || {}).forEach((collection) => {
    collection.mangaIds = (collection.mangaIds || []).filter((id) => id !== mangaId);
  });
  (manga?.chapters || []).forEach((chapter) => {
    const chapterId = normalizeId(chapter?.id);
    if (!chapterId) return;
    delete state.progress?.[chapterId];
    delete state.chapterReadStatus?.[chapterId];
    delete state.chapterStates?.[chapterId];
    if (chapter?.path) delete state.pdfMeta?.[chapter.path];
  });
  state.recents = (state.recents || []).filter((entry) => entry?.mangaId !== mangaId);
  state.readingQueue = (state.readingQueue || []).filter((entry) => entry?.mangaId !== mangaId);
  state.metadataWorkbenchQueue = (state.metadataWorkbenchQueue || []).filter((id) => id !== mangaId);
  state.metadataWorkbenchItems = (state.metadataWorkbenchItems || []).filter((item) => item?.mangaId !== mangaId);
  if (Array.isArray(state.metadataWorkbenchLastBatch?.entries)) {
    state.metadataWorkbenchLastBatch.entries = state.metadataWorkbenchLastBatch.entries
      .filter((entry) => entry?.mangaId !== mangaId);
    if (state.metadataWorkbenchLastBatch.entries.length === 0) state.metadataWorkbenchLastBatch = null;
  }
  return state;
}

function restoreReturnedTombstones(state, mangas = [], now = Date.now()) {
  const byPath = new Map((mangas || [])
    .filter((manga) => manga?.path)
    .map((manga) => [path.resolve(manga.path).toLowerCase(), manga]));
  const restoredIds = [];
  state.deletionTombstones = state.deletionTombstones || {};
  Object.entries(state.deletionTombstones).forEach(([storedId, tombstone]) => {
    if (!tombstone || Date.parse(tombstone.expiresAt) <= now) {
      delete state.deletionTombstones[storedId];
      return;
    }
    const sanitized = sanitizeDeletionTombstone(tombstone, storedId, now);
    if (!sanitized) {
      delete state.deletionTombstones[storedId];
      return;
    }
    state.deletionTombstones[storedId] = sanitized;
    const manga = byPath.get(path.resolve(sanitized.path || '').toLowerCase());
    if (!manga) return;
    const mangaId = normalizeId(manga.id);
    const currentFingerprint = readStrongFingerprint(manga, null);
    if (!sanitized.identity?.strongFingerprint || currentFingerprint !== sanitized.identity.strongFingerprint) return;
    const restoreRecord = (key, value) => {
      if (value === undefined) return;
      state[key] = state[key] || {};
      if (!Object.prototype.hasOwnProperty.call(state[key], mangaId)) {
        state[key][mangaId] = structuredClone(value);
      }
    };
    restoreRecord('readStatus', sanitized.reading.readStatus);
    restoreRecord('readingStates', sanitized.reading.readingState);
    const chapterIds = new Set((manga.chapters || []).map((chapter) => normalizeId(chapter?.id)).filter(Boolean));
    const restoreChapterRecords = (key, records) => {
      if (!records || typeof records !== 'object') return;
      state[key] = state[key] || {};
      for (const [chapterId, value] of Object.entries(records)) {
        if (!chapterIds.has(chapterId) || Object.prototype.hasOwnProperty.call(state[key], chapterId)) continue;
        state[key][chapterId] = structuredClone(value);
      }
    };
    restoreChapterRecords('progress', sanitized.reading.progress);
    restoreChapterRecords('chapterReadStatus', sanitized.reading.chapterReadStatus);
    restoreChapterRecords('chapterStates', sanitized.reading.chapterStates);
    delete state.deletionTombstones[storedId];
    restoredIds.push(mangaId);
  });
  return restoredIds;
}

async function bulkTrashMangas({
  mangas = [],
  requestedIds = [],
  categoryRoots = [],
  trashItem,
  fsApi = fs.promises,
  concurrency = 2,
  onProgress = () => {},
  isCancelled = () => false,
  state = {},
  now = Date.now()
}) {
  if (typeof trashItem !== 'function') throw new Error('Service de Corbeille indisponible.');
  const requested = [...new Set(requestedIds.map(normalizeId).filter(Boolean))];
  const byId = new Map(mangas.map((manga) => [normalizeId(manga?.id), manga]));
  const results = new Array(requested.length);
  let cursor = 0;
  let completed = 0;
  const markRemainingCancelled = () => {
    while (cursor < requested.length) {
      const index = cursor++;
      const mangaId = requested[index];
      const manga = byId.get(mangaId);
      results[index] = {
        mangaId,
        path: manga?.path || null,
        ok: false,
        cancelled: true,
        error: 'Suppression annulee avant traitement.'
      };
      completed += 1;
      onProgress({ completed, total: requested.length, result: results[index] });
    }
  };
  const worker = async () => {
    while (cursor < requested.length) {
      if (isCancelled()) {
        markRemainingCancelled();
        return;
      }
      const index = cursor++;
      const mangaId = requested[index];
      const manga = byId.get(mangaId);
      try {
        if (!manga) throw new Error('Manga introuvable dans le dernier scan valide.');
        const initialValidation = await captureScannedMangaPath({
          mangaPath: manga.path,
          categoryRoots,
          fsApi
        });
        const finalValidation = await captureScannedMangaPath({
          mangaPath: manga.path,
          categoryRoots,
          fsApi
        });
        if (
          !samePath(initialValidation.canonicalRoot, finalValidation.canonicalRoot)
          || !samePath(initialValidation.canonicalTarget, finalValidation.canonicalTarget)
          || initialValidation.signature !== finalValidation.signature
        ) {
          throw new Error('Suppression refusee: le chemin a change ou a ete substitue apres validation.');
        }
        await trashItem(finalValidation.canonicalTarget);
        const tombstone = createDeletionTombstone(state, manga, now);
        results[index] = { mangaId, path: finalValidation.canonicalTarget, ok: true, tombstone };
      } catch (error) {
        results[index] = {
          mangaId,
          path: manga?.path || null,
          ok: false,
          error: error?.message || 'Suppression impossible.'
        };
      } finally {
        completed += 1;
        onProgress({ completed, total: requested.length, result: results[index] });
      }
    }
  };
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), 2, requested.length || 1);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return {
    ok: results.every((result) => result?.ok),
    results,
    succeeded: results.filter((result) => result?.ok),
    failed: results.filter((result) => !result?.ok && !result?.cancelled),
    cancelled: results.filter((result) => result?.cancelled)
  };
}

module.exports = {
  TOMBSTONE_TTL_MS,
  bulkTrashMangas,
  captureScannedMangaPath,
  createDeletionTombstone,
  isPathInside,
  removeDeletedMangaState,
  restoreReturnedTombstones,
  sanitizeDeletionTombstone,
  validateScannedMangaPath
};
