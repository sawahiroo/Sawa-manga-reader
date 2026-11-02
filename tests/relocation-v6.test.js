import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  applyCategoryRelocation,
  createCategoryRelocationPlan,
  preserveUnavailableLibraryEntries,
  rebasePath,
  undoCategoryRelocation
} = require('../electron/services/relocation.cjs');
const { normalizeState } = require('../electron/services/storage.cjs');

const temporaryPaths = [];
afterEach(() => temporaryPaths.splice(0).forEach((entry) => fs.rmSync(entry, { recursive: true, force: true })));

function makeLibraryCategory(root, mangaId, chapterId) {
  return {
    id: 'category-stable',
    path: root,
    mangas: [{
      id: mangaId,
      contentId: 'manga-content',
      path: path.join(root, 'Manga'),
      chapters: [{ id: chapterId, contentId: 'chapter-content', path: path.join(root, 'Manga', 'Chapitre 1') }]
    }]
  };
}

describe('v6 category relocation', () => {
  it('keeps the last valid cards and scan identities when a disk is disconnected', () => {
    const previous = {
      categories: [{ id: 'external', name: 'Disque externe', path: 'N:\\Mangas', exists: true, mangas: [{ id: 'manga', contentId: 'content', isFavorite: true }] }],
      allMangas: [{ id: 'manga', contentId: 'content', isFavorite: true }],
      recents: [{ mangaId: 'manga', chapterId: 'chapter' }]
    };
    const scanned = {
      categories: [{ id: 'external', name: 'Disque externe', path: 'N:\\Mangas', exists: false, mangas: [] }],
      allMangas: [],
      favorites: [],
      recents: [],
      scanIndex: { entries: [] }
    };
    const preserved = preserveUnavailableLibraryEntries(scanned, previous, {
      scanIndex: { entries: [{ path: 'N:\\Mangas\\Titre', legacyId: 'manga', contentId: 'content' }] }
    });
    expect(preserved.categories[0]).toMatchObject({ availability: 'missing', mangaCount: 1 });
    expect(preserved.allMangas[0]).toMatchObject({ id: 'manga', categoryUnavailable: true, readOnly: true });
    expect(preserved.favorites).toHaveLength(1);
    expect(preserved.recents).toHaveLength(1);
    expect(preserved.scanIndex.entries).toHaveLength(1);
  });

  it('migrates v5 categories and reader anchors without changing stable ids', () => {
    const migrated = normalizeState({
      version: 5,
      stateVersion: 5,
      categories: [{ id: 'stable-category', path: 'C:\\Mangas', name: 'Mangas', hidden: true }],
      progress: { chapter: { mangaId: 'manga', chapterId: 'chapter', pageIndex: 8, pageCount: 20 } },
      session: { version: 5, tabs: [], scrollPositions: {} }
    });
    expect(migrated).toMatchObject({ version: 7, stateVersion: 7, session: { version: 8 } });
    expect(migrated.categories[0]).toMatchObject({
      id: 'stable-category',
      path: 'C:\\Mangas',
      hidden: true,
      pathHistory: ['C:\\Mangas'],
      availability: 'available'
    });
    expect(migrated.progress.chapter).toMatchObject({
      pageIndex: 8,
      furthestPageIndex: 8,
      anchorPageIndex: 8,
      intraPageOffset: 0
    });
  });

  it('remaps reading, covers, vault and nested visual preferences atomically', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-relocation-'));
    temporaryPaths.push(base);
    const oldRoot = path.join(base, 'SCAN');
    const newRoot = path.join(base, 'Mangas');
    fs.mkdirSync(path.join(newRoot, 'Manga'), { recursive: true });
    fs.writeFileSync(path.join(newRoot, 'Manga', 'cover.jpg'), 'cover');
    const category = { id: 'category-stable', path: oldRoot, name: 'SCAN', pathHistory: [oldRoot] };
    const plan = createCategoryRelocationPlan({
      category,
      previousCategory: makeLibraryCategory(oldRoot, 'old-manga', 'old-chapter'),
      nextCategory: makeLibraryCategory(newRoot, 'new-manga', 'new-chapter'),
      targetPath: newRoot,
      stateRevision: 7
    });
    expect(plan.autoApplicable).toBe(true);

    const state = {
      categories: [category],
      metadata: { 'old-manga': { title: 'Conserve', coverPath: path.join(oldRoot, 'Manga', 'cover.jpg') } },
      coverProfiles: { 'old-manga': { variants: [{ id: 'local', path: path.join(oldRoot, 'Manga', 'cover.jpg') }] } },
      progress: { 'old-chapter': { mangaId: 'old-manga', chapterId: 'old-chapter', pageIndex: 12 } },
      chapterReadStatus: { 'old-chapter': true },
      favorites: { 'old-manga': true },
      vault: { privateMangaIds: ['old-manga'] },
      readerPrefs: { visual: { byManga: { 'old-manga': { fit: 'width' } } }, guidedView: { panelMaps: { 'old-chapter': { panels: [] } } } },
      collections: { c: { mangaIds: ['old-manga'] } },
      workGroups: {},
      session: { workspaces: [{ tabs: [{ stack: [{ screen: 'reader', mangaId: 'old-manga', chapterId: 'old-chapter' }] }] }], scrollPositions: {} }
    };
    const journal = applyCategoryRelocation(state, plan, new Date('2026-08-29T12:00:00.000Z'));
    expect(state.categories[0]).toMatchObject({ id: 'category-stable', path: newRoot, availability: 'available' });
    expect(state.metadata['new-manga']).toMatchObject({ title: 'Conserve', coverPath: path.join(newRoot, 'Manga', 'cover.jpg') });
    expect(state.coverProfiles['new-manga'].variants[0].path).toBe(path.join(newRoot, 'Manga', 'cover.jpg'));
    expect(state.progress['new-chapter']).toMatchObject({ mangaId: 'new-manga', chapterId: 'new-chapter', pageIndex: 12 });
    expect(state.vault.privateMangaIds).toEqual(['new-manga']);
    expect(state.readerPrefs.visual.byManga['new-manga']).toEqual({ fit: 'width' });
    expect(state.readerPrefs.guidedView.panelMaps['new-chapter']).toMatchObject({ panels: [], chapterRef: 'new-chapter' });
    expect(journal.undoUntil).toBe('2026-08-29T12:30:00.000Z');

    undoCategoryRelocation(state, journal.id, new Date('2026-08-29T12:10:00.000Z'));
    expect(state.categories[0].path).toBe(oldRoot);
    expect(state.metadata['old-manga'].title).toBe('Conserve');
  });

  it('requires review for partial or ambiguous matches and never rebases a missing cover', () => {
    const previous = makeLibraryCategory('C:\\old', 'old', 'old-chapter');
    previous.mangas.push({ ...previous.mangas[0], id: 'second', contentId: 'second-content' });
    const next = makeLibraryCategory('D:\\new', 'new', 'new-chapter');
    const partial = createCategoryRelocationPlan({ category: { id: 'category-stable', path: 'C:\\old' }, previousCategory: previous, nextCategory: next, targetPath: 'D:\\new' });
    expect(partial.autoApplicable).toBe(false);
    expect(partial.unmatched).toEqual(['second']);
    expect(rebasePath('C:\\old\\missing.jpg', 'C:\\old', 'D:\\new')).toBe('C:\\old\\missing.jpg');
  });

  it('recovers stale empty fingerprints from an exact unique folder structure', () => {
    const previous = {
      id: 'category-stable',
      path: 'C:\\old',
      mangas: [{
        id: 'old-manga',
        name: 'Titre identique',
        contentId: 'stale-empty-manga',
        chapters: [{
          id: 'old-chapter',
          name: 'Chapitre 1',
          contentId: 'stale-empty-chapter',
          pageCount: 0
        }]
      }]
    };
    const next = {
      id: 'category-stable',
      path: 'D:\\new',
      mangas: [{
        id: 'new-manga',
        name: 'Titre identique',
        contentId: 'real-manga-fingerprint',
        chapters: [{
          id: 'new-chapter',
          name: 'Chapitre 1',
          contentId: 'real-chapter-fingerprint',
          pageCount: 42
        }]
      }]
    };
    const plan = createCategoryRelocationPlan({
      category: { id: 'category-stable', path: 'C:\\old' },
      previousCategory: previous,
      nextCategory: next,
      targetPath: 'D:\\new'
    });
    expect(plan.autoApplicable).toBe(true);
    expect(plan.mangaMatches).toEqual([expect.objectContaining({
      fromMangaId: 'old-manga',
      toMangaId: 'new-manga',
      matchMethod: 'structure',
      chapterMatches: [expect.objectContaining({
        fromChapterId: 'old-chapter',
        toChapterId: 'new-chapter',
        matchMethod: 'structure'
      })]
    })]);
  });

  it('matches a unique manga folder even when the stale snapshot had no readable chapters', () => {
    const previous = {
      id: 'category-stable',
      mangas: [{ id: 'old-manga', name: 'Kokori Mag', contentId: 'stale', chapters: [] }]
    };
    const next = {
      id: 'category-stable',
      mangas: [{
        id: 'new-manga',
        name: 'Kokori Mag',
        contentId: 'fresh',
        chapters: [{ id: 'volume-1', name: 'Volume 1', contentId: 'volume-content' }]
      }]
    };
    const plan = createCategoryRelocationPlan({
      category: { id: 'category-stable', path: 'C:\\old' },
      previousCategory: previous,
      nextCategory: next,
      targetPath: 'D:\\new'
    });
    expect(plan.autoApplicable).toBe(true);
    expect(plan.mangaMatches[0]).toMatchObject({
      fromMangaId: 'old-manga',
      toMangaId: 'new-manga',
      matchMethod: 'structure'
    });
  });

  it('never uses structural fallback when the destination label is duplicated', () => {
    const previous = {
      id: 'category-stable',
      mangas: [{ id: 'old-manga', name: 'Doublon', contentId: 'stale', chapters: [] }]
    };
    const next = {
      id: 'category-stable',
      mangas: [
        { id: 'new-a', name: 'Doublon', contentId: 'fresh-a', chapters: [] },
        { id: 'new-b', name: 'Doublon', contentId: 'fresh-b', chapters: [] }
      ]
    };
    const plan = createCategoryRelocationPlan({
      category: { id: 'category-stable', path: 'C:\\old' },
      previousCategory: previous,
      nextCategory: next,
      targetPath: 'D:\\new'
    });
    expect(plan.autoApplicable).toBe(false);
    expect(plan.ambiguous).toEqual([{ fromMangaId: 'old-manga', candidateIds: ['new-a', 'new-b'] }]);
  });

  it('uses an exact unique chapter label to disambiguate colliding fingerprints', () => {
    const previous = {
      id: 'category-stable',
      mangas: [{
        id: 'old-manga',
        name: 'Serie',
        contentId: 'manga-content',
        chapters: [{ id: 'old-chapter', name: 'Chapitre 2', contentId: 'shared-pages' }]
      }]
    };
    const next = {
      id: 'category-stable',
      mangas: [{
        id: 'new-manga',
        name: 'Serie',
        contentId: 'manga-content',
        chapters: [
          { id: 'new-chapter-1', name: 'Chapitre 1', contentId: 'shared-pages' },
          { id: 'new-chapter-2', name: 'Chapitre 2', contentId: 'shared-pages' }
        ]
      }]
    };
    const plan = createCategoryRelocationPlan({
      category: { id: 'category-stable', path: 'C:\\old' },
      previousCategory: previous,
      nextCategory: next,
      targetPath: 'D:\\new'
    });
    expect(plan.autoApplicable).toBe(true);
    expect(plan.mangaMatches[0].chapterMatches[0]).toMatchObject({
      fromChapterId: 'old-chapter',
      toChapterId: 'new-chapter-2'
    });
  });

  it('allows the category move while retaining data for chapters absent from the destination', () => {
    const previous = {
      id: 'category-stable',
      mangas: [{
        id: 'old-manga',
        name: 'Serie',
        contentId: 'stale',
        chapters: [{ id: 'missing-chapter', name: 'Chapitre absent', contentId: 'old-content' }]
      }]
    };
    const next = {
      id: 'category-stable',
      mangas: [{ id: 'new-manga', name: 'Serie', contentId: 'fresh', chapters: [] }]
    };
    const plan = createCategoryRelocationPlan({
      category: { id: 'category-stable', path: 'C:\\old' },
      previousCategory: previous,
      nextCategory: next,
      targetPath: 'D:\\new'
    });
    expect(plan.autoApplicable).toBe(true);
    expect(plan.unmatchedChapters).toEqual(['missing-chapter']);
    expect(plan.chapterCoverageComplete).toBe(false);
  });
});
