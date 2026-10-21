import React from 'react';
import { MessTab } from '../../../types/mess';
import { messDataService } from '../../../services/messDataService';
import { MessWelcomeSection } from './MessWelcomeSection';
import { MessTodayMenuSection } from './MessTodayMenuSection';
import { StatCard } from '../../common/ui';

interface MessDashboardProps {
  onNavigateTab: (tab: MessTab) => void;
  onShowToast: (msg: string, isError?: boolean) => void;
}

export const MessDashboard: React.FC<MessDashboardProps> = ({ onNavigateTab }) => {
  const profile = messDataService.getProfile();
  const todayMenu = messDataService.getTodayMenu();
  const todayDate = messDataService.getTodayDate();
  const metrics = messDataService.getMetrics();
  const previewFeedbacks = messDataService.getFeedbacks().slice(0, 4);

  return (
    <div className="flex flex-col w-full gap-6 max-w-7xl mx-auto pb-12">
      <MessWelcomeSection profile={profile} todayDate={todayDate} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Hostel residents" value={metrics.totalStudents} icon="groups" hint="Active hostellers" />
        <StatCard
          label="Today's meals published"
          value={`${metrics.publishedMealsCount}/4`}
          icon="restaurant_menu"
          tone="green"
          hint={`${metrics.totalMenuItemsToday} item(s) on today's menu`}
          onClick={() => onNavigateTab('food-menu')}
        />
        <StatCard label="Feedback today" value={metrics.feedbackToday} icon="rate_review" tone="violet" onClick={() => onNavigateTab('student-feedback')} />
        <StatCard
          label={`Avg rating (${metrics.windowDays} d)`}
          value={metrics.averageRating === null ? '—' : `${metrics.averageRating} / 5`}
          icon="star"
          tone="amber"
          hint={metrics.totalFeedback ? `${metrics.totalFeedback} review(s), ${metrics.positivePercentage}% positive` : 'No feedback yet'}
          onClick={() => onNavigateTab('student-feedback')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 flex flex-col justify-between">
          <MessTodayMenuSection todayMenu={todayMenu} onManageMenu={() => onNavigateTab('food-menu')} />
        </div>
        <section className="lg:col-span-4 bg-white rounded-2xl p-6 border border-slate-100 shadow-xs flex flex-col">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[17px]" aria-hidden="true">chat</span>
              </div>
              <h3 className="font-bold text-sm text-slate-900 leading-tight">Recent student feedback</h3>
            </div>
            <button onClick={() => onNavigateTab('student-feedback')} type="button" className="text-xs font-semibold text-[var(--kv-primary)] hover:underline cursor-pointer">
              View all
            </button>
          </div>
          {previewFeedbacks.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No feedback submitted yet.</p>
          ) : (
            <div className="space-y-4">
              {previewFeedbacks.map((fb, idx) => (
                <div key={fb.id} className={idx > 0 ? 'pt-3 border-t border-slate-100' : ''}>
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <span className="text-xs font-bold text-slate-800 truncate">
                      {fb.studentName} <span className="font-mono text-slate-400 font-normal">({fb.regNumber})</span>
                    </span>
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-0.5 shrink-0">
                      <span className="material-symbols-outlined text-[14px] text-amber-500" aria-hidden="true">star</span>
                      <span>{fb.averageRating}</span>
                    </span>
                  </div>
                  {fb.comment && <p className="text-xs text-slate-600 italic leading-relaxed line-clamp-2">&quot;{fb.comment}&quot;</p>}
                  <div className="flex items-center justify-between mt-2 text-[10px]">
                    <span className="px-2 py-0.5 rounded bg-blue-50 text-[var(--kv-primary)] font-semibold">{fb.mealCategory}</span>
                    <span className="text-slate-400 font-mono">{fb.submittedAt}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
