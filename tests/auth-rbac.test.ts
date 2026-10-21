import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, PASSWORD, start, type TestContext } from './helpers';
import { localDate, addDays } from '../server/lib/util';

let ctx: TestContext;
before(async () => {
  ctx = await start();
});
after(async () => ctx.close());

describe('authentication', () => {
  test('rejects unauthenticated API access', async () => {
    const c = new Client(ctx.base);
    const res = await c.get('/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal((await c.get('/api/student/profile')).status, 401);
    assert.equal((await c.get('/api/dean/dashboard')).status, 401);
  });

  test('login sets an HttpOnly session and /me returns the server-side role', async () => {
    const c = new Client(ctx.base);
    const res = await fetch(`${ctx.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'warden@test.local', password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    c.cookie = cookie.split(';')[0];
    const me = await c.get('/api/auth/me');
    assert.equal(me.body.data.role, 'Warden');
    assert.equal(me.body.data.portal, 'warden');
  });

  test('wrong password and wrong role are rejected with the same message', async () => {
    const c = new Client(ctx.base);
    const wrongPw = await c.post('/api/auth/login', { email: 'dean@test.local', password: 'nope-1234' });
    const wrongRole = await c.post('/api/auth/login', { email: 'stuA@test.local', password: PASSWORD, role: 'Dean' });
    const unknown = await c.post('/api/auth/login', { email: 'ghost@test.local', password: PASSWORD });
    for (const r of [wrongPw, wrongRole, unknown]) {
      assert.equal(r.status, 401);
      assert.equal(r.body.message, 'Invalid email, password or role.');
    }
  });

  test('locks the account after repeated failures', async () => {
    const c = new Client(ctx.base);
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: 'mess@test.local', password: 'bad-pass-1' });
    const res = await c.post('/api/auth/login', { email: 'mess@test.local', password: PASSWORD });
    assert.equal(res.status, 423);
    ctx.db.run(`UPDATE users SET locked_until = NULL WHERE email = 'mess@test.local'`);
  });

  test('logout invalidates the session server-side', async () => {
    const c = await ctx.as('security');
    const stolen = c.cookie;
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    const replay = new Client(ctx.base);
    replay.cookie = stolen;
    assert.equal((await replay.get('/api/auth/me')).status, 401);
  });

  test('password change enforces policy, verifies the current password and signs out other sessions', async () => {
    const a = await ctx.as('admin');
    const other = await ctx.as('admin');
    assert.equal((await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' })).status, 400);
    assert.equal((await a.post('/api/auth/change-password', { currentPassword: 'wrong-123', newPassword: 'NewPass123' })).status, 400);
    assert.equal((await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'NewPass123' })).status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 401, 'other session must be signed out');
    assert.equal((await a.get('/api/auth/me')).status, 200, 'current session stays valid');
    // restore
    await a.post('/api/auth/change-password', { currentPassword: 'NewPass123', newPassword: PASSWORD });
  });

  test('cross-origin state-changing requests are rejected', async () => {
    const c = await ctx.as('stuA');
    const res = await c.req('POST', '/api/notifications/read-all', {}, { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });
});

describe('role-based access control', () => {
  test('each portal API is restricted to its role', async () => {
    const student = await ctx.as('stuA');
    for (const p of ['/api/warden/stats', '/api/dean/dashboard', '/api/ao/dashboard', '/api/hod/dashboard', '/api/adviser/dashboard', '/api/admin/users', '/api/security/metrics', '/api/attendance/roll']) {
      assert.equal((await student.get(p)).status, 403, p);
    }
    const hod = await ctx.as('hodCse');
    assert.equal((await hod.get('/api/dean/dashboard')).status, 403);
    assert.equal((await hod.post('/api/work/assignments', {})).status, 403, 'only the Dean creates assignments');
    const warden = await ctx.as('warden');
    assert.equal((await warden.get('/api/dean/hods')).status, 403);
  });

  test('students only see their own requests', async () => {
    const a = await ctx.as('stuA');
    const b = await ctx.as('stuB');
    const created = await a.post('/api/student/leave-requests', { type: 'Personal Leave', fromDate: addDays(localDate(), 2), toDate: addDays(localDate(), 3), reason: 'Visiting home for a family event' });
    assert.equal(created.status, 201);
    const bList = await b.get('/api/student/leave-requests');
    assert.equal(bList.body.data.length, 0);
    // B cannot cancel A's request by ID manipulation
    assert.equal((await b.post(`/api/student/leave-requests/${created.body.data.id}/cancel`)).status, 404);
    // B cannot attach files to A's request
    assert.equal((await b.post('/api/attachments', { entityType: 'leave_request', entityId: created.body.data.id, fileName: 'x.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERg==' })).status, 403);
  });

  test('only the assigned Class Incharge can decide a leave request', async () => {
    const a = await ctx.as('stuA');
    const leave = (await a.post('/api/student/leave-requests', { type: 'Medical Leave', fromDate: addDays(localDate(), 10), toDate: addDays(localDate(), 11), reason: 'Medical appointment in Chennai' })).body.data;
    // advCse2 is the Class Incharge of Section B; this student is in Section A
    const otherIncharge = await ctx.as('advCse2');
    assert.equal((await otherIncharge.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 403);
    assert.ok(!(await otherIncharge.get('/api/adviser/leave-requests')).body.data.some((l: any) => l.id === leave.id));
    assert.ok(!(await otherIncharge.get('/api/adviser/students')).body.data.some((s: any) => s.id === ctx.fx.students.stuA));
    assert.equal((await otherIncharge.get(`/api/adviser/students/${ctx.fx.students.stuA}`)).status, 403);
    const own = await ctx.as('advCse');
    assert.equal((await own.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 200);
  });

  test('HODs are limited to their department', async () => {
    const hod = await ctx.as('hodCse');
    const list = (await hod.get('/api/hod/students')).body.data;
    assert.ok(list.length > 0 && list.every((s: any) => s.department === 'CSE'));
    assert.equal((await hod.get(`/api/hod/students/${ctx.fx.students.stuC}`)).status, 403);
    assert.equal((await hod.get(`/api/attendance/students/${ctx.fx.students.stuC}`)).status, 403);
    // Cannot change their own department through the profile endpoint
    await hod.patch('/api/auth/profile', { department_code: 'ECE', departmentCode: 'ECE' });
    assert.equal((await hod.get('/api/auth/me')).body.data.departmentCode, 'CSE');
  });

  test('notifications are private to each user', async () => {
    // The Class Incharge is the first approver, so the leave submitted above notified them.
    const incharge = await ctx.as('advCse');
    const list = (await incharge.get('/api/notifications')).body.data;
    assert.ok(list.length > 0, 'class incharge received the leave submission notification');
    const warden = await ctx.as('warden');
    assert.ok(!(await warden.get('/api/notifications')).body.data.some((n: any) => n.id === list[0].id));
    const student = await ctx.as('stuB');
    assert.equal((await student.post(`/api/notifications/${list[0].id}/read`)).status, 404);
  });

  test('admin can provision accounts and HOD uniqueness is enforced', async () => {
    const admin = await ctx.as('admin');
    const dup = await admin.post('/api/admin/users', { name: 'Second HOD', email: 'hod2@test.local', role: 'HOD', department: 'CSE', temporaryPassword: 'Temp12345' });
    assert.equal(dup.status, 409);
    // An Adviser account must declare who it is responsible for
    assert.equal((await admin.post('/api/admin/users', { name: 'No Category', email: 'adv-nc@test.local', role: 'Adviser', department: 'ECE', temporaryPassword: 'Temp12345' })).status, 400);
    const ok = await admin.post('/api/admin/users', { name: 'New Adviser', email: 'adv-new@test.local', role: 'Adviser', department: 'ECE', temporaryPassword: 'Temp12345', studentCategory: 'Hosteller' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.mustChangePassword, true);
  });
});
