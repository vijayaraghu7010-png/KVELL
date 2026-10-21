import React, { useMemo, useState } from 'react';
import type { StudentRecord } from '../../types';
import { http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { useAuth } from '../../auth/AuthContext';
import { AsyncContent, Badge, Button, Card, DataTable, EmptyState, FilterSelect, KeyValue, Modal, SelectField, StatCard, StatusBadge, Tabs, TextArea, TextField, todayInput } from './ui';

interface AcademicSummary {
  latestPct: number | null;
  latestAssessment: string | null;
  trend: 'Improving' | 'Declining' | 'Stable' | 'Insufficient data';
  needsSupport: boolean;
  reasons: string[];
  openSupportFollowups: number;
}
type DirectoryStudent = StudentRecord & { adviserName: string | null; academic?: AcademicSummary | null };

export interface StudentProfile extends DirectoryStudent {
  departmentName: string;
  adviserId: string | null;
  email: string;
  bloodGroup: string;
  academics: {
    records: { academicYear: string; semester: number; assessment: string; percentage: number; sgpa: number | null; arrears: number }[];
    latest: { percentage: number; assessment: string } | null;
    trend: string;
    needsSupport: boolean;
    reasons: string[];
  };
  attendance60d: { recorded: number; present: number; absent: number; pct: number | null };
  study60d: { marked: number; attended: number; pct: number | null };
  absenceCases: { id: string; date: string; status: string }[];
  leaves: { id: string; leaveType: string; dateRange: string; workflowStatus: string }[];
  followups: { id: string; category: string; title: string; status: string; due: string | null; owner: string }[];
  incidents: { id: string; category: string; severity: string; status: string; date: string }[];
}

export const trendTone = (t: string) => (t === 'Declining' ? 'red' : t === 'Improving' ? 'green' : 'slate');

/** Scoped student list with academic indicators and full profile drill-down (HOD, Adviser, Dean). */
export const StudentDirectory: React.FC<{ endpoint: string; title?: string; showDepartment?: boolean; emptyMessage?: string; onShowToast?: (m: string, e?: boolean) => void }> = ({ endpoint, showDepartment, emptyMessage, onShowToast }) => {
  const list = useResource(() => http.get<DirectoryStudent[]>(endpoint), [endpoint]);
  const [year, setYear] = useState('');
  const [dept, setDept] = useState('');
  const [flag, setFlag] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      (list.data ?? []).filter(
        (s) =>
          (!year || s.year === year) &&
          (!dept || s.department === dept) &&
          (!flag || (flag === 'Needs support' ? s.academic?.needsSupport : flag === 'Declining' ? s.academic?.trend === 'Declining' : flag === 'No records' ? !s.academic || s.academic.latestPct === null : true)),
      ),
    [list.data, year, dept, flag],
  );

  return (
    <Card>
      <AsyncContent {...list} onRetry={list.reload}>
        {(all) => (
          <DataTable
            rows={rows}
            rowKey={(s) => s.id}
            search={(s) => `${s.name} ${s.regNumber} ${s.roomNumber}`}
            onRowClick={(s) => setOpenId(s.id)}
            emptyTitle="No students"
            emptyMessage={emptyMessage}
            toolbar={
              <>
                {showDepartment && <FilterSelect label="Department" value={dept} onChange={setDept} options={[...new Set(all.map((s) => s.department))].sort()} />}
                <FilterSelect label="Year" value={year} onChange={setYear} options={['1st Year', '2nd Year', '3rd Year', '4th Year']} />
                <FilterSelect label="Academic flag" value={flag} onChange={setFlag} options={['Needs support', 'Declining', 'No records']} />
              </>
            }
            columns={[
              {
                key: 'name',
                label: 'Student',
                className: 'whitespace-normal',
                render: (s) => (
                  <span title={s.name} className="font-semibold text-[var(--kv-heading)] line-clamp-2 break-words leading-snug">
                    {s.name}
                  </span>
                ),
              },
              { key: 'regNumber', label: 'Reg. No', className: 'w-[8.75rem]' },
              ...(showDepartment ? [{ key: 'department', label: 'Dept', className: 'w-[5.5rem]' }] : []),
              { key: 'year', label: 'Year', className: 'w-[5.75rem]' },
              { key: 'roomNumber', label: 'Room', className: 'w-[6.25rem]' },
              {
                key: 'adviserName',
                label: 'Adviser',
                className: 'whitespace-normal',
                render: (s: DirectoryStudent) => (
                  <span title={s.adviserName ?? undefined} className="line-clamp-2 break-words leading-snug">
                    {s.adviserName ?? '—'}
                  </span>
                ),
              },
              {
                key: 'latest',
                label: 'Latest %',
                // Wide enough for the percentage and its trend badge side by side.
                className: 'w-[8.5rem]',
                sortValue: (s: DirectoryStudent) => s.academic?.latestPct ?? null,
                render: (s: DirectoryStudent) =>
                  s.academic?.latestPct != null ? (
                    <span className="inline-flex items-center gap-1.5">
                      {s.academic.latestPct}% <Badge tone={trendTone(s.academic.trend)}>{s.academic.trend}</Badge>
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--kv-text-muted)]">No records</span>
                  ),
              },
              {
                key: 'support',
                label: 'Support',
                className: 'w-[9.75rem]',
                sortValue: (s: DirectoryStudent) => (s.academic?.needsSupport ? 1 : 0),
                render: (s: DirectoryStudent) =>
                  s.academic?.needsSupport ? (
                    <Badge tone={s.academic.openSupportFollowups ? 'blue' : 'amber'}>{s.academic.openSupportFollowups ? 'Follow-up open' : 'Needs follow-up'}</Badge>
                  ) : (
                    '—'
                  ),
              },
              { key: 'status', label: 'Hostel', className: 'w-[7rem]', render: (s) => <StatusBadge status={s.status === 'Present' ? 'In hostel' : s.status} /> },
            ]}
          />
        )}
      </AsyncContent>
      {openId && <StudentProfileModal url={`${endpoint}/${openId}`} onClose={() => setOpenId(null)} onShowToast={onShowToast} />}
    </Card>
  );
};

