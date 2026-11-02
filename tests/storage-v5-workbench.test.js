import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeState } = require('../electron/services/storage.cjs');

describe('storage v5 workbench migration', () => {
  it('migrates the v4 queue in order and marks interrupted analysis for resumption', () => {
    const migrated = normalizeState({
      version: 4,
      stateVersion: 4,
      session: { version: 4 },
      metadataWorkbenchQueue: ['second', 'first', 'third'],
      metadataWorkbenchItems: [
        {
          mangaId: 'first',
          order: 1,
          status: 'analyzing',
          jobId: 'old-job',
          candidate: {
            identity: 'source:42',
            source: 'source',
            sourceId: '42',
            title: 'Candidate',
            synopsis: 'Resume conserve',
            altTitles: ['Alias'],
            mangaDexId: 'dex-42',
            coverPreviewUrl: 'https://fixture/cover.jpg'
          }
        },
        { mangaId: 'second', order: 0, status: 'review', confidence: 0.72 }
      ]
    });

    expect(migrated).toMatchObject({ version: 7, stateVersion: 7, session: { version: 8 } });
    expect(migrated.metadataWorkbenchItems.map((item) => item.mangaId)).toEqual(['second', 'first', 'third']);
    expect(migrated.metadataWorkbenchItems.find((item) => item.mangaId === 'first')).toMatchObject({
      status: 'interrupted',
      jobId: 'old-job',
      candidate: {
        synopsis: 'Resume conserve',
        altTitles: ['Alias'],
        mangaDexId: 'dex-42',
        coverPreviewUrl: 'https://fixture/cover.jpg'
      }
    });
    expect(migrated.metadataWorkbenchItems.find((item) => item.mangaId === 'third').status).toBe('pending');
  });

  it('keeps explicit provider choices while adult mirrors remain opt-in by default', () => {
    const defaults = normalizeState({ version: 4, stateVersion: 4 });
    expect(defaults.ui.metadataProviders).toMatchObject({
      enabled: { mangadex: true, anilist: true, nhentai: true, imhentai: false, hentaiera: false },
      preferredAdultMirror: 'imhentai',
      allowAdultHtmlFallback: false
    });

    const configured = normalizeState({
      ui: {
        metadataProviders: {
          enabled: { imhentai: true, hentaiera: true },
          preferredAdultMirror: 'hentaiera',
          allowAdultHtmlFallback: true
        }
      }
    });
    expect(configured.ui.metadataProviders).toMatchObject({
      enabled: { imhentai: true, hentaiera: true },
      preferredAdultMirror: 'hentaiera',
      allowAdultHtmlFallback: true
    });
  });

  it('persists the manual keep-local decision used to resume a review session', () => {
    const reviewedAt = '2026-08-09T12:00:00.000Z';
    const state = normalizeState({
      metadataWorkbenchItems: [{
        mangaId: 'local-choice',
        status: 'done',
        decision: 'keep-local',
        reviewedAt
      }]
    });
    expect(state.metadataWorkbenchItems[0]).toMatchObject({
      mangaId: 'local-choice',
      status: 'done',
      decision: 'keep-local',
      reviewedAt
    });
  });
});
