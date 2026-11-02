import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  cleanupStagedBackup,
  exportBackupPackage,
  getCoverTransactionJournalPath,
  recoverManagedCoverTransaction,
  replaceManagedCovers,
  stageBackupImport
} = require('../electron/services/backupPackage.cjs');
const {
  normalizeState,
  rollbackBackupImport,
  STATE_VERSION,
  STORAGE_VERSION
} = require('../electron/services/storage.cjs');
const yazl = require('yazl');
const tempDirs = [];

afterEach(() => {
  tempDirs.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

describe('Sawa backup packages', () => {
  it('exports and validates a checksummed package with managed covers', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-backup-'));
    tempDirs.push(root);
    const covers = path.join(root, 'covers');
    fs.mkdirSync(covers);
    fs.writeFileSync(path.join(covers, 'cover.jpg'), Buffer.from('managed-cover'));
    const targetPath = path.join(root, 'export.sawa-backup');
    const state = { version: 4, stateVersion: 4, favorites: { one: true } };

    const exported = await exportBackupPackage({
      targetPath,
      state,
      managedCoverDir: covers,
      storageVersion: 4,
      stateVersion: 4
    });
    const staged = await stageBackupImport(targetPath);
    try {
      expect(exported).toMatchObject({ ok: true, exported: true, path: targetPath });
      expect(staged).toMatchObject({ ok: true, legacy: false, state });
      expect(staged.manifest.checksums).toHaveProperty('state.json');
      expect(staged.manifest.checksums).toHaveProperty('covers/cover.jpg');
      expect(fs.readFileSync(path.join(staged.stagedCoverDir, 'cover.jpg'), 'utf8')).toBe('managed-cover');
    } finally {
      cleanupStagedBackup(staged);
    }
  });

  it('imports both wrapped and direct legacy JSON states', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-backup-legacy-'));
    tempDirs.push(root);
    const wrappedPath = path.join(root, 'wrapped.json');
    const directPath = path.join(root, 'direct.sawa');
    fs.writeFileSync(wrappedPath, JSON.stringify({
      manifest: { format: 'legacy' },
      state: { version: 3, favorites: { wrapped: true } }
    }));
    fs.writeFileSync(directPath, JSON.stringify({ version: 3, favorites: { direct: true } }));

    await expect(stageBackupImport(wrappedPath)).resolves.toMatchObject({
      legacy: true,
      state: { favorites: { wrapped: true } }
    });
    await expect(stageBackupImport(directPath)).resolves.toMatchObject({
      legacy: true,
      state: { favorites: { direct: true } }
    });
  });

  it('rejects a corrupted package before import', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-backup-corrupt-'));
    tempDirs.push(root);
    const targetPath = path.join(root, 'export.sawa-backup');
    await exportBackupPackage({ targetPath, state: { version: 4 } });
    const buffer = fs.readFileSync(targetPath);
    buffer[Math.floor(buffer.length / 2)] ^= 0xff;
    fs.writeFileSync(targetPath, buffer);

    await expect(stageBackupImport(targetPath)).rejects.toThrow();
  });

  it('rejects an undeclared managed cover even when the state checksum is valid', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-backup-undeclared-'));
    tempDirs.push(root);
    const targetPath = path.join(root, 'malicious.sawa-backup');
    const stateBuffer = Buffer.from(JSON.stringify({ version: 4 }), 'utf8');
    const manifest = {
      format: 'sawa-backup',
      packageVersion: 1,
      checksums: {
        'state.json': crypto.createHash('sha256').update(stateBuffer).digest('hex')
      }
    };
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
    zip.addBuffer(stateBuffer, 'state.json');
    zip.addBuffer(Buffer.from('not-declared'), 'covers/injected.jpg');
    const finished = new Promise((resolve, reject) => {
      zip.outputStream
        .pipe(fs.createWriteStream(targetPath))
        .once('close', resolve)
        .once('error', reject);
    });
    zip.end();
    await finished;

    await expect(stageBackupImport(targetPath)).rejects.toThrow(/non declaree/i);
  });

  it('treats a package without covers as an explicit empty managed-cover snapshot', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-backup-empty-covers-'));
    tempDirs.push(root);
    const targetPath = path.join(root, 'export.sawa-backup');
    const managedCoverDir = path.join(root, 'managed-covers');
    fs.mkdirSync(managedCoverDir);
    fs.writeFileSync(path.join(managedCoverDir, 'obsolete.jpg'), 'obsolete');
    await exportBackupPackage({ targetPath, state: { version: 4 } });

    const staged = await stageBackupImport(targetPath);
    try {
      expect(staged.legacy).toBe(false);
      expect(fs.existsSync(staged.stagedCoverDir)).toBe(true);
      expect(fs.readdirSync(staged.stagedCoverDir)).toEqual([]);
      const transaction = replaceManagedCovers(staged.stagedCoverDir, managedCoverDir);
      expect(fs.readdirSync(managedCoverDir)).toEqual([]);
      transaction.commit();
      expect(fs.existsSync(transaction.rollbackDir)).toBe(false);
    } finally {
      cleanupStagedBackup(staged);
    }
  });

  it('recovers a partially copied managed-cover tree from its durable journal', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-cover-recovery-'));
    tempDirs.push(root);
    const managedCoverDir = path.join(root, 'managed-covers');
    const rollbackDir = path.join(root, 'managed-covers.rollback-test');
    fs.mkdirSync(managedCoverDir);
    fs.mkdirSync(rollbackDir);
    fs.writeFileSync(path.join(managedCoverDir, 'partial.jpg'), 'partial-copy');
    fs.writeFileSync(path.join(rollbackDir, 'original.jpg'), 'original');
    fs.writeFileSync(getCoverTransactionJournalPath(managedCoverDir), JSON.stringify({
      version: 1,
      phase: 'prepared',
      managedCoverDir,
      rollbackDir,
      movedCurrent: true
    }));

    expect(recoverManagedCoverTransaction(managedCoverDir)).toMatchObject({
      recovered: true,
      committed: false
    });
    expect(fs.readdirSync(managedCoverDir)).toEqual(['original.jpg']);
    expect(fs.readFileSync(path.join(managedCoverDir, 'original.jpg'), 'utf8')).toBe('original');
    expect(fs.existsSync(rollbackDir)).toBe(false);
    expect(fs.existsSync(getCoverTransactionJournalPath(managedCoverDir))).toBe(false);
  });

  it('never removes the original cover tree when recovery sees prepared before rename', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-cover-before-rename-'));
    tempDirs.push(root);
    const managedCoverDir = path.join(root, 'managed-covers');
    const rollbackDir = `${managedCoverDir}.rollback-not-created`;
    fs.mkdirSync(managedCoverDir);
    fs.writeFileSync(path.join(managedCoverDir, 'original.jpg'), 'original');
    fs.writeFileSync(getCoverTransactionJournalPath(managedCoverDir), JSON.stringify({
      version: 1,
      phase: 'prepared',
      managedCoverDir,
      rollbackDir,
      movedCurrent: true
    }));

    expect(recoverManagedCoverTransaction(managedCoverDir)).toMatchObject({
      recovered: true,
      swapStarted: false
    });
    expect(fs.readFileSync(path.join(managedCoverDir, 'original.jpg'), 'utf8')).toBe('original');
  });

  it('restores the original tree when recovery sees the post-rename swapped phase', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-cover-after-rename-'));
    tempDirs.push(root);
    const managedCoverDir = path.join(root, 'managed-covers');
    const rollbackDir = `${managedCoverDir}.rollback-created`;
    fs.mkdirSync(rollbackDir);
    fs.writeFileSync(path.join(rollbackDir, 'original.jpg'), 'original');
    fs.mkdirSync(managedCoverDir);
    fs.writeFileSync(path.join(managedCoverDir, 'partial.jpg'), 'partial');
    fs.writeFileSync(getCoverTransactionJournalPath(managedCoverDir), JSON.stringify({
      version: 1,
      phase: 'swapped',
      managedCoverDir,
      rollbackDir,
      movedCurrent: true
    }));

    expect(recoverManagedCoverTransaction(managedCoverDir)).toMatchObject({
      recovered: true,
      swapStarted: true
    });
    expect(fs.readdirSync(managedCoverDir)).toEqual(['original.jpg']);
  });
});

