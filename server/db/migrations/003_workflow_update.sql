-- KVCET Hostel Management System — workflow update.
--
--  1. Students belong to a department SECTION; each section has one Class Incharge.
--  2. Leave approval runs Student -> Class Incharge -> HOD -> Warden.
--  3. Complaints carry a configurable category, priority and resolution deadline,
--     are accepted by the Warden and assigned to a worker, and escalate to the AO
--     either because they are about the Warden or because they missed their deadline.

-- ---------------------------------------------------------------------------
-- 1. Sections and Class Incharge assignments
-- ---------------------------------------------------------------------------
ALTER TABLE departments ADD COLUMN sections TEXT NOT NULL DEFAULT 'A,B';
ALTER TABLE students ADD COLUMN section TEXT;

CREATE TABLE class_incharges (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_code  TEXT NOT NULL REFERENCES departments(code),
  section          TEXT NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1,
  assigned_by      TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
-- A department + section has at most one Class Incharge, and a teacher holds at most one section.
CREATE UNIQUE INDEX ux_class_incharge_slot ON class_incharges(department_code, section) WHERE is_active = 1;
CREATE UNIQUE INDEX ux_class_incharge_user ON class_incharges(user_id) WHERE is_active = 1;
CREATE INDEX ix_class_incharge_user ON class_incharges(user_id, is_active);

-- ---------------------------------------------------------------------------
-- 2. Leave requests: four-stage approval chain
--    SQLite cannot widen a CHECK constraint in place, so the table is rebuilt.
--    Legacy data: 'Pending Adviser' becomes 'Pending Class Incharge' and the
--    adviser decision becomes the Class Incharge decision. Rows that were already
--    past the adviser stage keep their stage and carry no HOD decision.
-- ---------------------------------------------------------------------------
CREATE TABLE leave_requests_new (
  id                    TEXT PRIMARY KEY,
  student_id            TEXT NOT NULL REFERENCES students(id),
  leave_type            TEXT NOT NULL,
  from_date             TEXT NOT NULL,
  to_date               TEXT NOT NULL,
  departure_at          TEXT,                     -- ISO instant: departure date + time
  return_at             TEXT,                     -- ISO instant: expected return date + time
  reason                TEXT NOT NULL,
  address_during_leave  TEXT,
  document_name         TEXT,
  status                TEXT NOT NULL CHECK (status IN ('Pending Class Incharge','Pending HOD','Pending Warden','Approved','Rejected','Cancelled')),
  parent_confirmed      INTEGER NOT NULL DEFAULT 0,
  parent_confirmed_at   TEXT,
  parent_confirmed_by   TEXT REFERENCES users(id),
  -- Stage 1 — Class Incharge, resolved from the student's department + section at submission
  incharge_id           TEXT REFERENCES users(id),
  incharge_decision     TEXT CHECK (incharge_decision IN ('Approved','Rejected')),
  incharge_remarks      TEXT,
  incharge_decided_at   TEXT,
  -- Stage 2 — HOD of the student's department
  hod_id                TEXT REFERENCES users(id),
  hod_decision          TEXT CHECK (hod_decision IN ('Approved','Rejected')),
  hod_remarks           TEXT,
  hod_decided_at        TEXT,
  -- Stage 3 — Warden (final)
  warden_id             TEXT REFERENCES users(id),
  warden_decision       TEXT CHECK (warden_decision IN ('Approved','Rejected')),
  warden_remarks        TEXT,
  warden_decided_at     TEXT,
  rejected_stage        TEXT CHECK (rejected_stage IN ('Class Incharge','HOD','Warden')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK (to_date >= from_date)
);

INSERT INTO leave_requests_new (
  id, student_id, leave_type, from_date, to_date, reason, address_during_leave, document_name, status,
  parent_confirmed, parent_confirmed_at, parent_confirmed_by,
  incharge_id, incharge_decision, incharge_remarks, incharge_decided_at,
  warden_id, warden_decision, warden_remarks, warden_decided_at, rejected_stage, created_at, updated_at)
SELECT
  id, student_id, leave_type, from_date, to_date, reason, address_during_leave, document_name,
  CASE status WHEN 'Pending Adviser' THEN 'Pending Class Incharge' ELSE status END,
  parent_confirmed, parent_confirmed_at, parent_confirmed_by,
  adviser_id,
  CASE adviser_decision WHEN 'Recommended' THEN 'Approved' WHEN 'Rejected' THEN 'Rejected' ELSE NULL END,
  adviser_remarks, adviser_decided_at,
  warden_id,
  CASE WHEN warden_decided_at IS NULL THEN NULL WHEN status = 'Approved' THEN 'Approved' WHEN status = 'Rejected' THEN 'Rejected' ELSE NULL END,
  warden_remarks, warden_decided_at,
  CASE WHEN status <> 'Rejected' THEN NULL WHEN warden_decided_at IS NOT NULL THEN 'Warden' ELSE 'Class Incharge' END,
  created_at, updated_at
FROM leave_requests;

DROP TABLE leave_requests;
ALTER TABLE leave_requests_new RENAME TO leave_requests;
CREATE INDEX ix_leave_student ON leave_requests(student_id, status);
CREATE INDEX ix_leave_dates ON leave_requests(status, from_date, to_date);
CREATE INDEX ix_leave_incharge ON leave_requests(incharge_id, status);
CREATE INDEX ix_leave_hod ON leave_requests(hod_id, status);

-- ---------------------------------------------------------------------------
-- 3. Configurable complaint categories, resolution targets and worker routing
-- ---------------------------------------------------------------------------
CREATE TABLE complaint_categories (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description      TEXT,
  default_priority TEXT NOT NULL DEFAULT 'Medium' CHECK (default_priority IN ('Low','Medium','High','Critical')),
  resolution_hours REAL NOT NULL CHECK (resolution_hours > 0),   -- fallback when no per-priority target exists
  worker_category  TEXT,                                          -- matches technicians.category
  routes_to_ao     INTEGER NOT NULL DEFAULT 0,                    -- 1 = goes to the AO review queue, never to the Warden
  is_active        INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 100,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Resolution target per category AND priority, so "Water Issue" is not forced to one deadline.
CREATE TABLE complaint_resolution_targets (
  category_id      TEXT NOT NULL REFERENCES complaint_categories(id) ON DELETE CASCADE,
  priority         TEXT NOT NULL CHECK (priority IN ('Low','Medium','High','Critical')),
  resolution_hours REAL NOT NULL CHECK (resolution_hours > 0),
  PRIMARY KEY (category_id, priority)
);

INSERT INTO complaint_categories (id, name, description, default_priority, resolution_hours, worker_category, routes_to_ao, is_active, sort_order, created_at, updated_at)
VALUES
  ('ccat_water',       'Water Issue',            'No water, low pressure, contaminated supply',   'High',   8,  'Plumbing',     0, 1, 10, strftime('%Y-%m-%dT%H:%M:%S.000Z','now'), strftime('%Y-%m-%dT%H:%M:%S.000Z','now')),
  ('ccat_electrical',  'Electrical Issue',       'Power failure, faulty fitting, unsafe wiring',  'High',   6,  'Electrical',   0, 1, 20, strftime('%Y-%m-%dT%H:%M:%S.000Z','now'), strftime('%Y-%m-%dT%H:%M:%S.000Z','now')),
  ('ccat_plumbing',    'Plumbing',               'Leaks, blocked drains, sanitary fittings',      'Medium', 24, 'Plumbing',     0, 1, 30, strftime('%Y-%m-%dT%H:%M:%S.000Z','now'), strftime('%Y-%m-%dT%H:%M:%S.000Z','now')),
  ('ccat_room',        'Room Maintenance',       'Furniture, doors, windows, fixtures',           'Medium', 48, 'Carpentry',    0, 1, 40, strftime('%Y-%m-%dT%H:%M:%S.000Z','now'), strftime('%Y-%m-%dT%H:%M:%S.000Z','now')),
  ('ccat_clean',       'Cleanliness',            'Housekeeping, waste removal, pest control',     'Medium', 24, 'Housekeeping', 0, 1, 50, strftime('%Y-%m-%dT%H:%M:%S.000Z','now'), strftime('%Y-%m-%dT%H:%M:%S.000Z','now')),
  ('ccat_other',       'Other Hostel Issue',     'Anything not covered by the other categories',  'Medium', 48, NULL,           0, 1, 60, strftime('%Y-%m-%dT%H:%M:%S.000Z','now'), strftime('%Y-%m-%dT%H:%M:%S.000Z','now')),
  ('ccat_warden',      'Complaint About Warden', 'Reviewed by the Administrative Officer',        'High',   24, NULL,           1, 1, 70, strftime('%Y-%m-%dT%H:%M:%S.000Z','now'), strftime('%Y-%m-%dT%H:%M:%S.000Z','now'));

INSERT INTO complaint_resolution_targets (category_id, priority, resolution_hours) VALUES
  ('ccat_water','Critical',4),      ('ccat_water','High',8),       ('ccat_water','Medium',24),     ('ccat_water','Low',48),
  ('ccat_electrical','Critical',2), ('ccat_electrical','High',6),  ('ccat_electrical','Medium',24),('ccat_electrical','Low',48),
  ('ccat_plumbing','Critical',4),   ('ccat_plumbing','High',8),    ('ccat_plumbing','Medium',24),  ('ccat_plumbing','Low',72),
  ('ccat_room','Critical',8),       ('ccat_room','High',24),       ('ccat_room','Medium',48),      ('ccat_room','Low',96),
  ('ccat_clean','Critical',4),      ('ccat_clean','High',12),      ('ccat_clean','Medium',24),     ('ccat_clean','Low',48),
  ('ccat_other','Critical',8),      ('ccat_other','High',24),      ('ccat_other','Medium',48),     ('ccat_other','Low',96),
  ('ccat_warden','Critical',12),    ('ccat_warden','High',24),     ('ccat_warden','Medium',48),    ('ccat_warden','Low',72);

-- Categories used before this migration. Kept inactive so existing complaints still
-- resolve a category, without offering them in the student's picker.
INSERT INTO complaint_categories (id, name, description, default_priority, resolution_hours, worker_category, routes_to_ao, is_active, sort_order, created_at, updated_at)
SELECT 'ccat_legacy_' || lower(replace(replace(name, ' ', '_'), '/', '')), name, 'Legacy category', 'Medium', 48, NULL, 0, 0, 900,
       strftime('%Y-%m-%dT%H:%M:%S.000Z','now'), strftime('%Y-%m-%dT%H:%M:%S.000Z','now')
FROM (SELECT DISTINCT category AS name FROM complaints)
WHERE name NOT IN (SELECT name FROM complaint_categories);

-- ---------------------------------------------------------------------------
-- 4. Complaints: title, category link, deadline, acceptance, worker, lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE complaints_new (
  id                   TEXT PRIMARY KEY,
  student_id           TEXT NOT NULL REFERENCES students(id),
  title                TEXT NOT NULL,
  category_id          TEXT REFERENCES complaint_categories(id),
  category             TEXT NOT NULL,                 -- name snapshot, kept readable in history
  urgency              TEXT NOT NULL,
  priority             TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  description          TEXT NOT NULL,
  location             TEXT NOT NULL,
  file_name            TEXT,
  status               TEXT NOT NULL CHECK (status IN ('Submitted','Accepted','Worker Assigned','In Progress','Resolved','Closed','Reopened')),
  resolution_hours     REAL,
  deadline_at          TEXT,
  accepted_by          TEXT REFERENCES users(id),
  accepted_at          TEXT,
  worker_id            TEXT REFERENCES technicians(id),
  worker_assigned_at   TEXT,
  contact_confirmed_at TEXT,
  resolution_notes     TEXT,
  resolved_by          TEXT REFERENCES users(id),
  resolved_at          TEXT,
  closed_by            TEXT REFERENCES users(id),
  closed_at            TEXT,
  reopened_count       INTEGER NOT NULL DEFAULT 0,
  is_about_warden      INTEGER NOT NULL DEFAULT 0,
  escalated_at         TEXT,
  -- Retained from the previous schema so maintenance work orders keep working.
  level                INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  assigned_technician  TEXT,
  technician_contact   TEXT,
  warden_remarks       TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

INSERT INTO complaints_new (
  id, student_id, title, category_id, category, urgency, priority, description, location, file_name, status,
  resolution_hours, deadline_at, resolved_at, level, assigned_technician, technician_contact, warden_remarks, created_at, updated_at)
SELECT
  c.id, c.student_id,
  substr(c.description, 1, 80),
  cc.id, c.category, c.urgency, c.priority, c.description, c.location, c.file_name,
  CASE c.status WHEN 'Pending' THEN 'Submitted' WHEN 'Escalated' THEN 'In Progress' ELSE c.status END,
  COALESCE(cc.resolution_hours, 48),
  strftime('%Y-%m-%dT%H:%M:%S.000Z', c.created_at, '+' || CAST(COALESCE(cc.resolution_hours, 48) AS TEXT) || ' hours'),
  c.resolved_at, c.level, c.assigned_technician, c.technician_contact, c.warden_remarks, c.created_at, c.updated_at
FROM complaints c LEFT JOIN complaint_categories cc ON cc.name = c.category;

DROP TABLE complaints;
ALTER TABLE complaints_new RENAME TO complaints;
CREATE INDEX ix_complaints_student ON complaints(student_id);
CREATE INDEX ix_complaints_status ON complaints(status);
CREATE INDEX ix_complaints_deadline ON complaints(status, deadline_at);

-- ---------------------------------------------------------------------------
-- 5. Worker assignment and AO escalation records
-- ---------------------------------------------------------------------------
CREATE TABLE complaint_assignments (
  id            TEXT PRIMARY KEY,
  complaint_id  TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  worker_id     TEXT NOT NULL REFERENCES technicians(id),
  assigned_by   TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'Assigned' CHECK (status IN ('Assigned','Contacted','Completed','Cancelled')),
  contact_note  TEXT,
  contacted_at  TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX ix_complaint_assignments ON complaint_assignments(complaint_id, created_at);
-- Only one live worker assignment per complaint.
CREATE UNIQUE INDEX ux_complaint_live_assignment ON complaint_assignments(complaint_id) WHERE status IN ('Assigned','Contacted');

CREATE TABLE complaint_escalations (
  id              TEXT PRIMARY KEY,
  complaint_id    TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL CHECK (reason IN ('Complaint About Warden','Deadline Exceeded')),
  previous_status TEXT,
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Under Review','Action Recorded','Closed')),
  ao_notes        TEXT,
  reviewed_by     TEXT REFERENCES users(id),
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  -- One record per complaint per reason: a complaint that is both about the Warden
  -- and overdue carries two rows, and re-running the escalation job adds none.
  UNIQUE (complaint_id, reason)
);
CREATE INDEX ix_complaint_escalations_status ON complaint_escalations(status, created_at);

-- Workers are kept in the existing technicians table; make its category searchable.
CREATE INDEX ix_technicians_category ON technicians(category, is_active);

-- Complaint drafts gain the fields the new submission form captures.
ALTER TABLE complaint_drafts ADD COLUMN priority TEXT;
ALTER TABLE complaint_drafts ADD COLUMN location TEXT;
