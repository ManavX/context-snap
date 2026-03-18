/**
 * Background service worker.
 * Coordinates capturing tab state, saving/restoring contexts, and handling keyboard shortcuts.
 */

import { MSG, DEFAULT_SETTINGS } from '../shared/types.js';

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

      // Enforce max contexts limit
      if (settings.maxContexts > 0 && contexts.length > settings.maxContexts) {
        contexts = contexts.slice(0, settings.maxContexts);
      }

      // Auto-delete old contexts
      if (settings.autoDeleteDays > 0) {
        const cutoff = Date.now() - settings.autoDeleteDays * 86400000;
        contexts = contexts.filter((c) => c.createdAt > cutoff);
      }

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
    const context = await captureFullContext(
      `Quick Save — ${new Date().toLocaleString()}`
    );
    const contexts = await getContexts();
    contexts.unshift(context);
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