describe('backup rollback reporting', () => {
  it('reports a cover rollback failure instead of claiming a complete rollback', async () => {
    const result = await rollbackBackupImport({
      coverTransaction: {
        rollback: () => { throw new Error('cover restore denied'); }
      },
      previousState: { version: 4 },
      saveStateFn: () => {},
      flushStateFn: async () => true
    });

    expect(result).toMatchObject({
      rolledBack: false,
      coversRolledBack: false,
      stateRolledBack: true
    });
    expect(result.rollbackError).toContain('cover restore denied');
  });

  it('reports a failed state reflush instead of claiming a complete rollback', async () => {
    const result = await rollbackBackupImport({
      coverTransaction: null,
      previousState: { version: 4 },
      saveStateFn: () => {},
      flushStateFn: async () => false
    });

    expect(result).toMatchObject({
      rolledBack: false,
      coversRolledBack: true,
      stateRolledBack: false
    });
    expect(result.rollbackError).toContain('reecriture');
  });
});

describe('storage v4 migration defaults', () => {
  it('preserves v3 values while adding session and preview defaults', () => {
    const migrated = normalizeState({
      version: 3,
      stateVersion: 3,
      session: { version: 3, activeWorkspaceId: 'workspace-1', workspaces: [] },
      ui: { theme: 'dark-night', cardSize: 'compact' },
      favorites: { retained: true }
    });

    expect(STORAGE_VERSION).toBe(7);
    expect(STATE_VERSION).toBe(7);
    expect(migrated).toMatchObject({
      version: 7,
      stateVersion: 7,
      session: { version: 8 },
      ui: {
        chapterCardSize: 'comfortable',
        pagePreviewSize: 'comfortable',
        previewQuality: 'balanced'
      },
      favorites: { retained: true }
    });
    expect(migrated.session.activeWorkspaceId).toBeTruthy();
  });
});
