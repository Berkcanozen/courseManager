/**
 * MEISNER STUDIO — Auth.gs
 * v2.8.0
 *  - handleLogin: cleans up expired tokens before issuing a new one
 *  - isValidToken: unchanged
 *  - verifyToken: unchanged
 *  - handleLogin: brute-force gate (lockout after repeated failures)
 */

function handleLogin(ss, payload) {
  const sheet = ss.getSheetByName('Admins');
  if (!sheet) return errorResponse('Admins sheet not found.');

  const username = String((payload && payload.username) || '').trim();

  // Brute-force gate: refuse before touching credentials if locked out.
  const gate = _loginGateCheck(username);
  if (gate.locked) {
    return errorResponse('Too many failed attempts. Try again in ' + gate.minutes + ' minute(s).');
  }

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == payload.username && data[i][2] == payload.password) {
      _loginGateReset(username);              // success — clear failure record
      _cleanupTokens(payload.username);       // clean up old tokens for this user
      const token = _generateToken(payload.username);
      _storeToken(payload.username, token);
      return successResponse({ token });
    }
  }

  _loginGateFail(username);                   // record the failed attempt
  return ContentService
    .createTextOutput(JSON.stringify({ success: false }))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyToken(payload) {
  if (!payload || !payload.token) return ContentService
    .createTextOutput(JSON.stringify({ success: false }))
    .setMimeType(ContentService.MimeType.JSON);
  return ContentService
    .createTextOutput(JSON.stringify({ success: isValidToken(payload.token) }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Returns true if the token exists in PropertiesService and was issued
 * within the last 8 hours.
 */
function isValidToken(token) {
  if (!token) return false;
  try {
    const stored = PropertiesService.getScriptProperties().getProperty('TOKEN_' + token);
    if (!stored) return false;
    const issuedAt   = parseInt(stored.split('|')[1]);
    const eightHours = TOKEN_TTL_MS; // defined in config.gs
    return (Date.now() - issuedAt) < eightHours;
  } catch (e) {
    return false;
  }
}

function _generateToken(username) {
  return Utilities.base64Encode(
    username + '|' + Date.now() + '|' + Math.random().toString(36).slice(2)
  );
}

function _storeToken(username, token) {
  PropertiesService.getScriptProperties()
    .setProperty('TOKEN_' + token, username + '|' + Date.now());
}

/**
 * Removes all stored tokens that belong to the given username
 * OR have expired (older than 8 hours). Keeps PropertiesService clean.
 */
function _cleanupTokens(username) {
  const props      = PropertiesService.getScriptProperties();
  const all        = props.getProperties();
  const eightHours = TOKEN_TTL_MS; // defined in config.gs

  // Delete ONLY token keys individually — never touch CRON_SENT_* or other keys.
  // (deleteAllProperties would wipe cron duplicate-prevention state too.)
  for (const key in all) {
    if (!key.startsWith('TOKEN_')) continue;
    const parts    = all[key].split('|');
    const owner    = parts[0];
    const issuedAt = parseInt(parts[1]);
    if (owner === username || (Date.now() - issuedAt) >= eightHours) {
      props.deleteProperty(key);
    }
  }
}


/* ── Login brute-force gate (constants in config.gs) ──
 * State lives in PropertiesService under LOGIN_GATE_<username>. After
 * LOGIN_MAX_ATTEMPTS failures within LOGIN_WINDOW_MS, the account is locked
 * for LOGIN_LOCKOUT_MS. A successful login clears the record. Never throws.
 */
function _loginGateKey(username) { return "LOGIN_GATE_" + String(username).toLowerCase(); }

function _loginGateCheck(username) {
  if (!username) return { locked: false };
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(_loginGateKey(username));
    if (!raw) return { locked: false };
    const rec = JSON.parse(raw);
    if (rec.lockUntil && Date.now() < rec.lockUntil) {
      return { locked: true, minutes: Math.ceil((rec.lockUntil - Date.now()) / 60000) };
    }
    return { locked: false };
  } catch (e) { return { locked: false }; }
}

function _loginGateFail(username) {
  if (!username) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const key   = _loginGateKey(username);
    const now   = Date.now();
    let rec;
    try { rec = JSON.parse(props.getProperty(key) || "{}"); } catch (e) { rec = {}; }
    if (!rec.firstMs || (now - rec.firstMs) > LOGIN_WINDOW_MS) rec = { firstMs: now, count: 0 };
    rec.count = (rec.count || 0) + 1;
    if (rec.count >= LOGIN_MAX_ATTEMPTS) {
      rec.lockUntil = now + LOGIN_LOCKOUT_MS;
      rec.count = 0;
      rec.firstMs = now;
    }
    props.setProperty(key, JSON.stringify(rec));
  } catch (e) { console.error("_loginGateFail failed:", e); }
}

function _loginGateReset(username) {
  if (!username) return;
  try { PropertiesService.getScriptProperties().deleteProperty(_loginGateKey(username)); } catch (e) {}
}
