-- KVCET Hostel Management System — initial schema.
-- Timestamps are ISO-8601 UTC strings; calendar dates are 'YYYY-MM-DD' in the institution timezone.

CREATE TABLE departments (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash         TEXT NOT NULL,
  name                  TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('Student','Warden','Security','Adviser','HOD','AO','Mess','Dean','Principal','Admin')),
  department_code       TEXT REFERENCES departments(code),
  phone                 TEXT,
  designation           TEXT,
  employee_id           TEXT,
  office                TEXT,
  profile_json          TEXT NOT NULL DEFAULT '{}',
  is_active             INTEGER NOT NULL DEFAULT 1,
  is_demo               INTEGER NOT NULL DEFAULT 0,
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  failed_logins         INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK (role NOT IN ('HOD','Adviser') OR department_code IS NOT NULL)
);
CREATE INDEX ix_users_role ON users(role, is_active);
-- One active HOD per department.
CREATE UNIQUE INDEX ux_users_active_hod ON users(department_code) WHERE role = 'HOD' AND is_active = 1;

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,           -- SHA-256 of the session token; the raw token only lives in the cookie
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  user_agent    TEXT,
  ip            TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL
);

CREATE TABLE id_counters (
  prefix  TEXT NOT NULL,
  year    INTEGER NOT NULL,
  value   INTEGER NOT NULL,
  PRIMARY KEY (prefix, year)
);

