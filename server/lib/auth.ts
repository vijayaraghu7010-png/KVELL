import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/database';
import { forbidden, HttpError, unauthorized } from './http';
import { nowIso, parseJson, randomToken, sha256 } from './util';

export const ROLES = ['Student', 'Warden', 'Security', 'Adviser', 'HOD', 'AO', 'Mess', 'Dean', 'Principal', 'Admin'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentCode: string | null;
  phone: string | null;
  designation: string | null;
  employeeId: string | null;
  office: string | null;
  profile: Record<string, unknown>;
  mustChangePassword: boolean;
  isDemo: boolean;
  /** Present for Student accounts: the linked students.id */
  studentId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export const SESSION_COOKIE = 'kvcet_sid';
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 120);
const SHORT_SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const REMEMBER_DAYS = Number(process.env.SESSION_REMEMBER_DAYS || 7);
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// ---------------------------------------------------------------------------
// Passwords (scrypt, per-password random salt)
// ---------------------------------------------------------------------------
const SCRYPT_N = 16384;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n) });
  return crypto.timingSafeEqual(expected, actual);
}

export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password must be at most 128 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain letters and numbers.';
  return null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export function toAuthUser(row: any): AuthUser {
  const student = row.role === 'Student' ? db().get<{ id: string }>('SELECT id FROM students WHERE user_id = ?', row.id) : undefined;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    departmentCode: row.department_code ?? null,
    phone: row.phone ?? null,
    designation: row.designation ?? null,
    employeeId: row.employee_id ?? null,
    office: row.office ?? null,
    profile: parseJson(row.profile_json, {}),
    mustChangePassword: row.must_change_password === 1,
    isDemo: row.is_demo === 1,
    studentId: student?.id ?? null,
  };
}

export function getUserById(id: string): AuthUser | null {
  const row = db().get('SELECT * FROM users WHERE id = ? AND is_active = 1', id);
  return row ? toAuthUser(row) : null;
}

// ---------------------------------------------------------------------------
// Login with lockout
// ---------------------------------------------------------------------------
export function authenticate(email: string, password: string, expectedRole?: string): AuthUser {
  const row = db().get<any>('SELECT * FROM users WHERE email = ?', email.trim());
  const generic = new HttpError(401, 'Invalid email, password or role.', 'invalid_credentials');
  if (!row || row.is_active !== 1) {
    // Burn comparable time so response timing does not reveal whether the account exists.
    verifyPassword(password, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    throw generic;
  }
  if (row.locked_until && row.locked_until > nowIso()) {
    throw new HttpError(423, `Account temporarily locked after repeated failed sign-ins. Try again after ${new Date(row.locked_until).toLocaleTimeString()}.`, 'locked');
  }
  const valid = verifyPassword(password, row.password_hash);
  if (!valid) {
    const failed = row.failed_logins + 1;
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    db().run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : failed, lock, row.id);
    throw generic;
  }
  if (expectedRole && expectedRole !== row.role) throw generic;
  db().run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', row.id);
  return toAuthUser(row);
}

// ---------------------------------------------------------------------------
// Sessions (opaque random token in cookie; only its hash is stored)
// ---------------------------------------------------------------------------
export function createSession(userId: string, remember: boolean, req: Request): { token: string; expiresAt: string } {
  const token = randomToken();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_DAYS * 86_400_000 : SHORT_SESSION_HOURS * 3_600_000)).toISOString();
  db().run(
    'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    sha256(token),
    userId,
    now,
    now,
    expiresAt,
    String(req.headers['user-agent'] || '').slice(0, 300),
    req.ip,
  );
  // Opportunistic cleanup of expired sessions.
  db().run('DELETE FROM sessions WHERE expires_at < ?', now);
  return { token, expiresAt };
}

export function destroySession(sessionId: string | undefined) {
  if (sessionId) db().run('DELETE FROM sessions WHERE id = ?', sessionId);
}

export function destroyUserSessions(userId: string, exceptSessionId?: string) {
  db().run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, exceptSessionId ?? '');
}

const secureCookies = () => process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

export function setSessionCookie(res: Response, token: string, expiresAt: string, remember: boolean) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    path: '/',
    ...(remember ? { expires: new Date(expiresAt) } : {}),
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), path: '/' });
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/** Resolves the session cookie (if any) into req.user. Never throws. */
export function loadSession(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return next();
  const id = sha256(token);
  const session = db().get<any>('SELECT * FROM sessions WHERE id = ?', id);
  const now = Date.now();
  if (!session) return next();
  const idleExpired = now - Date.parse(session.last_seen_at) > IDLE_MINUTES * 60_000 && Date.parse(session.expires_at) - Date.parse(session.created_at) <= SHORT_SESSION_HOURS * 3_600_000;
  if (Date.parse(session.expires_at) < now || idleExpired) {
    destroySession(id);
    res.setHeader('X-Session-Expired', '1');
    return next();
  }
  const user = getUserById(session.user_id);
  if (!user) {
    destroySession(id);
    return next();
  }
  if (now - Date.parse(session.last_seen_at) > 60_000) {
    db().run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', new Date(now).toISOString(), id);
  }
  req.user = user;
  req.sessionId = id;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized(req.res?.getHeader('X-Session-Expired') ? 'Your session has expired. Please sign in again.' : undefined));
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function originGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const allowed = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    const o = new URL(origin);
    if (o.host === host || allowed.has(origin)) return next();
  } catch {
    // fall through
  }
  next(forbidden('Cross-origin request rejected.'));
}
