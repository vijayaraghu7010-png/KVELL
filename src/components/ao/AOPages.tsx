import React, { useState } from 'react';
import type { AOTab } from '../../types/ao';
import type { IncidentReport } from '../../types/hod';
import type { Complaint, ComplaintEscalation } from '../../types';
import { http, qs } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { downloadCsv } from '../../services/csv';
import { AsyncContent, Badge, BarList, Button, Card, DataTable, EmptyState, FilterSelect, KeyValue, Modal, PageHeader, SelectField, StatCard, StatusBadge, Tabs, TextArea, TextField, Timeline, addDaysInput, todayInput, type HistoryEvent } from '../common/ui';

export interface AOStats {
  totalIncidentReports: number;
  pendingIncidentReviews: number;
  escalatedCases: number;
  maintenanceWorkOrders: number;
  inProgressWorkOrders: number;
  overdueCases: number;
  overdueWorkOrders: number;
  overdueEscalations: number;
  urgentOpen: number;
}
type ToastFn = (m: string, e?: boolean) => void;
interface PageProps {
  onShowToast: ToastFn;
  onChanged: () => void;
}

interface WorkOrder {
  id: string;
  ticketId: string;
  complaintId: string | null;
  name: string;
  regNumber: string;
  roomNumber: string;
  complaintType: string;
  issueDescription: string;
  location: string;
  status: 'Pending' | 'Assigned' | 'In Progress' | 'Pending Verification' | 'Completed' | 'Cancelled';
  submittedDateTime: string;
  priority: 'High' | 'Medium' | 'Low';
  assignedTechnician?: string;
  technicianContact?: string;
  remarks?: string;
  completedDateTime?: string;
  targetCompletionDate?: string;
  targetDate: string | null;
  isOverdue: boolean;
  createdBy: string;
  history?: HistoryEvent[];
}
interface Escalation {
  id: string;
  ticketId: string;
  sourceType: string;
  caseTitle: string;
  category: string;
  studentName: string;
  regNumber: string;
  roomNumber: string;
  location: string;
  escalatedDate: string;
  urgency: string;
  priority: 'Medium' | 'High' | 'Critical';
  status: 'Escalated' | 'In Review' | 'Forwarded to Principal' | 'Resolved';
  escalationReason: string;
  description: string;
  authorityRef: string;
  assignedTo: string;
  timeline: { stage: string; date: string; status: string; badge?: string; actor?: string; note?: string }[];
  resolutionNotes?: string;
  isOverdue: boolean;
}
type Incident = IncidentReport & { incidentAt: string; reporterRole: string; escalationId?: string; history?: HistoryEvent[] };

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export const AODashboardPage: React.FC<{ dash: { data: { stats: AOStats; activities: any[] } | null; loading: boolean; error: string | null; reload: () => void }; onNavigate: (t: AOTab) => void }> = ({ dash, onNavigate }) => {
  const incidents = useResource(() => http.get<Incident[]>('/incidents'));
  const escalations = useResource(() => http.get<Escalation[]>('/ao/escalations'));
  const workOrders = useResource(() => http.get<WorkOrder[]>('/ao/work-orders'));
  const urgent = [
    ...(workOrders.data ?? []).filter((w) => w.isOverdue).map((w) => ({ id: w.id, kind: 'Overdue work order', title: `${w.id} · ${w.complaintType}`, sub: `${w.location} · target ${w.targetCompletionDate}`, tab: 'maintenance' as AOTab })),
    ...(escalations.data ?? []).filter((e) => e.status !== 'Resolved' && (e.isOverdue || e.priority === 'Critical')).map((e) => ({ id: e.id, kind: e.isOverdue ? 'Escalation past SLA' : 'Critical escalation', title: `${e.id} · ${e.caseTitle}`, sub: `Escalated ${e.escalatedDate}`, tab: 'escalated-cases' as AOTab })),
    ...(incidents.data ?? []).filter((i) => i.status === 'Pending Review' && (i.severity === 'High' || i.severity === 'Critical')).map((i) => ({ id: i.id, kind: `${i.severity} incident`, title: `${i.id} · ${i.incidentCategory}`, sub: `${i.studentName} · ${i.incidentDate}`, tab: 'incident-reports' as AOTab })),
  ];
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader title="AO Dashboard" subtitle="Warden incidents, escalated cases and maintenance work orders — all counts from live records." icon="dashboard" />
      <AsyncContent {...dash} onRetry={dash.reload}>
        {(d) => (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard label="Incident reports" value={d.stats.totalIncidentReports} icon="shield" onClick={() => onNavigate('incident-reports')} />
            <StatCard label="Pending reviews" value={d.stats.pendingIncidentReviews} icon="pending_actions" tone="amber" onClick={() => onNavigate('incident-reports')} />
            <StatCard label="Escalated cases" value={d.stats.escalatedCases} icon="warning" tone="red" hint="Open escalations" onClick={() => onNavigate('escalated-cases')} />
            <StatCard label="Open work orders" value={d.stats.maintenanceWorkOrders} icon="build" onClick={() => onNavigate('maintenance')} />
            <StatCard label="In progress" value={d.stats.inProgressWorkOrders} icon="engineering" tone="violet" onClick={() => onNavigate('maintenance')} />
            <StatCard label="Overdue cases" value={d.stats.overdueCases} icon="alarm" tone="red" hint={`${d.stats.overdueWorkOrders} work orders · ${d.stats.overdueEscalations} escalations`} />
          </div>
        )}
      </AsyncContent>
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Urgent & overdue">
          {urgent.length === 0 ? (
            <EmptyState icon="task_alt" title="Nothing urgent right now" />
          ) : (
            <ul className="divide-y divide-[var(--kv-border-soft)]">
              {urgent.slice(0, 10).map((u) => (
                <li key={`${u.kind}-${u.id}`}>
                  <button type="button" onClick={() => onNavigate(u.tab)} className="w-full text-left py-2.5 px-2 hover:bg-[var(--kv-accent-soft)] rounded-lg">
                    <Badge tone="red">{u.kind}</Badge>
                    <span className="block text-sm font-semibold text-[var(--kv-heading)] mt-1">{u.title}</span>
                    <span className="block text-xs text-[var(--kv-text-muted)]">{u.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent activity">
          {!dash.data?.activities.length ? (
            <EmptyState icon="history" title="No activity yet" />
          ) : (
            <ul className="divide-y divide-[var(--kv-border-soft)]">
              {dash.data.activities.map((a) => (
                <li key={a.id} className="py-2.5 flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="text-sm font-semibold text-[var(--kv-heading)] capitalize">{a.action}</span>
                    <span className="block text-xs text-[var(--kv-text-muted)]">
                      {a.actor} · {a.timestamp}
                      {a.description ? ` — ${a.description}` : ''}
                    </span>
                  </span>
                  {a.statusBadge && <StatusBadge status={a.statusBadge} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent Warden incident reports">
          <AsyncContent {...incidents} onRetry={incidents.reload} isEmpty={(x) => x.length === 0} empty={<EmptyState icon="shield" title="No incidents filed" />}>
            {(list) => (
              <ul className="divide-y divide-[var(--kv-border-soft)]">
                {list.slice(0, 5).map((i) => (
                  <li key={i.id} className="py-2 flex justify-between gap-2 text-sm">
                    <span>
                      <span className="font-semibold">{i.id}</span> · {i.incidentCategory} <span className="text-[var(--kv-text-muted)]">· {i.studentName}</span>
                    </span>
                    <StatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
            )}
          </AsyncContent>
        </Card>
        <Card title="Maintenance work progress">
          <AsyncContent {...workOrders} onRetry={workOrders.reload} isEmpty={(x) => x.length === 0} empty={<EmptyState icon="build" title="No work orders" />}>
            {(list) => {
              const counts = ['Pending', 'Assigned', 'In Progress', 'Pending Verification', 'Completed'].map((s) => ({ label: s, value: list.filter((w) => w.status === s).length }));
              return <BarList data={counts} ariaLabel="Work orders by status" />;
            }}
          </AsyncContent>
        </Card>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Warden incident reports (AO review)
// ---------------------------------------------------------------------------
export const AOIncidentsPage: React.FC<PageProps> = ({ onShowToast, onChanged }) => {
  const list = useResource(() => http.get<Incident[]>('/incidents'));
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = (list.data ?? []).filter((i) => (status === 'all' || (status === 'open' ? i.status !== 'Resolved' : i.status === status)) && (!severity || i.severity === severity));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Warden Incident Reports" subtitle="Review incidents filed by the Warden office: investigate, escalate (creates an escalated case) or resolve." icon="shield" />
      <div className="mb-3">
        <Tabs
          active={status}
          onChange={setStatus}
          tabs={[
            { id: 'open', label: 'Open', count: (list.data ?? []).filter((i) => i.status !== 'Resolved').length },
            { id: 'Pending Review', label: 'Pending review' },
            { id: 'Under Investigation', label: 'Under investigation' },
            { id: 'Escalated', label: 'Escalated' },
            { id: 'Resolved', label: 'Resolved' },
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
              search={(r) => `${r.id} ${r.studentName} ${r.regNumber} ${r.incidentCategory} ${r.location}`}
              onRowClick={(r) => setOpenId(r.id)}
              emptyTitle="No incidents in this view"
              toolbar={<FilterSelect label="Severity" value={severity} onChange={setSeverity} options={['Low', 'Medium', 'High', 'Critical']} />}
              columns={[
                { key: 'id', label: 'Incident', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
                { key: 'incidentDate', label: 'When', sortValue: (r) => r.incidentAt },
                { key: 'incidentCategory', label: 'Type' },
                { key: 'location', label: 'Location' },
                { key: 'studentName', label: 'Student' },
                { key: 'reportingWarden', label: 'Reported by' },
                { key: 'severity', label: 'Severity', render: (r) => <Badge tone={r.severity === 'Critical' || r.severity === 'High' ? 'red' : r.severity === 'Medium' ? 'amber' : 'slate'}>{r.severity}</Badge> },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {openId && (
        <AOIncidentModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            list.reload();
            onChanged();
          }}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};

const AOIncidentModal: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: ToastFn }> = ({ id, onClose, onChanged, onShowToast }) => {
  const d = useResource(() => http.get<Incident>(`/incidents/${id}`), [id]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const review = async (status?: string) => {
    if (!note.trim()) return setError(status === 'Escalated' ? 'Give the escalation reason.' : status === 'Resolved' ? 'Record how it was resolved.' : 'Write a directive or note.');
    const r = await run(() => http.post(`/incidents/${id}/review`, { status, note: note.trim() }));
    if (r) {
      setNote('');
      d.reload();
      onChanged();
    }
  };
  return (
    <Modal open size="lg" title={d.data ? `Incident ${d.data.id}` : 'Incident'} description={d.data ? `${d.data.incidentCategory} · ${d.data.incidentDate}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(i) => (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={i.status} />
              <Badge tone={i.severity === 'Critical' || i.severity === 'High' ? 'red' : 'amber'}>{i.severity} severity</Badge>
              {i.escalationId && <Badge tone="red">Escalated case {i.escalationId}</Badge>}
            </div>
            <KeyValue
              items={[
                ['Student', `${i.studentName} (${i.regNumber})`],
                ['Department / room', `${i.department} · ${i.roomNumber}`],
                ['Location', i.location],
                ['Reported by', `${i.reportingWarden} (${i.reporterRole}), ${i.submittedDate}`],
                ['Witnesses', i.witnesses?.join(', ') || '—'],
                ['Follow-up required', i.followUpRequired || '—'],
              ]}
            />
            <p className="text-sm bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 whitespace-pre-wrap">{i.description}</p>
            {i.actionTakenSoFar && (
              <p className="text-sm">
                <strong>Warden action:</strong> {i.actionTakenSoFar}
              </p>
            )}
            {i.status !== 'Resolved' && (
              <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                <TextArea label="AO directive / note" required rows={3} value={note} error={error} onChange={(e) => (setNote(e.target.value), setError(null))} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={pending} onClick={() => review()}>
                    Add note
                  </Button>
                  {i.status === 'Pending Review' && (
                    <Button size="sm" variant="secondary" icon="search" loading={pending} onClick={() => review('Under Investigation')}>
                      Start investigation
                    </Button>
                  )}
                  {i.status !== 'Escalated' && (
                    <Button size="sm" variant="danger" icon="priority_high" loading={pending} onClick={() => review('Escalated')}>
                      Escalate
                    </Button>
                  )}
                  <Button size="sm" variant="success" icon="task_alt" loading={pending} onClick={() => review('Resolved')}>
                    Resolve
                  </Button>
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
              <Timeline events={i.history} />
            </div>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Escalated cases
// ---------------------------------------------------------------------------
/**
 * Escalated Cases carries three queues, and nothing else reaches the AO:
 *   - incidents and work orders escalated to this office (the original list);
 *   - complaints whose category routes here (complaints about the Warden);
 *   - complaints that passed their saved resolution deadline.
 * Ordinary complaints stay with the Warden and never appear in any of them.
 */
export const AOEscalationsPage: React.FC<PageProps> = ({ onShowToast, onChanged }) => {
  const list = useResource(() => http.get<Escalation[]>('/ao/escalations'));
  const complaints = useResource(() => http.get<Complaint[]>('/ao/complaints'));
  const [queue, setQueue] = useState<'cases' | 'warden' | 'overdue'>('cases');
  const [status, setStatus] = useState('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = (list.data ?? []).filter((e) => status === 'all' || (status === 'open' ? e.status !== 'Resolved' : e.status === status));
  const allComplaints = complaints.data ?? [];
  const wardenComplaints = allComplaints.filter((c) => c.escalationReasons?.includes('Complaint About Warden'));
  const overdueComplaints = allComplaints.filter((c) => c.escalationReasons?.includes('Deadline Exceeded'));

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Escalated Cases" subtitle="Incidents and work orders escalated to the AO office, plus the only two kinds of student complaint that reach this desk." icon="warning" />
      <div className="mb-3">
        <Tabs
          active={queue}
          onChange={(q) => setQueue(q as typeof queue)}
          tabs={[
            { id: 'cases', label: 'Incidents & work orders', count: (list.data ?? []).filter((e) => e.status !== 'Resolved').length },
            { id: 'warden', label: 'Complaints about the Warden', count: wardenComplaints.filter((c) => c.status !== 'Closed').length },
            { id: 'overdue', label: 'Complaints past deadline', count: overdueComplaints.filter((c) => c.status !== 'Closed').length },
          ]}
        />
      </div>
      {queue !== 'cases' ? (
        <AOComplaintQueue
          resource={complaints}
          rows={queue === 'warden' ? wardenComplaints : overdueComplaints}
          emptyTitle={queue === 'warden' ? 'No complaints about the Warden' : 'No complaint has missed its deadline'}
          note={
            queue === 'warden'
              ? 'Routed here by category. The Warden who is the subject can neither see nor change these complaints.'
              : 'Escalated automatically by the server when the saved deadline passed without a resolution. The original complaint id and history are preserved.'
          }
          onShowToast={onShowToast}
          onChanged={onChanged}
        />
      ) : (
        <>
      <div className="mb-3">
        <Tabs
          active={status}
          onChange={setStatus}
          tabs={[
            { id: 'open', label: 'Open', count: (list.data ?? []).filter((e) => e.status !== 'Resolved').length },
            { id: 'Escalated', label: 'New' },
            { id: 'In Review', label: 'In review' },
            { id: 'Forwarded to Principal', label: 'With Principal' },
            { id: 'Resolved', label: 'Resolved' },
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
              search={(r) => `${r.id} ${r.ticketId} ${r.caseTitle} ${r.studentName}`}
              onRowClick={(r) => setOpenId(r.id)}
              emptyTitle="No escalated cases in this view"
              columns={[
                { key: 'id', label: 'Case', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
                { key: 'caseTitle', label: 'Title', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.caseTitle}</span> },
                { key: 'category', label: 'Category' },
                { key: 'ticketId', label: 'Source', render: (r) => `${r.sourceType} ${r.ticketId}` },
                { key: 'escalatedDate', label: 'Escalated' },
                { key: 'priority', label: 'Priority', render: (r) => <Badge tone={r.priority === 'Critical' ? 'red' : r.priority === 'High' ? 'amber' : 'slate'}>{r.priority}</Badge> },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.isOverdue} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {openId && (
        <EscalationModal
          esc={(list.data ?? []).find((e) => e.id === openId)!}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            list.reload();
            onChanged();
          }}
          onShowToast={onShowToast}
        />
      )}
        </>
      )}
    </div>
  );
};

const priorityTone = (p: string | undefined) => (p === 'Critical' || p === 'High' ? 'red' : p === 'Medium' ? 'amber' : 'slate');

const AOComplaintQueue: React.FC<{
  resource: { data: Complaint[] | null; loading: boolean; error: string | null; reload: () => void };
  rows: Complaint[];
  emptyTitle: string;
  note: string;
  onShowToast: ToastFn;
  onChanged: () => void;
}> = ({ resource, rows, emptyTitle, note, onShowToast, onChanged }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <p className="mb-3 rounded-lg border border-[var(--kv-border)] bg-[var(--kv-surface-alt)] px-4 py-2.5 text-xs text-[var(--kv-heading)]">{note}</p>
      <Card>
        <AsyncContent {...resource} onRetry={resource.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.id} ${r.studentName ?? ''} ${r.title ?? ''} ${r.category}`}
              onRowClick={(r) => setOpenId(r.id)}
              emptyTitle={emptyTitle}
              columns={[
                { key: 'id', label: 'Complaint', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
                { key: 'title', label: 'Issue', render: (r) => <span className="font-semibold text-[var(--kv-heading)] line-clamp-2 max-w-[260px]">{r.title ?? r.description}</span> },
                { key: 'category', label: 'Category' },
                { key: 'studentName', label: 'Student', render: (r) => `${r.studentName} · ${r.roomNumber}` },
                { key: 'priority', label: 'Priority', render: (r) => <Badge tone={priorityTone(r.priority)}>{r.priority}</Badge> },
                {
                  key: 'deadlineAt',
                  label: 'Target / deadline',
                  sortValue: (r) => r.deadlineAt ?? '',
                  render: (r) => (
                    <span className="block whitespace-nowrap text-xs">
                      <span className="block">{r.resolutionTarget}</span>
                      <span className={`block ${r.isOverdue ? 'text-rose-600 font-semibold' : 'text-[var(--kv-text-muted)]'}`}>{r.timeRemainingLabel}</span>
                    </span>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => (
                    <div className="space-y-1">
                      <StatusBadge status={r.status} overdue={r.isOverdue} />
                      <div className="text-[11px] text-[var(--kv-text-muted)]">{(r.escalationReasons ?? []).join(' + ')}</div>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {openId && (
        <AOComplaintModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            resource.reload();
            onChanged();
          }}
          onShowToast={onShowToast}
        />
      )}
    </>
  );
};

const AOComplaintModal: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: ToastFn }> = ({ id, onClose, onChanged, onShowToast }) => {
  const detail = useResource(() => http.get<Complaint>(`/ao/complaints/${id}`), [id]);
  const { run, pending } = useAction(onShowToast);
  const [notes, setNotes] = useState('');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const c = detail.data;

  const review = async (escalationId: string, status: 'Under Review' | 'Action Recorded' | 'Closed') => {
    if (notes.trim().length < 5) return setNotesError('Write what you reviewed or decided (at least 5 characters).');
    const r = await run(() => http.post(`/ao/complaints/${id}/escalations/${escalationId}/review`, { status, notes: notes.trim() }));
    if (r) {
      setNotes('');
      detail.reload();
      onChanged();
    }
  };

  const setStatus = async (status: 'In Progress' | 'Resolved' | 'Closed') => {
    if (status === 'Resolved' && resolution.trim().length < 5) return setResolutionError('Record what was done before resolving.');
    const r = await run(() => http.patch(`/ao/complaints/${id}`, { status, resolutionNotes: status === 'Resolved' ? resolution.trim() : undefined }));
    if (r) {
      setResolution('');
      detail.reload();
      onChanged();
    }
  };

  return (
    <Modal open size="lg" title={c ? `Complaint ${c.id}` : 'Complaint'} description={c ? `${c.studentName} · ${c.regNumber} · Room ${c.roomNumber}` : undefined} onClose={onClose}>
      <AsyncContent {...detail} onRetry={detail.reload}>
        {(r) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={r.status} overdue={r.isOverdue} />
              <Badge tone={priorityTone(r.priority)}>{r.priority} priority</Badge>
              <Badge tone={r.isOverdue ? 'red' : 'slate'}>
                {r.resolutionTarget} · {r.timeRemainingLabel}
              </Badge>
            </div>
            <KeyValue
              items={[
                ['Title', r.title ?? '—'],
                ['Category', r.category],
                ['Location', r.location ?? '—'],
                ['Submitted', r.submittedDateTime ?? '—'],
                ['Deadline', r.deadlineDisplay ?? '—'],
                ['Escalation reason(s)', (r.escalationReasons ?? []).join(' + ') || '—'],
                ['Worker', r.workerName ? `${r.workerName}${r.workerPhone ? ` · ${r.workerPhone}` : ''}` : 'Not assigned'],
                ['Resolution', r.resolutionNotes ?? '—'],
              ]}
            />
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Issue description</span>
              <p className="text-sm text-[var(--kv-heading)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 mt-1 whitespace-pre-wrap">{r.description}</p>
            </div>

            <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Review actions</h3>
              <TextArea
                label="Review notes"
                rows={2}
                value={notes}
                error={notesError}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesError(null);
                }}
                hint="Recorded against the escalation and shown to the student."
              />
              {(r.escalations ?? []).map((e: ComplaintEscalation) => (
                <div key={e.id} className="rounded-lg border border-[var(--kv-border-soft)] p-3 space-y-2">
                  <p className="text-xs font-semibold text-[var(--kv-heading)]">
                    {e.reason} · {e.status} · raised {e.createdAtDisplay}
                  </p>
                  {e.notes && (
                    <p className="text-xs text-[var(--kv-text-muted)]">
                      {e.notes}
                      {e.reviewedBy ? ` — ${e.reviewedBy}, ${e.reviewedAt}` : ''}
                    </p>
                  )}
                  {e.status !== 'Closed' && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" loading={pending} onClick={() => review(e.id, 'Under Review')}>
                        Mark under review
                      </Button>
                      <Button size="sm" variant="secondary" loading={pending} onClick={() => review(e.id, 'Action Recorded')}>
                        Record action
                      </Button>
                      <Button size="sm" variant="danger" loading={pending} onClick={() => review(e.id, 'Closed')}>
                        Close escalation
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {r.status !== 'Closed' && (
              <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Complaint status</h3>
                <TextArea
                  label="Resolution details"
                  rows={2}
                  value={resolution}
                  error={resolutionError}
                  onChange={(e) => {
                    setResolution(e.target.value);
                    setResolutionError(null);
                  }}
                  hint="Required to resolve. The escalation history is kept either way."
                />
                <div className="flex flex-wrap gap-2">
                  {r.status !== 'Resolved' && (
                    <Button size="sm" variant="secondary" icon="engineering" loading={pending} onClick={() => setStatus('In Progress')}>
                      Mark in progress
                    </Button>
                  )}
                  <Button size="sm" variant="success" icon="task_alt" loading={pending} onClick={() => setStatus('Resolved')}>
                    Resolve complaint
                  </Button>
                  {r.status === 'Resolved' && (
                    <Button size="sm" variant="secondary" icon="lock" loading={pending} onClick={() => setStatus('Closed')}>
                      Close complaint
                    </Button>
                  )}
                </div>
              </div>
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

const EscalationModal: React.FC<{ esc: Escalation; onClose: () => void; onChanged: () => void; onShowToast: ToastFn }> = ({ esc, onClose, onChanged, onShowToast }) => {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const act = async (action: 'review' | 'forward' | 'resolve' | 'note') => {
    if (action !== 'review' && note.trim().length < (action === 'note' ? 1 : 5)) return setError('Write a note (at least 5 characters).');
    const r = await run(() => http.post(`/ao/escalations/${esc.id}/${action}`, { note: note.trim() || undefined }));
    if (r) {
      setNote('');
      onChanged();
      if (action === 'resolve') onClose();
    }
  };
  return (
    <Modal open size="lg" title={`${esc.id}: ${esc.caseTitle}`} description={`${esc.category} · escalated ${esc.escalatedDate}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={esc.status} overdue={esc.isOverdue} />
          <Badge tone={esc.priority === 'Critical' ? 'red' : 'amber'}>{esc.priority}</Badge>
          <span className="text-xs text-[var(--kv-text-muted)]">Target response {esc.urgency}</span>
        </div>
        <KeyValue
          items={[
            ['Source', `${esc.sourceType} ${esc.ticketId}`],
            ['Student / room', `${esc.studentName} · ${esc.roomNumber}`],
            ['Location', esc.location],
            ['Reference', esc.authorityRef],
            ['Currently with', esc.assignedTo],
            ['Resolution', esc.resolutionNotes ?? '—'],
          ]}
        />
        <div className="text-sm space-y-2">
          <p>
            <strong>Escalation reason:</strong> {esc.escalationReason}
          </p>
          <p className="bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 whitespace-pre-wrap">{esc.description}</p>
        </div>
        {esc.status !== 'Resolved' && (
          <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
            <TextArea label="Note / directive" rows={3} value={note} error={error} onChange={(e) => (setNote(e.target.value), setError(null))} />
            <div className="flex flex-wrap gap-2">
              {esc.status === 'Escalated' && (
                <Button size="sm" variant="secondary" loading={pending} onClick={() => act('review')}>
                  Start review
                </Button>
              )}
              <Button size="sm" variant="secondary" loading={pending} onClick={() => act('note')}>
                Add note
              </Button>
              {esc.status !== 'Forwarded to Principal' && (
                <Button size="sm" variant="danger" icon="forward" loading={pending} onClick={() => act('forward')}>
                  Forward to Principal
                </Button>
              )}
              <Button size="sm" variant="success" icon="task_alt" loading={pending} onClick={() => act('resolve')}>
                Resolve case
              </Button>
            </div>
            <p className="text-[11px] text-[var(--kv-text-muted)]">Forwarding records the case as with the Principal office and notifies any Principal accounts in-app. No email or SMS is sent.</p>
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">Timeline</h3>
          <ol className="space-y-2">
            {esc.timeline.map((t, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <StatusBadge status={t.status === 'completed' ? 'Done' : t.status === 'current' ? 'In progress' : 'Pending'} />
                <span>
                  <span className="font-semibold capitalize">{t.stage}</span> <span className="text-[var(--kv-text-muted)]">· {t.date}</span>
                  {t.actor && <span className="block text-xs text-[var(--kv-text-muted)]">{t.actor}</span>}
                  {t.note && <span className="block text-xs text-[var(--kv-heading)]">{t.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Maintenance & work orders
// ---------------------------------------------------------------------------
const NEXT: Record<WorkOrder['status'], WorkOrder['status'][]> = {
  Pending: ['Cancelled'],
  Assigned: ['In Progress', 'Cancelled'],
  'In Progress': ['Pending Verification', 'Completed', 'Cancelled'],
  'Pending Verification': ['Completed', 'In Progress'],
  Completed: [],
  Cancelled: [],
};
const CATEGORIES = ['Electrical', 'Plumbing', 'Carpentry', 'Wi-Fi / LAN', 'Housekeeping', 'Civil / Masonry', 'Mess / Food', 'Room Issue', 'General Maintenance', 'Other'];

export const AOMaintenancePage: React.FC<PageProps> = ({ onShowToast, onChanged }) => {
  const list = useResource(() => http.get<WorkOrder[]>('/ao/work-orders'));
  const [view, setView] = useState('open');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [techs, setTechs] = useState(false);
  const all = list.data ?? [];
  const rows = all.filter(
    (w) =>
      (view === 'all' || (view === 'open' ? !['Completed', 'Cancelled'].includes(w.status) : view === 'overdue' ? w.isOverdue : w.status === view)) && (!category || w.complaintType === category) && (!priority || w.priority === priority),
  );
  const reload = () => {
    list.reload();
    onChanged();
  };
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Maintenance & Work Orders"
        subtitle="Work orders raised by the Warden from student complaints, or by the AO directly. Kept separate from incident reports."
        icon="build"
        actions={
          <>
            <Button variant="secondary" icon="engineering" onClick={() => setTechs(true)}>
              Maintenance staff
            </Button>
            <Button
              variant="secondary"
              icon="download"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  `work-orders-${todayInput()}.csv`,
                  [
                    { label: 'Work order', value: (w: WorkOrder) => w.id },
                    { label: 'Complaint', value: (w) => w.complaintId ?? '' },
                    { label: 'Category', value: (w) => w.complaintType },
                    { label: 'Location', value: (w) => w.location },
                    { label: 'Priority', value: (w) => w.priority },
                    { label: 'Status', value: (w) => w.status },
                    { label: 'Overdue', value: (w) => (w.isOverdue ? 'Yes' : 'No') },
                    { label: 'Technician', value: (w) => w.assignedTechnician ?? '' },
                    { label: 'Target', value: (w) => w.targetCompletionDate ?? '' },
                    { label: 'Created', value: (w) => w.submittedDateTime },
                    { label: 'Completed', value: (w) => w.completedDateTime ?? '' },
                  ],
                  rows,
                )
              }
            >
              Export CSV
            </Button>
            <Button icon="add" onClick={() => setCreating(true)}>
              New work order
            </Button>
          </>
        }
      />
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'open', label: 'Open', count: all.filter((w) => !['Completed', 'Cancelled'].includes(w.status)).length },
            { id: 'overdue', label: 'Overdue', count: all.filter((w) => w.isOverdue).length },
            { id: 'Pending Verification', label: 'Pending verification' },
            { id: 'Completed', label: 'Completed' },
            { id: 'all', label: 'All' },
          ]}
        />
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(w) => w.id}
              search={(w) => `${w.id} ${w.complaintId ?? ''} ${w.location} ${w.issueDescription} ${w.assignedTechnician ?? ''}`}
              onRowClick={(w) => setOpenId(w.id)}
              emptyTitle="No work orders in this view"
              toolbar={
                <>
                  <FilterSelect label="Category" value={category} onChange={setCategory} options={CATEGORIES} />
                  <FilterSelect label="Priority" value={priority} onChange={setPriority} options={['High', 'Medium', 'Low']} />
                </>
              }
              columns={[
                { key: 'id', label: 'Work order', render: (w) => <span className="font-mono text-xs">{w.id}</span> },
                { key: 'complaintType', label: 'Category' },
                { key: 'issueDescription', label: 'Issue', render: (w) => <span className="line-clamp-2 max-w-[260px]">{w.issueDescription}</span> },
                { key: 'location', label: 'Location' },
                { key: 'priority', label: 'Priority', render: (w) => <Badge tone={w.priority === 'High' ? 'red' : w.priority === 'Medium' ? 'amber' : 'slate'}>{w.priority}</Badge> },
                { key: 'assignedTechnician', label: 'Technician', render: (w) => w.assignedTechnician ?? '—' },
                { key: 'targetDate', label: 'Target', sortValue: (w) => w.targetDate, render: (w) => w.targetCompletionDate ?? '—' },
                { key: 'status', label: 'Status', render: (w) => <StatusBadge status={w.status} overdue={w.isOverdue} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {openId && <WorkOrderModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} onShowToast={onShowToast} />}
      {creating && (
        <NewWorkOrder
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      {techs && <TechniciansModal onClose={() => setTechs(false)} onShowToast={onShowToast} />}
    </div>
  );
};

const WorkOrderModal: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: ToastFn }> = ({ id, onClose, onChanged, onShowToast }) => {
  const d = useResource(() => http.get<WorkOrder>(`/ao/work-orders/${id}`), [id]);
  const techs = useResource(() => http.get<{ id: string; name: string; role: string; contact: string; category: string }[]>('/ao/technicians'));
  const [tech, setTech] = useState('');
  const [contact, setContact] = useState('');
  const [target, setTarget] = useState('');
  const [remarks, setRemarks] = useState('');
  const [next, setNext] = useState('');
  const { run, pending } = useAction(onShowToast);
  const w = d.data;
  const after = (r: unknown) => {
    if (r) {
      d.reload();
      onChanged();
      setRemarks('');
      setNext('');
    }
  };
  return (
    <Modal open size="lg" title={w ? `Work order ${w.id}` : 'Work order'} description={w ? `${w.complaintType} · ${w.location}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(x) => (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={x.status} overdue={x.isOverdue} />
              <Badge tone={x.priority === 'High' ? 'red' : 'amber'}>{x.priority} priority</Badge>
            </div>
            <KeyValue
              items={[
                ['Raised from', x.complaintId ? `Complaint ${x.complaintId} (${x.name}, room ${x.roomNumber})` : `AO office (${x.createdBy})`],
                ['Created', x.submittedDateTime],
                ['Technician', x.assignedTechnician ? `${x.assignedTechnician}${x.technicianContact ? ` · ${x.technicianContact}` : ''}` : 'Not assigned'],
                ['Target date', x.targetCompletionDate ?? '—'],
                ['Completed', x.completedDateTime ?? '—'],
                ['Remarks', x.remarks ?? '—'],
              ]}
            />
            <p className="text-sm bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 whitespace-pre-wrap">{x.issueDescription}</p>
            {!['Completed', 'Cancelled'].includes(x.status) && (
              <>
                <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--kv-heading)]">{x.assignedTechnician ? 'Reassign technician' : 'Assign technician'}</h3>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <SelectField
                      label="Technician"
                      value={tech}
                      placeholder="Choose…"
                      onChange={(e) => {
                        setTech(e.target.value);
                        setContact(techs.data?.find((t) => `${t.name} (${t.role})` === e.target.value)?.contact ?? '');
                      }}
                      options={(techs.data ?? []).map((t) => ({ value: `${t.name} (${t.role})`, label: `${t.name} — ${t.category}` }))}
                    />
                    <TextField label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
                    <TextField label="Target date" type="date" min={todayInput()} value={target} onChange={(e) => setTarget(e.target.value)} />
                  </div>
                  <Button size="sm" icon="person_add" loading={pending} disabled={!tech} onClick={async () => after(await run(() => http.post(`/ao/work-orders/${id}/assign`, { technicianName: tech, technicianContact: contact || undefined, targetDate: target || undefined, remarks: remarks || undefined })))}>
                    Assign
                  </Button>
                </div>
                {NEXT[x.status].length > 0 && (
                  <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Update status</h3>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <SelectField label="New status" value={next} placeholder="Choose…" onChange={(e) => setNext(e.target.value)} options={NEXT[x.status]} />
                      <TextArea label="Remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} hint="Required to complete or cancel." />
                    </div>
                    <Button size="sm" loading={pending} disabled={!next} onClick={async () => after(await run(() => http.post(`/ao/work-orders/${id}/status`, { status: next, remarks: remarks.trim() || undefined })))}>
                      Save status
                    </Button>
                    {x.complaintId && <p className="text-[11px] text-[var(--kv-text-muted)]">“Pending Verification” asks the Warden to verify with the student; “Completed” resolves complaint {x.complaintId} and notifies the student.</p>}
                  </div>
                )}
              </>
            )}
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
              <Timeline events={x.history} />
            </div>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

const NewWorkOrder: React.FC<{ onClose: () => void; onSaved: () => void; onShowToast: ToastFn }> = ({ onClose, onSaved, onShowToast }) => {
  const [f, setF] = useState({ category: 'Electrical', description: '', location: '', priority: 'Medium', targetDate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useAction(onShowToast);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open
      title="New work order"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const errs: Record<string, string> = {};
              if (f.description.trim().length < 10) errs.description = 'Describe the work (at least 10 characters).';
              if (!f.location.trim()) errs.location = 'Location is required.';
              setErrors(errs);
              if (Object.keys(errs).length) return;
              const r = await run(() => http.post('/ao/work-orders', { ...f, description: f.description.trim(), location: f.location.trim(), targetDate: f.targetDate || undefined }));
              if (r) onSaved();
            }}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <SelectField label="Category" value={f.category} onChange={set('category')} options={CATEGORIES} />
        <SelectField label="Priority" value={f.priority} onChange={set('priority')} options={['High', 'Medium', 'Low']} />
        <TextField label="Location" required value={f.location} onChange={set('location')} error={errors.location} />
        <TextField label="Target date" type="date" min={todayInput()} value={f.targetDate} onChange={set('targetDate')} />
        <div className="sm:col-span-2">
          <TextArea label="Description" required rows={3} value={f.description} onChange={set('description')} error={errors.description} />
        </div>
      </div>
    </Modal>
  );
};

const TechniciansModal: React.FC<{ onClose: () => void; onShowToast: ToastFn }> = ({ onClose, onShowToast }) => {
  const list = useResource(() => http.get<{ id: string; name: string; role: string; contact: string; category: string }[]>('/ao/technicians'));
  const [f, setF] = useState({ name: '', role: '', contact: '', category: 'Electrical' });
  const { run, pending } = useAction(onShowToast);
  return (
    <Modal open size="lg" title="Maintenance staff" description="Technicians available for work-order assignment." onClose={onClose}>
      <div className="space-y-4">
        <AsyncContent {...list} onRetry={list.reload}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(t) => t.id}
              emptyTitle="No technicians yet"
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'role', label: 'Role' },
                { key: 'category', label: 'Trade' },
                { key: 'contact', label: 'Contact' },
              ]}
            />
          )}
        </AsyncContent>
        <div className="grid sm:grid-cols-4 gap-2 items-end border-t border-[var(--kv-border-soft)] pt-3">
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="e.g. Electrician" />
          <TextField label="Contact" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
          <SelectField label="Trade" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={CATEGORIES} />
        </div>
        <Button
          size="sm"
          icon="person_add"
          loading={pending}
          disabled={!f.name.trim() || !f.role.trim()}
          onClick={async () => {
            const r = await run(() => http.post('/ao/technicians', { ...f, contact: f.contact || undefined }));
            if (r) {
              setF({ name: '', role: '', contact: '', category: f.category });
              list.reload();
            }
          }}
        >
          Add technician
        </Button>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Reports & analytics
// ---------------------------------------------------------------------------
interface AOReport {
  from: string;
  to: string;
  workOrders: { created: number; completed: number; completedOnTime: number; averageResolutionHours: number | null; byCategory: { key: string; count: number }[]; byStatus: { key: string; count: number }[] };
  incidents: { reported: number; byCategory: { key: string; count: number }[]; bySeverity: { key: string; count: number }[]; byStatus: { key: string; count: number }[] };
  escalations: { raised: number; resolved: number; byStatus: { key: string; count: number }[] };
}

export const AOReportsPage: React.FC = () => {
  const [from, setFrom] = useState(addDaysInput(-29));
  const [to, setTo] = useState(todayInput());
  const r = useResource(() => http.get<AOReport>(`/ao/reports${qs({ from, to })}`), [from, to]);
  const toBars = (rows: { key: string; count: number }[]) => rows.map((x) => ({ label: x.key, value: x.count }));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Reports & Analytics" subtitle="Computed from work orders, incident reports and escalations for the selected period." icon="bar_chart" actions={<Button variant="secondary" icon="print" onClick={() => window.print()}>Print</Button>} />
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
      <AsyncContent {...r} onRetry={r.reload}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatCard label="Work orders created" value={d.workOrders.created} />
              <StatCard label="Completed" value={d.workOrders.completed} tone="green" hint={`${d.workOrders.completedOnTime} on or before target`} />
              <StatCard label="Avg. resolution" value={d.workOrders.averageResolutionHours === null ? '—' : `${d.workOrders.averageResolutionHours} h`} tone="violet" />
              <StatCard label="Incidents reported" value={d.incidents.reported} tone="amber" />
              <StatCard label="Escalations" value={d.escalations.raised} tone="red" hint={`${d.escalations.resolved} resolved in period`} />
            </div>
            <div className="grid lg:grid-cols-2 gap-5">
              <Card title="Work orders by category (period)">
                <BarList data={toBars(d.workOrders.byCategory)} emptyMessage="No work orders created in this period." />
              </Card>
              <Card title="Work orders by current status">
                <BarList data={toBars(d.workOrders.byStatus)} emptyMessage="No work orders." />
              </Card>
              <Card title="Incidents by category (period)">
                <BarList data={toBars(d.incidents.byCategory)} emptyMessage="No incidents in this period." />
              </Card>
              <Card title="Incidents by severity (period)">
                <BarList data={toBars(d.incidents.bySeverity)} emptyMessage="No incidents in this period." />
              </Card>
              <Card title="Escalations by current status" className="lg:col-span-2">
                <BarList data={toBars(d.escalations.byStatus)} emptyMessage="No escalations." />
              </Card>
            </div>
          </div>
        )}
      </AsyncContent>
    </div>
  );
};

