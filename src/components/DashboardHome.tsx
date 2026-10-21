import React, { useMemo, useState } from 'react';
import { DashboardTab, LeaveRequest } from '../types';
import { DayMenu, MenuItem } from '../types/mess';
import { useNotifications, timeAgo } from './common/Notifications';

export interface StudentDashboardData {
  pendingLeaves: number;
  pendingOutings: number;
  openComplaints: number;
  activeOutpasses: number;
  todayAttendance: string | null;
}

export interface HolidayRow {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  category: string;
  description: string | null;
}

export interface StudySessionRow {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  dateDisplay: string;
  time: string;
  /** Staff member running the session, shown in place of the venue. */
  staffName: string;
  status: string;
  myStatus: string;
}

interface DashboardHomeProps {
  todayMenu: DayMenu | null;
  stats: StudentDashboardData | null;
  studySessions: StudySessionRow[];
  leaveRequests: LeaveRequest[];
  holidays: HolidayRow[];
  onNavigateTab: (tab: DashboardTab) => void;
}

const MEALS: { key: 'breakfast' | 'lunch' | 'snacks' | 'dinner'; label: string; icon: string; tint: string }[] = [
  { key: 'breakfast', label: 'Morning (Breakfast)', icon: 'wb_sunny', tint: 'bg-[var(--kv-border-soft)] text-[var(--kv-heading)]' },
  { key: 'lunch', label: 'Afternoon (Lunch)', icon: 'lunch_dining', tint: 'bg-[var(--kv-surface-alt)] text-[var(--kv-heading)]' },
  { key: 'snacks', label: 'Evening Snacks', icon: 'coffee', tint: 'bg-[var(--kv-border-soft)] text-[var(--kv-heading)]' },
  { key: 'dinner', label: 'Night (Dinner)', icon: 'dinner_dining', tint: 'bg-[var(--kv-surface-alt)] text-[var(--kv-heading)]' },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Sundays are a weekly hostel holiday in every month; the holidays table adds festival and exam dates. */
const SUNDAY: HolidayRow = { id: 'sunday', date: '', name: 'Sunday', category: 'Weekend', description: null };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const DashboardHome: React.FC<DashboardHomeProps> = ({ todayMenu, stats, studySessions, leaveRequests, holidays, onNavigateTab }) => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const { items: notifications, open } = useNotifications();

  const marks = useMemo(() => {
    const m = new Map<string, string[]>();
    const add = (k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
    studySessions.filter((s) => s.status !== 'Cancelled').forEach((s) => add(s.date, `Study session: ${s.title}, ${s.time} with ${s.staffName}${s.myStatus && s.myStatus !== 'Upcoming' ? ` (${s.myStatus})` : ''}`));
    leaveRequests
      .filter((l) => l.status === 'Approved')
      .forEach((l) => {
        for (let d = new Date(`${l.fromDate}T12:00:00`); ymd(d) <= l.toDate; d.setDate(d.getDate() + 1)) add(ymd(d), `Approved leave ${l.id} (${l.type})`);
      });
    return m;
  }, [studySessions, leaveRequests]);

  const holidaysByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h])), [holidays]);
  const holidayFor = (key: string): HolidayRow | null => holidaysByDate.get(key) ?? (new Date(`${key}T12:00:00`).getDay() === 0 ? SUNDAY : null);
  const selectedHoliday = selectedDay ? holidayFor(selectedDay) : null;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();
  const todayKey = ymd(now);
  const upcoming = studySessions.filter((s) => s.date >= todayKey && s.status === 'Scheduled').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  const tiles: { label: string; value: React.ReactNode; tab: DashboardTab; icon: string }[] = [
    { label: 'Pending leave', value: stats?.pendingLeaves ?? '—', tab: 'leave-request-status', icon: 'task' },
    { label: 'Pending outings', value: stats?.pendingOutings ?? '—', tab: 'outing-permission', icon: 'directions_walk' },
    { label: 'Active outpasses', value: stats?.activeOutpasses ?? '—', tab: 'my-outpass', icon: 'qr_code_2' },
    { label: 'Open complaints', value: stats?.openComplaints ?? '—', tab: 'complaint-status', icon: 'build' },
  ];

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
    setSelectedDay(null);
  };

  return (
    <div className="flex flex-col w-full gap-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => onNavigateTab(t.tab)}
            className="text-left bg-white rounded-2xl p-4 border border-slate-200/80 hover:border-[var(--kv-primary)] transition cursor-pointer"
          >
            <span className="material-symbols-outlined text-[var(--kv-primary)] text-[20px]" aria-hidden="true">{t.icon}</span>
            <div className="text-xl font-extrabold text-slate-900 mt-1">{t.value}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_0_rgba(15,23,42,0.04)]" aria-labelledby="today-menu-title">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--kv-heading)] text-[20px]" aria-hidden="true">restaurant</span>
              <h3 id="today-menu-title" className="font-bold text-sm tracking-wide text-slate-900 uppercase">
                TODAY'S MENU {todayMenu ? `· ${todayMenu.day}` : ''}
              </h3>
            </div>
            <button onClick={() => onNavigateTab('mess-menu')} type="button" className="text-xs font-semibold text-[var(--kv-primary)] hover:underline cursor-pointer">
              Full Weekly Schedule →
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {MEALS.map((m) => {
              const slot = todayMenu?.[m.key];
              return (
                <div key={m.key} className="flex items-center gap-4 p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 shadow-xs ${m.tint}`}>
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">{m.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{m.label}</h4>
                    <p className="text-sm font-medium text-slate-700 truncate">{slot?.items.map((i: MenuItem) => i.name).join(', ') || 'No menu published yet'}</p>
                    {slot?.timing && <span className="text-[11px] text-slate-400">{slot.timing}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_0_rgba(15,23,42,0.04)]" aria-labelledby="calendar-title">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--kv-heading)] text-[20px]" aria-hidden="true">calendar_month</span>
              <h3 id="calendar-title" className="font-bold text-sm tracking-wide text-slate-900 uppercase">
                MY HOSTEL CALENDAR
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="p-1 rounded hover:bg-slate-100">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_left</span>
              </button>
              <span className="text-sm font-bold text-slate-800 min-w-[120px] text-center">
                {MONTHS[month]} {year}
              </span>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="p-1 rounded hover:bg-slate-100">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_right</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] font-bold text-slate-400 mb-1" aria-hidden="true">
            <span>Su</span>
            <span>Mo</span>
            <span>Tu</span>
            <span>We</span>
            <span>Th</span>
            <span>Fr</span>
            <span>Sa</span>
          </div>
          <div className="grid grid-cols-7 text-center gap-y-1.5 text-xs text-slate-700">
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <span key={`e-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const key = ymd(new Date(year, month, i + 1));
              const events = marks.get(key);
              const holiday = holidayFor(key);
              // Only two markers: today in beige, which always wins, and every holiday
              // or Sunday in navy. Study sessions and leave are listed below the grid
              // when a day is selected, not coloured into it.
              const cls =
                key === todayKey
                  ? 'bg-[var(--kv-beige)] text-[var(--kv-navy)] font-bold ring-2 ring-[var(--kv-navy)]'
                  : holiday
                    ? 'bg-[var(--kv-navy)] text-white font-bold'
                    : 'hover:bg-slate-100 text-slate-700';
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`${i + 1} ${MONTHS[month]}${holiday ? `: holiday — ${holiday.name}` : ''}${events ? `: ${events.length} event(s)` : ''}`}
                  onClick={() => setSelectedDay(key)}
                  className={`flex items-center justify-center w-7 h-7 mx-auto rounded-full transition cursor-pointer ${cls}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-4 mt-3 border-t border-slate-100 text-[11px] text-slate-500 font-medium">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--kv-navy)]" aria-hidden="true" /> Holiday / Sunday
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--kv-beige)] ring-1 ring-[var(--kv-navy)]" aria-hidden="true" /> Today
            </span>
          </div>
          {selectedDay && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start justify-between gap-2" role="status">
              <div>
                <span className="text-xs font-bold text-[var(--kv-heading)] block">{new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                {selectedHoliday && (
                  <p className="text-xs font-semibold text-blue-700 mt-0.5">
                    Holiday: {selectedHoliday.name}
                    {selectedHoliday.description ? ` — ${selectedHoliday.description}` : ''}
                  </p>
                )}
                {(marks.get(selectedDay) ?? (selectedHoliday ? [] : ['No study sessions or approved leave on this day.'])).map((e) => (
                  <p key={e} className="text-xs text-slate-700 mt-0.5">
                    {e}
                  </p>
                ))}
              </div>
              <button onClick={() => setSelectedDay(null)} aria-label="Close day details" className="text-slate-400 hover:text-slate-700 text-xs font-bold" type="button">
                ✕
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_0_rgba(15,23,42,0.04)]" aria-labelledby="study-title">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--kv-heading)] text-[20px]" aria-hidden="true">schedule</span>
              <h3 id="study-title" className="font-bold text-sm tracking-wide text-slate-900 uppercase">
                UPCOMING STUDY SESSIONS
              </h3>
            </div>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No study sessions are scheduled for you right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-3 uppercase font-semibold">Date</th>
                    <th className="py-2.5 px-3 uppercase font-semibold">Session</th>
                    <th className="py-2.5 px-3 uppercase font-semibold">Time</th>
                    <th className="py-2.5 px-3 uppercase font-semibold">Study Staff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {upcoming.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-semibold text-slate-800">{s.dateDisplay}</td>
                      <td className="py-2.5 px-3 text-slate-600">{s.title}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{s.time}</td>
                      <td className="py-2.5 px-3 text-slate-600">{s.staffName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_1px_3px_0_rgba(15,23,42,0.04)]" aria-labelledby="updates-title">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--kv-heading)] text-[20px]" aria-hidden="true">campaign</span>
              <h3 id="updates-title" className="font-bold text-sm tracking-wide text-slate-900 uppercase">
                RECENT UPDATES
              </h3>
            </div>
            <button type="button" onClick={() => onNavigateTab('notifications')} className="text-xs font-semibold text-[var(--kv-primary)] hover:underline">
              All notifications →
            </button>
          </div>
          {notifications.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No updates yet. Approvals, gate scans and complaint updates will appear here.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {notifications.slice(0, 4).map((n) => (
                <button key={n.id} type="button" onClick={() => open(n)} className="text-left flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 transition cursor-pointer">
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-[var(--kv-primary)] flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                      {n.severity === 'success' ? 'check_circle' : n.severity === 'alert' ? 'campaign' : 'info'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center gap-2">
                      <h4 className={`text-xs text-slate-800 truncate ${n.read ? 'font-semibold' : 'font-bold'}`}>{n.title}</h4>
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{n.message}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
