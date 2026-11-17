/**
 * MEISNER STUDIO — router.gs
 * v2.9.7 — delete actions routed to guarded entity fns (referential integrity);
 * v2.9.6 — getAll served via doPost too (token in body, not URL);
 *           delete operations also write to AuditLog
 * v3.2.3 — error responses carry err.message (no "Error: " prefix)
 */

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : null;
  const token  = e && e.parameter ? e.parameter.token  : null;

  if (action === 'ping') return successResponse({ status: 'ok' });

  if (action === 'getAll') {
    if (!isValidToken(token)) return errorResponse('Unauthorized');
    return successResponse(getAllData());
  }

  return errorResponse('Invalid action');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, payload, currentUser } = body;
    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');

    // Auth — no token needed
    if (action === 'checkLogin')  return handleLogin(ss, payload);
    if (action === 'verifyToken') return verifyToken(payload);

    // All other actions require a valid token
    if (!isValidToken(body.token)) return errorResponse('Unauthorized');

    // Data fetch (token already validated above). Moved here from doGet so the
    // token can travel in the POST body instead of the URL/query string.
    if (action === 'getAll') return successResponse(getAllData());

    if (action === 'addCourse')     return addCourse(ss, payload, currentUser, timestamp);
    if (action === 'updateCourse')  return updateCourse(ss, payload, currentUser, timestamp);
    if (action === 'deleteCourse')  return deleteCourse(ss, payload, currentUser, timestamp);

    if (action === 'addStudent')    return addStudent(ss, payload, currentUser, timestamp);
    if (action === 'updateStudent') return updateStudent(ss, payload, currentUser, timestamp);
    if (action === 'deleteStudent') return deleteStudent(ss, payload, currentUser, timestamp);

    if (action === 'enrollStudent')    return enrollStudent(ss, payload, currentUser, timestamp);
    if (action === 'updateEnrollment') return updateEnrollment(ss, payload, currentUser, timestamp);
    if (action === 'deleteEnrollment') return deleteEnrollment(ss, payload, currentUser, timestamp);

    if (action === 'addPayment')    return addPayment(ss, payload, currentUser, timestamp);
    if (action === 'deletePayment') {
      const result = deleteRowById('Payments', payload.id);
      writeAuditLog('deletePayment', payload.id, {}, currentUser);
      return successResponse(result);
    }

    return errorResponse('Unknown action');
  } catch (err) {
    // err.message, not err.toString(): toString() prefixes "Error: ", which
    // then showed up verbatim in the user-facing toast.
    return errorResponse(err.message || String(err));
  }
}
