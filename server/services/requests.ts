import { db } from '../db/database';
import type { AuthUser } from '../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/http';
import { hodOf, inchargeFor } from './classIncharge';
import { ensureTracking, stopTracking } from './outings';
import { getEvents, notify, recordEvent, usersWithRole } from '../lib/records';
import { fmtDate, fmtDateTime, fmtTime, localDate, nextCode, nowIso, randomToken, yearLabel, zonedIso } from '../lib/util';

export const LEAVE_TYPES = ['Personal Leave', 'Medical Leave', 'Family Function', 'Emergency Leave', 'Academic / Event', 'Festival Leave', 'Other'] as const;
export const OUTING_TYPES = ['Personal', 'Shopping', 'Medical', 'Family Visit', 'Academic', 'Other'] as const;

// ---------------------------------------------------------------------------
// Leave requests
// ---------------------------------------------------------------------------
const LEAVE_STAGE: Record<string, number> = { 'Pending Class Incharge': 1, 'Pending HOD': 2, 'Pending Warden': 3, Approved: 4, Rejected: 4, Cancelled: 4 };

/** Who must act next, by status. */
export const LEAVE_PENDING_ROLE: Record<string, string> = {
  'Pending Class Incharge': 'Class Incharge',
  'Pending HOD': 'HOD',
  'Pending Warden': 'Warden',
};

export const LEAVE_SELECT = `
  l.*, s.name AS student_name, s.reg_number, s.department_code, s.section, s.year, s.parent_name, s.parent_phone, s.adviser_user_id,
  r.room_number, ci.name AS incharge_name, hd.name AS hod_name, w.name AS warden_name, pc.name AS parent_confirmed_by_name,
  d.name AS department_name
  FROM leave_requests l
  JOIN students s ON s.id = l.student_id
  JOIN departments d ON d.code = s.department_code
  LEFT JOIN rooms r ON r.id = s.room_id
  LEFT JOIN users ci ON ci.id = l.incharge_id
  LEFT JOIN users hd ON hd.id = l.hod_id
  LEFT JOIN users w ON w.id = l.warden_id
  LEFT JOIN users pc ON pc.id = l.parent_confirmed_by
`;

