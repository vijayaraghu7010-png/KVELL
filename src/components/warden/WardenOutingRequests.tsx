import React, { useMemo, useState } from 'react';
import type { WardenTabProps } from './WardenPortal';
import type { HistoryEntry } from '../../types';
import { http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { AsyncContent, Button, Card, DataTable, KeyValue, Modal, PageHeader, Tabs, TextArea, Timeline, StatusBadge } from '../common/ui';

interface StaffOuting {
  id: string;
  studentName: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  block: string;
  studentPhone: string;
  parentName: string;
  parentPhone: string;
  destination: string;
  reason: string;
  outingType: string;
  dateTime: string;
  expectedReturn: string;
  outAt: string;
  expectedReturnAt: string;
  status: string;
  parentDecision?: 'Approved' | 'Rejected' | null;
  parentDecidedAt?: string;
  parentNote?: string;
  parentApprovals?: {
    id: string;
    parentName: string | null;
    parentPhoneMasked: string;
    deliveryStatus: string;
    deliveryError: string | null;
    decision: 'Approved' | 'Rejected' | null;
    decidedAt: string | null;
    note: string | null;
    requestedAt: string;
  }[];
  tracking?: {
    status: string;
    isInterrupted: boolean;
    lastUpdateDisplay: string;
    interruptionReason: string | null;
  } | null;
  submittedDateTime: string;
  decidedBy?: string;
  decidedAt?: string;
  remarks?: string;
  history?: HistoryEntry[];
}

export const WardenOutingRequests: React.FC<WardenTabProps> = ({ onShowToast, onChanged }) => {
  const list = useResource(() => http.get<StaffOuting[]>('/warden/outing-requests'));
  const [filter, setFilter] = useState('Pending Warden');
  const [selected, setSelected] = useState<string | null>(null);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (list.data ?? []).forEach((o) => (c[o.status] = (c[o.status] || 0) + 1));
    return c;
  }, [list.data]);
  const rows = (list.data ?? []).filter((o) => filter === 'all' || o.status === filter);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Outing Requests" subtitle="Day outings submitted by students. Approval issues a time-bound digital outpass." icon="directions_walk" />
      <div className="mb-3">
        <Tabs
          active={filter}
          onChange={setFilter}
          tabs={[
            { id: 'Pending Warden', label: 'Awaiting your decision', count: counts['Pending Warden'] ?? 0 },
            { id: 'Approved', label: 'Approved', count: counts.Approved ?? 0 },
            { id: 'Rejected', label: 'Rejected', count: counts.Rejected ?? 0 },
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
              search={(r) => `${r.studentName} ${r.regNumber} ${r.destination}`}
              onRowClick={(r) => setSelected(r.id)}
              emptyTitle={filter === 'Pending Warden' ? 'No outing requests awaiting your decision' : 'No outing requests'}
              columns={[
                { key: 'studentName', label: 'Student', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.studentName}</span> },
                { key: 'regNumber', label: 'Register Number' },
                { key: 'destination', label: 'Destination' },
                { key: 'dateTime', label: 'Departure', sortValue: (r) => r.outAt },
                { key: 'expectedReturn', label: 'Return by', sortValue: (r) => r.expectedReturnAt },
                { key: 'outingType', label: 'Type' },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {selected && (
        <OutingModal
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

const OutingModal: React.FC<{ id: string; onClose: () => void; onDone: () => void; onShowToast: WardenTabProps['onShowToast'] }> = ({ id, onClose, onDone, onShowToast }) => {
  const detail = useResource(() => http.get<StaffOuting>(`/warden/outing-requests/${id}`), [id]);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const o = detail.data;

  const decide = async (decision: 'Approved' | 'Rejected') => {
    if (decision === 'Rejected' && !remarks.trim()) return setError('Type the reason for rejecting this outing.');
    const r = await run(() => http.post(`/warden/outing-requests/${id}/decision`, { decision, remarks: remarks.trim() || undefined }));
    if (r) {
      onDone();
      onClose();
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={o ? `Outing ${o.id}` : 'Outing request'}
      description={o ? `${o.studentName} · ${o.regNumber} · Room ${o.roomNumber}` : undefined}
      onClose={onClose}
      footer={
        o?.status === 'Pending Warden' ? (
          <>
            <Button variant="danger" icon="close" loading={pending} onClick={() => decide('Rejected')}>
              Reject request
            </Button>
            <Button variant="success" icon="check" loading={pending} onClick={() => decide('Approved')}>
              Approve request
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <AsyncContent {...detail} onRetry={detail.reload}>
        {(r) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={r.status} />
              <span className="text-xs text-[var(--kv-text-muted)]">Submitted {r.submittedDateTime}</span>
            </div>
            <KeyValue
              items={[
                ['Destination', r.destination],
                ['Outing type', r.outingType],
                ['Departure', r.dateTime],
                ['Return by', r.expectedReturn],
                ['Department / year', `${r.department} · ${r.year}`],
                ['Student phone', r.studentPhone || '—'],
                ['Parent', `${r.parentName || '—'}${r.parentPhone ? ` · ${r.parentPhone}` : ''}`],
                ['Parent decision', r.parentDecision ? `${r.parentDecision}${r.parentDecidedAt ? `, ${r.parentDecidedAt}` : ''}` : 'Awaiting guardian'],
                ['Location sharing', r.tracking ? `${r.tracking.status} · last update ${r.tracking.lastUpdateDisplay}` : 'Not started'],
                ['Decision', r.decidedBy ? `${r.status} by ${r.decidedBy}, ${r.decidedAt}` : '—'],
              ]}
            />
            {r.parentNote && (
              <p className="text-sm bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">
                <span className="font-semibold">Guardian’s message:</span> {r.parentNote}
              </p>
            )}
            {r.tracking?.isInterrupted && (
              <p className="text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-3" role="status">
                Location tracking is interrupted: {r.tracking.interruptionReason ?? 'reason not reported by the device'}. Last location update: {r.tracking.lastUpdateDisplay}. Contact the student if
                necessary.
              </p>
            )}
            {(r.parentApprovals ?? []).length > 0 && (
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Guardian approval history</span>
                <ul className="mt-1 space-y-1 text-xs">
                  {(r.parentApprovals ?? []).map((a) => (
                    <li key={a.id} className="border border-[var(--kv-border-soft)] rounded-lg px-3 py-1.5">
                      {a.parentName ?? 'Guardian'} {a.parentPhoneMasked} · requested {a.requestedAt} · WhatsApp: {a.deliveryStatus}
                      {a.deliveryError ? ` (${a.deliveryError})` : ''}
                      {a.decision ? ` · ${a.decision} ${a.decidedAt ?? ''}` : ' · no answer yet'}
                      {a.note ? ` — “${a.note}”` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Reason</span>
              <p className="text-sm text-[var(--kv-heading)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 mt-1">{r.reason}</p>
            </div>
            {r.parentPhone && (
              <a href={`tel:${r.parentPhone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--kv-border)] px-3 py-1.5 text-xs font-semibold text-[var(--kv-heading)] hover:bg-[var(--kv-accent-soft)]">
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">call</span> Call parent
              </a>
            )}
            {r.status === 'Pending Warden' ? (
              <TextArea
                label="Remarks"
                hint="Required when rejecting (e.g. “Return before 6 PM and sign the log book.” when approving)."
                rows={3}
                value={remarks}
                error={error}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  setError(null);
                }}
              />
            ) : (
              r.remarks && <KeyValue items={[['Warden remarks', r.remarks]]} />
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
