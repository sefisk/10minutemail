/**
 * 10MinuteMail — Admin UI Application
 */

// ── State ──────────────────────────────────────────────
let adminKey = '';
let domains = [];
let lastGeneratedText = '';
let lastExportText = '';
const API = '';

// ── Theme ──────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}
(function() {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.setAttribute('data-theme', 'dark');
})();

// ── Toast ──────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, 4000);
}

// ── API ────────────────────────────────────────────────
async function adminApi(method, path, body = null) {
  const headers = { 'X-Admin-Key': adminKey };
  const opts = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, opts);

  // Handle text/csv responses
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/plain') || contentType.includes('text/csv')) {
    const text = await res.text();
    if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
    return text;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return data;
}

// ── Auth ───────────────────────────────────────────────
async function adminLogin() {
  const input = document.getElementById('admin-key-input');
  const key = input.value.trim();
  if (!key) { toast('Enter an API key', 'error'); return; }

  const btn = document.getElementById('btn-admin-login');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Verifying...';

  try {
    adminKey = key;
    await adminApi('GET', '/v1/admin/stats');
    sessionStorage.setItem('admin_key', key);
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    loadDashboard();
    loadDomains();
  } catch (err) {
    adminKey = '';
    toast('Invalid API key', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Sign In';
  }
}

function adminLogout() {
  adminKey = '';
  sessionStorage.removeItem('admin_key');
  document.getElementById('admin-app').classList.add('hidden');
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-key-input').value = '';
}

// Check for saved session
(function() {
  const saved = sessionStorage.getItem('admin_key');
  if (saved) {
    adminKey = saved;
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    loadDashboard();
    loadDomains();
  }
})();

// ── Navigation ─────────────────────────────────────────
function navigateTo(page, btn) {
  document.querySelectorAll('.admin-content > section').forEach(s => s.classList.add('hidden'));
  document.getElementById(`page-${page}`).classList.remove('hidden');
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'domains') loadDomains();
  if (page === 'generate') loadDomainCheckboxes();
  if (page === 'export') loadExportDomains();
}

