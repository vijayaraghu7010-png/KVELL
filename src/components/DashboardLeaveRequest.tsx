import React, { useRef, useState } from 'react';
import { DashboardTab, LeaveDraft, LeaveRequest } from '../types';

export interface LeaveInput {
  type: string;
  fromDate: string;
  toDate: string;
  /** Wall-clock HH:MM in the institution timezone; combined with the dates server-side. */
  departureTime?: string;
  returnTime?: string;
  reason: string;
  addressDuringLeave?: string;
  fileName?: string;
  draftId?: string;
}

interface DashboardLeaveRequestProps {
  drafts: LeaveDraft[];
  leaveRequests: LeaveRequest[];
  onSaveDraft: (draft: { id: string | null; title: string; type: string; fromDate: string; toDate: string; reason: string; fileName?: string }) => Promise<LeaveDraft | undefined>;
  onDeleteDraft: (id: string) => Promise<boolean>;
  onSubmitLeave: (input: LeaveInput, file: File | null) => Promise<LeaveRequest | undefined>;
  onNavigateTab: (tab: DashboardTab) => void;
  onShowToast: (msg: string, isError?: boolean) => void;
}

// Must match server/services/requests.ts LEAVE_TYPES
const LEAVE_TYPES = ['Personal Leave', 'Medical Leave', 'Family Function', 'Emergency Leave', 'Academic / Event', 'Festival Leave', 'Other'];
const MAX_FILE = 5 * 1024 * 1024;

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const display = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const statusStyle = (s: string) =>
  s === 'Approved'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : s === 'Rejected' || s === 'Cancelled'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';
const statusLabel = (r: LeaveRequest) =>
  r.workflowStatus === 'Pending Class Incharge'
    ? 'Pending Class Incharge'
    : r.workflowStatus === 'Pending HOD'
      ? 'Pending HOD Approval'
      : r.workflowStatus === 'Pending Warden'
        ? 'Pending Warden Approval'
        : r.status;

