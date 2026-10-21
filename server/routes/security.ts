import { Router, type Request } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { badRequest, created, notFound, ok, route } from '../lib/http';
import { audit, notify, recordEvent, usersWithRole } from '../lib/records';
import { fmtDate, fmtDateTime, fmtTime, localDate, nowIso, uid, dayStartIso as zonedDayStart } from '../lib/util';
import { Validator } from '../lib/validate';
import { mapOutpass, OUTPASS_SELECT } from '../services/requests';
import { autoPresentOnReturn } from '../services/attendance';

const router = Router();
router.use(requireRole('Security', 'Warden'));

const GATES = ['Main Gate', 'North Gate', 'Hostel Gate', 'East Gate'] as const;
const DUPLICATE_WINDOW_MS = 2 * 60_000;

const dayStartIso = (date = localDate()) => zonedDayStart(date);

function mapMovement(m: any, index = 0) {
  const isEntry = m.movement_type === 'Entry';
  return {
    id: m.id,
    sNo: index + 1,
    name: m.name,
    regNumber: m.reg_number,
    destination: m.destination || (isEntry ? 'Campus Premises' : '—'),
    roomNo: m.room_number || '—',
    inTime: isEntry ? fmtTime(m.occurred_at) : '—',
    outTime: isEntry ? '—' : fmtTime(m.occurred_at),
    inDate: isEntry ? fmtDate(m.occurred_at) : '—',
    outDate: isEntry ? '—' : fmtDate(m.occurred_at),
    gate: m.gate,
    type: m.movement_type,
    // Scan-record fields
    time: fmtTime(m.occurred_at),
    date: fmtDate(m.occurred_at),
    status: m.status,
    notes: m.notes || undefined,
    securityNotes: m.security_notes || undefined,
    rejectionReason: m.rejection_reason || undefined,
    deviceId: m.device_id || undefined,
    studentId: m.student_id || undefined,
    outpassId: m.outpass_id || undefined,
    outingId: m.outing_id || undefined,
    occurredAt: m.occurred_at,
    occurredAtDisplay: fmtDateTime(m.occurred_at),
    recordedBy: m.recorded_by_name || undefined,
  };
}

const MOVEMENT_SELECT = `g.*, u.name AS recorded_by_name FROM gate_movements g LEFT JOIN users u ON u.id = g.recorded_by`;

/** Security's own operational note on an existing gate event. Security may annotate
 *  the record but can never approve outings or rewrite an approval history. */
router.post(
  '/gate-events/:id/notes',
  requireRole('Security', 'Warden'),
  route((req, res) => {
    const v = new Validator(req.body);
    const note = v.string('note', { min: 2, max: 500, label: 'Note' });
    v.done();
    const g = db().get<any>('SELECT * FROM gate_movements WHERE id = ?', req.params.id);
    if (!g) throw notFound('Gate event');
    const stamped = `${fmtDateTime(nowIso())} — ${req.user!.name}: ${note}`;
    db().run(`UPDATE gate_movements SET security_notes = CASE WHEN security_notes IS NULL THEN ? ELSE security_notes || char(10) || ? END WHERE id = ?`, stamped, stamped, g.id);
    audit(req, 'security.gate_note', 'gate_movement', g.id);
    ok(res, mapMovement(db().get(`SELECT ${MOVEMENT_SELECT} WHERE g.id = ?`, g.id)), { message: 'Note recorded against the gate event.' });
  }),
);

