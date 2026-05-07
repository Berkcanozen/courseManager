# 🏫 Meisner Studio - Course Management System (v2.0.0)

A professional, modular, and relational course management application. This version (v2.0.0) introduces a relational database model allowing students to enroll in multiple courses with independent payment plans and tracking.

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Architecture](https://img.shields.io/badge/architecture-Relational--Serverless-success.svg)

## 🚀 Key Updates in v2.0.0

* **Relational Data Model:** Moved from a flat structure to a relational model (`Students`, `Courses`, `Enrollments`, and `Payments`).
* **Multi-Course Enrollment:** A single student can now be enrolled in multiple different courses. Each enrollment has its own independent price tier, deposit, and instalment plan.
* **New Enrollment Workflow:** When adding a student to a course, the system asks whether they are a **New Student** or an **Existing Student**, preventing duplicate records.
* **Course-Specific Payments:** Payments are now linked to a specific enrollment. When recording a payment, you select the student and then choose which of their enrolled courses they are paying for.
* **Enhanced Audit Logging:** Every action tracks who (`createUser`/`updateUser`) and when (`createDate`/`updateDate`) a record was handled.

## ✨ Features

* **Secure Admin Login:** Authenticated via the `Admins` sheet.
* **Live Dashboard:** Real-time stats for unique students, total revenue, and global outstanding balance.
* **Smart Payment Assistant:** Suggests the next due payment (Deposit or specific Instalment) based on the specific course enrollment.
* **Automated Daily Reminders:** A daily cron job scans all enrollments and emails admins about payments due today.
* **Modular Frontend:** Clean separation of concerns with `index.html`, `style.css`, and `app.js`.

## 📂 Database Structure (Google Sheets)

The system automatically manages 5 main sheets:
1.  **`Admins`**: Admin credentials and notification emails.
2.  **`Courses`**: Course details, fees, and capacity.
3.  **`Students`**: Unique student identity records (Name, Email, Phone).
4.  **`Enrollments`**: Links Students to Courses with specific fees and payment plans.
5.  **`Payments`**: Ledger of all transactions linked to both a Student and a Course.

## 🛠️ Setup & Installation

### 1. Database Preparation
1. Create a new Google Sheet.
2. Create a tab named exactly **`Admins`**.
3. Set the columns: `A: email`, `B: username`, `C: password`.
4. Add your admin user in Row 2.

### 2. Backend Deployment (Google Apps Script)
1. Go to **Extensions > Apps Script**.
2. Paste the `Kod.gs` (v2.0.0) code.
3. **Crucial:** Click **Deploy > New Deployment**.
    * **Type:** Web App
    * **Execute as:** Me
    * **Who has access:** Anyone
4. Copy the **Web App URL**.

### 3. Frontend Configuration
1. Open `app.js`.
2. Update the `cfg.url` with your new Web App URL:
   ```javascript
   let cfg = { url: 'YOUR_URL_HERE', currency: '€' };
4. Daily Reminders
In Apps Script, go to Triggers (Clock icon).

Add a trigger for checkPaymentsAndNotify.

Set it to Time-driven -> Day timer -> 8am to 9am.

⚠️ Migration Note
If you are upgrading from v1.x, you must clear or delete your old Students and Payments sheets in Google Sheets, as the data structure is fundamentally different in v2.0.0.

Built with ❤️ for Meisner Studio.
