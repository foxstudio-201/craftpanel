/* Centralized runtime store — ONE source of truth for live server state.
 *
 * Overview and Console (and any future page) read the SAME record here instead
 * of each wiring its own socket handlers. This guarantees their status/metrics
 * can never disagree, and a freshly-mounted page immediately sees the current
 * state (fixing the "Console shows old status after switching tabs" desync).
 *
 * Design:
 *   - init() attaches exactly ONE set of socket listeners (metrics:server,
 *     server:status) for the whole app — no duplicates, no per-page sockets.
 *   - track(id) ref-counts the per-server channel subscription so multiple tabs
 *     share one `subscribe:server`; the last untrack emits `unsubscribe:server`.
 *   - subscribe(id, cb) notifies on every change; returns an unsubscribe fn.
 *   - hydrate(id) seeds static fields (owner/node/ip/port/containerId) + the
 *     current status once from GET /servers/:id.
 * Nothing is cached to localStorage/sessionStorage; state is live runtime only.
 */
(function () {
  const records = new Map();   // serverId -> state record
  const subs = new Map();      // serverId -> Set<cb>
  const refs = new Map();      // serverId -> channel subscription refcount
  const hydrated = new Set();
  let started = false;

  const STATUS = new Set(['offline', 'starting', 'running', 'stopping', 'restarting', 'installing', 'crashed', 'install_failed']);

  function blank(id) {
    return {
      serverId: id, runtimeId: null, status: 'offline',
      cpu: 0, ram: { usedMb: 0, totalMb: 0, pct: 0 }, disk: { usedGb: 0, totalGb: 0, pct: 0 },
      networkIn: 0, networkOut: 0, uptimeMs: 0,
      containerId: null, ip: null, port: null, name: null, node: null, owner: null,
      lastUpdate: 0,
    };
  }
  function rec(id) { if (!records.has(id)) records.set(id, blank(id)); return records.get(id); }

  function notify(id) {
    const set = subs.get(id); if (!set) return;
    const r = records.get(id);
    for (const cb of set) { try { cb(r); } catch { /* a subscriber error must not break others */ } }
  }

  /** Merge a partial update into a server's record and notify subscribers. */
  function patch(id, partial) {
    Object.assign(rec(id), partial, { lastUpdate: Date.now() });
    notify(id);
  }

  function init() {
    if (started) return; started = true;
    realtime.connect();

    realtime.on('server:status', (e) => {
      if (!e || !e.serverId) return;
      const p = { runtimeId: e.runtimeId ?? null };
      if (STATUS.has(e.state)) p.status = e.state;
      patch(e.serverId, p);
    });

    realtime.on('metrics:server', (m) => {
      if (!m || !m.serverId) return;
      const r = rec(m.serverId);
      // Metrics carry the REAL container truth (docker.getState): 'running' or
      // 'stopped'. Map 'stopped' → 'offline' so a stop is reflected even if the
      // server:status event was missed/raced (the bug: 'stopped' was discarded,
      // leaving the badge stuck on 'running'). Never let a metrics sample stomp a
      // short-lived transition (starting/stopping/restarting/installing) — those
      // resolve via server:status — so the UI doesn't flicker mid-action.
      const TRANSIENT = r.status === 'starting' || r.status === 'stopping' || r.status === 'restarting' || r.status === 'installing';
      let nextStatus = r.status;
      if (!TRANSIENT) {
        if (m.status === 'running') nextStatus = 'running';
        else if (m.status === 'stopped') nextStatus = 'offline';
        else if (STATUS.has(m.status)) nextStatus = m.status;
      }
      patch(m.serverId, {
        status: nextStatus,
        cpu: m.cpu ?? 0,
        ram: { usedMb: m.ramUsedMb ?? 0, totalMb: m.ramTotalMb ?? r.ram.totalMb, pct: m.ramPercent ?? 0 },
        disk: { usedGb: m.diskUsedGb ?? 0, totalGb: m.diskTotalGb ?? r.disk.totalGb, pct: m.diskPercent ?? 0 },
        networkIn: m.netInMbps ?? 0,
        networkOut: m.netOutMbps ?? 0,
        uptimeMs: m.uptimeMs ?? 0,
      });
    });

    // On reconnect, re-assert every tracked channel subscription.
    document.addEventListener('socket:status', (e) => {
      if (e.detail !== 'connected') return;
      for (const id of refs.keys()) realtime.emit('subscribe:server', id);
    });
  }

  /** Seed static fields + current status once (idempotent per server). */
  async function hydrate(id, { force = false } = {}) {
    if (hydrated.has(id) && !force) return rec(id);
    try {
      const { server: s } = await api.get(`/servers/${id}`);
      patch(id, {
        name: s.name, status: STATUS.has(s.state) ? s.state : 'offline', runtimeId: s.runtimeId ?? null,
        containerId: s.dockerId || null, ip: s.allocation?.ip || null, port: s.allocation?.port ?? null,
        node: s.node || 'local', owner: s.owner || null,
        ram: { ...rec(id).ram, totalMb: s.limits?.ramMb ?? rec(id).ram.totalMb },
        disk: { ...rec(id).disk, totalGb: s.limits?.diskMb ? s.limits.diskMb / 1024 : rec(id).disk.totalGb },
      });
      hydrated.add(id);
    } catch { /* leave defaults; live events will fill in */ }
    return rec(id);
  }

  /** Start receiving the per-server metrics channel (ref-counted). */
  function track(id) {
    init();
    const n = (refs.get(id) || 0) + 1; refs.set(id, n);
    if (n === 1) realtime.emit('subscribe:server', id);
  }
  function untrack(id) {
    const n = (refs.get(id) || 0) - 1;
    if (n <= 0) { refs.delete(id); realtime.emit('unsubscribe:server', id); }
    else refs.set(id, n);
  }

  /** Subscribe to a server's state. cb(record) fires immediately + on change. */
  function subscribe(id, cb) {
    init();
    if (!subs.has(id)) subs.set(id, new Set());
    subs.get(id).add(cb);
    cb(rec(id)); // immediate current value
    return () => { subs.get(id)?.delete(cb); };
  }

  const get = (id) => records.get(id) || blank(id);

  window.RuntimeStore = { init, hydrate, track, untrack, subscribe, get, patch };
})();
