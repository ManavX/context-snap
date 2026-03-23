![Image](https://github.com/ManavX/context-snap/blob/main/assets/icons/marquee-promo-1400x560.png)
## Features

- **Full state capture** — tabs, scroll positions, form data, text selections, pinned tabs
- **Progressive scroll** — handles infinite-scroll pages (YouTube, Twitter, Reddit) by scrolling down to trigger lazy loading before restoring position
- **Smart form restore** — works with React, Vue, Angular apps and dynamic forms (Greenhouse, Ashby, Lever)
- **Keyboard shortcuts** — Ctrl+Shift+S to quick save, Ctrl+Shift+A to open context list
- **Granular settings** — control what gets restored, set context limits, auto-delete old saves
- **Privacy first** — all data stays local, no servers, no tracking

## Install

### Chrome Web Store
[Chrome](https://chromewebstore.google.com/detail/contextsnap/hdgnghakdpijiahejbplhnfhgoocckji)

### Firefox Add-ons
[Firefox](https://addons.mozilla.org/en-CA/firefox/addon/contextsnap/)

### From source

1. Clone the repo:
   ```
   git clone https://github.com/ManavX/context-snap.git
   cd context-snap
   ```

2. Build:
   ```
   node scripts/build.js          # builds both Chrome and Firefox
   node scripts/build.js chrome   # Chrome only
   node scripts/build.js firefox  # Firefox only
   ```

3. Load in Chrome:
   - Go to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" and select `dist/chrome`

4. Load in Firefox:
   - Go to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `dist/firefox/manifest.json`

## Project Structure

```
contextsnap/
├── src/
│   ├── background/service-worker.js   # Orchestrates capture/restore, storage
│   ├── content/capture.js             # Injected per-tab, captures/restores state
│   ├── popup/                         # Extension popup UI + settings panel
│   └── shared/types.js                # Message types + default settings
├── assets/icons/                      # Extension icons (16, 48, 128)
├── scripts/build.js                   # Multi-browser build script
├── manifest.json                      # Chrome manifest (source)
└── dist/                              # Built output (gitignored)
    ├── chrome/
    └── firefox/
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Restore scroll position | On | Restores where you were scrolled to on each tab |
| Progressive scroll | On | Scrolls down on infinite-scroll pages to reload content |
| Restore form data | On | Re-fills text inputs, dropdowns, checkboxes, radios |
| Restore text selections | On | Re-highlights selected text |
| Open in new window | On | Restores tabs in a new window instead of replacing current tabs |
| Max saved contexts | 20 | Oldest removed when limit reached (0 = unlimited) |
| Auto-delete after X days | Off | Removes contexts older than X days |
| Show notifications | On | Toast messages on save/restore |

## Permissions

| Permission | Why |
|------------|-----|
| `tabs` | Read open tab URLs and titles |
| `storage` | Save contexts and settings locally |
| `scripting` | Inject content script to capture page state |
| `activeTab` | Interact with the current tab |
| `host_permissions` | Capture/restore state on any website |

## Privacy

All data is stored locally on your device. Nothing is sent to any server. See [PRIVACY-POLICY.md](PRIVACY-POLICY.md) for details.

## License

[GNU GPLv3](LICENSE)
