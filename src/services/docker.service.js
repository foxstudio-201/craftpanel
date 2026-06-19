/**
 * Docker engine service — the real container backend for CraftPanel.
 *
 * Every server lifecycle action ultimately calls into this module, which talks
 * to the local Docker daemon over its UNIX socket via dockerode. There is no
 * simulation here: containers are created, started, stopped and inspected for
 * real, and console/stats stream straight from the engine.
 */
import Docker from 'dockerode';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import config from '../config/index.js';
import logger from '../utils/logger.js';
import ApiError from '../utils/ApiError.js';

let docker = null;

export function getDocker() {
  if (!docker) docker = new Docker({ socketPath: config.docker.socketPath });
  return docker;
}

/** True if the daemon is reachable. */
export async function isAvailable() {
  try {
    await getDocker().ping();
    return true;
  } catch {
    return false;
  }
}

export async function engineInfo() {
  const d = getDocker();
  const [info, version] = await Promise.all([d.info(), d.version()]);
  return {
    available: true,
    serverVersion: info.ServerVersion,
    apiVersion: version.ApiVersion,
    os: info.OperatingSystem,
    kernel: info.KernelVersion,
    cpus: info.NCPU,
    memoryBytes: info.MemTotal,
    containers: info.Containers,
    containersRunning: info.ContainersRunning,
    images: info.Images,
    driver: info.Driver,
  };
}

/** Ensure the panel's user-defined bridge network exists. */
export async function ensureNetwork() {
  const d = getDocker();
  const name = config.docker.network;
  const nets = await d.listNetworks({ filters: { name: [name] } });
  if (nets.find((n) => n.Name === name)) return name;
  await d.createNetwork({ Name: name, Driver: 'bridge', CheckDuplicate: true });
  logger.success(`Created docker network ${name}`);
  return name;
}

/** Pull an image if it is not already present. onProgress(statusLine). */
export async function ensureImage(image, onProgress) {
  const d = getDocker();
  try {
    await d.getImage(image).inspect();
    return; // already present
  } catch {
    /* needs pull */
  }
  logger.info(`Pulling image ${image}…`);
  await new Promise((resolve, reject) => {
    d.pull(image, (err, stream) => {
      if (err) return reject(err);
      d.modem.followProgress(
        stream,
        (e) => (e ? reject(e) : resolve()),
        (ev) => {
          if (onProgress && ev.status) {
            onProgress(`${ev.status}${ev.progress ? ' ' + ev.progress : ''}`);
          }
        }
      );
    });
  });
  logger.success(`Image ready: ${image}`);
}

/**
 * Create a container.
 * @param {object} o
 * @param {string} o.name        container name (server uuid)
 * @param {string} o.image
 * @param {string[]} o.env       ["KEY=value", ...]
 * @param {string} o.volumePath  host dir bind-mounted at /data
 * @param {Array<{container:number, host:number, proto?:string}>} o.ports
 * @param {number} o.cpus        CPU core limit (e.g. 2)
 * @param {number} o.memoryMb    RAM hard limit
 */
export async function createContainer(o) {
  const d = getDocker();
  fs.mkdirSync(o.volumePath, { recursive: true });

  const exposed = {};
  const bindings = {};
  for (const p of o.ports || []) {
    const proto = p.proto || 'tcp';
    const key = `${p.container}/${proto}`;
    exposed[key] = {};
    bindings[key] = [{ HostPort: String(p.host) }];
  }

  const hostConfig = {
    Binds: [`${o.volumePath}:${o.mountPath || '/data'}`],
    PortBindings: bindings,
    RestartPolicy: { Name: 'no' },
    Memory: Math.round((o.memoryMb || 1024) * 1024 * 1024),
    MemorySwap: Math.round((o.memoryMb || 1024) * 1024 * 1024), // disable swap growth
    NanoCpus: Math.round((o.cpus || 1) * 1e9),
    OomKillDisable: false,
  };

  const container = await d.createContainer({
    name: o.name,
    Image: o.image,
    Hostname: o.name.slice(0, 12),
    Tty: true, // raw, un-multiplexed log stream for the console
    OpenStdin: true,
    Env: o.env || [],
    ExposedPorts: exposed,
    HostConfig: hostConfig,
    Labels: { 'multihost.managed': 'true', 'multihost.uuid': o.name, ...(o.labels || {}) },
  });

  // Attach to the panel's user-defined network (best-effort).
  try {
    await getDocker().getNetwork(config.docker.network).connect({ Container: container.id });
  } catch {
    /* network optional */
  }

  return container.id;
}

