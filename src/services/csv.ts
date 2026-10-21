/** Builds and downloads a CSV from rows already loaded in the UI (what you see is what you export). */
export function downloadCsv<T>(fileName: string, columns: { label: string; value: (row: T) => unknown }[], rows: T[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
