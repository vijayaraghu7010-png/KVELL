import React, { useCallback, useEffect, useState } from 'react';
import { http, errorMessage } from '../services/http';

/**
 * Parent / guardian approval page, opened from the WhatsApp link.
 *
 * There is no sign-in here: the unguessable, single-use, expiring token in the URL
 * is the authorisation, and the server binds it to exactly one outing request.
 */
export interface ParentApprovalView {
  outingId: string;
  studentName: string;
  regNumber: string;
  roomNumber: string;
  destination: string;
  reason: string;
  outingType: string;
  outAtDisplay: string;
  returnAtDisplay: string;
  /** Where your son/daughter was standing when they raised the request, if shared. */
  locationLink: string | null;
  parentName: string | null;
  expiresAt: string;
  expired: boolean;
  decision: 'Approved' | 'Rejected' | null;
  decidedAtDisplay: string | null;
  outingStatus: string;
  canDecide: boolean;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-wrap justify-between gap-2 py-2.5 border-b border-slate-100 last:border-0">
    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className="text-sm font-semibold text-slate-900 text-right">{value}</dd>
  </div>
);

export const ParentApproval: React.FC<{ token: string }> = ({ token }) => {
  const [view, setView] = useState<ParentApprovalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'Approved' | 'Rejected' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await http.get<ParentApprovalView>(`/parent/outings/${encodeURIComponent(token)}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (decision: 'Approved' | 'Rejected') => {
    setBusy(decision);
    try {
      const res = await http.post<{ view: ParentApprovalView }>(`/parent/outings/${encodeURIComponent(token)}/decision`, { decision, note: note.trim() || undefined });
      setView(res.data.view);
      setMessage(res.message ?? 'Thank you, your response has been recorded.');
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
          <p className="text-xs text-slate-500">Parent / guardian outing approval</p>
        </header>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-4 text-sm" role="alert">
            {error}
          </div>
        )}

        {view && (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div>
              <p className="text-xs text-slate-500">Request {view.outingId}</p>
              <h2 className="text-lg font-bold text-slate-900">{view.studentName}</h2>
              <p className="text-xs text-slate-500">
                {view.regNumber} · Room {view.roomNumber}
              </p>
            </div>

            <dl>
              <Row label="Destination" value={view.destination} />
              <Row label="Purpose" value={view.reason} />
              <Row label="Leaves" value={view.outAtDisplay} />
              <Row label="Expected back" value={view.returnAtDisplay} />
              <Row
                label="Location when requested"
                value={
                  view.locationLink ? (
                    <a href={view.locationLink} target="_blank" rel="noreferrer noopener" className="font-semibold text-[var(--kv-primary)] underline">
                      Open in Maps
                    </a>
                  ) : (
                    'Not shared'
                  )
                }
              />
              <Row label="Current status" value={view.outingStatus} />
            </dl>

            {view.decision && (
              <div className={`rounded-xl p-3 text-sm ${view.decision === 'Approved' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-800'}`} role="status">
                You {view.decision === 'Approved' ? 'approved' : 'declined'} this request{view.decidedAtDisplay ? ` on ${view.decidedAtDisplay}` : ''}.
                {view.decision === 'Approved' && ' The hostel Warden makes the final decision.'}
              </div>
            )}

            {!view.decision && view.expired && (
              <div className="rounded-xl p-3 text-sm bg-amber-50 border border-amber-200 text-amber-900" role="status">
                This approval link has expired. Please contact the hostel office if you still wish to respond.
              </div>
            )}

            {view.canDecide && (
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Message for the hostel (optional)
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 normal-case font-normal tracking-normal focus:outline-none focus:border-[var(--kv-primary)]"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => decide('Rejected')}
                    className="py-3 rounded-xl border border-rose-200 text-rose-700 font-semibold text-sm hover:bg-rose-50 disabled:opacity-60"
                  >
                    {busy === 'Rejected' ? 'Sending…' : 'Decline'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => decide('Approved')}
                    className="py-3 rounded-xl bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white font-semibold text-sm disabled:opacity-60"
                  >
                    {busy === 'Approved' ? 'Sending…' : 'Approve'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 text-center">This link is personal to you and can be used once.</p>
              </div>
            )}

            {message && (
              <p className="text-sm text-emerald-700 font-semibold" role="status">
                {message}
              </p>
            )}
          </section>
        )}

        <p className="text-[11px] text-slate-400 text-center">
          If you did not expect this message, please contact the hostel office. Do not forward this link.
        </p>
      </main>
    </div>
  );
};
