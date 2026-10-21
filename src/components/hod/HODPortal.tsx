import React, { useMemo, useState } from 'react';
import type { PortalProps } from '../../App';
import type { StudentRecord } from '../../types';
import { http, qs } from '../../services/http';
import { useAction, useResource, usePolling } from '../../hooks/useApi';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { useAuth } from '../../auth/AuthContext';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { AccountPage } from '../common/Account';
import { StudentDirectory } from '../common/StudentDirectory';
import { AcademicRecords } from '../common/AcademicRecords';
import { AbsenceCases } from '../common/AbsenceCases';
import { Incidents } from '../common/Incidents';
import { TasksInbox, ScheduleInbox, ReportRequestsInbox } from '../common/WorkInbox';
import { AsyncContent, Badge, BarList, Button, Card, DataTable, EmptyState, KeyValue, Modal, PageHeader, SelectField, StatCard, StatusBadge, Tabs, TextArea, TextField, Timeline, addDaysInput, todayInput } from '../common/ui';
import { Attachments } from '../common/Attachments';

const TABS = ['dashboard', 'students', 'advisers', 'adviser-assignment', 'academics', 'attendance', 'incident-reports', 'leave-requests', 'leave-reports', 'analytics', 'tasks', 'schedule', 'report-requests', 'notifications', 'profile'] as const;
type HodRoute = (typeof TABS)[number];
const TITLES: Record<HodRoute, string> = {
  dashboard: 'Dashboard',
  students: 'Department Students',
  advisers: 'Adviser Progress',
  'adviser-assignment': 'Adviser Assignment',
  academics: 'Academic Records',
  attendance: 'Attendance & Study',
  'incident-reports': 'Incident Reports',
  'leave-requests': 'Leave Approvals',
  'leave-reports': 'Leave Reports',
  analytics: 'Analytics',
  tasks: 'My Tasks',
  schedule: 'My Schedule',
  'report-requests': 'Report Requests',
  notifications: 'Notifications',
  profile: 'Profile',
};

interface HodDashboard {
  department: string;
  metrics: Record<string, number>;
  recentActivity: { id: string; title: string; sub: string; time: string; type: string; badge?: string }[];
}

