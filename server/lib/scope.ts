import { db } from '../db/database';
import type { AuthUser } from './auth';
import { forbidden, notFound } from './http';
import { yearLabel } from './util';

/**
 * Row-level visibility of student records. Every query that returns student data
 * must AND this condition (alias `s` = students).
 *  - Student: only their own record
 *  - Adviser: students assigned to them
 *  - HOD: students of their department
 *  - Warden / AO / Dean / Principal / Admin: hostel-wide
 */
export function studentScope(user: AuthUser, alias = 's'): { sql: string; params: unknown[] } {
  switch (user.role) {
    case 'Student':
      return { sql: `${alias}.user_id = ?`, params: [user.id] };
    case 'Adviser':
      return { sql: `${alias}.adviser_user_id = ?`, params: [user.id] };
    case 'HOD':
      return { sql: `${alias}.department_code = ?`, params: [user.departmentCode] };
    case 'Warden':
    case 'AO':
    case 'Dean':
    case 'Principal':
    case 'Admin':
      return { sql: '1 = 1', params: [] };
    default:
      return { sql: '1 = 0', params: [] };
  }
}

export function canAccessStudent(user: AuthUser, studentId: string): boolean {
  const scope = studentScope(user);
  return !!db().get(`SELECT 1 FROM students s WHERE s.id = ? AND ${scope.sql}`, studentId, ...scope.params);
}

export function assertStudentAccess(user: AuthUser, studentId: string) {
  const exists = db().get('SELECT 1 FROM students WHERE id = ?', studentId);
  if (!exists) throw notFound('Student');
  if (!canAccessStudent(user, studentId)) throw forbidden('You are not authorized to access this student record.');
}

export const STUDENT_SELECT = `
  s.*, r.room_number, r.block, r.room_type, d.name AS department_name,
  adv.name AS adviser_name, adv.email AS adviser_email,
  (SELECT op.source_type FROM outpasses op WHERE op.student_id = s.id AND op.status = 'Out' ORDER BY op.checked_out_at DESC LIMIT 1) AS out_on
`;
export const STUDENT_FROM = `
  students s
  JOIN departments d ON d.code = s.department_code
  LEFT JOIN rooms r ON r.id = s.room_id
  LEFT JOIN users adv ON adv.id = s.adviser_user_id
`;

/** Shape compatible with the existing UI `StudentRecord` type, plus extra fields. */
export function mapStudent(r: any) {
  return {
    id: r.id,
    name: r.name,
    regNumber: r.reg_number,
    department: r.department_code,
    departmentName: r.department_name,
    section: r.section ?? null,
    year: yearLabel(r.year),
    yearNumber: r.year,
    semester: r.semester,
    roomNumber: r.room_number || 'Unallocated',
    roomId: r.room_id,
    block: r.block || null,
    status: r.out_on === 'Leave' ? 'On Leave' : r.out_on === 'Outing' ? 'On Outing' : 'Present',
    gender: r.gender || '',
    contactNumber: r.phone || '',
    email: r.email || '',
    permanentAddress: r.address || '',
    parentName: r.parent_name || '',
    parentNumber: r.parent_phone || '',
    bloodGroup: r.blood_group || '',
    medicalNotes: r.medical_notes || '',
    enrollmentStatus: r.enrollment_status,
    admissionYear: r.admission_year,
    adviserId: r.adviser_user_id,
    adviserName: r.adviser_name || null,
    isHosteller: r.is_hosteller === 1,
    isDemo: r.is_demo === 1,
  };
}

export function listStudents(user: AuthUser, extraWhere = '1 = 1', ...extraParams: unknown[]) {
  const scope = studentScope(user);
  return db()
    .all(
      `SELECT ${STUDENT_SELECT} FROM ${STUDENT_FROM}
       WHERE ${scope.sql} AND ${extraWhere}
       ORDER BY s.department_code, s.year, s.name`,
      ...scope.params,
      ...extraParams,
    )
    .map(mapStudent);
}

export function getStudent(user: AuthUser, studentId: string) {
  assertStudentAccess(user, studentId);
  const row = db().get(`SELECT ${STUDENT_SELECT} FROM ${STUDENT_FROM} WHERE s.id = ?`, studentId);
  return mapStudent(row);
}

/** The student record linked to a Student account; 403 when the account has none. */
export function ownStudentId(user: AuthUser): string {
  if (user.role !== 'Student' || !user.studentId) throw forbidden('This account is not linked to a student record.');
  return user.studentId;
}

export const userBrief = (id: string | null | undefined) =>
  id ? db().get<{ id: string; name: string; role: string; department_code: string | null; email: string }>('SELECT id, name, role, department_code, email FROM users WHERE id = ?', id) ?? null : null;
