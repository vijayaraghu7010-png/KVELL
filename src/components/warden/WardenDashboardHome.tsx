import React from 'react';
import type { WardenRoute } from './WardenPortal';
import { AsyncContent, Card, EmptyState, PageHeader, StatCard, StatusBadge } from '../common/ui';

export interface WardenStats {
  totalResidents: number;
  onLeave: number;
  onOuting: number;
  currentlyInside: number;
  pendingLeaveRequests: number;
  awaitingAdviser: number;
  awaitingClassIncharge?: number;
  awaitingHOD?: number;
  overdueComplaints?: number;
  pendingOutingRequests: number;
  openComplaints: number;
  newComplaints: number;
  workOrdersAwaitingVerification: number;
  activeOutpasses: number;
  overdueReturns: number;
  attendance: { date: string; session: string; recorded: number; expected: number; completionPct: number | null };
  absencesPendingVerification: number;
  openIncidents: number;
  upcomingStudySessions: number;
  recentActivity: { id: number; entityType: string; entityId: string; action: string; toStatus: string | null; note: string | null; actor: string; time: string }[];
}

const LINK: Record<string, WardenRoute> = {
  leave_request: 'leave-requests',
  outing_request: 'outing-requests',
  complaint: 'maintenance-complaints',
  incident: 'incidents',
  absence_case: 'attendance',
  outpass: 'log-book',
};

export const WardenDashboardHome: React.FC<{
  stats: { data: WardenStats | null; loading: boolean; error: string | null; reload: () => void };
  onNavigateTab: (tab: WardenRoute) => void;
}> = ({ stats, onNavigateTab }) => (
  <div className="max-w-7xl mx-auto space-y-6">
    <PageHeader title="Warden Dashboard" subtitle="Live hostel operations from approved requests, gate scans and roll calls." icon="admin_panel_settings" />
    <AsyncContent data={stats.data} loading={stats.loading} error={stats.error} onRetry={stats.reload}>
      {(s) => (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Residents" value={s.totalResidents} icon="groups" hint="Active hostellers" onClick={() => onNavigateTab('student-info')} />
            <StatCard label="Inside hostel" value={s.currentlyInside} icon="home" tone="green" hint={`${s.onLeave} on leave · ${s.onOuting} on outing`} onClick={() => onNavigateTab('log-book')} />
            <StatCard
              label="Tonight's roll call"
              value={s.attendance.completionPct === null ? '—' : `${s.attendance.completionPct}%`}
              icon="how_to_reg"
              tone="violet"
              hint={`${s.attendance.recorded}/${s.attendance.expected} recorded · ${s.attendance.session}`}
              onClick={() => onNavigateTab('attendance')}
            />
            <StatCard label="Overdue returns" value={s.overdueReturns} icon="alarm" tone={s.overdueReturns ? 'red' : 'slate'} hint="Checked out past pass validity" onClick={() => onNavigateTab('log-book')} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Leave awaiting you" value={s.pendingLeaveRequests} icon="description" tone="amber" hint={`${s.awaitingClassIncharge ?? 0} with Class Incharges · ${s.awaitingHOD ?? 0} with HODs`} onClick={() => onNavigateTab('leave-requests')} />
            <StatCard label="Outing requests" value={s.pendingOutingRequests} icon="directions_walk" tone="amber" onClick={() => onNavigateTab('outing-requests')} />
            <StatCard
              label="Open complaints"
              value={s.openComplaints}
              icon="build"
              tone="blue"
              hint={`${s.newComplaints} new · ${s.workOrdersAwaitingVerification} work order(s) to verify`}
              onClick={() => onNavigateTab('maintenance-complaints')}
            />
            <StatCard label="Absences to verify" value={s.absencesPendingVerification} icon="person_alert" tone={s.absencesPendingVerification ? 'red' : 'slate'} onClick={() => onNavigateTab('attendance')} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card title="Recent activity" className="lg:col-span-2">
              {s.recentActivity.length === 0 ? (
                <EmptyState icon="history" title="No activity yet" />
              ) : (
                <ul className="divide-y divide-[var(--kv-border-soft)]">
                  {s.recentActivity.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => LINK[a.entityType] && onNavigateTab(LINK[a.entityType])}
                        className="w-full text-left py-2.5 flex flex-wrap items-start justify-between gap-2 hover:bg-[var(--kv-accent-soft)] rounded-lg px-2 cursor-pointer"
                      >
                        <span className="min-w-0">
                          <span className="text-sm font-semibold text-[var(--kv-heading)] capitalize">
                            {a.entityId}: {a.action}
                          </span>
                          <span className="block text-xs text-[var(--kv-text-muted)]">
                            {a.actor} · {a.time}
                            {a.note ? ` — ${a.note}` : ''}
                          </span>
                        </span>
                        {a.toStatus && <StatusBadge status={a.toStatus} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Quick actions">
              <div className="grid gap-2">
                {(
                  [
                    ['Take roll call', 'how_to_reg', 'attendance'],
                    ['Review leave requests', 'description', 'leave-requests'],
                    ['Schedule a study session', 'menu_book', 'study-sessions'],
                    ['File an incident report', 'report', 'incidents'],
                    ['Allocate rooms', 'single_bed', 'room-allocation'],
                    ['Weekly report', 'bar_chart', 'reports'],
                  ] as [string, string, WardenRoute][]
                ).map(([label, icon, t]) => (
                  <button key={t} type="button" onClick={() => onNavigateTab(t)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--kv-border)] hover:border-[var(--kv-primary)] hover:bg-[var(--kv-accent-soft)] text-sm font-semibold text-[var(--kv-heading)] text-left cursor-pointer">
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                      {icon}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--kv-text-muted)] mt-3">
                {s.openIncidents} open incident(s) · {s.upcomingStudySessions} upcoming study session(s) · {s.activeOutpasses} active outpass(es)
              </p>
            </Card>
          </div>
        </>
      )}
    </AsyncContent>
  </div>
);
