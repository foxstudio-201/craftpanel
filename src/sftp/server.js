/**
 * Real SFTP server (ssh2). Lets users connect with FileZilla / WinSCP and
 * manage their server files directly.
 *
 * Username format (Pterodactyl-style):  <panelUsername>.<serverId>
 *   e.g.  admin.k9f2x1a0
 * Password = the panel account password. The session is chrooted to that
 * server's data volume; owners and staff are authorised.
 */
import ssh2 from 'ssh2';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

import config from '../config/index.js';
import db from '../data/store.js';
import logger from '../utils/logger.js';
import * as mc from '../services/minecraft.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';
import { logActivity } from '../services/activity.service.js';

const { Server, utils } = ssh2;
const { STATUS_CODE, OPEN_MODE } = utils.sftp;

function hostKey() {
  const keyPath = path.resolve(config.volumesRoot, '..', 'sftp_host_rsa');
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  return Buffer.from(privateKey);
}

const isStaff = (user) => (ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.moderator;

/** Resolve an SFTP path within the chroot base; blocks traversal. */
function resolveIn(base, reqPath) {
  const clean = path.posix.normalize('/' + (reqPath || '/')).replace(/^\/+/, '');
  const abs = path.resolve(base, clean);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

function statToAttrs(st) {
  return {
    mode: st.mode,
    uid: st.uid, gid: st.gid,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
  };
}

export function startSftpServer() {
  if (!config.sftp.enabled) {
    logger.info('SFTP disabled (SFTP_ENABLED=false)');
    return null;
  }

  const server = new Server({ hostKeys: [hostKey()] }, (client) => {
    let session = { user: null, base: null, server: null };

    client.on('authentication', async (ctx) => {
      if (ctx.method !== 'password') return ctx.reject(['password']);
      try {
        const [username, serverId] = String(ctx.username).split('.');
        const user = db.data.users.find((u) => u.username === username);
        if (!user || user.banned) return ctx.reject();
        const okPw = await bcrypt.compare(ctx.password, user.password);
        if (!okPw) return ctx.reject();

        const srv = db.data.servers.find((s) => s.id === serverId);
        if (!srv) return ctx.reject();
        if (srv.ownerId !== user.id && !isStaff(user)) return ctx.reject();

        const base = mc.volumePath(srv.uuid);
        fs.mkdirSync(base, { recursive: true });
        session = { user, base, server: srv };
        logActivity('sftp.login', { actor: { id: user.id, username: user.username }, target: srv.name, serverId: srv.id });
        ctx.accept();
      } catch {
        ctx.reject();
      }
    });

    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const sess = acceptSession();
        sess.on('sftp', (acceptSftp) => attachSftp(acceptSftp(), session));
      });
    });

    client.on('error', () => {});
  });

  server.listen(config.sftp.port, config.sftp.host, () => {
    logger.success(`SFTP server listening on ${config.sftp.host}:${config.sftp.port}`);
  });
  server.on('error', (e) => logger.error('SFTP server error: ' + e.message));
  return server;
}

