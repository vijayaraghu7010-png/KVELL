import React, { useMemo, useState } from 'react';
import type { WardenTabProps } from './WardenPortal';
import { http, qs } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { queryParam } from '../../hooks/usePortalRoute';
import { AbsenceCases } from '../common/AbsenceCases';
import { AsyncContent, Badge, Button, Card, ConfirmDialog, DataTable, FilterSelect, Modal, PageHeader, StatCard, StatusBadge, Tabs, todayInput } from '../common/ui';

type AttStatus = 'Present' | 'Absent' | 'On Leave' | 'On Outing';
interface RollRow {
  studentId: string;
  name: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  block: string;
  status: AttStatus | 'Not Recorded';
  method: string | null;
  remarks: string;
  recordedAt: string | null;
  recordedBy: string | null;
  absenceCaseId: string | null;
  absenceStatus: string | null;
  authorization: string | null;
}
interface Roll {
  date: string;
  session: string;
  closed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  students: RollRow[];
  summary: { expected: number; present: number; absent: number; onLeave: number; onOuting: number; notRecorded: number };
}

/** Statuses the Warden can set by hand. "On Leave" is derived from approved leave, not picked here. */
const STATUSES: AttStatus[] = ['Present', 'Absent', 'On Outing'];

export const WardenAttendance: React.FC<WardenTabProps> = ({ onShowToast, onChanged }) => {
  const caseFromLink = queryParam('case');
  const [view, setView] = useState(caseFromLink ? 'absences' : 'roll');
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Attendance & Absences" subtitle="Record the nightly roll call and verify absences against approved leave, outings and gate records." icon="how_to_reg" />
      <div className="mb-4">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'roll', label: 'Roll call' },
            { id: 'absences', label: 'Absence verification' },
          ]}
        />
      </div>
      {view === 'roll' ? <RollCall onShowToast={onShowToast} onChanged={onChanged} /> : <AbsenceCases onShowToast={onShowToast} initialCaseId={caseFromLink} onChanged={onChanged} />}
    </div>
  );
};

