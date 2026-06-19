/**
 * Generic service catalog — the non-Minecraft hosting types deployed on the
 * Pterodactyl "yolks" runtime images (already present on the host).
 *
 * Each service runs the user's code from /home/container via the yolks
 * entrypoint, which evaluates the STARTUP env var ({{VAR}} → ${VAR}). The
 * startup commands for the Discord templates are used VERBATIM as required.
 *
 * Minecraft remains handled by minecraft.service.js (itzg). This module only
 * covers: discord, node, python, static.
 */

// Runtime images (yolks) — node & python are cached on the host.
const NODE_IMAGE = process.env.NODE_IMAGE || 'ghcr.io/ptero-eggs/yolks:nodejs_21';
const PYTHON_IMAGE = process.env.PYTHON_IMAGE || 'ghcr.io/pterodactyl/yolks:python_3.11';
const STATIC_IMAGE = process.env.STATIC_IMAGE || 'ghcr.io/ptero-eggs/yolks:nodejs_21';

// ── Verbatim startup commands (do NOT modify) ─────────────────────────
const NODE_DISCORD_STARTUP =
  'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; if [[ "${MAIN_FILE}" == "*.js" ]]; then /usr/local/bin/node "/home/container/${MAIN_FILE}" ${NODE_ARGS}; else /usr/local/bin/ts-node --esm "/home/container/${MAIN_FILE}" ${NODE_ARGS}; fi';

const PYTHON_DISCORD_STARTUP =
  'if [[ -d .git ]] && [[ "{{AUTO_UPDATE}}" == "1" ]]; then git pull; fi; if [[ ! -z "{{PY_PACKAGES}}" ]]; then pip install -U --prefix .local {{PY_PACKAGES}}; fi; if [[ -f /home/container/${REQUIREMENTS_FILE} ]]; then pip install -U --prefix .local -r ${REQUIREMENTS_FILE}; fi; /usr/local/bin/python /home/container/{{PY_FILE}}';

// Reusable package-install snippets (honour the NODE_PACKAGES / PY_PACKAGES env
// var managed from the Environment page — real npm/pip install on (re)install).
const NODE_PKG_INSTALL = 'if [[ ! -z "${NODE_PACKAGES}" ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi;';
const PY_PKG_INSTALL = 'if [[ ! -z "${PY_PACKAGES}" ]]; then pip install -U --prefix .local ${PY_PACKAGES}; fi;';

// Generic app startups (sensible, real defaults; fully editable on create).
const NODE_APP_STARTUP =
  `${NODE_PKG_INSTALL} if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/node /home/container/\${MAIN_FILE}`;
const PYTHON_APP_STARTUP =
  `${PY_PKG_INSTALL} if [[ -f /home/container/\${REQUIREMENTS_FILE} ]]; then pip install -U --prefix .local -r \${REQUIREMENTS_FILE}; fi; /usr/local/bin/python /home/container/\${PY_FILE}`;
const STATIC_STARTUP =
  'if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; if [ ! -z "${BUILD_CMD}" ]; then eval ${BUILD_CMD}; fi; /usr/local/bin/npx --yes serve -s ${SERVE_DIR} -l ${SERVER_PORT}';

/**
 * A template = { key, label, image, startup, env (defaults), internalPort }.
 * env values may reference startup placeholders; users can edit on deploy.
 */
