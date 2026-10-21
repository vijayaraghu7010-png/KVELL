import React, { useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { http, qs } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { AsyncContent, Badge, Button, Card, DataTable, FilterSelect, KeyValue, Modal, SelectField, Tabs, TextArea, Timeline, StatusBadge, type HistoryEvent } from './ui';

export interface AbsenceCase {
  id: string;
  studentId: string;
  studentName: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  block: string;
  date: string;
  dateDisplay: string;
  session: string;
  status: string;
  detectionNote: string | null;
  authorization: string | null;
  verificationNote: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  followUpUserId: string | null;
  followUpName: string | null;
  followUpRole: string | null;
  followUpNote: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  history?: HistoryEvent[];
}

const VIEWS = [
  { id: 'open', label: 'Needs verification', statuses: 'Pending Verification,Suspected Unauthorized' },
  { id: 'verified', label: 'Verified unauthorized', statuses: 'Verified Unauthorized' },
  { id: 'authorized', label: 'Authorized', statuses: 'Authorized Absence' },
  { id: 'resolved', label: 'Resolved', statuses: 'Resolved' },
  { id: 'all', label: 'All', statuses: '' },
];

/** Absence verification list + detail. Available actions depend on the signed-in role (enforced by the API). */
export const AbsenceCases: React.FC<{ onShowToast: (m: string, e?: boolean) => void; initialCaseId?: string | null; defaultView?: string; onChanged?: () => void }> = ({
  onShowToast,
  initialCaseId,
  defaultView = 'open',
  onChanged,
}) => {
  const [view, setView] = useState(defaultView);
  const [dept, setDept] = useState('');
  const [selected, setSelected] = useState<string | null>(initialCaseId ?? null);
  const statuses = VIEWS.find((v) => v.id === view)?.statuses ?? '';
  const list = useResource(() => http.get<AbsenceCase[]>(`/absences${qs({ status: statuses })}`), [statuses]);
  const rows = useMemo(() => (list.data ?? []).filter((c) => !dept || c.department === dept), [list.data, dept]);

  return (
    <div className="space-y-3">
      <Tabs tabs={VIEWS.map((v) => ({ id: v.id, label: v.label }))} active={view} onChange={setView} />
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {(all) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.studentName} ${r.regNumber} ${r.roomNumber}`}
              onRowClick={(r) => setSelected(r.id)}
              emptyTitle={view === 'open' ? 'No absences awaiting verification' : 'No records'}
              emptyMessage="Absences are created automatically when a student is marked absent without an approved leave, outing or gate exit."
              toolbar={<FilterSelect label="Department" value={dept} onChange={setDept} options={[...new Set(all.map((c) => c.department))].sort()} />}
              columns={[
                { key: 'dateDisplay', label: 'Date', sortValue: (r) => r.date },
                { key: 'studentName', label: 'Student', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.studentName}</span> },
                { key: 'regNumber', label: 'Reg. No' },
                { key: 'department', label: 'Dept / Year', render: (r) => `${r.department} · ${r.year}` },
                { key: 'roomNumber', label: 'Room' },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'followUpName', label: 'Follow-up', render: (r) => (r.followUpName ? `${r.followUpName} (${r.followUpRole})` : '—') },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      <p className="text-[11px] text-[var(--kv-text-muted)]">
        <Badge tone="amber">Note</Badge> “Pending verification” and “Suspected” are not unauthorized absences until the Warden verifies them. Students not recorded in a roll call are reported separately and are never flagged automatically.
      </p>
      {selected && (
        <AbsenceCaseModal
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            list.reload();
            onChanged?.();
          }}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};

export const AbsenceCaseModal: React.FC<{ id: string; onClose: () => void; onChanged: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ id, onClose, onChanged, onShowToast }) => {
  const { user } = useAuth();
  const role = user?.role;
  const detail = useResource(() => http.get<AbsenceCase>(`/absences/${id}`), [id]);
  const staff = useResource(
    () => (role === 'Dean' || role === 'Warden' ? http.get<{ id: string; name: string; role: string; department: string | null }[]>('/meta/staff?roles=HOD,Adviser,Warden') : Promise.resolve([])),
    [role],
  );
  const studentId = detail.data?.studentId;
  const adviser = useResource(
    () => (studentId && (role === 'Dean' || role === 'Warden') ? http.get<{ adviserId: string | null }>(`/${role === 'Dean' ? 'dean' : 'warden'}/students/${studentId}`) : Promise.resolve(null)),
    [studentId],
  );
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const { run, pending } = useAction(onShowToast);
  const c = detail.data;

  const act = async (action: 'verify_unauthorized' | 'authorize' | 'resolve' | 'add_note') => {
    if (!note.trim()) return setNoteError('A note is required for every absence decision.');
    const r = await run(() => http.post(`/absences/${id}/action`, { action, note: note.trim() }));
    if (r) {
      setNote('');
      detail.reload();
      onChanged();
    }
  };
  const requestFollowUp = async () => {
    if (!assignee) return onShowToast('Choose the staff member responsible for the follow-up.', true);
    if (note.trim().length < 5) return setNoteError('Write instructions for the follow-up (at least 5 characters).');
    const r = await run(() => http.post(`/absences/${id}/follow-up`, { assigneeId: assignee, note: note.trim() }));
    if (r) {
      setNote('');
      setAssignee('');
      detail.reload();
      onChanged();
    }
  };

  // Only the student's own adviser, their department's HOD, or a Warden can own the follow-up (enforced server-side).
  const eligible = (staff.data ?? []).filter((s) => s.role === 'Warden' || (c && s.department === c.department && (s.role === 'HOD' || (s.role === 'Adviser' && adviser.data?.adviserId === s.id))));
  const canVerify = role === 'Warden' && c && ['Pending Verification', 'Suspected Unauthorized'].includes(c.status);
  const canResolve = c?.status === 'Verified Unauthorized' && role !== 'Dean';
  const canFollowUp = (role === 'Dean' || role === 'Warden') && c && !['Authorized Absence', 'Resolved'].includes(c.status);

  return (
    <Modal open size="lg" title={c ? `Absence ${c.id}` : 'Absence record'} description={c ? `${c.studentName} · ${c.regNumber} · ${c.dateDisplay} (${c.session})` : undefined} onClose={onClose}>
      <AsyncContent {...detail} onRetry={detail.reload}>
        {(r) => (
          <div className="space-y-5">
            <StatusBadge status={r.status} />
            <KeyValue
              items={[
                ['Department / year', `${r.department} · ${r.year}`],
                ['Room', `${r.roomNumber}${r.block ? ` · ${r.block}` : ''}`],
                ['Detected', r.detectionNote ?? '—'],
                ['Authorization on record', r.authorization ?? 'None found'],
                ['Verification', r.verifiedBy ? `${r.verifiedBy}, ${r.verifiedAt} — ${r.verificationNote}` : 'Not verified yet'],
                ['Follow-up', r.followUpName ? `${r.followUpName} (${r.followUpRole}) — ${r.followUpNote}` : 'None requested'],
                ['Resolution', r.resolvedBy ? `${r.resolvedBy}, ${r.resolvedAt} — ${r.resolutionNote}` : '—'],
              ]}
            />
            {r.status !== 'Resolved' && r.status !== 'Authorized Absence' && (
              <div className="border border-[var(--kv-border)] rounded-xl p-4 space-y-3">
                <TextArea label="Note" required rows={3} value={note} error={noteError} onChange={(e) => (setNote(e.target.value), setNoteError(null))} hint="Recorded in the audit history with your name." />
                <div className="flex flex-wrap gap-2">
                  {canVerify && (
                    <>
                      <Button size="sm" variant="success" icon="verified" loading={pending} onClick={() => act('authorize')}>
                        Mark authorized
                      </Button>
                      <Button size="sm" variant="danger" icon="gpp_bad" loading={pending} onClick={() => act('verify_unauthorized')}>
                        Verify as unauthorized
                      </Button>
                    </>
                  )}
                  {canResolve && (
                    <Button size="sm" icon="task_alt" loading={pending} onClick={() => act('resolve')}>
                      Close after follow-up
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" icon="note_add" loading={pending} onClick={() => act('add_note')}>
                    Add note only
                  </Button>
                </div>
                {canFollowUp && (
                  <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-[var(--kv-border-soft)]">
                    <div className="min-w-[240px] flex-1">
                      <SelectField
                        label="Request follow-up from"
                        value={assignee}
                        placeholder="Choose staff member…"
                        onChange={(e) => setAssignee(e.target.value)}
                        options={eligible.map((s) => ({ value: s.id, label: `${s.name} (${s.role}${s.department ? `, ${s.department}` : ''})` }))}
                      />
                    </div>
                    <Button size="sm" icon="assignment_ind" loading={pending} onClick={requestFollowUp}>
                      Request follow-up
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-[var(--kv-heading)] mb-2">History</h3>
              <Timeline events={r.history} />
            </div>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};
