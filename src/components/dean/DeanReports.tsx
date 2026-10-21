import React, { useState } from 'react';
import { ApiError, downloadFile, errorMessage, http, qs } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { Attachments } from '../common/Attachments';
import { ReportView, type GeneratedReport } from '../common/ReportView';
import { AsyncContent, Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, KeyValue, Modal, PageHeader, SelectField, StatCard, StatusBadge, Tabs, TextArea, TextField, Timeline, addDaysInput, fromLocalInput, toLocalInput, todayInput, type HistoryEvent } from '../common/ui';
import { RecipientSelector, emptySelector, type ResolvedRecipient, type Selector } from './RecipientSelector';

type Toast = (m: string, e?: boolean) => void;
const CATEGORIES = ['Department Academic Report', 'Study Session Report', 'Attendance & Absence Report', 'Student Support Report', 'Task Progress Report', 'Department Review', 'Circular / Information', 'Other'];
// Aggregate-only reports that may be attached to a distribution.
const ATTACHABLE = [
  ['department_academic', 'Department academic performance summary'],
  ['study_participation', 'Study-session participation'],
  ['unauthorized_absence', 'Unauthorized absence summary'],
  ['academic_support_followups', 'Academic support follow-up summary'],
  ['hod_task_progress', 'HOD task progress'],
  ['adviser_task_progress', 'Adviser task progress'],
  ['schedule_completion', 'Schedule completion'],
  ['outstanding_assignments', 'Outstanding assignments'],
  ['report_submission_status', 'Report submission status'],
];

interface ReportRequest {
  id: string;
  title: string;
  message: string;
  category: string;
  periodFrom: string | null;
  periodTo: string | null;
  deadlineAt: string | null;
  deadlineDisplay: string | null;
  requiresSubmission: boolean;
  status: 'Draft' | 'Distributed' | 'Closed';
  createdBy: string;
  createdAt: string;
  distributedAt: string | null;
  generatedReport: GeneratedReport | null;
  stats: { total: number; byStatus: Record<string, number>; outstanding: number; accepted: number; overdue: number };
}
interface Response {
  id: string;
  userId: string;
  name: string;
  role: string;
  department: string;
  status: string;
  isOverdue: boolean;
  acknowledgedAt: string | null;
  submittedAt: string | null;
  submissionText: string | null;
  reviewComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  submissionCount: number;
  lastRemindedAt: string | null;
  history: HistoryEvent[];
}
type RequestDetail = ReportRequest & { recipients: Response[]; history: HistoryEvent[] };

