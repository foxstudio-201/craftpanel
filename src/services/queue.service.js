/**
 * Background job queue.
 *
 * Drivers:
 *   - in-process (default): a real concurrency-limited async queue. Jobs run in
 *     the panel process; job records are persisted to the JSON store.
 *   - redis (optional): when REDIS_URL is set and ioredis is available, job
 *     records are mirrored to a Redis list for durability / external workers.
 *
 * Used for: deployment, backups, scheduled server actions and notifications —
 * any work that should run off the request path.
 */
import { nanoid } from 'nanoid';
import db from '../data/store.js';
import logger from '../utils/logger.js';
import { getIO } from '../sockets/index.js';

const handlers = new Map();   // type -> async fn(payload, job)
const pending = [];
let active = 0;
const CONCURRENCY = 3;

let redis = null;
let driver = 'in-process';

export async function initQueue() {
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const { default: Redis } = await import('ioredis');
      redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
      await redis.connect();
      driver = 'redis';
      logger.success(`Queue using Redis driver (${url})`);
    } catch (err) {
      redis = null;
      logger.warn(`Redis unavailable (${err.message}); using in-process queue`);
    }
  } else {
    logger.info('Queue using in-process driver (set REDIS_URL to enable Redis)');
  }
}

export const driverName = () => driver;

/** Register a worker for a job type. */
export function register(type, fn) {
  handlers.set(type, fn);
}

/** Enqueue a job. Returns the job record. */
export function enqueue(type, payload = {}, meta = {}) {
  const job = {
    id: nanoid(12),
    type,
    payload,
    status: 'queued',
    actor: meta.actor || 'system',
    serverId: payload.serverId || null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  db.data.queueJobs.unshift(job);
  db.data.queueJobs = db.data.queueJobs.slice(0, 300);
  db.save();
  if (redis) redis.lpush('craftpanel:jobs', JSON.stringify(job)).catch(() => {});
  getIO()?.to('admins').emit('queue:job', job);

  pending.push(job);
  drain();
  return job;
}

function update(job, patch) {
  Object.assign(job, patch);
  db.save();
  getIO()?.to('admins').emit('queue:job', job);
}

async function drain() {
  if (active >= CONCURRENCY) return;
  const job = pending.shift();
  if (!job) return;
  active++;
  update(job, { status: 'running', startedAt: new Date().toISOString() });

  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
    const result = await handler(job.payload, job);
    update(job, { status: 'completed', finishedAt: new Date().toISOString(), result: result ?? null });
  } catch (err) {
    logger.error(`Job ${job.type} failed: ${err.message}`);
    update(job, { status: 'failed', finishedAt: new Date().toISOString(), error: err.message });
  } finally {
    active--;
    drain();
  }
}

/**
 * Request cancellation of a job. A queued job is removed immediately; a running
 * job gets `cancelRequested` set so its handler (e.g. build) can stop the work
 * and resolve. Returns true if the job was found.
 */
export function cancel(jobId) {
  const queuedIdx = pending.findIndex((j) => j.id === jobId);
  if (queuedIdx !== -1) {
    const [job] = pending.splice(queuedIdx, 1);
    update(job, { status: 'cancelled', finishedAt: new Date().toISOString() });
    return true;
  }
  const job = db.data.queueJobs.find((j) => j.id === jobId);
  if (job && job.status === 'running') { job.cancelRequested = true; return true; }
  return false;
}

export function listJobs(limit = 100) {
  return db.data.queueJobs.slice(0, limit);
}

export function stats() {
  const jobs = db.data.queueJobs;
  return {
    driver,
    redisConnected: !!redis && redis.status === 'ready',
    queued: jobs.filter((j) => j.status === 'queued').length,
    running: jobs.filter((j) => j.status === 'running').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    total: jobs.length,
  };
}
