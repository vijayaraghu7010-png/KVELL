import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { ThemeSwitch } from './ThemeSwitch';
import { NotificationBell } from './Notifications';
import { Icon, cx } from './ui';

export interface NavItem<T extends string = string> {
  id: T;
  label: string;
  icon: string;
  badge?: number;
  section?: string;
}

/**
 * Shared responsive layout: fixed sidebar on large screens, slide-in drawer on small screens,
 * top bar with notifications and the account menu.
 */
export function PortalShell<T extends string>({
  portalLabel,
  sidebarColor,
  activeColor,
  nav,
  active,
  onNavigate,
  onSignOut,
  title,
  notificationsTab,
  profileTab,
  footerNote,
  children,
}: {
  portalLabel: string;
  sidebarColor: string;
  activeColor: string;
  nav: NavItem<T>[];
  active: T;
  onNavigate: (id: T) => void;
  onSignOut: () => void;
  title: string;
  notificationsTab?: T;
  profileTab?: T;
  footerNote?: string;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const go = (id: T) => {
    onNavigate(id);
    setMobileOpen(false);
  };
  const initials = (user?.name || '?')
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter((p) => /^[A-Za-z]/.test(p) && !/^(dr|mr|ms|mrs)\.?$/i.test(p))
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  let lastSection: string | undefined;
  return (
    <div className="min-h-screen bg-[var(--kv-page)] text-[var(--kv-heading)]">
      {mobileOpen && <div className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <aside
        className={cx(
          'fixed top-0 left-0 h-full w-72 z-50 flex flex-col text-[var(--kv-on-nav)] transition-transform duration-200 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ backgroundColor: sidebarColor }}
        aria-label={`${portalLabel} navigation`}
      >
        <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-white/10">
          <div>
            <div className="text-xl font-extrabold tracking-wider leading-tight">KVCET</div>
            <div className="text-[11px] font-semibold tracking-[0.18em] text-[var(--kv-accent)] uppercase">{portalLabel}</div>
          </div>
          <button type="button" className="lg:hidden p-1.5 rounded-lg hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <Icon name="close" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {nav.map((item) => {
            const header = item.section && item.section !== lastSection ? item.section : null;
            lastSection = item.section ?? lastSection;
            const isActive = item.id === active;
            return (
              <React.Fragment key={item.id}>
                {header && <div className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--kv-on-nav-muted)]">{header}</div>}
                <button
                  type="button"
                  onClick={() => go(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cx(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--kv-accent)]',
                    isActive ? 'font-semibold shadow-sm' : 'text-[var(--kv-on-nav-muted)] hover:bg-white/10 hover:text-[var(--kv-on-nav)]',
                  )}
                  style={isActive ? { backgroundColor: activeColor, color: 'var(--kv-on-nav-active)' } : undefined}
                >
                  <Icon name={item.icon} className="text-[20px]" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {!!item.badge && (
                    <span className={cx('text-[10px] font-bold px-1.5 py-0.5 rounded-full', isActive ? 'bg-[var(--kv-nav-bg)] text-[var(--kv-on-nav)]' : 'bg-[var(--kv-accent)] text-[var(--kv-on-accent)]')}>{item.badge}</span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        {footerNote && <div className="px-5 py-3 border-t border-white/10 text-[11px] text-[var(--kv-on-nav-muted)]">{footerNote}</div>}
      </aside>

      <div className="lg:pl-72 flex flex-col min-h-screen">
        <header className="sticky top-0 z-30 h-16 bg-[var(--kv-surface)]/95 backdrop-blur border-b border-[var(--kv-border)] flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 min-w-0">
            <button type="button" className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Icon name="menu" className="text-[24px]" />
            </button>
            <div className="text-xs font-semibold tracking-wider uppercase text-slate-500 truncate">
              <span className="hidden sm:inline">{portalLabel} Portal / </span>
              <span className="text-[var(--kv-heading)] font-bold">{title}</span>
            </div>
            {user?.demoData && (
              <span className="hidden sm:inline-flex items-center gap-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-full px-2.5 py-0.5 text-[10px] font-bold shrink-0" role="note" title="This environment was loaded with demonstration data (npm run db:seed-demo).">
                <Icon name="science" className="text-[14px]" /> DEMO DATA
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeSwitch className="mr-1" />
            <NotificationBell onViewAll={notificationsTab ? () => onNavigate(notificationsTab) : undefined} />
            {profileTab ? (
              <button
                type="button"
                onClick={() => onNavigate(profileTab)}
                aria-current={active === profileTab ? 'page' : undefined}
                title="My profile"
                className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-50 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--kv-primary)]"
              >
                <span className="w-8 h-8 rounded-full text-white flex items-center justify-center font-bold text-xs" style={{ backgroundColor: sidebarColor }}>
                  {initials}
                </span>
                <span className="hidden md:flex flex-col text-left">
                  <span className="text-xs font-bold text-slate-800 leading-tight max-w-[180px] truncate">{user?.name}</span>
                  <span className="text-[11px] text-slate-500 leading-tight">
                    {user?.role}
                    {user?.departmentCode ? ` · ${user.departmentCode}` : ''}
                  </span>
                </span>
              </button>
            ) : (
              <button type="button" onClick={onSignOut} className="flex items-center gap-1.5 p-2 rounded-xl text-sm font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer">
                <Icon name="logout" className="text-[18px]" /> Sign out
              </button>
            )}
          </div>
        </header>
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
