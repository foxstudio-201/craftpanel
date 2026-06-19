/**
 * Database hosting — provisions real MySQL / MariaDB / PostgreSQL instances as
 * Docker containers, each with its own data volume, credentials and host port.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { nanoid } from 'nanoid';

import config from '../config/index.js';
import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import * as docker from './docker.service.js';
import { logActivity } from './activity.service.js';

const DB_PORT_MIN = 33060;
const DB_PORT_MAX = 33159;
const dataRoot = path.resolve(config.volumesRoot, '..', 'databases');

export const ENGINES = {
  postgres: { label: 'PostgreSQL', image: 'postgres:16-alpine', port: 5432, dataDir: '/var/lib/postgresql/data',
    env: (c) => [`POSTGRES_PASSWORD=${c.password}`, `POSTGRES_USER=${c.username}`, `POSTGRES_DB=${c.name}`] },
  mysql: { label: 'MySQL', image: 'mysql:8.4', port: 3306, dataDir: '/var/lib/mysql',
    env: (c) => [`MYSQL_ROOT_PASSWORD=${c.rootPassword}`, `MYSQL_DATABASE=${c.name}`, `MYSQL_USER=${c.username}`, `MYSQL_PASSWORD=${c.password}`] },
  mariadb: { label: 'MariaDB', image: 'mariadb:11', port: 3306, dataDir: '/var/lib/mysql',
    env: (c) => [`MARIADB_ROOT_PASSWORD=${c.rootPassword}`, `MARIADB_DATABASE=${c.name}`, `MARIADB_USER=${c.username}`, `MARIADB_PASSWORD=${c.password}`] },
};

const pw = () => crypto.randomBytes(15).toString('base64url');

function isPortFree(port) {
  return new Promise((resolve) => {
    const t = net.createServer().once('error', () => resolve(false)).once('listening', () => t.close(() => resolve(true))).listen(port, '0.0.0.0');
  });
}
async function allocatePort() {
  const used = new Set(db.data.databases.map((d) => d.port).filter(Boolean));
  for (let p = DB_PORT_MIN; p <= DB_PORT_MAX; p++) { if (!used.has(p) && (await isPortFree(p))) return p; }
  throw ApiError.conflict('No free database ports available');
}

export function publicRecord(d) {
  const { rootPassword, ...safe } = d;
  return safe;
}

export async function createDatabase({ engine, name, ownerId, serverId = null }, actor) {
  const spec = ENGINES[engine];
  if (!spec) throw ApiError.badRequest('Unsupported engine');
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(name || '')) throw ApiError.badRequest('Invalid database name (letters, digits, underscore)');

  const uuid = crypto.randomUUID();
  const record = {
    id: nanoid(10), uuid, engine, name, ownerId, serverId,
    username: engine === 'postgres' ? (name || 'app') : 'app',
    password: pw(), rootPassword: pw(),
    host: config.network.internalIp || '127.0.0.1',
    port: await allocatePort(),
    dockerId: null, status: 'installing', createdAt: new Date().toISOString(),
  };

  const dataPath = path.join(dataRoot, uuid);
  fs.mkdirSync(dataPath, { recursive: true });

  await docker.ensureImage(spec.image);
  const d = docker.getDocker();
  const container = await d.createContainer({
    name: `cpdb-${uuid}`,
    Image: spec.image,
    Env: spec.env(record),
    ExposedPorts: { [`${spec.port}/tcp`]: {} },
    HostConfig: {
      Binds: [`${dataPath}:${spec.dataDir}`],
      PortBindings: { [`${spec.port}/tcp`]: [{ HostPort: String(record.port) }] },
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 1024 * 1024 * 1024,
    },
    Labels: { 'multihost.managed': 'true', 'multihost.type': 'database', 'multihost.uuid': uuid },
  });
  await container.start();

  record.dockerId = container.id;
  record.status = 'running';
  db.data.databases.push(record);
  db.save();
  logActivity('database.create', { actor, target: name, meta: { engine } });
  return record;
}

export async function syncStatus(record) {
  try { record.status = await docker.getState(record.dockerId); } catch { record.status = 'unknown'; }
  return record.status;
}

export async function power(record, action) {
  if (action === 'start') await docker.start(record.dockerId);
  else if (action === 'stop') await docker.stop(record.dockerId, 10);
  else if (action === 'restart') await docker.restart(record.dockerId, 10);
  else throw ApiError.badRequest('Invalid action');
  await syncStatus(record);
  db.save();
}

export async function deleteDatabase(record) {
  if (record.dockerId) await docker.remove(record.dockerId, { force: true });
  await fs.promises.rm(path.join(dataRoot, record.uuid), { recursive: true, force: true }).catch(() => {});
  db.data.databases = db.data.databases.filter((d) => d.id !== record.id);
  db.save();
}

export function connectionString(d) {
  if (d.engine === 'postgres') return `postgresql://${d.username}:${d.password}@${d.host}:${d.port}/${d.name}`;
  return `mysql://${d.username}:${d.password}@${d.host}:${d.port}/${d.name}`;
}
