import { Router } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { badRequest, conflict, created, notFound, ok, route } from '../lib/http';
import { audit, getEvents, notify, recordEvent } from '../lib/records';
import { getStudent, listStudents, mapStudent, STUDENT_FROM, STUDENT_SELECT } from '../lib/scope';
import { createStudent } from '../services/students';
import { addDays, dayEndIso, dayStartIso, fmtDate, fmtDateTime, fmtTime, localDate, nowIso, parseJson, uid, yearLabel } from '../lib/util';
import { Validator } from '../lib/validate';
import {
  confirmParent,
  getLeave,
  getOuting,
  LEAVE_SELECT,
  mapLeave,
  mapOuting,
  mapOutpass,
  OUTING_SELECT,
  wardenDecideLeave,
  wardenDecideOuting,
} from '../services/requests';
import { locationHistory, parentApprovalHistory, trackingView } from '../services/outings';
import {
  acceptComplaint,
  assertComplaintAccess,
  assignWorker,
  changeComplaintStatus,
  COMPLAINT_SELECT,
  COMPLAINT_STATUSES,
  complaintVisibility,
  confirmWorkerContact,
  createWorkOrderFromComplaint,
  getComplaintRow,
  listWorkers,
  mapComplaint,
  withWorkerContact,
} from '../services/complaints';
import { defaultSession } from '../services/attendance';

const router = Router();
router.use(requireRole('Warden'));

const count = (sql: string, ...p: unknown[]) => db().get<{ c: number }>(sql, ...p)!.c;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get(
  '/stats',
  route((_req, res) => {
    const today = localDate();
    const session = defaultSession();
    const residents = count(`SELECT COUNT(*) AS c FROM students WHERE enrollment_status = 'Active' AND is_hosteller = 1`);
    const out = db().all<any>(`SELECT source_type FROM outpasses WHERE status = 'Out'`);
    const recordedToday = count(`SELECT COUNT(*) AS c FROM attendance_records WHERE att_date = ? AND session = ?`, today, session);
    const activity = db()
      .all<any>(
        `SELECT e.*, u.name AS actor_name FROM entity_events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.entity_type IN ('leave_request','outing_request','complaint','incident','absence_case','outpass') ORDER BY e.id DESC LIMIT 8`,
      )
      .map((e) => ({
        id: e.id,
        entityType: e.entity_type,
        entityId: e.entity_id,
        action: e.action.replace(/_/g, ' '),
        toStatus: e.to_status,
        note: e.note,
        actor: e.actor_name || 'System',
        time: fmtDateTime(e.created_at),
      }));
    ok(res, {
      totalResidents: residents,
      onLeave: out.filter((o) => o.source_type === 'Leave').length,
      onOuting: out.filter((o) => o.source_type === 'Outing').length,
      currentlyInside: residents - out.length,
      pendingLeaveRequests: count(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'Pending Warden'`),
      awaitingAdviser: count(`SELECT COUNT(*) AS c FROM leave_requests WHERE status IN ('Pending Class Incharge','Pending HOD')`),
      awaitingClassIncharge: count(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'Pending Class Incharge'`),
      awaitingHOD: count(`SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'Pending HOD'`),
      pendingOutingRequests: count(`SELECT COUNT(*) AS c FROM outing_requests WHERE status = 'Pending'`),
      openComplaints: count(`SELECT COUNT(*) AS c FROM complaints WHERE is_about_warden = 0 AND status IN ('Submitted','Accepted','Worker Assigned','In Progress','Reopened')`),
      newComplaints: count(`SELECT COUNT(*) AS c FROM complaints WHERE is_about_warden = 0 AND status = 'Submitted'`),
      overdueComplaints: count(
        `SELECT COUNT(*) AS c FROM complaints WHERE is_about_warden = 0 AND deadline_at < ? AND status IN ('Submitted','Accepted','Worker Assigned','In Progress','Reopened')`,
        nowIso(),
      ),
      workOrdersAwaitingVerification: count(`SELECT COUNT(*) AS c FROM work_orders WHERE status = 'Pending Verification'`),
      activeOutpasses: count(`SELECT COUNT(*) AS c FROM outpasses WHERE status IN ('Active','Out') AND valid_until >= ?`, nowIso()),
      overdueReturns: count(`SELECT COUNT(*) AS c FROM outpasses WHERE status = 'Out' AND valid_until < ?`, nowIso()),
      attendance: { date: today, session, recorded: recordedToday, expected: residents, completionPct: residents ? Math.round((recordedToday / residents) * 1000) / 10 : null },
      absencesPendingVerification: count(`SELECT COUNT(*) AS c FROM absence_cases WHERE status IN ('Pending Verification','Suspected Unauthorized')`),
      openIncidents: count(`SELECT COUNT(*) AS c FROM incidents WHERE status IN ('Pending Review','Under Investigation')`),
      upcomingStudySessions: count(`SELECT COUNT(*) AS c FROM study_sessions WHERE status = 'Scheduled' AND session_date >= ?`, today),
      recentActivity: activity,
    });
  }),
);

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------
router.get(
  '/students',
  route((req, res) => ok(res, listStudents(req.user!, `s.enrollment_status = 'Active' AND s.is_hosteller = 1`))),
);

