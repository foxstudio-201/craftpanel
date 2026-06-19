/**
 * Socket.IO real-time layer (real data).
 *
 * Console streaming is reference-counted by *socket id* (a Set per server), not
 * a raw integer, so repeated subscribe/unsubscribe from the same client is
 * idempotent and never leaks `docker logs --follow` streams. A single follow
 * stream exists per server; it is created only while the container is running
 * and is torn down the instant the container stops/crashes — eliminating the
 * post-stop console spam.
 *
 * Channels:
 *   - metrics:overview / metrics:server  live stats
 *   - console:data                        {serverId, data}  raw container output
 *   - console:status                      {serverId, online, reason}  stream state
 *   - server:status                       {serverId, state}           lifecycle
 *   - players:update / notification / activity / announcement / queue:job
 */
import { Server } from 'socket.io';
import { verifyToken } from '../services/token.service.js';
import config from '../config/index.js';
import db from '../data/store.js';
import logger from '../utils/logger.js';

let io = null;
const consoleSubs = new Map();    // serverId -> Set<socketId>
const consoleStreams = new Map(); // serverId -> { stream }

export function getIO() {
  return io;
}

export function pushNotification(notification) {
  const full = {
    id: notification.id || Math.random().toString(36).slice(2, 12),
    type: notification.type || 'info',
    title: notification.title || 'Notification',
    message: notification.message || '',
    read: false,
    createdAt: new Date().toISOString(),
  };
  db.data.notifications.unshift(full);
  db.data.notifications = db.data.notifications.slice(0, 100);
  db.save();
  io?.emit('notification', full);
  return full;
}

/**
 * Emit raw console output to subscribers. The frontend xterm terminal does all
 * ANSI parsing, cursor/spinner handling, classification and timestamping — we
 * forward the container's bytes verbatim (preserving stdout/stderr).
 */
export function emitConsoleData(serverId, data) {
  io?.to(`console:${serverId}`).emit('console:data', { serverId, data });
}

/** Echo a command / RCON response into the stream (kept as a real line). */
export function emitConsoleLine(serverId, line) {
  const text = (line?.text ?? '');
  emitConsoleData(serverId, text.endsWith('\n') ? text : text + '\r\n');
  return { serverId, text };
}

function emitConsoleStatus(serverId, online, reason) {
  io?.to(`console:${serverId}`).emit('console:status', { serverId, online, reason: reason || null, ts: Date.now() });
}

/** Emit a real build log line to subscribers of a service's build channel. */
export function emitBuildLog(serverId, entry) {
  io?.to(`build:${serverId}`).emit('build:log', { serverId, ...entry });
}

/** Emit a build lifecycle event ({ buildId, status, ... }) to the build channel. */
export function emitBuildEvent(serverId, payload) {
  io?.to(`build:${serverId}`).emit('build:event', { serverId, ...payload });
}

/** Tear down a server's follow stream (keeps subscribers so it can reopen). */
export function closeConsoleStream(serverId, reason = 'offline') {
  const entry = consoleStreams.get(serverId);
  if (entry) {
    try { entry.stream.destroy(); } catch { /* ignore */ }
    consoleStreams.delete(serverId);
    logger.info(`[console] stream closed for ${serverId} (${reason})`);
  }
  emitConsoleStatus(serverId, false, reason);
}

/** Open the follow stream for a server iff it is running and has subscribers. */
export async function openConsoleStream(serverId) {
  const subs = consoleSubs.get(serverId);
  if (!subs || subs.size === 0) return;
  if (consoleStreams.get(serverId)) return; // already streaming

  const docker = await import('../services/docker.service.js');
  const server = db.data.servers.find((s) => s.id === serverId);
  if (!server?.dockerId) return emitConsoleStatus(serverId, false, 'container-not-found');

  let state;
  try { state = await docker.getState(server.dockerId); }
  catch { return emitConsoleStatus(serverId, false, 'daemon-unavailable'); }
  if (state !== 'running') return emitConsoleStatus(serverId, false, 'offline');

  try {
    const stream = await docker.logStream(server.dockerId, {
      // Live-only: stream output produced AFTER subscription (tail:0) — no history
      // dump. The console reflects only the current runtime session.
      tail: 0,
      // Forward raw bytes (ANSI + carriage returns intact) — the xterm frontend
      // is the terminal emulator. Never mangle the process output here.
      onRaw: (chunk) => emitConsoleData(serverId, chunk.toString('utf8')),
    });
    // When the container stops/crashes the follow stream ends — stop immediately.
    const onClose = () => { if (consoleStreams.get(serverId)?.stream === stream) closeConsoleStream(serverId, 'stream-ended'); };
    stream.on('end', onClose);
    stream.on('close', onClose);
    stream.on('error', () => closeConsoleStream(serverId, 'stream-error'));

    consoleStreams.set(serverId, { stream });
    emitConsoleStatus(serverId, true);
    logger.info(`[console] stream opened for ${serverId}`);
  } catch (err) {
    logger.warn(`[console] stream failed for ${serverId}: ${err.message}`);
    emitConsoleStatus(serverId, false, 'stream-error');
  }
}

