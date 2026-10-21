import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localDate } from '../server/lib/util';
import { runReminderJobs } from '../server/jobs';
import { approveOutingAsParent, inHours, start, type TestContext } from './helpers';

let ctx: TestContext;
before(async () => {
  ctx = await start();
});
after(async () => ctx.close());

/** A session that covers the whole day, so the start window is open while testing. */
const allDay = (title: string) => ({ title, date: localDate(), startTime: '00:05', endTime: '23:50', location: 'Reading Hall' });

/** Pushes a QR's expiry into the past, the way the clock would. */
const expireQr = (sessionId: string, phase: 'Start' | 'End') =>
  ctx.db.run('UPDATE study_session_qr SET expires_at = ? WHERE session_id = ? AND phase = ?', new Date(Date.now() - 60_000).toISOString(), sessionId, phase);

describe('study sessions: Hosteller Adviser, QR attendance, reconciliation', () => {
  test('an Admin sets each Adviser’s responsibility and only the Hosteller one may conduct sessions', async () => {
    const admin = await ctx.as('admin');
    const users = (await admin.get('/api/admin/users')).body.data;
    assert.equal(users.find((u: any) => u.email === 'advCse@test.local').studentCategory, 'Hosteller');
    assert.equal(users.find((u: any) => u.email === 'advEce@test.local').studentCategory, 'Out / Day Scholar');

    // Only Hosteller advisers are offered for assignment
    const offered = (await admin.get('/api/study-sessions/advisers')).body.data;
    assert.ok(offered.some((a: any) => a.id === ctx.fx.ids.advCse));
    assert.ok(!offered.some((a: any) => a.id === ctx.fx.ids.advEce));

    // The day-scholar Adviser gets no session controls and cannot create one
    const dayScholar = await ctx.as('advEce');
    const mine = (await dayScholar.get('/api/adviser/study-sessions')).body.data;
    assert.equal(mine.canConductSessions, false);
    assert.equal((await dayScholar.post('/api/study-sessions', allDay('Day scholar session'))).status, 400);

    // The Dean cannot assign a session to a day-scholar Adviser either
    const dean = await ctx.as('dean');
    assert.equal((await dean.post('/api/study-sessions', { ...allDay('Wrong adviser'), adviserId: ctx.fx.ids.advEce })).status, 400);

    // An Admin can switch the responsibility, and it takes effect
    assert.equal((await admin.patch(`/api/admin/users/${ctx.fx.ids.advEce}`, { studentCategory: 'Hosteller' })).body.data.studentCategory, 'Hosteller');
    assert.ok((await admin.get('/api/study-sessions/advisers')).body.data.some((a: any) => a.id === ctx.fx.ids.advEce));
    await admin.patch(`/api/admin/users/${ctx.fx.ids.advEce}`, { studentCategory: 'Out / Day Scholar' });
  });

  test('start → notify → scan → expiry → reconciliation → end, with a separate end QR', async () => {
    const adviser = await ctx.as('advCse');
    const student = await ctx.as('stuA');
    const other = await ctx.as('stuB');

    const created = await adviser.post('/api/study-sessions', allDay('QR attendance session'));
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    assert.equal(created.body.data.status, 'Scheduled');
    assert.equal(created.body.data.canStart, true, created.body.data.cannotStartReason ?? '');

    // No QR exists before the session is started
    assert.equal((await student.get(`/api/student/study-sessions/${id}/qr`)).status, 409);

    const started = await adviser.post(`/api/adviser/study-sessions/${id}/start`);
    assert.equal(started.status, 200);
    assert.equal(started.body.data.session.status, 'In Progress');
    const startToken = started.body.data.token;
    assert.ok(startToken && startToken.startsWith('KVS-'), 'a start token was issued');
    const validityMinutes = Math.round((Date.parse(started.body.data.expiresAt) - Date.parse(started.body.data.session.startedAt)) / 60_000);
    assert.equal(validityMinutes, 10, 'the start QR is valid for 10 minutes');

    // Starting twice is refused
    assert.equal((await adviser.post(`/api/adviser/study-sessions/${id}/start`)).status, 409);
    // Another Adviser cannot start or end it
    const otherAdviser = await ctx.as('advCse2');
    assert.equal((await otherAdviser.post(`/api/adviser/study-sessions/${id}/end`)).status, 403);

    // The roster student is notified and can read the QR from their own portal
    assert.ok((await student.get('/api/notifications')).body.data.some((n: any) => n.entityId === id && n.eventType === 'study.started'));
    const qr = await student.get(`/api/student/study-sessions/${id}/qr`);
    assert.equal(qr.status, 200);
    assert.equal(qr.body.data.token, startToken, 'the student sees the same session token');
    // A student who is not on the roster cannot read it
    assert.equal((await other.get(`/api/student/study-sessions/${id}/qr`)).status, 403);

    // A valid scan records attendance, exactly once
    const scan = await student.post('/api/student/study-sessions/scan', { token: startToken });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.data.attendanceStatus, 'Present');
    assert.equal((await student.post('/api/student/study-sessions/scan', { token: startToken })).status, 409, 'one attendance record per session');
    // Another student cannot use this session's QR at all
    assert.equal((await other.post('/api/student/study-sessions/scan', { token: startToken })).status, 409);
    // A made-up token is refused
    assert.equal((await student.post('/api/student/study-sessions/scan', { token: 'KVS-not-a-real-token' })).status, 400);

    // Once the QR expires it can no longer record anything
    expireQr(id, 'Start');
    assert.equal((await student.post('/api/student/study-sessions/scan', { token: startToken })).status, 409);
    assert.equal((await student.get(`/api/student/study-sessions/${id}/qr`)).status, 409);

    // Ending issues a different QR, linked to the same session
    const ended = await adviser.post(`/api/adviser/study-sessions/${id}/end`);
    assert.equal(ended.status, 200);
    assert.equal(ended.body.data.session.status, 'Completed');
    const endToken = ended.body.data.token;
    assert.ok(endToken.startsWith('KVE-'));
    assert.notEqual(endToken, startToken, 'the end QR is a different code');
    assert.equal(Math.round((Date.parse(ended.body.data.expiresAt) - Date.now()) / 60_000), 5, 'the end QR has its own shorter window');
    // The start QR stays dead
    assert.equal((await student.post('/api/student/study-sessions/scan', { token: startToken })).status, 409);

    // The end scan is recorded separately and does not touch the start attendance
    const endScan = await student.post('/api/student/study-sessions/scan', { token: endToken });
    assert.equal(endScan.status, 200);
    assert.equal(endScan.body.data.phase, 'End');
    assert.equal(endScan.body.data.attendanceStatus, 'Present');
    const roster = (await adviser.get(`/api/study-sessions/${id}/roster`)).body.data.roster;
    const mine = roster.find((r: any) => r.regNumber === 'CS001');
    assert.ok(mine.startScanAt && mine.endScanAt, 'start and end scans are kept as separate records');
  });

  test('a student who never scans is Absent, and the end scan cannot undo it', async () => {
    const adviser = await ctx.as('advCse2');
    const student = await ctx.as('stuB');
    const id = (await adviser.post('/api/study-sessions', { ...allDay('Absence session'), location: 'Hall B' })).body.data.id;
    await adviser.post(`/api/adviser/study-sessions/${id}/start`);

    // Before the window closes the student is pending, not yet absent
    let mine = (await student.get('/api/student/study-sessions/live')).body.data.find((x: any) => x.id === id);
    assert.equal(mine.myStatus, 'Pending Reconciliation');

    // The window closes with no scan; the scheduled job settles the attendance
    expireQr(id, 'Start');
    runReminderJobs();
    mine = (await student.get('/api/student/study-sessions/live')).body.data.find((x: any) => x.id === id);
    assert.equal(mine.myStatus, 'Absent');
    assert.ok((await student.get('/api/notifications')).body.data.some((n: any) => n.entityId === id && n.eventType === 'study.absent'));

    // Ending the session issues the end QR; scanning it never converts Absent to Present
    const ended = await adviser.post(`/api/adviser/study-sessions/${id}/end`);
    const endScan = await student.post('/api/student/study-sessions/scan', { token: ended.body.data.token });
    assert.equal(endScan.status, 200);
    assert.equal(endScan.body.data.attendanceStatus, 'Absent', 'an end scan never overwrites a missing start scan');
    assert.match(endScan.body.data.message, /unchanged/i);

    // And it survives a fresh session
    const again = await ctx.as('stuB');
    const after = (await again.get('/api/student/study-sessions/live')).body.data.find((x: any) => x.id === id);
    assert.equal(after.myStatus, 'Absent');
    assert.ok(after.endScanAt, 'the end scan is still recorded alongside the absence');
  });
});

