# KVCET Hostel Management System — Implementation Audit

Audit date: 2026-10-17. Snapshot of the original prototype: `.backup/original-prototype-2026-10-17.tar.gz`.

## 1. What the project actually is

The implementation brief describes a static HTML/CSS/JS + Supabase prototype (`pages/*`, `js/*.js`,
`supabase/`, `walkthrough.md`). **None of those files exist in this workspace.** The real project is:

| Area | Actual state |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 8 + Tailwind 4, single-page app (`src/`) |
| Backend | Express 4 (`server.ts`) run with `tsx`, port 5000; Vite proxies `/api` to it |
| Persistence | **None.** `server.ts` holds arrays in memory (lost on restart). Most portals never call the server at all. |
| Auth | **None.** Any email/password is accepted client-side; role is chosen from a dropdown; a floating "portal switcher" jumps to any portal; the URL path (`/warden`, `/ao`…) alone grants access. |
| Supabase | Not present (no client, no SQL, no credentials). |
| Origin | Google AI Studio export (README, `metadata.json`, `@google/genai` dependency that is never imported). |

Because there is no Supabase or static-HTML code to preserve, the brief's "preserve the existing stack" rule is
applied to the **actual** stack: React + Vite on the client, Express on the server. Persistence is added with
SQLite through Node's built-in `node:sqlite` module (Node ≥ 22.13), which needs no native build step or external
service. See `docs/ARCHITECTURE.md` for the reasoning.

## 2. Portals and pages found

| Portal | Pages | Data source (before) |
| --- | --- | --- |
| Student | Home, Raise Complaint, Complaint Status, Leave Request, Leave Status, Outing Permission, My Outpass, Mess Menu, Profile | React state seeded from `src/data.ts`; not sent to server |
| Warden | Home, Student Info, Leave Requests, Outing Requests, Log Book, Maintenance Complaints, Attendance, Rooms/Allocation, Reports | Each component has its own hard-coded array (`INITIAL_*`, generated data) |
| Security | Home, QR Scanner, Log Book | Only portal calling the API; silently falls back to demo arrays on error |
| HOD | Dashboard, Students, Incident Reports, Reports, Profile | `src/data/hodData.ts` constants |
| Adviser | Dashboard, Students, Leave Requests, Incident Reports, Reports | `adviserDataService` in-memory singleton |
| Mess | Dashboard, Food Menu, Student Feedback | `messDataService` in-memory singleton |
| AO | Dashboard, Warden Incident Reports, Escalated Cases, Maintenance & Work Orders, Reports & Analytics, Notifications, Profile | `aoDataService` + `localStorage` |
| Dean, Principal, Parent, Teacher, Admin | **Do not exist.** `UserRole` lists Principal/Director/Admin/Dean but no portal renders for them. |

Also present but unused: `server/` (routes/controllers + JSON-file store) — never imported by `server.ts`.

## 3. Feature status

### Works (client-side only, nothing persisted)
- Navigation, filtering, searching and pagination inside most tables.
- Security portal: scan recording and log-book filtering through the API (in-memory).
- AO sidebar already contains exactly the 7 required modules (no Complaints / Staff Coordination).

### Visual prototype only
- Login (no credential check; success modal says "no backend authentication service is connected").
- Student profile edit and **password change** (toast says "updated successfully" but nothing happens).
- Warden attendance: 186 generated students; attendance %, history and "present days" are derived from the
  array index (`ab = (4 + id * 3) % 9`) — fabricated.
- Warden dashboard counts (`useState(3)`, `useState(4)`), Warden Reports (`DISCIPLINE_STUDENTS`, `SUMMARY_DATA_MAP`),
  HOD dashboard (`|| 6` fallback counts, `totalStudentsCount={142}`) — hard-coded metrics.
- Leave submission immediately creates an **active outpass** before any approval (`App.tsx handleSubmitLeave`).
- Outing submission immediately issues a digital outpass "Hostel Resident Warden Approved" before review.

