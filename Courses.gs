/**
 * MEISNER STUDIO — Courses.gs
 * v2.9.5 — writeAuditLog added after every write
 * v3.2.4 — course name written via asText()
 * v3.2.3 — addCourse: next id + appendRow under one lock
 */

function addCourse(ss, payload, currentUser, timestamp) {
  try {
    if (Number(payload.feeNormal) < 0 || Number(payload.feeEarly) < 0)
      return errorResponse('Course fees cannot be negative.');
    const sheet = ss.getSheetByName('Courses') || ss.insertSheet('Courses');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['id','name','startDate','endDate','feeNormal','feeEarly','deposit','capacity','status','createUser','createDate','updateUser','updateDate']);
    }
    const status = payload.status || '101';
    const newId  = withScriptLock(() => {
      const id = _getNextIdNoLock(sheet);
      sheet.appendRow([id, asText(payload.name), payload.startDate||'', payload.endDate||'',
        payload.feeNormal||0, payload.feeEarly||0, payload.deposit||0,
        payload.capacity||'', status, currentUser, timestamp, '', '']);
      return id;
    });
    invalidateCache();
    writeAuditLog('addCourse', newId, { name: payload.name }, currentUser);
    return successResponse({ id: newId });
  } catch (err) {
    return errorResponse('Add Course Error: ' + err.toString());
  }
}

function updateCourse(ss, payload, currentUser, timestamp) {
  try {
    if (Number(payload.feeNormal) < 0 || Number(payload.feeEarly) < 0)
      return errorResponse('Course fees cannot be negative.');
    const sheet = ss.getSheetByName('Courses');
    if (!sheet) throw new Error('Courses sheet not found!');
    const data = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == payload.id) {
        sheet.getRange(i + 1, 2, 1, 12).setValues([[
          asText(payload.name), payload.startDate, payload.endDate,
          payload.feeNormal, payload.feeEarly, payload.deposit||'',
          payload.capacity||'', payload.status,
          data[i][9]||'', data[i][10]||'', currentUser, timestamp
        ]]);
        found = true; break;
      }
    }
    if (!found) throw new Error('Course ID ' + payload.id + ' not found!');
    invalidateCache();
    writeAuditLog('updateCourse', payload.id, { name: payload.name }, currentUser);
    return successResponse();
  } catch (err) {
    return errorResponse('Update Course Error: ' + err.toString());
  }
}

function deleteCourse(ss, payload, currentUser, timestamp) {
  try {
    const result = deleteRowByIdGuarded("Courses", payload.id, function (s) {
      const enr = countRefs(s, "Enrollments", 2, payload.id); // col C = courseId
      const pay = countRefs(s, "Payments",    2, payload.id); // col C = courseId
      if (enr > 0) return "Cannot delete: this course has " + enr + " enrollment(s). Remove them first.";
      if (pay > 0) return "Cannot delete: this course has " + pay + " payment(s) recorded.";
      return null;
    });
    writeAuditLog("deleteCourse", payload.id, {}, currentUser);
    return successResponse(result);
  } catch (err) {
    return errorResponse(err.message || err.toString());
  }
}
