/**
 * background.js (Service Worker)
 *
 * Minimal background worker.
 * Handles: message from content script to open the options page.
 */

'use strict';

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
  }
});
