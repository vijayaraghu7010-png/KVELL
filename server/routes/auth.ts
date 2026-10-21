import { Router } from 'express';
import { db } from '../db/database';
import {
  authenticate,
  clearSessionCookie,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  passwordPolicyError,
  requireAuth,
  ROLES,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth';
import { badRequest, HttpError, ok, route } from '../lib/http';
import { audit } from '../lib/records';
import { nowIso } from '../lib/util';
import { Validator } from '../lib/validate';
import { portalForRole } from '../lib/portals';

const router = Router();

// Per-IP throttle on failed sign-ins (in addition to per-account lockout).
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_IP_FAILURES = 30;
function assertNotThrottled(ip: string) {
  const entry = failures.get(ip);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_IP_FAILURES) {
    throw new HttpError(429, 'Too many failed sign-in attempts. Please wait a few minutes and try again.', 'rate_limited');
  }
}
function recordFailure(ip: string) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt < now) failures.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  else entry.count++;
}

const publicUser = (u: ReturnType<typeof authenticate>) => ({
  ...u,
  portal: portalForRole(u.role),
  // Lets the UI label demonstration environments clearly.
  demoData: !!db().get(`SELECT 1 FROM settings WHERE key = 'demo.seeded_at'`),
});

router.post(
  '/login',
  route((req, res) => {
    const ip = req.ip || 'unknown';
    assertNotThrottled(ip);
    const v = new Validator(req.body);
    const email = v.string('email', { max: 200, label: 'Email' });
    const password = v.string('password', { max: 200, label: 'Password' });
    const role = v.oneOf('role', ROLES, { required: false, label: 'Role' });
    const remember = v.bool('remember');
    v.done();
    try {
      const user = authenticate(email!, password!, role);
      const session = createSession(user.id, remember, req);
      setSessionCookie(res, session.token, session.expiresAt, remember);
      req.user = user;
      audit(req, 'auth.login', 'user', user.id);
      ok(res, publicUser(user), { message: `Signed in as ${user.role}` });
    } catch (err) {
      recordFailure(ip);
      audit(null, 'auth.login_failed', 'user', undefined, { email, ip: req.ip });
      throw err;
    }
  }),
);

router.post(
  '/logout',
  route((req, res) => {
    if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
    destroySession(req.sessionId);
    clearSessionCookie(res);
    ok(res, null, { message: 'Signed out.' });
  }),
);

router.get(
  '/me',
  requireAuth,
  route((req, res) => ok(res, publicUser(req.user!))),
);

router.post(
  '/change-password',
  requireAuth,
  route((req, res) => {
    const v = new Validator(req.body);
    const current = v.string('currentPassword', { max: 200, label: 'Current password' });
    const next = v.string('newPassword', { max: 200, label: 'New password' });
    v.done();
    const policy = passwordPolicyError(next);
    if (policy) throw badRequest(policy, { fields: { newPassword: policy } });
    const row = db().get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id)!;
    if (!verifyPassword(current!, row.password_hash)) {
      throw badRequest('Current password is incorrect.', { fields: { currentPassword: 'Current password is incorrect.' } });
    }
    if (current === next) throw badRequest('New password must differ from the current password.');
    db().run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', hashPassword(next!), nowIso(), req.user!.id);
    // Sign out other devices.
    destroyUserSessions(req.user!.id, req.sessionId);
    audit(req, 'auth.password_changed', 'user', req.user!.id);
    ok(res, null, { message: 'Password updated. Other sessions have been signed out.' });
  }),
);

/** Staff contact details a user may edit themselves. Role, department and email are admin-controlled. */
router.patch(
  '/profile',
  requireAuth,
  route((req, res) => {
    const v = new Validator(req.body);
    const phone = v.string('phone', { required: false, max: 30, label: 'Phone' });
    const office = v.string('office', { required: false, max: 120, label: 'Office' });
    v.check(!phone || /^[+\d\s()-]{6,30}$/.test(phone), 'phone', 'Phone number contains invalid characters.');
    v.done();
    db().run(
      'UPDATE users SET phone = COALESCE(?, phone), office = COALESCE(?, office), updated_at = ? WHERE id = ?',
      phone ?? null,
      office ?? null,
      nowIso(),
      req.user!.id,
    );
    audit(req, 'user.profile_updated', 'user', req.user!.id, { phone: phone !== undefined, office: office !== undefined });
    const row = db().get('SELECT phone, office FROM users WHERE id = ?', req.user!.id);
    ok(res, row, { message: 'Profile updated.' });
  }),
);

export default router;
