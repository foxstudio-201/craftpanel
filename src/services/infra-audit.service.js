/**
 * Infrastructure audit aggregator — real, live picture of the host for the
 * admin Infrastructure page. Read-only: it never mutates Docker, cloudflared or
 * Pterodactyl. It classifies every resource as "project" (ours), "pterodactyl"
 * (reserved) or "system" so the UI can show isolation + conflicts at a glance.
 */
import config from '../config/index.js';
import db from '../data/store.js';
import * as docker from './docker.service.js';
import * as ports from './ports.service.js';
import * as cloudflared from './cloudflared.service.js';

const PTERO_NET = 'pterodactyl_nw';
const isProjectContainer = (labels = {}) => labels['multihost.managed'] === 'true';

async function dockerAudit() {
  const d = docker.getDocker();
  const out = { available: false, networks: [], volumes: [], containers: { project: [], pterodactyl: [], other: 0 } };
  try {
    if (!(await docker.isAvailable())) return out;
    out.available = true;

    const nets = await d.listNetworks();
    out.networks = nets.map((n) => ({
      name: n.Name, driver: n.Driver,
      owner: n.Name === config.docker.network ? 'project' : (n.Name === PTERO_NET ? 'pterodactyl' : 'system'),
    }));

    try { const vols = await d.listVolumes(); out.volumes = (vols.Volumes || []).map((v) => ({ name: v.Name, driver: v.Driver })); } catch { /* */ }

    const containers = await d.listContainers({ all: true });
    for (const c of containers) {
      const labels = c.Labels || {};
      const rec = {
        name: (c.Names?.[0] || '').replace(/^\//, ''),
        image: c.Image, state: c.State, status: c.Status,
        ports: (c.Ports || []).filter((p) => p.PublicPort).map((p) => `${p.PublicPort}->${p.PrivatePort}/${p.Type}`),
        networks: Object.keys(c.NetworkSettings?.Networks || {}),
      };
      if (isProjectContainer(labels)) out.containers.project.push(rec);
      else if (rec.networks.includes(PTERO_NET) || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(rec.name)) out.containers.pterodactyl.push(rec);
      else out.containers.other++;
    }
  } catch { /* docker error — degrade gracefully */ }
  return out;
}

async function portAudit() {
  const scan = await ports.scan();
  return {
    pool: { min: config.ports.min, max: config.ports.max },
    reserved: ports.reservedPorts(),
    occupied: { os: [...scan.os].sort((a, b) => a - b), docker: [...scan.docker].sort((a, b) => a - b) },
    projectAllocations: db.data.ports || [],
    conflicts: await ports.conflicts(),
  };
}

async function tunnelAudit() {
  const status = await cloudflared.status();
  const existing = cloudflared.parseIngress();
  const ours = new Set(cloudflared.projectRoutes().map((r) => r.hostname));
  const routes = existing.map((e) => ({
    hostname: e.hostname || '(catch-all)',
    service: e.service,
    owner: e.hostname && ours.has(e.hostname) ? 'project' : 'pterodactyl/existing',
  }));
  const diff = cloudflared.diff();
  return {
    status,
    baseDomain: config.cloudflared.baseDomain,
    appsSubdomain: config.cloudflared.appsSubdomain,
    applyMode: config.cloudflared.applyMode,
    existingRoutes: routes,
    projectRoutes: cloudflared.projectRoutes(),
    pendingChanges: !!diff.changed,
  };
}

/** Full audit payload for GET /infra/audit. */
export async function fullAudit() {
  const [dockerInfo, portInfo, tunnel] = await Promise.all([dockerAudit(), portAudit(), tunnelAudit()]);
  return {
    workspace: { root: config.workspaceRoot || '(project ./storage)', volumes: config.volumesRoot, backups: config.backupsRoot, sftpPort: config.sftp.port },
    docker: dockerInfo,
    ports: portInfo,
    tunnel,
    reserved: {
      ports: ports.reservedPorts(),
      networks: [PTERO_NET],
      note: 'Pterodactyl Panel/Wings/cloudflared resources are reserved and never modified.',
    },
    generatedAt: new Date().toISOString(),
  };
}
