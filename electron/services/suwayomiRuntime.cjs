const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const { getUserDataStoreDir } = require('./storage.cjs');

const RUNTIME_KIND = 'suwayomi';
const RUNTIME_VERSION = 'integrated-headless-v1';
const START_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 500;

let runtimeProcess = null;
let runtimeStatus = {
  kind: RUNTIME_KIND,
  version: RUNTIME_VERSION,
  state: 'stopped',
  healthy: false,
  port: null,
  startedAt: null,
  lastError: '',
  needsAttention: false,
  baseUrl: '',
  jarPath: '',
  rootDir: '',
  downloadsPath: ''
};
let stoppingProcess = false;

function nowIso() {
  return new Date().toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

async function removeDirectoryWithRetry(dirPath, attempts = 6) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') {
        throw error;
      }
      await delay(250 * (index + 1));
    }
  }
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function getRuntimeRootDir() {
  return ensureDir(path.join(getUserDataStoreDir(), 'source-runtime', 'suwayomi'));
}

function getRuntimeDownloadsDir() {
  return ensureDir(path.join(getRuntimeRootDir(), 'downloads'));
}

function getRuntimeLogsDir() {
  return ensureDir(path.join(getRuntimeRootDir(), 'logs'));
}

function getRuntimeStdoutPath() {
  return path.join(getRuntimeLogsDir(), 'stdout.log');
}

function getRuntimeStderrPath() {
  return path.join(getRuntimeLogsDir(), 'stderr.log');
}

function getRuntimeProcessMarkerPath() {
  return path.join(getRuntimeRootDir(), 'sawa-runtime-process.json');
}

function getRuntimeBaseUrl() {
  return runtimeStatus.baseUrl || (
    runtimeStatus.port ? `http://127.0.0.1:${runtimeStatus.port}` : ''
  );
}

function writeRuntimeProcessMarker(proc, details = {}) {
  try {
    fs.writeFileSync(getRuntimeProcessMarkerPath(), JSON.stringify({
      pid: proc?.pid || null,
      port: details.port || runtimeStatus.port || null,
      rootDir: details.rootDir || getRuntimeRootDir(),
      jarPath: details.jarPath || runtimeStatus.jarPath || '',
      startedAt: details.startedAt || nowIso()
    }, null, 2), 'utf8');
  } catch (_error) {
    // best-effort marker only
  }
}

function clearRuntimeProcessMarker() {
  try {
    fs.rmSync(getRuntimeProcessMarkerPath(), { force: true });
  } catch (_error) {
    // ignore
  }
}

function quotePowerShellString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function runPowerShell(script) {
  if (process.platform !== 'win32') return null;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded
  ], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 8000
  });
}

function findOwnedRuntimeProcessIds() {
  if (process.platform !== 'win32') return [];
  const rootDir = getRuntimeRootDir();
  const marker = (() => {
    try {
      return JSON.parse(fs.readFileSync(getRuntimeProcessMarkerPath(), 'utf8'));
    } catch (_error) {
      return null;
    }
  })();

  const rootLiteral = quotePowerShellString(rootDir);
  const markerPid = Number.parseInt(marker?.pid, 10);
  const script = `
$root = ${rootLiteral}
$ids = @()
if (${Number.isFinite(markerPid) ? markerPid : 0} -gt 0) { $ids += ${Number.isFinite(markerPid) ? markerPid : 0} }
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -ieq 'java.exe' -or $_.Name -ieq 'javaw.exe' -or $_.Name -ieq 'jcef_helper.exe') -and
    ($_.CommandLine -like ('*' + $root + '*'))
  } |
  ForEach-Object { $ids += [int]$_.ProcessId }
$ids | Select-Object -Unique
`;
  const result = runPowerShell(script);
  if (!result || result.status !== 0) return Number.isFinite(markerPid) ? [markerPid] : [];
  return String(result.stdout || '')
    .split(/\r?\n/g)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

function terminateOwnedRuntimeProcesses({ excludePid = null, dryRun = false } = {}) {
  if (process.platform !== 'win32') return [];
  const ids = findOwnedRuntimeProcessIds().filter((pid) => pid !== excludePid);
  if (dryRun) {
    // Caller (e.g. installer pre-flight) just wants to know what's running.
    return ids;
  }
  ids.forEach((pid) => {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    } catch (_error) {
      // ignore one stubborn process and keep cleaning the rest
    }
  });
  if (ids.length > 0) {
    clearRuntimeProcessMarker();
  }
  return ids;
}

