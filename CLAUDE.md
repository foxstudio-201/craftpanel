# CLAUDE.md — CraftPanel project rules & development guidelines

This file orients any developer (or AI assistant) working in this repository.
Read it before making changes.

---

## 1. What this project is

**CraftPanel** is a Minecraft Server Management Dashboard:

- **Backend:** Node.js + Express (ESM) + Socket.IO. No build step.
- **Frontend:** Static HTML + vanilla JS modules + Tailwind CSS (Play CDN in dev,
  buildable for prod) + Chart.js + Lucide icons. No framework, no bundler.
- **Real infrastructure:** Minecraft servers are **real Docker containers**
  (`itzg/minecraft-server` / `itzg/mc-proxy`) driven through the Docker Engine
  API via `dockerode`. Console = container log stream + RCON. Metrics = `docker
  stats`. Files = the real bind-mounted data volume. SFTP = a real `ssh2` server.
- **Metadata store:** A file-backed JSON store (`src/data/store.js`) holds users,
  server records (uuid, owner, limits, allocation, dockerId…), backups, API keys,
  activity logs and announcements. **This is metadata only** — the servers
  themselves are real Docker state, not rows in the JSON file.

### Service seams (where the real work lives)
- `services/docker.service.js` — dockerode wrapper: create/start/stop/restart/kill/
  remove, logs stream, `exec`, `rcon` (via `rcon-cli`), `statsOnce`, `dirSize`.
- `services/minecraft.service.js` — maps software+version → itzg env, allocates
  ports, fetches **live version lists** from Mojang/PaperMC/PurpurMC/FabricMC.
- `services/server.service.js` — orchestration: create/install, power, suspend,
  clone (copies the volume), backup/restore (real `tar.gz`), reinstall, delete.
- `services/metrics.service.js` — real per-server samples from `docker stats` + RCON TPS.
- `services/infra.service.js` — host (node) + Docker + network status.
- `services/apikey.service.js` — hashed keys, scopes, per-key rate buckets.
- `sftp/server.js` — ssh2 SFTP server, chrooted per server volume.

To swap Docker for a remote node/Wings, reimplement `docker.service.js`; the
controllers, routes and UI above it stay unchanged.

---

## 2. Golden rules

1. **No placeholders.** Every feature must work end-to-end against the current
   data layer. If you add a button, wire it to a real endpoint.
2. **Keep the seams clean.** Controllers depend only on `db` (store) and
   services. Don't reach into the JSON file directly from a route or the UI.
3. **Security is server-side.** The UI hides controls by role for UX, but every
   mutation **must** be re-checked with `authenticate` + `authorize(role)`
   middleware. Never trust the client.
4. **Match the existing style.** Small focused modules, `asyncHandler` around
   async controllers, `ApiError` for failures, the `ok()/created()` response
   envelope, and the `ui.*` / `api.*` helpers on the frontend.
5. **Path safety.** Any filesystem access goes through `resolveSafe()` in
   `fileController.js`. Never join user input to a path without the traversal guard.
6. **Run before you claim done.** `npm start`, sign in, exercise the feature.

---

## 3. Architecture map

```
Request → app.js (helmet, cors, rate-limit, json)
        → routes/*.routes.js (authenticate + authorize)
        → controllers/*Controller.js (validate, mutate via db/services)
        → utils/response.js (consistent JSON envelope)
WebSocket → sockets/index.js (metrics heartbeat, console stream, notifications)
Data      → data/store.js (in-memory + debounced JSON persistence)
Metrics   → services/metrics.service.js (smooth simulated time-series)
```

Frontend:

```
pages/*.html  → thin shell: loads shared JS + one js/pages/*.js module
js/layout.js  → injects sidebar/navbar partials, guards auth, wires shell
js/api.js     → fetch wrapper (JWT, JSON envelope, 401 redirect)
js/ui.js      → toasts, modals, confirm, formatters
js/socket.js  → Socket.IO wrapper (realtime.on/emit)
js/charts.js  → themed Chart.js factories
```

---

## 4. Conventions

