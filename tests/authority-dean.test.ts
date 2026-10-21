import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localDate } from '../server/lib/util';
import { inHours, start, type TestContext } from './helpers';

let ctx: TestContext;
before(async () => {
  ctx = await start();
});
after(async () => ctx.close());

describe('authority hierarchy', () => {
  test('the order is published, and standing is not the same as access', async () => {
    const dean = await ctx.as('dean');
    const model = (await dean.get('/api/meta/authority')).body.data;
    assert.deepEqual(
      model.order.map((o: any) => o.role),
      ['Dean', 'HOD', 'Adviser', 'AO', 'Warden', 'Security', 'Student'],
    );
    assert.equal(model.order[0].rank, 1);
    assert.equal(model.you.role, 'Dean');
    assert.equal(model.you.rank, 1);
    // The Dean and the Principal remain separate offices
    assert.deepEqual(model.separateOffices, ['Dean', 'Principal']);
    assert.ok(!model.order.some((o: any) => o.role === 'Principal'));
    assert.match(model.note, /does not grant access/i);
    assert.deepEqual(model.deanScope.studentMonitoring, ['study-participation', 'academic-performance', 'uninformed-absence']);

    // Every role sees the same order, with its own rank
    const warden = await ctx.as('warden');
    const wardenModel = (await warden.get('/api/meta/authority')).body.data;
    assert.equal(wardenModel.you.rank, 5);
    assert.deepEqual(wardenModel.order, model.order);
  });

  test('rank does not open other roles’ records or administrative functions', async () => {
    // The Dean is highest, yet still cannot act inside another role's workflow
    const dean = await ctx.as('dean');
    assert.equal((await dean.get('/api/warden/complaints')).status, 403);
    assert.equal((await dean.get('/api/admin/users')).status, 403);
    assert.equal((await dean.get('/api/security/movements')).status, 403);

    // And lower ranks cannot reach the Dean's functions by calling the API directly
    for (const key of ['hodCse', 'advCse', 'ao', 'warden', 'security', 'stuA'] as const) {
      const c = await ctx.as(key);
      assert.equal((await c.get('/api/dean/dashboard')).status, 403, `${key} must not read the Dean dashboard`);
      assert.equal((await c.get('/api/dean/uninformed-absence')).status, 403, `${key} must not read Dean monitoring`);
      assert.equal(
        (await c.post('/api/work/assignments', { title: 'x', description: 'y', category: 'Department Report', priority: 'High', startAt: inHours(0), dueAt: inHours(48), recipients: { allHods: true }, confirmCount: 2 })).status,
        403,
        `${key} must not create Dean assignments`,
      );
    }
  });
});

describe('Dean monitoring: departments, HODs and Advisers', () => {
  test('the Dean sees every department’s HOD and Adviser progress and can open an individual', async () => {
    const dean = await ctx.as('dean');
    const dash = (await dean.get('/api/dean/dashboard')).body.data;
    assert.ok(dash.departmentDirectory.length >= 2);
    const cse = dash.departmentDirectory.find((d: any) => d.code === 'CSE');
    assert.equal(cse.hodName, 'User hodCse');
    assert.equal(cse.advisers, 2);
    assert.ok('openTasks' in cse && 'overdueTasks' in cse);
    assert.ok('Assigned' in dash.assignmentLifecycle && 'overdue' in dash.assignmentLifecycle);

    const hods = (await dean.get('/api/dean/hods')).body.data;
    assert.deepEqual(hods.map((h: any) => h.department).sort(), ['CSE', 'ECE']);
    const advisers = (await dean.get('/api/dean/advisers')).body.data;
    assert.equal(advisers.length, 3, 'every Adviser across all departments');

    // Individual monitoring views
    for (const id of [ctx.fx.ids.hodEce, ctx.fx.ids.advCse]) {
      const staff = (await dean.get(`/api/dean/staff/${id}`)).body.data;
      assert.ok(staff.user && staff.workload);
      assert.ok(Array.isArray(staff.tasks) && Array.isArray(staff.reports) && Array.isArray(staff.schedules));
    }
  });

  test('staff monitoring covers HODs and Advisers only — there is no Warden performance view', async () => {
    const dean = await ctx.as('dean');
    // The Warden is not a staff-monitoring subject
    assert.equal((await dean.get(`/api/dean/staff/${ctx.fx.ids.warden}`)).status, 404);
    assert.equal((await dean.get(`/api/dean/staff/${ctx.fx.ids.security}`)).status, 404);
    assert.equal((await dean.get(`/api/dean/staff/${ctx.fx.ids.ao}`)).status, 404);
    // And no staff-performance report exists under Warden monitoring
    assert.equal((await dean.get('/api/dean/warden-reports/staff-performance')).status, 403);
    assert.equal((await dean.get('/api/dean/warden-reports/warden-workload')).status, 403);
  });
});

