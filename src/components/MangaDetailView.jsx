import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon, EditIcon, HeartIcon, LayersIcon, PlayIcon, PlusIcon, ScrollIcon, SearchIcon, SparklesIcon, TagIcon, BookIcon, ClockIcon, ZapIcon } from './Icons.jsx';
import MediaAsset from './MediaAsset.jsx';
import MetadataCandidateCover from './MetadataCandidateCover.jsx';
import PreviewDisplayControls from './PreviewDisplayControls.jsx';
import { getProgressPercent } from '../utils/reader.js';
import { paginateItems } from '../utils/paginateItems.js';
import { normalizePreviewSize, resolvePreviewSize } from '../utils/previewQuality.js';

// ---------------------------------------------------------------------------
// Scroll restoration
// ---------------------------------------------------------------------------

function restoreScrollPosition(element, value) {
  if (!element) return () => {};

  const target = Math.max(0, Number(value || 0));
  let cancelled = false;
  let userInteracted = false;

  const timers = [];
  const cleanups = [];

  const apply = () => {
    if (cancelled || userInteracted) return;
    if (Math.abs((element.scrollTop || 0) - target) < 2) return;
    element.scrollTo({ top: target, behavior: 'auto' });
  };

  const stopRestoring = () => { userInteracted = true; };

  ['wheel', 'touchstart', 'pointerdown', 'mousedown', 'keydown'].forEach((eventName) => {
    const handler = () => stopRestoring();
    element.addEventListener(eventName, handler, { passive: true });
    cleanups.push(() => element.removeEventListener(eventName, handler));
  });

  const raf1 = window.requestAnimationFrame(() => apply());
  const raf2 = window.requestAnimationFrame(() => window.requestAnimationFrame(() => apply()));
  timers.push(window.setTimeout(() => apply(), 90));
  timers.push(window.setTimeout(() => apply(), 180));

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => apply());
    observer.observe(element);
    cleanups.push(() => observer.disconnect());
    timers.push(window.setTimeout(() => observer.disconnect(), 280));
  }

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(raf1);
    window.cancelAnimationFrame(raf2);
    timers.forEach((timer) => window.clearTimeout(timer));
    cleanups.forEach((cleanup) => cleanup());
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function middleMouseDown(event) {
  if (event.button !== 1) return;
  event.preventDefault();
}

function middleAuxClick(event, callback) {
  if (event.button !== 1) return;
  event.preventDefault();
  event.stopPropagation();
  callback();
}

function getReadingStateLabel(state) {
  switch (state) {
    case 'read': return 'Lu';
    case 'in-progress': return 'En cours';
    case 'to-resume': return 'À reprendre';
    case 'never':
    default: return 'Non lu';
  }
}

function getReadingStateClass(state) {
  switch (state) {
    case 'read': return 'detail-badge-read';
    case 'in-progress': return 'detail-badge-progress';
    default: return 'detail-badge-unread';
  }
}

function getChapterDotClass(chapter) {
  if (chapter.isRead) return 'chapter-dot chapter-dot-read';
  if (chapter.progress?.pageIndex != null && chapter.progress.pageIndex > 0) return 'chapter-dot chapter-dot-in-progress';
  return 'chapter-dot chapter-dot-unread';
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return null;
  }
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `Il y a ${diffDays} jours`;
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;
    return formatDate(dateStr);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Online Metadata Modal
// ---------------------------------------------------------------------------

