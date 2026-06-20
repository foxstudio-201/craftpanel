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

const list = (value, fallback = []) =>
  (value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : fallback);

// Dedicated workspace, isolated from Pterodactyl (/var/lib|/etc|/var/www/pterodactyl).
// Falls back to the in-project ./storage tree when the dedicated root is unset
// or not writable, so the panel still runs unprivileged.
const WORKSPACE = process.env.MULTIHOST_ROOT || '';
const workspacePath = (sub, projectDefault) => {
  if (!WORKSPACE) return path.resolve(ROOT_DIR, projectDefault);
  return path.join(WORKSPACE, sub);
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

  // Dedicated, isolated workspace root (empty = use in-project ./storage).
  workspaceRoot: WORKSPACE,
  filesRoot: process.env.FILES_ROOT ? path.resolve(ROOT_DIR, process.env.FILES_ROOT) : workspacePath('data', 'storage/servers'),
  metricsInterval: num(process.env.METRICS_INTERVAL, 2000),

  // ── Real infrastructure ────────────────────────────────────────────
  // Root directory that holds each service's data volume (<root>/<uuid>).
  volumesRoot: process.env.VOLUMES_ROOT ? path.resolve(ROOT_DIR, process.env.VOLUMES_ROOT) : workspacePath('services', 'storage/volumes'),
  backupsRoot: process.env.BACKUPS_ROOT ? path.resolve(ROOT_DIR, process.env.BACKUPS_ROOT) : workspacePath('backups', 'storage/backups'),

  docker: {
    socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    // Default Minecraft image (handles Vanilla/Paper/Purpur/Spigot/Fabric/Forge/NeoForge).
    image: process.env.MC_IMAGE || 'itzg/minecraft-server:latest',
    // Proxy image (Velocity/Waterfall/BungeeCord).
    proxyImage: process.env.MC_PROXY_IMAGE || 'itzg/mc-proxy:latest',
    // Project-dedicated bridge network — NEVER Pterodactyl's pterodactyl_nw.
    network: process.env.DOCKER_NETWORK || 'multihost_net',
    // Label stamped on every project-managed container/network for isolation.
    label: 'multihost.managed',
  },

  // Centralized port allocator — a dedicated pool kept clear of Pterodactyl.
  ports: {
    min: num(process.env.PORT_RANGE_MIN, 26000),
    max: num(process.env.PORT_RANGE_MAX, 26999),
    // Ports that must never be allocated (Pterodactyl Panel/Wings/SFTP/DB/Redis
    // + this panel + cloudflared). Extend via RESERVED_PORTS=comma,list.
    reserved: list(process.env.RESERVED_PORTS).map(Number).filter(Boolean),
  },

  // Network identity surfaced on the infrastructure page.
  network: {
    publicIp: process.env.PUBLIC_IP || '',
    internalIp: process.env.INTERNAL_IP || '',
    domain: process.env.DOMAIN || '',
    // Optional wildcard base domain for auto-generated subdomains (e.g. *.apps.example.com).
    baseDomain: process.env.BASE_DOMAIN || '',
  },

  // Cloudflare Tunnel integration. The panel READS the existing tunnel and, by
  // default, only PROPOSES merged ingress (never writes /etc or restarts the
  // service). Set CF_APPLY_MODE=sudo + install bin/cf-apply.sh to enable apply.
  cloudflared: {
    enabled: (process.env.CF_ENABLED ?? 'true') !== 'false',
    configPath: process.env.CF_CONFIG || '/etc/cloudflared/config.yml',
    tunnelId: process.env.CF_TUNNEL_ID || '',          // auto-read from config when blank
    service: process.env.CF_SERVICE || 'cloudflared',  // systemd unit name
    baseDomain: process.env.BASE_DOMAIN || '',         // e.g. voxelx.io.vn
    appsSubdomain: process.env.CF_APPS_SUBDOMAIN || 'apps', // *.apps.<baseDomain>
    applyMode: process.env.CF_APPLY_MODE || 'propose',  // 'propose' | 'sudo'
    applyHelper: process.env.CF_APPLY_HELPER || path.join(ROOT_DIR, 'bin', 'cf-apply.sh'),
    // Where the panel writes the proposed merged config (never /etc directly).
    proposedConfig: process.env.CF_PROPOSED || (WORKSPACE ? path.join(WORKSPACE, 'docker', 'cloudflared-desired.yml') : path.resolve(ROOT_DIR, 'storage/cloudflared-desired.yml')),
  },

  // Dedicated CraftPanel Cloudflare tunnels — fully ISOLATED from the Pterodactyl
  // /etc/cloudflared (pelican) tunnel. The panel OWNS these config files + user
  // systemd units, so it can add/remove per-service ingress and reload WITHOUT
  // sudo. dash.voxelx.io.vn fronts the panel; *-{id}.<baseDomain> front services
  // via a wildcard *.<baseDomain> DNS record. Pterodactyl is never touched here.
  servicesTunnel: {
    enabled: (process.env.SERVICES_TUNNEL_ENABLED ?? 'true') !== 'false',
    baseDomain: process.env.SERVICES_BASE_DOMAIN || 'voxelx.io.vn',
    // The voxelx-services tunnel config the panel rewrites + the user unit it reloads.
    configPath: process.env.SERVICES_TUNNEL_CONFIG || path.join(process.env.HOME || '/home/neo', '.cloudflared', 'voxelx-services.yml'),
    unit: process.env.SERVICES_TUNNEL_UNIT || 'voxelx-services-tunnel.service',
    dashUnit: process.env.DASH_TUNNEL_UNIT || 'voxelx-dash-tunnel.service',
    // Public IP for TCP-direct services (Minecraft): tunnels proxy HTTP only, so
    // mc-{id} is surfaced as a real publicIp:port endpoint, never a fake HTTPS route.
    publicIp: process.env.PUBLIC_IP || '',
    // serviceType -> public hostname prefix.
    prefixes: { discord: 'discord', node: 'node', python: 'python', static: 'web', minecraft: 'mc' },
  },

  // Caddy reverse proxy — DISABLED by default on this host: ports 80/443 are
  // owned by nginx (Pterodactyl Panel) and Wings. Ingress is via Cloudflare.
  caddy: {
    enabled: (process.env.CADDY_ENABLED ?? 'false') === 'true',
    image: process.env.CADDY_IMAGE || 'caddy:2',
    containerName: process.env.CADDY_CONTAINER || 'multihost-caddy',
    // Admin API the panel POSTs config to (published from the container).
    adminUrl: process.env.CADDY_ADMIN_URL || 'http://127.0.0.1:2019',
    adminBind: process.env.CADDY_ADMIN_BIND || '127.0.0.1', // host bind for :2019
    // Default to non-privileged ports so Caddy can NEVER collide with nginx(80)
    // or Wings(443) even if explicitly re-enabled on this host.
    httpPort: num(process.env.CADDY_HTTP_PORT, 8080),
    httpsPort: num(process.env.CADDY_HTTPS_PORT, 8443),
    // ACME contact for Let's Encrypt (optional but recommended in prod).
    acmeEmail: process.env.ACME_EMAIL || '',
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
