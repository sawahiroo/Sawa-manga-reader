import { describe, expect, it } from 'vitest';
import { mergeReaderProgress, resolveReaderEntry } from '../src/utils/readerProgress.js';

function chapter(pageIndex, pageCount = 100, overrides = {}) {
  return {
    id: 'chapter-1',
    pageCount,
    isRead: false,
    progress: { pageIndex, pageCount, scrollTop: 400, scrollRatio: 0.4 },
    ...overrides
  };
}

describe('reader progress v6', () => {
  it('restarts below ten percent and resumes at ten percent', () => {
    expect(resolveReaderEntry({ chapter: chapter(8), intent: { kind: 'normal' } }).pageIndex).toBe(0);
    expect(resolveReaderEntry({ chapter: chapter(9), intent: { kind: 'normal' } }).pageIndex).toBe(9);
  });

  it('restarts completed chapters without reusing their saved scroll', () => {
    const entry = resolveReaderEntry({
      chapter: chapter(99, 100, { isRead: true, readingState: 'read' }),
      intent: { kind: 'normal' }
    });
    expect(entry.pageIndex).toBe(0);
    expect(entry.readerState).toBeNull();
    expect(entry.notice).toBe('Relecture depuis le debut');
  });

  it('always honors an explicitly selected preview page', () => {
    const entry = resolveReaderEntry({
      chapter: chapter(70),
      intent: { kind: 'exact-page', pageIndex: 23 }
    });
    expect(entry.pageIndex).toBe(23);
    expect(entry.readerState).toBeNull();
    expect(entry.notice).toBe('Page 24 ouverte');
  });

  it('keeps furthest progress monotonic while allowing the cursor to move backwards', () => {
    expect(mergeReaderProgress({ pageIndex: 80, furthestPageIndex: 80 }, { pageIndex: 2 })).toMatchObject({
      pageIndex: 2,
      furthestPageIndex: 80
    });
  });
});
