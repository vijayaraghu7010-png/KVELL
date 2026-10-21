import { Router } from 'express';
import { db } from '../db/database';
import { requireRole, type AuthUser } from '../lib/auth';
import { badRequest, conflict, created, notFound, ok, route } from '../lib/http';
import { audit, getEvents, notify, recordEvent } from '../lib/records';
import { fmtDateTime, inList, nextCode, nowIso, parseJson, uid, dayEndIso, dayStartIso } from '../lib/util';
import { Validator } from '../lib/validate';
import { assertConfirmed, parseSelector, resolveRecipients } from '../services/recipients';
import { generateReport, REPORT_TYPES } from '../services/reporting';

const router = Router();
router.use(requireRole('Dean', 'HOD', 'Adviser'));

const isDean = (u: AuthUser) => u.role === 'Dean';
const deanOnly = requireRole('Dean');

router.post(
  '/recipients/preview',
  deanOnly,
  route((req, res) => ok(res, resolveRecipients(parseSelector(req.body)))),
);

// ===========================================================================
// WORK ASSIGNMENTS
// ===========================================================================
export const ASSIGNMENT_CATEGORIES = ['Academic Review', 'Student Support', 'Attendance Follow-up', 'Study Session Monitoring', 'Department Report', 'Administrative', 'Meeting Preparation', 'Other'] as const;
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
const OPEN_RECIPIENT = ['Assigned', 'Acknowledged', 'In Progress', 'Submitted', 'Revision Requested'];

const isOverdue = (r: { status: string; due_at: string }) => OPEN_RECIPIENT.includes(r.status) && r.due_at < nowIso();

function mapRecipient(r: any, withHistory = false) {
  return {
    id: r.id,
    assignmentId: r.assignment_id,
    userId: r.user_id,
    name: r.user_name,
    role: r.user_role,
    department: r.user_department,
    status: r.status,
    isOverdue: isOverdue(r),
    progressPct: r.progress_pct,
    dueAt: r.due_at,
    dueDisplay: fmtDateTime(r.due_at),
    acknowledgedAt: r.acknowledged_at ? fmtDateTime(r.acknowledged_at) : null,
    submittedAt: r.submitted_at ? fmtDateTime(r.submitted_at) : null,
    completedAt: r.completed_at ? fmtDateTime(r.completed_at) : null,
    submissionText: r.submission_text,
    reviewComment: r.review_comment,
    reviewedBy: r.reviewed_by_name || null,
    reviewedAt: r.reviewed_at ? fmtDateTime(r.reviewed_at) : null,
    version: r.version,
    updatedAt: r.updated_at,
    history: withHistory ? getEvents('assignment_recipient', r.id) : undefined,
  };
}

const RECIPIENT_SELECT = `
  ar.*, u.name AS user_name, u.role AS user_role, u.department_code AS user_department, rv.name AS reviewed_by_name
  FROM assignment_recipients ar JOIN users u ON u.id = ar.user_id LEFT JOIN users rv ON rv.id = ar.reviewed_by
`;
/** Recipient row joined with its parent assignment. */
const TASK_SELECT = `
  ar.*, u.name AS user_name, u.role AS user_role, u.department_code AS user_department, rv.name AS reviewed_by_name,
  a.title, a.category, a.priority, a.status AS assignment_status, a.requires_evidence, a.is_confidential, a.created_by
  FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id
  JOIN users u ON u.id = ar.user_id LEFT JOIN users rv ON rv.id = ar.reviewed_by
`;

function mapAssignment(a: any) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    category: a.category,
    priority: a.priority,
    startAt: a.start_at,
    dueAt: a.due_at,
    startDisplay: fmtDateTime(a.start_at),
    dueDisplay: fmtDateTime(a.due_at),
    expectedOutcome: a.expected_outcome,
    instructions: a.instructions,
    requiresEvidence: a.requires_evidence === 1,
    isConfidential: a.is_confidential === 1,
    status: a.status,
    // How the Dean addressed it, kept for filtering and audit; the per-person rows
    // in assignment_recipients remain the authoritative list of who received it.
    targetDepartments: a.target_departments ? String(a.target_departments).split(',').filter(Boolean) : [],
    recipientRoles: a.recipient_roles ? String(a.recipient_roles).split(',').filter(Boolean) : [],
    selectionSummary: a.selection_summary ?? null,
    createdBy: a.created_by_name,
    createdAt: fmtDateTime(a.created_at),
  };
}

/** Human description of a recipient selection, stored with the assignment. */
function describeSelection(sel: any, recipients: { role: string; department: string }[]): string {
  const parts: string[] = [];
  if (sel.allHods) parts.push(sel.departments?.length ? `all HODs in ${sel.departments.join(', ')}` : 'all HODs');
  if (sel.allAdvisers) parts.push(sel.departments?.length ? `all Advisers in ${sel.departments.join(', ')}` : 'all Advisers');
  if (sel.userIds?.length) parts.push(`${sel.userIds.length} named recipient(s)`);
  const depts = [...new Set(recipients.map((r) => r.department).filter(Boolean))];
  return `${parts.join(' + ') || 'selected recipients'} — ${recipients.length} person(s) across ${depts.length} department(s)`;
}

const ASSIGNMENT_SELECT = `a.*, u.name AS created_by_name FROM assignments a JOIN users u ON u.id = a.created_by`;

function getAssignment(id: string) {
  const a = db().get<any>(`SELECT ${ASSIGNMENT_SELECT} WHERE a.id = ?`, id);
  if (!a) throw notFound('Assignment');
  return a;
}

function recipientStats(assignmentId: string) {
  const rows = db().all<any>('SELECT status, due_at FROM assignment_recipients WHERE assignment_id = ?', assignmentId);
  const tally: Record<string, number> = {};
  rows.forEach((r) => (tally[r.status] = (tally[r.status] || 0) + 1));
  return { total: rows.length, byStatus: tally, overdue: rows.filter(isOverdue).length, completed: tally.Completed || 0 };
}

function readAssignment(body: any) {
  const v = new Validator(body);
  const out = {
    title: v.string('title', { max: 200, min: 3, label: 'Task title' }),
    description: v.string('description', { max: 5000, min: 10, label: 'Description' }),
    category: v.oneOf('category', ASSIGNMENT_CATEGORIES, { label: 'Category' }),
    priority: v.oneOf('priority', PRIORITIES, { label: 'Priority' }),
    startAt: v.dateTime('startAt', { label: 'Start date and time' }),
    dueAt: v.dateTime('dueAt', { label: 'Due date and time' }),
    expectedOutcome: v.string('expectedOutcome', { required: false, max: 2000 }),
    instructions: v.string('instructions', { required: false, max: 5000 }),
    requiresEvidence: v.bool('requiresEvidence'),
    isConfidential: v.bool('isConfidential'),
  };
  v.done();
  if (out.dueAt! <= out.startAt!) throw badRequest('The due date must be after the start date.', { fields: { dueAt: 'Due date must be after the start date.' } });
  if (out.dueAt! < nowIso()) throw badRequest('The due date is already in the past.', { fields: { dueAt: 'Due date is in the past.' } });
  return out;
}

function notifyAssigned(assignment: any, userIds: string[]) {
  notify(userIds, {
    eventType: 'assignment.assigned',
    title: `New task from the Dean: ${assignment.title}`,
    message: `${assignment.priority} priority · due ${fmtDateTime(assignment.due_at)}.`,
    entityType: 'assignment',
    entityId: assignment.id,
    link: '/tasks',
    severity: assignment.priority === 'Urgent' || assignment.priority === 'High' ? 'warning' : 'info',
    dedupeKey: `assignment.assigned:${assignment.id}`,
  });
}

function insertRecipients(assignment: any, userIds: string[], actorId: string) {
  const now = nowIso();
  for (const userId of userIds) {
    const rid = uid('asr');
    db().run(
      `INSERT INTO assignment_recipients (id, assignment_id, user_id, status, due_at, created_at, updated_at) VALUES (?, ?, ?, 'Assigned', ?, ?, ?)`,
      rid,
      assignment.id,
      userId,
      assignment.due_at,
      now,
      now,
    );
    recordEvent('assignment_recipient', rid, actorId, 'assigned', { to: 'Assigned' });
  }
}

