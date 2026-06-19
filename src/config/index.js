import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    cookieName: process.env.JWT_COOKIE_NAME || 'craftpanel_token',
  },

  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 10),

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@craftpanel.local',
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin12345',
  },

  filesRoot: path.resolve(ROOT_DIR, process.env.FILES_ROOT || 'storage/servers'),
  metricsInterval: num(process.env.METRICS_INTERVAL, 2000),

  // ── Real infrastructure ────────────────────────────────────────────
  // Root directory that holds each server's data volume (<root>/<uuid>).
  volumesRoot: path.resolve(ROOT_DIR, process.env.VOLUMES_ROOT || 'storage/volumes'),

  docker: {
    socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    // Default Minecraft image (handles Vanilla/Paper/Purpur/Spigot/Fabric/Forge/NeoForge).
    image: process.env.MC_IMAGE || 'itzg/minecraft-server:latest',
    // Proxy image (Velocity/Waterfall/BungeeCord).
    proxyImage: process.env.MC_PROXY_IMAGE || 'itzg/mc-proxy:latest',
    // Containers join this user-defined bridge network (created on boot).
    network: process.env.DOCKER_NETWORK || 'craftpanel_net',
  },

  // Port pool handed out to new servers (avoids the host MC on 25565).
  ports: {
    min: num(process.env.PORT_RANGE_MIN, 25700),
    max: num(process.env.PORT_RANGE_MAX, 25799),
  },

  // Network identity surfaced on the infrastructure page.
  network: {
    publicIp: process.env.PUBLIC_IP || '',
    internalIp: process.env.INTERNAL_IP || '',
    domain: process.env.DOMAIN || '',
  },

  sftp: {
    enabled: (process.env.SFTP_ENABLED ?? 'true') !== 'false',
    host: process.env.SFTP_HOST || '0.0.0.0',
    port: num(process.env.SFTP_PORT, 2122),
    // Host shown to users for FileZilla/WinSCP (falls back to request host).
    publicHost: process.env.SFTP_PUBLIC_HOST || '',
  },

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: num(process.env.RATE_LIMIT_MAX, 300),
  },

  mysql: {
    host: process.env.MYSQL_HOST || '',
    port: num(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER || '',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || '',
  },
};

export default config;
