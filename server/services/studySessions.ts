import { db } from '../db/database';
import type { AuthUser } from '../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/http';
import { getNumberSetting, getSetting, notify, recordEvent } from '../lib/records';
import { fmtDate, fmtDateTime, fmtTime, hmac, localDate, localTime, nextCode, nowIso, randomToken, sha256, uid, yearLabel, zonedIso } from '../lib/util';

/**
 * Live study sessions.
 *
 * A session is conducted by the Adviser it is assigned to, and only an Adviser whose
 * responsibility is "Hosteller" may be assigned one. Starting a session issues a
 * short-lived QR code; students scan it from their portal to be marked Present.
 * Ending the session issues a second, different QR for the end-of-session check.
 *
 * Two rules are enforced server-side and are not negotiable in the UI:
 *   - an expired QR can never record attendance;
 *   - an end scan never converts a missing start scan into Present.
 */

export const QR_PHASES = ['Start', 'End'] as const;
export type QrPhase = (typeof QR_PHASES)[number];

const startValidityMs = () => getNumberSetting('study.qr_start_minutes') * 60_000;
const endValidityMs = () => getNumberSetting('study.qr_end_minutes') * 60_000;

/**
 * QR tokens are an HMAC of (session, phase, nonce) keyed by a server-only secret.
 * That makes them unguessable without the secret, yet re-derivable for the Adviser
 * running the session and the students on its roster — the raw token is never stored.
 * The secret is generated once per installation and kept in the settings table.
 */
function qrSecret(): string {
  const existing = db().get<{ value: string }>(`SELECT value FROM settings WHERE key = 'security.qr_secret'`);
  if (existing) return existing.value;
  const value = randomToken(32);
  db().run(
    `INSERT INTO settings (key, value, description, updated_at) VALUES ('security.qr_secret', ?, 'Server-only secret used to derive study-session QR tokens. Never leaves the server.', ?)
     ON CONFLICT(key) DO NOTHING`,
    value,
    nowIso(),
  );
  return db().get<{ value: string }>(`SELECT value FROM settings WHERE key = 'security.qr_secret'`)!.value;
}

const deriveToken = (sessionId: string, phase: QrPhase, nonce: string) => `KV${phase === 'Start' ? 'S' : 'E'}-${hmac(qrSecret(), `${sessionId}|${phase}|${nonce}`)}`;

/**
 * A student's personal attendance code for a live session phase.
 *
 * Derived from the same server secret and the QR's nonce, so it dies when the QR
 * does. The code carries no identifiers: the Adviser's scanner matches it against
 * the roster, which is how the student is identified without putting anything
 * personal into the image.
 */
export function studentAttendanceCode(sessionId: string, phase: QrPhase, studentId: string, nonce: string): string {
  return `KVA-${hmac(qrSecret(), `${sessionId}|${phase}|${studentId}|${nonce}`)}`;
}

/** The live token for a phase, or null when there is no usable QR. */
export function tokenFor(sessionId: string, phase: QrPhase): { token: string; expiresAt: string } | null {
  const qr = activeQr(sessionId, phase);
  if (!qrIsLive(qr)) return null;
  return { token: deriveToken(sessionId, phase, qr.nonce), expiresAt: qr.expires_at };
}

/**
 * Whether this Adviser may run the session: the one it is assigned to, or — for a
 * department-wide session — any Hosteller Adviser of that same department, so a
 * session the system opened on its own is not stranded with one account.
 */
export function canConduct(session: any, user: AuthUser): boolean {
  if (session.adviser_user_id === user.id) return true;
  if (!session.department_wide || !session.department_code) return false;
  const me = db().get<{ department_code: string | null }>('SELECT department_code FROM users WHERE id = ?', user.id);
  return me?.department_code === session.department_code && isHostellerAdviser(user.id);
}

