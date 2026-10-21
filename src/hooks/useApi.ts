import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/http';

/** Loads a resource and exposes loading / error / reload. Stale responses are ignored. */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (mine === seq.current) setData(result);
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, error, loading, reload };
}

/**
 * Wraps a mutation: tracks pending state, reports success/failure through the toast,
 * and returns the result (or undefined on failure) so callers can close dialogs only on success.
 */
export function useAction(onToast: (msg: string, isError?: boolean) => void) {
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async <R,>(fn: () => Promise<R & { message?: string }>, success?: string | ((r: R) => string)): Promise<R | undefined> => {
      setPending(true);
      try {
        const r = await fn();
        const msg = typeof success === 'function' ? success(r) : success ?? (r as any)?.message;
        if (msg) onToast(msg);
        return r;
      } catch (err) {
        onToast(errorMessage(err), true);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [onToast],
  );
  return { run, pending };
}

/** Re-runs a callback on an interval while the tab is visible. */
export function usePolling(cb: () => void, ms: number) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') ref.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
