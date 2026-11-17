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
├── calc.js             # Pure money/date math (unit-tested)
├── config.js           # Frontend config + version
│
├── config.gs           # Backend constants (token TTL, lock, cache, login gate)
├── router.gs           # doGet / doPost — request routing
├── Auth.gs             # Login, token generation & verification
├── utils.gs            # Shared helpers, cache, delete with lock
├── Courses.gs          # Course CRUD
├── Students.gs         # Student CRUD
├── Enrollments.gs      # Enrollment CRUD
├── Payments.gs         # Payment CRUD
├── Cron.gs             # Daily payment reminder email
│
└── tests/
    ├── calc.test.js    # Money math
    ├── gas-mock.js     # Mocked Google services + Sheets value coercion
    ├── backend.test.js # *.gs under Node with mocked Google services
    ├── e2e.js          # Full UI flows in headless Chromium
    └── e2e-edge.js     # Edge cases: UI + real *.gs backend together
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
   - `config.gs`
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
2. Open `config.js` and replace the URL and currency:

```js
window.APP_CONFIG = {
  url:      'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE',
  currency: '€',
  locale:   'en-US',
  timezone: 'Europe/Amsterdam'
};
```

3. Commit and push — GitHub Pages will serve the app automatically

---

### Apps Script Versioning & Deployment FAQ

**Q: I deployed a new version — does the old URL still work?**
Yes, the old URL keeps working until you explicitly archive it. Go to **Deploy → Manage Deployments**, find the old deployment, and click **Archive**.

**Q: When should I create a new deployment vs edit the existing one?**
- **Edit existing** (same URL): for backend logic changes that don't break the API — fixing bugs, adding logs, updating email text.
- **New deployment** (new URL): when adding new actions, changing auth flow, or making breaking changes. Update `config.js` with the new URL and commit.

**Q: How do I roll back a bad deploy?**
In Apps Script: **Deploy → Manage Deployments** → three-dot menu on a previous deployment → re-deploy that version.

**Q: My changes aren't showing up after deploy.**
Always use **Manage Deployments → Edit** (pencil icon) and bump the version number. Never rely on redeploy without changing the version — Apps Script may serve stale code.

**Q: The app returns stale data after I change the sheet.**
The backend uses a 30-second `CacheService` cache. Wait 30 seconds and refresh, or run `invalidateCache()` manually from the Apps Script editor: **Run → invalidateCache**.

---

## Security

- The Apps Script URL is intentionally kept in `config.js`. Since the app is hosted on GitHub Pages, there is no server-side environment for secrets.
- **The URL alone cannot access data.** Every request except `ping` requires a valid session token, sent in the POST body (never in the URL), that is issued by the backend after login and stored server-side in `PropertiesService`.
- Tokens are random (two v4 UUIDs, ~244 random bits) and expire after **8 hours**.
- Old tokens are automatically cleaned up on each new login.
- Passwords are stored as plaintext in the `Admins` sheet — consider restricting Sheets access to trusted Google accounts only.

> If you rotate your Apps Script deployment (to get a new URL), update `url` in `config.js` and redeploy to GitHub Pages.

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

The app will connect to the live Apps Script backend as long as `url` in `config.js` is set.

---

## Testing

```bash
npm test             # money math + backend (*.gs) tests — no install needed
npm install          # once, for the E2E test
npx playwright install chromium
npm run test:e2e     # full UI flows in headless Chromium against a fake backend
npm run test:edge    # edge cases: UI + the real .gs backend, with Sheets value coercion
npm run test:all     # everything
```

No test touches the live spreadsheet. `backend.test.js` runs the real `.gs` files with in-memory mocks of SpreadsheetApp, LockService, PropertiesService, CacheService and MailApp; the E2E test intercepts all requests to `script.google.com`.

> The `.gs` files in this repo are the source of truth for the backend. After changing one, paste it into the Apps Script editor and deploy a new version (see FAQ below).

---

## Changelog

| Version | Highlights |
|---|---|
| v3.2.5 | Random UUID session tokens; GET no longer serves data (token never in URLs); email format validated (UI + backend); instalment dates must be in order and not before the deposit; full plan rules enforced in the backend too |
| v3.2.4 | Sheets keeps phones/notes as text (leading 0, "+") and blocks formula injection; deposit/instalment validation; exact instalment rounding; overpayment confirm; CSV injection guard; edge-case E2E suite |
| v3.2.3 | Backend in repo; cron skips already-paid reminders and shows remaining amount; case-insensitive email dedupe; id lock covers append; clean error messages; backend test suite |
| v3.2.2 | closeM focus crash fix, student search on paste/autofill, E2E test |
| v3.2.1 | Paid/total shown above progress bars, Enter can't bypass a disabled save, local-date fix, test setup fixed |
| v3.2.0 | calc.js extracted + unit tests, sync race guard, single-flight writes, token in POST body, course detail |
| v2.9.1 | config.js single source of truth, parseUserNumber decimal fix, date validation, Enter key, focus management, enrollment archive filter |
| v2.9.0 | XSS protection (esc()), token expiry redirect, toast system, custom confirm dialog |
| v2.8.1 | Enrollment detail delete button, "Edit Plan" → "Edit", 6 bug fixes |
| v2.8.0 | Mobile responsive, debounce search, formatDate timezone fix, CacheService, LockService, token cleanup, duplicate email guard, `updateEnrollment` totalFee fix, Cron logging |
| v2.7.0 | Single overlay modal system (Opera fix), delete payment, student detail on click |
| v2.6.0 | Token-based auth, `verifyToken`, `deleteRecord` await fix, `c-deposit` bug fix, `parseFee` helper, null guards |
| v2.5.0 | Add/delete for courses, students, enrollments; smart payment suggestion |

---

## License

Private — Meisner Studio Amsterdam. Not for public distribution.
