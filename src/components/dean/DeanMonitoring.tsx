import React, { useMemo, useState } from 'react';
import { http, qs } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { queryParam } from '../../hooks/usePortalRoute';
import { AbsenceCases } from '../common/AbsenceCases';
import { StudySessions } from '../common/StudySessions';
import { StudyAttendanceLog } from '../common/StudyAttendanceLog';
import { StudentProfileModal, trendTone } from '../common/StudentDirectory';
import { AsyncContent, Badge, BarList, Button, Card, DataTable, EmptyState, FilterSelect, PageHeader, SelectField, StatCard, Tabs, TextField, addDaysInput, todayInput, clock12, clock24, addClockMinutes } from '../common/ui';

type Toast = (m: string, e?: boolean) => void;

const DateRange: React.FC<{ from: string; to: string; onChange: (from: string, to: string) => void }> = ({ from, to, onChange }) => (
  <div className="flex flex-wrap gap-3">
    <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1">
      From
      <input type="date" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm bg-white" />
    </label>
    <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1">
      To
      <input type="date" value={to} min={from} max={todayInput()} onChange={(e) => e.target.value && onChange(from, e.target.value)} className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm bg-white" />
    </label>
  </div>
);

// ---------------------------------------------------------------------------
// Attendance & unauthorized absence
// ---------------------------------------------------------------------------
interface AttendanceOverview {
  byDepartment: { department: string; year: string; status: string; count: number }[];
  repeated: { studentId: string; name: string; regNumber: string; department: string; year: string; roomNumber: string; count: number; lastDate: string; threshold: number; windowDays: number }[];
}
interface DailySummary {
  session: string;
  expectedNow: number;
  days: { date: string; dateDisplay: string; present: number; absent: number; onLeave: number; onOuting: number; recorded: number }[];
}

