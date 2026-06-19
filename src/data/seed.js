/**
 * Seeds the JSON metadata store with the default accounts and panel settings.
 *
 * Real servers are NOT seeded — they are created on demand through the panel
 * and provisioned as actual Docker containers. This keeps the install honest:
 * nothing on the dashboard is fake.
 *
 * Runs automatically at boot (see src/server.js) and via `npm run seed`.
 */
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from './store.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const now = () => new Date().toISOString();
const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString();

export async function seed({ force = false } = {}) {
  if (db.data.users.length > 0 && !force) return;

  logger.info('Seeding accounts & settings…');

  const [hash, modHash, userHash] = await Promise.all([
    bcrypt.hash(config.admin.password, config.bcryptRounds),
    bcrypt.hash('moderator123', config.bcryptRounds),
    bcrypt.hash('user12345', config.bcryptRounds),
  ]);

  const users = [
    { id: nanoid(12), username: config.admin.username, email: config.admin.email, password: hash, role: 'admin', avatar: null, bio: 'Owner & system administrator.', banned: false, createdAt: now(), lastLogin: now(), twoFactor: false },
    { id: nanoid(12), username: 'moderator', email: 'mod@craftpanel.local', password: modHash, role: 'moderator', avatar: null, bio: 'Keeping the servers friendly.', banned: false, createdAt: ago(60 * 24 * 12), lastLogin: ago(120), twoFactor: false },
    { id: nanoid(12), username: 'player_one', email: 'user@craftpanel.local', password: userHash, role: 'user', avatar: null, bio: 'Just here to play.', banned: false, createdAt: ago(60 * 24 * 4), lastLogin: ago(15), twoFactor: false },
  ];

  const settings = {
    general: { panelName: 'CraftPanel', language: 'en', timezone: 'UTC', defaultServerType: 'PAPER' },
    security: { twoFactorRequired: false, sessionTimeoutMins: 60, ipWhitelist: '', passwordMinLength: 8 },
    appearance: { theme: 'dark', accent: 'emerald', glass: true, animations: true },
    notifications: { email: true, browser: true, serverDown: true, highCpu: true, newLogin: true },
    api: { enabled: true, rateLimit: 300 },
  };

  db.set({
    users,
    servers: [],
    players: [],
    plugins: [],
    backups: [],
    databases: [],
    settings,
    notifications: [],
    apiKeys: [],
    activityLogs: [],
    announcements: [],
    consoleLogs: {},
  });

  logger.success(`Seed complete — admin login: ${config.admin.email} / ${config.admin.password}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ force: true }).then(() => process.exit(0));
}

export default seed;
