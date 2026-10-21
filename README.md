# KVCET Hostel Management System

A single web application with role-based portals for Students, Wardens, Security, Advisers, HODs, the
Administrative Officer (AO), Mess staff, the Dean and system Administrators. All portals share one database:
a leave request a student submits is the same record the adviser recommends, the warden approves, security
scans at the gate and the Dean sees in attendance monitoring.

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4 (`src/`)
- **Backend:** Express 4 on Node.js, run with `tsx` (`server.ts`, `server/`)
- **Database:** SQLite via Node's built-in `node:sqlite` module, with versioned SQL migrations (`server/db/migrations/`)
- **Auth:** server-side sessions (HttpOnly cookie), scrypt password hashes, role checks and record scoping on every API route

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, [docs/IMPLEMENTATION_AUDIT.md](docs/IMPLEMENTATION_AUDIT.md)
for what the original prototype contained and [docs/TEST_REPORT.md](docs/TEST_REPORT.md) for verification results.

## Requirements

- Node.js **22.13 or newer** (developed and tested on Node 24.14). No other services are needed.
- For `npm run test:ui` only: Google Chrome or Microsoft Edge installed locally.

## First-time setup

```bash
npm install
cp .env.example .env          # adjust values if needed (Windows: copy .env.example .env)
npm run db:migrate            # creates data/kvcet.db and applies migrations (also happens on server start)
npm run admin:create -- --email admin@kvcet.edu.in --name "System Administrator"
```

`admin:create` prompts for a password (or reads `ADMIN_PASSWORD`). Sign in as that administrator to create
departments, staff accounts (Warden, Security, Adviser, HOD, AO, Mess, Dean), students, rooms and adviser assignments.
New accounts are created with a temporary password and must change it on first sign-in.

### Optional: demonstration data

```bash
npm run db:seed-demo
```

Loads a clearly labelled demo dataset (departments, staff, students, rooms, sample requests). It never runs
automatically, never deletes existing records, and does nothing if demo data is already loaded. Every demo
record is flagged `is_demo`, and the UI shows a **DEMO DATA** badge while demo data is present. Demo accounts
use the password in `DEMO_PASSWORD` (default `Demo@12345`), for example `dean@kvcet.edu.in`,
`warden@kvcet.edu.in`, `security@kvcet.edu.in`, `ao@kvcet.edu.in`, `mess@kvcet.edu.in`, `admin@kvcet.edu.in`,
`hod.cse@kvcet.edu.in`, `adviser.cse1@kvcet.edu.in` and `student@kvcet.edu.in`. **Do not load demo data into a
production database.**

## Running

| Purpose | Command | URL |
| --- | --- | --- |
| Development | `npm run dev:server` (API, auto-reload) **and** `npm run dev` (Vite) in a second terminal | http://localhost:3000 (Vite proxies `/api` to port 5000) |
| Production-style | `npm run build` then `npm start` | http://localhost:5000 (API + built SPA) |

Reminder jobs (approaching and overdue Dean task deadlines, report-request deadlines, upcoming schedule items) run inside the server process every 5 minutes.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `npm run dev:server` | Vite dev server / API with watch mode |
| `npm start` | API server that also serves `dist/` |
| `npm run build` | Production frontend build |
| `npm run lint` | TypeScript type check (`tsc --noEmit`) |
| `npm test` | API, security and workflow tests (Node test runner, in-memory database) |
| `npm run test:ui` | Headless-browser smoke test of every portal page (run `npm run build` first; uses a temporary database) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed-demo` | Load labelled demo data (opt-in) |
| `npm run admin:create` | Create or reset an administrator account |

## Configuration

All settings are server-side environment variables documented in [.env.example](.env.example) (port, database
path, timezone, session lifetimes, secure cookies, proxy trust, allowed origins). No secret is bundled into
browser code. Institutional rules (curfew, attendance thresholds, academic support thresholds, study-session
rules) are edited in the app by the Dean or Admin under **Institutional Rules**.

## Portals at a glance

| Role | Main capabilities |
| --- | --- |
| Student | Leave and outing requests, QR outpass, complaints, attendance, mess menu and feedback, notifications, profile |
| Adviser | Recommend/reject advisee leave, academics import, mentoring and follow-ups, absence follow-up, tasks/schedule/report requests from the Dean |
| HOD | Department students, advisers, academics, attendance, follow-ups, incident reports, leave reports, analytics, Dean work inbox |
| Warden | Leave/outing decisions, student info, gate log book, complaints, attendance and absence verification, study sessions, incidents, rooms, follow-ups, reports |
| Security | QR/manual gate scan of outpasses, exit/entry log, alerts for invalid exits |
| AO | Dashboard, Warden Incident Reports, Escalated Cases, Maintenance & Work Orders, Reports & Analytics, Notifications, Profile |
| Mess | Menu drafting and publishing, student feedback |
| Dean | Dashboard, attendance and unauthorized absence, study sessions, academic performance, HOD/Adviser monitoring, work assignments, schedule and calendar, report distribution, reports and analytics (CSV/print), institutional rules |
| Admin | Staff accounts, students, departments, adviser assignment, institutional rules, audit log |

## Known limitations

- Email, SMS and push notifications are **not** configured; all notifications are in-app only.
- No Parent, Teacher or Principal portal exists (a Principal account can sign in but has no portal yet).
- Wardens see all hostel blocks (no per-block scoping).
- SQLite with a single server process; for multiple server instances a client/server database would be needed.
- Not yet load-tested or security-audited by a third party; see [docs/TEST_REPORT.md](docs/TEST_REPORT.md) for what was verified.