export const DeanReportDistribution: React.FC<{ onShowToast: Toast; openId: string | null; onOpen: (id: string | null) => void }> = ({ onShowToast, openId, onOpen }) => {
  const list = useResource(() => http.get<ReportRequest[]>('/work/report-requests'));
  const [view, setView] = useState('Distributed');
  const [creating, setCreating] = useState<ReportRequest | 'new' | null>(null);
  const rows = (list.data ?? []).filter((r) => view === 'all' || r.status === view);
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Report Distribution & Communication"
        subtitle="Send report requests, circulars and generated summaries to HODs and Advisers, then track acknowledgements, submissions and reviews."
        icon="forward_to_inbox"
        actions={
          <Button icon="add" onClick={() => setCreating('new')}>
            New report request
          </Button>
        }
      />
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'Distributed', label: 'Distributed', count: (list.data ?? []).filter((r) => r.status === 'Distributed').length },
            { id: 'Draft', label: 'Drafts' },
            { id: 'Closed', label: 'Closed' },
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
              search={(r) => `${r.id} ${r.title} ${r.category}`}
              onRowClick={(r) => (r.status === 'Draft' ? setCreating(r) : onOpen(r.id))}
              emptyTitle="No report requests"
              columns={[
                { key: 'id', label: 'ID', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
                { key: 'title', label: 'Title', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.title}</span> },
                { key: 'category', label: 'Category' },
                { key: 'deadlineAt', label: 'Deadline', sortValue: (r) => r.deadlineAt, render: (r) => r.deadlineDisplay ?? (r.requiresSubmission ? '—' : 'For information') },
                {
                  key: 'progress',
                  label: 'Responses',
                  render: (r) =>
                    r.status === 'Draft' ? (
                      '—'
                    ) : (
                      <span className="text-xs">
                        {r.stats.accepted}/{r.stats.total} accepted · {r.stats.outstanding} outstanding
                        {(r.stats.byStatus.Submitted ?? 0) + (r.stats.byStatus['Under Review'] ?? 0) > 0 && <Badge tone="blue" className="ml-1">{(r.stats.byStatus.Submitted ?? 0) + (r.stats.byStatus['Under Review'] ?? 0)} to review</Badge>}
                        {r.stats.overdue > 0 && <Badge tone="red" className="ml-1">{r.stats.overdue} overdue</Badge>}
                      </span>
                    ),
                },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {creating && (
        <RequestForm
          draft={creating === 'new' ? null : creating}
          onClose={() => setCreating(null)}
          onSaved={(id, distributed) => {
            setCreating(null);
            list.reload();
            if (distributed) onOpen(id);
          }}
          onShowToast={onShowToast}
        />
      )}
      {openId && <RequestDetailModal id={openId} onClose={() => onOpen(null)} onChanged={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const RequestForm: React.FC<{ draft: ReportRequest | null; onClose: () => void; onSaved: (id: string, distributed: boolean) => void; onShowToast: Toast }> = ({ draft, onClose, onSaved, onShowToast }) => {
  const [f, setF] = useState({
    title: draft?.title ?? '',
    message: draft?.message ?? '',
    category: draft?.category ?? 'Department Academic Report',
    periodFrom: draft?.periodFrom ?? addDaysInput(-29),
    periodTo: draft?.periodTo ?? todayInput(),
    deadlineAt: toLocalInput(draft?.deadlineAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString()),
    requiresSubmission: draft?.requiresSubmission ?? true,
    generatedReportType: '',
  });
  const [selector, setSelector] = useState<Selector>(emptySelector());
  const [resolved, setResolved] = useState<ResolvedRecipient[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<GeneratedReport | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const validate = (needRecipients: boolean) => {
    const errs: Record<string, string> = {};
    if (f.title.trim().length < 3) errs.title = 'Enter a title.';
    if (f.message.trim().length < 5) errs.message = 'Write the message or instructions.';
    if (f.periodFrom && f.periodTo && f.periodTo < f.periodFrom) errs.periodTo = 'End must be on or after the start.';
    if (f.requiresSubmission && !f.deadlineAt) errs.deadlineAt = 'Set a submission deadline.';
    if (f.deadlineAt && new Date(f.deadlineAt) < new Date()) errs.deadlineAt = 'Deadline is in the past.';
    if (needRecipients && !resolved.length) errs.recipients = 'Choose at least one recipient.';
    setErrors(errs);
    return !Object.keys(errs).length;
  };

  const send = async (status: 'Draft' | 'Distributed') => {
    setPending(true);
    try {
      let res;
      if (draft && status === 'Distributed') {
        res = await http.post<ReportRequest>(`/work/report-requests/${draft.id}/distribute`, { recipients: selector, confirmCount: resolved.length });
      } else {
        res = await http.post<ReportRequest>('/work/report-requests', {
          title: f.title.trim(),
          message: f.message.trim(),
          category: f.category,
          periodFrom: f.periodFrom || undefined,
          periodTo: f.periodTo || undefined,
          deadlineAt: f.deadlineAt ? fromLocalInput(f.deadlineAt) : undefined,
          requiresSubmission: f.requiresSubmission,
          generatedReportType: f.generatedReportType || undefined,
          recipients: selector,
          confirmCount: resolved.length,
          status,
        });
      }
      onShowToast(res.message || 'Saved.');
      onSaved(res.data.id, status === 'Distributed');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      onShowToast(errorMessage(err), true);
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <Modal
      open
      size="xl"
      title={draft ? `Distribute draft ${draft.id}` : 'New report request'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {!draft && (
            <Button variant="secondary" icon="save" loading={pending} onClick={() => validate(false) && send('Draft')}>
              Save draft
            </Button>
          )}
          <Button icon="send" loading={pending} onClick={() => validate(true) && setConfirming(true)}>
            Review & distribute
          </Button>
        </>
      }
    >
      <div className="grid md:grid-cols-2 gap-3">
        {draft && <p className="md:col-span-2 text-sm text-[var(--kv-text-muted)]">Draft content is fixed; choose the recipients to distribute it to.</p>}
        <div className="md:col-span-2">
          <TextField label="Title" required value={f.title} disabled={!!draft} onChange={set('title')} error={errors.title} />
        </div>
        <div className="md:col-span-2">
          <TextArea label="Message / instructions" required rows={4} value={f.message} disabled={!!draft} onChange={set('message')} error={errors.message} />
        </div>
        <SelectField label="Category" value={f.category} disabled={!!draft} onChange={set('category')} options={CATEGORIES} />
        <div className="flex items-end pb-2">
          <Checkbox label="Recipients must submit a report" hint="Untick for information-only circulars (acknowledgement only)." checked={f.requiresSubmission} onChange={(v) => !draft && setF({ ...f, requiresSubmission: v })} />
        </div>
        <TextField label="Reporting period from" type="date" value={f.periodFrom} disabled={!!draft} onChange={set('periodFrom')} />
        <TextField label="Reporting period to" type="date" value={f.periodTo} disabled={!!draft} onChange={set('periodTo')} error={errors.periodTo} />
        <TextField label={`Submission deadline${f.requiresSubmission ? ' *' : ''}`} type="datetime-local" value={f.deadlineAt} disabled={!!draft} onChange={set('deadlineAt')} error={errors.deadlineAt} />
        {!draft && (
          <SelectField
            label="Attach a generated summary (optional)"
            value={f.generatedReportType}
            onChange={(e) => (setF({ ...f, generatedReportType: e.target.value }), setPreview(null))}
            placeholder="None"
            options={ATTACHABLE.map(([v, l]) => ({ value: v, label: l }))}
            hint="Aggregate figures only — no individual student records are shared across departments."
          />
        )}
        {!draft && f.generatedReportType && (
          <div className="md:col-span-2">
            <Button
              size="sm"
              variant="secondary"
              icon="visibility"
              onClick={() =>
                http
                  .get<GeneratedReport>(`/dean/reports/${f.generatedReportType}${qs({ from: f.periodFrom, to: f.periodTo })}`)
                  .then(setPreview)
                  .catch((e) => onShowToast(errorMessage(e), true))
              }
            >
              Preview attached summary
            </Button>
            {preview && (
              <div className="mt-3 border border-[var(--kv-border)] rounded-xl p-3">
                <ReportView report={preview} />
              </div>
            )}
          </div>
        )}
        <div className="md:col-span-2">
          <RecipientSelector value={selector} onChange={setSelector} onResolved={setResolved} error={errors.recipients} />
          <p className="text-[11px] text-[var(--kv-text-muted)] mt-1">Supporting files can be attached after distribution (open the request). Delivery is in-app; email/SMS are not configured.</p>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Distribute to ${resolved.length} recipient(s)?`}
        message={
          <ul className="max-h-40 overflow-y-auto text-xs space-y-0.5">
            {resolved.map((r) => (
              <li key={r.id}>
                {r.name} — {r.role}, {r.department}
              </li>
            ))}
          </ul>
        }
        confirmLabel="Distribute now"
        pending={pending}
        onClose={() => setConfirming(false)}
        onConfirm={() => send('Distributed')}
      />
    </Modal>
  );
};

const RequestDetailModal: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: Toast }> = ({ id, onClose, onChanged, onShowToast }) => {
  const d = useResource(() => http.get<RequestDetail>(`/work/report-requests/${id}`), [id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const { run, pending } = useAction(onShowToast);
  const refresh = () => {
    d.reload();
    onChanged();
  };
  const q = d.data;
  const resp = q?.recipients.find((r) => r.id === selected) ?? null;
  return (
    <Modal
      open
      size="xl"
      title={q ? `${q.id}: ${q.title}` : 'Report request'}
      description={q ? `${q.category} · created ${q.createdAt}${q.deadlineDisplay ? ` · due ${q.deadlineDisplay}` : ''}` : undefined}
      onClose={onClose}
      footer={
        q?.status === 'Distributed' ? (
          <>
            <Button variant="secondary" icon="notifications_active" loading={pending} disabled={!q.stats.outstanding} onClick={async () => (await run(() => http.post(`/work/report-requests/${id}/remind`))) && refresh()}>
              Remind outstanding ({q.stats.outstanding})
            </Button>
            <Button variant="secondary" icon="lock" onClick={() => setClosing(true)}>
              Close request
            </Button>
          </>
        ) : undefined
      }
    >
      <AsyncContent {...d} onRetry={d.reload}>
        {(x) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <StatCard label="Recipients" value={x.stats.total} />
              <StatCard label="Acknowledged" value={(x.stats.byStatus.Acknowledged ?? 0) + (x.stats.byStatus.Submitted ?? 0) + (x.stats.byStatus['Under Review'] ?? 0) + (x.stats.byStatus.Accepted ?? 0) + (x.stats.byStatus['Revision Requested'] ?? 0)} tone="blue" />
              <StatCard label="To review" value={(x.stats.byStatus.Submitted ?? 0) + (x.stats.byStatus['Under Review'] ?? 0)} tone="violet" />
              <StatCard label="Accepted" value={x.stats.accepted} tone="green" />
              <StatCard label="Outstanding" value={x.stats.outstanding} tone={x.stats.overdue ? 'red' : 'amber'} hint={x.stats.overdue ? `${x.stats.overdue} overdue` : undefined} />
            </div>
            <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{x.message}</p>
            <Attachments entityType="report_request" entityId={x.id} canUpload={x.status !== 'Closed'} onToast={onShowToast} label="Files shared with recipients" />
            {x.generatedReport && (
              <div className="border border-[var(--kv-border)] rounded-xl p-4">
                <ReportView report={x.generatedReport} />
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">Recipient tracking</h3>
              <DataTable
                rows={x.recipients}
                rowKey={(r) => r.id}
                onRowClick={(r) => setSelected(r.id)}
                pageSize={12}
                columns={[
                  { key: 'name', label: 'Recipient', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span> },
                  { key: 'role', label: 'Role', render: (r) => `${r.role} · ${r.department}` },
                  { key: 'acknowledgedAt', label: 'Acknowledged', render: (r) => r.acknowledgedAt ?? '—' },
                  { key: 'submittedAt', label: 'Submitted', render: (r) => (r.submittedAt ? `${r.submittedAt}${r.submissionCount > 1 ? ` (#${r.submissionCount})` : ''}` : '—') },
                  { key: 'lastRemindedAt', label: 'Last reminder', render: (r) => r.lastRemindedAt ?? '—' },
                  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.isOverdue} /> },
                ]}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">Request history</h3>
              <Timeline events={x.history} />
            </div>
          </div>
        )}
      </AsyncContent>
      {resp && <ResponseReview resp={resp} onClose={() => setSelected(null)} onChanged={refresh} onShowToast={onShowToast} />}
      <ConfirmDialog
        open={closing}
        title="Close this report request?"
        message="Recipients can no longer submit. Outstanding responses remain visible as not submitted."
        reasonLabel="Note (optional)"
        confirmLabel="Close request"
        pending={pending}
        onClose={() => setClosing(false)}
        onConfirm={async (note) => {
          const r = await run(() => http.post(`/work/report-requests/${id}/close`, { note: note || undefined }));
          setClosing(false);
          if (r) refresh();
        }}
      />
    </Modal>
  );
};

const ResponseReview: React.FC<{ resp: Response; onClose: () => void; onChanged: () => void; onShowToast: Toast }> = ({ resp, onClose, onChanged, onShowToast }) => {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const review = async (decision: 'StartReview' | 'Accept' | 'Revise') => {
    if (decision === 'Revise' && !comment.trim()) return setError('Explain what needs to change.');
    const r = await run(() => http.post(`/work/report-responses/${resp.id}/review`, { decision, comment: comment.trim() || undefined }));
    if (r) {
      onChanged();
      if (decision !== 'StartReview') onClose();
    }
  };
  return (
    <Modal open size="lg" title={`${resp.name} — response`} description={`${resp.role} · ${resp.department}`} onClose={onClose}>
      <div className="space-y-4">
        <StatusBadge status={resp.status} overdue={resp.isOverdue} />
        <KeyValue
          items={[
            ['Acknowledged', resp.acknowledgedAt ?? 'Not yet'],
            ['Submitted', resp.submittedAt ?? 'Not yet'],
            ['Submissions', resp.submissionCount],
            ['Last review', resp.reviewComment ? `${resp.reviewComment}${resp.reviewedBy ? ` — ${resp.reviewedBy}, ${resp.reviewedAt}` : ''}` : '—'],
          ]}
        />
        {resp.submissionText ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Submitted report</h3>
            <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{resp.submissionText}</p>
            <Attachments entityType="report_submission" entityId={resp.id} onToast={onShowToast} label="Report files" />
          </section>
        ) : (
          <p className="text-sm text-[var(--kv-text-muted)]">Nothing submitted yet.</p>
        )}
        {['Submitted', 'Under Review'].includes(resp.status) && (
          <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
            <TextArea label="Review comment" hint="Required when requesting a revision." rows={3} value={comment} error={error} onChange={(e) => (setComment(e.target.value), setError(null))} />
            <div className="flex flex-wrap gap-2">
              {resp.status === 'Submitted' && (
                <Button variant="secondary" loading={pending} onClick={() => review('StartReview')}>
                  Mark under review
                </Button>
              )}
              <Button variant="success" icon="task_alt" loading={pending} onClick={() => review('Accept')}>
                Accept report
              </Button>
              <Button variant="danger" icon="undo" loading={pending} onClick={() => review('Revise')}>
                Request revision
              </Button>
            </div>
          </div>
        )}
        <section>
          <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
          <Timeline events={resp.history} />
        </section>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Reports & analytics (generate, view, export)
// ---------------------------------------------------------------------------
export const DeanAnalytics: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const types = useResource(() => http.get<{ type: string; title: string; definition: string }[]>('/dean/reports'));
  const depts = useResource(() => http.get<{ code: string }[]>('/meta/departments'));
  const [type, setType] = useState('department_academic');
  const [from, setFrom] = useState(addDaysInput(-29));
  const [to, setTo] = useState(todayInput());
  const [dept, setDept] = useState('');
  const report = useResource(() => http.get<GeneratedReport>(`/dean/reports/${type}${qs({ from, to, department: dept })}`), [type, from, to, dept]);
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Generate consolidated reports from live records. Each report states exactly what it counts."
        icon="insights"
        actions={
          <>
            <Button variant="secondary" icon="print" onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="secondary" icon="download" onClick={() => downloadFile(`/dean/reports/${type}${qs({ from, to, department: dept, format: 'csv' })}`, `${type}.csv`).catch((e) => onShowToast(errorMessage(e), true))}>
              Export CSV
            </Button>
          </>
        }
      />
      <Card className="mb-4">
        <div className="grid md:grid-cols-4 gap-3">
          <SelectField label="Report" value={type} onChange={(e) => setType(e.target.value)} options={(types.data ?? []).map((t) => ({ value: t.type, label: t.title }))} />
          <TextField label="From" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <TextField label="To" type="date" value={to} min={from} max={todayInput()} onChange={(e) => e.target.value && setTo(e.target.value)} />
          <SelectField label="Department" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All departments" options={(depts.data ?? []).map((d) => d.code)} />
        </div>
      </Card>
      <Card>
        <AsyncContent {...report} onRetry={report.reload}>
          {(r) => <ReportView report={r} />}
        </AsyncContent>
      </Card>
    </div>
  );
};
