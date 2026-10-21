import { db } from '../db/database';
import type { AuthUser } from '../lib/auth';
import { getNumberSetting } from '../lib/records';
import { getStudent, studentScope } from '../lib/scope';
import { addDays, fmtDate, inList, localDate, nowIso, yearLabel } from '../lib/util';
import { LEAVE_SELECT, mapLeave } from './requests';

export interface AcademicPoint {
  academicYear: string;
  semester: number;
  assessment: string;
  percentage: number;
  sgpa: number | null;
  arrears: number;
}

const ASSESSMENT_ORDER = ['Internal 1', 'Internal 2', 'Internal 3', 'Model Exam', 'Semester Exam'];
const assessmentRank = (a: string) => {
  const i = ASSESSMENT_ORDER.indexOf(a);
  return i === -1 ? ASSESSMENT_ORDER.length : i;
};

/** Chronological academic records per student (year → semester → assessment order). */
export function academicSeries(studentIds: string[]): Map<string, AcademicPoint[]> {
  const out = new Map<string, AcademicPoint[]>();
  if (!studentIds.length) return out;
  const l = inList(studentIds);
  const rows = db().all<any>(`SELECT * FROM academic_records WHERE student_id IN ${l.sql}`, ...l.params);
  for (const r of rows) {
    const list = out.get(r.student_id) ?? [];
    list.push({ academicYear: r.academic_year, semester: r.semester, assessment: r.assessment, percentage: r.percentage, sgpa: r.sgpa, arrears: r.arrears });
    out.set(r.student_id, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.academicYear.localeCompare(b.academicYear) || a.semester - b.semester || assessmentRank(a.assessment) - assessmentRank(b.assessment));
  }
  return out;
}

export type Trend = 'Improving' | 'Declining' | 'Stable' | 'Insufficient data';

export function academicStatus(series: AcademicPoint[] | undefined) {
  const threshold = getNumberSetting('academic.support_threshold_pct');
  const declinePts = getNumberSetting('academic.decline_points');
  if (!series?.length) return { latest: null as AcademicPoint | null, previous: null as AcademicPoint | null, trend: 'Insufficient data' as Trend, needsSupport: false, reasons: [] as string[] };
  const latest = series[series.length - 1];
  const previous = series.length > 1 ? series[series.length - 2] : null;
  let trend: Trend = 'Insufficient data';
  if (previous) {
    const delta = latest.percentage - previous.percentage;
    trend = delta <= -declinePts ? 'Declining' : delta >= declinePts ? 'Improving' : 'Stable';
  }
  const reasons: string[] = [];
  if (latest.percentage < threshold) reasons.push(`Latest ${latest.assessment} ${latest.percentage}% is below the configured ${threshold}% threshold`);
  if (trend === 'Declining') reasons.push(`Dropped ${Math.round((previous!.percentage - latest.percentage) * 10) / 10} points since ${previous!.assessment}`);
  if (latest.arrears > 0) reasons.push(`${latest.arrears} arrear(s) recorded`);
  return { latest, previous, trend, needsSupport: reasons.length > 0, reasons };
}

/** Students in the caller's scope with their academic status, for support lists and summaries. */
export function academicOverview(user: AuthUser, filters: { department?: string; year?: number } = {}) {
  const scope = studentScope(user);
  const where = [scope.sql, `s.enrollment_status = 'Active'`];
  const params = [...scope.params];
  if (filters.department) {
    where.push('s.department_code = ?');
    params.push(filters.department);
  }
  if (filters.year) {
    where.push('s.year = ?');
    params.push(filters.year);
  }
  const students = db().all<any>(
    `SELECT s.id, s.name, s.reg_number, s.department_code, s.year, s.adviser_user_id, adv.name AS adviser_name
     FROM students s LEFT JOIN users adv ON adv.id = s.adviser_user_id WHERE ${where.join(' AND ')} ORDER BY s.department_code, s.year, s.name`,
    ...params,
  );
  const series = academicSeries(students.map((s) => s.id));
  const openFollowups = new Map(
    db()
      .all<any>(`SELECT student_id, COUNT(*) AS c FROM student_followups WHERE category = 'Academic Support' AND status IN ('Open','In Progress') GROUP BY student_id`)
      .map((r) => [r.student_id, r.c]),
  );
  return students.map((s) => {
    const st = academicStatus(series.get(s.id));
    return {
      studentId: s.id,
      name: s.name,
      regNumber: s.reg_number,
      department: s.department_code,
      year: yearLabel(s.year),
      yearNumber: s.year,
      adviserId: s.adviser_user_id,
      adviserName: s.adviser_name,
      latestPct: st.latest?.percentage ?? null,
      latestAssessment: st.latest ? `${st.latest.assessment} · Sem ${st.latest.semester} (${st.latest.academicYear})` : null,
      previousPct: st.previous?.percentage ?? null,
      trend: st.trend,
      needsSupport: st.needsSupport,
      reasons: st.reasons,
      openSupportFollowups: openFollowups.get(s.id) ?? 0,
      recordCount: series.get(s.id)?.length ?? 0,
    };
  });
}

