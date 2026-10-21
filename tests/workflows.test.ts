import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { approveOutingAsParent, inHours, start, type TestContext } from './helpers';
import { addDays, localDate } from '../server/lib/util';
import { runReminderJobs } from '../server/jobs';

let ctx: TestContext;
before(async () => {
  ctx = await start();
});
after(async () => ctx.close());

describe('leave → outpass → gate → attendance', () => {
  test('full leave workflow runs Student → Class Incharge → HOD → Warden, then Security', async () => {
    const student = await ctx.as('stuA');
    const incharge = await ctx.as('advCse');
    const hod = await ctx.as('hodCse');
    const warden = await ctx.as('warden');
    const security = await ctx.as('security');
    const today = localDate();

    const leave = (await student.post('/api/student/leave-requests', { type: 'Family Function', fromDate: today, toDate: addDays(today, 1), reason: 'Cousin wedding at home town' })).body.data;
    // Routed from the student's own section to its Class Incharge
    assert.equal(leave.workflowStatus, 'Pending Class Incharge');
    assert.equal(leave.section, 'A');
    assert.equal(leave.pendingStage, 'Class Incharge');
    // Duplicate/overlapping submission is rejected
    assert.equal((await student.post('/api/student/leave-requests', { type: 'Family Function', fromDate: today, toDate: today, reason: 'Duplicate submission attempt' })).status, 409);
    // Neither later approver can skip ahead
    assert.equal((await hod.post(`/api/hod/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 409);
    assert.equal((await warden.post(`/api/warden/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 409);
    // It is not in anyone else's pending queue yet
    assert.ok(!(await hod.get('/api/hod/leave-requests?pending=1')).body.data.some((l: any) => l.id === leave.id));
    assert.ok(!(await warden.get('/api/warden/leave-requests?pending=1')).body.data.some((l: any) => l.id === leave.id));
    // No outpass before approval
    assert.equal((await student.get('/api/student/outpasses')).body.data.length, 0);

    assert.equal((await incharge.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Approved', remarks: 'OK' })).status, 200);
    assert.ok((await hod.get('/api/hod/leave-requests?pending=1')).body.data.some((l: any) => l.id === leave.id));
    // Still not with the Warden until the HOD approves
    assert.ok(!(await warden.get('/api/warden/leave-requests?pending=1')).body.data.some((l: any) => l.id === leave.id));
    assert.equal((await warden.post(`/api/warden/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 409);
    assert.equal((await hod.post(`/api/hod/leave-requests/${leave.id}/decision`, { decision: 'Approved', remarks: 'No objection' })).status, 200);
    assert.ok((await warden.get('/api/warden/leave-requests?pending=1')).body.data.some((l: any) => l.id === leave.id && l.workflowStatus === 'Pending Warden'));
    // Rejection requires a reason
    assert.equal((await warden.post(`/api/warden/leave-requests/${leave.id}/decision`, { decision: 'Rejected' })).status, 400);
    const approved = await warden.post(`/api/warden/leave-requests/${leave.id}/decision`, { decision: 'Approved', remarks: 'Return by 8 PM' });
    assert.equal(approved.status, 200);
    // Second decision is a conflict, not a silent overwrite
    assert.equal((await warden.post(`/api/warden/leave-requests/${leave.id}/decision`, { decision: 'Rejected', remarks: 'x' })).status, 409);

    const passes = (await student.get('/api/student/outpasses')).body.data;
    assert.equal(passes.length, 1);
    assert.equal(passes[0].lifecycleStatus, 'Active');
    const notes = (await student.get('/api/notifications')).body.data;
    assert.ok(notes.some((n: any) => n.title.includes('approved')));
    // The full approval history survives and names every approver in order
    const stored = (await student.get('/api/student/leave-requests')).body.data.find((l: any) => l.id === leave.id);
    assert.deepEqual(
      stored.approvals.map((a: any) => [a.stage, a.decision]),
      [
        ['Class Incharge', 'Approved'],
        ['HOD', 'Approved'],
        ['Warden', 'Approved'],
      ],
    );
    assert.ok(stored.history.some((h: any) => h.action === 'class_incharge_approved'));
    assert.ok(stored.history.some((h: any) => h.action === 'hod_approved'));
    assert.ok(stored.history.some((h: any) => h.action === 'warden_approved'));

    // Security scans the QR to check out, then back in
    const verify = await security.get(`/api/security/verify?token=${encodeURIComponent(passes[0].qrToken)}`);
    assert.equal(verify.body.data.verdict, 'valid');
    const exit = await security.post('/api/security/scan', { qrToken: passes[0].qrToken, type: 'Exit', gate: 'Main Gate' });
    assert.equal(exit.status, 201);
    assert.equal(exit.body.data.scan.status, 'Approved');
    // Rapid duplicate scan is flagged as a duplicate and does not change state
    const dup = await security.post('/api/security/scan', { qrToken: passes[0].qrToken, type: 'Exit', gate: 'Main Gate' });
    assert.equal(dup.body.data.isDuplicate, true);
    assert.equal((await student.get('/api/student/outpasses')).body.data[0].lifecycleStatus, 'Out');
    const wardenStats = (await warden.get('/api/warden/stats')).body.data;
    assert.equal(wardenStats.onLeave, 1);

    // Attendance: marking the student absent today is authorized by the approved leave
    await warden.post('/api/attendance/mark', { date: today, entries: [{ studentId: ctx.fx.students.stuA, status: 'Absent' }] });
    const cases = (await warden.get('/api/absences')).body.data;
    const c = cases.find((x: any) => x.studentId === ctx.fx.students.stuA && x.date === today);
    assert.equal(c.status, 'Authorized Absence');

    const entry = await security.post('/api/security/scan', { regNumber: 'CS001', type: 'Entry', gate: 'Main Gate' });
    assert.equal(entry.status, 201);
    assert.equal((await student.get('/api/student/outpasses')).body.data[0].lifecycleStatus, 'Completed');
  });

  test('exit without a valid pass is flagged and the warden is alerted', async () => {
    const security = await ctx.as('security');
    const res = await security.post('/api/security/scan', { regNumber: 'CS002', type: 'Exit', gate: 'North Gate' });
    assert.equal(res.body.data.flagged, true);
    const warden = await ctx.as('warden');
    assert.ok((await warden.get('/api/notifications')).body.data.some((n: any) => n.eventType === 'gate.flagged'));
  });

  test('outing approval issues a pass; client cannot spoof student identity at the gate', async () => {
    const student = await ctx.as('stuC');
    const warden = await ctx.as('warden');
    const o = await student.post('/api/student/outing-requests', { destination: 'City Library', reason: 'Reference books', outAt: inHours(1), expectedReturnAt: inHours(4), locationConsent: true, latitude: 13.0827, longitude: 80.2707, accuracyM: 12 });
    assert.equal(o.status, 201);
    assert.equal(o.body.data.workflowStatus ?? o.body.data.status, 'Parent Approval Pending');
    assert.equal(
      (await student.post('/api/student/outing-requests', { destination: 'Mall', reason: 'Overlap test', outAt: inHours(2), expectedReturnAt: inHours(3), locationConsent: true, latitude: 13.0827, longitude: 80.2707, accuracyM: 12 })).status,
      409,
    );
    // The Warden cannot act before the parent/guardian has approved
    assert.equal((await warden.post(`/api/warden/outing-requests/${o.body.data.id}/decision`, { decision: 'Approved' })).status, 409);
    await approveOutingAsParent(ctx, o.body.data.id);
    assert.equal((await warden.post(`/api/warden/outing-requests/${o.body.data.id}/decision`, { decision: 'Approved' })).status, 200);
    const security = await ctx.as('security');
    const scan = await security.post('/api/security/scan', { regNumber: 'EC001', type: 'Exit', name: 'Someone Else', roomNo: 'Z-999' });
    assert.equal(scan.body.data.scan.name, 'Student stuC');
    assert.equal(scan.body.data.scan.roomNo, 'A-102');
  });
});

describe('absence verification workflow', () => {
  test('pending → suspected on close → verified → dean follow-up → adviser resolves', async () => {
    const warden = await ctx.as('warden');
    const dean = await ctx.as('dean');
    const date = addDays(localDate(), -1);
    await warden.post('/api/attendance/mark', {
      date,
      entries: [
        { studentId: ctx.fx.students.stuB, status: 'Absent' },
        { studentId: ctx.fx.students.stuA, status: 'Present' },
      ],
    });
    let c = (await warden.get(`/api/absences?from=${date}&to=${date}`)).body.data.find((x: any) => x.studentId === ctx.fx.students.stuB);
    assert.equal(c.status, 'Pending Verification', 'never unauthorized before verification');
    const closed = await warden.post('/api/attendance/close', { date });
    assert.equal(closed.status, 200);
    assert.ok(closed.body.data.notRecorded >= 1, 'students not recorded are reported, not flagged');
    c = (await warden.get(`/api/absences/${c.id}`)).body.data;
    assert.equal(c.status, 'Suspected Unauthorized');
    // Dean cannot verify; only monitors and requests follow-up
    assert.equal((await dean.post(`/api/absences/${c.id}/action`, { action: 'verify_unauthorized', note: 'x' })).status, 403);
    // Verification needs a note
    assert.equal((await warden.post(`/api/absences/${c.id}/action`, { action: 'verify_unauthorized' })).status, 400);
    assert.equal((await warden.post(`/api/absences/${c.id}/action`, { action: 'verify_unauthorized', note: 'Confirmed with roommates' })).status, 200);
    // Follow-up must go to the student's own adviser
    assert.equal((await dean.post(`/api/absences/${c.id}/follow-up`, { assigneeId: ctx.fx.ids.advCse, note: 'Please counsel the student' })).status, 400);
    const fu = await dean.post(`/api/absences/${c.id}/follow-up`, { assigneeId: ctx.fx.ids.advCse2, note: 'Please counsel the student' });
    assert.equal(fu.status, 200);
    const adviser = await ctx.as('advCse2');
    const myFollowups = (await adviser.get('/api/followups')).body.data;
    assert.ok(myFollowups.some((f: any) => f.sourceId === c.id && f.category === 'Absence Follow-up'));
    assert.equal((await adviser.post(`/api/absences/${c.id}/action`, { action: 'resolve', note: 'Counselled; parent informed' })).status, 200);
    const final = (await dean.get(`/api/absences/${c.id}`)).body.data;
    assert.equal(final.status, 'Resolved');
    assert.ok(final.history.length >= 4);
    const dash = (await dean.get('/api/dean/dashboard')).body.data;
    assert.ok(dash.metrics.verifiedUnauthorizedAbsences.value >= 1);
  });
});

describe('study sessions', () => {
  test('the assigned Adviser runs the session and the Dean sees the same records', async () => {
    const adviser = await ctx.as('advCse');
    const warden = await ctx.as('warden');
    const dean = await ctx.as('dean');
    const today = localDate();
    const s = await adviser.post('/api/study-sessions', { title: 'Evening Study', date: today, startTime: '18:00', endTime: '19:30', location: 'Reading Hall' });
    assert.equal(s.status, 201);
    assert.equal(s.body.data.adviserId, ctx.fx.ids.advCse);
    // The Warden is no longer the study-session operator
    assert.equal((await warden.post('/api/study-sessions', { title: 'Warden session', date: today, startTime: '20:00', endTime: '21:00', location: 'Hall B' })).status, 403);
    assert.equal((await warden.post(`/api/study-sessions/${s.body.data.id}/attendance`, { entries: [] })).status, 403);
    const clash = await dean.post('/api/study-sessions', { title: 'Clash', date: today, startTime: '18:30', endTime: '19:00', location: 'Reading Hall', adviserId: ctx.fx.ids.advCse });
    assert.equal(clash.status, 409);

    const roster = (await adviser.get(`/api/study-sessions/${s.body.data.id}/roster`)).body.data.roster;
    // Only the students assigned to this Adviser
    assert.equal(roster.length, 1);
    assert.equal(roster[0].regNumber, 'CS001');
    await adviser.post(`/api/study-sessions/${s.body.data.id}/attendance`, { entries: [{ studentId: roster[0].studentId, status: 'Present' }] });
    const summary = (await dean.get(`/api/study/summary?from=${today}&to=${today}&groupBy=department`)).body.data;
    assert.equal(summary.rows.reduce((a: number, r: any) => a + r.marked, 0), 1);
    const student = await ctx.as('stuA');
    const mine = (await student.get('/api/student/study-sessions')).body.data;
    assert.equal(mine.sessions.find((x: any) => x.id === s.body.data.id).myStatus, 'Present');
    // Cancel requires a reason; the HOD can view but not create
    assert.equal((await adviser.patch(`/api/study-sessions/${s.body.data.id}`, { status: 'Cancelled' })).status, 400);
    const hod = await ctx.as('hodCse');
    assert.equal((await hod.post('/api/study-sessions', { title: 'x', date: today, startTime: '10:00', endTime: '11:00', location: 'Hall' })).status, 403);
  });
});

describe('Dean work assignments', () => {
  test('assign → acknowledge → progress → submit → revise → resubmit → approve', async () => {
    const dean = await ctx.as('dean');
    const preview = (await dean.post('/api/work/recipients/preview', { allHods: true })).body.data;
    assert.equal(preview.length, 2);
    const base = {
      title: 'Prepare department review',
      description: 'Compile the internal assessment review for your department.',
      category: 'Department Report',
      priority: 'High',
      startAt: inHours(0),
      dueAt: inHours(72),
      recipients: { allHods: true, userIds: [ctx.fx.ids.advCse] },
    };
    // Bulk send requires confirmation of the previewed count
    assert.equal((await dean.post('/api/work/assignments', base)).status, 400);
    assert.equal((await dean.post('/api/work/assignments', { ...base, dueAt: inHours(-1), confirmCount: 3 })).status, 400);
    const created = await dean.post('/api/work/assignments', { ...base, confirmCount: 3 });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.stats.total, 3);

    const hod = await ctx.as('hodCse');
    const tasks = (await hod.get('/api/work/assignments')).body.data;
    assert.equal(tasks.length, 1);
    const task = tasks[0];
    // Another HOD cannot act on this recipient row
    const hodEce = await ctx.as('hodEce');
    assert.equal((await hodEce.post(`/api/work/tasks/${task.id}/acknowledge`)).status, 404);
    // Recipient cannot approve their own work
    assert.equal((await hod.post(`/api/work/tasks/${task.id}/review`, { decision: 'Approve' })).status, 403);

    assert.equal((await hod.post(`/api/work/tasks/${task.id}/acknowledge`)).status, 200);
    assert.equal((await hod.post(`/api/work/tasks/${task.id}/progress`, { progressPct: 40, note: 'Collected marks' })).status, 200);
    const submitted = await hod.post(`/api/work/tasks/${task.id}/submit`, { submissionText: 'Review compiled and attached summary.' });
    assert.equal(submitted.status, 200);
    // Cannot complete without the Dean
    assert.equal((await hod.post(`/api/work/tasks/${task.id}/progress`, { progressPct: 50, note: 'More' })).status, 409);

    assert.equal((await dean.post(`/api/work/tasks/${task.id}/review`, { decision: 'Revise' })).status, 400, 'revision needs a comment');
    assert.equal((await dean.post(`/api/work/tasks/${task.id}/review`, { decision: 'Revise', comment: 'Add year-wise breakdown' })).status, 200);
    // Stale version is detected
    assert.equal((await hod.post(`/api/work/tasks/${task.id}/submit`, { submissionText: 'Updated with breakdown', expectedVersion: 1 })).status, 409);
    assert.equal((await hod.post(`/api/work/tasks/${task.id}/submit`, { submissionText: 'Updated with year-wise breakdown.' })).status, 200);
    assert.equal((await dean.post(`/api/work/tasks/${task.id}/review`, { decision: 'Approve', comment: 'Good' })).status, 200);

    const detail = (await dean.get(`/api/work/assignments/${created.body.data.id}`)).body.data;
    const row = detail.recipients.find((r: any) => r.userId === ctx.fx.ids.hodCse);
    assert.equal(row.status, 'Completed');
    assert.ok(row.history.map((h: any) => h.action).join(',').includes('revision_requested'));
    // Instructions are locked after assignment
    assert.equal((await dean.patch(`/api/work/assignments/${created.body.data.id}`, base)).status, 409);
    // Monitoring shows transparent counts
    const hods = (await dean.get('/api/dean/hods')).body.data;
    assert.equal(hods.find((h: any) => h.department === 'CSE').workload.tasks.completed, 1);
    const hodNotes = (await hod.get('/api/notifications')).body.data.map((n: any) => n.eventType);
    assert.ok(hodNotes.includes('assignment.assigned') && hodNotes.includes('assignment.revision_requested') && hodNotes.includes('assignment.approved'));
  });

  test('evidence-required tasks cannot be submitted without an attachment', async () => {
    const dean = await ctx.as('dean');
    const a = await dean.post('/api/work/assignments', {
      title: 'Upload attendance proof',
      description: 'Upload the signed attendance sheet.',
      category: 'Administrative',
      priority: 'Medium',
      startAt: inHours(0),
      dueAt: inHours(24),
      requiresEvidence: true,
      recipients: { userIds: [ctx.fx.ids.advEce] },
      confirmCount: 1,
    });
    const adv = await ctx.as('advEce');
    const task = (await adv.get('/api/work/assignments')).body.data.find((t: any) => t.assignmentId === a.body.data.id);
    assert.equal((await adv.post(`/api/work/tasks/${task.id}/submit`, { submissionText: 'Done, see attachment.' })).status, 400);
    assert.equal((await adv.post('/api/attachments', { entityType: 'assignment_submission', entityId: task.id, fileName: 'sheet.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') })).status, 200);
    assert.equal((await adv.post(`/api/work/tasks/${task.id}/submit`, { submissionText: 'Done, see attachment.' })).status, 200);
  });

  test('deadline reminders are created once and the overdue flag is derived', async () => {
    const dean = await ctx.as('dean');
    const a = await dean.post('/api/work/assignments', {
      title: 'Quick check',
      description: 'Confirm advisee list is accurate.',
      category: 'Administrative',
      priority: 'Low',
      startAt: inHours(-2),
      dueAt: inHours(2),
      recipients: { userIds: [ctx.fx.ids.advCse] },
      confirmCount: 1,
    });
    const first = runReminderJobs();
    const second = runReminderJobs();
    assert.ok(first >= 1);
    assert.equal(second, 0, 'reminders are deduplicated');
    ctx.db.run(`UPDATE assignment_recipients SET due_at = ? WHERE assignment_id = ?`, inHours(-1), a.body.data.id);
    const adv = await ctx.as('advCse');
    const t = (await adv.get('/api/work/assignments')).body.data.find((x: any) => x.assignmentId === a.body.data.id);
    assert.equal(t.isOverdue, true);
    assert.equal(t.status, 'Assigned', 'overdue is derived, not stored as a status');
  });
});

describe('Dean schedules', () => {
  test('conflicts are detected, overrides need a reason, changes reach participants', async () => {
    const dean = await ctx.as('dean');
    const body = { title: 'HOD review meeting', category: 'HOD Meeting', startAt: inHours(48), endAt: inHours(49), location: 'Dean office', participants: { allHods: true }, confirmCount: 2 };
    const s1 = await dean.post('/api/work/schedules', body);
    assert.equal(s1.status, 201);
    const clash = await dean.post('/api/work/schedules', { ...body, title: 'Overlap', startAt: inHours(48.5), endAt: inHours(50) });
    assert.equal(clash.status, 409);
    assert.ok(clash.body.details.conflicts.length >= 1);
    const forced = await dean.post('/api/work/schedules', { ...body, title: 'Overlap', startAt: inHours(48.5), endAt: inHours(50), overrideReason: 'Urgent accreditation visit' });
    assert.equal(forced.status, 201);

    const hod = await ctx.as('hodEce');
    let mine = (await hod.get('/api/work/schedules')).body.data;
    assert.equal(mine.length, 2);
    assert.equal((await hod.post(`/api/work/schedules/${s1.body.data.id}/respond`, { response: 'Acknowledged' })).status, 200);
    // Reschedule requires a reason and resets responses
    assert.equal((await dean.patch(`/api/work/schedules/${s1.body.data.id}`, { ...body, startAt: inHours(72), endAt: inHours(73) })).status, 400);
    assert.equal((await dean.patch(`/api/work/schedules/${s1.body.data.id}`, { ...body, startAt: inHours(72), endAt: inHours(73), changeReason: 'Dean travelling' })).status, 200);
    let detail = (await dean.get(`/api/work/schedules/${s1.body.data.id}`)).body.data;
    assert.equal(detail.status, 'Rescheduled');
    assert.ok(detail.participants.every((p: any) => p.response === 'Pending'));
    assert.equal((await dean.post(`/api/work/schedules/${forced.body.data.id}/cancel`, { reason: 'Visit postponed' })).status, 200);
    mine = (await hod.get('/api/work/schedules?status=Scheduled,Rescheduled')).body.data;
    assert.ok(mine.every((s: any) => s.status !== 'Cancelled'), 'cancelled activities are not shown as active');
    const notes = (await hod.get('/api/notifications')).body.data.map((n: any) => n.eventType);
    assert.ok(notes.includes('schedule.created') && notes.includes('schedule.changed') && notes.includes('schedule.cancelled'));
    // A non-participant cannot see the schedule
    const adv = await ctx.as('advEce');
    assert.equal((await adv.get(`/api/work/schedules/${s1.body.data.id}`)).status, 404);
    detail = (await hod.get(`/api/work/schedules/${s1.body.data.id}`)).body.data;
    assert.equal(detail.participants, undefined, 'participants list is Dean-only');
  });
});

describe('Dean report distribution', () => {
  test('distribute → acknowledge → submit → under review → revise → resubmit → accept', async () => {
    const dean = await ctx.as('dean');
    const req = await dean.post('/api/work/report-requests', {
      title: 'Monthly study participation report',
      message: 'Submit your department summary with remarks.',
      category: 'Study Session Report',
      deadlineAt: inHours(96),
      recipients: { allAdvisers: true, departments: ['CSE'] },
      generatedReportType: 'study_participation',
      confirmCount: 2,
    });
    assert.equal(req.status, 201);
    assert.ok(req.body.data.generatedReport.columns.length > 0);
    // Student-level reports cannot be attached to distributions
    const bad = await dean.post('/api/work/report-requests', { title: 'x x x', message: 'xxxxx', category: 'Other', deadlineAt: inHours(10), recipients: { allHods: true }, generatedReportType: 'students_needing_support', confirmCount: 2 });
    assert.equal(bad.status, 400);

    const adv = await ctx.as('advCse');
    const mine = (await adv.get('/api/work/report-requests')).body.data;
    assert.equal(mine.length, 1);
    const rid = mine[0].id;
    assert.equal((await ctx.as('advEce').then((c) => c.get(`/api/work/report-requests/${req.body.data.id}`))).status, 404);
    assert.equal((await adv.post(`/api/work/report-responses/${rid}/acknowledge`)).status, 200);
    assert.equal((await adv.post(`/api/work/report-responses/${rid}/submit`, { submissionText: 'Participation was 92% this month.' })).status, 200);
    assert.equal((await dean.post(`/api/work/report-responses/${rid}/review`, { decision: 'StartReview' })).status, 200);
    assert.equal((await dean.post(`/api/work/report-responses/${rid}/review`, { decision: 'Revise', comment: 'Add session-wise detail' })).status, 200);
    assert.equal((await adv.post(`/api/work/report-responses/${rid}/submit`, { submissionText: 'Participation 92%; session-wise table added.' })).status, 200);
    assert.equal((await dean.post(`/api/work/report-responses/${rid}/review`, { decision: 'Accept' })).status, 200);
    const detail = (await dean.get(`/api/work/report-requests/${req.body.data.id}`)).body.data;
    const r = detail.recipients.find((x: any) => x.id === rid);
    assert.equal(r.status, 'Accepted');
    assert.equal(r.submissionCount, 2);
    assert.equal(detail.stats.outstanding, 1);
    const remind = await dean.post(`/api/work/report-requests/${req.body.data.id}/remind`);
    assert.equal(remind.body.data.sent, 1);
    const again = await dean.post(`/api/work/report-requests/${req.body.data.id}/remind`);
    assert.equal(again.body.data.sent, 0, 'reminders deduplicated per day');
  });
});

describe('academics and rooms', () => {
  test('CSV import is all-or-nothing and scoped; dean sees consistent summaries', async () => {
    const adv = await ctx.as('advCse');
    const bad = await adv.post('/api/academics/import', { csv: 'reg_number,academic_year,semester,assessment,percentage\nCS001,2026-27,3,Internal 1,78\nEC001,2026-27,3,Internal 1,66' });
    assert.equal(bad.status, 422, 'EC001 is outside the adviser scope');
    assert.equal((await adv.get('/api/academics/records')).body.data.length, 0, 'nothing imported');
    const good = await adv.post('/api/academics/import', { csv: 'reg_number,academic_year,semester,assessment,percentage\nCS001,2026-27,3,Internal 1,78\nCS001,2026-27,3,Internal 2,52' });
    assert.equal(good.status, 200);
    const dean = await ctx.as('dean');
    const acad = (await dean.get('/api/dean/academics')).body.data;
    assert.equal(acad.hasRecords, true);
    const s = acad.students.find((x: any) => x.regNumber === 'CS001');
    assert.equal(s.trend, 'Declining');
    assert.equal(s.needsSupport, true);
  });

  test('dean follow-up requests go only to eligible staff and reach their follow-up list', async () => {
    const dean = await ctx.as('dean');
    const stu = ctx.fx.students.stuA;
    const body = { category: 'Academic Support', title: 'Academic support check-in', notes: 'Internal 2 dropped below threshold.' };
    // Another department's HOD and a different adviser are not responsible for this student
    assert.equal((await dean.post(`/api/dean/students/${stu}/follow-up`, { ...body, assigneeId: ctx.fx.ids.hodEce })).status, 400);
    assert.equal((await dean.post(`/api/dean/students/${stu}/follow-up`, { ...body, assigneeId: ctx.fx.ids.advCse2 })).status, 400);
    const res = await dean.post(`/api/dean/students/${stu}/follow-up`, { ...body, assigneeId: ctx.fx.ids.advCse });
    assert.equal(res.status, 200);
    const adv = await ctx.as('advCse');
    assert.ok((await adv.get('/api/followups')).body.data.some((f: any) => f.title === body.title));
    assert.ok((await adv.get('/api/notifications')).body.data.some((n: any) => /follow-up/i.test(n.title)));
    // Non-Dean roles cannot use the endpoint
    assert.equal((await adv.post(`/api/dean/students/${stu}/follow-up`, { ...body, assigneeId: ctx.fx.ids.advCse })).status, 403);
  });

  test('room capacity is enforced on allocation', async () => {
    const warden = await ctx.as('warden');
    const full = await warden.post(`/api/warden/rooms/${ctx.fx.rooms['A-101']}/allocate`, { studentId: ctx.fx.students.stuD });
    assert.equal(full.status, 409);
    const okRes = await warden.post(`/api/warden/rooms/${ctx.fx.rooms['A-102']}/allocate`, { studentId: ctx.fx.students.stuD });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.data.occupied, 2);
  });
});

describe('academic calendar holidays', () => {
  test('every signed-in portal reads the same active holiday list', async () => {
    const now = new Date().toISOString();
    const row = (id: string, date: string, name: string, active = 1) =>
      ctx.db.run(
        `INSERT INTO holidays (id, holiday_date, name, category, description, is_active, created_at, updated_at) VALUES (?, ?, ?, 'Festival', NULL, ?, ?, ?)`,
        id,
        date,
        name,
        active,
        now,
        now,
      );
    row('hol_a', '2026-10-20', 'Vijaya Dasami');
    row('hol_b', '2026-09-04', 'Janmastami');
    row('hol_c', '2026-11-05', 'Cancelled holiday', 0);

    const student = await ctx.as('stuA');
    const all = (await student.get('/api/holidays')).body.data;
    // Sorted by date, and the de-activated row is hidden
    assert.deepEqual(all.map((h: any) => h.date), ['2026-09-04', '2026-10-20']);
    assert.equal(all[0].name, 'Janmastami');

    const ranged = (await student.get('/api/holidays?from=2026-10-01&to=2026-10-31')).body.data;
    assert.deepEqual(ranged.map((h: any) => h.date), ['2026-10-20']);
    assert.equal((await student.get('/api/holidays?from=20-10-2026')).status, 400);

    // Staff portals see the same calendar; signed-out callers see nothing
    const warden = await ctx.as('warden');
    assert.equal((await warden.get('/api/holidays')).body.data.length, 2);
    assert.equal((await new (await import('./helpers')).Client(ctx.base).get('/api/holidays')).status, 401);
  });
});
