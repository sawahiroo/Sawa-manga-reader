const fs = require('fs');
const path = require('path');

const { listAvailablePlugins } = require('./plugins.cjs');
const {
  SOURCE_PLUGIN_ID,
  getSourceRuntimeImportsDir,
  startRuntime,
  listConnectors,
  resolveConnector,
  getConnectorPrefs,
  setConnectorPrefs,
  markRuntimeSelection,
  hasImportedChapter,
  recordImportHistory,
  upsertSeriesLinkFromImport,
  getSeriesLinkForManga,
  getImportedChapterIdsForSeries,
  markSeriesRecent
} = require('./sourceRuntime.cjs');
const suwayomiRuntime = require('./suwayomiRuntime.cjs');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function normalizeText(input, fallback = '') {
  const value = String(input || '').trim();
  return value || fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeSearchNeedle(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function scoreSuwayomiSeriesMatch(series = {}, query = '') {
  const needle = normalizeSearchNeedle(query);
  if (!needle) return 0;
  const title = normalizeSearchNeedle(series?.title);
  const subtitle = normalizeSearchNeedle(series?.author || series?.artist);
  const description = normalizeSearchNeedle(series?.description);
  const haystack = [title, subtitle, description].filter(Boolean).join(' ');
  if (!haystack) return 0;

  const tokens = needle.split(/\s+/).filter(Boolean);
  let score = 0;
  if (title === needle) score += 260;
  if (title.startsWith(needle)) score += 160;
  if (title.includes(needle)) score += 120;
  if (subtitle.includes(needle)) score += 60;
  if (description.includes(needle)) score += 24;

  tokens.forEach((token) => {
    if (title.includes(token)) score += 26;
    else if (subtitle.includes(token)) score += 10;
    else if (description.includes(token)) score += 6;
  });

  return score;
}

function rankSuwayomiSeriesMatches(items = [], query = '') {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ item, score: scoreSuwayomiSeriesMatch(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item);
}

async function collectSuwayomiSearchCandidates({ connector, query, desiredLimit }) {
  const collected = new Map();
  const normalizedQuery = normalizeText(query);

  async function collect(type, pages = [0]) {
    for (const page of pages) {
      let payload = null;
      try {
        payload = await suwayomiRuntime.searchSourceManga({
          sourceId: connector.sourceId,
          query: type === 'SEARCH' ? normalizedQuery : '',
          page,
          filters: [],
          type
        });
      } catch (_error) {
        if (type === 'SEARCH') {
          continue;
        }
        break;
      }
      const mangas = Array.isArray(payload?.mangas) ? payload.mangas : [];
      mangas.forEach((item) => {
        const key = String(item?.id || '').trim();
        if (!key || collected.has(key)) return;
        collected.set(key, item);
      });
      if (collected.size >= desiredLimit) {
        return;
      }
      if (!payload?.hasNextPage) {
        return;
      }
    }
  }

  await collect('SEARCH', [0, 1, 2]);
  const directMatches = [...collected.values()];
  if (directMatches.length >= desiredLimit) {
    return directMatches.slice(0, desiredLimit);
  }

  await collect('POPULAR', [0, 1, 2, 3]);
  if (collected.size < desiredLimit) {
    await collect('LATEST', [0, 1, 2, 3]);
  }
  return [...collected.values()];
}

function sanitizePathSegment(input, fallback = 'Sans titre') {
  const value = String(input || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return value || fallback;
}

function isSourcesAddonEnabled(state = {}) {
  const plugin = listAvailablePlugins(state).find((entry) => entry.id === SOURCE_PLUGIN_ID);
  return Boolean(plugin?.installed && plugin?.enabled);
}

function assertSourcesAddonEnabled(state = {}) {
  if (!isSourcesAddonEnabled(state)) {
    throw new Error('Active d abord l addon Sources web.');
  }
}

function runtimeFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'Sawa Manga Library/5.0.1',
      ...(options.headers || {})
    }
  });
}

