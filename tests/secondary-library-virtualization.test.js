import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkMangas, resolveVirtualGridLayout, resolveVirtualGridMetrics } from '../src/components/VirtualMangaGrid.js';

describe('secondary manga grids', () => {
  it('chunks large collections into virtual rows', () => {
    const mangas = Array.from({ length: 105 }, (_, id) => ({ id }));
    const rows = chunkMangas(mangas, 5);
    expect(rows).toHaveLength(21);
    expect(rows[20]).toHaveLength(5);
  });

  it('uses the shared virtual grid in Sawa collections and vault', () => {
    const collections = fs.readFileSync(path.join(process.cwd(), 'src/components/CollectionsView.jsx'), 'utf8');
    const vault = fs.readFileSync(path.join(process.cwd(), 'src/components/VaultView.jsx'), 'utf8');
    expect(collections).toContain('<VirtualMangaGrid');
    expect(vault).toContain('<VirtualMangaGrid');
    expect(collections).not.toMatch(/className="collection-manga-grid"[\s\S]{0,120}\{mangas\.map/);
    expect(vault).not.toMatch(/className="vault-grid"[\s\S]{0,120}\{mangas\.map/);
  });

  it('uses the same card sizes as the main library and sheds work for large vaults', () => {
    expect(resolveVirtualGridMetrics('compact', 20)).toEqual({
      minCard: 180,
      rowHeight: 460,
      performanceMode: false,
      overscan: 1
    });
    expect(resolveVirtualGridMetrics('comfortable', 150)).toEqual({
      minCard: 240,
      rowHeight: 540,
      performanceMode: true,
      overscan: 0
    });
    expect(resolveVirtualGridMetrics('large', 444)).toEqual({
      minCard: 320,
      rowHeight: 620,
      performanceMode: true,
      overscan: 0
    });
  });

  it('includes card gaps and a fixed Horizon footer in the virtual row contract', () => {
    const layout = resolveVirtualGridLayout({
      cardSize: 'comfortable',
      itemCount: 500,
      containerWidth: 1704,
      visualVariant: 'horizon'
    });
    expect(layout.columns).toBe(6);
    expect(layout.gap).toBe(18);
    expect(layout.footerHeight).toBe(118);
    expect(layout.rowHeight).toBe(layout.cardHeight + layout.gap);
    expect(layout.columnWidth * layout.columns + layout.gap * (layout.columns - 1)).toBeCloseTo(1704 - 48, 5);
  });

  it('keeps the vault header in the same virtual scroll flow as its cards', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'src/App.jsx'), 'utf8');
    const grid = fs.readFileSync(path.join(process.cwd(), 'src/components/VirtualMangaGrid.jsx'), 'utf8');
    const vault = fs.readFileSync(path.join(process.cwd(), 'src/components/VaultView.jsx'), 'utf8');

    expect(app).toMatch(/<VaultView[\s\S]*?cardSize=\{ui\.cardSize\}/);
    expect(vault).toContain('header={vaultHeader}');
    expect(vault).toContain('cardSize={cardSize}');
    expect(grid).toContain('header = null');
    expect(grid).toMatch(/virtualRow\.index === 0[\s\S]*?virtual-manga-grid-header/);
    expect(grid).toContain('performanceMode={performanceMode}');
  });
});
