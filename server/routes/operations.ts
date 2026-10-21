import { Router } from 'express';
import { db } from '../db/database';
import { requireRole, type AuthUser } from '../lib/auth';
import { badRequest, conflict, created, forbidden, notFound, ok, route } from '../lib/http';
import { audit, getEvents, notify, recordEvent, usersWithRole } from '../lib/records';
import { assertStudentAccess, canAccessStudent, studentScope } from '../lib/scope';
import { addDays, fmtDate, fmtDateTime, inList, localDate, nextCode, nowIso, parseJson, yearLabel } from '../lib/util';
import { Validator } from '../lib/validate';
import { getSession, isHostellerAdviser, mapSession, sessionRosterView, setSessionStudents, studyAttendanceLog } from '../services/studySessions';
import {
  actOnCase,
  ATTENDANCE_STATUSES,
  closeSession,
  defaultSession,
  getCase,
  getRoll,
  getStudySession,
  listCases,
  mapCase,
  mapStudySession,
  markAttendance,
  markStudyAttendance,
  repeatedAbsences,
  repeatedStudyMisses,
  requestCaseFollowUp,
  sessionState,
  STUDY_SELECT,
  STUDY_STATUSES,
  studyParticipation,
  studyRoster,
} from '../services/attendance';

const router = Router();
const STAFF_MONITORS = ['Warden', 'Dean', 'HOD', 'Adviser'] as const;

// ---------------------------------------------------------------------------
// Hostel attendance (roll call)
// ---------------------------------------------------------------------------
router.get(
  '/attendance/roll',
  requireRole('Warden', 'Dean'),
  route((req, res) => {
    const date = String(req.query.date || localDate());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Invalid date.');
    const session = String(req.query.session || defaultSession());
    const roll = getRoll(req.user!, date, session);
    const tally = (s: string) => roll.filter((r) => r.status === s).length;
    ok(res, {
      ...sessionState(date, session),
      students: roll,
      summary: {
        expected: roll.length,
        present: tally('Present'),
        absent: tally('Absent'),
        onLeave: tally('On Leave'),
        onOuting: tally('On Outing'),
        notRecorded: tally('Not Recorded'),
      },
    });
  }),
);

router.post(
  '/attendance/mark',
  requireRole('Warden'),
  route((req, res) => {
    const v = new Validator(req.body);
    const date = v.date('date', { label: 'Date' });
    const session = v.string('session', { required: false, max: 60 }) || defaultSession();
    v.done();
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!entries.length) throw badRequest('Provide at least one attendance entry.');
    if (entries.length > 2000) throw badRequest('Too many entries in one request.');
    for (const e of entries) {
      if (!e || typeof e.studentId !== 'string' || !ATTENDANCE_STATUSES.includes(e.status)) throw badRequest('Each entry needs a studentId and a valid status.');
      if (e.remarks !== undefined && (typeof e.remarks !== 'string' || e.remarks.length > 300)) throw badRequest('Remarks must be text up to 300 characters.');
    }
    const result = markAttendance(req.user!, date!, session, entries);
    audit(req, 'attendance.marked', 'attendance_session', `${date}:${session}`, { count: entries.length });
    ok(res, result, { message: `Attendance saved for ${result.recorded} student(s).${result.flaggedCases ? ` ${result.flaggedCases} absence(s) need verification.` : ''}` });
  }),
);

router.post(
  '/attendance/close',
  requireRole('Warden'),
  route((req, res) => {
    const v = new Validator(req.body);
    const date = v.date('date', { label: 'Date' });
    const session = v.string('session', { required: false, max: 60 }) || defaultSession();
    const note = v.string('note', { required: false, max: 300 });
    v.done();
    const result = closeSession(req.user!, date!, session, note);
    audit(req, 'attendance.closed', 'attendance_session', `${date}:${session}`, result);
    ok(res, result, {
      message: `${session} closed.${result.escalated ? ` ${result.escalated} absence(s) marked suspected unauthorized.` : ''}${result.notRecorded ? ` ${result.notRecorded} student(s) were not recorded.` : ''}`,
    });
  }),
);

