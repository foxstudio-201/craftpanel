/* Authentication guard + current-user cache, shared by all pages. */
(function () {
  let currentUser = null;

  async function fetchMe() {
    if (currentUser) return currentUser;
    currentUser = await api.get('/auth/me').then((d) => d.user);
    return currentUser;
  }

  /** Redirect to /login if not authenticated. Returns the user on success. */
  async function requireAuth() {
    try {
      return await fetchMe();
    } catch {
      location.href = '/login';
      return null;
    }
  }

  /** Redirect away from auth pages if already signed in. */
  async function redirectIfAuthed(to = '/marketplace') {
    if (!api.getToken()) return;
    try {
      await fetchMe();
      location.href = to;
    } catch {
      api.setToken(null);
    }
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    api.setToken(null);
    currentUser = null;
    location.href = '/login';
  }

  const ROLE_LEVEL = { user: 1, moderator: 2, admin: 3 };
  const can = (minRole) => (ROLE_LEVEL[currentUser?.role] || 0) >= (ROLE_LEVEL[minRole] || 0);

  window.auth = { fetchMe, requireAuth, redirectIfAuthed, logout, can, get user() { return currentUser; } };
})();
