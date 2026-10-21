import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Database, setDatabase } from '../server/db/database';
import { hashPassword } from '../server/lib/auth';
import { createApp } from '../server/app';
import { nowIso, uid } from '../server/lib/util';

process.env.NODE_ENV = 'test';
export const PASSWORD = 'Test@12345';

export interface Fixture {
  ids: Record<string, string>;
  students: Record<string, string>;
  rooms: Record<string, string>;
}

/** Minimal, deterministic fixture: two departments, staff for every role, four students. */
function seed(db: Database): Fixture {
  const now = nowIso();
  const hash = hashPassword(PASSWORD);
  const ids: Record<string, string> = {};
  db.run(`INSERT INTO departments (code, name, created_at) VALUES ('CSE', 'Computer Science', ?), ('ECE', 'Electronics', ?)`, now, now);
  const user = (key: string, role: string, dept: string | null = null, studentCategory: string | null = null) => {
    const id = uid('usr');
    db.run(
      `INSERT INTO users (id, email, password_hash, name, role, department_code, student_category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      `${key}@test.local`,
      hash,
      `User ${key}`,
      role,
      dept,
      role === 'Adviser' ? studentCategory ?? 'Hosteller' : null,
      now,
      now,
    );
    ids[key] = id;
  };
  user('dean', 'Dean');
  user('warden', 'Warden');
  user('security', 'Security');
  user('ao', 'AO');
  user('mess', 'Mess');
  user('admin', 'Admin');
  user('hodCse', 'HOD', 'CSE');
  user('hodEce', 'HOD', 'ECE');
  user('advCse', 'Adviser', 'CSE', 'Hosteller');
  user('advCse2', 'Adviser', 'CSE', 'Hosteller');
  // Responsible for day scholars: must never get the hostel study-session controls.
  user('advEce', 'Adviser', 'ECE', 'Out / Day Scholar');
  user('stuA', 'Student');
  user('stuB', 'Student');
  user('stuC', 'Student');
  user('stuD', 'Student');
  const rooms: Record<string, string> = {};
  for (const r of ['A-101', 'A-102']) {
    rooms[r] = uid('room');
    db.run(`INSERT INTO rooms (id, room_number, block, floor, capacity, room_type, created_at) VALUES (?, ?, 'Block A', 1, 2, 'Double', ?)`, rooms[r], r, now);
  }
  const students: Record<string, string> = {};
  const student = (key: string, reg: string, dept: string, adviser: string | null, room: string | null, section: string | null) => {
    students[key] = uid('stu');
    db.run(
      `INSERT INTO students (id, user_id, reg_number, name, department_code, year, room_id, adviser_user_id, section, parent_name, parent_phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?)`,
      students[key],
      ids[key],
      reg,
      `Student ${key}`,
      dept,
      room,
      adviser,
      section,
      `Parent of ${key}`,
      `+91 90000 ${String(90000 + Object.keys(students).length).slice(-5)}`,
      now,
      now,
    );
  };
  student('stuA', 'CS001', 'CSE', ids.advCse, rooms['A-101'], 'A');
  student('stuB', 'CS002', 'CSE', ids.advCse2, rooms['A-101'], 'B');
  student('stuC', 'EC001', 'ECE', ids.advEce, rooms['A-102'], 'A');
  // stuD deliberately has no section, so routing failures can be tested.
  student('stuD', 'EC002', 'ECE', null, null, null);

  // Class Incharge per department + section.
  const incharge = (userKey: string, dept: string, section: string) =>
    db.run(`INSERT INTO class_incharges (id, user_id, department_code, section, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`, uid('cin'), ids[userKey], dept, section, now, now);
  incharge('advCse', 'CSE', 'A');
  incharge('advCse2', 'CSE', 'B');
  incharge('advEce', 'ECE', 'A');

  // One worker per trade used by the seeded complaint categories.
  const worker = (name: string, role: string, phone: string, category: string) =>
    db.run(`INSERT INTO technicians (id, name, role, contact, category, is_active) VALUES (?, ?, ?, ?, ?, 1)`, uid('wkr'), name, role, phone, category);
  worker('Plumber One', 'Plumber', '+91 90000 00001', 'Plumbing');
  worker('Electrician One', 'Electrician', '+91 90000 00002', 'Electrical');
  worker('Carpenter One', 'Carpenter', '+91 90000 00003', 'Carpentry');
  worker('Housekeeper One', 'Housekeeping', '+91 90000 00004', 'Housekeeping');

  return { ids, students, rooms };
}

export interface TestContext {
  base: string;
  fx: Fixture;
  db: Database;
  close: () => Promise<void>;
  as: (key: string) => Promise<Client>;
  /** An unauthenticated client, for the parent/guardian approval links. */
  anon: () => Client;
}

export class Client {
  cookie = '';
  constructor(private base: string) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  put = (p: string, b: unknown = {}) => this.req('PUT', p, b);
  patch = (p: string, b: unknown = {}) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);
}

export async function start(): Promise<TestContext> {
  const db = new Database(':memory:');
  db.migrate();
  setDatabase(db);
  const fx = seed(db);
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    fx,
    db,
    close: () => new Promise((r) => server.close(() => r())),
    anon: () => new Client(base),
    as: async (key: string) => {
      const c = new Client(base);
      const res = await c.post('/api/auth/login', { email: `${key}@test.local`, password: PASSWORD });
      if (res.status !== 200) throw new Error(`login ${key} failed: ${JSON.stringify(res.body)}`);
      return c;
    },
  };
}

/** ISO instant `hours` from now. */
export const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

/**
 * Approves an outing the way a parent/guardian would: the approval token is only
 * ever sent over WhatsApp, so tests re-derive the link by re-issuing it and reading
 * the token the service returns when delivery is not configured.
 */
export async function approveOutingAsParent(ctx: TestContext, outingId: string, decision: 'Approved' | 'Rejected' = 'Approved', note?: string) {
  const { issueParentApproval } = await import('../server/services/outings');
  const issued = await issueParentApproval(outingId, null);
  if (!issued.token) throw new Error('No approval token was returned; WhatsApp delivery should be unconfigured in tests.');
  const client = new Client(ctx.base);
  const res = await client.post(`/api/parent/outings/${issued.token}/decision`, { decision, note });
  if (res.status !== 200) throw new Error(`parent decision failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}