// ── Dashboard ──────────────────────────────────────────
async function loadDashboard() {
  try {
    const data = await adminApi('GET', '/v1/admin/stats');
    const grid = document.getElementById('stats-grid');
    grid.innerHTML = `
      <div class="stat-card">
        <div style="background:var(--primary-light);color:var(--primary);" class="stat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        </div>
        <div class="stat-value">${data.inboxes.active_inboxes}</div>
        <div class="stat-label">Active Inboxes</div>
      </div>
      <div class="stat-card">
        <div style="background:var(--success-light);color:var(--success);" class="stat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10"/></svg>
        </div>
        <div class="stat-value">${data.domains.active_domains}</div>
        <div class="stat-label">Active Domains</div>
      </div>
      <div class="stat-card">
        <div style="background:var(--info-light);color:var(--info);" class="stat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="stat-value">${data.messages.total_messages}</div>
        <div class="stat-label">Total Messages</div>
      </div>
      <div class="stat-card">
        <div style="background:var(--warning-light);color:var(--warning);" class="stat-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
        </div>
        <div class="stat-value">${data.tokens.active_tokens}</div>
        <div class="stat-label">Active Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${data.inboxes.generated_inboxes}</div>
        <div class="stat-label">Generated Inboxes (total)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${data.inboxes.external_inboxes}</div>
        <div class="stat-label">External Inboxes (total)</div>
      </div>
    `;
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Domains ────────────────────────────────────────────
async function loadDomains() {
  try {
    const data = await adminApi('GET', '/v1/admin/domains');
    domains = data.domains || [];
    renderDomains();
  } catch (err) { toast(err.message, 'error'); }
}

function renderDomains() {
  const grid = document.getElementById('domains-grid');
  if (domains.length === 0) {
    grid.innerHTML = '<div class="empty-state"><h3>No domains yet</h3><p>Add your first domain to start generating inboxes.</p></div>';
    return;
  }
  grid.innerHTML = domains.map(d => `
    <div class="domain-card">
      <div class="flex justify-between items-center">
        <span class="domain-name">${esc(d.domain)}</span>
        <div class="flex gap-2">
          <span class="badge ${d.is_local ? 'badge-info' : 'badge-warning'}">${d.is_local ? 'Local SMTP' : 'External POP3'}</span>
          <span class="badge ${d.is_active ? 'badge-success' : 'badge-danger'}">${d.is_active ? 'Active' : 'Inactive'}</span>
        </div>
      </div>
      <div class="domain-host">${d.is_local ? 'Built-in SMTP server' : `${esc(d.pop3_host)}:${d.pop3_port} ${d.pop3_tls ? '(TLS)' : ''}`}</div>
      <div class="domain-actions">
        <button class="btn btn-sm btn-ghost" data-toggle-domain="${d.id}" data-active="${!d.is_active}">
          ${d.is_active ? 'Disable' : 'Enable'}
        </button>
        <button class="btn btn-sm btn-ghost" style="color:var(--danger);" data-remove-domain="${d.id}" data-domain-name="${esc(d.domain)}">
          Delete
        </button>
      </div>
    </div>
  `).join('');
}

function showAddDomainForm() {
  document.getElementById('add-domain-form').classList.toggle('hidden');
}

async function addDomain() {
  const name = document.getElementById('new-domain-name').value.trim();
  const mode = document.getElementById('new-domain-mode').value;
  const isLocal = mode === 'local';

  if (!name) { toast('Domain name is required', 'error'); return; }

  const body = { domain: name, is_local: isLocal };

  if (!isLocal) {
    const host = document.getElementById('new-domain-host').value.trim();
    const port = parseInt(document.getElementById('new-domain-port').value, 10);
    const tls = document.getElementById('new-domain-tls').value === 'true';
    if (!host) { toast('POP3 host is required for external domains', 'error'); return; }
    body.pop3_host = host;
    body.pop3_port = port;
    body.pop3_tls = tls;
  }

  try {
    const result = await adminApi('POST', '/v1/admin/domains', body);
    toast('Domain added', 'success');
    document.getElementById('add-domain-form').classList.add('hidden');
    document.getElementById('new-domain-name').value = '';
    document.getElementById('new-domain-host').value = '';

    // Show DNS setup instructions for local domains
    if (isLocal && result.dns_setup) {
      showDnsSetup(name, result.dns_setup);
    }

    loadDomains();
  } catch (err) { toast(err.message, 'error'); }
}

function showDnsSetup(domain, dnsSetup) {
  const card = document.getElementById('dns-setup-card');
  const records = document.getElementById('dns-records');
  const lines = [
    'Add these DNS records at your domain registrar:',
    '',
  ];
  for (const r of dnsSetup.records) {
    const prio = r.priority !== undefined ? `    Priority: ${r.priority}` : '';
    lines.push(`  Type:  ${r.type}`);
    lines.push(`  Host:  ${r.host}`);
    lines.push(`  Value: ${r.value}${prio}`);
    lines.push('');
  }
  if (dnsSetup.server_ip) {
    lines.push(`Server IP: ${dnsSetup.server_ip}`);
  }
  lines.push(`SMTP Port: ${dnsSetup.smtp_port}`);
  if (dnsSetup.note) {
    lines.push('');
    lines.push(`Note: ${dnsSetup.note}`);
  }
  lines.push('');
  lines.push('After adding these records, generate inboxes and send a test email.');
  records.textContent = lines.join('\n');
  card.classList.remove('hidden');
}

async function toggleDomain(id, active) {
  try {
    await adminApi('PUT', `/v1/admin/domains/${id}`, { is_active: active });
    toast(`Domain ${active ? 'enabled' : 'disabled'}`, 'success');
    loadDomains();
  } catch (err) { toast(err.message, 'error'); }
}

async function removeDomain(id, name) {
  if (!confirm(`Delete domain "${name}"? This cannot be undone.`)) return;
  try {
    await adminApi('DELETE', `/v1/admin/domains/${id}`);
    toast('Domain deleted', 'success');
    loadDomains();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Generate ───────────────────────────────────────────
function loadDomainCheckboxes() {
  const container = document.getElementById('gen-domain-checkboxes');
  if (domains.length === 0) {
    container.innerHTML = '<div class="text-muted text-sm">No domains available. <a href="#" data-nav-link="domains">Add one first.</a></div>';
    return;
  }
  container.innerHTML = domains.filter(d => d.is_active).map(d => `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">
      <input type="checkbox" value="${d.id}" class="gen-domain-cb"> ${esc(d.domain)}
    </label>
  `).join('');
}

async function bulkGenerate() {
  const count = parseInt(document.getElementById('gen-count').value, 10);
  const ttl = parseInt(document.getElementById('gen-ttl').value, 10);
  const checked = Array.from(document.querySelectorAll('.gen-domain-cb:checked')).map(cb => cb.value);

  if (!count || count < 1) { toast('Enter a valid count', 'error'); return; }

  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating...';

  try {
    const body = { count, token_ttl_seconds: ttl };
    if (checked.length > 0) body.domain_ids = checked;
    const data = await adminApi('POST', '/v1/admin/generate', body);

    // Show results
    const lines = data.inboxes.map(i => `${i.email_address}:${i.password}`);
    lastGeneratedText = lines.join('\n');

    document.getElementById('gen-results').classList.remove('hidden');
    document.getElementById('gen-result-count').textContent = data.generated;
    document.getElementById('gen-result-text').textContent = lastGeneratedText;

    toast(`${data.generated} inboxes generated`, 'success');
    loadDashboard();
  } catch (err) { toast(err.message, 'error'); }
  finally {
    btn.disabled = false;
    btn.innerHTML = 'Generate Inboxes';
  }
}

function copyGeneratedResults() {
  navigator.clipboard.writeText(lastGeneratedText).then(() => toast('Copied to clipboard', 'success'));
}

function downloadGeneratedResults() {
  downloadText(lastGeneratedText, 'generated_inboxes.txt', 'text/plain');
}

// ── Export ──────────────────────────────────────────────
function loadExportDomains() {
  const select = document.getElementById('export-domain');
  // Keep the first "All domains" option
  while (select.options.length > 1) select.remove(1);
  for (const d of domains.filter(d => d.is_active)) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.domain;
    select.appendChild(opt);
  }
}

async function doExport(format) {
  const domainId = document.getElementById('export-domain').value;
  const status = document.getElementById('export-status').value;

  let url = `/v1/admin/export?format=${format}&status=${status}`;
  if (domainId) url += `&domain_id=${domainId}`;

  try {
    const data = await adminApi('GET', url);

    let text;
    let count;

    if (format === 'json') {
      count = data.count;
      text = JSON.stringify(data, null, 2);
    } else {
      text = data;
      count = text ? text.split('\n').filter(l => l.trim()).length : 0;
      // For csv, subtract header row
      if (format === 'csv' && count > 0) count--;
    }

    lastExportText = text;
    document.getElementById('export-results').classList.remove('hidden');
    document.getElementById('export-result-count').textContent = count;
    document.getElementById('export-result-text').textContent = text;

    toast(`Exported ${count} entries`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

function copyExportResults() {
  navigator.clipboard.writeText(lastExportText).then(() => toast('Copied to clipboard', 'success'));
}

// ── Utilities ──────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Event Listeners ────────────────────────────────────
// Login
document.getElementById('btn-admin-login').addEventListener('click', adminLogin);
document.getElementById('admin-key-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') adminLogin();
});

// Sidebar navigation (using data-nav attributes)
document.querySelectorAll('[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.nav, btn));
});

// Sidebar utility buttons
document.getElementById('btn-back-to-app').addEventListener('click', () => { window.location.href = '/'; });
document.getElementById('btn-toggle-theme').addEventListener('click', toggleTheme);
document.getElementById('btn-admin-logout').addEventListener('click', adminLogout);

// Dashboard
document.getElementById('btn-refresh-dashboard').addEventListener('click', loadDashboard);

// Domains
document.getElementById('btn-show-add-domain').addEventListener('click', showAddDomainForm);
document.getElementById('btn-add-domain').addEventListener('click', addDomain);
document.getElementById('btn-cancel-add-domain').addEventListener('click', () => {
  document.getElementById('add-domain-form').classList.add('hidden');
});

// Domain actions (event delegation on the domains grid)
document.getElementById('domains-grid').addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('[data-toggle-domain]');
  if (toggleBtn) {
    toggleDomain(toggleBtn.dataset.toggleDomain, toggleBtn.dataset.active === 'true');
    return;
  }
  const removeBtn = e.target.closest('[data-remove-domain]');
  if (removeBtn) {
    removeDomain(removeBtn.dataset.removeDomain, removeBtn.dataset.domainName);
  }
});

// Generate
document.getElementById('btn-generate').addEventListener('click', bulkGenerate);
document.getElementById('btn-copy-generated').addEventListener('click', copyGeneratedResults);
document.getElementById('btn-download-generated').addEventListener('click', downloadGeneratedResults);

// Generate domain checkboxes - navigation link (event delegation)
document.getElementById('gen-domain-checkboxes').addEventListener('click', (e) => {
  const navLink = e.target.closest('[data-nav-link]');
  if (navLink) {
    e.preventDefault();
    const navBtn = document.querySelector(`[data-nav="${navLink.dataset.navLink}"]`);
    navigateTo(navLink.dataset.navLink, navBtn);
  }
});

// Export buttons (event delegation using data-export attribute)
document.querySelector('.export-options').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-export]');
  if (btn) doExport(btn.dataset.export);
});
document.getElementById('btn-copy-export').addEventListener('click', copyExportResults);

// Domain form: toggle POP3 fields based on local/external mode
document.getElementById('new-domain-mode').addEventListener('change', (e) => {
  const fields = document.getElementById('external-pop3-fields');
  if (e.target.value === 'external') {
    fields.classList.remove('hidden');
  } else {
    fields.classList.add('hidden');
  }
});

// DNS setup dismiss
document.getElementById('btn-dismiss-dns').addEventListener('click', () => {
  document.getElementById('dns-setup-card').classList.add('hidden');
});
