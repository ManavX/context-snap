/**
 * @typedef {Object} TabState
 * @property {string} url - Tab URL
 * @property {string} title - Tab title
 * @property {number} scrollX - Horizontal scroll position
 * @property {number} scrollY - Vertical scroll position
 * @property {boolean} pinned - Whether the tab was pinned
 * @property {boolean} active - Whether this was the active tab
 * @property {Object<string, string>} formData - Form input values keyed by selector
 * @property {string} selectedText - Any text that was selected
 * @property {string|null} faviconUrl - Favicon URL
 */

/**
 * @typedef {Object} ContextSnapshot
 * @property {string} id - Unique identifier
 * @property {string} name - User-given name
 * @property {TabState[]} tabs - Array of tab states
 * @property {number} createdAt - Timestamp
 * @property {number} tabCount - Number of tabs
 * @property {boolean} pinned - Whether this context is protected from auto-deletion
 */

// Message types for communication between components
export const MSG = {
  CAPTURE_TAB_STATE: 'CAPTURE_TAB_STATE',
  CAPTURE_RESULT: 'CAPTURE_RESULT',
  RESTORE_TAB_STATE: 'RESTORE_TAB_STATE',
  SAVE_CONTEXT: 'SAVE_CONTEXT',
  RESTORE_CONTEXT: 'RESTORE_CONTEXT',
  DELETE_CONTEXT: 'DELETE_CONTEXT',
  GET_CONTEXTS: 'GET_CONTEXTS',
  RENAME_CONTEXT: 'RENAME_CONTEXT',
  PIN_CONTEXT: 'PIN_CONTEXT',
  GET_SETTINGS: 'GET_SETTINGS',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  TAB_STATE_CACHE: 'TAB_STATE_CACHE',
};

export const DEFAULT_SETTINGS = {
  restoreScrollPosition: true,
  progressiveScroll: true,
  restoreFormData: true,
  restoreSelections: true,
  openInNewWindow: true,
  maxContexts: 20,
  autoDeleteDays: 0, // 0 = off
  autoSaveOnClose: true,
  showNotifications: true,
};
