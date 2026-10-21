import { db } from '../db/database';
import type { AuthUser } from '../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/http';
import { getEvents, getNumberSetting, getSetting, notify, recordEvent, usersWithRole } from '../lib/records';
import { fmtDate, fmtDateTime, localDate, nextCode, nowIso, randomToken, sha256, uid, yearLabel } from '../lib/util';
import { sendWorkerJob, workerJobLink } from './whatsapp';

/**
 * Complaint lifecycle.
 *
 *   Submitted -> Accepted -> Worker Assigned -> In Progress -> Resolved -> Closed
 *                                                                 \-> Reopened -> ...
 *
 * Categories, their per-priority resolution targets and the worker trade they map to
 * all live in the database (`complaint_categories`, `complaint_resolution_targets`),
 * so nothing about "a water issue takes 8 hours" is hard-coded here.
 *
 * Two kinds of complaint reach the AO, and only these two:
 *   - a complaint whose category is flagged `routes_to_ao` (Complaint About Warden);
 *   - a complaint that passed its saved deadline without being resolved (see jobs.ts).
 */

/** Maintenance trades used by the AO's own work orders and escalations (not the student picker). */
export const COMPLAINT_CATEGORIES = ['Electrical', 'Plumbing', 'Carpentry', 'Wi-Fi / LAN', 'Housekeeping', 'Civil / Masonry', 'Mess / Food', 'Room Issue', 'General Maintenance', 'Other'] as const;
export const URGENCY_LEVELS = ['Critical (4 hrs)', 'High (16 hrs)', 'Normal (48 hrs)', 'Low (72 hrs)'] as const;
export const COMPLAINT_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

export const COMPLAINT_STATUSES = ['Submitted', 'Accepted', 'Worker Assigned', 'In Progress', 'Resolved', 'Closed', 'Reopened'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Allowed status moves. Anything not listed is rejected as an invalid transition. */
const TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  Submitted: ['Accepted'],
  Accepted: ['Worker Assigned', 'In Progress', 'Resolved'],
  'Worker Assigned': ['In Progress', 'Resolved'],
  'In Progress': ['Resolved'],
  Resolved: ['Closed', 'Reopened'],
  Closed: ['Reopened'],
  Reopened: ['Accepted', 'Worker Assigned', 'In Progress', 'Resolved'],
};

const OPEN_STATUSES = `('Submitted','Accepted','Worker Assigned','In Progress','Reopened')`;

export const COMPLAINT_SELECT = `
  c.*, s.name AS student_name, s.reg_number, s.department_code, s.year, s.user_id AS student_user_id, r.room_number, r.block,
  cc.name AS category_name, cc.worker_category, cc.routes_to_ao,
  t.name AS worker_name, t.contact AS worker_contact, t.role AS worker_role, t.category AS worker_trade,
  wo.id AS work_order_id, wo.status AS work_order_status, wo.technician_name AS wo_technician, wo.technician_contact AS wo_contact,
  acc.name AS accepted_by_name, rsv.name AS resolved_by_name
  FROM complaints c
  JOIN students s ON s.id = c.student_id
  LEFT JOIN rooms r ON r.id = s.room_id
  LEFT JOIN complaint_categories cc ON cc.id = c.category_id
  LEFT JOIN technicians t ON t.id = c.worker_id
  LEFT JOIN work_orders wo ON wo.complaint_id = c.id
  LEFT JOIN users acc ON acc.id = c.accepted_by
  LEFT JOIN users rsv ON rsv.id = c.resolved_by
`;

// ---------------------------------------------------------------------------
// Configurable categories, resolution targets and workers
// ---------------------------------------------------------------------------
export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  default_priority: ComplaintPriority;
  resolution_hours: number;
  worker_category: string | null;
  routes_to_ao: number;
  is_active: number;
  sort_order: number;
}

export function listCategories(activeOnly = true) {
  const rows = db().all<CategoryRow>(`SELECT * FROM complaint_categories ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY sort_order, name`);
  const targets = db().all<any>('SELECT category_id, priority, resolution_hours FROM complaint_resolution_targets');
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    defaultPriority: c.default_priority,
    resolutionHours: c.resolution_hours,
    workerCategory: c.worker_category,
    routesToAO: c.routes_to_ao === 1,
    isActive: c.is_active === 1,
    sortOrder: c.sort_order,
    targets: Object.fromEntries(targets.filter((t) => t.category_id === c.id).map((t) => [t.priority, t.resolution_hours])) as Record<string, number>,
  }));
}

export function getCategory(id: string): CategoryRow {
  const row = db().get<CategoryRow>('SELECT * FROM complaint_categories WHERE id = ?', id);
  if (!row) throw badRequest('Unknown complaint category.', { fields: { categoryId: 'Choose a category from the list.' } });
  return row;
}

/** Hours allowed for this category at this priority; the per-priority target wins. */
export function resolutionHoursFor(categoryId: string, priority: ComplaintPriority): number {
  const target = db().get<{ resolution_hours: number }>('SELECT resolution_hours FROM complaint_resolution_targets WHERE category_id = ? AND priority = ?', categoryId, priority);
  if (target) return target.resolution_hours;
  return getCategory(categoryId).resolution_hours;
}

const addHours = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();

