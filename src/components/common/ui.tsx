/**
 * Shared UI kit for the KVCET portals. Visual language follows the existing portals:
 * navy headings, white cards with soft blue borders, rounded-xl corners, Material Symbols icons.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const Icon: React.FC<{ name: string; className?: string; label?: string }> = ({ name, className = 'text-[20px]', label }) => (
  <span className={cx('material-symbols-outlined shrink-0 leading-none', className)} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}>
    {name}
  </span>
);

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white border-transparent',
  secondary: 'bg-white hover:bg-[var(--kv-accent-soft)] text-[var(--kv-heading)] border-[var(--kv-border)]',
  danger: 'bg-white hover:bg-rose-50 text-rose-700 border-rose-200',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent',
  ghost: 'bg-transparent hover:bg-slate-100 text-slate-600 border-transparent',
};

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: string; loading?: boolean; size?: 'sm' | 'md' }
> = ({ variant = 'primary', icon, loading, size = 'md', className, children, disabled, type = 'button', ...rest }) => (
  <button
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kv-primary)]',
      size === 'sm' ? 'px-2.5 py-1.5 text-xs min-h-8' : 'px-4 py-2 text-sm min-h-10',
      BUTTON_STYLES[variant],
      className,
    )}
    {...rest}
  >
    {loading ? <Icon name="progress_activity" className="text-[18px] animate-spin" /> : icon ? <Icon name={icon} className="text-[18px]" /> : null}
    {children}
  </button>
);

export const IconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }> = ({ icon, label, className, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={cx('p-2 rounded-lg text-slate-500 hover:text-[var(--kv-primary)] hover:bg-slate-100 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--kv-primary)]', className)}
    {...rest}
  >
    <Icon name={icon} className="text-[22px]" />
  </button>
);

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export const Card: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; className?: string; children: React.ReactNode; bodyClassName?: string }> = ({
  title,
  actions,
  className,
  children,
  bodyClassName,
}) => (
  <section className={cx('bg-white border border-[var(--kv-border)] rounded-xl shadow-[0_1px_3px_rgba(11,59,145,0.04)]', className)}>
    {(title || actions) && (
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-[var(--kv-border-soft)]">
        {typeof title === 'string' ? <h2 className="text-[15px] font-bold text-[var(--kv-heading)]">{title}</h2> : title}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className={cx('p-4 sm:p-5', bodyClassName)}>{children}</div>
  </section>
);

export const PageHeader: React.FC<{ title: string; subtitle?: string; icon?: string; actions?: React.ReactNode }> = ({ title, subtitle, icon, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
    <div className="flex items-center gap-3 min-w-0">
      {icon && (
        <div className="w-12 h-12 rounded-xl bg-[var(--kv-surface-alt)] text-[var(--kv-heading)] flex items-center justify-center shrink-0">
          <Icon name={icon} className="text-[26px]" />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-[var(--kv-heading)] leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--kv-text-muted)] mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

const TONES = {
  blue: 'bg-[var(--kv-surface-alt)] text-[var(--kv-primary)]',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-rose-50 text-rose-700',
  slate: 'bg-[var(--kv-surface-sunken)] text-[var(--kv-text-muted)]',
  violet: 'bg-[var(--kv-accent-soft)] text-[var(--kv-on-accent)]',
};
export type Tone = keyof typeof TONES;

export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  icon?: string;
  tone?: Tone;
  hint?: string;
  definition?: string;
  onClick?: () => void;
}> = ({ label, value, icon, tone = 'blue', hint, definition, onClick }) => {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={definition}
      className={cx(
        'text-left bg-white border border-[var(--kv-border)] rounded-xl p-4 flex items-start gap-3 w-full',
        onClick && 'hover:border-[var(--kv-primary)] hover:shadow-sm transition cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--kv-primary)]',
      )}
    >
      {icon && (
        <div className={cx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', TONES[tone])}>
          <Icon name={icon} className="text-[22px]" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-[var(--kv-text-muted)] uppercase tracking-wide">{label}</div>
        <div className="text-2xl font-bold text-[var(--kv-heading)] leading-tight mt-0.5">{value ?? '—'}</div>
        {(hint || definition) && <div className="text-[11px] text-[var(--kv-text-muted)] mt-1 leading-snug">{hint || definition}</div>}
      </div>
    </Comp>
  );
};

// ---------------------------------------------------------------------------
// Status badges — text always carries the meaning; colour is secondary.
// ---------------------------------------------------------------------------
const STATUS_TONE: [RegExp, Tone][] = [
  [/^(approved|completed|accepted|resolved|present|active|acknowledged|authorized absence|valid|published|done)$/i, 'green'],
  [/(overdue|rejected|cancelled|declined|verified unauthorized|absent|critical|urgent|flagged|expired|duplicate|alert)/i, 'red'],
  [/(pending|suspected|revision|escalated|warning|high|late|out|draft|not recorded|not marked|forwarded)/i, 'amber'],
  [/(progress|review|submitted|distributed|assigned|scheduled|rescheduled|on leave|on outing|in review|open)/i, 'blue'],
];
export const toneFor = (status: string): Tone => STATUS_TONE.find(([re]) => re.test(status))?.[1] ?? 'slate';

export const Badge: React.FC<{ children: React.ReactNode; tone?: Tone; className?: string; icon?: string }> = ({ children, tone = 'slate', className, icon }) => (
  <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap', TONES[tone], className)}>
    {icon && <Icon name={icon} className="text-[13px]" />}
    {children}
  </span>
);

export const StatusBadge: React.FC<{ status: string | null | undefined; overdue?: boolean }> = ({ status, overdue }) => (
  <span className="inline-flex flex-wrap gap-1">
    <Badge tone={toneFor(status || '')}>{status || '—'}</Badge>
    {overdue && (
      <Badge tone="red" icon="schedule">
        Overdue
      </Badge>
    )}
  </span>
);

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------
export const EmptyState: React.FC<{ icon?: string; title: string; message?: string; action?: React.ReactNode }> = ({ icon = 'inbox', title, message, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-10 px-4" role="status">
    <div className="w-12 h-12 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-text-muted)] flex items-center justify-center mb-3">
      <Icon name={icon} className="text-[26px]" />
    </div>
    <p className="font-semibold text-[var(--kv-heading)]">{title}</p>
    {message && <p className="text-sm text-[var(--kv-text-muted)] mt-1 max-w-md">{message}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex flex-col sm:flex-row sm:items-center gap-3 border border-rose-200 bg-rose-50 text-rose-800 rounded-xl p-4">
    <Icon name="error" className="text-[22px]" />
    <div className="flex-1 text-sm">
      <p className="font-semibold">Could not load this information</p>
      <p className="mt-0.5">{message}</p>
    </div>
    {onRetry && (
      <Button variant="danger" size="sm" icon="refresh" onClick={onRetry}>
        Retry
      </Button>
    )}
  </div>
);

export const Loading: React.FC<{ rows?: number; label?: string }> = ({ rows = 4, label = 'Loading…' }) => (
  <div role="status" aria-live="polite" className="space-y-2.5 py-2">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-10 rounded-lg bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 animate-pulse" />
    ))}
  </div>
);

/** Renders loading / error / empty handling around a resource. */
export function AsyncContent<T>({
  loading,
  error,
  data,
  onRetry,
  empty,
  isEmpty,
  children,
}: {
  loading: boolean;
  error: string | null;
  data: T | null;
  onRetry?: () => void;
  empty?: React.ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => React.ReactNode;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading && data === null) return <Loading />;
  if (data === null) return null;
  if (empty && isEmpty?.(data)) return <>{empty}</>;
  return <>{children(data)}</>;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
export const Modal: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  description?: string;
}> = ({ open, title, onClose, children, footer, size = 'md', description }) => {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'));
    (focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab') {
        const els = focusables();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]', width)}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--kv-border-soft)]">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-[var(--kv-heading)]">
              {title}
            </h2>
            {description && <p className="text-sm text-[var(--kv-text-muted)] mt-0.5">{description}</p>}
          </div>
          <IconButton icon="close" label="Close dialog" onClick={onClose} />
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-[var(--kv-border-soft)] flex flex-wrap justify-end gap-2 bg-slate-50/60 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
};

