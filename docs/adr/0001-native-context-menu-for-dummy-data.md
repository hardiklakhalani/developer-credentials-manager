# 1. Native Context Menu for Random Dummy Data Filler

Date: 2026-09-30

## Status

Accepted

## Context

The extension needs a "Random Dummy Data Filler" feature accessible exclusively from the right-click context menu on any editable text input or textarea on any webpage. Users can configure multiple named Dummy Data Sets (e.g., "Address", "Phone", "Long Content"), each containing multiple sample values. Selecting a set randomly injects one of its entries into the right-clicked field.

We considered two primary approaches:
1. In-page custom DOM context menu (intercepting the `contextmenu` event and drawing a custom HTML dropdown at click coordinates).
2. Native browser context menus using Chrome's `chrome.contextMenus` API with `contexts: ["editable"]`.

## Decision

We use the native `chrome.contextMenus` API managed by `background.js` (Service Worker), combined with a lightweight `contextmenu` event tracker in `content.js` and runtime message passing.

Key design points:
- **Permission**: Add `"contextMenus"` to `manifest.json`.
- **Target Filtering**: Use `contexts: ["editable"]` so the menu item only appears when the user right-clicks on `<input>`, `<textarea>`, or contenteditable fields.
- **Dynamic Hierarchy**: The parent menu item "Fill Dummy Data" contains dynamic children reflecting user-configured Dummy Data Sets. If empty, it renders an actionable "(No sets configured - Open Settings)" item.
- **Target Resolution**: `content.js` tracks `lastRightClickedElement` during the `contextmenu` DOM event. When `background.js` receives `onClicked`, it selects a random entry and dispatches a message to the active tab to execute the existing framework-compatible `fillField` logic.
- **Reactivity**: Background listens to `chrome.storage.onChanged` to rebuild context menus immediately when sets are created, updated, or deleted.
- **Storage Strategy**: Unlike credential sets and email/password lists which use `chrome.storage.sync`, Dummy Data Sets are stored in `chrome.storage.local`. This avoids Chromium's strict 8,192 bytes per-item quota (`QUOTA_BYTES_PER_ITEM`) on sync storage, accommodating realistic multi-paragraph dummy datasets while maintaining automatic backward-compatible migration.

## Consequences

### Positive
- Native browser look-and-feel; zero CSS collision with third-party web pages.
- Native Chrome positioning and submenu cascading handling.
- Zero DOM clutter injected into host pages when context menu is not in use.
- Works across complex web frameworks and standard forms without intercepting or overriding custom web app right-click menus unless editable.

### Negative
- Requires `"contextMenus"` permission in `manifest.json`.
- Background service worker must handle menu lifecycle and storage synchronization events.