/** Superset shape: student `LeaveRequest`, warden `WardenLeaveRecord` and adviser `AdviserLeaveRequest` fields. */
export function mapLeave(l: any, withHistory = false) {
  const studentStatus =
    l.status === 'Pending Class Incharge' ? 'Pending' : l.status === 'Pending HOD' || l.status === 'Pending Warden' ? 'In Review' : l.status;
  const approvals = [
    { stage: 'Class Incharge', by: l.incharge_name || null, decision: l.incharge_decision || null, at: l.incharge_decided_at, remarks: l.incharge_remarks || null },
    { stage: 'HOD', by: l.hod_name || null, decision: l.hod_decision || null, at: l.hod_decided_at, remarks: l.hod_remarks || null },
    { stage: 'Warden', by: l.warden_name || null, decision: l.warden_decision || null, at: l.warden_decided_at, remarks: l.warden_remarks || null },
  ].map((a) => ({ ...a, atDisplay: a.at ? fmtDateTime(a.at) : undefined }));
  const rejectionRemarks = l.rejected_stage === 'Warden' ? l.warden_remarks : l.rejected_stage === 'HOD' ? l.hod_remarks : l.incharge_remarks;
  return {
    id: l.id,
    studentId: l.student_id,
    // Student portal fields
    type: l.leave_type,
    fromDate: l.from_date,
    toDate: l.to_date,
    fromDateDisplay: fmtDate(l.from_date),
    toDateDisplay: fmtDate(l.to_date),
    departureAt: l.departure_at || undefined,
    returnAt: l.return_at || undefined,
    departureDisplay: l.departure_at ? fmtDateTime(l.departure_at) : fmtDate(l.from_date),
    returnDisplay: l.return_at ? fmtDateTime(l.return_at) : fmtDate(l.to_date),
    reason: l.reason,
    fileName: l.document_name || '',
    status: studentStatus as string,
    workflowStatus: l.status as string,
    submittedDate: fmtDate(l.created_at),
    submittedAt: l.created_at,
    currentStageIndex: LEAVE_STAGE[l.status] ?? 1,
    // Who the request is waiting on right now
    pendingStage: LEAVE_PENDING_ROLE[l.status] ?? null,
    pendingWith:
      l.status === 'Pending Class Incharge' ? l.incharge_name || 'Class Incharge' : l.status === 'Pending HOD' ? l.hod_name || 'HOD' : l.status === 'Pending Warden' ? 'Warden' : null,
    approvals,
    rejectedStage: l.rejected_stage || undefined,
    // Staff fields
    name: l.student_name,
    studentName: l.student_name,
    regNumber: l.reg_number,
    department: l.department_code,
    departmentName: l.department_name,
    section: l.section || null,
    year: yearLabel(l.year),
    roomNumber: l.room_number || 'Unallocated',
    leaveType: l.leave_type,
    dateRange: `${fmtDate(l.from_date)} - ${fmtDate(l.to_date)}`,
    days: Math.round((Date.parse(l.to_date) - Date.parse(l.from_date)) / 86_400_000) + 1,
    submittedDateTime: fmtDateTime(l.created_at),
    hasDocument: !!l.document_name,
    documentName: l.document_name || undefined,
    parentName: l.parent_name || '',
    parentNumber: l.parent_phone || '',
    addressDuringLeave: l.address_during_leave || '',
    parentApproved: l.parent_confirmed === 1,
    parentApprovalDate: l.parent_confirmed_at ? fmtDateTime(l.parent_confirmed_at) : undefined,
    parentConfirmedBy: l.parent_confirmed_by_name || undefined,
    // Stage 1 — Class Incharge. The `adviser*` aliases keep the existing adviser UI working.
    classInchargeName: l.incharge_name || undefined,
    classInchargeDecision: l.incharge_decision || undefined,
    classInchargeRemarks: l.incharge_remarks || undefined,
    classInchargeDecidedAt: l.incharge_decided_at ? fmtDateTime(l.incharge_decided_at) : undefined,
    adviserName: l.incharge_name || undefined,
    adviserDecision: l.incharge_decision === 'Approved' ? 'Approved & Forwarded' : l.incharge_decision || undefined,
    adviserRemarks: l.incharge_remarks || undefined,
    adviserDecidedAt: l.incharge_decided_at ? fmtDateTime(l.incharge_decided_at) : undefined,
    // Stage 2 — HOD
    hodName: l.hod_name || undefined,
    hodDecision: l.hod_decision || undefined,
    hodRemarks: l.hod_remarks || undefined,
    hodDecidedAt: l.hod_decided_at ? fmtDateTime(l.hod_decided_at) : undefined,
    // Stage 3 — Warden
    wardenDecision: l.warden_decision || undefined,
    wardenRemarks: l.warden_remarks || undefined,
    wardenName: l.warden_name || undefined,
    wardenDecidedAt: l.warden_decided_at ? fmtDateTime(l.warden_decided_at) : undefined,
    rejectionReason: l.status === 'Rejected' ? rejectionRemarks || undefined : undefined,
    history: withHistory ? getEvents('leave_request', l.id) : undefined,
  };
}

export function getLeave(id: string) {
  const row = db().get(`SELECT ${LEAVE_SELECT} WHERE l.id = ?`, id);
  if (!row) throw notFound('Leave request');
  return row as any;
}

