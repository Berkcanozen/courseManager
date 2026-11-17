/**
 * MEISNER STUDIO — Students.gs
 * v2.9.2 — writeAuditLog added; duplicate email check on update (unchanged)
 */

function addStudent(ss, payload, currentUser, timestamp) {
  try {
    const sheet = ss.getSheetByName('Students') || ss.insertSheet('Students');
    const data  = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][2] === payload.email) throw new Error('A student with this email already exists!');
    }
    if (sheet.getLastRow() === 0) sheet.appendRow(['id','fullName','email','phone','createUser','createDate','updateUser','updateDate']);
    const newId = getNextId(sheet);
    sheet.appendRow([newId, payload.fullName, payload.email, payload.phone||'', currentUser, timestamp, '', '']);
    invalidateCache();
    writeAuditLog('addStudent', newId, { fullName: payload.fullName, email: payload.email }, currentUser);
    return successResponse({ id: newId });
  } catch (err) {
    return errorResponse('Add Student Error: ' + err.toString());
  }
}

function updateStudent(ss, payload, currentUser, timestamp) {
  try {
    const sheet = ss.getSheetByName('Students');
    if (!sheet) throw new Error('Students sheet not found.');
    const data = sheet.getDataRange().getValues();
    // Duplicate email check — skip current row
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] != payload.id && data[i][2] === payload.email)
        throw new Error('Another student with this email already exists!');
    }
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == payload.id) {
        sheet.getRange(i + 1, 2, 1, 7).setValues([[
          payload.fullName, payload.email, payload.phone||'',
          data[i][4]||'', data[i][5]||'', currentUser, timestamp
        ]]);
        found = true; break;
      }
    }
    if (!found) throw new Error('Student ID ' + payload.id + ' not found!');
    invalidateCache();
    writeAuditLog('updateStudent', payload.id, { fullName: payload.fullName, email: payload.email }, currentUser);
    return successResponse();
  } catch (err) {
    return errorResponse('Update Student Error: ' + err.toString());
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
