/**
 * MEISNER STUDIO — Cron.gs
 * v2.9.4
 *  - Duplicate send prevention: tracks sent reminders in PropertiesService
 *    keyed by "CRON_SENT_<date>_<enrollmentId>_<reason>"
 *  - Keys are auto-cleaned after 48 hours to avoid storage bloat
 *  - Full try/catch with CronLog sheet (unchanged from v2.8.0)
 */

function checkPaymentsAndNotify() {
  try {
    const ss               = SpreadsheetApp.getActiveSpreadsheet();
    const enrollmentsSheet = ss.getSheetByName('Enrollments');
    const studentsSheet    = ss.getSheetByName('Students');
    const adminsSheet      = ss.getSheetByName('Admins');

    if (!enrollmentsSheet || !studentsSheet || !adminsSheet) {
      _logCron('ERROR', 'Missing sheet(s): Enrollments, Students, or Admins not found.');
      return;
    }

    const adminData   = adminsSheet.getDataRange().getValues();
    const adminEmails = [];
    for (let i = 1; i < adminData.length; i++) {
      const email = adminData[i][0];
      if (email && String(email).includes('@')) adminEmails.push(String(email).trim());
    }
    if (adminEmails.length === 0) {
      _logCron('WARN', 'No admin email addresses found in Admins sheet.');
      return;
    }

    const enrollments = sheetToObjects(enrollmentsSheet);
    const students    = sheetToObjects(studentsSheet);
    const todayStr    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const todayMs     = new Date().setHours(0, 0, 0, 0);
    const dueLines    = [];

    // Clean up old sent keys (> 48h) before checking
    _cleanupSentKeys();

    enrollments.forEach(en => {
      let isDueToday   = false;
      let dueReason    = '';
      const keysToMark = []; // specific keys that, once notified, mark this reason sent

      if (en.depositDate && new Date(en.depositDate).setHours(0,0,0,0) === todayMs) {
        const key = _sentKey(todayStr, en.id, 'deposit');
        if (!_alreadySent(key)) {
          isDueToday = true;
          dueReason += 'Deposit (' + en.depositAmount + '€) ';
          keysToMark.push(key);
        }
      }

      if (en.paymentType === 'instalment' && en.instalmentPlan) {
        try {
          JSON.parse(en.instalmentPlan).forEach((inst, index) => {
            if (inst.date && new Date(inst.date).setHours(0,0,0,0) === todayMs) {
              const key = _sentKey(todayStr, en.id, 'inst_' + index);
              if (!_alreadySent(key)) {
                isDueToday = true;
                dueReason += '| Instalment ' + (index + 1) + ' (' + inst.amount + '€) ';
                keysToMark.push(key);
              }
            }
          });
        } catch (e) {
          _logCron('WARN', 'Could not parse instalmentPlan for enrollment id: ' + en.id);
        }
      }

      if (en.paymentType === 'full_remaining' && en.fullPayDate &&
          new Date(en.fullPayDate).setHours(0,0,0,0) === todayMs) {
        const key = _sentKey(todayStr, en.id, 'full');
        if (!_alreadySent(key)) {
          isDueToday = true;
          dueReason += 'Full payment (' + en.totalFee + '€) ';
          keysToMark.push(key);
        }
      }

      if (isDueToday) {
        const student = students.find(s => s.id == en.studentId);
        if (student) {
          dueLines.push(
            '👤 ' + student.fullName + '\n📧 ' + student.email +
            '\n📌 Due: ' + dueReason.trim() + '\n' + '—'.repeat(40)
          );
          // Mark each specific reason key as sent (matches the keys we checked)
          keysToMark.forEach(k => _markSentKey(k));
        }
      }
    });

    if (dueLines.length === 0) {
      _logCron('INFO', 'No new payment reminders to send today.');
      return;
    }

    const body =
      'Hello,\n\nThe following students have a payment due today:\n\n' +
      dueLines.join('\n') +
      '\n\nOpen the system: ' + ss.getUrl();

    try {
      MailApp.sendEmail({
        to:      adminEmails.join(','),
        subject: '⚠️ Meisner Studio: Payment Reminders for Today',
        body
      });
      _logCron('INFO', 'Reminder sent to ' + adminEmails.join(', ') + ' for ' + dueLines.length + ' student(s).');
    } catch (mailErr) {
      _logCron('ERROR', 'MailApp failed: ' + mailErr.toString());
    }

  } catch (err) {
    _logCron('ERROR', 'checkPaymentsAndNotify crashed: ' + err.toString());
  }
}

/* ── Duplicate prevention helpers ── */

function _sentKey(dateStr, enrollmentId, reason) {
  return 'CRON_SENT_' + dateStr + '_' + enrollmentId + '_' + reason;
}

function _alreadySent(key) {
  return !!PropertiesService.getScriptProperties().getProperty(key);
}

function _markSentKey(key) {
  PropertiesService.getScriptProperties().setProperty(key, String(Date.now()));
}

/**
 * Removes CRON_SENT_* keys older than 48 hours.
 * Prevents PropertiesService from filling up over time.
 */
function _cleanupSentKeys() {
  try {
    const props   = PropertiesService.getScriptProperties();
    const all     = props.getProperties();
    const cutoff  = Date.now() - (48 * 60 * 60 * 1000);
    const toDelete = [];
    for (const key in all) {
      if (!key.startsWith('CRON_SENT_')) continue;
      const ts = parseInt(all[key]);
      if (!isNaN(ts) && ts < cutoff) toDelete.push(key);
    }
    toDelete.forEach(k => props.deleteProperty(k));
    if (toDelete.length > 0) _logCron('INFO', 'Cleaned up ' + toDelete.length + ' old sent keys.');
  } catch (e) {
    console.error('_cleanupSentKeys failed:', e);
  }
}

/* ── CronLog helper ── */

function _logCron(level, message) {
  try {
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet  = ss.getSheetByName('CronLog');
    if (!logSheet) {
      logSheet = ss.insertSheet('CronLog');
      logSheet.appendRow(['timestamp', 'level', 'message']);
    }
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
    logSheet.appendRow([ts, level, message]);
  } catch (e) {
    console.error('_logCron failed:', e);
  }
}
