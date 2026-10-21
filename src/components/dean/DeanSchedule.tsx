import React, { useMemo, useState } from 'react';
import { ApiError, http, qs } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { AsyncContent, Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, FilterSelect, KeyValue, Modal, PageHeader, SelectField, StatusBadge, Tabs, TextArea, TextField, Timeline, cx, fromLocalInput, toLocalInput, type HistoryEvent, clock12 } from '../common/ui';
import { RecipientSelector, emptySelector, type ResolvedRecipient, type Selector } from './RecipientSelector';

const CATEGORIES = ['HOD Meeting', 'Adviser Meeting', 'Department Progress Review', 'Academic Performance Review', 'Student Support Review', 'Study Session Monitoring', 'Report Deadline', 'Follow-up Meeting', 'Other'];
type Toast = (m: string, e?: boolean) => void;

interface Schedule {
  id: string;
  title: string;
  description: string | null;
  category: string;
  startAt: string;
  endAt: string;
  startDisplay: string;
  endDisplay: string;
  location: string | null;
  department: string | null;
  studySessionId: string | null;
  instructions: string | null;
  requiresAck: boolean;
  reminderMinutes: number | null;
  status: 'Scheduled' | 'Rescheduled' | 'Cancelled' | 'Completed';
  conflictOverrideReason: string | null;
  organizer: string;
  participantCount: number;
  acknowledged: number;
  declined: number;
  pending: number;
  isPast: boolean;
  participants?: { userId: string; name: string; role: string; department: string; response: string; responseNote: string | null; respondedAt: string | null }[];
  history?: HistoryEvent[];
}

const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const chipTone = (s: Schedule) => (s.status === 'Cancelled' ? 'bg-slate-100 text-slate-500 line-through' : s.status === 'Completed' ? 'bg-emerald-50 text-emerald-800' : s.status === 'Rescheduled' ? 'bg-amber-50 text-amber-800' : 'bg-[var(--kv-surface-alt)] text-[var(--kv-heading)]');

