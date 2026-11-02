const derivedStore = require('./derivedStore.cjs');
const {
  getJob,
  listJobs,
  upsertJob,
  markRunningJobsInterrupted
} = derivedStore;
const pruneTerminalJobs = typeof derivedStore.pruneTerminalJobs === 'function'
  ? derivedStore.pruneTerminalJobs
  : null;

const JOB_PRIORITY = {
  scan: 100,
  analyze: 90,
  'workbench-analysis': 88,
  'workbench-apply': 87,
  'source-import': 85,
  export: 80,
  'bulk-trash': 80,
  ocr: 70,
  hash: 60,
  upscale: 50,
  'deep-scan': 95
};

const JOB_LANE = {
  scan: 'scanAnalyze',
  analyze: 'scanAnalyze',
  'workbench-analysis': 'network',
  'workbench-apply': 'network',
  'deep-scan': 'scanAnalyze',
  'source-import': 'network',
  export: 'export',
  'bulk-trash': 'filesystem',
  ocr: 'heavy',
  hash: 'heavy',
  upscale: 'heavy'
};

const IDEMPOTENT_JOBS = new Set(['scan', 'analyze', 'deep-scan', 'source-import', 'workbench-analysis', 'ocr', 'hash', 'upscale']);

function nowIso() {
  return new Date().toISOString();
}

function makeJobId(kind) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class JobInterruptedError extends Error {
  constructor(message = 'Job interrupted') {
    super(message);
    this.name = 'JobInterruptedError';
    this.interrupted = true;
  }
}

function normalizeProfile(profile) {
  return ['interactive', 'balanced', 'idle-only'].includes(String(profile || '').trim())
    ? String(profile).trim()
    : 'balanced';
}

function formatJobKind(kind) {
  switch (kind) {
    case 'scan':
      return 'scan';
    case 'deep-scan':
      return 'scan profond';
    case 'analyze':
      return 'analyse';
    case 'export':
      return 'export';
    case 'bulk-trash':
      return 'suppression';
    case 'source-import':
      return 'import source';
    case 'ocr':
      return 'OCR';
    case 'hash':
      return 'hachage';
    case 'upscale':
      return 'upscale';
    default:
      return String(kind || 'job');
  }
}

class JobOrchestrator {
  constructor(options = {}) {
    this.handlers = options.handlers || {};
    this.onStateChanged = typeof options.onStateChanged === 'function' ? options.onStateChanged : null;
    this.shouldBlockJob = typeof options.shouldBlockJob === 'function' ? options.shouldBlockJob : null;
    this.readerActive = false;
    this.lastInteractionAt = 0;
    this.profile = normalizeProfile(options.profile);
    this.processing = false;
    this._scheduled = null;
    this.jobCache = new Map();
    this.refreshJobs();
  }

  bootstrap() {
    this.pruneTerminalHistory();
    const interrupted = markRunningJobsInterrupted();
    this.refreshJobs();
    interrupted
      .filter((job) => job.requeueable && IDEMPOTENT_JOBS.has(job.kind))
      .forEach((job) => {
        this.storeJob({
          ...job,
          status: 'queued',
          updatedAt: nowIso(),
          endedAt: null,
          startedAt: null,
          lastError: null
        });
      });
    this.schedule();
    return interrupted;
  }

  setProfile(profile) {
    this.profile = normalizeProfile(profile);
    this.schedule();
  }

  markInteraction() {
    this.lastInteractionAt = Date.now();
    this.schedule();
  }

  setReaderActive(active) {
    this.readerActive = Boolean(active);
    this.schedule();
  }

  enqueue(input = {}) {
    const kind = String(input.kind || '').trim();
    if (!kind) throw new Error('Job kind is required');
    const createdAt = nowIso();
    const job = this.storeJob({
      id: String(input.id || makeJobId(kind)),
      kind,
      priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : (JOB_PRIORITY[kind] || 0),
      lane: String(input.lane || JOB_LANE[kind] || 'scanAnalyze'),
      status: 'queued',
      payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
      progress: input.progress && typeof input.progress === 'object' ? input.progress : {},
      attempt: Number.isFinite(Number(input.attempt)) ? Number(input.attempt) : 0,
      requeueable: input.requeueable === undefined ? IDEMPOTENT_JOBS.has(kind) : Boolean(input.requeueable),
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      endedAt: null,
      lastError: null
    });
    this.notify(job);
    this.schedule();
    return job;
  }

