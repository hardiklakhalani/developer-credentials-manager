/**
 * shared/storage.js
 * Single source of truth for all data reads and writes.
 * Uses chrome.storage.sync so data syncs across the user's Chrome profile.
 *
 * Storage keys:
 *   dcm_emails    : string[]
 *   dcm_passwords : string[]
 */

const DCM_KEYS = {
  EMAILS: 'dcm_emails',
  PASSWORDS: 'dcm_passwords',
};

/**
 * Retrieve the saved email list.
 * @returns {Promise<string[]>}
 */
function getEmails() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [DCM_KEYS.EMAILS]: [] }, (result) => {
      resolve(result[DCM_KEYS.EMAILS]);
    });
  });
}

/**
 * Retrieve the saved password list.
 * @returns {Promise<string[]>}
 */
function getPasswords() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [DCM_KEYS.PASSWORDS]: [] }, (result) => {
      resolve(result[DCM_KEYS.PASSWORDS]);
    });
  });
}

/**
 * Save the email list.
 * @param {string[]} arr
 * @returns {Promise<void>}
 */
function saveEmails(arr) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [DCM_KEYS.EMAILS]: arr }, resolve);
  });
}

/**
 * Save the password list.
 * @param {string[]} arr
 * @returns {Promise<void>}
 */
function savePasswords(arr) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [DCM_KEYS.PASSWORDS]: arr }, resolve);
  });
}

/**
 * Export both lists as a JSON file download.
 */
async function exportData() {
  const emails = await getEmails();
  const passwords = await getPasswords();
  const payload = JSON.stringify({ emails, passwords }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dcm_credentials.json';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import data from a parsed JSON object.
 * @param {{ emails?: string[], passwords?: string[] }} json
 * @param {'replace'|'merge'} mode
 * @returns {Promise<void>}
 */
async function importData(json, mode = 'replace') {
  if (mode === 'replace') {
    if (Array.isArray(json.emails)) await saveEmails(json.emails);
    if (Array.isArray(json.passwords)) await savePasswords(json.passwords);
  } else {
    const currentEmails = await getEmails();
    const currentPasswords = await getPasswords();
    const mergedEmails = [...new Set([...currentEmails, ...(json.emails || [])])];
    const mergedPasswords = [...new Set([...currentPasswords, ...(json.passwords || [])])];
    await saveEmails(mergedEmails);
    await savePasswords(mergedPasswords);
  }
}
