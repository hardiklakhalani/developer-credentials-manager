/**
 * options/options.js
 *
 * Handles:
 *  - Tab navigation
 *  - Rendering email & password lists
 *  - Inline editing (click text → input, Enter/Escape to confirm/cancel)
 *  - Delete
 *  - Drag-to-reorder (native HTML5 drag API)
 *  - Live search/filter
 *  - Add new item
 *  - Badge counts in sidebar
 *  - Import / Export (JSON)
 *  - [v2] Credential Sets tab: add / inline-edit / delete
 */

'use strict';

// ─── Storage helpers ────────────────────────────────────────────────────────

const KEYS = {
  EMAILS: 'dcm_emails',
  PASSWORDS: 'dcm_passwords',
  CREDENTIAL_SETS: 'dcm_credential_sets',
  DUMMY_DATA_SETS: 'dcm_dummy_data_sets',
};

function getList(key) {
  if (key === KEYS.DUMMY_DATA_SETS) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [key]: null }, (localRes) => {
        if (localRes && Array.isArray(localRes[key])) {
          resolve(localRes[key]);
        } else {
          // Fallback to sync for backwards compatibility / migration
          chrome.storage.sync.get({ [key]: [] }, (syncRes) => {
            const data = (syncRes && syncRes[key]) || [];
            if (data.length > 0) {
              chrome.storage.local.set({ [key]: data });
            }
            resolve(data);
          });
        }
      });
    });
  }
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [key]: [] }, (r) => resolve((r && r[key]) || []));
  });
}

function saveList(key, arr) {
  return new Promise((resolve, reject) => {
    if (key === KEYS.DUMMY_DATA_SETS) {
      chrome.storage.local.set({ [key]: arr }, () => {
        if (chrome.runtime.lastError) {
          console.error(`Error saving ${key} to local:`, chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        // Clean up any old copy in sync to free quota
        chrome.storage.sync.remove(key, () => resolve());
      });
      return;
    }

    chrome.storage.sync.set({ [key]: arr }, () => {
      if (chrome.runtime.lastError) {
        console.error(`Error saving ${key} to sync:`, chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// ─── Tab navigation ─────────────────────────────────────────────────────────

const navItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

function switchTab(tabName) {
  if (!tabName) return;
  const btn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  const panel = document.getElementById(`tab-${tabName}`);
  if (!btn || !panel) return;

  navItems.forEach((n) => n.classList.remove('active'));
  tabPanels.forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  panel.classList.add('active');
}

function handleRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash) {
    switchTab(hash);
  }
}

navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
    window.location.hash = btn.dataset.tab;
  });
});

window.addEventListener('hashchange', handleRoute);
handleRoute();

// ─── List renderer (emails & passwords) ─────────────────────────────────────

/**
 * @typedef {{ key: string, listId: string, emptyId: string, badgeId: string, searchId: string }} ListConfig
 */

/**
 * Render a credential list into its <ul> element.
 * @param {ListConfig} cfg
 * @param {string[]} items
 */
function renderList(cfg, items) {
  const ul = document.getElementById(cfg.listId);
  const empty = document.getElementById(cfg.emptyId);
  const badge = document.getElementById(cfg.badgeId);

  ul.innerHTML = '';
  badge.textContent = items.length;

  if (items.length === 0) {
    ul.hidden = true;
    empty.hidden = false;
    return;
  }

  ul.hidden = false;
  empty.hidden = true;

  items.forEach((val, index) => {
    const li = createListItem(cfg, val, index, items);
    ul.appendChild(li);
  });

  // Re-apply current search filter
  const searchVal = document.getElementById(cfg.searchId).value.toLowerCase();
  if (searchVal) filterList(cfg.listId, searchVal);
}

/**
 * Create a single list item <li> with drag, inline edit, and delete.
 */
function createListItem(cfg, val, index, allItems) {
  const li = document.createElement('li');
  li.className = 'cred-item';
  li.draggable = true;
  li.dataset.index = index;

  // Drag handle
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.setAttribute('aria-hidden', 'true');
  handle.title = 'Drag to reorder';

  // Item text (click to edit)
  const textEl = document.createElement('span');
  textEl.className = 'item-text';
  textEl.textContent = val;
  textEl.title = 'Click to edit';

  // Action buttons (default: just delete)
  const actions = document.createElement('div');
  actions.className = 'item-actions';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete';
  deleteBtn.setAttribute('aria-label', `Delete ${val}`);
  deleteBtn.textContent = '🗑';

  actions.appendChild(deleteBtn);
  li.appendChild(handle);
  li.appendChild(textEl);
  li.appendChild(actions);

  // ── Inline edit ───────────────────────────────────────────
  function enterEditMode() {
    const input = document.createElement('input');
    input.className = 'item-edit-input';
    input.type = 'text';
    input.value = val;
    input.setAttribute('aria-label', 'Edit value');

    li.replaceChild(input, textEl);

    actions.innerHTML = '';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'icon-btn save';
    saveBtn.setAttribute('aria-label', 'Save edit');
    saveBtn.textContent = '✓';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'icon-btn cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel edit');
    cancelBtn.textContent = '✕';

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    input.focus();
    input.select();

    async function saveEdit() {
      const newVal = input.value.trim();
      if (!newVal || newVal === val) {
        exitEditMode();
        return;
      }
      const list = await getList(cfg.key);
      list[index] = newVal;
      await saveList(cfg.key, list);
      renderList(cfg, list);
    }

    function exitEditMode() {
      renderList_fromStorage(cfg);
    }

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', exitEditMode);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveEdit();
      if (e.key === 'Escape') exitEditMode();
    });
  }

  textEl.addEventListener('click', enterEditMode);

  // ── Delete ────────────────────────────────────────────────
  deleteBtn.addEventListener('click', async () => {
    const list = await getList(cfg.key);
    list.splice(index, 1);
    await saveList(cfg.key, list);
    renderList(cfg, list);
  });

  // ── Drag and Drop ─────────────────────────────────────────
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    requestAnimationFrame(() => li.classList.add('dragging'));
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.cred-item').forEach((el) => el.classList.remove('drag-over'));
  });

  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.cred-item').forEach((el) => el.classList.remove('drag-over'));
    li.classList.add('drag-over');
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('drag-over');
  });

  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    li.classList.remove('drag-over');
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const toIndex = index;
    if (fromIndex === toIndex) return;

    const list = await getList(cfg.key);
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    await saveList(cfg.key, list);
    renderList(cfg, list);
  });

  return li;
}

