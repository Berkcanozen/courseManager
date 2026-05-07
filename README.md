Here is a comprehensive and professional README.md file for your project in English. You can create a new file named README.md in your GitHub repository and paste this directly.

Markdown

# 🏫 Meisner Studio - Course Management System

A lightweight, modular, and serverless web application designed to manage courses, enroll students, and track payments. The application uses **Google Sheets** as a database and **Google Apps Script** as the backend API.

![Version](https://img.shields.io/badge/version-1.7.0-blue.svg)
![Architecture](https://img.shields.io/badge/architecture-Serverless-success.svg)

## ✨ Features

* **Secure Admin Login:** Access is restricted via a login screen, authenticated against the database.
* **Live Dashboard:** Real-time statistics displaying active courses, total students, collected revenue, and outstanding balances.
* **Course Management:** Create and edit courses with parameters like Start/End dates, Normal & Early Bird fees, capacity, and deposit amounts.
* **Student Enrollment & Payment Plans:** * Assign students to courses with flexible pricing tiers.
    * Set up one-time payments or dynamic instalment plans.
    * Track deposit due dates and total outstanding balances automatically.
* **Smart Payment Assistant:** Automatically calculates and suggests the next logical payment amount (e.g., remaining deposit, next instalment, or full remaining balance).
* **Audit Logging:** Automatically records `createUser`, `createDate`, `updateUser`, and `updateDate` for all entries to keep a secure audit trail.
* **Automated Email Reminders:** A daily cron job checks for due payments (deposits or instalments) and sends summary reminder emails to administrators.
* **Live Connection Status:** Real-time ping system to verify the connection between the frontend and the Google Apps Script backend.

## 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6)
* **Backend / API:** Google Apps Script (GAS)
* **Database:** Google Sheets
* **Icons:** Tabler Icons

## 📂 Project Structure

The frontend is fully modularized for better maintainability:

```text
📦 meisner-studio-manager
 ┣ 📜 index.html   # Main layout, login screen, and modals structure
 ┣ 📜 style.css    # All styling, UI elements, and animations
 ┣ 📜 app.js       # Frontend logic, API calls, and DOM manipulation
 ┣ 📜 Kod.gs       # Google Apps Script (Backend) - deployed separately
 ┗ 📜 README.md    # Documentation
🚀 Setup & Installation
1. Database Setup (Google Sheets)
Create a new Google Sheet.

Create a tab named exactly Admins.

Set up the first three columns in the Admins sheet:

Column A: email (Used for daily payment reminder emails)

Column B: username (Used for login)

Column C: password (Used for login)

Add at least one admin user starting from Row 2. (The system will auto-generate the Courses, Students, and Payments sheets upon first use).

2. Backend Setup (Google Apps Script)
In your Google Sheet, go to Extensions > Apps Script.

Delete any existing code and paste the contents of Kod.gs.

Click on Deploy > New Deployment.

Set the following configuration:

Type: Web App

Execute as: Me (Your Google Account)

Who has access: Anyone (Crucial for avoiding CORS issues)

Click Deploy, authorize the required permissions, and copy the Web App URL.

3. Frontend Setup
Open app.js in your text editor.

Locate the cfg object at the top of the file:

JavaScript

let cfg = { 
  url: 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE', 
  currency: '€' 
};
Replace the placeholder URL with the Web App URL you copied in the previous step.

4. Setting up Daily Email Reminders (Cron Job)
Go back to your Google Apps Script editor.

Click the Triggers icon (the clock icon) on the left sidebar.

Click Add Trigger (bottom right).

Configure as follows:

Choose which function to run: checkPaymentsAndNotify

Select event source: Time-driven

Select type of time based trigger: Day timer

Select time of day: 8am to 9am (or your preference)

Click Save.

📝 Usage Notes
Date Formats: Dates are displayed in the European standard DD/MM/YYYY.

Updates: Whenever you make a change to Kod.gs, you must deploy it as a New Version via Deploy > Manage Deployments > Edit (Pencil icon) > New Version. Otherwise, the changes will not reflect on the frontend.

Security: Ensure your Web App URL is kept private, as anyone with the URL and valid credentials can access the system.
