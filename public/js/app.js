/**
 * 10MinuteMail — Public UI Application
 */

// ── State ──────────────────────────────────────────────
let state = {
  inboxId: null,
  email: null,
  token: null,
  tokenExpiresAt: null,
  inboxType: null,
  messages: [],
  autoRefreshTimer: null,
  countdownTimer: null,
};

const API = '';

// ── Theme Toggle ───────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

// ── Session Persistence ────────────────────────────────
function saveSession() {
  if (!state.inboxId) return;
  sessionStorage.setItem('tmmail_session', JSON.stringify({
    inboxId: state.inboxId,
    email: state.email,
    token: state.token,
    tokenExpiresAt: state.tokenExpiresAt,
    inboxType: state.inboxType,
  }));
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem('tmmail_session');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s.inboxId || !s.token) return false;
    // Check token expiration
    if (new Date(s.tokenExpiresAt) <= new Date()) {
      sessionStorage.removeItem('tmmail_session');
      return false;
    }
    state.inboxId = s.inboxId;
    state.email = s.email;
    state.token = s.token;
    state.tokenExpiresAt = s.tokenExpiresAt;
    state.inboxType = s.inboxType;
    return true;
  } catch { return false; }
}

function clearSession() {
  sessionStorage.removeItem('tmmail_session');
  state = { inboxId: null, email: null, token: null, tokenExpiresAt: null, inboxType: null, messages: [], autoRefreshTimer: null, countdownTimer: null };
}

// ── Toasts ─────────────────────────────────────────────
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, 4000);
}

