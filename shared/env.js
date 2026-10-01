/**
 * shared/env.js
 *
 * Environment / backend detection for the DCM extension.
 *
 * Responsibilities:
 *  1. Classify the current page URL into one of the known Desku environments.
 *  2. For localhost / shared-local URLs: passively intercept /api/settings response
 *     data captured by content/interceptor.js in the page context.
 *  3. NO active/duplicate network requests are made by the extension.
 *  4. Provide event subscription for asynchronous backend detection.
 *
 * Public API:
 *  detectBackend(href?) → Promise<{ subdomain: string, tld: DeskuTld } | null>
 *  onBackendDetected(callback) → () => void (unsubscribe)
 *  filterSetsByBackend(sets, backend) → CredentialSet[]
 *
 * @typedef {'.desku.io'|'.desku.dev'|'.desku.local'} DeskuTld
 * @typedef {{ subdomain: string, tld: DeskuTld }} BackendInfo
 */

'use strict';

(() => {

  const DESKU_TLDS = ['.desku.io', '.desku.dev', '.desku.local'];
  const STORAGE_KEY = '__dcm_backend';

  /** @type {BackendInfo | null} */
  let _detectedBackend = null;

  /** @type {Set<(backend: BackendInfo) => void>} */
  const _listeners = new Set();

  /**
   * Try to extract subdomain + tld from a hostname like "yourdomain.desku.io".
   * @param {string} hostname
   * @returns {BackendInfo | null}
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
   * Returns true if the hostname is localhost or a local/private network IP.
   * @param {string} hostname
   * @returns {boolean}
   */
  function isLocal(hostname) {
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      /^192\.168\.\d+\.\d+$/.test(hostname) ||
      /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)
    );
  }

  /**
   * Read stored backend from sessionStorage if available.
   * @returns {BackendInfo | null}
   */
  function getStoredBackend() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.subdomain && parsed?.tld) {
          return parsed;
        }
      }
    } catch { }
    return null;
  }

  /**
   * Broadcast detected backend to all active listeners.
   * @param {BackendInfo} backend
   */
  function handleBackendDetected(backend) {
    if (!backend || !backend.subdomain || !backend.tld) return;
    _detectedBackend = backend;
    for (const cb of _listeners) {
      try {
        cb(backend);
      } catch { }
    }
  }

  // ─── Listen for intercepted backend from interceptor.js ───────────────────

  // 1. window.addEventListener('message') from main world postMessage
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'DCM_BACKEND_DETECTED' && event.data.backend) {
      handleBackendDetected(event.data.backend);
    }
  });

  // 2. CustomEvent on window
  window.addEventListener('dcm:backend_detected', (event) => {
    if (event.detail) {
      handleBackendDetected(event.detail);
    }
  });

  // Check initial sessionStorage on script load
  const initial = getStoredBackend();
  if (initial) {
    _detectedBackend = initial;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Detect the Desku backend for the current (or given) page URL.
   * For direct Desku domains: returns immediately.
   * For local hosts: returns stored intercepted backend, or waits for interceptor with a timeout.
   *
   * @param {string} [href]
   * @returns {Promise<BackendInfo | null>}
   */
  async function detectBackend(href) {
    const url = new URL(href || window.location.href);
    const { hostname } = url;

    // 1. Direct Desku domain — no network interception needed
    const direct = parseDesku(hostname);
    if (direct) {
      _detectedBackend = direct;
      return direct;
    }

    // 2. Non-local and non-Desku domain
    if (!isLocal(hostname)) {
      return null;
    }

    // 3. Localhost / shared-local: check in-memory or sessionStorage
    if (_detectedBackend) {
      return _detectedBackend;
    }

    const stored = getStoredBackend();
    if (stored) {
      _detectedBackend = stored;
      return stored;
    }

    // Wait up to 1500ms for the page's own /api/settings network call to complete
    return new Promise((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(_detectedBackend || null);
        }
      }, 1500);

      const unsubscribe = onBackendDetected((backend) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve(backend);
        }
      });

      function cleanup() {
        unsubscribe();
      }
    });
  }

  /**
   * Subscribe to backend detection events (fires whenever /api/settings is intercepted).
   * @param {(backend: BackendInfo) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  function onBackendDetected(callback) {
    _listeners.add(callback);
    if (_detectedBackend) {
      try {
        callback(_detectedBackend);
      } catch { }
    }
    return () => _listeners.delete(callback);
  }

  /**
   * Filter a credential-sets array down to those matching the detected backend.
   * If backend is null, returns all sets.
   *
   * @param {any[]} sets
   * @param {BackendInfo | null} backend
   * @returns {any[]}
   */
  function filterSetsByBackend(sets, backend) {
    if (!backend) return sets;
    return sets.filter(
      (s) => s.tld === backend.tld && s.subdomain === backend.subdomain
    );
  }

  window.__dcmEnv = {
    detectBackend,
    onBackendDetected,
    filterSetsByBackend,
    getStoredBackend,
  };

})();
