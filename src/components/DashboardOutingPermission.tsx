import React, { useState } from 'react';
import { DashboardTab, OutingRequest } from '../types';

export interface OutingInput {
  destination: string;
  reason: string;
  outAt: string; // ISO
  expectedReturnAt: string; // ISO
  outingType: string;
  /** Required to submit: nothing is tracked without it. */
  locationConsent: boolean;
  /** Where the student is standing when they raise the request; sent to the guardian. */
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  status: 'Pending' | 'Draft';
}

export interface WhatsAppStatus {
  provider: string;
  configured: boolean;
  missing: string[];
  instructions: string;
}

interface DashboardOutingPermissionProps {
  outingRequests: OutingRequest[];
  guardian: { name: string; phoneMasked: string } | null;
  whatsapp: WhatsAppStatus | null;
  onSubmitOuting: (input: OutingInput, draftId: string | null) => Promise<OutingRequest | undefined>;
  onDeleteOuting: (req: OutingRequest) => Promise<boolean>;
  onResendParentApproval: (id: string) => Promise<void>;
  onNavigateTab: (tab: DashboardTab) => void;
  onShowToast: (msg: string, isError?: boolean) => void;
}

// Must match server OUTING_TYPES
const OUTING_TYPES = ['Personal', 'Shopping', 'Medical', 'Family Visit', 'Academic', 'Other'];

/** ISO → value for <input type="datetime-local"> */
const toLocal = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const nowLocal = () => toLocal(new Date().toISOString());

const statusClass = (s: string) =>
  s === 'Draft'
    ? 'bg-blue-100 text-[var(--kv-primary)]'
    : s === 'Approved'
      ? 'bg-emerald-100 text-emerald-800'
      : s === 'Parent Approval Pending' || s === 'Pending Warden'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-rose-100 text-rose-800';

/** The approval chain, so a student can see exactly where the request is. */
const STAGES = ['Parent/Guardian', 'Warden'] as const;
const stageState = (req: OutingRequest, stage: (typeof STAGES)[number]) => {
  if (stage === 'Parent/Guardian') {
    if (req.parentDecision === 'Approved') return 'done';
    if (req.parentDecision === 'Rejected') return 'rejected';
    return req.status === 'Parent Approval Pending' ? 'current' : 'pending';
  }
  if (req.status === 'Approved') return 'done';
  if (req.status === 'Rejected') return 'rejected';
  return req.status === 'Pending Warden' ? 'current' : 'pending';
};

