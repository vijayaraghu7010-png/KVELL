import { db } from '../db/database';
import type { AuthUser } from '../lib/auth';
import { badRequest, conflict, notFound } from '../lib/http';
import { getNumberSetting, notify, recordEvent, usersWithRole } from '../lib/records';
import { fmtDateTime, nowIso, randomToken, sha256, uid } from '../lib/util';
import { approvalLink, mapsLink, sendApprovalRequest } from './whatsapp';

/**
 * Outing requests run Student -> Parent/Guardian (over WhatsApp) -> Warden.
 * A request is invisible to the Warden until a verified parent decision exists, and
 * approved outings carry GPS tracking state with alerts when tracking is interrupted.
 */

export const TRACKING_STATUSES = ['Not Started', 'Permission Granted', 'Active', 'Unavailable', 'Denied', 'Revoked', 'Stopped'] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

const linkValidityMs = () => getNumberSetting('outing.parent_link_hours') * 3_600_000;

export const studentUserId = (studentId: string) =>
  db().get<{ user_id: string | null }>('SELECT user_id FROM students WHERE id = ?', studentId)?.user_id ?? null;

// ---------------------------------------------------------------------------
// Parent / guardian approval
// ---------------------------------------------------------------------------
export interface ApprovalIssue {
  approvalId: string;
  token: string | null;
  link: string | null;
  delivery: { status: string; error: string | null; providerMessageId: string | null };
}

/**
 * Issues (or re-issues) the parent approval link and attempts WhatsApp delivery.
 * Any previously open link for the outing is superseded, so only one can be used.
 */
export async function issueParentApproval(outingId: string, actorId: string | null): Promise<ApprovalIssue> {
  const o = db().get<any>(
    `SELECT o.*, s.name AS student_name, s.parent_name, s.parent_phone FROM outing_requests o JOIN students s ON s.id = o.student_id WHERE o.id = ?`,
    outingId,
  );
  if (!o) throw notFound('Outing request');
  const phone = o.parent_phone || o.parent_phone_override;
  if (!phone) {
    throw badRequest('No parent/guardian phone number is stored on this student profile, so the approval request cannot be sent. Ask the hostel office to add one.', {
      fields: { parentPhone: 'Parent contact is missing from the student profile.' },
    });
  }

  const token = randomToken(32);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + linkValidityMs()).toISOString();
  const approvalId = uid('pap');

  db().transaction(() => {
    // Supersede any open link: the unique index allows only one undecided row.
    db().run(
      `UPDATE outing_parent_approvals SET decision = 'Rejected', decided_at = ?, decision_note = 'Superseded by a new approval link', updated_at = ?
       WHERE outing_id = ? AND decision IS NULL`,
      now,
      now,
      outingId,
    );
    db().run(
      `INSERT INTO outing_parent_approvals (id, outing_id, parent_name, parent_phone, token_hash, expires_at, channel, delivery_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'whatsapp', 'Pending', ?, ?)`,
      approvalId,
      outingId,
      o.parent_name ?? null,
      phone,
      sha256(token),
      expiresAt,
      now,
      now,
    );
    db().run('UPDATE outing_requests SET parent_phone = ?, updated_at = ? WHERE id = ?', phone, now, outingId);
  });

  const link = approvalLink(token);
  const delivery = await sendApprovalRequest({
    toPhone: phone,
    parentName: o.parent_name,
    studentName: o.student_name,
    outingId,
    destination: o.destination,
    outAt: fmtDateTime(o.out_at),
    returnAt: fmtDateTime(o.expected_return_at),
    locationLink: mapsLink(o.start_latitude, o.start_longitude),
    link,
  });

  db().run(
    'UPDATE outing_parent_approvals SET delivery_status = ?, provider_message_id = ?, delivery_error = ?, updated_at = ? WHERE id = ?',
    delivery.status,
    delivery.providerMessageId,
    delivery.error,
    nowIso(),
    approvalId,
  );
  recordEvent('outing_request', outingId, actorId, 'parent_approval_requested', {
    note: delivery.status === 'Sent' ? `WhatsApp message sent to the guardian number on file.` : `WhatsApp delivery: ${delivery.status}${delivery.error ? ` — ${delivery.error}` : ''}`,
  });
  return { approvalId, token: delivery.status === 'Sent' ? null : token, link, delivery };
}

