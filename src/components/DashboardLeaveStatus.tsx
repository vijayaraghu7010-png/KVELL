import React, { useEffect, useState } from 'react';
import { DashboardTab, LeaveRequest } from '../types';

interface DashboardLeaveStatusProps {
  leaveRequests: LeaveRequest[];
  onCancel: (id: string) => Promise<boolean>;
  onNavigateTab: (tab: DashboardTab) => void;
  onShowToast: (msg: string, isError?: boolean) => void;
}

type StageState = 'done' | 'current' | 'pending' | 'rejected' | 'skipped';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Stage timeline for the mandatory chain Class Incharge -> HOD -> Warden, built from
 * the recorded approvals rather than guessed from the current status.
 */
function stagesFor(r: LeaveRequest): { title: string; state: StageState; detail: string }[] {
  const wf = r.workflowStatus ?? 'Pending Class Incharge';
  const ev = (action: string) => r.history?.find((h) => h.action === action);
  const submitted = ev('submitted');
  const cancelled = ev('cancelled_by_student');
  const approvals = r.approvals ?? [];
  const pendingFor = (stage: string) => wf === `Pending ${stage === 'Class Incharge' ? 'Class Incharge' : stage}`;

  const stage = (title: string, name: 'Class Incharge' | 'HOD' | 'Warden', waitingLabel: string) => {
    const a = approvals.find((x) => x.stage === name);
    const decided = !!a?.decision;
    const isPending = pendingFor(name);
    const earlierRejection = !decided && wf === 'Rejected';
    return {
      title,
      state: (decided ? (a!.decision === 'Rejected' ? 'rejected' : 'done') : isPending ? 'current' : 'pending') as StageState,
      detail: decided
        ? `${a!.decision} by ${a!.by ?? name} · ${a!.atDisplay ?? ''}${a!.remarks ? ` — “${a!.remarks}”` : ''}`
        : isPending
          ? `${waitingLabel}${r.pendingWith && isPending ? ` (${r.pendingWith})` : ''}`
          : earlierRejection
            ? `Not reached — rejected at the ${r.rejectedStage ?? 'earlier'} stage.`
            : wf === 'Cancelled'
              ? 'Not reached — you cancelled the request.'
              : 'Not reached yet.',
    };
  };

  return [
    { title: 'Request Submitted', state: 'done' as StageState, detail: submitted ? fmt(submitted.createdAt) : r.submittedDate },
    stage('Class Incharge Approval', 'Class Incharge', 'Waiting for your Class Incharge'),
    stage('HOD Approval', 'HOD', 'Waiting for the HOD'),
    stage('Warden Approval', 'Warden', 'Waiting for the Warden'),
    {
      title: wf === 'Cancelled' ? 'Cancelled' : 'Outpass Issued',
      state: (wf === 'Approved' ? 'done' : wf === 'Cancelled' || wf === 'Rejected' ? 'rejected' : 'pending') as StageState,
      detail:
        wf === 'Approved'
          ? 'Your digital outpass is available under My Outpass.'
          : cancelled
            ? `You cancelled this request · ${fmt(cancelled.createdAt)}`
            : wf === 'Rejected'
              ? 'No outpass is issued for a rejected request.'
              : 'Issued automatically after Warden approval.',
    },
  ];
}

const DOT: Record<StageState, string> = {
  done: 'bg-[var(--kv-primary)] text-white',
  current: 'bg-amber-500 text-white',
  pending: 'bg-slate-200 text-slate-500',
  rejected: 'bg-rose-600 text-white',
  skipped: 'bg-slate-300 text-slate-600',
};
const ICON: Record<StageState, string> = { done: 'check', current: 'hourglass_top', pending: 'more_horiz', rejected: 'close', skipped: 'redo' };

const badgeClass = (s: string) =>
  s === 'Approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : s === 'Rejected' || s === 'Cancelled' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200';

