import { Router } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { badRequest, notFound, ok, route } from '../lib/http';
import { Validator } from '../lib/validate';
import { assertDeanStudentArea, assertDeanWardenReport, authorityModel, deanStudentView, DEAN_STUDENT_AREAS, DEAN_WARDEN_REPORTS } from '../lib/authority';
import { defaultWindow, uninformedAbsences, uninformedSummary, WARDEN_REPORT_META, wardenStudentReport } from '../services/deanMonitoring';
import { audit, getNumberSetting, notify, recordEvent } from '../lib/records';
import { listStudents } from '../lib/scope';
import { addDays, fmtDate, fmtDateTime, localDate, nowIso, yearLabel, nextCode } from '../lib/util';
import { defaultSession, repeatedAbsences, repeatedStudyMisses, studyParticipation } from '../services/attendance';
import { academicOverview, departmentAcademicSummary, staffWorkload, studentDetail } from '../services/insights';
import { generateReport, REPORT_META, REPORT_TYPES, reportToCsv, type ReportType } from '../services/reporting';

const router = Router();
router.use(requireRole('Dean'));

const c = (sql: string, ...p: unknown[]) => db().get<{ c: number }>(sql, ...p)!.c;

/**
 * Dashboard metrics. Each metric carries a definition so the UI can explain exactly what is counted.
 */
