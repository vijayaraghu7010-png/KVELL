import React, { useMemo, useState } from 'react';
import { http, qs } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { followLink } from '../../hooks/usePortalRoute';
import { AsyncContent, Badge, Button, Card, DataTable, EmptyState, FilterSelect, KeyValue, Modal, PageHeader, StatCard, StatusBadge, Tabs, type Tone } from '../common/ui';
import type { DeanRoute } from './DeanPortal';

interface Metric {
  value: number | null;
  unit?: string;
  definition: string;
  recorded?: number;
}
interface DeanDashboardData {
  asOf: string;
  metrics: Record<string, Metric>;
  urgent: { kind: string; title: string; who: string; when: string; link: string }[];
  upcoming: { id: string; title: string; category: string; when: string; location: string | null; status: string }[];
  departments: { department: string; students: number; studentsWithRecords: number; averageLatestPct: number | null; needsSupport: number }[];
  /** Per-recipient lifecycle counts across every active assignment. */
  assignmentLifecycle: Record<string, number>;
  departmentDirectory: { code: string; name: string; hodId: string | null; hodName: string | null; advisers: number; hostellerAdvisers: number; hostelStudents: number; openTasks: number; overdueTasks: number }[];
  studentMonitoring: {
    scope: string[];
    academicPerformance: { recordsEntered: boolean; needingSupport: number; declining: number };
    uninformedAbsence: { verifiedUnauthorized: number; suspected: number; awaitingVerification: number; leavePending: number; total: number };
  };
  wardenReports: { type: string; title: string; description: string }[];
  scope: { studentMonitoring: string[]; wardenMonitoring: string[]; readOnly: string; cannotBypass: string };
}

const LIFECYCLE_STEPS = ['Assigned', 'Acknowledged', 'In Progress', 'Submitted', 'Revision Requested', 'Completed'] as const;

const METRIC_LAYOUT: { key: string; label: string; icon: string; tone: Tone; route: DeanRoute }[] = [
  { key: 'totalHostelStudents', label: 'Hostel students', icon: 'groups', tone: 'blue', route: 'uninformed-absence' },
  { key: 'studentsPresent', label: 'Present tonight', icon: 'how_to_reg', tone: 'green', route: 'attendance' },
  { key: 'absencesAwaitingVerification', label: 'Absences awaiting verification', icon: 'pending_actions', tone: 'amber', route: 'attendance' },
  { key: 'verifiedUnauthorizedAbsences', label: 'Verified unauthorized (30 d)', icon: 'gpp_bad', tone: 'red', route: 'attendance' },
  { key: 'repeatedUnauthorizedAbsences', label: 'Repeated unauthorized absence', icon: 'repeat', tone: 'red', route: 'attendance' },
  { key: 'studyParticipation', label: 'Study participation (30 d)', icon: 'menu_book', tone: 'violet', route: 'study' },
  { key: 'studentsNeedingAcademicSupport', label: 'May need academic support', icon: 'school', tone: 'amber', route: 'academics' },
  { key: 'hodTasksPending', label: 'HOD tasks pending', icon: 'assignment', tone: 'blue', route: 'hods' },
  { key: 'adviserTasksPending', label: 'Adviser tasks pending', icon: 'assignment_ind', tone: 'blue', route: 'advisers' },
  { key: 'overdueAssignments', label: 'Overdue assignments', icon: 'alarm', tone: 'red', route: 'progress' },
  { key: 'reportsAwaitingSubmission', label: 'Reports awaiting submission', icon: 'assignment_late', tone: 'amber', route: 'report-distribution' },
  { key: 'upcomingActivities', label: 'Activities (next 7 d)', icon: 'event', tone: 'green', route: 'schedule' },
];

