import React, { useState } from 'react';
import { Modal, Button, TextField, TextArea } from './common/ui';

export interface StudentProfileData {
  id: string;
  name: string;
  regNumber: string;
  department: string;
  departmentName: string;
  year: string;
  semester: number | null;
  roomNumber: string;
  block: string;
  status: string;
  gender: string;
  contactNumber: string;
  email: string;
  permanentAddress: string;
  parentName: string;
  parentNumber: string;
  bloodGroup: string;
  enrollmentStatus: string;
  admissionYear: number | null;
  mentor: string;
  /** Class section the student belongs to, and the staff derived from it. */
  section: string | null;
  sectionLabel: string;
  classIncharge: { name: string; email: string; phone: string } | null;
  classInchargeName: string;
  hodName: string;
  avatarInitials: string;
}

interface DashboardProfileProps {
  profile: StudentProfileData;
  onUpdateContact: (phone: string, address: string) => Promise<boolean>;
  onShowToast: (msg: string, isError?: boolean) => void;
  /** Sign-out lives here because the top bar opens this page instead of an account menu. */
  onSignOut: () => void;
}

/** Generic person mark, used in place of initials on the profile header. */
const AvatarIcon: React.FC = () => (
  <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="4" />
    <circle cx="32" cy="24" r="10" fill="currentColor" />
    <path d="M14 52a18 18 0 0 1 36 0 29 29 0 0 1-36 0z" fill="currentColor" />
  </svg>
);

/** Person bust overlaid with a pencil — "edit who this is", not "edit a document". */
const EditProfileIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="10" cy="7" r="4" />
    <path d="M3 21v-1.2A6.8 6.8 0 0 1 9.8 13h2.4" />
    <path d="M20.7 12.6a1.7 1.7 0 0 0-2.4 0l-6 6V21h2.4l6-6a1.7 1.7 0 0 0 0-2.4z" />
  </svg>
);

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className="mt-1 text-sm font-bold text-slate-900 break-words">{value || '—'}</dd>
  </div>
);