function getJavaCandidates() {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const candidates = [
    normalizeText(process.env.SAWA_JAVA_PATH),
    process.resourcesPath
      ? path.join(process.resourcesPath, 'vendor', 'java', 'bin', executable)
      : '',
    path.join(workspaceRoot, 'vendor', 'java', 'bin', executable)
  ];
  if (normalizeText(process.env.JAVA_HOME)) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', executable));
  }
  candidates.push('java');
  return [...new Set(candidates.filter(Boolean))];
}

function resolveJavaCommand() {
  for (const candidate of getJavaCandidates()) {
    if (candidate === 'java' || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'java';
}

function getJarCandidates() {
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const candidates = [
    normalizeText(process.env.SAWA_SUWAYOMI_JAR),
    process.resourcesPath
      ? path.join(process.resourcesPath, 'vendor', 'suwayomi', 'Suwayomi-Server.jar')
      : '',
    path.join(workspaceRoot, 'vendor', 'suwayomi', 'Suwayomi-Server.jar'),
    path.join(workspaceRoot, '.codex-cache', 'suwayomi', 'Suwayomi-Server.jar')
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function resolveJarPath() {
  const jarPath = getJarCandidates().find((candidate) => fs.existsSync(candidate));
  if (!jarPath) {
    throw new Error('Runtime Suwayomi introuvable. Le fichier Suwayomi-Server.jar est manquant.');
  }
  return jarPath;
}

function toRuntimeError(error, fallback) {
  const message = normalizeText(error?.message, fallback);
  if (/ENOENT/i.test(message) || /java/i.test(message) && /introuvable/i.test(message)) {
    return 'Java est introuvable. Installe Java 21+ ou definis SAWA_JAVA_PATH.';
  }
  return message;
}

function updateRuntimeStatus(patch = {}) {
  runtimeStatus = {
    ...runtimeStatus,
    ...patch,
    kind: RUNTIME_KIND,
    version: normalizeText(patch.version, runtimeStatus.version || RUNTIME_VERSION),
    rootDir: runtimeStatus.rootDir || getRuntimeRootDir(),
    downloadsPath: runtimeStatus.downloadsPath || getRuntimeDownloadsDir()
  };
  runtimeStatus.baseUrl = runtimeStatus.port ? `http://127.0.0.1:${runtimeStatus.port}` : '';
  return getRuntimeStatus();
}

function getRuntimeStatus() {
  return {
    kind: runtimeStatus.kind,
    version: runtimeStatus.version,
    state: runtimeStatus.state,
    healthy: Boolean(runtimeStatus.healthy),
    port: runtimeStatus.port,
    startedAt: runtimeStatus.startedAt || null,
    lastError: runtimeStatus.lastError || '',
    needsAttention: Boolean(runtimeStatus.needsAttention),
    baseUrl: getRuntimeBaseUrl(),
    rootDir: runtimeStatus.rootDir || getRuntimeRootDir(),
    downloadsPath: runtimeStatus.downloadsPath || getRuntimeDownloadsDir(),
    jarPath: runtimeStatus.jarPath || ''
  };
}

function resolveRuntimeUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  try {
    return new URL(normalized).toString();
  } catch (_error) {
    const baseUrl = getRuntimeBaseUrl();
    if (!baseUrl) return normalized;
    return new URL(normalized, `${baseUrl}/`).toString();
  }
}

async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function registerProcess(proc) {
  runtimeProcess = proc;
  proc.once('error', (error) => {
    if (runtimeProcess !== proc) return;
    runtimeProcess = null;
    updateRuntimeStatus({
      state: 'stopped',
      healthy: false,
      port: null,
      needsAttention: true,
      lastError: toRuntimeError(error, 'Impossible de lancer le moteur Suwayomi.')
    });
  });
  proc.once('exit', (code, signal) => {
    if (runtimeProcess !== proc) return;
    runtimeProcess = null;
    const abnormal = !stoppingProcess && code !== 0;
    updateRuntimeStatus({
      state: 'stopped',
      healthy: false,
      port: null,
      needsAttention: abnormal,
      lastError: abnormal
        ? `Le moteur Suwayomi s est arrete de facon inattendue (${code ?? signal ?? 'inconnu'}).`
        : ''
    });
    clearRuntimeProcessMarker();
    stoppingProcess = false;
  });
}

async function graphqlRequestAt(baseUrl, query, variables = {}) {
  const normalizedBaseUrl = normalizeText(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error('Le moteur Suwayomi n est pas demarre.');
  }

  const response = await fetch(`${normalizedBaseUrl}/api/graphql`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Sawa Manga Library/5.0.1'
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors.map((entry) => normalizeText(entry?.message)).filter(Boolean)[0] || 'Erreur GraphQL Suwayomi.');
  }

  return payload?.data || {};
}

async function graphqlRequest(query, variables = {}) {
  const baseUrl = getRuntimeBaseUrl();
  if (!baseUrl) {
    throw new Error('Le moteur Suwayomi n est pas demarre.');
  }
  return graphqlRequestAt(baseUrl, query, variables);
}

async function pingRuntimeAtPort(port) {
  const normalizedPort = Number.parseInt(port, 10);
  if (!Number.isFinite(normalizedPort) || normalizedPort <= 0) return null;
  const data = await graphqlRequestAt(`http://127.0.0.1:${normalizedPort}`, `
    query SawaAboutServer {
      aboutServer {
        name
        version
      }
    }
  `);
  return data?.aboutServer || null;
}

async function pingRuntime() {
  return pingRuntimeAtPort(runtimeStatus.port);
}

async function waitUntilReady(proc) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (!proc || proc.exitCode !== null) {
      throw new Error('Le moteur Suwayomi s est ferme avant d etre pret.');
    }
    try {
      const aboutServer = await pingRuntime();
      if (aboutServer?.version) {
        return aboutServer;
      }
    } catch (_error) {
      // keep polling
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Le moteur Suwayomi n a pas repondu a temps.');
}

async function stopRuntime() {
  const current = runtimeProcess;
  if (!current) {
    terminateOwnedRuntimeProcesses();
    updateRuntimeStatus({
      state: 'stopped',
      healthy: false,
      port: null,
      needsAttention: false,
      lastError: ''
    });
    return getRuntimeStatus();
  }

  stoppingProcess = true;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(current.pid), '/T', '/F'], { windowsHide: true });
    } else {
      current.kill('SIGTERM');
    }
  } catch (_error) {
    // ignore
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (!runtimeProcess || current.exitCode !== null) break;
    await delay(100);
  }

  try {
    current.stdout?.destroy?.();
    current.stderr?.destroy?.();
    current.stdin?.destroy?.();
    current.unref?.();
  } catch (_error) {
    // ignore
  }

  await delay(600);
  runtimeProcess = null;
  terminateOwnedRuntimeProcesses();
  clearRuntimeProcessMarker();
  stoppingProcess = false;
  updateRuntimeStatus({
    state: 'stopped',
    healthy: false,
    port: null,
    needsAttention: false,
    lastError: ''
  });
  return getRuntimeStatus();
}

