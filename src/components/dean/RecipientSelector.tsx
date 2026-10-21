import React, { useEffect, useMemo, useState } from 'react';
import { http } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { Badge, Checkbox, SearchInput, cx } from '../common/ui';

export interface Selector {
  allHods: boolean;
  allAdvisers: boolean;
  departments: string[];
  userIds: string[];
}
export const emptySelector = (): Selector => ({ allHods: false, allAdvisers: false, departments: [], userIds: [] });

export interface ResolvedRecipient {
  id: string;
  name: string;
  email: string;
  role: 'HOD' | 'Adviser';
  department: string;
}

interface StaffRow {
  id: string;
  name: string;
  role: string;
  department: string | null;
}

/**
 * Chooses HOD/Adviser recipients. "All HODs/Advisers" can be limited to departments; individuals can be
 * added on top. The server resolves the final list (preview) — the same resolution is used when sending.
 */
export const RecipientSelector: React.FC<{ value: Selector; onChange: (s: Selector) => void; onResolved: (r: ResolvedRecipient[]) => void; error?: string | null }> = ({ value, onChange, onResolved, error }) => {
  const depts = useResource(() => http.get<{ code: string; name: string }[]>('/meta/departments'));
  const staff = useResource(() => http.get<StaffRow[]>('/meta/staff?roles=HOD,Adviser'));
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<ResolvedRecipient[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const hasSelection = value.allHods || value.allAdvisers || value.userIds.length > 0;
  useEffect(() => {
    if (!hasSelection) {
      setPreview([]);
      onResolved([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      http
        .post<ResolvedRecipient[]>('/work/recipients/preview', value)
        .then((r) => {
          if (cancelled) return;
          setPreview(r.data);
          setPreviewError(null);
          onResolved(r.data);
        })
        .catch((err) => !cancelled && setPreviewError(err.message));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  const toggleDept = (code: string) => onChange({ ...value, departments: value.departments.includes(code) ? value.departments.filter((d) => d !== code) : [...value.departments, code] });
  const toggleUser = (id: string) => onChange({ ...value, userIds: value.userIds.includes(id) ? value.userIds.filter((u) => u !== id) : [...value.userIds, id] });
  const filteredStaff = useMemo(() => (staff.data ?? []).filter((s) => !q || `${s.name} ${s.role} ${s.department}`.toLowerCase().includes(q.toLowerCase())), [staff.data, q]);

  return (
    <fieldset className={cx('border rounded-xl p-4 space-y-4', error ? 'border-rose-400' : 'border-[var(--kv-border)]')}>
      <legend className="px-1 text-xs font-semibold text-[var(--kv-heading)]">Recipients *</legend>
      <div className="flex flex-wrap gap-6">
        <Checkbox label="All HODs" checked={value.allHods} onChange={(v) => onChange({ ...value, allHods: v })} />
        <Checkbox label="All Advisers" checked={value.allAdvisers} onChange={(v) => onChange({ ...value, allAdvisers: v })} />
      </div>
      {(value.allHods || value.allAdvisers) && (
        <div>
          <p className="text-xs text-[var(--kv-text-muted)] mb-2">Limit “All” to departments (none selected = every department):</p>
          <div className="flex flex-wrap gap-2">
            {(depts.data ?? []).map((d) => (
              <button
                key={d.code}
                type="button"
                aria-pressed={value.departments.includes(d.code)}
                onClick={() => toggleDept(d.code)}
                className={cx('px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer', value.departments.includes(d.code) ? 'bg-[var(--kv-primary)] text-white border-[var(--kv-primary)]' : 'bg-white text-[var(--kv-heading)] border-[var(--kv-border)] hover:bg-[var(--kv-accent-soft)]')}
              >
                {d.code}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="text-xs text-[var(--kv-text-muted)] mb-2">Add individual HODs / Advisers:</p>
        <SearchInput value={q} onChange={setQ} placeholder="Search staff by name or department" label="Search staff" />
        <div className="mt-2 max-h-48 overflow-y-auto border border-[var(--kv-border-soft)] rounded-lg divide-y divide-[var(--kv-border-soft)]">
          {filteredStaff.length === 0 ? (
            <p className="p-3 text-xs text-[var(--kv-text-muted)]">{staff.loading ? 'Loading staff…' : 'No HOD or Adviser accounts found.'}</p>
          ) : (
            filteredStaff.map((s) => (
              <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--kv-accent-soft)]">
                <input type="checkbox" className="accent-[var(--kv-primary)]" checked={value.userIds.includes(s.id)} onChange={() => toggleUser(s.id)} />
                <span className="flex-1">{s.name}</span>
                <Badge tone={s.role === 'HOD' ? 'violet' : 'blue'}>{s.role}</Badge>
                <span className="text-xs text-[var(--kv-text-muted)] w-14 text-right">{s.department}</span>
              </label>
            ))
          )}
        </div>
      </div>
      <div className="bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-3" aria-live="polite">
        <p className="text-xs font-semibold text-[var(--kv-heading)]">
          Recipient preview: {preview.length} {preview.length === 1 ? 'person' : 'people'}
          {preview.length > 0 && ` (${preview.filter((p) => p.role === 'HOD').length} HOD, ${preview.filter((p) => p.role === 'Adviser').length} Adviser)`}
        </p>
        {previewError && <p className="text-xs text-rose-700 mt-1">{previewError}</p>}
        {preview.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {preview.map((p) => (
              <li key={p.id}>
                <Badge tone={p.role === 'HOD' ? 'violet' : 'blue'}>
                  {p.name} · {p.department}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="text-[11px] font-medium text-rose-600" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
};
