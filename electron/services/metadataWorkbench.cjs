const DEFAULT_MATCH_POLICY = Object.freeze({
  confidenceThreshold: 0.96,
  marginThreshold: 0.15
});

/** @typedef {{ confidenceThreshold:number, marginThreshold:number }} BatchMatchPolicy */
/** @typedef {{ mangaId:string, order:number, status:string, candidate:Object|null }} WorkbenchItemState */
/** @typedef {{ total:number, processed:number, review:number, error:number, counts:Object }} WorkbenchSummary */

const STATUS_FILTERS = new Set([
  'all',
  'attention',
  'pending',
  'reliable',
  'review',
  'no-result',
  'error',
  'done',
  'interrupted'
]);

const ATTENTION_STATUSES = new Set(['review', 'no-result', 'error', 'interrupted']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeMatchText(value) {
  return normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\[[^\]]*]|\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean))];
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const before = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
      diagonal = before;
    }
  }
  return previous[right.length];
}

function textSimilarity(left, right) {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(0, 1 - (levenshtein(a, b) / Math.max(a.length, b.length)));
}

function knownExternalId(local = {}, candidate = {}) {
  const pairs = [
    ['mangaDexId', 'mangaDexId'],
    ['anilistId', 'anilistId'],
    ['malId', 'malId'],
    ['nhentaiId', 'nhentaiId']
  ];
  return pairs.some(([localKey, candidateKey]) => {
    const localId = normalizeText(local?.[localKey]);
    return localId && localId === normalizeText(candidate?.[candidateKey]);
  }) || (
    normalizeText(local?.onlineSource) === normalizeText(candidate?.source)
    && normalizeText(local?.onlineSourceId)
    && normalizeText(local?.onlineSourceId) === normalizeText(candidate?.sourceId)
  );
}

function candidateTitles(candidate = {}) {
  return uniqueStrings([
    candidate.title,
    candidate.titleEnglish,
    candidate.titleJapanese,
    ...(candidate.altTitles || [])
  ]);
}

function localTitles(manga = {}) {
  return uniqueStrings([
    manga.displayTitle,
    manga.title,
    manga.folderName,
    ...(manga.aliases || []),
    ...(manga.onlineAltTitles || [])
  ]);
}

function hasAuthorSignal(manga = {}, candidate = {}) {
  const localAuthors = uniqueStrings([manga.author, manga.onlineAuthor]).flatMap((value) => normalizeMatchText(value).split(/[,;/]/)).filter(Boolean);
  const remoteAuthors = normalizeMatchText(candidate.authors).split(/[,;/]/).filter(Boolean);
  return localAuthors.some((author) => remoteAuthors.some((remote) => author === remote || textSimilarity(author, remote) >= 0.92));
}

function hasCountSignal(manga = {}, candidate = {}) {
  const localPages = Number(manga.pageCount || manga.totalPages || 0);
  const remotePages = Number(candidate.pages || 0);
  if (localPages > 0 && remotePages > 0) {
    const delta = Math.abs(localPages - remotePages) / Math.max(localPages, remotePages);
    if (delta <= 0.08) return true;
  }
  const localChapters = Number(manga.chapterCount || 0);
  const remoteChapters = Number(candidate.chapters || 0);
  return localChapters > 0 && remoteChapters > 0 && localChapters === remoteChapters;
}

function hasTypeSignal(manga = {}, candidate = {}) {
  const localType = normalizeMatchText(manga.type || manga.format || '');
  const remoteType = normalizeMatchText(candidate.type || candidate.format || candidate.status || '');
  return Boolean(localType && remoteType && (localType === remoteType || localType.includes(remoteType) || remoteType.includes(localType)));
}

function scoreMetadataCandidate(manga = {}, candidate = {}) {
  const reasons = [];
  if (knownExternalId(manga, candidate)) {
    return { confidence: 1, reasons: ['external-id'], exactTitle: true, corroboratingSignal: true };
  }
  const local = localTitles(manga);
  const remote = candidateTitles(candidate);
  let bestSimilarity = 0;
  let exactTitle = false;
  for (const left of local) {
    for (const right of remote) {
      const similarity = textSimilarity(left, right);
      bestSimilarity = Math.max(bestSimilarity, similarity);
      if (normalizeMatchText(left) && normalizeMatchText(left) === normalizeMatchText(right)) exactTitle = true;
    }
  }
  if (exactTitle) reasons.push('exact-title');
  else if (bestSimilarity >= 0.92) reasons.push('near-title');
  const author = hasAuthorSignal(manga, candidate);
  const count = hasCountSignal(manga, candidate);
  const type = hasTypeSignal(manga, candidate);
  if (author) reasons.push('author');
  if (count) reasons.push('count');
  if (type) reasons.push('type');
  const corroboratingSignal = author || count || type;
  let confidence = bestSimilarity * 0.82;
  if (exactTitle) confidence = 0.84;
  if (corroboratingSignal) confidence += exactTitle ? 0.14 : 0.09;
  if ([author, count, type].filter(Boolean).length >= 2) confidence += 0.02;
  return {
    confidence: Math.max(0, Math.min(0.99, Number(confidence.toFixed(4)))),
    reasons,
    exactTitle,
    corroboratingSignal
  };
}

