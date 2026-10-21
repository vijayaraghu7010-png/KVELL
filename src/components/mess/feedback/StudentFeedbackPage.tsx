import React, { useState, useMemo } from 'react';
import { messDataService } from '../../../services/messDataService';

export const StudentFeedbackPage: React.FC = () => {
  const feedbacks = messDataService.getFeedbacks();
  const metrics = messDataService.getMetrics();

  // Search and Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [ratingFilter, setRatingFilter] = useState('All');
  const [sortBy, setSortBy] = useState('Latest');

  const ratingOptions = ['All', '5 Stars', '4+ Stars', '3+ Stars', 'Below 3 Stars'];
  const sortOptions = ['Latest', 'Highest Rating', 'Lowest Rating'];

  const filteredFeedbacks = useMemo(() => {
    let result = feedbacks.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        q === '' ||
        item.studentName.toLowerCase().includes(q) ||
        item.regNumber.toLowerCase().includes(q) ||
        item.comment.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q);

      let matchesRating = true;
      if (ratingFilter === '5 Stars') {
        matchesRating = item.averageRating >= 4.8;
      } else if (ratingFilter === '4+ Stars') {
        matchesRating = item.averageRating >= 4.0;
      } else if (ratingFilter === '3+ Stars') {
        matchesRating = item.averageRating >= 3.0;
      } else if (ratingFilter === 'Below 3 Stars') {
        matchesRating = item.averageRating < 3.0;
      }

      return matchesSearch && matchesRating;
    });

    if (sortBy === 'Highest Rating') {
      result = [...result].sort((a, b) => b.averageRating - a.averageRating);
    } else if (sortBy === 'Lowest Rating') {
      result = [...result].sort((a, b) => a.averageRating - b.averageRating);
    }

    return result;
  }, [feedbacks, searchQuery, ratingFilter, sortBy]);

  return (
    <div className="flex flex-col w-full max-w-7xl mx-auto space-y-6 pb-12">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[var(--kv-surface-alt)] p-6 rounded-2xl border border-[var(--kv-border)]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[24px]">chat</span>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--kv-primary)] block">
              MESS MANAGEMENT & PUBLISHING
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 leading-tight">
              Student Feedback
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              View and manage student feedback, ratings and suggestions submitted through the Student Portal.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 bg-white/90 px-4 py-2 rounded-xl border border-blue-100 shadow-2xs self-start md:self-auto">
          <span className="material-symbols-outlined text-[var(--kv-primary)] text-[20px] fill-current">star</span>
          <div className="text-left">
            <span className="font-bold text-slate-800 text-xs block leading-tight">Overall Satisfaction</span>
            <span className="text-[10px] text-slate-500 leading-tight">
              {metrics.averageRating ?? '—'} / 5.0 (Based on {metrics.totalFeedback} Reviews)
            </span>
          </div>
        </div>
      </div>

      {/* 2. Stat Cards (4 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* TOTAL FEEDBACKS */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">group</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              TOTAL FEEDBACKS
            </span>
            <span className="text-2xl font-bold text-slate-900 leading-tight block mt-0.5">
              {metrics.totalFeedback}
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">
              From Enrolled Students
            </span>
          </div>
        </div>

        {/* AVERAGE RATING */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">star</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              AVERAGE RATING
            </span>
            <span className="text-2xl font-bold text-slate-900 leading-tight block mt-0.5">
              {metrics.averageRating ?? '—'} <span className="text-base font-normal text-slate-400">/ 5.0</span>
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">
              <span className="text-amber-500">★★★★</span>☆ Overall Rating
            </span>
          </div>
        </div>

        {/* POSITIVE FEEDBACKS */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">chat</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              POSITIVE FEEDBACKS
            </span>
            <span className="text-2xl font-bold text-slate-900 leading-tight block mt-0.5">
              {metrics.positiveFeedback} <span className="text-base font-normal text-slate-400">/ {metrics.totalFeedback}</span>
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">
              {metrics.positivePercentage ?? '—'}% Positive
            </span>
          </div>
        </div>

        {/* NEUTRAL / NEGATIVE */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">sentiment_neutral</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              NEUTRAL / NEGATIVE
            </span>
            <span className="text-2xl font-bold text-slate-900 leading-tight block mt-0.5">
              {metrics.neutralNegativeFeedback} <span className="text-base font-normal text-slate-400">/ {metrics.totalFeedback}</span>
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">
              {metrics.needsAttentionPercentage ?? '—'}% Needs Attention
            </span>
          </div>
        </div>
      </div>

      {/* 3. Search and Filters Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[260px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
            search
          </span>
          <input
            type="text"
            id="mess-feedback-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name, register number, or feedback keyword..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[var(--kv-primary)] focus:bg-white transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {/* Dropdowns */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">Rating:</span>
            <select
              id="mess-feedback-rating-filter"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:border-[var(--kv-primary)] cursor-pointer"
            >
              {ratingOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">Sort by:</span>
            <select
              id="mess-feedback-sort-filter"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:border-[var(--kv-primary)] cursor-pointer"
            >
              {sortOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 4. Feedback List Cards */}
      <div className="space-y-4">
        {filteredFeedbacks.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-xs space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-[32px]">chat</span>
            </div>
            <h4 className="font-bold text-slate-800 text-sm">No Student Feedback Matches</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              No feedback entries matched your active search or filter criteria.
            </p>
          </div>
        ) : (
          filteredFeedbacks.map((item) => {
            const initials = item.studentName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .substring(0, 2)
              .toUpperCase();

            return (
              <div
                key={item.id}
                className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs hover:border-blue-100 transition-colors space-y-3"
              >
                {/* Header row */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full text-white flex items-center justify-center font-bold text-xs shrink-0"
                      style={{ backgroundColor: 'var(--kv-nav-bg)' }}
                    >
                      {initials}
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900">
                          {item.studentName}
                        </span>
                        <span className="text-xs text-slate-400 font-normal">
                          ({item.regNumber})
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Evaluated: {item.mealCategory} • {item.day}, {item.menuDate}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-bold text-slate-900 flex items-center justify-end gap-1">
                      <span className="material-symbols-outlined text-[15px] text-amber-500 fill-amber-500">
                        star
                      </span>
                      <span>{item.averageRating} / 5.0</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                      {item.submittedAt}
                    </span>
                  </div>
                </div>

                {/* Sub-ratings row: Food Quality, Dining Hygiene, Service Speed */}
                <div className="flex flex-wrap items-center gap-6 py-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs">Food Quality</span>
                    <span className="font-bold text-slate-800">{item.foodRating} / 5</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs">Dining Hygiene</span>
                    <span className="font-bold text-slate-800">{item.hygieneRating} / 5</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs">Service Speed</span>
                    <span className="font-bold text-slate-800">{item.speedRating} / 5</span>
                  </div>
                </div>

                {/* Student comment */}
                <p className="text-xs text-slate-600 italic leading-relaxed pt-0.5">
                  &quot;{item.comment}&quot;
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
