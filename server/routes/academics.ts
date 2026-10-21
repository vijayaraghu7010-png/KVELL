import { Router } from 'express';
import { db } from '../db/database';
import { requireRole, type AuthUser } from '../lib/auth';
import { badRequest, forbidden, notFound, ok, route } from '../lib/http';
import { audit, recordEvent } from '../lib/records';
import { assertStudentAccess, canAccessStudent, studentScope } from '../lib/scope';
import { nowIso, uid, yearLabel } from '../lib/util';
import { Validator } from '../lib/validate';

const router = Router();

export const ASSESSMENTS = ['Internal 1', 'Internal 2', 'Internal 3', 'Model Exam', 'Semester Exam'] as const;
const WRITERS = ['Adviser', 'HOD', 'Admin'] as const;

function mapRecord(r: any) {
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    regNumber: r.reg_number,
    department: r.department_code,
    year: yearLabel(r.year),
    academicYear: r.academic_year,
    semester: r.semester,
    assessment: r.assessment,
    percentage: r.percentage,
    sgpa: r.sgpa,
    arrears: r.arrears,
    remarks: r.remarks,
    source: r.source,
    enteredBy: r.entered_by_name,
    updatedAt: r.updated_at,
  };
}

const RECORD_SELECT = `ar.*, s.name AS student_name, s.reg_number, s.department_code, s.year, u.name AS entered_by_name
  FROM academic_records ar JOIN students s ON s.id = ar.student_id JOIN users u ON u.id = ar.entered_by`;

router.get(
  '/records',
  requireRole('Adviser', 'HOD', 'Dean', 'Admin', 'Warden'),
  route((req, res) => {
    const scope = studentScope(req.user!);
    const where = [scope.sql];
    const params: unknown[] = [...scope.params];
    if (req.query.studentId) {
      where.push('ar.student_id = ?');
      params.push(String(req.query.studentId));
    }
    if (req.query.department) {
      where.push('s.department_code = ?');
      params.push(String(req.query.department));
    }
    ok(res, db().all(`SELECT ${RECORD_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.name, ar.academic_year, ar.semester`, ...params).map(mapRecord));
  }),
);

interface RecordInput {
  studentId: string;
  academicYear: string;
  semester: number;
  assessment: string;
  percentage: number;
  sgpa: number | null;
  arrears: number;
  remarks: string | null;
}

function validateRecord(raw: any, label = ''): RecordInput {
  const v = new Validator(raw);
  const out = {
    studentId: v.string('studentId', { max: 80, label: `${label}Student` })!,
    academicYear: v.string('academicYear', { max: 9, label: `${label}Academic year` })!,
    semester: v.int('semester', { min: 1, max: 10, label: `${label}Semester` })!,
    assessment: v.oneOf('assessment', ASSESSMENTS, { label: `${label}Assessment` })!,
    percentage: v.number('percentage', { min: 0, max: 100, label: `${label}Percentage` })!,
    sgpa: v.number('sgpa', { required: false, min: 0, max: 10, label: `${label}SGPA` }) ?? null,
    arrears: v.int('arrears', { required: false, min: 0, max: 60, label: `${label}Arrears` }) ?? 0,
    remarks: v.string('remarks', { required: false, max: 500 }) ?? null,
  };
  v.check(!out.academicYear || /^\d{4}-\d{2}$/.test(out.academicYear), 'academicYear', `${label}Academic year must look like 2026-27.`);
  v.done();
  return out;
}

