import React, { useState } from 'react';
import type { PortalProps } from '../../App';
import type { HistoryEntry } from '../../types';
import { http, qs } from '../../services/http';
import { useAction, useResource, usePolling } from '../../hooks/useApi';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { useAuth } from '../../auth/AuthContext';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { AccountPage } from '../common/Account';
import { StudentDirectory } from '../common/StudentDirectory';
import { AcademicRecords } from '../common/AcademicRecords';
import { Followups } from '../common/Followups';
import { AbsenceCases } from '../common/AbsenceCases';
import { Incidents } from '../common/Incidents';
import { Attachments } from '../common/Attachments';
import { TasksInbox, ScheduleInbox, ReportRequestsInbox } from '../common/WorkInbox';
import { AsyncContent, Badge, BarList, Button, Card, DataTable, EmptyState, KeyValue, Modal, PageHeader, StatCard, StatusBadge, Tabs, TextArea, Timeline, addDaysInput, todayInput } from '../common/ui';
import { StudySessionQrModal } from './StudySessionQrModal';
import { StudyAttendanceLog } from '../common/StudyAttendanceLog';

const TABS = ['dashboard', 'students', 'leave-requests', 'academics', 'follow-ups', 'study-log', 'attendance', 'incident-reports', 'reports', 'tasks', 'schedule', 'report-requests', 'notifications', 'profile'] as const;
type AdvRoute = (typeof TABS)[number];
const TITLES: Record<AdvRoute, string> = {
  dashboard: 'Dashboard',
  students: 'My Advisees',
  'leave-requests': 'Leave Requests',
  academics: 'Academic Records',
  'follow-ups': 'Mentoring & Follow-ups',
  'study-log': 'Study Attendance Log',
  attendance: 'Attendance & Study',
  'incident-reports': 'Incident Reports',
  reports: 'Advisee Summary',
  tasks: 'My Tasks',
  schedule: 'My Schedule',
  'report-requests': 'Report Requests',
  notifications: 'Notifications',
  profile: 'Profile',
};

interface AdviserDash {
  metrics: Record<string, number>;
  /** Only an Adviser responsible for hostellers gets the study-session controls. */
  canConductSessions: boolean;
  activities: { id: string; title: string; description: string; timestamp: string; badge?: string }[];
}