export const StudentProfileModal: React.FC<{ url: string; onClose: () => void; onShowToast?: (m: string, e?: boolean) => void }> = ({ url, onClose, onShowToast }) => {
  const d = useResource(() => http.get<StudentProfile>(url), [url]);
  const [tab, setTab] = useState('overview');
  const { user } = useAuth();
  return (
    <Modal open size="xl" title={d.data?.name ?? 'Student'} description={d.data ? `${d.data.regNumber} · ${d.data.departmentName} · ${d.data.year} · Room ${d.data.roomNumber}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(s) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatCard label="Latest assessment" value={s.academics.latest ? `${s.academics.latest.percentage}%` : '—'} hint={s.academics.trend} tone={trendTone(s.academics.trend) as any} />
              <StatCard label="Roll call (60 d)" value={s.attendance60d.pct === null ? '—' : `${s.attendance60d.pct}%`} hint={`${s.attendance60d.present}/${s.attendance60d.recorded} present`} tone="green" />
              <StatCard label="Study (60 d)" value={s.study60d.pct === null ? '—' : `${s.study60d.pct}%`} hint={`${s.study60d.attended}/${s.study60d.marked} sessions`} tone="violet" />
              <StatCard label="Open follow-ups" value={s.followups.filter((f) => ['Open', 'In Progress'].includes(f.status)).length} tone="amber" />
            </div>
            {s.academics.needsSupport && (
              <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900" role="note">
                <strong>Possible academic support need:</strong> {s.academics.reasons.join('; ')}.
              </div>
            )}
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'academics', label: 'Academics', count: s.academics.records.length },
                { id: 'followups', label: 'Follow-ups', count: s.followups.length },
                { id: 'hostel', label: 'Hostel record' },
                ...(user?.role === 'Dean' && onShowToast ? [{ id: 'request', label: 'Request follow-up' }] : []),
              ]}
            />
            {tab === 'request' && onShowToast && <DeanFollowupRequest student={s} onDone={() => (d.reload(), setTab('followups'))} onShowToast={onShowToast} />}
            {tab === 'overview' && (
              <KeyValue
                cols={3}
                items={[
                  ['Email', s.email || '—'],
                  ['Phone', s.contactNumber || '—'],
                  ['Adviser', s.adviserName ?? 'Not assigned'],
                  ['Parent / guardian', s.parentName || '—'],
                  ['Parent phone', s.parentNumber || '—'],
                  ['Enrollment', s.enrollmentStatus],
                ]}
              />
            )}
            {tab === 'academics' &&
              (s.academics.records.length === 0 ? (
                <EmptyState icon="school" title="No academic records entered" />
              ) : (
                <DataTable
                  rows={s.academics.records.map((r, i) => ({ ...r, i }))}
                  rowKey={(r) => String(r.i)}
                  columns={[
                    { key: 'academicYear', label: 'Year' },
                    { key: 'semester', label: 'Sem' },
                    { key: 'assessment', label: 'Assessment' },
                    { key: 'percentage', label: '%', render: (r) => `${r.percentage}%` },
                    { key: 'sgpa', label: 'SGPA', render: (r) => r.sgpa ?? '—' },
                    { key: 'arrears', label: 'Arrears' },
                  ]}
                />
              ))}
            {tab === 'followups' &&
              (s.followups.length === 0 ? (
                <EmptyState icon="support_agent" title="No follow-ups recorded" />
              ) : (
                <ul className="divide-y divide-[var(--kv-border-soft)] text-sm">
                  {s.followups.map((f) => (
                    <li key={f.id} className="py-2 flex flex-wrap justify-between gap-2">
                      <span>
                        <span className="font-semibold">{f.title}</span> <span className="text-[var(--kv-text-muted)]">· {f.category} · {f.owner}{f.due ? ` · due ${f.due}` : ''}</span>
                      </span>
                      <StatusBadge status={f.status} />
                    </li>
                  ))}
                </ul>
              ))}
            {tab === 'hostel' && (
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div>
                  <h4 className="font-semibold text-[var(--kv-heading)] mb-1">Absence records</h4>
                  {s.absenceCases.length ? s.absenceCases.map((c) => <div key={c.id} className="flex justify-between gap-2 py-1"><span>{c.date}</span><StatusBadge status={c.status} /></div>) : <p className="text-xs text-[var(--kv-text-muted)]">None</p>}
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--kv-heading)] mb-1">Leave</h4>
                  {s.leaves.length ? s.leaves.map((l) => <div key={l.id} className="flex justify-between gap-2 py-1"><span className="truncate">{l.dateRange}</span><StatusBadge status={l.workflowStatus} /></div>) : <p className="text-xs text-[var(--kv-text-muted)]">None</p>}
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--kv-heading)] mb-1">Incidents</h4>
                  {s.incidents.length ? s.incidents.map((i) => <div key={i.id} className="flex justify-between gap-2 py-1"><span className="truncate">{i.date} · {i.category}</span><StatusBadge status={i.status} /></div>) : <p className="text-xs text-[var(--kv-text-muted)]">None</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

/** Dean-only: ask the student's adviser, department HOD or a Warden to follow up (tracked as a follow-up record). */
const DeanFollowupRequest: React.FC<{ student: StudentProfile; onDone: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ student, onDone, onShowToast }) => {
  const staff = useResource(() => http.get<{ id: string; name: string; role: string; department: string | null }[]>('/meta/staff?roles=HOD,Adviser,Warden'));
  const eligible = (staff.data ?? []).filter((x) => x.role === 'Warden' || (x.role === 'HOD' && x.department === student.department) || (x.role === 'Adviser' && x.id === student.adviserId));
  const [f, setF] = useState({
    assigneeId: '',
    category: student.academics.needsSupport ? 'Academic Support' : 'Study Session',
    title: student.academics.needsSupport ? 'Academic support check-in' : 'Study-session participation follow-up',
    notes: student.academics.needsSupport ? `Reason flagged: ${student.academics.reasons.join('; ')}.` : '',
    dueDate: '',
  });
  const { run, pending } = useAction(onShowToast);
  return (
    <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <SelectField
          label="Responsible staff member"
          required
          value={f.assigneeId}
          placeholder="Choose…"
          onChange={(e) => setF({ ...f, assigneeId: e.target.value })}
          options={eligible.map((x) => ({ value: x.id, label: `${x.name} (${x.role}${x.department ? `, ${x.department}` : ''})` }))}
          hint={!student.adviserId ? 'This student has no adviser assigned.' : undefined}
        />
        <SelectField label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={['Academic Support', 'Study Session', 'Absence Follow-up', 'Disciplinary', 'Other']} />
        <TextField label="Title" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <TextField label="Due date" type="date" min={todayInput()} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        <div className="sm:col-span-2">
          <TextArea label="Instructions" required rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
      </div>
      <Button
        icon="assignment_ind"
        loading={pending}
        disabled={!f.assigneeId || f.title.trim().length < 3 || f.notes.trim().length < 5}
        onClick={async () => {
          const r = await run(() => http.post(`/dean/students/${student.id}/follow-up`, { ...f, dueDate: f.dueDate || undefined }));
          if (r) onDone();
        }}
      >
        Send follow-up request
      </Button>
    </div>
  );
};