function upsertRecord(user: AuthUser, rec: RecordInput, source: 'manual' | 'import') {
  const existing = db().get<any>(
    'SELECT * FROM academic_records WHERE student_id = ? AND academic_year = ? AND semester = ? AND assessment = ?',
    rec.studentId,
    rec.academicYear,
    rec.semester,
    rec.assessment,
  );
  const now = nowIso();
  if (existing) {
    db().run(
      'UPDATE academic_records SET percentage = ?, sgpa = ?, arrears = ?, remarks = ?, source = ?, entered_by = ?, updated_at = ? WHERE id = ?',
      rec.percentage,
      rec.sgpa,
      rec.arrears,
      rec.remarks,
      source,
      user.id,
      now,
      existing.id,
    );
    recordEvent('academic_record', existing.id, user.id, 'corrected', { note: `${existing.percentage}% → ${rec.percentage}%` });
    return { id: existing.id, updated: true };
  }
  const id = uid('acr');
  db().run(
    `INSERT INTO academic_records (id, student_id, academic_year, semester, assessment, percentage, sgpa, arrears, remarks, source, entered_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    rec.studentId,
    rec.academicYear,
    rec.semester,
    rec.assessment,
    rec.percentage,
    rec.sgpa,
    rec.arrears,
    rec.remarks,
    source,
    user.id,
    now,
    now,
  );
  recordEvent('academic_record', id, user.id, 'entered', { note: `${rec.percentage}%` });
  return { id, updated: false };
}

router.post(
  '/records',
  requireRole(...WRITERS),
  route((req, res) => {
    const rec = validateRecord(req.body);
    assertStudentAccess(req.user!, rec.studentId);
    const result = db().transaction(() => upsertRecord(req.user!, rec, 'manual'));
    audit(req, result.updated ? 'academic.record_corrected' : 'academic.record_entered', 'academic_record', result.id, rec);
    ok(res, mapRecord(db().get(`SELECT ${RECORD_SELECT} WHERE ar.id = ?`, result.id)), { message: result.updated ? 'Existing record corrected.' : 'Academic record saved.' });
  }),
);

/**
 * CSV import: header `reg_number,academic_year,semester,assessment,percentage,sgpa,arrears,remarks`.
 * All rows are validated first; nothing is written unless every row is valid and in the caller's scope.
 */
router.post(
  '/import',
  requireRole(...WRITERS),
  route((req, res) => {
    const v = new Validator(req.body);
    const csv = v.string('csv', { max: 2_000_000, label: 'CSV content' });
    const dryRun = v.bool('dryRun');
    v.done();
    const lines = csv!.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) throw badRequest('The file needs a header row and at least one data row.');
    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const required = ['reg_number', 'academic_year', 'semester', 'assessment', 'percentage'];
    const missing = required.filter((h) => !header.includes(h));
    if (missing.length) throw badRequest(`Missing column(s): ${missing.join(', ')}.`);
    if (lines.length > 5001) throw badRequest('Import at most 5000 rows at a time.');
    const errors: { line: number; message: string }[] = [];
    const parsed: RecordInput[] = [];
    lines.slice(1).forEach((line, i) => {
      const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const row = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? '']));
      const student = db().get<any>('SELECT id FROM students WHERE reg_number = ?', row.reg_number);
      if (!student) return errors.push({ line: i + 2, message: `Unknown register number "${row.reg_number}".` });
      if (!canAccessStudent(req.user!, student.id)) return errors.push({ line: i + 2, message: `${row.reg_number} is outside your authorized students.` });
      try {
        parsed.push(
          validateRecord(
            { studentId: student.id, academicYear: row.academic_year, semester: row.semester, assessment: row.assessment, percentage: row.percentage, sgpa: row.sgpa || undefined, arrears: row.arrears || undefined, remarks: row.remarks || undefined },
            `Line ${i + 2}: `,
          ),
        );
      } catch (err: any) {
        errors.push({ line: i + 2, message: err.message });
      }
    });
    if (errors.length) return res.status(422).json({ success: false, error: 'validation_error', message: `${errors.length} row(s) have problems. Nothing was imported.`, details: { errors } });
    if (dryRun) return ok(res, { valid: parsed.length }, { message: `${parsed.length} row(s) are valid and ready to import.` });
    const summary = db().transaction(() => {
      let created = 0;
      let updated = 0;
      for (const rec of parsed) (upsertRecord(req.user!, rec, 'import').updated ? updated++ : created++);
      return { created, updated };
    });
    audit(req, 'academic.imported', 'academic_record', undefined, summary);
    ok(res, summary, { message: `Imported ${summary.created} new and corrected ${summary.updated} existing record(s).` });
  }),
);

router.delete(
  '/records/:id',
  requireRole('HOD', 'Admin', 'Adviser'),
  route((req, res) => {
    const r = db().get<any>('SELECT * FROM academic_records WHERE id = ?', req.params.id);
    if (!r || !canAccessStudent(req.user!, r.student_id)) throw notFound('Academic record');
    if (req.user!.role === 'Adviser' && r.entered_by !== req.user!.id) throw forbidden('Advisers can delete only records they entered.');
    db().run('DELETE FROM academic_records WHERE id = ?', r.id);
    recordEvent('academic_record', r.id, req.user!.id, 'deleted', { note: `${r.assessment} sem ${r.semester}: ${r.percentage}%` });
    audit(req, 'academic.record_deleted', 'academic_record', r.id, r);
    ok(res, null, { message: 'Academic record deleted.' });
  }),
);

export default router;
