-- ---------------------------------------------------------------------------
-- One automatic study session per configured time, not per day.
--
-- The old unique index keyed an automatic session on (date, department) alone,
-- so once a department had had its session the timetable could never open
-- another one that day: changing the study time in the institutional rules
-- quietly did nothing until the next morning. The slot column records which
-- configured start time a session belongs to, so a new time opens a new
-- session while a repeated job tick still finds the one it already opened.
-- ---------------------------------------------------------------------------
ALTER TABLE study_sessions ADD COLUMN schedule_slot TEXT;

UPDATE study_sessions SET schedule_slot = start_time WHERE auto_started = 1 AND schedule_slot IS NULL;

DROP INDEX IF EXISTS ux_study_sessions_auto_day;
CREATE UNIQUE INDEX IF NOT EXISTS ux_study_sessions_auto_slot
  ON study_sessions (session_date, department_code, schedule_slot) WHERE auto_started = 1;
