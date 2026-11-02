import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildDoubleSpreadRanges, buildMangaJPSpreadRanges } from '../utils/reader.js';
import {
  createPanelFromDrag,
  getPagePanels,
  normalizePanelMap,
  replacePagePanels
} from '../utils/guidedView.js';
import MediaAsset from './MediaAsset.jsx';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EditIcon,
  BookIcon,
  FullscreenIcon,
  LayoutGridIcon,
  LayersIcon,
  ScrollIcon,
  SettingsIcon,
  PinIcon,
  ZoomInIcon,
  ZoomOutIcon
} from './Icons.jsx';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const AUTO_HIDE_DELAY = 3000;
export const HORIZON_READER_TOOL_IDS = Object.freeze([
  'exit',
  'bookmark',
  'notes',
  'guided-view',
  'settings',
  'fullscreen'
]);
const DEFAULT_VISUAL_PREFS = Object.freeze({
  enabled: false,
  preset: 'custom',
  contrast: 0,
  sharpen: 0,
  denoise: 0,
  moireReduction: 0,
  autoCrop: false
});
const VISUAL_PRESETS = Object.freeze({
  'manga-scan': {
    enabled: true,
    preset: 'manga-scan',
    contrast: 12,
    sharpen: 16,
    denoise: 5,
    moireReduction: 8,
    autoCrop: false
  },
  'vintage-comics': {
    enabled: true,
    preset: 'vintage-comics',
    contrast: 18,
    sharpen: 10,
    denoise: 2,
    moireReduction: 4,
    autoCrop: true
  },
  'webtoon-clean': {
    enabled: true,
    preset: 'webtoon-clean',
    contrast: 8,
    sharpen: 8,
    denoise: 14,
    moireReduction: 3,
    autoCrop: false
  }
});
const VISUAL_PRESET_OPTIONS = [
  { key: 'manga-scan', label: 'Manga Scan' },
  { key: 'vintage-comics', label: 'Vintage Comics' },
  { key: 'webtoon-clean', label: 'Webtoon Clean' },
  { key: 'custom', label: 'Custom' }
];

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function clampVisualValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeVisualPrefs(input = {}) {
  return {
    enabled: Boolean(input?.enabled),
    preset: typeof input?.preset === 'string' && input.preset.trim()
      ? input.preset.trim()
      : DEFAULT_VISUAL_PREFS.preset,
    contrast: clampVisualValue(input?.contrast ?? DEFAULT_VISUAL_PREFS.contrast, -20, 40),
    sharpen: clampVisualValue(input?.sharpen ?? DEFAULT_VISUAL_PREFS.sharpen, 0, 30),
    denoise: clampVisualValue(input?.denoise ?? DEFAULT_VISUAL_PREFS.denoise, 0, 30),
    moireReduction: clampVisualValue(input?.moireReduction ?? DEFAULT_VISUAL_PREFS.moireReduction, 0, 30),
    autoCrop: Boolean(input?.autoCrop)
  };
}

function getVisualPresetLabel(preset) {
  return VISUAL_PRESET_OPTIONS.find((option) => option.key === preset)?.label || 'Custom';
}

function buildVisualFilter(prefs) {
  if (!prefs?.enabled) return 'none';
  const contrast = Math.max(0.7, 1 + (Number(prefs.contrast || 0) / 100));
  const blur = Math.max(0, ((Number(prefs.denoise || 0) * 0.018) + (Number(prefs.moireReduction || 0) * 0.012)));
  const brightness = Math.max(0.92, 1 + (Number(prefs.sharpen || 0) / 250));
  const saturate = Math.max(0.9, 1 - (Number(prefs.moireReduction || 0) / 220) + (Number(prefs.sharpen || 0) / 280));
  return [
    `contrast(${contrast.toFixed(2)})`,
    `brightness(${brightness.toFixed(2)})`,
    `saturate(${saturate.toFixed(2)})`,
    blur > 0 ? `blur(${blur.toFixed(2)}px)` : null
  ].filter(Boolean).join(' ');
}

