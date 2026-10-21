import { Router } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { badRequest, forbidden, notFound, ok, route } from '../lib/http';
import { audit, notify, recordEvent } from '../lib/records';
import { Validator } from '../lib/validate';
import { listStudents } from '../lib/scope';
import { addDays, fmtDate, fmtDateTime, inList, localDate, nextCode, nowIso, dayStartIso } from '../lib/util';
import { getLeave, hodDecideLeave, LEAVE_SELECT, mapLeave } from '../services/requests';
import { academicOverview, departmentAcademicSummary, staffWorkload, studentDetail } from '../services/insights';
import { repeatedAbsences, repeatedStudyMisses, studyParticipation } from '../services/attendance';

const router = Router();
router.use(requireRole('HOD'));

router.get(
  '/dashboard',
  route((req, res) => {
    const dept = req.user!.departmentCode;
    const me = req.user!.id;
    const c = (sql: string, ...p: unknown[]) => db().get<{ c: number }>(sql, ...p)!.c;
    const academics = academicOverview(req.user!);
    const incidents = db().all<any>(`SELECT i.status, i.severity FROM incidents i JOIN students s ON s.id = i.student_id WHERE s.department_code = ?`, dept);
    const recent = db()
      .all<any>(
        `SELECT e.*, u.name AS actor_name FROM entity_events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE (e.entity_type = 'incident' AND e.entity_id IN (SELECT i.id FROM incidents i JOIN students s ON s.id = i.student_id WHERE s.department_code = ?))
            OR (e.entity_type = 'leave_request' AND e.entity_id IN (SELECT l.id FROM leave_requests l JOIN students s ON s.id = l.student_id WHERE s.department_code = ?))
         ORDER BY e.id DESC LIMIT 8`,
        dept,
        dept,
      )
      .map((e) => ({
        id: String(e.id),
        title: `${e.entity_id}: ${e.action.replace(/_/g, ' ')}`,
        sub: `${e.actor_name || 'System'}${e.note ? ` — ${e.note}` : ''}`,
        time: fmtDateTime(e.created_at),
        type: e.entity_type === 'incident' ? 'incident' : 'student',
        badge: e.to_status || undefined,
      }));
    ok(res, {
      department: dept,
      metrics: {
        totalStudents: c(`SELECT COUNT(*) AS c FROM students WHERE department_code = ? AND enrollment_status = 'Active'`, dept),
        pendingLeaveRequests: c(`SELECT COUNT(*) AS c FROM leave_requests l JOIN students s ON s.id = l.student_id WHERE s.department_code = ? AND l.status = 'Pending HOD'`, dept),
        hostelStudents: c(`SELECT COUNT(*) AS c FROM students WHERE department_code = ? AND enrollment_status = 'Active' AND is_hosteller = 1`, dept),
        pendingIncidentReports: incidents.filter((i) => i.status === 'Pending Review').length,
        underInvestigationReports: incidents.filter((i) => i.status === 'Under Investigation').length,
        reportsRequiringAttention: incidents.filter((i) => i.status !== 'Resolved' && (i.severity === 'High' || i.severity === 'Critical')).length,
        studentsNeedingSupport: academics.filter((a) => a.needsSupport).length,
        studentsWithAcademicRecords: academics.filter((a) => a.recordCount > 0).length,
        verifiedAbsencesOpen: c(`SELECT COUNT(*) AS c FROM absence_cases a JOIN students s ON s.id = a.student_id WHERE s.department_code = ? AND a.status = 'Verified Unauthorized'`, dept),
        pendingTasks: c(`SELECT COUNT(*) AS c FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id WHERE ar.user_id = ? AND a.status = 'Active' AND ar.status NOT IN ('Completed','Cancelled')`, me),
        pendingReportRequests: c(
          `SELECT COUNT(*) AS c FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id WHERE rr.user_id = ? AND q.status = 'Distributed' AND rr.status IN ('Distributed','Acknowledged','Revision Requested')`,
          me,
        ),
        upcomingSchedules: c(`SELECT COUNT(*) AS c FROM schedule_participants sp JOIN schedules s ON s.id = sp.schedule_id WHERE sp.user_id = ? AND s.status IN ('Scheduled','Rescheduled') AND s.end_at >= ?`, me, nowIso()),
      },
      recentActivity: recent,
    });
  }),
);

router.get(
  '/students',
  route((req, res) => {
    const academics = new Map(academicOverview(req.user!).map((a) => [a.studentId, a]));
    ok(res, listStudents(req.user!).map((s) => ({ ...s, academic: academics.get(s.id) ?? null })));
  }),
);

