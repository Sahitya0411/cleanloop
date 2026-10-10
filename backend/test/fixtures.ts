import type { Lane, Route, RouteRun, Stop } from '@cleanloop/shared';
import { computeSavings } from '../src/core/savings';

export const DATE = '2026-10-10';

export const route: Route = {
  routeId: 'r1',
  wardId: 'w1',
  name: 'Test route',
  vehicleType: 'diesel',
  vehicleNumber: 'DL 1 TEST',
  startTime: '07:00',
  depot: { lat: 28.75, lng: 77.11, name: 'Depot' },
  baselineOrder: ['a', 'b', 'c', 'd', 'e'],
  kmPerLitre: 3,
};

export function lane(laneId: string, lat: number, lng: number, extra: Partial<Lane> = {}): Lane {
  return {
    laneId,
    wardId: 'w1',
    name: `Lane ${laneId.toUpperCase()}`,
    area: 'Test',
    lat,
    lng,
    marketDays: [],
    households: 100,
    ...extra,
  };
}

export function stops(statuses: Stop['status'][], minutes = 10): Stop[] {
  return statuses.map((status, i) => ({
    routeId: 'r1',
    date: DATE,
    seq: i + 1,
    laneId: String.fromCharCode(97 + i),
    laneName: `Lane ${String.fromCharCode(65 + i)}`,
    lat: 28.75 - i * 0.002,
    lng: 77.11 + i * 0.002,
    avgMinutesToNext: i === statuses.length - 1 ? 0 : minutes,
    status,
  }));
}

export function run(extra: Partial<RouteRun> = {}): RouteRun {
  return {
    routeId: 'r1',
    wardId: 'w1',
    routeName: 'Test route',
    date: DATE,
    status: 'in_progress',
    order: ['a', 'b', 'c', 'd', 'e'],
    deferred: [],
    savings: computeSavings({
      baselineKm: 10,
      optimisedKm: 8,
      vehicleType: 'diesel',
      method: 'estimate',
    }),
    generatedAt: '2026-10-09T16:30:00.000Z',
    generatedBy: 'nightly',
    ...extra,
  };
}

/** 07:00 IST on DATE plus `m` minutes. */
export const at = (m: number) => new Date(Date.parse(`${DATE}T01:30:00.000Z`) + m * 60_000);