async function fetchJson(url, options = {}) {
  const response = await runtimeFetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchBuffer(url, options = {}) {
  const response = await runtimeFetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function pickLocalizedText(dictionary = {}, languages = ['fr', 'en']) {
  for (const language of languages) {
    const value = normalizeText(dictionary?.[language]);
    if (value) return value;
  }
  for (const value of Object.values(dictionary || {})) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return '';
}

function getRelationship(relationships = [], type) {
  return (relationships || []).find((entry) => entry?.type === type) || null;
}

function buildIncludedLookup(included = []) {
  const lookup = new Map();
  for (const entity of included || []) {
    if (!entity?.id || !entity?.type) continue;
    lookup.set(`${entity.type}:${entity.id}`, entity);
  }
  return lookup;
}

function getRelatedEntity(item, type, includedLookup = new Map()) {
  const relationship = getRelationship(item?.relationships, type);
  if (!relationship) return null;
  if (relationship?.attributes?.fileName || relationship?.attributes?.file_name || relationship?.attributes?.name) {
    return relationship;
  }
  return includedLookup.get(`${type}:${relationship.id}`) || relationship;
}

function buildCoverUrl(mangaId, coverRelationship) {
  const fileName = normalizeText(
    coverRelationship?.attributes?.fileName
    || coverRelationship?.attributes?.file_name
  );
  if (!mangaId || !fileName) return '';
  return `https://uploads.mangadex.org/covers/${mangaId}/${fileName}.256.jpg`;
}

function buildRemoteAssetUrl(remoteUrl) {
  const normalized = normalizeText(remoteUrl);
  if (!normalized) return '';
  return `manga://remote/${encodeURIComponent(normalized)}`;
}

function isSuwayomiConnector(connector) {
  return normalizeText(connector?.runtimeKind) === 'suwayomi';
}

function resolveSuwayomiAssetUrl(remoteUrl) {
  const absoluteUrl = suwayomiRuntime.resolveRuntimeUrl(remoteUrl);
  return {
    url: absoluteUrl,
    previewSrc: buildRemoteAssetUrl(absoluteUrl)
  };
}

function mapSuwayomiSeries(item, connector = null) {
  const cover = resolveSuwayomiAssetUrl(item?.thumbnailUrl);
  const authorLabel = firstNonEmpty(item?.author, item?.artist);
  const connectorLanguage = normalizeText(connector?.language).toUpperCase();
  const statusLabel = normalizeText(item?.status).toLowerCase();

  return {
    id: String(item?.id || ''),
    title: firstNonEmpty(item?.title, 'Sans titre'),
    subtitle: [authorLabel, connectorLanguage].filter(Boolean).join(' - '),
    description: normalizeText(item?.description),
    author: authorLabel,
    status: statusLabel,
    year: null,
    coverUrl: cover.url,
    coverPreviewSrc: cover.previewSrc,
    siteUrl: firstNonEmpty(item?.realUrl, suwayomiRuntime.resolveRuntimeUrl(item?.url))
  };
}

function mapSuwayomiChapter(item, index = 0) {
  const publishedAt = normalizeText(item?.uploadDate);
  const pageCount = Number(item?.pageCount || 0);
  const scanlator = normalizeText(item?.scanlator);
  const meta = [
    scanlator,
    pageCount > 0 ? `${pageCount} pages` : '',
    publishedAt ? new Date(publishedAt).toLocaleDateString('fr-FR') : ''
  ].filter(Boolean).join(' - ');

  return {
    id: String(item?.id || ''),
    sourceId: String(item?.id || ''),
    label: normalizeText(item?.name, `Episode ${index + 1}`),
    meta,
    title: normalizeText(item?.name),
    chapter: item?.chapterNumber == null ? '' : String(item.chapterNumber),
    volume: '',
    language: '',
    pageCount,
    publishedAt,
    orderIndex: Number(item?.sourceOrder ?? index),
    siteUrl: firstNonEmpty(item?.realUrl, suwayomiRuntime.resolveRuntimeUrl(item?.url))
  };
}

function getRuntimePreferenceValue(preference) {
  switch (preference?.__typename) {
    case 'CheckBoxPreference':
    case 'SwitchPreference':
      return Boolean(preference?.currentValue ?? preference?.default ?? false);
    case 'EditTextPreference':
      return normalizeText(preference?.currentValue ?? preference?.text ?? preference?.default);
    case 'ListPreference':
      return normalizeText(preference?.currentValue ?? preference?.default);
    case 'MultiSelectListPreference':
      return Array.isArray(preference?.currentValue)
        ? preference.currentValue
        : Array.isArray(preference?.default)
          ? preference.default
          : [];
    default:
      return '';
  }
}

function mapRuntimePreferenceField(preference, position) {
  const key = normalizeText(preference?.key);
  if (!key) return null;

  const common = {
    key,
    label: firstNonEmpty(preference?.title, key),
    summary: normalizeText(preference?.summary),
    visible: preference?.visible !== false,
    position,
    runtimePreferenceType: normalizeText(preference?.__typename)
  };

  switch (preference?.__typename) {
    case 'CheckBoxPreference':
    case 'SwitchPreference':
      return {
        ...common,
        type: 'boolean',
        defaultValue: Boolean(preference?.default ?? false)
      };
    case 'EditTextPreference':
      return {
        ...common,
        type: 'text',
        defaultValue: normalizeText(preference?.default)
      };
    case 'ListPreference':
      return {
        ...common,
        type: 'select',
        defaultValue: normalizeText(preference?.default),
        options: (Array.isArray(preference?.entryValues) ? preference.entryValues : []).map((value, index) => ({
          value: String(value),
          label: String(Array.isArray(preference?.entries) ? (preference.entries[index] ?? value) : value)
        }))
      };
    case 'MultiSelectListPreference':
      return {
        ...common,
        type: 'multiselect',
        defaultValue: Array.isArray(preference?.default) ? preference.default : [],
        options: (Array.isArray(preference?.entryValues) ? preference.entryValues : []).map((value, index) => ({
          value: String(value),
          label: String(Array.isArray(preference?.entries) ? (preference.entries[index] ?? value) : value)
        }))
      };
    default:
      return null;
  }
}

function mapRuntimePreferenceSchema(preferences = []) {
  const fields = [];
  const values = {};

  (Array.isArray(preferences) ? preferences : []).forEach((preference, index) => {
    const field = mapRuntimePreferenceField(preference, index);
    if (!field || field.visible === false) return;
    fields.push(field);
    values[field.key] = getRuntimePreferenceValue(preference);
  });

  return { fields, values };
}

function buildRuntimePreferenceChange(field, value) {
  const change = {
    position: Number(field?.position || 0)
  };

  switch (field?.runtimePreferenceType) {
    case 'CheckBoxPreference':
      change.checkBoxState = Boolean(value);
      break;
    case 'SwitchPreference':
      change.switchState = Boolean(value);
      break;
    case 'EditTextPreference':
      change.editTextState = value == null ? '' : String(value);
      break;
    case 'ListPreference':
      change.listState = value == null ? '' : String(value);
      break;
    case 'MultiSelectListPreference':
      change.multiSelectState = Array.isArray(value)
        ? value.map((entry) => String(entry))
        : String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
      break;
    default:
      break;
  }

  return change;
}

function buildRuntimePageList(pages = []) {
  return (Array.isArray(pages) ? pages : []).map((pageUrl, index) => {
    const absoluteUrl = suwayomiRuntime.resolveRuntimeUrl(pageUrl);
    const parsed = (() => {
      try {
        return new URL(absoluteUrl);
      } catch (_error) {
        return null;
      }
    })();
    const fileName = parsed
      ? path.basename(parsed.pathname || '') || `page-${index + 1}.jpg`
      : `page-${index + 1}.jpg`;
    return {
      index,
      fileName,
      url: absoluteUrl
    };
  });
}

function mapMangaDexSeriesResolved(item, includedLookup = new Map()) {
  const attributes = item?.attributes || {};
  const title = pickLocalizedText(attributes.title, ['fr', 'en']) || 'Sans titre';
  const description = pickLocalizedText(attributes.description, ['fr', 'en']);
  const cover = getRelatedEntity(item, 'cover_art', includedLookup);
  const author = getRelatedEntity(item, 'author', includedLookup);
  const artist = getRelatedEntity(item, 'artist', includedLookup);
  const authorLabel = firstNonEmpty(author?.attributes?.name, artist?.attributes?.name);
  const originalLanguage = normalizeText(attributes.originalLanguage).toUpperCase();
  const coverUrl = buildCoverUrl(item.id, cover);
  const coverPreviewSrc = buildRemoteAssetUrl(coverUrl);

  return {
    id: item.id,
    title,
    subtitle: [authorLabel, originalLanguage].filter(Boolean).join(' - '),
    description,
    author: authorLabel,
    status: normalizeText(attributes.status),
    year: attributes.year || null,
    coverUrl,
    coverPreviewSrc,
    siteUrl: `https://mangadex.org/title/${item.id}`
  };
}

async function fetchMangaDexCoverEntity(coverId) {
  const normalizedCoverId = normalizeText(coverId);
  if (!normalizedCoverId) return null;
  const json = await fetchJson(`https://api.mangadex.org/cover/${normalizedCoverId}`);
  return json?.data || null;
}

async function hydrateMangaDexSeries(item, includedLookup = new Map()) {
  const initialCover = getRelatedEntity(item, 'cover_art', includedLookup);
  if (buildCoverUrl(item?.id, initialCover)) {
    return mapMangaDexSeriesResolved(item, includedLookup);
  }

  const coverId = normalizeText(initialCover?.id);
  if (!coverId) {
    return mapMangaDexSeriesResolved(item, includedLookup);
  }

  try {
    const fetchedCover = await fetchMangaDexCoverEntity(coverId);
    const nextIncludedLookup = new Map(includedLookup);
    if (fetchedCover?.id) {
      nextIncludedLookup.set(`cover_art:${fetchedCover.id}`, fetchedCover);
    }
    return mapMangaDexSeriesResolved(item, nextIncludedLookup);
  } catch (_error) {
    return mapMangaDexSeriesResolved(item, includedLookup);
  }
}

function buildChapterLabel(attributes = {}, index = 0) {
  const volume = normalizeText(attributes.volume);
  const chapterNumber = normalizeText(attributes.chapter);
  const title = normalizeText(attributes.title);
  const parts = [];
  if (volume) parts.push(`T${volume}`);
  if (chapterNumber) parts.push(`Ch ${chapterNumber}`);
  if (!parts.length) parts.push(`Episode ${index + 1}`);
  const base = parts.join(' - ');
  return title ? `${base} - ${title}` : base;
}

function mapMangaDexChapter(item, index = 0) {
  const attributes = item?.attributes || {};
  const language = normalizeText(attributes.translatedLanguage).toUpperCase();
  const pageCount = Number(attributes.pages || 0);
  const publishedAt = normalizeText(attributes.publishAt || attributes.readableAt || attributes.createdAt);
  const meta = [
    language,
    pageCount > 0 ? `${pageCount} pages` : '',
    publishedAt ? new Date(publishedAt).toLocaleDateString('fr-FR') : ''
  ].filter(Boolean).join(' - ');

  return {
    id: item.id,
    sourceId: item.id,
    label: buildChapterLabel(attributes, index),
    meta,
    title: normalizeText(attributes.title),
    chapter: normalizeText(attributes.chapter),
    volume: normalizeText(attributes.volume),
    language: normalizeText(attributes.translatedLanguage),
    pageCount,
    publishedAt,
    orderIndex: index
  };
}

async function mangadexSearchSeries(query, limit = 12) {
  const url = new URL('https://api.mangadex.org/manga');
  url.searchParams.set('title', query);
  url.searchParams.set('limit', String(Math.max(1, Math.min(20, limit))));
  url.searchParams.set('hasAvailableChapters', 'true');
  url.searchParams.set('includes[]', 'cover_art');
  url.searchParams.set('includes[]', 'author');
  url.searchParams.set('includes[]', 'artist');
  url.searchParams.set('availableTranslatedLanguage[]', 'fr');
  url.searchParams.set('availableTranslatedLanguage[]', 'en');
  url.searchParams.set('contentRating[]', 'safe');
  url.searchParams.set('contentRating[]', 'suggestive');
  url.searchParams.set('order[relevance]', 'desc');

  const json = await fetchJson(url.toString());
  const includedLookup = buildIncludedLookup(json?.included);
  return Array.isArray(json?.data)
    ? Promise.all(json.data.map((item) => hydrateMangaDexSeries(item, includedLookup)))
    : [];
}

async function mangadexGetSeries(seriesId) {
  const url = new URL(`https://api.mangadex.org/manga/${seriesId}`);
  url.searchParams.set('includes[]', 'cover_art');
  url.searchParams.set('includes[]', 'author');
  url.searchParams.set('includes[]', 'artist');
  const json = await fetchJson(url.toString());
  return hydrateMangaDexSeries(json?.data || {}, buildIncludedLookup(json?.included));
}

async function mangadexGetChapters(seriesId) {
  const chapters = [];
  let offset = 0;
  const limit = 100;

  while (offset < 400) {
    const url = new URL('https://api.mangadex.org/chapter');
    url.searchParams.set('manga', seriesId);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('translatedLanguage[]', 'fr');
    url.searchParams.set('translatedLanguage[]', 'en');
    url.searchParams.set('order[volume]', 'asc');
    url.searchParams.set('order[chapter]', 'asc');
    url.searchParams.set('order[publishAt]', 'asc');

    const json = await fetchJson(url.toString());
    const batch = Array.isArray(json?.data) ? json.data : [];
    chapters.push(...batch);

    const total = Number(json?.total || 0);
    offset += batch.length;
    if (!batch.length || offset >= total || batch.length < limit) break;
  }

  return chapters.map((chapter, index) => mapMangaDexChapter(chapter, index));
}

async function mangadexGetPageList(chapterId) {
  const json = await fetchJson(`https://api.mangadex.org/at-home/server/${chapterId}`);
  const baseUrl = normalizeText(json?.baseUrl);
  const chapter = json?.chapter || {};
  const hash = normalizeText(chapter.hash);
  const dataFiles = Array.isArray(chapter.data) && chapter.data.length > 0
    ? chapter.data
    : (Array.isArray(chapter.dataSaver) ? chapter.dataSaver : []);

  if (!baseUrl || !hash || dataFiles.length === 0) {
    throw new Error('Pages introuvables pour ce chapitre.');
  }

  return dataFiles.map((fileName, index) => ({
    index,
    fileName,
    url: `${baseUrl}/data/${hash}/${fileName}`
  }));
}

const ADAPTERS = {
  mangadex: {
    getPreferenceSchema() {
      return [];
    },
    async searchSeries({ query, limit }) {
      return mangadexSearchSeries(query, limit);
    },
    async getSeries({ seriesId }) {
      return mangadexGetSeries(seriesId);
    },
    async getChapters({ seriesId }) {
      return mangadexGetChapters(seriesId);
    },
    async getPageList({ chapterId }) {
      return mangadexGetPageList(chapterId);
    }
  }
};

function getAdapter(connector) {
  const adapter = ADAPTERS[normalizeText(connector?.adapterId)];
  if (!adapter) {
    throw new Error('Source non compatible avec le runtime local.');
  }
  return adapter;
}

async function resolveConnectorOrThrow(state = {}, connectorId) {
  assertSourcesAddonEnabled(state);
  await startRuntime();
  const connector = resolveConnector(connectorId, state);
  if (!connector) {
    throw new Error('Source non prise en charge.');
  }
  if (connector.availability === 'incompatible') {
    throw new Error('Cette extension est visible mais non compatible avec le runtime local.');
  }
  return connector;
}

function listSourceConnectors(state = {}) {
  if (!isSourcesAddonEnabled(state)) return [];
  return listConnectors(state);
}

async function searchSourceSeries({ state = {}, connectorId, query, limit = 12 }) {
  const connector = await resolveConnectorOrThrow(state, connectorId);
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  markRuntimeSelection({ connectorId: connector.id });
  if (isSuwayomiConnector(connector)) {
    const desiredLimit = Math.max(1, Math.min(20, Number(limit || 12)));
    const mangas = await collectSuwayomiSearchCandidates({
      connector,
      query: normalizedQuery,
      desiredLimit
    });
    const ranked = rankSuwayomiSeriesMatches(mangas, normalizedQuery);
    const finalItems = (ranked.length > 0 ? ranked : mangas).slice(0, desiredLimit);
    return finalItems.map((item) => mapSuwayomiSeries(item, connector));
  }
  const adapter = getAdapter(connector);
  return adapter.searchSeries({
    connector,
    prefs: getConnectorPrefs(connector.id),
    query: normalizedQuery,
    limit
  });
}

async function getSourceSeries({ state = {}, connectorId, seriesId }) {
  const connector = await resolveConnectorOrThrow(state, connectorId);
  markRuntimeSelection({ connectorId: connector.id });
  if (isSuwayomiConnector(connector)) {
    const manga = await suwayomiRuntime.getManga(Number(seriesId));
    if (!manga) {
      throw new Error('Serie introuvable sur cette source.');
    }
    return mapSuwayomiSeries(manga, connector);
  }
  const adapter = getAdapter(connector);
  return adapter.getSeries({
    connector,
    prefs: getConnectorPrefs(connector.id),
    seriesId: normalizeText(seriesId)
  });
}

async function getSourceChapters({ state = {}, connectorId, seriesId }) {
  const connector = await resolveConnectorOrThrow(state, connectorId);
  markRuntimeSelection({ connectorId: connector.id });
  if (isSuwayomiConnector(connector)) {
    const chapters = await suwayomiRuntime.fetchChapters(Number(seriesId));
    return chapters
      .sort((left, right) => Number(left?.sourceOrder ?? 0) - Number(right?.sourceOrder ?? 0))
      .map((chapter, index) => mapSuwayomiChapter(chapter, index));
  }
  const adapter = getAdapter(connector);
  return adapter.getChapters({
    connector,
    prefs: getConnectorPrefs(connector.id),
    seriesId: normalizeText(seriesId)
  });
}

function annotateChaptersWithImportState(chapters = [], importedChapterIds = [], lastKnownChapterIds = []) {
  const importedSet = new Set((Array.isArray(importedChapterIds) ? importedChapterIds : []).map((id) => normalizeText(id)).filter(Boolean));
  const latestSet = new Set((Array.isArray(lastKnownChapterIds) ? lastKnownChapterIds : []).map((id) => normalizeText(id)).filter(Boolean));
  return (Array.isArray(chapters) ? chapters : []).map((chapter) => {
    const chapterId = normalizeText(chapter?.id || chapter?.sourceId);
    const imported = importedSet.has(chapterId);
    return {
      ...chapter,
      imported,
      isImported: imported,
      isNew: !imported && (!latestSet.size || latestSet.has(chapterId)),
      selectable: !imported
    };
  });
}

async function getSeriesContextForManga({ state = {}, manga }) {
  const link = getSeriesLinkForManga(manga);
  if (!link) {
    throw new Error('Ce manga local n est pas encore relie a une serie web.');
  }
  const connector = await resolveConnectorOrThrow(state, link.connectorId);
  const series = await getSourceSeries({
    state,
    connectorId: link.connectorId,
    seriesId: link.seriesId
  });
  markSeriesRecent({
    connectorId: link.connectorId,
    seriesId: link.seriesId,
    seriesTitle: link.seriesTitle || series?.title,
    sourceLabel: link.sourceLabel || connector.displayName,
    coverUrl: link.coverUrl || series?.coverUrl,
    localContentId: link.localContentId || manga?.contentId || manga?.id
  });
  return {
    connector,
    link,
    series
  };
}

async function getSeriesChaptersForManga({ state = {}, manga }) {
  const context = await getSeriesContextForManga({ state, manga });
  const importedChapterIds = getImportedChapterIdsForSeries({
    connectorId: context.link.connectorId,
    seriesId: context.link.seriesId,
    destinationCategoryId: context.link.destinationCategoryId
  });
  const chapters = await getSourceChapters({
    state,
    connectorId: context.link.connectorId,
    seriesId: context.link.seriesId
  });
  return {
    ...context,
    importedChapterIds,
    chapters: annotateChaptersWithImportState(chapters, importedChapterIds, context.link.lastKnownChapterIds)
  };
}

async function checkSourceUpdatesForManga({ state = {}, manga }) {
  const context = await getSeriesChaptersForManga({ state, manga });
  const lastKnownChapterIds = context.chapters.map((chapter) => chapter.id);
  upsertSeriesLinkFromImport({
    ...context.link,
    importedChapterIds: context.importedChapterIds,
    lastKnownChapterIds,
    lastCheckedAt: new Date().toISOString()
  });
  return {
    ...context,
    lastKnownChapterIds,
    newCount: context.chapters.filter((chapter) => chapter.isNew).length
  };
}

async function getSourceConnectorPrefs({ state = {}, connectorId }) {
  const connector = await resolveConnectorOrThrow(state, connectorId);
  if (isSuwayomiConnector(connector)) {
    const source = await suwayomiRuntime.getSource(connector.sourceId);
    const schema = mapRuntimePreferenceSchema(source?.preferences || []);
    setConnectorPrefs(connector.id, schema.values);
    return {
      connector,
      fields: schema.fields,
      values: schema.values
    };
  }
  const adapter = getAdapter(connector);
  return {
    connector,
    fields: typeof adapter.getPreferenceSchema === 'function'
      ? adapter.getPreferenceSchema({ connector, prefs: getConnectorPrefs(connector.id) })
      : [],
    values: getConnectorPrefs(connector.id)
  };
}

async function setSourceConnectorPrefs({ state = {}, connectorId, values = {} }) {
  const connector = await resolveConnectorOrThrow(state, connectorId);
  if (isSuwayomiConnector(connector)) {
    const source = await suwayomiRuntime.getSource(connector.sourceId);
    const schema = mapRuntimePreferenceSchema(source?.preferences || []);
    const nextValues = values && typeof values === 'object' && !Array.isArray(values)
      ? values
      : {};

    for (const field of schema.fields) {
      if (!(field.key in nextValues)) continue;
      const nextValue = nextValues[field.key];
      const currentValue = schema.values[field.key];
      if (JSON.stringify(nextValue) === JSON.stringify(currentValue)) continue;
      await suwayomiRuntime.updateSourcePreference(
        connector.sourceId,
        buildRuntimePreferenceChange(field, nextValue)
      );
    }
  }
  return setConnectorPrefs(connectorId, values);
}

function fileExtensionFromName(fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  return extension || '.jpg';
}

function padNumber(value, size = 3) {
  return String(value).padStart(size, '0');
}

function buildChapterFolderName(chapter, index) {
  const volume = normalizeText(chapter?.volume);
  const chapterNumber = normalizeText(chapter?.chapter);
  const title = normalizeText(chapter?.title);
  const parts = [];

  if (volume) parts.push(`T${volume}`);
  if (chapterNumber) parts.push(`Ch ${chapterNumber}`);
  if (!parts.length) parts.push(`Episode ${padNumber(index + 1)}`);
  if (title) parts.push(title);

  return sanitizePathSegment(parts.join(' - '), `Episode ${padNumber(index + 1)}`);
}

function atomicMoveDirectory(sourceDir, targetDir) {
  try {
    fs.renameSync(sourceDir, targetDir);
  } catch (_error) {
    fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
}

function ensureSeriesProvenanceFile(seriesDir, payload = {}) {
  const provenancePath = path.join(seriesDir, 'sawa-source.json');
  const current = fs.existsSync(provenancePath)
    ? (() => {
        try {
          return JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
        } catch (_error) {
          return null;
        }
      })()
    : null;

  const next = {
    version: 1,
    pluginId: SOURCE_PLUGIN_ID,
    connectorId: payload.connectorId || '',
    repoId: payload.repoId || '',
    extensionId: payload.extensionId || '',
    sourceId: payload.sourceId || '',
    seriesId: payload.seriesId || '',
    title: payload.title || '',
    description: payload.description || '',
    author: payload.author || '',
    status: payload.status || '',
    coverUrl: payload.coverUrl || '',
    siteUrl: payload.siteUrl || '',
    updatedAt: new Date().toISOString(),
    chapters: []
  };

  if (current && typeof current === 'object') {
    next.chapters = Array.isArray(current.chapters) ? current.chapters : [];
  }

  const incomingChapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const existing = new Map(next.chapters.map((entry) => [String(entry.chapterId || ''), entry]));
  incomingChapters.forEach((entry) => {
    const chapterId = normalizeText(entry.chapterId);
    if (!chapterId) return;
    existing.set(chapterId, {
      chapterId,
      label: normalizeText(entry.label),
      folderName: normalizeText(entry.folderName),
      importedAt: normalizeText(entry.importedAt, new Date().toISOString()),
      localPath: normalizeText(entry.localPath)
    });
  });
  next.chapters = [...existing.values()];

  fs.writeFileSync(provenancePath, JSON.stringify(next, null, 2), 'utf8');
  return provenancePath;
}

async function ensureSeriesCover(seriesDir, series) {
  const coverUrl = normalizeText(series?.coverUrl);
  if (!coverUrl) return '';
  const coverPath = path.join(seriesDir, 'cover.jpg');
  if (fs.existsSync(coverPath)) return coverPath;
  try {
    const headers = {};
    if (normalizeText(series?.siteUrl)) {
      headers.Referer = series.siteUrl;
    }
    const buffer = await fetchBuffer(coverUrl, Object.keys(headers).length ? { headers } : {});
    fs.writeFileSync(coverPath, buffer);
    return coverPath;
  } catch (_error) {
    return '';
  }
}

async function importSourceChapters({
  state = {},
  connectorId,
  seriesId,
  chapterIds = [],
  destinationDir,
  destinationCategoryId = '',
  jobId = '',
  isCancelled,
  onProgress,
  throttleMs = 0
}) {
  const connector = await resolveConnectorOrThrow(state, connectorId);
  const adapter = isSuwayomiConnector(connector) ? null : getAdapter(connector);
  const normalizedSeriesId = normalizeText(seriesId);
  const selectedIds = new Set((Array.isArray(chapterIds) ? chapterIds : []).map((chapterId) => normalizeText(chapterId)).filter(Boolean));
  if (!normalizedSeriesId || !selectedIds.size) {
    throw new Error('Aucun chapitre selectionne.');
  }

  const series = isSuwayomiConnector(connector)
    ? mapSuwayomiSeries(await suwayomiRuntime.getManga(Number(normalizedSeriesId)), connector)
    : await adapter.getSeries({
        connector,
        prefs: getConnectorPrefs(connector.id),
        seriesId: normalizedSeriesId
      });
  const chapters = isSuwayomiConnector(connector)
    ? (await suwayomiRuntime.fetchChapters(Number(normalizedSeriesId)))
        .sort((left, right) => Number(left?.sourceOrder ?? 0) - Number(right?.sourceOrder ?? 0))
        .map((chapter, index) => mapSuwayomiChapter(chapter, index))
    : await adapter.getChapters({
        connector,
        prefs: getConnectorPrefs(connector.id),
        seriesId: normalizedSeriesId
      });
  const selectedChapters = chapters.filter((chapter) => selectedIds.has(normalizeText(chapter.id)));
  if (!selectedChapters.length) {
    throw new Error('Aucun chapitre selectionne.');
  }

  const importRoot = ensureDir(path.join(getSourceRuntimeImportsDir(), sanitizePathSegment(jobId || `job-${Date.now()}`, 'job')));
  const tempSeriesDir = ensureDir(path.join(importRoot, 'series'));
  const finalSeriesDir = ensureDir(path.join(destinationDir, sanitizePathSegment(series.title)));

  let downloadedPages = 0;
  let importedCount = 0;
  let skipCount = 0;
  const importedHistory = [];
  const provenanceChapters = [];

  for (let chapterIndex = 0; chapterIndex < selectedChapters.length; chapterIndex += 1) {
    if (isCancelled?.()) {
      const error = new Error('Import annule.');
      error.code = 'IMPORT_CANCELLED';
      throw error;
    }

    const chapter = selectedChapters[chapterIndex];
    const folderName = buildChapterFolderName(chapter, chapterIndex);
    const finalChapterDir = path.join(finalSeriesDir, folderName);
    const alreadyImported = hasImportedChapter({
      repoId: connector.repoId,
      extensionId: connector.extensionId,
      connectorId: connector.id,
      sourceId: connector.sourceId,
      seriesId: normalizedSeriesId,
      chapterId: chapter.id,
      destinationCategoryId
    });

    if (alreadyImported || fs.existsSync(finalChapterDir)) {
      skipCount += 1;
      continue;
    }

    const tempChapterDir = ensureDir(path.join(tempSeriesDir, `${padNumber(chapterIndex + 1)}-${folderName}`));
    const pageList = isSuwayomiConnector(connector)
      ? buildRuntimePageList(await suwayomiRuntime.fetchChapterPages(Number(chapter.id)))
      : await adapter.getPageList({
          connector,
          prefs: getConnectorPrefs(connector.id),
          chapterId: chapter.id
        });

    for (let pageIndex = 0; pageIndex < pageList.length; pageIndex += 1) {
      if (isCancelled?.()) {
        const error = new Error('Import annule.');
        error.code = 'IMPORT_CANCELLED';
        throw error;
      }

      const page = pageList[pageIndex];
      const extension = fileExtensionFromName(page.fileName);
      const pagePath = path.join(tempChapterDir, `${padNumber(pageIndex + 1)}${extension}`);
      if (!fs.existsSync(pagePath)) {
        const headers = {};
        if (!isSuwayomiConnector(connector)) {
          headers.Referer = 'https://mangadex.org/';
        } else if (normalizeText(series?.siteUrl)) {
          headers.Referer = series.siteUrl;
        }
        const buffer = await fetchBuffer(page.url, Object.keys(headers).length ? { headers } : {});
        fs.writeFileSync(pagePath, buffer);
      }

      downloadedPages += 1;
      onProgress?.({
        chapterIndex,
        chapterCount: selectedChapters.length,
        pageIndex,
        pageCount: pageList.length,
        downloadedPages,
        chapterLabel: chapter.label,
        importedCount,
        skipCount
      });

      if (throttleMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, throttleMs));
      }
    }

    atomicMoveDirectory(tempChapterDir, finalChapterDir);
    importedCount += 1;
    importedHistory.push({
      repoId: connector.repoId,
      extensionId: connector.extensionId,
      connectorId: connector.id,
      sourceId: connector.sourceId,
      seriesId: normalizedSeriesId,
      chapterId: chapter.id,
      destinationCategoryId,
      importedAt: new Date().toISOString(),
      localPath: finalChapterDir
    });
    provenanceChapters.push({
      chapterId: chapter.id,
      label: chapter.label,
      folderName,
      importedAt: new Date().toISOString(),
      localPath: finalChapterDir
    });
  }

  if (importedHistory.length) {
    recordImportHistory(importedHistory);
    ensureSeriesProvenanceFile(finalSeriesDir, {
      connectorId: connector.id,
      repoId: connector.repoId,
      extensionId: connector.extensionId,
      sourceId: connector.sourceId,
      seriesId: normalizedSeriesId,
      title: series.title,
      description: series.description,
      author: series.author,
      status: series.status,
      coverUrl: series.coverUrl,
      siteUrl: series.siteUrl,
      chapters: provenanceChapters
    });
    await ensureSeriesCover(finalSeriesDir, series);
    upsertSeriesLinkFromImport({
      connectorId: connector.id,
      repoId: connector.repoId,
      extensionId: connector.extensionId,
      sourceId: connector.sourceId,
      seriesId: normalizedSeriesId,
      seriesTitle: series.title,
      sourceLabel: connector.displayName,
      coverUrl: series.coverUrl,
      destinationCategoryId,
      localSeriesPath: finalSeriesDir,
      importedChapterIds: importedHistory.map((entry) => entry.chapterId),
      lastKnownChapterIds: selectedChapters.map((entry) => entry.id),
      lastImportedAt: importedHistory[importedHistory.length - 1]?.importedAt || new Date().toISOString(),
      lastCheckedAt: new Date().toISOString()
    });
    markSeriesRecent({
      connectorId: connector.id,
      seriesId: normalizedSeriesId,
      seriesTitle: series.title,
      sourceLabel: connector.displayName,
      coverUrl: series.coverUrl
    });
  }

  fs.rmSync(importRoot, { recursive: true, force: true });

  return {
    seriesDir: finalSeriesDir,
    downloadedPages,
    chapterCount: importedCount,
    importedCount,
    skipCount
  };
}

module.exports = {
  SOURCE_PLUGIN_ID,
  listSourceConnectors,
  searchSourceSeries,
  getSourceSeries,
  getSourceChapters,
  getSeriesContextForManga,
  getSeriesChaptersForManga,
  checkSourceUpdatesForManga,
  getSourceConnectorPrefs,
  setSourceConnectorPrefs,
  importSourceChapters,
  sanitizePathSegment
};
