/**
 * Minecraft service — translates a CraftPanel server record into a real
 * container configuration for the itzg images, and fetches real, selectable
 * versions from official upstream APIs (the "resource installer").
 *
 * itzg/minecraft-server downloads the chosen server jar from the official
 * source at container start based on TYPE + VERSION, so no jar is bundled or
 * faked here — the installer is genuinely live.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import net from 'node:net';

import config from '../config/index.js';
import db from '../data/store.js';
import logger from '../utils/logger.js';
import ApiError from '../utils/ApiError.js';

/** Supported server software, mapped to itzg image + TYPE. */
export const SOFTWARE = {
  VANILLA:  { label: 'Vanilla',  kind: 'server', image: config.docker.image,      type: 'VANILLA' },
  PAPER:    { label: 'Paper',    kind: 'server', image: config.docker.image,      type: 'PAPER' },
  PURPUR:   { label: 'Purpur',   kind: 'server', image: config.docker.image,      type: 'PURPUR' },
  SPIGOT:   { label: 'Spigot',   kind: 'server', image: config.docker.image,      type: 'SPIGOT' },
  FABRIC:   { label: 'Fabric',   kind: 'server', image: config.docker.image,      type: 'FABRIC' },
  FORGE:    { label: 'Forge',    kind: 'server', image: config.docker.image,      type: 'FORGE' },
  NEOFORGE: { label: 'NeoForge', kind: 'server', image: config.docker.image,      type: 'NEOFORGE' },
  VELOCITY: { label: 'Velocity', kind: 'proxy',  image: config.docker.proxyImage, type: 'VELOCITY' },
  WATERFALL:{ label: 'Waterfall',kind: 'proxy',  image: config.docker.proxyImage, type: 'WATERFALL' },
};

export const isProxy = (software) => SOFTWARE[software]?.kind === 'proxy';

const newPassword = () => crypto.randomBytes(18).toString('base64url');

export const volumePath = (uuid) => path.join(config.volumesRoot, uuid);

/** Build the itzg environment array for a server record. */
export function buildEnv(server) {
  const sw = SOFTWARE[server.software];
  if (!sw) throw ApiError.badRequest(`Unknown software: ${server.software}`);

  if (sw.kind === 'proxy') {
    return [
      `TYPE=${sw.type}`,
      'DEBUG=false',
      // proxy listens on 25577 by default inside the image
    ];
  }

  const heap = Math.max(512, (server.limits?.ramMb || 1024) - 512);
  const env = [
    'EULA=TRUE',
    `TYPE=${sw.type}`,
    server.version ? `VERSION=${server.version}` : 'VERSION=LATEST',
    `MAX_MEMORY=${heap}M`,
    `INIT_MEMORY=${Math.min(heap, 512)}M`,
    'ENABLE_RCON=TRUE',
    `RCON_PASSWORD=${server.rconPassword}`,
    'RCON_PORT=25575',
    'SERVER_PORT=25565',
    `MAX_PLAYERS=${server.maxPlayers || 20}`,
    `MOTD=${server.motd || 'A CraftPanel server'}`,
    `DIFFICULTY=${server.difficulty || 'normal'}`,
    `MODE=${server.gamemode || 'survival'}`,
    'ENABLE_AUTOPAUSE=FALSE',
    'STOP_SERVER_ANNOUNCE_DELAY=5',
    `ONLINE_MODE=${server.onlineMode === false ? 'FALSE' : 'TRUE'}`,
    'OVERRIDE_SERVER_PROPERTIES=TRUE',
    // Sync container UID with the panel process so the file manager + SFTP can
    // read/write the same files without permission clashes.
    `UID=${process.getuid?.() ?? 1000}`,
    `GID=${process.getgid?.() ?? 1000}`,
  ];
  for (const [k, v] of Object.entries(server.env || {})) env.push(`${k}=${v}`);
  return env;
}

/** Container create options for docker.service.createContainer. */
export function containerOptions(server) {
  const sw = SOFTWARE[server.software];
  const internalPort = sw.kind === 'proxy' ? 25577 : 25565;
  return {
    name: server.uuid,
    image: sw.image,
    env: buildEnv(server),
    volumePath: volumePath(server.uuid),
    ports: [{ container: internalPort, host: server.allocation.port, proto: 'tcp' }],
    cpus: server.limits.cpu,
    memoryMb: server.limits.ramMb,
  };
}

export function generateServerDefaults() {
  return { rconPassword: newPassword(), rconPort: 25575 };
}

/** Find a free host port within the configured pool (not used by a server or the OS). */
export async function allocatePort() {
  const used = new Set(db.data.servers.map((s) => s.allocation?.port).filter(Boolean));
  for (let p = config.ports.min; p <= config.ports.max; p++) {
    if (used.has(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw ApiError.conflict('No free ports available in the configured range');
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '0.0.0.0');
  });
}

// ── Version installer: real upstream sources, cached ──────────────────
const cache = new Map(); // software -> { at, versions }
const CACHE_MS = 60 * 60 * 1000;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CraftPanel' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function vanillaVersions() {
  const data = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  return data.versions.filter((v) => v.type === 'release').map((v) => v.id);
}
async function paperVersions() {
  const data = await fetchJson('https://api.papermc.io/v2/projects/paper');
  return [...data.versions].reverse();
}
async function purpurVersions() {
  const data = await fetchJson('https://api.purpurmc.org/v2/purpur');
  return [...data.versions].reverse();
}
async function fabricVersions() {
  const data = await fetchJson('https://meta.fabricmc.net/v2/versions/game');
  return data.filter((v) => v.stable).map((v) => v.version);
}
async function waterfallVersions() {
  const data = await fetchJson('https://api.papermc.io/v2/projects/waterfall');
  return [...data.versions].reverse();
}
async function velocityVersions() {
  const data = await fetchJson('https://api.papermc.io/v2/projects/velocity');
  return [...data.versions].reverse();
}

const SOURCES = {
  VANILLA: vanillaVersions,
  PAPER: paperVersions,
  PURPUR: purpurVersions,
  SPIGOT: vanillaVersions,   // BuildTools targets MC versions
  FABRIC: fabricVersions,
  FORGE: vanillaVersions,    // itzg resolves the Forge build for the MC version
  NEOFORGE: vanillaVersions,
  VELOCITY: velocityVersions,
  WATERFALL: waterfallVersions,
};

/** Return selectable versions for a software, newest first. Falls back to LATEST. */
export async function getVersions(software) {
  const sw = SOFTWARE[software];
  if (!sw) throw ApiError.badRequest(`Unknown software: ${software}`);

  const cached = cache.get(software);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.versions;

  try {
    const list = await SOURCES[software]();
    const versions = ['LATEST', ...list].slice(0, 60);
    cache.set(software, { at: Date.now(), versions });
    return versions;
  } catch (err) {
    logger.warn(`Version fetch failed for ${software}: ${err.message}`);
    return ['LATEST'];
  }
}

export function softwareCatalog() {
  return Object.entries(SOFTWARE).map(([key, v]) => ({ key, label: v.label, kind: v.kind }));
}