/** The Hosteller Advisers of one department, in a stable order. */
export function departmentAdvisers(departmentCode: string): { id: string; name: string }[] {
  return db().all<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE role = 'Adviser' AND is_active = 1 AND department_code = ? AND student_category = 'Hosteller' ORDER BY name, id`,
    departmentCode,
  );
}

export function isHostellerAdviser(userId: string): boolean {
  const u = db().get<{ role: string; student_category: string | null }>('SELECT role, student_category FROM users WHERE id = ? AND is_active = 1', userId);
  return !!u && u.role === 'Adviser' && u.student_category === 'Hosteller';
}

const ROSTER_SELECT = `s.id, s.user_id, s.name, s.reg_number, s.department_code, s.section, s.year, r.room_number, r.block
  FROM students s LEFT JOIN rooms r ON r.id = s.room_id`;

/**
 * The students assigned to a session.
 *
 * If the Adviser named students explicitly when scheduling, those are the roster.
 * Otherwise it is their own advisees narrowed by the session's department, section,
 * year and block. Either way it stays inside the Adviser's own advisees, so nobody
 * can be marked by a session they do not belong to.
 */
export function sessionRoster(session: any): any[] {
  const explicit = db().all<any>(
    `SELECT ${ROSTER_SELECT}
     JOIN study_session_students x ON x.student_id = s.id
     WHERE x.session_id = ? AND s.enrollment_status = 'Active' ${session.adviser_user_id && !session.department_wide ? 'AND s.adviser_user_id = ?' : ''}
     ORDER BY r.block, r.room_number, s.name`,
    session.id,
    ...(session.adviser_user_id && !session.department_wide ? [session.adviser_user_id] : []),
  );
  if (explicit.length) return explicit;

  const where = [`s.enrollment_status = 'Active'`, 's.is_hosteller = 1'];
  const params: unknown[] = [];
  // An Adviser only ever operates sessions for the students assigned to them —
  // unless the session was started for the whole department, which says as much.
  if (session.adviser_user_id && !session.department_wide) {
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
  if (session.section) {
    where.push('s.section = ?');
    params.push(session.section);
  }
  if (session.year) {
    where.push('s.year = ?');
    params.push(session.year);
  }
  return db().all(`SELECT ${ROSTER_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.block, r.room_number, s.name`, ...params);
}

/** Replaces a session's explicit roster. An empty list restores the filter-based one. */
export function setSessionStudents(sessionId: string, studentIds: string[], adviserUserId: string, actorId: string) {
  db().transaction(() => {
    db().run('DELETE FROM study_session_students WHERE session_id = ?', sessionId);
    if (!studentIds.length) return;
    const now = nowIso();
    for (const id of new Set(studentIds)) {
      const owned = db().get('SELECT 1 FROM students s WHERE s.id = ? AND s.adviser_user_id = ?', id, adviserUserId);
      if (!owned) throw badRequest('You can only assign students who are advised by you.');
      db().run('INSERT INTO study_session_students (session_id, student_id, added_by, created_at) VALUES (?, ?, ?, ?)', sessionId, id, actorId, now);
    }
  });
}

export function getSession(id: string) {
  const s = db().get<any>(
    `SELECT ss.*, a.name AS adviser_name, a.student_category AS adviser_category, st.name AS started_by_name, en.name AS ended_by_name
     FROM study_sessions ss
     LEFT JOIN users a ON a.id = ss.adviser_user_id
     LEFT JOIN users st ON st.id = ss.started_by
     LEFT JOIN users en ON en.id = ss.ended_by
     WHERE ss.id = ?`,
    id,
  );
  if (!s) throw notFound('Study session');
  return s;
}

export const activeQr = (sessionId: string, phase: QrPhase) =>
  db().get<any>(`SELECT * FROM study_session_qr WHERE session_id = ? AND phase = ?`, sessionId, phase) ?? null;

export const qrIsLive = (qr: any, at = Date.now()) => !!qr && !qr.invalidated_at && Date.parse(qr.expires_at) > at;

/** The window in which the Adviser may start this session, from the configured settings. */
export function startWindow(session: any) {
  const early = getNumberSetting('study.start_early_minutes');
  const late = getNumberSetting('study.start_late_minutes');
  const opensAt = new Date(Date.parse(zonedIso(session.session_date, `${session.start_time}:00`)) - early * 60_000).toISOString();
  const closesAt = new Date(Date.parse(zonedIso(session.session_date, `${session.end_time}:00`)) + late * 60_000).toISOString();
  return { opensAt, closesAt, earlyMinutes: early, lateMinutes: late };
}

export function canStart(session: any, user: AuthUser, at = new Date()): { ok: boolean; reason?: string } {
  if (session.status === 'Cancelled') return { ok: false, reason: 'This session was cancelled.' };
  if (session.status === 'In Progress') return { ok: false, reason: 'This session has already been started.' };
  if (session.status === 'Completed') return { ok: false, reason: 'This session has already been completed.' };
  if (!canConduct(session, user)) return { ok: false, reason: 'This session is assigned to another Adviser.' };
  if (!isHostellerAdviser(user.id)) return { ok: false, reason: 'Only an Adviser responsible for Hosteller students can run hostel study sessions.' };
  if (session.session_date !== localDate(at)) return { ok: false, reason: `This session can only be started on ${session.session_date}.` };
  const w = startWindow(session);
  const iso = at.toISOString();
  if (iso < w.opensAt) return { ok: false, reason: `The start window opens ${w.earlyMinutes} minute(s) before the scheduled start (${fmtTime(w.opensAt)}).` };
  if (iso > w.closesAt) return { ok: false, reason: `The start window closed at ${fmtTime(w.closesAt)}.` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Start on the spot
// ---------------------------------------------------------------------------
/**
 * Creates a session for right now and starts it in the same step.
 *
 * Advisers do not schedule study sessions: they press "Start session" when the
 * students are in the room. The session is written with today's date, the current
 * wall-clock time and the default venue and length from the institutional rules,
 * then handed to `startSession` so the roster, QR and notifications follow exactly
 * the same path as any other session.
 */
export function startInstantSession(user: AuthUser, input: { startTime?: string; endTime?: string } = {}) {
  if (!isHostellerAdviser(user.id)) throw forbidden('Only an Adviser responsible for Hosteller students can run hostel study sessions.');
  const running = db().get<{ id: string; title: string }>(`SELECT id, title FROM study_sessions WHERE adviser_user_id = ? AND status = 'In Progress'`, user.id);
  if (running) throw conflict(`You are already running a study session (${running.id}). End it before starting another.`);

  const department = db().get<{ department_code: string | null }>('SELECT department_code FROM users WHERE id = ?', user.id)?.department_code ?? null;
  if (!department) throw conflict('Your account has no department recorded, so there is no department to run a session for.');
  // One session per department at a time, whoever opened it — the timetable's own
  // session counts, so a second one can never split a department's attendance.
  const departmentRunning = db().get<{ id: string }>(
    `SELECT id FROM study_sessions WHERE department_code = ? AND department_wide = 1 AND status = 'In Progress'`,
    department,
  );
  if (departmentRunning) throw conflict(`A ${department} study session (${departmentRunning.id}) is already running. End it before starting another.`);

  const now = new Date();
  const date = localDate(now);
  const minutes = getNumberSetting('study.default_minutes') || 90;
  const startTime = normaliseTime(input.startTime, 'Start time') ?? localTime(now);
  const endTime = normaliseTime(input.endTime, 'End time') ?? addMinutes(startTime, minutes);
  if (endTime <= startTime) throw badRequest('End time must be after start time.', { fields: { endTime: 'End time must be after start time.' } });

  // The session starts now, so the times given have to contain "now" the same way
  // `canStart` requires — rejecting it here says so in plain words instead of
  // failing further down with a window message about a session nobody scheduled.
  const early = getNumberSetting('study.start_early_minutes');
  const late = getNumberSetting('study.start_late_minutes');
  const iso = now.toISOString();
  if (iso < new Date(Date.parse(zonedIso(date, `${startTime}:00`)) - early * 60_000).toISOString()) {
    throw badRequest(`A session can be started at most ${early} minute(s) before its start time.`, { fields: { startTime: 'Too far in the future.' } });
  }
  if (iso > new Date(Date.parse(zonedIso(date, `${endTime}:00`)) + late * 60_000).toISOString()) {
    throw badRequest(`That session would already be over — its end time passed more than ${late} minute(s) ago.`, { fields: { endTime: 'Already past.' } });
  }

  const id = db().transaction(() => {
    const newId = nextCode('STS');
    const createdAt = nowIso();
    db().run(
      `INSERT INTO study_sessions (id, title, session_date, start_time, end_time, location, department_code, department_wide, adviser_user_id, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'Scheduled', ?, ?, ?)`,
      newId,
      `Study session · ${fmtDate(date)}`,
      date,
      startTime,
      endTime,
      getSetting('study.default_location') || 'Hostel study hall',
      department,
      user.id,
      user.id,
      createdAt,
      createdAt,
    );
    recordEvent('study_session', newId, user.id, 'scheduled', { to: 'Scheduled', note: `Started on the spot for ${department}, ${startTime}–${endTime}` });
    return newId;
  });
  return startSession(user, id);
}

/** 'HH:MM' from a time input, or undefined when nothing was supplied. */
function normaliseTime(value: string | undefined, label: string): string | undefined {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!m || h > 23 || min > 59) throw badRequest(`${label} must be a time such as 18:30.`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Adds minutes to 'HH:MM', stopping at the end of the day. */
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
export function startSession(user: AuthUser, id: string): { session: any; token: string; expiresAt: string } {
  return db().transaction(() => {
    const s = getSession(id);
    const verdict = canStart(s, user);
    if (!verdict.ok) throw conflict(verdict.reason!);
    const now = nowIso();
    const roster = sessionRoster(s);
    if (!roster.length) throw conflict('No students are assigned to you inside this session’s filters, so there is nobody to mark.');

    db().run(`UPDATE study_sessions SET status = 'In Progress', started_at = ?, started_by = ?, updated_at = ? WHERE id = ?`, now, user.id, now, id);

    // Everyone starts Pending Reconciliation; a scan promotes them, reconciliation settles the rest.
    for (const st of roster) {
      db().run(
        `INSERT INTO study_attendance (session_id, student_id, status, source, remarks, marked_by, marked_at)
         VALUES (?, ?, 'Pending Reconciliation', 'Reconciliation', NULL, ?, ?)
         ON CONFLICT(session_id, student_id) DO NOTHING`,
        id,
        st.id,
        user.id,
        now,
      );
    }

    const nonce = randomToken(18);
    const token = deriveToken(id, 'Start', nonce);
    const expiresAt = new Date(Date.now() + startValidityMs()).toISOString();
    db().run(
      `INSERT INTO study_session_qr (id, session_id, phase, nonce, token_hash, issued_by, issued_at, expires_at) VALUES (?, ?, 'Start', ?, ?, ?, ?, ?)`,
      uid('qr'),
      id,
      nonce,
      sha256(token),
      user.id,
      now,
      expiresAt,
    );

    recordEvent('study_session', id, user.id, 'started', { from: s.status, to: 'In Progress', note: `Start QR valid until ${fmtDateTime(expiresAt)}` });
    notify(
      roster.map((r) => r.user_id),
      {
        eventType: 'study.started',
        title: `Study session started: ${s.title}`,
        message: `Open this notification to scan the QR your Adviser is showing. It must be scanned before ${fmtDateTime(expiresAt)}, after which you are marked absent.`,
        entityType: 'study_session',
        entityId: id,
        link: '/student/notifications',
        severity: 'warning',
        dedupeKey: `study.started:${id}`,
      },
    );
    notify([user.id], {
      eventType: 'study.started.adviser',
      title: `Session started: ${s.title}`,
      message: `Open this notification to show the attendance QR to the room. It is valid until ${fmtDateTime(expiresAt)}, and the session closes by itself then.`,
      entityType: 'study_session',
      entityId: id,
      link: '/adviser/study-sessions',
      dedupeKey: `study.started.adviser:${id}`,
    });
    return { session: mapSession(getSession(id)), token, expiresAt };
  });
}

// ---------------------------------------------------------------------------
// End + reconciliation
// ---------------------------------------------------------------------------
/**
 * Settles the start-attendance for a session: anybody still Pending Reconciliation
 * is marked Absent. Idempotent, and safe to call from the scheduled job.
 */
export function reconcileSession(id: string, actorId: string | null): number {
  const s = getSession(id);
  if (s.status === 'Cancelled') return 0;
  const now = nowIso();
  const pending = db().all<any>(`SELECT student_id FROM study_attendance WHERE session_id = ? AND status = 'Pending Reconciliation'`, id);
  for (const p of pending) {
    db().run(
      `UPDATE study_attendance SET status = 'Absent', source = 'Reconciliation', marked_by = ?, marked_at = ?,
        remarks = COALESCE(remarks, 'No valid start-session scan inside the attendance window.') WHERE session_id = ? AND student_id = ?`,
      actorId,
      now,
      id,
      p.student_id,
    );
  }
  if (!s.reconciled_at) db().run('UPDATE study_sessions SET reconciled_at = ?, updated_at = ? WHERE id = ?', now, now, id);
  if (pending.length) {
    recordEvent('study_session', id, actorId, 'attendance_reconciled', { note: `${pending.length} student(s) marked Absent — no valid start scan.` });
    const absentees = db().all<any>(
      `SELECT s.user_id FROM study_attendance sa JOIN students s ON s.id = sa.student_id WHERE sa.session_id = ? AND sa.status = 'Absent'`,
      id,
    );
    notify(
      absentees.map((a) => a.user_id),
      {
        eventType: 'study.absent',
        title: `Marked absent: ${s.title}`,
        message: 'No valid start-session scan was recorded inside the attendance window.',
        entityType: 'study_session',
        entityId: id,
        link: '/student/notifications',
        severity: 'alert',
        dedupeKey: `study.absent:${id}`,
      },
    );
  }
  return pending.length;
}

export function endSession(user: AuthUser, id: string): { session: any; token: string; expiresAt: string; reconciled: number } {
  const s = getSession(id);
  if (!canConduct(s, user)) throw forbidden('This session is assigned to another Adviser.');
  return endSessionCore(id, user.id);
}

/**
 * Ends a session and issues the end-of-session QR. The actor is an Adviser, or null
 * when the scheduled job closes a session nobody ended by hand; the rules are the
 * same either way, so the job can never settle attendance more leniently.
 */
export function endSessionCore(id: string, actorId: string | null): { session: any; token: string; expiresAt: string; reconciled: number } {
  return db().transaction(() => {
    const s = getSession(id);
    if (s.status !== 'In Progress') throw conflict(`Only a session that is in progress can be ended (this one is "${s.status}").`);
    const now = nowIso();

    // The start QR dies with the session; no later scan can resurrect it.
    db().run(`UPDATE study_session_qr SET invalidated_at = COALESCE(invalidated_at, ?) WHERE session_id = ? AND phase = 'Start'`, now, id);
    db().run(`UPDATE study_sessions SET status = 'Completed', ended_at = ?, ended_by = ?, updated_at = ? WHERE id = ?`, now, actorId, now, id);
    const reconciled = reconcileSession(id, actorId);

    // A second, different QR for the end-of-session check, with its own window.
    const nonce = randomToken(18);
    const token = deriveToken(id, 'End', nonce);
    const expiresAt = new Date(Date.now() + endValidityMs()).toISOString();
    db().run(
      `INSERT INTO study_session_qr (id, session_id, phase, nonce, token_hash, issued_by, issued_at, expires_at) VALUES (?, ?, 'End', ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, phase) DO UPDATE SET nonce = excluded.nonce, token_hash = excluded.token_hash, issued_by = excluded.issued_by,
         issued_at = excluded.issued_at, expires_at = excluded.expires_at, invalidated_at = NULL`,
      uid('qr'),
      id,
      nonce,
      sha256(token),
      // The QR has to be stamped with an account; when the timetable closes the
      // session that is the Adviser it belongs to, while `ended_by` stays empty so
      // the history still shows nobody ended it by hand.
      actorId ?? s.adviser_user_id,
      now,
      expiresAt,
    );

    recordEvent('study_session', id, actorId, 'ended', { from: 'In Progress', to: 'Completed', note: `End QR valid until ${fmtDateTime(expiresAt)}` });
    const roster = sessionRoster(s);
    notify(
      roster.map((r) => r.user_id),
      {
        eventType: 'study.ended',
        title: `Session ended: ${s.title}`,
        message: `Open this notification to show your end-of-session QR before ${fmtDateTime(expiresAt)}. It records the end check only and does not change your start attendance.`,
        entityType: 'study_session',
        entityId: id,
        link: '/student/notifications',
        dedupeKey: `study.ended:${id}`,
      },
    );
    return { session: mapSession(getSession(id)), token, expiresAt, reconciled };
  });
}

// ---------------------------------------------------------------------------
// The attendance log
// ---------------------------------------------------------------------------
/**
 * Every study-session attendance record the reader is entitled to, one row per
 * student per session.
 *
 * The Dean sees all of them. A Hosteller Adviser sees the sessions they conduct —
 * their own, plus the department-wide ones the timetable opens for their department
 * — which is the same set of students those sessions mark, not only their advisees.
 */
export function studyAttendanceLog(
  user: AuthUser,
  opts: { from: string; to: string; status?: string; department?: string },
): { rows: any[]; totals: { marked: number; present: number; absent: number; sessions: number; participationPct: number | null } } {
  const where = [`ss.status != 'Cancelled'`, 'ss.session_date BETWEEN ? AND ?'];
  const params: unknown[] = [opts.from, opts.to];

  if (user.role === 'Adviser') {
    where.push('(ss.adviser_user_id = ? OR (ss.department_wide = 1 AND ss.department_code = ?))');
    params.push(user.id, user.departmentCode);
  } else if (user.role === 'HOD') {
    where.push('s.department_code = ?');
    params.push(user.departmentCode);
  }
  if (opts.department) {
    where.push('s.department_code = ?');
    params.push(opts.department);
  }
  if (opts.status) {
    where.push('sa.status = ?');
    params.push(opts.status);
  }

  const rows = db().all<any>(
    `SELECT sa.status, sa.source, sa.remarks, sa.start_scan_at, sa.end_scan_at, sa.marked_at,
       ss.id AS session_id, ss.title, ss.session_date, ss.start_time, ss.end_time, ss.location, ss.department_code AS session_department,
       s.id AS student_id, s.name, s.reg_number, s.department_code, s.year, r.room_number, r.block,
       a.name AS adviser_name
     FROM study_attendance sa
     JOIN study_sessions ss ON ss.id = sa.session_id
     JOIN students s ON s.id = sa.student_id
     LEFT JOIN rooms r ON r.id = s.room_id
     LEFT JOIN users a ON a.id = ss.adviser_user_id
     WHERE ${where.join(' AND ')}
     ORDER BY ss.session_date DESC, ss.start_time DESC, s.name`,
    ...params,
  );

  const mapped = rows.map((r) => ({
    sessionId: r.session_id,
    sessionTitle: r.title,
    date: r.session_date,
    dateDisplay: fmtDate(r.session_date),
    startTime: r.start_time,
    endTime: r.end_time,
    location: r.location,
    adviserName: r.adviser_name ?? '—',
    studentId: r.student_id,
    name: r.name,
    regNumber: r.reg_number,
    department: r.department_code,
    year: yearLabel(r.year),
    roomNumber: r.room_number || 'Unallocated',
    block: r.block ?? '—',
    status: r.status,
    source: r.source,
    scannedAt: r.start_scan_at,
    scannedAtDisplay: r.start_scan_at ? fmtDateTime(r.start_scan_at) : null,
    endScanDisplay: r.end_scan_at ? fmtDateTime(r.end_scan_at) : null,
    remarks: r.remarks ?? '',
  }));

  const present = mapped.filter((r) => r.status === 'Present' || r.status === 'Late').length;
  const excused = mapped.filter((r) => r.status === 'Excused').length;
  const denom = mapped.length - excused;
  return {
    rows: mapped,
    totals: {
      marked: mapped.length,
      present,
      absent: mapped.filter((r) => r.status === 'Absent').length,
      sessions: new Set(mapped.map((r) => r.sessionId)).size,
      participationPct: denom > 0 ? Math.round((present / denom) * 1000) / 10 : null,
    },
  };
}

// ---------------------------------------------------------------------------
// The timetable: sessions that open and close by themselves
//
// The office sets one timetable in the institutional rules. From then on the job
// opens one session per department at that time and closes it at the end time —
// students get the QR in their notifications, the department's Advisers get the
// scanner, and nobody has to press anything. Everything else (roster, QR windows,
// reconciliation) is the ordinary path, so an automatic session behaves exactly
// like one an Adviser started.
// ---------------------------------------------------------------------------
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The timetable as the rules currently read it.
 *
 * There is one time to set: when the session opens. It runs for exactly as long as
 * the attendance QR is valid (`study.qr_start_minutes`, ten minutes by default) and
 * closes itself when that expires, so there is no second time to keep in step.
 */
export function autoSchedule(): { enabled: boolean; startTime: string; endTime: string; minutes: number; graceMinutes: number; days: string[] } {
  const raw = getSetting('study.auto_days').trim();
  const days = !raw || /^daily$/i.test(raw) ? [...DAY_NAMES] : raw.split(/[,\s]+/).filter(Boolean).map((d) => d.slice(0, 3).toLowerCase());
  const startTime = getSetting('study.auto_start_time') || '19:00';
  const minutes = getNumberSetting('study.qr_start_minutes') || 10;
  const grace = getNumberSetting('study.auto_grace_minutes');
  return {
    enabled: getSetting('study.auto_enabled') === 'true',
    startTime,
    endTime: addMinutes(startTime, minutes),
    minutes,
    graceMinutes: Number.isFinite(grace) && grace > 0 ? grace : 0,
    days: days.map((d) => (d.length === 3 ? d[0].toUpperCase() + d.slice(1).toLowerCase() : d)),
  };
}

/** Whether the timetable covers this instant's day. */
function runsToday(schedule: { days: string[] }, at: Date): boolean {
  const name = DAY_NAMES[new Date(zonedIso(localDate(at), '12:00:00')).getUTCDay()];
  return schedule.days.includes(name);
}

/** The departments with both a Hosteller Adviser and hosteller students to teach. */
function departmentsWithHostellers(): string[] {
  return db()
    .all<{ code: string }>(
      `SELECT DISTINCT d.code FROM departments d
       JOIN users u ON u.department_code = d.code AND u.role = 'Adviser' AND u.is_active = 1 AND u.student_category = 'Hosteller'
       JOIN students s ON s.department_code = d.code AND s.enrollment_status = 'Active' AND s.is_hosteller = 1
       ORDER BY d.code`,
    )
    .map((r) => r.code);
}

/** An Adviser record shaped like a signed-in user, for the paths that need one. */
function asActor(userId: string): AuthUser {
  const u = db().get<any>('SELECT id, email, name, role, department_code FROM users WHERE id = ?', userId);
  if (!u) throw notFound('Adviser');
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    departmentCode: u.department_code,
    phone: null,
    designation: null,
    employeeId: null,
    office: null,
    profile: {},
    mustChangePassword: false,
    isDemo: false,
    studentId: null,
  };
}

/**
 * Opens the session of the configured time slot for every department that has not
 * had that slot yet.
 *
 * Idempotent per slot: the unique index on (date, department, slot) for automatic
 * sessions means a second run of the job inside the same window finds the session
 * already there and does nothing, so no student is notified twice. Keying on the
 * slot rather than the day is what lets the office change the study time and have
 * the new time open its own session the same day.
 *
 * A session may also open a little after its slot (`study.auto_grace_minutes`), so
 * a server that was not running at the exact minute still gives the students their
 * window instead of losing the day. When it opens late the session records the time
 * it actually opened, so the times on screen match the QR the students are scanning.
 */
export function autoStartScheduledSessions(now = new Date()): number {
  const schedule = autoSchedule();
  if (!schedule.enabled || !runsToday(schedule, now)) return 0;
  const date = localDate(now);
  const nowTime = localTime(now);
  // Not yet, or so far past the end that opening it would serve nobody.
  if (nowTime < schedule.startTime) return 0;
  // The whole session is the QR's few minutes. Past that, only the grace the office
  // allowed is left; after it a job tick simply does nothing.
  if (nowTime > addMinutes(schedule.endTime, schedule.graceMinutes)) return 0;
  const openedLate = nowTime > schedule.startTime;
  const startTime = openedLate ? nowTime : schedule.startTime;
  const endTime = openedLate ? addMinutes(nowTime, schedule.minutes) : schedule.endTime;

  let started = 0;
  for (const department of departmentsWithHostellers()) {
    const existing = db().get<{ id: string }>(
      `SELECT id FROM study_sessions WHERE session_date = ? AND department_code = ? AND auto_started = 1 AND schedule_slot = ?`,
      date,
      department,
      schedule.startTime,
    );
    if (existing) continue;
    const adviser = departmentAdvisers(department)[0];
    if (!adviser) continue;
    try {
      const id = db().transaction(() => {
        const newId = nextCode('STS');
        const createdAt = nowIso();
        db().run(
          `INSERT INTO study_sessions (id, title, session_date, start_time, end_time, schedule_slot, location, department_code, department_wide, auto_started, adviser_user_id, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'Scheduled', ?, ?, ?)`,
          newId,
          `Study session · ${fmtDate(date)}`,
          date,
          startTime,
          endTime,
          schedule.startTime,
          getSetting('study.default_location') || 'Hostel study hall',
          department,
          adviser.id,
          // The session is recorded against the Adviser who conducts it; the event
          // below is what says the timetable, not that Adviser, opened it.
          adviser.id,
          createdAt,
          createdAt,
        );
        recordEvent('study_session', newId, null, 'scheduled', {
          to: 'Scheduled',
          note: openedLate
            ? `Opened by the timetable for ${department}: the ${schedule.startTime} session, opened at ${startTime} inside the ${schedule.graceMinutes}-minute grace`
            : `Opened by the timetable for ${department}, ${startTime}–${endTime}`,
        });
        return newId;
      });
      startSession(asActor(adviser.id), id);
      // Every Hosteller Adviser of the department can run it, so every one of them
      // gets the scanner — not only the account the session is recorded against.
      const others = departmentAdvisers(department).filter((a) => a.id !== adviser.id);
      notify(
        others.map((a) => a.id),
        {
          eventType: 'study.started.adviser',
          title: `Session started: ${department} study session`,
          message: 'Open this notification to show the attendance QR to the room. The session was opened by the study timetable and closes by itself when the QR expires.',
          entityType: 'study_session',
          entityId: id,
          link: '/adviser/study-sessions',
          dedupeKey: `study.started.adviser:${id}`,
        },
      );
      started++;
    } catch (err) {
      // One department failing (no eligible students, a clash) must not stop the rest.
      console.error(`[jobs] could not open the ${department} study session`, err);
    }
  }
  return started;
}

/**
 * Closes an automatic session the moment its attendance QR expires.
 *
 * That is the ten minutes the office allowed, so nothing is left running after the
 * window the students were given, and absences are settled there and then.
 */
export function autoEndScheduledSessions(now = new Date()): number {
  const iso = now.toISOString();
  let ended = 0;
  for (const r of db().all<{ id: string }>(
    `SELECT ss.id FROM study_sessions ss
     JOIN study_session_qr q ON q.session_id = ss.id AND q.phase = 'Start'
     WHERE ss.auto_started = 1 AND ss.status = 'In Progress' AND q.expires_at <= ?`,
    iso,
  )) {
    try {
      endSessionCore(r.id, null);
      ended++;
    } catch (err) {
      console.error(`[jobs] could not close study session ${r.id}`, err);
    }
  }
  return ended;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------
/**
 * Logs a refused scan and throws.
 *
 * The row is written outside any transaction on purpose: the throw that follows
 * would otherwise roll the refusal back, and a rejected scan has to survive so the
 * Adviser can see who tried and why.
 */
function rejectScan(sessionId: string | null, qrId: string | null, phase: QrPhase | null, studentId: string, reason: string): never {
  if (sessionId) {
    db().run(
      `INSERT INTO study_scans (id, session_id, qr_id, phase, student_id, result, reason, scanned_at) VALUES (?, ?, ?, ?, ?, 'Rejected', ?, ?)`,
      uid('scn'),
      sessionId,
      qrId,
      phase ?? 'Start',
      studentId,
      reason,
      nowIso(),
    );
  }
  throw conflict(reason);
}

/**
 * Everything that can refuse a scan, checked before any transaction opens so the
 * rejection record is kept. Shared by the student's own scan and the Adviser scanner.
 */
function validateScan(s: any, qr: any, phase: QrPhase, studentId: string) {
  if (!sessionRoster(s).some((r) => r.id === studentId)) rejectScan(s.id, qr.id, phase, studentId, 'You are not on the roster for this study session.');
  if (qr.invalidated_at) rejectScan(s.id, qr.id, phase, studentId, `This ${phase.toLowerCase()}-session QR code is no longer valid.`);
  if (!qrIsLive(qr)) rejectScan(s.id, qr.id, phase, studentId, `This ${phase.toLowerCase()}-session QR code expired at ${fmtDateTime(qr.expires_at)}.`);
  if (phase === 'Start' && s.status !== 'In Progress') rejectScan(s.id, qr.id, phase, studentId, `Attendance scanning is closed for this session (it is "${s.status}").`);
  const existing = db().get<any>(`SELECT id FROM study_scans WHERE session_id = ? AND phase = ? AND student_id = ? AND result = 'Accepted'`, s.id, phase, studentId);
  if (existing) rejectScan(s.id, qr.id, phase, studentId, `${phase}-session attendance was already recorded for this student.`);
}

/** Validates a scanned token for one student and records the outcome either way. */
export function scanSessionQr(user: AuthUser, studentId: string, rawToken: string) {
  const qr = db().get<any>('SELECT * FROM study_session_qr WHERE token_hash = ?', sha256(rawToken.trim()));
  if (!qr) throw badRequest('This QR code is not recognised. Scan the code shown by your Adviser.');
  const s = getSession(qr.session_id);
  const phase = qr.phase as QrPhase;
  validateScan(s, qr, phase, studentId);
  return db().transaction(() => applyScan(user, s, qr, phase, studentId));
}

/**
 * Records one accepted scan. Shared by the student's own scan and the Adviser's
 * scanner so neither route can be the lenient one.
 */
export function applyScan(user: AuthUser, s: any, qr: any, phase: QrPhase, studentId: string) {
  const now = nowIso();
  {
    db().run(
      `INSERT INTO study_scans (id, session_id, qr_id, phase, student_id, result, scanned_at) VALUES (?, ?, ?, ?, ?, 'Accepted', ?)`,
      uid('scn'),
      s.id,
      qr.id,
      phase,
      studentId,
      now,
    );

    if (phase === 'Start') {
      db().run(
        `UPDATE study_attendance SET status = 'Present', source = 'QR Scan', start_scan_at = ?, marked_by = ?, marked_at = ?, remarks = NULL
         WHERE session_id = ? AND student_id = ?`,
        now,
        user.id,
        now,
        s.id,
        studentId,
      );
    } else {
      // End scans are recorded alongside the start attendance and never overwrite it:
      // a student who missed the start scan stays Absent.
      db().run(`UPDATE study_attendance SET end_scan_at = ?, marked_at = ? WHERE session_id = ? AND student_id = ?`, now, now, s.id, studentId);
    }
    recordEvent('study_session', s.id, user.id, phase === 'Start' ? 'start_scan' : 'end_scan', { note: `${user.name} recorded the ${phase.toLowerCase()} scan` });

    const row = db().get<any>('SELECT status, start_scan_at, end_scan_at FROM study_attendance WHERE session_id = ? AND student_id = ?', s.id, studentId);
    return {
      sessionId: s.id,
      sessionTitle: s.title,
      phase,
      scannedAt: now,
      scannedAtDisplay: fmtDateTime(now),
      attendanceStatus: row?.status ?? 'Pending Reconciliation',
      startScanAt: row?.start_scan_at ?? null,
      endScanAt: row?.end_scan_at ?? null,
      message:
        phase === 'Start'
          ? 'Attendance recorded. You are marked Present for this session.'
          : row?.status === 'Present'
            ? 'End-of-session check recorded.'
            : 'End-of-session check recorded. Your start-session attendance is unchanged.',
    };
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
export function mapSession(s: any, forUser?: AuthUser) {
  const counts = db().get<any>(
    `SELECT COUNT(*) AS marked, SUM(status = 'Present') AS present, SUM(status = 'Late') AS late, SUM(status = 'Absent') AS absent,
       SUM(status = 'Excused') AS excused, SUM(status = 'Pending Reconciliation') AS pending, SUM(end_scan_at IS NOT NULL) AS end_scans
     FROM study_attendance WHERE session_id = ?`,
    s.id,
  );
  const expected = sessionRoster(s).length;
  const attended = (counts.present || 0) + (counts.late || 0);
  const startQr = activeQr(s.id, 'Start');
  const endQr = activeQr(s.id, 'End');
  const window = startWindow(s);
  const startable = forUser ? canStart(s, forUser) : { ok: false as boolean, reason: undefined as string | undefined };
  return {
    id: s.id,
    title: s.title,
    date: s.session_date,
    dateDisplay: s.session_date,
    startTime: s.start_time,
    endTime: s.end_time,
    location: s.location,
    block: s.block,
    department: s.department_code,
    departmentWide: !!s.department_wide,
    section: s.section ?? null,
    year: s.year,
    /** 'Named students' when the Adviser listed them, otherwise the filters. */
    rosterSource: s.department_wide
      ? `All ${s.department_code ?? ''} hostellers`.trim()
      : db().get(`SELECT 1 FROM study_session_students WHERE session_id = ?`, s.id)
        ? 'Named students'
        : 'Department / section filters',
    status: s.status,
    notes: s.notes,
    adviserId: s.adviser_user_id,
    adviserName: s.adviser_name ?? null,
    adviserCategory: s.adviser_category ?? null,
    startedAt: s.started_at,
    startedAtDisplay: s.started_at ? fmtDateTime(s.started_at) : null,
    startedBy: s.started_by_name ?? null,
    endedAt: s.ended_at,
    endedAtDisplay: s.ended_at ? fmtDateTime(s.ended_at) : null,
    endedBy: s.ended_by_name ?? null,
    reconciledAt: s.reconciled_at,
    reconciledAtDisplay: s.reconciled_at ? fmtDateTime(s.reconciled_at) : null,
    // Live QR state — the tokens themselves are never included here.
    startQr: startQr ? { issuedAt: startQr.issued_at, expiresAt: startQr.expires_at, live: qrIsLive(startQr), invalidatedAt: startQr.invalidated_at } : null,
    endQr: endQr ? { issuedAt: endQr.issued_at, expiresAt: endQr.expires_at, live: qrIsLive(endQr), invalidatedAt: endQr.invalidated_at } : null,
    startWindowOpensAt: window.opensAt,
    startWindowClosesAt: window.closesAt,
    canStart: startable.ok,
    cannotStartReason: startable.ok ? null : startable.reason ?? null,
    expected,
    marked: counts.marked || 0,
    present: counts.present || 0,
    late: counts.late || 0,
    absent: counts.absent || 0,
    excused: counts.excused || 0,
    pendingReconciliation: counts.pending || 0,
    endScans: counts.end_scans || 0,
    participationPct: expected - (counts.excused || 0) > 0 ? Math.round((attended / (expected - (counts.excused || 0))) * 1000) / 10 : null,
  };
}

export function sessionRosterView(id: string, forUser?: AuthUser) {
  const s = getSession(id);
  const marks = new Map(db().all<any>('SELECT * FROM study_attendance WHERE session_id = ?', id).map((m) => [m.student_id, m]));
  return {
    // forUser matters: without it `canStart` is false for everyone, which would
    // leave the Adviser looking at a dead Start button and no reason why.
    session: mapSession(s, forUser),
    roster: sessionRoster(s).map((st) => {
      const m = marks.get(st.id);
      return {
        studentId: st.id,
        name: st.name,
        regNumber: st.reg_number,
        department: st.department_code,
        year: yearLabel(st.year),
        roomNumber: st.room_number || 'Unallocated',
        status: m?.status ?? 'Not Marked',
        source: m?.source ?? null,
        startScanAt: m?.start_scan_at ?? null,
        startScanDisplay: m?.start_scan_at ? fmtDateTime(m.start_scan_at) : null,
        endScanAt: m?.end_scan_at ?? null,
        endScanDisplay: m?.end_scan_at ? fmtDateTime(m.end_scan_at) : null,
        remarks: m?.remarks ?? '',
      };
    }),
    scans: db()
      .all<any>(
        `SELECT sc.*, s.name, s.reg_number FROM study_scans sc JOIN students s ON s.id = sc.student_id WHERE sc.session_id = ? ORDER BY sc.scanned_at DESC LIMIT 200`,
        id,
      )
      .map((sc) => ({
        id: sc.id,
        phase: sc.phase,
        studentName: sc.name,
        regNumber: sc.reg_number,
        result: sc.result,
        reason: sc.reason,
        scannedAt: sc.scanned_at,
        scannedAtDisplay: fmtDateTime(sc.scanned_at),
      })),
  };
}

/**
 * Scheduled upkeep: close the attendance window of any session whose start QR has
 * expired, so absences are settled without anyone opening a dashboard.
 */
export function reconcileExpiredSessions(now = new Date()): number {
  const rows = db().all<any>(
    `SELECT ss.id FROM study_sessions ss JOIN study_session_qr qr ON qr.session_id = ss.id AND qr.phase = 'Start'
     WHERE ss.status IN ('In Progress','Completed') AND ss.reconciled_at IS NULL AND qr.expires_at < ?`,
    now.toISOString(),
  );
  let total = 0;
  for (const r of rows) {
    db().transaction(() => {
      db().run(`UPDATE study_session_qr SET invalidated_at = COALESCE(invalidated_at, ?) WHERE session_id = ? AND phase = 'Start'`, now.toISOString(), r.id);
      total += reconcileSession(r.id, null);
    });
  }
  return total;
}

/**
 * Sessions a student is on the roster for, with their own attendance and whether a
 * QR is currently live for them to scan. Students only ever see their own row.
 */
export function studentSessions(studentId: string, from: string, to: string) {
  const rows = db().all<any>(
    `SELECT ss.id FROM study_sessions ss WHERE ss.session_date BETWEEN ? AND ? AND ss.status != 'Cancelled' ORDER BY ss.session_date DESC, ss.start_time DESC`,
    from,
    to,
  );
  const out: any[] = [];
  for (const r of rows) {
    const s = getSession(r.id);
    if (!sessionRoster(s).some((x) => x.id === studentId)) continue;
    const mark = db().get<any>('SELECT * FROM study_attendance WHERE session_id = ? AND student_id = ?', s.id, studentId);
    const startQr = activeQr(s.id, 'Start');
    const endQr = activeQr(s.id, 'End');
    out.push({
      id: s.id,
      title: s.title,
      date: s.session_date,
      startTime: s.start_time,
      endTime: s.end_time,
      location: s.location,
      status: s.status,
      adviserName: s.adviser_name ?? null,
      myStatus: mark?.status ?? 'Not Marked',
      startScanAt: mark?.start_scan_at ?? null,
      startScanDisplay: mark?.start_scan_at ? fmtDateTime(mark.start_scan_at) : null,
      endScanAt: mark?.end_scan_at ?? null,
      endScanDisplay: mark?.end_scan_at ? fmtDateTime(mark.end_scan_at) : null,
      startQrLive: qrIsLive(startQr),
      startQrExpiresAt: startQr?.expires_at ?? null,
      endQrLive: qrIsLive(endQr),
      endQrExpiresAt: endQr?.expires_at ?? null,
    });
  }
  return out;
}

/** The QR a student is allowed to see: they must be on the roster and it must be live. */
export function studentQr(studentId: string, sessionId: string, phase: QrPhase) {
  const s = getSession(sessionId);
  if (!sessionRoster(s).some((x) => x.id === studentId)) throw forbidden('You are not on the roster for this study session.');
  const live = tokenFor(sessionId, phase);
  if (!live) {
    const qr = activeQr(sessionId, phase);
    throw conflict(qr ? `This ${phase.toLowerCase()}-session QR code expired at ${fmtDateTime(qr.expires_at)}.` : `No ${phase.toLowerCase()}-session QR code has been issued yet.`);
  }
  return { sessionId, sessionTitle: s.title, phase, token: live.token, expiresAt: live.expiresAt, expiresAtDisplay: fmtDateTime(live.expiresAt) };
}

/**
 * The code a student shows so the Adviser can scan them in, for the phase that is
 * currently live. Only a student on the roster can obtain one.
 */
export function myAttendanceCode(studentId: string, sessionId: string) {
  const s = getSession(sessionId);
  if (!sessionRoster(s).some((x) => x.id === studentId)) throw forbidden('You are not on the roster for this study session.');
  for (const phase of ['Start', 'End'] as QrPhase[]) {
    const qr = activeQr(sessionId, phase);
    if (!qrIsLive(qr)) continue;
    return {
      sessionId,
      sessionTitle: s.title,
      phase,
      code: studentAttendanceCode(sessionId, phase, studentId, qr.nonce),
      expiresAt: qr.expires_at,
      expiresAtDisplay: fmtDateTime(qr.expires_at),
    };
  }
  throw conflict('No attendance window is open for this session right now.');
}

/**
 * Adviser-side scanner: reads a student's personal code and records their attendance.
 *
 * The code carries no identifiers, so the student is found by matching it against the
 * roster. Everything else — expiry, phase, one-scan-per-student, and the rule that an
 * end scan never rewrites a missing start scan — is the same path a student's own scan
 * takes, so neither route can be the lenient one.
 */
export function scanStudentCode(user: AuthUser, sessionId: string, rawCode: string) {
  const s = getSession(sessionId);
  if (!canConduct(s, user)) throw forbidden('This session is assigned to another Adviser.');
  const code = rawCode.trim();
  const roster = sessionRoster(s);

  for (const phase of ['Start', 'End'] as QrPhase[]) {
    const qr = activeQr(sessionId, phase);
    if (!qr) continue;
    const match = roster.find((st) => studentAttendanceCode(sessionId, phase, st.id, qr.nonce) === code);
    if (!match) continue;
    validateScan(s, qr, phase, match.id);
    const result = db().transaction(() => applyScan(user, s, qr, phase, match.id));
    return { ...result, studentName: match.name, regNumber: match.reg_number };
  }
  throw badRequest('This code does not belong to any student on this session’s roster, or its window has closed.');
}
