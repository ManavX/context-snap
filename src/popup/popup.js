import { MSG, DEFAULT_SETTINGS } from '../shared/types.js';

// ─── DOM Elements ───────────────────────────────────────────────

const contextNameInput = document.getElementById('context-name');
const saveBtn = document.getElementById('save-btn');
const contextList = document.getElementById('context-list');
const emptyState = document.getElementById('empty-state');
const loadingEl = document.getElementById('loading');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsBack = document.getElementById('settings-back');

// Main view elements (hidden when settings is open)
const mainViewEls = [
  document.querySelector('.save-section'),
  document.querySelector('.divider'),
  contextList,
  emptyState,
];

// ─── State ──────────────────────────────────────────────────────

let contexts = [];
let settings = { ...DEFAULT_SETTINGS };

// ─── Initialize ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadContexts();
  await loadSettings();

  saveBtn.addEventListener('click', handleSave);
  contextNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSave();
  });

  settingsBtn.addEventListener('click', openSettings);
  settingsBack.addEventListener('click', closeSettings);

  // Focus the input
  contextNameInput.focus();
});

// ─── Load Contexts ──────────────────────────────────────────────

async function loadContexts() {
  loadingEl.style.display = 'block';
  emptyState.style.display = 'none';
  contextList.style.display = 'none';

  const response = await chrome.runtime.sendMessage({ type: MSG.GET_CONTEXTS });
  contexts = response.contexts || [];

  loadingEl.style.display = 'none';

  if (contexts.length === 0) {
    emptyState.style.display = 'block';
  } else {
    contextList.style.display = 'block';
    renderContexts();
  }
}

// ─── Save Context ───────────────────────────────────────────────

async function handleSave() {
  const name = contextNameInput.value.trim() || `Context ${new Date().toLocaleString()}`;

  saveBtn.disabled = true;
  saveBtn.textContent = '...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG.SAVE_CONTEXT,
      name,
    });

    if (response.success) {
      contextNameInput.value = '';
      if (settings.showNotifications) {
        showToast(`Saved "${name}" (${response.context.tabCount} tabs)`);
      }
      await loadContexts();
    }
  } catch (e) {
    showToast('Failed to save context', true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

// ─── Render Contexts ────────────────────────────────────────────

function renderContexts() {
  contextList.innerHTML = '';

  for (const ctx of contexts) {
    const el = createContextElement(ctx);
    contextList.appendChild(el);
  }
}

function createContextElement(ctx) {
  const item = document.createElement('div');
  item.className = `context-item${ctx.pinned ? ' pinned' : ''}`;

  // Count special states
  const hasWindowScroll = ctx.tabs.some((t) => t.scrollY > 0 || t.scrollX > 0);
  const formCount = ctx.tabs.reduce(
    (sum, t) => sum + Object.keys(t.formData || {}).length, 0
  );
  const selectionCount = ctx.tabs.filter((t) => t.selectedText).length;

  // Count iframe-captured fields
  const iframeFieldCount = ctx.tabs.reduce((sum, t) => {
    return sum + Object.keys(t.formData || {}).filter(k => k.startsWith('__iframe__')).length;
  }, 0);

  // Build badges HTML
  let badgesHtml = '';
  if (hasWindowScroll) {
    badgesHtml += `<span class="badge badge-scroll">scroll saved</span>`;
  }
  if (formCount > 0) badgesHtml += `<span class="badge badge-forms">${formCount} field${formCount > 1 ? 's' : ''}</span>`;
  if (iframeFieldCount > 0) badgesHtml += `<span class="badge badge-iframe">${iframeFieldCount} in iframe</span>`;
  if (selectionCount > 0) badgesHtml += `<span class="badge badge-selection">${selectionCount} selection${selectionCount > 1 ? 's' : ''}</span>`;

  const timeAgo = getTimeAgo(ctx.createdAt);

  item.innerHTML = `
    <div class="context-info">
      <div class="context-name" title="${escapeHtml(ctx.name)}">${escapeHtml(ctx.name)}</div>
      <div class="context-meta">
        <span class="tabs-count">${ctx.tabCount} tab${ctx.tabCount !== 1 ? 's' : ''}</span>
        <span>${timeAgo}</span>
      </div>
      ${badgesHtml ? `<div class="context-details">${badgesHtml}</div>` : ''}
    </div>
    <button class="btn-restore" data-id="${ctx.id}" title="Restore this context">Restore</button>
    <div class="context-actions">
      <button class="btn btn-ghost btn-pin${ctx.pinned ? ' active' : ''}" data-action="pin" data-id="${ctx.id}" title="${ctx.pinned ? 'Unpin' : 'Pin'}">
        ${ctx.pinned ? '&#9733;' : '&#9734;'}
      </button>
      <button class="btn btn-ghost" data-action="rename" data-id="${ctx.id}" title="Rename">
        &#9998;
      </button>
      <button class="btn btn-ghost btn-danger" data-action="delete" data-id="${ctx.id}" title="Delete">
        &#10005;
      </button>
    </div>
  `;

  // Event listeners
  const restoreBtn = item.querySelector('.btn-restore');
  restoreBtn.addEventListener('click', () => handleRestore(ctx.id));

  const pinBtn = item.querySelector('[data-action="pin"]');
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlePin(ctx.id);
  });

  const renameBtn = item.querySelector('[data-action="rename"]');
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleRename(ctx, item);
  });

  const deleteBtn = item.querySelector('[data-action="delete"]');
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDelete(ctx.id, ctx.name);
  });

  return item;
}

