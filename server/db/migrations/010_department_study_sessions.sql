-- ---------------------------------------------------------------------------
-- Study sessions an Adviser starts for a whole department.
--
-- An Adviser's sessions normally reach only their own advisees. A session started
-- from the Adviser portal covers every hosteller in the department instead: the
-- attendance QR goes to all of them, and all of them can scan it. The flag says so
-- explicitly, so the ordinary rule keeps protecting every other session.
-- ---------------------------------------------------------------------------
ALTER TABLE study_sessions ADD COLUMN department_wide INTEGER NOT NULL DEFAULT 0;
