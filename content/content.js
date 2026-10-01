/**
 * content/content.js
 *
 * Responsibilities:
 *  1. Detect email & password input fields (including dynamically added ones via MutationObserver)
 *  2. Inject a trigger icon button inside each detected field
 *  3. On trigger click, show a floating dropdown with the relevant credential list
 *  4. On item click, fill the field and fire synthetic events (React/Vue compatible)
 *  5. On /auth/signin pages: inject a credential-set picker above the email field
 *     that auto-fills BOTH email and password from a matched set
 *  6. Clean up on page unload
 *
 * Depends on: shared/env.js (loaded before this file via manifest content_scripts order)
 */

(() => {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────

  const ICON_URL        = chrome.runtime.getURL('icons/icon16.png');
  const TRIGGER_CLASS   = 'dcm-trigger';
  const WRAPPER_CLASS   = 'dcm-wrapper';
  const DROPDOWN_ID     = 'dcm-dropdown';
  const SET_PICKER_ATTR = 'data-dcm-set-picker';
  const PROCESSED_ATTR  = 'data-dcm-injected';

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
   * Helper to turn multi-line text into paragraph HTML for rich-text editors.
   * @param {string} text
   * @returns {string}
   */
  function textToHtmlParagraphs(text) {
    const escaped = (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const parts = escaped.split(/\n\n+/).filter(Boolean);
    if (parts.length > 1) {
      return parts.map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    }
    return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
  }

  /**
   * Fill a field with a value and fire synthetic events so React/Vue/Angular pick up the change.
   * Handles HTMLInputElement, HTMLTextAreaElement, contenteditable, and TinyMCE/rich-text editors.
   * @param {HTMLElement} field
   * @param {string} value
   */
  function fillField(field, value) {
    if (!field) return;

    if (field instanceof HTMLTextAreaElement) {
      const nativeTextAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (nativeTextAreaSetter && nativeTextAreaSetter.set) {
        nativeTextAreaSetter.set.call(field, value);
      } else {
        field.value = value;
      }
      field.dispatchEvent(new Event('input',  { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (field instanceof HTMLInputElement) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (nativeInputValueSetter && nativeInputValueSetter.set) {
        nativeInputValueSetter.set.call(field, value);
      } else {
        field.value = value;
      }
      field.dispatchEvent(new Event('input',  { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Rich text editor, TinyMCE, or contenteditable
      const doc = field.ownerDocument || document;
      const win = doc.defaultView || window;
      const html = textToHtmlParagraphs(value);

      field.focus();

      let execSuccess = false;
      try {
        const range = doc.createRange();
        range.selectNodeContents(field);
        const sel = win.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        execSuccess = doc.execCommand('insertHTML', false, html);
        if (!execSuccess) {
          execSuccess = doc.execCommand('insertText', false, value);
        }
      } catch (e) {
        execSuccess = false;
      }

      if (!execSuccess || !field.textContent.trim()) {
        field.innerHTML = html;
      }

      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true }));

      // Editor ID extraction (TinyMCE data-id or iframe ID)
      const editorId = field.getAttribute('data-id') ||
        win.frameElement?.id?.replace(/_ifr$/, '') ||
        'conversation_editor';

      // Broadcast to MAIN world interceptor to invoke window.tinymce directly
      try {
        window.postMessage({ type: 'DCM_FILL_EDITOR', editorId, value, html }, '*');
        if (win.parent && win.parent !== win) {
          win.parent.postMessage({ type: 'DCM_FILL_EDITOR', editorId, value, html }, '*');
        }
      } catch (e) { }

      // Directly update any corresponding hidden input in parent or current document
      const parentDoc = win.frameElement?.ownerDocument || doc;
      if (editorId) {
        const hiddenInput = parentDoc.querySelector(`input[name="${editorId}"], input#${editorId}, tiny-editor input[type="hidden"]`);
        if (hiddenInput && hiddenInput instanceof HTMLInputElement) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (nativeSetter?.set) {
            nativeSetter.set.call(hiddenInput, html);
          } else {
            hiddenInput.value = html;
          }
          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const divPreview = parentDoc.getElementById(editorId);
        if (divPreview && divPreview !== field) {
          divPreview.innerHTML = html;
        }
      }
    }
  }

  // ─── Dropdown (per-field individual picker) ──────────────────────────────────

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

  // ─── Credential Set Picker (/auth/signin only) ───────────────────────────────

  /**
   * Inject a dropdown-style credential-set picker above the email field's form row.
   *
   * UI:  [trigger button — looks like a styled <select>]
   *        ↓ click
   *      [floating panel — rich rows: label, role badge, email, masked password]
   *
   * Safe to call multiple times — guarded by SET_PICKER_ATTR.
   */
  async function injectSetPicker() {
    // Guard: only on /auth/signin
    if (window.location.pathname !== '/auth/signin') return;

    // Find the email field
    const emailField = Array.from(document.querySelectorAll('input')).find(isEmailField);
    if (!emailField) return;

    // Guard: already injected
    if (emailField.hasAttribute(SET_PICKER_ATTR)) return;
    emailField.setAttribute(SET_PICKER_ATTR, '1');

    // Best-effort: find password field (may render after us)
    const passwordField = Array.from(document.querySelectorAll('input')).find(isPasswordField);

    // Detect backend (cached)
    const backend = window.__dcmEnv ? await window.__dcmEnv.detectBackend() : null;

    // Load & filter sets
    const allSets = await new Promise((resolve) => {
      chrome.storage.sync.get({ dcm_credential_sets: [] }, (r) => resolve(r.dcm_credential_sets));
    });
    const filteredSets = window.__dcmEnv
      ? window.__dcmEnv.filterSetsByBackend(allSets, backend)
      : allSets;

    // Sort: Tenant → Agent → Customer (within each role, preserve original order)
    const ROLE_ORDER = { tenant: 0, agent: 1, customer: 2 };
    const sets = [...filteredSets].sort(
      (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    );

    const contextText = backend ? `${backend.subdomain}${backend.tld}` : null;

    // ── Outer wrapper (position:relative so the floating panel anchors to it) ──

    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'dcm-set-picker-wrap';

    // ── Trigger button ──────────────────────────────────────────────────────
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dcm-set-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `
      <span class="dcm-set-trigger-left">
        <img src="${ICON_URL}" alt="DCM" class="dcm-set-picker-logo" />
        <span class="dcm-set-trigger-text">Pick a credential set…</span>
      </span>
      <span class="dcm-set-trigger-right">
        ${contextText ? `<span class="dcm-set-picker-context">${contextText}</span>` : ''}
        <svg class="dcm-set-trigger-chevron" viewBox="0 0 20 20" fill="none" width="14" height="14" aria-hidden="true">
          <path d="M5 7l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    `;

    // ── Floating panel ──────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.className = 'dcm-set-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Select a credential set');
    panel.hidden = true;

    const optionsList = document.createElement('div');
    optionsList.className = 'dcm-set-options-list';

    if (sets.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'dcm-set-options-empty';
      emptyEl.innerHTML = `
        <span>No sets found for <strong>${contextText || 'this server'}</strong>.</span>
      `;
      optionsList.appendChild(emptyEl);
    } else {
      sets.forEach((set) => {
        const row = document.createElement('div');
        row.className = 'dcm-set-option';
        row.setAttribute('role', 'option');

        // Mask password: show first 2 chars then bullets
        const maskedPass = set.password.length > 2
          ? set.password.slice(0, 2) + '•'.repeat(Math.min(set.password.length - 2, 6))
          : '••••••••';

        const content = document.createElement('div');
        content.className = 'dcm-set-option-content';
        content.setAttribute('tabindex', '0');
        content.setAttribute('aria-label', `Fill credentials for ${set.label}`);
        content.innerHTML = `
          <div class="dcm-set-option-main">
            <span class="dcm-set-option-label">${set.label}</span>
            <span class="dcm-set-option-role dcm-role-${set.role}">${set.role}</span>
          </div>
          <div class="dcm-set-option-creds">
            <span class="dcm-set-option-email">${set.email}</span>
            <span class="dcm-set-option-sep">·</span>
            <span class="dcm-set-option-pass">${maskedPass}</span>
          </div>
        `;

        content.addEventListener('mousedown', (e) => e.preventDefault()); // keep email focused

        content.addEventListener('click', () => {
          fillField(emailField, set.email);
          const pwField = passwordField
            || Array.from(document.querySelectorAll('input')).find(isPasswordField);
          if (pwField) fillField(pwField, set.password);

          // Update trigger label to show what was selected
          trigger.querySelector('.dcm-set-trigger-text').textContent = set.label;

          closePanel();
        });

        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'dcm-set-option-copy-btn';
        copyBtn.setAttribute('aria-label', `Copy ${set.label} details`);
        copyBtn.title = 'Copy credential set';
        copyBtn.innerHTML = `
          <svg viewBox="0 0 20 20" fill="none" width="13" height="13" aria-hidden="true">
            <rect x="6" y="6" width="10" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/>
            <path d="M4 14V4a1 1 0 011-1h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        `;

        copyBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });

        copyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const textToCopy = `URL:  ${set.subdomain}${set.tld}/auth/signin\nRole: ${set.role}\nEmail: ${set.email}\nPassword: ${set.password}`;
          
          const doCopy = () => {
            if (navigator.clipboard?.writeText) {
              return navigator.clipboard.writeText(textToCopy);
            }
            const ta = document.createElement('textarea');
            ta.value = textToCopy;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return Promise.resolve();
          };

          doCopy().then(() => {
            copyBtn.classList.add('dcm-set-option-copy-btn--copied');
            copyBtn.innerHTML = `
              <svg viewBox="0 0 20 20" fill="none" width="13" height="13" aria-hidden="true">
                <path d="M5 10l3.5 3.5L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            `;
            setTimeout(() => {
              copyBtn.classList.remove('dcm-set-option-copy-btn--copied');
              copyBtn.innerHTML = `
                <svg viewBox="0 0 20 20" fill="none" width="13" height="13" aria-hidden="true">
                  <rect x="6" y="6" width="10" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M4 14V4a1 1 0 011-1h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              `;
            }, 1500);
          }).catch(() => {});
        });

        row.appendChild(content);
        row.appendChild(copyBtn);
        optionsList.appendChild(row);
      });
    }

    panel.appendChild(optionsList);

    // ── Persistent Footer: 'Open Settings →' button always at the end ───────
    const footer = document.createElement('div');
    footer.className = 'dcm-set-panel-footer';
    footer.innerHTML = `
      <button type="button" class="dcm-set-options-settings-link" aria-label="Open Credential Sets settings">
        <svg viewBox="0 0 20 20" fill="none" width="12" height="12" aria-hidden="true">
          <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Open Settings →
      </button>
    `;

    const settingsBtn = footer.querySelector('.dcm-set-options-settings-link');
    settingsBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'openOptions', tab: 'credsets' });
      closePanel();
    });

    panel.appendChild(footer);

    // ── Panel open/close ────────────────────────────────────────────────────

    function openPanel() {
      panel.hidden = false;
      panel.style.display = 'flex';
      trigger.setAttribute('aria-expanded', 'true');
      trigger.classList.add('dcm-set-trigger--open');
    }

    function closePanel() {
      panel.hidden = true;
      panel.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.classList.remove('dcm-set-trigger--open');
    }

    // Initially closed
    closePanel();

    trigger.addEventListener('mousedown', (e) => e.preventDefault()); // don't steal focus
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden ? openPanel() : closePanel();
    });

    // Close on outside click (capture phase so it fires before other handlers)
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !pickerWrap.contains(e.target)) closePanel();
    }, true);

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) closePanel();
    });

    pickerWrap.appendChild(trigger);
    pickerWrap.appendChild(panel);

    // ── Auto-fill first set (highest-priority role) after insertion ───────────
    //
    // We defer with setTimeout(0) so the DOM is fully settled and the page's
    // own React/Vue reactivity has a chance to observe the field values.
    if (sets.length > 0) {
      const first = sets[0];
      setTimeout(() => {
        fillField(emailField, first.email);
        const pwField = passwordField
          || Array.from(document.querySelectorAll('input')).find(isPasswordField);
        if (pwField) fillField(pwField, first.password);
        // Reflect in trigger label
        trigger.querySelector('.dcm-set-trigger-text').textContent = first.label;
      }, 0);
    }

    // ── DOM insertion: before the email field's form-row, inside <form> ──────

    const form         = emailField.closest('form') || document.body;
    const emailWrapper = emailField.closest(`.${WRAPPER_CLASS}`) || emailField;

    let formRow = emailWrapper;
    while (formRow.parentElement && formRow.parentElement !== form) {
      formRow = formRow.parentElement;
    }

    form.insertBefore(pickerWrap, formRow);

    // ── Refresh if storage changes or backend is intercepted while page is open ──
    const storageListener = (changes, area) => {
      if (area !== 'sync' || !changes.dcm_credential_sets) return;
      chrome.storage.onChanged.removeListener(storageListener);
      emailField.removeAttribute(SET_PICKER_ATTR);
      pickerWrap.remove();
      injectSetPicker();
    };
    chrome.storage.onChanged.addListener(storageListener);

    if (window.__dcmEnv?.onBackendDetected) {
      const unsub = window.__dcmEnv.onBackendDetected((newBackend) => {
        if (
          !backend ||
          backend.subdomain !== newBackend.subdomain ||
          backend.tld !== newBackend.tld
        ) {
          unsub();
          emailField.removeAttribute(SET_PICKER_ATTR);
          pickerWrap.remove();
          injectSetPicker();
        }
      });
    }
  }


  // ─── Field Scanner ──────────────────────────────────────────────────────────

  /**
   * Scan the DOM for unprocessed email/password fields and inject triggers.
   * Also re-attempts set picker injection (guarded internally).
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

    // Attempt set-picker injection (idempotent)
    injectSetPicker();
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

  // ─── Context Menu Target Tracking & Dummy Data Injection ────────────────────

  let lastContextMenuTarget = null;

  document.addEventListener('contextmenu', (e) => {
    lastContextMenuTarget = e.target;
  }, true);

  /**
   * Resolve an editable target (input, textarea, contenteditable, or rich-text/TinyMCE iframe).
   * @param {Element|null} el
   * @returns {HTMLElement|null}
   */
  function resolveEditableTarget(el) {
    let candidate = el || document.activeElement;
    if (!candidate) return null;

    // 1. Direct input or textarea
    if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
      return candidate;
    }

    // 2. Direct contenteditable or ancestor contenteditable
    const ce = candidate.closest?.('[contenteditable="true"]');
    if (ce) return ce;
    if (candidate.isContentEditable) return candidate;

    // 3. Inside TinyMCE editor body (when script runs inside TinyMCE iframe)
    if (candidate.id === 'tinymce' || candidate.classList?.contains('mce-content-body')) {
      return candidate;
    }
    const tinyBody = candidate.closest?.('body#tinymce, body.mce-content-body');
    if (tinyBody) return tinyBody;
    if (candidate.ownerDocument?.body && (candidate.ownerDocument.body.id === 'tinymce' || candidate.ownerDocument.body.classList?.contains('mce-content-body'))) {
      return candidate.ownerDocument.body;
    }

    // 4. Element is inside <tiny-editor> or .tox-tinymce or Angular conversation_editor in parent frame
    const tinyWrapper = candidate.closest?.('tiny-editor, .tox-tinymce, .tox-editor-container, .conversation_editor');
    if (tinyWrapper) {
      const ifr = tinyWrapper.querySelector('iframe');
      if (ifr?.contentDocument?.body) {
        return ifr.contentDocument.body;
      }
    }

    // 5. Element is an iframe itself (e.g. activeElement is the iframe)
    if (candidate instanceof HTMLIFrameElement && candidate.contentDocument?.body) {
      return candidate.contentDocument.body;
    }

    // 6. Element contains an iframe editor
    const childIfr = candidate.querySelector?.('iframe.tox-edit-area__iframe, iframe[id*="editor"], iframe');
    if (childIfr?.contentDocument?.body) {
      return childIfr.contentDocument.body;
    }

    // 7. General fallback: search for any active editor on page
    const pageTinyIframe = document.querySelector('tiny-editor iframe, .tox-tinymce iframe, iframe.tox-edit-area__iframe');
    if (pageTinyIframe?.contentDocument?.body) {
      return pageTinyIframe.contentDocument.body;
    }

    return null;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'fillDummyData') {
      const target = resolveEditableTarget(lastContextMenuTarget);

      if (target) {
        fillField(target, message.value);
        if (typeof sendResponse === 'function') sendResponse({ success: true });
      } else {
        if (typeof sendResponse === 'function') sendResponse({ success: false, error: 'No editable target found' });
      }
      return true;
    }
  });

  window.addEventListener('beforeunload', () => {
    observer.disconnect();
  });

})();
