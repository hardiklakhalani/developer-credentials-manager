/**
 * content/content.js
 *
 * Responsibilities:
 *  1. Detect email & password input fields (including dynamically added ones via MutationObserver)
 *  2. Inject a trigger icon button inside each detected field
 *  3. On trigger click, show a floating dropdown with the relevant credential list
 *  4. On item click, fill the field and fire synthetic events (React/Vue compatible)
 *  5. Clean up on page unload
 */

(() => {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────

  const ICON_URL = chrome.runtime.getURL('icons/icon16.png');
  const TRIGGER_CLASS = 'dcm-trigger';
  const WRAPPER_CLASS = 'dcm-wrapper';
  const DROPDOWN_ID = 'dcm-dropdown';
  const PROCESSED_ATTR = 'data-dcm-injected';

  // Patterns for detecting email/password fields beyond type attribute
  const EMAIL_NAME_PATTERN = /^(email|e[-_]?mail|user[-_]?name|login|user)$/i;
  const PASS_NAME_PATTERN  = /^(password|pass|passwd|pwd|secret)$/i;

  // ─── State ──────────────────────────────────────────────────────────────────

  let activeField = null;
  let activeType  = null; // 'email' | 'password'
  let dropdown    = null;
  let mutationRaf = null;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Determine if an input is an email field.
   * @param {HTMLInputElement} el
   */
  function isEmailField(el) {
    if (el.type === 'email') return true;
    const id   = (el.id   || '').trim();
    const name = (el.name || '').trim();
    const ac   = (el.getAttribute('autocomplete') || '').toLowerCase();
    return EMAIL_NAME_PATTERN.test(id) || EMAIL_NAME_PATTERN.test(name) || ac === 'email' || ac === 'username';
  }

  /**
   * Determine if an input is a password field.
   * @param {HTMLInputElement} el
   */
  function isPasswordField(el) {
    if (el.type === 'password') return true;
    const id   = (el.id   || '').trim();
    const name = (el.name || '').trim();
    const ac   = (el.getAttribute('autocomplete') || '').toLowerCase();
    return PASS_NAME_PATTERN.test(id) || PASS_NAME_PATTERN.test(name) || ac === 'current-password' || ac === 'new-password';
  }

  /**
   * Fill a field with a value and fire synthetic events so React/Vue pick up the change.
   * @param {HTMLInputElement} field
   * @param {string} value
   */
  function fillField(field, value) {
    // React tracks a custom property on the input element
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (nativeInputValueSetter && nativeInputValueSetter.set) {
      nativeInputValueSetter.set.call(field, value);
    } else {
      field.value = value;
    }
    field.dispatchEvent(new Event('input',  { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ─── Dropdown ───────────────────────────────────────────────────────────────

  /**
   * Build and return the singleton dropdown element (appended once to body).
   */
  function ensureDropdown() {
    if (document.getElementById(DROPDOWN_ID)) return document.getElementById(DROPDOWN_ID);

    const el = document.createElement('div');
    el.id = DROPDOWN_ID;
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Developer Credentials');

    el.innerHTML = `
      <div class="dcm-dropdown-header">
        <img src="${ICON_URL}" alt="DCM" class="dcm-dropdown-logo" />
        <span class="dcm-dropdown-title">Dev Credentials</span>
      </div>
      <div class="dcm-search-wrap">
        <input
          type="text"
          class="dcm-search"
          placeholder="Search..."
          aria-label="Search credentials"
          autocomplete="off"
        />
      </div>
      <ul class="dcm-list" role="listbox"></ul>
      <div class="dcm-no-match" hidden>
        <button type="button" class="dcm-add-instant-btn"></button>
      </div>
      <div class="dcm-empty" hidden>
        <span>No items yet.</span>
        <a class="dcm-empty-link" href="#" role="button">Open Settings →</a>
      </div>
    `;

    // Search filtering
    el.querySelector('.dcm-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const items = el.querySelectorAll('.dcm-item');
      let visibleCount = 0;

      items.forEach((li) => {
        const matches = li.dataset.value.toLowerCase().includes(q);
        li.hidden = !matches;
        if (matches) visibleCount++;
      });

      const noMatchEl = el.querySelector('.dcm-no-match');
      const addBtn = el.querySelector('.dcm-add-instant-btn');
      const emptyEl = el.querySelector('.dcm-empty');

      if (q && visibleCount === 0) {
        addBtn.textContent = `+ Add "${e.target.value.trim()}"`;
        addBtn.dataset.value = e.target.value.trim();
        noMatchEl.hidden = false;
        emptyEl.hidden = true;
      } else {
        noMatchEl.hidden = true;
        if (items.length === 0) {
          emptyEl.hidden = false;
        }
      }
    });

    // Instant add click handler
    el.querySelector('.dcm-add-instant-btn').addEventListener('click', async (e) => {
      const val = e.target.dataset.value;
      if (!val || !activeField || !activeType) return;

      const key = activeType === 'email' ? 'dcm_emails' : 'dcm_passwords';
      await new Promise((resolve) => {
        chrome.storage.sync.get({ [key]: [] }, (r) => {
          const list = r[key];
          if (!list.includes(val)) {
            list.push(val);
            chrome.storage.sync.set({ [key]: list }, resolve);
          } else {
            resolve();
          }
        });
      });

      fillField(activeField, val);
      closeDropdown();
    });

    // Open settings from empty state link
    el.querySelector('.dcm-empty-link').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'openOptions' });
      closeDropdown();
    });

    // Item click delegation — fills the active field
    el.querySelector('.dcm-list').addEventListener('click', (e) => {
      const item = e.target.closest('.dcm-item');
      if (!item || !activeField) return;
      fillField(activeField, item.dataset.value);
      closeDropdown();
    });

    document.body.appendChild(el);
    return el;
  }

  /**
   * Position and populate the dropdown for a given field and list of values.
   * @param {HTMLInputElement} field
   * @param {string[]} items
   */
  function openDropdown(field, items) {
    dropdown = ensureDropdown();

    // Populate the list
    const ul = dropdown.querySelector('.dcm-list');
    const emptyEl = dropdown.querySelector('.dcm-empty');
    const searchEl = dropdown.querySelector('.dcm-search');
    const noMatchEl = dropdown.querySelector('.dcm-no-match');

    ul.innerHTML = '';
    searchEl.value = '';
    if (noMatchEl) noMatchEl.hidden = true;

    if (items.length === 0) {
      ul.hidden = true;
      emptyEl.hidden = false;
    } else {
      ul.hidden = false;
      emptyEl.hidden = true;
      items.forEach((val) => {
        const li = document.createElement('li');
        li.className = 'dcm-item';
        li.setAttribute('role', 'option');
        li.dataset.value = val;
        li.textContent = val;
        ul.appendChild(li);
      });
    }

    // Position dropdown
    const rect = field.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const scrollX = window.scrollX || document.documentElement.scrollLeft;

    dropdown.style.display = 'block';
    dropdown.style.left = `${rect.left + scrollX}px`;
    dropdown.style.minWidth = `${rect.width}px`;

    // Decide: show below or above based on available space
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropH = Math.min(items.length * 38 + 90, 280);
    if (spaceBelow >= dropH || spaceBelow >= 120) {
      dropdown.style.top = `${rect.bottom + scrollY + 4}px`;
    } else {
      dropdown.style.top = `${rect.top + scrollY - dropH - 4}px`;
    }

    activeField = field;
    setTimeout(() => searchEl.focus(), 50);
  }

  function closeDropdown() {
    if (dropdown) dropdown.style.display = 'none';
    activeField = null;
    activeType  = null;
  }

  // ─── Trigger Button ─────────────────────────────────────────────────────────

  /**
   * Inject the DCM icon button inside an input field.
   * @param {HTMLInputElement} field
   * @param {'email'|'password'} type
   */
  function injectTrigger(field, type) {
    if (field.hasAttribute(PROCESSED_ATTR)) return;
    field.setAttribute(PROCESSED_ATTR, '1');

    // Wrap the field if its parent isn't already our wrapper
    let wrapper = field.parentElement;
    if (!wrapper.classList.contains(WRAPPER_CLASS)) {
      const newWrapper = document.createElement('div');
      newWrapper.className = WRAPPER_CLASS;
      // Copy layout-affecting styles from field's current parent context
      newWrapper.style.cssText = 'position:relative;display:inline-block;width:100%;';
      field.parentNode.insertBefore(newWrapper, field);
      newWrapper.appendChild(field);
      wrapper = newWrapper;
    }

    // Add right padding to the field so text doesn't overlap the icon
    const existingPR = parseInt(getComputedStyle(field).paddingRight, 10) || 0;
    field.style.paddingRight = `${Math.max(existingPR, 8) + 24}px`;
    field.style.boxSizing = 'border-box';

    // Create the trigger button
    const btn = document.createElement('button');
    btn.className = TRIGGER_CLASS;
    btn.type = 'button';
    btn.setAttribute('aria-label', `Open ${type === 'email' ? 'email' : 'password'} list`);
    btn.setAttribute('tabindex', '-1');
    btn.innerHTML = `<img src="${ICON_URL}" alt="DCM" />`;

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent field blur before click registers
    });

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // If already open for this field, toggle closed
      if (dropdown && dropdown.style.display === 'block' && activeField === field) {
        closeDropdown();
        return;
      }
      activeType = type;
      const items = await new Promise((resolve) => {
        const key = type === 'email' ? 'dcm_emails' : 'dcm_passwords';
        chrome.storage.sync.get({ [key]: [] }, (r) => resolve(r[key]));
      });
      openDropdown(field, items);
    });

    wrapper.appendChild(btn);
  }

  // ─── Field Scanner ──────────────────────────────────────────────────────────

  /**
   * Scan the DOM for unprocessed email/password fields and inject triggers.
   */
  function scanFields() {
    const inputs = document.querySelectorAll(`input:not([${PROCESSED_ATTR}])`);
    inputs.forEach((input) => {
      if (isEmailField(input)) {
        injectTrigger(input, 'email');
      } else if (isPasswordField(input)) {
        injectTrigger(input, 'password');
      }
    });
  }

  // ─── Global Event Listeners ─────────────────────────────────────────────────

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown) return;
    if (dropdown.style.display !== 'block') return;
    if (dropdown.contains(e.target)) return;
    if (e.target.closest(`.${TRIGGER_CLASS}`)) return;
    closeDropdown();
  }, true);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });

  // ─── MutationObserver (SPA support) ────────────────────────────────────────

  const observer = new MutationObserver(() => {
    if (mutationRaf) return;
    mutationRaf = requestAnimationFrame(() => {
      scanFields();
      mutationRaf = null;
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ─── Init ────────────────────────────────────────────────────────────────────

  scanFields();

  window.addEventListener('beforeunload', () => {
    observer.disconnect();
  });

})();
