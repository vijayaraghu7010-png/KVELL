/**
 * Backfills the fields migration 004 introduced, for databases that already hold data.
 *
 *   npm run demo:advisers
 *
 * - Gives every Adviser without one a Student Category / Responsibility (default
 *   Hosteller, override with --category "Out / Day Scholar").
 * - Assigns unowned study sessions to a Hosteller Adviser, preferring the adviser of
 *   the students the session covers, so the start/end controls have an owner.
 * It never changes a value that is already set.
 */
import 'dotenv/config';
import { db } from '../db/database';
import { nowIso } from '../lib/util';

const d = db();
const now = nowIso();
const argCategory = process.argv.includes('--category') ? process.argv[process.argv.indexOf('--category') + 1] : 'Hosteller';
if (!['Hosteller', 'Out / Day Scholar'].includes(argCategory)) {
  console.error(`--category must be "Hosteller" or "Out / Day Scholar" (got "${argCategory}").`);
  process.exit(1);
}

const advisers = d.all<any>(`SELECT id, name FROM users WHERE role = 'Adviser' AND student_category IS NULL`);
for (const a of advisers) {
  d.run('UPDATE users SET student_category = ?, updated_at = ? WHERE id = ?', argCategory, now, a.id);
  console.log(`${a.name} -> ${argCategory}`);
}

const sessions = d.all<any>(`SELECT id, title, department_code, year, block FROM study_sessions WHERE adviser_user_id IS NULL AND status != 'Cancelled'`);
let assigned = 0;
for (const s of sessions) {
  // Prefer an adviser who already looks after students matching the session's filters.
  const owner =
    d.get<any>(
      `SELECT u.id, u.name, COUNT(st.id) AS n FROM users u JOIN students st ON st.adviser_user_id = u.id
       WHERE u.role = 'Adviser' AND u.is_active = 1 AND u.student_category = 'Hosteller' AND st.is_hosteller = 1
         AND (? IS NULL OR st.department_code = ?) AND (? IS NULL OR st.year = ?)
       GROUP BY u.id ORDER BY n DESC LIMIT 1`,
      s.department_code,
      s.department_code,
      s.year,
      s.year,
    ) ?? d.get<any>(`SELECT id, name FROM users WHERE role = 'Adviser' AND is_active = 1 AND student_category = 'Hosteller' ORDER BY created_at LIMIT 1`);
  if (!owner) {
    console.log(`! ${s.id} "${s.title}" has no Hosteller Adviser to assign.`);
    continue;
  }
  d.run('UPDATE study_sessions SET adviser_user_id = ?, updated_at = ? WHERE id = ?', owner.id, now, s.id);
  assigned++;
  console.log(`${s.id} "${s.title}" -> ${owner.name}`);
}

console.log(`\n${advisers.length} adviser(s) given a responsibility; ${assigned} study session(s) assigned an Adviser.`);
const missingParent = d.get<{ c: number }>(`SELECT COUNT(*) AS c FROM students WHERE enrollment_status = 'Active' AND (parent_phone IS NULL OR parent_phone = '')`)!.c;
if (missingParent) console.log(`! ${missingParent} active student(s) have no parent/guardian phone number and cannot submit an outing request until one is added.`);
