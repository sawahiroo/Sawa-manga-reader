const crypto = require('crypto');

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function normalizeIdentityText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function strongDigest(parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    hash.update(String(part || ''));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function getChapterFingerprint(chapter = {}) {
  const pageKeys = uniqueStrings((chapter.pages || []).map((page) =>
    String(page?.strongFingerprint || '').startsWith('sha256:') ? page.strongFingerprint : ''
  )).sort();
  const explicitStrong = String(chapter.strongFingerprint || '').trim();
  const strongKey = explicitStrong.startsWith('sha256:') ? explicitStrong : null;
  return {
    id: String(chapter.id || chapter.legacyId || '').trim(),
    contentId: strongKey || null,
    pageCount: Math.max(0, Number(chapter.pageCount || pageKeys.length || 0)),
    pageFingerprints: pageKeys,
    fingerprint: strongKey || (pageKeys.length ? `sha256:${strongDigest(pageKeys)}` : null)
  };
}

function buildIdentityRecord(manga = {}, options = {}) {
  const chapters = (Array.isArray(manga.chapters) ? manga.chapters : [])
    .map(getChapterFingerprint)
    .filter((entry) => entry.fingerprint)
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const chapterFingerprints = chapters.map((entry) => entry.fingerprint);
  const aliases = uniqueStrings([
    manga.displayTitle,
    manga.name,
    ...(Array.isArray(manga.aliases) ? manga.aliases : [])
  ]);
  const externalIds = uniqueStrings([
    manga.malId,
    manga.anilistId,
    manga.mangadexId,
    manga.comicInfo?.web,
    ...(Array.isArray(manga.externalIds) ? manga.externalIds : []),
    ...(Array.isArray(options.externalIds) ? options.externalIds : [])
  ]);
  return {
    mangaId: String(manga.id || manga.legacyId || '').trim(),
    contentId: String(manga.contentId || '').trim() || null,
    path: String(manga.path || '').trim() || null,
    title: String(manga.displayTitle || manga.name || '').trim(),
    normalizedTitles: uniqueStrings(aliases.map(normalizeIdentityText)),
    author: String(manga.author || '').trim(),
    normalizedAuthor: normalizeIdentityText(manga.author),
    externalIds,
    private: Boolean(manga.isPrivate || options.private),
    lastReadAt: manga.lastReadAt || null,
    chapterFingerprints,
    chapters,
    strongFingerprint: chapterFingerprints.length
      ? strongDigest([chapterFingerprints.length, ...chapterFingerprints])
      : null,
    updatedAt: options.updatedAt || new Date().toISOString()
  };
}

function fingerprintOverlap(left = {}, right = {}) {
  const leftSet = new Set(left.chapterFingerprints || []);
  const rightSet = new Set(right.chapterFingerprints || []);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let matches = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) matches += 1;
  }
  return matches / Math.max(leftSet.size, rightSet.size);
}

function metadataCoherence(left = {}, right = {}) {
  const leftTitles = new Set(left.normalizedTitles || []);
  const titleMatch = (right.normalizedTitles || []).some((title) => title && leftTitles.has(title));
  const authorMatch = Boolean(
    left.normalizedAuthor
    && right.normalizedAuthor
    && left.normalizedAuthor === right.normalizedAuthor
  );
  const externalIds = new Set(left.externalIds || []);
  const externalMatch = (right.externalIds || []).some((id) => externalIds.has(id));
  return { titleMatch, authorMatch, externalMatch, coherent: titleMatch || authorMatch || externalMatch };
}

function classifyIdentityPair(left = {}, right = {}) {
  if (!left.mangaId || !right.mangaId || left.mangaId === right.mangaId) {
    return { kind: 'none', overlap: 0, reasons: [] };
  }
  if (Boolean(left.private) !== Boolean(right.private)) {
    return { kind: 'blocked-vault', overlap: 0, reasons: ['frontiere-coffre'] };
  }
  const coherence = metadataCoherence(left, right);
  const exact = Boolean(
    left.strongFingerprint
    && right.strongFingerprint
    && left.strongFingerprint === right.strongFingerprint
  );
  if (exact) {
    return {
      kind: 'exact',
      overlap: 1,
      reasons: ['empreinte-forte', ...(coherence.coherent ? ['metadonnees-coherentes'] : [])]
    };
  }
  const overlap = fingerprintOverlap(left, right);
  if (overlap >= 0.7 && coherence.coherent) {
    return {
      kind: 'probable',
      overlap,
      reasons: [
        `chapitres-${Math.round(overlap * 100)}%`,
        coherence.externalMatch ? 'identifiant-externe' : (coherence.titleMatch ? 'titre' : 'auteur')
      ]
    };
  }
  return { kind: 'none', overlap, reasons: [] };
}