function getContainer(id) {
  return getDocker().getContainer(id);
}

/** Normalised state: 'running' | 'restarting' | 'exited' | 'created' | 'paused' | 'missing'. */
export async function getState(id) {
  if (!id) return 'missing';
  try {
    const data = await getContainer(id).inspect();
    return data.State.Status;
  } catch (err) {
    if (err.statusCode === 404) return 'missing';
    throw err;
  }
}

export async function inspect(id) {
  try {
    return await getContainer(id).inspect();
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

export async function start(id) {
  await getContainer(id).start().catch((e) => {
    if (e.statusCode !== 304) throw e; // 304 = already started
  });
}

/** Graceful stop. itzg traps SIGTERM and saves the world. */
export async function stop(id, timeoutSec = 30) {
  await getContainer(id).stop({ t: timeoutSec }).catch((e) => {
    if (e.statusCode !== 304 && e.statusCode !== 404) throw e;
  });
}

export async function restart(id, timeoutSec = 30) {
  await getContainer(id).restart({ t: timeoutSec });
}

export async function kill(id) {
  await getContainer(id).kill().catch((e) => {
    if (e.statusCode !== 409 && e.statusCode !== 404) throw e; // 409 = not running
  });
}

export async function remove(id, { force = true } = {}) {
  if (!id) return;
  await getContainer(id).remove({ force, v: false }).catch((e) => {
    if (e.statusCode !== 404) throw e;
  });
}

/**
 * Live log stream. With Tty:true the stream is raw text (no 8-byte framing).
 * Returns the stream so callers can pipe/destroy it.
 */
export async function logStream(id, { tail = 200, onLine, onRaw } = {}) {
  const container = getContainer(id);
  const stream = await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
  });

  let buffer = '';
  stream.on('data', (chunk) => {
    if (onRaw) onRaw(chunk);
    if (onLine) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) onLine(line);
    }
  });
  return stream;
}

/** Fetch recent logs as an array of lines (non-following). */
export async function getRecentLogs(id, tail = 200) {
  const container = getContainer(id);
  const buf = await container.logs({ follow: false, stdout: true, stderr: true, tail, timestamps: false });
  return buf.toString('utf8').split('\n').filter(Boolean);
}

/**
 * Execute a command inside the container and return its combined output.
 * Used for `rcon-cli` (console commands) and shell utilities (zip/unzip/du).
 */
export async function exec(id, cmd, { timeoutMs = 20000 } = {}) {
  const container = getContainer(id);
  const e = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await e.start({ hijack: true, stdin: false });

  return await new Promise((resolve, reject) => {
    const out = new PassThrough();
    const err = new PassThrough();
    let stdout = '';
    let stderr = '';
    out.on('data', (d) => (stdout += d.toString('utf8')));
    err.on('data', (d) => (stderr += d.toString('utf8')));
    getDocker().modem.demuxStream(stream, out, err);

    const timer = setTimeout(() => { stream.destroy(); reject(new ApiError(504, 'Command timed out')); }, timeoutMs);
    stream.on('end', async () => {
      clearTimeout(timer);
      const info = await e.inspect().catch(() => ({}));
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: info.ExitCode ?? 0 });
    });
    stream.on('error', (er) => { clearTimeout(timer); reject(er); });
  });
}

/**
 * Streaming exec: runs a command inside the container and invokes onLine for
 * each output line as it arrives. Returns { done, destroy } where done resolves
 * with the real exit code. Used by the build/publish system for live logs.
 */