export const DashboardLeaveStatus: React.FC<DashboardLeaveStatusProps> = ({ leaveRequests, onCancel, onNavigateTab, onShowToast }) => {
  const [selectedId, setSelectedId] = useState<string | null>(leaveRequests[0]?.id ?? null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!leaveRequests.some((r) => r.id === selectedId)) setSelectedId(leaveRequests[0]?.id ?? null);
  }, [leaveRequests, selectedId]);

  const current = leaveRequests.find((r) => r.id === selectedId) ?? null;

  if (!current) {
    return (
      <div className="max-w-4xl mx-auto bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
        <span className="material-symbols-outlined text-[36px] text-slate-300" aria-hidden="true">task</span>
        <h1 className="text-lg font-bold text-slate-900">No leave requests yet</h1>
        <p className="text-xs text-slate-500">Requests you submit will appear here with their live approval status.</p>
        <button type="button" onClick={() => onNavigateTab('leave-request')} className="px-5 py-2.5 bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white text-xs font-semibold rounded-xl cursor-pointer">
          Apply for Leave
        </button>
      </div>
    );
  }

  const stages = stagesFor(current);
  const canCancel = ['Pending Class Incharge', 'Pending HOD', 'Pending Warden', 'Approved'].includes(current.workflowStatus ?? '');

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leave Request Status</h1>
          <p className="text-xs text-slate-500 mt-1">Live status from the Class Incharge, HOD and Warden approval chain.</p>
        </div>
        <label className="text-xs text-slate-500 flex flex-col gap-1">
          Request
          <select
            value={current.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 bg-white focus:outline-none focus:border-[var(--kv-primary)] min-w-[260px]"
          >
            {leaveRequests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · {r.fromDateDisplay} → {r.toDateDisplay} · {r.status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-7 space-y-6" aria-labelledby="leave-progress-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="leave-progress-title" className="text-sm font-bold text-slate-900">
              Approval Progress
            </h2>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${badgeClass(current.status)}`}>
              {current.pendingStage ? `Pending ${current.pendingStage}` : current.status}
            </span>
          </div>
          <ol className="space-y-5">
            {stages.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center ${DOT[s.state]}`}>
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{ICON[s.state]}</span>
                  </span>
                  {i < stages.length - 1 && <span className={`w-0.5 flex-1 min-h-[24px] mt-1 ${s.state === 'done' || s.state === 'skipped' ? 'bg-[var(--kv-primary)]' : 'bg-slate-200'}`} aria-hidden="true" />}
                </div>
                <div className="pb-1">
                  <p className="text-sm font-bold text-slate-900">
                    {s.title} <span className="sr-only">— {s.state}</span>
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          {current.status === 'Approved' && (
            <button type="button" onClick={() => onNavigateTab('my-outpass')} className="px-5 py-2.5 bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white text-xs font-semibold rounded-xl cursor-pointer">
              View Outpass →
            </button>
          )}
        </section>

        <aside className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-4 text-xs">
          <h2 className="text-sm font-bold text-slate-900">Request Details</h2>
          <dl className="space-y-2.5">
            {[
              ['Request ID', current.id],
              ['Leave type', current.type],
              ['From', current.fromDateDisplay],
              ['To', current.toDateDisplay],
              ['Submitted', current.submittedDate],
              ['Section', current.section ? `Section ${current.section}` : 'Not assigned'],
              ['Currently with', current.pendingWith ?? '—'],
              ['Departure', current.departureDisplay ?? current.fromDateDisplay],
              ['Expected return', current.returnDisplay ?? current.toDateDisplay],
              ['Parent confirmation', current.parentApproved ? 'Recorded by staff' : 'Not recorded yet'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                <dt className="text-slate-400">{k}</dt>
                <dd className="font-semibold text-slate-800 text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {current.workflowStatus === 'Rejected' && current.rejectionReason && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
              <span className="text-rose-500 block mb-1 font-semibold">Rejected at the {current.rejectedStage} stage</span>
              <p className="text-rose-800">{current.rejectionReason}</p>
            </div>
          )}
          <div>
            <span className="text-slate-400 block mb-1">Reason</span>
            <p className="p-3 bg-slate-50 rounded-xl text-slate-700 border border-slate-200">{current.reason}</p>
          </div>
          {current.fileName && (
            <p className="flex items-center gap-1.5 text-slate-600">
              <span className="material-symbols-outlined text-[16px] text-[var(--kv-primary)]" aria-hidden="true">attach_file</span>
              {current.fileName}
            </p>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="w-full py-2.5 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xl font-semibold cursor-pointer"
            >
              Cancel this request
            </button>
          )}
        </aside>
      </div>

      {confirmCancel && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4" onClick={() => setConfirmCancel(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="cancel-leave-title" className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 id="cancel-leave-title" className="text-base font-bold text-slate-900">
              Cancel leave {current.id}?
            </h3>
            <p className="text-xs text-slate-500">
              {current.status === 'Approved' ? 'The issued outpass will be cancelled as well.' : 'Your approvers will no longer see it as pending.'}
            </p>
            <div className="flex gap-2">
              <button type="button" autoFocus onClick={() => setConfirmCancel(false)} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg">
                Keep request
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await onCancel(current.id);
                  setBusy(false);
                  setConfirmCancel(false);
                  if (ok) onShowToast(`Leave request ${current.id} cancelled.`);
                }}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg"
              >
                {busy ? 'Cancelling…' : 'Cancel request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
