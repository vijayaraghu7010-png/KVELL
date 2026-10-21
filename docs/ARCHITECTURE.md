# Architecture

## 1. Why this stack

The original workspace was a React + Vite single-page prototype with an Express server that held arrays in memory
(see `IMPLEMENTATION_AUDIT.md`). The brief asked to preserve the existing stack, so the React/Vite frontend and the
Express backend were kept. Persistence uses **SQLite through Node's built-in `node:sqlite` module**:

- no native compilation, no external database service, and nothing to install beyond `npm install`;
- real transactions, foreign keys, CHECK and UNIQUE constraints, and indexes;
- one file (`data/kvcet.db`) that is easy to back up.

The trade-off is a single writer process. Moving to PostgreSQL later means porting the SQL in `server/db/migrations/`
and the `Database` wrapper in `server/db/database.ts`. Route code only uses `get/all/run/transaction`.

## 2. Layout

```
server.ts                 entry: open DB + migrate, create app, listen, start reminder jobs
server/
  app.ts                  middleware, route mounting, SPA static serving
  db/database.ts          Database wrapper (node:sqlite), migration runner
  db/migrations/*.sql     versioned schema (applied once each, recorded in schema_migrations)
  lib/auth.ts             password hashing, sessions, requireAuth/requireRole, origin guard
  lib/scope.ts            row-level student scoping per role
  lib/records.ts          audit log, entity history, notifications, settings
  lib/validate.ts         request validation (field-level errors)
  lib/http.ts             HttpError, route wrapper, JSON error handler
  lib/util.ts             ids, human codes (LR-2026-0001), timezone helpers, formatting
  services/               workflow logic shared by routes, tests and the demo seeder
    requests.ts           leave / outing / outpass / gate movements
    complaints.ts         complaints, work orders, escalations
    attendance.ts         roll calls, absence cases, study sessions, follow-ups
    insights.ts           academic status, student detail, staff workload (no personal scores)
    recipients.ts         Dean recipient selection + confirmation
    reporting.ts          report catalogue, generation, CSV export
  routes/                 one router per portal + shared routers (common, work, operations, academics)
  jobs.ts                 reminder jobs (deadlines, schedules) and the study timetable, deduplicated
  cli/                    migrate, create-admin, seed-demo
src/
  App.tsx                 session bootstrap, login, forced password change, lazy-loaded portals
  auth/AuthContext.tsx    current user from GET /api/auth/me (never from local storage)
  services/http.ts        fetch wrapper: real errors only, no fallback data
  hooks/                  useResource/useAction/usePolling, URL-based portal routing
  components/common/      shared UI kit and cross-portal modules (notifications, follow-ups, incidents…)
  components/<portal>/    one folder per portal
tests/                    Node test runner suites against an in-memory database
scripts/ui-smoke.mjs      headless Chrome/Edge smoke test via the DevTools protocol
```

## 3. Authentication and authorization

- **Passwords:** scrypt (N=16384) with a random 16-byte salt per password; constant-time comparison. Policy:
  at least 8 characters with letters and digits. Plaintext passwords are never stored or logged.
- **Sessions:** a random opaque token in the `kvcet_sid` cookie (HttpOnly, SameSite=Lax, Secure in production).
  Only the token's SHA-256 hash is stored in `sessions`. Sessions have an idle timeout (default 120 min) and an
  absolute lifetime (12 h, or 7 days with "remember me"). Logout, password change, deactivation and admin
  password reset revoke sessions server-side.
- **Brute force:** an account locks for 15 minutes after 5 consecutive failures. Failed attempts are also throttled
  per IP. Wrong email, wrong password and wrong portal all return the same message.
- **CSRF:** state-changing `/api` requests must come from the same origin or an `ALLOWED_ORIGINS` entry.
- **Authorization:** every router after `/api/auth` runs `requireAuth`, and every portal router runs
  `requireRole(...)`. The role always comes from the session's user row. Client-side role strings, URL paths and
  query parameters never grant access, and the React portal guard only mirrors the server's decision.
