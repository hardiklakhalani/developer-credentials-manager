/**
 * shared/storage.js
 * Single source of truth for all data reads and writes.
 * Uses chrome.storage.sync so data syncs across the user's Chrome profile.
 *
 * Storage keys:
 *   dcm_emails           : string[]
 *   dcm_passwords        : string[]
 *   dcm_credential_sets  : CredentialSet[]
 *   dcm_dummy_data_sets  : DummyDataSet[]
 *
 * @typedef {{
 *   id:        string,
 *   label:     string,
 *   role:      'customer'|'agent'|'tenant',
 *   tld:       '.desku.io'|'.desku.dev'|'.desku.local',
 *   subdomain: string,
 *   email:     string,
 *   password:  string,
 * }} CredentialSet
 *
 * @typedef {{
 *   id:      string,
 *   name:    string,
 *   entries: string[],
 * }} DummyDataSet
 */

const DCM_KEYS = {
  EMAILS:           'dcm_emails',
  PASSWORDS:        'dcm_passwords',
  CREDENTIAL_SETS:  'dcm_credential_sets',
  DUMMY_DATA_SETS:  'dcm_dummy_data_sets',
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
 * Export lists as a JSON file download.
 */
async function exportData() {
  const emails = await getEmails();
  const passwords = await getPasswords();
  const credentialSets = await getCredentialSets();
  const dummyDataSets = await getDummyDataSets();
  const payload = JSON.stringify({ emails, passwords, credentialSets, dummyDataSets }, null, 2);
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
 * @param {{ emails?: string[], passwords?: string[], credentialSets?: CredentialSet[], dummyDataSets?: DummyDataSet[] }} json
 * @param {'replace'|'merge'} mode
 * @returns {Promise<void>}
 */
async function importData(json, mode = 'replace') {
  if (mode === 'replace') {
    if (Array.isArray(json.emails)) await saveEmails(json.emails);
    if (Array.isArray(json.passwords)) await savePasswords(json.passwords);
    if (Array.isArray(json.credentialSets)) await saveCredentialSets(json.credentialSets);
    if (Array.isArray(json.dummyDataSets)) await saveDummyDataSets(json.dummyDataSets);
  } else {
    const currentEmails = await getEmails();
    const currentPasswords = await getPasswords();
    const currentCredSets = await getCredentialSets();
    const currentDummySets = await getDummyDataSets();

    const mergedEmails = [...new Set([...currentEmails, ...(json.emails || [])])];
    const mergedPasswords = [...new Set([...currentPasswords, ...(json.passwords || [])])];
    await saveEmails(mergedEmails);
    await savePasswords(mergedPasswords);

    if (Array.isArray(json.credentialSets)) {
      const incomingCredSets = json.credentialSets.filter(
        (s) => s.id && !currentCredSets.some((c) => c.id === s.id)
      );
      await saveCredentialSets([...currentCredSets, ...incomingCredSets]);
    }

    if (Array.isArray(json.dummyDataSets)) {
      const incomingDummySets = json.dummyDataSets.filter(
        (s) => s.id && !currentDummySets.some((c) => c.id === s.id)
      );
      await saveDummyDataSets([...currentDummySets, ...incomingDummySets]);
    }
  }
}

// ─── Credential Sets ─────────────────────────────────────────────────────────

/**
 * Retrieve the saved credential sets list.
 * @returns {Promise<CredentialSet[]>}
 */
function getCredentialSets() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [DCM_KEYS.CREDENTIAL_SETS]: [] }, (result) => {
      resolve(result[DCM_KEYS.CREDENTIAL_SETS]);
    });
  });
}

/**
 * Persist the full credential sets array.
 * @param {CredentialSet[]} arr
 * @returns {Promise<void>}
 */
function saveCredentialSets(arr) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [DCM_KEYS.CREDENTIAL_SETS]: arr }, resolve);
  });
}

/**
 * Append a new credential set (assigns a new id).
 * @param {Omit<CredentialSet, 'id'>} set
 * @returns {Promise<CredentialSet>} the saved set with its generated id
 */
async function addCredentialSet(set) {
  const sets = await getCredentialSets();
  const newSet = { ...set, id: crypto.randomUUID() };
  sets.push(newSet);
  await saveCredentialSets(sets);
  return newSet;
}

/**
 * Update an existing credential set by id.
 * @param {string} id
 * @param {Partial<Omit<CredentialSet, 'id'>>} patch
 * @returns {Promise<void>}
 */
async function updateCredentialSet(id, patch) {
  const sets = await getCredentialSets();
  const idx = sets.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sets[idx] = { ...sets[idx], ...patch };
  await saveCredentialSets(sets);
}

/**
 * Delete a credential set by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteCredentialSet(id) {
  const sets = await getCredentialSets();
  await saveCredentialSets(sets.filter((s) => s.id !== id));
}

// ─── Dummy Data Sets ────────────────────────────────────────────────────────

/**
 * Retrieve the saved dummy data sets list.
 * Checks chrome.storage.local first, falling back to chrome.storage.sync for backwards compatibility.
 * @returns {Promise<DummyDataSet[]>}
 */
function getDummyDataSets() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [DCM_KEYS.DUMMY_DATA_SETS]: null }, (localRes) => {
      if (localRes && Array.isArray(localRes[DCM_KEYS.DUMMY_DATA_SETS])) {
        resolve(localRes[DCM_KEYS.DUMMY_DATA_SETS]);
      } else {
        chrome.storage.sync.get({ [DCM_KEYS.DUMMY_DATA_SETS]: [] }, (syncRes) => {
          const data = (syncRes && syncRes[DCM_KEYS.DUMMY_DATA_SETS]) || [];
          if (data.length > 0) {
            chrome.storage.local.set({ [DCM_KEYS.DUMMY_DATA_SETS]: data });
          }
          resolve(data);
        });
      }
    });
  });
}

/**
 * Persist the full dummy data sets array in chrome.storage.local (to prevent sync quota overflow).
 * @param {DummyDataSet[]} arr
 * @returns {Promise<void>}
 */
function saveDummyDataSets(arr) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [DCM_KEYS.DUMMY_DATA_SETS]: arr }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving dummy data sets:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      chrome.storage.sync.remove(DCM_KEYS.DUMMY_DATA_SETS, () => resolve());
    });
  });
}

/**
 * Append a new dummy data set.
 * @param {string} name
 * @param {string[]} [entries=[]]
 * @returns {Promise<DummyDataSet>} the saved set with its generated id
 */
async function addDummyDataSet(name, entries = []) {
  const sets = await getDummyDataSets();
  const newSet = {
    id: crypto.randomUUID(),
    name: name.trim(),
    entries: Array.isArray(entries) ? entries : []
  };
  sets.push(newSet);
  await saveDummyDataSets(sets);
  return newSet;
}

/**
 * Update an existing dummy data set by id.
 * @param {string} id
 * @param {Partial<Omit<DummyDataSet, 'id'>>} patch
 * @returns {Promise<void>}
 */
async function updateDummyDataSet(id, patch) {
  const sets = await getDummyDataSets();
  const idx = sets.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sets[idx] = { ...sets[idx], ...patch };
  await saveDummyDataSets(sets);
}

/**
 * Delete a dummy data set by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteDummyDataSet(id) {
  const sets = await getDummyDataSets();
  await saveDummyDataSets(sets.filter((s) => s.id !== id));
}
