# ExamGuard (Prototype): Setup Guide

A Chrome/Edge extension (Manifest V3) that lets a teacher see which students joined an
online exam and which of them are switching tabs. Backend: Supabase.

```
examguard/
├── manifest.json     extension definition
├── config.js         <-- your Supabase URL + anon key go here
├── api.js            tiny Supabase client (REST + auth)
├── background.js     student tab/window monitoring + heartbeat
├── popup.html/js     Student | Teacher popup
├── dashboard.html/js teacher live dashboard
├── styles.css
└── supabase/schema.sql
```

## How it works

| Role | What they do |
|------|--------------|
| Teacher | Popup → **Teacher** tab → log in (email + password) → **Create class** → gets a 6-character class code → **Open dashboard**. |
| Student | Opens the exam page → popup → **Student** tab → enters **name + class code** → **Join session**. No login. |
| Monitoring | The student's extension watches tab/window events and sends a status (`active` / `away` / `left`) plus a 30-second heartbeat. |
| Dashboard | Shows **Name**, **Status** (Active / Changing tabs / Offline / Left), **Time joined**, plus tab-switch count and last event. Click a row for that student's history. Refreshes every 3 seconds. |

The student's "exam tab" is the tab that is active when they press **Join session**.

---

## Part 1: Set up Supabase

1. Go to <https://supabase.com>, sign in, and click **New project**. Choose a name, a database
   password and a region close to your users, then wait for it to finish provisioning.
2. Open **SQL Editor → New query**, paste the whole contents of `supabase/schema.sql`, and click **Run**.
   You should see "Success. No rows returned".
3. Open **Authentication → Providers → Email** (the location of these settings may vary slightly between
   Supabase dashboard versions):
   - Keep **Email** enabled.
   - For a quick prototype, turn **off** "Confirm email" so teachers can sign up and log in immediately.
     (If you leave it on, the teacher must click the confirmation email before the first login.)
4. Open **Project Settings → API** and copy:
   - **Project URL**, e.g. `https://abcdxyz.supabase.co`
   - **anon / publishable key**
5. Open `config.js` in the extension folder and paste both values:
   ```js
   const SUPABASE_URL = "https://abcdxyz.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
   Never put the `service_role` key in the extension. The anon key is designed to be public;
   the tables are locked by Row Level Security and all student actions go through the SQL
   functions in `schema.sql`.

## Part 2: Install the extension (unpacked)

Do this on the teacher's computer and on **each student's** computer. Copy the same folder
(with your edited `config.js`) to every machine.

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `examguard` folder.
4. Click the puzzle-piece icon and **pin** ExamGuard.

After editing any file, click the circular **reload** icon on the extension card.

## Part 3: Run a test session

1. **Teacher:** click the extension → **Teacher** tab → **Create account** (first time) or **Log in**.
   Enter a class name → **Create class and get code**. Copy the code and share it with students.
   Click **Open dashboard**; keep that tab open.
2. **Student (second browser profile or another computer):** open the exam page → click the extension →
   **Student** tab → enter name + class code → tick the notice → **Join session**.
   The icon shows a green **ON** badge.
3. The student appears on the dashboard within a few seconds as **Active**.
4. The student switches to another tab, another window, or clicks outside the browser →
   status turns **Changing tabs** (red badge **!** on the student's icon). Returning flips it back.
5. If the student closes the browser, disables the extension, or loses internet for more than
   ~75 seconds the status becomes **Offline**.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Invalid API key" / failed to fetch | Re-check `config.js` values; reload the extension. |
| "function ... does not exist" | `schema.sql` did not run fully. Re-run it in the SQL Editor. |
| "Invalid or closed class code" | Code typed wrong. Codes use letters A-Z (no I, O) and digits 2-9. |
| Teacher can't log in after sign-up | "Confirm email" is on; confirm the email or disable that setting. |
| Student flagged "away" briefly when opening the popup | The extension waits 1.2 s before reporting; very quick blips are ignored. |
| Dashboard says "Class not found" | You are logged in as a different teacher than the one who created the class. |

## Privacy and fairness (important)

- The extension reports **only** whether the student is on the exam tab. It does not capture URLs,
  page titles, screen content, camera, microphone, or keystrokes.
- Tell students before the exam what is monitored and why. The popup includes a consent checkbox
  for this reason. Check your school's policy and local privacy rules before using it for real assessments.
- Treat a flag as a prompt to look closer, not as proof of cheating (notifications, accidental clicks,
  and system pop-ups can also move focus).

## Known limitations of this prototype

- A determined student can use a second device, a virtual machine, or remove the extension.
  The heartbeat will show "Offline" for removal/disabling, but cannot detect a second device.
- Status updates use short polling (3 s), not Supabase Realtime, to keep the extension free of build tools.
- Anyone can create a teacher account. For production, disable public sign-ups
  (Authentication → Sign In / Providers) and invite teachers instead.
- Class codes are 6 characters; add rate limiting (or longer codes) before wider rollout.
- Chrome only guarantees alarms every 30 s or slower; the tab-change events themselves are instant.

## Ideas for next steps

Close/reopen a class (`is_active`), export attendance and away-time as CSV, Supabase Realtime
instead of polling, teacher notifications on repeated tab switches, full-screen enforcement.
