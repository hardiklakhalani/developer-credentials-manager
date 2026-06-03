# Contributing to Developer Credentials Manager

Thank you for your interest in contributing to the **Developer Credentials Manager**! To maintain a lightweight, fast, and secure extension, please follow the guidelines below when submitting changes.

---

## 🎨 Design & Code Principles

1. **Vanilla Stack only:** Do not add third-party frameworks (e.g. React, jQuery, Tailwind CSS) or external bundlers unless explicitly agreed upon. We aim to keep dependencies at zero.
2. **Strict Manifest V3 Compliance:** 
   - No inline scripts allowed.
   - Do not use dynamic execution functions like `eval()` or `new Function()`.
   - Keep permissions minimal.
3. **Storage Abstraction:** Do not use `chrome.storage.sync.get` or `chrome.storage.sync.set` directly inside options or popup interfaces. Always import and use the helper methods defined in `shared/storage.js`.
4. **DOM Protection & XSS Prevention:** When rendering list items or dynamic content, always set content using `.textContent` instead of `.innerHTML` to prevent Cross-Site Scripting (XSS) issues.

---

## 🛠️ Code Style Guidelines

- **Formatting:** Use 2 spaces for indentation. Keep code clean and self-documenting.
- **Naming Conventions:** Use `camelCase` for variables and function names, and `UPPER_SNAKE_CASE` for constant keys.
- **Content Script Styling:** Since `content/content.css` is injected into arbitrary third-party pages, always append `!important` to all style declarations to guarantee our trigger icons and dropdown render correctly and do not inherit colliding host page styles.

---

## 🔄 How to Submit Changes

1. **Fork the Repository:** Create a new feature branch for your changes.
2. **Write Clean Code:** Follow the style guide and document new functions with clean JSDoc comments.
3. **Verify Compatibility:**
   - Test on standard pages (plain HTML).
   - Test on Single Page Applications (React/Vue) to verify form input bindings update correctly.
   - Check the Chrome Developer Console (`Ctrl+Shift+I` on host pages, and the Options/Popup inspector consoles) to ensure no CSP errors or console warnings are generated.
4. **Submit a Pull Request:** Describe what your changes resolve and attach screenshots if making UI modifications.
