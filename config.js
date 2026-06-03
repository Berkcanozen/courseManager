/**
 * MEISNER STUDIO — config.js
 * Single source of truth for app configuration.
 * All magic numbers, version, and environment settings live here.
 *
 * !! REPLACE url WITH YOUR GOOGLE APPS SCRIPT WEB APP URL !!
 */
window.APP_VERSION = '3.1.0';

window.APP_CONFIG = {
  url:      'https://script.google.com/macros/s/AKfycby-2trfd2qPNyzy68-SW1iSNbnYfnwJkFDLe6q49tfGlBIyAXMUme1weoC-fiPKRB33NQ/exec',
  currency: '€',           // Change to '$', '£', etc. if needed
  locale:   'en-US',        // Used for number formatting
  timezone: 'Europe/Amsterdam'
};

window.APP_CONSTANTS = {
  TOKEN_TTL_MS:       8 * 60 * 60 * 1000,  // 8 hours
  PING_TIMEOUT_MS:    5000,                  // 5 seconds
  SEARCH_DEBOUNCE_MS: 200,                   // 200ms
  TOAST_DURATION_MS:  3500,                  // 3.5 seconds
  // These must match Apps Script config.gs values:
  CACHE_TTL_S:        30,                    // seconds (Apps Script CacheService)
  LOCK_TIMEOUT_MS:    10000                  // 10 seconds (Apps Script LockService)
};