export function createLeave(
  user: AuthUser,
  studentId: string,
  input: { leaveType: string; fromDate: string; toDate: string; reason: string; address?: string; documentName?: string; departureAt?: string; returnAt?: string },
) {
  if (input.toDate < input.fromDate) throw badRequest('The end date must be on or after the start date.', { fields: { toDate: 'End date must be on or after the start date.' } });
  if (input.fromDate < localDate()) throw badRequest('Leave cannot start in the past.', { fields: { fromDate: 'Leave cannot start in the past.' } });
  if (input.departureAt && input.returnAt && input.returnAt <= input.departureAt) {
    throw badRequest('The expected return must be after the departure time.', { fields: { returnAt: 'Return must be after departure.' } });
  }
  const overlap = db().get<any>(
    `SELECT id FROM leave_requests WHERE student_id = ? AND status IN ('Pending Class Incharge','Pending HOD','Pending Warden','Approved') AND from_date <= ? AND to_date >= ?`,
    studentId,
    input.toDate,
    input.fromDate,
  );
  if (overlap) throw conflict(`You already have leave request ${overlap.id} covering these dates.`);

  const student = db().get<any>('SELECT id, name, department_code, section FROM students WHERE id = ?', studentId)!;
  // Routing comes from the student's own profile — it is never chosen by the student.
  if (!student.section) {
    throw badRequest('Your profile has no class section, so the request cannot be routed to a Class Incharge. Ask the hostel administrator to set your section.', {
      fields: { section: 'Class section is not set on your profile.' },
    });
  }
  const incharge = inchargeFor(student.department_code, student.section);
  if (!incharge) {
    throw badRequest(
      `No Class Incharge is assigned to ${student.department_code} Section ${student.section}. The request was not submitted — ask the hostel administrator to assign one.`,
      { fields: { section: 'No Class Incharge assigned for this section.' } },
    );
  }
  const hod = hodOf(student.department_code);

  return db().transaction(() => {
    const id = nextCode('LR');
    const now = nowIso();
    db().run(
      `INSERT INTO leave_requests (id, student_id, leave_type, from_date, to_date, departure_at, return_at, reason, address_during_leave, document_name,
        status, incharge_id, hod_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Class Incharge', ?, ?, ?, ?)`,
      id,
      studentId,
      input.leaveType,
      input.fromDate,
      input.toDate,
      input.departureAt ?? null,
      input.returnAt ?? null,
      input.reason,
      input.address ?? null,
      input.documentName ?? null,
      incharge.user_id,
      hod?.id ?? null,
      now,
      now,
    );
    recordEvent('leave_request', id, user.id, 'submitted', {
      to: 'Pending Class Incharge',
      note: `Routed to ${incharge.name} (${student.department_code} Section ${student.section})`,
    });
    notify([incharge.user_id], {
      eventType: 'leave.submitted',
      title: `New leave request ${id}`,
      message: `${student.name} (Section ${student.section}) requested ${input.leaveType} from ${fmtDate(input.fromDate)} to ${fmtDate(input.toDate)}.`,
      entityType: 'leave_request',
      entityId: id,
      link: '/adviser/leave-requests',
      dedupeKey: `leave.submitted:${id}`,
    });
    return mapLeave(getLeave(id));
  });
}

function studentUserId(studentId: string): string | null {
  return db().get<{ user_id: string | null }>('SELECT user_id FROM students WHERE id = ?', studentId)?.user_id ?? null;
}

const notifyStudentOfLeave = (
  leave: any,
  title: string,
  message: string,
  severity: 'info' | 'success' | 'warning' | 'alert',
  key: string,
  link = '/student/leave-request-status',
) =>
  notify([studentUserId(leave.student_id)], {
    eventType: severity === 'alert' ? 'leave.rejected' : 'leave.updated',
    title,
    message,
    entityType: 'leave_request',
    entityId: leave.id,
    link,
    severity,
    dedupeKey: key,
  });

/**
 * Stage 1. Only the Class Incharge the request was routed to may decide it.
 * Approval moves it to the department HOD; rejection ends the request there.
 */
