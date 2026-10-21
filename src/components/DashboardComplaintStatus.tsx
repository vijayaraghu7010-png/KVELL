import React, { useState } from 'react';
import { Complaint, DashboardTab } from '../types';

interface DashboardComplaintStatusProps {
  complaints: Complaint[];
  activeComplaintId: string | null;
  onSelectComplaint: (id: string) => void;
  onNavigateTab: (tab: DashboardTab) => void;
  onShowToast: (msg: string, isError?: boolean) => void;
  onReopen: (id: string, note: string) => Promise<boolean>;
}

type Stage = Complaint['stages'][number];

const NAVY = 'var(--kv-nav-bg)';
const BLUE = 'var(--kv-primary)';

/** "28 Oct 2026" -> "28 Oct" for the timeline's date column. */
const shortDate = (d: string) => (d && d !== '—' ? d.split(' ').slice(0, 2).join(' ') : '—');

const PRIORITY_TONE: Record<string, string> = {
  Critical: 'bg-rose-50 text-rose-700 border-rose-200',
  High: 'bg-orange-50 text-orange-700 border-orange-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  Low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_TONE: Record<string, string> = {
  Submitted: 'bg-blue-50 text-[var(--kv-primary)] border-blue-200',
  Accepted: 'bg-blue-50 text-[var(--kv-primary)] border-blue-200',
  'Worker Assigned': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'In Progress': 'bg-amber-50 text-amber-700 border-amber-200',
  Resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Closed: 'bg-slate-100 text-slate-600 border-slate-200',
  Reopened: 'bg-rose-50 text-rose-700 border-rose-200',
};

/* ---------- small pieces ---------- */