/** Confirmation dialog with an optional required reason. Resolves with the reason (or '' when not asked). */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonRequired?: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}> = ({ open, title, message, confirmLabel = 'Confirm', danger, reasonLabel, reasonRequired, pending, onConfirm, onClose }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
            onClick={() => {
              if (reasonRequired && reason.trim().length < 3) return setError(`${reasonLabel || 'Reason'} is required.`);
              onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-700 space-y-3">
        <div>{message}</div>
        {reasonLabel && <TextArea label={reasonLabel} required={reasonRequired} value={reason} onChange={(e) => setReason(e.target.value)} error={error} rows={3} />}
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Form fields (labelled, with accessible error messages)
// ---------------------------------------------------------------------------
const inputCls = (error?: string | null) =>
  cx(
    'w-full border rounded-lg px-3 py-2 text-sm bg-white text-[var(--kv-heading)] outline-none transition focus:border-[var(--kv-primary)] focus:ring-2 focus:ring-[var(--kv-primary)]/15 disabled:bg-slate-50',
    error ? 'border-rose-400' : 'border-[var(--kv-border)]',
  );

interface FieldProps {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
}

function FieldWrap({ id, label, error, hint, required, children }: FieldProps & { id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-[var(--kv-heading)]">
        {label}
        {required && (
          <span className="text-rose-600" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[11px] text-[var(--kv-text-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[11px] font-medium text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

export const TextField: React.FC<FieldProps & React.InputHTMLAttributes<HTMLInputElement>> = ({ label, error, hint, required, id, className, ...rest }) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap id={fid} label={label} error={error} hint={hint} required={required}>
      <input
        id={fid}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={cx(inputCls(error), className)}
        {...rest}
      />
    </FieldWrap>
  );
};

export const TextArea: React.FC<FieldProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ label, error, hint, required, id, rows = 4, ...rest }) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap id={fid} label={label} error={error} hint={hint} required={required}>
      <textarea
        id={fid}
        rows={rows}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={inputCls(error)}
        {...rest}
      />
    </FieldWrap>
  );
};

export const SelectField: React.FC<FieldProps & React.SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[]; placeholder?: string }> = ({
  label,
  error,
  hint,
  required,
  id,
  options,
  placeholder,
  ...rest
}) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap id={fid} label={label} error={error} hint={hint} required={required}>
      <select id={fid} required={required} aria-invalid={!!error || undefined} className={cx(inputCls(error), 'cursor-pointer')} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (typeof o === 'string' ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </FieldWrap>
  );
};

/**
 * Searchable student picker. Behaves like a select, but the list is filtered as you type —
 * usable with hundreds of residents, where a plain dropdown is not.
 */
export const StudentPicker: React.FC<
  FieldProps & {
    id?: string;
    value: string;
    onChange: (id: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
    emptyMessage?: string;
    clearLabel?: string;
  }
> = ({ label, error, hint, required, id, value, onChange, options, placeholder = 'Search by name, register number or room…', emptyMessage = 'No students available', clearLabel }) => {
  const auto = useId();
  const fid = id ?? auto;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const pick = (v: string) => {
    onChange(v);
    setQ('');
    setOpen(false);
  };

  return (
    <FieldWrap id={fid} label={label} error={error} hint={hint} required={required}>
      <div className="relative" ref={ref}>
        <Icon name="search" className="text-[20px] text-[var(--kv-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={fid}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          value={open ? q : selected?.label ?? ''}
          placeholder={options.length ? placeholder : emptyMessage}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          aria-invalid={!!error || undefined}
          className={cx(inputCls(error), 'pl-10', (selected || open) && 'pr-9')}
        />
        {(selected || (open && q)) && (
          <button
            type="button"
            aria-label={clearLabel ?? `Clear ${label.toLowerCase()}`}
            onClick={() => {
              onChange('');
              setQ('');
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--kv-text-muted)] hover:bg-[var(--kv-accent-soft)] cursor-pointer"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        )}
        {open && (
          <ul role="listbox" className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-[var(--kv-border)] rounded-lg shadow-xl divide-y divide-[var(--kv-border-soft)]">
            {shown.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-[var(--kv-text-muted)]">{options.length ? `No student matches “${q.trim()}”.` : emptyMessage}</li>
            ) : (
              shown.slice(0, 50).map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onClick={() => pick(o.value)}
                    className={cx('w-full text-left px-3 py-2 text-sm hover:bg-[var(--kv-accent-soft)] cursor-pointer', o.value === value && 'bg-[var(--kv-accent-soft)] font-semibold')}
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </FieldWrap>
  );
};

export const Checkbox: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }> = ({ label, checked, onChange, hint }) => (
  <label className="flex items-start gap-2.5 text-sm text-[var(--kv-heading)] cursor-pointer">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--kv-primary)] cursor-pointer" />
    <span>
      {label}
      {hint && <span className="block text-[11px] text-[var(--kv-text-muted)]">{hint}</span>}
    </span>
  </label>
);

/** Inline filter select used above tables. */
export const FilterSelect: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; allLabel?: string }> = ({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
}) => (
  <label className="flex flex-col text-[11px] font-semibold text-[var(--kv-text-muted)] gap-1 min-w-[130px]">
    {label}
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm text-[var(--kv-heading)] bg-white cursor-pointer focus:border-[var(--kv-primary)] outline-none">
      <option value="">{allLabel}</option>
      {options.map((o) => (typeof o === 'string' ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  </label>
);

export const SearchInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string; label?: string }> = ({ value, onChange, placeholder = 'Search…', label = 'Search' }) => (
  <div className="relative flex-1 min-w-[180px]">
    <Icon name="search" className="text-[20px] text-[var(--kv-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
    <input
      type="search"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-[var(--kv-border)] rounded-lg pl-10 pr-3 py-2 text-sm bg-white outline-none focus:border-[var(--kv-primary)] focus:ring-2 focus:ring-[var(--kv-primary)]/15"
    />
  </div>
);

// ---------------------------------------------------------------------------
// Data table with search, sort and pagination
// ---------------------------------------------------------------------------
export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
}

/** True on phone-width screens, where tables are stacked into cards instead of scrolling sideways. */
export function useStackedTables(maxWidth = 768) {
  const query = `(max-width: ${maxWidth - 1}px)`;
  const [stacked, setStacked] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setStacked(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return stacked;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  search,
  pageSize = 10,
  emptyTitle = 'No records',
  emptyMessage,
  onRowClick,
  toolbar,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  search?: (row: T) => string;
  pageSize?: number;
  emptyTitle?: string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  toolbar?: React.ReactNode;
  caption?: string;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const stacked = useStackedTables();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle && search ? rows.filter((r) => search(r).toLowerCase().includes(needle)) : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (r: T) => (col?.sortValue ? col.sortValue(r) : (r as any)[sort.key]);
      out = [...out].sort((a, b) => {
        const av = val(a);
        const bv = val(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * sort.dir;
      });
    }
    return out;
  }, [rows, q, sort, columns, search]);


  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);
  useEffect(() => setPage(1), [q, rows.length]);

  return (
    <div className="space-y-3">
      {(search || toolbar) && (
        <div className="flex flex-wrap items-end gap-2.5">
          {search && <SearchInput value={q} onChange={setQ} />}
          {toolbar}
        </div>
      )}
      {stacked ? (
        <StackedRows
          rows={visible}
          columns={columns}
          rowKey={rowKey}
          onRowClick={onRowClick}
          sort={sort}
          onSort={setSort}
          emptyTitle={q ? 'No matches' : emptyTitle}
          emptyMessage={q ? `Nothing matches “${q}”.` : emptyMessage}
        />
      ) : (
        <div className="border border-[var(--kv-border)] rounded-lg overflow-hidden">
          {/* Fixed layout: the columns share the card's width between them, so a wide
              value is cut with an ellipsis instead of pushing the last column out of
              sight. A column that needs less room asks for it with a width class. */}
          <table className="w-full table-fixed text-sm border-collapse">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="bg-[var(--kv-surface-alt)] text-left">
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}
                      className={cx('px-3 py-2.5 font-semibold text-[var(--kv-heading)] text-xs', c.className)}
                    >
                      <button
                        type="button"
                        className="inline-flex max-w-full items-center gap-1 text-left truncate cursor-pointer hover:text-[var(--kv-primary)]"
                        onClick={() => setSort((x) => (x?.key === c.key ? (x.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
                      >
                        {c.label}
                        {/* Only the column actually in use carries an arrow; an unsorted
                            column shows nothing, so a header row reads as plain labels. */}
                        {active && <Icon name={sort!.dir === 1 ? 'arrow_upward' : 'arrow_downward'} className="text-[14px] mt-px" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kv-border-soft)]">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState title={q ? 'No matches' : emptyTitle} message={q ? `Nothing matches “${q}”.` : emptyMessage} />
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr
                    key={rowKey(r)}
                    className={cx('align-middle', onRowClick && 'hover:bg-[var(--kv-accent-soft)] cursor-pointer')}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    onKeyDown={onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(r) : undefined) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {columns.map((c) => {
                      const rendered = c.render ? c.render(r) : String((r as any)[c.key] ?? '—');
                      // Hovering a cut-off cell shows the whole value, whenever it is text.
                      const plain = typeof rendered === 'string' || typeof rendered === 'number' ? String(rendered) : null;
                      // A column that sets its own width or wrapping keeps it.
                      const own = c.className ?? '';
                      // Anything else is held to one line and cut with an ellipsis.
                      const fit = !own.includes('whitespace') && !own.includes('line-clamp') && 'truncate';
                      return (
                        // One line per cell: a long name or email is cut with an ellipsis
                        // rather than wrapped into a ragged block, and the full value is
                        // kept on the title so nothing is lost.
                        <td key={c.key} title={plain ?? undefined} className={cx('px-3 py-2.5 text-[var(--kv-heading)]', fit, c.className)}>
                          {rendered}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {/* One pager for every table: Previous · Page n / N · Next, and nothing else. */}
      {filtered.length > pageSize && (
        <nav className="flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--kv-primary)]" aria-label="Pagination">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <span className="px-2 font-semibold">
              Page {current} / {pages}
            </span>
            <Button size="sm" variant="secondary" disabled={current >= pages} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

/** Phone layout for DataTable: one card per row, every column read as a label and value. */
function StackedRows<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  sort,
  onSort,
  emptyTitle,
  emptyMessage,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort: { key: string; dir: 1 | -1 } | null;
  onSort: (next: { key: string; dir: 1 | -1 } | null) => void;
  emptyTitle: string;
  emptyMessage?: string;
}) {
  const cell = (c: Column<T>, r: T) => (c.render ? c.render(r) : String((r as any)[c.key] ?? '—'));
  const [title, ...rest] = columns;
  if (rows.length === 0)
    return (
      <div className="border border-[var(--kv-border)] rounded-lg">
        <EmptyState title={emptyTitle} message={emptyMessage} />
      </div>
    );
  return (
    <div className="space-y-2.5">
      <label className="flex items-center gap-2 text-[11px] font-semibold text-[var(--kv-text-muted)]">
        Sort by
        <select
          value={sort ? `${sort.key}:${sort.dir}` : ''}
          onChange={(e) => {
            const [key, dir] = e.target.value.split(':');
            onSort(key ? { key, dir: Number(dir) as 1 | -1 } : null);
          }}
          className="flex-1 border border-[var(--kv-border)] rounded-lg px-2.5 py-2 text-sm text-[var(--kv-heading)] bg-white cursor-pointer outline-none focus:border-[var(--kv-primary)]"
        >
          <option value="">Default order</option>
          {columns.map((c) => (
            <React.Fragment key={c.key}>
              <option value={`${c.key}:1`}>{c.label} ↑</option>
              <option value={`${c.key}:-1`}>{c.label} ↓</option>
            </React.Fragment>
          ))}
        </select>
      </label>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            className={cx('bg-white border border-[var(--kv-border)] rounded-xl p-3.5', onRowClick && 'cursor-pointer hover:bg-[var(--kv-accent-soft)] transition')}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            onKeyDown={onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(r) : undefined) : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            role={onRowClick ? 'button' : undefined}
          >
            <div className="text-[15px] font-bold text-[var(--kv-heading)] mb-2 break-words">{cell(title, r)}</div>
            <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {rest.map((c) => (
                <React.Fragment key={c.key}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)] pt-1">{c.label}</dt>
                  <dd className="text-[var(--kv-heading)] min-w-0 break-words">{cell(c, r)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Misc display
// ---------------------------------------------------------------------------
export const Tabs: React.FC<{ tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }> = ({ tabs, active, onChange }) => (
  <div role="tablist" className="flex flex-wrap gap-1 bg-[var(--kv-surface-alt)] p-1 rounded-xl w-fit max-w-full overflow-x-auto">
    {tabs.map((t) => (
      <button
        key={t.id}
        role="tab"
        type="button"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        className={cx(
          'px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition cursor-pointer',
          active === t.id ? 'bg-white text-[var(--kv-heading)] shadow-sm' : 'text-[var(--kv-text-muted)] hover:text-[var(--kv-heading)]',
        )}
      >
        {t.label}
        {t.count !== undefined && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--kv-border-soft)] text-[var(--kv-heading)]">{t.count}</span>}
      </button>
    ))}
  </div>
);

export const KeyValue: React.FC<{ items: [string, React.ReactNode][]; cols?: 1 | 2 | 3 }> = ({ items, cols = 2 }) => (
  <dl className={cx('grid gap-x-6 gap-y-2.5 text-sm', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
    {items.map(([k, v]) => (
      <div key={k} className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--kv-text-muted)]">{k}</dt>
        <dd className="text-[var(--kv-heading)] break-words">{v ?? '—'}</dd>
      </div>
    ))}
  </dl>
);

export interface HistoryEvent {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
  actorName: string | null;
  actorRole: string | null;
}

export const Timeline: React.FC<{ events: HistoryEvent[] | undefined }> = ({ events }) => {
  if (!events?.length) return <p className="text-sm text-[var(--kv-text-muted)]">No history recorded yet.</p>;
  return (
    <ol className="relative border-l-2 border-[var(--kv-border)] ml-2 space-y-4">
      {events.map((e) => (
        <li key={e.id} className="ml-4">
          <span className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-[var(--kv-primary)] ring-4 ring-white" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--kv-heading)] capitalize">{e.action.replace(/_/g, ' ')}</span>
            {e.toStatus && e.toStatus !== e.fromStatus && <StatusBadge status={e.toStatus} />}
          </div>
          <div className="text-xs text-[var(--kv-text-muted)]">
            {new Date(e.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {e.actorName && ` · ${e.actorName}${e.actorRole ? ` (${e.actorRole})` : ''}`}
          </div>
          {e.note && <p className="text-sm text-[var(--kv-heading)] mt-1 whitespace-pre-wrap">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
};

/** Horizontal bar chart from real values; the value is always printed next to the bar. */
export const BarList: React.FC<{ data: { label: string; value: number | null; suffix?: string }[]; max?: number; emptyMessage?: string; ariaLabel?: string }> = ({
  data,
  max,
  emptyMessage = 'No data for this period.',
  ariaLabel,
}) => {
  const values = data.map((d) => d.value ?? 0);
  const top = max ?? Math.max(1, ...values);
  if (!data.length) return <p className="text-sm text-[var(--kv-text-muted)]">{emptyMessage}</p>;
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(80px,32%)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate text-[var(--kv-heading)]" title={d.label}>
            {d.label}
          </span>
          <span className="h-2.5 rounded-full bg-[var(--kv-surface-alt)] overflow-hidden" aria-hidden="true">
            <span className="block h-full rounded-full bg-[var(--kv-primary)]" style={{ width: `${Math.max(0, Math.min(100, ((d.value ?? 0) / top) * 100))}%` }} />
          </span>
          <span className="font-semibold text-[var(--kv-heading)] tabular-nums text-right min-w-[3.5rem]">{d.value === null ? '—' : `${d.value}${d.suffix ?? ''}`}</span>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Date helpers for inputs
// ---------------------------------------------------------------------------
/** ISO → value for <input type="datetime-local"> in the browser's timezone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '');
/** '19:00' → '7:00 PM'. The portals show a 12-hour clock; the server stores 24-hour. */
export const clock12 = (hhmm: string | null | undefined): string => {
  if (!hhmm) return '—';
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`;
};

/** '19:00' + 10 → '19:10', stopping at the end of the day. */
export const addClockMinutes = (hhmm: string, minutes: number): string => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return hhmm;
  const total = Math.min(Number(m[1]) * 60 + Number(m[2]) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** '7:00 PM' / '7:00' + meridiem → '19:00', the form the server keeps. */
export const clock24 = (hour: number, minute: number, meridiem: 'AM' | 'PM'): string => {
  const h = meridiem === 'AM' ? hour % 12 : (hour % 12) + 12;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

export const todayInput = () => toLocalInput(new Date().toISOString()).slice(0, 10);
export const addDaysInput = (days: number) => toLocalInput(new Date(Date.now() + days * 86_400_000).toISOString()).slice(0, 10);
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
