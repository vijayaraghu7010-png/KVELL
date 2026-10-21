import { db } from '../db/database';
import type { AuthUser } from '../lib/auth';
import { deanStudentView, type DeanWardenReport } from '../lib/authority';
import { getNumberSetting } from '../lib/records';
import { addDays, dayEndIso, dayStartIso, fmtDate, fmtDateTime, localDate, yearLabel } from '../lib/util';
import { mapStudent, STUDENT_FROM, STUDENT_SELECT } from '../lib/scope';

/**
 * The Dean's monitoring reads. Everything here is derived from records other roles
 * created — nothing is scored, ranked or invented — and every student shape is run
 * through `deanStudentView`, so private details never leave with it.
 */

/** Identity-only student row for a monitoring list. */
export const monitoringStudent = (studentId: string) => {
  const row = db().get<any>(`SELECT ${STUDENT_SELECT} FROM ${STUDENT_FROM} WHERE s.id = ?`, studentId);
  return row ? deanStudentView(mapStudent(row)) : null;
};

// ---------------------------------------------------------------------------
// C. Uninformed leave / absence
// ---------------------------------------------------------------------------
export interface UninformedCase {
  caseId: string | null;
  studentId: string;
  name: string;
  regNumber: string;
  department: string;
  section: string | null;
  year: string;
  roomNumber: string;
  date: string;
  dateDisplay: string;
  session: string;
  /** What the records actually say, kept apart rather than collapsed into one label. */
  classification: 'Approved leave' | 'Rejected leave' | 'Leave request pending' | 'Awaiting verification' | 'Suspected unauthorized' | 'Verified unauthorized' | 'Resolved';
  verificationStatus: string;
  authorization: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  followUp: { id: string; owner: string; status: string; due: string | null } | null;
  evidence: {
    attendance: { status: string; recordedBy: string | null; recordedAt: string } | null;
    leaveRequests: { id: string; type: string; status: string; stage: string | null; from: string; to: string }[];
    gateMovements: { id: string; type: string; gate: string; at: string; result: string }[];
  };
}

const CLASSIFY: Record<string, UninformedCase['classification']> = {
  'Pending Verification': 'Awaiting verification',
  'Suspected Unauthorized': 'Suspected unauthorized',
  'Verified Unauthorized': 'Verified unauthorized',
  'Authorized Absence': 'Approved leave',
  Resolved: 'Resolved',
};

/**
 * Students who were absent without the required approval, with the evidence trail.
 * Approved, rejected and still-pending leave are reported separately so an absence
 * is never called "unauthorized" when a decision was simply still outstanding.
 */
export function uninformedAbsences(from: string, to: string, department?: string): UninformedCase[] {
  const rows = db().all<any>(
    `SELECT c.*, s.name, s.reg_number, s.department_code, s.section, s.year, r.room_number,
            v.name AS verified_by_name,
            f.id AS fu_id, f.status AS fu_status, f.due_date AS fu_due, fo.name AS fu_owner
     FROM absence_cases c
     JOIN students s ON s.id = c.student_id
     LEFT JOIN rooms r ON r.id = s.room_id
     LEFT JOIN users v ON v.id = c.verified_by
     LEFT JOIN student_followups f ON f.source_type = 'absence_case' AND f.source_id = c.id
     LEFT JOIN users fo ON fo.id = f.owner_user_id
     WHERE c.att_date BETWEEN ? AND ? ${department ? 'AND s.department_code = ?' : ''}
     ORDER BY c.att_date DESC, s.name`,
    from,
    to,
    ...(department ? [department] : []),
  );

  return rows.map((c) => {
    const leaves = db()
      .all<any>(
        `SELECT id, leave_type, status, rejected_stage, from_date, to_date FROM leave_requests
         WHERE student_id = ? AND from_date <= ? AND to_date >= ? ORDER BY created_at DESC`,
        c.student_id,
        c.att_date,
        c.att_date,
      )
      .map((l) => ({ id: l.id, type: l.leave_type, status: l.status, stage: l.rejected_stage ?? null, from: fmtDate(l.from_date), to: fmtDate(l.to_date) }));

    // A pending or rejected request is evidence of intent, not of permission.
    const pending = leaves.find((l) => l.status.startsWith('Pending'));
    const rejected = leaves.find((l) => l.status === 'Rejected');
    let classification = CLASSIFY[c.status] ?? 'Awaiting verification';
    if (classification !== 'Approved leave' && classification !== 'Resolved') {
      if (pending) classification = 'Leave request pending';
      else if (rejected && classification === 'Suspected unauthorized') classification = 'Rejected leave';
    }

    const att = db().get<any>(
      `SELECT a.status, a.recorded_at, u.name AS recorded_by FROM attendance_records a LEFT JOIN users u ON u.id = a.recorded_by
       WHERE a.student_id = ? AND a.att_date = ? AND a.session = ?`,
      c.student_id,
      c.att_date,
      c.session,
    );
    const gates = db()
      .all<any>(
        `SELECT id, movement_type, gate, occurred_at, status FROM gate_movements WHERE student_id = ? AND occurred_at BETWEEN ? AND ? ORDER BY occurred_at`,
        c.student_id,
        dayStartIso(c.att_date),
        dayEndIso(c.att_date),
      )
      .map((g) => ({ id: g.id, type: g.movement_type, gate: g.gate, at: fmtDateTime(g.occurred_at), result: g.status }));

    return {
      caseId: c.id,
      studentId: c.student_id,
      name: c.name,
      regNumber: c.reg_number,
      department: c.department_code,
      section: c.section ?? null,
      year: yearLabel(c.year),
      roomNumber: c.room_number || 'Unallocated',
      date: c.att_date,
      dateDisplay: fmtDate(c.att_date),
      session: c.session,
      classification,
      verificationStatus: c.status,
      authorization: c.authorization_ref ?? null,
      verifiedBy: c.verified_by_name ?? null,
      verifiedAt: c.verified_at ? fmtDateTime(c.verified_at) : null,
      followUp: c.fu_id ? { id: c.fu_id, owner: c.fu_owner, status: c.fu_status, due: c.fu_due ? fmtDate(c.fu_due) : null } : null,
      evidence: {
        attendance: att ? { status: att.status, recordedBy: att.recorded_by ?? null, recordedAt: fmtDateTime(att.recorded_at) } : null,
        leaveRequests: leaves,
        gateMovements: gates,
      },
    };
  });
}

