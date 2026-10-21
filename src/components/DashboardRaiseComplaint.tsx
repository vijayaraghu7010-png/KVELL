import React, { useRef, useState } from 'react';
import { Complaint, ComplaintCategory, ComplaintDraft, ComplaintPriority, DashboardTab } from '../types';

export interface ComplaintInput {
  categoryId: string;
  title: string;
  priority: ComplaintPriority;
  description: string;
  location: string;
  fileName?: string;
  draftId?: string;
}

interface DashboardRaiseComplaintProps {
  drafts: ComplaintDraft[];
  complaints: Complaint[];
  /** Categories, their default priority and resolution target, loaded from the server. */
  categories: ComplaintCategory[];
  defaultLocation: string;
  onSaveDraft: (draft: { id: string | null; title: string; category: string; urgency: string; priority?: string; location?: string; description: string; fileName?: string }) => Promise<ComplaintDraft | undefined>;
  onDeleteDraft: (id: string) => Promise<boolean>;
  onSubmitComplaint: (input: ComplaintInput, file: File | null) => Promise<Complaint | undefined>;
  onNavigateTab: (tab: DashboardTab) => void;
  onShowToast: (msg: string, isError?: boolean) => void;
}

const PRIORITIES: ComplaintPriority[] = ['Low', 'Medium', 'High', 'Critical'];
const MAX_FILE = 5 * 1024 * 1024;

/** Standard resolution window per priority, shown until a category sets its own. */
const DEFAULT_TARGET_HOURS: Record<ComplaintPriority, number> = { Critical: 8, High: 12, Medium: 24, Low: 36 };

/** Hours the institution allows for this category at this priority. */
const targetHours = (cat: ComplaintCategory | undefined, priority: ComplaintPriority) => cat?.targets?.[priority] ?? cat?.resolutionHours ?? DEFAULT_TARGET_HOURS[priority];
const hoursLabel = (h: number | undefined) => (h === undefined ? 'target not configured' : `${h} hrs`);

