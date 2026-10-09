import type { Lane, LatLng, Ward } from '@cleanloop/shared';
import { haversineKm } from '@cleanloop/shared';

/** The ward whose service radius contains the point, nearest centre first. */
export function locateWard(point: LatLng, wards: Ward[]): Ward | undefined {
  let best: Ward | undefined;
  let bestKm = Infinity;
  for (const w of wards) {
    const km = haversineKm(point, w.centre);
    if (km <= w.radiusKm && km < bestKm) {
      best = w;
      bestKm = km;
    }
  }
  return best;
}

export function nearestLane(point: LatLng, lanes: Lane[], maxKm = 1.5): Lane | undefined {
  let best: Lane | undefined;
  let bestKm = Infinity;
  for (const lane of lanes) {
    const km = haversineKm(point, lane);
    if (km <= maxKm && km < bestKm) {
      best = lane;
      bestKm = km;
    }
  }
  return best;
}
