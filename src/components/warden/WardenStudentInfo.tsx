import React, { useMemo, useState } from 'react';
import type { StudentRecord } from '../../types';
import type { WardenTabProps } from './WardenPortal';
import { ApiError, http } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { downloadCsv } from '../../services/csv';
import { AsyncContent, Button, Card, Checkbox, DataTable, FilterSelect, KeyValue, Modal, PageHeader, SelectField, StatusBadge, TextArea, TextField } from '../common/ui';

type Student = StudentRecord & {
  departmentName: string;
  block: string | null;
  email: string;
  bloodGroup: string;
  medicalNotes: string;
  adviserName: string | null;
  isDemo: boolean;
};

interface StudentDetail extends Student {
  leaves: {
    id: string;
    type: string;
    dateRange: string;
    workflowStatus: string;
  }[];
  outings: {
    id: string;
    destination: string;
    dateTime: string;
    status: string;
  }[];
  attendanceSummary: { recorded: number; present: number; absent: number };
  absenceCases: { id: string; date: string; status: string }[];
}

export const WardenStudentInfo: React.FC<WardenTabProps> = ({ onShowToast }) => {
  const list = useResource(() => http.get<Student[]>('/warden/students'));
  const [dept, setDept] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => (list.data ?? []).filter((s) => (!dept || s.department === dept) && (!year || s.year === year) && (!status || s.status === status)), [list.data, dept, year, status]);
  const depts = [...new Set((list.data ?? []).map((s) => s.department))].sort();

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Student Information"
        subtitle="Hostel residents with live presence status from approved passes and gate scans."
        icon="group"
        actions={
          <>
            <Button icon="person_add" onClick={() => setAdding(true)}>
              Add student
            </Button>
            <Button
              variant="secondary"
              icon="download"
              disabled={!rows.length}
              onClick={() =>
                downloadCsv(
                  'hostel-residents.csv',
                  [
                    { label: 'Register No', value: (r: Student) => r.regNumber },
                    { label: 'Name', value: (r) => r.name },
                    { label: 'Department', value: (r) => r.department },
                    { label: 'Year', value: (r) => r.year },
                    { label: 'Room', value: (r) => r.roomNumber },
                    { label: 'Status', value: (r) => r.status },
                    { label: 'Phone', value: (r) => r.contactNumber },
                    { label: 'Parent', value: (r) => r.parentName },
                    { label: 'Parent phone', value: (r) => r.parentNumber },
                  ],
                  rows,
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.name} ${r.regNumber} ${r.roomNumber}`}
              onRowClick={(r) => setSelected(r.id)}
              emptyTitle="No residents"
              emptyMessage="Add the first resident with the “Add student” button above."
              toolbar={
                <>
                  <FilterSelect label="Department" value={dept} onChange={setDept} options={depts} />
                  <FilterSelect label="Year" value={year} onChange={setYear} options={['1st Year', '2nd Year', '3rd Year', '4th Year']} />
                  <FilterSelect label="Status" value={status} onChange={setStatus} options={['Present', 'On Leave', 'On Outing']} />
                </>
              }
              columns={[
                {
                  key: 'name',
                  label: 'Student Name',
                  render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span>,
                },
                { key: 'regNumber', label: 'Register Number' },
                { key: 'department', label: 'Department' },
                { key: 'year', label: 'Year' },
                { key: 'roomNumber', label: 'Room Number' },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => <StatusBadge status={r.status === 'Present' ? 'In hostel' : r.status} />,
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (r) => (
                    <Button size="sm" variant="secondary" onClick={(e) => (e.stopPropagation(), setSelected(r.id))}>
                      Details
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {selected && <StudentDetailModal id={selected} onClose={() => setSelected(null)} />}
      {adding && <AddStudent onClose={() => setAdding(false)} onSaved={list.reload} onShowToast={onShowToast} />}
    </div>
  );
};

const StudentDetailModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const detail = useResource(() => http.get<StudentDetail>(`/warden/students/${id}`), [id]);
  const d = detail.data;

  return (
    <Modal
      open
      size="lg"
      title={d ? d.name : 'Student'}
      description={d ? `${d.regNumber} · ${d.departmentName} · ${d.year}` : undefined}
      onClose={onClose}
      footer={
        d?.parentNumber ? (
          <a
            href={`tel:${d.parentNumber.replace(/\s/g, '')}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--kv-border)] px-4 py-2 text-sm font-semibold text-[var(--kv-heading)] hover:bg-[var(--kv-accent-soft)]"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              call
            </span>{' '}
            Call parent
          </a>
        ) : undefined
      }
    >
      <AsyncContent {...detail} onRetry={detail.reload}>
        {(s) => (
          <div className="space-y-5">
            <KeyValue
              cols={3}
              items={[
                ['Room', `${s.roomNumber}${s.block ? ` · ${s.block}` : ''}`],
                ['Current status', <StatusBadge key="st" status={s.status === 'Present' ? 'In hostel' : s.status} />],
                ['Class adviser', s.adviserName ?? 'Not assigned'],
                ['Student phone', s.contactNumber],
                ['Email', s.email],
                ['Gender', s.gender],
                ['Parent / guardian', s.parentName],
                ['Parent phone', s.parentNumber],
                ['Blood group', s.bloodGroup],
                ['Address', s.permanentAddress],
                ['Medical notes', s.medicalNotes || '—'],
                ['Attendance (last 60)', `${s.attendanceSummary.present}/${s.attendanceSummary.recorded} present`],
              ]}
            />
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="font-semibold text-[var(--kv-heading)] mb-2">Recent leave</h3>
                {s.leaves.length === 0 ? (
                  <p className="text-[var(--kv-text-muted)] text-xs">None</p>
                ) : (
                  <ul className="space-y-1.5">
                    {s.leaves.slice(0, 5).map((l) => (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {l.id} · {l.dateRange}
                        </span>
                        <StatusBadge status={l.workflowStatus} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-[var(--kv-heading)] mb-2">Absence records</h3>
                {s.absenceCases.length === 0 ? (
                  <p className="text-[var(--kv-text-muted)] text-xs">None</p>
                ) : (
                  <ul className="space-y-1.5">
                    {s.absenceCases.slice(0, 5).map((c) => (
                      <li key={c.id} className="flex justify-between gap-2">
                        <span>{c.date}</span>
                        <StatusBadge status={c.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
};

/**
 * New student intake. The server generates the sign-in password from the student's own
 * details (first name + first four digits of their phone) and returns it once; it is shown
 * here so the Warden office can hand it over.
 */
const AddStudent: React.FC<{ onClose: () => void; onSaved: () => void; onShowToast: WardenTabProps['onShowToast'] }> = ({ onClose, onSaved, onShowToast }) => {
  const depts = useResource(() => http.get<{ code: string; name: string; sections: string[] }[]>('/meta/departments'));
  const [f, setF] = useState({
    name: '',
    regNumber: '',
    department: '',
    year: '1',
    semester: '',
    gender: '',
    phone: '',
    email: '',
    parentName: '',
    parentPhone: '',
    address: '',
    section: '',
    isHosteller: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ name: string; regNumber: string; password: string | null } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = 'Name is required.';
    if (!f.department) errs.department = 'Choose a department.';
    if (!f.email.trim()) errs.email = 'An email is required for the student sign-in.';
    if (f.phone.replace(/\D/g, '').length < 4) errs.phone = 'A phone number with at least 4 digits is required.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      const res = await http.post<{ initialPassword: string | null; regNumber: string }>('/warden/students', {
        name: f.name.trim(),
        regNumber: f.regNumber.trim() || undefined,
        department: f.department,
        year: Number(f.year),
        semester: f.semester ? Number(f.semester) : undefined,
        gender: f.gender || undefined,
        phone: f.phone.trim(),
        email: f.email.trim(),
        parentName: f.parentName || undefined,
        parentPhone: f.parentPhone || undefined,
        address: f.address || undefined,
        section: f.section || undefined,
        isHosteller: f.isHosteller,
      });
      setCreated({ name: f.name.trim(), regNumber: res.data?.regNumber ?? f.regNumber.trim(), password: res.data?.initialPassword ?? null });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      onShowToast(err instanceof Error ? err.message : 'Could not add the student.', true);
    } finally {
      setPending(false);
    }
  };

  if (created)
    return (
      <Modal
        open
        title="Student added"
        description={`${created.name} · ${created.regNumber}`}
        onClose={onClose}
        footer={
          <Button onClick={onClose} icon="check">
            Done
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--kv-heading)]">The student can sign in with the email you entered and this password:</p>
          <p className="text-center font-mono text-xl font-bold tracking-wide text-[var(--kv-heading)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-xl py-4">
            {created.password ?? 'No sign-in created'}
          </p>
          <p className="text-xs text-[var(--kv-text-muted)]">Generated from the student's first name and the first four digits of their phone number. Note it down — it is shown only now.</p>
        </div>
      </Modal>
    );

  return (
    <Modal
      open
      size="lg"
      title="Add student"
      description="Creates the hostel record and the student's sign-in."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={save} icon="save">
            Save
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <TextField label="Full name" required value={f.name} onChange={set('name')} error={errors.name} />
        <TextField label="Register number" value={f.regNumber} onChange={set('regNumber')} error={errors.regNumber} hint="Optional — leave blank and a provisional number is assigned until the real one is issued." />
        <SelectField label="Department" required value={f.department} onChange={set('department')} placeholder="Choose…" options={(depts.data ?? []).map((d) => d.code)} error={errors.department} />
        <SelectField label="Year" value={f.year} onChange={set('year')} options={['1', '2', '3', '4', '5']} />
        <TextField label="Semester" type="number" min={1} max={10} value={f.semester} onChange={set('semester')} />
        <SelectField label="Gender" value={f.gender} onChange={set('gender')} placeholder="—" options={['Male', 'Female', 'Other']} />
        <TextField label="Phone" required value={f.phone} onChange={set('phone')} error={errors.phone} inputMode="tel" hint="Required — the sign-in password is generated from it." />
        <TextField label="Email" type="email" required value={f.email} onChange={set('email')} error={errors.email} hint="Used as the student's sign-in name." />
        <TextField label="Parent / guardian" value={f.parentName} onChange={set('parentName')} />
        <TextField label="Parent phone" value={f.parentPhone} onChange={set('parentPhone')} error={errors.parentPhone} />
        <div className="sm:col-span-2">
          <TextArea label="Address" rows={2} value={f.address} onChange={set('address')} />
        </div>
        <SelectField
          label="Class section"
          value={f.section}
          onChange={set('section')}
          placeholder="Not assigned"
          options={((depts.data ?? []).find((d) => d.code === f.department)?.sections ?? ['A', 'B']).map((x) => ({ value: x, label: `Section ${x}` }))}
          error={errors.section}
          hint="Routes the student's leave requests to that section's Class Incharge."
        />
        <div className="flex items-end pb-2">
          <Checkbox label="Hostel resident" checked={f.isHosteller} onChange={(v) => setF({ ...f, isHosteller: v })} />
        </div>
      </div>
    </Modal>
  );
};
