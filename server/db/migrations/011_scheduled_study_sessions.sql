-- ---------------------------------------------------------------------------
-- Study sessions that start by themselves.
--
-- The office sets one timetable in the institutional rules; at that time the
-- system opens one department-wide session per department, with no Adviser
-- pressing anything. The flag marks those sessions so the job can recognise the
-- one it already opened today and never open a second.
-- ---------------------------------------------------------------------------
ALTER TABLE study_sessions ADD COLUMN auto_started INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS ux_study_sessions_auto_day
  ON study_sessions (session_date, department_code) WHERE auto_started = 1;