router.get(
  '/dashboard',
  route((req, res) => {
    const _req = req;
    const today = localDate();
    const now = nowIso();
    const session = defaultSession();
    const windowFrom = addDays(today, -29);
    const residents = c(`SELECT COUNT(*) AS c FROM students WHERE enrollment_status = 'Active' AND is_hosteller = 1`);
    const recordedToday = db().get<any>(`SELECT COUNT(*) AS recorded, SUM(status = 'Present') AS present FROM attendance_records WHERE att_date = ? AND session = ?`, today, session);
    const rollClosed = !!db().get(`SELECT 1 FROM attendance_sessions WHERE att_date = ? AND session = ? AND closed_at IS NOT NULL`, today, session);
    const study = studyParticipation(_req.user!, windowFrom, today, 'department');
    const studyTotals = study.reduce((a, r) => ({ attended: a.attended + r.present + r.late, denom: a.denom + r.marked - r.excused }), { attended: 0, denom: 0 });
    const academics = academicOverview(_req.user!);
    const openTasks = (role: string) =>
      c(
        `SELECT COUNT(*) AS c FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id JOIN users u ON u.id = ar.user_id
         WHERE a.status = 'Active' AND u.role = ? AND ar.status NOT IN ('Completed','Cancelled')`,
        role,
      );
    const metrics = {
      totalHostelStudents: { value: residents, definition: 'Active students marked as hostellers.' },
      studentsPresent: {
        value: recordedToday.recorded ? recordedToday.present || 0 : null,
        recorded: recordedToday.recorded || 0,
        definition: `Marked Present in today's ${session} (${fmtDate(today)}). ${recordedToday.recorded ? `${recordedToday.recorded}/${residents} recorded${rollClosed ? ', roll closed' : ', roll still open'}.` : 'Roll call not yet recorded today.'}`,
      },
      absencesAwaitingVerification: {
        value: c(`SELECT COUNT(*) AS c FROM absence_cases WHERE status IN ('Pending Verification','Suspected Unauthorized')`),
        definition: 'Absences flagged by the Warden that have not yet been verified (not counted as unauthorized).',
      },
      verifiedUnauthorizedAbsences: {
        value: c(`SELECT COUNT(*) AS c FROM absence_cases WHERE verified_at IS NOT NULL AND status IN ('Verified Unauthorized','Resolved') AND att_date >= ?`, windowFrom),
        definition: 'Absences verified as unauthorized by the Warden in the last 30 days (including those since resolved).',
      },
      repeatedUnauthorizedAbsences: {
        value: repeatedAbsences(_req.user!).length,
        definition: `Students with ≥ ${getNumberSetting('absence.repeat_threshold')} verified unauthorized absences in ${getNumberSetting('absence.repeat_window_days')} days.`,
      },
      studyParticipation: {
        value: studyTotals.denom ? Math.round((studyTotals.attended / studyTotals.denom) * 1000) / 10 : null,
        unit: '%',
        definition: 'Present + Late ÷ (marked − excused), study sessions in the last 30 days.',
      },
      studentsNeedingAcademicSupport: {
        value: academics.some((a) => a.recordCount > 0) ? academics.filter((a) => a.needsSupport).length : null,
        definition: academics.some((a) => a.recordCount > 0)
          ? `Latest assessment below ${getNumberSetting('academic.support_threshold_pct')}%, a drop of ≥ ${getNumberSetting('academic.decline_points')} points, or arrears.`
          : 'No academic records have been entered yet.',
      },
      hodTasksPending: { value: openTasks('HOD'), definition: 'Dean-assigned HOD tasks not yet completed.' },
      adviserTasksPending: { value: openTasks('Adviser'), definition: 'Dean-assigned Adviser tasks not yet completed.' },
      overdueAssignments: {
        value: c(`SELECT COUNT(*) AS c FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id WHERE a.status = 'Active' AND ar.status NOT IN ('Completed','Cancelled') AND ar.due_at < ?`, now),
        definition: 'Open task recipients past their deadline.',
      },
      reportsAwaitingSubmission: {
        value: c(
          `SELECT COUNT(*) AS c FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id WHERE q.status = 'Distributed' AND q.requires_submission = 1 AND rr.status IN ('Distributed','Acknowledged','Revision Requested')`,
        ),
        definition: 'Requested reports not yet submitted (or returned for revision).',
      },
      reportsAwaitingReview: {
        value: c(`SELECT COUNT(*) AS c FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id WHERE q.status = 'Distributed' AND rr.status IN ('Submitted','Under Review')`),
        definition: 'Submitted reports waiting for your review.',
      },
      tasksAwaitingReview: {
        value: c(`SELECT COUNT(*) AS c FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id WHERE a.status = 'Active' AND ar.status = 'Submitted'`),
        definition: 'Task submissions waiting for your review.',
      },
      upcomingActivities: {
        value: c(`SELECT COUNT(*) AS c FROM schedules WHERE status IN ('Scheduled','Rescheduled') AND start_at BETWEEN ? AND ?`, now, new Date(Date.now() + 7 * 86_400_000).toISOString()),
        definition: 'Scheduled activities in the next 7 days.',
      },
    };

    const urgent = [
      ...db()
        .all<any>(
          `SELECT ar.id, a.id AS aid, a.title, u.name, u.role, u.department_code, ar.due_at FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id JOIN users u ON u.id = ar.user_id
           WHERE a.status = 'Active' AND ar.status NOT IN ('Completed','Cancelled') AND ar.due_at < ? ORDER BY ar.due_at LIMIT 8`,
          now,
        )
        .map((r) => ({ kind: 'Overdue task', title: r.title, who: `${r.name} (${r.role}, ${r.department_code})`, when: `Due ${fmtDateTime(r.due_at)}`, link: `/dean/assignments/${r.aid}` })),
      ...db()
        .all<any>(
          `SELECT ar.id, a.id AS aid, a.title, u.name, u.role, ar.submitted_at FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id JOIN users u ON u.id = ar.user_id
           WHERE a.status = 'Active' AND ar.status = 'Submitted' ORDER BY ar.submitted_at LIMIT 8`,
        )
        .map((r) => ({ kind: 'Awaiting your review', title: r.title, who: `${r.name} (${r.role})`, when: `Submitted ${fmtDateTime(r.submitted_at)}`, link: `/dean/assignments/${r.aid}` })),
      ...db()
        .all<any>(
          `SELECT c.id, c.att_date, c.status, s.name, s.department_code FROM absence_cases c JOIN students s ON s.id = c.student_id
           WHERE c.status IN ('Suspected Unauthorized','Verified Unauthorized') AND c.follow_up_user_id IS NULL ORDER BY c.att_date DESC LIMIT 8`,
        )
        .map((r) => ({ kind: r.status, title: `${r.name} (${r.department_code})`, who: 'No follow-up assigned', when: fmtDate(r.att_date), link: `/dean/attendance?case=${r.id}` })),
    ];

    const upcoming = db()
      .all<any>(`SELECT id, title, category, start_at, location, status FROM schedules WHERE status IN ('Scheduled','Rescheduled') AND start_at >= ? ORDER BY start_at LIMIT 6`, now)
      .map((s) => ({ id: s.id, title: s.title, category: s.category, when: fmtDateTime(s.start_at), location: s.location, status: s.status }));

    // Assignment lifecycle, counted per recipient so one person's progress never
    // stands in for anybody else's.
    const lifecycleRows = db().all<any>(
      `SELECT ar.status, COUNT(*) AS n FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id
       WHERE a.status = 'Active' GROUP BY ar.status`,
    );
    const lifecycle: Record<string, number> = { Assigned: 0, Acknowledged: 0, 'In Progress': 0, Submitted: 0, 'Revision Requested': 0, Completed: 0, Cancelled: 0 };
    for (const r of lifecycleRows) lifecycle[r.status] = r.n;
    const assignmentLifecycle = {
      ...lifecycle,
      overdue: c(`SELECT COUNT(*) AS c FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id WHERE a.status = 'Active' AND ar.status NOT IN ('Completed','Cancelled') AND ar.due_at < ?`, now),
      drafts: c(`SELECT COUNT(*) AS c FROM assignments WHERE status = 'Draft'`),
    };

    // Departments with their HOD and adviser coverage.
    const departmentDirectory = db()
      .all<any>(
        `SELECT d.code, d.name,
          (SELECT u.id FROM users u WHERE u.role = 'HOD' AND u.is_active = 1 AND u.department_code = d.code) AS hod_id,
          (SELECT u.name FROM users u WHERE u.role = 'HOD' AND u.is_active = 1 AND u.department_code = d.code) AS hod_name,
          (SELECT COUNT(*) FROM users u WHERE u.role = 'Adviser' AND u.is_active = 1 AND u.department_code = d.code) AS advisers,
          (SELECT COUNT(*) FROM users u WHERE u.role = 'Adviser' AND u.is_active = 1 AND u.department_code = d.code AND u.student_category = 'Hosteller') AS hosteller_advisers,
          (SELECT COUNT(*) FROM students s WHERE s.department_code = d.code AND s.enrollment_status = 'Active' AND s.is_hosteller = 1) AS hostel_students
         FROM departments d WHERE d.is_active = 1 ORDER BY d.code`,
      )
      .map((r) => ({
        code: r.code,
        name: r.name,
        hodId: r.hod_id,
        hodName: r.hod_name,
        advisers: r.advisers,
        hostellerAdvisers: r.hosteller_advisers,
        hostelStudents: r.hostel_students,
        openTasks: c(
          `SELECT COUNT(*) AS c FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id JOIN users u ON u.id = ar.user_id
           WHERE a.status = 'Active' AND u.department_code = ? AND ar.status NOT IN ('Completed','Cancelled')`,
          r.code,
        ),
        overdueTasks: c(
          `SELECT COUNT(*) AS c FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id JOIN users u ON u.id = ar.user_id
           WHERE a.status = 'Active' AND u.department_code = ? AND ar.status NOT IN ('Completed','Cancelled') AND ar.due_at < ?`,
          r.code,
          now,
        ),
      }));

    const window = defaultWindow();
    const uninformed = uninformedSummary(uninformedAbsences(window.from, window.to));

    ok(res, {
      asOf: fmtDateTime(now),
      metrics,
      urgent,
      upcoming,
      departments: departmentAcademicSummary(academics),
      // Consolidated view
      assignmentLifecycle,
      departmentDirectory,
      studentMonitoring: {
        scope: DEAN_STUDENT_AREAS,
        studyParticipation: { window, byDepartment: study },
        academicPerformance: {
          recordsEntered: academics.some((a) => a.recordCount > 0),
          needingSupport: academics.filter((a) => a.needsSupport).length,
          declining: academics.filter((a) => a.trend === 'Declining').length,
        },
        uninformedAbsence: { window, ...uninformed },
      },
      wardenReports: DEAN_WARDEN_REPORTS.map((type) => ({ type, ...WARDEN_REPORT_META[type] })),
      scope: authorityModel(req.user!).deanScope,
    });
  }),
);