describe('Dean student monitoring is limited to three areas', () => {
  before(async () => {
    // One absence that the Warden flags, so the uninformed-absence view has evidence.
    const warden = await ctx.as('warden');
    const date = addDays(localDate(), -1);
    await warden.post('/api/attendance/mark', {
      date,
      entries: [
        { studentId: ctx.fx.students.stuA, status: 'Absent' },
        { studentId: ctx.fx.students.stuB, status: 'Present' },
      ],
    });
    await warden.post('/api/attendance/close', { date });
  });

  test('study participation, academic performance and uninformed absence are all available', async () => {
    const dean = await ctx.as('dean');
    const study = (await dean.get('/api/dean/study-overview')).body.data;
    assert.ok(study);
    const academics = (await dean.get('/api/dean/academics')).body.data;
    assert.ok(academics);

    const un = (await dean.get('/api/dean/uninformed-absence')).body.data;
    assert.ok(un.summary.total >= 1, 'the flagged absence is listed');
    const row = un.cases.find((c: any) => c.studentId === ctx.fx.students.stuA);
    assert.ok(row, 'the absent student appears');
    // Approved, rejected, pending and unverified are reported apart, never merged
    assert.ok(['Awaiting verification', 'Suspected unauthorized', 'Verified unauthorized', 'Leave request pending', 'Rejected leave', 'Approved leave', 'Resolved'].includes(row.classification));
    assert.equal(row.evidence.attendance.status, 'Absent');
    assert.ok(Array.isArray(row.evidence.leaveRequests) && Array.isArray(row.evidence.gateMovements));
    assert.ok('repeatThreshold' in un.summary);
  });

  test('a still-pending leave request is never reported as unauthorized', async () => {
    const student = await ctx.as('stuC');
    const warden = await ctx.as('warden');
    const dean = await ctx.as('dean');
    const date = localDate();
    const leave = (await student.post('/api/student/leave-requests', { type: 'Medical Leave', fromDate: date, toDate: date, reason: 'Hospital review appointment today' })).body.data;
    assert.equal(leave.workflowStatus, 'Pending Class Incharge');
    await warden.post('/api/attendance/mark', { date, entries: [{ studentId: ctx.fx.students.stuC, status: 'Absent' }] });
    await warden.post('/api/attendance/close', { date });

    const un = (await dean.get(`/api/dean/uninformed-absence?from=${date}&to=${date}`)).body.data;
    const row = un.cases.find((c: any) => c.studentId === ctx.fx.students.stuC);
    assert.ok(row);
    assert.equal(row.classification, 'Leave request pending');
    assert.equal(row.evidence.leaveRequests[0].id, leave.id);
    assert.equal(row.evidence.leaveRequests[0].status, 'Pending Class Incharge');
  });

  test('anything outside the three areas is refused, and private details never leave', async () => {
    const dean = await ctx.as('dean');
    // Area filter is validated, not quietly ignored
    assert.equal((await dean.get(`/api/dean/students/${ctx.fx.students.stuA}?area=complaints`)).status, 403);
    assert.equal((await dean.get(`/api/dean/students/${ctx.fx.students.stuA}?area=outings`)).status, 403);
    assert.equal((await dean.get(`/api/dean/students/${ctx.fx.students.stuA}?area=study-participation`)).status, 200);

    const detail = (await dean.get(`/api/dean/students/${ctx.fx.students.stuA}`)).body.data;
    assert.deepEqual(detail.scope, ['study-participation', 'academic-performance', 'uninformed-absence']);
    assert.ok(detail.studyParticipation && detail.academicPerformance && detail.uninformedAbsence);
    // Identity only: no contact, guardian, medical or address data
    for (const forbidden of ['contactNumber', 'parentName', 'parentNumber', 'permanentAddress', 'bloodGroup', 'medicalNotes', 'email']) {
      assert.ok(!(forbidden in detail.student), `${forbidden} must not be exposed to the Dean`);
    }
    assert.equal(detail.student.regNumber, 'CS001');
    // The same restriction applies to the list
    const list = (await dean.get('/api/dean/students')).body.data;
    assert.ok(list.length > 0);
    for (const forbidden of ['contactNumber', 'parentNumber', 'permanentAddress', 'medicalNotes']) {
      assert.ok(!(forbidden in list[0]), `${forbidden} must not be in the Dean's student list`);
    }
    // Unrelated student operational modules stay closed to the Dean
    assert.equal((await dean.get('/api/student/complaints')).status, 403);
    assert.equal((await dean.get('/api/warden/outing-requests')).status, 403);
  });
});

