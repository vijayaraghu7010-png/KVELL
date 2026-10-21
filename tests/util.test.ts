import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayEndIso, dayStartIso, localDate, zonedIso } from '../server/lib/util';
import { Validator } from '../server/lib/validate';
import { hashPassword, passwordPolicyError, verifyPassword } from '../server/lib/auth';

// APP_TIMEZONE defaults to Asia/Kolkata (UTC+05:30, no DST).
test('institution-timezone day boundaries', () => {
  assert.equal(dayStartIso('2026-10-17'), '2026-10-16T18:30:00.000Z');
  assert.equal(dayEndIso('2026-10-17'), '2026-10-17T18:29:59.000Z');
  assert.equal(zonedIso('2026-01-01', '23:59:00'), '2026-01-01T18:29:00.000Z');
  assert.equal(localDate(new Date('2026-10-16T18:30:00.000Z')), '2026-10-17');
  assert.equal(localDate(new Date('2026-10-16T18:29:59.000Z')), '2026-10-16');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('validator collects field errors and normalises values', () => {
  const v = new Validator({ title: '  Hello  ', count: '3', when: '2026-10-17T10:00:00+05:30', bad: 'x' });
  assert.equal(v.string('title'), 'Hello');
  assert.equal(v.int('count', { min: 1, max: 5 }), 3);
  assert.equal(v.dateTime('when'), '2026-10-17T04:30:00.000Z');
  v.date('bad', { label: 'Bad date' });
  v.string('missing', { label: 'Missing' });
  assert.throws(() => v.done(), (err: any) => err.status === 400 && !!err.details.fields.bad && !!err.details.fields.missing);
});

test('passwords are salted scrypt hashes and the policy is enforced', () => {
  const a = hashPassword('Secret123');
  const b = hashPassword('Secret123');
  assert.notEqual(a, b, 'salted');
  assert.ok(a.startsWith('scrypt$'));
  assert.ok(verifyPassword('Secret123', a));
  assert.ok(!verifyPassword('secret123', a));
  assert.ok(passwordPolicyError('short1'));
  assert.ok(passwordPolicyError('onlyletters'));
  assert.equal(passwordPolicyError('Letters123'), null);
});
