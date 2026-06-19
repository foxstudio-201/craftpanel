/**
 * Activity / audit logging. Every meaningful action (lifecycle, auth, admin)
 * is recorded here and surfaced on the admin "Activity logs" view, and pushed
 * live to admins over WebSocket.
 */
import { nanoid } from 'nanoid';
import db from '../data/store.js';
import { getIO } from '../sockets/index.js';

/**
 * @param {string} action  e.g. 'server.start', 'user.suspend', 'auth.login'
 * @param {object} o
 * @param {object} [o.actor]   { id, username } performing the action
 * @param {string} [o.target]  human-readable target (server name, user, …)
 * @param {string} [o.serverId]
 * @param {object} [o.meta]
 * @param {string} [o.ip]
 */
export function logActivity(action, o = {}) {
  const entry = {
    id: nanoid(12),
    action,
    actorId: o.actor?.id || null,
    actor: o.actor?.username || 'system',
    target: o.target || null,
    serverId: o.serverId || null,
    meta: o.meta || null,
    ip: o.ip || null,
    createdAt: new Date().toISOString(),
  };
  db.data.activityLogs.unshift(entry);
  db.data.activityLogs = db.data.activityLogs.slice(0, 1000);
  db.save();
  getIO()?.to('admins').emit('activity', entry);
  return entry;
}

export default logActivity;
