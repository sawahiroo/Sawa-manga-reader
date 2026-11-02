import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HORIZON_CARD_METRICS, resolveVirtualGridLayout } from '../src/components/VirtualMangaGrid.js';

describe('Sawa Horizon 5.0.1 layout contracts', () => {
  it.each(['compact', 'comfortable', 'large'])('keeps %s cards inside their virtual rows', (cardSize) => {
    const layout = resolveVirtualGridLayout({
      cardSize,
      itemCount: 500,
      containerWidth: 1920,
      visualVariant: 'horizon'
    });
    expect(layout.rowHeight - layout.cardHeight).toBe(HORIZON_CARD_METRICS[cardSize].gap);
    expect(layout.cardHeight).toBeGreaterThan(layout.coverHeight + layout.footerHeight);
    expect(layout.columnWidth * layout.columns + layout.gap * (layout.columns - 1)).toBeCloseTo(1920 - 48, 5);
  });

  it('uses the 216/64/0 sidebar width contract and compact tab rail', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/horizon.css'), 'utf8');
    expect(css).toContain('--titlebar-height: 32px');
    expect(css).toContain('--sidebar-width: 216px');
    expect(css).toContain('--sidebar-collapsed-width: 72px');
    expect(css).toMatch(/layout-shell-reader-focus[^}]*grid-template-columns:\s*0\s+minmax\(0,\s*1fr\)/);
  });

  it('keeps every direct reader action and every advanced control in Horizon', () => {
    const reader = fs.readFileSync(path.join(process.cwd(), 'src/components/ReaderView.jsx'), 'utf8');
    for (const id of ['exit', 'bookmark', 'notes', 'guided-view', 'settings', 'fullscreen']) {
      expect(reader).toContain(`data-reader-tool="${id}"`);
    }
    for (const label of ['Lecture', 'Ajustement', 'Image', 'Guidage', 'Aide', 'Simple', 'Double', 'Manga JP', 'Webtoon']) {
      expect(reader).toContain(label);
    }
  });
});
