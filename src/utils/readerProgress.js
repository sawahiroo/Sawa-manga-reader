export const READER_RESUME_THRESHOLD = 0.10;

export function clampReaderPage(pageIndex, pageCount = 0) {
  const count = Math.max(0, Number(pageCount) || 0);
  const page = Math.max(0, Math.floor(Number(pageIndex) || 0));
  return count > 0 ? Math.min(page, count - 1) : page;
}

export function normalizeReaderOpenIntent(intent, fallbackPageIndex = 0) {
  const source = intent && typeof intent === 'object' ? intent : {};
  const kind = ['normal', 'exact-page', 'restart'].includes(source.kind)
    ? source.kind
    : 'normal';
  return {
    kind,
    pageIndex: clampReaderPage(source.pageIndex ?? fallbackPageIndex),
    token: String(source.token || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  };
}

export function resolveReaderEntry({ chapter = null, intent = null, fallbackPageIndex = 0 } = {}) {
  const pageCount = Math.max(0, Number(chapter?.pageCount || chapter?.progress?.pageCount) || 0);
  const normalizedIntent = normalizeReaderOpenIntent(intent, fallbackPageIndex);
  const progress = chapter?.progress && typeof chapter.progress === 'object' ? chapter.progress : null;
  const isCompleted = Boolean(chapter?.isRead || chapter?.readingState === 'read');

  if (normalizedIntent.kind === 'exact-page') {
    const pageIndex = clampReaderPage(normalizedIntent.pageIndex, pageCount);
    return {
      pageIndex,
      readerState: null,
      intent: normalizedIntent,
      notice: `Page ${pageIndex + 1} ouverte`
    };
  }

  if (normalizedIntent.kind === 'restart' || isCompleted || !progress) {
    return {
      pageIndex: 0,
      readerState: null,
      intent: normalizedIntent,
      notice: isCompleted ? 'Relecture depuis le debut' : null
    };
  }

  const savedPage = clampReaderPage(progress.pageIndex, pageCount);
  const denominator = Math.max(1, pageCount || Number(progress.pageCount) || 1);
  const ratio = (savedPage + 1) / denominator;
  if (ratio < READER_RESUME_THRESHOLD) {
    return {
      pageIndex: 0,
      readerState: null,
      intent: normalizedIntent,
      notice: null
    };
  }

  return {
    pageIndex: savedPage,
    readerState: progress,
    intent: normalizedIntent,
    notice: `Reprise page ${savedPage + 1}`
  };
}

export function mergeReaderProgress(previous = null, incoming = {}) {
  const previousFurthest = Math.max(
    0,
    Number(previous?.furthestPageIndex ?? previous?.pageIndex) || 0
  );
  const nextPage = Math.max(0, Number(incoming?.pageIndex) || 0);
  return {
    ...(previous || {}),
    ...incoming,
    pageIndex: nextPage,
    furthestPageIndex: Math.max(previousFurthest, Number(incoming?.furthestPageIndex) || 0, nextPage)
  };
}