describe('Dean monitors the Warden only through student-related reports', () => {
  test('each permitted report returns real records', async () => {
    const dean = await ctx.as('dean');
    const index = (await dean.get('/api/dean/warden-reports')).body.data;
    assert.deepEqual(
      index.reports.map((r: any) => r.type).sort(),
      ['attendance-absence', 'gate-movements', 'incidents-followups', 'study-sessions', 'verified-unauthorized'],
    );
    assert.match(index.scope, /student-related/i);

    for (const type of index.reports.map((r: any) => r.type)) {
      const res = await dean.get(`/api/dean/warden-reports/${type}`);
      assert.equal(res.status, 200, type);
      assert.ok(Array.isArray(res.body.data.rows), type);
      assert.ok(res.body.data.title && res.body.data.period.from && res.body.data.period.to, type);
    }
    // The attendance report reflects the roll calls the Warden actually recorded
    const att = (await dean.get('/api/dean/warden-reports/attendance-absence')).body.data;
    assert.ok(att.rows.length >= 1);
    assert.ok(att.rows.every((r: any) => typeof r.recorded === 'number' && 'rollClosed' in r));
  });

  test('only the Dean can read them', async () => {
    for (const key of ['hodCse', 'warden', 'ao', 'stuA'] as const) {
      const c = await ctx.as(key);
      assert.equal((await c.get('/api/dean/warden-reports/attendance-absence')).status, 403, key);
    }
  });
});

