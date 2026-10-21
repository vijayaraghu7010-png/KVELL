import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localDate } from '../server/lib/util';
import { runReminderJobs } from '../server/jobs';
import { start, type TestContext } from './helpers';

let ctx: TestContext;
before(async () => {
  ctx = await start();
});
after(async () => ctx.close());

const futureLeave = (offset: number) => ({ fromDate: addDays(localDate(), offset), toDate: addDays(localDate(), offset + 1) });

describe('Class Incharge assignment', () => {
  test('an Admin assigns a teacher per department section and conflicts are refused', async () => {
    const admin = await ctx.as('admin');
    const before = (await admin.get('/api/admin/class-incharges')).body.data;
    // Every department + section pair is offered as a slot, held or free
    assert.ok(before.slots.some((s: any) => s.department === 'CSE' && s.section === 'A' && s.incharge));
    assert.ok(before.slots.some((s: any) => s.department === 'ECE' && s.section === 'B' && !s.incharge));

    // A new ECE teacher takes the free Section B slot
    const teacher = await admin.post('/api/admin/users', { name: 'ECE Section B Teacher', email: 'ece-b@test.local', role: 'Adviser', department: 'ECE', temporaryPassword: 'Temp12345', studentCategory: 'Hosteller', isClassIncharge: true, section: 'B' });
    assert.equal(teacher.status, 201);
    assert.equal(teacher.body.data.isClassIncharge, true);
    assert.equal(teacher.body.data.classSection, 'B');

    // The same slot cannot be handed to someone else without an explicit replace
    const clash = await admin.post('/api/admin/class-incharges', { userId: ctx.fx.ids.advEce, department: 'ECE', section: 'B' });
    assert.equal(clash.status, 409);
    // Nor can a teacher be made incharge of another department
    assert.equal((await admin.post('/api/admin/class-incharges', { userId: ctx.fx.ids.advCse, department: 'ECE', section: 'B', replace: true })).status, 400);
    // Nor of a section the department does not run
    assert.equal((await admin.post('/api/admin/class-incharges', { userId: teacher.body.data.id, department: 'ECE', section: 'Z', replace: true })).status, 400);
    // Only an Adviser/Teacher account qualifies
    assert.equal((await admin.post('/api/admin/class-incharges', { userId: ctx.fx.ids.warden, department: 'ECE', section: 'B', replace: true })).status, 400);

    // "No" on the form removes the assignment
    assert.equal((await admin.patch(`/api/admin/users/${teacher.body.data.id}`, { isClassIncharge: false })).body.data.isClassIncharge, false);
    assert.ok(!(await admin.get('/api/admin/class-incharges')).body.data.assignments.some((a: any) => a.userId === teacher.body.data.id));

    // A non-admin cannot assign
    const warden = await ctx.as('warden');
    assert.equal((await warden.post('/api/admin/class-incharges', { userId: ctx.fx.ids.advEce, department: 'ECE', section: 'B' })).status, 403);
  });

  test('students see their section, Class Incharge and HOD on their profile', async () => {
    const profile = (await (await ctx.as('stuA')).get('/api/student/profile')).body.data;
    assert.equal(profile.section, 'A');
    assert.equal(profile.department, 'CSE');
    assert.equal(profile.classIncharge.name, 'User advCse');
    assert.equal(profile.hodName, 'User hodCse');
  });
});