- **Row scope (`lib/scope.ts`):** Student → own record; Adviser → assigned advisees; HOD → own department;
  Warden, AO, Dean, Principal, Admin → all students. Detail endpoints call `assertStudentAccess`, which returns 404 for
  out-of-scope records, so their existence is not revealed.
- **First login:** accounts created by an admin must change their temporary password before any portal loads.

## 4. Data model highlights

`001_initial.sql` defines 37 tables. Key ideas:

- **One record per real-world thing, shared by all portals.** For example, `leave_requests` (Pending Adviser →
  Pending Warden → Approved/Rejected/Cancelled) produces exactly one `outpasses` row on approval. Security
  movements write `gate_movements` against that pass, and the attendance roll reads both.
- **Absence cases** (`absence_cases`) carry the brief's states: Pending Verification → Authorized Absence or
  Suspected Unauthorized → Verified Unauthorized → Resolved, with follow-up links. "Present" is an attendance record,
  not a case.
- **Dean work:** `assignments` + `assignment_recipients` (per-recipient status and version, revision requests),
  `schedules` + `schedule_participants` (acknowledgement, conflict override reason), and `report_requests` +
  `report_recipients` (Draft → Distributed → Acknowledged → Submitted → Under Review → Revision Requested →
  Accepted → Closed). Recipient lists are resolved on the server and must be confirmed by count before sending.
- **History:** `entity_events` stores a status timeline for every workflow record. `audit_log` stores who did what,
  from which IP.
- **Notifications:** `notifications` with a unique `dedupe_key`, so jobs and retries never double-notify.
  Delivery is in-app only.
- **Human-readable IDs:** `id_counters` issues per-year sequential codes (e.g. `LR-2026-0001`, `FU-2026-0003`).
- **Attachments:** stored as BLOBs with size and type limits, readable only by users who can see the parent record.
- **Settings:** institutional rules (curfew, attendance/academic thresholds, study-session rules) in `settings`,
  editable by the Dean/Admin, with defaults in `lib/records.ts`.
- **Demo data:** rows created by `seed-demo` have `is_demo = 1`. `settings['demo.seeded_at']` turns on the UI badge.

## 5. Time handling

All timestamps are stored in UTC ISO-8601. "Today", day boundaries, curfew and due dates are computed in
`APP_TIMEZONE` (default Asia/Kolkata) by `localDate`, `zonedIso`, `dayStartIso` and `dayEndIso` in `lib/util.ts`.
There are no hard-coded UTC offsets.

## 6. Cross-portal flows (examples)

| Flow | Path through the system |
| --- | --- |
| Leave | Student creates → Adviser recommends → Warden approves → outpass with QR → Security scans exit/entry → attendance roll marks "on leave" → Dean sees authorized absence |
| Unauthorized absence | Warden closes roll → absent with no pass becomes *Suspected* → Warden verifies → Dean requests follow-up → Adviser/HOD resolves |
| Complaint | Student raises → Warden triages / creates work order → AO assigns technician and completes → student sees resolution |
| Incident | Warden files → AO escalates/resolves → HOD and Adviser see their own department's cases |
| Dean task | Dean selects recipients → confirms count → HOD/Adviser acknowledge, progress, submit with evidence → Dean approves or requests revision |
| Academic support | Adviser/HOD import marks (CSV, all-or-nothing, scoped) → rules flag *needs support* → Dean opens the student and requests a follow-up from the adviser, HOD or warden |

## 7. Frontend conventions

- Every portal is code-split with `React.lazy`. The main bundle holds only the shell, login and UI kit.
- Data comes from `useResource` (loading, error and retry states). Mutations use `useAction`, which shows the
  server's real message. Success toasts only appear after the server confirms.
- Portal tabs are in the URL (`/dean/assignments/ASG-2026-0001`), so notification links deep-link into records.
- Layouts are responsive down to 390 px with no horizontal page scroll (checked in `test:ui`).
