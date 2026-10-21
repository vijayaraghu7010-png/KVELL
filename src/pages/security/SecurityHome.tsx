import React from 'react';
import { SecurityMetrics, SecurityScanRecord, SecurityTab } from '../../types/security';
import { SecurityStatCard } from '../../components/security/SecurityStatCard';
import { 
  LogIn, 
  LogOut, 
  Users, 
  AlertTriangle, 
  Clock, 
  ArrowRight, 
  Shield, 
  Lock 
} from 'lucide-react';

interface SecurityHomeProps {
  metrics: SecurityMetrics;
  recentScans: SecurityScanRecord[];
  onNavigateTab: (tab: SecurityTab) => void;
}

export const SecurityHome: React.FC<SecurityHomeProps> = ({
  metrics,
  recentScans,
  onNavigateTab,
}) => {
  // Take top 5 rows for recent activity
  const displayRows = recentScans.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* 1. Welcome Banner matching Screenshot 1 */}
      <section 
        aria-label="Welcome Banner"
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[var(--kv-surface-alt)] via-[var(--kv-surface-alt)] to-[var(--kv-surface-alt)] border border-blue-100 p-6 sm:p-8 flex items-center justify-between shadow-xs"
      >
        <div className="max-w-xl space-y-1.5 z-10">
          <p className="text-sm font-semibold text-blue-600 tracking-wide">
            {(() => {
              const h = new Date().getHours();
              return h < 12 ? 'Good Morning,' : h < 17 ? 'Good Afternoon,' : 'Good Evening,';
            })()}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--kv-heading)] tracking-tight">
            Security Personnel
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed pt-1">
            Keep the campus safe. Monitor entries, maintain records and ensure campus security.
          </p>
        </div>

        {/* Glossy Shield / Padlock Graphic on the right side */}
        <div className="hidden sm:flex items-center justify-center relative shrink-0">
          {/* Subtle glowing concentric circles */}
          <div className="w-24 h-24 rounded-full bg-blue-200/50 absolute animate-pulse pointer-events-none" />
          <div className="w-20 h-20 rounded-full bg-white/70 absolute shadow-sm" />
          
          {/* Shield Badge */}
          <div className="relative w-16 h-18 bg-gradient-to-b from-[var(--kv-primary)] to-[var(--kv-primary)] rounded-2xl flex items-center justify-center text-white shadow-lg border-2 border-white/80 transform hover:scale-105 transition-transform">
            <Lock className="w-8 h-8 text-white drop-shadow-sm" />
          </div>
        </div>
      </section>

      {/* 2. Four Summary Stat Cards matching Screenshot 1 */}
      <section 
        aria-label="Campus Metrics Summary"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5"
      >
        <SecurityStatCard 
          label="Today's Entries"
          value={metrics.todayEntries}
          trend={metrics.entriesTrend}
          comparison={metrics.entriesComparison}
          icon={<LogIn className="w-6 h-6 text-[var(--kv-primary)]" />}
        />
        <SecurityStatCard 
          label="Today's Exits"
          value={metrics.todayExits}
          trend={metrics.exitsTrend}
          comparison={metrics.exitsComparison}
          icon={<LogOut className="w-6 h-6 text-[var(--kv-primary)]" />}
        />
        <SecurityStatCard 
          label="Currently Inside"
          value={metrics.currentlyInside}
          caption={metrics.insideCaption}
          icon={<Users className="w-6 h-6 text-[var(--kv-primary)]" />}
        />
        <SecurityStatCard 
          label="Needs Attention"
          value={metrics.needsAttention}
          caption={metrics.attentionCaption}
          icon={<AlertTriangle className="w-6 h-6 text-[var(--kv-primary)]" />}
        />
      </section>

      {/* 3. Recent Entry / Exit Activity Table matching Screenshot 1 */}
      <section 
        aria-label="Recent Entry and Exit Activity"
        className="bg-white rounded-2xl shadow-xs border border-blue-50 overflow-hidden"
      >
        {/* Card Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[var(--kv-primary)] text-white flex items-center justify-center shadow-xs">
              <Clock className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-[var(--kv-heading)]">
              Recent Entry / Exit Activity
            </h2>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('log-book')}
            className="flex items-center gap-1 text-xs font-semibold text-[var(--kv-primary)] hover:text-[var(--kv-primary)] hover:underline cursor-pointer transition"
          >
            <span>View All</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Activity Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="bg-[var(--kv-surface-alt)] text-slate-700 text-xs font-bold uppercase tracking-wider border-b border-blue-100">
                <th className="py-3 px-6 w-16">S.No</th>
                <th className="py-3 px-6">Name</th>
                <th className="py-3 px-6">Type</th>
                <th className="py-3 px-6">Time</th>
                <th className="py-3 px-6">Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-[13px] text-slate-800">
              {displayRows.map((row, idx) => (
                <tr 
                  key={row.id}
                  className="hover:bg-blue-50/30 transition-colors"
                >
                  <td className="py-4 px-6 font-medium text-slate-500">
                    {idx + 1}
                  </td>
                  <td className="py-4 px-6 font-semibold text-[var(--kv-heading)]">
                    {row.name}
                  </td>
                  <td className="py-4 px-6">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                        row.type === 'Entry'
                          ? 'bg-[var(--kv-surface-alt)] text-[var(--kv-primary)]'
                          : 'bg-[var(--kv-primary)] text-white'
                      }`}
                    >
                      {row.type}
                    </span>
                  </td>
                  <td className="py-4 px-6 font-medium text-slate-600">
                    {row.time}
                  </td>
                  <td className="py-4 px-6 font-medium text-slate-700">
                    {row.gate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
