/**
 * Build & Publish system for Static Website services.
 *
 * A build runs the service's BUILD_CMD inside its real container (docker exec),
 * streaming genuine stdout/stderr to the build record + the build socket channel.
 * Publishing snapshots the served output into a deployment archive (enabling
 * redeploy + rollback) and restarts the container so the new build goes live.
 *
 * Nothing here is simulated: logs are real command output, status reflects the
 * real exit code, and rollback restores a real tar.gz of a previous deployment.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { nanoid } from 'nanoid';
import tar from 'tar-fs';

import db from '../data/store.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import ApiError from '../utils/ApiError.js';
import * as docker from './docker.service.js';
import { volumePath } from './minecraft.service.js';
import { typeOf, feature } from './service-registry.js';
import { logActivity } from './activity.service.js';
import * as queue from './queue.service.js';
import { emitBuildLog, emitBuildEvent, pushNotification } from '../sockets/index.js';

const deploymentsRoot = (uuid) => path.join(config.backupsRoot, uuid, 'deployments');
const MAX_LOG_LINES = 5000;

const findBuild = (id) => db.data.builds.find((b) => b.id === id);
export const buildsFor = (serverId) => db.data.builds.filter((b) => b.serverId === serverId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const deploymentsFor = (serverId) => db.data.deployments.filter((d) => d.serverId === serverId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

function assertBuildable(server) {
  if (!feature(typeOf(server), 'build')) throw ApiError.badRequest('Builds are not supported for this service type');
}

/** Queue a build (optionally publishing on success). Returns the build record. */
export function queueBuild(server, actor, { publish = true, trigger = 'manual' } = {}) {
  assertBuildable(server);
  const cmd = (server.env?.BUILD_CMD || '').trim();
  if (!cmd) throw ApiError.badRequest('No BUILD_CMD set — configure a build command on the Environment page');

  const build = {
    id: nanoid(10),
    serverId: server.id,
    ownerId: server.ownerId,
    status: 'queued',
    trigger,
    publish: !!publish,
    command: cmd,
    logs: [],
    exitCode: null,
    deploymentId: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  db.data.builds.unshift(build);
  db.data.builds = db.data.builds.slice(0, 500);
  db.save();
  emitBuildEvent(server.id, { buildId: build.id, status: 'queued' });

  const job = queue.enqueue('build', { serverId: server.id, buildId: build.id }, { actor: actor?.username || 'system' });
  build.jobId = job.id;
  db.save();
  logActivity('build.queue', { actor, target: server.name, serverId: server.id, meta: { buildId: build.id, trigger } });
  return build;
}

/** The queue handler — performs the real build. Registered at import time. */
async function runBuildJob(payload, job) {
  const build = findBuild(payload.buildId);
  if (!build) throw new Error('Build record missing');
  const server = db.data.servers.find((s) => s.id === build.serverId);
  if (!server) throw new Error('Service missing');

  appendLog(build, 'system', `Build ${build.id} started — ${build.command}`);
  patch(build, { status: 'running', startedAt: new Date().toISOString() });

  // The build runs inside the service container, which must be up.
  let state = 'exited';
  try { state = await docker.getState(server.dockerId); } catch { /* down */ }
  if (state !== 'running') {
    appendLog(build, 'system', 'Starting container for build…');
    try { await docker.start(server.dockerId); await delay(1500); }
    catch (err) { return finishBuild(build, server, { status: 'failed', exitCode: -1, error: `Cannot start container: ${err.message}` }); }
  }

  // Run the build, recording the shell PID so cancellation can kill it.
  const wrapped = `echo $$ > /tmp/cp-build-${build.id}.pid; ${build.command}`;
  let proc;
  try {
    proc = await docker.execStream(server.dockerId, ['/bin/sh', '-lc', wrapped], {
      onLine: (line, stream) => appendLog(build, stream, line),
    });
  } catch (err) {
    return finishBuild(build, server, { status: 'failed', exitCode: -1, error: err.message });
  }

  // Poll for a cancellation request while the build runs.
  let cancelled = false;
  const watcher = setInterval(async () => {
    if (job.cancelRequested && !cancelled) {
      cancelled = true;
      appendLog(build, 'system', 'Cancellation requested — terminating build…');
      try {
        await docker.exec(server.dockerId, ['/bin/sh', '-lc', `P=$(cat /tmp/cp-build-${build.id}.pid 2>/dev/null); kill $P 2>/dev/null; pkill -P $P 2>/dev/null; true`]);
      } catch { /* best effort */ }
      proc.destroy();
    }
  }, 700);

  let exitCode = -1;
  try { ({ exitCode } = await proc.done); }
  catch (err) { appendLog(build, 'stderr', err.message); }
  clearInterval(watcher);

  if (cancelled) return finishBuild(build, server, { status: 'cancelled', exitCode });
  if (exitCode !== 0) return finishBuild(build, server, { status: 'failed', exitCode });

  // Success → optionally publish (snapshot + restart so the new build is served).
  if (build.publish) {
    try {
      const deployment = await snapshotDeployment(server, build);
      build.deploymentId = deployment.id;
      appendLog(build, 'system', `Published deployment ${deployment.id}; restarting container…`);
      await docker.restart(server.dockerId).catch(() => {});
    } catch (err) {
      appendLog(build, 'stderr', `Publish failed: ${err.message}`);
      return finishBuild(build, server, { status: 'failed', exitCode });
    }
  }
  return finishBuild(build, server, { status: 'success', exitCode });
}

/** Snapshot the service volume as a deployment archive (for rollback/redeploy). */
async function snapshotDeployment(server, build) {
  const dir = deploymentsRoot(server.uuid);
  fs.mkdirSync(dir, { recursive: true });
  const id = nanoid(10);
  const file = path.join(dir, `${id}.tar.gz`);
  const vol = volumePath(server.uuid);
  fs.mkdirSync(vol, { recursive: true });
  await pipeline(tar.pack(vol), zlib.createGzip(), fs.createWriteStream(file));

  // Mark prior live deployment as superseded.
  for (const d of db.data.deployments) if (d.serverId === server.id && d.status === 'live') d.status = 'superseded';
  const deployment = {
    id, serverId: server.id, buildId: build.id, file,
    sizeBytes: fs.statSync(file).size, status: 'live', createdAt: new Date().toISOString(),
  };
  db.data.deployments.unshift(deployment);
  db.save();
  return deployment;
}

/** Roll back to a previous deployment: restore its snapshot and restart. */
export async function rollback(server, deploymentId, actor) {
  assertBuildable(server);
  const deployment = db.data.deployments.find((d) => d.id === deploymentId && d.serverId === server.id);
  if (!deployment) throw ApiError.notFound('Deployment not found');
  if (!fs.existsSync(deployment.file)) throw ApiError.notFound('Deployment archive is missing on disk');

  const vol = volumePath(server.uuid);
  await fsp.rm(vol, { recursive: true, force: true });
  fs.mkdirSync(vol, { recursive: true });
  await pipeline(fs.createReadStream(deployment.file), zlib.createGunzip(), tar.extract(vol));
  try { fs.chmodSync(vol, 0o777); } catch { /* best effort */ }
  await docker.restart(server.dockerId).catch(() => {});

  for (const d of db.data.deployments) if (d.serverId === server.id) d.status = d.id === deployment.id ? 'live' : 'superseded';
  db.save();
  logActivity('build.rollback', { actor, target: server.name, serverId: server.id, meta: { deploymentId } });
  pushNotification({ type: 'success', title: 'Rolled back', message: `${server.name} restored to deployment ${deployment.id}.` });
  return deployment;
}

/** Cancel a queued/running build. */
export function cancelBuild(server, buildId, actor) {
  const build = db.data.builds.find((b) => b.id === buildId && b.serverId === server.id);
  if (!build) throw ApiError.notFound('Build not found');
  if (build.status !== 'queued' && build.status !== 'running') throw ApiError.badRequest('Build is not in progress');
  queue.cancel(build.jobId);
  logActivity('build.cancel', { actor, target: server.name, serverId: server.id, meta: { buildId } });
  return build;
}

// ── helpers ───────────────────────────────────────────────────────────
function appendLog(build, stream, line) {
  if (line == null || line === '') return;
  const entry = { ts: new Date().toISOString(), stream, line: String(line).replace(/\r$/, '') };
  build.logs.push(entry);
  if (build.logs.length > MAX_LOG_LINES) build.logs.shift();
  emitBuildLog(build.serverId, { buildId: build.id, ...entry });
  db.save();
}

function patch(build, p) {
  Object.assign(build, p);
  db.save();
  emitBuildEvent(build.serverId, { buildId: build.id, status: build.status });
}

function finishBuild(build, server, { status, exitCode, error }) {
  if (error) appendLog(build, 'stderr', error);
  appendLog(build, 'system', `Build ${status}${exitCode != null ? ` (exit ${exitCode})` : ''}`);
  patch(build, { status, exitCode: exitCode ?? build.exitCode, finishedAt: new Date().toISOString() });
  pushNotification({
    type: status === 'success' ? 'success' : status === 'cancelled' ? 'warning' : 'error',
    title: `Build ${status}`, message: `${server.name}: build ${build.id} ${status}.`,
  });
  if (status === 'failed') throw new Error(`Build failed (exit ${exitCode})`);
  return { buildId: build.id, status };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Register the queue worker at import time.
queue.register('build', runBuildJob);
