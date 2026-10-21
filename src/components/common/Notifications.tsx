import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { http } from '../../services/http';
import { usePolling } from '../../hooks/useApi';
import { followLink } from '../../hooks/usePortalRoute';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Loading, PageHeader, Tabs, cx } from './ui';

export interface AppNotification {
  id: string;
  eventType: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  severity: 'info' | 'success' | 'warning' | 'alert';
  read: boolean;
  createdAt: string;
}

interface NotificationsState {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  open: (n: AppNotification) => void;
}

const Ctx = createContext<NotificationsState | null>(null);

/**
 * Raised when a student opens a study-session notification. The student portal has no
 * attendance page; its QR modal listens for this and shows the code in place.
 */
export const STUDY_QR_EVENT = 'kvcet:study-qr';

/**
 * The Adviser's side of the same idea: opening the "session started" notification
 * brings up the QR to show the room and the scanner for students' own codes.
 */
export const STUDY_SCANNER_EVENT = 'kvcet:study-scanner';

/** One shared, polled notification feed per signed-in user (persisted on the server). */
export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await http.getRaw<AppNotification[]>('/notifications?limit=150');
      setItems(res.data);
      setUnread(res.raw.unreadCount ?? res.data.filter((n) => !n.read).length);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  usePolling(reload, 45_000);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await http.post(`/notifications/${id}/read`);
    } catch {
      reload();
    }
  }, [reload]);

  /** Removes one notification from this user's own feed. */
  const dismiss = useCallback(
    async (id: string) => {
      let removed: AppNotification | undefined;
      setItems((prev) => {
        removed = prev.find((n) => n.id === id);
        return prev.filter((n) => n.id !== id);
      });
      if (removed && !removed.read) setUnread((u) => Math.max(0, u - 1));
      try {
        await http.del(`/notifications/${id}`);
      } catch {
        reload();
      }
    },
    [reload],
  );

  const markAllRead = useCallback(async () => {
    await http.post('/notifications/read-all');
    await reload();
  }, [reload]);

  const open = useCallback(
    (n: AppNotification) => {
      if (!n.read) markRead(n.id);
      // A live study session is delivered as its QR, not as a page to navigate to.
      if (user?.portal === 'student' && n.entityType === 'study_session' && n.entityId && (n.eventType === 'study.started' || n.eventType === 'study.ended')) {
        window.dispatchEvent(new CustomEvent(STUDY_QR_EVENT, { detail: n.entityId }));
        return;
      }
      // The Adviser running the session gets the scanner in the same place.
      if (user?.portal === 'adviser' && n.entityId && n.eventType === 'study.started.adviser') {
        window.dispatchEvent(new CustomEvent(STUDY_SCANNER_EVENT, { detail: n.entityId }));
        return;
      }
      followLink(n.link, user?.portal ?? null);
    },
    [markRead, user?.portal],
  );

  return <Ctx.Provider value={{ items, unread, loading, error, reload, markRead, markAllRead, dismiss, open }}>{children}</Ctx.Provider>;
};

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}

const SEVERITY_ICON: Record<string, { icon: string; cls: string }> = {
  info: { icon: 'info', cls: 'bg-blue-100 text-[var(--kv-primary)]' },
  success: { icon: 'check_circle', cls: 'bg-emerald-100 text-emerald-700' },
  warning: { icon: 'warning', cls: 'bg-amber-100 text-amber-700' },
  alert: { icon: 'campaign', cls: 'bg-rose-100 text-rose-700' },
};

