import { Router } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { badRequest, conflict, created, forbidden, notFound, ok, route } from '../lib/http';
import { audit, getEvents, notify, recordEvent, usersWithRole } from '../lib/records';
import { addDays, fmtDate, fmtDateTime, localDate, nextCode, nowIso, uid, yearLabel, dayEndIso, dayStartIso } from '../lib/util';
import { Validator } from '../lib/validate';
import {
  aoReviewEscalation,
  changeComplaintStatus,
  COMPLAINT_CATEGORIES,
  COMPLAINT_SELECT,
  getComplaintRow,
  mapComplaint,
  resolveLinkedComplaint,
  withWorkerContact,
} from '../services/complaints';

const router = Router();
router.use(requireRole('AO'));

export const WORK_ORDER_STATUSES = ['Pending', 'Assigned', 'In Progress', 'Pending Verification', 'Completed', 'Cancelled'] as const;
const OPEN_WO = `('Pending','Assigned','In Progress','Pending Verification')`;

// Allowed transitions; Completed/Cancelled are terminal.
const WO_TRANSITIONS: Record<string, string[]> = {
  Pending: ['Assigned', 'Cancelled'],
  Assigned: ['In Progress', 'Pending', 'Cancelled'],
  'In Progress': ['Pending Verification', 'Completed', 'Cancelled'],
  'Pending Verification': ['Completed', 'In Progress'],
  Completed: [],
  Cancelled: [],
};

const WO_SELECT = `
  w.*, c.student_id, s.name AS student_name, s.reg_number, s.department_code, s.year, r.room_number, u.name AS created_by_name
  FROM work_orders w
  LEFT JOIN complaints c ON c.id = w.complaint_id
  LEFT JOIN students s ON s.id = c.student_id
  LEFT JOIN rooms r ON r.id = s.room_id
  JOIN users u ON u.id = w.created_by
`;

/** Matches the AO `AOWorkOrder` UI type; overdue is derived from the target date. */
function mapWorkOrder(w: any, withHistory = false) {
  const open = !['Completed', 'Cancelled'].includes(w.status);
  return {
    id: w.id,
    ticketId: w.complaint_id || w.id,
    complaintId: w.complaint_id,
    name: w.student_name || `Raised by ${w.created_by_name}`,
    regNumber: w.reg_number || '—',
    roomNumber: w.room_number || '—',
    department: w.department_code || '—',
    year: yearLabel(w.year) || '—',
    complaintType: w.category,
    issueDescription: w.description,
    location: w.location,
    status: w.status,
    submittedDateTime: fmtDateTime(w.created_at),
    priority: w.priority,
    assignedTechnician: w.technician_name || undefined,
    technicianContact: w.technician_contact || undefined,
    remarks: w.remarks || undefined,
    completedDateTime: w.completed_at ? fmtDateTime(w.completed_at) : undefined,
    targetCompletionDate: w.target_date ? fmtDate(w.target_date) : undefined,
    targetDate: w.target_date,
    isOverdue: open && !!w.target_date && w.target_date < localDate(),
    createdBy: w.created_by_name,
    history: withHistory ? getEvents('work_order', w.id) : undefined,
  };
}

const getWorkOrder = (id: string) => {
  const w = db().get<any>(`SELECT ${WO_SELECT} WHERE w.id = ?`, id);
  if (!w) throw notFound('Work order');
  return w;
};

const ESC_SELECT = `
  e.*, s.name AS student_name, s.reg_number, r.room_number, u.name AS escalated_by_name, u.role AS escalated_by_role
  FROM escalations e LEFT JOIN students s ON s.id = e.student_id LEFT JOIN rooms r ON r.id = s.room_id JOIN users u ON u.id = e.escalated_by
`;

