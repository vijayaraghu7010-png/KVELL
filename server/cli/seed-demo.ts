/**
 * Loads clearly-labelled DEMONSTRATION data for local evaluation.
 *
 *   npm run db:seed-demo
 *
 * - Never runs automatically and never deletes or overwrites existing records.
 * - Every demo account/student/room is flagged is_demo = 1 and the UI shows a "Demo data" banner.
 * - All demo accounts share the password in DEMO_PASSWORD (default below). Do not use in production.
 */
import 'dotenv/config';
import { db } from '../db/database';
import { getUserById, hashPassword } from '../lib/auth';
import { addDays, localDate, nowIso, uid } from '../lib/util';
import { createLeave, hodDecideLeave, inchargeDecideLeave, wardenDecideLeave, wardenDecideOuting } from '../services/requests';
import { createComplaint, createWorkOrderFromComplaint } from '../services/complaints';
import { closeSession, defaultSession, markAttendance, markStudyAttendance, actOnCase } from '../services/attendance';
import { notify } from '../lib/records';
import { publishWeeklyMenu } from './mess-menu';
import { loadHolidays } from './add-holidays';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';
const d = db();

if (d.get(`SELECT 1 FROM settings WHERE key = 'demo.seeded_at'`)) {
  console.log('Demo data is already loaded. Nothing to do.');
  process.exit(0);
}

const now = nowIso();
const today = localDate();
const hash = hashPassword(DEMO_PASSWORD);

