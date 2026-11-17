/**
 * MEISNER STUDIO — Payments.gs
 * v2.9.5 — negative amount validation
 */

function addPayment(ss, payload, currentUser, timestamp) {
  const amount = Number(payload.amount);
  if (isNaN(amount) || amount <= 0)
    return errorResponse('Payment amount must be a positive number.');

  const sheet = ss.getSheetByName('Payments') || ss.insertSheet('Payments');
  if (sheet.getLastRow() === 0)
    sheet.appendRow(['id','studentId','courseId','amount','date','type','note','createUser','createDate']);
  const newPayId = getNextId(sheet);
  sheet.appendRow([newPayId, payload.studentId, payload.courseId, amount,
    payload.date, payload.type, payload.note||'', currentUser, timestamp]);
  invalidateCache();
  writeAuditLog('addPayment', newPayId, {
    studentId: payload.studentId, courseId: payload.courseId,
    amount: amount, type: payload.type
  }, currentUser);
  return successResponse();
}
