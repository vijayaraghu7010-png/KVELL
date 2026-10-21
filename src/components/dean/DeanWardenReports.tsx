import React, { useState } from 'react';
import { http, qs } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { downloadCsv } from '../../services/csv';
import { AsyncContent, Badge, Button, Card, DataTable, EmptyState, FilterSelect, PageHeader, StatusBadge, Tabs, TextField, addDaysInput, todayInput } from '../common/ui';

/**
 * The Dean's Warden monitoring: student-related reports only.
 *
 * There is deliberately no Warden staff-performance view here. These are reports
 * *about students* for which the Warden is the recorded source, and the server
 * refuses any report type outside the permitted five.
 */
interface ReportMeta {
  type: string;
  title: string;
  description: string;
}

const COLUMNS: Record<string, { key: string; label: string }[]> = {
  'attendance-absence': [
    { key: 'dateDisplay', label: 'Date' },
    { key: 'session', label: 'Session' },
    { key: 'recorded', label: 'Recorded' },
    { key: 'present', label: 'Present' },
    { key: 'absent', label: 'Absent' },
    { key: 'onLeave', label: 'On leave' },
    { key: 'closedBy', label: 'Roll closed by' },
  ],
  'verified-unauthorized': [
    { key: 'date', label: 'Date' },
    { key: 'student', label: 'Student' },
    { key: 'regNumber', label: 'Reg. No' },
    { key: 'department', label: 'Dept' },
    { key: 'status', label: 'Status' },
    { key: 'verifiedBy', label: 'Verified by' },
    { key: 'note', label: 'Reason recorded' },
  ],
  'gate-movements': [
    { key: 'at', label: 'When' },
    { key: 'student', label: 'Student' },
    { key: 'regNumber', label: 'Reg. No' },
    { key: 'type', label: 'Direction' },
    { key: 'gate', label: 'Gate' },
    { key: 'result', label: 'Result' },
    { key: 'recordedBy', label: 'Scanned by' },
  ],
  'study-sessions': [
    { key: 'date', label: 'Date' },
    { key: 'title', label: 'Session' },
    { key: 'conductedBy', label: 'Conducted by' },
    { key: 'status', label: 'Status' },
    { key: 'marked', label: 'Marked' },
    { key: 'attended', label: 'Attended' },
    { key: 'absent', label: 'Absent' },
  ],
  'incidents-followups': [
    { key: 'at', label: 'When' },
    { key: 'student', label: 'Student' },
    { key: 'category', label: 'Category' },
    { key: 'severity', label: 'Severity' },
    { key: 'status', label: 'Status' },
    { key: 'reportedBy', label: 'Reported by' },
    { key: 'followUps', label: 'Follow-ups' },
  ],
};

export const DeanWardenReports: React.FC = () => {
  const index = useResource(() => http.get<{ scope: string; reports: ReportMeta[] }>('/dean/warden-reports'));
  const [type, setType] = useState('attendance-absence');
  const [from, setFrom] = useState(addDaysInput(-29));
  const [to, setTo] = useState(todayInput());
  const [department, setDepartment] = useState('');
  const depts = useResource(() => http.get<{ code: string; name: string }[]>('/meta/departments'));
  const data = useResource(() => http.get<{ title: string; description: string; rows: any[] }>(`/dean/warden-reports/${type}${qs({ from, to, department })}`), [type, from, to, department]);
  const cols = COLUMNS[type] ?? [];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Warden Reports"
        subtitle="Student-related reports for which the Warden is the recorded source. This is not a staff-performance view — the Dean monitors the Warden only through these student records."
        icon="assignment_ind"
        actions={
          <Button
            variant="secondary"
            icon="download"
            disabled={!data.data?.rows.length}
            onClick={() => downloadCsv(`${type}-${to}.csv`, cols.map((c) => ({ label: c.label, value: (r: any) => String(r[c.key] ?? '') })), data.data!.rows)}
          >
            Export CSV
          </Button>
        }
      />
      <AsyncContent {...index} onRetry={index.reload}>
        {(idx) => (
          <>
            <div className="mb-3">
              <Tabs active={type} onChange={setType} tabs={idx.reports.map((r) => ({ id: r.type, label: r.title }))} />
            </div>
            <p className="mb-3 text-xs text-[var(--kv-text-muted)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg px-4 py-2.5">{idx.reports.find((r) => r.type === type)?.description}</p>
            <Card>
              <AsyncContent {...data} onRetry={data.reload}>
                {(d) =>
                  d.rows.length === 0 ? (
                    <EmptyState icon="inbox" title="No records in this window" message="Nothing has been recorded for this report in the selected dates." />
                  ) : (
                    <DataTable
                      rows={d.rows}
                      rowKey={(r: any) => String(r.id ?? `${type}-${r.date ?? r.at ?? ''}-${r.session ?? r.student ?? ''}`)}
                      search={(r: any) => Object.values(r).join(' ')}
                      emptyTitle="No records"
                      toolbar={
                        <>
                          <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                          <FilterSelect label="Department" value={department} onChange={setDepartment} options={(depts.data ?? []).map((x) => x.code)} />
                        </>
                      }
                      columns={cols.map((c) => ({
                        key: c.key,
                        label: c.label,
                        render: (r: any) =>
                          c.key === 'status' || c.key === 'result' ? (
                            <StatusBadge status={String(r[c.key])} />
                          ) : c.key === 'severity' ? (
                            <Badge tone={r.severity === 'Critical' || r.severity === 'High' ? 'red' : 'slate'}>{r.severity}</Badge>
                          ) : c.key === 'rollClosed' ? (
                            r.rollClosed ? (
                              'Closed'
                            ) : (
                              'Open'
                            )
                          ) : (
                            String(r[c.key] ?? '—')
                          ),
                      }))}
                    />
                  )
                }
              </AsyncContent>
            </Card>
          </>
        )}
      </AsyncContent>
    </div>
  );
};
