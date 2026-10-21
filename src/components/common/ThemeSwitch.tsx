import React from 'react';
import { useTheme } from '../../hooks/useTheme';

/** Sun face with eight rays, drawn to sit inside the 24px knob. */
const SunIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="var(--kv-navy)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" fill="var(--kv-navy)" stroke="none" />
    <g>
      <path d="M12 1.8v2.6M12 19.6v2.6M22.2 12h-2.6M4.4 12H1.8" />
      <path d="M19.2 4.8l-1.85 1.85M6.65 17.35L4.8 19.2M19.2 19.2l-1.85-1.85M6.65 6.65L4.8 4.8" />
    </g>
  </svg>
);

/** Crescent moon with a single sparkle, matching the sun's visual weight. */
const MoonIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="var(--kv-navy)" aria-hidden="true">
    <path d="M20.3 14.9A8.6 8.6 0 0 1 9.1 3.7a8.7 8.7 0 1 0 11.2 11.2z" />
    <path d="M17.4 2.4l.72 1.98 1.98.72-1.98.72-.72 1.98-.72-1.98-1.98-.72 1.98-.72z" />
  </svg>
);

/**
 * Light/dark switch for the top bar: a pill track whose knob slides to the side
 * of the mode in use — sun on the left for light, moon on the right for dark.
 */
export const ThemeSwitch: React.FC<{ className?: string }> = ({ className }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Dark theme' : 'Light theme'}
      onClick={toggleTheme}
      className={`relative inline-flex items-center w-[56px] h-[30px] rounded-full p-[3px] shrink-0 cursor-pointer transition-colors duration-300 border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kv-primary)] ${
        isDark ? 'bg-[var(--kv-navy)] border-[var(--kv-navy)]' : 'bg-[var(--kv-surface-sunken)] border-[var(--kv-border)]'
      } ${className ?? ''}`}
    >
      <span
        className={`flex items-center justify-center w-[24px] h-[24px] rounded-full bg-[var(--kv-beige)] shadow-[0_1px_3px_rgba(15,23,42,0.35)] transition-transform duration-300 ${
          isDark ? 'translate-x-[26px]' : 'translate-x-0'
        }`}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
};
