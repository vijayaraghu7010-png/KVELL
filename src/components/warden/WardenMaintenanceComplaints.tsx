import React, { useMemo, useState } from 'react';
import type { WardenTabProps } from './WardenPortal';
import type { AutoRouting, Complaint, ComplaintStatus } from '../../types';
import { http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { downloadCsv } from '../../services/csv';
import { Attachments } from '../common/Attachments';
import { AsyncContent, Badge, Button, Card, DataTable, FilterSelect, KeyValue, Modal, PageHeader, SelectField, Tabs, TextArea, TextField, Timeline, StatusBadge, todayInput } from '../common/ui';

/** Accepting returns the complaint plus what the automatic routing decided. */
interface AcceptedComplaint extends Complaint {
  autoRouting: AutoRouting;
}

interface Worker {
  id: string;
  name: string;
  role: string;
  phone: string;
  category: string;
  isActive: boolean;
}

const OPEN_STATUSES: ComplaintStatus[] = ['Submitted', 'Accepted', 'Worker Assigned', 'In Progress', 'Reopened'];
const priorityTone = (p: string | undefined) => (p === 'Critical' ? 'red' : p === 'High' ? 'red' : p === 'Medium' ? 'amber' : 'slate');

/** A page notice the Warden can close; it comes back if the count behind it changes. */
const Notice: React.FC<{ tone: 'rose' | 'amber'; icon: string; onDismiss: () => void; children: React.ReactNode }> = ({ tone, icon, onDismiss, children }) => (
  <div
    className={`mb-3 p-3 rounded-xl border text-sm flex items-start gap-2 ${tone === 'rose' ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}
    role="status"
  >
    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
      {icon}
    </span>
    <span className="flex-1 min-w-0">{children}</span>
    <button type="button" onClick={onDismiss} aria-label="Close this notice" title="Close" className="shrink-0 -mt-0.5 p-1 rounded-md hover:bg-black/5 cursor-pointer">
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
        close
      </span>
    </button>
  </div>
);

export const WardenMaintenanceComplaints: React.FC<WardenTabProps> = ({ onShowToast, onChanged }) => {
  const list = useResource(() => http.get<Complaint[]>('/warden/complaints'));
  const [filter, setFilter] = useState('open');
  const [dismissed, setDismissed] = useState<{ overdue?: number; toVerify?: number; reportedDone?: number; couldNotFinish?: number }>({});
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const all = list.data ?? [];
  const isOpen = (c: Complaint) => OPEN_STATUSES.includes(c.status);
  const rows = useMemo(
    () =>
      all.filter(
        (c) =>
          (filter === 'all' ||
            (filter === 'open'
              ? isOpen(c)
              : filter === 'reported'
                ? isOpen(c) && !!c.workerReport
                : filter === 'overdue'
                  ? !!c.isOverdue
                  : filter === 'done'
                    ? !isOpen(c)
                    : true)) &&
          (!category || c.category === category) &&
          (!priority || c.priority === priority),
      ),
    [all, filter, category, priority],
  );
  const toVerify = all.filter((c) => c.workOrderStatus === 'Pending Verification').length;
  const overdue = all.filter((c) => c.isOverdue).length;
  // The worker said the job is done; the Warden's remaining step is to verify it.
  const reportedDone = all.filter((c) => isOpen(c) && c.workerReport?.status === 'Reported Done');
  const couldNotFinish = all.filter((c) => isOpen(c) && c.workerReport?.status === 'Could Not Complete');

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Maintenance Complaints"
        subtitle="Accept a complaint and the system reads its trade, assigns a worker of that trade and sends them the job. You step in only to verify the work and resolve it."
        icon="build"
        actions={
          <Button
            variant="secondary"
            icon="download"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                `maintenance-complaints-${todayInput()}.csv`,
                [
                  { label: 'Ticket', value: (r: Complaint) => r.id },
                  { label: 'Submitted', value: (r) => r.submittedDateTime ?? '' },
                  { label: 'Student', value: (r) => r.studentName ?? '' },
                  { label: 'Room', value: (r) => r.roomNumber ?? '' },
                  { label: 'Category', value: (r) => r.category },
                  { label: 'Priority', value: (r) => r.priority ?? '' },
                  { label: 'Resolution target', value: (r) => r.resolutionTarget ?? '' },
                  { label: 'Deadline', value: (r) => r.deadlineDisplay ?? '' },
                  { label: 'Time remaining', value: (r) => r.timeRemainingLabel ?? '' },
                  { label: 'Location', value: (r) => r.location ?? '' },
                  { label: 'Title', value: (r) => r.title ?? '' },
                  { label: 'Status', value: (r) => r.status },
                  { label: 'Worker', value: (r) => r.workerName ?? '' },
                  { label: 'Work order', value: (r) => r.workOrderId ?? '' },
                  { label: 'Resolved', value: (r) => r.resolvedAt ?? '' },
                ],
                rows,
              )
            }
          >
            Export CSV
          </Button>
        }
      />
      {overdue > 0 && dismissed.overdue !== overdue && (
        <Notice tone="rose" icon="schedule" onDismiss={() => setDismissed((d) => ({ ...d, overdue }))}>
          {overdue} complaint(s) are past their resolution deadline and have been escalated to the AO.
        </Notice>
      )}
      {reportedDone.length > 0 && dismissed.reportedDone !== reportedDone.length && (
        <Notice tone="amber" icon="how_to_reg" onDismiss={() => setDismissed((d) => ({ ...d, reportedDone: reportedDone.length }))}>
          {reportedDone.length} job(s) reported done by the worker — verify the work and resolve the complaint.
        </Notice>
      )}
      {couldNotFinish.length > 0 && dismissed.couldNotFinish !== couldNotFinish.length && (
        <Notice tone="rose" icon="report" onDismiss={() => setDismissed((d) => ({ ...d, couldNotFinish: couldNotFinish.length }))}>
          {couldNotFinish.length} worker(s) reported they could not finish the job — reassign it or raise a work order.
        </Notice>
      )}
      {toVerify > 0 && dismissed.toVerify !== toVerify && (
        <Notice tone="amber" icon="fact_check" onDismiss={() => setDismissed((d) => ({ ...d, toVerify }))}>
          {toVerify} work order(s) reported done by maintenance — verify and resolve the complaint.
        </Notice>
      )}
      <div className="mb-3">
        <Tabs
          active={filter}
          onChange={setFilter}
          tabs={[
            { id: 'open', label: 'Open', count: all.filter(isOpen).length },
            { id: 'reported', label: 'Worker reported', count: reportedDone.length + couldNotFinish.length },
            { id: 'overdue', label: 'Overdue', count: overdue },
            { id: 'done', label: 'Resolved / closed', count: all.filter((c) => !isOpen(c)).length },
            { id: 'all', label: 'All', count: all.length },
          ]}
        />
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.id} ${r.studentName ?? ''} ${r.regNumber ?? ''} ${r.roomNumber ?? ''} ${r.title ?? ''} ${r.description}`}
              onRowClick={(r) => setSelected(r.id)}
              emptyTitle="No complaints in this view"
              toolbar={
                <>
                  <FilterSelect label="Category" value={category} onChange={setCategory} options={[...new Set(all.map((c) => c.category))].sort()} />
                  <FilterSelect label="Priority" value={priority} onChange={setPriority} options={['Critical', 'High', 'Medium', 'Low']} />
                </>
              }
              columns={[
                { key: 'id', label: 'Ticket', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
                { key: 'category', label: 'Category' },
                {
                  key: 'title',
                  label: 'Issue',
                  render: (r) => (
                    <span className="block max-w-[260px]">
                      <span className="block font-semibold line-clamp-1">{r.title ?? r.description}</span>
                      <span className="block text-[11px] text-[var(--kv-text-muted)]">
                        {r.studentName} · Room {r.roomNumber} · {r.location}
                      </span>
                    </span>
                  ),
                },
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
                { key: 'workerName', label: 'Worker', render: (r) => r.workerName ?? <span className="text-[var(--kv-text-muted)]">—</span> },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => (
                    <div className="space-y-1">
                      <StatusBadge status={r.status} overdue={r.isOverdue} />
                      {r.workerReport && (
                        <div className={`text-[11px] font-semibold ${r.workerReport.status === 'Reported Done' ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {r.workerReport.status === 'Reported Done' ? 'Worker: done — verify' : 'Worker: could not finish'}
                        </div>
                      )}
                      {r.workOrderStatus && <div className="text-[11px] text-[var(--kv-text-muted)]">WO: {r.workOrderStatus}</div>}
                      {r.isEscalated && <div className="text-[11px] text-rose-600">With AO</div>}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {selected && (
        <ComplaintModal
          id={selected}
          onClose={() => setSelected(null)}
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

/**
 * What the system did when the complaint was accepted: the trade it read, the
 * worker it went to and whether the job actually reached them. `routing` is the
 * accept response when the Warden just pressed Accept; on a later visit the same
 * story is rebuilt from the saved assignment, so the panel never goes blank.
 */
const RoutingPanel: React.FC<{ complaint: Complaint; routing: AutoRouting | null }> = ({ complaint: r, routing }) => {
  const live = (r.assignments ?? []).filter((a) => a.status !== 'Cancelled').at(-1);
  const phone = r.workerPhone ?? routing?.worker?.phone ?? '';
  const dispatchStatus = routing?.dispatch?.status ?? live?.dispatchStatus ?? null;
  const dispatchError = routing?.dispatch?.error ?? live?.dispatchError ?? null;
  // Only ever present when the job message did not reach the worker.
  const jobLink = routing?.dispatch?.link ?? null;

  if (!r.workerId) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">No worker was routed automatically.</p>
        <p className="text-xs mt-0.5">
          {routing?.summary ??
            `No active worker is configured for this issue's trade${routing?.detectedTrade ? ` (${routing.detectedTrade})` : ''}. Assign one below, or ask the administrator to add a worker for that trade.`}
        </p>
      </div>
    );
  }

  const why = routing?.reason ?? (live?.autoAssigned ? `the issue was read as ${live.detectedTrade}` : `${live?.assignedBy ?? 'the Warden'} chose the worker`);
  return (
    <div className="rounded-xl border border-[var(--kv-border)] bg-[var(--kv-surface-alt)] p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="material-symbols-outlined text-[20px] text-[var(--kv-heading)]" aria-hidden="true">
          engineering
        </span>
        <div className="min-w-0 text-sm text-[var(--kv-heading)]">
          <p>
            <span className="font-semibold">{r.workerName}</span>
            {r.workerTrade ? ` · ${r.workerTrade}` : ''}
            {r.workerRole ? ` · ${r.workerRole}` : ''}
            {phone && (
              <>
                {' · '}
                <a href={`tel:${phone.replace(/\s/g, '')}`} className="font-mono font-semibold underline">
                  {phone}
                </a>
              </>
            )}
          </p>
          <p className="text-[11px] text-[var(--kv-text-muted)]">
            {live?.autoAssigned === false ? 'Assigned by hand' : 'Assigned automatically'} — {why}
            {r.workerAssignedAt ? ` · ${r.workerAssignedAt}` : ''}
          </p>
        </div>
      </div>
      {r.workerReport && (
        <div
          className={`text-xs rounded-lg px-2 py-1.5 border ${r.workerReport.status === 'Reported Done' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-rose-800 bg-rose-50 border-rose-200'}`}
          role="status"
        >
          <span className="font-semibold">
            {r.workerReport.workerName} reported {r.workerReport.status === 'Reported Done' ? 'the work done' : 'they could not finish'} at {r.workerReport.reportedAt}.
          </span>
          {r.workerReport.note ? <span className="block">“{r.workerReport.note}”</span> : null}
          <span className="block">
            {r.workerReport.status === 'Reported Done'
              ? 'Verify it on the spot, then resolve the complaint below.'
              : 'Hand the job to another worker, or raise a work order with the AO.'}
          </span>
        </div>
      )}
      {jobLink && (
        <p className="text-xs text-[var(--kv-heading)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg px-2 py-1.5 break-all">
          The worker reports the job done from this link — pass it on if you reach them another way:{' '}
          <a href={jobLink} className="font-mono underline">
            {jobLink}
          </a>
        </p>
      )}
      {dispatchStatus === 'Sent' ? (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5" role="status">
          Job sent to the worker on WhatsApp{live?.dispatchedAt ? ` at ${live.dispatchedAt}` : ''}. Nothing else is needed until the work is done.
        </p>
      ) : dispatchStatus ? (
        <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5" role="status">
          The WhatsApp job was not delivered ({dispatchStatus}
          {dispatchError ? `: ${dispatchError}` : ''}). The worker is assigned — call {phone || 'the number on file'} so they know.
        </p>
      ) : null}
    </div>
  );
};

const ComplaintModal: React.FC<{ id: string; onClose: () => void; onDone: () => void; onShowToast: WardenTabProps['onShowToast'] }> = ({ id, onClose, onDone, onShowToast }) => {
  const detail = useResource(() => http.get<Complaint>(`/warden/complaints/${id}`), [id]);
  const workers = useResource(() => http.get<Worker[]>('/warden/workers'));
  const { run, pending } = useAction(onShowToast);
  const [routing, setRouting] = useState<AutoRouting | null>(null);
  const [override, setOverride] = useState(false);
  const [workerId, setWorkerId] = useState('');
  const [note, setNote] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState('');
  const c = detail.data;

  const after = (r: unknown) => {
    if (r) {
      detail.reload();
      onDone();
    }
    return r;
  };

  const accept = async () => {
    const r = (await run(() => http.post<AcceptedComplaint>(`/warden/complaints/${id}/accept`, { note: note.trim() || undefined }))) as AcceptedComplaint | undefined;
    if (r) {
      setRouting(r.autoRouting);
      // Nothing was routed: the Warden has to pick someone, so open the picker.
      if (!r.autoRouting.worker) setOverride(true);
      setNote('');
    }
    after(r);
  };

  const changeStatus = async (status: ComplaintStatus) => {
    if (status === 'Resolved' && resolutionNotes.trim().length < 5) return setResolutionError('Record what was done before resolving the complaint.');
    after(await run(() => http.patch(`/warden/complaints/${id}`, { status, note: note.trim() || undefined, resolutionNotes: status === 'Resolved' ? resolutionNotes.trim() : undefined })));
    setResolutionNotes('');
    setNote('');
  };

  return (
    <Modal
      open
      size="lg"
      title={c ? `Complaint ${c.id}` : 'Complaint'}
      description={c ? `${c.studentName} · ${c.regNumber} · Room ${c.roomNumber}` : undefined}
      onClose={onClose}
    >
      <AsyncContent {...detail} onRetry={detail.reload}>
        {(r) => {
          const open = OPEN_STATUSES.includes(r.status);
          return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={r.status} overdue={r.isOverdue} />
                <Badge tone={priorityTone(r.priority)}>{r.priority} priority</Badge>
                <Badge tone={r.isOverdue ? 'red' : 'slate'}>
                  {r.resolutionTarget} · {r.timeRemainingLabel}
                </Badge>
                <span className="text-xs text-[var(--kv-text-muted)]">submitted {r.submittedDateTime}</span>
              </div>

              <KeyValue
                items={[
                  ['Title', r.title ?? '—'],
                  ['Category', r.category],
                  ['Location', r.location ?? '—'],
                  ['Resolution deadline', r.deadlineDisplay ?? '—'],
                  ['Accepted', r.acceptedAt ? `${r.acceptedAt}${r.acceptedBy ? ` by ${r.acceptedBy}` : ''}` : 'Not accepted yet'],
                  ['Worker', r.workerName ? `${r.workerName}${r.workerTrade ? ` · ${r.workerTrade}` : ''}` : 'Not assigned'],
                  ['Worker phone', r.workerPhone ?? '—'],
                  ['Work order', r.workOrderId ? `${r.workOrderId} (${r.workOrderStatus})` : '—'],
                  ['Reopened', r.reopenedCount ? `${r.reopenedCount} time(s)` : 'No'],
                  ['Resolved', r.resolvedAt ?? '—'],
                ]}
              />

              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Issue description</span>
                <p className="text-sm text-[var(--kv-heading)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 mt-1 whitespace-pre-wrap">{r.description}</p>
              </div>
              <Attachments entityType="complaint" entityId={r.id} onToast={onShowToast} label="Photos / documents from the student" />

              {r.escalations && r.escalations.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-1">
                  <h3 className="text-sm font-semibold text-rose-800">Escalated to the Administrative Officer</h3>
                  {r.escalations.map((e) => (
                    <p key={e.id} className="text-xs text-rose-800">
                      {e.reason} · {e.status} · raised {e.createdAtDisplay}
                      {e.notes ? ` — ${e.notes}` : ''}
                    </p>
                  ))}
                </div>
              )}

              {open && (
                <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Warden action</h3>

                  {r.status === 'Submitted' || r.status === 'Reopened' ? (
                    <>
                      <p className="text-xs text-[var(--kv-text-muted)]">
                        Accepting is the only step: the system reads the trade from the complaint, assigns a worker of that trade and sends them the job on WhatsApp. You are told
                        which worker it went to.
                      </p>
                      <TextArea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} hint="Recorded against the complaint; the student sees that you accepted it." />
                      <Button size="sm" icon="assignment_turned_in" loading={pending} onClick={accept}>
                        Accept &amp; assign automatically
                      </Button>
                    </>
                  ) : (
                    <>
                      <RoutingPanel complaint={r} routing={routing} />

                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setOverride((o) => !o)}
                          className="text-xs font-semibold text-[var(--kv-heading)] underline cursor-pointer"
                          aria-expanded={override}
                        >
                          {override ? 'Hide manual controls' : r.workerId ? 'Change the worker or log a call' : 'Assign a worker yourself'}
                        </button>
                      </div>
                      {override && (
                        <div className="space-y-3 rounded-xl border border-[var(--kv-border-soft)] bg-[var(--kv-surface-alt)] p-3">
                          <div className="grid sm:grid-cols-2 gap-3">
                            <SelectField
                              label={r.workerId ? 'Hand the job to another worker' : 'Assign worker'}
                              value={workerId}
                              placeholder="— choose a worker —"
                              onChange={(e) => setWorkerId(e.target.value)}
                              options={(workers.data ?? []).map((w) => ({ value: w.id, label: `${w.name} — ${w.category}` }))}
                              hint={workers.data && workers.data.length === 0 ? 'No workers configured yet. Add them under Admin → Workers.' : 'The job is sent to whoever you choose, the same way.'}
                            />
                            <div className="flex items-end">
                              <Button
                                size="sm"
                                variant="secondary"
                                icon="engineering"
                                disabled={!workerId}
                                loading={pending}
                                onClick={async () => after(await run(() => http.post(`/warden/complaints/${id}/assign-worker`, { workerId, note: note.trim() || undefined })))}
                              >
                                {r.workerId ? 'Reassign worker' : 'Assign worker'}
                              </Button>
                            </div>
                          </div>
                          {r.workerId && (
                            <div className="flex flex-wrap items-end gap-2">
                              <TextField
                                label="Log a call with the worker (optional)"
                                value={contactNote}
                                onChange={(e) => setContactNote(e.target.value)}
                                placeholder="e.g. Called at 10:15, will reach the block by noon"
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                icon="call"
                                disabled={contactNote.trim().length < 3}
                                loading={pending}
                                onClick={async () => {
                                  const res = await run(() => http.post(`/warden/complaints/${id}/contact-worker`, { note: contactNote.trim() }));
                                  if (res) setContactNote('');
                                  after(res);
                                }}
                              >
                                Log call
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <TextArea
                        label="Resolution details"
                        rows={2}
                        value={resolutionNotes}
                        error={resolutionError}
                        onChange={(e) => {
                          setResolutionNotes(e.target.value);
                          setResolutionError(null);
                        }}
                        hint={
                          r.workerReport?.status === 'Reported Done'
                            ? 'Required to resolve. Record what you verified — the worker’s own report is already stored.'
                            : 'Required to resolve. Shown to the student and stored in the complaint history.'
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        {r.status === 'Worker Assigned' && (
                          <Button size="sm" variant="secondary" icon="engineering" loading={pending} onClick={() => changeStatus('In Progress')}>
                            Mark in progress
                          </Button>
                        )}
                        <Button size="sm" variant="success" icon="task_alt" loading={pending} onClick={() => changeStatus('Resolved')}>
                          {r.workOrderStatus === 'Pending Verification' || r.workerReport?.status === 'Reported Done' ? 'Verify work & resolve' : 'Resolve complaint'}
                        </Button>
                      </div>
                      {!r.workOrderId && (
                        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-[var(--kv-border-soft)]">
                          <TextField label="Work order target date" type="date" min={todayInput()} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
                          <Button
                            size="sm"
                            icon="handyman"
                            loading={pending}
                            onClick={async () => after(await run(() => http.post(`/warden/complaints/${id}/work-order`, { targetDate: targetDate || undefined, remarks: note.trim() || undefined })))}
                          >
                            Send work order to AO maintenance
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {r.status === 'Resolved' && (
                <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--kv-heading)]">Close the complaint</h3>
                  <p className="text-xs text-[var(--kv-text-muted)]">{r.resolutionNotes}</p>
                  <Button size="sm" variant="secondary" icon="lock" loading={pending} onClick={() => changeStatus('Closed')}>
                    Close complaint
                  </Button>
                </div>
              )}

              {r.assignments && r.assignments.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">Worker assignments</h3>
                  <ul className="text-xs text-[var(--kv-heading)] space-y-1">
                    {r.assignments.map((a) => (
                      <li key={a.id} className="border border-[var(--kv-border-soft)] rounded-lg px-3 py-2">
                        <span className="font-semibold">{a.workerName}</span> · {a.workerTrade} · {a.status} · {a.autoAssigned ? 'auto-routed' : 'assigned'} {a.assignedAt} by{' '}
                        {a.assignedBy}
                        {a.dispatchStatus ? (
                          <span className="block text-[var(--kv-text-muted)]">
                            WhatsApp job: {a.dispatchStatus}
                            {a.dispatchedAt ? ` · ${a.dispatchedAt}` : ''}
                            {a.dispatchError ? ` — ${a.dispatchError}` : ''}
                          </span>
                        ) : null}
                        {a.contactNote ? <span className="block text-[var(--kv-text-muted)]">Contacted {a.contactedAt}: {a.contactNote}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
                <Timeline events={r.history} />
              </div>
            </div>
          );
        }}
      </AsyncContent>
    </Modal>
  );
};