export function departmentAcademicSummary(rows: ReturnType<typeof academicOverview>) {
  const byDept = new Map<string, { department: string; students: number; withRecords: number; sum: number; needsSupport: number; declining: number; improving: number; supportFollowupsOpen: number }>();
  for (const r of rows) {
    const d = byDept.get(r.department) ?? { department: r.department, students: 0, withRecords: 0, sum: 0, needsSupport: 0, declining: 0, improving: 0, supportFollowupsOpen: 0 };
    d.students++;
    if (r.latestPct !== null) {
      d.withRecords++;
      d.sum += r.latestPct;
    }
    if (r.needsSupport) d.needsSupport++;
    if (r.trend === 'Declining') d.declining++;
    if (r.trend === 'Improving') d.improving++;
    d.supportFollowupsOpen += r.openSupportFollowups;
    byDept.set(r.department, d);
  }
  return [...byDept.values()].map((d) => ({
    department: d.department,
    students: d.students,
    studentsWithRecords: d.withRecords,
    averageLatestPct: d.withRecords ? Math.round((d.sum / d.withRecords) * 10) / 10 : null,
    needsSupport: d.needsSupport,
    declining: d.declining,
    improving: d.improving,
    openSupportFollowups: d.supportFollowupsOpen,
  }));
}

/** Full student profile for staff drill-down (respects scope). */
export function studentDetail(user: AuthUser, studentId: string) {
  const student = getStudent(user, studentId);
  const series = academicSeries([studentId]).get(studentId) ?? [];
  const att = db().all<any>('SELECT status FROM attendance_records WHERE student_id = ? AND att_date >= ?', studentId, addDays(localDate(), -60));
  const study = db().get<any>(
    `SELECT COUNT(*) AS marked, SUM(sa.status IN ('Present','Late')) AS attended, SUM(sa.status = 'Excused') AS excused
     FROM study_attendance sa JOIN study_sessions ss ON ss.id = sa.session_id WHERE sa.student_id = ? AND ss.session_date >= ?`,
    studentId,
    addDays(localDate(), -60),
  );
  return {
    ...student,
    academics: { records: series, ...academicStatus(series) },
    attendance60d: {
      recorded: att.length,
      present: att.filter((a) => a.status === 'Present').length,
      absent: att.filter((a) => a.status === 'Absent').length,
      pct: att.length ? Math.round((att.filter((a) => a.status === 'Present').length / att.length) * 1000) / 10 : null,
    },
    study60d: {
      marked: study.marked || 0,
      attended: study.attended || 0,
      pct: study.marked - (study.excused || 0) > 0 ? Math.round(((study.attended || 0) / (study.marked - (study.excused || 0))) * 1000) / 10 : null,
    },
    absenceCases: db()
      .all<any>(`SELECT id, att_date, status FROM absence_cases WHERE student_id = ? ORDER BY att_date DESC LIMIT 20`, studentId)
      .map((c) => ({ id: c.id, date: fmtDate(c.att_date), status: c.status })),
    leaves: db().all(`SELECT ${LEAVE_SELECT} WHERE l.student_id = ? ORDER BY l.created_at DESC LIMIT 10`, studentId).map((l) => mapLeave(l)),
    followups: db()
      .all<any>(`SELECT f.id, f.category, f.title, f.status, f.due_date, u.name AS owner FROM student_followups f JOIN users u ON u.id = f.owner_user_id WHERE f.student_id = ? ORDER BY f.created_at DESC`, studentId)
      .map((f) => ({ id: f.id, category: f.category, title: f.title, status: f.status, due: f.due_date ? fmtDate(f.due_date) : null, owner: f.owner })),
    incidents: db()
      .all<any>(`SELECT id, category, severity, status, incident_at FROM incidents WHERE student_id = ? ORDER BY incident_at DESC`, studentId)
      .map((i) => ({ id: i.id, category: i.category, severity: i.severity, status: i.status, date: fmtDate(i.incident_at) })),
  };
}