export function inchargeDecideLeave(user: AuthUser, id: string, decision: 'Approved' | 'Rejected', remarks: string | undefined) {
  return db().transaction(() => {
    const leave = getLeave(id);
    if (leave.status !== 'Pending Class Incharge') throw conflict(`This request is already "${leave.status}" and can no longer be decided by the Class Incharge.`);
    if (leave.incharge_id !== user.id) throw forbidden('This leave request is assigned to another Class Incharge.');
    if (decision === 'Rejected' && !remarks) throw badRequest('A reason is required when rejecting a leave request.', { fields: { remarks: 'Reason is required.' } });
    const hod = leave.hod_id ? { id: leave.hod_id as string } : hodOf(leave.department_code);
    if (decision === 'Approved' && !hod) {
      throw conflict(`${leave.department_code} has no active HOD, so this request cannot move to the next approval stage. Ask the administrator to assign one.`);
    }
    const next = decision === 'Approved' ? 'Pending HOD' : 'Rejected';
    const now = nowIso();
    db().run(
      `UPDATE leave_requests SET status = ?, incharge_decision = ?, incharge_remarks = ?, incharge_id = ?, incharge_decided_at = ?,
        hod_id = COALESCE(hod_id, ?), rejected_stage = ?, updated_at = ? WHERE id = ?`,
      next,
      decision,
      remarks ?? null,
      user.id,
      now,
      hod?.id ?? null,
      decision === 'Rejected' ? 'Class Incharge' : null,
      now,
      id,
    );
    recordEvent('leave_request', id, user.id, decision === 'Approved' ? 'class_incharge_approved' : 'class_incharge_rejected', { from: leave.status, to: next, note: remarks });
    notifyStudentOfLeave(
      leave,
      decision === 'Approved' ? `Leave ${id} approved by Class Incharge` : `Leave ${id} rejected by Class Incharge`,
      decision === 'Approved' ? 'Your Class Incharge approved the request. It is now with the HOD.' : remarks || 'Your Class Incharge rejected the request.',
      decision === 'Approved' ? 'info' : 'alert',
      `leave.incharge:${id}`,
    );
    if (decision === 'Approved') {
      notify([hod!.id], {
        eventType: 'leave.pending_hod',
        title: `Leave ${id} awaiting HOD approval`,
        message: `${leave.student_name} (${leave.reg_number}) — approved by ${user.name}.`,
        entityType: 'leave_request',
        entityId: id,
        link: '/hod/leave-requests',
        dedupeKey: `leave.pending_hod:${id}`,
      });
    }
    return mapLeave(getLeave(id), true);
  });
}

/**
 * Stage 2. Only the HOD of the student's department may decide, and only after the
 * Class Incharge has approved. Approval moves it to the Warden.
 */
export function hodDecideLeave(user: AuthUser, id: string, decision: 'Approved' | 'Rejected', remarks: string | undefined) {
  return db().transaction(() => {
    const leave = getLeave(id);
    if (leave.status !== 'Pending HOD') {
      throw conflict(leave.status === 'Pending Class Incharge' ? 'This request is still awaiting the Class Incharge decision.' : `This request is already "${leave.status}".`);
    }
    if (leave.department_code !== user.departmentCode) throw forbidden('This student is not in your department.');
    if (decision === 'Rejected' && !remarks) throw badRequest('A reason is required when rejecting a leave request.', { fields: { remarks: 'Reason is required.' } });
    const next = decision === 'Approved' ? 'Pending Warden' : 'Rejected';
    const now = nowIso();
    db().run(
      `UPDATE leave_requests SET status = ?, hod_decision = ?, hod_remarks = ?, hod_id = ?, hod_decided_at = ?, rejected_stage = ?, updated_at = ? WHERE id = ?`,
      next,
      decision,
      remarks ?? null,
      user.id,
      now,
      decision === 'Rejected' ? 'HOD' : null,
      now,
      id,
    );
    recordEvent('leave_request', id, user.id, decision === 'Approved' ? 'hod_approved' : 'hod_rejected', { from: leave.status, to: next, note: remarks });
    notifyStudentOfLeave(
      leave,
      decision === 'Approved' ? `Leave ${id} approved by HOD` : `Leave ${id} rejected by HOD`,
      decision === 'Approved' ? 'Your HOD approved the request. It is now with the Warden for final approval.' : remarks || 'Your HOD rejected the request.',
      decision === 'Approved' ? 'info' : 'alert',
      `leave.hod:${id}`,
    );
    notify([leave.incharge_id], {
      eventType: `leave.hod_${decision.toLowerCase()}`,
      title: `Leave ${id} ${decision.toLowerCase()} by HOD`,
      message: `${leave.student_name} (${leave.reg_number}).`,
      entityType: 'leave_request',
      entityId: id,
      link: '/adviser/leave-requests',
      dedupeKey: `leave.hod.incharge:${id}`,
    });
    if (decision === 'Approved') {
      notify(usersWithRole('Warden'), {
        eventType: 'leave.pending_warden',
        title: `Leave ${id} awaiting Warden approval`,
        message: `${leave.student_name} (${leave.reg_number}) — approved by the Class Incharge and ${user.name}.`,
        entityType: 'leave_request',
        entityId: id,
        link: '/warden/leave-requests',
        dedupeKey: `leave.pending_warden:${id}`,
      });
    }
    return mapLeave(getLeave(id), true);
  });
}

