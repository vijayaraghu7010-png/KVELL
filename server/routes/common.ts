import { Router } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { badRequest, forbidden, notFound, ok, route } from '../lib/http';
import { allSettings, audit, SETTING_DEFAULTS, settingValueError } from '../lib/records';
import { inList, nowIso, uid } from '../lib/util';
import { Validator } from '../lib/validate';
import { canAccessStudent } from '../lib/scope';
import type { AuthUser } from '../lib/auth';
import { authorityModel } from '../lib/authority';

const router = Router();

// ---------------------------------------------------------------------------
// Notifications (strictly per user)
// ---------------------------------------------------------------------------
const mapNotification = (n: any) => ({
  id: n.id,
  eventType: n.event_type,
  title: n.title,
  message: n.message,
  entityType: n.entity_type,
  entityId: n.entity_id,
  link: n.link,
  severity: n.severity,
  read: !!n.read_at,
  readAt: n.read_at,
  createdAt: n.created_at,
});

router.get(
  '/notifications',
  route((req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || 100), 10) || 100, 500);
    const unreadOnly = req.query.unread === '1';
    const rows = db().all(
      `SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT ?`,
      req.user!.id,
      limit,
    );
    const unread = db().get<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user!.id)!.c;
    ok(res, rows.map(mapNotification), { unreadCount: unread });
  }),
);

router.post(
  '/notifications/:id/read',
  route((req, res) => {
    const result = db().run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?', nowIso(), req.params.id, req.user!.id);
    if (!result.changes) throw notFound('Notification');
    ok(res, null);
  }),
);

/** Dismiss: the owner removes one notification from their own feed for good. */
router.delete(
  '/notifications/:id',
  route((req, res) => {
    const result = db().run('DELETE FROM notifications WHERE id = ? AND user_id = ?', req.params.id, req.user!.id);
    if (!result.changes) throw notFound('Notification');
    ok(res, null, { message: 'Notification dismissed.' });
  }),
);

router.post(
  '/notifications/read-all',
  route((req, res) => {
    const result = db().run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), req.user!.id);
    ok(res, { updated: result.changes }, { message: 'All notifications marked as read.' });
  }),
);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
router.get(
  '/meta/departments',
  route((_req, res) => {
    const rows = db().all(
      `SELECT d.code, d.name, d.sections, h.id AS hod_id, h.name AS hod_name,
        (SELECT COUNT(*) FROM students s WHERE s.department_code = d.code AND s.enrollment_status = 'Active' AND s.is_hosteller = 1) AS hostel_students
       FROM departments d LEFT JOIN users h ON h.department_code = d.code AND h.role = 'HOD' AND h.is_active = 1
       WHERE d.is_active = 1 ORDER BY d.code`,
    );
    ok(
      res,
      rows.map((r: any) => ({
        code: r.code,
        name: r.name,
        sections: String(r.sections || 'A')
          .split(',')
          .map((x: string) => x.trim().toUpperCase())
          .filter(Boolean),
        hodId: r.hod_id,
        hodName: r.hod_name,
        hostelStudents: r.hostel_students,
      })),
    );
  }),
);

/**
 * The institutional authority order and the Dean's monitoring scope, so the rules the
 * backend enforces are visible to every portal instead of being folklore.
 */
router.get(
  '/meta/authority',
  route((req, res) => ok(res, authorityModel(req.user!))),
);

/** Staff directory used by selectors (assignment recipients, follow-up owners, ...). */
router.get(
  '/meta/staff',
  requireRole('Dean', 'Admin', 'Warden', 'AO', 'HOD', 'Principal'),
  route((req, res) => {
    const roles = String(req.query.roles || 'HOD,Adviser,Warden')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const list = inList(roles);
    let rows = db().all<any>(
      `SELECT id, name, email, role, department_code, designation, phone FROM users WHERE is_active = 1 AND role IN ${list.sql} ORDER BY role, department_code, name`,
      ...list.params,
    );
    // HODs only see staff of their own department.
    if (req.user!.role === 'HOD') rows = rows.filter((r) => r.department_code === req.user!.departmentCode || r.role === 'Dean');
    ok(
      res,
      rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, department: r.department_code, designation: r.designation, phone: r.phone })),
    );
  }),
);