CREATE TABLE rooms (
  id              TEXT PRIMARY KEY,
  room_number     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  block           TEXT NOT NULL,
  floor           INTEGER NOT NULL,
  capacity        INTEGER NOT NULL CHECK (capacity > 0),
  room_type       TEXT NOT NULL,
  amenities_json  TEXT NOT NULL DEFAULT '[]',
  is_active       INTEGER NOT NULL DEFAULT 1,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE TABLE students (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT UNIQUE REFERENCES users(id),
  reg_number         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name               TEXT NOT NULL,
  department_code    TEXT NOT NULL REFERENCES departments(code),
  year               INTEGER NOT NULL CHECK (year BETWEEN 1 AND 5),
  semester           INTEGER CHECK (semester BETWEEN 1 AND 10),
  gender             TEXT,
  phone              TEXT,
  email              TEXT,
  address            TEXT,
  parent_name        TEXT,
  parent_phone       TEXT,
  blood_group        TEXT,
  medical_notes      TEXT,
  room_id            TEXT REFERENCES rooms(id),
  adviser_user_id    TEXT REFERENCES users(id),
  admission_year     INTEGER,
  enrollment_status  TEXT NOT NULL DEFAULT 'Active' CHECK (enrollment_status IN ('Active','Inactive','Graduated','Withdrawn')),
  is_hosteller       INTEGER NOT NULL DEFAULT 1,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX ix_students_dept ON students(department_code, year);
CREATE INDEX ix_students_adviser ON students(adviser_user_id);
CREATE INDEX ix_students_room ON students(room_id);

-- Generic, append-only history for every workflow record (leave, outing, complaint, incident, ...).
CREATE TABLE entity_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  actor_id     TEXT REFERENCES users(id),
  action       TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_entity_events ON entity_events(entity_type, entity_id, id);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     TEXT REFERENCES users(id),
  actor_role   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  details_json TEXT,
  ip           TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX ix_audit_created ON audit_log(created_at);

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  link         TEXT,
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','alert')),
  read_at      TEXT,
  dedupe_key   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_notifications_user ON notifications(user_id, read_at, created_at);
CREATE UNIQUE INDEX ux_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id),
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  data         BLOB NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_attachments_entity ON attachments(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Student requests
-- ---------------------------------------------------------------------------
CREATE TABLE leave_requests (
  id                    TEXT PRIMARY KEY,
  student_id            TEXT NOT NULL REFERENCES students(id),
  leave_type            TEXT NOT NULL,
  from_date             TEXT NOT NULL,
  to_date               TEXT NOT NULL,
  reason                TEXT NOT NULL,
  address_during_leave  TEXT,
  document_name         TEXT,
  status                TEXT NOT NULL CHECK (status IN ('Pending Adviser','Pending Warden','Approved','Rejected','Cancelled')),
  parent_confirmed      INTEGER NOT NULL DEFAULT 0,
  parent_confirmed_at   TEXT,
  parent_confirmed_by   TEXT REFERENCES users(id),
  adviser_decision      TEXT CHECK (adviser_decision IN ('Recommended','Rejected')),
  adviser_remarks       TEXT,
  adviser_id            TEXT REFERENCES users(id),
  adviser_decided_at    TEXT,
  warden_remarks        TEXT,
  warden_id             TEXT REFERENCES users(id),
  warden_decided_at     TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK (to_date >= from_date)
);
CREATE INDEX ix_leave_student ON leave_requests(student_id, status);
CREATE INDEX ix_leave_dates ON leave_requests(status, from_date, to_date);

CREATE TABLE leave_drafts (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  leave_type   TEXT,
  from_date    TEXT,
  to_date      TEXT,
  reason       TEXT,
  file_name    TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE outing_requests (
  id                  TEXT PRIMARY KEY,
  student_id          TEXT NOT NULL REFERENCES students(id),
  outing_type         TEXT NOT NULL DEFAULT 'Personal',
  destination         TEXT NOT NULL,
  reason              TEXT NOT NULL,
  out_at              TEXT NOT NULL,
  expected_return_at  TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('Draft','Pending','Approved','Rejected','Cancelled')),
  decided_by          TEXT REFERENCES users(id),
  decided_at          TEXT,
  remarks             TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (expected_return_at > out_at)
);
CREATE INDEX ix_outing_student ON outing_requests(student_id, status);

CREATE TABLE outpasses (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES students(id),
  source_type     TEXT NOT NULL CHECK (source_type IN ('Leave','Outing')),
  source_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  valid_from      TEXT NOT NULL,
  valid_until     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('Active','Out','Completed','Cancelled')),
  checked_out_at  TEXT,
  checked_in_at   TEXT,
  gate_desk       TEXT,
  approvals       TEXT,
  remarks         TEXT,
  qr_token        TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL,
  UNIQUE (source_type, source_id)
);
CREATE INDEX ix_outpass_student ON outpasses(student_id, status);

CREATE TABLE gate_movements (
  id             TEXT PRIMARY KEY,
  student_id     TEXT REFERENCES students(id),
  name           TEXT NOT NULL,
  reg_number     TEXT NOT NULL,
  movement_type  TEXT NOT NULL CHECK (movement_type IN ('Entry','Exit')),
  gate           TEXT NOT NULL,
  destination    TEXT,
  room_number    TEXT,
  occurred_at    TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('Approved','Flagged','Duplicate')),
  notes          TEXT,
  outpass_id     TEXT REFERENCES outpasses(id),
  recorded_by    TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_gate_occurred ON gate_movements(occurred_at);
CREATE INDEX ix_gate_student ON gate_movements(student_id, occurred_at);

CREATE TABLE complaints (
  id                  TEXT PRIMARY KEY,
  student_id          TEXT NOT NULL REFERENCES students(id),
  category            TEXT NOT NULL,
  urgency             TEXT NOT NULL,
  priority            TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High')),
  description         TEXT NOT NULL,
  location            TEXT NOT NULL,
  file_name           TEXT,
  status              TEXT NOT NULL CHECK (status IN ('Pending','In Progress','Escalated','Resolved')),
  level               INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  assigned_technician TEXT,
  technician_contact  TEXT,
  warden_remarks      TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  resolved_at         TEXT
);
CREATE INDEX ix_complaints_student ON complaints(student_id);
CREATE INDEX ix_complaints_status ON complaints(status);

CREATE TABLE complaint_drafts (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  category     TEXT,
  urgency      TEXT,
  description  TEXT,
  file_name    TEXT,
  updated_at   TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Attendance, absence verification, study sessions
-- ---------------------------------------------------------------------------
CREATE TABLE attendance_sessions (
  att_date     TEXT NOT NULL,
  session      TEXT NOT NULL,
  closed_at    TEXT,
  closed_by    TEXT REFERENCES users(id),
  note         TEXT,
  PRIMARY KEY (att_date, session)
);

CREATE TABLE attendance_records (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL REFERENCES students(id),
  att_date     TEXT NOT NULL,
  session      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('Present','Absent','On Leave','On Outing')),
  method       TEXT NOT NULL DEFAULT 'Manual Roll Call',
  remarks      TEXT,
  recorded_by  TEXT REFERENCES users(id),
  recorded_at  TEXT NOT NULL,
  UNIQUE (student_id, att_date, session)
);
CREATE INDEX ix_attendance_date ON attendance_records(att_date, session, status);

CREATE TABLE absence_cases (
  id                    TEXT PRIMARY KEY,
  student_id            TEXT NOT NULL REFERENCES students(id),
  att_date              TEXT NOT NULL,
  session               TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('Pending Verification','Authorized Absence','Suspected Unauthorized','Verified Unauthorized','Resolved')),
  detection_note        TEXT,
  authorization_ref     TEXT,
  verification_note     TEXT,
  verified_by           TEXT REFERENCES users(id),
  verified_at           TEXT,
  follow_up_user_id     TEXT REFERENCES users(id),
  follow_up_requested_by TEXT REFERENCES users(id),
  follow_up_note        TEXT,
  resolution_note       TEXT,
  resolved_by           TEXT REFERENCES users(id),
  resolved_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (student_id, att_date, session)
);
CREATE INDEX ix_absence_status ON absence_cases(status, att_date);

