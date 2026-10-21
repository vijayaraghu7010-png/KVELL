import { db } from '../db/database';
import { badRequest, conflict, notFound } from '../lib/http';
import { audit, notify } from '../lib/records';
import { nowIso, uid } from '../lib/util';
import type { Request } from 'express';

/**
 * Class Incharge assignments. A teacher (Adviser role) may hold one department +
 * section; a department + section has one Class Incharge. Leave requests are routed
 * from the student's own department and section to that person — never chosen by
 * the student and never silently handed to another role.
 */

export interface InchargeRow {
  id: string;
  user_id: string;
  department_code: string;
  section: string;
  name: string;
  email: string;
  phone: string | null;
}

/** Sections a department is configured with, e.g. ['A','B']. */
export function departmentSections(code: string): string[] {
  const row = db().get<{ sections: string }>('SELECT sections FROM departments WHERE code = ?', code);
  if (!row) throw notFound('Department');
  return row.sections
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function assertSection(departmentCode: string, section: string) {
  const allowed = departmentSections(departmentCode);
  if (!allowed.includes(section.toUpperCase())) {
    throw badRequest(`Section ${section} is not configured for ${departmentCode}. Configured sections: ${allowed.join(', ') || 'none'}.`, {
      fields: { section: `Choose one of: ${allowed.join(', ')}.` },
    });
  }
  return section.toUpperCase();
}

/** The active Class Incharge for a department + section, or null. */
export function inchargeFor(departmentCode: string, section: string | null | undefined): InchargeRow | null {
  if (!section) return null;
  return (
    db().get<InchargeRow>(
      `SELECT ci.id, ci.user_id, ci.department_code, ci.section, u.name, u.email, u.phone
       FROM class_incharges ci JOIN users u ON u.id = ci.user_id
       WHERE ci.is_active = 1 AND ci.department_code = ? AND ci.section = ? AND u.is_active = 1`,
      departmentCode,
      section.toUpperCase(),
    ) ?? null
  );
}

/** The active assignment held by a user, or null. */
export function inchargeOf(userId: string): { id: string; department_code: string; section: string } | null {
  return (
    db().get<{ id: string; department_code: string; section: string }>(
      `SELECT id, department_code, section FROM class_incharges WHERE user_id = ? AND is_active = 1`,
      userId,
    ) ?? null
  );
}

export const isClassIncharge = (userId: string) => !!inchargeOf(userId);

/** The active HOD of a department, or null. */
export function hodOf(departmentCode: string): { id: string; name: string } | null {
  return db().get<{ id: string; name: string }>(`SELECT id, name FROM users WHERE role = 'HOD' AND is_active = 1 AND department_code = ?`, departmentCode) ?? null;
}

export function listIncharges() {
  return db()
    .all<any>(
      `SELECT ci.*, u.name, u.email, u.phone, u.is_active AS user_active, d.name AS department_name,
              (SELECT COUNT(*) FROM students s WHERE s.department_code = ci.department_code AND s.section = ci.section AND s.enrollment_status = 'Active') AS student_count
       FROM class_incharges ci JOIN users u ON u.id = ci.user_id JOIN departments d ON d.code = ci.department_code
       WHERE ci.is_active = 1 ORDER BY ci.department_code, ci.section`,
    )
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      email: r.email,
      phone: r.phone || '',
      department: r.department_code,
      departmentName: r.department_name,
      section: r.section,
      studentCount: r.student_count,
      isUserActive: r.user_active === 1,
      assignedAt: r.created_at,
    }));
}

/**
 * Makes `userId` the Class Incharge of department + section, replacing any previous
 * holder of that slot and any slot the user already held. Conflicting assignments are
 * rejected rather than silently overwritten unless `replace` is set.
 */
export function assignIncharge(req: Request, userId: string, departmentCode: string, rawSection: string, replace = false) {
  const section = assertSection(departmentCode, rawSection);
  const user = db().get<any>('SELECT id, name, role, department_code, is_active FROM users WHERE id = ?', userId);
  if (!user) throw notFound('User');
  if (user.role !== 'Adviser') throw badRequest('Only Adviser/Teacher accounts can be made a Class Incharge.');
  if (!user.is_active) throw badRequest('This account is deactivated.');
  if (user.department_code !== departmentCode) {
    throw badRequest(`${user.name} belongs to ${user.department_code}; a Class Incharge must be assigned within their own department.`, {
      fields: { department: `Choose ${user.department_code} or move the account first.` },
    });
  }
  return db().transaction(() => {
    const now = nowIso();
    const holder = db().get<any>(
      `SELECT ci.id, ci.user_id, u.name FROM class_incharges ci JOIN users u ON u.id = ci.user_id
       WHERE ci.is_active = 1 AND ci.department_code = ? AND ci.section = ?`,
      departmentCode,
      section,
    );
    if (holder && holder.user_id !== userId && !replace) {
      throw conflict(`${departmentCode} Section ${section} already has a Class Incharge (${holder.name}). Reassign or release that teacher first.`);
    }
    if (holder && holder.user_id === userId) return holder.id as string;
    if (holder) db().run('UPDATE class_incharges SET is_active = 0, updated_at = ? WHERE id = ?', now, holder.id);

    const existing = inchargeOf(userId);
    if (existing) db().run('UPDATE class_incharges SET is_active = 0, updated_at = ? WHERE id = ?', now, existing.id);

    const id = uid('cin');
    db().run(
      `INSERT INTO class_incharges (id, user_id, department_code, section, is_active, assigned_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      id,
      userId,
      departmentCode,
      section,
      req.user?.id ?? null,
      now,
      now,
    );
    audit(req, 'admin.class_incharge_assigned', 'user', userId, { department: departmentCode, section, replaced: holder?.user_id ?? null });
    notify([userId], {
      eventType: 'class_incharge.assigned',
      title: `You are the Class Incharge for ${departmentCode} Section ${section}`,
      message: 'Leave requests from this section now come to you for the first approval.',
      entityType: 'class_incharge',
      entityId: id,
      link: '/adviser/leave-requests',
      dedupeKey: `class_incharge.assigned:${id}`,
    });
    if (holder && holder.user_id !== userId) {
      notify([holder.user_id], {
        eventType: 'class_incharge.released',
        title: `You are no longer the Class Incharge for ${departmentCode} Section ${section}`,
        message: `${user.name} has taken over this section.`,
        severity: 'warning',
        dedupeKey: `class_incharge.released:${holder.id}`,
      });
    }
    return id;
  });
}

/** Removes a user's Class Incharge role. Pending leave approvals block the change. */
export function releaseIncharge(req: Request, userId: string) {
  const existing = inchargeOf(userId);
  if (!existing) return false;
  const pending = db().get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM leave_requests WHERE incharge_id = ? AND status = 'Pending Class Incharge'`,
    userId,
  )!.c;
  if (pending) throw conflict(`This teacher still has ${pending} leave request(s) awaiting their decision. Clear them, or assign a replacement for the section instead.`);
  db().run('UPDATE class_incharges SET is_active = 0, updated_at = ? WHERE id = ?', nowIso(), existing.id);
  audit(req, 'admin.class_incharge_released', 'user', userId, { department: existing.department_code, section: existing.section });
  return true;
}