// ---------------------------------------------------------------------------
// HOD & Adviser monitoring — transparent operational counts, never "scores"
// ---------------------------------------------------------------------------
router.get(
  '/hods',
  route((req, res) => {
    const depts = db().all<any>(
      `SELECT d.code, d.name, h.id AS hod_id, h.name AS hod_name, h.email AS hod_email, h.phone AS hod_phone
       FROM departments d LEFT JOIN users h ON h.department_code = d.code AND h.role = 'HOD' AND h.is_active = 1 WHERE d.is_active = 1 ORDER BY d.code`,
    );
    const workload = staffWorkload(depts.filter((d) => d.hod_id).map((d) => d.hod_id));
    const academic = new Map(departmentAcademicSummary(academicOverview(req.user!)).map((d) => [d.department, d]));
    const absences = new Map(
      db()
        .all<any>(`SELECT s.department_code AS d, COUNT(*) AS c FROM absence_cases a JOIN students s ON s.id = a.student_id WHERE a.status = 'Verified Unauthorized' GROUP BY s.department_code`)
        .map((r) => [r.d, r.c]),
    );
    const advisers = new Map(db().all<any>(`SELECT department_code AS d, COUNT(*) AS c FROM users WHERE role = 'Adviser' AND is_active = 1 GROUP BY department_code`).map((r) => [r.d, r.c]));
    ok(
      res,
      depts.map((d) => {
        const w = d.hod_id ? workload.get(d.hod_id) : null;
        const a = academic.get(d.code);
        const attention: string[] = [];
        if (!d.hod_id) attention.push('No HOD assigned');
        if (w?.tasks.overdue) attention.push(`${w.tasks.overdue} overdue task(s)`);
        if (w?.reports.overdue) attention.push(`${w.reports.overdue} overdue report(s)`);
        if (w?.tasks.unacknowledged) attention.push(`${w.tasks.unacknowledged} unacknowledged task(s)`);
        if (absences.get(d.code)) attention.push(`${absences.get(d.code)} open verified absence(s)`);
        return {
          department: d.code,
          departmentName: d.name,
          hod: d.hod_id ? { id: d.hod_id, name: d.hod_name, email: d.hod_email, phone: d.hod_phone } : null,
          advisers: advisers.get(d.code) || 0,
          students: a?.students ?? 0,
          academic: a ?? null,
          openVerifiedAbsences: absences.get(d.code) || 0,
          workload: w,
          needsFollowUp: attention.length > 0,
          attention,
        };
      }),
    );
  }),
);

