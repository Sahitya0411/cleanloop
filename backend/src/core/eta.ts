import type { EtaInfo, EtaStop, LatLng, Route, RouteRun, Stop } from '@cleanloop/shared';
import { istDateTime } from '@cleanloop/shared';

/** A route whose next stop was due more than this long ago is shown as running late. */
const LATE_AFTER_MS = 5 * 60_000;
const MAX_UPCOMING = 4;

export interface EtaContext {
  route?: Route;
  run?: RouteRun;
  stops: Stop[];
  date: string;
  now: Date;
}

export interface StopTimeline {
  ordered: Stop[];
  /** Expected arrival per pending stop (by seq). */
  etas: Map<number, Date>;
  /** The schedule slipped: the next stop was due in the past, so ETAs restart from now. */
  late: boolean;
  /** The most advanced handled stop, i.e. where the truck is now. */
  lastHandled?: Stop;
  truck?: LatLng & { label: string };
}

/**
 * ETA(stop k) = time of the last completed stop + sum of avgMinutesToNext for the
 * stops between it and stop k. Before the first tap, the clock starts at the route's
 * start time. A truck cannot arrive in the past, so if the next stop is overdue the
 * clock restarts from `now`. Pending stops the truck already drove past get no ETA.
 */
export function buildTimeline(route: Route, stops: Stop[], date: string, now: Date): StopTimeline {
  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  let lastHandledIdx = -1;
  ordered.forEach((s, i) => {
    if (s.status !== 'pending') lastHandledIdx = i;
  });
  const lastHandled = lastHandledIdx >= 0 ? ordered[lastHandledIdx] : undefined;

  const etas = new Map<number, Date>();
  let clock: number;
  let startIdx: number;
  if (lastHandled) {
    clock = lastHandled.doneAt
      ? Date.parse(lastHandled.doneAt)
      : istDateTime(date, route.startTime).getTime();
    clock += lastHandled.avgMinutesToNext * 60_000;
    startIdx = lastHandledIdx + 1;
  } else {
    clock = istDateTime(date, route.startTime).getTime();
    startIdx = 0;
  }
  const late = startIdx < ordered.length && clock < now.getTime() - LATE_AFTER_MS;
  if (clock < now.getTime()) clock = now.getTime();
  for (let i = startIdx; i < ordered.length; i++) {
    const s = ordered[i]!;
    etas.set(s.seq, new Date(clock));
    clock += s.avgMinutesToNext * 60_000;
  }

  const truck = lastHandled
    ? { lat: lastHandled.lat, lng: lastHandled.lng, label: lastHandled.laneName }
    : { lat: route.depot.lat, lng: route.depot.lng, label: route.depot.name };

  return { ordered, etas, late, lastHandled, truck };
}

function toEtaStop(s: Stop, laneId: string, etas: Map<number, Date>, now: Date): EtaStop {
  const eta = s.status === 'pending' ? etas.get(s.seq) : undefined;
  return {
    seq: s.seq,
    laneId: s.laneId,
    laneName: s.laneName,
    lat: s.lat,
    lng: s.lng,
    status: s.status,
    etaAt: eta?.toISOString(),
    minutes: eta ? Math.max(0, Math.round((eta.getTime() - now.getTime()) / 60_000)) : undefined,
    doneAt: s.doneAt,
    isMine: s.laneId === laneId,
  };
}

export function computeEta(laneId: string, ctx: EtaContext): EtaInfo {
  const { route, run, stops, date, now } = ctx;
  if (!route || !run) {
    return { status: 'no_route', date, upcoming: [], progress: { handled: 0, total: 0 } };
  }
  const { ordered, etas, late, lastHandled, truck } = buildTimeline(route, stops, date, now);
  const base: Omit<EtaInfo, 'status'> = {
    date,
    routeId: route.routeId,
    routeName: route.name,
    truck,
    upcoming: [],
    progress: {
      handled: ordered.filter((s) => s.status !== 'pending').length,
      total: ordered.length,
    },
  };

  const mine = ordered.find((s) => s.laneId === laneId);
  if (!mine) {
    const deferred = run.deferred.some((d) => d.laneId === laneId);
    return { ...base, status: deferred ? 'deferred' : 'not_scheduled' };
  }
  if (mine.status === 'done') return { ...base, status: 'collected', collectedAt: mine.doneAt };
  if (mine.status === 'skipped') {
    return { ...base, status: 'missed', skipReason: mine.skipReason, collectedAt: mine.doneAt };
  }

  const ahead = ordered.filter(
    (s) => s.status === 'pending' && (!lastHandled || s.seq > lastHandled.seq),
  );
  const idx = ahead.findIndex((s) => s.seq === mine.seq);
  if (idx === -1) {
    // The driver went past this lane without tapping it; it is still owed a visit.
    return { ...base, status: 'upcoming' };
  }

  const eta = etas.get(mine.seq)!;
  const window =
    idx + 1 <= MAX_UPCOMING ? ahead.slice(0, idx + 1) : [...ahead.slice(0, MAX_UPCOMING - 1), mine];

  return {
    ...base,
    status: idx === 0 ? 'next' : 'upcoming',
    stopsAway: idx + 1,
    etaAt: eta.toISOString(),
    minutes: Math.max(0, Math.round((eta.getTime() - now.getTime()) / 60_000)),
    late,
    upcoming: window.map((s) => toEtaStop(s, laneId, etas, now)),
  };
}

/** Every stop of the run with its ETA, for the live map. */
export function trackStops(laneId: string, ctx: EtaContext): EtaStop[] {
  if (!ctx.route) return [];
  const { ordered, etas } = buildTimeline(ctx.route, ctx.stops, ctx.date, ctx.now);
  return ordered.map((s) => toEtaStop(s, laneId, etas, ctx.now));
}

/** Minutes until each pending stop, used to word "2 stops away" alerts. */
export function minutesUntil(
  route: Route,
  stops: Stop[],
  date: string,
  now: Date,
): Map<number, number> {
  const { etas } = buildTimeline(route, stops, date, now);
  const out = new Map<number, number>();
  for (const [seq, eta] of etas) {
    out.set(seq, Math.max(0, Math.round((eta.getTime() - now.getTime()) / 60_000)));
  }
  return out;
}
