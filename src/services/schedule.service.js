/**
 * Schedules — real cron-driven automation. Each schedule fires a queued job
 * that performs a server action (start/stop/restart/backup) or runs a console
 * command via RCON. Backed by node-cron; survives restarts via the JSON store.
 */
import cron from 'node-cron';
import cronParser from 'cron-parser';
import { nanoid } from 'nanoid';

import db from '../data/store.js';
import logger from '../utils/logger.js';
import ApiError from '../utils/ApiError.js';
import * as queue from './queue.service.js';
import * as serverSvc from './server.service.js';
import * as docker from './docker.service.js';
import * as mc from './minecraft.service.js';
import { typeOf, feature } from './service-registry.js';
import { logActivity } from './activity.service.js';

const tasks = new Map(); // scheduleId -> cron task
export const ACTIONS = ['start', 'stop', 'restart', 'kill', 'backup', 'command'];

/** Real next-execution timestamp for a cron expression. */
function nextRunISO(expr) {
  try { return cronParser.parseExpression(expr).next().toISOString(); }
  catch { return null; }
}

function registerTask(schedule) {
  unregisterTask(schedule.id);
  if (!schedule.enabled) return;
  if (!cron.validate(schedule.cron)) {
    logger.warn(`Schedule ${schedule.id} has invalid cron: ${schedule.cron}`);
    return;
  }
  const task = cron.schedule(schedule.cron, () => {
    queue.enqueue('schedule.run', { scheduleId: schedule.id }, { actor: 'scheduler' });
  });
  tasks.set(schedule.id, task);
}

function unregisterTask(id) {
  const t = tasks.get(id);
  if (t) { t.stop(); tasks.delete(id); }
}

function recordHistory(schedule, status, error) {
  schedule.history = schedule.history || [];
  schedule.history.unshift({ ts: new Date().toISOString(), status, error: error || null });
  schedule.history = schedule.history.slice(0, 20);
  schedule.lastRun = schedule.history[0].ts;
  schedule.nextRun = nextRunISO(schedule.cron);
  db.save();
}

/** Queue worker that performs the schedule's action (never the live terminal). */
async function runSchedule({ scheduleId }) {
  const schedule = db.data.schedules.find((s) => s.id === scheduleId);
  if (!schedule || !schedule.enabled) return;
  const server = db.data.servers.find((s) => s.id === schedule.serverId);
  if (!server) return;

  const sysActor = { id: 'scheduler', username: 'scheduler' };
  try {
    switch (schedule.action) {
      case 'start': case 'stop': case 'restart': case 'kill':
        await serverSvc.power(server, schedule.action, sysActor);
        break;
      case 'backup':
        await serverSvc.createBackup(server, sysActor, { type: 'scheduled' });
        break;
      case 'command':
        if ((await docker.getState(server.dockerId)) !== 'running') throw new Error('Server is offline');
        // Minecraft uses RCON; other services receive the command on stdin.
        if (feature(typeOf(server), 'rcon') && !mc.isProxy(server.software)) {
          await docker.rcon(server.dockerId, schedule.payload || 'list');
        } else {
          await docker.writeStdin(server.dockerId, schedule.payload || '');
        }
        break;
    }
    recordHistory(schedule, 'success');
    logActivity('schedule.run', { actor: sysActor, target: server.name, serverId: server.id, meta: { action: schedule.action } });
  } catch (err) {
    recordHistory(schedule, 'failed', err.message);
    logActivity('schedule.failed', { actor: sysActor, target: server.name, serverId: server.id, meta: { action: schedule.action, error: err.message } });
    throw err;
  }
}

export function initScheduler() {
  queue.register('schedule.run', runSchedule);
  let count = 0;
  for (const s of db.data.schedules) { registerTask(s); if (s.enabled) count++; }
  logger.success(`Scheduler initialised (${count} active schedule${count === 1 ? '' : 's'})`);
}

// ── CRUD ───────────────────────────────────────────────────────────────
export function create({ serverId, ownerId, name, cron: expr, action, payload }) {
  if (!cron.validate(expr)) throw ApiError.badRequest('Invalid cron expression');
  if (!ACTIONS.includes(action)) throw ApiError.badRequest('Invalid action');
  const schedule = {
    id: nanoid(10), serverId, ownerId, name: name || 'Schedule',
    cron: expr, action, payload: payload || '', enabled: true,
    lastRun: null, nextRun: nextRunISO(expr), history: [], createdAt: new Date().toISOString(),
  };
  db.data.schedules.push(schedule);
  db.save();
  registerTask(schedule);
  return schedule;
}

export function update(schedule, patch) {
  if (patch.cron && !cron.validate(patch.cron)) throw ApiError.badRequest('Invalid cron expression');
  if (patch.action && !ACTIONS.includes(patch.action)) throw ApiError.badRequest('Invalid action');
  Object.assign(schedule, patch);
  if (patch.cron) schedule.nextRun = nextRunISO(patch.cron);
  db.save();
  registerTask(schedule);
  return schedule;
}

export function remove(schedule) {
  unregisterTask(schedule.id);
  db.data.schedules = db.data.schedules.filter((s) => s.id !== schedule.id);
  db.save();
}

export function runNow(schedule) {
  return queue.enqueue('schedule.run', { scheduleId: schedule.id }, { actor: 'manual' });
}