router.get(
  '/advisers',
  route((req, res) => {
    const department = req.query.department ? String(req.query.department) : null;
    const advisers = db().all<any>(
      `SELECT u.id, u.name, u.email, u.phone, u.department_code, u.designation,
         (SELECT COUNT(*) FROM students s WHERE s.adviser_user_id = u.id AND s.enrollment_status = 'Active') AS advisees
       FROM users u WHERE u.role = 'Adviser' AND u.is_active = 1 ${department ? 'AND u.department_code = ?' : ''} ORDER BY u.department_code, u.name`,
      ...(department ? [department] : []),
    );
    const workload = staffWorkload(advisers.map((a) => a.id));
    const academics = academicOverview(req.user!);
    ok(
      res,
      advisers.map((a) => {
        const mine = academics.filter((s) => s.adviserId === a.id);
        const w = workload.get(a.id);
        return {
          id: a.id,
          name: a.name,
          email: a.email,
          phone: a.phone,
          department: a.department_code,
          designation: a.designation,
          advisees: a.advisees,
          adviseesNeedingSupport: mine.filter((s) => s.needsSupport).length,
          adviseesNeedingSupportWithoutFollowup: mine.filter((s) => s.needsSupport && s.openSupportFollowups === 0).length,
          adviseesDeclining: mine.filter((s) => s.trend === 'Declining').length,
          ...w,
        };
      }),
    );
  }),
);

/** Drill-down for a single HOD or Adviser. */
router.get(
  '/staff/:id',
  route((req, res) => {
    const u = db().get<any>(`SELECT id, name, email, phone, role, department_code, designation FROM users WHERE id = ? AND role IN ('HOD','Adviser')`, req.params.id);
    if (!u) throw notFound('Staff member');
    const tasks = db()
      .all<any>(
        `SELECT ar.id, ar.status, ar.due_at, ar.progress_pct, ar.submitted_at, ar.completed_at, a.id AS aid, a.title, a.priority FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id
         WHERE ar.user_id = ? AND a.status != 'Draft' ORDER BY ar.due_at DESC`,
        u.id,
      )
      .map((t) => ({
        recipientId: t.id,
        assignmentId: t.aid,
        title: t.title,
        priority: t.priority,
        status: t.status,
        progressPct: t.progress_pct,
        due: fmtDateTime(t.due_at),
        isOverdue: !['Completed', 'Cancelled'].includes(t.status) && t.due_at < nowIso(),
        completedOnTime: t.completed_at ? t.completed_at <= t.due_at : null,
      }));
    const reports = db()
      .all<any>(
        `SELECT rr.id, rr.status, rr.submitted_at, q.id AS qid, q.title, q.deadline_at FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id WHERE rr.user_id = ? ORDER BY q.created_at DESC`,
        u.id,
      )
      .map((r) => ({ id: r.id, requestId: r.qid, title: r.title, status: r.status, deadline: r.deadline_at ? fmtDateTime(r.deadline_at) : null, submittedAt: r.submitted_at ? fmtDateTime(r.submitted_at) : null }));
    const schedules = db()
      .all<any>(
        `SELECT s.id, s.title, s.start_at, s.status, sp.response FROM schedule_participants sp JOIN schedules s ON s.id = sp.schedule_id WHERE sp.user_id = ? ORDER BY s.start_at DESC LIMIT 30`,
        u.id,
      )
      .map((s) => ({ id: s.id, title: s.title, when: fmtDateTime(s.start_at), status: s.status, response: s.response }));
    const followups = db()
      .all<any>(
        `SELECT f.id, f.category, f.title, f.status, f.due_date, f.created_at, s.name AS student FROM student_followups f JOIN students s ON s.id = f.student_id WHERE f.owner_user_id = ? ORDER BY f.created_at DESC LIMIT 50`,
        u.id,
      )
      .map((f) => ({ id: f.id, category: f.category, title: f.title, status: f.status, student: f.student, due: f.due_date ? fmtDate(f.due_date) : null, isOverdue: !!f.due_date && f.due_date < localDate() && ['Open', 'In Progress'].includes(f.status) }));
    ok(res, { user: { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, department: u.department_code, designation: u.designation }, workload: staffWorkload([u.id]).get(u.id), tasks, reports, schedules, followups });
  }),
);