export const DeanDashboard: React.FC<{ onNavigate: (r: DeanRoute) => void }> = ({ onNavigate }) => {
  const d = useResource(() => http.get<DeanDashboardData>('/dean/dashboard'));
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Dean Dashboard"
        subtitle="Overall hostel administration — every figure is computed from records in the shared database. Hover a card for its definition."
        icon="dashboard"
        actions={<Button variant="secondary" icon="refresh" onClick={d.reload}>Refresh</Button>}
      />
      <AsyncContent {...d} onRetry={d.reload}>
        {(x) => (
          <>
            <p className="text-xs text-[var(--kv-text-muted)]">As of {x.asOf}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {METRIC_LAYOUT.map((m) => {
                const metric = x.metrics[m.key];
                return (
                  <StatCard
                    key={m.key}
                    label={m.label}
                    value={metric?.value === null || metric?.value === undefined ? '—' : `${metric.value}${metric.unit ?? ''}`}
                    icon={m.icon}
                    tone={m.tone}
                    definition={metric?.definition}
                    hint={metric?.definition}
                    onClick={() => onNavigate(m.route)}
                  />
                );
              })}
            </div>
            <div className="grid lg:grid-cols-3 gap-5">
              <Card title="Needs your attention" className="lg:col-span-2" actions={<Badge tone={x.urgent.length ? 'red' : 'green'}>{x.urgent.length}</Badge>}>
                {x.urgent.length === 0 ? (
                  <EmptyState icon="task_alt" title="Nothing needs attention right now" />
                ) : (
                  <ul className="divide-y divide-[var(--kv-border-soft)]">
                    {x.urgent.map((u, i) => (
                      <li key={i}>
                        <button type="button" onClick={() => followLink(u.link, 'dean')} className="w-full text-left py-2.5 px-2 rounded-lg hover:bg-[var(--kv-accent-soft)] flex flex-wrap items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[var(--kv-heading)]">{u.title}</span>
                            <span className="block text-xs text-[var(--kv-text-muted)]">
                              {u.who} · {u.when}
                            </span>
                          </span>
                          <StatusBadge status={u.kind} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Upcoming activities" actions={<Button size="sm" variant="ghost" onClick={() => onNavigate('schedule')}>Calendar →</Button>}>
                {x.upcoming.length === 0 ? (
                  <EmptyState icon="event_available" title="Nothing scheduled" />
                ) : (
                  <ul className="space-y-2.5">
                    {x.upcoming.map((u) => (
                      <li key={u.id}>
                        <button type="button" onClick={() => followLink(`/dean/schedule/${u.id}`, 'dean')} className="text-left w-full hover:bg-[var(--kv-accent-soft)] rounded-lg p-1.5">
                          <span className="block text-sm font-semibold text-[var(--kv-heading)]">{u.title}</span>
                          <span className="block text-xs text-[var(--kv-text-muted)]">
                            {u.when}
                            {u.location ? ` · ${u.location}` : ''} · {u.category}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            {/* Work assignment lifecycle, counted per recipient */}
            <Card
              title="Work assignments — every recipient counted separately"
              actions={
                <Button size="sm" variant="ghost" onClick={() => onNavigate('assignments')}>
                  Assignments →
                </Button>
              }
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {LIFECYCLE_STEPS.map((step) => (
                  <div key={step} className="rounded-lg border border-[var(--kv-border)] px-3 py-2">
                    <p className="text-[18px] font-bold text-[var(--kv-heading)]">{x.assignmentLifecycle?.[step] ?? 0}</p>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">{step}</p>
                  </div>
                ))}
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                  <p className="text-[18px] font-bold text-rose-700">{x.assignmentLifecycle?.overdue ?? 0}</p>
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-rose-600">Overdue</p>
                </div>
                <div className="rounded-lg border border-[var(--kv-border)] px-3 py-2">
                  <p className="text-[18px] font-bold text-[var(--kv-text-muted)]">{x.assignmentLifecycle?.drafts ?? 0}</p>
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Drafts</p>
                </div>
              </div>
            </Card>

            <Card title="Departments, HODs and Advisers" actions={<Button size="sm" variant="ghost" onClick={() => onNavigate('hods')}>HOD monitoring →</Button>}>
              <DataTable
                rows={x.departmentDirectory ?? []}
                rowKey={(r) => r.code}
                emptyTitle="No departments configured"
                columns={[
                  { key: 'code', label: 'Department', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.code}</span> },
                  { key: 'name', label: 'Name' },
                  { key: 'hodName', label: 'HOD', render: (r) => r.hodName ?? <Badge tone="amber">Not assigned</Badge> },
                  { key: 'advisers', label: 'Advisers', render: (r) => `${r.advisers} (${r.hostellerAdvisers} hosteller)` },
                  { key: 'hostelStudents', label: 'Hostel students' },
                  { key: 'openTasks', label: 'Open tasks' },
                  { key: 'overdueTasks', label: 'Overdue', render: (r) => (r.overdueTasks ? <Badge tone="red">{r.overdueTasks}</Badge> : '0') },
                ]}
              />
            </Card>

            <Card title="Departments at a glance (academic)" actions={<Button size="sm" variant="ghost" onClick={() => onNavigate('academics')}>Academic performance →</Button>}>
              <DataTable
                rows={x.departments}
                rowKey={(r) => r.department}
                emptyTitle="No departments configured"
                columns={[
                  { key: 'department', label: 'Department' },
                  { key: 'students', label: 'Students' },
                  { key: 'studentsWithRecords', label: 'With academic records' },
                  { key: 'averageLatestPct', label: 'Avg latest %', render: (r) => (r.averageLatestPct === null ? '—' : `${r.averageLatestPct}%`) },
                  { key: 'needsSupport', label: 'May need support' },
                ]}
              />
            </Card>

            {/* The monitoring boundaries, stated rather than implied */}
            {x.scope && (
              <Card title="What this portal monitors">
                <div className="grid sm:grid-cols-2 gap-4 text-xs text-[var(--kv-text-muted)]">
                  <div>
                    <p className="font-semibold text-[var(--kv-heading)] mb-1">Students — three areas only</p>
                    <ul className="list-disc ml-4 space-y-0.5">
                      <li>Study session participation</li>
                      <li>Academic performance</li>
                      <li>Uninformed leave / absence</li>
                    </ul>
                    <p className="mt-1">
                      Uninformed absence now: {x.studentMonitoring?.uninformedAbsence?.verifiedUnauthorized ?? 0} verified, {x.studentMonitoring?.uninformedAbsence?.leavePending ?? 0} with a leave
                      decision still pending.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--kv-heading)] mb-1">Warden — student-related reports only</p>
                    <ul className="list-disc ml-4 space-y-0.5">
                      {(x.wardenReports ?? []).map((r) => (
                        <li key={r.type}>{r.title}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-[var(--kv-text-muted)]">
                  {x.scope.readOnly} {x.scope.cannotBypass}
                </p>
              </Card>
            )}
          </>
        )}
      </AsyncContent>
    </div>
  );
};

// ---------------------------------------------------------------------------
// HOD & Adviser monitoring
// ---------------------------------------------------------------------------
interface Workload {
  tasks: { total: number; completed: number; completedOnTime: number; open: number; overdue: number; unacknowledged: number; awaitingReview: number; onTimeRatePct: number | null };
  reports: { total: number; accepted: number; outstanding: number; overdue: number; unacknowledged: number };
  schedules: { upcoming: number; unacknowledged: number };
  followups: { open: number; overdue: number; completed: number; mentoringSessions: number };
}
interface HodRow {
  department: string;
  departmentName: string;
  hod: { id: string; name: string; email: string; phone: string | null } | null;
  advisers: number;
  students: number;
  academic: { averageLatestPct: number | null; needsSupport: number; declining: number; studentsWithRecords: number } | null;
  openVerifiedAbsences: number;
  workload: Workload | null;
  needsFollowUp: boolean;
  attention: string[];
}

export const DeanHods: React.FC = () => {
  const list = useResource(() => http.get<HodRow[]>('/dean/hods'));
  const [staffId, setStaffId] = useState<string | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const rows = (list.data ?? []).filter((r) => !onlyAttention || r.needsFollowUp);
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="HOD Monitoring" subtitle="Department performance and HOD work progress from shared records. Counts only — no personal scores." icon="account_balance" />
      <div className="mb-3">
        <Tabs
          active={onlyAttention ? 'attention' : 'all'}
          onChange={(v) => setOnlyAttention(v === 'attention')}
          tabs={[
            { id: 'all', label: 'All departments' },
            { id: 'attention', label: 'Needs follow-up', count: (list.data ?? []).filter((r) => r.needsFollowUp).length },
          ]}
        />
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.department}
              onRowClick={(r) => r.hod && setStaffId(r.hod.id)}
              emptyTitle="No departments"
              columns={[
                { key: 'department', label: 'Dept', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.department}</span> },
                { key: 'hod', label: 'HOD', sortValue: (r) => r.hod?.name ?? '', render: (r) => r.hod?.name ?? <Badge tone="red">Not assigned</Badge> },
                { key: 'students', label: 'Students' },
                { key: 'avg', label: 'Avg latest %', sortValue: (r) => r.academic?.averageLatestPct ?? null, render: (r) => (r.academic?.averageLatestPct != null ? `${r.academic.averageLatestPct}%` : '—') },
                { key: 'support', label: 'Need support', sortValue: (r) => r.academic?.needsSupport ?? 0, render: (r) => r.academic?.needsSupport ?? 0 },
                { key: 'abs', label: 'Open verified absences', sortValue: (r) => r.openVerifiedAbsences, render: (r) => r.openVerifiedAbsences },
                {
                  key: 'tasks',
                  label: 'HOD tasks',
                  sortValue: (r) => r.workload?.tasks.open ?? 0,
                  render: (r) => (r.workload ? `${r.workload.tasks.completed}/${r.workload.tasks.total} done · ${r.workload.tasks.overdue} overdue` : '—'),
                },
                { key: 'reports', label: 'Reports outstanding', sortValue: (r) => r.workload?.reports.outstanding ?? 0, render: (r) => r.workload?.reports.outstanding ?? '—' },
                { key: 'attention', label: 'Attention', render: (r) => (r.attention.length ? <span className="text-xs text-rose-700">{r.attention.join('; ')}</span> : <Badge tone="green">On track</Badge>) },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {staffId && <StaffDetail id={staffId} onClose={() => setStaffId(null)} />}
    </div>
  );
};

interface AdviserRow extends Workload {
  id: string;
  name: string;
  department: string;
  designation: string | null;
  advisees: number;
  adviseesNeedingSupport: number;
  adviseesNeedingSupportWithoutFollowup: number;
  adviseesDeclining: number;
}

export const DeanAdvisers: React.FC = () => {
  const [dept, setDept] = useState('');
  const list = useResource(() => http.get<AdviserRow[]>(`/dean/advisers${qs({ department: dept })}`), [dept]);
  const depts = useResource(() => http.get<{ code: string }[]>('/meta/departments'));
  const [staffId, setStaffId] = useState<string | null>(null);
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Adviser Monitoring" subtitle="Advisee support, mentoring, follow-ups and Dean-assigned work per adviser. Counts only — no personal scores." icon="supervisor_account" />
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.name} ${r.department}`}
              onRowClick={(r) => setStaffId(r.id)}
              emptyTitle="No advisers"
              toolbar={<FilterSelect label="Department" value={dept} onChange={setDept} options={(depts.data ?? []).map((d) => d.code)} />}
              columns={[
                { key: 'name', label: 'Adviser', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span> },
                { key: 'department', label: 'Dept' },
                { key: 'advisees', label: 'Advisees' },
                {
                  key: 'support',
                  label: 'Need support',
                  sortValue: (r) => r.adviseesNeedingSupport,
                  render: (r) => (
                    <span>
                      {r.adviseesNeedingSupport}
                      {r.adviseesNeedingSupportWithoutFollowup > 0 && <span className="text-xs text-rose-700"> ({r.adviseesNeedingSupportWithoutFollowup} no follow-up)</span>}
                    </span>
                  ),
                },
                { key: 'declining', label: 'Declining', sortValue: (r) => r.adviseesDeclining, render: (r) => r.adviseesDeclining },
                { key: 'mentoring', label: 'Mentoring sessions', sortValue: (r) => r.followups.mentoringSessions, render: (r) => r.followups.mentoringSessions },
                { key: 'fu', label: 'Follow-ups open / overdue', sortValue: (r) => r.followups.overdue, render: (r) => `${r.followups.open} / ${r.followups.overdue}` },
                { key: 'tasks', label: 'Tasks done / total', sortValue: (r) => r.tasks.open, render: (r) => `${r.tasks.completed}/${r.tasks.total}${r.tasks.overdue ? ` · ${r.tasks.overdue} overdue` : ''}` },
                { key: 'reports', label: 'Reports outstanding', sortValue: (r) => r.reports.outstanding, render: (r) => r.reports.outstanding },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {staffId && <StaffDetail id={staffId} onClose={() => setStaffId(null)} />}
    </div>
  );
};

interface StaffDetailData {
  user: { id: string; name: string; email: string; phone: string | null; role: string; department: string; designation: string | null };
  workload: Workload;
  tasks: { recipientId: string; assignmentId: string; title: string; priority: string; status: string; progressPct: number; due: string; isOverdue: boolean; completedOnTime: boolean | null }[];
  reports: { id: string; requestId: string; title: string; status: string; deadline: string | null; submittedAt: string | null }[];
  schedules: { id: string; title: string; when: string; status: string; response: string }[];
  followups: { id: string; category: string; title: string; status: string; student: string; due: string | null; isOverdue: boolean }[];
}

export const StaffDetail: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const d = useResource(() => http.get<StaffDetailData>(`/dean/staff/${id}`), [id]);
  const [tab, setTab] = useState('tasks');
  return (
    <Modal open size="xl" title={d.data?.user.name ?? 'Staff'} description={d.data ? `${d.data.user.role} · ${d.data.user.department}${d.data.user.designation ? ` · ${d.data.user.designation}` : ''}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(s) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatCard label="Tasks completed" value={`${s.workload.tasks.completed}/${s.workload.tasks.total}`} hint={s.workload.tasks.onTimeRatePct === null ? undefined : `${s.workload.tasks.onTimeRatePct}% of completed were on time`} />
              <StatCard label="Overdue tasks" value={s.workload.tasks.overdue} tone="red" />
              <StatCard label="Reports outstanding" value={s.workload.reports.outstanding} tone="amber" hint={`${s.workload.reports.accepted} accepted`} />
              <StatCard label="Follow-ups open" value={s.workload.followups.open} tone="violet" hint={`${s.workload.followups.overdue} overdue · ${s.workload.followups.mentoringSessions} mentoring`} />
            </div>
            <KeyValue
              cols={3}
              items={[
                ['Email', s.user.email],
                ['Phone', s.user.phone ?? '—'],
                ['Upcoming activities', `${s.workload.schedules.upcoming} (${s.workload.schedules.unacknowledged} unacknowledged)`],
              ]}
            />
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { id: 'tasks', label: 'Tasks', count: s.tasks.length },
                { id: 'reports', label: 'Reports', count: s.reports.length },
                { id: 'schedules', label: 'Schedules', count: s.schedules.length },
                { id: 'followups', label: 'Follow-ups', count: s.followups.length },
              ]}
            />
            {tab === 'tasks' && (
              <DataTable
                rows={s.tasks}
                rowKey={(t) => t.recipientId}
                onRowClick={(t) => followLink(`/dean/assignments/${t.assignmentId}`, 'dean')}
                emptyTitle="No tasks assigned"
                columns={[
                  { key: 'title', label: 'Task' },
                  { key: 'priority', label: 'Priority' },
                  { key: 'due', label: 'Due' },
                  { key: 'progressPct', label: 'Progress', render: (t) => `${t.progressPct}%` },
                  { key: 'status', label: 'Status', render: (t) => <StatusBadge status={t.status} overdue={t.isOverdue} /> },
                ]}
              />
            )}
            {tab === 'reports' && (
              <DataTable
                rows={s.reports}
                rowKey={(r) => r.id}
                onRowClick={(r) => followLink(`/dean/report-distribution/${r.requestId}`, 'dean')}
                emptyTitle="No report requests"
                columns={[
                  { key: 'title', label: 'Request' },
                  { key: 'deadline', label: 'Deadline', render: (r) => r.deadline ?? '—' },
                  { key: 'submittedAt', label: 'Submitted', render: (r) => r.submittedAt ?? '—' },
                  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]}
              />
            )}
            {tab === 'schedules' && (
              <DataTable
                rows={s.schedules}
                rowKey={(r) => r.id}
                emptyTitle="No scheduled activities"
                columns={[
                  { key: 'title', label: 'Activity' },
                  { key: 'when', label: 'When' },
                  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'response', label: 'Response', render: (r) => <StatusBadge status={r.response} /> },
                ]}
              />
            )}
            {tab === 'followups' && (
              <DataTable
                rows={s.followups}
                rowKey={(r) => r.id}
                emptyTitle="No follow-ups"
                columns={[
                  { key: 'student', label: 'Student' },
                  { key: 'category', label: 'Category' },
                  { key: 'title', label: 'Title' },
                  { key: 'due', label: 'Due', render: (r) => r.due ?? '—' },
                  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.isOverdue} /> },
                ]}
              />
            )}
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Consolidated progress tracking
// ---------------------------------------------------------------------------
interface ProgressItem {
  type: string;
  id: string;
  recordId: string;
  title: string;
  assignee: string;
  assigneeRole: string | null;
  department: string | null;
  priority: string | null;
  status: string;
  progressPct: number | null;
  due: string | null;
  dueDisplay: string;
  isOverdue: boolean;
  link: string;
}

export const DeanProgress: React.FC = () => {
  const [type, setType] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [overdue, setOverdue] = useState(false);
  const list = useResource(() => http.getRaw<ProgressItem[]>(`/dean/progress${qs({ type, department: dept, status, priority, overdue: overdue ? '1' : undefined })}`), [type, dept, status, priority, overdue]);
  const depts = useResource(() => http.get<{ code: string }[]>('/meta/departments'));
  const rows = list.data?.data ?? [];
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows]);
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Progress Tracking" subtitle="Assignments, report submissions, scheduled activities, student follow-ups and unresolved absences in one place. Select a row to open the record." icon="query_stats" />
      <Card>
        <AsyncContent data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}>
          {(res) => (
            <DataTable
              rows={rows}
              rowKey={(r) => `${r.type}-${r.id}`}
              search={(r) => `${r.title} ${r.assignee} ${r.department ?? ''}`}
              onRowClick={(r) => followLink(r.link, 'dean')}
              pageSize={15}
              emptyTitle="Nothing matches these filters"
              toolbar={
                <>
                  <FilterSelect label="Type" value={type} onChange={setType} options={res.raw.types ?? []} />
                  <FilterSelect label="Department" value={dept} onChange={setDept} options={(depts.data ?? []).map((d) => d.code)} />
                  <FilterSelect label="Status" value={status} onChange={setStatus} options={statuses} />
                  <FilterSelect label="Priority" value={priority} onChange={setPriority} options={['Low', 'Medium', 'High', 'Urgent']} />
                  <label className="flex items-center gap-2 text-xs font-semibold text-[var(--kv-heading)] pb-2">
                    <input type="checkbox" className="accent-[var(--kv-primary)]" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only
                  </label>
                </>
              }
              columns={[
                { key: 'type', label: 'Type', render: (r) => <Badge tone="slate">{r.type}</Badge> },
                { key: 'title', label: 'Record', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.title}</span> },
                { key: 'assignee', label: 'Responsible', render: (r) => `${r.assignee}${r.assigneeRole ? ` (${r.assigneeRole})` : ''}` },
                { key: 'department', label: 'Dept', render: (r) => r.department ?? '—' },
                { key: 'priority', label: 'Priority', render: (r) => r.priority ?? '—' },
                { key: 'due', label: 'Due / date', sortValue: (r) => r.due, render: (r) => r.dueDisplay },
                { key: 'progressPct', label: 'Progress', render: (r) => (r.progressPct === null ? '—' : `${r.progressPct}%`) },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.isOverdue} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
    </div>
  );
};
