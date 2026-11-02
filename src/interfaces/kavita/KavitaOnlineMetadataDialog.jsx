import { useEffect, useState } from 'react';
import MetadataCandidateCover from '../../components/MetadataCandidateCover.jsx';
import { Download, Search, X } from 'lucide-react';

export default function KavitaOnlineMetadataDialog({
  manga,
  onClose,
  onSearch,
  onImport
}) {
  const [query, setQuery] = useState(manga?.displayTitle || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setQuery(manga?.displayTitle || '');
    setResults([]);
    setError('');
  }, [manga?.id, manga?.displayTitle]);

  if (!manga) return null;

  const search = async (event) => {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const response = await onSearch?.(trimmed);
      setResults(Array.isArray(response?.results) ? response.results : []);
      if (response?.error) setError(response.error);
    } catch (searchError) {
      setError(searchError?.message || 'La recherche en ligne a echoue.');
    } finally {
      setLoading(false);
    }
  };

  const importResult = async (item) => {
    const itemId = item.malId || item.id || item.title;
    setImportingId(itemId);
    setError('');
    try {
      await onImport?.(manga.id, item);
      onClose?.();
    } catch (importError) {
      setError(importError?.message || 'L import des metadata a echoue.');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="kv-editor-backdrop" onClick={onClose}>
      <section className="kv-editor-dialog kv-online-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><strong>Metadata en ligne</strong><span>{manga.displayTitle}</span></div>
          <button type="button" className="kv-icon-button" onClick={onClose} title="Fermer"><X size={18} /></button>
        </header>
        <div className="kv-editor-content">
          <form className="kv-online-search" onSubmit={search}>
            <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus /></label>
            <button type="submit" className="kv-primary-action" disabled={loading || !query.trim()}>
              {loading ? 'Recherche...' : 'Rechercher'}
            </button>
          </form>
          {error ? <p className="kv-editor-error" role="alert">{error}</p> : null}
          <div className="kv-online-results">
            {results.map((item) => {
              const itemId = item.malId || item.id || item.title;
              return (
                <article key={itemId}>
                  <MetadataCandidateCover candidate={item} alt="" fallback={<div className="kv-cover-fallback">?</div>} />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.authors || item.titleJapanese || 'Source en ligne'}</span>
                    {item.synopsis ? <p>{item.synopsis.slice(0, 220)}</p> : null}
                  </div>
                  <button type="button" onClick={() => importResult(item)} disabled={importingId === itemId} title="Importer">
                    <Download size={16} /> {importingId === itemId ? 'Import...' : 'Importer'}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