async function applySettings(patch = {}) {
  const settingsPatch = {};
  if (Array.isArray(patch.extensionRepos)) {
    settingsPatch.extensionRepos = patch.extensionRepos;
  }
  if (normalizeText(patch.downloadsPath)) {
    settingsPatch.downloadsPath = patch.downloadsPath;
  }
  if (patch.initialOpenInBrowserEnabled !== undefined) {
    settingsPatch.initialOpenInBrowserEnabled = Boolean(patch.initialOpenInBrowserEnabled);
  }
  if (patch.systemTrayEnabled !== undefined) {
    settingsPatch.systemTrayEnabled = Boolean(patch.systemTrayEnabled);
  }
  if (patch.webUIFlavor) {
    settingsPatch.webUIFlavor = patch.webUIFlavor;
  }
  if (patch.webUIInterface) {
    settingsPatch.webUIInterface = patch.webUIInterface;
  }

  if (!Object.keys(settingsPatch).length) {
    return null;
  }

  const data = await graphqlRequest(`
    mutation SawaSetSettings($settings: PartialSettingsTypeInput!) {
      setSettings(input: { settings: $settings }) {
        settings {
          downloadsPath
          extensionRepos
        }
      }
    }
  `, {
    settings: settingsPatch
  });

  return data?.setSettings?.settings || null;
}