// ─── Helper: re-load from storage and re-render ─────────────────────────────

async function renderList_fromStorage(cfg) {
  const list = await getList(cfg.key);
  renderList(cfg, list);
}

// ─── Search / filter ────────────────────────────────────────────────────────

function filterList(listId, query) {
  const ul = document.getElementById(listId);
  ul.querySelectorAll('.cred-item').forEach((li) => {
    const text = li.querySelector('.item-text')?.textContent?.toLowerCase() ?? '';
    li.hidden = !text.includes(query);
  });
}

// ─── Add new item ────────────────────────────────────────────────────────────

async function addItem(cfg, inputId) {
  const input = document.getElementById(inputId);
  const val = input.value.trim();
  if (!val) {
    input.focus();
    return;
  }
  const list = await getList(cfg.key);
  if (list.includes(val)) {
    input.classList.add('input-error');
    input.title = 'This item already exists.';
    setTimeout(() => { input.classList.remove('input-error'); input.title = ''; }, 1800);
    return;
  }
  list.push(val);
  await saveList(cfg.key, list);
  input.value = '';
  renderList(cfg, list);
}

// ─── Config objects ──────────────────────────────────────────────────────────

const emailCfg = {
  key: KEYS.EMAILS,
  listId: 'list-emails',
  emptyId: 'empty-emails',
  badgeId: 'badge-emails',
  searchId: 'search-emails',
};

const passCfg = {
  key: KEYS.PASSWORDS,
  listId: 'list-passwords',
  emptyId: 'empty-passwords',
  badgeId: 'badge-passwords',
  searchId: 'search-passwords',
};

// ─── Wire up events (emails & passwords) ─────────────────────────────────────

// Search
document.getElementById('search-emails').addEventListener('input', (e) => {
  filterList('list-emails', e.target.value.toLowerCase());
});

document.getElementById('search-passwords').addEventListener('input', (e) => {
  filterList('list-passwords', e.target.value.toLowerCase());
});

// Add buttons
document.getElementById('add-email-btn').addEventListener('click', () => addItem(emailCfg, 'add-email-input'));
document.getElementById('add-pass-btn').addEventListener('click', () => addItem(passCfg, 'add-pass-input'));

// Enter key on add inputs
document.getElementById('add-email-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(emailCfg, 'add-email-input'); });
document.getElementById('add-pass-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(passCfg, 'add-pass-input'); });

// ─── Credential Sets — helpers ───────────────────────────────────────────────

/** @typedef {{ id: string, label: string, role: string, tld: string, subdomain: string, email: string, password: string }} CredentialSet */

/**
 * Render the role badge pill.
 * @param {'customer'|'agent'|'tenant'} role
 * @returns {HTMLElement}
 */
function createRoleBadge(role) {
  const badge = document.createElement('span');
  badge.className = `role-badge role-badge--${role}`;
  badge.textContent = role;
  return badge;
}

/**
 * Render all credential sets into #list-credsets, grouped by subdomain+tld.
 * Each group is a collapsible <details> element.
 * @param {CredentialSet[]} sets
 */
function renderCredSets(sets) {
  const container = document.getElementById('list-credsets');
  const empty = document.getElementById('empty-credsets');
  const badge = document.getElementById('badge-credsets');

  container.innerHTML = '';
  badge.textContent = sets.length;

  if (sets.length === 0) {
    container.hidden = true;
    empty.hidden = false;
    return;
  }

  container.hidden = false;
  empty.hidden = true;

  // ── Group sets by "subdomain + tld" ──────────────────────────────────────
  /** @type {Map<string, CredentialSet[]>} */
  const groups = new Map();
  sets.forEach((set) => {
    const key = `${set.subdomain}${set.tld}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(set);
  });

  // ── Render one <details> block per group ─────────────────────────────────
  groups.forEach((groupSets, groupKey) => {
    const details = document.createElement('details');
    details.className = 'credset-group';
    details.open = false; // collapsed by default

    const summary = document.createElement('summary');
    summary.className = 'credset-group-summary';
    summary.innerHTML = `
      <span class="credset-group-icon">
        <svg viewBox="0 0 20 20" fill="none" width="14" height="14" aria-hidden="true">
          <rect x="3" y="5" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M7 5V4a3 3 0 016 0v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="credset-group-key">${groupKey}</span>
      <button type="button" class="credset-group-launch-btn" title="Open https://${groupKey}/auth/signin in new tab" aria-label="Open https://${groupKey}/auth/signin in new tab">
        <svg viewBox="0 0 20 20" fill="none" width="12" height="12" aria-hidden="true">
          <path d="M11 3h6v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 10l7-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M17 12v4a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="credset-group-count">${groupSets.length} set${groupSets.length !== 1 ? 's' : ''}</span>
    `;

    const launchBtn = summary.querySelector('.credset-group-launch-btn');
    if (launchBtn) {
      launchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetUrl = `https://${groupKey}/auth/signin`;
        if (chrome?.tabs?.create) {
          chrome.tabs.create({ url: targetUrl });
        } else {
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
        }
      });
    }

    details.appendChild(summary);

    const groupList = document.createElement('ul');
    groupList.className = 'credset-group-list';

    // Sort within group: Tenant → Agent → Customer
    const ROLE_ORDER = { tenant: 0, agent: 1, customer: 2 };
    const sortedGroupSets = [...groupSets].sort(
      (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    );

    sortedGroupSets.forEach((set) => {
      const globalIndex = sets.indexOf(set);
      const li = createCredSetItem(set, globalIndex, sets);
      groupList.appendChild(li);
    });

    details.appendChild(groupList);
    container.appendChild(details);
  });
}

/**
 * Build a single credential-set list row.
 * @param {CredentialSet} set
 * @param {number} index
 * @param {CredentialSet[]} allSets
 * @returns {HTMLLIElement}
 */
