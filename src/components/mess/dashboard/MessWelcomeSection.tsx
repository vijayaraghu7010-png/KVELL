import React from 'react';
import { MessProfile } from '../../../types/mess';

interface MessWelcomeSectionProps {
  profile: MessProfile;
  todayDate: string;
}

export const MessWelcomeSection: React.FC<MessWelcomeSectionProps> = ({
  profile,
  todayDate,
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[var(--kv-surface-alt)] p-6 rounded-2xl border border-[var(--kv-border)]">
      <div className="flex items-center gap-4">
        {/* Cutlery icon */}
        <div className="w-12 h-12 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[24px]">restaurant</span>
        </div>

        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--kv-primary)] block">
            MESS PORTAL
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 leading-tight">
            Home
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Welcome back, <strong className="text-slate-800">{profile.name}</strong> ({profile.role}). Manage food menu, track student feedback and view mess reports.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 bg-white/90 px-4 py-2 rounded-xl border border-blue-100 shadow-2xs self-start md:self-auto">
        <span className="material-symbols-outlined text-[var(--kv-heading)] text-[18px]">calendar_today</span>
        <div className="text-left">
          <span className="text-[10px] uppercase font-bold text-slate-400 block leading-tight tracking-wider">
            TODAY
          </span>
          <span className="text-xs font-bold text-slate-800 leading-tight">
            {todayDate}
          </span>
        </div>
      </div>
    </div>
  );
};
