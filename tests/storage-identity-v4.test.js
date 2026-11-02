import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeState } = require('../electron/services/storage.cjs');

describe('storage v4 identity migration', () => {
  it('adds empty identity registries to a v3 state', () => {
    const migrated = normalizeState({
      version: 3,
      stateVersion: 3,
      session: { version: 3, tabs: [], scrollPositions: {} }
    });
    expect(migrated).toMatchObject({
      version: 7,
      stateVersion: 7,
      identityRecords: {},
      identitySuggestions: [],
      identityMediaIssues: [],
      workGroups: {}
    });
  });

  it('normalizes work groups and drops malformed identity data', () => {
    const migrated = normalizeState({
      identityRecords: {
        manga: { mangaId: 'manga', chapterFingerprints: ['a', 'a'], private: 1 },
        broken: null
      },
      identitySuggestions: [
        { id: 's', fromMangaId: 'a', toMangaId: 'b', score: 4, reasons: ['titre', 'titre'] },
        { id: 'invalid', fromMangaId: 'a', toMangaId: 'a' }
      ],
      identityMediaIssues: [
        { mangaId: 'manga', chapterId: 'chapter', failedPath: 'C:\\bad.jpg', reason: 'page-unreadable' },
        { failedPath: 'C:\\orphan.jpg' }
      ],
      workGroups: {
        valid: { editionIds: ['a', 'b', 'a'], preferredEditionId: 'missing', tagIds: ['t', 't'] },
        invalid: { editionIds: ['a'] }
      }
    });
    expect(migrated.identityRecords).toEqual({
      manga: expect.objectContaining({ mangaId: 'manga', chapterFingerprints: ['a'], private: true })
    });
    expect(migrated.identitySuggestions).toEqual([
      expect.objectContaining({ id: 's', score: 1, reasons: ['titre'] })
    ]);
    expect(migrated.identityMediaIssues).toEqual([
      expect.objectContaining({
        type: 'identity-media-unreadable',
        mangaId: 'manga',
        chapterId: 'chapter',
        failedPath: 'C:\\bad.jpg',
        reason: 'page-unreadable'
      })
    ]);
    expect(migrated.workGroups).toEqual({
      valid: expect.objectContaining({
        id: 'valid',
        editionIds: ['a', 'b'],
        preferredEditionId: 'a',
        tagIds: ['t']
      })
    });
  });

  it('whitelists legacy deletion tombstones and removes expired entries', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    const migrated = normalizeState({
      deletionTombstones: {
        keep: {
          mangaId: 'keep',
          path: 'C:\\Mangas\\Keep',
          deletedAt: new Date().toISOString(),
          expiresAt: future,
          identityRecord: {
            strongFingerprint: fingerprint,
            title: 'Private title',
            externalIds: ['secret']
          },
          metadata: { title: 'Private title' },
          annotations: [{ body: 'secret note' }],
          mangaTags: ['private-tag'],
          progress: { chapter: { pageIndex: 7 } },
          readingState: { chapterId: 'chapter', pageIndex: 7 }
        },
        expired: {
          mangaId: 'expired',
          path: 'C:\\Mangas\\Expired',
          expiresAt: past,
          identityRecord: { strongFingerprint: fingerprint },
          progress: { chapter: { pageIndex: 2 } }
        }
      }
    });

    expect(migrated.deletionTombstones.expired).toBeUndefined();
    expect(migrated.deletionTombstones.keep).toEqual({
      mangaId: 'keep',
      path: 'C:\\Mangas\\Keep',
      deletedAt: expect.any(String),
      expiresAt: future,
      identity: { strongFingerprint: fingerprint },
      reading: {
        progress: { chapter: { pageIndex: 7 } },
        readingState: { chapterId: 'chapter', pageIndex: 7 }
      }
    });
    expect(JSON.stringify(migrated.deletionTombstones.keep)).not.toMatch(/Private title|secret|private-tag/);
  });
});