export function listWorkers(activeOnly = true) {
  return db()
    .all<any>(`SELECT * FROM technicians ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY category, name`)
    .map((t) => ({ id: t.id, name: t.name, role: t.role, phone: t.contact || '', category: t.category, isActive: t.is_active === 1 }));
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------
/**
 * A Warden must never see or act on a complaint that is about the Warden — that
 * conflict of interest is enforced here, not by hiding a button.
 */
export function assertComplaintAccess(user: AuthUser, c: any, forWrite = false) {
  if (user.role === 'Student') {
    if (c.student_user_id !== user.id) throw notFound('Complaint');
    return;
  }
  if (c.is_about_warden === 1 && (user.role === 'Warden' || user.role === 'Security' || user.role === 'Mess')) {
    throw forbidden('Complaints about the Warden are handled by the Administrative Officer.');
  }
  if (forWrite && !['Warden', 'AO', 'Admin', 'Dean'].includes(user.role)) throw forbidden();
}

/** SQL fragment hiding Warden-subject complaints from the Warden's own queries. */
export const complaintVisibility = (user: AuthUser) => (user.role === 'Warden' ? 'c.is_about_warden = 0' : '1 = 1');

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
export function escalationsFor(complaintId: string) {
  return db()
    .all<any>(`SELECT e.*, u.name AS reviewed_by_name FROM complaint_escalations e LEFT JOIN users u ON u.id = e.reviewed_by WHERE e.complaint_id = ? ORDER BY e.created_at`, complaintId)
    .map((e) => ({
      id: e.id,
      reason: e.reason,
      status: e.status,
      previousStatus: e.previous_status,
      notes: e.ao_notes,
      reviewedBy: e.reviewed_by_name || null,
      reviewedAt: e.reviewed_at ? fmtDateTime(e.reviewed_at) : null,
      createdAt: e.created_at,
      createdAtDisplay: fmtDateTime(e.created_at),
    }));
}

function assignmentsFor(complaintId: string) {
  return db()
    .all<any>(
      `SELECT a.*, t.name AS worker_name, t.contact AS worker_contact, t.category AS worker_trade, u.name AS assigned_by_name
       FROM complaint_assignments a JOIN technicians t ON t.id = a.worker_id LEFT JOIN users u ON u.id = a.assigned_by
       WHERE a.complaint_id = ? ORDER BY a.created_at`,
      complaintId,
    )
    .map((a) => ({
      id: a.id,
      workerName: a.worker_name,
      workerTrade: a.worker_trade,
      status: a.status,
      assignedBy: a.assigned_by_name,
      assignedAt: fmtDateTime(a.created_at),
      contactedAt: a.contacted_at ? fmtDateTime(a.contacted_at) : null,
      contactNote: a.contact_note,
      autoAssigned: a.auto_assigned === 1,
      detectedTrade: a.detected_trade,
      detectionSource: a.detection_source,
      dispatchChannel: a.dispatch_channel,
      dispatchStatus: a.dispatch_status,
      dispatchError: a.dispatch_error,
      dispatchedAt: a.dispatched_at ? fmtDateTime(a.dispatched_at) : null,
      reportStatus: a.report_status,
      reportNote: a.report_note,
      reportedAt: a.reported_at ? fmtDateTime(a.reported_at) : null,
    }));
}

/**
 * What the worker holding this job has reported back, if anything. Read from the
 * live assignment, so a job handed to someone else does not carry the previous
 * worker's report.
 */
function workerReportFor(complaintId: string) {
  const a = db().get<any>(
    `SELECT a.report_status, a.report_note, a.reported_at, t.name AS worker_name, t.category AS worker_trade
     FROM complaint_assignments a JOIN technicians t ON t.id = a.worker_id
     WHERE a.complaint_id = ? AND a.status IN ('Assigned','Contacted','Completed') AND a.report_status IS NOT NULL
     ORDER BY a.created_at DESC LIMIT 1`,
    complaintId,
  );
  if (!a) return null;
  return {
    status: a.report_status as 'Reported Done' | 'Could Not Complete',
    note: a.report_note as string | null,
    reportedAt: fmtDateTime(a.reported_at),
    workerName: a.worker_name as string,
    workerTrade: a.worker_trade as string,
  };
}

/** Humanised remaining/overdue time against the saved deadline. */
function deadlineView(c: any, now = Date.now()) {
  if (!c.deadline_at) return { remainingMinutes: null, isOverdue: false, label: '—' };
  const settled = c.status === 'Resolved' || c.status === 'Closed';
  const reference = settled && c.resolved_at ? Date.parse(c.resolved_at) : now;
  const diffMin = Math.round((Date.parse(c.deadline_at) - reference) / 60_000);
  const abs = Math.abs(diffMin);
  const human = abs >= 1440 ? `${Math.floor(abs / 1440)}d ${Math.round((abs % 1440) / 60)}h` : abs >= 60 ? `${Math.floor(abs / 60)}h ${abs % 60}m` : `${abs}m`;
  return {
    remainingMinutes: diffMin,
    isOverdue: diffMin < 0 && !settled,
    label: settled ? (diffMin >= 0 ? `Resolved ${human} inside target` : `Resolved ${human} late`) : diffMin >= 0 ? `${human} left` : `${human} overdue`,
  };
}

/** Student `Complaint` shape (with stage timeline) plus every staff field. */
export function mapComplaint(c: any, withHistory = false) {
  const events = withHistory ? getEvents('complaint', c.id) : [];
  const escalations = escalationsFor(c.id);
  const deadline = deadlineView(c);
  const resolved = c.status === 'Resolved' || c.status === 'Closed';
  // The timeline is driven by how far the workflow has travelled, not by whether each
  // individual timestamp happens to be filled in. A stage whose own timestamp was never
  // recorded (a complaint resolved without a separate "accepted" step, say) must still
  // read as done once a later stage has been reached — otherwise the track shows a
  // completed stage sitting below pending ones and the connector line looks broken.
  const ORDER: ComplaintStatus[] = ['Submitted', 'Accepted', 'Worker Assigned', 'In Progress', 'Resolved', 'Closed'];
  const rank = (s: string) => {
    const i = ORDER.indexOf(s as ComplaintStatus);
    return i < 0 ? 0 : i;
  };
  const position = rank(c.status);

  /**
   * `completesAt` is the first workflow status at which this stage counts as done.
   * Stages named for a finished action ("Warden Accepted") complete on reaching that
   * status; a stage named for an ongoing state ("Work In Progress") only completes
   * once the workflow has moved past it.
   */
  const NEVER = ORDER.length;
  const buildStages = (defs: { title: string; completesAt: number; at: string | null; badge?: string }[]) => {
    const firstOpen = defs.findIndex((d) => position < d.completesAt);
    return defs.map((d, i) => ({
      title: d.title,
      date: d.at ? fmtDate(d.at) : '—',
      status: position >= d.completesAt ? ('completed' as const) : i === firstOpen ? ('current' as const) : ('pending' as const),
      badge: d.badge,
    }));
  };

  const stages = c.is_about_warden
    ? buildStages([
        { title: 'Complaint Submitted', completesAt: 0, at: c.created_at },
        { title: 'Routed to Administrative Officer', completesAt: 0, at: c.created_at },
        { title: 'AO Review', completesAt: escalations.some((e) => e.status !== 'Open') || resolved ? 0 : NEVER, at: escalations[0]?.createdAt ?? null },
        { title: 'Resolution', completesAt: rank('Resolved'), at: c.resolved_at, badge: resolved ? 'Resolved' : undefined },
      ])
    : buildStages([
        { title: 'Complaint Submitted', completesAt: 0, at: c.created_at },
        { title: 'Warden Accepted', completesAt: rank('Accepted'), at: c.accepted_at },
        { title: 'Worker Assigned', completesAt: rank('Worker Assigned'), at: c.worker_assigned_at },
        { title: 'Work In Progress', completesAt: rank('Resolved'), at: c.contact_confirmed_at },
        { title: 'Resolved', completesAt: rank('Resolved'), at: c.resolved_at, badge: c.status === 'Resolved' ? 'Resolved' : undefined },
        { title: 'Closed', completesAt: rank('Closed'), at: c.closed_at, badge: c.status === 'Closed' ? 'Closed' : undefined },
      ]);
  // The open stage carries the "Current Stage" marker, unless it already has its own badge.
  const openStage = stages.find((st) => st.status === 'current');
  if (openStage && !openStage.badge) openStage.badge = 'Current Stage';

  const escalationReasons = escalations.map((e) => e.reason);
  return {
    id: c.id,
    ticketId: c.id,
    studentId: c.student_id,
    title: c.title,
    categoryId: c.category_id,
    category: c.category,
    complaintType: c.category,
    urgency: c.urgency,
    priority: c.priority,
    description: c.description,
    issueDescription: c.description,
    location: c.location,
    fileName: c.file_name || undefined,
    submittedDate: fmtDate(c.created_at),
    submittedDateTime: fmtDateTime(c.created_at),
    submittedAt: c.created_at,
    // Resolution target and deadline tracking
    resolutionHours: c.resolution_hours,
    resolutionTarget: c.resolution_hours ? `${c.resolution_hours} hours` : '—',
    deadlineAt: c.deadline_at,
    deadlineDisplay: c.deadline_at ? fmtDateTime(c.deadline_at) : '—',
    remainingMinutes: deadline.remainingMinutes,
    timeRemainingLabel: deadline.label,
    isOverdue: deadline.isOverdue,
    // Status
    status: c.status,
    workflowStatus: c.status,
    stages,
    reopenedCount: c.reopened_count,
    // Warden handling
    acceptedBy: c.accepted_by_name || undefined,
    acceptedAt: c.accepted_at ? fmtDateTime(c.accepted_at) : undefined,
    workerId: c.worker_id || undefined,
    workerName: c.worker_name || c.assigned_technician || undefined,
    workerTrade: c.worker_trade || undefined,
    workerRole: c.worker_role || undefined,
    workerAssignedAt: c.worker_assigned_at ? fmtDateTime(c.worker_assigned_at) : undefined,
    contactConfirmedAt: c.contact_confirmed_at ? fmtDateTime(c.contact_confirmed_at) : undefined,
    assignments: assignmentsFor(c.id),
    workerReport: workerReportFor(c.id),
    resolutionNotes: c.resolution_notes || undefined,
    resolvedBy: c.resolved_by_name || undefined,
    resolvedAt: c.resolved_at ? fmtDateTime(c.resolved_at) : undefined,
    closedAt: c.closed_at ? fmtDateTime(c.closed_at) : undefined,
    // AO escalation
    isAboutWarden: c.is_about_warden === 1,
    escalations,
    escalationReasons,
    isEscalated: escalations.length > 0,
    escalationStatus: escalations.length ? escalations[escalations.length - 1].status : undefined,
    escalatedAt: c.escalated_at ? fmtDateTime(c.escalated_at) : undefined,
    authorityRef: c.is_about_warden ? 'AO Office' : escalations.length ? 'AO Office (escalated)' : 'Warden Office',
    // Student / room identity
    name: c.student_name,
    studentName: c.student_name,
    regNumber: c.reg_number,
    roomNumber: c.room_number || '—',
    block: c.block || '',
    department: c.department_code,
    year: yearLabel(c.year),
    // Legacy maintenance fields still used by the work-order screens
    assignedTechnician: c.worker_name || c.assigned_technician || undefined,
    technicianContact: c.technician_contact || c.wo_contact || undefined,
    remarks: c.warden_remarks || undefined,
    completedDateTime: c.resolved_at ? fmtDateTime(c.resolved_at) : undefined,
    workOrderId: c.work_order_id || undefined,
    workOrderStatus: c.work_order_status || undefined,
    history: withHistory ? events : undefined,
  };
}

/** Worker contact details are only ever added for roles allowed to see them. */
export function withWorkerContact(mapped: ReturnType<typeof mapComplaint>, c: any, user: AuthUser) {
  if (!['Warden', 'AO', 'Admin', 'Dean'].includes(user.role)) return mapped;
  return { ...mapped, workerPhone: c.worker_contact || undefined };
}

export function getComplaintRow(id: string) {
  const row = db().get(`SELECT ${COMPLAINT_SELECT} WHERE c.id = ?`, id);
  if (!row) throw notFound('Complaint');
  return row as any;
}

const notifyStudent = (c: any, title: string, message: string, severity: 'info' | 'success' | 'warning' | 'alert' = 'info', key?: string) =>
  notify([c.student_user_id], {
    eventType: 'complaint.updated',
    title,
    message,
    entityType: 'complaint',
    entityId: c.id,
    link: '/student/complaint-status',
    severity,
    dedupeKey: key,
  });

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------
export function createComplaint(
  user: AuthUser,
  studentId: string,
  input: { categoryId: string; title: string; description: string; location: string; priority?: ComplaintPriority; fileName?: string },
) {
  const category = getCategory(input.categoryId);
  if (!category.is_active) throw badRequest('That complaint category is no longer available.');
  const priority = input.priority ?? category.default_priority;
  const recent = db().get<any>(
    `SELECT id FROM complaints WHERE student_id = ? AND category_id = ? AND description = ? AND created_at > ?`,
    studentId,
    category.id,
    input.description,
    new Date(Date.now() - 10 * 60_000).toISOString(),
  );
  if (recent) throw conflict(`This complaint was already submitted as ${recent.id}.`);

  const hours = resolutionHoursFor(category.id, priority);
  return db().transaction(() => {
    const id = nextCode('CMP');
    const now = nowIso();
    const deadline = addHours(now, hours);
    const aboutWarden = category.routes_to_ao === 1;
    db().run(
      `INSERT INTO complaints (id, student_id, title, category_id, category, urgency, priority, description, location, file_name, status,
        resolution_hours, deadline_at, is_about_warden, escalated_at, level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?, ?, ?, ?, ?, ?, ?)`,
      id,
      studentId,
      input.title,
      category.id,
      category.name,
      `${priority} (${hours} hrs)`,
      priority,
      input.description,
      input.location,
      input.fileName ?? null,
      hours,
      deadline,
      aboutWarden ? 1 : 0,
      aboutWarden ? now : null,
      aboutWarden ? 2 : 1,
      now,
      now,
    );
    recordEvent('complaint', id, user.id, 'submitted', { to: 'Submitted', note: `${category.name} · ${priority} · resolve by ${fmtDateTime(deadline)}` });

    if (aboutWarden) {
      // Type 1 escalation: never shown to the Warden who is the subject.
      openEscalation(id, 'Complaint About Warden', 'Submitted', user.id);
    } else {
      notify(usersWithRole('Warden'), {
        eventType: 'complaint.submitted',
        title: `New complaint ${id}: ${category.name}`,
        message: `${priority} priority · ${input.location} · resolve by ${fmtDateTime(deadline)}.`,
        entityType: 'complaint',
        entityId: id,
        link: '/warden/maintenance-complaints',
        severity: priority === 'High' || priority === 'Critical' ? 'warning' : 'info',
        dedupeKey: `complaint.submitted:${id}`,
      });
    }
    return mapComplaint(getComplaintRow(id), true);
  });
}

// ---------------------------------------------------------------------------
// Escalation to the AO (both reasons go through here)
// ---------------------------------------------------------------------------
/** Idempotent: a complaint carries at most one escalation record per reason. */
export function openEscalation(complaintId: string, reason: 'Complaint About Warden' | 'Deadline Exceeded', previousStatus: string, actorId: string | null): string | null {
  const existing = db().get<{ id: string }>('SELECT id FROM complaint_escalations WHERE complaint_id = ? AND reason = ?', complaintId, reason);
  if (existing) return null;
  const c = getComplaintRow(complaintId);
  const id = uid('esc');
  const now = nowIso();
  db().run(
    `INSERT INTO complaint_escalations (id, complaint_id, reason, previous_status, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Open', ?, ?)`,
    id,
    complaintId,
    reason,
    previousStatus,
    now,
    now,
  );
  db().run('UPDATE complaints SET escalated_at = COALESCE(escalated_at, ?), level = MAX(level, 2), updated_at = ? WHERE id = ?', now, now, complaintId);
  recordEvent('complaint', complaintId, actorId, 'escalated_to_ao', { from: previousStatus, to: c.status, note: reason });
  notify(usersWithRole('AO'), {
    eventType: 'complaint.escalated',
    title: reason === 'Complaint About Warden' ? `Complaint ${complaintId} about the Warden` : `Complaint ${complaintId} missed its deadline`,
    message:
      reason === 'Complaint About Warden'
        ? `${c.student_name} (${c.reg_number}) raised a complaint that needs AO review.`
        : `${c.category} · ${c.priority} · target was ${fmtDateTime(c.deadline_at)} and the complaint is still "${c.status}".`,
    entityType: 'complaint',
    entityId: complaintId,
    link: '/ao/complaints',
    severity: 'warning',
    dedupeKey: `complaint.escalated:${complaintId}:${reason}`,
  });
  notifyStudent(
    c,
    `Complaint ${complaintId} is with the Administrative Officer`,
    reason === 'Complaint About Warden' ? 'Complaints about the Warden are reviewed by the AO.' : 'The resolution deadline passed, so it was escalated automatically.',
    'warning',
    `complaint.escalated.student:${complaintId}:${reason}`,
  );
  return id;
}

/** AO records a review action against one escalation record. */
export function aoReviewEscalation(user: AuthUser, escalationId: string, input: { status: 'Under Review' | 'Action Recorded' | 'Closed'; notes: string }) {
  return db().transaction(() => {
    const e = db().get<any>('SELECT * FROM complaint_escalations WHERE id = ?', escalationId);
    if (!e) throw notFound('Escalation');
    if (e.status === 'Closed') throw conflict('This escalation is already closed.');
    const now = nowIso();
    db().run('UPDATE complaint_escalations SET status = ?, ao_notes = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?', input.status, input.notes, user.id, now, now, escalationId);
    recordEvent('complaint', e.complaint_id, user.id, 'ao_review', { from: e.status, to: input.status, note: `${e.reason}: ${input.notes}` });
    const c = getComplaintRow(e.complaint_id);
    notifyStudent(c, `Complaint ${e.complaint_id}: AO update`, input.notes, 'info');
    return mapComplaint(getComplaintRow(e.complaint_id), true);
  });
}

// ---------------------------------------------------------------------------
// Warden handling
// ---------------------------------------------------------------------------
/**
 * `aoTakeover` widens the map for the AO acting on an escalated complaint: once a
 * complaint has left the Warden's hands the AO can drive it to completion directly.
 */
function assertTransition(from: ComplaintStatus, to: ComplaintStatus, aoTakeover = false) {
  if (from === to) throw conflict(`This complaint is already "${from}".`);
  const allowed = [...(TRANSITIONS[from] ?? []), ...(aoTakeover ? (['In Progress', 'Resolved', 'Closed'] as ComplaintStatus[]) : [])];
  if (!allowed.includes(to)) throw conflict(`A complaint cannot move from "${from}" to "${to}".`);
}

// ---------------------------------------------------------------------------
// Automatic routing: trade detection, worker choice and job dispatch
// ---------------------------------------------------------------------------
/** How the trade was arrived at. `none` means nothing could be worked out. */
export type DetectionSource = 'category' | 'keywords' | 'fallback' | 'manual' | 'none';

export interface TradeDetection {
  trade: string | null;
  source: DetectionSource;
  /** The keywords that actually matched, for the Warden's explanation line. */
  matched: string[];
}

/** Whole-word match, so "tap" does not fire on "laptop" and "lan" not on "plan". */
const mentions = (haystack: string, keyword: string) =>
  new RegExp(`(^|[^a-z0-9])${keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(haystack);

/**
 * Works out which trade an issue belongs to.
 *
 * The category's configured `worker_category` is the truth whenever it has one;
 * it was set by the administrator and beats any guess. Only when the category
 * carries none ("Other Hostel Issue") does the complaint's own wording decide,
 * against the keywords in `complaint_worker_keywords` — data, not code. A trade
 * with no active worker can never win a keyword contest, since routing to it
 * would dead-end.
 */
export function detectWorkerTrade(c: any): TradeDetection {
  if (c.worker_category) return { trade: c.worker_category, source: 'category', matched: [] };

  const haystack = `${c.title ?? ''} ${c.description ?? ''} ${c.location ?? ''} ${c.category_name ?? c.category ?? ''}`.toLowerCase();
  const staffed = new Set(db().all<{ category: string }>(`SELECT DISTINCT category FROM technicians WHERE is_active = 1`).map((t) => t.category));
  const scores = new Map<string, { score: number; matched: string[] }>();
  const rules = [
    // A trade named outright ("Civil / Masonry", "Wi-Fi / LAN") outweighs any single keyword.
    ...[...staffed].map((trade) => ({ worker_category: trade, keyword: trade, weight: 4 })),
    ...db().all<{ worker_category: string; keyword: string; weight: number }>(`SELECT worker_category, keyword, weight FROM complaint_worker_keywords WHERE is_active = 1`),
  ];
  for (const k of rules) {
    if (!staffed.has(k.worker_category) || !mentions(haystack, k.keyword)) continue;
    const entry = scores.get(k.worker_category) ?? { score: 0, matched: [] };
    entry.score += k.weight;
    entry.matched.push(k.keyword);
    scores.set(k.worker_category, entry);
  }
  const best = [...scores.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))[0];
  if (best) return { trade: best[0], source: 'keywords', matched: best[1].matched };

  const fallback = getSetting('complaint.fallback_worker_category').trim();
  return fallback ? { trade: fallback, source: 'fallback', matched: [] } : { trade: null, source: 'none', matched: [] };
}

/** Active workers of a trade with the number of jobs each is already holding. */
export function workersForTrade(trade: string) {
  return db().all<any>(
    `SELECT t.*, (SELECT COUNT(*) FROM complaint_assignments a WHERE a.worker_id = t.id AND a.status IN ('Assigned','Contacted')) AS live_jobs
     FROM technicians t WHERE t.is_active = 1 AND t.category = ? ORDER BY live_jobs, t.name`,
    trade,
  );
}

/**
 * Chooses the worker for a trade.
 *
 * A worker is never "busy": one worker can hold any number of jobs, and several
 * of the same kind in the same block are better done by whoever is already
 * coming — so a worker with a live job of this trade in this block gets this one
 * too. Otherwise the least-loaded worker of the trade takes it.
 */
export function pickWorkerForTrade(trade: string, c?: any) {
  const workers = workersForTrade(trade);
  if (!workers.length) return null;
  if (c?.block) {
    const inBlock = db().get<{ worker_id: string }>(
      `SELECT a.worker_id FROM complaint_assignments a
         JOIN complaints c2 ON c2.id = a.complaint_id
         JOIN students s2 ON s2.id = c2.student_id
         LEFT JOIN rooms r2 ON r2.id = s2.room_id
       WHERE a.status IN ('Assigned','Contacted') AND r2.block = ? AND a.detected_trade = ?
       ORDER BY a.created_at DESC LIMIT 1`,
      c.block,
      trade,
    );
    const already = inBlock && workers.find((w) => w.id === inBlock.worker_id);
    if (already) return already;
  }
  return workers[0];
}

const workerView = (w: any) => ({
  id: w.id,
  name: w.name,
  role: w.role,
  phone: w.contact || '',
  category: w.category,
  liveJobs: typeof w.live_jobs === 'number' ? w.live_jobs : undefined,
});

/**
 * Records the assignment and moves the complaint to "Worker Assigned". Shared by
 * the automatic route and the Warden's manual override, so both leave the same
 * trail. Must run inside a transaction.
 */
function recordAssignment(user: AuthUser, c: any, worker: any, detection: TradeDetection, note?: string) {
  const now = nowIso();
  // Replacing a worker cancels the previous live assignment so the unique index
  // holds — and with it the superseded worker's job link stops working.
  db().run(
    `UPDATE complaint_assignments SET status = 'Cancelled', token_hash = NULL, updated_at = ? WHERE complaint_id = ? AND status IN ('Assigned','Contacted')`,
    now,
    c.id,
  );
  const assignmentId = uid('cas');
  const token = randomToken(32);
  db().run(
    `INSERT INTO complaint_assignments (id, complaint_id, worker_id, assigned_by, status, auto_assigned, detected_trade, detection_source, token_hash, token_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Assigned', ?, ?, ?, ?, ?, ?, ?)`,
    assignmentId,
    c.id,
    worker.id,
    user.id,
    detection.source === 'manual' ? 0 : 1,
    detection.trade,
    detection.source,
    sha256(token),
    new Date(Date.now() + Math.max(1, getNumberSetting('complaint.worker_link_hours') || 72) * 3_600_000).toISOString(),
    now,
    now,
  );
  db().run(
    `UPDATE complaints SET status = 'Worker Assigned', worker_id = ?, worker_assigned_at = ?, assigned_technician = ?, technician_contact = ?,
      warden_remarks = COALESCE(?, warden_remarks), updated_at = ? WHERE id = ?`,
    worker.id,
    now,
    worker.name,
    worker.contact ?? null,
    note ?? null,
    now,
    c.id,
  );
  const how = detection.source === 'manual' ? `chosen by ${user.name}` : `auto-routed · ${detectionReason(detection)}`;
  recordEvent('complaint', c.id, user.id, 'worker_assigned', {
    from: c.status,
    to: 'Worker Assigned',
    note: `${worker.name} (${worker.category}) — ${how}${note ? ` · ${note}` : ''}`,
  });
  notifyStudent(c, `Complaint ${c.id}: worker assigned`, `${worker.name} (${worker.category}) has been assigned to your complaint.`);
  return { assignmentId, token };
}

/** Plain-English explanation of how the trade was picked. */
export function detectionReason(d: TradeDetection): string {
  switch (d.source) {
    case 'category':
      return `the category is configured for ${d.trade}`;
    case 'keywords':
      return `the wording matched ${d.trade} (${d.matched.slice(0, 4).join(', ')})`;
    case 'fallback':
      return `no trade could be read from the complaint, so it went to the fallback trade ${d.trade}`;
    case 'manual':
      return 'the Warden picked the worker';
    default:
      return 'no trade could be worked out';
  }
}

export interface AutoRouting {
  detectedTrade: string | null;
  detectionSource: DetectionSource;
  matchedKeywords: string[];
  reason: string;
  worker: ReturnType<typeof workerView> | null;
  dispatch: { channel: string; status: string; error: string | null; link: string | null } | null;
  /** One line the portal can show as-is; it never claims more than happened. */
  summary: string;
}

/**
 * Sends the job to the worker and records the outcome against the assignment.
 *
 * Runs after the assignment transaction has committed, so a slow network call
 * never holds the write lock. Delivery is reported exactly as it came back: a
 * message that could not be sent is not dressed up as sent, and the Warden is
 * shown the worker's number so the job still reaches them.
 */
async function dispatchJobToWorker(assignmentId: string, complaintId: string, worker: any, token: string) {
  const row = getComplaintRow(complaintId);
  const deadline = row.deadline_at ? fmtDateTime(row.deadline_at) : 'as soon as possible';
  const link = workerJobLink(token);
  const delivery = worker.contact
    ? await sendWorkerJob({
        toPhone: worker.contact,
        workerName: worker.name,
        trade: worker.category,
        complaintId,
        category: row.category_name ?? row.category,
        priority: row.priority,
        title: row.title || row.category,
        description: row.description,
        location: `${row.location || 'see complaint'}${row.room_number ? ` · Room ${row.room_number}` : ''}${row.block ? `, Block ${row.block}` : ''}`,
        deadline,
        link,
      })
    : { status: 'Failed' as const, providerMessageId: null, error: 'No phone number is on file for this worker.' };

  db().transaction(() => {
    const now = nowIso();
    const sent = delivery.status === 'Sent';
    db().run(
      `UPDATE complaint_assignments SET status = ?, dispatch_channel = 'WhatsApp', dispatch_status = ?, dispatch_error = ?, dispatched_at = ?,
        contact_note = COALESCE(contact_note, ?), contacted_at = COALESCE(contacted_at, ?), updated_at = ? WHERE id = ?`,
      sent ? 'Contacted' : 'Assigned',
      delivery.status,
      delivery.error,
      now,
      sent ? 'Job sent to the worker automatically over WhatsApp.' : null,
      sent ? now : null,
      now,
      assignmentId,
    );
    if (sent) db().run('UPDATE complaints SET contact_confirmed_at = COALESCE(contact_confirmed_at, ?), updated_at = ? WHERE id = ?', now, now, complaintId);
    recordEvent('complaint', complaintId, null, sent ? 'worker_dispatched' : 'worker_dispatch_failed', {
      note: sent
        ? `Job sent to ${worker.name} on WhatsApp (${worker.contact}).`
        : `Could not send the job to ${worker.name}: ${delivery.status}${delivery.error ? ` — ${delivery.error}` : ''}. Call ${worker.contact || 'the worker'} instead.`,
    });
  });
  // The link is handed back only when the message did not reach the worker, so the
  // Warden can pass it on; a delivered job link is never echoed into a response.
  return { channel: 'WhatsApp', status: delivery.status, error: delivery.error, link: delivery.status === 'Sent' ? null : link };
}

/**
 * The Warden accepts the complaint — and that is the whole of the Warden's job.
 *
 * Accepting detects the trade, picks a worker of that trade and sends them the
 * job. The only case that still needs a person is a trade with no active worker
 * at all: the complaint then stays "Accepted" and the Warden is told to pick
 * someone (or to have the administrator add a worker for that trade).
 */
export async function acceptComplaint(user: AuthUser, id: string, note?: string) {
  const routed = db().transaction(() => {
    const c = getComplaintRow(id);
    assertComplaintAccess(user, c, true);
    assertTransition(c.status, 'Accepted');
    const now = nowIso();
    db().run('UPDATE complaints SET status = ?, accepted_by = ?, accepted_at = ?, warden_remarks = COALESCE(?, warden_remarks), updated_at = ? WHERE id = ?', 'Accepted', user.id, now, note ?? null, now, id);
    recordEvent('complaint', id, user.id, 'accepted', { from: c.status, to: 'Accepted', note });
    notifyStudent(c, `Complaint ${id} accepted`, `${user.name} accepted your complaint and the work is being assigned.`);

    const detection = detectWorkerTrade(c);
    const worker = detection.trade ? pickWorkerForTrade(detection.trade, c) : null;
    if (!worker) {
      const why = detection.trade
        ? `No active worker is configured for "${detection.trade}".`
        : `The trade for "${c.category_name ?? c.category}" could not be worked out.`;
      recordEvent('complaint', id, user.id, 'auto_assign_failed', { note: `${why} The Warden was asked to assign a worker.` });
      return { assignmentId: null, token: null as string | null, worker: null, detection, blockedWhy: why };
    }
    const { assignmentId, token } = recordAssignment(user, c, worker, detection);
    return { assignmentId, token, worker, detection, blockedWhy: null as string | null };
  });

  const dispatch = routed.worker && routed.assignmentId ? await dispatchJobToWorker(routed.assignmentId, id, routed.worker, routed.token!) : null;
  const row = getComplaintRow(id);
  const autoRouting: AutoRouting = {
    detectedTrade: routed.detection.trade,
    detectionSource: routed.detection.source,
    matchedKeywords: routed.detection.matched,
    reason: detectionReason(routed.detection),
    worker: routed.worker ? workerView(routed.worker) : null,
    dispatch,
    summary: !routed.worker
      ? `${routed.blockedWhy} Assign a worker below.`
      : dispatch?.status === 'Sent'
        ? `${routed.worker.name} (${routed.worker.category}) was assigned automatically — ${detectionReason(routed.detection)} — and the job was sent to ${routed.worker.contact} on WhatsApp.`
        : `${routed.worker.name} (${routed.worker.category}) was assigned automatically — ${detectionReason(routed.detection)}. The WhatsApp job could not be delivered (${dispatch?.status}${dispatch?.error ? `: ${dispatch.error}` : ''}), so call ${routed.worker.contact || 'the worker'}.`,
  };
  return { ...withWorkerContact(mapComplaint(row, true), row, user), autoRouting };
}

/**
 * Manual override: the Warden names the worker themselves. Only needed when the
 * automatic route found no worker for the trade, or when a job has to change
 * hands. The job is sent to the new worker the same way.
 */
export async function assignWorker(user: AuthUser, id: string, workerId: string, note?: string) {
  const assigned = db().transaction(() => {
    const c = getComplaintRow(id);
    assertComplaintAccess(user, c, true);
    if (!['Accepted', 'Reopened', 'Worker Assigned'].includes(c.status)) throw conflict(`A worker can only be assigned once the complaint is accepted (it is "${c.status}").`);
    const worker = db().get<any>('SELECT * FROM technicians WHERE id = ? AND is_active = 1', workerId);
    if (!worker) throw badRequest('Unknown or inactive worker.');
    const { assignmentId, token } = recordAssignment(user, c, worker, { trade: worker.category, source: 'manual', matched: [] }, note);
    return { assignmentId, token, worker };
  });

  const dispatch = await dispatchJobToWorker(assigned.assignmentId, id, assigned.worker, assigned.token);
  const row = getComplaintRow(id);
  return { ...withWorkerContact(mapComplaint(row, true), row, user), dispatch };
}

// ---------------------------------------------------------------------------
// The worker's side: one job, reached by its own link, reported back by them
// ---------------------------------------------------------------------------
export const WORKER_REPORT_OUTCOMES = ['Reported Done', 'Could Not Complete'] as const;
export type WorkerReportOutcome = (typeof WORKER_REPORT_OUTCOMES)[number];

function assignmentByToken(token: string) {
  const row = db().get<any>(
    `SELECT a.*, t.name AS worker_name, t.role AS worker_role, t.category AS worker_trade,
            c.id AS complaint_id, c.title, c.description, c.location, c.priority, c.status AS complaint_status, c.deadline_at,
            cc.name AS category_name, c.category AS category_legacy,
            s.name AS student_name, r.room_number, r.block
     FROM complaint_assignments a
       JOIN technicians t ON t.id = a.worker_id
       JOIN complaints c ON c.id = a.complaint_id
       LEFT JOIN complaint_categories cc ON cc.id = c.category_id
       JOIN students s ON s.id = c.student_id
       LEFT JOIN rooms r ON r.id = s.room_id
     WHERE a.token_hash = ?`,
    sha256(String(token || '').trim()),
  );
  if (!row) throw notFound('Job');
  return row;
}

/**
 * Token-only view of one job. It deliberately carries no more than a worker needs
 * to do the work: the issue, where it is, how urgent it is and whose room it is —
 * no registration number, no contact details, nothing about any other complaint.
 */
export function workerJobView(token: string) {
  const a = assignmentByToken(token);
  const expired = !a.token_expires_at || Date.parse(a.token_expires_at) < Date.now();
  const finished = ['Resolved', 'Closed'].includes(a.complaint_status);
  return {
    complaintId: a.complaint_id,
    category: a.category_name ?? a.category_legacy,
    trade: a.detected_trade ?? a.worker_trade,
    title: a.title || (a.category_name ?? a.category_legacy),
    description: a.description,
    location: `${a.location || '—'}${a.room_number ? ` · Room ${a.room_number}` : ''}${a.block ? `, Block ${a.block}` : ''}`,
    studentName: a.student_name,
    priority: a.priority,
    deadlineDisplay: a.deadline_at ? fmtDateTime(a.deadline_at) : '—',
    assignedAtDisplay: fmtDateTime(a.created_at),
    workerName: a.worker_name,
    workerTrade: a.worker_trade,
    complaintStatus: a.complaint_status,
    assignmentStatus: a.status,
    reportStatus: (a.report_status as WorkerReportOutcome | null) ?? null,
    reportNote: a.report_note as string | null,
    reportedAtDisplay: a.reported_at ? fmtDateTime(a.reported_at) : null,
    expiresAt: a.token_expires_at,
    expired,
    /** False once the job was reported, handed to someone else, or the complaint closed. */
    canReport: !a.report_status && !expired && !finished && ['Assigned', 'Contacted'].includes(a.status),
  };
}

/**
 * The worker reports the job back.
 *
 * "Reported Done" is the worker's word, not a verified fact, so the complaint is
 * never resolved here: it moves to In Progress at most and the Warden is told
 * there is work to verify. "Could Not Complete" leaves the job where it is and
 * tells the Warden why, so they can reassign or raise a work order.
 */
export function workerReportJob(token: string, outcome: WorkerReportOutcome, note?: string) {
  return db().transaction(() => {
    const a = assignmentByToken(token);
    if (a.report_status) throw conflict('This job has already been reported.');
    if (!a.token_expires_at || Date.parse(a.token_expires_at) < Date.now()) throw conflict('This job link has expired. Please call the hostel office.');
    if (!['Assigned', 'Contacted'].includes(a.status)) throw conflict('This job is no longer yours to report; the hostel office has changed the assignment.');
    if (['Resolved', 'Closed'].includes(a.complaint_status)) throw conflict('The hostel office has already closed this complaint.');

    const now = nowIso();
    const done = outcome === 'Reported Done';
    db().run(
      `UPDATE complaint_assignments SET report_status = ?, report_note = ?, reported_at = ?, updated_at = ? WHERE id = ?`,
      outcome,
      note ?? null,
      now,
      now,
      a.id,
    );
    // The work having been attempted is a real change of state; the verification is not.
    const nextStatus = done && a.complaint_status === 'Worker Assigned' ? 'In Progress' : a.complaint_status;
    if (nextStatus !== a.complaint_status) db().run('UPDATE complaints SET status = ?, updated_at = ? WHERE id = ?', nextStatus, now, a.complaint_id);
    recordEvent('complaint', a.complaint_id, null, done ? 'worker_reported_done' : 'worker_reported_blocked', {
      from: a.complaint_status,
      to: nextStatus,
      note: `${a.worker_name} (${a.worker_trade}) reported from the job link: ${done ? 'work done' : 'could not complete'}${note ? ` — ${note}` : ''}`,
    });

    const c = getComplaintRow(a.complaint_id);
    notify(usersWithRole('Warden'), {
      eventType: 'complaint.updated',
      title: done ? `Complaint ${a.complaint_id}: worker reported the work done` : `Complaint ${a.complaint_id}: worker could not finish`,
      message: done
        ? `${a.worker_name} (${a.worker_trade}) reported the work done${note ? `: ${note}` : ''}. Verify it and resolve the complaint.`
        : `${a.worker_name} (${a.worker_trade}) could not complete the job${note ? `: ${note}` : ''}. Reassign it or raise a work order.`,
      entityType: 'complaint',
      entityId: a.complaint_id,
      link: '/warden/maintenance-complaints',
      severity: done ? 'info' : 'warning',
      dedupeKey: `complaint.worker_report:${a.id}`,
    });
    if (done) notifyStudent(c, `Complaint ${a.complaint_id}: work reported done`, `${a.worker_name} reported the work done. The Warden will verify it before the complaint is closed.`);

    return { complaintId: a.complaint_id, outcome, status: nextStatus };
  });
}

/**
 * The Warden confirms they contacted the worker. The system never claims to have
 * placed a call: it records that the Warden did, with a timestamp and a note.
 */
export function confirmWorkerContact(user: AuthUser, id: string, note: string) {
  return db().transaction(() => {
    const c = getComplaintRow(id);
    assertComplaintAccess(user, c, true);
    const assignment = db().get<any>(`SELECT * FROM complaint_assignments WHERE complaint_id = ? AND status IN ('Assigned','Contacted')`, id);
    if (!assignment) throw conflict('Assign a worker before recording the contact.');
    const now = nowIso();
    db().run(`UPDATE complaint_assignments SET status = 'Contacted', contact_note = ?, contacted_at = ?, updated_at = ? WHERE id = ?`, note, now, now, assignment.id);
    const nextStatus = c.status === 'Worker Assigned' ? 'In Progress' : c.status;
    db().run('UPDATE complaints SET status = ?, contact_confirmed_at = ?, updated_at = ? WHERE id = ?', nextStatus, now, now, id);
    recordEvent('complaint', id, user.id, 'worker_contacted', { from: c.status, to: nextStatus, note });
    if (nextStatus !== c.status) notifyStudent(c, `Complaint ${id} is in progress`, `${user.name} briefed the worker: ${note}`);
    const row = getComplaintRow(id);
    return withWorkerContact(mapComplaint(row, true), row, user);
  });
}

const rolesFromSetting = (key: string) =>
  getSetting(key)
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

/** Generic status move with validated transitions; resolution requires evidence. */
export function changeComplaintStatus(user: AuthUser, id: string, to: ComplaintStatus, input: { note?: string; resolutionNotes?: string } = {}) {
  return db().transaction(() => {
    const c = getComplaintRow(id);
    assertComplaintAccess(user, c, true);
    const escalated = !!db().get('SELECT 1 FROM complaint_escalations WHERE complaint_id = ?', id);
    assertTransition(c.status, to, user.role === 'AO' && escalated);
    const now = nowIso();
    if (to === 'Resolved') {
      const notes = (input.resolutionNotes ?? input.note ?? '').trim();
      if (notes.length < 5) throw badRequest('Record what was done before marking the complaint resolved.', { fields: { resolutionNotes: 'Resolution details are required.' } });
      if (c.work_order_id && !['Completed', 'Cancelled', 'Pending Verification'].includes(c.work_order_status)) {
        throw conflict(`Work order ${c.work_order_id} is still "${c.work_order_status}".`);
      }
      db().run('UPDATE complaints SET status = ?, resolution_notes = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?', to, notes, user.id, now, now, id);
      db().run(`UPDATE complaint_assignments SET status = 'Completed', completed_at = ?, updated_at = ? WHERE complaint_id = ? AND status IN ('Assigned','Contacted')`, now, now, id);
      if (c.work_order_id && c.work_order_status === 'Pending Verification') {
        db().run(`UPDATE work_orders SET status = 'Completed', completed_at = ?, updated_at = ? WHERE id = ?`, now, now, c.work_order_id);
        recordEvent('work_order', c.work_order_id, user.id, 'verified_by_warden', { from: 'Pending Verification', to: 'Completed' });
      }
      recordEvent('complaint', id, user.id, 'resolved', { from: c.status, to, note: notes });
      notifyStudent(c, `Complaint ${id} resolved`, notes, 'success');
    } else if (to === 'Closed') {
      if (!rolesFromSetting('complaint.close_roles').includes(user.role)) throw forbidden(`Your role cannot close complaints. Allowed: ${getSetting('complaint.close_roles')}.`);
      db().run('UPDATE complaints SET status = ?, closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ?', to, user.id, now, now, id);
      db().run(`UPDATE complaint_escalations SET status = 'Closed', updated_at = ? WHERE complaint_id = ? AND status != 'Closed'`, now, id);
      recordEvent('complaint', id, user.id, 'closed', { from: c.status, to, note: input.note });
      notifyStudent(c, `Complaint ${id} closed`, input.note || 'The complaint has been closed.', 'info');
    } else if (to === 'Reopened') {
      if (!rolesFromSetting('complaint.reopen_roles').includes(user.role)) throw forbidden(`Your role cannot reopen complaints. Allowed: ${getSetting('complaint.reopen_roles')}.`);
      const note = (input.note ?? '').trim();
      if (note.length < 5) throw badRequest('Explain why the complaint is being reopened.', { fields: { note: 'A reason is required.' } });
      const windowHours = Number(getSetting('complaint.reopen_window_hours')) || 72;
      const since = c.resolved_at ?? c.closed_at;
      if (user.role === 'Student' && since && Date.now() - Date.parse(since) > windowHours * 3_600_000) {
        throw conflict(`A complaint can only be reopened within ${windowHours} hours of resolution. Raise a new complaint instead.`);
      }
      // A reopened complaint gets a fresh deadline from the same configured target.
      const hours = c.category_id ? resolutionHoursFor(c.category_id, c.priority) : c.resolution_hours ?? 48;
      db().run(
        `UPDATE complaints SET status = ?, reopened_count = reopened_count + 1, resolution_hours = ?, deadline_at = ?, resolved_at = NULL, closed_at = NULL, updated_at = ? WHERE id = ?`,
        to,
        hours,
        addHours(now, hours),
        now,
        id,
      );
      recordEvent('complaint', id, user.id, 'reopened', { from: c.status, to, note });
      notify(usersWithRole('Warden'), {
        eventType: 'complaint.reopened',
        title: `Complaint ${id} reopened`,
        message: note,
        entityType: 'complaint',
        entityId: id,
        link: '/warden/maintenance-complaints',
        severity: 'warning',
        dedupeKey: `complaint.reopened:${id}:${c.reopened_count + 1}`,
      });
    } else {
      db().run('UPDATE complaints SET status = ?, warden_remarks = COALESCE(?, warden_remarks), updated_at = ? WHERE id = ?', to, input.note ?? null, now, id);
      recordEvent('complaint', id, user.id, 'status_changed', { from: c.status, to, note: input.note });
      notifyStudent(c, `Complaint ${id} is now ${to}`, input.note || `Updated by ${user.name}.`);
    }
    const row = getComplaintRow(id);
    return withWorkerContact(mapComplaint(row, true), row, user);
  });
}

// ---------------------------------------------------------------------------
// Maintenance work orders raised from a complaint (unchanged behaviour)
// ---------------------------------------------------------------------------
export function createWorkOrderFromComplaint(user: AuthUser, id: string, input: { remarks?: string; targetDate?: string }) {
  return db().transaction(() => {
    const c = getComplaintRow(id);
    assertComplaintAccess(user, c, true);
    if (['Resolved', 'Closed'].includes(c.status)) throw conflict(`This complaint is already "${c.status}".`);
    if (c.work_order_id) throw conflict(`Work order ${c.work_order_id} already exists for this complaint.`);
    if (input.targetDate && input.targetDate < localDate()) throw badRequest('Target date cannot be in the past.');
    const woId = nextCode('WO');
    const now = nowIso();
    db().run(
      `INSERT INTO work_orders (id, complaint_id, category, description, location, priority, status, target_date, remarks, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?)`,
      woId,
      id,
      c.category,
      c.description,
      c.room_number ? `${c.location} (Room ${c.room_number})` : c.location,
      c.priority === 'Critical' ? 'High' : c.priority,
      input.targetDate ?? null,
      input.remarks ?? null,
      user.id,
      now,
      now,
    );
    if (c.status !== 'In Progress') {
      db().run(`UPDATE complaints SET status = 'In Progress', updated_at = ? WHERE id = ?`, now, id);
    }
    recordEvent('work_order', woId, user.id, 'created', { to: 'Pending', note: `From complaint ${id}` });
    recordEvent('complaint', id, user.id, 'work_order_created', { from: c.status, to: 'In Progress', note: `Work order ${woId}` });
    notify(usersWithRole('AO'), {
      eventType: 'work_order.created',
      title: `New maintenance work order ${woId}`,
      message: `${c.category} at ${c.location} (complaint ${id}).`,
      entityType: 'work_order',
      entityId: woId,
      link: '/ao/maintenance',
      severity: c.priority === 'High' || c.priority === 'Critical' ? 'warning' : 'info',
      dedupeKey: `work_order.created:${woId}`,
    });
    notifyStudent(c, `Complaint ${id}: maintenance scheduled`, `Work order ${woId} was raised with the maintenance team.`);
    const row = getComplaintRow(id);
    return withWorkerContact(mapComplaint(row, true), row, user);
  });
}

/** Called when a work order linked to a complaint is completed. */
export function resolveLinkedComplaint(complaintId: string, actorId: string, note: string) {
  const c = db().get<any>(`SELECT ${COMPLAINT_SELECT} WHERE c.id = ?`, complaintId);
  if (!c || ['Resolved', 'Closed'].includes(c.status)) return;
  const now = nowIso();
  db().run('UPDATE complaints SET status = ?, resolution_notes = COALESCE(resolution_notes, ?), resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?', 'Resolved', note, actorId, now, now, complaintId);
  db().run(`UPDATE complaint_assignments SET status = 'Completed', completed_at = ?, updated_at = ? WHERE complaint_id = ? AND status IN ('Assigned','Contacted')`, now, now, complaintId);
  recordEvent('complaint', complaintId, actorId, 'resolved', { from: c.status, to: 'Resolved', note });
  notifyStudent(c, `Complaint ${complaintId} resolved`, note, 'success', `complaint.resolved:${complaintId}`);
}

/**
 * Escalates every complaint that passed its saved deadline without being resolved.
 * Runs from the scheduled server job, is idempotent, and never touches complaints
 * that were resolved inside their target.
 */
export function escalateOverdueComplaints(now = new Date()): number {
  const rows = db().all<any>(
    `SELECT c.id, c.status FROM complaints c
     WHERE c.deadline_at IS NOT NULL AND c.deadline_at < ? AND c.status IN ${OPEN_STATUSES}
       AND NOT EXISTS (SELECT 1 FROM complaint_escalations e WHERE e.complaint_id = c.id AND e.reason = 'Deadline Exceeded')`,
    now.toISOString(),
  );
  let created = 0;
  for (const r of rows) {
    db().transaction(() => {
      if (openEscalation(r.id, 'Deadline Exceeded', r.status, null)) created++;
    });
  }
  return created;
}
