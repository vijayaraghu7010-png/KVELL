import React from 'react';

interface ToastProps {
  message: string | null;
  isError?: boolean;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, isError, onClose }) => {
  return (
    // The live region stays mounted so screen readers announce new messages.
    <div className="fixed bottom-6 right-4 sm:right-6 z-[80] max-w-[calc(100vw-2rem)]" role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>
      {message && (
        <div className={`text-white text-xs font-semibold px-5 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 border ${
          isError ? 'bg-rose-700 border-rose-800' : 'bg-[var(--kv-nav-bg)] border-[var(--kv-primary)]'
        }`}>
          <span className={`material-symbols-outlined text-[18px] ${isError ? 'text-rose-200' : 'text-emerald-300'}`} aria-hidden="true">
            {isError ? 'error' : 'check_circle'}
          </span>
          <span className="leading-snug max-w-sm">{message}</span>
          <button
            onClick={onClose}
            className="ml-2 text-white/70 hover:text-white font-bold p-0.5"
            type="button"
            aria-label="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
