import React from 'react';
import type { PortalProps } from '../../App';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { useResource, usePolling } from '../../hooks/useApi';
import { http } from '../../services/http';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { AccountPage } from '../common/Account';
import { WardenDashboardHome, WardenStats } from './WardenDashboardHome';
import { WardenStudentInfo } from './WardenStudentInfo';
import { WardenLeaveRequests } from './WardenLeaveRequests';
import { WardenOutingRequests } from './WardenOutingRequests';
import { WardenLogBook } from './WardenLogBook';
import { WardenMaintenanceComplaints } from './WardenMaintenanceComplaints';
import { WardenAttendance } from './WardenAttendance';
import { WardenIncidents } from './WardenIncidents';
import { WardenRoomAllocation } from './WardenRoomAllocation';
import { WardenReports } from './WardenReports';

export const WARDEN_TABS = [
  'home',
  'student-info',
  'leave-requests',
  'outing-requests',
  'log-book',
  'maintenance-complaints',
  'attendance',
  'incidents',
  'room-allocation',
  'reports',
  'notifications',
  'profile',
] as const;
export type WardenRoute = (typeof WARDEN_TABS)[number];

const TITLES: Record<WardenRoute, string> = {
  home: 'Home',
  'student-info': 'Student Info',
  'leave-requests': 'Leave Requests',
  'outing-requests': 'Outing Requests',
  'log-book': 'Log Book',
  'maintenance-complaints': 'Maintenance Complaints',
  attendance: 'Attendance & Absences',
  incidents: 'Incident Reports',
  'room-allocation': 'Rooms / Allocation',
  reports: 'Reports',
  notifications: 'Notifications',
  profile: 'Profile',
};

export const WardenPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { tab, navigate } = usePortalRoute<WardenRoute>('warden', WARDEN_TABS, 'home');
  const stats = useResource(() => http.get<WardenStats>('/warden/stats'));
  usePolling(stats.reload, 60_000);
  const s = stats.data;

  const nav: NavItem<WardenRoute>[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'student-info', label: 'Student Info', icon: 'group' },
    { id: 'leave-requests', label: 'Leave Requests', icon: 'description', badge: s?.pendingLeaveRequests },
    { id: 'outing-requests', label: 'Outing Requests', icon: 'directions_walk', badge: s?.pendingOutingRequests },
    { id: 'log-book', label: 'Log Book', icon: 'menu_book' },
    { id: 'maintenance-complaints', label: 'Maintenance Complaints', icon: 'build', badge: s?.newComplaints },
    { id: 'attendance', label: 'Attendance & Absences', icon: 'how_to_reg', badge: s?.absencesPendingVerification },
    { id: 'incidents', label: 'Incident Reports', icon: 'report' },
    { id: 'room-allocation', label: 'Rooms / Allocation', icon: 'single_bed' },
    { id: 'reports', label: 'Reports', icon: 'bar_chart' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  ];

  const go = (t: WardenRoute) => navigate(t);
  const props = { onShowToast, onChanged: stats.reload };

  return (
    <PortalShell
      portalLabel="Warden"
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={go}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote="Hostel Administration"
    >
      {tab === 'home' && <WardenDashboardHome stats={stats} onNavigateTab={go} />}
      {tab === 'student-info' && <WardenStudentInfo {...props} />}
      {tab === 'leave-requests' && <WardenLeaveRequests {...props} />}
      {tab === 'outing-requests' && <WardenOutingRequests {...props} />}
      {tab === 'log-book' && <WardenLogBook {...props} />}
      {tab === 'maintenance-complaints' && <WardenMaintenanceComplaints {...props} />}
      {tab === 'attendance' && <WardenAttendance {...props} />}
      {tab === 'incidents' && <WardenIncidents {...props} />}
      {tab === 'room-allocation' && <WardenRoomAllocation {...props} />}
      {tab === 'reports' && <WardenReports onShowToast={onShowToast} />}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' && <AccountPage onToast={onShowToast} onSignOut={onSignOut} />}
    </PortalShell>
  );
};

export interface WardenTabProps {
  onShowToast: (msg: string, isError?: boolean) => void;
  /** Refreshes the sidebar counters after a change. */
  onChanged: () => void;
}
