import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import MediaAsset from './MediaAsset.jsx';
import MetadataCandidateCover from './MetadataCandidateCover.jsx';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ImageIcon,
  LayersIcon,
  RefreshIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon
} from './Icons.jsx';
import {
  invertWorkbenchSelection,
  selectWorkbenchRange,
  summarizeWorkbenchSelection,
  toggleWorkbenchSelection
} from '../utils/workbenchSelection.js';

const PAGE_SIZE = 100;
const ATTENTION_STATUSES = new Set(['review', 'no-result', 'error', 'interrupted']);
const STATUS_FILTERS = [
  ['all', 'Toutes'],
  ['attention', 'À vérifier'],
  ['pending', 'À analyser'],
  ['reliable', 'Fiables'],
  ['review', 'Ambiguës'],
  ['no-result', 'Sans résultat'],
  ['error', 'Erreurs'],
  ['done', 'Terminées'],
  ['interrupted', 'Interrompues']
];

const STATUS_LABELS = {
  pending: 'À analyser',
  analyzing: 'Analyse',
  reliable: 'Fiable',
  review: 'À vérifier',
  'no-result': 'Sans résultat',
  error: 'Erreur',
  done: 'Terminé',
  interrupted: 'Interrompu'
};

const REASON_LABELS = {
  'external-id': 'Identifiant connu',
  'exact-title': 'Titre exact',
  'near-title': 'Titre proche',
  author: 'Auteur concordant',
  count: 'Pages concordantes',
  type: 'Type concordant'
};