/** Stage 3, final. Only reachable once both earlier stages have approved. */
export function wardenDecideLeave(user: AuthUser, id: string, decision: 'Approved' | 'Rejected', remarks: string | undefined) {
  return db().transaction(() => {
    const leave = getLeave(id);
    if (leave.status !== 'Pending Warden') {
      throw conflict(
        leave.status === 'Pending Class Incharge'
          ? 'This request is still awaiting the Class Incharge decision.'
          : leave.status === 'Pending HOD'
            ? 'This request is still awaiting the HOD decision.'
            : `This request is already "${leave.status}".`,
      );
    }
    if (decision === 'Rejected' && !remarks) throw badRequest('A reason is required when rejecting a leave request.', { fields: { remarks: 'Reason is required.' } });
    const now = nowIso();
    db().run(
      `UPDATE leave_requests SET status = ?, warden_decision = ?, warden_remarks = ?, warden_id = ?, warden_decided_at = ?, rejected_stage = ?, updated_at = ? WHERE id = ?`,
      decision,
      decision,
      remarks ?? null,
      user.id,
      now,
      decision === 'Rejected' ? 'Warden' : null,
      now,
      id,
    );
    recordEvent('leave_request', id, user.id, decision === 'Approved' ? 'warden_approved' : 'warden_rejected', { from: leave.status, to: decision, note: remarks });
    let outpassId: string | null = null;
    if (decision === 'Approved') {
      outpassId = issueOutpass({
        studentId: leave.student_id,
        sourceType: 'Leave',
        sourceId: id,
        title: `${leave.leave_type} Clearance`,
        validFrom: leave.departure_at || zonedIso(leave.from_date, '00:00:00'),
        validUntil: leave.return_at || zonedIso(leave.to_date, '23:59:00'),
        approvals: [leave.incharge_name && `Class Incharge: ${leave.incharge_name}`, leave.hod_name && `HOD: ${leave.hod_name}`, `Warden: ${user.name}`].filter(Boolean).join(' · '),
        remarks: remarks || 'Report back to the hostel before curfew on the return date.',
        gateDesk: 'Main Gate Security Desk',
        actorId: user.id,
      });
    }
    notifyStudentOfLeave(
      leave,
      decision === 'Approved' ? `Leave ${id} approved` : `Leave ${id} rejected by Warden`,
      decision === 'Approved' ? `Digital outpass ${outpassId} has been issued. Show it at the gate.` : remarks || 'Your leave request was rejected.',
      decision === 'Approved' ? 'success' : 'alert',
      `leave.warden:${id}`,
      decision === 'Approved' ? '/student/my-outpass' : '/student/leave-request-status',
    );
    // Both earlier approvers are told the outcome of the request they passed on.
    notify([leave.incharge_id, leave.hod_id], {
      eventType: `leave.${decision.toLowerCase()}`,
      title: `Leave ${id} ${decision.toLowerCase()} by Warden`,
      message: `${leave.student_name} (${leave.reg_number}).`,
      entityType: 'leave_request',
      entityId: id,
      link: '/notifications',
      dedupeKey: `leave.warden.staff:${id}`,
    });
    return mapLeave(getLeave(id), true);
  });
}