describe('Dean work assignment across departments', () => {
  const base = {
    description: 'Collect and submit the figures for your area.',
    category: 'Department Report',
    priority: 'High',
    startAt: inHours(0),
    dueAt: inHours(72),
    expectedOutcome: 'A one-page summary.',
    instructions: 'Use the template circulated last term.',
  };

  test('to all HODs, to all Advisers, to one person, and to a mixed cross-department set', async () => {
    const dean = await ctx.as('dean');

    // 1. Every HOD across all departments
    const allHods = await dean.post('/api/work/assignments', { ...base, title: 'All HODs task', recipients: { allHods: true }, confirmCount: 2 });
    assert.equal(allHods.status, 201);
    assert.equal(allHods.body.data.stats.total, 2);
    assert.deepEqual(allHods.body.data.recipientRoles, ['HOD']);
    assert.deepEqual(allHods.body.data.targetDepartments.sort(), ['CSE', 'ECE']);
    assert.match(allHods.body.data.selectionSummary, /all HODs/);

    // 2. Every Adviser across all departments
    const allAdvisers = await dean.post('/api/work/assignments', { ...base, title: 'All Advisers task', recipients: { allAdvisers: true }, confirmCount: 3 });
    assert.equal(allAdvisers.body.data.stats.total, 3);
    assert.deepEqual(allAdvisers.body.data.recipientRoles, ['Adviser']);

    // 3. One specific HOD
    const oneHod = await dean.post('/api/work/assignments', { ...base, title: 'Single HOD task', recipients: { userIds: [ctx.fx.ids.hodEce] }, confirmCount: 1 });
    assert.equal(oneHod.body.data.stats.total, 1);
    assert.deepEqual(oneHod.body.data.targetDepartments, ['ECE']);

    // 4. One specific Adviser
    const oneAdviser = await dean.post('/api/work/assignments', { ...base, title: 'Single Adviser task', recipients: { userIds: [ctx.fx.ids.advEce] }, confirmCount: 1 });
    assert.equal(oneAdviser.body.data.stats.total, 1);

    // 5. Selected HODs and Advisers together, from different departments
    const mixed = await dean.post('/api/work/assignments', {
      ...base,
      title: 'Cross-department task',
      recipients: { userIds: [ctx.fx.ids.hodCse, ctx.fx.ids.advEce] },
      confirmCount: 2,
    });
    assert.equal(mixed.body.data.stats.total, 2);
    assert.deepEqual(mixed.body.data.recipientRoles.sort(), ['Adviser', 'HOD']);
    assert.deepEqual(mixed.body.data.targetDepartments.sort(), ['CSE', 'ECE']);

    // 6. "All" can be narrowed to chosen departments
    const scoped = await dean.post('/api/work/assignments', { ...base, title: 'CSE advisers only', recipients: { allAdvisers: true, departments: ['CSE'] }, confirmCount: 2 });
    assert.equal(scoped.body.data.stats.total, 2);
    assert.deepEqual(scoped.body.data.targetDepartments, ['CSE']);

    // The Dean can filter the register by department, role, priority and recipient
    const byDept = (await dean.get('/api/work/assignments?department=ECE')).body.data.map((a: any) => a.title);
    assert.ok(byDept.includes('Single HOD task') && !byDept.includes('CSE advisers only'));
    const byRole = (await dean.get('/api/work/assignments?role=HOD')).body.data.map((a: any) => a.title);
    assert.ok(byRole.includes('All HODs task') && !byRole.includes('All Advisers task'));
    const byRecipient = (await dean.get(`/api/work/assignments?recipientId=${ctx.fx.ids.advEce}`)).body.data.map((a: any) => a.title);
    assert.ok(byRecipient.includes('Single Adviser task') && byRecipient.includes('Cross-department task'));
    assert.equal((await dean.get('/api/work/assignments?priority=Urgent')).body.data.length, 0);
  });

  test('every recipient gets an independent record, and one person’s progress is their own', async () => {
    const dean = await ctx.as('dean');
    const created = await dean.post('/api/work/assignments', { ...base, title: 'Independent tracking task', recipients: { allHods: true }, confirmCount: 2 });
    const aid = created.body.data.id;

    // Both HODs were notified and each has their own row
    const hodCse = await ctx.as('hodCse');
    const hodEce = await ctx.as('hodEce');
    for (const c of [hodCse, hodEce]) {
      assert.ok((await c.get('/api/notifications')).body.data.some((n: any) => n.entityId === aid));
    }
    const mineCse = (await hodCse.get('/api/work/assignments')).body.data.find((t: any) => t.title === 'Independent tracking task');
    const mineEce = (await hodEce.get('/api/work/assignments')).body.data.find((t: any) => t.title === 'Independent tracking task');
    assert.ok(mineCse && mineEce);
    assert.notEqual(mineCse.id, mineEce.id, 'separate recipient records');

    // One acknowledges and finishes; the other is untouched
    await hodCse.post(`/api/work/tasks/${mineCse.id}/acknowledge`);
    await hodCse.post(`/api/work/tasks/${mineCse.id}/progress`, { progressPct: 60, note: 'Half done' });
    await hodCse.post(`/api/work/tasks/${mineCse.id}/submit`, { submissionText: 'Figures compiled for CSE.' });
    assert.equal((await dean.post(`/api/work/tasks/${mineCse.id}/review`, { decision: 'Approve', comment: 'Accepted' })).status, 200);

    const detail = (await dean.get(`/api/work/assignments/${aid}`)).body.data;
    const rowCse = detail.recipients.find((r: any) => r.userId === ctx.fx.ids.hodCse);
    const rowEce = detail.recipients.find((r: any) => r.userId === ctx.fx.ids.hodEce);
    assert.equal(rowCse.status, 'Completed');
    assert.equal(rowEce.status, 'Assigned', 'the other recipient is unaffected');
    assert.ok(rowCse.acknowledgedAt);
    assert.ok(!rowEce.acknowledgedAt, 'one acknowledgement does not acknowledge for everyone');
    assert.equal(detail.stats.completed, 1);

    // The recipient's own progress is visible in the Dean's staff monitoring view
    const staff = (await dean.get(`/api/dean/staff/${ctx.fx.ids.hodCse}`)).body.data;
    assert.ok(staff.tasks.some((t: any) => t.assignmentId === aid && t.status === 'Completed'));

    // And one recipient cannot touch another's row
    assert.equal((await hodEce.post(`/api/work/tasks/${mineCse.id}/acknowledge`)).status, 404);
    assert.equal((await hodEce.post(`/api/work/tasks/${mineCse.id}/submit`, { submissionText: 'not mine' })).status, 404);
  });

  test('the Dean can request a revision and the recipient resubmits', async () => {
    const dean = await ctx.as('dean');
    const adviser = await ctx.as('advEce');
    const created = await dean.post('/api/work/assignments', { ...base, title: 'Revision task', recipients: { userIds: [ctx.fx.ids.advEce] }, confirmCount: 1 });
    const mine = (await adviser.get('/api/work/assignments')).body.data.find((t: any) => t.title === 'Revision task');
    await adviser.post(`/api/work/tasks/${mine.id}/acknowledge`);
    await adviser.post(`/api/work/tasks/${mine.id}/submit`, { submissionText: 'First draft.' });
    assert.equal((await dean.post(`/api/work/tasks/${mine.id}/review`, { decision: 'Revise' })).status, 400, 'a revision needs a comment');
    assert.equal((await dean.post(`/api/work/tasks/${mine.id}/review`, { decision: 'Revise', comment: 'Add the year-wise split.' })).status, 200);
    assert.ok((await adviser.get('/api/notifications')).body.data.some((n: any) => n.entityId === created.body.data.id));
    assert.equal((await adviser.post(`/api/work/tasks/${mine.id}/submit`, { submissionText: 'Second draft with the split.' })).status, 200);
    assert.equal((await dean.post(`/api/work/tasks/${mine.id}/review`, { decision: 'Approve', comment: 'Thanks.' })).status, 200);
    const row = (await dean.get(`/api/work/assignments/${created.body.data.id}`)).body.data.recipients[0];
    assert.equal(row.status, 'Completed');
    assert.ok(row.history.some((h: any) => h.action.includes('revision')));
  });
});

describe('the hierarchy never bypasses a mandatory approval stage', () => {
  test('the Dean cannot approve a leave request at any stage', async () => {
    const student = await ctx.as('stuB');
    const dean = await ctx.as('dean');
    const leave = (await student.post('/api/student/leave-requests', { type: 'Personal Leave', fromDate: addDays(localDate(), 5), toDate: addDays(localDate(), 6), reason: 'Family commitment at home town' })).body.data;
    // No Dean route exists, and the other roles' routes refuse the Dean outright
    assert.equal((await dean.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 403);
    assert.equal((await dean.post(`/api/hod/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 403);
    assert.equal((await dean.post(`/api/warden/leave-requests/${leave.id}/decision`, { decision: 'Approved', remarks: 'x' })).status, 403);
    const after = (await student.get('/api/student/leave-requests')).body.data.find((l: any) => l.id === leave.id);
    assert.equal(after.workflowStatus, 'Pending Class Incharge', 'the request still needs all three approvals');
  });
});
