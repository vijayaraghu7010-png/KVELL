import React, { useCallback, useEffect, useState } from 'react';
import type { PortalProps } from '../../App';
import { Complaint, ComplaintCategory, ComplaintDraft, DashboardTab, LeaveDraft, LeaveRequest, OutingRequest, Outpass } from '../../types';
import { DayMenu, DayOfWeek } from '../../types/mess';
import { errorMessage, fileToBase64, http } from '../../services/http';
import { useResource, usePolling } from '../../hooks/useApi';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { ErrorState, Loading } from '../common/ui';
import { DashboardHome, HolidayRow, StudentDashboardData, StudySessionRow } from '../DashboardHome';
import { DashboardRaiseComplaint, ComplaintInput } from '../DashboardRaiseComplaint';
import { DashboardComplaintStatus } from '../DashboardComplaintStatus';
import { DashboardLeaveRequest, LeaveInput } from '../DashboardLeaveRequest';
import { DashboardLeaveStatus } from '../DashboardLeaveStatus';
import { DashboardOutingPermission, OutingInput, WhatsAppStatus } from '../DashboardOutingPermission';
import { OutingLocationSharing } from './OutingLocationSharing';
import { DashboardOutpass } from '../DashboardOutpass';
import { DashboardMessMenu, MessFeedbackInput } from '../DashboardMessMenu';
import { DashboardProfile, StudentProfileData } from '../DashboardProfile';
import { StudySessionQrModal } from './StudySessionQrModal';

/** Shows only the last four digits of the guardian's number to the student. */
const maskPhone = (phone: string) => (phone ? phone.replace(/.(?=.{4})/g, '•') : '');

const TABS = ['home', 'raise-complaint', 'complaint-status', 'leave-request', 'leave-request-status', 'outing-permission', 'my-outpass', 'mess-menu', 'notifications', 'profile'] as const;

const TITLES: Record<DashboardTab, string> = {
  home: 'Home',
  'raise-complaint': 'Raise Complaint',
  'complaint-status': 'Complaint Status',
  'leave-request': 'Leave Request',
  'leave-request-status': 'Leave Request Status',
  'outing-permission': 'Outing Permission',
  'my-outpass': 'My Outpass',
  'mess-menu': 'Mess Menu',
  notifications: 'Notifications',
  profile: 'Student Profile',
};

/**
 * Student portal. Every list here is loaded from the API and every action is persisted
 * server-side; the UI re-fetches after each change instead of patching local state.
 */