function attachSftp(sftp, session) {
  const { base } = session;
  const handles = new Map();
  let nextHandle = 0;
  const newHandle = (obj) => {
    const id = nextHandle++;
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(id, 0);
    handles.set(id, obj);
    return buf;
  };
  const getHandle = (buf) => handles.get(buf.readUInt32BE(0));

  const denied = (reqid) => sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
  const fail = (reqid) => sftp.status(reqid, STATUS_CODE.FAILURE);
  const okStatus = (reqid) => sftp.status(reqid, STATUS_CODE.OK);

  sftp.on('REALPATH', (reqid, p) => {
    const abs = resolveIn(base, p);
    if (!abs) return denied(reqid);
    const rel = '/' + path.relative(base, abs).split(path.sep).join('/');
    sftp.name(reqid, [{ filename: rel === '/' ? '/' : rel.replace(/\/$/, ''), longname: rel, attrs: {} }]);
  });

  const doStat = (reqid, p, useL) => {
    const abs = resolveIn(base, p);
    if (!abs) return denied(reqid);
    const fn = useL ? fsp.lstat : fsp.stat;
    fn(abs).then((st) => sftp.attrs(reqid, statToAttrs(st))).catch(() => sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE));
  };
  sftp.on('STAT', (reqid, p) => doStat(reqid, p, false));
  sftp.on('LSTAT', (reqid, p) => doStat(reqid, p, true));
  sftp.on('FSTAT', (reqid, handle) => {
    const h = getHandle(handle);
    if (!h) return fail(reqid);
    fsp.stat(h.path).then((st) => sftp.attrs(reqid, statToAttrs(st))).catch(() => fail(reqid));
  });

  sftp.on('OPENDIR', (reqid, p) => {
    const abs = resolveIn(base, p);
    if (!abs) return denied(reqid);
    fsp.stat(abs).then((st) => {
      if (!st.isDirectory()) return fail(reqid);
      sftp.handle(reqid, newHandle({ type: 'dir', path: abs, read: false }));
    }).catch(() => sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE));
  });

  sftp.on('READDIR', async (reqid, handle) => {
    const h = getHandle(handle);
    if (!h || h.type !== 'dir') return fail(reqid);
    if (h.read) return sftp.status(reqid, STATUS_CODE.EOF);
    h.read = true;
    try {
      const entries = await fsp.readdir(h.path, { withFileTypes: true });
      const names = await Promise.all(entries.map(async (e) => {
        const st = await fsp.stat(path.join(h.path, e.name)).catch(() => null);
        const attrs = st ? statToAttrs(st) : {};
        const perms = e.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--';
        const size = st ? st.size : 0;
        return { filename: e.name, longname: `${perms} 1 mc mc ${String(size).padStart(8)} ${e.name}`, attrs };
      }));
      sftp.name(reqid, names);
    } catch { fail(reqid); }
  });

  sftp.on('OPEN', (reqid, filename, flags) => {
    const abs = resolveIn(base, filename);
    if (!abs) return denied(reqid);
    let fsFlags = 'r';
    if (flags & OPEN_MODE.WRITE) fsFlags = (flags & OPEN_MODE.APPEND) ? 'a' : 'w';
    if (flags & OPEN_MODE.READ && flags & OPEN_MODE.WRITE) fsFlags = 'r+';
    fsp.open(abs, fsFlags).then((fd) => {
      sftp.handle(reqid, newHandle({ type: 'file', path: abs, fd }));
    }).catch(() => sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE));
  });

  sftp.on('READ', async (reqid, handle, offset, length) => {
    const h = getHandle(handle);
    if (!h || h.type !== 'file') return fail(reqid);
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await h.fd.read(buf, 0, length, offset);
      if (bytesRead === 0) return sftp.status(reqid, STATUS_CODE.EOF);
      sftp.data(reqid, buf.subarray(0, bytesRead));
    } catch { fail(reqid); }
  });

  sftp.on('WRITE', async (reqid, handle, offset, data) => {
    const h = getHandle(handle);
    if (!h || h.type !== 'file') return fail(reqid);
    try { await h.fd.write(data, 0, data.length, offset); okStatus(reqid); }
    catch { fail(reqid); }
  });

  sftp.on('CLOSE', async (reqid, handle) => {
    const id = handle.readUInt32BE(0);
    const h = handles.get(id);
    try { if (h?.type === 'file') await h.fd.close(); } catch { /* ignore */ }
    handles.delete(id);
    okStatus(reqid);
  });

  sftp.on('MKDIR', (reqid, p) => {
    const abs = resolveIn(base, p);
    if (!abs) return denied(reqid);
    fsp.mkdir(abs, { recursive: true }).then(() => okStatus(reqid)).catch(() => fail(reqid));
  });
  sftp.on('RMDIR', (reqid, p) => {
    const abs = resolveIn(base, p);
    if (!abs || abs === base) return denied(reqid);
    fsp.rm(abs, { recursive: true, force: true }).then(() => okStatus(reqid)).catch(() => fail(reqid));
  });
  sftp.on('REMOVE', (reqid, p) => {
    const abs = resolveIn(base, p);
    if (!abs) return denied(reqid);
    fsp.rm(abs, { force: true }).then(() => okStatus(reqid)).catch(() => fail(reqid));
  });
  sftp.on('RENAME', (reqid, from, to) => {
    const a = resolveIn(base, from), b = resolveIn(base, to);
    if (!a || !b) return denied(reqid);
    fsp.rename(a, b).then(() => okStatus(reqid)).catch(() => fail(reqid));
  });
  // Accept attribute changes as no-ops (chmod/utimes) so clients don't error.
  sftp.on('SETSTAT', (reqid) => okStatus(reqid));
  sftp.on('FSETSTAT', (reqid) => okStatus(reqid));
}

export default startSftpServer;