export const DeanAttendance: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const caseId = queryParam('case');
  const [view, setView] = useState(caseId ? 'cases' : 'summary');
  const [from, setFrom] = useState(addDaysInput(-29));
  const [to, setTo] = useState(todayInput());
  const [dept, setDept] = useState('');
  const overview = useResource(() => http.get<AttendanceOverview>(`/dean/attendance-overview${qs({ from, to })}`), [from, to]);
  const daily = useResource(() => http.get<DailySummary>(`/attendance/summary${qs({ from: addDaysInput(-13), to: todayInput() })}`));

  const matrix = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    (overview.data?.byDepartment ?? [])
      .filter((r) => !dept || r.department === dept)
      .forEach((r) => {
        const k = dept ? `${r.department} · ${r.year}` : r.department;
        const row = m.get(k) ?? {};
        row[r.status] = (row[r.status] ?? 0) + r.count;
        m.set(k, row);
      });
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v })) as ({ key: string } & Record<string, number>)[];
  }, [overview.data, dept]);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Student Attendance & Unauthorized Absence" subtitle="Hostel-wide roll-call and absence verification status. Unverified records are never counted as unauthorized." icon="how_to_reg" />
      <div className="mb-4">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'summary', label: 'Summary' },
            { id: 'cases', label: 'Absence records & follow-up' },
          ]}
        />
      </div>
      {view === 'cases' ? (
        <AbsenceCases onShowToast={onShowToast} initialCaseId={caseId} defaultView="open" />
      ) : (
        <div className="space-y-5">
          <AsyncContent {...daily} onRetry={daily.reload}>
            {(d) => {
              const last = d.days[d.days.length - 1];
              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label="Residents now" value={d.expectedNow} />
                    <StatCard label={`Last roll call (${last?.dateDisplay ?? '—'})`} value={last ? `${last.present}/${last.recorded}` : '—'} hint="Present / recorded" tone="green" />
                    <StatCard label="Absent at last roll call" value={last?.absent ?? '—'} tone="red" />
                    <StatCard label="Not recorded at last roll call" value={last ? Math.max(0, d.expectedNow - last.recorded) : '—'} tone="slate" hint="Missing information, not absence" />
                  </div>
                  <Card title={`${d.session}: last 14 days`}>
                    {d.days.length === 0 ? (
                      <EmptyState icon="event_busy" title="No roll calls recorded in this period" />
                    ) : (
                      <DataTable
                        rows={[...d.days].reverse()}
                        rowKey={(r) => r.date}
                        pageSize={14}
                        columns={[
                          { key: 'dateDisplay', label: 'Date', sortValue: (r) => r.date },
                          { key: 'recorded', label: 'Recorded' },
                          { key: 'present', label: 'Present' },
                          { key: 'absent', label: 'Absent' },
                          { key: 'onLeave', label: 'On leave' },
                          { key: 'onOuting', label: 'On outing' },
                        ]}
                      />
                    )}
                  </Card>
                </>
              );
            }}
          </AsyncContent>
          <div className="flex flex-wrap items-end gap-3">
            <DateRange
              from={from}
              to={to}
              onChange={(a, b) => {
                setFrom(a);
                setTo(b);
              }}
            />
            <FilterSelect label="Department" value={dept} onChange={setDept} options={[...new Set((overview.data?.byDepartment ?? []).map((r) => r.department))].sort()} />
          </div>
          <AsyncContent {...overview} onRetry={overview.reload}>
            {(o) => (
              <div className="grid lg:grid-cols-2 gap-5">
                <Card title={dept ? `${dept}: absence records by year` : 'Absence records by department'}>
                  <DataTable
                    rows={matrix}
                    rowKey={(r) => r.key}
                    emptyTitle="No absence records in this period"
                    columns={[
                      { key: 'key', label: dept ? 'Year' : 'Department' },
                      { key: 'Pending Verification', label: 'Pending', render: (r) => r['Pending Verification'] ?? 0 },
                      { key: 'Suspected Unauthorized', label: 'Suspected', render: (r) => r['Suspected Unauthorized'] ?? 0 },
                      { key: 'Verified Unauthorized', label: 'Verified', render: (r) => r['Verified Unauthorized'] ?? 0 },
                      { key: 'Authorized Absence', label: 'Authorized', render: (r) => r['Authorized Absence'] ?? 0 },
                      { key: 'Resolved', label: 'Resolved', render: (r) => r.Resolved ?? 0 },
                    ]}
                  />
                </Card>
                <Card title="Repeated unauthorized absences">
                  {o.repeated.length > 0 && <p className="text-xs text-[var(--kv-text-muted)] mb-2">≥ {o.repeated[0].threshold} verified within {o.repeated[0].windowDays} days (configurable in Settings).</p>}
                  <DataTable
                    rows={o.repeated.filter((r) => !dept || r.department === dept)}
                    rowKey={(r) => r.studentId}
                    emptyTitle="No students at the repeat threshold"
                    columns={[
                      { key: 'name', label: 'Student' },
                      { key: 'regNumber', label: 'Reg. No' },
                      { key: 'department', label: 'Dept' },
                      { key: 'count', label: 'Verified' },
                      { key: 'lastDate', label: 'Latest' },
                    ]}
                  />
                </Card>
              </div>
            )}
          </AsyncContent>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Study session monitoring
// ---------------------------------------------------------------------------
interface StudyRow {
  key: string;
  label: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  marked: number;
  participationPct: number | null;
}
interface StudyOverview {
  byDepartment: StudyRow[];
  byYear: StudyRow[];
  bySession: StudyRow[];
  trend: StudyRow[];
  repeatedMisses: { studentId: string; name: string; regNumber: string; department: string; year: string; missed: number; lastMissed: string; threshold: number; windowDays: number }[];
}

export const DeanStudy: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [view, setView] = useState('overview');
  const [from, setFrom] = useState(addDaysInput(-29));
  const [to, setTo] = useState(todayInput());
  const data = useResource(() => http.get<StudyOverview>(`/dean/study-overview${qs({ from, to })}`), [from, to]);
  const bars = (rows: StudyRow[]) => rows.map((r) => ({ label: r.label, value: r.participationPct, suffix: '%' }));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Study Session Monitoring" subtitle="Participation from the Warden's study-session attendance — the same records students and departments see." icon="menu_book" />
      <div className="mb-4">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'overview', label: 'Participation' },
            { id: 'sessions', label: 'Sessions' },
            { id: 'log', label: 'Attendance log' },
          ]}
        />
      </div>
      {view === 'log' ? (
        <StudyAttendanceLog embedded subtitle="Every study-session attendance record in the hostel, student by student, as the scans left it." />
      ) : view === 'sessions' ? (
        <StudySessions onShowToast={onShowToast} />
      ) : (
        <div className="space-y-5">
          <DateRange
            from={from}
            to={to}
            onChange={(a, b) => {
              setFrom(a);
              setTo(b);
            }}
          />
          <p className="text-xs text-[var(--kv-text-muted)]">Participation = (present + late) ÷ (marked − excused) for non-cancelled sessions in the period.</p>
          <AsyncContent {...data} onRetry={data.reload}>
            {(d) => (
              <div className="grid lg:grid-cols-2 gap-5">
                <Card title="By department">
                  <BarList data={bars(d.byDepartment)} max={100} emptyMessage="No study attendance recorded in this period." />
                </Card>
                <Card title="By year">
                  <BarList data={bars(d.byYear)} max={100} emptyMessage="No study attendance recorded in this period." />
                </Card>
                <Card title="Trend by date">
                  <BarList data={bars(d.trend)} max={100} emptyMessage="No sessions in this period." />
                </Card>
                <Card title="Session-wise participation">
                  <DataTable
                    rows={d.bySession}
                    rowKey={(r) => r.key}
                    pageSize={8}
                    emptyTitle="No sessions"
                    columns={[
                      { key: 'label', label: 'Session' },
                      { key: 'present', label: 'Present' },
                      { key: 'late', label: 'Late' },
                      { key: 'absent', label: 'Absent' },
                      { key: 'participationPct', label: '%', render: (r) => (r.participationPct === null ? '—' : `${r.participationPct}%`) },
                    ]}
                  />
                </Card>
                <Card title="Students repeatedly missing sessions" className="lg:col-span-2">
                  {d.repeatedMisses[0] && <p className="text-xs text-[var(--kv-text-muted)] mb-2">≥ {d.repeatedMisses[0].threshold} misses within {d.repeatedMisses[0].windowDays} days (configurable in Settings). Select a student to open their profile and request a follow-up.</p>}
                  <DataTable
                    rows={d.repeatedMisses}
                    rowKey={(r) => r.studentId}
                    onRowClick={(r) => setProfileId(r.studentId)}
                    emptyTitle="No students at the repeat threshold"
                    columns={[
                      { key: 'name', label: 'Student' },
                      { key: 'regNumber', label: 'Reg. No' },
                      { key: 'department', label: 'Dept' },
                      { key: 'year', label: 'Year' },
                      { key: 'missed', label: 'Missed' },
                      { key: 'lastMissed', label: 'Latest' },
                    ]}
                  />
                </Card>
              </div>
            )}
          </AsyncContent>
        </div>
      )}
      {profileId && <StudentProfileModal url={`/dean/students/${profileId}`} onClose={() => setProfileId(null)} onShowToast={onShowToast} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Academic performance
// ---------------------------------------------------------------------------
interface AcademicsData {
  hasRecords: boolean;
  thresholds: { supportPct: number; declinePoints: number };
  departments: { department: string; students: number; studentsWithRecords: number; averageLatestPct: number | null; needsSupport: number; declining: number; improving: number; openSupportFollowups: number }[];
  years: { year: string; students: number; studentsWithRecords: number; averageLatestPct: number | null; needsSupport: number }[];
  assessments: { academicYear: string; semester: number; assessment: string; department: string; averagePct: number; records: number }[];
  students: { studentId: string; name: string; regNumber: string; department: string; year: string; latestPct: number | null; latestAssessment: string | null; trend: string; needsSupport: boolean; reasons: string[]; adviserName: string | null; openSupportFollowups: number }[];
}

export const DeanAcademics: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [dept, setDept] = useState('');
  const [year, setYear] = useState('');
  const [semester, setSemester] = useState('');
  const [flag, setFlag] = useState('Needs support');
  const d = useResource(() => http.get<AcademicsData>(`/dean/academics${qs({ department: dept, year })}`), [dept, year]);
  const depts = useResource(() => http.get<{ code: string }[]>('/meta/departments'));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Student Academic Performance" subtitle="From approved academic records entered by advisers and HODs. Nothing here is estimated or derived from attendance." icon="school" />
      <div className="flex flex-wrap gap-3 mb-4">
        <FilterSelect label="Department" value={dept} onChange={setDept} options={(depts.data ?? []).map((x) => x.code)} />
        <FilterSelect label="Year" value={year} onChange={setYear} options={['1', '2', '3', '4'].map((y) => ({ value: y, label: `Year ${y}` }))} />
      </div>
      <AsyncContent {...d} onRetry={d.reload}>
        {(a) =>
          !a.hasRecords ? (
            <Card>
              <EmptyState
                icon="school"
                title="No academic records have been entered yet"
                message="Advisers and HODs enter or import approved internal/semester results in their portals (Academic Records). Summaries appear here automatically."
              />
            </Card>
          ) : (
            <div className="space-y-5">
              <p className="text-xs text-[var(--kv-text-muted)]">
                “May need support” = latest assessment below {a.thresholds.supportPct}%, a drop of ≥ {a.thresholds.declinePoints} points between consecutive assessments, or arrears. Thresholds are configurable in Settings and should be confirmed by
                the institution.
              </p>
              <div className="grid lg:grid-cols-2 gap-5">
                <Card title="Departments (latest assessment)">
                  <DataTable
                    rows={a.departments}
                    rowKey={(r) => r.department}
                    columns={[
                      { key: 'department', label: 'Dept' },
                      { key: 'studentsWithRecords', label: 'With records', render: (r) => `${r.studentsWithRecords}/${r.students}` },
                      { key: 'averageLatestPct', label: 'Avg %', render: (r) => (r.averageLatestPct === null ? '—' : `${r.averageLatestPct}%`) },
                      { key: 'improving', label: 'Improving' },
                      { key: 'declining', label: 'Declining' },
                      { key: 'needsSupport', label: 'Need support' },
                      { key: 'openSupportFollowups', label: 'Follow-ups open' },
                    ]}
                  />
                </Card>
                <Card title="Years (latest assessment)">
                  <BarList data={a.years.map((y) => ({ label: `${y.year} (${y.needsSupport} need support)`, value: y.averageLatestPct, suffix: '%' }))} max={100} />
                </Card>
              </div>
              <Card title="Assessment averages by semester">
                <DataTable
                  rows={a.assessments.filter((x) => !semester || String(x.semester) === semester)}
                  rowKey={(r) => `${r.academicYear}-${r.semester}-${r.assessment}-${r.department}`}
                  toolbar={<FilterSelect label="Semester" value={semester} onChange={setSemester} options={[...new Set(a.assessments.map((x) => String(x.semester)))].sort()} />}
                  columns={[
                    { key: 'academicYear', label: 'Acad. year' },
                    { key: 'semester', label: 'Sem' },
                    { key: 'assessment', label: 'Assessment' },
                    { key: 'department', label: 'Dept' },
                    { key: 'averagePct', label: 'Average', render: (r) => `${r.averagePct}%` },
                    { key: 'records', label: 'Records' },
                  ]}
                />
              </Card>
              <Card title="Students">
                <DataTable
                  rows={a.students.filter((s) => !flag || (flag === 'Needs support' ? s.needsSupport : s.trend === flag))}
                  rowKey={(s) => s.studentId}
                  search={(s) => `${s.name} ${s.regNumber}`}
                  onRowClick={(s) => setProfileId(s.studentId)}
                  toolbar={<FilterSelect label="Show" value={flag} onChange={setFlag} allLabel="All with records" options={['Needs support', 'Declining', 'Improving', 'Stable']} />}
                  columns={[
                    { key: 'name', label: 'Student' },
                    { key: 'regNumber', label: 'Reg. No' },
                    { key: 'department', label: 'Dept' },
                    { key: 'year', label: 'Year' },
                    { key: 'latestPct', label: 'Latest', render: (s) => (s.latestPct === null ? '—' : `${s.latestPct}%`) },
                    { key: 'trend', label: 'Trend', render: (s) => <Badge tone={trendTone(s.trend) as any}>{s.trend}</Badge> },
                    { key: 'adviserName', label: 'Adviser', render: (s) => s.adviserName ?? '—' },
                    { key: 'openSupportFollowups', label: 'Follow-up', render: (s) => (s.needsSupport ? (s.openSupportFollowups ? <Badge tone="blue">Open</Badge> : <Badge tone="amber">None</Badge>) : '—') },
                  ]}
                />
              </Card>
            </div>
          )
        }
      </AsyncContent>
      {profileId && <StudentProfileModal url={`/dean/students/${profileId}`} onClose={() => setProfileId(null)} onShowToast={onShowToast} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Institutional rules (configurable thresholds)
// ---------------------------------------------------------------------------
interface Setting {
  key: string;
  value: string;
  description: string;
  isDefault: boolean;
  updatedAt: string | null;
}

/**
 * How each rule is explained on screen.
 *
 * The stored keys ("absence.repeat_threshold") are precise but mean nothing to a
 * Warden or a Dean, so every rule carries a plain question, a sentence of what it
 * actually changes, and the unit its number is counted in. A key with no entry
 * here still shows up, using the description the server sends, so a rule added
 * later is never hidden from this page.
 */
interface FieldHelp {
  label: string;
  help: string;
  unit?: string;
  kind?: 'number' | 'yesno' | 'list' | 'text' | 'time';
  /** Reads the value back as a sentence, so its effect is obvious before saving. */
  effect?: (value: string, all: Record<string, string>) => string;
}

/**
 * A clock the office reads the way it speaks: hour, minute and AM/PM. The value
 * saved is still the 24-hour one the server keeps, so nothing downstream changes.
 */
const TimeField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const h24 = m ? Number(m[1]) : 19;
  const minute = m ? Number(m[2]) : 0;
  const hour = ((h24 + 11) % 12) + 1;
  const meridiem: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM';
  const emit = (h: number, mm: number, ap: 'AM' | 'PM') => onChange(clock24(h, mm, ap));
  return (
    <div className="grid grid-cols-3 gap-1.5 min-w-0">
      <SelectField
        label="Hour"
        value={String(hour)}
        onChange={(e) => emit(Number(e.target.value), minute, meridiem)}
        options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
      />
      <SelectField
        label="Minute"
        value={String(minute)}
        onChange={(e) => emit(hour, Number(e.target.value), meridiem)}
        options={Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, '0') }))}
      />
      <SelectField
        label="AM/PM"
        value={meridiem}
        onChange={(e) => emit(hour, minute, e.target.value as 'AM' | 'PM')}
        options={[
          { value: 'AM', label: 'AM' },
          { value: 'PM', label: 'PM' },
        ]}
      />
    </div>
  );
};

