import React from 'react';

interface SecurityStatCardProps {
  label: string;
  value: number | string;
  trend?: string;
  comparison?: string;
  caption?: string;
  icon: React.ReactNode;
  compact?: boolean;
}

export const SecurityStatCard: React.FC<SecurityStatCardProps> = ({
  label,
  value,
  trend,
  comparison,
  caption,
  icon,
  compact = false,
}) => {
  return (
    <div
      className={`bg-white rounded-xl shadow-xs border border-blue-50/80 transition-all hover:shadow-md ${
        compact 
          ? 'p-3.5 sm:p-4 border-l-4 border-l-blue-600' 
          : 'p-4 sm:p-5 border-l-4 border-l-blue-600'
      }`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Circular Light-Blue Icon Container */}
        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
          {icon}
        </div>

        {/* Text Details */}
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-[13px] font-semibold text-slate-700 truncate">
            {label}
          </p>
          <p className="text-2xl sm:text-3xl font-extrabold text-[var(--kv-heading)] leading-tight mt-0.5">
            {value}
          </p>
          {(trend || comparison || caption) && (
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-500 mt-1 truncate">
              {trend && (
                <span className="font-semibold text-emerald-600">
                  {trend}
                </span>
              )}
              {comparison && (
                <span className="truncate">
                  {comparison}
                </span>
              )}
              {caption && (
                <span className="truncate">
                  {caption}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