router.get(
  '/students/:id',
  route((req, res) => {
    const student = getStudent(req.user!, req.params.id);
    const attendance = db().all<any>('SELECT att_date, session, status FROM attendance_records WHERE student_id = ? ORDER BY att_date DESC LIMIT 60', student.id);
    ok(res, {
      ...student,
      leaves: db().all(`SELECT ${LEAVE_SELECT} WHERE l.student_id = ? ORDER BY l.created_at DESC LIMIT 20`, student.id).map((l) => mapLeave(l)),
      outings: db().all(`SELECT ${OUTING_SELECT} WHERE o.student_id = ? AND o.status != 'Draft' ORDER BY o.created_at DESC LIMIT 20`, student.id).map((o) => mapOuting(o)),
      attendance: attendance.map((a) => ({ date: fmtDate(a.att_date), session: a.session, status: a.status })),
      attendanceSummary: {
        recorded: attendance.length,
        present: attendance.filter((a) => a.status === 'Present').length,
        absent: attendance.filter((a) => a.status === 'Absent').length,
      },
      absenceCases: db().all<any>('SELECT id, att_date, status FROM absence_cases WHERE student_id = ? ORDER BY att_date DESC', student.id).map((c) => ({ id: c.id, date: fmtDate(c.att_date), status: c.status })),
    });
  }),
);