export const DashboardProfile: React.FC<DashboardProfileProps> = ({ profile, onUpdateContact, onShowToast, onSignOut }) => {
  const [activeSubTab, setActiveSubTab] = useState<'institutional' | 'hostel'>('institutional');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [tempPhone, setTempPhone] = useState(profile.contactNumber);
  const [tempAddress, setTempAddress] = useState(profile.permanentAddress);
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const tabs = [
    { id: 'institutional' as const, label: 'Institutional & Personal Record', icon: 'badge' },
    { id: 'hostel' as const, label: 'Hostel Stay Details', icon: 'apartment' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[var(--kv-nav-bg)] via-[var(--kv-primary)] to-[var(--kv-primary)] text-white shadow-xl shadow-[var(--kv-nav-bg)]/10 p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 relative z-10">
          <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-6 flex-1 text-center sm:text-left">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center text-white shadow-inner shrink-0 p-4" role="img" aria-label={`${profile.name}'s profile picture`}>
              <AvatarIcon />
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{profile.name}</h1>
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-white/15 text-white border border-white/20 tracking-wider">REG: {profile.regNumber}</span>
              </div>
              <p className="text-blue-100 font-medium text-xs sm:text-sm flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <span>{profile.departmentName}</span>
                <span className="text-blue-300" aria-hidden="true">•</span>
                <span className="text-white font-semibold">{profile.sectionLabel}</span>
                <span className="text-blue-300" aria-hidden="true">•</span>
                <span className="text-white font-semibold">
                  {profile.year}
                  {profile.semester ? ` (Semester ${profile.semester})` : ''}
                </span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-center">
            <button
              type="button"
              onClick={() => {
                setTempPhone(profile.contactNumber);
                setTempAddress(profile.permanentAddress);
                setPhoneError(null);
                setIsEditModalOpen(true);
              }}
              aria-label="Edit contact details"
              title="Edit contact details"
              className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-white text-[var(--kv-heading)] shadow-md hover:bg-blue-50 transition cursor-pointer"
            >
              <EditProfileIcon />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-slate-200">
        <nav className="flex space-x-6 overflow-x-auto pb-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeSubTab === t.id}
              onClick={() => setActiveSubTab(t.id)}
              className={`border-b-2 pb-3 text-xs flex items-center space-x-2 whitespace-nowrap cursor-pointer transition ${
                activeSubTab === t.id ? 'border-[var(--kv-primary)] text-[var(--kv-heading)] font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {activeSubTab === 'institutional' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
            <h2 className="text-sm font-bold text-[var(--kv-heading)] mb-4">Institutional record</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Row label="Full name" value={profile.name} />
              <Row label="Register number" value={profile.regNumber} />
              <Row label="Department" value={profile.departmentName} />
              <Row label="Class section" value={profile.sectionLabel} />
              <Row label="Year / semester" value={`${profile.year}${profile.semester ? ` · Sem ${profile.semester}` : ''}`} />
              <Row label="Admission year" value={profile.admissionYear ?? '—'} />
              <Row
                label="Class Incharge"
                value={
                  profile.classIncharge ? (
                    <span className="block">
                      {profile.classIncharge.name}
                      <span className="block text-[11px] font-medium text-slate-500">{profile.classIncharge.email}{profile.classIncharge.phone ? ` · ${profile.classIncharge.phone}` : ''}</span>
                      <span className="block text-[11px] font-medium text-slate-400">Approves your leave requests first</span>
                    </span>
                  ) : (
                    <span className="block">
                      Not assigned
                      <span className="block text-[11px] font-medium text-rose-500">Leave requests cannot be submitted until an administrator assigns one.</span>
                    </span>
                  )
                }
              />
              <Row label="Head of Department" value={profile.hodName} />
              <Row label="Class adviser" value={profile.mentor} />
            </dl>
          </section>
          <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
            <h2 className="text-sm font-bold text-[var(--kv-heading)] mb-4">Personal & guardian contact</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Row label="Email" value={profile.email} />
              <Row label="Mobile" value={profile.contactNumber} />
              <Row label="Gender" value={profile.gender} />
              <Row label="Blood group" value={profile.bloodGroup} />
              <Row label="Parent / guardian" value={profile.parentName} />
              <Row label="Guardian phone" value={profile.parentNumber} />
              <div className="sm:col-span-2">
                <Row label="Permanent address" value={profile.permanentAddress} />
              </div>
            </dl>
            <p className="text-[11px] text-slate-400 mt-4">Guardian details are maintained by the Warden office. Contact them for corrections.</p>
          </section>
        </div>
      )}

      {activeSubTab === 'hostel' && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <h2 className="text-sm font-bold text-[var(--kv-heading)] mb-4">Hostel stay</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Row label="Block" value={profile.block} />
            <Row label="Room" value={profile.roomNumber} />
            <Row label="Current status" value={profile.status} />
          </dl>
          <p className="text-[11px] text-slate-400 mt-4">Room changes are made by the Warden through Room Allocation.</p>
        </section>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-rose-200 bg-white text-rose-700 font-bold text-xs tracking-wide hover:bg-rose-50 transition cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">logout</span>
          <span>SIGN OUT</span>
        </button>
      </div>

      <Modal
        open={isEditModalOpen}
        title="Edit contact details"
        onClose={() => setIsEditModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              onClick={async () => {
                if (tempPhone && !/^[+\d\s()-]{6,30}$/.test(tempPhone)) {
                  setPhoneError('Enter a valid phone number.');
                  return;
                }
                setSaving(true);
                const ok = await onUpdateContact(tempPhone.trim(), tempAddress.trim());
                setSaving(false);
                if (ok) setIsEditModalOpen(false);
              }}
            >
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <TextField label="Mobile number" value={tempPhone} onChange={(e) => setTempPhone(e.target.value)} inputMode="tel" error={phoneError} />
          <TextArea label="Permanent address" value={tempAddress} onChange={(e) => setTempAddress(e.target.value)} rows={3} />
        </div>
      </Modal>
    </div>
  );
};
