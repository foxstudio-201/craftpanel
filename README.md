<div align="center">

# 🎮 CraftPanel

### A real, production Minecraft Hosting Panel

**Node.js · Express · Docker · Socket.IO · SFTP · Tailwind CSS · Chart.js**

Deploys **real Minecraft servers as Docker containers** with live console (RCON),
real `docker stats` metrics, a real file manager, SFTP, an admin dashboard and a secure
external API — in a gaming glassmorphism UI.

</div>

---

> **This is not a mockup or simulation.** Server lifecycle runs through the Docker Engine
> API (`dockerode`); the installer downloads server jars from official upstreams (Mojang,
> PaperMC, PurpurMC, FabricMC) via the `itzg/minecraft-server` images; console commands
> execute over **RCON**; metrics come from `docker stats`; plugins install from **Modrinth**;
> and the SFTP server is a real `ssh2` server for FileZilla/WinSCP.

## 🧱 Requirements

- **Docker Engine** running and reachable (`/var/run/docker.sock`); the panel user must be
  in the `docker` group.
- **Node.js 18+**.
- Linux host (tested on Docker 29.x). The `itzg/minecraft-server` and `itzg/mc-proxy`
  images are pulled automatically on first use.

## ✨ Features

| Area | What's included |
| --- | --- |
| **Authentication** | Login, register, forgot/reset password, JWT sessions, role system (`admin`/`moderator`/`user`), ban/suspend |
| **Real deployment** | Create · Start · Stop · Restart · Kill · Delete · Clone · Suspend · Backup · Restore · **Reinstall** — all real Docker containers |
| **Resource installer** | Vanilla, Paper, Purpur, Spigot, Fabric, Forge, NeoForge, Velocity, Waterfall — with **live version lists** from official APIs |
| **Console** | Live container log stream (WebSocket), **real RCON commands**, full server info (UUID, container, limits, port, TPS, uptime), lifecycle buttons |
| **File manager** | Nested browse, create, rename, delete, edit, upload, **drag & drop**, download, search, **zip & unzip** — on the real data volume |
| **Players** | Live RCON player list, ban/unban, kick, OP/de-OP, whitelist (reads real `banned-players.json` / `whitelist.json`) |
| **Plugins** | Real `/plugins` folder management + enable/disable + **Modrinth marketplace** install + install-from-URL |
| **Admin dashboard** | All users & servers, create-for-user, suspend/ban, transfer ownership, roles, activity + system logs, node/Docker/infra status, announcements |
| **Monitoring** | Real CPU/RAM/Disk/Network/TPS history (`docker stats`) with live charts |
| **API** | API keys with scopes, per-key rate limiting, usage monitoring, external `/api/v1` endpoints, docs |
| **SFTP** | Real `ssh2` SFTP server — connect with FileZilla/WinSCP (`<user>.<serverId>` + panel password) |
| **Infrastructure** | Node status, Docker status, allocated ports, public/internal IP, domain, available CPU/RAM/Disk |
| **UI/UX** | Glassmorphism, blur, animations, sidebar + navbar, responsive (desktop/tablet/mobile) |

> **Note on data:** CraftPanel ships with a self-contained JSON data store and a
> **simulated metrics engine**, so the entire dashboard is fully functional out of
> the box with **zero external services**. Every module is built behind a small
> service/store API so you can wire it to real Minecraft processes, a real
> database, and OS metrics without touching the UI. See [CLAUDE.md](./CLAUDE.md).

---

## 🆕 Hosting platform features

- **Role-based access** — only admins create servers/databases; users manage only
  their own services (servers, files, databases, backups, schedules, network, API keys).
- **Marketplace home** — service catalogue (Minecraft & Database hosting are live;
  other service types are listed with templates and honestly marked when not yet
  provisionable on the node). Users land here after login; the Overview is admin-only.
- **Databases** — provision real **MySQL / MariaDB / PostgreSQL** containers with
  isolated volumes, credentials and ports; start/stop/delete + connection strings.
- **Schedules** — real **cron** automation (node-cron) running start/stop/restart/
  backup/command actions through the background **queue** (in-process, or Redis via
  `REDIS_URL`).
- **Backups** — manual + scheduled `tar.gz` backups with restore and download.
- **Startup** — edit version, limits, MOTD, gamemode and environment variables
  (applied by recreating the container).
- **Network** — view IP/port allocations; admins manage the IP pool and reassign ports.
- **Users** (admin) — create, search, role, ban/unban, delete.
- **Domains** (admin) — domain records, real DNS verification, and Caddyfile
  reverse-proxy generation (Caddy provides automatic HTTPS).
- **API keys** — scopes, **expiration**, rename, per-key rate limits and usage logs.
- **Activity** — per-user audit feed (admins see everything).