export const HODPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { user } = useAuth();
  const { tab, navigate } = usePortalRoute<HodRoute>('hod', TABS, 'dashboard');
  const dash = useResource(() => http.get<HodDashboard>('/hod/dashboard'));
  usePolling(dash.reload, 60_000);
  const m = dash.data?.metrics;

  const nav: NavItem<HodRoute>[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Department' },
    { id: 'students', label: 'Department Students', icon: 'groups', section: 'Department' },
    { id: 'advisers', label: 'Adviser Progress', icon: 'supervisor_account', section: 'Department' },
    { id: 'adviser-assignment', label: 'Adviser Assignment', icon: 'assignment_ind', section: 'Department' },
    { id: 'academics', label: 'Academic Records', icon: 'school', section: 'Department' },
    { id: 'attendance', label: 'Attendance & Study', icon: 'how_to_reg', section: 'Department', badge: m?.verifiedAbsencesOpen },
    { id: 'incident-reports', label: 'Incident Reports', icon: 'report', section: 'Department', badge: m?.pendingIncidentReports },
    { id: 'leave-requests', label: 'Leave Approvals', icon: 'fact_check', section: 'Department', badge: m?.pendingLeaveRequests },
    { id: 'leave-reports', label: 'Leave Reports', icon: 'event_note', section: 'Department' },
    { id: 'analytics', label: 'Analytics', icon: 'insights', section: 'Department' },
    { id: 'tasks', label: 'My Tasks', icon: 'assignment', section: 'From the Dean', badge: m?.pendingTasks },
    { id: 'schedule', label: 'My Schedule', icon: 'event', section: 'From the Dean', badge: m?.upcomingSchedules },
    { id: 'report-requests', label: 'Report Requests', icon: 'assignment_turned_in', section: 'From the Dean', badge: m?.pendingReportRequests },
    { id: 'notifications', label: 'Notifications', icon: 'notifications', section: 'Account' },
  ];

  return (
    <PortalShell
      portalLabel={`HOD · ${user?.departmentCode ?? ''}`}
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={(t) => navigate(t)}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote={`Department of ${user?.departmentCode ?? ''}`}
    >
      {tab === 'dashboard' && <HodHome dash={dash} onNavigate={(t) => navigate(t)} />}
      {tab === 'students' && (
        <div className="max-w-7xl mx-auto">
          <PageHeader title="Department Students" subtitle="Students of your department with academic, attendance and support indicators." icon="groups" />
          <StudentDirectory endpoint="/hod/students" emptyMessage="No students are registered in your department." />
        </div>
      )}
      {tab === 'advisers' && <HodAdvisers />}
      {tab === 'adviser-assignment' && <HodAdviserAssignment onShowToast={onShowToast} />}
      {tab === 'academics' && (
        <div className="max-w-7xl mx-auto">
          <PageHeader title="Academic Records" subtitle="Approved assessment results for your department." icon="school" />
          <AcademicRecords studentsEndpoint="/hod/students" onShowToast={onShowToast} />
        </div>
      )}
      {tab === 'attendance' && <HodAttendance onShowToast={onShowToast} />}
      {tab === 'incident-reports' && (
        <div className="max-w-7xl mx-auto">
          <PageHeader title="Incident Reports" subtitle="Hostel incidents involving students of your department." icon="report" />
          <Incidents onShowToast={onShowToast} studentsEndpoint="/hod/students" />
        </div>
      )}
      {tab === 'leave-requests' && <HodLeaveApprovals onShowToast={onShowToast} onChanged={dash.reload} />}
      {tab === 'leave-reports' && <HodLeaves onShowToast={onShowToast} />}
      {tab === 'analytics' && <HodAnalytics />}
      {tab === 'tasks' && <TasksInbox onShowToast={onShowToast} />}
      {tab === 'schedule' && <ScheduleInbox onShowToast={onShowToast} />}
      {tab === 'report-requests' && <ReportRequestsInbox onShowToast={onShowToast} />}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' && <AccountPage onToast={onShowToast} onSignOut={onSignOut} />}
    </PortalShell>
  );
};

