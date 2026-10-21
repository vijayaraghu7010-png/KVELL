import React, { useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import type { IncidentReport } from '../../types/hod';
import { http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { AsyncContent, Badge, Button, Card, DataTable, FilterSelect, KeyValue, Modal, SelectField, StudentPicker, Tabs, TextArea, TextField, Timeline, StatusBadge, toLocalInput, type HistoryEvent } from './ui';

export const INCIDENT_CATEGORIES = ['Curfew Violation', 'Unauthorized Absence', 'Ragging / Harassment', 'Property Damage', 'Substance Possession', 'Medical Emergency', 'Fight / Altercation', 'Theft', 'Safety Hazard', 'Other'];
type Incident = IncidentReport & { studentId: string | null; incidentAt: string; reporterRole: string; escalationId?: string; history?: HistoryEvent[] };

const sevTone = (s: string) => (s === 'Critical' || s === 'High' ? 'red' : s === 'Medium' ? 'amber' : 'slate');

/** Incident list for Warden (file + notes), HOD (file for own dept, view), Adviser & Dean (view). AO uses its own review module. */
export const Incidents: React.FC<{ onShowToast: (m: string, e?: boolean) => void; studentsEndpoint?: string }> = ({ onShowToast, studentsEndpoint }) => {
  const { user } = useAuth();
  const canFile = user?.role === 'Warden' || user?.role === 'HOD';
  const list = useResource(() => http.get<Incident[]>('/incidents'));
  const [view, setView] = useState('open');
  const [severity, setSeverity] = useState('');
  const [filing, setFiling] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(
    () => (list.data ?? []).filter((i) => (view === 'all' || (view === 'open' ? i.status !== 'Resolved' : i.status === 'Resolved')) && (!severity || i.severity === severity)),
    [list.data, view, severity],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          active={view}
          onChange={setView}
          tabs={[
            { id: 'open', label: 'Open', count: (list.data ?? []).filter((i) => i.status !== 'Resolved').length },
            { id: 'resolved', label: 'Resolved' },
            { id: 'all', label: 'All' },
          ]}
        />
        {canFile && (
          <Button icon="add" onClick={() => setFiling(true)}>
            File incident report
          </Button>
        )}
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.id} ${r.studentName} ${r.regNumber} ${r.incidentCategory}`}
              onRowClick={(r) => setOpenId(r.id)}
              emptyTitle="No incident reports"
              toolbar={<FilterSelect label="Severity" value={severity} onChange={setSeverity} options={['Low', 'Medium', 'High', 'Critical']} />}
              columns={[
                { key: 'id', label: 'Incident', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
                { key: 'incidentDate', label: 'When', sortValue: (r) => r.incidentAt },
                { key: 'incidentCategory', label: 'Category' },
                { key: 'studentName', label: 'Student', render: (r) => `${r.studentName}${r.regNumber !== '—' ? ` (${r.regNumber})` : ''}` },
                { key: 'severity', label: 'Severity', render: (r) => <Badge tone={sevTone(r.severity)}>{r.severity}</Badge> },
                { key: 'reportingWarden', label: 'Reported by' },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {filing && (
        <IncidentForm
          studentsEndpoint={studentsEndpoint ?? (user?.role === 'HOD' ? '/hod/students' : '/warden/students')}
          onClose={() => setFiling(false)}
          onSaved={() => {
            setFiling(false);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      {openId && <IncidentDetail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const IncidentForm: React.FC<{ studentsEndpoint: string; onClose: () => void; onSaved: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ studentsEndpoint, onClose, onSaved, onShowToast }) => {
  const students = useResource(() => http.get<{ id: string; name: string; regNumber: string; roomNumber: string }[]>(studentsEndpoint));
  const [f, setF] = useState({ studentId: '', category: '', severity: 'Medium', incidentAt: toLocalInput(new Date().toISOString()), description: '', actionTaken: '', notes: '', followUpRequired: '', witnesses: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useAction(onShowToast);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!f.category) errs.category = 'Choose a category.';
    if (f.description.trim().length < 15) errs.description = 'Describe what happened (at least 15 characters).';
    if (!f.incidentAt || new Date(f.incidentAt) > new Date()) errs.incidentAt = 'Enter when it happened (not in the future).';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await run(() =>
      http.post('/incidents', {
        studentId: f.studentId || undefined,
        category: f.category,
        severity: f.severity,
        incidentAt: new Date(f.incidentAt).toISOString(),
        description: f.description.trim(),
        actionTaken: f.actionTaken.trim() || undefined,
        notes: f.notes.trim() || undefined,
        followUpRequired: f.followUpRequired.trim() || undefined,
        witnesses: f.witnesses
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean),
      }),
    );
    if (r) onSaved();
  };

  return (
    <Modal
      open
      size="lg"
      title="File incident report"
      description="Sent to the AO office for review. The student's HOD and adviser are notified."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={submit}>
            Submit report
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <StudentPicker
            label="Student involved"
            value={f.studentId}
            onChange={(studentId) => setF((prev) => ({ ...prev, studentId }))}
            options={(students.data ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.regNumber} · Room ${s.roomNumber}` }))}
            placeholder="Search by name, register number or room…"
            hint="Leave empty if the incident is not linked to a specific student."
            clearLabel="Clear the selected student"
          />
        </div>
        <SelectField label="Category" required value={f.category} onChange={set('category')} placeholder="Choose…" options={INCIDENT_CATEGORIES} error={errors.category} />
        <SelectField label="Severity" required value={f.severity} onChange={set('severity')} options={['Low', 'Medium', 'High', 'Critical']} />
        <TextField label="Date & time" type="datetime-local" required value={f.incidentAt} max={toLocalInput(new Date().toISOString())} onChange={set('incidentAt')} error={errors.incidentAt} />
        <div className="sm:col-span-2">
          <TextArea label="What happened" required rows={4} value={f.description} onChange={set('description')} error={errors.description} />
        </div>
        <TextArea label="Action taken so far" rows={2} value={f.actionTaken} onChange={set('actionTaken')} />
        <TextArea label="Warden notes" rows={2} value={f.notes} onChange={set('notes')} />
        <TextField label="Witnesses (comma-separated)" value={f.witnesses} onChange={set('witnesses')} />
        <TextField label="Follow-up required" value={f.followUpRequired} onChange={set('followUpRequired')} />
      </div>
    </Modal>
  );
};

