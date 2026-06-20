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

/**
 * Runtime log buffers — daemon-memory capture of the CURRENT runtime session.
 *
 *   serverId -> { runtimeId, serverId, startedAt, chunks:[], bytes }
 *
 * One buffer per running session. It is created when the follow stream opens for
 * a running container and is destroyed the instant the runtime ends
 * (stop/crash/stream-end). This is what lets the console survive a browser
 * refresh or tab switch WITHOUT persisting anything to localStorage: the buffer
 * lives in backend memory for as long as the runtime session lives and is
 * replayed to each (re)subscribing socket. When the server is offline there is
 * no buffer, so a refresh starts empty.
 */
const consoleBuffers = new Map();
const MAX_BUFFER_BYTES = 512 * 1024; // cap per-session memory; trim oldest chunks

/** Create a fresh buffer for a runtime session (or reset it if the id changed). */
function ensureBuffer(serverId, runtimeId) {
  const existing = consoleBuffers.get(serverId);
  if (existing && existing.runtimeId === runtimeId) return existing;
  const buf = { runtimeId: runtimeId || null, serverId, startedAt: Date.now(), chunks: [], bytes: 0 };
  consoleBuffers.set(serverId, buf);
  return buf;
}

/** Append captured output to the session buffer, trimming from the front. */
function appendBuffer(buf, text) {
  if (!text) return;
  buf.chunks.push(text);
  buf.bytes += Buffer.byteLength(text);
  while (buf.bytes > MAX_BUFFER_BYTES && buf.chunks.length > 1) {
    buf.bytes -= Buffer.byteLength(buf.chunks.shift());
  }
}

/** Drop the buffer for a server (runtime session ended). */
function destroyBuffer(serverId) {
  consoleBuffers.delete(serverId);
}

/** Replay the current session buffer to a single (re)connecting socket. */
function replayBuffer(socket, serverId) {
  const buf = consoleBuffers.get(serverId);
  if (!buf || !buf.chunks.length) return;
  socket.emit('console:data', { serverId, data: buf.chunks.join(''), replay: true, runtimeId: buf.runtimeId });
}

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
  const buf = consoleBuffers.get(serverId);
  if (buf) appendBuffer(buf, data);
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

/**
 * Tear down a server's follow stream AND destroy the runtime log buffer.
 *
 * Called when the runtime session ends (stop/crash/stream-end). Because the
 * stream + buffer are now tied to the runtime session (not to subscriber count),
 * this is the single place the session's logs are discarded — satisfying "clear
 * logs only when the server is offline" + the buffer never outliving its run.
 */
export function closeConsoleStream(serverId, reason = 'offline') {
  const entry = consoleStreams.get(serverId);
  if (entry) {
    try { entry.stream.destroy(); } catch { /* ignore */ }
    consoleStreams.delete(serverId);
    logger.info(`[console] stream closed for ${serverId} (${reason})`);
  }
  destroyBuffer(serverId);
  emitConsoleStatus(serverId, false, reason);
}

/**
 * Open the follow stream for a server iff it is running, and capture its output
 * into the runtime log buffer for the lifetime of the session.
 *
 * Idempotent: a stream is created at most once per running session. It is NOT
 * gated on subscriber count — the buffer must accumulate the whole session so
 * that a browser refresh / tab switch / re-navigation can replay it. The stream
 * is torn down only when the container stops/crashes (see closeConsoleStream).
 *
 * STRICTLY LIVE-ONLY: we never read Docker's log history. The panel reuses the
 * same container across stop/start, and the json-file driver keeps old runs'
 * logs — so seeding from `docker logs` would resurrect a previous session's
 * output. We only `--follow` from now (tail:0); the buffer holds exactly what
 * this runtime produces, keyed to the current runtimeId.
 */
export async function openConsoleStream(serverId) {
  if (consoleStreams.get(serverId)) return; // already streaming this session

  const docker = await import('../services/docker.service.js');
  const server = db.data.servers.find((s) => s.id === serverId);
  if (!server?.dockerId) return emitConsoleStatus(serverId, false, 'container-not-found');

  let state;
  try { state = await docker.getState(server.dockerId); }
  catch { return emitConsoleStatus(serverId, false, 'daemon-unavailable'); }
  if (state !== 'running') { destroyBuffer(serverId); return emitConsoleStatus(serverId, false, 'offline'); }

  // Fresh buffer for THIS runtime (ensureBuffer resets if the runtimeId changed,
  // so a restart never inherits the previous session's captured output).
  ensureBuffer(serverId, server.runtimeId || null);

  try {
    const stream = await docker.logStream(server.dockerId, {
      // Live-only `--follow` from now (no history dump) — see the note above.
      tail: 0,
      // Forward raw bytes (ANSI + carriage returns intact) — the xterm frontend
      // is the terminal emulator. emitConsoleData also appends to the buffer.
      onRaw: (chunk) => emitConsoleData(serverId, chunk.toString('utf8')),
    });
    // When the container stops/crashes the follow stream ends — end the session.
    const onClose = () => { if (consoleStreams.get(serverId)?.stream === stream) closeConsoleStream(serverId, 'stream-ended'); };
    stream.on('end', onClose);
    stream.on('close', onClose);
    stream.on('error', () => closeConsoleStream(serverId, 'stream-error'));

    consoleStreams.set(serverId, { stream });
    emitConsoleStatus(serverId, true);
    logger.info(`[console] stream opened for ${serverId} (runtime ${server.runtimeId?.slice(0, 8) || '—'})`);
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
  // Do NOT close the stream or drop the buffer when the last viewer leaves: the
  // runtime session keeps running, so its logs must keep accumulating for the
  // next attach (refresh / tab switch / re-navigation). The stream/buffer are
  // torn down only when the runtime itself ends (onServerStateChange / stream
  // close). Just forget the empty subscriber set to avoid leaking map entries.
  if (subs.size === 0) consoleSubs.delete(serverId);
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
      // Ensure the session stream is live (creates the buffer if running), then
      // replay the CURRENT runtime buffer to THIS socket only — this is the
      // reattach path: refresh / tab switch / re-navigation restores the logs of
      // the running session, while an offline server has no buffer (empty).
      await openConsoleStream(serverId); // emits console:status (online/offline) itself
      // If the stream was already live (another viewer), openConsoleStream
      // returned early without a status — tell this socket it's online.
      if (consoleStreams.get(serverId)) socket.emit('console:status', { serverId, online: true, reason: null, ts: Date.now() });
      replayBuffer(socket, serverId);
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
        // Self-heal the console stream: if a server has console subscribers but
        // no live stream (e.g. it just finished its start transition, or the
        // panel restarted while it kept running), (re)open it. openConsoleStream
        // is idempotent and only opens when the container is actually running.
        const consoleRoom = io.sockets.adapter.rooms.get(`console:${server.id}`);
        if (consoleRoom?.size && server.state === 'running' && !consoleStreams.get(server.id)) openConsoleStream(server.id);
      }
    } catch (err) {
      logger.warn('[ws] metrics heartbeat error: ' + err.message);
    }
  }, config.metricsInterval);

  logger.success('WebSocket layer initialised (real-time)');
  return io;
}

export default initSockets;