export const AdviserPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { user } = useAuth();
  const { tab, navigate } = usePortalRoute<AdvRoute>('adviser', TABS, 'dashboard');
  const dash = useResource(() => http.get<AdviserDash>('/adviser/dashboard'));
  usePolling(dash.reload, 60_000);
  const m = dash.data?.metrics;

  const nav: NavItem<AdvRoute>[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'My advisees' },
    { id: 'students', label: 'My Advisees', icon: 'groups', section: 'My advisees' },
    { id: 'leave-requests', label: 'Leave Requests', icon: 'description', section: 'My advisees', badge: m?.pendingLeaveRequests },
    { id: 'academics', label: 'Academic Records', icon: 'school', section: 'My advisees' },
    { id: 'follow-ups', label: 'Mentoring & Follow-ups', icon: 'support_agent', section: 'My advisees', badge: m?.overdueFollowups },
    ...(dash.data?.canConductSessions ? [{ id: 'study-log' as const, label: 'Study Attendance Log', icon: 'fact_check', section: 'My advisees' }] : []),
    { id: 'attendance', label: 'Attendance & Study', icon: 'how_to_reg', section: 'My advisees' },
    { id: 'incident-reports', label: 'Incident Reports', icon: 'report', section: 'My advisees' },
    { id: 'reports', label: 'Advisee Summary', icon: 'insights', section: 'My advisees' },
    { id: 'tasks', label: 'My Tasks', icon: 'assignment', section: 'From the Dean', badge: m?.pendingTasks },
    { id: 'schedule', label: 'My Schedule', icon: 'event', section: 'From the Dean', badge: m?.upcomingSchedules },
    { id: 'report-requests', label: 'Report Requests', icon: 'assignment_turned_in', section: 'From the Dean', badge: m?.pendingReportRequests },
    { id: 'notifications', label: 'Notifications', icon: 'notifications', section: 'Account' },
  ];

  return (
    <PortalShell
      portalLabel="Adviser"
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={(t) => navigate(t)}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote={`Class adviser · ${user?.departmentCode ?? ''}`}
    >
      {tab === 'dashboard' && <AdviserHome dash={dash} onNavigate={(t) => navigate(t)} />}
      {tab === 'students' && (
        <div className="max-w-7xl mx-auto">
          <PageHeader title="My Advisees" subtitle="Only students assigned to you by the administrator are shown." icon="groups" />
          <StudentDirectory endpoint="/adviser/students" emptyMessage="No students are assigned to you yet. Ask the administrator to assign your advisees." />
        </div>
      )}
      {tab === 'leave-requests' && (
        <AdviserLeaves
          onShowToast={onShowToast}
          onChanged={dash.reload}
        />
      )}
      {tab === 'academics' && (
        <div className="max-w-7xl mx-auto">
          <PageHeader title="Academic Records" subtitle="Approved assessment results for your advisees." icon="school" />
          <AcademicRecords studentsEndpoint="/adviser/students" onShowToast={onShowToast} />
        </div>
      )}
      {tab === 'follow-ups' && (
        <div className="max-w-7xl mx-auto">
          <PageHeader title="Mentoring & Follow-ups" subtitle="Record mentoring sessions and track academic, absence and study follow-ups for your advisees." icon="support_agent" />
          <Followups studentsEndpoint="/adviser/students" onShowToast={onShowToast} />
        </div>
      )}
      {tab === 'study-log' && (
        <StudyAttendanceLog subtitle="Every study session you conduct, student by student — the record the scans left." showDepartment={false} />
      )}
      {tab === 'attendance' && <AdviserAttendance onShowToast={onShowToast} />}
      {tab === 'incident-reports' && (
        <div className="max-w-7xl mx-auto">
          <PageHeader title="Incident Reports" subtitle="Hostel incidents involving your advisees (read-only)." icon="report" />
          <Incidents onShowToast={onShowToast} />
        </div>
      )}
      {tab === 'reports' && <AdviseeSummary />}
      {tab === 'tasks' && <TasksInbox onShowToast={onShowToast} />}
      {tab === 'schedule' && <ScheduleInbox onShowToast={onShowToast} />}
      {tab === 'report-requests' && <ReportRequestsInbox onShowToast={onShowToast} />}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' && <AccountPage onToast={onShowToast} onSignOut={onSignOut} />}
      {/* The session's QR reaches the Adviser as a notification; there is no page for it. */}
      {dash.data?.canConductSessions && <StudySessionQrModal />}
    </PortalShell>
  );
};

