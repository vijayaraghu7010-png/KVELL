import { Router } from 'express';
import { db } from '../db/database';
import { destroyUserSessions, hashPassword, passwordPolicyError, requireRole, ROLES } from '../lib/auth';
import { badRequest, conflict, created, notFound, ok, route } from '../lib/http';
import { audit, notify } from '../lib/records';
import { mapStudent, STUDENT_FROM, STUDENT_SELECT } from '../lib/scope';
import { fmtDateTime, inList, nowIso, uid } from '../lib/util';
import { Validator } from '../lib/validate';
import { assertSection, assignIncharge, listIncharges, releaseIncharge } from '../services/classIncharge';
import { checkAdviser, readStudent } from '../services/students';
import { COMPLAINT_PRIORITIES, listCategories, listWorkers } from '../services/complaints';

const router = Router();
router.use(requireRole('Admin'));

const mapUser = (u: any) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  department: u.department_code,
  phone: u.phone,
  designation: u.designation,
  employeeId: u.employee_id,
  office: u.office,
  isActive: u.is_active === 1,
  isDemo: u.is_demo === 1,
  mustChangePassword: u.must_change_password === 1,
  lockedUntil: u.locked_until,
  createdAt: fmtDateTime(u.created_at),
  studentId: u.student_id ?? null,
  isClassIncharge: !!u.incharge_section,
  classSection: u.incharge_section ?? null,
  /** Staff responsibility, not the student's own residential status. */
  studentCategory: u.student_category ?? null,
});

export const STUDENT_CATEGORIES = ['Hosteller', 'Out / Day Scholar'] as const;

router.get(
  '/users',
  route((_req, res) => {
    ok(
      res,
      db()
        .all(
          `SELECT u.*, s.id AS student_id, ci.section AS incharge_section
           FROM users u
           LEFT JOIN students s ON s.user_id = u.id
           LEFT JOIN class_incharges ci ON ci.user_id = u.id AND ci.is_active = 1
           ORDER BY u.role, u.department_code, u.name`,
        )
        .map(mapUser),
    );
  }),
);

function checkDepartment(role: string, dept: string | undefined) {
  if ((role === 'HOD' || role === 'Adviser') && !dept) throw badRequest(`${role} accounts must belong to a department.`, { fields: { department: 'Department is required.' } });
  if (dept && !db().get('SELECT 1 FROM departments WHERE code = ? AND is_active = 1', dept)) throw badRequest('Unknown department.');
  if (role === 'HOD' && dept && db().get(`SELECT 1 FROM users WHERE role = 'HOD' AND is_active = 1 AND department_code = ?`, dept)) {
    throw conflict(`Department ${dept} already has an active HOD. Deactivate or reassign the current HOD first.`);
  }
}

