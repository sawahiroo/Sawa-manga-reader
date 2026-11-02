const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');
const yazl = require('yazl');

const PACKAGE_FORMAT = 'sawa-backup';
const PACKAGE_VERSION = 1;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function normalizePackageEntry(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (!normalized || normalized.includes('\0') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Chemin de sauvegarde non securise.');
  }
  return parts.join('/');
}

function listFiles(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  const root = path.resolve(rootPath);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push({
        fullPath,
        relativePath: normalizePackageEntry(path.relative(root, fullPath))
      });
    }
  };
  visit(root);
  return files;
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

async function writeZip(zipFile, targetPath) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    const completion = pipeline(zipFile.outputStream, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    zipFile.end();
    await completion;
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch (_cleanupError) {}
    throw error;
  }
}

async function exportBackupPackage(options = {}) {
  const targetPath = path.resolve(String(options.targetPath || ''));
  if (!targetPath || !targetPath.toLowerCase().endsWith('.sawa-backup')) {
    throw new Error('La sauvegarde doit utiliser l extension .sawa-backup.');
  }
  const exportStagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-backup-export-'));
  const stagedCoverDir = path.join(exportStagingDir, 'covers');
  try {
    fs.mkdirSync(stagedCoverDir, { recursive: true });
    if (options.managedCoverDir && fs.existsSync(options.managedCoverDir)) {
      await fs.promises.cp(options.managedCoverDir, stagedCoverDir, { recursive: true, force: false });
    }
    const stateBuffer = Buffer.from(JSON.stringify(options.state || {}, null, 2), 'utf8');
    const coverFiles = listFiles(stagedCoverDir);
    const checksums = { 'state.json': sha256Buffer(stateBuffer) };
    for (const cover of coverFiles) {
      checksums[`covers/${cover.relativePath}`] = await sha256File(cover.fullPath);
    }
    const manifest = {
      format: PACKAGE_FORMAT,
      packageVersion: PACKAGE_VERSION,
      appVersion: String(options.appVersion || '5.0.1'),
      storageVersion: Number(options.storageVersion || 5),
      stateVersion: Number(options.stateVersion || 4),
      createdAt: new Date().toISOString(),
      label: String(options.label || 'Export manuel').slice(0, 120),
      entryCount: Object.keys(checksums).length,
      checksums
    };
    const zipFile = new yazl.ZipFile();
    zipFile.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'manifest.json');
    zipFile.addBuffer(stateBuffer, 'state.json');
    coverFiles.forEach((cover) => {
      const stats = fs.statSync(cover.fullPath);
      zipFile.addFile(cover.fullPath, `covers/${cover.relativePath}`, {
        mtime: stats.mtime,
        mode: stats.mode,
        compress: true
      });
    });
    await writeZip(zipFile, targetPath);
    return {
      ok: true,
      exported: true,
      path: targetPath,
      manifest
    };
  } finally {
    fs.rmSync(exportStagingDir, { recursive: true, force: true });
  }
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (error, zipFile) => {
      if (error) reject(error);
      else resolve(zipFile);
    });
  });
}

async function extractPackage(filePath, stagingDir) {
  const zipFile = await openZip(filePath);
  let totalBytes = 0;
  const extracted = [];
  await new Promise((resolve, reject) => {
    let active = false;
    const fail = (error) => {
      try { zipFile.close(); } catch (_error) {}
      reject(error);
    };
    zipFile.on('entry', (entry) => {
      if (active) return fail(new Error('Lecture de sauvegarde incoherente.'));
      if (/\/$/.test(entry.fileName || '')) {
        zipFile.readEntry();
        return;
      }
      let entryName;
      try {
        entryName = normalizePackageEntry(entry.fileName);
      } catch (error) {
        fail(error);
        return;
      }
      if (entryName !== 'manifest.json' && entryName !== 'state.json' && !entryName.startsWith('covers/')) {
        fail(new Error(`Entree inattendue dans la sauvegarde: ${entryName}`));
        return;
      }
      const size = Number(entry.uncompressedSize || 0);
      totalBytes += size;
      if (size > MAX_ENTRY_BYTES || totalBytes > MAX_TOTAL_BYTES) {
        fail(new Error('Sauvegarde trop volumineuse.'));
        return;
      }
      const targetPath = path.resolve(stagingDir, ...entryName.split('/'));
      if (targetPath !== path.resolve(stagingDir) && !targetPath.startsWith(`${path.resolve(stagingDir)}${path.sep}`)) {
        fail(new Error('Chemin de sauvegarde hors zone de staging.'));
        return;
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      active = true;
      zipFile.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        pipeline(stream, fs.createWriteStream(targetPath, { flags: 'wx' }))
          .then(() => {
            active = false;
            extracted.push({ entryName, targetPath, size });
            zipFile.readEntry();
          })
          .catch(fail);
      });
    });
    zipFile.once('error', fail);
    zipFile.once('end', resolve);
    zipFile.readEntry();
  });
  return extracted;
}

