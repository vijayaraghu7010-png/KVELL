import { Router } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { forbidden, notFound, ok, route } from '../lib/http';
import { audit, getEvents } from '../lib/records';
import { canAccessStudent, listStudents } from '../lib/scope';
import { addDays, fmtDateTime, localDate, nowIso } from '../lib/util';
import { Validator } from '../lib/validate';
import { confirmParent, getLeave, inchargeDecideLeave, LEAVE_SELECT, mapLeave } from '../services/requests';
import { inchargeOf } from '../services/classIncharge';
import { activeQr, canConduct, endSession, getSession, isHostellerAdviser, mapSession, scanStudentCode, sessionRosterView, startInstantSession, startSession, tokenFor } from '../services/studySessions';
import { academicOverview, studentDetail } from '../services/insights';

const router = Router();
router.use(requireRole('Adviser'));

router.get(
  '/dashboard',
  route((req, res) => {
    const me = req.user!.id;
    const c = (sql: string, ...p: unknown[]) => db().get<{ c: number }>(sql, ...p)!.c;
    const academics = academicOverview(req.user!);
    const activity = db()
      .all<any>(
        `SELECT e.*, u.name AS actor_name, s.name AS student_name, s.reg_number FROM entity_events e
         JOIN leave_requests l ON e.entity_type = 'leave_request' AND l.id = e.entity_id
         JOIN students s ON s.id = l.student_id LEFT JOIN users u ON u.id = e.actor_id
         WHERE l.incharge_id = ? ORDER BY e.id DESC LIMIT 10`,
        me,
      )
      .map((e) => ({
        id: String(e.id),
        type: e.action === 'submitted' ? 'leave_submitted' : e.action.includes('approved') ? 'leave_approved' : e.action.includes('rejected') ? 'leave_rejected' : 'leave_forwarded',
        title: `${e.entity_id}: ${e.action.replace(/_/g, ' ')}`,
        description: `${e.student_name} (${e.reg_number})${e.note ? ` — ${e.note}` : ''}`,
        timestamp: fmtDateTime(e.created_at),
        relatedStudentName: e.student_name,
        relatedRegNumber: e.reg_number,
        badge: e.to_status || undefined,
      }));
    ok(res, {
      metrics: {
        departmentStudents: c(`SELECT COUNT(*) AS c FROM students WHERE adviser_user_id = ? AND enrollment_status = 'Active'`, me),
        pendingLeaveRequests: c(`SELECT COUNT(*) AS c FROM leave_requests WHERE incharge_id = ? AND status = 'Pending Class Incharge'`, me),
        approvedLeaves: c(`SELECT COUNT(*) AS c FROM leave_requests WHERE incharge_id = ? AND status = 'Approved'`, me),
        incidentReports: c(`SELECT COUNT(*) AS c FROM incidents i JOIN students s ON s.id = i.student_id WHERE s.adviser_user_id = ?`, me),
        studentsNeedingSupport: academics.filter((a) => a.needsSupport).length,
        openFollowups: c(`SELECT COUNT(*) AS c FROM student_followups WHERE owner_user_id = ? AND status IN ('Open','In Progress')`, me),
        overdueFollowups: c(`SELECT COUNT(*) AS c FROM student_followups WHERE owner_user_id = ? AND status IN ('Open','In Progress') AND due_date < ?`, me, localDate()),
        pendingTasks: c(
          `SELECT COUNT(*) AS c FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id WHERE ar.user_id = ? AND a.status = 'Active' AND ar.status NOT IN ('Completed','Cancelled')`,
          me,
        ),
        pendingReportRequests: c(
          `SELECT COUNT(*) AS c FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id WHERE rr.user_id = ? AND q.status = 'Distributed' AND rr.status IN ('Distributed','Acknowledged','Revision Requested')`,
          me,
        ),
        upcomingSchedules: c(
          `SELECT COUNT(*) AS c FROM schedule_participants sp JOIN schedules s ON s.id = sp.schedule_id WHERE sp.user_id = ? AND s.status IN ('Scheduled','Rescheduled') AND s.end_at >= ?`,
          me,
          nowIso(),
        ),
      },
      // The Study Sessions page exists only for an Adviser responsible for hostellers.
      canConductSessions: isHostellerAdviser(me),
      activities: activity,
    });
  }),
);

