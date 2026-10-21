-- KVCET Hostel Management System — workflow update 2.
--
--  1. Study sessions belong to a Hosteller Adviser, who starts and ends them with
--     two separate, short-lived QR codes; attendance is reconciled server-side.
--  2. Outing requests need a verified parent/guardian decision (sent over WhatsApp)
--     before the Warden ever sees them, and carry GPS tracking state.
--  3. Gate scans stay a single canonical event that both the Warden and Security
--     logbooks read, including rejected scans.

-- ---------------------------------------------------------------------------
-- 1. Adviser responsibility, and the student's own residential status
-- ---------------------------------------------------------------------------
-- Whether an Adviser is responsible for hostel (Hosteller) students or day scholars.
-- This is the STAFF member's responsibility, and is deliberately separate from
-- students.is_hosteller, which records where the student actually lives.
ALTER TABLE users ADD COLUMN student_category TEXT CHECK (student_category IS NULL OR student_category IN ('Hosteller', 'Out / Day Scholar'));

-- ---------------------------------------------------------------------------
-- 2. Study sessions: adviser ownership and a live lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE study_sessions_new (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  session_date     TEXT NOT NULL,
  start_time       TEXT NOT NULL,
  end_time         TEXT NOT NULL,
  location         TEXT NOT NULL,
  block            TEXT,
  department_code  TEXT REFERENCES departments(code),
  year             INTEGER,
  -- The Adviser who conducts the session. Only a Hosteller Adviser may be assigned.
  adviser_user_id  TEXT REFERENCES users(id),
  status           TEXT NOT NULL CHECK (status IN ('Scheduled','In Progress','Completed','Cancelled')),
  started_at       TEXT,
  started_by       TEXT REFERENCES users(id),
  ended_at         TEXT,
  ended_by         TEXT REFERENCES users(id),
  reconciled_at    TEXT,
  notes            TEXT,
  created_by       TEXT NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (end_time > start_time)
);
INSERT INTO study_sessions_new (id, title, session_date, start_time, end_time, location, block, department_code, year, status, notes, created_by, created_at, updated_at)
SELECT id, title, session_date, start_time, end_time, location, block, department_code, year, status, notes, created_by, created_at, updated_at FROM study_sessions;
DROP TABLE study_sessions;
ALTER TABLE study_sessions_new RENAME TO study_sessions;
CREATE INDEX ix_study_sessions_date ON study_sessions(session_date);
CREATE INDEX ix_study_sessions_adviser ON study_sessions(adviser_user_id, session_date);

-- Attendance gains the reconciliation state and the evidence behind it.
CREATE TABLE study_attendance_new (
  session_id    TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id),
  status        TEXT NOT NULL CHECK (status IN ('Present','Late','Absent','Excused','Pending Reconciliation')),
  source        TEXT NOT NULL DEFAULT 'Manual' CHECK (source IN ('Manual','QR Scan','Reconciliation')),
  start_scan_at TEXT,                  -- the scan that makes a student Present
  end_scan_at   TEXT,                  -- recorded separately; never converts Absent into Present
  remarks       TEXT,
  marked_by     TEXT REFERENCES users(id),
  marked_at     TEXT NOT NULL,
  PRIMARY KEY (session_id, student_id)
);
INSERT INTO study_attendance_new (session_id, student_id, status, remarks, marked_by, marked_at)
SELECT session_id, student_id, status, remarks, marked_by, marked_at FROM study_attendance;
DROP TABLE study_attendance;
ALTER TABLE study_attendance_new RENAME TO study_attendance;
CREATE INDEX ix_study_attendance_student ON study_attendance(student_id, status);