  cancel(jobId) {
    const job = this.readJob(jobId);
    if (!job) return null;
    const next = this.storeJob({
      ...job,
      status: 'cancel_requested',
      updatedAt: nowIso()
    });
    this.notify(next);
    return next;
  }

  retry(jobId) {
    const job = this.readJob(jobId);
    if (!job) return null;
    const next = this.storeJob({
      ...job,
      status: 'queued',
      updatedAt: nowIso(),
      startedAt: null,
      endedAt: null,
      lastError: null
    });
    this.notify(next);
    this.schedule();
    return next;
  }

  list() {
    return [...this.jobCache.values()].sort((left, right) => {
      if (left.priority !== right.priority) return right.priority - left.priority;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }

  refreshJobs() {
    const jobs = listJobs();
    this.jobCache = new Map(jobs.map((job) => [job.id, job]));
    return this.list();
  }

  readJob(jobId) {
    const job = getJob(jobId);
    if (job?.id) this.jobCache.set(job.id, job);
    return job;
  }

  storeJob(job) {
    const stored = upsertJob(job);
    this.jobCache.set(stored.id, stored);
    return stored;
  }

  pruneTerminalHistory() {
    if (!pruneTerminalJobs) return [];
    const removedIds = pruneTerminalJobs();
    removedIds.forEach((jobId) => this.jobCache.delete(jobId));
    return removedIds;
  }

  getSyncStatus() {
    const jobs = this.list();
    const running = jobs.filter((job) => job.status === 'running');
    const queued = jobs.filter((job) => job.status === 'queued' || job.status === 'cancel_requested');
    const attention = jobs.filter((job) => job.status === 'failed' || job.status === 'interrupted');

    if (attention.length > 0) {
      return {
        state: 'attention-needed',
        label: 'attention',
        detail: `${attention.length} job${attention.length > 1 ? 's' : ''} a revoir`,
        runningCount: running.length,
        queuedCount: queued.length,
        attentionCount: attention.length,
        profile: this.profile
      };
    }

    if (running.length > 0 || queued.length > 0) {
      return {
        state: 'updating',
        label: 'mise a jour',
        detail: running.length > 0
          ? `${formatJobKind(running[0].kind)} en cours`
          : `${queued.length} job${queued.length > 1 ? 's' : ''} en attente`,
        runningCount: running.length,
        queuedCount: queued.length,
        attentionCount: 0,
        profile: this.profile
      };
    }

    return {
      state: 'up-to-date',
      label: 'a jour',
      detail: 'Donnees derivees synchronisees',
      runningCount: 0,
      queuedCount: 0,
      attentionCount: 0,
      profile: this.profile
    };
  }

  schedule(delay = 0) {
    if (this._scheduled) return;
    this._scheduled = setTimeout(() => {
      this._scheduled = null;
      this.process().catch(() => {});
    }, Math.max(0, Number(delay) || 0));
    if (typeof this._scheduled.unref === 'function') this._scheduled.unref();
  }

  laneAvailable(job, runningJobs = []) {
    if (job.lane === 'filesystem') return !runningJobs.some((entry) => entry.lane === 'filesystem');
    if (job.lane === 'export') return runningJobs.length === 0;
    if (job.lane === 'scanAnalyze') return !runningJobs.some((entry) => entry.lane === 'scanAnalyze' || entry.lane === 'export');
    if (job.lane === 'network') {
      return !runningJobs.some((entry) => entry.lane === 'scanAnalyze' || entry.lane === 'export' || entry.lane === 'network');
    }
    if (job.lane === 'heavy') return !runningJobs.some((entry) => entry.lane === 'heavy' || entry.lane === 'export');
    return runningJobs.length === 0;
  }

  blockedByProfile(job) {
    if (job.lane === 'scanAnalyze' && this.readerActive) return true;
    if (job.lane === 'scanAnalyze') {
      const source = String(job.payload?.source || '');
      const explicit = source.includes('manual') || source.includes('maintenance');
      if (!explicit) {
        const quietMs = this.profile === 'interactive' ? 2500 : this.profile === 'idle-only' ? 5000 : 1200;
        if ((Date.now() - this.lastInteractionAt) < quietMs) return true;
      }
    }
    if (job.lane !== 'heavy') return false;
    if (this.profile === 'interactive') {
      return this.readerActive || (Date.now() - this.lastInteractionAt) < 60000;
    }
    if (this.profile === 'balanced') {
      return this.readerActive || (Date.now() - this.lastInteractionAt) < 15000;
    }
    if (this.profile === 'idle-only') {
      return true;
    }
    return false;
  }

  pickNextJob() {
    const jobs = this.list();
    const runningJobs = jobs.filter((job) => job.status === 'running');
    const queuedJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'cancel_requested');

    for (const job of queuedJobs) {
      if (!this.laneAvailable(job, runningJobs)) continue;
      if (this.blockedByProfile(job)) continue;
      if (this.shouldBlockJob?.(job)) continue;
      return job;
    }

    return null;
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    try {
      let nextJob = this.pickNextJob();
      while (nextJob) {
        await this.runJob(nextJob);
        nextJob = this.pickNextJob();
      }
    } finally {
      this.processing = false;
      const hasTemporarilyDeferredJob = !this.readerActive && this.list().some((job) => (
        job.status === 'queued'
        && this.blockedByProfile(job)
        && !(job.lane === 'heavy' && this.profile === 'idle-only')
      ));
      if (hasTemporarilyDeferredJob) this.schedule(500);
    }
  }

  async runJob(job) {
    const handler = this.handlers[job.kind];
    if (typeof handler !== 'function') {
      const failedJob = this.storeJob({
        ...job,
        status: 'failed',
        updatedAt: nowIso(),
        endedAt: nowIso(),
        lastError: `No handler registered for ${job.kind}`
      });
      this.pruneTerminalHistory();
      this.notify(failedJob);
      return;
    }

    const cancelledBeforeStart = (this.readJob(job.id) || job).status === 'cancel_requested';
    const startedJob = this.storeJob({
      ...job,
      status: 'running',
      attempt: Number(job.attempt || 0) + 1,
      updatedAt: nowIso(),
      startedAt: nowIso(),
      endedAt: null,
      lastError: null
    });
    this.notify(startedJob);

    const checkpoint = (progress = {}) => {
      const latest = this.readJob(startedJob.id) || startedJob;
      const updated = this.storeJob({
        ...latest,
        progress: {
          ...(latest.progress || {}),
          ...progress
        },
        updatedAt: nowIso()
      });
      this.notify(updated);
      return cancelledBeforeStart || latest.status === 'cancel_requested';
    };

    try {
      await handler({
        job: startedJob,
        checkpoint,
        isCancelled: () => cancelledBeforeStart || (this.readJob(startedJob.id)?.status === 'cancel_requested')
      });

      const completed = this.readJob(startedJob.id) || startedJob;
      const cancelled = cancelledBeforeStart || completed.status === 'cancel_requested';
      const finishedJob = this.storeJob({
        ...completed,
        status: cancelled ? 'interrupted' : 'done',
        updatedAt: nowIso(),
        endedAt: nowIso(),
        lastError: cancelled ? (cancelledBeforeStart ? 'Cancelled before start' : 'Cancelled by user') : null
      });
      this.pruneTerminalHistory();
      this.notify(finishedJob);
    } catch (error) {
      const failed = this.readJob(startedJob.id) || startedJob;
      const cancelled = Boolean(
        error?.interrupted
        || cancelledBeforeStart
        || failed.status === 'cancel_requested'
      );
      const failedJob = this.storeJob({
        ...failed,
        status: cancelled ? 'interrupted' : 'failed',
        updatedAt: nowIso(),
        endedAt: nowIso(),
        lastError: error?.message || (cancelled ? 'Job interrupted' : 'Job failed')
      });
      this.pruneTerminalHistory();
      this.notify(failedJob);
    }
  }

  notify(job = null) {
    if (this.onStateChanged) {
      this.onStateChanged({
        job,
        syncStatus: this.getSyncStatus()
      });
    }
  }
}

module.exports = {
  JOB_PRIORITY,
  JOB_LANE,
  IDEMPOTENT_JOBS,
  JobInterruptedError,
  JobOrchestrator
};
