import { Suspense, lazy } from 'react';
import type { MapViewProps } from './MapView';
import { Skeleton } from './ui';

export type { MapMarker } from './MapView';

// MapLibre is large; load it only on screens that show a map.
const MapView = lazy(() => import('./MapView'));

export function MapBox(props: MapViewProps) {
  const height = props.className?.includes('map-full')
    ? 520
    : props.className?.includes('map-tall')
      ? 420
      : 300;
  return (
    <Suspense fallback={<Skeleton height={height} />}>
      <MapView {...props} />
    </Suspense>
  );
}
