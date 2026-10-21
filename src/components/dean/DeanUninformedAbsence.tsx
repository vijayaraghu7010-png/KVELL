import React, { useState } from 'react';
import { http, qs } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { downloadCsv } from '../../services/csv';
import { AsyncContent, Badge, Button, Card, DataTable, FilterSelect, KeyValue, Modal, PageHeader, StatCard, StatusBadge, TextField, addDaysInput, todayInput } from '../common/ui';

/**
 * C. Uninformed leave / absence — one of the three student areas the Dean monitors.
 *
 * Nothing here is inferred: each row is an absence the Warden recorded, shown beside
 * the leave requests covering that date and the gate movements for the day. Approved,
 * rejected, still-pending and unverified are kept apart rather than lumped together.
 */
interface UninformedCase {
  caseId: string | null;
  studentId: string;
  name: string;
  regNumber: string;
  department: string;
  section: string | null;
  year: string;
  roomNumber: string;
  date: string;
  dateDisplay: string;
  session: string;
  classification: string;
  verificationStatus: string;
  authorization: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  followUp: { id: string; owner: string; status: string; due: string | null } | null;
  evidence: {
    attendance: { status: string; recordedBy: string | null; recordedAt: string } | null;
    leaveRequests: { id: string; type: string; status: string; stage: string | null; from: string; to: string }[];
    gateMovements: { id: string; type: string; gate: string; at: string; result: string }[];
  };
}

interface Payload {
  period: { from: string; to: string };
  summary: {
    total: number;
    verifiedUnauthorized: number;
    suspected: number;
    awaitingVerification: number;
    leavePending: number;
    rejectedLeave: number;
    approvedLeave: number;
    resolved: number;
    repeatThreshold: number;
    repeatOffenders: { studentId: string; name: string; regNumber: string; department: string; verified: number }[];
  };
  cases: UninformedCase[];
}

const CLASSIFICATIONS = ['Verified unauthorized', 'Suspected unauthorized', 'Awaiting verification', 'Leave request pending', 'Rejected leave', 'Approved leave', 'Resolved'];

const tone = (c: string) =>
  c === 'Verified unauthorized' ? 'red' : c === 'Suspected unauthorized' ? 'amber' : c === 'Approved leave' || c === 'Resolved' ? 'green' : c === 'Rejected leave' ? 'red' : 'slate';