router.get(
  '/metrics',
  route((_req, res) => {
    const start = dayStartIso();
    const yStart = dayStartIso(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
    const c = (sql: string, ...p: unknown[]) => db().get<{ c: number }>(sql, ...p)!.c;
    const todayEntries = c(`SELECT COUNT(*) AS c FROM gate_movements WHERE movement_type = 'Entry' AND status != 'Duplicate' AND occurred_at >= ?`, start);
    const todayExits = c(`SELECT COUNT(*) AS c FROM gate_movements WHERE movement_type = 'Exit' AND status != 'Duplicate' AND occurred_at >= ?`, start);
    const yEntries = c(`SELECT COUNT(*) AS c FROM gate_movements WHERE movement_type = 'Entry' AND status != 'Duplicate' AND occurred_at >= ? AND occurred_at < ?`, yStart, start);
    const yExits = c(`SELECT COUNT(*) AS c FROM gate_movements WHERE movement_type = 'Exit' AND status != 'Duplicate' AND occurred_at >= ? AND occurred_at < ?`, yStart, start);
    const residents = c(`SELECT COUNT(*) AS c FROM students WHERE enrollment_status = 'Active' AND is_hosteller = 1`);
    const out = c(`SELECT COUNT(*) AS c FROM outpasses WHERE status = 'Out'`);
    const overdue = c(`SELECT COUNT(*) AS c FROM outpasses WHERE status = 'Out' AND valid_until < ?`, nowIso());
    const flagged = c(`SELECT COUNT(*) AS c FROM gate_movements WHERE status IN ('Flagged','Duplicate') AND occurred_at >= ?`, start);
    const trend = (now: number, prev: number) => (prev === 0 ? (now === 0 ? '0%' : 'New') : `${now >= prev ? '+' : ''}${Math.round(((now - prev) / prev) * 100)}%`);
    ok(res, {
      todayEntries,
      entriesTrend: trend(todayEntries, yEntries),
      entriesComparison: `vs ${yEntries} yesterday`,
      todayExits,
      exitsTrend: trend(todayExits, yExits),
      exitsComparison: `vs ${yExits} yesterday`,
      currentlyInside: residents - out,
      insideCaption: `${out} resident(s) currently out on a pass`,
      needsAttention: flagged + overdue,
      attentionCaption: `${flagged} flagged scan(s) today · ${overdue} overdue return(s)`,
    });
  }),
);

router.get(
  '/scans',
  route((req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || 10), 10) || 10, 100);
    ok(res, db().all(`SELECT ${MOVEMENT_SELECT} ORDER BY g.occurred_at DESC LIMIT ?`, limit).map((m, i) => mapMovement(m, i)));
  }),
);

function filteredMovements(req: Request) {
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const search = String(req.query.search || '').trim().toLowerCase();
  if (search) {
    where.push('(lower(g.name) LIKE ? OR lower(g.reg_number) LIKE ? OR lower(g.destination) LIKE ? OR lower(g.room_number) LIKE ? OR lower(g.gate) LIKE ?)');
    params.push(...Array(5).fill(`%${search}%`));
  }
  const destination = String(req.query.destination || 'All');
  if (destination !== 'All') {
    where.push('g.destination = ?');
    params.push(destination);
  }
  const room = String(req.query.room || 'All');
  if (room !== 'All') {
    where.push('g.room_number = ?');
    params.push(room);
  }
  if (req.query.inTime === 'Has In Time') where.push(`g.movement_type = 'Entry'`);
  if (req.query.outTime === 'Has Out Time') where.push(`g.movement_type = 'Exit'`);
  if (req.query.from) {
    where.push('g.occurred_at >= ?');
    params.push(dayStartIso(String(req.query.from)));
  }
  return db().all(`SELECT ${MOVEMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY g.occurred_at DESC`, ...params);
}

router.get(
  '/movements',
  route((req, res) => {
    const rows = filteredMovements(req);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || 10), 10) || 10, 1), 500);
    const page = Math.max(parseInt(String(req.query.page || 1), 10) || 1, 1);
    const total = rows.length;
    ok(
      res,
      rows.slice((page - 1) * limit, page * limit).map((m, i) => mapMovement(m, (page - 1) * limit + i)),
      { pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } },
    );
  }),
);

