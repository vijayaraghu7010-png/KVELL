import React, { useMemo, useState } from 'react';
import { http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { Attachments } from './Attachments';
import { ReportView, type GeneratedReport } from './ReportView';
import { AsyncContent, Badge, Button, Card, DataTable, EmptyState, KeyValue, Modal, PageHeader, Tabs, TextArea, TextField, Timeline, StatusBadge, type HistoryEvent } from './ui';

// ===========================================================================
// Dean-assigned tasks (recipient view)
// ===========================================================================
interface MyTaskRow {
  id: string;
  assignmentId: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  isOverdue: boolean;
  progressPct: number;
  dueAt: string;
  dueDisplay: string;
  requiresEvidence: boolean;
  isConfidential: boolean;
  assignmentStatus: string;
}
interface MyTaskDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  startDisplay: string;
  dueDisplay: string;
  expectedOutcome: string | null;
  instructions: string | null;
  requiresEvidence: boolean;
  isConfidential: boolean;
  status: string;
  createdBy: string;
  createdAt: string;
  myTask: {
    id: string;
    status: string;
    isOverdue: boolean;
    progressPct: number;
    dueDisplay: string;
    acknowledgedAt: string | null;
    submittedAt: string | null;
    completedAt: string | null;
    submissionText: string | null;
    reviewComment: string | null;
    reviewedBy: string | null;
    version: number;
    history: HistoryEvent[];
  };
}

const priorityTone = (p: string) => (p === 'Urgent' ? 'red' : p === 'High' ? 'amber' : p === 'Medium' ? 'blue' : 'slate');

