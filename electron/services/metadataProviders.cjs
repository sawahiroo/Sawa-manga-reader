const fs = require('fs');
const path = require('path');

const PUBLIC_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_CACHE_MAX = 5000;
const FAMILY_REQUEST_INTERVAL_MS = 1500;
const FAMILY_BLOCK_THRESHOLD = 3;
const MAX_RESULTS_PER_PROVIDER = 8;

/**
 * @typedef {Object} MetadataProviderDescriptor
 * @property {string} id
 * @property {string} label
 * @property {boolean} enabled
 * @property {boolean} healthy
 * @property {string|null} pausedReason
 */

/**
 * @typedef {Object} MetadataCandidate
 * @property {string} identity Stable provider or mirror-family identity.
 * @property {string} source
 * @property {string} sourceId
 * @property {string} title
 */

const PROVIDER_DEFAULTS = Object.freeze({
  mangadex: true,
  anilist: true,
  nhentai: true,
  imhentai: false,
  hentaiera: false
});

function normalizeText(value) {
  return String(value ?? '').trim();
}

function uniqueStrings(values = [], limit = Infinity) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeText)
    .filter(Boolean))].slice(0, limit);
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value = '') {
  return decodeHtml(String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function absoluteUrl(baseUrl, value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch (_error) {
    return null;
  }
}

function attr(fragment, name) {
  const match = String(fragment || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeHtml(match[1]).trim() : '';
}

function detectAccessProtection(text = '') {
  const source = String(text || '').toLowerCase();
  return /captcha|cf-chl-|cloudflare ray id|attention required|verify you are human|checking your browser/.test(source);
}

function parseImhentaiFamilySearchHtml(html, { providerId = 'imhentai', baseUrl = 'https://imhentai.xxx', limit = 8 } = {}) {
  const source = String(html || '');
  const results = [];
  const seen = new Set();
  const galleryPattern = /<a\b([^>]*href=["'][^"']*\/gallery\/(\d+)\/?[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = galleryPattern.exec(source)) && results.length < limit) {
    const galleryId = normalizeText(match[2]);
    if (!galleryId || seen.has(galleryId)) continue;
    const fragment = `${match[1]} ${match[3]}`;
    const imageTag = fragment.match(/<img\b([^>]*)>/i)?.[1] || '';
    const title = attr(imageTag, 'alt') || attr(match[1], 'title') || stripHtml(match[3]);
    if (!title) continue;
    const coverUrl = absoluteUrl(baseUrl, attr(imageTag, 'data-src') || attr(imageTag, 'src'));
    seen.add(galleryId);
    results.push({
      identity: `imhentai-family:${galleryId}`,
      source: providerId,
      sourceLabel: providerId === 'hentaiera' ? 'HentaiEra' : 'IMHentai',
      sourceId: galleryId,
      title,
      altTitles: [],
      authors: '',
      tags: [],
      chapters: 1,
      pages: null,
      contentRating: 'adult',
      isAdult: true,
      coverUrl,
      coverPreviewUrl: coverUrl,
      coverDownloadUrl: coverUrl,
      siteUrl: absoluteUrl(baseUrl, `/gallery/${galleryId}/`),
      hydrated: false
    });
  }
  return results;
}

function extractInfoValues(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelPattern = new RegExp(`^\\s*${escaped}\\s*:`, 'i');
  const values = [];
  const containerPattern = /<(div|section|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of String(html || '').matchAll(containerPattern)) {
    const visible = stripHtml(match[2]);
    if (!labelPattern.test(visible)) continue;
    const links = [...match[2].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((entry) => stripHtml(entry[1]));
    values.push(...links);
    if (links.length === 0) values.push(visible.replace(labelPattern, '').trim());
  }
  return uniqueStrings(values, 40);
}

function parseImhentaiFamilyGalleryHtml(html, { providerId = 'imhentai', baseUrl = 'https://imhentai.xxx', galleryId = '' } = {}) {
  const source = String(html || '');
  const heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || '';
  const title = stripHtml(heading).replace(/\s*[-|]\s*(?:IMHentai|HentaiEra).*$/i, '').trim();
  const alternative = stripHtml(source.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
  const imageTag = source.match(/<img\b([^>]*(?:id=["']cover["']|class=["'][^"']*(?:cover|gallery)[^"']*["'])[^>]*)>/i)?.[1] || '';
  const pageMatch = source.match(/(?:Pages?|Images?)\s*:?\s*<[^>]*>\s*(\d+)/i)
    || source.match(/(?:Pages?|Images?)\s*:?\s*(\d+)/i);
  const artists = uniqueStrings([
    ...extractInfoValues(source, 'Artist'),
    ...extractInfoValues(source, 'Artists')
  ]);
  const groups = uniqueStrings([
    ...extractInfoValues(source, 'Group'),
    ...extractInfoValues(source, 'Groups')
  ]);
  const tags = uniqueStrings([
    ...extractInfoValues(source, 'Tag'),
    ...extractInfoValues(source, 'Tags'),
    ...extractInfoValues(source, 'Parody'),
    ...extractInfoValues(source, 'Parodies'),
    ...extractInfoValues(source, 'Character'),
    ...extractInfoValues(source, 'Characters'),
    ...extractInfoValues(source, 'Language'),
    ...extractInfoValues(source, 'Languages'),
    ...extractInfoValues(source, 'Category'),
    ...extractInfoValues(source, 'Categories')
  ], 60);
  const coverUrl = absoluteUrl(baseUrl, attr(imageTag, 'data-src') || attr(imageTag, 'src'));
  return {
    identity: `imhentai-family:${normalizeText(galleryId)}`,
    source: providerId,
    sourceLabel: providerId === 'hentaiera' ? 'HentaiEra' : 'IMHentai',
    sourceId: normalizeText(galleryId),
    title: title || `Galerie ${normalizeText(galleryId)}`,
    titleJapanese: alternative || null,
    altTitles: uniqueStrings([alternative]),
    authors: uniqueStrings([...artists, ...groups]).join(', '),
    groups,
    tags,
    genres: tags,
    chapters: 1,
    pages: pageMatch ? Number(pageMatch[1]) : null,
    contentRating: 'adult',
    isAdult: true,
    coverUrl,
    coverPreviewUrl: coverUrl,
    coverDownloadUrl: coverUrl,
    siteUrl: absoluteUrl(baseUrl, `/gallery/${normalizeText(galleryId)}/`),
    hydrated: true
  };
}

class PersistentLruCache {
  constructor({ filePath = '', max = PUBLIC_CACHE_MAX, ttlMs = PUBLIC_CACHE_TTL_MS, now = Date.now } = {}) {
    this.filePath = normalizeText(filePath);
    this.max = Math.max(1, Number(max) || PUBLIC_CACHE_MAX);
    this.ttlMs = Math.max(1000, Number(ttlMs) || PUBLIC_CACHE_TTL_MS);
    this.now = now;
    this.entries = new Map();
    this.saveTimer = null;
    this.load();
  }

  load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      for (const [key, entry] of Array.isArray(parsed?.entries) ? parsed.entries : []) {
        if (!entry || (this.now() - Number(entry.savedAt || 0)) > this.ttlMs) continue;
        this.entries.set(key, entry);
      }
      this.trim();
    } catch (_error) {}
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if ((this.now() - Number(entry.savedAt || 0)) > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, { savedAt: this.now(), value: structuredClone(value) });
    this.trim();
    this.scheduleSave();
  }

  trim() {
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value);
  }

  scheduleSave() {
    if (!this.filePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch(() => {});
    }, 250);
    this.saveTimer.unref?.();
  }

  async flush() {
    if (!this.filePath) return true;
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify({ version: 1, entries: [...this.entries] }), 'utf8');
    await fs.promises.rename(tempPath, this.filePath);
    return true;
  }
}

function normalizeProviderSettings(ui = {}) {
  const metadataProviders = ui?.metadataProviders && typeof ui.metadataProviders === 'object'
    ? ui.metadataProviders
    : {};
  const enabledInput = metadataProviders.enabled && typeof metadataProviders.enabled === 'object'
    ? metadataProviders.enabled
    : {};
  const enabled = Object.fromEntries(Object.entries(PROVIDER_DEFAULTS).map(([id, fallback]) => [
    id,
    enabledInput[id] === undefined ? fallback : Boolean(enabledInput[id])
  ]));
  return {
    enabled,
    preferredAdultMirror: ['imhentai', 'hentaiera'].includes(metadataProviders.preferredAdultMirror)
      ? metadataProviders.preferredAdultMirror
      : 'imhentai',
    allowAdultHtmlFallback: Boolean(metadataProviders.allowAdultHtmlFallback),
    allowNsfwSources: Boolean(ui?.allowNsfwSources)
  };
}

function makeDescriptor(id, patch = {}) {
  return {
    id,
    label: patch.label || id,
    family: patch.family || id,
    adult: Boolean(patch.adult),
    enabled: Boolean(patch.enabled),
    healthy: patch.healthy !== false,
    pausedReason: patch.pausedReason || null,
    capabilities: {
      search: true,
      hydrate: Boolean(patch.hydrate),
      cover: true,
      htmlFallback: Boolean(patch.htmlFallback),
      ...(patch.capabilities || {})
    },
    rateLimitMs: Number(patch.rateLimitMs || 0)
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const results = [];
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  }));
  return results;
}