describe('adviser assignment belongs to the HOD, inside their own department', () => {
  test('the HOD assigns their own students to their own advisers, and nothing else', async () => {
    const hod = await ctx.as('hodCse');
    const advisers = (await hod.get('/api/hod/advisers')).body.data;
    const target = advisers.find((a: any) => a.name.includes('advCse2'));
    assert.ok(target, 'the CSE HOD sees only CSE advisers');

    const students = (await hod.get('/api/hod/students')).body.data;
    const stuA = students.find((s: any) => s.regNumber === 'CS001');
    assert.ok(stuA);

    const res = await hod.post(`/api/hod/advisers/${target.id}/assign`, { studentIds: [stuA.id] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.assigned, 1);
    const after = (await hod.get('/api/hod/students')).body.data.find((s: any) => s.regNumber === 'CS001');
    assert.equal(after.adviserId, target.id);

    // An adviser outside the department is not theirs to assign to
    const admin = await ctx.as('admin');
    const eceAdviser = (await admin.get('/api/admin/users')).body.data.find((u: any) => u.role === 'Adviser' && u.department === 'ECE');
    assert.equal((await hod.post(`/api/hod/advisers/${eceAdviser.id}/assign`, { studentIds: [stuA.id] })).status, 404);

    // Neither is a student from another department
    const ece = (await ctx.as('hodEce')).get;
    const eceStudent = (await ece('/api/hod/students')).body.data.find((s: any) => s.regNumber === 'EC001');
    assert.equal((await hod.post(`/api/hod/advisers/${target.id}/assign`, { studentIds: [eceStudent.id] })).status, 400);

    // And the module is gone from the Admin API's reach for this HOD
    assert.equal((await hod.get('/api/admin/students')).status, 403);
  });
});

describe('leave approval chain: Class Incharge → HOD → Warden', () => {
  test('each section routes to its own Class Incharge', async () => {
    const a = await ctx.as('stuA'); // CSE Section A
    const b = await ctx.as('stuB'); // CSE Section B
    const leaveA = (await a.post('/api/student/leave-requests', { type: 'Personal Leave', ...futureLeave(2), reason: 'Family commitment at home town' })).body.data;
    const leaveB = (await b.post('/api/student/leave-requests', { type: 'Personal Leave', ...futureLeave(2), reason: 'Family commitment at home town' })).body.data;

    const inchargeA = await ctx.as('advCse');
    const inchargeB = await ctx.as('advCse2');
    const queueA = (await inchargeA.get('/api/adviser/leave-requests')).body.data;
    const queueB = (await inchargeB.get('/api/adviser/leave-requests')).body.data;
    assert.ok(queueA.some((l: any) => l.id === leaveA.id) && !queueA.some((l: any) => l.id === leaveB.id));
    assert.ok(queueB.some((l: any) => l.id === leaveB.id) && !queueB.some((l: any) => l.id === leaveA.id));
    // The approver is derived from the profile, not chosen by the student, and no
    // decision has been recorded yet.
    assert.equal(leaveA.classInchargeName, 'User advCse');
    assert.equal(leaveA.classInchargeDecision, undefined);
    assert.equal(leaveA.pendingWith, 'User advCse');
    assert.equal(leaveB.pendingWith, 'User advCse2');
  });

  test('a Class Incharge rejection never reaches the HOD or the Warden', async () => {
    const student = await ctx.as('stuA');
    const incharge = await ctx.as('advCse');
    const hod = await ctx.as('hodCse');
    const warden = await ctx.as('warden');
    const leave = (await student.post('/api/student/leave-requests', { type: 'Medical Leave', ...futureLeave(20), reason: 'Follow-up consultation at the city hospital' })).body.data;
    // A rejection needs a reason
    assert.equal((await incharge.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Rejected' })).status, 400);
    const rejected = await incharge.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Rejected', remarks: 'Attendance shortage this month' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.workflowStatus, 'Rejected');
    assert.equal(rejected.body.data.rejectedStage, 'Class Incharge');
    assert.ok(!(await hod.get('/api/hod/leave-requests?pending=1')).body.data.some((l: any) => l.id === leave.id));
    assert.ok(!(await warden.get('/api/warden/leave-requests?pending=1')).body.data.some((l: any) => l.id === leave.id));
    // A second decision cannot overwrite the first
    assert.equal((await incharge.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 409);
    // The student sees the stage and the reason
    const mine = (await student.get('/api/student/leave-requests')).body.data.find((l: any) => l.id === leave.id);
    assert.equal(mine.status, 'Rejected');
    assert.equal(mine.rejectionReason, 'Attendance shortage this month');
  });

  test('an HOD rejection never reaches the Warden, and HODs are confined to their department', async () => {
    const student = await ctx.as('stuA');
    const incharge = await ctx.as('advCse');
    const hodCse = await ctx.as('hodCse');
    const hodEce = await ctx.as('hodEce');
    const warden = await ctx.as('warden');
    const leave = (await student.post('/api/student/leave-requests', { type: 'Personal Leave', ...futureLeave(30), reason: 'Passport verification appointment' })).body.data;
    await incharge.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Approved', remarks: 'Fine' });
    // Another department's HOD cannot touch it
    assert.equal((await hodEce.post(`/api/hod/leave-requests/${leave.id}/decision`, { decision: 'Approved' })).status, 403);
    assert.equal((await hodEce.get(`/api/hod/leave-requests/${leave.id}`)).status, 403);
    const rejected = await hodCse.post(`/api/hod/leave-requests/${leave.id}/decision`, { decision: 'Rejected', remarks: 'Internal assessment scheduled that week' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.rejectedStage, 'HOD');
    assert.ok(!(await warden.get('/api/warden/leave-requests?pending=1')).body.data.some((l: any) => l.id === leave.id));
    assert.equal((await warden.post(`/api/warden/leave-requests/${leave.id}/decision`, { decision: 'Approved', remarks: 'x' })).status, 409);
  });

  test('the Warden decides last and the student sees an accurate final status and history', async () => {
    const student = await ctx.as('stuB');
    const incharge = await ctx.as('advCse2');
    const hod = await ctx.as('hodCse');
    const warden = await ctx.as('warden');
    const leave = (await student.post('/api/student/leave-requests', { type: 'Festival Leave', ...futureLeave(40), reason: 'Family festival at the native place' })).body.data;
    await incharge.post(`/api/adviser/leave-requests/${leave.id}/decision`, { decision: 'Approved', remarks: 'No classes missed' });
    await hod.post(`/api/hod/leave-requests/${leave.id}/decision`, { decision: 'Approved', remarks: 'Approved' });
    const final = await warden.post(`/api/warden/leave-requests/${leave.id}/decision`, { decision: 'Rejected', remarks: 'Hostel audit that week' });
    assert.equal(final.status, 200);
    assert.equal(final.body.data.workflowStatus, 'Rejected');
    assert.equal(final.body.data.rejectedStage, 'Warden');

    // Signing out and back in preserves every decision
    const again = await ctx.as('stuB');
    const mine = (await again.get('/api/student/leave-requests')).body.data.find((l: any) => l.id === leave.id);
    assert.equal(mine.status, 'Rejected');
    assert.deepEqual(
      mine.approvals.map((a: any) => [a.stage, a.decision]),
      [
        ['Class Incharge', 'Approved'],
        ['HOD', 'Approved'],
        ['Warden', 'Rejected'],
      ],
    );
    assert.equal(mine.classInchargeRemarks, 'No classes missed');
    assert.equal(mine.hodRemarks, 'Approved');
    assert.equal(mine.rejectionReason, 'Hostel audit that week');
    assert.ok(mine.history.length >= 4);
  });

  test('a student with no section is told clearly instead of being routed elsewhere', async () => {
    const stuD = await ctx.as('stuD'); // ECE, no section on the profile
    const res = await stuD.post('/api/student/leave-requests', { type: 'Personal Leave', ...futureLeave(3), reason: '家 visit — routing should fail cleanly' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /class section/i);
    // Nothing was created
    assert.equal((await stuD.get('/api/student/leave-requests')).body.data.length, 0);
  });
});

describe('complaints: category, deadline, worker assignment', () => {
  let waterId = '';

  test('a Water Issue carries its configured priority, target and deadline', async () => {
    const student = await ctx.as('stuA');
    const categories = (await student.get('/api/student/complaint-categories')).body.data;
    const water = categories.find((c: any) => c.name === 'Water Issue');
    assert.equal(water.defaultPriority, 'High');
    assert.equal(water.targets.High, 8);

    const res = await student.post('/api/student/complaints', {
      categoryId: water.id,
      title: 'No water in the west wing washroom',
      priority: 'High',
      description: 'The washroom on the third floor has had no water since morning.',
      location: 'Block A, 3rd floor washroom',
    });
    assert.equal(res.status, 201);
    waterId = res.body.data.id;
    assert.equal(res.body.data.status, 'Submitted');
    assert.equal(res.body.data.priority, 'High');
    assert.equal(res.body.data.resolutionHours, 8);
    // Priority and resolution target are separate facts
    assert.equal(res.body.data.resolutionTarget, '8 hours');
    const deadlineIn = (Date.parse(res.body.data.deadlineAt) - Date.parse(res.body.data.submittedAt)) / 3_600_000;
    assert.equal(Math.round(deadlineIn), 8);
  });

  test('accepting routes the trade, assigns a worker and dispatches the job on its own', async () => {
    const warden = await ctx.as('warden');
    const listed = (await warden.get('/api/warden/complaints')).body.data.find((c: any) => c.id === waterId);
    assert.equal(listed.category, 'Water Issue');
    assert.equal(listed.priority, 'High');
    assert.ok(listed.deadlineDisplay !== '—' && listed.timeRemainingLabel.endsWith('left'));

    const accepted = await warden.post(`/api/warden/complaints/${waterId}/accept`, { note: 'Checked with the block supervisor' });
    assert.equal(accepted.status, 200);
    // The Warden's single step took the complaint all the way to an assigned worker
    assert.equal(accepted.body.data.status, 'Worker Assigned');
    const routing = accepted.body.data.autoRouting;
    assert.equal(routing.detectedTrade, 'Plumbing');
    assert.equal(routing.detectionSource, 'category');
    assert.equal(routing.worker.name, 'Plumber One');
    assert.equal(routing.worker.phone, '+91 90000 00001');
    assert.equal(accepted.body.data.workerName, 'Plumber One');
    assert.equal(accepted.body.data.workerPhone, '+91 90000 00001');
    // WhatsApp is not configured in the test environment, and that is reported, not faked
    assert.equal(routing.dispatch.status, 'Not Configured');
    assert.match(routing.summary, /Plumber One/);
    assert.equal(accepted.body.data.assignments.at(-1).autoAssigned, true);
    assert.equal(accepted.body.data.assignments.at(-1).detectionSource, 'category');
    assert.equal(accepted.body.data.assignments.at(-1).dispatchStatus, 'Not Configured');

    // A second accept is refused; the complaint has moved on
    assert.equal((await warden.post(`/api/warden/complaints/${waterId}/accept`, {})).status, 409);

    // Invalid transitions are refused
    assert.equal((await warden.patch(`/api/warden/complaints/${waterId}`, { status: 'Submitted' })).status, 409);
    // Resolving needs evidence
    assert.equal((await warden.patch(`/api/warden/complaints/${waterId}`, { status: 'Resolved' })).status, 400);
    const resolved = await warden.patch(`/api/warden/complaints/${waterId}`, { status: 'Resolved', resolutionNotes: 'Booster pump restarted and supply restored.' });
    assert.equal(resolved.body.data.status, 'Resolved');
    assert.equal(resolved.body.data.resolutionNotes, 'Booster pump restarted and supply restored.');

    // The student sees the same story, including the worker but not the phone number
    const student = await ctx.as('stuA');
    const mine = (await student.get('/api/student/complaints')).body.data.find((c: any) => c.id === waterId);
    assert.equal(mine.status, 'Resolved');
    assert.equal(mine.workerName, 'Plumber One');
    assert.equal(mine.workerPhone, undefined);
    assert.ok(mine.history.some((h: any) => h.action === 'accepted'));
    assert.ok(mine.history.some((h: any) => h.action === 'worker_assigned'));
    assert.ok(mine.history.some((h: any) => h.action === 'worker_dispatch_failed'));
    assert.ok(mine.history.some((h: any) => h.action === 'resolved'));
  });

  test('a category with no configured trade is routed from the wording, and one worker takes several such jobs', async () => {
    const student = await ctx.as('stuA');
    const other = (await student.get('/api/student/complaint-categories')).body.data.find((c: any) => c.name === 'Other Hostel Issue');
    assert.equal(other.workerCategory, null);

    const submit = (title: string, description: string) =>
      student.post('/api/student/complaints', { categoryId: other.id, title, priority: 'Medium', description, location: 'Block A, Room 101' });

    const first = (await submit('Ceiling fan dead', 'The ceiling fan stopped turning and the switch sparks when pressed.')).body.data.id;
    const second = (await submit('Tube light flickering', 'The tube light flickers all night and the socket near the bed is loose.')).body.data.id;

    const warden = await ctx.as('warden');
    const a1 = (await warden.post(`/api/warden/complaints/${first}/accept`, {})).body.data;
    assert.equal(a1.autoRouting.detectionSource, 'keywords');
    assert.equal(a1.autoRouting.detectedTrade, 'Electrical');
    assert.ok(a1.autoRouting.matchedKeywords.includes('fan'));
    assert.equal(a1.autoRouting.worker.name, 'Electrician One');
    assert.equal(a1.status, 'Worker Assigned');

    // The electrician is already holding a job, which does not stop the next one
    const a2 = (await warden.post(`/api/warden/complaints/${second}/accept`, {})).body.data;
    assert.equal(a2.autoRouting.detectedTrade, 'Electrical');
    assert.equal(a2.autoRouting.worker.name, 'Electrician One');
    assert.equal(a2.autoRouting.worker.liveJobs, 1);
    assert.equal(a2.status, 'Worker Assigned');
  });

  test('the worker reports the job from their own link, and only then does the Warden verify', async () => {
    const student = await ctx.as('stuA');
    const categories = (await student.get('/api/student/complaint-categories')).body.data;
    const electrical = categories.find((c: any) => c.name === 'Electrical Issue');
    const id = (
      await student.post('/api/student/complaints', {
        categoryId: electrical.id,
        title: 'Room fan not running',
        priority: 'High',
        description: 'The fan stopped last night and the room is unusable.',
        location: 'Block A, Room 101',
      })
    ).body.data.id;

    const warden = await ctx.as('warden');
    const accepted = (await warden.post(`/api/warden/complaints/${id}/accept`, {})).body.data;
    assert.equal(accepted.autoRouting.worker.name, 'Electrician One');
    // WhatsApp is unconfigured in tests, so the job link comes back for the Warden to pass on
    assert.equal(accepted.autoRouting.dispatch.status, 'Not Configured');
    const token = accepted.autoRouting.dispatch.link.split('/').pop();
    assert.ok(token);

    // The worker's own view: this job and nothing else, with no account
    const view = (await ctx.anon().get(`/api/worker/jobs/${token}`)).body.data;
    assert.equal(view.complaintId, id);
    assert.equal(view.workerName, 'Electrician One');
    assert.equal(view.canReport, true);
    assert.equal(view.title, 'Room fan not running');
    assert.equal(view.regNumber, undefined);
    assert.equal((await ctx.anon().get('/api/worker/jobs/not-a-real-token')).status, 404);

    // "Could not finish" must say why
    assert.equal((await ctx.anon().post(`/api/worker/jobs/${token}/report`, { outcome: 'Could Not Complete' })).status, 400);

    const reported = await ctx.anon().post(`/api/worker/jobs/${token}/report`, { outcome: 'Reported Done', note: 'Replaced the capacitor and the fan runs.' });
    assert.equal(reported.status, 200);
    assert.equal(reported.body.data.view.canReport, false);
    assert.equal(reported.body.data.status, 'In Progress');
    // One report per job
    assert.equal((await ctx.anon().post(`/api/worker/jobs/${token}/report`, { outcome: 'Reported Done' })).status, 409);

    // The Warden is left with exactly one step: verify and resolve
    const held = (await warden.get(`/api/warden/complaints/${id}`)).body.data;
    assert.equal(held.status, 'In Progress');
    assert.equal(held.workerReport.status, 'Reported Done');
    assert.equal(held.workerReport.workerName, 'Electrician One');
    assert.match(held.workerReport.note, /capacitor/);
    // Reporting does not resolve the complaint on the worker's word alone
    assert.notEqual(held.status, 'Resolved');

    const resolved = (await warden.patch(`/api/warden/complaints/${id}`, { status: 'Resolved', resolutionNotes: 'Checked the fan myself; it runs on all speeds.' })).body.data;
    assert.equal(resolved.status, 'Resolved');
    assert.equal(resolved.assignments.at(-1).status, 'Completed');

    // The job link stops working once the complaint is closed
    const after = (await ctx.anon().get(`/api/worker/jobs/${token}`)).body.data;
    assert.equal(after.canReport, false);

    const mine = (await student.get('/api/student/complaints')).body.data.find((c: any) => c.id === id);
    assert.ok(mine.history.some((h: any) => h.action === 'worker_reported_done'));
  });

  test('a complaint resolved inside its deadline never reaches the AO', async () => {
    const ao = await ctx.as('ao');
    assert.ok(!(await ao.get('/api/ao/complaints')).body.data.some((c: any) => c.id === waterId));
    // Even after the escalation job runs
    runReminderJobs();
    assert.ok(!(await ao.get('/api/ao/complaints')).body.data.some((c: any) => c.id === waterId));
  });

  test('an unresolved complaint past its deadline escalates to the AO by itself', async () => {
    const student = await ctx.as('stuC');
    const categories = (await student.get('/api/student/complaint-categories')).body.data;
    const electrical = categories.find((c: any) => c.name === 'Electrical Issue');
    const c = (
      await student.post('/api/student/complaints', {
        categoryId: electrical.id,
        title: 'Fan regulator sparking in the room',
        priority: 'High',
        description: 'The regulator sparks whenever the fan speed is changed.',
        location: 'Block A, Room A-102',
      })
    ).body.data;

    const ao = await ctx.as('ao');
    assert.ok(!(await ao.get('/api/ao/complaints')).body.data.some((x: any) => x.id === c.id), 'not escalated while inside its deadline');

    // Push the saved deadline into the past; nobody opens a dashboard, the job runs.
    ctx.db.run('UPDATE complaints SET deadline_at = ? WHERE id = ?', new Date(Date.now() - 3_600_000).toISOString(), c.id);
    runReminderJobs();

    const escalated = (await ao.get('/api/ao/complaints?reason=overdue')).body.data.find((x: any) => x.id === c.id);
    assert.ok(escalated, 'overdue complaint reached the AO queue');
    assert.deepEqual(escalated.escalationReasons, ['Deadline Exceeded']);
    assert.equal(escalated.id, c.id, 'the original complaint id is preserved');
    assert.ok(escalated.history.some((h: any) => h.action === 'submitted'), 'full history is preserved');

    // Running the job again creates no duplicate record and no second notification
    runReminderJobs();
    runReminderJobs();
    assert.equal(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM complaint_escalations WHERE complaint_id = ?`, c.id)!.n, 1);
    assert.equal(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE entity_id = ? AND event_type = 'complaint.escalated'`, c.id)!.n, 1);

    // The AO records a review action; resolving later keeps the escalation history
    const esc = escalated.escalations[0];
    const reviewed = await ao.post(`/api/ao/complaints/${c.id}/escalations/${esc.id}/review`, { status: 'Action Recorded', notes: 'Electrician deployed directly by the AO office.' });
    assert.equal(reviewed.status, 200);
    const done = await ao.patch(`/api/ao/complaints/${c.id}`, { status: 'Resolved', resolutionNotes: 'Regulator replaced and tested.' });
    assert.equal(done.body.data.status, 'Resolved');
    assert.equal(done.body.data.escalations.length, 1, 'escalation history retained after resolution');
    assert.equal(done.body.data.escalations[0].reason, 'Deadline Exceeded');
  });

  test('a complaint about the Warden goes to the AO and is hidden from the Warden', async () => {
    const student = await ctx.as('stuA');
    const categories = (await student.get('/api/student/complaint-categories')).body.data;
    const aboutWarden = categories.find((c: any) => c.name === 'Complaint About Warden');
    assert.equal(aboutWarden.routesToAO, true);
    const c = (
      await student.post('/api/student/complaints', {
        categoryId: aboutWarden.id,
        title: 'Review of how an evening permission was handled',
        description: 'Asking the Administrative Officer to review how an evening permission request was handled.',
        location: 'Hostel Office',
      })
    ).body.data;
    assert.equal(c.isAboutWarden, true);
    assert.deepEqual(c.escalationReasons, ['Complaint About Warden']);

    // The Warden can neither list it nor open it nor act on it
    const warden = await ctx.as('warden');
    assert.ok(!(await warden.get('/api/warden/complaints')).body.data.some((x: any) => x.id === c.id));
    assert.equal((await warden.get(`/api/warden/complaints/${c.id}`)).status, 403);
    assert.equal((await warden.post(`/api/warden/complaints/${c.id}/accept`, {})).status, 403);
    assert.equal((await warden.patch(`/api/warden/complaints/${c.id}`, { status: 'Accepted' })).status, 403);
    // And was never notified about it
    assert.ok(!(await warden.get('/api/notifications')).body.data.some((n: any) => n.entityId === c.id));

    const ao = await ctx.as('ao');
    const inQueue = (await ao.get('/api/ao/complaints?reason=warden')).body.data.find((x: any) => x.id === c.id);
    assert.ok(inQueue);
    assert.ok((await ao.get('/api/notifications')).body.data.some((n: any) => n.entityId === c.id));

    // Both reasons on one complaint: one record, one id, two reasons
    ctx.db.run('UPDATE complaints SET deadline_at = ? WHERE id = ?', new Date(Date.now() - 3_600_000).toISOString(), c.id);
    runReminderJobs();
    const both = (await ao.get('/api/ao/complaints')).body.data.filter((x: any) => x.id === c.id);
    assert.equal(both.length, 1, 'no duplicate complaint record');
    assert.deepEqual(both[0].escalationReasons.sort(), ['Complaint About Warden', 'Deadline Exceeded']);
  });

  test('an ordinary complaint stays with the Warden and never appears in the AO queue', async () => {
    const student = await ctx.as('stuB');
    const categories = (await student.get('/api/student/complaint-categories')).body.data;
    const clean = categories.find((c: any) => c.name === 'Cleanliness');
    const c = (
      await student.post('/api/student/complaints', {
        categoryId: clean.id,
        title: 'Corridor bins not cleared',
        description: 'The corridor waste bins have not been cleared for two days.',
        location: 'Block A, 1st floor corridor',
      })
    ).body.data;
    const warden = await ctx.as('warden');
    assert.ok((await warden.get('/api/warden/complaints')).body.data.some((x: any) => x.id === c.id));
    const ao = await ctx.as('ao');
    assert.ok(!(await ao.get('/api/ao/complaints')).body.data.some((x: any) => x.id === c.id));
  });

  test('resolution targets are configurable per category and priority', async () => {
    const admin = await ctx.as('admin');
    const categories = (await admin.get('/api/admin/complaint-categories')).body.data;
    const water = categories.find((c: any) => c.name === 'Water Issue');
    assert.equal((await admin.patch(`/api/admin/complaint-categories/${water.id}`, { targets: { High: 4 } })).status, 200);

    const student = await ctx.as('stuC');
    const res = await student.post('/api/student/complaints', {
      categoryId: water.id,
      title: 'Tap running dry on the second floor',
      priority: 'High',
      description: 'The tap next to the staircase has been dry since last evening.',
      location: 'Block A, 2nd floor',
    });
    assert.equal(res.body.data.resolutionHours, 4, 'the new target applies to new complaints');
    // A different priority in the same category keeps its own target
    const low = await student.post('/api/student/complaints', {
      categoryId: water.id,
      title: 'Slow drainage near the wash area',
      priority: 'Low',
      description: 'Water drains slowly near the wash area, no overflow yet.',
      location: 'Block A, wash area',
    });
    assert.equal(low.body.data.resolutionHours, 48);
  });

  test('a student may reopen their own resolved complaint and the Warden sees it again', async () => {
    const student = await ctx.as('stuA');
    const reopened = await student.post(`/api/student/complaints/${waterId}/reopen`, { note: 'Water stopped again the same evening.' });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.data.status, 'Reopened');
    assert.equal(reopened.body.data.reopenedCount, 1);
    // A fresh deadline is set from the same configured target
    assert.ok(Date.parse(reopened.body.data.deadlineAt) > Date.now());
    const warden = await ctx.as('warden');
    assert.ok((await warden.get('/api/warden/complaints')).body.data.some((c: any) => c.id === waterId && c.status === 'Reopened'));
    // Another student cannot reopen it
    const other = await ctx.as('stuB');
    assert.equal((await other.post(`/api/student/complaints/${waterId}/reopen`, { note: 'Not my complaint' })).status, 404);
  });
});
