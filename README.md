# Al-Iman Saturday School app

A web app for running the school: attendance, tests and grades, assignment uploads, a WhatsApp group per grade, payments, parent details and teacher notes. It runs entirely on Netlify's free plan, with no separate database to set up.

## What's in it

| Who | Can do |
| --- | --- |
| **Admin** | Everything: students and parents, grades/classes, teacher, assistant and parent logins, fees and payments (by family, by student, and a printable "parents who paid" report), all teacher notes, lesson plan review, reports, import, backup |
| **Teacher / assistant teacher** | Only the grades they're assigned to (they land on that grade's attendance when they sign in): take attendance (and message absent students' parents), create tests and enter scores, upload assignments, write lesson plans for the admin to review, write notes on students, share to the class WhatsApp group |
| **Parent** | Their own children only: attendance, grades, assignments to download, teacher comments that were marked "share with parents", fee balance, join-group button for the class WhatsApp |

Other bits: announcements, printable report cards and receipts, attendance register, roster with emergency contacts and allergies, birthdays, CSV exports everywhere, spreadsheet import with column matching, full backup/restore, works on phones (can be added to the home screen).

**WhatsApp:** WhatsApp doesn't let websites create groups or send messages by themselves. You make one group per grade in WhatsApp, paste its invite link into the app, and the app then gives you one-tap buttons that open WhatsApp with the message already written (invites, absence notices, fee reminders, receipts, new assignments).

## Deploying on Netlify

1. Sign in at [app.netlify.com](https://app.netlify.com) with your GitHub account.
2. **Add new site → Import an existing project → GitHub**, and pick this repository.
3. Leave the build settings as they are (they come from `netlify.toml`) and click **Deploy**.
4. Optional but recommended: in **Site configuration → Environment variables**, add `JWT_SECRET` set to a long random string, then redeploy.
5. Open the site. The first visit asks you to create the admin account.
6. Go to **Settings & Import → Import students** and load the starter file (`al-iman-starter.json`) you were given, or upload a spreadsheet.

**Locked out of the admin account?** In Netlify, add an environment variable `ADMIN_RECOVERY_CODE` (a secret of 12+ characters), redeploy, then click "Admin locked out?" on the sign-in page. You can sign in with your username or your email.

Data is stored in Netlify Blobs for that site. Download a backup from **Settings & Import → Backup** every few weeks.

## Running it on your own computer

```
npm install
npm run dev     # http://localhost:8888, data kept in ./.data
npm test        # API checks
```

## Layout

- `public/` – the web pages (plain JavaScript, no build step)
- `netlify/functions/api.mjs` – the server (all `/api/*` requests)
- `netlify/functions/lib/` – storage and login helpers
