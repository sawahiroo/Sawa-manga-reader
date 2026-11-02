/**
 * Sawa Manga Library v3.0.0 - Library Scanner
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  isCbzFile,
  listCbzImageEntriesSync,
  loadComicInfoForSourceSync
} = require('./archive.cjs');
const { measureSync } = require('./perfDiagnostics.cjs');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.jfif', '.svg', '.tif', '.tiff'
]);

const PDF_EXTENSIONS = new Set(['.pdf']);
const HEALTH_RANK = { ok: 0, warning: 1, error: 2, quarantined: 3 };

function hashFromString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function digestParts(prefix, parts = []) {
  const hash = crypto.createHash('sha1');
  hash.update(String(prefix || ''));
  parts.forEach((part) => {
    hash.update('|');
    hash.update(String(part ?? ''));
  });
  return hash.digest('hex').slice(0, 20);
}

function makeId(prefix, absolutePath) {
  return `${prefix}_${hashFromString(absolutePath)}`;
}

function makeLocationId(absolutePath) {
  return `loc_${hashFromString(absolutePath)}`;
}

function toFileSrc(absolutePath) {
  return `manga://local/${encodeURIComponent(absolutePath)}`;
}

function toCbzSrc(cbzPath, entryName) {
  return `manga://cbz/${encodeURIComponent(cbzPath)}?entry=${encodeURIComponent(entryName)}`;
}

function isImageFile(fileName) {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isPdfFile(fileName) {
  return PDF_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function naturalCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function sortNames(list) {
  return [...list].sort(naturalCompare);
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch (_) {
    return null;
  }
}

function readFileSignature(filePath, bytes = 8192) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(Math.max(1, bytes));
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, size).toString('hex').slice(0, 48);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return '';
  }
}

function normalizePathKey(targetPath) {
  return process.platform === 'win32' ? String(targetPath || '').toLowerCase() : String(targetPath || '');
}

function getScanEntries(scanIndex) {
  if (Array.isArray(scanIndex?.entries)) return scanIndex.entries;
  if (scanIndex?.entries && typeof scanIndex.entries === 'object') return Object.values(scanIndex.entries);
  return [];
}

const SCAN_ENTRY_COMPARISON_FIELDS = [
  'type',
  'legacyId',
  'contentId',
  'locationId',
  'path',
  'containerType',
  'chapterCount',
  'pageCount',
  'size',
  'mtimeMs',
  'healthStatus',
  'signature'
];

function scanEntryKey(entry = {}) {
  const identity = entry.locationId || entry.path || entry.legacyId || entry.contentId || '';
  // A one-shot folder legitimately produces a manga entry and a chapter entry
  // with the same location. Include the record type so the comparison index
  // does not treat that pair as a duplicate and force a false-positive rescan.
  return identity ? `${String(entry.type || 'entry')}:${String(identity).trim()}` : '';
}

function areScanEntriesEquivalent(left, right) {
  return SCAN_ENTRY_COMPARISON_FIELDS.every((field) => {
    const leftValue = left?.[field] ?? null;
    const rightValue = right?.[field] ?? null;
    if (field === 'path') return normalizePathKey(leftValue) === normalizePathKey(rightValue);
    return leftValue === rightValue;
  });
}

function areScanIndexesEquivalent(previousIndex, nextIndex) {
  const previousEntries = getScanEntries(previousIndex);
  const nextEntries = getScanEntries(nextIndex);
  if (previousEntries.length !== nextEntries.length) return false;

  const previousByKey = new Map(previousEntries.map((entry) => [scanEntryKey(entry), entry]));
  if (previousByKey.size !== previousEntries.length || previousByKey.has('')) return false;

  return nextEntries.every((entry) => {
    const previous = previousByKey.get(scanEntryKey(entry));
    return Boolean(previous && areScanEntriesEquivalent(previous, entry));
  });
}

function buildPreviousScanLookup(persistedState = {}) {
  const entries = getScanEntries(persistedState?.scanIndex);
  const byPath = new Map();
  const byLegacyId = new Map();
  const byContentId = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.path) byPath.set(normalizePathKey(entry.path), entry);
    if (entry.legacyId) byLegacyId.set(entry.legacyId, entry);
    if (entry.contentId) byContentId.set(entry.contentId, entry);
  }
  return { byPath, byLegacyId, byContentId };
}

function getWorstHealth(...values) {
  return values
    .filter(Boolean)
    .sort((left, right) => (HEALTH_RANK[right] ?? 0) - (HEALTH_RANK[left] ?? 0))[0] || 'ok';
}

function estimatePdfPageCount(pdfPath, chapterId, persistedState = {}, previousEntry = null) {
  const cachedCount = Number(
    persistedState?.pdfMeta?.[pdfPath]?.pageCount
    ?? persistedState?.progress?.[chapterId]?.pageCount
    ?? previousEntry?.pageCount
    ?? 0
  );
  if (cachedCount > 0) return cachedCount;

  try {
    const stats = fs.statSync(pdfPath);
    const fileSize = stats.size;

    // Fast path: read the last 8KB where /Count is usually found (page tree root near trailer)
    const tailSize = Math.min(fileSize, 8192);
    const tailBuffer = Buffer.allocUnsafe(tailSize);
    const fd = fs.openSync(pdfPath, 'r');
    try {
      fs.readSync(fd, tailBuffer, 0, tailSize, Math.max(0, fileSize - tailSize));
    } finally {
      fs.closeSync(fd);
    }
    const tailContent = tailBuffer.toString('latin1');
    const countMatches = [...tailContent.matchAll(/\/Count\s+(\d+)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (countMatches.length > 0) return Math.max(...countMatches);

    // Slow fallback: full file read (only for badly structured PDFs)
    const buffer = fs.readFileSync(pdfPath);
    const content = buffer.toString('latin1');
    const pageMatches = content.match(/\/Type\s*\/Page(?!s)\b/g);
    if (pageMatches?.length) return pageMatches.length;
  } catch (_) {
    return cachedCount || 1;
  }

  return cachedCount || 1;
}

function makePdfPage(pagePath, index, chapterId) {
  return {
    id: makeId('pdfpage', `${pagePath}::${index}`),
    chapterId,
    name: `Page ${index + 1}`,
    index,
    path: pagePath,
    src: null,
    sourceType: 'pdf',
    containerType: 'pdf',
    pdfPageNumber: index + 1
  };
}

function makeImagePage(pagePath, index, chapterId) {
  return {
    id: makeId('page', pagePath),
    chapterId,
    name: path.basename(pagePath),
    index,
    path: pagePath,
    src: toFileSrc(pagePath),
    sourceType: 'image',
    containerType: 'folder'
  };
}

function makeCbzPage(chapterPath, entryName, index, chapterId) {
  return {
    id: makeId('cbzpage', `${chapterPath}::${entryName}`),
    chapterId,
    name: path.basename(entryName),
    index,
    path: `${chapterPath}#${entryName}`,
    assetPath: chapterPath,
    archiveEntryName: entryName,
    src: toCbzSrc(chapterPath, entryName),
    sourceType: 'image',
    containerType: 'cbz'
  };
}

function scanPageFilePaths(directoryPath) {
  const entries = safeReadDir(directoryPath);
  const fileNames = sortNames(
    entries
      .filter((entry) => entry.isFile() && isImageFile(entry.name))
      .map((entry) => entry.name)
  );
  return fileNames.map((name) => path.join(directoryPath, name));
}

function summarizeFolderChapter(directoryPath) {
  const pagePaths = scanPageFilePaths(directoryPath);
  // Stat only a sample (first, last, mid) instead of every page — O(1) vs O(n) syscalls
  const sampleIndexes = new Set([0, Math.floor(pagePaths.length / 2), pagePaths.length - 1].filter((i) => i >= 0 && i < pagePaths.length));
  let totalSize = 0;
  let maxMtimeMs = 0;
  for (const idx of sampleIndexes) {
    const stat = safeStat(pagePaths[idx]);
    if (stat) {
      totalSize += Number(stat.size || 0);
      maxMtimeMs = Math.max(maxMtimeMs, Number(stat.mtimeMs || 0));
    }
  }
  // Estimate total size from sample average
  if (sampleIndexes.size > 0 && pagePaths.length > sampleIndexes.size) {
    totalSize = Math.round((totalSize / sampleIndexes.size) * pagePaths.length);
  }
  const sampleNames = [
    ...pagePaths.slice(0, 2).map((pagePath) => path.basename(pagePath)),
    ...pagePaths.slice(-2).map((pagePath) => path.basename(pagePath))
  ];
  const signature = digestParts('folder-chapter', [pagePaths.length, totalSize, ...sampleNames]);
  return {
    pagePaths,
    pageCount: pagePaths.length,
    size: totalSize,
    mtimeMs: maxMtimeMs,
    sampleNames,
    signature
  };
}

function computeChapterContentId({ containerType, filePath, size, pageCount, signature, pagePaths = [] }) {
  if (containerType === 'pdf' || containerType === 'cbz') {
    const prefix = readFileSignature(filePath);
    return `content_ch_${digestParts(containerType, [size, pageCount, signature, prefix])}`;
  }

  const names = pagePaths.length > 0
    ? [path.basename(pagePaths[0]), path.basename(pagePaths[pagePaths.length - 1])]
    : [];
  return `content_ch_${digestParts('folder', [pageCount, size, signature, ...names])}`;
}

function deriveChapterReadingState(chapterId, persistedState) {
  const explicit = persistedState.chapterStates?.[chapterId];
  if (explicit === 'read') return 'read';
  if (explicit === 'in-progress') return 'in-progress';

  const markedRead = Boolean(persistedState.chapterReadStatus?.[chapterId]);
  if (markedRead) return 'read';

  const progress = persistedState.progress?.[chapterId];
  const furthestPageIndex = Number(progress?.furthestPageIndex ?? progress?.pageIndex) || 0;
  if (progress && progress.pageCount && furthestPageIndex >= progress.pageCount - 1) return 'read';
  if (progress && progress.pageIndex > 0) return 'in-progress';

  return 'never';
}

function deriveMangaReadingState(mangaId, chapters, persistedState) {
  const explicit = persistedState.readingStates?.[mangaId];
  if (explicit === 'to-resume') return 'to-resume';
  if (chapters.length === 0) return 'never';
  const allRead = chapters.every((chapter) => chapter.readingState === 'read');
  if (allRead) return 'read';
  const anyStarted = chapters.some((chapter) => chapter.readingState !== 'never');
  if (anyStarted) return 'in-progress';
  if (explicit === 'in-progress') return 'in-progress';
  return 'never';
}

function resolveTagsForManga(mangaId, persistedState) {
  const tagIds = persistedState.mangaTags?.[mangaId] || [];
  const allTags = persistedState.tags || {};
  const tagMeta = persistedState.mangaTagMeta?.[mangaId] || {};
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

function resolveCollectionIdsForManga(mangaId, persistedState) {
  const collections = persistedState.collections || {};
  const ids = [];
  for (const [collectionId, collection] of Object.entries(collections)) {
    if (Array.isArray(collection?.mangaIds) && collection.mangaIds.includes(mangaId)) ids.push(collectionId);
  }
  return ids;
}

function resolveCover(metadata, firstChapter = null) {
  const automaticOnly = metadata.coverMode === 'auto';
  if (!automaticOnly && metadata.coverPath && fs.existsSync(metadata.coverPath)) {
    return { coverSrc: toFileSrc(metadata.coverPath), coverType: 'custom', coverMediaType: 'image', coverFilePath: metadata.coverPath, coverPageNumber: 1 };
  }

  if (!automaticOnly && metadata.onlineCoverPath && fs.existsSync(metadata.onlineCoverPath)) {
    return { coverSrc: toFileSrc(metadata.onlineCoverPath), coverType: 'online', coverMediaType: 'image', coverFilePath: metadata.onlineCoverPath, coverPageNumber: 1 };
  }

  if (!firstChapter) {
    return { coverSrc: null, coverType: 'default', coverMediaType: 'image', coverFilePath: null, coverPageNumber: 1 };
  }

  if (firstChapter.previewMediaType === 'pdf') {
    return {
      coverSrc: null,
      coverType: 'auto',
      coverMediaType: 'pdf',
      coverFilePath: firstChapter.path,
      coverPageNumber: 1
    };
  }

  if (firstChapter.previewSrc) {
    return {
      coverSrc: firstChapter.previewSrc,
      coverType: 'auto',
      coverMediaType: 'image',
      coverFilePath: firstChapter.previewFilePath || null,
      coverPageNumber: 1
    };
  }

  return { coverSrc: null, coverType: 'default', coverMediaType: 'image', coverFilePath: null, coverPageNumber: 1 };
}

function readComicInfoForChapter(chapterPath) {
  try {
    return loadComicInfoForSourceSync(chapterPath);
  } catch (_) {
    return null;
  }
}

function scanChapterSummary(chapterPath, chapterName, persistedState, previousScan, isOneShot = false) {
  const locationId = makeLocationId(chapterPath);
  const legacyChapterId = isOneShot
    ? makeId('chapter', `${chapterPath}::oneshot`)
    : makeId('chapter', chapterPath);
  const previousEntry = previousScan.byPath.get(normalizePathKey(chapterPath))
    || previousScan.byLegacyId.get(legacyChapterId)
    || null;

  const containerType = isPdfFile(chapterPath) ? 'pdf' : (isCbzFile(chapterPath) ? 'cbz' : 'folder');
  const progress = persistedState.progress?.[legacyChapterId] ?? null;
  const readingState = deriveChapterReadingState(legacyChapterId, persistedState);
  const isRead = readingState === 'read';

  let pageCount = 0;
  let previewSrc = null;
  let previewMediaType = 'image';
  let previewFilePath = null;
  let previewPageNumber = 1;
  let pages = null;
  let size = 0;
  let mtimeMs = 0;
  let healthStatus = 'ok';
  let contentId = previousEntry?.contentId || null;
  let comicInfo = null;
  let signature = '';

  if (containerType === 'pdf') {
    const stats = safeStat(chapterPath);
    size = Number(stats?.size || 0);
    mtimeMs = Number(stats?.mtimeMs || 0);
    pageCount = estimatePdfPageCount(chapterPath, legacyChapterId, persistedState, previousEntry);
    previewMediaType = 'pdf';
    previewFilePath = chapterPath;
    signature = previousEntry && Number(previousEntry.size || 0) === size && Number(previousEntry.mtimeMs || 0) === mtimeMs
      ? previousEntry.signature || ''
      : digestParts('pdf', [size, pageCount, readFileSignature(chapterPath)]);
    if (!contentId || Number(previousEntry?.size || 0) !== size || Number(previousEntry?.mtimeMs || 0) !== mtimeMs) {
      contentId = computeChapterContentId({ containerType, filePath: chapterPath, size, pageCount, signature });
    }
  } else if (containerType === 'cbz') {
    const stats = safeStat(chapterPath);
    size = Number(stats?.size || 0);
    mtimeMs = Number(stats?.mtimeMs || 0);

    try {
      const entries = listCbzImageEntriesSync(chapterPath);
      pageCount = entries.length;
      if (entries[0]) {
        previewSrc = toCbzSrc(chapterPath, entries[0]);
        previewFilePath = chapterPath;
      }
      if (pageCount === 0) healthStatus = 'warning';
      signature = digestParts('cbz', [size, pageCount, entries[0] || '', entries[entries.length - 1] || '']);
    } catch (_) {
      healthStatus = 'quarantined';
      pageCount = Number(previousEntry?.pageCount || 0);
      signature = previousEntry?.signature || '';
    }

    comicInfo = readComicInfoForChapter(chapterPath);
    if (!contentId || Number(previousEntry?.size || 0) !== size || Number(previousEntry?.mtimeMs || 0) !== mtimeMs) {
      contentId = computeChapterContentId({ containerType, filePath: chapterPath, size, pageCount, signature });
    }
  } else {
    const summary = summarizeFolderChapter(chapterPath);
    pageCount = summary.pageCount;
    size = summary.size;
    mtimeMs = summary.mtimeMs;
    signature = summary.signature;
    if (summary.pagePaths[0]) {
      previewSrc = toFileSrc(summary.pagePaths[0]);
      previewFilePath = summary.pagePaths[0];
    }
    if (pageCount === 0) healthStatus = 'warning';
    if (!contentId || Number(previousEntry?.size || 0) !== size || Number(previousEntry?.mtimeMs || 0) !== mtimeMs) {
      contentId = computeChapterContentId({
        containerType,
        filePath: chapterPath,
        size,
        pageCount,
        signature,
        pagePaths: summary.pagePaths
      });
    }
    comicInfo = readComicInfoForChapter(chapterPath);
  }

  if (!contentId) {
    contentId = `content_ch_${digestParts('fallback-chapter', [chapterPath, size, pageCount, signature])}`;
  }

  const scanIndexEntry = {
    type: 'chapter',
    legacyId: legacyChapterId,
    contentId,
    locationId,
    path: chapterPath,
    containerType,
    pageCount,
    size,
    mtimeMs,
    healthStatus,
    signature,
    updatedAt: new Date().toISOString()
  };

  return {
    id: legacyChapterId,
    legacyId: legacyChapterId,
    contentId,
    locationId,
    name: chapterName,
    path: chapterPath,
    pageCount,
    previewSrc,
    previewMediaType,
    previewFilePath,
    previewPageNumber,
    pages,
    progress,
    isRead,
    readingState,
    isOneShot,
    sourceType: containerType === 'pdf' ? 'pdf' : 'image',
    containerType,
    healthStatus,
    progressKey: legacyChapterId,
    metadataKey: legacyChapterId,
    comicInfo,
    scanIndexEntry
  };
}

function deriveDisplayTitle(mangaName, metadata = {}, primaryComicInfo = null) {
  const comicTitle = String(primaryComicInfo?.series || primaryComicInfo?.title || '').trim();
  return metadata.title?.trim()
    || metadata.onlineTitle?.trim()
    || comicTitle
    || mangaName;
}

function buildAliases(mangaName, displayTitle, metadata = {}, primaryComicInfo = null) {
  return [...new Map(
    [
      ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
      ...(Array.isArray(metadata.onlineAltTitles) ? metadata.onlineAltTitles : []),
      metadata.titleJapanese,
      metadata.titleEnglish,
      primaryComicInfo?.title,
      primaryComicInfo?.series,
      mangaName !== displayTitle ? mangaName : null
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value) => value.toLowerCase() !== displayTitle.toLowerCase())
      .map((value) => [value.toLowerCase(), value])
  ).values()];
}

function scanManga(mangaPath, persistedState, previousScan) {
  const mangaName = path.basename(mangaPath);
  const entries = safeReadDir(mangaPath);
  const stats = safeStat(mangaPath);
  const legacyMangaId = makeId('manga', mangaPath);
  const locationId = makeLocationId(mangaPath);
  const previousEntry = previousScan.byPath.get(normalizePathKey(mangaPath))
    || previousScan.byLegacyId.get(legacyMangaId)
    || null;
  const metadata = persistedState.metadata?.[legacyMangaId] ?? {};
  const isFavorite = Boolean(persistedState.favorites?.[legacyMangaId]);

  const childDirs = sortNames(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const pdfFiles = sortNames(entries.filter((entry) => entry.isFile() && isPdfFile(entry.name)).map((entry) => entry.name));
  const cbzFiles = sortNames(entries.filter((entry) => entry.isFile() && isCbzFile(entry.name)).map((entry) => entry.name));
  const looseImages = sortNames(entries.filter((entry) => entry.isFile() && isImageFile(entry.name)).map((entry) => entry.name));

  let chapters = [];
  if (childDirs.length === 0 && pdfFiles.length === 0 && cbzFiles.length === 0 && looseImages.length > 0) {
    chapters = [scanChapterSummary(mangaPath, 'Chapitre unique', persistedState, previousScan, true)];
  } else {
    const chapterEntries = [
      ...childDirs.map((name) => ({ name, path: path.join(mangaPath, name) })),
      ...pdfFiles.map((name) => ({ name: path.basename(name, path.extname(name)), path: path.join(mangaPath, name) })),
      ...cbzFiles.map((name) => ({ name: path.basename(name, path.extname(name)), path: path.join(mangaPath, name) }))
    ].sort((left, right) => naturalCompare(left.name, right.name));

    chapters = chapterEntries.map((entry) => scanChapterSummary(entry.path, entry.name, persistedState, previousScan, false));
  }

  const chapterProgressEntries = chapters
    .map((chapter) => chapter.progress)
    .filter(Boolean)
    .sort((left, right) => new Date(right.lastReadAt || 0).getTime() - new Date(left.lastReadAt || 0).getTime());

  const lastProgress = chapterProgressEntries[0] ?? null;
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

  const isRead = chapters.length > 0 && completedChapterCount === chapters.length;
  const readingState = deriveMangaReadingState(legacyMangaId, chapters, persistedState);
  const primaryComicInfo = chapters.find((chapter) => chapter.comicInfo)?.comicInfo || null;
  const displayTitle = deriveDisplayTitle(mangaName, metadata, primaryComicInfo);
  const aliases = buildAliases(mangaName, displayTitle, metadata, primaryComicInfo);
  const tags = resolveTagsForManga(legacyMangaId, persistedState);
  const collectionIds = resolveCollectionIdsForManga(legacyMangaId, persistedState);
  const knownCount = persistedState.knownChapterCounts?.[legacyMangaId];
  const hasNewChapters = typeof knownCount === 'number' && chapters.length > knownCount;
  const addedAt = stats?.birthtime?.toISOString?.() || stats?.ctime?.toISOString?.() || null;
  const modifiedAt = stats?.mtime?.toISOString?.() || null;
  const healthStatus = chapters.reduce((current, chapter) => getWorstHealth(current, chapter.healthStatus), 'ok');
  const contentId = previousEntry?.contentId && Number(previousEntry.chapterCount || 0) === chapters.length
    ? previousEntry.contentId
    : `content_mg_${digestParts('manga', [chapters.length, ...chapters.map((chapter) => chapter.contentId).sort()])}`;

  const { coverSrc, coverType, coverMediaType, coverFilePath, coverPageNumber } = resolveCover(metadata, chapters[0] ?? null);
  const mangaEntry = {
    id: legacyMangaId,
    legacyId: legacyMangaId,
    contentId,
    locationId,
    name: mangaName,
    displayTitle,
    author: metadata.author?.trim() || metadata.onlineAuthor?.trim() || String(primaryComicInfo?.writer || primaryComicInfo?.artist || '').trim(),
    description: metadata.description?.trim() || metadata.onlineDescription?.trim() || String(primaryComicInfo?.summary || '').trim(),
    aliases,
    path: mangaPath,
    chapterCount: chapters.length,
    completedChapterCount,
    progressPercent,
    pageCount: chapters.reduce((sum, chapter) => sum + Number(chapter.pageCount || 0), 0),
    coverSrc,
    coverType,
    coverMediaType,
    coverFilePath,
    coverPageNumber,
    coverProfile: persistedState.coverProfiles?.[legacyMangaId] || null,
    isFavorite,
    isRead,
    readingState,
    chapters,
    progress: {
      percent: progressPercent,
      completedChapterCount,
      totalChapterCount: chapters.length,
      lastChapterId: lastProgress?.chapterId ?? null
    },
    lastProgress,
    lastReadAt: lastProgress?.lastReadAt ?? null,
    addedAt,
    modifiedAt,
    categoryId: null,
    categoryName: null,
    categoryHidden: false,
    tags,
    collectionIds,
    hasNewChapters,
    healthStatus,
    metadataLocks: persistedState.metadataLocks?.[legacyMangaId] || {},
    metadataFieldSource: persistedState.metadataFieldSource?.[legacyMangaId] || {},
    comicInfo: primaryComicInfo,
    scanIndexEntry: {
      type: 'manga',
      legacyId: legacyMangaId,
      contentId,
      locationId,
      path: mangaPath,
      containerType: 'folder',
      chapterCount: chapters.length,
      pageCount: chapters.reduce((sum, chapter) => sum + Number(chapter.pageCount || 0), 0),
      size: Number(stats?.size || 0),
      mtimeMs: Number(stats?.mtimeMs || 0),
      healthStatus,
      updatedAt: new Date().toISOString()
    }
  };

  return mangaEntry;
}

function getChapterPages(chapterPath, persistedState = {}) {
  if (isPdfFile(chapterPath)) {
    const chapterId = makeId('chapter', chapterPath);
    const pageCount = estimatePdfPageCount(chapterPath, chapterId, persistedState);
    return Array.from({ length: Math.max(1, pageCount) }, (_, index) => makePdfPage(chapterPath, index, chapterId));
  }

  if (isCbzFile(chapterPath)) {
    const chapterId = makeId('chapter', chapterPath);
    try {
      const entries = listCbzImageEntriesSync(chapterPath);
      return entries.map((entryName, index) => makeCbzPage(chapterPath, entryName, index, chapterId));
    } catch (_) {
      return [];
    }
  }

  const chapterId = makeId('chapter', chapterPath);
  return scanPageFilePaths(chapterPath).map((pagePath, index) => makeImagePage(pagePath, index, chapterId));
}

function scanLibraryInner(persistedState) {
  const previousScan = buildPreviousScanLookup(persistedState);
  const scanEntries = [];

  const categories = (persistedState.categories || []).map((categoryRecord) => {
    const exists = fs.existsSync(categoryRecord.path);
    const entries = exists ? safeReadDir(categoryRecord.path) : [];
    const mangaDirs = sortNames(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    const mangas = mangaDirs.map((dirName) => {
      const manga = scanManga(path.join(categoryRecord.path, dirName), persistedState, previousScan);
      scanEntries.push(manga.scanIndexEntry, ...manga.chapters.map((chapter) => chapter.scanIndexEntry));
      return manga;
    });

    return {
      id: categoryRecord.id,
      name: categoryRecord.name,
      path: categoryRecord.path,
      hidden: Boolean(categoryRecord.hidden),
      exists,
      mangaCount: mangas.length,
      mangas
    };
  });

  const allMangas = categories.flatMap((category) =>
    category.mangas.map((manga) => ({
      ...manga,
      categoryId: category.id,
      categoryName: category.name,
      categoryHidden: category.hidden,
      isPrivateCategory: Boolean(category.isPrivate)
    }))
  );

  const favorites = allMangas.filter((manga) => manga.isFavorite);
  const recents = [...(persistedState.recents || [])]
    .sort((left, right) => new Date(right.lastReadAt || 0).getTime() - new Date(left.lastReadAt || 0).getTime())
    .slice(0, 20)
    .map((recent) => {
      const manga = allMangas.find((item) => item.id === recent.mangaId || item.contentId === recent.mangaId);
      if (!manga) return null;
      const chapter = manga.chapters.find((item) => item.id === recent.chapterId || item.contentId === recent.chapterId);
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

  return {
    categories,
    allMangas,
    favorites,
    recents,
    scanIndex: {
      updatedAt: new Date().toISOString(),
      entries: scanEntries.filter(Boolean)
    }
  };
}

function scanLibrary(persistedState) {
  return measureSync('library.scan', () => scanLibraryInner(persistedState), {
    categoryCount: Array.isArray(persistedState?.categories) ? persistedState.categories.length : 0
  });
}

function buildCompactIndex(library) {
  return (library.allMangas || []).map((manga) => ({
    id: manga.id,
    contentId: manga.contentId,
    locationId: manga.locationId,
    displayTitle: manga.displayTitle,
    author: manga.author,
    coverSrc: manga.coverSrc,
    coverType: manga.coverType,
    coverMediaType: manga.coverMediaType,
    coverFilePath: manga.coverFilePath,
    coverPageNumber: manga.coverPageNumber,
    isFavorite: manga.isFavorite,
    isRead: manga.isRead,
    readingState: manga.readingState,
    progressPercent: manga.progressPercent,
    chapterCount: manga.chapterCount,
    completedChapterCount: manga.completedChapterCount,
    categoryId: manga.categoryId,
    categoryName: manga.categoryName,
    tags: manga.tags,
    collectionIds: manga.collectionIds,
    hasNewChapters: manga.hasNewChapters,
    addedAt: manga.addedAt,
    lastReadAt: manga.lastReadAt,
    healthStatus: manga.healthStatus
  }));
}

module.exports = {
  scanLibrary,
  getChapterPages,
  makeId,
  makeLocationId,
  toFileSrc,
  toCbzSrc,
  isImageFile,
  isPdfFile,
  isCbzFile,
  buildCompactIndex,
  areScanIndexesEquivalent
};
