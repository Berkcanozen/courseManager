/**
 * MEISNER STUDIO — Enrollments.gs
 * v2.9.5
 *  - FIX: All validation (duplicate + capacity) now runs BEFORE creating a new
 *    student, preventing orphan student records when enrollment fails.
 *  - enrollStudent: capacity check
 *  - writeAuditLog on both functions
 *  - totalFee and fullPayDate persisted
 */

function enrollStudent(ss, payload, currentUser, timestamp) {
  // Wrap the whole enrollment in a lock so capacity check + write are atomic.
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    return _enrollStudentLocked(ss, payload, currentUser, timestamp);
  } finally {
    lock.releaseLock();
  }
}

function _enrollStudentLocked(ss, payload, currentUser, timestamp) {
  // Negative fee guard
  if (Number(payload.totalFee) < 0)
    throw new Error('Total fee cannot be negative.');
  if (payload.depositAmount && Number(payload.depositAmount) < 0)
    throw new Error('Deposit cannot be negative.');

  const sSheet = ss.getSheetByName('Students')    || ss.insertSheet('Students');
  const eSheet = ss.getSheetByName('Enrollments') || ss.insertSheet('Enrollments');

  // ─── VALIDATE FIRST (before any writes) ───

  // 1. If new student, check email isn't already taken
  if (payload.isNew) {
    const sData = sSheet.getDataRange().getValues();
    for (let i = 1; i < sData.length; i++) {
      if (sData[i][2] === payload.studentData.email)
        throw new Error('A student with this email already exists!');
    }
  }

  // 2. Duplicate enrollment check (only meaningful for existing students;
  //    new students can't already be enrolled)
  if (!payload.isNew && eSheet.getLastRow() > 0) {
    const eData = eSheet.getDataRange().getValues();
    for (let i = 1; i < eData.length; i++) {
      if (eData[i][1] == payload.studentId && eData[i][2] == payload.courseId)
        throw new Error('Student already enrolled in this course!');
    }
  }

  // 3. Capacity check
  const cSheet = ss.getSheetByName('Courses');
  if (cSheet) {
    const cData = cSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (cData[i][0] == payload.courseId) {
        const capacity = parseInt(cData[i][7]); // column H = capacity
        if (capacity > 0) {
          const enrolled = eSheet.getLastRow() > 1
            ? eSheet.getDataRange().getValues().slice(1).filter(r => r[2] == payload.courseId).length
            : 0;
          if (enrolled >= capacity)
            throw new Error('This course is full (' + capacity + '/' + capacity + ' students enrolled).');
        }
        break;
      }
    }
  }

  // ─── ALL CHECKS PASSED — now perform writes ───

  let finalStudentId = payload.studentId;
  if (payload.isNew) {
    if (sSheet.getLastRow() === 0)
      sSheet.appendRow(['id','fullName','email','phone','createUser','createDate','updateUser','updateDate']);
    finalStudentId = _getNextIdNoLock(sSheet);
    sSheet.appendRow([finalStudentId, payload.studentData.fullName, payload.studentData.email,
      payload.studentData.phone||'', currentUser, timestamp, '', '']);
    writeAuditLog('addStudent', finalStudentId, {
      fullName: payload.studentData.fullName, email: payload.studentData.email, via: 'enrollment'
    }, currentUser);
  }

  if (eSheet.getLastRow() === 0)
    eSheet.appendRow(['id','studentId','courseId','priceType','totalFee','depositAmount','depositDate',
      'paymentType','fullPayDate','instalmentPlan','createUser','createDate','updateUser','updateDate']);
  const newEnrolId = _getNextIdNoLock(eSheet);
  eSheet.appendRow([newEnrolId, finalStudentId, payload.courseId, payload.priceType,
    payload.totalFee, payload.depositAmount, payload.depositDate,
    payload.paymentType, payload.fullPayDate||'', payload.instalmentPlan,
    currentUser, timestamp, '', '']);

  invalidateCache();
  writeAuditLog('enrollStudent', newEnrolId, {
    studentId: finalStudentId, courseId: payload.courseId,
    priceType: payload.priceType, totalFee: payload.totalFee
  }, currentUser);
  return successResponse();
}

function updateEnrollment(ss, payload, currentUser, timestamp) {
  try {
    const sheet = ss.getSheetByName('Enrollments');
    if (!sheet) throw new Error('Enrollments sheet not found.');
    const data = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == payload.enrollmentId) {
        // Columns: 4=priceType, 5=totalFee, 6=depositAmount, 7=depositDate,
        // 8=paymentType, 9=fullPayDate, 10=instalmentPlan,
        // 11=createUser, 12=createDate, 13=updateUser, 14=updateDate
        sheet.getRange(i + 1, 4, 1, 11).setValues([[
          payload.priceType, payload.totalFee,
          payload.depositAmount||'', payload.depositDate||'',
          payload.paymentType, payload.fullPayDate||'',
          payload.instalmentPlan||'[]',
          data[i][10]||'', data[i][11]||'', currentUser, timestamp
        ]]);
        found = true; break;
      }
    }
    if (!found) throw new Error('Enrollment ID ' + payload.enrollmentId + ' not found!');
    invalidateCache();
    writeAuditLog('updateEnrollment', payload.enrollmentId, {
      priceType: payload.priceType, totalFee: payload.totalFee
    }, currentUser);
    return successResponse();
  } catch (err) {
    return errorResponse('Update Enrollment Error: ' + err.toString());
  }
}

function deleteEnrollment(ss, payload, currentUser, timestamp) {
  try {
    const result = deleteRowByIdGuarded("Enrollments", payload.id, function (s) {
      const eSheet = s.getSheetByName("Enrollments");
      if (!eSheet || eSheet.getLastRow() < 2) return null;
      const eData = eSheet.getDataRange().getValues();
      let sid = null, cid = null;
      for (let i = 1; i < eData.length; i++) {
        if (eData[i][0] == payload.id) { sid = eData[i][1]; cid = eData[i][2]; break; }
      }
      if (sid === null) return null; // not found — let the delete loop report it
      const pSheet = s.getSheetByName("Payments");
      if (!pSheet || pSheet.getLastRow() < 2) return null;
      const pData = pSheet.getDataRange().getValues();
      let n = 0;
      for (let i = 1; i < pData.length; i++) {
        if (pData[i][1] == sid && pData[i][2] == cid) n++;
      }
      return n > 0 ? ("Cannot delete: " + n + " payment(s) recorded for this enrollment.") : null;
    });
    writeAuditLog("deleteEnrollment", payload.id, {}, currentUser);
    return successResponse(result);
  } catch (err) {
    return errorResponse(err.message || err.toString());
  }
}
