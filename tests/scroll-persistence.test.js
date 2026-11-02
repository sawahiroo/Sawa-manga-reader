import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  makeAnchoredScrollPosition,
  normalizeScrollPosition,
  normalizeScrollPositions,
  resolveAnchoredScrollOffset,
  updateScrollPositionRegistry
} from '../src/utils/scrollPositions.js';

const require = createRequire(import.meta.url);
const {
  normalizePersistedSessionPayload,
  normalizeState
} = require('../electron/services/storage.cjs');

describe('persistent scroll positions', () => {
  it('restores the same manga anchor after a column-count change', () => {
    const mangas = Array.from({ length: 60 }, (_, index) => ({ id: `manga-${index}` }));
    const position = makeAnchoredScrollPosition({
      mangas,
      columns: 5,
      rowHeight: 540,
      scrollTop: 2214,
      layoutKey: 'comfortable:5'
    });
    const restoredOffset = resolveAnchoredScrollOffset({
      position,
      mangas,
      columns: 4,
      rowHeight: 540
    });

    expect(position.anchorId).toBe('manga-20');
    expect(restoredOffset).toBe((5 * 540) + 54);
  });

  it('falls back to a clamped absolute offset when the anchor disappears', () => {
    const position = {
      anchorId: 'removed',
      intraRowOffset: 20,
      fallbackOffset: 880,
      layoutKey: 'large:4',
      updatedAt: 1
    };
    expect(resolveAnchoredScrollOffset({ position, mangas: [{ id: 'other' }], columns: 4, rowHeight: 620 }))
      .toBe(880);
  });

  it('migrates v2 sessions to v4 and retains only the 256 newest positions', () => {
    const v2 = normalizeState({
      categories: [],
      session: {
        version: 2,
        activeWorkspaceId: 'workspace-1',
        workspaces: [{
          id: 'workspace-1',
          name: 'Principal',
          iconKey: 'home',
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', stack: [{ screen: 'library' }] }]
        }]
      }
    });
    expect(v2.session).toMatchObject({ version: 8, scrollPositions: {} });

    let positions = {};
    for (let index = 0; index < 300; index += 1) {
      positions = updateScrollPositionRegistry(positions, `view-${index}`, {
        fallbackOffset: index,
        updatedAt: index
      });
    }
    const normalized = normalizeScrollPositions(positions);
    expect(Object.keys(normalized)).toHaveLength(256);
    expect(normalized['view-0']).toBeUndefined();
    expect(normalized['view-299']?.fallbackOffset).toBe(299);
  });

  it('round-trips v4 workspaces, tabs, stacks, and scroll positions without resetting them', () => {
    const session = {
      version: 4,
      activeWorkspaceId: 'workspace-keep',
      workspaces: [{
        id: 'workspace-keep',
        name: 'Conserve',
        iconKey: 'library',
        activeTabId: 'tab-keep',
        tabs: [{
          id: 'tab-keep',
          pinned: true,
          stack: [
            { screen: 'library' },
            { screen: 'reader', mangaId: 'manga-1', chapterId: 'chapter-2', pageIndex: 7 }
          ]
        }]
      }],
      scrollPositions: {
        library: {
          anchorId: 'manga-42',
          intraRowOffset: 13,
          fallbackOffset: 812,
          layoutKey: 'comfortable:5',
          updatedAt: 42
        }
      }
    };
    const first = normalizeState({ session }).session;
    const second = normalizeState({ session: first }).session;

    expect(second).toEqual(first);
    expect(second).toMatchObject({
      version: 8,
      activeWorkspaceId: 'workspace-keep',
      workspaces: [{
        id: 'workspace-keep',
        activeTabId: 'tab-keep',
        tabs: [{
          id: 'tab-keep',
          pinned: true,
          stack: [
            { screen: 'library' },
            { screen: 'reader', mangaId: 'manga-1', chapterId: 'chapter-2', pageIndex: 7 }
          ]
        }]
      }],
      scrollPositions: {
        library: { anchorId: 'manga-42', fallbackOffset: 812 }
      }
    });
  });

  it('normalizes the exact v4 session IPC payload without dropping tabs or scroll anchors', () => {
    const payload = {
      version: 4,
      activeWorkspaceId: 'workspace-ipc',
      workspaces: [{
        id: 'workspace-ipc',
        name: 'IPC',
        iconKey: 'book',
        activeTabId: 'tab-ipc',
        tabs: [{
          id: 'tab-ipc',
          pinned: true,
          stack: [
            { screen: 'library' },
            { screen: 'reader', mangaId: 'manga-ipc', chapterId: 'chapter-ipc', pageIndex: 5 }
          ]
        }]
      }],
      scrollPositions: {
        'tab-ipc:chapter-ipc': {
          anchorId: 'page-12',
          fallbackOffset: 840,
          intraRowOffset: 12,
          layoutKey: 'grid:compact',
          updatedAt: 99
        }
      }
    };

    expect(normalizePersistedSessionPayload(payload)).toMatchObject({ ...payload, version: 8 });
  });

  it('keeps the anchor when navigation capture only refreshes the fallback offset', () => {
    const previous = normalizeScrollPosition({
      anchorId: 'manga-42',
      intraRowOffset: 17,
      fallbackOffset: 2400,
      layoutKey: 'comfortable:5:540',
      updatedAt: 1
    });
    const registry = updateScrollPositionRegistry({}, 'library', previous);
    const next = updateScrollPositionRegistry(registry, 'library', {
      ...normalizeScrollPosition(registry.library),
      fallbackOffset: 2402,
      updatedAt: 2
    });
    expect(next.library.anchorId).toBe('manga-42');
    expect(next.library.intraRowOffset).toBe(17);
    expect(next.library.fallbackOffset).toBe(2402);
  });

  it('uses auxclick and passes the active scroll key to Sawa and Kavita grids', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src/App.jsx'), 'utf8');
    const card = fs.readFileSync(path.join(process.cwd(), 'src/components/MangaCard.jsx'), 'utf8');
    const kavita = fs.readFileSync(path.join(process.cwd(), 'src/interfaces/kavita/KavitaLibraryView.jsx'), 'utf8');

    expect(card).toContain('onAuxClick={handleAuxClick}');
    expect(card).not.toContain('onMouseUp={handleMiddleUp}');
    expect(kavita).toContain('onAuxClick');
    expect(app).toMatch(/<LibraryView[\s\S]{0,500}scrollKey=\{activeScrollKey\}/);
    expect(app).toContain('version: 8');
    expect(app).toContain('[2, 3, 4, 5, 6, 7, 8].includes');
    expect(app).toContain('scrollPositions: normalizeScrollPositions');
  });
});
