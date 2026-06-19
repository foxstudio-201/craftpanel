/**
 * Tiny file-backed JSON store.
 *
 * This keeps the project dependency-light and instantly runnable (no external
 * database required). Data is loaded into memory and persisted to disk after
 * every mutation. Swap this module for a real database in production — every
 * controller depends only on the small API exposed here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'db.json');

const defaultData = {
  users: [],
  servers: [],
  players: [],
  plugins: [],
  backups: [],
  consoleLogs: {}, // keyed by serverId
  settings: {},
  databases: [],
  notifications: [],
  apiKeys: [],
  activityLogs: [],
  announcements: [],
  ips: [],
  schedules: [],
  domains: [],
  queueJobs: [],
  builds: [],       // static-site build jobs (logs, status, history)
  deployments: [],  // published build snapshots (for redeploy / rollback)
  ports: [],        // centralized port allocations { port, purpose, serverId, at }
  routes: [],       // cloudflared ingress routes proposed/managed by this panel
};

let data = structuredClone(defaultData);
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      data = { ...structuredClone(defaultData), ...JSON.parse(raw) };
    } else {
      persistNow();
    }
  } catch (err) {
    console.error('[store] failed to load db.json, starting fresh:', err.message);
    data = structuredClone(defaultData);
  }
}

function persistNow() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

/** Debounced persistence to avoid hammering disk under bursty writes. */
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 50);
}

load();

export const db = {
  get data() {
    return data;
  },
  /** Replace the whole dataset (used by the seeder). */
  set(next) {
    data = { ...structuredClone(defaultData), ...next };
    persistNow();
  },
  save,
  persistNow,
};

export default db;