router.post(
  '/users',
  route((req, res) => {
    const v = new Validator(req.body);
    const name = v.string('name', { max: 120, label: 'Name' });
    const email = v.string('email', { max: 200, label: 'Email' });
    const role = v.oneOf('role', ROLES, { label: 'Role' });
    const department = v.string('department', { required: false, max: 20 });
    const phone = v.string('phone', { required: false, max: 30 });
    const designation = v.string('designation', { required: false, max: 120 });
    const employeeId = v.string('employeeId', { required: false, max: 40 });
    const password = v.string('temporaryPassword', { max: 128, label: 'Temporary password' });
    // "Are you a Class Incharge?" — the section is only asked for, and only stored, on Yes.
    const isClassIncharge = req.body?.isClassIncharge === undefined ? false : v.bool('isClassIncharge');
    const section = isClassIncharge ? v.string('section', { max: 4, label: 'Class section' }) : undefined;
    // Required for Advisers: which students they are responsible for.
    const studentCategory = v.oneOf('studentCategory', STUDENT_CATEGORIES, { required: role === 'Adviser', label: 'Student category / responsibility' });
    v.check(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'email', 'Enter a valid email address.');
    v.done();
    if (isClassIncharge && role !== 'Adviser') throw badRequest('Only Adviser/Teacher accounts can be a Class Incharge.', { fields: { isClassIncharge: 'Not available for this role.' } });
    const policy = passwordPolicyError(password);
    if (policy) throw badRequest(policy, { fields: { temporaryPassword: policy } });
    if (role === 'Student') throw badRequest('Create student accounts from the Students tab so they are linked to a student record.');
    checkDepartment(role!, department);
    if (db().get('SELECT 1 FROM users WHERE email = ?', email)) throw conflict('An account with this email already exists.');
    const id = uid('usr');
    const now = nowIso();
    db().run(
      `INSERT INTO users (id, email, password_hash, name, role, department_code, phone, designation, employee_id, student_category, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      email,
      hashPassword(password!),
      name,
      role,
      department ?? null,
      phone ?? null,
      designation ?? null,
      employeeId ?? null,
      role === 'Adviser' ? studentCategory ?? null : null,
      now,
      now,
    );
    if (isClassIncharge) assignIncharge(req, id, department!, section!);
    audit(req, 'admin.user_created', 'user', id, { email, role, department, classIncharge: isClassIncharge ? section : null });
    created(
      res,
      mapUser(db().get(`SELECT u.*, ci.section AS incharge_section FROM users u LEFT JOIN class_incharges ci ON ci.user_id = u.id AND ci.is_active = 1 WHERE u.id = ?`, id)),
      `${role} account created${isClassIncharge ? ` as Class Incharge of ${department} Section ${section}` : ''}. The user must change the temporary password at first sign-in.`,
    );
  }),
);

router.patch(
  '/users/:id',
  route((req, res) => {
    const u = db().get<any>('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!u) throw notFound('User');
    const v = new Validator(req.body);
    const name = v.string('name', { required: false, max: 120 });
    const role = v.oneOf('role', ROLES, { required: false });
    const department = v.string('department', { required: false, max: 20 });
    const isActive = req.body.isActive === undefined ? undefined : v.bool('isActive');
    const phone = v.string('phone', { required: false, max: 30 });
    const designation = v.string('designation', { required: false, max: 120 });
    const isClassIncharge = req.body?.isClassIncharge === undefined ? undefined : v.bool('isClassIncharge');
    const section = isClassIncharge ? v.string('section', { max: 4, label: 'Class section' }) : undefined;
    const studentCategory = v.oneOf('studentCategory', STUDENT_CATEGORIES, { required: false, label: 'Student category / responsibility' });
    v.done();
    if (u.id === req.user!.id && (isActive === false || (role && role !== 'Admin'))) throw conflict('You cannot deactivate or demote your own administrator account.');
    // Student accounts are tied to a student record, so neither direction of role change is allowed.
    if (role && (role === 'Student') !== (u.role === 'Student')) throw badRequest('Student accounts cannot change role.');
    const nextRole = role ?? u.role;
    const nextDept = department ?? u.department_code;
    const nextActive = isActive ?? u.is_active === 1;
    if (nextActive && (nextRole !== u.role || nextDept !== u.department_code || !u.is_active)) {
      if ((nextRole === 'HOD' || nextRole === 'Adviser') && !nextDept) throw badRequest(`${nextRole} accounts must belong to a department.`);
      if (nextRole === 'HOD' && db().get(`SELECT 1 FROM users WHERE role = 'HOD' AND is_active = 1 AND department_code = ? AND id != ?`, nextDept, u.id)) {
        throw conflict(`Department ${nextDept} already has an active HOD.`);
      }
    }
    const nextCategory = nextRole === 'Adviser' ? studentCategory ?? u.student_category : null;
    if (nextRole === 'Adviser' && !nextCategory) {
      throw badRequest('Choose whether this Adviser is responsible for Hosteller or Out / Day Scholar students.', { fields: { studentCategory: 'This field is required for an Adviser.' } });
    }
    // Moving an Adviser off Hosteller duty must not leave them owning live sessions.
    if (u.student_category === 'Hosteller' && nextCategory !== 'Hosteller') {
      const live = db().get<{ c: number }>(`SELECT COUNT(*) AS c FROM study_sessions WHERE adviser_user_id = ? AND status IN ('Scheduled','In Progress')`, u.id)!.c;
      if (live) throw conflict(`${u.name} still has ${live} scheduled or running study session(s). Reassign or cancel them first.`);
    }
    db().run(
      `UPDATE users SET name = COALESCE(?, name), role = ?, department_code = ?, is_active = ?, phone = COALESCE(?, phone), designation = COALESCE(?, designation),
        student_category = ?, updated_at = ? WHERE id = ?`,
      name ?? null,
      nextRole,
      nextDept,
      nextActive ? 1 : 0,
      phone ?? null,
      designation ?? null,
      nextCategory,
      nowIso(),
      u.id,
    );
    // Class Incharge assignment follows the Yes/No answer on the form.
    if (isClassIncharge === true) {
      if (nextRole !== 'Adviser') throw badRequest('Only Adviser/Teacher accounts can be a Class Incharge.', { fields: { isClassIncharge: 'Not available for this role.' } });
      assignIncharge(req, u.id, nextDept!, section!, true);
    } else if (isClassIncharge === false || (nextRole !== 'Adviser' && u.role === 'Adviser') || !nextActive) {
      releaseIncharge(req, u.id);
    }
    // Role or access changes take effect immediately: end existing sessions.
    if (nextRole !== u.role || nextDept !== u.department_code || !nextActive) destroyUserSessions(u.id);
    audit(req, 'admin.user_updated', 'user', u.id, { before: { role: u.role, dept: u.department_code, active: u.is_active }, after: { role: nextRole, dept: nextDept, active: nextActive } });
    ok(res, mapUser(db().get(`SELECT u.*, ci.section AS incharge_section FROM users u LEFT JOIN class_incharges ci ON ci.user_id = u.id AND ci.is_active = 1 WHERE u.id = ?`, u.id)), {
      message: 'Account updated.',
    });
  }),
);

router.post(
  '/users/:id/reset-password',
  route((req, res) => {
    const u = db().get<any>('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!u) throw notFound('User');
    const v = new Validator(req.body);
    const password = v.string('temporaryPassword', { max: 128, label: 'Temporary password' });
    v.done();
    const policy = passwordPolicyError(password);
    if (policy) throw badRequest(policy);
    db().run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?', hashPassword(password!), nowIso(), u.id);
    destroyUserSessions(u.id);
    audit(req, 'admin.password_reset', 'user', u.id);
    ok(res, null, { message: `Temporary password set for ${u.name}. They must change it at next sign-in.` });
  }),
);

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------
router.post(
  '/departments',
  route((req, res) => {
    const v = new Validator(req.body);
    const code = v.string('code', { max: 12, label: 'Code' })?.toUpperCase();
    const name = v.string('name', { max: 120, label: 'Name' });
    v.check(!code || /^[A-Z&]{2,12}$/.test(code), 'code', 'Code must be 2–12 letters (e.g. CSE).');
    v.done();
    if (db().get('SELECT 1 FROM departments WHERE code = ? OR name = ?', code, name)) throw conflict('A department with this code or name already exists.');
    db().run('INSERT INTO departments (code, name, created_at) VALUES (?, ?, ?)', code, name, nowIso());
    audit(req, 'admin.department_created', 'department', code);
    created(res, { code, name }, `Department ${code} created.`);
  }),
);

// ---------------------------------------------------------------------------
// Students (records + optional login) and adviser assignment
// ---------------------------------------------------------------------------
router.get(
  '/students',
  route((_req, res) => {
    ok(res, db().all(`SELECT ${STUDENT_SELECT}, (SELECT email FROM users WHERE id = s.user_id) AS login_email FROM ${STUDENT_FROM} ORDER BY s.department_code, s.year, s.name`).map((r: any) => ({ ...mapStudent(r), loginEmail: r.login_email })));
  }),
);

router.patch(
  '/students/:id',
  route((req, res) => {
    const cur = db().get<any>('SELECT * FROM students WHERE id = ?', req.params.id);
    if (!cur) throw notFound('Student');
    const s = readStudent(req.body, true);
    const nextDept = s.department ?? cur.department_code;
    const nextAdviser = req.body.adviserId !== undefined ? req.body.adviserId || null : cur.adviser_user_id;
    checkAdviser(nextAdviser, nextDept);
    const map: Record<string, unknown> = {
      name: s.name,
      department_code: s.department,
      year: s.year,
      semester: s.semester,
      gender: s.gender,
      phone: s.phone,
      email: s.email,
      parent_name: s.parentName,
      parent_phone: s.parentPhone,
      address: s.address,
      admission_year: s.admissionYear,
      is_hosteller: s.isHosteller === undefined ? undefined : s.isHosteller ? 1 : 0,
      enrollment_status: s.enrollmentStatus,
      section: s.section === undefined ? undefined : assertSection(nextDept, s.section),
    };
    if (req.body.adviserId !== undefined) map.adviser_user_id = req.body.adviserId || null;
    const set = Object.entries(map).filter(([, v]) => v !== undefined);
    if (!set.length) throw badRequest('No changes provided.');
    db().run(`UPDATE students SET ${set.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...set.map(([, v]) => v), nowIso(), cur.id);
    audit(req, 'admin.student_updated', 'student', cur.id, { fields: set.map(([k]) => k) });
    ok(res, mapStudent(db().get(`SELECT ${STUDENT_SELECT} FROM ${STUDENT_FROM} WHERE s.id = ?`, cur.id)), { message: 'Student record updated.' });
  }),
);

/** Bulk adviser assignment; advisers may only advise students of their own department. */
router.post(
  '/advisers/:id/assign',
  route((req, res) => {
    const adv = db().get<any>(`SELECT id, name, department_code FROM users WHERE id = ? AND role = 'Adviser' AND is_active = 1`, req.params.id);
    if (!adv) throw notFound('Adviser');
    const v = new Validator(req.body);
    const studentIds = v.stringArray('studentIds', { required: true, max: 500, label: 'Students' });
    v.done();
    const l = inList(studentIds);
    const rows = db().all<any>(`SELECT id, department_code FROM students WHERE id IN ${l.sql}`, ...l.params);
    if (rows.length !== studentIds.length) throw badRequest('One or more students were not found.');
    const wrong = rows.filter((r) => r.department_code !== adv.department_code);
    if (wrong.length) throw badRequest(`${wrong.length} student(s) are not in ${adv.department_code}; advisers are assigned within their department.`);
    db().run(`UPDATE students SET adviser_user_id = ?, updated_at = ? WHERE id IN ${l.sql}`, adv.id, nowIso(), ...l.params);
    notify([adv.id], { eventType: 'advisees.assigned', title: `${studentIds.length} student(s) assigned to you`, message: 'Your advisee list has been updated by the administrator.', link: '/adviser/students' });
    audit(req, 'admin.advisees_assigned', 'user', adv.id, { count: studentIds.length });
    ok(res, { assigned: studentIds.length }, { message: `${studentIds.length} student(s) assigned to ${adv.name}.` });
  }),
);

router.get(
  '/audit',
  route((req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || 200), 10) || 200, 1000);
    ok(
      res,
      db()
        .all<any>(`SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ?`, limit)
        .map((a) => ({ id: a.id, at: fmtDateTime(a.created_at), actor: a.actor_name || 'System / anonymous', role: a.actor_role, action: a.action, entityType: a.entity_type, entityId: a.entity_id, details: a.details_json, ip: a.ip })),
    );
  }),
);