function addSubscriber(serverId, socketId) {
  if (!consoleSubs.has(serverId)) consoleSubs.set(serverId, new Set());
  consoleSubs.get(serverId).add(socketId);
}
function removeSubscriber(serverId, socketId) {
  const subs = consoleSubs.get(serverId);
  if (!subs) return;
  subs.delete(socketId);
  if (subs.size === 0) {
    consoleSubs.delete(serverId);
    closeConsoleStream(serverId, 'no-subscribers');
  }
}

/** Called by the server lifecycle so the console reacts instantly to state. */
export function onServerStateChange(serverId, state) {
  const runtimeId = db.data.servers.find((s) => s.id === serverId)?.runtimeId || null;
  io?.emit('server:status', { serverId, state, runtimeId });
  if (state === 'running') openConsoleStream(serverId);
  else closeConsoleStream(serverId, state);
}

export function initSockets(httpServer) {
  io = new Server(httpServer, { cors: { origin: config.appUrl, credentials: true } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try { socket.user = verifyToken(token); } catch { /* anonymous */ }
    }
    next();
  });

  io.on('connection', (socket) => {
    if (socket.user?.role === 'admin' || socket.user?.role === 'moderator') socket.join('admins');
    logger.info(`[ws] connected ${socket.id}${socket.user ? ' (' + socket.user.sub + ')' : ''}`);

    // Register all event listeners SYNCHRONOUSLY first. (Doing async work before
    // this would drop early client emits — the cause of the missing log stream.)
    socket.on('subscribe:server', (serverId) => socket.join(`metrics:${serverId}`));
    socket.on('unsubscribe:server', (serverId) => socket.leave(`metrics:${serverId}`));

    socket.on('subscribe:build', (serverId) => socket.join(`build:${serverId}`));
    socket.on('unsubscribe:build', (serverId) => socket.leave(`build:${serverId}`));

    socket.on('subscribe:console', async (serverId) => {
      const server = db.data.servers.find((s) => s.id === serverId);
      if (!server) return socket.emit('console:status', { serverId, online: false, reason: 'not-found' });
      socket.join(`console:${serverId}`);
      addSubscriber(serverId, socket.id);
      await openConsoleStream(serverId); // emits console:status (online/offline) itself
    });

    socket.on('unsubscribe:console', (serverId) => {
      socket.leave(`console:${serverId}`);
      removeSubscriber(serverId, socket.id);
    });

    // Use 'disconnecting' so socket.rooms is still populated.
    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('console:')) removeSubscriber(room.slice('console:'.length), socket.id);
      }
    });
    socket.on('disconnect', () => logger.info(`[ws] disconnected ${socket.id}`));

    // Now (after listeners are live) push the initial snapshot, non-blocking.
    import('../services/metrics.service.js')
      .then(({ getOverview }) => getOverview())
      .then((ov) => socket.emit('metrics:overview', ov))
      .catch(() => { /* ignore */ });
  });

  // Metrics heartbeat (real docker stats) — WebSocket push, not client polling.
  setInterval(async () => {
    if (!io.engine.clientsCount) return;
    try {
      const { getOverview, getServerMetrics } = await import('../services/metrics.service.js');
      io.emit('metrics:overview', await getOverview());
      for (const server of db.data.servers) {
        const room = io.sockets.adapter.rooms.get(`metrics:${server.id}`);
        if (room?.size) io.to(`metrics:${server.id}`).emit('metrics:server', await getServerMetrics(server.id));
      }
    } catch (err) {
      logger.warn('[ws] metrics heartbeat error: ' + err.message);
    }
  }, config.metricsInterval);

  logger.success('WebSocket layer initialised (real-time)');
  return io;
}

export default initSockets;