/** Maintenance staff list (managed by the AO office), used when assigning complaints. */
router.get(
  '/meta/technicians',
  requireRole('AO', 'Warden'),
  route((_req, res) => {
    ok(
      res,
      db()
        .all<any>('SELECT id, name, role, contact, category FROM technicians WHERE is_active = 1 ORDER BY category, name')
        .map((t) => ({ id: t.id, name: t.name, role: t.role, contact: t.contact, category: t.category })),
    );
  }),
);

router.get(
  '/meta/settings',
  requireRole('Dean', 'Admin', 'Warden', 'AO', 'HOD', 'Adviser', 'Principal'),
  route((_req, res) => ok(res, allSettings())),
);

router.put(
  '/meta/settings/:key',
  requireRole('Dean', 'Admin'),
  route((req, res) => {
    const key = req.params.key;
    if (!SETTING_DEFAULTS[key]) throw notFound('Setting');
    const v = new Validator(req.body);
    const value = v.string('value', { max: 200, label: 'Value' });
    v.done();
    const invalid = settingValueError(key, value!);
    if (invalid) throw badRequest(invalid, { fields: { value: invalid } });
    const before = allSettings().find((s) => s.key === key)?.value;
    db().run(
      `INSERT INTO settings (key, value, description, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      key,
      value,
      SETTING_DEFAULTS[key].description,
      req.user!.id,
      nowIso(),
    );
    audit(req, 'settings.updated', 'setting', key, { before, after: value });
    ok(res, allSettings().find((s) => s.key === key), { message: 'Setting saved.' });
  }),
);

// ---------------------------------------------------------------------------
// Attachments (stored in the database; max 5 MB each)
// ---------------------------------------------------------------------------
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = /^(application\/pdf|image\/(png|jpeg|webp)|text\/(plain|csv)|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel))$/;

/** Who may see / add files on which record. */
function attachmentAccess(user: AuthUser, entityType: string, entityId: string): { view: boolean; add: boolean } {
  const d = db();
  switch (entityType) {
    case 'assignment': {
      const a = d.get<any>('SELECT created_by FROM assignments WHERE id = ?', entityId);
      if (!a) return { view: false, add: false };
      const isRecipient = !!d.get('SELECT 1 FROM assignment_recipients WHERE assignment_id = ? AND user_id = ?', entityId, user.id);
      const isDean = user.role === 'Dean';
      return { view: isDean || isRecipient, add: isDean };
    }
    case 'assignment_submission': {
      const r = d.get<any>('SELECT user_id FROM assignment_recipients WHERE id = ?', entityId);
      if (!r) return { view: false, add: false };
      return { view: user.role === 'Dean' || r.user_id === user.id, add: r.user_id === user.id };
    }
    case 'report_request': {
      const rr = d.get('SELECT 1 FROM report_requests WHERE id = ?', entityId);
      if (!rr) return { view: false, add: false };
      const isRecipient = !!d.get('SELECT 1 FROM report_recipients WHERE request_id = ? AND user_id = ?', entityId, user.id);
      return { view: user.role === 'Dean' || isRecipient, add: user.role === 'Dean' };
    }
    case 'report_submission': {
      const r = d.get<any>('SELECT user_id FROM report_recipients WHERE id = ?', entityId);
      if (!r) return { view: false, add: false };
      return { view: user.role === 'Dean' || r.user_id === user.id, add: r.user_id === user.id };
    }
    case 'leave_request': {
      const l = d.get<any>('SELECT student_id FROM leave_requests WHERE id = ?', entityId);
      if (!l) return { view: false, add: false };
      const view = canAccessStudent(user, l.student_id);
      return { view, add: user.role === 'Student' && user.studentId === l.student_id };
    }
    case 'complaint': {
      const c = d.get<any>('SELECT student_id FROM complaints WHERE id = ?', entityId);
      if (!c) return { view: false, add: false };
      const view = user.role === 'AO' || canAccessStudent(user, c.student_id);
      return { view, add: user.role === 'Student' && user.studentId === c.student_id };
    }
    default:
      return { view: false, add: false };
  }
}

const mapAttachment = (a: any) => ({
  id: a.id,
  entityType: a.entity_type,
  entityId: a.entity_id,
  fileName: a.file_name,
  mimeType: a.mime_type,
  sizeBytes: a.size_bytes,
  createdAt: a.created_at,
  ownerName: a.owner_name,
});

router.get(
  '/attachments',
  route((req, res) => {
    const entityType = String(req.query.entityType || '');
    const entityId = String(req.query.entityId || '');
    if (!attachmentAccess(req.user!, entityType, entityId).view) throw forbidden();
    const rows = db().all(
      `SELECT a.id, a.entity_type, a.entity_id, a.file_name, a.mime_type, a.size_bytes, a.created_at, u.name AS owner_name
       FROM attachments a JOIN users u ON u.id = a.owner_id WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.created_at`,
      entityType,
      entityId,
    );
    ok(res, rows.map(mapAttachment));
  }),
);

router.post(
  '/attachments',
  route((req, res) => {
    const v = new Validator(req.body);
    const entityType = v.string('entityType', { max: 40 });
    const entityId = v.string('entityId', { max: 80 });
    const fileName = v.string('fileName', { max: 200, label: 'File name' });
    const mimeType = v.string('mimeType', { max: 120, label: 'File type' });
    const dataBase64 = v.string('dataBase64', { max: 8 * 1024 * 1024, label: 'File' });
    v.done();
    if (!ALLOWED_MIME.test(mimeType!)) throw badRequest('Only PDF, image, text, CSV and Office documents can be attached.');
    const buffer = Buffer.from(dataBase64!, 'base64');
    if (!buffer.length) throw badRequest('The file is empty.');
    if (buffer.length > MAX_ATTACHMENT_BYTES) throw badRequest('Attachments must be 5 MB or smaller.');
    if (!attachmentAccess(req.user!, entityType!, entityId!).add) throw forbidden('You cannot attach files to this record.');
    const id = uid('att');
    db().run(
      'INSERT INTO attachments (id, owner_id, entity_type, entity_id, file_name, mime_type, size_bytes, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      req.user!.id,
      entityType,
      entityId,
      fileName!.replace(/[\\/\r\n"]/g, '_'),
      mimeType,
      buffer.length,
      new Uint8Array(buffer),
      nowIso(),
    );
    audit(req, 'attachment.uploaded', entityType, entityId, { attachmentId: id, fileName, size: buffer.length });
    ok(res, { id, fileName, sizeBytes: buffer.length }, { message: 'File attached.' });
  }),
);

router.get(
  '/attachments/:id/download',
  route((req, res) => {
    const a = db().get<any>('SELECT * FROM attachments WHERE id = ?', req.params.id);
    if (!a) throw notFound('Attachment');
    if (!attachmentAccess(req.user!, a.entity_type, a.entity_id).view) throw forbidden();
    res.setHeader('Content-Type', a.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${a.file_name}"`);
    res.send(Buffer.from(a.data));
  }),
);

// ---------------------------------------------------------------------------
// Academic calendar holidays (read-only; shared by every portal calendar)
// ---------------------------------------------------------------------------
router.get(
  '/holidays',
  route((req, res) => {
    const clauses = ['is_active = 1'];
    const params: string[] = [];
    for (const [key, op] of [['from', '>='], ['to', '<=']] as const) {
      const value = String(req.query[key] || '');
      if (!value) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`"${key}" must be a date in YYYY-MM-DD format.`);
      clauses.push(`holiday_date ${op} ?`);
      params.push(value);
    }
    const rows = db().all<any>(
      `SELECT id, holiday_date, name, category, description FROM holidays WHERE ${clauses.join(' AND ')} ORDER BY holiday_date`,
      ...params,
    );
    ok(
      res,
      rows.map((h) => ({ id: h.id, date: h.holiday_date, name: h.name, category: h.category, description: h.description })),
    );
  }),
);

export default router;
