/* UI helpers: toasts, modals, formatters and small DOM utilities. */
(function () {
  // ── DOM helpers ────────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // ── Toast notifications ────────────────────────────────────────────
  function ensureToastRoot() {
    let root = $('#toast-root');
    if (!root) {
      root = el('<div id="toast-root"></div>');
      document.body.appendChild(root);
    }
    return root;
  }

  const ICONS = {
    success: 'check-circle',
    error: 'x-circle',
    warning: 'alert-triangle',
    info: 'info',
  };

  function toast(message, type = 'info', { title, duration = 4200 } = {}) {
    const root = ensureToastRoot();
    const node = el(`
      <div class="toast glass toast-${type}">
        <i data-lucide="${ICONS[type] || 'info'}" class="w-5 h-5 flex-shrink-0 mt-0.5"></i>
        <div class="flex-1 min-w-0">
          ${title ? `<p class="font-semibold text-sm">${title}</p>` : ''}
          <p class="text-sm text-slate-300 break-words">${message}</p>
        </div>
        <button class="text-slate-500 hover:text-white"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>`);
    root.appendChild(node);
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    const close = () => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 300);
    };
    node.querySelector('button').addEventListener('click', close);
    if (duration) setTimeout(close, duration);
  }

  const toastSuccess = (m, o) => toast(m, 'success', { title: 'Success', ...o });
  const toastError = (m, o) => toast(m, 'error', { title: 'Error', ...o });
  const toastWarn = (m, o) => toast(m, 'warning', { title: 'Warning', ...o });
  const toastInfo = (m, o) => toast(m, 'info', { title: 'Info', ...o });

  // ── Modal ──────────────────────────────────────────────────────────
  function modal({ title = '', body = '', footer = '', size = 'max-w-lg' } = {}) {
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal glass-strong ${size}">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold">${title}</h3>
            <button data-close class="btn btn-icon btn-ghost"><i data-lucide="x" class="w-4 h-4"></i></button>
          </div>
          <div data-body>${body}</div>
          ${footer ? `<div class="flex justify-end gap-2 mt-6" data-footer>${footer}</div>` : ''}
        </div>
      </div>`);
    document.body.appendChild(backdrop);
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    const close = () => { backdrop.remove(); };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    return { root: backdrop, close, $: (s) => backdrop.querySelector(s) };
  }

  /** Promise-based confirm dialog. */
  function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false } = {}) {
    return new Promise((resolve) => {
      const m = modal({
        title,
        body: `<p class="text-slate-300 text-sm">${message}</p>`,
        footer: `
          <button data-cancel class="btn btn-ghost">Cancel</button>
          <button data-ok class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${confirmText}</button>`,
      });
      m.$('[data-cancel]').addEventListener('click', () => { m.close(); resolve(false); });
      m.$('[data-ok]').addEventListener('click', () => { m.close(); resolve(true); });
    });
  }

  // ── Formatters ─────────────────────────────────────────────────────
  const fmt = {
    bytes(n) {
      if (n === 0 || n == null) return '0 B';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(n) / Math.log(1024));
      return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
    },
    duration(ms) {
      if (!ms || ms < 1000) return '0m';
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
    },
    relative(iso) {
      const diff = Date.now() - new Date(iso).getTime();
      const s = Math.floor(diff / 1000);
      if (s < 60) return 'just now';
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    },
    time(iso) {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    },
    num(n) { return new Intl.NumberFormat().format(n); },
  };

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const meterClass = (pct) => (pct >= 85 ? 'danger' : pct >= 65 ? 'warn' : '');

  // Single source of truth for server-state presentation, so Console and Overview
  // render byte-identical status. The state itself always comes from the backend
  // (Docker syncStatus) — this only maps it to a label + badge class.
  const STATUS_MAP = {
    running:    { label: 'Running',    cls: 'badge-success', dot: true },
    starting:   { label: 'Starting',   cls: 'badge-warn',    dot: true },
    stopping:   { label: 'Stopping',   cls: 'badge-warn',    dot: true },
    restarting: { label: 'Restarting', cls: 'badge-warn',    dot: true },
    installing: { label: 'Installing', cls: 'badge-info',    dot: true },
    crashed:    { label: 'Crashed',    cls: 'badge-danger',  dot: false },
    install_failed: { label: 'Install failed', cls: 'badge-danger', dot: false },
    offline:    { label: 'Offline',    cls: 'badge-muted',   dot: false },
  };
  const serverStatus = (state) => STATUS_MAP[state] || STATUS_MAP.offline;
  const serverStatusBadge = (state) => {
    const s = serverStatus(state);
    return `<span class="badge ${s.cls}">${s.dot ? '<span class="dot dot-live"></span> ' : ''}${s.label}</span>`;
  };

  window.ui = { $, $$, el, toast, toastSuccess, toastError, toastWarn, toastInfo, modal, confirmDialog, fmt, escapeHtml, meterClass, serverStatus, serverStatusBadge };
})();