export const DeanSchedule: React.FC<{ onShowToast: Toast; openId: string | null; onOpen: (id: string | null) => void }> = ({ onShowToast, openId, onOpen }) => {
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(new Date());
  const [category, setCategory] = useState('');
  const [dept, setDept] = useState('');
  const [participant, setParticipant] = useState('');
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const depts = useResource(() => http.get<{ code: string }[]>('/meta/departments'));
  const staff = useResource(() => http.get<{ id: string; name: string; role: string }[]>('/meta/staff?roles=HOD,Adviser'));

  const range = useMemo(() => {
    if (view === 'day') return [cursor, cursor];
    if (view === 'week') return [startOfWeek(cursor), addDays(startOfWeek(cursor), 6)];
    if (view === 'month') {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      return [startOfWeek(first), addDays(startOfWeek(first), 41)];
    }
    return [addDays(new Date(), view === 'past' ? -365 : -1), addDays(new Date(), view === 'past' ? 0 : 365)];
  }, [view, cursor]);

  const list = useResource(
    () => http.get<Schedule[]>(`/work/schedules${qs({ from: ymd(range[0]), to: ymd(range[1]), category, department: dept, participant })}`),
    [ymd(range[0]), ymd(range[1]), category, dept, participant],
  );
  const items = useMemo(() => {
    const all = list.data ?? [];
    if (view === 'upcoming') return all.filter((s) => !s.isPast && s.status !== 'Cancelled');
    if (view === 'past') return all.filter((s) => s.isPast || s.status === 'Completed');
    if (view === 'cancelled') return all.filter((s) => s.status === 'Cancelled');
    return all;
  }, [list.data, view]);
  const byDay = useMemo(() => {
    const m = new Map<string, Schedule[]>();
    items.forEach((s) => {
      const k = ymd(new Date(s.startAt));
      m.set(k, [...(m.get(k) ?? []), s]);
    });
    return m;
  }, [items]);

  const shift = (n: number) => setCursor((c) => (view === 'day' ? addDays(c, n) : view === 'week' ? addDays(c, 7 * n) : new Date(c.getFullYear(), c.getMonth() + n, 1)));
  const label = view === 'day' ? cursor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : view === 'week' ? `${range[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${range[1].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const calendarView = ['month', 'week', 'day'].includes(view);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Scheduling & Calendar"
        subtitle="Meetings, reviews and monitoring activities for HODs and Advisers. Participants see them in their own portals."
        icon="calendar_month"
        actions={
          <Button icon="add" onClick={() => setEditing('new')}>
            Schedule activity
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'month', label: 'Month' },
            { id: 'week', label: 'Week' },
            { id: 'day', label: 'Day' },
            { id: 'upcoming', label: 'Upcoming list' },
            { id: 'past', label: 'Past' },
            { id: 'cancelled', label: 'Cancelled' },
          ]}
        />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={CATEGORIES} />
        <FilterSelect label="Department" value={dept} onChange={setDept} options={(depts.data ?? []).map((d) => d.code)} />
        <FilterSelect label="Participant" value={participant} onChange={setParticipant} options={(staff.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.role})` }))} />
      </div>
      {calendarView && (
        <div className="flex items-center gap-2 mb-3">
          <Button size="sm" variant="secondary" icon="chevron_left" onClick={() => shift(-1)}>
            <span className="sr-only">Previous</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <Button size="sm" variant="secondary" icon="chevron_right" onClick={() => shift(1)}>
            <span className="sr-only">Next</span>
          </Button>
          <span className="font-semibold text-[var(--kv-heading)] ml-2">{label}</span>
        </div>
      )}
      <AsyncContent {...list} onRetry={list.reload}>
        {() =>
          view === 'month' ? (
            <div className="bg-white border border-[var(--kv-border)] rounded-xl overflow-x-auto">
              <div className="grid grid-cols-7 min-w-[720px]">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <div key={d} className="px-2 py-1.5 text-xs font-semibold text-[var(--kv-text-muted)] border-b border-[var(--kv-border-soft)]">
                    {d}
                  </div>
                ))}
                {Array.from({ length: 42 }).map((_, i) => {
                  const day = addDays(range[0], i);
                  const k = ymd(day);
                  const inMonth = day.getMonth() === cursor.getMonth();
                  return (
                    <div key={k} className={cx('min-h-[96px] border-b border-r border-[var(--kv-border-soft)] p-1.5', !inMonth && 'bg-slate-50/60')}>
                      <button type="button" onClick={() => (setCursor(day), setView('day'))} className={cx('text-xs font-semibold rounded px-1', k === ymd(new Date()) ? 'bg-[var(--kv-primary)] text-white' : inMonth ? 'text-[var(--kv-heading)]' : 'text-slate-400')}>
                        {day.getDate()}
                      </button>
                      <div className="space-y-1 mt-1">
                        {(byDay.get(k) ?? []).slice(0, 3).map((s) => (
                          <button key={s.id} type="button" onClick={() => onOpen(s.id)} className={cx('block w-full text-left text-[11px] rounded px-1.5 py-0.5 truncate', chipTone(s))} title={`${s.title} (${s.status})`}>
                            {time(s.startAt)} {s.title}
                          </button>
                        ))}
                        {(byDay.get(k)?.length ?? 0) > 3 && <span className="text-[10px] text-[var(--kv-text-muted)]">+{byDay.get(k)!.length - 3} more</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : view === 'week' || view === 'day' ? (
            <div className={cx('grid gap-3', view === 'week' ? 'md:grid-cols-7' : 'grid-cols-1')}>
              {Array.from({ length: view === 'week' ? 7 : 1 }).map((_, i) => {
                const day = addDays(range[0], i);
                const list2 = byDay.get(ymd(day)) ?? [];
                return (
                  <Card key={i} title={day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} bodyClassName="p-2">
                    {list2.length === 0 ? (
                      <p className="text-xs text-[var(--kv-text-muted)] p-1">Nothing scheduled</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {list2.map((s) => (
                          <li key={s.id}>
                            <button type="button" onClick={() => onOpen(s.id)} className={cx('w-full text-left text-xs rounded-lg p-2', chipTone(s))}>
                              <span className="font-semibold block">
                                {time(s.startAt)}–{time(s.endAt)}
                              </span>
                              {s.title}
                              <span className="block opacity-80">
                                {s.acknowledged}/{s.participantCount} acknowledged
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <DataTable
                rows={items}
                rowKey={(s) => s.id}
                search={(s) => `${s.title} ${s.category} ${s.location ?? ''}`}
                onRowClick={(s) => onOpen(s.id)}
                emptyTitle="No activities"
                columns={[
                  { key: 'startAt', label: 'When', sortValue: (s) => s.startAt, render: (s) => s.startDisplay },
                  { key: 'title', label: 'Activity', render: (s) => <span className="font-semibold text-[var(--kv-heading)]">{s.title}</span> },
                  { key: 'category', label: 'Category' },
                  { key: 'location', label: 'Location', render: (s) => s.location ?? '—' },
                  { key: 'responses', label: 'Responses', render: (s) => `${s.acknowledged} ack · ${s.declined} declined · ${s.pending} pending` },
                  { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.status} /> },
                ]}
              />
            </Card>
          )
        }
      </AsyncContent>
      {editing && (
        <ScheduleForm
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      {openId && (
        <ScheduleDetail
          id={openId}
          onClose={() => onOpen(null)}
          onEdit={(s) => {
            onOpen(null);
            setEditing(s);
          }}
          onChanged={list.reload}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};

const ScheduleForm: React.FC<{ existing: Schedule | null; onClose: () => void; onSaved: () => void; onShowToast: Toast }> = ({ existing, onClose, onSaved, onShowToast }) => {
  const start = existing ? new Date(existing.startAt) : new Date(Date.now() + 86_400_000);
  if (!existing) start.setHours(10, 0, 0, 0);
  const [f, setF] = useState({
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    category: existing?.category ?? 'HOD Meeting',
    startAt: toLocalInput(start.toISOString()),
    endAt: toLocalInput(existing?.endAt ?? new Date(start.getTime() + 3_600_000).toISOString()),
    location: existing?.location ?? '',
    department: existing?.department ?? '',
    studySessionId: existing?.studySessionId ?? '',
    instructions: existing?.instructions ?? '',
    requiresAck: existing?.requiresAck ?? true,
    reminderMinutes: existing?.reminderMinutes ? String(existing.reminderMinutes) : '60',
    changeReason: '',
    overrideReason: '',
  });
  const initialSelector: Selector = existing?.participants ? { ...emptySelector(), userIds: existing.participants.map((p) => p.userId) } : emptySelector();
  const [selector, setSelector] = useState<Selector>(initialSelector);
  const [resolved, setResolved] = useState<ResolvedRecipient[]>([]);
  const [conflicts, setConflicts] = useState<{ title: string; participant: string; when: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const depts = useResource(() => http.get<{ code: string }[]>('/meta/departments'));
  const sessions = useResource(() => http.get<{ id: string; title: string; dateDisplay: string; startTime: string; status: string }[]>('/study-sessions'));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const timeChanged = !!existing && (fromLocalInput(f.startAt) !== existing.startAt || fromLocalInput(f.endAt) !== existing.endAt);

  const save = async () => {
    const errs: Record<string, string> = {};
    if (f.title.trim().length < 3) errs.title = 'Enter a title.';
    if (!f.startAt || !f.endAt || new Date(f.endAt) <= new Date(f.startAt)) errs.endAt = 'End must be after the start.';
    if ((!existing || timeChanged) && new Date(f.startAt) < new Date()) errs.startAt = 'The activity cannot start in the past.';
    if (!resolved.length) errs.participants = 'Choose at least one participant.';
    if (timeChanged && f.changeReason.trim().length < 3) errs.changeReason = 'Give a reason for rescheduling.';
    if (conflicts.length && f.overrideReason.trim().length < 5) errs.overrideReason = 'Explain why the conflict is acceptable.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    const body = {
      ...f,
      title: f.title.trim(),
      description: f.description.trim() || undefined,
      startAt: fromLocalInput(f.startAt),
      endAt: fromLocalInput(f.endAt),
      location: f.location.trim() || undefined,
      department: f.department || undefined,
      studySessionId: f.studySessionId || undefined,
      instructions: f.instructions.trim() || undefined,
      reminderMinutes: f.reminderMinutes ? Number(f.reminderMinutes) : undefined,
      overrideReason: f.overrideReason.trim() || undefined,
      changeReason: f.changeReason.trim() || undefined,
      participants: selector,
      confirmCount: resolved.length,
    };
    try {
      const res = existing ? await http.patch(`/work/schedules/${existing.id}`, body) : await http.post('/work/schedules', body);
      onShowToast(res.message || 'Saved.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.conflicts) {
        setConflicts(err.details.conflicts);
        onShowToast('Some participants have overlapping activities. Review the conflicts below.', true);
      } else {
        if (err instanceof ApiError) setErrors(err.fields);
        onShowToast(err instanceof Error ? err.message : 'Could not save.', true);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      size="xl"
      title={existing ? `Edit ${existing.id}` : 'Schedule an activity'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="event_available" loading={pending} onClick={save}>
            {conflicts.length ? 'Save with override' : existing ? 'Save changes' : `Schedule for ${resolved.length} participant(s)`}
          </Button>
        </>
      }
    >
      <div className="grid md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <TextField label="Title" required value={f.title} onChange={set('title')} error={errors.title} />
        </div>
        <SelectField label="Category" value={f.category} onChange={set('category')} options={CATEGORIES} />
        <TextField label="Location / meeting link" value={f.location} onChange={set('location')} />
        <TextField label="Start" type="datetime-local" required value={f.startAt} onChange={(e) => (setF({ ...f, startAt: e.target.value }), setConflicts([]))} error={errors.startAt} />
        <TextField label="End" type="datetime-local" required value={f.endAt} onChange={(e) => (setF({ ...f, endAt: e.target.value }), setConflicts([]))} error={errors.endAt} />
        <SelectField label="Department (optional)" value={f.department} onChange={set('department')} placeholder="All / not department-specific" options={(depts.data ?? []).map((d) => d.code)} />
        <SelectField
          label="Linked study session (optional)"
          value={f.studySessionId}
          onChange={set('studySessionId')}
          placeholder="None"
          options={(sessions.data ?? []).filter((s) => s.status !== 'Cancelled').map((s) => ({ value: s.id, label: `${s.dateDisplay} ${clock12(s.startTime)} · ${s.title}` }))}
          hint="For monitoring an existing Warden study session — this does not create a second session."
        />
        <TextArea label="Description" rows={2} value={f.description} onChange={set('description')} />
        <TextArea label="Instructions for participants" rows={2} value={f.instructions} onChange={set('instructions')} />
        <SelectField
          label="In-app reminder"
          value={f.reminderMinutes}
          onChange={set('reminderMinutes')}
          options={[
            { value: '', label: 'No reminder' },
            { value: '30', label: '30 minutes before' },
            { value: '60', label: '1 hour before' },
            { value: '1440', label: '1 day before' },
          ]}
        />
        <div className="flex items-end pb-2">
          <Checkbox label="Participants must acknowledge" checked={f.requiresAck} onChange={(v) => setF({ ...f, requiresAck: v })} />
        </div>
        {timeChanged && (
          <div className="md:col-span-2">
            <TextField label="Reason for rescheduling" required value={f.changeReason} onChange={set('changeReason')} error={errors.changeReason} hint="Participants are notified and asked to acknowledge again." />
          </div>
        )}
        <div className="md:col-span-2">
          <RecipientSelector value={selector} onChange={(s) => (setSelector(s), setConflicts([]))} onResolved={setResolved} error={errors.participants} />
        </div>
        {conflicts.length > 0 && (
          <div className="md:col-span-2 border border-amber-300 bg-amber-50 rounded-xl p-4 space-y-2" role="alert">
            <p className="text-sm font-semibold text-amber-900">Scheduling conflicts</p>
            <ul className="text-xs text-amber-900 list-disc pl-5">
              {conflicts.map((c, i) => (
                <li key={i}>
                  {c.participant}: “{c.title}” {c.when}
                </li>
              ))}
            </ul>
            <TextField label="Override reason (recorded)" required value={f.overrideReason} onChange={set('overrideReason')} error={errors.overrideReason} />
          </div>
        )}
      </div>
    </Modal>
  );
};

const ScheduleDetail: React.FC<{ id: string; onClose: () => void; onEdit: (s: Schedule) => void; onChanged: () => void; onShowToast: Toast }> = ({ id, onClose, onEdit, onChanged, onShowToast }) => {
  const d = useResource(() => http.get<Schedule>(`/work/schedules/${id}`), [id]);
  const [dialog, setDialog] = useState<'cancel' | 'complete' | null>(null);
  const { run, pending } = useAction(onShowToast);
  const s = d.data;
  const active = s && ['Scheduled', 'Rescheduled'].includes(s.status);
  return (
    <Modal
      open
      size="lg"
      title={s ? s.title : 'Activity'}
      description={s ? `${s.startDisplay} – ${s.endDisplay}` : undefined}
      onClose={onClose}
      footer={
        active ? (
          <>
            <Button variant="danger" icon="event_busy" onClick={() => setDialog('cancel')}>
              Cancel activity
            </Button>
            {s!.isPast || new Date(s!.startAt) <= new Date() ? (
              <Button variant="secondary" icon="task_alt" onClick={() => setDialog('complete')}>
                Mark completed
              </Button>
            ) : null}
            <Button icon="edit" onClick={() => onEdit(s!)}>
              Edit / reschedule
            </Button>
          </>
        ) : undefined
      }
    >
      <AsyncContent {...d} onRetry={d.reload}>
        {(x) => (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={x.status} />
              <Badge tone="blue">{x.category}</Badge>
              {x.conflictOverrideReason && <Badge tone="amber">Conflict override: {x.conflictOverrideReason}</Badge>}
            </div>
            <KeyValue
              items={[
                ['Location / link', x.location ?? '—'],
                ['Department', x.department ?? '—'],
                ['Organizer', x.organizer],
                ['Linked study session', x.studySessionId ?? '—'],
                ['Acknowledgement', x.requiresAck ? 'Required' : 'Not required'],
                ['Reminder', x.reminderMinutes ? `${x.reminderMinutes} min before (in-app)` : 'None'],
              ]}
            />
            {x.description && <p className="text-sm whitespace-pre-wrap">{x.description}</p>}
            {x.instructions && <p className="text-sm whitespace-pre-wrap bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3">{x.instructions}</p>}
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">
                Participants — {x.acknowledged} acknowledged · {x.declined} declined · {x.pending} pending
              </h3>
              <DataTable
                rows={x.participants ?? []}
                rowKey={(p) => p.userId}
                pageSize={10}
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'role', label: 'Role', render: (p) => `${p.role} · ${p.department}` },
                  { key: 'response', label: 'Response', render: (p) => <StatusBadge status={p.response} /> },
                  { key: 'responseNote', label: 'Note', render: (p) => p.responseNote ?? '—' },
                  { key: 'respondedAt', label: 'When', render: (p) => p.respondedAt ?? '—' },
                ]}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
              <Timeline events={x.history} />
            </div>
          </div>
        )}
      </AsyncContent>
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="Cancel this activity?"
        message="All participants are notified. The activity stays on record as cancelled."
        reasonLabel="Reason"
        reasonRequired
        danger
        confirmLabel="Cancel activity"
        pending={pending}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const r = await run(() => http.post(`/work/schedules/${id}/cancel`, { reason }));
          setDialog(null);
          if (r) {
            d.reload();
            onChanged();
          }
        }}
      />
      <ConfirmDialog
        open={dialog === 'complete'}
        title="Mark as completed?"
        message="Record any outcome notes for the history."
        reasonLabel="Notes (optional)"
        confirmLabel="Mark completed"
        pending={pending}
        onClose={() => setDialog(null)}
        onConfirm={async (note) => {
          const r = await run(() => http.post(`/work/schedules/${id}/complete`, { note: note || undefined }));
          setDialog(null);
          if (r) {
            d.reload();
            onChanged();
          }
        }}
      />
    </Modal>
  );
};