export function confirmParent(user: AuthUser, id: string, confirmed: boolean, note?: string) {
  const leave = getLeave(id);
  if (!['Pending Class Incharge', 'Pending HOD', 'Pending Warden'].includes(leave.status)) throw conflict('Parent confirmation can only change while the request is pending.');
  db().run(
    'UPDATE leave_requests SET parent_confirmed = ?, parent_confirmed_at = ?, parent_confirmed_by = ?, updated_at = ? WHERE id = ?',
    confirmed ? 1 : 0,
    confirmed ? nowIso() : null,
    confirmed ? user.id : null,
    nowIso(),
    id,
  );
  recordEvent('leave_request', id, user.id, confirmed ? 'parent_confirmed' : 'parent_confirmation_cleared', { note });
  return mapLeave(getLeave(id), true);
}

export function cancelLeave(user: AuthUser, id: string) {
  return db().transaction(() => {
    const leave = getLeave(id);
    if (leave.student_id !== user.studentId) throw notFound('Leave request');
    const pass = db().get<any>(`SELECT id, status FROM outpasses WHERE source_type = 'Leave' AND source_id = ?`, id);
    if (!['Pending Class Incharge', 'Pending HOD', 'Pending Warden', 'Approved'].includes(leave.status)) throw conflict(`A "${leave.status}" request cannot be cancelled.`);
    if (pass && pass.status !== 'Active') throw conflict('The outpass for this leave has already been used at the gate.');
    db().run(`UPDATE leave_requests SET status = 'Cancelled', updated_at = ? WHERE id = ?`, nowIso(), id);
    if (pass) db().run(`UPDATE outpasses SET status = 'Cancelled' WHERE id = ?`, pass.id);
    recordEvent('leave_request', id, user.id, 'cancelled_by_student', { from: leave.status, to: 'Cancelled' });
    return mapLeave(getLeave(id), true);
  });
}

// ---------------------------------------------------------------------------
// Outing requests
// ---------------------------------------------------------------------------
export const OUTING_SELECT = `
  o.*, s.name AS student_name, s.reg_number, s.department_code, s.year, s.phone AS student_phone, s.parent_name, s.parent_phone AS student_parent_phone,
  r.room_number, r.block, u.name AS decided_by_name,
  t.status AS tracking_status, t.last_update_at AS tracking_last_update, t.interruption_reason AS tracking_reason
  FROM outing_requests o
  JOIN students s ON s.id = o.student_id
  LEFT JOIN rooms r ON r.id = s.room_id
  LEFT JOIN users u ON u.id = o.decided_by
  LEFT JOIN outing_tracking t ON t.outing_id = o.id
`;

export function mapOuting(o: any, withHistory = false) {
  return {
    id: o.id,
    studentId: o.student_id,
    // Student portal fields
    dateTime: fmtDateTime(o.out_at),
    expectedReturn: fmtTime(o.expected_return_at),
    destination: o.destination,
    reason: o.reason,
    status: o.status,
    dateDisplay: fmtDate(o.out_at),
    outAt: o.out_at,
    expectedReturnAt: o.expected_return_at,
    outingType: o.outing_type,
    // Staff fields
    studentName: o.student_name,
    regNumber: o.reg_number,
    department: o.department_code,
    year: yearLabel(o.year),
    roomNumber: o.room_number || 'Unallocated',
    block: o.block || '',
    studentPhone: o.student_phone || '',
    parentName: o.parent_name || '',
    // The guardian number is staff-only; the student portal shows it masked.
    parentPhone: o.student_parent_phone || '',
    // Stage 1 — parent / guardian decision, which gates everything after it
    parentDecision: (o.parent_decision as 'Approved' | 'Rejected' | null) ?? null,
    parentDecidedAt: o.parent_decided_at ? fmtDateTime(o.parent_decided_at) : undefined,
    parentNote: o.parent_note || undefined,
    awaitingParent: o.status === 'Parent Approval Pending',
    locationConsent: o.location_consent === 1,
    // Stage 2 — Warden
    canDecide: o.status === 'Pending Warden',
    pendingStage: o.status === 'Parent Approval Pending' ? 'Parent/Guardian' : o.status === 'Pending Warden' ? 'Warden' : null,
    trackingStatus: o.tracking_status ?? null,
    trackingLastUpdate: o.tracking_last_update ? fmtDateTime(o.tracking_last_update) : null,
    trackingReason: o.tracking_reason ?? null,
    submittedAt: o.created_at,
    submittedDateTime: fmtDateTime(o.created_at),
    decidedBy: o.decided_by_name || undefined,
    decidedAt: o.decided_at ? fmtDateTime(o.decided_at) : undefined,
    remarks: o.remarks || undefined,
    history: withHistory ? getEvents('outing_request', o.id) : undefined,
  };
}

