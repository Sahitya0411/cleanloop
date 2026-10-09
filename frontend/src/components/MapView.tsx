import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { config } from '../lib/config';

// MapLibre finds its worker next to its own module, which does not survive bundling.
setWorkerUrl(workerUrl);

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind?: 'stop' | 'truck' | 'home' | 'pin';
  color?: string;
  label?: string;
  large?: boolean;
  title?: string;
  onClick?: () => void;
}

export interface MapViewProps {
  markers: MapMarker[];
  path?: [number, number][];
  className?: string;
  /** Re-fit the view when this changes. */
  fitKey?: string;
  ariaLabel?: string;
}

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Amazon Location Service map tiles (with India's official boundaries) when a key is configured. */
function mapStyle(): string | StyleSpecification {
  if (!config.mapsApiKey) return OSM_STYLE;
  const params = new URLSearchParams({
    key: config.mapsApiKey,
    'color-scheme': 'Light',
    'political-view': 'IND',
  });
  return `https://maps.geo.${config.region}.amazonaws.com/v2/styles/Standard/descriptor?${params}`;
}

const TRUCK_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';
const HOME_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

function markerElement(m: MapMarker): HTMLElement {
  const el = document.createElement('div');
  el.className = `marker${m.large ? ' marker-lg' : ''}${m.kind === 'truck' ? ' marker-truck' : ''}`;
  el.style.background = m.kind === 'truck' ? '' : (m.color ?? '#1f6b3e');
  if (m.kind === 'truck') el.innerHTML = TRUCK_SVG;
  else if (m.kind === 'home') el.innerHTML = HOME_SVG;
  else if (m.label) el.textContent = m.label;
  if (m.title) {
    el.title = m.title;
    el.setAttribute('aria-label', m.title);
  }
  return el;
}

export default function MapView({
  markers,
  path,
  className = 'map',
  fitKey,
  ariaLabel,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const placed = useRef<Marker[]>([]);
  const loaded = useRef(false);
  const latest = useRef({ markers, path });
  latest.current = { markers, path };

  const boundsOf = (): LngLatBounds | undefined => {
    const { markers: ms, path: p } = latest.current;
    const pts: [number, number][] = [
      ...ms.map((x) => [x.lng, x.lat] as [number, number]),
      ...(p ?? []),
    ];
    if (!pts.length) return undefined;
    return pts.reduce((b, pt) => b.extend(pt), new LngLatBounds(pts[0]!, pts[0]!));
  };

  const fit = () => {
    const bounds = boundsOf();
    if (map.current && bounds)
      map.current.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
  };

  const drawPath = () => {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { markers: ms, path: p } = latest.current;
    const coords =
      p && p.length > 1 ? p : ms.filter((x) => x.kind === 'stop').map((x) => [x.lng, x.lat]);
    const data = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: coords },
    };
    const source = m.getSource('route') as { setData?: (d: unknown) => void } | undefined;
    if (source?.setData) {
      source.setData(data);
    } else {
      m.addSource('route', { type: 'geojson', data });
      m.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#1f6b3e', 'line-width': 4, 'line-opacity': 0.75 },
      });
    }
  };

  useEffect(() => {
    if (!container.current) return;
    const bounds = boundsOf();
    const m = new MapLibreMap({
      container: container.current,
      style: mapStyle(),
      ...(bounds
        ? { bounds, fitBoundsOptions: { padding: 48, maxZoom: 16 } }
        : { center: [77.12, 28.744] as [number, number], zoom: 14 }),
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    // The style is enough to draw the route; no need to wait for every tile.
    m.on('style.load', () => {
      loaded.current = true;
      drawPath();
    });
    map.current = m;
    return () => {
      placed.current.forEach((p) => p.remove());
      placed.current = [];
      m.remove();
      map.current = null;
      loaded.current = false;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    placed.current.forEach((p) => p.remove());
    placed.current = markers.map((mk) => {
      const el = markerElement(mk);
      if (mk.onClick) el.addEventListener('click', mk.onClick);
      const marker = new Marker({ element: el }).setLngLat([mk.lng, mk.lat]);
      if (mk.title && !mk.onClick)
        marker.setPopup(new Popup({ offset: 18, closeButton: false }).setText(mk.title));
      return marker.addTo(m);
    });
    drawPath();
  }, [markers, path]);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <div ref={container} className={className} role="region" aria-label={ariaLabel ?? 'Map'} />
  );
}