function createCredSetItem(set, index, allSets) {
  const li = document.createElement('li');
  li.className = 'cred-item credset-item';
  li.dataset.id = set.id;

  // ── View mode layout ──────────────────────────────────────
  function renderViewMode() {
    li.innerHTML = '';

    const info = document.createElement('div');
    info.className = 'credset-info';

    const topRow = document.createElement('div');
    topRow.className = 'credset-top-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'credset-label item-text';
    labelEl.textContent = set.label;
    labelEl.title = 'Click to edit';

    topRow.appendChild(labelEl);
    topRow.appendChild(createRoleBadge(set.role));

    let showPassword = false;

    const passSpan = document.createElement('span');
    passSpan.className = 'credset-pass-val';
    passSpan.textContent = '••••••••';

    const metaEl = document.createElement('div');
    metaEl.className = 'credset-meta';
    metaEl.innerHTML = `<span class="credset-server">${set.subdomain}${set.tld}</span> <span class="credset-sep">·</span> <span class="credset-email">${set.email}</span> <span class="credset-sep">·</span> `;
    metaEl.appendChild(passSpan);

    info.appendChild(topRow);
    info.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'icon-btn copy';
    copyBtn.setAttribute('aria-label', `Copy ${set.label} details`);
    copyBtn.title = 'Copy credential set';
    copyBtn.textContent = '📋';

    copyBtn.addEventListener('click', () => {
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
        copyBtn.textContent = '✓';
        copyBtn.classList.add('copy-success');
        setTimeout(() => {
          copyBtn.textContent = '📋';
          copyBtn.classList.remove('copy-success');
        }, 1500);
      }).catch(() => { });
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'icon-btn toggle-pass';
    toggleBtn.setAttribute('aria-label', `Toggle password visibility for ${set.label}`);
    toggleBtn.title = 'Show password';
    toggleBtn.textContent = '👁️';

    toggleBtn.addEventListener('click', () => {
      showPassword = !showPassword;
      passSpan.textContent = showPassword ? set.password : '••••••••';
      passSpan.classList.toggle('credset-pass-val--revealed', showPassword);
      toggleBtn.title = showPassword ? 'Hide password' : 'Show password';
      toggleBtn.textContent = showPassword ? '🙈' : '👁️';
    });

    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'icon-btn duplicate';
    duplicateBtn.setAttribute('aria-label', `Duplicate ${set.label}`);
    duplicateBtn.title = 'Duplicate set';
    duplicateBtn.textContent = '📑';

    duplicateBtn.addEventListener('click', async () => {
      const sets = await getList(KEYS.CREDENTIAL_SETS);
      const currentIdx = sets.findIndex((s) => s.id === set.id);
      const newSet = {
        ...set,
        id: crypto.randomUUID(),
        label: `${set.label} (Copy)`,
      };
      if (currentIdx !== -1) {
        sets.splice(currentIdx + 1, 0, newSet);
      } else {
        sets.push(newSet);
      }
      await saveList(KEYS.CREDENTIAL_SETS, sets);
      renderCredSets(sets);
      showCredsetFeedback(`"${newSet.label}" duplicated ✓`);
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn edit';
    editBtn.setAttribute('aria-label', `Edit ${set.label}`);
    editBtn.textContent = '✏️';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn delete';
    deleteBtn.setAttribute('aria-label', `Delete ${set.label}`);
    deleteBtn.textContent = '🗑';

    actions.appendChild(copyBtn);
    actions.appendChild(toggleBtn);
    actions.appendChild(duplicateBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(info);
    li.appendChild(actions);

    // ── Edit ─────────────────────────────────────────────────
    editBtn.addEventListener('click', renderEditMode);
    labelEl.addEventListener('click', renderEditMode);

    // ── Delete ───────────────────────────────────────────────
    deleteBtn.addEventListener('click', async () => {
      const sets = await getList(KEYS.CREDENTIAL_SETS);
      const updated = sets.filter((s) => s.id !== set.id);
      await saveList(KEYS.CREDENTIAL_SETS, updated);
      renderCredSets(updated);
    });
  }

  // ── Edit mode layout ──────────────────────────────────────
  function renderEditMode() {
    li.innerHTML = '';
    li.classList.add('credset-item--editing');

    const grid = document.createElement('div');
    grid.className = 'credset-edit-grid';

    function field(labelText, inputEl) {
      const wrap = document.createElement('div');
      wrap.className = 'form-field';
      const lbl = document.createElement('label');
      lbl.className = 'form-label';
      lbl.textContent = labelText;
      wrap.appendChild(lbl);
      wrap.appendChild(inputEl);
      return wrap;
    }

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'item-edit-input';
    labelInput.value = set.label;
    labelInput.placeholder = 'Label';

    const roleSelect = document.createElement('select');
    roleSelect.className = 'item-edit-input';
    ['customer', 'agent', 'tenant'].forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r.charAt(0).toUpperCase() + r.slice(1);
      opt.selected = r === set.role;
      roleSelect.appendChild(opt);
    });

    const tldSelect = document.createElement('select');
    tldSelect.className = 'item-edit-input';
    ['.desku.io', '.desku.dev', '.desku.local'].forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t === '.desku.io' ? 'Production (.desku.io)'
        : t === '.desku.dev' ? 'Development (.desku.dev)'
          : 'Local (.desku.local)';
      opt.selected = t === set.tld;
      tldSelect.appendChild(opt);
    });

    const subInput = document.createElement('input');
    subInput.type = 'text';
    subInput.className = 'item-edit-input';
    subInput.value = set.subdomain;
    subInput.placeholder = 'Subdomain';

    const emailInput = document.createElement('input');
    emailInput.type = 'text';
    emailInput.className = 'item-edit-input';
    emailInput.value = set.email;
    emailInput.placeholder = 'Email';

    const passInput = document.createElement('input');
    passInput.type = 'password';
    passInput.className = 'item-edit-input';
    passInput.value = set.password;
    passInput.placeholder = 'Password';

    const passWrap = document.createElement('div');
    passWrap.className = 'password-input-wrap';
    const editEyeBtn = document.createElement('button');
    editEyeBtn.type = 'button';
    editEyeBtn.className = 'input-eye-btn';
    editEyeBtn.textContent = '👁️';
    editEyeBtn.title = 'Show password';
    editEyeBtn.setAttribute('aria-label', 'Toggle password visibility');
    editEyeBtn.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      editEyeBtn.textContent = isPass ? '🙈' : '👁️';
      editEyeBtn.title = isPass ? 'Hide password' : 'Show password';
    });
    passWrap.appendChild(passInput);
    passWrap.appendChild(editEyeBtn);

    grid.appendChild(field('Label', labelInput));
    grid.appendChild(field('Role', roleSelect));
    grid.appendChild(field('Environment', tldSelect));
    grid.appendChild(field('Subdomain', subInput));
    grid.appendChild(field('Email', emailInput));
    grid.appendChild(field('Password', passWrap));

    const actions = document.createElement('div');
    actions.className = 'item-actions credset-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'icon-btn save';
    saveBtn.setAttribute('aria-label', 'Save');
    saveBtn.textContent = '✓';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'icon-btn cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel');
    cancelBtn.textContent = '✕';

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    li.appendChild(grid);
    li.appendChild(actions);
    labelInput.focus();

    async function saveEdit() {
      const label = labelInput.value.trim();
      const subdomain = subInput.value.trim();
      const email = emailInput.value.trim();
      const password = passInput.value.trim();
      const role = roleSelect.value;
      const tld = tldSelect.value;

      if (!label || !subdomain || !email || !password) {
        labelInput.classList.add('input-error');
        setTimeout(() => labelInput.classList.remove('input-error'), 1500);
        return;
      }

      const sets = await getList(KEYS.CREDENTIAL_SETS);
      const idx = sets.findIndex((s) => s.id === set.id);
      if (idx === -1) return;

      sets[idx] = { ...sets[idx], label, role, tld, subdomain, email, password };
      // Update local reference so view mode reflects new values
      Object.assign(set, sets[idx]);

      await saveList(KEYS.CREDENTIAL_SETS, sets);
      li.classList.remove('credset-item--editing');
      renderViewMode();
    }

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', () => {
      li.classList.remove('credset-item--editing');
      renderViewMode();
    });
    grid.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') {
          li.classList.remove('credset-item--editing');
          renderViewMode();
        }
      });
    });
  }

  renderViewMode();
  return li;
}