router.get(
  '/attendance/students/:id',
  requireRole(...STAFF_MONITORS),
  route((req, res) => {
    assertStudentAccess(req.user!, req.params.id);
    const records = db().all<any>(
      `SELECT a.att_date, a.session, a.status, a.remarks, a.method, a.recorded_at, u.name AS recorded_by FROM attendance_records a LEFT JOIN users u ON u.id = a.recorded_by
       WHERE a.student_id = ? ORDER BY a.att_date DESC LIMIT 180`,
      req.params.id,
    );
    const present = records.filter((r) => r.status === 'Present').length;
    ok(res, {
      records: records.map((r) => ({ date: r.att_date, dateDisplay: fmtDate(r.att_date), session: r.session, status: r.status, remarks: r.remarks, method: r.method, recordedBy: r.recorded_by, recordedAt: fmtDateTime(r.recorded_at) })),
      summary: { recorded: records.length, present, absent: records.filter((r) => r.status === 'Absent').length, attendancePct: records.length ? Math.round((present / records.length) * 1000) / 10 : null },
      cases: listCases(req.user!, { studentId: req.params.id }),
    });
  }),
);

router.get(
  '/attendance/summary',
  requireRole('Warden', 'Dean'),
  route((req, res) => {
    const to = String(req.query.to || localDate());
    const from = String(req.query.from || addDays(to, -13));
    const session = String(req.query.session || defaultSession());
    const expected = db().get<{ c: number }>(`SELECT COUNT(*) AS c FROM students WHERE enrollment_status = 'Active' AND is_hosteller = 1`)!.c;
    const rows = db().all<any>(
      `SELECT att_date, SUM(status = 'Present') AS present, SUM(status = 'Absent') AS absent, SUM(status = 'On Leave') AS on_leave, SUM(status = 'On Outing') AS on_outing, COUNT(*) AS recorded
       FROM attendance_records WHERE session = ? AND att_date BETWEEN ? AND ? GROUP BY att_date ORDER BY att_date`,
      session,
      from,
      to,
    );
    ok(res, {
      from,
      to,
      session,
      expectedNow: expected,
      days: rows.map((r) => ({ date: r.att_date, dateDisplay: fmtDate(r.att_date), present: r.present, absent: r.absent, onLeave: r.on_leave, onOuting: r.on_outing, recorded: r.recorded })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Absence verification and follow-up
// ---------------------------------------------------------------------------
router.get(
  '/absences',
  requireRole(...STAFF_MONITORS),
  route((req, res) => {
    ok(
      res,
      listCases(req.user!, {
        status: req.query.status ? String(req.query.status) : undefined,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        department: req.query.department ? String(req.query.department) : undefined,
      }),
    );
  }),
);

router.get(
  '/absences/repeated',
  requireRole(...STAFF_MONITORS),
  route((req, res) => ok(res, repeatedAbsences(req.user!))),
);

router.get(
  '/absences/:id',
  requireRole(...STAFF_MONITORS),
  route((req, res) => ok(res, mapCase(getCase(req.user!, req.params.id), true))),
);

router.post(
  '/absences/:id/action',
  requireRole(...STAFF_MONITORS),
  route((req, res) => {
    const v = new Validator(req.body);
    const action = v.oneOf('action', ['verify_unauthorized', 'authorize', 'resolve', 'add_note'] as const, { label: 'Action' });
    const note = v.string('note', { required: false, max: 1000, label: 'Note' });
    v.done();
    if (req.user!.role === 'Dean' && action !== 'add_note') throw forbidden('The Dean monitors absences and can request follow-up; verification is done by the Warden office.');
    const c = actOnCase(req.user!, req.params.id, action!, note);
    audit(req, `absence.${action}`, 'absence_case', c.id, { note });
    ok(res, c, { message: `Absence record ${c.id} updated: ${c.status}.` });
  }),
);

router.post(
  '/absences/:id/follow-up',
  requireRole('Dean', 'Warden'),
  route((req, res) => {
    const v = new Validator(req.body);
    const assigneeId = v.string('assigneeId', { max: 80, label: 'Responsible staff member' });
    const note = v.string('note', { min: 5, max: 1000, label: 'Instructions' });
    v.done();
    const c = requestCaseFollowUp(req.user!, req.params.id, assigneeId!, note!);
    audit(req, 'absence.follow_up_requested', 'absence_case', c.id, { assigneeId });
    ok(res, c, { message: `Follow-up requested from ${c.followUpName}.` });
  }),
);

// ---------------------------------------------------------------------------
// Study sessions.
//
// Sessions are conducted by the Adviser they are assigned to, and only an Adviser
// whose responsibility is "Hosteller" may be assigned one. The Dean schedules and
// monitors; the Warden has read-only visibility of hostel attendance records and is
// no longer the session operator.
// ---------------------------------------------------------------------------
router.get(
  '/study-sessions',
  requireRole('Warden', 'Dean', 'HOD', 'Adviser'),
  route((req, res) => {
    const from = String(req.query.from || addDays(localDate(), -30));
    const to = String(req.query.to || addDays(localDate(), 60));
    const mine = req.query.mine === '1' && req.user!.role === 'Adviser';
    const rows = db().all(
      `SELECT ss.* FROM study_sessions ss WHERE ss.session_date BETWEEN ? AND ? ${mine ? 'AND ss.adviser_user_id = ?' : ''}
       ORDER BY ss.session_date DESC, ss.start_time DESC`,
      from,
      to,
      ...(mine ? [req.user!.id] : []),
    );
    ok(
      res,
      rows.map((r: any) => mapSession(getSession(r.id), req.user!)),
    );
  }),
);

/** Advisers who may be assigned a hostel study session. */
router.get(
  '/study-sessions/advisers',
  requireRole('Dean', 'Warden', 'Admin', 'HOD'),
  route((_req, res) => {
    ok(
      res,
      db()
        .all<any>(`SELECT id, name, email, department_code FROM users WHERE role = 'Adviser' AND is_active = 1 AND student_category = 'Hosteller' ORDER BY department_code, name`)
        .map((u) => ({ id: u.id, name: u.name, email: u.email, department: u.department_code })),
    );
  }),
);

function readStudySession(body: any, partial = false) {
  const v = new Validator(body);
  const out = {
    title: v.string('title', { max: 150, label: 'Title', required: !partial }),
    date: v.date('date', { label: 'Date', required: !partial }),
    startTime: v.time('startTime', { label: 'Start time', required: !partial }),
    endTime: v.time('endTime', { label: 'End time', required: !partial }),
    location: v.string('location', { max: 150, label: 'Location', required: !partial }),
    block: v.string('block', { required: false, max: 40 }),
    department: v.string('department', { required: false, max: 20 }),
    section: v.string('section', { required: false, max: 4, label: 'Section' }),
    year: v.int('year', { required: false, min: 1, max: 5, label: 'Year' }),
    notes: v.string('notes', { required: false, max: 1000 }),
    // Optional explicit roster; with none, the filters above decide who is expected.
    studentIds: v.stringArray('studentIds', { required: false, max: 300, label: 'Assigned students' }),
  };
  v.done();
  if (out.startTime && out.endTime && out.endTime <= out.startTime) throw badRequest('End time must be after start time.', { fields: { endTime: 'End time must be after start time.' } });
  if (out.department && !db().get('SELECT 1 FROM departments WHERE code = ?', out.department)) throw badRequest('Unknown department.');
  return out;
}

router.post(
  '/study-sessions',
  requireRole('Dean', 'Adviser'),
  route((req, res) => {
    const s = readStudySession(req.body);
    // The Dean assigns a Hosteller Adviser; an Adviser may only schedule for themselves.
    const adviserId = req.user!.role === 'Adviser' ? req.user!.id : new Validator(req.body).string('adviserId', { max: 80, label: 'Adviser' });
    if (!adviserId) throw badRequest('Choose the Adviser who will conduct the session.', { fields: { adviserId: 'Adviser is required.' } });
    if (!isHostellerAdviser(adviserId)) {
      throw badRequest('Only an Adviser whose responsibility is "Hosteller" can conduct a hostel study session.', { fields: { adviserId: 'This Adviser is not responsible for hostel students.' } });
    }
    if (s.date! < localDate()) throw badRequest('Study sessions cannot be scheduled in the past.');
    const clash = db().get<any>(
      `SELECT id, title FROM study_sessions WHERE status = 'Scheduled' AND session_date = ? AND location = ? AND start_time < ? AND end_time > ?`,
      s.date,
      s.location,
      s.endTime,
      s.startTime,
    );
    if (clash && !req.body.allowOverlap) throw conflict(`"${clash.title}" is already scheduled at ${s.location} during this time.`, { conflictId: clash.id });
    const id = db().transaction(() => {
      const newId = nextCode('STS');
      const now = nowIso();
      db().run(
        `INSERT INTO study_sessions (id, title, session_date, start_time, end_time, location, block, department_code, section, year, adviser_user_id, status, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?, ?, ?)`,
        newId,
        s.title,
        s.date,
        s.startTime,
        s.endTime,
        s.location,
        s.block ?? null,
        s.department ?? null,
        s.section ? s.section.toUpperCase() : null,
        s.year ?? null,
        adviserId,
        s.notes ?? null,
        req.user!.id,
        now,
        now,
      );
      if (s.studentIds?.length) setSessionStudents(newId, s.studentIds, adviserId, req.user!.id);
      recordEvent('study_session', newId, req.user!.id, 'scheduled', { to: 'Scheduled', note: `Assigned to adviser ${adviserId}` });
      if (adviserId !== req.user!.id) {
        notify([adviserId], {
          eventType: 'study.scheduled',
          title: `Study session assigned to you: ${s.title}`,
          message: `${fmtDate(s.date)} ${s.startTime}–${s.endTime} at ${s.location}. Start it from your portal on the day.`,
          entityType: 'study_session',
          entityId: newId,
          link: '/adviser/study-sessions',
          dedupeKey: `study.scheduled:${newId}`,
        });
      }
      return newId;
    });
    audit(req, 'study_session.created', 'study_session', id);
    created(res, mapSession(getSession(id), req.user!), `Study session ${id} scheduled.`);
  }),
);

router.patch(
  '/study-sessions/:id',
  requireRole('Dean', 'Adviser'),
  route((req, res) => {
    const current = getSession(req.params.id);
    if (req.user!.role === 'Dean' && current.created_by !== req.user!.id) throw forbidden('The Dean can edit only sessions the Dean scheduled.');
    if (req.user!.role === 'Adviser' && current.adviser_user_id !== req.user!.id) throw forbidden('This session is assigned to another Adviser.');
    if (['In Progress', 'Completed'].includes(current.status) && req.body?.status !== 'Cancelled') throw conflict(`A session that is "${current.status}" is managed with the start/end actions.`);
    const v = new Validator(req.body);
    const status = v.oneOf('status', ['Scheduled', 'Completed', 'Cancelled'] as const, { required: false, label: 'Status' });
    const reason = v.string('reason', { required: false, max: 500 });
    v.done();
    if (status === 'Cancelled' && !reason) throw badRequest('Give a reason for cancelling the session.', { fields: { reason: 'Reason is required.' } });
    if (current.status === 'Cancelled' && status !== undefined) throw conflict('A cancelled session cannot be changed.');
    if (current.status === 'Completed' && status === 'Scheduled') throw conflict('A completed session cannot be re-opened.');
    const s = readStudySession(req.body, true);
    const now = nowIso();
    db().run(
      `UPDATE study_sessions SET title = COALESCE(?, title), session_date = COALESCE(?, session_date), start_time = COALESCE(?, start_time), end_time = COALESCE(?, end_time),
        location = COALESCE(?, location), section = COALESCE(?, section), department_code = COALESCE(?, department_code), year = COALESCE(?, year),
        notes = COALESCE(?, notes), status = COALESCE(?, status), updated_at = ? WHERE id = ?`,
      s.title ?? null,
      s.date ?? null,
      s.startTime ?? null,
      s.endTime ?? null,
      s.location ?? null,
      s.section ? s.section.toUpperCase() : null,
      s.department ?? null,
      s.year ?? null,
      s.notes ?? null,
      status ?? null,
      now,
      current.id,
    );
    if (req.body?.studentIds !== undefined && current.adviser_user_id) {
      setSessionStudents(current.id, s.studentIds ?? [], current.adviser_user_id, req.user!.id);
    }
    recordEvent('study_session', current.id, req.user!.id, status && status !== current.status ? `status_${status.replace(/\s+/g, '_').toLowerCase()}` : 'updated', {
      from: current.status,
      to: status ?? current.status,
      note: reason,
    });
    audit(req, 'study_session.updated', 'study_session', current.id, { status, reason });
    ok(res, mapSession(getSession(current.id), req.user!), { message: `Study session ${current.id} updated.` });
  }),
);

router.get(
  '/study-sessions/:id/roster',
  requireRole('Warden', 'Dean', 'HOD', 'Adviser'),
  route((req, res) => {
    const data = sessionRosterView(req.params.id, req.user!);
    ok(res, { ...data, history: getEvents('study_session', req.params.id) });
  }),
);

/** Manual corrections (Excused, late arrivals) stay with the Adviser who runs the session. */
router.post(
  '/study-sessions/:id/attendance',
  requireRole('Adviser'),
  route((req, res) => {
    const session = getSession(req.params.id);
    if (session.adviser_user_id !== req.user!.id) throw forbidden('This session is assigned to another Adviser.');
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length) throw badRequest('Provide at least one attendance entry.');
    for (const e of entries) {
      if (!e || typeof e.studentId !== 'string' || !STUDY_STATUSES.includes(e.status)) throw badRequest('Each entry needs a studentId and a valid status.');
    }
    markStudyAttendance(req.user!, req.params.id, entries);
    audit(req, 'study_session.attendance', 'study_session', req.params.id, { count: entries.length });
    ok(res, mapSession(getSession(req.params.id), req.user!), { message: `Study attendance saved (${entries.length}).` });
  }),
);

/**
 * The study-session attendance log: one row per student per session, for the Dean
 * and for the Hosteller Adviser who conducts the sessions.
 */
router.get(
  '/study/attendance-log',
  requireRole('Dean', 'Adviser', 'HOD', 'Warden'),
  route((req, res) => {
    const to = String(req.query.to || localDate());
    const from = String(req.query.from || addDays(to, -29));
    const status = ['Present', 'Late', 'Absent', 'Excused', 'Pending Reconciliation'].find((x) => x === req.query.status);
    const department = req.query.department ? String(req.query.department) : undefined;
    ok(res, { from, to, ...studyAttendanceLog(req.user!, { from, to, status, department }) });
  }),
);

router.get(
  '/study/summary',
  requireRole('Warden', 'Dean', 'HOD', 'Adviser'),
  route((req, res) => {
    const to = String(req.query.to || localDate());
    const from = String(req.query.from || addDays(to, -29));
    const groupBy = (['department', 'year', 'session', 'date'] as const).find((g) => g === req.query.groupBy) ?? 'department';
    ok(res, { from, to, groupBy, rows: studyParticipation(req.user!, from, to, groupBy), repeatedMisses: repeatedStudyMisses(req.user!, to) });
  }),
);

// ---------------------------------------------------------------------------
// Incident reports (filed by the Warden; reviewed by the AO; visible to HOD/Adviser/Dean by scope)
// ---------------------------------------------------------------------------
export const INCIDENT_CATEGORIES = ['Curfew Violation', 'Unauthorized Absence', 'Ragging / Harassment', 'Property Damage', 'Substance Possession', 'Medical Emergency', 'Fight / Altercation', 'Theft', 'Safety Hazard', 'Other'] as const;

const INCIDENT_SELECT = `
  i.*, s.name AS student_name, s.reg_number, s.department_code, s.year, s.medical_notes, s.blood_group, r.room_number, r.block, r.room_type,
  u.name AS reporter_name, u.role AS reporter_role, esc.id AS escalation_id, esc.status AS escalation_status
  FROM incidents i
  LEFT JOIN students s ON s.id = i.student_id
  LEFT JOIN rooms r ON r.id = s.room_id
  JOIN users u ON u.id = i.reported_by
  LEFT JOIN escalations esc ON esc.source_type = 'incident' AND esc.source_id = i.id
`;

/** Matches the existing `IncidentReport` UI type. */
export function mapIncident(i: any, withHistory = false) {
  return {
    id: i.id,
    studentId: i.student_id,
    studentName: i.student_name || 'Not linked to a student',
    regNumber: i.reg_number || '—',
    department: i.department_code || '—',
    year: yearLabel(i.year),
    roomNumber: i.room_number || '—',
    incidentCategory: i.category,
    incidentDate: fmtDateTime(i.incident_at),
    incidentAt: i.incident_at,
    submittedDate: fmtDate(i.created_at),
    reportingWarden: i.reporter_name,
    reporterRole: i.reporter_role,
    status: i.status,
    severity: i.severity,
    location: i.location,
    description: i.description,
    actionTakenSoFar: i.action_taken || '',
    wardenNotes: i.warden_notes || '',
    witnesses: parseJson<string[]>(i.witnesses_json, []),
    followUpRequired: i.follow_up_required || '',
    hostel: i.block || undefined,
    roomType: i.room_type || undefined,
    medicalIssues: i.medical_notes || undefined,
    currentStatus: i.status,
    escalationId: i.escalation_id || undefined,
    isSampleData: false,
    history: withHistory ? getEvents('incident', i.id) : undefined,
  };
}

function incidentScope(user: AuthUser) {
  if (['Warden', 'AO', 'Dean', 'Principal'].includes(user.role)) return { sql: '1 = 1', params: [] as unknown[] };
  const scope = studentScope(user);
  return { sql: `i.student_id IS NOT NULL AND ${scope.sql}`, params: scope.params };
}

export function getIncident(user: AuthUser, id: string) {
  const scope = incidentScope(user);
  const row = db().get<any>(`SELECT ${INCIDENT_SELECT} WHERE i.id = ? AND ${scope.sql}`, id, ...scope.params);
  if (!row) throw notFound('Incident report');
  return row;
}

router.get(
  '/incidents',
  requireRole('Warden', 'AO', 'Dean', 'HOD', 'Adviser'),
  route((req, res) => {
    const scope = incidentScope(req.user!);
    ok(res, db().all(`SELECT ${INCIDENT_SELECT} WHERE ${scope.sql} ORDER BY i.created_at DESC`, ...scope.params).map((i) => mapIncident(i)));
  }),
);

router.get(
  '/incidents/:id',
  requireRole('Warden', 'AO', 'Dean', 'HOD', 'Adviser'),
  route((req, res) => ok(res, mapIncident(getIncident(req.user!, req.params.id), true))),
);

router.post(
  '/incidents',
  requireRole('Warden', 'HOD'),
  route((req, res) => {
    const v = new Validator(req.body);
    const studentId = v.string('studentId', { required: false, max: 80 });
    const category = v.oneOf('category', INCIDENT_CATEGORIES, { label: 'Category' });
    const severity = v.oneOf('severity', ['Low', 'Medium', 'High', 'Critical'] as const, { label: 'Severity' });
    const incidentAt = v.dateTime('incidentAt', { label: 'Incident date and time' });
    const location = v.string('location', { required: false, max: 200, label: 'Location' });
    const description = v.string('description', { min: 15, max: 4000, label: 'Description' });
    const actionTaken = v.string('actionTaken', { required: false, max: 2000 });
    const notes = v.string('notes', { required: false, max: 2000 });
    const followUp = v.string('followUpRequired', { required: false, max: 500 });
    const witnesses = v.stringArray('witnesses', { max: 20 });
    v.done();
    if (incidentAt! > nowIso()) throw badRequest('The incident time cannot be in the future.');
    if (studentId) assertStudentAccess(req.user!, studentId);
    if (req.user!.role === 'HOD' && !studentId) throw badRequest('HOD incident reports must be linked to a department student.');
    const id = db().transaction(() => {
      const newId = nextCode('INC');
      const now = nowIso();
      db().run(
        `INSERT INTO incidents (id, student_id, category, severity, status, incident_at, location, description, action_taken, warden_notes, witnesses_json, follow_up_required, reported_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Pending Review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId,
        studentId ?? null,
        category,
        severity,
        incidentAt,
        location ?? '',
        description,
        actionTaken ?? null,
        notes ?? null,
        JSON.stringify(witnesses),
        followUp ?? null,
        req.user!.id,
        now,
        now,
      );
      recordEvent('incident', newId, req.user!.id, 'reported', { to: 'Pending Review' });
      const student = studentId ? db().get<any>('SELECT name, department_code, adviser_user_id FROM students WHERE id = ?', studentId) : null;
      const hods = student ? db().all<{ id: string }>(`SELECT id FROM users WHERE role = 'HOD' AND is_active = 1 AND department_code = ?`, student.department_code).map((u) => u.id) : [];
      const base = {
        eventType: 'incident.reported',
        title: `Incident ${newId}: ${category}`,
        message: `${severity} severity${student ? ` · ${student.name}` : ''}${location ? ` · ${location}` : ''}. Reported by ${req.user!.name}.`,
        entityType: 'incident',
        entityId: newId,
        severity: (severity === 'Critical' || severity === 'High' ? 'alert' : 'warning') as 'alert' | 'warning',
        dedupeKey: `incident.reported:${newId}`,
      };
      const others = (ids: (string | null | undefined)[]) => ids.filter((uid) => uid && uid !== req.user!.id);
      notify(others(usersWithRole('AO')), { ...base, link: '/ao/incident-reports' });
      notify(others(hods), { ...base, link: '/hod/incident-reports' });
      notify(others([student?.adviser_user_id]), { ...base, link: '/adviser/incident-reports' });
      return newId;
    });
    audit(req, 'incident.created', 'incident', id);
    created(res, mapIncident(getIncident(req.user!, id), true), `Incident ${id} filed and sent to the AO office.`);
  }),
);

/** Status review: AO decides; the reporting Warden may add notes or mark investigation progress before AO review. */
router.post(
  '/incidents/:id/review',
  requireRole('AO', 'Warden'),
  route((req, res) => {
    const v = new Validator(req.body);
    const status = v.oneOf('status', ['Pending Review', 'Under Investigation', 'Escalated', 'Resolved'] as const, { required: false, label: 'Status' });
    const note = v.string('note', { required: false, max: 2000, label: 'Directive / note' });
    v.done();
    if (!status && !note) throw badRequest('Provide a status change or a note.');
    const result = db().transaction(() => {
      const i = getIncident(req.user!, req.params.id);
      if (req.user!.role === 'Warden' && status && status !== 'Under Investigation') throw forbidden('Escalation and resolution decisions are made by the AO office.');
      if (i.status === 'Resolved' && status) throw conflict('This incident is already resolved.');
      if (status === 'Resolved' && !note) throw badRequest('Add a resolution note.');
      if (status === 'Escalated' && !note) throw badRequest('Add the escalation reason.');
      const now = nowIso();
      if (status && status !== i.status) {
        db().run('UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?', status, now, i.id);
      } else {
        db().run('UPDATE incidents SET updated_at = ? WHERE id = ?', now, i.id);
      }
      recordEvent('incident', i.id, req.user!.id, status && status !== i.status ? `status_${status.toLowerCase().replace(/ /g, '_')}` : 'note', { from: i.status, to: status ?? i.status, note });
      if (status === 'Escalated' && !i.escalation_id) {
        const escId = nextCode('ESC');
        db().run(
          `INSERT INTO escalations (id, source_type, source_id, title, category, priority, status, reason, description, location, student_id, escalated_by, assigned_to_label, created_at, updated_at)
           VALUES (?, 'incident', ?, ?, 'Disciplinary Incident', ?, 'Escalated', ?, ?, ?, ?, ?, 'AO Office', ?, ?)`,
          escId,
          i.id,
          `${i.category}${i.student_name ? ` — ${i.student_name}` : ''}`,
          i.severity === 'Critical' ? 'Critical' : i.severity === 'High' ? 'High' : 'Medium',
          note,
          i.description,
          i.location,
          i.student_id,
          req.user!.id,
          now,
          now,
        );
        recordEvent('escalation', escId, req.user!.id, 'escalated', { to: 'Escalated', note: `From incident ${i.id}: ${note}` });
      }
      notify([i.reported_by].filter((x) => x !== req.user!.id), {
        eventType: 'incident.reviewed',
        title: `Incident ${i.id} ${status ? `→ ${status}` : 'note added'}`,
        message: `${req.user!.name}: ${note ?? ''}`.trim(),
        entityType: 'incident',
        entityId: i.id,
        link: i.reporter_role === 'HOD' ? '/hod/incident-reports' : '/warden/incidents',
      });
      return i.id;
    });
    audit(req, 'incident.reviewed', 'incident', result, { status, note });
    ok(res, mapIncident(getIncident(req.user!, result), true), { message: `Incident ${result} updated.` });
  }),
);

// ---------------------------------------------------------------------------
// Student follow-ups and mentoring sessions
// ---------------------------------------------------------------------------
export const FOLLOWUP_CATEGORIES = ['Academic Support', 'Mentoring Session', 'Absence Follow-up', 'Study Session', 'Disciplinary', 'Other'] as const;

const FOLLOWUP_SELECT = `
  f.*, s.name AS student_name, s.reg_number, s.department_code, s.year, o.name AS owner_name, o.role AS owner_role, c.name AS created_by_name
  FROM student_followups f JOIN students s ON s.id = f.student_id JOIN users o ON o.id = f.owner_user_id JOIN users c ON c.id = f.created_by
`;

export function mapFollowup(f: any, withHistory = false) {
  const today = localDate();
  return {
    id: f.id,
    studentId: f.student_id,
    studentName: f.student_name,
    regNumber: f.reg_number,
    department: f.department_code,
    year: yearLabel(f.year),
    ownerId: f.owner_user_id,
    ownerName: f.owner_name,
    ownerRole: f.owner_role,
    category: f.category,
    title: f.title,
    notes: f.notes,
    status: f.status,
    dueDate: f.due_date,
    dueDisplay: f.due_date ? fmtDate(f.due_date) : null,
    isOverdue: !!f.due_date && f.due_date < today && ['Open', 'In Progress'].includes(f.status),
    sessionDate: f.session_date,
    outcome: f.outcome,
    sourceType: f.source_type,
    sourceId: f.source_id,
    createdBy: f.created_by_name,
    createdAt: fmtDateTime(f.created_at),
    updatedAt: f.updated_at,
    completedAt: f.completed_at ? fmtDateTime(f.completed_at) : null,
    history: withHistory ? getEvents('followup', f.id) : undefined,
  };
}

function followupScope(user: AuthUser, mine: boolean) {
  if (mine || ['Adviser', 'Warden'].includes(user.role)) return { sql: 'f.owner_user_id = ?', params: [user.id] as unknown[] };
  if (user.role === 'HOD') return { sql: 's.department_code = ?', params: [user.departmentCode] as unknown[] };
  if (user.role === 'Dean') return { sql: '1 = 1', params: [] as unknown[] };
  return { sql: '1 = 0', params: [] as unknown[] };
}

router.get(
  '/followups',
  requireRole('Adviser', 'HOD', 'Warden', 'Dean'),
  route((req, res) => {
    const scope = followupScope(req.user!, req.query.mine === '1');
    const where = [scope.sql];
    const params = [...scope.params];
    if (req.query.status) {
      const l = inList(String(req.query.status).split(','));
      where.push(`f.status IN ${l.sql}`);
      params.push(...l.params);
    }
    if (req.query.studentId) {
      where.push('f.student_id = ?');
      params.push(String(req.query.studentId));
    }
    ok(res, db().all(`SELECT ${FOLLOWUP_SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE f.status WHEN 'Open' THEN 0 WHEN 'In Progress' THEN 1 ELSE 2 END, f.due_date`, ...params).map((f) => mapFollowup(f)));
  }),
);

router.post(
  '/followups',
  requireRole('Adviser', 'HOD', 'Warden'),
  route((req, res) => {
    const v = new Validator(req.body);
    const studentId = v.string('studentId', { max: 80, label: 'Student' });
    const category = v.oneOf('category', FOLLOWUP_CATEGORIES, { label: 'Category' });
    const title = v.string('title', { max: 200, label: 'Title' });
    const notes = v.string('notes', { required: false, max: 4000 });
    const dueDate = v.date('dueDate', { required: false, label: 'Due date' });
    const sessionDate = v.date('sessionDate', { required: false, label: 'Session date' });
    const status = v.oneOf('status', ['Open', 'In Progress', 'Completed'] as const, { required: false }) ?? (category === 'Mentoring Session' && sessionDate ? 'Completed' : 'Open');
    const outcome = v.string('outcome', { required: false, max: 2000 });
    v.done();
    assertStudentAccess(req.user!, studentId!);
    const id = db().transaction(() => {
      const newId = nextCode('FU');
      const now = nowIso();
      db().run(
        `INSERT INTO student_followups (id, student_id, owner_user_id, category, title, notes, status, due_date, session_date, outcome, created_by, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId,
        studentId,
        req.user!.id,
        category,
        title,
        notes ?? null,
        status,
        dueDate ?? null,
        sessionDate ?? null,
        outcome ?? null,
        req.user!.id,
        now,
        now,
        status === 'Completed' ? now : null,
      );
      recordEvent('followup', newId, req.user!.id, 'created', { to: status, note: notes });
      return newId;
    });
    audit(req, 'followup.created', 'followup', id, { studentId, category });
    created(res, mapFollowup(db().get(`SELECT ${FOLLOWUP_SELECT} WHERE f.id = ?`, id), true), `${category} record ${id} saved.`);
  }),
);

router.get(
  '/followups/:id',
  requireRole('Adviser', 'HOD', 'Warden', 'Dean'),
  route((req, res) => {
    const f = db().get<any>(`SELECT ${FOLLOWUP_SELECT} WHERE f.id = ?`, req.params.id);
    if (!f) throw notFound('Follow-up');
    const scope = followupScope(req.user!, false);
    if (!db().get(`SELECT 1 FROM student_followups f JOIN students s ON s.id = f.student_id WHERE f.id = ? AND (${scope.sql} OR f.owner_user_id = ?)`, f.id, ...scope.params, req.user!.id)) throw notFound('Follow-up');
    ok(res, mapFollowup(f, true));
  }),
);

router.patch(
  '/followups/:id',
  requireRole('Adviser', 'HOD', 'Warden'),
  route((req, res) => {
    const f = db().get<any>('SELECT * FROM student_followups WHERE id = ?', req.params.id);
    if (!f || f.owner_user_id !== req.user!.id) throw notFound('Follow-up');
    const v = new Validator(req.body);
    const status = v.oneOf('status', ['Open', 'In Progress', 'Completed', 'Cancelled'] as const, { required: false });
    const note = v.string('note', { required: false, max: 2000 });
    const outcome = v.string('outcome', { required: false, max: 2000 });
    const dueDate = v.date('dueDate', { required: false });
    v.done();
    if (['Completed', 'Cancelled'].includes(f.status) && status && status !== f.status) throw conflict(`A ${f.status.toLowerCase()} follow-up cannot be reopened; create a new one.`);
    if (status === 'Completed' && !outcome && !f.outcome) throw badRequest('Record the outcome before completing a follow-up.', { fields: { outcome: 'Outcome is required.' } });
    const now = nowIso();
    db().run(
      `UPDATE student_followups SET status = COALESCE(?, status), outcome = COALESCE(?, outcome), due_date = COALESCE(?, due_date), updated_at = ?, completed_at = CASE WHEN ? = 'Completed' THEN ? ELSE completed_at END WHERE id = ?`,
      status ?? null,
      outcome ?? null,
      dueDate ?? null,
      now,
      status ?? '',
      now,
      f.id,
    );
    recordEvent('followup', f.id, req.user!.id, status && status !== f.status ? 'status_changed' : 'note', { from: f.status, to: status ?? f.status, note: note ?? outcome });
    audit(req, 'followup.updated', 'followup', f.id, { status });
    ok(res, mapFollowup(db().get(`SELECT ${FOLLOWUP_SELECT} WHERE f.id = ?`, f.id), true), { message: 'Follow-up updated.' });
  }),
);

export default router;