const FIELDS: Record<string, FieldHelp> = {
  'study.auto_enabled': {
    label: 'Open the daily study session automatically?',
    help: "Yes: at the time below, every department's study session opens on its own — the Adviser gets the attendance QR to show the room and the students get the scanner, both in their notifications. No: nothing opens on its own.",
    kind: 'yesno',
    effect: (v, all) =>
      v === 'true'
        ? `Each department's session opens at ${clock12(all['study.auto_start_time'] ?? '19:00')}, on ${all['study.auto_days'] || 'Daily'}.`
        : 'Nothing opens on its own; an Adviser starts each session from their portal.',
  },
  'study.auto_start_time': {
    label: 'What time does the study session start?',
    help: 'Any time of day. At this time the session opens: the Adviser gets the QR to show the room and the students get the scanner, both in their notifications.',
    kind: 'time',
    effect: (v, all) => {
      const minutes = Number(all['study.qr_start_minutes'] ?? '10') || 10;
      return `The session opens at ${clock12(v)}, runs for ${minutes} minutes and closes itself at ${clock12(addClockMinutes(v, minutes))}. Setting a new time opens a new session at that time, today included.`;
    },
  },
  'study.auto_grace_minutes': {
    label: 'How late may the session still open by itself?',
    help: 'If the system was not running at the study time — a restart, a power cut — it still opens the session this long afterwards, counted from the end of the window, so the students are not left without one. 0 means it only ever opens at the exact time.',
    unit: 'minutes',
    effect: (v) =>
      Number(v) > 0
        ? `A session missed at its time still opens up to ${v} minutes later, for the full QR length from the moment it opens.`
        : 'A session missed at its time is not opened later; that day has none.',
  },
  'study.auto_days': {
    label: 'Which days does it run?',
    help: 'Three-letter day names separated by commas — Mon,Tue,Wed,Thu,Fri,Sat — or the word Daily for every day.',
    kind: 'text',
    effect: (v) => (/^daily$/i.test(v.trim()) ? 'It runs every day.' : `It runs on ${v}.`),
  },
  'study.default_location': {
    label: 'Where is the study session held?',
    help: 'The venue written on sessions the system opens, and on one an Adviser starts from their portal.',
    kind: 'text',
    effect: (v) => `Sessions are recorded as held at ${v}.`,
  },
  'study.default_minutes': {
    label: 'How long is a session an Adviser starts by hand?',
    help: 'The end time filled in for them when they press Start; they can change it before starting.',
    unit: 'minutes',
    effect: (v) => `The end time starts out ${v} minutes after the start time.`,
  },
  'attendance.session_name': {
    label: 'What is the daily roll call called?',
    help: 'The name staff and students see on the attendance screens.',
    kind: 'text',
    effect: (v) => `Attendance screens call it "${v}".`,
  },
  'attendance.flag_on_close': {
    label: 'Flag unexplained absences when the Warden closes roll call?',
    help: 'Yes: anyone still unaccounted for is marked "Suspected Unauthorized" and goes to the follow-up list. No: they stay "Pending Verification" until someone looks at them.',
    kind: 'yesno',
    effect: (v) =>
      v === 'true'
        ? 'Closing a roll call moves unexplained absences straight to "Suspected Unauthorized".'
        : 'Closing a roll call leaves unexplained absences as "Pending Verification".',
  },
  'absence.repeat_threshold': {
    label: 'How many unauthorized absences count as "repeated"?',
    help: 'A student who reaches this number inside the window below is shown as a repeat case to the Warden, HOD and Dean.',
    unit: 'absences',
    effect: (v, all) => `${v} verified absences within ${all['absence.repeat_window_days'] ?? '30'} days marks a student as a repeat case.`,
  },
  'absence.repeat_window_days': {
    label: 'Over how many days are those absences counted?',
    help: 'The look-back period. An absence older than this no longer counts towards the number above.',
    unit: 'days',
  },
  'study.repeat_miss_threshold': {
    label: 'How many missed study sessions flag a student?',
    help: 'Reaching this number inside the window below puts the student on the adviser’s follow-up list.',
    unit: 'sessions',
    effect: (v, all) => `${v} missed sessions within ${all['study.repeat_window_days'] ?? '30'} days flags the student for follow-up.`,
  },
  'study.repeat_window_days': {
    label: 'Over how many days are missed sessions counted?',
    help: 'Older misses stop counting once they fall outside this window.',
    unit: 'days',
  },
  'study.start_early_minutes': { label: 'How early may an adviser start a study session?', help: 'Before its scheduled start time.', unit: 'minutes' },
  'study.start_late_minutes': { label: 'How late may an adviser still start it?', help: 'After its scheduled end time. Past this, the session can no longer be started at all.', unit: 'minutes' },
  'study.qr_start_minutes': {
    label: 'How long does the attendance QR work?',
    help: 'How long the students have to scan it. This is the whole length of the session: when the code dies the session closes by itself and anyone who did not scan is marked absent.',
    unit: 'minutes',
    effect: (v, all) => `The session runs from ${clock12(all['study.auto_start_time'] ?? '19:00')} for ${v} minutes.`,
  },
  'study.qr_end_minutes': { label: 'How long does the end QR code work?', help: 'Scanned at the end of a session to confirm the student stayed.', unit: 'minutes' },
  'outing.parent_link_hours': {
    label: 'How long does the parent’s approval link stay valid?',
    help: 'The WhatsApp link a parent uses to approve an outing. After this it expires and the office must send a new one.',
    unit: 'hours',
  },
  'outing.tracking_stale_minutes': {
    label: 'How long without a location update before an outing counts as interrupted?',
    help: 'Silence longer than this from a student who is out raises the alert to the Warden and Security.',
    unit: 'minutes',
  },
  'location.retention_days': {
    label: 'How long are location pings kept?',
    help: 'Individual map points from outings are deleted by the nightly cleanup after this many days. Shorter is kinder to students’ privacy.',
    unit: 'days',
  },
  'complaint.close_roles': { label: 'Who may close a resolved complaint?', help: 'Only these roles see the Close button.', kind: 'list' },
  'complaint.reopen_roles': { label: 'Who may reopen a complaint?', help: 'A student reopening their own is also limited by the window below.', kind: 'list' },
  'complaint.reopen_window_hours': {
    label: 'How long after it is resolved may a student reopen their complaint?',
    help: 'This applies to the student who raised it. Staff are not limited by this window.',
    unit: 'hours',
  },
  'complaint.worker_link_hours': {
    label: 'How long does the worker’s job link stay usable?',
    help: 'The link sent with the job on WhatsApp, where the worker reports the work done.',
    unit: 'hours',
  },
  'complaint.fallback_worker_category': {
    label: 'Which trade takes a complaint that matches nothing else?',
    help: 'Used when the category has no trade set and the wording matches no keyword. Leave it empty to have the Warden pick the worker instead.',
    kind: 'text',
    effect: (v) => (v.trim() ? `A complaint nothing else matches goes to ${v}.` : 'A complaint nothing else matches waits for the Warden to pick a worker.'),
  },
  'academic.support_threshold_pct': {
    label: 'Below what mark is a student listed as needing support?',
    help: 'Read from the latest assessment. It is a prompt to look, not a judgement about the student.',
    unit: '%',
    effect: (v) => `Students scoring under ${v}% in their latest assessment are listed as possibly needing support.`,
  },
  'academic.decline_points': {
    label: 'What drop between assessments counts as "declining"?',
    help: 'A fall of at least this many percentage points from one assessment to the next.',
    unit: 'points',
  },
};

