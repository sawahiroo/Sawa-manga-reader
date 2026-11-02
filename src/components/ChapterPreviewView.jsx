import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronLeftIcon, LayersIcon, PlusIcon } from './Icons.jsx';
import MediaAsset from './MediaAsset.jsx';
import PreviewDisplayControls from './PreviewDisplayControls.jsx';
import { normalizePreviewSize, resolvePreviewSize } from '../utils/previewQuality.js';

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

  const stopRestoring = () => {
    userInteracted = true;
  };

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

function ChapterPreviewView({
  manga,
  chapter,
  initialScrollTop = 0,
  onScrollPositionChange,
  onBack,
  onReadFrom,
  onReadFromNewTab,
  onReadFromBackgroundTab,
  onOpenSourceSeries,
  pagePreviewSize = 'comfortable',
  previewQuality = 'balanced',
  onPreviewSettingsChange,
  onContextMenu
}) {
  const containerRef = useRef(null);
  const isLoadingPages = !Array.isArray(chapter.pages);
  const normalizedPagePreviewSize = normalizePreviewSize(pagePreviewSize);
  const pagePreviewDimensions = resolvePreviewSize('page', normalizedPagePreviewSize);

  useEffect(() => () => {
    if (containerRef.current) onScrollPositionChange?.(containerRef.current.scrollTop);
  }, [onScrollPositionChange]);

  useLayoutEffect(() => restoreScrollPosition(containerRef.current, initialScrollTop), [initialScrollTop, chapter.id]);

  return (
    <section className="preview-view" ref={containerRef} onScroll={(event) => onScrollPositionChange?.(event.currentTarget.scrollTop)}>
      <div className="preview-header" onContextMenu={(event) => onContextMenu(event, { type: 'chapter', manga, chapter })}>
        <button className="ghost-button back-button" onClick={onBack}><ChevronLeftIcon size={16} /> Retour aux chapitres</button>
        <div>
          <h2>{manga.displayTitle}</h2>
          <p>{chapter.name} · {chapter.pageCount} pages</p>
        </div>
        <div className="detail-actions-row">
          <button className="primary-button" onClick={() => onReadFrom(0, 'restart')} disabled={isLoadingPages}>Lire depuis le début</button>
          <button className="ghost-button" onClick={() => onReadFromNewTab(0, 'restart')} disabled={isLoadingPages}><PlusIcon size={16} /> Nouvel onglet</button>
          {manga.sourceWeb?.linked ? (
            <button className="ghost-button" onClick={() => onOpenSourceSeries?.(manga)}>
              <LayersIcon size={14} /> Voir les chapitres web
            </button>
          ) : null}
        </div>
      </div>

      {manga.sourceWeb?.linked ? (
        <div className="preview-source-web-banner">
          <div className="preview-source-web-copy">
            <strong>Source web</strong>
            <span>{manga.sourceWeb.sourceLabel || 'Serie liee'} · {manga.sourceWeb.statusLabel || 'Reprise disponible'}</span>
          </div>
          <button className="ghost-button" onClick={() => onOpenSourceSeries?.(manga)}>
            <LayersIcon size={14} /> Voir les chapitres web
          </button>
        </div>
      ) : null}

      {isLoadingPages ? (
        <div className="empty-card">
          <h3>Préparation du chapitre…</h3>
          <p>Les pages sont chargées à la demande pour garder l’application rapide.</p>
        </div>
      ) : (
        <>
          <div className="preview-controls-row">
            <PreviewDisplayControls
              compact
              kind="page"
              size={normalizedPagePreviewSize}
              quality={previewQuality}
              onSizeChange={(value) => onPreviewSettingsChange?.({ pagePreviewSize: value })}
              onQualityChange={(value) => onPreviewSettingsChange?.({ previewQuality: value })}
            />
          </div>
          <div className="page-preview-grid" data-preview-size={normalizedPagePreviewSize}>
            {chapter.pages.map((page) => (
              <button
                key={page.id}
                className="page-thumb"
                onClick={() => onReadFrom(page.index, 'exact-page')}
                onMouseDown={middleMouseDown}
                onAuxClick={(event) => middleAuxClick(event, () => onReadFromBackgroundTab(page.index, 'exact-page'))}
                onContextMenu={(event) => onContextMenu(event, { type: 'chapter', manga, chapter, pageIndex: page.index })}
              >
                <MediaAsset
                  src={page.src}
                  alt={`Page ${page.index + 1}`}
                  loading="lazy"
                  className="thumb-smooth thumb-media"
                  mediaType={page.sourceType || 'image'}
                  filePath={page.path}
                  pageNumber={page.pdfPageNumber || page.index + 1}
                  maxWidth={pagePreviewDimensions.width}
                  maxHeight={pagePreviewDimensions.height}
                  thumbnail
                  previewQuality={previewQuality}
                />
                <span>Page {page.index + 1}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default memo(ChapterPreviewView);