export const IncidentDetail: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ id, onClose, onChanged, onShowToast }) => {
  const { user } = useAuth();
  const d = useResource(() => http.get<Incident>(`/incidents/${id}`), [id]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAction(onShowToast);
  const canNote = user?.role === 'Warden';
  const review = async (status?: string) => {
    if (!note.trim()) return setError('Write a note.');
    const r = await run(() => http.post(`/incidents/${id}/review`, { status, note: note.trim() }));
    if (r) {
      setNote('');
      d.reload();
      onChanged();
    }
  };
  return (
    <Modal open size="lg" title={d.data ? `Incident ${d.data.id}` : 'Incident'} description={d.data ? `${d.data.incidentCategory} · ${d.data.incidentDate}` : undefined} onClose={onClose}>
      <AsyncContent {...d} onRetry={d.reload}>
        {(i) => (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={i.status} />
              <Badge tone={sevTone(i.severity)}>{i.severity} severity</Badge>
              {i.escalationId && <Badge tone="red">Escalated as {i.escalationId}</Badge>}
            </div>
            <KeyValue
              items={[
                ['Student', i.studentName],
                ['Register no / room', `${i.regNumber} · ${i.roomNumber}`],
                ...(i.location ? [['Location', i.location] as [string, string]] : []),
                ['Department / year', `${i.department} · ${i.year}`],
                ['Reported by', `${i.reportingWarden} (${i.reporterRole})`],
                ['Filed', i.submittedDate],
                ['Witnesses', i.witnesses?.length ? i.witnesses.join(', ') : '—'],
                ['Follow-up required', i.followUpRequired || '—'],
              ]}
            />
            <div className="space-y-2 text-sm">
              <p className="bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3 whitespace-pre-wrap">{i.description}</p>
              {i.actionTakenSoFar && (
                <p className="text-[var(--kv-heading)]">
                  <strong>Action taken:</strong> {i.actionTakenSoFar}
                </p>
              )}
              {i.wardenNotes && (
                <p className="text-[var(--kv-heading)]">
                  <strong>Warden notes:</strong> {i.wardenNotes}
                </p>
              )}
            </div>
            {canNote && i.status !== 'Resolved' && (
              <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                <TextArea label="Add an update" rows={2} value={note} error={error} onChange={(e) => (setNote(e.target.value), setError(null))} hint="Escalation and resolution decisions are made by the AO office." />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon="note_add" loading={pending} onClick={() => review()}>
                    Add note
                  </Button>
                  {i.status === 'Pending Review' && (
                    <Button size="sm" icon="search" loading={pending} onClick={() => review('Under Investigation')}>
                      Mark under investigation
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
              <Timeline events={i.history} />
            </div>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};
