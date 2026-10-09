import type { DistanceMethod, Savings } from '@cleanloop/shared';
import { round } from '@cleanloop/shared';

/** Tailpipe CO2 from burning one litre of diesel. */
export const CO2_KG_PER_LITRE_DIESEL = 2.68;
/** Assumed fuel efficiency of a loaded municipal compactor truck. */
export const DEFAULT_KM_PER_LITRE = 3;
/** Straight-line distance understates road distance in dense lanes. */
export const ROAD_FACTOR = 1.35;
/** Average truck speed inside residential lanes. */
export const LANE_SPEED_KMH = 12;
/** Minutes spent loading at each stop. */
export const SERVICE_MINUTES = 6;

export function computeSavings(args: {
  baselineKm: number;
  optimisedKm: number;
  vehicleType: 'diesel' | 'ev';
  kmPerLitre?: number;
  method: DistanceMethod;
}): Savings {
  const kmPerLitre = args.kmPerLitre ?? DEFAULT_KM_PER_LITRE;
  const kmSaved = Math.max(0, args.baselineKm - args.optimisedKm);
  const litres = args.vehicleType === 'diesel' ? kmSaved / kmPerLitre : 0;
  return {
    baselineKm: round(args.baselineKm, 1),
    optimisedKm: round(args.optimisedKm, 1),
    kmSaved: round(kmSaved, 1),
    dieselLitresSaved: round(litres, 1),
    co2KgSaved: round(litres * CO2_KG_PER_LITRE_DIESEL, 1),
    kmPerLitre,
    co2KgPerLitre: CO2_KG_PER_LITRE_DIESEL,
    method: args.method,
    vehicleType: args.vehicleType,
  };
}

/** Driving plus loading time for one leg. */
export function legMinutes(km: number, driveMinutes?: number): number {
  const drive = driveMinutes ?? (km / LANE_SPEED_KMH) * 60;
  return Math.round(drive + SERVICE_MINUTES);
}