export function getOuting(id: string) {
  const row = db().get(`SELECT ${OUTING_SELECT} WHERE o.id = ?`, id);
  if (!row) throw notFound('Outing request');
  return row as any;
}

export function validateOutingWindow(outAt: string, returnAt: string, studentId: string, ignoreId?: string) {
  if (returnAt <= outAt) throw badRequest('Expected return must be after the outing start time.', { fields: { expectedReturnAt: 'Return must be after departure.' } });
  if (Date.parse(outAt) < Date.now() - 15 * 60_000) throw badRequest('Outing start time cannot be in the past.', { fields: { outAt: 'Start time cannot be in the past.' } });
  const overlap = db().get<any>(
    `SELECT id FROM outing_requests WHERE student_id = ? AND status IN ('Parent Approval Pending','Pending Warden','Approved') AND id != ? AND out_at < ? AND expected_return_at > ?`,
    studentId,
    ignoreId ?? '',
    returnAt,
    outAt,
  );
  if (overlap) throw conflict(`Outing request ${overlap.id} already covers this time.`);
}

export function wardenDecideOuting(user: AuthUser, id: string, decision: 'Approved' | 'Rejected', remarks: string | undefined) {
  return db().transaction(() => {
    const outing = getOuting(id);
    if (outing.status === 'Parent Approval Pending') throw conflict('This request is still awaiting the parent/guardian decision and cannot be approved yet.');
    if (outing.status !== 'Pending Warden') throw conflict(`This outing request is already "${outing.status}".`);
    if (decision === 'Rejected' && !remarks) throw badRequest('A reason is required when rejecting an outing request.', { fields: { remarks: 'Reason is required.' } });
    const now = nowIso();
    db().run('UPDATE outing_requests SET status = ?, decided_by = ?, decided_at = ?, remarks = ?, updated_at = ? WHERE id = ?', decision, user.id, now, remarks ?? null, now, id);
    recordEvent('outing_request', id, user.id, decision === 'Approved' ? 'approved' : 'rejected', { from: 'Pending Warden', to: decision, note: remarks });
    if (decision === 'Approved') {
      // Tracking becomes available for the approved window; nothing is collected
      // until the student's device actually reports in.
      ensureTracking(id, outing.student_id, outing.location_consent === 1);
    } else {
      stopTracking(id, 'Outing was not approved.');
    }
    let outpassId: string | null = null;
    if (decision === 'Approved') {
      outpassId = issueOutpass({
        studentId: outing.student_id,
        sourceType: 'Outing',
        sourceId: id,
        title: outing.destination,
        validFrom: outing.out_at,
        validUntil: outing.expected_return_at,
        approvals: `Warden: ${user.name}`,
        remarks: remarks || `Return by ${fmtTime(outing.expected_return_at)}.`,
        gateDesk: 'Main Gate Security Desk',
        actorId: user.id,
      });
    }
    notify([studentUserId(outing.student_id)], {
      eventType: decision === 'Approved' ? 'outing.approved' : 'outing.rejected',
      title: decision === 'Approved' ? `Outing to ${outing.destination} approved` : `Outing to ${outing.destination} rejected`,
      message: decision === 'Approved' ? `Digital outpass ${outpassId} issued. Return by ${fmtDateTime(outing.expected_return_at)}.` : remarks || 'Your outing request was rejected.',
      entityType: 'outing_request',
      entityId: id,
      link: decision === 'Approved' ? '/student/my-outpass' : '/student/outing-permission',
      severity: decision === 'Approved' ? 'success' : 'alert',
      dedupeKey: `outing.decided:${id}`,
    });
    return mapOuting(getOuting(id), true);
  });
}

