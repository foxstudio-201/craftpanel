/* File Manager — real volume operations incl. zip/unzip and drag-and-drop. */
Layout.mount(async (content) => {
  const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;

  const { servers } = await api.get('/servers');
  if (!servers.length) { content.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-500">No servers yet.</div>`; return; }
  const params = new URLSearchParams(location.search);
  let current = params.get('server') && servers.find((s) => s.id === params.get('server')) ? params.get('server') : servers[0].id;
  let cwd = '';

  content.innerHTML = `
    <div class="glass glass-card p-4 mb-4 flex flex-wrap items-center gap-3">
      <select id="srv" class="select w-auto min-w-[12rem]">${servers.map((s) => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
      <div class="relative ml-auto"><i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i><input id="search" class="input pl-9 py-2 w-44" placeholder="Search files…"></div>
      <button id="new-file" class="btn btn-sm btn-ghost"><i data-lucide="file-plus" class="w-4 h-4"></i></button>
      <button id="new-folder" class="btn btn-sm btn-ghost"><i data-lucide="folder-plus" class="w-4 h-4"></i></button>
      <label class="btn btn-sm btn-primary cursor-pointer"><i data-lucide="upload" class="w-4 h-4"></i> Upload<input id="upload" type="file" class="hidden" multiple></label>
    </div>
    <div id="drop" class="glass glass-card p-4 transition">
      <div id="crumbs" class="flex items-center gap-1 text-sm mb-3 flex-wrap"></div>
      <div class="overflow-x-auto"><table class="table"><thead><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
      <p class="text-xs text-slate-500 mt-3"><i data-lucide="move" class="w-3 h-3 inline"></i> Drag & drop files anywhere here to upload to the current folder.</p>
    </div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  const rowsEl = document.getElementById('rows');
  const drop = document.getElementById('drop');

  function crumbs() {
    const parts = cwd ? cwd.split('/') : [];
    const el = document.getElementById('crumbs'); let acc = '';
    el.innerHTML = `<button data-path="" class="text-brand-400 hover:underline">root</button>` +
      parts.map((p) => { acc = acc ? `${acc}/${p}` : p; return ` <span class="text-slate-600">/</span> <button data-path="${acc}" class="text-brand-400 hover:underline">${escapeHtml(p)}</button>`; }).join('');
    el.querySelectorAll('[data-path]').forEach((b) => b.addEventListener('click', () => { cwd = b.dataset.path; list(); }));
  }

  async function list() {
    crumbs();
    try { const { files } = await api.get(`/files/${current}/list?path=${encodeURIComponent(cwd)}`); renderRows(files); }
    catch (e) { toastError(e.message); rowsEl.innerHTML = `<tr><td colspan="4" class="text-center text-slate-500 py-6">${escapeHtml(e.message)}</td></tr>`; }
  }

  function icon(name) {
    if (/\.(png|jpe?g|gif|webp)$/i.test(name)) return 'image';
    if (/\.(ya?ml|json|properties|toml|cfg|conf)$/i.test(name)) return 'settings-2';
    if (/\.(log|txt|md)$/i.test(name)) return 'file-text';
    if (/\.(jar)$/i.test(name)) return 'coffee';
    if (/\.(zip|gz|tar)$/i.test(name)) return 'file-archive';
    return 'file';
  }

  function renderRows(files) {
    if (!files.length) { rowsEl.innerHTML = `<tr><td colspan="4" class="text-center text-slate-500 py-6">Empty folder</td></tr>`; return; }
    rowsEl.innerHTML = files.map((f) => {
      const dir = f.type === 'directory';
      return `<tr data-path="${escapeHtml(f.path)}" data-type="${f.type}">
        <td><button class="flex items-center gap-2 ${dir ? 'text-brand-300' : ''}" data-open><i data-lucide="${dir ? 'folder' : icon(f.name)}" class="w-4 h-4"></i> ${escapeHtml(f.name)}</button></td>
        <td class="text-slate-400">${dir ? '—' : fmt.bytes(f.size)}</td>
        <td class="text-slate-400">${fmt.relative(f.modified)}</td>
        <td class="text-right whitespace-nowrap">
          ${!dir ? `<button data-dl class="btn btn-sm btn-ghost" title="Download"><i data-lucide="download" class="w-4 h-4"></i></button>` : ''}
          ${!dir && /\.zip$/i.test(f.name) ? `<button data-unzip class="btn btn-sm btn-ghost" title="Unzip"><i data-lucide="folder-open" class="w-4 h-4"></i></button>` : `<button data-zip class="btn btn-sm btn-ghost" title="Zip"><i data-lucide="file-archive" class="w-4 h-4"></i></button>`}
          ${!dir ? `<button data-edit class="btn btn-sm btn-ghost" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></button>` : ''}
          <button data-rename class="btn btn-sm btn-ghost" title="Rename"><i data-lucide="text-cursor-input" class="w-4 h-4"></i></button>
          <button data-del class="btn btn-sm btn-ghost text-red-300" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </td></tr>`;
    }).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    bind();
  }

  function bind() {
    rowsEl.querySelectorAll('tr').forEach((tr) => {
      const p = tr.dataset.path, t = tr.dataset.type;
      tr.querySelector('[data-open]')?.addEventListener('click', () => { if (t === 'directory') { cwd = p; list(); } else openEditor(p); });
      tr.querySelector('[data-dl]')?.addEventListener('click', () => { const a = document.createElement('a'); a.href = `/api/files/${current}/download?path=${encodeURIComponent(p)}`; a.click(); });
      tr.querySelector('[data-edit]')?.addEventListener('click', () => openEditor(p));
      tr.querySelector('[data-rename]')?.addEventListener('click', () => rename(p));
      tr.querySelector('[data-del]')?.addEventListener('click', () => del(p, t));
      tr.querySelector('[data-zip]')?.addEventListener('click', () => zip(p));
      tr.querySelector('[data-unzip]')?.addEventListener('click', () => unzip(p));
    });
  }

  async function openEditor(p) {
    try {
      const { content: text } = await api.get(`/files/${current}/read?path=${encodeURIComponent(p)}`);
      const m = modal({ title: `Editing ${p}`, size: 'max-w-3xl', body: `<textarea id="ed" class="textarea font-mono text-xs" style="height:55vh">${escapeHtml(text)}</textarea>`,
        footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="save" class="btn btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Save</button>` });
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      m.$('#save').addEventListener('click', async () => { try { await api.put(`/files/${current}/write`, { path: p, content: m.$('#ed').value }); m.close(); toastSuccess('Saved'); } catch (e) { toastError(e.message); } });
    } catch (e) { toastError(e.message); }
  }
  function rename(p) {
    const name = p.split('/').pop();
    const m = modal({ title: 'Rename', body: `<label class="label">New name</label><input id="nm" class="input" value="${escapeHtml(name)}"><p id="err" class="text-xs text-red-300 mt-1 hidden"></p>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="ok" class="btn btn-primary"><i data-lucide="check" class="w-4 h-4"></i> Rename</button>` });
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    const input = m.$('#nm'); input.focus(); input.select();
    m.$('#ok').addEventListener('click', async () => {
      const next = input.value.trim();
      if (!next || next === name) return m.close();
      if (/[\\/]/.test(next)) { m.$('#err').textContent = 'Name cannot contain slashes.'; m.$('#err').classList.remove('hidden'); return; }
      const to = p.includes('/') ? p.replace(/[^/]+$/, next) : next;
      try { await api.post(`/files/${current}/rename`, { from: p, to }); m.close(); toastSuccess('Renamed'); list(); } catch (e) { m.$('#err').textContent = e.message; m.$('#err').classList.remove('hidden'); }
    });
  }
  async function del(p, t) { if (!(await confirmDialog({ title: `Delete ${t}?`, message: escapeHtml(p), confirmText: 'Delete', danger: true }))) return; try { await api.del(`/files/${current}/delete?path=${encodeURIComponent(p)}`); toastSuccess('Deleted'); list(); } catch (e) { toastError(e.message); } }
  async function zip(p) { try { await api.post(`/files/${current}/zip`, { paths: [p], name: p.split('/').pop(), dest: cwd }); toastSuccess('Archive created'); list(); } catch (e) { toastError(e.message); } }
  async function unzip(p) { try { await api.post(`/files/${current}/unzip`, { path: p, dest: cwd }); toastSuccess('Extracted'); list(); } catch (e) { toastError(e.message); } }

  function create(type) {
    const label = type === 'directory' ? 'folder' : 'file';
    const m = modal({ title: `Create ${label}`, body: `<label class="label">${label[0].toUpperCase() + label.slice(1)} name</label><input id="nm" class="input" placeholder="${type === 'directory' ? 'config' : 'server.properties'}"><p id="err" class="text-xs text-red-300 mt-1 hidden"></p>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="ok" class="btn btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> Create</button>` });
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    const input = m.$('#nm'); input.focus();
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { m.$('#err').textContent = 'Name is required.'; m.$('#err').classList.remove('hidden'); return; }
      if (/[\\/]/.test(name)) { m.$('#err').textContent = 'Name cannot contain slashes.'; m.$('#err').classList.remove('hidden'); return; }
      const path = cwd ? `${cwd}/${name}` : name;
      try { await api.post(`/files/${current}/create`, { path, type }); m.close(); toastSuccess(`${label} created`); list(); }
      catch (e) { m.$('#err').textContent = e.message; m.$('#err').classList.remove('hidden'); }
    };
    m.$('#ok').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  async function uploadFiles(fileList) {
    if (!fileList.length) return;
    const fd = new FormData();
    for (const f of fileList) fd.append('files', f);
    fd.append('path', cwd);
    try { const r = await api.upload(`/files/${current}/upload`, fd); toastSuccess(`${r.count} file(s) uploaded`); list(); }
    catch (e) { toastError(e.message); }
  }

  document.getElementById('srv').addEventListener('change', (e) => { current = e.target.value; cwd = ''; list(); });
  document.getElementById('new-file').addEventListener('click', () => create('file'));
  document.getElementById('new-folder').addEventListener('click', () => create('directory'));
  document.getElementById('upload').addEventListener('change', (e) => { uploadFiles([...e.target.files]); e.target.value = ''; });

  let st;
  document.getElementById('search').addEventListener('input', (e) => {
    clearTimeout(st); const q = e.target.value.trim();
    st = setTimeout(async () => { if (!q) return list(); try { const { results } = await api.get(`/files/${current}/search?q=${encodeURIComponent(q)}`); renderRows(results); } catch (err) { toastError(err.message); } }, 300);
  });

  // Drag & drop upload
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.outline = '2px dashed rgba(16,185,129,.6)'; }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.outline = 'none'; }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) uploadFiles([...e.dataTransfer.files]); });

  list();
});
