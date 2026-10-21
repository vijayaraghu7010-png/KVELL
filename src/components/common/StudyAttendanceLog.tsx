import React, { useMemo, useState } from 'react';
import { http, qs } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { AsyncContent, Badge, Card, DataTable, PageHeader, SelectField, StatCard, addDaysInput, clock12, todayInput } from './ui';

interface LogRow {
  sessionId: string;
  sessionTitle: string;
  date: string;
  dateDisplay: string;
  startTime: string;
  endTime: string;
  location: string;
  adviserName: string;
  studentId: string;
  name: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  status: string;
  source: string | null;
  scannedAtDisplay: string | null;
  endScanDisplay: string | null;
  remarks: string;
}

interface LogData {
  from: string;
  to: string;
  rows: LogRow[];
  totals: { marked: number; present: number; absent: number; sessions: number; participationPct: number | null };
}

/** What the row has to say beyond its status, in the reader's words. */
const note = (r: LogRow): string => {
  if (r.remarks) return r.remarks;
  if (r.status === 'Pending Reconciliation') return 'Waiting for a scan';
  if (r.source === 'QR Scan') return r.endScanDisplay ? `End check ${r.endScanDisplay}` : 'Scanned the session QR';
  return '—';
};

const STATUS_TONE: Record<string, 'green' | 'red' | 'amber' | 'slate'> = {
  Present: 'green',
  Late: 'amber',
  Absent: 'red',
  Excused: 'slate',
  'Pending Reconciliation': 'amber',
};

/**
 * The study-session attendance log, one row per student per session.
 *
 * The same screen serves the Dean and the Hosteller Adviser; the server decides
 * which sessions each of them may read, so nothing here is portal-specific beyond
 * the wording of the subtitle.
 */
export const StudyAttendanceLog: React.FC<{ title?: string; subtitle?: string; showDepartment?: boolean; embedded?: boolean }> = ({
  title = 'Study Attendance Log',
  subtitle = 'Every study-session attendance record, as the scans left it.',
  showDepartment = true,
  embedded = false,
}) => {
  const [from, setFrom] = useState(addDaysInput(-29));
  const [to, setTo] = useState(todayInput());
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const data = useResource(() => http.get<LogData>(`/study/attendance-log${qs({ from, to, status, department })}`), [from, to, status, department]);
  const rows = data.data?.rows ?? [];
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort(), [rows]);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Under the Dean's own tabs the page already has a heading; a second one would only repeat it. */}
      {embedded ? <p className="mb-4 text-sm text-[var(--kv-text-muted)]">{subtitle}</p> : <PageHeader title={title} subtitle={subtitle} icon="fact_check" />}

      <Card className="mb-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm bg-[var(--kv-surface)]"
            />
          </label>
          <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1">
            To
            <input
              type="date"
              value={to}
              min={from}
              max={todayInput()}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm bg-[var(--kv-surface)]"
            />
          </label>
          <SelectField
            label="Attendance"
            value={status}
            placeholder="Every status"
            onChange={(e) => setStatus(e.target.value)}
            options={['Present', 'Late', 'Absent', 'Excused', 'Pending Reconciliation']}
          />
          {showDepartment && (
            <SelectField label="Department" value={department} placeholder="All departments" onChange={(e) => setDepartment(e.target.value)} options={departments} />
          )}
        </div>
      </Card>

      <AsyncContent {...data} onRetry={data.reload}>
        {(d) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Sessions" value={d.totals.sessions} icon="menu_book" />
              <StatCard label="Records" value={d.totals.marked} icon="fact_check" tone="slate" />
              <StatCard label="Present" value={d.totals.present} icon="how_to_reg" tone="green" />
              <StatCard label="Absent" value={d.totals.absent} icon="person_off" tone="red" hint={d.totals.participationPct !== null ? `${d.totals.participationPct}% participation` : undefined} />
            </div>

            <Card>
              <DataTable
                rows={d.rows}
                rowKey={(r) => `${r.sessionId}:${r.studentId}`}
                search={(r) => `${r.name} ${r.regNumber} ${r.sessionId} ${r.department} ${r.roomNumber}`}
                emptyTitle="No attendance records"
                emptyMessage="No study session in this period has marked anybody yet."
                columns={[
                  {
                    key: 'date',
                    label: 'Session',
                    sortValue: (r) => `${r.date} ${r.startTime}`,
                    render: (r) => (
                      <div>
                        <span className="font-semibold text-[var(--kv-heading)]">{r.dateDisplay}</span>
                        <div className="text-[11px] text-[var(--kv-text-muted)]">
                          {clock12(r.startTime)}–{clock12(r.endTime)} · {r.location}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'name',
                    label: 'Student',
                    render: (r) => (
                      <div>
                        <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span>
                        <div className="text-[11px] text-[var(--kv-text-muted)]">
                          {r.regNumber} · {r.department} · Room {r.roomNumber}
                        </div>
                      </div>
                    ),
                  },
                  { key: 'adviserName', label: 'Conducted by' },
                  {
                    key: 'status',
                    label: 'Attendance',
                    render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'slate'}>{r.status}</Badge>,
                  },
                  {
                    key: 'scannedAtDisplay',
                    label: 'Scanned',
                    render: (r) => r.scannedAtDisplay ?? <span className="text-[var(--kv-text-muted)]">—</span>,
                  },
                  {
                    key: 'remarks',
                    label: 'Note',
                    render: (r) => <span className="text-xs text-[var(--kv-text-muted)]">{note(r)}</span>,
                  },
                ]}
              />
            </Card>
          </div>
        )}
      </AsyncContent>
    </div>
  );
};
