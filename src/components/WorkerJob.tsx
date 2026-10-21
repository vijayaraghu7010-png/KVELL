import React, { useCallback, useEffect, useState } from 'react';
import { http, errorMessage } from '../services/http';

/**
 * The worker's job page, opened from the WhatsApp message.
 *
 * There is no sign-in here: the unguessable, expiring token in the URL is the
 * authorisation, and the server binds it to exactly one assignment. The worker
 * reports what happened; nothing on this page resolves the complaint, because
 * only the Warden verifies the work.
 */
export interface WorkerJobView {
  complaintId: string;
  category: string;
  trade: string;
  title: string;
  description: string;
  location: string;
  studentName: string;
  priority: string;
  deadlineDisplay: string;
  assignedAtDisplay: string;
  workerName: string;
  workerTrade: string;
  complaintStatus: string;
  assignmentStatus: string;
  reportStatus: 'Reported Done' | 'Could Not Complete' | null;
  reportNote: string | null;
  reportedAtDisplay: string | null;
  expiresAt: string;
  expired: boolean;
  canReport: boolean;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-wrap justify-between gap-2 py-2.5 border-b border-slate-100 last:border-0">
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className="text-sm font-semibold text-slate-900 text-right">{value}</dd>
  </div>
);

export const WorkerJob: React.FC<{ token: string }> = ({ token }) => {
  const [view, setView] = useState<WorkerJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'Reported Done' | 'Could Not Complete' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await http.get<WorkerJobView>(`/worker/jobs/${encodeURIComponent(token)}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const report = async (outcome: 'Reported Done' | 'Could Not Complete') => {
    if (outcome === 'Could Not Complete' && note.trim().length < 3) {
      setError('Please say briefly what stopped you finishing the job.');
      return;
    }
    setBusy(outcome);
    try {
      const res = await http.post<{ view: WorkerJobView }>(`/worker/jobs/${encodeURIComponent(token)}/report`, { outcome, note: note.trim() || undefined });
      setView(res.data.view);
      setMessage(res.message ?? 'Thank you, your report has been recorded.');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--kv-page)] px-4 py-8 flex justify-center">
      <main className="w-full max-w-md space-y-4">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--kv-heading)]">KVCET Hostel</h1>
          <p className="text-xs text-slate-500">Maintenance job</p>
        </header>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-4 text-sm" role="alert">
            {error}
          </div>
        )}

        {view && (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div>
              <p className="text-xs text-slate-500">Job {view.complaintId}</p>
              <h2 className="text-lg font-bold text-slate-900">{view.title}</h2>
              <p className="text-xs text-slate-500">
                {view.trade} · for {view.workerName}
              </p>
            </div>

            <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-3 whitespace-pre-wrap">{view.description}</p>

            <dl>
              <Row label="Where" value={view.location} />
              <Row label="Raised by" value={view.studentName} />
              <Row label="Category" value={view.category} />
              <Row label="Priority" value={view.priority} />
              <Row label="Finish by" value={view.deadlineDisplay} />
              <Row label="Assigned" value={view.assignedAtDisplay} />
            </dl>

            {view.reportStatus && (
              <div
                className={`rounded-xl p-3 text-sm ${view.reportStatus === 'Reported Done' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}
                role="status"
              >
                You reported {view.reportStatus === 'Reported Done' ? 'this job done' : 'that you could not finish this job'}
                {view.reportedAtDisplay ? ` on ${view.reportedAtDisplay}` : ''}.
                {view.reportNote ? <span className="block mt-1 font-normal">“{view.reportNote}”</span> : null}
                {view.reportStatus === 'Reported Done' && <span className="block mt-1 font-normal">The Warden verifies the work before the complaint is closed.</span>}
              </div>
            )}

            {!view.reportStatus && view.expired && (
              <div className="rounded-xl p-3 text-sm bg-amber-50 border border-amber-200 text-amber-900" role="status">
                This job link has expired. Please call the hostel office.
              </div>
            )}

            {!view.reportStatus && !view.expired && !view.canReport && (
              <div className="rounded-xl p-3 text-sm bg-slate-50 border border-slate-200 text-slate-700" role="status">
                This job is no longer open for a report — the hostel office has moved it on.
              </div>
            )}

            {view.canReport && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  What you did, or what stopped you (needed if you could not finish)
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 normal-case font-normal tracking-normal focus:outline-none focus:border-[var(--kv-primary)]"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => report('Could Not Complete')}
                    className="py-3 rounded-xl border border-amber-300 text-amber-800 font-semibold text-sm hover:bg-amber-50 disabled:opacity-60"
                  >
                    {busy === 'Could Not Complete' ? 'Sending…' : 'Could not finish'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => report('Reported Done')}
                    className="py-3 rounded-xl bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white font-semibold text-sm disabled:opacity-60"
                  >
                    {busy === 'Reported Done' ? 'Sending…' : 'Work done'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 text-center">This link is personal to this job and can be reported once.</p>
              </div>
            )}

            {message && (
              <p className="text-sm text-emerald-700 font-semibold" role="status">
                {message}
              </p>
            )}
          </section>
        )}

        <p className="text-[11px] text-slate-400 text-center">If you did not expect this message, please contact the hostel office. Do not forward this link.</p>
      </main>
    </div>
  );
};