// ---------------------------------------------------------------------------
// Outpasses
// ---------------------------------------------------------------------------
export function issueOutpass(input: {
  studentId: string;
  sourceType: 'Leave' | 'Outing';
  sourceId: string;
  title: string;
  validFrom: string;
  validUntil: string;
  approvals: string;
  remarks: string;
  gateDesk: string;
  actorId: string;
}): string {
  const id = nextCode(input.sourceType === 'Leave' ? 'OPL' : 'OPO');
  db().run(
    `INSERT INTO outpasses (id, student_id, source_type, source_id, title, valid_from, valid_until, status, gate_desk, approvals, remarks, qr_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?)`,
    id,
    input.studentId,
    input.sourceType,
    input.sourceId,
    input.title,
    input.validFrom,
    input.validUntil,
    input.gateDesk,
    input.approvals,
    input.remarks,
    `KVCET-${randomToken(12)}`,
    nowIso(),
  );
  recordEvent('outpass', id, input.actorId, 'issued', { to: 'Active', note: `${input.sourceType} ${input.sourceId}` });
  return id;
}

/** Effective display state; "Expired" is derived for unused passes past their validity. */
export function outpassDisplayStatus(p: any): 'Active' | 'Out' | 'Completed' | 'Expired' | 'Cancelled' {
  if (p.status === 'Active' && p.valid_until < nowIso()) return 'Expired';
  return p.status;
}

export function mapOutpass(p: any) {
  const status = outpassDisplayStatus(p);
  return {
    id: p.id,
    studentId: p.student_id,
    type: p.source_type,
    sourceId: p.source_id,
    title: p.title,
    dateRange: p.source_type === 'Leave' ? `${fmtDate(p.valid_from)} - ${fmtDate(p.valid_until)}` : fmtDate(p.valid_from),
    timeSlot: `${fmtTime(p.valid_from)} - ${fmtTime(p.valid_until)}`,
    validFrom: p.valid_from,
    validUntil: p.valid_until,
    // Student UI groups 'Active' (usable or currently out) vs 'Completed'/'Expired'
    status: status === 'Out' ? 'Active' : status,
    lifecycleStatus: status,
    gateCheckOutTime: p.checked_out_at ? fmtDateTime(p.checked_out_at) : undefined,
    gateCheckInTime: p.checked_in_at ? fmtDateTime(p.checked_in_at) : undefined,
    gateVerificationDesk: p.gate_desk || 'Main Gate Security Desk',
    approvals: p.approvals || '',
    remarks: p.remarks || '',
    isInsideCampus: p.status !== 'Out',
    isOverdueReturn: p.status === 'Out' && p.valid_until < nowIso(),
    qrToken: p.qr_token,
    studentName: p.student_name,
    regNumber: p.reg_number,
    roomNumber: p.room_number,
  };
}

export const OUTPASS_SELECT = `
  p.*, s.name AS student_name, s.reg_number, r.room_number
  FROM outpasses p JOIN students s ON s.id = p.student_id LEFT JOIN rooms r ON r.id = s.room_id
`;

/** Authorization coverage for a student at a given date: approved leave, approved outing, or being out on a pass. */
export function absenceAuthorization(studentId: string, date: string): string | null {
  const leave = db().get<any>(
    `SELECT id FROM leave_requests WHERE student_id = ? AND status = 'Approved' AND from_date <= ? AND to_date >= ?`,
    studentId,
    date,
    date,
  );
  if (leave) return `Approved leave ${leave.id}`;
  // Outing windows are instants; compare by local calendar date (UTC slices would be off near midnight IST).
  const outing = db()
    .all<any>(`SELECT id, out_at, expected_return_at FROM outing_requests WHERE student_id = ? AND status = 'Approved'`, studentId)
    .find((o) => localDate(o.out_at) <= date && localDate(o.expected_return_at) >= date);
  if (outing) return `Approved outing ${outing.id}`;
  if (date === localDate()) {
    const out = db().get<any>(`SELECT id FROM outpasses WHERE student_id = ? AND status = 'Out'`, studentId);
    if (out) return `Checked out on outpass ${out.id}`;
  }
  return null;
}
