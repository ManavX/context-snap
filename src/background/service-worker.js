/**
 * Background service worker.
 * Coordinates capturing tab state, saving/restoring contexts, and handling keyboard shortcuts.
 */

import { MSG, DEFAULT_SETTINGS } from '../shared/types.js';

// ─── Install / Update ───────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/changelog/changelog.html'),
    });
  }
});

// ─── Script Injection ───────────────────────────────────────────────

/**
 * Injects the content script into a tab's main frame and all accessible sub-frames.
 * Silently handles cross-origin frames that block injection.
 */
async function injectContentScript(tabId) {
  // Inject into main frame only. Same-origin iframes are already handled
  // by the main frame's content script (via iframe.contentDocument).
  // Injecting into sub-frames causes chrome-extension://invalid/ errors
  // on sites with cross-origin iframes (e.g., LinkedIn).
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['src/content/capture.js'],
    });
  } catch (e) {
    console.log(`Could not inject into main frame of tab ${tabId}: ${e.message}`);
  }
}

// ─── Storage Helpers ────────────────────────────────────────────────

async function getContexts() {
  const result = await chrome.storage.local.get('contexts');
  return result.contexts || [];
}

async function saveContexts(contexts) {
  await chrome.storage.local.set({ contexts });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

/**
 * Enforces maxContexts and autoDeleteDays limits, skipping pinned contexts.
 */
function enforceContextLimits(contexts, settings) {
  // Enforce max contexts limit (skip pinned)
  if (settings.maxContexts > 0 && contexts.length > settings.maxContexts) {
    const result = [];
    let unpinnedCount = 0;
    const pinnedTotal = contexts.filter((c) => c.pinned).length;
    const maxUnpinned = Math.max(0, settings.maxContexts - pinnedTotal);
    for (const c of contexts) {
      if (c.pinned) {
        result.push(c);
      } else if (unpinnedCount < maxUnpinned) {
        result.push(c);
        unpinnedCount++;
      }
    }
    contexts = result;
  }

  // Auto-delete old contexts (skip pinned)
  if (settings.autoDeleteDays > 0) {
    const cutoff = Date.now() - settings.autoDeleteDays * 86400000;
    contexts = contexts.filter((c) => c.pinned || c.createdAt > cutoff);
  }

  return contexts;
}

// ─── Tab State Capture ──────────────────────────────────────────────

/**
 * Captures the full state of a single tab by messaging its content script.
 */
async function captureTabState(tab) {
  const tabState = {
    url: tab.url,
    title: tab.title || '',
    pinned: tab.pinned || false,
    active: tab.active || false,
    faviconUrl: tab.favIconUrl || null,
    scrollX: 0,
    scrollY: 0,
    scrollHeight: 0,
    formData: {},
    selectedText: '',
    selectionContext: null,
  };

  // Skip chrome:// , chrome-extension://, and other restricted URLs
  if (!tab.url || !tab.url.startsWith('http')) {
    return tabState;
  }

  try {
    // Inject content script into the main frame
    await injectContentScript(tab.id);

    // Send ONLY to the main frame (frameId: 0) — our content script
    // handles iframes internally. Without this, an iframe's content script
    // might respond first with empty data, beating the main frame's response.
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: MSG.CAPTURE_TAB_STATE,
    }, { frameId: 0 });

    if (response) {
      tabState.scrollX = response.scrollX || 0;
      tabState.scrollY = response.scrollY || 0;
      tabState.scrollHeight = response.scrollHeight || 0;
      tabState.formData = response.formData || {};
      tabState.selectedText = response.selectedText || '';
      tabState.selectionContext = response.selectionContext || null;
    }
  } catch (e) {
    // Content script might not be loaded (e.g., just-opened tab) — that's okay
    console.log(`Could not capture state for tab ${tab.id}: ${e.message}`);
  }

  return tabState;
}

/**
 * Captures the entire browser context: all tabs in the current window.
 */
async function captureFullContext(name) {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  const tabStates = await Promise.all(
    tabs.map((tab) => captureTabState(tab))
  );

  const context = {
    id: generateId(),
    name: name || `Context ${new Date().toLocaleString()}`,
    tabs: tabStates,
    createdAt: Date.now(),
    tabCount: tabStates.length,
  };

  return context;
}

// ─── Context Restore ────────────────────────────────────────────────

/**
 * Restores a saved context: opens tabs and restores their state.
 */