router.get(
  '/movements/export',
  route((req, res) => {
    const rows = filteredMovements(req);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Date', 'Time', 'Type', 'Name', 'Register No', 'Room', 'Gate', 'Destination', 'Status', 'Outpass', 'Notes'].join(','),
      ...rows.map((m: any) =>
        [fmtDate(m.occurred_at), fmtTime(m.occurred_at), m.movement_type, m.name, m.reg_number, m.room_number, m.gate, m.destination, m.status, m.outpass_id, m.notes].map(esc).join(','),
      ),
    ];
    audit(req, 'security.movements_exported', 'gate_movement', undefined, { rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gate-movements-${localDate()}.csv"`);
    res.send(lines.join('\r\n'));
  }),
);

/** Raised when a scanned QR matches no outpass; the caller logs a Rejected event. */
class UnknownQr extends Error {
  constructor(public token: string) {
    super('This QR code does not match any issued outpass.');
  }
}

/** Resolve a student (and their relevant pass) from a QR token or register number, without recording anything. */
function resolveScan(token?: string, regNumber?: string) {
  let student: any;
  let pass: any;
  if (token) {
    pass = db().get<any>(`SELECT ${OUTPASS_SELECT} WHERE p.qr_token = ?`, token);
    // An unrecognised QR is recorded as a rejected scan, never as a movement.
    if (!pass) throw new UnknownQr(token);
    student = db().get<any>('SELECT s.*, r.room_number FROM students s LEFT JOIN rooms r ON r.id = s.room_id WHERE s.id = ?', pass.student_id);
  } else if (regNumber) {
    student = db().get<any>('SELECT s.*, r.room_number FROM students s LEFT JOIN rooms r ON r.id = s.room_id WHERE s.reg_number = ?', regNumber.trim());
    if (!student) throw notFound('Student with this register number');
    const now = nowIso();
    pass =
      db().get<any>(`SELECT ${OUTPASS_SELECT} WHERE p.student_id = ? AND p.status = 'Out' ORDER BY p.checked_out_at DESC LIMIT 1`, student.id) ||
      db().get<any>(`SELECT ${OUTPASS_SELECT} WHERE p.student_id = ? AND p.status = 'Active' AND p.valid_until >= ? ORDER BY p.valid_from LIMIT 1`, student.id, now);
  } else {
    throw badRequest('Scan a QR code or enter a register number.');
  }
  return { student, pass };
}

router.get(
  '/verify',
  route((req, res) => {
    let resolved;
    try {
      resolved = resolveScan(req.query.token ? String(req.query.token) : undefined, req.query.regNumber ? String(req.query.regNumber) : undefined);
    } catch (err) {
      if (err instanceof UnknownQr) throw notFound('Outpass for this QR code');
      throw err;
    }
    const { student, pass } = resolved;
    const now = nowIso();
    const suggestedType = pass?.status === 'Out' ? 'Entry' : 'Exit';
    const passOk = pass && (pass.status === 'Out' || (pass.status === 'Active' && pass.valid_from <= new Date(Date.now() + 2 * 3_600_000).toISOString() && pass.valid_until >= now));
    ok(res, {
      student: { id: student.id, name: student.name, regNumber: student.reg_number, roomNumber: student.room_number || '—', department: student.department_code, enrollmentStatus: student.enrollment_status },
      pass: pass ? mapOutpass(pass) : null,
      suggestedType,
      verdict: passOk ? 'valid' : pass ? 'not-yet-valid-or-expired' : 'no-pass',
    });
  }),
);

router.post(
  '/scan',
  route((req, res) => {
    const v = new Validator(req.body);
    const token = v.string('qrToken', { required: false, max: 100 });
    const regNumber = v.string('regNumber', { required: false, max: 40, label: 'Register number' });
    const type = v.oneOf('type', ['Entry', 'Exit'] as const, { label: 'Movement type' });
    const gate = v.oneOf('gate', GATES, { required: false, label: 'Gate' }) ?? 'Main Gate';
    const deviceId = v.string('deviceId', { required: false, max: 80, label: 'Scanning device' });
    const notes = v.string('notes', { required: false, max: 300 });
    v.check(!!token || !!regNumber, 'regNumber', 'Scan a QR code or enter a register number.');
    v.done();

    const result = db().transaction(() => {
      let resolved;
      try {
        resolved = resolveScan(token, regNumber);
      } catch (err) {
        if (!(err instanceof UnknownQr)) throw err;
        // Record the refusal as its own canonical event, with no movement implied.
        const rejectedId = uid('mov');
        const at = nowIso();
        db().run(
          `INSERT INTO gate_movements (id, student_id, name, reg_number, movement_type, gate, device_id, occurred_at, status, rejection_reason, notes, recorded_by, created_at)
           VALUES (?, NULL, 'Unrecognised QR code', 'UNKNOWN', ?, ?, ?, ?, 'Rejected', ?, ?, ?, ?)`,
          rejectedId,
          type,
          gate,
          deviceId ?? null,
          at,
          'The scanned QR code does not match any issued outpass.',
          notes ?? null,
          req.user!.id,
          at,
        );
        notify(usersWithRole('Warden'), {
          eventType: 'gate.rejected',
          title: `Gate alert: unrecognised QR code at ${gate}`,
          message: 'A scanned QR code did not match any issued outpass. No entry or exit was recorded.',
          entityType: 'gate_movement',
          entityId: rejectedId,
          link: '/warden/log-book',
          severity: 'alert',
          dedupeKey: `gate.rejected:${rejectedId}`,
        });
        return { id: rejectedId, status: 'Rejected' as const, studentName: 'Unrecognised QR code', flags: ['The scanned QR code does not match any issued outpass.'] };
      }
      const { student, pass } = resolved;
      const now = nowIso();
      const recent = db().get<any>(
        `SELECT id FROM gate_movements WHERE student_id = ? AND movement_type = ? AND occurred_at > ? ORDER BY occurred_at DESC LIMIT 1`,
        student.id,
        type,
        new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString(),
      );
      let status: 'Approved' | 'Flagged' | 'Duplicate' | 'Rejected' = 'Approved';
      const flags: string[] = [];
      let rejectionReason: string | null = null;
      let linkedPass: string | null = null;
      if (pass && pass.status === 'Cancelled') {
        // A cancelled pass is refused outright rather than logged as a movement.
        status = 'Rejected';
        rejectionReason = `Outpass ${pass.id} was cancelled and cannot be used at the gate.`;
        flags.push(rejectionReason);
      } else if (recent) {
        status = 'Duplicate';
        flags.push(`Repeat of ${recent.id} within 2 minutes; pass state unchanged.`);
      } else if (type === 'Exit') {
        const usable = pass && pass.status === 'Active' && pass.valid_until >= now && pass.valid_from <= new Date(Date.now() + 2 * 3_600_000).toISOString();
        if (usable) {
          db().run(`UPDATE outpasses SET status = 'Out', checked_out_at = ? WHERE id = ?`, now, pass.id);
          recordEvent('outpass', pass.id, req.user!.id, 'checked_out', { from: 'Active', to: 'Out', note: gate });
          linkedPass = pass.id;
        } else {
          status = 'Flagged';
          flags.push(pass ? `Outpass ${pass.id} is not valid at this time.` : 'Exit without an approved outpass.');
        }
      } else if (pass && pass.status === 'Out') {
        db().run(`UPDATE outpasses SET status = 'Completed', checked_in_at = ? WHERE id = ?`, now, pass.id);
        recordEvent('outpass', pass.id, req.user!.id, 'checked_in', { from: 'Out', to: 'Completed', note: gate });
        linkedPass = pass.id;
        if (pass.valid_until < now) {
          status = 'Flagged';
          flags.push(`Late return: pass valid until ${fmtDateTime(pass.valid_until)}.`);
        }
      }
      const id = uid('mov');
      // One canonical event. Both the Warden and the Security logbook read this row,
      // so their timestamps and details can never disagree.
      db().run(
        `INSERT INTO gate_movements (id, student_id, name, reg_number, movement_type, gate, device_id, destination, room_number, block, occurred_at, status, rejection_reason, notes, outpass_id, outing_id, recorded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        student.id,
        student.name,
        student.reg_number,
        type,
        gate,
        deviceId ?? null,
        type === 'Exit' ? pass?.title ?? null : 'Campus Premises',
        student.room_number ?? null,
        student.block ?? null,
        now,
        status,
        rejectionReason,
        [notes, ...flags].filter(Boolean).join(' ') || null,
        linkedPass,
        pass?.source_type === 'Outing' ? pass.source_id : null,
        req.user!.id,
        now,
      );
      // Returning through the gate restores the roll call: "On Outing" becomes Present.
      if (type === 'Entry' && status !== 'Duplicate' && status !== 'Rejected') autoPresentOnReturn(student.id, req.user!.id);
      if (status === 'Flagged' || status === 'Rejected') {
        notify(usersWithRole('Warden'), {
          eventType: 'gate.flagged',
          title: `Gate alert: ${student.name} (${student.reg_number})`,
          message: `${type} at ${gate} — ${flags.join(' ')}`,
          entityType: 'gate_movement',
          entityId: id,
          link: '/warden/log-book',
          severity: 'alert',
          dedupeKey: `gate.flagged:${id}`,
        });
      }
      if (linkedPass && status !== 'Duplicate') {
        notify([student.user_id], {
          eventType: type === 'Exit' ? 'gate.checked_out' : 'gate.checked_in',
          title: type === 'Exit' ? 'Checked out at gate' : 'Checked in at gate',
          message: `${gate}, ${fmtDateTime(now)} (outpass ${linkedPass}).`,
          entityType: 'outpass',
          entityId: linkedPass,
          link: '/student/my-outpass',
          severity: status === 'Flagged' ? 'warning' : 'info',
        });
      }
      return { id, status, studentName: student.name, flags };
    });
    audit(req, 'security.scan', 'gate_movement', result.id, { type, status: result.status });
    const movement = mapMovement(db().get(`SELECT ${MOVEMENT_SELECT} WHERE g.id = ?`, result.id));
    created(
      res,
      {
        scan: movement,
        movement,
        isDuplicate: result.status === 'Duplicate',
        flagged: result.status === 'Flagged',
        rejected: result.status === 'Rejected',
        flags: result.flags,
      },
      result.status === 'Rejected'
        ? `Scan rejected at ${gate}: ${result.flags.join(' ')}`
        : `${result.studentName}: ${type} recorded at ${gate}${result.status !== 'Approved' ? ` (${result.status})` : ''}.`,
    );
  }),
);

router.get(
  '/students',
  route((req, res) => {
    const q = String(req.query.search || '').trim().toLowerCase();
    if (q.length < 2) return ok(res, []);
    ok(
      res,
      db()
        .all<any>(
          `SELECT s.id, s.name, s.reg_number, r.room_number FROM students s LEFT JOIN rooms r ON r.id = s.room_id
           WHERE s.enrollment_status = 'Active' AND (lower(s.name) LIKE ? OR lower(s.reg_number) LIKE ?) ORDER BY s.name LIMIT 15`,
          `%${q}%`,
          `%${q}%`,
        )
        .map((s) => ({ id: s.id, name: s.name, regNumber: s.reg_number, roomNumber: s.room_number || '—' })),
    );
  }),
);

/** Security-desk view of passes that are due out or currently out. */
router.get(
  '/active-passes',
  route((_req, res) => {
    const now = nowIso();
    ok(
      res,
      db()
        .all(`SELECT ${OUTPASS_SELECT} WHERE p.status = 'Out' OR (p.status = 'Active' AND p.valid_until >= ?) ORDER BY p.status DESC, p.valid_from`, now)
        .map(mapOutpass),
    );
  }),
);

export default router;