export const DeanUninformedAbsence: React.FC<{ onShowToast: (m: string, e?: boolean) => void }> = () => {
  const [from, setFrom] = useState(addDaysInput(-29));
  const [to, setTo] = useState(todayInput());
  const [department, setDepartment] = useState('');
  const [classification, setClassification] = useState('');
  const [open, setOpen] = useState<UninformedCase | null>(null);
  const depts = useResource(() => http.get<{ code: string; name: string }[]>('/meta/departments'));
  const data = useResource(() => http.get<Payload>(`/dean/uninformed-absence${qs({ from, to, department, classification })}`), [from, to, department, classification]);
  const s = data.data?.summary;

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Uninformed Leave & Absence"
        subtitle="Students absent without the required approval, with the evidence behind each case: the roll-call record, any leave request covering the date and its approval stage, and that day's gate movements."
        icon="person_off"
        actions={
          <Button
            variant="secondary"
            icon="download"
            disabled={!data.data?.cases.length}
            onClick={() =>
              downloadCsv(
                `uninformed-absence-${to}.csv`,
                [
                  { label: 'Date', value: (r: UninformedCase) => r.dateDisplay },
                  { label: 'Student', value: (r) => r.name },
                  { label: 'Reg. No', value: (r) => r.regNumber },
                  { label: 'Department', value: (r) => r.department },
                  { label: 'Section', value: (r) => r.section ?? '' },
                  { label: 'Classification', value: (r) => r.classification },
                  { label: 'Verification', value: (r) => r.verificationStatus },
                  { label: 'Verified by', value: (r) => r.verifiedBy ?? '' },
                  { label: 'Leave requests', value: (r) => r.evidence.leaveRequests.map((l) => `${l.id}:${l.status}`).join(' ') },
                  { label: 'Follow-up', value: (r) => (r.followUp ? `${r.followUp.owner} (${r.followUp.status})` : '') },
                ],
                data.data!.cases,
              )
            }
          >
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Verified unauthorized" value={s?.verifiedUnauthorized ?? '—'} icon="gavel" tone="red" />
        <StatCard label="Suspected, not yet verified" value={s ? s.suspected + s.awaitingVerification : '—'} icon="help" tone="amber" />
        <StatCard label="Leave still pending" value={s?.leavePending ?? '—'} icon="hourglass_top" hint="A decision was outstanding — not an unauthorized absence." />
        <StatCard label="Covered by approved leave" value={s?.approvedLeave ?? '—'} icon="verified" tone="green" />
      </div>

      {s && s.repeatOffenders.length > 0 && (
        <Card title={`Repeated unauthorized absence (${s.repeatThreshold}+ verified in this window)`} className="mb-4">
          <ul className="text-sm space-y-1">
            {s.repeatOffenders.map((r) => (
              <li key={r.studentId} className="flex justify-between border border-[var(--kv-border-soft)] rounded-lg px-3 py-1.5">
                <span className="font-semibold text-[var(--kv-heading)]">
                  {r.name} <span className="font-normal text-[var(--kv-text-muted)]">{r.regNumber} · {r.department}</span>
                </span>
                <Badge tone="red">{r.verified} verified</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <AsyncContent {...data} onRetry={data.reload}>
          {(d) => (
            <DataTable
              rows={d.cases}
              rowKey={(r) => `${r.caseId ?? r.studentId}-${r.date}-${r.session}`}
              search={(r) => `${r.name} ${r.regNumber} ${r.department}`}
              onRowClick={(r) => setOpen(r)}
              emptyTitle="No absence cases in this window"
              toolbar={
                <>
                  <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  <FilterSelect label="Department" value={department} onChange={setDepartment} options={(depts.data ?? []).map((x) => x.code)} />
                  <FilterSelect label="Classification" value={classification} onChange={setClassification} options={CLASSIFICATIONS} />
                </>
              }
              columns={[
                { key: 'dateDisplay', label: 'Date', sortValue: (r) => r.date, render: (r) => `${r.dateDisplay} · ${r.session}` },
                {
                  key: 'name',
                  label: 'Student',
                  render: (r) => (
                    <span className="block">
                      <span className="block font-semibold text-[var(--kv-heading)]">{r.name}</span>
                      <span className="block text-[11px] text-[var(--kv-text-muted)]">
                        {r.regNumber} · {r.department}
                        {r.section ? ` · Section ${r.section}` : ''}
                      </span>
                    </span>
                  ),
                },
                { key: 'classification', label: 'Classification', render: (r) => <Badge tone={tone(r.classification)}>{r.classification}</Badge> },
                { key: 'verificationStatus', label: 'Warden verification', render: (r) => <StatusBadge status={r.verificationStatus} /> },
                {
                  key: 'evidence',
                  label: 'Evidence',
                  render: (r) => (
                    <span className="text-[11px] text-[var(--kv-text-muted)]">
                      {r.evidence.leaveRequests.length} leave · {r.evidence.gateMovements.length} gate scan(s)
                    </span>
                  ),
                },
                { key: 'followUp', label: 'Follow-up', render: (r) => (r.followUp ? `${r.followUp.owner} (${r.followUp.status})` : <span className="text-[var(--kv-text-muted)]">None</span>) },
              ]}
            />
          )}
        </AsyncContent>
      </Card>

      {open && (
        <Modal open size="lg" title={`${open.name} · ${open.dateDisplay}`} description={`${open.regNumber} · ${open.department}${open.section ? ` · Section ${open.section}` : ''}`} onClose={() => setOpen(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={tone(open.classification)}>{open.classification}</Badge>
              <StatusBadge status={open.verificationStatus} />
            </div>
            <KeyValue
              items={[
                ['Session', open.session],
                ['Room', open.roomNumber],
                ['Authorization on file', open.authorization ?? 'None'],
                ['Verified by', open.verifiedBy ? `${open.verifiedBy}${open.verifiedAt ? `, ${open.verifiedAt}` : ''}` : 'Not verified'],
                ['Follow-up', open.followUp ? `${open.followUp.owner} · ${open.followUp.status}${open.followUp.due ? ` · due ${open.followUp.due}` : ''}` : 'None assigned'],
              ]}
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Roll-call record</p>
              <p className="text-sm text-[var(--kv-heading)]">
                {open.evidence.attendance
                  ? `${open.evidence.attendance.status} — recorded by ${open.evidence.attendance.recordedBy ?? 'unknown'} on ${open.evidence.attendance.recordedAt}`
                  : 'No roll-call record for this date and session.'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Leave requests covering this date</p>
              {open.evidence.leaveRequests.length === 0 ? (
                <p className="text-sm text-[var(--kv-text-muted)]">None — no leave was requested for this date.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {open.evidence.leaveRequests.map((l) => (
                    <li key={l.id} className="border border-[var(--kv-border-soft)] rounded-lg px-3 py-1.5">
                      <span className="font-mono text-xs">{l.id}</span> · {l.type} · {l.from} → {l.to} · <StatusBadge status={l.status} />
                      {l.stage ? <span className="text-[var(--kv-text-muted)]"> (rejected at the {l.stage} stage)</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">Gate movements that day</p>
              {open.evidence.gateMovements.length === 0 ? (
                <p className="text-sm text-[var(--kv-text-muted)]">No gate scans recorded.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {open.evidence.gateMovements.map((g) => (
                    <li key={g.id} className="border border-[var(--kv-border-soft)] rounded-lg px-3 py-1.5">
                      {g.type} at {g.gate} · {g.at} · <Badge tone={g.result === 'Approved' ? 'green' : 'amber'}>{g.result}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-[11px] text-[var(--kv-text-muted)]">
              This view is read-only. Act on a case by assigning a follow-up to the responsible Adviser, HOD or Warden.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
};
