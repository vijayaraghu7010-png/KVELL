/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { NotificationsProvider } from './components/common/Notifications';
import { ForcePasswordChange } from './components/common/Account';
import { Button, Icon } from './components/common/ui';
import { Toast } from './components/Toast';
import { LoginPage } from './components/LoginPage';

// Each portal is a separate chunk: users download only the portal for their role.
const StudentPortal = lazy(() => import('./components/student/StudentPortal').then((m) => ({ default: m.StudentPortal })));
const WardenPortal = lazy(() => import('./components/warden/WardenPortal').then((m) => ({ default: m.WardenPortal })));
const SecurityPortal = lazy(() => import('./components/security/SecurityPortal').then((m) => ({ default: m.SecurityPortal })));
const HODPortal = lazy(() => import('./components/hod/HODPortal').then((m) => ({ default: m.HODPortal })));
const AdviserPortal = lazy(() => import('./components/adviser/AdviserPortal').then((m) => ({ default: m.AdviserPortal })));
const MessPortal = lazy(() => import('./components/mess/MessPortal').then((m) => ({ default: m.MessPortal })));
const AOPortal = lazy(() => import('./components/ao/AOPortal').then((m) => ({ default: m.AOPortal })));
const DeanPortal = lazy(() => import('./components/dean/DeanPortal').then((m) => ({ default: m.DeanPortal })));
const AdminPortal = lazy(() => import('./components/admin/AdminPortal').then((m) => ({ default: m.AdminPortal })));
const ParentApproval = lazy(() => import('./components/ParentApproval').then((m) => ({ default: m.ParentApproval })));
const WorkerJob = lazy(() => import('./components/WorkerJob').then((m) => ({ default: m.WorkerJob })));

const KNOWN_PORTALS = ['student', 'warden', 'security', 'hod', 'adviser', 'mess', 'ao', 'dean', 'admin'];
const firstSegment = () => window.location.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';

/** A public token link: `/parent/outing/<token>` or `/worker/job/<token>`. */
function publicTokenFromPath(prefix: string, kind: string): string | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[0]?.toLowerCase() === prefix && parts[1]?.toLowerCase() === kind && parts[2] ? decodeURIComponent(parts[2]) : null;
}

/** `/parent/outing/<token>` — the link a guardian receives over WhatsApp. */
const parentTokenFromPath = () => publicTokenFromPath('parent', 'outing');

/** `/worker/job/<token>` — the link a maintenance worker receives with the job. */
const workerTokenFromPath = () => publicTokenFromPath('worker', 'job');

const CenteredSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-[var(--kv-page)]" role="status">
    <div className="flex items-center gap-3 text-[var(--kv-heading)] font-semibold">
      <Icon name="progress_activity" className="text-[26px] animate-spin" /> Loading…
    </div>
  </div>
);

export interface PortalProps {
  onSignOut: () => void;
  onShowToast: (message: string, isError?: boolean) => void;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

function Root() {
  const { user, checking, expiredMessage, logout } = useAuth();
  // The parent/guardian approval link is public: it carries its own single-use token
  // and must work for someone who has no account here, signed in or not.
  const parentToken = parentTokenFromPath();
  const workerToken = workerTokenFromPath();
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [, forceRender] = useState(0);

  const showToast = useCallback((message: string, isError = false) => {
    setToast({ message, isError });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), isError ? 7000 : 4000);
  }, []);

  useEffect(() => {
    const onPop = () => forceRender((n) => n + 1);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Keep the URL in step with authentication state.
  useEffect(() => {
    if (checking || parentToken || workerToken) return;
    const seg = firstSegment();
    if (!user && seg !== 'login') window.history.replaceState({}, '', '/login');
    if (user?.portal && (seg === '' || seg === 'login')) window.history.replaceState({}, '', `/${user.portal}`);
  }, [user, checking]);

  const handleSignOut = useCallback(async () => {
    try {
      await logout();
      showToast('Signed out.');
    } catch {
      showToast('Signed out locally; the server could not be reached.', true);
    }
    window.history.pushState({}, '', '/login');
  }, [logout, showToast]);

  const toastEl = <Toast message={toast?.message ?? null} isError={toast?.isError} onClose={() => setToast(null)} />;

  if (parentToken) {
    return (
      <Suspense fallback={<CenteredSpinner />}>
        <ParentApproval token={parentToken} />
      </Suspense>
    );
  }

  if (workerToken) {
    return (
      <Suspense fallback={<CenteredSpinner />}>
        <WorkerJob token={workerToken} />
      </Suspense>
    );
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--kv-page)]" role="status">
        <div className="flex items-center gap-3 text-[var(--kv-heading)] font-semibold">
          <Icon name="progress_activity" className="text-[26px] animate-spin" /> Loading KVCET Hostel ERP…
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginPage expiredMessage={expiredMessage} />
        {toastEl}
      </>
    );
  }

  if (user.mustChangePassword) {
    return (
      <>
        <ForcePasswordChange onToast={showToast} />
        {toastEl}
      </>
    );
  }

  if (!user.portal) {
    return (
      <CenteredMessage icon="construction" title={`No portal is configured for the ${user.role} role`} onSignOut={handleSignOut}>
        Your account is active, but this role has no dedicated portal in this system yet. Escalations forwarded to the Principal are recorded in the AO portal.
      </CenteredMessage>
    );
  }

  const seg = firstSegment();
  if (KNOWN_PORTALS.includes(seg) && seg !== user.portal) {
    return (
      <CenteredMessage icon="lock" title="You are not authorized to view this portal" onSignOut={handleSignOut}>
        You are signed in as <strong>{user.role}</strong>. The {seg.toUpperCase()} portal is available only to its own role.
        <div className="mt-4">
          <Button
            icon="arrow_forward"
            onClick={() => {
              window.history.pushState({}, '', `/${user.portal}`);
              forceRender((n) => n + 1);
            }}
          >
            Go to my portal
          </Button>
        </div>
      </CenteredMessage>
    );
  }

  const props: PortalProps = { onSignOut: handleSignOut, onShowToast: showToast };
  const portal = {
    student: <StudentPortal {...props} />,
    warden: <WardenPortal {...props} />,
    security: <SecurityPortal {...props} />,
    hod: <HODPortal {...props} />,
    adviser: <AdviserPortal {...props} />,
    mess: <MessPortal {...props} />,
    ao: <AOPortal {...props} />,
    dean: <DeanPortal {...props} />,
    admin: <AdminPortal {...props} />,
  }[user.portal];

  return (
    <NotificationsProvider>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-[var(--kv-page)]" role="status">
            <Icon name="progress_activity" className="text-[28px] text-[var(--kv-heading)] animate-spin" />
            <span className="sr-only">Loading portal…</span>
          </div>
        }
      >
        {portal}
      </Suspense>
      {toastEl}
    </NotificationsProvider>
  );
}

const CenteredMessage: React.FC<{ icon: string; title: string; onSignOut: () => void; children: React.ReactNode }> = ({ icon, title, onSignOut, children }) => (
  <div className="min-h-screen flex items-center justify-center bg-[var(--kv-page)] p-4">
    <div className="bg-white border border-[var(--kv-border)] rounded-2xl shadow-sm max-w-lg w-full p-6 text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-heading)] flex items-center justify-center mb-3">
        <Icon name={icon} className="text-[26px]" />
      </div>
      <h1 className="text-lg font-bold text-[var(--kv-heading)]">{title}</h1>
      <div className="text-sm text-[var(--kv-text-muted)] mt-2">{children}</div>
      <div className="mt-5">
        <Button variant="ghost" icon="logout" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  </div>
);
