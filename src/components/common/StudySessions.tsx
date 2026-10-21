import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { http, qs } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { AsyncContent, Badge, Button, Card, ConfirmDialog, DataTable, Modal, SelectField, Tabs, TextArea, TextField, StatusBadge, addDaysInput, clock12, todayInput } from './ui';

export interface StudySession {
  id: string;
  title: string;
  date: string;
  dateDisplay: string;
  startTime: string;
  endTime: string;
  location: string;
  block: string | null;
  department: string | null;
  year: number | null;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  notes: string | null;
  createdBy: string;
  createdByRole: string;
  expected: number;
  marked: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  participationPct: number | null;
}

interface RosterRow {
  studentId: string;
  name: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  status: string;
  remarks: string;
}

/** Shared study-session list. Warden: create, edit, mark attendance. Dean: schedule & monitor. Others: view. */
export const StudySessions: React.FC<{ onShowToast: (m: string, e?: boolean) => void }> = ({ onShowToast }) => {
  const { user } = useAuth();
  const canCreate = user?.role === 'Warden' || user?.role === 'Dean';
  const [view, setView] = useState('upcoming');
  const list = useResource(() => http.get<StudySession[]>(`/study-sessions${qs({ from: addDaysInput(-60), to: addDaysInput(90) })}`));
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayInput();
  const rows = useMemo(() => {
    const all = list.data ?? [];
    if (view === 'upcoming') return all.filter((s) => s.status === 'Scheduled' && s.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    if (view === 'needs') return all.filter((s) => s.status !== 'Cancelled' && s.date <= today && s.marked < s.expected);
    if (view === 'past') return all.filter((s) => s.date < today || s.status !== 'Scheduled');
    return all;
  }, [list.data, view, today]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'needs', label: 'Attendance pending' },
            { id: 'past', label: 'Past & closed' },
            { id: 'all', label: 'All' },
          ]}
        />
        {canCreate && (
          <Button icon="add" onClick={() => setCreating(true)}>
            Schedule study session
          </Button>
        )}
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(s) => s.id}
              search={(s) => `${s.title} ${s.location}`}
              onRowClick={(s) => setOpenId(s.id)}
              emptyTitle="No study sessions in this view"
              columns={[
                { key: 'dateDisplay', label: 'Date', sortValue: (s) => s.date },
                { key: 'time', label: 'Time', render: (s) => `${clock12(s.startTime)}–${clock12(s.endTime)}` },
                { key: 'title', label: 'Session', render: (s) => <span className="font-semibold text-[var(--kv-heading)]">{s.title}</span> },
                { key: 'location', label: 'Venue' },
                { key: 'audience', label: 'Audience', render: (s) => [s.block, s.department, s.year ? `Year ${s.year}` : null].filter(Boolean).join(' · ') || 'All hostellers' },
                { key: 'marked', label: 'Marked', render: (s) => `${s.marked}/${s.expected}` },
                { key: 'participationPct', label: 'Participation', render: (s) => (s.participationPct === null ? '—' : `${s.participationPct}%`) },
                { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.status} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {creating && (
        <SessionForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      {openId && <SessionDetail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const SessionForm: React.FC<{ onClose: () => void; onSaved: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ onClose, onSaved, onShowToast }) => {
  const depts = useResource(() => http.get<{ code: string; name: string }[]>('/meta/departments'));
  const [f, setF] = useState({ title: 'Evening Study Hour', date: todayInput(), startTime: '18:00', endTime: '19:30', location: '', block: '', department: '', year: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (allowOverlap = false) => {
    const errs: Record<string, string> = {};
    if (!f.title.trim()) errs.title = 'Title is required.';
    if (!f.location.trim()) errs.location = 'Venue is required.';
    if (f.date < todayInput()) errs.date = 'Date cannot be in the past.';
    if (f.endTime <= f.startTime) errs.endTime = 'End must be after start.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      const res = await http.post('/study-sessions', {
        ...f,
        block: f.block || undefined,
        department: f.department || undefined,
        year: f.year ? Number(f.year) : undefined,
        notes: f.notes || undefined,
        allowOverlap,
      });
      onShowToast(res.message || 'Study session scheduled.');
      onSaved();
    } catch (err: any) {
      if (err.status === 409) setConflict(err.message);
      else {
        setErrors(err.fields ?? {});
        onShowToast(err.message, true);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      title="Schedule study session"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={() => submit(false)}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <TextField label="Title" required value={f.title} onChange={set('title')} error={errors.title} />
        </div>
        <TextField label="Date" type="date" required min={todayInput()} value={f.date} onChange={set('date')} error={errors.date} />
        <TextField label="Venue" required value={f.location} onChange={set('location')} error={errors.location} placeholder="e.g. Block A Reading Hall" />
        <TextField label="Start" type="time" required value={f.startTime} onChange={set('startTime')} />
        <TextField label="End" type="time" required value={f.endTime} onChange={set('endTime')} error={errors.endTime} />
        <TextField label="Block (optional)" value={f.block} onChange={set('block')} placeholder="e.g. Block A" hint="Leave blank for all blocks" />
        <SelectField label="Department (optional)" value={f.department} onChange={set('department')} placeholder="All departments" options={(depts.data ?? []).map((d) => ({ value: d.code, label: `${d.code} — ${d.name}` }))} />
        <SelectField label="Year (optional)" value={f.year} onChange={set('year')} placeholder="All years" options={['1', '2', '3', '4'].map((y) => ({ value: y, label: `Year ${y}` }))} />
        <div className="sm:col-span-2">
          <TextArea label="Notes" rows={2} value={f.notes} onChange={set('notes')} />
        </div>
      </div>
      <ConfirmDialog
        open={!!conflict}
        title="Venue already booked"
        message={`${conflict} Schedule anyway?`}
        confirmLabel="Schedule anyway"
        onClose={() => setConflict(null)}
        onConfirm={() => {
          setConflict(null);
          submit(true);
        }}
      />
    </Modal>
  );
};

const SessionDetail: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ id, onClose, onChanged, onShowToast }) => {
  const { user } = useAuth();
  const canMark = user?.role === 'Warden';
  const data = useResource(() => http.get<{ session: StudySession; roster: RosterRow[] }>(`/study-sessions/${id}/roster`), [id]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<'cancel' | null>(null);
  const { run, pending } = useAction(onShowToast);
  useEffect(() => setMarks({}), [data.data]);
  const s = data.data?.session;
  const canEditStatus = s && s.status === 'Scheduled' && (user?.role === 'Warden' || (user?.role === 'Dean' && s.createdByRole === 'Dean'));
  const markable = canMark && s && s.status !== 'Cancelled' && s.date <= todayInput();

  const save = async () => {
    const entries = Object.entries(marks).map(([studentId, status]) => ({ studentId, status }));
    const r = await run(() => http.post(`/study-sessions/${id}/attendance`, { entries }));
    if (r) {
      data.reload();
      onChanged();
    }
  };

  return (
    <Modal
      open
      size="xl"
      title={s ? s.title : 'Study session'}
      description={s ? `${s.dateDisplay} · ${clock12(s.startTime)}–${clock12(s.endTime)} · ${s.location}` : undefined}
      onClose={onClose}
      footer={
        <>
          {canEditStatus && (
            <>
              <Button variant="danger" icon="event_busy" onClick={() => setDialog('cancel')}>
                Cancel session
              </Button>
              {s && s.date <= todayInput() && (
                <Button
                  variant="secondary"
                  icon="task_alt"
                  loading={pending}
                  onClick={async () => {
                    const r = await run(() => http.patch(`/study-sessions/${id}`, { status: 'Completed' }));
                    if (r) {
                      data.reload();
                      onChanged();
                    }
                  }}
                >
                  Mark completed
                </Button>
              )}
            </>
          )}
          {markable && (
            <Button icon="save" disabled={!Object.keys(marks).length} loading={pending} onClick={save}>
              Save attendance {Object.keys(marks).length ? `(${Object.keys(marks).length})` : ''}
            </Button>
          )}
        </>
      }
    >
      <AsyncContent {...data} onRetry={data.reload}>
        {(d) => (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={d.session.status} />
              <Badge tone="blue">
                Marked {d.session.marked}/{d.session.expected}
              </Badge>
              <Badge tone="green">Present {d.session.present}</Badge>
              <Badge tone="amber">Late {d.session.late}</Badge>
              <Badge tone="red">Absent {d.session.absent}</Badge>
              <span className="text-xs text-[var(--kv-text-muted)]">
                Created by {d.session.createdBy} ({d.session.createdByRole})
              </span>
            </div>
            {markable && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="done_all"
                  onClick={() => setMarks(Object.fromEntries(d.roster.filter((r) => r.status === 'Not Marked').map((r) => [r.studentId, 'Present'])))}
                >
                  Mark all unmarked present
                </Button>
              </div>
            )}
            {!markable && canMark && d.session.date > todayInput() && <p className="text-xs text-[var(--kv-text-muted)]">Attendance can be recorded from the session date onwards.</p>}
            <DataTable
              rows={d.roster}
              rowKey={(r) => r.studentId}
              pageSize={15}
              search={(r) => `${r.name} ${r.regNumber} ${r.roomNumber}`}
              emptyTitle="No students in this session's audience"
              columns={[
                { key: 'name', label: 'Student' },
                { key: 'regNumber', label: 'Reg. No' },
                { key: 'roomNumber', label: 'Room' },
                { key: 'department', label: 'Dept / Year', render: (r) => `${r.department} · ${r.year}` },
                {
                  key: 'status',
                  label: 'Attendance',
                  render: (r) =>
                    markable ? (
                      <select
                        aria-label={`Study attendance for ${r.name}`}
                        value={marks[r.studentId] ?? r.status}
                        onChange={(e) => setMarks((m) => ({ ...m, [r.studentId]: e.target.value }))}
                        className={`border rounded-md px-2 py-1 text-sm bg-white ${marks[r.studentId] ? 'border-[var(--kv-primary)]' : 'border-[var(--kv-border)]'}`}
                      >
                        {r.status === 'Not Marked' && <option>Not Marked</option>}
                        {['Present', 'Late', 'Absent', 'Excused'].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge status={r.status} />
                    ),
                },
              ]}
            />
          </div>
        )}
      </AsyncContent>
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="Cancel this study session?"
        message="Students will no longer see it as upcoming. Recorded attendance is kept."
        reasonLabel="Reason"
        reasonRequired
        danger
        confirmLabel="Cancel session"
        pending={pending}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const r = await run(() => http.patch(`/study-sessions/${id}`, { status: 'Cancelled', reason }));
          setDialog(null);
          if (r) {
            data.reload();
            onChanged();
          }
        }}
      />
    </Modal>
  );
};