describe('outing requests: parent approval over WhatsApp, then the Warden', () => {
  test('the Warden sees nothing until a verified parent decision exists', async () => {
    const student = await ctx.as('stuC');
    const warden = await ctx.as('warden');

    const status = (await student.get('/api/student/whatsapp-status')).body.data;
    assert.equal(status.provider, 'WhatsApp Business Cloud API');
    // Nothing is faked: with no credentials the app says so and names what is missing
    assert.equal(status.configured, false);
    assert.ok(status.missing.includes('WHATSAPP_ACCESS_TOKEN'));

    // Consent is required up front
    assert.equal((await student.post('/api/student/outing-requests', { destination: 'Mall', reason: 'Shopping trip', outAt: inHours(30), expectedReturnAt: inHours(33) })).status, 400);

    // So is the location fix: the guardian approves knowing where the student is
    const noFix = await student.post('/api/student/outing-requests', {
      destination: 'Mall',
      reason: 'Shopping trip',
      outAt: inHours(30),
      expectedReturnAt: inHours(33),
      locationConsent: true,
    });
    assert.equal(noFix.status, 400);
    assert.ok(noFix.body.details?.fields?.latitude, 'the missing location is reported against the field');

    const created = await student.post('/api/student/outing-requests', {
      destination: 'City Library',
      reason: 'Reference reading for the project',
      outAt: inHours(30),
      expectedReturnAt: inHours(33),
      locationConsent: true,
      latitude: 13.0827,
      longitude: 80.2707,
      accuracyM: 12,
    });
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    assert.equal(created.body.data.status, 'Parent Approval Pending');
    assert.equal(created.body.data.parentApproval.delivery.status, 'Not Configured');
    assert.ok(created.body.data.parentApproval.link === null || typeof created.body.data.parentApproval.link === 'string');

    // Invisible to the Warden, and undecidable by them
    assert.ok(!(await warden.get('/api/warden/outing-requests')).body.data.some((o: any) => o.id === id));
    assert.equal((await warden.post(`/api/warden/outing-requests/${id}/decision`, { decision: 'Approved' })).status, 409);

    // The parent approves through their own link
    await approveOutingAsParent(ctx, id, 'Approved', 'Fine by me.');
    const listed = (await warden.get('/api/warden/outing-requests?pending=1')).body.data.find((o: any) => o.id === id);
    assert.ok(listed, 'the request reaches the Warden only after parent approval');
    assert.equal(listed.parentDecision, 'Approved');
    assert.ok((await warden.get('/api/notifications')).body.data.some((n: any) => n.entityId === id));
    // The guardian's number is masked in the approval history
    assert.match(listed.parentApprovals[0].parentPhoneMasked, /^•+\d{4}$/);

    const decided = await warden.post(`/api/warden/outing-requests/${id}/decision`, { decision: 'Approved', remarks: 'Back before curfew.' });
    assert.equal(decided.status, 200);
    assert.ok((await student.get('/api/notifications')).body.data.some((n: any) => n.entityId === id && n.title.includes('approved')));
  });

  test('a parent rejection stops the request there', async () => {
    const student = await ctx.as('stuD');
    const warden = await ctx.as('warden');
    const id = (
      await student.post('/api/student/outing-requests', { destination: 'Home town', reason: 'Family errand downtown', outAt: inHours(50), expectedReturnAt: inHours(54), locationConsent: true, latitude: 13.0827, longitude: 80.2707, accuracyM: 12 })
    ).body.data.id;
    await approveOutingAsParent(ctx, id, 'Rejected', 'Not this weekend.');
    const mine = (await student.get('/api/student/outing-requests')).body.data.find((o: any) => o.id === id);
    assert.equal(mine.status, 'Parent Rejected');
    assert.ok(!(await warden.get('/api/warden/outing-requests')).body.data.some((o: any) => o.id === id));
    assert.equal((await warden.post(`/api/warden/outing-requests/${id}/decision`, { decision: 'Approved' })).status, 409);
    assert.ok((await student.get('/api/notifications')).body.data.some((n: any) => n.entityId === id && n.eventType === 'outing.parent_rejected'));
  });

  test('an approval link is single-use, bound to its request, and expires', async () => {
    const student = await ctx.as('stuC');
    const id = (
      await student.post('/api/student/outing-requests', { destination: 'Clinic', reason: 'Routine dental appointment', outAt: inHours(70), expectedReturnAt: inHours(73), locationConsent: true, latitude: 13.0827, longitude: 80.2707, accuracyM: 12 })
    ).body.data.id;
    const { issueParentApproval } = await import('../server/services/outings');
    const issued = await issueParentApproval(id, null);
    const token = issued.token!;

    // The public view exposes only this request
    const view = await ctx.anon().get(`/api/parent/outings/${token}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.data.outingId, id);
    assert.equal(view.body.data.canDecide, true);
    assert.equal(view.body.data.studentName, 'Student stuC');

    assert.equal((await ctx.anon().post(`/api/parent/outings/${token}/decision`, { decision: 'Approved' })).status, 200);
    // A second decision on the same link is refused
    assert.equal((await ctx.anon().post(`/api/parent/outings/${token}/decision`, { decision: 'Rejected' })).status, 409);
    // An unknown token reveals nothing
    assert.equal((await ctx.anon().get('/api/parent/outings/not-a-real-token')).status, 404);

    // Re-issuing supersedes the old link, and an expired link cannot be used
    const second = await issueParentApproval(id, null);
    ctx.db.run('UPDATE outing_parent_approvals SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), second.approvalId);
    const expired = await ctx.anon().get(`/api/parent/outings/${second.token}`);
    assert.equal(expired.body.data.expired, true);
    assert.equal(expired.body.data.canDecide, false);
  });

  test('a verified tracking interruption alerts the Warden and the student, and tracking stops on time', async () => {
    const student = await ctx.as('stuA');
    const warden = await ctx.as('warden');
    const id = (
      await student.post('/api/student/outing-requests', { destination: 'Book fair', reason: 'Department book fair visit', outAt: inHours(1), expectedReturnAt: inHours(4), locationConsent: true, latitude: 13.0827, longitude: 80.2707, accuracyM: 12 })
    ).body.data.id;
    await approveOutingAsParent(ctx, id);
    await warden.post(`/api/warden/outing-requests/${id}/decision`, { decision: 'Approved', remarks: 'Approved.' });

    // A position fix keeps tracking active
    const active = await student.post(`/api/student/outing-requests/${id}/tracking`, { status: 'Active', latitude: 12.97, longitude: 79.15, accuracyM: 12 });
    assert.equal(active.status, 200);
    assert.equal(active.body.data.status, 'Active');
    assert.ok(active.body.data.lastUpdateAt);

    // The device reports that permission was revoked — a condition we can verify
    const revoked = await student.post(`/api/student/outing-requests/${id}/tracking`, { status: 'Revoked', reason: 'Location permission was revoked on the device' });
    assert.equal(revoked.body.data.status, 'Revoked');
    assert.equal(revoked.body.data.isInterrupted, true);
    assert.ok(revoked.body.data.lastUpdateDisplay !== 'No location received', 'the last known fix is retained');

    const wardenAlert = (await warden.get('/api/notifications')).body.data.find((n: any) => n.entityId === id && n.eventType === 'outing.tracking_interrupted');
    assert.ok(wardenAlert, 'the Warden is alerted');
    assert.match(wardenAlert.message, /Last location update/i);
    assert.match(wardenAlert.message, /\d{4}$/, 'the guardian contact is included for the Warden');
    assert.ok((await student.get('/api/notifications')).body.data.some((n: any) => n.entityId === id && n.eventType === 'outing.tracking_interrupted'));

    // The Warden sees the same tracking record
    const view = (await warden.get(`/api/warden/outing-requests/${id}/tracking`)).body.data;
    assert.equal(view.tracking.status, 'Revoked');
    assert.equal(view.history[0].status, 'Revoked');

    // Once the outing window has passed, the scheduled job stops tracking
    ctx.db.run(
      'UPDATE outing_requests SET out_at = ?, expected_return_at = ? WHERE id = ?',
      new Date(Date.now() - 3 * 3_600_000).toISOString(),
      new Date(Date.now() - 60_000).toISOString(),
      id,
    );
    runReminderJobs();
    assert.equal((await warden.get(`/api/warden/outing-requests/${id}/tracking`)).body.data.tracking.status, 'Stopped');
    // And no further location may be recorded
    assert.equal((await student.post(`/api/student/outing-requests/${id}/tracking`, { status: 'Active', latitude: 1, longitude: 1 })).status, 409);
  });
});

describe('gate scanning: one canonical event in both logbooks', () => {
  test('a valid scan is recorded once and is identical in the Warden and Security logbooks', async () => {
    const student = await ctx.as('stuB');
    const warden = await ctx.as('warden');
    const security = await ctx.as('security');

    const id = (
      await student.post('/api/student/outing-requests', { destination: 'Stationery shop', reason: 'Buying project materials', outAt: inHours(1), expectedReturnAt: inHours(3), locationConsent: true, latitude: 13.0827, longitude: 80.2707, accuracyM: 12 })
    ).body.data.id;
    await approveOutingAsParent(ctx, id);
    await warden.post(`/api/warden/outing-requests/${id}/decision`, { decision: 'Approved', remarks: 'Approved.' });
    const pass = (await student.get('/api/student/outpasses')).body.data.find((p: any) => p.sourceId === id);
    assert.ok(pass, 'an approved outing issues a pass');

    const scan = await security.post('/api/security/scan', { qrToken: pass.qrToken, type: 'Exit', gate: 'Main Gate', deviceId: 'GATE-TAB-01' });
    assert.equal(scan.status, 201);
    const eventId = scan.body.data.scan.id;
    assert.equal(scan.body.data.scan.status, 'Approved');

    // Exactly one canonical row backs both views
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM gate_movements WHERE id = ?', eventId)!.n, 1);
    const wardenRow = (await warden.get('/api/warden/gate-log')).body.data.find((g: any) => g.id === eventId);
    const securityRow = (await security.get('/api/security/movements?limit=200')).body.data.find((g: any) => g.id === eventId);
    assert.ok(wardenRow && securityRow);
    assert.equal(wardenRow.occurredAt, securityRow.occurredAt);
    assert.equal(wardenRow.type, 'Exit');
    assert.equal(wardenRow.deviceId, 'GATE-TAB-01');
    assert.equal(wardenRow.outingId, id, 'the event is linked to the approved outing');

    // The Warden can filter the same events
    assert.ok((await warden.get(`/api/warden/gate-log?type=Exit&result=Approved&studentId=${ctx.fx.students.stuB}`)).body.data.some((g: any) => g.id === eventId));
    assert.ok(!(await warden.get('/api/warden/gate-log?type=Entry')).body.data.some((g: any) => g.id === eventId));

    // A repeat scan is recorded as a duplicate and does not produce a second successful exit
    const dup = await security.post('/api/security/scan', { qrToken: pass.qrToken, type: 'Exit', gate: 'Main Gate' });
    assert.equal(dup.body.data.isDuplicate, true);
    assert.equal(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM gate_movements WHERE student_id = ? AND movement_type = 'Exit' AND status = 'Approved'`, ctx.fx.students.stuB)!.n, 1);

    // Security may annotate the canonical event, and the note shows in both logbooks
    const noted = await security.post(`/api/security/gate-events/${eventId}/notes`, { note: 'Student carried a laptop bag.' });
    assert.equal(noted.status, 200);
    assert.match((await warden.get('/api/warden/gate-log')).body.data.find((g: any) => g.id === eventId).securityNotes, /laptop bag/);

    // Security cannot approve outings or rewrite an approval history
    assert.equal((await security.post(`/api/warden/outing-requests/${id}/decision`, { decision: 'Rejected', remarks: 'x' })).status, 403);
    assert.equal((await security.get('/api/warden/gate-log')).status, 403);
  });

  test('an unrecognised QR is recorded as a rejected scan, not as a movement', async () => {
    const security = await ctx.as('security');
    const warden = await ctx.as('warden');
    const before = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM gate_movements WHERE status = 'Approved'`)!.n;
    const res = await security.post('/api/security/scan', { qrToken: 'KVCET-NOT-A-REAL-PASS', type: 'Exit', gate: 'Main Gate', deviceId: 'GATE-TAB-01' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.rejected, true);
    assert.equal(res.body.data.scan.status, 'Rejected');
    assert.equal(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM gate_movements WHERE status = 'Approved'`)!.n, before, 'no successful movement was invented');
    const row = (await warden.get('/api/warden/gate-log?result=Rejected')).body.data.find((g: any) => g.id === res.body.data.scan.id);
    assert.ok(row);
    assert.match(row.rejectionReason, /does not match any issued outpass/i);
    assert.ok((await warden.get('/api/notifications')).body.data.some((n: any) => n.entityId === res.body.data.scan.id));
  });
});

