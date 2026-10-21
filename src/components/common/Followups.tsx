import React, { useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, http, qs } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { AsyncContent, Button, Card, DataTable, FilterSelect, KeyValue, Modal, SelectField, Tabs, TextArea, TextField, Timeline, StatusBadge, todayInput, type HistoryEvent } from './ui';

export interface Followup {
  id: string;
  studentId: string;
  studentName: string;
  regNumber: string;
  department: string;
  year: string;
  ownerId: string;
  ownerName: string;
  ownerRole: string;
  category: string;
  title: string;
  notes: string | null;
  status: 'Open' | 'In Progress' | 'Completed' | 'Cancelled';
  dueDate: string | null;
  dueDisplay: string | null;
  isOverdue: boolean;
  sessionDate: string | null;
  outcome: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  history?: HistoryEvent[];
}

const CATEGORIES = ['Academic Support', 'Mentoring Session', 'Absence Follow-up', 'Study Session', 'Disciplinary', 'Other'];

/** Student follow-ups & mentoring sessions. HOD can switch between own items and the whole department. */
export const Followups: React.FC<{ studentsEndpoint?: string; onShowToast: (m: string, e?: boolean) => void; readOnly?: boolean }> = ({ studentsEndpoint, onShowToast, readOnly }) => {
  const { user } = useAuth();
  const [scope, setScope] = useState(user?.role === 'HOD' ? 'department' : 'mine');
  const [status, setStatus] = useState('open');
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useResource(() => http.get<Followup[]>(`/followups${qs({ mine: scope === 'mine' ? '1' : undefined })}`), [scope]);
  const rows = useMemo(
    () =>
      (list.data ?? []).filter(
        (f) => (status === 'all' || (status === 'open' ? ['Open', 'In Progress'].includes(f.status) : status === 'overdue' ? f.isOverdue : f.status === 'Completed')) && (!category || f.category === category),
      ),
    [list.data, status, category],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {user?.role === 'HOD' && (
            <Tabs
              active={scope}
              onChange={setScope}
              tabs={[
                { id: 'department', label: 'Department' },
                { id: 'mine', label: 'Mine' },
              ]}
            />
          )}
          <Tabs
            active={status}
            onChange={setStatus}
            tabs={[
              { id: 'open', label: 'Open' },
              { id: 'overdue', label: 'Overdue', count: (list.data ?? []).filter((f) => f.isOverdue).length },
              { id: 'completed', label: 'Completed' },
              { id: 'all', label: 'All' },
            ]}
          />
        </div>
        {!readOnly && studentsEndpoint && (
          <Button icon="add" onClick={() => setCreating(true)}>
            New follow-up / mentoring session
          </Button>
        )}
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(f) => f.id}
              search={(f) => `${f.studentName} ${f.regNumber} ${f.title} ${f.ownerName}`}
              onRowClick={(f) => setOpenId(f.id)}
              emptyTitle="No follow-ups in this view"
              toolbar={<FilterSelect label="Category" value={category} onChange={setCategory} options={CATEGORIES} />}
              columns={[
                { key: 'studentName', label: 'Student', render: (f) => <span className="font-semibold text-[var(--kv-heading)]">{f.studentName}</span> },
                { key: 'category', label: 'Category' },
                { key: 'title', label: 'Title' },
                { key: 'ownerName', label: 'Owner', render: (f) => `${f.ownerName} (${f.ownerRole})` },
                { key: 'dueDate', label: 'Due', sortValue: (f) => f.dueDate, render: (f) => f.dueDisplay ?? '—' },
                { key: 'status', label: 'Status', render: (f) => <StatusBadge status={f.status} overdue={f.isOverdue} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {creating && studentsEndpoint && (
        <FollowupForm
          studentsEndpoint={studentsEndpoint}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      {openId && <FollowupDetail id={openId} canEdit={!readOnly} onClose={() => setOpenId(null)} onChanged={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const FollowupForm: React.FC<{ studentsEndpoint: string; onClose: () => void; onSaved: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ studentsEndpoint, onClose, onSaved, onShowToast }) => {
  const students = useResource(() => http.get<{ id: string; name: string; regNumber: string }[]>(studentsEndpoint));
  const [f, setF] = useState({ studentId: '', category: 'Academic Support', title: '', notes: '', dueDate: '', sessionDate: '', outcome: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const isSession = f.category === 'Mentoring Session';
  const save = async () => {
    const errs: Record<string, string> = {};
    if (!f.studentId) errs.studentId = 'Choose a student.';
    if (!f.title.trim()) errs.title = 'Title is required.';
    if (isSession && f.sessionDate && !f.outcome.trim()) errs.outcome = 'Record what was discussed / agreed.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      const res = await http.post('/followups', {
        studentId: f.studentId,
        category: f.category,
        title: f.title.trim(),
        notes: f.notes.trim() || undefined,
        dueDate: f.dueDate || undefined,
        sessionDate: f.sessionDate || undefined,
        outcome: f.outcome.trim() || undefined,
      });
      onShowToast(res.message || 'Saved.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      onShowToast(err instanceof Error ? err.message : 'Could not save.', true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open
      title="New follow-up"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <SelectField label="Student" required value={f.studentId} onChange={set('studentId')} placeholder="Choose…" options={(students.data ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.regNumber}` }))} error={errors.studentId} />
        </div>
        <SelectField label="Category" value={f.category} onChange={set('category')} options={CATEGORIES} />
        <TextField label="Title" required value={f.title} onChange={set('title')} error={errors.title} placeholder={isSession ? 'e.g. Monthly mentoring' : 'e.g. Improve internal marks in DBMS'} />
        {isSession ? (
          <TextField label="Session date" type="date" max={todayInput()} value={f.sessionDate} onChange={set('sessionDate')} hint="Leave blank to plan a future session" />
        ) : (
          <TextField label="Due date" type="date" min={todayInput()} value={f.dueDate} onChange={set('dueDate')} />
        )}
        <div className="sm:col-span-2">
          <TextArea label="Notes / plan" rows={3} value={f.notes} onChange={set('notes')} />
        </div>
        {isSession && (
          <div className="sm:col-span-2">
            <TextArea label="Outcome / agreed actions" rows={2} value={f.outcome} onChange={set('outcome')} error={errors.outcome} />
          </div>
        )}
      </div>
    </Modal>
  );
};

const FollowupDetail: React.FC<{ id: string; canEdit: boolean; onClose: () => void; onChanged: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ id, canEdit, onClose, onChanged, onShowToast }) => {
  const { user } = useAuth();
  const d = useResource(() => http.get<Followup>(`/followups/${id}`), [id]);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('');
  const { run, pending } = useAction(onShowToast);
  const f = d.data;
  const mine = f?.ownerId === user?.id && canEdit;
  const update = async (status?: string) => {
    const r = await run(() => http.patch(`/followups/${id}`, { status, note: note.trim() || undefined, outcome: outcome.trim() || undefined }));
    if (r) {
      setNote('');
      d.reload();
      onChanged();
    }
  };
  return (
    <Modal open size="lg" title={f?.title ?? 'Follow-up'} description={f ? `${f.studentName} · ${f.regNumber} · ${f.category}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(x) => (
          <div className="space-y-4">
            <StatusBadge status={x.status} overdue={x.isOverdue} />
            <KeyValue
              items={[
                ['Owner', `${x.ownerName} (${x.ownerRole})`],
                ['Created by', `${x.createdBy}, ${x.createdAt}`],
                ['Due', x.dueDisplay ?? '—'],
                ['Session date', x.sessionDate ?? '—'],
                ['Source', x.sourceType ? `${x.sourceType.replace('_', ' ')} ${x.sourceId}` : '—'],
                ['Completed', x.completedAt ?? '—'],
              ]}
            />
            {x.notes && <p className="text-sm bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 whitespace-pre-wrap">{x.notes}</p>}
            {x.outcome && (
              <p className="text-sm">
                <strong>Outcome:</strong> {x.outcome}
              </p>
            )}
            {mine && ['Open', 'In Progress'].includes(x.status) && (
              <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                <TextArea label="Progress note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <TextArea label="Outcome (required to complete)" rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  {x.status === 'Open' && (
                    <Button size="sm" variant="secondary" loading={pending} onClick={() => update('In Progress')}>
                      Start
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" loading={pending} disabled={!note.trim()} onClick={() => update()}>
                    Add note
                  </Button>
                  <Button size="sm" variant="success" icon="task_alt" loading={pending} onClick={() => update('Completed')}>
                    Complete
                  </Button>
                  <Button size="sm" variant="danger" loading={pending} onClick={() => update('Cancelled')}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {x.sourceType === 'absence_case' && x.status !== 'Completed' && mine && (
              <p className="text-xs text-[var(--kv-text-muted)]">Closing the linked absence record (Attendance → Absences) also completes this follow-up.</p>
            )}
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
              <Timeline events={x.history} />
            </div>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};
