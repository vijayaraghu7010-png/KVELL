import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { AsyncContent, Badge, Button, Card, ConfirmDialog, DataTable, Modal, SelectField, TextArea, TextField } from './ui';

interface AcademicRecord {
  id: string;
  studentId: string;
  studentName: string;
  regNumber: string;
  department: string;
  year: string;
  academicYear: string;
  semester: number;
  assessment: string;
  percentage: number;
  sgpa: number | null;
  arrears: number;
  remarks: string | null;
  source: string;
  enteredBy: string;
}

const ASSESSMENTS = ['Internal 1', 'Internal 2', 'Internal 3', 'Model Exam', 'Semester Exam'];
const currentAcademicYear = () => {
  const d = new Date();
  const start = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(2)}`;
};

/**
 * Approved academic results for the caller's authorized students (adviser: advisees, HOD: department).
 * Entering a record for an existing assessment corrects it (audited); nothing is derived or invented.
 */
export const AcademicRecords: React.FC<{ studentsEndpoint: string; onShowToast: (m: string, e?: boolean) => void }> = ({ studentsEndpoint, onShowToast }) => {
  const { user } = useAuth();
  const list = useResource(() => http.get<AcademicRecord[]>('/academics/records'));
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<AcademicRecord | null>(null);
  const { run, pending } = useAction(onShowToast);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between gap-2 items-center">
        <p className="text-sm text-[var(--kv-text-muted)] max-w-2xl">Enter only results approved by the examination cell. Support flags use the thresholds configured by the Dean/Admin.</p>
        <div className="flex gap-2">
          <Button variant="secondary" icon="upload_file" onClick={() => setImporting(true)}>
            Import CSV
          </Button>
          <Button icon="add" onClick={() => setAdding(true)}>
            Add record
          </Button>
        </div>
      </div>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              search={(r) => `${r.studentName} ${r.regNumber} ${r.assessment} ${r.academicYear}`}
              emptyTitle="No academic records yet"
              emptyMessage="Add records one at a time or import a CSV."
              columns={[
                { key: 'studentName', label: 'Student', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.studentName}</span> },
                { key: 'regNumber', label: 'Reg. No' },
                { key: 'academicYear', label: 'Acad. year' },
                { key: 'semester', label: 'Sem' },
                { key: 'assessment', label: 'Assessment' },
                { key: 'percentage', label: '%', render: (r) => `${r.percentage}%` },
                { key: 'sgpa', label: 'SGPA', render: (r) => r.sgpa ?? '—' },
                { key: 'arrears', label: 'Arrears' },
                { key: 'source', label: 'Source', render: (r) => <Badge tone="slate">{r.source === 'import' ? 'CSV import' : 'Manual'}</Badge> },
                { key: 'enteredBy', label: 'Entered by' },
                {
                  key: 'del',
                  label: '',
                  render: (r) =>
                    user?.role === 'HOD' || user?.role === 'Admin' || r.enteredBy === user?.name ? (
                      <Button size="sm" variant="ghost" icon="delete" onClick={() => setToDelete(r)}>
                        <span className="sr-only">Delete record</span>
                      </Button>
                    ) : null,
                },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {adding && (
        <AddRecord
          studentsEndpoint={studentsEndpoint}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      {importing && (
        <ImportCsv
          onClose={() => setImporting(false)}
          onSaved={() => {
            setImporting(false);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete this academic record?"
        message={toDelete ? `${toDelete.studentName} — ${toDelete.assessment}, semester ${toDelete.semester} (${toDelete.percentage}%). The deletion is recorded in the audit log.` : ''}
        danger
        confirmLabel="Delete"
        pending={pending}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          const r = await run(() => http.del(`/academics/records/${toDelete!.id}`));
          setToDelete(null);
          if (r) list.reload();
        }}
      />
    </div>
  );
};

const AddRecord: React.FC<{ studentsEndpoint: string; onClose: () => void; onSaved: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ studentsEndpoint, onClose, onSaved, onShowToast }) => {
  const students = useResource(() => http.get<{ id: string; name: string; regNumber: string }[]>(studentsEndpoint));
  const [f, setF] = useState({ studentId: '', academicYear: currentAcademicYear(), semester: '1', assessment: 'Internal 1', percentage: '', sgpa: '', arrears: '0', remarks: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const errs: Record<string, string> = {};
    if (!f.studentId) errs.studentId = 'Choose a student.';
    const pct = Number(f.percentage);
    if (f.percentage === '' || !(pct >= 0 && pct <= 100)) errs.percentage = 'Enter a percentage between 0 and 100.';
    if (f.sgpa && !(Number(f.sgpa) >= 0 && Number(f.sgpa) <= 10)) errs.sgpa = 'SGPA must be between 0 and 10.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      const res = await http.post('/academics/records', {
        studentId: f.studentId,
        academicYear: f.academicYear,
        semester: Number(f.semester),
        assessment: f.assessment,
        percentage: pct,
        sgpa: f.sgpa ? Number(f.sgpa) : undefined,
        arrears: Number(f.arrears || 0),
        remarks: f.remarks || undefined,
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
      title="Add academic record"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={save}>
            Save record
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <SelectField label="Student" required value={f.studentId} onChange={set('studentId')} placeholder="Choose…" options={(students.data ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.regNumber}` }))} error={errors.studentId} />
        </div>
        <TextField label="Academic year" required value={f.academicYear} onChange={set('academicYear')} hint="Format 2026-27" error={errors.academicYear} />
        <SelectField label="Semester" required value={f.semester} onChange={set('semester')} options={Array.from({ length: 10 }, (_, i) => String(i + 1))} />
        <SelectField label="Assessment" required value={f.assessment} onChange={set('assessment')} options={ASSESSMENTS} />
        <TextField label="Percentage" type="number" min={0} max={100} step="0.1" required value={f.percentage} onChange={set('percentage')} error={errors.percentage} />
        <TextField label="SGPA (optional)" type="number" min={0} max={10} step="0.01" value={f.sgpa} onChange={set('sgpa')} error={errors.sgpa} />
        <TextField label="Arrears" type="number" min={0} value={f.arrears} onChange={set('arrears')} />
        <div className="sm:col-span-2">
          <TextArea label="Remarks" rows={2} value={f.remarks} onChange={set('remarks')} />
        </div>
      </div>
    </Modal>
  );
};

