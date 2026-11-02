const { createMetadataProviderRegistry } = require('../electron/services/metadataProviders.cjs');

async function main() {
  if (process.env.SAWA_METADATA_CANARY !== '1') {
    console.log('Canari metadata desactive. Definir SAWA_METADATA_CANARY=1 et SAWA_METADATA_CANARY_QUERY pour le lancer manuellement.');
    return;
  }
  const query = String(process.env.SAWA_METADATA_CANARY_QUERY || '').trim();
  if (!query) throw new Error('SAWA_METADATA_CANARY_QUERY est requis.');
  const provider = ['imhentai', 'hentaiera'].includes(process.env.SAWA_METADATA_CANARY_PROVIDER)
    ? process.env.SAWA_METADATA_CANARY_PROVIDER
    : 'imhentai';
  const secondary = provider === 'imhentai' ? 'hentaiera' : 'imhentai';
  const registry = createMetadataProviderRegistry({ fetchImpl: fetch });
  const ui = {
    allowNsfwSources: true,
    metadataProviders: {
      enabled: { mangadex: false, anilist: false, nhentai: false, [provider]: true, [secondary]: false },
      preferredAdultMirror: provider,
      allowAdultHtmlFallback: true
    }
  };
  const search = await registry.searchCandidates(query, { ui });
  if (!search.results.length) throw new Error(search.providerErrors['imhentai-family'] || 'Aucun resultat canari.');
  const detail = await registry.hydrateCandidate(search.results[0], {
    settings: registry.normalizeProviderSettings(ui)
  });
  console.log(JSON.stringify({
    ok: true,
    provider,
    searchResultCount: search.results.length,
    galleryId: detail.sourceId,
    fields: ['title', 'authors', 'tags', 'pages', 'coverUrl'].filter((field) => {
      const value = detail[field];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    })
  }));
  await registry.flush();
}

main().catch((error) => {
  console.error(`Canari metadata en echec: ${error?.message || error}`);
  process.exitCode = 1;
});