// ─── Restore Context ────────────────────────────────────────────

async function handleRestore(contextId) {
  const ctx = contexts.find((c) => c.id === contextId);
  if (!ctx) return;

  if (settings.showNotifications) showToast(`Restoring "${ctx.name}"...`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG.RESTORE_CONTEXT,
      contextId,
      closeCurrent: true,
    });

    if (response.success) {
      // Popup will close as tabs change — that's expected
    } else {
      showToast(response.error || 'Failed to restore', true);
    }
  } catch (e) {
    showToast('Failed to restore context', true);
  }
}

// ─── Pin Context ────────────────────────────────────────────────

async function handlePin(contextId) {
  await chrome.runtime.sendMessage({
    type: MSG.PIN_CONTEXT,
    contextId,
  });
  await loadContexts();
}

// ─── Rename Context ─────────────────────────────────────────────

function handleRename(ctx, itemEl) {
  const nameEl = itemEl.querySelector('.context-name');
  const currentName = ctx.name;

  // Replace the name with an input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'context-name-input';
  input.value = currentName;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  async function commitRename() {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      await chrome.runtime.sendMessage({
        type: MSG.RENAME_CONTEXT,
        contextId: ctx.id,
        name: newName,
      });
    }
    await loadContexts();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') loadContexts();
  });

  input.addEventListener('blur', commitRename);
}

// ─── Delete Context ─────────────────────────────────────────────

async function handleDelete(contextId, name) {
  // Simple confirmation via double-click pattern:
  // First click changes button to "Sure?", second click deletes
  const btn = document.querySelector(`[data-action="delete"][data-id="${contextId}"]`);
  if (!btn) return;

  if (btn.dataset.confirming === 'true') {
    await chrome.runtime.sendMessage({
      type: MSG.DELETE_CONTEXT,
      contextId,
    });
    if (settings.showNotifications) showToast(`Deleted "${name}"`);
    await loadContexts();
  } else {
    btn.dataset.confirming = 'true';
    btn.classList.add('btn-confirm');
    btn.title = 'Click again to confirm delete';

    // Reset after 3 seconds
    setTimeout(() => {
      if (btn.isConnected) {
        btn.dataset.confirming = 'false';
        btn.classList.remove('btn-confirm');
        btn.title = 'Delete';
      }
    }, 3000);
  }
}

// ─── Toast ──────────────────────────────────────────────────────

function showToast(message, isError = false) {
  // Remove existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger show animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-hide
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ─── Settings ───────────────────────────────────────────────────

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS });
  settings = { ...DEFAULT_SETTINGS, ...(response.settings || {}) };
}

function openSettings() {
  // Hide main view
  for (const el of mainViewEls) {
    if (el) el.style.display = 'none';
  }
  loadingEl.style.display = 'none';
  settingsBtn.style.display = 'none';

  // Populate setting values
  document.getElementById('set-restoreScrollPosition').checked = settings.restoreScrollPosition;
  document.getElementById('set-progressiveScroll').checked = settings.progressiveScroll;
  document.getElementById('set-restoreFormData').checked = settings.restoreFormData;
  document.getElementById('set-restoreSelections').checked = settings.restoreSelections;
  document.getElementById('set-openInNewWindow').checked = settings.openInNewWindow;
  document.getElementById('set-maxContexts').value = settings.maxContexts;
  document.getElementById('set-autoDeleteDays').value = settings.autoDeleteDays;
  document.getElementById('set-autoSaveOnClose').checked = settings.autoSaveOnClose;
  document.getElementById('set-showNotifications').checked = settings.showNotifications;

  // Show settings
  settingsPanel.style.display = 'block';

  // Listen for changes — save immediately on toggle
  settingsPanel.querySelectorAll('input').forEach((input) => {
    input.onchange = saveCurrentSettings;
  });
}

async function closeSettings() {
  await saveCurrentSettings();

  settingsPanel.style.display = 'none';
  settingsBtn.style.display = '';

  // Restore main view
  await loadContexts();
}

async function saveCurrentSettings() {
  settings.restoreScrollPosition = document.getElementById('set-restoreScrollPosition').checked;
  settings.progressiveScroll = document.getElementById('set-progressiveScroll').checked;
  settings.restoreFormData = document.getElementById('set-restoreFormData').checked;
  settings.restoreSelections = document.getElementById('set-restoreSelections').checked;
  settings.openInNewWindow = document.getElementById('set-openInNewWindow').checked;
  settings.maxContexts = parseInt(document.getElementById('set-maxContexts').value, 10) || 0;
  settings.autoDeleteDays = parseInt(document.getElementById('set-autoDeleteDays').value, 10) || 0;
  settings.autoSaveOnClose = document.getElementById('set-autoSaveOnClose').checked;
  settings.showNotifications = document.getElementById('set-showNotifications').checked;

  await chrome.runtime.sendMessage({ type: MSG.SAVE_SETTINGS, settings });
}

// ─── Helpers ────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(timestamp).toLocaleDateString();
}
