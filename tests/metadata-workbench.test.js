import { describe, expect, it } from 'vitest';
import {
  getWorkbenchPage,
  getWorkbenchSelectionIds,
  rankMetadataCandidates,
  resolveSafeMetadataPatch,
  summarizeWorkbench
} from '../electron/services/metadataWorkbench.cjs';

describe('metadata workbench matching', () => {
  it('auto-validates only an exact title with a corroborating signal and a clear margin', () => {
    const manga = { displayTitle: 'Etoile du matin', author: 'Aoi', pageCount: 42 };
    const result = rankMetadataCandidates(manga, [
      { identity: 'a:1', title: 'Etoile du matin', authors: 'Aoi', pages: 42 },
      { identity: 'a:2', title: 'Etoile du matin extra', authors: 'Autre', pages: 90 }
    ]);
    expect(result).toMatchObject({ status: 'reliable', safelyAutomatic: true });
    expect(result.confidence).toBeGreaterThanOrEqual(0.96);
    expect(result.margin).toBeGreaterThanOrEqual(0.15);
  });

  it('keeps title-only and ambiguous results for manual review', () => {
    const manga = { displayTitle: 'Titre local' };
    expect(rankMetadataCandidates(manga, [{ identity: 'a:1', title: 'Titre local' }])).toMatchObject({
      status: 'review',
      safelyAutomatic: false
    });
    const ambiguous = rankMetadataCandidates(
      { displayTitle: 'Titre local', author: 'Aoi' },
      [
        { identity: 'a:1', title: 'Titre local', authors: 'Aoi' },
        { identity: 'a:2', title: 'Titre local', authors: 'Aoi' }
      ]
    );
    expect(ambiguous).toMatchObject({ status: 'review', safelyAutomatic: false, margin: 0 });
  });

  it('never replaces locked or manual fields', () => {
    const result = resolveSafeMetadataPatch({
      mangaId: 'm1',
      candidate: { title: 'Distant', authors: 'Auteur distant', tags: ['Tag'] },
      metadata: { m1: { onlineTitle: 'Manuel', onlineAuthor: 'Ancien online' } },
      locks: { m1: { onlineAuthor: true } },
      fieldSources: { m1: { onlineTitle: 'manual', onlineAuthor: 'online' } }
    });
    expect(result.patch).not.toHaveProperty('onlineTitle');
    expect(result.patch).not.toHaveProperty('onlineAuthor');
    expect(result.skipped).toMatchObject({ onlineTitle: 'manual', onlineAuthor: 'locked' });
    expect(result.patch.onlineGenres).toEqual(['Tag']);
  });

  it('paginates 500 rows and summarizes statuses without expanding the payload', () => {
    const items = Array.from({ length: 500 }, (_, index) => ({
      mangaId: `m${index}`,
      status: index < 300 ? 'pending' : index < 450 ? 'review' : 'done'
    }));
    const page = getWorkbenchPage(items, { offset: 200, limit: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(500);
    expect(summarizeWorkbench(items)).toMatchObject({ total: 500, pending: 300, review: 150, done: 50 });
  });

  it('groups every manually actionable state in the attention filter', () => {
    const items = [
      { mangaId: 'review', status: 'review' },
      { mangaId: 'none', status: 'no-result' },
      { mangaId: 'error', status: 'error' },
      { mangaId: 'interrupted', status: 'interrupted' },
      { mangaId: 'safe', status: 'reliable' }
    ];
    expect(getWorkbenchSelectionIds(items, { status: 'attention' })).toEqual(['review', 'none', 'error', 'interrupted']);
    expect(getWorkbenchPage(items, { status: 'attention' }).total).toBe(4);
    expect(summarizeWorkbench(items).counts.attention).toBe(4);
  });
});