/** Matches the AO `AOEscalatedCase` UI type; timeline is built from recorded events. */
function mapEscalation(e: any) {
  const events = getEvents('escalation', e.id);
  const resolved = e.status === 'Resolved';
  const forwarded = e.status === 'Forwarded to Principal' || events.some((x) => x.action === 'forwarded_to_principal');
  const timeline = [
    { stage: e.source_type === 'incident' ? 'Warden Incident Logged' : 'Raised / Escalated', date: fmtDate(e.created_at), status: 'completed' as const, actor: `${e.escalated_by_name} (${e.escalated_by_role})`, note: e.reason },
    ...events
      .filter((x) => x.action !== 'escalated')
      .map((x) => ({ stage: x.action.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase()), date: fmtDate(x.createdAt), status: 'completed' as const, actor: x.actorName ? `${x.actorName} (${x.actorRole})` : undefined, note: x.note || undefined })),
    ...(resolved ? [] : [{ stage: forwarded ? 'Awaiting Principal directive' : 'AO Review', date: 'In progress', status: 'current' as const, badge: 'Current Stage' }]),
    { stage: 'Final Resolution', date: e.resolved_at ? fmtDate(e.resolved_at) : 'Pending', status: resolved ? ('completed' as const) : ('pending' as const), badge: resolved ? 'Resolved' : undefined },
  ];
  return {
    id: e.id,
    ticketId: e.source_id || e.id,
    sourceType: e.source_type,
    caseTitle: e.title,
    category: e.category,
    studentName: e.student_name || '—',
    regNumber: e.reg_number || '—',
    roomNumber: e.room_number || '—',
    location: e.location || '—',
    submittedDate: fmtDate(e.created_at),
    escalatedDate: fmtDate(e.created_at),
    urgency: e.priority === 'Critical' ? '12 hrs' : e.priority === 'High' ? '24 hrs' : '48 hrs',
    priority: e.priority,
    status: e.status,
    escalationReason: e.reason,
    description: e.description,
    authorityRef: `${e.escalated_by_role} escalation ${e.id}`,
    assignedTo: e.assigned_to_label || 'AO Office',
    timeline,
    resolutionNotes: e.resolution_notes || undefined,
    isOverdue: !resolved && Date.parse(e.created_at) < Date.now() - (e.priority === 'Critical' ? 12 : e.priority === 'High' ? 24 : 48) * 3_600_000,
  };
}

