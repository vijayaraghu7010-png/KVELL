# Test Report

Run date: 2026-10-18 · Windows 11 · Node.js v24.14.1 · Chrome (headless) for UI tests.
Every result below comes from a command run against the current code. Nothing is estimated.

## Summary

| Check | Command | Result |
| --- | --- | --- |
| Type check (client + server) | `npm run lint` (`tsc --noEmit`) | **Pass**, 0 errors |
| Production build | `npm run build` | **Pass**: portals code-split; main chunk 269.7 kB (84.4 kB gzip) |
| API, security and workflow tests | `npm test` | **31 / 31 pass**, 10 suites, ~6.6 s |
| Browser smoke test (all portals, desktop + 390 px mobile, two end-to-end flows) | `npm run build && npm run test:ui` | **Pass**: 118 checks |
| Dependency audit (runtime deps) | `npm audit --omit=dev` | 0 known vulnerabilities |
| Secrets in browser bundle | searched `dist/` for demo password, DB path, hashing internals | None found (only form-field labels such as "password") |

## 1. Automated API tests (`tests/`)

Every test run builds a fresh in-memory SQLite database with the real migrations and a small fixture: two
departments, one or more accounts for each role, four students and two rooms. Requests go through real HTTP with
cookies, against the real Express app.

### Authentication and authorization (`auth-rbac.test.ts`)
- Rejects unauthenticated API access (401).
- Login sets an HttpOnly session cookie, and `/me` returns the role stored on the server.
- Wrong password and wrong portal return the same message.
- The account locks after repeated failures.
- Logout invalidates the session on the server; the old cookie stops working.
- Password change enforces the policy and the current password.
- Cross-origin state-changing requests are rejected.
- Each portal API is limited to its role (for example, a student calling Warden/Dean/AO/Admin routes gets 403).
- Students only see their own requests.
- Advisers act only on their assigned students; HODs only on their own department.
- Notifications are private to each user.
- Admin can provision accounts, and the one-HOD-per-department rule is enforced.

### Cross-portal workflows (`workflows.test.ts`)
- Leave: Student → Adviser → Warden → QR outpass → Security exit/entry → attendance. Also checks duplicate and
  overlap rejection, no stage skipping, a required rejection reason, and no double decisions.
- An exit without a valid pass is flagged and the Warden is alerted. An outing approval issues a pass, and the
  client cannot spoof the student at the gate.
- Absence: Pending → Suspected on roll close → Verified → Dean follow-up → Adviser resolves.
- Study sessions: the Warden's records drive the Dean's participation view.
- Dean assignments: assign → acknowledge → progress → submit → revise → resubmit → approve. Evidence-required
  tasks cannot be submitted without an attachment. Deadline reminders are created once and the overdue flag is
  derived.
- Dean schedules: conflict detection, a required override reason, and changes delivered to participants.
- Report distribution: distribute → acknowledge → submit → under review → revise → resubmit → accept.
- Complaint → work order → AO completes → the student sees the resolution.
- Warden incident → AO escalates → AO resolves; the HOD sees only their own department.
- Academic CSV import is all-or-nothing and scoped, and the Dean's summaries match.
- Dean follow-up requests go only to eligible staff (the student's adviser, their department's HOD, or a
  Warden), reach the assignee's follow-up list and notifications, and are refused for non-Dean roles.
- Room capacity is enforced on allocation.

### Utilities (`util.test.ts`)
- Institution-timezone day boundaries (Asia/Kolkata), validator behaviour, salted scrypt hashes and the
  password policy.

## 2. Browser smoke test (`scripts/ui-smoke.mjs`)

- Seeds a **temporary** demo database (never touches `data/kvcet.db`), starts the built server on a free port,
  and drives headless Chrome over the DevTools protocol.
- Signs in through the real login form (student) and through the login API (other roles).
- Opens every page of the Student, Warden, Security, HOD, Adviser, AO, Mess, Dean and Admin portals at desktop
  width, plus a sample at 390 px mobile width.
- A page fails if it has an uncaught exception, a console error, a 5xx API response, an error banner, a redirect
  away from the portal, or horizontal overflow on mobile. The page heading is recorded for each page.
- End-to-end flows through the UI:
  - Dean creates an assignment for an HOD → the HOD sees it and acknowledges it.
  - Student submits leave → Adviser recommends → Warden approves → the student's outpass shows a QR code.
- Screenshots go to a temporary folder printed at the end of the run.

## 3. Manual checks during development
- The AO sidebar contains exactly: Dashboard, Warden Incident Reports, Escalated Cases, Maintenance & Work
  Orders, Reports & Analytics, Notifications, Profile.
- The DEMO DATA badge appears only when demo data has been loaded.
- No page has a portal switcher, and editing the URL to another role's portal shows an "unauthorized" screen.
  The API returns 403 regardless.

## 4. Not verified
- Load and concurrency behaviour beyond a single process, and long-running jobs over days.
- Real camera QR scanning on physical devices. It uses `BarcodeDetector` where the browser supports it, with
  manual code entry as the fallback; only the manual path is covered by automated tests.
- Browsers other than Chromium-based ones; screen-reader accessibility audit.
- Email, SMS and push delivery: not implemented, so not tested.
- Third-party penetration testing.

The system has passed the checks above, but it should not be called production-ready until the items in
section 4 are addressed and an operator has reviewed configuration (HTTPS, `COOKIE_SECURE`, backups of the
SQLite file).