/** Public, token-only view of a pending approval. Reveals nothing beyond this request. */
export function parentApprovalView(token: string) {
  const row = db().get<any>(
    `SELECT a.*, o.destination, o.reason, o.out_at, o.expected_return_at, o.status AS outing_status, o.outing_type,
            o.start_latitude, o.start_longitude,
            s.name AS student_name, s.reg_number, r.room_number
     FROM outing_parent_approvals a
     JOIN outing_requests o ON o.id = a.outing_id
     JOIN students s ON s.id = o.student_id
     LEFT JOIN rooms r ON r.id = s.room_id
     WHERE a.token_hash = ?`,
    sha256(String(token || '').trim()),
  );
  if (!row) throw notFound('Approval request');
  const expired = Date.parse(row.expires_at) < Date.now();
  return {
    outingId: row.outing_id,
    studentName: row.student_name,
    regNumber: row.reg_number,
    roomNumber: row.room_number || '—',
    destination: row.destination,
    reason: row.reason,
    outingType: row.outing_type,
    outAt: row.out_at,
    outAtDisplay: fmtDateTime(row.out_at),
    returnAt: row.expected_return_at,
    returnAtDisplay: fmtDateTime(row.expected_return_at),
    locationLink: mapsLink(row.start_latitude, row.start_longitude),
    parentName: row.parent_name,
    expiresAt: row.expires_at,
    expired,
    decision: row.decision as 'Approved' | 'Rejected' | null,
    decidedAt: row.decided_at,
    decidedAtDisplay: row.decided_at ? fmtDateTime(row.decided_at) : null,
    outingStatus: row.outing_status,
    canDecide: !row.decision && !expired && row.outing_status === 'Parent Approval Pending',
  };
}

/** Records the parent's decision. One token, one decision, bound to one request. */
export function parentDecide(token: string, decision: 'Approved' | 'Rejected', note: string | undefined, ip: string | null) {
  return db().transaction(() => {
    const row = db().get<any>('SELECT * FROM outing_parent_approvals WHERE token_hash = ?', sha256(String(token || '').trim()));
    if (!row) throw notFound('Approval request');
    if (row.decision) throw conflict('This request has already been answered.');
    if (Date.parse(row.expires_at) < Date.now()) throw conflict('This approval link has expired. Ask the hostel office to send a new one.');

    const o = db().get<any>(`SELECT o.*, s.name AS student_name, s.reg_number FROM outing_requests o JOIN students s ON s.id = o.student_id WHERE o.id = ?`, row.outing_id);
    if (!o) throw notFound('Outing request');
    if (o.status !== 'Parent Approval Pending') throw conflict(`This request is already "${o.status}".`);

    const now = nowIso();
    db().run(
      'UPDATE outing_parent_approvals SET decision = ?, decided_at = ?, decision_note = ?, decision_ip = ?, updated_at = ? WHERE id = ?',
      decision,
      now,
      note ?? null,
      ip,
      now,
      row.id,
    );
    const next = decision === 'Approved' ? 'Pending Warden' : 'Parent Rejected';
    db().run('UPDATE outing_requests SET status = ?, parent_decision = ?, parent_decided_at = ?, parent_note = ?, updated_at = ? WHERE id = ?', next, decision, now, note ?? null, now, row.outing_id);
    recordEvent('outing_request', row.outing_id, null, decision === 'Approved' ? 'parent_approved' : 'parent_rejected', {
      from: 'Parent Approval Pending',
      to: next,
      note: `${row.parent_name ?? 'Guardian'} (${row.parent_phone})${note ? ` — ${note}` : ''}`,
    });

    notify([studentUserId(o.student_id)], {
      eventType: decision === 'Approved' ? 'outing.parent_approved' : 'outing.parent_rejected',
      title: decision === 'Approved' ? `Parent approved outing ${o.id}` : `Parent declined outing ${o.id}`,
      message: decision === 'Approved' ? 'Your request has gone to the Warden for the final decision.' : note || 'Your parent/guardian declined this outing request.',
      entityType: 'outing_request',
      entityId: o.id,
      link: '/student/outing-permission',
      severity: decision === 'Approved' ? 'info' : 'alert',
      dedupeKey: `outing.parent:${o.id}`,
    });
    if (decision === 'Approved') {
      notify(usersWithRole('Warden'), {
        eventType: 'outing.pending_warden',
        title: `Outing ${o.id} awaiting your approval`,
        message: `${o.student_name} (${o.reg_number}) — parent approved ${fmtDateTime(now)}.`,
        entityType: 'outing_request',
        entityId: o.id,
        link: '/warden/outing-requests',
        dedupeKey: `outing.pending_warden:${o.id}`,
      });
    }
    return { outingId: o.id, decision, status: next };
  });
}

