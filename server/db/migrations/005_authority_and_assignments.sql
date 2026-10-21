-- KVCET Hostel Management System — authority hierarchy and Dean work assignment.
--
-- The authority order itself lives in code (server/lib/authority.ts) because it is a
-- policy, not data. What is stored here is the distribution an assignment was created
-- with, so the Dean can filter and audit "who was this sent to, and why".

-- Which departments and recipient roles the Dean targeted when creating the task.
-- Stored as JSON arrays; the per-person records in assignment_recipients remain the
-- authoritative list of who actually received it.
ALTER TABLE assignments ADD COLUMN target_departments TEXT;
ALTER TABLE assignments ADD COLUMN recipient_roles TEXT;
ALTER TABLE assignments ADD COLUMN selection_summary TEXT;

-- Overdue lookups scan by deadline across every recipient.
CREATE INDEX ix_assignment_recipients_due ON assignment_recipients(due_at, status);
CREATE INDEX ix_assignments_status ON assignments(status, due_at);

-- Backfill the distribution of existing tasks from the recipients they already have,
-- so the Dean's filters work on historic records too.
UPDATE assignments
SET recipient_roles = (
      SELECT group_concat(r, ',') FROM (
        SELECT DISTINCT u.role AS r FROM assignment_recipients ar JOIN users u ON u.id = ar.user_id
        WHERE ar.assignment_id = assignments.id ORDER BY u.role
      )
    ),
    target_departments = (
      SELECT group_concat(d, ',') FROM (
        SELECT DISTINCT u.department_code AS d FROM assignment_recipients ar JOIN users u ON u.id = ar.user_id
        WHERE ar.assignment_id = assignments.id AND u.department_code IS NOT NULL ORDER BY u.department_code
      )
    )
WHERE EXISTS (SELECT 1 FROM assignment_recipients ar WHERE ar.assignment_id = assignments.id);