export function uninformedSummary(cases: UninformedCase[]) {
  const by = (k: UninformedCase['classification']) => cases.filter((c) => c.classification === k).length;
  const repeatThreshold = getNumberSetting('absence.repeat_threshold');
  const perStudent = new Map<string, { studentId: string; name: string; regNumber: string; department: string; verified: number }>();
  for (const c of cases.filter((x) => x.classification === 'Verified unauthorized')) {
    const e = perStudent.get(c.studentId) ?? { studentId: c.studentId, name: c.name, regNumber: c.regNumber, department: c.department, verified: 0 };
    e.verified++;
    perStudent.set(c.studentId, e);
  }
  return {
    total: cases.length,
    verifiedUnauthorized: by('Verified unauthorized'),
    suspected: by('Suspected unauthorized'),
    awaitingVerification: by('Awaiting verification'),
    leavePending: by('Leave request pending'),
    rejectedLeave: by('Rejected leave'),
    approvedLeave: by('Approved leave'),
    resolved: by('Resolved'),
    repeatThreshold,
    repeatOffenders: [...perStudent.values()].filter((p) => p.verified >= repeatThreshold).sort((a, b) => b.verified - a.verified),
  };
}

// ---------------------------------------------------------------------------
// Warden monitoring — student-related reports only
// ---------------------------------------------------------------------------
export const WARDEN_REPORT_META: Record<DeanWardenReport, { title: string; description: string }> = {
  'attendance-absence': { title: 'Student attendance & absence', description: 'Roll calls the Warden recorded and closed, with the absences raised from them.' },
  'verified-unauthorized': { title: 'Verified unauthorized absence', description: 'Absence cases the Warden verified as unauthorized, with the reason recorded.' },
  'gate-movements': { title: 'Student gate entry / exit', description: 'Canonical gate-scan events for students, as recorded at the gate desk.' },
  'study-sessions': { title: 'Study session records', description: 'Study sessions and the attendance recorded against them.' },
  'incidents-followups': { title: 'Student incidents & follow-ups', description: 'Student incident reports raised by the Warden and the follow-ups that came from them.' },
};

/**
 * Student-related Warden reports. Deliberately no staff-performance view: these are
 * reports *about students* for which the Warden is the recorded source.
 */