const AdviserHome: React.FC<{ dash: { data: AdviserDash | null; loading: boolean; error: string | null; reload: () => void }; onNavigate: (t: AdvRoute) => void }> = ({ dash, onNavigate }) => (
  <div className="max-w-7xl mx-auto space-y-5">
    <PageHeader title="Adviser Dashboard" subtitle="Your advisees, their requests and the work assigned to you." icon="dashboard" />
    <AsyncContent {...dash} onRetry={dash.reload}>
      {(d) => (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Advisees" value={d.metrics.departmentStudents} icon="groups" onClick={() => onNavigate('students')} />
            <StatCard label="Leave awaiting you" value={d.metrics.pendingLeaveRequests} icon="description" tone="amber" onClick={() => onNavigate('leave-requests')} />
            <StatCard label="May need academic support" value={d.metrics.studentsNeedingSupport} icon="school" tone="red" onClick={() => onNavigate('academics')} />
            <StatCard label="Open follow-ups" value={d.metrics.openFollowups} hint={`${d.metrics.overdueFollowups} overdue`} icon="support_agent" tone="violet" onClick={() => onNavigate('follow-ups')} />
            <StatCard label="My open tasks" value={d.metrics.pendingTasks} icon="assignment" onClick={() => onNavigate('tasks')} />
            <StatCard label="Report requests" value={d.metrics.pendingReportRequests} icon="assignment_turned_in" tone="amber" onClick={() => onNavigate('report-requests')} />
            <StatCard label="Upcoming activities" value={d.metrics.upcomingSchedules} icon="event" tone="green" onClick={() => onNavigate('schedule')} />
            <StatCard label="Incidents (advisees)" value={d.metrics.incidentReports} icon="report" tone="slate" onClick={() => onNavigate('incident-reports')} />
          </div>
          <Card title="Recent leave activity">
            {d.activities.length === 0 ? (
              <EmptyState icon="history" title="No recent activity" />
            ) : (
              <ul className="divide-y divide-[var(--kv-border-soft)]">
                {d.activities.map((a) => (
                  <li key={a.id} className="py-2.5 flex flex-wrap justify-between gap-2">
                    <span>
                      <span className="text-sm font-semibold text-[var(--kv-heading)] capitalize">{a.title}</span>
                      <span className="block text-xs text-[var(--kv-text-muted)]">
                        {a.description} · {a.timestamp}
                      </span>
                    </span>
                    {a.badge && <StatusBadge status={a.badge} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </AsyncContent>
  </div>
);

interface AdvLeave {
  id: string;
  studentName: string;
  regNumber: string;
  year: string;
  roomNumber: string;
  leaveType: string;
  reason: string;
  dateRange: string;
  fromDate: string;
  days: number;
  submittedDateTime: string;
  workflowStage: string;
  section: string | null;
  department: string;
  parentName: string;
  parentNumber: string;
  parentApproved: boolean;
  addressDuringLeave: string;
  classInchargeRemarks?: string;
  hodRemarks?: string;
  wardenRemarks?: string;
  pendingWith?: string | null;
  history?: HistoryEntry[];
}

const PENDING_STAGE = 'Pending Class Incharge';

const AdviserLeaves: React.FC<{ onShowToast: (m: string, e?: boolean) => void; onChanged: () => void }> = ({ onShowToast, onChanged }) => {
  const list = useResource(() => http.get<AdvLeave[]>('/adviser/leave-requests'));
  const [view, setView] = useState('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = (list.data ?? []).filter((l) => (view === 'pending' ? l.workflowStage === PENDING_STAGE : view === 'all' ? true : l.workflowStage !== PENDING_STAGE));
  const assignment = useResource(() => http.get<{ isClassIncharge: boolean; department: string | null; section: string | null; students: unknown[] }>('/adviser/class-incharge'));
  const a = assignment.data;
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Leave Requests"
        subtitle={
          a && a.isClassIncharge
            ? `Class Incharge, ${a.department} Section ${a.section}. You are the first of three approvals — your approval sends the request to the HOD, then the Warden.`
            : 'Stage 1 of the approval chain: Class Incharge → HOD → Warden.'
        }
        icon="description"
      />
      {a && !a.isClassIncharge && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You are not currently assigned as a Class Incharge, so no leave requests are routed to you. An administrator assigns the department and section.
        </div>
      )}
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'pending', label: 'Awaiting you', count: (list.data ?? []).filter((l) => l.workflowStage === PENDING_STAGE).length },
            { id: 'decided', label: 'Decided' },
            { id: 'all', label: 'All' },
          ]}
        />
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.studentName} ${r.regNumber} ${r.reason}`}
              onRowClick={(r) => setOpenId(r.id)}
              emptyTitle={view === 'pending' ? 'No leave awaiting your review' : 'No leave requests'}
              columns={[
                { key: 'studentName', label: 'Student', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.studentName}</span> },
                { key: 'regNumber', label: 'Reg. No' },
                { key: 'section', label: 'Section', render: (r) => (r.section ? `Section ${r.section}` : '—') },
                { key: 'leaveType', label: 'Type' },
                { key: 'dateRange', label: 'Dates', sortValue: (r) => r.fromDate, render: (r) => `${r.dateRange} (${r.days}d)` },
                { key: 'parentApproved', label: 'Parent', render: (r) => (r.parentApproved ? <Badge tone="green">Confirmed</Badge> : <Badge tone="slate">Not recorded</Badge>) },
                { key: 'workflowStage', label: 'Stage', render: (r) => <StatusBadge status={r.workflowStage} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {openId && (
        <AdvLeaveModal
          id={openId}
          onClose={() => setOpenId(null)}
          onDone={() => {
            list.reload();
            onChanged();
          }}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};

const AdvLeaveModal: React.FC<{ id: string; onClose: () => void; onDone: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ id, onClose, onDone, onShowToast }) => {
  const d = useResource(() => http.get<AdvLeave & { workflowStatus: string; name: string }>(`/adviser/leave-requests/${id}`), [id]);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const l = d.data;
  const pendingReview = l?.workflowStatus === PENDING_STAGE;
  const decide = async (decision: 'Approved' | 'Rejected') => {
    if (decision === 'Rejected' && !remarks.trim()) return setError('Give the reason for rejecting.');
    const r = await run(() => http.post(`/adviser/leave-requests/${id}/decision`, { decision, remarks: remarks.trim() || undefined }));
    if (r) {
      onDone();
      onClose();
    }
  };
  const parent = async (confirmed: boolean) => {
    const r = await run(() => http.post(`/adviser/leave-requests/${id}/parent-confirmation`, { confirmed }));
    if (r) {
      d.reload();
      onDone();
    }
  };
  return (
    <Modal
      open
      size="lg"
      title={l ? `Leave ${l.id}` : 'Leave'}
      description={l ? `${l.name} · ${l.regNumber}` : undefined}
      onClose={onClose}
      footer={
        pendingReview ? (
          <>
            <Button variant="danger" loading={pending} onClick={() => decide('Rejected')}>
              Reject
            </Button>
            <Button variant="success" loading={pending} onClick={() => decide('Approved')}>
              Approve &amp; forward to HOD
            </Button>
          </>
        ) : undefined
      }
    >
      <AsyncContent {...d} onRetry={d.reload}>
        {(r) => (
          <div className="space-y-4">
            <StatusBadge status={r.workflowStatus} />
            <KeyValue
              items={[
                ['Type', r.leaveType],
                ['Dates', `${r.dateRange} (${r.days} day(s))`],
                ['Section', r.section ? `${r.department} Section ${r.section}` : '—'],
                ['Currently with', r.pendingWith ?? '—'],
                ['Room', r.roomNumber],
                ['Address during leave', r.addressDuringLeave || '—'],
                ['Parent', `${r.parentName || '—'}${r.parentNumber ? ` · ${r.parentNumber}` : ''}`],
                ['Parent confirmation', r.parentApproved ? 'Recorded' : 'Not recorded'],
              ]}
            />
            <p className="text-sm bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 whitespace-pre-wrap">{r.reason}</p>
            <Attachments entityType="leave_request" entityId={r.id} onToast={onShowToast} label="Supporting document" />
            {pendingReview && (
              <>
                <div className="flex flex-wrap gap-2">
                  {r.parentNumber && (
                    <a href={`tel:${r.parentNumber.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--kv-border)] px-3 py-1.5 text-xs font-semibold text-[var(--kv-heading)] hover:bg-[var(--kv-accent-soft)]">
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">call</span> Call parent
                    </a>
                  )}
                  <Button size="sm" variant="secondary" loading={pending} onClick={() => parent(!r.parentApproved)}>
                    {r.parentApproved ? 'Clear parent confirmation' : 'Log parent confirmation'}
                  </Button>
                </div>
                <TextArea label="Remarks" hint="Required when rejecting." rows={3} value={remarks} error={error} onChange={(e) => (setRemarks(e.target.value), setError(null))} />
              </>
            )}
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
              <Timeline events={r.history} />
            </div>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

