import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons.jsx';
import MangaCard from './MangaCard.jsx';
import MediaAsset from './MediaAsset.jsx';
import {
  getScrollOffset,
  makeAnchoredScrollPosition,
  normalizeScrollPosition,
  resolveAnchoredScrollOffset
} from '../utils/scrollPositions.js';
import { selectHorizonResume } from '../utils/horizon.js';
import { resolveVirtualGridLayout, resolveVirtualGridMetrics } from './VirtualMangaGrid.js';

function makeCarouselPicks(mangas, seed) {
  const key = `${seed}:${mangas.length}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(index);
    hash |= 0;
  }
  const decorated = mangas.map((manga, index) => ({ manga, score: Math.abs(((hash ^ (index * 2654435761)) >>> 0) + index * 17) }));
  return decorated.sort((a, b) => a.score - b.score).slice(0, Math.min(12, mangas.length)).map((entry) => entry.manga);
}

function HeroCarousel({ mangas, onOpen, onContextMenu }) {
  const seedRef = useRef(Math.random().toString(36).slice(2));
  const picks = useMemo(() => makeCarouselPicks(mangas, seedRef.current), [mangas]);
  const viewportRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const featured = picks[activeIdx] ?? picks[0] ?? null;

  function move(direction) {
    if (!picks.length) return;
    const next = (activeIdx + direction + picks.length) % picks.length;
    setActiveIdx(next);
    const viewport = viewportRef.current;
    if (!viewport) return;
    const card = viewport.querySelector(`[data-cidx="${next}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  if (!picks.length) return null;

  return (
    <div className="hero-card hero-card-carousel hero-card-carousel-spotlight">
      <div className="hero-carousel-copy">
        <div className="hero-carousel-copy-topline">A la une</div>
        <h2>Bienvenue dans ta bibliotheque.</h2>
        <p>{featured?.description ? `${featured.description.slice(0, 180)}${featured.description.length > 180 ? '...' : ''}` : 'Reprends un chapitre, decouvre une serie ou explore ta collection.'}</p>
        <div className="hero-carousel-copy-meta">
          <span className="status-pill">{featured?.chapterCount ?? 0} chapitre{(featured?.chapterCount ?? 0) > 1 ? 's' : ''}</span>
          {featured?.author ? <span className="status-pill">{featured.author}</span> : null}
          <span className="status-pill">{featured?.completedChapterCount ?? 0}/{featured?.chapterCount ?? 0} lus</span>
        </div>
      </div>
      <div className="hero-carousel-premium">
        <button type="button" className="hero-carousel-nav hero-carousel-nav-left" onClick={() => move(-1)}><ChevronLeftIcon size={18} /></button>
        <div ref={viewportRef} className="hero-carousel-shell">
          <div className="hero-carousel-track">
            {picks.map((manga, index) => (
              <button
                key={manga.id}
                type="button"
                data-cidx={index}
                className={`hero-carousel-card ${index === activeIdx ? 'hero-carousel-card-active' : ''}`}
                onClick={() => onOpen(manga.id)}
                onFocus={() => setActiveIdx(index)}
                onContextMenu={(event) => onContextMenu(event, { type: 'manga', manga })}
                title={manga.displayTitle}
              >
                {manga.coverSrc || manga.coverMediaType === 'pdf' ? (
                  <MediaAsset
                    src={manga.coverSrc}
                    thumbnail
                    alt={manga.displayTitle}
                    loading="lazy"
                    className="thumb-smooth thumb-media"
                    mediaType={manga.coverMediaType || 'image'}
                    filePath={manga.coverFilePath}
                    pageNumber={manga.coverPageNumber || 1}
                    maxWidth={320}
                    maxHeight={480}
                  />
                ) : <div className="cover-fallback">{manga.displayTitle[0]}</div>}
                <span className="hero-carousel-overlay">
                  <strong>{manga.displayTitle.length > 34 ? `${manga.displayTitle.slice(0, 33)}...` : manga.displayTitle}</strong>
                  <small>{manga.chapterCount} ch.</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="hero-carousel-nav hero-carousel-nav-right" onClick={() => move(1)}><ChevronRightIcon size={18} /></button>
      </div>
    </div>
  );
}

function HorizonHero({ mangas, onOpen, onContextMenu, cinematicBackdrop = true, cinematicIntensity = 58 }) {
  const { resume, recents } = useMemo(() => selectHorizonResume(mangas, { recentLimit: 6 }), [mangas]);
  const featured = resume || recents[0] || mangas[0] || null;
  if (!featured) return null;
  const backdrop = cinematicBackdrop && featured.coverSrc
    ? { '--horizon-backdrop-image': `url("${featured.coverSrc}")`, '--horizon-backdrop-opacity': Math.max(0, Math.min(100, cinematicIntensity)) / 100 }
    : undefined;
  return (
    <section className="horizon-hero" style={backdrop} aria-label="Reprendre et lectures récentes">
      <div className="horizon-hero-shade" aria-hidden="true" />
      <div className="horizon-resume-copy">
        <span className="horizon-eyebrow">{resume ? 'Reprendre' : 'À découvrir'}</span>
        <h2 title={featured.displayTitle}>{featured.displayTitle}</h2>
        <p>{featured.description || 'Retrouve ta lecture et les œuvres ouvertes récemment.'}</p>
        <div className="horizon-resume-meta">
          <span>{featured.chapterCount || 0} chapitres</span>
          {Number(featured.progressPercent || 0) > 0 ? <span>{featured.progressPercent}% lu</span> : null}
        </div>
        <button type="button" className="primary-button horizon-resume-action" onClick={() => onOpen(featured.id)}>
          {resume ? 'Continuer' : 'Ouvrir'}
        </button>
      </div>
      <div className="horizon-recents">
        <div className="horizon-recents-heading"><strong>Récents</strong><span>{recents.length} œuvres</span></div>
        <div className="horizon-recents-rail">
          {recents.map((manga) => (
            <button key={manga.id} type="button" className="horizon-recent-card" onClick={() => onOpen(manga.id)} onContextMenu={(event) => onContextMenu(event, { type: 'manga', manga })}>
              {manga.coverSrc ? <MediaAsset src={manga.coverSrc} thumbnail alt="" loading="lazy" maxWidth={240} maxHeight={360} /> : <span className="cover-fallback">{manga.displayTitle?.[0] || '?'}</span>}
              <span><strong>{manga.displayTitle}</strong><small>{manga.chapterCount || 0} ch.</small></span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function LibraryView({
  mangas,
  cardSize = 'comfortable',
  initialScrollTop = 0,
  initialScrollPosition = null,
  scrollKey,
  onScrollPositionChange,
  onOpenManga,
  onOpenSourceSeries,
  onOpenMangaInBackgroundTab,
  onToggleFavorite,
  onContextMenu,
  showHero = true,
  selectionMode = false,
  selectedIds = new Set(),
  onToggleSelect,
  visualVariant = 'classic',
  cinematicBackdrop = true,
  cinematicIntensity = 58,
  foilEnabled = true,
  foilIntensity = 28,
  adaptiveVisualEffects = true
}) {
  const containerRef = useRef(null);
  const gridRef = useRef(null);
  const restoredRef = useRef('');
  const virtualizerRef = useRef(null);
  // Bloquer les evenements produits par initialOffset tant que la vraie grille
  // n'a pas mesure ses colonnes et termine son unique correction d'ancre.
  const savingBlockedRef = useRef(true);
  const performanceMode = mangas.length >= 150;
  const baseMetrics = resolveVirtualGridMetrics(cardSize, mangas.length);
  const minCard = baseMetrics.minCard;
  const [columns, setColumns] = useState(5);
  const [containerWidth, setContainerWidth] = useState(0);
  const [columnsMeasured, setColumnsMeasured] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const width = entry.contentRect.width;
        const nextLayout = resolveVirtualGridLayout({ cardSize, itemCount: mangas.length, containerWidth: width, visualVariant });
        setContainerWidth(width);
        setColumns(visualVariant === 'horizon'
          ? nextLayout.columns
          : Math.max(1, Math.floor((Math.max(0, width - 48) + 18) / (minCard + 18))));
        setColumnsMeasured(true);
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [cardSize, mangas.length, minCard, visualVariant]);

  const rows = useMemo(() => {
    const result = [];
    for (let index = 0; index < mangas.length; index += columns) {
      result.push(mangas.slice(index, index + columns));
    }
    return result;
  }, [mangas, columns]);
  const selectionOrder = useMemo(() => mangas.map((manga) => manga.id), [mangas]);

  const layout = resolveVirtualGridLayout({ cardSize, itemCount: mangas.length, containerWidth, visualVariant });
  const rowHeight = containerWidth > 0 ? layout.rowHeight : baseMetrics.rowHeight;
  const initialPosition = normalizeScrollPosition(initialScrollPosition ?? initialScrollTop);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]?.map((manga) => manga.id || manga.contentId).join('|') || `row-${index}`,
    initialOffset: () => getScrollOffset(initialPosition),
    overscan: performanceMode ? 0 : 1
  });
  virtualizerRef.current = virtualizer;
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  const restoreToken = `${scrollKey || 'library'}:${columns}:${initialPosition.anchorId || 'offset'}:${cardSize}`;
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || !columnsMeasured || restoredRef.current === restoreToken) return undefined;
    // La bibliotheque ne doit jamais rester decalee horizontalement.
    if (element.scrollLeft !== 0) {
      element.scrollLeft = 0;
    }
    restoredRef.current = restoreToken;
    savingBlockedRef.current = true;
    const frame = requestAnimationFrame(() => {
      const restoreOffset = resolveAnchoredScrollOffset({
        position: initialPosition,
        mangas,
        columns,
        rowHeight,
        contentOffset: gridRef.current?.offsetTop || 0
      });
      virtualizerRef.current?.scrollToOffset(restoreOffset, { align: 'start' });
      element.scrollTop = Math.min(restoreOffset, Math.max(0, element.scrollHeight - element.clientHeight));
    });
    const releaseTimer = window.setTimeout(() => {
      savingBlockedRef.current = false;
    }, 80);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(releaseTimer);
      savingBlockedRef.current = false;
    };
  }, [columnsMeasured, restoreToken]);

  const handleScroll = useCallback(() => {
    if (savingBlockedRef.current) return;
    const element = containerRef.current;
    if (element) {
      if (element.scrollLeft !== 0) {
        element.scrollLeft = 0;
      }
      onScrollPositionChange?.(makeAnchoredScrollPosition({
        mangas,
        columns,
        rowHeight,
        scrollTop: element.scrollTop,
        contentOffset: gridRef.current?.offsetTop || 0,
        layoutKey: `${cardSize}:${columns}:${rowHeight}`
      }));
    }
  }, [cardSize, columns, mangas, onScrollPositionChange, rowHeight]);

  return (
    <section className="library-view" ref={containerRef} onScroll={handleScroll}>
      {showHero && mangas.length > 0 && !selectionMode ? (
        visualVariant === 'horizon'
          ? <HorizonHero mangas={mangas} onOpen={onOpenManga} onContextMenu={onContextMenu} cinematicBackdrop={cinematicBackdrop} cinematicIntensity={cinematicIntensity} />
          : <HeroCarousel mangas={mangas} onOpen={onOpenManga} onContextMenu={onContextMenu} />
      ) : null}

      {mangas.length === 0 ? (
        <div className="empty-card">
          <h3>Aucun manga a afficher</h3>
          <p>Ajoute des categories, change de filtre ou verifie tes categories masquees.</p>
        </div>
      ) : (
        <div ref={gridRef} className="manga-grid-virtual" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              className="manga-grid-row"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${rowHeight}px`,
                transform: `translateY(${virtualRow.start}px)`,
                '--grid-columns': columns,
                '--manga-grid-gap': `${layout.gap || 18}px`,
                '--mc-card-height': `${layout.cardHeight || Math.max(1, rowHeight - 18)}px`,
                '--mc-cover-height': layout.coverHeight ? `${layout.coverHeight}px` : undefined,
                '--mc-footer-height': layout.footerHeight ? `${layout.footerHeight}px` : undefined
              }}
            >
              {rows[virtualRow.index]?.map((manga) => (
                <MangaCard
                  key={manga.id}
                  manga={manga}
                  onOpen={onOpenManga}
                  onOpenSourceSeries={onOpenSourceSeries}
                  onOpenBackground={onOpenMangaInBackgroundTab}
                  onToggleFavorite={onToggleFavorite}
                  onContextMenu={onContextMenu}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(String(manga.id ?? '').trim())}
                  onToggleSelect={onToggleSelect}
                  selectionOrder={selectionOrder}
                  performanceMode={performanceMode}
                  visualVariant={visualVariant}
                  foilEnabled={foilEnabled}
                  foilIntensity={foilIntensity}
                  adaptiveVisualEffects={adaptiveVisualEffects}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(LibraryView);