### Backend
- **ESM only** (`"type": "module"`). Use `import`, include `.js` extensions.
- Controllers are named exports wrapped in `asyncHandler`.
- Throw `ApiError.badRequest()/unauthorized()/forbidden()/notFound()/conflict()`.
- Respond with `ok(res, data, message)` / `created(res, data)`.
- Persist mutations with `db.save()` (debounced) — never write the file directly.
- Role order: `user < moderator < admin`. Guard with `authorize('moderator')` etc.

### Frontend
- A page module calls `Layout.mount(async (content, user) => { … })`.
- Build DOM with template strings; **always** `ui.escapeHtml()` user data.
- Re-run `lucide.createIcons({ nameAttr: 'data-lucide' })` after injecting icons.
- Network via `api.get/post/put/del`; surface errors with `ui.toastError(err.message)`.
- Live data via `realtime.on('event', cb)`.

### Styling
- Use existing component classes from `custom.css`: `.glass`, `.glass-card`,
  `.btn`, `.btn-primary/ghost/danger/accent/warn`, `.input`, `.select`,
  `.textarea`, `.badge*`, `.meter`, `.table`, `.nav-link`.
- Theme tokens live in `:root` and `tailwind.config.js`. Keep dark-mode default.
- Preserve the glassmorphism + gaming aesthetic (blur, glow, subtle motion).

---

## 5. Adding a feature (checklist)

1. **Model/data:** extend the seed shape in `data/seed.js` and the defaults in
   `data/store.js` if new collections are needed.
2. **Controller:** add `controllers/<x>Controller.js` with validated handlers.
3. **Routes:** add `routes/<x>.routes.js`, guard with auth/role, mount in
   `routes/index.js`.
4. **Realtime (optional):** emit via `sockets/index.js` helpers
   (`pushNotification`, `emitConsoleLine`, `getIO()`).
5. **Frontend page:** add `pages/<x>.html` (copy an existing shell) + a nav link
   in `components/sidebar.html` + `js/pages/<x>.js`.
6. **Verify:** `npm start`, sign in, test happy path + an error + a role guard.

---

## 6. Replacing the simulation with real infrastructure

- **Real servers:** swap the body of `serverController` power actions and
  `consoleController` to spawn/attach to actual Minecraft processes (e.g. via
  `child_process` + RCON). Keep the same request/response contracts.
- **Real metrics:** replace `services/metrics.service.js` internals with `os`
  / `systeminformation` and RCON `tps`/`list`. The exported function signatures
  (`getOverview`, `getServerMetrics`, `getServerHistory`) must stay stable.
- **Real database:** replace `data/store.js` with a DB client (Postgres, SQLite,
  Mongo). Preserve the `db.data.<collection>` + `db.save()` surface, or refactor
  controllers behind a repository layer.
- **Real MySQL page:** add the `mysql2` driver and implement a live ping in
  `databaseController.testConnection` using `config.mysql`.

---

## 7. Security notes

- `JWT_SECRET` must be a long random value in production; rotate on compromise.
- Auth endpoints are rate-limited (`authLimiter`); general API uses `apiLimiter`.
- Helmet CSP is **disabled** to allow the CDN-based dev frontend. For production,
  build Tailwind locally, self-host Chart.js/Lucide, and enable a strict CSP.
- File manager is sandboxed under `FILES_ROOT/<serverId>`; keep the traversal guard.
- Passwords hashed with bcrypt (`BCRYPT_ROUNDS`). Never log or return hashes
  (controllers strip the `password` field via `sanitize`).

---

## 8. Commands

```bash
npm start          # run the server
npm run dev        # run with --watch auto-reload
npm run seed       # force re-seed the JSON store (overwrites data!)
npm run css:build  # build Tailwind to public/css/tailwind.css (production)
```

## 9. Do / Don't

- ✅ Do keep controllers thin and validate input.
- ✅ Do reuse `ui`/`api`/`charts` helpers and `custom.css` classes.
- ✅ Do escape all user-rendered HTML.
- ❌ Don't enforce permissions only on the client.
- ❌ Don't introduce a frontend framework or bundler without discussion.
- ❌ Don't write to `db.json` or the filesystem outside the store/sandbox helpers.
- ❌ Don't commit `.env`, `node_modules/`, `storage/` or `src/data/db.json`.
