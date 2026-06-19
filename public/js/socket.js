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

  window.realtime = {
    connect,
    on: (evt, cb) => connect().on(evt, cb),
    off: (evt, cb) => socket?.off(evt, cb),
    emit: (evt, data) => connect().emit(evt, data),
    get socket() { return socket; },
  };
})();
