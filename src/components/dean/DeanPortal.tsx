import React from 'react';
import type { PortalProps } from '../../App';
import { http } from '../../services/http';
import { useResource, usePolling } from '../../hooks/useApi';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { AccountPage } from '../common/Account';
import { DeanUninformedAbsence } from './DeanUninformedAbsence';
import { DeanWardenReports } from './DeanWardenReports';
import { PageHeader } from '../common/ui';
import { DeanDashboard, DeanHods, DeanAdvisers, DeanProgress } from './DeanOverview';
import { DeanAssignments } from './DeanAssignments';
import { DeanSchedule } from './DeanSchedule';
import { DeanReportDistribution, DeanAnalytics } from './DeanReports';
import { DeanAttendance, DeanStudy, DeanAcademics, SettingsPage } from './DeanMonitoring';

export const DEAN_TABS = [
  'dashboard',
  'attendance',
  'study',
  'academics',
  'uninformed-absence',
  'warden-reports',
  'hods',
  'advisers',
  'progress',
  'assignments',
  'schedule',
  'report-distribution',
  'analytics',
  'settings',
  'notifications',
  'profile',
] as const;
export type DeanRoute = (typeof DEAN_TABS)[number];

const TITLES: Record<DeanRoute, string> = {
  dashboard: 'Dashboard',
  attendance: 'Attendance & Absence',
  study: 'Study Sessions',
  academics: 'Academic Performance',
  'uninformed-absence': 'Uninformed Leave & Absence',
  'warden-reports': 'Warden Reports',
  hods: 'HOD Monitoring',
  advisers: 'Adviser Monitoring',
  progress: 'Progress Tracking',
  assignments: 'Work Assignments',
  schedule: 'Scheduling & Calendar',
  'report-distribution': 'Report Distribution',
  analytics: 'Reports & Analytics',
  settings: 'Institutional Rules',
  notifications: 'Notifications',
  profile: 'Profile',
};

/**
 * Dean — head of overall hostel administration. Monitors attendance, study participation and academic
 * progress; directs HODs and Advisers through assignments, schedules and report requests.
 * (Complaints, mess, outing and leave remain with their operational portals.)
 */
export const DeanPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { tab, param, navigate } = usePortalRoute<DeanRoute>('dean', DEAN_TABS, 'dashboard');
  const counts = useResource(() => http.get<{ metrics: Record<string, { value: number | null }> }>('/dean/dashboard'));
  usePolling(counts.reload, 90_000);
  const m = counts.data?.metrics;
  const v = (k: string) => (m?.[k]?.value ?? undefined) || undefined;

  const nav: NavItem<DeanRoute>[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Overview' },
    { id: 'attendance', label: 'Attendance & Absence', icon: 'how_to_reg', section: 'Students', badge: v('absencesAwaitingVerification') },
    { id: 'study', label: 'Study Sessions', icon: 'menu_book', section: 'Students' },
    { id: 'academics', label: 'Academic Performance', icon: 'school', section: 'Students' },
    { id: 'uninformed-absence', label: 'Uninformed Absence', icon: 'person_off', section: 'Students' },
    { id: 'warden-reports', label: 'Warden Reports', icon: 'assignment_ind', section: 'Staff' },
    { id: 'hods', label: 'HOD Monitoring', icon: 'account_balance', section: 'Staff' },
    { id: 'advisers', label: 'Adviser Monitoring', icon: 'supervisor_account', section: 'Staff' },
    { id: 'progress', label: 'Progress Tracking', icon: 'query_stats', section: 'Staff', badge: v('overdueAssignments') },
    { id: 'assignments', label: 'Work Assignments', icon: 'assignment', section: 'Direct', badge: v('tasksAwaitingReview') },
    { id: 'schedule', label: 'Scheduling & Calendar', icon: 'calendar_month', section: 'Direct' },
    { id: 'report-distribution', label: 'Report Distribution', icon: 'forward_to_inbox', section: 'Direct', badge: v('reportsAwaitingReview') },
    { id: 'analytics', label: 'Reports & Analytics', icon: 'insights', section: 'Direct' },
    { id: 'settings', label: 'Institutional Rules', icon: 'tune', section: 'Account' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications', section: 'Account' },
  ];

  return (
    <PortalShell
      portalLabel="Dean"
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={(t) => navigate(t)}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote="Hostel Administration"
    >
      {tab === 'dashboard' && <DeanDashboard onNavigate={(t) => navigate(t)} />}
      {tab === 'attendance' && <DeanAttendance onShowToast={onShowToast} />}
      {tab === 'study' && <DeanStudy onShowToast={onShowToast} />}
      {tab === 'academics' && <DeanAcademics onShowToast={onShowToast} />}
      {tab === 'uninformed-absence' && <DeanUninformedAbsence onShowToast={onShowToast} />}
      {tab === 'warden-reports' && <DeanWardenReports />}
      {tab === 'hods' && <DeanHods />}
      {tab === 'advisers' && <DeanAdvisers />}
      {tab === 'progress' && <DeanProgress />}
      {tab === 'assignments' && <DeanAssignments onShowToast={onShowToast} openId={param} onOpen={(id) => navigate('assignments', id)} />}
      {tab === 'schedule' && <DeanSchedule onShowToast={onShowToast} openId={param} onOpen={(id) => navigate('schedule', id)} />}
      {tab === 'report-distribution' && <DeanReportDistribution onShowToast={onShowToast} openId={param} onOpen={(id) => navigate('report-distribution', id)} />}
      {tab === 'analytics' && <DeanAnalytics onShowToast={onShowToast} />}
      {tab === 'settings' && <SettingsPage onShowToast={onShowToast} />}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' && <AccountPage onToast={onShowToast} onSignOut={onSignOut} />}
    </PortalShell>
  );
};