router.get(
  '/students',
  route((req, res) => {
    const academics = new Map(academicOverview(req.user!).map((a) => [a.studentId, a]));
    ok(
      res,
      listStudents(req.user!).map((s) => ({ ...s, academic: academics.get(s.id) ?? null })),
    );
  }),
);

router.get(
  '/students/:id',
  route((req, res) => ok(res, studentDetail(req.user!, req.params.id))),
);

/** This teacher's Class Incharge assignment, if any, plus the students it covers. */
router.get(
  '/class-incharge',
  route((req, res) => {
    const assignment = inchargeOf(req.user!.id);
    if (!assignment) return ok(res, { isClassIncharge: false, department: null, section: null, students: [] });
    const students = db()
      .all<any>(
        `SELECT s.id, s.name, s.reg_number, s.year, r.room_number FROM students s LEFT JOIN rooms r ON r.id = s.room_id
         WHERE s.department_code = ? AND s.section = ? AND s.enrollment_status = 'Active' ORDER BY s.name`,
        assignment.department_code,
        assignment.section,
      )
      .map((x) => ({ id: x.id, name: x.name, regNumber: x.reg_number, year: x.year, roomNumber: x.room_number || 'Unallocated' }));
    ok(res, { isClassIncharge: true, department: assignment.department_code, section: assignment.section, students });
  }),
);

/**
 * Stage 1 of the leave chain. The queue holds only the requests routed to this
 * Class Incharge by the submitting student's department + section.
 */
router.get(
  '/leave-requests',
  route((req, res) => {
    ok(
      res,
      db()
        .all(`SELECT ${LEAVE_SELECT} WHERE l.incharge_id = ? AND l.status != 'Cancelled' ORDER BY CASE l.status WHEN 'Pending Class Incharge' THEN 0 ELSE 1 END, l.created_at DESC`, req.user!.id)
        .map((l) => {
          const m = mapLeave(l);
          const stageStatus =
            l.status === 'Pending Class Incharge' ? 'Pending' : l.incharge_decision === 'Rejected' ? 'Rejected' : l.status === 'Rejected' ? 'Forwarded' : l.status === 'Approved' ? 'Approved' : 'Forwarded';
          return { ...m, status: stageStatus, workflowStage: l.status, decisionBy: m.classInchargeName, decisionDate: m.classInchargeDecidedAt };
        }),
    );
  }),
);

router.get(
  '/leave-requests/:id',
  route((req, res) => {
    const l = getLeave(req.params.id);
    if (l.incharge_id !== req.user!.id && !canAccessStudent(req.user!, l.student_id)) throw forbidden();
    ok(res, mapLeave(l, true));
  }),
);

router.post(
  '/leave-requests/:id/decision',
  route((req, res) => {
    const v = new Validator(req.body);
    const decision = v.oneOf('decision', ['Approved', 'Rejected'] as const, { label: 'Decision' });
    const remarks = v.string('remarks', { required: decision === 'Rejected', max: 500, label: 'Remarks' });
    v.done();
    // Stage and ownership are enforced inside the service, not by the caller.
    const leave = inchargeDecideLeave(req.user!, req.params.id, decision!, remarks);
    audit(req, `leave.class_incharge_${decision!.toLowerCase()}`, 'leave_request', leave.id, { remarks });
    ok(res, leave, { message: decision === 'Approved' ? `Leave ${leave.id} approved and forwarded to the HOD.` : `Leave ${leave.id} rejected.` });
  }),
);

