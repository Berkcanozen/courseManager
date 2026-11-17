/**
 * MEISNER STUDIO — utils.gs
 * v2.9.5
 *  - getNextId: LockService protection against race conditions on add operations
 *  - writeAuditLog: shared helper used by all CRUD operations
 *  - deleteRowById: LockService (unchanged)
 *  - getAllData: CacheService (unchanged)
 *  - sheetToObjects: dates now formatted in script timezone (was 'GMT')
 *  - deleteRowByIdGuarded + countRefs: atomic check-and-delete (referential integrity)
 */

// CACHE_KEY, CACHE_TTL, LOCK_TIMEOUT_MS defined in config.gs

function successResponse(data) {
  const response = data || {};
  response.success = true;
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(errorMsg) {
  return ContentService.createTextOutput(JSON.stringify({ success: false, error: errorMsg })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Returns the next available numeric ID for a sheet.
 * Protected with LockService so concurrent add calls cannot get the same ID.
 */
function getNextId(sheet) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    return _getNextIdNoLock(sheet);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Lock-free ID generation — call ONLY when the caller already holds the script lock
 * (e.g. enrollStudent wraps its whole flow in a lock).
 */
function _getNextIdNoLock(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1001;
  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let maxId = 1000;
  for (let i = 0; i < data.length; i++) {
    const idNum = parseInt(data[i][0]);
    if (!isNaN(idNum) && idNum > maxId) maxId = idNum;
  }
  return maxId + 1;
}

/**
 * Writes a row to the AuditLog sheet.
 * Called by every add / update / delete operation.
 * Never throws — audit failure must not crash the main operation.
 *
 * @param {string} action   - e.g. 'addCourse', 'deleteStudent', 'updateEnrollment'
 * @param {string} entityId - the id of the affected record
 * @param {object} detail   - key facts about the record (name, email, amount etc.)
 * @param {string} user     - username from the session
 */
function writeAuditLog(action, entityId, detail, user) {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    let   log = ss.getSheetByName('AuditLog');
    if (!log) {
      log = ss.insertSheet('AuditLog');
      log.appendRow(['timestamp', 'user', 'action', 'entityId', 'detail']);
      log.setFrozenRows(1);
    }
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
    log.appendRow([ts, user || '—', action, String(entityId || '—'), JSON.stringify(detail || {})]);
  } catch (e) {
    console.error('writeAuditLog failed:', e);
  }
}

/**
 * Returns all data with CacheService (30s TTL).
 * Cache is invalidated after any write via invalidateCache().
 */
function getAllData() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const data = {
    courses:       sheetToObjects(ss.getSheetByName('Courses')),
    students:      sheetToObjects(ss.getSheetByName('Students')),
    enrollments:   sheetToObjects(ss.getSheetByName('Enrollments')),
    payments:      sheetToObjects(ss.getSheetByName('Payments')),
    generalStatus: sheetToObjects(ss.getSheetByName('GeneralStatus'))
  };
  try { cache.put(CACHE_KEY, JSON.stringify(data), CACHE_TTL); } catch (e) {}
  return data;
}

function invalidateCache() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

function sheetToObjects(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      if (Object.prototype.toString.call(val) === '[object Date]') {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      obj[h] = val;
    });
    return obj;
  });
}

function deleteRowById(sheetName, id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error('Sheet not found: ' + sheetName);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        sheet.deleteRow(i + 1);
        invalidateCache();
        return { deletedId: id };
      }
    }
    throw new Error('Record not found: ' + id);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Counts rows in `sheetName` where 0-based column `col` equals `value`.
 * Used by the guarded delete helpers to detect dependent records.
 */
function countRefs(ss, sheetName, col, value) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const data = sheet.getDataRange().getValues();
  let n = 0;
  for (let i = 1; i < data.length; i++) if (data[i][col] == value) n++;
  return n;
}

/**
 * Deletes a row by id inside ONE script lock, after running a dependency
 * check. This makes the check + delete atomic, closing the window where a
 * dependent record could be added between a separate check and the delete.
 *
 * @param {string} sheetName       sheet to delete from
 * @param {string|number} id       id (column A) to delete
 * @param {function(Spreadsheet):(string|null)} checkBlocked
 *        runs inside the lock; return a non-empty message to BLOCK the delete,
 *        or null/empty to allow it.
 * @returns {{deletedId}}  or throws Error(message) when blocked / not found.
 */
function deleteRowByIdGuarded(sheetName, id, checkBlocked) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (typeof checkBlocked === "function") {
      const blockMsg = checkBlocked(ss);
      if (blockMsg) throw new Error(blockMsg);
    }
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Sheet not found: " + sheetName);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        sheet.deleteRow(i + 1);
        invalidateCache();
        return { deletedId: id };
      }
    }
    throw new Error("Record not found: " + id);
  } finally {
    lock.releaseLock();
  }
}
