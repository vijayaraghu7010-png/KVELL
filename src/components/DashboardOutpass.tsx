import React, { useMemo, useState } from 'react';
import { Outpass } from '../types';
import { OutpassModal } from './OutpassModal';

interface DashboardOutpassProps {
  outpasses: Outpass[];
  student: { name: string; regNumber: string; department: string; roomNumber: string; block?: string | null };
  onShowToast: (msg: string, isError?: boolean) => void;
}

const HISTORY_LABEL: Record<string, { text: string; cls: string }> = {
  Completed: { text: 'Returned', cls: 'text-emerald-700' },
  Expired: { text: 'Not used — expired', cls: 'text-slate-500' },
  Cancelled: { text: 'Cancelled', cls: 'text-rose-700' },
};

export const DashboardOutpass: React.FC<DashboardOutpassProps> = ({ outpasses, student, onShowToast }) => {
  const [selectedPass, setSelectedPass] = useState<Outpass | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'30' | '60' | 'all'>('30');

  const activePasses = outpasses.filter((p) => p.lifecycleStatus === 'Active' || p.lifecycleStatus === 'Out');
  const history = useMemo(() => {
    const cutoff = historyFilter === 'all' ? 0 : Date.now() - Number(historyFilter) * 86_400_000;
    return outpasses.filter((p) => !(p.lifecycleStatus === 'Active' || p.lifecycleStatus === 'Out') && (!p.validFrom || Date.parse(p.validFrom) >= cutoff));
  }, [outpasses, historyFilter]);

  return (
    <div className="flex flex-col w-full max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Outpasses</h1>
        <p className="text-xs text-slate-500 mt-1">Digital gate passes issued after Warden approval, with their QR codes and gate history.</p>
      </div>

      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 md:p-8 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-900 tracking-wide">Active Outpasses ({activePasses.length})</h2>
          </div>
        </div>

        {activePasses.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">No active outpasses. Passes appear here once the Warden approves an outing or leave request.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {activePasses.map((pass) => (
              <div key={pass.id} className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs hover:border-[var(--kv-primary)] transition-all flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-1.5">
                      <span className={`material-symbols-outlined text-[16px] ${pass.type === 'Leave' ? 'text-emerald-600' : 'text-amber-600'}`} aria-hidden="true">
                        {pass.type === 'Leave' ? 'calendar_month' : 'schedule'}
                      </span>
                      <span className={`text-xs font-bold ${pass.type === 'Leave' ? 'text-emerald-700' : 'text-amber-700'}`}>{pass.type}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">{pass.id}</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div>
                      <span className="text-slate-400">For: </span>
                      <span className="font-bold text-slate-800">{pass.title}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Date: </span>
                      <span className="font-semibold text-slate-800">{pass.dateRange}</span>
                    </div>
                    {pass.timeSlot && (
                      <div>
                        <span className="text-slate-400">Time: </span>
                        <span className="font-semibold text-slate-800">{pass.timeSlot}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-slate-400">Status: </span>
                      <span className={`w-2 h-2 rounded-full inline-block ${pass.lifecycleStatus === 'Out' ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden="true" />
                      <span className={`font-bold ${pass.lifecycleStatus === 'Out' ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {pass.lifecycleStatus === 'Out' ? 'Checked out' : 'Ready to use'}
                      </span>
                      {pass.isOverdueReturn && <span className="text-[11px] font-bold text-rose-700 ml-2">Return overdue</span>}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPass(pass)}
                  className="w-full py-2.5 px-4 bg-[var(--kv-nav-bg)] hover:bg-[var(--kv-primary-hover)] text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">qr_code_2</span>
                  <span>View Outpass & QR</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 md:p-8 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" aria-hidden="true" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">PREVIOUS OUTPASSES HISTORY</h2>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="sr-only">History period</span>
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as '30' | '60' | 'all')}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 bg-white focus:outline-none focus:border-[var(--kv-primary)]"
            >
              <option value="30">Last 30 Days</option>
              <option value="60">Last 60 Days</option>
              <option value="all">All History</option>
            </select>
          </label>
        </div>

        {history.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-400">No previous outpasses in this period.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {history.map((p) => {
              const label = HISTORY_LABEL[p.lifecycleStatus ?? p.status] ?? { text: p.status, cls: 'text-slate-600' };
              return (
                <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{p.type === 'Leave' ? 'home' : 'directions_walk'}</span>
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-slate-900 truncate">{p.title}</h4>
                        <span className="font-mono text-[10px] text-slate-400">Pass ID: {p.id}</span>
                      </div>
                    </div>
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 shrink-0">{p.lifecycleStatus ?? p.status}</span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-600 pt-1">
                    <p>
                      {p.dateRange} · {p.timeSlot}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Out: {p.gateCheckOutTime ?? '—'} · In: {p.gateCheckInTime ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <span className={`font-semibold text-[11px] ${label.cls}`}>{label.text}</span>
                    <button type="button" onClick={() => setSelectedPass(p)} className="text-[var(--kv-primary)] hover:underline font-semibold text-xs cursor-pointer">
                      View Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedPass && <OutpassModal outpass={selectedPass} student={student} onClose={() => setSelectedPass(null)} onShowToast={onShowToast} />}
    </div>
  );
};