const AdviserAttendance: React.FC<{ onShowToast: (m: string, e?: boolean) => void }> = ({ onShowToast }) => {
  const [view, setView] = useState('absences');
  const study = useResource(
    () =>
      http.get<{ rows: { label: string; participationPct: number | null }[]; repeatedMisses: { studentId: string; name: string; regNumber: string; missed: number; lastMissed: string }[] }>(
        `/study/summary${qs({ from: addDaysInput(-29), to: todayInput(), groupBy: 'session' })}`,
      ),
    [],
  );
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Attendance & Study" subtitle="Your advisees' absence records and study-session participation, from the Warden's records." icon="how_to_reg" />
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'absences', label: 'Absence records' },
            { id: 'study', label: 'Study participation' },
          ]}
        />
      </div>
      {view === 'absences' ? (
        <AbsenceCases onShowToast={onShowToast} defaultView="verified" />
      ) : (
        <AsyncContent {...study} onRetry={study.reload}>
          {(s) => (
            <div className="grid lg:grid-cols-2 gap-5">
              <Card title="Participation by session (last 30 days)">
                <BarList data={s.rows.map((r) => ({ label: r.label, value: r.participationPct, suffix: '%' }))} max={100} emptyMessage="No study attendance recorded for your advisees." />
              </Card>
              <Card title="Advisees repeatedly missing sessions">
                <DataTable
                  rows={s.repeatedMisses}
                  rowKey={(r) => r.studentId}
                  emptyTitle="No repeated absences"
                  columns={[
                    { key: 'name', label: 'Student' },
                    { key: 'regNumber', label: 'Reg. No' },
                    { key: 'missed', label: 'Missed' },
                    { key: 'lastMissed', label: 'Latest' },
                  ]}
                />
              </Card>
            </div>
          )}
        </AsyncContent>
      )}
    </div>
  );
};

