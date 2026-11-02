import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  analyzeIdentityRecords,
  buildIdentityRecord,
  classifyIdentityPair,
  createWorkGroup,
  buildEditionSuggestions,
  projectCanonicalWorks,
  remapPersistedReferences,
  remapSourceLinks,
  setPreferredEdition,
  stripPrivateIdentityState,
  ungroupWork
} = require('../electron/services/identityWorks.cjs');

function manga(id, title, chapterIds, extra = {}) {
  return {
    id,
    displayTitle: title,
    author: 'Auteur',
    chapters: chapterIds.map((contentId, index) => ({
      id: `${id}-chapter-${index}`,
      contentId,
      strongFingerprint: `sha256:${contentId}`,
      pageCount: 20
    })),
    ...extra
  };
}

describe('identity fingerprints', () => {
  it('classifies exact, probable and vault-blocked matches', () => {
    const exactA = buildIdentityRecord(manga('old', 'Titre', ['a', 'b', 'c']));
    const exactB = buildIdentityRecord(manga('new', 'Titre renomme', ['a', 'b', 'c']));
    expect(classifyIdentityPair(exactA, exactB).kind).toBe('exact');

    const probable = buildIdentityRecord(manga('partial', 'Titre', ['a', 'b', 'c', 'd']));
    const moved = buildIdentityRecord(manga('moved', 'Titre', ['a', 'b', 'c', 'e']));
    expect(classifyIdentityPair(probable, moved)).toMatchObject({ kind: 'probable', overlap: 0.75 });

    const privateRecord = { ...moved, private: true };
    expect(classifyIdentityPair(probable, privateRecord).kind).toBe('blocked-vault');
  });

  it('restores a unique exact move, suggests a probable move and refuses ambiguity', () => {
    const oldExact = buildIdentityRecord(manga('old-exact', 'Exact', ['a', 'b']));
    const oldProbable = buildIdentityRecord(manga('old-probable', 'Probable', ['p1', 'p2', 'p3', 'p4']));
    const oldAmbiguous = buildIdentityRecord(manga('old-ambiguous', 'Ambigu', ['x1', 'x2', 'x3', 'x4']));
    const current = [
      buildIdentityRecord(manga('new-exact', 'Exact déplacé', ['a', 'b'])),
      buildIdentityRecord(manga('new-probable', 'Probable', ['p1', 'p2', 'p3', 'p5'])),
      buildIdentityRecord(manga('new-ambiguous-a', 'Ambigu', ['x1', 'x2', 'x3', 'y1'])),
      buildIdentityRecord(manga('new-ambiguous-b', 'Ambigu', ['x1', 'x2', 'x3', 'y2']))
    ];
    const result = analyzeIdentityRecords(
      Object.fromEntries([oldExact, oldProbable, oldAmbiguous].map((record) => [record.mangaId, record])),
      Object.fromEntries(current.map((record) => [record.mangaId, record]))
    );
    expect(result.exactMoves).toEqual([expect.objectContaining({ fromMangaId: 'old-exact', toMangaId: 'new-exact' })]);
    expect(result.suggestions).toEqual([expect.objectContaining({ fromMangaId: 'old-probable', toMangaId: 'new-probable' })]);
    expect(result.ambiguous).toEqual([expect.objectContaining({ previousId: 'old-ambiguous' })]);
  });
});