CREATE TABLE study_sessions (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  session_date     TEXT NOT NULL,
  start_time       TEXT NOT NULL,
  end_time         TEXT NOT NULL,
  location         TEXT NOT NULL,
  block            TEXT,
  department_code  TEXT REFERENCES departments(code),
  year             INTEGER,
  status           TEXT NOT NULL CHECK (status IN ('Scheduled','Completed','Cancelled')),
  notes            TEXT,
  created_by       TEXT NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX ix_study_sessions_date ON study_sessions(session_date);

CREATE TABLE study_attendance (
  session_id  TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students(id),
  status      TEXT NOT NULL CHECK (status IN ('Present','Late','Absent','Excused')),
  remarks     TEXT,
  marked_by   TEXT REFERENCES users(id),
  marked_at   TEXT NOT NULL,
  PRIMARY KEY (session_id, student_id)
);

-- ---------------------------------------------------------------------------
-- Academic performance and student support
-- ---------------------------------------------------------------------------
CREATE TABLE academic_records (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES students(id),
  academic_year  TEXT NOT NULL,
  semester       INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 10),
  assessment     TEXT NOT NULL,
  percentage     REAL NOT NULL CHECK (percentage BETWEEN 0 AND 100),
  sgpa           REAL CHECK (sgpa IS NULL OR sgpa BETWEEN 0 AND 10),
  arrears        INTEGER NOT NULL DEFAULT 0 CHECK (arrears >= 0),
  remarks        TEXT,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  entered_by     TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (student_id, academic_year, semester, assessment)
);
CREATE INDEX ix_academic_student ON academic_records(student_id);

CREATE TABLE student_followups (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES students(id),
  owner_user_id  TEXT NOT NULL REFERENCES users(id),
  category       TEXT NOT NULL CHECK (category IN ('Academic Support','Mentoring Session','Absence Follow-up','Study Session','Disciplinary','Other')),
  title          TEXT NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL CHECK (status IN ('Open','In Progress','Completed','Cancelled')),
  due_date       TEXT,
  session_date   TEXT,
  outcome        TEXT,
  source_type    TEXT,
  source_id      TEXT,
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT
);
CREATE INDEX ix_followups_owner ON student_followups(owner_user_id, status);
CREATE INDEX ix_followups_student ON student_followups(student_id);