// ── API Helpers ────────────────────────────────────────
async function apiCall(method, path, body = null, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// ── Tab Switching ──────────────────────────────────────
function switchTab(btn) {
  const tab = btn.dataset.tab;
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-generated').classList.toggle('hidden', tab !== 'generated');
  document.getElementById('tab-external').classList.toggle('hidden', tab !== 'external');
}

// ── Create Inbox ───────────────────────────────────────
async function createGeneratedInbox() {
  const btn = document.getElementById('btn-create-gen');
  const ttl = parseInt(document.getElementById('gen-ttl').value, 10);
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Creating...';

  try {
    const data = await apiCall('POST', '/v1/inboxes', { mode: 'generated', token_ttl_seconds: ttl });
    state.inboxId = data.inbox_id;
    state.email = data.email_address;
    state.token = data.access_token;
    state.tokenExpiresAt = data.token_expires_at;
    state.inboxType = data.inbox_type;
    saveSession();
    showInbox();
    toast('Inbox created successfully', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Create Temporary Email';
  }
}

async function createExternalInbox() {
  const btn = document.getElementById('btn-create-ext');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Connecting...';

  try {
    const data = await apiCall('POST', '/v1/inboxes', {
      mode: 'external',
      email_address: document.getElementById('ext-email').value,
      pop3_host: document.getElementById('ext-host').value,
      pop3_port: parseInt(document.getElementById('ext-port').value, 10),
      pop3_tls: document.getElementById('ext-tls').value === 'true',
      pop3_username: document.getElementById('ext-user').value,
      pop3_password: document.getElementById('ext-pass').value,
      token_ttl_seconds: parseInt(document.getElementById('ext-ttl').value, 10),
    });
    state.inboxId = data.inbox_id;
    state.email = data.email_address;
    state.token = data.access_token;
    state.tokenExpiresAt = data.token_expires_at;
    state.inboxType = data.inbox_type;
    saveSession();
    showInbox();
    toast('Mailbox connected successfully', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Connect Mailbox';
  }
}

// ── View Switching ─────────────────────────────────────
function showLanding() {
  stopTimers();
  clearSession();
  document.getElementById('view-landing').classList.remove('hidden');
  document.getElementById('view-inbox').classList.add('hidden');
  document.getElementById('view-message').classList.add('hidden');
}

function showInbox() {
  document.getElementById('view-landing').classList.add('hidden');
  document.getElementById('view-inbox').classList.remove('hidden');
  document.getElementById('view-message').classList.add('hidden');
  document.getElementById('inbox-email').textContent = state.email;
  document.getElementById('inbox-type-badge').textContent = state.inboxType;
  startTimers();
  refreshMessages();
}

function showMessage(uid) {
  const msg = state.messages.find(m => m.uid === uid);
  if (!msg) return;

  document.getElementById('view-inbox').classList.add('hidden');
  document.getElementById('view-message').classList.remove('hidden');

  const container = document.getElementById('message-detail-content');
  const receivedAt = msg.received_at ? new Date(msg.received_at).toLocaleString() : 'Unknown';
  const hasHtml = msg.html_body && msg.html_body.trim();
  const hasText = msg.text_body && msg.text_body.trim();

  let attachmentsHtml = '';
  if (msg.attachments && msg.attachments.length > 0) {
    const chips = msg.attachments.map(a =>
      `<a class="attachment-chip" href="${API}/v1/inboxes/${state.inboxId}/messages/${msg.uid}/attachments/${a.id}?token=${encodeURIComponent(state.token)}" target="_blank">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        ${escapeHtml(a.filename)} <span class="attachment-size">(${formatBytes(a.size_bytes)})</span>
      </a>`
    ).join('');
    attachmentsHtml = `<div class="mt-4"><h3 class="mb-2" style="font-size:0.9rem;">Attachments</h3><div class="attachment-list">${chips}</div></div>`;
  }

  let bodyHtml = '';
  if (hasHtml || hasText) {
    const tabs = [];
    if (hasHtml) tabs.push(`<button class="body-tab active" data-body-tab="html">HTML</button>`);
    if (hasText) tabs.push(`<button class="body-tab${!hasHtml ? ' active' : ''}" data-body-tab="text">Text</button>`);

    bodyHtml = `
      <div class="body-tabs">${tabs.join('')}</div>
      ${hasHtml ? `<div id="body-html" class="message-body-html"><iframe id="html-frame" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe></div>` : ''}
      ${hasText ? `<div id="body-text" class="${hasHtml ? 'hidden' : ''}"><div class="text-body-content">${escapeHtml(msg.text_body)}</div></div>` : ''}
    `;
  } else {
    bodyHtml = '<p class="text-muted mt-4">No message body.</p>';
  }

  container.innerHTML = `
    <div class="message-detail-header">
      <div class="message-detail-subject">${escapeHtml(msg.subject || '(No subject)')}</div>
      <div class="message-meta">
        <span><strong>From:</strong> ${escapeHtml(msg.sender)}</span>
        <span><strong>Date:</strong> ${receivedAt}</span>
        <span><strong>UID:</strong> ${escapeHtml(msg.uid)}</span>
      </div>
    </div>
    <div class="message-body">${bodyHtml}</div>
    ${attachmentsHtml}
  `;

  // Load HTML into iframe safely
  if (hasHtml) {
    const frame = document.getElementById('html-frame');
    frame.addEventListener('load', () => {
      frame.style.height = frame.contentDocument.body.scrollHeight + 40 + 'px';
    });
    frame.srcdoc = msg.html_body;
  }
}

function switchBodyTab(btn, tab) {
  btn.parentElement.querySelectorAll('.body-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const htmlEl = document.getElementById('body-html');
  const textEl = document.getElementById('body-text');
  if (htmlEl) htmlEl.classList.toggle('hidden', tab !== 'html');
  if (textEl) textEl.classList.toggle('hidden', tab !== 'text');
}

// ── Messages ───────────────────────────────────────────
async function refreshMessages() {
  const btn = document.getElementById('btn-refresh');
  if (btn) { btn.disabled = true; }

  try {
    const data = await apiCall('GET', `/v1/inboxes/${state.inboxId}/messages?limit=50&fetch_new=true`);
    state.messages = data.messages || [];
    renderMessages();
  } catch (err) {
    if (err.message.includes('expired') || err.message.includes('Authentication')) {
      toast('Token expired. Please create a new inbox.', 'error');
      stopTimers();
      return;
    }
    toast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderMessages() {
  const container = document.getElementById('messages-container');
  if (state.messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        <h3>No messages yet</h3>
        <p>New messages will appear here automatically.</p>
      </div>`;
    return;
  }

  const items = state.messages.map(msg => {
    const time = msg.received_at ? timeAgo(new Date(msg.received_at)) : timeAgo(new Date(msg.fetched_at));
    const preview = (msg.text_body || '').slice(0, 120).replace(/\s+/g, ' ');
    const attachCount = (msg.attachments || []).length;
    const attachBadge = attachCount > 0
      ? `<span class="badge badge-default" style="font-size:0.72rem;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:3px;"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          ${attachCount}
        </span>` : '';

    return `
      <div class="message-item" data-message-uid="${escapeAttr(msg.uid)}">
        <div>
          <div class="message-sender">${escapeHtml(msg.sender || 'Unknown sender')}</div>
          <div class="message-subject">${escapeHtml(msg.subject || '(No subject)')}</div>
          <div class="message-preview">${escapeHtml(preview)}</div>
        </div>
        <div class="flex flex-col items-center gap-2" style="flex-direction:column;align-items:flex-end;">
          <div class="message-time">${time}</div>
          ${attachBadge}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="message-list">${items}</div>`;
}

// ── Token ──────────────────────────────────────────────
async function rotateToken() {
  if (!confirm('This will invalidate your current token and issue a new one. Continue?')) return;

  try {
    const data = await apiCall('POST', `/v1/inboxes/${state.inboxId}/token:rotate`, { token_ttl_seconds: 600 });
    state.token = data.access_token;
    state.tokenExpiresAt = data.token_expires_at;
    saveSession();
    startCountdown();
    toast('Token rotated successfully', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Delete Inbox ───────────────────────────────────────
async function deleteInbox() {
  if (!confirm('Permanently delete this inbox and all messages? This cannot be undone.')) return;

  try {
    await apiCall('DELETE', `/v1/inboxes/${state.inboxId}`);
    toast('Inbox deleted', 'success');
    showLanding();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Copy ───────────────────────────────────────────────
function copyEmail() {
  if (!state.email) return;
  navigator.clipboard.writeText(state.email).then(() => toast('Email copied', 'success')).catch(() => {});
}

// ── Timers ─────────────────────────────────────────────
function startTimers() {
  stopTimers();
  startCountdown();
  state.autoRefreshTimer = setInterval(refreshMessages, 15000);
}

function stopTimers() {
  if (state.autoRefreshTimer) { clearInterval(state.autoRefreshTimer); state.autoRefreshTimer = null; }
  if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
}

function startCountdown() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  updateCountdown();
  state.countdownTimer = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const timerEl = document.getElementById('token-timer');
  const textEl = document.getElementById('timer-text');
  if (!state.tokenExpiresAt) return;

  const remaining = Math.max(0, Math.floor((new Date(state.tokenExpiresAt) - Date.now()) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  textEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  timerEl.classList.remove('warning', 'danger');
  if (remaining <= 60) timerEl.classList.add('danger');
  else if (remaining <= 180) timerEl.classList.add('warning');

  if (remaining <= 0) {
    stopTimers();
    textEl.textContent = 'Expired';
    toast('Token expired. Please create a new inbox or rotate the token.', 'error');
  }
}

// ── Utilities ──────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString();
}

// ── Event Listeners ───────────────────────────────────
document.getElementById('themeToggle').addEventListener('click', toggleTheme);
document.getElementById('tab-btn-generated').addEventListener('click', function () { switchTab(this); });
document.getElementById('tab-btn-external').addEventListener('click', function () { switchTab(this); });
document.getElementById('btn-create-gen').addEventListener('click', createGeneratedInbox);
document.getElementById('btn-create-ext').addEventListener('click', createExternalInbox);
document.getElementById('btn-copy-email').addEventListener('click', copyEmail);
document.getElementById('btn-refresh').addEventListener('click', refreshMessages);
document.getElementById('btn-rotate-token').addEventListener('click', rotateToken);
document.getElementById('btn-delete-inbox').addEventListener('click', deleteInbox);
document.getElementById('btn-back-inbox').addEventListener('click', showInbox);

// Event delegation for dynamically generated message items
document.getElementById('messages-container').addEventListener('click', (e) => {
  const item = e.target.closest('[data-message-uid]');
  if (item) showMessage(item.dataset.messageUid);
});

// Event delegation for body tab switching in message detail
document.getElementById('message-detail-content').addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-body-tab]');
  if (tabBtn) switchBodyTab(tabBtn, tabBtn.dataset.bodyTab);
});

// ── Init ───────────────────────────────────────────────
(function init() {
  if (loadSession()) {
    showInbox();
  }
})();
