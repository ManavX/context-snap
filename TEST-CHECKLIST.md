# ContextSnap — Test Checklist

Test each site by: **open page -> interact (scroll, fill forms, select text) -> Save -> close tabs -> Restore -> verify state**

## Forms Baseline
- [X] **roboform.com/filling-test-all-fields** — text, dropdowns, checkboxes, radios, textareas
  - [X] All field types restored correctly
  - [X] Scroll position restored (page is long)

## Auth + Scroll
- [X] **Gmail inbox** — scroll down in inbox, start composing a draft
  - [X] Scroll position restored
  - [X] Draft compose box text (if captured)
- [X] **GitHub long issue/PR thread** — scroll midway, type in comment box
  - [X] Scroll restored
  - [X] Comment box text restored
- [X] **LinkedIn feed** — scroll down feed
  - [X] Scroll restored (progressive scroll likely needed)
  - [X] No extension errors (ignore LinkedIn's own `chrome-extension://invalid/`)

## Infinite Scroll (Progressive Scroll)
- [X] **YouTube subscriptions feed** — scroll deep, select text in a comment
  - [X] Progressive scroll triggers
  - [X] Scroll position approximately correct
  - [X] Text selection restored (may be unreliable for comments)
- [X] **Twitter/X timeline** — scroll deep into feed
  - [X] Progressive scroll triggers
  - [X] Position approximately restored
- [X] **Indeed job search results** — scroll through listings
  - [X] Progressive scroll triggers when enabled
  - [X] NO scroll when progressive scroll disabled
- [X] **Reddit front page (logged in)** — scroll deep
  - [X] Progressive scroll triggers
- [X] **Pinterest explore** — masonry grid, scroll deep
  - [X] Progressive scroll triggers

## SPAs (URL-based state)
- [X] **Google Maps** — navigate to a specific location, zoom in
  - [X] Map location/zoom restored via URL
  - [X] Sidebar state (if any) — expected to lose this
- [X] **Notion page** — scroll midway through a long doc
  - [X] Page opens correctly
  - [X] Scroll position restored
- [X] **Google Docs** — scroll midway, select text
  - [X] Page opens correctly
  - [X] Scroll restored
  - [ ] Text selection (likely unreliable — Docs uses custom rendering)
- [X] **Trello board** — open a card (URL hash), scroll board
  - [X] Card modal reopens via URL
  - [X] Board scroll position

## Heavy Forms (Auth Required)
- [X] **Google Forms** — fill out a multi-question form (radios, checkboxes, text, dropdowns)
  - [X] All field types restored
- [X] **Greenhouse/Lever job application** — fill partial application
  - [X] Text fields restored
  - [ ] File uploads — expected to NOT restore (can't programmatically set)
- [X] **Typeform survey** — answer a few questions
  - [X] Current question state (SPA, may not restore mid-form)

## Edge Cases
- [X] **Pinned tabs** — pin 2 tabs, save context
  - [X] Tabs restore as pinned
- [X] **about:blank / chrome://newtab/** — include in context
  - [X] Skipped gracefully, no errors
- [X] **PDF in Chrome viewer** — open a PDF in a tab
  - [X] Tab URL restored (PDF reloads)
  - [ ] Scroll position in PDF (unlikely — Chrome PDF viewer is sandboxed)
- [X] **Banking/CSP-heavy site** — e.g., chase.com, any bank login page
  - [X] Tab opens, no crash
  - [X] Content script injection may fail silently — that's OK
- [X] **Multiple saved contexts** — save 3+ contexts, restore each
  - [X] All listed correctly in popup
  - [X] Each restores independently
  - [X] Rename works
  - [X] Delete works (double-click confirm)

## Settings Verification
- [X] **Progressive scroll OFF** — restore a YouTube/Indeed page
  - [X] NO scrolling occurs at all
- [X] **Restore form data OFF** — restore roboform test page
  - [X] Scroll restores, but form fields are empty
- [X] **Restore text selections OFF** — restore a page with selected text
  - [X] Scroll + forms restore, but no text highlighted
- [X] **Show notifications OFF** — save and restore
  - [X] No toast messages appear
- [X] **Max contexts = 3** — save 5 contexts
  - [X] Only 3 most recent appear
- [X] **Auto-delete after 1 day** — save context, change system clock +2 days, save another
  - [X] Old context auto-removed

## Quick Smoke Test (5 min)
1. [X] Open roboform test page + YouTube + GitHub issue (3 tabs)
2. [X] Fill roboform fields, scroll YouTube, type in GitHub comment box
3. [X] Save as "Smoke Test"
4. [X] Close all tabs
5. [X] Restore "Smoke Test"
6. [X] Verify: tabs open, forms filled, scroll positions correct, pinned state correct
