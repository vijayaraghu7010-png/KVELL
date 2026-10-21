import { useCallback, useEffect, useState } from 'react';

export const NAVIGATE_EVENT = 'kvcet:navigate';

/** Path segments after the leading portal segment, e.g. /dean/assignments/ASG-1 → ['assignments','ASG-1']. */
const segments = () => window.location.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);

/**
 * Keeps a portal's active tab in the URL (/portal/tab/id) so pages can be bookmarked,
 * reloaded and opened from notification links, and Back/Forward work.
 */
export function usePortalRoute<T extends string>(portal: string, validTabs: readonly T[], defaultTab: T) {
  const read = useCallback((): { tab: T; param: string | null } => {
    const [tab, param] = segments();
    return validTabs.includes(tab as T) ? { tab: tab as T, param: param ?? null } : { tab: defaultTab, param: null };
  }, [validTabs, defaultTab]);

  const [state, setState] = useState(read);

  useEffect(() => {
    const sync = () => setState(read());
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
    };
  }, [read]);

  const navigate = useCallback(
    (tab: T, param?: string | null) => {
      const path = `/${portal}/${tab}${param ? `/${encodeURIComponent(param)}` : ''}`;
      if (window.location.pathname !== path) window.history.pushState({}, '', path);
      setState({ tab, param: param ?? null });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [portal],
  );

  return { tab: state.tab, param: state.param, navigate };
}

/**
 * Follows a server notification link. Generic links (/tasks, /schedule, /report-requests)
 * resolve inside the current user's portal.
 */
export function followLink(link: string | null | undefined, portal: string | null) {
  if (!link || !portal) return;
  const [path, query] = link.split('?');
  const parts = path.split('/').filter(Boolean);
  const target = ['tasks', 'schedule', 'report-requests', 'follow-ups'].includes(parts[0]) ? `/${portal}/${parts.join('/')}` : parts[0] === portal ? `/${parts.join('/')}` : `/${portal}`;
  window.history.pushState({}, '', target + (query ? `?${query}` : ''));
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export const queryParam = (name: string) => new URLSearchParams(window.location.search).get(name);