const AdviseeSummary: React.FC = () => {
  const students = useResource(() => http.get<{ id: string; name: string; regNumber: string; academic: { latestPct: number | null; trend: string; needsSupport: boolean; reasons: string[]; openSupportFollowups: number } | null }[]>('/adviser/students'));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Advisee Summary" subtitle="Academic indicators computed from entered records and the configured support rule." icon="insights" />
      <AsyncContent {...students} onRetry={students.reload}>
        {(list) => {
          const withRecords = list.filter((s) => s.academic?.latestPct != null);
          const trend = (t: string) => list.filter((s) => s.academic?.trend === t).length;
          const support = list.filter((s) => s.academic?.needsSupport);
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <StatCard label="Advisees" value={list.length} />
                <StatCard label="With records" value={withRecords.length} tone="blue" />
                <StatCard label="Improving" value={trend('Improving')} tone="green" />
                <StatCard label="Declining" value={trend('Declining')} tone="red" />
                <StatCard label="Need support" value={support.length} tone="amber" hint={`${support.filter((s) => !s.academic?.openSupportFollowups).length} without a follow-up`} />
              </div>
              <Card title="Students who may need academic support">
                <DataTable
                  rows={support}
                  rowKey={(s) => s.id}
                  emptyTitle={withRecords.length ? 'No advisees flagged' : 'No academic records entered yet'}
                  columns={[
                    { key: 'name', label: 'Student' },
                    { key: 'regNumber', label: 'Reg. No' },
                    { key: 'latest', label: 'Latest %', render: (s) => (s.academic?.latestPct != null ? `${s.academic.latestPct}%` : '—') },
                    { key: 'trend', label: 'Trend', render: (s) => s.academic?.trend ?? '—' },
                    { key: 'reasons', label: 'Reason', render: (s) => <span className="text-xs">{s.academic?.reasons.join('; ')}</span> },
                    { key: 'fu', label: 'Follow-up', render: (s) => (s.academic?.openSupportFollowups ? <Badge tone="blue">Open</Badge> : <Badge tone="amber">None yet</Badge>) },
                  ]}
                />
              </Card>
            </div>
          );
        }}
      </AsyncContent>
    </div>
  );
};
