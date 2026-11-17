/**
 * MEISNER STUDIO — Students.gs
 * v2.9.2 — writeAuditLog added; duplicate email check on update (unchanged)
 * v3.2.5 — email format validated on add + update
 * v3.2.4 — free-text fields written via asText()
 * v3.2.3 — email duplicate check is case/whitespace-insensitive; add is atomic;
 *          error messages returned without "Error:" prefix
 */

function addStudent(ss, payload, currentUser, timestamp) {
  try {
    const sheet = ss.getSheetByName('Students') || ss.insertSheet('Students');
    const email = String(payload.email || '').trim();
    if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
    // Duplicate check + insert under one lock so two requests can't both pass the check.
    const newId = withScriptLock(() => {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (normEmail(data[i][2]) === normEmail(email)) throw new Error('A student with this email already exists!');
      }
      if (sheet.getLastRow() === 0) sheet.appendRow(['id','fullName','email','phone','createUser','createDate','updateUser','updateDate']);
      const id = _getNextIdNoLock(sheet);
      sheet.appendRow([id, asText(payload.fullName), asText(email), asText(payload.phone), currentUser, timestamp, '', '']);
      return id;
    });
    invalidateCache();
    writeAuditLog('addStudent', newId, { fullName: payload.fullName, email: email }, currentUser);
    return successResponse({ id: newId });
  } catch (err) {
    return errorResponse(err.message || err.toString());
  }
}

function updateStudent(ss, payload, currentUser, timestamp) {
  try {
    const sheet = ss.getSheetByName('Students');
    if (!sheet) throw new Error('Students sheet not found.');
    const email = String(payload.email || '').trim();
    if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
    const data = sheet.getDataRange().getValues();
    // Duplicate email check — skip current row (case/whitespace-insensitive)
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] != payload.id && normEmail(data[i][2]) === normEmail(email))
        throw new Error('Another student with this email already exists!');
    }
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == payload.id) {
        sheet.getRange(i + 1, 2, 1, 7).setValues([[
          asText(payload.fullName), asText(email), asText(payload.phone),
          data[i][4]||'', data[i][5]||'', currentUser, timestamp
        ]]);
        found = true; break;
      }
    }
    if (!found) throw new Error('Student ID ' + payload.id + ' not found!');
    invalidateCache();
    writeAuditLog('updateStudent', payload.id, { fullName: payload.fullName, email: email }, currentUser);
    return successResponse();
  } catch (err) {
    return errorResponse(err.message || err.toString());
  }
}

function deleteStudent(ss, payload, currentUser, timestamp) {
  try {
    const result = deleteRowByIdGuarded("Students", payload.id, function (s) {
      const enr = countRefs(s, "Enrollments", 1, payload.id); // col B = studentId
      const pay = countRefs(s, "Payments",    1, payload.id); // col B = studentId
      if (enr > 0) return "Cannot delete: this student has " + enr + " enrollment(s). Delete those first.";
      if (pay > 0) return "Cannot delete: this student has " + pay + " payment(s) recorded.";
      return null;
    });
    writeAuditLog("deleteStudent", payload.id, {}, currentUser);
    return successResponse(result);
  } catch (err) {
    return errorResponse(err.message || err.toString());
  }
}