// ---------------------------------------------------------------------------
// Class Incharge assignments (department + section -> teacher)
// ---------------------------------------------------------------------------
router.get(
  '/class-incharges',
  route((_req, res) => {
    const departments = db()
      .all<any>(`SELECT code, name, sections FROM departments WHERE is_active = 1 ORDER BY code`)
      .map((d) => ({
        code: d.code,
        name: d.name,
        sections: String(d.sections)
          .split(',')
          .map((x: string) => x.trim().toUpperCase())
          .filter(Boolean),
      }));
    const assigned = listIncharges();
    const slots = departments.flatMap((d) =>
      d.sections.map((section: string) => {
        const holder = assigned.find((a) => a.department === d.code && a.section === section) ?? null;
        return { department: d.code, departmentName: d.name, section, incharge: holder };
      }),
    );
    const teachers = db()
      .all<any>(
        `SELECT u.id, u.name, u.email, u.department_code, ci.section AS incharge_section
         FROM users u LEFT JOIN class_incharges ci ON ci.user_id = u.id AND ci.is_active = 1
         WHERE u.role = 'Adviser' AND u.is_active = 1 ORDER BY u.department_code, u.name`,
      )
      .map((t) => ({ id: t.id, name: t.name, email: t.email, department: t.department_code, currentSection: t.incharge_section ?? null }));
    ok(res, { departments, slots, assignments: assigned, teachers });
  }),
);

