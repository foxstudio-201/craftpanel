/* Per-service shell entry. URL: /service/:id/:tab (tab defaults to overview).
   Layout.mountService builds the persistent shell (sidebar + navbar + socket)
   ONCE and installs an in-page History-API router; clicking a sidebar tab swaps
   only <main> — no document reload, no socket reconnect (SPA). */
(function () {
  const m = location.pathname.match(/^\/service\/([^/]+)(?:\/([^/]+))?\/?$/);
  const id = m ? m[1] : null;
  const tab = (m && m[2]) || 'overview';
  if (!id) { location.replace('/services'); return; }
  Layout.mountService({ id, tab });
})();
