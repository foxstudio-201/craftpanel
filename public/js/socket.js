/* Socket.IO wrapper with a tiny pub/sub veneer for pages. */
(function () {
  let socket = null;

  function connect() {
    if (socket) return socket;
    socket = io({ auth: { token: api.getToken() }, transports: ['websocket', 'polling'] });

    socket.on('connect', () => document.dispatchEvent(new CustomEvent('socket:status', { detail: 'connected' })));
    socket.on('disconnect', () => document.dispatchEvent(new CustomEvent('socket:status', { detail: 'disconnected' })));

    // Surface server-pushed notifications as toasts + a DOM event.
    socket.on('notification', (n) => {
      window.ui?.toast(n.message, n.type, { title: n.title });
      document.dispatchEvent(new CustomEvent('notification', { detail: n }));
    });
    return socket;
  }

  // ── Listener scoping ─────────────────────────────────────────────────
  // The SPA router wraps each page render in a scope so listeners a page adds
  // via realtime.on(...) are tracked and removed when navigating away — one
  // WebSocket for the whole app, with no duplicate/leaked page listeners.
  let activeScope = null;
  const scopes = new Map(); // scope name -> [[evt, cb], ...]

  function on(evt, cb) {
    connect().on(evt, cb);
    if (activeScope) {
      if (!scopes.has(activeScope)) scopes.set(activeScope, []);
      scopes.get(activeScope).push([evt, cb]);
    }
    return cb;
  }

  window.realtime = {
    connect,
    on,
    off: (evt, cb) => socket?.off(evt, cb),
    emit: (evt, data) => connect().emit(evt, data),
    beginScope(name) { activeScope = name; },
    endScope() { activeScope = null; },
    clearScope(name) {
      const arr = scopes.get(name);
      if (!arr) return;
      for (const [evt, cb] of arr) socket?.off(evt, cb);
      scopes.delete(name);
    },
    get socket() { return socket; },
  };
})();
