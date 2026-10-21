import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, http } from '../../services/http';
import { useAction } from '../../hooks/useApi';
import { Button, Card, KeyValue, PageHeader, TextField } from './ui';

/** Change-password form; the server verifies the current password and signs out other sessions. */
export const ChangePasswordForm: React.FC<{ onToast: (m: string, e?: boolean) => void; onDone?: () => void; compact?: boolean }> = ({ onToast, onDone, compact }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!current) errs.currentPassword = 'Enter your current password.';
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) errs.newPassword = 'At least 8 characters with letters and numbers.';
    if (next !== confirm) errs.confirm = 'Passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      const res = await http.post('/auth/change-password', { currentPassword: current, newPassword: next });
      onToast(res.message || 'Password updated.');
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      onToast(err instanceof Error ? err.message : 'Could not change password.', true);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className={compact ? 'space-y-3' : 'grid gap-3 sm:grid-cols-3 items-start'} noValidate>
      <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.currentPassword} required />
      <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={errors.newPassword} hint="8+ characters, letters and numbers" required />
      <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} required />
      <div className={compact ? '' : 'sm:col-span-3'}>
        <Button type="submit" loading={pending} icon="lock_reset">
          Update password
        </Button>
      </div>
    </form>
  );
};

/** Staff profile page: identity (admin-managed) + editable contact details + password. */
export const AccountPage: React.FC<{ onToast: (m: string, e?: boolean) => void; extra?: React.ReactNode; onSignOut: () => void; canChangePassword?: boolean }> = ({
  onToast,
  extra,
  onSignOut,
  canChangePassword,
}) => {
  const { user, refresh } = useAuth();
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [office, setOffice] = useState(user?.office ?? '');
  const { run, pending } = useAction(onToast);
  if (!user) return null;
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeader title="My Profile" subtitle="Your account details. Role and department are managed by the system administrator." icon="account_circle" />
      <Card title="Account">
        <KeyValue
          items={[
            ['Name', user.name],
            ['Email', user.email],
            ['Role', user.role],
            ['Department', user.departmentCode ?? '—'],
            ['Designation', user.designation ?? '—'],
            ['Employee ID', user.employeeId ?? '—'],
          ]}
        />
      </Card>
      {extra}
      <Card title="Contact details">
        <form
          className="grid gap-3 sm:grid-cols-3 items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => http.patch('/auth/profile', { phone: phone || undefined, office: office || undefined }), 'Profile updated.');
            if (r) refresh();
          }}
        >
          <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          <TextField label="Office / location" value={office} onChange={(e) => setOffice(e.target.value)} />
          <Button type="submit" loading={pending} icon="save">
            Save
          </Button>
        </form>
      </Card>
      {/* Passwords are managed centrally: only the Admin portal offers this. */}
      {canChangePassword && (
        <Card title="Change password">
          <ChangePasswordForm onToast={onToast} />
        </Card>
      )}
      {/* Sign-out lives here: the top bar opens this page instead of an account menu. */}
      <Card title="Session">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--kv-text-muted)]">Signing out ends this session on this device only.</p>
          <Button variant="danger" icon="logout" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
};

/** Blocks the portal until a temporary password has been replaced. */
export const ForcePasswordChange: React.FC<{ onToast: (m: string, e?: boolean) => void }> = ({ onToast }) => {
  const { refresh, logout, user } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--kv-page)] p-4">
      <div className="w-full max-w-md">
        <Card title="Set a new password">
          <p className="text-sm text-[var(--kv-text-muted)] mb-4">
            Welcome, {user?.name}. Your account uses a temporary password set by the administrator. Choose a new password to continue.
          </p>
          <ChangePasswordForm compact onToast={onToast} onDone={() => refresh()} />
          <div className="mt-4 text-right">
            <Button variant="ghost" size="sm" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};
