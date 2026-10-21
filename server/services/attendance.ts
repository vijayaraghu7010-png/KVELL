import { db } from '../db/database';
import { sessionRoster } from './studySessions';
import type { AuthUser } from '../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/http';
import { getEvents, getNumberSetting, getSetting, notify, recordEvent, usersWithRole } from '../lib/records';
import { canAccessStudent, studentScope } from '../lib/scope';
import { addDays, fmtDate, fmtDateTime, inList, localDate, nextCode, nowIso, uid, yearLabel } from '../lib/util';
import { absenceAuthorization } from './requests';

export const ATTENDANCE_STATUSES = ['Present', 'Absent', 'On Leave', 'On Outing'] as const;
export const ABSENCE_STATUSES = ['Pending Verification', 'Authorized Absence', 'Suspected Unauthorized', 'Verified Unauthorized', 'Resolved'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const defaultSession = () => getSetting('attendance.session_name') || 'Night Roll Call';

export function sessionState(date: string, session: string) {
  const row = db().get<any>(
    `SELECT a.*, u.name AS closed_by_name FROM attendance_sessions a LEFT JOIN users u ON u.id = a.closed_by WHERE att_date = ? AND session = ?`,
    date,
    session,
  );
  return { date, session, closed: !!row?.closed_at, closedAt: row?.closed_at ?? null, closedBy: row?.closed_by_name ?? null };
}

/** Roll for a date: every active hosteller with their recorded status (or "Not Recorded"). */
export function getRoll(user: AuthUser, date: string, session: string) {
  const scope = studentScope(user);
  const rows = db().all<any>(
    `SELECT s.id, s.name, s.reg_number, s.department_code, s.year, s.phone, s.parent_name, s.parent_phone, r.room_number, r.block,
       a.status AS att_status, a.method, a.remarks, a.recorded_at, ru.name AS recorded_by_name,
       c.id AS case_id, c.status AS case_status, c.authorization_ref
     FROM students s
     LEFT JOIN rooms r ON r.id = s.room_id
     LEFT JOIN attendance_records a ON a.student_id = s.id AND a.att_date = ? AND a.session = ?
     LEFT JOIN users ru ON ru.id = a.recorded_by
     LEFT JOIN absence_cases c ON c.student_id = s.id AND c.att_date = ? AND c.session = ?
     WHERE s.enrollment_status = 'Active' AND s.is_hosteller = 1 AND ${scope.sql}
     ORDER BY r.block, r.room_number, s.name`,
    date,
    session,
    date,
    session,
    ...scope.params,
  );
  return rows.map((r) => ({
    studentId: r.id,
    name: r.name,
    regNumber: r.reg_number,
    department: r.department_code,
    year: yearLabel(r.year),
    roomNumber: r.room_number || 'Unallocated',
    block: r.block || '',
    phone: r.phone || '',
    parentName: r.parent_name || '',
    parentPhone: r.parent_phone || '',
    status: (r.att_status as AttendanceStatus | null) ?? 'Not Recorded',
    method: r.method || null,
    remarks: r.remarks || '',
    recordedAt: r.recorded_at ? fmtDateTime(r.recorded_at) : null,
    recordedBy: r.recorded_by_name || null,
    absenceCaseId: r.case_id || null,
    absenceStatus: r.case_status || null,
    authorization: r.authorization_ref || null,
  }));
}

function upsertCase(studentId: string, date: string, session: string, status: (typeof ABSENCE_STATUSES)[number], detection: string, authRef: string | null, actorId: string) {
  const existing = db().get<any>('SELECT * FROM absence_cases WHERE student_id = ? AND att_date = ? AND session = ?', studentId, date, session);
  const now = nowIso();
  if (!existing) {
    const id = nextCode('ABS');
    db().run(
      `INSERT INTO absence_cases (id, student_id, att_date, session, status, detection_note, authorization_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      studentId,
      date,
      session,
      status,
      detection,
      authRef,
      now,
      now,
    );
    recordEvent('absence_case', id, actorId, 'flagged', { to: status, note: detection });
    return id;
  }
  // Never downgrade a verified record automatically; reopen a resolved/authorized one only on new evidence.
  if (existing.status === 'Verified Unauthorized' || existing.status === status) return existing.id;
  db().run('UPDATE absence_cases SET status = ?, detection_note = ?, authorization_ref = ?, updated_at = ? WHERE id = ?', status, detection, authRef, now, existing.id);
  recordEvent('absence_case', existing.id, actorId, 're-evaluated', { from: existing.status, to: status, note: detection });
  return existing.id;
}

/** Records (or corrects) attendance and keeps absence cases consistent with authorization records. */
export function markAttendance(user: AuthUser, date: string, session: string, entries: { studentId: string; status: AttendanceStatus; remarks?: string; method?: string }[]) {
  if (date > localDate()) throw badRequest('Attendance cannot be recorded for a future date.');
  const state = sessionState(date, session);
  // A closed roll call is final. The only later change is the gate scanner switching a
  // student recorded "On Outing" to Present when they return (see autoPresentOnReturn).
  if (state.closed) throw conflict(`The ${session} for ${fmtDate(date)} is closed; recorded attendance can no longer be changed.`);
  return db().transaction(() => {
    const flagged: string[] = [];
    for (const e of entries) {
      if (!ATTENDANCE_STATUSES.includes(e.status)) throw badRequest(`Invalid attendance status "${e.status}".`);
      const student = db().get<any>(`SELECT id, name FROM students WHERE id = ? AND enrollment_status = 'Active'`, e.studentId);
      if (!student) throw notFound(`Student ${e.studentId}`);
      if (!canAccessStudent(user, e.studentId)) throw forbidden();
      const prev = db().get<any>('SELECT status FROM attendance_records WHERE student_id = ? AND att_date = ? AND session = ?', e.studentId, date, session);
      const now = nowIso();
      db().run(
        `INSERT INTO attendance_records (id, student_id, att_date, session, status, method, remarks, recorded_by, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, att_date, session) DO UPDATE SET status = excluded.status, method = excluded.method,
           remarks = excluded.remarks, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`,
        uid('att'),
        e.studentId,
        date,
        session,
        e.status,
        e.method || 'Manual Roll Call',
        e.remarks ?? null,
        user.id,
        now,
      );
      if (prev && prev.status !== e.status) {
        recordEvent('attendance', `${e.studentId}:${date}:${session}`, user.id, 'corrected', { from: prev.status, to: e.status, note: e.remarks });
      }

      const authRef = absenceAuthorization(e.studentId, date);
      const existingCase = db().get<any>('SELECT * FROM absence_cases WHERE student_id = ? AND att_date = ? AND session = ?', e.studentId, date, session);
      if (e.status === 'Present') {
        if (existingCase && !['Resolved', 'Verified Unauthorized'].includes(existingCase.status)) {
          db().run(`UPDATE absence_cases SET status = 'Resolved', resolution_note = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`, 'Attendance corrected to Present.', user.id, now, now, existingCase.id);
          recordEvent('absence_case', existingCase.id, user.id, 'resolved', { from: existingCase.status, to: 'Resolved', note: 'Attendance corrected to Present.' });
        }
        continue;
      }
      if (authRef) {
        upsertCase(e.studentId, date, session, 'Authorized Absence', `${e.status}: covered by ${authRef}.`, authRef, user.id);
        continue;
      }
      const detection =
        e.status === 'Absent'
          ? 'Marked absent with no approved leave, outing or gate exit on record.'
          : `Marked "${e.status}" but no matching approved ${e.status === 'On Leave' ? 'leave' : 'outing'} was found.`;
      const status = state.closed && getSetting('attendance.flag_on_close') === 'true' ? 'Suspected Unauthorized' : 'Pending Verification';
      const caseId = upsertCase(e.studentId, date, session, status, detection, null, user.id);
      flagged.push(caseId);
    }
    return { recorded: entries.length, flaggedCases: flagged.length };
  });
}

/**
 * A student recorded as "On Outing" is put back to Present by their own return scan at the
 * hostel gate. This is the one path that may touch a closed roll call, and it never changes
 * any other recorded status.
 */
export function autoPresentOnReturn(studentId: string, actorId: string) {
  const rec = db().get<any>(
    `SELECT * FROM attendance_records WHERE student_id = ? AND status = 'On Outing' AND att_date >= ? ORDER BY att_date DESC LIMIT 1`,
    studentId,
    addDays(localDate(), -1),
  );
  if (!rec) return null;
  const now = nowIso();
  db().run(`UPDATE attendance_records SET status = 'Present', method = 'Gate Return Scan', recorded_by = ?, recorded_at = ? WHERE id = ?`, actorId, now, rec.id);
  recordEvent('attendance', `${studentId}:${rec.att_date}:${rec.session}`, actorId, 'gate_return', {
    from: 'On Outing',
    to: 'Present',
    note: 'Returned through the hostel gate scanner.',
  });
  const c = db().get<any>('SELECT * FROM absence_cases WHERE student_id = ? AND att_date = ? AND session = ?', studentId, rec.att_date, rec.session);
  if (c && !['Resolved', 'Verified Unauthorized'].includes(c.status)) {
    const note = 'Student returned through the hostel gate scanner.';
    db().run(`UPDATE absence_cases SET status = 'Resolved', resolution_note = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`, note, actorId, now, now, c.id);
    recordEvent('absence_case', c.id, actorId, 'resolved', { from: c.status, to: 'Resolved', note });
  }
  return { date: rec.att_date, session: rec.session };
}

/** Closes a roll call. Unexplained absences become "Suspected Unauthorized" when configured. */
export function closeSession(user: AuthUser, date: string, session: string, note?: string) {
  return db().transaction(() => {
    const state = sessionState(date, session);
    if (state.closed) throw conflict(`The ${session} for ${fmtDate(date)} is already closed.`);
    const now = nowIso();
    db().run(
      `INSERT INTO attendance_sessions (att_date, session, closed_at, closed_by, note) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(att_date, session) DO UPDATE SET closed_at = excluded.closed_at, closed_by = excluded.closed_by, note = excluded.note`,
      date,
      session,
      now,
      user.id,
      note ?? null,
    );
    let escalated = 0;
    if (getSetting('attendance.flag_on_close') === 'true') {
      const pending = db().all<any>(`SELECT id FROM absence_cases WHERE att_date = ? AND session = ? AND status = 'Pending Verification'`, date, session);
      for (const p of pending) {
        db().run(`UPDATE absence_cases SET status = 'Suspected Unauthorized', updated_at = ? WHERE id = ?`, now, p.id);
        recordEvent('absence_case', p.id, user.id, 'roll_call_closed', { from: 'Pending Verification', to: 'Suspected Unauthorized' });
        escalated++;
      }
    }
    const notRecorded = db().get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM students s WHERE s.enrollment_status = 'Active' AND s.is_hosteller = 1
       AND NOT EXISTS (SELECT 1 FROM attendance_records a WHERE a.student_id = s.id AND a.att_date = ? AND a.session = ?)`,
      date,
      session,
    )!.c;
    if (escalated) {
      notify(usersWithRole('Dean'), {
        eventType: 'absence.suspected',
        title: `${escalated} suspected unauthorized absence(s) — ${fmtDate(date)}`,
        message: `${session} closed by ${user.name}. Awaiting Warden verification.`,
        entityType: 'attendance_session',
        entityId: `${date}:${session}`,
        link: '/dean/attendance',
        severity: 'warning',
        dedupeKey: `absence.suspected:${date}:${session}`,
      });
    }
    return { ...sessionState(date, session), escalated, notRecorded };
  });
}

