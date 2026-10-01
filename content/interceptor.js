/**
 * content/interceptor.js
 *
 * Runs in the page's MAIN execution world at document_start.
 * Intercepts page network requests (window.fetch and XMLHttpRequest)
 * to capture responses from /api/settings and detect the Desku backend
 * server without making any extra network calls.
 */

'use strict';

(() => {
  if (window.__dcmInterceptorInstalled) return;
  window.__dcmInterceptorInstalled = true;

  const DESKU_TLDS = ['.desku.io', '.desku.dev', '.desku.local'];
  const STORAGE_KEY = '__dcm_backend';

  /**
   * Extract subdomain and tld from a hostname (e.g. "yourdomain.desku.io").
   * @param {string} hostname
   * @returns {{ subdomain: string, tld: string } | null}
   */
  function parseDesku(hostname) {
    if (!hostname) return null;
    for (const tld of DESKU_TLDS) {
      const suffix = tld.slice(1);
      if (hostname.endsWith('.' + suffix)) {
        const subdomain = hostname.slice(0, hostname.length - suffix.length - 1);
        if (subdomain) return { subdomain, tld };
      }
    }
    return null;
  }

  /**
   * Extract backend info from /api/settings response payload.
   * Looks for `imagePath` (e.g. "https://prince.desku.io/images/tenant/")
   * or direct host properties.
   * @param {any} data
   * @returns {{ subdomain: string, tld: string } | null}
   */
  function extractBackendFromSettings(data) {
    if (!data || typeof data !== 'object') return null;

    // Check imagePath field directly or inside a data/payload wrapper
    const logoUrl = data.imagePath || data.data?.imagePath || data.settings?.imagePath;
    if (typeof logoUrl === 'string') {
      try {
        const parsed = new URL(logoUrl);
        const result = parseDesku(parsed.hostname);
        if (result) return result;
      } catch {
        // In case logoUrl is a host string or malformed
        const match = logoUrl.match(/https?:\/\/([a-zA-Z0-9.-]+)/);
        if (match && match[1]) {
          const result = parseDesku(match[1]);
          if (result) return result;
        }
      }
    }

    // Fallback: check other potential url fields in settings payload
    for (const key of ['app_url', 'api_url', 'backend_url', 'domain', 'host']) {
      const val = data[key] || data.data?.[key];
      if (typeof val === 'string') {
        try {
          const host = val.includes('://') ? new URL(val).hostname : val;
          const result = parseDesku(host);
          if (result) return result;
        } catch { }
      }
    }

    return null;
  }

  /**
   * Broadcast detected backend to the extension's content script and session storage.
   * @param {{ subdomain: string, tld: string }} backend
   */
  function notifyBackendDetected(backend) {
    if (!backend || !backend.subdomain || !backend.tld) return;

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(backend));
    } catch { }

    window.__dcm_detected_backend = backend;

    // Dispatch DOM event & postMessage for isolated world content script
    try {
      window.dispatchEvent(
        new CustomEvent('dcm:backend_detected', { detail: backend })
      );
    } catch { }

    try {
      window.postMessage({ type: 'DCM_BACKEND_DETECTED', backend }, '*');
    } catch { }
  }

  /**
   * Check if a URL string corresponds to /api/settings.
   * @param {string} url
   * @returns {boolean}
   */
  function isSettingsUrl(url) {
    if (typeof url !== 'string') return false;
    return url.includes('/api/settings') || url.endsWith('/settings');
  }

  /**
   * Process raw text or JSON object from /api/settings response.
   * @param {string|object} raw
   */
  function processResponse(raw) {
    try {
      const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const backend = extractBackendFromSettings(json);
      if (backend) {
        notifyBackendDetected(backend);
      }
    } catch { }
  }

  // ─── 1. Intercept window.fetch ───────────────────────────────────────────────

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && input.url) ? input.url : '';
        if (isSettingsUrl(url)) {
          // Clone response so we don't consume the application's stream
          const clone = response.clone();
          clone.json().then(processResponse).catch(() => { });
        }
      } catch { }

      return response;
    };
  }

  // ─── 2. Intercept XMLHttpRequest ─────────────────────────────────────────────

  if (typeof window.XMLHttpRequest === 'function') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__dcmRequestUrl = typeof url === 'string' ? url : (url ? url.toString() : '');
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (this.__dcmRequestUrl && isSettingsUrl(this.__dcmRequestUrl)) {
        this.addEventListener('load', function () {
          try {
            if (this.responseText) {
              processResponse(this.responseText);
            }
          } catch { }
        });
      }
      return originalSend.apply(this, args);
    };
  }

  // ─── 3. Rich Text / TinyMCE Direct Bridge ───────────────────────────────────

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'DCM_FILL_EDITOR') {
      const { editorId, html, value } = event.data;
      const content = html || value || '';

      if (window.tinymce) {
        try {
          const ed = (editorId && window.tinymce.get(editorId)) || window.tinymce.activeEditor;
          if (ed) {
            ed.focus();
            ed.setContent(content);
            ed.fire('change');
            ed.fire('input');
            ed.save();
          }
        } catch (err) { }
      }
    }
  });

})();