export const StudentPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { tab, navigate } = usePortalRoute<DashboardTab>('student', TABS, 'home');

  const profile = useResource(() => http.get<StudentProfileData>('/student/profile'));
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [complaintDrafts, setComplaintDrafts] = useState<ComplaintDraft[]>([]);
  const [complaintCategories, setComplaintCategories] = useState<ComplaintCategory[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [leaveDrafts, setLeaveDrafts] = useState<LeaveDraft[]>([]);
  const [outings, setOutings] = useState<OutingRequest[]>([]);
  const [outpasses, setOutpasses] = useState<Outpass[]>([]);
  const [dashboard, setDashboard] = useState<StudentDashboardData | null>(null);
  const [study, setStudy] = useState<StudySessionRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [menu, setMenu] = useState<{ today: DayOfWeek; week: DayMenu[] } | null>(null);
  const [activeComplaintId, setActiveComplaintId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loaders = {
    complaints: () => http.get<Complaint[]>('/student/complaints').then(setComplaints),
    complaintDrafts: () => http.get<ComplaintDraft[]>('/student/complaint-drafts').then(setComplaintDrafts),
    complaintCategories: () => http.get<ComplaintCategory[]>('/student/complaint-categories').then(setComplaintCategories),
    leaves: () => http.get<LeaveRequest[]>('/student/leave-requests').then(setLeaves),
    leaveDrafts: () => http.get<LeaveDraft[]>('/student/leave-drafts').then(setLeaveDrafts),
    outings: () => http.get<OutingRequest[]>('/student/outing-requests').then(setOutings),
    outpasses: () => http.get<Outpass[]>('/student/outpasses').then(setOutpasses),
    dashboard: () => http.get<StudentDashboardData>('/student/dashboard').then(setDashboard),
    study: () => http.get<{ sessions: StudySessionRow[] }>('/student/study-sessions').then((d) => setStudy(d.sessions)),
    holidays: () => http.get<HolidayRow[]>('/holidays').then(setHolidays),
    whatsapp: () => http.get<WhatsAppStatus>('/student/whatsapp-status').then(setWhatsapp),
    menu: () => http.get<{ today: DayOfWeek; week: DayMenu[] }>('/mess/menu').then(setMenu),
  };

  const refreshAll = useCallback(async () => {
    try {
      await Promise.all(Object.values(loaders).map((l) => l()));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);
  // Approvals and gate scans happen in other portals; keep this view current.
  usePolling(() => {
    loaders.leaves();
    loaders.outings();
    loaders.outpasses();
    loaders.complaints();
    loaders.dashboard();
  }, 60_000);

  /** Runs a mutation, shows its message (or error), refreshes the given data and returns the result. */
  async function act<T>(fn: () => Promise<{ data: T; message?: string }>, refresh: (keyof typeof loaders)[], successMessage?: string): Promise<T | undefined> {
    try {
      const res = await fn();
      const msg = successMessage ?? res.message;
      if (msg) onShowToast(msg);
      await Promise.all(refresh.map((k) => loaders[k]().catch(() => undefined)));
      return res.data;
    } catch (err) {
      onShowToast(errorMessage(err), true);
      return undefined;
    }
  }

  const uploadAttachment = async (entityType: string, entityId: string, file: File) => {
    try {
      await http.post('/attachments', { entityType, entityId, fileName: file.name, mimeType: file.type, dataBase64: await fileToBase64(file) });
    } catch (err) {
      onShowToast(`Saved, but the file could not be attached: ${errorMessage(err)}`, true);
    }
  };

  // ---- Complaints
  const submitComplaint = async (input: ComplaintInput, file: File | null) => {
    const c = await act<Complaint>(() => http.post('/student/complaints', input), ['complaints', 'complaintDrafts', 'dashboard']);
    if (c && file) await uploadAttachment('complaint', c.id, file);
    if (c) setActiveComplaintId(c.id);
    return c;
  };
  const saveComplaintDraft = (d: { id: string | null; title: string; category: string; urgency: string; priority?: string; location?: string; description: string; fileName?: string }) =>
    act<ComplaintDraft>(() => http.put(`/student/complaint-drafts/${d.id ?? 'new'}`, d), ['complaintDrafts'], '');
  /** Reopening is allowed inside the window the institution configured. */
  const reopenComplaint = async (id: string, note: string) =>
    !!(await act<Complaint>(() => http.post(`/student/complaints/${id}/reopen`, { note }), ['complaints', 'dashboard']));
  /** Delete endpoints return no data, so success is reported explicitly. */
  const remove = async (path: string, refresh: (keyof typeof loaders)[], message?: string) => {
    try {
      const res = await http.del(path);
      if (message ?? res.message) onShowToast((message ?? res.message)!);
      await Promise.all(refresh.map((k) => loaders[k]().catch(() => undefined)));
      return true;
    } catch (err) {
      onShowToast(errorMessage(err), true);
      return false;
    }
  };
  const deleteComplaintDraft = (id: string) => remove(`/student/complaint-drafts/${id}`, ['complaintDrafts'], '');

  // ---- Leave
  const submitLeave = async (input: LeaveInput, file: File | null) => {
    const l = await act<LeaveRequest>(() => http.post('/student/leave-requests', input), ['leaves', 'leaveDrafts', 'dashboard']);
    if (l && file) await uploadAttachment('leave_request', l.id, file);
    return l;
  };
  const saveLeaveDraft = (d: { id: string | null; title: string; type: string; fromDate: string; toDate: string; reason: string; fileName?: string }) =>
    act<LeaveDraft>(
      () =>
        http.put(`/student/leave-drafts/${d.id ?? 'new'}`, {
          title: d.title,
          type: d.type,
          fromDate: d.fromDate || undefined,
          toDate: d.toDate || undefined,
          reason: d.reason || undefined,
          fileName: d.fileName,
        }),
      ['leaveDrafts'],
      '',
    );
  const deleteLeaveDraft = (id: string) => remove(`/student/leave-drafts/${id}`, ['leaveDrafts'], '');
  const cancelLeave = async (id: string) => !!(await act(() => http.post(`/student/leave-requests/${id}/cancel`), ['leaves', 'outpasses', 'dashboard'], ''));

  // ---- Outings
  const submitOuting = (input: OutingInput, draftId: string | null) => {
    const body = { ...input, outAt: input.outAt || undefined, expectedReturnAt: input.expectedReturnAt || undefined };
    return act<OutingRequest>(() => (draftId ? http.put(`/student/outing-requests/${draftId}`, body) : http.post('/student/outing-requests', body)), ['outings', 'dashboard']);
  };
  const deleteOuting = (r: OutingRequest) => remove(`/student/outing-requests/${r.id}`, ['outings', 'dashboard']);
  /** Re-sends the guardian's WhatsApp approval request while it is still unanswered. */
  const resendParentApproval = async (id: string) => {
    await act(() => http.post(`/student/outing-requests/${id}/resend-parent-approval`), ['outings']);
  };

  // ---- Profile & mess
  const updateContact = async (phone: string, address: string) => {
    const r = await act(() => http.patch('/student/profile', { phone: phone || undefined, address: address || undefined }), [], 'Contact details updated.');
    if (r) profile.reload();
    return !!r;
  };
  const submitFeedback = async (input: MessFeedbackInput) => !!(await act(() => http.post('/student/mess-feedback', input), []));

  const p = profile.data;
  const nav: NavItem<DashboardTab>[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'raise-complaint', label: 'Raise Complaint', icon: 'edit_note' },
    { id: 'complaint-status', label: 'Complaint Status', icon: 'schedule', badge: complaints.filter((c) => c.status !== 'Resolved').length },
    { id: 'leave-request', label: 'Leave Request', icon: 'description' },
    { id: 'leave-request-status', label: 'Leave Request Status', icon: 'task', badge: dashboard?.pendingLeaves },
    { id: 'outing-permission', label: 'Outing Permission', icon: 'calendar_today' },
    { id: 'my-outpass', label: 'My Outpass', icon: 'card_membership', badge: dashboard?.activeOutpasses },
    { id: 'mess-menu', label: 'Mess Menu', icon: 'restaurant' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications' },
    // "My Profile" is reached from the account menu in the top bar, not the sidebar.
  ];

  const todayMenu = menu?.week.find((d) => d.day === menu.today) ?? null;

  return (
    <PortalShell
      portalLabel="Student"
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={(t) => navigate(t)}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote={p ? `${p.block !== 'Unallocated' ? `${p.block} · ` : ''}Room ${p.roomNumber}` : undefined}
    >
      {loadError && (
        <div className="mb-4">
          <ErrorState message={loadError} onRetry={refreshAll} />
        </div>
      )}
      {tab === 'home' && <DashboardHome todayMenu={todayMenu} stats={dashboard} studySessions={study} leaveRequests={leaves} holidays={holidays} onNavigateTab={(t) => navigate(t)} />}
      {tab === 'raise-complaint' &&
        (p ? (
          <DashboardRaiseComplaint
            drafts={complaintDrafts}
            complaints={complaints}
            categories={complaintCategories}
            defaultLocation={p.roomNumber !== 'Unallocated' ? `${p.block}, Room ${p.roomNumber}` : ''}
            onSaveDraft={saveComplaintDraft}
            onDeleteDraft={deleteComplaintDraft}
            onSubmitComplaint={submitComplaint}
            onNavigateTab={(t) => navigate(t)}
            onShowToast={onShowToast}
          />
        ) : (
          <Loading />
        ))}
      {tab === 'complaint-status' && (
        <DashboardComplaintStatus
          complaints={complaints}
          activeComplaintId={activeComplaintId}
          onSelectComplaint={setActiveComplaintId}
          onNavigateTab={(t) => navigate(t)}
          onShowToast={onShowToast}
          onReopen={reopenComplaint}
        />
      )}
      {tab === 'leave-request' && (
        <DashboardLeaveRequest
          drafts={leaveDrafts}
          leaveRequests={leaves}
          onSaveDraft={saveLeaveDraft}
          onDeleteDraft={deleteLeaveDraft}
          onSubmitLeave={submitLeave}
          onNavigateTab={(t) => navigate(t)}
          onShowToast={onShowToast}
        />
      )}
      {tab === 'leave-request-status' && <DashboardLeaveStatus leaveRequests={leaves} onCancel={cancelLeave} onNavigateTab={(t) => navigate(t)} onShowToast={onShowToast} />}
      {tab === 'outing-permission' && (
        <div className="space-y-6">
          <OutingLocationSharing outings={outings} onShowToast={onShowToast} onChanged={() => loaders.outings()} />
          <DashboardOutingPermission
            outingRequests={outings}
            guardian={p?.parentName || p?.parentNumber ? { name: p.parentName, phoneMasked: maskPhone(p.parentNumber) } : null}
            whatsapp={whatsapp}
            onSubmitOuting={submitOuting}
            onDeleteOuting={deleteOuting}
            onResendParentApproval={resendParentApproval}
            onNavigateTab={(t) => navigate(t)}
            onShowToast={onShowToast}
          />
        </div>
      )}
      {tab === 'my-outpass' &&
        (p ? <DashboardOutpass outpasses={outpasses} student={{ name: p.name, regNumber: p.regNumber, department: p.department, roomNumber: p.roomNumber, block: p.block }} onShowToast={onShowToast} /> : <Loading />)}
      {tab === 'mess-menu' && <DashboardMessMenu week={menu?.week ?? []} today={menu?.today ?? null} onSubmitFeedback={submitFeedback} />}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' &&
        (profile.error ? <ErrorState message={profile.error} onRetry={profile.reload} /> : p ? <DashboardProfile profile={p} onUpdateContact={updateContact} onShowToast={onShowToast} onSignOut={onSignOut} /> : <Loading />)}
      <StudySessionQrModal onShowToast={onShowToast} />
    </PortalShell>
  );
};
