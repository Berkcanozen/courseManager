/**
 * MEISNER STUDIO — config.gs
 * Apps Script constants — mirrors window.APP_CONSTANTS in config.js.
 * Update both files together when changing shared values.
 */

// Token
var TOKEN_TTL_MS    = 8 * 60 * 60 * 1000;  // 8 hours — must match APP_CONSTANTS.TOKEN_TTL_MS
var LOCK_TIMEOUT_MS = 10000;                 // 10 seconds — LockService wait time

// Login rate limiting (brute-force protection) — see Auth.gs
var LOGIN_MAX_ATTEMPTS = 5;                  // failures before lockout
var LOGIN_LOCKOUT_MS   = 15 * 60 * 1000;     // 15 min lockout once tripped
var LOGIN_WINDOW_MS    = 15 * 60 * 1000;     // failures counted within this rolling window

// Cache
var CACHE_KEY = 'allData';
var CACHE_TTL = 30;  // seconds — must match APP_CONSTANTS.CACHE_TTL_S
