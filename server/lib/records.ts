import type { Request } from 'express';
import { db } from '../db/database';
import { nowIso, uid } from './util';

// ---------------------------------------------------------------------------
// Audit log — who did what, to which record.
// ---------------------------------------------------------------------------
export function audit(req: Request | null, action: string, entityType?: string, entityId?: string, details?: unknown) {
  db().run(
    'INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, details_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    req?.user?.id ?? null,
    req?.user?.role ?? null,
    action,
    entityType ?? null,
    entityId ?? null,
    details === undefined ? null : JSON.stringify(details),
    req?.ip ?? null,
    nowIso(),
  );
}

// ---------------------------------------------------------------------------
// Entity history — append-only timeline per workflow record.
// ---------------------------------------------------------------------------
export function recordEvent(
  entityType: string,
  entityId: string,
  actorId: string | null,
  action: string,
  opts: { from?: string | null; to?: string | null; note?: string | null } = {},
) {
  db().run(
    'INSERT INTO entity_events (entity_type, entity_id, actor_id, action, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    entityType,
    entityId,
    actorId,
    action,
    opts.from ?? null,
    opts.to ?? null,
    opts.note ?? null,
    nowIso(),
  );
}

export interface EventRow {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
}

export function getEvents(entityType: string, entityId: string): EventRow[] {
  return db()
    .all<any>(
      `SELECT e.*, u.name AS actor_name, u.role AS actor_role
       FROM entity_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.entity_type = ? AND e.entity_id = ? ORDER BY e.id`,
      entityType,
      entityId,
    )
    .map((r) => ({
      id: r.id,
      action: r.action,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      note: r.note,
      createdAt: r.created_at,
      actorId: r.actor_id,
      actorName: r.actor_name,
      actorRole: r.actor_role,
    }));
}

// ---------------------------------------------------------------------------
// In-app notifications. A dedupe key makes retries idempotent per recipient.
// ---------------------------------------------------------------------------
export interface NotifyInput {
  eventType: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  severity?: 'info' | 'success' | 'warning' | 'alert';
  dedupeKey?: string;
}