// ─── Credential Sets — add form ──────────────────────────────────────────────

// ── Sample data for quick dev/testing ────────────────────────────────────────

/** @type {Omit<CredentialSet,'id'>[]} */
const SAMPLE_CREDENTIAL_SETS = [
  {
    label: 'Customer',
    role: 'customer',
    tld: '.desku.io',
    subdomain: 'yourdomain',
    email: 'customer@example.com',
    password: 'customer@123',
  },
  {
    label: 'Agent',
    role: 'agent',
    tld: '.desku.io',
    subdomain: 'yourdomain',
    email: 'agent@yourdomain.desku.io',
    password: 'agent@123',
  },
  {
    label: 'Tenant',
    role: 'tenant',
    tld: '.desku.io',
    subdomain: 'yourdomain',
    email: 'admin@yourdomain.desku.io',
    password: 'admin@123',
  },
  {
    label: 'Customer',
    role: 'customer',
    tld: '.desku.dev',
    subdomain: 'yourdomain',
    email: 'customer@dev.example.com',
    password: 'devpass@123',
  },
];

async function seedSampleData() {
  try {
    const existing = await getList(KEYS.CREDENTIAL_SETS);
    const toAdd = SAMPLE_CREDENTIAL_SETS.filter(
      (s) => !existing.some((e) => e.email === s.email && e.subdomain === s.subdomain && e.tld === s.tld)
    ).map((s) => ({ ...s, id: crypto.randomUUID() }));

    if (toAdd.length === 0) {
      showCredsetFeedback('Sample data already loaded.', false);
      return;
    }

    const updated = [...existing, ...toAdd];
    await saveList(KEYS.CREDENTIAL_SETS, updated);
    renderCredSets(updated);
    showCredsetFeedback(`✓ Added ${toAdd.length} sample credential set${toAdd.length > 1 ? 's' : ''}.`);
  } catch (err) {
    console.error('Failed to seed credential sample data:', err);
    showCredsetFeedback(`Failed to save: ${err.message}`, true);
  }
}

// Wire up both seed buttons
['seed-credsets-btn', 'seed-credsets-btn-inline'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', seedSampleData);
});

// ─────────────────────────────────────────────────────────────────────────────

function showCredsetFeedback(msg, isError = false) {
  const el = document.getElementById('credset-feedback');
  el.textContent = msg;
  el.className = 'quick-feedback' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(showCredsetFeedback._timer);
  showCredsetFeedback._timer = setTimeout(() => { el.hidden = true; }, 2500);
}

// Wire up Add Set form password eye toggle
const csPassToggleBtn = document.getElementById('toggle-cs-password-btn');
if (csPassToggleBtn) {
  csPassToggleBtn.addEventListener('click', () => {
    const input = document.getElementById('cs-password');
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    csPassToggleBtn.textContent = isPass ? '🙈' : '👁️';
    csPassToggleBtn.title = isPass ? 'Hide password' : 'Show password';
  });
}

