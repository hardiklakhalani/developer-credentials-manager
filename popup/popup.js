/**
 * popup/popup.js
 * Handles: stat counts, quick-add for emails & passwords, open options page.
 */

'use strict';

// ─── Storage helpers (inline, since content scripts can't share modules directly) ──

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

// ─── DOM refs ───────────────────────────────────────────────────────────────

const countEmails    = document.getElementById('count-emails');
const countPasswords = document.getElementById('count-passwords');
const emailInput     = document.getElementById('quick-email-input');
const passInput      = document.getElementById('quick-pass-input');
const emailBtn       = document.getElementById('quick-email-btn');
const passBtn        = document.getElementById('quick-pass-btn');
const feedback       = document.getElementById('quick-feedback');
const openOptionsBtn = document.getElementById('open-options-btn');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showFeedback(msg, isError = false) {
  feedback.textContent = msg;
  feedback.className = 'quick-feedback' + (isError ? ' error' : '');
  feedback.hidden = false;
  clearTimeout(showFeedback._timer);
  showFeedback._timer = setTimeout(() => { feedback.hidden = true; }, 2200);
}

async function refreshCounts() {
  const emails    = await getList(KEYS.EMAILS);
  const passwords = await getList(KEYS.PASSWORDS);
  countEmails.textContent    = emails.length;
  countPasswords.textContent = passwords.length;
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

async function quickAdd(inputEl, key, label) {
  const val = inputEl.value.trim();
  if (!val) {
    showFeedback(`Enter a ${label} first.`, true);
    inputEl.focus();
    return;
  }
  const list = await getList(key);
  if (list.includes(val)) {
    showFeedback(`"${val}" is already in the ${label} list.`, true);
    return;
  }
  list.push(val);
  await saveList(key, list);
  inputEl.value = '';
  await refreshCounts();
  showFeedback(`${label.charAt(0).toUpperCase() + label.slice(1)} added ✓`);
}

emailBtn.addEventListener('click', () => quickAdd(emailInput, KEYS.EMAILS, 'email'));
passBtn.addEventListener('click',  () => quickAdd(passInput,  KEYS.PASSWORDS, 'password'));

// Allow Enter key to submit
emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') emailBtn.click(); });
passInput.addEventListener('keydown',  (e) => { if (e.key === 'Enter') passBtn.click(); });

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

refreshCounts();