async function fetchExtensions() {
  const data = await graphqlRequest(`
    mutation SawaFetchExtensions {
      fetchExtensions(input: {}) {
        extensions {
          pkgName
        }
      }
    }
  `);
  return data?.fetchExtensions?.extensions || [];
}

async function queryExtensions() {
  const data = await graphqlRequest(`
    query SawaExtensions {
      extensions(first: 500) {
        nodes {
          apkName
          hasUpdate
          iconUrl
          isInstalled
          isNsfw
          isObsolete
          lang
          name
          pkgName
          repo
          versionCode
          versionName
          source {
            nodes {
              id
              name
              displayName
              lang
              iconUrl
              isNsfw
              isConfigurable
              supportsLatest
            }
          }
        }
      }
    }
  `);
  return Array.isArray(data?.extensions?.nodes) ? data.extensions.nodes : [];
}

async function startRuntime(options = {}) {
  const extensionRepos = Array.isArray(options.extensionRepos)
    ? options.extensionRepos.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const existingPort = Number.parseInt(options.existingPort, 10);
  const existingStartedAt = normalizeText(options.existingStartedAt);

  if (runtimeProcess && runtimeStatus.healthy) {
    await applySettings({
      extensionRepos,
      downloadsPath: getRuntimeDownloadsDir(),
      initialOpenInBrowserEnabled: false,
      systemTrayEnabled: false
    });
    return getRuntimeStatus();
  }

  const jarPath = resolveJarPath();
  const rootDir = getRuntimeRootDir();
  const downloadsPath = getRuntimeDownloadsDir();

  if (Number.isFinite(existingPort) && existingPort > 0) {
    try {
      const aboutServer = await pingRuntimeAtPort(existingPort);
      if (aboutServer?.version) {
        updateRuntimeStatus({
          state: 'running',
          healthy: true,
          port: existingPort,
          startedAt: existingStartedAt || runtimeStatus.startedAt || nowIso(),
          version: normalizeText(aboutServer.version, RUNTIME_VERSION),
          lastError: '',
          needsAttention: false,
          jarPath,
          rootDir,
          downloadsPath
        });
        try {
          await applySettings({
            extensionRepos,
            downloadsPath,
            initialOpenInBrowserEnabled: false,
            systemTrayEnabled: false
          });
        } catch (_error) {
          // best-effort only when reattaching to an existing runtime
        }
        return getRuntimeStatus();
      }
    } catch (_error) {
      // existing port stale or unreachable; fall back to a fresh spawn
    }
  }

  terminateOwnedRuntimeProcesses();

  ensureDir(getRuntimeLogsDir());
  const stdoutPath = getRuntimeStdoutPath();
  const stderrPath = getRuntimeStderrPath();
  const port = await pickFreePort();
  const javaCommand = resolveJavaCommand();
  const args = [
    `-Dsuwayomi.tachidesk.config.server.rootDir=${rootDir}`,
    `-Dsuwayomi.tachidesk.config.server.downloadsPath=${downloadsPath}`,
    `-Dsuwayomi.tachidesk.config.server.port=${port}`,
    '-Dsuwayomi.tachidesk.config.server.ip=127.0.0.1',
    '-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false',
    '-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false',
    '-Dsuwayomi.tachidesk.config.server.webUIEnabled=false',
    '-jar',
    jarPath
  ];

  fs.appendFileSync(stdoutPath, `\n[${nowIso()}] Demarrage du runtime Suwayomi\n`, 'utf8');
  fs.appendFileSync(stderrPath, `\n[${nowIso()}] Demarrage du runtime Suwayomi\n`, 'utf8');

  try {
    const proc = spawn(javaCommand, args, {
      cwd: path.dirname(jarPath),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    registerProcess(proc);
    writeRuntimeProcessMarker(proc, { port, rootDir, jarPath, startedAt: nowIso() });
    updateRuntimeStatus({
      state: 'starting',
      healthy: false,
      port,
      startedAt: nowIso(),
      lastError: '',
      needsAttention: false,
      jarPath,
      rootDir,
      downloadsPath
    });

    const aboutServer = await waitUntilReady(proc);
    updateRuntimeStatus({
      state: 'running',
      healthy: true,
      version: normalizeText(aboutServer?.version, RUNTIME_VERSION),
      lastError: '',
      needsAttention: false
    });

    await applySettings({
      extensionRepos,
      downloadsPath,
      initialOpenInBrowserEnabled: false,
      systemTrayEnabled: false
    });

    return getRuntimeStatus();
  } catch (error) {
    await stopRuntime();
    updateRuntimeStatus({
      state: 'stopped',
      healthy: false,
      port: null,
      needsAttention: true,
      lastError: toRuntimeError(error, 'Impossible de demarrer Suwayomi.'),
      jarPath,
      rootDir,
      downloadsPath
    });
    throw new Error(runtimeStatus.lastError);
  }
}

async function resetRuntimeData() {
  await stopRuntime();
  const rootDir = getRuntimeRootDir();
  await removeDirectoryWithRetry(rootDir);
  ensureDir(getRuntimeRootDir());
  ensureDir(getRuntimeDownloadsDir());
  updateRuntimeStatus({
    state: 'stopped',
    healthy: false,
    port: null,
    startedAt: null,
    lastError: '',
    needsAttention: false
  });
  return getRuntimeStatus();
}

async function synchronizeRepositories(repositoryUrls = [], options = {}) {
  const runtime = await startRuntime({
    extensionRepos: repositoryUrls,
    existingPort: options?.existingPort,
    existingStartedAt: options?.existingStartedAt
  });
  await applySettings({
    extensionRepos: repositoryUrls,
    downloadsPath: getRuntimeDownloadsDir(),
    initialOpenInBrowserEnabled: false,
    systemTrayEnabled: false
  });
  await fetchExtensions();
  return {
    runtime,
    extensions: await queryExtensions()
  };
}

async function updateExtension(packageName, patch) {
  const normalizedPackage = normalizeText(packageName);
  if (!normalizedPackage) {
    throw new Error('Extension introuvable.');
  }
  const data = await graphqlRequest(`
    mutation SawaUpdateExtension($id: String!, $patch: UpdateExtensionPatchInput!) {
      updateExtension(input: { id: $id, patch: $patch }) {
        extension {
          pkgName
        }
      }
    }
  `, {
    id: normalizedPackage,
    patch
  });
  return data?.updateExtension?.extension || null;
}

async function installExtension(packageName) {
  return updateExtension(packageName, { install: true });
}

async function refreshExtension(packageName) {
  return updateExtension(packageName, { update: true });
}

async function uninstallExtension(packageName) {
  return updateExtension(packageName, { uninstall: true });
}

async function getExtension(packageName) {
  const data = await graphqlRequest(`
    query SawaExtension($pkgName: String!) {
      extension(pkgName: $pkgName) {
        pkgName
        name
        lang
        versionName
        versionCode
        hasUpdate
        isInstalled
        isNsfw
        isObsolete
        iconUrl
        repo
        source {
          nodes {
            id
            name
            displayName
            lang
            iconUrl
            isNsfw
            isConfigurable
            supportsLatest
          }
        }
      }
    }
  `, {
    pkgName: normalizeText(packageName)
  });
  return data?.extension || null;
}

async function getSource(sourceId) {
  const data = await graphqlRequest(`
    query SawaSource($id: LongString!) {
      source(id: $id) {
        id
        name
        displayName
        lang
        iconUrl
        isNsfw
        isConfigurable
        supportsLatest
        preferences {
          __typename
          ... on CheckBoxPreference {
            key
            title
            summary
            visible
            default
            currentValue
          }
          ... on EditTextPreference {
            key
            title
            summary
            visible
            default
            currentValue
            dialogMessage
            dialogTitle
            text
          }
          ... on ListPreference {
            key
            title
            summary
            visible
            default
            currentValue
            entries
            entryValues
          }
          ... on MultiSelectListPreference {
            key
            title
            summary
            visible
            default
            currentValue
            entries
            entryValues
            dialogMessage
            dialogTitle
          }
          ... on SwitchPreference {
            key
            title
            summary
            visible
            default
            currentValue
          }
        }
      }
    }
  `, {
    id: String(sourceId)
  });
  return data?.source || null;
}

async function searchSourceManga({ sourceId, query, page = 0, filters = [], type = 'SEARCH' }) {
  const normalizedType = ['SEARCH', 'POPULAR', 'LATEST'].includes(String(type || '').trim().toUpperCase())
    ? String(type || '').trim().toUpperCase()
    : 'SEARCH';
  const normalizedQuery = normalizeText(query);
  const data = await graphqlRequest(`
    mutation SawaSearchSourceManga($source: LongString!, $query: String, $page: Int!, $filters: [FilterChangeInput!]) {
      fetchSourceManga(input: {
        source: $source
        type: ${normalizedType}
        query: $query
        page: $page
        filters: $filters
      }) {
        hasNextPage
        mangas {
          id
          title
          thumbnailUrl
          description
          author
          artist
          status
          realUrl
          sourceId
        }
      }
    }
  `, {
    source: String(sourceId),
    query: normalizedType === 'SEARCH'
      ? (normalizedQuery || null)
      : null,
    page: Number.isFinite(Number(page)) ? Number(page) : 0,
    filters
  });
  return data?.fetchSourceManga || { mangas: [], hasNextPage: false };
}

async function getManga(mangaId) {
  const data = await graphqlRequest(`
    query SawaManga($id: Int!) {
      manga(id: $id) {
        id
        title
        thumbnailUrl
        description
        author
        artist
        status
        realUrl
        sourceId
      }
    }
  `, {
    id: Number(mangaId)
  });
  return data?.manga || null;
}

async function fetchChapters(mangaId) {
  const data = await graphqlRequest(`
    mutation SawaFetchChapters($mangaId: Int!) {
      fetchChapters(input: { mangaId: $mangaId }) {
        chapters {
          id
          mangaId
          name
          chapterNumber
          pageCount
          sourceOrder
          uploadDate
          realUrl
          scanlator
          url
        }
      }
    }
  `, {
    mangaId: Number(mangaId)
  });
  return Array.isArray(data?.fetchChapters?.chapters)
    ? data.fetchChapters.chapters
    : [];
}

async function fetchChapterPages(chapterId) {
  const data = await graphqlRequest(`
    mutation SawaFetchChapterPages($chapterId: Int!) {
      fetchChapterPages(input: { chapterId: $chapterId }) {
        pages
      }
    }
  `, {
    chapterId: Number(chapterId)
  });
  return Array.isArray(data?.fetchChapterPages?.pages)
    ? data.fetchChapterPages.pages
    : [];
}

async function updateSourcePreference(sourceId, change) {
  const data = await graphqlRequest(`
    mutation SawaUpdateSourcePreference($source: LongString!, $change: SourcePreferenceChangeInput!) {
      updateSourcePreference(input: { source: $source, change: $change }) {
        source {
          id
        }
        preferences {
          __typename
          ... on CheckBoxPreference {
            key
            title
            summary
            visible
            default
            currentValue
          }
          ... on EditTextPreference {
            key
            title
            summary
            visible
            default
            currentValue
            dialogMessage
            dialogTitle
            text
          }
          ... on ListPreference {
            key
            title
            summary
            visible
            default
            currentValue
            entries
            entryValues
          }
          ... on MultiSelectListPreference {
            key
            title
            summary
            visible
            default
            currentValue
            entries
            entryValues
            dialogMessage
            dialogTitle
          }
          ... on SwitchPreference {
            key
            title
            summary
            visible
            default
            currentValue
          }
        }
      }
    }
  `, {
    source: String(sourceId),
    change
  });
  return Array.isArray(data?.updateSourcePreference?.preferences)
    ? data.updateSourcePreference.preferences
    : [];
}

module.exports = {
  RUNTIME_KIND,
  RUNTIME_VERSION,
  getRuntimeRootDir,
  getRuntimeDownloadsDir,
  getRuntimeStatus,
  getRuntimeBaseUrl,
  resolveRuntimeUrl,
  terminateOwnedRuntimeProcesses,
  startRuntime,
  stopRuntime,
  resetRuntimeData,
  synchronizeRepositories,
  queryExtensions,
  getExtension,
  installExtension,
  refreshExtension,
  uninstallExtension,
  getSource,
  searchSourceManga,
  getManga,
  fetchChapters,
  fetchChapterPages,
  updateSourcePreference,
  applySettings
};