export const DashboardRaiseComplaint: React.FC<DashboardRaiseComplaintProps> = ({
  drafts,
  complaints,
  categories,
  defaultLocation,
  onSaveDraft,
  onDeleteDraft,
  onSubmitComplaint,
  onNavigateTab,
  onShowToast,
}) => {
  const [categoryId, setCategoryId] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [priority, setPriority] = useState<ComplaintPriority>('Medium');
  const [description, setDescription] = useState<string>('');
  const [location, setLocation] = useState<string>(defaultLocation);
  const [file, setFile] = useState<File | null>(null);
  const [draftFileName, setDraftFileName] = useState<string>('');
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [isDraftsModalOpen, setIsDraftsModalOpen] = useState(false);
  const [pendingDeleteDraftId, setPendingDeleteDraftId] = useState<string | null>(null);
  const [submittedSuccessId, setSubmittedSuccessId] = useState<string | null>(null);

  // Errors
  const [categoryError, setCategoryError] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState(false);

  const selectedCategory = categories.find((c) => c.id === categoryId);

  const fileName = file?.name || draftFileName;

  /** Picking a category pre-selects the priority the institution configured for it. */
  const handleSelectCategory = (cat: ComplaintCategory) => {
    setCategoryId(cat.id);
    setPriority(cat.defaultPriority);
    setCategoryError(false);
    setIsCategoryMenuOpen(false);
  };

  const handleFileChosen = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE) {
      onShowToast('Files must be 5 MB or smaller.', true);
      return;
    }
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(f.type)) {
      onShowToast('Only PDF or image (PNG, JPG, WebP) files can be attached.', true);
      return;
    }
    setFile(f);
    setDraftFileName('');
  };

  const handleSaveDraftClick = async () => {
    const hasData = Boolean(categoryId || title.trim() || description.trim() || fileName);
    if (hasData) {
      const draftTitle = title.trim() || `${selectedCategory?.name ?? 'General'} issue`;
      const saved = await onSaveDraft({
        id: activeDraftId,
        title: draftTitle,
        category: categoryId,
        urgency: `${priority} (${hoursLabel(targetHours(selectedCategory, priority))})`,
        priority,
        location: location.trim() || undefined,
        description,
        fileName: fileName || undefined,
      });
      if (!saved) return;
      setActiveDraftId(saved.id);
      onShowToast(`Draft "${draftTitle}" saved.${file ? ' Re-attach the file when you submit.' : ''}`);
    }
    setIsDraftsModalOpen(true);
  };

  const handleContinueDraft = (d: ComplaintDraft) => {
    const cat = categories.find((c) => c.id === d.categoryId || c.id === d.category || c.name === d.category);
    setActiveDraftId(d.id);
    setCategoryId(cat?.id ?? '');
    setTitle(d.title ?? '');
    setPriority((PRIORITIES.includes(d.priority as ComplaintPriority) ? d.priority : cat?.defaultPriority ?? 'Medium') as ComplaintPriority);
    if (d.location) setLocation(d.location);
    setDescription(d.description);
    setFile(null);
    setDraftFileName(d.fileName || '');
    setIsDraftsModalOpen(false);
    setCategoryError(false);
    setTitleError(null);
    setDescriptionError(null);
    onShowToast(`Restored "${d.title}" draft for editing.`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    let valid = true;
    if (!categoryId) {
      setCategoryError(true);
      valid = false;
    }
    if (title.trim().length < 5) {
      setTitleError('Give the complaint a title of at least 5 characters.');
      valid = false;
    }
    if (description.trim().length < 10) {
      setDescriptionError('Please describe the issue in at least 10 characters.');
      valid = false;
    }
    if (!location.trim()) {
      setLocationError(true);
      valid = false;
    }
    if (!valid) {
      onShowToast('Please fill in the required fields.', true);
      return;
    }
    setSubmitting(true);
    const created = await onSubmitComplaint(
      { categoryId, title: title.trim(), priority, description: description.trim(), location: location.trim(), fileName: file?.name, draftId: activeDraftId ?? undefined },
      file,
    );
    setSubmitting(false);
    if (!created) return;
    setActiveDraftId(null);
    setSubmittedSuccessId(created.id);
    setTitle('');
    setPriority('Medium');
    setCategoryId('');
    setDescription('');
    setFile(null);
    setDraftFileName('');
  };

  const recent = complaints.slice(0, 2);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title section */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Raise complaint</h1>
            {activeDraftId && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-[var(--kv-primary)] border border-blue-200">
                Editing Draft
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">Submit your hostel or campus infrastructure issues for quick resolution.</p>
        </div>
      </div>

      {submittedSuccessId ? (
        /* Submission Success Card */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-10 max-w-xl mx-auto text-center space-y-6 animate-in zoom-in-95">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl font-bold shadow-sm">
            ✓
          </div>
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-slate-900">Complaint Submitted Successfully</h3>
            <p className="text-xs text-slate-500">Your complaint has been registered and queued for Hostel Warden review.</p>
          </div>

          <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Complaint Reference</span>
            <p className="text-lg font-mono font-bold text-[var(--kv-primary)] tracking-wide">
              {submittedSuccessId}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setSubmittedSuccessId(null);
              }}
              className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl transition cursor-pointer"
            >
              Raise Another Issue
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('complaint-status')}
              className="w-full sm:w-auto px-5 py-2.5 bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white text-xs font-semibold rounded-xl transition shadow-sm cursor-pointer"
            >
              Track in Complaint Status →
            </button>
          </div>
        </div>
      ) : (
        /* Form Card Container */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* Field 1: Issue Category */}
            <div className="space-y-2 relative">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Issue Category <span className="text-rose-500">*</span>
              </label>

              <div
                onClick={() => setIsCategoryMenuOpen(!isCategoryMenuOpen)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm flex items-center justify-between cursor-pointer hover:border-[var(--kv-primary)] transition shadow-xs"
              >
                <span className={selectedCategory ? 'text-slate-900 font-medium' : 'text-slate-400'}>
                  {selectedCategory?.name || 'Select category...'}
                </span>
                <span className={`material-symbols-outlined text-[18px] text-slate-400 transition-transform ${isCategoryMenuOpen ? 'rotate-180' : ''}`}>
                  expand_more
                </span>
              </div>

              {/* Dropdown Menu */}
              {isCategoryMenuOpen && (
                <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-2 max-h-60 overflow-y-auto">
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      onClick={() => handleSelectCategory(cat)}
                      className={`px-4 py-2.5 text-xs text-slate-800 hover:bg-blue-50 hover:text-[var(--kv-primary)] cursor-pointer transition flex items-start justify-between gap-3 ${
                        categoryId === cat.id ? 'bg-blue-50 font-bold text-[var(--kv-primary)]' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block">{cat.name}</span>
                        <span className="block text-[10px] font-normal text-slate-500">
                          {cat.routesToAO ? 'Reviewed by the Administrative Officer' : `Default ${cat.defaultPriority} · ${hoursLabel(cat.targets?.[cat.defaultPriority] ?? cat.resolutionHours)}`}
                        </span>
                      </span>
                      {categoryId === cat.id && <span className="material-symbols-outlined text-[16px] text-[var(--kv-primary)]">check</span>}
                    </div>
                  ))}
                </div>
              )}
              {categoryError && (
                <p className="text-xs text-rose-500">Please select an issue category.</p>
              )}
              {selectedCategory?.routesToAO && (
                <p className="text-xs text-[var(--kv-primary)] bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  This complaint goes to the Administrative Officer. The Warden will not see it.
                </p>
              )}
            </div>

            {/* Field 1b: Complaint Title */}
            <div className="space-y-2">
              <label htmlFor="complaint-title" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Complaint Title <span className="text-rose-500">*</span>
              </label>
              <input
                id="complaint-title"
                value={title}
                aria-invalid={!!titleError}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleError(null);
                }}
                placeholder="A short summary, e.g. No water in the west wing washroom"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
              />
              {titleError && <p className="text-xs text-rose-500" role="alert">{titleError}</p>}
            </div>

            {/* Field 2: Priority — separate from the resolution target it implies */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">Priority</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="radiogroup" aria-label="Priority">
                {PRIORITIES.map((p) => {
                  const isActive = priority === p;
                  const hours = targetHours(selectedCategory, p);
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      onClick={() => setPriority(p)}
                      className={`border rounded-xl py-2.5 px-2 text-xs font-bold transition focus:outline-none cursor-pointer ${
                        isActive ? 'bg-blue-50 border-[var(--kv-primary)] text-[var(--kv-primary)] shadow-sm ring-1 ring-[var(--kv-primary)]' : 'border-slate-200 text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      <span className="block">{p}</span>
                      <span className="block text-[10px] font-semibold text-slate-500 mt-0.5">{hoursLabel(hours)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">
                {selectedCategory
                  ? `Priority is how urgent the issue is; ${hoursLabel(targetHours(selectedCategory, priority))} is the resolution target the hostel has configured for ${selectedCategory.name} at ${priority} priority.`
                  : `Priority is how urgent the issue is; ${hoursLabel(targetHours(undefined, priority))} is the standard resolution target. Pick a category to see the target it configures.`}
              </p>
            </div>

            {/* Field 3: Detailed Description */}
            <div className="space-y-2">
              <label htmlFor="complaint-description" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Detailed Description <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="complaint-description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (e.target.value.trim().length >= 10) setDescriptionError(null);
                }}
                rows={4}
                placeholder="Please describe the issue in detail, including specific locations (e.g. washroom tap, right side switchboard)..."
                className="w-full border border-slate-200 rounded-xl p-3.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
              />
              {descriptionError && (
                <p className="text-xs text-rose-500" role="alert">{descriptionError}</p>
              )}
            </div>

            {/* Field: Location */}
            <div className="space-y-2">
              <label htmlFor="complaint-location" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Location <span className="text-rose-500">*</span>
              </label>
              <input
                id="complaint-location"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  if (e.target.value.trim()) setLocationError(false);
                }}
                placeholder="e.g. Block B, Room B-304, attached washroom"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[var(--kv-primary)] focus:border-[var(--kv-primary)] shadow-xs"
              />
              {locationError && <p className="text-xs text-rose-500" role="alert">Please enter where the issue is.</p>}
            </div>

            {/* Field 4: Consent Document / Attachment */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Consent Document / Photo / Proof (Optional)
              </label>
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    className="hidden"
                    aria-label="Choose a photo or PDF to attach"
                    onChange={(e) => handleFileChosen(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="bg-white border border-slate-300 px-4 py-2 rounded-lg text-xs font-semibold text-slate-800 hover:bg-slate-100 transition shadow-xs cursor-pointer"
                  >
                    Choose File
                  </button>
                  <span className="text-xs text-slate-500 font-mono break-all">
                    {file ? file.name : draftFileName ? `${draftFileName} (re-select to attach)` : 'No file chosen'}
                  </span>
                </div>
                {fileName && (
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setDraftFileName('');
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                    className="text-xs text-rose-500 hover:text-rose-700 font-semibold cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400">PDF or image files allowed. Max 5 MB.</p>
            </div>

            {/* Buttons Row */}
            <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
              <button
                type="submit"
                disabled={submitting}
                className="bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-xl text-xs flex items-center gap-2 transition shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">{submitting ? 'progress_activity' : 'send'}</span>
                <span>{submitting ? 'Submitting…' : 'Submit Complaint'}</span>
              </button>
              <button
                type="button"
                onClick={handleSaveDraftClick}
                className="bg-blue-50 hover:bg-blue-100 text-[var(--kv-primary)] font-semibold px-6 py-2.5 rounded-xl text-xs border border-blue-200 transition cursor-pointer"
              >
                Save Draft
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Previous Complaints & Drafts Section */}
      <div className="mt-8 space-y-3">
        <h3 className="text-base font-bold text-slate-900">Previous Complaints & Drafts</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {recent.length === 0 && (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-4 text-xs text-slate-500 sm:col-span-2">
              You have not raised any complaints yet.
            </div>
          )}
          {recent.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => onNavigateTab('complaint-status')}
              className="text-left bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-2 hover:border-[var(--kv-primary)] cursor-pointer transition"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate">{c.category}: {c.title ?? c.description}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{c.location} · {c.id}</div>
                </div>
                <span
                  className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full shrink-0 ${
                    c.status === 'Resolved' || c.status === 'Closed' ? 'bg-emerald-100 text-emerald-800' : c.isOverdue || c.status === 'Reopened' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <div className="text-[11px] text-[var(--kv-primary)] font-semibold flex items-center gap-1">
                <span>Track Resolution Timeline</span>
                <span aria-hidden="true">→</span>
              </div>
            </button>
          ))}
          {drafts.length > 0 && (
            <button type="button" onClick={() => setIsDraftsModalOpen(true)} className="text-left bg-blue-50/60 border border-blue-200 rounded-xl p-4 text-xs font-semibold text-[var(--kv-primary)] hover:bg-blue-50 cursor-pointer">
              {drafts.length} saved draft{drafts.length === 1 ? '' : 's'} — open drafts →
            </button>
          )}
        </div>
      </div>

      {/* Saved Drafts Modal Dialog */}
      {isDraftsModalOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          onClick={() => setIsDraftsModalOpen(false)}
        >
          <div 
            className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Saved Complaint Drafts</h3>
                <p className="text-xs text-slate-500">Select a draft to continue editing or remove unwanted drafts.</p>
              </div>
              <button 
                onClick={() => setIsDraftsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 cursor-pointer"
                type="button"
              >
                ✕
              </button>
            </div>

            {/* Modal Drafts List */}
            <div className="p-6 overflow-y-auto space-y-3 flex-1 bg-slate-50">
              {drafts.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-xl border border-slate-200">
                  <p className="text-xs text-slate-500">No saved drafts currently.</p>
                </div>
              ) : (
                drafts.map((d, index) => (
                  <div 
                    key={d.id}
                    className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2.5 hover:border-blue-300 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 bg-blue-50 text-[var(--kv-primary)] rounded border border-blue-200">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="text-xs font-bold text-slate-800">{d.title}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium">Last edited: {d.lastEdited}</span>
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs text-slate-700 space-y-1">
                      <div className="flex items-center gap-3 text-[11px]">
                        <span><strong className="text-slate-500">Category:</strong> {d.category}</span>
                        <span><strong className="text-slate-500">Urgency:</strong> {d.urgency}</span>
                        {d.fileName && <span><strong className="text-slate-500">File:</strong> 📎 {d.fileName}</span>}
                      </div>
                      <p className="text-slate-600 italic text-[11px] line-clamp-2">"{d.description}"</p>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleContinueDraft(d)}
                        className="px-3 py-1.5 bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        Continue
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteDraftId(d.id)}
                        className="px-3 py-1.5 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-white flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                {drafts.length} draft{drafts.length === 1 ? '' : 's'} available
              </span>
              <button
                type="button"
                onClick={() => setIsDraftsModalOpen(false)}
                className="px-4 py-1.5 bg-[var(--kv-primary)] text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Sub-Modal */}
      {pendingDeleteDraftId && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          onClick={() => setPendingDeleteDraftId(null)}
        >
          <div 
            className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 text-center space-y-4 animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-[24px]">delete</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Delete this draft?</h3>
              <p className="text-xs text-slate-500 mt-1">This draft will be permanently removed.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteDraftId(null)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = pendingDeleteDraftId;
                  setPendingDeleteDraftId(null);
                  if (await onDeleteDraft(id)) {
                    if (activeDraftId === id) setActiveDraftId(null);
                    onShowToast('Draft deleted.');
                  }
                }}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg cursor-pointer shadow-sm"
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