// ---------------------------------------------------------------------------
// Consolidated progress tracking (links back to the underlying records)
// ---------------------------------------------------------------------------
router.get(
  '/progress',
  route((req, res) => {
    const now = nowIso();
    const today = localDate();
    const items: any[] = [];
    db()
      .all<any>(
        `SELECT ar.id, ar.status, ar.due_at, ar.progress_pct, a.id AS aid, a.title, a.priority, a.category, u.name, u.role, u.department_code
         FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id JOIN users u ON u.id = ar.user_id WHERE a.status = 'Active'`,
      )
      .forEach((r) =>
        items.push({
          type: r.role === 'HOD' ? 'HOD assignment' : 'Adviser assignment',
          id: r.id,
          recordId: r.aid,
          title: r.title,
          assignee: r.name,
          assigneeRole: r.role,
          department: r.department_code,
          priority: r.priority,
          status: r.status,
          progressPct: r.progress_pct,
          due: r.due_at,
          dueDisplay: fmtDateTime(r.due_at),
          isOverdue: !['Completed', 'Cancelled'].includes(r.status) && r.due_at < now,
          link: `/dean/assignments/${r.aid}`,
        }),
      );
    db()
      .all<any>(
        `SELECT rr.id, rr.status, q.id AS qid, q.title, q.deadline_at, q.requires_submission, u.name, u.role, u.department_code
         FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id JOIN users u ON u.id = rr.user_id WHERE q.status = 'Distributed'`,
      )
      .forEach((r) =>
        items.push({
          type: 'Report submission',
          id: r.id,
          recordId: r.qid,
          title: r.title,
          assignee: r.name,
          assigneeRole: r.role,
          department: r.department_code,
          priority: null,
          status: r.status,
          progressPct: null,
          due: r.deadline_at,
          dueDisplay: r.deadline_at ? fmtDateTime(r.deadline_at) : '—',
          isOverdue: !!r.deadline_at && r.deadline_at < now && ['Distributed', 'Acknowledged', 'Revision Requested'].includes(r.status),
          link: `/dean/report-distribution/${r.qid}`,
        }),
      );
    db()
      .all<any>(
        `SELECT s.id, s.title, s.category, s.start_at, s.status, s.department_code, (SELECT COUNT(*) FROM schedule_participants sp WHERE sp.schedule_id = s.id AND sp.response = 'Pending') AS pending
         FROM schedules s WHERE s.status IN ('Scheduled','Rescheduled')`,
      )
      .forEach((s) =>
        items.push({
          type: s.category === 'Study Session Monitoring' ? 'Study-session monitoring' : 'Scheduled activity',
          id: s.id,
          recordId: s.id,
          title: s.title,
          assignee: `${s.pending} awaiting acknowledgement`,
          assigneeRole: null,
          department: s.department_code,
          priority: null,
          status: s.status,
          progressPct: null,
          due: s.start_at,
          dueDisplay: fmtDateTime(s.start_at),
          isOverdue: false,
          link: `/dean/schedule/${s.id}`,
        }),
      );
    db()
      .all<any>(
        `SELECT f.id, f.category, f.title, f.status, f.due_date, u.name, u.role, s.department_code, s.name AS student FROM student_followups f
         JOIN users u ON u.id = f.owner_user_id JOIN students s ON s.id = f.student_id WHERE f.status IN ('Open','In Progress')`,
      )
      .forEach((f) =>
        items.push({
          type: f.category === 'Absence Follow-up' ? 'Absence follow-up' : 'Student support follow-up',
          id: f.id,
          recordId: f.id,
          title: `${f.title} — ${f.student}`,
          assignee: f.name,
          assigneeRole: f.role,
          department: f.department_code,
          priority: null,
          status: f.status,
          progressPct: null,
          due: f.due_date,
          dueDisplay: f.due_date ? fmtDate(f.due_date) : '—',
          isOverdue: !!f.due_date && f.due_date < today,
          link: `/dean/progress?followup=${f.id}`,
        }),
      );
    db()
      .all<any>(
        `SELECT c.id, c.att_date, c.status, s.name, s.department_code FROM absence_cases c JOIN students s ON s.id = c.student_id WHERE c.status IN ('Pending Verification','Suspected Unauthorized','Verified Unauthorized')`,
      )
      .forEach((c2) =>
        items.push({
          type: 'Unresolved absence',
          id: c2.id,
          recordId: c2.id,
          title: `${c2.name} — ${fmtDate(c2.att_date)}`,
          assignee: c2.status === 'Verified Unauthorized' ? 'Follow-up pending' : 'Warden verification',
          assigneeRole: null,
          department: c2.department_code,
          priority: null,
          status: c2.status,
          progressPct: null,
          due: c2.att_date,
          dueDisplay: fmtDate(c2.att_date),
          isOverdue: false,
          link: `/dean/attendance?case=${c2.id}`,
        }),
      );
    const f = req.query;
    const filtered = items.filter(
      (i) =>
        (!f.department || i.department === f.department) &&
        (!f.type || i.type === f.type) &&
        (!f.status || i.status === f.status) &&
        (!f.priority || i.priority === f.priority) &&
        (!f.assignee || String(i.assignee).toLowerCase().includes(String(f.assignee).toLowerCase())) &&
        (f.overdue !== '1' || i.isOverdue) &&
        (!f.dueBefore || (i.due && i.due <= String(f.dueBefore) + 'T23:59:59Z')),
    );
    filtered.sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || String(a.due ?? '9').localeCompare(String(b.due ?? '9')));
    ok(res, filtered, { types: [...new Set(items.map((i) => i.type))] });
  }),
);