## 🚀 Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # then edit JWT_SECRET etc.

# 3. Start the server
npm start                   # or: npm run dev   (auto-reload)

# 4. Open the panel
#    http://localhost:3000
```

The database is **seeded automatically on first run** with demo servers,
players, plugins and three accounts:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@craftpanel.local` | `admin12345` |
| Moderator | `mod@craftpanel.local` | `moderator123` |
| User | `user@craftpanel.local` | `user12345` |

> ⚠️ Change `JWT_SECRET` and the admin credentials in `.env` before deploying.

---

## 🎨 Tailwind CSS

The pages load Tailwind through the **Play CDN** during development, so there is
**no build step required** to run the project. For a hardened production build:

```bash
npm run css:build     # generates public/css/tailwind.css
```

Then replace the CDN `<script>` tag in the page `<head>` with:

```html
<link rel="stylesheet" href="/css/tailwind.css" />
```

The custom glassmorphism theme lives in `public/css/custom.css` and is always loaded.

---

## 📁 Project structure

```
craftpanel/
├── src/                          # Backend (Node + Express + Socket.IO)
│   ├── server.js                 # HTTP/WS bootstrap
│   ├── app.js                    # Express app, middleware, static + routes
│   ├── config/                   # Env-driven configuration
│   ├── data/                     # JSON store + seeder
│   ├── services/                 # Token & simulated-metrics services
│   ├── middleware/               # auth, roles, rate-limit, errors
│   ├── controllers/              # One controller per domain
│   ├── routes/                   # REST routes (mounted under /api)
│   └── sockets/                  # WebSocket layer (metrics, console, notifications)
├── public/                       # Frontend (static, vanilla JS modules)
│   ├── css/                      # custom.css (theme) + Tailwind input/build
│   ├── js/                       # api, ui, auth, socket, charts, layout
│   │   └── pages/                # one module per page
│   ├── components/               # sidebar + navbar partials
│   └── pages/                    # HTML pages (login, dashboard, …)
├── .env.example
├── tailwind.config.js
├── package.json
├── README.md
└── CLAUDE.md                     # Architecture & development guidelines
```

---

## 🔌 REST API overview

All routes are prefixed with `/api`. Protected routes accept a JWT via the
`Authorization: Bearer <token>` header **or** the `craftpanel_token` cookie.

| Method | Endpoint | Role | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | – | Create account (first user becomes admin) |
| `POST` | `/auth/login` | – | Sign in |
| `POST` | `/auth/forgot-password` | – | Request reset token |
| `POST` | `/auth/reset-password` | – | Reset with token |
| `GET` | `/dashboard` | user | Aggregated overview |
| `GET` | `/servers` · `POST /servers` | user · admin | List / create servers |
| `POST` | `/servers/:id/power` | moderator | start \| stop \| restart \| kill |
| `POST` | `/servers/:id/clone` · `DELETE /servers/:id` | admin | Clone / delete |
| `GET/POST` | `/servers/:id/backups …` | user/mod/admin | Backup & restore |
| `GET` | `/files/:id/list,read,download,search` | user | File manager (read) |
| `PUT/POST/DELETE` | `/files/:id/write,create,rename,upload,delete` | moderator | File manager (write) |
| `GET` | `/console/:id/logs` · `POST /console/:id/command` | user · moderator | Console |
| `GET` | `/players` · `POST /players/:id/{ban,kick,op,…}` | user · mod/admin | Players |
| `GET` | `/plugins` · `POST/PUT/DELETE …` | user · mod/admin | Plugins |
| `GET` | `/databases`, `/databases/test` | user | Databases |
| `GET` | `/monitoring/overview,history,:id` | user | Metrics |
| `GET/PUT` | `/settings`, `/settings/:section` | user · admin | Settings |
| `GET` | `/health` | – | Liveness probe |

### WebSocket events
`metrics:overview` · `metrics:server` · `console:line` · `server:status` ·
`players:update` · `notification` — subscribe via `subscribe:server` /
`subscribe:console`.

---

## 🔐 Environment variables

See [`.env.example`](./.env.example) for the full list. Key ones:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | – | **Set a long random string** |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `FILES_ROOT` | `storage/servers` | File-manager sandbox root |
| `METRICS_INTERVAL` | `2000` | Live metrics broadcast interval (ms) |
| `MYSQL_*` | – | Optional real MySQL connection |

---

## 🧪 Verifying it works

```bash
curl localhost:3000/api/health
# {"success":true,"status":"ok", ...}
```

Sign in at `http://localhost:3000`, then explore the dashboard, start/stop a
server, open the console and watch logs stream in real time.

---

## 📜 License

MIT © 2026 CraftPanel
