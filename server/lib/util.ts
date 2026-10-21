import crypto from 'node:crypto';
import { db } from '../db/database';

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

export const nowIso = () => new Date().toISOString();

/** Calendar date (YYYY-MM-DD) of an instant in the institution's timezone. */
export function localDate(at: Date | string = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Wall-clock time (HH:MM) of an instant in the institution's timezone. */
export function localTime(at: Date | string = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Offset (minutes east of UTC) of APP_TIMEZONE at a given instant. */
function tzOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** ISO instant of a wall-clock time ('YYYY-MM-DD', 'HH:MM:SS') in the institution timezone. */
export function zonedIso(date: string, time = '00:00:00'): string {
  const guess = new Date(`${date}T${time}Z`);
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60_000).toISOString();
}
export const dayStartIso = (date: string) => zonedIso(date, '00:00:00');
export const dayEndIso = (date: string) => zonedIso(date, '23:59:59');

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const hmac = (secret: string, value: string) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
export const uid = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

/**
 * Human-readable, collision-free sequential identifiers such as LR-2026-0007.
 * Must be called inside the transaction that inserts the record.
 */
export function nextCode(prefix: string): string {
  const year = new Date().getUTCFullYear();
  const row = db().get<{ value: number }>(
    `INSERT INTO id_counters (prefix, year, value) VALUES (?, ?, 1)
     ON CONFLICT(prefix, year) DO UPDATE SET value = value + 1
     RETURNING value`,
    prefix,
    year,
  );
  return `${prefix}-${year}-${String(row!.value).padStart(4, '0')}`;
}

export const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const toBool = (v: unknown) => v === 1 || v === true || v === '1';

export function inList(values: readonly unknown[]): { sql: string; params: unknown[] } {
  if (values.length === 0) return { sql: '(NULL)', params: [] };
  return { sql: `(${values.map(() => '?').join(',')})`, params: [...values] };
}

/** '2026-10-14' or ISO → '14 Oct 2026' */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : APP_TIMEZONE });
}

/** ISO → '03:05 PM' in the institution timezone */
export function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: APP_TIMEZONE });
}

/** ISO → '14 Oct 2026, 03:05 PM' */
export const fmtDateTime = (value: string | null | undefined) => (value ? `${fmtDate(value)}, ${fmtTime(value)}` : '—');

export const YEAR_LABELS =['', '1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'];
export const yearLabel = (y: number | null | undefined) => (y ? YEAR_LABELS[y] || `${y}th Year` : '');