// ---------------------------------------------------------------------------
// Student monitoring — strictly the three permitted areas
//
// Study participation, academic performance and uninformed leave/absence. Contact
// details, guardian numbers, medical notes, complaints, outings and mess records are
// outside the Dean's scope and are stripped before anything leaves this file.
// ---------------------------------------------------------------------------
router.get(
  '/students',
  route((req, res) => {
    const q = String(req.query.search || '').trim().toLowerCase();
    const dept = req.query.department ? String(req.query.department) : null;
    const academics = new Map(academicOverview(req.user!).map((a) => [a.studentId, a]));
    const study = new Map(studyParticipation(req.user!, addDays(localDate(), -29), localDate(), 'session').map((r) => [r.key, r]));
    void study;
    let rows = listStudents(req.user!, `s.enrollment_status = 'Active'`).map((s) => ({ ...deanStudentView(s), academic: academics.get(s.id) ?? null }));
    if (dept) rows = rows.filter((s: any) => s.department === dept);
    if (q) rows = rows.filter((s: any) => String(s.name).toLowerCase().includes(q) || String(s.regNumber).toLowerCase().includes(q));
    ok(res, rows, { total: rows.length, scope: DEAN_STUDENT_AREAS });
  }),
);

/**
 * One student, limited to the three monitoring areas. `?area=` narrows it further and
 * anything outside the permitted set is refused rather than quietly ignored.
 */
router.get(
  '/students/:id',
  route((req, res) => {
    if (req.query.area) assertDeanStudentArea(String(req.query.area));
    const full = studentDetail(req.user!, req.params.id) as any;
    const student = deanStudentView(full);
    const window = defaultWindow();
    const cases = uninformedAbsences(addDays(localDate(), -180), localDate()).filter((c) => c.studentId === req.params.id);
    audit(req, 'dean.student_monitoring_viewed', 'student', req.params.id, { areas: DEAN_STUDENT_AREAS });
    ok(res, {
      student,
      scope: DEAN_STUDENT_AREAS,
      studyParticipation: full.study60d,
      academicPerformance: full.academics,
      uninformedAbsence: { window, cases, summary: uninformedSummary(cases) },
      followups: full.followups,
    });
  }),
);

/**
 * C. Uninformed leave / absence across departments, with the evidence behind each
 * case: the attendance record, any leave request covering the date and its approval
 * stage, and the gate movements for that day.
 */