function suggestionId(kind, leftId, rightId) {
  return `${kind}-${strongDigest([leftId, rightId].sort()).slice(0, 16)}`;
}

function analyzeIdentityRecords(previousRecords = {}, currentRecords = {}) {
  const previous = Object.values(previousRecords || {}).filter((record) => record?.mangaId);
  const current = Object.values(currentRecords || {}).filter((record) => record?.mangaId);
  const currentIds = new Set(current.map((record) => record.mangaId));
  const missingPrevious = previous.filter((record) => !currentIds.has(record.mangaId));
  const candidatesByPrevious = new Map();

  for (const oldRecord of missingPrevious) {
    const candidates = [];
    for (const nextRecord of current) {
      const classification = classifyIdentityPair(oldRecord, nextRecord);
      if (classification.kind === 'exact' || classification.kind === 'probable') {
        candidates.push({ oldRecord, nextRecord, ...classification });
      }
    }
    if (candidates.length) candidatesByPrevious.set(oldRecord.mangaId, candidates);
  }

  const exactMoves = [];
  const suggestions = [];
  const ambiguous = [];
  const claimedCurrent = new Map();

  for (const candidates of candidatesByPrevious.values()) {
    const exact = candidates.filter((entry) => entry.kind === 'exact');
    if (exact.length === 1) {
      const match = exact[0];
      const claims = claimedCurrent.get(match.nextRecord.mangaId) || [];
      claims.push(match);
      claimedCurrent.set(match.nextRecord.mangaId, claims);
      continue;
    }
    if (exact.length > 1) {
      ambiguous.push({ previousId: candidates[0].oldRecord.mangaId, candidateIds: exact.map((entry) => entry.nextRecord.mangaId) });
      continue;
    }
    const probable = candidates
      .filter((entry) => entry.kind === 'probable')
      .sort((left, right) => right.overlap - left.overlap);
    if (probable.length > 1 && Math.abs(probable[0].overlap - probable[1].overlap) < 0.05) {
      ambiguous.push({ previousId: probable[0].oldRecord.mangaId, candidateIds: probable.map((entry) => entry.nextRecord.mangaId) });
      continue;
    }
    if (probable[0]) {
      suggestions.push({
        id: suggestionId('move', probable[0].oldRecord.mangaId, probable[0].nextRecord.mangaId),
        kind: 'move',
        status: 'pending',
        fromMangaId: probable[0].oldRecord.mangaId,
        toMangaId: probable[0].nextRecord.mangaId,
        fromPath: probable[0].oldRecord.path,
        toPath: probable[0].nextRecord.path,
        score: probable[0].overlap,
        reasons: probable[0].reasons,
        createdAt: new Date().toISOString()
      });
    }
  }

  for (const claims of claimedCurrent.values()) {
    if (claims.length !== 1) {
      ambiguous.push({
        previousIds: claims.map((entry) => entry.oldRecord.mangaId),
        candidateIds: [claims[0].nextRecord.mangaId]
      });
      continue;
    }
    const match = claims[0];
    exactMoves.push({
      fromMangaId: match.oldRecord.mangaId,
      toMangaId: match.nextRecord.mangaId,
      fromPath: match.oldRecord.path,
      toPath: match.nextRecord.path,
      reason: 'empreinte-forte'
    });
  }

  return { exactMoves, suggestions, ambiguous };
}

function deriveChapterMoves(previousRecord = {}, currentRecord = {}) {
  const currentByFingerprint = new Map();
  for (const chapter of currentRecord.chapters || []) {
    if (!chapter?.fingerprint || !chapter?.id) continue;
    const list = currentByFingerprint.get(chapter.fingerprint) || [];
    list.push(chapter);
    currentByFingerprint.set(chapter.fingerprint, list);
  }
  const moves = [];
  for (const previousChapter of previousRecord.chapters || []) {
    if (!previousChapter?.fingerprint || !previousChapter?.id) continue;
    const candidates = currentByFingerprint.get(previousChapter.fingerprint) || [];
    if (candidates.length === 1 && candidates[0].id !== previousChapter.id) {
      moves.push({ fromChapterId: previousChapter.id, toChapterId: candidates[0].id });
    }
  }
  return moves;
}