// ---------------------------------------------------------------------------
// Absence cases
// ---------------------------------------------------------------------------
export const CASE_SELECT = `
  c.*, s.name AS student_name, s.reg_number, s.department_code, s.year, s.adviser_user_id, s.user_id AS student_user_id,
  r.room_number, r.block, vu.name AS verified_by_name, fu.name AS follow_up_name, fu.role AS follow_up_role, ru.name AS resolved_by_name
  FROM absence_cases c
  JOIN students s ON s.id = c.student_id
  LEFT JOIN rooms r ON r.id = s.room_id
  LEFT JOIN users vu ON vu.id = c.verified_by
  LEFT JOIN users fu ON fu.id = c.follow_up_user_id
  LEFT JOIN users ru ON ru.id = c.resolved_by
`;

export function mapCase(c: any, withHistory = false) {
  return {
    id: c.id,
    studentId: c.student_id,
    studentName: c.student_name,
    regNumber: c.reg_number,
    department: c.department_code,
    year: yearLabel(c.year),
    roomNumber: c.room_number || 'Unallocated',
    block: c.block || '',
    date: c.att_date,
    dateDisplay: fmtDate(c.att_date),
    session: c.session,
    status: c.status,
    detectionNote: c.detection_note,
    authorization: c.authorization_ref,
    verificationNote: c.verification_note,
    verifiedBy: c.verified_by_name,
    verifiedAt: c.verified_at ? fmtDateTime(c.verified_at) : null,
    followUpUserId: c.follow_up_user_id,
    followUpName: c.follow_up_name,
    followUpRole: c.follow_up_role,
    followUpNote: c.follow_up_note,
    resolutionNote: c.resolution_note,
    resolvedBy: c.resolved_by_name,
    resolvedAt: c.resolved_at ? fmtDateTime(c.resolved_at) : null,
    updatedAt: c.updated_at,
    history: withHistory ? getEvents('absence_case', c.id) : undefined,
  };
}