router.post(
  '/class-incharges',
  route((req, res) => {
    const v = new Validator(req.body);
    const userId = v.string('userId', { max: 80, label: 'Teacher' });
    const department = v.string('department', { max: 20, label: 'Department' });
    const section = v.string('section', { max: 4, label: 'Class section' });
    const replace = req.body?.replace === undefined ? false : v.bool('replace');
    v.done();
    const id = assignIncharge(req, userId!, department!, section!, replace);
    ok(res, { id, assignments: listIncharges() }, { message: `Class Incharge assigned to ${department} Section ${section!.toUpperCase()}.` });
  }),
);

router.delete(
  '/class-incharges/:userId',
  route((req, res) => {
    const removed = releaseIncharge(req, req.params.userId);
    if (!removed) throw notFound('Class Incharge assignment');
    ok(res, { assignments: listIncharges() }, { message: 'Class Incharge assignment removed.' });
  }),
);

/** Sections a department runs, e.g. "A,B". */
router.patch(
  '/departments/:code',
  route((req, res) => {
    const code = req.params.code.toUpperCase();
    const dept = db().get<any>('SELECT * FROM departments WHERE code = ?', code);
    if (!dept) throw notFound('Department');
    const v = new Validator(req.body);
    const sections = v.string('sections', { max: 60, label: 'Sections' });
    v.done();
    const list = sections!
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    if (!list.length) throw badRequest('List at least one section, for example "A,B".', { fields: { sections: 'At least one section is required.' } });
    if (new Set(list).size !== list.length) throw badRequest('Section names must be unique.');
    const inUse = db()
      .all<{ section: string }>(`SELECT DISTINCT section FROM students WHERE department_code = ? AND section IS NOT NULL`, code)
      .map((r) => r.section)
      .filter((x) => !list.includes(x));
    if (inUse.length) throw conflict(`Section(s) ${inUse.join(', ')} still have students assigned. Move those students first.`);
    db().run('UPDATE departments SET sections = ? WHERE code = ?', list.join(','), code);
    audit(req, 'admin.department_sections_updated', 'department', code, { sections: list });
    ok(res, { code, sections: list }, { message: `${code} now runs section(s) ${list.join(', ')}.` });
  }),
);