export function wardenStudentReport(user: AuthUser, type: DeanWardenReport, from: string, to: string, department?: string) {
  const deptSql = department ? 'AND s.department_code = ?' : '';
  const deptParam = department ? [department] : [];
  switch (type) {
    case 'attendance-absence': {
      const rows = db().all<any>(
        `SELECT a.att_date, a.session, COUNT(*) AS recorded, SUM(a.status = 'Present') AS present, SUM(a.status = 'Absent') AS absent,
                SUM(a.status = 'On Leave') AS on_leave, SUM(a.status = 'On Outing') AS on_outing,
                (SELECT closed_at FROM attendance_sessions x WHERE x.att_date = a.att_date AND x.session = a.session) AS closed_at,
                (SELECT u.name FROM attendance_sessions x LEFT JOIN users u ON u.id = x.closed_by WHERE x.att_date = a.att_date AND x.session = a.session) AS closed_by
         FROM attendance_records a JOIN students s ON s.id = a.student_id
         WHERE a.att_date BETWEEN ? AND ? ${deptSql}
         GROUP BY a.att_date, a.session ORDER BY a.att_date DESC`,
        from,
        to,
        ...deptParam,
      );
      return rows.map((r) => ({
        date: r.att_date,
        dateDisplay: fmtDate(r.att_date),
        session: r.session,
        recorded: r.recorded,
        present: r.present,
        absent: r.absent,
        onLeave: r.on_leave,
        onOuting: r.on_outing,
        rollClosed: !!r.closed_at,
        closedBy: r.closed_by ?? null,
        closedAt: r.closed_at ? fmtDateTime(r.closed_at) : null,
      }));
    }
    case 'verified-unauthorized':
      return db()
        .all<any>(
          `SELECT c.id, c.att_date, c.session, c.status, c.verification_note, c.verified_at, u.name AS verified_by, s.name, s.reg_number, s.department_code
           FROM absence_cases c JOIN students s ON s.id = c.student_id LEFT JOIN users u ON u.id = c.verified_by
           WHERE c.verified_at IS NOT NULL AND c.status IN ('Verified Unauthorized','Resolved') AND c.att_date BETWEEN ? AND ? ${deptSql}
           ORDER BY c.att_date DESC`,
          from,
          to,
          ...deptParam,
        )
        .map((r) => ({
          id: r.id,
          date: fmtDate(r.att_date),
          session: r.session,
          student: r.name,
          regNumber: r.reg_number,
          department: r.department_code,
          status: r.status,
          note: r.verification_note,
          verifiedBy: r.verified_by ?? null,
          verifiedAt: fmtDateTime(r.verified_at),
        }));
    case 'gate-movements':
      return db()
        .all<any>(
          `SELECT g.id, g.movement_type, g.gate, g.occurred_at, g.status, g.outing_id, g.outpass_id, g.name, g.reg_number, s.department_code, u.name AS recorded_by
           FROM gate_movements g LEFT JOIN students s ON s.id = g.student_id LEFT JOIN users u ON u.id = g.recorded_by
           WHERE g.occurred_at BETWEEN ? AND ? ${department ? 'AND s.department_code = ?' : ''}
           ORDER BY g.occurred_at DESC LIMIT 500`,
          dayStartIso(from),
          dayEndIso(to),
          ...deptParam,
        )
        .map((g) => ({
          id: g.id,
          student: g.name,
          regNumber: g.reg_number,
          department: g.department_code ?? '',
          type: g.movement_type,
          gate: g.gate,
          at: fmtDateTime(g.occurred_at),
          result: g.status,
          outingId: g.outing_id,
          outpassId: g.outpass_id,
          recordedBy: g.recorded_by ?? 'System',
        }));
    case 'study-sessions':
      return db()
        .all<any>(
          `SELECT ss.id, ss.title, ss.session_date, ss.status, ss.location, a.name AS adviser,
                  COUNT(sa.student_id) AS marked, SUM(sa.status IN ('Present','Late')) AS attended, SUM(sa.status = 'Absent') AS absent
           FROM study_sessions ss LEFT JOIN users a ON a.id = ss.adviser_user_id
           LEFT JOIN study_attendance sa ON sa.session_id = ss.id
           WHERE ss.session_date BETWEEN ? AND ? ${department ? 'AND ss.department_code = ?' : ''}
           GROUP BY ss.id ORDER BY ss.session_date DESC`,
          from,
          to,
          ...deptParam,
        )
        .map((r) => ({
          id: r.id,
          title: r.title,
          date: fmtDate(r.session_date),
          status: r.status,
          location: r.location,
          conductedBy: r.adviser ?? 'Unassigned',
          marked: r.marked || 0,
          attended: r.attended || 0,
          absent: r.absent || 0,
        }));
    case 'incidents-followups':
      return db()
        .all<any>(
          `SELECT i.id, i.category, i.severity, i.status, i.incident_at, i.location, s.name, s.reg_number, s.department_code, u.name AS reported_by,
                  (SELECT COUNT(*) FROM student_followups f WHERE f.source_type = 'incident' AND f.source_id = i.id) AS followups
           FROM incidents i LEFT JOIN students s ON s.id = i.student_id LEFT JOIN users u ON u.id = i.reported_by
           WHERE i.incident_at BETWEEN ? AND ? ${department ? 'AND s.department_code = ?' : ''}
           ORDER BY i.incident_at DESC`,
          dayStartIso(from),
          dayEndIso(to),
          ...deptParam,
        )
        .map((r) => ({
          id: r.id,
          student: r.name ?? '—',
          regNumber: r.reg_number ?? '',
          department: r.department_code ?? '',
          category: r.category,
          severity: r.severity,
          status: r.status,
          at: fmtDateTime(r.incident_at),
          location: r.location,
          reportedBy: r.reported_by ?? '—',
          followUps: r.followups,
        }));
  }
}

/** Default monitoring window: the last 30 days. */
export const defaultWindow = () => ({ from: addDays(localDate(), -29), to: localDate() });
