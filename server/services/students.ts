import { db } from '../db/database';
import { hashPassword } from '../lib/auth';
import { badRequest, conflict } from '../lib/http';
import { nextCode, nowIso, uid } from '../lib/util';
import { Validator } from '../lib/validate';
import { assertSection } from './classIncharge';

export interface StudentPayload {
  name?: string;
  regNumber?: string;
  department?: string;
  year?: number;
  semester?: number;
  gender?: string;
  phone?: string;
  email?: string;
  parentName?: string;
  parentPhone?: string;
  address?: string;
  admissionYear?: number;
  adviserId?: string;
  section?: string;
  isHosteller?: boolean;
  enrollmentStatus?: string;
}

/** Reads and validates a student record from a request body. */
export function readStudent(body: any, partial: boolean) {
  const v = new Validator(body);
  const out = {
    name: v.string('name', { max: 120, label: 'Name', required: !partial }),
    regNumber: v.string('regNumber', { max: 30, label: 'Register number', required: false }),
    department: v.string('department', { max: 20, label: 'Department', required: !partial }),
    year: v.int('year', { min: 1, max: 5, label: 'Year', required: !partial }),
    semester: v.int('semester', { min: 1, max: 10, label: 'Semester', required: false }),
    gender: v.string('gender', { required: false, max: 20 }),
    phone: v.string('phone', { required: false, max: 30 }),
    email: v.string('email', { required: false, max: 200 }),
    parentName: v.string('parentName', { required: false, max: 120 }),
    parentPhone: v.string('parentPhone', { required: false, max: 30 }),
    address: v.string('address', { required: false, max: 300 }),
    admissionYear: v.int('admissionYear', { required: false, min: 1990, max: 2100 }),
    adviserId: v.string('adviserId', { required: false, max: 80 }),
    section: v.string('section', { required: false, max: 4, label: 'Class section' }),
    isHosteller: body?.isHosteller === undefined ? undefined : v.bool('isHosteller'),
    enrollmentStatus: v.oneOf('enrollmentStatus', ['Active', 'Inactive', 'Graduated', 'Withdrawn'] as const, { required: false }),
  };
  v.done();
  if (out.department && !db().get('SELECT 1 FROM departments WHERE code = ?', out.department)) throw badRequest('Unknown department.');
  return out;
}

/** Advisers may only advise students of their own department. */
export function checkAdviser(adviserId: string | null | undefined, department: string) {
  if (!adviserId) return;
  const adv = db().get<any>(`SELECT department_code FROM users WHERE id = ? AND role = 'Adviser' AND is_active = 1`, adviserId);
  if (!adv) throw badRequest('Adviser not found.');
  if (adv.department_code !== department) throw badRequest(`The adviser belongs to ${adv.department_code}; choose an adviser from ${department}.`);
}

/**
 * The sign-in password handed to a new student: the first word of their name
 * followed by the first four digits of their phone number (e.g. Divya9876).
 * It is shown once to the staff member who creates the account.
 */
export function initialStudentPassword(name: string, phone: string) {
  const first = name.trim().split(/\s+/)[0].replace(/[^A-Za-z]/g, '');
  const digits = (phone || '').replace(/\D/g, '').slice(0, 4);
  if (!first) throw badRequest('The name must start with a letter so a password can be generated.', { fields: { name: 'Enter the student’s name.' } });
  if (digits.length < 4) throw badRequest('A phone number with at least four digits is needed to generate the sign-in password.', { fields: { phone: 'Enter a phone number with at least 4 digits.' } });
  return `${first}${digits}`;
}

/**
 * Creates a student record and, when an email is given, their sign-in account with the
 * generated password. Returns the new id and that password so it can be handed over.
 */
export function createStudent(actorId: string, body: any) {
  const s = readStudent(body, false);
  checkAdviser(s.adviserId, s.department!);
  if (s.regNumber && db().get('SELECT 1 FROM students WHERE reg_number = ?', s.regNumber)) throw conflict(`Register number ${s.regNumber} already exists.`);
  const withLogin = !!s.email;
  if (withLogin && db().get('SELECT 1 FROM users WHERE email = ?', s.email)) throw conflict('An account with this email already exists.');
  const password = withLogin ? initialStudentPassword(s.name!, s.phone ?? '') : null;

  const id = db().transaction(() => {
    const now = nowIso();
    // Admission can happen before the register number is issued; a provisional one keeps
    // every record (passes, gate scans, attendance) addressable until it is replaced.
    const regNumber = s.regNumber || nextCode('TMP');
    let userId: string | null = null;
    if (password) {
      userId = uid('usr');
      // No forced reset: the generated password is the one the student is given.
      db().run(
        `INSERT INTO users (id, email, password_hash, name, role, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 'Student', 0, ?, ?)`,
        userId,
        s.email,
        hashPassword(password),
        s.name,
        now,
        now,
      );
    }
    const sid = uid('stu');
    db().run(
      `INSERT INTO students (id, user_id, reg_number, name, department_code, year, semester, gender, phone, email, address, parent_name, parent_phone, admission_year, adviser_user_id, section, is_hosteller, enrollment_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sid,
      userId,
      regNumber,
      s.name,
      s.department,
      s.year,
      s.semester ?? null,
      s.gender ?? null,
      s.phone ?? null,
      s.email ?? null,
      s.address ?? null,
      s.parentName ?? null,
      s.parentPhone ?? null,
      s.admissionYear ?? null,
      s.adviserId ?? null,
      s.section ? assertSection(s.department!, s.section) : null,
      s.isHosteller ?? true,
      s.enrollmentStatus ?? 'Active',
      now,
      now,
    );
    return { sid, regNumber };
  });
  return { id: id.sid, regNumber: id.regNumber, provisional: !s.regNumber, password };
}
