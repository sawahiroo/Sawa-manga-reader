import { memo, useCallback, useEffect, useRef } from 'react';
import { AlertIcon, ArchiveIcon, CheckIcon, HeartIcon, LayersIcon } from './Icons.jsx';
import MediaAsset from './MediaAsset.jsx';
import { normalizeSelectionId, resolveMangaSelectionIntent } from '../utils/selectionSessions.js';
import { resolveAdaptiveVisualEffects } from '../utils/horizon.js';

const MangaCard = memo(function MangaCard({
  manga,
  onOpen,
  onOpenSourceSeries,
  onOpenBackground,
  onToggleFavorite,
  onContextMenu,
  compact = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  selectionOrder = [],
  privateBlur = false,
  performanceMode = false,
  visualVariant = 'classic',
  foilEnabled = true,
  foilIntensity = 28,
  adaptiveVisualEffects = true
}) {
  const cardRef = useRef(null);
  const pendingPointerRef = useRef(null);
  const pointerRafRef = useRef(null);

  const mangaId = normalizeSelectionId(manga.id);
  const reducedMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const visualEffects = resolveAdaptiveVisualEffects({ foilEnabled, adaptiveVisualEffects, reducedMotion, performanceMode });

  const handleClick = useCallback((event) => {
    const intent = resolveMangaSelectionIntent(event, selectionMode);
    if (intent === 'toggle-selection') {
      onToggleSelect?.(manga.id, { event, orderedIds: selectionOrder });
      return;
    }
    if (intent === 'open') onOpen?.(manga.id);
  }, [selectionMode, onToggleSelect, manga.id, onOpen, selectionOrder]);

  const handleAuxClick = useCallback((event) => {
    if (resolveMangaSelectionIntent(event, selectionMode) !== 'open-background') return;
    event.preventDefault();
    event.stopPropagation();
    onOpenBackground?.(manga.id);
  }, [selectionMode, manga.id, onOpenBackground]);

  const handleMiddleDown = useCallback((event) => {
    if (event.button === 1) event.preventDefault();
  }, []);

  const handleFavorite = useCallback((event) => {
    event.stopPropagation();
    onToggleFavorite?.(manga.id);
  }, [manga.id, onToggleFavorite]);

  const handleSelectButton = useCallback((event) => {
    event.stopPropagation();
    onToggleSelect?.(manga.id, { event, orderedIds: selectionOrder });
  }, [manga.id, onToggleSelect, selectionOrder]);

  const handleKeyDown = useCallback((event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey || event.key === ' ') {
      onToggleSelect?.(manga.id, { event, orderedIds: selectionOrder });
      return;
    }
    onOpen?.(manga.id);
  }, [manga.id, onOpen, onToggleSelect, selectionMode, selectionOrder]);

  const handleContext = useCallback((event) => onContextMenu?.(event, { type: 'manga', manga }), [manga, onContextMenu]);
  const handleOpenSourceSeries = useCallback((event) => {
    event.stopPropagation();
    onOpenSourceSeries?.(manga);
  }, [manga, onOpenSourceSeries]);

  // Pointer events fire at high frequency (often >120 Hz on modern displays). Without coalescing,
  // every card on screen would run getBoundingClientRect + 4 style writes per event, which is a
  // heavy cost with 20+ cards visible. Coalesce into a single update per animation frame.
  const handlePointerMove = useCallback((event) => {
    if (compact || performanceMode || selectionMode || !visualEffects.dynamicFoil || visualVariant !== 'horizon') return;
    pendingPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
    if (pointerRafRef.current != null) return;
    pointerRafRef.current = window.requestAnimationFrame(() => {
      pointerRafRef.current = null;
      const pending = pendingPointerRef.current;
      pendingPointerRef.current = null;
      const node = cardRef.current;
      if (!pending || !node) return;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = (pending.clientX - rect.left) / rect.width;
      const py = (pending.clientY - rect.top) / rect.height;
      const tiltX = (0.5 - py) * 4.2;
      const tiltY = (px - 0.5) * 4.8;
      node.style.setProperty('--mc-tilt-x', `${tiltX.toFixed(2)}deg`);
      node.style.setProperty('--mc-tilt-y', `${tiltY.toFixed(2)}deg`);
      node.style.setProperty('--mc-shine-x', `${(px * 100).toFixed(1)}%`);
      node.style.setProperty('--mc-shine-y', `${(py * 100).toFixed(1)}%`);
    });
  }, [compact, performanceMode, selectionMode, visualEffects.dynamicFoil, visualVariant]);

  const handlePointerLeave = useCallback(() => {
    if (pointerRafRef.current != null) {
      window.cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = null;
    }
    pendingPointerRef.current = null;
    const node = cardRef.current;
    if (!node) return;
    node.style.removeProperty('--mc-tilt-x');
    node.style.removeProperty('--mc-tilt-y');
    node.style.removeProperty('--mc-shine-x');
    node.style.removeProperty('--mc-shine-y');
  }, []);

  useEffect(() => () => {
    if (pointerRafRef.current != null) {
      window.cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = null;
    }
    pendingPointerRef.current = null;
  }, []);

  const progressPercent = manga.progressPercent ?? 0;
  const stateLabel = manga.isRead ? 'Lu' : progressPercent > 0 ? 'En cours' : null;
  const allTags = manga.tags || [];
  const tagLimit = compact ? 2 : 3;
  const visibleTags = allTags.slice(0, tagLimit);
  const extraCount = Math.max(0, allTags.length - tagLimit);
  const infoFragments = [`${manga.chapterCount} ch.`];
  if (!compact && manga.author) infoFragments.push(manga.author);
  if (progressPercent > 0) infoFragments.push(`${progressPercent}%`);

  return (
    <article
      ref={cardRef}
      className={[
        'mc',
        compact ? 'mc-compact' : '',
        performanceMode ? 'mc-performance' : '',
        selectionMode ? 'mc-select-mode' : '',
        selected ? 'mc-selected' : '',
        privateBlur ? 'mc-private' : '',
        manga.categoryUnavailable ? 'mc-unavailable' : '',
        visualVariant === 'horizon' ? 'mc-horizon' : 'mc-classic',
        visualEffects.foil ? 'mc-foil-enabled' : 'mc-foil-disabled',
        visualEffects.dynamicFoil ? 'mc-foil-dynamic' : 'mc-foil-static'
      ].filter(Boolean).join(' ')}
      style={{ '--mc-foil-strength': Math.max(0, Math.min(100, Number(foilIntensity || 0))) / 100 }}
      onClick={handleClick}
      onMouseDown={handleMiddleDown}
      onAuxClick={handleAuxClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="option"
      aria-selected={Boolean(selected)}
      aria-label={`${selected ? 'Selectionne, ' : ''}${manga.displayTitle || 'Manga'}`}
      data-manga-id={mangaId}
      onContextMenu={handleContext}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {!performanceMode ? (
        <>
          <div className="mc-chrome" aria-hidden="true" />
          <div className="mc-rim" aria-hidden="true" />
          <div className="mc-ambient" aria-hidden="true" />
        </>
      ) : null}

      <div className="mc-cover-shell">
        <div className="mc-cover">
          {manga.coverSrc || manga.coverMediaType === 'pdf' ? (
            <MediaAsset
              src={manga.coverSrc}
              thumbnail
              alt={manga.displayTitle}
              loading="lazy"
              draggable={false}
              className="thumb-smooth thumb-media"
              mediaType={manga.coverMediaType || 'image'}
              filePath={manga.coverFilePath}
              pageNumber={manga.coverPageNumber || 1}
              maxWidth={560}
              maxHeight={840}
            />
          ) : (
            <div className="mc-cover-fallback">{(manga.displayTitle || '?')[0]}</div>
          )}

          {!performanceMode ? (
            <>
              <div className="mc-cover-glow" aria-hidden="true" />
              <div className="mc-cover-shade" aria-hidden="true" />
              <div className="mc-cover-border" aria-hidden="true" />
            </>
          ) : null}

          {progressPercent > 0 && !manga.isRead ? (
            <div className="mc-progress">
              <div className="mc-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          ) : null}

          <div className="mc-badges">
            {manga.categoryUnavailable ? <span className="mc-badge mc-badge-unavailable"><AlertIcon size={11} /> Hors ligne</span> : null}
            {stateLabel ? (
              <span className={`mc-badge ${manga.isRead ? 'mc-badge-read' : 'mc-badge-progress'}`}>
                {stateLabel}
              </span>
            ) : null}
            {manga.hasNewChapters ? <span className="mc-badge mc-badge-new">Nouveau</span> : null}
            {manga.sourceWeb?.linked ? <span className="mc-badge mc-badge-source"><LayersIcon size={11} /> Source web</span> : null}
            {manga.workGroup?.editionCount > 1 ? (
              <span className="mc-badge mc-badge-editions"><LayersIcon size={11} /> {manga.workGroup.editionCount} éditions</span>
            ) : null}
            {manga.isPrivate ? <span className="mc-badge mc-badge-private"><ArchiveIcon size={11} /> Prive</span> : null}
          </div>

          {selectionMode ? (
            <label className={`mc-select-toggle ${selected ? 'mc-select-toggle-active' : ''}`} title={selected ? 'Retirer de la selection' : 'Ajouter a la selection'}>
              <input
                type="checkbox"
                checked={Boolean(selected)}
                onChange={handleSelectButton}
                onClick={(event) => event.stopPropagation()}
                aria-label={`${selected ? 'Retirer' : 'Ajouter'} ${manga.displayTitle || 'ce manga'} de la selection`}
              />
              <CheckIcon size={14} aria-hidden="true" />
            </label>
          ) : onToggleFavorite ? (
            <button
              type="button"
              className={`mc-fav ${manga.isFavorite ? 'mc-fav-active' : ''}`}
              onClick={handleFavorite}
              title={manga.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            >
              <HeartIcon size={14} filled={manga.isFavorite} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mc-info">
        <h3 className="mc-title" title={manga.displayTitle}>{manga.displayTitle}</h3>

        {visibleTags.length > 0 ? (
          <div className="mc-tags">
            {visibleTags.map((tag) => (
              <span key={tag.id} className="mc-tag" style={{ '--tc': tag.color || 'var(--accent)' }}>{tag.name}</span>
            ))}
            {extraCount > 0 ? <span className="mc-tag mc-tag-extra">+{extraCount}</span> : null}
          </div>
        ) : null}

        <div className="mc-meta-line">
          {infoFragments.map((fragment, index) => (
            <span key={`${fragment}-${index}`}>
              {index > 0 ? <span className="mc-meta-sep">&#9702;</span> : null}
              <span className={fragment.endsWith('%') ? 'mc-meta-accent' : ''}>{fragment}</span>
            </span>
          ))}
        </div>

        {manga.sourceWeb?.linked && !selectionMode ? (
          <div className="mc-source-row">
            <button
              type="button"
              className="mc-source-action"
              onClick={handleOpenSourceSeries}
              title={manga.sourceWeb.statusLabel || 'Ouvrir les chapitres web'}
            >
              <LayersIcon size={12} /> {manga.sourceWeb.sourceLabel || 'Source web'}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
});

export default MangaCard;