describe('identity reference migration', () => {
  it('rewrites organization, reading, vault, queue, annotations, session stacks, scrolls and source links', () => {
    const state = {
      metadata: { old: { title: 'Titre' } },
      metadataLocks: { old: { title: true } },
      metadataFieldSource: { old: { title: 'local' } },
      favorites: { old: true },
      mangaTags: { old: ['tag'] },
      mangaTagMeta: { old: { tag: { source: 'manual' } } },
      annotations: { old: [{ mangaId: 'old', chapterId: 'old-chapter' }] },
      readingStates: { old: 'in-progress' },
      readStatus: { old: true },
      knownChapterCounts: { old: 2 },
      readerPrefs: { old: { fit: 'width' } },
      identityRecords: { old: { mangaId: 'old' } },
      progress: { 'old-chapter': { mangaId: 'old', chapterId: 'old-chapter', pageIndex: 4 } },
      chapterStates: { 'old-chapter': 'in-progress' },
      chapterReadStatus: { 'old-chapter': true },
      recents: [{ mangaId: 'old', chapterId: 'old-chapter' }],
      readingQueue: [{ mangaId: 'old', chapterId: 'old-chapter' }],
      metadataWorkbenchQueue: ['old'],
      metadataWorkbenchItems: [{ mangaId: 'old', status: 'review' }],
      metadataWorkbenchLastBatch: { entries: [{ mangaId: 'old', previous: {} }] },
      vault: { privateMangaIds: ['old'] },
      collections: { c: { mangaIds: ['old'] } },
      workGroups: { w: { editionIds: ['old', 'other'], preferredEditionId: 'old' } },
      identityAliases: {},
      session: {
        workspaces: [{
          tabs: [{ stack: [{ screen: 'manga', mangaId: 'old' }, { screen: 'reader', mangaId: 'old', chapterId: 'old-chapter' }] }]
        }],
        scrollPositions: {
          'tab:old:old-chapter': { anchorId: 'old', fallbackOffset: 100 }
        }
      }
    };
    remapPersistedReferences(
      state,
      [{ fromMangaId: 'old', toMangaId: 'new' }],
      [{ fromChapterId: 'old-chapter', toChapterId: 'new-chapter' }]
    );
    expect(state.metadata.new.title).toBe('Titre');
    expect(state.annotations.new[0]).toMatchObject({ mangaId: 'new', chapterId: 'new-chapter' });
    expect(state.progress['new-chapter']).toMatchObject({ mangaId: 'new', chapterId: 'new-chapter' });
    expect(state.vault.privateMangaIds).toEqual(['new']);
    expect(state.collections.c.mangaIds).toEqual(['new']);
    expect(state.metadataWorkbenchItems[0].mangaId).toBe('new');
    expect(state.metadataWorkbenchLastBatch.entries[0].mangaId).toBe('new');
    expect(state.workGroups.w).toMatchObject({ editionIds: ['new', 'other'], preferredEditionId: 'new' });
    expect(state.session.workspaces[0].tabs[0].stack[1]).toMatchObject({ mangaId: 'new', chapterId: 'new-chapter' });
    expect(state.session.scrollPositions['tab:new:new-chapter'].anchorId).toBe('new');
    expect(state.identityAliases.old).toBe('new');
    expect(remapSourceLinks([{ localMangaId: 'old' }], [{ fromMangaId: 'old', toMangaId: 'new' }])[0].localMangaId).toBe('new');
  });

  it('merges existing target records deterministically without losing source data', () => {
    const state = {
      metadata: {
        old: { title: 'Titre source', author: 'Auteur source', updatedAt: '2026-01-01T00:00:00.000Z' },
        new: { title: '', description: 'Description cible', updatedAt: '2026-02-01T00:00:00.000Z' }
      },
      mangaTags: { old: ['source-tag'], new: ['target-tag'] },
      annotations: {
        old: [{ id: 'source-note', mangaId: 'old', text: 'Source', updatedAt: '2026-01-01T00:00:00.000Z' }],
        new: [{ id: 'target-note', mangaId: 'new', text: 'Cible', updatedAt: '2026-02-01T00:00:00.000Z' }]
      },
      progress: {
        'old-chapter': { mangaId: 'old', chapterId: 'old-chapter', pageIndex: 8, updatedAt: '2026-02-01T00:00:00.000Z' },
        'new-chapter': { mangaId: 'new', chapterId: 'new-chapter', pageIndex: 3, updatedAt: '2026-01-01T00:00:00.000Z' }
      },
      collections: {},
      workGroups: {},
      vault: {},
      session: {}
    };
    remapPersistedReferences(
      state,
      [{ fromMangaId: 'old', toMangaId: 'new' }],
      [{ fromChapterId: 'old-chapter', toChapterId: 'new-chapter' }]
    );
    expect(state.metadata).not.toHaveProperty('old');
    expect(state.metadata.new).toMatchObject({
      title: 'Titre source',
      author: 'Auteur source',
      description: 'Description cible'
    });
    expect(state.mangaTags.new).toEqual(expect.arrayContaining(['source-tag', 'target-tag']));
    expect(state.annotations.new.map((annotation) => annotation.id)).toEqual(
      expect.arrayContaining(['source-note', 'target-note'])
    );
    expect(state.annotations.new.find((annotation) => annotation.id === 'source-note').mangaId).toBe('new');
    expect(state.progress).not.toHaveProperty('old-chapter');
    expect(state.progress['new-chapter']).toMatchObject({
      mangaId: 'new',
      chapterId: 'new-chapter',
      pageIndex: 8
    });
  });
});