const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <section className={`bg-white rounded-xl border border-[var(--kv-border)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}>{children}</section>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{children}</p>
);

const Pill: React.FC<{ tone: 'muted' | 'blue' | 'green'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={`inline-flex items-center rounded-[4px] px-1.5 py-[1px] text-[9.5px] font-semibold leading-[14px] whitespace-nowrap ${
      tone === 'blue' ? 'bg-[var(--kv-surface-alt)] text-[var(--kv-primary)]' : tone === 'green' ? 'bg-emerald-50 text-emerald-700' : 'bg-[var(--kv-surface-alt)] text-[var(--kv-heading)]'
    }`}
  >
    {children}
  </span>
);

const Node: React.FC<{ status: Stage['status'] }> = ({ status }) => {
  if (status === 'completed')
    return (
      <span className="relative z-10 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: NAVY }}>
        <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="white" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
    );
  if (status === 'current')
    return (
      <span className="relative z-10 w-5 h-5 rounded-full bg-white border-2 flex items-center justify-center kv-node-live" style={{ borderColor: BLUE }}>
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BLUE }} />
      </span>
    );
  return (
    <span className="relative z-10 w-3.5 h-3.5 rounded-full bg-white border border-slate-300 flex items-center justify-center">
      <span className="w-1 h-1 rounded-full bg-slate-300" />
    </span>
  );
};

/**
 * The connector running *into* a stage. A stage already reached draws a solid navy
 * track; the stage being worked on draws a navy-to-transparent gradient that travels
 * downwards, so the track reads as progress still in motion; anything further ahead is
 * an inert hairline.
 */
const Connector: React.FC<{ into: Stage['status'] | undefined; half: 'top' | 'bottom' }> = ({ into, half }) => {
  const base = `absolute left-1/2 -translate-x-1/2 w-[2px] h-1/2 ${half === 'top' ? 'top-0' : 'top-1/2'}`;
  if (into === 'completed') return <span className={base} style={{ backgroundColor: NAVY }} aria-hidden="true" />;
  if (into === 'current') return <span className={`${base} kv-track-live`} aria-hidden="true" />;
  return <span className={base} style={{ backgroundColor: 'var(--kv-border)' }} aria-hidden="true" />;
};

/* ---------- component ---------- */

export const DashboardComplaintStatus: React.FC<DashboardComplaintStatusProps> = ({ complaints, activeComplaintId, onSelectComplaint, onNavigateTab, onShowToast, onReopen }) => {
  const current = complaints.find((c) => c.id === activeComplaintId) ?? complaints[0];
  const [reopenNote, setReopenNote] = useState('');
  const [reopening, setReopening] = useState(false);

  if (!current) {
    return (
      <div className="max-w-4xl mx-auto bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
        <span className="material-symbols-outlined text-[36px] text-slate-300" aria-hidden="true">schedule</span>
        <h1 className="text-lg font-bold text-slate-900">No complaints raised</h1>
        <p className="text-xs text-slate-500">When you raise a complaint, its resolution progress appears here.</p>
        <button type="button" onClick={() => onNavigateTab('raise-complaint')} className="px-5 py-2.5 bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white text-xs font-semibold rounded-xl cursor-pointer">
          Raise a Complaint
        </button>
      </div>
    );
  }

  const resolved = current.status === 'Resolved' || current.status === 'Closed';
  const escalations = current.escalations ?? [];
  const aboutWarden = !!current.isAboutWarden;

  const banner = aboutWarden
    ? {
        eyebrow: 'Administrative Officer Review',
        title: 'Reviewed by the Administrative Officer',
        desc: 'Complaints about the Warden are routed to the AO office and are not shared with the Warden.',
      }
    : escalations.length
      ? {
          eyebrow: 'Escalated to the Administrative Officer',
          title: 'Administrative Officer Review',
          desc: `Escalated because: ${escalations.map((e) => e.reason).join(' and ')}. The original complaint id and history are unchanged.`,
        }
      : resolved
        ? { eyebrow: `Complaint ${current.status}`, title: 'Handled by the Warden office', desc: current.resolutionNotes ?? 'The complaint has been closed out.' }
        : {
            eyebrow: `Warden Office · ${current.status}`,
            title: current.workerName ? `Assigned to ${current.workerName}` : 'With the Warden office',
            desc: current.workerName
              ? `${current.workerTrade ?? 'Worker'} assigned${current.contactConfirmedAt ? ` and briefed on ${current.contactConfirmedAt}` : ', contact pending'}.`
              : 'The Warden will accept the complaint and arrange the right worker.',
          };

  const badgeFor = (st: Stage): React.ReactNode => {
    if (st.badge === 'Current Stage') return <Pill tone="blue">Current Stage</Pill>;
    if (st.badge === 'Resolved' || st.badge === 'Closed') return <Pill tone="green">{st.badge}</Pill>;
    return null;
  };

  return (
    <div className="w-full max-w-[1040px] mx-auto space-y-4">
      {/* Heading */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] leading-tight font-extrabold tracking-tight" style={{ color: NAVY }}>
            Complaint Status
          </h1>
          <p className="text-[12px] text-slate-500 mt-1">Track the current status of your campus complaint.</p>
        </div>
        {complaints.length > 1 && (
          <select
            value={current.id}
            onChange={(e) => onSelectComplaint(e.target.value)}
            aria-label="Select complaint"
            className="border border-[var(--kv-border)] rounded-lg px-3 py-2 text-[12px] text-slate-700 bg-white focus:outline-none focus:border-[var(--kv-primary)] sm:min-w-[240px]"
          >
            {complaints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.category} · {c.status}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Summary strip */}
      <Card className="px-5 sm:px-6 py-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-5">
          <div className="pr-4">
            <Label>Request ID</Label>
            <p className="mt-1.5 text-[15px] font-bold" style={{ color: BLUE }}>
              {current.id}
            </p>
          </div>
          <div className="px-4 border-l border-[var(--kv-border)]">
            <Label>Category &amp; Status</Label>
            <p className="mt-1.5 text-[14px] font-semibold text-slate-900">{current.category}</p>
            <span className={`mt-1 inline-flex items-center rounded border px-1.5 py-[1px] text-[10.5px] font-bold ${STATUS_TONE[current.status] ?? STATUS_TONE.Submitted}`}>{current.status}</span>
          </div>
          <div className="pr-4 md:px-4 md:border-l border-[var(--kv-border)]">
            <Label>Submitted</Label>
            <p className="mt-1.5 text-[14px] font-semibold text-slate-900">{current.submittedDate}</p>
          </div>
          <div className="px-4 border-l border-[var(--kv-border)]">
            <Label>Priority &amp; Target</Label>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10.5px] font-bold ${PRIORITY_TONE[current.priority ?? 'Medium']}`}>{current.priority ?? 'Medium'}</span>
              <span className="text-[12px] font-semibold text-slate-700">{current.resolutionTarget ?? '—'}</span>
            </p>
            <p className={`mt-1 text-[10px] font-semibold leading-snug ${current.isOverdue ? 'text-rose-600' : 'text-slate-500'}`}>
              {current.timeRemainingLabel ?? '—'} · due {current.deadlineDisplay ?? '—'}
            </p>
          </div>
        </div>
      </Card>

      {/* Escalation banner */}
      <section className="rounded-xl border border-[var(--kv-border)] bg-[var(--kv-surface-alt)] px-5 sm:px-6 py-4">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: resolved ? '#047857' : BLUE }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: resolved ? '#047857' : BLUE }} />
          {banner.eyebrow}
        </p>
        <h2 className="mt-1.5 text-[17px] font-bold" style={{ color: NAVY }}>
          {banner.title}
        </h2>
        <p className="mt-1 text-[12px] text-slate-600">{banner.desc}</p>
      </section>

      {/* Status history */}
      <Card className="px-5 sm:px-6 pt-5 pb-4">
        <div className="pb-3 border-b border-[var(--kv-border)]">
          <h3 className="text-[13px] font-bold" style={{ color: NAVY }}>
            Status History <span className="font-normal text-[10.5px] text-slate-500">— Updates automatically during resolution</span>
          </h3>
        </div>
        <ol className="pt-3" aria-label="Escalation stages">
          {current.stages.map((st, i) => {
            const next = current.stages[i + 1];
            const isPending = st.status === 'pending';
            const isCurrent = st.status === 'current';
            return (
              <li key={st.title} className="grid grid-cols-[52px_32px_1fr] sm:grid-cols-[64px_36px_1fr]">
                <div className={`flex items-center justify-end pr-2 text-[10.5px] font-semibold ${isCurrent ? 'text-[var(--kv-primary)]' : 'text-slate-600'}`}>{shortDate(st.date)}</div>
                <div className="relative flex items-center justify-center">
                  {i > 0 && <Connector into={st.status} half="top" />}
                  {next && <Connector into={next.status} half="bottom" />}
                  <Node status={st.status} />
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-[11px] pl-1.5">
                  <span className={`text-[13px] ${isPending ? 'font-semibold text-slate-500' : 'font-bold'}`} style={isPending ? undefined : { color: NAVY }}>
                    {st.title}
                  </span>
                  {badgeFor(st)}
                  <span className="sr-only">Status: {st.status}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* Request details */}
      <Card className="px-5 sm:px-6 pt-4 pb-5">
        <div className="pb-2.5 border-b border-[var(--kv-border)]">
          <Label>Request Details</Label>
        </div>
        <dl className="pt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
          <div>
            <dt className="text-[10.5px] font-semibold text-slate-700">Reason / Issue</dt>
            <dd className="mt-1 text-[13px] font-bold text-slate-900 leading-snug break-words">{current.description}</dd>
          </div>
          <div>
            <dt className="text-[10.5px] font-semibold text-slate-700">Submitted On</dt>
            <dd className="mt-1 text-[13px] font-bold text-slate-900">{current.submittedDate}</dd>
          </div>
          <div>
            <dt className="text-[10.5px] font-semibold text-slate-700">Assigned Worker</dt>
            <dd className="mt-1 text-[13px] font-bold text-slate-900">{current.workerName ?? 'Not assigned yet'}</dd>
            {current.workerTrade && <dd className="text-[10px] text-slate-500">{current.workerTrade}</dd>}
            {current.contactConfirmedAt && <dd className="text-[10px] text-slate-500">Worker briefed {current.contactConfirmedAt}</dd>}
          </div>
          <div>
            <dt className="text-[10.5px] font-semibold text-slate-700">Current Handling Authority</dt>
            <dd className="mt-1 text-[13px] font-bold text-slate-900 leading-snug">{current.authorityRef}</dd>
            <dd className="mt-0.5 font-mono text-[10px] text-slate-500">Ref: {current.workOrderId ?? current.id}</dd>
          </div>
        </dl>
        {current.resolutionNotes && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
            <p className="text-[10.5px] font-semibold text-emerald-700">Resolution recorded{current.resolvedBy ? ` by ${current.resolvedBy}` : ''}</p>
            <p className="mt-0.5 text-[12px] text-emerald-900">{current.resolutionNotes}</p>
          </div>
        )}
      </Card>

      {escalations.length > 0 && (
        <Card className="px-5 sm:px-6 pt-4 pb-5">
          <div className="pb-2.5 border-b border-[var(--kv-border)]">
            <Label>Administrative Officer Review</Label>
          </div>
          <ul className="pt-3 space-y-3">
            {escalations.map((e) => (
              <li key={e.id} className="text-[12px]">
                <p className="font-bold" style={{ color: NAVY }}>
                  {e.reason} <span className="font-semibold text-slate-500">· {e.status}</span>
                </p>
                <p className="text-[10.5px] text-slate-500">Raised {e.createdAtDisplay}</p>
                {e.notes && <p className="mt-0.5 text-slate-700">{e.notes}{e.reviewedBy ? ` — ${e.reviewedBy}` : ''}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(current.status === 'Resolved' || current.status === 'Closed') && (
        <Card className="px-5 sm:px-6 pt-4 pb-5">
          <div className="pb-2.5 border-b border-[var(--kv-border)]">
            <Label>Not actually fixed?</Label>
          </div>
          <div className="pt-3 flex flex-col sm:flex-row gap-2">
            <input
              value={reopenNote}
              onChange={(e) => setReopenNote(e.target.value)}
              placeholder="Tell the Warden what is still wrong (at least 5 characters)"
              aria-label="Reason for reopening"
              className="flex-1 border border-[var(--kv-border)] rounded-lg px-3 py-2 text-[12px] text-slate-800 focus:outline-none focus:border-[var(--kv-primary)]"
            />
            <button
              type="button"
              disabled={reopening || reopenNote.trim().length < 5}
              onClick={async () => {
                setReopening(true);
                const okDone = await onReopen(current.id, reopenNote.trim());
                setReopening(false);
                if (okDone) {
                  setReopenNote('');
                  onShowToast(`Complaint ${current.id} reopened.`);
                }
              }}
              className="px-4 py-2 rounded-lg bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] disabled:opacity-50 text-white text-[12px] font-semibold cursor-pointer"
            >
              {reopening ? 'Reopening…' : 'Reopen complaint'}
            </button>
          </div>
          {current.reopenedCount ? <p className="pt-2 text-[10.5px] text-slate-500">Reopened {current.reopenedCount} time(s) so far.</p> : null}
        </Card>
      )}
    </div>
  );
};
