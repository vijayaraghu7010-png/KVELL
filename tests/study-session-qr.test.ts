import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localDate, localTime } from '../server/lib/util';

/** '19:00' + minutes → '19:10', the way the portals show a session's window. */
const addClockMinutes = (hhmm: string, minutes: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
import { runReminderJobs } from '../server/jobs';
import { start, type TestContext } from './helpers';

let ctx: TestContext;
before(async () => {
  ctx = await start();
});
after(async () => ctx.close());

/** Covers the whole day, so the start window is open while the test runs. */
const openAllDay = { startTime: '00:05', endTime: '23:50' };
const expireQr = (sessionId: string, phase: 'Start' | 'End') =>
  ctx.db.run('UPDATE study_session_qr SET expires_at = ? WHERE session_id = ? AND phase = ?', new Date(Date.now() - 60_000).toISOString(), sessionId, phase);

describe('study session: schedule → start → scan → end', () => {
  test('1–2. the Adviser schedules a session with department, section and named students', async () => {
    const adviser = await ctx.as('advCse');
    const student = await ctx.as('stuA');

    const mine = (await adviser.get('/api/adviser/my-students')).body.data;
    assert.ok(mine.length >= 1, 'the Adviser can list their own advisees to assign');
    assert.equal(mine[0].regNumber, 'CS001');

    const created = await adviser.post('/api/study-sessions', {
      title: 'Scheduled evening study',
      date: addDays(localDate(), 3),
      ...openAllDay,
      location: 'Block A Reading Hall',
      department: 'CSE',
      section: 'A',
      year: 2,
      studentIds: [ctx.fx.students.stuA],
    });
    assert.equal(created.status, 201);
    const s = created.body.data;
    assert.equal(s.status, 'Scheduled');
    assert.equal(s.department, 'CSE');
    assert.equal(s.section, 'A');
    assert.equal(s.rosterSource, 'Named students');
    assert.equal(s.expected, 1);

    // It shows in the Adviser's own list and in the assigned student's portal
    assert.ok((await adviser.get('/api/adviser/study-sessions')).body.data.sessions.some((x: any) => x.id === s.id));
    const studentView = (await student.get(`/api/student/study-sessions/live?from=${localDate()}&to=${addDays(localDate(), 7)}`)).body.data;
    assert.ok(studentView.some((x: any) => x.id === s.id), 'the assigned student sees the scheduled session');

    // A student who is not assigned does not see it
    const other = await ctx.as('stuB');
    assert.ok(!(await other.get(`/api/student/study-sessions/live?from=${localDate()}&to=${addDays(localDate(), 7)}`)).body.data.some((x: any) => x.id === s.id));

    // An Adviser cannot assign students who are not theirs
    assert.equal(
      (await adviser.post('/api/study-sessions', { title: 'Not my students', date: addDays(localDate(), 3), ...openAllDay, location: 'Hall', studentIds: [ctx.fx.students.stuC] })).status,
      400,
    );
  });

  test('3. the session cannot be started on an unauthorized date, or by another Adviser', async () => {
    const adviser = await ctx.as('advCse');
    const future = await adviser.post('/api/study-sessions', { title: 'Future session', date: addDays(localDate(), 2), ...openAllDay, location: 'Hall B' });
    assert.equal(future.body.data.canStart, false);
    assert.match(future.body.data.cannotStartReason, /can only be started on/i);
    const blocked = await adviser.post(`/api/adviser/study-sessions/${future.body.data.id}/start`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.message, /can only be started on/i);

    // Today's session is startable, but only by the Adviser it belongs to
    const today = await adviser.post('/api/study-sessions', { title: 'Today session', date: localDate(), ...openAllDay, location: 'Hall C' });
    assert.equal(today.body.data.canStart, true);
    const otherAdviser = await ctx.as('advCse2');
    assert.equal((await otherAdviser.post(`/api/adviser/study-sessions/${today.body.data.id}/start`)).status, 409);
  });

  test('4–10. start, notify, scan, duplicate, impersonation, expiry', async () => {
    const adviser = await ctx.as('advCse');
    const student = await ctx.as('stuA');
    const outsider = await ctx.as('stuB');

    const created = await adviser.post('/api/study-sessions', {
      title: 'QR attendance session',
      date: localDate(),
      ...openAllDay,
      location: 'Reading Hall',
      studentIds: [ctx.fx.students.stuA],
    });
    const id = created.body.data.id;

    // 4–5. Starting opens the attendance window and issues a unique code
    const started = await adviser.post(`/api/adviser/study-sessions/${id}/start`);
    assert.equal(started.status, 200);
    assert.equal(started.body.data.session.status, 'In Progress');
    assert.ok(started.body.data.session.startedAt, 'the actual start timestamp is saved');
    const token = started.body.data.token;
    assert.match(token, /^KVS-/);
    assert.equal(Math.round((Date.parse(started.body.data.expiresAt) - Date.parse(started.body.data.session.startedAt)) / 60_000), 10);
    // No duplicate starts
    assert.equal((await adviser.post(`/api/adviser/study-sessions/${id}/start`)).status, 409);

    // 6. The assigned student has a persisted notification with the session detail
    const note = (await student.get('/api/notifications')).body.data.find((n: any) => n.entityId === id && n.eventType === 'study.started');
    assert.ok(note, 'a persisted notification was created');
    assert.match(note.title, /QR attendance session/);
    assert.match(note.message, /scan the QR your Adviser is showing/i);
    assert.equal(note.link, '/student/notifications');
    // And can read the QR from their own portal
    const qr = await student.get(`/api/student/study-sessions/${id}/qr`);
    assert.equal(qr.status, 200);
    assert.equal(qr.body.data.token, token);

    // 7. A valid scan records Present with a timestamp
    const scan = await student.post('/api/student/study-sessions/scan', { token });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.data.attendanceStatus, 'Present');
    assert.ok(scan.body.data.scannedAt);

    // 8. A duplicate scan is rejected and leaves one record
    assert.equal((await student.post('/api/student/study-sessions/scan', { token })).status, 409);
    assert.equal(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM study_scans WHERE session_id = ? AND phase = 'Start' AND result = 'Accepted'`, id)!.n, 1);

    // 9. Nobody can scan on another student's behalf
    assert.equal((await outsider.post('/api/student/study-sessions/scan', { token })).status, 409);
    assert.equal((await outsider.get(`/api/student/study-sessions/${id}/qr`)).status, 403);
    const rejected = ctx.db.get<any>(`SELECT student_id, reason FROM study_scans WHERE session_id = ? AND result = 'Rejected' ORDER BY scanned_at DESC LIMIT 1`, id);
    assert.equal(rejected.student_id, ctx.fx.students.stuB);
    assert.match(rejected.reason, /not on the roster/i);

    // 10. Once the 10-minute window passes the token is dead, server-side
    expireQr(id, 'Start');
    const late = await student.post('/api/student/study-sessions/scan', { token });
    assert.equal(late.status, 409);
    assert.match(late.body.message, /expired/i);
    assert.equal((await student.get(`/api/student/study-sessions/${id}/qr`)).status, 409);
  });

  test('the Adviser-side scanner records attendance through the same checks', async () => {
    const adviser = await ctx.as('advCse2');
    const student = await ctx.as('stuB');
    const created = await adviser.post('/api/study-sessions', { title: 'Scanner session', date: localDate(), ...openAllDay, location: 'Hall D', studentIds: [ctx.fx.students.stuB] });
    const id = created.body.data.id;
    await adviser.post(`/api/adviser/study-sessions/${id}/start`);

    // The student shows their own code; the Adviser scans it
    const mine = await student.get(`/api/student/study-sessions/${id}/my-code`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.phase, 'Start');
    assert.match(mine.body.data.code, /^KVA-/);

    const scanned = await adviser.post(`/api/adviser/study-sessions/${id}/scan-student`, { code: mine.body.data.code });
    assert.equal(scanned.status, 200);
    assert.equal(scanned.body.data.attendanceStatus, 'Present');
    assert.equal(scanned.body.data.regNumber, 'CS002');
    // Scanning the same student twice is refused
    assert.equal((await adviser.post(`/api/adviser/study-sessions/${id}/scan-student`, { code: mine.body.data.code })).status, 409);
    // A made-up code is refused
    assert.equal((await adviser.post(`/api/adviser/study-sessions/${id}/scan-student`, { code: 'KVA-nonsense' })).status, 400);
    // Another Adviser cannot use this session's scanner
    const otherAdviser = await ctx.as('advCse');
    assert.equal((await otherAdviser.post(`/api/adviser/study-sessions/${id}/scan-student`, { code: mine.body.data.code })).status, 403);
    // And the code dies with the window
    expireQr(id, 'Start');
    assert.equal((await student.get(`/api/student/study-sessions/${id}/my-code`)).status, 409);
  });

  test('11–14. reconciliation, the end QR, and attendance that survives a new session', async () => {
    const adviser = await ctx.as('advCse');
    const present = await ctx.as('stuA');
    const created = await adviser.post('/api/study-sessions', {
      title: 'Reconciliation session',
      date: localDate(),
      ...openAllDay,
      location: 'Hall E',
      studentIds: [ctx.fx.students.stuA],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    assert.equal(created.body.data.expected, 1);
    assert.equal(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM study_session_students WHERE session_id = ?', id)!.n, 1);

    const started = await adviser.post(`/api/adviser/study-sessions/${id}/start`);
    const startToken = started.body.data.token;

    // 11. A student who never scans is Absent once the window closes and the job runs
    const absentSession = await adviser.post('/api/study-sessions', { title: 'Nobody scans', date: localDate(), ...openAllDay, location: 'Hall F', studentIds: [ctx.fx.students.stuA] });
    assert.equal(absentSession.status, 201, JSON.stringify(absentSession.body));
    const absentId = absentSession.body.data.id;
    await adviser.post(`/api/adviser/study-sessions/${absentId}/start`);
    expireQr(absentId, 'Start');
    runReminderJobs();
    const afterJob = (await present.get('/api/student/study-sessions/live')).body.data.find((x: any) => x.id === absentId);
    assert.equal(afterJob.myStatus, 'Absent');

    // 12. Ending issues a different end QR, with its own window
    await present.post('/api/student/study-sessions/scan', { token: startToken });
    const ended = await adviser.post(`/api/adviser/study-sessions/${id}/end`);
    assert.equal(ended.status, 200);
    assert.ok(ended.body.data.session.endedAt, 'the actual end timestamp is saved');
    assert.notEqual(ended.body.data.token, startToken);
    assert.match(ended.body.data.token, /^KVE-/);
    assert.equal((await present.post('/api/student/study-sessions/scan', { token: startToken })).status, 409, 'the start QR is invalidated');

    // 13. An end scan never converts Absent into Present
    const absentAdviser = await ctx.as('advCse');
    const absentEnded = await absentAdviser.post(`/api/adviser/study-sessions/${absentId}/end`);
    const endScan = await present.post('/api/student/study-sessions/scan', { token: absentEnded.body.data.token });
    assert.equal(endScan.status, 200);
    assert.equal(endScan.body.data.attendanceStatus, 'Absent');
    assert.match(endScan.body.data.message, /unchanged/i);
    const roster = (await absentAdviser.get(`/api/study-sessions/${absentId}/roster`)).body.data.roster[0];
    assert.equal(roster.status, 'Absent');
    assert.ok(roster.endScanAt && !roster.startScanAt, 'the end scan is kept as its own record');

    // 14. Attendance persists across a fresh sign-in
    const again = await ctx.as('stuA');
    const persisted = (await again.get('/api/student/study-sessions/live')).body.data;
    assert.equal(persisted.find((x: any) => x.id === id).myStatus, 'Present');
    assert.equal(persisted.find((x: any) => x.id === absentId).myStatus, 'Absent');
  });
});

describe('study session: the Adviser starts one on the spot', () => {
  test('one button creates and starts the session, announces it department-wide and notifies the Adviser', async () => {
    const adviser = await ctx.as('advCse2');
    // Earlier cases leave a session running for this Adviser; only one runs at a time.
    for (const x of (await adviser.get('/api/adviser/study-sessions')).body.data.sessions.filter((y: any) => y.status === 'In Progress')) {
      await adviser.post(`/api/adviser/study-sessions/${x.id}/end`);
    }

    const started = await adviser.post('/api/adviser/study-sessions/start-now');
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const s = started.body.data.session;
    assert.equal(s.status, 'In Progress', 'no scheduling step: it is running immediately');
    assert.equal(s.date, localDate());
    assert.match(started.body.data.token, /^KVS-/);
    assert.equal(s.department, 'CSE', 'the session covers the Adviser’s own department');
    assert.ok(s.expected >= 2, 'its roster is every CSE hosteller, not just this Adviser’s advisees');

    // The roster student can scan it straight away
    const rosterStudent = await ctx.as('stuB');
    const scan = await rosterStudent.post('/api/student/study-sessions/scan', { token: started.body.data.token });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.data.attendanceStatus, 'Present');

    // Everyone in the department is told, even a student outside this session's roster
    const notified = async (key: string) =>
      (await (await ctx.as(key)).get('/api/notifications')).body.data.filter((n: any) => n.entityId === s.id);
    assert.ok((await notified('stuB')).some((n: any) => n.eventType === 'study.started'), 'the roster student is notified');
    assert.ok((await notified('stuA')).some((n: any) => n.eventType === 'study.started'), 'a CSE hosteller advised by someone else is notified too');
    assert.equal((await notified('stuC')).length, 0, 'a student in another department is not');
    assert.ok((await notified('advCse2')).some((n: any) => n.eventType === 'study.started.adviser'), 'the Adviser gets their own notification');

    // ...and they can use it: the session covers the department, not one Adviser's advisees
    const otherAdvisee = await ctx.as('stuA');
    assert.ok((await otherAdvisee.get('/api/student/study-sessions/live')).body.data.some((x: any) => x.id === s.id));
    const otherScan = await otherAdvisee.post('/api/student/study-sessions/scan', { token: started.body.data.token });
    assert.equal(otherScan.status, 200, JSON.stringify(otherScan.body));
    assert.equal(otherScan.body.data.attendanceStatus, 'Present');

    // A hosteller in another department is still outside it
    assert.equal((await (await ctx.as('stuC')).get(`/api/student/study-sessions/${s.id}/qr?phase=Start`)).status, 403);

    // A second session cannot be started while this one runs
    const again = await (await ctx.as('advCse2')).post('/api/adviser/study-sessions/start-now');
    assert.equal(again.status, 409);

    // Only a Hosteller Adviser may start one
    assert.equal((await (await ctx.as('advEce')).post('/api/adviser/study-sessions/start-now')).status, 403);

    // Ending it frees the Adviser to start another
    const ended = await (await ctx.as('advCse2')).post(`/api/adviser/study-sessions/${s.id}/end`);
    assert.equal(ended.status, 200);
    assert.equal(ended.body.data.session.status, 'Completed');
    const next = await (await ctx.as('advCse2')).post('/api/adviser/study-sessions/start-now');
    assert.equal(next.status, 200);
  });

  test('the Adviser gives only a start and an end time, and those are what the session runs on', async () => {
    const adviser = await ctx.as('advCse2');
    for (const x of (await adviser.get('/api/adviser/study-sessions')).body.data.sessions.filter((y: any) => y.status === 'In Progress')) {
      await adviser.post(`/api/adviser/study-sessions/${x.id}/end`);
    }

    const started = await adviser.post('/api/adviser/study-sessions/start-now', { startTime: '00:05', endTime: '23:50' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.data.session.startTime, '00:05');
    assert.equal(started.body.data.session.endTime, '23:50');
    assert.ok(started.body.data.session.location, 'the venue comes from the institutional default, not the Adviser');
    await adviser.post(`/api/adviser/study-sessions/${started.body.data.session.id}/end`);

    // End before start is refused, and so is a start time far in the future
    assert.equal((await adviser.post('/api/adviser/study-sessions/start-now', { startTime: '10:00', endTime: '09:00' })).status, 400);
    assert.equal((await adviser.post('/api/adviser/study-sessions/start-now', { startTime: '25:00', endTime: '23:00' })).status, 400);
  });

  test('the session detail answers canStart for the Adviser reading it', async () => {
    const adviser = await ctx.as('advCse');
    const scheduled = await adviser.post('/api/study-sessions', { title: 'Startable today', date: localDate(), ...openAllDay, location: 'Hall G', studentIds: [ctx.fx.students.stuA] });
    assert.equal(scheduled.status, 201, JSON.stringify(scheduled.body));
    const detail = (await adviser.get(`/api/adviser/study-sessions/${scheduled.body.data.id}`)).body.data;
    assert.equal(detail.session.canStart, true, 'the Start button in the detail modal must not be dead');
    assert.equal(detail.session.cannotStartReason, null);
  });
});

describe('study session: the timetable opens and closes it without anyone pressing anything', () => {
  /** Writes an institutional rule the way the office does from the settings page. */
  const rule = (key: string, value: string) =>
    ctx.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      new Date().toISOString(),
    );

  test('at the configured time every department gets one session, its students the QR and its Advisers the scanner', async () => {
    // Nothing of the earlier cases may still be running, or the department guard applies.
    for (const key of ['advCse', 'advCse2']) {
      const c = await ctx.as(key);
      for (const x of (await c.get('/api/adviser/study-sessions')).body.data.sessions.filter((y: any) => y.status === 'In Progress')) {
        await c.post(`/api/adviser/study-sessions/${x.id}/end`);
      }
    }
    ctx.db.run(`DELETE FROM study_sessions WHERE auto_started = 1`);
    rule('study.auto_enabled', 'true');
    rule('study.auto_start_time', localTime());
    rule('study.auto_days', 'Daily');
    rule('study.qr_start_minutes', '10');

    const { autoStartScheduledSessions, autoEndScheduledSessions } = await import('../server/services/studySessions');
    assert.ok(autoStartScheduledSessions() >= 1, 'the timetable opens at least the CSE session');
    // Running the job again must not open a second one, nor notify anybody twice
    assert.equal(autoStartScheduledSessions(), 0, 'a second run opens nothing');

    const adviser = await ctx.as('advCse');
    const auto = (await adviser.get('/api/adviser/study-sessions')).body.data.sessions.find((x: any) => x.status === 'In Progress');
    assert.ok(auto, 'the Adviser sees the session the timetable opened');
    assert.equal(auto.department, 'CSE');
    assert.equal(auto.startTime, localTime(), 'it runs from the time the office set');
    assert.equal(auto.endTime, addClockMinutes(localTime(), 10), 'and for exactly the ten minutes the QR lives');

    // Its QR is available to a Hosteller Adviser of that department who is not the
    // account the session is recorded against
    const otherAdviser = await ctx.as('advCse2');
    const qr = await otherAdviser.get(`/api/adviser/study-sessions/${auto.id}/qr?phase=Start`);
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    assert.ok(qr.body.data.token, 'the QR token reaches the Adviser portal');
    assert.equal(qr.body.data.live, true);
    const scannerNote = (await otherAdviser.get('/api/notifications')).body.data.filter((n: any) => n.entityId === auto.id);
    assert.ok(scannerNote.some((n: any) => n.eventType === 'study.started.adviser'), 'every Hosteller Adviser of the department gets the scanner');

    // Students of that department get the QR and can record attendance with it
    const student = await ctx.as('stuA');
    const notes = (await student.get('/api/notifications')).body.data.filter((n: any) => n.entityId === auto.id);
    assert.equal(notes.filter((n: any) => n.eventType === 'study.started').length, 1, 'exactly one notification, however often the job runs');
    const scan = await student.post('/api/student/study-sessions/scan', { token: qr.body.data.token });
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.equal(scan.body.data.attendanceStatus, 'Present');

    // Nobody can open a competing session for the same department
    assert.equal((await (await ctx.as('advCse2')).post('/api/adviser/study-sessions/start-now')).status, 409);

    // It is still open while the QR is live
    assert.equal(autoEndScheduledSessions(), 0, 'nothing closes while the ten minutes are running');

    // Once the QR expires the job closes it and settles the absences
    ctx.db.run(`UPDATE study_session_qr SET expires_at = ? WHERE session_id = ? AND phase = 'Start'`, new Date(Date.now() - 1000).toISOString(), auto.id);
    assert.ok(autoEndScheduledSessions() >= 1, 'the session closes itself when its ten minutes are up');
    const after = (await adviser.get(`/api/adviser/study-sessions/${auto.id}`)).body.data.session;
    assert.equal(after.status, 'Completed');
    assert.ok(after.reconciledAt, 'absences were settled when it closed');
    assert.equal(autoEndScheduledSessions(), 0, 'closing is idempotent too');
    const marked = (await adviser.get(`/api/adviser/study-sessions/${auto.id}`)).body.data.roster.find((r: any) => r.regNumber === 'CS001');
    assert.equal(marked.status, 'Present', 'the student who scanned keeps their attendance');
  });

  test('a new study time opens its own session the same day, and a missed one still opens inside the grace', async (t) => {
    // Every case below needs an earlier time of day to exist, so the hour after
    // midnight is the one hour this cannot be checked in.
    if (localTime() < '01:00') return t.skip('run within an hour of midnight: no earlier study time to set');
    const { autoStartScheduledSessions } = await import('../server/services/studySessions');
    const running = async () => {
      const c = await ctx.as('advCse');
      for (const x of (await c.get('/api/adviser/study-sessions')).body.data.sessions.filter((y: any) => y.status === 'In Progress')) {
        await c.post(`/api/adviser/study-sessions/${x.id}/end`);
      }
    };
    await running();
    ctx.db.run(`DELETE FROM study_sessions WHERE auto_started = 1`);
    rule('study.auto_enabled', 'true');
    rule('study.auto_days', 'Daily');
    rule('study.qr_start_minutes', '10');
    rule('study.auto_grace_minutes', '10');

    // The office sets one time; its session opens and a repeat tick opens nothing.
    rule('study.auto_start_time', addClockMinutes(localTime(), -1));
    assert.ok(autoStartScheduledSessions() >= 1, 'the first study time opens its session');
    assert.equal(autoStartScheduledSessions(), 0, 'the same time does not open a second one');
    await running();

    // The office then moves the study time. That is a different session of the same
    // day, so it must open — the old behaviour keyed on the day alone and lost it.
    rule('study.auto_start_time', localTime());
    assert.ok(autoStartScheduledSessions() >= 1, 'the changed study time opens a session of its own');
    const adviser = await ctx.as('advCse');
    const slots = (await adviser.get('/api/adviser/study-sessions')).body.data.sessions.filter((x: any) => x.date === localDate() && x.department === 'CSE');
    assert.ok(slots.length >= 2, 'both of the day’s study times are on record');
    await running();

    // A time whose window has passed still opens inside the grace the office allows,
    // and records the time it actually opened so the QR and the screen agree.
    ctx.db.run(`DELETE FROM study_sessions WHERE auto_started = 1`);
    const missed = addClockMinutes(localTime(), -15);
    rule('study.auto_start_time', missed);
    assert.ok(autoStartScheduledSessions() >= 1, 'a session missed by five minutes still opens');
    const late = (await adviser.get('/api/adviser/study-sessions')).body.data.sessions.find((x: any) => x.status === 'In Progress');
    assert.equal(late.startTime, localTime(), 'it is recorded from the moment it actually opened');
    assert.equal(late.endTime, addClockMinutes(localTime(), 10), 'and runs the full QR length from there');
    assert.equal(autoStartScheduledSessions(), 0, 'the late session is still opened only once');
    await running();

    // Past the grace, nothing opens.
    ctx.db.run(`DELETE FROM study_sessions WHERE auto_started = 1`);
    rule('study.auto_start_time', addClockMinutes(localTime(), -45));
    assert.equal(autoStartScheduledSessions(), 0, 'past the grace the day’s session is not opened late');
    rule('study.auto_grace_minutes', '10');
  });

  test('the timetable stays shut when the office turns it off, or on a day it does not run', async () => {
    const { autoStartScheduledSessions } = await import('../server/services/studySessions');
    ctx.db.run(`DELETE FROM study_sessions WHERE auto_started = 1`);
    rule('study.auto_enabled', 'false');
    assert.equal(autoStartScheduledSessions(), 0, 'turned off, nothing opens');

    rule('study.auto_enabled', 'true');
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Kolkata' });
    const otherDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter((d) => d !== today);
    rule('study.auto_days', otherDays.join(','));
    assert.equal(autoStartScheduledSessions(), 0, 'not a day it runs');

    rule('study.auto_days', 'Daily');
    rule('study.auto_start_time', '23:59');
    assert.equal(autoStartScheduledSessions(), 0, 'its start time has not arrived yet');

    rule('study.auto_start_time', '00:01');
    assert.equal(autoStartScheduledSessions(), 0, 'and its ten minutes are long past');
  });
});

describe('institutional rules: the study timetable can actually be saved', () => {
  test('the office saves times, days and switches — and typos are refused', async () => {
    const admin = await ctx.as('admin');
    for (const [key, value] of [
      ['study.auto_start_time', '19:00'],
      ['study.auto_days', 'Mon,Tue,Wed,Thu,Fri'],
      ['study.auto_enabled', 'false'],
      ['study.default_location', 'Block A Reading Hall'],
    ] as const) {
      const res = await admin.put(`/api/meta/settings/${key}`, { value });
      assert.equal(res.status, 200, `${key}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.data.value, value);
    }
    assert.equal((await admin.put('/api/meta/settings/study.auto_start_time', { value: 'half seven' })).status, 400);
    assert.equal((await admin.put('/api/meta/settings/study.auto_days', { value: 'Moonday' })).status, 400);
    assert.equal((await admin.put('/api/meta/settings/study.auto_enabled', { value: 'maybe' })).status, 400);
    assert.equal((await admin.put('/api/meta/settings/study.qr_start_minutes', { value: 'ten' })).status, 400);

    // Every portal reads the saved rule, not the default it shipped with
    const dean = await ctx.as('dean');
    const read = (await dean.get('/api/meta/settings')).body.data.find((s: any) => s.key === 'study.auto_start_time');
    assert.equal(read.value, '19:00');
    assert.equal(read.isDefault, false);
  });
});