function rankMetadataCandidates(manga, candidates = [], policy = DEFAULT_MATCH_POLICY) {
  const ranked = (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    candidate,
    ...scoreMetadataCandidate(manga, candidate)
  })).sort((left, right) => right.confidence - left.confidence);
  const first = ranked[0] || null;
  const second = ranked[1] || null;
  const margin = first ? Math.max(0, first.confidence - (second?.confidence || 0)) : 0;
  const safelyAutomatic = Boolean(first && (
    first.reasons.includes('external-id')
    || (first.exactTitle && first.corroboratingSignal)
  ) && first.confidence >= Number(policy.confidenceThreshold ?? DEFAULT_MATCH_POLICY.confidenceThreshold)
    && margin >= Number(policy.marginThreshold ?? DEFAULT_MATCH_POLICY.marginThreshold));
  return {
    ranked,
    best: first?.candidate || null,
    confidence: first?.confidence || 0,
    margin: Number(margin.toFixed(4)),
    reasons: first?.reasons || [],
    safelyAutomatic,
    status: !first ? 'no-result' : safelyAutomatic ? 'reliable' : 'review'
  };
}

function candidateMetadataPatch(candidate = {}) {
  const genres = uniqueStrings([...(candidate.genres || []), ...(candidate.tags || [])]);
  return Object.fromEntries([
    ['onlineTitle', candidate.title],
    ['titleEnglish', candidate.titleEnglish],
    ['titleJapanese', candidate.titleJapanese],
    ['onlineDescription', candidate.synopsis],
    ['onlineAuthor', candidate.authors],
    ['onlineGenres', genres.length ? genres : null],
    ['onlineSource', candidate.source],
    ['onlineSourceLabel', candidate.sourceLabel],
    ['onlineSourceId', candidate.sourceId],
    ['mangaDexId', candidate.mangaDexId],
    ['anilistId', candidate.anilistId],
    ['nhentaiId', candidate.nhentaiId],
    ['malId', candidate.malId],
    ['onlineAltTitles', uniqueStrings(candidate.altTitles)]
  ].filter(([, value]) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)));
}

function resolveSafeMetadataPatch({ mangaId, candidate, metadata = {}, locks = {}, fieldSources = {} } = {}) {
  const source = metadata?.[mangaId] || {};
  const lockMap = locks?.[mangaId] || {};
  const provenance = fieldSources?.[mangaId] || {};
  const requested = candidateMetadataPatch(candidate);
  const patch = {};
  const skipped = {};
  for (const [field, value] of Object.entries(requested)) {
    if (lockMap[field]) {
      skipped[field] = 'locked';
      continue;
    }
    const existing = source[field];
    const existingSource = normalizeText(provenance[field]);
    const canReplace = existing === undefined || existing === null || existing === '' || existingSource === 'online';
    if (!canReplace) {
      skipped[field] = 'manual';
      continue;
    }
    patch[field] = value;
  }
  return { patch, skipped, fields: Object.keys(patch) };
}

function summarizeWorkbench(items = []) {
  const counts = Object.fromEntries([...STATUS_FILTERS].map((status) => [status, 0]));
  for (const item of Array.isArray(items) ? items : []) {
    const status = STATUS_FILTERS.has(item?.status) ? item.status : 'pending';
    counts[status] += 1;
    counts.all += 1;
    if (ATTENTION_STATUSES.has(status)) counts.attention += 1;
  }
  return {
    total: counts.all,
    pending: counts.pending,
    reliable: counts.reliable,
    review: counts.review,
    noResult: counts['no-result'],
    error: counts.error,
    done: counts.done,
    interrupted: counts.interrupted,
    processed: counts.reliable + counts.review + counts['no-result'] + counts.error + counts.done,
    counts
  };
}

function filterWorkbenchItems(items = [], status = 'all') {
  const normalizedStatus = STATUS_FILTERS.has(status) ? status : 'all';
  if (normalizedStatus === 'all') return [...items];
  if (normalizedStatus === 'attention') {
    return items.filter((item) => ATTENTION_STATUSES.has(item?.status));
  }
  return items.filter((item) => item?.status === normalizedStatus);
}

function getWorkbenchSelectionIds(items = [], { status = 'all' } = {}) {
  return filterWorkbenchItems(Array.isArray(items) ? items : [], status)
    .map((item) => String(item?.mangaId || '').trim())
    .filter(Boolean);
}

function getWorkbenchPage(items = [], { status = 'all', offset = 0, limit = 100 } = {}) {
  const filtered = filterWorkbenchItems(items, status);
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.max(1, Math.min(250, Number(limit) || 100));
  return {
    items: filtered.slice(start, start + size),
    offset: start,
    limit: size,
    total: filtered.length,
    summary: summarizeWorkbench(items)
  };
}

module.exports = {
  DEFAULT_MATCH_POLICY,
  STATUS_FILTERS,
  candidateMetadataPatch,
  filterWorkbenchItems,
  getWorkbenchPage,
  getWorkbenchSelectionIds,
  normalizeMatchText,
  rankMetadataCandidates,
  resolveSafeMetadataPatch,
  scoreMetadataCandidate,
  summarizeWorkbench,
  textSimilarity
};