export function parentApprovalHistory(outingId: string) {
  return db()
    .all<any>('SELECT * FROM outing_parent_approvals WHERE outing_id = ? ORDER BY created_at', outingId)
    .map((a) => ({
      id: a.id,
      parentName: a.parent_name,
      // Only the last four digits are exposed; the full number stays with staff records.
      parentPhoneMasked: String(a.parent_phone).replace(/.(?=.{4})/g, '•'),
      channel: a.channel,
      deliveryStatus: a.delivery_status,
      deliveryError: a.delivery_error,
      providerMessageId: a.provider_message_id,
      decision: a.decision,
      decidedAt: a.decided_at ? fmtDateTime(a.decided_at) : null,
      note: a.decision_note,
      expiresAt: a.expires_at,
      requestedAt: fmtDateTime(a.created_at),
    }));
}

// ---------------------------------------------------------------------------
// GPS tracking
// ---------------------------------------------------------------------------
const INTERRUPTED: TrackingStatus[] = ['Unavailable', 'Denied', 'Revoked'];

export function trackingRow(outingId: string) {
  return db().get<any>('SELECT * FROM outing_tracking WHERE outing_id = ?', outingId) ?? null;
}

export function ensureTracking(outingId: string, studentId: string, consent: boolean) {
  const now = nowIso();
  db().run(
    `INSERT INTO outing_tracking (outing_id, student_id, consent, status, created_at, updated_at) VALUES (?, ?, ?, 'Not Started', ?, ?)
     ON CONFLICT(outing_id) DO UPDATE SET consent = excluded.consent, updated_at = excluded.updated_at`,
    outingId,
    studentId,
    consent ? 1 : 0,
    now,
    now,
  );
}

/**
 * Records one tracking report from the student's device.
 *
 * The device tells us only what the browser can actually observe: a fix, a
 * permission denial, or an error. We never infer "GPS was switched off" — an
 * interruption is reported as exactly the condition the device returned.
 */
