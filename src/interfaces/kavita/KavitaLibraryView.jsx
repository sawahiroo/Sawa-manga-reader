import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Heart, MoreVertical } from 'lucide-react';
import MediaAsset from '../../components/MediaAsset.jsx';
import { resolveTabOpenIntent } from './tabInteractions.js';
import {
  getScrollOffset,
  makeAnchoredScrollPosition,
  normalizeScrollPosition,
  resolveAnchoredScrollOffset
} from '../../utils/scrollPositions.js';

const CARD_WIDTH = 154;
const CARD_GAP = 18;
const ROW_HEIGHT = 276;

function useColumnCount(containerRef) {
  const [layout, setLayout] = useState({ columns: 6, measured: false });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const update = () => {
      const width = node.clientWidth || CARD_WIDTH;
      const columns = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_WIDTH + CARD_GAP)));
      setLayout((current) => current.columns === columns && current.measured
        ? current
        : { columns, measured: true });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);

  return layout;
}

const KavitaCoverCard = memo(function KavitaCoverCard({
  manga,
  selected,
  selectionMode,
  onOpen,
  onOpenInNewTab,
  onToggleFavorite,
  onToggleSelect,
  selectionOrder,
  onContextMenu,
  privateBlur = false
}) {
  const title = manga.displayTitle || manga.name || 'Sans titre';
  const progress = Math.max(0, Math.min(100, Number(manga.progressPercent || 0)));

  return (
    <article
      className={`kv-cover-card ${selected ? 'is-selected' : ''} ${privateBlur ? 'is-private-blurred' : ''}`}
      onClick={(event) => {
        if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey) {
          onToggleSelect?.(manga.id, { event, orderedIds: selectionOrder });
          return;
        }
        const intent = resolveTabOpenIntent(event, selectionMode);
        if (intent === 'selection') {
          onToggleSelect?.(manga.id, { event, orderedIds: selectionOrder });
        } else if (intent === 'current') {
          onOpen?.(manga.id);
        } else {
          onOpenInNewTab?.(manga.id, { activate: intent === 'foreground' });
        }
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        const intent = resolveTabOpenIntent(event, selectionMode);
        if (intent === 'selection') onToggleSelect?.(manga.id, { event, orderedIds: selectionOrder });
        else onOpenInNewTab?.(manga.id, { activate: false });
      }}
      onContextMenu={(event) => onContextMenu?.(event, { type: 'manga', manga })}
      data-manga-id={manga.id}
    >
      <div className="kv-cover-media">
        {manga.coverSrc || manga.coverMediaType === 'pdf' ? (
          <MediaAsset
            src={manga.coverSrc}
            thumbnail
            alt={title}
            className="kv-cover-image"
            mediaType={manga.coverMediaType || 'image'}
            filePath={manga.coverFilePath}
            pageNumber={manga.coverPageNumber || 1}
            maxWidth={360}
            maxHeight={540}
          />
        ) : (
          <div className="kv-cover-fallback">{title.slice(0, 1)}</div>
        )}
        {progress > 0 ? (
          <div className="kv-cover-progress" aria-label={`Progression ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        {manga.isRead ? <span className="kv-read-corner"><Check size={13} /></span> : null}
        {selectionMode ? (
          <button
            type="button"
            className={`kv-card-favorite ${selected ? 'is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelect?.(manga.id, { event, orderedIds: selectionOrder });
            }}
            title="Selectionner"
          >
            <Check size={15} />
          </button>
        ) : (
          <button
            type="button"
            className={`kv-card-favorite ${manga.isFavorite ? 'is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite?.(manga.id);
            }}
            title={manga.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <Heart size={15} fill={manga.isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <div className="kv-cover-caption">
        <div>
          <strong title={title}>{title}</strong>
          <span>{manga.chapterCount || manga.chapters?.length || 0} chapitre(s)</span>
        </div>
        <button
          type="button"
          className="kv-icon-button"
          onClick={(event) => {
            event.stopPropagation();
            onContextMenu?.(event, { type: 'manga', manga });
          }}
          title="Plus d actions"
        >
          <MoreVertical size={16} />
        </button>
      </div>
    </article>
  );
});

function KavitaLibraryView({
  mangas = [],
  title = 'Bibliotheque',
  subtitle = '',
  selectionMode = false,
  selectedIds = new Set(),
  onOpenManga,
  onOpenMangaInNewTab,
  onToggleFavorite,
  onToggleSelect,
  onContextMenu,
  privateBlur = false,
  initialScrollTop = 0,
  initialScrollPosition = null,
  scrollKey = '',
  onScrollPositionChange
}) {
  const scrollRef = useRef(null);
  const gridRef = useRef(null);
  const virtualizerRef = useRef(null);
  const restoredRef = useRef('');
  const restoringRef = useRef(true);
  const { columns, measured: columnsMeasured } = useColumnCount(gridRef);
  const rows = useMemo(() => {
    const output = [];
    for (let index = 0; index < mangas.length; index += columns) {
      output.push(mangas.slice(index, index + columns));
    }
    return output;
  }, [mangas, columns]);
  const selectionOrder = useMemo(() => mangas.map((manga) => manga.id), [mangas]);
  const initialPosition = normalizeScrollPosition(initialScrollPosition ?? initialScrollTop);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.map((manga) => manga.id || manga.contentId).join('|') || `row-${index}`,
    initialOffset: () => getScrollOffset(initialPosition),
    overscan: 1
  });
  virtualizerRef.current = virtualizer;
  const restoreToken = `${scrollKey || 'kavita-library'}:${columns}:${initialPosition.anchorId || 'offset'}`;

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !columnsMeasured || restoredRef.current === restoreToken) return undefined;
    restoredRef.current = restoreToken;
    restoringRef.current = true;
    const frame = requestAnimationFrame(() => {
      const target = resolveAnchoredScrollOffset({
        position: initialPosition,
        mangas,
        columns,
        rowHeight: ROW_HEIGHT
      });
      virtualizerRef.current?.scrollToOffset(target, { align: 'start' });
      node.scrollTop = Math.min(target, Math.max(0, node.scrollHeight - node.clientHeight));
      restoringRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [columnsMeasured, restoreToken]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node || restoringRef.current) return;
    onScrollPositionChange?.(makeAnchoredScrollPosition({
      mangas,
      columns,
      rowHeight: ROW_HEIGHT,
      scrollTop: node.scrollTop,
      layoutKey: `kavita:${columns}:${ROW_HEIGHT}`
    }));
  }, [columns, mangas, onScrollPositionChange]);

  return (
    <section className="kv-library-view">
      <header className="kv-page-heading">
        <div>
          <h1>{title}</h1>
          <p>{subtitle || `${mangas.length} serie(s)`}</p>
        </div>
      </header>
      <div ref={scrollRef} className="kv-scroll-region" onScroll={handleScroll}>
        <div ref={gridRef} className="kv-virtual-grid" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.key}
              className="kv-virtual-row"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {rows[virtualRow.index].map((manga) => (
                <KavitaCoverCard
                  key={manga.id}
                  manga={manga}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(String(manga.id ?? '').trim())}
                  onOpen={onOpenManga}
                  onOpenInNewTab={onOpenMangaInNewTab}
                  onToggleFavorite={onToggleFavorite}
                  onToggleSelect={onToggleSelect}
                  selectionOrder={selectionOrder}
                  onContextMenu={onContextMenu}
                  privateBlur={privateBlur}
                />
              ))}
            </div>
          ))}
        </div>
        {mangas.length === 0 ? (
          <div className="kv-empty-state">
            <strong>Aucun manga ici</strong>
            <span>Modifie la recherche, le filtre ou la categorie active.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default memo(KavitaLibraryView);
