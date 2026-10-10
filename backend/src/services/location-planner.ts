import { CalculateRoutesCommand, type GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import type { LatLng } from '@cleanloop/shared';
import { haversineKm } from '@cleanloop/shared';
import { LANE_SPEED_KMH, ROAD_FACTOR } from '../core/savings';
import type { Logger, RouteMeasure, RoutePlanner } from './types';

/** Straight-line distance times a road factor; used offline and as a fallback. */
export class EstimatePlanner implements RoutePlanner {
  async measure(points: LatLng[]): Promise<RouteMeasure> {
    const legKm: number[] = [];
    for (let i = 1; i < points.length; i++) {
      legKm.push(haversineKm(points[i - 1]!, points[i]!) * ROAD_FACTOR);
    }
    return {
      km: legKm.reduce((a, b) => a + b, 0),
      legKm,
      legDriveMinutes: legKm.map((km) => (km / LANE_SPEED_KMH) * 60),
      method: 'estimate',
    };
  }
}

/** Amazon Location allows a limited number of waypoints per request; stay well under it. */
const MAX_WAYPOINTS = 20;

/** Truck routing on real roads with Amazon Location Service (Routes V2). */
export class AmazonLocationPlanner implements RoutePlanner {
  private fallback = new EstimatePlanner();

  constructor(
    private client: GeoRoutesClient,
    private log: Logger,
  ) {}

  async measure(points: LatLng[]): Promise<RouteMeasure> {
    if (points.length < 2) return this.fallback.measure(points);
    try {
      const legKm: number[] = [];
      const legDriveMinutes: number[] = [];
      const path: [number, number][] = [];
      // Split long routes into chunks that share their boundary point.
      for (let start = 0; start < points.length - 1; start += MAX_WAYPOINTS + 1) {
        const chunk = points.slice(start, Math.min(points.length, start + MAX_WAYPOINTS + 2));
        const measured = await this.measureChunk(chunk);
        legKm.push(...measured.legKm);
        legDriveMinutes.push(...measured.legDriveMinutes);
        path.push(...measured.path);
      }
      if (legKm.length !== points.length - 1) throw new Error('Leg count mismatch');
      return {
        km: legKm.reduce((a, b) => a + b, 0),
        legKm,
        legDriveMinutes,
        path,
        method: 'amazon-location',
      };
    } catch (err) {
      this.log.warn('Amazon Location routing failed; using estimate', { error: String(err) });
      return this.fallback.measure(points);
    }
  }

  private async measureChunk(chunk: LatLng[]) {
    const toPos = (p: LatLng) => [p.lng, p.lat];
    const res = await this.client.send(
      new CalculateRoutesCommand({
        Origin: toPos(chunk[0]!),
        Destination: toPos(chunk[chunk.length - 1]!),
        Waypoints: chunk.slice(1, -1).map((p) => ({ Position: toPos(p) })),
        TravelMode: 'Truck',
        LegGeometryFormat: 'Simple',
        LegAdditionalFeatures: ['Summary'],
      }),
    );
    const legs = res.Routes?.[0]?.Legs ?? [];
    if (legs.length !== chunk.length - 1) throw new Error(`Expected ${chunk.length - 1} legs`);
    const path: [number, number][] = [];
    const legKm = legs.map((leg) => {
      for (const pt of leg.Geometry?.LineString ?? []) path.push([pt[0]!, pt[1]!]);
      return (leg.VehicleLegDetails?.Summary?.Overview?.Distance ?? 0) / 1000;
    });
    const legDriveMinutes = legs.map(
      (leg) => (leg.VehicleLegDetails?.Summary?.Overview?.Duration ?? 0) / 60,
    );
    return { legKm, legDriveMinutes, path };
  }
}