function user(email: string, name: string, role: string, extra: { dept?: string; designation?: string; phone?: string; office?: string; studentCategory?: string } = {}) {
  const existing = d.get<any>('SELECT id FROM users WHERE email = ?', email);
  if (existing) return existing.id as string;
  const id = uid('usr');
  d.run(
    `INSERT INTO users (id, email, password_hash, name, role, department_code, phone, designation, office, student_category, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id,
    email,
    hash,
    name,
    role,
    extra.dept ?? null,
    extra.phone ?? null,
    extra.designation ?? null,
    extra.office ?? null,
    // Advisers must declare whose sessions they run; the second CSE adviser handles day scholars.
    role === 'Adviser' ? extra.studentCategory ?? 'Hosteller' : null,
    now,
    now,
  );
  return id;
}

d.transaction(() => {
  // Departments
  const depts: [string, string][] = [
    ['CSE', 'Computer Science & Engineering'],
    ['ECE', 'Electronics & Communication Engineering'],
    ['EEE', 'Electrical & Electronics Engineering'],
    ['MECH', 'Mechanical Engineering'],
    ['IT', 'Information Technology'],
    ['CIVIL', 'Civil Engineering'],
  ];
  for (const [code, name] of depts) d.run('INSERT OR IGNORE INTO departments (code, name, created_at) VALUES (?, ?, ?)', code, name, now);

  // Staff
  user('dean@kvcet.edu.in', 'Dr. S. Meenakshi (Demo)', 'Dean', { designation: 'Dean — Hostel Administration', office: 'Admin Block, Room 201', phone: '+91 94440 10001' });
  user('warden@kvcet.edu.in', 'Dr. Rajesh Kumar (Demo)', 'Warden', { designation: 'Chief Resident Warden', office: 'Hostel Office, Block A', phone: '+91 94441 55667' });
  user('security@kvcet.edu.in', 'Officer R. Sundaram (Demo)', 'Security', { designation: 'Senior Security Desk Officer', office: 'Main Gate Post 1' });
  user('ao@kvcet.edu.in', 'Vikas Malhotra (Demo)', 'AO', { designation: 'Administrative Officer', office: 'Admin Block, Room 102', phone: '+91 98410 77123' });
  user('mess@kvcet.edu.in', 'K. Murugesan (Demo)', 'Mess', { designation: 'Mess In-charge', office: 'Central Dining Hall' });
  user('admin@kvcet.edu.in', 'System Administrator (Demo)', 'Admin', { designation: 'ERP Administrator' });
  const hodNames: Record<string, string> = {
    CSE: 'Dr. K. Anand',
    ECE: 'Dr. P. Lakshmi',
    EEE: 'Dr. R. Senthil',
    MECH: 'Dr. M. Ganesh',
    IT: 'Dr. V. Priya',
    CIVIL: 'Dr. A. Baskar',
  };
  const hods: Record<string, string> = {};
  for (const [code] of depts) hods[code] = user(`hod.${code.toLowerCase()}@kvcet.edu.in`, `${hodNames[code]} (Demo)`, 'HOD', { dept: code, designation: `Professor & Head, ${code}` });
  const advisers: Record<string, string[]> = {
    CSE: [user('adviser.cse1@kvcet.edu.in', 'Dr. C. Natarajan (Demo)', 'Adviser', { dept: 'CSE', designation: 'Associate Professor' }), user('adviser.cse2@kvcet.edu.in', 'Ms. R. Divya (Demo)', 'Adviser', { dept: 'CSE', designation: 'Assistant Professor', studentCategory: 'Out / Day Scholar' })],
    ECE: [
      user('adviser.ece1@kvcet.edu.in', 'Mr. S. Arul (Demo)', 'Adviser', { dept: 'ECE', designation: 'Assistant Professor' }),
      user('adviser.ece2@kvcet.edu.in', 'Ms. P. Latha (Demo)', 'Adviser', { dept: 'ECE', designation: 'Assistant Professor' }),
    ],
    EEE: [
      user('adviser.eee1@kvcet.edu.in', 'Ms. T. Kavitha (Demo)', 'Adviser', { dept: 'EEE', designation: 'Assistant Professor' }),
      user('adviser.eee2@kvcet.edu.in', 'Mr. V. Saravanan (Demo)', 'Adviser', { dept: 'EEE', designation: 'Assistant Professor' }),
    ],
    MECH: [
      user('adviser.mech1@kvcet.edu.in', 'Mr. J. Prakash (Demo)', 'Adviser', { dept: 'MECH', designation: 'Assistant Professor' }),
      user('adviser.mech2@kvcet.edu.in', 'Mr. A. Manoj (Demo)', 'Adviser', { dept: 'MECH', designation: 'Assistant Professor' }),
    ],
    IT: [
      user('adviser.it1@kvcet.edu.in', 'Ms. N. Revathi (Demo)', 'Adviser', { dept: 'IT', designation: 'Assistant Professor' }),
      user('adviser.it2@kvcet.edu.in', 'Ms. K. Sangeetha (Demo)', 'Adviser', { dept: 'IT', designation: 'Assistant Professor' }),
    ],
    CIVIL: [
      user('adviser.civil1@kvcet.edu.in', 'Mr. B. Ramesh (Demo)', 'Adviser', { dept: 'CIVIL', designation: 'Assistant Professor' }),
      user('adviser.civil2@kvcet.edu.in', 'Mr. D. Senthil (Demo)', 'Adviser', { dept: 'CIVIL', designation: 'Assistant Professor' }),
    ],
  };

  // Rooms
  const rooms: string[] = [];
  for (const block of ['A', 'B', 'C']) {
    for (const floor of [1, 2, 3]) {
      for (const n of [1, 2, 3]) {
        const num = `${block}-${floor}0${n}`;
        const id = uid('room');
        d.run(
          `INSERT OR IGNORE INTO rooms (id, room_number, block, floor, capacity, room_type, amenities_json, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          id,
          num,
          `Block ${block}`,
          floor,
          n === 1 ? 2 : 3,
          n === 1 ? 'Double' : 'Triple',
          JSON.stringify(['Study table', 'Wardrobe', n === 3 ? 'Attached bath' : 'Common bath']),
          now,
        );
        rooms.push(d.get<any>('SELECT id FROM rooms WHERE room_number = ?', num).id);
      }
    }
  }

  // Students (names reused from the original prototype screens)
  const names = [
    'Rahul Sharma', 'Alex Johnson', 'David Kim', 'Zoe Smith', 'Priya S', 'Arun K', 'Divya L', 'Vikram K', 'Lavanya T', 'Karthik M',
    'Meena P', 'Suresh B', 'Anitha G', 'Naveen D', 'Harini V', 'Dinesh S', 'Swathi R', 'Gokul N', 'Nandhini A', 'Arjun P',
    'Keerthi S', 'Mohan J', 'Pooja C', 'Bharath K', 'Sneha M', 'Yogesh T', 'Janani L', 'Prakash V', 'Revathi D', 'Sanjay P',
  ];
  const deptCycle = ['CSE', 'CSE', 'ECE', 'CSE', 'EEE', 'ECE', 'MECH', 'IT', 'CIVIL', 'CSE'];
  let roomIdx = 0;
  let roomFill = 0;
  names.forEach((name, i) => {
    const dept = deptCycle[i % deptCycle.length];
    const year = (i % 4) + 1;
    const reg = i === 0 ? '22CS089' : `${26 - year}${dept}${String(100 + i).padStart(3, '0')}`;
    const email = i === 0 ? 'student@kvcet.edu.in' : `${name.toLowerCase().replace(/[^a-z]/g, '.')}.${reg.toLowerCase()}@kvcet.edu.in`;
    const uidv = user(email, `${name} (Demo)`, 'Student');
    const advList = advisers[dept];
    const capacity = d.get<any>('SELECT capacity FROM rooms WHERE id = ?', rooms[roomIdx]).capacity;
    if (roomFill >= capacity) {
      roomIdx++;
      roomFill = 0;
    }
    roomFill++;
    d.run(
      `INSERT OR IGNORE INTO students (id, user_id, reg_number, name, department_code, year, semester, gender, phone, email, address, parent_name, parent_phone, room_id, adviser_user_id, section, admission_year, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      uid('stu'),
      uidv,
      reg,
      `${name} (Demo)`,
      dept,
      year,
      year * 2,
      i % 3 === 1 ? 'Female' : 'Male',
      `+91 98${String(76500000 + i * 1371).slice(0, 8)}`,
      email,
      `${10 + i}, Demo Street, Chennai`,
      `Parent of ${name.split(' ')[0]}`,
      `+91 94${String(43100000 + i * 977).slice(0, 8)}`,
      rooms[roomIdx],
      advList[i % advList.length],
      i % 2 === 0 ? 'A' : 'B',
      2026 - year,
      now,
      now,
    );
  });

  // Class Incharge for each department section (section A -> first adviser, B -> second).
  for (const [dept, list] of Object.entries(advisers)) {
    ['A', 'B'].forEach((section, idx) => {
      const userId = list[idx];
      if (!userId) return; // a department without a second teacher simply has no Section B incharge
      d.run(
        `INSERT INTO class_incharges (id, user_id, department_code, section, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        uid('cin'),
        userId,
        dept,
        section,
        now,
        now,
      );
    });
  }

  // Technicians
  for (const [name, role, contact, category] of [
    ['M. Selvam', 'Chief Electrician', '+91 98412 44321', 'Electrical'],
    ['K. Rajan', 'Senior Plumber', '+91 94443 22119', 'Plumbing'],
    ['P. Murugan', 'Campus Carpenter', '+91 97891 00456', 'Carpentry'],
    ['G. Vignesh', 'Network Engineer', '+91 99405 88990', 'Wi-Fi / LAN'],
    ['R. Senthil', 'Facility Supervisor', '+91 98402 11987', 'Housekeeping'],
    ['N. Duraipandi', 'Civil Mason Contractor', '+91 94441 55667', 'Civil / Masonry'],
  ]) {
    d.run('INSERT INTO technicians (id, name, role, contact, category, is_demo) VALUES (?, ?, ?, ?, ?, 1)', uid('tech'), `${name} (Demo)`, role, contact, category);
  }

  publishWeeklyMenu(now);

  // The Tamil Nadu holiday list is institutional data, not demo data, but a fresh
  // database needs it for the portal calendars to mean anything.
  loadHolidays();
});