async function restoreContext(contextId, closeCurrent) {
  const contexts = await getContexts();
  const settings = await getSettings();
  const context = contexts.find((c) => c.id === contextId);
  if (!context) return { success: false, error: 'Context not found' };

  const useNewWindow = settings.openInNewWindow !== false;

  let targetWindowId = null;

  if (useNewWindow) {
    // Create a new window — Chrome opens it with one blank tab
    const newWindow = await chrome.windows.create({ focused: true });
    targetWindowId = newWindow.id;
  } else if (closeCurrent) {
    // Close all current tabs except one (Chrome requires at least one)
    const currentTabs = await chrome.tabs.query({ currentWindow: true });
    const tabIds = currentTabs.map((t) => t.id);
    if (tabIds.length > 1) {
      await chrome.tabs.remove(tabIds.slice(1));
    }
  }

  // Open all tabs from the context
  let activeTabId = null;
  const openedTabs = [];

  for (const tabState of context.tabs) {
    try {
      const createOpts = {
        url: tabState.url,
        pinned: tabState.pinned,
        active: false, // We'll activate the right one at the end
      };
      if (targetWindowId) createOpts.windowId = targetWindowId;

      const newTab = await chrome.tabs.create(createOpts);
      openedTabs.push({ tab: newTab, state: tabState });

      if (tabState.active) {
        activeTabId = newTab.id;
      }
    } catch (e) {
      console.log(`Could not open tab ${tabState.url}: ${e.message}`);
    }
  }

  // Clean up the blank tab (from new window creation or closeCurrent)
  const isBlankTab = (url) =>
    url === 'chrome://newtab/' || url === 'about:newtab' || url === 'about:home' || url === 'about:blank';

  if (useNewWindow && targetWindowId) {
    const windowTabs = await chrome.tabs.query({ windowId: targetWindowId });
    const blankTab = windowTabs.find(
      (t) => isBlankTab(t.url) && !openedTabs.some((o) => o.tab.id === t.id)
    );
    if (blankTab && windowTabs.length > 1) {
      await chrome.tabs.remove(blankTab.id);
    }
  } else if (closeCurrent) {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const blankTab = allTabs.find(
      (t) => isBlankTab(t.url) && !openedTabs.some((o) => o.tab.id === t.id)
    );
    if (blankTab && allTabs.length > 1) {
      await chrome.tabs.remove(blankTab.id);
    }
  }

  // Activate the tab that was previously active
  if (activeTabId) {
    await chrome.tabs.update(activeTabId, { active: true });
  }

  // Restore page state (scroll, forms) after tabs load
  for (const { tab, state } of openedTabs) {
    restoreTabAfterLoad(tab.id, state, settings);
  }

  return { success: true, tabCount: openedTabs.length };
}

/**
 * Waits for a tab to finish loading, then restores its page state.
 */
function restoreTabAfterLoad(tabId, tabState, settings) {
  const stateToRestore = {
    scrollX: settings.restoreScrollPosition ? tabState.scrollX : 0,
    scrollY: settings.restoreScrollPosition ? tabState.scrollY : 0,
    scrollHeight: settings.restoreScrollPosition ? tabState.scrollHeight : 0,
    progressiveScroll: settings.progressiveScroll,
    formData: settings.restoreFormData ? tabState.formData : {},
    selectionContext: settings.restoreSelections ? tabState.selectionContext : null,
  };

  // Only restore if there's something to restore
  const hasState =
    stateToRestore.scrollY > 0 ||
    stateToRestore.scrollX > 0 ||
    Object.keys(stateToRestore.formData).length > 0 ||
    stateToRestore.selectionContext;

  if (!hasState) return;

  function onUpdated(updatedTabId, changeInfo) {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(onUpdated);

      // Inject content script first, then send restore message
      setTimeout(async () => {
        try {
          await injectContentScript(tabId);

          // Small extra delay for script to initialize
          await new Promise((r) => setTimeout(r, 200));

          await chrome.tabs.sendMessage(tabId, {
            type: 'RESTORE_TAB_STATE',
            state: stateToRestore,
          }, { frameId: 0 });
        } catch (e) {
          console.log(`Could not restore state for tab ${tabId}: ${e.message}`);
        }
      }, 500);
    }
  }

  chrome.tabs.onUpdated.addListener(onUpdated);

  // Safety timeout — remove listener after 30s to prevent leaks
  setTimeout(() => {
    chrome.tabs.onUpdated.removeListener(onUpdated);
  }, 30000);
}

