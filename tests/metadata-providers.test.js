import { describe, expect, it, vi } from 'vitest';
import {
  createMetadataProviderRegistry,
  detectAccessProtection,
  parseImhentaiFamilyGalleryHtml,
  parseImhentaiFamilySearchHtml
} from '../electron/services/metadataProviders.cjs';

const SEARCH_FIXTURE = `
  <div class="gallery">
    <a href="/gallery/12345/"><img data-src="/images/12345.jpg" alt="Fixture Alpha"></a>
    <a href="/gallery/12345/"><img src="/duplicate.jpg" alt="Duplicate"></a>
    <a href="/gallery/999/"><img src="https://cdn.example/999.webp" alt="Fixture Beta"></a>
  </div>`;

const GALLERY_FIXTURE = `
  <html><head><title>Fixture Alpha - IMHentai</title></head><body>
    <h1>Fixture Alpha</h1><h2>Fixture alternative</h2>
    <img id="cover" src="/covers/12345.webp">
    <div class="tag-container">Artists: <a>Autrice Test</a></div>
    <div class="tag-container">Groups: <a>Groupe Test</a></div>
    <div class="tag-container">Tags: <a>Aventure</a><a>Couleur</a></div>
    <div>Pages: 42</div>
  </body></html>`;

describe('metadata provider registry', () => {
  it('parses and deduplicates IMHentai mirror search results with a family identity', () => {
    const results = parseImhentaiFamilySearchHtml(SEARCH_FIXTURE);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      identity: 'imhentai-family:12345',
      sourceId: '12345',
      title: 'Fixture Alpha'
    });
    expect(results[0].coverUrl).toBe('https://imhentai.xxx/images/12345.jpg');
  });

  it('hydrates the supported metadata fields from a frozen neutral fixture', () => {
    const result = parseImhentaiFamilyGalleryHtml(GALLERY_FIXTURE, { galleryId: '12345' });
    expect(result).toMatchObject({
      title: 'Fixture Alpha',
      titleJapanese: 'Fixture alternative',
      authors: 'Autrice Test, Groupe Test',
      pages: 42,
      hydrated: true
    });
    expect(result.tags).toEqual(expect.arrayContaining(['Aventure', 'Couleur']));
  });

  it('uses only the preferred mirror when it succeeds and requires explicit HTML consent', async () => {
    const fetchImpl = vi.fn(async () => new Response(SEARCH_FIXTURE, { status: 200 }));
    const registry = createMetadataProviderRegistry({ fetchImpl, sleep: async () => {} });
    const baseUi = {
      allowNsfwSources: true,
      metadataProviders: {
        enabled: { mangadex: false, anilist: false, nhentai: false, imhentai: true, hentaiera: true },
        preferredAdultMirror: 'imhentai',
        allowAdultHtmlFallback: true
      }
    };
    const response = await registry.searchCandidates('fixture', { ui: baseUi });
    expect(response.results).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('imhentai.xxx/search/');

    const deniedRegistry = createMetadataProviderRegistry({ fetchImpl: vi.fn(), sleep: async () => {} });
    const denied = await deniedRegistry.searchCandidates('autre', {
      ui: { ...baseUi, metadataProviders: { ...baseUi.metadataProviders, allowAdultHtmlFallback: false } }
    });
    expect(denied.results).toEqual([]);
    expect(denied.providerErrors['imhentai-family']).toMatch(/non autorise/i);
  });

  it('pauses a protected provider for the session without trying to bypass it', async () => {
    const fetchImpl = vi.fn(async () => new Response('<title>Attention Required</title><div class="cf-chl-captcha"></div>', { status: 403 }));
    const registry = createMetadataProviderRegistry({ fetchImpl, sleep: async () => {} });
    const ui = {
      allowNsfwSources: true,
      metadataProviders: {
        enabled: { mangadex: false, anilist: false, nhentai: false, imhentai: true, hentaiera: false },
        allowAdultHtmlFallback: true
      }
    };
    const response = await registry.searchCandidates('blocked', { ui });
    expect(response.results).toEqual([]);
    expect(registry.listProviders(ui).find((entry) => entry.id === 'imhentai')).toMatchObject({
      healthy: false,
      pausedReason: expect.stringMatching(/suspendu/i)
    });
    expect(detectAccessProtection('Checking your browser before accessing')).toBe(true);
  });

  it('honors the 429 backoff before retrying the family provider', async () => {
    let clock = 0;
    const sleeps = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(SEARCH_FIXTURE, { status: 200 }));
    const registry = createMetadataProviderRegistry({
      fetchImpl,
      now: () => clock,
      sleep: async (delay) => {
        sleeps.push(delay);
        clock += delay;
      }
    });
    const ui = {
      allowNsfwSources: true,
      metadataProviders: {
        enabled: { mangadex: false, anilist: false, nhentai: false, imhentai: true, hentaiera: false },
        allowAdultHtmlFallback: true
      }
    };
    const limited = await registry.searchCandidates('first', { ui });
    expect(limited.providerErrors['imhentai-family']).toMatch(/limite de debit/i);
    const retried = await registry.searchCandidates('second', { ui });
    expect(retried.results).toHaveLength(2);
    expect(sleeps).toContain(1500);
  });

  it('uses a validated public API first and falls back to the secondary mirror only on failure', async () => {
    const apiFetch = vi.fn(async () => new Response(JSON.stringify({ rows: [{ id: '77', title: 'API result' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const apiRegistry = createMetadataProviderRegistry({
      fetchImpl: apiFetch,
      sleep: async () => {},
      mirrors: {
        imhentai: {
          id: 'imhentai',
          label: 'IMHentai',
          baseUrl: 'https://api.fixture',
          apiSearchEndpoint: '/api/search?q={query}',
          parseApiSearch: (json) => json.rows.map((row) => ({
            identity: `imhentai-family:${row.id}`,
            source: 'imhentai',
            sourceId: row.id,
            title: row.title
          }))
        }
      }
    });
    const ui = {
      allowNsfwSources: true,
      metadataProviders: {
        enabled: { mangadex: false, anilist: false, nhentai: false, imhentai: true, hentaiera: true },
        preferredAdultMirror: 'imhentai',
        allowAdultHtmlFallback: false
      }
    };
    const apiResult = await apiRegistry.searchCandidates('api', { ui });
    expect(apiResult.results[0]).toMatchObject({ identity: 'imhentai-family:77', title: 'API result' });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    const mirrorFetch = vi.fn(async (url) => {
      if (String(url).includes('imhentai.xxx')) return new Response('unavailable', { status: 503 });
      return new Response(SEARCH_FIXTURE, { status: 200 });
    });
    const mirrorRegistry = createMetadataProviderRegistry({ fetchImpl: mirrorFetch, sleep: async () => {} });
    const mirrorResult = await mirrorRegistry.searchCandidates('mirror', {
      ui: { ...ui, metadataProviders: { ...ui.metadataProviders, allowAdultHtmlFallback: true } }
    });
    expect(mirrorResult.results).toHaveLength(2);
    expect(mirrorFetch).toHaveBeenCalledTimes(2);
    expect(mirrorFetch.mock.calls[1][0]).toContain('hentaiera.com');
  });
});
