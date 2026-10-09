import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data?: T;
  error?: Error;
  loading: boolean;
}

/**
 * Loads data on mount (and when `deps` change). With `pollMs`, refreshes quietly
 * in the background while the tab is visible, for the live ETA and driver views.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: number } = {}) {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async (silent = false) => {
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await fnRef.current();
      if (id === seq.current) setState({ data, loading: false });
    } catch (err) {
      if (id === seq.current) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    }
  }, []);

  useEffect(() => {
    void run();
    if (!opts.pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void run(true);
    }, opts.pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // A local update (e.g. after Done) wins over any background poll still in flight.
  const setData = useCallback((data: T) => {
    seq.current++;
    setState({ data, loading: false });
  }, []);
  return { ...state, reload: run, setData };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
