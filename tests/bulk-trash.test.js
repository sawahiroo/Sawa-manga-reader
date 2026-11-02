import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import service from '../electron/services/bulkTrash.cjs';

const roots = [];
afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-trash-'));
  roots.push(root);
  const mangas = ['a', 'b', 'c'].map((id) => {
    const mangaPath = path.join(root, id);
    fs.mkdirSync(mangaPath);
    return {
      id,
      path: mangaPath,
      strongFingerprint: `sha256:${id.repeat(64).slice(0, 64)}`,
      chapters: [{ id: `${id}-ch` }]
    };
  });
  return { root, mangas };
}

describe('secure bulk trash', () => {
  it('rejects category roots, outside paths and missing scan ids', async () => {
    const { root, mangas } = fixture();
    await expect(service.validateScannedMangaPath({ mangaPath: root, categoryRoots: [root] }))
      .rejects.toThrow(/racine/);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-outside-'));
    roots.push(outside);
    await expect(service.validateScannedMangaPath({ mangaPath: outside, categoryRoots: [root] }))
      .rejects.toThrow(/hors/);
    const result = await service.bulkTrashMangas({
      mangas,
      requestedIds: ['unknown'],
      categoryRoots: [root],
      trashItem: vi.fn(),
      state: {}
    });
    expect(result.failed[0].error).toMatch(/dernier scan/);
  });

  it('rejects a Windows junction target before it can reach the trash service', async () => {
    const { root } = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-junction-target-'));
    roots.push(outside);
    const junctionPath = path.join(root, 'junction');
    fs.symlinkSync(outside, junctionPath, 'junction');
    const trashItem = vi.fn();

    const result = await service.bulkTrashMangas({
      mangas: [{
        id: 'junction',
        path: junctionPath,
        strongFingerprint: `sha256:${'d'.repeat(64)}`,
        chapters: []
      }],
      requestedIds: ['junction'],
      categoryRoots: [root],
      trashItem,
      state: {}
    });

    expect(result.failed[0].error).toMatch(/jonction|symbolique|reanalyse/i);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('limits trash concurrency to two and retains partial failures', async () => {
    const { root, mangas } = fixture();
    let active = 0;
    let maximum = 0;
    const trashItem = vi.fn(async (target) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      if (target.endsWith(`${path.sep}b`)) throw new Error('Corbeille refusee');
    });
    const progress = [];
    const result = await service.bulkTrashMangas({
      mangas,
      requestedIds: ['a', 'b', 'c'],
      categoryRoots: [root],
      trashItem,
      concurrency: 9,
      onProgress: (entry) => progress.push(entry),
      state: { progress: { 'a-ch': { pageIndex: 4 } } }
    });
    expect(maximum).toBe(2);
    expect(result.succeeded.map((entry) => entry.mangaId)).toEqual(['a', 'c']);
    expect(result.failed.map((entry) => entry.mangaId)).toEqual(['b']);
    expect(progress).toHaveLength(3);
    expect(result.succeeded[0].tombstone.reading.progress['a-ch']).toEqual({ pageIndex: 4 });
  });

  it('aborts when the target identity changes between validation and trash', async () => {
    const { root, mangas } = fixture();
    const targetPath = mangas[0].path;
    let targetLstatCount = 0;
    const fsApi = {
      realpath: (...args) => fs.promises.realpath(...args),
      lstat: async (...args) => {
        const stat = await fs.promises.lstat(...args);
        if (path.resolve(args[0]) !== path.resolve(targetPath)) return stat;
        targetLstatCount += 1;
        if (targetLstatCount !== 2) return stat;
        return {
          dev: Number(stat.dev || 0) + 1,
          ino: stat.ino,
          mode: stat.mode,
          rdev: stat.rdev,
          size: stat.size,
          birthtimeMs: stat.birthtimeMs,
          isDirectory: () => stat.isDirectory(),
          isFile: () => stat.isFile(),
          isSymbolicLink: () => stat.isSymbolicLink()
        };
      }
    };
    const trashItem = vi.fn();

    const result = await service.bulkTrashMangas({
      mangas,
      requestedIds: ['a'],
      categoryRoots: [root],
      fsApi,
      trashItem,
      state: {}
    });

    expect(targetLstatCount).toBe(2);
    expect(result.failed[0].error).toMatch(/change|substitu/i);
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('stops scheduling new folders after cancellation and reports untouched ids', async () => {
    const { root, mangas } = fixture();
    let cancelled = false;
    const result = await service.bulkTrashMangas({
      mangas,
      requestedIds: mangas.map((entry) => entry.id),
      categoryRoots: [root],
      concurrency: 1,
      state: {},
      trashItem: async () => {
        cancelled = true;
      },
      isCancelled: () => cancelled
    });

    expect(result.succeeded.map((entry) => entry.mangaId)).toEqual(['a']);
    expect(result.cancelled.map((entry) => entry.mangaId)).toEqual(['b', 'c']);
    expect(result.results.slice(1).every((entry) => entry.cancelled)).toBe(true);
  });

  it('stores only strong identity and reading state, then restores without overwriting newer values', () => {
    const { mangas } = fixture();
    const state = {
      metadata: { a: { title: 'A' } },
      favorites: { a: true },
      progress: { 'a-ch': { pageIndex: 8 } },
      chapterReadStatus: { 'a-ch': true },
      chapterStates: { 'a-ch': { lastPageIndex: 8 } },
      readStatus: { a: { isRead: false } },
      readingStates: { a: { chapterId: 'a-ch', pageIndex: 8 } },
      annotations: { a: [{ body: 'secret' }] },
      mangaTags: { a: ['private-tag'] },
      identityRecords: {
        a: {
          mangaId: 'a',
          path: mangas[0].path,
          strongFingerprint: mangas[0].strongFingerprint,
          title: 'Secret title',
          externalIds: ['secret-id']
        }
      },
      collections: { c: { id: 'c', mangaIds: ['a'] } },
      recents: [],
      readingQueue: [],
      metadataWorkbenchQueue: ['a'],
      metadataWorkbenchItems: [{ mangaId: 'a', status: 'review' }],
      metadataWorkbenchLastBatch: { entries: [{ mangaId: 'a', previous: {} }] }
    };
    const tombstone = service.createDeletionTombstone(state, mangas[0], 1000);
    expect(Object.keys(tombstone).sort()).toEqual([
      'deletedAt',
      'expiresAt',
      'identity',
      'mangaId',
      'path',
      'reading'
    ]);
    expect(JSON.stringify(tombstone)).not.toMatch(/Secret title|secret-id|secret|private-tag|metadata|annotations|mangaTags/);
    service.removeDeletedMangaState(state, mangas[0], tombstone);
    expect(state.metadata.a).toBeUndefined();
    expect(state.deletionTombstones.a).toBeTruthy();
    expect(state.metadataWorkbenchQueue).toEqual([]);
    expect(state.metadataWorkbenchItems).toEqual([]);
    expect(state.metadataWorkbenchLastBatch).toBeNull();

    state.progress['a-ch'] = { pageIndex: 11 };
    state.readingStates.a = { chapterId: 'a-ch', pageIndex: 11 };
    expect(service.restoreReturnedTombstones(state, [mangas[0]], 2000)).toEqual(['a']);
    expect(state.metadata.a).toBeUndefined();
    expect(state.progress['a-ch']).toEqual({ pageIndex: 11 });
    expect(state.readingStates.a).toEqual({ chapterId: 'a-ch', pageIndex: 11 });
    expect(state.chapterReadStatus['a-ch']).toBe(true);
    expect(state.collections.c.mangaIds).not.toContain('a');
  });

  it('does not restore a different manga returned at the same path and purges after 30 days', () => {
    const { mangas } = fixture();
    const state = {
      progress: { 'a-ch': { pageIndex: 8 } },
      identityRecords: {
        a: { strongFingerprint: mangas[0].strongFingerprint }
      }
    };
    const tombstone = service.createDeletionTombstone(state, mangas[0], 1000);
    service.removeDeletedMangaState(state, mangas[0], tombstone);
    const replacement = {
      ...mangas[0],
      id: 'replacement',
      strongFingerprint: `sha256:${'f'.repeat(64)}`
    };

    expect(service.restoreReturnedTombstones(state, [replacement], 2000)).toEqual([]);
    expect(state.progress['a-ch']).toBeUndefined();
    expect(state.deletionTombstones.a).toBeTruthy();

    const afterExpiry = 1000 + service.TOMBSTONE_TTL_MS + 1;
    expect(service.restoreReturnedTombstones(state, [replacement], afterExpiry)).toEqual([]);
    expect(state.deletionTombstones.a).toBeUndefined();
  });
});