const GROUPS: { title: string; icon: string; intro: string; keys: string[] }[] = [
  {
    title: 'Roll call and absences',
    icon: 'how_to_reg',
    intro: 'How the nightly roll call behaves, and when repeated absence becomes a case someone must act on.',
    keys: ['attendance.session_name', 'attendance.flag_on_close', 'absence.repeat_threshold', 'absence.repeat_window_days'],
  },
  {
    title: 'Study sessions',
    icon: 'menu_book',
    intro: 'The daily study timetable the system follows on its own, the timing an adviser works within, and when missing sessions becomes a follow-up.',
    keys: [
      'study.auto_enabled',
      'study.auto_start_time',
      'study.auto_days',
      'study.auto_grace_minutes',
      'study.default_location',
      'study.default_minutes',
      'study.start_early_minutes',
      'study.start_late_minutes',
      'study.qr_start_minutes',
      'study.qr_end_minutes',
      'study.repeat_miss_threshold',
      'study.repeat_window_days',
    ],
  },
  {
    title: 'Outings and location',
    icon: 'directions_walk',
    intro: 'Parent approval, and what happens while a student is out of the hostel.',
    keys: ['outing.parent_link_hours', 'outing.tracking_stale_minutes', 'location.retention_days'],
  },
  {
    title: 'Complaints',
    icon: 'build',
    intro: 'Who may close or reopen a complaint, and how the worker side of it is handled.',
    keys: ['complaint.close_roles', 'complaint.reopen_roles', 'complaint.reopen_window_hours', 'complaint.worker_link_hours', 'complaint.fallback_worker_category'],
  },
  {
    title: 'Academic support',
    icon: 'school',
    intro: 'The marks at which a student is listed for a closer look.',
    keys: ['academic.support_threshold_pct', 'academic.decline_points'],
  },
];