-- One QR per session per phase. The token is an HMAC of (session, phase, nonce)
-- keyed by a server-only secret, so it is unguessable yet re-derivable for the
-- students who are authorised to see it. Only the nonce and the token's SHA-256
-- hash are stored; the token itself never sits in the database.
CREATE TABLE study_session_qr (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  phase          TEXT NOT NULL CHECK (phase IN ('Start','End')),
  nonce          TEXT NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  issued_by      TEXT NOT NULL REFERENCES users(id),
  issued_at      TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  invalidated_at TEXT,
  UNIQUE (session_id, phase)
);
CREATE INDEX ix_study_qr_session ON study_session_qr(session_id, phase);

-- Every scan attempt, accepted or rejected, with its reason.
CREATE TABLE study_scans (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  qr_id       TEXT REFERENCES study_session_qr(id),
  phase       TEXT NOT NULL CHECK (phase IN ('Start','End')),
  student_id  TEXT NOT NULL REFERENCES students(id),
  result      TEXT NOT NULL CHECK (result IN ('Accepted','Rejected')),
  reason      TEXT,
  scanned_at  TEXT NOT NULL
);
-- A student can hold at most one accepted scan per session per phase.
CREATE UNIQUE INDEX ux_study_scan_accepted ON study_scans(session_id, phase, student_id) WHERE result = 'Accepted';
CREATE INDEX ix_study_scans_session ON study_scans(session_id, phase, scanned_at);

-- ---------------------------------------------------------------------------
-- 3. Outing requests: parent approval first, then the Warden
-- ---------------------------------------------------------------------------
CREATE TABLE outing_requests_new (
  id                  TEXT PRIMARY KEY,
  student_id          TEXT NOT NULL REFERENCES students(id),
  outing_type         TEXT NOT NULL DEFAULT 'Personal',
  destination         TEXT NOT NULL,
  reason              TEXT NOT NULL,
  out_at              TEXT NOT NULL,
  expected_return_at  TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('Draft','Parent Approval Pending','Parent Rejected','Pending Warden','Approved','Rejected','Cancelled')),
  -- Stage 1 — parent / guardian
  parent_phone        TEXT,
  parent_decision     TEXT CHECK (parent_decision IS NULL OR parent_decision IN ('Approved','Rejected')),
  parent_decided_at   TEXT,
  parent_note         TEXT,
  location_consent    INTEGER NOT NULL DEFAULT 0,
  -- Stage 2 — Warden
  decided_by          TEXT REFERENCES users(id),
  decided_at          TEXT,
  remarks             TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (expected_return_at > out_at)
);
-- Legacy rows predate parent approval: anything that was 'Pending' is treated as
-- already past that stage so no in-flight request is lost.
INSERT INTO outing_requests_new (id, student_id, outing_type, destination, reason, out_at, expected_return_at, status,
  parent_decision, parent_decided_at, decided_by, decided_at, remarks, created_at, updated_at)
SELECT id, student_id, outing_type, destination, reason, out_at, expected_return_at,
  CASE status WHEN 'Pending' THEN 'Pending Warden' ELSE status END,
  CASE status WHEN 'Pending' THEN 'Approved' WHEN 'Approved' THEN 'Approved' ELSE NULL END,
  CASE WHEN status IN ('Pending','Approved') THEN created_at ELSE NULL END,
  decided_by, decided_at, remarks, created_at, updated_at
FROM outing_requests;
DROP TABLE outing_requests;
ALTER TABLE outing_requests_new RENAME TO outing_requests;
CREATE INDEX ix_outing_student ON outing_requests(student_id, status);
CREATE INDEX ix_outing_status ON outing_requests(status, out_at);

