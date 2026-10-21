import { db } from './db/database';
import { notify } from './lib/records';
import { fmtDateTime, nowIso } from './lib/util';
import { escalateOverdueComplaints } from './services/complaints';
import { autoEndScheduledSessions, autoStartScheduledSessions, reconcileExpiredSessions } from './services/studySessions';
import { trackingUpkeep } from './services/outings';

/**
 * Periodic in-app reminders. Every notification carries a dedupe key, so running the job
 * repeatedly (or on several restarts) never produces duplicates.
 */
export function runReminderJobs(now = new Date()): number {
  const nowStr = now.toISOString();
  const in24h = new Date(now.getTime() + 24 * 3_600_000).toISOString();
  let sent = 0;

  // Complaints past their saved resolution deadline escalate to the AO on their own,
  // without anyone opening a dashboard. Escalation records are unique per reason, so
  // a complaint is never escalated twice for the same reason.
  sent += escalateOverdueComplaints(now);

  // The study timetable set in the institutional rules: open today's session for
  // every department once its start time has passed, and close it at the end time.
  // Both are idempotent, so the job may run as often as it likes.
  autoStartScheduledSessions(now);
  autoEndScheduledSessions(now);

  // Study sessions whose start-QR window has closed: absences are settled server-side,
  // so a student who never scanned is marked Absent whether or not the Adviser ends
  // the session, and an expired QR can no longer change that.
  reconcileExpiredSessions(now);

  // Approved outings: raise the tracking-interruption alert, stop tracking once the
  // outing is over, and drop location pings past the retention period.
  sent += trackingUpkeep(now);

  // Assignment deadlines approaching / overdue
  for (const r of db().all<any>(
    `SELECT ar.id, ar.user_id, ar.due_at, a.id AS aid, a.title, a.created_by FROM assignment_recipients ar JOIN assignments a ON a.id = ar.assignment_id
     WHERE a.status = 'Active' AND ar.status IN ('Assigned','Acknowledged','In Progress','Revision Requested') AND ar.due_at <= ?`,
    in24h,
  )) {
    if (r.due_at > nowStr) {
      sent += notify([r.user_id], {
        eventType: 'assignment.deadline_approaching',
        title: `Due soon: ${r.title}`,
        message: `Deadline ${fmtDateTime(r.due_at)}.`,
        entityType: 'assignment',
        entityId: r.aid,
        link: '/tasks',
        severity: 'warning',
        dedupeKey: `assignment.due_soon:${r.id}:${r.due_at}`,
      });
    } else {
      sent += notify([r.user_id, r.created_by], {
        eventType: 'assignment.overdue',
        title: `Overdue: ${r.title}`,
        message: `Deadline was ${fmtDateTime(r.due_at)}.`,
        entityType: 'assignment',
        entityId: r.aid,
        link: '/tasks',
        severity: 'alert',
        dedupeKey: `assignment.overdue:${r.id}:${r.due_at}`,
      });
    }
  }

  // Report submission deadlines approaching
  for (const r of db().all<any>(
    `SELECT rr.id, rr.user_id, q.id AS qid, q.title, q.deadline_at FROM report_recipients rr JOIN report_requests q ON q.id = rr.request_id
     WHERE q.status = 'Distributed' AND q.requires_submission = 1 AND rr.status IN ('Distributed','Acknowledged','Revision Requested') AND q.deadline_at BETWEEN ? AND ?`,
    nowStr,
    in24h,
  )) {
    sent += notify([r.user_id], {
      eventType: 'report.deadline_approaching',
      title: `Report due soon: ${r.title}`,
      message: `Submission deadline ${fmtDateTime(r.deadline_at)}.`,
      entityType: 'report_request',
      entityId: r.qid,
      link: '/report-requests',
      severity: 'warning',
      dedupeKey: `report.due_soon:${r.id}:${r.deadline_at}`,
    });
  }

  // Schedule reminders (only when the Dean configured a reminder)
  for (const s of db().all<any>(
    `SELECT s.id, s.title, s.start_at, s.location, s.reminder_minutes FROM schedules s WHERE s.status IN ('Scheduled','Rescheduled') AND s.reminder_minutes IS NOT NULL AND s.start_at > ?`,
    nowStr,
  )) {
    if (Date.parse(s.start_at) - now.getTime() > s.reminder_minutes * 60_000) continue;
    const participants = db().all<{ user_id: string }>(`SELECT user_id FROM schedule_participants WHERE schedule_id = ? AND response != 'Declined'`, s.id).map((p) => p.user_id);
    sent += notify(participants, {
      eventType: 'schedule.reminder',
      title: `Reminder: ${s.title}`,
      message: `Starts ${fmtDateTime(s.start_at)}${s.location ? ` · ${s.location}` : ''}.`,
      entityType: 'schedule',
      entityId: s.id,
      link: '/schedule',
      dedupeKey: `schedule.reminder:${s.id}:${s.start_at}`,
    });
  }
  return sent;
}

// A minute's granularity: the timetable should open a session at the time the
// office set, not up to five minutes later.
export function startJobs(intervalMs = 60_000) {
  const tick = () => {
    try {
      const n = runReminderJobs();
      if (n) console.log(`[jobs] ${n} reminder notification(s) created at ${nowIso()}`);
    } catch (err) {
      console.error('[jobs] reminder job failed', err);
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}
