import React, { useEffect, useState } from 'react';
import type { PortalProps } from '../../App';
import type { MessTab } from '../../types/mess';
import { useAuth } from '../../auth/AuthContext';
import { messDataService } from '../../services/messDataService';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { AccountPage } from '../common/Account';
import { ErrorState, Loading } from '../common/ui';
import { MessDashboard } from './dashboard/MessDashboard';
import { FoodMenuPage } from './menu/FoodMenuPage';
import { StudentFeedbackPage } from './feedback/StudentFeedbackPage';

type MessRoute = Exclude<MessTab, 'home'> | 'notifications' | 'profile';
const TABS: readonly MessRoute[] = ['dashboard', 'food-menu', 'student-feedback', 'notifications', 'profile'];
const TITLES: Record<MessRoute, string> = { dashboard: 'Dashboard', 'food-menu': 'Food Menu', 'student-feedback': 'Student Feedback', notifications: 'Notifications', profile: 'Profile' };

export const MessPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { user } = useAuth();
  const { tab, navigate } = usePortalRoute<MessRoute>('mess', TABS, 'dashboard');
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (user) {
      messDataService.setProfile({
        id: user.id,
        name: user.name,
        staffId: user.employeeId ?? '',
        role: 'Mess In-charge',
        designation: user.designation ?? 'Mess In-charge',
        email: user.email,
        phone: user.phone ?? '',
        diningHall: user.office ?? '',
        shiftTimings: '',
        isDemo: user.isDemo,
      });
    }
    const unsubscribe = messDataService.subscribe(() => setVersion((v) => v + 1));
    messDataService.load();
    return unsubscribe;
  }, [user]);

  const nav: NavItem<MessRoute>[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'food-menu', label: 'Food Menu', icon: 'restaurant_menu' },
    { id: 'student-feedback', label: 'Student Feedback', icon: 'rate_review', badge: messDataService.getMetrics().feedbackToday },
    { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  ];
  const ready = !messDataService.loading || messDataService.getFeedbacks().length > 0;

  return (
    <PortalShell
      portalLabel="Mess"
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={(t) => navigate(t)}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote="Hostel Dining Services"
    >
      {messDataService.error && (
        <div className="mb-4">
          <ErrorState message={messDataService.error} onRetry={() => messDataService.load()} />
        </div>
      )}
      {tab === 'dashboard' && (ready ? <MessDashboard onNavigateTab={(t) => navigate(t === 'home' ? 'dashboard' : t)} onShowToast={onShowToast} /> : <Loading />)}
      {tab === 'food-menu' && (ready ? <FoodMenuPage onShowToast={onShowToast} /> : <Loading />)}
      {tab === 'student-feedback' && (ready ? <StudentFeedbackPage /> : <Loading />)}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' && <AccountPage onToast={onShowToast} onSignOut={onSignOut} />}
    </PortalShell>
  );
};
