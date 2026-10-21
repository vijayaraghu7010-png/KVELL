/**
 * Backfills the section-based routing introduced in migration 003 for databases
 * that already hold demo data.
 *
 *   npm run demo:sections
 *
 * - Spreads students of each department across the sections that department runs.
 * - Makes the first teacher of a department the Class Incharge of each section,
 *   skipping any section that already has one.
 * - Only touches rows that have no value yet; it never reassigns anybody.
 */
import 'dotenv/config';
import { db } from '../db/database';
import { nowIso, uid } from '../lib/util';

const d = db();
const now = nowIso();

let sectionsSet = 0;
let inchargesSet = 0;

d.transaction(() => {
  for (const dept of d.all<any>('SELECT code, sections FROM departments WHERE is_active = 1 ORDER BY code')) {
    const sections = String(dept.sections || 'A')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!sections.length) continue;

    const students = d.all<any>('SELECT id FROM students WHERE department_code = ? AND section IS NULL ORDER BY reg_number', dept.code);
    students.forEach((s, i) => {
      d.run('UPDATE students SET section = ?, updated_at = ? WHERE id = ?', sections[i % sections.length], now, s.id);
      sectionsSet++;
    });

    const teachers = d.all<any>(`SELECT id, name FROM users WHERE role = 'Adviser' AND is_active = 1 AND department_code = ? ORDER BY created_at`, dept.code);
    sections.forEach((section, i) => {
      const held = d.get(`SELECT 1 FROM class_incharges WHERE is_active = 1 AND department_code = ? AND section = ?`, dept.code, section);
      const teacher = teachers[i];
      if (held || !teacher) return;
      // A teacher holds at most one section, so skip anybody already assigned.
      if (d.get('SELECT 1 FROM class_incharges WHERE user_id = ? AND is_active = 1', teacher.id)) return;
      d.run(
        `INSERT INTO class_incharges (id, user_id, department_code, section, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        uid('cin'),
        teacher.id,
        dept.code,
        section,
        now,
        now,
      );
      inchargesSet++;
      console.log(`${dept.code} Section ${section} -> ${teacher.name}`);
    });
  }
});

console.log(`\nSections assigned to ${sectionsSet} student(s); ${inchargesSet} Class Incharge assignment(s) created.`);
const gaps = d.all<any>(
  `SELECT d.code, d.sections FROM departments d WHERE d.is_active = 1
     AND EXISTS (SELECT 1 FROM students s WHERE s.department_code = d.code)`,
);
for (const g of gaps) {
  for (const section of String(g.sections).split(',').map((x) => x.trim())) {
    if (!d.get('SELECT 1 FROM class_incharges WHERE is_active = 1 AND department_code = ? AND section = ?', g.code, section)) {
      console.log(`! ${g.code} Section ${section} still has no Class Incharge — assign one in Admin → Class Incharges.`);
    }
  }
}