router.get(
  '/students/:id',
  route((req, res) => ok(res, studentDetail(req.user!, req.params.id))),
);

/**
 * Stage 2 of the leave chain. `?pending=1` returns only what is actually waiting on
 * this HOD; a request that the Class Incharge has not approved never appears there.
 */
router.get(
  '/leave-requests',
  route((req, res) => {
    const pendingOnly = req.query.pending === '1';
    const rows = db().all(
      `SELECT ${LEAVE_SELECT} WHERE s.department_code = ? AND l.status != 'Cancelled' ${pendingOnly ? `AND l.status = 'Pending HOD'` : ''}
       ORDER BY CASE l.status WHEN 'Pending HOD' THEN 0 ELSE 1 END, l.created_at DESC`,
      req.user!.departmentCode,
    );
    ok(
      res,
      rows.map((l: any) => ({ ...mapLeave(l), canDecide: l.status === 'Pending HOD' })),
    );
  }),
);

router.get(
  '/leave-requests/:id',
  route((req, res) => {
    const l = getLeave(req.params.id);
    if (l.department_code !== req.user!.departmentCode) throw forbidden('This student is not in your department.');
    ok(res, { ...mapLeave(l, true), canDecide: l.status === 'Pending HOD' });
  }),
);

router.post(
  '/leave-requests/:id/decision',
  route((req, res) => {
    const v = new Validator(req.body);
    const decision = v.oneOf('decision', ['Approved', 'Rejected'] as const, { label: 'Decision' });
    const remarks = v.string('remarks', { required: decision === 'Rejected', max: 500, label: 'Remarks' });
    v.done();
    // Stage, department and duplicate-decision checks all live in the service.
    const leave = hodDecideLeave(req.user!, req.params.id, decision!, remarks);
    audit(req, `leave.hod_${decision!.toLowerCase()}`, 'leave_request', leave.id, { remarks });
    ok(res, leave, { message: decision === 'Approved' ? `Leave ${leave.id} approved and forwarded to the Warden.` : `Leave ${leave.id} rejected.` });
  }),
);

/** Advisers in the HOD's department with transparent operational counts. */
router.get(
  '/advisers',
  route((req, res) => {
    const advisers = db().all<any>(
      `SELECT u.id, u.name, u.email, u.phone, u.designation,
         (SELECT COUNT(*) FROM students s WHERE s.adviser_user_id = u.id AND s.enrollment_status = 'Active') AS advisees
       FROM users u WHERE u.role = 'Adviser' AND u.is_active = 1 AND u.department_code = ? ORDER BY u.name`,
      req.user!.departmentCode,
    );
    const workload = staffWorkload(advisers.map((a) => a.id));
    const academics = academicOverview(req.user!);
    ok(
      res,
      advisers.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        phone: a.phone,
        designation: a.designation,
        advisees: a.advisees,
        adviseesNeedingSupport: academics.filter((s) => s.adviserId === a.id && s.needsSupport).length,
        ...workload.get(a.id),
      })),
    );
  }),
);

/**
 * The HOD assigns their department's students to one of their own advisers.
 *
 * Both sides are checked against the HOD's department, not against what the
 * browser sent: an adviser from another department, or a student from another
 * department, is refused rather than quietly skipped.
 *
 * The assignment screen also sends the brief the adviser is to work on, so an
 * optional follow-up (category / title / due date / notes) is opened in the
 * adviser's name in the same transaction as the assignment.
 */
