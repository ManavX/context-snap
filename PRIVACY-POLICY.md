# Privacy Policy — ContextSnap

**Last updated:** March 17, 2026

## Overview

ContextSnap is a browser extension that saves and restores your browser state (open tabs, scroll positions, form inputs, and text selections). Your privacy is fundamental to how this extension is built.

## Data Collection

**ContextSnap does not collect, transmit, or share any user data.**

All data is stored locally on your device using the browser's built-in storage API (`chrome.storage.local`). No data is ever sent to external servers, third-party services, or the extension developer.

## What Data is Stored Locally

When you save a context, the following information is stored on your device:

- URLs and titles of open tabs
- Scroll positions (horizontal and vertical)
- Form input values (text fields, dropdowns, checkboxes, radio buttons)
- Text selections
- Tab metadata (pinned state, active tab)
- Your extension settings/preferences

**Sensitive data handling:**
- Password fields (`<input type="password">`) are never captured
- Hidden fields (`<input type="hidden">`) are never captured
- File upload fields (`<input type="file">`) are never captured

## Data Storage and Retention

- All data is stored locally using `chrome.storage.local`
- You can delete any saved context at any time through the extension popup
- You can configure automatic deletion of old contexts in Settings
- Uninstalling the extension removes all stored data

## Permissions

The extension requires the following permissions:

- **tabs** — to read open tab URLs and titles for saving/restoring
- **storage** — to save contexts and settings locally on your device
- **scripting** — to inject the content script that captures page state (scroll, forms, selections)
- **activeTab** — to interact with the currently active tab
- **host_permissions (all URLs)** — to capture and restore page state on any website you visit

These permissions are used exclusively for the core save/restore functionality. No data obtained through these permissions is transmitted externally.

## Third-Party Services

ContextSnap does not use any third-party services, analytics, tracking, or advertising.

## Changes to This Policy

Any changes to this privacy policy will be reflected in the extension update notes and this document.

## Contact

If you have questions about this privacy policy, please open an issue on the project's GitHub repository.