function displayValue(value, fallback = 'Non renseigné') {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || fallback;
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function WorkbenchLocalCover({ manga }) {
  return (
    <span className="workbench-row-cover" aria-hidden="true">
      {manga?.coverSrc || manga?.coverMediaType === 'pdf' ? (
        <MediaAsset
          src={manga.coverSrc}
          alt=""
          className="thumb-smooth thumb-media"
          loading="lazy"
          mediaType={manga.coverMediaType || 'image'}
          filePath={manga.coverFilePath}
          pageNumber={manga.coverPageNumber || 1}
          maxWidth={72}
          maxHeight={104}
        />
      ) : <span className="workbench-row-cover-fallback">{(manga?.displayTitle || '?')[0]}</span>}
    </span>
  );
}

function WorkbenchVisualLocal({ manga }) {
  return (
    <div className="workbench-visual-cover">
      {manga?.coverSrc || manga?.coverMediaType === 'pdf' ? (
        <MediaAsset
          src={manga.coverSrc}
          alt={`Couverture de ${manga?.displayTitle || 'l’œuvre locale'}`}
          className="thumb-smooth thumb-media"
          loading="lazy"
          mediaType={manga.coverMediaType || 'image'}
          filePath={manga.coverFilePath}
          pageNumber={manga.coverPageNumber || 1}
          maxWidth={320}
          maxHeight={480}
        />
      ) : <span>{(manga?.displayTitle || '?')[0]}</span>}
    </div>
  );
}

function ConfidenceRail({ confidence = 0, status = 'pending' }) {
  const percent = Math.round(Math.max(0, Math.min(1, Number(confidence) || 0)) * 100);
  return (
    <div className={`workbench-confidence workbench-confidence-${status}`} title={`Confiance ${percent}%`}>
      <span className="workbench-confidence-track"><span style={{ width: `${percent}%` }} /></span>
      <strong>{percent}%</strong>
    </div>
  );
}

function FieldComparison({ label, localValue, remoteValue }) {
  const local = displayValue(localValue);
  const remote = displayValue(remoteValue, 'Aucune proposition');
  const differs = local.localeCompare(remote, undefined, { sensitivity: 'base' }) !== 0;
  return (
    <div className={`workbench-compare-row ${differs ? 'changed' : 'same'}`}>
      <span className="workbench-compare-label">{label}</span>
      <div><small>Dans Sawa</small><p>{local}</p></div>
      <div><small>Proposition</small><p>{remote}</p></div>
    </div>
  );
}

function CandidateResult({ result, active, onChoose }) {
  const reasons = (result.reasons || []).map((reason) => REASON_LABELS[reason] || reason).slice(0, 2);
  return (
    <button type="button" className={`workbench-candidate ${active ? 'active' : ''}`} onClick={onChoose} aria-pressed={active}>
      <MetadataCandidateCover
        candidate={result}
        alt=""
        className="thumb-smooth"
        fallback={<span className="workbench-result-fallback">?</span>}
      />
      <span>
        <strong>{result.title || 'Sans titre'}</strong>
        <small>{result.sourceLabel || result.source || 'Source'} · {Math.round(Number(result.confidence || 0) * 100)}%</small>
        {reasons.length ? <em>{reasons.join(' · ')}</em> : null}
      </span>
    </button>
  );
}

function MetadataWorkbenchView({
  queueMangas = [],
  initialScrollTop = 0,
  scrollKey,
  onReplaceQueue,
  onPickCover,
  onOpenManga,
  onScrollPositionChange
}) {
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const selectAllRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [filterIds, setFilterIds] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ total: 0, counts: {} });
  const [loadingPage, setLoadingPage] = useState(false);
  const [activeMangaId, setActiveMangaId] = useState(null);
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [chosenCandidate, setChosenCandidate] = useState(null);
  const [searching, setSearching] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [activeJob, setActiveJob] = useState(null);

  const loadPage = useCallback(async ({ reset = false } = {}) => {
    if (loadingPage) return;
    setLoadingPage(true);
    try {
      const offset = reset ? 0 : items.length;
      const response = await window.mangaAPI.getMetadataWorkbenchPage({ status: filter, offset, limit: PAGE_SIZE });
      const responseItems = response.items || [];
      setItems((current) => reset ? responseItems : [...current, ...responseItems]);
      setTotal(Number(response.total || 0));
      setSummary(response.summary || { total: 0, counts: {} });
      if (reset && responseItems.length && !responseItems.some((item) => item.mangaId === activeMangaId)) {
        setActiveMangaId(responseItems[0].mangaId);
      }
    } catch (error) {
      setFeedback(error?.message || 'Chargement de l’Atelier impossible.');
    } finally {
      setLoadingPage(false);
    }
  }, [activeMangaId, filter, items.length, loadingPage]);

  const loadFilterIds = useCallback(async () => {
    try {
      const response = await window.mangaAPI.getMetadataWorkbenchSelectionIds({ status: filter });
      setFilterIds(response?.ids || []);
    } catch {
      setFilterIds([]);
    }
  }, [filter]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      loadPage({ reset: true });
      loadFilterIds();
    }, 140);
  }, [loadFilterIds, loadPage]);

  useEffect(() => {
    setItems([]);
    setTotal(0);
    if (listRef.current) listRef.current.scrollTop = 0;
    loadPage({ reset: true });
    loadFilterIds();
  }, [filter, queueMangas.length, scrollKey]);

  useEffect(() => {
    const unsubscribe = window.mangaAPI.onJobsProgress?.((event) => {
      const job = event?.job;
      if (!job || !['workbench-analysis', 'workbench-apply'].includes(job.kind)) return;
      setActiveJob(job);
      scheduleRefresh();
    });
    return () => {
      unsubscribe?.();
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = Number(initialScrollTop || 0);
  }, [scrollKey]);

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => listRef.current,
    estimateSize: () => 76,
    getItemKey: (index) => items[index]?.mangaId || `loading-${index}`,
    overscan: 8,
    initialOffset: () => Number(initialScrollTop || 0)
  });
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualItems.at(-1);
    if (last && last.index >= items.length - 16 && items.length < total && !loadingPage) loadPage();
  }, [items.length, loadPage, loadingPage, total, virtualItems]);

  const activeItem = useMemo(
    () => items.find((item) => item.mangaId === activeMangaId) || items[0] || null,
    [activeMangaId, items]
  );
  const activeManga = activeItem?.manga || null;
  const activeRemote = chosenCandidate || activeItem?.candidate || null;
  const visibleIds = useMemo(() => items.map((item) => item.mangaId), [items]);
  const selection = useMemo(() => summarizeWorkbenchSelection(selectedRows, filterIds), [filterIds, selectedRows]);
  const activeIndex = activeItem ? items.findIndex((item) => item.mangaId === activeItem.mangaId) : -1;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selection.visibleSelected > 0 && !selection.allVisibleSelected;
    }
  }, [selection]);

  useEffect(() => {
    setQuery(activeManga?.displayTitle || '');
    setCandidates([]);
    setChosenCandidate(null);
    setFeedback('');
  }, [activeMangaId]);

  const moveActive = useCallback((delta) => {
    if (!items.length) return;
    const currentIndex = Math.max(0, items.findIndex((item) => item.mangaId === activeItem?.mangaId));
    const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + delta));
    const next = items[nextIndex];
    if (!next) return;
    setActiveMangaId(next.mangaId);
    virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
  }, [activeItem?.mangaId, items, virtualizer]);

  const handleRowSelection = useCallback((mangaId, checked, range = false) => {
    const id = String(mangaId);
    setSelectionMode(true);
    setSelectedRows((current) => range && lastSelectedId
      ? selectWorkbenchRange(current, filterIds.length ? filterIds : visibleIds, lastSelectedId, id, checked)
      : toggleWorkbenchSelection(current, id, checked));
    setLastSelectedId(id);
    setActiveMangaId(id);
  }, [filterIds, lastSelectedId, visibleIds]);

  const selectEntireFilter = useCallback((checked) => {
    setSelectionMode(true);
    setSelectedRows((current) => {
      const next = new Set(current);
      filterIds.forEach((id) => checked ? next.add(id) : next.delete(id));
      return next;
    });
  }, [filterIds]);

  const runSearch = useCallback(async () => {
    if (!activeItem || !query.trim()) return;
    setSearching(true);
    setFeedback('');
    try {
      const response = await window.mangaAPI.searchMetadataCandidates({ mangaId: activeItem.mangaId, query: query.trim() });
      if (!response?.ok) throw new Error(response?.error || 'Recherche impossible.');
      setCandidates(response.results || []);
      setChosenCandidate(response.results?.[0] || null);
      if (Object.keys(response.providerErrors || {}).length) setFeedback(Object.values(response.providerErrors).join(' · '));
      else if (!response.results?.length) setFeedback('Aucune correspondance. Essaie un titre alternatif, un auteur ou un identifiant.');
    } catch (error) {
      setFeedback(error?.message || 'Recherche impossible.');
    } finally {
      setSearching(false);
    }
  }, [activeItem, query]);

  const startAnalysis = useCallback(async (mangaIds = []) => {
    const result = await window.mangaAPI.startMetadataWorkbenchAnalysis({ mangaIds, autoApply: true });
    if (result?.job) setActiveJob(result.job);
    setFeedback(result?.ok ? 'Analyse lancée. Les correspondances sûres seront appliquées automatiquement.' : (result?.error || 'Analyse impossible.'));
  }, []);

  const applyIds = useCallback(async (ids, candidateMap = {}) => {
    if (!ids.length) return null;
    const result = await window.mangaAPI.applyMetadataWorkbenchMatches({ mangaIds: ids, candidates: candidateMap });
    if (result?.job) setActiveJob(result.job);
    setFeedback(result?.ok ? `Import lancé pour ${ids.length} œuvre(s).` : (result?.error || 'Import impossible.'));
    return result;
  }, []);

  const applyMatches = useCallback(() => {
    const ids = selectedRows.size ? [...selectedRows] : (activeItem ? [activeItem.mangaId] : []);
    const candidateMap = activeItem && chosenCandidate && ids.includes(activeItem.mangaId)
      ? { [activeItem.mangaId]: chosenCandidate }
      : {};
    return applyIds(ids, candidateMap);
  }, [activeItem, applyIds, chosenCandidate, selectedRows]);

  const acceptAndNext = useCallback(async () => {
    if (!activeItem || !activeRemote) return;
    const currentId = activeItem.mangaId;
    const nextId = items[activeIndex + 1]?.mangaId || items[activeIndex - 1]?.mangaId || null;
    const result = await applyIds([currentId], { [currentId]: activeRemote });
    if (result?.ok && nextId) setActiveMangaId(nextId);
  }, [activeIndex, activeItem, activeRemote, applyIds, items]);

  const keepLocalAndNext = useCallback(async () => {
    if (!activeItem) return;
    const currentId = activeItem.mangaId;
    const nextId = items[activeIndex + 1]?.mangaId || items[activeIndex - 1]?.mangaId || null;
    const result = await window.mangaAPI.resolveMetadataWorkbenchItems({ mangaIds: [currentId], decision: 'keep-local' });
    setFeedback(result?.ok ? 'Valeurs locales conservées.' : (result?.error || 'Décision impossible.'));
    if (result?.ok) {
      if (nextId) setActiveMangaId(nextId);
      scheduleRefresh();
    }
  }, [activeIndex, activeItem, items, scheduleRefresh]);

  const retryItems = useCallback(async () => {
    const ids = selectedRows.size
      ? [...selectedRows]
      : items.filter((item) => ['error', 'interrupted', 'no-result'].includes(item.status)).map((item) => item.mangaId);
    if (!ids.length) return;
    const result = await window.mangaAPI.retryMetadataWorkbenchItems(ids);
    if (result?.job) setActiveJob(result.job);
  }, [items, selectedRows]);

  const removeSelected = useCallback(async () => {
    const ids = selectedRows.size ? selectedRows : new Set(activeItem ? [activeItem.mangaId] : []);
    if (!ids.size) return;
    const remaining = queueMangas.map((manga) => String(manga.id)).filter((id) => !ids.has(id));
    await onReplaceQueue?.(remaining);
    setSelectedRows(new Set());
    setSelectionMode(false);
    loadPage({ reset: true });
  }, [activeItem, loadPage, onReplaceQueue, queueMangas, selectedRows]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!rootRef.current || !rootRef.current.isConnected) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      const editing = ['input', 'textarea', 'select'].includes(tag) || document.activeElement?.isContentEditable;
      if (event.key === 'Escape' && selectionMode && !editing) {
        setSelectedRows(new Set());
        setSelectionMode(false);
        return;
      }
      if (editing) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        moveActive(1);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveActive(-1);
      } else if (event.key === 'Enter' && activeRemote) {
        event.preventDefault();
        acceptAndNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [acceptAndNext, activeRemote, moveActive, selectionMode]);

  const jobRunning = activeJob && ['queued', 'running', 'cancel_requested'].includes(activeJob.status);
  const jobProgress = activeJob?.progress || {};
  const progressPercent = Number(jobProgress.percent || 0);
  const attentionCount = summary.counts?.attention || 0;
  const confidenceReasons = (activeRemote?.reasons || []).map((reason) => REASON_LABELS[reason] || reason);

  if (!summary.total && !items.length && !loadingPage) {
    return (
      <section className="workbench-view workbench-v2 workbench-empty-shell">
        <div className="workbench-empty-card">
          <span className="workbench-empty-kicker">Atelier métadonnées</span>
          <h1>Aucune œuvre dans la file.</h1>
          <p>Ajoute une sélection depuis la bibliothèque ou le Coffre pour lancer un catalogage par lot.</p>
        </div>
      </section>
    );
  }

  return (
    <section ref={rootRef} className={`workbench-view workbench-v2 ${filter === 'attention' ? 'review-focus' : ''} ${reviewMode ? 'visual-review' : ''}`}>
      <header className="workbench-command-deck">
        <div className="workbench-command-title">
          <span className="workbench-empty-kicker">Poste de catalogage</span>
          <h1>{summary.total || total} œuvre{(summary.total || total) > 1 ? 's' : ''}</h1>
          <p>{summary.processed || 0} traitées · {attentionCount} à vérifier · {summary.error || 0} erreur(s)</p>
        </div>
        <div className="workbench-command-actions">
          {attentionCount ? (
            <button type="button" className="workbench-review-button" onClick={() => { setFilter('attention'); setReviewMode(true); }}>
              <CheckIcon size={15} /> Vérifier {attentionCount}
            </button>
          ) : null}
          {reviewMode ? <button type="button" className="ghost-button" onClick={() => setReviewMode(false)}>Vue détaillée</button> : null}
          <button type="button" className="primary-button" onClick={() => startAnalysis([])} disabled={jobRunning}>
            <SparklesIcon size={15} /> Analyser tout
          </button>
          {jobRunning ? (
            <>
              <button type="button" className="ghost-button" onClick={() => window.mangaAPI.cancelMetadataWorkbenchJob(activeJob.id)}>Pause</button>
              <button type="button" className="ghost-button ghost-button-danger" onClick={() => window.mangaAPI.cancelMetadataWorkbenchJob(activeJob.id)}>Annuler</button>
            </>
          ) : <button type="button" className="ghost-button" onClick={retryItems}><RefreshIcon size={14} /> Reprendre</button>}
          <button type="button" className="ghost-button" onClick={() => window.mangaAPI.undoLastMetadataWorkbenchBatch().then(scheduleRefresh)}>Annuler le lot</button>
        </div>
        <div className="workbench-progress" aria-live="polite">
          <span style={{ width: `${progressPercent}%` }} />
          <small>{jobRunning ? `${jobProgress.completed || 0}/${jobProgress.total || 0} · ${progressPercent}%` : 'Prêt'}</small>
        </div>
        <nav className="workbench-status-filters" aria-label="États de l’Atelier">
          {STATUS_FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'active' : ''} onClick={() => { setFilter(id); setReviewMode(id === 'attention'); }}>
              {label}<span>{summary.counts?.[id] ?? (id === 'all' ? summary.total : 0)}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className={`workbench-selection-bar ${selectionMode ? 'active' : ''}`} aria-label="Sélection multiple">
        <button type="button" className={selectionMode ? 'workbench-selection-mode active' : 'workbench-selection-mode'} onClick={() => setSelectionMode((value) => !value)} aria-pressed={selectionMode}>
          <LayersIcon size={15} /> Sélection multiple
        </button>
        {selectionMode ? (
          <>
            <strong>{selection.total} sélectionnée{selection.total > 1 ? 's' : ''}</strong>
            {selection.hidden ? <span>{selection.hidden} hors du filtre</span> : null}
            <button type="button" className="ghost-button" onClick={() => selectEntireFilter(true)}>Tout le filtre ({filterIds.length})</button>
            <button type="button" className="ghost-button" onClick={() => setSelectedRows((current) => invertWorkbenchSelection(current, visibleIds))}>Inverser les visibles</button>
            <button type="button" className="ghost-button" disabled={!selection.total} onClick={() => setSelectedRows(new Set())}>Vider</button>
            <span className="workbench-selection-spacer" />
            <button type="button" className="primary-button" disabled={!selection.total} onClick={applyMatches}><CheckIcon size={14} /> Importer les propositions</button>
            <button type="button" className="ghost-button" disabled={!selection.total} onClick={retryItems}><RefreshIcon size={14} /> Réanalyser</button>
            <button type="button" className="ghost-button" disabled={!selection.total} onClick={removeSelected}><TrashIcon size={14} /> Retirer</button>
            <button type="button" className="icon-button" onClick={() => { setSelectedRows(new Set()); setSelectionMode(false); }} aria-label="Quitter la sélection"><CloseIcon size={16} /></button>
          </>
        ) : <span>Coche une ligne, utilise Ctrl+clic ou Maj+clic pour une plage.</span>}
      </div>

      <div className="workbench-table-head">
        <label className="workbench-head-check">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={selection.allVisibleSelected}
            onChange={(event) => selectEntireFilter(event.target.checked)}
            aria-label={`Sélectionner les ${filterIds.length} œuvres du filtre`}
          />
        </label>
        <span>Œuvre locale</span><span>Correspondance</span><span>Source</span><span>Confiance</span><span>État</span>
      </div>

      <div className="workbench-catalog-layout">
        <div className="workbench-table-panel">
          <div
            ref={listRef}
            className="workbench-virtual-list"
            role="listbox"
            aria-label="Œuvres à cataloguer"
            aria-multiselectable="true"
            onScroll={(event) => onScrollPositionChange?.(event.currentTarget.scrollTop)}
          >
            <div className="workbench-virtual-canvas" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              {virtualItems.map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) return <div key={virtualRow.key} className="workbench-row-loading" style={{ transform: `translateY(${virtualRow.start}px)`, height: `${virtualRow.size}px` }}>Chargement…</div>;
                const selected = selectedRows.has(item.mangaId);
                const active = activeItem?.mangaId === item.mangaId;
                return (
                  <div
                    key={virtualRow.key}
                    className={`workbench-table-row ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                    style={{ transform: `translateY(${virtualRow.start}px)`, height: `${virtualRow.size}px` }}
                    role="option"
                    aria-selected={selected}
                    tabIndex={active ? 0 : -1}
                    onMouseDown={(event) => {
                      if (event.shiftKey) event.preventDefault();
                    }}
                    onClick={(event) => {
                      if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey) {
                        if (event.shiftKey) event.preventDefault();
                        handleRowSelection(item.mangaId, !selected, event.shiftKey);
                      } else setActiveMangaId(item.mangaId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === ' ') {
                        event.preventDefault();
                        handleRowSelection(item.mangaId, !selected, event.shiftKey);
                      }
                    }}
                  >
                    <label className="workbench-row-check" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => handleRowSelection(item.mangaId, event.target.checked, event.nativeEvent.shiftKey)}
                        aria-label={`Sélectionner ${item.manga?.displayTitle || item.mangaId}`}
                      />
                    </label>
                    <div className="workbench-row-local"><WorkbenchLocalCover manga={item.manga} /><span><strong>{item.manga?.displayTitle || 'Œuvre introuvable'}</strong><small>{item.manga?.author || 'Auteur inconnu'} · {item.manga?.chapterCount || 0} ch.</small></span></div>
                    <div className="workbench-row-candidate"><strong>{item.candidate?.title || 'Aucune proposition'}</strong><small>{item.candidateCount || 0} candidat(s)</small></div>
                    <span className="workbench-row-source">{item.candidate?.sourceLabel || item.candidate?.source || 'Local'}</span>
                    <ConfidenceRail confidence={item.confidence} status={item.status} />
                    <span className={`workbench-status workbench-status-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span>
                  </div>
                );
              })}
              {!loadingPage && total === 0 ? <div className="workbench-filter-empty">Aucune œuvre dans ce filtre.</div> : null}
            </div>
          </div>
        </div>

        <aside className="workbench-inspector" aria-label="Vérification de correspondance">
          {activeItem ? (
            <>
              <div className="workbench-review-runway">
                <button type="button" className="icon-button" onClick={() => moveActive(-1)} disabled={activeIndex <= 0} aria-label="Œuvre précédente"><ChevronLeftIcon size={16} /></button>
                <div><span>Vérification rapide</span><strong>{activeIndex + 1} / {total}</strong></div>
                <button type="button" className="icon-button" onClick={() => moveActive(1)} disabled={activeIndex >= items.length - 1} aria-label="Œuvre suivante"><ChevronRightIcon size={16} /></button>
              </div>
              <div className="workbench-inspector-head">
                <div><span className="workbench-empty-kicker">Œuvre locale</span><h2>{activeManga?.displayTitle || activeItem.mangaId}</h2></div>
                <ConfidenceRail confidence={chosenCandidate?.confidence ?? activeItem.confidence} status={activeItem.status} />
              </div>
              {reviewMode ? (
                <div className="workbench-visual-match" aria-label="Comparaison visuelle">
                  <article className="workbench-visual-card local">
                    <span>Dans ta bibliothèque</span>
                    <WorkbenchVisualLocal manga={activeManga} />
                    <div><strong>{activeManga?.displayTitle || 'Œuvre locale'}</strong><small>{activeManga?.author || 'Auteur inconnu'} · {activeManga?.pageCount || 0} pages</small></div>
                  </article>
                  <div className="workbench-match-arrow" aria-hidden="true"><ChevronRightIcon size={22} /><small>Comparer</small></div>
                  <article className="workbench-visual-card remote">
                    <span>Proposition retenue</span>
                    <div className="workbench-visual-cover">
                      <MetadataCandidateCover
                        candidate={activeRemote}
                        alt={`Couverture proposée pour ${activeRemote?.title || 'la correspondance'}`}
                        className="thumb-smooth"
                        fallback={<span>{(activeRemote?.title || '?')[0]}</span>}
                      />
                    </div>
                    <div><strong>{activeRemote?.title || 'Aucune proposition'}</strong><small>{activeRemote?.sourceLabel || activeRemote?.source || 'Recherche requise'} · {activeRemote ? `${Math.round(Number((chosenCandidate?.confidence ?? activeItem.confidence) || 0) * 100)}%` : '—'}</small></div>
                  </article>
                </div>
              ) : null}
              <div className="workbench-decision-context">
                <strong>{activeRemote ? 'Pourquoi vérifier ?' : 'Aucune proposition exploitable'}</strong>
                <p>{activeItem.error || (activeRemote
                  ? `${Math.round(Number((chosenCandidate?.confidence ?? activeItem.confidence) || 0) * 100)}% de confiance${activeItem.margin ? `, écart de ${Math.round(activeItem.margin * 100)} points avec le suivant` : ''}.`
                  : 'Relance l’analyse ou recherche avec un titre alternatif.')}</p>
                {confidenceReasons.length ? <div>{confidenceReasons.map((reason) => <span key={reason}>{reason}</span>)}</div> : null}
              </div>
              <div className="workbench-inspector-actions">
                <button type="button" className="ghost-button" onClick={() => onOpenManga?.(activeItem.mangaId)}><ChevronLeftIcon size={14} /> Fiche</button>
                <button type="button" className="ghost-button" onClick={() => onPickCover?.(activeItem.mangaId)}><ImageIcon size={14} /> Couverture</button>
                <button type="button" className="ghost-button" onClick={() => startAnalysis([activeItem.mangaId])}><RefreshIcon size={14} /> Réanalyser</button>
              </div>
              <form className="workbench-inspector-search" onSubmit={(event) => { event.preventDefault(); runSearch(); }}>
                <SearchIcon size={15} />
                <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titre, alias, auteur ou identifiant" />
                <button type="submit" className="ghost-button" disabled={searching}>{searching ? 'Recherche…' : 'Chercher'}</button>
              </form>
              {feedback ? <p className="workbench-feedback" role="status">{feedback}</p> : null}
              {candidates.length ? (
                <div className="workbench-candidate-section">
                  <div className="workbench-section-title"><strong>Choisir une proposition</strong><span>{candidates.length} résultat(s)</span></div>
                  <div className="workbench-candidate-list">{candidates.slice(0, 8).map((candidate) => <CandidateResult key={candidate.identity} result={candidate} active={chosenCandidate?.identity === candidate.identity} onChoose={() => setChosenCandidate(candidate)} />)}</div>
                </div>
              ) : null}
              <div className="workbench-comparison">
                <div className="workbench-section-title"><strong>Comparer avant d’appliquer</strong><span>Les valeurs manuelles et verrouillées restent protégées</span></div>
                <FieldComparison label="Titre" localValue={activeManga?.displayTitle} remoteValue={activeRemote?.title} />
                <FieldComparison label="Auteur" localValue={activeManga?.author} remoteValue={activeRemote?.authors} />
                <FieldComparison label="Pages" localValue={activeManga?.pageCount} remoteValue={activeRemote?.pages} />
                <FieldComparison label="Tags" localValue="Conservés" remoteValue={(activeRemote?.tags || activeRemote?.genres || []).slice(0, 8)} />
              </div>
              <div className="workbench-review-actions">
                <button type="button" className="workbench-accept-button" disabled={!activeRemote} onClick={acceptAndNext}><CheckIcon size={15} /> Accepter + suivant <kbd>Entrée</kbd></button>
                <button type="button" className="ghost-button" onClick={keepLocalAndNext}>Garder local + suivant</button>
                <button type="button" className="ghost-button" onClick={() => moveActive(1)}>Plus tard</button>
                <span><kbd>J</kbd>/<kbd>K</kbd> naviguer · <kbd>/</kbd> chercher</span>
              </div>
            </>
          ) : <div className="workbench-empty-results">Sélectionne une ligne pour comparer les métadonnées.</div>}
        </aside>
      </div>
    </section>
  );
}

export default memo(MetadataWorkbenchView);
