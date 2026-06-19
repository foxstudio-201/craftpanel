/**
 * Service-type registry — the single source of truth for the multi-service panel.
 *
 * Every service instance (the `servers` collection — kept generic) has a
 * `serviceType`: one of `minecraft | discord | node | python | static`. This
 * module describes, per type:
 *   - which management pages it exposes (the dynamic sidebar manifest), and
 *   - which features are available (rcon, players, plugins, databases, env,
 *     domains, ssl, a runtime version selector, a package manager).
 *
 * Backend controllers gate Minecraft-only behaviour on `feature(type, …)`
 * instead of ad-hoc `kind === 'service'` checks, and the frontend builds the
 * per-service sidebar + creation wizards from `publicRegistry()`.
 *
 * The substrate is unchanged: Minecraft is still provisioned by
 * minecraft.service.js (itzg) and the other types by service.catalog.js (yolks).
 */
import { SERVICES, isServiceType } from './service.catalog.js';

/** Page metadata: tab key → label + lucide icon. Shared by sidebar + router. */
export const PAGE_META = {
  overview:    { label: 'Overview',    icon: 'layout-dashboard' },
  console:     { label: 'Console',     icon: 'terminal' },
  files:       { label: 'Files',       icon: 'folder' },
  players:     { label: 'Players',     icon: 'users' },
  plugins:     { label: 'Plugins',     icon: 'puzzle' },
  databases:   { label: 'Databases',   icon: 'database' },
  environment: { label: 'Environment', icon: 'list' },
  startup:     { label: 'Startup',     icon: 'sliders-horizontal' },
  network:     { label: 'Network',     icon: 'network' },
  schedules:   { label: 'Schedules',   icon: 'clock' },
  backups:     { label: 'Backups',     icon: 'archive' },
  domains:     { label: 'Domains',     icon: 'globe' },
  ssl:         { label: 'SSL',         icon: 'lock' },
  build:       { label: 'Build',       icon: 'hammer' },
  activity:    { label: 'Activity',    icon: 'scroll-text' },
  settings:    { label: 'Settings',    icon: 'settings' },
};

const APP_PAGES = ['overview', 'console', 'files', 'environment', 'startup', 'network', 'schedules', 'backups', 'activity', 'settings'];

/**
 * Per-type definition. `features` are read by the backend gates and the frontend.
 * `packages` is the package-manager flavour (null when unsupported).
 * `versions` lists selectable runtime image tags (services); Minecraft fetches
 * its versions live from upstream instead.
 */