router.post(
  '/assignments',
  deanOnly,
  route((req, res) => {
    const data = readAssignment(req.body);
    const asDraft = req.body?.status === 'Draft';
    const recipients = resolveRecipients(parseSelector(req.body.recipients));
    if (!asDraft) assertConfirmed(recipients, req.body.confirmCount);
    const id = db().transaction(() => {
      const newId = nextCode('ASG');
      const now = nowIso();
      const selector = parseSelector(req.body.recipients);
      db().run(
        `INSERT INTO assignments (id, title, description, category, priority, start_at, due_at, expected_outcome, instructions, requires_evidence, is_confidential,
          status, target_departments, recipient_roles, selection_summary, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId,
        data.title,
        data.description,
        data.category,
        data.priority,
        data.startAt,
        data.dueAt,
        data.expectedOutcome ?? null,
        data.instructions ?? null,
        data.requiresEvidence,
        data.isConfidential,
        asDraft ? 'Draft' : 'Active',
        [...new Set(recipients.map((r) => r.department).filter(Boolean))].sort().join(',') || null,
        [...new Set(recipients.map((r) => r.role))].sort().join(',') || null,
        describeSelection(selector, recipients),
        req.user!.id,
        now,
        now,
      );
      // Drafts keep the intended recipients in the event log until activation.
      recordEvent('assignment', newId, req.user!.id, asDraft ? 'draft_created' : 'created', {
        to: asDraft ? 'Draft' : 'Active',
        note: JSON.stringify({ recipients: recipients.map((r) => r.id) }),
      });
      if (!asDraft) {
        const a = getAssignment(newId);
        insertRecipients(a, recipients.map((r) => r.id), req.user!.id);
        notifyAssigned(a, recipients.map((r) => r.id));
      }
      return newId;
    });
    audit(req, asDraft ? 'assignment.draft_created' : 'assignment.created', 'assignment', id, { recipients: recipients.length });
    created(res, { ...mapAssignment(getAssignment(id)), stats: recipientStats(id) }, asDraft ? `Draft ${id} saved.` : `Task ${id} assigned to ${recipients.length} recipient(s).`);
  }),
);

router.post(
  '/assignments/:id/activate',
  deanOnly,
  route((req, res) => {
    const a = getAssignment(req.params.id);
    if (a.status !== 'Draft') throw conflict('Only drafts can be activated.');
    const recipients = resolveRecipients(parseSelector(req.body.recipients));
    assertConfirmed(recipients, req.body.confirmCount);
    if (a.due_at < nowIso()) throw badRequest('The due date has passed; update the draft first.');
    db().transaction(() => {
      db().run(
        `UPDATE assignments SET status = 'Active', target_departments = ?, recipient_roles = ?, selection_summary = ?, updated_at = ? WHERE id = ?`,
        [...new Set(recipients.map((r) => r.department).filter(Boolean))].sort().join(',') || null,
        [...new Set(recipients.map((r) => r.role))].sort().join(',') || null,
        describeSelection(parseSelector(req.body.recipients), recipients),
        nowIso(),
        a.id,
      );
      recordEvent('assignment', a.id, req.user!.id, 'activated', { from: 'Draft', to: 'Active' });
      insertRecipients(a, recipients.map((r) => r.id), req.user!.id);
      notifyAssigned(a, recipients.map((r) => r.id));
    });
    audit(req, 'assignment.activated', 'assignment', a.id, { recipients: recipients.length });
    ok(res, { ...mapAssignment(getAssignment(a.id)), stats: recipientStats(a.id) }, { message: `Task ${a.id} assigned to ${recipients.length} recipient(s).` });
  }),
);

router.patch(
  '/assignments/:id',
  deanOnly,
  route((req, res) => {
    const a = getAssignment(req.params.id);
    if (a.status !== 'Draft') throw conflict('Instructions are locked once a task is assigned. Use deadline changes or cancellation instead.');
    const data = readAssignment(req.body);
    db().run(
      `UPDATE assignments SET title = ?, description = ?, category = ?, priority = ?, start_at = ?, due_at = ?, expected_outcome = ?, instructions = ?, requires_evidence = ?, is_confidential = ?, updated_at = ? WHERE id = ?`,
      data.title,
      data.description,
      data.category,
      data.priority,
      data.startAt,
      data.dueAt,
      data.expectedOutcome ?? null,
      data.instructions ?? null,
      data.requiresEvidence,
      data.isConfidential,
      nowIso(),
      a.id,
    );
    recordEvent('assignment', a.id, req.user!.id, 'draft_updated');
    audit(req, 'assignment.draft_updated', 'assignment', a.id);
    ok(res, mapAssignment(getAssignment(a.id)), { message: 'Draft updated.' });
  }),
);

router.post(
  '/assignments/:id/cancel',
  deanOnly,
  route((req, res) => {
    const v = new Validator(req.body);
    const reason = v.string('reason', { min: 5, max: 1000, label: 'Reason' });
    v.done();
    const a = getAssignment(req.params.id);
    if (a.status === 'Cancelled') throw conflict('Task is already cancelled.');
    db().transaction(() => {
      const now = nowIso();
      const open = db().all<any>(`SELECT id, user_id, status FROM assignment_recipients WHERE assignment_id = ? AND status NOT IN ('Completed','Cancelled')`, a.id);
      db().run(`UPDATE assignments SET status = 'Cancelled', updated_at = ? WHERE id = ?`, now, a.id);
      for (const r of open) {
        db().run(`UPDATE assignment_recipients SET status = 'Cancelled', updated_at = ?, version = version + 1 WHERE id = ?`, now, r.id);
        recordEvent('assignment_recipient', r.id, req.user!.id, 'cancelled', { from: r.status, to: 'Cancelled', note: reason });
      }
      recordEvent('assignment', a.id, req.user!.id, 'cancelled', { from: a.status, to: 'Cancelled', note: reason });
      notify(
        open.map((r) => r.user_id),
        { eventType: 'assignment.cancelled', title: `Task cancelled: ${a.title}`, message: reason!, entityType: 'assignment', entityId: a.id, link: '/tasks', dedupeKey: `assignment.cancelled:${a.id}` },
      );
    });
    audit(req, 'assignment.cancelled', 'assignment', a.id, { reason });
    ok(res, mapAssignment(getAssignment(a.id)), { message: `Task ${a.id} cancelled.` });
  }),
);

/** Replace one recipient with another (keeps the original row and its history as Cancelled). */
router.post(
  '/assignments/:id/reassign',
  deanOnly,
  route((req, res) => {
    const v = new Validator(req.body);
    const fromRecipientId = v.string('recipientId', { max: 80, label: 'Current recipient' });
    const toUserId = v.string('toUserId', { max: 80, label: 'New assignee' });
    const reason = v.string('reason', { min: 5, max: 1000, label: 'Reason' });
    v.done();
    const a = getAssignment(req.params.id);
    if (a.status !== 'Active') throw conflict('Only active tasks can be reassigned.');
    const target = resolveRecipients({ userIds: [toUserId!] })[0];
    db().transaction(() => {
      const r = db().get<any>('SELECT * FROM assignment_recipients WHERE id = ? AND assignment_id = ?', fromRecipientId, a.id);
      if (!r) throw notFound('Recipient');
      if (['Completed', 'Cancelled'].includes(r.status)) throw conflict(`Recipient task is already ${r.status.toLowerCase()}.`);
      if (db().get('SELECT 1 FROM assignment_recipients WHERE assignment_id = ? AND user_id = ?', a.id, target.id)) throw conflict(`${target.name} already has this task.`);
      const now = nowIso();
      db().run(`UPDATE assignment_recipients SET status = 'Cancelled', updated_at = ?, version = version + 1 WHERE id = ?`, now, r.id);
      recordEvent('assignment_recipient', r.id, req.user!.id, 'reassigned_away', { from: r.status, to: 'Cancelled', note: `To ${target.name}: ${reason}` });
      insertRecipients({ ...a, due_at: r.due_at }, [target.id], req.user!.id);
      notify([r.user_id], { eventType: 'assignment.reassigned', title: `Task reassigned: ${a.title}`, message: reason!, entityType: 'assignment', entityId: a.id, link: '/tasks' });
      notifyAssigned({ ...a, due_at: r.due_at }, [target.id]);
    });
    audit(req, 'assignment.reassigned', 'assignment', a.id, { from: fromRecipientId, to: toUserId, reason });
    ok(res, { stats: recipientStats(a.id) }, { message: `Task reassigned to ${target.name}.` });
  }),
);

router.get(
  '/assignments',
  route((req, res) => {
    const u = req.user!;
    if (isDean(u)) {
      // Filters: department, recipient (user id), recipient role, priority, status.
      const department = String(req.query.department || '');
      const recipientId = String(req.query.recipientId || '');
      const role = String(req.query.role || '');
      const priority = String(req.query.priority || '');
      const status = String(req.query.status || '');
      const where: string[] = [];
      const params: unknown[] = [];
      if (priority) {
        where.push('a.priority = ?');
        params.push(priority);
      }
      if (status) {
        where.push('a.status = ?');
        params.push(status);
      }
      if (department) {
        where.push(`EXISTS (SELECT 1 FROM assignment_recipients ar JOIN users ru ON ru.id = ar.user_id WHERE ar.assignment_id = a.id AND ru.department_code = ?)`);
        params.push(department);
      }
      if (role) {
        where.push(`EXISTS (SELECT 1 FROM assignment_recipients ar JOIN users ru ON ru.id = ar.user_id WHERE ar.assignment_id = a.id AND ru.role = ?)`);
        params.push(role);
      }
      if (recipientId) {
        where.push(`EXISTS (SELECT 1 FROM assignment_recipients ar WHERE ar.assignment_id = a.id AND ar.user_id = ?)`);
        params.push(recipientId);
      }
      const rows = db().all<any>(
        `SELECT ${ASSIGNMENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY CASE a.status WHEN 'Active' THEN 0 WHEN 'Draft' THEN 1 ELSE 2 END, a.due_at`,
        ...params,
      );
      return ok(
        res,
        rows.map((a) => ({ ...mapAssignment(a), stats: recipientStats(a.id) })),
      );
    }
    // HOD / Adviser: only their own task rows (confidential tasks are only visible to recipients anyway).
    const rows = db().all<any>(
      `SELECT ${TASK_SELECT}
       WHERE ar.user_id = ? AND a.status != 'Draft' ORDER BY CASE WHEN ar.status IN ('Completed','Cancelled') THEN 1 ELSE 0 END, ar.due_at`,
      u.id,
    );
    ok(
      res,
      rows.map((r) => ({
        ...mapRecipient(r),
        title: r.title,
        category: r.category,
        priority: r.priority,
        assignmentStatus: r.assignment_status,
        requiresEvidence: r.requires_evidence === 1,
        isConfidential: r.is_confidential === 1,
      })),
    );
  }),
);

router.get(
  '/assignments/:id',
  route((req, res) => {
    const u = req.user!;
    const a = getAssignment(req.params.id);
    if (isDean(u)) {
      const recipients = db().all(`SELECT ${RECIPIENT_SELECT} WHERE ar.assignment_id = ? ORDER BY u.role, u.department_code, u.name`, a.id).map((r) => mapRecipient(r, true));
      return ok(res, { ...mapAssignment(a), stats: recipientStats(a.id), recipients, history: getEvents('assignment', a.id).map((e) => ({ ...e, note: e.action.includes('created') ? null : e.note })) });
    }
    const mine = db().get<any>(`SELECT ${RECIPIENT_SELECT} WHERE ar.assignment_id = ? AND ar.user_id = ?`, a.id, u.id);
    if (!mine || a.status === 'Draft') throw notFound('Assignment');
    ok(res, { ...mapAssignment(a), myTask: mapRecipient(mine, true) });
  }),
);

// ---- Recipient actions -----------------------------------------------------
function getRecipient(id: string) {
  const r = db().get<any>(`SELECT ${TASK_SELECT} WHERE ar.id = ?`, id);
  if (!r) throw notFound('Task');
  return r;
}

function ownRecipient(user: AuthUser, id: string) {
  const r = getRecipient(id);
  if (r.user_id !== user.id) throw notFound('Task');
  if (r.assignment_status !== 'Active') throw conflict('This task is no longer active.');
  return r;
}

function checkVersion(r: any, body: any) {
  if (body?.expectedVersion !== undefined && Number(body.expectedVersion) !== r.version) {
    throw conflict('This task was updated by someone else. Reload to see the latest version.', { currentVersion: r.version });
  }
}

function transition(user: AuthUser, r: any, to: string, action: string, note: string | null | undefined, extraSql = '', ...extraParams: unknown[]) {
  const now = nowIso();
  db().run(`UPDATE assignment_recipients SET status = ?, updated_at = ?, version = version + 1${extraSql} WHERE id = ?`, to, now, ...extraParams, r.id);
  recordEvent('assignment_recipient', r.id, user.id, action, { from: r.status, to, note: note ?? null });
}

router.post(
  '/tasks/:rid/acknowledge',
  route((req, res) => {
    const r = ownRecipient(req.user!, req.params.rid);
    if (r.status !== 'Assigned') throw conflict(`Task is already "${r.status}".`);
    transition(req.user!, r, 'Acknowledged', 'acknowledged', null, ', acknowledged_at = ?', nowIso());
    notify([r.created_by], {
      eventType: 'assignment.acknowledged',
      title: `${req.user!.name} acknowledged "${r.title}"`,
      message: `${req.user!.role}${req.user!.departmentCode ? ` · ${req.user!.departmentCode}` : ''}`,
      entityType: 'assignment',
      entityId: r.assignment_id,
      link: '/dean/assignments',
      dedupeKey: `assignment.ack:${r.id}`,
    });
    audit(req, 'assignment.acknowledged', 'assignment_recipient', r.id);
    ok(res, mapRecipient(getRecipient(r.id), true), { message: 'Task acknowledged.' });
  }),
);

router.post(
  '/tasks/:rid/progress',
  route((req, res) => {
    const r = ownRecipient(req.user!, req.params.rid);
    checkVersion(r, req.body);
    const v = new Validator(req.body);
    const pct = v.int('progressPct', { min: 0, max: 100, label: 'Progress' });
    const note = v.string('note', { min: 3, max: 2000, label: 'Progress note' });
    v.done();
    if (!['Assigned', 'Acknowledged', 'In Progress', 'Revision Requested'].includes(r.status)) throw conflict(`Progress cannot be updated while the task is "${r.status}".`);
    if (pct === 100) throw badRequest('Use "Submit for review" to complete the task.');
    transition(req.user!, r, 'In Progress', 'progress_update', `${pct}% — ${note}`, ', progress_pct = ?, acknowledged_at = COALESCE(acknowledged_at, ?)', pct, nowIso());
    audit(req, 'assignment.progress', 'assignment_recipient', r.id, { pct });
    ok(res, mapRecipient(getRecipient(r.id), true), { message: 'Progress saved.' });
  }),
);

router.post(
  '/tasks/:rid/submit',
  route((req, res) => {
    const r = ownRecipient(req.user!, req.params.rid);
    checkVersion(r, req.body);
    const v = new Validator(req.body);
    const text = v.string('submissionText', { min: 10, max: 10000, label: 'Completion report' });
    v.done();
    if (!['Acknowledged', 'In Progress', 'Revision Requested', 'Assigned'].includes(r.status)) throw conflict(`A "${r.status}" task cannot be submitted.`);
    if (r.requires_evidence === 1 && !db().get(`SELECT 1 FROM attachments WHERE entity_type = 'assignment_submission' AND entity_id = ?`, r.id)) {
      throw badRequest('This task requires evidence. Attach at least one file before submitting.');
    }
    transition(req.user!, r, 'Submitted', r.status === 'Revision Requested' ? 'resubmitted' : 'submitted', text, ', submission_text = ?, submitted_at = ?, progress_pct = 100, acknowledged_at = COALESCE(acknowledged_at, ?)', text, nowIso(), nowIso());
    notify([r.created_by], {
      eventType: 'assignment.submitted',
      title: `Submitted for review: ${r.title}`,
      message: `${req.user!.name} (${req.user!.role}${req.user!.departmentCode ? `, ${req.user!.departmentCode}` : ''}) submitted the task.`,
      entityType: 'assignment',
      entityId: r.assignment_id,
      link: '/dean/assignments',
      dedupeKey: `assignment.submitted:${r.id}:${r.version}`,
    });
    audit(req, 'assignment.submitted', 'assignment_recipient', r.id);
    ok(res, mapRecipient(getRecipient(r.id), true), { message: 'Submitted to the Dean for review.' });
  }),
);

router.post(
  '/tasks/:rid/review',
  deanOnly,
  route((req, res) => {
    const r = getRecipient(req.params.rid);
    checkVersion(r, req.body);
    const v = new Validator(req.body);
    const decision = v.oneOf('decision', ['Approve', 'Revise'] as const, { label: 'Decision' });
    const comment = v.string('comment', { required: decision === 'Revise', max: 2000, label: 'Review comment' });
    v.done();
    if (r.status !== 'Submitted') throw conflict(`Only submitted work can be reviewed (current: "${r.status}").`);
    const to = decision === 'Approve' ? 'Completed' : 'Revision Requested';
    const now = nowIso();
    transition(req.user!, r, to, decision === 'Approve' ? 'approved' : 'revision_requested', comment, ', review_comment = ?, reviewed_by = ?, reviewed_at = ?, completed_at = ?', comment ?? null, req.user!.id, now, decision === 'Approve' ? now : null);
    notify([r.user_id], {
      eventType: decision === 'Approve' ? 'assignment.approved' : 'assignment.revision_requested',
      title: decision === 'Approve' ? `Approved: ${r.title}` : `Revision requested: ${r.title}`,
      message: comment || 'The Dean approved your submission.',
      entityType: 'assignment',
      entityId: r.assignment_id,
      link: '/tasks',
      severity: decision === 'Approve' ? 'success' : 'warning',
      dedupeKey: `assignment.review:${r.id}:${r.version}`,
    });
    audit(req, `assignment.${decision === 'Approve' ? 'approved' : 'revision_requested'}`, 'assignment_recipient', r.id, { comment });
    ok(res, mapRecipient(getRecipient(r.id), true), { message: decision === 'Approve' ? 'Work approved.' : 'Revision requested.' });
  }),
);

router.post(
  '/tasks/:rid/deadline',
  deanOnly,
  route((req, res) => {
    const r = getRecipient(req.params.rid);
    const v = new Validator(req.body);
    const dueAt = v.dateTime('dueAt', { label: 'New due date' });
    const reason = v.string('reason', { min: 5, max: 1000, label: 'Reason' });
    v.done();
    if (['Completed', 'Cancelled'].includes(r.status)) throw conflict(`Task is ${r.status.toLowerCase()}.`);
    if (dueAt! < nowIso()) throw badRequest('The new deadline is in the past.');
    db().run('UPDATE assignment_recipients SET due_at = ?, updated_at = ?, version = version + 1 WHERE id = ?', dueAt, nowIso(), r.id);
    recordEvent('assignment_recipient', r.id, req.user!.id, 'deadline_changed', { note: `${fmtDateTime(r.due_at)} → ${fmtDateTime(dueAt)}: ${reason}` });
    notify([r.user_id], { eventType: 'assignment.deadline_changed', title: `Deadline changed: ${r.title}`, message: `New deadline ${fmtDateTime(dueAt)}. ${reason}`, entityType: 'assignment', entityId: r.assignment_id, link: '/tasks' });
    audit(req, 'assignment.deadline_changed', 'assignment_recipient', r.id, { from: r.due_at, to: dueAt, reason });
    ok(res, mapRecipient(getRecipient(r.id), true), { message: 'Deadline updated.' });
  }),
);

router.post(
  '/tasks/:rid/reopen',
  deanOnly,
  route((req, res) => {
    const r = getRecipient(req.params.rid);
    const v = new Validator(req.body);
    const reason = v.string('reason', { min: 5, max: 1000, label: 'Reason' });
    v.done();
    if (r.status !== 'Completed') throw conflict('Only completed work can be reopened.');
    transition(req.user!, r, 'Revision Requested', 'reopened', reason, ', completed_at = NULL, review_comment = ?', reason);
    notify([r.user_id], { eventType: 'assignment.revision_requested', title: `Reopened: ${r.title}`, message: reason!, entityType: 'assignment', entityId: r.assignment_id, link: '/tasks', severity: 'warning' });
    audit(req, 'assignment.reopened', 'assignment_recipient', r.id, { reason });
    ok(res, mapRecipient(getRecipient(r.id), true), { message: 'Task reopened for revision.' });
  }),
);

// ===========================================================================
// SCHEDULES & CALENDAR
// ===========================================================================
export const SCHEDULE_CATEGORIES = ['HOD Meeting', 'Adviser Meeting', 'Department Progress Review', 'Academic Performance Review', 'Student Support Review', 'Study Session Monitoring', 'Report Deadline', 'Follow-up Meeting', 'Other'] as const;

const SCHEDULE_SELECT = `sc.*, u.name AS organizer_name FROM schedules sc JOIN users u ON u.id = sc.organizer_id`;

function participants(scheduleId: string) {
  return db()
    .all<any>(
      `SELECT sp.*, u.name, u.role, u.department_code FROM schedule_participants sp JOIN users u ON u.id = sp.user_id WHERE sp.schedule_id = ? ORDER BY u.role, u.department_code, u.name`,
      scheduleId,
    )
    .map((p) => ({ userId: p.user_id, name: p.name, role: p.role, department: p.department_code, response: p.response, responseNote: p.response_note, respondedAt: p.responded_at ? fmtDateTime(p.responded_at) : null }));
}

function mapSchedule(s: any, withDetail = false) {
  const parts = participants(s.id);
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    category: s.category,
    startAt: s.start_at,
    endAt: s.end_at,
    startDisplay: fmtDateTime(s.start_at),
    endDisplay: fmtDateTime(s.end_at),
    location: s.location,
    department: s.department_code,
    studySessionId: s.study_session_id,
    instructions: s.instructions,
    requiresAck: s.requires_ack === 1,
    reminderMinutes: s.reminder_minutes,
    status: s.status,
    conflictOverrideReason: s.conflict_override_reason,
    organizer: s.organizer_name,
    participantCount: parts.length,
    acknowledged: parts.filter((p) => p.response === 'Acknowledged').length,
    declined: parts.filter((p) => p.response === 'Declined').length,
    pending: parts.filter((p) => p.response === 'Pending').length,
    isPast: s.end_at < nowIso(),
    participants: withDetail ? parts : undefined,
    history: withDetail ? getEvents('schedule', s.id) : undefined,
  };
}

function getSchedule(id: string) {
  const s = db().get<any>(`SELECT ${SCHEDULE_SELECT} WHERE sc.id = ?`, id);
  if (!s) throw notFound('Schedule');
  return s;
}

function findConflicts(userIds: string[], startAt: string, endAt: string, ignoreId?: string) {
  if (!userIds.length) return [];
  const l = inList(userIds);
  return db()
    .all<any>(
      `SELECT sc.id, sc.title, sc.start_at, sc.end_at, u.id AS user_id, u.name FROM schedule_participants sp
       JOIN schedules sc ON sc.id = sp.schedule_id JOIN users u ON u.id = sp.user_id
       WHERE sc.status IN ('Scheduled','Rescheduled') AND sc.id != ? AND sc.start_at < ? AND sc.end_at > ? AND sp.user_id IN ${l.sql}`,
      ignoreId ?? '',
      endAt,
      startAt,
      ...l.params,
    )
    .map((c) => ({ scheduleId: c.id, title: c.title, participant: c.name, participantId: c.user_id, when: `${fmtDateTime(c.start_at)} – ${fmtDateTime(c.end_at)}` }));
}

function readSchedule(body: any) {
  const v = new Validator(body);
  const out = {
    title: v.string('title', { min: 3, max: 200, label: 'Title' }),
    description: v.string('description', { required: false, max: 3000 }),
    category: v.oneOf('category', SCHEDULE_CATEGORIES, { label: 'Activity category' }),
    startAt: v.dateTime('startAt', { label: 'Start' }),
    endAt: v.dateTime('endAt', { label: 'End' }),
    location: v.string('location', { required: false, max: 300, label: 'Location / meeting link' }),
    department: v.string('department', { required: false, max: 20 }),
    studySessionId: v.string('studySessionId', { required: false, max: 80 }),
    instructions: v.string('instructions', { required: false, max: 3000 }),
    requiresAck: v.bool('requiresAck', true),
    reminderMinutes: v.int('reminderMinutes', { required: false, min: 5, max: 10080, label: 'Reminder' }),
    overrideReason: v.string('overrideReason', { required: false, max: 500 }),
  };
  v.done();
  if (out.endAt! <= out.startAt!) throw badRequest('End time must be after the start time.', { fields: { endAt: 'End must be after start.' } });
  if (out.department && !db().get('SELECT 1 FROM departments WHERE code = ?', out.department)) throw badRequest('Unknown department.');
  if (out.studySessionId && !db().get('SELECT 1 FROM study_sessions WHERE id = ?', out.studySessionId)) throw badRequest('Unknown study session.');
  return out;
}

function notifySchedule(s: any, userIds: string[], kind: 'created' | 'changed' | 'cancelled', note?: string) {
  const title = kind === 'created' ? `Scheduled: ${s.title}` : kind === 'changed' ? `Schedule changed: ${s.title}` : `Cancelled: ${s.title}`;
  notify(userIds, {
    eventType: `schedule.${kind}`,
    title,
    message: `${fmtDateTime(s.start_at)}${s.location ? ` · ${s.location}` : ''}${note ? ` — ${note}` : ''}`,
    entityType: 'schedule',
    entityId: s.id,
    link: '/schedule',
    severity: kind === 'cancelled' ? 'warning' : 'info',
    dedupeKey: `schedule.${kind}:${s.id}:${s.updated_at}`,
  });
}

router.post(
  '/schedules',
  deanOnly,
  route((req, res) => {
    const data = readSchedule(req.body);
    if (data.startAt! < nowIso()) throw badRequest('The activity cannot start in the past.');
    const recipients = resolveRecipients(parseSelector(req.body.participants));
    assertConfirmed(recipients, req.body.confirmCount);
    const ids = recipients.map((r) => r.id);
    const conflicts = findConflicts(ids, data.startAt!, data.endAt!);
    if (conflicts.length && !data.overrideReason) throw conflict('Some participants already have an overlapping activity.', { conflicts });
    const id = db().transaction(() => {
      const newId = nextCode('SCH');
      const now = nowIso();
      db().run(
        `INSERT INTO schedules (id, title, description, category, start_at, end_at, location, department_code, study_session_id, instructions, requires_ack, reminder_minutes, status, conflict_override_reason, organizer_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?, ?, ?)`,
        newId,
        data.title,
        data.description ?? null,
        data.category,
        data.startAt,
        data.endAt,
        data.location ?? null,
        data.department ?? null,
        data.studySessionId ?? null,
        data.instructions ?? null,
        data.requiresAck,
        data.reminderMinutes ?? null,
        conflicts.length ? data.overrideReason : null,
        req.user!.id,
        now,
        now,
      );
      for (const uidv of ids) db().run(`INSERT INTO schedule_participants (schedule_id, user_id) VALUES (?, ?)`, newId, uidv);
      recordEvent('schedule', newId, req.user!.id, 'created', { to: 'Scheduled', note: conflicts.length ? `Conflict override: ${data.overrideReason}` : undefined });
      notifySchedule(getSchedule(newId), ids, 'created');
      return newId;
    });
    audit(req, 'schedule.created', 'schedule', id, { participants: ids.length, overrides: conflicts.length });
    created(res, mapSchedule(getSchedule(id), true), `Activity ${id} scheduled for ${ids.length} participant(s).`);
  }),
);

router.patch(
  '/schedules/:id',
  deanOnly,
  route((req, res) => {
    const s = getSchedule(req.params.id);
    if (['Cancelled', 'Completed'].includes(s.status)) throw conflict(`A ${s.status.toLowerCase()} activity cannot be edited.`);
    const data = readSchedule(req.body);
    const v = new Validator(req.body);
    const reason = v.string('changeReason', { required: false, max: 500 });
    v.done();
    const timeChanged = data.startAt !== s.start_at || data.endAt !== s.end_at;
    if (timeChanged && data.startAt! < nowIso()) throw badRequest('The activity cannot be moved into the past.');
    if (timeChanged && !reason) throw badRequest('Give a reason for rescheduling.', { fields: { changeReason: 'Reason is required when the time changes.' } });
    const recipients = req.body.participants ? resolveRecipients(parseSelector(req.body.participants)) : null;
    if (recipients) assertConfirmed(recipients, req.body.confirmCount);
    const current = new Set(participants(s.id).map((p) => p.userId));
    const nextIds = recipients ? recipients.map((r) => r.id) : [...current];
    const conflicts = findConflicts(nextIds, data.startAt!, data.endAt!, s.id);
    if (conflicts.length && !data.overrideReason) throw conflict('Some participants already have an overlapping activity.', { conflicts });
    db().transaction(() => {
      const now = nowIso();
      db().run(
        `UPDATE schedules SET title = ?, description = ?, category = ?, start_at = ?, end_at = ?, location = ?, department_code = ?, study_session_id = ?, instructions = ?, requires_ack = ?, reminder_minutes = ?,
           status = ?, conflict_override_reason = COALESCE(?, conflict_override_reason), updated_at = ? WHERE id = ?`,
        data.title,
        data.description ?? null,
        data.category,
        data.startAt,
        data.endAt,
        data.location ?? null,
        data.department ?? null,
        data.studySessionId ?? null,
        data.instructions ?? null,
        data.requiresAck,
        data.reminderMinutes ?? null,
        timeChanged ? 'Rescheduled' : s.status,
        conflicts.length ? data.overrideReason : null,
        now,
        s.id,
      );
      const added = nextIds.filter((x) => !current.has(x));
      const removed = [...current].filter((x) => !nextIds.includes(x));
      for (const a of added) db().run('INSERT INTO schedule_participants (schedule_id, user_id) VALUES (?, ?)', s.id, a);
      for (const r of removed) db().run('DELETE FROM schedule_participants WHERE schedule_id = ? AND user_id = ?', s.id, r);
      if (timeChanged) db().run(`UPDATE schedule_participants SET response = 'Pending', response_note = NULL, responded_at = NULL WHERE schedule_id = ?`, s.id);
      recordEvent('schedule', s.id, req.user!.id, timeChanged ? 'rescheduled' : 'updated', {
        from: s.status,
        to: timeChanged ? 'Rescheduled' : s.status,
        note: [timeChanged && `${fmtDateTime(s.start_at)} → ${fmtDateTime(data.startAt)}`, reason, added.length && `${added.length} added`, removed.length && `${removed.length} removed`].filter(Boolean).join(' · ') || undefined,
      });
      const updated = getSchedule(s.id);
      notifySchedule(updated, nextIds.filter((x) => !added.includes(x)), 'changed', reason);
      notifySchedule(updated, added, 'created');
      if (removed.length) notifySchedule(updated, removed, 'cancelled', 'You were removed from this activity.');
    });
    audit(req, 'schedule.updated', 'schedule', s.id, { timeChanged, reason });
    ok(res, mapSchedule(getSchedule(s.id), true), { message: timeChanged ? 'Activity rescheduled; participants were notified.' : 'Activity updated.' });
  }),
);

router.post(
  '/schedules/:id/cancel',
  deanOnly,
  route((req, res) => {
    const v = new Validator(req.body);
    const reason = v.string('reason', { min: 5, max: 1000, label: 'Reason' });
    v.done();
    const s = getSchedule(req.params.id);
    if (['Cancelled', 'Completed'].includes(s.status)) throw conflict(`Activity is already ${s.status.toLowerCase()}.`);
    db().transaction(() => {
      db().run(`UPDATE schedules SET status = 'Cancelled', updated_at = ? WHERE id = ?`, nowIso(), s.id);
      recordEvent('schedule', s.id, req.user!.id, 'cancelled', { from: s.status, to: 'Cancelled', note: reason });
      notifySchedule(getSchedule(s.id), participants(s.id).map((p) => p.userId), 'cancelled', reason);
    });
    audit(req, 'schedule.cancelled', 'schedule', s.id, { reason });
    ok(res, mapSchedule(getSchedule(s.id), true), { message: 'Activity cancelled; participants were notified.' });
  }),
);

router.post(
  '/schedules/:id/complete',
  deanOnly,
  route((req, res) => {
    const v = new Validator(req.body);
    const note = v.string('note', { required: false, max: 2000 });
    v.done();
    const s = getSchedule(req.params.id);
    if (!['Scheduled', 'Rescheduled'].includes(s.status)) throw conflict(`Activity is ${s.status.toLowerCase()}.`);
    if (s.start_at > nowIso()) throw conflict('An activity cannot be completed before it starts.');
    db().run(`UPDATE schedules SET status = 'Completed', updated_at = ? WHERE id = ?`, nowIso(), s.id);
    recordEvent('schedule', s.id, req.user!.id, 'completed', { from: s.status, to: 'Completed', note });
    audit(req, 'schedule.completed', 'schedule', s.id);
    ok(res, mapSchedule(getSchedule(s.id), true), { message: 'Activity marked completed.' });
  }),
);

router.post(
  '/schedules/:id/respond',
  route((req, res) => {
    const s = getSchedule(req.params.id);
    const p = db().get<any>('SELECT * FROM schedule_participants WHERE schedule_id = ? AND user_id = ?', s.id, req.user!.id);
    if (!p) throw notFound('Schedule');
    if (['Cancelled', 'Completed'].includes(s.status)) throw conflict(`This activity is ${s.status.toLowerCase()}.`);
    const v = new Validator(req.body);
    const response = v.oneOf('response', ['Acknowledged', 'Declined'] as const, { label: 'Response' });
    const note = v.string('note', { required: response === 'Declined', max: 500, label: 'Note' });
    v.done();
    db().run('UPDATE schedule_participants SET response = ?, response_note = ?, responded_at = ? WHERE schedule_id = ? AND user_id = ?', response, note ?? null, nowIso(), s.id, req.user!.id);
    recordEvent('schedule', s.id, req.user!.id, response === 'Acknowledged' ? 'acknowledged' : 'declined', { note });
    if (response === 'Declined') {
      notify([s.organizer_id], {
        eventType: 'schedule.declined',
        title: `${req.user!.name} declined "${s.title}"`,
        message: note!,
        entityType: 'schedule',
        entityId: s.id,
        link: '/dean/schedule',
        severity: 'warning',
      });
    }
    audit(req, `schedule.${response!.toLowerCase()}`, 'schedule', s.id);
    ok(res, mapSchedule(getSchedule(s.id), true), { message: `Response recorded: ${response}.` });
  }),
);

router.get(
  '/schedules',
  route((req, res) => {
    const u = req.user!;
    const from = req.query.from ? dayStartIso(String(req.query.from)) : '0000';
    const to = req.query.to ? dayEndIso(String(req.query.to)) : '9999';
    const where = ['sc.end_at >= ?', 'sc.start_at <= ?'];
    const params: unknown[] = [from, to];
    if (!isDean(u)) {
      where.push('EXISTS (SELECT 1 FROM schedule_participants sp WHERE sp.schedule_id = sc.id AND sp.user_id = ?)');
      params.push(u.id);
    } else {
      if (req.query.participant) {
        where.push('EXISTS (SELECT 1 FROM schedule_participants sp WHERE sp.schedule_id = sc.id AND sp.user_id = ?)');
        params.push(String(req.query.participant));
      }
      if (req.query.department) {
        where.push('(sc.department_code = ? OR EXISTS (SELECT 1 FROM schedule_participants sp JOIN users pu ON pu.id = sp.user_id WHERE sp.schedule_id = sc.id AND pu.department_code = ?))');
        params.push(String(req.query.department), String(req.query.department));
      }
    }
    if (req.query.category) {
      where.push('sc.category = ?');
      params.push(String(req.query.category));
    }
    if (req.query.status) {
      const l = inList(String(req.query.status).split(','));
      where.push(`sc.status IN ${l.sql}`);
      params.push(...l.params);
    }
    const rows = db().all<any>(`SELECT ${SCHEDULE_SELECT} WHERE ${where.join(' AND ')} ORDER BY sc.start_at`, ...params);
    ok(
      res,
      rows.map((s) => {
        const m = mapSchedule(s);
        if (isDean(u)) return m;
        const mine = db().get<any>('SELECT response, response_note FROM schedule_participants WHERE schedule_id = ? AND user_id = ?', s.id, u.id);
        return { ...m, myResponse: mine?.response, myResponseNote: mine?.response_note };
      }),
    );
  }),
);

router.get(
  '/schedules/:id',
  route((req, res) => {
    const s = getSchedule(req.params.id);
    if (!isDean(req.user!) && !db().get('SELECT 1 FROM schedule_participants WHERE schedule_id = ? AND user_id = ?', s.id, req.user!.id)) throw notFound('Schedule');
    const m = mapSchedule(s, true);
    if (!isDean(req.user!)) {
      const mine = m.participants!.find((p) => p.userId === req.user!.id);
      return ok(res, { ...m, participants: undefined, myResponse: mine?.response, myResponseNote: mine?.responseNote });
    }
    ok(res, m);
  }),
);

router.post(
  '/schedules/conflicts',
  deanOnly,
  route((req, res) => {
    const v = new Validator(req.body);
    const startAt = v.dateTime('startAt', { label: 'Start' });
    const endAt = v.dateTime('endAt', { label: 'End' });
    const ignoreId = v.string('ignoreId', { required: false, max: 80 });
    v.done();
    const recipients = resolveRecipients(parseSelector(req.body.participants));
    ok(res, findConflicts(recipients.map((r) => r.id), startAt!, endAt!, ignoreId));
  }),
);

// ===========================================================================
// REPORT DISTRIBUTION & REQUESTS
// ===========================================================================
export const REPORT_CATEGORIES = ['Department Academic Report', 'Study Session Report', 'Attendance & Absence Report', 'Student Support Report', 'Task Progress Report', 'Department Review', 'Circular / Information', 'Other'] as const;
const OUTSTANDING = ['Distributed', 'Acknowledged', 'Revision Requested'];

const REQUEST_SELECT = `q.*, u.name AS created_by_name FROM report_requests q JOIN users u ON u.id = q.created_by`;
const RR_SELECT = `rr.*, u.name AS user_name, u.role AS user_role, u.department_code AS user_department, rv.name AS reviewed_by_name
  FROM report_recipients rr JOIN users u ON u.id = rr.user_id LEFT JOIN users rv ON rv.id = rr.reviewed_by`;
/** Recipient response joined with its parent request. */
const RESPONSE_SELECT = `rr.*, u.name AS user_name, u.role AS user_role, u.department_code AS user_department, rv.name AS reviewed_by_name,
  q.title, q.category, q.message, q.deadline_at, q.requires_submission, q.status AS request_status, q.created_by
  FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id
  JOIN users u ON u.id = rr.user_id LEFT JOIN users rv ON rv.id = rr.reviewed_by`;

function getRequest(id: string) {
  const q = db().get<any>(`SELECT ${REQUEST_SELECT} WHERE q.id = ?`, id);
  if (!q) throw notFound('Report request');
  return q;
}

function mapRR(r: any, deadline: string | null, withHistory = false) {
  return {
    id: r.id,
    requestId: r.request_id,
    userId: r.user_id,
    name: r.user_name,
    role: r.user_role,
    department: r.user_department,
    status: r.status,
    isOverdue: !!deadline && OUTSTANDING.includes(r.status) && deadline < nowIso(),
    acknowledgedAt: r.acknowledged_at ? fmtDateTime(r.acknowledged_at) : null,
    submittedAt: r.submitted_at ? fmtDateTime(r.submitted_at) : null,
    submissionText: r.submission_text,
    reviewComment: r.review_comment,
    reviewedBy: r.reviewed_by_name,
    reviewedAt: r.reviewed_at ? fmtDateTime(r.reviewed_at) : null,
    submissionCount: r.submission_count,
    lastRemindedAt: r.last_reminded_at ? fmtDateTime(r.last_reminded_at) : null,
    history: withHistory ? getEvents('report_recipient', r.id) : undefined,
  };
}

function mapRequest(q: any) {
  const rows = db().all<any>('SELECT status FROM report_recipients WHERE request_id = ?', q.id);
  const tally: Record<string, number> = {};
  rows.forEach((r) => (tally[r.status] = (tally[r.status] || 0) + 1));
  return {
    id: q.id,
    title: q.title,
    message: q.message,
    category: q.category,
    periodFrom: q.period_from,
    periodTo: q.period_to,
    deadlineAt: q.deadline_at,
    deadlineDisplay: q.deadline_at ? fmtDateTime(q.deadline_at) : null,
    requiresSubmission: q.requires_submission === 1,
    status: q.status,
    createdBy: q.created_by_name,
    createdAt: fmtDateTime(q.created_at),
    distributedAt: q.distributed_at ? fmtDateTime(q.distributed_at) : null,
    generatedReport: parseJson(q.generated_report_json, null),
    stats: {
      total: rows.length,
      byStatus: tally,
      outstanding: rows.filter((r) => (q.requires_submission === 1 ? OUTSTANDING.includes(r.status) : r.status === 'Distributed')).length,
      accepted: tally.Accepted || 0,
      overdue: q.deadline_at && q.deadline_at < nowIso() ? rows.filter((r) => OUTSTANDING.includes(r.status)).length : 0,
    },
  };
}

function distribute(q: any, userIds: string[], actorId: string) {
  const now = nowIso();
  for (const userId of userIds) {
    const rid = uid('rrc');
    db().run(`INSERT INTO report_recipients (id, request_id, user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'Distributed', ?, ?)`, rid, q.id, userId, now, now);
    recordEvent('report_recipient', rid, actorId, 'distributed', { to: 'Distributed' });
  }
  db().run(`UPDATE report_requests SET status = 'Distributed', distributed_at = ?, updated_at = ? WHERE id = ?`, now, now, q.id);
  recordEvent('report_request', q.id, actorId, 'distributed', { from: q.status, to: 'Distributed', note: `${userIds.length} recipient(s)` });
  notify(userIds, {
    eventType: 'report.distributed',
    title: q.requires_submission ? `Report requested: ${q.title}` : `Report shared: ${q.title}`,
    message: q.deadline_at ? `Submission due ${fmtDateTime(q.deadline_at)}.` : q.message.slice(0, 140),
    entityType: 'report_request',
    entityId: q.id,
    link: '/report-requests',
    dedupeKey: `report.distributed:${q.id}`,
  });
}

router.post(
  '/report-requests',
  deanOnly,
  route((req, res) => {
    const v = new Validator(req.body);
    const title = v.string('title', { min: 3, max: 200, label: 'Title' });
    const message = v.string('message', { min: 5, max: 5000, label: 'Message / instructions' });
    const category = v.oneOf('category', REPORT_CATEGORIES, { label: 'Report category' });
    const periodFrom = v.date('periodFrom', { required: false, label: 'Period start' });
    const periodTo = v.date('periodTo', { required: false, label: 'Period end' });
    const deadlineAt = v.dateTime('deadlineAt', { required: false, label: 'Submission deadline' });
    const requiresSubmission = v.bool('requiresSubmission', true);
    const generatedType = v.oneOf('generatedReportType', REPORT_TYPES, { required: false, label: 'Attached report' });
    const asDraft = req.body?.status === 'Draft';
    v.done();
    if (periodFrom && periodTo && periodTo < periodFrom) throw badRequest('Period end must be on or after the start.');
    if (requiresSubmission && !deadlineAt) throw badRequest('Set a submission deadline when a report is required.', { fields: { deadlineAt: 'Deadline is required.' } });
    if (deadlineAt && deadlineAt < nowIso()) throw badRequest('The deadline is already in the past.');
    const recipients = resolveRecipients(parseSelector(req.body.recipients));
    if (!asDraft) assertConfirmed(recipients, req.body.confirmCount);
    // Attached reports are aggregate-only (no individual student rows) so they can be shared across departments.
    const snapshot = generatedType ? generateReport(req.user!, generatedType, { from: periodFrom, to: periodTo, aggregateOnly: true }) : null;
    const id = db().transaction(() => {
      const newId = nextCode('RPT');
      const now = nowIso();
      db().run(
        `INSERT INTO report_requests (id, title, message, category, period_from, period_to, deadline_at, requires_submission, generated_report_json, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?)`,
        newId,
        title,
        message,
        category,
        periodFrom ?? null,
        periodTo ?? null,
        deadlineAt ?? null,
        requiresSubmission,
        snapshot ? JSON.stringify(snapshot) : null,
        req.user!.id,
        now,
        now,
      );
      recordEvent('report_request', newId, req.user!.id, 'created', { to: 'Draft', note: JSON.stringify({ recipients: recipients.map((r) => r.id) }) });
      if (!asDraft) distribute(getRequest(newId), recipients.map((r) => r.id), req.user!.id);
      return newId;
    });
    audit(req, asDraft ? 'report_request.draft' : 'report_request.distributed', 'report_request', id, { recipients: recipients.length, generatedType });
    created(res, mapRequest(getRequest(id)), asDraft ? `Draft ${id} saved.` : `${title} distributed to ${recipients.length} recipient(s).`);
  }),
);

router.post(
  '/report-requests/:id/distribute',
  deanOnly,
  route((req, res) => {
    const q = getRequest(req.params.id);
    if (q.status !== 'Draft') throw conflict('Only drafts can be distributed.');
    const recipients = resolveRecipients(parseSelector(req.body.recipients));
    assertConfirmed(recipients, req.body.confirmCount);
    if (q.deadline_at && q.deadline_at < nowIso()) throw badRequest('The deadline has passed; create a new request.');
    db().transaction(() => distribute(q, recipients.map((r) => r.id), req.user!.id));
    audit(req, 'report_request.distributed', 'report_request', q.id, { recipients: recipients.length });
    ok(res, mapRequest(getRequest(q.id)), { message: `Distributed to ${recipients.length} recipient(s).` });
  }),
);

router.post(
  '/report-requests/:id/close',
  deanOnly,
  route((req, res) => {
    const v = new Validator(req.body);
    const note = v.string('note', { required: false, max: 1000 });
    v.done();
    const q = getRequest(req.params.id);
    if (q.status !== 'Distributed') throw conflict(`A "${q.status}" request cannot be closed.`);
    db().run(`UPDATE report_requests SET status = 'Closed', closed_at = ?, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), q.id);
    recordEvent('report_request', q.id, req.user!.id, 'closed', { from: q.status, to: 'Closed', note });
    audit(req, 'report_request.closed', 'report_request', q.id);
    ok(res, mapRequest(getRequest(q.id)), { message: 'Report request closed.' });
  }),
);

router.post(
  '/report-requests/:id/remind',
  deanOnly,
  route((req, res) => {
    const q = getRequest(req.params.id);
    if (q.status !== 'Distributed') throw conflict('Reminders can only be sent for distributed requests.');
    const outstandingStatuses = q.requires_submission === 1 ? OUTSTANDING : ['Distributed'];
    const l = inList(outstandingStatuses);
    const rows = db().all<any>(`SELECT id, user_id FROM report_recipients WHERE request_id = ? AND status IN ${l.sql}`, q.id, ...l.params);
    if (!rows.length) throw conflict('Everyone has already responded.');
    const day = nowIso().slice(0, 10);
    const sent = notify(
      rows.map((r) => r.user_id),
      {
        eventType: 'report.reminder',
        title: `Reminder: ${q.title}`,
        message: q.deadline_at ? `Due ${fmtDateTime(q.deadline_at)}.` : 'Please respond to this report request.',
        entityType: 'report_request',
        entityId: q.id,
        link: '/report-requests',
        severity: 'warning',
        dedupeKey: `report.reminder:${q.id}:${day}`,
      },
    );
    const now = nowIso();
    rows.forEach((r) => db().run('UPDATE report_recipients SET last_reminded_at = ? WHERE id = ?', now, r.id));
    recordEvent('report_request', q.id, req.user!.id, 'reminder_sent', { note: `${sent} in-app reminder(s)` });
    audit(req, 'report_request.reminded', 'report_request', q.id, { sent });
    ok(res, { sent, alreadyRemindedToday: rows.length - sent }, { message: sent ? `In-app reminder sent to ${sent} recipient(s).` : 'Reminders were already sent today.' });
  }),
);

router.get(
  '/report-requests',
  route((req, res) => {
    const u = req.user!;
    if (isDean(u)) return ok(res, db().all(`SELECT ${REQUEST_SELECT} ORDER BY q.created_at DESC`).map(mapRequest));
    const rows = db().all<any>(
      `SELECT ${RESPONSE_SELECT}
       WHERE rr.user_id = ? ORDER BY q.created_at DESC`,
      u.id,
    );
    ok(
      res,
      rows.map((r) => ({
        ...mapRR(r, r.deadline_at),
        title: r.title,
        category: r.category,
        message: r.message,
        deadlineDisplay: r.deadline_at ? fmtDateTime(r.deadline_at) : null,
        requiresSubmission: r.requires_submission === 1,
        requestStatus: r.request_status,
      })),
    );
  }),
);

router.get(
  '/report-requests/:id',
  route((req, res) => {
    const q = getRequest(req.params.id);
    if (isDean(req.user!)) {
      const recipients = db().all(`SELECT ${RR_SELECT} WHERE rr.request_id = ? ORDER BY u.role, u.department_code, u.name`, q.id).map((r) => mapRR(r, q.deadline_at, true));
      return ok(res, { ...mapRequest(q), recipients, history: getEvents('report_request', q.id).map((e) => ({ ...e, note: e.action === 'created' ? null : e.note })) });
    }
    const mine = db().get<any>(`SELECT ${RR_SELECT} WHERE rr.request_id = ? AND rr.user_id = ?`, q.id, req.user!.id);
    if (!mine) throw notFound('Report request');
    const m = mapRequest(q);
    ok(res, { ...m, stats: undefined, myResponse: mapRR(mine, q.deadline_at, true) });
  }),
);

function ownRR(user: AuthUser, id: string) {
  const r = db().get<any>(`SELECT ${RESPONSE_SELECT} WHERE rr.id = ?`, id);
  if (!r || r.user_id !== user.id) throw notFound('Report request');
  if (r.request_status !== 'Distributed') throw conflict(`This request is ${r.request_status.toLowerCase()}.`);
  return r;
}

router.post(
  '/report-responses/:rid/acknowledge',
  route((req, res) => {
    const r = ownRR(req.user!, req.params.rid);
    if (r.status !== 'Distributed') throw conflict(`Already "${r.status}".`);
    db().run(`UPDATE report_recipients SET status = 'Acknowledged', acknowledged_at = ?, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), r.id);
    recordEvent('report_recipient', r.id, req.user!.id, 'acknowledged', { from: r.status, to: 'Acknowledged' });
    notify([r.created_by], {
      eventType: 'report.acknowledged',
      title: `${req.user!.name} acknowledged "${r.title}"`,
      message: `${req.user!.role}${req.user!.departmentCode ? ` · ${req.user!.departmentCode}` : ''}`,
      entityType: 'report_request',
      entityId: r.request_id,
      link: '/dean/report-distribution',
      dedupeKey: `report.ack:${r.id}`,
    });
    audit(req, 'report.acknowledged', 'report_recipient', r.id);
    ok(res, mapRR(db().get(`SELECT ${RR_SELECT} WHERE rr.id = ?`, r.id), r.deadline_at, true), { message: 'Acknowledged.' });
  }),
);

router.post(
  '/report-responses/:rid/submit',
  route((req, res) => {
    const r = ownRR(req.user!, req.params.rid);
    if (r.requires_submission !== 1) throw conflict('This distribution does not require a submission.');
    if (!['Distributed', 'Acknowledged', 'Revision Requested'].includes(r.status)) throw conflict(`A "${r.status}" response cannot be submitted again.`);
    const v = new Validator(req.body);
    const text = v.string('submissionText', { min: 10, max: 20000, label: 'Report content' });
    v.done();
    const now = nowIso();
    db().run(
      `UPDATE report_recipients SET status = 'Submitted', submission_text = ?, submitted_at = ?, acknowledged_at = COALESCE(acknowledged_at, ?), submission_count = submission_count + 1, updated_at = ? WHERE id = ?`,
      text,
      now,
      now,
      now,
      r.id,
    );
    recordEvent('report_recipient', r.id, req.user!.id, r.status === 'Revision Requested' ? 'resubmitted' : 'submitted', { from: r.status, to: 'Submitted' });
    notify([r.created_by], {
      eventType: 'report.submitted',
      title: `Report submitted: ${r.title}`,
      message: `${req.user!.name} (${req.user!.role}${req.user!.departmentCode ? `, ${req.user!.departmentCode}` : ''})${r.deadline_at && now > r.deadline_at ? ' — after the deadline' : ''}.`,
      entityType: 'report_request',
      entityId: r.request_id,
      link: '/dean/report-distribution',
      dedupeKey: `report.submitted:${r.id}:${r.submission_count + 1}`,
    });
    audit(req, 'report.submitted', 'report_recipient', r.id);
    ok(res, mapRR(db().get(`SELECT ${RR_SELECT} WHERE rr.id = ?`, r.id), r.deadline_at, true), { message: 'Report submitted to the Dean.' });
  }),
);

router.post(
  '/report-responses/:rid/review',
  deanOnly,
  route((req, res) => {
    const r = db().get<any>(`SELECT ${RESPONSE_SELECT} WHERE rr.id = ?`, req.params.rid);
    if (!r) throw notFound('Report response');
    const v = new Validator(req.body);
    const decision = v.oneOf('decision', ['StartReview', 'Accept', 'Revise'] as const, { label: 'Decision' });
    const comment = v.string('comment', { required: decision === 'Revise', max: 3000, label: 'Review comment' });
    v.done();
    const allowedFrom = decision === 'StartReview' ? ['Submitted'] : ['Submitted', 'Under Review'];
    if (!allowedFrom.includes(r.status)) throw conflict(`Cannot ${decision === 'StartReview' ? 'start review of' : 'decide on'} a "${r.status}" response.`);
    const to = decision === 'StartReview' ? 'Under Review' : decision === 'Accept' ? 'Accepted' : 'Revision Requested';
    const now = nowIso();
    db().run(
      'UPDATE report_recipients SET status = ?, review_comment = COALESCE(?, review_comment), reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?',
      to,
      comment ?? null,
      req.user!.id,
      now,
      now,
      r.id,
    );
    recordEvent('report_recipient', r.id, req.user!.id, decision === 'StartReview' ? 'review_started' : decision === 'Accept' ? 'accepted' : 'revision_requested', { from: r.status, to, note: comment });
    if (decision !== 'StartReview') {
      notify([r.user_id], {
        eventType: decision === 'Accept' ? 'report.accepted' : 'report.revision_requested',
        title: decision === 'Accept' ? `Report accepted: ${r.title}` : `Revision requested: ${r.title}`,
        message: comment || 'The Dean accepted your report.',
        entityType: 'report_request',
        entityId: r.request_id,
        link: '/report-requests',
        severity: decision === 'Accept' ? 'success' : 'warning',
        dedupeKey: `report.review:${r.id}:${r.submission_count}:${decision}`,
      });
    }
    audit(req, `report.${to.toLowerCase().replace(/ /g, '_')}`, 'report_recipient', r.id, { comment });
    ok(res, mapRR(db().get(`SELECT ${RR_SELECT} WHERE rr.id = ?`, r.id), r.deadline_at, true), { message: `Response marked ${to}.` });
  }),
);

export default router;
