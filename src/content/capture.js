/**
 * Content script — captures and restores full page state.
 *
 * Captures: scroll positions (window + all scrollable panels), form inputs,
 * text selections, and logs diagnostics for debugging.
 */

(() => {
  // Remove stale listener from previous injection if extension context was invalidated.
  // We can't keep the old listener — its chrome.runtime connection may be dead.
  if (window.__contextSnapshotsCleanup) {
    try { window.__contextSnapshotsCleanup(); } catch (e) { /* already dead */ }
  }

  const DEBUG = true; // Set to true to see console logs

  function log(...args) {
    if (DEBUG) console.log('[ContextSnapshots]', ...args);
  }

  // ─── Message Listener ───────────────────────────────────────────

  function messageHandler(message, sender, sendResponse) {
    if (message.type === 'CAPTURE_TAB_STATE') {
      try {
        const state = capturePageState();
        log('Captured state:', {
          scrollY: state.scrollY,
          formFields: Object.keys(state.formData).length,
          hasSelection: !!state.selectionContext,
        });
        sendResponse(state);
      } catch (e) {
        log('Capture error:', e);
        sendResponse({ scrollX: 0, scrollY: 0, formData: {}, selectedText: '' });
      }
      return true;
    }

    if (message.type === 'RESTORE_TAB_STATE') {
      try {
        restorePageState(message.state);
        sendResponse({ success: true });
      } catch (e) {
        log('Restore error:', e);
        sendResponse({ success: false });
      }
      return true;
    }
  }

  // Register the listener and store a cleanup function so re-injection
  // can remove the stale listener and register a fresh one.
  chrome.runtime.onMessage.addListener(messageHandler);

  // ─── Auto-Save: Cache state on beforeunload ───────────────────────

  function beforeUnloadHandler() {
    try {
      const state = capturePageState();
      chrome.runtime.sendMessage({
        type: 'TAB_STATE_CACHE',
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        scrollHeight: state.scrollHeight,
        formData: state.formData,
        selectedText: state.selectedText,
        selectionContext: state.selectionContext,
      });
    } catch (e) {
      // Extension context may be invalidated — silently ignore
    }
  }

  window.addEventListener('beforeunload', beforeUnloadHandler);

  window.__contextSnapshotsCleanup = () => {
    chrome.runtime.onMessage.removeListener(messageHandler);
    window.removeEventListener('beforeunload', beforeUnloadHandler);
  };

  log('Content script loaded (fresh listener registered)');

  // ─── CAPTURE ────────────────────────────────────────────────────

  function capturePageState() {
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      formData: captureAllFormData(),
      selectedText: window.getSelection()?.toString() || '',
      selectionContext: captureSelectionContext(),
    };
  }

  // ─── Form Data ──────────────────────────────────────────────────

  /**
   * Captures ALL input-like elements on the page.
   * Searches: main document, shadow DOMs, same-origin iframes.
   */
  function captureAllFormData() {
    const formData = {};
    let index = 0;

    // Main document + shadow DOM
    const elements = findAllInputs(document);
    for (const el of elements) {
      const value = extractValue(el);
      if (value === null) continue;

      const selector = buildBestSelector(el);
      if (selector) {
        formData[selector] = value;
        log('Captured field:', selector, value.type, value.value?.slice?.(0, 30) || value.value);
      } else {
        // Last resort: indexed fallback
        formData[`__idx_${el.tagName.toLowerCase()}_${index}`] = value;
      }
      index++;
    }

    // Same-origin iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (!doc) continue;

        const iframeSel = buildBestSelector(iframe);
        if (!iframeSel) continue;

        const iframeInputs = findAllInputs(doc);
        for (const el of iframeInputs) {
          const value = extractValue(el);
          if (value === null) continue;

          const elSel = buildBestSelector(el, doc);
          if (elSel) {
            formData[`__iframe__${iframeSel}||${elSel}`] = value;
            log('Captured iframe field:', elSel, value.type);
          }
        }
      } catch (e) {
        // Cross-origin — skip
      }
    }

    return formData;
  }

  /**
   * Finds all input-like elements in a root, including inside open shadow DOMs.
   */
  function findAllInputs(root) {
    const results = [];
    const SELECTOR = [
      'input:not([type="password"]):not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"])',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      '[role="textbox"]',
      '[role="searchbox"]',
      '[role="combobox"]',
      '[role="spinbutton"]',
    ].join(', ');

    try {
      const els = root.querySelectorAll(SELECTOR);
      for (const el of els) results.push(el);
    } catch (e) { /* skip */ }

    // Traverse shadow DOMs
    try {
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          results.push(...findAllInputs(el.shadowRoot));
        }
      }
    } catch (e) { /* skip */ }

    return results;
  }

  /**
   * Extracts the current value from an input-like element.
   */
  function extractValue(el) {
    // contenteditable / textbox role
    if (el.getAttribute('contenteditable') === 'true' ||
        el.getAttribute('contenteditable') === 'plaintext-only' ||
        el.getAttribute('role') === 'textbox') {
      const text = el.innerText?.trim();
      if (!text) return null;
      return { type: 'contenteditable', value: text, html: el.innerHTML };
    }

    // Select
    if (el.tagName === 'SELECT') {
      return { type: 'select', value: el.value };
    }

    // Checkbox / radio
    if (el.type === 'checkbox' || el.type === 'radio') {
      return { type: el.type, value: el.checked };
    }

    // Combobox (ARIA)
    if (el.getAttribute('role') === 'combobox') {
      const val = el.value || el.textContent?.trim() || '';
      return val ? { type: 'text', value: val } : null;
    }

    // Standard text input / textarea / search
    const val = el.value;
    if (val && val.trim()) {
      return { type: 'text', value: val };
    }

    return null;
  }

  // ─── Selector Builder ──────────────────────────────────────────

  /**
   * Builds the most stable CSS selector possible for an element.
   * Tries strategies in order of reliability.
   */
  function buildBestSelector(el, ownerDoc) {
    const doc = ownerDoc || el.ownerDocument || document;

    // 1. id (most reliable — but skip dynamic/generated IDs)
    if (el.id && isStableId(el.id)) {
      const sel = `#${CSS.escape(el.id)}`;
      if (isUnique(doc, sel, el)) return sel;
    }

    // 2. name
    if (el.name) {
      const sel = `[name="${CSS.escape(el.name)}"]`;
      if (isUnique(doc, sel, el)) return sel;
    }

    // 3. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      const sel = `[aria-label="${CSS.escape(ariaLabel)}"]`;
      if (isUnique(doc, sel, el)) return sel;
      // Try with tag
      const tagSel = `${el.tagName.toLowerCase()}${sel}`;
      if (isUnique(doc, tagSel, el)) return tagSel;
    }

    // 4. data-test attributes
    for (const attr of ['data-testid', 'data-test', 'data-test-id', 'data-automation-id', 'data-artdeco-is-focused']) {
      const val = el.getAttribute(attr);
      if (val) {
        const sel = `[${attr}="${CSS.escape(val)}"]`;
        if (isUnique(doc, sel, el)) return sel;
      }
    }

    // 5. placeholder
    if (el.placeholder) {
      const sel = `[placeholder="${CSS.escape(el.placeholder)}"]`;
      if (isUnique(doc, sel, el)) return sel;
    }

    // 6. type (for inputs)
    if (el.getAttribute('type')) {
      const sel = `${el.tagName.toLowerCase()}[type="${CSS.escape(el.getAttribute('type'))}"]`;
      if (isUnique(doc, sel, el)) return sel;
    }

    // 7. role
    if (el.getAttribute('role')) {
      const sel = `[role="${CSS.escape(el.getAttribute('role'))}"]`;
      if (isUnique(doc, sel, el)) return sel;
      const tagSel = `${el.tagName.toLowerCase()}${sel}`;
      if (isUnique(doc, tagSel, el)) return tagSel;
    }

    // 8. class combination (try unique class combos)
    if (el.classList && el.classList.length > 0) {
      // Try all classes combined
      const classSelector = el.tagName.toLowerCase() +
        Array.from(el.classList).map(c => `.${CSS.escape(c)}`).join('');
      if (isUnique(doc, classSelector, el)) return classSelector;
    }

    // 9. Ancestor-anchored path (find closest parent with id)
    const anchoredPath = buildAnchoredPath(el, doc);
    if (anchoredPath) return anchoredPath;

    // 10. Full CSS path from body
    const fullPath = buildFullPath(el, doc);
    if (fullPath) return fullPath;

    return null;
  }

  function isUnique(doc, selector, expectedEl) {
    try {
      const results = doc.querySelectorAll(selector);
      return results.length === 1 && results[0] === expectedEl;
    } catch (e) {
      return false;
    }
  }

  /**
   * Detects whether an ID is stable (likely hand-authored) vs dynamic (generated).
   * Skips UUIDs, long hex strings, and IDs with multiple UUID-like segments.
   */
  function isStableId(id) {
    // UUID pattern: 8-4-4-4-12 hex (with or without segments around it)
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(id)) return false;
    // Long hex strings (16+ hex chars in a row)
    if (/[0-9a-f]{16,}/i.test(id)) return false;
    // IDs that are mostly digits/hex with dashes (e.g., "1910355c-0ab3-48a6-...")
    const alnumOnly = id.replace(/[-_]/g, '');
    if (alnumOnly.length > 20 && /^[0-9a-f]+$/i.test(alnumOnly)) return false;
    return true;
  }

  /**
   * Builds a selector anchored to the nearest ancestor with an id.
   */
  function buildAnchoredPath(el, doc) {
    const path = [];
    let current = el;

    while (current && current !== doc.body && current !== doc.documentElement) {
      let segment = current.tagName.toLowerCase();

      if (current.id && current !== el && isStableId(current.id)) {
        const anchorSel = `#${CSS.escape(current.id)}`;
        const relPath = path.join(' > ');
        const full = relPath ? `${anchorSel} > ${relPath}` : anchorSel;
        if (isUnique(doc, full, el)) return full;
        break;
      }

      // Add nth-of-type for disambiguation
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      path.unshift(segment);
      current = parent;
    }
    return null;
  }

  /**
   * Builds a full CSS path from body to the element.
   */
  function buildFullPath(el, doc) {
    const path = [];
    let current = el;

    while (current && current !== doc.body && current !== doc.documentElement) {
      let segment = current.tagName.toLowerCase();

      if (current.id && isStableId(current.id)) {
        path.unshift(`#${CSS.escape(current.id)}`);
        break;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      path.unshift(segment);
      current = parent;
    }

    const full = path.join(' > ');
    if (isUnique(doc, full, el)) return full;
    return null;
  }

  // ─── Selection Capture ──────────────────────────────────────────

  function captureSelectionContext() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const text = sel.toString();
    if (!text.trim()) return null;

    const range = sel.getRangeAt(0);

    // Get anchor element for scoping the search on restore
    let anchor = range.commonAncestorContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentElement;
    const anchorSelector = buildBestSelector(anchor);

    // Get surrounding text for disambiguation
    let prefix = '', suffix = '';
    try {
      const startNode = range.startContainer;
      if (startNode.nodeType === Node.TEXT_NODE) {
        prefix = startNode.textContent.slice(Math.max(0, range.startOffset - 40), range.startOffset);
      }
      const endNode = range.endContainer;
      if (endNode.nodeType === Node.TEXT_NODE) {
        suffix = endNode.textContent.slice(range.endOffset, range.endOffset + 40);
      }
    } catch (e) { /* skip */ }

    return { text, anchorSelector, prefix, suffix };
  }

  // ─── RESTORE ────────────────────────────────────────────────────

  function restorePageState(state) {
    if (!state) return;
    log('Restoring state:', {
      scrollY: state.scrollY,
      formFields: Object.keys(state.formData || {}).length,
      hasSelection: !!state.selectionContext,
    });

    // Restore window scroll first — if progressive scroll is needed,
    // wait for it to finish before restoring other state (elements
    // won't exist in the DOM until lazy content loads)
    restoreWindowScroll(state, () => {
      log('Scroll complete — restoring remaining state');

      // Restore form data
      if (state.formData && Object.keys(state.formData).length > 0) {
        restoreFormData(state.formData);
        // Single retry for dynamic content (React hydration, lazy forms)
        setTimeout(() => {
          restoreFormData(state.formData);
          // Restore text selection AFTER the retry pass — el.focus() in
          // applyValue steals focus and collapses any existing selection
          if (state.selectionContext) {
            setTimeout(() => restoreSelection(state.selectionContext), 500);
          }
        }, 1500);
      } else if (state.selectionContext) {
        // No form data — restore selection directly
        setTimeout(() => restoreSelection(state.selectionContext), 500);
      }
    });
  }

  function restoreWindowScroll(state, onComplete) {
    const x = state.scrollX || 0;
    const y = state.scrollY || 0;
    if (x === 0 && y === 0) {
      // Force scroll to top — override browser's built-in scroll restoration
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      window.scrollTo(0, 0);
      onComplete();
      return;
    }

    const savedHeight = state.scrollHeight || 0;
    const progressiveEnabled = state.progressiveScroll !== false;
    const wouldNeedProgressive = savedHeight > 0 && y > document.documentElement.scrollHeight * 0.8;

    if (wouldNeedProgressive && !progressiveEnabled) {
      // Page needs progressive scroll but it's disabled — skip scroll entirely
      log('Progressive scroll disabled — skipping scroll to', y);
      onComplete();
      return;
    }

    if (!wouldNeedProgressive) {
      // Simple scroll for pages where content already exists
      window.scrollTo(x, y);
      setTimeout(() => { window.scrollTo(x, y); onComplete(); }, 500);
      return;
    }

    // Progressive scroll for infinite-scroll pages:
    // Scroll down in large steps to trigger lazy loading until we reach the target
    log('Progressive scroll needed — target:', y, 'current page height:', document.documentElement.scrollHeight);

    let attempts = 0;
    let staleCount = 0; // Consecutive steps with no page growth
    const maxAttempts = 60; // Safety cap
    const maxStale = 5; // Give up after 5 consecutive no-growth steps (tolerates slow connections)
    const stepSize = Math.max(2000, window.innerHeight * 2); // Large steps for speed

    function done() {
      // Small delay after final scroll for DOM to settle
      setTimeout(onComplete, 300);
    }

    function scrollStep() {
      attempts++;
      const currentHeight = document.documentElement.scrollHeight;

      // Reached or passed target — snap to exact position
      if (currentHeight >= y + window.innerHeight || window.scrollY >= y - 5) {
        window.scrollTo(x, y);
        log('Progressive scroll complete after', attempts, 'steps');
        done();
        return;
      }

      // Scroll down by a large step
      const prevScroll = window.scrollY;
      window.scrollBy(0, stepSize);

      setTimeout(() => {
        const newHeight = document.documentElement.scrollHeight;
        if (attempts >= maxAttempts) {
          window.scrollTo(x, Math.min(y, newHeight - window.innerHeight));
          log('Progressive scroll gave up after', attempts, 'steps');
          done();
          return;
        }

        if (newHeight === currentHeight && window.scrollY === prevScroll) {
          staleCount++;
          if (staleCount >= maxStale) {
            window.scrollTo(x, Math.min(y, newHeight - window.innerHeight));
            log('Progressive scroll stopped — page not growing after', staleCount, 'retries');
            done();
            return;
          }
          // Wait longer — content is still loading over the network
          log('Progressive scroll stale attempt', staleCount, '— waiting longer...');
          setTimeout(scrollStep, 1500);
          return;
        }

        // Page grew — reset stale counter and continue quickly
        staleCount = 0;
        setTimeout(scrollStep, 300);
      }, 400); // Short wait between steps when content is loading
    }

    scrollStep();
  }

  // ─── Form Restore ──────────────────────────────────────────────

  function restoreFormData(formData) {
    let restored = 0;
    let failed = 0;

    for (const [selector, data] of Object.entries(formData)) {
      try {
        // Iframe fields
        if (selector.startsWith('__iframe__')) {
          const parts = selector.match(/^__iframe__(.+?)\|\|(.+)$/);
          if (!parts) continue;
          const [, iframeSel, elSel] = parts;
          try {
            const iframe = document.querySelector(iframeSel);
            const doc = iframe?.contentDocument;
            if (doc) {
              const el = doc.querySelector(elSel);
              if (el) { applyValue(el, data); restored++; continue; }
            }
          } catch (e) { /* cross-origin */ }
          failed++;
          continue;
        }

        // Index-based fallback
        if (selector.startsWith('__idx_')) {
          // Can't reliably restore these — skip
          continue;
        }

        // Standard selector — try document, then shadow DOM
        let el = null;
        try { el = document.querySelector(selector); } catch (e) { /* invalid selector */ }

        if (!el) el = findInShadowDom(document, selector);

        if (el) {
          applyValue(el, data);
          restored++;
        } else {
          failed++;
          log('Could not find element for:', selector);
        }
      } catch (e) {
        failed++;
        log('Error restoring:', selector, e.message);
      }
    }

    log(`Restored ${restored} fields, ${failed} failed`);
  }

  function findInShadowDom(root, selector) {
    const elements = root.querySelectorAll('*');
    for (const el of elements) {
      if (el.shadowRoot) {
        try {
          const found = el.shadowRoot.querySelector(selector);
          if (found) return found;
          const deeper = findInShadowDom(el.shadowRoot, selector);
          if (deeper) return deeper;
        } catch (e) { /* skip */ }
      }
    }
    return null;
  }

  /**
   * Applies a value to an element, using React-compatible techniques.
   */
  function applyValue(el, data) {
    log('Applying value to:', el.tagName, data.type, data.value?.toString?.().slice(0, 20));

    if (data.type === 'contenteditable') {
      if (data.html) {
        el.innerHTML = data.html;
      } else {
        el.innerText = data.value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (data.type === 'checkbox' || data.type === 'radio') {
      if (el.checked === data.value) return; // Already correct — skip to avoid toggling
      el.checked = data.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('click', { bubbles: true }));
      return;
    }

    if (data.type === 'select') {
      if (el.value === data.value) return; // Already correct
      el.value = data.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Text input / textarea
    // Focus first — many sites (GitHub, etc.) expand collapsed input
    // containers when the element receives real focus
    try { el.focus(); } catch (e) { /* some elements can't be focused */ }

    // If the element is inside a hidden/collapsed container, try clicking
    // nearby trigger elements to expand it (e.g., GitHub "Reply..." buttons)
    if (el.offsetHeight === 0 || getComputedStyle(el).display === 'none') {
      const container = el.closest('form, details, [data-reply], .js-inline-comment-form') ||
                        el.parentElement;
      if (container) {
        // Look for a trigger: summary (for <details>), button, or clickable element
        const trigger = container.querySelector('summary, button, [role="button"], .js-toggle-inline-comment-form') ||
                        container.previousElementSibling;
        if (trigger) {
          log('Clicking trigger to expand hidden input:', trigger.tagName, trigger.className);
          trigger.click();
        }
      }
    }

    // Must use the native value setter to work with React
    const proto = Object.getPrototypeOf(el);
    const nativeSetter =
      Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

    // Skip if value already matches (avoids re-triggering on retry pass)
    if (el.value === data.value) return;

    if (nativeSetter) {
      nativeSetter.call(el, data.value);
    } else {
      el.value = data.value;
    }

    // Dispatch all events React/Vue/Angular might listen to
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ─── Selection Restore ─────────────────────────────────────────

  function restoreSelection(ctx) {
    if (!ctx?.text) return;
    log('Selection restore — looking for:', JSON.stringify(ctx.text.slice(0, 60)),
      'anchor:', ctx.anchorSelector);

    // Don't override if user already selected something
    const currentSel = window.getSelection();
    if (currentSel && !currentSel.isCollapsed) return;

    // Remove focus from any input — focused inputs steal selection
    try { document.activeElement?.blur(); } catch (e) { /* skip */ }

    // Find search scope — try anchor first, then broaden to body
    let searchRoot = document.body;
    let anchorFound = false;
    if (ctx.anchorSelector) {
      try {
        const anchor = document.querySelector(ctx.anchorSelector);
        if (anchor) {
          searchRoot = anchor;
          anchorFound = true;
        }
      } catch (e) { /* use body */ }
    }
    log('Selection search root:', anchorFound ? ctx.anchorSelector : 'document.body');

    // Build text map from all text nodes
    const charMap = buildCharMap(searchRoot);

    // If anchor was found but no text nodes inside, broaden to body
    if (charMap.length === 0 && anchorFound) {
      log('No text nodes in anchor — broadening to document.body');
      charMap.push(...buildCharMap(document.body));
    }

    if (charMap.length === 0) {
      log('Selection restore failed — no text nodes found');
      return;
    }

    log('Selection search — charMap size:', charMap.length);

    const haystack = charMap.map(c => c.node.textContent[c.offset]).join('');
    const needle = ctx.text;

    // Find all matches
    const matches = [];
    let pos = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
      matches.push(pos);
      pos++;
    }

    if (matches.length === 0) {
      // If we searched in a narrow anchor, retry with full body
      if (anchorFound) {
        log('Selection text not found in anchor — retrying with document.body');
        restoreSelection({ ...ctx, anchorSelector: null });
        return;
      }
      log('Selection text not found in DOM');
      return;
    }

    log('Selection matches found:', matches.length);

    // Pick best match using surrounding context
    let bestIdx = matches[0];
    if (matches.length > 1) {
      let bestScore = -1;
      for (const idx of matches) {
        let score = 0;
        if (ctx.prefix) {
          const before = haystack.slice(Math.max(0, idx - ctx.prefix.length), idx);
          if (before.endsWith(ctx.prefix)) score += 3;
          else if (before.includes(ctx.prefix.slice(-15))) score += 1;
        }
        if (ctx.suffix) {
          const after = haystack.slice(idx + needle.length, idx + needle.length + ctx.suffix.length);
          if (after.startsWith(ctx.suffix)) score += 3;
          else if (after.includes(ctx.suffix.slice(0, 15))) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }
    }

    // Create range
    const start = charMap[bestIdx];
    const endCharIdx = bestIdx + needle.length - 1;
    const end = charMap[endCharIdx];
    if (!start || !end) return;

    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      log('Selection restored');
    } catch (e) {
      log('Selection restore failed:', e.message);
    }
  }

  /**
   * Builds a character map from all text nodes under a root element.
   * Each entry maps a character position to its DOM node and offset.
   */
  function buildCharMap(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const map = [];
    let node;
    while ((node = walker.nextNode())) {
      const content = node.textContent;
      for (let i = 0; i < content.length; i++) {
        map.push({ node, offset: i });
      }
    }
    return map;
  }
})();