describe('identity privacy', () => {
  it('removes every private record, alias, suggestion and work group from client state', () => {
    const clientState = {
      identityRecords: {
        public: { mangaId: 'public', title: 'Public', private: false },
        private: {
          mangaId: 'private',
          title: 'Secret',
          path: 'C:\\secret',
          strongFingerprint: 'sha256:secret',
          private: true
        },
        categoryPrivate: { mangaId: 'categoryPrivate', title: 'Catégorie secrète', private: false }
      },
      identityAliases: {
        oldPrivate: 'private',
        private: 'public',
        oldPublic: 'public'
      },
      identitySuggestions: [
        { id: 'public-suggestion', fromMangaId: 'public', toMangaId: 'other' },
        { id: 'private-suggestion', fromMangaId: 'private', toMangaId: 'public' },
        { id: 'category-suggestion', fromMangaId: 'public', toMangaId: 'categoryPrivate' }
      ],
      identityMediaIssues: [
        { mangaId: 'public', failedPath: 'C:\\public\\bad.jpg' },
        { mangaId: 'private', failedPath: 'C:\\secret\\bad.jpg' },
        { mangaId: 'categoryPrivate', failedPath: 'C:\\category-secret\\bad.jpg' }
      ],
      workGroups: {
        public: { editionIds: ['public', 'other'] },
        private: { editionIds: ['public', 'private'] },
        categoryPrivate: { editionIds: ['categoryPrivate', 'other'] },
        flagged: { private: true, editionIds: ['public'] }
      }
    };
    stripPrivateIdentityState(clientState, new Set(['categoryPrivate']));
    expect(clientState.identityRecords).toEqual({
      public: { mangaId: 'public', title: 'Public', private: false }
    });
    expect(clientState.identityAliases).toEqual({ oldPublic: 'public' });
    expect(clientState.identitySuggestions).toEqual([
      { id: 'public-suggestion', fromMangaId: 'public', toMangaId: 'other' }
    ]);
    expect(clientState.identityMediaIssues).toEqual([
      { mangaId: 'public', failedPath: 'C:\\public\\bad.jpg' }
    ]);
    expect(clientState.workGroups).toEqual({
      public: { editionIds: ['public', 'other'] }
    });
    expect(JSON.stringify(clientState)).not.toContain('Secret');
    expect(JSON.stringify(clientState)).not.toContain('C:\\\\secret');
    expect(JSON.stringify(clientState)).not.toContain('sha256:secret');
  });
});

describe('canonical works', () => {
  it('suggests metadata-coherent editions without auto-grouping them', () => {
    const records = {
      a: buildIdentityRecord(manga('a', 'Même titre', ['a'], { author: 'Même auteur' })),
      b: buildIdentityRecord(manga('b', 'Même titre', ['b'], { author: 'Même auteur' }))
    };
    expect(buildEditionSuggestions(records, {})).toEqual([
      expect.objectContaining({ kind: 'edition', status: 'pending', score: 0.72 })
    ]);
  });

  it('groups editions, defaults to the most recently read and projects one card', () => {
    const editions = [
      manga('edition-a', 'Edition A', ['a'], { lastReadAt: '2025-01-01T00:00:00.000Z' }),
      manga('edition-b', 'Edition B', ['b'], { lastReadAt: '2026-01-01T00:00:00.000Z' })
    ];
    const state = {
      workGroups: {},
      favorites: { 'edition-a': true },
      mangaTags: { 'edition-b': ['tag-b'] },
      collections: { c: { mangaIds: ['edition-a'] } }
    };
    const group = createWorkGroup(state, ['edition-a', 'edition-b'], editions);
    expect(group.preferredEditionId).toBe('edition-b');
    expect(group).toMatchObject({ favorite: true, tagIds: ['tag-b'], collectionIds: ['c'] });
    expect(projectCanonicalWorks(editions, state.workGroups)).toEqual([
      expect.objectContaining({ id: 'edition-b', workGroup: expect.objectContaining({ editionCount: 2 }) })
    ]);
    expect(setPreferredEdition(state, group.id, 'edition-a')).toBe(true);
    expect(state.workGroups[group.id].preferredEditionId).toBe('edition-a');
  });

  it('refuses public-vault mixing and copies common organization when ungrouping', () => {
    const editions = [
      manga('public', 'Public', ['a']),
      manga('private', 'Privé', ['b'], { isPrivate: true })
    ];
    expect(() => createWorkGroup({ workGroups: {}, favorites: {}, mangaTags: {}, collections: {} }, ['public', 'private'], editions))
      .toThrow(/coffre/i);

    const state = {
      workGroups: {},
      favorites: {},
      mangaTags: {},
      collections: { c: { mangaIds: ['a'] } }
    };
    const samePrivacy = [manga('a', 'A', ['a']), manga('b', 'B', ['b'])];
    const group = createWorkGroup(state, ['a', 'b'], samePrivacy);
    group.favorite = true;
    group.tagIds = ['shared'];
    group.collectionIds = ['c'];
    ungroupWork(state, group.id);
    expect(state.favorites).toMatchObject({ a: true, b: true });
    expect(state.mangaTags).toMatchObject({ a: ['shared'], b: ['shared'] });
    expect(state.collections.c.mangaIds).toEqual(['a', 'b']);
  });
});