const HodHome: React.FC<{ dash: { data: HodDashboard | null; loading: boolean; error: string | null; reload: () => void }; onNavigate: (t: HodRoute) => void }> = ({ dash, onNavigate }) => (
  <div className="max-w-7xl mx-auto space-y-5">
    <PageHeader title="HOD Dashboard" subtitle="Department overview built from shared hostel, academic and Dean work records." icon="account_balance" />
    <AsyncContent {...dash} onRetry={dash.reload}>
      {(d) => (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Department students" value={d.metrics.totalStudents} hint={`${d.metrics.hostelStudents} in hostel`} icon="groups" onClick={() => onNavigate('students')} />
            <StatCard
              label="May need academic support"
              value={d.metrics.studentsWithAcademicRecords ? d.metrics.studentsNeedingSupport : '—'}
              hint={d.metrics.studentsWithAcademicRecords ? 'Per configured threshold / decline rule' : 'No academic records entered yet'}
              icon="school"
              tone="amber"
              onClick={() => onNavigate('academics')}
            />
            <StatCard label="Open verified absences" value={d.metrics.verifiedAbsencesOpen} icon="gpp_bad" tone="red" onClick={() => onNavigate('attendance')} />
            <StatCard label="Incidents pending review" value={d.metrics.pendingIncidentReports} hint={`${d.metrics.reportsRequiringAttention} high/critical open`} icon="report" tone="violet" onClick={() => onNavigate('incident-reports')} />
            <StatCard label="My open tasks" value={d.metrics.pendingTasks} icon="assignment" onClick={() => onNavigate('tasks')} />
            <StatCard label="Report requests" value={d.metrics.pendingReportRequests} icon="assignment_turned_in" tone="amber" onClick={() => onNavigate('report-requests')} />
            <StatCard label="Upcoming activities" value={d.metrics.upcomingSchedules} icon="event" tone="green" onClick={() => onNavigate('schedule')} />
            <StatCard label="Under investigation" value={d.metrics.underInvestigationReports} icon="search" tone="slate" onClick={() => onNavigate('incident-reports')} />
          </div>
          <Card title="Recent department activity">
            {d.recentActivity.length === 0 ? (
              <EmptyState icon="history" title="No recent activity" />
            ) : (
              <ul className="divide-y divide-[var(--kv-border-soft)]">
                {d.recentActivity.map((a) => (
                  <li key={a.id} className="py-2.5 flex flex-wrap justify-between gap-2">
                    <span>
                      <span className="text-sm font-semibold text-[var(--kv-heading)] capitalize">{a.title}</span>
                      <span className="block text-xs text-[var(--kv-text-muted)]">
                        {a.sub} · {a.time}
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

interface AdviserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  designation: string | null;
  advisees: number;
  adviseesNeedingSupport: number;
  tasks: { total: number; completed: number; completedOnTime: number; open: number; overdue: number; unacknowledged: number };
  reports: { outstanding: number; overdue: number };
  followups: { open: number; overdue: number; completed: number; mentoringSessions: number };
}

/** The department's student list, as the assignment screen reads it. */
interface HodStudent extends StudentRecord {
  adviserId: string | null;
  adviserName: string | null;
}

/**
 * Assigning the department's students to its advisers. The HOD owns this: both
 * the adviser list and the student pool come from department-scoped endpoints,
 * so nothing outside their department can be reached from here.
 */
const FOLLOWUP_CATEGORIES = ['Academic Support', 'Mentoring Session', 'Absence Follow-up', 'Study Session', 'Disciplinary', 'Other'];

const HodAdviserAssignment: React.FC<{ onShowToast: PortalProps['onShowToast'] }> = ({ onShowToast }) => {
  const advisers = useResource(() => http.get<AdviserRow[]>('/hod/advisers'));
  const students = useResource(() => http.get<HodStudent[]>('/hod/students'));
  const [adviserId, setAdviserId] = useState('');
  const blank = { studentId: '', category: 'Academic Support', title: '', dueDate: '', notes: '' };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useAction(onShowToast);
  const adviser = (advisers.data ?? []).find((a) => a.id === adviserId);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  // Only this adviser's own students, plus anyone not yet looked after by someone else.
  const pool = useMemo(
    () => (students.data ?? []).filter((s) => s.enrollmentStatus === 'Active' && (s.adviserId === adviserId || !s.adviserId)),
    [students.data, adviserId],
  );

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!f.studentId) errs.studentId = 'Choose a student.';
    if (!f.title.trim()) errs.title = 'Title is required.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await run(() =>
      http.post(`/hod/advisers/${adviserId}/assign`, {
        studentIds: [f.studentId],
        category: f.category,
        title: f.title.trim(),
        dueDate: f.dueDate || undefined,
        notes: f.notes.trim() || undefined,
      }),
    );
    if (r) {
      setF(blank);
      setErrors({});
      students.reload();
      advisers.reload();
    }
  };

  const mine = useMemo(() => (students.data ?? []).filter((s) => s.adviserId === adviserId), [students.data, adviserId]);
  const unassigned = pool.length - mine.length;

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Adviser Assignment"
        subtitle="An adviser sees only the students assigned here. Choose the adviser, pick the student, and write what the adviser should work on."
        icon="assignment_ind"
      />
      <Card title="Step 1 · Choose the adviser" className="mb-4">
        <AsyncContent {...advisers} onRetry={advisers.reload}>
          {(rows) => (
            <SelectField
              label="Adviser"
              value={adviserId}
              placeholder="Choose an adviser…"
              onChange={(e) => {
                setAdviserId(e.target.value);
                setF(blank);
                setErrors({});
              }}
              options={rows.map((a) => ({ value: a.id, label: `${a.name}${a.designation ? ` — ${a.designation}` : ''} · ${a.advisees} advisee(s)` }))}
              hint={rows.length === 0 ? 'No active advisers in your department yet. Ask the administrator to create one.' : 'Advisers of your department only.'}
            />
          )}
        </AsyncContent>
      </Card>
      {!adviser ? (
        <Card>
          <EmptyState icon="assignment_ind" title="No adviser chosen yet" message="Pick an adviser above to see their students and assign a new one." />
        </Card>
      ) : (
        <>
          <Card title={`Step 2 · Assign a student to ${adviser.name}`} className="mb-4">
            <AsyncContent {...students} onRetry={students.reload}>
              {() => (
                <>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <SelectField
                        label="Student"
                        required
                        value={f.studentId}
                        placeholder="Choose…"
                        onChange={set('studentId')}
                        options={pool.map((s) => ({ value: s.id, label: `${s.name} · ${s.regNumber}${s.adviserId === adviser.id ? ' · already with this adviser' : ' · not yet assigned'}` }))}
                        error={errors.studentId}
                        hint={pool.length === 0 ? 'Every student of your department already has another adviser.' : `${mine.length} with this adviser · ${unassigned} not yet assigned`}
                      />
                    </div>
                    <SelectField label="What should the adviser work on?" value={f.category} onChange={set('category')} options={FOLLOWUP_CATEGORIES} />
                    <TextField label="Title" required value={f.title} onChange={set('title')} error={errors.title} placeholder="e.g. Improve internal marks in DBMS" />
                    <TextField label="Finish by" type="date" min={todayInput()} value={f.dueDate} onChange={set('dueDate')} hint="Optional" />
                    <div className="sm:col-span-2">
                      <TextArea label="Notes for the adviser" rows={3} value={f.notes} onChange={set('notes')} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--kv-border-soft)]">
                    <span className="mr-auto text-xs text-[var(--kv-text-muted)]">Saving assigns the student and opens this work in the adviser's follow-up list.</span>
                    <Button variant="secondary" disabled={pending} onClick={() => { setF(blank); setErrors({}); }}>
                      Clear
                    </Button>
                    <Button icon="how_to_reg" loading={pending} onClick={save}>
                      Assign &amp; save
                    </Button>
                  </div>
                </>
              )}
            </AsyncContent>
          </Card>
          <Card title={`Students already with ${adviser.name} (${mine.length})`}>
            {mine.length === 0 ? (
              <EmptyState icon="group" title="No students yet" message="Assign the first student with the form above." />
            ) : (
              <DataTable
                rows={mine}
                rowKey={(s) => s.id}
                pageSize={8}
                emptyTitle="No students yet"
                columns={[
                  { key: 'name', label: 'Student' },
                  { key: 'regNumber', label: 'Reg. No', className: 'w-[11rem]' },
                  { key: 'year', label: 'Year', className: 'w-[6rem]' },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
};

const HodAdvisers: React.FC = () => {
  const list = useResource(() => http.get<AdviserRow[]>('/hod/advisers'));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Adviser Progress" subtitle="Operational counts per adviser in your department. These are activity counts, not performance ratings." icon="supervisor_account" />
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => r.name}
              emptyTitle="No advisers in your department"
              columns={[
                { key: 'name', label: 'Adviser', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span> },
                { key: 'advisees', label: 'Advisees' },
                { key: 'adviseesNeedingSupport', label: 'Need support' },
                { key: 'followupsOpen', label: 'Open follow-ups', sortValue: (r) => r.followups.open, render: (r) => `${r.followups.open}${r.followups.overdue ? ` (${r.followups.overdue} overdue)` : ''}` },
                { key: 'mentoring', label: 'Mentoring sessions', sortValue: (r) => r.followups.mentoringSessions, render: (r) => r.followups.mentoringSessions },
                { key: 'tasks', label: 'Dean tasks', sortValue: (r) => r.tasks.open, render: (r) => `${r.tasks.completed}/${r.tasks.total} done${r.tasks.overdue ? ` · ${r.tasks.overdue} overdue` : ''}` },
                { key: 'reports', label: 'Reports outstanding', sortValue: (r) => r.reports.outstanding, render: (r) => r.reports.outstanding },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
    </div>
  );
};

const HodAttendance: React.FC<{ onShowToast: (m: string, e?: boolean) => void }> = ({ onShowToast }) => {
  const [view, setView] = useState('absences');
  const study = useResource(
    () =>
      http.get<{ rows: { key: string; label: string; participationPct: number | null; marked: number }[]; repeatedMisses: { studentId: string; name: string; regNumber: string; year: string; missed: number; lastMissed: string }[] }>(
        `/study/summary${qs({ from: addDaysInput(-29), to: todayInput(), groupBy: 'year' })}`,
      ),
    [],
  );
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Attendance & Study" subtitle="Hostel absence records and study-session participation for your department (from the Warden's records)." icon="how_to_reg" />
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
              <Card title="Participation by year (last 30 days)">
                <BarList data={s.rows.map((r) => ({ label: r.label, value: r.participationPct, suffix: '%' }))} max={100} emptyMessage="No study attendance recorded." />
              </Card>
              <Card title="Students repeatedly missing sessions">
                <DataTable
                  rows={s.repeatedMisses}
                  rowKey={(r) => r.studentId}
                  pageSize={8}
                  emptyTitle="No repeated absences"
                  columns={[
                    { key: 'name', label: 'Student' },
                    { key: 'regNumber', label: 'Reg. No' },
                    { key: 'year', label: 'Year' },
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


interface HodLeave {
  id: string;
  name: string;
  studentName: string;
  regNumber: string;
  year: string;
  section: string | null;
  roomNumber: string;
  leaveType: string;
  reason: string;
  dateRange: string;
  fromDate: string;
  days: number;
  submittedDateTime: string;
  departureDisplay?: string;
  returnDisplay?: string;
  workflowStatus: string;
  canDecide?: boolean;
  pendingWith?: string | null;
  parentName: string;
  parentNumber: string;
  parentApproved: boolean;
  addressDuringLeave: string;
  classInchargeName?: string;
  classInchargeRemarks?: string;
  approvals?: { stage: string; by: string | null; decision: string | null; atDisplay?: string; remarks: string | null }[];
  history?: { id: number; action: string; note: string | null; createdAt: string; actorName: string | null; actorRole: string | null; fromStatus: string | null; toStatus: string | null }[];
}

/**
 * Stage 2 of the chain. Only requests the Class Incharge has already approved can be
 * decided here; the server enforces that, and the queue reflects it.
 */
const HodLeaveApprovals: React.FC<{ onShowToast: (m: string, e?: boolean) => void; onChanged: () => void }> = ({ onShowToast, onChanged }) => {
  const list = useResource(() => http.get<HodLeave[]>('/hod/leave-requests'));
  const [view, setView] = useState('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const all = list.data ?? [];
  const pendingCount = all.filter((l) => l.workflowStatus === 'Pending HOD').length;
  const rows = all.filter((l) => (view === 'pending' ? l.workflowStatus === 'Pending HOD' : view === 'all' ? true : l.workflowStatus !== 'Pending HOD'));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Leave Approvals"
        subtitle="Stage 2 of the chain: Class Incharge → HOD → Warden. A request appears here only once its Class Incharge has approved it."
        icon="fact_check"
      />
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'pending', label: 'Awaiting you', count: pendingCount },
            { id: 'decided', label: 'Other stages' },
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
              search={(r) => `${r.name} ${r.regNumber} ${r.leaveType}`}
              onRowClick={(r) => setOpenId(r.id)}
              emptyTitle={view === 'pending' ? 'No leave awaiting your approval' : 'No leave requests'}
              columns={[
                { key: 'id', label: 'Request', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
                { key: 'name', label: 'Student', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span> },
                { key: 'section', label: 'Section', render: (r) => (r.section ? `Section ${r.section}` : '—') },
                { key: 'leaveType', label: 'Type' },
                { key: 'dateRange', label: 'Dates', sortValue: (r) => r.fromDate, render: (r) => `${r.dateRange} (${r.days}d)` },
                { key: 'classInchargeName', label: 'Class Incharge', render: (r) => r.classInchargeName ?? '—' },
                { key: 'workflowStatus', label: 'Stage', render: (r) => <StatusBadge status={r.workflowStatus} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {openId && (
        <HodLeaveModal
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

const HodLeaveModal: React.FC<{ id: string; readOnly?: boolean; onClose: () => void; onDone: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ id, readOnly, onClose, onDone, onShowToast }) => {
  const d = useResource(() => http.get<HodLeave>(`/hod/leave-requests/${id}`), [id]);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const l = d.data;
  const decide = async (decision: 'Approved' | 'Rejected') => {
    if (decision === 'Rejected' && !remarks.trim()) return setError('Give the reason for rejecting.');
    const r = await run(() => http.post(`/hod/leave-requests/${id}/decision`, { decision, remarks: remarks.trim() || undefined }));
    if (r) {
      onDone();
      onClose();
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
        l?.canDecide && !readOnly ? (
          <>
            <Button variant="danger" loading={pending} onClick={() => decide('Rejected')}>
              Reject
            </Button>
            <Button variant="success" loading={pending} onClick={() => decide('Approved')}>
              Approve &amp; forward to Warden
            </Button>
          </>
        ) : undefined
      }
    >
      <AsyncContent {...d} onRetry={d.reload}>
        {(r) => (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={r.workflowStatus} />
              {r.pendingWith && <span className="text-xs text-slate-500">Currently with {r.pendingWith}</span>}
            </div>
            <KeyValue
              items={[
                ['Type', r.leaveType],
                ['Dates', `${r.dateRange} (${r.days} day(s))`],
                ['Section', r.section ? `Section ${r.section}` : '—'],
                ['Departure', r.departureDisplay ?? '—'],
                ['Expected return', r.returnDisplay ?? '—'],
                ['Room', r.roomNumber],
                ['Parent', `${r.parentName || '—'}${r.parentNumber ? ` · ${r.parentNumber}` : ''}`],
                ['Parent confirmation', r.parentApproved ? 'Recorded' : 'Not recorded'],
              ]}
            />
            <p className="text-sm bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 whitespace-pre-wrap">{r.reason}</p>
            {r.approvals && (
              <div className="rounded-lg border border-[var(--kv-border)] divide-y divide-[var(--kv-border-soft)]">
                {r.approvals.map((a) => (
                  <div key={a.stage} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="font-semibold text-slate-700">{a.stage}</span>
                    <span className="text-slate-500">
                      {a.decision ? `${a.decision} by ${a.by ?? '—'}${a.atDisplay ? ` · ${a.atDisplay}` : ''}` : 'Not decided yet'}
                      {a.remarks ? ` — “${a.remarks}”` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Attachments entityType="leave_request" entityId={r.id} onToast={onShowToast} label="Supporting document" />
            {r.canDecide && (
              <TextArea
                label="Remarks"
                hint="Required when rejecting; shown to the student and recorded in the approval history."
                rows={3}
                value={remarks}
                error={error ?? undefined}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  setError(null);
                }}
              />
            )}
            <Timeline events={r.history} />
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

/**
 * "21 Oct 2026 - 22 Oct 2026" reads as "21–22 Oct 2026": the repeated month and
 * year cost the column the room the student and staff names need.
 */
const compactRange = (range: string) => {
  const [a, b] = range.split(' - ');
  const pa = a?.split(' ') ?? [];
  const pb = b?.split(' ') ?? [];
  if (pa.length !== 3 || pb.length !== 3) return range;
  if (pa[1] === pb[1] && pa[2] === pb[2]) return pa[0] === pb[0] ? a : `${pa[0]}–${pb[0]} ${pb[1]} ${pb[2]}`;
  if (pa[2] === pb[2]) return `${pa[0]} ${pa[1]} – ${pb[0]} ${pb[1]} ${pb[2]}`;
  return range;
};

const HodLeaves: React.FC<{ onShowToast: PortalProps['onShowToast'] }> = ({ onShowToast }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useResource(
    () =>
      http.get<{ id: string; name: string; regNumber: string; year: string; leaveType: string; dateRange: string; fromDate: string; days: number; workflowStatus: string; classInchargeName?: string }[]>(
        '/hod/leave-requests',
      ),
  );
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Leave Reports"
        subtitle="Every leave request raised by your department's students, at any stage of the approval chain. Open a row for the full request."
        icon="event_note"
      />
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.name} ${r.regNumber} ${r.leaveType}`}
              onRowClick={(r) => setOpenId(r.id)}
              emptyTitle="No leave requests"
              columns={[
                { key: 'id', label: 'Request', className: 'w-[7rem] font-mono text-xs' },
                { key: 'name', label: 'Student' },
                { key: 'year', label: 'Year', className: 'w-[5.75rem]' },
                { key: 'days', label: 'Days', className: 'w-[4.5rem]', render: (r) => `${r.days}d` },
                { key: 'leaveType', label: 'Type', className: 'w-[9rem]' },
                { key: 'dateRange', label: 'Dates', className: 'w-[8.75rem]', sortValue: (r) => r.fromDate, render: (r) => compactRange(r.dateRange) },
                { key: 'classInchargeName', label: 'Class Incharge', render: (r) => r.classInchargeName ?? '—' },
                { key: 'workflowStatus', label: 'Status', className: 'w-[11.5rem]', render: (r) => <StatusBadge status={r.workflowStatus} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {/* Reports are a record, not an inbox: the same detail view, without the decision buttons. */}
      {openId && <HodLeaveModal id={openId} readOnly onClose={() => setOpenId(null)} onDone={() => list.reload()} onShowToast={onShowToast} />}
    </div>
  );
};

interface HodAnalyticsData {
  from: string;
  to: string;
  academic: {
    summary: { department: string; students: number; studentsWithRecords: number; averageLatestPct: number | null; needsSupport: number; declining: number; improving: number }[];
    byYear: { key: string; students: number; averageLatestPct: number | null; needsSupport: number }[];
  };
  study: { byYear: { label: string; participationPct: number | null }[] };
  absences: { repeated: { studentId: string; name: string; regNumber: string; count: number }[] };
  leaves: { status: string; count: number }[];
  incidentsByCategory: { category: string; count: number }[];
}

const HodAnalytics: React.FC = () => {
  const [from, setFrom] = useState(addDaysInput(-29));
  const [to, setTo] = useState(todayInput());
  const data = useResource(() => http.get<HodAnalyticsData>(`/hod/analytics${qs({ from, to })}`), [from, to]);
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Department Analytics" subtitle="All figures are computed from recorded data for the selected period." icon="insights" />
      <div className="flex flex-wrap gap-3 mb-4">
        <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1">
          From
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm bg-white" />
        </label>
        <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1">
          To
          <input type="date" value={to} min={from} max={todayInput()} onChange={(e) => e.target.value && setTo(e.target.value)} className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm bg-white" />
        </label>
      </div>
      <AsyncContent {...data} onRetry={data.reload}>
        {(d) => (
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="Academic performance by year (latest assessment)">
              {d.academic.byYear.every((y) => y.averageLatestPct === null) ? (
                <EmptyState icon="school" title="No academic records entered" />
              ) : (
                <BarList data={d.academic.byYear.map((y) => ({ label: `${y.key} (${y.needsSupport} need support)`, value: y.averageLatestPct, suffix: '%' }))} max={100} />
              )}
            </Card>
            <Card title="Study-session participation by year">
              <BarList data={d.study.byYear.map((y) => ({ label: y.label, value: y.participationPct, suffix: '%' }))} max={100} emptyMessage="No study attendance in this period." />
            </Card>
            <Card title="Incidents by category">
              <BarList data={d.incidentsByCategory.map((c) => ({ label: c.category, value: c.count }))} emptyMessage="No incidents in this period." />
            </Card>
            <Card title="Repeated unauthorized absences" className="lg:col-span-2">
              {d.absences.repeated.length === 0 ? (
                <EmptyState icon="verified" title="No students at the repeat threshold" />
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {d.absences.repeated.map((r) => (
                    <li key={r.studentId}>
                      <Badge tone="red">
                        {r.name} ({r.regNumber}) — {r.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </AsyncContent>
    </div>
  );
};
