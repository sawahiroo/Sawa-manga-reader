import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  sanitizePrivateMangaReferences,
  sanitizeSessionSearchPrivacy
} = require('../electron/services/privacySanitizer.cjs');

describe('vault-safe persisted payload', () => {
  it('removes private ids from manual/smart appearances and other renderer records', () => {
    const payload = {
      metadata: { private: {}, public: {} },
      favorites: { private: true, public: true },
      coverProfiles: { private: {}, public: {} },
      chapterStates: { 'private-chapter': 'read', 'public-chapter': 'read' },
      progress: { 'private-chapter': {}, 'public-chapter': {} },
      collections: {
        c1: {
          mangaIds: ['private', 'public'],
          appearance: { type: 'mosaic', featuredMangaIds: ['private', 'public'] }
        }
      },
      smartCollections: {
        s1: { appearance: { type: 'banner', featuredMangaIds: ['private', 'public'] } }
      },
      metadataWorkbenchQueue: ['private', 'public'],
      metadataWorkbenchItems: [{ mangaId: 'private', candidate: { title: 'Secret' } }, { mangaId: 'public' }],
      readingQueue: [{ mangaId: 'private' }, { mangaId: 'public' }],
      recents: [{ mangaId: 'private' }, { mangaId: 'public' }],
      session: {
        workspaces: [{
          tabs: [{ stack: [{ screen: 'manga', mangaId: 'private' }, { screen: 'manga', mangaId: 'public' }] }]
        }],
        scrollPositions: {
          'library:private': { anchorId: 'private' },
          'library:public': { anchorId: 'public' }
        }
      }
    };

    sanitizePrivateMangaReferences(payload, new Set(['private']), new Set(['private-chapter']));

    expect(payload.collections.c1.mangaIds).toEqual(['public']);
    expect(payload.collections.c1.appearance.featuredMangaIds).toEqual(['public']);
    expect(payload.smartCollections.s1.appearance.featuredMangaIds).toEqual(['public']);
    expect(payload.metadata).toEqual({ public: {} });
    expect(payload.favorites).toEqual({ public: true });
    expect(payload.coverProfiles).toEqual({ public: {} });
    expect(payload.chapterStates).toEqual({ 'public-chapter': 'read' });
    expect(payload.progress).toEqual({ 'public-chapter': {} });
    expect(payload.metadataWorkbenchQueue).toEqual(['public']);
    expect(payload.metadataWorkbenchItems).toEqual([{ mangaId: 'public' }]);
    expect(payload.readingQueue).toEqual([{ mangaId: 'public' }]);
    expect(payload.recents).toEqual([{ mangaId: 'public' }]);
    expect(payload.session.workspaces[0].tabs[0].stack).toEqual([{ screen: 'manga', mangaId: 'public' }]);
    expect(Object.keys(payload.session.scrollPositions)).toEqual(['library:public']);
    expect(JSON.stringify(payload)).not.toContain('"private"');
  });

  it('purges every legacy search on first unmarked migration and stores the marker', () => {
    const session = {
      version: 4,
      workspaces: [{
        id: 'w',
        tabs: [
          {
            id: 'incognito',
            incognito: true,
            search: 'legacy incognito secret',
            searchState: { query: 'incognito secret', scope: 'all', filters: [{ field: 'tag', value: 'secret' }] },
            stack: [{ screen: 'library' }]
          },
          {
            id: 'private',
            searchState: { query: 'private annotation', scope: 'vault', filters: [] },
            stack: [{ screen: 'manga', mangaId: 'private' }]
          },
          {
            id: 'public',
            searchState: { query: 'public query', scope: 'all', filters: [] },
            stack: [{ screen: 'manga', mangaId: 'public' }]
          }
        ]
      }]
    };
    const sanitized = sanitizeSessionSearchPrivacy(session, {
      vaultLocked: true,
      privateMangaIds: new Set(['private'])
    });
    expect(sanitized.searchPrivacyVersion).toBe(1);
    expect(sanitized.workspaces[0].tabs[0].searchState).toEqual({ query: '', scope: 'current', filters: [] });
    expect(sanitized.workspaces[0].tabs[1].searchState).toEqual({ query: '', scope: 'current', filters: [] });
    expect(sanitized.workspaces[0].tabs[2].searchState).toEqual({ query: '', scope: 'current', filters: [] });
    expect(JSON.stringify(sanitized)).not.toMatch(/incognito secret|private annotation|legacy incognito|public query/);
  });

  it('preserves current public searches but always purges explicit private and incognito tabs', () => {
    const sanitized = sanitizeSessionSearchPrivacy({
      version: 4,
      searchPrivacyVersion: 1,
      workspaces: [{
        id: 'w',
        tabs: [
          {
            id: 'public',
            searchState: { query: 'public query', scope: 'all', filters: [] },
            stack: [{ screen: 'library' }]
          },
          {
            id: 'private',
            searchPrivate: true,
            search: 'legacy private',
            searchState: { query: 'private query', scope: 'all', filters: [] },
            stack: [{ screen: 'library' }]
          },
          {
            id: 'incognito',
            incognito: true,
            searchState: { query: 'incognito query', scope: 'all', filters: [] },
            stack: [{ screen: 'library' }]
          }
        ]
      }]
    }, { vaultLocked: false });

    expect(sanitized.searchPrivacyVersion).toBe(1);
    expect(sanitized.workspaces[0].tabs[0].searchState.query).toBe('public query');
    expect(sanitized.workspaces[0].tabs[1].searchState).toEqual({ query: '', scope: 'current', filters: [] });
    expect(sanitized.workspaces[0].tabs[2].searchState).toEqual({ query: '', scope: 'current', filters: [] });
    expect(JSON.stringify(sanitized)).not.toMatch(/private query|legacy private|incognito query/);
  });
});