router.post(
  '/leave-requests/:id/parent-confirmation',
  route((req, res) => {
    const l = getLeave(req.params.id);
    if (!canAccessStudent(req.user!, l.student_id)) throw forbidden();
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
// Study sessions conducted by this Adviser
//
// Only an Adviser whose responsibility is "Hosteller" gets the start/end controls;
// the endpoints enforce that, so hiding the buttons is not what protects them.
// ---------------------------------------------------------------------------
router.get(
  '/study-sessions',
  route((req, res) => {
    const from = String(req.query.from || addDays(localDate(), -30));
    const to = String(req.query.to || addDays(localDate(), 60));
    const rows = db().all<any>(
      `SELECT id FROM study_sessions
       WHERE (adviser_user_id = ? OR (department_wide = 1 AND department_code = ?))
         AND session_date BETWEEN ? AND ? ORDER BY session_date DESC, start_time DESC`,
      req.user!.id,
      req.user!.departmentCode,
      from,
      to,
    );
    ok(
      res,
      { canConductSessions: isHostellerAdviser(req.user!.id), sessions: rows.map((r) => mapSession(getSession(r.id), req.user!)) },
    );
  }),
);

router.get(
  '/study-sessions/:id',
  route((req, res) => {
    const s = getSession(req.params.id);
    if (!canConduct(s, req.user!)) throw forbidden('This session is assigned to another Adviser.');
    ok(res, { ...sessionRosterView(req.params.id, req.user!), history: getEvents('study_session', req.params.id) });
  }),
);

/**
 * Starts a study session on the spot: the Adviser gives only a start and an end time,
 * everything else comes from the institutional defaults. Returns the same payload as
 * starting a scheduled session, including the raw start QR.
 */
router.post(
  '/study-sessions/start-now',
  route((req, res) => {
    const v = new Validator(req.body ?? {});
    const input = {
      startTime: v.string('startTime', { required: false, max: 5, label: 'Start time' }) ?? undefined,
      endTime: v.string('endTime', { required: false, max: 5, label: 'End time' }) ?? undefined,
    };
    v.done();
    const result = startInstantSession(req.user!, input);
    audit(req, 'study_session.started', 'study_session', result.session.id);
    ok(res, result, { message: `Session started. The attendance QR is valid until ${fmtDateTime(result.expiresAt)}.` });
  }),
);

/**
 * Starts the session and issues the start QR. The raw token is returned once, to the
 * Adviser who started it, so it can be rendered as a QR code; only its hash is stored.
 */
router.post(
  '/study-sessions/:id/start',
  route((req, res) => {
    const result = startSession(req.user!, req.params.id);
    audit(req, 'study_session.started', 'study_session', req.params.id);
    ok(res, result, { message: `Session started. The attendance QR is valid until ${fmtDateTime(result.expiresAt)}.` });
  }),
);

/** Re-reads the live QR token for a session this Adviser is running. */
router.get(
  '/study-sessions/:id/qr',
  route((req, res) => {
    const s = getSession(req.params.id);
    if (!canConduct(s, req.user!)) throw forbidden('This session is assigned to another Adviser.');
    const phase = req.query.phase === 'End' ? 'End' : 'Start';
    const qr = activeQr(s.id, phase);
    if (!qr) throw notFound(`${phase}-session QR code`);
    // Re-derived from the stored nonce and the server secret, never read back from storage.
    const live = tokenFor(s.id, phase);
    ok(res, {
      phase,
      issuedAt: qr.issued_at,
      expiresAt: qr.expires_at,
      expiresAtDisplay: fmtDateTime(qr.expires_at),
      live: !!live,
      invalidatedAt: qr.invalidated_at,
      token: live?.token ?? null,
    });
  }),
);

/**
 * Adviser-side attendance scanner: reads the personal code a student shows and
 * records their attendance through exactly the same validation a student's own
 * scan goes through.
 */
router.post(
  '/study-sessions/:id/scan-student',
  route((req, res) => {
    const v = new Validator(req.body);
    const code = v.string('code', { max: 200, label: 'Student code' });
    v.done();
    const result = scanStudentCode(req.user!, req.params.id, code!);
    audit(req, `study_session.${result.phase.toLowerCase()}_scan`, 'study_session', req.params.id, { by: 'adviser-scanner' });
    ok(res, result, { message: `${result.studentName} (${result.regNumber}): ${result.message}` });
  }),
);

/** The students a Hosteller Adviser may assign to a session: their own advisees. */
router.get(
  '/my-students',
  route((req, res) => {
    ok(
      res,
      db()
        .all<any>(
          `SELECT s.id, s.name, s.reg_number, s.department_code, s.section, s.year, r.room_number
           FROM students s LEFT JOIN rooms r ON r.id = s.room_id
           WHERE s.adviser_user_id = ? AND s.enrollment_status = 'Active' ORDER BY s.name`,
          req.user!.id,
        )
        .map((x) => ({ id: x.id, name: x.name, regNumber: x.reg_number, department: x.department_code, section: x.section, year: x.year, roomNumber: x.room_number || 'Unallocated' })),
    );
  }),
);

router.post(
  '/study-sessions/:id/end',
  route((req, res) => {
    const result = endSession(req.user!, req.params.id);
    audit(req, 'study_session.ended', 'study_session', req.params.id, { reconciled: result.reconciled });
    ok(res, result, {
      message: `Session ended. ${result.reconciled} student(s) marked absent. The end-of-session QR is valid until ${fmtDateTime(result.expiresAt)}.`,
    });
  }),
);

export default router;
