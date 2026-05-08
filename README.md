# Meisner Studio Amsterdam — Course Management System

A lightweight, serverless web application for managing acting courses, student enrollments, and payment tracking. Built with vanilla HTML/CSS/JS on the frontend and Google Apps Script + Google Sheets as the backend database.

---

## Features

- **Course management** — Create and edit courses with normal and early bird pricing, capacity limits, and status tracking
- **Student database** — Add and manage student profiles (name, email, phone)
- **Enrollments** — Enroll existing or new students into courses, choose price tier, set deposit and payment plan (full or instalment)
- **Payment tracking** — Record payments per enrollment, smart suggestion shows the next expected amount, delete payments
- **Dashboard** — Live overview of collection progress per course
- **Daily reminders** — Automated cron job emails admins about payments due today
- **Secure login** — Token-based session authentication, "Remember me" option
- **Mobile friendly** — Responsive layout, bottom sheet modals, scrollable tabs on small screens

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript (no framework) |
| Backend | Google Apps Script (Web App) |
| Database | Google Sheets |
| Hosting | GitHub Pages |
| Email | MailApp (Google Apps Script) |

---

## Project Structure

```
├── index.html          # App shell, all modals
├── style.css           # Styles + responsive breakpoints
├── app.js              # All frontend logic
│
├── router.gs           # doGet / doPost — request routing
├── Auth.gs             # Login, token generation & verification
├── utils.gs            # Shared helpers, cache, delete with lock
├── Courses.gs          # Course CRUD
├── Students.gs         # Student CRUD
├── Enrollments.gs      # Enrollment CRUD
├── Payments.gs         # Payment CRUD
└── Cron.gs             # Daily payment reminder email
```

---

## Google Sheets Structure

The app expects the following sheets inside one Google Spreadsheet:

| Sheet | Key columns |
|---|---|
| `Courses` | id, name, startDate, endDate, feeNormal, feeEarly, deposit, capacity, status |
| `Students` | id, fullName, email, phone |
| `Enrollments` | id, studentId, courseId, priceType, totalFee, depositAmount, depositDate, paymentType, fullPayDate, instalmentPlan |
| `Payments` | id, studentId, courseId, amount, date, type, note |
| `Admins` | email, username, password |
| `GeneralStatus` | id, name, code, entity |
| `CronLog` | timestamp, level, message *(auto-created)* |

> **Note:** Column order matters. Do not reorder columns in existing sheets.

---

## Setup

### 1. Google Sheets

1. Create a new Google Spreadsheet
2. Create the sheets listed above with the correct column headers
3. Add at least one row to `Admins` (email, username, password)
4. Add at least one row to `GeneralStatus` — example:

   | id | name | code | entity |
   |---|---|---|---|
   | 101 | Active | active | course |
   | 102 | Completed | completed | course |
   | 103 | Draft | draft | course |
   | 104 | Cancelled | cancelled | course |

### 2. Google Apps Script

1. Inside the spreadsheet, go to **Extensions → Apps Script**
2. Create the following files and paste the corresponding `.gs` code from this repo:
   - `router.gs`
   - `Auth.gs`
   - `utils.gs`
   - `Courses.gs`
   - `Students.gs`
   - `Enrollments.gs`
   - `Payments.gs`
   - `Cron.gs`
3. Go to **Deploy → New deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy** and copy the Web App URL

### 3. Daily Reminder Cron

1. In Apps Script, go to **Triggers** (clock icon on the left sidebar)
2. Add a new trigger:
   - Function: `checkPaymentsAndNotify`
   - Event source: **Time-driven**
   - Type: **Day timer**
   - Time: choose your preferred time (e.g. 08:00–09:00)

### 4. Frontend

1. Clone this repository
2. Open `app.js` and replace the URL at the top:

```js
const cfg = {
  url: 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE',
  currency: '€'
};
```

3. Commit and push — GitHub Pages will serve the app automatically

---

## Security

- The Apps Script URL is intentionally kept in `app.js`. Since the app is hosted on GitHub Pages, there is no server-side environment for secrets.
- **The URL alone cannot access data.** Every request except `ping` requires a valid session token that is issued by the backend after login and stored server-side in `PropertiesService`.
- Tokens expire after **8 hours**.
- Old tokens are automatically cleaned up on each new login.
- Passwords are stored as plaintext in the `Admins` sheet — consider restricting Sheets access to trusted Google accounts only.

> If you rotate your Apps Script deployment (to get a new URL), update `cfg.url` in `app.js` and redeploy to GitHub Pages.

---

## Local Development

No build tools needed. Open `index.html` directly in a browser:

```bash
# Option 1 — open directly
open index.html

# Option 2 — serve locally
npx serve .
# or
python3 -m http.server 8080
```

The app will connect to the live Apps Script backend as long as `cfg.url` is set.

---

## Changelog

| Version | Highlights |
|---|---|
| v2.8.1 | Enrollment detail delete button, "Edit Plan" → "Edit", 6 bug fixes |
| v2.8.0 | Mobile responsive, debounce search, formatDate timezone fix, CacheService, LockService, token cleanup, duplicate email guard, `updateEnrollment` totalFee fix, Cron logging |
| v2.7.0 | Single overlay modal system (Opera fix), delete payment, student detail on click |
| v2.6.0 | Token-based auth, `verifyToken`, `deleteRecord` await fix, `c-deposit` bug fix, `parseFee` helper, null guards |
| v2.5.0 | Add/delete for courses, students, enrollments; smart payment suggestion |

---

## License & Copyright

© 2026 Meisner Studio Amsterdam. All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use of this software, in whole or in part, is strictly
prohibited without prior written permission from Meisner Studio Amsterdam.