// ─── Message Handler ────────────────────────────────────────────────

// ─── Auto-Save Tab State Cache ──────────────────────────────────────

// Maps tabId → { windowId, state } for auto-save on window close
const tabStateCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.TAB_STATE_CACHE && sender.tab) {
    tabStateCache.set(sender.tab.id, {
      windowId: sender.tab.windowId,
      state: {
        url: sender.tab.url,
        title: sender.tab.title || '',
        pinned: sender.tab.pinned || false,
        active: sender.tab.active || false,
        faviconUrl: sender.tab.favIconUrl || null,
        scrollX: message.scrollX || 0,
        scrollY: message.scrollY || 0,
        scrollHeight: message.scrollHeight || 0,
        formData: message.formData || {},
        selectedText: message.selectedText || '',
        selectionContext: message.selectionContext || null,
      },
    });
    sendResponse({ success: true });
    return;
  }

  handleMessage(message).then(sendResponse);
  return true; // Keep the message channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case MSG.SAVE_CONTEXT: {
      const settings = await getSettings();
      const context = await captureFullContext(message.name);
      let contexts = await getContexts();
      contexts.unshift(context); // Newest first
      contexts = enforceContextLimits(contexts, settings);
      await saveContexts(contexts);
      return { success: true, context };
    }

    case MSG.RESTORE_CONTEXT: {
      return await restoreContext(message.contextId, message.closeCurrent ?? true);
    }

    case MSG.DELETE_CONTEXT: {
      const contexts = await getContexts();
      const filtered = contexts.filter((c) => c.id !== message.contextId);
      await saveContexts(filtered);
      return { success: true };
    }

    case MSG.GET_CONTEXTS: {
      const contexts = await getContexts();
      return { contexts };
    }

    case MSG.PIN_CONTEXT: {
      const contexts = await getContexts();
      const ctx = contexts.find((c) => c.id === message.contextId);
      if (ctx) {
        ctx.pinned = !ctx.pinned;
        await saveContexts(contexts);
        return { success: true, pinned: ctx.pinned };
      }
      return { success: false, error: 'Context not found' };
    }

    case MSG.RENAME_CONTEXT: {
      const contexts = await getContexts();
      const ctx = contexts.find((c) => c.id === message.contextId);
      if (ctx) {
        ctx.name = message.name;
        await saveContexts(contexts);
        return { success: true };
      }
      return { success: false, error: 'Context not found' };
    }

    case MSG.GET_SETTINGS: {
      const settings = await getSettings();
      return { settings };
    }

    case MSG.SAVE_SETTINGS: {
      await saveSettings(message.settings);
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ─── Keyboard Shortcuts ─────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'save-context') {
    const settings = await getSettings();
    const context = await captureFullContext(
      `Quick Save — ${new Date().toLocaleString()}`
    );
    let contexts = await getContexts();
    contexts.unshift(context);
    contexts = enforceContextLimits(contexts, settings);
    await saveContexts(contexts);

    // Show a badge briefly to confirm save
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 2000);
  }

  if (command === 'show-contexts') {
    chrome.action.openPopup();
  }
});

// ─── Auto-Save on Window Close ──────────────────────────────────────

// Clean up cache when a tab is closed individually (not during window close)
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) {
    tabStateCache.delete(tabId);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const settings = await getSettings();
  if (!settings.autoSaveOnClose) return;

  // Collect cached states for tabs that belonged to this window
  const tabStates = [];
  for (const [tabId, entry] of tabStateCache) {
    if (entry.windowId === windowId) {
      tabStates.push(entry.state);
      tabStateCache.delete(tabId);
    }
  }

  // Skip empty windows or windows with only blank tabs
  const isBlankUrl = (url) =>
    !url || url === 'chrome://newtab/' || url === 'about:newtab' || url === 'about:home' || url === 'about:blank';
  const realTabs = tabStates.filter((t) => !isBlankUrl(t.url));
  if (realTabs.length === 0) return;

  const context = {
    id: generateId(),
    name: `Auto Save — ${new Date().toLocaleString()}`,
    tabs: tabStates,
    createdAt: Date.now(),
    tabCount: tabStates.length,
  };

  let contexts = await getContexts();
  contexts.unshift(context);
  contexts = enforceContextLimits(contexts, settings);
  await saveContexts(contexts);
});