function parseLegacyJson(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const state = parsed?.state && typeof parsed.state === 'object' ? parsed.state : parsed;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Sauvegarde JSON historique invalide.');
  }
  return {
    ok: true,
    legacy: true,
    state,
    manifest: parsed?.manifest || {
      format: 'legacy-json',
      createdAt: null,
      storageVersion: Number(state.storageVersion || state.version || 1),
      stateVersion: Number(state.stateVersion || state.version || 1)
    },
    stagingDir: null,
    stagedCoverDir: null
  };
}

async function stageBackupImport(filePath) {
  const resolvedPath = path.resolve(String(filePath || ''));
  if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error('Fichier de sauvegarde introuvable.');
  }
  const probe = Buffer.alloc(1);
  const probeHandle = fs.openSync(resolvedPath, 'r');
  try {
    fs.readSync(probeHandle, probe, 0, 1, 0);
  } finally {
    fs.closeSync(probeHandle);
  }
  const firstByte = probe.toString('utf8');
  if (path.extname(resolvedPath).toLowerCase() === '.json' || firstByte === '{' || firstByte === '[') {
    return parseLegacyJson(resolvedPath);
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sawa-backup-import-'));
  try {
    const extracted = await extractPackage(resolvedPath, stagingDir);
    const manifestPath = path.join(stagingDir, 'manifest.json');
    const statePath = path.join(stagingDir, 'state.json');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(statePath)) {
      throw new Error('Manifest ou etat manquant dans la sauvegarde.');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest?.format !== PACKAGE_FORMAT || Number(manifest?.packageVersion) !== PACKAGE_VERSION) {
      throw new Error('Version de paquet de sauvegarde non prise en charge.');
    }
    const checksums = manifest.checksums && typeof manifest.checksums === 'object' ? manifest.checksums : null;
    if (!checksums || !checksums['state.json']) throw new Error('Checksums de sauvegarde manquants.');
    const declaredEntries = new Set(['manifest.json']);
    for (const entryName of Object.keys(checksums)) {
      const safeName = normalizePackageEntry(entryName);
      if (safeName !== 'state.json' && !safeName.startsWith('covers/')) {
        throw new Error(`Entree declaree non prise en charge: ${safeName}`);
      }
      declaredEntries.add(safeName);
    }
    const undeclaredEntry = extracted.find((entry) => !declaredEntries.has(entry.entryName));
    if (undeclaredEntry) {
      throw new Error(`Entree non declaree dans la sauvegarde: ${undeclaredEntry.entryName}`);
    }
    for (const [entryName, expected] of Object.entries(checksums)) {
      const safeName = normalizePackageEntry(entryName);
      const entryPath = path.resolve(stagingDir, ...safeName.split('/'));
      if (!extracted.some((entry) => entry.entryName === safeName) || !fs.existsSync(entryPath)) {
        throw new Error(`Entree declaree manquante: ${safeName}`);
      }
      const actual = await sha256File(entryPath);
      if (actual !== String(expected)) throw new Error(`Checksum invalide: ${safeName}`);
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Etat de sauvegarde invalide.');
    const stagedCoverDir = path.join(stagingDir, 'covers');
    fs.mkdirSync(stagedCoverDir, { recursive: true });
    return {
      ok: true,
      legacy: false,
      state,
      manifest,
      stagingDir,
      stagedCoverDir
    };
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function getCoverTransactionJournalPath(managedCoverDir) {
  return `${managedCoverDir}.import-transaction.json`;
}

function recoverManagedCoverTransaction(managedCoverDir, options = {}) {
  const journalPath = getCoverTransactionJournalPath(managedCoverDir);
  if (!fs.existsSync(journalPath)) return { recovered: false };
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const resolvedManagedCoverDir = path.resolve(managedCoverDir);
  const rollbackDir = path.resolve(String(journal.rollbackDir || ''));
  if (
    path.resolve(String(journal.managedCoverDir || '')) !== resolvedManagedCoverDir
    || !rollbackDir.startsWith(`${resolvedManagedCoverDir}.rollback-`)
  ) {
    throw new Error('Journal de couvertures invalide.');
  }
  const rollbackExists = fs.existsSync(rollbackDir);
  const swapStarted = ['swapped', 'covers-replaced'].includes(journal.phase)
    || (journal.phase === 'prepared' && rollbackExists);
  if (options.commit) {
    fs.rmSync(rollbackDir, { recursive: true, force: true });
  } else if (swapStarted) {
    fs.rmSync(managedCoverDir, { recursive: true, force: true });
    if (journal.movedCurrent && rollbackExists) fs.renameSync(rollbackDir, managedCoverDir);
  }
  fs.rmSync(journalPath, { force: true });
  return {
    recovered: true,
    committed: Boolean(options.commit),
    swapStarted
  };
}

function replaceManagedCovers(stagedCoverDir, managedCoverDir) {
  if (!stagedCoverDir || !fs.existsSync(stagedCoverDir)) throw new Error('Staging de couvertures manquant.');
  recoverManagedCoverTransaction(managedCoverDir);
  const rollbackDir = `${managedCoverDir}.rollback-${process.pid}-${Date.now()}`;
  const movedCurrent = fs.existsSync(managedCoverDir);
  const journalPath = getCoverTransactionJournalPath(managedCoverDir);
  atomicWriteJson(journalPath, {
    version: 1,
    phase: 'prepared',
    managedCoverDir: path.resolve(managedCoverDir),
    rollbackDir: path.resolve(rollbackDir),
    movedCurrent,
    createdAt: new Date().toISOString()
  });
  if (fs.existsSync(managedCoverDir)) {
    fs.renameSync(managedCoverDir, rollbackDir);
  }
  try {
    atomicWriteJson(journalPath, {
      version: 1,
      phase: 'swapped',
      managedCoverDir: path.resolve(managedCoverDir),
      rollbackDir: path.resolve(rollbackDir),
      movedCurrent,
      createdAt: new Date().toISOString()
    });
    fs.cpSync(stagedCoverDir, managedCoverDir, { recursive: true, errorOnExist: true });
    atomicWriteJson(journalPath, {
      version: 1,
      phase: 'covers-replaced',
      managedCoverDir: path.resolve(managedCoverDir),
      rollbackDir: path.resolve(rollbackDir),
      movedCurrent,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    fs.rmSync(managedCoverDir, { recursive: true, force: true });
    if (movedCurrent && fs.existsSync(rollbackDir)) fs.renameSync(rollbackDir, managedCoverDir);
    fs.rmSync(journalPath, { force: true });
    throw error;
  }
  return {
    changed: true,
    journalPath,
    rollbackDir,
    rollback: () => recoverManagedCoverTransaction(managedCoverDir),
    commit: () => recoverManagedCoverTransaction(managedCoverDir, { commit: true })
  };
}

function cleanupStagedBackup(staged) {
  if (staged?.stagingDir) fs.rmSync(staged.stagingDir, { recursive: true, force: true });
}

module.exports = {
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  cleanupStagedBackup,
  exportBackupPackage,
  getCoverTransactionJournalPath,
  normalizePackageEntry,
  replaceManagedCovers,
  recoverManagedCoverTransaction,
  sha256Buffer,
  stageBackupImport
};