export const DashboardOutingPermission: React.FC<DashboardOutingPermissionProps> = ({
  outingRequests,
  guardian,
  whatsapp,
  onSubmitOuting,
  onDeleteOuting,
  onResendParentApproval,
  onNavigateTab,
  onShowToast,
}) => {
  const [outAt, setOutAt] = useState<string>('');
  const [returnAt, setReturnAt] = useState<string>('');
  const [outingType, setOutingType] = useState<string>('Personal');
  const [destination, setDestination] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [locationConsent, setLocationConsent] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ outAt?: string; returnAt?: string; destination?: string; reason?: string; locationConsent?: string; location?: string }>({});
  /** The current GPS fix, captured in the form and sent with the request. */
  const [fix, setFix] = useState<{ latitude: number; longitude: number; accuracyM: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  /** Asks the browser once for a position. A refusal is reported, never retried silently. */
  const pinLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('This browser cannot provide a location.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFix({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) });
        setErrors((x) => ({ ...x, location: undefined }));
        setLocating(false);
      },
      (err) => {
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Allow location for this site — an outing request cannot be sent without it.'
            : 'Your location could not be read just now. Move somewhere with a clearer signal and try again.',
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  // Modal inspection
  const [selectedRequest, setSelectedRequest] = useState<OutingRequest | null>(null);

  const reset = () => {
    setOutAt('');
    setReturnAt('');
    setOutingType('Personal');
    setDestination('');
    setReason('');
    setLocationConsent(false);
    setEditingDraftId(null);
    setErrors({});
  };

  const send = async (status: 'Pending' | 'Draft') => {
    if (busy) return;
    if (status === 'Pending') {
      const errs: typeof errors = {};
      if (!outAt) errs.outAt = 'Choose when you will leave.';
      else if (new Date(outAt).getTime() < Date.now() - 15 * 60_000) errs.outAt = 'Departure cannot be in the past.';
      if (!returnAt) errs.returnAt = 'Choose your expected return time.';
      else if (outAt && new Date(returnAt) <= new Date(outAt)) errs.returnAt = 'Return must be after departure.';
      if (!destination.trim()) errs.destination = 'Please enter your destination.';
      if (reason.trim().length < 5) errs.reason = 'Please provide a reason (at least 5 characters).';
      if (!locationConsent) errs.locationConsent = 'Location sharing consent is required to submit an outing request.';
      if (!fix) errs.location = 'Add your current location — your guardian approves on the strength of knowing where you are.';
      if (!guardian) errs.destination = 'Your profile has no parent/guardian contact, so the approval request cannot be sent. Ask the hostel office to add one.';
      setErrors(errs);
      if (Object.keys(errs).length) {
        onShowToast('Please correct the highlighted fields.', true);
        return;
      }
    } else if (!destination.trim() && !reason.trim() && !outAt) {
      onShowToast('Enter some details before saving a draft.', true);
      return;
    }
    setBusy(true);
    const saved = await onSubmitOuting(
      {
        destination: destination.trim(),
        reason: reason.trim(),
        outAt: outAt ? new Date(outAt).toISOString() : '',
        expectedReturnAt: returnAt ? new Date(returnAt).toISOString() : '',
        outingType,
        locationConsent,
        latitude: fix?.latitude,
        longitude: fix?.longitude,
        accuracyM: fix?.accuracyM,
        status,
      },
      editingDraftId,
    );
    setBusy(false);
    if (!saved) return;
    if (status === 'Pending') {
      setSubmittedId(saved.id);
      reset();
    } else {
      setEditingDraftId(saved.id);
    }
  };

  const handleEditDraft = (draft: OutingRequest) => {
    setEditingDraftId(draft.id);
    setOutAt(toLocal(draft.outAt));
    setReturnAt(toLocal(draft.expectedReturnAt));
    setOutingType(draft.outingType || 'Personal');
    setDestination(draft.destination);
    setReason(draft.reason);
    setLocationConsent(!!draft.locationConsent);
    setSelectedRequest(null);
    setErrors({});
    onShowToast('Draft loaded into the form for editing.');
  };

  const inputCls = 'w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)]';

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Outing Permission</h1>
          <p className="text-xs text-slate-500 mt-1">Request local outing clearance. A digital outpass is issued only after the Warden approves.</p>
        </div>
      </div>

      {submittedId && (
        <div className="w-full max-w-2xl mx-auto bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-2xl flex items-center justify-between" role="status">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-emerald-600 text-[20px]" aria-hidden="true">check_circle</span>
            <span className="text-xs font-semibold">Outing request {submittedId} submitted. Queued for Warden review.</span>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setSubmittedId(null)} className="text-emerald-700 hover:text-emerald-900 text-xs font-bold">
            ✕
          </button>
        </div>
      )}

      <div className="flex justify-center w-full">
        <div className="w-full max-w-2xl bg-white rounded-2xl p-5 sm:p-8 border border-slate-200 shadow-sm">
          {editingDraftId && (
            <div className="mb-4 p-3 bg-blue-50/80 border border-blue-200 rounded-xl flex items-center justify-between text-xs text-[var(--kv-primary)]">
              <span>Editing draft {editingDraftId}</span>
              <button type="button" onClick={reset} className="underline decoration-dotted text-slate-600 hover:text-slate-900 font-semibold">
                Start a new request
              </button>
            </div>
          )}
          <form
            className="space-y-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              send('Pending');
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="outing-out" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Departure <span className="text-rose-500">*</span>
                </label>
                <input id="outing-out" type="datetime-local" min={nowLocal()} value={outAt} onChange={(e) => setOutAt(e.target.value)} aria-invalid={!!errors.outAt} className={inputCls} />
                {errors.outAt && <span className="text-rose-500 text-xs" role="alert">{errors.outAt}</span>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="outing-return" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Expected Return <span className="text-rose-500">*</span>
                </label>
                <input id="outing-return" type="datetime-local" min={outAt || nowLocal()} value={returnAt} onChange={(e) => setReturnAt(e.target.value)} aria-invalid={!!errors.returnAt} className={inputCls} />
                {errors.returnAt && <span className="text-rose-500 text-xs" role="alert">{errors.returnAt}</span>}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="outing-type" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Outing Type
              </label>
              <select id="outing-type" value={outingType} onChange={(e) => setOutingType(e.target.value)} className={`${inputCls} cursor-pointer`}>
                {OUTING_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="outing-destination" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Destination <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="outing-destination"
                  type="text"
                  value={destination}
                  aria-invalid={!!errors.destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Enter destination (e.g. Express Avenue Mall, Phoenix Marketcity)..."
                  className={`${inputCls} pl-10`}
                />
                <span className="material-symbols-outlined text-slate-400 text-[18px] absolute left-3 top-3.5" aria-hidden="true">
                  location_on
                </span>
              </div>
              {errors.destination && <span className="text-rose-500 text-xs" role="alert">{errors.destination}</span>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="outing-reason" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Reason for Outing <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="outing-reason"
                rows={3}
                value={reason}
                aria-invalid={!!errors.reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter reason for outing (e.g. Project supplies purchase, library book return, medical clinic)..."
                className={`${inputCls} resize-none`}
              />
              {errors.reason && <span className="text-rose-500 text-xs" role="alert">{errors.reason}</span>}
            </div>

            {/* Parent/guardian routing and location consent */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] text-[var(--kv-primary)] mt-0.5" aria-hidden="true">family_restroom</span>
                <div className="text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Your parent or guardian approves first</p>
                  {guardian ? (
                    <p className="mt-0.5">
                      A WhatsApp approval request goes to <strong>{guardian.name || 'your guardian'}</strong> on {guardian.phoneMasked}. The Warden only sees the request once they approve it.
                    </p>
                  ) : (
                    <p className="mt-0.5 text-rose-700">Your profile has no parent/guardian phone number. Ask the hostel office to add one before submitting.</p>
                  )}
                  {whatsapp && !whatsapp.configured && (
                    <p className="mt-1 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      WhatsApp sending is not configured on this server yet, so no message is sent automatically. The hostel office can still pass the approval link on. ({whatsapp.missing.join(', ')})
                    </p>
                  )}
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={locationConsent}
                  aria-invalid={!!errors.locationConsent}
                  onChange={(e) => {
                    setLocationConsent(e.target.checked);
                    setErrors((x) => ({ ...x, locationConsent: undefined }));
                  }}
                  className="mt-0.5"
                />
                <span>
                  I agree to share my device location while this outing is approved and under way. Location is collected only during the approved window, is visible to the hostel Warden, and stops when
                  the outing ends. <span className="text-rose-500">*</span>
                </span>
              </label>

              {/* The fix travels with the request, so the guardian's WhatsApp message carries a map link. */}
              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] text-[var(--kv-primary)]" aria-hidden="true">my_location</span>
                    Location sent with this request <span className="text-rose-500">*</span>
                  </span>
                  <button
                    type="button"
                    onClick={pinLocation}
                    disabled={locating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--kv-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--kv-primary)] hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{locating ? 'progress_activity' : 'pin_drop'}</span>
                    {locating ? 'Finding you…' : fix ? 'Update location' : 'Add my current location'}
                  </button>
                </div>
                {fix ? (
                  <p className="text-[11px] text-slate-600">
                    Pinned at {fix.latitude.toFixed(5)}, {fix.longitude.toFixed(5)} (±{fix.accuracyM} m). Your parent or guardian gets this as a map link in their WhatsApp approval message.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">Required. Your guardian sees where you were when you raised the request.</p>
                )}
                {errors.location && !locationError && <p className="text-[11px] text-rose-600" role="alert">{errors.location}</p>}
                {locationError && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5" role="alert">{locationError}</p>}
              </div>
              {errors.locationConsent && <span className="text-rose-500 text-xs block" role="alert">{errors.locationConsent}</span>}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={busy}
                onClick={() => send('Draft')}
                className="px-5 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-[var(--kv-primary)] text-xs font-semibold transition border border-blue-200 cursor-pointer"
              >
                Save Draft
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] disabled:opacity-60 text-white text-xs font-semibold transition shadow-sm cursor-pointer"
              >
                <span>{busy ? 'Saving…' : 'Submit Request'}</span>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">send</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="flex justify-center w-full mt-4">
        <div className="w-full max-w-2xl bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Previous Permissions & Drafts</h3>
            <span className="text-[11px] text-slate-400">Select an item to view or edit</span>
          </div>
          {outingRequests.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No outing requests yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {outingRequests.map((req) => {
                const isDraft = req.status === 'Draft';
                return (
                  <button
                    type="button"
                    key={req.id}
                    onClick={() => setSelectedRequest(req)}
                    className={`text-left p-3.5 rounded-xl border transition flex items-center justify-between gap-2 cursor-pointer ${
                      isDraft ? 'border-blue-200 bg-blue-50/40 hover:bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100/80'
                    }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-bold text-slate-900 text-xs">{isDraft ? 'Draft' : req.dateTime}</div>
                      <div className="text-[11px] text-slate-500 truncate">{req.destination || 'No destination yet'}</div>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${statusClass(req.status)}`}>{req.status}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedRequest && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={() => setSelectedRequest(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outing-detail-title"
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h3 id="outing-detail-title" className="text-base font-bold text-slate-900">
                {selectedRequest.status === 'Draft' ? 'Draft Outing Details' : `Outing ${selectedRequest.id}`}
              </h3>
              <button onClick={() => setSelectedRequest(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600 font-bold" type="button">
                ✕
              </button>
            </div>
            <div className="space-y-2.5 text-slate-700">
              {[
                ['Departure', selectedRequest.status === 'Draft' && !selectedRequest.destination ? '—' : selectedRequest.dateTime],
                ['Expected Return', selectedRequest.expectedReturn],
                ['Type', selectedRequest.outingType || '—'],
                ['Destination', selectedRequest.destination || '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1 border-b border-slate-100 gap-3">
                  <span className="text-slate-400">{k}:</span>
                  <span className="font-semibold text-slate-900 text-right">{v}</span>
                </div>
              ))}
              <div className="flex flex-col space-y-1">
                <span className="text-slate-400">Reason:</span>
                <p className="p-3 bg-slate-50 rounded-xl text-slate-800 border border-slate-200/60 text-xs">{selectedRequest.reason || '—'}</p>
              </div>
              {selectedRequest.remarks && (
                <div className="flex flex-col space-y-1">
                  <span className="text-slate-400">Warden remarks{selectedRequest.decidedBy ? ` (${selectedRequest.decidedBy})` : ''}:</span>
                  <p className="p-3 bg-slate-50 rounded-xl text-slate-800 border border-slate-200/60 text-xs">{selectedRequest.remarks}</p>
                </div>
              )}
              <div className="flex justify-between items-center pt-2">
                <span className="text-slate-400">Status:</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${statusClass(selectedRequest.status)}`}>{selectedRequest.status}</span>
              </div>

              {selectedRequest.status !== 'Draft' && (
                <div className="pt-2 space-y-2">
                  <span className="text-slate-400">Approval chain:</span>
                  {STAGES.map((stage) => {
                    const state = stageState(selectedRequest, stage);
                    return (
                      <div key={stage} className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] ${
                            state === 'done' ? 'bg-emerald-600' : state === 'rejected' ? 'bg-rose-600' : state === 'current' ? 'bg-amber-500' : 'bg-slate-300'
                          }`}
                          aria-hidden="true"
                        >
                          <span className="material-symbols-outlined text-[13px]">{state === 'done' ? 'check' : state === 'rejected' ? 'close' : state === 'current' ? 'hourglass_top' : 'more_horiz'}</span>
                        </span>
                        <span className="font-semibold text-slate-800">{stage}</span>
                        <span className="text-slate-500">
                          {stage === 'Parent/Guardian'
                            ? selectedRequest.parentDecision
                              ? `${selectedRequest.parentDecision}${selectedRequest.parentDecidedAt ? ` · ${selectedRequest.parentDecidedAt}` : ''}`
                              : state === 'current'
                                ? 'Waiting for your parent/guardian to respond on WhatsApp'
                                : 'Not reached'
                            : state === 'done'
                              ? `Approved${selectedRequest.decidedBy ? ` by ${selectedRequest.decidedBy}` : ''}`
                              : state === 'rejected'
                                ? 'Rejected'
                                : state === 'current'
                                  ? 'Waiting for the Warden'
                                  : 'Not reached'}
                        </span>
                      </div>
                    );
                  })}
                  {selectedRequest.parentNote && <p className="p-3 bg-slate-50 rounded-xl text-slate-800 border border-slate-200/60 text-xs">Guardian’s message: {selectedRequest.parentNote}</p>}
                </div>
              )}

              {selectedRequest.status === 'Approved' && selectedRequest.trackingStatus && (
                <div className="pt-2 flex justify-between items-center gap-3">
                  <span className="text-slate-400">Location sharing:</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {selectedRequest.trackingStatus}
                    {selectedRequest.trackingLastUpdate ? ` · last update ${selectedRequest.trackingLastUpdate}` : ''}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between pt-3 border-t border-slate-100 gap-2">
              {selectedRequest.status === 'Draft' && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleEditDraft(selectedRequest)} className="px-3 py-1.5 bg-blue-50 text-[var(--kv-primary)] hover:bg-blue-100 rounded-lg text-xs font-semibold cursor-pointer">
                    Edit Draft
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const r = selectedRequest;
                      setSelectedRequest(null);
                      if (await onDeleteOuting(r) && editingDraftId === r.id) reset();
                    }}
                    className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Delete Draft
                  </button>
                </div>
              )}
              {(selectedRequest.status === 'Parent Approval Pending' || selectedRequest.status === 'Pending Warden') && (
                <div className="flex flex-wrap gap-2">
                  {selectedRequest.status === 'Parent Approval Pending' && (
                    <button
                      type="button"
                      onClick={() => onResendParentApproval(selectedRequest.id)}
                      className="px-3 py-1.5 bg-blue-50 text-[var(--kv-primary)] hover:bg-blue-100 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Resend approval request
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const r = selectedRequest;
                      setSelectedRequest(null);
                      await onDeleteOuting(r);
                    }}
                    className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Withdraw Request
                  </button>
                </div>
              )}
              {selectedRequest.status === 'Approved' && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRequest(null);
                    onNavigateTab('my-outpass');
                  }}
                  className="px-3.5 py-1.5 bg-[var(--kv-primary)] text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  View in My Outpass →
                </button>
              )}
              <button type="button" onClick={() => setSelectedRequest(null)} className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg ml-auto cursor-pointer">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