export function notify(userIds: (string | null | undefined)[], input: NotifyInput): number {
  let created = 0;
  const now = nowIso();
  for (const userId of new Set(userIds.filter(Boolean) as string[])) {
    const res = db().run(
      `INSERT INTO notifications (id, user_id, event_type, title, message, entity_type, entity_id, link, severity, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      uid('ntf'),
      userId,
      input.eventType,
      input.title,
      input.message,
      input.entityType ?? null,
      input.entityId ?? null,
      input.link ?? null,
      input.severity ?? 'info',
      input.dedupeKey ?? null,
      now,
    );
    created += res.changes;
  }
  return created;
}

export const usersWithRole = (...roles: string[]): string[] =>
  db()
    .all<{ id: string }>(`SELECT id FROM users WHERE is_active = 1 AND role IN (${roles.map(() => '?').join(',')})`, ...roles)
    .map((r) => r.id);

// ---------------------------------------------------------------------------
// Configurable institutional rules.
// ---------------------------------------------------------------------------
export const SETTING_DEFAULTS: Record<string, { value: string; description: string }> = {
  'attendance.session_name': { value: 'Night Roll Call', description: 'Name of the daily hostel attendance session.' },
  'attendance.flag_on_close': {
    value: 'true',
    description: 'When the Warden closes a roll call, unexplained absences move from "Pending Verification" to "Suspected Unauthorized".',
  },
  'absence.repeat_threshold': { value: '3', description: 'Verified unauthorized absences within the window that count as "repeated".' },
  'absence.repeat_window_days': { value: '30', description: 'Look-back window (days) for repeated unauthorized absences.' },
  'study.repeat_miss_threshold': { value: '3', description: 'Missed study sessions within the window that flag a student for follow-up.' },
  'study.repeat_window_days': { value: '30', description: 'Look-back window (days) for repeated study-session absence.' },
  'academic.support_threshold_pct': {
    value: '50',
    description: 'Students whose latest assessment percentage is below this value are listed as possibly needing academic support. Confirm with the institution.',
  },
  'study.start_early_minutes': { value: '30', description: 'How long before the scheduled start time an Adviser may start a study session.' },
  'study.start_late_minutes': { value: '60', description: 'How long after the scheduled end time an Adviser may still start a study session.' },
  'study.auto_enabled': { value: 'true', description: 'Study sessions open by themselves at the time below: the Adviser gets the QR, the students get the scanner.' },
  'study.auto_start_time': { value: '19:00', description: 'Time of day the daily study session opens.' },
  'study.auto_days': { value: 'Mon,Tue,Wed,Thu,Fri,Sat', description: 'Days the daily study session runs, as three-letter names, or "Daily".' },
  'study.auto_grace_minutes': {
    value: '10',
    description: 'How long after its window a study session may still open by itself, so a restart around the study time does not lose the day. 0 switches it off.',
  },
  'study.default_location': { value: 'Hostel study hall', description: 'Venue recorded for a study session an Adviser starts on the spot.' },
  'study.default_minutes': { value: '90', description: 'Length (minutes) of a study session an Adviser starts on the spot.' },
  'study.qr_start_minutes': { value: '10', description: 'Minutes the attendance QR stays valid; the session closes by itself when it expires.' },
  'study.qr_end_minutes': { value: '5', description: 'Minutes the end-session QR code stays valid for the session-end check.' },
  'outing.parent_link_hours': { value: '24', description: 'How long a parent/guardian WhatsApp approval link stays valid.' },
  'outing.tracking_stale_minutes': { value: '20', description: 'Minutes without a location update before an approved outing is treated as tracking-interrupted.' },
  'location.retention_days': { value: '30', description: 'How long individual outing location pings are kept before the cleanup job deletes them.' },
  'complaint.close_roles': { value: 'Warden,AO', description: 'Roles allowed to close a resolved complaint (comma separated).' },
  'complaint.reopen_roles': { value: 'Student,Warden,AO', description: 'Roles allowed to reopen a resolved or closed complaint (comma separated).' },
  'complaint.reopen_window_hours': { value: '72', description: 'How long after resolution a student may reopen their own complaint. Staff are not limited by this window.' },
  'complaint.worker_link_hours': { value: '72', description: 'How long the job link sent to a worker stays usable for reporting the work done.' },
  'complaint.fallback_worker_category': {
    value: 'General Maintenance',
    description: 'Worker trade an accepted complaint is routed to when its category configures none and the routing keywords match nothing. Leave blank to ask the Warden to pick a worker instead.',
  },
  'academic.decline_points': {
    value: '10',
    description: 'A drop of at least this many percentage points between consecutive assessments is shown as "declining".',
  },
};

/**
 * Checks a value the office typed against the rule it belongs to, and returns the
 * reason it cannot be saved, or null.
 *
 * The shape of the rule's own default says what it is: true/false, a number, or
 * free text. Times and the study timetable's day list are checked on top of that,
 * because a session that opens at "half seven" would never open at all.
 */
export function settingValueError(key: string, value: string): string | null {
  const def = SETTING_DEFAULTS[key]?.value ?? '';
  if (/^(true|false)$/.test(def)) return ['true', 'false'].includes(value) ? null : 'Value must be true or false.';
  if (def !== '' && Number.isFinite(Number(def))) return Number.isFinite(Number(value)) ? null : 'This setting must be a number.';
  if (/_time$/.test(key)) return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim()) ? null : 'Use a 24-hour time such as 19:00.';
  if (key === 'study.auto_days') {
    const raw = value.trim();
    if (/^daily$/i.test(raw)) return null;
    const days = raw.split(/[,\s]+/).filter(Boolean);
    const known = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    if (!days.length || days.some((d) => !known.includes(d.slice(0, 3).toLowerCase()))) {
      return 'Use day names such as Mon,Tue,Wed — or the word Daily.';
    }
    return null;
  }
  return value.trim() ? null : 'Value is required.';
}

export function getSetting(key: string): string {
  const row = db().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? SETTING_DEFAULTS[key]?.value ?? '';
}

export const getNumberSetting = (key: string) => Number(getSetting(key));

export function allSettings() {
  const stored = new Map(db().all<{ key: string; value: string; updated_at: string }>('SELECT key, value, updated_at FROM settings').map((r) => [r.key, r]));
  return Object.entries(SETTING_DEFAULTS).map(([key, def]) => ({
    key,
    value: stored.get(key)?.value ?? def.value,
    description: def.description,
    isDefault: !stored.has(key),
    updatedAt: stored.get(key)?.updated_at ?? null,
  }));
}