router.patch(
  '/students/:id',
  route((req, res) => {
    getStudent(req.user!, req.params.id);
    const v = new Validator(req.body);
    const fields = {
      phone: v.string('contactNumber', { required: false, max: 30 }),
      parent_name: v.string('parentName', { required: false, max: 120 }),
      parent_phone: v.string('parentNumber', { required: false, max: 30 }),
      address: v.string('permanentAddress', { required: false, max: 300 }),
      blood_group: v.string('bloodGroup', { required: false, max: 5 }),
      medical_notes: v.string('medicalNotes', { required: false, max: 500 }),
    };
    v.done();
    const set = Object.entries(fields).filter(([, val]) => val !== undefined);
    if (!set.length) throw badRequest('No changes provided.');
    db().run(`UPDATE students SET ${set.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...set.map(([, val]) => val), nowIso(), req.params.id);
    audit(req, 'student.updated_by_warden', 'student', req.params.id, { fields: set.map(([k]) => k) });
    ok(res, getStudent(req.user!, req.params.id), { message: 'Student record updated.' });
  }),
);

// ---------------------------------------------------------------------------
// Leave requests
// ---------------------------------------------------------------------------
router.get(
  '/leave-requests',
  route((req, res) => {
    // `?pending=1` is strictly what the Warden may act on: both earlier stages approved.
    const pendingOnly = req.query.pending === '1';
    const rows = db().all(
      `SELECT ${LEAVE_SELECT} WHERE l.status != 'Cancelled' ${pendingOnly ? `AND l.status = 'Pending Warden'` : ''}
       ORDER BY CASE l.status WHEN 'Pending Warden' THEN 0 WHEN 'Pending HOD' THEN 1 WHEN 'Pending Class Incharge' THEN 2 ELSE 3 END, l.created_at DESC`,
    );
    ok(
      res,
      rows.map((l: any) => ({ ...mapLeave(l), canDecide: l.status === 'Pending Warden' })),
    );
  }),
);

router.get(
  '/leave-requests/:id',
  route((req, res) => ok(res, mapLeave(getLeave(req.params.id), true))),
);

router.post(
  '/leave-requests/:id/decision',
  route((req, res) => {
    const v = new Validator(req.body);
    const decision = v.oneOf('decision', ['Approved', 'Rejected'] as const, { label: 'Decision' });
    const remarks = v.string('remarks', { required: false, max: 500, label: 'Remarks' });
    v.done();
    const leave = wardenDecideLeave(req.user!, req.params.id, decision!, remarks);
    audit(req, `leave.${decision!.toLowerCase()}`, 'leave_request', leave.id, { remarks });
    ok(res, leave, { message: `Leave request ${leave.id} ${decision!.toLowerCase()}.` });
  }),
);

router.post(
  '/leave-requests/:id/parent-confirmation',
  route((req, res) => {
    const v = new Validator(req.body);
    const confirmed = v.bool('confirmed', true);
    const note = v.string('note', { required: false, max: 300 });
    v.done();
    const leave = confirmParent(req.user!, req.params.id, confirmed, note);
    audit(req, 'leave.parent_confirmation', 'leave_request', leave.id, { confirmed });
    ok(res, leave, { message: confirmed ? 'Parent confirmation recorded.' : 'Parent confirmation cleared.' });
  }),
);

// ---------------------------------------------------------------------------
// Outing requests
// ---------------------------------------------------------------------------
/**
 * The Warden's outing queue. A request only enters it once a verified parent or
 * guardian decision exists — 'Parent Approval Pending' rows are excluded at the
 * query level, not hidden in the UI.
 */
router.get(
  '/outing-requests',
  route((req, res) => {
    const pendingOnly = req.query.pending === '1';
    const rows = db().all(
      `SELECT ${OUTING_SELECT} WHERE o.status IN ('Pending Warden','Approved','Rejected') ${pendingOnly ? `AND o.status = 'Pending Warden'` : ''}
       ORDER BY CASE o.status WHEN 'Pending Warden' THEN 0 ELSE 1 END, o.out_at DESC`,
    );
    ok(
      res,
      rows.map((o: any) => ({ ...mapOuting(o), tracking: trackingView(o.id, req.user!), parentApprovals: parentApprovalHistory(o.id) })),
    );
  }),
);

/** Live location state and history for one approved outing. */
router.get(
  '/outing-requests/:id/tracking',
  route((req, res) => {
    const o = getOuting(req.params.id);
    ok(res, { tracking: trackingView(o.id, req.user!), parentApprovals: parentApprovalHistory(o.id), history: locationHistory(o.id, 50) });
  }),
);

router.get(
  '/outing-requests/:id',
  route((req, res) => ok(res, mapOuting(getOuting(req.params.id), true))),
);

router.post(
  '/outing-requests/:id/decision',
  route((req, res) => {
    const v = new Validator(req.body);
    const decision = v.oneOf('decision', ['Approved', 'Rejected'] as const, { label: 'Decision' });
    const remarks = v.string('remarks', { required: false, max: 500 });
    v.done();
    const outing = wardenDecideOuting(req.user!, req.params.id, decision!, remarks);
    audit(req, `outing.${decision!.toLowerCase()}`, 'outing_request', outing.id, { remarks });
    ok(res, outing, { message: `Outing request ${outing.id} ${decision!.toLowerCase()}.` });
  }),
);

// ---------------------------------------------------------------------------
// Log book: approved movements with their outpass state
// ---------------------------------------------------------------------------
router.get(
  '/log-book',
  route((req, res) => {
    const from = String(req.query.from || addDays(localDate(), -30));
    const passes = db().all<any>(
      `SELECT p.*, s.name AS student_name, s.reg_number, s.parent_phone, s.department_code, s.year, r.room_number
       FROM outpasses p JOIN students s ON s.id = p.student_id LEFT JOIN rooms r ON r.id = s.room_id
       WHERE p.status != 'Cancelled' AND p.valid_from >= ? ORDER BY p.valid_from DESC`,
      dayStartIso(from),
    );
    const rows = passes.map((p) => {
      const src =
        p.source_type === 'Leave'
          ? db().get<any>('SELECT l.leave_type AS kind, l.document_name, l.parent_confirmed, l.warden_decided_at, u.name AS approver FROM leave_requests l LEFT JOIN users u ON u.id = l.warden_id WHERE l.id = ?', p.source_id)
          : db().get<any>('SELECT o.outing_type AS kind, o.destination, o.decided_at AS warden_decided_at, u.name AS approver FROM outing_requests o LEFT JOIN users u ON u.id = o.decided_by WHERE o.id = ?', p.source_id);
      const pass = mapOutpass(p);
      return {
        id: p.id,
        dateTime: fmtDateTime(p.valid_from),
        date: fmtDate(p.valid_from),
        time: fmtTime(p.valid_from),
        studentName: p.student_name,
        regNumber: p.reg_number,
        parentNumber: p.parent_phone || '—',
        roomNumber: p.room_number || '—',
        department: p.department_code,
        year: yearLabel(p.year),
        destination: p.source_type === 'Outing' ? src?.destination || p.title : p.title,
        leaveType: src?.kind || p.source_type,
        category: p.source_type,
        file: src?.document_name || undefined,
        approvalStatus: 'Approved',
        approvedBy: src?.approver || '—',
        approvedOn: src?.warden_decided_at ? fmtDateTime(src.warden_decided_at) : '—',
        outTime: p.checked_out_at ? fmtDateTime(p.checked_out_at) : 'Not yet out',
        expectedReturn: fmtDateTime(p.valid_until),
        returnedAt: p.checked_in_at ? fmtDateTime(p.checked_in_at) : null,
        inTime: p.checked_in_at ? fmtDateTime(p.checked_in_at) : 'Not returned',
        parentApproval: p.source_type === 'Leave' ? (src?.parent_confirmed ? 'Confirmed' : 'Not recorded') : 'Not required',
        leaveDuration: p.source_type === 'Leave' ? `${Math.round((Date.parse(p.valid_until) - Date.parse(p.valid_from)) / 86_400_000) || 1} day(s)` : undefined,
        passStatus: pass.lifecycleStatus,
        isOverdueReturn: pass.isOverdueReturn,
        sourceId: p.source_id,
      };
    });
    ok(res, rows);
  }),
);

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------
/**
 * The Warden's complaint queue. Complaints whose category routes to the AO
 * (complaints about the Warden) are excluded at the query level, not hidden in the UI.
 */
router.get(
  '/complaints',
  route((req, res) => {
    ok(
      res,
      db()
        .all(
          `SELECT ${COMPLAINT_SELECT} WHERE ${complaintVisibility(req.user!)}
           ORDER BY CASE c.status WHEN 'Submitted' THEN 0 WHEN 'Reopened' THEN 1 WHEN 'Accepted' THEN 2 WHEN 'Worker Assigned' THEN 3 WHEN 'In Progress' THEN 4 ELSE 5 END,
             c.deadline_at IS NULL, c.deadline_at`,
        )
        .map((c: any) => withWorkerContact(mapComplaint(c), c, req.user!)),
    );
  }),
);

/** Workers the Warden can assign, with the phone numbers their role is allowed to see. */
router.get(
  '/workers',
  route((_req, res) => ok(res, listWorkers())),
);

router.get(
  '/complaints/:id',
  route((req, res) => {
    const c = getComplaintRow(req.params.id);
    assertComplaintAccess(req.user!, c);
    ok(res, withWorkerContact(mapComplaint(c, true), c, req.user!));
  }),
);

/**
 * Accepting is the Warden's only step: the response reports which trade the
 * issue was read as, which worker it went to and whether the job reached them.
 */
router.post(
  '/complaints/:id/accept',
  route(async (req, res) => {
    const v = new Validator(req.body);
    const note = v.string('note', { required: false, max: 1000 });
    v.done();
    const c = await acceptComplaint(req.user!, req.params.id, note);
    audit(req, 'complaint.accepted', 'complaint', c.id, {
      autoWorkerId: c.autoRouting.worker?.id ?? null,
      detectedTrade: c.autoRouting.detectedTrade,
      detectionSource: c.autoRouting.detectionSource,
      dispatchStatus: c.autoRouting.dispatch?.status ?? null,
    });
    ok(res, c, { message: `Complaint ${c.id} accepted. ${c.autoRouting.summary}` });
  }),
);

/** Manual override, for a trade with no worker or a job that must change hands. */
router.post(
  '/complaints/:id/assign-worker',
  route(async (req, res) => {
    const v = new Validator(req.body);
    const workerId = v.string('workerId', { max: 80, label: 'Worker' });
    const note = v.string('note', { required: false, max: 1000 });
    v.done();
    const c = await assignWorker(req.user!, req.params.id, workerId!, note);
    audit(req, 'complaint.worker_assigned', 'complaint', c.id, { workerId, dispatchStatus: c.dispatch.status });
    ok(res, c, {
      message:
        c.dispatch.status === 'Sent'
          ? `${c.workerName} assigned to complaint ${c.id} and sent the job on WhatsApp.`
          : `${c.workerName} assigned to complaint ${c.id}. The WhatsApp job could not be delivered (${c.dispatch.status}) — call them instead.`,
    });
  }),
);

/**
 * Records that the Warden contacted the worker. The system does not place calls; it
 * shows the number and stores the Warden's own confirmation.
 */
router.post(
  '/complaints/:id/contact-worker',
  route((req, res) => {
    const v = new Validator(req.body);
    const note = v.string('note', { min: 3, max: 1000, label: 'Contact note' });
    v.done();
    const c = confirmWorkerContact(req.user!, req.params.id, note!);
    audit(req, 'complaint.worker_contacted', 'complaint', c.id);
    ok(res, c, { message: `Contact with ${c.workerName ?? 'the worker'} recorded for complaint ${c.id}.` });
  }),
);

router.patch(
  '/complaints/:id',
  route((req, res) => {
    const v = new Validator(req.body);
    const status = v.oneOf('status', COMPLAINT_STATUSES, { label: 'Status' });
    const note = v.string('note', { required: false, max: 1000 });
    const resolutionNotes = v.string('resolutionNotes', { required: status === 'Resolved', max: 2000, label: 'Resolution details' });
    v.done();
    const c = changeComplaintStatus(req.user!, req.params.id, status!, { note, resolutionNotes });
    audit(req, 'complaint.status_changed', 'complaint', c.id, { status });
    ok(res, c, { message: `Complaint ${c.id} is now ${status}.` });
  }),
);

router.post(
  '/complaints/:id/work-order',
  route((req, res) => {
    const v = new Validator(req.body);
    const remarks = v.string('remarks', { required: false, max: 1000 });
    const targetDate = v.date('targetDate', { required: false, label: 'Target date' });
    v.done();
    const c = createWorkOrderFromComplaint(req.user!, req.params.id, { remarks, targetDate });
    audit(req, 'complaint.work_order_created', 'complaint', c.id, { workOrderId: c.workOrderId });
    ok(res, c, { message: `Work order ${c.workOrderId} sent to the AO maintenance desk.` });
  }),
);

/**
 * Warden gate logbook. It reads the same canonical gate_movements events the
 * Security logbook shows, so timestamps and details can never drift apart.
 */
router.get(
  '/gate-log',
  route((req, res) => {
    const from = String(req.query.from || addDays(localDate(), -30));
    const to = String(req.query.to || localDate());
    const type = String(req.query.type || '');
    const result = String(req.query.result || '');
    const studentId = String(req.query.studentId || '');
    const outingId = String(req.query.outingId || '');
    const where = ['g.occurred_at >= ?', 'g.occurred_at <= ?'];
    const params: unknown[] = [dayStartIso(from), dayEndIso(to)];
    if (type === 'Entry' || type === 'Exit') {
      where.push('g.movement_type = ?');
      params.push(type);
    }
    if (result) {
      where.push('g.status = ?');
      params.push(result);
    }
    if (studentId) {
      where.push('g.student_id = ?');
      params.push(studentId);
    }
    if (outingId) {
      where.push('g.outing_id = ?');
      params.push(outingId);
    }
    const rows = db().all<any>(
      `SELECT g.*, u.name AS recorded_by_name, s.department_code, s.year
       FROM gate_movements g LEFT JOIN users u ON u.id = g.recorded_by LEFT JOIN students s ON s.id = g.student_id
       WHERE ${where.join(' AND ')} ORDER BY g.occurred_at DESC LIMIT 1000`,
      ...params,
    );
    ok(
      res,
      rows.map((g) => ({
        id: g.id,
        studentId: g.student_id,
        studentName: g.name,
        regNumber: g.reg_number,
        roomNumber: g.room_number || '—',
        block: g.block || '',
        department: g.department_code ?? '',
        year: yearLabel(g.year),
        type: g.movement_type,
        gate: g.gate,
        deviceId: g.device_id,
        destination: g.destination,
        occurredAt: g.occurred_at,
        occurredAtDisplay: fmtDateTime(g.occurred_at),
        result: g.status,
        rejectionReason: g.rejection_reason,
        notes: g.notes,
        securityNotes: g.security_notes,
        outpassId: g.outpass_id,
        outingId: g.outing_id,
        recordedBy: g.recorded_by_name ?? 'System',
      })),
    );
  }),
);

// ---------------------------------------------------------------------------
// Rooms and allocation
// ---------------------------------------------------------------------------
function mapRoom(r: any) {
  const occupants = db()
    .all<any>(`SELECT id, name, reg_number, department_code, year, phone FROM students WHERE room_id = ? AND enrollment_status = 'Active' ORDER BY name`, r.id)
    .map((s) => ({ id: s.id, name: s.name, regNumber: s.reg_number, department: s.department_code, year: yearLabel(s.year), phone: s.phone || '' }));
  const occupied = occupants.length;
  return {
    id: r.id,
    roomNumber: r.room_number,
    block: r.block,
    floor: r.floor,
    capacity: r.capacity,
    occupied,
    roomType: r.room_type,
    status: occupied === 0 ? 'Available' : occupied >= r.capacity ? 'Full' : 'Partially Filled',
    occupants,
    amenities: parseJson<string[]>(r.amenities_json, []),
    isActive: r.is_active === 1,
  };
}

router.get(
  '/rooms',
  route((_req, res) => ok(res, db().all('SELECT * FROM rooms WHERE is_active = 1 ORDER BY block, floor, room_number').map(mapRoom))),
);

router.post(
  '/rooms',
  route((req, res) => {
    const v = new Validator(req.body);
    const roomNumber = v.string('roomNumber', { max: 20, label: 'Room number' });
    const block = v.string('block', { required: false, max: 40, label: 'Block' });
    const floor = v.int('floor', { min: 0, max: 50, label: 'Floor' });
    const capacity = v.int('capacity', { min: 1, max: 12, label: 'Capacity' });
    const roomType = v.oneOf('roomType', ['Single', 'Double', 'Triple', 'Four Sharing', 'Shared'] as const, { label: 'Room type' });
    const amenities = v.stringArray('amenities', { max: 20 });
    v.done();
    if (db().get('SELECT 1 FROM rooms WHERE room_number = ?', roomNumber)) throw conflict(`Room ${roomNumber} already exists.`);
    const id = uid('room');
    db().run(
      'INSERT INTO rooms (id, room_number, block, floor, capacity, room_type, amenities_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      roomNumber,
      block ?? '',
      floor,
      capacity,
      roomType,
      JSON.stringify(amenities),
      nowIso(),
    );
    audit(req, 'room.created', 'room', id, { roomNumber });
    created(res, mapRoom(db().get('SELECT * FROM rooms WHERE id = ?', id)), `Room ${roomNumber} added.`);
  }),
);

router.patch(
  '/rooms/:id',
  route((req, res) => {
    const room = db().get<any>('SELECT * FROM rooms WHERE id = ?', req.params.id);
    if (!room) throw notFound('Room');
    const v = new Validator(req.body);
    const capacity = v.int('capacity', { required: false, min: 1, max: 12, label: 'Capacity' });
    const roomType = v.oneOf('roomType', ['Single', 'Double', 'Triple', 'Four Sharing', 'Shared'] as const, { required: false });
    const amenities = req.body?.amenities !== undefined ? v.stringArray('amenities', { max: 20 }) : undefined;
    v.done();
    const occupied = count(`SELECT COUNT(*) AS c FROM students WHERE room_id = ? AND enrollment_status = 'Active'`, room.id);
    if (capacity !== undefined && capacity < occupied) throw conflict(`Room ${room.room_number} has ${occupied} occupant(s); capacity cannot be lower.`);
    db().run(
      'UPDATE rooms SET capacity = COALESCE(?, capacity), room_type = COALESCE(?, room_type), amenities_json = COALESCE(?, amenities_json) WHERE id = ?',
      capacity ?? null,
      roomType ?? null,
      amenities ? JSON.stringify(amenities) : null,
      room.id,
    );
    audit(req, 'room.updated', 'room', room.id, { capacity, roomType });
    ok(res, mapRoom(db().get('SELECT * FROM rooms WHERE id = ?', room.id)), { message: `Room ${room.room_number} updated.` });
  }),
);

/** Allocate (or move) a student into a room, enforcing capacity atomically. */
router.post(
  '/rooms/:id/allocate',
  route((req, res) => {
    const v = new Validator(req.body);
    const studentId = v.string('studentId', { max: 80, label: 'Student' });
    v.done();
    const result = db().transaction(() => {
      const room = db().get<any>('SELECT * FROM rooms WHERE id = ? AND is_active = 1', req.params.id);
      if (!room) throw notFound('Room');
      const student = db().get<any>(`SELECT s.id, s.name, s.room_id, s.user_id, r.room_number AS old_room FROM students s LEFT JOIN rooms r ON r.id = s.room_id WHERE s.id = ? AND s.enrollment_status = 'Active'`, studentId);
      if (!student) throw notFound('Student');
      if (student.room_id === room.id) throw conflict(`${student.name} is already in room ${room.room_number}.`);
      const occupied = count(`SELECT COUNT(*) AS c FROM students WHERE room_id = ? AND enrollment_status = 'Active'`, room.id);
      if (occupied >= room.capacity) throw conflict(`Room ${room.room_number} is full (${occupied}/${room.capacity}).`);
      db().run('UPDATE students SET room_id = ?, updated_at = ? WHERE id = ?', room.id, nowIso(), student.id);
      recordEvent('student', student.id, req.user!.id, student.room_id ? 'room_transferred' : 'room_allocated', { from: student.old_room, to: room.room_number });
      notify([student.user_id], {
        eventType: 'room.allocated',
        title: student.room_id ? `Room changed to ${room.room_number}` : `Room ${room.room_number} allocated`,
        message: `${room.block ? `${room.block}, ` : ''}floor ${room.floor}.`,
        entityType: 'room',
        entityId: room.id,
        link: '/student/profile',
        severity: 'info',
      });
      return { room, student };
    });
    audit(req, 'room.allocated', 'room', result.room.id, { studentId, from: result.student.old_room });
    ok(res, mapRoom(db().get('SELECT * FROM rooms WHERE id = ?', result.room.id)), {
      message: `${result.student.name} ${result.student.room_id ? 'moved' : 'allocated'} to ${result.room.room_number}.`,
    });
  }),
);

router.post(
  '/rooms/vacate',
  route((req, res) => {
    const v = new Validator(req.body);
    const studentId = v.string('studentId', { max: 80, label: 'Student' });
    const reason = v.string('reason', { required: false, max: 300 });
    v.done();
    const student = db().get<any>('SELECT s.id, s.name, s.room_id, r.room_number FROM students s LEFT JOIN rooms r ON r.id = s.room_id WHERE s.id = ?', studentId);
    if (!student) throw notFound('Student');
    if (!student.room_id) throw conflict(`${student.name} has no room allocated.`);
    db().run('UPDATE students SET room_id = NULL, updated_at = ? WHERE id = ?', nowIso(), student.id);
    recordEvent('student', student.id, req.user!.id, 'room_vacated', { from: student.room_number, note: reason });
    audit(req, 'room.vacated', 'room', student.room_id, { studentId, reason });
    ok(res, mapRoom(db().get('SELECT * FROM rooms WHERE id = ?', student.room_id)), { message: `${student.name} removed from ${student.room_number}.` });
  }),
);

router.get(
  '/rooms/unallocated-students',
  route((_req, res) => {
    ok(
      res,
      db()
        .all<any>(`SELECT id, name, reg_number, department_code, year, gender FROM students WHERE room_id IS NULL AND enrollment_status = 'Active' AND is_hosteller = 1 ORDER BY name`)
        .map((s) => ({ id: s.id, name: s.name, regNumber: s.reg_number, department: s.department_code, year: yearLabel(s.year), gender: s.gender || '' })),
    );
  }),
);

/**
 * New student intake. The sign-in password is generated from the student's own details
 * (first name + first four digits of their phone) and returned once, to be handed over.
 */
router.post(
  '/students',
  route((req, res) => {
    const result = createStudent(req.user!.id, req.body);
    audit(req, 'warden.student_created', 'student', result.id, { regNumber: result.regNumber, login: !!result.password });
    created(
      res,
      { ...mapStudent(db().get(`SELECT ${STUDENT_SELECT} FROM ${STUDENT_FROM} WHERE s.id = ?`, result.id)), initialPassword: result.password },
      result.password
        ? `Student ${result.regNumber} added${result.provisional ? ' with a provisional register number' : ''}. Sign-in password: ${result.password}`
        : `Student ${result.regNumber} added without a sign-in (no email given).`,
    );
  }),
);

// ---------------------------------------------------------------------------
// Reports (computed from records for the selected period)
// ---------------------------------------------------------------------------
/** Audit actions the Warden office performs, in the words used on the printed report. */
const ACTIVITY_LABELS: Record<string, string> = {
  'leave.approved': 'Approved a leave request',
  'leave.rejected': 'Rejected a leave request',
  'leave.parent_confirmation': 'Recorded the parent confirmation for a leave request',
  'outing.approved': 'Approved an outing request',
  'outing.rejected': 'Rejected an outing request',
  'outing.parent_approval_resent': 'Re-sent the parent approval request for an outing',
  'complaint.accepted': 'Accepted a maintenance complaint (the worker is routed automatically)',
  'complaint.worker_assigned': 'Assigned a worker to a complaint by hand',
  'complaint.worker_contacted': 'Recorded a call with the assigned worker',
  'complaint.work_order_created': 'Raised a work order for a complaint',
  'complaint.status_changed': 'Moved a complaint to a new status',
  'attendance.marked': 'Recorded roll-call attendance',
  'attendance.closed': 'Closed the night roll call',
  'absence.verify_unauthorized': 'Verified an absence as unauthorized',
  'absence.authorize': 'Authorized an absence',
  'absence.resolve': 'Closed an absence follow-up',
  'absence.add_note': 'Added a note to an absence record',
  'absence.follow_up_requested': 'Requested a follow-up on an absence',
  'incident.created': 'Filed an incident report',
  'incident.reviewed': 'Added an update to an incident report',
  'room.created': 'Added a hostel room',
  'room.updated': 'Updated a hostel room',
  'room.allocated': 'Allocated a student to a room',
  'room.vacated': 'Vacated a student from a room',
  'student.updated_by_warden': 'Updated a student record',
  'security.scan': 'Recorded a gate movement',
  'security.gate_note': 'Added a note to a gate event',
  'study_session.created': 'Scheduled a study session',
  'study_session.updated': 'Updated a study session',
  'study_session.attendance': 'Recorded study-session attendance',
  'followup.created': 'Opened a student follow-up',
  'followup.updated': 'Updated a student follow-up',
};
router.get(
  '/reports',
  route((req, res) => {
    const period = String(req.query.period || 'week');
    const to = localDate();
    const from = period === 'month' ? addDays(to, -29) : period === 'semester' ? addDays(to, -179) : addDays(to, -6);
    const fromIso = dayStartIso(from);
    const session = defaultSession();
    const complaintsByCategory = db().all<any>(`SELECT category, COUNT(*) AS c FROM complaints WHERE created_at >= ? GROUP BY category ORDER BY c DESC`, fromIso);
    const att = db().get<any>(
      `SELECT COUNT(*) AS total, SUM(status = 'Present') AS present FROM attendance_records WHERE att_date BETWEEN ? AND ? AND session = ?`,
      from,
      to,
      session,
    );
    const discipline = db().all<any>(
      `SELECT s.id, s.name, s.reg_number, r.room_number,
         (SELECT COUNT(*) FROM gate_movements g WHERE g.student_id = s.id AND g.status = 'Flagged' AND g.occurred_at >= ?) AS flagged_moves,
         (SELECT COUNT(*) FROM study_attendance sa JOIN study_sessions ss ON ss.id = sa.session_id WHERE sa.student_id = s.id AND sa.status = 'Absent' AND ss.session_date BETWEEN ? AND ?) AS study_absent,
         (SELECT COUNT(*) FROM absence_cases c WHERE c.student_id = s.id AND c.status IN ('Verified Unauthorized','Resolved') AND c.verified_at IS NOT NULL AND c.att_date BETWEEN ? AND ?) AS unauth,
         (SELECT COUNT(*) FROM incidents i WHERE i.student_id = s.id AND i.created_at >= ?) AS incidents
       FROM students s LEFT JOIN rooms r ON r.id = s.room_id WHERE s.enrollment_status = 'Active'`,
      fromIso,
      from,
      to,
      from,
      to,
      fromIso,
    );
    // What the Warden office actually did in the period, read back from the audit log.
    const actions = db().all<any>(
      `SELECT a.action, a.entity_type, a.entity_id, a.details_json, a.created_at, u.name AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.actor_role = 'Warden' AND a.created_at >= ? ORDER BY a.created_at DESC LIMIT 400`,
      fromIso,
    );
    const activityTally = new Map<string, number>();
    for (const a of actions) if (ACTIVITY_LABELS[a.action]) activityTally.set(a.action, (activityTally.get(a.action) ?? 0) + 1);

    ok(res, {
      period,
      from,
      to,
      label: `${fmtDate(from)} - ${fmtDate(to)}`,
      preparedBy: req.user!.name,
      activitySummary: [...activityTally.entries()].sort((x, y) => y[1] - x[1]).map(([action, count]) => ({ action: ACTIVITY_LABELS[action], count })),
      activity: actions
        .filter((a) => ACTIVITY_LABELS[a.action])
        .slice(0, 150)
        .map((a) => ({
          at: fmtDateTime(a.created_at),
          action: ACTIVITY_LABELS[a.action],
          reference: a.entity_id ?? '—',
          by: a.actor_name ?? 'Warden office',
          detail: activityDetail(a),
        })),
      totalStudents: count(`SELECT COUNT(*) AS c FROM students WHERE enrollment_status = 'Active' AND is_hosteller = 1`),
      studentsOnLeave: count(`SELECT COUNT(*) AS c FROM outpasses WHERE status = 'Out' AND source_type = 'Leave'`),
      leaveRequests: count('SELECT COUNT(*) AS c FROM leave_requests WHERE created_at >= ?', fromIso),
      pendingLeave: count(`SELECT COUNT(*) AS c FROM leave_requests WHERE status IN ('Pending Class Incharge','Pending HOD','Pending Warden')`),
      outingRequests: count(`SELECT COUNT(*) AS c FROM outing_requests WHERE status != 'Draft' AND created_at >= ?`, fromIso),
      pendingOuting: count(`SELECT COUNT(*) AS c FROM outing_requests WHERE status = 'Pending'`),
      complaints: count('SELECT COUNT(*) AS c FROM complaints WHERE created_at >= ?', fromIso),
      pendingComplaints: count(`SELECT COUNT(*) AS c FROM complaints WHERE status NOT IN ('Resolved','Closed')`),
      complaintsByCategory: complaintsByCategory.map((c) => ({ category: c.category, count: c.c })),
      attendance: { recorded: att.total || 0, present: att.present || 0, ratePct: att.total ? Math.round((att.present / att.total) * 1000) / 10 : null },
      verifiedUnauthorizedAbsences: count(`SELECT COUNT(*) AS c FROM absence_cases WHERE verified_at IS NOT NULL AND status IN ('Verified Unauthorized','Resolved') AND att_date BETWEEN ? AND ?`, from, to),
      lateReturns: count(`SELECT COUNT(*) AS c FROM gate_movements WHERE status = 'Flagged' AND movement_type = 'Entry' AND occurred_at >= ?`, fromIso),
      disciplineWatch: discipline
        .map((d) => ({ studentId: d.id, name: d.name, regNo: d.reg_number, room: d.room_number || '—', flaggedGateMovements: d.flagged_moves, studyAbsent: d.study_absent, unauthorizedAbsences: d.unauth, incidents: d.incidents }))
        .filter((d) => d.flaggedGateMovements + d.studyAbsent + d.unauthorizedAbsences + d.incidents > 0)
        .sort((a, b) => b.flaggedGateMovements + b.studyAbsent + b.unauthorizedAbsences + b.incidents - (a.flaggedGateMovements + a.studyAbsent + a.unauthorizedAbsences + a.incidents))
        .slice(0, 20),
      gateMovements: count('SELECT COUNT(*) AS c FROM gate_movements WHERE occurred_at >= ?', fromIso),
      generatedAt: fmtDateTime(nowIso()),
    });
  }),
);

/** One short, readable line of context for an audited action, from its stored details. */
function activityDetail(row: { action: string; entity_type: string | null; details_json: string | null }) {
  const d = parseJson<Record<string, any>>(row.details_json, {});
  const workerId = d.workerId ?? d.autoWorkerId;
  if ((row.action === 'complaint.worker_assigned' || row.action === 'complaint.accepted') && workerId) {
    const w = db().get<{ name: string; role: string | null; category: string }>('SELECT name, role, category FROM technicians WHERE id = ?', workerId);
    if (w) {
      const how = row.action === 'complaint.accepted' ? 'Auto-assigned' : 'Worker';
      return `${how}: ${w.name}${w.role ? ` (${w.role})` : ''} · ${w.category}${d.dispatchStatus ? ` · WhatsApp job ${d.dispatchStatus}` : ''}`;
    }
  }
  if (row.action === 'complaint.accepted' && d.detectedTrade) return `No worker available for ${d.detectedTrade}`;
  if (d.studentId) {
    const st = db().get<{ name: string; reg_number: string }>('SELECT name, reg_number FROM students WHERE id = ?', d.studentId);
    if (st) return `${st.name} (${st.reg_number})`;
  }
  if (row.action === 'attendance.marked' && d.count) return `${d.count} student record(s)`;
  if (row.action === 'attendance.closed') return `${d.escalated ?? 0} absence(s) flagged, ${d.notRecorded ?? 0} not recorded`;
  if (typeof d.status === 'string') return `Status: ${d.status}`;
  if (typeof d.remarks === 'string' && d.remarks) return d.remarks;
  if (typeof d.note === 'string' && d.note) return d.note;
  if (typeof d.reason === 'string' && d.reason) return d.reason;
  if (typeof d.roomNumber === 'string') return `Room ${d.roomNumber}`;
  return '—';
}

router.get(
  '/history/:type/:id',
  route((req, res) => {
    const allowed = ['leave_request', 'outing_request', 'complaint', 'outpass', 'student', 'work_order'];
    if (!allowed.includes(req.params.type)) throw badRequest('Unsupported history type.');
    ok(res, getEvents(req.params.type, req.params.id));
  }),
);

export default router;