/** Operational workload per staff member — transparent counts only, never a "score". */
export function staffWorkload(userIds: string[]) {
  if (!userIds.length) return new Map<string, any>();
  const l = inList(userIds);
  const now = nowIso();
  const today = localDate();
  const tasks = db().all<any>(
    `SELECT ar.user_id,
       COUNT(*) AS total,
       SUM(ar.status = 'Completed') AS completed,
       SUM(ar.status = 'Completed' AND ar.completed_at <= ar.due_at) AS on_time,
       SUM(ar.status NOT IN ('Completed','Cancelled')) AS open,
       SUM(ar.status NOT IN ('Completed','Cancelled') AND ar.due_at < ?) AS overdue,
       SUM(ar.status = 'Assigned') AS unacknowledged,
       SUM(ar.status = 'Submitted') AS awaiting_review
     FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id
     WHERE a.status = 'Active' AND ar.user_id IN ${l.sql} GROUP BY ar.user_id`,
    now,
    ...l.params,
  );
  const reports = db().all<any>(
    `SELECT rr.user_id, COUNT(*) AS total, SUM(rr.status = 'Accepted') AS accepted,
       SUM(rr.status IN ('Distributed','Acknowledged','Revision Requested')) AS outstanding,
       SUM(rr.status IN ('Distributed','Acknowledged','Revision Requested') AND q.deadline_at IS NOT NULL AND q.deadline_at < ?) AS overdue,
       SUM(rr.status = 'Distributed') AS unacknowledged
     FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id WHERE q.status = 'Distributed' AND rr.user_id IN ${l.sql} GROUP BY rr.user_id`,
    now,
    ...l.params,
  );
  const schedules = db().all<any>(
    `SELECT sp.user_id, COUNT(*) AS upcoming, SUM(sp.response = 'Pending') AS unacknowledged
     FROM schedule_participants sp JOIN schedules s ON s.id = sp.schedule_id
     WHERE s.status IN ('Scheduled','Rescheduled') AND s.end_at >= ? AND sp.user_id IN ${l.sql} GROUP BY sp.user_id`,
    now,
    ...l.params,
  );
  const followups = db().all<any>(
    `SELECT owner_user_id AS user_id, SUM(status IN ('Open','In Progress')) AS open, SUM(status IN ('Open','In Progress') AND due_date < ?) AS overdue,
       SUM(status = 'Completed') AS completed, SUM(category = 'Mentoring Session') AS mentoring
     FROM student_followups WHERE owner_user_id IN ${l.sql} GROUP BY owner_user_id`,
    today,
    ...l.params,
  );
  const by = (rows: any[]) => new Map(rows.map((r) => [r.user_id, r]));
  const t = by(tasks);
  const r = by(reports);
  const s = by(schedules);
  const f = by(followups);
  const out = new Map<string, any>();
  for (const id of userIds) {
    const tt = t.get(id) ?? {};
    const rr = r.get(id) ?? {};
    const ss = s.get(id) ?? {};
    const ff = f.get(id) ?? {};
    out.set(id, {
      tasks: {
        total: tt.total || 0,
        completed: tt.completed || 0,
        completedOnTime: tt.on_time || 0,
        open: tt.open || 0,
        overdue: tt.overdue || 0,
        unacknowledged: tt.unacknowledged || 0,
        awaitingReview: tt.awaiting_review || 0,
        onTimeRatePct: tt.completed ? Math.round(((tt.on_time || 0) / tt.completed) * 100) : null,
      },
      reports: { total: rr.total || 0, accepted: rr.accepted || 0, outstanding: rr.outstanding || 0, overdue: rr.overdue || 0, unacknowledged: rr.unacknowledged || 0 },
      schedules: { upcoming: ss.upcoming || 0, unacknowledged: ss.unacknowledged || 0 },
      followups: { open: ff.open || 0, overdue: ff.overdue || 0, completed: ff.completed || 0, mentoringSessions: ff.mentoring || 0 },
    });
  }
  return out;
}