// ---------------------------------------------------------------------------
// Workflow records created through the real services so histories are consistent.
// ---------------------------------------------------------------------------
const byEmail = (e: string) => getUserById(d.get<any>('SELECT id FROM users WHERE email = ?', e).id)!;
const warden = byEmail('warden@kvcet.edu.in');
const dean = byEmail('dean@kvcet.edu.in');
const studentRows = d.all<any>(`SELECT s.id, s.user_id, s.department_code, s.adviser_user_id FROM students s WHERE s.is_demo = 1 ORDER BY s.reg_number`);
const asUser = (id: string) => getUserById(id)!;

// Leave requests in different stages
const inchargeOfLeave = (leaveId: string) => asUser(d.get<any>('SELECT incharge_id FROM leave_requests WHERE id = ?', leaveId).incharge_id);
const hodOfLeave = (leaveId: string) => asUser(d.get<any>('SELECT hod_id FROM leave_requests WHERE id = ?', leaveId).hod_id);

// Stage 1: waiting on the Class Incharge.
const rahul = d.get<any>(`SELECT id, user_id FROM students WHERE reg_number = '22CS089'`);
const l1 = createLeave(asUser(rahul.user_id), rahul.id, { leaveType: 'Family Function', fromDate: addDays(today, 3), toDate: addDays(today, 5), reason: 'Sister’s engagement ceremony at home town (demo).' });
void l1;
// Stage 2: Class Incharge approved, waiting on the HOD.
const s2 = studentRows[1];
const l2 = createLeave(asUser(s2.user_id), s2.id, { leaveType: 'Medical Leave', fromDate: addDays(today, 1), toDate: addDays(today, 2), reason: 'Dental surgery follow-up appointment (demo).' });
inchargeDecideLeave(inchargeOfLeave(l2.id), l2.id, 'Approved', 'Medical certificate seen (demo).');
// Stage 3 and final approval: the full chain.
const s3 = studentRows[2];
const l3 = createLeave(asUser(s3.user_id), s3.id, { leaveType: 'Personal Leave', fromDate: today, toDate: addDays(today, 1), reason: 'Passport verification appointment (demo).' });
inchargeDecideLeave(inchargeOfLeave(l3.id), l3.id, 'Approved', 'OK (demo).');
hodDecideLeave(hodOfLeave(l3.id), l3.id, 'Approved', 'Department has no objection (demo).');
wardenDecideLeave(warden, l3.id, 'Approved', 'Return before 8 PM on the last day (demo).');
// Stage 4: waiting on the Warden, so the Warden queue is not empty.
const s4 = studentRows[3];
const l4 = createLeave(asUser(s4.user_id), s4.id, { leaveType: 'Academic / Event', fromDate: addDays(today, 6), toDate: addDays(today, 7), reason: 'Inter-college symposium presentation (demo).' });
inchargeDecideLeave(inchargeOfLeave(l4.id), l4.id, 'Approved', 'Selected for the event (demo).');
hodDecideLeave(hodOfLeave(l4.id), l4.id, 'Approved', 'Representing the department (demo).');

