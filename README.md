# Developer Credentials Manager

A light-themed, premium Chrome extension designed for developers to manage and easily autofill non-production email addresses and passwords when testing web forms.

![DCM Logo](icons/icon128.png)

---

## ✨ Features

- **💡 In-Field Suggester:** Injects a clean green `@` trigger button inside detected credentials fields (emails, usernames, and passwords).
- **🔍 Quick Search & Auto-Filter:** Filter suggestion lists on the fly directly inside the page dropdown.
- **⚡ Instant Add Option:** If a searched credential is not found, dynamically add it to your saved lists instantly from the dropdown.
- **⚙️ Complete Options Dashboard:** Sidebar-based tab panel interface to view, add, search, drag-to-reorder, and inline-edit credential lists.
- **📂 JSON Import / Export:** Easily backup your configuration or sync it across development machines by importing/exporting JSON.
- **🔄 Sync-Ready:** Uses `chrome.storage.sync` to keep your dev credentials synchronized across your Google account devices automatically.
- **💻 SPA Support:** Actively detects dynamic inputs on Single Page Applications (React, Vue, Angular, etc.) using `MutationObserver` and triggers synthetic events to properly update framework form state.
- **🎲 Random Dummy Data Filler:** Right-click on any text input or textarea field to access the "Fill Dummy Data" context menu. Select any configured set (e.g. Address, Phone, Short Paragraph, Long Multi Paragraphs) to inject a randomly selected entry instantly.

---

## 📂 Project Structure

```
developer-credentials-manager/
├── manifest.json              # Extension metadata (Manifest V3)
├── background.js              # Service Worker (context menus & navigation)
├── icon.png                   # Source icon asset
├── icons/                     # Resized extension icons (16px, 32px, 48px, 128px)
├── shared/
│   ├── env.js                 # Environment configuration & URL matchers
│   └── storage.js             # Storage operations wrapper for chrome.storage.sync
├── content/
│   ├── content.js             # Field scanning, DOM injection, context menu filler
│   ├── content.css            # Scoped trigger and floating UI styles
│   └── interceptor.js         # Main world network interceptor
├── popup/
│   ├── popup.html             # Extension toolbar popup
│   ├── popup.js               # Quick-add, dummy sets stats, and tab shortcuts
│   └── popup.css              # Toolbar UI styles
├── options/
│   ├── options.html           # Full settings page with Dummy Data tab
│   ├── options.js             # Dummy sets manager, inline-editing, import/export
│   └── options.css            # Dashboard styles
├── CONTEXT.md                 # Domain glossary and ubiquitous language
└── docs/
    └── adr/                   # Architecture Decision Records
```

---

## 🚀 Installation & Setup

1. Clone or download this repository to your local machine.
2. Open **Google Chrome**.
3. Navigate to `chrome://extensions/` in your address bar.
4. Enable **Developer Mode** by toggling the switch in the top-right corner.
5. Click the **Load unpacked** button in the top-left corner.
6. Select the `developer-credentials-manager` directory.

---

## 📝 Usage Guide

### 1. In-Field Suggester
- When visiting any webpage with input fields of type `email` or `password` (or attributes matching credentials keywords), the green trigger icon will appear on the right side of the input.
- Click the icon to view suggestions.
- Select a suggestion to autofill the input.

### 2. Random Dummy Data Filler
- Right-click inside any editable text input, textarea, or rich-text editor on any web page.
- Hover over **Fill Dummy Data** in the browser context menu.
- Click any configured Dummy Data Set (e.g., **Address**, **Phone**, **Short Paragraph**, **Long Multi Paragraphs**).
- A randomly chosen entry from that set will immediately replace the field's contents and trigger synthetic change events for React/Vue SPA compatibility.
- Configure or create new sets anytime under **Settings → Dummy Data**.

### 3. Search & Instant Add
- While the suggestions dropdown is open, start typing to filter suggestions.
- If there are no matches, click **`+ Add "[your text]"`** to instantly add the credential to your list and fill the field.

### 4. Settings Dashboard
- Click the extension toolbar icon and select **Open Full Settings** (or right-click the extension icon and select **Options**).
- Manage Credential Sets, Emails, Passwords, and Dummy Data Sets with drag-and-drop, inline editing, and sample data seeding.

---

## 🔒 Security Disclaimer
This extension stores credentials in **plaintext** via `chrome.storage.sync` for convenience during local web development and automated/manual testing. **Do not use this extension to store production passwords, API keys, or sensitive personal data.**