function buildEditionSuggestions(records = {}, workGroups = {}) {
  const values = Object.values(records || {}).filter((record) => record?.mangaId);
  const grouped = new Set(Object.values(workGroups || {}).flatMap((group) => group?.editionIds || []));
  const suggestions = [];
  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
      const left = values[leftIndex];
      const right = values[rightIndex];
      if (grouped.has(left.mangaId) || grouped.has(right.mangaId)) continue;
      const classification = classifyIdentityPair(left, right);
      if (classification.kind === 'blocked-vault') continue;
      const coherence = metadataCoherence(left, right);
      const metadataOnlyMatch = coherence.externalMatch || (coherence.titleMatch && coherence.authorMatch);
      if (!['exact', 'probable'].includes(classification.kind) && !metadataOnlyMatch) continue;
      suggestions.push({
        id: suggestionId('edition', left.mangaId, right.mangaId),
        kind: 'edition',
        status: 'pending',
        fromMangaId: left.mangaId,
        toMangaId: right.mangaId,
        fromPath: left.path,
        toPath: right.path,
        score: classification.kind === 'exact'
          ? 1
          : (classification.kind === 'probable' ? classification.overlap : (coherence.externalMatch ? 0.85 : 0.72)),
        reasons: classification.reasons.length
          ? classification.reasons
          : (coherence.externalMatch ? ['identifiant-externe'] : ['titre', 'auteur']),
        createdAt: new Date().toISOString()
      });
    }
  }
  return suggestions;
}

function replaceString(value, replacements) {
  if (typeof value !== 'string') return value;
  let next = value;
  for (const [fromId, toId] of replacements.entries()) {
    if (next === fromId) return toId;
    next = next.split(fromId).join(toId);
  }
  return next;
}

function moveRecordKey(record, fromId, toId, transform = (value) => value) {
  if (!record || typeof record !== 'object' || !(fromId in record)) return false;
  const incoming = transform(record[fromId]);
  record[toId] = toId in record
    ? mergeRecordValues(record[toId], incoming)
    : incoming;
  delete record[fromId];
  return true;
}