const getEscalation = (id: string) => {
  const e = db().get<any>(`SELECT ${ESC_SELECT} WHERE e.id = ?`, id);
  if (!e) throw notFound('Escalated case');
  return e;
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get(
  '/dashboard',
  route((_req, res) => {
    const c = (sql: string, ...p: unknown[]) => db().get<{ c: number }>(sql, ...p)!.c;
    const today = localDate();
    const overdueWo = c(`SELECT COUNT(*) AS c FROM work_orders WHERE status IN ${OPEN_WO} AND target_date < ?`, today);
    const escalations = db().all(`SELECT ${ESC_SELECT} WHERE e.status != 'Resolved' ORDER BY e.created_at DESC`).map(mapEscalation);
    const overdueEsc = escalations.filter((e) => e.isOverdue).length;
    const activity = db()
      .all<any>(
        `SELECT e.*, u.name AS actor_name FROM entity_events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.entity_type IN ('incident','escalation','work_order') ORDER BY e.id DESC LIMIT 10`,
      )
      .map((e) => ({
        id: String(e.id),
        action: `${e.entity_id}: ${e.action.replace(/_/g, ' ')}`,
        description: e.note || (e.to_status ? `Status: ${e.to_status}` : ''),
        entityId: e.entity_id,
        entityType: e.entity_type === 'work_order' ? 'work-order' : e.entity_type,
        timestamp: fmtDateTime(e.created_at),
        actor: e.actor_name || 'System',
        statusBadge: e.to_status || undefined,
      }));
    ok(res, {
      stats: {
        totalIncidentReports: c('SELECT COUNT(*) AS c FROM incidents'),
        pendingIncidentReviews: c(`SELECT COUNT(*) AS c FROM incidents WHERE status IN ('Pending Review','Under Investigation')`),
        escalatedCases: escalations.length,
        wardenComplaints: c(`SELECT COUNT(*) AS c FROM complaint_escalations WHERE reason = 'Complaint About Warden' AND status != 'Closed'`),
        overdueComplaints: c(`SELECT COUNT(*) AS c FROM complaint_escalations WHERE reason = 'Deadline Exceeded' AND status != 'Closed'`),
        maintenanceWorkOrders: c(`SELECT COUNT(*) AS c FROM work_orders WHERE status IN ${OPEN_WO}`),
        inProgressWorkOrders: c(`SELECT COUNT(*) AS c FROM work_orders WHERE status = 'In Progress'`),
        overdueCases: overdueWo + overdueEsc,
        overdueWorkOrders: overdueWo,
        overdueEscalations: overdueEsc,
        urgentOpen: c(`SELECT COUNT(*) AS c FROM work_orders WHERE status IN ${OPEN_WO} AND priority = 'High'`) + escalations.filter((e) => e.priority === 'Critical').length,
      },
      activities: activity,
    });
  }),
);

// ---------------------------------------------------------------------------
// Maintenance & work orders
// ---------------------------------------------------------------------------
router.get(
  '/work-orders',
  route((_req, res) => ok(res, db().all(`SELECT ${WO_SELECT} ORDER BY CASE WHEN w.status IN ${OPEN_WO} THEN 0 ELSE 1 END, w.created_at DESC`).map((w) => mapWorkOrder(w)))),
);

router.get(
  '/work-orders/:id',
  route((req, res) => ok(res, mapWorkOrder(getWorkOrder(req.params.id), true))),
);

router.post(
  '/work-orders',
  route((req, res) => {
    const v = new Validator(req.body);
    const category = v.oneOf('category', COMPLAINT_CATEGORIES, { label: 'Category' });
    const description = v.string('description', { min: 10, max: 2000, label: 'Description' });
    const location = v.string('location', { max: 200, label: 'Location' });
    const priority = v.oneOf('priority', ['Low', 'Medium', 'High'] as const, { label: 'Priority' });
    const targetDate = v.date('targetDate', { required: false, label: 'Target date' });
    v.done();
    if (targetDate && targetDate < localDate()) throw badRequest('Target date cannot be in the past.');
    const id = db().transaction(() => {
      const newId = nextCode('WO');
      const now = nowIso();
      db().run(
        `INSERT INTO work_orders (id, category, description, location, priority, status, target_date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?)`,
        newId,
        category,
        description,
        location,
        priority,
        targetDate ?? null,
        req.user!.id,
        now,
        now,
      );
      recordEvent('work_order', newId, req.user!.id, 'created', { to: 'Pending' });
      return newId;
    });
    audit(req, 'work_order.created', 'work_order', id);
    created(res, mapWorkOrder(getWorkOrder(id), true), `Work order ${id} created.`);
  }),
);

router.post(
  '/work-orders/:id/assign',
  route((req, res) => {
    const v = new Validator(req.body);
    const technician = v.string('technicianName', { max: 120, label: 'Technician' });
    const contact = v.string('technicianContact', { required: false, max: 40 });
    const targetDate = v.date('targetDate', { required: false, label: 'Target date' });
    const remarks = v.string('remarks', { required: false, max: 1000 });
    v.done();
    if (targetDate && targetDate < localDate()) throw badRequest('Target date cannot be in the past.');
    const w = db().transaction(() => {
      const current = getWorkOrder(req.params.id);
      if (['Completed', 'Cancelled'].includes(current.status)) throw conflict(`Work order is ${current.status.toLowerCase()}.`);
      const next = current.status === 'Pending' ? 'Assigned' : current.status;
      db().run(
        `UPDATE work_orders SET technician_name = ?, technician_contact = ?, target_date = COALESCE(?, target_date), remarks = COALESCE(?, remarks), status = ?, updated_at = ? WHERE id = ?`,
        technician,
        contact ?? null,
        targetDate ?? null,
        remarks ?? null,
        next,
        nowIso(),
        current.id,
      );
      recordEvent('work_order', current.id, req.user!.id, 'technician_assigned', { from: current.status, to: next, note: `${technician}${targetDate ? `, target ${fmtDate(targetDate)}` : ''}${remarks ? ` — ${remarks}` : ''}` });
      if (current.complaint_id) {
        db().run('UPDATE complaints SET assigned_technician = ?, technician_contact = ?, updated_at = ? WHERE id = ?', technician, contact ?? null, nowIso(), current.complaint_id);
        recordEvent('complaint', current.complaint_id, req.user!.id, 'technician_assigned', { note: technician });
      }
      return current.id;
    });
    audit(req, 'work_order.assigned', 'work_order', w, { technician });
    ok(res, mapWorkOrder(getWorkOrder(w), true), { message: `${technician} assigned to ${w}.` });
  }),
);

router.post(
  '/work-orders/:id/status',
  route((req, res) => {
    const v = new Validator(req.body);
    const status = v.oneOf('status', WORK_ORDER_STATUSES, { label: 'Status' });
    const remarks = v.string('remarks', { required: false, max: 1000 });
    v.done();
    const id = db().transaction(() => {
      const current = getWorkOrder(req.params.id);
      if (!WO_TRANSITIONS[current.status].includes(status!)) throw conflict(`Cannot move a work order from "${current.status}" to "${status}".`);
      if (['Assigned', 'In Progress'].includes(status!) && !current.technician_name) throw badRequest('Assign a technician first.');
      if ((status === 'Completed' || status === 'Cancelled') && !remarks) throw badRequest(`Add remarks before marking the work order ${status!.toLowerCase()}.`);
      const now = nowIso();
      db().run(
        `UPDATE work_orders SET status = ?, remarks = COALESCE(?, remarks), updated_at = ?, completed_at = CASE WHEN ? = 'Completed' THEN ? ELSE completed_at END WHERE id = ?`,
        status,
        remarks ?? null,
        now,
        status,
        now,
        current.id,
      );
      recordEvent('work_order', current.id, req.user!.id, 'status_changed', { from: current.status, to: status, note: remarks });
      if (current.complaint_id) {
        if (status === 'Completed') resolveLinkedComplaint(current.complaint_id, req.user!.id, `Maintenance work order ${current.id} completed. ${remarks}`);
        if (status === 'Pending Verification') {
          notify(usersWithRole('Warden'), {
            eventType: 'work_order.verify',
            title: `Verify maintenance ${current.id}`,
            message: `Work for complaint ${current.complaint_id} reported done. Please verify and close the complaint.`,
            entityType: 'complaint',
            entityId: current.complaint_id,
            link: '/warden/maintenance-complaints',
            dedupeKey: `work_order.verify:${current.id}:${now.slice(0, 16)}`,
          });
        }
      }
      return current.id;
    });
    audit(req, 'work_order.status', 'work_order', id, { status, remarks });
    ok(res, mapWorkOrder(getWorkOrder(id), true), { message: `Work order ${id} → ${status}.` });
  }),
);

router.get(
  '/technicians',
  route((_req, res) => {
    ok(res, db().all<any>('SELECT * FROM technicians WHERE is_active = 1 ORDER BY category, name').map((t) => ({ id: t.id, name: t.name, role: t.role, contact: t.contact, category: t.category })));
  }),
);

router.post(
  '/technicians',
  route((req, res) => {
    const v = new Validator(req.body);
    const name = v.string('name', { max: 120, label: 'Name' });
    const role = v.string('role', { max: 120, label: 'Role' });
    const contact = v.string('contact', { required: false, max: 40 });
    const category = v.oneOf('category', COMPLAINT_CATEGORIES, { label: 'Category' });
    v.done();
    const id = uid('tech');
    db().run('INSERT INTO technicians (id, name, role, contact, category) VALUES (?, ?, ?, ?, ?)', id, name, role, contact ?? null, category);
    audit(req, 'technician.created', 'technician', id);
    created(res, { id, name, role, contact, category }, `${name} added to the maintenance staff list.`);
  }),
);

// ---------------------------------------------------------------------------
// Escalated cases
// ---------------------------------------------------------------------------
router.get(
  '/escalations',
  route((_req, res) => ok(res, db().all(`SELECT ${ESC_SELECT} ORDER BY CASE e.status WHEN 'Resolved' THEN 1 ELSE 0 END, e.created_at DESC`).map(mapEscalation))),
);

router.post(
  '/escalations/:id/:action',
  route((req, res) => {
    const action = req.params.action;
    if (!['review', 'forward', 'resolve', 'note'].includes(action)) throw notFound('Action');
    const v = new Validator(req.body);
    const note = v.string('note', { required: action !== 'review', min: action === 'note' ? 1 : 5, max: 2000, label: 'Note' });
    v.done();
    const id = db().transaction(() => {
      const e = getEscalation(req.params.id);
      if (e.status === 'Resolved' && action !== 'note') throw conflict('This case is already resolved.');
      const now = nowIso();
      const set = (status: string, extra = '', ...p: unknown[]) => db().run(`UPDATE escalations SET status = ?, updated_at = ?${extra} WHERE id = ?`, status, now, ...p, e.id);
      switch (action) {
        case 'review':
          if (e.status !== 'Escalated') throw conflict(`Case is already "${e.status}".`);
          set('In Review');
          recordEvent('escalation', e.id, req.user!.id, 'review_started', { from: e.status, to: 'In Review', note });
          break;
        case 'forward':
          if (e.status === 'Forwarded to Principal') throw conflict('Case is already with the Principal office.');
          set('Forwarded to Principal', ', assigned_to_label = ?', 'Principal Office');
          recordEvent('escalation', e.id, req.user!.id, 'forwarded_to_principal', { from: e.status, to: 'Forwarded to Principal', note });
          if (e.source_type === 'complaint' && e.source_id) {
            db().run('UPDATE complaints SET level = 3, updated_at = ? WHERE id = ?', now, e.source_id);
            recordEvent('complaint', e.source_id, req.user!.id, 'forwarded_to_principal', { note });
          }
          // Principal accounts receive it in-app if provisioned; no external message is sent.
          notify(usersWithRole('Principal'), {
            eventType: 'escalation.forwarded',
            title: `Case ${e.id} forwarded by AO`,
            message: note!,
            entityType: 'escalation',
            entityId: e.id,
            dedupeKey: `escalation.forwarded:${e.id}`,
          });
          break;
        case 'resolve':
          set('Resolved', ', resolution_notes = ?, resolved_at = ?', note, now);
          recordEvent('escalation', e.id, req.user!.id, 'resolved', { from: e.status, to: 'Resolved', note });
          if (e.source_type === 'complaint' && e.source_id) resolveLinkedComplaint(e.source_id, req.user!.id, `Escalation ${e.id} resolved by AO: ${note}`);
          if (e.source_type === 'incident' && e.source_id) {
            const inc = db().get<any>('SELECT status FROM incidents WHERE id = ?', e.source_id);
            if (inc && inc.status !== 'Resolved') {
              db().run(`UPDATE incidents SET status = 'Resolved', updated_at = ? WHERE id = ?`, now, e.source_id);
              recordEvent('incident', e.source_id, req.user!.id, 'resolved', { from: inc.status, to: 'Resolved', note: `Escalation ${e.id}: ${note}` });
            }
          }
          notify([e.escalated_by], {
            eventType: 'escalation.resolved',
            title: `Escalated case ${e.id} resolved`,
            message: note!,
            entityType: 'escalation',
            entityId: e.id,
            severity: 'success',
            dedupeKey: `escalation.resolved:${e.id}`,
          });
          break;
        case 'note':
          db().run('UPDATE escalations SET updated_at = ? WHERE id = ?', now, e.id);
          recordEvent('escalation', e.id, req.user!.id, 'note', { note });
          break;
      }
      return e.id;
    });
    audit(req, `escalation.${action}`, 'escalation', id, { note });
    ok(res, mapEscalation(getEscalation(id)), { message: `Case ${id} updated.` });
  }),
);

// ---------------------------------------------------------------------------
// Reports & analytics
// ---------------------------------------------------------------------------
router.get(
  '/reports',
  route((req, res) => {
    const to = String(req.query.to || localDate());
    const from = String(req.query.from || addDays(to, -29));
    const fromIso = dayStartIso(from);
    const toIso = dayEndIso(to);
    const groupCount = (sql: string, ...p: unknown[]) => db().all<any>(sql, ...p).map((r) => ({ key: r.k, count: r.c }));
    const completed = db().all<any>(`SELECT created_at, completed_at, target_date FROM work_orders WHERE status = 'Completed' AND completed_at BETWEEN ? AND ?`, fromIso, toIso);
    const avgHours = completed.length ? Math.round((completed.reduce((s, w) => s + (Date.parse(w.completed_at) - Date.parse(w.created_at)), 0) / completed.length / 3_600_000) * 10) / 10 : null;
    ok(res, {
      from,
      to,
      workOrders: {
        created: db().get<any>('SELECT COUNT(*) AS c FROM work_orders WHERE created_at BETWEEN ? AND ?', fromIso, toIso).c,
        completed: completed.length,
        completedOnTime: completed.filter((w) => !w.target_date || w.completed_at.slice(0, 10) <= w.target_date).length,
        averageResolutionHours: avgHours,
        byCategory: groupCount('SELECT category AS k, COUNT(*) AS c FROM work_orders WHERE created_at BETWEEN ? AND ? GROUP BY category ORDER BY c DESC', fromIso, toIso),
        byStatus: groupCount('SELECT status AS k, COUNT(*) AS c FROM work_orders GROUP BY status'),
      },
      incidents: {
        reported: db().get<any>('SELECT COUNT(*) AS c FROM incidents WHERE created_at BETWEEN ? AND ?', fromIso, toIso).c,
        byCategory: groupCount('SELECT category AS k, COUNT(*) AS c FROM incidents WHERE created_at BETWEEN ? AND ? GROUP BY category ORDER BY c DESC', fromIso, toIso),
        bySeverity: groupCount('SELECT severity AS k, COUNT(*) AS c FROM incidents WHERE created_at BETWEEN ? AND ? GROUP BY severity', fromIso, toIso),
        byStatus: groupCount('SELECT status AS k, COUNT(*) AS c FROM incidents GROUP BY status'),
      },
      escalations: {
        raised: db().get<any>('SELECT COUNT(*) AS c FROM escalations WHERE created_at BETWEEN ? AND ?', fromIso, toIso).c,
        resolved: db().get<any>(`SELECT COUNT(*) AS c FROM escalations WHERE resolved_at BETWEEN ? AND ?`, fromIso, toIso).c,
        byStatus: groupCount('SELECT status AS k, COUNT(*) AS c FROM escalations GROUP BY status'),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// Complaints reaching the AO
//
// Exactly two kinds arrive here, and nothing else:
//   1. complaints whose category routes to the AO (Complaint About Warden);
//   2. complaints that passed their saved resolution deadline (escalated by the
//      scheduled server job, not by anyone opening this page).
// A complaint that qualifies for both carries both escalation records and keeps
// its original id and full history.
// ---------------------------------------------------------------------------
const AO_COMPLAINT_FILTER = `EXISTS (SELECT 1 FROM complaint_escalations e WHERE e.complaint_id = c.id)`;

router.get(
  '/complaints',
  route((req, res) => {
    const reason = String(req.query.reason || '');
    const clause =
      reason === 'warden'
        ? `EXISTS (SELECT 1 FROM complaint_escalations e WHERE e.complaint_id = c.id AND e.reason = 'Complaint About Warden')`
        : reason === 'overdue'
          ? `EXISTS (SELECT 1 FROM complaint_escalations e WHERE e.complaint_id = c.id AND e.reason = 'Deadline Exceeded')`
          : AO_COMPLAINT_FILTER;
    const rows = db().all(
      `SELECT ${COMPLAINT_SELECT} WHERE ${clause}
       ORDER BY CASE WHEN c.status IN ('Resolved','Closed') THEN 1 ELSE 0 END, c.deadline_at IS NULL, c.deadline_at`,
    );
    ok(
      res,
      rows.map((c: any) => withWorkerContact(mapComplaint(c, true), c, req.user!)),
    );
  }),
);

router.get(
  '/complaints/:id',
  route((req, res) => {
    const c = getComplaintRow(req.params.id);
    const escalated = db().get('SELECT 1 FROM complaint_escalations WHERE complaint_id = ?', c.id);
    if (!escalated) throw forbidden('This complaint has not been escalated to the AO office.');
    ok(res, withWorkerContact(mapComplaint(c, true), c, req.user!));
  }),
);

/** Records an AO review action against one escalation reason. */
router.post(
  '/complaints/:id/escalations/:escalationId/review',
  route((req, res) => {
    const v = new Validator(req.body);
    const status = v.oneOf('status', ['Under Review', 'Action Recorded', 'Closed'] as const, { label: 'Review status' });
    const notes = v.string('notes', { min: 5, max: 2000, label: 'Review notes' });
    v.done();
    const row = db().get<any>('SELECT complaint_id FROM complaint_escalations WHERE id = ?', req.params.escalationId);
    if (!row || row.complaint_id !== req.params.id) throw notFound('Escalation');
    const complaint = aoReviewEscalation(req.user!, req.params.escalationId, { status: status!, notes: notes! });
    audit(req, 'complaint.ao_review', 'complaint', complaint.id, { escalationId: req.params.escalationId, status });
    ok(res, complaint, { message: `Review recorded for complaint ${complaint.id}.` });
  }),
);

/** The AO may resolve or close an escalated complaint, with the same evidence rules. */
router.patch(
  '/complaints/:id',
  route((req, res) => {
    const v = new Validator(req.body);
    const status = v.oneOf('status', ['In Progress', 'Resolved', 'Closed'] as const, { label: 'Status' });
    const note = v.string('note', { required: false, max: 1000 });
    const resolutionNotes = v.string('resolutionNotes', { required: status === 'Resolved', max: 2000, label: 'Resolution details' });
    v.done();
    const escalated = db().get('SELECT 1 FROM complaint_escalations WHERE complaint_id = ?', req.params.id);
    if (!escalated) throw forbidden('This complaint has not been escalated to the AO office.');
    const complaint = changeComplaintStatus(req.user!, req.params.id, status!, { note, resolutionNotes });
    audit(req, 'complaint.ao_status_changed', 'complaint', complaint.id, { status });
    ok(res, complaint, { message: `Complaint ${complaint.id} is now ${status}.` });
  }),
);

export default router;
