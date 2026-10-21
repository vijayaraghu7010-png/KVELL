-- KVCET Hostel Management System — study session scheduling detail.
--
-- A session can now name its department SECTION and, when the Adviser wants to,
-- an explicit list of assigned students instead of relying on the filters alone.

ALTER TABLE study_sessions ADD COLUMN section TEXT;

-- Explicit roster. When a session has rows here they are the assigned students;
-- with no rows the session falls back to its department / section / year / block
-- filters over the Adviser's own advisees.
CREATE TABLE study_session_students (
  session_id  TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students(id),
  added_by    TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (session_id, student_id)
);
CREATE INDEX ix_study_session_students ON study_session_students(student_id);