function timestampOf(value) {
  const timestamp = new Date(value?.updatedAt || value?.lastReadAt || value?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeRecordValues(target, source) {
  if (target === undefined || target === null) return structuredClone(source);
  if (source === undefined || source === null) return structuredClone(target);
  if (typeof target === 'boolean' || typeof source === 'boolean') return Boolean(target || source);
  if (Array.isArray(target) && Array.isArray(source)) {
    const byIdentity = new Map();
    [...source, ...target].forEach((entry, index) => {
      const key = entry && typeof entry === 'object'
        ? String(entry.id || `${entry.chapterId || ''}:${entry.pageIndex ?? ''}:${index}`)
        : String(entry);
      const previous = byIdentity.get(key);
      if (!previous || timestampOf(entry) >= timestampOf(previous)) byIdentity.set(key, structuredClone(entry));
    });
    return [...byIdentity.values()].sort((left, right) => timestampOf(right) - timestampOf(left));
  }
  if (typeof target === 'object' && typeof source === 'object') {
    const newer = timestampOf(source) > timestampOf(target) ? source : target;
    const older = newer === source ? target : source;
    const merged = { ...structuredClone(older), ...structuredClone(newer) };
    for (const key of new Set([...Object.keys(older), ...Object.keys(newer)])) {
      const newerValue = newer[key];
      const olderValue = older[key];
      if (Array.isArray(newerValue) && Array.isArray(olderValue)) {
        merged[key] = mergeRecordValues(newerValue, olderValue);
      } else if (
        newerValue && olderValue
        && typeof newerValue === 'object' && typeof olderValue === 'object'
      ) {
        merged[key] = mergeRecordValues(newerValue, olderValue);
      } else if (newerValue === undefined || newerValue === null || newerValue === '') {
        merged[key] = structuredClone(olderValue);
      }
    }
    if ('pageIndex' in target || 'pageIndex' in source) {
      const targetPage = Number(target.pageIndex || 0);
      const sourcePage = Number(source.pageIndex || 0);
      if (timestampOf(target) === timestampOf(source)) merged.pageIndex = Math.max(targetPage, sourcePage);
    }
    return merged;
  }
  return target || source;
}

function stripPrivateIdentityState(clientState, privateMangaIds = new Set()) {
  const privateIds = new Set(privateMangaIds || []);
  for (const [mangaId, record] of Object.entries(clientState.identityRecords || {})) {
    if (record?.private) privateIds.add(mangaId);
  }
  for (const mangaId of privateIds) {
    delete clientState.identityRecords?.[mangaId];
    delete clientState.identityAliases?.[mangaId];
  }
  for (const [alias, target] of Object.entries(clientState.identityAliases || {})) {
    if (privateIds.has(target)) delete clientState.identityAliases[alias];
  }
  clientState.identitySuggestions = (clientState.identitySuggestions || []).filter((suggestion) => (
    !privateIds.has(suggestion.fromMangaId)
    && !privateIds.has(suggestion.toMangaId)
  ));
  clientState.identityMediaIssues = (clientState.identityMediaIssues || [])
    .filter((issue) => !privateIds.has(issue?.mangaId));
  clientState.workGroups = Object.fromEntries(Object.entries(clientState.workGroups || {})
    .filter(([, group]) => (
      !group?.private
      && !(group?.editionIds || []).some((mangaId) => privateIds.has(mangaId))
    )));
  return clientState;
}

function remapSession(session, mangaMap, chapterMap) {
  if (!session || typeof session !== 'object') return;
  const remapView = (view) => {
    if (!view || typeof view !== 'object') return view;
    return {
      ...view,
      mangaId: mangaMap.get(view.mangaId) || view.mangaId || null,
      chapterId: chapterMap.get(view.chapterId) || view.chapterId || null
    };
  };
  const remapTab = (tab) => ({
    ...tab,
    view: tab?.view ? remapView(tab.view) : tab?.view,
    stack: Array.isArray(tab?.stack) ? tab.stack.map(remapView) : tab?.stack
  });
  if (Array.isArray(session.workspaces)) {
    session.workspaces = session.workspaces.map((workspace) => ({
      ...workspace,
      tabs: Array.isArray(workspace?.tabs) ? workspace.tabs.map(remapTab) : []
    }));
  }
  if (Array.isArray(session.tabs)) session.tabs = session.tabs.map(remapTab);
  if (session.scrollPositions && typeof session.scrollPositions === 'object') {
    const allReplacements = new Map([...mangaMap.entries(), ...chapterMap.entries()]);
    session.scrollPositions = Object.fromEntries(Object.entries(session.scrollPositions).map(([key, position]) => [
      replaceString(key, allReplacements),
      {
        ...(position || {}),
        anchorId: allReplacements.get(position?.anchorId) || position?.anchorId || null
      }
    ]));
  }
}

function remapPersistedReferences(state, mangaEntries = [], chapterEntries = []) {
  const mangaMap = new Map(mangaEntries.map((entry) => [String(entry.fromMangaId || entry.fromId || ''), String(entry.toMangaId || entry.toId || '')]).filter(([fromId, toId]) => fromId && toId && fromId !== toId));
  const chapterMap = new Map(chapterEntries.map((entry) => [String(entry.fromChapterId || entry.fromId || ''), String(entry.toChapterId || entry.toId || '')]).filter(([fromId, toId]) => fromId && toId && fromId !== toId));
  const keyedMangaRecords = [
    'metadata', 'metadataLocks', 'metadataFieldSource', 'favorites', 'mangaTags',
    'mangaTagMeta', 'annotations', 'readingStates', 'readStatus', 'knownChapterCounts',
    'identityRecords', 'coverProfiles', 'deletionTombstones'
  ];
  for (const [fromId, toId] of mangaMap.entries()) {
    for (const key of keyedMangaRecords) {
      moveRecordKey(state[key], fromId, toId, (value) => {
        if (key !== 'annotations' || !Array.isArray(value)) return value;
        return value.map((annotation) => ({ ...annotation, mangaId: toId }));
      });
    }
    state.metadataWorkbenchQueue = uniqueStrings((state.metadataWorkbenchQueue || []).map((value) => mangaMap.get(value) || value));
    state.metadataWorkbenchItems = (state.metadataWorkbenchItems || []).map((item) => ({
      ...item,
      mangaId: mangaMap.get(String(item?.mangaId || '')) || item?.mangaId
    }));
    if (Array.isArray(state.metadataWorkbenchLastBatch?.entries)) {
      state.metadataWorkbenchLastBatch.entries = state.metadataWorkbenchLastBatch.entries.map((entry) => ({
        ...entry,
        mangaId: mangaMap.get(String(entry?.mangaId || '')) || entry?.mangaId
      }));
    }
    if (state.vault) state.vault.privateMangaIds = uniqueStrings((state.vault.privateMangaIds || []).map((value) => mangaMap.get(value) || value));
    state.recents = (state.recents || []).map((entry) => ({ ...entry, mangaId: mangaMap.get(entry.mangaId) || entry.mangaId }));
    state.readingQueue = (state.readingQueue || []).map((entry) => ({ ...entry, mangaId: mangaMap.get(entry.mangaId) || entry.mangaId }));
    for (const collection of Object.values(state.collections || {})) {
      collection.mangaIds = uniqueStrings((collection.mangaIds || []).map((value) => mangaMap.get(value) || value));
    }
    for (const progress of Object.values(state.progress || {})) {
      if (progress?.mangaId === fromId) progress.mangaId = toId;
    }
    for (const group of Object.values(state.workGroups || {})) {
      group.editionIds = uniqueStrings((group.editionIds || []).map((value) => mangaMap.get(value) || value));
      if (group.preferredEditionId === fromId) group.preferredEditionId = toId;
    }
    if (state.readerPrefs?.visual?.byManga) {
      moveRecordKey(state.readerPrefs.visual.byManga, fromId, toId);
    }
    state.identitySuggestions = (state.identitySuggestions || []).map((entry) => ({
      ...entry,
      fromMangaId: mangaMap.get(String(entry?.fromMangaId || '')) || entry?.fromMangaId,
      toMangaId: mangaMap.get(String(entry?.toMangaId || '')) || entry?.toMangaId
    }));
    state.identityMediaIssues = (state.identityMediaIssues || []).map((entry) => ({
      ...entry,
      mangaId: mangaMap.get(String(entry?.mangaId || '')) || entry?.mangaId
    }));
    state.identityAliases = state.identityAliases || {};
    state.identityAliases[fromId] = toId;
  }
  for (const [fromId, toId] of chapterMap.entries()) {
    moveRecordKey(state.progress, fromId, toId, (value) => ({ ...(value || {}), chapterId: toId }));
    moveRecordKey(state.chapterStates, fromId, toId);
    moveRecordKey(state.chapterReadStatus, fromId, toId);
    state.recents = (state.recents || []).map((entry) => ({ ...entry, chapterId: chapterMap.get(entry.chapterId) || entry.chapterId }));
    state.readingQueue = (state.readingQueue || []).map((entry) => ({ ...entry, chapterId: chapterMap.get(entry.chapterId) || entry.chapterId }));
    for (const annotations of Object.values(state.annotations || {})) {
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (annotation?.chapterId === fromId) annotation.chapterId = toId;
      }
    }
    if (state.readerPrefs?.guidedView?.panelMaps) {
      moveRecordKey(state.readerPrefs.guidedView.panelMaps, fromId, toId, (value) => ({
        ...(value || {}),
        chapterRef: toId
      }));
    }
    state.identityMediaIssues = (state.identityMediaIssues || []).map((entry) => ({
      ...entry,
      chapterId: chapterMap.get(String(entry?.chapterId || '')) || entry?.chapterId
    }));
  }
  remapSession(state.session, mangaMap, chapterMap);
  return state;
}

function remapSourceLinks(links = [], mangaEntries = []) {
  const mangaMap = new Map(mangaEntries.map((entry) => [entry.fromMangaId || entry.fromId, entry.toMangaId || entry.toId]));
  return (Array.isArray(links) ? links : []).map((link) => ({
    ...link,
    localMangaId: mangaMap.get(link.localMangaId) || link.localMangaId,
    mangaId: mangaMap.get(link.mangaId) || link.mangaId
  }));
}

function choosePreferredEdition(editionIds, mangaById, requestedId = null) {
  if (requestedId && editionIds.includes(requestedId)) return requestedId;
  return [...editionIds].sort((leftId, rightId) => {
    const leftTime = new Date(mangaById.get(leftId)?.lastReadAt || 0).getTime();
    const rightTime = new Date(mangaById.get(rightId)?.lastReadAt || 0).getTime();
    return rightTime - leftTime;
  })[0] || null;
}

function createWorkGroup(state, mangaIds, mangas = [], options = {}) {
  const editionIds = uniqueStrings(mangaIds);
  if (editionIds.length < 2) throw new Error('Deux editions au minimum sont requises.');
  const mangaById = new Map(mangas.map((manga) => [manga.id, manga]));
  const editions = editionIds.map((id) => mangaById.get(id)).filter(Boolean);
  if (editions.length !== editionIds.length) throw new Error('Une edition est introuvable.');
  const privacy = new Set(editions.map((manga) => Boolean(manga.isPrivate)));
  if (privacy.size > 1) throw new Error('Une oeuvre ne peut pas melanger contenu public et coffre.');
  for (const group of Object.values(state.workGroups || {})) {
    if ((group.editionIds || []).some((id) => editionIds.includes(id))) {
      throw new Error('Une edition appartient deja a une oeuvre.');
    }
  }
  const groupId = String(options.id || `work-${strongDigest(editionIds.sort()).slice(0, 16)}`);
  const favorite = editionIds.some((id) => Boolean(state.favorites?.[id]));
  const tagIds = uniqueStrings(editionIds.flatMap((id) => state.mangaTags?.[id] || []));
  const collectionIds = Object.entries(state.collections || {})
    .filter(([, collection]) => (collection.mangaIds || []).some((id) => editionIds.includes(id)))
    .map(([collectionId]) => collectionId);
  const preferredEditionId = choosePreferredEdition(editionIds, mangaById, options.preferredEditionId);
  const group = {
    id: groupId,
    title: String(options.title || mangaById.get(preferredEditionId)?.displayTitle || '').trim(),
    editionIds,
    preferredEditionId,
    favorite,
    tagIds,
    collectionIds,
    private: privacy.has(true),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.workGroups = state.workGroups || {};
  state.workGroups[groupId] = group;
  for (const id of editionIds) {
    if (favorite) state.favorites[id] = true;
    state.mangaTags[id] = [...tagIds];
  }
  for (const collectionId of collectionIds) {
    const collection = state.collections?.[collectionId];
    if (collection) collection.mangaIds = uniqueStrings([...(collection.mangaIds || []), ...editionIds]);
  }
  return group;
}

function ungroupWork(state, groupId) {
  const group = state.workGroups?.[groupId];
  if (!group) return null;
  for (const id of group.editionIds || []) {
    if (group.favorite) state.favorites[id] = true;
    state.mangaTags[id] = uniqueStrings([...(state.mangaTags?.[id] || []), ...(group.tagIds || [])]);
  }
  for (const collectionId of group.collectionIds || []) {
    const collection = state.collections?.[collectionId];
    if (collection) collection.mangaIds = uniqueStrings([...(collection.mangaIds || []), ...(group.editionIds || [])]);
  }
  delete state.workGroups[groupId];
  return group;
}

function setPreferredEdition(state, groupId, mangaId) {
  const group = state.workGroups?.[groupId];
  if (!group || !(group.editionIds || []).includes(mangaId)) return false;
  group.preferredEditionId = mangaId;
  group.updatedAt = new Date().toISOString();
  return true;
}

function projectCanonicalWorks(mangas = [], workGroups = {}) {
  const byId = new Map(mangas.map((manga) => [manga.id, manga]));
  const hidden = new Set();
  const annotations = new Map();
  for (const group of Object.values(workGroups || {})) {
    const editions = (group.editionIds || []).map((id) => byId.get(id)).filter(Boolean);
    if (editions.length < 2) continue;
    const preferredId = choosePreferredEdition(group.editionIds || [], byId, group.preferredEditionId);
    for (const edition of editions) {
      if (edition.id !== preferredId) hidden.add(edition.id);
    }
    annotations.set(preferredId, {
      workGroupId: group.id,
      editionCount: editions.length,
      preferredEditionId: preferredId,
      editions: editions.map((edition) => ({
        id: edition.id,
        title: edition.displayTitle,
        path: edition.path,
        lastReadAt: edition.lastReadAt || null
      }))
    });
  }
  return mangas
    .filter((manga) => !hidden.has(manga.id))
    .map((manga) => annotations.has(manga.id) ? { ...manga, workGroup: annotations.get(manga.id) } : manga);
}

module.exports = {
  analyzeIdentityRecords,
  buildEditionSuggestions,
  buildIdentityRecord,
  choosePreferredEdition,
  classifyIdentityPair,
  createWorkGroup,
  deriveChapterMoves,
  fingerprintOverlap,
  metadataCoherence,
  mergeRecordValues,
  normalizeIdentityText,
  projectCanonicalWorks,
  remapPersistedReferences,
  remapSourceLinks,
  setPreferredEdition,
  stripPrivateIdentityState,
  ungroupWork,
  uniqueStrings
};