export const TasksInbox: React.FC<{ onShowToast: (m: string, e?: boolean) => void; initialId?: string | null }> = ({ onShowToast, initialId }) => {
  const list = useResource(() => http.get<MyTaskRow[]>('/work/assignments'));
  const [view, setView] = useState('open');
  const [openId, setOpenId] = useState<string | null>(initialId ?? null);
  const rows = useMemo(
    () => (list.data ?? []).filter((t) => (view === 'all' ? true : view === 'open' ? !['Completed', 'Cancelled'].includes(t.status) : view === 'overdue' ? t.isOverdue : ['Completed', 'Cancelled'].includes(t.status))),
    [list.data, view],
  );
  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="My Tasks" subtitle="Work assigned by the Dean. Acknowledge, update progress and submit for review." icon="assignment" />
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'open', label: 'Open', count: (list.data ?? []).filter((t) => !['Completed', 'Cancelled'].includes(t.status)).length },
            { id: 'overdue', label: 'Overdue', count: (list.data ?? []).filter((t) => t.isOverdue).length },
            { id: 'closed', label: 'Completed / cancelled' },
            { id: 'all', label: 'All' },
          ]}
        />
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(t) => t.id}
              search={(t) => `${t.title} ${t.category}`}
              onRowClick={(t) => setOpenId(t.assignmentId)}
              emptyTitle={view === 'open' ? 'No open tasks' : 'No tasks'}
              columns={[
                { key: 'title', label: 'Task', render: (t) => <span className="font-semibold text-[var(--kv-heading)]">{t.title}</span> },
                { key: 'category', label: 'Category' },
                { key: 'priority', label: 'Priority', render: (t) => <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge> },
                { key: 'dueAt', label: 'Due', sortValue: (t) => t.dueAt, render: (t) => t.dueDisplay },
                { key: 'progressPct', label: 'Progress', render: (t) => `${t.progressPct}%` },
                { key: 'status', label: 'Status', render: (t) => <StatusBadge status={t.status} overdue={t.isOverdue} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {openId && <TaskDetail assignmentId={openId} onClose={() => setOpenId(null)} onChanged={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const TaskDetail: React.FC<{ assignmentId: string; onClose: () => void; onChanged: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ assignmentId, onClose, onChanged, onShowToast }) => {
  const d = useResource(() => http.get<MyTaskDetail>(`/work/assignments/${assignmentId}`), [assignmentId]);
  const [progress, setProgress] = useState('');
  const [pct, setPct] = useState('');
  const [report, setReport] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useAction(onShowToast);
  const t = d.data?.myTask;
  const active = t && ['Assigned', 'Acknowledged', 'In Progress', 'Revision Requested'].includes(t.status) && d.data?.status === 'Active';
  const done = (r: unknown) => {
    if (r) {
      d.reload();
      onChanged();
    }
  };

  return (
    <Modal open size="xl" title={d.data?.title ?? 'Task'} description={d.data ? `${d.data.category} · assigned by ${d.data.createdBy} on ${d.data.createdAt}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(a) => (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={a.myTask.status} overdue={a.myTask.isOverdue} />
              <Badge tone={priorityTone(a.priority)}>{a.priority} priority</Badge>
              {a.isConfidential && <Badge tone="violet">Confidential</Badge>}
              {a.requiresEvidence && <Badge tone="amber">Evidence required</Badge>}
            </div>
            <KeyValue
              items={[
                ['Start', a.startDisplay],
                ['Your deadline', a.myTask.dueDisplay],
                ['Acknowledged', a.myTask.acknowledgedAt ?? 'Not yet'],
                ['Progress', `${a.myTask.progressPct}%`],
                ['Submitted', a.myTask.submittedAt ?? '—'],
                ['Completed', a.myTask.completedAt ?? '—'],
              ]}
            />
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Instructions from the Dean</h3>
              <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{a.description}</p>
              {a.instructions && <p className="text-sm whitespace-pre-wrap">{a.instructions}</p>}
              {a.expectedOutcome && (
                <p className="text-sm">
                  <strong>Expected outcome:</strong> {a.expectedOutcome}
                </p>
              )}
              <Attachments entityType="assignment" entityId={a.id} onToast={onShowToast} label="Files from the Dean" />
            </section>
            {a.myTask.reviewComment && (
              <div className={`p-3 rounded-lg border text-sm ${a.myTask.status === 'Revision Requested' ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <strong>Dean's review{a.myTask.reviewedBy ? ` (${a.myTask.reviewedBy})` : ''}:</strong> {a.myTask.reviewComment}
              </div>
            )}

            {a.myTask.status === 'Assigned' && a.status === 'Active' && (
              <Button icon="thumb_up" loading={pending} onClick={async () => done(await run(() => http.post(`/work/tasks/${a.myTask.id}/acknowledge`)))}>
                Acknowledge task
              </Button>
            )}

            {active && (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Update progress</h3>
                  <TextField label="Progress %" type="number" min={0} max={99} value={pct} onChange={(e) => setPct(e.target.value)} error={errors.pct} />
                  <TextArea label="Progress note" rows={3} value={progress} onChange={(e) => setProgress(e.target.value)} error={errors.progress} />
                  <Button
                    variant="secondary"
                    icon="trending_up"
                    loading={pending}
                    onClick={async () => {
                      const n = Number(pct);
                      const errs: Record<string, string> = {};
                      if (pct === '' || !(n >= 0 && n <= 99)) errs.pct = 'Enter 0–99 (submit to finish).';
                      if (progress.trim().length < 3) errs.progress = 'Describe the progress.';
                      setErrors(errs);
                      if (Object.keys(errs).length) return;
                      const r = await run(() => http.post(`/work/tasks/${a.myTask.id}/progress`, { progressPct: n, note: progress.trim(), expectedVersion: a.myTask.version }));
                      if (r) {
                        setProgress('');
                        setPct('');
                      }
                      done(r);
                    }}
                  >
                    Save progress
                  </Button>
                </div>
                <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--kv-heading)]">{a.myTask.status === 'Revision Requested' ? 'Resubmit for review' : 'Submit for review'}</h3>
                  <TextArea label="Completion report" rows={4} value={report} onChange={(e) => setReport(e.target.value)} error={errors.report} hint="Summarise what was done; attach evidence below." />
                  <Attachments entityType="assignment_submission" entityId={a.myTask.id} canUpload onToast={onShowToast} label={a.requiresEvidence ? 'Evidence (required)' : 'Evidence (optional)'} />
                  <Button
                    icon="send"
                    loading={pending}
                    onClick={async () => {
                      if (report.trim().length < 10) return setErrors({ report: 'Write at least 10 characters.' });
                      setErrors({});
                      const r = await run(() => http.post(`/work/tasks/${a.myTask.id}/submit`, { submissionText: report.trim(), expectedVersion: a.myTask.version }));
                      if (r) setReport('');
                      done(r);
                    }}
                  >
                    Submit to Dean
                  </Button>
                </div>
              </div>
            )}

            {a.myTask.submissionText && (
              <section>
                <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-1">Your latest submission</h3>
                <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{a.myTask.submissionText}</p>
                {!active && <Attachments entityType="assignment_submission" entityId={a.myTask.id} onToast={onShowToast} label="Submitted evidence" />}
              </section>
            )}
            <section>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
              <Timeline events={a.myTask.history} />
            </section>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

// ===========================================================================
// Schedules (participant view)
// ===========================================================================
interface MySchedule {
  id: string;
  title: string;
  description: string | null;
  category: string;
  startAt: string;
  endAt: string;
  startDisplay: string;
  endDisplay: string;
  location: string | null;
  instructions: string | null;
  requiresAck: boolean;
  status: string;
  organizer: string;
  isPast: boolean;
  myResponse?: string;
  myResponseNote?: string | null;
}

export const ScheduleInbox: React.FC<{ onShowToast: (m: string, e?: boolean) => void }> = ({ onShowToast }) => {
  const list = useResource(() => http.get<MySchedule[]>('/work/schedules'));
  const [view, setView] = useState('upcoming');
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => {
    const all = list.data ?? [];
    if (view === 'upcoming') return all.filter((s) => !s.isPast && ['Scheduled', 'Rescheduled'].includes(s.status));
    if (view === 'pending') return all.filter((s) => !s.isPast && s.myResponse === 'Pending' && ['Scheduled', 'Rescheduled'].includes(s.status));
    if (view === 'past') return all.filter((s) => s.isPast || s.status === 'Completed');
    if (view === 'cancelled') return all.filter((s) => s.status === 'Cancelled');
    return all;
  }, [list.data, view]);
  const grouped = useMemo(() => {
    const m = new Map<string, MySchedule[]>();
    rows.forEach((s) => {
      const k = new Date(s.startAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      m.set(k, [...(m.get(k) ?? []), s]);
    });
    return [...m.entries()];
  }, [rows]);
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="My Schedule" subtitle="Meetings and reviews scheduled by the Dean. Acknowledge or decline with a reason." icon="event" />
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'pending', label: 'Awaiting my response', count: (list.data ?? []).filter((s) => !s.isPast && s.myResponse === 'Pending' && s.status !== 'Cancelled').length },
            { id: 'past', label: 'Past' },
            { id: 'cancelled', label: 'Cancelled' },
          ]}
        />
      </div>
      <AsyncContent {...list} onRetry={list.reload} isEmpty={() => rows.length === 0} empty={<Card><EmptyState icon="event_available" title="Nothing scheduled here" /></Card>}>
        {() => (
          <div className="space-y-4">
            {grouped.map(([day, items]) => (
              <Card key={day} title={day}>
                <ul className="divide-y divide-[var(--kv-border-soft)]">
                  {items.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => setOpenId(s.id)} className="w-full text-left py-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-[var(--kv-accent-soft)] rounded-lg px-2">
                        <span>
                          <span className="font-semibold text-[var(--kv-heading)]">{s.title}</span>
                          <span className="block text-xs text-[var(--kv-text-muted)]">
                            {new Date(s.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–{new Date(s.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {s.category}
                            {s.location ? ` · ${s.location}` : ''}
                          </span>
                        </span>
                        <span className="flex gap-1.5">
                          {s.status !== 'Scheduled' && <StatusBadge status={s.status} />}
                          {s.requiresAck && <StatusBadge status={s.myResponse ?? 'Pending'} />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </AsyncContent>
      {openId && <ScheduleDetail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const ScheduleDetail: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ id, onClose, onChanged, onShowToast }) => {
  const d = useResource(() => http.get<MySchedule>(`/work/schedules/${id}`), [id]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const respond = async (response: 'Acknowledged' | 'Declined') => {
    if (response === 'Declined' && !note.trim()) return setError('Give a reason for declining.');
    const r = await run(() => http.post(`/work/schedules/${id}/respond`, { response, note: note.trim() || undefined }));
    if (r) {
      d.reload();
      onChanged();
    }
  };
  const s = d.data;
  const open = s && ['Scheduled', 'Rescheduled'].includes(s.status) && !s.isPast;
  return (
    <Modal open title={s?.title ?? 'Activity'} description={s ? `${s.startDisplay} – ${s.endDisplay}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(x) => (
          <div className="space-y-4">
            <div className="flex gap-2">
              <StatusBadge status={x.status} />
              <StatusBadge status={`My response: ${x.myResponse ?? 'Pending'}`} />
            </div>
            <KeyValue
              items={[
                ['Category', x.category],
                ['Organizer', x.organizer],
                ['Location / link', x.location ?? '—'],
                ['Your note', x.myResponseNote ?? '—'],
              ]}
            />
            {x.description && <p className="text-sm whitespace-pre-wrap">{x.description}</p>}
            {x.instructions && <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{x.instructions}</p>}
            {open && (
              <div className="space-y-2">
                <TextArea label="Note (required to decline)" rows={2} value={note} error={error} onChange={(e) => (setNote(e.target.value), setError(null))} />
                <div className="flex gap-2">
                  <Button variant="success" icon="check" loading={pending} onClick={() => respond('Acknowledged')}>
                    Acknowledge
                  </Button>
                  <Button variant="danger" icon="close" loading={pending} onClick={() => respond('Declined')}>
                    Decline
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

// ===========================================================================
// Report requests (recipient view)
// ===========================================================================
interface MyReportRow {
  id: string;
  requestId: string;
  title: string;
  category: string;
  message: string;
  deadlineDisplay: string | null;
  requiresSubmission: boolean;
  requestStatus: string;
  status: string;
  isOverdue: boolean;
  submittedAt: string | null;
  reviewComment: string | null;
}
interface MyReportDetail {
  id: string;
  title: string;
  message: string;
  category: string;
  periodFrom: string | null;
  periodTo: string | null;
  deadlineDisplay: string | null;
  requiresSubmission: boolean;
  status: string;
  createdBy: string;
  createdAt: string;
  generatedReport: GeneratedReport | null;
  myResponse: {
    id: string;
    status: string;
    isOverdue: boolean;
    acknowledgedAt: string | null;
    submittedAt: string | null;
    submissionText: string | null;
    reviewComment: string | null;
    reviewedBy: string | null;
    submissionCount: number;
    history: HistoryEvent[];
  };
}

export const ReportRequestsInbox: React.FC<{ onShowToast: (m: string, e?: boolean) => void }> = ({ onShowToast }) => {
  const list = useResource(() => http.get<MyReportRow[]>('/work/report-requests'));
  const [view, setView] = useState('action');
  const [openId, setOpenId] = useState<string | null>(null);
  const needsAction = (r: MyReportRow) => r.requestStatus === 'Distributed' && (r.requiresSubmission ? ['Distributed', 'Acknowledged', 'Revision Requested'].includes(r.status) : r.status === 'Distributed');
  const rows = (list.data ?? []).filter((r) => (view === 'action' ? needsAction(r) : view === 'done' ? !needsAction(r) : true));
  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Report Requests" subtitle="Reports and circulars distributed by the Dean. Acknowledge, prepare and submit your report." icon="assignment_turned_in" />
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'action', label: 'Needs action', count: (list.data ?? []).filter(needsAction).length },
            { id: 'done', label: 'Submitted / closed' },
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
              search={(r) => `${r.title} ${r.category}`}
              onRowClick={(r) => setOpenId(r.requestId)}
              emptyTitle={view === 'action' ? 'Nothing needs your action' : 'No report requests'}
              columns={[
                { key: 'title', label: 'Title', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.title}</span> },
                { key: 'category', label: 'Category' },
                { key: 'deadlineDisplay', label: 'Deadline', render: (r) => r.deadlineDisplay ?? (r.requiresSubmission ? '—' : 'For information') },
                { key: 'status', label: 'My status', render: (r) => <StatusBadge status={r.status} overdue={r.isOverdue} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {openId && <ReportRequestDetail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const ReportRequestDetail: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ id, onClose, onChanged, onShowToast }) => {
  const d = useResource(() => http.get<MyReportDetail>(`/work/report-requests/${id}`), [id]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const done = (r: unknown) => {
    if (r) {
      d.reload();
      onChanged();
    }
  };
  return (
    <Modal open size="xl" title={d.data?.title ?? 'Report request'} description={d.data ? `${d.data.category} · from ${d.data.createdBy}, ${d.data.createdAt}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(q) => {
          const r = q.myResponse;
          const canSubmit = q.status === 'Distributed' && q.requiresSubmission && ['Distributed', 'Acknowledged', 'Revision Requested'].includes(r.status);
          return (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={r.status} overdue={r.isOverdue} />
                {q.status !== 'Distributed' && <StatusBadge status={`Request ${q.status}`} />}
              </div>
              <KeyValue
                items={[
                  ['Deadline', q.deadlineDisplay ?? (q.requiresSubmission ? '—' : 'No submission required')],
                  ['Reporting period', q.periodFrom ? `${q.periodFrom} → ${q.periodTo ?? ''}` : '—'],
                  ['Acknowledged', r.acknowledgedAt ?? 'Not yet'],
                  ['Submitted', r.submittedAt ? `${r.submittedAt} (submission #${r.submissionCount})` : '—'],
                ]}
              />
              <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{q.message}</p>
              <Attachments entityType="report_request" entityId={q.id} onToast={onShowToast} label="Files from the Dean" />
              {q.generatedReport && (
                <section className="border border-[var(--kv-border)] rounded-xl p-4">
                  <ReportView report={q.generatedReport} />
                </section>
              )}
              {r.reviewComment && (
                <div className={`p-3 rounded-lg border text-sm ${r.status === 'Revision Requested' ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                  <strong>Dean's review{r.reviewedBy ? ` (${r.reviewedBy})` : ''}:</strong> {r.reviewComment}
                </div>
              )}
              {r.status === 'Distributed' && q.status === 'Distributed' && (
                <Button icon="thumb_up" loading={pending} onClick={async () => done(await run(() => http.post(`/work/report-responses/${r.id}/acknowledge`)))}>
                  Acknowledge receipt
                </Button>
              )}
              {canSubmit && (
                <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--kv-heading)]">{r.status === 'Revision Requested' ? 'Resubmit your report' : 'Submit your report'}</h3>
                  <TextArea label="Report" rows={8} value={text} error={error} onChange={(e) => (setText(e.target.value), setError(null))} hint="Write the report or a summary, and attach the full document below." />
                  <Attachments entityType="report_submission" entityId={r.id} canUpload onToast={onShowToast} label="Report files" />
                  <Button
                    icon="send"
                    loading={pending}
                    onClick={async () => {
                      if (text.trim().length < 10) return setError('Write at least 10 characters.');
                      const res = await run(() => http.post(`/work/report-responses/${r.id}/submit`, { submissionText: text.trim() }));
                      if (res) setText('');
                      done(res);
                    }}
                  >
                    Submit to Dean
                  </Button>
                </div>
              )}
              {r.submissionText && !canSubmit && (
                <section>
                  <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-1">Your submission</h3>
                  <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{r.submissionText}</p>
                  <Attachments entityType="report_submission" entityId={r.id} onToast={onShowToast} label="Submitted files" />
                </section>
              )}
              <section>
                <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
                <Timeline events={r.history} />
              </section>
            </div>
          );
        }}
      </AsyncContent>
    </Modal>
  );
};
