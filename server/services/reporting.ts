import { db } from '../db/database';
import type { AuthUser } from '../lib/auth';
import { badRequest } from '../lib/http';
import { getNumberSetting } from '../lib/records';
import { addDays, fmtDate, fmtDateTime, localDate, nowIso, dayEndIso, dayStartIso } from '../lib/util';
import { repeatedAbsences, repeatedStudyMisses, studyParticipation } from './attendance';
import { academicOverview, departmentAcademicSummary, staffWorkload } from './insights';

export const REPORT_TYPES = [
  'department_academic',
  'study_participation',
  'unauthorized_absence',
  'academic_support_followups',
  'hod_task_progress',
  'adviser_task_progress',
  'schedule_completion',
  'outstanding_assignments',
  'report_submission_status',
  'students_needing_support',
  'repeated_absence_students',
  'repeated_study_misses',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Reports that list individual students. Never attached to cross-department distributions. */
const STUDENT_LEVEL: ReportType[] = ['students_needing_support', 'repeated_absence_students', 'repeated_study_misses'];

export const REPORT_META: Record<ReportType, { title: string; definition: string }> = {
  department_academic: { title: 'Department Academic Performance Summary', definition: 'Average of each student’s latest recorded assessment percentage; support count uses the configured threshold and decline rule.' },
  study_participation: { title: 'Study-Session Participation', definition: '(Present + Late) ÷ (marked − excused) for non-cancelled sessions in the period.' },
  unauthorized_absence: { title: 'Unauthorized Absence Summary', definition: 'Absence records by verification status for roll calls in the period. "Pending" means not yet verified — not an unauthorized absence.' },
  academic_support_followups: { title: 'Academic Support Follow-up Summary', definition: 'Students flagged by the academic rule vs. Academic Support follow-ups opened/completed in the period.' },
  hod_task_progress: { title: 'HOD Task Progress', definition: 'Counts of Dean-assigned tasks per HOD. On-time = completed on or before the recipient deadline.' },
  adviser_task_progress: { title: 'Adviser Task Progress', definition: 'Counts of Dean-assigned tasks per Adviser. On-time = completed on or before the recipient deadline.' },
  schedule_completion: { title: 'Schedule Completion', definition: 'Scheduled activities in the period by category and status with participant acknowledgement counts.' },
  outstanding_assignments: { title: 'Outstanding Assignments', definition: 'Task recipients whose work is not yet completed or cancelled, with overdue flag.' },
  report_submission_status: { title: 'Report Submission Status', definition: 'Per distributed report request: recipients, accepted and outstanding responses.' },
  students_needing_support: { title: 'Students Possibly Needing Academic Support', definition: 'Students matching the configured threshold / decline rule on their latest records.' },
  repeated_absence_students: { title: 'Repeated Unauthorized Absences', definition: 'Students with verified unauthorized absences at or above the configured threshold within the window.' },
  repeated_study_misses: { title: 'Repeated Study-Session Absence', definition: 'Students absent from study sessions at or above the configured threshold within the window.' },
};

export interface GeneratedReport {
  type: ReportType;
  title: string;
  definition: string;
  period: { from: string; to: string; label: string };
  department: string | null;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  notes: string[];
  generatedAt: string;
}

export function generateReport(user: AuthUser, type: ReportType, opts: { from?: string; to?: string; department?: string; aggregateOnly?: boolean } = {}): GeneratedReport {
  if (!REPORT_TYPES.includes(type)) throw badRequest('Unknown report type.');
  if (opts.aggregateOnly && STUDENT_LEVEL.includes(type)) throw badRequest('Student-level reports cannot be attached to a distribution. Choose a summary report.');
  const to = opts.to || localDate();
  const from = opts.from || addDays(to, -29);
  const fromIso = dayStartIso(from);
  const toIso = dayEndIso(to);
  const dept = opts.department || null;
  const keepDept = (d: string | null | undefined) => !dept || d === dept;
  const notes: string[] = [];
  let columns: GeneratedReport['columns'] = [];
  let rows: GeneratedReport['rows'] = [];

  switch (type) {
    case 'department_academic': {
      const overview = academicOverview(user, { department: dept ?? undefined });
      columns = [
        { key: 'department', label: 'Department' },
        { key: 'students', label: 'Students' },
        { key: 'studentsWithRecords', label: 'With records' },
        { key: 'averageLatestPct', label: 'Avg latest %' },
        { key: 'needsSupport', label: 'Needs support' },
        { key: 'declining', label: 'Declining' },
        { key: 'improving', label: 'Improving' },
        { key: 'openSupportFollowups', label: 'Open support follow-ups' },
      ];
      rows = departmentAcademicSummary(overview);
      notes.push(`Support threshold: ${getNumberSetting('academic.support_threshold_pct')}% · decline rule: ≥ ${getNumberSetting('academic.decline_points')} points.`);
      if (!overview.some((o) => o.recordCount > 0)) notes.push('No academic records have been entered yet.');
      break;
    }
    case 'study_participation': {
      columns = [
        { key: 'label', label: 'Department' },
        { key: 'present', label: 'Present' },
        { key: 'late', label: 'Late' },
        { key: 'absent', label: 'Absent' },
        { key: 'excused', label: 'Excused' },
        { key: 'participationPct', label: 'Participation %' },
      ];
      rows = studyParticipation(user, from, to, 'department').filter((r) => keepDept(r.key));
      if (!rows.length) notes.push('No study-session attendance was recorded in this period.');
      break;
    }
    case 'unauthorized_absence': {
      const data = db().all<any>(
        `SELECT s.department_code AS dept, c.status, COUNT(*) AS c FROM absence_cases c JOIN students s ON s.id = c.student_id
         WHERE c.att_date BETWEEN ? AND ? GROUP BY s.department_code, c.status`,
        from,
        to,
      );
      const depts = [...new Set(data.map((d) => d.dept))].filter(keepDept).sort();
      const get = (d: string, st: string) => data.find((x) => x.dept === d && x.status === st)?.c ?? 0;
      columns = [
        { key: 'department', label: 'Department' },
        { key: 'pending', label: 'Pending verification' },
        { key: 'suspected', label: 'Suspected' },
        { key: 'verified', label: 'Verified unauthorized' },
        { key: 'authorized', label: 'Authorized' },
        { key: 'resolved', label: 'Resolved' },
      ];
      rows = depts.map((d) => ({
        department: d,
        pending: get(d, 'Pending Verification'),
        suspected: get(d, 'Suspected Unauthorized'),
        verified: get(d, 'Verified Unauthorized'),
        authorized: get(d, 'Authorized Absence'),
        resolved: get(d, 'Resolved'),
      }));
      notes.push('Pending and suspected records are not yet verified and must not be treated as unauthorized absences.');
      break;
    }
    case 'academic_support_followups': {
      const overview = academicOverview(user, { department: dept ?? undefined });
      const fu = db().all<any>(
        `SELECT s.department_code AS dept, SUM(f.created_at BETWEEN ? AND ?) AS opened, SUM(f.status = 'Completed' AND f.completed_at BETWEEN ? AND ?) AS completed,
           SUM(f.status IN ('Open','In Progress')) AS open, SUM(f.status IN ('Open','In Progress') AND f.due_date < ?) AS overdue
         FROM student_followups f JOIN students s ON s.id = f.student_id WHERE f.category = 'Academic Support' GROUP BY s.department_code`,
        fromIso,
        toIso,
        fromIso,
        toIso,
        localDate(),
      );
      const depts = [...new Set([...overview.map((o) => o.department), ...fu.map((f) => f.dept)])].filter(keepDept).sort();
      columns = [
        { key: 'department', label: 'Department' },
        { key: 'flagged', label: 'Flagged by rule' },
        { key: 'flaggedWithoutFollowup', label: 'Flagged without follow-up' },
        { key: 'opened', label: 'Opened in period' },
        { key: 'completed', label: 'Completed in period' },
        { key: 'open', label: 'Open now' },
        { key: 'overdue', label: 'Overdue' },
      ];
      rows = depts.map((d) => {
        const o = overview.filter((x) => x.department === d && x.needsSupport);
        const f = fu.find((x) => x.dept === d) ?? {};
        return { department: d, flagged: o.length, flaggedWithoutFollowup: o.filter((x) => x.openSupportFollowups === 0).length, opened: f.opened || 0, completed: f.completed || 0, open: f.open || 0, overdue: f.overdue || 0 };
      });
      break;
    }
    case 'hod_task_progress':
    case 'adviser_task_progress': {
      const role = type === 'hod_task_progress' ? 'HOD' : 'Adviser';
      const staff = db().all<any>(`SELECT id, name, department_code FROM users WHERE role = ? AND is_active = 1 ORDER BY department_code, name`, role).filter((s) => keepDept(s.department_code));
      const wl = staffWorkload(staff.map((s) => s.id));
      columns = [
        { key: 'name', label: role },
        { key: 'department', label: 'Department' },
        { key: 'total', label: 'Tasks' },
        { key: 'completed', label: 'Completed' },
        { key: 'completedOnTime', label: 'On time' },
        { key: 'open', label: 'Open' },
        { key: 'overdue', label: 'Overdue' },
        { key: 'unacknowledged', label: 'Not acknowledged' },
        { key: 'reportsOutstanding', label: 'Reports outstanding' },
      ];
      rows = staff.map((s) => {
        const w = wl.get(s.id);
        return { name: s.name, department: s.department_code, ...w.tasks, reportsOutstanding: w.reports.outstanding, onTimeRatePct: undefined } as any;
      });
      notes.push('Operational counts only; these are not performance ratings.');
      break;
    }
    case 'schedule_completion': {
      const data = db().all<any>(
        `SELECT sc.category, sc.status, COUNT(DISTINCT sc.id) AS c, SUM(sp.response = 'Acknowledged') AS acks, COUNT(sp.user_id) AS parts
         FROM schedules sc LEFT JOIN schedule_participants sp ON sp.schedule_id = sc.id
         WHERE sc.start_at BETWEEN ? AND ? ${dept ? 'AND (sc.department_code = ? OR sc.department_code IS NULL)' : ''} GROUP BY sc.category, sc.status ORDER BY sc.category`,
        fromIso,
        toIso,
        ...(dept ? [dept] : []),
      );
      columns = [
        { key: 'category', label: 'Category' },
        { key: 'status', label: 'Status' },
        { key: 'activities', label: 'Activities' },
        { key: 'participants', label: 'Participant slots' },
        { key: 'acknowledged', label: 'Acknowledged' },
      ];
      rows = data.map((d) => ({ category: d.category, status: d.status, activities: d.c, participants: d.parts, acknowledged: d.acks || 0 }));
      break;
    }
    case 'outstanding_assignments': {
      const data = db().all<any>(
        `SELECT a.id, a.title, a.priority, u.name, u.role, u.department_code, ar.status, ar.due_at, ar.progress_pct
         FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id JOIN users u ON u.id = ar.user_id
         WHERE a.status = 'Active' AND ar.status NOT IN ('Completed','Cancelled') ORDER BY ar.due_at`,
      );
      columns = [
        { key: 'id', label: 'Task' },
        { key: 'title', label: 'Title' },
        { key: 'assignee', label: 'Assignee' },
        { key: 'department', label: 'Department' },
        { key: 'status', label: 'Status' },
        { key: 'progress', label: 'Progress %' },
        { key: 'due', label: 'Due' },
        { key: 'overdue', label: 'Overdue' },
      ];
      rows = data
        .filter((d) => keepDept(d.department_code))
        .map((d) => ({ id: d.id, title: d.title, assignee: `${d.name} (${d.role})`, department: d.department_code, status: d.status, progress: d.progress_pct, due: fmtDateTime(d.due_at), overdue: d.due_at < nowIso() ? 'Yes' : 'No' }));
      break;
    }
    case 'report_submission_status': {
      const data = db().all<any>(
        `SELECT q.id, q.title, q.deadline_at, q.status, COUNT(rr.id) AS total, SUM(rr.status = 'Accepted') AS accepted,
           SUM(rr.status IN ('Submitted','Under Review')) AS in_review, SUM(rr.status IN ('Distributed','Acknowledged','Revision Requested')) AS outstanding
         FROM report_requests q LEFT JOIN report_recipients rr ON rr.request_id = q.id
         WHERE q.status != 'Draft' AND q.created_at BETWEEN ? AND ? GROUP BY q.id ORDER BY q.created_at DESC`,
        fromIso,
        toIso,
      );
      columns = [
        { key: 'id', label: 'Request' },
        { key: 'title', label: 'Title' },
        { key: 'deadline', label: 'Deadline' },
        { key: 'total', label: 'Recipients' },
        { key: 'accepted', label: 'Accepted' },
        { key: 'inReview', label: 'In review' },
        { key: 'outstanding', label: 'Outstanding' },
      ];
      rows = data.map((d) => ({ id: d.id, title: d.title, deadline: d.deadline_at ? fmtDateTime(d.deadline_at) : '—', total: d.total, accepted: d.accepted || 0, inReview: d.in_review || 0, outstanding: d.outstanding || 0 }));
      break;
    }
    case 'students_needing_support': {
      columns = [
        { key: 'regNumber', label: 'Reg. No' },
        { key: 'name', label: 'Student' },
        { key: 'department', label: 'Dept' },
        { key: 'year', label: 'Year' },
        { key: 'latestPct', label: 'Latest %' },
        { key: 'trend', label: 'Trend' },
        { key: 'adviserName', label: 'Adviser' },
        { key: 'openSupportFollowups', label: 'Open follow-ups' },
        { key: 'reasons', label: 'Reason' },
      ];
      rows = academicOverview(user, { department: dept ?? undefined })
        .filter((o) => o.needsSupport)
        .map((o) => ({ regNumber: o.regNumber, name: o.name, department: o.department, year: o.year, latestPct: o.latestPct, trend: o.trend, adviserName: o.adviserName || '—', openSupportFollowups: o.openSupportFollowups, reasons: o.reasons.join('; ') }));
      break;
    }
    case 'repeated_absence_students': {
      columns = [
        { key: 'regNumber', label: 'Reg. No' },
        { key: 'name', label: 'Student' },
        { key: 'department', label: 'Dept' },
        { key: 'year', label: 'Year' },
        { key: 'roomNumber', label: 'Room' },
        { key: 'count', label: 'Verified absences' },
        { key: 'lastDate', label: 'Latest' },
      ];
      rows = repeatedAbsences(user, to).filter((r) => keepDept(r.department)) as any;
      notes.push(`Threshold ${getNumberSetting('absence.repeat_threshold')} within ${getNumberSetting('absence.repeat_window_days')} days.`);
      break;
    }
    case 'repeated_study_misses': {
      columns = [
        { key: 'regNumber', label: 'Reg. No' },
        { key: 'name', label: 'Student' },
        { key: 'department', label: 'Dept' },
        { key: 'year', label: 'Year' },
        { key: 'missed', label: 'Sessions missed' },
        { key: 'lastMissed', label: 'Latest' },
      ];
      rows = repeatedStudyMisses(user, to).filter((r) => keepDept(r.department)) as any;
      notes.push(`Threshold ${getNumberSetting('study.repeat_miss_threshold')} within ${getNumberSetting('study.repeat_window_days')} days.`);
      break;
    }
  }

  return {
    type,
    title: REPORT_META[type].title,
    definition: REPORT_META[type].definition,
    period: { from, to, label: `${fmtDate(from)} – ${fmtDate(to)}` },
    department: dept,
    columns,
    rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, (r as any)[c.key] ?? null]))),
    notes,
    generatedAt: fmtDateTime(nowIso()),
  };
}

export function reportToCsv(r: GeneratedReport): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    esc(r.title),
    esc(`Period: ${r.period.label}${r.department ? ` · Department: ${r.department}` : ''}`),
    esc(`Definition: ${r.definition}`),
    '',
    r.columns.map((c) => esc(c.label)).join(','),
    ...r.rows.map((row) => r.columns.map((c) => esc(row[c.key])).join(',')),
    '',
    ...r.notes.map((n) => esc(`Note: ${n}`)),
    esc(`Generated ${r.generatedAt}`),
  ].join('\r\n');
}
