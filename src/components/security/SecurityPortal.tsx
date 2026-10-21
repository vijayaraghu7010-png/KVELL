import React from 'react';
import type { PortalProps } from '../../App';
import { SecurityMetrics, SecurityMovementRecord, SecurityScanRecord, SecurityTab } from '../../types/security';
import { downloadFile, errorMessage, http } from '../../services/http';
import { useResource, usePolling } from '../../hooks/useApi';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { AccountPage } from '../common/Account';
import { AsyncContent, Button, PageHeader } from '../common/ui';
import { SecurityHome } from '../../pages/security/SecurityHome';
import { SecurityQRScanner } from '../../pages/security/SecurityQRScanner';
import { SecurityLogBook } from '../../pages/security/SecurityLogBook';

type SecurityRoute = SecurityTab | 'notifications' | 'profile';
const TABS: readonly SecurityRoute[] = ['home', 'qr-scanner', 'log-book', 'notifications', 'profile'];
const TITLES: Record<SecurityRoute, string> = { home: 'Home', 'qr-scanner': 'Gate Scanner', 'log-book': 'Log Book', notifications: 'Notifications', profile: 'Profile' };

/** Security desk portal; every number comes from recorded gate movements and outpasses. */
export const SecurityPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { tab, navigate } = usePortalRoute<SecurityRoute>('security', TABS, 'home');
  const metrics = useResource(() => http.get<SecurityMetrics>('/security/metrics'));
  const scans = useResource(() => http.get<SecurityScanRecord[]>('/security/scans?limit=10'));
  const movements = useResource(() => http.get<SecurityMovementRecord[]>('/security/movements?limit=500'), [tab === 'log-book']);
  const refresh = () => {
    metrics.reload();
    scans.reload();
    movements.reload();
  };
  usePolling(() => {
    metrics.reload();
    scans.reload();
  }, 30_000);

  const nav: NavItem<SecurityRoute>[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'qr-scanner', label: 'Gate Scanner', icon: 'qr_code_scanner' },
    { id: 'log-book', label: 'Log Book', icon: 'menu_book' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  ];

  return (
    <PortalShell
      portalLabel="Security"
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={(t) => navigate(t)}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote="Campus Gate Security Desk"
    >
      {tab === 'home' && (
        <AsyncContent data={metrics.data && scans.data ? { m: metrics.data, s: scans.data } : null} loading={metrics.loading || scans.loading} error={metrics.error || scans.error} onRetry={refresh}>
          {({ m, s }) => <SecurityHome metrics={m} recentScans={s} onNavigateTab={(t) => navigate(t)} />}
        </AsyncContent>
      )}
      {tab === 'qr-scanner' && (
        <div className="max-w-6xl mx-auto">
          <PageHeader title="Gate Scanner" subtitle="Verify a student's digital outpass and record exits and returns." icon="qr_code_scanner" />
          <SecurityQRScanner onRecorded={refresh} onShowToast={onShowToast} />
        </div>
      )}
      {tab === 'log-book' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="secondary" icon="download" onClick={() => downloadFile('/security/movements/export', 'gate-movements.csv').catch((e) => onShowToast(errorMessage(e), true))}>
              Export all as CSV
            </Button>
          </div>
          <AsyncContent {...movements} onRetry={movements.reload}>
            {(rows) => <SecurityLogBook records={rows} onShowToast={onShowToast} />}
          </AsyncContent>
        </div>
      )}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' && <AccountPage onToast={onShowToast} onSignOut={onSignOut} />}
    </PortalShell>
  );
};