function ReaderView({
  manga,
  chapter,
  chapters = [],
  annotations = [],
  experimentalFeatures = {},
  focusToken,
  initialPageIndex,
  initialReaderState,
  readerIntent,
  entryNotice,
  preferredMode,
  preferredFitMode,
  preferredZoom = 1,
  autoHideUI = false,
  controlsHideMs = AUTO_HIDE_DELAY,
  visualVariant = 'classic',
  onExit,
  onOpenChapter,
  onUpdateProgress,
  onAddAnnotation,
  onDeleteAnnotation,
  onContextMenu
}) {
  const [mode, setMode] = useState(preferredMode || initialReaderState?.mode || 'single');
  const [currentPageIndex, setCurrentPageIndex] = useState(initialPageIndex ?? 0);
  const [zoom, setZoom] = useState(clampZoom(preferredZoom || initialReaderState?.zoom || 1));
  const [uiHidden, setUiHidden] = useState(false);
  const [fitMode, setFitMode] = useState(preferredFitMode || initialReaderState?.fitMode || 'fit-width');
  const [notesOpen, setNotesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [webtoonScrollState, setWebtoonScrollState] = useState({
    top: Number(initialReaderState?.scrollTop || 0),
    ratio: Number(initialReaderState?.scrollRatio || 0),
    anchorPageIndex: Number.isFinite(Number(initialReaderState?.anchorPageIndex))
      ? Number(initialReaderState.anchorPageIndex)
      : Number(initialPageIndex || 0),
    intraPageOffset: Number(initialReaderState?.intraPageOffset || 0)
  });
  const [readerNotice, setReaderNotice] = useState(entryNotice || '');
  const [visualDrawerOpen, setVisualDrawerOpen] = useState(false);
  const [visualScope, setVisualScope] = useState('global');
  const [globalVisualPrefs, setGlobalVisualPrefs] = useState(DEFAULT_VISUAL_PREFS);
  const [mangaVisualPrefs, setMangaVisualPrefs] = useState(null);
  const [comparePreviewActive, setComparePreviewActive] = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [guidedEditMode, setGuidedEditMode] = useState(false);
  const [guidedPanelMap, setGuidedPanelMap] = useState(() => normalizePanelMap());
  const [guidedSelectionIndex, setGuidedSelectionIndex] = useState(0);
  const [guidedDraftPanel, setGuidedDraftPanel] = useState(null);
  const [guidedSaveState, setGuidedSaveState] = useState('idle');
  const shellRef = useRef(null);
  const webtoonContainerRef = useRef(null);
  const webtoonRestoreRef = useRef({ phase: 'pending', userInteracted: false });
  const latestProgressRef = useRef(null);
  const onUpdateProgressRef = useRef(onUpdateProgress);
  const furthestPageIndexRef = useRef(Math.max(
    Number(initialReaderState?.furthestPageIndex || 0),
    Number(initialPageIndex || 0)
  ));
  const autoHideTimerRef = useRef(null);
  const manualUiHiddenRef = useRef(false);
  const preloadedPagesRef = useRef(null);
  const preloadedChapterIdRef = useRef(null);
  const visualSaveTimersRef = useRef({ global: null, manga: null });
  const guidedSaveTimerRef = useRef(null);
  const guidedSurfaceRef = useRef(null);
  const guidedDragRef = useRef(null);

  const safePages = Array.isArray(chapter.pages) ? chapter.pages : [];
  const spreads = useMemo(() => buildDoubleSpreadRanges(safePages.length), [safePages.length]);
  const mangaJPSpreads = useMemo(() => buildMangaJPSpreadRanges(safePages.length), [safePages.length]);
  const visualReaderEnabled = Boolean(experimentalFeatures?.visualReader);
  const guidedViewEnabled = Boolean(experimentalFeatures?.guidedView);
  const mangaVisualRef = manga?.contentId || manga?.id || null;
  const chapterGuidedRef = chapter?.contentId || chapter?.id || null;
  const chapterIndex = useMemo(() => chapters.findIndex((item) => item.id === chapter.id), [chapters, chapter.id]);
  const previousChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null;
  const nextChapter = chapterIndex >= 0 && chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : null;

  const currentSpreadIndex = useMemo(() => {
    if (currentPageIndex === 0) return 0;
    const normalizedStart = currentPageIndex % 2 === 0 ? currentPageIndex - 1 : currentPageIndex;
    return spreads.findIndex((range) => range.start === normalizedStart);
  }, [currentPageIndex, spreads]);

  const currentMangaJPSpreadIndex = useMemo(() => {
    if (currentPageIndex === 0) return 0;
    const normalizedStart = currentPageIndex % 2 === 0 ? currentPageIndex - 1 : currentPageIndex;
    return mangaJPSpreads.findIndex((range) => range.start === normalizedStart);
  }, [currentPageIndex, mangaJPSpreads]);

  const chaptersReadCount = useMemo(() => {
    return chapters.filter((ch) => ch.isRead).length;
  }, [chapters]);

  const chapterAnnotations = useMemo(
    () => annotations
      .filter((annotation) => annotation.chapterId === chapter.id)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [annotations, chapter.id]
  );
  const activeVisualPrefs = useMemo(
    () => normalizeVisualPrefs(visualScope === 'manga' ? (mangaVisualPrefs || globalVisualPrefs) : globalVisualPrefs),
    [visualScope, mangaVisualPrefs, globalVisualPrefs]
  );
  const visualFilter = useMemo(
    () => comparePreviewActive ? 'none' : buildVisualFilter(activeVisualPrefs),
    [activeVisualPrefs, comparePreviewActive]
  );
  const visualStatusLabel = activeVisualPrefs.enabled
    ? `${getVisualPresetLabel(activeVisualPrefs.preset)}${visualScope === 'manga' ? ' · ce manga' : ' · global'}`
    : 'Desactive';
  const currentGuidedPanels = useMemo(
    () => getPagePanels(guidedPanelMap, currentPageIndex),
    [guidedPanelMap, currentPageIndex]
  );
  const currentGuidedPanel = currentGuidedPanels[guidedSelectionIndex] || null;
  const guidedModeAvailable = guidedViewEnabled && mode === 'single';
  const guidedStatusLabel = guidedMode
    ? (currentGuidedPanels.length > 0 ? `Case ${guidedSelectionIndex + 1}/${currentGuidedPanels.length}` : 'Aucune case')
    : 'Desactive';
  const canGoPreviousSingle = guidedMode && mode === 'single' && currentGuidedPanels.length > 0
    ? (guidedSelectionIndex > 0 || currentPageIndex > 0)
    : currentPageIndex > 0;
  const canGoNextSingle = guidedMode && mode === 'single' && currentGuidedPanels.length > 0
    ? (guidedSelectionIndex < currentGuidedPanels.length - 1 || currentPageIndex < safePages.length - 1)
    : currentPageIndex < safePages.length - 1;


  const openNextChapter = useCallback(() => {
    if (nextChapter) onOpenChapter?.(nextChapter.id);
  }, [nextChapter, onOpenChapter]);

  const openPreviousChapter = useCallback(() => {
    if (previousChapter) onOpenChapter?.(previousChapter.id);
  }, [previousChapter, onOpenChapter]);

  useLayoutEffect(() => {
    setMode(preferredMode || 'single');
    setCurrentPageIndex(initialPageIndex ?? 0);
    setZoom(clampZoom(preferredZoom || 1));
    setFitMode(preferredFitMode || 'fit-width');
    setUiHidden(manualUiHiddenRef.current);
    setNoteDraft('');
    setWebtoonScrollState({
      top: Number(initialReaderState?.scrollTop || 0),
      ratio: Number(initialReaderState?.scrollRatio || 0),
      anchorPageIndex: Number.isFinite(Number(initialReaderState?.anchorPageIndex))
        ? Number(initialReaderState.anchorPageIndex)
        : Number(initialPageIndex || 0),
      intraPageOffset: Number(initialReaderState?.intraPageOffset || 0)
    });
    furthestPageIndexRef.current = Math.max(
      Number(initialReaderState?.furthestPageIndex || 0),
      Number(initialPageIndex || 0)
    );
    webtoonRestoreRef.current = { phase: 'pending', userInteracted: false };
    setReaderNotice(entryNotice || '');
    // Progress updates are mirrored back into initialPageIndex/initialReaderState by
    // the active tab. They must not re-arm the entry restoration while the user is
    // reading, otherwise the original page is imposed again after every save.
    // A chapter/intent change is the only real navigation boundary.
  }, [
    chapter.id,
    readerIntent?.token
  ]);

  useEffect(() => {
    onUpdateProgressRef.current = onUpdateProgress;
  }, [onUpdateProgress]);

  useEffect(() => {
    furthestPageIndexRef.current = Math.max(furthestPageIndexRef.current, currentPageIndex);
  }, [currentPageIndex]);

  useEffect(() => {
    if (!readerNotice) return undefined;
    const timer = window.setTimeout(() => setReaderNotice(''), 1800);
    return () => window.clearTimeout(timer);
  }, [readerNotice]);

  const clearAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }, []);

  // Auto-hide UI after 3 seconds of mouse inactivity (only when enabled)
  const resetAutoHideTimer = useCallback(() => {
    clearAutoHideTimer();
    if (manualUiHiddenRef.current) {
      return;
    }
    setUiHidden(false);
    if (autoHideUI && !settingsOpen && !notesOpen && !visualDrawerOpen && !guidedEditMode) {
      autoHideTimerRef.current = setTimeout(() => {
        if (!manualUiHiddenRef.current) {
          setUiHidden(true);
        }
      }, Math.max(1000, Math.min(10000, Number(controlsHideMs) || AUTO_HIDE_DELAY)));
    }
  }, [autoHideUI, clearAutoHideTimer, controlsHideMs, guidedEditMode, notesOpen, settingsOpen, visualDrawerOpen]);

  useEffect(() => {
    if (!autoHideUI) {
      clearAutoHideTimer();
      if (!manualUiHiddenRef.current) {
        setUiHidden(false);
      }
      return;
    }

    resetAutoHideTimer();
    const handleMouseMove = () => {
      if (manualUiHiddenRef.current) return;
      resetAutoHideTimer();
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearAutoHideTimer();
    };
  }, [resetAutoHideTimer, clearAutoHideTimer, autoHideUI]);

  // Chapter preloading: preload next chapter pages when within last 3 pages
  useEffect(() => {
    if (!nextChapter || !safePages.length) return;
    const pagesRemaining = safePages.length - 1 - currentPageIndex;
    if (pagesRemaining <= 3 && preloadedChapterIdRef.current !== nextChapter.id) {
      preloadedChapterIdRef.current = nextChapter.id;
      window.mangaAPI.getChapterPages(nextChapter.path).then((pages) => {
        preloadedPagesRef.current = pages;
      }).catch(() => {
        // Silently fail preloading
        preloadedPagesRef.current = null;
      });
    }
  }, [currentPageIndex, safePages.length, nextChapter]);

  // Reset preloaded pages when chapter changes
  useEffect(() => {
    preloadedPagesRef.current = null;
    preloadedChapterIdRef.current = null;
  }, [chapter.id]);

  useEffect(() => {
    if (!visualReaderEnabled) {
      setVisualDrawerOpen(false);
      setComparePreviewActive(false);
      return undefined;
    }

    let cancelled = false;
    window.mangaAPI.getVisualPrefs(mangaVisualRef).then((stored) => {
      if (cancelled) return;
      const nextGlobal = normalizeVisualPrefs(stored?.global || DEFAULT_VISUAL_PREFS);
      const nextManga = stored?.manga ? normalizeVisualPrefs(stored.manga) : null;
      setGlobalVisualPrefs(nextGlobal);
      setMangaVisualPrefs(nextManga);
      setVisualScope(nextManga && mangaVisualRef ? 'manga' : 'global');
    }).catch(() => {
      if (cancelled) return;
      setGlobalVisualPrefs(DEFAULT_VISUAL_PREFS);
      setMangaVisualPrefs(null);
      setVisualScope('global');
    });

    return () => {
      cancelled = true;
    };
  }, [mangaVisualRef, visualReaderEnabled]);

  useEffect(() => () => {
    Object.values(visualSaveTimersRef.current).forEach((timer) => {
      if (timer) window.clearTimeout(timer);
    });
  }, []);

  useEffect(() => {
    if (!guidedViewEnabled) {
      setGuidedMode(false);
      setGuidedEditMode(false);
      setGuidedPanelMap(normalizePanelMap({}, chapterGuidedRef || ''));
      setGuidedSelectionIndex(0);
      return undefined;
    }

    let cancelled = false;
    window.mangaAPI.getPanelMap(chapterGuidedRef).then((storedMap) => {
      if (cancelled) return;
      setGuidedPanelMap(normalizePanelMap(storedMap || {}, chapterGuidedRef || ''));
      setGuidedSelectionIndex(0);
      setGuidedSaveState('idle');
    }).catch(() => {
      if (cancelled) return;
      setGuidedPanelMap(normalizePanelMap({}, chapterGuidedRef || ''));
      setGuidedSelectionIndex(0);
      setGuidedSaveState('idle');
    });

    return () => {
      cancelled = true;
    };
  }, [guidedViewEnabled, chapterGuidedRef]);

  useEffect(() => {
    if (mode !== 'single') {
      setGuidedMode(false);
      setGuidedEditMode(false);
    }
  }, [mode]);

  useEffect(() => {
    setGuidedSelectionIndex(0);
  }, [currentPageIndex, chapterGuidedRef]);

  useEffect(() => {
    setGuidedSelectionIndex((value) => {
      if (currentGuidedPanels.length === 0) return 0;
      return Math.min(value, currentGuidedPanels.length - 1);
    });
  }, [currentGuidedPanels.length]);

  useEffect(() => () => {
    if (guidedSaveTimerRef.current) {
      window.clearTimeout(guidedSaveTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'webtoon' || !safePages.length) return undefined;
    const container = webtoonContainerRef.current;
    if (!container || webtoonRestoreRef.current.phase !== 'pending') return undefined;

    let rafId = null;
    let fallbackTimer = null;
    let attempts = 0;

    const stopRestoring = () => {
      webtoonRestoreRef.current = { phase: 'interaction', userInteracted: true };
    };
    container.addEventListener('wheel', stopRestoring, { passive: true, once: true });
    container.addEventListener('pointerdown', stopRestoring, { passive: true, once: true });
    container.addEventListener('touchstart', stopRestoring, { passive: true, once: true });

    const applyScroll = ({ allowFallback = false } = {}) => {
      if (webtoonRestoreRef.current.userInteracted) return true;
      const requestedPage = Math.max(0, Math.min(
        safePages.length - 1,
        Number(readerIntent?.kind === 'exact-page' || readerIntent?.kind === 'restart'
          ? initialPageIndex
          : (initialReaderState?.anchorPageIndex ?? initialPageIndex)) || 0
      ));
      const pageElement = container.querySelector(`[data-page-index="${requestedPage}"]`);
      const hasPageAnchor = pageElement && (
        readerIntent?.kind === 'exact-page'
        || readerIntent?.kind === 'restart'
        || Number.isFinite(Number(initialReaderState?.anchorPageIndex))
      );
      // Images can be measured after the reader itself has mounted. Restoring a
      // later page while its offset is still zero would incorrectly validate page 1.
      if (hasPageAnchor && requestedPage > 0 && Number(pageElement?.offsetTop || 0) <= 0 && !allowFallback) {
        return false;
      }
      webtoonRestoreRef.current.phase = 'measured';
      const maxScrollable = Math.max(0, container.scrollHeight - container.clientHeight);
      const targetTop = hasPageAnchor
        ? Math.max(0, Number(pageElement.offsetTop || 0) + (
          readerIntent?.kind === 'normal' ? Number(initialReaderState?.intraPageOffset || 0) : 0
        ))
        : (maxScrollable > 0
          ? Math.round(maxScrollable * Math.max(0, Math.min(1, Number(initialReaderState?.scrollRatio || 0))))
          : Math.max(0, Number(initialReaderState?.scrollTop || 0)));
      const previousScrollBehavior = container.style.scrollBehavior;
      container.style.scrollBehavior = 'auto';
      container.scrollTop = targetTop;
      window.requestAnimationFrame(() => {
        if (container.isConnected) container.style.scrollBehavior = previousScrollBehavior;
      });
      setCurrentPageIndex(requestedPage);
      webtoonRestoreRef.current = { phase: 'restored', userInteracted: false };
      return true;
    };

    const restoreWhenMeasured = () => {
      rafId = null;
      if (webtoonRestoreRef.current.phase !== 'pending') return;
      attempts += 1;
      if (applyScroll()) return;
      if (attempts < 300) rafId = window.requestAnimationFrame(restoreWhenMeasured);
    };
    rafId = window.requestAnimationFrame(restoreWhenMeasured);
    fallbackTimer = window.setTimeout(() => {
      if (webtoonRestoreRef.current.phase === 'pending') applyScroll({ allowFallback: true });
    }, 5000);

    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
      container.removeEventListener('wheel', stopRestoring);
      container.removeEventListener('pointerdown', stopRestoring);
      container.removeEventListener('touchstart', stopRestoring);
    };
  }, [mode, chapter.id, initialPageIndex, initialReaderState?.anchorPageIndex, readerIntent?.kind, readerIntent?.token, safePages.length]);

  const increaseZoom = () => setZoom((value) => clampZoom(value + ZOOM_STEP));
  const decreaseZoom = () => setZoom((value) => clampZoom(value - ZOOM_STEP));
  const resetZoom = () => setZoom(1);

  const queuePersistVisualPrefs = useCallback((scope, nextPrefs) => {
    const key = scope === 'manga' ? 'manga' : 'global';
    if (visualSaveTimersRef.current[key]) {
      window.clearTimeout(visualSaveTimersRef.current[key]);
    }
    visualSaveTimersRef.current[key] = window.setTimeout(() => {
      window.mangaAPI.setVisualPrefs(scope === 'manga' ? mangaVisualRef : null, nextPrefs).catch(() => {
        // Visual prefs persistence should never interrupt reading.
      });
    }, 180);
  }, [mangaVisualRef]);

  const commitVisualPrefs = useCallback((scope, nextPrefs) => {
    const normalized = normalizeVisualPrefs(nextPrefs);
    if (scope === 'manga' && mangaVisualRef) {
      setMangaVisualPrefs(normalized);
      queuePersistVisualPrefs('manga', normalized);
      return;
    }
    setGlobalVisualPrefs(normalized);
    queuePersistVisualPrefs('global', normalized);
  }, [mangaVisualRef, queuePersistVisualPrefs]);

  const applyVisualPatch = useCallback((patch, options = {}) => {
    const scope = options.scope || visualScope;
    const basePrefs = normalizeVisualPrefs(scope === 'manga' ? (mangaVisualPrefs || globalVisualPrefs) : globalVisualPrefs);
    const nextPrefs = normalizeVisualPrefs({
      ...basePrefs,
      ...patch,
      preset: options.preservePreset ? (patch?.preset ?? basePrefs.preset) : (patch?.preset ?? 'custom')
    });
    commitVisualPrefs(scope, nextPrefs);
  }, [visualScope, mangaVisualPrefs, globalVisualPrefs, commitVisualPrefs]);

  const handleSelectVisualScope = useCallback((scope) => {
    if (scope === 'manga' && mangaVisualRef) {
      if (!mangaVisualPrefs) {
        const seededPrefs = normalizeVisualPrefs(globalVisualPrefs);
        setMangaVisualPrefs(seededPrefs);
        queuePersistVisualPrefs('manga', seededPrefs);
      }
      setVisualScope('manga');
      return;
    }
    setVisualScope('global');
  }, [mangaVisualRef, mangaVisualPrefs, globalVisualPrefs, queuePersistVisualPrefs]);

  const handleApplyVisualPreset = useCallback((presetKey) => {
    if (presetKey === 'custom') {
      applyVisualPatch({ preset: 'custom' }, { preservePreset: true });
      return;
    }
    const preset = VISUAL_PRESETS[presetKey];
    if (!preset) return;
    commitVisualPrefs(visualScope, preset);
  }, [applyVisualPatch, commitVisualPrefs, visualScope]);

  const handleResetVisualPrefs = useCallback(() => {
    const fallbackPrefs = visualScope === 'manga'
      ? normalizeVisualPrefs(globalVisualPrefs)
      : DEFAULT_VISUAL_PREFS;
    commitVisualPrefs(visualScope, fallbackPrefs);
  }, [visualScope, globalVisualPrefs, commitVisualPrefs]);

  const buildVisualMediaStyle = useCallback((baseStyle = {}) => {
    const nextStyle = { ...baseStyle };
    if (!visualReaderEnabled || !activeVisualPrefs.enabled || comparePreviewActive) {
      return nextStyle;
    }

    nextStyle.filter = visualFilter;
    if (activeVisualPrefs.autoCrop) {
      nextStyle.clipPath = 'inset(1.35% 1.35%)';
      nextStyle.transform = `${baseStyle.transform ? `${baseStyle.transform} ` : ''}scale(1.035)`.trim();
      nextStyle.transformOrigin = baseStyle.transformOrigin || 'center center';
    }
    return nextStyle;
  }, [visualReaderEnabled, activeVisualPrefs, comparePreviewActive, visualFilter]);

  const persistGuidedPanelMap = useCallback((nextMap) => {
    const normalizedMap = normalizePanelMap(nextMap, chapterGuidedRef || '');
    setGuidedPanelMap(normalizedMap);
    setGuidedSaveState('saving');

    if (guidedSaveTimerRef.current) {
      window.clearTimeout(guidedSaveTimerRef.current);
    }

    guidedSaveTimerRef.current = window.setTimeout(() => {
      window.mangaAPI.savePanelMap(chapterGuidedRef, normalizedMap).then((response) => {
        setGuidedPanelMap(normalizePanelMap(response?.panelMap || normalizedMap, chapterGuidedRef || ''));
        setGuidedSaveState('saved');
      }).catch(() => {
        setGuidedSaveState('error');
      });
    }, 180);
  }, [chapterGuidedRef]);

  const handleToggleGuidedMode = useCallback(() => {
    if (mode !== 'single') {
      setMode('single');
    }
    setGuidedMode((value) => {
      const nextValue = !value;
      if (!nextValue) setGuidedEditMode(false);
      return nextValue;
    });
  }, [mode]);

  const handleToggleGuidedEditMode = useCallback(() => {
    if (mode !== 'single') {
      setMode('single');
    }
    setGuidedMode(true);
    setGuidedEditMode((value) => !value);
  }, [mode]);

  const handleSelectGuidedPanel = useCallback((panelId) => {
    const nextIndex = currentGuidedPanels.findIndex((panel) => panel.id === panelId);
    if (nextIndex >= 0) {
      setGuidedMode(true);
      setGuidedSelectionIndex(nextIndex);
    }
  }, [currentGuidedPanels]);

  const handleDeleteSelectedGuidedPanel = useCallback(() => {
    if (!currentGuidedPanel) return;
    const nextPanels = currentGuidedPanels.filter((panel) => panel.id !== currentGuidedPanel.id);
    persistGuidedPanelMap(replacePagePanels(guidedPanelMap, currentPageIndex, nextPanels));
    setGuidedSelectionIndex((value) => Math.max(0, Math.min(value, nextPanels.length - 1)));
  }, [currentGuidedPanel, currentGuidedPanels, guidedPanelMap, currentPageIndex, persistGuidedPanelMap]);

  const handleClearGuidedPage = useCallback(() => {
    if (currentGuidedPanels.length === 0) return;
    persistGuidedPanelMap(replacePagePanels(guidedPanelMap, currentPageIndex, []));
    setGuidedSelectionIndex(0);
  }, [currentGuidedPanels.length, guidedPanelMap, currentPageIndex, persistGuidedPanelMap]);

  const finishGuidedDrag = useCallback((clientX, clientY, shouldCommit = true) => {
    const drag = guidedDragRef.current;
    guidedDragRef.current = null;
    setGuidedDraftPanel(null);

    if (!shouldCommit || !drag) return;

    const nextPanel = createPanelFromDrag(
      { x: drag.startX, y: drag.startY },
      { x: clientX, y: clientY },
      drag.bounds,
      currentGuidedPanels.length
    );

    if (!nextPanel) return;

    const nextPanels = [...currentGuidedPanels, nextPanel];
    persistGuidedPanelMap(replacePagePanels(guidedPanelMap, currentPageIndex, nextPanels));
    setGuidedMode(true);
    setGuidedSelectionIndex(nextPanels.length - 1);
  }, [currentGuidedPanels, guidedPanelMap, currentPageIndex, persistGuidedPanelMap]);

  const updateGuidedDraft = useCallback((clientX, clientY) => {
    const drag = guidedDragRef.current;
    if (!drag) return;

    const draft = createPanelFromDrag(
      { x: drag.startX, y: drag.startY },
      { x: clientX, y: clientY },
      drag.bounds,
      currentGuidedPanels.length
    );

    setGuidedDraftPanel(draft);
  }, [currentGuidedPanels.length]);

  const handleGuidedOverlayPointerDown = useCallback((event) => {
    if (!guidedEditMode) return;
    if (event.button !== 0) return;
    const bounds = guidedSurfaceRef.current?.getBoundingClientRect();
    if (!bounds) return;

    event.preventDefault();
    event.stopPropagation();
    guidedDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      bounds
    };
    updateGuidedDraft(event.clientX, event.clientY);
  }, [guidedEditMode, updateGuidedDraft]);

  useEffect(() => {
    if (!guidedEditMode) {
      guidedDragRef.current = null;
      setGuidedDraftPanel(null);
      return undefined;
    }

    const handlePointerMove = (event) => updateGuidedDraft(event.clientX, event.clientY);
    const handlePointerUp = (event) => finishGuidedDrag(event.clientX, event.clientY, true);
    const handlePointerCancel = () => finishGuidedDrag(0, 0, false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [guidedEditMode, updateGuidedDraft, finishGuidedDrag]);

  const scrollWebtoonByViewport = useCallback((direction) => {
    const container = webtoonContainerRef.current;
    if (!container) return;
    const isAtTop = container.scrollTop <= 1;
    const maxScrollable = Math.max(0, container.scrollHeight - container.clientHeight);
    const isAtBottom = container.scrollTop >= (maxScrollable - 1);
    if (direction > 0 && isAtBottom) {
      openNextChapter();
      return;
    }
    if (direction < 0 && isAtTop) {
      openPreviousChapter();
      return;
    }
    const step = Math.max(120, Math.round(container.clientHeight * 0.9));
    const nextTop = Math.max(0, Math.min(maxScrollable, container.scrollTop + (step * direction)));
    container.scrollTo({ top: nextTop, behavior: 'smooth' });
  }, [openNextChapter, openPreviousChapter]);

  const scrollPagedModesByViewport = useCallback((direction) => {
    const container = shellRef.current?.querySelector('.reader-page-wrap, .reader-double-wrap');
    if (!container) return false;
    const maxScrollable = Math.max(0, container.scrollHeight - container.clientHeight);
    if (maxScrollable <= 0) return false;
    const step = Math.max(120, Math.round(container.clientHeight * 0.9));
    const nextTop = Math.max(0, Math.min(maxScrollable, container.scrollTop + (step * direction)));
    if (Math.abs(nextTop - container.scrollTop) < 1) return false;
    container.scrollTo({ top: nextTop, behavior: 'smooth' });
    return true;
  }, []);

  const goToNextPageOrChapter = useCallback(() => {
    if (!safePages.length) return;
    const atEnd = currentPageIndex >= safePages.length - 1;
    if (mode === 'manga-jp') {
      if (currentMangaJPSpreadIndex >= mangaJPSpreads.length - 1) {
        openNextChapter();
        return;
      }
      next();
      return;
    }
    if (mode === 'double') {
      if (currentSpreadIndex >= spreads.length - 1) {
        openNextChapter();
        return;
      }
      next();
      return;
    }
    if (mode === 'webtoon') {
      if (atEnd) openNextChapter();
      return;
    }
    if (atEnd) {
      openNextChapter();
      return;
    }
    next();
  }, [safePages.length, currentPageIndex, mode, currentMangaJPSpreadIndex, mangaJPSpreads.length, currentSpreadIndex, spreads.length, openNextChapter, guidedMode, currentGuidedPanels.length, guidedSelectionIndex]);

  const goToPreviousPageOrChapter = useCallback(() => {
    if (!safePages.length) return;
    const atStart = currentPageIndex <= 0;
    if (mode === 'manga-jp') {
      if (currentMangaJPSpreadIndex <= 0) {
        openPreviousChapter();
        return;
      }
      previous();
      return;
    }
    if (mode === 'double') {
      if (currentSpreadIndex <= 0) {
        openPreviousChapter();
        return;
      }
      previous();
      return;
    }
    if (mode === 'webtoon') {
      if (atStart) openPreviousChapter();
      return;
    }
    if (atStart) {
      openPreviousChapter();
      return;
    }
    previous();
  }, [safePages.length, currentPageIndex, mode, currentMangaJPSpreadIndex, currentSpreadIndex, openPreviousChapter, guidedMode, currentGuidedPanels.length, guidedSelectionIndex]);

  const toggleUiHidden = useCallback(() => {
    if (uiHidden) {
      manualUiHiddenRef.current = false;
      setUiHidden(false);
      resetAutoHideTimer();
      return;
    }
    manualUiHiddenRef.current = true;
    clearAutoHideTimer();
    setUiHidden(true);
  }, [clearAutoHideTimer, resetAutoHideTimer, uiHidden]);

  const jumpToPage = useCallback((value) => {
    const targetIndex = Math.max(0, Math.min(safePages.length - 1, Number(value) || 0));
    setCurrentPageIndex(targetIndex);
    if (mode !== 'webtoon') return;
    const container = webtoonContainerRef.current;
    const target = container?.querySelector?.(`[data-page-index="${targetIndex}"]`);
    if (!container || !target) return;
    webtoonRestoreRef.current = { phase: 'interaction', userInteracted: true };
    container.scrollTo({ top: Number(target.offsetTop || 0), behavior: 'auto' });
  }, [mode, safePages.length]);

  const handleSaveAnnotation = useCallback(async () => {
    if (!onAddAnnotation) return;
    await onAddAnnotation({
      mangaId: manga.id,
      chapterId: chapter.id,
      pageIndex: currentPageIndex,
      label: `Repere page ${currentPageIndex + 1}`,
      note: noteDraft.trim()
    });
    setNoteDraft('');
    setNotesOpen(true);
  }, [onAddAnnotation, manga.id, chapter.id, currentPageIndex, noteDraft]);

  const handleShellContextMenu = useCallback((event) => {
    onContextMenu?.(event, { type: 'reader', manga, chapter });
  }, [onContextMenu, manga, chapter]);

  useEffect(() => {
    const listener = (event) => {
      const target = event.target;
      const isEditableTarget = target instanceof HTMLElement && (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );
      const key = event.key;
      const lowerKey = typeof key === 'string' ? key.toLowerCase() : '';
      const isChapterModifier = (event.ctrlKey || event.metaKey || event.altKey) && !event.shiftKey;

      if (isEditableTarget && !isChapterModifier && !['Escape', 'F', 'f', 'H', 'h'].includes(key)) {
        return;
      }

      if (isChapterModifier && key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        openNextChapter();
        return;
      }

      if (isChapterModifier && key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        openPreviousChapter();
        return;
      }

      if (mode !== 'webtoon') {
        if (mode === 'manga-jp') {
          if (key === 'ArrowLeft') {
            event.preventDefault();
            goToNextPageOrChapter();
            return;
          }
          if (key === 'ArrowRight') {
            event.preventDefault();
            goToPreviousPageOrChapter();
            return;
          }
        } else {
          if (key === 'ArrowRight') {
            event.preventDefault();
            goToNextPageOrChapter();
            return;
          }
          if (key === 'ArrowLeft') {
            event.preventDefault();
            goToPreviousPageOrChapter();
            return;
          }
        }
      }

      if (lowerKey === 'f') {
        event.preventDefault();
        window.mangaAPI.toggleFullScreen();
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        onExit();
        return;
      }
      if (key === '+' || key === '=') {
        event.preventDefault();
        increaseZoom();
        return;
      }
      if (key === '-') {
        event.preventDefault();
        decreaseZoom();
        return;
      }
      if (key === '0') {
        event.preventDefault();
        resetZoom();
        return;
      }
      if (lowerKey === 'h') {
        event.preventDefault();
        toggleUiHidden();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [mode, onExit, openNextChapter, openPreviousChapter, goToNextPageOrChapter, goToPreviousPageOrChapter, toggleUiHidden]);

  useEffect(() => {
    if (!safePages.length) return undefined;
    const payload = {
      mangaId: manga.id,
      chapterId: chapter.id,
      pageIndex: currentPageIndex,
      furthestPageIndex: Math.max(furthestPageIndexRef.current, currentPageIndex),
      pageCount: chapter.pageCount,
      mode,
      fitMode,
      zoom,
      scrollTop: mode === 'webtoon' ? webtoonScrollState.top : 0,
      scrollRatio: mode === 'webtoon' ? webtoonScrollState.ratio : 0,
      anchorPageIndex: mode === 'webtoon' ? webtoonScrollState.anchorPageIndex : currentPageIndex,
      intraPageOffset: mode === 'webtoon' ? webtoonScrollState.intraPageOffset : 0
    };
    latestProgressRef.current = payload;
    const timeout = window.setTimeout(() => {
      onUpdateProgress?.(payload);
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [manga.id, chapter.id, currentPageIndex, chapter.pageCount, mode, fitMode, zoom, webtoonScrollState, safePages.length, onUpdateProgress]);

  useEffect(() => () => {
    if (latestProgressRef.current) {
      onUpdateProgressRef.current?.(latestProgressRef.current, { immediate: true });
    }
  }, []);

  useEffect(() => {
    const flushLatestPosition = () => {
      if (latestProgressRef.current) onUpdateProgressRef.current?.(latestProgressRef.current, { immediate: true });
    };
    window.addEventListener('blur', flushLatestPosition);
    return () => window.removeEventListener('blur', flushLatestPosition);
  }, []);

  useEffect(() => {
    if (mode !== 'webtoon' || !safePages.length) return undefined;
    const container = webtoonContainerRef.current;
    if (!container) return undefined;

    // Webtoon scroll fires dozens of times per second. The measurement below is expensive:
    // querySelectorAll + getBoundingClientRect for every image page. Coalesce into one
    // computation per animation frame so long webtoons stay smooth.
    let rafId = null;
    const measure = () => {
      rafId = null;
      // The DOM starts at scrollTop 0 even when a saved location exists. Do not
      // publish that transient value while the one-shot restoration is pending.
      if (webtoonRestoreRef.current.phase === 'pending' || webtoonRestoreRef.current.phase === 'measured') return;
      const images = container.querySelectorAll('[data-page-index]');
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < images.length; index += 1) {
        const element = images[index];
        const rect = element.getBoundingClientRect();
        const distance = Math.abs(rect.top - 120);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = Number(element.dataset.pageIndex || 0);
        }
      }
      const maxScrollable = Math.max(0, container.scrollHeight - container.clientHeight);
      const currentTop = container.scrollTop || 0;
      const anchorElement = container.querySelector(`[data-page-index="${bestIndex}"]`);
      setCurrentPageIndex(bestIndex);
      setWebtoonScrollState({
        top: currentTop,
        ratio: maxScrollable > 0 ? currentTop / maxScrollable : 0,
        anchorPageIndex: bestIndex,
        intraPageOffset: Math.max(0, currentTop - Number(anchorElement?.offsetTop || 0))
      });
    };
    const handleScroll = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(measure);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    measure();
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
  }, [mode, chapter.id, zoom, safePages.length]);

  function next() {
    if (!safePages.length) return;
    if (guidedMode && mode === 'single' && currentGuidedPanels.length > 0 && guidedSelectionIndex < currentGuidedPanels.length - 1) {
      setGuidedSelectionIndex((value) => Math.min(value + 1, currentGuidedPanels.length - 1));
      return;
    }
    if (mode === 'double') {
      const nextSpread = spreads[Math.min(currentSpreadIndex + 1, spreads.length - 1)];
      if (nextSpread) setCurrentPageIndex(nextSpread.start);
      return;
    }
    if (mode === 'manga-jp') {
      const nextSpread = mangaJPSpreads[Math.min(currentMangaJPSpreadIndex + 1, mangaJPSpreads.length - 1)];
      if (nextSpread) setCurrentPageIndex(nextSpread.start);
      return;
    }
    setCurrentPageIndex((value) => Math.min(value + 1, safePages.length - 1));
  }

  function previous() {
    if (guidedMode && mode === 'single' && currentGuidedPanels.length > 0 && guidedSelectionIndex > 0) {
      setGuidedSelectionIndex((value) => Math.max(value - 1, 0));
      return;
    }
    if (mode === 'double') {
      const prevSpread = spreads[Math.max(currentSpreadIndex - 1, 0)];
      if (prevSpread) setCurrentPageIndex(prevSpread.start);
      return;
    }
    if (mode === 'manga-jp') {
      const prevSpread = mangaJPSpreads[Math.max(currentMangaJPSpreadIndex - 1, 0)];
      if (prevSpread) setCurrentPageIndex(prevSpread.start);
      return;
    }
    setCurrentPageIndex((value) => Math.max(value - 1, 0));
  }

  function handleStageToggle(event) {
    if (event.target === event.currentTarget) {
      toggleUiHidden();
    }
  }

  function getSinglePageStyle() {
    switch (fitMode) {
      case 'fit-height':
        return visualVariant === 'horizon'
          ? { height: 'calc(100vh - 44px)', maxHeight: 'calc(100vh - 44px)', width: 'auto', maxWidth: 'calc(100% - 128px)' }
          : { height: '100%', maxHeight: 'calc(100vh - 200px)' };
      case 'original':
        return visualVariant === 'horizon'
          ? { width: 'auto', maxWidth: 'none', height: 'auto', maxHeight: 'none', zoom }
          : { transform: `scale(${zoom})`, transformOrigin: 'center top' };
      case 'fit-width':
      default:
        return visualVariant === 'horizon'
          ? { width: `min(calc(100% - 128px), ${Math.round(980 * zoom)}px)`, maxWidth: 'calc(100% - 128px)', height: 'auto', maxHeight: 'none' }
          : { width: `${Math.max(55, zoom * 100)}%`, maxWidth: `${980 * zoom}px` };
    }
  }

  function getSpreadPageStyle() {
    if (visualVariant !== 'horizon') return { maxWidth: `${480 * zoom}px` };
    if (fitMode === 'fit-height') {
      return { width: 'auto', maxWidth: 'calc(50% - 2px)', height: 'calc(100vh - 44px)', maxHeight: 'calc(100vh - 44px)' };
    }
    if (fitMode === 'original') {
      return { width: 'auto', maxWidth: 'none', height: 'auto', maxHeight: 'none', zoom };
    }
    return { width: `min(calc(50% - 2px), ${Math.round(620 * zoom)}px)`, maxWidth: 'calc(50% - 2px)', height: 'auto', maxHeight: 'calc(100vh - 40px)' };
  }

  function getWebtoonPageStyle() {
    if (visualVariant !== 'horizon') return { maxWidth: `${960 * zoom}px` };
    if (fitMode === 'fit-height') {
      return { width: 'auto', maxWidth: 'calc(100% - 144px)', height: 'calc(100vh - 44px)', maxHeight: 'calc(100vh - 44px)', objectFit: 'contain' };
    }
    if (fitMode === 'original') {
      return { width: 'auto', maxWidth: 'none', height: 'auto', maxHeight: 'none', zoom };
    }
    return { width: `min(calc(100% - 144px), ${Math.round(960 * zoom)}px)`, maxWidth: 'calc(100% - 144px)', height: 'auto', maxHeight: 'none' };
  }

  const currentSpread = spreads[currentSpreadIndex] || { start: 0, end: 0 };
  const currentMangaJPSpread = mangaJPSpreads[currentMangaJPSpreadIndex] || { start: 0, end: 0, isRTL: false };
  const zoomPercent = `${Math.round(zoom * 100)}%`;

  const isAtEndOfChapter = currentPageIndex >= safePages.length - 1;
  const showEndPanel = isAtEndOfChapter && nextChapter;

  if (!safePages.length) {
    return (
      <section className="reader-shell">
        <div className="empty-card">
          <h3>Chargement du chapitre…</h3>
          <p>Les pages sont chargées à la demande pour garder le lecteur rapide.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={shellRef}
      tabIndex={-1}
      className={`reader-shell reader-${visualVariant} reader-mode-${mode} reader-fit-${fitMode} ${uiHidden ? 'reader-shell-ui-hidden' : ''}`}
      data-visual-reader={visualReaderEnabled && activeVisualPrefs.enabled && !comparePreviewActive ? 'active' : 'inactive'}
      onContextMenu={handleShellContextMenu}
    >
      {readerNotice ? (
        <div className="reader-entry-notice" role="status" aria-live="polite">
          {readerNotice}
        </div>
      ) : null}
      {visualVariant === 'horizon' ? (
        <>
          <nav className="reader-horizon-chapter-capsule" aria-label="Navigation entre chapitres">
            <button
              type="button"
              onClick={openPreviousChapter}
              disabled={!previousChapter}
              title={previousChapter ? `Chapitre precedent : ${previousChapter.name}` : 'Aucun chapitre precedent'}
            >
              <ChevronLeftIcon size={16} />
            </button>
            <label>
              <span className="sr-only">Chapitre courant</span>
              <select value={chapter.id} onChange={(event) => onOpenChapter?.(event.target.value)}>
                {chapters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <ChevronDownIcon size={13} aria-hidden="true" />
            </label>
            <span className="reader-horizon-position">{currentPageIndex + 1}/{safePages.length}</span>
            <button
              type="button"
              onClick={openNextChapter}
              disabled={!nextChapter}
              title={nextChapter ? `Chapitre suivant : ${nextChapter.name}` : 'Aucun chapitre suivant'}
            >
              <ChevronRightIcon size={16} />
            </button>
          </nav>

          <label className="reader-horizon-progress" title={`Page ${currentPageIndex + 1} sur ${safePages.length}`}>
            <span>{currentPageIndex + 1}</span>
            <input
              type="range"
              min="1"
              max={Math.max(1, safePages.length)}
              value={currentPageIndex + 1}
              onChange={(event) => jumpToPage(Number(event.target.value) - 1)}
              aria-label={`Aller a une page, page actuelle ${currentPageIndex + 1} sur ${safePages.length}`}
            />
            <small>{safePages.length}</small>
          </label>

          <nav className="reader-horizon-tool-rail" aria-label="Outils du lecteur">
            <button type="button" data-reader-tool="exit" onClick={onExit} title="Quitter le lecteur"><ChevronLeftIcon size={18} /></button>
            <button type="button" data-reader-tool="bookmark" onClick={handleSaveAnnotation} title="Enregistrer un repere"><PinIcon size={17} /></button>
            <button type="button" data-reader-tool="notes" className={notesOpen ? 'active' : ''} onClick={() => setNotesOpen((value) => !value)} title="Notes du chapitre">
              <BookIcon size={17} />
              {chapterAnnotations.length > 0 ? <span className="reader-tool-badge">{Math.min(99, chapterAnnotations.length)}</span> : null}
            </button>
            {guidedViewEnabled ? (
              <button type="button" data-reader-tool="guided-view" className={guidedMode ? 'active' : ''} onClick={handleToggleGuidedMode} title="Lecture guidee"><LayersIcon size={17} /></button>
            ) : null}
            <button type="button" data-reader-tool="settings" className={settingsOpen ? 'active' : ''} onClick={() => setSettingsOpen((value) => !value)} title="Reglages du lecteur"><SettingsIcon size={18} /></button>
            <button type="button" data-reader-tool="fullscreen" onClick={() => window.mangaAPI.toggleFullScreen()} title="Plein ecran"><FullscreenIcon size={17} /></button>
          </nav>

          {settingsOpen ? (
            <aside className="reader-horizon-settings" aria-label="Reglages du lecteur">
              <header>
                <div><strong>Reglages</strong><span>{manga.displayTitle}</span></div>
                <button type="button" className="icon-pill" onClick={() => setSettingsOpen(false)} aria-label="Fermer les reglages">×</button>
              </header>

              <section>
                <h3>Lecture</h3>
                <div className="reader-settings-grid reader-settings-grid-four">
                  <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}><LayoutGridIcon size={15} /> Simple</button>
                  <button className={mode === 'double' ? 'active' : ''} onClick={() => setMode('double')}><LayoutGridIcon size={15} /> Double</button>
                  <button className={mode === 'manga-jp' ? 'active' : ''} onClick={() => setMode('manga-jp')}><LayoutGridIcon size={15} /> Manga JP</button>
                  <button className={mode === 'webtoon' ? 'active' : ''} onClick={() => setMode('webtoon')}><ScrollIcon size={15} /> Webtoon</button>
                </div>
              </section>

              <section>
                <h3>Ajustement</h3>
                <div className="reader-settings-grid">
                  <button className={fitMode === 'fit-width' ? 'active' : ''} onClick={() => setFitMode('fit-width')}>Largeur</button>
                  <button className={fitMode === 'fit-height' ? 'active' : ''} onClick={() => setFitMode('fit-height')}>Hauteur</button>
                  <button className={fitMode === 'original' ? 'active' : ''} onClick={() => setFitMode('original')}>Original</button>
                </div>
                <div className="reader-settings-zoom">
                  <button type="button" onClick={decreaseZoom} disabled={zoom <= MIN_ZOOM}><ZoomOutIcon size={16} /></button>
                  <button type="button" onClick={resetZoom}>{zoomPercent}</button>
                  <button type="button" onClick={increaseZoom} disabled={zoom >= MAX_ZOOM}><ZoomInIcon size={16} /></button>
                </div>
              </section>

              <section>
                <h3>Image</h3>
                {visualReaderEnabled ? (
                  <button type="button" className={`reader-settings-wide ${visualDrawerOpen ? 'active' : ''}`} onClick={() => { setVisualDrawerOpen(true); setSettingsOpen(false); }}>
                    Profils visuels et comparaison <span>{visualStatusLabel}</span>
                  </button>
                ) : <p className="reader-settings-muted">Le module visuel experimental est desactive.</p>}
              </section>

              <section>
                <h3>Guidage</h3>
                {guidedViewEnabled ? (
                  <div className="reader-settings-grid">
                    <button className={guidedMode ? 'active' : ''} onClick={handleToggleGuidedMode}>Activer</button>
                    <button className={guidedEditMode ? 'active' : ''} onClick={handleToggleGuidedEditMode}><EditIcon size={14} /> {guidedEditMode ? 'Fin edition' : 'Editer les cases'}</button>
                  </div>
                ) : <p className="reader-settings-muted">Le guidage experimental est desactive.</p>}
              </section>

              <section>
                <h3>Aide</h3>
                <p className="reader-shortcuts-help">←/→ pages · Ctrl/Alt + ←/→ chapitres · +/− zoom · 0 reinitialiser · F plein ecran · H masquer les commandes</p>
              </section>
            </aside>
          ) : null}
        </>
      ) : (
      <div className="reader-toolbar">
        <div className="reader-toolbar-left">
          <button className="ghost-button" onClick={onExit}><ChevronLeftIcon size={16} /> Quitter</button>
          <div className="reader-title-block">
            <strong>{manga.displayTitle}</strong>
            <span>{chapter.name}</span>
          </div>
        </div>

        <div className="reader-chapter-nav" title="Navigation entre chapitres">
          <button
            className="reader-chapter-nav-button"
            onClick={openPreviousChapter}
            disabled={!previousChapter}
            title={previousChapter ? `Chapitre précédent : ${previousChapter.name}` : 'Aucun chapitre précédent'}
          >
            <ChevronLeftIcon size={18} />
          </button>

          <label className="reader-chapter-select-shell">
            <span className="reader-chapter-select-label">Chapitre</span>
            <div className="reader-chapter-select-box">
              <select
                className="reader-chapter-select"
                value={chapter.id}
                onChange={(event) => onOpenChapter?.(event.target.value)}
              >
                {chapters.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <ChevronDownIcon size={16} className="reader-chapter-select-icon" />
            </div>
          </label>

          <button
            className="reader-chapter-nav-button"
            onClick={openNextChapter}
            disabled={!nextChapter}
            title={nextChapter ? `Chapitre suivant : ${nextChapter.name}` : 'Aucun chapitre suivant'}
          >
            <ChevronRightIcon size={18} />
          </button>
        </div>

        <div className="reader-toolbar-right">
          <div className="reader-mode-switch">
            <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')} title="1 page">
              <LayoutGridIcon size={16} /> 1 page
            </button>
            <button className={mode === 'double' ? 'active' : ''} onClick={() => setMode('double')} title="2 pages (gauche → droite)">
              <LayoutGridIcon size={16} /> 2p LTR
            </button>
            <button className={mode === 'manga-jp' ? 'active' : ''} onClick={() => setMode('manga-jp')} title="2 pages japonais (droite → gauche)">
              <LayoutGridIcon size={16} /> 2p JP
            </button>
            <button className={mode === 'webtoon' ? 'active' : ''} onClick={() => setMode('webtoon')} title="Scroll vertical">
              <ScrollIcon size={16} /> Webtoon
            </button>
          </div>
          {mode === 'single' && (
            <div className="reader-fit-switch">
              <button className={fitMode === 'fit-width' ? 'active' : ''} onClick={() => setFitMode('fit-width')} title="Ajuster à la largeur">
                Largeur
              </button>
              <button className={fitMode === 'fit-height' ? 'active' : ''} onClick={() => setFitMode('fit-height')} title="Ajuster à la hauteur">
                Hauteur
              </button>
              <button className={fitMode === 'original' ? 'active' : ''} onClick={() => setFitMode('original')} title="Taille originale">
                Original
              </button>
            </div>
          )}
          <div className="reader-zoom-box" title="Zoom lecture">
            <button className="icon-pill" onClick={decreaseZoom} disabled={zoom <= MIN_ZOOM} title="Zoom -">
              <ZoomOutIcon size={16} />
            </button>
            <button className="reader-zoom-value" onClick={resetZoom} title="Réinitialiser le zoom à 100%">
              {zoomPercent}
            </button>
            <button className="icon-pill" onClick={increaseZoom} disabled={zoom >= MAX_ZOOM} title="Zoom +">
              <ZoomInIcon size={16} />
            </button>
          </div>
          <button className="icon-pill" onClick={() => window.mangaAPI.toggleFullScreen()} title="Plein ecran">
            <FullscreenIcon size={16} />
          </button>
          {visualReaderEnabled && (
            <button
              className={`ghost-button reader-toolbar-note-button ${visualDrawerOpen ? 'active' : ''}`}
              onClick={() => setVisualDrawerOpen((value) => !value)}
              title="Ouvrir le panneau visuel"
            >
              Visuel
            </button>
          )}
          {guidedViewEnabled && (
            <button
              className={`ghost-button reader-toolbar-note-button ${guidedMode ? 'active' : ''}`}
              onClick={handleToggleGuidedMode}
              title="Activer la navigation guidee"
            >
              <LayersIcon size={15} /> Guide
            </button>
          )}
          {guidedViewEnabled && (
            <button
              className={`ghost-button reader-toolbar-note-button ${guidedEditMode ? 'active' : ''}`}
              onClick={handleToggleGuidedEditMode}
              title="Editer les cases de la page actuelle"
            >
              <EditIcon size={15} /> {guidedEditMode ? 'Fin edition' : 'Editer'}
            </button>
          )}
          <button className="ghost-button reader-toolbar-note-button" onClick={handleSaveAnnotation} title="Enregistrer un repere a la page actuelle">
            Repere
          </button>
          <button className={`ghost-button reader-toolbar-note-button ${notesOpen ? 'active' : ''}`} onClick={() => setNotesOpen((value) => !value)} title="Ouvrir les notes du chapitre">
            {chapterAnnotations.length > 0 ? `Notes (${chapterAnnotations.length})` : 'Notes'}
          </button>
        </div>
      </div>
      )}

      {visualReaderEnabled && visualDrawerOpen && (
        <section className="reader-visual-drawer">
          <div className="reader-visual-drawer-head">
            <div>
              <strong>Visuel</strong>
              <span>Pipeline d'affichage local, ferme par defaut pour preserver la lecture.</span>
            </div>
            <button type="button" className="ghost-button" onClick={() => setVisualDrawerOpen(false)}>
              Fermer
            </button>
          </div>

          <div className="reader-visual-actions">
            <label className="reader-visual-toggle">
              <input
                type="checkbox"
                checked={activeVisualPrefs.enabled}
                onChange={(event) => applyVisualPatch({ enabled: event.target.checked })}
              />
              <span>Activer</span>
            </label>

            {mangaVisualRef && (
              <div className="reader-visual-scope">
                <button
                  type="button"
                  className={visualScope === 'global' ? 'active' : ''}
                  onClick={() => handleSelectVisualScope('global')}
                >
                  Global
                </button>
                <button
                  type="button"
                  className={visualScope === 'manga' ? 'active' : ''}
                  onClick={() => handleSelectVisualScope('manga')}
                >
                  Ce manga
                </button>
              </div>
            )}

            <button
              type="button"
              className={`ghost-button reader-visual-compare ${comparePreviewActive ? 'active' : ''}`}
              onMouseDown={() => setComparePreviewActive(true)}
              onMouseUp={() => setComparePreviewActive(false)}
              onMouseLeave={() => setComparePreviewActive(false)}
              onTouchStart={() => setComparePreviewActive(true)}
              onTouchEnd={() => setComparePreviewActive(false)}
              onTouchCancel={() => setComparePreviewActive(false)}
            >
              Maintenir pour comparer
            </button>

            <button type="button" className="ghost-button" onClick={handleResetVisualPrefs}>
              {visualScope === 'manga' ? 'Revenir au global' : 'Reinitialiser'}
            </button>
          </div>

          <div className="reader-visual-presets">
            {VISUAL_PRESET_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={activeVisualPrefs.preset === option.key ? 'active' : ''}
                onClick={() => handleApplyVisualPreset(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="reader-visual-grid">
            <label className="reader-visual-control">
              <span>Contraste</span>
              <strong>{activeVisualPrefs.contrast}</strong>
              <input
                type="range"
                min="-20"
                max="40"
                value={activeVisualPrefs.contrast}
                onChange={(event) => applyVisualPatch({ contrast: Number(event.target.value) })}
              />
            </label>

            <label className="reader-visual-control">
              <span>Nettete</span>
              <strong>{activeVisualPrefs.sharpen}</strong>
              <input
                type="range"
                min="0"
                max="30"
                value={activeVisualPrefs.sharpen}
                onChange={(event) => applyVisualPatch({ sharpen: Number(event.target.value) })}
              />
            </label>

            <label className="reader-visual-control">
              <span>Reduction bruit</span>
              <strong>{activeVisualPrefs.denoise}</strong>
              <input
                type="range"
                min="0"
                max="30"
                value={activeVisualPrefs.denoise}
                onChange={(event) => applyVisualPatch({ denoise: Number(event.target.value) })}
              />
            </label>

            <label className="reader-visual-control">
              <span>Moiré</span>
              <strong>{activeVisualPrefs.moireReduction}</strong>
              <input
                type="range"
                min="0"
                max="30"
                value={activeVisualPrefs.moireReduction}
                onChange={(event) => applyVisualPatch({ moireReduction: Number(event.target.value) })}
              />
            </label>
          </div>

          <label className="reader-visual-toggle reader-visual-toggle-inline">
            <input
              type="checkbox"
              checked={activeVisualPrefs.autoCrop}
              onChange={(event) => applyVisualPatch({ autoCrop: event.target.checked })}
            />
            <span>Recadrage auto (apercu)</span>
          </label>

          <p className="reader-visual-caption">
            {activeVisualPrefs.enabled
              ? `Preset actif: ${getVisualPresetLabel(activeVisualPrefs.preset)}.`
              : 'Le rendu actuel reste strictement identique tant que le pipeline visuel est desactive.'}
          </p>
        </section>
      )}

      {guidedViewEnabled && (guidedMode || guidedEditMode) && (
        <section className="reader-guided-bar">
          <div className="reader-guided-copy">
            <strong>Guide manuel</strong>
            <span>
              {currentGuidedPanels.length > 0
                ? `${guidedStatusLabel} sur cette page`
                : 'Aucune case pour cette page'}
            </span>
          </div>

          <div className="reader-guided-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setGuidedSelectionIndex((value) => Math.max(value - 1, 0))}
              disabled={currentGuidedPanels.length === 0 || guidedSelectionIndex <= 0}
            >
              Case precedente
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setGuidedSelectionIndex((value) => Math.min(value + 1, currentGuidedPanels.length - 1))}
              disabled={currentGuidedPanels.length === 0 || guidedSelectionIndex >= currentGuidedPanels.length - 1}
            >
              Case suivante
            </button>
            <button type="button" className="ghost-button" onClick={handleToggleGuidedEditMode}>
              {guidedEditMode ? 'Terminer' : 'Editer la page'}
            </button>
            <button
              type="button"
              className="ghost-button danger"
              onClick={handleDeleteSelectedGuidedPanel}
              disabled={!currentGuidedPanel}
            >
              Supprimer la case
            </button>
            <button
              type="button"
              className="ghost-button danger"
              onClick={handleClearGuidedPage}
              disabled={currentGuidedPanels.length === 0}
            >
              Vider la page
            </button>
          </div>

          <span className={`reader-guided-save reader-guided-save-${guidedSaveState}`}>
            {guidedSaveState === 'saving'
              ? 'Sauvegarde...'
              : guidedSaveState === 'saved'
                ? 'Sauvegarde ok'
                : guidedSaveState === 'error'
                  ? 'Erreur de sauvegarde'
                  : 'Pret'}
          </span>
        </section>
      )}

      {mode === 'single' && (
        <div className="reader-stage" onClick={handleStageToggle}>
          {visualVariant !== 'horizon' ? <button className="reader-nav reader-nav-left" onClick={(event) => { event.stopPropagation(); previous(); }} disabled={!canGoPreviousSingle}><ChevronLeftIcon size={20} /></button> : null}
          <div className="reader-page-wrap" tabIndex={0} onClick={handleStageToggle}>
            <div
              ref={guidedSurfaceRef}
              className={`reader-guided-surface ${guidedMode ? 'reader-guided-surface-active' : ''} ${guidedEditMode ? 'reader-guided-surface-editing' : ''}`}
            >
              <MediaAsset
                key={`single-${chapter.id}-${safePages[currentPageIndex]?.id || currentPageIndex}-${mode}-${fitMode}`}
                className="reader-page thumb-media"
                src={safePages[currentPageIndex]?.src}
                alt={`Page ${currentPageIndex + 1}`}
                style={buildVisualMediaStyle(getSinglePageStyle())}
                mediaType={safePages[currentPageIndex]?.sourceType || 'image'}
                filePath={safePages[currentPageIndex]?.path}
                pageNumber={safePages[currentPageIndex]?.pdfPageNumber || currentPageIndex + 1}
                maxWidth={1400}
                maxHeight={1800}
                lazy={false}
              />

              {guidedModeAvailable && (guidedMode || guidedEditMode || guidedDraftPanel) && (
                <div
                  className={`reader-guided-overlay ${guidedEditMode ? 'reader-guided-overlay-editing' : ''}`}
                  onPointerDown={handleGuidedOverlayPointerDown}
                  onClick={(event) => event.stopPropagation()}
                >
                  {guidedMode && currentGuidedPanels.map((panel, index) => (
                    <button
                      key={panel.id}
                      type="button"
                      className={`reader-guided-panel ${guidedSelectionIndex === index ? 'active' : ''}`}
                      style={{
                        left: `${panel.x}%`,
                        top: `${panel.y}%`,
                        width: `${panel.width}%`,
                        height: `${panel.height}%`
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSelectGuidedPanel(panel.id);
                      }}
                      title={panel.label || `Case ${index + 1}`}
                    >
                      <span>{index + 1}</span>
                    </button>
                  ))}

                  {guidedDraftPanel && (
                    <div
                      className="reader-guided-panel draft"
                      style={{
                        left: `${guidedDraftPanel.x}%`,
                        top: `${guidedDraftPanel.y}%`,
                        width: `${guidedDraftPanel.width}%`,
                        height: `${guidedDraftPanel.height}%`
                      }}
                    />
                  )}

                  {guidedMode && currentGuidedPanels.length === 0 && !guidedEditMode && (
                    <div className="reader-guided-empty">
                      <strong>Aucune case</strong>
                      <span>Passe en edition puis trace des zones sur la page.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {visualVariant !== 'horizon' ? <button className="reader-nav reader-nav-right" onClick={(event) => { event.stopPropagation(); next(); }} disabled={!canGoNextSingle}><ChevronRightIcon size={20} /></button> : null}
        </div>
      )}

      {mode === 'double' && (
        <div className="reader-stage reader-stage-double" onClick={handleStageToggle}>
          {visualVariant !== 'horizon' ? <button className="reader-nav reader-nav-left" onClick={(event) => { event.stopPropagation(); previous(); }} disabled={currentSpreadIndex <= 0}><ChevronLeftIcon size={20} /></button> : null}
          <div className="reader-double-wrap" tabIndex={0} onClick={handleStageToggle}>
            <MediaAsset
              key={`double-left-${chapter.id}-${currentSpread.start}-${mode}`}
              className="reader-page reader-page-double thumb-media"
              src={safePages[currentSpread.start]?.src}
              alt={`Page ${currentSpread.start + 1}`}
              style={buildVisualMediaStyle(getSpreadPageStyle())}
              mediaType={safePages[currentSpread.start]?.sourceType || 'image'}
              filePath={safePages[currentSpread.start]?.path}
              pageNumber={safePages[currentSpread.start]?.pdfPageNumber || currentSpread.start + 1}
              maxWidth={900}
              maxHeight={1400}
              lazy={false}
            />
            {currentSpread.end !== currentSpread.start && (
              <MediaAsset
                key={`double-right-${chapter.id}-${currentSpread.end}-${mode}`}
                className="reader-page reader-page-double thumb-media"
                src={safePages[currentSpread.end]?.src}
                alt={`Page ${currentSpread.end + 1}`}
                style={buildVisualMediaStyle(getSpreadPageStyle())}
                mediaType={safePages[currentSpread.end]?.sourceType || 'image'}
                filePath={safePages[currentSpread.end]?.path}
                pageNumber={safePages[currentSpread.end]?.pdfPageNumber || currentSpread.end + 1}
                maxWidth={900}
                maxHeight={1400}
                lazy={false}
              />
            )}
          </div>
          {visualVariant !== 'horizon' ? <button className="reader-nav reader-nav-right" onClick={(event) => { event.stopPropagation(); next(); }} disabled={currentSpreadIndex >= spreads.length - 1}><ChevronRightIcon size={20} /></button> : null}
        </div>
      )}

      {mode === 'manga-jp' && (
        <div className="reader-stage reader-stage-double reader-stage-manga-jp" onClick={handleStageToggle}>
          {visualVariant !== 'horizon' ? <button className="reader-nav reader-nav-left" onClick={(event) => { event.stopPropagation(); next(); }} disabled={currentMangaJPSpreadIndex >= mangaJPSpreads.length - 1}><ChevronLeftIcon size={20} /></button> : null}
          <div className="reader-double-wrap reader-double-wrap-rtl" tabIndex={0} onClick={handleStageToggle}>
            {currentMangaJPSpread.isRTL && currentMangaJPSpread.end !== currentMangaJPSpread.start ? (
              <>
                <MediaAsset
                  key={`jp-left-${chapter.id}-${currentMangaJPSpread.start}-${mode}`}
                  className="reader-page reader-page-double thumb-media"
                  src={safePages[currentMangaJPSpread.start]?.src}
                  alt={`Page ${currentMangaJPSpread.start + 1}`}
                  style={buildVisualMediaStyle(getSpreadPageStyle())}
                  mediaType={safePages[currentMangaJPSpread.start]?.sourceType || 'image'}
                  filePath={safePages[currentMangaJPSpread.start]?.path}
                  pageNumber={safePages[currentMangaJPSpread.start]?.pdfPageNumber || currentMangaJPSpread.start + 1}
                  maxWidth={900}
                  maxHeight={1400}
                  lazy={false}
                />
                <MediaAsset
                  key={`jp-right-${chapter.id}-${currentMangaJPSpread.end}-${mode}`}
                  className="reader-page reader-page-double thumb-media"
                  src={safePages[currentMangaJPSpread.end]?.src}
                  alt={`Page ${currentMangaJPSpread.end + 1}`}
                  style={buildVisualMediaStyle(getSpreadPageStyle())}
                  mediaType={safePages[currentMangaJPSpread.end]?.sourceType || 'image'}
                  filePath={safePages[currentMangaJPSpread.end]?.path}
                  pageNumber={safePages[currentMangaJPSpread.end]?.pdfPageNumber || currentMangaJPSpread.end + 1}
                  maxWidth={900}
                  maxHeight={1400}
                  lazy={false}
                />
              </>
            ) : (
              <MediaAsset
                key={`jp-single-${chapter.id}-${currentMangaJPSpread.start}-${mode}`}
                className="reader-page reader-page-double thumb-media"
                src={safePages[currentMangaJPSpread.start]?.src}
                alt={`Page ${currentMangaJPSpread.start + 1}`}
                style={buildVisualMediaStyle(getSpreadPageStyle())}
                mediaType={safePages[currentMangaJPSpread.start]?.sourceType || 'image'}
                filePath={safePages[currentMangaJPSpread.start]?.path}
                pageNumber={safePages[currentMangaJPSpread.start]?.pdfPageNumber || currentMangaJPSpread.start + 1}
                maxWidth={900}
                maxHeight={1400}
                lazy={false}
              />
            )}
          </div>
          {visualVariant !== 'horizon' ? <button className="reader-nav reader-nav-right" onClick={(event) => { event.stopPropagation(); previous(); }} disabled={currentMangaJPSpreadIndex <= 0}><ChevronRightIcon size={20} /></button> : null}
        </div>
      )}

      {mode === 'webtoon' && (
        <div className="webtoon-stage" ref={webtoonContainerRef} tabIndex={0} onClick={handleStageToggle}>
          {safePages.map((page) => (
            <MediaAsset
              key={page.id}
              data-page-index={page.index}
              className="webtoon-page thumb-media"
              src={page.src}
              alt={`Page ${page.index + 1}`}
              loading="lazy"
              style={buildVisualMediaStyle(getWebtoonPageStyle())}
              mediaType={page.sourceType || 'image'}
              filePath={page.path}
              pageNumber={page.pdfPageNumber || page.index + 1}
              maxWidth={1400}
              maxHeight={2000}
              lazy
            />
          ))}
        </div>
      )}

      {visualVariant === 'horizon' && mode !== 'webtoon' ? (
        <>
          <button
            type="button"
            className="reader-nav reader-nav-left"
            aria-label="Page precedente"
            onPointerDown={(event) => { event.stopPropagation(); (mode === 'manga-jp' ? next : previous)(); }}
            onClick={(event) => { event.stopPropagation(); if (event.detail === 0) (mode === 'manga-jp' ? next : previous)(); }}
            disabled={mode === 'single'
              ? !canGoPreviousSingle
              : mode === 'double'
                ? currentSpreadIndex <= 0
                : currentMangaJPSpreadIndex >= mangaJPSpreads.length - 1}
          >
            <ChevronLeftIcon size={20} />
          </button>
          <button
            type="button"
            className="reader-nav reader-nav-right"
            aria-label="Page suivante"
            onPointerDown={(event) => { event.stopPropagation(); (mode === 'manga-jp' ? previous : next)(); }}
            onClick={(event) => { event.stopPropagation(); if (event.detail === 0) (mode === 'manga-jp' ? previous : next)(); }}
            disabled={mode === 'single'
              ? !canGoNextSingle
              : mode === 'double'
                ? currentSpreadIndex >= spreads.length - 1
                : currentMangaJPSpreadIndex <= 0}
          >
            <ChevronRightIcon size={20} />
          </button>
        </>
      ) : null}

      {showEndPanel && (
        <div className="reader-end-panel">
          <h2>Chapitre termine !</h2>
          <p>{chaptersReadCount}/{chapters.length} chapitres lus</p>
          <div className="reader-end-panel-actions">
            <button className="primary-button" onClick={() => onOpenChapter?.(nextChapter.id)}>
              Chapitre suivant
            </button>
            <button className="ghost-button" onClick={onExit}>
              Retour a la fiche manga
            </button>
          </div>
        </div>
      )}

      {notesOpen && (
        <aside className="reader-notes-panel">
          <div className="reader-notes-head">
            <div>
              <strong>Repere et notes</strong>
              <span>Page actuelle: {currentPageIndex + 1}</span>
            </div>
            <button type="button" className="ghost-button" onClick={() => setNotesOpen(false)}>Fermer</button>
          </div>

          <label className="reader-notes-editor">
            <span>Note rapide</span>
            <textarea
              rows="3"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Ajoute un contexte, une scene a relire ou un commentaire court..."
            />
          </label>

          <div className="reader-notes-actions">
            <button type="button" className="primary-button" onClick={handleSaveAnnotation}>
              Sauver la page actuelle
            </button>
          </div>

          <div className="reader-notes-list">
            {chapterAnnotations.length === 0 ? (
              <p className="muted-text">Aucun repere sur ce chapitre pour le moment.</p>
            ) : (
              chapterAnnotations.map((annotation) => (
                <article key={annotation.id} className="reader-note-card">
                  <div className="reader-note-card-head">
                    <strong>{annotation.label || `Page ${Number(annotation.pageIndex || 0) + 1}`}</strong>
                    <span>Page {Number(annotation.pageIndex || 0) + 1}</span>
                  </div>
                  {annotation.note ? <p>{annotation.note}</p> : null}
                  <div className="reader-note-card-actions">
                    <button type="button" className="ghost-button" onClick={() => setCurrentPageIndex(Number(annotation.pageIndex || 0))}>
                      Aller ici
                    </button>
                    {onDeleteAnnotation ? (
                      <button type="button" className="ghost-button danger" onClick={() => onDeleteAnnotation(manga.id, annotation.id)}>
                        Supprimer
                      </button>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </aside>
      )}

      <div className="reader-statusbar">
        <span>Page {currentPageIndex + 1} / {chapter.pageCount}</span>
        <span>Mode: {mode === 'single' ? 'page simple' : mode === 'double' ? 'double page' : mode === 'manga-jp' ? 'manga JP' : 'scroll webtoon'}</span>
        <span>{zoomPercent} · + / - / 0 pour le zoom · F pour plein écran · H pour masquer l'UI · ← / → aux bords ou Ctrl/Alt + ← / → pour changer de chapitre</span>
      </div>
    </section>
  );
}

export default memo(ReaderView);