-- One approval link per attempt. The raw token is only ever in the WhatsApp message.
CREATE TABLE outing_parent_approvals (
  id                  TEXT PRIMARY KEY,
  outing_id           TEXT NOT NULL REFERENCES outing_requests(id) ON DELETE CASCADE,
  parent_name         TEXT,
  parent_phone        TEXT NOT NULL,
  token_hash          TEXT NOT NULL UNIQUE,
  expires_at          TEXT NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'whatsapp',
  delivery_status     TEXT NOT NULL CHECK (delivery_status IN ('Pending','Sent','Failed','Not Configured')),
  provider_message_id TEXT,
  delivery_error      TEXT,
  decision            TEXT CHECK (decision IS NULL OR decision IN ('Approved','Rejected')),
  decided_at          TEXT,
  decision_note       TEXT,
  decision_ip         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX ix_outing_parent_approvals ON outing_parent_approvals(outing_id, created_at);
-- At most one undecided link per outing, so a resend supersedes rather than duplicates.
CREATE UNIQUE INDEX ux_outing_parent_open ON outing_parent_approvals(outing_id) WHERE decision IS NULL;

-- ---------------------------------------------------------------------------
-- 4. GPS tracking for approved outings
-- ---------------------------------------------------------------------------
CREATE TABLE outing_tracking (
  outing_id           TEXT PRIMARY KEY REFERENCES outing_requests(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL REFERENCES students(id),
  consent             INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL CHECK (status IN ('Not Started','Permission Granted','Active','Unavailable','Denied','Revoked','Stopped')),
  last_latitude       REAL,
  last_longitude      REAL,
  last_accuracy_m     REAL,
  last_update_at      TEXT,
  interrupted_at      TEXT,
  interruption_reason TEXT,
  alerted_at          TEXT,
  stopped_at          TEXT,
  stop_reason         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX ix_outing_tracking_status ON outing_tracking(status, last_update_at);

CREATE TABLE outing_location_pings (
  id            TEXT PRIMARY KEY,
  outing_id     TEXT NOT NULL REFERENCES outing_requests(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id),
  latitude      REAL,
  longitude     REAL,
  accuracy_m    REAL,
  status        TEXT NOT NULL CHECK (status IN ('Active','Unavailable','Denied','Revoked','Stopped','Permission Granted')),
  reason        TEXT,
  recorded_at   TEXT NOT NULL
);
CREATE INDEX ix_location_pings ON outing_location_pings(outing_id, recorded_at);

-- ---------------------------------------------------------------------------
-- 5. Gate movements: one canonical event, read by both logbooks
-- ---------------------------------------------------------------------------
CREATE TABLE gate_movements_new (
  id               TEXT PRIMARY KEY,
  student_id       TEXT REFERENCES students(id),
  name             TEXT NOT NULL,
  reg_number       TEXT NOT NULL,
  movement_type    TEXT NOT NULL CHECK (movement_type IN ('Entry','Exit')),
  gate             TEXT NOT NULL,
  device_id        TEXT,
  destination      TEXT,
  room_number      TEXT,
  block            TEXT,
  occurred_at      TEXT NOT NULL,
  -- 'Rejected' records a scan that was refused, so a refusal is never stored as a
  -- successful entry or exit.
  status           TEXT NOT NULL CHECK (status IN ('Approved','Flagged','Duplicate','Rejected')),
  rejection_reason TEXT,
  notes            TEXT,
  security_notes   TEXT,
  outpass_id       TEXT REFERENCES outpasses(id),
  outing_id        TEXT REFERENCES outing_requests(id),
  recorded_by      TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL
);
INSERT INTO gate_movements_new (id, student_id, name, reg_number, movement_type, gate, destination, room_number, occurred_at, status, notes, outpass_id, recorded_by, created_at)
SELECT id, student_id, name, reg_number, movement_type, gate, destination, room_number, occurred_at, status, notes, outpass_id, recorded_by, created_at FROM gate_movements;
DROP TABLE gate_movements;
ALTER TABLE gate_movements_new RENAME TO gate_movements;
CREATE INDEX ix_gate_occurred ON gate_movements(occurred_at);
CREATE INDEX ix_gate_student ON gate_movements(student_id, occurred_at);
CREATE INDEX ix_gate_status ON gate_movements(status, occurred_at);
CREATE INDEX ix_gate_outing ON gate_movements(outing_id);
