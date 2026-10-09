import { useState } from 'react';
import type { DriverRoute, Stop } from '@cleanloop/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';

/** Minutes from now to each pending stop, chaining avgMinutesToNext from the current stop. */
export function pendingEtas(stops: Stop[]): Map<number, number> {
  const out = new Map<number, number>();
  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  const lastHandled = ordered.reduce((acc, s, i) => (s.status !== 'pending' ? i : acc), -1);
  let minutes = 0;
  for (let i = lastHandled + 1; i < ordered.length; i++) {
    const s = ordered[i]!;
    if (s.status !== 'pending') continue;
    out.set(s.seq, minutes);
    minutes += s.avgMinutesToNext;
  }
  return out;
}

export function currentStop(stops: Stop[]): Stop | undefined {
  return [...stops].sort((a, b) => a.seq - b.seq).find((s) => s.status === 'pending');
}

/** Shared by the list and map screens: today's route plus Done / Skip actions. */
export function useDriverRoute() {
  const { t } = useI18n();
  const toast = useToast();
  const route = useAsync(() => api.driverRoute(), [], { pollMs: 30_000 });
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<DriverRoute>, message?: string) => {
    setBusy(true);
    try {
      route.setData(await fn());
      if (message) toast(message, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      void route.reload(true);
    } finally {
      setBusy(false);
    }
  };

  return {
    ...route,
    busy,
    done: (seq: number) => act(() => api.stopDone(seq), t('driver.marked')),
    skip: (seq: number, reason: string) => act(() => api.stopSkip(seq, reason)),
  };
}
