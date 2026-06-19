/* Thin REST client used by every page. Handles JWT (cookie + bearer),
   JSON envelopes and error surfacing through toasts. */
(function () {
  const TOKEN_KEY = 'craftpanel_token';

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

  async function request(method, path, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: method === 'GET' || method === 'DELETE' && !body ? undefined : payload,
        credentials: 'include',
      });
    } catch (err) {
      throw new ApiError('Network error — is the server running?', 0);
    }

    if (res.status === 204) return {};
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const message = (data && data.message) || `Request failed (${res.status})`;
      if (res.status === 401 && !path.startsWith('/auth')) {
        setToken(null);
        if (!location.pathname.match(/login|register|forgot/)) {
          location.href = '/login';
        }
      }
      throw new ApiError(message, res.status, data && data.details);
    }
    return data.data !== undefined ? data.data : data;
  }

  class ApiError extends Error {
    constructor(message, status, details) {
      super(message);
      this.status = status;
      this.details = details;
    }
  }

  window.api = {
    get: (p, o) => request('GET', p, null, o),
    post: (p, b, o) => request('POST', p, b, o),
    put: (p, b, o) => request('PUT', p, b, o),
    del: (p, b, o) => request('DELETE', p, b, o),
    upload: (p, formData) => request('POST', p, formData),
    getToken,
    setToken,
    ApiError,
  };
})();
