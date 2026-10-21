-- ---------------------------------------------------------------------------
-- The worker's own half of the complaint process.
--
-- A worker has no account here, so the job message carries an unguessable,
-- expiring link bound to one assignment. Opening it shows that job and nothing
-- else; the worker reports the work done (or that they could not finish it) and
-- the Warden is left with one step: verify and resolve.
--
-- The token is stored as a SHA-256 hash, exactly as the parent approval links
-- are, so the database never holds anything that could be used to open a job.
-- ---------------------------------------------------------------------------
ALTER TABLE complaint_assignments ADD COLUMN token_hash       TEXT;
ALTER TABLE complaint_assignments ADD COLUMN token_expires_at TEXT;
ALTER TABLE complaint_assignments ADD COLUMN report_status    TEXT CHECK (report_status IN ('Reported Done','Could Not Complete'));
ALTER TABLE complaint_assignments ADD COLUMN report_note      TEXT;
ALTER TABLE complaint_assignments ADD COLUMN reported_at      TEXT;

CREATE UNIQUE INDEX ux_complaint_assignment_token ON complaint_assignments(token_hash) WHERE token_hash IS NOT NULL;

-- How long a worker's job link stays usable lives in SETTING_DEFAULTS as
-- `complaint.worker_link_hours`.