describe('night roll call: closed is final, except a return scan at the gate', () => {
  test('a closed roll call rejects manual edits, and an "On Outing" student is set present by their own return scan', async () => {
    const student = await ctx.as('stuD');
    const warden = await ctx.as('warden');
    const security = await ctx.as('security');
    const date = localDate();
    const studentId = ctx.fx.students.stuD;

    const id = (
      await student.post('/api/student/outing-requests', {
        destination: 'Pharmacy',
        reason: 'Collecting a prescription',
        outAt: inHours(1),
        expectedReturnAt: inHours(3),
        locationConsent: true,
        latitude: 13.0827,
        longitude: 80.2707,
        accuracyM: 12,
      })
    ).body.data.id;
    await approveOutingAsParent(ctx, id);
    await warden.post(`/api/warden/outing-requests/${id}/decision`, { decision: 'Approved', remarks: 'Approved.' });
    const pass = (await student.get('/api/student/outpasses')).body.data.find((p: any) => p.sourceId === id);
    assert.equal((await security.post('/api/security/scan', { qrToken: pass.qrToken, type: 'Exit', gate: 'Hostel Gate' })).body.data.scan.status, 'Approved');

    await warden.post('/api/attendance/mark', { date, entries: [{ studentId, status: 'On Outing' }] });
    const closed = await warden.post('/api/attendance/close', { date });
    assert.equal(closed.status, 200);

    // Nothing the Warden types can change a closed roll call any more
    const late = await warden.post('/api/attendance/mark', { date, entries: [{ studentId, status: 'Absent' }] });
    assert.equal(late.status, 409);
    assert.equal(ctx.db.get<{ status: string }>('SELECT status FROM attendance_records WHERE student_id = ? AND att_date = ?', studentId, date)!.status, 'On Outing');

    // The student's own return scan is the one thing that does
    const entry = await security.post('/api/security/scan', { qrToken: pass.qrToken, type: 'Entry', gate: 'Hostel Gate' });
    assert.equal(entry.status, 201);
    const rec = ctx.db.get<{ status: string; method: string }>('SELECT status, method FROM attendance_records WHERE student_id = ? AND att_date = ?', studentId, date)!;
    assert.equal(rec.status, 'Present');
    assert.equal(rec.method, 'Gate Return Scan');
  });
});