// ---------------------------------------------------------------------------
// Complaint categories, resolution targets and workers
// ---------------------------------------------------------------------------
router.get(
  '/complaint-categories',
  route((_req, res) => ok(res, listCategories(false))),
);

router.post(
  '/complaint-categories',
  route((req, res) => {
    const v = new Validator(req.body);
    const name = v.string('name', { max: 80, label: 'Name' });
    const description = v.string('description', { required: false, max: 300 });
    const defaultPriority = v.oneOf('defaultPriority', COMPLAINT_PRIORITIES, { label: 'Default priority' });
    const resolutionHours = v.number('resolutionHours', { min: 0.25, max: 2160, label: 'Resolution target (hours)' });
    const workerCategory = v.string('workerCategory', { required: false, max: 60 });
    const routesToAO = req.body?.routesToAO === undefined ? false : v.bool('routesToAO');
    const sortOrder = v.int('sortOrder', { required: false, min: 0, max: 999 });
    v.done();
    if (db().get('SELECT 1 FROM complaint_categories WHERE name = ?', name)) throw conflict('A category with this name already exists.');
    const id = uid('ccat');
    const now = nowIso();
    db().run(
      `INSERT INTO complaint_categories (id, name, description, default_priority, resolution_hours, worker_category, routes_to_ao, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      id,
      name,
      description ?? null,
      defaultPriority,
      resolutionHours,
      workerCategory ?? null,
      routesToAO ? 1 : 0,
      sortOrder ?? 100,
      now,
      now,
    );
    audit(req, 'admin.complaint_category_created', 'complaint_category', id, { name, resolutionHours });
    created(res, listCategories(false).find((c) => c.id === id), `Category "${name}" created.`);
  }),
);

router.patch(
  '/complaint-categories/:id',
  route((req, res) => {
    const cat = db().get<any>('SELECT * FROM complaint_categories WHERE id = ?', req.params.id);
    if (!cat) throw notFound('Complaint category');
    const v = new Validator(req.body);
    const name = v.string('name', { required: false, max: 80 });
    const description = v.string('description', { required: false, max: 300 });
    const defaultPriority = v.oneOf('defaultPriority', COMPLAINT_PRIORITIES, { required: false });
    const resolutionHours = v.number('resolutionHours', { required: false, min: 0.25, max: 2160 });
    const workerCategory = req.body?.workerCategory === undefined ? undefined : v.string('workerCategory', { required: false, max: 60 }) ?? '';
    const isActive = req.body?.isActive === undefined ? undefined : v.bool('isActive');
    const sortOrder = v.int('sortOrder', { required: false, min: 0, max: 999 });
    v.done();
    const map: Record<string, unknown> = {
      name,
      description,
      default_priority: defaultPriority,
      resolution_hours: resolutionHours,
      worker_category: workerCategory === undefined ? undefined : workerCategory || null,
      is_active: isActive === undefined ? undefined : isActive ? 1 : 0,
      sort_order: sortOrder,
    };
    const set = Object.entries(map).filter(([, value]) => value !== undefined);
    if (set.length) {
      db().run(`UPDATE complaint_categories SET ${set.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...set.map(([, value]) => value), nowIso(), cat.id);
    }
    // Per-priority resolution targets, e.g. { "High": 8, "Medium": 24 }
    const targets = req.body?.targets;
    if (targets && typeof targets === 'object') {
      for (const [priority, hours] of Object.entries(targets as Record<string, unknown>)) {
        if (!COMPLAINT_PRIORITIES.includes(priority as any)) throw badRequest(`Unknown priority "${priority}".`);
        const value = Number(hours);
        if (!Number.isFinite(value) || value <= 0) throw badRequest(`Resolution target for ${priority} must be a positive number of hours.`);
        db().run(
          `INSERT INTO complaint_resolution_targets (category_id, priority, resolution_hours) VALUES (?, ?, ?)
           ON CONFLICT(category_id, priority) DO UPDATE SET resolution_hours = excluded.resolution_hours`,
          cat.id,
          priority,
          value,
        );
      }
    }
    if (!set.length && !targets) throw badRequest('No changes provided.');
    audit(req, 'admin.complaint_category_updated', 'complaint_category', cat.id, { fields: set.map(([k]) => k), targets: targets ?? null });
    ok(res, listCategories(false).find((c) => c.id === cat.id), { message: 'Category updated. New complaints use the updated target; deadlines already recorded are unchanged.' });
  }),
);