### Partially implemented
- Warden leave/outing approval endpoints exist on the server but the Warden UI never calls them.
- Security scan updates "the first outpass whose campus state matches", not the scanned student's pass.
- AO escalation "forward to Principal" writes a hard-coded Principal name into the timeline.

### Missing entirely
- Persistent database, authentication, sessions, server-side authorization.
- Dean portal (dashboard, assignments, scheduling, report distribution, monitoring).
- Study-session / study-hour records (only a text mention "study hours 6:00–7:30 PM").
- Absence verification workflow, academic performance records, adviser follow-ups.
- Shared notification store (each portal has its own static list).
- Task assignment, scheduling and report-request workflows for HOD/Adviser.

## 4. Broken or inconsistent workflows
1. Student → Warden: requests created by the student are not visible to the Warden (separate arrays).
2. Warden → Student: approvals are not visible to the student.
3. Warden → AO: incidents come from `hodData.ts`; there is no Warden UI to file one.
4. Student complaint → Warden maintenance → AO work order: three unrelated datasets.
5. Security scan → student outpass: wrong pass updated (see above).
6. Adviser leave decision → Warden: not connected.
7. Every portal resets on reload (except AO via `localStorage`, which is per-browser only).

## 5. Security and access-control problems
| # | Problem | Severity |
| --- | --- | --- |
| S1 | No authentication; any password accepted | Critical |
| S2 | Role comes from a client dropdown / URL path / `?portal=` query | Critical |
| S3 | Floating portal switcher lets any user open any portal | Critical |
| S4 | Every API endpoint is unauthenticated; `/api/student/*` returns **all** students' records | Critical |
| S5 | `Access-Control-Allow-Origin: *` on all routes | High |
| S6 | API client masks failures with demo data (`fetchJson` fallbacks) — users see fabricated "success" | High |
| S7 | Password change is fake | High |
| S8 | No secrets found in source (`.env.example` holds placeholders only) | OK |

## 6. Planned implementation (executed — see TEST_REPORT.md for verification)
1. SQLite schema with versioned migrations (`server/db/migrations/*.sql`), foreign keys, unique constraints, indexes.
2. Auth: scrypt-hashed passwords, server sessions in an HttpOnly cookie, idle/absolute expiry, logout, password change.
3. Role-based authorization middleware on every route + record-level scoping (own student, department, advisees).
4. Shared services: audit log, notifications (deduplicated), status-transition guards.
5. Rewire every existing portal to the API (preserving layouts); remove client fallbacks and the portal switcher.
6. Leave workflow: Student → Adviser recommendation → Warden decision → outpass issued only on approval.
7. Warden: real attendance with absence verification states; study sessions; incident filing.
8. Dean portal with all modules from the brief; HOD/Adviser task, schedule and report-request inboxes.
9. Admin portal + CLI for provisioning users, departments and adviser assignments.
10. Clearly labelled, opt-in demo seed (`npm run db:seed-demo`) — never run automatically.
11. Automated API tests (Node test runner) covering auth, RBAC and cross-portal workflows.
12. Dean follow-up requests from the student profile (academic, study and absence rules) routed to the
    student's adviser, the department HOD or a Warden, with a Follow-ups page in each of those portals.

## 7. Outcome (2026-10-18)

All items in section 6 were implemented. Problems S1–S7 are fixed: real authentication, server-side role and
record checks, no portal switcher, no wildcard CORS, no client fallback data, and a working password change.
Workflow breaks 1–7 in section 4 are fixed because every portal now reads and writes the same records.
Legacy files that were replaced were moved, not deleted, to `.backup/legacy-server` and `.backup/legacy-src`.

Remaining limitations, which are not hidden in the UI:
- No Parent, Teacher or Principal portal. Principal accounts can sign in and see a "no portal yet" message.
- The original prototype had no student credits module or warden staff pages, so none were invented.
- External email, SMS and push delivery is not configured; notifications are in-app only, and the UI never says
  otherwise.
- Wardens are not scoped to a hostel block.
- Draft assignments do not save their selected recipients; recipients are chosen and confirmed when sending.
- SQLite with a single server process. No load testing or third-party security review has been done.

Verification results are in `TEST_REPORT.md`.