export const TYPES = {
  minecraft: {
    key: 'minecraft',
    label: 'Minecraft Server',
    icon: 'box',
    description: 'Vanilla, Paper, Purpur, Spigot, Fabric, Forge, NeoForge, Velocity & Waterfall.',
    pages: ['overview', 'console', 'files', 'players', 'plugins', 'databases', 'startup', 'network', 'schedules', 'backups', 'activity', 'settings'],
    features: { console: true, rcon: true, players: true, plugins: true, databases: true, environment: false, domains: false, ssl: false, versions: true, build: false, packages: null },
    defaults: { cpu: 2, ramMb: 4096, diskMb: 10240 },
  },
  discord: {
    key: 'discord',
    label: 'Discord Bot',
    icon: 'bot',
    description: 'Run a Discord bot 24/7 (Node.js or Python).',
    pages: APP_PAGES,
    features: { console: true, rcon: false, players: false, plugins: false, databases: true, environment: true, domains: false, ssl: false, versions: false, build: false, git: true, autoUpdate: true, packages: 'auto' },
    defaults: { cpu: 1, ramMb: 1024, diskMb: 5120 },
  },
  node: {
    key: 'node',
    label: 'Node.js App',
    icon: 'hexagon',
    description: 'Host an Express, Fastify or NestJS application.',
    pages: APP_PAGES,
    features: { console: true, rcon: false, players: false, plugins: false, databases: true, environment: true, domains: false, ssl: false, versions: true, build: false, packages: 'npm' },
    versions: [
      { key: 'nodejs_22', label: 'Node 22', image: 'ghcr.io/ptero-eggs/yolks:nodejs_22' },
      { key: 'nodejs_21', label: 'Node 21', image: 'ghcr.io/ptero-eggs/yolks:nodejs_21' },
      { key: 'nodejs_20', label: 'Node 20', image: 'ghcr.io/ptero-eggs/yolks:nodejs_20' },
      { key: 'nodejs_18', label: 'Node 18', image: 'ghcr.io/ptero-eggs/yolks:nodejs_18' },
    ],
    defaults: { cpu: 1, ramMb: 1024, diskMb: 5120 },
  },
  python: {
    key: 'python',
    label: 'Python App',
    icon: 'code',
    description: 'Host a Flask, FastAPI or Django application.',
    pages: APP_PAGES,
    features: { console: true, rcon: false, players: false, plugins: false, databases: true, environment: true, domains: false, ssl: false, versions: true, build: false, packages: 'pip' },
    versions: [
      { key: 'python_3.12', label: 'Python 3.12', image: 'ghcr.io/pterodactyl/yolks:python_3.12' },
      { key: 'python_3.11', label: 'Python 3.11', image: 'ghcr.io/pterodactyl/yolks:python_3.11' },
      { key: 'python_3.10', label: 'Python 3.10', image: 'ghcr.io/pterodactyl/yolks:python_3.10' },
    ],
    defaults: { cpu: 1, ramMb: 1024, diskMb: 5120 },
  },
  static: {
    key: 'static',
    label: 'Static Website',
    icon: 'globe',
    description: 'Serve a static site or SPA (HTML, React, Vue).',
    pages: ['overview', 'files', 'domains', 'ssl', 'build', 'network', 'activity', 'settings'],
    features: { console: false, rcon: false, players: false, plugins: false, databases: false, environment: true, domains: true, ssl: true, versions: false, build: true, publish: true, packages: null },
    defaults: { cpu: 0.5, ramMb: 512, diskMb: 2048 },
  },
};

/** The serviceType of a stored record (Minecraft records predate `serviceType`). */
export function typeOf(server) {
  if (server?.serviceType && TYPES[server.serviceType]) return server.serviceType;
  return 'minecraft';
}

export function definitionFor(type) {
  return TYPES[type] || TYPES.minecraft;
}

/** Ordered page (tab) keys for a service type. */
export function pagesFor(type) {
  return definitionFor(type).pages;
}

/** Whether a service type exposes a feature (false for unknown features). */
export function feature(type, name) {
  return Boolean(definitionFor(type).features?.[name]);
}

/** The raw feature value (e.g. the package-manager flavour string, or null). */
export function featureValue(type, name) {
  return definitionFor(type).features?.[name] ?? null;
}

export function defaultsFor(type) {
  return definitionFor(type).defaults;
}

/** Selectable runtime versions for a type (services only; [] for Minecraft). */
export function versionsFor(type) {
  return definitionFor(type).versions || [];
}

/** Resolve a runtime version key → image, for services with a version selector. */
export function imageForVersion(type, versionKey) {
  return versionsFor(type).find((v) => v.key === versionKey)?.image || null;
}

export const isManaged = (type) => Boolean(TYPES[type]);

/**
 * Frontend-safe registry: drives the dynamic sidebar, tab gating and the
 * per-type creation wizards. Includes the yolks template catalog per service
 * type (Minecraft software is served separately via /meta/software).
 */
export function publicRegistry() {
  const types = Object.values(TYPES).map((t) => ({
    key: t.key,
    label: t.label,
    icon: t.icon,
    description: t.description,
    pages: t.pages.map((key) => ({ key, ...PAGE_META[key] })),
    features: t.features,
    defaults: t.defaults,
    versions: t.versions || [],
    // Yolks templates for non-Minecraft types (Express/Flask/…); empty for Minecraft.
    templates: isServiceType(t.key)
      ? Object.values(SERVICES[t.key].templates).map((tpl) => ({
          key: tpl.key, label: tpl.label, image: tpl.image, startup: tpl.startup, env: tpl.env, envSchema: tpl.envSchema,
        }))
      : [],
  }));
  return { types, pageMeta: PAGE_META };
}