export const SettingsPage: React.FC<{ onShowToast: Toast; title?: string }> = ({ onShowToast, title = 'Institutional Rules' }) => {
  const list = useResource(() => http.get<Setting[]>('/meta/settings'));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const { run, pending } = useAction(onShowToast);
  const rows = list.data ?? [];
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const values = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>, [rows]);
  // A rule with no wording of its own is still shown, under its own heading.
  const grouped = useMemo(() => {
    const known = new Set(GROUPS.flatMap((g) => g.keys));
    const rest = rows.filter((r) => !known.has(r.key)).map((r) => r.key);
    return rest.length ? [...GROUPS, { title: 'Other rules', icon: 'tune', intro: 'Rules added to the system since this page was written.', keys: rest }] : GROUPS;
  }, [rows]);

  const save = async (s: Setting) => {
    const r = await run(() => http.put(`/meta/settings/${s.key}`, { value: edits[s.key] }));
    if (r) {
      setEdits(({ [s.key]: _drop, ...keep }) => keep);
      list.reload();
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={title}
        subtitle="The numbers this system follows. Change one here and every portal follows it from that moment; no student or staff record is touched. The values it starts with are sensible guesses, not KVCET policy — set them to the hostel's own rules."
        icon="tune"
      />
      <AsyncContent {...list} onRetry={list.reload}>
        {() => (
          <div className="space-y-4">
            {grouped.map((g) => (
              <Card key={g.title}>
                <div className="flex items-start gap-2 mb-1">
                  <span className="material-symbols-outlined text-[22px] text-[var(--kv-heading)]" aria-hidden="true">
                    {g.icon}
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--kv-heading)]">{g.title}</h3>
                    <p className="text-xs text-[var(--kv-text-muted)]">{g.intro}</p>
                  </div>
                </div>
                <ul className="divide-y divide-[var(--kv-border-soft)]">
                  {g.keys.map((key) => {
                    const s = byKey.get(key);
                    if (!s) return null;
                    const f = FIELDS[key];
                    const draft = edits[key];
                    const value = draft ?? s.value;
                    const changed = draft !== undefined && draft !== s.value;
                    const set = (v: string) => setEdits((e) => ({ ...e, [key]: v }));
                    const effect = f?.effect ? f.effect(value, { ...values, [key]: value }) : null;
                    return (
                      <li key={key} className="py-3.5 grid md:grid-cols-[minmax(0,1fr)_220px] gap-x-4 gap-y-2 items-start">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--kv-heading)]">{f?.label ?? s.description}</p>
                          <p className="text-xs text-[var(--kv-text-muted)] mt-0.5">{f?.help ?? s.description}</p>
                          {effect && <p className="text-xs text-[var(--kv-heading)] mt-1 bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg px-2 py-1">{effect}</p>}
                          <p className="text-[11px] text-[var(--kv-text-muted)] mt-1">
                            {s.isDefault ? 'Still the value it came with' : `Changed by the office on ${new Date(s.updatedAt!).toLocaleDateString('en-GB')}`} · rule name{' '}
                            <span className="font-mono">{s.key}</span>
                          </p>
                        </div>
                        <div className="space-y-1.5 min-w-0">
                          {f?.kind === 'time' ? (
                            <TimeField value={value} onChange={set} />
                          ) : f?.kind === 'yesno' ? (
                            <SelectField
                              label="Value"
                              value={value === 'true' ? 'true' : 'false'}
                              onChange={(e) => set(e.target.value)}
                              options={[
                                { value: 'true', label: 'Yes' },
                                { value: 'false', label: 'No' },
                              ]}
                            />
                          ) : (
                            <div className="flex items-end gap-2 min-w-0">
                              {/* A number keeps a fixed box with its unit beside it, so every
                                  value box on the page starts at the same place. */}
                              <div className={f?.unit ? 'w-[120px] shrink-0' : 'flex-1 min-w-0'}>
                                <TextField label="Value" value={value} onChange={(e) => set(e.target.value)} />
                              </div>
                              {f?.unit && <span className="shrink-0 pb-2.5 text-xs text-[var(--kv-text-muted)] whitespace-nowrap">{f.unit}</span>}
                            </div>
                          )}
                          {f?.kind === 'list' && <p className="text-[11px] text-[var(--kv-text-muted)]">Separate roles with commas, e.g. Warden,AO</p>}
                          {changed && (
                            <div className="flex items-center gap-2">
                              <Button size="sm" loading={pending} onClick={() => save(s)}>
                                Save
                              </Button>
                              <button type="button" className="text-xs underline text-[var(--kv-text-muted)] cursor-pointer" onClick={() => setEdits(({ [key]: _drop, ...keep }) => keep)}>
                                Undo
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </AsyncContent>
    </div>
  );
};