document.getElementById('add-credset-btn').addEventListener('click', async () => {
  const label = document.getElementById('cs-label').value.trim();
  const role = document.getElementById('cs-role').value;
  const tld = document.getElementById('cs-tld').value;
  const subdomain = document.getElementById('cs-subdomain').value.trim();
  const email = document.getElementById('cs-email').value.trim();
  const password = document.getElementById('cs-password').value.trim();

  if (!label || !role || !tld || !subdomain || !email || !password) {
    showCredsetFeedback('All fields are required.', true);
    return;
  }

  const sets = await getList(KEYS.CREDENTIAL_SETS);
  const newSet = {
    id: crypto.randomUUID(),
    label,
    role,
    tld,
    subdomain,
    email,
    password,
  };

  sets.push(newSet);
  await saveList(KEYS.CREDENTIAL_SETS, sets);

  // Clear form
  ['cs-label', 'cs-subdomain', 'cs-email', 'cs-password'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('cs-role').selectedIndex = 0;
  document.getElementById('cs-tld').selectedIndex = 0;

  renderCredSets(sets);
  showCredsetFeedback(`"${label}" added ✓`);
});

// ─── Dummy Data Sets ────────────────────────────────────────────────────────

const SAMPLE_DUMMY_SETS = [
  {
    name: 'Address',
    entries: [
      '742 Evergreen Terrace, Springfield, OR 97477',
      '221B Baker Street, Marylebone, London NW1 6XE, UK',
      '1600 Amphitheatre Pkwy, Mountain View, CA 94043',
      '452 Elm Street, Suite 300, Dallas, TX 75201',
      '350 5th Ave, Empire State Building, New York, NY 10118'
    ]
  },
  {
    name: 'Phone',
    entries: [
      '+15552345678',
      '+18005550199',
      '+442079460958',
      '+12125550143',
      '+14155552671'
    ]
  },
  {
    name: 'Short Paragraph',
    entries: ['The morning light slowly filled the room as the quiet surroundings began to feel a little less still.', 'This example contains ordinary sentences that can be used to test how text appears inside a standard content area.', 'A clear layout makes it easier to understand information without requiring unnecessary actions or additional navigation.', 'The application processed the submitted values and displayed the updated information without any visible delay.', 'Small changes to spacing, alignment, and text size can have a noticeable effect on the overall appearance of a page.', 'The sample record contains fictional information intended only for testing forms, tables, and other interface elements.', 'Several options were reviewed before the final configuration was selected for the next testing cycle.', 'Longer text can help reveal whether a component expands naturally when the available space becomes limited.', 'The new settings were saved successfully, and the page continued to display the remaining information as expected.', 'A consistent structure makes repeated content easier to read, compare, and maintain across different sections.', 'The example value is intentionally generic so it can be reused safely in development and testing environments.', 'Users may encounter different layouts depending on the amount of information displayed within each section.', 'The system checks the provided information before allowing the next step to continue.', 'This paragraph contains enough text to test ordinary wrapping without introducing any meaningful business information.', 'The displayed message remains readable even when the surrounding container becomes smaller.', 'A well-structured form should remain understandable whether it contains a few values or a larger collection of fields.', 'The test process included several combinations of values to make sure the interface behaved consistently.', 'Additional content was added to verify how the component responds when its original dimensions are exceeded.', 'The information shown here is fictional and does not represent an actual customer, organization, or transaction.', 'The final result was reviewed carefully to ensure that the content remained readable across different screen sizes.']
  },
  {
    name: 'Medium Paragraph',
    entries: ['The application provides a simple interface for entering and reviewing information. Each section has been given enough sample content to make the layout appear realistic without depending on any specific business scenario.', 'During testing, several variations of the same input were entered to observe how the interface responded. Some values were intentionally short, while others contained enough text to test wrapping, spacing, and container resizing.', 'This sample content is designed to resemble ordinary application text while remaining completely fictional. It can be used repeatedly across development and testing environments without introducing information associated with real users or organizations.', 'The page contains several sections with different amounts of information. This makes it possible to check whether headings, descriptions, buttons, and other elements remain correctly aligned when the amount of visible text changes.', 'A typical testing workflow may involve entering information, reviewing the displayed result, changing one or more values, and submitting the updated form. Using realistic dummy content makes each step easier to reproduce and inspect.', 'The component should continue to behave normally when the available width changes. Longer sentences are included here to create natural line breaks and provide a more realistic representation of the content found in a typical application.', 'Several configuration values were changed during the test to verify that the interface could handle different combinations of input. The results were reviewed after each change to make sure previously entered information remained intact.', 'The example demonstrates how a moderate amount of descriptive content might appear inside a normal interface. The wording is intentionally generic so that it can be reused for different features and test scenarios.']
  },
  {
    name: 'Long Multi Paragraphs',
    entries: [
      `Modern applications often contain many different types of text, including headings, descriptions, instructions, notifications, and detailed explanations. Testing these elements with only a few short words can make an interface appear correct even when it has problems with longer content.

Using realistic dummy text provides a better way to verify how individual components behave under normal conditions. Longer sentences can expose unexpected wrapping, inconsistent spacing, incorrect alignment, and containers that do not expand as expected.

The content does not need to describe a real business process to be useful. Generic information with natural grammar is usually enough to reproduce the visual conditions that occur when an application receives ordinary user-generated content.`,

      `A typical form may contain several fields that accept different amounts of information. Some fields may contain a short value, while others may allow a complete description consisting of several sentences.

When testing these fields, it is useful to include content with different lengths and structures. Short values help verify compact layouts, while longer values can be used to test scrolling, text wrapping, maximum lengths, and responsive behavior.

This example intentionally avoids real names, organizations, addresses, and other identifiable information. The values are fictional and can therefore be used safely in development, staging, demonstrations, and automated testing.`,

      `The interface was tested with several groups of sample information to determine whether the layout remained consistent. Each group contained a different combination of short and long values, allowing the same component to be viewed under multiple conditions.

Some sections contained only a few sentences, while others contained multiple paragraphs. This helped reveal differences in spacing and height that were not visible when the component contained only a small amount of content.

After the test values were replaced with another set of dummy information, the overall structure remained unchanged. This indicates that the content can be reused when checking the same interface in different environments.`,

      `Information displayed inside an application does not always have a predictable length. A user might enter a short sentence, several paragraphs, or a description that contains much more detail than originally expected.

For this reason, interface testing should include a reasonable mixture of content lengths. It is particularly useful to check how text behaves when it reaches the edge of a container, when the screen becomes narrower, or when additional fields appear on the same page.

The sample paragraphs in this dataset are intentionally neutral. They provide enough variation to make the interface feel realistic while avoiding references to specific people, companies, products, or real-world events.`,

      `A reusable collection of dummy content can simplify repetitive testing tasks. Instead of creating new text whenever a form or component needs to be checked, testers can select values from a prepared set and immediately continue with the scenario.

Different lengths are useful for different purposes. A short paragraph can be used inside a compact card, a medium paragraph can test a standard content section, and multiple paragraphs can be used to evaluate larger containers or full-page layouts.

Because all of the information is fictional, the same dataset can be used repeatedly without introducing confidential or customer-specific information into a test environment.`,

      `The sample page contains several areas where descriptive information can be displayed. Each area has been given a different amount of text to make the resulting layout less predictable and therefore more useful for testing.

The first section contains a relatively small amount of information. The next section contains several sentences, while the final section contains multiple paragraphs with different sentence lengths. This variation helps simulate the way content normally changes between different records.

The wording remains intentionally general throughout the example. Nothing in the content is intended to represent an actual person, company, location, order, account, or event.`,

      `Testing a text-heavy interface involves more than checking whether the words are displayed correctly. It is also important to verify spacing, line height, wrapping, alignment, overflow behavior, and the relationship between text and nearby interface elements.

A component that looks correct with a single short sentence may behave differently when the same component receives several lines of content. Additional paragraphs can also change the height of surrounding elements and may reveal problems with scrolling or positioning.

For that reason, this example contains natural-looking dummy content in several different lengths. The values can be used to create consistent test conditions while keeping the underlying information completely fictional.`,

      `The application received a new set of sample values during the testing process. The values were entered into several fields and then displayed together in a summary section.

The shorter fields remained compact, while the longer descriptions occupied additional lines. This made it possible to inspect how the surrounding elements responded as the amount of content increased.

The same process was repeated with another set of values to make sure the layout was not dependent on a particular sentence or word combination. The test data was intentionally written in a neutral style so that it could be reused for different scenarios.`,

      `A collection of realistic dummy values is useful whenever an interface needs to be tested without using actual information. The values should look natural enough to exercise the interface properly, but they should not accidentally resemble confidential records or identifiable customer data.

For text fields, this usually means using complete sentences, normal punctuation, varied sentence lengths, and multiple paragraphs where appropriate. These characteristics create more realistic rendering conditions than repeated placeholder words.

The examples in this collection follow the same principle. They are written as ordinary informational text, but their meaning is intentionally generic and does not describe a particular real-world situation.`
    ]
  }
];

let allDummySets = [];

function showDummySetFeedback(msg, isError = false) {
  const el = document.getElementById('dummyset-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'quick-feedback' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(showDummySetFeedback._timer);
  showDummySetFeedback._timer = setTimeout(() => { el.hidden = true; }, 2500);
}

function renderDummySets(sets, filterQuery = '') {
  allDummySets = sets || [];
  const container = document.getElementById('list-dummysets');
  const emptyEl = document.getElementById('empty-dummysets');
  const badgeEl = document.getElementById('badge-dummysets');

  if (badgeEl) badgeEl.textContent = allDummySets.length;

  if (allDummySets.length === 0) {
    if (container) container.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;

  const query = filterQuery.toLowerCase().trim();
  const filtered = query
    ? allDummySets.filter((s) => s.name.toLowerCase().includes(query) || (s.entries || []).some((e) => e.toLowerCase().includes(query)))
    : allDummySets;

  if (!container) return;
  container.innerHTML = '';

  if (filtered.length === 0) {
    const noMatch = document.createElement('div');
    noMatch.className = 'empty-state';
    noMatch.innerHTML = '<p class="empty-title">No matching dummy sets found</p>';
    container.appendChild(noMatch);
    return;
  }

  filtered.forEach((set) => {
    const details = document.createElement('details');
    details.className = 'credset-group';
    details.open = Boolean(query); // Collapsed by default, expanded during search

    // ── Summary header ───────────────────────────────────────
    const summary = document.createElement('summary');
    summary.className = 'credset-group-summary';

    const nameEl = document.createElement('span');
    nameEl.className = 'credset-group-key item-text';
    nameEl.textContent = set.name;
    nameEl.title = 'Click to rename set';

    const countEl = document.createElement('span');
    countEl.className = 'credset-group-count';
    const numEntries = (set.entries || []).length;
    countEl.textContent = `${numEntries} ${numEntries === 1 ? 'item' : 'items'}`;

    const summaryActions = document.createElement('div');
    summaryActions.className = 'item-actions';

    const editSetBtn = document.createElement('button');
    editSetBtn.className = 'icon-btn edit';
    editSetBtn.setAttribute('aria-label', `Rename ${set.name}`);
    editSetBtn.title = 'Rename set';
    editSetBtn.textContent = '✏️';

    const deleteSetBtn = document.createElement('button');
    deleteSetBtn.className = 'icon-btn delete';
    deleteSetBtn.setAttribute('aria-label', `Delete ${set.name}`);
    deleteSetBtn.title = 'Delete set';
    deleteSetBtn.textContent = '🗑';

    summaryActions.appendChild(editSetBtn);
    summaryActions.appendChild(deleteSetBtn);

    summary.appendChild(nameEl);
    summary.appendChild(countEl);
    summary.appendChild(summaryActions);
    details.appendChild(summary);

    // ── Rename Set handler (inline) ───────────────────────────
    function enterRenameSet(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const input = document.createElement('input');
      input.className = 'item-edit-input';
      input.type = 'text';
      input.value = set.name;
      input.style.maxWidth = '200px';

      summary.replaceChild(input, nameEl);
      summaryActions.innerHTML = '';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'icon-btn save';
      saveBtn.setAttribute('aria-label', 'Save rename');
      saveBtn.textContent = '✓';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'icon-btn cancel';
      cancelBtn.setAttribute('aria-label', 'Cancel rename');
      cancelBtn.textContent = '✕';

      summaryActions.appendChild(saveBtn);
      summaryActions.appendChild(cancelBtn);
      input.focus();
      input.select();

      async function saveRename(ev) {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        const newName = input.value.trim();
        if (newName && newName !== set.name) {
          set.name = newName;
          await saveList(KEYS.DUMMY_DATA_SETS, allDummySets);
          renderDummySets(allDummySets, document.getElementById('search-dummysets')?.value || '');
          showDummySetFeedback(`Set renamed to "${newName}" ✓`);
        } else {
          exitRename(ev);
        }
      }

      function exitRename(ev) {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        renderDummySets(allDummySets, document.getElementById('search-dummysets')?.value || '');
      }

      saveBtn.addEventListener('click', saveRename);
      cancelBtn.addEventListener('click', exitRename);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') saveRename(ev);
        if (ev.key === 'Escape') exitRename(ev);
      });
      input.addEventListener('click', (ev) => ev.stopPropagation());
    }

    editSetBtn.addEventListener('click', enterRenameSet);
    deleteSetBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      allDummySets = allDummySets.filter((s) => s.id !== set.id);
      await saveList(KEYS.DUMMY_DATA_SETS, allDummySets);
      renderDummySets(allDummySets, document.getElementById('search-dummysets')?.value || '');
      showDummySetFeedback(`Set "${set.name}" deleted`);
    });

    // ── Items inside group ────────────────────────────────────
    const groupList = document.createElement('ul');
    groupList.className = 'credset-group-list';

    if (!set.entries || set.entries.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'cred-item';
      emptyLi.style.cssText = 'color: var(--gray-400); font-style: italic; justify-content: center; padding: 12px 14px;';
      emptyLi.textContent = 'No entries in this set yet. Add one below.';
      groupList.appendChild(emptyLi);
    } else {
      set.entries.forEach((entry, entryIndex) => {
        const li = document.createElement('li');
        li.className = 'cred-item';

        const textEl = document.createElement('span');
        textEl.className = 'item-text';
        textEl.textContent = entry;
        textEl.title = 'Click to edit';

        const itemActions = document.createElement('div');
        itemActions.className = 'item-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'icon-btn copy';
        copyBtn.setAttribute('aria-label', 'Copy entry');
        copyBtn.title = 'Copy entry';
        copyBtn.textContent = '📋';

        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(entry).then(() => {
            copyBtn.textContent = '✓';
            copyBtn.classList.add('copy-success');
            setTimeout(() => {
              copyBtn.textContent = '📋';
              copyBtn.classList.remove('copy-success');
            }, 1500);
          }).catch(() => { });
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn edit';
        editBtn.setAttribute('aria-label', 'Edit entry');
        editBtn.title = 'Edit entry';
        editBtn.textContent = '✏️';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn delete';
        deleteBtn.setAttribute('aria-label', 'Delete entry');
        deleteBtn.title = 'Delete entry';
        deleteBtn.textContent = '🗑';

        deleteBtn.addEventListener('click', async () => {
          set.entries.splice(entryIndex, 1);
          await saveList(KEYS.DUMMY_DATA_SETS, allDummySets);
          renderDummySets(allDummySets, document.getElementById('search-dummysets')?.value || '');
        });

        itemActions.appendChild(copyBtn);
        itemActions.appendChild(editBtn);
        itemActions.appendChild(deleteBtn);

        li.appendChild(textEl);
        li.appendChild(itemActions);

        // ── Inline Edit Entry ─────────────────────────────────
        function enterEditEntry() {
          const input = document.createElement('textarea');
          input.className = 'item-edit-input';
          input.style.cssText = 'width: 100%; min-height: 52px; resize: vertical; padding: 6px 8px; font-family: inherit; font-size: 13px;';
          input.value = entry;

          li.replaceChild(input, textEl);
          itemActions.innerHTML = '';

          const saveBtn = document.createElement('button');
          saveBtn.className = 'icon-btn save';
          saveBtn.setAttribute('aria-label', 'Save edit');
          saveBtn.textContent = '✓';

          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'icon-btn cancel';
          cancelBtn.setAttribute('aria-label', 'Cancel edit');
          cancelBtn.textContent = '✕';

          itemActions.appendChild(saveBtn);
          itemActions.appendChild(cancelBtn);
          input.focus();
          input.select();

          async function saveEdit() {
            const newVal = input.value.trim();
            if (!newVal || newVal === entry) {
              exitEdit();
              return;
            }
            set.entries[entryIndex] = newVal;
            await saveList(KEYS.DUMMY_DATA_SETS, allDummySets);
            renderDummySets(allDummySets, document.getElementById('search-dummysets')?.value || '');
          }

          function exitEdit() {
            renderDummySets(allDummySets, document.getElementById('search-dummysets')?.value || '');
          }

          saveBtn.addEventListener('click', saveEdit);
          cancelBtn.addEventListener('click', exitEdit);
          input.addEventListener('keydown', (ev) => {
            if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') saveEdit();
            if (ev.key === 'Escape') exitEdit();
          });
        }

        editBtn.addEventListener('click', enterEditEntry);
        textEl.addEventListener('click', enterEditEntry);

        groupList.appendChild(li);
      });
    }

    details.appendChild(groupList);

    // ── Add Entry Row at bottom of group ──────────────────────
    const addRow = document.createElement('div');
    addRow.className = 'add-row';
    addRow.style.cssText = 'padding: 10px 14px; background: var(--gray-50); border-top: 1px solid var(--gray-200);';

    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.className = 'add-input';
    addInput.placeholder = `New entry for "${set.name}"…`;
    addInput.autocomplete = 'off';

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none">
        <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      Add
    `;

    async function handleAddEntry() {
      const val = addInput.value.trim();
      if (!val) {
        addInput.focus();
        return;
      }
      if (!Array.isArray(set.entries)) set.entries = [];
      set.entries.push(val);
      await saveList(KEYS.DUMMY_DATA_SETS, allDummySets);
      renderDummySets(allDummySets, document.getElementById('search-dummysets')?.value || '');
    }

    addBtn.addEventListener('click', handleAddEntry);
    addInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') handleAddEntry();
    });

    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    details.appendChild(addRow);

    container.appendChild(details);
  });
}

// ─── Add Set Form ───────────────────────────────────────────

document.getElementById('add-dummyset-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('add-dummyset-input');
  const name = input?.value.trim();
  if (!name) {
    showDummySetFeedback('Enter a set name first.', true);
    input?.focus();
    return;
  }

  const existing = await getList(KEYS.DUMMY_DATA_SETS);
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    showDummySetFeedback(`A set named "${name}" already exists.`, true);
    return;
  }

  const newSet = {
    id: crypto.randomUUID(),
    name,
    entries: []
  };

  const updated = [...existing, newSet];
  await saveList(KEYS.DUMMY_DATA_SETS, updated);
  if (input) input.value = '';
  renderDummySets(updated);
  showDummySetFeedback(`Set "${name}" added ✓`);
});

document.getElementById('add-dummyset-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('add-dummyset-btn')?.click();
  }
});

// Search filter for dummy sets
document.getElementById('search-dummysets')?.addEventListener('input', (e) => {
  renderDummySets(allDummySets, e.target.value);
});

// Seed sample data for dummy sets
async function seedDummySampleData() {
  try {
    const existing = await getList(KEYS.DUMMY_DATA_SETS);
    const toAdd = SAMPLE_DUMMY_SETS.filter(
      (s) => !existing.some((e) => e.name.toLowerCase() === s.name.toLowerCase())
    ).map((s) => ({
      ...s,
      id: crypto.randomUUID(),
      entries: [...s.entries]
    }));

    if (toAdd.length === 0) {
      showDummySetFeedback('Sample dummy sets already loaded.', false);
      return;
    }

    const updated = [...existing, ...toAdd];
    await saveList(KEYS.DUMMY_DATA_SETS, updated);
    renderDummySets(updated);
    showDummySetFeedback(`✓ Added ${toAdd.length} sample dummy data set${toAdd.length > 1 ? 's' : ''}.`);
  } catch (err) {
    console.error('Failed to seed dummy sample data:', err);
    showDummySetFeedback(`Failed to save: ${err.message}`, true);
  }
}

['seed-dummysets-btn', 'seed-dummysets-btn-inline'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', seedDummySampleData);
});

// ─── Import / Export ─────────────────────────────────────────────────────────

document.getElementById('export-btn').addEventListener('click', async () => {
  const emails = await getList(KEYS.EMAILS);
  const passwords = await getList(KEYS.PASSWORDS);
  const credentialSets = await getList(KEYS.CREDENTIAL_SETS);
  const dummyDataSets = await getList(KEYS.DUMMY_DATA_SETS);
  const payload = JSON.stringify({ emails, passwords, credentialSets, dummyDataSets }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dcm_credentials.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('import-status');
  statusEl.hidden = false;
  statusEl.className = 'import-status';
  statusEl.textContent = 'Reading file…';

  try {
    const text = await file.text();
    const json = JSON.parse(text);

    if (
      !Array.isArray(json.emails) &&
      !Array.isArray(json.passwords) &&
      !Array.isArray(json.credentialSets) &&
      !Array.isArray(json.dummyDataSets)
    ) {
      throw new Error('Invalid format — expected { emails, passwords, credentialSets, dummyDataSets }');
    }

    const mode = document.querySelector('input[name="import-mode"]:checked').value;

    if (mode === 'replace') {
      if (Array.isArray(json.emails)) await saveList(KEYS.EMAILS, json.emails);
      if (Array.isArray(json.passwords)) await saveList(KEYS.PASSWORDS, json.passwords);
      if (Array.isArray(json.credentialSets)) await saveList(KEYS.CREDENTIAL_SETS, json.credentialSets);
      if (Array.isArray(json.dummyDataSets)) await saveList(KEYS.DUMMY_DATA_SETS, json.dummyDataSets);
    } else {
      const currentEmails = await getList(KEYS.EMAILS);
      const currentPasswords = await getList(KEYS.PASSWORDS);
      const currentSets = await getList(KEYS.CREDENTIAL_SETS);
      const currentDummySets = await getList(KEYS.DUMMY_DATA_SETS);

      await saveList(KEYS.EMAILS, [...new Set([...currentEmails, ...(json.emails || [])])]);
      await saveList(KEYS.PASSWORDS, [...new Set([...currentPasswords, ...(json.passwords || [])])]);

      // Merge sets by id (avoid duplicates)
      const incomingSets = (json.credentialSets || []).filter(
        (s) => s.id && !currentSets.some((c) => c.id === s.id)
      );
      await saveList(KEYS.CREDENTIAL_SETS, [...currentSets, ...incomingSets]);

      // Merge dummy sets by id/name
      const incomingDummySets = (json.dummyDataSets || []).filter(
        (s) => s.id && !currentDummySets.some((c) => c.id === s.id || c.name.toLowerCase() === s.name.toLowerCase())
      );
      await saveList(KEYS.DUMMY_DATA_SETS, [...currentDummySets, ...incomingDummySets]);
    }

    // Re-render all lists
    await renderList_fromStorage(emailCfg);
    await renderList_fromStorage(passCfg);
    const updatedSets = await getList(KEYS.CREDENTIAL_SETS);
    renderCredSets(updatedSets);
    const updatedDummySets = await getList(KEYS.DUMMY_DATA_SETS);
    renderDummySets(updatedDummySets);

    statusEl.className = 'import-status success';
    statusEl.textContent = `✓ Imported successfully (${mode} mode).`;
  } catch (err) {
    statusEl.className = 'import-status error';
    statusEl.textContent = `Error: ${err.message}`;
  }

  e.target.value = '';
  setTimeout(() => { statusEl.hidden = true; }, 4000);
});

// ─── Storage change listener (sync across tabs) ──────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes[KEYS.EMAILS]) renderList(emailCfg, changes[KEYS.EMAILS].newValue || []);
    if (changes[KEYS.PASSWORDS]) renderList(passCfg, changes[KEYS.PASSWORDS].newValue || []);
    if (changes[KEYS.CREDENTIAL_SETS]) renderCredSets(changes[KEYS.CREDENTIAL_SETS].newValue || []);
  }
  if (area === 'local') {
    if (changes[KEYS.DUMMY_DATA_SETS]) renderDummySets(changes[KEYS.DUMMY_DATA_SETS].newValue || []);
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

(async () => {
  await renderList_fromStorage(emailCfg);
  await renderList_fromStorage(passCfg);
  const sets = await getList(KEYS.CREDENTIAL_SETS);
  renderCredSets(sets);
  const dummySets = await getList(KEYS.DUMMY_DATA_SETS);
  renderDummySets(dummySets);
})();
