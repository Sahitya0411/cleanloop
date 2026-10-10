import type { Lane, LatLng, RiskLevel, Route } from '@cleanloop/shared';
import { haversineKm } from '@cleanloop/shared';

export interface PlanCandidate {
  lane: Lane;
  score: number;
  level: RiskLevel;
  daysSincePickup: number | null;
  hasOpenReport: boolean;
  isEventDay: boolean;
}

export interface PlanOptions {
  /** Lanes scoring below this, collected within a day and with no complaints, may wait a day. */
  deferBelow: number;
  /** Never defer more than this share of a route's lanes. */
  maxDeferShare: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { deferBelow: 20, maxDeferShare: 1 / 3 };

export interface PlanDecision {
  baseline: Lane[];
  order: PlanCandidate[];
  deferred: PlanCandidate[];
}

function canDefer(c: PlanCandidate, opts: PlanOptions): boolean {
  return (
    c.score < opts.deferBelow &&
    c.daysSincePickup !== null &&
    c.daysSincePickup <= 1 &&
    !c.hasOpenReport &&
    !c.isEventDay
  );
}

/** Greedy nearest-neighbour ordering starting from `start`. */
export function nearestNeighbour<T extends { lane: LatLng }>(start: LatLng, items: T[]): T[] {
  const remaining = [...items];
  const out: T[] = [];
  let here = start;
  while (remaining.length) {
    let best = 0;
    let bestKm = Infinity;
    remaining.forEach((item, i) => {
      const km = haversineKm(here, item.lane);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    });
    const [next] = remaining.splice(best, 1);
    out.push(next!);
    here = next!.lane;
  }
  return out;
}

/**
 * Tomorrow's route: high-risk lanes first, then everything else in the shortest
 * greedy order, skipping lanes predicted to be nearly empty.
 */
export function decideRoute(
  route: Route,
  candidates: PlanCandidate[],
  opts: PlanOptions = DEFAULT_PLAN_OPTIONS,
): PlanDecision {
  const byId = new Map(candidates.map((c) => [c.lane.laneId, c]));
  const baseline = route.baselineOrder
    .map((id) => byId.get(id)?.lane)
    .filter((l): l is Lane => Boolean(l));

  const deferLimit = Math.floor(candidates.length * opts.maxDeferShare);
  const deferred = candidates
    .filter((c) => canDefer(c, opts))
    .sort((a, b) => a.score - b.score)
    .slice(0, deferLimit);
  const deferredIds = new Set(deferred.map((c) => c.lane.laneId));
  const visiting = candidates.filter((c) => !deferredIds.has(c.lane.laneId));

  const high = nearestNeighbour(
    route.depot,
    visiting.filter((c) => c.level === 'high'),
  );
  const restStart = high.length ? high[high.length - 1]!.lane : route.depot;
  const rest = nearestNeighbour(
    restStart,
    visiting.filter((c) => c.level !== 'high'),
  );

  return { baseline, order: [...high, ...rest], deferred };
}