export function listCases(user: AuthUser, filters: { status?: string; from?: string; to?: string; department?: string; studentId?: string }) {
  const scope = studentScope(user);
  const where = [scope.sql];
  const params: unknown[] = [...scope.params];
  if (filters.status) {
    const statuses = filters.status.split(',');
    const l = inList(statuses);
    where.push(`c.status IN ${l.sql}`);
    params.push(...l.params);
  }
  if (filters.from) {
    where.push('c.att_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('c.att_date <= ?');
    params.push(filters.to);
  }
  if (filters.department) {
    where.push('s.department_code = ?');
    params.push(filters.department);
  }
  if (filters.studentId) {
    where.push('c.student_id = ?');
    params.push(filters.studentId);
  }
  return db()
    .all(`SELECT ${CASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.att_date DESC, s.name`, ...params)
    .map((c) => mapCase(c));
}

export function getCase(user: AuthUser, id: string) {
  const c = db().get<any>(`SELECT ${CASE_SELECT} WHERE c.id = ?`, id);
  if (!c || !canAccessStudent(user, c.student_id)) throw notFound('Absence record');
  return c;
}

export type CaseAction = 'verify_unauthorized' | 'authorize' | 'resolve' | 'add_note';

export function actOnCase(user: AuthUser, id: string, action: CaseAction, note: string | undefined) {
  return db().transaction(() => {
    const c = getCase(user, id);
    const now = nowIso();
    if (!note) throw badRequest('A note is required for every absence decision.', { fields: { note: 'Note is required.' } });
    switch (action) {
      case 'verify_unauthorized':
      case 'authorize': {
        if (user.role !== 'Warden') throw forbidden('Only the Warden office verifies absence records.');
        if (!['Pending Verification', 'Suspected Unauthorized'].includes(c.status)) throw conflict(`A "${c.status}" record cannot be re-verified.`);
        const to = action === 'authorize' ? 'Authorized Absence' : 'Verified Unauthorized';
        db().run(
          'UPDATE absence_cases SET status = ?, verification_note = ?, verified_by = ?, verified_at = ?, authorization_ref = COALESCE(?, authorization_ref), updated_at = ? WHERE id = ?',
          to,
          note,
          user.id,
          now,
          action === 'authorize' ? `Authorized by Warden: ${note}` : null,
          now,
          id,
        );
        recordEvent('absence_case', id, user.id, action === 'authorize' ? 'authorized' : 'verified_unauthorized', { from: c.status, to, note });
        if (to === 'Verified Unauthorized') {
          const recipients = [c.adviser_user_id, ...usersWithRole('Dean'), ...db().all<{ id: string }>(`SELECT id FROM users WHERE role = 'HOD' AND is_active = 1 AND department_code = ?`, c.department_code).map((u) => u.id)];
          notify(recipients, {
            eventType: 'absence.verified',
            title: `Unauthorized absence verified: ${c.student_name}`,
            message: `${c.reg_number} · ${fmtDate(c.att_date)} ${c.session}. ${note}`,
            entityType: 'absence_case',
            entityId: id,
            link: '/dean/attendance',
            severity: 'alert',
            dedupeKey: `absence.verified:${id}`,
          });
        }
        break;
      }
      case 'resolve': {
        if (c.status !== 'Verified Unauthorized') throw conflict('Only verified unauthorized absences are resolved through follow-up.');
        const allowed = user.role === 'Warden' || user.id === c.follow_up_user_id || (user.role === 'Adviser' && c.adviser_user_id === user.id) || (user.role === 'HOD' && user.departmentCode === c.department_code);
        if (!allowed) throw forbidden('Only the Warden or the responsible staff member can close this follow-up.');
        db().run(`UPDATE absence_cases SET status = 'Resolved', resolution_note = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`, note, user.id, now, now, id);
        recordEvent('absence_case', id, user.id, 'resolved', { from: c.status, to: 'Resolved', note });
        db().run(
          `UPDATE student_followups SET status = 'Completed', outcome = COALESCE(outcome, ?), completed_at = ?, updated_at = ? WHERE source_type = 'absence_case' AND source_id = ? AND status IN ('Open','In Progress')`,
          note,
          now,
          now,
          id,
        );
        break;
      }
      case 'add_note':
        recordEvent('absence_case', id, user.id, 'note', { note });
        db().run('UPDATE absence_cases SET updated_at = ? WHERE id = ?', now, id);
        break;
    }
    return mapCase(getCase(user, id), true);
  });
}

/** Dean/Warden asks a responsible staff member to follow up; creates a tracked follow-up record. */
export function requestCaseFollowUp(user: AuthUser, id: string, assigneeId: string, note: string) {
  return db().transaction(() => {
    const c = getCase(user, id);
    if (['Authorized Absence', 'Resolved'].includes(c.status)) throw conflict(`No follow-up is needed for a "${c.status}" record.`);
    const assignee = db().get<any>(`SELECT id, name, role, department_code FROM users WHERE id = ? AND is_active = 1`, assigneeId);
    if (!assignee || !['Warden', 'Adviser', 'HOD'].includes(assignee.role)) throw badRequest('Follow-up can be requested from a Warden, Adviser or HOD.');
    if (assignee.role === 'HOD' && assignee.department_code !== c.department_code) throw badRequest("Choose the HOD of the student's department.");
    if (assignee.role === 'Adviser' && c.adviser_user_id !== assignee.id) throw badRequest("Choose the student's assigned adviser.");
    const now = nowIso();
    db().run(
      'UPDATE absence_cases SET follow_up_user_id = ?, follow_up_requested_by = ?, follow_up_note = ?, updated_at = ? WHERE id = ?',
      assigneeId,
      user.id,
      note,
      now,
      id,
    );
    const existing = db().get<any>(`SELECT id FROM student_followups WHERE source_type = 'absence_case' AND source_id = ? AND owner_user_id = ? AND status IN ('Open','In Progress')`, id, assigneeId);
    if (!existing) {
      db().run(
        `INSERT INTO student_followups (id, student_id, owner_user_id, category, title, notes, status, due_date, source_type, source_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'Absence Follow-up', ?, ?, 'Open', ?, 'absence_case', ?, ?, ?, ?)`,
        nextCode('FU'),
        c.student_id,
        assigneeId,
        `Absence on ${fmtDate(c.att_date)} (${c.session})`,
        note,
        addDays(localDate(), 3),
        id,
        user.id,
        now,
        now,
      );
    }
    recordEvent('absence_case', id, user.id, 'follow_up_requested', { note: `${assignee.name} (${assignee.role}): ${note}` });
    notify([assigneeId], {
      eventType: 'absence.follow_up',
      title: `Follow-up requested: ${c.student_name}`,
      message: `${user.name} asked you to follow up on the ${c.status.toLowerCase()} on ${fmtDate(c.att_date)}. ${note}`,
      entityType: 'absence_case',
      entityId: id,
      link: assignee.role === 'Warden' ? '/warden/attendance' : `/${assignee.role.toLowerCase()}/follow-ups`,
      severity: 'warning',
      dedupeKey: `absence.follow_up:${id}:${assigneeId}:${now.slice(0, 16)}`,
    });
    return mapCase(getCase(user, id), true);
  });
}

/** Students whose verified unauthorized absences in the window meet the configured threshold. */
export function repeatedAbsences(user: AuthUser, asOf = localDate()) {
  const threshold = getNumberSetting('absence.repeat_threshold');
  const windowDays = getNumberSetting('absence.repeat_window_days');
  const scope = studentScope(user);
  return db()
    .all<any>(
      `SELECT s.id, s.name, s.reg_number, s.department_code, s.year, r.room_number, COUNT(*) AS cnt, MAX(c.att_date) AS last_date
       FROM absence_cases c JOIN students s ON s.id = c.student_id LEFT JOIN rooms r ON r.id = s.room_id
       WHERE c.status IN ('Verified Unauthorized','Resolved') AND c.verified_at IS NOT NULL AND c.att_date > ? AND c.att_date <= ? AND ${scope.sql}
       GROUP BY s.id HAVING COUNT(*) >= ? ORDER BY cnt DESC`,
      addDays(asOf, -windowDays),
      asOf,
      ...scope.params,
      threshold,
    )
    .map((r) => ({
      studentId: r.id,
      name: r.name,
      regNumber: r.reg_number,
      department: r.department_code,
      year: yearLabel(r.year),
      roomNumber: r.room_number || 'Unallocated',
      count: r.cnt,
      lastDate: fmtDate(r.last_date),
      threshold,
      windowDays,
    }));
}

// ---------------------------------------------------------------------------
// Study sessions
// ---------------------------------------------------------------------------
export const STUDY_STATUSES = ['Present', 'Late', 'Absent', 'Excused'] as const;

function expectedStudents(session: any): any[] {
  const where = [`s.enrollment_status = 'Active'`, 's.is_hosteller = 1'];
  const params: unknown[] = [];
  if (session.adviser_user_id) {
    where.push('s.adviser_user_id = ?');
    params.push(session.adviser_user_id);
  }
  if (session.block) {
    where.push('r.block = ?');
    params.push(session.block);
  }
  if (session.department_code) {
    where.push('s.department_code = ?');
    params.push(session.department_code);
  }
  if (session.year) {
    where.push('s.year = ?');
    params.push(session.year);
  }
  return db().all(
    `SELECT s.id, s.name, s.reg_number, s.department_code, s.year, r.room_number, r.block FROM students s LEFT JOIN rooms r ON r.id = s.room_id WHERE ${where.join(' AND ')} ORDER BY r.block, r.room_number, s.name`,
    ...params,
  );
}

export function mapStudySession(s: any) {
  const counts = db().get<any>(
    `SELECT COUNT(*) AS marked, SUM(status = 'Present') AS present, SUM(status = 'Late') AS late, SUM(status = 'Absent') AS absent, SUM(status = 'Excused') AS excused
     FROM study_attendance WHERE session_id = ?`,
    s.id,
  );
  const expected = expectedStudents(s).length;
  const attended = (counts.present || 0) + (counts.late || 0);
  return {
    id: s.id,
    title: s.title,
    date: s.session_date,
    dateDisplay: fmtDate(s.session_date),
    startTime: s.start_time,
    endTime: s.end_time,
    location: s.location,
    block: s.block,
    department: s.department_code,
    year: s.year,
    status: s.status,
    notes: s.notes,
    createdBy: s.created_by_name,
    createdByRole: s.created_by_role,
    expected,
    marked: counts.marked || 0,
    present: counts.present || 0,
    late: counts.late || 0,
    absent: counts.absent || 0,
    excused: counts.excused || 0,
    participationPct: expected - (counts.excused || 0) > 0 ? Math.round((attended / (expected - (counts.excused || 0))) * 1000) / 10 : null,
  };
}

export const STUDY_SELECT = `ss.*, u.name AS created_by_name, u.role AS created_by_role FROM study_sessions ss JOIN users u ON u.id = ss.created_by`;

export function getStudySession(id: string) {
  const s = db().get<any>(`SELECT ${STUDY_SELECT} WHERE ss.id = ?`, id);
  if (!s) throw notFound('Study session');
  return s;
}

export function studyRoster(user: AuthUser, id: string) {
  const s = getStudySession(id);
  const marks = new Map(db().all<any>('SELECT * FROM study_attendance WHERE session_id = ?', id).map((m) => [m.student_id, m]));
  const roster = expectedStudents(s)
    .filter((st) => canAccessStudent(user, st.id))
    .map((st) => ({
      studentId: st.id,
      name: st.name,
      regNumber: st.reg_number,
      department: st.department_code,
      year: yearLabel(st.year),
      roomNumber: st.room_number || 'Unallocated',
      status: marks.get(st.id)?.status ?? 'Not Marked',
      remarks: marks.get(st.id)?.remarks ?? '',
    }));
  return { session: mapStudySession(s), roster };
}

export function markStudyAttendance(user: AuthUser, id: string, entries: { studentId: string; status: (typeof STUDY_STATUSES)[number]; remarks?: string }[]) {
  return db().transaction(() => {
    const s = getStudySession(id);
    if (s.status === 'Cancelled') throw conflict('Attendance cannot be recorded for a cancelled session.');
    if (s.session_date > localDate()) throw conflict('Attendance can be recorded only on or after the session date.');
    // The roster is the Adviser's own students inside the session filters.
    const expected = new Set(sessionRoster(s).map((x: any) => x.id));
    const now = nowIso();
    for (const e of entries) {
      if (!STUDY_STATUSES.includes(e.status)) throw badRequest(`Invalid study attendance status "${e.status}".`);
      if (!expected.has(e.studentId)) throw badRequest(`Student ${e.studentId} is not part of this session.`);
      db().run(
        `INSERT INTO study_attendance (session_id, student_id, status, source, remarks, marked_by, marked_at) VALUES (?, ?, ?, 'Manual', ?, ?, ?)
         ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, source = 'Manual', remarks = excluded.remarks, marked_by = excluded.marked_by, marked_at = excluded.marked_at`,
        id,
        e.studentId,
        e.status,
        e.remarks ?? null,
        user.id,
        now,
      );
    }
    recordEvent('study_session', id, user.id, 'attendance_marked', { note: `${entries.length} record(s)` });
    return mapStudySession(getStudySession(id));
  });
}

/** Students who missed at least N sessions in the window (configurable). */
export function repeatedStudyMisses(user: AuthUser, asOf = localDate()) {
  const threshold = getNumberSetting('study.repeat_miss_threshold');
  const windowDays = getNumberSetting('study.repeat_window_days');
  const scope = studentScope(user);
  return db()
    .all<any>(
      `SELECT s.id, s.name, s.reg_number, s.department_code, s.year, s.adviser_user_id, COUNT(*) AS missed, MAX(ss.session_date) AS last_missed
       FROM study_attendance sa JOIN study_sessions ss ON ss.id = sa.session_id JOIN students s ON s.id = sa.student_id
       WHERE sa.status = 'Absent' AND ss.status != 'Cancelled' AND ss.session_date > ? AND ss.session_date <= ? AND ${scope.sql}
       GROUP BY s.id HAVING COUNT(*) >= ? ORDER BY missed DESC`,
      addDays(asOf, -windowDays),
      asOf,
      ...scope.params,
      threshold,
    )
    .map((r) => ({
      studentId: r.id,
      name: r.name,
      regNumber: r.reg_number,
      department: r.department_code,
      year: yearLabel(r.year),
      adviserId: r.adviser_user_id,
      missed: r.missed,
      lastMissed: fmtDate(r.last_missed),
      threshold,
      windowDays,
    }));
}

/** Aggregate participation grouped by a dimension, over sessions in [from, to]. */
export function studyParticipation(user: AuthUser, from: string, to: string, groupBy: 'department' | 'year' | 'session' | 'date') {
  const scope = studentScope(user);
  const keyExpr = groupBy === 'department' ? 's.department_code' : groupBy === 'year' ? 's.year' : groupBy === 'date' ? 'ss.session_date' : 'ss.id';
  const rows = db().all<any>(
    `SELECT ${keyExpr} AS k, MIN(ss.title) AS title, MIN(ss.session_date) AS d,
       SUM(sa.status = 'Present') AS present, SUM(sa.status = 'Late') AS late, SUM(sa.status = 'Absent') AS absent, SUM(sa.status = 'Excused') AS excused, COUNT(*) AS marked
     FROM study_attendance sa JOIN study_sessions ss ON ss.id = sa.session_id JOIN students s ON s.id = sa.student_id
     WHERE ss.status != 'Cancelled' AND ss.session_date BETWEEN ? AND ? AND ${scope.sql}
     GROUP BY ${keyExpr} ORDER BY ${groupBy === 'date' ? 'k' : groupBy === 'session' ? 'd' : 'k'}`,
    from,
    to,
    ...scope.params,
  );
  return rows.map((r) => {
    const denom = r.marked - r.excused;
    return {
      key: groupBy === 'year' ? yearLabel(r.k) : String(r.k),
      label: groupBy === 'session' ? `${r.title} (${fmtDate(r.d)})` : groupBy === 'year' ? yearLabel(r.k) : groupBy === 'date' ? fmtDate(r.k) : String(r.k),
      present: r.present,
      late: r.late,
      absent: r.absent,
      excused: r.excused,
      marked: r.marked,
      participationPct: denom > 0 ? Math.round(((r.present + r.late) / denom) * 1000) / 10 : null,
    };
  });
}