function OnlineMetadataModal({ manga, onClose, onImport }) {
  const [query, setQuery] = useState(manga.displayTitle || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(null);

  async function handleSearch(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await window.mangaAPI.searchOnlineMetadata(query.trim());
      setResults(response.results || []);
      if (response.error) setError(response.error);
    } catch (err) {
      setError(err?.message || 'Erreur réseau');
    }
    setLoading(false);
  }

  async function handleImport(item) {
    setImporting(item.malId);
    try {
      await onImport(manga.id, item);
      onClose();
    } catch (_) {
      setError("Erreur lors de l'import");
      setImporting(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h3><SearchIcon size={18} /> Rechercher des métadonnées en ligne</h3>
        <p className="muted-text">Les données importées sont copiées localement et restent disponibles hors ligne.</p>
        <form onSubmit={handleSearch} className="online-search-form">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un manga…" autoFocus />
          <button type="submit" className="primary-button" disabled={loading || !query.trim()}>
            {loading ? 'Recherche…' : 'Rechercher'}
          </button>
        </form>
        {error && <p className="muted-text" style={{ color: '#ef4444' }}>{error}</p>}
        <div className="online-results-list">
          {results.map((item) => (
            <div key={item.malId} className="online-result-card">
              <div className="online-result-cover">
                <MetadataCandidateCover candidate={item} alt={item.title} className="thumb-smooth" fallback={<div className="cover-fallback">?</div>} />
              </div>
              <div className="online-result-info">
                <strong>{item.title}</strong>
                {item.titleJapanese && <small>{item.titleJapanese}</small>}
                {item.authors && <span className="muted-text">{item.authors}</span>}
                {item.synopsis && <p className="manga-description-clamp">{item.synopsis.slice(0, 200)}…</p>}
                <div className="online-result-meta">
                  {item.score && <span className="badge-pill">Score: {item.score}</span>}
                  {item.genres?.slice(0, 3).map((g) => <span key={g} className="badge-pill">{g}</span>)}
                </div>
              </div>
              <button
                className="primary-button online-result-import"
                onClick={() => handleImport(item)}
                disabled={importing === item.malId}
              >
                {importing === item.malId ? 'Import…' : 'Importer'}
              </button>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MangaDetailView — MangaDex-like layout
// ---------------------------------------------------------------------------

function MangaDetailView({
  manga,
  allTags,
  allCollections,
  annotations = [],
  initialScrollTop = 0,
  onScrollPositionChange,
  onBack,
  onOpenChapter,
  onOpenChapterInNewTab,
  onOpenChapterInBackgroundTab,
  onResumeReading,
  onOpenSourceSeries,
  onToggleFavorite,
  onPickCover,
  onOpenMetadataEditor,
  onAddTag,
  onAddToCollection,
  onImportOnlineMetadata,
  onOpenAnnotation,
  onSelectEdition,
  onSetPreferredEdition,
  onUngroupEditions,
  chapterCardSize = 'comfortable',
  previewQuality = 'balanced',
  onPreviewSettingsChange,
  onContextMenu
}) {
  const containerRef = useRef(null);
  const [showOnlineSearch, setShowOnlineSearch] = useState(false);
  const [chapterPage, setChapterPage] = useState(0);
  const [chapterSort, setChapterSort] = useState('asc'); // 'asc' | 'desc'

  useEffect(() => () => {
    if (containerRef.current) onScrollPositionChange?.(containerRef.current.scrollTop);
  }, [onScrollPositionChange]);

  useLayoutEffect(
    () => restoreScrollPosition(containerRef.current, initialScrollTop),
    [initialScrollTop, manga.id]
  );

  const resumeChapterId = useMemo(() => {
    if (manga.progress?.lastChapterId) return manga.progress.lastChapterId;
    const ch = manga.chapters?.find((c) => !c.isRead);
    return ch?.id ?? manga.chapters?.[0]?.id ?? null;
  }, [manga]);

  const mangaCollections = useMemo(() => {
    if (!allCollections || !manga.collectionIds?.length) return [];
    const idSet = new Set(manga.collectionIds);
    return allCollections.filter((c) => idSet.has(c.id));
  }, [allCollections, manga.collectionIds]);

  const progressPercent = manga.progressPercent ?? manga.progress?.percent ?? 0;
  const readingState = manga.readingState || (manga.isRead ? 'read' : progressPercent > 0 ? 'in-progress' : 'never');
  const totalChapters = manga.chapters?.length ?? 0;
  const readChapters = manga.completedChapterCount ?? 0;

  const sortedChapters = useMemo(() => {
    if (!manga.chapters) return [];
    if (chapterSort === 'desc') return [...manga.chapters].reverse();
    return manga.chapters;
  }, [manga.chapters, chapterSort]);

  const chapterPagination = useMemo(
    () => paginateItems(sortedChapters, chapterPage, 50),
    [chapterPage, sortedChapters]
  );
  const displayedChapters = chapterPagination.items;
  const normalizedChapterCardSize = normalizePreviewSize(chapterCardSize);
  const chapterPreviewDimensions = resolvePreviewSize('chapter', normalizedChapterCardSize);

  useEffect(() => {
    setChapterPage(0);
  }, [chapterSort, manga.id]);
  const sortedAnnotations = useMemo(
    () => [...(annotations || [])].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [annotations]
  );

  const handleScroll = useCallback((event) => {
    onScrollPositionChange?.(event.currentTarget.scrollTop);
  }, [onScrollPositionChange]);

  // Aliases display
  const aliases = manga.aliases?.filter(Boolean) ?? [];

  return (
    <section className="detail-view" ref={containerRef} onScroll={handleScroll}>
      {/* Back navigation */}
      <button className="ghost-button back-button" onClick={onBack}>
        <ChevronLeftIcon size={16} /> Retour
      </button>

      {/* Hero banner — MangaDex style */}
      <div className="detail-hero detail-hero-mdx" onContextMenu={(event) => onContextMenu(event, { type: 'manga', manga })}>
        <div className="detail-cover-card">
          {(manga.coverSrc || manga.coverMediaType === 'pdf')
            ? (
              <MediaAsset
                src={manga.coverSrc}
                alt={manga.displayTitle}
                className="detail-cover thumb-smooth thumb-media"
                loading="lazy"
                mediaType={manga.coverMediaType || 'image'}
                filePath={manga.coverFilePath}
                pageNumber={manga.coverPageNumber || 1}
                maxWidth={440}
                maxHeight={660}
              />
            )
            : <div className="cover-fallback detail-cover-fallback">{manga.displayTitle[0]}</div>
          }
        </div>

        <div className="detail-copy">
          {/* Title area */}
          <div className="detail-title-row">
            <div className="detail-title-block">
              <h1 className="detail-title-ellipsis" title={manga.displayTitle}>{manga.displayTitle}</h1>
              {manga.author && <p className="detail-author">{manga.author}</p>}
              {aliases.length > 0 && (
                <p className="detail-aliases">{aliases.join(' · ')}</p>
              )}
            </div>
            <button
              className={`favorite-toggle detail-favorite ${manga.isFavorite ? 'favorite-toggle-active' : ''}`}
              onClick={() => onToggleFavorite(manga.id)}
              title={manga.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            >
              <HeartIcon size={20} filled={manga.isFavorite} />
            </button>
          </div>

          {/* Reading state badge row */}
          <div className="detail-badge-row">
            <span className={`detail-badge ${getReadingStateClass(readingState)}`}>{getReadingStateLabel(readingState)}</span>
            <span className="detail-badge detail-badge-neutral">{totalChapters} chapitre{totalChapters > 1 ? 's' : ''}</span>
            <span className="detail-badge detail-badge-neutral">{readChapters}/{totalChapters} lus</span>
            <span className="detail-badge detail-badge-neutral">{progressPercent}%</span>
          </div>

          {/* Progress bar */}
          <div className="detail-progress-bar-wrap">
            <div className="detail-progress-bar">
              <div className="detail-progress-bar-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          {/* Primary actions */}
          <div className="detail-actions-row">
            {resumeChapterId && (
              <button className="primary-button" onClick={() => (onResumeReading ? onResumeReading() : onOpenChapter(resumeChapterId))}>
                <PlayIcon size={16} /> Reprendre
              </button>
            )}
            {manga.chapters[0] && (
              <button className="ghost-button" onClick={() => onOpenChapter(manga.chapters[0].id)}>
                <ScrollIcon size={16} /> Ch. 1
              </button>
            )}
            {manga.sourceWeb?.linked ? (
              <button className="ghost-button" onClick={() => onOpenSourceSeries?.(manga)}>
                <LayersIcon size={14} /> Voir les chapitres web
              </button>
            ) : null}
            <button className="ghost-button" onClick={onOpenMetadataEditor}>
              <EditIcon size={14} /> Éditer
            </button>
            <button className="ghost-button" onClick={() => setShowOnlineSearch(true)}>
              <SearchIcon size={14} /> Métadonnées
            </button>
            <button className="ghost-button" onClick={() => onPickCover(manga.id)}>
              <SparklesIcon size={14} /> Couverture
            </button>
          </div>

          {manga.sourceWeb?.linked ? (
            <div className="detail-source-web-banner">
              <span className="detail-source-web-pill">Source web</span>
              <div className="detail-source-web-copy">
                <span>{manga.sourceWeb.sourceLabel || 'Serie liee'}</span>
                <small>
                  {manga.sourceWeb.statusLabel || 'Suivi web actif'}
                  {Array.isArray(manga.sourceWeb.importedChapterIds) && manga.sourceWeb.importedChapterIds.length > 0
                    ? ` · ${manga.sourceWeb.importedChapterIds.length} chapitre${manga.sourceWeb.importedChapterIds.length > 1 ? 's' : ''} deja importe${manga.sourceWeb.importedChapterIds.length > 1 ? 's' : ''}`
                    : ''}
                </small>
              </div>
              <button className="ghost-button detail-source-web-action" onClick={() => onOpenSourceSeries?.(manga)}>
                <LayersIcon size={14} /> Voir les chapitres web
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Info panels — compact 2-column layout */}
      {manga.workGroup?.editionCount > 1 ? (
        <div className="detail-editions-panel">
          <div>
            <span className="detail-info-label">Œuvre canonique</span>
            <strong>{manga.workGroup.editionCount} éditions reliées</strong>
          </div>
          <label>
            <span>Édition affichée</span>
            <select value={manga.id} onChange={(event) => onSelectEdition?.(event.target.value)}>
              {manga.workGroup.editions.map((edition) => (
                <option key={edition.id} value={edition.id}>{edition.title || edition.path || edition.id}</option>
              ))}
            </select>
          </label>
          <div className="maintenance-inline-actions">
            {manga.workGroup.preferredEditionId !== manga.id ? (
              <button type="button" className="primary-button" onClick={() => onSetPreferredEdition?.(manga.workGroup.id, manga.id)}>
                Définir comme préférée
              </button>
            ) : <span className="badge-pill badge-pill-collection">Édition préférée</span>}
            <button type="button" className="ghost-button" onClick={() => onUngroupEditions?.(manga.workGroup.id)}>
              Dégrouper
            </button>
          </div>
        </div>
      ) : null}

      <div className="detail-panels">
        {/* Row 1: Description + Informations side by side */}
        <div className="detail-panels-row detail-panels-primary">
          <div className="detail-panel detail-panel-description">
            <h3 className="detail-panel-title">Description</h3>
            {manga.description ? (
              <p className="detail-description">{manga.description}</p>
            ) : (
              <p className="detail-description muted-text">Aucune description. Utilise la recherche en ligne pour en importer une.</p>
            )}
          </div>

          <div className="detail-panel detail-panel-information">
            <h3 className="detail-panel-title">Informations</h3>
            <div className="detail-info-grid">
              <div className="detail-info-item">
                <span className="detail-info-label">Auteur</span>
                <span className="detail-info-value">{manga.author || '—'}</span>
              </div>
              <div className="detail-info-item">
                <span className="detail-info-label">Statut</span>
                <span className="detail-info-value">{getReadingStateLabel(readingState)}</span>
              </div>
              <div className="detail-info-item">
                <span className="detail-info-label">Chapitres</span>
                <span className="detail-info-value">{totalChapters}</span>
              </div>
              <div className="detail-info-item">
                <span className="detail-info-label">Progression</span>
                <span className="detail-info-value">{readChapters}/{totalChapters} ({progressPercent}%)</span>
              </div>
              {manga.categoryName && (
                <div className="detail-info-item">
                  <span className="detail-info-label">Catégorie</span>
                  <span className="detail-info-value">{manga.categoryName}</span>
                </div>
              )}
              {manga.addedAt && (
                <div className="detail-info-item">
                  <span className="detail-info-label">Ajouté</span>
                  <span className="detail-info-value">{formatDate(manga.addedAt)}</span>
                </div>
              )}
              {manga.lastReadAt && (
                <div className="detail-info-item">
                  <span className="detail-info-label">Lu</span>
                  <span className="detail-info-value">{formatRelativeDate(manga.lastReadAt)}</span>
                </div>
              )}
            </div>
            {manga.path && (
              <div className="detail-info-item" style={{ marginTop: 8 }}>
                <span className="detail-info-label">Chemin</span>
                <span className="detail-info-value detail-info-path">{manga.path}</span>
              </div>
            )}
          </div>
        </div>

        {manga.sourceWeb?.linked ? (
          <div className="detail-panels-row detail-panels-row-single">
            <div className="detail-panel detail-source-web-panel">
              <div className="detail-source-web-panel-copy">
                <span className="detail-info-label">Suivi Source web</span>
                <strong>{manga.sourceWeb.sourceLabel || 'Serie reliee'}</strong>
                <small>{manga.sourceWeb.statusLabel || 'Disponible depuis les menus et panneaux du manga.'}</small>
              </div>
              <div className="detail-source-web-panel-meta">
                <span className="badge-pill badge-pill-collection">
                  {Array.isArray(manga.sourceWeb.importedChapterIds) ? manga.sourceWeb.importedChapterIds.length : 0} importe(s)
                </span>
                {manga.sourceWeb.newChapterCount > 0 ? (
                  <span className="badge-pill">{manga.sourceWeb.newChapterCount} nouveau(x)</span>
                ) : null}
              </div>
              <div className="detail-source-web-panel-actions">
                <button className="ghost-button detail-source-web-action" onClick={() => onOpenSourceSeries?.(manga)}>
                  <LayersIcon size={14} /> Voir les chapitres web
                </button>
                <span className="muted-text">Disponible aussi depuis le clic droit sur le manga et ses chapitres.</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Row 2: Tags + Collections side by side */}
        <div className="detail-panels-row detail-panels-organize">
          <div className="detail-panel detail-panel-tags">
            <h3 className="detail-panel-title">
              <TagIcon size={16} /> Tags
              {onAddTag && (
                <button className="ghost-button detail-panel-action" onClick={() => onAddTag(manga.id)}>
                  <PlusIcon size={14} /> Gérer
                </button>
              )}
            </h3>
            {manga.tags?.length > 0 ? (
              <div className="detail-tag-pills">
                {manga.tags.map((tag) => (
                  <span key={tag.id} className="manga-tag-pill" style={{ '--tag-color': tag.color }}>{tag.name}</span>
                ))}
              </div>
            ) : (
              <p className="muted-text" style={{ margin: 0, fontSize: '0.85rem' }}>Aucun tag.</p>
            )}
          </div>

          <div className="detail-panel detail-panel-collections">
            <h3 className="detail-panel-title">
              <LayersIcon size={16} /> Collections
              {onAddToCollection && (
                <button className="ghost-button detail-panel-action" onClick={() => onAddToCollection(manga.id)}>
                  <PlusIcon size={14} /> Gérer
                </button>
              )}
            </h3>
            {mangaCollections.length > 0 ? (
              <div className="detail-collections-list">
                {mangaCollections.map((col) => (
                  <span key={col.id} className="badge-pill badge-pill-collection">{col.name}</span>
                ))}
              </div>
            ) : (
              <p className="muted-text" style={{ margin: 0, fontSize: '0.85rem' }}>Aucune collection.</p>
            )}
          </div>
        </div>
      </div>

      {sortedAnnotations.length > 0 ? (
        <div className="detail-annotations-panel">
          <div className="detail-annotations-head">
            <h3 className="detail-panel-title">
              <BookIcon size={16} /> Reperes et notes
            </h3>
            <span className="detail-annotations-count">{sortedAnnotations.length}</span>
          </div>

          <div className="detail-annotations-list">
            {sortedAnnotations.slice(0, 10).map((annotation) => (
              <button
                key={annotation.id}
                type="button"
                className="detail-annotation-item"
                onClick={() => onOpenAnnotation?.(annotation)}
              >
                <span className="detail-annotation-copy">
                  <strong>{annotation.label || `Page ${Number(annotation.pageIndex || 0) + 1}`}</strong>
                  <small>
                    {annotation.note || `Chapitre ${annotation.chapterId || 'inconnu'} · page ${Number(annotation.pageIndex || 0) + 1}`}
                  </small>
                </span>
                <span className="detail-annotation-jump">Ouvrir</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Chapters section */}
      <div className="detail-chapters-section">
        <div className="section-header">
          <h2>{totalChapters} Chapitre{totalChapters > 1 ? 's' : ''}</h2>
          <div className="detail-chapter-controls">
            <button
              className={`ghost-button detail-chapter-sort ${chapterSort === 'asc' ? 'active' : ''}`}
              onClick={() => setChapterSort('asc')}
            >
              1→{totalChapters}
            </button>
            <button
              className={`ghost-button detail-chapter-sort ${chapterSort === 'desc' ? 'active' : ''}`}
              onClick={() => setChapterSort('desc')}
            >
              {totalChapters}→1
            </button>
          </div>
        </div>

        <div className="preview-controls-row">
          <PreviewDisplayControls
            compact
            kind="chapter"
            size={normalizedChapterCardSize}
            quality={previewQuality}
            onSizeChange={(value) => onPreviewSettingsChange?.({ chapterCardSize: value })}
            onQualityChange={(value) => onPreviewSettingsChange?.({ previewQuality: value })}
          />
        </div>

        <div className="chapter-grid" data-preview-size={normalizedChapterCardSize}>
          {displayedChapters.map((chapter, index) => {
            const absoluteIndex = chapterPagination.start + index;
            const realIndex = chapterSort === 'desc' ? totalChapters - 1 - absoluteIndex : absoluteIndex;
            return (
              <button
                key={chapter.id}
                className={`chapter-card ${chapter.isRead ? 'chapter-card-read' : ''}`}
                onClick={() => onOpenChapter(chapter.id)}
                onMouseDown={middleMouseDown}
                onAuxClick={(event) => middleAuxClick(event, () => onOpenChapterInBackgroundTab(chapter.id))}
                onContextMenu={(event) => onContextMenu(event, { type: 'chapter', manga, chapter })}
              >
                <div className="chapter-cover-wrap">
                  {(chapter.previewSrc || chapter.previewMediaType === 'pdf')
                    ? (
                      <MediaAsset
                        src={chapter.previewSrc}
                        alt={chapter.name}
                        className="chapter-cover thumb-smooth thumb-media"
                        loading="lazy"
                        mediaType={chapter.previewMediaType || chapter.sourceType || 'image'}
                        filePath={chapter.previewFilePath || chapter.path}
                        pageNumber={chapter.previewPageNumber || 1}
                        maxWidth={chapterPreviewDimensions.width}
                        maxHeight={chapterPreviewDimensions.height}
                        thumbnail
                        previewQuality={previewQuality}
                      />
                    )
                    : <div className="cover-fallback">{realIndex + 1}</div>
                  }
                  <span className={getChapterDotClass(chapter)} />
                </div>
                <div className="chapter-card-body">
                  <strong>{chapter.name}</strong>
                  <span>{chapter.pageCount} p. · {chapter.isRead ? 'Lu' : `${getProgressPercent(chapter.progress)}%`}</span>
                </div>
              </button>
            );
          })}
        </div>

        {chapterPagination.totalPages > 1 ? (
          <div className="chapter-pagination" aria-label="Pagination des chapitres">
            <button type="button" className="ghost-button" disabled={chapterPagination.page === 0} onClick={() => setChapterPage((page) => Math.max(0, page - 1))}>Precedents</button>
            <span>{chapterPagination.start + 1}-{chapterPagination.end} sur {sortedChapters.length}</span>
            <button type="button" className="ghost-button" disabled={chapterPagination.page >= chapterPagination.totalPages - 1} onClick={() => setChapterPage((page) => Math.min(chapterPagination.totalPages - 1, page + 1))}>Suivants</button>
          </div>
        ) : null}
      </div>

      {showOnlineSearch && (
        <OnlineMetadataModal
          manga={manga}
          onClose={() => setShowOnlineSearch(false)}
          onImport={onImportOnlineMetadata}
        />
      )}
    </section>
  );
}

export default memo(MangaDetailView);