const ImportCsv: React.FC<{ onClose: () => void; onSaved: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ onClose, onSaved, onShowToast }) => {
  const [csv, setCsv] = useState('reg_number,academic_year,semester,assessment,percentage,sgpa,arrears,remarks\n');
  const [problems, setProblems] = useState<{ line: number; message: string }[]>([]);
  const [validated, setValidated] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (dryRun: boolean) => {
    setPending(true);
    setProblems([]);
    try {
      const res = await http.post<{ valid?: number; created?: number; updated?: number }>('/academics/import', { csv, dryRun });
      if (dryRun) setValidated(res.data.valid ?? 0);
      else {
        onShowToast(res.message || 'Imported.');
        onSaved();
      }
    } catch (err) {
      if (err instanceof ApiError && err.details?.errors) setProblems(err.details.errors);
      onShowToast(err instanceof Error ? err.message : 'Import failed.', true);
      setValidated(null);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open
      size="lg"
      title="Import academic records (CSV)"
      description="All rows are validated first. Nothing is saved unless every row is valid and belongs to your authorized students."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" loading={pending} onClick={() => submit(true)}>
            Validate
          </Button>
          <Button loading={pending} disabled={validated === null} onClick={() => submit(false)}>
            Import {validated !== null ? `${validated} row(s)` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold text-[var(--kv-heading)]">Upload a .csv file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block mt-1 text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                setCsv(await file.text());
                setValidated(null);
              }
            }}
          />
        </label>
        <TextArea
          label="…or paste CSV"
          rows={10}
          value={csv}
          onChange={(e) => (setCsv(e.target.value), setValidated(null))}
          hint="Columns: reg_number, academic_year (2026-27), semester, assessment (Internal 1/2/3, Model Exam, Semester Exam), percentage, optional sgpa, arrears, remarks."
        />
        {validated !== null && <p className="text-sm text-emerald-700">{validated} row(s) are valid and ready to import.</p>}
        {problems.length > 0 && (
          <ul className="text-sm text-rose-700 list-disc pl-5 max-h-48 overflow-y-auto" role="alert">
            {problems.map((p) => (
              <li key={p.line}>
                Line {p.line}: {p.message.replace(/^Line \d+: /, '')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};
