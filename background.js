/**
 * background.js (Service Worker)
 *
 * Handles:
 *  1. Navigation message from content script / popup to open the options page on a specific tab.
 *  2. Registration and dynamic updates of the "Fill Dummy Data" context menu for editable fields.
 *  3. Context menu click handling: picking a random dummy entry and sending it to content script.
 */

'use strict';

const CONTEXT_MENU_PARENT_ID = 'dcm_fill_dummy_data_parent';
const CONTEXT_MENU_NO_SETS_ID = 'dcm_no_sets';
const CONTEXT_MENU_PREFIX = 'dcm_set_';

/**
 * Open or focus the options page and navigate to a given tab anchor.
 * @param {string} [tabName='credsets']
 */
function openOptionsPage(tabName = 'credsets') {
  const optionsUrl = chrome.runtime.getURL(`options/options.html#${tabName}`);

  chrome.tabs.query({ url: chrome.runtime.getURL('options/options.html*') }, (tabs) => {
    if (tabs && tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true, url: optionsUrl });
      if (tabs[0].windowId) {
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url: optionsUrl });
    }
  });
}

/**
 * Retrieve dummy data sets from local storage, with fallback to sync storage.
 * @returns {Promise<Array>}
 */
function getDummyDataSets() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ dcm_dummy_data_sets: null }, (localResult) => {
      if (localResult && Array.isArray(localResult.dcm_dummy_data_sets)) {
        resolve(localResult.dcm_dummy_data_sets);
      } else {
        chrome.storage.sync.get({ dcm_dummy_data_sets: [] }, (syncResult) => {
          resolve((syncResult && syncResult.dcm_dummy_data_sets) || []);
        });
      }
    });
  });
}

/**
 * Rebuild context menus for Dummy Data Sets based on current storage.
 */
function syncContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      // Silently ignore removal errors during worker re-initialization
    }

    getDummyDataSets().then((sets) => {
      // Create top-level parent menu item shown ONLY on editable fields
      chrome.contextMenus.create({
        id: CONTEXT_MENU_PARENT_ID,
        title: 'Fill Dummy Data',
        contexts: ['editable']
      }, () => {
        if (chrome.runtime.lastError) return;

        if (sets.length === 0) {
          // Empty state: guide user to options
          chrome.contextMenus.create({
            id: CONTEXT_MENU_NO_SETS_ID,
            parentId: CONTEXT_MENU_PARENT_ID,
            title: '(No sets configured - Open Settings)',
            contexts: ['editable']
          });
        } else {
          // Render each configured Dummy Data Set
          sets.forEach((set) => {
            const hasItems = Array.isArray(set.entries) && set.entries.length > 0;
            chrome.contextMenus.create({
              id: `${CONTEXT_MENU_PREFIX}${set.id}`,
              parentId: CONTEXT_MENU_PARENT_ID,
              title: hasItems ? set.name : `${set.name} (0 items)`,
              enabled: hasItems,
              contexts: ['editable']
            });
          });
        }
      });
    });
  });
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

// Open options tab message listener
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.action === 'openOptions') {
    openOptionsPage(message.tab || 'credsets');
  }
});

// Context menu click listener
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === CONTEXT_MENU_NO_SETS_ID) {
    openOptionsPage('dummysets');
    return;
  }

  if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(CONTEXT_MENU_PREFIX)) {
    const setId = info.menuItemId.replace(CONTEXT_MENU_PREFIX, '');

    getDummyDataSets().then((sets) => {
      const targetSet = sets.find((s) => s.id === setId);

      if (!targetSet || !Array.isArray(targetSet.entries) || targetSet.entries.length === 0) {
        return;
      }

      // Select a random entry from the target set
      const randomIndex = Math.floor(Math.random() * targetSet.entries.length);
      const randomValue = targetSet.entries[randomIndex];

      const targetFrameId = (typeof info.frameId === 'number') ? info.frameId : 0;

      // Dispatch to the targeted frame first (e.g. TinyMCE iframe)
      chrome.tabs.sendMessage(tab.id, {
        action: 'fillDummyData',
        value: randomValue
      }, { frameId: targetFrameId }, (response) => {
        // If subframe failed or didn't find the editable target, also try top frame
        if (chrome.runtime.lastError || !response || !response.success) {
          if (targetFrameId !== 0) {
            chrome.tabs.sendMessage(tab.id, {
              action: 'fillDummyData',
              value: randomValue
            });
          }
        }
      });
    });
  }
});

// Keep context menus in sync whenever dcm_dummy_data_sets changes in storage
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' || area === 'sync') && changes.dcm_dummy_data_sets) {
    syncContextMenus();
  }
});

// Lifecycle setup
chrome.runtime.onInstalled.addListener(() => {
  syncContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  syncContextMenus();
});

// Initial invocation when worker wakes up
syncContextMenus();
