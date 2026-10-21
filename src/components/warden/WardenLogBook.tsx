import React, { useState } from 'react';
import type { WardenTabProps } from './WardenPortal';
import { downloadFile, errorMessage, http, qs } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { downloadCsv } from '../../services/csv';
import { AsyncContent, Badge, Button, Card, DataTable, FilterSelect, PageHeader, StatusBadge, Tabs, addDaysInput, todayInput } from '../common/ui';

interface LogRow {
  id: string;
  dateTime: string;
  date: string;
  time: string;
  studentName: string;
  regNumber: string;
  parentNumber: string;
  roomNumber: string;
  department: string;
  year: string;
  destination: string;
  leaveType: string;
  category: 'Leave' | 'Outing';
  approvedBy: string;
  approvedOn: string;
  outTime: string;
  expectedReturn: string;
  returnedAt: string | null;
  inTime: string;
  parentApproval: string;
  leaveDuration?: string;
  passStatus: string;
  isOverdueReturn: boolean;
  sourceId: string;
}

interface Movement {
  id: string;
  name: string;
  regNumber: string;
  type: 'Entry' | 'Exit';
  gate: string;
  destination: string;
  roomNo: string;
  date: string;
  time: string;
  status: string;
  notes?: string;
  outpassId?: string;
  recordedBy?: string;
}

export const WardenLogBook: React.FC<WardenTabProps> = ({ onShowToast }) => {
  const [view, setView] = useState('passes');
  const [from, setFrom] = useState(addDaysInput(-30));
  const [category, setCategory] = useState('');
  const [passStatus, setPassStatus] = useState('');
  const logs = useResource(() => http.get<LogRow[]>(`/warden/log-book${qs({ from })}`), [from]);
  const moves = useResource(() => http.getRaw<Movement[]>(`/security/movements${qs({ limit: 500, from })}`).then((r) => r.data), [from]);

  const rows = (logs.data ?? []).filter((r) => (!category || r.category === category) && (!passStatus || (passStatus === 'Overdue' ? r.isOverdueReturn : r.passStatus === passStatus)));

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Hostel Log Book"
        subtitle="Approved leave and outing passes with their real gate check-out and return times."
        icon="menu_book"
        actions={
          <>
            <Button
              variant="secondary"
              icon="download"
              onClick={() =>
                view === 'passes'
                  ? downloadCsv(
                      `hostel-log-book-${todayInput()}.csv`,
                      [
                        { label: 'Date', value: (r: LogRow) => r.date },
                        { label: 'Time', value: (r) => r.time },
                        { label: 'Student', value: (r) => r.studentName },
                        { label: 'Register No', value: (r) => r.regNumber },
                        { label: 'Parent number', value: (r) => r.parentNumber },
                        { label: 'Type', value: (r) => r.category },
                        { label: 'Destination / reason', value: (r) => r.destination },
                        { label: 'Exit time (gate scan)', value: (r) => r.outTime },
                        { label: 'In time (gate scan)', value: (r) => r.inTime },
                      ],
                      rows,
                    )
                  : downloadFile(`/security/movements/export${qs({ from })}`, 'gate-movements.csv').catch((e) => onShowToast(errorMessage(e), true))
              }
            >
              Export CSV
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'passes', label: 'Approved passes', count: logs.data?.length },
            { id: 'gate', label: 'Gate scans', count: moves.data?.length },
          ]}
        />
        <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1">
          Since
          <input type="date" value={from} max={todayInput()} onChange={(e) => e.target.value && setFrom(e.target.value)} className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm text-[var(--kv-heading)] bg-white" />
        </label>
      </div>
      <Card>
        {view === 'passes' ? (
          <AsyncContent {...logs} onRetry={logs.reload}>
            {() => (
              <DataTable
                rows={rows}
                rowKey={(r) => r.id}
                search={(r) => `${r.studentName} ${r.regNumber} ${r.parentNumber} ${r.destination}`}
                emptyTitle="No approved passes in this period"
                toolbar={
                  <>
                    <FilterSelect label="Type" value={category} onChange={setCategory} options={['Leave', 'Outing']} />
                    <FilterSelect label="Pass status" value={passStatus} onChange={setPassStatus} options={['Active', 'Out', 'Completed', 'Expired', 'Overdue']} />
                  </>
                }
                columns={[
                  { key: 'date', label: 'Date', sortValue: (r) => r.dateTime, render: (r) => <span className="whitespace-nowrap">{r.date}</span> },
                  { key: 'time', label: 'Time', render: (r) => <span className="whitespace-nowrap">{r.time}</span> },
                  { key: 'studentName', label: 'Student', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.studentName}</span> },
                  { key: 'regNumber', label: 'Register No' },
                  { key: 'parentNumber', label: 'Parent number', render: (r) => <span className="whitespace-nowrap">{r.parentNumber}</span> },
                  { key: 'category', label: 'Type', render: (r) => <Badge tone={r.category === 'Leave' ? 'green' : 'amber'}>{r.category}</Badge> },
                  { key: 'destination', label: 'Destination / reason' },
                  { key: 'outTime', label: 'Exit time', render: (r) => <span className="whitespace-nowrap">{r.outTime}</span> },
                  { key: 'inTime', label: 'In time', render: (r) => <span className="whitespace-nowrap">{r.inTime}</span> },
                ]}
              />
            )}
          </AsyncContent>
        ) : (
          <AsyncContent {...moves} onRetry={moves.reload}>
            {(m) => (
              <DataTable
                rows={m}
                rowKey={(r) => r.id}
                search={(r) => `${r.name} ${r.regNumber} ${r.gate}`}
                emptyTitle="No gate scans in this period"
                columns={[
                  { key: 'date', label: 'Date' },
                  { key: 'time', label: 'Time' },
                  { key: 'type', label: 'Movement', render: (r) => <Badge tone={r.type === 'Entry' ? 'green' : 'blue'}>{r.type}</Badge> },
                  { key: 'name', label: 'Student' },
                  { key: 'regNumber', label: 'Register No' },
                  { key: 'gate', label: 'Gate' },
                  { key: 'status', label: 'Result', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'notes', label: 'Notes', render: (r) => <span className="text-xs text-[var(--kv-text-muted)]">{r.notes ?? '—'}</span> },
                ]}
              />
            )}
          </AsyncContent>
        )}
      </Card>
    </div>
  );
};