router.get(
  '/uninformed-absence',
  route((req, res) => {
    const w = defaultWindow();
    const from = String(req.query.from || w.from);
    const to = String(req.query.to || w.to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest('Dates must be YYYY-MM-DD.');
    if (to < from) throw badRequest('The end date must be on or after the start date.');
    const department = req.query.department ? String(req.query.department) : undefined;
    const classification = req.query.classification ? String(req.query.classification) : '';
    let cases = uninformedAbsences(from, to, department);
    const summary = uninformedSummary(cases);
    if (classification) cases = cases.filter((c) => c.classification === classification);
    ok(res, { period: { from, to }, department: department ?? null, summary, cases });
  }),
);

// ---------------------------------------------------------------------------
// Warden monitoring — student-related reports only
//
// There is deliberately no Warden staff-performance view here: the Dean reads
// reports about students for which the Warden is the recorded source.
// ---------------------------------------------------------------------------
router.get(
  '/warden-reports',
  route((_req, res) =>
    ok(res, {
      scope: 'Student-related reports only. The Dean has no Warden staff-performance module.',
      reports: DEAN_WARDEN_REPORTS.map((type) => ({ type, ...WARDEN_REPORT_META[type] })),
    }),
  ),
);

router.get(
  '/warden-reports/:type',
  route((req, res) => {
    const type = assertDeanWardenReport(req.params.type);
    const w = defaultWindow();
    const from = String(req.query.from || w.from);
    const to = String(req.query.to || w.to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest('Dates must be YYYY-MM-DD.');
    const department = req.query.department ? String(req.query.department) : undefined;
    const rows = wardenStudentReport(req.user!, type, from, to, department);
    audit(req, 'dean.warden_report_viewed', 'report', type, { from, to, department });
    ok(res, { type, ...WARDEN_REPORT_META[type], period: { from, to }, department: department ?? null, rows });
  }),
);

/**
 * Dean asks a responsible staff member (the student's adviser, their department HOD, or a Warden)
 * to follow up with a student. Creates a tracked follow-up owned by that person.
 */
router.post(
  '/students/:id/follow-up',
  route((req, res) => {
    const v = new Validator(req.body);
    const assigneeId = v.string('assigneeId', { max: 80, label: 'Responsible staff member' });
    const category = v.oneOf('category', ['Academic Support', 'Study Session', 'Absence Follow-up', 'Disciplinary', 'Other'] as const, { label: 'Category' });
    const title = v.string('title', { min: 3, max: 200, label: 'Title' });
    const notes = v.string('notes', { min: 5, max: 2000, label: 'Instructions' });
    const dueDate = v.date('dueDate', { required: false, label: 'Due date' });
    v.done();
    const student = db().get<any>(`SELECT id, name, department_code, adviser_user_id FROM students WHERE id = ?`, req.params.id);
    if (!student) throw notFound('Student');
    const assignee = db().get<any>(`SELECT id, name, role, department_code FROM users WHERE id = ? AND is_active = 1`, assigneeId);
    const eligible =
      assignee && (assignee.role === 'Warden' || (assignee.role === 'HOD' && assignee.department_code === student.department_code) || (assignee.role === 'Adviser' && student.adviser_user_id === assignee.id));
    if (!eligible) throw badRequest("Choose the student's adviser, their department's HOD, or a Warden.");
    if (dueDate && dueDate < localDate()) throw badRequest('Due date cannot be in the past.');
    const id = db().transaction(() => {
      const newId = nextCode('FU');
      const now = nowIso();
      db().run(
        `INSERT INTO student_followups (id, student_id, owner_user_id, category, title, notes, status, due_date, source_type, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, 'dean_request', ?, ?, ?)`,
        newId,
        student.id,
        assignee.id,
        category,
        title,
        notes,
        dueDate ?? null,
        req.user!.id,
        now,
        now,
      );
      recordEvent('followup', newId, req.user!.id, 'requested_by_dean', { to: 'Open', note: `${assignee.name} (${assignee.role}): ${notes}` });
      notify([assignee.id], {
        eventType: 'followup.requested',
        title: `Follow-up requested: ${student.name}`,
        message: `${req.user!.name}: ${title}${dueDate ? ` (due ${fmtDate(dueDate)})` : ''}`,
        entityType: 'followup',
        entityId: newId,
        link: `/${assignee.role.toLowerCase()}/follow-ups`,
        severity: 'warning',
        dedupeKey: `followup.requested:${newId}`,
      });
      return newId;
    });
    audit(req, 'dean.followup_requested', 'followup', id, { studentId: student.id, assigneeId, category });
    ok(res, { id }, { message: `Follow-up ${id} requested from ${assignee.name}.` });
  }),
);

router.get(
  '/academics',
  route((req, res) => {
    const department = req.query.department ? String(req.query.department) : undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const rows = academicOverview(req.user!, { department, year });
    const byYear = new Map<string, { year: string; students: number; withRecords: number; sum: number; needsSupport: number }>();
    for (const r of rows) {
      const y = byYear.get(r.year) ?? { year: r.year, students: 0, withRecords: 0, sum: 0, needsSupport: 0 };
      y.students++;
      if (r.latestPct !== null) {
        y.withRecords++;
        y.sum += r.latestPct;
      }
      if (r.needsSupport) y.needsSupport++;
      byYear.set(r.year, y);
    }
    const semesters = db().all<any>(
      `SELECT ar.academic_year, ar.semester, ar.assessment, s.department_code AS dept, ROUND(AVG(ar.percentage), 1) AS avg, COUNT(*) AS n
       FROM academic_records ar JOIN students s ON s.id = ar.student_id ${department ? 'WHERE s.department_code = ?' : ''}
       GROUP BY ar.academic_year, ar.semester, ar.assessment, s.department_code ORDER BY ar.academic_year, ar.semester`,
      ...(department ? [department] : []),
    );
    ok(res, {
      hasRecords: rows.some((r) => r.recordCount > 0),
      thresholds: { supportPct: getNumberSetting('academic.support_threshold_pct'), declinePoints: getNumberSetting('academic.decline_points') },
      departments: departmentAcademicSummary(rows),
      years: [...byYear.values()].map((y) => ({ year: y.year, students: y.students, studentsWithRecords: y.withRecords, averageLatestPct: y.withRecords ? Math.round((y.sum / y.withRecords) * 10) / 10 : null, needsSupport: y.needsSupport })),
      assessments: semesters.map((s) => ({ academicYear: s.academic_year, semester: s.semester, assessment: s.assessment, department: s.dept, averagePct: s.avg, records: s.n })),
      students: rows.filter((r) => r.recordCount > 0 || r.needsSupport),
    });
  }),
);

router.get(
  '/study-overview',
  route((req, res) => {
    const to = String(req.query.to || localDate());
    const from = String(req.query.from || addDays(to, -29));
    ok(res, {
      from,
      to,
      byDepartment: studyParticipation(req.user!, from, to, 'department'),
      byYear: studyParticipation(req.user!, from, to, 'year'),
      bySession: studyParticipation(req.user!, from, to, 'session'),
      trend: studyParticipation(req.user!, from, to, 'date'),
      repeatedMisses: repeatedStudyMisses(req.user!, to),
    });
  }),
);

router.get(
  '/attendance-overview',
  route((req, res) => {
    const to = String(req.query.to || localDate());
    const from = String(req.query.from || addDays(to, -29));
    const byDept = db().all<any>(
      `SELECT s.department_code AS dept, s.year, c.status, COUNT(*) AS n FROM absence_cases c JOIN students s ON s.id = c.student_id
       WHERE c.att_date BETWEEN ? AND ? GROUP BY s.department_code, s.year, c.status`,
      from,
      to,
    );
    ok(res, {
      from,
      to,
      byDepartment: byDept.map((r) => ({ department: r.dept, year: yearLabel(r.year), status: r.status, count: r.n })),
      repeated: repeatedAbsences(req.user!, to),
    });
  }),
);

// ---------------------------------------------------------------------------
// Reports & analytics
// ---------------------------------------------------------------------------
router.get(
  '/reports',
  route((_req, res) => ok(res, REPORT_TYPES.map((t) => ({ type: t, ...REPORT_META[t] })))),
);

router.get(
  '/reports/:type',
  route((req, res) => {
    const type = REPORT_TYPES.find((t) => t === req.params.type) as ReportType | undefined;
    if (!type) throw badRequest('Unknown report type.');
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) throw badRequest('Dates must be YYYY-MM-DD.');
    if (from && to && to < from) throw badRequest('The end date must be on or after the start date.');
    const report = generateReport(req.user!, type, { from, to, department: req.query.department ? String(req.query.department) : undefined });
    if (req.query.format === 'csv') {
      audit(req, 'dean.report_exported', 'report', type, { from, to });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-${report.period.to}.csv"`);
      return res.send(reportToCsv(report));
    }
    ok(res, report);
  }),
);

export default router;