export const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const NotificationRow: React.FC<{ n: AppNotification; onOpen: (n: AppNotification) => void; onDismiss: (id: string) => void }> = ({ n, onOpen, onDismiss }) => {
  const sev = SEVERITY_ICON[n.severity] ?? SEVERITY_ICON.info;
  return (
    <li className={cx('flex items-start', !n.read && 'bg-blue-50/40')}>
      <button type="button" onClick={() => onOpen(n)} className="flex-1 min-w-0 text-left p-3 flex items-start gap-3 hover:bg-[var(--kv-accent-soft)] transition cursor-pointer">
        <span className={cx('w-8 h-8 rounded-full flex items-center justify-center shrink-0', sev.cls)}>
          <Icon name={sev.icon} className="text-[18px]" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-start justify-between gap-2">
            <span className={cx('text-sm text-[var(--kv-heading)] leading-snug', !n.read && 'font-bold')}>{n.title}</span>
            <span className="text-[11px] text-[var(--kv-text-muted)] shrink-0">{timeAgo(n.createdAt)}</span>
          </span>
          <span className="block text-xs text-[var(--kv-text-muted)] mt-0.5 line-clamp-2">{n.message}</span>
        </span>
        {!n.read && <span className="w-2 h-2 rounded-full bg-[var(--kv-primary)] mt-2 shrink-0" aria-label="Unread" />}
      </button>
      <button
        type="button"
        aria-label={`Dismiss notification: ${n.title}`}
        title="Dismiss"
        onClick={() => onDismiss(n.id)}
        className="m-2 p-1 rounded-md text-[var(--kv-text-muted)] hover:bg-[var(--kv-accent-soft)] hover:text-[var(--kv-heading)] transition cursor-pointer shrink-0"
      >
        <Icon name="close" className="text-[18px]" />
      </button>
    </li>
  );
};

/** Header bell with dropdown. */
export const NotificationBell: React.FC<{ onViewAll?: () => void; dark?: boolean }> = ({ onViewAll, dark }) => {
  const { items, unread, markAllRead, dismiss, open: openItem, error } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx('relative p-2 rounded-lg transition cursor-pointer', dark ? 'text-white/80 hover:bg-white/10' : 'text-slate-500 hover:text-[var(--kv-primary)] hover:bg-slate-100')}
      >
        <Icon name="notifications" className="text-[22px]" />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(92vw,380px)] bg-white rounded-xl shadow-2xl border border-[var(--kv-border)] overflow-hidden z-[60]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--kv-border-soft)]">
            <span className="font-bold text-sm text-[var(--kv-heading)]">Notifications</span>
            <button type="button" disabled={!unread} onClick={() => markAllRead()} className="text-xs font-semibold text-[var(--kv-primary)] hover:underline disabled:opacity-40 cursor-pointer">
              Mark all read
            </button>
          </div>
          {error ? (
            <p className="p-4 text-sm text-rose-700">{error}</p>
          ) : items.length === 0 ? (
            <EmptyState icon="notifications_off" title="You're all caught up" />
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-[var(--kv-border-soft)]">
              {items.slice(0, 12).map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  onDismiss={dismiss}
                  onOpen={(x) => {
                    setOpen(false);
                    openItem(x);
                  }}
                />
              ))}
            </ul>
          )}
          {onViewAll && (
            <div className="border-t border-[var(--kv-border-soft)] p-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onViewAll();
                }}
              >
                View all notifications
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Full-page notification centre. */
export const NotificationsPage: React.FC = () => {
  const { items, unread, loading, error, reload, markAllRead, dismiss, open } = useNotifications();
  const [filter, setFilter] = useState('all');
  const shown = filter === 'unread' ? items.filter((n) => !n.read) : items;
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Notifications"
        subtitle="In-app notifications generated by actions in the system. Email/SMS delivery is not configured."
        icon="notifications"
        actions={
          <Button variant="secondary" icon="done_all" disabled={!unread} onClick={() => markAllRead()}>
            Mark all read
          </Button>
        }
      />
      <div className="mb-3">
        <Tabs
          tabs={[
            { id: 'all', label: 'All', count: items.length },
            { id: 'unread', label: 'Unread', count: unread },
          ]}
          active={filter}
          onChange={setFilter}
        />
      </div>
      <Card bodyClassName="p-0">
        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : loading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon="notifications_off" title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} />
        ) : (
          <ul className="divide-y divide-[var(--kv-border-soft)]">
            {shown.map((n) => (
              <NotificationRow key={n.id} n={n} onOpen={open} onDismiss={dismiss} />
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[11px] text-[var(--kv-text-muted)] mt-2">
        <Badge tone="slate">Note</Badge> Notifications refresh automatically every 45 seconds.
      </p>
    </div>
  );
};
