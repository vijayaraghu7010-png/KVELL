import React, { useState } from 'react';
import { ApiError, http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { Attachments } from '../common/Attachments';
import { AsyncContent, Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, KeyValue, Modal, PageHeader, SelectField, StatusBadge, Tabs, TextArea, TextField, Timeline, fromLocalInput, toLocalInput, type HistoryEvent } from '../common/ui';
import { RecipientSelector, emptySelector, type ResolvedRecipient, type Selector } from './RecipientSelector';

const CATEGORIES = ['Academic Review', 'Student Support', 'Attendance Follow-up', 'Study Session Monitoring', 'Department Report', 'Administrative', 'Meeting Preparation', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
type Toast = (m: string, e?: boolean) => void;

interface Assignment {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  startAt: string;
  dueAt: string;
  startDisplay: string;
  dueDisplay: string;
  expectedOutcome: string | null;
  instructions: string | null;
  requiresEvidence: boolean;
  isConfidential: boolean;
  status: 'Draft' | 'Active' | 'Cancelled';
  /** How the task was addressed, recorded when it was sent. */
  recipientRoles?: string[];
  targetDepartments?: string[];
  selectionSummary?: string | null;
  createdBy: string;
  createdAt: string;
  stats: { total: number; byStatus: Record<string, number>; overdue: number; completed: number };
}
interface Recipient {
  id: string;
  userId: string;
  name: string;
  role: string;
  department: string;
  status: string;
  isOverdue: boolean;
  progressPct: number;
  dueAt: string;
  dueDisplay: string;
  acknowledgedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  submissionText: string | null;
  reviewComment: string | null;
  reviewedBy: string | null;
  version: number;
  history: HistoryEvent[];
}
type AssignmentDetail = Assignment & { recipients: Recipient[]; history: HistoryEvent[] };

export const DeanAssignments: React.FC<{ onShowToast: Toast; openId: string | null; onOpen: (id: string | null) => void }> = ({ onShowToast, openId, onOpen }) => {
  const list = useResource(() => http.get<Assignment[]>('/work/assignments'));
  const [view, setView] = useState('active');
  const [creating, setCreating] = useState<Assignment | 'new' | null>(null);
  const rows = (list.data ?? []).filter((a) => (view === 'all' ? true : view === 'active' ? a.status === 'Active' : view === 'review' ? (a.stats.byStatus.Submitted ?? 0) > 0 : a.status === (view === 'drafts' ? 'Draft' : 'Cancelled')));

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Work Assignments"
        subtitle="Assign work to HODs and Advisers. Each recipient has an independent status, deadline and history."
        icon="assignment"
        actions={
          <Button icon="add" onClick={() => setCreating('new')}>
            New assignment
          </Button>
        }
      />
      <div className="mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'active', label: 'Active', count: (list.data ?? []).filter((a) => a.status === 'Active').length },
            { id: 'review', label: 'Awaiting review', count: (list.data ?? []).filter((a) => (a.stats.byStatus.Submitted ?? 0) > 0).length },
            { id: 'drafts', label: 'Drafts' },
            { id: 'cancelled', label: 'Cancelled' },
            { id: 'all', label: 'All' },
          ]}
        />
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(a) => a.id}
              search={(a) => `${a.id} ${a.title} ${a.category}`}
              onRowClick={(a) => (a.status === 'Draft' ? setCreating(a) : onOpen(a.id))}
              emptyTitle="No assignments in this view"
              columns={[
                { key: 'id', label: 'ID', render: (a) => <span className="font-mono text-xs">{a.id}</span> },
                { key: 'title', label: 'Title', render: (a) => <span className="font-semibold text-[var(--kv-heading)]">{a.title}</span> },
                { key: 'category', label: 'Category' },
                { key: 'priority', label: 'Priority', render: (a) => <Badge tone={a.priority === 'Urgent' ? 'red' : a.priority === 'High' ? 'amber' : 'blue'}>{a.priority}</Badge> },
                { key: 'dueAt', label: 'Due', sortValue: (a) => a.dueAt, render: (a) => a.dueDisplay },
                {
                  key: 'progress',
                  label: 'Recipients',
                  sortValue: (a) => a.stats.completed / Math.max(1, a.stats.total),
                  render: (a) =>
                    a.status === 'Draft' ? (
                      '—'
                    ) : (
                      <span className="text-xs">
                        {a.stats.completed}/{a.stats.total} completed
                        {a.stats.byStatus.Submitted ? <Badge tone="blue" className="ml-1">{a.stats.byStatus.Submitted} to review</Badge> : null}
                        {a.stats.overdue ? <Badge tone="red" className="ml-1">{a.stats.overdue} overdue</Badge> : null}
                      </span>
                    ),
                },
                { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {creating && (
        <AssignmentForm
          draft={creating === 'new' ? null : creating}
          onClose={() => setCreating(null)}
          onSaved={(id, active) => {
            setCreating(null);
            list.reload();
            if (active) onOpen(id);
          }}
          onShowToast={onShowToast}
        />
      )}
      {openId && <AssignmentDetailModal id={openId} onClose={() => onOpen(null)} onChanged={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const AssignmentForm: React.FC<{ draft: Assignment | null; onClose: () => void; onSaved: (id: string, active: boolean) => void; onShowToast: Toast }> = ({ draft, onClose, onSaved, onShowToast }) => {
  const now = new Date();
  const [f, setF] = useState({
    title: draft?.title ?? '',
    description: draft?.description ?? '',
    category: draft?.category ?? 'Department Report',
    priority: draft?.priority ?? 'Medium',
    startAt: toLocalInput(draft?.startAt ?? now.toISOString()),
    dueAt: toLocalInput(draft?.dueAt ?? new Date(now.getTime() + 7 * 86_400_000).toISOString()),
    expectedOutcome: draft?.expectedOutcome ?? '',
    instructions: draft?.instructions ?? '',
    requiresEvidence: draft?.requiresEvidence ?? false,
    isConfidential: draft?.isConfidential ?? false,
  });
  const [selector, setSelector] = useState<Selector>(emptySelector());
  const [resolved, setResolved] = useState<ResolvedRecipient[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const validate = (needRecipients: boolean) => {
    const errs: Record<string, string> = {};
    if (f.title.trim().length < 3) errs.title = 'Enter a task title.';
    if (f.description.trim().length < 10) errs.description = 'Describe the work (at least 10 characters).';
    if (!f.startAt) errs.startAt = 'Start is required.';
    if (!f.dueAt) errs.dueAt = 'Due date is required.';
    else if (new Date(f.dueAt) <= new Date(f.startAt)) errs.dueAt = 'Due date must be after the start.';
    else if (new Date(f.dueAt) < new Date()) errs.dueAt = 'Due date is in the past.';
    if (needRecipients && resolved.length === 0) errs.recipients = 'Choose at least one recipient.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const body = (status: 'Draft' | 'Active') => ({
    ...f,
    title: f.title.trim(),
    description: f.description.trim(),
    startAt: fromLocalInput(f.startAt),
    dueAt: fromLocalInput(f.dueAt),
    expectedOutcome: f.expectedOutcome.trim() || undefined,
    instructions: f.instructions.trim() || undefined,
    recipients: selector,
    confirmCount: resolved.length,
    status,
  });

  const send = async (status: 'Draft' | 'Active') => {
    setPending(true);
    try {
      let res;
      if (draft) {
        await http.patch(`/work/assignments/${draft.id}`, body('Draft'));
        res = status === 'Active' ? await http.post<Assignment>(`/work/assignments/${draft.id}/activate`, { recipients: selector, confirmCount: resolved.length }) : { data: draft, message: 'Draft updated.' };
      } else {
        res = await http.post<Assignment>('/work/assignments', body(status));
      }
      onShowToast(res.message || 'Saved.');
      onSaved(res.data.id, status === 'Active');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      onShowToast(err instanceof Error ? err.message : 'Could not save.', true);
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <Modal
      open
      size="xl"
      title={draft ? `Edit draft ${draft.id}` : 'New work assignment'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" icon="save" loading={pending} onClick={() => validate(false) && send('Draft')}>
            Save as draft
          </Button>
          <Button icon="send" loading={pending} onClick={() => validate(true) && setConfirming(true)}>
            Review & assign
          </Button>
        </>
      }
    >
      <div className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <TextField label="Task title" required value={f.title} onChange={set('title')} error={errors.title} />
        </div>
        <div className="md:col-span-2">
          <TextArea label="Detailed description" required rows={4} value={f.description} onChange={set('description')} error={errors.description} />
        </div>
        <SelectField label="Category" value={f.category} onChange={set('category')} options={CATEGORIES} />
        <SelectField label="Priority" value={f.priority} onChange={set('priority')} options={PRIORITIES} />
        <TextField label="Start" type="datetime-local" required value={f.startAt} onChange={set('startAt')} error={errors.startAt} />
        <TextField label="Due" type="datetime-local" required value={f.dueAt} onChange={set('dueAt')} error={errors.dueAt} />
        <TextArea label="Expected outcome" rows={2} value={f.expectedOutcome} onChange={set('expectedOutcome')} />
        <TextArea label="Additional instructions" rows={2} value={f.instructions} onChange={set('instructions')} />
        <div className="md:col-span-2 flex flex-wrap gap-6">
          <Checkbox label="Completion evidence required" hint="Recipients must attach at least one file to submit." checked={f.requiresEvidence} onChange={(v) => setF({ ...f, requiresEvidence: v })} />
          <Checkbox label="Confidential" hint="Visible only to you and the selected recipients." checked={f.isConfidential} onChange={(v) => setF({ ...f, isConfidential: v })} />
        </div>
        <div className="md:col-span-2">
          <RecipientSelector value={selector} onChange={setSelector} onResolved={setResolved} error={errors.recipients} />
          <p className="text-[11px] text-[var(--kv-text-muted)] mt-1">Supporting files can be attached after the assignment is created (open it from the list).</p>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Assign to ${resolved.length} recipient(s)?`}
        message={
          <div className="space-y-2">
            <p>Each recipient receives the task with an independent status and an in-app notification.</p>
            <ul className="max-h-40 overflow-y-auto text-xs space-y-0.5">
              {resolved.map((r) => (
                <li key={r.id}>
                  {r.name} — {r.role}, {r.department}
                </li>
              ))}
            </ul>
          </div>
        }
        confirmLabel="Assign now"
        pending={pending}
        onClose={() => setConfirming(false)}
        onConfirm={() => send('Active')}
      />
    </Modal>
  );
};

const AssignmentDetailModal: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: Toast }> = ({ id, onClose, onChanged, onShowToast }) => {
  const d = useResource(() => http.get<AssignmentDetail>(`/work/assignments/${id}`), [id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const { run, pending } = useAction(onShowToast);
  const refresh = () => {
    d.reload();
    onChanged();
  };
  const a = d.data;
  const rec = a?.recipients.find((r) => r.id === selected) ?? null;
  return (
    <Modal open size="xl" title={a ? `${a.id}: ${a.title}` : 'Assignment'} description={a ? `${a.category} · ${a.priority} priority · due ${a.dueDisplay}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(x) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={x.status} />
              {x.isConfidential && <Badge tone="violet">Confidential</Badge>}
              {x.requiresEvidence && <Badge tone="amber">Evidence required</Badge>}
              <span className="text-xs text-[var(--kv-text-muted)]">
                Created by {x.createdBy}, {x.createdAt}
              </span>
              <div className="flex-1" />
              {x.status === 'Active' && (
                <Button size="sm" variant="danger" icon="cancel" onClick={() => setCancelOpen(true)}>
                  Cancel assignment
                </Button>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{x.description}</p>
            <KeyValue
              items={[
                ['Start', x.startDisplay],
                ['Due', x.dueDisplay],
                ['Expected outcome', x.expectedOutcome ?? '—'],
                ['Instructions', x.instructions ?? '—'],
                ['Recipient roles', x.recipientRoles?.length ? x.recipientRoles.join(', ') : '—'],
                ['Target departments', x.targetDepartments?.length ? x.targetDepartments.join(', ') : 'All departments'],
                ['Distribution', x.selectionSummary ?? '—'],
              ]}
            />
            <Attachments entityType="assignment" entityId={x.id} canUpload={x.status !== 'Cancelled'} onToast={onShowToast} label="Supporting files for recipients" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">
                Recipients — {x.stats.completed}/{x.stats.total} completed
              </h3>
              <DataTable
                rows={x.recipients}
                rowKey={(r) => r.id}
                onRowClick={(r) => setSelected(r.id)}
                pageSize={12}
                columns={[
                  { key: 'name', label: 'Recipient', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span> },
                  { key: 'role', label: 'Role', render: (r) => `${r.role} · ${r.department}` },
                  { key: 'progressPct', label: 'Progress', render: (r) => `${r.progressPct}%` },
                  { key: 'dueAt', label: 'Deadline', sortValue: (r) => r.dueAt, render: (r) => r.dueDisplay },
                  { key: 'acknowledgedAt', label: 'Acknowledged', render: (r) => r.acknowledgedAt ?? '—' },
                  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.isOverdue} /> },
                ]}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">Assignment history</h3>
              <Timeline events={x.history} />
            </div>
          </div>
        )}
      </AsyncContent>
      {rec && a && <RecipientReview assignment={a} rec={rec} onClose={() => setSelected(null)} onChanged={refresh} onShowToast={onShowToast} />}
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this assignment?"
        message="All open recipient tasks are cancelled and recipients are notified. Completed work stays on record."
        reasonLabel="Reason"
        reasonRequired
        danger
        confirmLabel="Cancel assignment"
        pending={pending}
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          const r = await run(() => http.post(`/work/assignments/${id}/cancel`, { reason }));
          setCancelOpen(false);
          if (r) refresh();
        }}
      />
    </Modal>
  );
};

const RecipientReview: React.FC<{ assignment: AssignmentDetail; rec: Recipient; onClose: () => void; onChanged: () => void; onShowToast: Toast }> = ({ assignment, rec, onClose, onChanged, onShowToast }) => {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [due, setDue] = useState(toLocalInput(rec.dueAt));
  const [reason, setReason] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const staff = useResource(() => http.get<{ id: string; name: string; role: string; department: string | null }[]>('/meta/staff?roles=HOD,Adviser'));
  const { run, pending } = useAction(onShowToast);
  const after = (r: unknown) => {
    if (r) {
      onChanged();
      onClose();
    }
  };
  const open = !['Completed', 'Cancelled'].includes(rec.status) && assignment.status === 'Active';
  return (
    <Modal open size="lg" title={`${rec.name} — ${assignment.title}`} description={`${rec.role} · ${rec.department}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={rec.status} overdue={rec.isOverdue} />
          <Badge tone="slate">Progress {rec.progressPct}%</Badge>
        </div>
        <KeyValue
          items={[
            ['Deadline', rec.dueDisplay],
            ['Acknowledged', rec.acknowledgedAt ?? 'Not yet'],
            ['Submitted', rec.submittedAt ?? '—'],
            ['Completed', rec.completedAt ?? '—'],
            ['Last review', rec.reviewComment ? `${rec.reviewComment}${rec.reviewedBy ? ` — ${rec.reviewedBy}` : ''}` : '—'],
          ]}
        />
        {rec.submissionText && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Submission</h3>
            <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{rec.submissionText}</p>
            <Attachments entityType="assignment_submission" entityId={rec.id} onToast={onShowToast} label="Evidence" />
          </section>
        )}
        {rec.status === 'Submitted' && (
          <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
            <TextArea label="Review comment" hint="Required when requesting a revision." rows={3} value={comment} error={error} onChange={(e) => (setComment(e.target.value), setError(null))} />
            <div className="flex gap-2">
              <Button variant="success" icon="task_alt" loading={pending} onClick={async () => after(await run(() => http.post(`/work/tasks/${rec.id}/review`, { decision: 'Approve', comment: comment.trim() || undefined, expectedVersion: rec.version })))}>
                Approve completion
              </Button>
              <Button
                variant="danger"
                icon="undo"
                loading={pending}
                onClick={async () => {
                  if (!comment.trim()) return setError('Explain what needs to change.');
                  after(await run(() => http.post(`/work/tasks/${rec.id}/review`, { decision: 'Revise', comment: comment.trim(), expectedVersion: rec.version })));
                }}
              >
                Request revision
              </Button>
            </div>
          </div>
        )}
        {rec.status === 'Completed' && assignment.status === 'Active' && (
          <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-2">
            <TextField label="Reason to reopen" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" variant="secondary" icon="restart_alt" loading={pending} disabled={reason.trim().length < 5} onClick={async () => after(await run(() => http.post(`/work/tasks/${rec.id}/reopen`, { reason: reason.trim() })))}>
              Reopen for revision
            </Button>
          </div>
        )}
        {open && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Change deadline</h3>
              <TextField label="New deadline" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              <TextField label="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" variant="secondary" loading={pending} disabled={reason.trim().length < 5 || !due} onClick={async () => after(await run(() => http.post(`/work/tasks/${rec.id}/deadline`, { dueAt: fromLocalInput(due), reason: reason.trim() })))}>
                Update deadline
              </Button>
            </div>
            <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Reassign</h3>
              <SelectField
                label="New assignee"
                value={reassignTo}
                placeholder="Choose…"
                onChange={(e) => setReassignTo(e.target.value)}
                options={(staff.data ?? []).filter((s) => !assignment.recipients.some((r) => r.userId === s.id)).map((s) => ({ value: s.id, label: `${s.name} (${s.role}, ${s.department})` }))}
              />
              <TextField label="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button
                size="sm"
                variant="secondary"
                loading={pending}
                disabled={!reassignTo || reason.trim().length < 5}
                onClick={async () => after(await run(() => http.post(`/work/assignments/${assignment.id}/reassign`, { recipientId: rec.id, toUserId: reassignTo, reason: reason.trim() })))}
              >
                Reassign task
              </Button>
            </div>
          </div>
        )}
        <section>
          <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">Recipient history</h3>
          <Timeline events={rec.history} />
        </section>
      </div>
    </Modal>
  );
};