describe('study attendance log', () => {
  test('the Dean sees every record; a Hosteller Adviser sees the sessions they conduct', async () => {
    const dean = await ctx.as('dean');
    const all = (await dean.get(`/api/study/attendance-log?from=${addDays(localDate(), -30)}&to=${localDate()}`)).body.data;
    assert.ok(all.rows.length > 0, 'the log has the records the earlier sessions left');
    assert.equal(all.totals.marked, all.rows.length);
    assert.ok(all.totals.sessions >= 1);
    const row = all.rows[0];
    for (const field of ['sessionId', 'dateDisplay', 'name', 'regNumber', 'department', 'status', 'adviserName']) {
      assert.ok(field in row, `the row carries ${field}`);
    }
    assert.ok(all.rows.some((r: any) => r.department === 'ECE') || all.rows.some((r: any) => r.department === 'CSE'));

    // A Hosteller Adviser only ever reads their own department's sessions
    const adviser = await ctx.as('advCse');
    const mine = (await adviser.get(`/api/study/attendance-log?from=${addDays(localDate(), -30)}&to=${localDate()}`)).body.data;
    assert.ok(mine.rows.length > 0);
    assert.ok(
      mine.rows.every((r: any) => r.department === 'CSE'),
      'an Adviser never sees another department in the log',
    );
    assert.ok(mine.rows.length <= all.rows.length);

    // Filters narrow it the same way for both
    const absentOnly = (await dean.get(`/api/study/attendance-log?from=${addDays(localDate(), -30)}&to=${localDate()}&status=Absent`)).body.data;
    assert.ok(absentOnly.rows.every((r: any) => r.status === 'Absent'));
    const ece = (await dean.get(`/api/study/attendance-log?from=${addDays(localDate(), -30)}&to=${localDate()}&department=ECE`)).body.data;
    assert.ok(ece.rows.every((r: any) => r.department === 'ECE'));

    // A student has no business reading it at all
    assert.equal((await (await ctx.as('stuA')).get('/api/study/attendance-log')).status, 403);
  });
});
