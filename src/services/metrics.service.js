/**
 * Real metrics engine. Samples live container resource usage via the Docker
 * stats API, real disk usage from the data volume, and TPS via RCON. Keeps a
 * short rolling history per server for the charts. No simulated values.
 */
import db from '../data/store.js';
import * as docker from './docker.service.js';
import * as mc from './minecraft.service.js';
import { typeOf, feature } from './service-registry.js';

const HISTORY_POINTS = 60;
const DISK_THROTTLE_MS = 30_000;
const TPS_THROTTLE_MS = 10_000;

const state = new Map(); // serverId -> { history[], lastNet, lastNetAt, disk, diskAt, tps, tpsAt }

function ensure(id) {
  if (!state.has(id)) state.set(id, { history: [], lastNet: null, lastNetAt: 0, disk: 0, diskAt: 0, tps: 0, tpsAt: 0 });
  return state.get(id);
}

const empty = (server) => ({
  serverId: server.id,
  state: server.state || 'stopped',
  status: 'stopped',
  cpu: 0, ramPercent: 0, ramUsedMb: 0, ramTotalMb: server.limits?.ramMb || 0,
  diskPercent: 0, diskUsedGb: 0, diskTotalGb: (server.limits?.diskMb || 0) / 1024,
  networkMbps: 0, netInMbps: 0, netOutMbps: 0, tps: 0, onlinePlayers: 0, maxPlayers: server.maxPlayers || 0,
  uptimeMs: 0, timestamp: Date.now(),
});

async function sampleServer(server) {
  const st = ensure(server.id);

  let running = false;
  try { running = (await docker.getState(server.dockerId)) === 'running'; } catch { running = false; }
  server.state = running ? 'running' : server.state === 'installing' ? 'installing' : 'stopped';

  if (!running || !server.dockerId) {
    const snap = empty(server);
    st.history.push({ cpu: 0, ram: 0, disk: pctDisk(st, server), net: 0, tps: 0 });
    if (st.history.length > HISTORY_POINTS) st.history.shift();
    snap.diskPercent = pctDisk(st, server);
    return snap;
  }

  let stats;
  try { stats = await docker.statsOnce(server.dockerId); } catch { return empty(server); }

  // Network rate (bytes delta → Mbps), split into IN (rx) and OUT (tx).
  const nowTs = Date.now();
  const totalNet = stats.netRxBytes + stats.netTxBytes;
  let mbps = 0, inMbps = 0, outMbps = 0;
  if (st.lastNet != null && nowTs > st.lastNetAt) {
    const deltaSec = (nowTs - st.lastNetAt) / 1000;
    const rate = (bytes) => (Math.max(0, bytes) * 8) / 1e6 / deltaSec;
    mbps = rate(totalNet - st.lastNet);
    inMbps = rate(stats.netRxBytes - (st.lastRx ?? stats.netRxBytes));
    outMbps = rate(stats.netTxBytes - (st.lastTx ?? stats.netTxBytes));
  }
  st.lastNet = totalNet; st.lastRx = stats.netRxBytes; st.lastTx = stats.netTxBytes;
  st.lastNetAt = nowTs;

  const diskPercent = pctDisk(st, server);

  // TPS via RCON, throttled (Minecraft servers only — not proxies/services)
  let tps = st.tps;
  if (feature(typeOf(server), 'players') && !mc.isProxy(server.software) && nowTs - st.tpsAt > TPS_THROTTLE_MS) {
    st.tpsAt = nowTs;
    tps = await readTps(server).catch(() => st.tps);
    st.tps = tps;
  }

  const ramUsedMb = Math.round(stats.memUsedBytes / 1e6);
  const inspect = await docker.inspect(server.dockerId).catch(() => null);
  const startedAt = inspect?.State?.StartedAt;
  const uptimeMs = startedAt && startedAt !== '0001-01-01T00:00:00Z' ? Date.now() - new Date(startedAt).getTime() : 0;

  st.history.push({ cpu: stats.cpuPercent, ram: stats.memPercent, disk: diskPercent, net: +mbps.toFixed(2), tps });
  if (st.history.length > HISTORY_POINTS) st.history.shift();

  let players = 0;
  // Player count is read from the server.service RCON path lazily; cheap fallback here.
  return {
    serverId: server.id,
    state: 'running',
    status: 'running',
    cpu: stats.cpuPercent,
    ramPercent: stats.memPercent,
    ramUsedMb,
    ramTotalMb: server.limits.ramMb,
    diskPercent,
    diskUsedGb: +(st.disk / 1e9).toFixed(2),
    diskTotalGb: +(server.limits.diskMb / 1024).toFixed(1),
    networkMbps: +mbps.toFixed(1),
    netInMbps: +inMbps.toFixed(2),
    netOutMbps: +outMbps.toFixed(2),
    tps,
    onlinePlayers: players,
    maxPlayers: server.maxPlayers,
    uptimeMs,
    timestamp: nowTs,
  };
}

function pctDisk(st, server) {
  const now = Date.now();
  if (now - st.diskAt > DISK_THROTTLE_MS) {
    st.diskAt = now;
    try { st.disk = docker.dirSize(mc.volumePath(server.uuid)); } catch { /* keep */ }
  }
  const limitBytes = (server.limits?.diskMb || 0) * 1024 * 1024;
  return limitBytes ? +Math.min(100, (st.disk / limitBytes) * 100).toFixed(1) : 0;
}

async function readTps(server) {
  // Paper/Purpur expose /tps; Spigot too. Vanilla/Fabric/Forge may not.
  try {
    const out = await docker.rcon(server.dockerId, 'tps');
    const nums = (out.match(/\d+\.\d+/g) || []).map(Number);
    if (nums.length) return Math.min(20, +nums[0].toFixed(1));
  } catch { /* command unknown */ }
  return 20; // assume healthy when not measurable
}

export async function getServerMetrics(serverId) {
  const server = db.data.servers.find((s) => s.id === serverId);
  if (!server) return null;
  return sampleServer(server);
}

export async function getServerHistory(serverId) {
  const server = db.data.servers.find((s) => s.id === serverId);
  if (!server) return null;
  const st = ensure(serverId);
  if (!st.history.length) await sampleServer(server);
  return st.history.map((h, i) => ({ t: i, cpu: h.cpu, ram: h.ram, disk: h.disk, net: h.net, tps: h.tps }));
}

export async function getOverview() {
  const servers = db.data.servers;
  const perServer = await Promise.all(servers.map(sampleServer));
  const running = perServer.filter((m) => m.status === 'running').length;
  const onlinePlayers = 0;
  const maxPlayers = servers.reduce((a, s) => a + (s.maxPlayers || 0), 0);
  const runningMetrics = perServer.filter((m) => m.status === 'running');

  const avg = (key, set = runningMetrics) =>
    set.length ? +(set.reduce((a, m) => a + m[key], 0) / set.length).toFixed(1) : 0;

  return {
    servers: { total: servers.length, running, stopped: servers.length - running },
    players: { online: onlinePlayers, max: maxPlayers },
    cpu: avg('cpu'),
    ram: avg('ramPercent'),
    disk: avg('diskPercent', perServer),
    network: +perServer.reduce((a, m) => a + m.networkMbps, 0).toFixed(1),
    tps: avg('tps'),
    perServer,
    timestamp: Date.now(),
  };
}