router.post(
  '/advisers/:id/assign',
  route((req, res) => {
    const adviser = db().get<any>(
      `SELECT id, name, department_code FROM users WHERE id = ? AND role = 'Adviser' AND is_active = 1 AND department_code = ?`,
      req.params.id,
      req.user!.departmentCode,
    );
    if (!adviser) throw notFound('Adviser');
    const v = new Validator(req.body);
    const studentIds = v.stringArray('studentIds', { required: true, max: 500, label: 'Students' });
    // The brief is optional: an assignment with no title is just a re-assignment.
    const title = v.string('title', { required: false, min: 3, max: 200, label: 'Title' });
    const category = v.oneOf('category', ['Academic Support', 'Mentoring Session', 'Absence Follow-up', 'Study Session', 'Disciplinary', 'Other'] as const, { required: false, label: 'Category' });
    const notes = v.string('notes', { required: false, max: 2000, label: 'Notes / plan' });
    const dueDate = v.date('dueDate', { required: false, label: 'Due date' });
    v.done();
    if (title && studentIds!.length !== 1) throw badRequest('A follow-up can only be opened for one student at a time.');
    if (dueDate && dueDate < localDate()) throw badRequest('Due date cannot be in the past.');
    const l = inList(studentIds!);
    const rows = db().all<any>(`SELECT id, department_code FROM students WHERE id IN ${l.sql}`, ...l.params);
    if (rows.length !== studentIds!.length) throw badRequest('One or more students were not found.');
    const wrong = rows.filter((r) => r.department_code !== adviser.department_code);
    if (wrong.length) throw badRequest(`${wrong.length} student(s) are not in ${adviser.department_code}; advisers are assigned within their department.`);
    const followupId = db().transaction(() => {
      const now = nowIso();
      db().run(`UPDATE students SET adviser_user_id = ?, updated_at = ? WHERE id IN ${l.sql}`, adviser.id, now, ...l.params);
      if (!title) return null;
      const student = db().get<any>('SELECT id, name FROM students WHERE id = ?', studentIds![0])!;
      const newId = nextCode('FU');
      db().run(
        `INSERT INTO student_followups (id, student_id, owner_user_id, category, title, notes, status, due_date, source_type, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, 'hod_assignment', ?, ?, ?)`,
        newId,
        student.id,
        adviser.id,
        category ?? 'Academic Support',
        title,
        notes ?? null,
        dueDate ?? null,
        req.user!.id,
        now,
        now,
      );
      recordEvent('followup', newId, req.user!.id, 'opened_by_hod', { to: 'Open', note: `${student.name} assigned to ${adviser.name}: ${title}` });
      return newId;
    });
    notify([adviser.id], {
      eventType: 'advisees.assigned',
      title: `${studentIds!.length} student(s) assigned to you`,
      message: followupId ? `${req.user!.name}: ${title}${dueDate ? ` (due ${fmtDate(dueDate)})` : ''}` : `Your advisee list has been updated by ${req.user!.name}.`,
      entityType: followupId ? 'followup' : undefined,
      entityId: followupId ?? undefined,
      link: followupId ? '/adviser/follow-ups' : '/adviser/students',
    });
    audit(req, 'hod.advisees_assigned', 'user', adviser.id, { count: studentIds!.length, followupId });
    ok(
      res,
      { assigned: studentIds!.length, followupId },
      { message: followupId ? `Student assigned to ${adviser.name}; follow-up ${followupId} opened.` : `${studentIds!.length} student(s) assigned to ${adviser.name}.` },
    );
  }),
);

router.get(
  '/analytics',
  route((req, res) => {
    const to = String(req.query.to || localDate());
    const from = String(req.query.from || addDays(to, -29));
    const dept = req.user!.departmentCode;
    const academics = academicOverview(req.user!);
    const fromIso = dayStartIso(from);
    ok(res, {
      from,
      to,
      academic: { summary: departmentAcademicSummary(academics), byYear: groupBy(academics, (a) => a.year), needingSupport: academics.filter((a) => a.needsSupport) },
      study: { byYear: studyParticipation(req.user!, from, to, 'year'), repeatedMisses: repeatedStudyMisses(req.user!, to) },
      absences: { repeated: repeatedAbsences(req.user!, to) },
      leaves: db()
        .all<any>(
          `SELECT l.status, COUNT(*) AS c FROM leave_requests l JOIN students s ON s.id = l.student_id WHERE s.department_code = ? AND l.created_at >= ? GROUP BY l.status`,
          dept,
          fromIso,
        )
        .map((r) => ({ status: r.status, count: r.c })),
      incidentsByCategory: db()
        .all<any>(`SELECT i.category, COUNT(*) AS c FROM incidents i JOIN students s ON s.id = i.student_id WHERE s.department_code = ? AND i.created_at >= ? GROUP BY i.category ORDER BY c DESC`, dept, fromIso)
        .map((r) => ({ category: r.category, count: r.c })),
    });
  }),
);

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].map(([k, list]) => {
    const withPct = list.filter((x: any) => x.latestPct !== null);
    return {
      key: k,
      students: list.length,
      averageLatestPct: withPct.length ? Math.round((withPct.reduce((s, x: any) => s + x.latestPct, 0) / withPct.length) * 10) / 10 : null,
      needsSupport: list.filter((x: any) => x.needsSupport).length,
    };
  });
}

export default router;
