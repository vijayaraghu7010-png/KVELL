import React, { useEffect, useState } from 'react';
import { DayMenu, DayOfWeek, MealSlot } from '../types/mess';

export interface MessFeedbackInput {
  meal: string;
  foodRating: number;
  hygieneRating: number;
  speedRating: number;
  comment: string;
}

interface DashboardMessMenuProps {
  week: DayMenu[];
  today: DayOfWeek | null;
  onSubmitFeedback: (input: MessFeedbackInput) => Promise<boolean>;
}

const MEAL_CARDS: { key: 'breakfast' | 'lunch' | 'snacks' | 'dinner'; title: string; icon: string; color: string }[] = [
  { key: 'breakfast', title: 'Breakfast', icon: 'wb_sunny', color: 'text-blue-600 bg-blue-600' },
  { key: 'lunch', title: 'Lunch', icon: 'lunch_dining', color: 'text-[var(--kv-heading)] bg-[var(--kv-nav-bg)]' },
  { key: 'snacks', title: 'Evening Snacks', icon: 'bakery_dining', color: 'text-amber-600 bg-amber-600' },
  { key: 'dinner', title: 'Dinner', icon: 'dinner_dining', color: 'text-indigo-700 bg-indigo-700' },
];

const Rating: React.FC<{ label: string; hint: string; value: number; onChange: (n: number) => void }> = ({ label, hint, value, onChange }) => (
  <fieldset className="flex flex-col gap-1.5 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
    <legend className="sr-only">{label}</legend>
    <span className="text-xs font-bold text-[var(--kv-heading)]" aria-hidden="true">
      {label}
    </span>
    <span className="text-[11px] text-slate-500">{hint}</span>
    <div className="flex items-center gap-2 mt-2" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((num) => (
        <button
          key={num}
          type="button"
          role="radio"
          aria-checked={value === num}
          aria-label={`${num} out of 5`}
          onClick={() => onChange(num)}
          className={`w-9 h-9 rounded-lg font-bold text-xs transition cursor-pointer flex items-center justify-center ${
            value === num ? 'bg-[var(--kv-nav-bg)] text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          {num}
        </button>
      ))}
    </div>
  </fieldset>
);

export const DashboardMessMenu: React.FC<DashboardMessMenuProps> = ({ week, today, onSubmitFeedback }) => {
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(today ?? 'Monday');
  const [meal, setMeal] = useState('Lunch');
  const [foodRating, setFoodRating] = useState(0);
  const [hygieneRating, setHygieneRating] = useState(0);
  const [speedRating, setSpeedRating] = useState(0);
  const [suggestion, setSuggestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (today) setSelectedDay(today);
  }, [today]);

  const currentMenu = week.find((d) => d.day === selectedDay);

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foodRating || !hygieneRating || !speedRating) {
      setError('Please give all three ratings.');
      return;
    }
    setError(null);
    setSending(true);
    const ok = await onSubmitFeedback({ meal, foodRating, hygieneRating, speedRating, comment: suggestion.trim() });
    setSending(false);
    if (ok) {
      setSuggestion('');
      setFoodRating(0);
      setHygieneRating(0);
      setSpeedRating(0);
    }
  };

  return (
    <div className="flex flex-col w-full max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-100/80 p-6 rounded-2xl border border-slate-200">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">DINING SERVICES & SCHEDULE</span>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--kv-heading)]">Mess Menu & Weekly Schedule</h1>
          <p className="text-xs text-slate-500 mt-1">Menus published by the mess in-charge. Rate today's meals to help improve the service.</p>
        </div>
        {currentMenu && (
          <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-2xs self-start md:self-auto">
            <span className="material-symbols-outlined text-slate-500 text-[18px]" aria-hidden="true">event</span>
            <span className="text-xs font-semibold text-slate-700">
              {currentMenu.day}, {currentMenu.date}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Day of week">
        {week.map((d) => (
          <button
            key={d.day}
            type="button"
            role="tab"
            aria-selected={selectedDay === d.day}
            onClick={() => setSelectedDay(d.day)}
            className={`px-5 py-2.5 rounded-full text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              selectedDay === d.day ? 'bg-[var(--kv-nav-bg)] text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {d.day}
            {d.day === today ? ' (Today)' : ''}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
        {MEAL_CARDS.map((c) => {
          const slot: MealSlot | undefined = currentMenu?.[c.key];
          const [textColor, barColor] = c.color.split(' ');
          return (
            <section key={c.key} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-full h-1 ${barColor}`} aria-hidden="true" />
              <div className="flex items-center justify-between mb-4">
                <span className={`text-[11px] font-bold uppercase tracking-wider ${textColor}`}>{slot?.timing ?? '—'}</span>
                <span className={`material-symbols-outlined text-[20px] ${textColor}`} aria-hidden="true">{c.icon}</span>
              </div>
              <h3 className="text-base font-bold text-[var(--kv-heading)] mb-1">{c.title}</h3>
              {slot?.desc && <p className="text-xs text-slate-500 mb-4">{slot.desc}</p>}
              {slot && slot.items.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {slot.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100 gap-2">
                      <span className="text-xs font-semibold text-slate-800">{item.name}</span>
                      <span className="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded font-medium text-slate-500">{item.categoryTag}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400 italic">Menu not published yet.</p>
              )}
            </section>
          );
        })}
      </div>

      <section className="bg-white rounded-2xl p-5 sm:p-8 border border-slate-200 shadow-xs space-y-6" aria-labelledby="feedback-title">
        <div className="max-w-3xl">
          <div className="flex items-center gap-1.5 text-[var(--kv-heading)] mb-1">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">rate_review</span>
            <span className="text-[10px] font-bold uppercase tracking-wider">STUDENT VOICE</span>
          </div>
          <h2 id="feedback-title" className="text-xl font-bold text-[var(--kv-heading)]">
            Rate Today's Meal
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">One rating per meal per day. Your feedback goes to the mess in-charge.</p>
        </div>

        <form onSubmit={handleFeedbackSubmit} className="space-y-6" noValidate>
          <label className="flex flex-col gap-1.5 text-xs font-bold text-[var(--kv-heading)] max-w-xs">
            Meal
            <select value={meal} onChange={(e) => setMeal(e.target.value)} className="h-11 bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs text-slate-800 font-medium focus:outline-none focus:border-[var(--kv-primary)]">
              {['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'General Dining'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Rating label="Food Quality" hint="Taste, freshness, and temperature" value={foodRating} onChange={setFoodRating} />
            <Rating label="Dining Hygiene" hint="Cleanliness of tables & utensils" value={hygieneRating} onChange={setHygieneRating} />
            <Rating label="Service Speed" hint="Queue replenishment & counter flow" value={speedRating} onChange={setSpeedRating} />
          </div>
          {error && (
            <p className="text-xs text-rose-600 font-medium" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
            <label className="flex-1 w-full flex flex-col gap-1.5 text-xs font-bold text-[var(--kv-heading)]">
              Suggestions or Special Requests (optional)
              <input
                type="text"
                value={suggestion}
                maxLength={1000}
                onChange={(e) => setSuggestion(e.target.value)}
                placeholder="e.g., Please include more fresh salads or fruit options during lunch..."
                className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-xs font-normal text-slate-800 focus:outline-none focus:border-[var(--kv-primary)] focus:bg-white transition"
              />
            </label>
            <button
              type="submit"
              disabled={sending}
              className="px-6 h-11 bg-[var(--kv-nav-bg)] hover:bg-[var(--kv-primary-hover)] disabled:opacity-60 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer w-full md:w-auto"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">send</span>
              <span>{sending ? 'Sending…' : 'Submit Feedback'}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
