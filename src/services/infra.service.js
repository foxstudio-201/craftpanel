/**
 * Infrastructure status — real host (node) metrics, Docker engine status and
 * network identity surfaced on the admin infrastructure page.
 */
import os from 'node:os';
import fs from 'node:fs';

import config from '../config/index.js';
import db from '../data/store.js';
import * as docker from './docker.service.js';
import * as caddy from './caddy.service.js';

function diskUsage(dir) {
  try {
    const s = fs.statfsSync(dir);
    const total = s.blocks * s.bsize;
    const free = s.bfree * s.bsize;
    return { totalBytes: total, freeBytes: free, usedBytes: total - free, percent: total ? +(((total - free) / total) * 100).toFixed(1) : 0 };
  } catch {
    return { totalBytes: 0, freeBytes: 0, usedBytes: 0, percent: 0 };
  }
}

export function getNodeStatus() {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disk = diskUsage(config.volumesRoot);

  // Sum of resources allocated to servers (over-commit visibility).
  const allocatedCpu = db.data.servers.reduce((a, s) => a + (s.limits?.cpu || 0), 0);
  const allocatedRamMb = db.data.servers.reduce((a, s) => a + (s.limits?.ramMb || 0), 0);
  const allocatedDiskMb = db.data.servers.reduce((a, s) => a + (s.limits?.diskMb || 0), 0);

  return {
    name: os.hostname(),
    status: 'online',
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptimeSec: os.uptime(),
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model?.trim() || 'unknown',
      load1: +load[0].toFixed(2),
      loadPercent: +Math.min(100, (load[0] / cpus.length) * 100).toFixed(1),
    },
    memory: {
      totalBytes: totalMem, freeBytes: freeMem, usedBytes: totalMem - freeMem,
      percent: +(((totalMem - freeMem) / totalMem) * 100).toFixed(1),
    },
    disk,
    allocated: { cpu: allocatedCpu, ramMb: allocatedRamMb, diskMb: allocatedDiskMb, servers: db.data.servers.length },
  };
}

export async function getDockerStatus() {
  if (!(await docker.isAvailable())) {
    return { available: false, message: 'Docker daemon is not reachable' };
  }
  const info = await docker.engineInfo();
  const managed = await docker.listManaged();
  return { ...info, managed };
}

export function getNetworkIdentity() {
  const ifaces = os.networkInterfaces();
  let internal = config.network.internalIp;
  if (!internal) {
    for (const list of Object.values(ifaces)) {
      for (const i of list || []) {
        if (i.family === 'IPv4' && !i.internal) { internal = i.address; break; }
      }
      if (internal) break;
    }
  }
  return {
    publicIp: config.network.publicIp || null,
    internalIp: internal || '127.0.0.1',
    domain: config.network.domain || null,
  };
}

export function getAllocations() {
  return db.data.servers.map((s) => ({
    serverId: s.id, server: s.name, ip: s.allocation?.ip, port: s.allocation?.port, software: s.software,
  }));
}

export async function getOverview() {
  const node = getNodeStatus();
  const dockerStatus = await getDockerStatus().catch((e) => ({ available: false, message: e.message }));
  const caddyStatus = await caddy.status().catch(() => ({ enabled: false }));
  return {
    node,
    docker: dockerStatus,
    network: getNetworkIdentity(),
    proxy: caddyStatus,
    sftp: { enabled: config.sftp.enabled, host: config.sftp.publicHost || getNetworkIdentity().internalIp, port: config.sftp.port, status: config.sftp.enabled ? 'online' : 'disabled' },
    ports: { range: `${config.ports.min}-${config.ports.max}`, allocated: getAllocations() },
  };
}