export function recordTracking(
  user: AuthUser,
  outingId: string,
  input: { status: TrackingStatus; latitude?: number; longitude?: number; accuracyM?: number; reason?: string },
) {
  return db().transaction(() => {
    const o = db().get<any>(
      `SELECT o.*, s.name AS student_name, s.reg_number, s.parent_name, s.parent_phone, s.user_id AS student_user_id FROM outing_requests o JOIN students s ON s.id = o.student_id WHERE o.id = ?`,
      outingId,
    );
    if (!o) throw notFound('Outing request');
    if (user.role === 'Student' && o.student_id !== user.studentId) throw notFound('Outing request');
    if (o.status !== 'Approved') throw conflict('Location is only tracked for an approved outing.');

    const current = trackingRow(outingId);
    if (current?.status === 'Stopped') throw conflict('Tracking for this outing has already stopped.');
    const now = nowIso();
    ensureTracking(outingId, o.student_id, true);

    db().run(
      `INSERT INTO outing_location_pings (id, outing_id, student_id, latitude, longitude, accuracy_m, status, reason, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid('loc'),
      outingId,
      o.student_id,
      input.latitude ?? null,
      input.longitude ?? null,
      input.accuracyM ?? null,
      input.status,
      input.reason ?? null,
      now,
    );

    const hasFix = input.status === 'Active' && typeof input.latitude === 'number' && typeof input.longitude === 'number';
    db().run(
      `UPDATE outing_tracking SET status = ?,
         last_latitude = COALESCE(?, last_latitude), last_longitude = COALESCE(?, last_longitude), last_accuracy_m = COALESCE(?, last_accuracy_m),
         last_update_at = CASE WHEN ? THEN ? ELSE last_update_at END,
         interrupted_at = CASE WHEN ? THEN COALESCE(interrupted_at, ?) ELSE NULL END,
         interruption_reason = CASE WHEN ? THEN ? ELSE NULL END,
         updated_at = ?
       WHERE outing_id = ?`,
      input.status,
      hasFix ? input.latitude : null,
      hasFix ? input.longitude : null,
      hasFix ? input.accuracyM ?? null : null,
      hasFix ? 1 : 0,
      now,
      INTERRUPTED.includes(input.status) ? 1 : 0,
      now,
      INTERRUPTED.includes(input.status) ? 1 : 0,
      input.reason ?? input.status,
      now,
      outingId,
    );

    if (INTERRUPTED.includes(input.status)) alertTrackingInterrupted(outingId, input.reason ?? input.status);
    return trackingView(outingId, user);
  });
}

/**
 * Raises the interruption alert once per interruption, to the Warden and to the
 * student (who is asked to tell their guardian, since we cannot send a push to a
 * parent who has no account here; the guardian number is shown to the Warden).
 */
export function alertTrackingInterrupted(outingId: string, reason: string) {
  const t = trackingRow(outingId);
  if (!t) return;
  if (t.alerted_at && t.interrupted_at && Date.parse(t.alerted_at) >= Date.parse(t.interrupted_at)) return;
  const o = db().get<any>(
    `SELECT o.*, s.name AS student_name, s.reg_number, s.parent_name, s.parent_phone, s.user_id AS student_user_id FROM outing_requests o JOIN students s ON s.id = o.student_id WHERE o.id = ?`,
    outingId,
  );
  if (!o) return;
  const now = nowIso();
  const lastSeen = t.last_update_at ? fmtDateTime(t.last_update_at) : 'no location was ever received';
  db().run('UPDATE outing_tracking SET alerted_at = ?, updated_at = ? WHERE outing_id = ?', now, now, outingId);
  recordEvent('outing_request', outingId, null, 'tracking_interrupted', { note: `${reason}. Last update: ${lastSeen}.` });

  notify(usersWithRole('Warden'), {
    eventType: 'outing.tracking_interrupted',
    title: `Location tracking interrupted: ${o.student_name}`,
    message: `Outing ${outingId} — ${reason}. Last location update: ${lastSeen}. Guardian: ${o.parent_name ?? '—'} ${o.parent_phone ?? ''}`.trim(),
    entityType: 'outing_request',
    entityId: outingId,
    link: '/warden/outing-requests',
    severity: 'alert',
    dedupeKey: `outing.tracking:${outingId}:${t.interrupted_at ?? now}`,
  });
  notify([o.student_user_id], {
    eventType: 'outing.tracking_interrupted',
    title: 'Location sharing stopped',
    message: `Location tracking for outing ${outingId} is unavailable (${reason}). Re-enable location sharing, or contact the hostel office.`,
    entityType: 'outing_request',
    entityId: outingId,
    link: '/student/outing-permission',
    severity: 'alert',
    dedupeKey: `outing.tracking.student:${outingId}:${t.interrupted_at ?? now}`,
  });

  // The guardian has no account here, so the alert goes out over the same WhatsApp
  // channel when it is configured; otherwise the Warden has the number on screen.
  void notifyGuardianOfInterruption(o, reason, lastSeen);
}

async function notifyGuardianOfInterruption(o: any, reason: string, lastSeen: string) {
  const { isConfigured } = await import('./whatsapp');
  if (!isConfigured() || !o.parent_phone) return;
  const { sendApprovalRequest } = await import('./whatsapp');
  // Reuses the same authenticated sender; the "link" field carries the portal URL.
  await sendApprovalRequest({
    toPhone: o.parent_phone,
    parentName: o.parent_name,
    studentName: o.student_name,
    outingId: `${o.id} (tracking alert: ${reason})`,
    destination: o.destination,
    outAt: fmtDateTime(o.out_at),
    returnAt: fmtDateTime(o.expected_return_at),
    locationLink: mapsLink(o.start_latitude, o.start_longitude),
    link: `Location tracking is unavailable. Last location update: ${lastSeen}. Please contact the student if necessary.`,
  }).catch(() => undefined);
}

export function stopTracking(outingId: string, reason: string) {
  const t = trackingRow(outingId);
  if (!t || t.status === 'Stopped') return false;
  const now = nowIso();
  db().run(`UPDATE outing_tracking SET status = 'Stopped', stopped_at = ?, stop_reason = ?, updated_at = ? WHERE outing_id = ?`, now, reason, now, outingId);
  db().run(`INSERT INTO outing_location_pings (id, outing_id, student_id, status, reason, recorded_at) VALUES (?, ?, ?, 'Stopped', ?, ?)`, uid('loc'), outingId, t.student_id, reason, now);
  recordEvent('outing_request', outingId, null, 'tracking_stopped', { note: reason });
  return true;
}

export function trackingView(outingId: string, user: AuthUser) {
  const t = trackingRow(outingId);
  if (!t) return null;
  // Coordinates are operational data: students see their own, staff see the ones they supervise.
  const canSeeCoords = ['Warden', 'Dean', 'Admin', 'Security'].includes(user.role) || (user.role === 'Student' && t.student_id === user.studentId);
  return {
    outingId,
    consent: t.consent === 1,
    status: t.status as TrackingStatus,
    isInterrupted: INTERRUPTED.includes(t.status),
    lastLatitude: canSeeCoords ? t.last_latitude : null,
    lastLongitude: canSeeCoords ? t.last_longitude : null,
    lastAccuracyM: canSeeCoords ? t.last_accuracy_m : null,
    lastUpdateAt: t.last_update_at,
    lastUpdateDisplay: t.last_update_at ? fmtDateTime(t.last_update_at) : 'No location received',
    interruptedAt: t.interrupted_at ? fmtDateTime(t.interrupted_at) : null,
    interruptionReason: t.interruption_reason,
    alertedAt: t.alerted_at ? fmtDateTime(t.alerted_at) : null,
    stoppedAt: t.stopped_at ? fmtDateTime(t.stopped_at) : null,
    stopReason: t.stop_reason,
  };
}

export function locationHistory(outingId: string, limit = 100) {
  return db()
    .all<any>('SELECT * FROM outing_location_pings WHERE outing_id = ? ORDER BY recorded_at DESC LIMIT ?', outingId, limit)
    .map((p) => ({
      id: p.id,
      status: p.status,
      reason: p.reason,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyM: p.accuracy_m,
      recordedAt: p.recorded_at,
      recordedAtDisplay: fmtDateTime(p.recorded_at),
    }));
}

/**
 * Scheduled upkeep:
 *  - an approved outing that is tracking but has gone quiet past the configured
 *    threshold is treated as interrupted (what we can verify is the silence, not
 *    the cause, and the alert says so);
 *  - tracking stops once the outing is over or the student has checked back in;
 *  - pings older than the retention period are deleted.
 */
export function trackingUpkeep(now = new Date()): number {
  let alerts = 0;
  const staleBefore = new Date(now.getTime() - getNumberSetting('outing.tracking_stale_minutes') * 60_000).toISOString();
  for (const t of db().all<any>(
    `SELECT t.outing_id FROM outing_tracking t JOIN outing_requests o ON o.id = t.outing_id
     WHERE t.status = 'Active' AND o.status = 'Approved' AND (t.last_update_at IS NULL OR t.last_update_at < ?)`,
    staleBefore,
  )) {
    db().transaction(() => {
      db().run(`UPDATE outing_tracking SET status = 'Unavailable', interrupted_at = COALESCE(interrupted_at, ?), interruption_reason = ?, updated_at = ? WHERE outing_id = ?`,
        now.toISOString(),
        'No location update received — the device may have lost GPS, connectivity or permission.',
        now.toISOString(),
        t.outing_id,
      );
      alertTrackingInterrupted(t.outing_id, 'No location update received within the configured interval');
      alerts++;
    });
  }

  // Stop tracking when the outing window has closed or the student is back inside.
  for (const o of db().all<any>(
    `SELECT o.id, o.expected_return_at, o.status,
       (SELECT p.status FROM outpasses p WHERE p.source_type = 'Outing' AND p.source_id = o.id) AS pass_status
     FROM outing_requests o JOIN outing_tracking t ON t.outing_id = o.id
     WHERE t.status != 'Stopped'`,
  )) {
    const finished = o.status === 'Cancelled' || o.status === 'Rejected' || o.pass_status === 'Completed' || o.expected_return_at < now.toISOString();
    if (finished) stopTracking(o.id, o.pass_status === 'Completed' ? 'Student checked back in at the gate.' : `Outing window closed (${fmtDateTime(o.expected_return_at)}).`);
  }

  const retentionCutoff = new Date(now.getTime() - getNumberSetting('location.retention_days') * 86_400_000).toISOString();
  db().run('DELETE FROM outing_location_pings WHERE recorded_at < ?', retentionCutoff);
  return alerts;
}