export const SERVICES = {
  discord: {
    key: 'discord',
    label: 'Discord Bot',
    icon: 'bot',
    kind: 'service',
    description: 'Run a Discord bot 24/7 (Node.js or Python).',
    // Discord bots make outbound connections only — no inbound port needed,
    // but we still allocate one for parity/health. internalPort optional.
    needsPort: false,
    templates: {
      'node': {
        key: 'node', label: 'Node.js', image: NODE_IMAGE, startup: NODE_DISCORD_STARTUP,
        env: { AUTO_UPDATE: '0', NODE_PACKAGES: '', UNNODE_PACKAGES: '', MAIN_FILE: 'index.js', NODE_ARGS: '' },
        envSchema: ['AUTO_UPDATE', 'NODE_PACKAGES', 'UNNODE_PACKAGES', 'MAIN_FILE', 'NODE_ARGS'],
      },
      'python': {
        key: 'python', label: 'Python', image: PYTHON_IMAGE, startup: PYTHON_DISCORD_STARTUP,
        env: { AUTO_UPDATE: '0', PY_PACKAGES: '', REQUIREMENTS_FILE: 'requirements.txt', PY_FILE: 'bot.py' },
        envSchema: ['AUTO_UPDATE', 'PY_PACKAGES', 'REQUIREMENTS_FILE', 'PY_FILE'],
      },
    },
  },

  node: {
    key: 'node',
    label: 'Node.js App',
    icon: 'hexagon',
    kind: 'service',
    description: 'Host an Express, Fastify or NestJS application.',
    needsPort: true,
    templates: {
      'express': { key: 'express', label: 'Express', image: NODE_IMAGE, startup: NODE_APP_STARTUP, env: { MAIN_FILE: 'index.js', NODE_PACKAGES: '' }, envSchema: ['MAIN_FILE', 'NODE_PACKAGES'] },
      'fastify': { key: 'fastify', label: 'Fastify', image: NODE_IMAGE, startup: NODE_APP_STARTUP, env: { MAIN_FILE: 'server.js', NODE_PACKAGES: '' }, envSchema: ['MAIN_FILE', 'NODE_PACKAGES'] },
      'nestjs':  { key: 'nestjs',  label: 'NestJS',  image: NODE_IMAGE, startup: `${NODE_PKG_INSTALL} if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/npm run start:prod`, env: { MAIN_FILE: 'dist/main.js', NODE_PACKAGES: '' }, envSchema: ['MAIN_FILE', 'NODE_PACKAGES'] },
    },
  },

  python: {
    key: 'python',
    label: 'Python App',
    icon: 'code',
    kind: 'service',
    description: 'Host a Flask, FastAPI or Django application.',
    needsPort: true,
    templates: {
      'flask':   { key: 'flask',   label: 'Flask',   image: PYTHON_IMAGE, startup: PYTHON_APP_STARTUP, env: { REQUIREMENTS_FILE: 'requirements.txt', PY_FILE: 'app.py', PY_PACKAGES: '' }, envSchema: ['REQUIREMENTS_FILE', 'PY_FILE', 'PY_PACKAGES'] },
      'fastapi': { key: 'fastapi', label: 'FastAPI', image: PYTHON_IMAGE, startup: `${PY_PKG_INSTALL} if [[ -f /home/container/\${REQUIREMENTS_FILE} ]]; then pip install -U --prefix .local -r \${REQUIREMENTS_FILE}; fi; /usr/local/bin/python -m uvicorn \${MODULE}:app --host 0.0.0.0 --port \${SERVER_PORT}`, env: { REQUIREMENTS_FILE: 'requirements.txt', MODULE: 'main', PY_PACKAGES: '' }, envSchema: ['REQUIREMENTS_FILE', 'MODULE', 'PY_PACKAGES'] },
      'django':  { key: 'django',  label: 'Django',  image: PYTHON_IMAGE, startup: `${PY_PKG_INSTALL} if [[ -f /home/container/\${REQUIREMENTS_FILE} ]]; then pip install -U --prefix .local -r \${REQUIREMENTS_FILE}; fi; /usr/local/bin/python manage.py migrate; /usr/local/bin/python manage.py runserver 0.0.0.0:\${SERVER_PORT}`, env: { REQUIREMENTS_FILE: 'requirements.txt', PY_PACKAGES: '' }, envSchema: ['REQUIREMENTS_FILE', 'PY_PACKAGES'] },
    },
  },

  static: {
    key: 'static',
    label: 'Static Website',
    icon: 'globe',
    kind: 'service',
    description: 'Serve a static site or SPA (HTML, React, Vue).',
    needsPort: true,
    templates: {
      'html':  { key: 'html',  label: 'HTML',  image: STATIC_IMAGE, startup: STATIC_STARTUP, env: { SERVE_DIR: '.', BUILD_CMD: '' }, envSchema: ['SERVE_DIR', 'BUILD_CMD'] },
      'react': { key: 'react', label: 'React', image: STATIC_IMAGE, startup: STATIC_STARTUP, env: { SERVE_DIR: 'build', BUILD_CMD: 'npm run build' }, envSchema: ['SERVE_DIR', 'BUILD_CMD'] },
      'vue':   { key: 'vue',   label: 'Vue',   image: STATIC_IMAGE, startup: STATIC_STARTUP, env: { SERVE_DIR: 'dist', BUILD_CMD: 'npm run build' }, envSchema: ['SERVE_DIR', 'BUILD_CMD'] },
    },
  },
};

export const isServiceType = (type) => Boolean(SERVICES[type]);

export function getTemplate(serviceType, templateKey) {
  const svc = SERVICES[serviceType];
  if (!svc) return null;
  return svc.templates[templateKey] || Object.values(svc.templates)[0] || null;
}

/** Default images to pre-pull at boot (only those a service catalog needs). */
export function catalogImages() {
  const set = new Set();
  for (const svc of Object.values(SERVICES)) {
    for (const t of Object.values(svc.templates)) set.add(t.image);
  }
  return [...set];
}

/** Public catalog for the frontend (no internal-only fields). */
export function publicCatalog() {
  return Object.values(SERVICES).map((s) => ({
    key: s.key, label: s.label, icon: s.icon, description: s.description, needsPort: s.needsPort,
    templates: Object.values(s.templates).map((t) => ({
      key: t.key, label: t.label, image: t.image, startup: t.startup, env: t.env, envSchema: t.envSchema,
    })),
  }));
}