router.get(
  '/workers',
  route((_req, res) => ok(res, listWorkers(false))),
);

router.post(
  '/workers',
  route((req, res) => {
    const v = new Validator(req.body);
    const name = v.string('name', { max: 120, label: 'Name' });
    const role = v.string('role', { max: 80, label: 'Role' });
    const phone = v.string('phone', { max: 30, label: 'Phone number' });
    const category = v.string('category', { max: 60, label: 'Category' });
    v.done();
    const id = uid('wkr');
    db().run(`INSERT INTO technicians (id, name, role, contact, category, is_active) VALUES (?, ?, ?, ?, ?, 1)`, id, name, role, phone, category);
    audit(req, 'admin.worker_created', 'technician', id, { name, category });
    created(res, listWorkers(false).find((w) => w.id === id), `Worker ${name} added for ${category}.`);
  }),
);

router.patch(
  '/workers/:id',
  route((req, res) => {
    const worker = db().get<any>('SELECT * FROM technicians WHERE id = ?', req.params.id);
    if (!worker) throw notFound('Worker');
    const v = new Validator(req.body);
    const name = v.string('name', { required: false, max: 120 });
    const role = v.string('role', { required: false, max: 80 });
    const phone = v.string('phone', { required: false, max: 30 });
    const category = v.string('category', { required: false, max: 60 });
    const isActive = req.body?.isActive === undefined ? undefined : v.bool('isActive');
    v.done();
    const map: Record<string, unknown> = { name, role, contact: phone, category, is_active: isActive === undefined ? undefined : isActive ? 1 : 0 };
    const set = Object.entries(map).filter(([, value]) => value !== undefined);
    if (!set.length) throw badRequest('No changes provided.');
    db().run(`UPDATE technicians SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...set.map(([, value]) => value), worker.id);
    audit(req, 'admin.worker_updated', 'technician', worker.id, { fields: set.map(([k]) => k) });
    ok(res, listWorkers(false).find((w) => w.id === worker.id), { message: 'Worker updated.' });
  }),
);

export default router;
