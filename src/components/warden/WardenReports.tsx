import React, { useState } from 'react';
import { http } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { AsyncContent, BarList, Button, Card, PageHeader, StatCard, Tabs } from '../common/ui';

interface ActivityEntry {
  at: string;
  action: string;
  reference: string;
  by: string;
  detail: string;
}

interface WardenReport {
  period: string;
  from: string;
  to: string;
  label: string;
  preparedBy: string;
  activitySummary: { action: string; count: number }[];
  activity: ActivityEntry[];
  totalStudents: number;
  studentsOnLeave: number;
  leaveRequests: number;
  pendingLeave: number;
  outingRequests: number;
  pendingOuting: number;
  complaints: number;
  pendingComplaints: number;
  complaintsByCategory: { category: string; count: number }[];
  attendance: { recorded: number; present: number; ratePct: number | null };
  verifiedUnauthorizedAbsences: number;
  lateReturns: number;
  gateMovements: number;
  generatedAt: string;
}

const PERIOD_TITLE: Record<string, string> = {
  week: 'Weekly Hostel Report (last 7 days)',
  month: 'Monthly Hostel Report (last 30 days)',
  semester: 'Semester Hostel Report (last 180 days)',
};

/** Period report computed by the server from recorded data; the same markup prints as the document. */
export const WardenReports: React.FC<{ onShowToast: (m: string, e?: boolean) => void }> = () => {
  const [period, setPeriod] = useState('week');
  const report = useResource(() => http.get<WardenReport>(`/warden/reports?period=${period}`), [period]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="print-hide">
        <PageHeader
          title="Hostel Reports"
          subtitle="Computed from leave, outing, complaint, attendance, study-session, gate and incident records. Print produces the signed-off report document for the selected period."
          icon="bar_chart"
          actions={
            <Button variant="secondary" icon="print" disabled={!report.data} onClick={() => window.print()}>
              Print report
            </Button>
          }
        />
        <div className="mb-4">
          <Tabs
            active={period}
            onChange={setPeriod}
            tabs={[
              { id: 'week', label: 'Last 7 days' },
              { id: 'month', label: 'Last 30 days' },
              { id: 'semester', label: 'Last 180 days' },
            ]}
          />
        </div>
      </div>
      <AsyncContent {...report} onRetry={report.reload}>
        {(r) => (
          <div className="print-area space-y-5">
            {/* Letterhead: screen shows the one-line summary, paper gets the full heading. */}
            <header className="print-keep">
              <div className="print-only text-center border-b-2 border-black pb-2 mb-4">
                <h1 className="text-xl font-bold">Karpaga Vinayaga College of Engineering & Technology</h1>
                <p className="text-sm">Hostel Administration · Office of the Warden</p>
                <h2 className="text-base font-semibold mt-2">{PERIOD_TITLE[r.period] ?? 'Hostel Report'}</h2>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-1.5 text-sm">
                {(
                  [
                    ['Period', r.label],
                    ['Prepared by', `${r.preparedBy} (Warden)`],
                    ['Generated', r.generatedAt],
                    ['Residents on roll', String(r.totalStudents)],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">{k}</dt>
                    <dd className="text-[var(--kv-heading)] font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </header>

            <section className="print-keep">
              <h3 className="text-[15px] font-bold text-[var(--kv-heading)] mb-2">1. Summary of the period</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Residents" value={r.totalStudents} hint={`${r.studentsOnLeave} out on leave now`} icon="groups" />
                <StatCard label="Roll-call attendance" value={r.attendance.ratePct === null ? '—' : `${r.attendance.ratePct}%`} hint={`${r.attendance.present}/${r.attendance.recorded} records present`} icon="how_to_reg" tone="green" />
                <StatCard label="Verified unauthorized absences" value={r.verifiedUnauthorizedAbsences} icon="gpp_bad" tone="red" />
                <StatCard label="Late returns flagged" value={r.lateReturns} hint={`${r.gateMovements} gate scans in period`} icon="alarm" tone="amber" />
                <StatCard label="Leave requests" value={r.leaveRequests} hint={`${r.pendingLeave} pending now`} icon="description" />
                <StatCard label="Outing requests" value={r.outingRequests} hint={`${r.pendingOuting} pending now`} icon="directions_walk" />
                <StatCard label="Complaints raised" value={r.complaints} hint={`${r.pendingComplaints} unresolved now`} icon="build" tone="violet" />
              </div>
            </section>

            <section className="print-keep">
              <h3 className="text-[15px] font-bold text-[var(--kv-heading)] mb-2">2. Action taken by the Warden office</h3>
              <Card>
                {r.activitySummary.length === 0 ? (
                  <p className="text-sm text-[var(--kv-text-muted)]">No recorded Warden action in this period.</p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <caption className="sr-only">Count of each kind of action taken by the Warden office in the period</caption>
                    <thead>
                      <tr className="bg-[var(--kv-surface-alt)] text-left">
                        <th scope="col" className="px-3 py-2 text-xs font-semibold text-[var(--kv-heading)]">
                          Action
                        </th>
                        <th scope="col" className="px-3 py-2 text-xs font-semibold text-[var(--kv-heading)] w-24">
                          Times
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--kv-border-soft)]">
                      {r.activitySummary.map((a) => (
                        <tr key={a.action}>
                          <td className="px-3 py-2 text-[var(--kv-heading)]">{a.action}</td>
                          <td className="px-3 py-2 font-semibold text-[var(--kv-heading)]">{a.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </section>

            <section>
              <h3 className="text-[15px] font-bold text-[var(--kv-heading)] mb-2">3. Activity log</h3>
              <Card>
                {r.activity.length === 0 ? (
                  <p className="text-sm text-[var(--kv-text-muted)]">Nothing was recorded against the Warden office in this period.</p>
                ) : (
                  <>
                    <table className="w-full text-sm border-collapse">
                      <caption className="sr-only">Every action recorded against the Warden office in the period, most recent first</caption>
                      <thead>
                        <tr className="bg-[var(--kv-surface-alt)] text-left">
                          {['When', 'Action', 'Reference', 'Details', 'By'].map((h) => (
                            <th key={h} scope="col" className="px-3 py-2 text-xs font-semibold text-[var(--kv-heading)]">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--kv-border-soft)]">
                        {r.activity.map((a, i) => (
                          <tr key={`${a.at}-${a.reference}-${i}`} className="align-top">
                            <td className="px-3 py-2 whitespace-nowrap text-[var(--kv-heading)]">{a.at}</td>
                            <td className="px-3 py-2 text-[var(--kv-heading)]">{a.action}</td>
                            <td className="px-3 py-2 font-mono text-xs text-[var(--kv-heading)]">{a.reference}</td>
                            <td className="px-3 py-2 text-[var(--kv-heading)] break-words">{a.detail}</td>
                            <td className="px-3 py-2 text-[var(--kv-heading)] whitespace-nowrap">{a.by}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[11px] text-[var(--kv-text-muted)] mt-2">Most recent first. Up to 150 entries are listed.</p>
                  </>
                )}
              </Card>
            </section>

            <section className="print-keep">
              <h3 className="text-[15px] font-bold text-[var(--kv-heading)] mb-2">4. Complaints by category</h3>
              <Card>
                <BarList data={r.complaintsByCategory.map((c) => ({ label: c.category, value: c.count }))} emptyMessage="No complaints in this period." ariaLabel="Complaints by category" />
              </Card>
            </section>

            {/* Paper only: the sign-off block that makes the print a document of record. */}
            <footer className="print-only print-keep pt-10">
              <div className="flex justify-between text-sm">
                <div className="text-center">
                  <div className="border-t border-black w-56 pt-1">Warden</div>
                </div>
                <div className="text-center">
                  <div className="border-t border-black w-56 pt-1">Dean / Principal</div>
                </div>
              </div>
              <p className="text-[10pt] mt-6 text-center">
                Computer-generated from the KVCET Hostel Management records on {r.generatedAt}. Figures cover {r.label}.
              </p>
            </footer>
          </div>
        )}
      </AsyncContent>
    </div>
  );
};