const RollCall: React.FC<WardenTabProps> = ({ onShowToast, onChanged }) => {
  const [date, setDate] = useState(todayInput());
  const roll = useResource(() => http.get<Roll>(`/attendance/roll${qs({ date })}`), [date]);
  const [changes, setChanges] = useState<Record<string, AttStatus>>({});
  const [block, setBlock] = useState('');
  const [dept, setDept] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [historyFor, setHistoryFor] = useState<RollRow | null>(null);
  const { run, pending } = useAction(onShowToast);

  const r = roll.data;
  const effective = (s: RollRow) => changes[s.studentId] ?? s.status;
  const rows = useMemo(
    () => (r?.students ?? []).filter((s) => (!block || s.block === block) && (!dept || s.department === dept) && (!statusFilter || effective(s) === statusFilter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, block, dept, statusFilter, changes],
  );
  const pendingCount = Object.keys(changes).length;

  const save = async () => {
    const entries = Object.entries(changes).map(([studentId, status]) => ({ studentId, status }));
    const res = await run(() => http.post('/attendance/mark', { date, session: r?.session, entries }));
    if (res) {
      setChanges({});
      roll.reload();
      onChanged();
    }
  };

  const markUnrecordedPresent = () => {
    const next = { ...changes };
    (r?.students ?? []).forEach((s) => {
      if (s.status === 'Not Recorded' && !next[s.studentId]) next[s.studentId] = 'Present';
    });
    setChanges(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1">
          Date
          <input
            type="date"
            value={date}
            max={todayInput()}
            onChange={(e) => {
              if (!e.target.value) return;
              if (pendingCount && !window.confirm('Discard unsaved attendance changes?')) return;
              setChanges({});
              setDate(e.target.value);
            }}
            className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm text-[var(--kv-heading)] bg-white"
          />
        </label>
        {r && (
          <div className="text-sm text-[var(--kv-heading)] pb-2">
            <strong>{r.session}</strong> · {r.closed ? <Badge tone="slate">Closed by {r.closedBy}</Badge> : <Badge tone="green">Open</Badge>}
          </div>
        )}
        <div className="flex-1" />
        <Button variant="secondary" icon="done_all" disabled={!r?.summary.notRecorded || r.closed} onClick={markUnrecordedPresent}>
          Mark unrecorded as present
        </Button>
        <Button icon="save" disabled={!pendingCount || !!r?.closed} loading={pending} onClick={save}>
          Save {pendingCount ? `(${pendingCount})` : ''}
        </Button>
        <Button variant="secondary" icon="lock" disabled={!r || r.closed || pendingCount > 0} onClick={() => setConfirmClose(true)} title={pendingCount ? 'Save changes first' : undefined}>
          Close roll call
        </Button>
      </div>

      {r && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatCard label="Expected" value={r.summary.expected} />
          <StatCard label="Present" value={r.summary.present} tone="green" />
          <StatCard label="Absent" value={r.summary.absent} tone="red" />
          <StatCard label="On outing" value={r.summary.onOuting} tone="amber" />
          <StatCard label="Not recorded" value={r.summary.notRecorded} tone="slate" hint="Missing information — not an absence" />
        </div>
      )}

      <Card>
        <AsyncContent {...roll} onRetry={roll.reload}>
          {(data) => (
            <DataTable
              rows={rows}
              rowKey={(s) => s.studentId}
              pageSize={15}
              search={(s) => `${s.name} ${s.regNumber} ${s.roomNumber}`}
              emptyTitle="No hostel residents match"
              toolbar={
                <>
                  <FilterSelect label="Block" value={block} onChange={setBlock} options={[...new Set(data.students.map((s) => s.block).filter(Boolean))].sort()} />
                  <FilterSelect label="Department" value={dept} onChange={setDept} options={[...new Set(data.students.map((s) => s.department))].sort()} />
                  <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[...STATUSES, 'Not Recorded']} />
                </>
              }
              columns={[
                { key: 'name', label: 'Student', render: (s) => <span className="font-semibold text-[var(--kv-heading)]">{s.name}</span> },
                { key: 'regNumber', label: 'Register No.' },
                { key: 'roomNumber', label: 'Room', render: (s) => `${s.roomNumber}${s.block ? ` · ${s.block}` : ''}` },
                { key: 'department', label: 'Dept / Year', render: (s) => `${s.department} · ${s.year}` },
                {
                  key: 'status',
                  label: 'Status',
                  sortValue: (s) => effective(s),
                  render: (s) => (
                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`att-${s.studentId}`}>
                        Attendance for {s.name}
                      </label>
                      <select
                        id={`att-${s.studentId}`}
                        disabled={!!r?.closed}
                        title={r?.closed ? 'The roll call is closed. A student on outing is set to present by their own gate scan on return.' : undefined}
                        value={effective(s)}
                        onChange={(e) => {
                          const v = e.target.value as AttStatus | 'Not Recorded';
                          setChanges((prev) => {
                            const next = { ...prev };
                            if (v === s.status || v === 'Not Recorded') delete next[s.studentId];
                            else next[s.studentId] = v as AttStatus;
                            return next;
                          });
                        }}
                        className={`border rounded-md px-2 py-1.5 text-sm bg-white ${r?.closed ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${changes[s.studentId] ? 'border-[var(--kv-primary)] ring-2 ring-[var(--kv-primary)]/15' : 'border-[var(--kv-border)]'}`}
                      >
                        {s.status === 'Not Recorded' && <option value="Not Recorded">Not recorded</option>}
                        {/* Keeps an already-recorded value (e.g. an older "On Leave") selectable in the box. */}
                        {s.status !== 'Not Recorded' && !STATUSES.includes(effective(s) as AttStatus) && <option value={effective(s)}>{effective(s)}</option>}
                        {STATUSES.map((st) => (
                          <option key={st}>{st}</option>
                        ))}
                      </select>
                      {changes[s.studentId] && <Badge tone="blue">Unsaved</Badge>}
                    </div>
                  ),
                },
                {
                  key: 'absenceStatus',
                  label: 'Absence record',
                  render: (s) => (s.absenceStatus ? <StatusBadge status={s.absenceStatus} /> : s.authorization ? <span className="text-xs text-[var(--kv-text-muted)]">{s.authorization}</span> : '—'),
                },
                {
                  key: 'history',
                  label: 'History',
                  render: (s) => (
                    <Button size="sm" variant="ghost" icon="history" onClick={() => setHistoryFor(s)}>
                      <span className="sr-only">Attendance history for {s.name}</span>
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </AsyncContent>
      </Card>

      <ConfirmDialog
        open={confirmClose}
        title={`Close ${r?.session ?? 'roll call'}`}
        message="Once closed, recorded attendance can no longer be changed — only a student marked “On Outing” is switched to present automatically when they scan back in at the hostel gate. Unexplained absences still awaiting verification will be marked “Suspected Unauthorized” (as configured)."
        confirmLabel="Close roll call"
        reasonLabel="Note (optional)"
        pending={pending}
        onClose={() => setConfirmClose(false)}
        onConfirm={async (note) => {
          const res = await run(() => http.post('/attendance/close', { date, session: r?.session, note: note || undefined }));
          setConfirmClose(false);
          if (res) {
            roll.reload();
            onChanged();
          }
        }}
      />
      {historyFor && <StudentHistory row={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
};

const StudentHistory: React.FC<{ row: RollRow; onClose: () => void }> = ({ row, onClose }) => {
  const h = useResource(
    () =>
      http.get<{ records: { date: string; dateDisplay: string; session: string; status: string; recordedBy: string | null; remarks: string | null }[]; summary: { recorded: number; present: number; absent: number; attendancePct: number | null } }>(
        `/attendance/students/${row.studentId}`,
      ),
    [row.studentId],
  );
  return (
    <Modal open title={`${row.name} — attendance`} description={`${row.regNumber} · Room ${row.roomNumber}`} onClose={onClose}>
      <AsyncContent {...h} onRetry={h.reload}>
        {(d) => (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Recorded" value={d.summary.recorded} />
              <StatCard label="Present" value={d.summary.present} tone="green" />
              <StatCard label="Rate" value={d.summary.attendancePct === null ? '—' : `${d.summary.attendancePct}%`} tone="violet" />
            </div>
            <DataTable
              rows={d.records}
              rowKey={(x) => `${x.date}-${x.session}`}
              pageSize={8}
              emptyTitle="No attendance recorded"
              columns={[
                { key: 'dateDisplay', label: 'Date', sortValue: (x) => x.date },
                { key: 'status', label: 'Status', render: (x) => <StatusBadge status={x.status} /> },
                { key: 'recordedBy', label: 'Recorded by', render: (x) => x.recordedBy ?? '—' },
              ]}
            />
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};