export const DashboardLeaveRequest: React.FC<DashboardLeaveRequestProps> = ({
  drafts,
  leaveRequests,
  onSaveDraft,
  onDeleteDraft,
  onSubmitLeave,
  onNavigateTab,
  onShowToast,
}) => {
  const [currentView, setCurrentView] = useState<'form' | 'drafts' | 'success'>('form');

  // Form State
  const [leaveType, setLeaveType] = useState<string>('Personal Leave');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [departureTime, setDepartureTime] = useState<string>('');
  const [returnTime, setReturnTime] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [draftFileName, setDraftFileName] = useState<string>('');
  const [currentEditingDraftId, setCurrentEditingDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<LeaveRequest | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Validation
  const [errors, setErrors] = useState<{ fromDate?: string; toDate?: string; reason?: string; returnTime?: string }>({});

  // Delete modal
  const [pendingDeleteDraftId, setPendingDeleteDraftId] = useState<string | null>(null);

  const resetForm = () => {
    setLeaveType('Personal Leave');
    setFromDate('');
    setToDate('');
    setDepartureTime('');
    setReturnTime('');
    setReason('');
    setAddress('');
    setFile(null);
    setDraftFileName('');
    setErrors({});
    if (fileInput.current) fileInput.current.value = '';
  };

  const handleFileChosen = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE) return onShowToast('Files must be 5 MB or smaller.', true);
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(f.type)) return onShowToast('Only PDF or image files can be attached.', true);
    setFile(f);
    setDraftFileName('');
  };

  const handleSaveDraft = async () => {
    if (!fromDate && !toDate && !reason.trim()) {
      onShowToast('Please enter leave details before saving.', true);
      return;
    }
    const saved = await onSaveDraft({
      id: currentEditingDraftId,
      title: `${leaveType} — Draft`,
      type: leaveType,
      fromDate,
      toDate,
      reason,
      fileName: file?.name || draftFileName || undefined,
    });
    if (!saved) return;
    setCurrentEditingDraftId(saved.id);
    onShowToast(`Draft saved.${file ? ' Re-attach the document when you submit.' : ''}`);
    setCurrentView('drafts');
  };

  const handleContinueDraft = (d: LeaveDraft) => {
    setCurrentEditingDraftId(d.id);
    setLeaveType(d.type && LEAVE_TYPES.includes(d.type) ? d.type : 'Personal Leave');
    setFromDate(d.fromDate);
    setToDate(d.toDate);
    setReason(d.reason);
    setFile(null);
    setDraftFileName(d.fileName || '');
    setErrors({});
    setCurrentView('form');
    onShowToast(`Restored draft${d.fromDateDisplay ? ` ${d.fromDateDisplay} → ${d.toDateDisplay}` : ''}.`);
  };

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const errs: typeof errors = {};
    if (!fromDate) errs.fromDate = 'From date is required.';
    else if (fromDate < todayStr()) errs.fromDate = 'Leave cannot start in the past.';
    if (!toDate) errs.toDate = 'To date is required.';
    else if (fromDate && toDate < fromDate) errs.toDate = 'To date must be on or after the from date.';
    if (reason.trim().length < 10) errs.reason = 'Please give the reason in at least 10 characters.';
    if (departureTime && returnTime && fromDate && toDate && `${fromDate}T${departureTime}` >= `${toDate}T${returnTime}`) {
      errs.returnTime = 'Expected return must be after the departure time.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      onShowToast('Please correct the highlighted fields.', true);
      return;
    }
    setSubmitting(true);
    const created = await onSubmitLeave(
      {
        type: leaveType,
        fromDate,
        toDate,
        departureTime: departureTime || undefined,
        returnTime: returnTime || undefined,
        reason: reason.trim(),
        addressDuringLeave: address.trim() || undefined,
        fileName: file?.name,
        draftId: currentEditingDraftId ?? undefined,
      },
      file,
    );
    setSubmitting(false);
    if (!created) return;
    setCurrentEditingDraftId(null);
    setSubmitted(created);
    resetForm();
    setCurrentView('success');
  };

  const recent = leaveRequests.slice(0, 4);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* View 1: Form View */}
      {currentView === 'form' && (
        <section className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leave Request</h1>
              <p className="text-xs text-slate-500">
              Requests go to your Class Incharge, then the HOD, then the Warden. Each approval is mandatory, and an outpass is issued only after the Warden approves.
            </p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentView('drafts')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-[var(--kv-primary)] text-xs font-semibold border border-blue-200 transition cursor-pointer self-start md:self-auto"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">inventory_2</span>
              <span>Saved Drafts ({drafts.length})</span>
            </button>
          </div>

          {/* Active Editing Draft Banner */}
          {currentEditingDraftId && (
            <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--kv-primary)]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">edit_document</span>
                <span>Editing a saved draft{fromDate ? `: ${display(fromDate)} → ${display(toDate)}` : ''}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCurrentEditingDraftId(null);
                  resetForm();
                  onShowToast('Stopped editing the draft. The saved draft is unchanged.');
                }}
                className="underline decoration-dotted text-slate-600 hover:text-slate-900 cursor-pointer font-semibold"
              >
                Discard Changes
              </button>
            </div>
          )}

          {/* Form Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-8">
            <form className="space-y-6" onSubmit={handleSubmitLeave} noValidate>
              <div>
                <label htmlFor="leave-type" className="block text-xs font-semibold tracking-wider text-slate-700 uppercase mb-2">
                  LEAVE TYPE <span className="text-rose-500">*</span>
                </label>
                <select
                  id="leave-type"
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs cursor-pointer"
                >
                  {LEAVE_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Dates Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="leave-from" className="block text-xs font-semibold tracking-wider text-slate-700 uppercase mb-2">
                    FROM DATE <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="leave-from"
                    type="date"
                    min={todayStr()}
                    value={fromDate}
                    aria-invalid={!!errors.fromDate}
                    onChange={(e) => {
                      setFromDate(e.target.value);
                      setErrors((x) => ({ ...x, fromDate: undefined }));
                    }}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
                  />
                  {errors.fromDate && <p className="text-xs text-rose-500 mt-1" role="alert">{errors.fromDate}</p>}
                </div>
                <div>
                  <label htmlFor="leave-to" className="block text-xs font-semibold tracking-wider text-slate-700 uppercase mb-2">
                    TO DATE <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="leave-to"
                    type="date"
                    min={fromDate || todayStr()}
                    value={toDate}
                    aria-invalid={!!errors.toDate}
                    onChange={(e) => {
                      setToDate(e.target.value);
                      setErrors((x) => ({ ...x, toDate: undefined }));
                    }}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
                  />
                  {errors.toDate && <p className="text-xs text-rose-500 mt-1" role="alert">{errors.toDate}</p>}
                </div>
              </div>

              {/* 2b. DEPARTURE AND EXPECTED RETURN TIMES */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="leave-departure-time" className="block text-xs font-semibold tracking-wider text-slate-700 uppercase mb-2">
                    DEPARTURE TIME <span className="text-slate-400 normal-case font-medium">(optional)</span>
                  </label>
                  <input
                    id="leave-departure-time"
                    type="time"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Used for the outpass validity window.</p>
                </div>
                <div>
                  <label htmlFor="leave-return-time" className="block text-xs font-semibold tracking-wider text-slate-700 uppercase mb-2">
                    EXPECTED RETURN TIME <span className="text-slate-400 normal-case font-medium">(optional)</span>
                  </label>
                  <input
                    id="leave-return-time"
                    type="time"
                    value={returnTime}
                    aria-invalid={!!errors.returnTime}
                    onChange={(e) => {
                      setReturnTime(e.target.value);
                      setErrors((x) => ({ ...x, returnTime: undefined }));
                    }}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
                  />
                  {errors.returnTime && <p className="text-xs text-rose-500 mt-1" role="alert">{errors.returnTime}</p>}
                </div>
              </div>

              {/* 3. REASON FOR LEAVE */}
              <div>
                <label htmlFor="leave-reason" className="block text-xs font-semibold tracking-wider text-slate-700 uppercase mb-2">
                  REASON FOR LEAVE <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="leave-reason"
                  rows={4}
                  value={reason}
                  aria-invalid={!!errors.reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (e.target.value.trim().length >= 10) setErrors((x) => ({ ...x, reason: undefined }));
                  }}
                  placeholder="Enter the reason for your leave (e.g. Attending sister's wedding in hometown, medical appointment)..."
                  className="w-full border border-slate-200 rounded-xl p-4 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
                />
                {errors.reason && <p className="text-xs text-rose-500 mt-1" role="alert">{errors.reason}</p>}
              </div>

              <div>
                <label htmlFor="leave-address" className="block text-xs font-semibold tracking-wider text-slate-700 uppercase mb-2">
                  ADDRESS DURING LEAVE (OPTIONAL)
                </label>
                <input
                  id="leave-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Where you will stay during the leave"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
                />
              </div>

              {/* 4. SUPPORTING DOCUMENT */}
              <div>
                <span className="block text-xs font-semibold tracking-wider text-slate-700 uppercase mb-2">SUPPORTING DOCUMENT (OPTIONAL)</span>
                <div className="border border-slate-200 rounded-xl bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      ref={fileInput}
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      className="hidden"
                      aria-label="Choose a supporting document"
                      onChange={(e) => handleFileChosen(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-medium px-4 py-2 rounded-lg shadow-xs transition cursor-pointer"
                    >
                      Choose File
                    </button>
                    <span className="text-xs text-slate-500 font-mono break-all">
                      {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : draftFileName ? `${draftFileName} (re-select to attach)` : 'No file chosen'}
                    </span>
                  </div>
                  {(file || draftFileName) && (
                    <button
                      type="button"
                      aria-label="Remove file"
                      onClick={() => {
                        setFile(null);
                        setDraftFileName('');
                        if (fileInput.current) fileInput.current.value = '';
                      }}
                      className="text-slate-400 hover:text-rose-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">PDF or image, up to 5 MB.</p>
              </div>

              {/* Action Buttons Row */}
              <div className="pt-3 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] disabled:opacity-60 text-white font-semibold text-xs px-6 py-3 rounded-xl shadow-xs flex items-center gap-2 transition cursor-pointer"
                >
                  <span className={`material-symbols-outlined text-[18px] ${submitting ? 'animate-spin' : ''}`} aria-hidden="true">{submitting ? 'progress_activity' : 'send'}</span>
                  <span>{submitting ? 'Submitting…' : 'Submit Leave Request'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  className="bg-blue-50 hover:bg-blue-100 text-[var(--kv-primary)] border border-blue-200 font-semibold text-xs px-6 py-3 rounded-xl transition cursor-pointer"
                >
                  Save Draft
                </button>
              </div>
            </form>
          </div>

          {/* Previous Submissions List */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold tracking-tight text-slate-900">Previous Leave Requests</h2>
              <span className="text-xs text-slate-400">Most recent first</span>
            </div>
            {recent.length === 0 ? (
              <div className="bg-white rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">You have not submitted any leave requests yet.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recent.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => onNavigateTab('leave-request-status')}
                    className="text-left bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between hover:border-[var(--kv-primary)] cursor-pointer transition"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-xs font-semibold text-[var(--kv-primary)]">{r.id}</span>
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${statusStyle(r.status)}`}>{statusLabel(r)}</span>
                      </div>
                      <div className="text-xs font-medium text-slate-800 mb-1">
                        {r.fromDateDisplay} → {r.toDateDisplay} · {r.type}
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2">{r.reason}</p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Submitted {r.submittedDate}</span>
                      <span className="font-semibold text-[var(--kv-primary)]">Track Status →</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* View 2: Saved Drafts View */}
      {currentView === 'drafts' && (
        <section className="space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <button
                type="button"
                onClick={() => setCurrentView('form')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--kv-primary)] hover:underline mb-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_back</span>
                <span>Back to Leave Request Form</span>
              </button>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Saved Drafts</h2>
              <p className="text-xs text-slate-500">Review, continue, or remove your saved leave requests.</p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-[var(--kv-primary)] border border-blue-200">{drafts.length} drafts</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs divide-y divide-slate-200">
            {drafts.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400">No saved drafts found.</div>
            ) : (
              drafts.map((d) => (
                <div key={d.id} className="p-6 hover:bg-slate-50/70 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight">{d.title}</h3>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
                          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">schedule</span>
                          Last edited: {d.lastEdited}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--kv-primary)]">
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">calendar_today</span>
                        <span>{d.fromDateDisplay || 'No start date'}</span>
                        <span className="text-slate-400">→</span>
                        <span>{d.toDateDisplay || 'No end date'}</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed pt-0.5 line-clamp-2">
                        <span className="font-semibold text-slate-700">Reason:</span> {d.reason || '—'}
                      </p>
                      {d.fileName && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-1">
                          <span className="material-symbols-outlined text-[var(--kv-primary)] text-[16px]" aria-hidden="true">attach_file</span>
                          <span className="font-medium text-slate-700 truncate">{d.fileName} (re-attach on submit)</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => handleContinueDraft(d)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit</span>
                        <span>Continue</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteDraftId(d.id)}
                        className="inline-flex items-center gap-1 px-3 py-2 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-semibold transition cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">delete</span>
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* View 3: Submission Confirmation View */}
      {currentView === 'success' && submitted && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 text-center max-w-lg mx-auto my-8 space-y-4" role="status">
          <div className="w-16 h-16 bg-blue-50 border border-blue-200 text-[var(--kv-primary)] rounded-full flex items-center justify-center mx-auto text-2xl font-bold" aria-hidden="true">
            ✓
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Leave Request Submitted</h2>
            <p className="text-xs text-slate-500 mt-1">
              {submitted.pendingWith
                ? `Your request is with ${submitted.pendingWith} (${submitted.pendingStage}). It still needs the remaining approvals before an outpass is issued.`
                : 'Your request has been recorded.'}
            </p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2.5 text-slate-700 text-left">
            <div className="flex justify-between border-b border-slate-200/70 pb-2">
              <span className="text-slate-400">Request ID:</span>
              <span className="font-mono font-bold text-[var(--kv-primary)]">{submitted.id}</span>
            </div>
            <div className="flex justify-between border-b border-slate-200/70 pb-2">
              <span className="text-slate-400">Duration:</span>
              <span className="font-semibold text-slate-800">
                {submitted.fromDateDisplay} to {submitted.toDateDisplay}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Status:</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${statusStyle(submitted.status)}`}>{statusLabel(submitted)}</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setSubmitted(null);
                setCurrentView('form');
              }}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl transition cursor-pointer"
            >
              New Request
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('leave-request-status')}
              className="flex-1 py-2.5 bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white text-xs font-semibold rounded-xl transition shadow-xs cursor-pointer"
            >
              Track in Leave Status →
            </button>
          </div>
        </section>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDeleteDraftId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={() => setPendingDeleteDraftId(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-leave-draft-title"
            className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 text-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">delete</span>
            </div>
            <div>
              <h3 id="delete-leave-draft-title" className="text-base font-bold text-slate-900">Delete this draft?</h3>
              <p className="text-xs text-slate-500 mt-1">This action cannot be undone.</p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" autoFocus onClick={() => setPendingDeleteDraftId(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = pendingDeleteDraftId;
                  setPendingDeleteDraftId(null);
                  if (await onDeleteDraft(id)) {
                    if (currentEditingDraftId === id) setCurrentEditingDraftId(null);
                    onShowToast('Draft removed.');
                  }
                }}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
