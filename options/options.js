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
 */

'use strict';

// ─── Storage helpers ────────────────────────────────────────────────────────

const KEYS = { EMAILS: 'dcm_emails', PASSWORDS: 'dcm_passwords' };

function getList(key) {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [key]: [] }, (r) => resolve(r[key]));
  });
}

function saveList(key, arr) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [key]: arr }, resolve);
  });
}

// ─── Tab navigation ─────────────────────────────────────────────────────────

const navItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    navItems.forEach((n) => n.classList.remove('active'));
    tabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ─── List renderer ──────────────────────────────────────────────────────────

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
    // Replace textEl with an input
    const input = document.createElement('input');
    input.className = 'item-edit-input';
    input.type = 'text';
    input.value = val;
    input.setAttribute('aria-label', 'Edit value');

    li.replaceChild(input, textEl);

    // Replace delete button with save + cancel
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

// ─── Wire up events ──────────────────────────────────────────────────────────

// Search
document.getElementById('search-emails').addEventListener('input', (e) => {
  filterList('list-emails', e.target.value.toLowerCase());
});

document.getElementById('search-passwords').addEventListener('input', (e) => {
  filterList('list-passwords', e.target.value.toLowerCase());
});

// Add buttons
document.getElementById('add-email-btn').addEventListener('click', () => addItem(emailCfg, 'add-email-input'));
document.getElementById('add-pass-btn').addEventListener('click',  () => addItem(passCfg,  'add-pass-input'));

// Enter key on add inputs
document.getElementById('add-email-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(emailCfg, 'add-email-input'); });
document.getElementById('add-pass-input').addEventListener('keydown',  (e) => { if (e.key === 'Enter') addItem(passCfg,  'add-pass-input'); });

// ─── Import / Export ─────────────────────────────────────────────────────────

document.getElementById('export-btn').addEventListener('click', async () => {
  const emails    = await getList(KEYS.EMAILS);
  const passwords = await getList(KEYS.PASSWORDS);
  const payload = JSON.stringify({ emails, passwords }, null, 2);
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

    if (!Array.isArray(json.emails) && !Array.isArray(json.passwords)) {
      throw new Error('Invalid format — expected { emails: [], passwords: [] }');
    }

    const mode = document.querySelector('input[name="import-mode"]:checked').value;

    if (mode === 'replace') {
      if (Array.isArray(json.emails))    await saveList(KEYS.EMAILS,    json.emails);
      if (Array.isArray(json.passwords)) await saveList(KEYS.PASSWORDS, json.passwords);
    } else {
      // Merge
      const currentEmails    = await getList(KEYS.EMAILS);
      const currentPasswords = await getList(KEYS.PASSWORDS);
      const mergedEmails    = [...new Set([...currentEmails,    ...(json.emails    || [])])];
      const mergedPasswords = [...new Set([...currentPasswords, ...(json.passwords || [])])];
      await saveList(KEYS.EMAILS,    mergedEmails);
      await saveList(KEYS.PASSWORDS, mergedPasswords);
    }

    // Re-render both lists
    await renderList_fromStorage(emailCfg);
    await renderList_fromStorage(passCfg);

    statusEl.className = 'import-status success';
    statusEl.textContent = `✓ Imported successfully (${mode} mode).`;
  } catch (err) {
    statusEl.className = 'import-status error';
    statusEl.textContent = `Error: ${err.message}`;
  }

  // Reset file input so same file can be re-selected
  e.target.value = '';
  setTimeout(() => { statusEl.hidden = true; }, 4000);
});

// ─── Storage change listener (sync across tabs) ──────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes[KEYS.EMAILS])    renderList(emailCfg, changes[KEYS.EMAILS].newValue   || []);
  if (changes[KEYS.PASSWORDS]) renderList(passCfg,  changes[KEYS.PASSWORDS].newValue || []);
});

// ─── Init ────────────────────────────────────────────────────────────────────

(async () => {
  await renderList_fromStorage(emailCfg);
  await renderList_fromStorage(passCfg);
})();