function createMetadataProviderRegistry(options = {}) {
  const fetchImpl = options.fetchImpl;
  if (typeof fetchImpl !== 'function') throw new Error('metadata provider fetch implementation is required');
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const publicCache = options.publicCache || new PersistentLruCache({ filePath: options.cachePath, now });
  const privateCache = new Map();
  const candidateIndex = new Map();
  const health = new Map();
  let lastFamilyRequestAt = 0;

  const mirrors = {
    imhentai: { id: 'imhentai', label: 'IMHentai', baseUrl: 'https://imhentai.xxx' },
    hentaiera: { id: 'hentaiera', label: 'HentaiEra', baseUrl: 'https://hentaiera.com' },
    ...(options.mirrors || {})
  };
  const legacyProviders = options.legacyProviders || {};

  function providerHealth(id) {
    return health.get(id) || { failures403: 0, pausedReason: null };
  }

  function pauseProvider(id, reason) {
    health.set(id, { ...providerHealth(id), pausedReason: reason });
  }

  async function familyFetch(providerId, requestPath, { signal } = {}) {
    const mirror = mirrors[providerId];
    if (!mirror) throw new Error(`Miroir inconnu: ${providerId}`);
    const currentHealth = providerHealth(providerId);
    if (currentHealth.pausedReason) throw new Error(currentHealth.pausedReason);
    const backoffWaitMs = Math.max(0, Number(currentHealth.backoffUntil || 0) - now());
    if (backoffWaitMs) await sleep(backoffWaitMs);
    const waitMs = Math.max(0, FAMILY_REQUEST_INTERVAL_MS - (now() - lastFamilyRequestAt));
    if (waitMs) await sleep(waitMs);
    lastFamilyRequestAt = now();
    const response = await fetchImpl(new URL(requestPath, mirror.baseUrl).toString(), {
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'User-Agent': 'Sawa Manga Library/4.2 metadata client'
      }
    });
    const text = await response.text();
    if (response.status === 429) {
      const previous = providerHealth(providerId);
      const backoffMs = Math.min(60_000, 1500 * (2 ** Math.min(5, Number(previous.failures429 || 0))));
      health.set(providerId, { ...previous, failures429: Number(previous.failures429 || 0) + 1, backoffUntil: now() + backoffMs });
      throw new Error(`Limite de debit; nouvelle tentative dans ${Math.ceil(backoffMs / 1000)} s.`);
    }
    if (response.status === 403 || detectAccessProtection(text)) {
      const previous = providerHealth(providerId);
      const failures403 = Number(previous.failures403 || 0) + 1;
      const protectedAccess = detectAccessProtection(text);
      const pausedReason = protectedAccess || failures403 >= FAMILY_BLOCK_THRESHOLD
        ? 'Protection anti-automatisation detectee; fournisseur suspendu pour cette session.'
        : null;
      health.set(providerId, { ...previous, failures403, pausedReason });
      throw new Error(pausedReason || `Acces refuse (${response.status}).`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health.set(providerId, { failures403: 0, failures429: 0, backoffUntil: 0, pausedReason: null });
    return text;
  }

  async function searchFamilyMirror(providerId, query, context = {}) {
    const mirror = mirrors[providerId];
    const apiEndpoint = normalizeText(mirror?.apiSearchEndpoint);
    if (apiEndpoint) {
      try {
        const response = await fetchImpl(new URL(apiEndpoint.replace('{query}', encodeURIComponent(query)), mirror.baseUrl).toString(), {
          signal: context.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'Sawa Manga Library/4.2 metadata client' }
        });
        if (response.ok) {
          const json = await response.json();
          if (typeof mirror.parseApiSearch === 'function') return mirror.parseApiSearch(json).slice(0, MAX_RESULTS_PER_PROVIDER);
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
    }
    if (!context.settings.allowAdultHtmlFallback) {
      throw new Error('Fallback HTML non autorise dans les parametres.');
    }
    const html = await familyFetch(providerId, `/search/?key=${encodeURIComponent(query)}`, context);
    return parseImhentaiFamilySearchHtml(html, { providerId, baseUrl: mirror.baseUrl, limit: MAX_RESULTS_PER_PROVIDER });
  }

  async function searchFamily(query, context) {
    const preferred = context.settings.preferredAdultMirror;
    const secondary = preferred === 'imhentai' ? 'hentaiera' : 'imhentai';
    const order = [preferred, secondary].filter((id) => context.settings.enabled[id]);
    let lastError = null;
    for (const providerId of order) {
      try {
        const results = await searchFamilyMirror(providerId, query, context);
        if (results.length) return results;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return [];
  }

  async function hydrateFamilyCandidate(candidate, context = {}) {
    const providerId = ['imhentai', 'hentaiera'].includes(candidate?.source)
      ? candidate.source
      : context.settings?.preferredAdultMirror || 'imhentai';
    const mirror = mirrors[providerId];
    const html = await familyFetch(providerId, `/gallery/${encodeURIComponent(candidate.sourceId)}/`, context);
    return parseImhentaiFamilyGalleryHtml(html, {
      providerId,
      baseUrl: mirror.baseUrl,
      galleryId: candidate.sourceId
    });
  }

  function listProviders(ui = {}) {
    const settings = normalizeProviderSettings(ui);
    return [
      makeDescriptor('mangadex', { label: 'MangaDex', enabled: settings.enabled.mangadex }),
      makeDescriptor('anilist', { label: 'AniList', enabled: settings.enabled.anilist }),
      makeDescriptor('nhentai', { label: 'nHentai', adult: true, enabled: settings.allowNsfwSources && settings.enabled.nhentai }),
      ...['imhentai', 'hentaiera'].map((id) => makeDescriptor(id, {
        label: mirrors[id]?.label,
        family: 'imhentai-family',
        adult: true,
        enabled: settings.allowNsfwSources && settings.enabled[id],
        healthy: !providerHealth(id).pausedReason,
        pausedReason: providerHealth(id).pausedReason,
        hydrate: true,
        htmlFallback: true,
        rateLimitMs: FAMILY_REQUEST_INTERVAL_MS
      }))
    ];
  }

  async function searchCandidates(query, { ui = {}, privateContext = false, signal } = {}) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return { results: [], providerErrors: {} };
    const settings = normalizeProviderSettings(ui);
    const cacheKey = `${privateContext ? 'private' : 'public'}:${JSON.stringify(settings)}:${normalizedQuery.toLocaleLowerCase()}`;
    const cached = privateContext ? privateCache.get(cacheKey) : publicCache.get(cacheKey);
    if (cached) {
      (cached.results || []).forEach((candidate) => candidateIndex.set(candidate.identity, {
        candidate: structuredClone(candidate),
        privateContext: Boolean(privateContext)
      }));
      return { ...cached, cached: true };
    }

    const tasks = Object.entries(legacyProviders)
      .filter(([id]) => settings.enabled[id] && (id !== 'nhentai' || settings.allowNsfwSources))
      .map(([id, run]) => ({ id, run: () => run(normalizedQuery, { signal }) }));
    if (settings.allowNsfwSources && (settings.enabled.imhentai || settings.enabled.hentaiera)) {
      tasks.push({ id: 'imhentai-family', run: () => searchFamily(normalizedQuery, { settings, signal }) });
    }
    const providerErrors = {};
    const settled = await mapWithConcurrency(tasks, 2, async (task) => {
      try {
        return { id: task.id, results: await task.run() };
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        providerErrors[task.id] = error?.message || 'Erreur reseau';
        return { id: task.id, results: [] };
      }
    });
    const seen = new Set();
    const results = settled.flatMap((entry) => entry.results || []).map((candidate) => ({
      ...candidate,
      identity: normalizeText(candidate.identity || `${candidate.source}:${candidate.sourceId}`)
    })).filter((candidate) => {
      const identity = normalizeText(candidate.identity || `${candidate.source}:${candidate.sourceId}`);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    results.forEach((candidate) => candidateIndex.set(candidate.identity, {
      candidate: structuredClone(candidate),
      privateContext: Boolean(privateContext)
    }));
    const payload = { results, providerErrors };
    if (privateContext) privateCache.set(cacheKey, structuredClone(payload));
    else publicCache.set(cacheKey, payload);
    return payload;
  }

  function clearPrivateCache() {
    privateCache.clear();
    for (const [identity, entry] of candidateIndex) {
      if (entry.privateContext) candidateIndex.delete(identity);
    }
  }

  return {
    clearPrivateCache,
    flush: () => publicCache.flush(),
    getCandidate: (identity) => structuredClone(candidateIndex.get(normalizeText(identity))?.candidate || null),
    hydrateCandidate: hydrateFamilyCandidate,
    listProviders,
    normalizeProviderSettings,
    pauseProvider,
    searchCandidates
  };
}

module.exports = {
  FAMILY_BLOCK_THRESHOLD,
  FAMILY_REQUEST_INTERVAL_MS,
  PUBLIC_CACHE_MAX,
  PUBLIC_CACHE_TTL_MS,
  PersistentLruCache,
  createMetadataProviderRegistry,
  detectAccessProtection,
  normalizeProviderSettings,
  parseImhentaiFamilyGalleryHtml,
  parseImhentaiFamilySearchHtml
};
