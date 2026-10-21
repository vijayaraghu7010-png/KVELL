import React from 'react';
import { Badge, EmptyState } from './ui';

export interface GeneratedReport {
  type: string;
  title: string;
  definition: string;
  period: { from: string; to: string; label: string };
  department: string | null;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  notes: string[];
  generatedAt: string;
}

/** Renders a server-generated report table (same structure used for CSV export and distribution). */
export const ReportView: React.FC<{ report: GeneratedReport; compact?: boolean }> = ({ report, compact }) => (
  <div className="space-y-3">
    {!compact && (
      <div>
        <h3 className="font-bold text-[var(--kv-heading)]">{report.title}</h3>
        <p className="text-xs text-[var(--kv-text-muted)]">
          {report.period.label}
          {report.department ? ` · ${report.department}` : ''} · generated {report.generatedAt}
        </p>
      </div>
    )}
    <p className="text-xs text-[var(--kv-text-muted)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-2.5">
      <Badge tone="blue">Definition</Badge> {report.definition}
    </p>
    {report.rows.length === 0 ? (
      <EmptyState icon="table_view" title="No records for this period" message={report.notes.join(' ')} />
    ) : (
      <div className="overflow-x-auto border border-[var(--kv-border)] rounded-lg">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="bg-[var(--kv-surface-alt)]">
              {report.columns.map((c) => (
                <th key={c.key} scope="col" className="text-left px-3 py-2 text-xs font-semibold text-[var(--kv-heading)] whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--kv-border-soft)]">
            {report.rows.map((r, i) => (
              <tr key={i}>
                {report.columns.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-[var(--kv-heading)] tabular-nums">
                    {r[c.key] === null || r[c.key] === undefined ? '—' : String(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    {report.notes.length > 0 && report.rows.length > 0 && (
      <ul className="text-xs text-[var(--kv-text-muted)] list-disc pl-5">
        {report.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    )}
  </div>
);
