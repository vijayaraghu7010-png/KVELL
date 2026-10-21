import React, { useMemo, useState } from 'react';
import type { WardenTabProps } from './WardenPortal';
import type { HistoryEntry } from '../../types';
import { http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { Attachments } from '../common/Attachments';
import { AsyncContent, Badge, Button, Card, DataTable, KeyValue, Modal, PageHeader, Tabs, TextArea, Timeline, StatusBadge } from '../common/ui';

export interface StaffLeave {
  id: string;
  studentId: string;
  name: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  leaveType: string;
  reason: string;
  fromDate: string;
  toDate: string;
  dateRange: string;
  days: number;
  submittedDateTime: string;
  workflowStatus: 'Pending Class Incharge' | 'Pending HOD' | 'Pending Warden' | 'Approved' | 'Rejected' | 'Cancelled';
  canDecide?: boolean;
  pendingWith?: string | null;
  section?: string | null;
  approvals?: { stage: string; by: string | null; decision: string | null; atDisplay?: string; remarks: string | null }[];
  hasDocument: boolean;
  documentName?: string;
  parentName: string;
  parentNumber: string;
  addressDuringLeave: string;
  parentApproved: boolean;
  parentApprovalDate?: string;
  parentConfirmedBy?: string;
  classInchargeName?: string;
  classInchargeDecision?: string;
  classInchargeRemarks?: string;
  classInchargeDecidedAt?: string;
  hodName?: string;
  hodDecision?: string;
  hodRemarks?: string;
  hodDecidedAt?: string;
  wardenRemarks?: string;
  wardenName?: string;
  wardenDecidedAt?: string;
  history?: HistoryEntry[];
}

export const WardenLeaveRequests: React.FC<WardenTabProps> = ({ onShowToast, onChanged }) => {
  const list = useResource(() => http.get<StaffLeave[]>('/warden/leave-requests'));
  const [filter, setFilter] = useState('Pending Warden');
  const [selected, setSelected] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (list.data ?? []).forEach((l) => (c[l.workflowStatus] = (c[l.workflowStatus] || 0) + 1));
    return c;
  }, [list.data]);
  const rows = (list.data ?? []).filter((l) => filter === 'all' || l.workflowStatus === filter);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Leave Requests"
        subtitle="Final stage of the chain: a request reaches you only after its Class Incharge and the HOD have approved. Your approval issues the student's digital outpass."
        icon="description"
      />
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
              search={(r) => `${r.name} ${r.regNumber} ${r.id} ${r.reason}`}
              onRowClick={(r) => setSelected(r.id)}
              emptyTitle={filter === 'Pending Warden' ? 'Nothing awaiting your decision' : 'No leave requests'}
              columns={[
                { key: 'name', label: 'Student', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span> },
                { key: 'regNumber', label: 'Register Number' },
                { key: 'department', label: 'Department' },
                { key: 'dateRange', label: 'Dates', sortValue: (r) => r.fromDate, render: (r) => `${r.dateRange} (${r.days}d)` },
                { key: 'leaveType', label: 'Type' },
                { key: 'parentApproved', label: 'Parent', render: (r) => (r.parentApproved ? <Badge tone="green">Confirmed</Badge> : <Badge tone="slate">Not recorded</Badge>) },
                { key: 'workflowStatus', label: 'Status', render: (r) => <StatusBadge status={r.workflowStatus} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {selected && (
        <LeaveDecisionModal
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

const LeaveDecisionModal: React.FC<{ id: string; onClose: () => void; onDone: () => void; onShowToast: WardenTabProps['onShowToast'] }> = ({ id, onClose, onDone, onShowToast }) => {
  const detail = useResource(() => http.get<StaffLeave>(`/warden/leave-requests/${id}`), [id]);
  const [remarks, setRemarks] = useState('');
  const [remarksError, setRemarksError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const l = detail.data;

  const decide = async (decision: 'Approved' | 'Rejected') => {
    if (decision === 'Rejected' && !remarks.trim()) return setRemarksError('Give the student a reason for the rejection.');
    const r = await run(() => http.post(`/warden/leave-requests/${id}/decision`, { decision, remarks: remarks.trim() || undefined }));
    if (r) {
      onDone();
      onClose();
    }
  };
  const confirmParent = async (confirmed: boolean) => {
    const r = await run(() => http.post(`/warden/leave-requests/${id}/parent-confirmation`, { confirmed, note: confirmed ? 'Verbal consent recorded by Warden office' : 'Cleared by Warden office' }));
    if (r) {
      detail.reload();
      onDone();
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={l ? `Leave ${l.id}` : 'Leave request'}
      description={l ? `${l.name} · ${l.regNumber} · Room ${l.roomNumber}` : undefined}
      onClose={onClose}
      footer={
        l?.workflowStatus === 'Pending Warden' ? (
          <>
            <Button variant="danger" icon="close" loading={pending} onClick={() => decide('Rejected')}>
              Reject request
            </Button>
            <Button variant="success" icon="check" loading={pending} onClick={() => decide('Approved')}>
              Approve & issue outpass
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
              <StatusBadge status={r.workflowStatus} />
              <span className="text-xs text-[var(--kv-text-muted)]">Submitted {r.submittedDateTime}</span>
            </div>
            <KeyValue
              items={[
                ['Leave type', r.leaveType],
                ['Dates', `${r.dateRange} (${r.days} day${r.days === 1 ? '' : 's'})`],
                ['Department / year', `${r.department} · ${r.year}`],
                ['Address during leave', r.addressDuringLeave || '—'],
                ['Section', r.section ? `Section ${r.section}` : '—'],
                [
                  'Class Incharge',
                  r.classInchargeDecision
                    ? `${r.classInchargeDecision} by ${r.classInchargeName}${r.classInchargeDecidedAt ? `, ${r.classInchargeDecidedAt}` : ''}`
                    : `Awaiting ${r.classInchargeName ?? 'the Class Incharge'}`,
                ],
                ['Class Incharge remarks', r.classInchargeRemarks || '—'],
                ['HOD', r.hodDecision ? `${r.hodDecision} by ${r.hodName}${r.hodDecidedAt ? `, ${r.hodDecidedAt}` : ''}` : 'Awaiting the HOD'],
                ['HOD remarks', r.hodRemarks || '—'],
              ]}
            />
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Reason</span>
              <p className="text-sm text-[var(--kv-heading)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 mt-1 whitespace-pre-wrap">{r.reason}</p>
            </div>

            <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--kv-heading)]">Parent verification</span>
                {r.parentApproved ? <Badge tone="green">Confirmed{r.parentConfirmedBy ? ` by ${r.parentConfirmedBy}` : ''}</Badge> : <Badge tone="amber">Not recorded</Badge>}
              </div>
              <p className="text-xs text-[var(--kv-text-muted)]">
                {r.parentName || 'Parent'} · {r.parentNumber || 'no number on file'}
                {r.parentApprovalDate ? ` · ${r.parentApprovalDate}` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {r.parentNumber && (
                  <a href={`tel:${r.parentNumber.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--kv-border)] px-3 py-1.5 text-xs font-semibold text-[var(--kv-heading)] hover:bg-[var(--kv-accent-soft)]">
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">call</span> Call parent
                  </a>
                )}
                {['Pending Class Incharge', 'Pending HOD', 'Pending Warden'].includes(r.workflowStatus) &&
                  (r.parentApproved ? (
                    <Button size="sm" variant="ghost" onClick={() => confirmParent(false)} loading={pending}>
                      Clear confirmation
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" icon="record_voice_over" onClick={() => confirmParent(true)} loading={pending}>
                      Log verbal consent
                    </Button>
                  ))}
              </div>
            </div>

            <Attachments entityType="leave_request" entityId={r.id} onToast={onShowToast} label="Supporting document" />

            {r.workflowStatus === 'Pending Warden' && (
              <TextArea
                label="Remarks to the student"
                hint="Required when rejecting. Shown on the outpass when approving."
                rows={3}
                value={remarks}
                error={remarksError}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  setRemarksError(null);
                }}
              />
            )}
            {r.wardenRemarks && (
              <KeyValue
                items={[
                  ['Warden decision by', r.wardenName ?? '—'],
                  ['Warden remarks', r.wardenRemarks],
                ]}
              />
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
