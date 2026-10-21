import React from 'react';
import type { PortalProps } from '../../App';
import type { AOTab } from '../../types/ao';
import { http } from '../../services/http';
import { useResource, usePolling } from '../../hooks/useApi';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { AccountPage } from '../common/Account';
import { useNotifications } from '../common/Notifications';
import { AODashboardPage, AOIncidentsPage, AOEscalationsPage, AOMaintenancePage, AOReportsPage, type AOStats } from './AOPages';

const TABS: readonly AOTab[] = ['dashboard', 'incident-reports', 'escalated-cases', 'maintenance', 'reports', 'notifications', 'profile'];
const TITLES: Record<AOTab, string> = {
  dashboard: 'Dashboard',
  'incident-reports': 'Warden Incident Reports',
  'escalated-cases': 'Escalated Cases',
  maintenance: 'Maintenance & Work Orders',
  reports: 'Reports & Analytics',
  notifications: 'Notifications',
  profile: 'Profile',
};

/**
 * AO portal — exactly seven modules (Complaints and Staff Coordination are intentionally not part of the AO portal).
 * Student complaints remain with the Warden; they reach the AO only as work orders or escalations.
 */
export const AOPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { tab, navigate } = usePortalRoute<AOTab>('ao', TABS, 'dashboard');
  const dash = useResource(() => http.get<{ stats: AOStats; activities: any[] }>('/ao/dashboard'));
  usePolling(dash.reload, 60_000);
  const { unread } = useNotifications();
  const s = dash.data?.stats;

  const nav: NavItem<AOTab>[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'incident-reports', label: 'Warden Incident Reports', icon: 'shield', badge: s?.pendingIncidentReviews },
    { id: 'escalated-cases', label: 'Escalated Cases', icon: 'warning', badge: s?.escalatedCases },
    { id: 'maintenance', label: 'Maintenance & Work Orders', icon: 'build', badge: s?.overdueWorkOrders },
    { id: 'reports', label: 'Reports & Analytics', icon: 'bar_chart' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications', badge: unread },
  ];

  return (
    <PortalShell
      portalLabel="AO"
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={(t) => navigate(t)}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote="Campus Facilities & Operations"
    >
      {tab === 'dashboard' && <AODashboardPage dash={dash} onNavigate={(t) => navigate(t)} />}
      {tab === 'incident-reports' && <AOIncidentsPage onShowToast={onShowToast} onChanged={dash.reload} />}
      {tab === 'escalated-cases' && <AOEscalationsPage onShowToast={onShowToast} onChanged={dash.reload} />}
      {tab === 'maintenance' && <AOMaintenancePage onShowToast={onShowToast} onChanged={dash.reload} />}
      {tab === 'reports' && <AOReportsPage />}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' && <AccountPage onToast={onShowToast} onSignOut={onSignOut} />}
    </PortalShell>
  );
};