export async function execStream(id, cmd, { onLine } = {}) {
  const container = getContainer(id);
  const e = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false });
  const stream = await e.start({ hijack: true, stdin: false });

  const out = new PassThrough();
  const err = new PassThrough();
  let bufO = '', bufE = '';
  const pump = (buf, chunk, tag) => {
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    const rest = lines.pop();
    for (const line of lines) onLine?.(line, tag);
    return rest;
  };
  out.on('data', (d) => { bufO = pump(bufO, d, 'stdout'); });
  err.on('data', (d) => { bufE = pump(bufE, d, 'stderr'); });
  getDocker().modem.demuxStream(stream, out, err);

  const done = new Promise((resolve, reject) => {
    stream.on('end', async () => {
      if (bufO) onLine?.(bufO, 'stdout');
      if (bufE) onLine?.(bufE, 'stderr');
      const info = await e.inspect().catch(() => ({}));
      resolve({ exitCode: info.ExitCode ?? 0 });
    });
    stream.on('error', reject);
  });

  return { done, destroy: () => { try { stream.destroy(); } catch { /* ignore */ } } };
}

/** Write a line to the container's stdin (used for proxy consoles without RCON). */
export async function writeStdin(id, text) {
  const container = getContainer(id);
  const stream = await container.attach({ stream: true, stdin: true, stdout: false, stderr: false, hijack: true });
  stream.write(text.endsWith('\n') ? text : text + '\n');
  stream.end();
}

/** Send a command to the Minecraft server via the container's rcon-cli. */
export async function rcon(id, command) {
  const { stdout, stderr, exitCode } = await exec(id, ['rcon-cli', command]);
  if (exitCode !== 0 && stderr) throw new ApiError(502, `RCON error: ${stderr}`);
  return stdout || stderr;
}

/** One-shot resource stats (CPU %, memory, network). */
export async function statsOnce(id) {
  const container = getContainer(id);
  const s = await container.stats({ stream: false });

  // CPU percentage relative to the whole host (Docker formula).
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats.cpu_usage?.total_usage || 0);
  const sysDelta = s.cpu_stats.system_cpu_usage - (s.precpu_stats.system_cpu_usage || 0);
  const cores = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cores * 100 : 0;

  const memUsed = (s.memory_stats.usage || 0) - (s.memory_stats.stats?.inactive_file || 0);
  const memLimit = s.memory_stats.limit || 0;

  let rx = 0, tx = 0;
  for (const net of Object.values(s.networks || {})) {
    rx += net.rx_bytes || 0;
    tx += net.tx_bytes || 0;
  }

  return {
    cpuPercent: +cpuPercent.toFixed(1),
    memUsedBytes: memUsed,
    memLimitBytes: memLimit,
    memPercent: memLimit ? +((memUsed / memLimit) * 100).toFixed(1) : 0,
    netRxBytes: rx,
    netTxBytes: tx,
  };
}

/** Directory size in bytes (used for real disk usage). */
export function dirSize(dir) {
  let total = 0;
  const walk = (p) => {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(p, e.name);
      try {
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) total += fs.statSync(full).size;
      } catch { /* ignore races */ }
    }
  };
  walk(dir);
  return total;
}

/** List all project-managed containers (admin/infra views). */
export async function listManaged() {
  const d = getDocker();
  const containers = await d.listContainers({ all: true, filters: { label: ['multihost.managed=true'] } });
  return containers.map((c) => ({
    id: c.Id,
    uuid: c.Labels['multihost.uuid'] || c.Labels['multihost.serviceId'],
    state: c.State,
    status: c.Status,
    image: c.Image,
  }));
}

export default {
  getDocker, isAvailable, engineInfo, ensureNetwork, ensureImage, createContainer,
  getState, inspect, start, stop, restart, kill, remove, logStream, getRecentLogs,
  exec, rcon, writeStdin, statsOnce, dirSize, listManaged,
};