-- ---------------------------------------------------------------------------
-- Incidents, escalations, maintenance
-- ---------------------------------------------------------------------------
CREATE TABLE incidents (
  id                  TEXT PRIMARY KEY,
  student_id          TEXT REFERENCES students(id),
  category            TEXT NOT NULL,
  severity            TEXT NOT NULL CHECK (severity IN ('Low','Medium','High','Critical')),
  status              TEXT NOT NULL CHECK (status IN ('Pending Review','Under Investigation','Escalated','Resolved')),
  incident_at         TEXT NOT NULL,
  location            TEXT NOT NULL,
  description         TEXT NOT NULL,
  action_taken        TEXT,
  warden_notes        TEXT,
  witnesses_json      TEXT NOT NULL DEFAULT '[]',
  follow_up_required  TEXT,
  reported_by         TEXT NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX ix_incidents_status ON incidents(status);
CREATE INDEX ix_incidents_student ON incidents(student_id);

CREATE TABLE escalations (
  id                TEXT PRIMARY KEY,
  source_type       TEXT NOT NULL CHECK (source_type IN ('complaint','incident','work_order','other')),
  source_id         TEXT,
  title             TEXT NOT NULL,
  category          TEXT NOT NULL,
  priority          TEXT NOT NULL CHECK (priority IN ('Medium','High','Critical')),
  status            TEXT NOT NULL CHECK (status IN ('Escalated','In Review','Forwarded to Principal','Resolved')),
  reason            TEXT NOT NULL,
  description       TEXT NOT NULL,
  location          TEXT,
  student_id        TEXT REFERENCES students(id),
  escalated_by      TEXT NOT NULL REFERENCES users(id),
  assigned_to_label TEXT,
  resolution_notes  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  resolved_at       TEXT
);
CREATE UNIQUE INDEX ux_escalations_source ON escalations(source_type, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE technicians (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  contact    TEXT,
  category   TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  is_demo    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE work_orders (
  id                  TEXT PRIMARY KEY,
  complaint_id        TEXT UNIQUE REFERENCES complaints(id),
  category            TEXT NOT NULL,
  description         TEXT NOT NULL,
  location            TEXT NOT NULL,
  priority            TEXT NOT NULL CHECK (priority IN ('Low','Medium','High')),
  status              TEXT NOT NULL CHECK (status IN ('Pending','Assigned','In Progress','Pending Verification','Completed','Cancelled')),
  technician_name     TEXT,
  technician_contact  TEXT,
  target_date         TEXT,
  remarks             TEXT,
  created_by          TEXT NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  completed_at        TEXT
);
CREATE INDEX ix_work_orders_status ON work_orders(status);

-- ---------------------------------------------------------------------------
-- Dean work assignments
-- ---------------------------------------------------------------------------
CREATE TABLE assignments (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL,
  category           TEXT NOT NULL,
  priority           TEXT NOT NULL CHECK (priority IN ('Low','Medium','High','Urgent')),
  start_at           TEXT NOT NULL,
  due_at             TEXT NOT NULL,
  expected_outcome   TEXT,
  instructions       TEXT,
  requires_evidence  INTEGER NOT NULL DEFAULT 0,
  is_confidential    INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('Draft','Active','Cancelled')),
  created_by         TEXT NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (due_at > start_at)
);

CREATE TABLE assignment_recipients (
  id               TEXT PRIMARY KEY,
  assignment_id    TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL CHECK (status IN ('Assigned','Acknowledged','In Progress','Submitted','Revision Requested','Completed','Cancelled')),
  progress_pct     INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  due_at           TEXT NOT NULL,
  acknowledged_at  TEXT,
  submitted_at     TEXT,
  completed_at     TEXT,
  submission_text  TEXT,
  review_comment   TEXT,
  reviewed_by      TEXT REFERENCES users(id),
  reviewed_at      TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (assignment_id, user_id)
);
CREATE INDEX ix_assignment_recipients_user ON assignment_recipients(user_id, status);

-- ---------------------------------------------------------------------------
-- Dean schedules
-- ---------------------------------------------------------------------------
CREATE TABLE schedules (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL,
  start_at          TEXT NOT NULL,
  end_at            TEXT NOT NULL,
  location          TEXT,
  department_code   TEXT REFERENCES departments(code),
  study_session_id  TEXT REFERENCES study_sessions(id),
  instructions      TEXT,
  requires_ack      INTEGER NOT NULL DEFAULT 1,
  reminder_minutes  INTEGER,
  status            TEXT NOT NULL CHECK (status IN ('Scheduled','Rescheduled','Cancelled','Completed')),
  conflict_override_reason TEXT,
  organizer_id      TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX ix_schedules_start ON schedules(start_at);

CREATE TABLE schedule_participants (
  schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  response      TEXT NOT NULL DEFAULT 'Pending' CHECK (response IN ('Pending','Acknowledged','Declined')),
  response_note TEXT,
  responded_at  TEXT,
  PRIMARY KEY (schedule_id, user_id)
);
CREATE INDEX ix_schedule_participants_user ON schedule_participants(user_id);

-- ---------------------------------------------------------------------------
-- Dean report distribution and requests
-- ---------------------------------------------------------------------------
CREATE TABLE report_requests (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  message              TEXT NOT NULL,
  category             TEXT NOT NULL,
  period_from          TEXT,
  period_to            TEXT,
  deadline_at          TEXT,
  requires_submission  INTEGER NOT NULL DEFAULT 1,
  generated_report_json TEXT,
  status               TEXT NOT NULL CHECK (status IN ('Draft','Distributed','Closed')),
  created_by           TEXT NOT NULL REFERENCES users(id),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  distributed_at       TEXT,
  closed_at            TEXT
);

CREATE TABLE report_recipients (
  id               TEXT PRIMARY KEY,
  request_id       TEXT NOT NULL REFERENCES report_requests(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL CHECK (status IN ('Distributed','Acknowledged','Submitted','Under Review','Revision Requested','Accepted')),
  acknowledged_at  TEXT,
  submitted_at     TEXT,
  submission_text  TEXT,
  review_comment   TEXT,
  reviewed_by      TEXT REFERENCES users(id),
  reviewed_at      TEXT,
  submission_count INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (request_id, user_id)
);
CREATE INDEX ix_report_recipients_user ON report_recipients(user_id, status);

-- ---------------------------------------------------------------------------
-- Mess
-- ---------------------------------------------------------------------------
CREATE TABLE mess_menu (
  day               TEXT NOT NULL CHECK (day IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  meal              TEXT NOT NULL CHECK (meal IN ('Breakfast','Lunch','Snacks','Dinner')),
  timing            TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  items_json        TEXT NOT NULL DEFAULT '[]',          -- working copy edited by the mess in-charge
  published_items_json TEXT,                              -- what students see
  published_description TEXT,
  is_published      INTEGER NOT NULL DEFAULT 0,          -- 1 when the working copy equals the published copy
  published_at      TEXT,
  updated_by        TEXT REFERENCES users(id),
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (day, meal)
);

CREATE TABLE mess_feedback (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES students(id),
  meal            TEXT NOT NULL,
  menu_date       TEXT NOT NULL,
  day             TEXT NOT NULL,
  food_rating     INTEGER NOT NULL CHECK (food_rating BETWEEN 1 AND 5),
  hygiene_rating  INTEGER NOT NULL CHECK (hygiene_rating BETWEEN 1 AND 5),
  speed_rating    INTEGER NOT NULL CHECK (speed_rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (student_id, menu_date, meal)
);