// Outings: Student -> Parent/Guardian (WhatsApp) -> Warden
const insertOuting = (sid: string, dest: string, hoursFromNow: number, durationH: number, status: string) => {
  const id = `OUT-DEMO-${uid('x').slice(-5)}`;
  const out = new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
  const ret = new Date(Date.now() + (hoursFromNow + durationH) * 3_600_000).toISOString();
  const parentApproved = status !== 'Parent Approval Pending';
  d.run(
    `INSERT INTO outing_requests (id, student_id, outing_type, destination, reason, out_at, expected_return_at, status, location_consent,
      parent_phone, parent_decision, parent_decided_at, created_at, updated_at)
     VALUES (?, ?, 'Shopping', ?, 'Personal purchases (demo).', ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    id,
    sid,
    dest,
    out,
    ret,
    status,
    d.get<any>('SELECT parent_phone FROM students WHERE id = ?', sid)?.parent_phone ?? null,
    parentApproved ? 'Approved' : null,
    parentApproved ? nowIso() : null,
    nowIso(),
    nowIso(),
  );
  return id;
};
// Waiting on the guardian — invisible to the Warden until they answer.
insertOuting(studentRows[4].id, 'Kanchipuram Town', 20, 4, 'Parent Approval Pending');
// Guardian approved, now in the Warden's queue.
insertOuting(studentRows[8].id, 'District Hospital', 26, 3, 'Pending Warden');
// Guardian approved and the Warden approved it too.
const o2 = insertOuting(studentRows[5].id, 'City Library', 2, 3, 'Pending Warden');
wardenDecideOuting(warden, o2, 'Approved', 'Return by curfew (demo).');

// Complaints → work order / escalation
const c1 = createComplaint(asUser(rahul.user_id), rahul.id, {
  categoryId: 'ccat_water',
  title: 'Low water pressure in the west wing washroom (demo)',
  priority: 'High',
  description: 'Low water pressure in the 3rd floor west wing washroom (demo).',
  location: 'Block B, 3rd floor washroom',
});
createWorkOrderFromComplaint(warden, c1.id, { remarks: 'Booster pump inspection needed (demo).', targetDate: addDays(today, 2) });
const c2 = createComplaint(asUser(studentRows[6].user_id), studentRows[6].id, {
  categoryId: 'ccat_electrical',
  title: 'Tube light flickering in the study area (demo)',
  priority: 'Medium',
  description: 'Tube light flickering in study area (demo).',
  location: 'Block A, Room A-201',
});
void c2;
// Already past its deadline, so the escalation job picks it up on the next tick.
const c3 = createComplaint(asUser(studentRows[7].user_id), studentRows[7].id, {
  categoryId: 'ccat_room',
  title: 'Ceiling seepage above the study desk (demo)',
  priority: 'High',
  description: 'Ceiling seepage above the study desk (demo).',
  location: 'Block C, Room C-302',
});
d.run(`UPDATE complaints SET deadline_at = ? WHERE id = ?`, addDays(today, -1) + 'T00:00:00.000Z', c3.id);
// A complaint about the Warden: routed to the AO, never shown to the Warden.
createComplaint(asUser(studentRows[8].user_id), studentRows[8].id, {
  categoryId: 'ccat_warden',
  title: 'Request for review of hostel curfew handling (demo)',
  priority: 'High',
  description: 'Asking the Administrative Officer to review how an evening curfew exception was handled (demo).',
  location: 'Hostel Office',
});

// Hostel attendance for the last 7 days, with a few absences
const session = defaultSession();
for (let back = 6; back >= 0; back--) {
  const date = addDays(today, -back);
  const entries = studentRows.map((s, i) => ({ studentId: s.id, status: (i + back) % 11 === 3 ? ('Absent' as const) : ('Present' as const) }));
  markAttendance(warden, date, session, entries);
  if (back > 0) closeSession(warden, date, session, 'Demo roll call');
}
// Verify some suspected absences
const suspected = d.all<any>(`SELECT id FROM absence_cases WHERE status = 'Suspected Unauthorized' ORDER BY att_date LIMIT 4`);
suspected.forEach((c, i) => actOnCase(warden, c.id, i % 2 === 0 ? 'verify_unauthorized' : 'authorize', i % 2 === 0 ? 'Student confirmed absent without permission (demo).' : 'Parent confirmed emergency visit (demo).'));

// Study sessions are conducted by a Hosteller Adviser, for their own advisees.
const sessionAdviser = asUser(d.get<any>(`SELECT id FROM users WHERE email = 'adviser.cse1@kvcet.edu.in'`).id);
const sessionStudents = d.all<any>('SELECT id FROM students WHERE adviser_user_id = ?', sessionAdviser.id);
for (let back = 12; back >= 2; back -= 2) {
  const date = addDays(today, -back);
  const id = `STS-DEMO-${back}`;
  d.run(
    `INSERT INTO study_sessions (id, title, session_date, start_time, end_time, location, adviser_user_id, status, started_at, ended_at, reconciled_at, notes, created_by, created_at, updated_at)
     VALUES (?, 'Evening Study Hour', ?, '18:00', '19:30', 'Block A Reading Hall', ?, 'Completed', ?, ?, ?, 'Demo session', ?, ?, ?)`,
    id,
    date,
    sessionAdviser.id,
    `${date}T12:30:00.000Z`,
    `${date}T14:00:00.000Z`,
    `${date}T14:00:00.000Z`,
    sessionAdviser.id,
    nowIso(),
    nowIso(),
  );
  markStudyAttendance(
    sessionAdviser,
    id,
    sessionStudents.map((st, i) => ({ studentId: st.id, status: (i * 3 + back) % 7 === 0 ? ('Absent' as const) : (i + back) % 9 === 0 ? ('Late' as const) : ('Present' as const) })),
  );
}
d.run(
  `INSERT INTO study_sessions (id, title, session_date, start_time, end_time, location, adviser_user_id, status, notes, created_by, created_at, updated_at)
   VALUES ('STS-DEMO-NEXT', 'Evening Study Hour', ?, '18:00', '19:30', 'Block A Reading Hall', ?, 'Scheduled', 'Demo session', ?, ?, ?)`,
  addDays(today, 1),
  sessionAdviser.id,
  sessionAdviser.id,
  nowIso(),
  nowIso(),
);

// Academic records (demo) for two assessments
d.transaction(() => {
  studentRows.forEach((s, i) => {
    const base = 45 + ((i * 13) % 45);
    const second = Math.max(20, Math.min(98, base + ((i % 5) - 2) * 6));
    for (const [assessment, pct] of [
      ['Internal 1', base],
      ['Internal 2', second],
    ] as const) {
      d.run(
        `INSERT OR IGNORE INTO academic_records (id, student_id, academic_year, semester, assessment, percentage, arrears, remarks, source, entered_by, created_at, updated_at)
         VALUES (?, ?, '2026-27', ?, ?, ?, ?, 'Demo data', 'manual', ?, ?, ?)`,
        uid('acr'),
        s.id,
        ((i % 4) + 1) * 2 - 1,
        assessment,
        pct,
        pct < 40 ? 1 : 0,
        s.adviser_user_id,
        nowIso(),
        nowIso(),
      );
    }
  });
});

// Incident
d.run(
  `INSERT INTO incidents (id, student_id, category, severity, status, incident_at, location, description, action_taken, reported_by, created_at, updated_at)
   VALUES ('INC-DEMO-001', ?, 'Curfew Violation', 'Medium', 'Pending Review', ?, 'Main Gate', 'Returned 75 minutes after curfew without prior intimation (demo).', 'Parent informed; written explanation requested.', ?, ?, ?)`,
  studentRows[8].id,
  new Date(Date.now() - 20 * 3_600_000).toISOString(),
  warden.id,
  nowIso(),
  nowIso(),
);

d.run(`INSERT INTO settings (key, value, description, updated_at) VALUES ('demo.seeded_at', ?, 'Demo data was loaded with npm run db:seed-demo', ?)`, nowIso(), nowIso());
notify([dean.id], { eventType: 'system.demo', title: 'Demo data loaded', message: 'This environment contains demonstration records only.', severity: 'info' });

console.log('Demo data loaded.');
console.log(`All demo accounts use the password: ${DEMO_PASSWORD}`);
console.log('Accounts: dean@ / warden@ / security@ / ao@ / mess@ / admin@ / hod.cse@ / adviser.cse1@ / student@ (all @kvcet.edu.in)');
